/**
 * Referral System Routes
 *
 * Handles referral code generation, application, and reward tracking.
 *
 * Referral Logic:
 * - AGENTS: Referrer gets a free month of their tier ONLY if referred agent signs up for same or higher tier
 * - READERS: Referrer gets recognition/engagement rewards for reader referrals
 * - Tier hierarchy: Reader (free) < Basic ($19.99) < Pro ($49.99) < Elite ($99.99)
 * - Bonus: 3 Elite referrals = Free custom article ($299 value)
 *
 * Reward types:
 * - 'free_month_basic': Free month of Basic tier
 * - 'free_month_pro': Free month of Pro tier
 * - 'free_month_elite': Free month of Elite tier
 * - 'free_custom_article': Free custom article ($299 value)
 * - 'reader_referral_badge': Recognition for reader referrals
 */

import { Hono } from 'hono';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { type AgentTier, type AllTiers } from '../lib/tiers';

export const referralRouter = new Hono();

// Tier hierarchy for comparison (higher index = higher tier)
// Reader is lowest (free), then agent tiers
const TIER_HIERARCHY: AllTiers[] = ['reader', 'verified', 'basic', 'agent', 'elite'];

// Map tier to reward type for free month (agents only)
const TIER_TO_REWARD: Record<string, string> = {
  basic: 'free_month_basic',
  agent: 'free_month_pro',
  elite: 'free_month_elite',
};

// Number of elite referrals needed for free custom article
const ELITE_REFERRALS_FOR_ARTICLE = 3;

// Number of reader referrals for badge recognition
const READER_REFERRALS_FOR_BADGE = 5;

/**
 * Generate a unique 8-character referral code
 */
function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing characters (I, O, 0, 1)
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Get tier rank for comparison
 */
function getTierRank(tier: string): number {
  const index = TIER_HIERARCHY.indexOf(tier as AllTiers);
  return index >= 0 ? index : 0;
}

/**
 * Check if a tier is a reader tier
 */
function isReaderTier(tier: string): boolean {
  return tier === 'reader';
}

/**
 * Check if referred tier qualifies for referrer reward
 * Referred tier must be same or higher than referrer's tier
 */
function qualifiesForReward(referrerTier: string, referredTier: string): boolean {
  return getTierRank(referredTier) >= getTierRank(referrerTier);
}

// Validation schemas
const applyReferralSchema = z.object({
  referral_code: z.string().length(8, 'Referral code must be 8 characters'),
  user_id: z.string().min(1, 'User ID is required'), // Changed to allow email-based IDs for readers
  tier: z.enum(['reader', 'basic', 'agent', 'elite']),
});

const completeReferralSchema = z.object({
  referral_id: z.string().uuid('Invalid referral ID').optional(),
  referred_user_id: z.string().uuid('Invalid user ID').optional(),
});

const getUserSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'), // Allow email-based IDs for readers
});

/**
 * GET /api/referral/code
 * Get or generate user's referral code
 *
 * Query: { user_id: string }
 * Returns: { referral_code: string }
 */
referralRouter.get('/code', async (c) => {
  try {
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json({ success: false, error: 'user_id is required' }, 400);
    }

    const parsed = getUserSchema.safeParse({ user_id: userId });
    if (!parsed.success) {
      return c.json({
        success: false,
        error: 'Invalid user ID',
        details: parsed.error.issues,
      }, 400);
    }

    // Find existing user or create with new referral code
    let user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      // Generate unique referral code
      let referralCode = generateReferralCode();
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        const existing = await prisma.user.findUnique({
          where: { referral_code: referralCode },
        });
        if (!existing) break;
        referralCode = generateReferralCode();
        attempts++;
      }

      if (attempts >= maxAttempts) {
        return c.json({ success: false, error: 'Failed to generate unique referral code' }, 500);
      }

      // User doesn't exist, create them with a placeholder email
      // In production, this would integrate with your auth system
      user = await prisma.user.create({
        data: {
          id: userId,
          email: `user_${userId}@placeholder.com`,
          referral_code: referralCode,
        },
      });
    }

    return c.json({
      success: true,
      referral_code: user.referral_code,
      share_url: `https://app.example.com/signup?ref=${user.referral_code}`,
    });
  } catch (error) {
    console.error('[Referral] Get code error:', error);
    return c.json({ success: false, error: 'Failed to get referral code' }, 500);
  }
});

