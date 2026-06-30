import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
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
};

// ── Constants ───────────────────────────────────────────────────────────────

const CHART_COLORS = ["#111111", "#6B7280", "#374151", "#9CA3AF", "#1F2937"];

const EXAMPLE_CHIPS = [
  "Revenue last 7 days",
  "Open orders right now",
  "Compare this week to last week",
  "Wash & fold vs dry cleaning this month",
  "What data do you have?",
];

// ── Sub-components ──────────────────────────────────────────────────────────

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
    <div className="bg-[#F5F2ED] rounded border border-[#E8E4DC] px-4 py-3 mb-3">
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
        <div className="flex gap-4 mt-2">
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
      <span>Source: {meta.source}</span>
      <span className="mx-1">·</span>
      <span>Basis: {meta.basis}</span>
      {excluded && (
        <>
          <span className="mx-1">·</span>
          <span>Excluded: {excluded}</span>
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
          onClick={() => {
            if (action.type === "copy_summary") {
              navigator.clipboard?.writeText(answerText).catch(() => {});
            } else if (action.route) {
              onNavigate(action.route);
            }
          }}
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

export function ComposerPanel({ onNavigate }: ComposerPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = trpc.admin.askComposer.useMutation({
    onSuccess(data) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, result: data as ComposerAnswer },
      ]);
    },
    onError(err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = (question: string, mode?: "summary") => {
    if ((!question.trim() && !mode) || ask.isPending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    if (!mode) {
      setMessages((prev) => [...prev, { role: "user", content: question }]);
    }
    setInput("");
    ask.mutate({ question: question || "Summarize my business this week.", history, mode, demoMode });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <div className="bg-white border border-[#E8E4DC] rounded-lg flex flex-col" style={{ minHeight: 340, maxHeight: 680 }}>
      {/* Demo banner */}
      {demoMode && (
        <div className="bg-amber-400 text-amber-900 text-center text-xs font-bold py-1.5 tracking-wide uppercase rounded-t-lg">
          DEMO DATA — NOT YOUR STORE
        </div>
      )}

      {/* Header */}
      <div className={`px-4 py-3 border-b border-[#E8E4DC] flex items-center justify-between ${demoMode ? "" : ""}`}>
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-black/55">
          Operator Analyst
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <div
              onClick={() => setDemoMode((d) => !d)}
              className={`w-7 h-4 rounded-full transition-colors relative cursor-pointer ${demoMode ? "bg-amber-400" : "bg-black/15"}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${demoMode ? "translate-x-3.5" : "translate-x-0.5"}`} />
            </div>
            <span className="text-[10px] text-black/45">Demo</span>
          </label>
          <button
            onClick={() => send("", "summary")}
            disabled={ask.isPending}
            className="text-[10px] text-black/45 hover:text-black/70 transition-colors disabled:opacity-30 border border-[#D8D1C4] px-2 py-1 rounded"
          >
            Summarize my week
          </button>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="text-[10px] text-black/35 hover:text-black/60 transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-3 pt-1">
            <p className="text-xs text-black/40">Ask a question about your laundromat data.</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => send(chip)}
                  className="text-[11px] px-3 py-1.5 rounded-full border border-[#D8D1C4] text-black/60 hover:bg-[#F5F2ED] hover:text-black transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
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
          <div className="flex items-center gap-2 text-xs text-black/40">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-black/30 animate-pulse" />
            Gathering data…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-[#E8E4DC] flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={demoMode ? "Ask about demo data…" : "e.g. Revenue last 7 days"}
          disabled={ask.isPending}
          className="flex-1 text-sm border border-[#D8D1C4] rounded px-3 py-2 bg-white placeholder-black/30 focus:outline-none focus:border-black/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || ask.isPending}
          className="px-4 py-2 bg-black text-white text-xs rounded font-medium disabled:opacity-40 hover:bg-black/80 transition-colors"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
