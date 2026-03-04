import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import type { Listing } from "@prisma/client";

// Create local prisma instance for this route (used for listings only)
const prisma = new PrismaClient();

const publicRouter = new Hono();

// ==================== SUPABASE CONFIG ====================

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tfzkenrmzoxrkdntkada.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";

// Map location names to market IDs used by the website
const LOCATION_TO_MARKET_ID: Record<string, string> = {
  "Hamptons": "hamptons",
  "Palm Beach": "palm-beach",
  "Miami": "miami",
  "Aspen": "aspen",
};

// Reverse mapping: market ID to location name for filtering
const MARKET_ID_TO_LOCATION: Record<string, string> = {
  "hamptons": "Hamptons",
  "palm-beach": "Palm Beach",
  "miami": "Miami",
  "aspen": "Aspen",
};

// Supabase generated_articles record shape
interface SupabaseArticle {
  id: string;
  title: string;
  subtitle?: string;
  excerpt: string;
  content: string;
  image_url: string;
  author: string;
  published_at: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  location: string;
  market_id?: string;
  reading_time: number;
  is_featured: boolean;
  pull_quote?: string;
  approval_status?: string;
  content_images?: string;
  created_at: string;
}

// Fetch articles from Supabase generated_articles table
async function fetchSupabaseArticles(filters?: {
  market?: string;
  category?: string;
  featured?: boolean;
  limit?: number;
}): Promise<SupabaseArticle[]> {
  // Build query: always filter by approval_status=approved, order by published_at desc
  let url = `${SUPABASE_URL}/rest/v1/generated_articles?select=*&approval_status=eq.approved&order=published_at.desc`;

  // Filter by location (market)
  if (filters?.market) {
    const locationName = MARKET_ID_TO_LOCATION[filters.market];
    if (locationName) {
      url += `&location=eq.${encodeURIComponent(locationName)}`;
    }
  }

  // Filter by category
  if (filters?.category) {
    url += `&category_slug=eq.${encodeURIComponent(filters.category)}`;
  }

  // Filter by featured
  if (filters?.featured) {
    url += `&is_featured=eq.true`;
  }

  // Limit
  if (filters?.limit) {
    url += `&limit=${filters.limit}`;
  }

  const response = await fetch(url, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!response.ok) {
    console.error("[Supabase] Articles fetch failed:", response.status, await response.text());
    return [];
  }

  return (await response.json()) as SupabaseArticle[];
}

// Transform a Supabase article to the website's expected format
function transformArticle(article: SupabaseArticle) {
  // Generate a slug from the title
  const slug = article.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);

  // Derive marketId from location field
  const marketId = LOCATION_TO_MARKET_ID[article.location] || article.market_id || "hamptons";

  return {
    id: article.id,
    slug,
    title: article.title,
    subtitle: article.subtitle || null,
    excerpt: article.excerpt,
    content: article.content,
    category: {
      slug: article.category_slug,
      name: article.category_name || getCategoryName(article.category_slug),
    },
    author: article.author,
    location: article.location,
    marketId,
    imageUrl: article.image_url,
    readingTime: article.reading_time,
    featured: article.is_featured,
    pullQuote: article.pull_quote || null,
    statCallout: undefined,
    publishedAt: article.published_at,
    contentImages: article.content_images || null,
  };
}

// ==================== ARTICLES (from Supabase) ====================

// Get all articles (optionally filtered by market)
publicRouter.get("/articles", async (c) => {
  try {
    const marketId = c.req.query("market");
    const category = c.req.query("category");
    const featured = c.req.query("featured");
    const limit = parseInt(c.req.query("limit") || "50");

    const articles = await fetchSupabaseArticles({
      market: marketId,
      category,
      featured: featured === "true",
      limit,
    });

    const transformed = articles.map(transformArticle);

    console.log(`[Public API] Fetched ${transformed.length} articles from Supabase${marketId ? ` (market: ${marketId})` : ""}`);

    return c.json({
      success: true,
      count: transformed.length,
      articles: transformed,
    });
  } catch (error: unknown) {
    console.error("[Public API] Error fetching articles:", error);
    return c.json({ error: "Failed to fetch articles" }, 500);
  }
});

