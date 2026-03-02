/**
 * Credit System - Server-side validation and management
 *
 * This module handles all credit-related operations with proper server-side validation.
 * Credits are the source of truth on the backend - client-side is only for display.
 */

import prisma from './prisma';
import { AGENT_TIERS, type AgentTier } from './tiers';

// ============================================================================
// TYPES
// ============================================================================

export interface CreditCheckResult {
  canSubmit: boolean;
  creditsAvailable: number;
  creditsUsed: number;
  totalAllocation: number;
  purchasedCredits: number;
  requiresExtraFee: boolean;
  extraFee?: number;
  reason?: string;
}

export interface CreditDeductionResult {
  success: boolean;
  newCreditsUsed: number;
  newPurchasedCredits: number;
  error?: string;
}

// ============================================================================
// LISTING CREDITS
// ============================================================================

/**
 * Get listing credit allocation for a tier
 * - verified: 0 listings
 * - basic: 0 listings
 * - agent (Pro): 2 listings
 * - elite: 6 listings
 */
export function getListingAllocation(tier: AgentTier): number {
  return AGENT_TIERS[tier]?.featuredListings || 0;
}

/**
 * Check if user can submit a listing
 * Returns detailed information about credit availability
 */
export async function checkListingCredits(userId: string): Promise<CreditCheckResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tier: true,
      role: true,
      listing_credits_used: true,
      purchased_listing_credits: true,
    },
  });

  if (!user) {
    return {
      canSubmit: false,
      creditsAvailable: 0,
      creditsUsed: 0,
      totalAllocation: 0,
      purchasedCredits: 0,
      requiresExtraFee: false,
      reason: 'User not found',
    };
  }

  // Only agents can submit listings
  if (user.role !== 'agent' && user.role !== 'admin') {
    return {
      canSubmit: false,
      creditsAvailable: 0,
      creditsUsed: 0,
      totalAllocation: 0,
      purchasedCredits: 0,
      requiresExtraFee: false,
      reason: 'Only agents can submit listings',
    };
  }

  const tier = user.tier as AgentTier;
  const tierAllocation = getListingAllocation(tier);
  const purchasedCredits = user.purchased_listing_credits;
  const totalAllocation = tierAllocation + purchasedCredits;
  const creditsUsed = user.listing_credits_used;
  const creditsAvailable = Math.max(0, totalAllocation - creditsUsed);

  // Check if tier allows listings at all
  if (tier === 'verified' || tier === 'basic') {
    return {
      canSubmit: false,
      creditsAvailable: 0,
      creditsUsed,
      totalAllocation: 0,
      purchasedCredits,
      requiresExtraFee: false,
      reason: 'Upgrade to Pro or Elite to submit listings',
    };
  }

  // Admin can always submit
  if (user.role === 'admin') {
    return {
      canSubmit: true,
      creditsAvailable: 999,
      creditsUsed,
      totalAllocation: 999,
      purchasedCredits,
      requiresExtraFee: false,
    };
  }

  if (creditsAvailable > 0) {
    return {
      canSubmit: true,
      creditsAvailable,
      creditsUsed,
      totalAllocation,
      purchasedCredits,
      requiresExtraFee: false,
    };
  }

  // No credits available - require extra fee
  const extraFee = AGENT_TIERS[tier]?.extraListingFee || 49.99;
  return {
    canSubmit: false,
    creditsAvailable: 0,
    creditsUsed,
    totalAllocation,
    purchasedCredits,
    requiresExtraFee: true,
    extraFee,
    reason: `You've used all ${totalAllocation} listing credits. Purchase additional credits ($${extraFee} each) to submit more.`,
  };
}

/**
 * Deduct a listing credit from user
 * Call this AFTER successfully creating the listing
 */
