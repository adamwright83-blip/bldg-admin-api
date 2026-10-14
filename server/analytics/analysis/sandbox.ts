import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import {
  APPROVED_VIEWS,
  type ApprovedDataset,
  type Row,
} from "./approvedViews";
import { validateAnalysisSql, type AnalysisMoneyUnit } from "./sqlPolicy";

export const ANALYSIS_LIMITS = Object.freeze({
  datasetBytes: 16 * 1024 * 1024,
  datasetRows: 50000,
  resultBytes: 64000,
  resultRows: 100,
  queryMs: 3000,
  concurrent: 2,
});
export type QueryReceipt = {
  id: string;
  tenantId: string;
  asOf: string;
  queryHash: string;
  datasetHash: string;
  views: string[];
  elapsedMs: number;
  rowCount: number;
  truncated: boolean;
  status: "ok" | "error" | "timeout" | "cancelled";
};
export type AnalysisQueryResult = {
  columns: string[];
  rows: Row[];
  /** Derived from validated expression lineage, not model-selected labels. */
  monetaryUnits?: Record<string, AnalysisMoneyUnit>;
  receipt: QueryReceipt;
  error?: string;
};
let active = 0;
const require = createRequire(import.meta.url);

// Trusted worker program. No model text is evaluated as JavaScript; only regenerated SELECT reaches SQLite.

export function assertDatasetBounded(dataset: ApprovedDataset): void {
  if (!dataset.tenantId?.trim()) throw new Error("Established tenant required");
  let rows = 0,
    bytes = 0;
  if (
    Object.keys(dataset.tables).some(
      name => !APPROVED_VIEWS.some(v => v.name === name)
    )
  )
    throw new Error("Unapproved dataset");
  for (const view of APPROVED_VIEWS) {
    const table = dataset.tables[view.name];
    if (!Array.isArray(table)) throw new Error("Missing approved view");
    rows += table.length;
    if (rows > ANALYSIS_LIMITS.datasetRows)
      throw new Error(
        "Dataset row limit exceeded; narrow the reporting window"
      );
    for (const row of table) {
      if (
        row.length !== view.columns.length ||
        row.some(
          v =>
            v !== null &&
            typeof v !== "string" &&
            (typeof v !== "number" || !Number.isFinite(v))
        )
      )
        throw new Error("Invalid analytical row");
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (bytes > ANALYSIS_LIMITS.datasetBytes)
        throw new Error(
          "Dataset byte limit exceeded; narrow the reporting window"
        );
    }
  }
}

export async function executeAnalysisQuery(input: {
  tenantId: string;
  dataset: ApprovedDataset;
  sql: string;
  signal?: AbortSignal;
}): Promise<AnalysisQueryResult> {
  if (input.dataset.tenantId !== input.tenantId || !input.tenantId.trim())
    throw new Error("Tenant dataset mismatch");
  assertDatasetBounded(input.dataset);
  const checked = validateAnalysisSql(input.sql);
  if (active >= ANALYSIS_LIMITS.concurrent)
    throw new Error("Analysis capacity busy");
  input.signal?.throwIfAborted();
  const started = Date.now();
  const receipt: QueryReceipt = {
    id: randomUUID(),
    tenantId: input.tenantId,
    asOf: input.dataset.generatedAt,
    queryHash: createHash("sha256").update(checked.sql).digest("hex"),
    datasetHash: createHash("sha256")
      .update(JSON.stringify(input.dataset.tables))
      .digest("hex"),
    views: checked.views,
    elapsedMs: 0,
    rowCount: 0,
    truncated: false,
    status: "error",
  };
  active++;
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL("./analysisWorker.cjs", import.meta.url), {
      execArgv: [],
      env: {},
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 2,
      },
      workerData: {
        modulePath: require.resolve("sql.js"),
        wasmPath: require.resolve("sql.js/dist/sql-wasm.wasm"),
        catalog: APPROVED_VIEWS,
        tables: input.dataset.tables,
        sql: checked.sql,
        limits: ANALYSIS_LIMITS,
      },
    });
    const result = await new Promise<any>(resolve => {
      const settle = (value: any) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        resolve(value);
      };
      const abort = () =>
        settle({ error: "Analysis cancelled", status: "cancelled" });
      const timer = setTimeout(
        () =>
          settle({
            error: "Calculation time limit exceeded",
            status: "timeout",
          }),
        ANALYSIS_LIMITS.queryMs
      );
      input.signal?.addEventListener("abort", abort, { once: true });
      worker!.once("message", settle);
      worker!.once("error", () => settle({ error: "Sandbox worker failed" }));
      worker!.once("exit", code => {
        if (code !== 0) settle({ error: "Sandbox worker exited" });
      });
      if (input.signal?.aborted) abort();
    });
    receipt.status = result.error ? (result.status ?? "error") : "ok";
    receipt.rowCount = result.rows?.length ?? 0;
    receipt.truncated = result.truncated ?? false;
    return {
      columns: result.columns ?? [],
      rows: result.rows ?? [],
      monetaryUnits: Object.fromEntries(
        (result.columns ?? []).map((name: string) => {
          const key = name.toLowerCase();
          // Direct SELECT * of a trusted money column has no explicit alias.
          const direct = APPROVED_VIEWS.some(view =>
            view.columns.some(c => c.name === key && c.name.endsWith("_cents"))
          );
          return [key, checked.outputUnits[key] ?? (direct ? "cents" : "none")];
        })
      ),
      ...(result.error ? { error: result.error } : {}),
      receipt,
    };
  } finally {
    await worker?.terminate();
    active--;
    receipt.elapsedMs = Date.now() - started;
  }
}
