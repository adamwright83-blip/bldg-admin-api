import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ChevronRight,
  Crosshair,
  Minus,
  TrendingUp,
} from "lucide-react";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

type Tab = "market-yield" | "territory" | "performance";
type OperatorKey = "you" | "operatorA" | "operatorB" | "operatorC";

interface Props {
  onBack: () => void;
}

interface OperatorRow {
  operator: string;
  key: OperatorKey;
  customerNodes: number;
  trend: "up" | "down" | "flat";
  trendLabel: string;
  routeYield: string;
}

interface AlertRow {
  id: string;
  tone: "risk" | "erosion" | "opportunity";
  title: string;
  body: string;
}

interface Footprint {
  id: string;
  operator: "you" | "operatorA" | "operatorB";
  path: string;
}

interface NodePoint {
  id: string;
  x: number;
  y: number;
  operator: OperatorKey;
  risk?: boolean;
}

const TAB_ITEMS: Array<{ id: Tab; label: string }> = [
  { id: "market-yield", label: "Market Yield" },
  { id: "territory", label: "Territory" },
  { id: "performance", label: "Performance" },
];

const EXEC_ALERTS: AlertRow[] = [
  {
    id: "alert-risk",
    tone: "risk",
    title: "ALERT",
    body:
      "Operator B's route expansion in Koreatown overlaps 4 of your VIP nodes. Est. $1,250/mo recurring revenue at high risk of churn.",
  },
  {
    id: "alert-erosion",
    tone: "erosion",
    title: "TERRITORY EROSION",
    body:
      "Operator A has increased drop density in Silver Lake by 40% over 14 days while your footprint remained flat.",
  },
  {
    id: "alert-opportunity",
    tone: "opportunity",
    title: "HIGH YIELD OPPORTUNITY",
    body:
      "Mid City shows zero competitive routing. First operator to deploy secures estimated $3.5k/mo baseline demand.",
  },
];

const OPERATOR_ROWS: OperatorRow[] = [
  {
    operator: "Operator A",
    key: "operatorA",
    customerNodes: 24,
    trend: "up",
    trendLabel: "+14%",
    routeYield: "$18,400/mo",
  },
  {
    operator: "Operator B",
    key: "operatorB",
    customerNodes: 17,
    trend: "up",
    trendLabel: "+8%",
    routeYield: "$11,200/mo",
  },
  {
    operator: "Operator C",
    key: "operatorC",
    customerNodes: 11,
    trend: "flat",
    trendLabel: "Flat",
    routeYield: "$8,300/mo",
  },
  {
    operator: "You",
    key: "you",
    customerNodes: 10,
    trend: "down",
    trendLabel: "-3%",
    routeYield: "$6,100/mo",
  },
];

const OPERATOR_COLORS: Record<OperatorKey, string> = {
  you: "#1d8f57",
  operatorA: "#2a69d1",
  operatorB: "#d4a12f",
  operatorC: "#6b7280",
};

const FOOTPRINTS: Footprint[] = [
  {
    id: "you-hollywood",
    operator: "you",
    path: "M120 170 L220 150 L270 195 L245 280 L155 295 L112 232 Z",
  },
  {
    id: "you-silverlake",
    operator: "you",
    path: "M650 165 L760 145 L826 210 L798 304 L688 318 L626 250 Z",
  },
  {
    id: "you-koreatown",
    operator: "you",
    path: "M334 354 L525 336 L606 418 L526 523 L362 528 L278 444 Z",
  },
  {
    id: "opA-losfeliz",
    operator: "operatorA",
    path: "M430 148 L560 122 L630 173 L592 258 L473 268 L408 208 Z",
  },
  {
    id: "opA-echopark",
    operator: "operatorA",
    path: "M575 272 L704 254 L758 322 L712 392 L588 402 L528 340 Z",
  },
  {
    id: "opA-koreatown",
    operator: "operatorA",
    path: "M420 328 L573 309 L654 383 L620 472 L500 486 L396 432 Z",
  },
  {
    id: "opB-centurypark",
    operator: "operatorB",
    path: "M690 409 L894 392 L962 472 L926 562 L732 582 L640 520 Z",
  },
  {
    id: "opB-koreatown",
    operator: "operatorB",
    path: "M478 362 L564 346 L603 392 L578 451 L506 462 L466 411 Z",
  },
];

