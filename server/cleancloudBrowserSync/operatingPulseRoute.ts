import type { Express } from "express";
import { assertPublicPulse, loadOperatingPulse } from "./operatingPulse";

export function registerCleanCloudOperatingPulseRoute(app: Express) {
  app.get("/api/cleancloud/pulse", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const pulse = await loadOperatingPulse();
      assertPublicPulse(pulse);
      res.status(pulse.readable ? 200 : 503).json(pulse);
    } catch (error) {
      console.error(
        "[cleancloud-pulse]",
        error instanceof Error ? error.message : error
      );
      res.status(503).json({
        checkedAt: new Date().toISOString(),
        readable: false,
        functioning: false,
        jawbreaker: "never",
        summary: "Status unreadable.",
        tenants: [],
      });
    }
  });
}
