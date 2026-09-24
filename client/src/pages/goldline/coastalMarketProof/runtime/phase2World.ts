import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PlayerController } from "./controller";
import type { Route } from "./level";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Beat = "approach" | "shutdown" | "ride" | "release" | "transfer" | "reveal";

const brass = new THREE.MeshStandardMaterial({ color: 0x9b672b, metalness: 0.72, roughness: 0.28 });
const timber = new THREE.MeshStandardMaterial({ color: 0x392116, roughness: 0.78 });
const stone = new THREE.MeshStandardMaterial({ color: 0x8d806d, roughness: 0.92 });
const plaster = new THREE.MeshStandardMaterial({ color: 0xc98561, roughness: 0.86 });
const teal = new THREE.MeshStandardMaterial({ color: 0x1d5f62, roughness: 0.68 });
const gold = new THREE.MeshBasicMaterial({ color: 0xffd266, toneMapped: false });
const paper = new THREE.MeshStandardMaterial({ color: 0xe6d5ae, roughness: 0.95 });

function box(parent: THREE.Object3D, size: [number, number, number], p: THREE.Vector3, mat: THREE.Material, name = "") {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size, 2, 2, 2), mat);
  m.position.copy(p);
  m.name = name;
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function beamBetween(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material) {
  const d = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d, 8), mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