const MAP_NODES: NodePoint[] = [
  { id: "y1", operator: "you", x: 170, y: 220 },
  { id: "y2", operator: "you", x: 208, y: 240 },
  { id: "y3", operator: "you", x: 232, y: 205 },
  { id: "y4", operator: "you", x: 702, y: 212, risk: true },
  { id: "y5", operator: "you", x: 738, y: 236, risk: true },
  { id: "y6", operator: "you", x: 775, y: 262 },
  { id: "y7", operator: "you", x: 722, y: 286 },
  { id: "y8", operator: "you", x: 336, y: 430 },
  { id: "y9", operator: "you", x: 371, y: 446, risk: true },
  { id: "y10", operator: "you", x: 432, y: 456, risk: true },
  { id: "a1", operator: "operatorA", x: 502, y: 176 },
  { id: "a2", operator: "operatorA", x: 541, y: 196 },
  { id: "a3", operator: "operatorA", x: 579, y: 210 },
  { id: "a4", operator: "operatorA", x: 470, y: 234 },
  { id: "a5", operator: "operatorA", x: 623, y: 340 },
  { id: "a6", operator: "operatorA", x: 658, y: 352 },
  { id: "a7", operator: "operatorA", x: 612, y: 370 },
  { id: "a8", operator: "operatorA", x: 563, y: 336 },
  { id: "a9", operator: "operatorA", x: 452, y: 388 },
  { id: "a10", operator: "operatorA", x: 496, y: 410 },
  { id: "a11", operator: "operatorA", x: 557, y: 430 },
  { id: "a12", operator: "operatorA", x: 620, y: 422 },
  { id: "a13", operator: "operatorA", x: 640, y: 298 },
  { id: "a14", operator: "operatorA", x: 700, y: 336 },
  { id: "b1", operator: "operatorB", x: 734, y: 450 },
  { id: "b2", operator: "operatorB", x: 770, y: 470 },
  { id: "b3", operator: "operatorB", x: 810, y: 465 },
  { id: "b4", operator: "operatorB", x: 850, y: 490 },
  { id: "b5", operator: "operatorB", x: 792, y: 520 },
  { id: "b6", operator: "operatorB", x: 744, y: 535 },
  { id: "b7", operator: "operatorB", x: 882, y: 520 },
  { id: "b8", operator: "operatorB", x: 905, y: 475 },
  { id: "b9", operator: "operatorB", x: 846, y: 545 },
  { id: "b10", operator: "operatorB", x: 533, y: 396 },
  { id: "c1", operator: "operatorC", x: 308, y: 415 },
  { id: "c2", operator: "operatorC", x: 410, y: 370 },
  { id: "c3", operator: "operatorC", x: 688, y: 338 },
  { id: "c4", operator: "operatorC", x: 560, y: 486 },
];

function alertStyles(tone: AlertRow["tone"]) {
  if (tone === "risk") {
    return {
      icon: <AlertTriangle className="h-4 w-4 text-[#b91c1c]" />,
      badgeClass: "text-[#b91c1c]",
      iconWrapClass: "bg-[#fef2f2] border-[#fecaca]",
    };
  }
  if (tone === "erosion") {
    return {
      icon: <TrendingUp className="h-4 w-4 text-[#b45309]" />,
      badgeClass: "text-[#b45309]",
      iconWrapClass: "bg-[#fff7ed] border-[#fed7aa]",
    };
  }
  return {
    icon: <Crosshair className="h-4 w-4 text-[#166534]" />,
    badgeClass: "text-[#166534]",
    iconWrapClass: "bg-[#f0fdf4] border-[#bbf7d0]",
  };
}

