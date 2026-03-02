/**
 * Subscription & Tier Validation Routes
 *
 * These endpoints help validate user entitlements and article credits.
 * The actual subscription state is managed by RevenueCat on the client,
 * but these endpoints provide server-side validation for sensitive operations.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import prisma from '../lib/prisma';
import {
  AGENT_TIERS,
  ENTITLEMENTS,
  getTierConfig,
  getWelcomeArticleCredit,
  canUseWelcomeCredit,
  getRemainingWelcomeCredits,
  type AgentTier,
} from '../lib/tiers';
import {
  checkListingCredits,
  checkArticleCredits,
  addPurchasedListingCredits,
  addPurchasedArticleCredits,
} from '../lib/credits';
import {
  authenticateByEmail,
  auditLog,
  getClientIP,
  isTransactionProcessed,
  markTransactionProcessed,
  verifyWebhookAuth,
} from '../lib/security';

export const subscriptionRouter = new Hono();

// Schema for validating article credit requests
const articleCreditSchema = z.object({
  tier: z.enum(['verified', 'basic', 'agent', 'elite']),
  creditsUsed: z.number().min(0),
});

// Schema for validating tier access
const tierAccessSchema = z.object({
  tier: z.enum(['verified', 'basic', 'agent', 'elite']),
  feature: z.string(),
});

/**
 * GET /api/subscription/tiers
 * Returns all available tier configurations
 */
subscriptionRouter.get('/tiers', (c) => {
  return c.json({
    success: true,
    tiers: AGENT_TIERS,
    entitlements: ENTITLEMENTS,
  });
});

/**
 * GET /api/subscription/tier/:tierId
 * Returns configuration for a specific tier
 */
subscriptionRouter.get('/tier/:tierId', (c) => {
  const tierId = c.req.param('tierId') as AgentTier;

  if (!AGENT_TIERS[tierId]) {
    return c.json({ success: false, error: 'Invalid tier' }, 400);
  }

  const config = getTierConfig(tierId);
  return c.json({
    success: true,
    tier: config,
  });
});

/**
 * POST /api/subscription/validate-article-credit
 * Validates if a user can use their welcome article credit
 *
 * Body: { tier: AgentTier, creditsUsed: number }
 * Returns: { canUse: boolean, remaining: number }
 */
subscriptionRouter.post('/validate-article-credit', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = articleCreditSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        success: false,
        error: 'Invalid request',
        details: parsed.error.issues
      }, 400);
    }

    const { tier, creditsUsed } = parsed.data;
    const canUse = canUseWelcomeCredit(tier, creditsUsed);
    const remaining = getRemainingWelcomeCredits(tier, creditsUsed);
    const welcomeCredit = getWelcomeArticleCredit(tier);

    return c.json({
      success: true,
      tier,
      welcomeCredit,
      creditsUsed,
      canUse,
      remaining,
      message: canUse
        ? `You have ${remaining} welcome article credit(s) available.`
        : tier === 'elite'
          ? 'You have already used your welcome article credit.'
          : 'Welcome article credits are only available for Elite tier.',
    });
  } catch (error) {
    console.error('[Subscription] Validate article credit error:', error);
    return c.json({ success: false, error: 'Invalid request body' }, 400);
  }
});

/**
 * POST /api/subscription/validate-access
 * Validates if a tier has access to a specific feature
 *
 * Body: { tier: AgentTier, feature: string }
 * Returns: { hasAccess: boolean, tierRequired: string | null }
 */
