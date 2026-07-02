import { useCallback, useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Mic, Send, Sparkles, X } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ── Types (mirrored from server — keep in sync) ────────────────────────────

type ActionType = "open_view" | "create_task" | "draft_sms" | "copy_summary";

type ActionDef = {
  id: string;
  type: ActionType;
  label: string;
  route?: string;
  requiresApproval?: boolean;
};

type ComposerChart = {
  type: "bar" | "line" | "area" | "pie";
  title: string;
  xKey: string;
  series: Array<{ key: string; label: string }>;
  data: Array<Record<string, string | number>>;
};

type ComposerTable = {
  columns: string[];
  rows: Array<Array<string | number>>;
};

type ComposerHeadline = {
  label: string;
  value: string;
  delta?: { direction: "up" | "down" | "flat"; pct: number; label: string };
  subStats?: Array<{ label: string; value: string }>;
};

type ComposerMeta = {
  source: string;
  basis: string;
  includedSources: string[];
  excludedSources: string[];
  dateRange: { start: string; end: string };
  generatedAt: string;
  demoMode: boolean;
};

type ComposerAnswer = {
  answer: string;
  headline: ComposerHeadline | null;
  chart: ComposerChart | null;
  table: ComposerTable | null;
  actions: ActionDef[];
  meta: ComposerMeta;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  result?: ComposerAnswer;
};

export type ComposerPanelProps = {
  onNavigate: (path: string) => void;
  className?: string;
  defaultDemoMode?: boolean;
  allowDemoMode?: boolean;
  variant?: "default" | "operator-home" | "kingdom-sage" | "sage-summon";
};

const CHART_COLORS = ["#111111", "#6B7280", "#374151", "#9CA3AF", "#1F2937"];

const EXAMPLE_CHIPS = [
  "Week over week summary",
  "Unpaid orders",
  "Pickup & delivery opportunities",
  "Repeat customer trends",
  "Staffing & utilization",
  "What data is connected?",
];

const DEMO_RECOMMENDATIONS = [
  "Send payment reminders for 6+ day overdue orders.",
  "Expand pickup windows on Saturdays to capture ~12 more orders/week.",
  "Add 2 dryer cycles between 4–7 PM to reduce wait times.",
  "Re-engage at-risk customers with a personalized offer.",
];

const KINGDOM_SAGE_CHIPS = [
  "This week summary",
  "Unpaid orders",
  "Pickup & delivery",
  "Repeat trends",
];

/** The `sage-summon` thread is a temporary, in-memory-only consultation —
 * never written to localStorage/sessionStorage/backend. It self-clears
 * after this much inactivity so it never becomes a permanent chat log. */
const SAGE_THREAD_TTL_MS = 30_000;

function EmptySageInsight() {
  return (
    <div className="ks-insight-empty">
      <div>
        <span className="ks-mini-kicker">Live Laundry Butler</span>
        <h3>Ask the Sage for the next clear move.</h3>
        <p>
          Your answer will appear here with the live summary, chart, verification table,
          recommended action, and receipt.
        </p>
      </div>
      <div className="ks-placeholder-chart" aria-hidden="true">
        <span style={{ height: "42%" }} />
        <span style={{ height: "62%" }} />
        <span style={{ height: "54%" }} />
        <span style={{ height: "74%" }} />
        <span style={{ height: "48%" }} />
        <span style={{ height: "68%" }} />
        <span style={{ height: "58%" }} />
      </div>
      <div className="ks-insight-note">
        <strong>Ready for live data</strong>
        <span>No demo names or sample customers are used on Kingdom.</span>
      </div>
    </div>
  );
}