// Get single article by slug (search by matching title-derived slug)
publicRouter.get("/articles/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");

    // Fetch all approved articles and find by slug match
    const articles = await fetchSupabaseArticles({ limit: 200 });
    const match = articles.find((a) => {
      const articleSlug = a.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 80);
      return articleSlug === slug;
    });

    if (!match) {
      // Also try matching by ID as fallback
      const byId = articles.find((a) => a.id === slug);
      if (!byId) {
        return c.json({ error: "Article not found" }, 404);
      }
      return c.json({ success: true, article: transformArticle(byId) });
    }

    return c.json({ success: true, article: transformArticle(match) });
  } catch (error: unknown) {
    console.error("[Public API] Error fetching article:", error);
    return c.json({ error: "Failed to fetch article" }, 500);
  }
});

// POST /articles - Create/upsert an article in Supabase
publicRouter.post("/articles", async (c) => {
  try {
    const body = await c.req.json();

    // Transform from website/mobile format to Supabase column format
    const supabaseRecord: Record<string, unknown> = {
      title: body.title,
      subtitle: body.subtitle || null,
      excerpt: body.excerpt || "",
      content: body.content || "",
      image_url: body.imageUrl || "",
      author: body.author || "Hamptons Coastal",
      published_at: body.publishedAt || new Date().toISOString(),
      category_slug: body.category || "market",
      category_name: getCategoryName(body.category || "market"),
      location: body.location || "Hamptons",
      market_id: body.marketId || LOCATION_TO_MARKET_ID[body.location] || "hamptons",
      reading_time: body.readingTime || 5,
      is_featured: body.featured || false,
      pull_quote: body.pullQuote || null,
      approval_status: body.approvalStatus || "approved",
    };

    // Include id if provided
    if (body.id) {
      supabaseRecord.id = body.id;
    }

    const upsertUrl = `${SUPABASE_URL}/rest/v1/generated_articles`;
    const upsertResponse = await fetch(upsertUrl, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(supabaseRecord),
    });

    if (!upsertResponse.ok) {
      const errText = await upsertResponse.text();
      console.error("[Public API] Supabase article upsert failed:", upsertResponse.status, errText);
      return c.json({ error: "Failed to create article", details: errText }, 500);
    }

    console.log("[Public API] Article upserted in Supabase:", body.title);
    return c.json({ success: true }, 201);
  } catch (error: unknown) {
    console.error("[Public API] Error creating article:", error);
    const message = error instanceof Error ? error.message : "Failed to create article";
    return c.json({ error: message }, 500);
  }
});

// PUT /articles/:slug - Update an article in Supabase by slug
publicRouter.put("/articles/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const body = await c.req.json();

    // Find the article by slug
    const allArticlesUrl = `${SUPABASE_URL}/rest/v1/generated_articles?select=id,title&order=published_at.desc&limit=500`;
    const allArticlesResponse = await fetch(allArticlesUrl, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!allArticlesResponse.ok) {
      console.error("[Public API] Failed to fetch articles for update:", allArticlesResponse.status);
      return c.json({ error: "Failed to fetch articles" }, 500);
    }

    const allArticles = (await allArticlesResponse.json()) as Array<{ id: string; title: string }>;

    const match = allArticles.find((a) => {
      const articleSlug = a.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 80);
      return articleSlug === slug;
    });

    const target = match || allArticles.find((a) => a.id === slug);

    if (!target) {
      return c.json({ error: "Article not found" }, 404);
    }

    // Build update payload - only include fields that were sent
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.subtitle !== undefined) updates.subtitle = body.subtitle;
    if (body.excerpt !== undefined) updates.excerpt = body.excerpt;
    if (body.content !== undefined) updates.content = body.content;
    if (body.imageUrl !== undefined) updates.image_url = body.imageUrl;
    if (body.author !== undefined) updates.author = body.author;
    if (body.category !== undefined) {
      updates.category_slug = body.category;
      updates.category_name = getCategoryName(body.category);
    }
    if (body.location !== undefined) updates.location = body.location;
    if (body.marketId !== undefined) updates.market_id = body.marketId;
    if (body.readingTime !== undefined) updates.reading_time = body.readingTime;
    if (body.featured !== undefined) updates.is_featured = body.featured;
    if (body.pullQuote !== undefined) updates.pull_quote = body.pullQuote;
    if (body.approvalStatus !== undefined) updates.approval_status = body.approvalStatus;
    if (body.publishedAt !== undefined) updates.published_at = body.publishedAt;

    if (Object.keys(updates).length === 0) {
      return c.json({ success: true, message: "No updates provided" });
    }

    const patchUrl = `${SUPABASE_URL}/rest/v1/generated_articles?id=eq.${target.id}`;
    const patchResponse = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(updates),
    });

    if (!patchResponse.ok) {
      const errText = await patchResponse.text();
      console.error("[Public API] Supabase article update failed:", patchResponse.status, errText);
      return c.json({ error: "Failed to update article" }, 500);
    }

    console.log("[Public API] Article updated in Supabase:", target.id, slug);
    return c.json({ success: true });
  } catch (error: unknown) {
    console.error("[Public API] Error updating article:", error);
    return c.json({ error: "Failed to update article" }, 500);
  }
});

