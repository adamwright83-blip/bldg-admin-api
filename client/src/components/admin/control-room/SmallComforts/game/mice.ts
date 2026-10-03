import * as THREE from "three";
import { GuestId } from "../logic/guests";
import { PAL, ball, cyl, rbox, toon, inked } from "./style";

export type Mode =
  | "idle" | "walk" | "watch-train" | "keyhole" | "sit" | "read" | "squint" | "wrap" | "shiver" | "lie" | "sleep"
  | "nap" | "sigh" | "stretch" | "flick" | "click" | "cover-eyes" | "tiptoe" | "bump";

const FUR: Record<GuestId, string> = { conductor: "#9fb0c6", baker: "#e1bd92", reader: "#b08a62" };

export class Mouse {
  root = new THREE.Group();
  body = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  tail = new THREE.Group();
  eyes: THREE.Mesh[] = [];
  props: Record<string, THREE.Object3D> = {};
  mode: Mode = "idle";
  modeStart = 0;
  walkPhase = 0;
  /** extra offsets the controller sets (lying/sitting base height etc.) */
  baseY = 0;
  lying = false;

  constructor(public guest: GuestId) {
    const fur = FUR[guest];
    const torso = ball(0.27, fur); torso.scale.set(1, 1.15, 0.9); torso.position.y = 0.34;
    const belly = ball(0.2, "#f7e8d6", false); belly.scale.set(1, 1.1, 0.5); belly.position.set(0, 0.32, 0.16);
    this.body.add(torso, belly);

    // head
    const skull = ball(0.22, fur); skull.scale.set(1.05, 0.95, 1);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 14), toon(fur)); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.02, 0.24); inked(snout, 0.08);
    const nose = ball(0.045, "#e98aa0", false); nose.position.set(0, -0.01, 0.37);
    this.head.add(skull, snout, nose);
    for (const s of [-1, 1]) {
      const ear = ball(0.13, fur); ear.scale.set(1, 1, 0.3); ear.position.set(s * 0.19, 0.2, -0.02); ear.rotation.y = s * 0.4;
      const inner = ball(0.085, "#f0a5b4", false); inner.scale.set(1, 1, 0.3); inner.position.set(s * 0.19, 0.2, 0.0); inner.rotation.y = s * 0.4;
      const eye = ball(0.035, PAL.ink, false); eye.position.set(s * 0.09, 0.06, 0.2); this.eyes.push(eye);
      this.head.add(ear, inner, eye);
      const whisk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), toon(PAL.ink)); whisk.rotation.z = Math.PI / 2 + s * 0.15; whisk.position.set(s * 0.17, -0.03, 0.3); this.head.add(whisk);
    }
    this.head.position.set(0, 0.72, 0.05);

    // limbs
    for (const [grp, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      const a = cyl(0.045, 0.04, 0.22, fur, 8, false); a.position.y = -0.1;
      const h = ball(0.05, fur, false); h.position.y = -0.22;
      grp.add(a, h); grp.position.set(s * 0.26, 0.46, 0.05); grp.rotation.z = s * 0.2;
    }
    for (const [grp, s] of [[this.legL, -1], [this.legR, 1]] as const) {
      const f = ball(0.085, fur, false); f.scale.set(1, 0.6, 1.4); f.position.set(0, 0.05, 0.05);
      grp.add(f); grp.position.set(s * 0.13, 0.02, 0.02);
    }
    // tail: chain of shrinking beads
    let ty = 0, tz = 0;
    for (let i = 0; i < 6; i++) { const b = ball(0.045 - i * 0.004, "#f0b6b6", false); ty = i * 0.03; tz = -0.2 - i * 0.08; b.position.set(Math.sin(i * 0.9) * 0.05, 0.08 + ty, tz); this.tail.add(b); }
    this.root.add(this.body);
    this.costume();
    // everything that bends goes inside `body`, so lean/lie rotate the whole mouse
    for (const c of [this.head, this.armL, this.armR, this.legL, this.legR, this.tail]) this.body.add(c);
  }

  private costume() {
    const g = this.guest;
    if (g === "conductor") {
      const cap = cyl(0.21, 0.23, 0.14, "#1f3a5f", 20); cap.position.set(0, 0.2, 0);
      const band = cyl(0.235, 0.235, 0.04, PAL.brass, 20, false); band.position.set(0, 0.15, 0);
      const brim = cyl(0.2, 0.2, 0.025, PAL.ink, 20, false); brim.scale.set(1, 1, 1); brim.position.set(0, 0.13, 0.17); brim.scale.set(1, 1, 0.8);
      this.head.add(cap, band, brim); this.props.hat = cap;
      for (let i = 0; i < 3; i++) { const b = ball(0.03, PAL.brass, false); b.position.set(0, 0.5 - i * 0.1, 0.24); this.body.add(b); }
      const coat = rbox(0.5, 0.36, 0.42, "#1f3a5f", 0.12); coat.position.set(0, 0.32, 0); coat.scale.set(1, 1, 0.98); this.body.add(coat);
      const um = new THREE.Group();
      const shaft = cyl(0.018, 0.018, 1.25, PAL.ink, 8, false); shaft.position.y = 0.1;
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.72, 12), toon("#c8323c")); canopy.position.y = 0.72; inked(canopy, 0.04);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 6, 12, Math.PI), toon(PAL.brass)); handle.position.y = -0.52; handle.rotation.z = Math.PI;
      um.add(shaft, canopy, handle); um.position.set(0, -0.22, 0.05);
      this.armR.add(um); this.props.umbrella = um; um.rotation.x = 0.1;
    } else if (g === "baker") {
      const hat = cyl(0.17, 0.19, 0.3, "#ffffff", 18); hat.position.set(0, 0.34, 0);
      const puff = ball(0.22, "#ffffff"); puff.position.set(0, 0.5, 0); puff.scale.set(1, 0.7, 1);
      this.head.add(hat, puff); this.props.hat = hat;
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 20), toon("#d1473c")); scarf.rotation.x = Math.PI / 2; scarf.position.set(0, 0.56, 0.03); inked(scarf, 0.08);
      const tailS = rbox(0.1, 0.34, 0.06, "#d1473c", 0.03); tailS.position.set(0.12, 0.42, 0.22); tailS.rotation.z = 0.15;
      this.body.add(scarf, tailS); this.props.scarf = scarf;
      const apron = rbox(0.38, 0.32, 0.06, "#f7e8d6", 0.04); apron.position.set(0, 0.28, 0.22); this.body.add(apron);
    } else {
      const frames = new THREE.Group();
      for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.012, 6, 16), toon(PAL.ink)); r.position.set(s * 0.09, 0.07, 0.215); frames.add(r); }
      const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), toon(PAL.ink)); bridge.rotation.z = Math.PI / 2; bridge.position.set(0, 0.09, 0.215); frames.add(bridge);
      this.head.add(frames); this.props.glasses = frames;
      const cardi = rbox(0.5, 0.34, 0.42, "#6b7f5a", 0.12); cardi.position.set(0, 0.32, 0); this.body.add(cardi);
      const book = new THREE.Group();
      const cover = rbox(0.28, 0.04, 0.36, PAL.burgundy, 0.02); const pages = rbox(0.25, 0.05, 0.33, PAL.cream, 0.01, false); pages.position.y = 0.03;
      book.add(cover, pages); book.position.set(0, 0.42, 0.28); book.rotation.x = -0.9; this.body.add(book); this.props.book = book;
      const bun = ball(0.08, "#b08a62"); bun.position.set(0, 0.24, -0.1); this.head.add(bun);
    }
  }

  setMode(m: Mode, t: number) {
    if (this.mode === m) return;
    this.mode = m; this.modeStart = t;
  }

  /** evaluate the pose at time t (called at 12 fps: this is the stop-motion stepping) */
  update(t: number) {
    const lt = t - this.modeStart;
    const m = this.mode;
    const b = this.body, h = this.head;
    // reset
    b.position.set(0, this.baseY, 0); b.rotation.set(0, 0, 0); b.scale.set(1, 1, 1); h.position.set(0, 0.72, 0.05); h.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, -0.2); this.armR.rotation.set(0, 0, 0.2);
    this.legL.position.set(-0.13, 0.02, 0.02); this.legR.position.set(0.13, 0.02, 0.02);
    this.legL.rotation.set(0, 0, 0); this.legR.rotation.set(0, 0, 0);
    this.tail.rotation.y = Math.sin(t * 2.2) * 0.25;
    const eyeOpen = m === "sleep" || m === "nap" ? 0.1 : (Math.floor(t * 2.3) % 9 === 0 ? 0.15 : 1);
    this.eyes.forEach(e => e.scale.set(1, eyeOpen, 1));
    const um = this.props.umbrella;
    if (um) um.rotation.set(0.1, 0, 0);
    const book = this.props.book as THREE.Group | undefined;
    if (book) book.rotation.set(-0.9, 0, 0);

    switch (m) {
      case "idle": b.position.y += Math.sin(t * 3) * 0.012; h.rotation.z = Math.sin(t * 1.3) * 0.05; break;
      case "walk": {
        const s = Math.sin(this.walkPhase);
        b.position.y += Math.abs(s) * 0.08; b.rotation.z = s * 0.07; b.rotation.x = 0.08;
        this.legL.position.z += s * 0.12; this.legR.position.z -= s * 0.12;
        this.armL.rotation.x = -s * 0.5; this.armR.rotation.x = s * 0.5; break;
      }
      case "watch-train": b.rotation.x = -0.08; h.rotation.x = -0.25; h.rotation.y = Math.sin(lt * 1.5) * 0.35; this.armL.rotation.set(-0.6, 0, -0.5); break;
      case "keyhole": b.rotation.x = 0.18; h.rotation.x = 0.2; h.position.z += 0.08; um && (um.rotation.x = -0.6); break;
      case "tiptoe": b.position.y += 0.1 + Math.sin(lt * 5) * 0.02; h.rotation.x = -0.3; this.legL.rotation.x = -0.5; this.legR.rotation.x = -0.5; break;
      case "sit": b.position.y += -0.1; this.legL.position.set(-0.13, 0.12, 0.28); this.legR.position.set(0.13, 0.12, 0.28); break;
      case "read": b.position.y += -0.1; h.rotation.x = 0.35; this.armL.rotation.set(-1.0, 0, 0.1); this.armR.rotation.set(-1.0, 0, -0.1); this.legL.position.set(-0.13, 0.12, 0.28); this.legR.position.set(0.13, 0.12, 0.28);
        if (Math.floor(lt * 0.6) % 2 === 0) h.rotation.y = 0.12; break;
      case "squint": b.position.y += -0.1; b.rotation.x = 0.25; h.rotation.x = 0.4; this.eyes.forEach(e => e.scale.set(1, 0.3, 1)); this.legL.position.set(-0.13, 0.12, 0.28); this.legR.position.set(0.13, 0.12, 0.28); break;
      case "wrap": b.scale.setScalar(1); b.position.y += 0.02; this.armL.rotation.set(-0.8, 0, 0.6); this.armR.rotation.set(-0.8, 0, -0.6); break;
      case "shiver": b.position.x = Math.sin(t * 40) * 0.015; this.armL.rotation.set(-0.5, 0, 0.7); this.armR.rotation.set(-0.5, 0, -0.7); break;
      case "lie": case "sleep": {
        b.rotation.x = -Math.PI / 2; b.position.y += 0.3; b.position.z = 0.0;
        if (m === "sleep") { b.position.y += Math.sin(t * 1.6) * 0.012; h.rotation.x = 0.2; }
        this.armL.rotation.set(0, 0, -0.1); this.armR.rotation.set(0, 0, 0.1); break;
      }
      case "nap": b.position.y += -0.1; h.rotation.x = 0.45; h.rotation.z = Math.sin(t * 1.4) * 0.05; this.legL.position.set(-0.13, 0.12, 0.28); this.legR.position.set(0.13, 0.12, 0.28); break;
      case "sigh": b.rotation.x = 0.1; h.rotation.x = 0.3 + Math.sin(lt * 4) * 0.05; h.position.y -= 0.03; this.armL.rotation.z = -0.05; this.armR.rotation.z = 0.05; break;
      case "stretch": { const k = Math.min(1, lt * 2); this.armR.rotation.set(-2.4 * k, 0, 0.1); b.rotation.x = -0.12 * k; b.rotation.z = -0.15 * k; break; }
      case "flick": { const k = Math.min(1, lt / 0.5); this.armR.rotation.set(-1.6 * k, 0, 0.1); if (um) um.rotation.set(-1.4 + Math.sin(lt * 14) * 0.25 * (lt < 0.8 ? 1 : 0), 0, 0); break; }
      case "click": { const k = Math.min(1, lt * 3); this.armR.rotation.set(-1.7 * k, 0, 0.1 + 0.2 * k); b.rotation.x = 0.1 * k; break; }
      case "cover-eyes": { this.armL.rotation.set(-2.2, 0, 0.6); this.armR.rotation.set(-2.2, 0, -0.6); this.eyes.forEach(e => e.scale.set(1, 0.1, 1)); h.rotation.x = 0.1; break; }
      case "bump": { const k = Math.min(1, lt * 2.2); b.scale.set(1 + 0.2 * (1 - k), 1 - 0.2 * (1 - k), 1); b.rotation.x = -0.25 * (1 - k); this.armL.rotation.set(0, 0, -1.2); this.armR.rotation.set(0, 0, 1.2); break; }
    }
    if (um) um.visible = !this.lying || m === "flick";
    if (this.lying) {
      // lying down: the whole body lies flat whatever the gesture; only arms/head gestures survive
      b.rotation.set(-Math.PI / 2, 0, 0);
      b.position.set(m === "shiver" ? Math.sin(t * 40) * 0.015 : 0, this.baseY + 0.3 + (m === "sleep" ? Math.sin(t * 1.6) * 0.012 : 0), 0);
      b.scale.set(1, 1, 1);
    }
  }
}
