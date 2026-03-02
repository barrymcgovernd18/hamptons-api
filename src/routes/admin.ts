/**
 * Admin Command Center API Routes
 *
 * Comprehensive admin endpoints for:
 * - Dashboard KPIs and Charts
 * - Funnel Analytics (Agent & Reader)
 * - CRM Lead Management
 * - Agent Verification
 * - Revenue Tracking
 * - Monetization/Upsells
 * - Event Tracking
 */

import * as crypto from "crypto";
import { Hono } from "hono";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AGENT_TIERS } from "../lib/tiers";
import {
  checkListingCredits,
  checkArticleCredits,
  deductListingCredit,
  deductArticleCredit,
  isDuplicateListing,
  isDuplicateArticle,
  verifyAgentByEmail,
} from "../lib/credits";

// ============================================================================
// SHARED TYPES & SCHEMAS
// ============================================================================

const MarketEnum = z.enum(["hamptons", "palm-beach", "miami", "aspen"]);
const RoleEnum = z.enum(["reader", "agent", "admin"]);
const PlanTypeEnum = z.enum([
  "reader_premium",
  "agent_20",
  "agent_50",
  "agent_100",
  "verified",
  "basic",
  "agent",
  "elite",
]);
const LeadTypeEnum = z.enum(["agent", "reader"]);
const LeadStatusEnum = z.enum([
  "not_contacted",
  "contacted",
  "interested",
  "trial",
  "paid",
  "churned",
  "not_a_fit",
]);
const LeadSourceEnum = z.enum([
  "email_outreach",
  "cold_call",
  "instagram",
  "facebook",
  "x",
  "linkedin",
  "referral",
  "organic",
  "other",
]);

// Event names for tracking
const EventNameEnum = z.enum([
  "signup_completed",
  "email_verified",
  "agent_verification_submitted",
  "agent_verification_approved",
  "agent_verification_rejected",
  "trial_started",
  "subscription_started",
  "subscription_canceled",
  "open_news_feed",
  "view_featured_listings",
  "click_featured_listing",
  "view_market_reports",
  "open_parcels",
  "run_comp_analysis",
  "read_article",
  "purchase_featured_listing",
  "purchase_featured_article",
]);

// ============================================================================
// ALL SCHEMAS DEFINED UPFRONT
// ============================================================================

const dashboardQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  market: MarketEnum.optional(),
  role: RoleEnum.optional(),
  planType: PlanTypeEnum.optional(),
});

