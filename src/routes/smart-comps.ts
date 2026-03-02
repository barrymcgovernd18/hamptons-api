/**
 * Smart Comp Analysis API v3
 * 
 * Full Hamptons market intelligence:
 * - Runtime address classification (oceanfront/SOH waterfront/prime SOH/NOH)
 * - Waterfront type matching (ocean, bay, pond, creek)
 * - SOH/NOH enforcement (never comp oceanfront vs inland)
 * - Street premium awareness
 * - Village comp region rules
 * - Tier-based scoring with penalties
 * - Time appreciation adjustments
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
}

interface ScoredComp extends CompSale {
  relevance_score: number;
  adjusted_price: number;
  time_adjustment: number;
  classification: LocationClassification;
  score_breakdown: {
    hamlet_match: number;
    tier_match: number;
    price_proximity: number;
    beds_match: number;
    sqft_match: number;
    recency: number;
    soh_match: number;
    waterfront_match: number;
    street_premium_match: number;
    comparability_adjustment: number;
  };
  price_difference_pct: number;
  days_ago: number;
}

// =============================================================================
// SCORING ENGINE
// =============================================================================

function scoreComp(
  comp: CompSale,
  subject: {
    village: string;
    price: number;
    beds?: number;
    baths?: number;
    sqft?: number;
    lot_acres?: number;
    address?: string;
    classification: LocationClassification;
  }
): ScoredComp {
  const scores = {
    hamlet_match: 0,
    tier_match: 0,
    price_proximity: 0,
    beds_match: 0,
    sqft_match: 0,
    recency: 0,
    soh_match: 0,
    waterfront_match: 0,
    street_premium_match: 0,
    comparability_adjustment: 0,
  };

  const subjectVillage = normalize(subject.village);
  const compVillage = normalize(comp.village || "");

  // Classify the comp address
  const compClass = classifyAddress(comp.address || "", comp.village || "");

  // --- Comparability check ---
  const compat = areComparable(subject.classification, compClass);
  scores.comparability_adjustment = compat.penalty;

  // --- Hamlet match (10 pts) ---
  if (compVillage === subjectVillage) {
    scores.hamlet_match = SCORING.same_hamlet;
  } else {
    // Use oceanfront-specific regions if subject is oceanfront
    const regions = subject.classification.locationType === "tier1_oceanfront"
      ? (OCEANFRONT_COMP_REGIONS[subjectVillage] || [])
      : (COMP_REGIONS[subjectVillage] || []);
    if (regions.includes(compVillage)) {
      scores.hamlet_match = 6;
    }
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

  // --- Price proximity (30 pts) ---
  const priceDiff = Math.abs(adjustedPrice - subject.price) / subject.price;
  if (priceDiff <= 0.10) scores.price_proximity = 30;
  else if (priceDiff <= 0.20) scores.price_proximity = 25;
  else if (priceDiff <= 0.30) scores.price_proximity = 20;
  else if (priceDiff <= 0.40) scores.price_proximity = 12;
  else if (priceDiff <= 0.50) scores.price_proximity = 5;
  else scores.price_proximity = 0;

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

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

  return {
    ...comp,
    relevance_score: Math.max(0, totalScore),
    adjusted_price: adjustedPrice,
    time_adjustment: timeAdj,
    classification: compClass,
    score_breakdown: scores,
    price_difference_pct: Math.round(((adjustedPrice - subject.price) / subject.price) * 100),
    days_ago: daysAgo,
  };
}

// =============================================================================
// SUPABASE QUERY
// =============================================================================

async function fetchComps(
  villages: string[],
  minPrice: number,
  maxPrice: number,
): Promise<CompSale[]> {
  if (!SUPABASE_KEY) throw new Error("Supabase key not configured");

  const villageFilter = villages.map(v => `village.ilike.${encodeURIComponent(v)}`).join(",");
  const url = `${SUPABASE_URL}/rest/v1/comparable_sales?select=*&or=(${villageFilter})&sold_price=gte.${minPrice}&sold_price=lte.${maxPrice}&order=sold_price.desc&limit=300`;

  console.log(`[SmartComps] Query: villages=[${villages.join(", ")}], price=$${minPrice.toLocaleString()}-$${maxPrice.toLocaleString()}`);

  const res = await fetch(url, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[SmartComps] Supabase error: ${res.status} ${errText}`);
    throw new Error(`Supabase query failed: ${res.status}`);
  }

  return res.json() as Promise<CompSale[]>;
}

// =============================================================================
// SCHEMA
// =============================================================================

const smartCompSchema = z.object({
  address: z.string().optional(),
  village: z.string(),
  price: z.number().min(100000),
  beds: z.number().optional(),
  baths: z.number().optional(),
  sqft: z.number().optional(),
  lot_acres: z.number().optional(),
  max_results: z.number().min(3).max(20).optional().default(10),
});

// =============================================================================
// ROUTES
// =============================================================================

/**
 * POST /api/smart-comps/analyze
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
    const priceFilter = getPriceFilter(subject.price);

    // Classify the subject property
    const subjectClass = classifyAddress(subject.address || "", subject.village);

    console.log(`[SmartComps v3] Analyzing: ${subject.address || subject.village}, $${subject.price.toLocaleString()}`);
    console.log(`[SmartComps v3] Classification: ${subjectClass.locationType}, tier=${subjectClass.locationTier}, SOH=${subjectClass.isSouthOfHighway}, waterfront=${subjectClass.waterfrontType}, premium=${subjectClass.streetPremium}x`);

    // Choose comp regions based on location type
    const isOceanfront = subjectClass.locationType === "tier1_oceanfront";
    const primaryRegion = isOceanfront
      ? (OCEANFRONT_COMP_REGIONS[normalize(subject.village)] || COMP_REGIONS[normalize(subject.village)] || [normalize(subject.village)])
      : (COMP_REGIONS[normalize(subject.village)] || [normalize(subject.village)]);
    const fallbackRegion = FALLBACK_REGIONS[normalize(subject.village)] || primaryRegion;

    // Progressive strategy
    const strategies = [
      {
        label: "primary_tight",
        villages: primaryRegion,
        minPrice: Math.round(subject.price * 0.75),
        maxPrice: Math.round(subject.price * 1.25),
      },
      {
        label: "primary_medium",
        villages: primaryRegion,
        minPrice: Math.round(subject.price * 0.60),
        maxPrice: Math.round(subject.price * 1.40),
      },
      {
        label: "fallback_medium",
        villages: fallbackRegion,
        minPrice: Math.round(subject.price * 0.60),
        maxPrice: Math.round(subject.price * 1.40),
      },
      {
        label: "fallback_wide",
        villages: fallbackRegion,
        minPrice: Math.round(subject.price * priceFilter.minRatio),
        maxPrice: Math.round(subject.price * priceFilter.maxRatio),
      },
    ];

    let allComps: CompSale[] = [];
    let strategyUsed = "none";

    for (const strategy of strategies) {
      const comps = await fetchComps(strategy.villages, strategy.minPrice, strategy.maxPrice);
      console.log(`[SmartComps v3] Strategy "${strategy.label}": ${comps.length} comps`);

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

    if (allComps.length === 0) {
      return c.json({
        success: true,
        message: "No comparable sales found matching criteria",
        subject: {
          village: subject.village,
          price: subject.price,
          beds: subject.beds,
          classification: subjectClass,
        },
        strategy_used: strategyUsed,
        comps: [],
        stats: null,
      });
    }

    // Score, filter by comparability, rank
    const scored = allComps
      .map(comp => scoreComp(comp, { ...subject, classification: subjectClass }))
      .filter(comp => {
        // Hard filter: non-comparable properties removed entirely
        const compat = areComparable(subjectClass, comp.classification);
        return compat.comparable;
      })
      .filter(comp => comp.relevance_score >= 15)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, targetCount);

    // Stats
    const prices = scored.map(c => c.adjusted_price);
    const ppsf = scored.filter(c => c.price_per_sqft).map(c => c.price_per_sqft!);

    const stats = prices.length > 0 ? {
      comp_count: scored.length,
      avg_price: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      median_price: prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)],
      min_price: Math.min(...prices),
      max_price: Math.max(...prices),
      avg_price_per_sqft: ppsf.length > 0
        ? Math.round(ppsf.reduce((a, b) => a + b, 0) / ppsf.length)
        : null,
      avg_days_ago: Math.round(scored.reduce((a, b) => a + b.days_ago, 0) / scored.length),
      avg_relevance_score: Math.round(scored.reduce((a, b) => a + b.relevance_score, 0) / scored.length),
    } : null;

    console.log(`[SmartComps v3] Returning ${scored.length} comps (strategy: ${strategyUsed}, avg score: ${stats?.avg_relevance_score || 0})`);

    return c.json({
      success: true,
      subject: {
        address: subject.address,
        village: subject.village,
        price: subject.price,
        beds: subject.beds,
        baths: subject.baths,
        sqft: subject.sqft,
        classification: subjectClass,
      },
      strategy_used: strategyUsed,
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
        source: comp.source,
      })),
      stats,
    });
  } catch (error: any) {
    console.error("[SmartComps v3] Error:", error?.message || error);
    return c.json({ success: false, error: "Failed to analyze comps", details: error?.message }, 500);
  }
});

/**
 * GET /api/smart-comps/villages
 */
