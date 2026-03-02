/**
 * Smart Comp Analysis API
 * 
 * Queries Supabase comparable_sales with intelligent filtering:
 * - Tight price band (±30%, expandable to ±50% if too few results)
 * - Village matching with adjacent village fallback
 * - Property type matching (beds ±1, baths ±2)
 * - Recency preference (last 12 months first, then 24, then all)
 * - Relevance scoring and ranking
 */

import { Hono } from "hono";
import { z } from "zod";

const smartCompsRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tfzkenrmzoxrkdntkada.supabase.co";
// Fall back to the publishable anon key (this is a PUBLIC key, safe to include)
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmemtlbnJtem94cmtkbnRrYWRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5OTc0OTcsImV4cCI6MjA4MzU3MzQ5N30.6IxBDHMp0TbeJdRr0114fdnsCHyrRoaIcyG5jKdPAV8";

// Adjacent village mapping for the Hamptons
const ADJACENT_VILLAGES: Record<string, string[]> = {
  "southampton village": ["water mill", "bridgehampton", "sagaponack"],
  "water mill": ["southampton village", "bridgehampton", "sagaponack"],
  "bridgehampton": ["water mill", "sagaponack", "sag harbor", "east hampton"],
  "sagaponack": ["bridgehampton", "water mill", "southampton village"],
  "east hampton": ["amagansett", "bridgehampton", "sag harbor"],
  "sag harbor": ["bridgehampton", "east hampton", "shelter island"],
  "amagansett": ["east hampton", "montauk"],
  "montauk": ["amagansett"],
  "shelter island": ["sag harbor", "shelter island heights"],
  "shelter island heights": ["shelter island", "sag harbor"],
};

const smartCompSchema = z.object({
  address: z.string().optional(),
  village: z.string(),
  price: z.number().min(100000, "Price must be at least $100,000"),
  beds: z.number().optional(),
  baths: z.number().optional(),
  sqft: z.number().optional(),
  lot_acres: z.number().optional(),
  max_results: z.number().min(3).max(20).optional().default(10),
});

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
  score_breakdown: {
    price_match: number;
    village_match: number;
    size_match: number;
    recency: number;
    beds_match: number;
  };
  price_difference_pct: number;
  days_ago: number;
}

/**
 * Score a comp's relevance to the subject property (0-100)
 */