const chartQuerySchema = z.object({
  resolution: z.enum(["daily", "weekly"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  market: MarketEnum.optional(),
});

const ChartNameEnum = z.enum([
  "signups_over_time",
  "trials_over_time",
  "conversions_over_time",
  "mrr_over_time",
  "activation_over_time",
]);

const FunnelTypeEnum = z.enum(["agent", "reader"]);

const crmLeadQuerySchema = z.object({
  market: MarketEnum.optional(),
  lead_type: LeadTypeEnum.optional(),
  status: LeadStatusEnum.optional(),
  source: LeadSourceEnum.optional(),
  sortBy: z.enum(["next_follow_up_at", "created_at"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const createCrmLeadSchema = z.object({
  lead_type: LeadTypeEnum,
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  brokerage: z.string().optional(),
  market: MarketEnum.optional(),
  source: LeadSourceEnum.optional(),
  status: LeadStatusEnum.optional(),
  notes: z.string().optional(),
  next_follow_up_at: z.string().datetime().optional(),
  owner: z.string().optional(),
});

const updateCrmLeadSchema = z.object({
  lead_type: LeadTypeEnum.optional(),
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  brokerage: z.string().optional(),
  market: MarketEnum.optional(),
  source: LeadSourceEnum.optional(),
  status: LeadStatusEnum.optional(),
  notes: z.string().optional(),
  next_follow_up_at: z.string().datetime().nullable().optional(),
  owner: z.string().optional(),
});

const verificationActionSchema = z.object({
  note: z.string().optional(),
});

const verificationRejectSchema = z.object({
  note: z.string().min(1, "Rejection note is required"),
});

const revenueSubscriptionsQuerySchema = z.object({
  status: z.enum(["active", "trialing", "canceled", "past_due", "expired"]).optional(),
  planType: PlanTypeEnum.optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const cancellationsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const monetizationTransactionsQuerySchema = z.object({
  type: z.enum(["featured_listing", "featured_article"]).optional(),
  status: z.enum(["pending", "paid", "refunded"]).optional(),
  market: MarketEnum.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const trackEventSchema = z.object({
  event_name: EventNameEnum,
  user_id: z.string().optional(),
  market: MarketEnum.optional(),
  event_properties: z.record(z.string(), z.unknown()).optional(),
});

const eventsListQuerySchema = z.object({
  event_name: EventNameEnum.optional(),
  user_id: z.string().optional(),
  market: MarketEnum.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

// ============================================================================
// ROUTER INITIALIZATION
// ============================================================================

export const adminRouter = new Hono();

// ============================================================================
// ADMIN ACCESS VERIFICATION (for mobile app admin mode)
// ============================================================================

/**
 * POST /verify-access
 * Verifies admin/employee password for mobile app admin mode.
 * Passwords are validated against server-side secrets.
 *
 * SECURITY: Uses timing-safe comparison to prevent timing attacks
 */
adminRouter.post("/verify-access", async (c) => {
  const clientIP = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') || 'unknown';

  try {
    const body = await c.req.json().catch(() => ({}));
    const { password } = body;

    console.log(`[Admin] Verify access attempt from IP: ${clientIP}`);
    console.log(`[Admin] Received password length: ${password?.length}, type: ${typeof password}`);

    if (!password || typeof password !== 'string') {
      console.log('[Admin] Password missing or not a string');
      return c.json({ success: false, error: 'Password required' }, 400);
    }

    // Get admin and employee passwords from environment
    const adminPassword = process.env.ADMIN_ACCESS_CODE;
    const employeePassword = process.env.EMPLOYEE_ACCESS_CODE;

    console.log(`[Admin] Expected admin password length: ${adminPassword?.length}`);
    console.log(`[Admin] Password received: "${password}" (${password.length} chars)`);
    console.log(`[Admin] Admin password expected: "${adminPassword}" (${adminPassword?.length} chars)`);

    if (!adminPassword || !employeePassword) {
      console.error('[Admin] CRITICAL: Admin access codes not configured!');
      return c.json({ success: false, error: 'Access not configured' }, 500);
    }

    // Use timing-safe comparison to prevent timing attacks
    const crypto = await import('crypto');

    // Check admin password
    const lengthMatch = password.length === adminPassword.length;
    console.log(`[Admin] Length match: ${lengthMatch} (${password.length} vs ${adminPassword.length})`);

    const isAdmin = lengthMatch &&
      crypto.timingSafeEqual(
        Buffer.from(password),
        Buffer.from(adminPassword)
      );

    console.log(`[Admin] isAdmin result: ${isAdmin}`);

    if (isAdmin) {
      console.log(`[Admin] Admin access granted from IP: ${clientIP}`);
      console.log(`[AUDIT][INFO] action=admin_access_granted level=admin ip=${clientIP}`);
      return c.json({
        success: true,
        accessLevel: 'admin',
      });
    }

    // Check employee password
    const isEmployee = password.length === employeePassword.length &&
      crypto.timingSafeEqual(
        Buffer.from(password),
        Buffer.from(employeePassword)
      );

    if (isEmployee) {
      console.log(`[Admin] Employee access granted from IP: ${clientIP}`);
      console.log(`[AUDIT][INFO] action=admin_access_granted level=employee ip=${clientIP}`);
      return c.json({
        success: true,
        accessLevel: 'employee',
      });
    }

    // Invalid password
    console.warn(`[Admin] Failed access attempt from IP: ${clientIP}`);
    console.log(`[AUDIT][WARN] action=admin_access_denied ip=${clientIP}`);
    return c.json({ success: false, error: 'Invalid password' }, 401);

  } catch (error) {
    console.error('[Admin] Verify access error:', error);
    return c.json({ success: false, error: 'Verification failed' }, 500);
  }
});

// ============================================================================
// 1. DASHBOARD KPIs
// ============================================================================

/**
 * GET /dashboard
 * Returns all KPI metrics: signups, trials, conversions, MRR, churn, activation rates
 */
adminRouter.get("/dashboard", async (c) => {
  try {
    const rawQuery = {
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      market: c.req.query("market"),
      role: c.req.query("role"),
      planType: c.req.query("planType"),
    };

    const parsed = dashboardQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid query parameters", details: parsed.error.issues }, 400);
    }
    const query = parsed.data;

    const startDate = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    // Build user filter conditions
    const userWhere: Record<string, unknown> = {
      created_at: { gte: startDate, lte: endDate },
    };
    if (query.market) userWhere.market_primary = query.market;
    if (query.role) userWhere.role = query.role;

    // Build subscription filter conditions
    const subscriptionWhere: Record<string, unknown> = {
      created_at: { gte: startDate, lte: endDate },
    };
    if (query.planType) subscriptionWhere.plan_type = query.planType;

    // Signups
    const totalSignups = await prisma.user.count({ where: userWhere });

    // Email verified count
    const emailVerified = await prisma.user.count({
      where: { ...userWhere, is_email_verified: true },
    });

    // Agent verification counts
    const verificationSubmitted = await prisma.user.count({
      where: { ...userWhere, agent_verification_status: "pending" },
    });
    const verificationApproved = await prisma.user.count({
      where: { ...userWhere, agent_verification_status: "approved" },
    });

    // Trial counts
    const trialing = await prisma.subscription.count({
      where: { ...subscriptionWhere, status: "trialing" },
    });

    // Active subscriptions
    const activeSubscriptions = await prisma.subscription.count({
      where: { ...subscriptionWhere, status: "active" },
    });

    // Conversions (from trial to active)
    const conversions = await prisma.subscription.count({
      where: {
        ...subscriptionWhere,
        status: "active",
        trial_start_at: { not: null },
      },
    });

    // MRR calculation
    const mrrResult = await prisma.subscription.aggregate({
      where: { status: "active" },
      _sum: { mrr_amount: true },
    });
    const mrr = mrrResult._sum.mrr_amount || 0;

    // Churn (canceled in period)
    const churned = await prisma.subscription.count({
      where: {
        canceled_at: { gte: startDate, lte: endDate },
      },
    });

    // Churn rate calculation
    const totalActiveAtPeriodStart = await prisma.subscription.count({
      where: {
        status: "active",
        created_at: { lt: startDate },
      },
    });
    const churnRate = totalActiveAtPeriodStart > 0 ? (churned / totalActiveAtPeriodStart) * 100 : 0;

    // Activation rates (7-day activation based on events)
    const usersInPeriod = await prisma.user.findMany({
      where: userWhere,
      select: { id: true, created_at: true },
    });

    let activatedCount = 0;
    for (const user of usersInPeriod) {
      const activationWindow = new Date(user.created_at.getTime() + 7 * 24 * 60 * 60 * 1000);
      const eventCount = await prisma.event.count({
        where: {
          user_id: user.id,
          created_at: { gte: user.created_at, lte: activationWindow },
          event_name: {
            in: [
              "open_news_feed",
              "view_featured_listings",
              "view_market_reports",
              "open_parcels",
              "run_comp_analysis",
              "read_article",
            ],
          },
        },
      });
      if (eventCount >= 3) activatedCount++;
    }
    const activationRate = usersInPeriod.length > 0 ? (activatedCount / usersInPeriod.length) * 100 : 0;

    // Trial conversion rate
    const totalTrialsInPeriod = await prisma.subscription.count({
      where: {
        trial_start_at: { gte: startDate, lte: endDate },
      },
    });
    const trialConversionRate = totalTrialsInPeriod > 0 ? (conversions / totalTrialsInPeriod) * 100 : 0;

    return c.json({
      success: true,
      data: {
        signups: {
          total: totalSignups,
          emailVerified,
          verificationSubmitted,
          verificationApproved,
        },
        trials: {
          active: trialing,
          total: totalTrialsInPeriod,
          conversionRate: Math.round(trialConversionRate * 100) / 100,
        },
        conversions: {
          total: conversions,
        },
        revenue: {
          mrr: Math.round(mrr * 100) / 100,
          activeSubscriptions,
        },
        churn: {
          total: churned,
          rate: Math.round(churnRate * 100) / 100,
        },
        activation: {
          activated7d: activatedCount,
          rate: Math.round(activationRate * 100) / 100,
        },
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        filters: {
          market: query.market || "all",
          role: query.role || "all",
          planType: query.planType || "all",
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Dashboard error:", error);
    return c.json({ success: false, error: "Failed to fetch dashboard data" }, 500);
  }
});

// ============================================================================
// 2. DASHBOARD CHARTS
// ============================================================================

/**
 * GET /charts/:chartName
 * Returns time-series chart data
 */
adminRouter.get("/charts/:chartName", async (c) => {
  try {
    const chartName = c.req.param("chartName");

    // Validate chart name
    const validCharts = ChartNameEnum.safeParse(chartName);
    if (!validCharts.success) {
      return c.json({ success: false, error: "Invalid chart name" }, 400);
    }

    const rawQuery = {
      resolution: c.req.query("resolution"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      market: c.req.query("market"),
    };

    const parsed = chartQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid query parameters", details: parsed.error.issues }, 400);
    }
    const query = parsed.data;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    const resolution = query.resolution || "daily";

    // Generate date buckets
    const buckets: { start: Date; end: Date; label: string }[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const bucketStart = new Date(currentDate);
      let bucketEnd: Date;
      let label: string;

      if (resolution === "weekly") {
        bucketEnd = new Date(currentDate);
        bucketEnd.setDate(bucketEnd.getDate() + 6);
        if (bucketEnd > endDate) bucketEnd = new Date(endDate);
        label = `${bucketStart.toISOString().split("T")[0] ?? ""} - ${bucketEnd.toISOString().split("T")[0] ?? ""}`;
        currentDate.setDate(currentDate.getDate() + 7);
      } else {
        bucketEnd = new Date(currentDate);
        bucketEnd.setHours(23, 59, 59, 999);
        label = bucketStart.toISOString().split("T")[0] ?? "";
        currentDate.setDate(currentDate.getDate() + 1);
      }

      buckets.push({ start: bucketStart, end: bucketEnd, label });
    }

    const marketFilter = query.market ? { market_primary: query.market } : {};

    // Build chart data based on chart type
    const dataPoints: { label: string; value: number }[] = [];

    for (const bucket of buckets) {
      let value = 0;

      switch (chartName) {
        case "signups_over_time":
          value = await prisma.user.count({
            where: {
              ...marketFilter,
              created_at: { gte: bucket.start, lte: bucket.end },
            },
          });
          break;

        case "trials_over_time":
          value = await prisma.subscription.count({
            where: {
              trial_start_at: { gte: bucket.start, lte: bucket.end },
            },
          });
          break;

        case "conversions_over_time":
          value = await prisma.subscription.count({
            where: {
              status: "active",
              trial_start_at: { not: null },
              current_period_start: { gte: bucket.start, lte: bucket.end },
            },
          });
          break;

        case "mrr_over_time": {
          const mrrResult = await prisma.subscription.aggregate({
            where: {
              status: "active",
              created_at: { lte: bucket.end },
              OR: [{ canceled_at: null }, { canceled_at: { gt: bucket.end } }],
            },
            _sum: { mrr_amount: true },
          });
          value = mrrResult._sum.mrr_amount || 0;
          break;
        }

        case "activation_over_time": {
          // Count users who activated (3+ feature events within 7 days)
          const usersInBucket = await prisma.user.findMany({
            where: {
              ...marketFilter,
              created_at: { gte: bucket.start, lte: bucket.end },
            },
            select: { id: true, created_at: true },
          });

          let activatedInBucket = 0;
          for (const user of usersInBucket) {
            const activationWindow = new Date(
              user.created_at.getTime() + 7 * 24 * 60 * 60 * 1000
            );
            const eventCount = await prisma.event.count({
              where: {
                user_id: user.id,
                created_at: { gte: user.created_at, lte: activationWindow },
                event_name: {
                  in: [
                    "open_news_feed",
                    "view_featured_listings",
                    "view_market_reports",
                    "open_parcels",
                    "run_comp_analysis",
                    "read_article",
                  ],
                },
              },
            });
            if (eventCount >= 3) activatedInBucket++;
          }
          value = activatedInBucket;
          break;
        }
      }

      dataPoints.push({
        label: bucket.label,
        value: Math.round(value * 100) / 100,
      });
    }

    // Calculate totals and averages
    const total = dataPoints.reduce((sum, dp) => sum + dp.value, 0);
    const average = dataPoints.length > 0 ? total / dataPoints.length : 0;

    return c.json({
      success: true,
      data: {
        chartName,
        resolution,
        dataPoints,
        summary: {
          total: Math.round(total * 100) / 100,
          average: Math.round(average * 100) / 100,
          min: dataPoints.length > 0 ? Math.min(...dataPoints.map((dp) => dp.value)) : 0,
          max: dataPoints.length > 0 ? Math.max(...dataPoints.map((dp) => dp.value)) : 0,
        },
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        filters: {
          market: query.market || "all",
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Charts error:", error);
    return c.json({ success: false, error: "Failed to fetch chart data" }, 500);
  }
});

// ============================================================================
// 3. FUNNELS
// ============================================================================

/**
 * GET /funnels/:funnelType
 * Returns funnel metrics with conversion rates between stages
 */
adminRouter.get("/funnels/:funnelType", async (c) => {
  try {
    const funnelType = c.req.param("funnelType");
    const validFunnel = FunnelTypeEnum.safeParse(funnelType);

    if (!validFunnel.success) {
      return c.json({ success: false, error: "Invalid funnel type. Use 'agent' or 'reader'" }, 400);
    }

    const startDateParam = c.req.query("startDate");
    const endDateParam = c.req.query("endDate");
    const startDate = startDateParam ? new Date(startDateParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = endDateParam ? new Date(endDateParam) : new Date();

    const dateFilter = { created_at: { gte: startDate, lte: endDate } };

    interface FunnelStage {
      stage: string;
      count: number;
      conversionFromPrevious: number | null;
      conversionFromTop: number | null;
    }

    const stages: FunnelStage[] = [];

    if (funnelType === "agent") {
      // Agent funnel stages
      // 1. signup_completed (agents)
      const signupCompleted = await prisma.event.count({
        where: { ...dateFilter, event_name: "signup_completed" },
      });

      // 2. verification_submitted
      const verificationSubmitted = await prisma.user.count({
        where: {
          ...dateFilter,
          role: "agent",
          agent_verification_status: { in: ["pending", "approved", "rejected"] },
        },
      });

      // 3. verification_approved
      const verificationApproved = await prisma.user.count({
        where: {
          ...dateFilter,
          role: "agent",
          agent_verification_status: "approved",
        },
      });

      // 4. trial_started (for agents)
      const trialStarted = await prisma.subscription.count({
        where: {
          ...dateFilter,
          trial_start_at: { not: null },
          user: { role: "agent" },
        },
      });

      // 5. activated_7d
      const agentUsers = await prisma.user.findMany({
        where: { ...dateFilter, role: "agent" },
        select: { id: true, created_at: true },
      });

      let activated7d = 0;
      for (const user of agentUsers) {
        const activationWindow = new Date(user.created_at.getTime() + 7 * 24 * 60 * 60 * 1000);
        const eventCount = await prisma.event.count({
          where: {
            user_id: user.id,
            created_at: { gte: user.created_at, lte: activationWindow },
            event_name: {
              in: [
                "open_news_feed",
                "view_featured_listings",
                "view_market_reports",
                "open_parcels",
                "run_comp_analysis",
              ],
            },
          },
        });
        if (eventCount >= 3) activated7d++;
      }

      // 6. subscription_started
      const subscriptionStarted = await prisma.subscription.count({
        where: {
          ...dateFilter,
          status: "active",
          user: { role: "agent" },
        },
      });

      // 7. retention_30d (still active after 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const retention30d = await prisma.subscription.count({
        where: {
          status: "active",
          created_at: { lte: thirtyDaysAgo },
          user: { role: "agent" },
        },
      });

      // Build funnel stages
      const counts = [
        signupCompleted,
        verificationSubmitted,
        verificationApproved,
        trialStarted,
        activated7d,
        subscriptionStarted,
        retention30d,
      ];
      const stageNames = [
        "signup_completed",
        "verification_submitted",
        "verification_approved",
        "trial_started",
        "activated_7d",
        "subscription_started",
        "retention_30d",
      ];

      for (let i = 0; i < counts.length; i++) {
        const stageName = stageNames[i] ?? "";
        const count = counts[i] ?? 0;
        const prevCount = counts[i - 1] ?? 0;
        const topCount = counts[0] ?? 0;
        const stage: FunnelStage = {
          stage: stageName,
          count: count,
          conversionFromPrevious: i > 0 && prevCount > 0 ? (count / prevCount) * 100 : null,
          conversionFromTop: topCount > 0 ? (count / topCount) * 100 : null,
        };
        stages.push(stage);
      }
    } else {
      // Reader funnel stages
      // 1. signup_completed (readers)
      const signupCompleted = await prisma.event.count({
        where: { ...dateFilter, event_name: "signup_completed" },
      });

      // 2. email_verified
      const emailVerified = await prisma.user.count({
        where: { ...dateFilter, role: "reader", is_email_verified: true },
      });

      // 3. trial_started
      const trialStarted = await prisma.subscription.count({
        where: {
          ...dateFilter,
          trial_start_at: { not: null },
          user: { role: "reader" },
        },
      });

      // 4. activated_7d
      const readerUsers = await prisma.user.findMany({
        where: { ...dateFilter, role: "reader" },
        select: { id: true, created_at: true },
      });

      let activated7d = 0;
      for (const user of readerUsers) {
        const activationWindow = new Date(user.created_at.getTime() + 7 * 24 * 60 * 60 * 1000);
        const eventCount = await prisma.event.count({
          where: {
            user_id: user.id,
            created_at: { gte: user.created_at, lte: activationWindow },
            event_name: {
              in: ["open_news_feed", "read_article", "view_featured_listings"],
            },
          },
        });
        if (eventCount >= 3) activated7d++;
      }

      // 5. subscription_started
      const subscriptionStarted = await prisma.subscription.count({
        where: {
          ...dateFilter,
          status: "active",
          user: { role: "reader" },
        },
      });

      // 6. retention_30d
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const retention30d = await prisma.subscription.count({
        where: {
          status: "active",
          created_at: { lte: thirtyDaysAgo },
          user: { role: "reader" },
        },
      });

      // Build funnel stages
      const counts = [
        signupCompleted,
        emailVerified,
        trialStarted,
        activated7d,
        subscriptionStarted,
        retention30d,
      ];
      const stageNames = [
        "signup_completed",
        "email_verified",
        "trial_started",
        "activated_7d",
        "subscription_started",
        "retention_30d",
      ];

      for (let i = 0; i < counts.length; i++) {
        const stageName = stageNames[i] ?? "";
        const count = counts[i] ?? 0;
        const prevCount = counts[i - 1] ?? 0;
        const topCount = counts[0] ?? 0;
        const stage: FunnelStage = {
          stage: stageName,
          count: count,
          conversionFromPrevious: i > 0 && prevCount > 0 ? (count / prevCount) * 100 : null,
          conversionFromTop: topCount > 0 ? (count / topCount) * 100 : null,
        };
        stages.push(stage);
      }
    }

    // Round conversion rates
    for (const stage of stages) {
      if (stage.conversionFromPrevious !== null) {
        stage.conversionFromPrevious = Math.round(stage.conversionFromPrevious * 100) / 100;
      }
      if (stage.conversionFromTop !== null) {
        stage.conversionFromTop = Math.round(stage.conversionFromTop * 100) / 100;
      }
    }

    return c.json({
      success: true,
      data: {
        funnelType,
        stages,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Funnels error:", error);
    return c.json({ success: false, error: "Failed to fetch funnel data" }, 500);
  }
});

// ============================================================================
// 4. CRM LEADS
// ============================================================================

/**
 * GET /crm/leads
 * List CRM leads with filtering and sorting
 */
adminRouter.get("/crm/leads", async (c) => {
  try {
    const rawQuery = {
      market: c.req.query("market"),
      lead_type: c.req.query("lead_type"),
      status: c.req.query("status"),
      source: c.req.query("source"),
      sortBy: c.req.query("sortBy"),
      sortOrder: c.req.query("sortOrder"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    };

    const parsed = crmLeadQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid query parameters", details: parsed.error.issues }, 400);
    }
    const query = parsed.data;
    const search = c.req.query("search");

    const where: Record<string, unknown> = {};
    if (query.market) where.market = query.market;
    if (query.lead_type) where.lead_type = query.lead_type;
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { brokerage: { contains: search } },
      ];
    }

    const sortBy = query.sortBy || "created_at";
    const sortOrder = query.sortOrder || "desc";
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const orderBy: Record<string, "asc" | "desc"> = {};
    orderBy[sortBy] = sortOrder;

    const [leads, total] = await Promise.all([
      prisma.crmLead.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
      }),
      prisma.crmLead.count({ where }),
    ]);

    return c.json({
      success: true,
      data: {
        leads,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + leads.length < total,
        },
      },
    });
  } catch (error) {
    console.error("[Admin] CRM leads list error:", error);
    return c.json({ success: false, error: "Failed to fetch leads" }, 500);
  }
});

/**
 * POST /crm/leads
 * Create a new CRM lead
 */
adminRouter.post("/crm/leads", async (c) => {
  try {
    const rawBody = await c.req.json();
    const parsed = createCrmLeadSchema.safeParse(rawBody);

    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    const body = parsed.data;

    const lead = await prisma.crmLead.create({
      data: {
        lead_type: body.lead_type,
        name: body.name,
        email: body.email,
        phone: body.phone,
        brokerage: body.brokerage,
        market: body.market || "hamptons",
        source: body.source || "organic",
        status: body.status || "not_contacted",
        notes: body.notes,
        next_follow_up_at: body.next_follow_up_at ? new Date(body.next_follow_up_at) : null,
        owner: body.owner || "Barry",
      },
    });

    return c.json({ success: true, data: { lead } }, 201);
  } catch (error) {
    console.error("[Admin] CRM lead create error:", error);
    return c.json({ success: false, error: "Failed to create lead" }, 500);
  }
});

/**
 * PUT /crm/leads/:id
 * Update a CRM lead
 */
adminRouter.put("/crm/leads/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const rawBody = await c.req.json();
    const parsed = updateCrmLeadSchema.safeParse(rawBody);

    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    const body = parsed.data;

    const existingLead = await prisma.crmLead.findUnique({ where: { id } });
    if (!existingLead) {
      return c.json({ success: false, error: "Lead not found" }, 404);
    }

    const updateData: Record<string, unknown> = {};
    if (body.lead_type !== undefined) updateData.lead_type = body.lead_type;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.brokerage !== undefined) updateData.brokerage = body.brokerage;
    if (body.market !== undefined) updateData.market = body.market;
    if (body.source !== undefined) updateData.source = body.source;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.owner !== undefined) updateData.owner = body.owner;
    if (body.next_follow_up_at !== undefined) {
      updateData.next_follow_up_at = body.next_follow_up_at ? new Date(body.next_follow_up_at) : null;
    }

    const lead = await prisma.crmLead.update({
      where: { id },
      data: updateData,
    });

    return c.json({ success: true, data: { lead } });
  } catch (error) {
    console.error("[Admin] CRM lead update error:", error);
    return c.json({ success: false, error: "Failed to update lead" }, 500);
  }
});

/**
 * DELETE /crm/leads/:id
 * Delete a CRM lead
 */
adminRouter.delete("/crm/leads/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const existingLead = await prisma.crmLead.findUnique({ where: { id } });
    if (!existingLead) {
      return c.json({ success: false, error: "Lead not found" }, 404);
    }

    await prisma.crmLead.delete({ where: { id } });

    return c.json({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    console.error("[Admin] CRM lead delete error:", error);
    return c.json({ success: false, error: "Failed to delete lead" }, 500);
  }
});

// ============================================================================
// 5. AGENT VERIFICATION
// ============================================================================

/**
 * GET /verification/pending
 * Get pending agent verifications with average time-to-approve
 */
adminRouter.get("/verification/pending", async (c) => {
  try {
    const pendingVerifications = await prisma.user.findMany({
      where: { agent_verification_status: "pending" },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        agent_license_number: true,
        agent_brokerage: true,
        agent_verification_submitted_at: true,
        market_primary: true,
        created_at: true,
      },
      orderBy: { agent_verification_submitted_at: "asc" },
    });

    // Calculate average time-to-approve for approved verifications
    const approvedVerifications = await prisma.user.findMany({
      where: {
        agent_verification_status: "approved",
        agent_verification_submitted_at: { not: null },
        agent_verification_reviewed_at: { not: null },
      },
      select: {
        agent_verification_submitted_at: true,
        agent_verification_reviewed_at: true,
      },
    });

    let avgTimeToApproveHours: number | null = null;
    if (approvedVerifications.length > 0) {
      const totalTimeMs = approvedVerifications.reduce((sum, v) => {
        const submitted = v.agent_verification_submitted_at!;
        const reviewed = v.agent_verification_reviewed_at!;
        return sum + (reviewed.getTime() - submitted.getTime());
      }, 0);
      avgTimeToApproveHours = totalTimeMs / approvedVerifications.length / (1000 * 60 * 60);
    }

    // Calculate wait time for each pending verification
    const now = new Date();
    const pendingWithWaitTime = pendingVerifications.map((v) => ({
      ...v,
      waitTimeHours: v.agent_verification_submitted_at
        ? Math.round(
            ((now.getTime() - v.agent_verification_submitted_at.getTime()) / (1000 * 60 * 60)) * 100
          ) / 100
        : null,
    }));

    return c.json({
      success: true,
      data: {
        pending: pendingWithWaitTime,
        count: pendingVerifications.length,
        avgTimeToApproveHours: avgTimeToApproveHours
          ? Math.round(avgTimeToApproveHours * 100) / 100
          : null,
      },
    });
  } catch (error) {
    console.error("[Admin] Verification pending error:", error);
    return c.json({ success: false, error: "Failed to fetch pending verifications" }, 500);
  }
});

/**
 * POST /verification/:userId/approve
 * Approve an agent verification
 */
adminRouter.post("/verification/:userId/approve", async (c) => {
  try {
    const userId = c.req.param("userId");
    const rawBody = await c.req.json().catch(() => ({}));
    const parsed = verificationActionSchema.safeParse(rawBody);

    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    const body = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return c.json({ success: false, error: "User not found" }, 404);
    }

    if (user.agent_verification_status !== "pending") {
      return c.json({ success: false, error: "Verification is not pending" }, 400);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        agent_verification_status: "approved",
        agent_verification_reviewed_at: new Date(),
        role: "agent",
        tier: "verified",
      },
    });
    console.log("[Admin] Agent approved, DB updated:", updatedUser.id, "verificationStatus:", updatedUser.agent_verification_status);

    // Also update the agentRequest table so the mobile app picks up the approval
    if (updatedUser.email) {
      await prisma.agentRequest.update({
        where: { email: updatedUser.email.toLowerCase() },
        data: {
          status: "approved",
          reviewed_at: new Date(),
        },
      }).catch(() => {
        // Safe to fail if no agentRequest record exists for this user
        console.log("[Admin] No agentRequest record found for", updatedUser.email);
      });
    }

    // Track the event
    await prisma.event.create({
      data: {
        user_id: userId,
        event_name: "agent_verification_approved",
        event_properties: JSON.stringify({ note: body.note }),
        market: user.market_primary,
      },
    });

    return c.json({
      success: true,
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          agent_verification_status: updatedUser.agent_verification_status,
          role: updatedUser.role,
          tier: updatedUser.tier,
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Verification approve error:", error);
    return c.json({ success: false, error: "Failed to approve verification" }, 500);
  }
});

/**
 * POST /verification/:userId/reject
 * Reject an agent verification (note required)
 */
adminRouter.post("/verification/:userId/reject", async (c) => {
  try {
    const userId = c.req.param("userId");
    const rawBody = await c.req.json();
    const parsed = verificationRejectSchema.safeParse(rawBody);

    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    const body = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return c.json({ success: false, error: "User not found" }, 404);
    }

    if (user.agent_verification_status !== "pending") {
      return c.json({ success: false, error: "Verification is not pending" }, 400);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        agent_verification_status: "rejected",
        agent_verification_reviewed_at: new Date(),
      },
    });

    // Also update the agentRequest table so the mobile app picks up the rejection
    if (updatedUser.email) {
      await prisma.agentRequest.update({
        where: { email: updatedUser.email.toLowerCase() },
        data: {
          status: "rejected",
          reviewed_at: new Date(),
          rejection_reason: body.note || null,
        },
      }).catch(() => {
        console.log("[Admin] No agentRequest record found for", updatedUser.email);
      });
    }

    // Track the event
    await prisma.event.create({
      data: {
        user_id: userId,
        event_name: "agent_verification_rejected",
        event_properties: JSON.stringify({ note: body.note }),
        market: user.market_primary,
      },
    });

    return c.json({
      success: true,
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          agent_verification_status: updatedUser.agent_verification_status,
        },
        rejectionNote: body.note,
      },
    });
  } catch (error) {
    console.error("[Admin] Verification reject error:", error);
    return c.json({ success: false, error: "Failed to reject verification" }, 500);
  }
});

// ============================================================================
// 6. REVENUE
// ============================================================================

/**
 * GET /revenue/summary
 * Get revenue summary: active subscribers by tier, MRR by tier, trialing by tier
 */
adminRouter.get("/revenue/summary", async (c) => {
  try {
    // Get all active subscriptions
    const activeSubscriptions = await prisma.subscription.findMany({
      where: { status: "active" },
      include: { user: { select: { tier: true, role: true } } },
    });

    // Get all trialing subscriptions
    const trialingSubscriptions = await prisma.subscription.findMany({
      where: { status: "trialing" },
      include: { user: { select: { tier: true, role: true } } },
    });

    // Group by tier/plan
    const tierGroups: Record<
      string,
      { active: number; trialing: number; mrr: number }
    > = {};

    for (const sub of activeSubscriptions) {
      const tier = sub.plan_type;
      if (!tierGroups[tier]) {
        tierGroups[tier] = { active: 0, trialing: 0, mrr: 0 };
      }
      tierGroups[tier].active++;
      tierGroups[tier].mrr += sub.mrr_amount;
    }

    for (const sub of trialingSubscriptions) {
      const tier = sub.plan_type;
      if (!tierGroups[tier]) {
        tierGroups[tier] = { active: 0, trialing: 0, mrr: 0 };
      }
      tierGroups[tier].trialing++;
    }

    // Calculate totals
    const totalMrr = Object.values(tierGroups).reduce((sum, g) => sum + g.mrr, 0);
    const totalActive = Object.values(tierGroups).reduce((sum, g) => sum + g.active, 0);
    const totalTrialing = Object.values(tierGroups).reduce((sum, g) => sum + g.trialing, 0);
    const arr = totalMrr * 12;

    // Round MRR values
    for (const key of Object.keys(tierGroups)) {
      const group = tierGroups[key];
      if (group) {
        group.mrr = Math.round(group.mrr * 100) / 100;
      }
    }

    return c.json({
      success: true,
      data: {
        totals: {
          mrr: Math.round(totalMrr * 100) / 100,
          arr: Math.round(arr * 100) / 100,
          activeSubscriptions: totalActive,
          trialingSubscriptions: totalTrialing,
        },
        byTier: tierGroups,
        tierPricing: Object.fromEntries(
          Object.entries(AGENT_TIERS).map(([k, v]) => [k, { name: v.name, price: v.price }])
        ),
      },
    });
  } catch (error) {
    console.error("[Admin] Revenue summary error:", error);
    return c.json({ success: false, error: "Failed to fetch revenue summary" }, 500);
  }
});

/**
 * GET /revenue/subscriptions
 * List subscriptions with filters
 */
adminRouter.get("/revenue/subscriptions", async (c) => {
  try {
    const rawQuery = {
      status: c.req.query("status"),
      planType: c.req.query("planType"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    };

    const parsed = revenueSubscriptionsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid query parameters", details: parsed.error.issues }, 400);
    }
    const query = parsed.data;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.planType) where.plan_type = query.planType;

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              tier: true,
              role: true,
              market_primary: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.subscription.count({ where }),
    ]);

    return c.json({
      success: true,
      data: {
        subscriptions,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + subscriptions.length < total,
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Revenue subscriptions error:", error);
    return c.json({ success: false, error: "Failed to fetch subscriptions" }, 500);
  }
});

/**
 * GET /revenue/cancellations
 * List cancellations with reasons
 */
adminRouter.get("/revenue/cancellations", async (c) => {
  try {
    const rawQuery = {
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    };

    const parsed = cancellationsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid query parameters", details: parsed.error.issues }, 400);
    }
    const query = parsed.data;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const where = {
      canceled_at: { gte: startDate, lte: endDate },
    };

    const [cancellations, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              tier: true,
              role: true,
              market_primary: true,
            },
          },
        },
        orderBy: { canceled_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.subscription.count({ where }),
    ]);

    // Group cancellation reasons
    const reasonCounts: Record<string, number> = {};
    for (const cancellation of cancellations) {
      const reason = cancellation.cancel_reason || "not_specified";
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }

    return c.json({
      success: true,
      data: {
        cancellations,
        reasonBreakdown: reasonCounts,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + cancellations.length < total,
        },
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Revenue cancellations error:", error);
    return c.json({ success: false, error: "Failed to fetch cancellations" }, 500);
  }
});

// ============================================================================
// 7. MONETIZATION / UPSELLS
// ============================================================================

/**
 * GET /monetization/summary
 * Get monetization summary: featured listings and articles count/revenue
 */
adminRouter.get("/monetization/summary", async (c) => {
  try {
    const startDateParam = c.req.query("startDate");
    const endDateParam = c.req.query("endDate");
    const startDate = startDateParam
      ? new Date(startDateParam)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = endDateParam ? new Date(endDateParam) : new Date();

    const dateFilter = { created_at: { gte: startDate, lte: endDate } };

    // Featured listings
    const featuredListings = await prisma.monetization.findMany({
      where: { ...dateFilter, type: "featured_listing", status: "paid" },
    });
    const featuredListingsCount = featuredListings.length;
    const featuredListingsRevenue = featuredListings.reduce((sum, m) => sum + m.amount, 0);

    // Featured articles
    const featuredArticles = await prisma.monetization.findMany({
      where: { ...dateFilter, type: "featured_article", status: "paid" },
    });
    const featuredArticlesCount = featuredArticles.length;
    const featuredArticlesRevenue = featuredArticles.reduce((sum, m) => sum + m.amount, 0);

    // Pending transactions
    const pendingTransactions = await prisma.monetization.count({
      where: { ...dateFilter, status: "pending" },
    });

    // By market breakdown
    const byMarket: Record<string, { listings: number; articles: number; revenue: number }> = {};
    const markets = ["hamptons", "palm-beach", "miami", "aspen"];

    for (const market of markets) {
      const listingsInMarket = featuredListings.filter((m) => m.market === market);
      const articlesInMarket = featuredArticles.filter((m) => m.market === market);
      byMarket[market] = {
        listings: listingsInMarket.length,
        articles: articlesInMarket.length,
        revenue:
          listingsInMarket.reduce((sum, m) => sum + m.amount, 0) +
          articlesInMarket.reduce((sum, m) => sum + m.amount, 0),
      };
    }

    return c.json({
      success: true,
      data: {
        featuredListings: {
          count: featuredListingsCount,
          revenue: Math.round(featuredListingsRevenue * 100) / 100,
        },
        featuredArticles: {
          count: featuredArticlesCount,
          revenue: Math.round(featuredArticlesRevenue * 100) / 100,
        },
        totals: {
          transactions: featuredListingsCount + featuredArticlesCount,
          revenue: Math.round((featuredListingsRevenue + featuredArticlesRevenue) * 100) / 100,
          pending: pendingTransactions,
        },
        byMarket,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Monetization summary error:", error);
    return c.json({ success: false, error: "Failed to fetch monetization summary" }, 500);
  }
});

/**
 * GET /monetization/transactions
 * List monetization transactions with filters
 */
adminRouter.get("/monetization/transactions", async (c) => {
  try {
    const rawQuery = {
      type: c.req.query("type"),
      status: c.req.query("status"),
      market: c.req.query("market"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    };

    const parsed = monetizationTransactionsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid query parameters", details: parsed.error.issues }, 400);
    }
    const query = parsed.data;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const where: Record<string, unknown> = {
      created_at: { gte: startDate, lte: endDate },
    };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.market) where.market = query.market;

    const [transactions, total] = await Promise.all([
      prisma.monetization.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.monetization.count({ where }),
    ]);

    return c.json({
      success: true,
      data: {
        transactions,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + transactions.length < total,
        },
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Monetization transactions error:", error);
    return c.json({ success: false, error: "Failed to fetch transactions" }, 500);
  }
});

// ============================================================================
// 8. EVENTS TRACKING
// ============================================================================

/**
 * POST /events/track
 * Track an event from the app
 */
adminRouter.post("/events/track", async (c) => {
  try {
    const rawBody = await c.req.json();
    const parsed = trackEventSchema.safeParse(rawBody);

    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid request body", details: parsed.error.issues }, 400);
    }
    const body = parsed.data;

    const event = await prisma.event.create({
      data: {
        event_name: body.event_name,
        user_id: body.user_id,
        market: body.market || "hamptons",
        event_properties: body.event_properties ? JSON.stringify(body.event_properties) : null,
      },
    });

    return c.json({
      success: true,
      data: {
        eventId: event.id,
        event_name: event.event_name,
        tracked_at: event.created_at,
      },
    });
  } catch (error) {
    console.error("[Admin] Event track error:", error);
    return c.json({ success: false, error: "Failed to track event" }, 500);
  }
});

/**
 * GET /events/list
 * List tracked events with filters (bonus endpoint for debugging)
 */
adminRouter.get("/events/list", async (c) => {
  try {
    const rawQuery = {
      event_name: c.req.query("event_name"),
      user_id: c.req.query("user_id"),
      market: c.req.query("market"),
      startDate: c.req.query("startDate"),
      endDate: c.req.query("endDate"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    };

    const parsed = eventsListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid query parameters", details: parsed.error.issues }, 400);
    }
    const query = parsed.data;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const where: Record<string, unknown> = {
      created_at: { gte: startDate, lte: endDate },
    };
    if (query.event_name) where.event_name = query.event_name;
    if (query.user_id) where.user_id = query.user_id;
    if (query.market) where.market = query.market;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.event.count({ where }),
    ]);

    // Parse event_properties JSON for each event
    const parsedEvents = events.map((e) => ({
      ...e,
      event_properties: e.event_properties ? JSON.parse(e.event_properties) : null,
    }));

    return c.json({
      success: true,
      data: {
        events: parsedEvents,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + events.length < total,
        },
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[Admin] Events list error:", error);
    return c.json({ success: false, error: "Failed to fetch events" }, 500);
  }
});

// ============================================================================
// AGENT REQUESTS
// ============================================================================

// POST /api/admin/agent-requests - Submit a new agent sign-up request (no auth needed)
// Note: This endpoint is called during sign-up so it bypasses admin auth
adminRouter.post("/agent-requests/submit", async (c) => {
  try {
    const body = await c.req.json();
    const { name, email, phone, license_number, broker_company, sign_in_method } = body;

    if (!name || !email || !license_number || !broker_company) {
      return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    const emailLower = email.toLowerCase();

    // Count existing requests to assign agent_number
    const count = await prisma.agentRequest.count();
    const agentNumber = count + 1;

    // Upsert: if email already exists, update it
    const request = await prisma.agentRequest.upsert({
      where: { email: emailLower },
      update: {
        name,
        phone: phone || null,
        license_number,
        broker_company,
        status: "pending",
        rejection_reason: null,
        submitted_at: new Date(),
        reviewed_at: null,
        sign_in_method: sign_in_method || "email",
      },
      create: {
        name,
        email: emailLower,
        phone: phone || null,
        license_number,
        broker_company,
        agent_number: agentNumber,
        status: "pending",
        sign_in_method: sign_in_method || "email",
      },
    });

    // ALSO update the user table so the mobile app sees "pending" status
    // Check first to avoid crash on empty Railway DB
    const existingUser = await prisma.user.findUnique({ where: { email: emailLower } });
    if (existingUser) {
      await prisma.user.update({
        where: { email: emailLower },
        data: {
          agent_verification_status: "pending",
          agent_verification_submitted_at: new Date(),
          agent_license_number: license_number,
          agent_brokerage: broker_company,
          phone: phone || undefined,
        },
      }).catch((err) => {
        console.log("[Admin] Failed to update user record for", emailLower, err?.message);
      });
    } else {
      // User doesn't exist yet (race condition: agent form submitted before saveSubscriber finished)
      // Create a minimal user record so the agent status is tracked
      const referralCode = require("crypto").randomBytes(4).toString("hex");
      await prisma.user.create({
        data: {
          email: emailLower,
          name: name,
          referral_code: referralCode,
          role: "agent",
          tier: "verified",
          phone: phone || null,
          agent_license_number: license_number,
          agent_brokerage: broker_company,
          agent_verification_status: "pending",
          agent_verification_submitted_at: new Date(),
        },
      }).catch((err) => {
        console.log("[Admin] Could not create user record for", emailLower, err?.message);
      });
      console.log("[Admin] Created minimal user record for new agent:", emailLower);
    }

    console.log("[Admin] Agent license submitted:", emailLower, "Agent #", request.agent_number);

    return c.json({ success: true, data: request });
  } catch (error) {
    console.error("[Admin] Agent request submit error:", error);
    return c.json({ success: false, error: "Failed to submit agent request" }, 500);
  }
});

// GET /api/admin/agent-status/:email - Check agent verification status from users table
// This is a backup check in case agentRequest table wasn't updated
adminRouter.get("/agent-status/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        email: true,
        role: true,
        agent_verification_status: true,
      },
    });

    if (!user) {
      return c.json({ success: true, data: null });
    }

    return c.json({
      success: true,
      data: {
        email: user.email,
        role: user.role,
        verificationStatus: user.agent_verification_status,
        isApproved: user.agent_verification_status === "approved",
      },
    });
  } catch (error) {
    console.error("[Admin] Agent status check error:", error);
    return c.json({ success: false, error: "Failed to check agent status" }, 500);
  }
});

// POST /api/admin/update-agent-status - Update agent verification status (no auth needed, called from mobile)
// Called from agent-license-form after saving the agent request
adminRouter.post("/update-agent-status", async (c) => {
  try {
    const body = await c.req.json();
    const { email, name, license_number, broker_company, verification_status } = body;

    if (!email) {
      return c.json({ success: false, error: "Email is required" }, 400);
    }

    const emailLower = email.toLowerCase().trim();

    // Update the user record if it exists
    const updated = await prisma.user.update({
      where: { email: emailLower },
      data: {
        ...(name && { name }),
        ...(license_number && { agent_license_number: license_number }),
        ...(broker_company && { agent_brokerage: broker_company }),
        ...(verification_status && { agent_verification_status: verification_status }),
        ...(verification_status === "pending" && { agent_verification_submitted_at: new Date() }),
      },
    }).catch((err) => {
      console.log("[Admin] update-agent-status: No user record for", emailLower, "- skipping user table update");
      return null;
    });

    console.log("[Admin] Agent status updated for:", emailLower, "->", verification_status);
    return c.json({ success: true, data: updated ? { email: emailLower, verification_status } : null });
  } catch (error) {
    console.error("[Admin] Update agent status error:", error);
    return c.json({ success: false, error: "Failed to update agent status" }, 500);
  }
});

// GET /api/admin/user-profile/:email - Returns full account profile for login restoration
// Called on every login to restore complete account state
adminRouter.get("/user-profile/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tier: true,
        phone: true,
        referral_code: true,
        agent_license_number: true,
        agent_brokerage: true,
        agent_verification_status: true,
        is_email_verified: true,
        is_vip: true,
        created_at: true,
      },
    });

    if (!user) {
      return c.json({ success: true, data: null });
    }

    // Also fetch agent request for agent number
    let agentNumber: number | null = null;
    let agentRequestStatus: string | null = null;
    if (user.role === "agent") {
      const agentReq = await prisma.agentRequest.findUnique({
        where: { email },
        select: { agent_number: true, status: true },
      });
      if (agentReq) {
        agentNumber = agentReq.agent_number ?? null;
        agentRequestStatus = agentReq.status;
      }
    }

    // Check if user has accepted terms of service
    const termsAcceptance = await prisma.termsAcceptance.findFirst({
      where: { email },
      orderBy: { accepted_at: "desc" },
    });
    const hasAcceptedTerms = !!termsAcceptance;

    // Determine the effective agent status
    // The users table is the source of truth; agentRequest is supplemental
    let agentStatus: string | null = null;
    if (user.role === "agent") {
      agentStatus = user.agent_verification_status;
      // If agentRequest says approved but users table still says pending, trust users table
      // If users table says approved, that's what matters
    }

    return c.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,         // "reader" | "agent" | "admin"
        tier: user.tier,         // "verified" | "basic" | "agent" | "elite"
        phone: user.phone,
        referralCode: user.referral_code,
        isEmailVerified: user.is_email_verified,
        hasAcceptedTerms: hasAcceptedTerms, // Whether user has accepted TOS
        isVip: user.is_vip,      // VIP users bypass all limits
        // Agent fields
        licenseNumber: user.agent_license_number,
        brokerCompany: user.agent_brokerage,
        agentVerificationStatus: agentStatus, // not_submitted | pending | approved | rejected
        agentNumber: agentNumber,
        createdAt: user.created_at.toISOString(),
      },
    });
  } catch (error) {
    console.error("[Admin] User profile fetch error:", error);
    return c.json({ success: false, error: "Failed to fetch user profile" }, 500);
  }
});

