import { Hono } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { z } from "zod";

const autoArticlesRouter = new Hono();

// Market configurations
const MARKETS = {
  hamptons: {
    name: "Hamptons",
    searchTerms: [
      "Hamptons real estate news",
      "East Hampton property sale",
      "Southampton luxury home",
      "Bridgehampton real estate transaction",
      "Montauk property market",
      "Sag Harbor real estate",
    ],
    locations: [
      "East Hampton",
      "Southampton",
      "Bridgehampton",
      "Sagaponack",
      "Montauk",
      "Amagansett",
      "Water Mill",
      "Sag Harbor",
    ],
  },
  "palm-beach": {
    name: "Palm Beach",
    searchTerms: [
      "Palm Beach real estate news",
      "Palm Beach luxury home sale",
      "Palm Beach property transaction",
      "Palm Beach mansion sale",
      "Palm Beach Island real estate",
    ],
    locations: ["Palm Beach", "Palm Beach Island", "South End", "North End"],
  },
  miami: {
    name: "Miami",
    searchTerms: [
      "Miami Beach real estate news",
      "Miami luxury condo sale",
      "Coral Gables property",
      "Miami Beach penthouse",
      "Fisher Island real estate",
      "Star Island property",
    ],
    locations: [
      "Miami Beach",
      "Coral Gables",
      "Fisher Island",
      "Star Island",
      "Coconut Grove",
      "Brickell",
    ],
  },
  aspen: {
    name: "Aspen",
    searchTerms: [
      "Aspen real estate news",
      "Aspen luxury home sale",
      "Aspen ski property",
      "Snowmass real estate",
      "Aspen mountain home",
    ],
    locations: ["Aspen", "Snowmass", "Aspen Mountain", "Red Mountain"],
  },
} as const;

type MarketKey = keyof typeof MARKETS;

// Helper to call Perplexity for news search
async function searchNews(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("Perplexity API key not configured");

  // Get current date for recency filtering
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' });

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "system",
          content: `You are a real estate news researcher. Search for the most recent real estate news, property sales, and market updates from ${currentYear} ONLY. Do NOT include any news from ${currentYear - 1} or earlier.

Return detailed information including:
- Property addresses and locations
- Sale prices and transaction details
- Buyer/seller names if publicly available
- Property details (size, bedrooms, features)
- Any notable quotes from agents or buyers
- Dates of transactions (MUST be from ${currentYear})

Focus on transactions and news from the last 30 days in ${currentMonth} ${currentYear}. Be specific and factual. Only include stories with dates in ${currentYear}.`,
        },
        {
          role: "user",
          content: `Find the most recent real estate news from ${currentMonth} ${currentYear} for: ${query}

IMPORTANT: Only return news and transactions from ${currentYear}. Do NOT include anything from ${currentYear - 1} or earlier.

Return 3-5 specific news stories or property transactions with all available details. Include sources and dates.`,
        },
      ],
      max_tokens: 2000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data?.choices?.[0]?.message?.content || "";
}

// Helper to call Grok for article generation
async function generateArticle(
  sourceText: string,
  market: string
): Promise<{
  title: string;
  subtitle: string;
  excerpt: string;
  content: string;
  category: string;
  location: string;
  pullQuote?: string;
  statCallout?: { value: string; label: string };
  sourceUrl?: string;
}> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) throw new Error("Grok API key not configured");

  const currentYear = new Date().getFullYear();

  const systemPrompt = `You are a copy editor for Hamptons Coastal, a luxury real estate publication covering ${market} and other prestigious markets.

Your writing style is:
- Sophisticated, understated, and editorial
- Uses precise language without hyperbole
- Focuses on facts, market implications, and industry context
- Avoids sensationalism or clickbait
- Similar to The Wall Street Journal or Financial Times real estate coverage

CRITICAL FORMATTING RULES:
1. NEVER use em dashes (�) or en dashes (�). Use commas, periods, or semicolons instead.
2. Article content MUST be approximately 3000 characters (about 500-600 words).
3. Write substantial, detailed paragraphs with context and analysis.
4. Include market implications and industry context.

PLAGIARISM AVOIDANCE - THIS IS CRITICAL:
1. You MUST completely rewrite the article in your own words
2. Create an entirely NEW headline that captures the same story differently
3. Restructure sentences and paragraphs completely
4. Use different vocabulary and phrasing throughout
5. The final article should read as if Hamptons Coastal reporters wrote it independently
6. NO copied phrases or sentence structures from the source
7. The article must pass plagiarism detection as original content

STRICT FACT PRESERVATION RULES:
1. Keep ALL facts, names, numbers, dates, and quotes exactly accurate
2. Do NOT change any factual information (prices, addresses, names, dates)
3. Do NOT make up or add any information not in the source
4. Do NOT change the core story or topic
5. Only include news from ${currentYear}. Do NOT write about ${currentYear - 1} news.

The goal: Same facts, completely different words and structure.

Categories to choose from:
- trades: Notable property transactions
- market: Market trends and analysis
- insights: Statistics and market intelligence
- policy: Zoning, regulations, legal developments
- listings: Featured properties and new listings`;

  const userPrompt = `REWRITE this news article in the Hamptons Coastal editorial voice.

YOUR TASK:
1. Create an ORIGINAL headline (completely different wording from source)
2. Rewrite ALL sentences in your own words (no copied phrases)
3. Restructure the article flow and paragraph order
4. Keep ALL facts, numbers, names, and quotes exactly accurate
5. Make it sound like our reporters wrote this independently

REQUIREMENTS:
- Approximately 3000 characters (500-600 words)
- No em dashes (�) or en dashes (�)
- Only ${currentYear} news, ignore ${currentYear - 1}
- Must be completely reworded to avoid any plagiarism liability

SOURCE NEWS TO REWRITE:
${sourceText}

Respond with JSON only (no markdown):
{
  "title": "ORIGINAL headline - different wording than source",
  "subtitle": "ORIGINAL subheadline - your own words",
  "excerpt": "2-3 sentence summary in your own words",
  "content": "fully rewritten article ~3000 characters - same facts, completely different words and structure - NO copied phrases - separate paragraphs with double newlines",
  "category": "trades or market or insights or policy or listings",
  "location": "specific location from the article",
  "pullQuote": "exact quote from article if any (quotes can stay the same)",
  "statCallout": {"value": "key number like $5.2M", "label": "description like Sale Price"}
}`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-3",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content || "";

  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Invalid response format from AI");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Post-process to remove any em dashes that slipped through
  parsed.title = parsed.title?.replace(/[��]/g, '-') || parsed.title;
  parsed.subtitle = parsed.subtitle?.replace(/[��]/g, '-') || parsed.subtitle;
  parsed.excerpt = parsed.excerpt?.replace(/[��]/g, '-') || parsed.excerpt;
  parsed.content = parsed.content?.replace(/[��]/g, ', ') || parsed.content;
  if (parsed.pullQuote) {
    parsed.pullQuote = parsed.pullQuote.replace(/[��]/g, ', ');
  }

  return parsed;
}

