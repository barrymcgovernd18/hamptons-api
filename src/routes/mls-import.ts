import { Hono } from "hono";

const mlsImportRouter = new Hono();

const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY || "";

// =============================================================================
// TYPES
// =============================================================================

interface MLSParseResult {
  address?: string;
  village?: string;
  state?: string;
  zipCode?: string;
  price?: string;
  beds?: string;
  baths?: string;
  sqft?: string;
  acres?: string;
  yearBuilt?: string;
  propertyType?: string;
  description?: string;
  brokerName?: string;
  brokerCompany?: string;
  brokerPhone?: string;
  brokerEmail?: string;
  imageUrls?: string[];
  mlsNumber?: string;
}

// =============================================================================
// HTML FETCHER
// =============================================================================

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function fetchPageHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

// =============================================================================
// IMAGE EXTRACTOR (from HTML, before LLM call to save tokens)
// =============================================================================

function extractImageUrls(html: string, baseUrl: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Common patterns for listing photos
  const patterns = [
    // og:image meta tags
    /property="og:image"\s+content="([^"]+)"/gi,
    /content="([^"]+)"\s+property="og:image"/gi,
    // High-res image URLs in data attributes
    /data-src="(https?:\/\/[^"]+(?:\.jpg|\.jpeg|\.png|\.webp)[^"]*)"/gi,
    // Zillow/Realtor style photo URLs
    /(https?:\/\/photos\.zillowstatic\.com\/[^"'\s]+)/gi,
    /(https?:\/\/ap\.rdcpix\.com\/[^"'\s]+)/gi,
    /(https?:\/\/ssl\.cdn-redfin\.com\/[^"'\s]+)/gi,
    // Compass
    /(https?:\/\/images\.compass\.com\/[^"'\s]+)/gi,
    // Douglas Elliman
    /(https?:\/\/[^"'\s]*elliman[^"'\s]*\.(?:jpg|jpeg|png|webp)[^"'\s]*)/gi,
    // Out East
    /(https?:\/\/[^"'\s]*outeast[^"'\s]*\.(?:jpg|jpeg|png|webp)[^"'\s]*)/gi,
    // Generic large listing images
    /src="(https?:\/\/[^"]+(?:\/photos\/|\/images\/|\/listing)[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    // JSON-LD image arrays
    /"image"\s*:\s*\["([^"]+)"/gi,
    /"image"\s*:\s*"(https?:\/\/[^"]+)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let imgUrl = match[1];
      if (!imgUrl) continue;

      // Decode HTML entities
      imgUrl = imgUrl.replace(/&amp;/g, "&");

      // Skip tiny images, icons, logos
      if (imgUrl.includes("favicon") || imgUrl.includes("logo") || imgUrl.includes("icon")) continue;
      if (imgUrl.includes("1x1") || imgUrl.includes("pixel")) continue;

      // Resolve relative URLs
      if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
      else if (imgUrl.startsWith("/")) {
        try {
          const base = new URL(baseUrl);
          imgUrl = `${base.protocol}//${base.host}${imgUrl}`;
        } catch { continue; }
      }

      if (!imgUrl.startsWith("http")) continue;
      if (seen.has(imgUrl)) continue;
      seen.add(imgUrl);
      images.push(imgUrl);
    }
  }

  // Dedupe by base path (same image different sizes)
  const deduped: string[] = [];
  const basePaths = new Set<string>();
  for (const img of images) {
    try {
      const u = new URL(img);
      const base = u.pathname.replace(/[-_]\d+x\d+/, "").replace(/\?.*/, "");
      if (!basePaths.has(base)) {
        basePaths.add(base);
        deduped.push(img);
      }
    } catch {
      deduped.push(img);
    }
  }

  return deduped.slice(0, 25); // Cap at 25 images
}

// =============================================================================
// GROK PARSER
// =============================================================================

async function parseWithGrok(html: string, url: string): Promise<MLSParseResult> {
  if (!XAI_API_KEY) {
    throw new Error("Grok API key not configured");
  }

  // Trim HTML to avoid token limits — keep head + main content area
  let trimmedHtml = html;
  if (html.length > 80000) {
    // Keep meta tags, JSON-LD, and main content
    const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] || "";
    const jsonLd = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi)?.join("\n") || "";
    const mainContent = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || 
                        html.match(/<div[^>]*(?:class|id)="[^"]*(?:listing|property|detail|content)[^"]*"[\s\S]*?<\/div>/i)?.[0] || "";
    
    trimmedHtml = [head, jsonLd, mainContent].join("\n").slice(0, 80000);
    if (trimmedHtml.length < 5000) {
      // Fallback: just take first 80K chars
      trimmedHtml = html.slice(0, 80000);
    }
  }

  const systemPrompt = `You are a real estate listing data extractor. Extract property listing information from the provided HTML. Return ONLY valid JSON with no extra text.

Extract these fields (use null for any field not found):
{
  "address": "full street address",
  "village": "town/village/city name",
  "state": "state abbreviation",
  "zipCode": "zip code",
  "price": "listing price as a number string without $ or commas",
  "beds": "number of bedrooms",
  "baths": "number of bathrooms (use .5 for half baths)",
  "sqft": "square footage as number string",
  "acres": "lot size in acres as number string",
  "yearBuilt": "year built",
  "propertyType": "Single Family, Condo, Townhouse, Land, or Multi-Family",
  "description": "property description (first 500 chars)",
  "brokerName": "listing agent name",
  "brokerCompany": "listing brokerage name",
  "brokerPhone": "listing agent phone",
  "brokerEmail": "listing agent email",
  "mlsNumber": "MLS number/ID"
}

Important:
- Price should be digits only (e.g. "4500000" not "$4,500,000")
- If lot size is in sqft, convert to acres (divide by 43560)
- For Hamptons listings, village names should be: Southampton, East Hampton, Bridgehampton, Sag Harbor, Water Mill, Sagaponack, Wainscott, Amagansett, Montauk, Shelter Island, Springs
- Return ONLY the JSON object, no markdown, no explanation`;

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-2-latest",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `URL: ${url}\n\nHTML:\n${trimmedHtml}` },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[MLS Import] Grok API error: ${res.status} ${errText}`);
    throw new Error(`Grok API error: ${res.status}`);
  }

  const grokResponse = await res.json() as any;
  const content = grokResponse.choices?.[0]?.message?.content || "";
  
  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = content.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(jsonStr) as MLSParseResult;
  } catch (e) {
    console.error(`[MLS Import] Failed to parse Grok response: ${content.slice(0, 200)}`);
    throw new Error("Failed to parse listing data from page");
  }
}

