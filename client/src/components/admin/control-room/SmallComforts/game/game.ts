import * as THREE from "three";
import { World, WIN } from "./world";
import { Sound } from "./audio";
import { Fx } from "./fx";
import { Mouse, Mode } from "./mice";
import { makeItem, place, itemCenter, cellPos, bedHeadCell } from "./items";
import { setImportedLampEmissive } from "./assets";
import { AnatomyWorks } from "./anatomy";
import { ResidentLife } from "./residents";
import { rbox, toon, easeOutBack, clamp01 } from "./style";
import {
  Layout, Item, ItemKind, Rot, Cell, emptyLayout, canPlace, prune, itemAt, footprint, onBed, LIMITS, COLS, ROWS, DOOR, ITEM_LABEL, inBounds,
} from "../logic/grid";
import { planGuest, GUEST_ORDER, GUEST_NAME, Plan, GuestId } from "../logic/guests";
import { track, store } from "../config";
import {
  arrivalGate,
  completeProject,
  completeStay,
  emptyEpisode,
  episodeLine,
  nextArrival,
  normalizeEpisode,
  projectStatus,
  roomCapacity,
  type AnatomyProject,
  type EpisodeState,
} from "../logic/episode";

type Phase = "title" | "descent" | "closed" | "opening" | "furnish" | "night" | "morning" | "end";
type Tool = ItemKind | "scissors" | null;

const GUEST_TAG: Record<GuestId, string> = {
  conductor: "He likes to know the trains are running.",
  baker: "She is always a little cold.",
  reader: "He never sleeps without a chapter.",
};
const SPEED = 2.6;
/** frame-time cap; ?dt=0.4 lets slow test machines run the game in real time */
const MAXDT = Number(new URLSearchParams(location.search).get("dt")) || 0.05;

interface SaveData { layout: Layout; nightIdx: number; notes: { guest: GuestId; text: string; happy: boolean }[]; episode?: EpisodeState }

/** the game's own DOM root: every id lookup is scoped here so nothing leaks into the host app */
let UI: HTMLElement = document.body;
const $ = <T extends HTMLElement>(id: string) => UI.querySelector<HTMLElement>("#" + id) as T;
export interface GameOptions { onExit?: () => void; autoStart?: boolean }

interface Run {
  plan: Plan; stage: "enter" | "actions" | "wake" | "card";
  i: number; seg: number; segT: number; poseT: number; started: boolean; lampDone: boolean;
  pos: THREE.Vector3; yaw: number; lying: boolean; zT: number; wakeT: number; lieFrom?: { p: THREE.Vector3; yaw: number; t: number };
  mode: Mode;
}

export class Game {
  world: World;
  sound = new Sound();
  fx = new Fx();
  phase: Phase = "title";
  layout: Layout = emptyLayout();
  history: string[] = [];
  nextId = 1;
  nightIdx = 0;
  notes: SaveData["notes"] = [];
  episode: EpisodeState = emptyEpisode();
  anatomy!: AnatomyWorks;
  residents!: ResidentLife;
  keepsakeGroup = new THREE.Group();
  private storyTimer = 0;
  meshes = new Map<number, THREE.Group>();
  popT = new Map<number, number>();
  lampOn = new Map<number, boolean>();
  armed: Tool = null;
  armRot: Rot = 0;
  selected: number | null = null;
  mouse: Mouse | null = null;
  run: Run | null = null;
  clock = new THREE.Clock();
  time = 0;
  lastF = -1;
  descentT = 0;
  nightTarget = 0;
  selRing: THREE.Mesh;
  bell: THREE.Group;
  bellT = -1;
  cutDots: THREE.Mesh[] = [];
  cutSamples: THREE.Vector2[] = [];
  cutHit: boolean[] = [];
  cutting = false;
  raycaster = new THREE.Raycaster();
  trayDrag: { kind: Tool; sx: number; sy: number; moved: boolean } | null = null;
  itemDrag: { id: number; sx: number; sy: number; moved: boolean } | null = null;
  hoverCell: Cell | null = null;
  snapshotUrl = "";

  ui: HTMLElement;
  opts: GameOptions;
  private disposed = false;
  private cleanups: (() => void)[] = [];
  private on<K extends keyof WindowEventMap>(t: EventTarget, type: string, fn: (e: never) => void) {
    t.addEventListener(type, fn as EventListener);
    this.cleanups.push(() => t.removeEventListener(type, fn as EventListener));
  }