export async function deductListingCredit(userId: string): Promise<CreditDeductionResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      listing_credits_used: true,
      purchased_listing_credits: true,
      tier: true,
      role: true,
    },
  });

  if (!user) {
    return { success: false, newCreditsUsed: 0, newPurchasedCredits: 0, error: 'User not found' };
  }

  // Admin bypass
  if (user.role === 'admin') {
    return { success: true, newCreditsUsed: user.listing_credits_used, newPurchasedCredits: user.purchased_listing_credits };
  }

  const tier = user.tier as AgentTier;
  const tierAllocation = getListingAllocation(tier);
  const currentUsed = user.listing_credits_used;
  const purchasedCredits = user.purchased_listing_credits;

  // Determine if we're using tier allocation or purchased credits
  const tierCreditsRemaining = Math.max(0, tierAllocation - currentUsed);

  let newCreditsUsed = currentUsed;
  let newPurchasedCredits = purchasedCredits;

  if (tierCreditsRemaining > 0) {
    // Use tier allocation
    newCreditsUsed = currentUsed + 1;
  } else if (purchasedCredits > 0) {
    // Use purchased credit
    newPurchasedCredits = purchasedCredits - 1;
  } else {
    return { success: false, newCreditsUsed: currentUsed, newPurchasedCredits: purchasedCredits, error: 'No credits available' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      listing_credits_used: newCreditsUsed,
      purchased_listing_credits: newPurchasedCredits,
    },
  });

  return { success: true, newCreditsUsed, newPurchasedCredits };
}

// ============================================================================
// ARTICLE CREDITS
// ============================================================================

/**
 * Get article credit allocation for a tier
 * Only Elite gets a welcome article credit (1)
 */
export function getArticleAllocation(tier: AgentTier): number {
  return AGENT_TIERS[tier]?.welcomeArticleCredit || 0;
}

/**
 * Check if user can submit an article
 */
export async function checkArticleCredits(userId: string): Promise<CreditCheckResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tier: true,
      role: true,
      article_credits_used: true,
      purchased_article_credits: true,
    },
  });

  if (!user) {
    return {
      canSubmit: false,
      creditsAvailable: 0,
      creditsUsed: 0,
      totalAllocation: 0,
      purchasedCredits: 0,
      requiresExtraFee: false,
      reason: 'User not found',
    };
  }

  // Only agents can submit articles
  if (user.role !== 'agent' && user.role !== 'admin') {
    return {
      canSubmit: false,
      creditsAvailable: 0,
      creditsUsed: 0,
      totalAllocation: 0,
      purchasedCredits: 0,
      requiresExtraFee: false,
      reason: 'Only agents can submit articles',
    };
  }

  const tier = user.tier as AgentTier;
  const tierAllocation = getArticleAllocation(tier);
  const purchasedCredits = user.purchased_article_credits;
  const totalAllocation = tierAllocation + purchasedCredits;
  const creditsUsed = user.article_credits_used;
  const creditsAvailable = Math.max(0, totalAllocation - creditsUsed);

  // Admin can always submit
  if (user.role === 'admin') {
    return {
      canSubmit: true,
      creditsAvailable: 999,
      creditsUsed,
      totalAllocation: 999,
      purchasedCredits,
      requiresExtraFee: false,
    };
  }

  if (creditsAvailable > 0) {
    return {
      canSubmit: true,
      creditsAvailable,
      creditsUsed,
      totalAllocation,
      purchasedCredits,
      requiresExtraFee: false,
    };
  }

  // No credits available
  return {
    canSubmit: false,
    creditsAvailable: 0,
    creditsUsed,
    totalAllocation,
    purchasedCredits,
    requiresExtraFee: true,
    extraFee: 299,
    reason: 'No article credits available. Purchase additional credits ($299 each) to submit articles.',
  };
}

/**
 * Deduct an article credit from user
 * Call this AFTER successfully creating the article request
 */
export async function deductArticleCredit(userId: string): Promise<CreditDeductionResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      article_credits_used: true,
      purchased_article_credits: true,
      tier: true,
      role: true,
    },
  });

  if (!user) {
    return { success: false, newCreditsUsed: 0, newPurchasedCredits: 0, error: 'User not found' };
  }

  // Admin bypass
  if (user.role === 'admin') {
    return { success: true, newCreditsUsed: user.article_credits_used, newPurchasedCredits: user.purchased_article_credits };
  }

  const tier = user.tier as AgentTier;
  const tierAllocation = getArticleAllocation(tier);
  const currentUsed = user.article_credits_used;
  const purchasedCredits = user.purchased_article_credits;

  // Determine if we're using tier allocation or purchased credits
  const tierCreditsRemaining = Math.max(0, tierAllocation - currentUsed);

  let newCreditsUsed = currentUsed;
  let newPurchasedCredits = purchasedCredits;

  if (tierCreditsRemaining > 0) {
    // Use tier allocation (welcome credit)
    newCreditsUsed = currentUsed + 1;
  } else if (purchasedCredits > 0) {
    // Use purchased credit
    newPurchasedCredits = purchasedCredits - 1;
  } else {
    return { success: false, newCreditsUsed: currentUsed, newPurchasedCredits: purchasedCredits, error: 'No credits available' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      article_credits_used: newCreditsUsed,
      purchased_article_credits: newPurchasedCredits,
    },
  });

  return { success: true, newCreditsUsed, newPurchasedCredits };
}