// DELETE /articles/:slug - Delete an article from Supabase by slug
publicRouter.delete("/articles/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");

    // Fetch ALL articles (not just approved) so we can find and delete any article
    const allArticlesUrl = `${SUPABASE_URL}/rest/v1/generated_articles?select=id,title&order=published_at.desc&limit=500`;
    const allArticlesResponse = await fetch(allArticlesUrl, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!allArticlesResponse.ok) {
      console.error("[Public API] Failed to fetch articles for delete:", allArticlesResponse.status);
      return c.json({ error: "Failed to fetch articles" }, 500);
    }

    const allArticles = (await allArticlesResponse.json()) as Array<{ id: string; title: string }>;

    // Find by slug match
    const match = allArticles.find((a) => {
      const articleSlug = a.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 80);
      return articleSlug === slug;
    });

    // Also try matching by ID as fallback
    const target = match || allArticles.find((a) => a.id === slug);

    if (!target) {
      return c.json({ error: "Article not found" }, 404);
    }

    // Delete by ID
    const deleteUrl = `${SUPABASE_URL}/rest/v1/generated_articles?id=eq.${target.id}`;
    const deleteResponse = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!deleteResponse.ok) {
      console.error("[Public API] Supabase delete failed:", deleteResponse.status, await deleteResponse.text());
      return c.json({ error: "Failed to delete article from Supabase" }, 500);
    }

    console.log("[Public API] Deleted article from Supabase:", target.id, slug);
    return c.json({ success: true });
  } catch (error: unknown) {
    console.error("[Public API] Error deleting article:", error);
    return c.json({ error: "Failed to delete article" }, 500);
  }
});

// ==================== LISTINGS (still from local Prisma DB) ====================

// Get all listings (optionally filtered by market)
publicRouter.get("/listings", async (c) => {
  try {
    const marketId = c.req.query("market");
    const featured = c.req.query("featured");
    const limit = parseInt(c.req.query("limit") || "50");

    const where: {
      market_id?: string;
      featured?: boolean;
    } = {};

    if (marketId) where.market_id = marketId;
    if (featured === "true") where.featured = true;

    const listings = await prisma.listing.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
    });

    // Transform to match website's expected format
    const transformed = listings.map((listing: Listing) => ({
      id: listing.id,
      address: listing.address,
      village: listing.village,
      marketId: listing.market_id,
      price: listing.price,
      listingType: listing.listing_type,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft,
      acres: listing.acres,
      yearBuilt: listing.year_built,
      imageUrl: listing.image_url,
      imageUrls: listing.image_urls ? JSON.parse(listing.image_urls) : undefined,
      brokerName: listing.broker_name,
      brokerCompany: listing.broker_company,
      brokerPhone: listing.broker_phone,
      brokerEmail: listing.broker_email,
      description: listing.description,
      featured: listing.featured,
      isEditorsPick: listing.is_editors_pick,
      latitude: listing.latitude,
      longitude: listing.longitude,
      createdAt: listing.created_at.toISOString(),
    }));

    return c.json({
      success: true,
      count: transformed.length,
      listings: transformed,
    });
  } catch (error: unknown) {
    console.error("[Public API] Error fetching listings:", error);
    return c.json({ error: "Failed to fetch listings" }, 500);
  }
});

