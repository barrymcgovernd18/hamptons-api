import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://tfzkenrmzoxrkdntkada.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/hamptons-coastal/id6746435334";
const APP_ID = "6746435334";

// ---------- Supabase article type ----------

interface SupabaseArticle {
  id: string;
  title: string;
  subtitle?: string;
  excerpt: string;
  content: string;
  image_url: string;
  author: string;
  published_at: string;
  category_name: string;
  category_slug: string;
  location: string;
  market_id?: string;
  reading_time: number;
  is_featured: boolean;
  pull_quote?: string;
  approval_status?: string;
  content_images?: string;
}

// ---------- helpers ----------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(cents: number): string {
  if (cents >= 1_000_000) {
    const millions = cents / 1_000_000;
    // If it is a clean million (e.g. 5000000) show $5M, otherwise $5.2M
    const formatted =
      millions % 1 === 0
        ? `$${millions}M`
        : `$${parseFloat(millions.toFixed(1))}M`;
    return formatted;
  }
  return `$${cents.toLocaleString("en-US")}`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Convert plain-text article content into HTML paragraphs.
 * If the content already contains HTML tags we return it as-is.
 */
function contentToHtml(content: string): string {
  if (/<[a-z][\s\S]*>/i.test(content)) {
    return content;
  }
  return content
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

// ---------- shared style tokens ----------

const BRAND = {
  navy: "#1C3A5F",
  navyLight: "#2A4F7A",
  gold: "#B8956E",
  goldLight: "#D4B896",
  cream: "#FAF8F5",
  white: "#FFFFFF",
  textDark: "#1A1A1A",
  textMuted: "#6B7280",
  border: "#E5E1DB",
} as const;

function baseStyles(): string {
  return `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{-webkit-text-size-adjust:100%}
    body{
      font-family: Georgia, "Times New Roman", Times, serif;
      color: ${BRAND.textDark};
      background: ${BRAND.cream};
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }
    img{max-width:100%;height:auto;display:block}
    a{color:${BRAND.gold};text-decoration:none}
    a:hover{text-decoration:underline}

    /* ---------- top bar ---------- */
    .top-bar{
      background: ${BRAND.navy};
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .brand{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 2.5px;
      color: ${BRAND.gold};
      text-transform: uppercase;
    }
    .open-btn{
      background: ${BRAND.gold};
      color: ${BRAND.white};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-weight: 600;
      font-size: 13px;
      padding: 8px 18px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      letter-spacing: 0.5px;
    }
    .open-btn:hover{background:${BRAND.goldLight};text-decoration:none}

    /* ---------- hero ---------- */
    .hero-img{
      width: 100%;
      max-height: 520px;
      object-fit: cover;
    }

    /* ---------- content wrapper ---------- */
    .content{
      max-width: 720px;
      margin: 0 auto;
      padding: 32px 20px 60px;
    }

    /* ---------- article ---------- */
    .category-badge{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: ${BRAND.gold};
      margin-bottom: 12px;
      display: inline-block;
    }
    .article-title{
      font-size: 32px;
      line-height: 1.25;
      font-weight: 700;
      color: ${BRAND.navy};
      margin-bottom: 10px;
    }
    .article-subtitle{
      font-size: 20px;
      line-height: 1.4;
      color: ${BRAND.textMuted};
      margin-bottom: 16px;
      font-style: italic;
    }
    .meta{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px;
      color: ${BRAND.textMuted};
      margin-bottom: 28px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      align-items: center;
    }
    .meta-sep{color:${BRAND.border}}
    .article-body p{margin-bottom:1.3em;font-size:18px;line-height:1.8}
    .article-body h2,.article-body h3{
      font-size:22px;color:${BRAND.navy};margin:32px 0 12px;line-height:1.3
    }
    .article-body blockquote{
      border-left:3px solid ${BRAND.gold};
      padding:8px 0 8px 20px;
      margin:24px 0;
      font-style:italic;
      color:${BRAND.navyLight};
      font-size:20px;
      line-height:1.6;
    }
    .article-body ul,.article-body ol{margin:0 0 1.3em 24px;font-size:18px}
    .article-body li{margin-bottom:6px}
    .pull-quote{
      text-align:center;
      font-size:22px;
      font-style:italic;
      color:${BRAND.navy};
      border-top:2px solid ${BRAND.gold};
      border-bottom:2px solid ${BRAND.gold};
      padding:24px 16px;
      margin:36px 0;
      line-height:1.5;
    }

    /* ---------- listing ---------- */
    .listing-header{margin-bottom:24px}
    .listing-address{
      font-size:28px;font-weight:700;color:${BRAND.navy};line-height:1.25;margin-bottom:4px
    }
    .listing-village{
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
      font-size:14px;color:${BRAND.textMuted};margin-bottom:12px;text-transform:uppercase;letter-spacing:1px
    }
    .listing-price{
      font-size:34px;font-weight:700;color:${BRAND.navy};margin-bottom:20px
    }
    .listing-stats{
      display:flex;flex-wrap:wrap;gap:12px 28px;margin-bottom:28px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
      font-size:15px;color:${BRAND.textDark}
    }
    .listing-stat{display:flex;align-items:center;gap:6px}
    .listing-stat strong{font-weight:700;color:${BRAND.navy}}
    .listing-desc{font-size:17px;line-height:1.8;margin-bottom:32px}
    .listing-desc p{margin-bottom:1.2em}
    .broker-card{
      background:${BRAND.white};
      border:1px solid ${BRAND.border};
      border-radius:10px;
      padding:20px 24px;
      margin-bottom:32px
    }
    .broker-card h3{
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
      font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${BRAND.textMuted};
      margin-bottom:10px
    }
    .broker-name{font-size:18px;font-weight:700;color:${BRAND.navy};margin-bottom:4px}
    .broker-company{font-size:14px;color:${BRAND.textMuted};margin-bottom:8px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
    .broker-contact{
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
      font-size:14px;color:${BRAND.gold}
    }
    .broker-contact a{color:${BRAND.gold}}

    /* ---------- CTA ---------- */
    .cta{
      text-align:center;
      padding:48px 20px;
      background:${BRAND.navy};
      border-radius:12px;
      margin-bottom:40px
    }
    .cta h2{
      font-size:24px;color:${BRAND.white};margin-bottom:8px;line-height:1.3
    }
    .cta p{
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
      font-size:14px;color:${BRAND.goldLight};margin-bottom:20px
    }
    .cta-btn{
      display:inline-block;
      background:${BRAND.gold};
      color:${BRAND.white};
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
      font-weight:700;font-size:15px;
      padding:14px 36px;border-radius:8px;
      text-decoration:none;letter-spacing:0.5px
    }
    .cta-btn:hover{background:${BRAND.goldLight};text-decoration:none}

    /* ---------- footer ---------- */
    .footer{
      text-align:center;
      padding:20px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
      font-size:12px;
      color:${BRAND.textMuted}
    }

    /* ---------- 404 ---------- */
    .not-found{
      text-align:center;
      padding:80px 20px;
      max-width:480px;
      margin:0 auto
    }
    .not-found h1{font-size:64px;color:${BRAND.navy};margin-bottom:12px}
    .not-found h2{font-size:22px;color:${BRAND.navy};margin-bottom:12px}
    .not-found p{font-size:16px;color:${BRAND.textMuted};margin-bottom:28px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}

    /* ---------- responsive ---------- */
    @media(max-width:600px){
      .article-title{font-size:26px}
      .article-subtitle{font-size:17px}
      .listing-address{font-size:24px}
      .listing-price{font-size:28px}
      .pull-quote{font-size:19px}
      .hero-img{max-height:320px}
    }
  `;
}

function topBar(): string {
  return `
    <div class="top-bar">
      <span class="brand">Hamptons Coastal</span>
      <a class="open-btn" href="${APP_STORE_URL}">Open in App</a>
    </div>`;
}

function ctaSection(message: string): string {
  return `
    <div class="cta">
      <h2>${escapeHtml(message)}</h2>
      <p>Available on the App Store for iPhone</p>
      <a class="cta-btn" href="${APP_STORE_URL}">Download the App</a>
    </div>`;
}

function footerSection(): string {
  const year = new Date().getFullYear();
  return `<div class="footer">&copy; ${year} Hamptons Coastal. All rights reserved.</div>`;
}

function notFoundPage(type: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="apple-itunes-app" content="app-id=${APP_ID}">
  <title>${escapeHtml(type)} Not Found - Hamptons Coastal</title>
  <style>${baseStyles()}</style>
</head>
<body>
  ${topBar()}
  <div class="not-found">
    <h1>404</h1>
    <h2>${escapeHtml(type)} Not Found</h2>
    <p>The ${type.toLowerCase()} you are looking for may have been removed or is no longer available. Discover more in the Hamptons Coastal app.</p>
    <a class="cta-btn" href="${APP_STORE_URL}">Get the App</a>
  </div>
  ${footerSection()}
</body>
</html>`;
}

// ---------- Supabase fetch ----------

async function fetchArticleById(
  id: string
): Promise<SupabaseArticle | null> {
  const url = `${SUPABASE_URL}/rest/v1/generated_articles?select=*&id=eq.${encodeURIComponent(id)}&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!response.ok) {
    console.error(
      "[WebPages] Supabase article fetch failed:",
      response.status,
      await response.text()
    );
    return null;
  }
  const rows = (await response.json()) as SupabaseArticle[];
  return rows.length > 0 ? (rows[0] ?? null) : null;
}

