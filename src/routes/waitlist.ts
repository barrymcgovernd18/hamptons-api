import { Hono } from "hono";

const SUPABASE_URL = "https://tfzkenrmzoxrkdntkada.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmemtlbnJtem94cmtkbnRrYWRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5OTc0OTcsImV4cCI6MjA4MzU3MzQ5N30.6IxBDHMp0TbeJdRr0114fdnsCHyrRoaIcyG5jKdPAV8";

export const waitlistRouter = new Hono();

waitlistRouter.post("/signup", async (c) => {
  try {
    const body = await c.req.json();
    const email = body.email?.toLowerCase().trim();

    if (!email || !email.includes("@")) {
      return c.json({ error: "Please enter a valid email address" }, 400);
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_launch_waitlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      const text = await res.text();
      // Duplicate email - treat as success
      if (text.includes("23505") || text.includes("duplicate")) {
        return c.json({ success: true, message: "Already signed up" });
      }
      console.error("[Waitlist] Supabase error:", res.status, text);
      return c.json({ error: "Failed to save" }, 500);
    }

    console.log("[Waitlist] Email saved:", email);
    return c.json({ success: true, saved: true });
  } catch (err) {
    console.error("[Waitlist] Error:", err);
    return c.json({ error: "Server error" }, 500);
  }
});