// Get single listing by ID
publicRouter.get("/listings/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const listing = await prisma.listing.findUnique({
      where: { id },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    return c.json({
      success: true,
      listing: {
        id: listing.id,
        address: listing.address,
        village: listing.village,
        marketId: listing.market_id,
        price: listing.price,
        listingType: listing.listing_type,
        beds: listing.beds,
        baths: listing.baths,
        sqft: listing.sqft,
        acres: listing.acres,
        yearBuilt: listing.year_built,
        imageUrl: listing.image_url,
        imageUrls: listing.image_urls ? JSON.parse(listing.image_urls) : undefined,
        brokerName: listing.broker_name,
        brokerCompany: listing.broker_company,
        brokerPhone: listing.broker_phone,
        brokerEmail: listing.broker_email,
        description: listing.description,
        featured: listing.featured,
        isEditorsPick: listing.is_editors_pick,
        latitude: listing.latitude,
        longitude: listing.longitude,
        createdAt: listing.created_at.toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error("[Public API] Error fetching listing:", error);
    return c.json({ error: "Failed to fetch listing" }, 500);
  }
});

// POST /listings - Create a new listing
publicRouter.post("/listings", async (c) => {
  try {
    const body = await c.req.json();

    const listing = await prisma.listing.create({
      data: {
        id: body.id || crypto.randomUUID(),
        address: body.address,
        village: body.village,
        market_id: body.marketId || 'hamptons',
        price: body.price,
        listing_type: body.listingType || 'sale',
        beds: body.beds,
        baths: body.baths,
        sqft: body.sqft,
        acres: body.acres || null,
        year_built: body.yearBuilt || null,
        image_url: body.imageUrl,
        image_urls: body.imageUrls ? JSON.stringify(body.imageUrls) : null,
        broker_name: body.brokerName,
        broker_company: body.brokerCompany,
        broker_phone: body.brokerPhone || null,
        broker_email: body.brokerEmail || null,
        description: body.description,
        featured: body.featured || false,
        is_editors_pick: body.isEditorsPick || false,
        latitude: body.latitude || null,
        longitude: body.longitude || null,
      },
    });

    console.log("[Public API] Created listing:", listing.id);
    return c.json({ success: true, listing: { id: listing.id } }, 201);
  } catch (error: unknown) {
    console.error("[Public API] Error creating listing:", error);
    const message = error instanceof Error ? error.message : "Failed to create listing";
    return c.json({ error: message }, 500);
  }
});

// PUT /listings/:id - Update a listing
publicRouter.put("/listings/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    const data: Record<string, unknown> = {};
    if (body.address !== undefined) data.address = body.address;
    if (body.village !== undefined) data.village = body.village;
    if (body.marketId !== undefined) data.market_id = body.marketId;
    if (body.price !== undefined) data.price = body.price;
    if (body.beds !== undefined) data.beds = body.beds;
    if (body.baths !== undefined) data.baths = body.baths;
    if (body.sqft !== undefined) data.sqft = body.sqft;
    if (body.acres !== undefined) data.acres = body.acres;
    if (body.imageUrl !== undefined) data.image_url = body.imageUrl;
    if (body.imageUrls !== undefined) data.image_urls = JSON.stringify(body.imageUrls);
    if (body.description !== undefined) data.description = body.description;
    if (body.featured !== undefined) data.featured = body.featured;
    if (body.isEditorsPick !== undefined) data.is_editors_pick = body.isEditorsPick;
    if (body.brokerName !== undefined) data.broker_name = body.brokerName;
    if (body.brokerCompany !== undefined) data.broker_company = body.brokerCompany;
    if (body.brokerPhone !== undefined) data.broker_phone = body.brokerPhone;
    if (body.brokerEmail !== undefined) data.broker_email = body.brokerEmail;
    if (body.latitude !== undefined) data.latitude = body.latitude;
    if (body.longitude !== undefined) data.longitude = body.longitude;

    await prisma.listing.upsert({
      where: { id },
      update: data,
      create: {
        id,
        address: body.address || '',
        village: body.village || '',
        market_id: body.marketId || 'hamptons',
        price: body.price || 0,
        listing_type: body.listingType || 'sale',
        beds: body.beds || 0,
        baths: body.baths || 0,
        sqft: body.sqft || 0,
        acres: body.acres || null,
        year_built: body.yearBuilt || null,
        image_url: body.imageUrl || '',
        image_urls: body.imageUrls ? JSON.stringify(body.imageUrls) : null,
        broker_name: body.brokerName || '',
        broker_company: body.brokerCompany || '',
        broker_phone: body.brokerPhone || null,
        broker_email: body.brokerEmail || null,
        description: body.description || '',
        featured: body.featured || false,
        is_editors_pick: body.isEditorsPick || false,
        latitude: body.latitude || null,
        longitude: body.longitude || null,
        ...data,
      },
    });

    console.log("[Public API] Upserted listing:", id);
    return c.json({ success: true });
  } catch (error: unknown) {
    console.error("[Public API] Error updating listing:", error);
    return c.json({ error: "Failed to update listing" }, 500);
  }
});