// =============================================================================
// ROUTE
// =============================================================================

mlsImportRouter.post("/parse-url", async (c) => {
  try {
    const body = await c.req.json();
    const url = body.url?.trim();

    if (!url) {
      return c.json({ success: false, error: "URL is required" }, 400);
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return c.json({ success: false, error: "Invalid URL format" }, 400);
    }

    console.log(`[MLS Import] Parsing listing: ${url}`);

    // Step 1: Fetch page HTML
    let html: string;
    try {
      html = await fetchPageHtml(url);
    } catch (fetchErr: any) {
      console.error(`[MLS Import] Fetch failed: ${fetchErr.message}`);
      return c.json({
        success: false,
        error: "Could not load the listing page. The site may be blocking automated access.",
        suggestPaste: true,
      }, 422);
    }

    if (html.length < 500) {
      return c.json({
        success: false,
        error: "Page returned insufficient content. The site may require JavaScript or login.",
        suggestPaste: true,
      }, 422);
    }

    // Step 2: Extract images from HTML directly (faster than LLM)
    const imageUrls = extractImageUrls(html, url);

    // Step 3: Parse listing data with Grok
    let parsed: MLSParseResult;
    try {
      parsed = await parseWithGrok(html, url);
    } catch (parseErr: any) {
      console.error(`[MLS Import] Parse failed: ${parseErr.message}`);
      return c.json({
        success: false,
        error: "Could not extract listing data. Try pasting the listing details manually.",
        suggestPaste: true,
      }, 422);
    }

    // Merge images (Grok might find some in JSON-LD that regex missed)
    const allImages = [...new Set([...(parsed.imageUrls || []), ...imageUrls])].slice(0, 25);
    parsed.imageUrls = allImages;

    console.log(`[MLS Import] Success: ${parsed.address || "unknown address"}, ${allImages.length} images, price: ${parsed.price || "N/A"}`);

    return c.json({
      success: true,
      data: {
        address: parsed.address || null,
        village: parsed.village || null,
        state: parsed.state || null,
        zipCode: parsed.zipCode || null,
        price: parsed.price || null,
        beds: parsed.beds || null,
        baths: parsed.baths || null,
        sqft: parsed.sqft || null,
        acres: parsed.acres || null,
        yearBuilt: parsed.yearBuilt || null,
        propertyType: parsed.propertyType || null,
        description: parsed.description || null,
        brokerName: parsed.brokerName || null,
        brokerCompany: parsed.brokerCompany || null,
        brokerPhone: parsed.brokerPhone || null,
        brokerEmail: parsed.brokerEmail || null,
        imageUrls: allImages,
        mlsNumber: parsed.mlsNumber || null,
      },
    });
  } catch (error: any) {
    console.error("[MLS Import] Unexpected error:", error?.message || error);
    return c.json({
      success: false,
      error: "An unexpected error occurred. Please try again.",
    }, 500);
  }
});

export { mlsImportRouter };
