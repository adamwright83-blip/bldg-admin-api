/**
 * SPARK & THE FIFTY LANTERNS — the Board's living world.
 *
 * A floating kingdom under The Procrastinator's drowsy curse. Real work is
 * the only magic that wakes it:
 *
 *  - THE LANTERN PATH: one lantern per acquired customer (campaign target,
 *    default 50). Wins ignite lanterns PERMANENTLY — the kingdom remembers.
 *  - SPARK, a pudgy baby dragon, glides along the path at the altitude the
 *    active metric sets (campaign progress, or profit vs the operator's own
 *    bars). Wins make him celebrate; deep-curse days he naps in his nest —
 *    cozy, never shamed.
 *  - COTTAGES wake (dark → glowing) as the campaign crosses milestones.
 *  - THE CURSE: drowsy vines + villains scale with REAL operational debt
 *    (Level 4 gate lanes — stuck intake, overdue follow-ups). Clearing work
 *    retracts them. The Time-Eater stalks the next unlit lantern; The
 *    Collector of Tomorrows hoards unopened scrolls when debt piles up.
 *    Clicking a villain routes to the war (/level4) to fight back.
 *  - THE STONE TABLET carries the true-net number INSIDE the world (bonded
 *    to its graphic — misalignment is structurally impossible).
 *  - FOUR RUNESTONES = Mission Control. Lighting one fires a real war event.
 *    All four lit → a beam of light toward the path (power-up state).
 *  - THE ENCHANTED SCROLL unrolls the full P&L on tap (the math never
 *    shouts, but it's one tap away).
 *
 * Binding contract: nothing here animates without a real business event
 * (ambient idle breathing excepted). One state, many views — this is the
 * same data that powers LIVE, the cockpit (kept as a sellable add-on), and
 * the Level 4 war.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCommandSky } from "./CommandSky";
import "./CommandLanternKingdom.css";

const A = "/assets/kingdom";

type Pt = { x: number; y: number };

/** Quadratic bezier from the nest (bottom-left) to the castle (top-right). */
const P0: Pt = { x: 10, y: 78 };
const PC: Pt = { x: 40, y: 26 };
const P2: Pt = { x: 84, y: 22 };

function pathPoint(t: number): Pt {
  const u = Math.max(0, Math.min(1, t));
  const v = 1 - u;
  return {
    x: v * v * P0.x + 2 * v * u * PC.x + u * u * P2.x,
    y: v * v * P0.y + 2 * v * u * PC.y + u * u * P2.y,
  };
}

function usd(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const s =
    abs >= 1000
      ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : abs.toFixed(2);
  return `${cents < 0 ? "-" : ""}$${s}`;
}

const MISSIONS = [
  { id: "post-flyers", title: "Post 40 flyers", hint: "lobby blitz" },
  { id: "call-past", title: "Call 10 past customers", hint: "friendly check-in" },
  { id: "push-orders", title: "Push 3 orders over $45", hint: "today" },
  { id: "ask-referral", title: "Ask 1 VIP for an intro", hint: "one ask" },
] as const;