function HeadlineCard({ headline }: { headline: ComposerHeadline }) {
  const deltaColor =
    headline.delta?.direction === "up"
      ? "text-green-600"
      : headline.delta?.direction === "down"
        ? "text-red-600"
        : "text-black/40";
  const deltaArrow =
    headline.delta?.direction === "up" ? "▲" : headline.delta?.direction === "down" ? "▼" : "—";

  return (
    <div className="rounded-lg border border-[#E8E4DC] bg-[#F8F5EF] px-4 py-3 mb-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40 mb-1">
        {headline.label}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-3xl font-semibold text-black leading-none">{headline.value}</span>
        {headline.delta && (
          <span className={`text-sm font-medium ${deltaColor}`}>
            {deltaArrow} {headline.delta.pct}% {headline.delta.label}
          </span>
        )}
      </div>
      {headline.subStats && (
        <div className="flex flex-wrap gap-4 mt-2">
          {headline.subStats.map((s) => (
            <div key={s.label} className="text-xs text-black/55">
              <span className="font-semibold text-black/70">{s.value}</span> {s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartRender({ chart }: { chart: ComposerChart }) {
  if (chart.type === "pie") {
    const pieData = chart.data.map((row) => ({
      name: String(row[chart.xKey]),
      value: Number(row[chart.series[0]?.key ?? "value"]),
    }));
    return (
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label>
            {pieData.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === "line") {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chart.data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey={chart.xKey} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend />
          {chart.series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={CHART_COLORS[i % CHART_COLORS.length]} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === "area") {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chart.data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey={chart.xKey} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend />
          {chart.series.map((s, i) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.3} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chart.data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey={chart.xKey} tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Legend />
        {chart.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function TableRender({ table }: { table: ComposerTable }) {
  return (
    <div className="overflow-x-auto rounded border border-[#E8E4DC] mt-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[#F5F2ED] border-b border-[#E8E4DC]">
            {table.columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-black/55 text-[10px] whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-b border-[#F0EDE8] last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-black/80 font-mono whitespace-nowrap">
                  {String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReceiptFooter({ meta }: { meta: ComposerMeta }) {
  const date = new Date(meta.generatedAt).toLocaleString("en-US", {
    month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit",
  });
  const excluded = meta.excludedSources.slice(0, 2).join(", ");
  return (
    <div className="mt-3 text-[10px] text-black/35 leading-relaxed border-t border-[#F0EDE8] pt-2">
      <span>Receipt: {meta.source}</span>
      <span className="mx-1">·</span>
      <span>Basis: {meta.basis}</span>
      {excluded && (
        <>
          <span className="mx-1">·</span>
          <span>Not included: {excluded}</span>
        </>
      )}
      <span className="mx-1">·</span>
      <span>{date}</span>
      {meta.demoMode && (
        <span className="ml-2 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide">
          Demo
        </span>
      )}
    </div>
  );
}

function dispatchAction(action: ActionDef, onNavigate: (path: string) => void, answerText: string) {
  switch (action.type) {
    case "open_view":
      if (action.route) onNavigate(action.route);
      break;
    case "copy_summary":
      navigator.clipboard?.writeText(answerText).catch(() => {});
      toast.success("Summary copied to clipboard");
      break;
    case "create_task":
      toast.info(`${action.label} — queued for next patch`);
      break;
    case "draft_sms":
      toast.info(`${action.label} — queued for next patch`);
      break;
    default:
      toast.info(action.label);
  }
}

function ActionButtons({
  actions,
  onNavigate,
  answerText,
}: {
  actions: ActionDef[];
  onNavigate: (path: string) => void;
  answerText: string;
}) {
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => dispatchAction(action, onNavigate, answerText)}
          className="text-[11px] px-3 py-1.5 border border-[#D8D1C4] rounded text-black/70 hover:bg-black hover:text-white transition-colors flex items-center gap-1"
        >
          {action.requiresApproval && <span className="text-amber-500">●</span>}
          {action.label}
        </button>
      ))}
    </div>
  );
}

function AssistantBubble({
  result,
  onNavigate,
}: {
  result: ComposerAnswer;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-1">
      {result.headline && <HeadlineCard headline={result.headline} />}
      <p className="text-sm text-black leading-relaxed">{result.answer}</p>
      {result.chart && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/40 mb-2">
            {result.chart.title}
          </div>
          <ChartRender chart={result.chart} />
        </div>
      )}
      {result.table && <TableRender table={result.table} />}
      <ActionButtons actions={result.actions ?? []} onNavigate={onNavigate} answerText={result.answer} />
      {result.meta && <ReceiptFooter meta={result.meta} />}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

function getInitialDemoMode(defaultDemoMode: boolean) {
  if (typeof window === "undefined") return defaultDemoMode;
  const saved = window.localStorage.getItem("operatorAnalystDemoMode");
  if (saved === "false") return false;
  if (saved === "true") return true;
  return defaultDemoMode;
}

export function ComposerPanel({
  onNavigate,
  className = "",
  defaultDemoMode = false,
  allowDemoMode = true,
  variant = "default",
}: ComposerPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [demoMode, setDemoMode] = useState(() => allowDemoMode && getInitialDemoMode(defaultDemoMode));
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasUserInteractedRef = useRef(false);
  const isSageSummonVariant = variant === "sage-summon";

  // Ephemeral thread expiry — sage-summon only. One canonical timer; never
  // persisted anywhere. Reset (not started) by post-response activity, not
  // by the act of submitting — a request in flight must never be cleared.
  const expiryTimerRef = useRef<number | null>(null);
  const cancelThreadExpiry = useCallback(() => {
    if (expiryTimerRef.current !== null) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, []);
  const resetThreadExpiry = useCallback(() => {
    if (!isSageSummonVariant) return;
    cancelThreadExpiry();
    expiryTimerRef.current = window.setTimeout(() => {
      setMessages([]);
      expiryTimerRef.current = null;
    }, SAGE_THREAD_TTL_MS);
  }, [isSageSummonVariant, cancelThreadExpiry]);
  useEffect(() => cancelThreadExpiry, [cancelThreadExpiry]);

  const ask = trpc.admin.askComposer.useMutation({
    onSuccess(data) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, result: data as ComposerAnswer },
      ]);
      resetThreadExpiry();
    },
    onError(err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
      resetThreadExpiry();
    },
  });

  useEffect(() => {
    if (hasUserInteractedRef.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages]);

  const handleDeleteMessage = (index: number) => {
    // Removing from `messages` also removes it from the context sequence
    // `send()` builds for the next request — no separate context array to
    // keep in sync, so a deleted message can never leak into a follow-up.
    setMessages((prev) => prev.filter((_, i) => i !== index));
    resetThreadExpiry();
  };

  const handleClearThread = () => {
    setMessages([]);
    cancelThreadExpiry();
  };

  const toggleDemo = () => {
    if (!allowDemoMode) return;
    setDemoMode((d) => {
      const next = !d;
      window.localStorage.setItem("operatorAnalystDemoMode", String(next));
      setMessages([]);
      if (messages.length > 0) {
        toast.info(`Switched to ${next ? "demo" : "live"} data — conversation reset.`);
      }
      return next;
    });
  };

  const send = (question: string, mode?: "summary") => {
    const displayText = mode === "summary" ? "Summarize my week" : question;
    if (!displayText.trim() || ask.isPending) return;
    hasUserInteractedRef.current = true;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: displayText }]);
    setInput("");
    // A request is now in flight — cancel any pending expiry rather than
    // restarting it. onSuccess/onError schedule the real countdown once the
    // response actually completes, so the thread is never cleared mid-ask.
    cancelThreadExpiry();
    ask.mutate({ question: displayText, history, mode, demoMode: allowDemoMode ? demoMode : false });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const isOperatorHome = variant === "operator-home";
  const isKingdomSage = variant === "kingdom-sage";
  const isSageSummon = variant === "sage-summon";
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const latestQuestion = [...messages].reverse().find((message) => message.role === "user");

  // Compact presentation for the in-game SAGE summon surface: same state,
  // same tRPC mutation, same AssistantBubble rendering as every other
  // variant — only the chrome around it is smaller. A real, but EPHEMERAL,
  // multi-turn thread: never persisted anywhere, self-clears after 30s of
  // inactivity (see resetThreadExpiry/SAGE_THREAD_TTL_MS above).
  if (isSageSummon) {
    return (
      <section
        className={`ss-composer ${className}`.trim()}
        aria-label="Ask Sage"
        onClick={resetThreadExpiry}
        onFocus={resetThreadExpiry}
        onMouseUp={resetThreadExpiry}
      >
        <div className="ss-header">
          <span className="ss-orb" aria-hidden="true" />
          <div className="ss-header-text">
            <strong>Sage</strong>
            <span>Oracle of deals</span>
          </div>
          {messages.length > 0 ? (
            <button type="button" className="ss-clear-btn" onClick={handleClearThread}>
              Clear thread
            </button>
          ) : null}
        </div>

        <div className="ss-thread" onScroll={resetThreadExpiry}>
          {messages.length === 0 ? (
            <p className="ss-empty-text">
              Ask Sage anything about your store — revenue, orders, customers, sales coaching, or a follow-up to
              draft.
            </p>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`ss-turn ss-turn--${m.role}`}>
                <div className="ss-turn-head">
                  <span className="ss-turn-label">{m.role === "user" ? "You" : "Sage"}</span>
                  <button
                    type="button"
                    className="ss-turn-delete"
                    aria-label="Delete this message"
                    onClick={() => handleDeleteMessage(i)}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
                {m.role === "user" ? (
                  <p className="ss-turn-text">{m.content}</p>
                ) : m.result ? (
                  <div className="ss-turn-result">
                    <AssistantBubble result={m.result} onNavigate={onNavigate} />
                  </div>
                ) : (
                  <p className="ss-turn-text ss-error-text">{m.content}</p>
                )}
              </div>
            ))
          )}
          {ask.isPending ? (
            <div className="ss-loading">
              <span />
              Checking live order data...
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {messages.length === 0 ? (
          <div className="ss-chip-row" aria-label="Suggested questions">
            {KINGDOM_SAGE_CHIPS.slice(0, 3).map((chip) => (
              <button key={chip} type="button" onClick={() => send(chip)} disabled={ask.isPending}>
                {chip}
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="ss-input-row">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              resetThreadExpiry();
            }}
            placeholder="Ask about revenue, orders, customers…"
            disabled={ask.isPending}
          />
          <button type="submit" disabled={!input.trim() || ask.isPending} aria-label="Ask Sage">
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </section>
    );
  }

  if (isKingdomSage) {
    return (
      <section className={`ks-composer-panel ${className}`.trim()} aria-label="Operator Analyst">
        <div className="ks-composer-left">
          <span className="ks-orb" aria-hidden="true" />
          <div className="ks-title-block">
            <span>Operator Analyst</span>
            <h2>Your AI sage for cleaner margins, happier customers, and a better-run store.</h2>
          </div>

          <form onSubmit={handleSubmit} className="ks-question-box">
            <label htmlFor="kingdom-sage-input">Ask your question, seek guidance, or summon insights...</label>
            <div className="ks-input-row">
              <input
                id="kingdom-sage-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask live data..."
                disabled={ask.isPending}
              />
              <button type="submit" disabled={!input.trim() || ask.isPending}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Ask the Sage
              </button>
            </div>
          </form>

          <div className="ks-chip-row" aria-label="Suggested questions">
            {KINGDOM_SAGE_CHIPS.map((chip) => (
              <button key={chip} type="button" onClick={() => send(chip)} disabled={ask.isPending}>
                {chip}
              </button>
            ))}
          </div>

          <p className="ks-privacy-note">Your data is private, secure, and used only to guide your kingdom.</p>
        </div>

        <div className="ks-insight-panel">
          <div className="ks-insight-header">
            <div>
              <span>Sage's Insight</span>
              <h3>{latestQuestion?.content ?? "Weekly Revenue Overview"}</h3>
            </div>
            <button type="button" onClick={() => toast.info("Export is queued for a future patch.")}>
              Export
            </button>
          </div>

          <div className="ks-insight-body">
            {ask.isPending ? (
              <div className="ks-loading-state">
                <span />
                Checking live order data...
              </div>
            ) : latestAssistant?.result ? (
              <AssistantBubble result={latestAssistant.result} onNavigate={onNavigate} />
            ) : latestAssistant ? (
              <p className="ks-error-text">{latestAssistant.content}</p>
            ) : (
              <EmptySageInsight />
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      </section>
    );
  }

  const rootClassName = isOperatorHome
    ? `oa-composer-panel ${className}`.trim()
    : `bg-white border border-[#E8E4DC] rounded-lg flex flex-col ${className}`.trim();

  return (
    <div className={rootClassName} style={isOperatorHome ? undefined : { minHeight: 340, maxHeight: 680 }}>
      {/* Demo banner */}
      {allowDemoMode && demoMode && (
        <div className={isOperatorHome ? "oa-demo-banner" : "bg-amber-400 text-amber-900 text-center text-xs font-bold py-1.5 tracking-wide uppercase rounded-t-lg"}>
          DEMO DATA — NOT YOUR STORE
        </div>
      )}

      {/* Header */}
      <div className={isOperatorHome ? "oa-composer-head" : "px-4 py-3 border-b border-[#E8E4DC] flex items-center justify-between"}>
        <div className={isOperatorHome ? "oa-composer-title" : ""}>
          {isOperatorHome ? <img src="/admin-assets/operator-analyst/operator-orb.png" alt="" /> : null}
          <span>
            <strong className={isOperatorHome ? "" : "text-xs font-semibold uppercase tracking-[0.14em] text-black/55"}>
              Operator Analyst
            </strong>
            {isOperatorHome ? (
              <small>Your AI partner for stronger margins, happier customers, and a better-run store.</small>
            ) : null}
          </span>
        </div>
        <div className={isOperatorHome ? "oa-composer-tools" : "flex items-center gap-3"}>
          {allowDemoMode ? (
            <button
              type="button"
              onClick={toggleDemo}
              className={isOperatorHome ? "oa-segmented-toggle" : "flex items-center gap-1.5 cursor-pointer select-none"}
              aria-pressed={demoMode}
            >
              {isOperatorHome ? <span className={!demoMode ? "is-active" : ""}>Live</span> : null}
              <span className={demoMode ? "is-active" : ""}>{isOperatorHome ? "Demo" : "Demo"}</span>
              {!isOperatorHome ? (
                <span
                  className={`w-7 h-4 rounded-full transition-colors relative cursor-pointer ${demoMode ? "bg-amber-400" : "bg-black/15"}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${demoMode ? "translate-x-3.5" : "translate-x-0.5"}`} />
                </span>
              ) : null}
            </button>
          ) : null}
          {isOperatorHome && allowDemoMode ? (
            <span className="oa-mode-pill">
              <i />
              Demo Mode
              <small>Sample Store Data</small>
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (isOperatorHome) {
                toast.info("Sources and notes appear in each Operator Analyst receipt.");
                return;
              }
              send("Summarize my week", "summary");
            }}
            disabled={ask.isPending}
            className={isOperatorHome ? "oa-source-button" : "text-[10px] text-black/45 hover:text-black/70 transition-colors disabled:opacity-30 border border-[#D8D1C4] px-2 py-1 rounded"}
          >
            {isOperatorHome ? "Sources & Notes" : "Summarize my week"}
          </button>
          {messages.length > 0 && (
            <button type="button" onClick={() => setMessages([])} className={isOperatorHome ? "oa-clear-button" : "text-[10px] text-black/35 hover:text-black/60 transition-colors"}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className={isOperatorHome ? "oa-messages" : "flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0"}>
        {messages.length === 0 && (
          <div className={isOperatorHome ? "oa-empty-state" : "space-y-3 pt-1"}>
            <p>
              {isOperatorHome
                ? "Ask a question or choose a sample prompt. Operator Analyst will return a chart, verification table, recommended next steps, and a receipt showing what data was used."
                : "Ask a question about your laundromat data."}
            </p>
            <div className={isOperatorHome ? "oa-chip-row" : "flex flex-wrap gap-2"}>
              {EXAMPLE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => send(chip)}
                  className={isOperatorHome ? "oa-chip" : "text-[11px] px-3 py-1.5 rounded-full border border-[#D8D1C4] text-black/60 hover:bg-[#F5F2ED] hover:text-black transition-colors"}
                >
                  {chip}
                </button>
              ))}
            </div>
            {isOperatorHome ? (
              <div className="oa-demo-recommendations">
                <strong>Recommended Next Steps</strong>
                {DEMO_RECOMMENDATIONS.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="bg-black text-white text-xs px-3 py-2 rounded-lg max-w-xs">{m.content}</div>
            ) : m.result ? (
              <AssistantBubble result={m.result} onNavigate={onNavigate} />
            ) : (
              <p className="text-sm text-black/70">{m.content}</p>
            )}
          </div>
        ))}

        {ask.isPending && (
          <div className={isOperatorHome ? "oa-loading" : "flex items-center gap-2 text-xs text-black/40"}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-black/30 animate-pulse" />
            Checking live order data…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className={isOperatorHome ? "oa-input-form" : "px-4 py-3 border-t border-[#E8E4DC] flex gap-2"}>
        {isOperatorHome ? <Mic className="h-4 w-4" aria-hidden="true" /> : null}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isOperatorHome
              ? "Ask about revenue, orders, payment gaps, service mix, customers, or connected data…"
              : demoMode
                ? "Ask about demo data…"
                : "e.g. Revenue last 7 days"
          }
          disabled={ask.isPending}
          className={isOperatorHome ? "" : "flex-1 text-sm border border-[#D8D1C4] rounded px-3 py-2 bg-white placeholder-black/30 focus:outline-none focus:border-black/40 disabled:opacity-50"}
        />
        <button
          type="submit"
          disabled={!input.trim() || ask.isPending}
          className={isOperatorHome ? "" : "px-4 py-2 bg-black text-white text-xs rounded font-medium disabled:opacity-40 hover:bg-black/80 transition-colors"}
        >
          {isOperatorHome ? <Sparkles className="h-4 w-4" aria-hidden="true" /> : null}
          {isOperatorHome ? "Analyze" : "Ask"}
          {isOperatorHome ? <Send className="h-4 w-4" aria-hidden="true" /> : null}
        </button>
      </form>
    </div>
  );
}