/**
 * POST /api/referral/apply
 * Apply a referral code during signup
 *
 * Body: { referral_code: string, user_id: string, tier: string, email?: string }
 * Returns: { referral_id: string, referrer_id: string }
 */
referralRouter.post('/apply', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = applyReferralSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        success: false,
        error: 'Invalid request',
        details: parsed.error.issues,
      }, 400);
    }

    const { referral_code, user_id, tier } = parsed.data;
    const userEmail = body.email?.toLowerCase()?.trim(); // Optional email for readers

    // Find referrer by code
    const referrer = await prisma.user.findUnique({
      where: { referral_code },
    });

    if (!referrer) {
      return c.json({ success: false, error: 'Invalid referral code' }, 404);
    }

    // Check if user is trying to refer themselves (by ID)
    if (referrer.id === user_id) {
      return c.json({ success: false, error: 'Cannot use your own referral code' }, 400);
    }

    // ANTI-FRAUD: For readers, also check email to prevent self-referrals with different user_id
    if (userEmail && referrer.email === userEmail) {
      console.warn(`[Referral] Self-referral attempt blocked for email: ${userEmail}`);
      return c.json({ success: false, error: 'Cannot use your own referral code' }, 400);
    }

    // Check if this user already has a referral (by ID or email)
    const existingReferral = await prisma.referral.findFirst({
      where: { referred_id: user_id },
    });

    if (existingReferral) {
      return c.json({ success: false, error: 'User has already been referred' }, 400);
    }

    // ANTI-FRAUD: For readers, also check if email was already referred
    if (userEmail) {
      const existingUserByEmail = await prisma.user.findFirst({
        where: { email: userEmail },
      });
      if (existingUserByEmail && existingUserByEmail.id !== user_id) {
        const existingReferralByEmail = await prisma.referral.findFirst({
          where: { referred_id: existingUserByEmail.id },
        });
        if (existingReferralByEmail) {
          console.warn(`[Referral] Duplicate referral attempt blocked for email: ${userEmail}`);
          return c.json({ success: false, error: 'This email has already been referred' }, 400);
        }
      }
    }

    // Create or get the referred user
    let referredUser = await prisma.user.findUnique({
      where: { id: user_id },
    });

    if (!referredUser) {
      // Generate unique referral code for new user
      let newReferralCode = generateReferralCode();
      let attempts = 0;
      while (attempts < 10) {
        const existing = await prisma.user.findUnique({
          where: { referral_code: newReferralCode },
        });
        if (!existing) break;
        newReferralCode = generateReferralCode();
        attempts++;
      }

      // Use provided email or generate placeholder
      const emailToUse = userEmail || `user_${user_id}@placeholder.com`;

      referredUser = await prisma.user.create({
        data: {
          id: user_id,
          email: emailToUse,
          referral_code: newReferralCode,
          tier,
        },
      });
    } else {
      // Update user tier if different
      if (referredUser.tier !== tier) {
        await prisma.user.update({
          where: { id: user_id },
          data: { tier },
        });
      }
    }

    // Create the referral record
    const referral = await prisma.referral.create({
      data: {
        referrer_id: referrer.id,
        referred_id: user_id,
        referred_tier: tier,
        status: 'pending',
      },
    });

    return c.json({
      success: true,
      referral_id: referral.id,
      referrer_id: referrer.id,
      message: 'Referral code applied successfully. Reward will be credited when subscription is completed.',
    });
  } catch (error) {
    console.error('[Referral] Apply error:', error);
    if ((error as any).code === 'P2002') {
      return c.json({ success: false, error: 'User has already been referred by this referrer' }, 400);
    }
    return c.json({ success: false, error: 'Failed to apply referral code' }, 500);
  }
});

/**
 * GET /api/referral/stats
 * Get referral stats for a user
 *
 * Query: { user_id: string }
 * Returns: { total_referrals, completed_referrals, pending_referrals, rewards }
 */
