/**
 * SALESLAY BATTLE CANVAS — a no-engine, demo-only playable slice.
 *
 * Spark the dragon fights The Procrastinator using the same four business
 * actions the real admin performs (email, call, pickup, payment). Plain
 * <canvas> + requestAnimationFrame for the battlefield; HTML/CSS overlay for
 * the HUD. Local game state only — no tRPC, no network, no real side effects.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
      setSnapshot(engine.getSnapshot());
      setLog(engine.getState().log);
      setVillainDefeated(engine.getState().villainDefeated);
      setBanner(engine.getState().banner?.text ?? null);
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
        return;
      }
      const ability = ABILITY_CONFIG.find((a) => a.key === e.key);
      if (ability) engine.useAbility(ability.id);
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
  const kingdomPct = useMemo(() => {
    const total = (100 - snapshot.villainHp) + (100 - snapshot.dragonHp) || 1;
    return Math.round(((100 - snapshot.villainHp) / total) * 100);
  }, [snapshot.villainHp, snapshot.dragonHp]);

  return (
    <div className="slb-root">
      <div className="slb-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="slb-canvas"
          style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
        />

        {/* HUD overlay */}
        <div className="slb-hud">
          <div className="slb-panel slb-panel--truenet">
            <span className="slb-label">True Net</span>
            <b className="slb-value">{usd(snapshot.trueNetCents)}</b>
            <span className="slb-gain">+{usd(snapshot.todayGainCents)} today</span>
          </div>

          <div className="slb-panel slb-panel--meter">
            <div className="slb-meter-labels">
              <span>Your Kingdom</span>
              <span>The Procrastinator</span>
            </div>
            <div className="slb-meter-bar">
              <div className="slb-meter-fill" style={{ width: `${kingdomPct}%` }} />
            </div>
          </div>

          <div className="slb-panel slb-panel--blockers">
            <div className="slb-blocker"><b>{snapshot.blockers.overdueReturns}</b><span>Overdue Returns</span></div>
            <div className="slb-blocker"><b>{snapshot.blockers.failedPayments}</b><span>Failed Payments</span></div>
            <div className="slb-blocker"><b>{snapshot.blockers.blockedOrders}</b><span>Blocked Orders</span></div>
          </div>

          <div className="slb-panel slb-panel--dragon">
            <div className="slb-dragon-head">
              <span className="slb-label">Spark · Level 4</span>
              <span className="slb-xp-badge">{snapshot.xp.toLocaleString("en-US")} XP</span>
            </div>
            <div className="slb-stat-bar slb-stat-bar--hp">
              <div className="slb-stat-fill" style={{ width: `${snapshot.dragonHp}%` }} />
              <span>{Math.round(snapshot.dragonHp)}/100 HP</span>
            </div>
            <div className="slb-stat-bar slb-stat-bar--energy">
              <div className="slb-stat-fill" style={{ width: `${snapshot.dragonEnergy}%` }} />
              <span>{Math.round(snapshot.dragonEnergy)}/100 Energy</span>
            </div>
          </div>

          <div className="slb-panel slb-panel--contract">
            <span className="slb-label">Daily Contract — Earn $3,000</span>
            <div className="slb-stat-bar slb-stat-bar--contract">
              <div className="slb-stat-fill" style={{ width: `${contractPct}%` }} />
              <span>
                {usd(snapshot.dailyContractProgressCents)} / {usd(snapshot.dailyContractTargetCents)}
              </span>
            </div>
          </div>

          <div className="slb-panel slb-panel--log" aria-live="polite">
            <span className="slb-label">Battle Log</span>
            <ul>
              {log.map((entry) => (
                <li key={entry.id}>{entry.text}</li>
              ))}
            </ul>
          </div>

          {banner ? <div className="slb-banner-toast">{banner}</div> : null}

          <div className="slb-actionbar">
            <CooldownButton
              label="Fire"
              shortcut="SPACE"
              engineRef={engineRef}
              cooldownId={FIRE_COOLDOWN_ID}
              tick={cooldownTick}
              onClick={handleFireClick}
            />
            {ABILITY_CONFIG.map((ability) => (
              <CooldownButton
                key={ability.id}
                label={ability.label}
                shortcut={ability.key}
                engineRef={engineRef}
                cooldownId={ability.id}
                tick={cooldownTick}
                disabled={villainDefeated}
                onClick={() => handleAbilityClick(ability.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CooldownButton({
  label,
  shortcut,
  engineRef,
  cooldownId,
  tick,
  disabled,
  onClick,
}: {
  label: string;
  shortcut: string;
  engineRef: React.MutableRefObject<SaleslayBattleEngine | null>;
  cooldownId: string;
  tick: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  const engine = engineRef.current;
  const remaining = engine?.getCooldownRemaining(cooldownId) ?? 0;
  const duration = engine?.getCooldownDuration(cooldownId) ?? 1;
  const pct = duration > 0 ? Math.min(100, (remaining / duration) * 100) : 0;
  void tick; // force re-render on the HUD sync interval

  return (
    <button
      type="button"
      className="slb-action-btn"
      disabled={disabled || remaining > 0}
      onClick={onClick}
    >
      <span className="slb-action-cooldown" style={{ height: `${pct}%` }} />
      <span className="slb-action-label">{label}</span>
      <span className="slb-action-key">{shortcut}</span>
    </button>
  );
}
