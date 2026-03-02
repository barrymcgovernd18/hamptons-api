/**
 * Cron Job Routes
 *
 * These endpoints are meant to be called by a scheduler (e.g., cron, GitHub Actions, etc.)
 * They should be protected with a secret key.
 */

import { Hono } from 'hono';
import { runAllCleanupJobs, detectSuspiciousPatterns } from '../lib/referral-jobs';
import prisma from '../lib/prisma';

export const cronRouter = new Hono();

/**
 * Middleware to verify cron secret
 */
const verifyCronSecret = async (c: any, next: any) => {
  const secret = c.req.header('X-Cron-Secret') || c.req.query('secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && secret !== expectedSecret) {
    console.warn('[Cron] Unauthorized cron attempt');
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  await next();
};

cronRouter.use('*', verifyCronSecret);

/**
 * POST /api/cron/referral-cleanup
 *
 * Run all referral cleanup jobs:
 * - Expire old rewards (90 days)
 * - Revoke early cancellations
 * - Expire old pending referrals (30 days)
 * - Detect suspicious patterns
 *
 * Should be called daily.
 */
cronRouter.post('/referral-cleanup', async (c) => {
  try {
    console.log('[Cron] Starting referral cleanup...');

    const results = await runAllCleanupJobs();

    return c.json({
      success: true,
      message: 'Cleanup completed',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Cleanup error:', error);
    return c.json({ success: false, error: 'Cleanup failed' }, 500);
  }
});

/**
 * GET /api/cron/fraud-report
 *
 * Get a report of potentially suspicious referral activity.
 * Does not modify any data, just reports.
 */
cronRouter.get('/fraud-report', async (c) => {
  try {
    const report = await detectSuspiciousPatterns();

    return c.json({
      success: true,
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Fraud report error:', error);
    return c.json({ success: false, error: 'Report generation failed' }, 500);
  }
});

/**
 * POST /api/cron/vesting-check
 *
 * Daily vesting check job:
 * 1. Vest articles whose vesting_date has passed (pending ? vested)
 * 2. Hide listings whose grace period has expired (grace ? hidden)
 *
 * Should be called daily via scheduler.
 */
cronRouter.post('/vesting-check', async (c) => {
  try {
    const now = new Date();
    console.log('[Cron] Starting vesting check at', now.toISOString());

    // ?? 1. Vest overdue articles ??????????????????????????????????????????????
    const articlesToVest = await prisma.articleVesting.findMany({
      where: {
        vesting_status: 'pending',
        vesting_date: { lte: now },
      },
    });

    let articlesVested = 0;
    for (const article of articlesToVest) {
      await prisma.articleVesting.update({
        where: { id: article.id },
        data: { vesting_status: 'vested', vested_at: now },
      });

      await prisma.vestingAuditLog.create({
        data: {
          event_type: 'article_vested',
          resource_type: 'article',
          resource_id: article.id,
          agent_email: article.agent_email,
          performed_by: 'cron',
          details: JSON.stringify({
            article_title: article.article_title,
            publication_date: article.publication_date.toISOString(),
            vesting_date: article.vesting_date.toISOString(),
          }),
        },
      });

      articlesVested++;
      console.log(`[Cron] Vested article ${article.id} for ${article.agent_email}`);
    }

    // ?? 2. Hide listings whose grace period expired ???????????????????????????
    const expiredGracePeriods = await prisma.listingGracePeriod.findMany({
      where: {
        status: 'grace',
        grace_period_end: { lte: now },
      },
    });

    let listingsHidden = 0;
    for (const gp of expiredGracePeriods) {
      await prisma.listingGracePeriod.update({
        where: { id: gp.id },
        data: { status: 'hidden', hidden_at: now },
      });

      await prisma.vestingAuditLog.create({
        data: {
          event_type: 'listing_hidden',
          resource_type: 'listing',
          resource_id: gp.id,
          agent_email: gp.agent_email,
          performed_by: 'cron',
          details: JSON.stringify({
            listing_address: gp.listing_address,
            subscription_canceled_at: gp.subscription_canceled_at.toISOString(),
            grace_period_end: gp.grace_period_end.toISOString(),
          }),
        },
      });

      listingsHidden++;
      console.log(`[Cron] Hidden listing ${gp.listing_submission_id} for ${gp.agent_email}`);
    }

    console.log(`[Cron] Vesting check complete: ${articlesVested} articles vested, ${listingsHidden} listings hidden`);

    return c.json({
      success: true,
      message: 'Vesting check completed',
      results: {
        articles_vested: articlesVested,
        listings_hidden: listingsHidden,
      },
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Vesting check error:', error);
    return c.json({ success: false, error: 'Vesting check failed' }, 500);
  }
});