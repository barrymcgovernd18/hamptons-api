/**
 * Support Ticket System Routes
 *
 * User-facing:
 *   POST /api/support/tickets           - Submit a new ticket
 *   GET  /api/support/tickets/:email    - Get user's ticket history
 *   GET  /api/support/tickets/:id/messages - Get full thread for one ticket
 *   POST /api/support/tickets/:id/reply - User replies to an existing ticket
 *
 * Admin (requires X-Admin-Secret):
 *   GET  /api/support/admin/tickets          - List all tickets with filters
 *   GET  /api/support/admin/tickets/:id      - Full ticket details + messages
 *   POST /api/support/admin/tickets/:id      - Update status/priority/internal note
 *   POST /api/support/admin/tickets/:id/reply - Admin reply (notifies user)
 *   GET  /api/support/admin/overview         - Dashboard KPIs
 *   GET  /api/support/admin/export           - CSV export
 */

import { Hono } from 'hono';
import prisma from '../lib/prisma';

export const supportRouter = new Hono();

// ??? helpers ??????????????????????????????????????????????????????????????????

async function nextTicketNumber(): Promise<string> {
  // Upsert the singleton counter row and increment atomically
  const seq = await prisma.ticketSequence.upsert({
    where: { id: 'singleton' },
    update: { counter: { increment: 1 } },
    create: { id: 'singleton', counter: 1 },
  });
  return `HC-${String(seq.counter).padStart(4, '0')}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Technical Issue',
  billing: 'Billing Question',
  article_listing: 'Article / Listing Problem',
  account: 'Account / Subscription',
  feature_request: 'Feature Request',
  other: 'Other',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

// Quick reply templates
export const REPLY_TEMPLATES = [
  {
    id: 'greeting',
    label: 'Standard Greeting',
    body: "Thank you for contacting Hamptons Coastal support. We've received your ticket and a member of our team will review it shortly. We typically respond within 1 business day.",
  },
  {
    id: 'billing',
    label: 'Billing Response',
    body: "Thank you for reaching out about your billing question. We've reviewed your account and wanted to provide the following information. All subscriptions are processed through the App Store / Google Play. If you need to manage your subscription, please visit your platform's subscription settings. Please let us know if you have any additional questions.",
  },
  {
    id: 'vesting',
    label: 'Article Vesting',
    body: "Thank you for your inquiry about our article vesting policy. Articles go live immediately upon publication and become permanently vested after 6 months of continuous active subscription. If you cancel before 6 months, articles are temporarily removed but can be restored by resubscribing. After the 6-month mark, articles remain live permanently � even if you later cancel. Please let us know if you have any further questions.",
  },
  {
    id: 'listing_grace',
    label: 'Listing Grace Period',
    body: "Thank you for contacting us about your listing. Listings remain fully visible while your subscription is active. After cancellation, listings remain visible for a 30-day grace period. Once you resubscribe, your listings reactivate immediately. Please reach out if there's anything else we can help with.",
  },
  {
    id: 'resolved',
    label: 'Issue Resolved',
    body: "We're happy to let you know that your issue has been resolved. Please don't hesitate to reach out if you experience any further problems or have additional questions. Thank you for being a valued member of Hamptons Coastal.",
  },
];

// ??? USER ROUTES ??????????????????????????????????????????????????????????????

/**
 * POST /api/support/tickets
 * Submit a new support ticket
 */
supportRouter.post('/tickets', async (c) => {
  try {
    const body = await c.req.json();
    const {
      user_email,
      user_name,
      subject,
      category,
      message,
      agent_tier,
      is_agent,
      related_article_id,
      related_listing_id,
    } = body;

    if (!user_email || !subject || !category || !message) {
      return c.json({ success: false, error: 'user_email, subject, category, and message are required' }, 400);
    }

    const validCategories = ['technical', 'billing', 'article_listing', 'account', 'feature_request', 'other'];
    if (!validCategories.includes(category)) {
      return c.json({ success: false, error: `Invalid category. Must be one of: ${validCategories.join(', ')}` }, 400);
    }

    // Auto-set priority based on category
    let priority = 'medium';
    if (category === 'billing') priority = 'high';
    if (category === 'technical') priority = 'high';
    if (category === 'account') priority = 'medium';

    const ticketNumber = await nextTicketNumber();
    const emailLower = user_email.toLowerCase().trim();

    const ticket = await prisma.supportTicket.create({
      data: {
        ticket_number: ticketNumber,
        user_email: emailLower,
        user_name: user_name || null,
        subject: subject.trim(),
        category,
        priority,
        status: 'open',
        agent_tier: agent_tier || null,
        is_agent: is_agent || false,
        related_article_id: related_article_id || null,
        related_listing_id: related_listing_id || null,
      },
    });

    // Create the initial message
    await prisma.ticketMessage.create({
      data: {
        ticket_id: ticket.id,
        sender: 'user',
        sender_email: emailLower,
        body: message.trim(),
        is_internal: false,
      },
    });

    console.log(`[Support] New ticket ${ticketNumber} from ${emailLower}: "${subject}"`);

    return c.json({
      success: true,
      data: {
        ticket_id: ticket.id,
        ticket_number: ticketNumber,
        status: 'open',
        category_label: CATEGORY_LABELS[category] || category,
        message: `Your ticket ${ticketNumber} has been submitted. We'll respond within 1 business day.`,
      },
    });
  } catch (error) {
    console.error('[Support] Submit ticket error:', error);
    return c.json({ success: false, error: 'Failed to submit ticket' }, 500);
  }
});