// GET /api/admin/check-email/:email - Quick check if email already exists
adminRouter.get("/check-email/:email", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();

    const [user, agentRequest] = await Promise.all([
      prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, role: true, tier: true },
      }),
      prisma.agentRequest.findUnique({
        where: { email },
        select: { id: true, email: true, status: true },
      }),
    ]);

    const exists = !!(user || agentRequest);

    return c.json({
      success: true,
      data: {
        exists,
        role: user?.role || null,
        tier: user?.tier || null,
        hasAgentRequest: !!agentRequest,
        agentRequestStatus: agentRequest?.status || null,
      },
    });
  } catch (error) {
    console.error("[Admin] Check email error:", error);
    return c.json({ success: false, error: "Failed to check email" }, 500);
  }
});

// GET /api/admin/agent-requests - List all agent requests (admin only)
adminRouter.get("/agent-requests", async (c) => {
  try {
    const requests = await prisma.agentRequest.findMany({
      orderBy: { submitted_at: "desc" },
    });

    return c.json({ success: true, data: requests });
  } catch (error) {
    console.error("[Admin] Agent requests fetch error:", error);
    return c.json({ success: false, error: "Failed to fetch agent requests" }, 500);
  }
});

// GET /api/admin/agent-requests/pending - List pending agent requests only (for mobile admin panel)
adminRouter.get("/agent-requests/pending", async (c) => {
  try {
    const requests = await prisma.agentRequest.findMany({
      where: { status: "pending" },
      orderBy: { submitted_at: "desc" },
    });

    console.log(`[Admin] Fetched ${requests.length} pending agent requests`);
    return c.json({ success: true, data: requests });
  } catch (error) {
    console.error("[Admin] Pending agent requests fetch error:", error);
    return c.json({ success: false, error: "Failed to fetch pending agent requests" }, 500);
  }
});

