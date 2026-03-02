// Legal routes - Terms of Service acceptance tracking
import { Hono } from "hono";
import prisma from "../lib/prisma";

export const legalRouter = new Hono();

// Record Terms of Service acceptance
// POST /api/legal/accept-terms
legalRouter.post("/accept-terms", async (c) => {
  try {
    const body = await c.req.json();
    const { email, name, userType, termsVersion } = body;

    if (!email) {
      return c.json({ success: false, error: "Email is required" }, 400);
    }

    // Get IP address from request headers
    const ipAddress =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    // Get user agent
    const userAgent = c.req.header("user-agent") || "unknown";

    // Record the acceptance
    const acceptance = await prisma.termsAcceptance.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name || null,
        user_type: userType || "reader",
        terms_version: termsVersion || "1.0",
        ip_address: ipAddress,
        user_agent: userAgent,
      },
    });

    console.log(`[Legal] Terms accepted by ${email} at ${acceptance.accepted_at}`);

    return c.json({
      success: true,
      acceptanceId: acceptance.id,
      acceptedAt: acceptance.accepted_at,
    });
  } catch (error) {
    console.error("[Legal] Error recording terms acceptance:", error);
    return c.json({ success: false, error: "Failed to record acceptance" }, 500);
  }
});

// Check if user has accepted terms (for verification)
// GET /api/legal/check-acceptance?email=user@example.com
legalRouter.get("/check-acceptance", async (c) => {
  try {
    const email = c.req.query("email");

    if (!email) {
      return c.json({ success: false, error: "Email is required" }, 400);
    }

    const acceptance = await prisma.termsAcceptance.findFirst({
      where: {
        email: email.toLowerCase().trim(),
      },
      orderBy: {
        accepted_at: "desc",
      },
    });

    return c.json({
      success: true,
      hasAccepted: !!acceptance,
      acceptance: acceptance
        ? {
            id: acceptance.id,
            termsVersion: acceptance.terms_version,
            acceptedAt: acceptance.accepted_at,
          }
        : null,
    });
  } catch (error) {
    console.error("[Legal] Error checking acceptance:", error);
    return c.json({ success: false, error: "Failed to check acceptance" }, 500);
  }
});

// Admin: Get all terms acceptances (for audit purposes)
// GET /api/legal/acceptances
legalRouter.get("/acceptances", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "100");
    const offset = parseInt(c.req.query("offset") || "0");

    const acceptances = await prisma.termsAcceptance.findMany({
      orderBy: {
        accepted_at: "desc",
      },
      take: limit,
      skip: offset,
    });

    const total = await prisma.termsAcceptance.count();

    return c.json({
      success: true,
      acceptances,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[Legal] Error fetching acceptances:", error);
    return c.json({ success: false, error: "Failed to fetch acceptances" }, 500);
  }
});