/**
 * GET /api/support/tickets/by-email/:email
 * Get all tickets for a user (ticket history)
 */
supportRouter.get('/tickets/by-email/:email', async (c) => {
  try {
    const email = c.req.param('email').toLowerCase().trim();

    const tickets = await prisma.supportTicket.findMany({
      where: { user_email: email },
      orderBy: { created_at: 'desc' },
      include: {
        messages: {
          where: { is_internal: false },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });

    const enriched = tickets.map((t) => ({
      id: t.id,
      ticket_number: t.ticket_number,
      subject: t.subject,
      category: t.category,
      category_label: CATEGORY_LABELS[t.category] || t.category,
      priority: t.priority,
      status: t.status,
      created_at: t.created_at.toISOString(),
      updated_at: t.updated_at.toISOString(),
      last_message: t.messages[0]?.body?.slice(0, 100) || null,
      last_message_sender: t.messages[0]?.sender || null,
      resolved_at: t.resolved_at?.toISOString() || null,
    }));

    return c.json({ success: true, data: enriched });
  } catch (error) {
    console.error('[Support] Get tickets error:', error);
    return c.json({ success: false, error: 'Failed to fetch tickets' }, 500);
  }
});

/**
 * GET /api/support/tickets/:id/messages
 * Get full message thread for a ticket (non-internal only)
 */
supportRouter.get('/tickets/:id/messages', async (c) => {
  try {
    const id = c.req.param('id');

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        messages: {
          where: { is_internal: false },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!ticket) {
      return c.json({ success: false, error: 'Ticket not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        ticket: {
          id: ticket.id,
          ticket_number: ticket.ticket_number,
          subject: ticket.subject,
          category: ticket.category,
          category_label: CATEGORY_LABELS[ticket.category] || ticket.category,
          status: ticket.status,
          priority: ticket.priority,
          created_at: ticket.created_at.toISOString(),
        },
        messages: ticket.messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          body: m.body,
          created_at: m.created_at.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error('[Support] Get messages error:', error);
    return c.json({ success: false, error: 'Failed to fetch messages' }, 500);
  }
});

/**
 * POST /api/support/tickets/:id/reply
 * User replies to their own ticket
 */
supportRouter.post('/tickets/:id/reply', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { user_email, message } = body;

    if (!user_email || !message) {
      return c.json({ success: false, error: 'user_email and message are required' }, 400);
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);
    if (ticket.user_email !== user_email.toLowerCase().trim()) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }
    if (ticket.status === 'closed') {
      return c.json({ success: false, error: 'This ticket is closed. Please open a new ticket.' }, 400);
    }

    await prisma.ticketMessage.create({
      data: {
        ticket_id: id,
        sender: 'user',
        sender_email: user_email.toLowerCase().trim(),
        body: message.trim(),
        is_internal: false,
      },
    });

    // Reopen if resolved
    if (ticket.status === 'resolved') {
      await prisma.supportTicket.update({
        where: { id },
        data: { status: 'open', resolved_at: null },
      });
    } else {
      await prisma.supportTicket.update({ where: { id }, data: { updated_at: new Date() } });
    }

    return c.json({ success: true, message: 'Reply sent' });
  } catch (error) {
    console.error('[Support] User reply error:', error);
    return c.json({ success: false, error: 'Failed to send reply' }, 500);
  }
});

// ??? ADMIN ROUTES ?????????????????????????????????????????????????????????????

/**
 * GET /api/support/admin/overview
 * Dashboard KPIs
 */
supportRouter.get('/admin/overview', async (c) => {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      openCount,
      inProgressCount,
      resolvedCount,
      closedCount,
      urgentCount,
      highCount,
      newToday,
      resolvedThisWeek,
      categoryBreakdown,
      recentTickets,
    ] = await Promise.all([
      prisma.supportTicket.count({ where: { status: 'open' } }),
      prisma.supportTicket.count({ where: { status: 'in_progress' } }),
      prisma.supportTicket.count({ where: { status: 'resolved' } }),
      prisma.supportTicket.count({ where: { status: 'closed' } }),
      prisma.supportTicket.count({ where: { priority: 'urgent', status: { in: ['open', 'in_progress'] } } }),
      prisma.supportTicket.count({ where: { priority: 'high', status: { in: ['open', 'in_progress'] } } }),
      prisma.supportTicket.count({ where: { created_at: { gte: twentyFourHoursAgo } } }),
      prisma.supportTicket.count({ where: { status: 'resolved', resolved_at: { gte: sevenDaysAgo } } }),
      prisma.supportTicket.groupBy({
        by: ['category'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.supportTicket.findMany({
        orderBy: { created_at: 'desc' },
        take: 20,
        include: {
          messages: {
            where: { is_internal: false },
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    return c.json({
      success: true,
      data: {
        counts: {
          open: openCount,
          in_progress: inProgressCount,
          resolved: resolvedCount,
          closed: closedCount,
          urgent_open: urgentCount,
          high_open: highCount,
          new_today: newToday,
          resolved_this_week: resolvedThisWeek,
        },
        category_breakdown: categoryBreakdown.map((b) => ({
          category: b.category,
          label: CATEGORY_LABELS[b.category] || b.category,
          count: b._count.id,
        })),
        recent_tickets: recentTickets.map((t) => ({
          id: t.id,
          ticket_number: t.ticket_number,
          user_email: t.user_email,
          user_name: t.user_name,
          subject: t.subject,
          category: t.category,
          category_label: CATEGORY_LABELS[t.category] || t.category,
          priority: t.priority,
          status: t.status,
          is_agent: t.is_agent,
          agent_tier: t.agent_tier,
          created_at: t.created_at.toISOString(),
          updated_at: t.updated_at.toISOString(),
          last_message_preview: t.messages[0]?.body?.slice(0, 120) || null,
        })),
        reply_templates: REPLY_TEMPLATES,
      },
    });
  } catch (error) {
    console.error('[Support] Admin overview error:', error);
    return c.json({ success: false, error: 'Failed to fetch overview' }, 500);
  }
});

/**
 * GET /api/support/admin/tickets
 * List tickets with full filter/search/sort support
 */
supportRouter.get('/admin/tickets', async (c) => {
  try {
    const status = c.req.query('status');       // open|in_progress|resolved|closed|all
    const priority = c.req.query('priority');   // low|medium|high|urgent
    const category = c.req.query('category');
    const search = c.req.query('search');       // email, ticket number, subject keyword
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');
    const sort = c.req.query('sort') || 'created_at_desc'; // created_at_desc|updated_at_desc|priority

    const where: Record<string, unknown> = {};
    if (status && status !== 'all') where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { user_email: { contains: search.toLowerCase() } },
        { ticket_number: { contains: search.toUpperCase() } },
        { subject: { contains: search } },
        { user_name: { contains: search } },
      ];
    }

    const orderBy: Record<string, string> = {};
    if (sort === 'updated_at_desc') orderBy.updated_at = 'desc';
    else if (sort === 'priority') orderBy.priority = 'asc'; // urgent < high < medium < low alphabetically isn't ideal but functional
    else orderBy.created_at = 'desc';

    const [total, tickets] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          messages: {
            where: { is_internal: false },
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    return c.json({
      success: true,
      data: tickets.map((t) => ({
        id: t.id,
        ticket_number: t.ticket_number,
        user_email: t.user_email,
        user_name: t.user_name,
        subject: t.subject,
        category: t.category,
        category_label: CATEGORY_LABELS[t.category] || t.category,
        priority: t.priority,
        status: t.status,
        is_agent: t.is_agent,
        agent_tier: t.agent_tier,
        created_at: t.created_at.toISOString(),
        updated_at: t.updated_at.toISOString(),
        resolved_at: t.resolved_at?.toISOString() || null,
        last_message_preview: t.messages[0]?.body?.slice(0, 120) || null,
        last_message_sender: t.messages[0]?.sender || null,
        last_activity: t.messages[0]?.created_at?.toISOString() || t.updated_at.toISOString(),
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('[Support] Admin list error:', error);
    return c.json({ success: false, error: 'Failed to fetch tickets' }, 500);
  }
});

/**
 * GET /api/support/admin/tickets/:id
 * Full ticket detail with all messages (including internal notes)
 */
supportRouter.get('/admin/tickets/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { created_at: 'asc' } },
      },
    });

    if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);

    // Fetch user context from our DB
    const user = await prisma.user.findUnique({ where: { email: ticket.user_email } });
    const [userArticles, userListings, userSubscription] = await Promise.all([
      prisma.agentArticleRequest.findMany({
        where: { agent_email: ticket.user_email },
        select: { id: true, headline: true, status: true, submitted_at: true },
        take: 5,
        orderBy: { submitted_at: 'desc' },
      }),
      prisma.agentListingSubmission.findMany({
        where: { agent_email: ticket.user_email },
        select: { id: true, address: true, status: true, submitted_at: true },
        take: 5,
        orderBy: { submitted_at: 'desc' },
      }),
      prisma.subscription.findFirst({
        where: { user_id: user?.id || '', status: { in: ['active', 'trialing'] } },
      }),
    ]);

    return c.json({
      success: true,
      data: {
        ticket: {
          id: ticket.id,
          ticket_number: ticket.ticket_number,
          user_email: ticket.user_email,
          user_name: ticket.user_name,
          subject: ticket.subject,
          category: ticket.category,
          category_label: CATEGORY_LABELS[ticket.category] || ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          is_agent: ticket.is_agent,
          agent_tier: ticket.agent_tier,
          internal_notes: ticket.internal_notes,
          related_article_id: ticket.related_article_id,
          related_listing_id: ticket.related_listing_id,
          created_at: ticket.created_at.toISOString(),
          updated_at: ticket.updated_at.toISOString(),
          resolved_at: ticket.resolved_at?.toISOString() || null,
          first_response_at: ticket.first_response_at?.toISOString() || null,
        },
        messages: ticket.messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          sender_email: m.sender_email,
          body: m.body,
          is_internal: m.is_internal,
          created_at: m.created_at.toISOString(),
        })),
        user_context: {
          user_id: user?.id || null,
          tier: user?.tier || ticket.agent_tier || 'unknown',
          is_agent: ticket.is_agent,
          subscription_status: userSubscription?.status || 'none',
          subscription_plan: userSubscription?.plan_type || null,
          recent_articles: userArticles,
          recent_listings: userListings,
        },
        reply_templates: REPLY_TEMPLATES,
      },
    });
  } catch (error) {
    console.error('[Support] Admin get ticket error:', error);
    return c.json({ success: false, error: 'Failed to fetch ticket' }, 500);
  }
});

/**
 * POST /api/support/admin/tickets/:id
 * Update ticket status, priority, or internal notes
 */
supportRouter.post('/admin/tickets/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { status, priority, internal_notes } = body;

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);

    const updateData: Record<string, unknown> = {};
    if (status) {
      updateData.status = status;
      if (status === 'resolved' && !ticket.resolved_at) updateData.resolved_at = new Date();
      if (status === 'closed' && !ticket.closed_at) updateData.closed_at = new Date();
    }
    if (priority) updateData.priority = priority;
    if (internal_notes !== undefined) updateData.internal_notes = internal_notes;

    const updated = await prisma.supportTicket.update({ where: { id }, data: updateData });

    return c.json({ success: true, data: { id: updated.id, status: updated.status, priority: updated.priority } });
  } catch (error) {
    console.error('[Support] Admin update ticket error:', error);
    return c.json({ success: false, error: 'Failed to update ticket' }, 500);
  }
});

