/**
 * Referral System Types
 *
 * Shared types for the referral system to ensure type safety
 * between backend and frontend.
 */

// =============================================================================
// Enums and Constants
// =============================================================================

/** Valid agent tiers for referral rewards */
export type AgentTier = 'verified' | 'basic' | 'agent' | 'elite';

/** Tier hierarchy for comparison (higher index = higher tier) */
export const TIER_HIERARCHY: AgentTier[] = ['verified', 'basic', 'agent', 'elite'];

/** Reward types for referral system */
export type RewardType =
  | 'free_month_basic'
  | 'free_month_pro'
  | 'free_month_elite'
  | 'free_custom_article';

/** Status of a referral */
export type ReferralStatus = 'pending' | 'completed' | 'expired';

/** Status of a reward */
export type RewardStatus = 'pending' | 'redeemed' | 'expired';

// =============================================================================
// Request Types
// =============================================================================

/** GET /api/referral/code query params */
export interface GetReferralCodeRequest {
  user_id: string;
}

/** POST /api/referral/apply body */
export interface ApplyReferralRequest {
  referral_code: string;
  user_id: string;
  tier: 'basic' | 'agent' | 'elite';
}

/** GET /api/referral/stats query params */
export interface GetReferralStatsRequest {
  user_id: string;
}

/** POST /api/referral/complete body */
export interface CompleteReferralRequest {
  referral_id?: string;
  referred_user_id?: string;
}

/** POST /api/referral/redeem body */
export interface RedeemRewardRequest {
  reward_id: string;
}

/** GET /api/referral/lookup query params */
export interface LookupReferralCodeRequest {
  code: string;
}

// =============================================================================
// Response Types
// =============================================================================

/** Base response structure */
export interface BaseResponse {
  success: boolean;
  error?: string;
  details?: Array<{ path: string[]; message: string }>;
}

/** GET /api/referral/code response */
export interface GetReferralCodeResponse extends BaseResponse {
  referral_code?: string;
  share_url?: string;
}

/** POST /api/referral/apply response */
export interface ApplyReferralResponse extends BaseResponse {
  referral_id?: string;
  referrer_id?: string;
  message?: string;
}

/** Reward info in stats response */
export interface RewardInfo {
  id: string;
  type: RewardType;
  status: RewardStatus;
  earned_at: string;
  redeemed_at: string | null;
}

/** Bonus progress info */
export interface BonusProgress {
  elite_referrals_count: number;
  elite_referrals_needed: number;
  eligible_for_custom_article: boolean;
  custom_article_value: number;
}

/** GET /api/referral/stats response */
export interface GetReferralStatsResponse extends BaseResponse {
  referral_code?: string;
  user_tier?: AgentTier;
  stats?: {
    total_referrals: number;
    completed_referrals: number;
    pending_referrals: number;
    elite_referrals: number;
  };
  rewards?: RewardInfo[];
  bonus_progress?: BonusProgress;
}

/** Reward granted info */
export interface RewardGranted {
  type: RewardType;
  description: string;
}

/** POST /api/referral/complete response */
export interface CompleteReferralResponse extends BaseResponse {
  referral_id?: string;
  referrer_id?: string;
  referred_id?: string;
  referred_tier?: AgentTier;
  rewards_granted?: RewardGranted[];
  message?: string;
}

/** POST /api/referral/redeem response */
export interface RedeemRewardResponse extends BaseResponse {
  reward_id?: string;
  reward_type?: RewardType;
  message?: string;
}

/** GET /api/referral/lookup response */
export interface LookupReferralCodeResponse extends BaseResponse {
  valid?: boolean;
  referrer_tier?: AgentTier;
  message?: string;
}

// =============================================================================
// Database Model Types (for internal use)
// =============================================================================

/** User model */
export interface User {
  id: string;
  email: string;
  referral_code: string;
  tier: AgentTier;
  created_at: Date;
  updated_at: Date;
}

/** Referral model */
export interface Referral {
  id: string;
  referrer_id: string;
  referred_id: string;
  referred_tier: AgentTier;
  status: ReferralStatus;
  created_at: Date;
  completed_at: Date | null;
}

/** ReferralReward model */
export interface ReferralReward {
  id: string;
  user_id: string;
  reward_type: RewardType;
  status: RewardStatus;
  earned_at: Date;
  redeemed_at: Date | null;
}

// =============================================================================
// Helper Types
// =============================================================================

/** Tier pricing information */
export interface TierPricing {
  basic: number;
  agent: number;
  elite: number;
}

export const TIER_PRICES: TierPricing = {
  basic: 19.99,
  agent: 49.99,
  elite: 99.99,
};

/** Number of elite referrals required for free custom article */
export const ELITE_REFERRALS_FOR_ARTICLE = 3;

/** Custom article value in dollars */
export const CUSTOM_ARTICLE_VALUE = 299;