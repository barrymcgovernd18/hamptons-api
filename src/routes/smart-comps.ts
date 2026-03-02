/**
 * Smart Comp Analysis API v4
 * 
 * Two modes:
 * 1. VALUATION MODE (no price): Estimates property value from comps
 * 2. COMP MODE (with price): Finds comparable sales around a given price
 * 
 * Both use micro-market based search with full Hamptons market intelligence.
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  classifyAddress,
  areComparable,
  LocationClassification,
  COMP_REGIONS,
  OCEANFRONT_COMP_REGIONS,
  FALLBACK_REGIONS,
  HAMLET_TIERS,
  HAMLET_BASE_VALUES,
  TIER_RANK,
  STREET_PREMIUMS,
  WATERFRONT_PREMIUMS,
  TIME_ADJUSTMENTS,
  PRICE_FILTERS,
  SCORING,
  type MarketTier,
  type WaterfrontType,
} from "../data/hamptons-market-data.js";

const smartCompsRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tfzkenrmzoxrkdntkada.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmemtlbnJtem94cmtkbnRrYWRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5OTc0OTcsImV4cCI6MjA4MzU3MzQ5N30.6IxBDHMp0TbeJdRr0114fdnsCHyrRoaIcyG5jKdPAV8";
const envKey = process.env.SUPABASE_ANON_KEY;
const SUPABASE_KEY = (envKey && envKey.startsWith("eyJ")) ? envKey : SUPABASE_ANON;

// =============================================================================
// HELPERS
// =============================================================================

function normalize(s: string): string {
  return (s || "").toLowerCase().trim();
}

function getMarketTier(village: string): MarketTier {
  return HAMLET_TIERS[normalize(village)] || "core";
}

function getTimeAdjustment(soldDate: string | null): number {
  if (!soldDate) return 1.0;
  const year = soldDate.substring(0, 4);
  return TIME_ADJUSTMENTS[year] || 1.0;
}

function getDaysAgo(soldDate: string | null): number {
  if (!soldDate) return 999;
  return Math.floor((Date.now() - new Date(soldDate).getTime()) / (1000 * 60 * 60 * 24));
}

function getPriceFilter(price: number) {
  if (price >= 20_000_000) return PRICE_FILTERS["20m_plus"];
  if (price >= 10_000_000) return PRICE_FILTERS["10m_20m"];
  if (price >= 5_000_000) return PRICE_FILTERS["5m_10m"];
  return PRICE_FILTERS["under_5m"];
}

// =============================================================================
// CONDITION DETECTION (from price/sqft ratio vs market avg)
// =============================================================================

type PropertyCondition = "teardown" | "needs_renovation" | "normal" | "new_construction" | "unknown";

function detectCondition(pricePerSqft: number | null, village: string): PropertyCondition {
  if (!pricePerSqft) return "unknown";
  const vill = normalize(village);
  // Average price/sqft by area type
  const isSpring = vill === "springs";
  const avgPpsf = isSpring ? 500 : 1000; // $500/sqft Springs, $1000/sqft standard Hamptons

  const ratio = pricePerSqft / avgPpsf;
  if (ratio < 0.40) return "teardown";
  if (ratio < 0.65) return "needs_renovation";
  if (ratio > 1.50) return "new_construction";
  return "normal";
}

// =============================================================================
// CONSTRUCTION COST ESTIMATION
// =============================================================================

const CONSTRUCTION_COSTS = {
  standard_hamptons: { standard: 800, high_end: 1200, ultra_luxury: 1800 },
  springs: { standard: 400, high_end: 600, ultra_luxury: 900 },
};

function getConstructionCost(village: string): { standard: number; high_end: number; ultra_luxury: number } {
  return normalize(village) === "springs" ? CONSTRUCTION_COSTS.springs : CONSTRUCTION_COSTS.standard_hamptons;
}

// =============================================================================
// FLIP DETECTION (same address sold twice within 3-36 months)
// =============================================================================

interface FlipDetection {
  is_flip: boolean;
  previous_sale?: { price: number; date: string };
  current_sale?: { price: number; date: string };
  months_between?: number;
  price_change_pct?: number;
}

function detectFlips(comps: CompSale[]): Map<string, FlipDetection> {
  const flips = new Map<string, FlipDetection>();
  
  // Group by normalized address
  const byAddress = new Map<string, CompSale[]>();
  for (const comp of comps) {
    // Normalize address for matching (strip unit numbers, lowercase, trim)
    const addr = normalize(comp.address || "")
      .replace(/\s*(#|unit|apt|ste)\s*\S*/gi, "")
      .replace(/[^a-z0-9\s]/g, "")
      .trim();
    if (!addr) continue;
    const existing = byAddress.get(addr) || [];
    existing.push(comp);
    byAddress.set(addr, existing);
  }

  for (const [addr, sales] of byAddress) {
    if (sales.length < 2) continue;
    
    // Sort by date
    const sorted = sales
      .filter(s => s.sold_date)
      .sort((a, b) => new Date(a.sold_date!).getTime() - new Date(b.sold_date!).getTime());

    for (let i = 0; i < sorted.length - 1; i++) {
      const prev = sorted[i];
      const curr = sorted[i + 1];
      const monthsBetween = Math.round(
        (new Date(curr.sold_date!).getTime() - new Date(prev.sold_date!).getTime()) / (1000 * 60 * 60 * 24 * 30)
      );

      if (monthsBetween >= 3 && monthsBetween <= 36) {
        const priceDelta = ((curr.sold_price - prev.sold_price) / prev.sold_price) * 100;
        flips.set(curr.id, {
          is_flip: true,
          previous_sale: { price: prev.sold_price, date: prev.sold_date! },
          current_sale: { price: curr.sold_price, date: curr.sold_date! },
          months_between: monthsBetween,
          price_change_pct: Math.round(priceDelta),
        });
      }
    }
  }

  return flips;
}