// POST /api/admin/agent-requests/approve - Approve agent by email in body (for mobile admin panel)
adminRouter.post("/agent-requests/approve", async (c) => {
  try {
    const body = await c.req.json();
    const { email } = body;

    if (!email) {
      return c.json({ success: false, error: "email is required" }, 400);
    }

    const emailLower = email.toLowerCase().trim();

    // Update the agentRequest table
    const request = await prisma.agentRequest.update({
      where: { email: emailLower },
      data: {
        status: "approved",
        reviewed_at: new Date(),
      },
    });

    // Also update the user table so refreshAgentStatus picks it up
    const updatedUser = await prisma.user.update({
      where: { email: emailLower },
      data: {
        agent_verification_status: "approved",
        agent_verification_reviewed_at: new Date(),
        role: "agent",
        tier: "verified",
      },
    }).catch((err) => {
      console.log("[Admin] No user record found for", emailLower, "- skipping user table update");
      return null;
    });

    console.log("[Admin] Agent approved:", emailLower, "user updated:", !!updatedUser);
    return c.json({ success: true, message: "Agent request approved successfully", data: request });
  } catch (error) {
    console.error("[Admin] Agent request approve error:", error);
    return c.json({ success: false, error: "Failed to approve agent request" }, 500);
  }
});