// DELETE /listings/:id - Delete a listing
publicRouter.delete("/listings/:id", async (c) => {
  try {
    const id = c.req.param("id");
    await prisma.listing.delete({ where: { id } });
    console.log("[Public API] Deleted listing:", id);
    return c.json({ success: true });
  } catch (error: unknown) {
    console.error("[Public API] Error deleting listing:", error);
    return c.json({ error: "Failed to delete listing" }, 500);
  }
});

// ==================== MARKETS ====================

publicRouter.get("/markets", (c) => {
  const markets = [
    {
      id: "hamptons",
      name: "The Hamptons",
      shortName: "Hamptons",
      description: "Luxury real estate on Long Island's East End",
      region: "New York",
    },
    {
      id: "palm-beach",
      name: "Palm Beach",
      shortName: "Palm Beach",
      description: "Florida's premier oceanfront luxury market",
      region: "Florida",
    },
    {
      id: "miami",
      name: "Miami",
      shortName: "Miami",
      description: "South Florida's vibrant luxury real estate scene",
      region: "Florida",
    },
    {
      id: "aspen",
      name: "Aspen",
      shortName: "Aspen",
      description: "Colorado's premier mountain luxury destination",
      region: "Colorado",
    },
  ];

  return c.json({ success: true, markets });
});

// ==================== CATEGORIES ====================

publicRouter.get("/categories", (c) => {
  const categories = [
    { slug: "trades", name: "Trades" },
    { slug: "market", name: "Market" },
    { slug: "insights", name: "Insights" },
    { slug: "policy", name: "Policy" },
    { slug: "listings", name: "Listings" },
  ];

  return c.json({ success: true, categories });
});

// Helper function to get category name
function getCategoryName(slug: string): string {
  const categories: Record<string, string> = {
    trades: "Trades",
    market: "Market",
    insights: "Insights",
    policy: "Policy",
    listings: "Listings",
  };
  return categories[slug] || slug;
}

// ==================== PROFILE COMPLETION ====================

// POST /api/profile/complete - Save profile completion data
publicRouter.post("/profile/complete", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email, full_name, preferred_email } = body;

    if (!email) {
      return c.json({ success: false, error: "Email is required" }, 400);
    }

    console.log("[Profile] Completing profile for:", email);

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Create user if doesn't exist
      const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          referral_code: referralCode,
          full_name: full_name || null,
          preferred_email: preferred_email || null,
          profile_completed: true,
        },
      });
      console.log("[Profile] Created new user with profile:", user.id);
    } else {
      // Update existing user
      user = await prisma.user.update({
        where: { email: email.toLowerCase() },
        data: {
          full_name: full_name || user.full_name,
          preferred_email: preferred_email || user.preferred_email,
          profile_completed: true,
          profile_skipped_at: null, // Clear skip timestamp since they completed
        },
      });
      console.log("[Profile] Updated profile for user:", user.id);
    }

    console.log("[Profile] Backend storage confirmed: user_id", user.id);

    return c.json({
      success: true,
      data: {
        id: user.id,
        full_name: user.full_name,
        preferred_email: user.preferred_email,
        profile_completed: user.profile_completed,
      },
    });
  } catch (error) {
    console.error("[Profile] Error completing profile:", error);
    return c.json({ success: false, error: "Failed to complete profile" }, 500);
  }
});

