import type express from "express";
import { sdk } from "./_core/sdk";
import { isValidAgentSharedSecret } from "./agents/s2sEndpoint";
import { syncLaundryFarmRevenueSheet } from "./laundryFarmSheetSync";

const MAX_BODY_BYTES = 1024 * 1024;

function readRequestBody(req: express.Request): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body exceeds 1mb limit"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function assertAdminOrAgent(req: express.Request) {
  if (isValidAgentSharedSecret(req.headers["x-agent-shared-secret"])) return;

  let user = null;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    user = null;
  }
  if (!user || user.role !== "admin") {
    const err = new Error("Unauthorized");
    (err as any).statusCode = 401;
    throw err;
  }
}

function parseInput(bodyText: string) {
  if (!bodyText.trim()) return {};
  const parsed = JSON.parse(bodyText);
  return {
    date: typeof parsed.date === "string" ? parsed.date : undefined,
    dryRun: Boolean(parsed.dryRun),
  };
}

export function registerLaundryFarmSheetSyncRoutes(app: express.Express) {
  app.post("/api/admin/sheets/sync-laundry-farm-revenue", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const bodyText = await readRequestBody(req);
      const input = parseInput(bodyText);
      const result = await syncLaundryFarmRevenueSheet(input);
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (error) {
      const statusCode = (error as any)?.statusCode === 401 ? 401 : 500;
      return res.status(statusCode).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: statusCode === 401 ? "SHEETS_SYNC_UNAUTHORIZED" : "SHEETS_SYNC_FAILED",
      });
    }
  });
}
