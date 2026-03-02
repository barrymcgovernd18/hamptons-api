/**
 * Webhook Handlers
 *
 * Handles incoming webhooks from external services like RevenueCat.
 * These endpoints complete the referral flow when subscriptions are verified.
 *
 * SECURITY:
 * - Verifies webhook signatures using HMAC or Bearer token
 * - Implements idempotency to prevent duplicate processing
 * - Logs all webhook events for audit trail
 */

import crypto from 'crypto';
import { Hono } from 'hono';
import prisma from '../lib/prisma';

export const webhooksRouter = new Hono();

// ============================================================================
// SECURITY: Idempotency tracking for webhooks
// ============================================================================
const processedWebhooks = new Map<string, Date>();

function isWebhookProcessed(eventId: string): boolean {
  return processedWebhooks.has(eventId);
}

function markWebhookProcessed(eventId: string): void {
  processedWebhooks.set(eventId, new Date());
  // Clean up entries older than 24 hours
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const [id, date] of processedWebhooks.entries()) {
    if (date < cutoff) {
      processedWebhooks.delete(id);
    }
  }
}

/**
 * Verify webhook signature using timing-safe comparison
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  // RevenueCat uses Bearer token, but we also support HMAC for future use
  // Check Bearer token first
  if (signature.startsWith('Bearer ')) {
    const token = signature.substring(7);
    try {
      return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(secret)
      );
    } catch {
      return false;
    }
  }

  // HMAC signature verification
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// ============================================================================
// SUBSCRIPTION RECORDING FROM WEBHOOKS
// ============================================================================

/**
 * Map a RevenueCat product ID to our plan type and MRR amount
 */
function mapProductToPlan(productId: string): { planType: string; mrrAmount: number } {
  if (!productId) return { planType: 'reader_premium', mrrAmount: 19.99 };
  const lower = productId.toLowerCase();

  if (lower.includes('elite')) return { planType: 'elite', mrrAmount: 99.99 };
  if (lower.includes('agent') || lower.includes('pro') || lower.includes('monthly_v2')) return { planType: 'agent', mrrAmount: 49.99 };
  if (lower.includes('basic')) return { planType: 'basic', mrrAmount: 19.99 };
  if (lower.includes('premium') || lower.includes('reader')) return { planType: 'reader_premium', mrrAmount: 19.99 };

  return { planType: 'reader_premium', mrrAmount: 19.99 };
}

/**
 * Record or update a subscription in the database based on a webhook event.
 * The appUserId is the RevenueCat app_user_id which we set to the user's email.
 */
async function recordSubscriptionFromWebhook(
  eventType: string,
  appUserId: string,
  productId: string,
  transactionId: string | null,
) {
  try {
    // appUserId is typically the user's email (set via Purchases.logIn)
    // Try to find the user by email first, then by id
    let user = await prisma.user.findUnique({ where: { email: appUserId.toLowerCase() } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { id: appUserId } });
    }

    if (!user) {
      console.log(`[Webhook] No user found for appUserId: ${appUserId}, skipping subscription record`);
      return;
    }

    const { planType, mrrAmount } = mapProductToPlan(productId);

    if (SUBSCRIPTION_ACTIVE_EVENTS.includes(eventType)) {
      // Find existing subscription for this user
      const existingSub = await prisma.subscription.findFirst({
        where: { user_id: user.id },
        orderBy: { created_at: 'desc' },
      });

      if (existingSub) {
        await prisma.subscription.update({
          where: { id: existingSub.id },
          data: {
            plan_type: planType,
            status: 'active',
            mrr_amount: mrrAmount,
            revenuecat_id: transactionId || existingSub.revenuecat_id,
            current_period_start: new Date(),
          },
        });
        console.log(`[Webhook] Updated subscription for ${user.email} ? ${planType} ($${mrrAmount}/mo)`);
      } else {
        await prisma.subscription.create({
          data: {
            user_id: user.id,
            plan_type: planType,
            status: 'active',
            mrr_amount: mrrAmount,
            revenuecat_id: transactionId || null,
            current_period_start: new Date(),
            source: 'organic',
          },
        });
        console.log(`[Webhook] Created subscription for ${user.email} ? ${planType} ($${mrrAmount}/mo)`);
      }

      // Update user tier
      await prisma.user.update({
        where: { id: user.id },
        data: { tier: planType },
      });

    } else if (SUBSCRIPTION_CANCELLED_EVENTS.includes(eventType) || REFUND_EVENTS.includes(eventType)) {
      // Mark subscription as canceled
      const activeSub = await prisma.subscription.findFirst({
        where: { user_id: user.id, status: { in: ['active', 'trialing'] } },
      });

      if (activeSub) {
        const newStatus = REFUND_EVENTS.includes(eventType) ? 'expired' : 'canceled';
        await prisma.subscription.update({
          where: { id: activeSub.id },
          data: {
            status: newStatus,
            canceled_at: new Date(),
            current_period_end: new Date(),
            cancel_reason: eventType,
          },
        });
        console.log(`[Webhook] Marked subscription ${newStatus} for ${user.email} (${eventType})`);
      }

      // Reset user tier to verified
      await prisma.user.update({
        where: { id: user.id },
        data: { tier: 'verified' },
      });
    }
  } catch (error) {
    // Don't let subscription recording failures break the webhook
    console.error('[Webhook] Failed to record subscription:', error);
  }
}