// ---------- Router ----------

const webPagesRouter = new Hono();

// ==================== Article Page ====================

webPagesRouter.get("/article/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const article = await fetchArticleById(id);

    if (!article) {
      return c.html(notFoundPage("Article"), 404);
    }

    const pageUrl = `${new URL(c.req.url).origin}/article/${encodeURIComponent(article.id)}`;
    const ogDescription = article.excerpt
      ? escapeHtml(article.excerpt.substring(0, 200))
      : "";
    const ogImage = escapeHtml(article.image_url || "");
    const ogTitle = escapeHtml(article.title);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${ogTitle} - Hamptons Coastal</title>

  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:site_name" content="Hamptons Coastal">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image" content="${ogImage}">

  <!-- Apple Smart App Banner -->
  <meta name="apple-itunes-app" content="app-id=${APP_ID}">

  <style>${baseStyles()}</style>
</head>
<body>
  ${topBar()}

  ${article.image_url ? `<img class="hero-img" src="${escapeHtml(article.image_url)}" alt="${ogTitle}">` : ""}

  <div class="content">
    ${article.category_name ? `<span class="category-badge">${escapeHtml(article.category_name)}</span>` : ""}
    <h1 class="article-title">${ogTitle}</h1>
    ${article.subtitle ? `<p class="article-subtitle">${escapeHtml(article.subtitle)}</p>` : ""}
    <div class="meta">
      ${article.author ? `<span>By ${escapeHtml(article.author)}</span>` : ""}
      ${article.author && article.published_at ? `<span class="meta-sep">|</span>` : ""}
      ${article.published_at ? `<span>${formatDate(article.published_at)}</span>` : ""}
      ${article.reading_time ? `<span class="meta-sep">|</span><span>${article.reading_time} min read</span>` : ""}
    </div>

    ${article.pull_quote ? `<div class="pull-quote">&ldquo;${escapeHtml(article.pull_quote)}&rdquo;</div>` : ""}

    <div class="article-body">
      ${contentToHtml(article.content)}
    </div>

    ${ctaSection("Read more articles in the Hamptons Coastal app")}
  </div>

  ${footerSection()}
</body>
</html>`;

    return c.html(html);
  } catch (error: unknown) {
    console.error("[WebPages] Error rendering article:", error);
    return c.html(notFoundPage("Article"), 500);
  }
});

// ==================== Listing Page ====================

webPagesRouter.get("/listing/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const listing = await prisma.listing.findUnique({ where: { id } });

    if (!listing) {
      return c.html(notFoundPage("Listing"), 404);
    }

    const pageUrl = `${new URL(c.req.url).origin}/listing/${encodeURIComponent(listing.id)}`;
    const priceFormatted = formatPrice(listing.price);

    const ogTitle = escapeHtml(listing.address);
    const ogDescription = escapeHtml(
      `${priceFormatted} | ${listing.beds} Bed, ${listing.baths} Bath | ${listing.village}`
    );
    const ogImage = escapeHtml(listing.image_url || "");

    const descriptionHtml = listing.description
      ? contentToHtml(listing.description)
      : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${ogTitle} - Hamptons Coastal</title>

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:site_name" content="Hamptons Coastal">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image" content="${ogImage}">

  <!-- Apple Smart App Banner -->
  <meta name="apple-itunes-app" content="app-id=${APP_ID}">

  <style>${baseStyles()}</style>
</head>
<body>
  ${topBar()}

  ${listing.image_url ? `<img class="hero-img" src="${escapeHtml(listing.image_url)}" alt="${ogTitle}">` : ""}

  <div class="content">
    <div class="listing-header">
      ${listing.village ? `<div class="listing-village">${escapeHtml(listing.village)}</div>` : ""}
      <h1 class="listing-address">${ogTitle}</h1>
      <div class="listing-price">${priceFormatted}</div>
    </div>

    <div class="listing-stats">
      ${listing.beds != null ? `<div class="listing-stat"><strong>${listing.beds}</strong> Beds</div>` : ""}
      ${listing.baths != null ? `<div class="listing-stat"><strong>${listing.baths}</strong> Baths</div>` : ""}
      ${listing.sqft ? `<div class="listing-stat"><strong>${listing.sqft.toLocaleString("en-US")}</strong> Sq Ft</div>` : ""}
      ${listing.acres ? `<div class="listing-stat"><strong>${listing.acres}</strong> Acres</div>` : ""}
      ${listing.year_built ? `<div class="listing-stat">Built <strong>${listing.year_built}</strong></div>` : ""}
    </div>

    ${descriptionHtml ? `<div class="listing-desc">${descriptionHtml}</div>` : ""}

    ${
      listing.broker_name
        ? `<div class="broker-card">
        <h3>Listed By</h3>
        <div class="broker-name">${escapeHtml(listing.broker_name)}</div>
        ${listing.broker_company ? `<div class="broker-company">${escapeHtml(listing.broker_company)}</div>` : ""}
        <div class="broker-contact">
          ${listing.broker_phone ? `<a href="tel:${escapeHtml(listing.broker_phone)}">${escapeHtml(listing.broker_phone)}</a>` : ""}
          ${listing.broker_phone && listing.broker_email ? ` &middot; ` : ""}
          ${listing.broker_email ? `<a href="mailto:${escapeHtml(listing.broker_email)}">${escapeHtml(listing.broker_email)}</a>` : ""}
        </div>
      </div>`
        : ""
    }

    ${ctaSection("View this listing in the Hamptons Coastal app")}
  </div>

  ${footerSection()}
</body>
</html>`;

    return c.html(html);
  } catch (error: unknown) {
    console.error("[WebPages] Error rendering listing:", error);
    return c.html(notFoundPage("Listing"), 500);
  }
});

export { webPagesRouter };