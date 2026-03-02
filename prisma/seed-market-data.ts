/**
 * Seed script for comp_sales and market_insights tables.
 *
 * Reads JSON / TS data files from the mobile workspace and inserts them
 * into the SQLite database via Prisma.
 *
 * Usage:
 *   cd /home/user/workspace/backend && bun run prisma/seed-market-data.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Market ID assignment
// ---------------------------------------------------------------------------

/**
 * Determine market_id from the record's source and village fields.
 *
 * The comparable-sales-data.json dataset contains three distinct sources that
 * map 1-to-1 to markets:
 *   csv_import        -> hamptons   (4,026 records)
 *   redfin_export     -> palm-beach (345 records)
 *   redfin_screenshot -> aspen      (763 records)
 *
 * We also include a village-name fallback so that future records without a
 * recognised source string are still classified correctly.
 */
function getMarketId(village: string | undefined, source: string | undefined): string {
  const s = (source || '').toLowerCase();

  // Fast path: source-based assignment covers 100 % of the current dataset.
  if (s === 'csv_import') return 'hamptons';
  if (s === 'redfin_export') return 'palm-beach';
  if (s === 'redfin_screenshot') return 'aspen';

  // Fallback: village-name heuristics for any records with unexpected sources.
  const v = (village || '').toLowerCase();

  const aspenVillages = [
    'calderwood', 'red mountain', 'snowmass', 'aspen', 'woody creek',
    'basalt', 'carbondale', 'castle creek', 'meadowood', 'starwood',
    'horse ranch', 'west end', 'smuggler', 'buttermilk', 'highlands',
    'maroon creek', 'owl creek', 'brush creek', 'mclain flats', 'lenado',
  ];
  if (aspenVillages.some(av => v.includes(av))) return 'aspen';

  const pbVillages = [
    'palm beach', 'estate section', 'north end oceanfront', 'south end',
    'mid-town', 'wells road', 'condominium row', 'lakefront',
    'north ocean', 'south ocean',
  ];
  if (pbVillages.some(pv => v.includes(pv))) return 'palm-beach';

  const miamiVillages = [
    'miami', 'south beach', 'bal harbour', 'surfside', 'mid-beach',
    'north beach', 'star island', 'la gorce', 'fisher island',
    'south of fifth', 'sofi', 'indian creek',
  ];
  if (miamiVillages.some(mv => v.includes(mv))) return 'miami';

  // Everything else defaults to hamptons.
  return 'hamptons';
}

// ---------------------------------------------------------------------------
// Seed comp sales
// ---------------------------------------------------------------------------

interface RawCompRecord {
  address?: string;
  village?: string;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  lot_acres?: number | null;
  sold_price?: number | null;
  sold_date?: string | null;
  price_per_sqft?: number | null;
  source?: string;
}

async function seedCompSales(): Promise<void> {
  const compDataPath = path.resolve(
    __dirname,
    '../../mobile/src/lib/data/comparable-sales-data.json',
  );
  const raw: RawCompRecord[] = JSON.parse(fs.readFileSync(compDataPath, 'utf-8'));
  console.log(`Read ${raw.length} comp sale records from JSON.`);

  // Clear existing comp sales.
  const deleted = await prisma.compSale.deleteMany();
  console.log(`Deleted ${deleted.count} existing comp sale rows.`);

  // Map raw records into the shape Prisma expects.
  const records = raw.map((r) => ({
    market_id: getMarketId(r.village, r.source),
    address: r.address || 'Unknown',
    village: r.village ?? null,
    beds: r.beds ?? null,
    baths: r.baths ?? null,
    sqft: r.sqft ?? null,
    lot_acres: r.lot_acres ?? null,
    sold_price: r.sold_price ?? 0,
    sold_date: r.sold_date ?? null,
    price_per_sqft: r.price_per_sqft ?? null,
    source: r.source ?? null,
    year_built: null,
    property_type: null,
  }));

  // Batch insert in chunks of 500 to stay within SQLite limits.
  const CHUNK_SIZE = 500;
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    await prisma.compSale.createMany({ data: chunk });
    const end = Math.min(i + CHUNK_SIZE, records.length);
    console.log(`  Inserted comp sales ${i + 1} - ${end} of ${records.length}`);
  }
}

// ---------------------------------------------------------------------------
// Seed market insights
// ---------------------------------------------------------------------------

/**
 * Extract a top-level `export const NAME` block from a TypeScript source
 * string by counting braces.  Returns the raw TS text between (and
 * including) the opening `{` and its matching `}`.
 */