/**
 * POST /api/support/admin/tickets/:id/reply
 * Admin sends a reply to a ticket
 */
supportRouter.post('/admin/tickets/:id/reply', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { admin_email, message, is_internal } = body;

    if (!admin_email || !message) {
      return c.json({ success: false, error: 'admin_email and message are required' }, 400);
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);

    await prisma.ticketMessage.create({
      data: {
        ticket_id: id,
        sender: 'admin',
        sender_email: admin_email,
        body: message.trim(),
        is_internal: is_internal || false,
      },
    });

    const now = new Date();
    const updateData: Record<string, unknown> = { updated_at: now };
    if (!is_internal) {
      // Move to in-progress when admin first responds
      if (ticket.status === 'open') updateData.status = 'in_progress';
      if (!ticket.first_response_at) updateData.first_response_at = now;
    }

    await prisma.supportTicket.update({ where: { id }, data: updateData });

    console.log(`[Support] Admin ${admin_email} replied to ticket ${ticket.ticket_number} (internal: ${is_internal})`);

    return c.json({
      success: true,
      message: is_internal ? 'Internal note saved' : `Reply sent to ${ticket.user_email}`,
    });
  } catch (error) {
    console.error('[Support] Admin reply error:', error);
    return c.json({ success: false, error: 'Failed to send reply' }, 500);
  }
});