// ============================================================================
// CREDIT PURCHASES
// ============================================================================

/**
 * Add purchased listing credits to user account
 * Called after successful IAP ($49.99 per credit)
 */
export async function addPurchasedListingCredits(userId: string, quantity: number = 1): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        purchased_listing_credits: { increment: quantity },
      },
    });
    console.log(`[Credits] Added ${quantity} purchased listing credit(s) to user ${userId}`);
    return true;
  } catch (error) {
    console.error('[Credits] Failed to add purchased listing credits:', error);
    return false;
  }
}

/**
 * Add purchased article credits to user account
 * Called after successful IAP ($299 per credit)
 */
export async function addPurchasedArticleCredits(userId: string, quantity: number = 1): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        purchased_article_credits: { increment: quantity },
      },
    });
    console.log(`[Credits] Added ${quantity} purchased article credit(s) to user ${userId}`);
    return true;
  } catch (error) {
    console.error('[Credits] Failed to add purchased article credits:', error);
    return false;
  }
}

// ============================================================================
// DUPLICATE DETECTION
// ============================================================================

/**
 * Check for duplicate listing submission
 * Prevents submitting the same listing multiple times
 * Note: SQLite is case-insensitive by default for ASCII, so we normalize to lowercase
 */
export async function isDuplicateListing(
  agentEmail: string,
  address: string,
  village: string,
): Promise<{ isDuplicate: boolean; existingId?: string }> {
  // SQLite: normalize to lowercase for comparison
  const existing = await prisma.agentListingSubmission.findFirst({
    where: {
      agent_email: agentEmail.toLowerCase(),
      address: address.toLowerCase(),
      village: village.toLowerCase(),
      status: { in: ['pending', 'approved'] },
    },
    select: { id: true },
  });

  return {
    isDuplicate: !!existing,
    existingId: existing?.id,
  };
}

/**
 * Check for duplicate article submission
 * Prevents submitting the same article request multiple times
 */
export async function isDuplicateArticle(
  agentEmail: string,
  headline: string,
): Promise<{ isDuplicate: boolean; existingId?: string }> {
  // Normalize headline for comparison
  const normalizedHeadline = headline.toLowerCase().trim();

  // SQLite: fetch recent articles and compare manually for case-insensitive match
  const recentArticles = await prisma.agentArticleRequest.findMany({
    where: {
      agent_email: agentEmail.toLowerCase(),
      status: { in: ['pending', 'in_progress'] },
    },
    select: { id: true, headline: true },
  });

  const existing = recentArticles.find(
    (a) => a.headline.toLowerCase().trim() === normalizedHeadline
  );

  return {
    isDuplicate: !!existing,
    existingId: existing?.id,
  };
}

// ============================================================================
// USER AUTHENTICATION HELPERS
// ============================================================================

/**
 * Verify user exists and return their info
 * Used for submission endpoint authentication
 */
export async function verifyAgentByEmail(email: string): Promise<{
  valid: boolean;
  user?: {
    id: string;
    email: string;
    tier: string;
    role: string;
    name: string | null;
  };
  error?: string;
}> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      tier: true,
      role: true,
      name: true,
      agent_verification_status: true,
    },
  });

  if (!user) {
    return { valid: false, error: 'User not found' };
  }

  // Check if user is an approved agent
  if (user.role !== 'agent' && user.role !== 'admin') {
    return { valid: false, error: 'User is not a registered agent' };
  }

  // Check verification status for agents
  if (user.role === 'agent' && user.agent_verification_status !== 'approved') {
    return { valid: false, error: 'Agent verification is pending or not approved' };
  }

  return {
    valid: true,
    user: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      role: user.role,
      name: user.name,
    },
  };
}

/**
 * Get user's current credit status
 * For display purposes on the client
 */
export async function getUserCreditStatus(userId: string): Promise<{
  listingCredits: CreditCheckResult;
  articleCredits: CreditCheckResult;
}> {
  const [listingCredits, articleCredits] = await Promise.all([
    checkListingCredits(userId),
    checkArticleCredits(userId),
  ]);

  return { listingCredits, articleCredits };
}