// POST /api/profile/skip - Track profile skip
publicRouter.post("/profile/skip", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email } = body;

    if (!email) {
      return c.json({ success: false, error: "Email is required" }, 400);
    }

    console.log("[Profile] Skipping profile for:", email);

    let user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (user) {
      user = await prisma.user.update({
        where: { email: email.toLowerCase() },
        data: {
          profile_skipped_at: new Date(),
        },
      });
      console.log("[Profile] Skip tracked for user:", user.id);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("[Profile] Error tracking skip:", error);
    return c.json({ success: false, error: "Failed to track skip" }, 500);
  }
});

// GET /api/user/id/:email - Get or create user ID for RevenueCat
// This ensures a consistent DB user ID is used for RevenueCat logIn
publicRouter.get("/user/id/:email", async (c) => {
  try {
    const email = c.req.param("email");

    if (!email) {
      return c.json({ success: false, error: "Email is required" }, 400);
    }

    const emailLower = email.toLowerCase();
    console.log("[RevenueCat] Getting user ID for:", emailLower);

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });

    if (!user) {
      // Create user if doesn't exist - this ensures we have a consistent ID
      const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      user = await prisma.user.create({
        data: {
          email: emailLower,
          referral_code: referralCode,
        },
        select: { id: true },
      });
      console.log("[RevenueCat] Created new user for RC:", user.id);
    }

    console.log("[RevenueCat] Returning user ID:", user.id);

    return c.json({
      success: true,
      data: {
        user_id: user.id,
      },
    });
  } catch (error) {
    console.error("[RevenueCat] Error getting user ID:", error);
    return c.json({ success: false, error: "Failed to get user ID" }, 500);
  }
});

// GET /api/profile/status - Check profile completion status
publicRouter.get("/profile/status/:email", async (c) => {
  try {
    const email = c.req.param("email");

    if (!email) {
      return c.json({ success: false, error: "Email is required" }, 400);
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        full_name: true,
        preferred_email: true,
        profile_completed: true,
        profile_skipped_at: true,
      },
    });

    if (!user) {
      return c.json({
        success: true,
        data: {
          profile_completed: false,
          should_show_prompt: true,
        },
      });
    }

    // Check if we should show prompt again (once per week after skip)
    let shouldShowPrompt = false;
    if (!user.profile_completed) {
      if (!user.profile_skipped_at) {
        shouldShowPrompt = true;
      } else {
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        shouldShowPrompt = user.profile_skipped_at < oneWeekAgo;
      }
    }

    return c.json({
      success: true,
      data: {
        full_name: user.full_name,
        preferred_email: user.preferred_email,
        profile_completed: user.profile_completed,
        should_show_prompt: shouldShowPrompt,
      },
    });
  } catch (error) {
    console.error("[Profile] Error checking status:", error);
    return c.json({ success: false, error: "Failed to check status" }, 500);
  }
});

// ==================== PUBLIC AGENT PROFILES ====================