/**
 * GET /api/support/admin/export
 * CSV export of all tickets
 */
supportRouter.get('/admin/export', async (c) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      orderBy: { created_at: 'desc' },
    });

    const rows = [
      ['Ticket #', 'User Email', 'Name', 'Subject', 'Category', 'Priority', 'Status', 'Agent', 'Tier', 'Created', 'Resolved'].join(','),
      ...tickets.map((t) =>
        [
          t.ticket_number,
          t.user_email,
          t.user_name || '',
          `"${t.subject.replace(/"/g, '""')}"`,
          CATEGORY_LABELS[t.category] || t.category,
          t.priority,
          t.status,
          t.is_agent ? 'Yes' : 'No',
          t.agent_tier || '',
          t.created_at.toISOString().split('T')[0],
          t.resolved_at ? t.resolved_at.toISOString().split('T')[0] : '',
        ].join(',')
      ),
    ].join('\n');

    return new Response(rows, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="support-tickets-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error('[Support] Export error:', error);
    return c.json({ success: false, error: 'Export failed' }, 500);
  }
});

/**
 * PUT /api/support/admin/tickets/:id/status
 * Update ticket status (for external integrations)
 */
supportRouter.put('/admin/tickets/:id/status', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { status } = body;

    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    if (!status || !validStatuses.includes(status)) {
      return c.json({ success: false, error: `status must be one of: ${validStatuses.join(', ')}` }, 400);
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);

    const updateData: Record<string, unknown> = { status };
    if (status === 'resolved' && !ticket.resolved_at) updateData.resolved_at = new Date();
    if (status === 'closed' && !ticket.closed_at) updateData.closed_at = new Date();

    const updated = await prisma.supportTicket.update({ where: { id }, data: updateData });

    console.log(`[Support] Ticket ${ticket.ticket_number} status updated to ${status}`);

    return c.json({ success: true, data: { id: updated.id, ticket_number: updated.ticket_number, status: updated.status } });
  } catch (error) {
    console.error('[Support] Update status error:', error);
    return c.json({ success: false, error: 'Failed to update status' }, 500);
  }
});