// =============================================================================
// NOH DIMINISHING RETURNS ON ACREAGE
// =============================================================================

/**
 * Calculate NOH land value with diminishing returns.
 * 1st acre: 100% of base, 2nd acre: 70%, additional: 50%
 * Returns estimated land value.
 */
function calculateNohLandValue(
  lotAcres: number,
  village: string,
  locationType: string
): number {
  const vill = normalize(village);
  
  // Base per-acre values for NOH
  let basePerAcre: number;
  const isVillageHamlet = ["sag harbor", "east hampton village", "southampton village", "bridgehampton"].includes(vill);
  
  if (locationType === "springs") basePerAcre = 1_100_000;
  else if (locationType === "northwest_woods") basePerAcre = 2_600_000;
  else if (isVillageHamlet) basePerAcre = 3_400_000;
  else basePerAcre = 3_000_000;

  // Diminishing returns
  if (lotAcres <= 1) {
    return Math.max(lotAcres * basePerAcre, locationType === "springs" ? 700_000 : 800_000);
  }

  let value = basePerAcre; // First acre at 100%
  if (lotAcres > 1) {
    const secondAcre = Math.min(lotAcres - 1, 1);
    value += secondAcre * basePerAcre * 0.70; // Second acre at 70%
  }
  if (lotAcres > 2) {
    value += (lotAcres - 2) * basePerAcre * 0.50; // Additional at 50%
  }

  // Minimums
  if (locationType === "springs") {
    if (lotAcres <= 0.4) return Math.max(value, 900_000);
    if (lotAcres <= 1.0) return Math.max(value, 1_200_000);
  } else {
    if (lotAcres <= 0.25 && isVillageHamlet) return Math.max(value, 1_200_000);
  }

  return Math.round(value);
}

// =============================================================================
// MICRO-MARKET DATA
// =============================================================================

const MICRO_MARKET_FALLBACKS: Record<string, string[]> = {
  "bridgehampton_soh": ["bridgehampton_soh", "sagaponack_soh", "water_mill_soh", "wainscott_soh"],
  "bridgehampton_noh": ["bridgehampton_noh", "water_mill_noh", "sagaponack_noh", "wainscott_noh"],
  "sagaponack_soh": ["sagaponack_soh", "bridgehampton_soh", "water_mill_soh", "wainscott_soh"],
  "sagaponack_noh": ["sagaponack_noh", "bridgehampton_noh", "water_mill_noh"],
  "water_mill_soh": ["water_mill_soh", "bridgehampton_soh", "sagaponack_soh", "southampton_soh"],
  "water_mill_noh": ["water_mill_noh", "bridgehampton_noh", "southampton_noh"],
  "wainscott_soh": ["wainscott_soh", "bridgehampton_soh", "sagaponack_soh", "east_hampton_soh"],
  "wainscott_noh": ["wainscott_noh", "bridgehampton_noh", "east_hampton_village"],
  "east_hampton_soh": ["east_hampton_soh", "wainscott_soh", "amagansett"],
  "east_hampton_village": ["east_hampton_village", "eh_village_fringe", "wainscott_noh"],
  "eh_village_fringe": ["eh_village_fringe", "east_hampton_village", "northwest_woods"],
  "southampton_soh": ["southampton_soh", "water_mill_soh", "bridgehampton_soh"],
  "southampton_noh": ["southampton_noh", "water_mill_noh", "north_sea"],
  "amagansett": ["amagansett", "east_hampton_soh", "montauk"],
  "montauk": ["montauk", "amagansett"],
  "sag_harbor": ["sag_harbor", "sag_harbor_waterfront", "bridgehampton_noh"],
  "sag_harbor_waterfront": ["sag_harbor_waterfront", "sag_harbor", "waterfront_soh"],
  "shelter_island": ["shelter_island"],
  "springs": ["springs", "northwest_woods"],
  "northwest_woods": ["northwest_woods", "eh_village_fringe", "springs"],
  "north_sea": ["north_sea", "southampton_noh"],
  "oceanfront": ["oceanfront", "waterfront_soh"],
  "waterfront_soh": ["waterfront_soh", "oceanfront", "sag_harbor_waterfront"],
};

// =============================================================================
// TYPES
// =============================================================================

interface CompSale {
  id: string;
  address: string;
  village: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_acres: number | null;
  sold_price: number;
  sold_date: string | null;
  price_per_sqft: number | null;
  source: string | null;
  days_on_market: number | null;
  property_type: string | null;
  notes: string | null;
  micro_market: string | null;
}