// Schema for generate request
const generateRequestSchema = z.object({
  market: z.enum(["hamptons", "palm-beach", "miami", "aspen"]),
  count: z.number().min(1).max(10).default(5),
  existingTitles: z.array(z.string()).optional().default([]),
});

// Main endpoint: Search news and generate articles
autoArticlesRouter.post("/generate", async (c) => {
  try {
    const body = generateRequestSchema.parse(await c.req.json());
    const { market, count, existingTitles } = body;
    const marketConfig = MARKETS[market];

    console.log(
      `[AutoArticles] Starting generation for ${marketConfig.name}, target: ${count} articles`
    );

    const results: Array<{
      success: boolean;
      article?: {
        title: string;
        subtitle: string;
        excerpt: string;
        content: string;
        category: string;
        location: string;
        market: string;
        pullQuote?: string;
        statCallout?: { value: string; label: string };
        generatedAt: string;
      };
      error?: string;
    }> = [];

    // Rotate through search terms
    const searchTermsToUse = marketConfig.searchTerms.slice(0, count);

    for (let i = 0; i < count; i++) {
      const searchTerm =
        searchTermsToUse[i % searchTermsToUse.length] +
        ` ${new Date().getFullYear()}`;

      try {
        console.log(`[AutoArticles] Searching: ${searchTerm}`);

        // Step 1: Search for news
        const newsResults = await searchNews(searchTerm);

        if (!newsResults || newsResults.length < 100) {
          results.push({
            success: false,
            error: "No news found for search term",
          });
          continue;
        }

        // Step 2: Generate article from news
        console.log(`[AutoArticles] Generating article from news...`);
        const article = await generateArticle(newsResults, marketConfig.name);

        // Check for duplicate titles
        const isDuplicate = existingTitles.some(
          (existing) =>
            existing.toLowerCase().includes(article.title.toLowerCase()) ||
            article.title.toLowerCase().includes(existing.toLowerCase())
        );

        if (isDuplicate) {
          console.log(
            `[AutoArticles] Skipping duplicate: ${article.title.substring(0, 50)}...`
          );
          results.push({
            success: false,
            error: "Duplicate article detected",
          });
          continue;
        }

        results.push({
          success: true,
          article: {
            ...article,
            market: market,
            generatedAt: new Date().toISOString(),
          },
        });

        // Add to existing titles to prevent duplicates in same batch
        existingTitles.push(article.title);

        console.log(
          `[AutoArticles] Generated: ${article.title.substring(0, 50)}...`
        );

        // Small delay between generations to avoid rate limits
        if (i < count - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`[AutoArticles] Error generating article:`, errorMessage);
        results.push({ success: false, error: errorMessage });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `[AutoArticles] Completed: ${successCount}/${count} articles generated`
    );

    return c.json({
      success: true,
      market: marketConfig.name,
      requested: count,
      generated: successCount,
      results,
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Invalid request";
    console.error("[AutoArticles] Error:", errorMessage);

    if (error instanceof z.ZodError) {
      return c.json(
        { error: "Invalid request body", details: error.issues },
        400
      );
    }

    return c.json({ error: errorMessage }, 500);
  }
});

// Endpoint to get available markets
autoArticlesRouter.get("/markets", (c) => {
  const markets = Object.entries(MARKETS).map(([key, config]) => ({
    id: key,
    name: config.name,
    searchTerms: config.searchTerms.length,
    locations: config.locations,
  }));

  return c.json({ markets });
});

// Health check
autoArticlesRouter.get("/health", (c) => {
  const hasGrok = !!process.env.GROK_API_KEY;
  const hasPerplexity = !!process.env.PERPLEXITY_API_KEY;

  return c.json({
    status: hasGrok && hasPerplexity ? "ready" : "missing_keys",
    grok: hasGrok ? "configured" : "missing",
    perplexity: hasPerplexity ? "configured" : "missing",
  });
});

export { autoArticlesRouter };