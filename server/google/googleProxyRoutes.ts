import type { Express, Request, Response } from "express";
import { ENV } from "../_core/env";
import { CANONICAL_BUILDING_GEO } from "./googleWorldService";

export function registerGoogleProxyRoutes(app: Express) {
  // 1. Street View Facade Proxy (Keeps GOOGLE_STREET_VIEW_STATIC_API_KEY server-side only)
  app.get("/api/google/streetview-facade", async (req: Request, res: Response) => {
    const buildingId = String(req.query.buildingId || "");
    const canonical = CANONICAL_BUILDING_GEO[buildingId as keyof typeof CANONICAL_BUILDING_GEO];

    const lat = Number(req.query.lat ?? canonical?.latitude ?? 34.0522);
    const lng = Number(req.query.lng ?? canonical?.longitude ?? -118.2437);
    const heading = Number(req.query.heading ?? canonical?.heading ?? 0);
    const apiKey = ENV.googleStreetViewStaticApiKey.trim();

    if (!apiKey) {
      res.status(503).json({ error: "Street View provider unconfigured" });
      return;
    }

    try {
      const googleUrl = new URL("https://maps.googleapis.com/maps/api/streetview");
      googleUrl.searchParams.set("size", "640x400");
      googleUrl.searchParams.set("location", `${lat},${lng}`);
      googleUrl.searchParams.set("heading", String(heading));
      googleUrl.searchParams.set("fov", "80");
      googleUrl.searchParams.set("pitch", "0");
      googleUrl.searchParams.set("key", apiKey);

      const upstream = await fetch(googleUrl.toString(), { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: "Street View upstream failure" });
        return;
      }

      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      const buffer = await upstream.arrayBuffer();

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(Buffer.from(buffer));
    } catch (err) {
      res.status(502).json({ error: "Street View fetch failed" });
    }
  });

  // 2. Places Photo Proxy (Keeps GOOGLE_PLACES_API_KEY server-side only)
  app.get("/api/google/places-photo", async (req: Request, res: Response) => {
    const photoName = String(req.query.name || "");
    const apiKey = ENV.googlePlacesApiKey.trim();

    if (!apiKey || !photoName) {
      res.status(400).json({ error: "Invalid photo request or unconfigured" });
      return;
    }

    // Sanitize photoName: must start with places/
    if (!photoName.startsWith("places/")) {
      res.status(400).json({ error: "Invalid photo resource name" });
      return;
    }

    try {
      const googleUrl = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
      googleUrl.searchParams.set("maxHeightPx", "800");
      googleUrl.searchParams.set("maxWidthPx", "1200");
      googleUrl.searchParams.set("key", apiKey);

      const upstream = await fetch(googleUrl.toString(), { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: "Places photo upstream failure" });
        return;
      }

      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      const buffer = await upstream.arrayBuffer();

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(Buffer.from(buffer));
    } catch (err) {
      res.status(502).json({ error: "Places photo fetch failed" });
    }
  });
}
