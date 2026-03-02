// Vibecode proxy import removed for Railway deployment
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
// Website revalidation URL updated to hamptonscoastal.com
import { sampleRouter } from "./routes/sample";
import { aiRouter } from "./routes/ai";
import { emailRouter } from "./routes/email";
import { ttsRouter } from "./routes/tts";
import { autoArticlesRouter } from "./routes/auto-articles";
import { subscriptionRouter } from "./routes/subscription";
import { referralRouter } from "./routes/referral";
import { webhooksRouter } from "./routes/webhooks";
import { cronRouter } from "./routes/cron";
import { publicRouter } from "./routes/public";
import { revalidateRouter } from "./routes/revalidate";
import { mlsImportRouter } from "./routes/mls-import";
import { analyticsRouter } from "./routes/analytics";
import { adminRouter } from "./routes/admin";
import { marketDataRouter } from "./routes/market-data";
import { parcelsRouter } from "./routes/parcels";
import { legalRouter } from "./routes/legal";
import { inquiriesRouter } from "./routes/inquiries";
import { waitlistRouter } from "./routes/waitlist";
import { webPagesRouter } from "./routes/web-pages";
import { vestingRouter } from "./routes/vesting";
import { supportRouter } from "./routes/support";
import { rateLimit } from "./middleware/rate-limit";
import { logger } from "hono/logger";

const app = new Hono();

// CORS middleware - validates origin against allowlist
const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/(www\.)?hamptonscoastal\.com$/,
];

app.use(
  "*",
  cors({
    // Native mobile apps (iOS/Android) send requests with no Origin header.
    // Allow those through; only block mismatched browser origins.
    origin: (origin) => {
      if (!origin) return "*"; // Native app - no origin header
      return allowed.some((re) => re.test(origin)) ? origin : null;
    },
    credentials: true,
  })
);

// Logging
app.use("*", logger());

// Global error handler
app.onError((err, c) => {
  console.error("[Server Error]", err.message);
  return c.json(
    { error: "Internal server error" },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Rate limiting on AI routes (30 requests per minute per IP)
app.use("/api/ai/*", rateLimit({ windowMs: 60 * 1000, maxRequests: 30 }));

// Rate limiting on email routes (10 per minute per IP - tighter to prevent spam)
app.use("/api/email/*", rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }));

// Rate limiting on TTS routes (10 per minute - these are expensive)
app.use("/api/tts/*", rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }));

// Rate limiting on auto-articles (5 per hour - expensive batch operations)
app.use("/api/auto-articles/*", rateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 5 }));

// Rate limiting on referral routes (20 per minute - moderate limit)
app.use("/api/referral/*", rateLimit({ windowMs: 60 * 1000, maxRequests: 20 }));

// Rate limiting on MLS import (10 per minute)
app.use("/api/mls-import/*", rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }));

// Rate limiting on analytics routes (120 per minute - heartbeats are frequent)
app.use("/api/analytics/*", rateLimit({ windowMs: 60 * 1000, maxRequests: 120 }));

// Rate limiting on admin routes (60 per minute - admin operations)
app.use("/api/admin/*", rateLimit({ windowMs: 60 * 1000, maxRequests: 60 }));

// TIGHTER rate limiting on submission endpoints (5 per hour per IP - prevent abuse)
app.use("/api/admin/agent-listings/submit", rateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 5 }));
app.use("/api/admin/agent-articles/submit", rateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 3 }));

// Rate limiting on support ticket submission (5 per hour per IP - prevent spam)
app.use("/api/support/tickets", rateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 5 }));

// Admin auth middleware - verify X-Admin-Secret header
app.use("/api/admin/*", async (c, next) => {
  // Allow agent request submission without admin auth (called during user sign-up)
  if (c.req.path === "/api/admin/agent-requests/submit" && c.req.method === "POST") {
    await next();
    return;
  }
  // Allow subscriber submission without admin auth (called during user sign-up)
  if (c.req.path === "/api/admin/subscribers/submit" && c.req.method === "POST") {
    await next();
    return;
  }
  // Allow listing submission without admin auth (has its own agent verification)
  if (c.req.path === "/api/admin/agent-listings/submit" && c.req.method === "POST") {
    await next();
    return;
  }
  // Allow article submission without admin auth (has its own agent verification)
  if (c.req.path === "/api/admin/agent-articles/submit" && c.req.method === "POST") {
    await next();
    return;
  }
  // Allow admin access verification (uses its own password validation)
  if (c.req.path === "/api/admin/verify-access" && c.req.method === "POST") {
    await next();
    return;
  }

  const secret = c.req.header("X-Admin-Secret");
  const expectedSecret = process.env.ADMIN_SECRET;

  if (expectedSecret && secret !== expectedSecret) {
    console.warn("[Admin] Unauthorized admin API attempt");
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  await next();
});

// Admin auth middleware for support admin routes
app.use("/api/support/admin/*", async (c, next) => {
  const secret = c.req.header("X-Admin-Secret");
  const expectedSecret = process.env.ADMIN_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    console.warn("[Support Admin] Unauthorized attempt");
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  await next();
});

// Health check endpoint
app.get("/health", async (c) => {
  const hasGrok = !!process.env.GROK_API_KEY;
  const hasPerplexity = !!process.env.PERPLEXITY_API_KEY;
  const hasSendGrid = !!process.env.SENDGRID_API_KEY;
  const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;

  // Test DB connection
  let dbStatus = "unknown";
  let dbError = null;
  try {
    const { default: prisma } = await import("./lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "connected";
  } catch (e: any) {
    dbStatus = "error";
    dbError = e?.message?.slice(0, 200);
  }

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    db: dbStatus,
    dbError,
    services: {
      grok: hasGrok ? "configured" : "missing",
      perplexity: hasPerplexity ? "configured" : "missing",
      sendgrid: hasSendGrid ? "configured" : "missing",
      elevenlabs: hasElevenLabs ? "configured" : "missing",
      adminAccessCode: !!process.env.ADMIN_ACCESS_CODE ? "configured" : "missing",
      employeeAccessCode: !!process.env.EMPLOYEE_ACCESS_CODE ? "configured" : "missing",
    },
  });
});

// Routes
app.route("/api/sample", sampleRouter);
app.route("/api/ai", aiRouter);
app.route("/api/email", emailRouter);
app.route("/api/tts", ttsRouter);
app.route("/api/auto-articles", autoArticlesRouter);
app.route("/api/subscription", subscriptionRouter);
app.route("/api/referral", referralRouter);
app.route("/api/webhooks", webhooksRouter);
app.route("/api/cron", cronRouter);
app.route("/api/public", publicRouter);
app.route("/api/revalidate", revalidateRouter);
app.route("/api/mls-import", mlsImportRouter);
app.route("/api/analytics", analyticsRouter);
app.route("/api/admin", adminRouter);
app.route("/api/market-data", marketDataRouter);
app.route("/api/parcels", parcelsRouter);
app.route("/api/legal", legalRouter);
app.route("/api/inquiries", inquiriesRouter);
app.route("/api/waitlist", waitlistRouter);
app.route("/api/vesting", vestingRouter);
app.route("/api/support", supportRouter);
// Web pages for shared article/listing links (mounted at root for clean URLs)
app.route("", webPagesRouter);

// Inquiries API added for user intent tracking
const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};