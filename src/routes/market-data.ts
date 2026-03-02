import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const marketDataRouter = new Hono();

// ==================== COMP SALES ====================

// GET /comp-sales - Returns comp sales with filtering and pagination
marketDataRouter.get("/comp-sales", async (c) => {
  try {
    const market = c.req.query("market");
    const village = c.req.query("village");
    const minPrice = c.req.query("min_price");
    const maxPrice = c.req.query("max_price");
    const rawLimit = parseInt(c.req.query("limit") || "100", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    // Clamp limit between 1 and 5000
    const limit = Math.max(1, Math.min(rawLimit, 5000));

    // Build the where clause for Prisma
    const where: {
      market_id?: string;
      sold_price?: { gte?: number; lte?: number };
    } = {};

    if (market) {
      where.market_id = market;
    }

    if (minPrice || maxPrice) {
      where.sold_price = {};
      if (minPrice) where.sold_price.gte = parseFloat(minPrice);
      if (maxPrice) where.sold_price.lte = parseFloat(maxPrice);
    }

    // For village filtering, SQLite does not support Prisma's case-insensitive mode.
    // Use a raw query approach for village filtering, or standard Prisma for other filters.
    if (village) {
      // Use raw SQL for case-insensitive village partial match
      const villagePattern = `%${village}%`;

      // Build WHERE clauses for raw SQL
      const conditions: string[] = ["LOWER(village) LIKE LOWER(?)"];
      const params: (string | number)[] = [villagePattern];

      if (market) {
        conditions.push("market_id = ?");
        params.push(market);
      }
      if (minPrice) {
        conditions.push("sold_price >= ?");
        params.push(parseFloat(minPrice));
      }
      if (maxPrice) {
        conditions.push("sold_price <= ?");
        params.push(parseFloat(maxPrice));
      }

      const whereClause = conditions.join(" AND ");

      // Get total count
      const countResult = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
        `SELECT COUNT(*) as cnt FROM comp_sales WHERE ${whereClause}`,
        ...params
      );
      const total = Number(countResult[0]?.cnt ?? 0);

      // Get paginated rows
      const rows = await prisma.$queryRawUnsafe<Array<{
        id: string;
        market_id: string;
        address: string;
        village: string | null;
        beds: number | null;
        baths: number | null;
        sqft: number | null;
        lot_acres: number | null;
        sold_price: number;
        sold_date: string | null;
        price_per_sqft: number | null;
        source: string | null;
      }>>(
        `SELECT id, market_id, address, village, beds, baths, sqft, lot_acres, sold_price, sold_date, price_per_sqft, source
         FROM comp_sales
         WHERE ${whereClause}
         ORDER BY sold_price DESC
         LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset
      );

      const sales = rows.map((row) => ({
        id: row.id,
        marketId: row.market_id,
        address: row.address,
        village: row.village,
        beds: row.beds,
        baths: row.baths,
        sqft: row.sqft,
        lotAcres: row.lot_acres,
        soldPrice: row.sold_price,
        soldDate: row.sold_date,
        pricePerSqft: row.price_per_sqft,
        source: row.source,
      }));

      return c.json({
        success: true,
        count: sales.length,
        total,
        sales,
      });
    }

    // No village filter -- use standard Prisma queries
    const [total, rows] = await Promise.all([
      prisma.compSale.count({ where }),
      prisma.compSale.findMany({
        where,
        orderBy: { sold_price: "desc" },
        take: limit,
        skip: offset,
      }),
    ]);

    const sales = rows.map((row) => ({
      id: row.id,
      marketId: row.market_id,
      address: row.address,
      village: row.village,
      beds: row.beds,
      baths: row.baths,
      sqft: row.sqft,
      lotAcres: row.lot_acres,
      soldPrice: row.sold_price,
      soldDate: row.sold_date,
      pricePerSqft: row.price_per_sqft,
      source: row.source,
    }));

    return c.json({
      success: true,
      count: sales.length,
      total,
      sales,
    });
  } catch (error: unknown) {
    console.error("[Market Data] Error fetching comp sales:", error);
    return c.json({ error: "Failed to fetch comp sales" }, 500);
  }
});

// GET /comp-sales/stats - Returns aggregate stats per market
marketDataRouter.get("/comp-sales/stats", async (c) => {
  try {
    const total = await prisma.compSale.count();

    // Group by market_id to get count and sum
    const groupedStats = await prisma.compSale.groupBy({
      by: ["market_id"],
      _count: { id: true },
      _sum: { sold_price: true },
      _avg: { sold_price: true },
    });

    // For each market, compute a median using raw SQL (approximate via OFFSET)
    const byMarket = await Promise.all(
      groupedStats.map(async (group) => {
        const marketCount = group._count.id;
        const medianOffset = Math.floor(marketCount / 2);

        // Get the median sold_price via raw SQL
        const medianResult = await prisma.$queryRawUnsafe<{ sold_price: number }[]>(
          `SELECT sold_price FROM comp_sales
           WHERE market_id = ?
           ORDER BY sold_price ASC
           LIMIT 1 OFFSET ?`,
          group.market_id,
          medianOffset
        );
        const medianPrice = medianResult[0]?.sold_price ?? 0;

        return {
          marketId: group.market_id,
          count: marketCount,
          totalVolume: Math.round(group._sum.sold_price ?? 0),
          medianPrice: Math.round(medianPrice),
        };
      })
    );

    // Sort by count descending
    byMarket.sort((a, b) => b.count - a.count);

    return c.json({
      success: true,
      stats: {
        total,
        byMarket,
      },
    });
  } catch (error: unknown) {
    console.error("[Market Data] Error fetching comp sales stats:", error);
    return c.json({ error: "Failed to fetch comp sales stats" }, 500);
  }
});

// ==================== MARKET INSIGHTS ====================

// GET /insights - Returns all market insights or filtered by market
marketDataRouter.get("/insights", async (c) => {
  try {
    const market = c.req.query("market");

    if (market) {
      const insight = await prisma.marketInsight.findUnique({
        where: { market_id: market },
      });

      if (!insight) {
        return c.json({ error: `No insights found for market: ${market}` }, 404);
      }

      let dataJson: unknown;
      try {
        dataJson = JSON.parse(insight.data_json);
      } catch {
        dataJson = insight.data_json;
      }

      return c.json({
        success: true,
        insights: [
          {
            id: insight.id,
            marketId: insight.market_id,
            marketName: insight.market_name,
            data: dataJson,
            updatedAt: insight.updated_at.toISOString(),
            createdAt: insight.created_at.toISOString(),
          },
        ],
      });
    }

    // Return all market insights
    const insights = await prisma.marketInsight.findMany({
      orderBy: { market_id: "asc" },
    });

    const transformed = insights.map((insight) => {
      let dataJson: unknown;
      try {
        dataJson = JSON.parse(insight.data_json);
      } catch {
        dataJson = insight.data_json;
      }

      return {
        id: insight.id,
        marketId: insight.market_id,
        marketName: insight.market_name,
        data: dataJson,
        updatedAt: insight.updated_at.toISOString(),
        createdAt: insight.created_at.toISOString(),
      };
    });

    return c.json({
      success: true,
      insights: transformed,
    });
  } catch (error: unknown) {
    console.error("[Market Data] Error fetching market insights:", error);
    return c.json({ error: "Failed to fetch market insights" }, 500);
  }
});

// GET /insights/:marketId - Returns insights for a specific market
marketDataRouter.get("/insights/:marketId", async (c) => {
  try {
    const marketId = c.req.param("marketId");

    const insight = await prisma.marketInsight.findUnique({
      where: { market_id: marketId },
    });

    if (!insight) {
      return c.json({ error: `No insights found for market: ${marketId}` }, 404);
    }

    let dataJson: unknown;
    try {
      dataJson = JSON.parse(insight.data_json);
    } catch {
      dataJson = insight.data_json;
    }

    return c.json({
      success: true,
      insight: {
        id: insight.id,
        marketId: insight.market_id,
        marketName: insight.market_name,
        data: dataJson,
        updatedAt: insight.updated_at.toISOString(),
        createdAt: insight.created_at.toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error("[Market Data] Error fetching market insight:", error);
    return c.json({ error: "Failed to fetch market insight" }, 500);
  }
});

// ==================== BACKUP SUMMARY ====================

// GET /backup - Admin endpoint that confirms backups exist
marketDataRouter.get("/backup", async (c) => {
  try {
    // Count comp sales by market
    const compSalesByMarket = await prisma.compSale.groupBy({
      by: ["market_id"],
      _count: { id: true },
    });

    // Count market insights
    const insightsCount = await prisma.marketInsight.count();

    // Get list of market insights with metadata
    const insights = await prisma.marketInsight.findMany({
      select: {
        id: true,
        market_id: true,
        market_name: true,
        updated_at: true,
        created_at: true,
      },
      orderBy: { market_id: "asc" },
    });

    const totalCompSales = compSalesByMarket.reduce(
      (sum, group) => sum + group._count.id,
      0
    );

    return c.json({
      success: true,
      backup: {
        compSales: {
          total: totalCompSales,
          byMarket: compSalesByMarket.map((group) => ({
            marketId: group.market_id,
            count: group._count.id,
          })),
        },
        marketInsights: {
          total: insightsCount,
          markets: insights.map((i) => ({
            id: i.id,
            marketId: i.market_id,
            marketName: i.market_name,
            updatedAt: i.updated_at.toISOString(),
            createdAt: i.created_at.toISOString(),
          })),
        },
      },
    });
  } catch (error: unknown) {
    console.error("[Market Data] Error fetching backup summary:", error);
    return c.json({ error: "Failed to fetch backup summary" }, 500);
  }
});

export { marketDataRouter };