/**
 * POST /api/support/admin/tickets/:id/notes
 * Add or replace internal admin notes on a ticket
 */
supportRouter.post('/admin/tickets/:id/notes', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { notes, admin_email, append } = body;

    if (notes === undefined) {
      return c.json({ success: false, error: 'notes field is required' }, 400);
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return c.json({ success: false, error: 'Ticket not found' }, 404);

    // append=true adds to existing notes with timestamp; default replaces
    let finalNotes = notes;
    if (append && ticket.internal_notes) {
      const timestamp = new Date().toISOString().split('T')[0];
      const adminLabel = admin_email ? `[${admin_email} � ${timestamp}]` : `[${timestamp}]`;
      finalNotes = `${ticket.internal_notes}\n\n${adminLabel}\n${notes}`;
    }

    const updated = await prisma.supportTicket.update({
      where: { id },
      data: { internal_notes: finalNotes },
    });

    // Also create an internal message record if admin_email provided
    if (admin_email && notes.trim()) {
      await prisma.ticketMessage.create({
        data: {
          ticket_id: id,
          sender: 'admin',
          sender_email: admin_email,
          body: notes.trim(),
          is_internal: true,
        },
      });
    }

    return c.json({ success: true, data: { id: updated.id, internal_notes: updated.internal_notes } });
  } catch (error) {
    console.error('[Support] Add notes error:', error);
    return c.json({ success: false, error: 'Failed to save notes' }, 500);
  }
});

