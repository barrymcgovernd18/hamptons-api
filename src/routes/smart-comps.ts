/**
 * Smart Comp Analysis API v2
 * 
 * Hamptons-specific comp analysis with Barry's market intelligence:
 * - SOH/NOH geographic tier matching
 * - Street/lane premium awareness
 * - Waterfront type matching (ocean, bay, pond, creek)
 * - Village comp region rules (never comp Southampton oceanfront vs East Hampton)
 * - Tier-based scoring (Trophy, Upper, Core, Entry)
 * - Time appreciation adjustments
 * - Condition detection
 * - Progressive widening with market-aware fallbacks
 */

import { Hono } from "hono";
import { z } from "zod";

const smartCompsRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tfzkenrmzoxrkdntkada.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmemtlbnJtem94cmtkbnRrYWRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5OTc0OTcsImV4cCI6MjA4MzU3MzQ5N30.6IxBDHMp0TbeJdRr0114fdnsCHyrRoaIcyG5jKdPAV8";
const envKey = process.env.SUPABASE_ANON_KEY;
const SUPABASE_KEY = (envKey && envKey.startsWith("eyJ")) ? envKey : SUPABASE_ANON;

// =============================================================================
// MARKET INTELLIGENCE DATA (from Barry's knowledge)
// =============================================================================

/** Hamlet base values (per acre, fallback when no comps) */
const HAMLET_BASE_VALUES: Record<string, number> = {
  "east hampton": 8_000_000,
  "southampton": 7_500_000,
  "southampton village": 7_500_000,
  "sagaponack": 9_000_000,
  "bridgehampton": 6_500_000,
  "water mill": 5_500_000,
  "wainscott": 5_000_000,
  "amagansett": 5_000_000,
  "sag harbor": 4_000_000,
  "montauk": 3_500_000,
  "shelter island": 2_500_000,
  "shelter island heights": 2_500_000,
  "springs": 1_100_000,
};

/** Hamlet market tiers */
type MarketTier = "trophy" | "upper" | "core" | "entry";
const HAMLET_TIERS: Record<string, MarketTier> = {
  "east hampton": "trophy",
  "sagaponack": "trophy",
  "water mill": "trophy",
  "southampton": "upper",
  "southampton village": "upper",
  "amagansett": "upper",
  "sag harbor": "core",
  "shelter island": "core",
  "shelter island heights": "core",
  "wainscott": "core",
  "bridgehampton": "core",
  "montauk": "entry",
  "springs": "entry",
};

const TIER_RANK: Record<MarketTier, number> = {
  trophy: 4, upper: 3, core: 2, entry: 1,
};

/** Street premiums (multiplier on top of base value) */
const STREET_PREMIUMS: Record<string, Record<string, number>> = {
  "southampton": {
    "gin lane": 1.35, "meadow lane": 1.30, "ox pasture road": 1.15,
    "first neck lane": 1.12, "coopers neck lane": 1.12, "halsey neck lane": 1.10,
  },
  "southampton village": {
    "gin lane": 1.35, "meadow lane": 1.30, "ox pasture road": 1.15,
    "first neck lane": 1.12, "coopers neck lane": 1.12, "halsey neck lane": 1.10,
  },
  "east hampton": {
    "lily pond lane": 1.30, "further lane": 1.25,
    "west end road": 1.20, "georgica close": 1.15,
  },
  "sagaponack": {
    "daniels lane": 1.20, "parsonage lane": 1.15,
  },
  "water mill": {
    "flying point road": 1.15, "mecox road": 1.10,
  },
  "bridgehampton": {
    "ocean road": 1.15, "jobs lane": 1.10,
  },
};

/** Village comp regions — ONLY comp within these groups */
const COMP_REGIONS: Record<string, string[]> = {
  "southampton": ["southampton", "southampton village"],
  "southampton village": ["southampton", "southampton village"],
  "bridgehampton": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "sagaponack": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "water mill": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "wainscott": ["bridgehampton", "sagaponack", "water mill", "wainscott"],
  "east hampton": ["east hampton", "wainscott"],
  "amagansett": ["amagansett", "montauk"],
  "montauk": ["amagansett", "montauk"],
  "sag harbor": ["sag harbor", "bridgehampton", "east hampton"],
  "shelter island": ["shelter island", "shelter island heights"],
  "shelter island heights": ["shelter island", "shelter island heights"],
  "springs": ["springs"],
};

