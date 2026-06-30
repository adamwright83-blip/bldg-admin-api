import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import { getRevenueSummary, getOrderStats } from "./analyticsQueries";
import type { DateRange, RevenueSummary, OrderStats } from "./analyticsQueries";

export type ComposerChartType = "bar" | "line" | "area" | "pie" | "none";

export type ComposerChart = {
  type: ComposerChartType;
  title: string;
  xKey: string;
  series: Array<{ key: string; label: string }>;
  data: Array<Record<string, string | number>>;
};

export type ComposerTable = {
  columns: string[];
  rows: Array<Array<string | number>>;
};

export type ComposerAnswer = {
  answer: string;
  chart: ComposerChart | null;
  table: ComposerTable | null;
};

export type HistoryMessage = { role: "user" | "assistant"; content: string };

// ── Pass-1 schema: Claude decides what data to fetch ─────────────────────────

type QueryPlanTool = "getRevenueSummary" | "getOrderStats" | "both";

type QueryPlan = {
  tool: QueryPlanTool;
  range: DateRange;
  groupBy: "day" | "week" | "month";
  basis: "paidAt" | "createdAt";
  serviceType?: "wash_fold" | "dry_cleaning";
  status?: string;
  reasoning: string;
};

const queryPlanSchema = {
  name: "query_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["tool", "range", "groupBy", "basis", "reasoning"],
    properties: {
      tool: { type: "string", enum: ["getRevenueSummary", "getOrderStats", "both"] },
      range: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end"],
        properties: {
          start: { type: "string" },
          end: { type: "string" },
        },
      },
      groupBy: { type: "string", enum: ["day", "week", "month"] },
      basis: { type: "string", enum: ["paidAt", "createdAt"] },
      serviceType: { type: "string", enum: ["wash_fold", "dry_cleaning", ""] },
      status: { type: "string" },
      reasoning: { type: "string" },
    },
  },
};

// ── Pass-2 schema: Claude writes the answer from the data ─────────────────────

const composerAnswerSchema = {
  name: "composer_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answer", "chart", "table"],
    properties: {
      answer: { type: "string" },
      chart: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "title", "xKey", "series", "data"],
            properties: {
              type: { type: "string", enum: ["bar", "line", "area", "pie"] },
              title: { type: "string" },
              xKey: { type: "string" },
              series: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["key", "label"],
                  properties: {
                    key: { type: "string" },
                    label: { type: "string" },
                  },
                },
              },
              data: {
                type: "array",
                items: { type: "object", additionalProperties: true },
              },
            },
          },
          { type: "null" },
        ],
      },
      table: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["columns", "rows"],
            properties: {
              columns: { type: "array", items: { type: "string" } },
              rows: {
                type: "array",
                items: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
              },
            },
          },
          { type: "null" },
        ],
      },
    },
  },
};

// ── Dependency injection (for testing) ───────────────────────────────────────

export type ComposerDeps = {
  invokeLLM: typeof invokeLLM;
  getRevenueSummary: typeof getRevenueSummary;
  getOrderStats: typeof getOrderStats;
};

export const defaultComposerDeps: ComposerDeps = {
  invokeLLM,
  getRevenueSummary,
  getOrderStats,
};

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runComposerTurn(
  { tenantId, question, history }: { tenantId: string; question: string; history: HistoryMessage[] },
  deps: ComposerDeps = defaultComposerDeps
): Promise<ComposerAnswer> {
  const today = new Date().toISOString().slice(0, 10);
  const model = ENV.anthropicModel;

  // ── Pass 1: Determine what queries to run ──────────────────────────────────
  const planResult = await deps.invokeLLM({
    tenantId,
    model,
    temperature: 0,
    maxTokens: 600,
    outputSchema: queryPlanSchema,
    messages: [
      {
        role: "system",
        content: [
          `You are a query planner for a laundromat analytics system. Today is ${today}.`,
          "Decide which data to fetch to answer the owner's question.",
          "getRevenueSummary: revenue totals and time series (use for money/revenue/sales questions).",
          "getOrderStats: order counts, status breakdown, service mix, lbs (use for volume/mix questions).",
          "Use 'both' when the question needs revenue AND volume/mix.",
          "Choose the smallest date range that answers the question. Default to last 7 days when unspecified.",
          "Use groupBy 'day' for <= 14 days, 'week' for <= 90 days, 'month' for > 90 days.",
          "basis 'paidAt' for revenue questions, 'createdAt' for order-count questions.",
        ].join("\n"),
      },
      ...historyMessages(history),
      { role: "user", content: question },
    ],
  });

  const planContent = planResult.choices[0]?.message.content;
  const plan: QueryPlan = JSON.parse(
    typeof planContent === "string" ? planContent : JSON.stringify(planContent)
  );

  // ── Execute queries (tenantId always from ctx, never from LLM) ────────────
  let revenue: RevenueSummary | null = null;
  let stats: OrderStats | null = null;

  if (plan.tool === "getRevenueSummary" || plan.tool === "both") {
    revenue = await deps.getRevenueSummary(tenantId, {
      range: plan.range,
      groupBy: plan.groupBy,
      basis: plan.basis,
    });
  }

  if (plan.tool === "getOrderStats" || plan.tool === "both") {
    stats = await deps.getOrderStats(tenantId, {
      range: plan.range,
      serviceType: plan.serviceType || undefined,
      status: plan.status || undefined,
    });
  }

  // ── Pass 2: Generate the answer from the data ─────────────────────────────
  const dataContext = JSON.stringify({ revenue, stats, dateRange: plan.range, groupBy: plan.groupBy });

  const answerResult = await deps.invokeLLM({
    tenantId,
    model,
    temperature: 0,
    maxTokens: 1200,
    outputSchema: composerAnswerSchema,
    messages: [
      {
        role: "system",
        content: [
          "You are a read-only analytics assistant for a laundromat.",
          "Only state figures present in the queryResults data — never estimate or invent numbers.",
          "answer: 1-3 plain-English sentences. Use dollars for revenue (e.g. $142.50, not 14250 cents).",
          "chart: pick bar for comparisons, line/area for trends over time, pie for share-of-total. null if data is empty or a single point.",
          "table: always include raw figures as a table so the owner can verify. null only if there is genuinely no tabular data.",
          "For revenue series: xKey='bucket', series=[{key:'revenue',label:'Revenue ($)'},{key:'orderCount',label:'Orders'}].",
          "For order mix (byStatus/byServiceType): format as a simple key-value table.",
          "If both revenue and stats are present, show revenue chart + a stats table.",
        ].join("\n"),
      },
      ...historyMessages(history),
      { role: "user", content: question },
      {
        role: "user",
        content: `Query results:\n${dataContext}`,
      },
    ],
  });

  const answerContent = answerResult.choices[0]?.message.content;
  return JSON.parse(
    typeof answerContent === "string" ? answerContent : JSON.stringify(answerContent)
  ) as ComposerAnswer;
}

function historyMessages(history: HistoryMessage[]) {
  return history.slice(-8).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}
