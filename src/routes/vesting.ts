/**
 * Article Vesting & Listing Grace Period Routes
 *
 * Business Logic:
 * - Articles: 6-month vesting period from publication date
 *   - Cancel before 6 months ? article hidden immediately
 *   - After 6 months ? article is "vested" and permanent (survives cancellation)
 *
 * - Listings: 30-day grace period after subscription cancellation
 *   - Cancel ? listing stays visible for 30 more days
 *   - After 30 days ? listing hidden
 *   - Resubscribe ? listing reactivates immediately
 */

import { Hono } from 'hono';
import prisma from '../lib/prisma';
import { auditLog } from '../lib/security';

export const vestingRouter = new Hono();

// =========================================================
// Helper: add months to a date
// =========================================================
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// =========================================================
// Helper: add days to a date
// =========================================================
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// =========================================================
// Helper: log a vesting audit event
// =========================================================
async function logVestingEvent(
  eventType: string,
  resourceType: string,
  resourceId: string,
  agentEmail: string,
  performedBy: string,
  details?: Record<string, unknown>,
) {
  await prisma.vestingAuditLog.create({
    data: {
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId,
      agent_email: agentEmail,
      performed_by: performedBy,
      details: details ? JSON.stringify(details) : null,
    },
  });
}

// =========================================================
// POST /api/vesting/articles/track
// Called when an article is published (approved by admin)
// Creates the vesting record for tracking
// =========================================================
vestingRouter.post('/articles/track', async (c) => {
  try {
    const body = await c.req.json();
    const { article_request_id, agent_email, agent_name, article_title } = body;

    if (!article_request_id || !agent_email) {
      return c.json({ success: false, error: 'article_request_id and agent_email are required' }, 400);
    }

    // Check if already tracked
    const existing = await prisma.articleVesting.findFirst({
      where: { article_request_id },
    });
    if (existing) {
      return c.json({ success: true, data: existing, is_new: false });
    }

    const publicationDate = new Date();
    const vestingDate = addMonths(publicationDate, 6);

    const vestingRecord = await prisma.articleVesting.create({
      data: {
        article_request_id,
        agent_email: agent_email.toLowerCase().trim(),
        agent_name: agent_name || null,
        article_title: article_title || null,
        publication_date: publicationDate,
        vesting_date: vestingDate,
        vesting_status: 'pending',
        subscription_status_at_pub: 'active',
      },
    });

    await logVestingEvent(
      'article_published',
      'article',
      vestingRecord.id,
      agent_email,
      'system',
      { article_request_id, vesting_date: vestingDate.toISOString() },
    );

    return c.json({
      success: true,
      data: vestingRecord,
      is_new: true,
      message: `Article will vest on ${vestingDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    });
  } catch (error) {
    console.error('[Vesting] Track article error:', error);
    return c.json({ success: false, error: 'Failed to track article vesting' }, 500);
  }
});

// =========================================================
// GET /api/vesting/articles/:email
// Get all article vesting records for an agent
// =========================================================
vestingRouter.get('/articles/:email', async (c) => {
  try {
    const email = c.req.param('email').toLowerCase().trim();

    const vestings = await prisma.articleVesting.findMany({
      where: { agent_email: email },
      orderBy: { publication_date: 'desc' },
    });

    const now = new Date();
    const enriched = vestings.map((v) => {
      const daysToVest = Math.ceil((v.vesting_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        ...v,
        days_to_vest: v.vesting_status === 'pending' ? Math.max(0, daysToVest) : null,
        is_vested: v.vesting_status === 'vested',
        is_hidden: v.vesting_status === 'hidden',
        vesting_date_formatted: v.vesting_date.toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        }),
      };
    });

    return c.json({ success: true, data: enriched, total: enriched.length });
  } catch (error) {
    console.error('[Vesting] Get articles error:', error);
    return c.json({ success: false, error: 'Failed to fetch vesting records' }, 500);
  }
});

// =========================================================
// POST /api/vesting/listings/grace-start
// Called when a subscription is canceled - starts 30-day grace for all listings
// =========================================================
vestingRouter.post('/listings/grace-start', async (c) => {
  try {
    const body = await c.req.json();
    const { agent_email } = body;

    if (!agent_email) {
      return c.json({ success: false, error: 'agent_email is required' }, 400);
    }

    const emailLower = agent_email.toLowerCase().trim();
    const canceledAt = new Date();
    const gracePeriodEnd = addDays(canceledAt, 30);

    // Get all approved listings for this agent that don't already have a grace period
    const approvedListings = await prisma.agentListingSubmission.findMany({
      where: {
        agent_email: emailLower,
        status: 'approved',
      },
    });

    const created = [];
    for (const listing of approvedListings) {
      // Check if grace period already started for this listing
      const existing = await prisma.listingGracePeriod.findFirst({
        where: { listing_submission_id: listing.id, status: { in: ['grace', 'hidden'] } },
      });
      if (existing) continue;

      const gracePeriod = await prisma.listingGracePeriod.create({
        data: {
          listing_submission_id: listing.id,
          agent_email: emailLower,
          listing_address: listing.address,
          market_id: listing.market_id,
          subscription_canceled_at: canceledAt,
          grace_period_end: gracePeriodEnd,
          status: 'grace',
        },
      });

      await logVestingEvent(
        'listing_grace_started',
        'listing',
        gracePeriod.id,
        emailLower,
        'system',
        { listing_id: listing.id, grace_period_end: gracePeriodEnd.toISOString() },
      );

      created.push(gracePeriod);
    }

    return c.json({
      success: true,
      data: {
        grace_periods_created: created.length,
        grace_period_end: gracePeriodEnd.toISOString(),
        grace_period_end_formatted: gracePeriodEnd.toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        }),
        listings_affected: created.map((g) => g.listing_address),
      },
    });
  } catch (error) {
    console.error('[Vesting] Grace start error:', error);
    return c.json({ success: false, error: 'Failed to start grace period' }, 500);
  }
});

// =========================================================
// POST /api/vesting/listings/reactivate
// Called when agent resubscribes - reactivates all listings in grace/hidden
// =========================================================
vestingRouter.post('/listings/reactivate', async (c) => {
  try {
    const body = await c.req.json();
    const { agent_email } = body;

    if (!agent_email) {
      return c.json({ success: false, error: 'agent_email is required' }, 400);
    }

    const emailLower = agent_email.toLowerCase().trim();

    const gracePeriods = await prisma.listingGracePeriod.findMany({
      where: {
        agent_email: emailLower,
        status: { in: ['grace', 'hidden'] },
      },
    });

    for (const gp of gracePeriods) {
      await prisma.listingGracePeriod.update({
        where: { id: gp.id },
        data: { status: 'reactivated', reactivated_at: new Date() },
      });

      await logVestingEvent(
        'listing_reactivated',
        'listing',
        gp.id,
        emailLower,
        'system',
        { listing_submission_id: gp.listing_submission_id },
      );
    }

    return c.json({
      success: true,
      data: { listings_reactivated: gracePeriods.length },
    });
  } catch (error) {
    console.error('[Vesting] Reactivate error:', error);
    return c.json({ success: false, error: 'Failed to reactivate listings' }, 500);
  }
});

// =========================================================
// GET /api/vesting/listings/:email
// Get listing grace period records for an agent
// =========================================================
vestingRouter.get('/listings/:email', async (c) => {
  try {
    const email = c.req.param('email').toLowerCase().trim();

    const gracePeriods = await prisma.listingGracePeriod.findMany({
      where: { agent_email: email },
      orderBy: { created_at: 'desc' },
    });

    const now = new Date();
    const enriched = gracePeriods.map((gp) => {
      const daysLeft = Math.ceil((gp.grace_period_end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        ...gp,
        days_until_hidden: gp.status === 'grace' ? Math.max(0, daysLeft) : null,
        grace_end_formatted: gp.grace_period_end.toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        }),
      };
    });

    return c.json({ success: true, data: enriched });
  } catch (error) {
    console.error('[Vesting] Get listings error:', error);
    return c.json({ success: false, error: 'Failed to fetch grace period records' }, 500);
  }
});

// =========================================================
// POST /api/vesting/articles/hide-on-cancel
// Called when subscription is canceled - hides non-vested articles immediately
// =========================================================
vestingRouter.post('/articles/hide-on-cancel', async (c) => {
  try {
    const body = await c.req.json();
    const { agent_email } = body;

    if (!agent_email) {
      return c.json({ success: false, error: 'agent_email is required' }, 400);
    }

    const emailLower = agent_email.toLowerCase().trim();
    const now = new Date();

    // Find all pending (non-vested) articles for this agent
    const pendingArticles = await prisma.articleVesting.findMany({
      where: {
        agent_email: emailLower,
        vesting_status: 'pending',
      },
    });

    const hidden = [];
    const safe = [];

    for (const article of pendingArticles) {
      // If vesting_date has passed, vest it instead of hiding
      if (article.vesting_date <= now) {
        await prisma.articleVesting.update({
          where: { id: article.id },
          data: { vesting_status: 'vested', vested_at: now },
        });
        await logVestingEvent('article_vested', 'article', article.id, emailLower, 'system', {
          reason: 'vesting_date_passed_at_cancellation',
        });
        safe.push(article);
      } else {
        // Hide immediately
        await prisma.articleVesting.update({
          where: { id: article.id },
          data: { vesting_status: 'hidden', hidden_at: now, hidden_reason: 'subscription_canceled' },
        });
        await logVestingEvent('article_hidden', 'article', article.id, emailLower, 'system', {
          reason: 'subscription_canceled_before_vesting',
        });
        hidden.push(article);
      }
    }

    return c.json({
      success: true,
      data: {
        articles_hidden: hidden.length,
        articles_vested_at_cancellation: safe.length,
        hidden_articles: hidden.map((a) => ({
          id: a.id,
          title: a.article_title,
          publication_date: a.publication_date,
          would_have_vested: a.vesting_date,
        })),
        vested_articles: safe.map((a) => ({
          id: a.id,
          title: a.article_title,
        })),
      },
    });
  } catch (error) {
    console.error('[Vesting] Hide on cancel error:', error);
    return c.json({ success: false, error: 'Failed to process article hiding' }, 500);
  }
});

// =========================================================
// GET /api/vesting/cancellation-preview/:email
// Preview what happens to articles/listings if agent cancels NOW
// =========================================================
vestingRouter.get('/cancellation-preview/:email', async (c) => {
  try {
    const email = c.req.param('email').toLowerCase().trim();
    const now = new Date();

    const [pendingArticles, vestedArticles] = await Promise.all([
      prisma.articleVesting.findMany({
        where: { agent_email: email, vesting_status: 'pending' },
        orderBy: { vesting_date: 'asc' },
      }),
      prisma.articleVesting.findMany({
        where: { agent_email: email, vesting_status: 'vested' },
      }),
    ]);

    const approvedListings = await prisma.agentListingSubmission.findMany({
      where: { agent_email: email, status: 'approved' },
      select: { id: true, address: true, market_id: true },
    });

    const articlesToHide = pendingArticles.filter((a) => a.vesting_date > now);
    const articlesToVest = pendingArticles.filter((a) => a.vesting_date <= now);

    const gracePeriodEnd = addDays(now, 30);

    return c.json({
      success: true,
      data: {
        summary: {
          articles_to_be_hidden_immediately: articlesToHide.length,
          articles_safe_vested: vestedArticles.length + articlesToVest.length,
          listings_entering_30_day_grace: approvedListings.length,
          listings_hidden_after: gracePeriodEnd.toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          }),
        },
        articles_to_hide: articlesToHide.map((a) => ({
          id: a.id,
          title: a.article_title || 'Untitled Article',
          published: a.publication_date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          would_vest_on: a.vesting_date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          days_until_vesting: Math.ceil((a.vesting_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        })),
        vested_articles: vestedArticles.map((a) => ({
          id: a.id,
          title: a.article_title || 'Untitled Article',
          vested_on: a.vested_at?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        })),
        listings_with_grace: approvedListings.map((l) => ({
          id: l.id,
          address: l.address,
          market: l.market_id,
          hidden_after: gracePeriodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        })),
      },
    });
  } catch (error) {
    console.error('[Vesting] Cancellation preview error:', error);
    return c.json({ success: false, error: 'Failed to generate preview' }, 500);
  }
});

// =========================================================
// ADMIN ROUTES
// =========================================================

// GET /api/vesting/admin/overview
// Admin dashboard overview data
vestingRouter.get('/admin/overview', async (c) => {
  try {
    const now = new Date();
    const thirtyDaysFromNow = addDays(now, 30);

    const [
      totalPending,
      totalVested,
      totalHidden,
      vestingThisMonth,
      activeGracePeriods,
      expiredGrace,
    ] = await Promise.all([
      prisma.articleVesting.count({ where: { vesting_status: 'pending' } }),
      prisma.articleVesting.count({ where: { vesting_status: 'vested' } }),
      prisma.articleVesting.count({ where: { vesting_status: 'hidden' } }),
      prisma.articleVesting.count({
        where: {
          vesting_status: 'pending',
          vesting_date: { lte: thirtyDaysFromNow },
        },
      }),
      prisma.listingGracePeriod.count({ where: { status: 'grace' } }),
      prisma.listingGracePeriod.count({ where: { status: 'hidden' } }),
    ]);

    // Upcoming vestings in next 30 days
    const upcomingVestings = await prisma.articleVesting.findMany({
      where: {
        vesting_status: 'pending',
        vesting_date: { lte: thirtyDaysFromNow, gte: now },
      },
      orderBy: { vesting_date: 'asc' },
    });

    // Recently vested (last 30 days)
    const thirtyDaysAgo = addDays(now, -30);
    const recentlyVested = await prisma.articleVesting.count({
      where: {
        vesting_status: 'vested',
        vested_at: { gte: thirtyDaysAgo },
      },
    });

    return c.json({
      success: true,
      data: {
        articles: {
          pending_vesting: totalPending,
          vested: totalVested,
          hidden: totalHidden,
          vesting_next_30_days: vestingThisMonth,
          recently_vested_30_days: recentlyVested,
        },
        listings: {
          active_grace_periods: activeGracePeriods,
          hidden_after_grace: expiredGrace,
        },
        upcoming_vestings: upcomingVestings.map((v) => ({
          id: v.id,
          agent_email: v.agent_email,
          article_title: v.article_title,
          vesting_date: v.vesting_date.toISOString(),
          days_until_vesting: Math.ceil((v.vesting_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        })),
      },
    });
  } catch (error) {
    console.error('[Vesting] Admin overview error:', error);
    return c.json({ success: false, error: 'Failed to fetch admin overview' }, 500);
  }
});

// GET /api/vesting/admin/articles
// List all articles with vesting status, with optional filters
vestingRouter.get('/admin/articles', async (c) => {
  try {
    const status = c.req.query('status'); // pending, vested, hidden, or all
    const agentEmail = c.req.query('email');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');

    const where: Record<string, unknown> = {};
    if (status && status !== 'all') where.vesting_status = status;
    if (agentEmail) where.agent_email = { contains: agentEmail.toLowerCase() };

    const [total, articles] = await Promise.all([
      prisma.articleVesting.count({ where }),
      prisma.articleVesting.findMany({
        where,
        orderBy: { vesting_date: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const now = new Date();
    const enriched = articles.map((a) => ({
      ...a,
      days_to_vest: a.vesting_status === 'pending'
        ? Math.max(0, Math.ceil((a.vesting_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null,
    }));

    return c.json({ success: true, data: enriched, total, page, limit });
  } catch (error) {
    console.error('[Vesting] Admin articles error:', error);
    return c.json({ success: false, error: 'Failed to fetch articles' }, 500);
  }
});

// POST /api/vesting/admin/articles/:id/override
// Admin manually overrides vesting status
vestingRouter.post('/admin/articles/:id/override', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { action, admin_email } = body; // action: 'vest' | 'hide' | 'restore'

    if (!action || !admin_email) {
      return c.json({ success: false, error: 'action and admin_email are required' }, 400);
    }

    const article = await prisma.articleVesting.findUnique({ where: { id } });
    if (!article) {
      return c.json({ success: false, error: 'Article vesting record not found' }, 404);
    }

    let newStatus: string;
    let updateData: Record<string, unknown> = {
      manually_overridden: true,
      manually_overridden_by: admin_email,
      manually_overridden_at: new Date(),
    };

    if (action === 'vest') {
      newStatus = 'vested';
      updateData = { ...updateData, vesting_status: 'vested', vested_at: new Date() };
    } else if (action === 'hide') {
      newStatus = 'hidden';
      updateData = { ...updateData, vesting_status: 'hidden', hidden_at: new Date(), hidden_reason: 'admin_action' };
    } else if (action === 'restore') {
      newStatus = 'pending';
      updateData = { ...updateData, vesting_status: 'pending' };
    } else {
      return c.json({ success: false, error: 'Invalid action. Use: vest, hide, or restore' }, 400);
    }

    const updated = await prisma.articleVesting.update({
      where: { id },
      data: updateData,
    });

    await logVestingEvent('manual_override', 'article', id, article.agent_email, admin_email, {
      action,
      old_status: article.vesting_status,
      new_status: newStatus,
    });

    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Vesting] Admin override error:', error);
    return c.json({ success: false, error: 'Failed to override vesting status' }, 500);
  }
});

// GET /api/vesting/admin/audit-log
// Get audit log for vesting events
vestingRouter.get('/admin/audit-log', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '100');
    const agentEmail = c.req.query('email');
    const eventType = c.req.query('event_type');

    const where: Record<string, unknown> = {};
    if (agentEmail) where.agent_email = { contains: agentEmail.toLowerCase() };
    if (eventType) where.event_type = eventType;

    const [total, logs] = await Promise.all([
      prisma.vestingAuditLog.count({ where }),
      prisma.vestingAuditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return c.json({ success: true, data: logs, total, page, limit });
  } catch (error) {
    console.error('[Vesting] Audit log error:', error);
    return c.json({ success: false, error: 'Failed to fetch audit log' }, 500);
  }
});

// GET /api/vesting/admin/listings
// List all listing grace periods
vestingRouter.get('/admin/listings', async (c) => {
  try {
    const status = c.req.query('status');
    const agentEmail = c.req.query('email');

    const where: Record<string, unknown> = {};
    if (status && status !== 'all') where.status = status;
    if (agentEmail) where.agent_email = { contains: agentEmail.toLowerCase() };

    const gracePeriods = await prisma.listingGracePeriod.findMany({
      where,
      orderBy: { subscription_canceled_at: 'desc' },
    });

    const now = new Date();
    const enriched = gracePeriods.map((gp) => ({
      ...gp,
      days_left: gp.status === 'grace'
        ? Math.max(0, Math.ceil((gp.grace_period_end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null,
    }));

    return c.json({ success: true, data: enriched });
  } catch (error) {
    console.error('[Vesting] Admin listings error:', error);
    return c.json({ success: false, error: 'Failed to fetch listings' }, 500);
  }
});