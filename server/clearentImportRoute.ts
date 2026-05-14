import type express from "express";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
import { sdk } from "./_core/sdk";
import { isValidAgentSharedSecret } from "./agents/s2sEndpoint";
import { importClearentTransactions, parseClearentReportBasis } from "./clearent";

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

type ExtractedImport = {
  buffer: Buffer;
  fileName: string | null;
  contentType: string | null;
  csvText: string | null;
  reportBasis: "settled_date" | "entered_date" | "unknown";
};

function readRequestBody(req: express.Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_IMPORT_BYTES) {
        reject(new Error("Clearent import exceeds 50mb limit"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(body: Buffer, contentType: string): ExtractedImport {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error("Multipart boundary is missing");

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let buffer = Buffer.alloc(0);
  let fileName: string | null = null;
  let fileContentType: string | null = null;
  let csvText: string | null = null;
  let reportBasis: "settled_date" | "entered_date" | "unknown" = "unknown";

  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(boundaryBuffer, cursor);
    if (start === -1) break;
    const partStart = start + boundaryBuffer.length;
    if (body.slice(partStart, partStart + 2).toString() === "--") break;
    const headerStart = body.slice(partStart, partStart + 2).toString() === "\r\n" ? partStart + 2 : partStart;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd === -1) break;
    const nextBoundary = body.indexOf(boundaryBuffer, headerEnd + 4);
    if (nextBoundary === -1) break;

    const headers = body.slice(headerStart, headerEnd).toString("utf8");
    let content = body.slice(headerEnd + 4, nextBoundary);
    if (content.slice(-2).toString() === "\r\n") content = content.slice(0, -2);
    const name = headers.match(/name="([^"]+)"/i)?.[1];
    const filename = headers.match(/filename="([^"]+)"/i)?.[1];
    const contentTypeMatch = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? null;

    if (filename) {
      fileName = filename;
      fileContentType = contentTypeMatch;
      buffer = content;
    } else if (name === "csvText" || name === "csv") {
      csvText = content.toString("utf8");
    } else if (name === "reportBasis" || name === "sourceReportBasis") {
      reportBasis = parseClearentReportBasis(content.toString("utf8").trim());
    } else if (name === "sourceFileName") {
      fileName = content.toString("utf8").trim();
    }

    cursor = nextBoundary;
  }

  return { buffer, fileName, contentType: fileContentType, csvText, reportBasis };
}

function extractImportInput(body: Buffer, contentType: string): ExtractedImport {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("multipart/form-data")) return parseMultipart(body, contentType);

  const bodyText = body.toString("utf8");
  if (normalized.includes("application/json")) {
    const parsed = bodyText ? JSON.parse(bodyText) : {};
    const csvText = String(parsed.csvText ?? parsed.csv ?? "");
    return {
      buffer: Buffer.from(csvText),
      fileName: parsed.sourceFileName != null ? String(parsed.sourceFileName) : null,
      contentType: "text/csv",
      csvText,
      reportBasis: parseClearentReportBasis(parsed.reportBasis ?? parsed.sourceReportBasis),
    };
  }
  if (normalized.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(bodyText);
    const csvText = params.get("csvText") ?? params.get("csv") ?? "";
    return {
      buffer: Buffer.from(csvText),
      fileName: params.get("sourceFileName"),
      contentType: "text/csv",
      csvText,
      reportBasis: parseClearentReportBasis(params.get("reportBasis") ?? params.get("sourceReportBasis")),
    };
  }

  return {
    buffer: body,
    fileName: null,
    contentType,
    csvText: normalized.includes("csv") || normalized.includes("text/plain") ? bodyText : null,
    reportBasis: "unknown",
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

export function registerClearentImportRoutes(app: express.Express) {
  app.post("/api/admin/clearent/import", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const body = await readRequestBody(req);
      const input = extractImportInput(body, String(req.headers["content-type"] ?? "text/csv"));
      const reportBasis = parseClearentReportBasis(req.query.reportBasis ?? req.query.sourceReportBasis ?? input.reportBasis);

      if (!input.csvText?.trim() && input.buffer.length === 0) {
        return res.status(400).json({
          error: "Excel upload, CSV upload, or csvText is required",
          code: "CLEARENT_IMPORT_EMPTY",
        });
      }

      const tenant = resolveTenantIdFromHeaders(req.headers as Record<string, string | string[] | undefined>);
      const summary = await importClearentTransactions({
        buffer: input.buffer,
        fileName: input.fileName,
        contentType: input.contentType,
        csvText: input.csvText,
        sourceReportBasis: reportBasis,
      });

      return res.status(200).json({
        ...summary,
        tenantId: tenant.tenantId,
        label: "Clearent / XplorPay",
        depositsDeferred: true,
        invalidated: [
          "Customers dashboard",
          "Building Leaderboard",
          "Operator Reflection / Performance Proof",
          "collected revenue summaries",
          "settled revenue summaries",
        ],
      });
    } catch (error) {
      const statusCode = (error as any)?.statusCode === 401 ? 401 : 500;
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : String(error),
        code: statusCode === 401 ? "CLEARENT_IMPORT_UNAUTHORIZED" : "CLEARENT_IMPORT_FAILED",
      });
    }
  });
}
