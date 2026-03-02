import { Hono } from "hono";
import { z } from "zod";
import prisma from "../lib/prisma";

export const analyticsRouter = new Hono();

// --- POST /session-start ---
const sessionStartSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  userType: z.enum(["reader", "agent"]).optional(),
  platform: z.string().optional(),
});

analyticsRouter.post("/session-start", async (c) => {
  try {
    const body = sessionStartSchema.parse(await c.req.json());
    const { userId, email, name, userType, platform } = body;

    // Mark any existing active sessions for this user as inactive
    await prisma.userSession.updateMany({
      where: { user_id: userId, is_active: true },
      data: { is_active: false, last_active_at: new Date() },
    });

    // Create new session
    const session = await prisma.userSession.create({
      data: {
        user_id: userId,
        email,
        name: name ?? "",
        user_type: userType ?? "reader",
        platform: platform ?? "ios",
        sign_in_time: new Date(),
        last_active_at: new Date(),
        duration_seconds: 0,
        is_active: true,
      },
    });

    return c.json({ success: true, sessionId: session.id });
  } catch (error) {
    console.error("[Analytics] session-start error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.issues }, 400);
    }
    return c.json({ error: "Failed to start session" }, 500);
  }
});

// --- POST /heartbeat ---
const heartbeatSchema = z.object({
  sessionId: z.string().min(1),
});

analyticsRouter.post("/heartbeat", async (c) => {
  try {
    const { sessionId } = heartbeatSchema.parse(await c.req.json());

    const session = await prisma.userSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        duration_seconds: session.duration_seconds + 60,
        last_active_at: new Date(),
      },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("[Analytics] heartbeat error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.issues }, 400);
    }
    return c.json({ error: "Failed to update heartbeat" }, 500);
  }
});

// --- POST /session-end ---
const sessionEndSchema = z.object({
  sessionId: z.string().min(1),
});

analyticsRouter.post("/session-end", async (c) => {
  try {
    const { sessionId } = sessionEndSchema.parse(await c.req.json());

    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        is_active: false,
        last_active_at: new Date(),
      },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("[Analytics] session-end error:", error);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.issues }, 400);
    }
    return c.json({ error: "Failed to end session" }, 500);
  }
});

// --- GET /dashboard ---
analyticsRouter.get("/dashboard", async (c) => {
  try {
    const daysParam = c.req.query("days");
    let days = daysParam ? parseInt(daysParam, 10) : 30;
    if (isNaN(days) || days < 1) days = 30;
    if (days > 90) days = 90;

    const now = new Date();

    // Start of date range
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - days);
    rangeStart.setHours(0, 0, 0, 0);

    // Start of today (midnight)
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Fetch all sessions in date range
    const sessionsInRange = await prisma.userSession.findMany({
      where: {
        sign_in_time: { gte: rangeStart },
      },
    });

    // Active now: count of currently active sessions
    const activeNow = await prisma.userSession.count({
      where: { is_active: true },
    });

    // Unique emails in date range
    const uniqueEmailsInRange = new Set(sessionsInRange.map((s) => s.email));
    const totalUniqueUsers = uniqueEmailsInRange.size;

    // Total sessions in date range
    const totalSessions = sessionsInRange.length;

    // Sessions today
    const sessionsToday = sessionsInRange.filter(
      (s) => s.sign_in_time >= todayStart
    );
    const totalSessionsToday = sessionsToday.length;
    const uniqueUsersToday = new Set(sessionsToday.map((s) => s.email)).size;

    // Aggregate per-user data
    const userMap = new Map<
      string,
      {
        email: string;
        name: string;
        userType: string;
        totalSessions: number;
        totalDurationSeconds: number;
        lastActiveAt: Date;
        isCurrentlyActive: boolean;
      }
    >();

    for (const session of sessionsInRange) {
      const existing = userMap.get(session.email);
      if (existing) {
        existing.totalSessions += 1;
        existing.totalDurationSeconds += session.duration_seconds;
        if (session.last_active_at > existing.lastActiveAt) {
          existing.lastActiveAt = session.last_active_at;
          existing.name = session.name || existing.name;
          existing.userType = session.user_type || existing.userType;
        }
        if (session.is_active) {
          existing.isCurrentlyActive = true;
        }
      } else {
        userMap.set(session.email, {
          email: session.email,
          name: session.name || "",
          userType: session.user_type || "reader",
          totalSessions: 1,
          totalDurationSeconds: session.duration_seconds,
          lastActiveAt: session.last_active_at,
          isCurrentlyActive: session.is_active,
        });
      }
    }

    // Sort by lastActiveAt descending
    const users = Array.from(userMap.values()).sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime()
    );

    return c.json({
      success: true,
      data: {
        totalUniqueUsers,
        activeNow,
        totalSessionsToday,
        uniqueUsersToday,
        totalSessions,
        days,
        users,
      },
    });
  } catch (error) {
    console.error("[Analytics] dashboard error:", error);
    return c.json({ error: "Failed to fetch dashboard data" }, 500);
  }
});