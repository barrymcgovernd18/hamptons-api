/**
 * Migration script: Insert all market articles from market-articles.ts into Supabase generated_articles table.
 *
 * Usage: cd /home/user/workspace/backend && bun run scripts/migrate-articles-to-supabase.ts
 *
 * This reads the mobile app's market-articles.ts, transforms each article into the Supabase schema,
 * and inserts them with approval_status = 'approved' and the correct location field.
 */

const SUPABASE_URL = 'https://tfzkenrmzoxrkdntkada.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmemtlbnJtem94cmtkbnRrYWRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5OTc0OTcsImV4cCI6MjA4MzU3MzQ5N30.6IxBDHMp0TbeJdRr0114fdnsCHyrRoaIcyG5jKdPAV8';

// Map market IDs to Supabase location values
const MARKET_TO_LOCATION: Record<string, string> = {
  'palm-beach': 'Palm Beach',
  'miami': 'Miami',
  'aspen': 'Aspen',
  'hamptons': 'Hamptons',
};

// Map category strings to category IDs/slugs
function getCategoryInfo(category: string): { id: string; name: string; slug: string } {
  const cat = category.toLowerCase();
  if (cat.includes('trade') || cat.includes('deal') || cat.includes('sale')) {
    return { id: '2', name: 'Trades', slug: 'trades' };
  }
  if (cat.includes('lifestyle') || cat.includes('culture')) {
    return { id: '3', name: 'Lifestyle', slug: 'lifestyle' };
  }
  if (cat.includes('development') || cat.includes('construction')) {
    return { id: '4', name: 'Development', slug: 'development' };
  }
  if (cat.includes('analysis') || cat.includes('insight') || cat.includes('report')) {
    return { id: '5', name: 'Analysis', slug: 'analysis' };
  }
  // Default: Market News
  return { id: '1', name: 'Market News', slug: 'market-news' };
}

// Parse readTime string like "3 min read" to number
function parseReadTime(readTime: string): number {
  const match = readTime.match(/(\d+)/);
  return match && match[1] ? parseInt(match[1], 10) : 3;
}

interface MarketArticle {
  id: string;
  title: string;
  excerpt: string;
  content?: string;
  category: string;
  publishedAt: string;
  imageUrl: string;
  author: string;
  readTime: string;
  isFeatured?: boolean;
}

async function fetchExistingArticleTitles(): Promise<Set<string>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/generated_articles?select=title`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) {
    console.error('Failed to fetch existing articles:', await res.text());
    return new Set();
  }
  const articles = await res.json() as Array<{ title: string }>;
  return new Set(articles.map(a => a.title.toLowerCase().trim()));
}

async function insertArticle(article: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/generated_articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(article),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, string>;
    if (body.code === '23505') {
      // Duplicate - skip
      return false;
    }
    console.error(`  INSERT FAILED: ${body.message || res.status}`);
    return false;
  }
  return true;
}

async function main() {
  console.log('=== Migrating Market Articles to Supabase ===\n');

  // Step 1: Read market-articles.ts using dynamic import
  const marketArticlesPath = '../../mobile/src/lib/data/market-articles';
  const mod = await import(marketArticlesPath);
  const MARKET_ARTICLES: Record<string, MarketArticle[]> = mod.MARKET_ARTICLES;

  // Step 2: Get existing articles to avoid duplicates
  console.log('Fetching existing articles from Supabase...');
  const existingTitles = await fetchExistingArticleTitles();
  console.log(`Found ${existingTitles.size} existing articles\n`);

  // Step 3: Process each market
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const [marketId, articles] of Object.entries(MARKET_ARTICLES)) {
    const location = MARKET_TO_LOCATION[marketId];
    if (!location) {
      console.log(`Skipping unknown market: ${marketId} (${articles.length} articles)`);
      totalSkipped += articles.length;
      continue;
    }

    if (articles.length === 0) {
      console.log(`${location}: 0 articles (skipping)`);
      continue;
    }

    console.log(`${location}: ${articles.length} articles to process`);

    for (const article of articles) {
      // Check for duplicates by title
      if (existingTitles.has(article.title.toLowerCase().trim())) {
        console.log(`  SKIP (duplicate): ${article.title.substring(0, 60)}...`);
        totalSkipped++;
        continue;
      }

      const catInfo = getCategoryInfo(article.category);
      const readingTime = parseReadTime(article.readTime);

      const supabaseRecord = {
        id: `migrated_${marketId}_${article.id}_${Date.now()}`,
        title: article.title,
        subtitle: null,
        excerpt: article.excerpt,
        content: article.content || article.excerpt,
        image_url: article.imageUrl,
        author: article.author,
        published_at: article.publishedAt,
        category_id: catInfo.id,
        category_name: catInfo.name,
        category_slug: catInfo.slug,
        location: location,
        reading_time: readingTime,
        is_featured: article.isFeatured || false,
        pull_quote: null,
        approval_status: 'approved',
        submitted_by: 'migration-script',
        submitted_at: new Date().toISOString(),
        content_images: null,
      };

      const inserted = await insertArticle(supabaseRecord);
      if (inserted) {
        console.log(`  INSERTED: [${location}] ${article.title.substring(0, 60)}...`);
        totalInserted++;
        existingTitles.add(article.title.toLowerCase().trim());
      } else {
        totalSkipped++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('');
  }

  console.log('=== Migration Complete ===');
  console.log(`Inserted: ${totalInserted}`);
  console.log(`Skipped: ${totalSkipped}`);

  // Step 4: Verify final state
  console.log('\nVerifying final state...');
  const verifyRes = await fetch(
    `${SUPABASE_URL}/rest/v1/generated_articles?select=location,approval_status&order=location`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  const allArticles = await verifyRes.json() as Array<{ location: string; approval_status: string }>;
  const counts: Record<string, number> = {};
  for (const a of allArticles) {
    counts[a.location] = (counts[a.location] || 0) + 1;
  }
  console.log('Articles by location:', JSON.stringify(counts, null, 2));
  console.log(`Total: ${allArticles.length}`);
}

main().catch(console.error);