// POST /api/admin/agent-requests/reject - Reject agent by email in body (for mobile admin panel)
adminRouter.post("/agent-requests/reject", async (c) => {
  try {
    const body = await c.req.json();
    const { email, reason } = body;

    if (!email) {
      return c.json({ success: false, error: "email is required" }, 400);
    }

    const emailLower = email.toLowerCase().trim();

    // Update the agentRequest table
    const request = await prisma.agentRequest.update({
      where: { email: emailLower },
      data: {
        status: "rejected",
        reviewed_at: new Date(),
        rejection_reason: reason || null,
      },
    });

    // Also update the user table so refreshAgentStatus picks it up
    const updatedUser = await prisma.user.update({
      where: { email: emailLower },
      data: {
        agent_verification_status: "rejected",
        agent_verification_reviewed_at: new Date(),
      },
    }).catch((err) => {
      console.log("[Admin] No user record found for", emailLower, "- skipping user table update");
      return null;
    });

    console.log("[Admin] Agent rejected:", emailLower, "reason:", reason || "none", "user updated:", !!updatedUser);
    return c.json({ success: true, message: "Agent request rejected successfully", data: request });
  } catch (error) {
    console.error("[Admin] Agent request reject error:", error);
    return c.json({ success: false, error: "Failed to reject agent request" }, 500);
  }
});

// POST /api/admin/agent-requests/:email/approve - Approve agent by email in URL path (mobile app uses this format)
adminRouter.post("/agent-requests/:email/approve", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();

    if (!email) {
      return c.json({ success: false, error: "email is required" }, 400);
    }

    const request = await prisma.agentRequest.update({
      where: { email },
      data: {
        status: "approved",
        reviewed_at: new Date(),
      },
    });

    const updatedUser = await prisma.user.update({
      where: { email },
      data: {
        agent_verification_status: "approved",
        agent_verification_reviewed_at: new Date(),
        role: "agent",
        tier: "verified",
      },
    }).catch((err) => {
      console.log("[Admin] No user record found for", email, "- skipping user table update");
      return null;
    });

    console.log("[Admin] Agent approved (path):", email, "user updated:", !!updatedUser);
    return c.json({ success: true, message: "Agent request approved successfully", data: request });
  } catch (error) {
    console.error("[Admin] Agent request approve error:", error);
    return c.json({ success: false, error: "Failed to approve agent request" }, 500);
  }
});

// POST /api/admin/agent-requests/:email/reject - Reject agent by email in URL path (mobile app uses this format)
adminRouter.post("/agent-requests/:email/reject", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email")).toLowerCase().trim();
    const body = await c.req.json().catch(() => ({}));
    const reason = (body as { reason?: string }).reason || null;

    if (!email) {
      return c.json({ success: false, error: "email is required" }, 400);
    }

    const request = await prisma.agentRequest.update({
      where: { email },
      data: {
        status: "rejected",
        reviewed_at: new Date(),
        rejection_reason: reason,
      },
    });

    const updatedUser = await prisma.user.update({
      where: { email },
      data: {
        agent_verification_status: "rejected",
        agent_verification_reviewed_at: new Date(),
      },
    }).catch((err) => {
      console.log("[Admin] No user record found for", email, "- skipping user table update");
      return null;
    });

    console.log("[Admin] Agent rejected (path):", email, "reason:", reason || "none", "user updated:", !!updatedUser);
    return c.json({ success: true, message: "Agent request rejected successfully", data: request });
  } catch (error) {
    console.error("[Admin] Agent request reject error:", error);
    return c.json({ success: false, error: "Failed to reject agent request" }, 500);
  }
});