// GET /agent-profile/:email - Fetch a real agent's public profile
// Returns null if the email doesn't belong to a verified agent
publicRouter.get("/agent-profile/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();

    // Check if this is a real verified agent (approved in AgentRequest table)
    const agentRequest = await prisma.agentRequest.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        license_number: true,
        broker_company: true,
        agent_number: true,
        status: true,
      },
    });

    // Only return profile for approved agents
    if (!agentRequest || agentRequest.status !== 'approved') {
      return c.json({ success: true, data: null });
    }

    // Get the user record for additional profile data (photo, bio, etc.)
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        phone: true,
        tier: true,
      },
    });

    // Get agent's submitted listings (only approved ones)
    const agentListings = await prisma.agentListingSubmission.findMany({
      where: {
        agent_email: email,
        status: 'approved',
      },
      orderBy: { submitted_at: 'desc' },
    });

    return c.json({
      success: true,
      data: {
        isRealAgent: true,
        name: agentRequest.name,
        email: agentRequest.email,
        phone: agentRequest.phone || user?.phone,
        licenseNumber: agentRequest.license_number,
        brokerCompany: agentRequest.broker_company,
        agentNumber: agentRequest.agent_number,
        tier: user?.tier || 'verified',
        listings: agentListings.map((l) => ({
          id: l.id,
          address: l.address,
          village: l.village,
          marketId: l.market_id,
          price: l.price,
          listingType: l.listing_type,
          propertyType: l.property_type,
          beds: l.beds,
          baths: l.baths,
          sqft: l.sqft,
          acres: l.acres,
          yearBuilt: l.year_built,
          description: l.description,
          imageUrl: l.image_url,
          imageUrls: l.image_urls ? JSON.parse(l.image_urls) : [],
          listingStatus: l.listing_status,
          submittedAt: l.submitted_at.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("[Public API] Error fetching agent profile:", error);
    return c.json({ success: false, error: "Failed to fetch agent profile" }, 500);
  }
});

// GET /agent-profile-by-name/:name - Search for real agent by name
// Used when clicking on a listing's broker name
publicRouter.get("/agent-profile-by-name/:name", async (c) => {
  try {
    const name = decodeURIComponent(c.req.param("name")).trim();
    const nameLower = name.toLowerCase();

    // Search for approved agents with matching name (manual case-insensitive for SQLite)
    const allApprovedAgents = await prisma.agentRequest.findMany({
      where: { status: 'approved' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        license_number: true,
        broker_company: true,
        agent_number: true,
      },
    });

    // Find matching agent (case-insensitive)
    const agentRequest = allApprovedAgents.find(
      (a) => a.name.toLowerCase() === nameLower
    );

    if (!agentRequest) {
      // No real agent found - this is just a listing broker (editor's pick)
      return c.json({ success: true, data: null, isEditorsPick: true });
    }

    // Get agent's submitted listings
    const agentListings = await prisma.agentListingSubmission.findMany({
      where: {
        agent_email: agentRequest.email,
        status: 'approved',
      },
      orderBy: { submitted_at: 'desc' },
    });

    return c.json({
      success: true,
      data: {
        isRealAgent: true,
        name: agentRequest.name,
        email: agentRequest.email,
        phone: agentRequest.phone,
        licenseNumber: agentRequest.license_number,
        brokerCompany: agentRequest.broker_company,
        agentNumber: agentRequest.agent_number,
        listings: agentListings.map((l) => ({
          id: l.id,
          address: l.address,
          village: l.village,
          marketId: l.market_id,
          price: l.price,
          listingType: l.listing_type,
          beds: l.beds,
          baths: l.baths,
          sqft: l.sqft,
          imageUrl: l.image_url,
          listingStatus: l.listing_status,
          submittedAt: l.submitted_at.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("[Public API] Error searching agent by name:", error);
    return c.json({ success: false, error: "Failed to search agent" }, 500);
  }
});

// GET /api/public/sync-status - Check if approved agent listings need syncing
publicRouter.get("/sync-status", async (c) => {
  try {
    let agentSubmissionsCount = 0;
    let agentSubmissionsError = null;
    
    try {
      agentSubmissionsCount = await prisma.agentListingSubmission.count();
    } catch (err) {
      agentSubmissionsError = err.message;
    }

    const totalListings = await prisma.listing.count();
    
    return c.json({
      success: true,
      agent_submissions_count: agentSubmissionsCount,
      agent_submissions_error: agentSubmissionsError,
      total_listings: totalListings,
      database_status: agentSubmissionsError ? 'agent_table_missing' : 'ok'
    });
  } catch (error) {
    console.error("[Public API] Error checking sync status:", error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export { publicRouter };