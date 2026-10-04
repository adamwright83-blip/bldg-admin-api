import * as THREE from "three";
import type { Game } from "./game";
import { canvasTex } from "./style";
import {
  BEAM_DIR, BEAM_ORIGIN_Y, BEAM_ORIGIN_Z, BEAM_X0, BEAM_X1, MIRROR, alignedTiltRange, beamFloorPoint, clamp, clampPose, mirrorCenter,
  mirrorNormal, tiltFromPointerZ, traceMirror, type MirrorOutcome, type MirrorPose,
} from "../logic/mirror";

type Phase = "idle" | "playing" | "caught" | "done";

const glowTex = () => canvasTex(64, 64, g => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,240,180,0.85)"); gr.addColorStop(1, "rgba(255,200,90,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

/**
 * The one playable transformation: slide the brass button along the lining and lift its front edge
 * until the window beam bounces onto the lid. No text, no bar. The beam, the button and the bounce are the whole interface.
 */
export class MirrorPlay {
  group = new THREE.Group();
  phase: Phase = "idle";
  /** what you see (eased toward `target` while you drag) */
  pose: MirrorPose = { x: -1.1, tiltDeg: 14 };
  private target: MirrorPose = { x: -1.1, tiltDeg: 14 };
  private button: THREE.Group | null = null;
  private sheet: THREE.Mesh;
  private patch: THREE.Mesh;
  private inRay: THREE.Mesh;
  private bounce: THREE.Mesh;
  private flare: THREE.Sprite;
  private lidGlow: THREE.Sprite;
  private dragging = false;
  private drag0 = { px: 0, pz: 0, pose: { x: 0, tiltDeg: 0 } };
  private alignedFor = 0;
  private prev: MirrorPose = { x: -1.1, tiltDeg: 14 };
  /** how fast the button is moving right now (tilt-degrees per second, x scaled to match) */
  speed = 0;
  private t = 0;
  private caughtAt = 0;
  private lastOutcome: MirrorOutcome = "miss";
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
  /** set when a catch has happened and the hold is over: the placement to install */
  result: MirrorPose | null = null;
  /** seconds spent without a catch; after a long time the room helps (so nobody is ever stuck) */
  stuckFor = 0;
  assisted = false;
  outcome: MirrorOutcome = "miss";
  /** hinted playtest only: seconds in placement, with no press yet, before the one rocking cue */
  hintAfter: number | null = null;
  private cueT = -1;
  private cueDone = false;
  private everPressed = false;
  private assistLogged = false;

  constructor(private g: Game) {
    const sheetTex = canvasTex(8, 128, c => {
      const gr = c.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, "rgba(255,246,200,0.95)"); gr.addColorStop(0.6, "rgba(255,230,150,0.35)"); gr.addColorStop(1, "rgba(255,220,120,0.12)");
      c.fillStyle = gr; c.fillRect(0, 0, 8, 128);
    });
    const L = -BEAM_ORIGIN_Y / BEAM_DIR.y;
    this.sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(BEAM_X1 - BEAM_X0, L),
      new THREE.MeshBasicMaterial({ map: sheetTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    // plane height runs along the beam direction (set via quaternion below)
    const mid = new THREE.Vector3((BEAM_X0 + BEAM_X1) / 2, BEAM_ORIGIN_Y, BEAM_ORIGIN_Z).addScaledVector(new THREE.Vector3(BEAM_DIR.x, BEAM_DIR.y, BEAM_DIR.z), L / 2);
    this.sheet.position.copy(mid);
    this.sheet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(BEAM_DIR.x, BEAM_DIR.y, BEAM_DIR.z).negate());
    this.sheet.renderOrder = 6;

    const fp = beamFloorPoint((BEAM_X0 + BEAM_X1) / 2);
    this.patch = new THREE.Mesh(
      new THREE.PlaneGeometry(BEAM_X1 - BEAM_X0, 0.9),
      new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.patch.rotation.x = -Math.PI / 2; this.patch.position.set(fp.x, 0.03, fp.z + 0.15); this.patch.renderOrder = 6;

    const ray = (r: number) => new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: "#fff6c8", transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.inRay = ray(0.045); this.bounce = ray(0.04);
    this.inRay.renderOrder = this.bounce.renderOrder = 8;
    const sprite = (size: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      s.scale.setScalar(size); s.renderOrder = 30; return s;
    };
    this.flare = sprite(1); this.lidGlow = sprite(2);
    this.group.add(this.sheet, this.patch, this.inRay, this.bounce, this.flare, this.lidGlow);
    this.group.visible = false;
    g.world.scene.add(this.group);
    this.setRays(null);
  }

  /** begin: the carried button is set down on the lining, off to the side and too flat */
  start(button: THREE.Group) {
    this.button = button;
    this.g.world.scene.add(button);
    button.visible = true; button.scale.setScalar(MIRROR.radius / 0.7);
    this.cueT = -1; this.cueDone = false; this.everPressed = false; this.assistLogged = false; this.lastOutcome = "miss";
    this.g.pt?.rec("outcome", { outcome: "miss" });
    this.phase = "playing"; this.t = 0; this.stuckFor = 0; this.assisted = false; this.alignedFor = 0; this.result = null; this.dragging = false;
    this.pose = { x: -1.1, tiltDeg: 14 }; this.target = { ...this.pose }; this.prev = { ...this.pose }; this.speed = 0;
    this.group.visible = true;
    this.applyButton();
    this.g.world.spawnTrain();
  }

  stop() {
    this.phase = "done"; this.group.visible = false; this.dragging = false;
  }

  /** the button object, handed back to the shelf prop owner */
  release(): THREE.Group | null { const b = this.button; this.button = null; return b; }

  // ------------------------------------------------------------------ pointer (drag anywhere: slide + lift)
  private floorPoint(e: PointerEvent): THREE.Vector3 | null {
    const g = this.g;
    g.raycaster.setFromCamera(g.ndcOf(e), g.world.camera);
    const p = new THREE.Vector3();
    return g.raycaster.ray.intersectPlane(this.plane, p) ? p : null;
  }
  down(e: PointerEvent) {
    if (this.phase !== "playing") return;
    const p = this.floorPoint(e); if (!p) return;
    this.dragging = true; this.everPressed = true;
    this.g.pt?.rec("press", { pointerType: e.pointerType });
    this.drag0 = { px: p.x, pz: p.z, pose: { ...this.target } };
    (e.target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    this.g.sound.pick();
  }
  move(e: PointerEvent) {
    if (!this.dragging || this.phase !== "playing") return;
    const p = this.floorPoint(e); if (!p) return;
    const dTilt = tiltFromPointerZ(p.z) - tiltFromPointerZ(this.drag0.pz);
    this.target = clampPose({ x: this.drag0.pose.x + (p.x - this.drag0.px), tiltDeg: this.drag0.pose.tiltDeg + dTilt });
  }
  up() { if (this.dragging) this.g.pt?.rec("release"); this.dragging = false; }

  // ------------------------------------------------------------------ frame
  update(dt: number, time: number) {
    if (this.phase === "idle" || this.phase === "done") return;
    this.t += dt;
    const ease = 1 - Math.exp(-dt * 16);
    if (this.phase === "playing") {
      this.stuckFor += dt;
      if (this.hintAfter !== null && !this.cueDone && !this.everPressed && this.stuckFor > this.hintAfter) {
        this.cueDone = true; this.cueT = 0; this.g.pt?.rec("hint_cue");
      }
      // a little magnet: close to right, the button settles the last few degrees by itself
      const win = alignedTiltRange(this.target.x);
      if (win && !this.dragging) {
        const off = win.mid - this.target.tiltDeg;
        if (Math.abs(off) < 6 && this.lastOutcome !== "miss") this.target.tiltDeg += off * Math.min(1, dt * 3);
      }
      // nobody gets stuck: after a long time the room nudges the button toward the light
      if (this.stuckFor > 40 && !this.dragging) {
        this.assisted = true;
        if (!this.assistLogged) { this.assistLogged = true; this.g.pt?.rec("assist_fired"); }
        const w = alignedTiltRange(clamp(this.target.x, 0.6, 1.4));
        if (w) {
          this.target.x += (clamp(this.target.x, 0.6, 1.4) - this.target.x) * Math.min(1, dt * 1.2);
          this.target.tiltDeg += (w.mid - this.target.tiltDeg) * Math.min(1, dt * 0.8);
        }
      }
    }
    if (this.cueT >= 0) { this.cueT += dt; if (this.cueT > 1.6) this.cueT = -1; }
    this.pose.x += (this.target.x - this.pose.x) * ease;
    this.pose.tiltDeg += (this.target.tiltDeg - this.pose.tiltDeg) * ease;
    this.applyButton();
    // sweeping past the sweet spot is not finding it: only a button that has settled can catch the light
    this.speed = Math.hypot(this.pose.tiltDeg - this.prev.tiltDeg, (this.pose.x - this.prev.x) * 30) / Math.max(dt, 1e-3);
    this.prev = { ...this.pose };

    const trace = traceMirror(this.pose);
    this.outcome = trace.outcome;
    this.setRays(trace, time);

    if (this.phase === "playing") {
      this.alignedFor = trace.outcome === "aligned" && this.speed < 24 ? this.alignedFor + dt : 0;
      if (trace.outcome !== this.lastOutcome) {
        this.g.pt?.rec("outcome", { outcome: trace.outcome });
        if (trace.outcome === "glance") this.g.sound.lampClick();
        if (trace.outcome === "aligned") this.g.sound.chime();
        this.lastOutcome = trace.outcome;
      }
      if (this.alignedFor > 0.3) {
        this.phase = "caught"; this.caughtAt = this.t; this.dragging = false;
        this.target = { ...this.pose }; // the button stays exactly where it caught the light
        this.g.pt?.rec("catch");
        this.result = { x: this.pose.x, tiltDeg: this.pose.tiltDeg };
        this.g.sound.latch(); this.g.sound.trainRumble();
        const c = mirrorCenter(this.pose);
        this.g.fx.poof(new THREE.Vector3(c.x, c.y + 0.2, c.z), ["#fff1b0", "#ffffff", "#ffd23f"]);
      }
    }
  }

  /** has the payoff had time to land? */
  get heldLongEnough() { return this.phase === "caught" && this.t - this.caughtAt > 1.5; }

  private applyButton() {
    const b = this.button; if (!b) return;
    const p0 = clampPose(this.pose);
    // the hinted cue only rocks the button where it lies: it says "this moves", never where to put it
    const rock = this.cueT < 0 ? 0 : 7 * Math.sin((this.cueT / 0.8) * Math.PI * 2) * (1 - this.cueT / 1.6);
    const p = { x: p0.x, tiltDeg: p0.tiltDeg + rock };
    const n = mirrorNormal(p.tiltDeg);
    const c = mirrorCenter(p);
    const face = 0.17 * (MIRROR.radius / 0.7);
    b.position.set(c.x - n.x * face, c.y - n.y * face, c.z - n.z * face);
    b.rotation.set(-(p.tiltDeg * Math.PI) / 180, 0, 0);
  }

  private place(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thick: number, opacity: number, color: string) {
    const d = b.clone().sub(a); const L = d.length();
    m.visible = L > 0.01;
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.scale.set(thick, L, thick);
    const mat = m.material as THREE.MeshBasicMaterial; mat.opacity = opacity; mat.color.set(color);
  }

  private setRays(trace: ReturnType<typeof traceMirror> | null, time = 0) {
    if (!trace || trace.outcome === "miss") {
      this.inRay.visible = false; this.bounce.visible = false; this.flare.visible = false; this.lidGlow.visible = false;
      return;
    }
    const origin = new THREE.Vector3(this.pose.x, BEAM_ORIGIN_Y, BEAM_ORIGIN_Z);
    const hit = new THREE.Vector3(trace.hit!.x, trace.hit!.y, trace.hit!.z);
    const end = new THREE.Vector3(trace.end!.x, trace.end!.y, trace.end!.z);
    const aligned = trace.outcome === "aligned";
    const pulse = 1 + Math.sin(time * 14) * (aligned ? 0.12 : 0.05);
    this.place(this.inRay, origin, hit, aligned ? 0.07 : 0.045, 0.9, "#fff6c8");
    this.place(this.bounce, hit, end, aligned ? 0.1 * pulse : 0.03, aligned ? 1 : 0.55, aligned ? "#fffbe6" : "#ffb870");
    this.flare.visible = true; this.flare.position.copy(hit);
    this.flare.scale.setScalar((aligned ? 2.4 : 0.55) * pulse);
    (this.flare.material as THREE.SpriteMaterial).opacity = aligned ? 1 : 0.7;
    // the lid lights up only when the light really lands there
    this.lidGlow.visible = aligned; this.lidGlow.position.copy(end); this.lidGlow.scale.setScalar(3.4 * pulse);
  }

  dispose() { this.g.world.scene.remove(this.group); }
}
