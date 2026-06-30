import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
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

type ChartType = "bar" | "line" | "area" | "pie" | "none";

type ComposerChart = {
  type: ChartType;
  title: string;
  xKey: string;
  series: Array<{ key: string; label: string }>;
  data: Array<Record<string, string | number>>;
};

type ComposerTable = {
  columns: string[];
  rows: Array<Array<string | number>>;
};

type ComposerAnswer = {
  answer: string;
  chart: ComposerChart | null;
  table: ComposerTable | null;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  result?: ComposerAnswer;
};

const CHART_COLORS = ["#111111", "#6B7280", "#374151", "#9CA3AF", "#1F2937"];

const EXAMPLE_CHIPS = [
  "Revenue last 7 days",
  "Wash & fold vs dry cleaning this month",
  "Order volume by status this week",
  "Revenue vs last week comparison",
];

function ChartRender({ chart }: { chart: ComposerChart }) {
  if (chart.type === "pie") {
    const pieData = chart.data.map((row) => ({
      name: String(row[chart.xKey]),
      value: Number(row[chart.series[0]?.key ?? "value"]),
    }));
    return (
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
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

  const isLine = chart.type === "line";
  const isArea = chart.type === "area";

  if (isLine) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chart.data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          {chart.series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (isArea) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chart.data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          {chart.series.map((s, i) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chart.data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
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
              <th key={col} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-black/55 text-[10px]">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-b border-[#F0EDE8] last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-black/80 font-mono">
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

function AssistantBubble({ result }: { result: ComposerAnswer }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-black leading-relaxed">{result.answer}</p>
      {result.chart && result.chart.type !== "none" && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/40 mb-2">
            {result.chart.title}
          </div>
          <ChartRender chart={result.chart} />
        </div>
      )}
      {result.table && <TableRender table={result.table} />}
    </div>
  );
}

export function ComposerPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = trpc.admin.askComposer.useMutation({
    onSuccess(data, variables) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, result: data },
      ]);
    },
    onError(err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Sorry, something went wrong: ${err.message}` },
      ]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = (question: string) => {
    if (!question.trim() || ask.isPending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    ask.mutate({ question, history });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <div className="bg-white border border-[#E8E4DC] rounded-lg flex flex-col" style={{ minHeight: 320, maxHeight: 640 }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E8E4DC] flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-black/55">Ask</span>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="text-[10px] text-black/35 hover:text-black/60 transition-colors"
          >
            Clear
          </button>
        )}
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
              <div className="bg-black text-white text-xs px-3 py-2 rounded-lg max-w-xs">
                {m.content}
              </div>
            ) : m.result ? (
              <AssistantBubble result={m.result} />
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
          placeholder="e.g. Revenue last 7 days"
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
