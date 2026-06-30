# On-Demand Analytics Composer — Build Plan (handoff)

**Goal:** A chat composer in the admin where a laundromat owner asks a plain-English
question ("how much did I make last week vs the week before?") and gets a short
answer + a **disposable** chart/table generated on demand. No saved dashboards
(by design — see the philosophy below). Scope for this build: **2 analytics tools +
the composer loop + a throwaway render.**

Philosophy (why no stored dashboards): the model gathers data through typed,
tenant-scoped tools and renders a throwaway answer per question. Dashboards decay;
on-demand answers don't.

---

## STEP 0 — Verify before coding (2 quick greps; do this first)

These are the only integration unknowns. Confirm, then build.

1. **`adminProcedure` exposes `tenantId` on `ctx`.**
   - Look in `server/_core/trpc.ts` and wherever `adminProcedure` is defined.
   - Confirm the resolved tenant (from `resolveTenantIdFromHeaders` / session) is on
     `ctx` as `ctx.tenantId` (or similar). If it's named differently, adapt the
     endpoint in Step 5. **The composer MUST get tenantId from `ctx`, never from the
     LLM or client input.**

2. **`invokeLLM` tool-call return shape.**
   - In `server/_core/llm.ts`, confirm: when you pass `tools` (OpenAI function format)
     the result is `result.choices[0].message.tool_calls: Array<{ id, function: { name,
     arguments(JSON string) } }>`, and `finish_reason` indicates tool use. Confirm how
     to send tool results back (role `"tool"` message with `tool_call_id`, or as an
     assistant/user turn). Match the shape `invokeLLM` expects on the next call.
   - `invokeLLM` already enforces `assertAiSpendAvailable` + `trackModelUsage` per
     `tenantId` — **always pass `tenantId`** so the `tenant_ai_usage` guardrail applies.

---

## Architecture

```
Admin UI (ComposerPanel.tsx)
  -> trpc.admin.askComposer({ question, history })       [adminProcedure -> ctx.tenantId]
       -> composerAgent.runComposerTurn({ tenantId, question, history })
            loop (max 4 iters):
              invokeLLM({ tenantId, model, tools, messages })
              if tool_calls -> execute each via runAgentTool(name, {...input, tenantId}, ctx)
                               feed results back as tool messages
              else break
            final invokeLLM({ ..., outputSchema: ComposerAnswerSchema }) -> structured answer
  <- { answer, chart, table, toolCalls }
ComposerPanel renders chart (recharts) + table + answer in component state only (disposable)
```

**Safety invariants (non-negotiable):**
- `tenantId` is injected server-side into every tool execution. The LLM supplies only
  `dateRange` / `groupBy` / filters — never a tenant id, never raw SQL.
- Tools are **read-only**. No writes, no SMS, no charges.
- The model may only state numbers returned by tools (grounding rule in the system
  prompt). Always render the underlying table so the owner can sanity-check the chart.

---

## Backend files

### 1. `server/analytics/analyticsQueries.ts` (pure Drizzle, tenant-scoped)
Two functions. Use the drizzle `db` from `server/db.ts` and the `orders` table from
`drizzle/schema.ts`. All money columns are decimal **strings** — parse with
`Number(x)`; sum in JS or via SQL `SUM`. Dollars, not cents, in the `orders.total`
column (confirm against a sample row).

```ts
export type DateRange = { start: string; end: string }; // ISO yyyy-mm-dd, inclusive

export type RevenuePoint = { bucket: string; revenue: number; orderCount: number };
export type RevenueSummary = {
  totalRevenue: number;
  orderCount: number;
  avgOrderValue: number;
  series: RevenuePoint[];        // bucketed by groupBy
};
export async function getRevenueSummary(
  tenantId: string,
  params: { range: DateRange; groupBy: "day" | "week" | "month"; basis?: "paidAt" | "createdAt" }
): Promise<RevenueSummary>;
// WHERE tenantId = ? AND paid = true AND <basis col> BETWEEN range.start AND range.end
// basis default "paidAt". GROUP BY date bucket. Order by bucket asc.

export type OrderStats = {
  totalOrders: number;
  byStatus: Record<string, number>;        // new/collected/processing/ready/delivered/cancelled
  byServiceType: Record<string, number>;   // wash_fold / dry_cleaning
  totalWeightLbs: number;                  // SUM(weightLbs) where not null
  avgOrderValue: number;
};
export async function getOrderStats(
  tenantId: string,
  params: { range: DateRange; serviceType?: "wash_fold" | "dry_cleaning"; status?: string }
): Promise<OrderStats>;
// WHERE tenantId = ? AND createdAt BETWEEN range (plus optional filters).
```