smartCompsRouter.get("/villages", async (c) => {
  try {
    const url = `${SUPABASE_URL}/rest/v1/comparable_sales?select=village&limit=5007`;
    const res = await fetch(url, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    });

    if (!res.ok) return c.json({ success: false, error: "Failed to fetch" }, 500);

    const data = await res.json() as Array<{ village: string }>;
    const counts: Record<string, number> = {};
    for (const row of data) {
      const v = row.village || "Unknown";
      counts[v] = (counts[v] || 0) + 1;
    }

    const villages = Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count,
        market_tier: getMarketTier(name),
        base_value: HAMLET_BASE_VALUES[normalize(name)] || null,
      }))
      .sort((a, b) => b.count - a.count);

    return c.json({ success: true, villages, total: data.length });
  } catch (error: any) {
    console.error("[SmartComps v3] Villages error:", error?.message);
    return c.json({ success: false, error: "Failed" }, 500);
  }
});

/**
 * GET /api/smart-comps/classify?address=xxx&village=yyy
 * Classify any address (useful for testing/debugging)
 */
smartCompsRouter.get("/classify", (c) => {
  const address = c.req.query("address") || "";
  const village = c.req.query("village") || "";
  
  if (!address || !village) {
    return c.json({ success: false, error: "address and village required" }, 400);
  }

  const classification = classifyAddress(address, village);
  return c.json({ success: true, address, village, classification });
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

export { smartCompsRouter };
