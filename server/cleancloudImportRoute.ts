import type express from "express";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
import { sdk } from "./_core/sdk";
import { importCleanCloudLegacyOrders } from "./cleancloudLegacy";
import { isValidAgentSharedSecret } from "./agents/s2sEndpoint";

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

function readRequestBody(req: express.Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_IMPORT_BYTES) {
        reject(new Error("CSV import exceeds 50mb limit"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractMultipart(body: Buffer, contentType: string) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error("Multipart boundary is missing");

  const text = body.toString("utf8");
  const parts = text.split(`--${boundary}`);
  let csvText = "";
  let sourceFileName: string | null = null;

  for (const part of parts) {
    const [rawHeaders, ...rest] = part.split(/\r?\n\r?\n/);
    if (!rawHeaders || rest.length === 0) continue;
    const content = rest.join("\n\n").replace(/\r?\n--$/, "").replace(/\r?\n$/, "");
    const name = rawHeaders.match(/name="([^"]+)"/i)?.[1];
    const filename = rawHeaders.match(/filename="([^"]+)"/i)?.[1];
    if (filename) {
      sourceFileName = filename;
      csvText = content;
    } else if (name === "csvText" || name === "csv") {
      csvText = content;
    } else if (name === "sourceFileName") {
      sourceFileName = content.trim();
    }
  }

  return { csvText, sourceFileName };
}

function extractImportInput(body: Buffer, contentType: string) {
  const bodyText = body.toString("utf8");
  const normalizedContentType = contentType.toLowerCase();

  if (normalizedContentType.includes("multipart/form-data")) {
    return extractMultipart(body, contentType);
  }
  if (normalizedContentType.includes("application/json")) {
    const parsed = bodyText ? JSON.parse(bodyText) : {};
    return {
      csvText: String(parsed.csvText ?? parsed.csv ?? ""),
      sourceFileName: parsed.sourceFileName != null ? String(parsed.sourceFileName) : null,
    };
  }
  if (normalizedContentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(bodyText);
    return {
      csvText: params.get("csvText") ?? params.get("csv") ?? "",
      sourceFileName: params.get("sourceFileName"),
    };
  }
  return {
    csvText: bodyText,
    sourceFileName: null,
  };
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

export function registerCleanCloudImportRoutes(app: express.Express) {
  app.post("/api/admin/cleancloud/import", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const contentType = String(req.headers["content-type"] ?? "text/csv");
      const body = await readRequestBody(req);
      const input = extractImportInput(body, contentType);

      if (!input.csvText.trim()) {
        return res.status(400).json({
          error: "CSV upload or csvText is required",
          code: "CLEANCLOUD_IMPORT_EMPTY",
        });
      }

      const tenant = resolveTenantIdFromHeaders(req.headers as Record<string, string | string[] | undefined>);
      const summary = await importCleanCloudLegacyOrders({
        csvText: input.csvText,
        sourceFileName: input.sourceFileName ?? undefined,
      });

      return res.status(200).json({
        ...summary,
        tenantId: tenant.tenantId,
        invalidated: [
          "Building Leaderboard",
          "customer counts",
          "revenue summaries",
          "operational totals",
        ],
      });
    } catch (error) {
      const statusCode = (error as any)?.statusCode === 401 ? 401 : 500;
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : String(error),
        code: statusCode === 401 ? "CLEANCLOUD_IMPORT_UNAUTHORIZED" : "CLEANCLOUD_IMPORT_FAILED",
      });
    }
  });
}