subscriptionRouter.post('/validate-access', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = tierAccessSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        success: false,
        error: 'Invalid request',
        details: parsed.error.issues
      }, 400);
    }

    const { tier, feature } = parsed.data;
    const config = getTierConfig(tier);

    // Feature access mapping
    const featureAccess: Record<string, AgentTier[]> = {
      'ai_tools': ['basic', 'agent', 'elite'],
      'market_reports': ['basic', 'agent', 'elite'],
      'parcel_map': ['basic', 'agent', 'elite'],
      'featured_listings': ['agent', 'elite'],
      'article_credit': ['elite'],
      'priority_support': ['elite'],
    };

    const allowedTiers = featureAccess[feature] || [];
    const hasAccess = allowedTiers.includes(tier);

    // Find minimum required tier for this feature
    let tierRequired: AgentTier | null = null;
    if (!hasAccess && allowedTiers.length > 0) {
      const tierOrder: AgentTier[] = ['verified', 'basic', 'agent', 'elite'];
      tierRequired = tierOrder.find(t => allowedTiers.includes(t)) || null;
    }

    return c.json({
      success: true,
      feature,
      currentTier: tier,
      hasAccess,
      tierRequired,
      message: hasAccess
        ? `Your ${config.name} plan includes ${feature}.`
        : tierRequired
          ? `Upgrade to ${AGENT_TIERS[tierRequired].name} to access ${feature}.`
          : 'This feature is not available.',
    });
  } catch (error) {
    console.error('[Subscription] Validate access error:', error);
    return c.json({ success: false, error: 'Invalid request body' }, 400);
  }
});

/**
 * GET /api/subscription/entitlements-summary
 * Returns a summary of what each tier is entitled to
 */
subscriptionRouter.get('/entitlements-summary', (c) => {
  const summary = Object.entries(AGENT_TIERS).map(([tierId, config]) => ({
    tier: tierId,
    name: config.name,
    price: config.price,
    entitlements: {
      aiTools: config.hasAI,
      featuredListings: config.featuredListings,
      maxActiveListings: config.maxActiveListings,
      welcomeArticleCredit: config.welcomeArticleCredit || 0,
      extraListingFee: config.extraListingFee,
    },
  }));

  return c.json({
    success: true,
    tiers: summary,
    note: 'Elite tier includes 1 welcome article credit (one-time upon subscription).',
  });
});

// ============================================================================
// SUBSCRIPTION RECORDING (called from mobile app after RevenueCat purchase)
// ============================================================================

/**
 * Map a RevenueCat product ID to our plan type and MRR amount
 */
function mapProductToPlan(productId: string): { planType: string; mrrAmount: number } {
  const lower = productId.toLowerCase();

  if (lower.includes('elite')) return { planType: 'elite', mrrAmount: 99.99 };
  if (lower.includes('agent') || lower.includes('pro') || lower.includes('monthly_v2')) return { planType: 'agent', mrrAmount: 49.99 };
  if (lower.includes('basic')) return { planType: 'basic', mrrAmount: 19.99 };
  if (lower.includes('premium') || lower.includes('reader')) return { planType: 'reader_premium', mrrAmount: 19.99 };

  // Default fallback
  return { planType: 'reader_premium', mrrAmount: 19.99 };
}

/**
 * POST /api/subscription/record
 * Records a subscription purchase in the backend database.
 * Called from the mobile app after a successful RevenueCat purchase.
 *
 * Body: {
 *   email: string,
 *   product_id: string,          // RevenueCat product ID
 *   revenuecat_id?: string,      // RevenueCat subscription/transaction ID
 *   user_type?: 'reader' | 'agent',
 *   source?: string,
 * }
 */