// POST /api/admin/update-user-role - Switch a user's role (e.g., agent ? reader if they signed up by mistake)
adminRouter.post("/update-user-role", async (c) => {
  try {
    const body = await c.req.json();
    const { email, role } = body;

    if (!email || !role) {
      return c.json({ success: false, error: "email and role are required" }, 400);
    }

    const validRoles = ['reader', 'agent'];
    if (!validRoles.includes(role)) {
      return c.json({ success: false, error: "Invalid role" }, 400);
    }

    const emailLower = email.toLowerCase().trim();
    const existingUser = await prisma.user.findUnique({ where: { email: emailLower } });
    if (!existingUser) {
      return c.json({ success: false, error: "User not found" }, 404);
    }

    // Allow downgrade only if user hasn't submitted license info yet (no agent_license_number)
    if (existingUser.role === 'agent' && role === 'reader') {
      if (existingUser.agent_license_number) {
        return c.json({ success: false, error: "Cannot downgrade verified agent to reader" }, 400);
      }
    }

    await prisma.user.update({
      where: { email: emailLower },
      data: {
        role,
        // Clear agent fields if switching to reader
      ...(role === 'reader' ? {
        agent_verification_status: 'not_submitted',
        agent_license_number: null,
        agent_brokerage: null,
      } : {}),
      },
    });

    console.log(`[Admin] User role updated: ${emailLower} ? ${role}`);
    return c.json({ success: true });
  } catch (error) {
    console.error("[Admin] Update user role error:", error);
    return c.json({ success: false, error: "Failed to update user role" }, 500);
  }
});

// POST /api/admin/users/:email/grant-vip - Grant VIP status (unlimited access, no paywall)
adminRouter.post("/users/:email/grant-vip", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const emailLower = email.toLowerCase();
    const body = await c.req.json().catch(() => ({}));
    const adminEmail = body.adminEmail || "system";

    const user = await prisma.user.update({
      where: { email: emailLower },
      data: {
        is_vip: true,
        vip_granted_at: new Date(),
        vip_granted_by: adminEmail,
        // Also set as elite agent with approved status
        tier: "elite",
        role: "agent",
        agent_verification_status: "approved",
        agent_verification_reviewed_at: new Date(),
      },
    });

    console.log(`[Admin] VIP status granted to: ${emailLower} by ${adminEmail}`);
    return c.json({ success: true, data: { email: user.email, is_vip: user.is_vip } });
  } catch (error) {
    console.error("[Admin] Grant VIP error:", error);
    return c.json({ success: false, error: "Failed to grant VIP status" }, 500);
  }
});

// POST /api/admin/users/:email/revoke-vip - Revoke VIP status
adminRouter.post("/users/:email/revoke-vip", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const emailLower = email.toLowerCase();

    const user = await prisma.user.update({
      where: { email: emailLower },
      data: {
        is_vip: false,
      },
    });

    console.log(`[Admin] VIP status revoked from: ${emailLower}`);
    return c.json({ success: true, data: { email: user.email, is_vip: user.is_vip } });
  } catch (error) {
    console.error("[Admin] Revoke VIP error:", error);
    return c.json({ success: false, error: "Failed to revoke VIP status" }, 500);
  }
});

// POST /api/admin/agent-requests/:email/approve - Approve an agent request
adminRouter.post("/agent-requests/:email/approve", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const emailLower = email.toLowerCase();

    // Update the agentRequest table
    const request = await prisma.agentRequest.update({
      where: { email: emailLower },
      data: {
        status: "approved",
        reviewed_at: new Date(),
      },
    });

    // ALSO update the user table so refreshAgentStatus picks it up
    const updatedUser = await prisma.user.update({
      where: { email: emailLower },
      data: {
        agent_verification_status: "approved",
        agent_verification_reviewed_at: new Date(),
        role: "agent",
        tier: "verified",
      },
    }).catch((err) => {
      console.log("[Admin] No user record found for", emailLower, "- skipping user table update");
      return null;
    });

    console.log("[Admin] Agent approved via agent-requests endpoint:", emailLower, "user updated:", !!updatedUser);

    return c.json({ success: true, data: request });
  } catch (error) {
    console.error("[Admin] Agent request approve error:", error);
    return c.json({ success: false, error: "Failed to approve agent request" }, 500);
  }
});

// POST /api/admin/agent-requests/:email/reject - Reject an agent request
adminRouter.post("/agent-requests/:email/reject", async (c) => {
  try {
    const email = decodeURIComponent(c.req.param("email"));
    const emailLower = email.toLowerCase();
    const body = await c.req.json().catch(() => ({}));
    const reason = body.reason || undefined;

    // Update the agentRequest table
    const request = await prisma.agentRequest.update({
      where: { email: emailLower },
      data: {
        status: "rejected",
        reviewed_at: new Date(),
        rejection_reason: reason || null,
      },
    });

    // ALSO update the user table so refreshAgentStatus picks it up
    const updatedUser = await prisma.user.update({
      where: { email: emailLower },
      data: {
        agent_verification_status: "rejected",
        agent_verification_reviewed_at: new Date(),
      },
    }).catch((err) => {
      console.log("[Admin] No user record found for", emailLower, "- skipping user table update");
      return null;
    });

    console.log("[Admin] Agent rejected via agent-requests endpoint:", emailLower, "user updated:", !!updatedUser);

    return c.json({ success: true, data: request });
  } catch (error) {
    console.error("[Admin] Agent request reject error:", error);
    return c.json({ success: false, error: "Failed to reject agent request" }, 500);
  }
});

// ============================================================================
// SUBSCRIBER SIGN-UPS
// ============================================================================

// POST /api/admin/subscribers/submit � no auth (called during sign-up)
// Creates/updates a User record AND a CrmLead record
adminRouter.post("/subscribers/submit", async (c) => {
  try {
    const body = await c.req.json();
    const { email, name, user_type, phone, source, license_number, broker_company, sign_in_method } = body;

    if (!email || !name) {
      return c.json({ success: false, error: "email and name are required" }, 400);
    }

    const emailLower = email.toLowerCase().trim();
    const role = user_type === "agent" ? "agent" : "reader";

    // Generate a unique 8-char referral code with retry on collision
    const generateReferralCode = async (): Promise<string> => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = crypto.randomBytes(4).toString("hex");
        const existing = await prisma.user.findUnique({ where: { referral_code: code } });
        if (!existing) return code;
      }
      // Fallback: use more bytes to reduce collision chance
      return crypto.randomBytes(8).toString("hex").slice(0, 8);
    };

    // Build agent-specific fields
    const agentFields = role === "agent"
      ? {
          agent_license_number: license_number || null,
          agent_brokerage: broker_company || null,
          agent_verification_status: "pending",
          agent_verification_submitted_at: new Date(),
        }
      : {};

    // Upsert User by email
    let user: { id: string; email: string; role: string; referral_code: string };
    const existingUser = await prisma.user.findUnique({ where: { email: emailLower } });

    if (existingUser) {
      // CRITICAL: Never downgrade a VERIFIED agent (has license number) to reader via OAuth re-login.
      // However, allow downgrade if the agent never completed verification (no license number).
      // This handles users who accidentally chose "Agent" during signup and are re-signing in as "Reader".
      const isVerifiedAgent = existingUser.role === 'agent' && !!existingUser.agent_license_number;
      const shouldPreserveAgentRole = isVerifiedAgent && role === 'reader';
      const finalRole = shouldPreserveAgentRole ? 'agent' : role;

      // Only apply agent fields if upgrading TO agent, not if preserving existing agent
      const fieldsToApply = shouldPreserveAgentRole ? {} : agentFields;

      const updated = await prisma.user.update({
        where: { email: emailLower },
        data: {
          name: name || existingUser.name,
          phone: phone || existingUser.phone,
          role: finalRole,
          is_email_verified: true,
          last_login_at: new Date(),
          // If downgrading unverified agent to reader, clear agent fields
          ...(!shouldPreserveAgentRole && role === 'reader' && existingUser.role === 'agent' ? {
            agent_verification_status: 'not_submitted',
            agent_license_number: null,
            agent_brokerage: null,
          } : {}),
          ...fieldsToApply,
        },
      });

      if (shouldPreserveAgentRole) {
        console.log(`[Admin] Preserved verified agent role for ${emailLower} during OAuth re-login (incoming role was 'reader')`);
      } else if (existingUser.role === 'agent' && role === 'reader') {
        console.log(`[Admin] Allowed downgrade of unverified agent to reader for ${emailLower}`);
      }

      user = { id: updated.id, email: updated.email, role: updated.role, referral_code: updated.referral_code };
    } else {
      const referralCode = await generateReferralCode();
      const created = await prisma.user.create({
        data: {
          email: emailLower,
          name: name || emailLower.split("@")[0] || emailLower,
          phone: phone || null,
          referral_code: referralCode,
          role,
          is_email_verified: true,
          last_login_at: new Date(),
          ...agentFields,
        },
      });
      user = { id: created.id, email: created.email, role: created.role, referral_code: created.referral_code };
    }

    // Also create/update CrmLead (preserving existing behavior)
    // Use the final role after agent preservation logic
    const finalLeadType = user.role === "agent" ? "agent" : "reader";
    const leadSource = source || "organic";
    const existingLead = await prisma.crmLead.findFirst({ where: { email: emailLower } });
    if (existingLead) {
      // Don't downgrade agent lead_type to reader
      const preserveLeadType = existingLead.lead_type === "agent" && finalLeadType === "reader";
      await prisma.crmLead.update({
        where: { id: existingLead.id },
        data: {
          ...(name && { name }),
          ...(phone && { phone }),
          ...(broker_company && { brokerage: broker_company }),
          lead_type: preserveLeadType ? "agent" : finalLeadType,
          source: leadSource,
          updated_at: new Date(),
        },
      });
    } else {
      await prisma.crmLead.create({
        data: {
          email: emailLower,
          name: name || emailLower.split("@")[0] || emailLower,
          phone: phone || null,
          lead_type: finalLeadType,
          brokerage: broker_company || null,
          source: leadSource,
          status: "not_contacted",
          market: "hamptons",
        },
      });
    }

    return c.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        referral_code: user.referral_code,
      },
    });
  } catch (error) {
    console.error("[Admin] Subscriber submit error:", error);
    return c.json({ success: false, error: "Failed to save subscriber" }, 500);
  }
});

// ============================================================================
// USER MANAGEMENT
// ============================================================================

/**
 * GET /users
 * Fetches all users from the User table, ordered by created_at DESC.
 * Returns users array and aggregate counts.
 */
adminRouter.get("/users", async (c) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { created_at: "desc" },
      include: {
        subscriptions: {
          where: { status: { in: ["active", "trialing"] } },
          orderBy: { created_at: "desc" },
          take: 1,
        },
      },
    });

    const total = users.length;
    const readers = users.filter((u) => u.role === "reader").length;
    const agents = users.filter((u) => u.role === "agent").length;
    const pendingAgents = users.filter(
      (u) => u.role === "agent" && u.agent_verification_status === "pending"
    ).length;
    const paidSubscribers = users.filter((u) => u.subscriptions.length > 0).length;

    // Flatten subscriptions into user objects for the response
    const usersWithSub = users.map((u) => {
      const activeSub = u.subscriptions[0] || null;
      const { subscriptions, ...userData } = u;
      return {
        ...userData,
        active_subscription: activeSub
          ? {
              id: activeSub.id,
              plan_type: activeSub.plan_type,
              status: activeSub.status,
              mrr_amount: activeSub.mrr_amount,
              current_period_start: activeSub.current_period_start,
              created_at: activeSub.created_at,
            }
          : null,
      };
    });

    return c.json({
      success: true,
      data: usersWithSub,
      counts: {
        total,
        readers,
        agents,
        pendingAgents,
        paidSubscribers,
      },
    });
  } catch (error) {
    console.error("[Admin] Users list error:", error);
    return c.json({ success: false, error: "Failed to fetch users" }, 500);
  }
});