function extractConstBlock(source: string, constName: string): string | null {
  const marker = `export const ${constName}`;
  const idx = source.indexOf(marker);
  if (idx === -1) return null;

  // Find the first `{` after the marker.
  const braceStart = source.indexOf('{', idx);
  if (braceStart === -1) return null;

  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }

  if (braceEnd === -1) return null;

  // Return the full declaration including the export const line.
  return source.slice(idx, braceEnd + 2); // +2 to include the `};`
}

async function seedMarketInsights(): Promise<void> {
  const insightsPath = path.resolve(
    __dirname,
    '../../mobile/src/lib/data/multi-market-insights.ts',
  );
  const insightsRaw = fs.readFileSync(insightsPath, 'utf-8');
  console.log(`Read multi-market-insights.ts (${insightsRaw.length} bytes).`);

  // Clear existing market insights.
  const deleted = await prisma.marketInsight.deleteMany();
  console.log(`Deleted ${deleted.count} existing market insight rows.`);

  // --- Store the entire TS file as a backup ---
  await prisma.marketInsight.create({
    data: {
      market_id: 'all-source',
      market_name: 'All Markets (Source File)',
      data_json: insightsRaw,
    },
  });
  console.log('  Stored all-source backup row.');

  // --- Extract individual market insight blocks ---
  const insightDefs: Array<{
    constName: string;
    market_id: string;
    market_name: string;
  }> = [
    { constName: 'PALM_BEACH_INSIGHTS', market_id: 'palm-beach', market_name: 'Palm Beach' },
    { constName: 'MIAMI_INSIGHTS', market_id: 'miami', market_name: 'Miami Beach' },
    { constName: 'ASPEN_INSIGHTS', market_id: 'aspen', market_name: 'Aspen' },
  ];

  for (const def of insightDefs) {
    const block = extractConstBlock(insightsRaw, def.constName);
    if (block) {
      await prisma.marketInsight.create({
        data: {
          market_id: def.market_id,
          market_name: def.market_name,
          data_json: block,
        },
      });
      console.log(`  Stored ${def.market_id} insight (${block.length} chars).`);
    } else {
      console.warn(`  WARNING: Could not extract ${def.constName} from insights file.`);
    }
  }

  // --- Store supplementary data files ---
  const supplementaryFiles: Array<{
    filePath: string;
    market_id: string;
    market_name: string;
  }> = [
    {
      filePath: path.resolve(__dirname, '../../mobile/src/lib/data/market-locations.ts'),
      market_id: 'locations-source',
      market_name: 'Market Locations (Source File)',
    },
    {
      filePath: path.resolve(__dirname, '../../mobile/src/lib/data/market-articles.ts'),
      market_id: 'articles-source',
      market_name: 'Market Articles (Source File)',
    },
    {
      filePath: path.resolve(__dirname, '../../mobile/src/lib/data/aspen-sales-data.json'),
      market_id: 'aspen-sales-source',
      market_name: 'Aspen Sales (Source JSON)',
    },
  ];

  for (const sf of supplementaryFiles) {
    if (fs.existsSync(sf.filePath)) {
      const content = fs.readFileSync(sf.filePath, 'utf-8');
      await prisma.marketInsight.create({
        data: {
          market_id: sf.market_id,
          market_name: sf.market_name,
          data_json: content,
        },
      });
      console.log(`  Stored ${sf.market_id} (${content.length} chars).`);
    } else {
      console.warn(`  WARNING: ${sf.filePath} not found, skipping.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Print summary
// ---------------------------------------------------------------------------

async function printSummary(): Promise<void> {
  const compCount = await prisma.compSale.count();
  const insightCount = await prisma.marketInsight.count();

  const marketBreakdown = await prisma.compSale.groupBy({
    by: ['market_id'],
    _count: true,
    orderBy: { _count: { market_id: 'desc' } },
  });

  const insightRows = await prisma.marketInsight.findMany({
    select: { market_id: true, market_name: true },
    orderBy: { market_id: 'asc' },
  });

  console.log('\n========================================');
  console.log('  Market Data Seed Complete');
  console.log('========================================');
  console.log(`Total comp sales: ${compCount}`);
  console.log(`Market insight records: ${insightCount}`);
  console.log('');
  console.log('Comp sales by market:');
  for (const m of marketBreakdown) {
    console.log(`  ${m.market_id}: ${m._count} records`);
  }
  console.log('');
  console.log('Market insight rows:');
  for (const row of insightRows) {
    console.log(`  ${row.market_id} � ${row.market_name}`);
  }
  console.log('========================================\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Starting market data seed...\n');

  await seedCompSales();
  console.log('');
  await seedMarketInsights();
  await printSummary();
}

main()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Error seeding market data:', e);
    process.exit(1);
  });