subscriptionRouter.post('/record', async (c) => {
  try {
    const body = await c.req.json();
    const { email, product_id, revenuecat_id, user_type, source } = body;

    if (!email || !product_id) {
      return c.json({ success: false, error: 'email and product_id are required' }, 400);
    }

    const emailLower = email.toLowerCase().trim();
    const { planType, mrrAmount } = mapProductToPlan(product_id);

    console.log(`[Subscription] Recording purchase: ${emailLower} ? ${planType} ($${mrrAmount}/mo), product: ${product_id}`);

    // Find the user by email
    const user = await prisma.user.findUnique({ where: { email: emailLower } });

    if (!user) {
      console.warn(`[Subscription] User not found for email: ${emailLower}, creating subscription record without user link`);
      // Still create the subscription record even without a user, using a placeholder user_id
      // This shouldn't happen in practice since users register before purchasing
      return c.json({ success: false, error: 'User not found for email' }, 404);
    }

    // Check if there's already an active subscription for this user
    const existingSub = await prisma.subscription.findFirst({
      where: {
        user_id: user.id,
        status: { in: ['active', 'trialing'] },
      },
    });

    if (existingSub) {
      // Update existing subscription (e.g., tier upgrade)
      const updatedSub = await prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          plan_type: planType,
          status: 'active',
          mrr_amount: mrrAmount,
          revenuecat_id: revenuecat_id || existingSub.revenuecat_id,
          current_period_start: new Date(),
          source: source || existingSub.source,
        },
      });

      // Update user tier
      await prisma.user.update({
        where: { id: user.id },
        data: { tier: planType },
      });

      console.log(`[Subscription] Updated existing subscription ${existingSub.id} for ${emailLower} ? ${planType}`);

      return c.json({
        success: true,
        data: {
          subscription_id: updatedSub.id,
          plan_type: planType,
          status: 'active',
          mrr_amount: mrrAmount,
          is_new: false,
        },
      });
    }

    // Create new subscription
    const newSub = await prisma.subscription.create({
      data: {
        user_id: user.id,
        plan_type: planType,
        status: 'active',
        mrr_amount: mrrAmount,
        revenuecat_id: revenuecat_id || null,
        current_period_start: new Date(),
        source: source || 'organic',
      },
    });

    // Update user tier
    await prisma.user.update({
      where: { id: user.id },
      data: { tier: planType },
    });

    // Track the event
    await prisma.event.create({
      data: {
        user_id: user.id,
        event_name: 'subscription_started',
        market: user.market_primary,
        event_properties: JSON.stringify({
          plan_type: planType,
          product_id,
          mrr_amount: mrrAmount,
        }),
      },
    });

    console.log(`[Subscription] Created new subscription ${newSub.id} for ${emailLower} ? ${planType}`);

    // ?? Reactivate listings that were in grace/hidden status ?????????????????
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

      await prisma.vestingAuditLog.create({
        data: {
          event_type: 'listing_reactivated',
          resource_type: 'listing',
          resource_id: gp.id,
          agent_email: emailLower,
          performed_by: 'system',
          details: JSON.stringify({ reason: 'resubscribed' }),
        },
      });
    }

    // Also restore hidden articles if agent resubscribes within vesting window
    const hiddenArticles = await prisma.articleVesting.findMany({
      where: {
        agent_email: emailLower,
        vesting_status: 'hidden',
        hidden_reason: 'subscription_canceled',
      },
    });

    for (const article of hiddenArticles) {
      // Only restore if they still haven't reached their vesting date
      if (article.vesting_date > new Date()) {
        await prisma.articleVesting.update({
          where: { id: article.id },
          data: { vesting_status: 'pending', hidden_at: null, hidden_reason: null },
        });

        await prisma.vestingAuditLog.create({
          data: {
            event_type: 'article_restored',
            resource_type: 'article',
            resource_id: article.id,
            agent_email: emailLower,
            performed_by: 'system',
            details: JSON.stringify({ reason: 'resubscribed' }),
          },
        });
      }
    }
    // ??????????????????????????????????????????????????????????????????????????

    return c.json({
      success: true,
      data: {
        subscription_id: newSub.id,
        plan_type: planType,
        status: 'active',
        mrr_amount: mrrAmount,
        is_new: true,
        listings_reactivated: gracePeriods.length,
        articles_restored: hiddenArticles.filter((a) => a.vesting_date > new Date()).length,
      },
    });
  } catch (error) {
    console.error('[Subscription] Record error:', error);
    return c.json({ success: false, error: 'Failed to record subscription' }, 500);
  }
});