export class Phase2World {
  readonly group = new THREE.Group();
  readonly contactShadow: THREE.Mesh;
  readonly cage = new THREE.Group();
  readonly state = { beat: "approach" as Beat, shutdown: 0, tensionUse: 0, reveal: false, caption: "" };
  private readonly seams: THREE.Mesh[] = [];
  private readonly shutters: THREE.Mesh[] = [];
  private readonly workers: THREE.Object3D[] = [];
  private readonly route: Route;
  private rook?: THREE.Object3D;
  private active: { use: number; t: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private captionTimer = 0;

  constructor(scene: THREE.Scene, route: Route, rookGltf?: GLTF) {
    this.route = route;
    this.group.name = "phase2-authored-corridor";
    scene.add(this.group);

    // The Phase 2 kit is deliberately concentrated along the playable ribbon: coursed
    // stone bases, plaster uppers, deep roof silhouettes and timber/brass landmarks.
    for (let s = 0; s < route.length; s += 11) {
      const p = route.at(s);
      const d = route.dirAt(s);
      const side = new THREE.Vector3(-d.z, 0, d.x);
      for (const sign of [-1, 1]) {
        const q = p.clone().addScaledVector(side, sign * (4.6 + (s % 17) * 0.05));
        const h = 5.5 + ((s * 13) % 4);
        box(this.group, [5.8, 1.2, 5.2], q.clone().add(new THREE.Vector3(0, 0.6, 0)), stone, "kit-stone-course");
        box(this.group, [5.4, h, 4.8], q.clone().add(new THREE.Vector3(0, 1.2 + h / 2, 0)), s % 22 ? plaster : teal, "kit-plaster-upper");
        const roof = box(this.group, [6.4, 0.55, 5.8], q.clone().add(new THREE.Vector3(0, h + 1.7, 0)), timber, "kit-roof-overhang");
        roof.rotation.y = Math.atan2(d.x, d.z);
        const balcony = box(this.group, [3.7, 0.25, 1.15], q.clone().addScaledVector(side, -sign * 2.45).add(new THREE.Vector3(0, 4.0, 0)), timber, "kit-balcony");
        balcony.rotation.y = Math.atan2(d.x, d.z);
      }
    }

    // Harbor crane tower and the loaded counterweight make the first verb legible.
    const crane = route.at(25);
    for (const x of [-2.2, 2.2]) for (const z of [-2.2, 2.2]) {
      const a = crane.clone().add(new THREE.Vector3(x, 0, z));
      const b = a.clone().add(new THREE.Vector3(0, 18, 0));
      beamBetween(this.group, a, b, 0.22, timber);
      beamBetween(this.group, a, crane.clone().add(new THREE.Vector3(-x, 18, -z)), 0.14, brass);
    }
    const counter = box(this.group, [2.0, 3.4, 2.0], crane.clone().add(new THREE.Vector3(-2.2, 14, 0)), stone, "counterweight");
    counter.userData.restY = counter.position.y;
    this.addSeam(crane.clone().add(new THREE.Vector3(0, 17.8, 0)), crane.clone().add(new THREE.Vector3(-2.2, 14, 0)));

    // Shutters read as one shutdown wave rather than isolated props.
    for (let s = 45; s < 105; s += 14) {
      const p = route.at(s);
      const d = route.dirAt(s);
      const side = new THREE.Vector3(-d.z, 0, d.x);
      const sh = box(this.group, [3.0, 3.8, 0.22], p.clone().addScaledVector(side, s % 16 ? 3.25 : -3.25).add(new THREE.Vector3(0, 4.6, 0)), teal, "shutdown-shutter");
      sh.rotation.y = Math.atan2(d.x, d.z);
      sh.userData.openY = sh.position.y + 3.4;
      sh.userData.dynamic = true;
      sh.position.y = sh.userData.openY;
      this.shutters.push(sh);
    }

    // RELEASE: a guyed jib starts visibly strained across the gorge.
    const gorge = route.at(92);
    const jibPivot = gorge.clone().add(new THREE.Vector3(-5, 5, 0));
    const jib = new THREE.Group();
    jib.position.copy(jibPivot);
    const jibBeam = box(jib, [0.65, 0.65, 13], new THREE.Vector3(0, 0, 6), timber, "loaded-jib");
    jibBeam.rotation.x = -0.08;
    jib.rotation.y = 1.2;
    jib.userData.closedYaw = 1.2;
    this.group.add(jib);
    this.group.userData.jib = jib;
    this.addSeam(jibPivot.clone().add(new THREE.Vector3(0, 0.5, 0)), jibPivot.clone().add(new THREE.Vector3(0, 8, -5)));

    this.consolidateStatic();

    // Ropeway, circulating hooks and the hero cage/workshop.
    const cableA = route.at(2).add(new THREE.Vector3(0, 14, 0));
    const cableB = route.at(route.length - 2).add(new THREE.Vector3(0, 13, 0));
    beamBetween(this.group, cableA, cableB, 0.075, timber);
    for (let i = 0; i < 3; i++) {
      const h = new THREE.Group();
      const hp = cableA.clone().lerp(cableB, i / 3);
      beamBetween(h, new THREE.Vector3(), new THREE.Vector3(0, -2.8, 0), 0.06, brass);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 8, 18, Math.PI * 1.45), brass);
      hook.position.y = -3.1;
      h.add(hook);
      h.position.copy(hp);
      h.userData.phase = i / 3;
      this.group.add(h);
      this.workers.push(h);
    }
    this.buildCage(rookGltf);
    this.cage.position.copy(route.at(32)).add(new THREE.Vector3(0, 12, 0));
    this.group.add(this.cage);

    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x160e0a, transparent: true, opacity: 0.42, depthWrite: false });
    this.contactShadow = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24), shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.renderOrder = 3;
    scene.add(this.contactShadow);
  }

  private addSeam(a: THREE.Vector3, b: THREE.Vector3) {
    const seam = beamBetween(this.group, a, b, 0.035, gold);
    seam.userData.baseScale = 1;
    this.seams.push(seam);
    seam.userData.dynamic = true;
  }

  private consolidateStatic() {
    this.group.updateMatrixWorld(true);
    const candidates = this.group.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && !o.userData.dynamic);
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const mesh of candidates) {
      const material = mesh.material as THREE.Material;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrix);
      const list = byMaterial.get(material) ?? [];
      list.push(geometry);
      byMaterial.set(material, list);
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const [material, geometries] of byMaterial) {
      const geometry = mergeGeometries(geometries, false);
      geometries.forEach(g => g.dispose());
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = "phase2-kit-batch";
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildCage(rookGltf?: GLTF) {
    const floor = box(this.cage, [6.2, 0.35, 4.4], new THREE.Vector3(), timber, "cage-workshop-floor");
    floor.receiveShadow = true;
    for (const x of [-2.8, 2.8]) for (const z of [-1.9, 1.9]) beamBetween(this.cage, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 5, z), 0.12, brass);
    for (const y of [0.2, 5]) {
      beamBetween(this.cage, new THREE.Vector3(-2.8, y, -1.9), new THREE.Vector3(2.8, y, -1.9), 0.12, brass);
      beamBetween(this.cage, new THREE.Vector3(-2.8, y, 1.9), new THREE.Vector3(2.8, y, 1.9), 0.12, brass);
      beamBetween(this.cage, new THREE.Vector3(-2.8, y, -1.9), new THREE.Vector3(-2.8, y, 1.9), 0.12, brass);
      beamBetween(this.cage, new THREE.Vector3(2.8, y, -1.9), new THREE.Vector3(2.8, y, 1.9), 0.12, brass);
    }
    for (let x = -2.1; x <= 2.1; x += 0.7) beamBetween(this.cage, new THREE.Vector3(x, 0, -1.9), new THREE.Vector3(x, 5, -1.9), 0.055, brass);
    box(this.cage, [1.8, 1.0, 0.8], new THREE.Vector3(-1.4, 0.7, 0.6), timber, "dispatch-crate");
    // Option A staging: the sealed dispatch satchel is already off its authority
    // hook and parked beside Rook. The intact approved mesh stays static because
    // the experimental skin export did not preserve deformation in three.js.
    box(this.cage, [0.72, 0.68, 0.24], new THREE.Vector3(0.55, 1.0, -0.55), timber, "stolen-dispatch-satchel");
    box(this.cage, [0.64, 0.16, 0.26], new THREE.Vector3(0.55, 1.35, -0.55), brass, "dispatch-seal-flap");
    box(this.cage, [1.4, 1.2, 0.12], new THREE.Vector3(1.7, 2.0, 1.75), paper, "coastal-chart");
    const lamp = new THREE.PointLight(0xffb642, 7, 18, 2);
    lamp.position.set(0, 3.2, 0);
    this.cage.add(lamp);
    for (let i = 0; i < 14; i++) box(this.cage, [0.32, 0.03, 0.22], new THREE.Vector3(-1.5 + (i % 5) * 0.42, 1.3 + Math.floor(i / 5) * 0.08, 0.2), paper, "letter");
    if (rookGltf) {
      this.rook = rookGltf.scene;
      this.rook.scale.setScalar(1.05);
      this.rook.position.set(0.8, 0.25, 0.25);
      this.rook.rotation.y = -0.65; // painted side toward the reveal camera
      this.rook.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
      this.cage.add(this.rook);
    }
    this.consolidateChildren(this.cage);
  }

  private consolidateChildren(parent: THREE.Group) {
    parent.updateMatrixWorld(true);
    const candidates = parent.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const mesh of candidates) {
      const material = mesh.material as THREE.Material;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrix);
      const list = byMaterial.get(material) ?? [];
      list.push(geometry);
      byMaterial.set(material, list);
      parent.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const [material, geometries] of byMaterial) {
      const geometry = mergeGeometries(geometries, false);
      geometries.forEach(g => g.dispose());
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }

  update(dt: number, elapsed: number, controller: PlayerController, lineHeld: boolean, autowalk: boolean) {
    const s = controller.progress;
    if (s > 12) this.state.beat = "shutdown";
    this.state.shutdown += ((s > 12 ? 1 : 0) - this.state.shutdown) * Math.min(1, dt * 1.4);
    this.shutters.forEach((sh, i) => {
      const wave = THREE.MathUtils.smoothstep(this.state.shutdown * 1.35 - i / this.shutters.length, 0, 0.35);
      sh.position.y = sh.userData.openY - wave * 3.4;
    });
    const jib = this.group.userData.jib as THREE.Group;
    if (jib) jib.rotation.y += ((this.state.tensionUse >= 2 ? -0.05 : jib.userData.closedYaw) - jib.rotation.y) * Math.min(1, dt * 3.2);
    this.seams.forEach((m, i) => { m.visible = 0.5 + 0.5 * Math.sin(elapsed * 6 + i) > 0.18; });

    const cageS = Math.min(this.route.length - 3, Math.max(28 + elapsed * 1.15 + this.state.shutdown * 8, controller.progress + 18));
    const cageDir = this.route.dirAt(cageS);
    const cp = this.route.at(cageS).add(new THREE.Vector3(0, 6.4 + Math.sin(elapsed * 0.8) * 0.25, 0));
    if (s > this.route.length - 9) cp.copy(this.route.at(this.route.length - 2)).addScaledVector(cageDir, 3.6).add(new THREE.Vector3(0, 0.4, 0));
    this.cage.position.lerp(cp, 1 - Math.exp(-dt * 2.5));
    this.cage.rotation.z = Math.sin(elapsed * 0.7) * 0.025;
    this.workers.forEach((h, i) => {
      const u = (elapsed * 0.025 + h.userData.phase) % 1;
      h.position.copy(this.route.at(u * this.route.length)).add(new THREE.Vector3(0, 13 + Math.sin(elapsed + i) * 0.18, 0));
    });

    const wants = lineHeld || autowalk;
    if (!this.active && wants) {
      if (this.state.tensionUse === 0 && s > 20 && s < 42) this.startUse(1, controller, this.route.at(34).add(new THREE.Vector3(0, 9, 0)));
      else if (this.state.tensionUse === 1 && s > 76 && s < 108) this.startUse(2, controller, this.route.at(96));
      else if (this.state.tensionUse === 2 && s > 125 && s < 154) this.startUse(3, controller, this.route.at(142).add(new THREE.Vector3(0, 5, 0)));
    }
    if (this.active) {
      this.active.t += dt;
      const u = THREE.MathUtils.smoothstep(this.active.t, 0, this.active.use === 1 ? 1.3 : 1.0);
      const target = this.active.from.clone().lerp(this.active.to, u);
      if (this.active.use === 3) target.y += Math.sin(u * Math.PI) * 7;
      controller.pullToward(target, 14, dt);
      if (u >= 0.999) {
        controller.frozen = false;
        controller.placeAt(this.active.use === 1 ? 34 : this.active.use === 2 ? 96 : 142);
        this.state.tensionUse = this.active.use;
        this.state.beat = this.active.use === 1 ? "ride" : this.active.use === 2 ? "release" : "transfer";
        this.active = null;
      }
    }
    if (s > this.route.length - 9) {
      this.state.beat = "reveal";
      this.state.reveal = true;
      const line = elapsed % 11;
      this.state.caption = line < 2.8 ? "TRAILBLAZER: That's not yours."
        : line < 5.8 ? "ROOK: It isn't theirs either."
        : line < 8.0 ? "TRAILBLAZER: Leave it."
        : "ROOK: I am leaving with it.";
    }
    this.captionTimer = Math.max(0, this.captionTimer - dt);
    if (!this.state.reveal && this.captionTimer === 0) this.state.caption = "";

    this.contactShadow.position.set(controller.position.x, controller.position.y + 0.012, controller.position.z);
    const shadowMat = this.contactShadow.material as THREE.MeshBasicMaterial;
    shadowMat.opacity = controller.grounded ? 0.42 : Math.max(0.08, 0.42 - Math.abs(controller.verticalRate) * 0.025);
  }

  private startUse(use: number, controller: PlayerController, to: THREE.Vector3) {
    this.active = { use, t: 0, from: controller.position.clone(), to };
    this.state.caption = use === 1 ? "RIDE — HOLD THE LINE" : use === 2 ? "RELEASE — THE LIGHTER SIDE GIVES" : "TRANSFER — LET GO AT THE APEX";
    this.captionTimer = 2.2;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.contactShadow.parent?.remove(this.contactShadow);
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    this.contactShadow.geometry.dispose();
    (this.contactShadow.material as THREE.Material).dispose();
  }
}