export function CommandLanternKingdom({ onNavigate }: { onNavigate: (path: string) => void }) {
  const utils = trpc.useUtils();
  const sky = useCommandSky();
  const war = trpc.admin.getLevel4WarState.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const pnl = trpc.admin.truePnlCockpitSummary.useQuery(
    { period: "today" },
    { refetchInterval: 120_000 }
  );
  const recordWar = trpc.admin.recordLevel4WarAction.useMutation({
    onSuccess: () => void utils.admin.getLevel4WarState.invalidate(),
  });

  const skyData = sky.data;
  const tone = skyData?.tone ?? "overcast";
  const brightness = skyData?.brightness ?? 0.4;
  const hope = skyData?.hope ?? null;
  const campaign = skyData?.campaign;
  const target = Math.max(1, campaign?.target ?? 50);
  const litCount = Math.min(target, campaign?.count ?? 0);
  const mode = skyData?.settings.mode ?? "campaign";

  // Spark's place on the path: campaign progress, or profit brightness.
  const sparkT = mode === "campaign" ? litCount / target : brightness;

  // Operational debt → curse density (0 none, 1 sparse, 2+ dense).
  const debt = war.data?.projectiles?.length ?? 0;

  // Celebration window after a NEW win lands (count increased) or a
  // runestone lights. Pure consequence of real events.
  const [celebrateUntil, setCelebrateUntil] = useState(0);
  const prevLitRef = useRef(litCount);
  useEffect(() => {
    if (litCount > prevLitRef.current) {
      setCelebrateUntil(Date.now() + 2_800);
    }
    prevLitRef.current = litCount;
  }, [litCount]);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (celebrateUntil <= Date.now()) return;
    const t = window.setTimeout(() => forceTick((n) => n + 1), celebrateUntil - Date.now() + 50);
    return () => window.clearTimeout(t);
  }, [celebrateUntil]);
  const celebrating = celebrateUntil > Date.now();

  // Deep curse: red/storm tone with no hope window → Spark naps in the nest.
  const napping = !celebrating && !hope && (tone === "red" || tone === "storm");

  const sparkPos = pathPoint(napping ? 0.02 : sparkT);
  const sparkSrc = celebrating
    ? `${A}/spark-celebrating.png`
    : napping
      ? `${A}/spark-sleeping.png`
      : `${A}/spark-gliding.png`;

  // Lanterns: cap the rendered count at 50 (each bead may represent >1 when
  // the target exceeds 50, exactly like the covenant beads).
  const lanternCount = Math.min(50, target);
  const perLantern = target / lanternCount;
  const lanterns = useMemo(
    () =>
      Array.from({ length: lanternCount }, (_, i) => {
        const t = (i + 0.5) / lanternCount;
        return { ...pathPoint(t), lit: (i + 1) * perLantern <= litCount, key: i };
      }),
    [lanternCount, perLantern, litCount]
  );
  const nextUnlit = lanterns.find((l) => !l.lit);

  // Runestones (local check state; war events are the real record).
  const [litStones, setLitStones] = useState<Set<string>>(new Set());
  const allStonesLit = litStones.size === MISSIONS.length;
  const lightStone = (m: (typeof MISSIONS)[number]) => {
    if (litStones.has(m.id)) return;
    setLitStones((prev) => new Set(prev).add(m.id));
    setCelebrateUntil(Date.now() + 2_200);
    const day = new Date().toISOString().slice(0, 10);
    recordWar.mutate({
      kind: "task_check",
      dedupeKey: `kingdom:${day}:${m.id}`,
      meta: { source: "lantern_kingdom", mission: m.title },
    });
    toast.success(`Runestone lit: ${m.title}`);
  };

  // The enchanted scroll (P&L) overlay.
  const [scrollOpen, setScrollOpen] = useState(false);
  const net = pnl.data?.trueNetCents ?? 0;

  // Cottage milestones wake at 20% / 55% / 85% of the campaign.
  const pct = litCount / target;
  const cottages = [
    { t: 0.3, awake: pct >= 0.2, dx: -3, dy: 9, scale: 0.92 },
    { t: 0.58, awake: pct >= 0.55, dx: 4, dy: 10, scale: 1 },
    { t: 0.82, awake: pct >= 0.85, dx: -2, dy: 12, scale: 0.85 },
  ];

  return (
    <section className={`lk lk--${tone} ${hope ? "lk--hope" : ""}`} aria-label="Spark and the Fifty Lanterns — your kingdom">
      {/* SKY + far kingdom plate (masked painterly backdrop) */}
      <div className="lk__sky" />
      <img className="lk__far" src={`${A}/kingdom-far.png`} alt="" draggable={false} />
      {debt > 0 ? (
        <img
          className={`lk__cursecloud ${debt >= 2 ? "is-heavy" : ""}`}
          src={`${A}/curse-cloud.png`}
          alt=""
          draggable={false}
        />
      ) : null}

      {/* Castle at the summit */}
      <img className="lk__castle" src={`${A}/castle-clouds.png`} alt="" draggable={false} />

      {/* The lantern path */}
      <svg className="lk__pathline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path
          d={`M ${P0.x} ${P0.y} Q ${PC.x} ${PC.y} ${P2.x} ${P2.y}`}
          fill="none"
          stroke="rgba(255,220,140,0.35)"
          strokeWidth="0.6"
          strokeDasharray="1.6 1.6"
        />
      </svg>
      {lanterns.map((l) => (
        <img
          key={l.key}
          className={`lk__lantern ${l.lit ? "is-lit" : ""}`}
          src={l.lit ? `${A}/lantern-lit.png` : `${A}/lantern-unlit.png`}
          style={{ left: `${l.x}%`, top: `${l.y}%` }}
          alt=""
          draggable={false}
        />
      ))}

      {/* Cottage islands — wake with milestones */}
      {cottages.map((c, i) => {
        const p = pathPoint(c.t);
        return (
          <span
            key={i}
            className="lk__island"
            style={{ left: `${p.x + c.dx}%`, top: `${p.y + c.dy}%`, transform: `translate(-50%,-20%) scale(${c.scale})` }}
          >
            <img src={`${A}/island-cottage-dark.png`} alt="" draggable={false} className={c.awake ? "is-hidden" : ""} />
            <img src={`${A}/island-cottage-awake.png`} alt="" draggable={false} className={c.awake ? "" : "is-hidden"} />
          </span>
        );
      })}

      {/* THE CURSE — vines + villains scale with real operational debt */}
      {debt > 0 ? (
        <img
          className="lk__vines"
          src={debt >= 2 ? `${A}/vines-dense.png` : `${A}/vines-sparse.png`}
          alt=""
          draggable={false}
        />
      ) : null}
      {debt >= 1 && nextUnlit ? (
        <button
          type="button"
          className="lk__villain lk__villain--eater"
          style={{ left: `${Math.min(92, nextUnlit.x + 7)}%`, top: `${nextUnlit.y + 6}%` }}
          onClick={() => onNavigate("/level4")}
          aria-label="The Time-Eater stalks your next lantern — open the war to fight back"
          title="The Time-Eater is eyeing your next lantern. Fight back →"
        >
          <img src={`${A}/time-eater.png`} alt="" draggable={false} />
        </button>
      ) : null}
      {debt >= 2 ? (
        <button
          type="button"
          className="lk__villain lk__villain--collector"
          onClick={() => onNavigate("/level4")}
          aria-label="The Collector of Tomorrows hoards your unfinished work — open the war"
          title="The Collector of Tomorrows is hoarding unfinished scrolls. Fight back →"
        >
          <img src={`${A}/collector-tomorrows.png`} alt="" draggable={false} />
        </button>
      ) : null}

      {/* Nest + Spark */}
      <img className="lk__nest" src={`${A}/nest-ember.png`} alt="" draggable={false} />
      <div
        className={`lk__spark ${celebrating ? "is-celebrating" : ""} ${napping ? "is-napping" : ""}`}
        style={{ left: `${sparkPos.x}%`, top: `${sparkPos.y - 6}%` }}
      >
        <img src={sparkSrc} alt="" draggable={false} />
      </div>

      {/* Power-up beam when all four runestones are lit */}
      {allStonesLit ? <div className="lk__beam" aria-hidden /> : null}

      {/* STONE TABLET — the number lives inside the world */}
      <button
        type="button"
        className="lk__tablet"
        onClick={() => onNavigate("/pnl")}
        aria-label={`True net today ${usd(net)} — open the full cockpit`}
      >
        <img src={`${A}/stone-tablet.png`} alt="" draggable={false} />
        <span className={`lk__tablet-face ${net < 0 ? "is-down" : "is-up"}`}>
          <i>TRUE NET</i>
          <b>{pnl.isLoading ? "…" : usd(net)}</b>
          <i>today</i>
        </span>
      </button>

      {/* RUNESTONES — Mission Control on the kingdom floor */}
      <div className="lk__stones" role="group" aria-label="Today's four runestones">
        {MISSIONS.map((m) => {
          const lit = litStones.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              className={`lk__stone ${lit ? "is-lit" : ""}`}
              disabled={recordWar.isPending && !lit}
              onClick={() => lightStone(m)}
              aria-pressed={lit}
            >
              <img src={`${A}/runestone.png`} alt="" draggable={false} />
              <span className="lk__stone-rune" aria-hidden>{lit ? "✦" : "·"}</span>
              <span className="lk__stone-label">
                <b>{m.title}</b>
                <i>{lit ? "lit" : m.hint}</i>
              </span>
            </button>
          );
        })}
      </div>

      {/* THE ENCHANTED SCROLL — the math, one tap away */}
      <button
        type="button"
        className="lk__scrollbtn"
        onClick={() => setScrollOpen((v) => !v)}
        aria-expanded={scrollOpen}
        aria-label={scrollOpen ? "Roll the scroll closed" : "Unroll the scroll — show me the math"}
      >
        <img src={`${A}/scroll.png`} alt="" draggable={false} />
        <span>{scrollOpen ? "roll it up" : "the math"}</span>
      </button>
      {scrollOpen ? (
        <div className="lk__scrollpanel" role="dialog" aria-label="True P&L breakdown">
          <table>
            <tbody>
              {(pnl.data?.lines ?? []).map((line) => (
                <tr key={line.key}>
                  <td>{line.label}</td>
                  <td className={line.amountCents < 0 ? "is-down" : ""}>{usd(line.amountCents)}</td>
                </tr>
              ))}
              <tr className="lk__scrolltotal">
                <td>True net</td>
                <td className={net < 0 ? "is-down" : "is-up"}>{usd(net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Whisper line — why the sky looks like this (no numbers needed) */}
      <p className="lk__whisper">{skyData?.reason ?? "The kingdom is waking…"}</p>
    </section>
  );
}
