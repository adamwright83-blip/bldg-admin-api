import { useEffect, useRef, useState } from "react";
import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";
import type { TowerImpact } from "@shared/towerWarsImpacts";
import { towerProofFrame, towerProofGeometry } from "@shared/towerPixiProof";
import { getAudioManager } from "@/game/audio/AudioManager";
import { BUILDING_ART } from "./buildingArt";

/** Read-only admin comparison. No event writer, reducer, or business mutation. */
export default function PixiTowerProof({ impact, attackerOnLeft }: { impact: TowerImpact | null; attackerOnLeft: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const start = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading bounded Pixi stage…");
  const [muted, setMuted] = useState(() => getAudioManager().isMuted);
  useEffect(() => {
    if (!impact || !host.current) return;
    const mount = host.current;
    const app = new Application();
    let disposed = false;
    let initialized = false;
    let observer: ResizeObserver | null = null;
    setReady(false);
    const setup = async () => {
      await app.init({ width: 1000, height: 650, background: "#b8ddf4", antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
      initialized = true;
      if (disposed) { app.destroy(true, { children: true, texture: false }); return; }
      const [cpeTexture, opusTexture, gunTexture, carTexture, background] = await Promise.all([
        Assets.load(BUILDING_ART.century_park_east.plate), Assets.load(BUILDING_ART.opus_la.plate),
        Assets.load(BUILDING_ART.century_park_east.weapon),
        Assets.load("/assets/admin/control-room/tower-wars/rolls-royce-projectile-v1.png"),
        Assets.load("/assets/admin/control-room/tower-wars/battle-environment.jpg"),
      ]);
      if (disposed) return;
      mount.appendChild(app.canvas);
      app.canvas.setAttribute("aria-label", "Canonical CPE valet attack comparison stage");
      const viewport = new Container();
      const scene = new Container();
      app.stage.addChild(viewport); viewport.addChild(scene);
      const backdrop = new Sprite(background); backdrop.width = 1000; backdrop.height = 650; scene.addChild(backdrop);
      const geometry = towerProofGeometry(impact, attackerOnLeft);
      const plate = (texture: typeof cpeTexture, x: number) => {
        const sprite = new Sprite(texture); sprite.position.set(x, 30); sprite.width = 400; sprite.height = 600; scene.addChild(sprite); return sprite;
      };
      plate(cpeTexture, geometry.attackerX); plate(opusTexture, geometry.defenderX);
      const gun = plate(gunTexture, geometry.attackerX);
      if (!attackerOnLeft) { gun.scale.x *= -1; gun.x += 400; }
      const gunRestX = gun.x;
      const trail = new Graphics(); scene.addChild(trail);
      const car = new Sprite(carTexture); car.anchor.set(.5); car.width = 145; car.height = 75;
      // Inspected authored vehicle nose faces right. Mirror only for leftward flight.
      if (geometry.direction < 0) car.scale.x *= -1;
      car.visible = false; scene.addChild(car);
      const wound = new Graphics(); wound.position.set(geometry.target.x, geometry.target.y); scene.addChild(wound);
      const flash = new Graphics(); scene.addChild(flash);
      const debris = Array.from({ length: 22 }, (_, i) => {
        const graphic = new Graphics().poly([0, -4, 5, 2, -3, 5]).fill(i % 3 ? 0x542f78 : 0xdbb961);
        graphic.visible = false; scene.addChild(graphic); return graphic;
      });
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      let elapsed = -1;
      let launched = false;
      let hit = false;
      const drawWound = () => {
        wound.clear();
        if (impact.repairState === "repaired") {
          wound.rect(-14, -20, 28, 40).fill({ color: 0x735293, alpha: .85 }).stroke({ width: 2, color: 0xdfc999 });
        } else {
          wound.poly([-16,-8,-7,-17,1,-9,14,-18,10,-2,19,7,7,10,-1,21,-8,9,-21,5]).fill(0x20172e).stroke({ width: 2, color: 0xbb90e9 });
          for (let i = 0; i < 7; i++) { const a = i * Math.PI * 2 / 7; wound.moveTo(0,0).lineTo(Math.cos(a)*25,Math.sin(a)*29).stroke({ width: 1.3, color: 0xe4c5ff }); }
        }
      };
      start.current = () => {
        elapsed = 0; launched = false; hit = false; wound.clear();
        getAudioManager().play("tower_charge");
        setStatus(`Replaying canonical attack ${impact.attackId}. No revenue or new impact is created.`);
        mount.dataset.phase = "windup";
        app.ticker.start();
      };
      app.ticker.add(ticker => {
        if (elapsed < 0 || document.hidden) return;
        elapsed += Math.min(ticker.deltaMS, 48);
        const frame = towerProofFrame(elapsed);
        const t = frame.flight;
        gun.x = gunRestX - geometry.direction * (elapsed < 600 ? Math.sin(frame.windup * Math.PI / 2) * 10 : Math.max(0, 1 - (elapsed - 600) / 280) * 28);
        if (!launched && elapsed >= 600) { launched = true; getAudioManager().play("tower_launch"); mount.dataset.phase = "flight"; }
        car.visible = elapsed >= 600 && !frame.impacted;
        const progress = t * t;
        car.x = geometry.launch.x + (geometry.target.x - geometry.launch.x) * progress;
        car.y = geometry.launch.y + (geometry.target.y - geometry.launch.y) * progress - Math.sin(t * Math.PI) * 110;
        car.rotation = geometry.direction * (-.2 + t * .45);
        trail.clear();
        if (car.visible) for (let i = 1; i < 7; i++) trail.moveTo(car.x - geometry.direction * i * 20, car.y + i * 3).lineTo(car.x - geometry.direction * (i * 20 + 38), car.y + i * 3).stroke({ width: 8 - i, color: i % 2 ? 0xf5d371 : 0xc1eeff, alpha: .65 });
        if (!hit && frame.impacted) {
          hit = true; drawWound(); getAudioManager().play("tower_impact");
          if (!reduced && !getAudioManager().isMuted) navigator.vibrate?.([25, 15, 35]);
          mount.dataset.phase = "impact";
        }
        const after = frame.aftermath;
        flash.clear();
        if (frame.impacted && after < .25) flash.circle(geometry.target.x, geometry.target.y, 18 + after * 220).fill({ color: 0xffefb5, alpha: Math.max(0, .85 - after * 3.4) });
        debris.forEach((fragment, i) => {
          fragment.visible = frame.impacted && after < 1.3;
          const a = i * 2.399;
          fragment.position.set(geometry.target.x + Math.cos(a) * after * (70 + i * 8), geometry.target.y + Math.sin(a) * after * 150 + after * after * 170);
          fragment.rotation = after * (i % 2 ? 5 : -4); fragment.alpha = Math.max(0, 1 - after / 1.3);
        });
        if (!reduced) {
          const shake = frame.hitstop ? 0 : frame.impacted ? Math.max(0, 1 - after / .4) * 5 : 0;
          scene.x = elapsed < 600 ? -geometry.direction * frame.windup * 8 : Math.sin(elapsed * .09) * shake;
          scene.y = Math.cos(elapsed * .07) * shake;
        }
        if (frame.complete) {
          getAudioManager().play("tower_debris"); scene.position.set(0,0); gun.x = gunRestX;
          mount.dataset.phase = "settled"; setStatus(`Settled at persisted facade ${impact.impactX.toFixed(2)}%, ${impact.impactY.toFixed(2)}% · ${impact.repairState}.`);
          elapsed = -1; app.ticker.stop();
        }
      });
      const resize = () => { const width = Math.max(1, mount.clientWidth); app.renderer.resize(width, width * .65); viewport.scale.set(width / 1000); app.render(); };
      observer = new ResizeObserver(resize); observer.observe(mount); resize();
      app.ticker.stop(); setReady(true); setStatus("Ready. Uses a persisted canonical attack, not a demonstration order.");
    };
    void setup().catch(error => { if (!disposed) setStatus(`Pixi unavailable: ${error instanceof Error ? error.message : "renderer initialization failed"}`); });
    return () => { disposed = true; start.current = null; observer?.disconnect(); if (initialized) app.destroy(true, { children: true, texture: false }); };
  }, [impact?.attackId, impact?.repairState, impact?.impactX, impact?.impactY, attackerOnLeft]);
  if (!impact) return <p role="status">No persisted CPE → OPUS attack is available. This comparison will not create one.</p>;
  return <section className="tw-pixi-proof" aria-label="Protected Pixi comparison">
    <p>Admin renderer comparison · game projection · attack {impact.attackId}</p>
    <button disabled={!ready} type="button" onClick={() => start.current?.()}>Replay canonical valet attack</button>
    <button type="button" onClick={() => { getAudioManager().setMuted(!muted); setMuted(!muted); }}>{muted ? "Unmute" : "Mute"}</button>
    <div ref={host} data-testid="tower-pixi-stage" data-impact-id={impact.attackId} data-impact-x={impact.impactX} data-impact-y={impact.impactY} style={{ width: "100%", minHeight: 220, overflow: "hidden" }} />
    <p role="status">{status}</p>
  </section>;
}
