import { Hono } from "hono";
import { z } from "zod";

const emailRouter = new Hono();

const sendEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  html: z.string().min(1),
});

emailRouter.post("/send", async (c) => {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.log("[Email Proxy] SendGrid API key not configured - returning success for dev");
    return c.json({ success: true });
  }

  try {
    const body = sendEmailSchema.parse(await c.req.json());

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: body.to }] }],
        from: {
          email: "info@hamptonscoastal.com",
          name: "Hamptons Coastal",
        },
        subject: body.subject,
        content: [{ type: "text/html", value: body.html }],
      }),
    });

    if (response.ok || response.status === 202) {
      console.log("[Email Proxy] Sent successfully to:", body.to);
      return c.json({ success: true });
    } else {
      const errorText = await response.text();
      console.error("[Email Proxy] SendGrid error:", errorText);
      return c.json({ success: false, error: "Email delivery failed" }, 500);
    }
  } catch (error: any) {
    console.error("[Email Proxy] Error:", error.message);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.issues }, 400);
    }
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

export { emailRouter };