/**
 * POST /users/:id/confirm
 * Confirms a user: sets is_email_verified to true.
 * If the user is an agent, also approves their agent verification.
 */
adminRouter.post("/users/:id/confirm", async (c) => {
  try {
    const id = c.req.param("id");

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return c.json({ success: false, error: "User not found" }, 404);
    }

    const updateData: Record<string, unknown> = {
      is_email_verified: true,
    };

    if (user.role === "agent") {
      updateData.agent_verification_status = "approved";
      updateData.agent_verification_reviewed_at = new Date();
    }

    await prisma.user.update({
      where: { id },
      data: updateData,
    });

    // Also update agentRequest table so the mobile app picks up the approval
    if (user.role === "agent" && user.email) {
      await prisma.agentRequest.update({
        where: { email: user.email.toLowerCase() },
        data: {
          status: "approved",
          reviewed_at: new Date(),
        },
      }).catch(() => {
        console.log("[Admin] No agentRequest record found for", user.email);
      });
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("[Admin] User confirm error:", error);
    return c.json({ success: false, error: "Failed to confirm user" }, 500);
  }
});

/**
 * POST /users/:id/reject
 * Rejects a user's agent verification.
 * Body: { reason?: string }
 */
adminRouter.post("/users/:id/reject", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return c.json({ success: false, error: "User not found" }, 404);
    }

    if (user.role === "agent") {
      await prisma.user.update({
        where: { id },
        data: {
          agent_verification_status: "rejected",
          agent_verification_reviewed_at: new Date(),
        },
      });
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("[Admin] User reject error:", error);
    return c.json({ success: false, error: "Failed to reject user" }, 500);
  }
});

// ============================================================
// AGENT LISTING SUBMISSIONS
// ============================================================

// POST /api/admin/agent-listings/submit - Submit a listing (requires agent auth & credits, auto-approved)
adminRouter.post("/agent-listings/submit", async (c) => {
  const clientIP = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') || 'unknown';

  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      agent_email, agent_name, agent_company, agent_phone,
      market_id, address, village, price, listing_type, property_type,
      beds, baths, sqft, acres, year_built, description,
      image_url, image_urls, video_tour_url, open_house, rental_pricing,
      condo_details, attachments, latitude, longitude,
    } = body;

    // Validate required fields
    if (!agent_email || !address || !village || !price || !beds || !baths || !sqft) {
      return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    // ========================================================================
    // STEP 1: Verify agent exists and is authorized
    // ========================================================================
    const agentVerification = await verifyAgentByEmail(agent_email);
    if (!agentVerification.valid || !agentVerification.user) {
      console.warn(`[Agent Listing] Unauthorized submission attempt from: ${agent_email} - ${agentVerification.error}`);
      return c.json({
        success: false,
        error: agentVerification.error || "Unauthorized: Agent verification failed"
      }, 403);
    }

    const userId = agentVerification.user.id;
    console.log(`[Agent Listing] Verified agent: ${agent_email} (tier: ${agentVerification.user.tier})`);

    // ========================================================================
    // STEP 2: Check for duplicate submission
    // ========================================================================
    const duplicateCheck = await isDuplicateListing(agent_email, address, village);
    if (duplicateCheck.isDuplicate) {
      console.warn(`[Agent Listing] Duplicate submission blocked: ${address}, ${village}`);
      return c.json({
        success: false,
        error: "This listing has already been submitted. Please update the existing listing instead.",
        existingId: duplicateCheck.existingId,
      }, 409);
    }

    // ========================================================================
    // STEP 3 & 4 & 5: ATOMIC TRANSACTION - Check credits, create listing, deduct credit
    // Listings are AUTO-APPROVED but still require credits
    // ========================================================================
    const result = await prisma.$transaction(async (tx) => {
      // Get user with current credit state (acts as row lock in transaction)
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          tier: true,
          role: true,
          listing_credits_used: true,
          purchased_listing_credits: true,
        },
      });

      if (!user) {
        throw new Error("User not found during transaction");
      }

      // Calculate credit availability within transaction
      const tierAllocation = AGENT_TIERS[user.tier as keyof typeof AGENT_TIERS]?.featuredListings || 0;
      const totalAllocation = tierAllocation + user.purchased_listing_credits;
      const creditsAvailable = Math.max(0, totalAllocation - user.listing_credits_used);

      // Admin bypass
      if (user.role !== 'admin') {
        // Check tier allows listings
        if (user.tier !== 'agent' && user.tier !== 'elite') {
          throw new Error("Upgrade to Pro or Elite to submit listings");
        }

        // Check credit availability
        if (creditsAvailable <= 0) {
          throw new Error(`No listing credits available. You've used all ${totalAllocation} credits.`);
        }
      }

      // Create the listing submission - AUTO-APPROVED
      const submission = await tx.agentListingSubmission.create({
        data: {
          agent_email: agent_email.toLowerCase(),
          agent_name: agent_name || null,
          agent_company: agent_company || null,
          agent_phone: agent_phone || null,
          market_id: market_id || "hamptons",
          address: address.toLowerCase(),
          village: village.toLowerCase(),
          price: parseFloat(price),
          listing_type: listing_type || "sale",
          property_type: property_type || "house",
          beds: parseInt(beds),
          baths: parseFloat(baths),
          sqft: parseInt(sqft),
          acres: acres ? parseFloat(acres) : null,
          year_built: year_built ? parseInt(year_built) : null,
          description: description || null,
          image_url: image_url || null,
          image_urls: image_urls ? JSON.stringify(image_urls) : null,
          video_tour_url: video_tour_url || null,
          open_house: open_house ? JSON.stringify(open_house) : null,
          rental_pricing: rental_pricing ? JSON.stringify(rental_pricing) : null,
          condo_details: condo_details ? JSON.stringify(condo_details) : null,
          attachments: attachments ? JSON.stringify(attachments) : null,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          status: "approved", // AUTO-APPROVED - no manual review needed
          reviewed_at: new Date(), // Mark as reviewed immediately
        },
      });

      // Deduct credit atomically (skip for admin)
      if (user.role !== 'admin') {
        const tierCreditsRemaining = Math.max(0, tierAllocation - user.listing_credits_used);

        if (tierCreditsRemaining > 0) {
          // Use tier allocation
          await tx.user.update({
            where: { id: userId },
            data: { listing_credits_used: { increment: 1 } },
          });
        } else if (user.purchased_listing_credits > 0) {
          // Use purchased credit
          await tx.user.update({
            where: { id: userId },
            data: { purchased_listing_credits: { decrement: 1 } },
          });
        }
      }

      return {
        submission,
        creditsRemaining: user.role === 'admin' ? 999 : creditsAvailable - 1,
      };
    });

    // Log successful submission
    console.log(`[Agent Listing] Submission created and auto-approved: ${result.submission.id}, credits remaining: ${result.creditsRemaining}`);
    console.log(`[AUDIT][INFO] user=${userId} action=listing_submit_auto_approved resource=listing resourceId=${result.submission.id} ip=${clientIP}`);

    return c.json({
      success: true,
      data: {
        id: result.submission.id,
        status: "approved",
        creditsRemaining: result.creditsRemaining,
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to submit listing";
    console.error("[Admin] Agent listing submit error:", errorMessage);

    // Return appropriate error code based on error type
    if (errorMessage.includes("No listing credits") || errorMessage.includes("Upgrade to")) {
      return c.json({
        success: false,
        error: errorMessage,
      }, 402); // Payment Required
    }

    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// GET /api/admin/agent-listings - List all agent listing submissions
adminRouter.get("/agent-listings", async (c) => {
  try {
    const status = c.req.query("status"); // pending, approved, rejected, or all
    const submissions = await prisma.agentListingSubmission.findMany({
      where: status && status !== "all" ? { status } : undefined,
      orderBy: { submitted_at: "desc" },
    });
    return c.json({ success: true, data: submissions });
  } catch (error) {
    console.error("[Admin] Agent listings fetch error:", error);
    return c.json({ success: false, error: "Failed to fetch agent listings" }, 500);
  }
});

// POST /api/admin/agent-listings/:id/approve
adminRouter.post("/agent-listings/:id/approve", async (c) => {
  try {
    const id = c.req.param("id");
    const submission = await prisma.agentListingSubmission.update({
      where: { id },
      data: { status: "approved", reviewed_at: new Date() },
    });
    return c.json({ success: true, data: submission });
  } catch (error) {
    console.error("[Admin] Agent listing approve error:", error);
    return c.json({ success: false, error: "Failed to approve listing" }, 500);
  }
});

// POST /api/admin/agent-listings/:id/reject
adminRouter.post("/agent-listings/:id/reject", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const submission = await prisma.agentListingSubmission.update({
      where: { id },
      data: { status: "rejected", reviewed_at: new Date(), rejection_reason: body.reason || null },
    });
    return c.json({ success: true, data: submission });
  } catch (error) {
    console.error("[Admin] Agent listing reject error:", error);
    return c.json({ success: false, error: "Failed to reject listing" }, 500);
  }
});

// PATCH /api/admin/agent-listings/:id/listing-status - Agent updates listing status (active, in_contract, sold)
adminRouter.patch("/agent-listings/:id/listing-status", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const { listing_status, agent_email } = body;

    if (!listing_status || !["active", "in_contract", "sold"].includes(listing_status)) {
      return c.json({ success: false, error: "Invalid listing_status. Must be: active, in_contract, or sold" }, 400);
    }

    // Verify the listing belongs to the requesting agent
    const existing = await prisma.agentListingSubmission.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ success: false, error: "Listing not found" }, 404);
    }
    if (agent_email && existing.agent_email !== agent_email) {
      return c.json({ success: false, error: "Unauthorized: listing belongs to a different agent" }, 403);
    }

    const updated = await prisma.agentListingSubmission.update({
      where: { id },
      data: { listing_status },
    });

    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("[Admin] Agent listing status update error:", error);
    return c.json({ success: false, error: "Failed to update listing status" }, 500);
  }
});

// ============================================================
// AGENT ARTICLE REQUESTS
// ============================================================

