/**
 * SALESLAY BATTLE CANVAS — a no-engine, demo-only playable slice.
 *
 * Spark the dragon fights The Procrastinator using the same four business
 * actions the real admin performs (email, call, pickup, payment), shown as
 * sales-move fantasy labels. Plain <canvas> + requestAnimationFrame for the
 * battlefield; a diegetic HTML/CSS HUD overlays it — hanging sign, Kingdom
 * Influence beam, notice board, ledger, carved-token ability tray, pinned
 * contract — and SAGE stands in-world at the lower-left edge of the board,
 * not in a sidebar. Local game state only — no tRPC, no network, no real
 * side effects. SAGE never mounts its own composer: activating it calls
 * back to the parent, which summons the real, already-mounted ComposerPanel.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Coins, Flame, Heart, Mail, Package, Phone, Sparkles, Zap } from "lucide-react";
import { ABILITY_CONFIG, FIRE_COOLDOWN_ID, FIRE_FLAVOR_NAME, type AbilityId } from "./game/abilities";
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

const ABILITY_ICONS: Record<AbilityId, typeof Mail> = {
  email: Mail,
  call: Phone,
  pickup: Package,
  collect: Coins,
};

const NARROW_FILL_PCT = 12;

/** Major HUD art — each loads independently; a missing/failed file just
 * never sets its key, and CSS keeps the existing fallback for that one
 * element only. No all-or-nothing dependency between assets. Small UI
 * assets (ability tokens/icons, pips, blocker counters, contract clasp,
 * Auto/Retreat bases) are intentionally NOT in this manifest yet — they
 * stay on their CSS fallback until delivered. */
const HUD_ART_FILES = {
  signTruenet: "/assets/saleslay/hud/sign_truenet.png",
  meterFrame: "/assets/saleslay/hud/meter_frame.png",
  meterKnot: "/assets/saleslay/hud/meter_knot.png",
  boardBlockers: "/assets/saleslay/hud/board_blockers.png",
  sageCtaFrame: "/assets/saleslay/hud/sage_cta_frame.png",
  sageIdle: "/assets/saleslay/sage_idle.png",
  sageAwakened: "/assets/saleslay/sage_awakened.png",
} as const;
type HudArtKey = keyof typeof HUD_ART_FILES;

function useHudArt(): Partial<Record<HudArtKey, boolean>> {
  const [loaded, setLoaded] = useState<Partial<Record<HudArtKey, boolean>>>({});
  useEffect(() => {
    let active = true;
    (Object.keys(HUD_ART_FILES) as HudArtKey[]).forEach((key) => {
      const img = new Image();
      img.onload = () => {
        if (active) setLoaded((prev) => ({ ...prev, [key]: true }));
      };
      img.src = HUD_ART_FILES[key];
    });
    return () => {
      active = false;
    };
  }, []);
  return loaded;
}

type SaleslayBattleCanvasProps = {
  /** True while the real Sage composer is summoned in an overlay above the
   * board (owned by the parent). The battle pauses and keyboard input is
   * disabled while true — never mutated locally. */
  sageOpen?: boolean;
  /** Called when the player activates Ask Sage. The game never opens the
   * composer itself — it only asks the parent to. */
  onAskSage?: () => void;
  /** True while the parent-owned "Fulfill the Promise" order picker is
   * open. Same pause/keyboard-disable treatment as sageOpen — the game
   * never queries or mutates orders itself; it only asks the parent to
   * open the picker via onOpenPickupPicker. */
  pickupPickerOpen?: boolean;
  /** Called when the player activates Fulfill the Promise (button or key).
   * Never fires a shot or mutates anything directly — real completion
   * comes back through the imperative handle below once the parent's own
   * tRPC mutation confirms success or failure. */
  onOpenPickupPicker?: () => void;
};

/** Imperative surface the parent uses to report a real weapon action's
 * outcome back into the engine it owns internally. The game stays
 * tRPC-free (see file header); OpsBoardHome performs the actual
 * admin.updateStatus mutation and calls these once it resolves. */
export type SaleslayBattleCanvasHandle = {
  completeWeaponAction: (id: AbilityId) => void;
  failWeaponAction: (id: AbilityId, reason?: string) => void;
};