subscriptionRouter.post('/cancel', async (c) => {
  try {
    const body = await c.req.json();
    const { email, reason } = body;

    if (!email) {
      return c.json({ success: false, error: 'email is required' }, 400);
    }

    const emailLower = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: emailLower } });

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Find active subscription
    const activeSub = await prisma.subscription.findFirst({
      where: {
        user_id: user.id,
        status: { in: ['active', 'trialing'] },
      },
    });

    if (!activeSub) {
      return c.json({ success: false, error: 'No active subscription found' }, 404);
    }

    await prisma.subscription.update({
      where: { id: activeSub.id },
      data: {
        status: 'canceled',
        canceled_at: new Date(),
        cancel_reason: reason || null,
        current_period_end: new Date(),
      },
    });

    // ?? Vesting logic on cancellation ?????????????????????????????????????????
    const now = new Date();

    // 1. Hide non-vested articles immediately; vest any that have passed their date
    const pendingArticles = await prisma.articleVesting.findMany({
      where: { agent_email: emailLower, vesting_status: 'pending' },
    });

    let articlesHidden = 0;
    let articlesVested = 0;

    for (const article of pendingArticles) {
      if (article.vesting_date <= now) {
        // Already past vesting date � vest it
        await prisma.articleVesting.update({
          where: { id: article.id },
          data: { vesting_status: 'vested', vested_at: now },
        });
        await prisma.vestingAuditLog.create({
          data: {
            event_type: 'article_vested',
            resource_type: 'article',
            resource_id: article.id,
            agent_email: emailLower,
            performed_by: 'system',
            details: JSON.stringify({ reason: 'vesting_date_passed_at_cancellation' }),
          },
        });
        articlesVested++;
      } else {
        // Not yet vested � hide immediately
        await prisma.articleVesting.update({
          where: { id: article.id },
          data: { vesting_status: 'hidden', hidden_at: now, hidden_reason: 'subscription_canceled' },
        });
        await prisma.vestingAuditLog.create({
          data: {
            event_type: 'article_hidden',
            resource_type: 'article',
            resource_id: article.id,
            agent_email: emailLower,
            performed_by: 'system',
            details: JSON.stringify({ reason: 'subscription_canceled_before_vesting' }),
          },
        });
        articlesHidden++;
      }
    }

    // 2. Start 30-day grace period for all active listings
    const approvedListings = await prisma.agentListingSubmission.findMany({
      where: { agent_email: emailLower, status: 'approved' },
    });

    const gracePeriodEnd = new Date(now);
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 30);
    let listingGraceStarted = 0;

    for (const listing of approvedListings) {
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
          subscription_canceled_at: now,
          grace_period_end: gracePeriodEnd,
          status: 'grace',
        },
      });

      await prisma.vestingAuditLog.create({
        data: {
          event_type: 'listing_grace_started',
          resource_type: 'listing',
          resource_id: gracePeriod.id,
          agent_email: emailLower,
          performed_by: 'system',
          details: JSON.stringify({ grace_period_end: gracePeriodEnd.toISOString() }),
        },
      });

      listingGraceStarted++;
    }
    // ??????????????????????????????????????????????????????????????????????????

    // Track the event
    await prisma.event.create({
      data: {
        user_id: user.id,
        event_name: 'subscription_canceled',
        market: user.market_primary,
        event_properties: JSON.stringify({
          plan_type: activeSub.plan_type,
          reason,
          articles_hidden: articlesHidden,
          articles_vested: articlesVested,
          listing_grace_periods_started: listingGraceStarted,
        }),
      },
    });

    console.log(`[Subscription] Canceled subscription for ${emailLower}. Articles hidden: ${articlesHidden}, vested: ${articlesVested}, listing grace periods: ${listingGraceStarted}`);

    return c.json({
      success: true,
      vesting_summary: {
        articles_hidden_immediately: articlesHidden,
        articles_vested_permanently: articlesVested,
        listings_in_grace_period: listingGraceStarted,
        listing_grace_period_ends: gracePeriodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      },
    });
  } catch (error) {
    console.error('[Subscription] Cancel error:', error);
    return c.json({ success: false, error: 'Failed to cancel subscription' }, 500);
  }
});