// POST /api/admin/agent-articles/submit - Submit an article request (requires agent auth & credits)
adminRouter.post("/agent-articles/submit", async (c) => {
  const clientIP = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') || 'unknown';

  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      agent_email, agent_name, agent_company,
      headline, focus_area, achievements, additional_notes,
      article_type, photo_urls,
    } = body;

    // Validate required fields
    if (!agent_email || !headline) {
      return c.json({ success: false, error: "Missing required fields (agent_email, headline)" }, 400);
    }

    // ========================================================================
    // STEP 1: Verify agent exists and is authorized
    // ========================================================================
    const agentVerification = await verifyAgentByEmail(agent_email);
    if (!agentVerification.valid || !agentVerification.user) {
      console.warn(`[Agent Article] Unauthorized submission attempt from: ${agent_email} - ${agentVerification.error}`);
      return c.json({
        success: false,
        error: agentVerification.error || "Unauthorized: Agent verification failed"
      }, 403);
    }

    const userId = agentVerification.user.id;
    console.log(`[Agent Article] Verified agent: ${agent_email} (tier: ${agentVerification.user.tier})`);

    // ========================================================================
    // STEP 2: Check for duplicate submission
    // ========================================================================
    const duplicateCheck = await isDuplicateArticle(agent_email, headline);
    if (duplicateCheck.isDuplicate) {
      console.warn(`[Agent Article] Duplicate submission blocked: "${headline}"`);
      return c.json({
        success: false,
        error: "An article request with this headline already exists. Please check your pending articles.",
        existingId: duplicateCheck.existingId,
      }, 409);
    }

    // ========================================================================
    // STEP 3, 4, 5: ATOMIC TRANSACTION - Check credits, create article, deduct credit
    // This prevents race conditions where multiple requests could bypass credit limits
    // ========================================================================
    const result = await prisma.$transaction(async (tx) => {
      // Get user with current credit state (acts as row lock in transaction)
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          tier: true,
          role: true,
          article_credits_used: true,
          purchased_article_credits: true,
        },
      });

      if (!user) {
        throw new Error("User not found during transaction");
      }

      // Calculate credit availability within transaction
      // Only Elite tier gets welcome article credit (1)
      const tierAllocation = user.tier === 'elite' ? 1 : 0;
      const totalAllocation = tierAllocation + user.purchased_article_credits;
      const creditsAvailable = Math.max(0, totalAllocation - user.article_credits_used);

      // Admin bypass
      if (user.role !== 'admin') {
        // Check credit availability
        if (creditsAvailable <= 0) {
          throw new Error("No article credits available. Purchase additional credits to submit articles.");
        }
      }

      // Determine if using free (welcome) credit
      const isUsingFreeCredit = user.article_credits_used < tierAllocation;

      // Create the article request
      const articleRequest = await tx.agentArticleRequest.create({
        data: {
          agent_email: agent_email.toLowerCase(),
          agent_name: agent_name || null,
          agent_company: agent_company || null,
          headline,
          focus_area: focus_area || null,
          achievements: achievements || null,
          additional_notes: additional_notes || null,
          article_type: article_type || "custom",
          photo_urls: Array.isArray(photo_urls) && photo_urls.length > 0 ? JSON.stringify(photo_urls) : null,
          used_free_credit: isUsingFreeCredit,
          status: "pending",
        },
      });

      // Deduct credit atomically (skip for admin)
      if (user.role !== 'admin') {
        const tierCreditsRemaining = Math.max(0, tierAllocation - user.article_credits_used);

        if (tierCreditsRemaining > 0) {
          // Use tier allocation (welcome credit)
          await tx.user.update({
            where: { id: userId },
            data: { article_credits_used: { increment: 1 } },
          });
        } else if (user.purchased_article_credits > 0) {
          // Use purchased credit
          await tx.user.update({
            where: { id: userId },
            data: { purchased_article_credits: { decrement: 1 } },
          });
        }
      }

      return {
        articleRequest,
        creditsRemaining: user.role === 'admin' ? 999 : creditsAvailable - 1,
        usedFreeCredit: isUsingFreeCredit,
      };
    });

    // Log successful submission
    console.log(`[Agent Article] Submission created: ${result.articleRequest.id}, credits remaining: ${result.creditsRemaining}`);
    console.log(`[AUDIT][INFO] user=${userId} action=article_submit resource=article resourceId=${result.articleRequest.id} ip=${clientIP}`);

    return c.json({
      success: true,
      data: {
        id: result.articleRequest.id,
        creditsRemaining: result.creditsRemaining,
        usedFreeCredit: result.usedFreeCredit,
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to submit article request";
    console.error("[Admin] Agent article submit error:", errorMessage);

    // Return appropriate error code based on error type
    if (errorMessage.includes("No article credits")) {
      return c.json({
        success: false,
        error: errorMessage,
      }, 402); // Payment Required
    }

    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// GET /api/admin/agent-articles - List all agent article requests
adminRouter.get("/agent-articles", async (c) => {
  try {
    const status = c.req.query("status");
    const requests = await prisma.agentArticleRequest.findMany({
      where: status && status !== "all" ? { status } : undefined,
      orderBy: { submitted_at: "desc" },
    });
    return c.json({ success: true, data: requests });
  } catch (error) {
    console.error("[Admin] Agent articles fetch error:", error);
    return c.json({ success: false, error: "Failed to fetch article requests" }, 500);
  }
});

// POST /api/admin/agent-articles/:id/approve
adminRouter.post("/agent-articles/:id/approve", async (c) => {
  try {
    const id = c.req.param("id");
    const request = await prisma.agentArticleRequest.update({
      where: { id },
      data: { status: "in_progress", reviewed_at: new Date() },
    });
    return c.json({ success: true, data: request });
  } catch (error) {
    console.error("[Admin] Agent article approve error:", error);
    return c.json({ success: false, error: "Failed to approve article request" }, 500);
  }
});

// POST /api/admin/agent-articles/:id/reject
adminRouter.post("/agent-articles/:id/reject", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const request = await prisma.agentArticleRequest.update({
      where: { id },
      data: { status: "rejected", reviewed_at: new Date(), rejection_reason: body.reason || null },
    });
    return c.json({ success: true, data: request });
  } catch (error) {
    console.error("[Admin] Agent article reject error:", error);
    return c.json({ success: false, error: "Failed to reject article request" }, 500);
  }
});

// ============================================================================
// GEOCODING - Fix listing coordinates server-side using Google Maps API
// ============================================================================

const GOOGLE_GEOCODE_API_KEY = process.env.GOOGLE_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://tfzkenrmzoxrkdntkada.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";

// Known village/neighborhood center coords that indicate imprecise fallback coords
const VILLAGE_CENTER_COORDS: Array<[number, number]> = [
  [40.9632, -72.1848], [40.8843, -72.3896], [40.9979, -72.2929],
  [40.9379, -72.3001], [40.9190, -72.3449], [40.9748, -72.1349],
  [41.0362, -71.9545], [40.9376, -72.2234], [26.7056, -80.0364],
  [26.7153, -80.0534], [25.7617, -80.1918], [39.1911, -106.8175],
  [39.2130, -106.9378], [39.3689, -107.0339], [39.4022, -107.2111],
  [25.8912, -80.1257], [25.9506, -80.1223], [26.8234, -80.1386],
];

function isVillageCenter(lat: number, lng: number): boolean {
  return VILLAGE_CENTER_COORDS.some(
    ([vlat, vlng]) => Math.abs(lat - vlat) < 0.0005 && Math.abs(lng - vlng) < 0.0005
  );
}

const MARKET_REGION_HINTS: Record<string, string> = {
  hamptons: "Hamptons, NY",
  "palm-beach": "Palm Beach County, FL",
  miami: "Miami, FL",
  aspen: "Aspen, CO",
};

async function geocodeWithGoogle(
  address: string,
  village: string,
  marketId?: string | null
): Promise<{ latitude: number; longitude: number } | null> {
  if (!GOOGLE_GEOCODE_API_KEY) {
    console.log("[Geocode] No Google API key available");
    return null;
  }

  const region = MARKET_REGION_HINTS[marketId || ""] || "NY";
  const queries = [
    `${address}, ${village}, ${region}`,
    `${address}, ${region}`,
    address,
  ];

  for (const query of queries) {
    try {
      const encoded = query.split("").map(c => {
        const code = c.charCodeAt(0);
        if (/[A-Za-z0-9\-_.!~*'()]/.test(c)) return c;
        return "%" + code.toString(16).toUpperCase().padStart(2, "0");
      }).join("");
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${GOOGLE_GEOCODE_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json() as any;
      if (data.status === "OK" && data.results?.length > 0) {
        const loc = data.results[0].geometry.location;
        const locType = data.results[0].geometry.location_type;
        console.log(`[Geocode] OK "${query}" ? ${loc.lat}, ${loc.lng} (${locType})`);
        return { latitude: loc.lat, longitude: loc.lng };
      }
      if (data.status !== "ZERO_RESULTS") {
        console.log(`[Geocode] status=${data.status} for "${query}"`);
      }
    } catch (err) {
      console.error(`[Geocode] Error for "${query}":`, err);
    }
  }
  return null;
}

// GET /api/admin/geocode-listings/status
adminRouter.get("/geocode-listings/status", async (c) => {
  try {
    const total = await prisma.listing.count();
    const withCoords = await prisma.listing.count({
      where: { latitude: { not: null }, longitude: { not: null } },
    });
    const listings = await prisma.listing.findMany({
      select: { id: true, address: true, village: true, market_id: true, latitude: true, longitude: true },
    });
    const villageCenter = listings.filter(
      (l) => l.latitude && l.longitude && isVillageCenter(l.latitude, l.longitude)
    ).length;
    const needsGeocode = listings.filter(
      (l) => !l.latitude || !l.longitude || (l.latitude && l.longitude && isVillageCenter(l.latitude, l.longitude))
    ).length;
    return c.json({ success: true, total, withCoords, withoutCoords: total - withCoords, villageCenter, needsGeocode });
  } catch (error) {
    return c.json({ success: false, error: "Failed to check geocode status" }, 500);
  }
});

// POST /api/admin/geocode-listings � geocode all listings missing or approximate coordinates
adminRouter.post("/geocode-listings", async (c) => {
  try {
    const allListings = await prisma.listing.findMany({
      select: { id: true, address: true, village: true, market_id: true, latitude: true, longitude: true },
    });

    const needsGeocode = allListings.filter((l) => {
      if (!l.latitude || !l.longitude) return true;
      return isVillageCenter(l.latitude, l.longitude);
    });

    console.log(`[Geocode] ${needsGeocode.length}/${allListings.length} listings need geocoding`);

    let updated = 0;
    let failed = 0;
    const results: Array<{ id: string; address: string; success: boolean; lat?: number; lng?: number }> = [];

    for (const listing of needsGeocode) {
      const coords = await geocodeWithGoogle(
        listing.address,
        listing.village || "",
        listing.market_id
      );

      if (coords) {
        // Update backend SQLite DB
        await prisma.listing.update({
          where: { id: listing.id },
          data: { latitude: coords.latitude, longitude: coords.longitude },
        });

        // Also push to Supabase so mobile clients pick it up
        if (SUPABASE_KEY) {
          fetch(`${SUPABASE_URL}/rest/v1/featured_listings?id=eq.${listing.id}`, {
            method: "PATCH",
            headers: {
              "apikey": SUPABASE_KEY,
              "Authorization": `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }),
          }).catch((err) => console.error("[Geocode] Supabase update failed:", err));
        }

        updated++;
        results.push({ id: listing.id, address: listing.address, success: true, lat: coords.latitude, lng: coords.longitude });
      } else {
        failed++;
        results.push({ id: listing.id, address: listing.address, success: false });
      }

      // Respect Google's rate limit (50 req/sec free tier, using 9/sec to be safe)
      await new Promise((r) => setTimeout(r, 120));
    }

    return c.json({
      success: true,
      total: allListings.length,
      needed: needsGeocode.length,
      updated,
      failed,
      results,
    });
  } catch (error) {
    console.error("[Admin] Geocode listings error:", error);
    return c.json({ success: false, error: "Failed to geocode listings" }, 500);
  }
});