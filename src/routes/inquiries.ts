// Inquiries routes - User intent inquiry tracking (buy, sell, rent)
import { Hono } from "hono";
import { z } from "zod";
import prisma from "../lib/prisma";

export const inquiriesRouter = new Hono();

// Validation schemas
const submitInquirySchema = z.object({
  email: z.string().email("Valid email is required"),
  name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  intentType: z.enum(["buy", "sell", "rent"]),
  message: z.string().optional().nullable(),
  market: z.string().optional().nullable(),
});

const updateStatusSchema = z.object({
  status: z.enum(["new", "contacted", "closed"]),
});

// Helper to get prisma client with userIntentInquiry model
// This handles the case where the global prisma instance was cached before migration
function getPrismaClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  if (!client.userIntentInquiry) {
    // If the model is not available, create a fresh client
    const { PrismaClient } = require("@prisma/client");
    return new PrismaClient();
  }
  return client;
}

// Submit a new inquiry
// POST /api/inquiries/submit
inquiriesRouter.post("/submit", async (c) => {
  try {
    const body = submitInquirySchema.parse(await c.req.json());
    const { email, name, phone, intentType, message, market } = body;

    const db = getPrismaClient();
    const inquiry = await db.userIntentInquiry.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name || null,
        phone: phone || null,
        intent_type: intentType,
        message: message || null,
        market: market || "hamptons",
        status: "new",
      },
    });

    console.log(
      `[Inquiries] New ${intentType} inquiry from ${email} for ${market || "hamptons"} market`
    );

    return c.json({
      success: true,
      inquiryId: inquiry.id,
      createdAt: inquiry.created_at,
    });
  } catch (error) {
    console.error("[Inquiries] Error submitting inquiry:", error);
    if (error instanceof z.ZodError) {
      return c.json(
        { success: false, error: "Invalid request body", details: error.issues },
        400
      );
    }
    return c.json({ success: false, error: "Failed to submit inquiry" }, 500);
  }
});

// List all inquiries (for admin)
// GET /api/inquiries/list
inquiriesRouter.get("/list", async (c) => {
  try {
    const status = c.req.query("status");
    const intentType = c.req.query("intentType");
    const market = c.req.query("market");
    const limit = parseInt(c.req.query("limit") || "100");
    const offset = parseInt(c.req.query("offset") || "0");

    // Build where clause based on filters
    const where: {
      status?: string;
      intent_type?: string;
      market?: string;
    } = {};

    if (status) {
      where.status = status;
    }
    if (intentType) {
      where.intent_type = intentType;
    }
    if (market) {
      where.market = market;
    }

    const db = getPrismaClient();
    const inquiries = await db.userIntentInquiry.findMany({
      where,
      orderBy: {
        created_at: "desc",
      },
      take: limit,
      skip: offset,
    });

    const total = await db.userIntentInquiry.count({ where });

    return c.json({
      success: true,
      inquiries: inquiries.map((inquiry: {
        id: string;
        email: string;
        name: string | null;
        phone: string | null;
        intent_type: string;
        message: string | null;
        market: string;
        status: string;
        created_at: Date;
        updated_at: Date;
      }) => ({
        id: inquiry.id,
        email: inquiry.email,
        name: inquiry.name,
        phone: inquiry.phone,
        intentType: inquiry.intent_type,
        message: inquiry.message,
        market: inquiry.market,
        status: inquiry.status,
        createdAt: inquiry.created_at,
        updatedAt: inquiry.updated_at,
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[Inquiries] Error fetching inquiries:", error);
    return c.json({ success: false, error: "Failed to fetch inquiries" }, 500);
  }
});

// Update inquiry status
// POST /api/inquiries/:id/status
inquiriesRouter.post("/:id/status", async (c) => {
  try {
    const id = c.req.param("id");
    const body = updateStatusSchema.parse(await c.req.json());
    const { status } = body;

    const db = getPrismaClient();

    // Check if inquiry exists
    const existingInquiry = await db.userIntentInquiry.findUnique({
      where: { id },
    });

    if (!existingInquiry) {
      return c.json({ success: false, error: "Inquiry not found" }, 404);
    }

    const updatedInquiry = await db.userIntentInquiry.update({
      where: { id },
      data: { status },
    });

    console.log(`[Inquiries] Updated inquiry ${id} status to ${status}`);

    return c.json({
      success: true,
      inquiry: {
        id: updatedInquiry.id,
        email: updatedInquiry.email,
        name: updatedInquiry.name,
        phone: updatedInquiry.phone,
        intentType: updatedInquiry.intent_type,
        message: updatedInquiry.message,
        market: updatedInquiry.market,
        status: updatedInquiry.status,
        createdAt: updatedInquiry.created_at,
        updatedAt: updatedInquiry.updated_at,
      },
    });
  } catch (error) {
    console.error("[Inquiries] Error updating inquiry status:", error);
    if (error instanceof z.ZodError) {
      return c.json(
        { success: false, error: "Invalid request body", details: error.issues },
        400
      );
    }
    return c.json(
      { success: false, error: "Failed to update inquiry status" },
      500
    );
  }
});