/**
 * GET /api/support/admin/user/:email
 * Get full user context for informed ticket resolution
 * Returns subscription status, recent articles, listings, and open ticket count
 */
supportRouter.get('/admin/user/:email', async (c) => {
  try {
    const email = c.req.param('email').toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email } });

    const [subscription, articles, listings, openTickets] = await Promise.all([
      prisma.subscription.findFirst({
        where: { user_id: user?.id || '_none_' },
        orderBy: { created_at: 'desc' },
      }),
      prisma.agentArticleRequest.findMany({
        where: { agent_email: email },
        select: { id: true, headline: true, status: true, submitted_at: true },
        orderBy: { submitted_at: 'desc' },
        take: 10,
      }),
      prisma.agentListingSubmission.findMany({
        where: { agent_email: email },
        select: { id: true, address: true, status: true, submitted_at: true },
        orderBy: { submitted_at: 'desc' },
        take: 10,
      }),
      prisma.supportTicket.count({
        where: { user_email: email, status: { in: ['open', 'in_progress'] } },
      }),
    ]);

    return c.json({
      success: true,
      data: {
        user: {
          id: user?.id || null,
          email,
          name: user?.name || null,
          tier: user?.tier || null,
          created_at: user?.created_at?.toISOString() || null,
        },
        subscription: subscription
          ? {
              status: subscription.status,
              plan_type: subscription.plan_type,
              current_period_end: subscription.current_period_end?.toISOString() || null,
            }
          : null,
        articles: articles.map((a) => ({
          id: a.id,
          headline: a.headline,
          status: a.status,
          submitted_at: a.submitted_at?.toISOString() || null,
        })),
        listings: listings.map((l) => ({
          id: l.id,
          address: l.address,
          status: l.status,
          submitted_at: l.submitted_at?.toISOString() || null,
        })),
        open_ticket_count: openTickets,
      },
    });
  } catch (error) {
    console.error('[Support] Get user context error:', error);
    return c.json({ success: false, error: 'Failed to fetch user context' }, 500);
  }
});