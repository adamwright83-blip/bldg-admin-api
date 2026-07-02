/**
 * SALESLAY BATTLE CANVAS — a no-engine, demo-only playable slice.
 *
 * Spark the dragon fights The Procrastinator using the same four business
 * actions the real admin performs (email, call, pickup, payment). Plain
 * <canvas> + requestAnimationFrame for the battlefield; a diegetic HTML/CSS
 * HUD (hanging sign, notice board, ledger, wax-seal ability tray, parchment
 * contract, SAGE command console) overlays it. Local game state only — no
 * tRPC, no network, no real side effects. The SAGE console is decorative
 * set-dressing that points at the real Sage composer rendered below on the
 * Kingdom home; it never talks to the backend itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Coins, Flame, Heart, Mail, Package, Phone, ScrollText, Sparkles, Zap } from "lucide-react";
import { ABILITY_CONFIG, FIRE_COOLDOWN_ID, type AbilityId } from "./game/abilities";
import { CANVAS_H, CANVAS_W, SaleslayBattleEngine } from "./game/engine";
import { draw, loadSprites, type SpriteSet } from "./game/renderer";
import type { BattleSnapshot, LogEntry } from "./game/types";
import "./SaleslayBattleCanvas.css";

function usd(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${cents < 0 ? "-" : ""}$${s}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

/** Scrolls to (and lightly flags) the real Sage composer below the board,
 * and fires a reserved hook event the ComposerPanel can opt into later to
 * prefill a question. The game layer never talks to tRPC itself. */
