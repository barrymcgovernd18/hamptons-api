import { Hono } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { z } from "zod";

const aiRouter = new Hono();

// Grok (xAI) proxy - used for article generation and comp analysis
const grokBodySchema = z.object({
  model: z.string().default("grok-3"),
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })),
  max_tokens: z.number().optional().default(4000),
  temperature: z.number().optional().default(0.3),
});

aiRouter.post("/grok", async (c) => {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Grok API key not configured" }, 500);
  }

  try {
    const body = grokBodySchema.parse(await c.req.json());

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[AI Proxy] Grok error:", response.status, errorText);
      return c.json(
        { error: `Grok API error: ${response.status}` },
        response.status as StatusCode,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return c.json(data);
  } catch (error: any) {
    console.error("[AI Proxy] Grok proxy error:", error.message);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.issues }, 400);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Perplexity proxy - used for market AI chat
const perplexityBodySchema = z.object({
  model: z.string().default("sonar"),
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })),
  max_tokens: z.number().optional().default(1000),
  temperature: z.number().optional().default(0.7),
});

aiRouter.post("/perplexity", async (c) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Perplexity API key not configured" }, 500);
  }

  try {
    const body = perplexityBodySchema.parse(await c.req.json());

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[AI Proxy] Perplexity error:", response.status, errorText);
      return c.json(
        { error: `Perplexity API error: ${response.status}` },
        response.status as StatusCode,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return c.json(data);
  } catch (error: any) {
    console.error("[AI Proxy] Perplexity proxy error:", error.message);
    if (error instanceof z.ZodError) {
      return c.json({ error: "Invalid request body", details: error.issues }, 400);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { aiRouter };