Notes:
- There is **no `deliveredAt` column** — do NOT compute true turnaround. Keep order
  stats to volume/mix/lbs/AOV which are reliable. (If a "turnaround" question comes,
  the model should answer from status mix, not invent a duration.)
- Date bucket SQL for MySQL: day = `DATE(col)`, week = `YEARWEEK(col, 3)` or
  `DATE(col - INTERVAL WEEKDAY(col) DAY)`, month = `DATE_FORMAT(col, '%Y-%m')`.

### 2. Tool wrappers — register in the agent runtime
Create `server/agents/tools/getRevenueSummaryTool.ts` and
`server/agents/tools/getOrderStatsTool.ts`, matching the `AgentTool` shape (see
`getLevel4GateStateTool.ts` for the minimal example). Each pulls `tenantId` from
`ctx` (the 2nd arg `execute(input, ctx)`), NOT from `input`:

```ts
export const getRevenueSummaryTool: AgentTool<...> = {
  name: "getRevenueSummaryTool",
  description: "Read revenue totals + a time series for THIS laundromat over a date range. Use for money/sales/revenue questions.",
  async execute(input, ctx) {
    const out = await getRevenueSummary(ctx.tenantId, {
      range: input.range, groupBy: input.groupBy ?? "day", basis: input.basis,
    });
    return { entityType: "revenue_summary", entityId: ctx.tenantId, output: out };
  },
};
```
Register both in `server/agents/toolRegistry.ts` (import + add to the registry map).

### 3. `server/agents/permissions.ts` — add the agent type
- Add `"analytics_agent"` to the `AgentType` union.
- Add an allowlist entry:
  ```ts
  analytics_agent: new Set(["getRevenueSummaryTool", "getOrderStatsTool"]),
  ```
This gives you free `agent_events` logging + permission gating via `runAgentTool`.

### 4. `server/analytics/composerAgent.ts` — the bounded tool-use loop
- Export `runComposerTurn({ tenantId, question, history }, deps?)`.
- Use **dependency injection** for `invokeLLM` and `runTool` (copy the deps pattern in
  `vendorOnboardingAgent.ts`) so it's unit-testable with a mocked LLM.
- Build the OpenAI-format `tools` array from the two tools' JSON-schema params:
  - `getRevenueSummaryTool`: params `{ range:{start,end}, groupBy:enum[day,week,month], basis?:enum[paidAt,createdAt] }`
  - `getOrderStatsTool`: params `{ range:{start,end}, serviceType?:enum, status?:string }`
- Loop (max 4 iterations):
  1. `invokeLLM({ tenantId, model: ENV.anthropicModel, temperature: 0, maxTokens: 1500, tools, toolChoice: "auto", messages })`
  2. If `tool_calls` present: for each, `JSON.parse(arguments)`, then
     `runTool(name, { ...args, /* tenantId comes from ctx, not args */ }, { tenantId, agentType:"analytics_agent", actorType:"human", actorId:"composer" })`.
     Append a tool-result message in the shape Step 0.2 confirmed. Continue loop.
  3. Else break.
- Final structured call: `invokeLLM({ tenantId, model, temperature:0, outputSchema: ComposerAnswerSchema, messages: [...withToolResults, finalInstruction] })` → parse into the answer contract.
- **System prompt must include:** "You are a read-only analytics assistant for a single
  laundromat. Only state figures returned by the tools — never estimate or invent.
  Always include the data table. Pick the simplest chart that answers the question
  (bar for comparisons over time, line for trends, pie only for share-of-total).
  If the data is empty, say so plainly."

