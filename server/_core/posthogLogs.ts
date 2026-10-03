import { logs, SeverityNumber, type Logger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { posthogHost, posthogProjectToken, shutdownServerPosthog } from "./posthogServer";

export type ServerLogSeverity = "info" | "warn" | "error";

const SECRET_ATTRIBUTE = /password|authorization|cookie|secret|api[_-]?key|bearer/i;

let provider: LoggerProvider | null | undefined;
let logger: Logger | null = null;

function severityNumber(severity: ServerLogSeverity): SeverityNumber {
  if (severity === "error") return SeverityNumber.ERROR;
  if (severity === "warn") return SeverityNumber.WARN;
  return SeverityNumber.INFO;
}

function serviceName(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.POSTHOG_SERVICE_NAME?.trim() ||
    process.env.RAILWAY_SERVICE_NAME?.trim() ||
    "bldg-admin-api"
  );
}

/**
 * OTLP logs to PostHog. LoggerProvider is used instead of NodeSDK so this
 * process does not install a tracer. No-op without a project token.
 */
export function startServerLogs(options?: { serviceName?: string }): void {
  if (provider !== undefined) return;
  const token = posthogProjectToken();
  if (!token) {
    provider = null;
    return;
  }
  try {
    const next = new LoggerProvider({
      resource: resourceFromAttributes({
        "service.name": serviceName(options?.serviceName),
        "deployment.environment":
          process.env.RAILWAY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development",
      }),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${posthogHost()}/i/v1/logs`,
            headers: { Authorization: `Bearer ${token}` },
          }),
          scheduledDelayMillis: 1_000,
        }),
      ],
    });
    logs.setGlobalLoggerProvider(next);
    logger = next.getLogger("bldg-admin-api");
    provider = next;
  } catch {
    provider = null;
    logger = null;
  }
}

export function emitServerLog(
  severity: ServerLogSeverity,
  body: string,
  attributes: Record<string, string | number | boolean | undefined> = {}
): void {
  try {
    startServerLogs();
    if (!logger) return;
    const safe: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined) continue;
      if (SECRET_ATTRIBUTE.test(key)) continue;
      safe[key] = value;
    }
    logger.emit({
      severityText: severity.toUpperCase(),
      severityNumber: severityNumber(severity),
      body,
      attributes: safe,
    });
    if (severity === "error") void provider?.forceFlush().catch(() => undefined);
  } catch {
    // Telemetry must not affect the caller.
  }
}

export async function shutdownServerTelemetry(): Promise<void> {
  await Promise.allSettled([
    shutdownServerPosthog(),
    provider ? provider.shutdown() : Promise.resolve(),
  ]);
}

export function resetServerLogsForTests(): void {
  provider = undefined;
  logger = null;
}
