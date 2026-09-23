import express from "express";
import { z } from "zod";
import {
  isFatalCorrelationId,
  sanitizeFatalText,
  type ClientFatalLogRecord,
} from "@shared/clientFatal";

const reportSchema = z
  .object({
    correlationId: z.string().refine(isFatalCorrelationId),
    name: z.string().max(80),
    message: z.string().max(400),
    stack: z.string().max(1500).optional(),
  })
  .strict();

export function acceptClientFatalReport(
  body: unknown,
  log: (record: ClientFatalLogRecord) => void = record => {
    console.error("[client-fatal]", record);
  }
): { status: 204 | 400 } {
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return { status: 400 };
  const record: ClientFatalLogRecord = {
    correlationId: parsed.data.correlationId,
    name: sanitizeFatalText(parsed.data.name, 80) || "Error",
    message: sanitizeFatalText(parsed.data.message, 400) || "Failure",
  };
  if (parsed.data.stack) {
    const stack = sanitizeFatalText(parsed.data.stack, 1500);
    if (stack) record.stack = stack;
  }
  log(record);
  return { status: 204 };
}

export function registerClientFatalRoute(app: express.Express): void {
  app.post("/api/client-fatal", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    express.json({ limit: "8kb", strict: true })(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: "Invalid report" });
        return;
      }
      const result = acceptClientFatalReport(req.body);
      if (result.status === 400) {
        res.status(400).json({ error: "Invalid report" });
        return;
      }
      res.status(204).end();
    });
  });
}