export const SaleslayBattleCanvas = forwardRef<SaleslayBattleCanvasHandle, SaleslayBattleCanvasProps>(
  function SaleslayBattleCanvas(
    { sageOpen = false, onAskSage, pickupPickerOpen = false, onOpenPickupPicker },
    ref
  ) {
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
  const [autoMode, setAutoModeState] = useState(false);
  const hudArt = useHudArt();

  // Pause the simulation (not a reset) while Sage is summoned OR the pickup
  // picker is open — engine time itself freezes, so cooldowns/Auto timers
  // don't jump on close.
  useEffect(() => {
    engineRef.current!.setPaused(sageOpen || pickupPickerOpen);
  }, [sageOpen, pickupPickerOpen]);

  // Imperative surface for the parent's real-action outcome (see
  // SaleslayBattleCanvasHandle above).
  useImperativeHandle(
    ref,
    () => ({
      completeWeaponAction: (id: AbilityId) => engineRef.current?.completeWeaponAction(id),
      failWeaponAction: (id: AbilityId, reason?: string) => engineRef.current?.failWeaponAction(id, reason),
    }),
    []
  );

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
      setAutoModeState(state.autoMode);
      setCooldownTick((t) => t + 1);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  // Keyboard controls — hard-disabled while Sage is summoned, in addition to
  // the isTypingTarget guard (which only protects against typing elsewhere).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (sageOpen || pickupPickerOpen) return;
      if (isTypingTarget(e.target)) return;
      const engine = engineRef.current!;
      if (e.code === "Space") {
        e.preventDefault();
        engine.startWeaponAction("fire");
        setPressedKey(FIRE_COOLDOWN_ID);
        window.setTimeout(() => setPressedKey(null), 140);
        return;
      }
      const ability = ABILITY_CONFIG.find((a) => a.key === e.key);
      if (ability) {
        // Fulfill the Promise is a real weapon: the key never mutates an
        // order directly, only requests the parent's picker+confirmation
        // step. No cooldown/shot is consumed by this key press.
        if (ability.id === "pickup") {
          if (engine.getWeaponStatus("pickup") === "ready") onOpenPickupPicker?.();
          return;
        }
        engine.startWeaponAction(ability.id);
        setPressedKey(ability.id);
        window.setTimeout(() => setPressedKey(null), 140);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sageOpen, pickupPickerOpen, onOpenPickupPicker]);

  // Demo path today for every ability except "pickup"; a future real-action
  // adapter for the others replaces what startWeaponAction does internally
  // per ability without this call site or the tray UI changing.
  const handleAbilityClick = (id: AbilityId) => {
    if (id === "pickup") {
      if (engineRef.current!.getWeaponStatus("pickup") === "ready") onOpenPickupPicker?.();
      return;
    }
    engineRef.current!.startWeaponAction(id);
  };
  const handleFireClick = () => engineRef.current!.startWeaponAction("fire");
  const handleAutoToggle = () => engineRef.current!.setAutoMode(!autoMode);
  const handleRetreat = () => engineRef.current!.reset({ preserveAutoMode: false });

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
  const sparkNarrow = frontierPct < NARROW_FILL_PCT;
  const fogNarrow = 100 - frontierPct < NARROW_FILL_PCT;

  return (
    <div className="slb-root">
      <div className="slb-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="slb-canvas"
          style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
        />

        {/* SAGE — an in-world oracle character at the lower-left edge of the
            battlefield, not a sidebar. Irregular silhouette, no enclosing
            rectangle. Ask Sage never opens anything itself; it only asks
            the parent to summon the real composer. */}
        <div className={`slb-sage ${sageOpen ? "is-awakened" : ""}`}>
          <div
            className={`slb-sage-figure ${
              sageOpen
                ? hudArt.sageAwakened
                  ? "slb-art-sage-awakened"
                  : ""
                : hudArt.sageIdle
                  ? "slb-art-sage-idle"
                  : ""
            }`}
            aria-hidden="true"
          >
            {!hudArt.sageIdle && !hudArt.sageAwakened ? (
              <span className="slb-sage-core">
                <Sparkles size={18} />
              </span>
            ) : null}
          </div>
          <div className="slb-sage-label">
            <span className="slb-sage-name">Sage</span>
            <span className="slb-sage-role">Oracle of deals</span>
          </div>
          <p className="slb-sage-insight">Lead with convenience, then price.</p>
          <button
            type="button"
            className={`slb-sage-ask-btn ${hudArt.sageCtaFrame ? "slb-art-sage-cta" : ""}`}
            onClick={() => onAskSage?.()}
          >
            <span className="slb-sage-ask-label">Ask Sage</span>
            <span className="slb-sage-ask-hint">Summon counsel</span>
          </button>
        </div>

        {/* HUD overlay — every block is a physical object in Spark's world. */}
        <div className="slb-hud">
          {/* Top row, three explicit zones: True Net | Kingdom Influence | Blockers.
              The delivered sign art combines the main plank + gain plank into
              one image, so when it's loaded we render ONE element with both
              values as live text over their respective blank surfaces —
              never a second duplicate gain plank underneath it. */}
          {hudArt.signTruenet ? (
            <div className="slb-sign-combined slb-art-sign-truenet">
              <span className="slb-sign-combined-label">True net</span>
              <b className="slb-sign-combined-value">{usd(snapshot.trueNetCents)}</b>
              <span className="slb-sign-combined-gain">+{usd(snapshot.todayGainCents)} today</span>
            </div>
          ) : (
            <>
              <div className="slb-truenet-ropes" aria-hidden="true" />
              <div className="slb-sign slb-sign--truenet">
                <span className="slb-sign-label">True net</span>
                <b className="slb-sign-value">{usd(snapshot.trueNetCents)}</b>
              </div>
              <div className="slb-sign slb-sign--gain">
                <span className="slb-sign-gain">+{usd(snapshot.todayGainCents)} today</span>
              </div>
            </>
          )}

          <div className="slb-beam-zone">
            <div className="slb-beam-title" aria-hidden="true">
              <span>Kingdom influence</span>
              <i>Tug of war</i>
            </div>
            <div className={`slb-beam ${hudArt.meterFrame ? "slb-art-meter-frame" : ""}`}>
              <div className="slb-beam-track">
                <div className="slb-beam-fill-spark" style={{ width: `${frontierPct}%` }}>
                  {!sparkNarrow ? <span className="slb-beam-pct">{Math.round(frontierPct)}%</span> : null}
                </div>
                <div className="slb-beam-fill-fog" style={{ width: `${100 - frontierPct}%` }}>
                  {!fogNarrow ? <span className="slb-beam-pct">{Math.round(100 - frontierPct)}%</span> : null}
                </div>
                <div
                  className={`slb-beam-knot ${hudArt.meterKnot ? "slb-art-meter-knot" : ""}`}
                  style={{ left: `${frontierPct}%` }}
                />
                {sparkNarrow ? (
                  <span className="slb-beam-endcap slb-beam-endcap--spark">{Math.round(frontierPct)}%</span>
                ) : null}
                {fogNarrow ? (
                  <span className="slb-beam-endcap slb-beam-endcap--fog">{Math.round(100 - frontierPct)}%</span>
                ) : null}
              </div>
            </div>
            <div className="slb-beam-labels">
              <span className="slb-beam-label slb-beam-label--spark">Spark's realm</span>
              <span className="slb-beam-label slb-beam-label--fog">The Procrastinator</span>
            </div>
          </div>

          <div className={`slb-noticeboard ${hudArt.boardBlockers ? "slb-art-board-blockers" : ""}`}>
            <div className="slb-poster" style={{ transform: "rotate(-2deg)" }}>
              <div className={`slb-badge ${snapshot.blockers.overdueReturns === 0 ? "is-clear" : ""}`}>
                {snapshot.blockers.overdueReturns}
              </div>
              <span>Overdue returns</span>
            </div>
            <div className="slb-poster" style={{ transform: "rotate(1.5deg)" }}>
              <div className={`slb-badge ${snapshot.blockers.failedPayments === 0 ? "is-clear" : ""}`}>
                {snapshot.blockers.failedPayments}
              </div>
              <span>Failed payments</span>
            </div>
            <div className="slb-poster" style={{ transform: "rotate(-1deg)" }}>
              <div className={`slb-badge ${snapshot.blockers.blockedOrders === 0 ? "is-clear" : ""}`}>
                {snapshot.blockers.blockedOrders}
              </div>
              <span>Blocked orders</span>
            </div>
          </div>

          {/* Right-middle: single chronological Battle Log, clear of the villain */}
          <div className="slb-ledger" aria-live="polite">
            <span className="slb-ledger-title">Battle log</span>
            {log.slice(0, 4).map((entry, i) => (
              <p key={entry.id} className={`slb-ledger-line ${i === 0 ? "is-newest" : ""}`}>
                {entry.text}
              </p>
            ))}
          </div>

          {banner ? <div className="slb-banner-toast">{banner}</div> : null}

          {/* Bottom row: Spark plaque | ability tray | contract + controls */}
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

          <div className="slb-tray">
            <TrayButton
              label={FIRE_FLAVOR_NAME}
              shortcut="SPACE"
              icon={<Flame size={16} />}
              tokenClass="token-fire"
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
                  label={ability.flavorName}
                  shortcut={ability.key}
                  icon={<Icon size={16} />}
                  tokenClass={`token-${ability.id}`}
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

          <div className="slb-contract-cluster">
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
              {contractComplete ? (
                <>
                  <div className="slb-contract-signature" aria-hidden="true" />
                  <div className="slb-contract-thread" aria-hidden="true" />
                  <div className="slb-contract-clasp" aria-hidden="true" />
                </>
              ) : null}
            </div>
            <div className="slb-controls">
              <button
                type="button"
                className={`slb-control-btn ${autoMode ? "is-lit" : ""}`}
                onClick={handleAutoToggle}
              >
                Auto
              </button>
              <button type="button" className="slb-control-btn slb-control-btn--danger" onClick={handleRetreat}>
                Retreat
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  }
);

function TrayButton({
  label,
  shortcut,
  icon,
  tokenClass,
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
  tokenClass: string;
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
  // Derived weapon-capability status (see game/weaponCapability.ts) — today
  // this only ever resolves to ready/working/cooldown/disabled since the
  // demo path can't fail or go "live"; the CSS hooks for the other states
  // exist for a future real-action adapter.
  const weaponStatus = engine?.getWeaponStatus(cooldownId as Parameters<typeof engine.getWeaponStatus>[0]) ?? "ready";
  void tick; // force re-render on the HUD sync interval

  return (
    <button
      type="button"
      className={`slb-tray-btn slb-ability--${weaponStatus} ${pressed ? "is-pressed" : ""}`}
      disabled={disabled || remaining > 0}
      onClick={onClick}
    >
      <span className={`slb-token ${tokenClass}`} aria-hidden="true">
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