interface ScoredComp extends CompSale {
  relevance_score: number;
  adjusted_price: number;
  time_adjustment: number;
  classification: LocationClassification;
  score_breakdown: Record<string, number>;
  price_difference_pct: number;
  days_ago: number;
  condition: PropertyCondition;
  noh_land_value: number | null;
  flip_info: FlipDetection | null;
}

// =============================================================================
// SCORING ENGINE
// =============================================================================

/**
 * Score a comp against a subject property.
 * When no price is given (valuation mode), price_proximity is skipped
 * and scoring focuses on physical similarity.
 */
function scoreComp(
  comp: CompSale,
  subject: {
    village: string;
    price?: number;
    beds?: number;
    baths?: number;
    sqft?: number;
    lot_acres?: number;
    address?: string;
    classification: LocationClassification;
  }
): ScoredComp {
  const scores: Record<string, number> = {
    hamlet_match: 0,
    tier_match: 0,
    price_proximity: 0,
    beds_match: 0,
    sqft_match: 0,
    lot_match: 0,
    recency: 0,
    soh_match: 0,
    waterfront_match: 0,
    street_premium_match: 0,
    comparability_adjustment: 0,
  };

  const subjectVillage = normalize(subject.village);
  const compVillage = normalize(comp.village || "");
  const compClass = classifyAddress(comp.address || "", comp.village || "");
  const compat = areComparable(subject.classification, compClass);
  scores.comparability_adjustment = compat.penalty;

  // --- Hamlet match (10 pts) ---
  if (compVillage === subjectVillage) {
    scores.hamlet_match = SCORING.same_hamlet;
  } else {
    const regions = subject.classification.locationType === "tier1_oceanfront"
      ? (OCEANFRONT_COMP_REGIONS[subjectVillage] || [])
      : (COMP_REGIONS[subjectVillage] || []);
    if (regions.includes(compVillage)) scores.hamlet_match = 6;
  }

  // --- Tier match (25 pts) ---
  const subjectTier = getMarketTier(subject.village);
  const compTier = getMarketTier(comp.village || "");
  const tierDiff = Math.abs(TIER_RANK[subjectTier] - TIER_RANK[compTier]);
  if (tierDiff === 0) scores.tier_match = SCORING.exact_tier_match;
  else if (tierDiff === 1) scores.tier_match = SCORING.tier1_to_tier2;
  else if (tierDiff === 2) scores.tier_match = SCORING.tier3_to_tier2_or_tier4;
  else scores.tier_match = SCORING.different_tier;

  // --- SOH match (8 pts) ---
  if (subject.classification.isSouthOfHighway === compClass.isSouthOfHighway) {
    scores.soh_match = SCORING.soh_match;
  }

  // --- Waterfront match (10 / -15 pts) ---
  if (subject.classification.hasWaterfront && compClass.hasWaterfront) {
    if (subject.classification.waterfrontType === compClass.waterfrontType) {
      scores.waterfront_match = SCORING.waterfront_type_match;
    } else if (subject.classification.waterfrontType === "ocean" || compClass.waterfrontType === "ocean") {
      scores.waterfront_match = SCORING.waterfront_mismatch;
    }
  } else if (subject.classification.hasWaterfront !== compClass.hasWaterfront) {
    scores.waterfront_match = SCORING.waterfront_mismatch;
  }

  // --- Time adjustment ---
  const timeAdj = getTimeAdjustment(comp.sold_date);
  const adjustedPrice = Math.round(comp.sold_price * timeAdj);

  // --- Price proximity (30 pts) — only when subject has a price ---
  if (subject.price) {
    const priceDiff = Math.abs(adjustedPrice - subject.price) / subject.price;
    if (priceDiff <= 0.10) scores.price_proximity = 30;
    else if (priceDiff <= 0.20) scores.price_proximity = 25;
    else if (priceDiff <= 0.30) scores.price_proximity = 20;
    else if (priceDiff <= 0.40) scores.price_proximity = 12;
    else if (priceDiff <= 0.50) scores.price_proximity = 5;
    else scores.price_proximity = 0;
  }

  // --- Beds match (12 pts) ---
  if (subject.beds && comp.beds) {
    const bedDiff = Math.abs(comp.beds - subject.beds);
    if (bedDiff === 0) scores.beds_match = SCORING.bedrooms_exact;
    else if (bedDiff === 1) scores.beds_match = SCORING.bedrooms_diff_1;
    else if (bedDiff === 2) scores.beds_match = SCORING.bedrooms_diff_2;
    else scores.beds_match = SCORING.bedrooms_diff_3plus;
  } else {
    scores.beds_match = 4;
  }

  // --- Sqft match (13 pts) ---
  if (subject.sqft && comp.sqft) {
    const sqftDiff = Math.abs(comp.sqft - subject.sqft) / subject.sqft;
    if (sqftDiff <= 0.15) scores.sqft_match = SCORING.sqft_within_15pct;
    else if (sqftDiff <= 0.30) scores.sqft_match = SCORING.sqft_within_30pct;
    else if (sqftDiff <= 0.50) scores.sqft_match = SCORING.sqft_within_50pct;
    else scores.sqft_match = SCORING.sqft_beyond_50pct;
  } else {
    scores.sqft_match = 4;
  }

  // --- Lot size match (10 pts) — important for valuation mode ---
  if (subject.lot_acres && comp.lot_acres) {
    const lotDiff = Math.abs(comp.lot_acres - subject.lot_acres) / subject.lot_acres;
    if (lotDiff <= 0.25) scores.lot_match = 10;
    else if (lotDiff <= 0.50) scores.lot_match = 6;
    else if (lotDiff <= 0.75) scores.lot_match = 3;
    else scores.lot_match = 0;
  } else {
    scores.lot_match = 3;
  }

  // --- Recency (20 pts) ---
  const daysAgo = getDaysAgo(comp.sold_date);
  if (daysAgo <= 180) scores.recency = SCORING.recency_0_6mo;
  else if (daysAgo <= 365) scores.recency = SCORING.recency_6_12mo;
  else if (daysAgo <= 540) scores.recency = SCORING.recency_12_18mo;
  else if (daysAgo <= 730) scores.recency = SCORING.recency_18_24mo;
  else scores.recency = SCORING.recency_24plus;

  // --- Street premium match (7 pts) ---
  if (subject.classification.isPrimeRoad && compClass.isPrimeRoad) {
    scores.street_premium_match = SCORING.prime_road_match;
  } else if (!subject.classification.isPrimeRoad && !compClass.isPrimeRoad) {
    scores.street_premium_match = 5;
  } else {
    scores.street_premium_match = 0;
  }

  // --- NOH acreage diminishing returns adjustment ---
  // If comp is NOH with large lot, the per-acre value drops
  // Boost comps with similar lot sizes in NOH
  if (!compClass.isSouthOfHighway && comp.lot_acres && subject.lot_acres) {
    // Both NOH: if lot sizes are very different, penalize slightly
    const lotRatio = comp.lot_acres / subject.lot_acres;
    if (lotRatio > 3.0 || lotRatio < 0.33) {
      scores.lot_match = Math.max(0, scores.lot_match - 3);
    }
  }

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

  // Condition detection
  const ppsf = comp.sqft && comp.sqft > 0 ? comp.sold_price / comp.sqft : null;
  const condition = detectCondition(ppsf ? Math.round(ppsf) : null, comp.village || "");

  // NOH land value estimate
  const nohLandValue = !compClass.isSouthOfHighway && comp.lot_acres
    ? calculateNohLandValue(comp.lot_acres, comp.village || "", compClass.locationType)
    : null;

  return {
    ...comp,
    relevance_score: Math.max(0, totalScore),
    adjusted_price: adjustedPrice,
    time_adjustment: timeAdj,
    classification: compClass,
    score_breakdown: scores,
    price_difference_pct: subject.price
      ? Math.round(((adjustedPrice - subject.price) / subject.price) * 100)
      : 0,
    days_ago: daysAgo,
    condition,
    noh_land_value: nohLandValue,
    flip_info: null, // Populated later in batch
  };
}