`ComposerAnswerSchema` (strict JSON schema, same `outputSchema` mechanism the vendor
agent uses):
```ts
{
  answer: string,                         // 1-3 sentences, plain English
  chart: {
    type: "bar" | "line" | "area" | "pie" | "none",
    title: string,
    xKey: string,                         // e.g. "bucket"
    series: Array<{ key: string; label: string }>,
    data: Array<Record<string, string | number>>
  } | null,
  table: { columns: string[]; rows: Array<Array<string | number>> } | null
}
```

### 5. tRPC endpoint — `admin.askComposer`
In the admin router (find where `admin.listByStatus` / `admin.dashboardSummary` live —
grep `dashboardSummary` in `server/routers.ts` or a sub-router it imports). Add:
```ts
askComposer: adminProcedure
  .input(z.object({
    question: z.string().min(1).max(500),
    history: z.array(z.object({ role: z.enum(["user","assistant"]), content: z.string() })).max(20).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    return runComposerTurn({ tenantId: ctx.tenantId, question: input.question, history: input.history ?? [] });
  }),
```
Adapt `ctx.tenantId` to whatever Step 0.1 found.

---

## Frontend files

### 6. `client/src/components/admin/ComposerPanel.tsx`
- Local state only: `messages` (user/assistant), `result` (latest `ComposerAnswer`),
  `loading`. **Nothing persisted** — refresh clears it (that's the point).
- Input box + send button -> `trpc.admin.askComposer.useMutation()`.
- Render order: the `answer` text, then the chart, then the table.
- Chart: use `recharts` directly (Bar/Line/Area/Pie + ResponsiveContainer). You can
  reuse `client/src/components/ui/chart.tsx` wrappers or import from `recharts` raw.
  Map `chart.type` -> component; `chart.data` is already render-ready with `xKey` +
  `series[].key`.
- Empty/`type:"none"` -> render just the answer + table.
- Add 3-4 example chips ("Revenue last 7 days", "Wash & fold vs dry cleaning this
  month", "Orders by status this week") that prefill the input — great for the demo.

### 7. Wire it in
Add an "Ask" tab/section to `client/src/pages/AdminLive.tsx` (or `AdminHome.tsx`) that
renders `<ComposerPanel />`. Match the existing tab pattern in that file.

---

## No schema / migration changes
Zero new tables. The whole point is throwaway answers. (Don't add a "saved reports"
table — that's the anti-pattern this feature replaces.)

---

## Tests (vitest, mirror existing patterns)
- `server/analytics/analyticsQueries.test.ts` — deterministic: seed a few orders for a
  tenant, assert `getRevenueSummary` / `getOrderStats` totals + that another tenant's
  rows are excluded (the isolation test — important for the sales story).
- `server/analytics/composerAgent.test.ts` — inject a fake `invokeLLM` that returns a
  scripted tool_call then a final answer; assert the tool ran with the **ctx tenantId**
  (not an LLM-supplied one) and the structured answer passes through.

---

## Demo prep (maps to "make sure the data exists" — do before the meeting)
- Confirm the demo tenant has **paid orders with `paidAt` set** inside the date ranges
  your example chips use, or charts render empty. Seed a handful if needed.
- Rehearse 2-3 questions end to end. Keep the live demo to the revenue + service-mix
  questions (the two reliable tools). Breadth later; trust first.

---

## Build order (checklist)
- [ ] Step 0 verifications (ctx.tenantId, invokeLLM tool shape)
- [ ] analyticsQueries.ts + test (with cross-tenant isolation assertion)
- [ ] two tool wrappers + register in toolRegistry.ts
- [ ] permissions.ts: add analytics_agent + allowlist
- [ ] composerAgent.ts (DI for invokeLLM/runTool) + test
- [ ] admin.askComposer tRPC mutation
- [ ] ComposerPanel.tsx + wire into AdminLive
- [ ] seed/verify demo data, rehearse
```
