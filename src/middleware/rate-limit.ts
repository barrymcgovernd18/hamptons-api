import type { Context, Next } from "hono";

// Simple in-memory rate limiter
// For production, consider using Redis-based rate limiting
const requestCounts = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests } = options;

  // Clean up old entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of requestCounts.entries()) {
      if (value.resetAt < now) {
        requestCounts.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  return async (c: Context, next: Next) => {
    // Use IP + path as the rate limit key
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    const current = requestCounts.get(key);

    if (!current || current.resetAt < now) {
      // New window
      requestCounts.set(key, { count: 1, resetAt: now + windowMs });
      c.header("X-RateLimit-Limit", maxRequests.toString());
      c.header("X-RateLimit-Remaining", (maxRequests - 1).toString());
      await next();
      return;
    }

    if (current.count >= maxRequests) {
      c.header("X-RateLimit-Limit", maxRequests.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", Math.ceil((current.resetAt - now) / 1000).toString());
      return c.json({ error: "Too many requests. Please try again later." }, 429);
    }

    current.count++;
    c.header("X-RateLimit-Limit", maxRequests.toString());
    c.header("X-RateLimit-Remaining", (maxRequests - current.count).toString());
    await next();
  };
}