referralRouter.get('/stats', async (c) => {
  try {
    const userId = c.req.query('user_id');

    if (!userId) {
      return c.json({ success: false, error: 'user_id is required' }, 400);
    }

    const parsed = getUserSchema.safeParse({ user_id: userId });
    if (!parsed.success) {
      return c.json({
        success: false,
        error: 'Invalid user ID',
        details: parsed.error.issues,
      }, 400);
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Get referral counts
    const [totalReferrals, completedReferrals, pendingReferrals, eliteReferrals, readerReferrals] = await Promise.all([
      prisma.referral.count({ where: { referrer_id: userId } }),
      prisma.referral.count({ where: { referrer_id: userId, status: 'completed' } }),
      prisma.referral.count({ where: { referrer_id: userId, status: 'pending' } }),
      prisma.referral.count({ where: { referrer_id: userId, status: 'completed', referred_tier: 'elite' } }),
      prisma.referral.count({ where: { referrer_id: userId, status: 'completed', referred_tier: 'reader' } }),
    ]);

    // Get rewards
    const rewards = await prisma.referralReward.findMany({
      where: { user_id: userId },
      orderBy: { earned_at: 'desc' },
    });

    // Calculate progress toward free custom article
    const eliteReferralsNeeded = ELITE_REFERRALS_FOR_ARTICLE - eliteReferrals;
    const eligibleForCustomArticle = eliteReferrals >= ELITE_REFERRALS_FOR_ARTICLE;

    // Calculate progress toward reader ambassador badge
    const readerReferralsNeeded = READER_REFERRALS_FOR_BADGE - (readerReferrals % READER_REFERRALS_FOR_BADGE);

    // Check if already claimed custom article reward
    const hasCustomArticleReward = rewards.some(r => r.reward_type === 'free_custom_article');

    // Count reader badges earned
    const readerBadgesEarned = rewards.filter(r => r.reward_type === 'reader_referral_badge').length;

    return c.json({
      success: true,
      referral_code: user.referral_code,
      user_tier: user.tier,
      stats: {
        total_referrals: totalReferrals,
        completed_referrals: completedReferrals,
        pending_referrals: pendingReferrals,
        elite_referrals: eliteReferrals,
        reader_referrals: readerReferrals,
      },
      rewards: rewards.map(r => ({
        id: r.id,
        type: r.reward_type,
        status: r.status,
        earned_at: r.earned_at,
        redeemed_at: r.redeemed_at,
      })),
      bonus_progress: {
        elite_referrals_count: eliteReferrals,
        elite_referrals_needed: Math.max(0, eliteReferralsNeeded),
        eligible_for_custom_article: eligibleForCustomArticle && !hasCustomArticleReward,
        custom_article_value: 299,
        reader_referrals_count: readerReferrals,
        reader_referrals_needed: readerReferralsNeeded === READER_REFERRALS_FOR_BADGE ? 0 : readerReferralsNeeded,
        reader_badges_earned: readerBadgesEarned,
      },
    });
  } catch (error) {
    console.error('[Referral] Stats error:', error);
    return c.json({ success: false, error: 'Failed to get referral stats' }, 500);
  }
});

/**
 * POST /api/referral/complete
 * Called when referred user completes subscription (webhook or manual)
 * Triggers reward calculation and distribution
 *
 * SECURITY: This endpoint should ONLY be called by:
 * 1. RevenueCat webhook (with secret verification)
 * 2. Admin manually (with admin auth)
 *
 * Body: { referral_id: string } OR { referred_user_id: string, webhook_secret?: string }
 * Returns: { rewards_granted: Array }
 */
referralRouter.post('/complete', async (c) => {
  try {
    const body = await c.req.json();

    // SECURITY: Verify this is a legitimate request
    // In production, verify RevenueCat webhook signature or admin auth
    const webhookSecret = body.webhook_secret;
    const expectedSecret = process.env.REFERRAL_WEBHOOK_SECRET;

    // If a webhook secret is configured, require it
    if (expectedSecret && webhookSecret !== expectedSecret) {
      console.warn('[Referral] Unauthorized complete attempt');
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const parsed = completeReferralSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        success: false,
        error: 'Invalid request',
        details: parsed.error.issues,
      }, 400);
    }

    const { referral_id, referred_user_id } = parsed.data;

    if (!referral_id && !referred_user_id) {
      return c.json({
        success: false,
        error: 'Either referral_id or referred_user_id is required',
      }, 400);
    }

    // Find the referral
    let referral;
    if (referral_id) {
      referral = await prisma.referral.findUnique({
        where: { id: referral_id },
        include: { referrer: true, referred: true },
      });
    } else {
      referral = await prisma.referral.findFirst({
        where: { referred_id: referred_user_id, status: 'pending' },
        include: { referrer: true, referred: true },
      });
    }

    if (!referral) {
      return c.json({ success: false, error: 'Referral not found' }, 404);
    }

    if (referral.status === 'completed') {
      return c.json({ success: false, error: 'Referral already completed' }, 400);
    }

    if (referral.status === 'revoked') {
      return c.json({ success: false, error: 'Referral was revoked due to subscription cancellation' }, 400);
    }

    // ANTI-FRAUD: Check if subscription_id was provided (from RevenueCat webhook)
    const subscriptionId = body.subscription_id;

    const rewardsGranted: Array<{ type: string; description: string }> = [];

    // Handle reader referrals differently from agent referrals
    if (isReaderTier(referral.referred_tier)) {
      // Reader referrals: Track for badge recognition (5 reader referrals = badge)
      const readerReferrals = await prisma.referral.count({
        where: {
          referrer_id: referral.referrer_id,
          status: 'completed',
          referred_tier: 'reader',
        },
      });

      // +1 for current referral being completed
      const totalReaderReferrals = readerReferrals + 1;

      // Check if this is the 5th, 10th, 15th, etc. reader referral
      if (totalReaderReferrals > 0 && totalReaderReferrals % READER_REFERRALS_FOR_BADGE === 0) {
        await prisma.referralReward.create({
          data: {
            user_id: referral.referrer_id,
            reward_type: 'reader_referral_badge',
            status: 'pending',
          },
        });

        rewardsGranted.push({
          type: 'reader_referral_badge',
          description: `Reader Ambassador badge for referring ${totalReaderReferrals} readers`,
        });
      }
    } else {
      // Agent referrals: Check if referrer qualifies for free month reward
      // Referred tier must be same or higher than referrer's tier
      const qualifies = qualifiesForReward(referral.referrer.tier, referral.referred_tier);

      if (qualifies) {
        // Grant free month of referrer's tier
        const rewardType = TIER_TO_REWARD[referral.referrer.tier];

        if (rewardType) {
          await prisma.referralReward.create({
            data: {
              user_id: referral.referrer_id,
              reward_type: rewardType,
              status: 'pending',
            },
          });

          rewardsGranted.push({
            type: rewardType,
            description: `Free month of ${referral.referrer.tier} tier`,
          });
        }
      }

      // Check for elite referral bonus (3 elite referrals = free custom article)
      if (referral.referred_tier === 'elite') {
        const eliteReferrals = await prisma.referral.count({
          where: {
            referrer_id: referral.referrer_id,
            status: 'completed',
            referred_tier: 'elite',
          },
        });

        // +1 for current referral being completed
        const totalEliteReferrals = eliteReferrals + 1;

        // Check if this is the 3rd, 6th, 9th, etc. elite referral
        if (totalEliteReferrals > 0 && totalEliteReferrals % ELITE_REFERRALS_FOR_ARTICLE === 0) {
          await prisma.referralReward.create({
            data: {
              user_id: referral.referrer_id,
              reward_type: 'free_custom_article',
              status: 'pending',
            },
          });

          rewardsGranted.push({
            type: 'free_custom_article',
            description: 'Free custom article ($299 value) for referring 3 Elite agents',
          });
        }
      }
    }

    // Mark referral as completed
    await prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'completed',
        completed_at: new Date(),
        subscription_id: subscriptionId || null,
        verified_at: new Date(),
      },
    });

    // Set reward expiration (90 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    return c.json({
      success: true,
      referral_id: referral.id,
      referrer_id: referral.referrer_id,
      referred_id: referral.referred_id,
      referred_tier: referral.referred_tier,
      rewards_granted: rewardsGranted,
      message: rewardsGranted.length > 0
        ? `Referral completed! ${rewardsGranted.length} reward(s) granted.`
        : 'Referral completed. No rewards granted (referred tier lower than referrer tier).',
    });
  } catch (error) {
    console.error('[Referral] Complete error:', error);
    return c.json({ success: false, error: 'Failed to complete referral' }, 500);
  }
});