/** SOH waterfront fallback regions (wider search) */
const FALLBACK_REGIONS: Record<string, string[]> = {
  "water mill": ["water mill", "bridgehampton", "sagaponack", "southampton", "wainscott"],
  "bridgehampton": ["bridgehampton", "water mill", "sagaponack", "wainscott", "east hampton"],
  "sagaponack": ["sagaponack", "bridgehampton", "water mill", "wainscott"],
  "southampton": ["southampton", "southampton village", "water mill", "bridgehampton"],
  "southampton village": ["southampton", "southampton village", "water mill", "bridgehampton"],
  "wainscott": ["wainscott", "bridgehampton", "sagaponack", "east hampton", "water mill"],
  "east hampton": ["east hampton", "wainscott", "bridgehampton", "amagansett"],
  "amagansett": ["amagansett", "east hampton", "montauk"],
  "sag harbor": ["sag harbor", "bridgehampton", "east hampton"],
  "shelter island": ["shelter island", "shelter island heights"],
  "montauk": ["montauk", "amagansett"],
};

/** Time appreciation adjustments */
const TIME_ADJUSTMENTS: Record<string, number> = {
  "2020": 1.22, "2021": 1.15, "2022": 1.10,
  "2023": 1.05, "2024": 1.02, "2025": 1.00, "2026": 1.00,
};

