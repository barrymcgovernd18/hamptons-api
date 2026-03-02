/**
 * Agent Tier Configuration - Backend Reference
 *
 * This mirrors the frontend types for server-side validation.
 * Keep in sync with mobile/src/lib/types.ts
 */

export type AgentTier = 'verified' | 'basic' | 'agent' | 'elite';

// Reader tier type (separate from agent tiers)
export type ReaderTier = 'reader';

// Combined tier type for referral system
export type AllTiers = AgentTier | ReaderTier;

export interface AgentTierConfig {
  id: AgentTier;
  name: string;
  price: number;
  featuredListings: number;
  maxActiveListings: number;
  extraListingFee: number;
  welcomeArticleCredit?: number; // One-time credit upon signup (Elite only)
  hasAI: boolean;
}

// Agent tier configurations matching RevenueCat entitlements
export const AGENT_TIERS: Record<AgentTier, AgentTierConfig> = {
  verified: {
    id: 'verified',
    name: 'Verified Agent',
    price: 0,
    featuredListings: 0,
    maxActiveListings: 0,
    extraListingFee: 0,
    hasAI: false,
  },
  basic: {
    id: 'basic',
    name: 'Basic Agent',
    price: 19.99,
    featuredListings: 0,
    maxActiveListings: 0,
    extraListingFee: 0,
    hasAI: true, // Gets AI tools access
  },
  agent: {
    id: 'agent',
    name: 'Pro Agent',
    price: 49.99,
    featuredListings: 2, // 2 to start + 1/month
    maxActiveListings: 2,
    extraListingFee: 49.99,
    hasAI: true,
  },
  elite: {
    id: 'elite',
    name: 'Elite Agent',
    price: 99.99,
    featuredListings: 6,
    maxActiveListings: 6,
    extraListingFee: 49.99,
    welcomeArticleCredit: 1, // One-time welcome credit
    hasAI: true,
  },
};

// RevenueCat Entitlement IDs
export const ENTITLEMENTS = {
  PREMIUM: 'premium',
  BASIC_AGENT: 'basic_agent',
  AGENT: 'agent',
  ELITE_AGENT: 'elite_agent',
};

// RevenueCat Package IDs
export const PACKAGES = {
  PREMIUM_USER_MONTHLY: '$rc_custom_premium_reader_monthly',
  BASIC_AGENT_MONTHLY: '$rc_custom_basic_monthly',
  AGENT_MONTHLY: '$rc_monthly_v2',
  ELITE_AGENT_MONTHLY: '$rc_custom_elite_monthly',
};

/**
 * Reader tier configuration
 * Readers get free access, referral rewards are for engagement/recognition
 */
export const READER_TIER_CONFIG = {
  id: 'reader' as ReaderTier,
  name: 'Reader',
  price: 0, // Free subscription
  description: 'Access to all articles across all markets',
};

/**
 * Get tier config by tier ID
 */
export function getTierConfig(tier: AgentTier): AgentTierConfig {
  return AGENT_TIERS[tier];
}

/**
 * Check if a tier has AI access
 */
export function tierHasAI(tier: AgentTier): boolean {
  return AGENT_TIERS[tier].hasAI;
}

/**
 * Get the welcome article credit for a tier (one-time)
 */
export function getWelcomeArticleCredit(tier: AgentTier): number {
  return AGENT_TIERS[tier].welcomeArticleCredit || 0;
}

/**
 * Check if user can use their welcome article credit
 * @param tier - The user's current tier
 * @param creditsUsed - Number of free credits already used
 */
export function canUseWelcomeCredit(tier: AgentTier, creditsUsed: number): boolean {
  const welcomeCredit = getWelcomeArticleCredit(tier);
  return creditsUsed < welcomeCredit;
}

/**
 * Get remaining welcome credits
 */
export function getRemainingWelcomeCredits(tier: AgentTier, creditsUsed: number): number {
  const welcomeCredit = getWelcomeArticleCredit(tier);
  return Math.max(0, welcomeCredit - creditsUsed);
}