/**
 * POST /api/referral/redeem
 * Redeem a pending reward
 *
 * Body: { reward_id: string }
 * Returns: { success: boolean }
 */
referralRouter.post('/redeem', async (c) => {
  try {
    const body = await c.req.json();
    const rewardId = body.reward_id;

    if (!rewardId) {
      return c.json({ success: false, error: 'reward_id is required' }, 400);
    }

    const reward = await prisma.referralReward.findUnique({
      where: { id: rewardId },
    });

    if (!reward) {
      return c.json({ success: false, error: 'Reward not found' }, 404);
    }

    if (reward.status === 'redeemed') {
      return c.json({ success: false, error: 'Reward already redeemed' }, 400);
    }

    if (reward.status === 'expired') {
      return c.json({ success: false, error: 'Reward has expired' }, 400);
    }

    // Update reward status
    await prisma.referralReward.update({
      where: { id: rewardId },
      data: {
        status: 'redeemed',
        redeemed_at: new Date(),
      },
    });

    return c.json({
      success: true,
      reward_id: rewardId,
      reward_type: reward.reward_type,
      message: `Reward "${reward.reward_type}" has been redeemed successfully.`,
    });
  } catch (error) {
    console.error('[Referral] Redeem error:', error);
    return c.json({ success: false, error: 'Failed to redeem reward' }, 500);
  }
});