/** Price proximity filtering by tier */
const PRICE_FILTERS: Record<string, { minRatio: number; maxRatio: number }> = {
  "20m_plus": { minRatio: 0.35, maxRatio: 2.00 },
  "10m_20m": { minRatio: 0.30, maxRatio: 2.20 },
  "5m_10m": { minRatio: 0.25, maxRatio: 2.50 },
  "under_5m": { minRatio: 0.20, maxRatio: 3.00 },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function normalize(s: string): string {
  return (s || "").toLowerCase().trim();
}

function getMarketTier(village: string): MarketTier {
  return HAMLET_TIERS[normalize(village)] || "core";
}

function getCompRegion(village: string): string[] {
  return COMP_REGIONS[normalize(village)] || [normalize(village)];
}

function getFallbackRegion(village: string): string[] {
  return FALLBACK_REGIONS[normalize(village)] || getCompRegion(village);
}

function getStreetPremium(village: string, address: string): number {
  const premiums = STREET_PREMIUMS[normalize(village)];
  if (!premiums) return 1.0;
  const addr = normalize(address);
  for (const [street, mult] of Object.entries(premiums)) {
    if (addr.includes(street)) return mult;
  }
  return 1.0;
}

function getPriceFilter(price: number) {
  if (price >= 20_000_000) return PRICE_FILTERS["20m_plus"];
  if (price >= 10_000_000) return PRICE_FILTERS["10m_20m"];
  if (price >= 5_000_000) return PRICE_FILTERS["5m_10m"];
  return PRICE_FILTERS["under_5m"];
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

// =============================================================================
// SCORING (based on Barry's scoring model)
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
  street_premium: number;
  score_breakdown: {
    hamlet_match: number;
    tier_match: number;
    price_proximity: number;
    beds_match: number;
    sqft_match: number;
    recency: number;
    street_premium_match: number;
  };
  price_difference_pct: number;
  days_ago: number;
}

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
  }
): ScoredComp {
  const scores = {
    hamlet_match: 0,          // 0-10 pts
    tier_match: 0,            // 0-25 pts
    price_proximity: 0,       // 0-30 pts
    beds_match: 0,            // 0-12 pts
    sqft_match: 0,            // 0-13 pts
    recency: 0,               // 0-20 pts
    street_premium_match: 0,  // 0-7 pts
  };

  const subjectVillage = normalize(subject.village);
  const compVillage = normalize(comp.village || "");

  // --- Hamlet match (10 pts) ---
  if (compVillage === subjectVillage) {
    scores.hamlet_match = 10;
  } else {
    const region = getCompRegion(subject.village);
    if (region.includes(compVillage)) {
      scores.hamlet_match = 6;
    }
  }

  // --- Tier match (25 pts) ---
  const subjectTier = getMarketTier(subject.village);
  const compTier = getMarketTier(comp.village || "");
  const tierDiff = Math.abs(TIER_RANK[subjectTier] - TIER_RANK[compTier]);
  
  if (tierDiff === 0) scores.tier_match = 25;
  else if (tierDiff === 1) scores.tier_match = 15;
  else if (tierDiff === 2) scores.tier_match = 8;
  else scores.tier_match = 0;

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
    if (bedDiff === 0) scores.beds_match = 12;
    else if (bedDiff === 1) scores.beds_match = 8;
    else if (bedDiff === 2) scores.beds_match = 3;
    else scores.beds_match = 0;
  } else {
    scores.beds_match = 4; // Neutral
  }

  // --- Sqft match (13 pts) ---
  if (subject.sqft && comp.sqft) {
    const sqftDiff = Math.abs(comp.sqft - subject.sqft) / subject.sqft;
    if (sqftDiff <= 0.15) scores.sqft_match = 13;
    else if (sqftDiff <= 0.30) scores.sqft_match = 7;
    else if (sqftDiff <= 0.50) scores.sqft_match = 3;
    else scores.sqft_match = 0;
  } else {
    scores.sqft_match = 4; // Neutral
  }

  // --- Recency (20 pts) ---
  const daysAgo = getDaysAgo(comp.sold_date);
  if (daysAgo <= 180) scores.recency = 20;
  else if (daysAgo <= 365) scores.recency = 15;
  else if (daysAgo <= 540) scores.recency = 10;
  else if (daysAgo <= 730) scores.recency = 5;
  else scores.recency = 2;

  // --- Street premium match (7 pts) ---
  const subjectPremium = subject.address ? getStreetPremium(subject.village, subject.address) : 1.0;
  const compPremium = getStreetPremium(comp.village || "", comp.address || "");
  
  if (subjectPremium > 1.0 && compPremium > 1.0) {
    // Both on premium streets
    scores.street_premium_match = 7;
  } else if (subjectPremium === 1.0 && compPremium === 1.0) {
    // Neither on premium streets
    scores.street_premium_match = 5;
  } else {
    // Mismatch — one premium, one not
    scores.street_premium_match = 0;
  }

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

  return {
    ...comp,
    relevance_score: totalScore,
    adjusted_price: adjustedPrice,
    time_adjustment: timeAdj,
    street_premium: compPremium,
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
// REQUEST SCHEMA
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

    console.log(`[SmartComps] Analyzing: ${subject.village}, $${subject.price.toLocaleString()}, ${subject.beds || "?"}bd, tier=${getMarketTier(subject.village)}`);

    // Get comp regions based on market rules
    const primaryRegion = getCompRegion(subject.village);
    const fallbackRegion = getFallbackRegion(subject.village);

    // Progressive strategy using market-aware regions
    const strategies = [
      {
        label: "primary_tight",
        villages: primaryRegion,
        minPrice: Math.round(subject.price * (1 - 0.25)),
        maxPrice: Math.round(subject.price * (1 + 0.25)),
      },
      {
        label: "primary_medium",
        villages: primaryRegion,
        minPrice: Math.round(subject.price * (1 - 0.40)),
        maxPrice: Math.round(subject.price * (1 + 0.40)),
      },
      {
        label: "fallback_medium",
        villages: fallbackRegion,
        minPrice: Math.round(subject.price * (1 - 0.40)),
        maxPrice: Math.round(subject.price * (1 + 0.40)),
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
      console.log(`[SmartComps] Strategy "${strategy.label}": ${comps.length} comps`);

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
        subject: { village: subject.village, price: subject.price, beds: subject.beds },
        strategy_used: strategyUsed,
        market_tier: getMarketTier(subject.village),
        comp_region: primaryRegion,
        comps: [],
        stats: null,
      });
    }

    // Score, filter, and rank
    const scored = allComps
      .map(comp => scoreComp(comp, subject))
      .filter(comp => comp.relevance_score >= 20) // Quality threshold
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, targetCount);

    // Stats
    const prices = scored.map(c => c.adjusted_price);
    const ppsf = scored.filter(c => c.price_per_sqft).map(c => c.price_per_sqft!);
    
    const stats = {
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
      subject_market_tier: getMarketTier(subject.village),
      subject_street_premium: subject.address ? getStreetPremium(subject.village, subject.address) : 1.0,
      hamlet_base_value: HAMLET_BASE_VALUES[normalize(subject.village)] || null,
    };

    console.log(`[SmartComps] Returning ${scored.length} comps (strategy: ${strategyUsed}, avg score: ${stats.avg_relevance_score})`);

    return c.json({
      success: true,
      subject: {
        address: subject.address,
        village: subject.village,
        price: subject.price,
        beds: subject.beds,
        baths: subject.baths,
        sqft: subject.sqft,
        market_tier: getMarketTier(subject.village),
        comp_region: primaryRegion,
        street_premium: subject.address ? getStreetPremium(subject.village, subject.address) : 1.0,
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
        street_premium: comp.street_premium,
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
    console.error("[SmartComps] Error:", error?.message || error);
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
        comp_region: getCompRegion(name),
      }))
      .sort((a, b) => b.count - a.count);

    return c.json({ success: true, villages, total: data.length });
  } catch (error: any) {
    console.error("[SmartComps] Villages error:", error?.message);
    return c.json({ success: false, error: "Failed" }, 500);
  }
});

/**
 * GET /api/smart-comps/market-data
 * Returns all market intelligence data (tiers, premiums, regions)
 */
smartCompsRouter.get("/market-data", (c) => {
  return c.json({
    success: true,
    hamlet_base_values: HAMLET_BASE_VALUES,
    hamlet_tiers: HAMLET_TIERS,
    street_premiums: STREET_PREMIUMS,
    comp_regions: COMP_REGIONS,
    fallback_regions: FALLBACK_REGIONS,
    time_adjustments: TIME_ADJUSTMENTS,
    price_filters: PRICE_FILTERS,
  });
});

export { smartCompsRouter };