// =============================================================================
// VALUATION ENGINE
// =============================================================================

interface ValuationResult {
  estimated_value: number;
  confidence: "high" | "medium" | "low";
  value_range: { low: number; high: number };
  methodology: string;
  factors: string[];
}

/**
 * Estimate property value from scored comps.
 * Uses weighted median with recency and similarity weighting.
 */
function estimateValue(
  comps: ScoredComp[],
  subject: {
    address?: string;
    village: string;
    beds?: number;
    sqft?: number;
    lot_acres?: number;
    classification: LocationClassification;
  }
): ValuationResult {
  if (comps.length === 0) {
    return {
      estimated_value: 0,
      confidence: "low",
      value_range: { low: 0, high: 0 },
      methodology: "insufficient_data",
      factors: ["No comparable sales found"],
    };
  }

  // Weight each comp by relevance score and recency
  const weighted: Array<{ price: number; weight: number }> = comps.map(c => {
    let weight = c.relevance_score;
    // Boost recent sales
    if (c.days_ago <= 180) weight *= 1.5;
    else if (c.days_ago <= 365) weight *= 1.2;
    // Boost exact lot size matches
    if (subject.lot_acres && c.lot_acres) {
      const lotRatio = Math.abs(c.lot_acres - subject.lot_acres) / subject.lot_acres;
      if (lotRatio <= 0.25) weight *= 1.3;
    }
    // Boost exact bed matches
    if (subject.beds && c.beds && c.beds === subject.beds) weight *= 1.2;
    return { price: c.adjusted_price, weight };
  });

  // Sort by price for percentile calculation
  weighted.sort((a, b) => a.price - b.price);

  // Weighted average
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  const weightedAvg = Math.round(
    weighted.reduce((s, w) => s + w.price * w.weight, 0) / totalWeight
  );

  // Weighted median (find the price at 50% of cumulative weight)
  let cumWeight = 0;
  let weightedMedian = weighted[0].price;
  for (const w of weighted) {
    cumWeight += w.weight;
    if (cumWeight >= totalWeight / 2) {
      weightedMedian = w.price;
      break;
    }
  }

  // Apply street premium adjustment
  const streetPremium = subject.classification.streetPremium;
  // If subject is on a premium street but most comps aren't, adjust up
  const compsAvgPremium = comps.reduce((s, c) => s + c.classification.streetPremium, 0) / comps.length;
  const premiumAdjustment = streetPremium > 1.0 && compsAvgPremium < streetPremium
    ? streetPremium / compsAvgPremium
    : 1.0;

  // Final estimate: blend of weighted median and weighted average
  let rawEstimate = Math.round((weightedMedian * 0.6 + weightedAvg * 0.4) * premiumAdjustment);

  // Round to nearest $25K
  const estimated = Math.round(rawEstimate / 25000) * 25000;

  // Confidence based on comp count and score
  const avgScore = comps.reduce((s, c) => s + c.relevance_score, 0) / comps.length;
  let confidence: "high" | "medium" | "low";
  if (comps.length >= 8 && avgScore >= 60) confidence = "high";
  else if (comps.length >= 5 && avgScore >= 40) confidence = "medium";
  else confidence = "low";

  // Value range (10th and 90th percentile of adjusted comps)
  const prices = comps.map(c => c.adjusted_price).sort((a, b) => a - b);
  const p10 = prices[Math.floor(prices.length * 0.1)] || prices[0];
  const p90 = prices[Math.ceil(prices.length * 0.9) - 1] || prices[prices.length - 1];

  // NOH diminishing returns adjustment
  if (!subject.classification.isSouthOfHighway && subject.lot_acres && subject.lot_acres > 2) {
    const nohLandVal = calculateNohLandValue(subject.lot_acres, subject.village, subject.classification.locationType);
    // If comps have smaller lots, the per-acre value is higher than what this large lot would get
    const compsAvgLot = comps.filter(c => c.lot_acres).reduce((s, c) => s + (c.lot_acres || 0), 0) /
      comps.filter(c => c.lot_acres).length || 1;
    if (subject.lot_acres > compsAvgLot * 1.5) {
      // Subject has much larger lot than comps — diminishing returns apply
      // Reduce estimate slightly (large NOH lots don't scale linearly)
      const dimFactor = 0.95; // 5% reduction for significantly larger lots
      rawEstimate = Math.round(rawEstimate * dimFactor);
    }
  }

  // Build factors explanation
  const factors: string[] = [];
  factors.push(`Based on ${comps.length} comparable sales`);
  if (subject.classification.isSouthOfHighway) factors.push("South of Highway location");
  else factors.push("North of Highway location");
  if (subject.classification.hasWaterfront) factors.push(`${subject.classification.waterfrontType} waterfront`);
  if (streetPremium > 1.0) factors.push(`Premium road (${streetPremium}x multiplier)`);
  if (subject.beds) factors.push(`${subject.beds} bedrooms`);
  if (subject.lot_acres) {
    factors.push(`${subject.lot_acres} acres`);
    if (!subject.classification.isSouthOfHighway && subject.lot_acres > 2) {
      factors.push("NOH diminishing returns applied for large lot");
    }
  }
  const recentComps = comps.filter(c => c.days_ago <= 365).length;
  factors.push(`${recentComps} sales within last 12 months`);
  
  // Condition distribution
  const conditions = comps.reduce((acc, c) => { acc[c.condition] = (acc[c.condition] || 0) + 1; return acc; }, {} as Record<string, number>);
  const conditionStr = Object.entries(conditions).filter(([k]) => k !== "unknown").map(([k, v]) => `${v} ${k}`).join(", ");
  if (conditionStr) factors.push(`Conditions: ${conditionStr}`);

  return {
    estimated_value: estimated,
    confidence,
    value_range: {
      low: Math.round(p10 / 25000) * 25000,
      high: Math.round(p90 / 25000) * 25000,
    },
    methodology: "weighted_comp_analysis",
    factors,
  };
}

