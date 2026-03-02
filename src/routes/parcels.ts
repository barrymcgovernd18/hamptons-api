import { Hono } from "hono";
import { z } from "zod";

const parcelsRouter = new Hono();

const TIMEOUT_MS = 10_000; // 10 second timeout for upstream APIs

const VALID_MARKETS = ["hamptons", "palm-beach", "miami", "aspen"] as const;
type Market = (typeof VALID_MARKETS)[number];

const lookupSchema = z.object({
  lat: z.string().refine((v) => !isNaN(Number(v)), "lat must be a number"),
  lng: z.string().refine((v) => !isNaN(Number(v)), "lng must be a number"),
  market: z.enum(VALID_MARKETS),
});

/**
 * Fetch with an AbortSignal timeout.
 */
async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ????????????????????????????????????????????
// Hamptons (NYS Tax Parcels)
// ????????????????????????????????????????????
async function queryHamptons(lat: number, lng: number): Promise<unknown> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    f: "json",
  });

  const url = `https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1/query?${params.toString()}`;
  console.log(`[Parcels] Hamptons query: ${url}`);

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Hamptons API returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ????????????????????????????????????????????
// Palm Beach (PBC Property Appraiser)
// ????????????????????????????????????????????
async function queryPalmBeach(lat: number, lng: number): Promise<unknown> {
  const buffer = 0.0001;
  const envelope = `${lng - buffer},${lat - buffer},${lng + buffer},${lat + buffer}`;

  const params = new URLSearchParams({
    geometry: envelope,
    geometryType: "esriGeometryEnvelope",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    f: "json",
  });

  const url = `https://gis.pbcgov.org/arcgis/rest/services/Parcels/PARCEL_INFO/MapServer/4/query?${params.toString()}`;
  console.log(`[Parcels] Palm Beach query: ${url}`);

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Palm Beach API returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ????????????????????????????????????????????
// Miami (Two-step: FOLIO lookup then details)
// ????????????????????????????????????????????
async function queryMiami(lat: number, lng: number): Promise<unknown> {
  const buffer = 0.0005;
  const envelope = `${lng - buffer},${lat - buffer},${lng + buffer},${lat + buffer}`;

  // Step 1 - Get FOLIO and geometry
  const step1Params = new URLSearchParams({
    geometry: envelope,
    geometryType: "esriGeometryEnvelope",
    where: "1=1",
    outFields: "FOLIO",
    returnGeometry: "true",
    outSR: "4326",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    f: "json",
  });

  const step1Url = `https://gisweb.miamidade.gov/arcgis/rest/services/MD_ComparableSales/MapServer/0/query?${step1Params.toString()}`;
  console.log(`[Parcels] Miami step 1 (FOLIO lookup): ${step1Url}`);

  const step1Res = await fetchWithTimeout(step1Url);
  if (!step1Res.ok) {
    throw new Error(`Miami step 1 API returned ${step1Res.status}: ${step1Res.statusText}`);
  }

  const step1Data = (await step1Res.json()) as {
    features?: Array<{
      attributes?: { FOLIO?: string };
      geometry?: unknown;
    }>;
  };

  if (!step1Data.features || step1Data.features.length === 0) {
    // No parcel found -- return the raw step 1 response as-is
    return step1Data;
  }

  const folio = step1Data.features[0]?.attributes?.FOLIO;
  const geometry = step1Data.features[0]?.geometry;

  if (!folio) {
    // FOLIO not present, return what we have
    return step1Data;
  }

  // Step 2 - Get full details by FOLIO
  const step2Params = new URLSearchParams({
    where: `FOLIO='${folio}'`,
    outFields: "*",
    f: "json",
  });

  const step2Url = `https://gisweb.miamidade.gov/arcgis/rest/services/MD_ComparableSales/MapServer/5/query?${step2Params.toString()}`;
  console.log(`[Parcels] Miami step 2 (details for FOLIO=${folio}): ${step2Url}`);

  const step2Res = await fetchWithTimeout(step2Url);
  if (!step2Res.ok) {
    throw new Error(`Miami step 2 API returned ${step2Res.status}: ${step2Res.statusText}`);
  }

  const step2Data = (await step2Res.json()) as {
    features?: Array<{
      attributes?: Record<string, unknown>;
      geometry?: unknown;
    }>;
    [key: string]: unknown;
  };

  // Merge step 1 polygon geometry into step 2 features
  // Step 2 only returns point geometry, but we need the polygon from step 1 for highlighting
  if (step2Data.features && step2Data.features.length > 0 && geometry) {
    step2Data.features = step2Data.features.map((feature) => ({
      ...feature,
      geometry: geometry, // Always use step 1's polygon geometry
    }));
  }

  return step2Data;
}

// ????????????????????????????????????????????
// Aspen (Pitkin County GIS - Direct ArcGIS)
// ????????????????????????????????????????????
async function queryAspen(lat: number, lng: number): Promise<unknown> {
  // Use Pitkin County's official GIS Parcel Overlay service
  // Layer 9 = Parcel Boundary with full property details
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    f: "json",
  });

  const url = `https://maps.pitkincounty.com/arcgis/rest/services/Parcel_Overlay/MapServer/9/query?${params.toString()}`;
  console.log(`[Parcels] Aspen (Pitkin County GIS) query: ${url}`);

  const res = await fetchWithTimeout(url, undefined, 20000); // 20 second timeout for slower county servers
  if (!res.ok) {
    throw new Error(`Pitkin County GIS API returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ????????????????????????????????????????????
// Route handler
// ????????????????????????????????????????????
parcelsRouter.get("/lookup", async (c) => {
  const rawQuery = {
    lat: c.req.query("lat"),
    lng: c.req.query("lng"),
    market: c.req.query("market"),
  };

  const parsed = lookupSchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json({ error: "Invalid query parameters", details: parsed.error.issues }, 400);
  }

  const { lat: latStr, lng: lngStr, market } = parsed.data;
  const lat = Number(latStr);
  const lng = Number(lngStr);

  console.log(`[Parcels] Lookup request: market=${market}, lat=${lat}, lng=${lng}`);

  try {
    let data: unknown;

    switch (market) {
      case "hamptons":
        data = await queryHamptons(lat, lng);
        break;
      case "palm-beach":
        data = await queryPalmBeach(lat, lng);
        break;
      case "miami":
        data = await queryMiami(lat, lng);
        break;
      case "aspen":
        data = await queryAspen(lat, lng);
        break;
      default: {
        const _exhaustive: never = market;
        return c.json({ error: `Unknown market: ${_exhaustive}` }, 400);
      }
    }

    return c.json(data as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isTimeout = message.includes("aborted") || message.includes("abort");
    console.error(`[Parcels] Error for market=${market}: ${message}`);

    if (isTimeout) {
      return c.json(
        { error: "Upstream API request timed out", market, details: message },
        504
      );
    }

    return c.json(
      { error: "Failed to fetch parcel data", market, details: message },
      502
    );
  }
});

export { parcelsRouter };