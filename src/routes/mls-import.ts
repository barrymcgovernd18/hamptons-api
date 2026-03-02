import { Hono } from "hono";

const mlsImportRouter = new Hono();

// Independent MLS import endpoint (Railway/Vercel deployment with HC's Grok API key)
const INDEPENDENT_MLS_ENDPOINT = "https://hamptons-api-git-main-barry-mcgoverns-projects.vercel.app/api/mls-import";

// Response type from independent endpoint
interface MLSImportResponse {
  success: boolean;
  data?: {
    address?: string;
    village?: string;
    price?: string;
    beds?: string;
    baths?: string;
    sqft?: string;
    acres?: string;
    description?: string;
    brokerName?: string;
    brokerCompany?: string;
    brokerPhone?: string;
    brokerEmail?: string;
    imageUrls?: string[];
  };
  error?: string;
  suggestPaste?: boolean;
}

// Proxy to independent MLS import endpoint
// This allows the mobile app to continue using backendFetch while leveraging
// the independent infrastructure with its own API keys
mlsImportRouter.post("/parse-url", async (c) => {
  try {
    const body = await c.req.json();
    console.log(`[MLS Import Proxy] Forwarding request to independent endpoint`);

    // Forward request to independent endpoint
    const response = await fetch(INDEPENDENT_MLS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = await response.json() as MLSImportResponse;
    console.log(`[MLS Import Proxy] Response status: ${response.status}, success: ${result.success}`);

    if (!response.ok) {
      return c.json(result, response.status as 400 | 500);
    }

    // Return the result in the format the mobile app expects
    return c.json(result);
  } catch (error) {
    console.error("[MLS Import Proxy] Error:", error);
    return c.json({
      success: false,
      error: "Failed to connect to MLS import service. Please try again."
    }, 500);
  }
});

export { mlsImportRouter };