// =============================================================================
// SUPABASE QUERIES
// =============================================================================

async function fetchCompsByMicroMarket(
  microMarkets: string[],
  minPrice?: number,
  maxPrice?: number,
): Promise<CompSale[]> {
  if (!SUPABASE_KEY) throw new Error("Supabase key not configured");

  const mmFilter = microMarkets.map(m => `micro_market.eq.${encodeURIComponent(m)}`).join(",");
  let url = `${SUPABASE_URL}/rest/v1/comparable_sales?select=*&or=(${mmFilter})&order=sold_date.desc&limit=300`;
  if (minPrice !== undefined) url += `&sold_price=gte.${minPrice}`;
  if (maxPrice !== undefined) url += `&sold_price=lte.${maxPrice}`;

  console.log(`[SmartComps] Query micro_market: [${microMarkets.join(", ")}]${minPrice ? ` $${minPrice.toLocaleString()}-$${maxPrice?.toLocaleString()}` : " (all prices)"}`);

  const res = await fetch(url, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[SmartComps] Supabase error: ${res.status} ${errText}`);
    throw new Error(`Supabase query failed: ${res.status}`);
  }

  return res.json() as Promise<CompSale[]>;
}

async function fetchCompsByVillage(
  villages: string[],
  minPrice?: number,
  maxPrice?: number,
): Promise<CompSale[]> {
  if (!SUPABASE_KEY) throw new Error("Supabase key not configured");

  const villageFilter = villages.map(v => `village.ilike.${encodeURIComponent(v)}`).join(",");
  let url = `${SUPABASE_URL}/rest/v1/comparable_sales?select=*&or=(${villageFilter})&order=sold_date.desc&limit=300`;
  if (minPrice !== undefined) url += `&sold_price=gte.${minPrice}`;
  if (maxPrice !== undefined) url += `&sold_price=lte.${maxPrice}`;

  const res = await fetch(url, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
  });

  if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
  return res.json() as Promise<CompSale[]>;
}

// =============================================================================
// SCHEMA
// =============================================================================

const smartCompSchema = z.object({
  address: z.string().optional(),
  village: z.string(),
  price: z.number().min(100000).optional(),  // OPTIONAL: if omitted, valuation mode
  beds: z.number().optional(),
  baths: z.number().optional(),
  sqft: z.number().optional(),
  lot_acres: z.number().optional(),
  micro_market: z.string().optional(),
  max_results: z.number().min(3).max(20).optional().default(15),
  // Optional overrides — when set, these filter comps instead of auto-detecting
  condition: z.enum(["teardown", "needs_renovation", "normal", "new_construction"]).optional(),
  location_tier: z.enum([
    "auto",           // AI determines (default, same as omitting)
    "oceanfront",     // Tier 1 oceanfront
    "pondfront",      // Pond/lake waterfront
    "bayfront",       // Bay/harbor waterfront
    "south_of_highway", // SOH non-waterfront
    "north_of_highway", // NOH
    "village",        // Village/Town center
  ]).optional(),
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/smart-comps/analyze
 * 
 * Two modes:
 * - With price: finds comps around that price (comp validation mode)
 * - Without price: estimates property value from comps (valuation mode)
 */
smartCompsRouter.post("/analyze", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = smartCompSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const subject = parsed.data;
    const targetCount = subject.max_results;
    const microMarket = subject.micro_market || null;
    const isValuationMode = !subject.price;
    const conditionFilter = subject.condition || null;
    const locationTierFilter = subject.location_tier && subject.location_tier !== "auto" 
      ? subject.location_tier : null;

    // Classify the subject property
    const subjectClass = classifyAddress(subject.address || "", subject.village);

    // Override subject classification if user specified a location tier
    if (locationTierFilter) {
      switch (locationTierFilter) {
        case "oceanfront":
          subjectClass.locationType = "tier1_oceanfront";
          subjectClass.isSouthOfHighway = true;
          subjectClass.hasWaterfront = true;
          subjectClass.waterfrontType = "ocean";
          break;
        case "pondfront":
          subjectClass.hasWaterfront = true;
          subjectClass.waterfrontType = "pond";
          subjectClass.isSouthOfHighway = true;
          break;
        case "bayfront":
          subjectClass.hasWaterfront = true;
          subjectClass.waterfrontType = "bay";
          break;
        case "south_of_highway":
          subjectClass.isSouthOfHighway = true;
          subjectClass.hasWaterfront = false;
          subjectClass.waterfrontType = "none";
          break;
        case "north_of_highway":
          subjectClass.isSouthOfHighway = false;
          subjectClass.hasWaterfront = false;
          subjectClass.waterfrontType = "none";
          break;
        case "village":
          subjectClass.locationType = "village_hamlet";
          break;
      }
    }

    console.log(`[SmartComps v4] ${isValuationMode ? "VALUATION" : "COMP"} mode: ${subject.address || subject.village}, ${subject.price ? "$" + subject.price.toLocaleString() : "no price"}, micro_market=${microMarket || "auto"}${conditionFilter ? ", condition=" + conditionFilter : ""}${locationTierFilter ? ", tier=" + locationTierFilter : ""}`);

    // Fetch comps
    let allComps: CompSale[] = [];
    let strategyUsed = "none";

    if (microMarket) {
      if (isValuationMode) {
        // VALUATION + MICRO-MARKET: Pull all comps from this market
        const primaryMMs = [microMarket];
        const fallbackMMs = MICRO_MARKET_FALLBACKS[microMarket] || [microMarket];

        allComps = await fetchCompsByMicroMarket(primaryMMs);
        strategyUsed = "mm_valuation";
        console.log(`[SmartComps v4] Primary micro-market: ${allComps.length} comps`);

        if (allComps.length < 10) {
          const fallbackComps = await fetchCompsByMicroMarket(fallbackMMs);
          if (fallbackComps.length > allComps.length) {
            allComps = fallbackComps;
            strategyUsed = "mm_valuation_fallback";
          }
          console.log(`[SmartComps v4] Fallback: ${allComps.length} comps`);
        }
      } else {
        // COMP + MICRO-MARKET: Price-filtered progressive search
        const primaryMMs = [microMarket];
        const fallbackMMs = MICRO_MARKET_FALLBACKS[microMarket] || [microMarket];
        const priceFilter = getPriceFilter(subject.price!);

        const strategies = [
          { label: "mm_tight", markets: primaryMMs, min: 0.75, max: 1.25 },
          { label: "mm_medium", markets: primaryMMs, min: 0.60, max: 1.40 },
          { label: "mm_fallback_tight", markets: fallbackMMs, min: 0.70, max: 1.30 },
          { label: "mm_fallback_wide", markets: fallbackMMs, min: priceFilter.minRatio, max: priceFilter.maxRatio },
        ];

        for (const strategy of strategies) {
          const comps = await fetchCompsByMicroMarket(
            strategy.markets,
            Math.round(subject.price! * strategy.min),
            Math.round(subject.price! * strategy.max)
          );
          console.log(`[SmartComps v4] Strategy "${strategy.label}": ${comps.length} comps`);
          if (comps.length >= 5) {
            allComps = comps;
            strategyUsed = strategy.label;
            break;
          }
          if (comps.length > allComps.length) {
            allComps = comps;
            strategyUsed = strategy.label;
          }
        }
      }
    } else {
      // VILLAGE MODE (no micro-market specified)
      const isOceanfront = subjectClass.locationType === "tier1_oceanfront";
      const primaryRegion = isOceanfront
        ? (OCEANFRONT_COMP_REGIONS[normalize(subject.village)] || COMP_REGIONS[normalize(subject.village)] || [normalize(subject.village)])
        : (COMP_REGIONS[normalize(subject.village)] || [normalize(subject.village)]);
      const fallbackRegion = FALLBACK_REGIONS[normalize(subject.village)] || primaryRegion;

      if (isValuationMode) {
        allComps = await fetchCompsByVillage(primaryRegion);
        strategyUsed = "village_valuation";
        if (allComps.length < 10) {
          const fb = await fetchCompsByVillage(fallbackRegion);
          if (fb.length > allComps.length) {
            allComps = fb;
            strategyUsed = "village_valuation_fallback";
          }
        }
      } else {
        const priceFilter = getPriceFilter(subject.price!);
        const strategies = [
          { label: "village_tight", villages: primaryRegion, min: 0.75, max: 1.25 },
          { label: "village_medium", villages: primaryRegion, min: 0.60, max: 1.40 },
          { label: "village_fallback", villages: fallbackRegion, min: 0.60, max: 1.40 },
          { label: "village_wide", villages: fallbackRegion, min: priceFilter.minRatio, max: priceFilter.maxRatio },
        ];

        for (const strategy of strategies) {
          const comps = await fetchCompsByVillage(
            strategy.villages,
            Math.round(subject.price! * strategy.min),
            Math.round(subject.price! * strategy.max)
          );
          if (comps.length >= 5) {
            allComps = comps;
            strategyUsed = strategy.label;
            break;
          }
          if (comps.length > allComps.length) {
            allComps = comps;
            strategyUsed = strategy.label;
          }
        }
      }
    }

    if (allComps.length === 0) {
      return c.json({
        success: true,
        mode: isValuationMode ? "valuation" : "comp",
        message: "No comparable sales found",
        subject: { village: subject.village, address: subject.address, classification: subjectClass },
        strategy_used: strategyUsed,
        comps: [],
        stats: null,
        valuation: isValuationMode ? { estimated_value: 0, confidence: "low", value_range: { low: 0, high: 0 }, methodology: "insufficient_data", factors: ["No comparable sales found"] } : undefined,
      });
    }

    // Score and rank
    const scored = allComps
      .map(comp => scoreComp(comp, { ...subject, classification: subjectClass }))
      .filter(comp => {
        const compat = areComparable(subjectClass, comp.classification);
        return compat.comparable;
      })
      // Condition filter: only keep comps matching the user's selected condition
      .filter(comp => {
        if (!conditionFilter) return true;
        return comp.condition === conditionFilter;
      })
      // Location tier filter: only keep comps matching the selected location type
      .filter(comp => {
        if (!locationTierFilter) return true;
        const cc = comp.classification;
        switch (locationTierFilter) {
          case "oceanfront":
            return cc.locationType === "tier1_oceanfront" || cc.waterfrontType === "ocean";
          case "pondfront":
            return cc.waterfrontType === "pond";
          case "bayfront":
            return cc.waterfrontType === "bay" || cc.waterfrontType === "harbor";
          case "south_of_highway":
            return cc.isSouthOfHighway && !cc.hasWaterfront;
          case "north_of_highway":
            return !cc.isSouthOfHighway;
          case "village":
            return cc.locationType === "village_hamlet" || cc.locationType === "eh_village_fringe";
          default:
            return true;
        }
      })
      .filter(comp => comp.relevance_score >= 10)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, targetCount);

    // Detect flips across ALL fetched comps (need full set for address matching)
    const flipMap = detectFlips(allComps);
    for (const comp of scored) {
      comp.flip_info = flipMap.get(comp.id) || null;
    }

    // Calculate valuation if in valuation mode
    const valuation = isValuationMode
      ? estimateValue(scored, { ...subject, classification: subjectClass })
      : undefined;

    // Stats
    const prices = scored.map(c => c.adjusted_price);
    const ppsf = scored.filter(c => c.price_per_sqft).map(c => c.price_per_sqft!);

    const stats = prices.length > 0 ? {
      comp_count: scored.length,
      avg_price: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      median_price: [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)],
      min_price: Math.min(...prices),
      max_price: Math.max(...prices),
      avg_price_per_sqft: ppsf.length > 0
        ? Math.round(ppsf.reduce((a, b) => a + b, 0) / ppsf.length)
        : null,
      avg_days_ago: Math.round(scored.reduce((a, b) => a + b.days_ago, 0) / scored.length),
      avg_relevance_score: Math.round(scored.reduce((a, b) => a + b.relevance_score, 0) / scored.length),
    } : null;

    console.log(`[SmartComps v4] Returning ${scored.length} comps (${isValuationMode ? "VALUATION" : "COMP"} mode, strategy: ${strategyUsed}${valuation ? ", est: $" + valuation.estimated_value.toLocaleString() : ""})`);

    return c.json({
      success: true,
      mode: isValuationMode ? "valuation" : "comp",
      subject: {
        address: subject.address,
        village: subject.village,
        price: subject.price || null,
        beds: subject.beds,
        baths: subject.baths,
        sqft: subject.sqft,
        lot_acres: subject.lot_acres,
        micro_market: microMarket,
        classification: subjectClass,
        condition_filter: conditionFilter,
        location_tier_filter: locationTierFilter,
      },
      valuation,
      strategy_used: strategyUsed,
      // Subject NOH land value if applicable
      subject_noh_land_value: !subjectClass.isSouthOfHighway && subject.lot_acres
        ? calculateNohLandValue(subject.lot_acres, subject.village, subjectClass.locationType)
        : null,
      construction_costs: getConstructionCost(subject.village),
      flips_detected: scored.filter(c => c.flip_info?.is_flip).length,
      comps: scored.map(comp => ({
        address: comp.address,
        village: comp.village,
        sold_price: comp.sold_price,
        adjusted_price: comp.adjusted_price,
        time_adjustment: comp.time_adjustment,
        sold_date: comp.sold_date,
        beds: comp.beds,
        baths: comp.baths,
        sqft: comp.sqft,
        lot_acres: comp.lot_acres,
        price_per_sqft: comp.price_per_sqft,
        classification: comp.classification,
        relevance_score: comp.relevance_score,
        score_breakdown: comp.score_breakdown,
        price_difference_pct: comp.price_difference_pct,
        days_ago: comp.days_ago,
        market_tier: getMarketTier(comp.village || ""),
        micro_market: comp.micro_market,
        source: comp.source,
        condition: comp.condition,
        noh_land_value: comp.noh_land_value,
        flip_info: comp.flip_info,
      })),
      stats,
    });
  } catch (error: any) {
    console.error("[SmartComps v4] Error:", error?.message || error);
    return c.json({ success: false, error: "Failed to analyze comps", details: error?.message }, 500);
  }
});

/**
 * GET /api/smart-comps/villages
 */
smartCompsRouter.get("/villages", async (c) => {
  try {
    const url = `${SUPABASE_URL}/rest/v1/comparable_sales?select=village&limit=10000`;
    const res = await fetch(url, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) return c.json({ success: false, error: "Failed to fetch" }, 500);
    const data = await res.json() as Array<{ village: string }>;
    const counts: Record<string, number> = {};
    for (const row of data) { counts[row.village || "Unknown"] = (counts[row.village || "Unknown"] || 0) + 1; }
    const villages = Object.entries(counts)
      .map(([name, count]) => ({ name, count, market_tier: getMarketTier(name), base_value: HAMLET_BASE_VALUES[normalize(name)] || null }))
      .sort((a, b) => b.count - a.count);
    return c.json({ success: true, villages, total: data.length });
  } catch (error: any) {
    return c.json({ success: false, error: "Failed" }, 500);
  }
});

/**
 * GET /api/smart-comps/classify?address=xxx&village=yyy
 */
smartCompsRouter.get("/classify", (c) => {
  const address = c.req.query("address") || "";
  const village = c.req.query("village") || "";
  if (!address || !village) return c.json({ success: false, error: "address and village required" }, 400);
  return c.json({ success: true, address, village, classification: classifyAddress(address, village) });
});

/**
 * GET /api/smart-comps/micro-markets
 */
smartCompsRouter.get("/micro-markets", async (c) => {
  try {
    const url = `${SUPABASE_URL}/rest/v1/comparable_sales?select=micro_market&limit=10000`;
    const res = await fetch(url, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) return c.json({ success: false, error: "Failed to fetch" }, 500);
    const data = await res.json() as Array<{ micro_market: string }>;
    const counts: Record<string, number> = {};
    for (const row of data) { counts[row.micro_market || "unclassified"] = (counts[row.micro_market || "unclassified"] || 0) + 1; }
    const microMarkets = Object.entries(counts)
      .map(([name, count]) => ({
        key: name,
        label: name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
          .replace("Soh", "South of Highway").replace("Noh", "North of Highway")
          .replace("Eh ", "East Hampton "),
        count,
        fallback_markets: MICRO_MARKET_FALLBACKS[name] || [name],
      }))
      .sort((a, b) => {
        // Sort alphabetically by label for the dropdown
        return a.label.localeCompare(b.label);
      });
    return c.json({ success: true, micro_markets: microMarkets, total: data.length });
  } catch (error: any) {
    return c.json({ success: false, error: "Failed" }, 500);
  }
});

/**
 * GET /api/smart-comps/market-data
 */
smartCompsRouter.get("/market-data", (c) => {
  return c.json({
    success: true,
    hamlet_base_values: HAMLET_BASE_VALUES,
    hamlet_tiers: HAMLET_TIERS,
    street_premiums: STREET_PREMIUMS,
    waterfront_premiums: WATERFRONT_PREMIUMS,
    scoring_weights: SCORING,
    time_adjustments: TIME_ADJUSTMENTS,
    price_filters: PRICE_FILTERS,
  });
});

export { smartCompsRouter };// v4 - Mon Mar  2 13:10:21 EST 2026