// ============================================================================
// CREDIT STATUS & MANAGEMENT (Server-side source of truth)
// ============================================================================

/**
 * GET /api/subscription/credits/:email
 * Get the server-side credit status for a user
 * This is the source of truth for credits - client should sync from here
 */
subscriptionRouter.get('/credits/:email', async (c) => {
  try {
    const email = c.req.param('email');
    if (!email) {
      return c.json({ success: false, error: 'Email is required' }, 400);
    }

    const emailLower = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: emailLower },
      select: {
        id: true,
        email: true,
        tier: true,
        role: true,
        listing_credits_used: true,
        article_credits_used: true,
        purchased_listing_credits: true,
        purchased_article_credits: true,
      },
    });

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Get detailed credit status
    const [listingCredits, articleCredits] = await Promise.all([
      checkListingCredits(user.id),
      checkArticleCredits(user.id),
    ]);

    return c.json({
      success: true,
      data: {
        email: user.email,
        tier: user.tier,
        role: user.role,
        listingCredits: {
          available: listingCredits.creditsAvailable,
          used: listingCredits.creditsUsed,
          totalAllocation: listingCredits.totalAllocation,
          purchased: listingCredits.purchasedCredits,
          canSubmit: listingCredits.canSubmit,
          requiresExtraFee: listingCredits.requiresExtraFee,
          extraFee: listingCredits.extraFee,
        },
        articleCredits: {
          available: articleCredits.creditsAvailable,
          used: articleCredits.creditsUsed,
          totalAllocation: articleCredits.totalAllocation,
          purchased: articleCredits.purchasedCredits,
          canSubmit: articleCredits.canSubmit,
          requiresExtraFee: articleCredits.requiresExtraFee,
          extraFee: articleCredits.extraFee,
        },
      },
    });
  } catch (error) {
    console.error('[Subscription] Credits fetch error:', error);
    return c.json({ success: false, error: 'Failed to fetch credit status' }, 500);
  }
});

/**
 * POST /api/subscription/credits/add-listing
 * Add purchased listing credits to a user account
 * Called after successful IAP ($49.99 per credit)
 *
 * SECURITY: Requires webhook auth or valid transaction verification
 */
subscriptionRouter.post('/credits/add-listing', async (c) => {
  const clientIP = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') || 'unknown';

  try {
    // Verify webhook authentication
    const authHeader = c.req.header('Authorization');
    const webhookSecret = process.env.REVENUECAT_WEBHOOK_AUTH;

    if (!webhookSecret || !verifyWebhookAuth(authHeader, webhookSecret)) {
      await auditLog({
        action: 'credit_add_listing_unauthorized',
        resource: 'credits',
        ipAddress: clientIP,
        success: false,
        errorMessage: 'Invalid or missing authorization',
      });
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { email, quantity, transaction_id } = body;

    if (!email || !quantity || !transaction_id) {
      return c.json({ success: false, error: 'email, quantity, and transaction_id are required' }, 400);
    }

    // Idempotency check - prevent duplicate processing
    if (isTransactionProcessed(transaction_id)) {
      console.log(`[Credits] Transaction ${transaction_id} already processed, skipping`);
      return c.json({
        success: true,
        data: { message: 'Transaction already processed', transactionId: transaction_id },
      });
    }

    const emailLower = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: emailLower } });

    if (!user) {
      await auditLog({
        action: 'credit_add_listing_user_not_found',
        resource: 'credits',
        details: { email: emailLower },
        ipAddress: clientIP,
        success: false,
        errorMessage: 'User not found',
      });
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Use transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Add the purchased credits
      await tx.user.update({
        where: { id: user.id },
        data: { purchased_listing_credits: { increment: quantity } },
      });

      // Record the monetization transaction
      await tx.monetization.create({
        data: {
          user_id: user.id,
          type: 'listing_credit_purchase',
          amount: 49.99 * quantity,
          market: user.market_primary,
          status: 'paid',
        },
      });

      return { success: true };
    });

    // Mark transaction as processed (idempotency)
    markTransactionProcessed(transaction_id);

    // Audit log
    await auditLog({
      userId: user.id,
      action: 'credit_add_listing',
      resource: 'credits',
      details: { quantity, transactionId: transaction_id },
      ipAddress: clientIP,
      success: true,
    });

    console.log(`[Credits] Added ${quantity} listing credit(s) to ${emailLower}, transaction: ${transaction_id}`);

    // Return updated credit status
    const updatedCredits = await checkListingCredits(user.id);

    return c.json({
      success: true,
      data: {
        creditsAdded: quantity,
        newTotal: updatedCredits.creditsAvailable,
      },
    });
  } catch (error) {
    console.error('[Subscription] Add listing credits error:', error);
    await auditLog({
      action: 'credit_add_listing_error',
      resource: 'credits',
      ipAddress: clientIP,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    return c.json({ success: false, error: 'Failed to add listing credits' }, 500);
  }
});

