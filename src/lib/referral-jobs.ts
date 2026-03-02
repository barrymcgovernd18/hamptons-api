/**
 * Referral Fraud Detection & Cleanup Jobs
 *
 * These functions should be called periodically (e.g., daily via cron)
 * to maintain referral system integrity.
 */

import prisma from '../lib/prisma';

/**
 * Expire old rewards that haven't been redeemed
 * Should be run daily
 */
export async function expireOldRewards(): Promise<{ expired: number }> {
  const now = new Date();

  const result = await prisma.referralReward.updateMany({
    where: {
      status: 'pending',
      expires_at: {
        lt: now,
      },
    },
    data: {
      status: 'expired',
    },
  });

  console.log(`[Cron] Expired ${result.count} rewards`);
  return { expired: result.count };
}

/**
 * Revoke referrals where the referred user cancelled within the minimum period
 * This catches cases where the webhook might have been missed
 * Should be run daily
 */
export async function revokeEarlyCancellations(): Promise<{ revoked: number }> {
  // Find all completed referrals
  const completedReferrals = await prisma.referral.findMany({
    where: {
      status: 'completed',
      completed_at: {
        not: null,
      },
    },
    include: {
      referred: true,
    },
  });

  let revokedCount = 0;

  for (const referral of completedReferrals) {
    const completedAt = referral.completed_at;
    if (!completedAt) continue;

    const daysSinceCompletion = Math.floor(
      (Date.now() - new Date(completedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    // If the referral was completed recently (within minimum period),
    // we should verify the subscription is still active
    // This would integrate with RevenueCat API in production
    if (daysSinceCompletion < referral.min_subscription_days) {
      // In production, you would call RevenueCat API here to verify subscription status
      // For now, we just log that this referral should be verified
      console.log(`[Cron] Referral ${referral.id} is within minimum period, should verify subscription`);
    }
  }

  console.log(`[Cron] Checked ${completedReferrals.length} referrals, revoked ${revokedCount}`);
  return { revoked: revokedCount };
}

/**
 * Expire pending referrals that are too old (30 days)
 * If someone signed up with a referral code but never subscribed
 */
export async function expireOldPendingReferrals(): Promise<{ expired: number }> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await prisma.referral.updateMany({
    where: {
      status: 'pending',
      created_at: {
        lt: thirtyDaysAgo,
      },
    },
    data: {
      status: 'expired',
    },
  });

  console.log(`[Cron] Expired ${result.count} pending referrals`);
  return { expired: result.count };
}

/**
 * Detect suspicious referral patterns
 * Returns users with potentially fraudulent activity
 */
export async function detectSuspiciousPatterns(): Promise<{
  flagged: Array<{
    userId: string;
    reason: string;
    referralCount: number;
  }>;
}> {
  const flagged: Array<{ userId: string; reason: string; referralCount: number }> = [];

  // Check for users with unusually high referral velocity (more than 10 in a week)
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const highVelocityUsers = await prisma.referral.groupBy({
    by: ['referrer_id'],
    where: {
      created_at: {
        gte: oneWeekAgo,
      },
    },
    _count: {
      id: true,
    },
    having: {
      id: {
        _count: {
          gt: 10,
        },
      },
    },
  });

  for (const user of highVelocityUsers) {
    flagged.push({
      userId: user.referrer_id,
      reason: 'High referral velocity (>10 in one week)',
      referralCount: user._count.id,
    });
  }

  // Check for users whose referrals have high cancellation rates
  const usersWithReferrals = await prisma.user.findMany({
    where: {
      referrals_made: {
        some: {},
      },
    },
    include: {
      referrals_made: true,
    },
  });

  for (const user of usersWithReferrals) {
    const totalReferrals = user.referrals_made.length;
    if (totalReferrals < 3) continue; // Need at least 3 to detect pattern

    const revokedCount = user.referrals_made.filter(r => r.status === 'revoked').length;
    const revokeRate = revokedCount / totalReferrals;

    if (revokeRate > 0.5) {
      flagged.push({
        userId: user.id,
        reason: `High revocation rate (${Math.round(revokeRate * 100)}%)`,
        referralCount: totalReferrals,
      });
    }
  }

  if (flagged.length > 0) {
    console.log(`[Cron] Flagged ${flagged.length} users for suspicious activity`);
  }

  return { flagged };
}

/**
 * Run all cleanup jobs
 * Call this from a cron endpoint or scheduled task
 */
export async function runAllCleanupJobs(): Promise<{
  expiredRewards: number;
  revokedReferrals: number;
  expiredPending: number;
  flaggedUsers: number;
}> {
  console.log('[Cron] Starting referral cleanup jobs...');

  const [rewards, revoked, pending, suspicious] = await Promise.all([
    expireOldRewards(),
    revokeEarlyCancellations(),
    expireOldPendingReferrals(),
    detectSuspiciousPatterns(),
  ]);

  console.log('[Cron] Cleanup jobs completed');

  return {
    expiredRewards: rewards.expired,
    revokedReferrals: revoked.revoked,
    expiredPending: pending.expired,
    flaggedUsers: suspicious.flagged.length,
  };
}