function TrendCell({ trend, label }: { trend: OperatorRow["trend"]; label: string }) {
  if (trend === "up") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[13px] text-[#0f766e]">
        {label} <ArrowUpRight className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[13px] text-[#b91c1c]">
        {label} <ArrowDownRight className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[13px] text-[#6b7280]">
      {label} <Minus className="h-3.5 w-3.5" />
    </span>
  );
}

function ExecutiveAlerts() {
  return (
    <section className="space-y-2.5">
      {EXEC_ALERTS.map((alert) => {
        const styles = alertStyles(alert.tone);
        return (
          <div
            key={alert.id}
            className="rounded-sm border border-[#dde2eb] bg-white px-3 py-3.5 shadow-[0_1px_0_0_rgba(17,24,39,0.02)]"
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border ${styles.iconWrapClass}`}
              >
                {styles.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5 text-[#374151]">
                  <span className={`font-semibold tracking-[0.04em] ${styles.badgeClass}`}>
                    {alert.title}:
                  </span>{" "}
                  {alert.body}
                </p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#9ca3af]" />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function TerritoryMapCard() {
  return (
    <section className="mt-3 rounded-sm border border-[#dbe1e9] bg-white">
      <div className="flex items-center justify-between border-b border-[#e5eaf1] px-3 py-2.5">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-[#1f2937] uppercase">
            Territory Comparison Layer
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[#6b7280]">
            Refreshed 09:41 PT
          </p>
        </div>
        <span className="rounded-sm border border-[#e5e7eb] px-2 py-1 font-mono text-[11px] text-[#4b5563]">
          Overlap Risk: 4 Nodes
        </span>
      </div>

      <div className="p-3">
        <div className="relative overflow-hidden rounded-sm border border-[#dbe1e9] bg-[#f4f6fa]">
          <svg
            className="h-auto w-full"
            viewBox="0 0 1000 620"
            role="img"
            aria-label="Los Angeles territory map with operator overlap and customer nodes"
          >
            <rect x="0" y="0" width="1000" height="620" fill="#f3f5f8" />
            <g stroke="#d7dde6" strokeWidth="2" fill="none" opacity="0.8">
              <path d="M0 90 L1000 90" />
              <path d="M0 170 L1000 170" />
              <path d="M0 250 L1000 250" />
              <path d="M0 330 L1000 330" />
              <path d="M0 410 L1000 410" />
              <path d="M0 490 L1000 490" />
              <path d="M130 0 L130 620" />
              <path d="M260 0 L260 620" />
              <path d="M390 0 L390 620" />
              <path d="M520 0 L520 620" />
              <path d="M650 0 L650 620" />
              <path d="M780 0 L780 620" />
              <path d="M910 0 L910 620" />
            </g>
            <g stroke="#cfd6e0" strokeWidth="2" fill="none" opacity="0.7">
              <path d="M40 300 C220 240 350 260 520 310 C690 360 820 350 960 320" />
              <path d="M70 470 C240 430 370 420 540 460 C710 500 850 510 980 480" />
              <path d="M120 120 C300 140 440 130 610 100 C760 70 870 80 960 120" />
            </g>

            {FOOTPRINTS.map((footprint) => {
              const color = OPERATOR_COLORS[footprint.operator];
              return (
                <path
                  key={footprint.id}
                  d={footprint.path}
                  fill={color}
                  fillOpacity="0.10"
                  stroke={color}
                  strokeWidth="2"
                  strokeOpacity="0.75"
                />
              );
            })}

            <g>
              <rect
                x="465"
                y="384"
                width="58"
                height="40"
                rx="6"
                fill="none"
                stroke="#d4a12f"
                strokeWidth="1.5"
                strokeDasharray="5 4"
              />
              <text x="494" y="409" textAnchor="middle" fontFamily="monospace" fontSize="16" fill="#6b7280">
                7
              </text>
              <rect
                x="804"
                y="496"
                width="58"
                height="40"
                rx="6"
                fill="none"
                stroke="#d4a12f"
                strokeWidth="1.5"
                strokeDasharray="5 4"
              />
              <text x="833" y="521" textAnchor="middle" fontFamily="monospace" fontSize="16" fill="#6b7280">
                10
              </text>
            </g>

            {MAP_NODES.map((node) => {
              const color = OPERATOR_COLORS[node.operator];
              return (
                <g key={node.id}>
                  <circle cx={node.x} cy={node.y} r="5.5" fill={color} fillOpacity="0.85" />
                  {node.risk ? (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="8"
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth="1.3"
                      strokeOpacity="0.55"
                    />
                  ) : null}
                </g>
              );
            })}

            <g fontFamily="system-ui, sans-serif" fontSize="12" fill="#374151" letterSpacing="0.06em">
              <text x="138" y="148">HOLLYWOOD</text>
              <text x="440" y="118">LOS FELIZ</text>
              <text x="665" y="160">SILVER LAKE</text>
              <text x="584" y="286">ECHO PARK</text>
              <text x="338" y="335">KOREATOWN</text>
              <text x="722" y="440">CENTURY PARK EAST</text>
            </g>

            <g fontFamily="monospace">
              <rect x="174" y="157" width="34" height="28" rx="8" fill="#ffffff" stroke="#d1d5db" />
              <text x="191" y="176" textAnchor="middle" fontSize="14" fill="#111827">1</text>
              <rect x="500" y="122" width="34" height="28" rx="8" fill="#ffffff" stroke="#d1d5db" />
              <text x="517" y="141" textAnchor="middle" fontSize="14" fill="#111827">3</text>
              <rect x="744" y="177" width="34" height="28" rx="8" fill="#ffffff" stroke="#d1d5db" />
              <text x="761" y="196" textAnchor="middle" fontSize="14" fill="#111827">4</text>
              <rect x="622" y="303" width="34" height="28" rx="8" fill="#ffffff" stroke="#d1d5db" />
              <text x="639" y="322" textAnchor="middle" fontSize="14" fill="#111827">2</text>
              <rect x="394" y="382" width="34" height="28" rx="8" fill="#ffffff" stroke="#d1d5db" />
              <text x="411" y="401" textAnchor="middle" fontSize="14" fill="#111827">7</text>
              <rect x="842" y="512" width="42" height="28" rx="8" fill="#ffffff" stroke="#d1d5db" />
              <text x="863" y="531" textAnchor="middle" fontSize="14" fill="#111827">10</text>
            </g>
          </svg>
        </div>

        <div className="mt-3 grid gap-2 border border-[#e5eaf1] bg-[#fafbfd] p-2.5 text-[12px] text-[#374151] md:grid-cols-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: OPERATOR_COLORS.you }} />
            <span>You</span>
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: OPERATOR_COLORS.operatorA }} />
            <span>Operator A</span>
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: OPERATOR_COLORS.operatorB }} />
            <span>Operator B</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#6b7280]" />
            <span>Customer Node</span>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-[#9ca3af]" />
            <span>Building Foothold</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function OperatorTable() {
  return (
    <section className="mt-3 overflow-hidden rounded-sm border border-[#dbe1e9] bg-white">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#e5eaf1] bg-[#fafbfd] text-left">
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4b5563]">
              Operator
            </th>
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4b5563]">
              Customer Nodes
            </th>
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4b5563]">
              30-Day Trend
            </th>
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4b5563]">
              Est. Route Yield
            </th>
          </tr>
        </thead>
        <tbody>
          {OPERATOR_ROWS.map((row) => (
            <tr
              key={row.operator}
              className={`border-b border-[#eef1f5] last:border-b-0 ${
                row.key === "you" ? "bg-[#f9fafb]" : "bg-white"
              }`}
            >
              <td className="px-3 py-3 text-[14px] text-[#111827]">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: OPERATOR_COLORS[row.key] }}
                  />
                  {row.operator}
                </span>
              </td>
              <td className="px-3 py-3 font-mono text-[14px] text-[#1f2937]">
                {row.customerNodes}
              </td>
              <td className="px-3 py-3">
                <TrendCell trend={row.trend} label={row.trendLabel} />
              </td>
              <td className="px-3 py-3 font-mono text-[14px] text-[#1f2937]">
                {row.routeYield}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TerritoryTab() {
  return (
    <div>
      <ExecutiveAlerts />
      <TerritoryMapCard />
      <OperatorTable />

      <section className="mt-3 rounded-sm border border-[#dbe1e9] bg-white p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1f2937]">
          Revenue Exposure
        </p>
        <p className="mt-1.5 text-[14px] leading-6 text-[#374151]">
          Competitive overlap in Koreatown and Silver Lake is now inside your active customer base.
          Current exposure is concentrated in 4 VIP nodes with projected churn pressure of $1,250/mo.
          Mid City remains the cleanest near-term deployment zone for defensive growth.
        </p>
      </section>
    </div>
  );
}

function MarketYieldTab() {
  return (
    <div className="space-y-3">
      <section className="grid gap-2 md:grid-cols-3">
        <div className="rounded-sm border border-[#dbe1e9] bg-white p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#6b7280]">Addressable Market</p>
          <p className="mt-2 font-mono text-[24px] text-[#111827]">$39,200/mo</p>
        </div>
        <div className="rounded-sm border border-[#dbe1e9] bg-white p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#6b7280]">Captured Yield</p>
          <p className="mt-2 font-mono text-[24px] text-[#111827]">$6,100/mo</p>
        </div>
        <div className="rounded-sm border border-[#dbe1e9] bg-white p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#6b7280]">At-Risk Recurring</p>
          <p className="mt-2 font-mono text-[24px] text-[#b91c1c]">$1,250/mo</p>
        </div>
      </section>

      <section className="rounded-sm border border-[#dbe1e9] bg-white p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1f2937]">
          Competitive Yield Stack
        </p>
        <div className="mt-3 space-y-2.5">
          {OPERATOR_ROWS.map((row) => {
            const numeric = Number(row.routeYield.replace(/[^0-9]/g, ""));
            const width = Math.max(22, Math.round((numeric / 18400) * 100));
            return (
              <div key={row.operator} className="grid grid-cols-[120px_1fr_100px] items-center gap-3">
                <span className="text-[13px] text-[#374151]">{row.operator}</span>
                <div className="h-2.5 w-full bg-[#eef1f5]">
                  <div
                    className="h-full"
                    style={{
                      width: `${width}%`,
                      backgroundColor: OPERATOR_COLORS[row.key],
                    }}
                  />
                </div>
                <span className="text-right font-mono text-[12px] text-[#374151]">{row.routeYield}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PerformanceTab() {
  return (
    <div className="space-y-3">
      <section className="rounded-sm border border-[#dbe1e9] bg-white p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1f2937]">
          Operating Metrics
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="border border-[#e5eaf1] bg-[#fafbfd] p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#6b7280]">Node Retention</p>
            <p className="mt-2 font-mono text-[22px] text-[#111827]">84.1%</p>
          </div>
          <div className="border border-[#e5eaf1] bg-[#fafbfd] p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#6b7280]">On-Time Fulfillment</p>
            <p className="mt-2 font-mono text-[22px] text-[#111827]">92.4%</p>
          </div>
          <div className="border border-[#e5eaf1] bg-[#fafbfd] p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#6b7280]">Churn Pressure</p>
            <p className="mt-2 font-mono text-[22px] text-[#b91c1c]">18.0%</p>
          </div>
        </div>
      </section>

      <section className="rounded-sm border border-[#dbe1e9] bg-white p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1f2937]">
          Defensive Risk Watchlist
        </p>
        <div className="mt-2.5 divide-y divide-[#eef1f5]">
          <div className="grid grid-cols-[1fr_auto] gap-3 py-2.5">
            <p className="text-[14px] text-[#374151]">Koreatown overlap lanes now include your premium service customers.</p>
            <span className="font-mono text-[12px] text-[#b91c1c]">$1,250/mo risk</span>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 py-2.5">
            <p className="text-[14px] text-[#374151]">Silver Lake route density delta remains negative against Operator A growth.</p>
            <span className="font-mono text-[12px] text-[#b91c1c]">-40% relative pace</span>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 py-2.5">
            <p className="text-[14px] text-[#374151]">Mid City launch window still open with low incumbent pressure.</p>
            <span className="font-mono text-[12px] text-[#0f766e]">$3,500/mo upside</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function TerritoryLeaderboard({ onBack }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("territory");

  useEffect(() => {
    sounds.missionAssign();
    haptics.impact();
  }, []);

  return (
    <div className="min-h-screen bg-[#f4f6fa] text-[#111827]">
      <div className="px-4 pb-24 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-start gap-3">
            <button
              onClick={() => {
                sounds.press();
                haptics.tap();
                onBack();
              }}
              className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[#d6dde6] bg-white text-[#4b5563] hover:bg-[#f9fafb]"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-[31px] font-black tracking-[0.02em] leading-none text-[#1f2937] uppercase">
                Operations Board
              </h1>
              <p className="mt-1 font-mono text-[11px] tracking-[0.3em] text-[#6b7280] uppercase">
                Los Angeles • Week 16
              </p>
            </div>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-3 overflow-hidden rounded-sm border border-[#d7dee7] bg-white">
          {TAB_ITEMS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  sounds.press();
                  haptics.tap();
                  setActiveTab(tab.id);
                }}
                className={`border-r border-[#e5eaf1] px-2 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors last:border-r-0 ${
                  active ? "bg-[#f8fafc] text-[#1f3a8a]" : "bg-white text-[#6b7280] hover:text-[#374151]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "territory" ? (
            <motion.div
              key="territory"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <TerritoryTab />
            </motion.div>
          ) : null}

          {activeTab === "market-yield" ? (
            <motion.div
              key="market-yield"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <MarketYieldTab />
            </motion.div>
          ) : null}

          {activeTab === "performance" ? (
            <motion.div
              key="performance"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <PerformanceTab />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
