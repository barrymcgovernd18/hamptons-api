import { Hono } from "hono";
import { z } from "zod";

const revalidateRouter = new Hono();

const revalidateBodySchema = z.object({
  paths: z
    .array(z.string().startsWith("/"))
    .min(1, "At least one path is required")
    .max(50, "Maximum 50 paths per request"),
});

/**
 * POST /trigger
 *
 * Triggers on-demand revalidation on the Vercel-hosted Next.js website.
 * Accepts an array of paths to revalidate and forwards them to the
 * website's /api/revalidate endpoint along with a shared secret.
 *
 * Body: { paths: string[] }
 * Example: { "paths": ["/", "/articles/some-slug", "/listings"] }
 */
revalidateRouter.post("/trigger", async (c) => {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    console.error("[Revalidate] REVALIDATE_SECRET env var is not set");
    return c.json(
      { success: false, error: "Revalidation is not configured" },
      500
    );
  }

  try {
    const body = revalidateBodySchema.parse(await c.req.json());
    const { paths } = body;

    // Always use the production domain for revalidation
    const websiteUrl = "https://hamptonscoastal.com";

    console.log(
      `[Revalidate] Triggering revalidation for ${paths.length} path(s):`,
      paths.join(", ")
    );

    const response = await fetch(`${websiteUrl}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Host": "hamptonscoastal.com",
      },
      body: JSON.stringify({ paths, secret }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      console.error(
        `[Revalidate] Website returned ${response.status}: ${responseBody}`
      );
      return c.json(
        {
          success: false,
          error: "Revalidation request failed",
          status: response.status,
        },
        502
      );
    }

    const result = (await response.json()) as Record<string, unknown>;
    console.log("[Revalidate] Success:", JSON.stringify(result));

    return c.json({
      success: true,
      revalidated: paths,
      websiteResponse: result,
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return c.json(
        { success: false, error: "Invalid request body", details: error.issues },
        400
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Revalidate] Failed to call website:", message);
    return c.json(
      { success: false, error: "Failed to reach website for revalidation" },
      502
    );
  }
});

export { revalidateRouter };