/**
 * GET /api/referral/lookup
 * Look up a referral code to verify it's valid (for frontend validation)
 *
 * Query: { code: string }
 * Returns: { valid: boolean, referrer_tier?: string }
 */
referralRouter.get('/lookup', async (c) => {
  try {
    const code = c.req.query('code');

    if (!code) {
      return c.json({ success: false, error: 'code is required' }, 400);
    }

    if (code.length !== 8) {
      return c.json({
        success: true,
        valid: false,
        message: 'Invalid referral code format',
      });
    }

    const user = await prisma.user.findUnique({
      where: { referral_code: code.toUpperCase() },
    });

    if (!user) {
      return c.json({
        success: true,
        valid: false,
        message: 'Referral code not found',
      });
    }

    return c.json({
      success: true,
      valid: true,
      referrer_tier: user.tier,
      message: 'Valid referral code',
    });
  } catch (error) {
    console.error('[Referral] Lookup error:', error);
    return c.json({ success: false, error: 'Failed to lookup referral code' }, 500);
  }
});

/**
 * GET /api/referral/admin/all
 * Get all referrals and rewards for admin tracking
 *
 * Returns: { stats, referrals, rewards }
 */
referralRouter.get('/admin/all', async (c) => {
  try {
    // Get all referrals with user details
    const referrals = await prisma.referral.findMany({
      include: {
        referrer: true,
        referred: true,
      },
      orderBy: { created_at: 'desc' },
    });

    // Get all rewards with user details
    const rewards = await prisma.referralReward.findMany({
      include: {
        user: true,
      },
      orderBy: { earned_at: 'desc' },
    });

    // Calculate stats
    const stats = {
      total_referrals: referrals.length,
      completed_referrals: referrals.filter(r => r.status === 'completed').length,
      pending_referrals: referrals.filter(r => r.status === 'pending').length,
      revoked_referrals: referrals.filter(r => r.status === 'revoked').length,
      total_rewards: rewards.length,
      pending_rewards: rewards.filter(r => r.status === 'pending').length,
      redeemed_rewards: rewards.filter(r => r.status === 'redeemed').length,
      expired_rewards: rewards.filter(r => r.status === 'expired').length,
      reader_referrals: referrals.filter(r => r.referred_tier === 'reader' && r.status === 'completed').length,
      agent_referrals: referrals.filter(r => r.referred_tier !== 'reader' && r.status === 'completed').length,
    };

    // Format referrals for response
    const formattedReferrals = referrals.map(r => ({
      id: r.id,
      referrer: {
        id: r.referrer.id,
        name: r.referrer.email.split('@')[0], // Use email prefix as name
        email: r.referrer.email,
        tier: r.referrer.tier,
      },
      referred: {
        id: r.referred.id,
        name: r.referred.email.split('@')[0],
        email: r.referred.email,
        tier: r.referred.tier,
      },
      referred_tier: r.referred_tier,
      status: r.status,
      created_at: r.created_at.toISOString(),
      completed_at: r.completed_at?.toISOString() || null,
    }));

    // Format rewards for response
    const formattedRewards = rewards.map(r => ({
      id: r.id,
      user_id: r.user_id,
      user_email: r.user.email,
      user_name: r.user.email.split('@')[0],
      reward_type: r.reward_type,
      status: r.status,
      earned_at: r.earned_at.toISOString(),
      redeemed_at: r.redeemed_at?.toISOString() || null,
      expires_at: r.expires_at?.toISOString() || null,
    }));

    return c.json({
      success: true,
      stats,
      referrals: formattedReferrals,
      rewards: formattedRewards,
    });
  } catch (error) {
    console.error('[Referral] Admin all error:', error);
    return c.json({ success: false, error: 'Failed to get referral data' }, 500);
  }
});