// RevenueCat event types that indicate a successful subscription
const SUBSCRIPTION_ACTIVE_EVENTS = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
];

// RevenueCat event types that indicate subscription was cancelled/refunded
const SUBSCRIPTION_CANCELLED_EVENTS = [
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
];

// RevenueCat event types that indicate a refund (revoke rewards)
const REFUND_EVENTS = [
  'REFUND', // iOS refund
  'NON_RENEWING_PURCHASE_REFUND',
];

/**
 * POST /api/webhooks/revenuecat
 *
 * Handles RevenueCat subscription webhooks.
 * Documentation: https://www.revenuecat.com/docs/webhooks
 *
 * SECURITY:
 * - Requires valid Authorization header
 * - Implements idempotency to prevent duplicate processing
 * - Logs all events for audit trail
 */
webhooksRouter.post('/revenuecat', async (c) => {
  const clientIP = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') || 'unknown';

  try {
    // Get raw body for signature verification
    const rawBody = await c.req.text();
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.warn('[Webhook] Invalid JSON body');
      return c.json({ success: false, error: 'Invalid JSON' }, 400);
    }

    // =========================================================================
    // SECURITY: Verify webhook authorization
    // =========================================================================
    const authHeader = c.req.header('Authorization');
    const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH;

    if (!expectedAuth) {
      console.error('[Webhook] CRITICAL: REVENUECAT_WEBHOOK_AUTH not configured!');
      return c.json({ success: false, error: 'Webhook not configured' }, 500);
    }

    if (!verifyWebhookSignature(rawBody, authHeader, expectedAuth)) {
      console.warn(`[Webhook] Unauthorized RevenueCat webhook attempt from IP: ${clientIP}`);
      console.log(`[AUDIT][WARN] action=webhook_unauthorized resource=revenuecat ip=${clientIP}`);
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const event = body.event;
    if (!event) {
      return c.json({ success: false, error: 'Missing event data' }, 400);
    }

    const eventType = event.type;
    const eventId = event.id || `${event.app_user_id}_${event.type}_${Date.now()}`;
    const appUserId = event.app_user_id;
    const productId = event.product_id;
    const originalTransactionId = event.original_transaction_id;

    // =========================================================================
    // SECURITY: Idempotency check - prevent duplicate processing
    // =========================================================================
    if (isWebhookProcessed(eventId)) {
      console.log(`[Webhook] Event ${eventId} already processed, skipping`);
      return c.json({
        success: true,
        message: 'Event already processed',
        eventId,
      });
    }

    console.log(`[Webhook] RevenueCat event: ${eventType} for user ${appUserId}, product: ${productId}`);
    console.log(`[AUDIT][INFO] action=webhook_received resource=revenuecat eventType=${eventType} userId=${appUserId} ip=${clientIP}`);

    // =========================================================================
    // STEP 1: Record/update the subscription in our database for ALL events
    // This ensures we track every paid subscriber regardless of referral status
    // =========================================================================
    await recordSubscriptionFromWebhook(eventType, appUserId, productId, originalTransactionId);

    // Mark as processed AFTER successful recording
    markWebhookProcessed(eventId);

    // =========================================================================
    // STEP 2: Handle referral-specific logic
    // =========================================================================

    // Check if this user was referred (look up by app_user_id)
    const referral = await prisma.referral.findFirst({
      where: {
        referred_id: appUserId,
        status: { in: ['pending', 'completed'] }
      },
      include: { referrer: true, referred: true },
    });

    if (!referral) {
      // No referral for this user � subscription is already recorded above
      return c.json({
        success: true,
        message: `Event ${eventType} processed, subscription recorded, no referral found`
      });
    }

    // Handle subscription activation (grant rewards)
    if (SUBSCRIPTION_ACTIVE_EVENTS.includes(eventType)) {
      if (referral.status === 'completed') {
        return c.json({
          success: true,
          message: 'Referral already completed'
        });
      }

      // Determine the tier from the product ID
      const tier = getTierFromProductId(productId);

      if (!tier) {
        console.warn(`[Webhook] Unknown product ID: ${productId}`);
        return c.json({
          success: true,
          message: 'Event processed, unknown product tier'
        });
      }

      // Update the referral with subscription info
      await prisma.referral.update({
        where: { id: referral.id },
        data: {
          referred_tier: tier,
          subscription_id: originalTransactionId,
        },
      });

      // Check if referrer qualifies for reward
      const referrerTierRank = getTierRank(referral.referrer.tier);
      const referredTierRank = getTierRank(tier);

      if (referredTierRank >= referrerTierRank) {
        // Grant free month reward
        const rewardType = getRewardTypeForTier(referral.referrer.tier);

        if (rewardType) {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 90);

          await prisma.referralReward.create({
            data: {
              user_id: referral.referrer_id,
              reward_type: rewardType,
              status: 'pending',
              expires_at: expiresAt,
            },
          });

          console.log(`[Webhook] Granted ${rewardType} to referrer ${referral.referrer_id}`);
        }

        // Check for elite referral bonus (3 elite = free article)
        if (tier === 'elite') {
          const eliteCount = await prisma.referral.count({
            where: {
              referrer_id: referral.referrer_id,
              status: 'completed',
              referred_tier: 'elite',
            },
          });

          // +1 for current referral
          if ((eliteCount + 1) % 3 === 0) {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 90);

            await prisma.referralReward.create({
              data: {
                user_id: referral.referrer_id,
                reward_type: 'free_custom_article',
                status: 'pending',
                expires_at: expiresAt,
              },
            });

            console.log(`[Webhook] Granted free article to referrer ${referral.referrer_id} for 3 elite referrals`);
          }
        }
      }

      // Mark referral as completed
      await prisma.referral.update({
        where: { id: referral.id },
        data: {
          status: 'completed',
          completed_at: new Date(),
          verified_at: new Date(),
        },
      });

      return c.json({
        success: true,
        message: 'Referral completed, rewards granted'
      });
    }

    // Handle refunds (revoke referral and rewards)
    if (REFUND_EVENTS.includes(eventType)) {
      console.log(`[Webhook] Processing refund for referral ${referral.id}`);

      // Revoke the referral
      await prisma.referral.update({
        where: { id: referral.id },
        data: {
          status: 'revoked',
        },
      });

      // Expire any pending rewards from this referral
      // Note: In a more complex system, you'd track which rewards came from which referral
      console.log(`[Webhook] Revoked referral ${referral.id} due to refund`);

      return c.json({
        success: true,
        message: 'Referral revoked due to refund'
      });
    }

    // Handle cancellations (mark for potential revocation if within trial period)
    if (SUBSCRIPTION_CANCELLED_EVENTS.includes(eventType)) {
      // Check if subscription was active for minimum required days
      const completedAt = referral.completed_at;
      if (completedAt) {
        const daysSinceCompletion = Math.floor(
          (Date.now() - new Date(completedAt).getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceCompletion < referral.min_subscription_days) {
          console.log(`[Webhook] Revoking referral ${referral.id} - cancelled within ${daysSinceCompletion} days`);

          await prisma.referral.update({
            where: { id: referral.id },
            data: {
              status: 'revoked',
            },
          });

          return c.json({
            success: true,
            message: 'Referral revoked due to early cancellation'
          });
        }
      }

      return c.json({
        success: true,
        message: 'Cancellation processed, referral retained (past minimum period)'
      });
    }

    return c.json({
      success: true,
      message: `Event ${eventType} processed`
    });

  } catch (error) {
    console.error('[Webhook] RevenueCat error:', error);
    return c.json({ success: false, error: 'Webhook processing failed' }, 500);
  }
});

/**
 * Map RevenueCat product IDs to our tier system
 */
function getTierFromProductId(productId: string): string | null {
  if (!productId) return null;

  const productLower = productId.toLowerCase();

  if (productLower.includes('elite')) return 'elite';
  if (productLower.includes('pro') || productLower.includes('agent')) return 'agent';
  if (productLower.includes('basic')) return 'basic';
  if (productLower.includes('premium')) return 'basic'; // Reader premium = basic agent equivalent

  return null;
}

/**
 * Get tier rank for comparison
 */
function getTierRank(tier: string): number {
  const hierarchy = ['verified', 'basic', 'agent', 'elite'];
  const index = hierarchy.indexOf(tier);
  return index >= 0 ? index : 0;
}

/**
 * Map tier to reward type
 */
function getRewardTypeForTier(tier: string): string | null {
  const mapping: Record<string, string> = {
    basic: 'free_month_basic',
    agent: 'free_month_pro',
    elite: 'free_month_elite',
  };
  return mapping[tier] || null;
}