  constructor(host: HTMLElement, ui: HTMLElement, opts: GameOptions = {}) {
    UI = ui; this.ui = ui; this.opts = opts;
    this.world = new World(host);
    this.world.scene.add(this.fx.group);
    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 28), new THREE.MeshBasicMaterial({ color: "#ffd23f" }));
    this.selRing.rotation.x = Math.PI / 2; this.selRing.visible = false; this.world.room.add(this.selRing);
    // doormat + bell
    const mat = rbox(0.8, 0.04, 0.55, "#8E2F3F", 0.03); mat.position.copy(cellPos(DOOR, 0.02)); mat.position.z += 0.1; this.world.room.add(mat);
    this.bell = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon("#d8a93d")); dome.castShadow = true;
    const base = rbox(1.0, 0.12, 1.0, "#2f5f7a", 0.05); base.position.y = -0.04;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), toon("#f2cc6b")); knob.position.y = 0.46;
    this.bell.add(base, dome, knob); this.bell.position.set(4.6, -0.2, 3.2); this.world.scene.add(this.bell);
    this.buildCutDots();
    this.load();
    this.anatomy = new AnatomyWorks();
    this.world.caseGroup.add(this.anatomy.group);
    this.residents = new ResidentLife(this.world.room);
    this.world.room.add(this.keepsakeGroup);
    this.syncEpisodeVisuals();
    this.wireUi();
    this.resize();
    this.on(window, "resize", () => this.resize());
    if (window.visualViewport) this.on(window.visualViewport, "resize", () => this.resize());
    this.world.setCamera(0);
    this.world.setNight(0);
    this.setPhase("title");
    this.world.renderer.setAnimationLoop(() => this.frame());
    if (opts.autoStart) this.begin();
  }

  /** leave the suitcase: stop the loop, free the GPU, drop every listener */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.world.renderer.setAnimationLoop(null);
    for (const f of this.cleanups) f();
    this.cleanups = [];
    this.sound.dispose();
    this.world.dispose();
  }

  // ------------------------------------------------------------------ persistence
  load() {
    const saved = store.get<SaveData | null>("sc.save", null);
    if (saved && saved.layout && Array.isArray(saved.layout.items)) {
      this.layout = saved.layout;
      this.notes = saved.notes || [];
      const migratedEpisode = saved.episode ?? {
        residents: this.notes.map((note, index) => ({ guest: note.guest, branch: "legacy_stay", arrivedOrder: index + 1 })),
        keepsakes: [],
        projects: [],
        arrivals: this.notes.length,
      };
      this.episode = normalizeEpisode(migratedEpisode);
      this.nightIdx = this.episode.residents.length;
      this.nextId = Math.max(0, ...this.layout.items.map(i => i.id)) + 1;
    }
    this.sound.muted = store.get("sc.muted", false);
  }
  save() {
    store.set("sc.save", {
      layout: this.layout,
      nightIdx: this.episode.residents.length,
      notes: this.notes,
      episode: this.episode,
    } satisfies SaveData);
  }

  // ------------------------------------------------------------------ phases
  setPhase(p: Phase) {
    this.phase = p;
    this.ui.dataset.phase = p;
    $("hint").classList.toggle("show", false);
    if (p === "title") { $("title").classList.add("show"); }
    if (p === "closed") this.hint("Tap the latch ✨");
    if (p === "furnish") {
      (this.world.gridPlane.material as THREE.MeshBasicMaterial).opacity = 0.35;
      this.refreshTray();
      const guest = nextArrival(this.episode);
      if (guest) {
        $("guestline").innerHTML = `<b>Next train: ${GUEST_NAME[guest]}.</b> ${GUEST_TAG[guest]}`;
        $("guestline").classList.add("show");
      } else {
        $("guestline").innerHTML = "<b>The little hotel is awake.</b> Everyone on this line has found a place here.";
        $("guestline").classList.add("show");
      }
      $("hotelstatus").textContent = `${episodeLine(this.episode)} Room for ${roomCapacity(this.episode)}.`;
    } else {
      (this.world.gridPlane.material as THREE.MeshBasicMaterial).opacity = 0;
      if (p !== "closed") $("guestline").classList.remove("show");
    }
    $("nightlabel").textContent = p === "end" || p === "title" ? "" : `Lost Property Hotel · ${this.episode.residents.length} home`;
  }
  hint(t: string) { const h = $("hint"); h.textContent = t; h.classList.add("show"); }
  toast(t: string) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout((el as unknown as { _t: number })._t); (el as unknown as { _t: number })._t = window.setTimeout(() => el.classList.remove("show"), 1600); }

  begin() {
    if (this.phase !== "title") return;
    this.sound.start(); this.sound.setMuted(this.sound.muted);
    $("title").classList.remove("show");
    this.setPhase("descent"); this.descentT = 0;
    track("game_started");
  }
  skipIntro() {
    if (this.phase !== "descent") return;
    this.descentT = 3; track("intro_skipped");
  }
  openCase() {
    if (this.phase !== "closed") return;
    this.setPhase("opening");
    this.sound.latch();
    setTimeout(() => this.sound.creak(), 200);
    this.world.openLid(this.time);
    setTimeout(() => { this.sound.thump(); this.sync(true); }, 1350);
    setTimeout(() => this.setPhase("furnish"), 1700);
    track("latch_opened");
  }

  // ------------------------------------------------------------------ layout mutation
  snapshot() { return JSON.stringify(this.layout); }
  push() { this.history.push(this.snapshot()); if (this.history.length > 20) this.history.shift(); }
  commit(mut: (l: Layout) => void) {
    this.push();
    const l: Layout = JSON.parse(this.snapshot());
    mut(l);
    this.layout = prune(l);
    this.sync(); this.save(); this.refreshTray();
  }
  undo() {
    if (this.phase !== "furnish" || !this.history.length) { this.sound.nope(); return; }
    this.layout = JSON.parse(this.history.pop()!);
    if (this.selected !== null && !this.layout.items.some(i => i.id === this.selected)) this.selected = null;
    this.sync(); this.save(); this.refreshTray(); this.sound.pick();
  }

  fitAnchor(kind: ItemKind, c: Cell, rot: Rot): Cell {
    const cells = footprint(kind, 0, 0, rot);
    const maxX = Math.max(...cells.map(k => k.x)), maxZ = Math.max(...cells.map(k => k.z));
    return { x: Math.min(c.x, COLS - 1 - maxX), z: Math.min(c.z, ROWS - 1 - maxZ) };
  }

  tryPlace(kind: ItemKind, cell: Cell) {
    const a = kind === "blanket" ? cell : this.fitAnchor(kind, cell, this.armRot);
    const r = canPlace(this.layout, kind, a.x, a.z, this.armRot);
    if (!r.ok) { this.sound.nope(); this.toast(r.reason); return false; }
    const id = this.nextId++;
    this.commit(l => { l.items.push({ id, kind, x: a.x, z: a.z, rot: this.armRot }); });
    this.popT.set(id, this.time);
    this.sound.place();
    track("item_placed", { kind });
    if (!this.layout.items.some(i => i.id === id)) return true;
    this.armed = null; $("hint").classList.remove("show");
    this.refreshTray();
    return true;
  }

  rotateSelected() {
    if (this.selected === null) {
      if (this.armed && this.armed !== "scissors") { this.armRot = ((this.armRot + 1) % 4) as Rot; this.sound.pick(); this.updateHover(); }
      return;
    }
    const it = this.layout.items.find(i => i.id === this.selected);
    if (!it || it.kind === "blanket" || it.kind === "lamp" || it.kind === "table") { this.sound.nope(); return; }
    const rot = ((it.rot + 1) % 4) as Rot;
    // when the footprint turns, keep the bed's first cell and slide if needed
    const a = this.fitAnchor(it.kind, { x: it.x, z: it.z }, rot);
    const r = canPlace(this.layout, it.kind, a.x, a.z, rot, it.id);
    if (!r.ok) { this.sound.nope(); this.toast(r.reason); return; }
    this.commit(l => { const m = l.items.find(i => i.id === it.id)!; m.rot = rot; m.x = a.x; m.z = a.z; });
    this.popT.set(it.id, this.time); this.sound.pick();
  }
  pickUpSelected() {
    if (this.selected === null) return;
    const id = this.selected; this.selected = null;
    this.commit(l => { l.items = l.items.filter(i => i.id !== id); });
    this.sound.pick();
  }

  // ------------------------------------------------------------------ scene sync
  sync(popNew = false) {
    const room = this.world.room;
    const ids = new Set(this.layout.items.map(i => i.id));
    for (const [id, g] of this.meshes) if (!ids.has(id)) { g.parent?.remove(g); this.meshes.delete(id); this.popT.delete(id); this.lampOn.delete(id); }
    const order = [...this.layout.items].sort((a, b) => (a.kind === "blanket" ? 1 : 0) - (b.kind === "blanket" ? 1 : 0));
    for (const it of order) {
      let g = this.meshes.get(it.id);
      if (!g) {
        g = makeItem(it.kind); g.userData.itemId = it.id; this.meshes.set(it.id, g);
        if (it.kind === "lamp") this.lampOn.set(it.id, true);
        if (popNew && !this.popT.has(it.id)) this.popT.set(it.id, this.time + Math.random() * 0.2);
      }
      if (it.kind === "blanket") {
        const bedId = onBed(this.layout.items, it);
        const bed = this.meshes.get(bedId);
        if (bed && g.parent !== bed) { g.parent?.remove(g); bed.add(g); }
        g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
        // the blanket model lies toward the bed's foot (+z local); good for any bed rotation
      } else {
        if (g.parent !== room) { g.parent?.remove(g); room.add(g); }
        place(g, it);
      }
      if (it.kind === "lamp") this.applyLamp(it.id);
    }
    // the window follows the layout (so undo works)
    if (this.layout.windowCut && !this.world.windowCut) this.world.cutWindow();
    if (!this.layout.windowCut && this.world.windowCut) this.world.restoreWindow();
    this.residents?.sync(this.episode, this.layout, this.time);
    this.updateSelection();
  }
  applyLamp(id: number) {
    const g = this.meshes.get(id); if (!g) return;
    const on = this.lampOn.get(id) !== false;
    g.userData.scLampOn = on;
    setImportedLampEmissive(g, on);
    g.traverse(o => {
      if (o.userData.lampLight) (o as THREE.PointLight).intensity = on ? 5 : 0;
      if (o.userData.shade) {
        const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial;
        m.emissiveIntensity = on ? 0.9 : 0.0; m.color.set(on ? "#fff2cf" : "#b9ad92");
      }
    });
  }
  updateSelection() {
    const it = this.layout.items.find(i => i.id === this.selected);
    if (!it) { this.selRing.visible = false; this.selected = null; }
    else { this.selRing.visible = true; const c = itemCenter(it); this.selRing.position.set(c.x, 0.05, c.z); const big = it.kind === "bed" ? 1.2 : it.kind === "rug" ? 1.4 : 0.75; this.selRing.scale.setScalar(big); }
    $("btn-rotate").toggleAttribute("disabled", false);
    $("btn-pick").toggleAttribute("disabled", this.selected === null);
  }

  // ------------------------------------------------------------------ cut window
  buildCutDots() {
    const n = 40;
    const perim: THREE.Vector2[] = [];
    const { x0, x1, y0, y1 } = WIN;
    const w = x1 - x0, h = y1 - y0, P = 2 * (w + h);
    for (let i = 0; i < n; i++) {
      let d = (i / n) * P; let x: number, y: number;
      if (d < w) { x = x0 + d; y = y1; } else if ((d -= w) < h) { x = x1; y = y1 - d; } else if ((d -= h) < w) { x = x1 - d; y = y0; } else { d -= w; x = x0; y = y0 + d; }
      perim.push(new THREE.Vector2(x, y));
    }
    this.cutSamples = perim;
    this.cutHit = perim.map(() => false);
    perim.forEach(p => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: "#8E2F3F" }));
      dot.position.set(p.x, p.y, -1.95); dot.visible = false; this.world.caseGroup.add(dot); this.cutDots.push(dot);
    });
  }
  showCutGuide(on: boolean) {
    (this.world.cutGuide.material as THREE.MeshBasicMaterial).opacity = on && !this.layout.windowCut ? 0.95 : 0;
    this.cutDots.forEach(d => (d.visible = on && !this.layout.windowCut));
    if (!on) { this.cutHit.fill(false); this.cutDots.forEach(d => ((d.material as THREE.MeshBasicMaterial).color.set("#8E2F3F"))); }
  }
  cutMove(ndc: THREE.Vector2) {
    this.raycaster.setFromCamera(ndc, this.world.camera);
    const hit = this.raycaster.intersectObject(this.world.wallPlane, false)[0];
    if (!hit) return;
    const p = hit.point;
    let fresh = 0;
    this.cutSamples.forEach((s, i) => {
      if (!this.cutHit[i] && Math.hypot(s.x - p.x, s.y - p.y) < 0.34) {
        this.cutHit[i] = true; fresh++;
        (this.cutDots[i].material as THREE.MeshBasicMaterial).color.set("#e0a93b"); this.cutDots[i].scale.setScalar(1.6);
      }
    });
    if (fresh) this.sound.rip();
    if (this.cutHit.filter(Boolean).length >= this.cutSamples.length * 0.86) this.finishCut();
  }
  finishCut() {
    this.cutting = false;
    this.commit(l => { l.windowCut = true; l.windowCol = 3; });
    this.showCutGuide(false);
    this.armed = null; this.refreshTray();
    this.sound.rip(); setTimeout(() => this.sound.thump(), 700);
    this.toast("The lining opens to the railway. The loose flap could become steps.");
    this.refreshProjects();
    track("window_cut");
  }

  // ------------------------------------------------------------------ pointer
  ndcOf(e: { clientX: number; clientY: number }) {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  cellAt(e: { clientX: number; clientY: number }): Cell | null {
    this.raycaster.setFromCamera(this.ndcOf(e), this.world.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.0), p)) return null;
    const c = { x: Math.floor(p.x + COLS / 2), z: Math.floor(p.z + ROWS / 2) };
    return inBounds(c) ? c : null;
  }
  itemUnder(e: { clientX: number; clientY: number }): number | null {
    this.raycaster.setFromCamera(this.ndcOf(e), this.world.camera);
    const groups = [...this.meshes.values()];
    const hits = this.raycaster.intersectObjects(groups, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) { if (o.userData.itemId !== undefined) return o.userData.itemId as number; o = o.parent; }
    }
    const c = this.cellAt(e);
    if (c) { const it = itemAt(this.layout, c); if (it) return it.id; }
    return null;
  }

  onCanvasDown(e: PointerEvent) {
    if (this.phase === "title") return;
    if (this.phase === "descent") { this.skipIntro(); return; }
    if (this.phase === "closed") {
      this.raycaster.setFromCamera(this.ndcOf(e), this.world.camera);
      if (this.world.pickLatch(this.raycaster)) this.openCase();
      return;
    }
    if (this.phase !== "furnish") return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (this.armed === "scissors") { if (!this.layout.windowCut) { this.cutting = true; this.cutMove(this.ndcOf(e)); } return; }
    if (this.armed) { this.hoverCell = this.cellAt(e); this.updateHover(); return; }
    const id = this.itemUnder(e);
    if (id !== null) { this.itemDrag = { id, sx: e.clientX, sy: e.clientY, moved: false }; this.selected = id; this.updateSelection(); this.sound.pick(); }
    else { this.selected = null; this.updateSelection(); }
  }
  onCanvasMove(e: PointerEvent) {
    if (this.phase !== "furnish") return;
    if (this.cutting) { this.cutMove(this.ndcOf(e)); return; }
    this.hoverCell = this.cellAt(e);
    if (this.itemDrag) {
      if (Math.hypot(e.clientX - this.itemDrag.sx, e.clientY - this.itemDrag.sy) > 10) this.itemDrag.moved = true;
    }
    this.updateHover();
  }
  onCanvasUp(e: PointerEvent) {
    if (this.phase !== "furnish") return;
    if (this.cutting) { this.cutting = false; return; }
    const c = this.cellAt(e);
    if (this.itemDrag) {
      const d = this.itemDrag; this.itemDrag = null;
      if (d.moved && c) this.moveItem(d.id, c);
      this.clearHover(); return;
    }
    if (this.armed && this.armed !== "scissors" && c) { this.tryPlace(this.armed, c); }
    this.clearHover();
  }
  moveItem(id: number, c: Cell) {
    const it = this.layout.items.find(i => i.id === id); if (!it) return;
    const a = it.kind === "blanket" ? c : this.fitAnchor(it.kind, c, it.rot);
    const r = canPlace(this.layout, it.kind, a.x, a.z, it.rot, id);
    if (!r.ok) { this.sound.nope(); this.toast(r.reason); return; }
    this.commit(l => { const m = l.items.find(i => i.id === id)!; m.x = a.x; m.z = a.z; });
    this.popT.set(id, this.time); this.sound.place();
  }

  updateHover() {
    const grp = this.world.hoverCells;
    grp.clear();
    if (!this.hoverCell) return;
    let kind: ItemKind | null = null; let rot: Rot = this.armRot; let ignore: number | undefined;
    if (this.armed && this.armed !== "scissors") kind = this.armed;
    else if (this.itemDrag?.moved) { const it = this.layout.items.find(i => i.id === this.itemDrag!.id); if (it) { kind = it.kind; rot = it.rot; ignore = it.id; } }
    if (!kind) return;
    const a = kind === "blanket" ? this.hoverCell : this.fitAnchor(kind, this.hoverCell, rot);
    const ok = canPlace(this.layout, kind, a.x, a.z, rot, ignore).ok;
    for (const c of footprint(kind, a.x, a.z, rot)) {
      if (!inBounds(c)) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), new THREE.MeshBasicMaterial({ color: ok ? "#7be28a" : "#ff6b6b", transparent: true, opacity: 0.55, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; const p = cellPos(c, 0.03); m.position.copy(p); grp.add(m);
    }
  }
  clearHover() { this.world.hoverCells.clear(); }

  // ------------------------------------------------------------------ tray + buttons
  refreshTray() {
    this.ui.querySelectorAll<HTMLButtonElement>("#tray button").forEach(b => {
      const k = b.dataset.kind as Tool;
      if (k === "scissors") { b.classList.toggle("armed", this.armed === k); b.disabled = this.layout.windowCut; return; }
      const n = this.layout.items.filter(i => i.kind === k).length;
      const lim = LIMITS[k as ItemKind];
      b.disabled = n >= lim;
      b.classList.toggle("armed", this.armed === k);
      const badge = b.querySelector(".badge"); if (badge) badge.textContent = `${lim - n}`;
    });
    $("btn-undo").toggleAttribute("disabled", this.history.length === 0);
    this.showCutGuide(this.armed === "scissors");
    this.refreshProjects();
    this.refreshBell();
  }
  armTool(k: Tool) {
    if (this.phase !== "furnish") return;
    this.armed = this.armed === k ? null : k; this.selected = null; this.updateSelection(); this.armRot = 0;
    this.sound.pick(); this.refreshTray();
    if (this.armed === "scissors") this.hint("Drag along the dotted line");
    else if (this.armed) this.hint(`${ITEM_LABEL[this.armed as ItemKind]}: tap a spot in the room`);
    else $("hint").classList.remove("show");
    if (this.armed) setTimeout(() => $("hint").classList.remove("show"), 2200);
  }

  wireUi() {
    const canvas = this.world.renderer.domElement;
    canvas.addEventListener("pointerdown", e => this.onCanvasDown(e));
    canvas.addEventListener("pointermove", e => this.onCanvasMove(e));
    canvas.addEventListener("pointerup", e => this.onCanvasUp(e));
    canvas.addEventListener("pointercancel", () => { this.cutting = false; this.itemDrag = null; this.clearHover(); });
    $("btn-begin").addEventListener("click", () => this.begin());
    $("skip").addEventListener("click", () => this.skipIntro());
    this.ui.querySelectorAll<HTMLButtonElement>("#tray button").forEach(b => {
      b.addEventListener("pointerdown", e => {
        if (this.phase !== "furnish" || b.disabled) return;
        this.trayDrag = { kind: b.dataset.kind as Tool, sx: e.clientX, sy: e.clientY, moved: false };
      });
    });
    this.on(window, "pointermove", (e: PointerEvent) => {
      const d = this.trayDrag; if (!d) return;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 14) d.moved = true;
      if (d.moved && d.kind && d.kind !== "scissors") { this.armed = d.kind; this.hoverCell = this.cellAt(e); this.updateHover(); }
    });
    this.on(window, "pointerup", (e: PointerEvent) => {
      const d = this.trayDrag; if (!d) return; this.trayDrag = null;
      if (d.moved && d.kind && d.kind !== "scissors") {
        const c = this.cellAt(e);
        if (c) this.tryPlace(d.kind, c);
        this.armed = null; this.clearHover(); this.refreshTray();
      } else this.armTool(d.kind);
    });
    $("btn-undo").addEventListener("click", () => this.undo());
    $("btn-rotate").addEventListener("click", () => this.rotateSelected());
    $("btn-pick").addEventListener("click", () => this.pickUpSelected());
    this.ui.querySelectorAll<HTMLButtonElement>("#anatomy button").forEach(button => {
      button.addEventListener("click", () => this.buildProject(button.dataset.project as AnatomyProject));
    });
    $("btn-bell").addEventListener("click", () => this.ring());
    $("btn-mute").addEventListener("click", () => {
      this.sound.setMuted(!this.sound.muted); store.set("sc.muted", this.sound.muted);
      $("btn-mute").textContent = this.sound.muted ? "🔇" : "🔊";
    });
    $("btn-mute").textContent = this.sound.muted ? "🔇" : "🔊";
    $("btn-next").addEventListener("click", () => this.nextGuest());
    $("btn-again").addEventListener("click", () => this.playAgain());
    $("btn-save").addEventListener("click", () => this.saveSnapshot());
    $("btn-exit").addEventListener("click", () => this.exit());
    $("btn-leave").addEventListener("click", () => this.exit());
    this.on(window, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") { this.exit(); return; }
      if (e.key === "Enter" && this.phase === "closed") this.openCase();
      if ((e.key === "r" || e.key === "R") && this.phase === "furnish") this.rotateSelected();
      if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) this.undo();
      if ((e.key === "Delete" || e.key === "Backspace") && this.phase === "furnish") this.pickUpSelected();
    });
  }

  exit() { track("left_suitcase"); this.opts.onExit?.(); }

  // ------------------------------------------------------------------ the night
  ring() {
    if (this.phase !== "furnish") return;
    const gate = arrivalGate(this.episode);
    const guest = nextArrival(this.episode);
    if (!gate.canRing || !guest) {
      this.sound.nope();
      this.toast(gate.reason);
      return;
    }
    this.armed = null; this.selected = null; this.updateSelection(); this.refreshTray(); this.clearHover();
    this.sound.bell(); this.bellT = this.time;
    track("bell_rung", { arrival: this.episode.arrivals + 1, guest });
    this.plan(guest);
    this.setPhase("night");
    $("hint").classList.remove("show");
  }
  plan(guest: GuestId) {
    const plan = planGuest(guest, this.layout);
    const m = new Mouse(guest);
    this.mouse = m;
    this.world.room.add(m.root);
    this.lampOn.forEach((_v, id) => { this.lampOn.set(id, true); this.applyLamp(id); });
    const start = cellPos(DOOR); start.z += 1.9;
    m.root.position.copy(start);
    m.root.scale.setScalar(0.001);
    this.popT.set(-1, this.time);
    this.run = { plan, stage: "enter", i: 0, seg: 0, segT: 0, poseT: 0, started: false, lampDone: false, pos: start.clone(), yaw: Math.PI, lying: false, zT: 0, wakeT: 0, mode: "walk" };
    this.nightTarget = 0.35;
  }

  heightAt(p: THREE.Vector3): number {
    const c = { x: Math.round(p.x + 2.5), z: Math.round(p.z + 1.5) };
    const it = itemAt(this.layout, c, false);
    if (!it) return 0;
    const top = this.layout.items.filter(i => footprint(i.kind, i.x, i.z, i.rot).some(f => f.x === c.x && f.z === c.z));
    if (top.some(i => i.kind === "bed")) return 0.5;
    if (top.some(i => i.kind === "armchair")) return 0.18;
    if (top.some(i => i.kind === "rug")) return 0.04;
    return 0;
  }

  lyingTransform(plan: Plan): { p: THREE.Vector3; yaw: number; y: number } {
    const s = plan.sleep;
    if (s.kind === "bed") {
      const it = this.layout.items.find(i => i.id === s.itemId);
      if (it) {
        const { head, foot } = bedHeadCell(it);
        const hp = cellPos(head), fp = cellPos(foot);
        const mid = hp.clone().add(fp).multiplyScalar(0.5);
        const toHead = hp.clone().sub(fp).normalize();
        mid.addScaledVector(toHead, 0.1);
        return { p: mid, yaw: Math.atan2(-toHead.x, -toHead.z), y: 0.5 };
      }
    }
    if (s.kind === "chair") {
      const it = this.layout.items.find(i => i.id === s.itemId);
      const rot = it ? it.rot : 0;
      return { p: cellPos(s.spot), yaw: rot * (Math.PI / 2), y: 0.18 };
    }
    return { p: cellPos(s.spot), yaw: 0, y: s.kind === "rug" ? 0.04 : 0.02 };
  }

  setMode(m: Mode) { if (this.run && this.mouse) { this.run.mode = m; this.mouse.setMode(m, this.time); } }

  tickRun(dt: number) {
    const r = this.run, m = this.mouse; if (!r || !m) return;
    const plan = r.plan;
    const grow = clamp01((this.time - (this.popT.get(-1) ?? 0)) / 0.35);
    if (r.stage !== "card") m.root.scale.setScalar(Math.max(0.001, easeOutBack(grow)));

    if (r.stage === "enter") {
      const target = cellPos(DOOR);
      const d = target.clone().sub(r.pos); d.y = 0;
      const step = SPEED * dt;
      if (d.length() <= step) { r.pos.copy(target); r.stage = "actions"; r.i = 0; r.started = false; this.setMode("idle"); }
      else { r.pos.addScaledVector(d.normalize(), step); r.yaw = Math.atan2(d.x, d.z); this.setMode("walk"); m.walkPhase += dt * 11; }
      return;
    }

    if (r.stage === "actions") {
      const a = plan.actions[r.i];
      if (!a) { r.stage = "wake"; r.wakeT = 0; return; }
      if (a.t === "walk") {
        if (r.lying) this.getUp(r);
        if (!r.started) { r.started = true; r.seg = 1; this.setMode("walk"); if (a.path.length < 2) { r.i++; r.started = false; return; } }
        this.setMode("walk");
        const to = cellPos(a.path[r.seg]);
        const d = to.clone().sub(r.pos); d.y = 0;
        const step = SPEED * dt;
        m.walkPhase += dt * 11;
        if (d.length() <= step) {
          r.pos.copy(to); r.seg++;
          if (r.seg >= a.path.length) { r.i++; r.started = false; }
        } else { r.pos.addScaledVector(d.normalize(), step); r.yaw = Math.atan2(d.x, d.z); }
        return;
      }
      // pose
      if (!r.started) {
        r.started = true; r.poseT = 0;
        this.beginPose(r, a);
      }
      r.poseT += dt;
      // feel the lamp go out at the click
      if (r.i === plan.lampOffAt && !r.lampDone && r.poseT > 0.35 && (a.name === "click" || a.name === "flick")) this.lampOff(r);
      if (r.lieFrom) {
        const k = clamp01((this.time - r.lieFrom.t) / 0.45);
        const tr = this.lyingTransform(plan);
        r.pos.lerpVectors(r.lieFrom.p, tr.p, k); r.pos.y = tr.y * k + Math.sin(k * Math.PI) * 0.35;
        r.yaw = THREE.MathUtils.lerp(r.lieFrom.yaw, tr.yaw, k);
        if (k >= 1) { r.lieFrom = undefined; this.sound.thump(); }
      }
      if (a.name === "sleep" || a.name === "read" || a.name === "watch-train" || a.name === "tiptoe" || a.name === "squint") { /* hold */ }
      if (a.name === "sleep") { r.zT += dt; if (r.zT > 1.1) { r.zT = 0; this.fx.z(m.root.position.clone().add(new THREE.Vector3(0.1, 1.0 + (r.lying ? 0.2 : 0), 0))); this.sound.zzz(); } }
      if (r.poseT >= a.ms / 1000) {
        r.i++; r.started = false;
        if (r.i >= plan.actions.length) {
          // all done: hold in sleep. The lamp may still be on if it was out of reach.
          r.stage = "wake"; r.wakeT = 0;
          this.nightTarget = r.lampDone || plan.lamp.method === "none" ? 1 : 0.9;
        }
      }
      return;
    }

    if (r.stage === "wake") {
      r.wakeT += dt;
      r.zT += dt; if (r.zT > 1.1 && r.wakeT < 2.2) { r.zT = 0; this.fx.z(m.root.position.clone().add(new THREE.Vector3(0.1, 1.2, 0))); }
      if (r.wakeT > 2.6 && this.phase !== "morning") {
        this.phase = "morning"; this.ui.dataset.phase = "morning";
        this.nightTarget = 0; this.sound.chime();
        this.setMode(r.lying ? "lie" : "idle");
      }
      if (r.wakeT > 4.4 && r.stage === "wake") { r.stage = "card"; this.settleCurrentGuest(); }
    }
  }

  getUp(r: Run) {
    r.lying = false;
    if (this.mouse) { this.mouse.lying = false; this.mouse.baseY = 0; }
  }

  beginPose(r: Run, a: Extract<Plan["actions"][number], { t: "pose" }>) {
    const m = this.mouse!, plan = r.plan, s = plan.sleep;
    const faceYaw = a.face ? Math.atan2((a.face.x - (COLS - 1) / 2) - r.pos.x, (a.face.z - (ROWS - 1) / 2) - r.pos.z) : null;
    let mode: Mode = a.name as Mode;
    if (a.name === "lie") {
      if (s.kind === "chair") { mode = "nap"; r.pos.copy(cellPos(s.spot)); }
      else { r.lying = true; m.lying = true; r.lieFrom = { p: r.pos.clone(), yaw: r.yaw, t: this.time }; mode = "lie"; }
      this.nightTarget = Math.max(this.nightTarget, 0.7);
      this.setMode(mode); return;
    }
    if (s.kind === "chair" && r.i >= 0 && (a.name === "sleep" || a.name === "wrap" || a.name === "shiver")) mode = "nap";
    if (a.name === "sleep") this.nightTarget = r.lampDone || plan.lamp.method === "none" ? 1 : Math.max(this.nightTarget, 0.9);
    if (faceYaw !== null && !r.lying && a.name !== "sit" && a.name !== "read") r.yaw = faceYaw;
    if ((a.name === "sit" || a.name === "read" || a.name === "squint") && a.face && plan.pre.startsWith("chair")) {
      // chair faces are given in cell coordinates; recompute in world space
      const f = new THREE.Vector3(a.face.x - (COLS - 1) / 2, 0, a.face.z - (ROWS - 1) / 2).sub(r.pos);
      r.yaw = Math.atan2(f.x, f.z);
    }
    if (a.name === "keyhole") r.yaw = 0;
    this.setMode(mode);
    if (a.name === "bump") { this.sound.bump(); this.fx.stars(m.root.position.clone().add(new THREE.Vector3(0, 1.0, 0))); }
    if (a.name === "sigh") this.sound.sigh();
    if (a.name === "watch-train") { this.world.spawnTrain(); this.sound.trainRumble(); }
    if (a.name === "click") this.sound.pick();
  }

  lampOff(r: Run) {
    r.lampDone = true;
    const c = r.plan.lamp.lampCell; if (!c) return;
    const it = this.layout.items.find(i => i.kind === "lamp" && i.x === c.x && i.z === c.z);
    if (it) { this.lampOn.set(it.id, false); this.applyLamp(it.id); }
    this.sound.lampClick();
    this.nightTarget = 1;
  }

  showStory(text: string, ms = 4200) {
    const el = $("story");
    el.textContent = text;
    el.classList.add("show");
    window.clearTimeout(this.storyTimer);
    this.storyTimer = window.setTimeout(() => el.classList.remove("show"), ms);
  }

  refreshProjects() {
    this.ui.querySelectorAll<HTMLButtonElement>("#anatomy button").forEach(button => {
      const project = button.dataset.project as AnatomyProject;
      const status = projectStatus(project, this.episode, this.layout);
      button.disabled = !status.available;
      button.classList.toggle("is-complete", status.complete);
      button.title = status.reason;
      button.setAttribute("aria-label", status.complete ? `${status.reason}` : `${button.textContent?.trim() ?? project}. ${status.reason}`);
    });
  }

  refreshBell() {
    const button = $("btn-bell") as HTMLButtonElement;
    const gate = arrivalGate(this.episode);
    button.disabled = !gate.canRing;
    const label = button.querySelector("span:last-child");
    if (label) label.textContent = gate.canRing ? "Open the hotel" : this.episode.residents.length >= GUEST_ORDER.length ? "Hotel is home" : "Make room first";
    button.title = gate.reason;
  }

  buildProject(project: AnatomyProject) {
    if (this.phase !== "furnish") return;
    const status = projectStatus(project, this.episode, this.layout);
    if (!status.available) {
      this.sound.nope();
      this.toast(status.reason);
      return;
    }
    this.episode = completeProject(this.episode, project);
    this.anatomy.sync(this.episode.projects, this.time);
    this.residents.sync(this.episode, this.layout, this.time);
    this.save();
    this.sound.thump();
    const line =
      project === "lining_stairs" ? "You fold the loose lining into four soft steps. The lid pocket is reachable now." :
      project === "strap_hammock" ? "The old luggage straps take the weight. There is room for another traveler." :
      "The satin pocket becomes a tiny loft. It feels like a room that was hiding there all along.";
    this.showStory(line);
    this.refreshTray();
    track("anatomy_built", { project });
  }

  syncEpisodeVisuals() {
    this.anatomy?.sync(this.episode.projects, this.time);
    this.residents?.sync(this.episode, this.layout, this.time);
    this.syncKeepsakes();
  }

  syncKeepsakes() {
    while (this.keepsakeGroup.children.length) this.keepsakeGroup.remove(this.keepsakeGroup.children[0]);
    for (const memory of this.episode.keepsakes) {
      if (memory.kind === "ticket") {
        const ticket = rbox(0.38, 0.025, 0.18, "#d9c48f", 0.015, false);
        ticket.position.set(2.05, 0.055, -1.28);
        ticket.rotation.y = -0.25;
        this.keepsakeGroup.add(ticket);
      } else if (memory.kind === "bun") {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), toon("#b97738"));
        bun.scale.set(1.15, 0.65, 0.9);
        bun.position.set(0.55, 0.12, 0.55);
        bun.castShadow = true;
        this.keepsakeGroup.add(bun);
      } else {
        const mark = rbox(0.12, 0.018, 0.42, "#8E2F3F", 0.012, false);
        mark.position.set(-1.95, 0.05, -0.95);
        mark.rotation.y = 0.15;
        this.keepsakeGroup.add(mark);
      }
    }
  }

  settleCurrentGuest() {
    const r = this.run;
    const mouse = this.mouse;
    if (!r || !mouse) return;
    const plan = r.plan;

    this.episode = completeStay(this.episode, plan.guest, plan.branch);
    const record = this.episode.residents.find(resident => resident.guest === plan.guest)!;
    this.notes.push({ guest: plan.guest, text: plan.note, happy: plan.happy });
    this.residents.adopt(record, mouse, this.episode, this.layout, this.time);
    this.mouse = null;
    this.run = null;
    this.nightIdx = this.episode.residents.length;
    this.lampOn.forEach((_v, id) => { this.lampOn.set(id, true); this.applyLamp(id); });
    this.nightTarget = 0.18;
    this.syncEpisodeVisuals();
    this.save();
    this.setPhase("furnish");

    const memory = this.episode.keepsakes.find(k => k.guest === plan.guest);
    const gate = arrivalGate(this.episode);
    const next = nextArrival(this.episode);
    const coda = next
      ? gate.canRing
        ? ` ${GUEST_NAME[next]} is somewhere down the line.`
        : ` ${gate.reason}`
      : " No one leaves in a puff of smoke. This is their home now.";
    this.showStory(`${GUEST_NAME[plan.guest]} settles in. ${memory?.text ?? ""}${coda}`, 6200);
    track("guest_became_resident", { guest: plan.guest, branch: plan.branch, residents: this.episode.residents.length });
    this.saveSnapshotQuiet();
  }

  showNote() {
    const r = this.run!; const plan = r.plan;
    this.notes.push({ guest: plan.guest, text: plan.note, happy: plan.happy });
    this.save();
    $("note-from").textContent = GUEST_NAME[plan.guest];
    $("note-text").textContent = `“${plan.note}”`;
    $("note-tag").textContent = plan.happy ? "★ A perfect stay" : "Made do, politely";
    $("btn-next").textContent = this.nightIdx >= GUEST_ORDER.length - 1 ? "See the guesthouse" : "Next guest →";
    $("card").classList.add("show");
    track("guest_completed", { guest: plan.guest, branch: plan.branch, happy: plan.happy });
    this.saveSnapshotQuiet();
  }

  nextGuest() {
    $("card").classList.remove("show");
    if (this.mouse) {
      this.fx.poof(this.mouse.root.position.clone().add(new THREE.Vector3(0, 0.6, 0)));
      this.mouse.root.parent?.remove(this.mouse.root); this.mouse = null;
    }
    this.run = null;
    this.nightIdx++;
    this.lampOn.forEach((_v, id) => { this.lampOn.set(id, true); this.applyLamp(id); });
    this.save();
    if (this.nightIdx >= GUEST_ORDER.length) { this.showEnd(); return; }
    this.setPhase("furnish");
  }

  saveSnapshotQuiet() {
    try {
      this.world.renderer.render(this.world.scene, this.world.camera);
      const src = this.world.renderer.domElement;
      const c = document.createElement("canvas");
      // crop to the suitcase and a slice of window
      const sx = src.width * 0.14, sw = src.width * 0.72, sy = src.height * 0.1, sh = src.height * 0.82;
      const W = 1200, H = Math.round(W * (sh / sw));
      c.width = W; c.height = H + 90;
      const g = c.getContext("2d")!;
      g.fillStyle = "#1e2c3e"; g.fillRect(0, 0, W, c.height);
      g.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
      g.fillStyle = "#F6EBD3"; g.fillRect(0, H, W, 90);
      g.fillStyle = "#2f5f7a"; g.font = "bold 40px 'Trebuchet MS', sans-serif"; g.fillText("Small Comforts", 30, H + 56);
      g.font = "26px 'Trebuchet MS', sans-serif"; g.fillStyle = "#8E2F3F"; g.textAlign = "right"; g.fillText("a tiny guesthouse in a lost-property suitcase", W - 30, H + 54);
      this.snapshotUrl = c.toDataURL("image/png");
    } catch { /* tainted/unsupported: no snapshot */ }
  }

  async saveSnapshot() {
    if (!this.snapshotUrl) this.saveSnapshotQuiet();
    if (!this.snapshotUrl) return;
    track("snapshot_saved");
    try {
      const blob = await (await fetch(this.snapshotUrl)).blob();
      const file = new File([blob], "small-comforts.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "Small Comforts" }); return; }
    } catch { /* fall through to download */ }
    const a = document.createElement("a"); a.href = this.snapshotUrl; a.download = "small-comforts.png"; a.click();
  }

  showEnd() {
    this.setPhase("end");
    this.saveSnapshotQuiet();
    const img = $("end-snap") as HTMLImageElement; if (this.snapshotUrl) img.src = this.snapshotUrl;
    const list = $("end-notes"); list.innerHTML = "";
    for (const n of this.notes.slice(-3)) {
      const li = document.createElement("li");
      li.innerHTML = `<b>${GUEST_NAME[n.guest]}</b> ${n.happy ? "★" : ""}<br><i></i>`;
      (li.querySelector("i") as HTMLElement).textContent = `“${n.text}”`;
      list.appendChild(li);
    }
    $("end").classList.add("show");
    track("game_completed");
  }

  playAgain() {
    $("end").classList.remove("show");
    this.layout = emptyLayout(); this.history = []; this.notes = []; this.episode = emptyEpisode(); this.nightIdx = 0; this.nextId = 1; this.selected = null;
    this.sync(); this.save();
    this.setPhase("furnish");
    track("play_again");
  }

  // ------------------------------------------------------------------ loop
  resize() {
    const w = window.innerWidth, h = window.visualViewport?.height ?? window.innerHeight;
    this.world.resize(w, Math.round(h));
    this.ui.classList.toggle("portrait", w < h);
  }

  frame() {
    const dt = Math.min(MAXDT, this.clock.getDelta());
    this.time += dt;
    const t = this.time;
    if (this.phase === "descent") {
      this.descentT += dt;
      const k = clamp01(this.descentT / 3.0);
      this.world.setCamera(k);
      $("skip").classList.toggle("show", true);
      if (k >= 1) { $("skip").classList.remove("show"); this.setPhase("closed"); this.world.setCamera(1); }
    } else if (this.phase === "title") {
      this.world.setCamera(0 + Math.sin(t * 0.4) * 0.0);
    } else if (this.phase === "closed" || this.phase === "opening" || this.phase === "furnish" || this.phase === "night" || this.phase === "morning" || this.phase === "end") {
      if (this.world.introT < 1) this.world.setCamera(1);
    }
    // night eases toward its target (full rate: it's lighting, not a character)
    const n = this.world.night + (this.nightTarget - this.world.night) * Math.min(1, dt * 1.6);
    if (Math.abs(n - this.world.night) > 0.0005) { this.world.setNight(n); this.sound.setRain(1 - n * 0.6); }
    // lamps: a warm pool grows with the dark
    this.world.update(dt, t);
    this.anatomy.update(t);
    this.fx.update(dt);
    if (this.phase === "night" || this.phase === "morning") this.tickRun(dt);
    // stop-motion: characters only move on 12 fps frames
    const f12 = Math.floor(t * 12);
    if (f12 !== this.lastF) {
      this.lastF = f12;
      if (this.mouse && this.run) {
        const r = this.run;
        this.mouse.root.position.set(r.pos.x, r.lying || r.lieFrom ? r.pos.y : this.heightAt(r.pos), r.pos.z);
        if (!r.lying && !r.lieFrom) this.mouse.root.position.y = this.heightAt(r.pos);
        this.mouse.root.rotation.y = r.yaw;
        this.mouse.baseY = 0;
        this.mouse.update(f12 / 12);
      }
      this.residents.update(f12 / 12);
    }
    // item pop-ins, full rate
    for (const [id, g] of this.meshes) {
      const t0 = this.popT.get(id);
      if (t0 === undefined) continue;
      const k = clamp01((t - t0) / 0.4);
      if (k < 0) { g.scale.setScalar(0.001); continue; }
      const s = easeOutBack(k);
      g.scale.set(s, Math.max(0.001, 1 + (s - 1) * 1.6), s);
      if (k >= 1) { this.popT.delete(id); g.scale.setScalar(1); }
    }
    if (this.selRing.visible) this.selRing.scale.multiplyScalar(1); // keep
    if (this.bellT >= 0) {
      const k = (t - this.bellT);
      this.bell.rotation.z = Math.sin(k * 30) * 0.2 * Math.max(0, 1 - k * 1.2);
      this.bell.position.y = -0.2 + Math.abs(Math.sin(k * 14)) * 0.12 * Math.max(0, 1 - k * 1.5);
      if (k > 1) this.bellT = -1;
    }
    this.world.render();
  }
}