function pingRealSage(prompt: string) {
  document.querySelector(".ops-kingdom-composer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.dispatchEvent(new CustomEvent("saleslay:ask-sage", { detail: { prompt } }));
}

const ABILITY_ICONS: Record<AbilityId, typeof Mail> = {
  email: Mail,
  call: Phone,
  pickup: Package,
  collect: Coins,
};

const QUICK_MOVES = ["Draft follow-up", "Handle objection", "Win-back customer"];

export function SaleslayBattleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SaleslayBattleEngine | null>(null);
  const spritesRef = useRef<SpriteSet>({});
  if (!engineRef.current) engineRef.current = new SaleslayBattleEngine();

  const [snapshot, setSnapshot] = useState<BattleSnapshot>(() => engineRef.current!.getSnapshot());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [cooldownTick, setCooldownTick] = useState(0);
  const [villainDefeated, setVillainDefeated] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [frontierPct, setFrontierPct] = useState(50);
  const [contractComplete, setContractComplete] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  // Sprite loading (no-op fallback handled by renderer).
  useEffect(() => {
    spritesRef.current = loadSprites();
  }, []);

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    ctx.scale(dpr, dpr);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      engineRef.current!.update(dt);
      draw(ctx, engineRef.current!.getState(), spritesRef.current);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  // HUD sync — read the mutable engine state on an interval, not per frame.
  useEffect(() => {
    const id = window.setInterval(() => {
      const engine = engineRef.current!;
      const state = engine.getState();
      setSnapshot(engine.getSnapshot());
      setLog(state.log);
      setVillainDefeated(state.villainDefeated);
      setBanner(state.banner?.text ?? null);
      setFrontierPct(state.frontierPct);
      setContractComplete(state.contractComplete);
      setCooldownTick((t) => t + 1);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  // Keyboard controls.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const engine = engineRef.current!;
      if (e.code === "Space") {
        e.preventDefault();
        engine.fireBasic();
        setPressedKey(FIRE_COOLDOWN_ID);
        window.setTimeout(() => setPressedKey(null), 140);
        return;
      }
      const ability = ABILITY_CONFIG.find((a) => a.key === e.key);
      if (ability) {
        engine.useAbility(ability.id);
        setPressedKey(ability.id);
        window.setTimeout(() => setPressedKey(null), 140);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleAbilityClick = (id: AbilityId) => engineRef.current!.useAbility(id);
  const handleFireClick = () => engineRef.current!.fireBasic();

  const contractPct = Math.min(
    100,
    (snapshot.dailyContractProgressCents / snapshot.dailyContractTargetCents) * 100
  );

  const hearts = useMemo(() => {
    const filled = Math.round((snapshot.dragonHp / 100) * 5);
    return Array.from({ length: 5 }, (_, i) => i < filled);
  }, [snapshot.dragonHp]);
  const bolts = useMemo(() => {
    const filled = Math.round((snapshot.dragonEnergy / 100) * 5);
    return Array.from({ length: 5 }, (_, i) => i < filled);
  }, [snapshot.dragonEnergy]);

  const lowHp = snapshot.dragonHp < 40;

  return (
    <div className="slb-root">
      <div className="slb-board-row">
        {/* SAGE COMMAND — physical console, points at the real composer below. Decorative only. */}
        <div className="slb-sage">
          <div className="slb-sage-lantern" aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <div className="slb-sage-plaque">
            <span className="slb-sage-title">Sage command</span>
            <span className="slb-sage-sub">Sales + revenue co-pilot</span>
          </div>

          <div className="slb-sage-card">
            <span className="slb-sage-card-label">Revenue scan</span>
            <span className="slb-sage-card-hint">Gross revenue · Last 30 days</span>
            <b className="slb-sage-card-value">{usd(snapshot.trueNetCents)}</b>
          </div>

          <div className="slb-sage-card">
            <span className="slb-sage-card-label">Call edge</span>
            <span className="slb-sage-card-hint">Lead with convenience, then price.</span>
          </div>

          <div className="slb-sage-card">
            <span className="slb-sage-card-label">Quick moves</span>
            <div className="slb-sage-moves">
              {QUICK_MOVES.map((move) => (
                <button key={move} type="button" className="slb-sage-move-btn" onClick={() => pingRealSage(move)}>
                  {move}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="slb-sage-ask-btn" onClick={() => pingRealSage("")}>
            Ask Sage&hellip;
          </button>
        </div>

        <div className="slb-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="slb-canvas"
            style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
          />

          {/* HUD overlay — every block is a physical object in Spark's world. */}
          <div className="slb-hud">
            {/* Hanging True Net sign */}
            <div className="slb-truenet-ropes" aria-hidden="true" />
            <div className="slb-sign slb-sign--truenet">
              <span className="slb-sign-label">True net</span>
              <b className="slb-sign-value">{usd(snapshot.trueNetCents)}</b>
            </div>
            <div className="slb-sign slb-sign--gain">
              <span className="slb-sign-gain">+{usd(snapshot.todayGainCents)} today</span>
            </div>

            {/* Kingdom beam meter — chunky, high-contrast, readable at a glance */}
            <div className="slb-beam">
              <div className="slb-beam-medallion slb-beam-medallion--lantern" aria-hidden="true">
                <Flame size={14} />
              </div>
              <div className="slb-beam-track">
                <div className="slb-beam-fill-spark" style={{ width: `${frontierPct}%` }} />
                <div className="slb-beam-fill-fog" style={{ width: `${100 - frontierPct}%` }} />
                <div className="slb-beam-knot" style={{ left: `${frontierPct}%` }} />
              </div>
              <div className="slb-beam-medallion slb-beam-medallion--clock" aria-hidden="true">
                <ScrollText size={14} />
              </div>
            </div>
            <div className="slb-beam-labels">
              <span className="slb-beam-label slb-beam-label--spark">Spark's realm {Math.round(frontierPct)}%</span>
              <span className="slb-beam-label slb-beam-label--fog">{Math.round(100 - frontierPct)}% the procrastinator</span>
            </div>

            {/* Notice board — wanted posters for the three blockers */}
            <div className="slb-noticeboard">
              <div className="slb-poster" style={{ transform: "rotate(-2deg)" }}>
                <div className={`slb-wax ${snapshot.blockers.overdueReturns === 0 ? "is-clear" : ""}`}>
                  {snapshot.blockers.overdueReturns}
                </div>
                <span>Overdue returns</span>
              </div>
              <div className="slb-poster" style={{ transform: "rotate(1.5deg)" }}>
                <div className={`slb-wax ${snapshot.blockers.failedPayments === 0 ? "is-clear" : ""}`}>
                  {snapshot.blockers.failedPayments}
                </div>
                <span>Failed payments</span>
              </div>
              <div className="slb-poster" style={{ transform: "rotate(-1deg)" }}>
                <div className={`slb-wax ${snapshot.blockers.blockedOrders === 0 ? "is-clear" : ""}`}>
                  {snapshot.blockers.blockedOrders}
                </div>
                <span>Blocked orders</span>
              </div>
            </div>

            {/* Spark plaque */}
            <div className="slb-plaque">
              <div className="slb-plaque-head">
                <span className="slb-plaque-title">Spark · Lv 4</span>
                <span className="slb-xp-pill">
                  <Coins size={11} aria-hidden="true" /> {snapshot.xp.toLocaleString("en-US")} XP
                </span>
              </div>
              <div className={`slb-pips slb-pips--hp ${lowHp ? "is-pulsing" : ""}`}>
                {hearts.map((on, i) => (
                  <Heart key={i} size={15} className={on ? "is-on" : "is-off"} aria-hidden="true" />
                ))}
              </div>
              <div className="slb-pips slb-pips--energy">
                {bolts.map((on, i) => (
                  <Zap key={i} size={15} className={on ? "is-on" : "is-off"} aria-hidden="true" />
                ))}
              </div>
            </div>

            {/* Open ledger battle log */}
            <div className="slb-ledger" aria-live="polite">
              <div className="slb-ledger-page slb-ledger-page--left">
                <span className="slb-ledger-title">Battle log</span>
                {log.slice(0, 2).map((entry) => (
                  <p key={entry.id} className="slb-ledger-line">{entry.text}</p>
                ))}
              </div>
              <div className="slb-ledger-page slb-ledger-page--right">
                {log.slice(2, 5).map((entry) => (
                  <p key={entry.id} className="slb-ledger-line">{entry.text}</p>
                ))}
              </div>
            </div>

            {banner ? <div className="slb-banner-toast">{banner}</div> : null}

            {/* Wax-seal ability tray */}
            <div className="slb-tray">
              <TrayButton
                label="Fire"
                shortcut="SPACE"
                icon={<Flame size={14} />}
                sealClass="seal-fire"
                engineRef={engineRef}
                cooldownId={FIRE_COOLDOWN_ID}
                tick={cooldownTick}
                pressed={pressedKey === FIRE_COOLDOWN_ID}
                onClick={handleFireClick}
              />
              {ABILITY_CONFIG.map((ability) => {
                const Icon = ABILITY_ICONS[ability.id];
                return (
                  <TrayButton
                    key={ability.id}
                    label={ability.label}
                    shortcut={ability.key}
                    icon={<Icon size={14} />}
                    sealClass={`seal-${ability.id}`}
                    engineRef={engineRef}
                    cooldownId={ability.id}
                    tick={cooldownTick}
                    disabled={villainDefeated}
                    pressed={pressedKey === ability.id}
                    onClick={() => handleAbilityClick(ability.id)}
                  />
                );
              })}
            </div>

            {/* Pinned parchment Daily Contract */}
            <div className="slb-contract">
              <div className="slb-contract-nail" aria-hidden="true" />
              <span className="slb-contract-label">Daily contract</span>
              <b className="slb-contract-title">Earn $3,000</b>
              <div className="slb-contract-line">
                <div className="slb-contract-ink" style={{ width: `${contractPct}%` }} />
              </div>
              <span className="slb-contract-value">
                {usd(snapshot.dailyContractProgressCents)} / {usd(snapshot.dailyContractTargetCents)}
              </span>
              {contractComplete ? <div className="slb-contract-seal" aria-hidden="true" /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrayButton({
  label,
  shortcut,
  icon,
  sealClass,
  engineRef,
  cooldownId,
  tick,
  disabled,
  pressed,
  onClick,
}: {
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  sealClass: string;
  engineRef: React.MutableRefObject<SaleslayBattleEngine | null>;
  cooldownId: string;
  tick: number;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  const engine = engineRef.current;
  const remaining = engine?.getCooldownRemaining(cooldownId) ?? 0;
  const duration = engine?.getCooldownDuration(cooldownId) ?? 1;
  const pct = duration > 0 ? Math.min(100, (remaining / duration) * 100) : 0;
  const secondsLeft = Math.ceil(remaining / 1000);
  void tick; // force re-render on the HUD sync interval

  return (
    <button
      type="button"
      className={`slb-tray-btn ${pressed ? "is-pressed" : ""}`}
      disabled={disabled || remaining > 0}
      onClick={onClick}
    >
      <span className={`slb-seal ${sealClass}`} aria-hidden="true">
        {icon}
      </span>
      {pct > 0 ? (
        <span
          className="slb-tray-cooldown"
          style={{ background: `conic-gradient(rgba(20,14,10,0.78) ${pct}%, transparent ${pct}%)` }}
        >
          <span className="slb-tray-cooldown-num">{secondsLeft}</span>
        </span>
      ) : null}
      <span className="slb-tray-label">{label}</span>
      <span className="slb-tray-key">{shortcut}</span>
    </button>
  );
}