function scoreComp(
  comp: CompSale,
  subject: {
    village: string;
    price: number;
    beds?: number;
    baths?: number;
    sqft?: number;
    lot_acres?: number;
  }
): ScoredComp {
  const scores = {
    price_match: 0,    // 0-35 points
    village_match: 0,  // 0-30 points
    size_match: 0,     // 0-15 points
    recency: 0,        // 0-10 points
    beds_match: 0,     // 0-10 points
  };

  // --- Price match (35 points max) ---
  const priceDiff = Math.abs(comp.sold_price - subject.price) / subject.price;
  if (priceDiff <= 0.10) scores.price_match = 35;
  else if (priceDiff <= 0.20) scores.price_match = 30;
  else if (priceDiff <= 0.30) scores.price_match = 25;
  else if (priceDiff <= 0.40) scores.price_match = 15;
  else if (priceDiff <= 0.50) scores.price_match = 8;
  else scores.price_match = 0;

  // --- Village match (30 points max) ---
  const compVillage = (comp.village || "").toLowerCase().trim();
  const subjectVillage = subject.village.toLowerCase().trim();
  
  if (compVillage === subjectVillage) {
    scores.village_match = 30;
  } else {
    const adjacents = ADJACENT_VILLAGES[subjectVillage] || [];
    if (adjacents.includes(compVillage)) {
      scores.village_match = 15;
    } else {
      scores.village_match = 0;
    }
  }

  // --- Size match (15 points max) ---
  if (subject.sqft && comp.sqft) {
    const sqftDiff = Math.abs(comp.sqft - subject.sqft) / subject.sqft;
    if (sqftDiff <= 0.15) scores.size_match = 15;
    else if (sqftDiff <= 0.30) scores.size_match = 10;
    else if (sqftDiff <= 0.50) scores.size_match = 5;
  } else if (subject.lot_acres && comp.lot_acres) {
    const lotDiff = Math.abs(comp.lot_acres - subject.lot_acres) / subject.lot_acres;
    if (lotDiff <= 0.25) scores.size_match = 12;
    else if (lotDiff <= 0.50) scores.size_match = 7;
  } else {
    scores.size_match = 5; // Neutral if no size data
  }

  // --- Recency (10 points max) ---
  let daysAgo = 999;
  if (comp.sold_date) {
    const soldDate = new Date(comp.sold_date);
    daysAgo = Math.floor((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysAgo <= 180) scores.recency = 10;
    else if (daysAgo <= 365) scores.recency = 8;
    else if (daysAgo <= 730) scores.recency = 5;
    else if (daysAgo <= 1095) scores.recency = 2;
    else scores.recency = 0;
  }

  // --- Beds match (10 points max) ---
  if (subject.beds && comp.beds) {
    const bedDiff = Math.abs(comp.beds - subject.beds);
    if (bedDiff === 0) scores.beds_match = 10;
    else if (bedDiff === 1) scores.beds_match = 7;
    else if (bedDiff === 2) scores.beds_match = 3;
    else scores.beds_match = 0;
  } else {
    scores.beds_match = 3; // Neutral
  }

  const totalScore = scores.price_match + scores.village_match + scores.size_match + scores.recency + scores.beds_match;

  return {
    ...comp,
    relevance_score: totalScore,
    score_breakdown: scores,
    price_difference_pct: Math.round(((comp.sold_price - subject.price) / subject.price) * 100),
    days_ago: daysAgo,
  };
}

/**
 * Fetch comps from Supabase with progressive widening
 */
async function fetchCompsFromSupabase(
  village: string,
  minPrice: number,
  maxPrice: number,
  additionalVillages?: string[],
): Promise<CompSale[]> {
  if (!SUPABASE_KEY) {
    throw new Error("SUPABASE_ANON_KEY not configured");
  }

  // Build village filter
  const villages = [village];
  if (additionalVillages) {
    villages.push(...additionalVillages);
  }

  // Use Supabase REST API with filters
  // ilike for case-insensitive matching
  const villageFilter = villages.map(v => `village.ilike.${encodeURIComponent(v)}`).join(",");
  const url = `${SUPABASE_URL}/rest/v1/comparable_sales?select=*&or=(${villageFilter})&sold_price=gte.${minPrice}&sold_price=lte.${maxPrice}&order=sold_price.desc&limit=200`;
  
  console.log(`[SmartComps] Supabase URL: ${url.replace(SUPABASE_URL, '...')}`);

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

/**
 * POST /api/smart-comps/analyze
 * 
 * Returns ranked comparable sales for a subject property.
 * Uses progressive widening: tight filters first, then expands if too few results.
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

    console.log(`[SmartComps] Analyzing: ${subject.village}, $${subject.price.toLocaleString()}, ${subject.beds || "?"}bd/${subject.baths || "?"}ba`);

    // Progressive widening strategy
    const strategies = [
      // Round 1: Tight — same village, ±25% price
      {
        label: "tight",
        villages: [subject.village],
        priceRange: 0.25,
      },
      // Round 2: Medium — same village, ±40% price  
      {
        label: "medium",
        villages: [subject.village],
        priceRange: 0.40,
      },
      // Round 3: Wide — same + adjacent villages, ±40% price
      {
        label: "wide",
        villages: [
          subject.village,
          ...(ADJACENT_VILLAGES[subject.village.toLowerCase().trim()] || []),
        ],
        priceRange: 0.40,
      },
      // Round 4: Widest — same + adjacent villages, ±60% price
      {
        label: "widest",
        villages: [
          subject.village,
          ...(ADJACENT_VILLAGES[subject.village.toLowerCase().trim()] || []),
        ],
        priceRange: 0.60,
      },
    ];

    let allComps: CompSale[] = [];
    let strategyUsed = "none";

    for (const strategy of strategies) {
      const minPrice = Math.round(subject.price * (1 - strategy.priceRange));
      const maxPrice = Math.round(subject.price * (1 + strategy.priceRange));

      console.log(`[SmartComps] Strategy "${strategy.label}": villages=[${strategy.villages.join(", ")}], price=$${minPrice.toLocaleString()}-$${maxPrice.toLocaleString()}`);

      const comps = await fetchCompsFromSupabase(
        strategy.villages[0],
        minPrice,
        maxPrice,
        strategy.villages.slice(1),
      );

      console.log(`[SmartComps] Strategy "${strategy.label}" returned ${comps.length} comps`);

      if (comps.length >= 5) {
        allComps = comps;
        strategyUsed = strategy.label;
        break;
      }

      // If we got some but not enough, keep them and try wider
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
          baths: subject.baths,
        },
        strategy_used: strategyUsed,
        comps: [],
        stats: null,
      });
    }

    // Score and rank all comps
    const scored = allComps
      .map(comp => scoreComp(comp, subject))
      .filter(comp => comp.relevance_score >= 15) // Minimum quality threshold
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, targetCount);

    // Calculate aggregate stats from the top comps
    const compPrices = scored.map(c => c.sold_price);
    const compPpsf = scored.filter(c => c.price_per_sqft).map(c => c.price_per_sqft!);
    
    const stats = {
      comp_count: scored.length,
      avg_price: Math.round(compPrices.reduce((a, b) => a + b, 0) / compPrices.length),
      median_price: compPrices.sort((a, b) => a - b)[Math.floor(compPrices.length / 2)],
      min_price: Math.min(...compPrices),
      max_price: Math.max(...compPrices),
      avg_price_per_sqft: compPpsf.length > 0
        ? Math.round(compPpsf.reduce((a, b) => a + b, 0) / compPpsf.length)
        : null,
      avg_days_ago: Math.round(scored.reduce((a, b) => a + b.days_ago, 0) / scored.length),
      avg_relevance_score: Math.round(scored.reduce((a, b) => a + b.relevance_score, 0) / scored.length),
      suggested_value_range: {
        low: Math.round(Math.min(...compPrices) * 0.95),
        high: Math.round(Math.max(...compPrices) * 1.05),
      },
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
      },
      strategy_used: strategyUsed,
      comps: scored.map(comp => ({
        address: comp.address,
        village: comp.village,
        sold_price: comp.sold_price,
        sold_date: comp.sold_date,
        beds: comp.beds,
        baths: comp.baths,
        sqft: comp.sqft,
        lot_acres: comp.lot_acres,
        price_per_sqft: comp.price_per_sqft,
        relevance_score: comp.relevance_score,
        score_breakdown: comp.score_breakdown,
        price_difference_pct: comp.price_difference_pct,
        days_ago: comp.days_ago,
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
 * Returns list of available villages with comp counts
 */
smartCompsRouter.get("/villages", async (c) => {
  try {
    if (!SUPABASE_KEY) {
      return c.json({ success: false, error: "Supabase not configured" }, 500);
    }

    const url = `${SUPABASE_URL}/rest/v1/comparable_sales?select=village&limit=5007`;
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!res.ok) {
      return c.json({ success: false, error: "Failed to fetch villages" }, 500);
    }

    const data = await res.json() as Array<{ village: string }>;
    const counts: Record<string, number> = {};
    for (const row of data) {
      const v = row.village || "Unknown";
      counts[v] = (counts[v] || 0) + 1;
    }

    const villages = Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return c.json({ success: true, villages, total: data.length });
  } catch (error) {
    console.error("[SmartComps] Villages error:", error);
    return c.json({ success: false, error: "Failed to fetch villages" }, 500);
  }
});

export { smartCompsRouter };