/**
 * POST /api/subscription/credits/add-article
 * Add purchased article credits to a user account
 * Called after successful IAP ($299 per credit)
 *
 * SECURITY: Requires webhook auth or valid transaction verification
 */
subscriptionRouter.post('/credits/add-article', async (c) => {
  const clientIP = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') || 'unknown';

  try {
    // Verify webhook authentication
    const authHeader = c.req.header('Authorization');
    const webhookSecret = process.env.REVENUECAT_WEBHOOK_AUTH;

    if (!webhookSecret || !verifyWebhookAuth(authHeader, webhookSecret)) {
      await auditLog({
        action: 'credit_add_article_unauthorized',
        resource: 'credits',
        ipAddress: clientIP,
        success: false,
        errorMessage: 'Invalid or missing authorization',
      });
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { email, quantity, transaction_id } = body;

    if (!email || !quantity || !transaction_id) {
      return c.json({ success: false, error: 'email, quantity, and transaction_id are required' }, 400);
    }

    // Idempotency check - prevent duplicate processing
    if (isTransactionProcessed(transaction_id)) {
      console.log(`[Credits] Transaction ${transaction_id} already processed, skipping`);
      return c.json({
        success: true,
        data: { message: 'Transaction already processed', transactionId: transaction_id },
      });
    }

    const emailLower = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: emailLower } });

    if (!user) {
      await auditLog({
        action: 'credit_add_article_user_not_found',
        resource: 'credits',
        details: { email: emailLower },
        ipAddress: clientIP,
        success: false,
        errorMessage: 'User not found',
      });
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Use transaction for atomicity
    await prisma.$transaction(async (tx) => {
      // Add the purchased credits
      await tx.user.update({
        where: { id: user.id },
        data: { purchased_article_credits: { increment: quantity } },
      });

      // Record the monetization transaction
      await tx.monetization.create({
        data: {
          user_id: user.id,
          type: 'article_credit_purchase',
          amount: 299 * quantity,
          market: user.market_primary,
          status: 'paid',
        },
      });
    });

    // Mark transaction as processed (idempotency)
    markTransactionProcessed(transaction_id);

    // Audit log
    await auditLog({
      userId: user.id,
      action: 'credit_add_article',
      resource: 'credits',
      details: { quantity, transactionId: transaction_id },
      ipAddress: clientIP,
      success: true,
    });

    console.log(`[Credits] Added ${quantity} article credit(s) to ${emailLower}, transaction: ${transaction_id}`);

    // Return updated credit status
    const updatedCredits = await checkArticleCredits(user.id);

    return c.json({
      success: true,
      data: {
        creditsAdded: quantity,
        newTotal: updatedCredits.creditsAvailable,
      },
    });
  } catch (error) {
    console.error('[Subscription] Add article credits error:', error);
    await auditLog({
      action: 'credit_add_article_error',
      resource: 'credits',
      ipAddress: clientIP,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    return c.json({ success: false, error: 'Failed to add article credits' }, 500);
  }
});