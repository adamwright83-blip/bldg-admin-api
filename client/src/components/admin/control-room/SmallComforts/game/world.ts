import * as THREE from "three";
import { PAL, rbox, cyl, ball, toon, makeCloud, canvasTex, easeInOut, easeOutBack, clamp01, inked } from "./style";
import { COLS, ROWS } from "../logic/grid";
import { SMALL_COMFORTS_ART } from "../logic/artAssets";
import { loadSuitcaseArt } from "./assets";

const WH = 1.9; // suitcase wall height
export const WIN = { x0: 0, x1: 2, y0: 0.62, y1: 1.52, z: -2.0 };

function lerpColor(a: string, b: string, t: number) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  sun = new THREE.DirectionalLight("#fff0d0", 2.4);
  hemi = new THREE.HemisphereLight("#dbe9ff", "#b58a5a", 1.15);
  room = new THREE.Group(); // furniture lives here
  caseGroup = new THREE.Group();
  lidPivot = new THREE.Group();
  private importedCase: THREE.Group | null = null;
  private importedLid: THREE.Object3D | null = null;
  private importedLatch: THREE.Object3D | null = null;
  private legacyCaseVisuals: THREE.Object3D[] = [];
  private disposed = false;
  frontWall!: THREE.Mesh;
  latch = new THREE.Group();
  latchHit!: THREE.Mesh;
  cutPiece!: THREE.Mesh;
  cutGuide!: THREE.Mesh;
  gridPlane!: THREE.Mesh;
  hoverCells = new THREE.Group();
  floorPlane!: THREE.Mesh;
  wallPlane!: THREE.Mesh;
  skyNight!: THREE.Mesh;
  clouds: { m: THREE.Mesh; v: THREE.Vector3; base: THREE.Vector3 }[] = [];
  introClouds = new THREE.Group();
  rain!: THREE.LineSegments;
  rainPos!: Float32Array;
  night = 0;
  rainAmt = 1;
  lidT = 0; // 0 closed .. 1 open
  lidAnim: { from: number; to: number; t0: number; dur: number } | null = null;
  cutAnim = -1;
  holeCanvas!: HTMLCanvasElement;
  holeTex!: THREE.CanvasTexture;
  holeView!: THREE.Mesh;
  holeFrame!: THREE.Group;
  holeTrainT = -1;
  windowCut = false;
  lampsOn = 0;
  train: Train;
  time = 0;
  // camera state
  introT = 0; // 0 = high in the clouds, 1 = at the desk
  private target = new THREE.Vector3(0, 1.2, 0.3);
  portraitPull = 1;

  constructor(canvasHost: HTMLElement) {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    canvasHost.appendChild(r.domElement);
    r.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
    this.scene.background = new THREE.Color(PAL.sky);

    this.sun.position.set(-6, 11, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 40;
    this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.hemi);

    this.buildDesk();
    this.buildStation();
    this.buildCase();
    void this.hydrateSuitcaseArt();
    this.buildIntroClouds();
    this.train = new Train();
    this.train.group.position.set(0, 0.25, -9.2);
    this.scene.add(this.train.group);
    this.buildRain();
    this.scene.add(this.caseGroup);
    this.caseGroup.add(this.room);
    this.setCamera(0);
  }

  // ------------------------------------------------------------------ desk + lost property room
  private buildDesk() {
    const desk = rbox(44, 0.7, 28, PAL.desk, 0.15, false);
    desk.position.set(0, -0.65, 6.95); desk.receiveShadow = true; this.scene.add(desk);
    const edge = rbox(44.2, 0.12, 28.2, PAL.deskDark, 0.06, false); edge.position.set(0, -0.98, 6.95); this.scene.add(edge);
    // wood grain streaks
    const grain = canvasTex(256, 256, g => {
      g.fillStyle = "rgba(0,0,0,0)"; g.clearRect(0, 0, 256, 256);
      g.strokeStyle = "rgba(90,50,20,0.16)"; g.lineWidth = 3;
      for (let i = 0; i < 18; i++) { g.beginPath(); const y = i * 15 + Math.random() * 6; g.moveTo(0, y); g.bezierCurveTo(80, y + 6, 170, y - 6, 256, y + 3); g.stroke(); }
    });
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(5, 3);
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(43, 27), new THREE.MeshBasicMaterial({ map: grain, transparent: true, depthWrite: false }));
    gp.rotation.x = -Math.PI / 2; gp.position.set(0, -0.29, 6.95); this.scene.add(gp);
    // desk props: tea mug, lost-property tag, buttons
    const mug = cyl(0.42, 0.36, 0.7, "#e9e2d0", 20); mug.position.set(5.3, 0.05, 1.8); this.scene.add(mug);
    const tea = cyl(0.36, 0.36, 0.02, "#8a4b24", 20, false); tea.position.set(5.3, 0.4, 1.8); this.scene.add(tea);
    const hand = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 8, 14), toon("#e9e2d0")); hand.position.set(5.75, 0.08, 1.8); this.scene.add(hand);
    for (const [x, z, c] of [[-5.5, 2.4, PAL.mustard], [-6.1, 1.9, PAL.burgundy], [-5.0, 1.8, PAL.leaf]] as const) {
      const b = cyl(0.22, 0.22, 0.08, c, 16); b.position.set(x, -0.25, z); this.scene.add(b);
    }
    const pencil = cyl(0.05, 0.05, 1.7, "#e8b94c", 6); pencil.rotation.z = Math.PI / 2; pencil.rotation.y = 0.5; pencil.position.set(-5.2, -0.22, 3.3); this.scene.add(pencil);
  }

  private buildStation() {
    const st = new THREE.Group(); st.position.y = -1.1; this.scene.add(st);
    // wall with a big window, then the station beyond it
    const wallMat = (c: string) => toon(c);
    const WZ = -7.4;
    const mk = (w: number, h: number, x: number, y: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.6), wallMat("#4d6b78")); m.position.set(x, y, WZ); m.receiveShadow = true; st.add(m); };
    const wx0 = -9.8, wx1 = 9.8, wy0 = 1.0, wy1 = 7.2;
    mk(40, 30, wx0 - 20, 6); mk(40, 30, wx1 + 20, 6); mk(wx1 - wx0, 12, 0, wy0 - 6); mk(wx1 - wx0, 12, 0, wy1 + 6);
    const frameC = PAL.cream;
    for (const [w, h, x, y] of [[19.8, 0.34, 0, wy1 - 0.1], [19.8, 0.34, 0, wy0 + 0.1], [0.34, 6.4, wx0 + 0.1, 4.1], [0.34, 6.4, wx1 - 0.1, 4.1], [0.2, 6.2, -3.3, 4.1], [0.2, 6.2, 3.3, 4.1], [19.4, 0.2, 0, 4.4]] as const) {
      const f = rbox(w, h, 0.4, frameC, 0.05, false); f.position.set(x, y, WZ + 0.35); st.add(f);
    }
    const sill = rbox(20.6, 0.3, 0.9, PAL.honey, 0.08, false); sill.position.set(0, wy0 - 0.2, WZ + 0.55); st.add(sill);
    // skies
    const skyTex = (top: string, mid: string, bot: string) => canvasTex(4, 256, g => {
      const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    });
    const day = new THREE.Mesh(new THREE.PlaneGeometry(60, 34), new THREE.MeshBasicMaterial({ map: skyTex("#7fa6d6", "#b9c9e0", "#f6c99a"), fog: false }));
    day.position.set(0, 7, -24); st.add(day);
    this.skyNight = new THREE.Mesh(new THREE.PlaneGeometry(60, 34), new THREE.MeshBasicMaterial({ map: skyTex("#0f1830", "#22335c", "#47507a"), transparent: true, opacity: 0, fog: false }));
    this.skyNight.position.set(0, 7, -23.9); st.add(this.skyNight);
    // clouds drifting beyond the glass
    for (let i = 0; i < 9; i++) {
      const c = makeCloud(1.5 + Math.random() * 1.5);
      const base = new THREE.Vector3(-18 + Math.random() * 36, 3.0 + Math.random() * 2.6, -13 - Math.random() * 6);
      c.position.copy(base); c.scale.y *= 0.8; st.add(c);
      this.clouds.push({ m: c, v: new THREE.Vector3(0.12 + Math.random() * 0.18, 0, 0), base });
    }
    // ground + platform + tracks (raised so they show in the window)
    const ground = rbox(60, 0.6, 14, PAL.station, 0.05, false); ground.position.set(0, 0.55, -12); st.add(ground);
    const platform = rbox(30, 0.45, 2.6, "#c9b79a", 0.08, false); platform.position.set(-2, 1.0, -11.4); st.add(platform);
    const stripe = rbox(30, 0.04, 0.2, "#f2d46b", 0.01, false); stripe.position.set(-2, 1.25, -10.2); st.add(stripe);
    for (const z of [-9.3, -8.7]) { const rail = rbox(60, 0.07, 0.07, "#555e6b", 0.02, false); rail.position.set(0, 0.88, z); st.add(rail); }
    for (let i = -20; i < 20; i++) { const tie = rbox(0.18, 0.05, 1.2, "#5a4638", 0.01, false); tie.position.set(i * 0.75, 0.86, -9); st.add(tie); }
    // canopy with pillars
    const roof = rbox(14, 0.3, 3.4, PAL.burgundy, 0.08); roof.position.set(-4, 3.6, -11.6); st.add(roof);
    for (const x of [-9.5, -4, 1.5]) { const p = cyl(0.12, 0.12, 2.8, "#2f3c48", 8, false); p.position.set(x, 2.2, -10.6); st.add(p); }
    // clock tower
    const tower = rbox(1.9, 3.6, 1.9, "#c97a58", 0.12); tower.position.set(4.8, 2.5, -12); st.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.3, 4), toon("#3e5c76")); cap.position.set(4.8, 5.1, -12); cap.rotation.y = Math.PI / 4; inked(cap, 0.04); st.add(cap);
    const clock = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({
      map: canvasTex(128, 128, g => {
        g.fillStyle = "#fff8e6"; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = 6; g.stroke();
        g.lineWidth = 5; g.lineCap = "round"; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 24); g.stroke(); g.beginPath(); g.moveTo(64, 64); g.lineTo(92, 74); g.stroke();
        g.fillStyle = PAL.ink; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.fillRect(64 + Math.sin(a) * 52 - 2, 64 - Math.cos(a) * 52 - 2, 4, 4); }
      }),
    }));
    clock.position.set(4.8, 3.6, -11.02); st.add(clock);
    // little skyline
    const rnd = (a: number) => (Math.sin(a * 12.9898) * 43758.5453) % 1;
    for (let i = 0; i < 16; i++) {
      const h = 0.5 + Math.abs(rnd(i)) * 1.3;
      const b = rbox(1.6, h, 1.6, i % 2 ? "#4a6a85" : "#5b7894", 0.08, false); b.position.set(-16 + i * 2.2, 0.85 + h / 2, -15); st.add(b);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ color: PAL.warm })); w.position.set(-16 + i * 2.2, 0.85 + h * 0.6, -14.19); st.add(w);
    }
  }

  private buildRain() {
    const N = 260;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = -9 + Math.random() * 18, y = 0.5 + Math.random() * 8, z = -7.0 - Math.random() * 3;
      this.rainPos.set([x, y, z, x - 0.04, y - 0.38, z], i * 6);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#d9ecff", transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false; this.scene.add(this.rain);
  }

  // ------------------------------------------------------------------ the suitcase
  private buildCase() {
    const g = this.caseGroup;
    const slab = rbox(6.9, 0.34, 4.8, PAL.shellDark, 0.1); slab.position.set(0, -0.22, 0); g.add(slab);
    const floorTex = canvasTex(256, 192, c => {
      c.fillStyle = "#d9a15a"; c.fillRect(0, 0, 256, 192);
      for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? "#cf9650" : "#e0aa66"; c.fillRect(0, i * 32, 256, 32); c.fillStyle = "rgba(90,50,20,.35)"; c.fillRect(0, i * 32, 256, 2); }
    });
    this.floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(COLS, ROWS), new THREE.MeshToonMaterial({ map: floorTex, gradientMap: toon("#fff").gradientMap }));
    this.floorPlane.rotation.x = -Math.PI / 2; this.floorPlane.position.y = 0.005; this.floorPlane.receiveShadow = true; g.add(this.floorPlane);
    // grid overlay (only while furnishing)
    const gridTex = canvasTex(192, 128, c => {
      c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 3; c.setLineDash([6, 6]);
      for (let x = 0; x <= COLS; x++) { c.beginPath(); c.moveTo(x * 32, 0); c.lineTo(x * 32, 128); c.stroke(); }
      for (let z = 0; z <= ROWS; z++) { c.beginPath(); c.moveTo(0, z * 32); c.lineTo(192, z * 32); c.stroke(); }
    });
    this.gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(COLS, ROWS), new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0, depthWrite: false }));
    this.gridPlane.rotation.x = -Math.PI / 2; this.gridPlane.position.y = 0.02; g.add(this.gridPlane);
    g.add(this.hoverCells);

    // walls
    const wallC = PAL.wall;
    const wallPiece = (w: number, h: number, x: number, y: number) => { const m = rbox(w, h, 0.22, wallC, 0.03, false); m.position.set(x, y, -2.1); g.add(m); return m; };
    wallPiece(3.2, WH, -1.6, WH / 2 - 0.0);  // x -3.2..0 (covers corner)
    wallPiece(1.3, WH, 2.65, WH / 2);         // x 2..3.3
    wallPiece(2, WIN.y0, 1, WIN.y0 / 2);
    wallPiece(2, WH - WIN.y1, 1, (WH + WIN.y1) / 2);
    this.cutPiece = rbox(2, WIN.y1 - WIN.y0, 0.22, wallC, 0.03, false);
    this.cutPiece.position.set(1, (WIN.y0 + WIN.y1) / 2, -2.1); g.add(this.cutPiece);
    // dotted cut guide on the inside face
    const gw = 2.0, gh = WIN.y1 - WIN.y0;
    const guideTex = canvasTex(256, 128, c => {
      c.clearRect(0, 0, 256, 128); c.strokeStyle = PAL.burgundy; c.lineWidth = 6; c.setLineDash([14, 10]); c.lineCap = "round"; c.strokeRect(8, 8, 240, 112);
      c.fillStyle = PAL.burgundy; c.font = "bold 28px sans-serif"; c.fillText("✂", 18, 44);
    });
    this.cutGuide = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.MeshBasicMaterial({ map: guideTex, transparent: true, opacity: 0, depthWrite: false }));
    this.cutGuide.position.set(1, (WIN.y0 + WIN.y1) / 2, -1.98); g.add(this.cutGuide);
    // wall trim: honey wainscot + a stripe of wallpaper hearts
    for (const [w, d, x, z, rotY] of [[6.3, 0.26, 0, -1.97, 0]] as const) { const t = rbox(w, 0.4, d, PAL.honey, 0.04, false); t.position.set(x, 0.2, z); t.rotation.y = rotY; g.add(t); }
    for (const s of [-1, 1]) {
      const side = rbox(0.22, WH, 4.5, wallC, 0.03, false); side.position.set(s * 3.1, WH / 2, 0); g.add(side);
      const t2 = rbox(0.26, 0.4, 4.2, PAL.honey, 0.04, false); t2.position.set(s * 2.97, 0.2, 0); g.add(t2);
      const s2 = rbox(0.1, 0.16, 4.5, PAL.shell, 0.03, false); s2.position.set(s * 3.2, WH + 0.04, 0); g.add(s2);
    }
    // shell outside of walls (petrol-blue skin)
    for (const s of [-1, 1]) { const o = rbox(0.14, WH + 0.1, 4.7, PAL.shell, 0.05); o.position.set(s * 3.3, WH / 2 - 0.1, 0); g.add(o); }
    this.frontWall = rbox(6.8, WH + 0.1, 0.2, PAL.shell, 0.06);
    this.frontWall.geometry.translate(0, (WH + 0.1) / 2, 0); this.frontWall.position.set(0, -0.2, 2.25); g.add(this.frontWall);
    // brass corners + straps + handle on the front
    for (const sx of [-1, 1]) {
      const strap = rbox(0.4, WH + 0.1, 0.06, PAL.shellDark, 0.02, false); strap.position.set(sx * 2.2, (WH + 0.1) / 2, 0.14); this.frontWall.add(strap);
      const c1 = ball(0.16, PAL.brass); c1.position.set(sx * 3.35, 0, 0.12); this.frontWall.add(c1);
    }
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 20, Math.PI), toon(PAL.honey)); handle.position.set(-1.0, 0.7, 0.12); handle.rotation.z = Math.PI; inked(handle, 0.08); this.frontWall.add(handle);
    const tag = rbox(0.5, 0.34, 0.03, "#f1e1b0", 0.02); tag.position.set(-0.55, 0.4, 0.16); tag.rotation.z = 0.2; this.frontWall.add(tag);
    // latch
    const plate = rbox(0.62, 0.5, 0.1, PAL.brass, 0.08); const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10), toon(PAL.ink)); hole.rotation.x = Math.PI / 2;
    const tab = rbox(0.3, 0.3, 0.08, "#f2cc6b", 0.05); tab.position.set(0, 0.22, 0.08);
    this.latch.add(plate, hole, tab); this.latch.position.set(0.6, WH - 0.35, 0.18); this.frontWall.add(this.latch);
    this.latchHit = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); this.latchHit.position.copy(this.latch.position); this.latchHit.position.z += 0.3; this.frontWall.add(this.latchHit);

    // lid on a hinge at the back edge
        const lidTop = rbox(6.8, 0.26, 4.7, PAL.shell, 0.1); lidTop.position.set(0, 0.13, 2.35);
    const lining = rbox(6.4, 0.08, 4.3, PAL.cream, 0.04, false); lining.position.set(0, -0.0, 2.35);
    const pocket = rbox(2.2, 0.06, 1.2, PAL.burgundy, 0.04, false); pocket.position.set(-1.6, -0.06, 2.3);
    const lidStrap = rbox(0.4, 0.06, 4.7, PAL.shellDark, 0.02, false); lidStrap.position.set(-2.2, 0.28, 2.35); const lidStrap2 = lidStrap.clone(); lidStrap2.position.x = 2.2;
    this.lidPivot.add(lidTop, lining, pocket, lidStrap, lidStrap2);
    // travel stickers on the lid's top
    const stick = (x: number, z: number, r: number, c: string) => { const s = cyl(r, r, 0.03, c, 20, false); s.position.set(x, 0.29, z); this.lidPivot.add(s); };
    stick(-0.6, 1.4, 0.45, PAL.burgundy); stick(1.2, 2.5, 0.38, PAL.mustard); stick(-0.2, 3.3, 0.3, PAL.leaf); stick(0.9, 0.9, 0.22, "#f2f2f2");
    g.add(this.lidPivot);
    this.applyLid(0);
    // what you see through the cut window: a painted sky with goofy clouds, and the train when it passes
    this.holeCanvas = document.createElement("canvas"); this.holeCanvas.width = 320; this.holeCanvas.height = 144;
    this.holeTex = new THREE.CanvasTexture(this.holeCanvas); this.holeTex.colorSpace = THREE.SRGBColorSpace;
    this.holeView = new THREE.Mesh(new THREE.PlaneGeometry(WIN.x1 - WIN.x0, WIN.y1 - WIN.y0), new THREE.MeshBasicMaterial({ map: this.holeTex }));
    this.holeView.position.set(1, (WIN.y0 + WIN.y1) / 2, -2.26); this.holeView.visible = false; g.add(this.holeView);
    this.holeFrame = new THREE.Group();
    const fw = 0.08, fz = -2.03, cx = 1, cy = (WIN.y0 + WIN.y1) / 2, ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0;
    for (const [w, h, x, y] of [[ww + fw, fw, cx, WIN.y1], [ww + fw, fw, cx, WIN.y0], [fw, wh, WIN.x0, cy], [fw, wh, WIN.x1, cy], [fw * 0.6, wh, cx, cy], [ww, fw * 0.6, cx, cy]] as const) {
      const b = rbox(w, h, 0.1, PAL.brass, 0.02, false); b.position.set(x, y, fz); this.holeFrame.add(b);
    }
    this.holeFrame.visible = false; g.add(this.holeFrame);
    // wall plane for scissors picking
    this.wallPlane = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), new THREE.MeshBasicMaterial({ visible: false }));
    this.wallPlane.position.set(0, 1, WIN.z); g.add(this.wallPlane);

    // Everything except these interaction overlays is visual fallback art.
    // Once the Blender suitcase loads, the proxy/interaction surfaces stay
    // authoritative while these primitives disappear.
    const keep = new Set<THREE.Object3D>([
      this.gridPlane,
      this.hoverCells,
      this.cutGuide,
      this.holeView,
      this.holeFrame,
      this.wallPlane,
    ]);
    this.legacyCaseVisuals = g.children.filter(child => !keep.has(child));
  }

  private async hydrateSuitcaseArt() {
    try {
      const art = await loadSuitcaseArt();
      if (this.disposed) return;

      for (const name of SMALL_COMFORTS_ART.suitcase.expectedNodes) {
        if (!art.getObjectByName(name)) throw new Error(`missing runtime node ${name}`);
      }

      this.importedCase = art;
      this.importedLid = art.getObjectByName(SMALL_COMFORTS_ART.suitcase.lidNode) ?? null;
      this.importedLatch = art.getObjectByName(SMALL_COMFORTS_ART.suitcase.latchNode) ?? null;
      art.name = "ImportedSuitcaseV3";
      this.caseGroup.add(art);

      // Preserve invisible gameplay proxies and the cut-window overlay, but
      // remove the old primitive suitcase from rendering.
      for (const object of this.legacyCaseVisuals) object.visible = false;

      // The old latch hit volume lived under the fallback front wall. Reparent
      // it and align it with the authored v3 brass hardware.
      this.caseGroup.updateMatrixWorld(true);
      this.caseGroup.attach(this.latchHit);
      this.latchHit.position.set(0, 0.62, 2.55);
      this.latchHit.scale.set(1.25, 0.8, 0.8);

      // The current scissors mechanic remains proxy-driven. When the lining
      // is cut, its view is composited a hair in front of the Blender lining
      // until destructive mesh cutting is authored as a later art feature.
      this.holeView.position.z = -1.965;
      this.holeView.renderOrder = 20;
      this.holeFrame.position.z = 0.08;
      this.holeFrame.renderOrder = 21;
      this.cutPiece.visible = false;

      this.applyLid(this.lidT);
    } catch (error) {
      console.warn("Small Comforts: keeping suitcase fallback art", error);
    }
  }

  private applyLid(t: number) {
    if (this.importedLid) {
      const angle = SMALL_COMFORTS_ART.suitcase.openAngleDeg * clamp01(t);
      this.importedLid.rotation.x = THREE.MathUtils.degToRad(-angle);
      this.importedLid.updateMatrixWorld(true);
      return;
    }

    // Primitive fallback used only if the GLB cannot load.
    const p = this.lidPivot;
    const k = Math.max(0, t - 0.3);
    p.rotation.x = Math.min(t, 0.3) / 0.3 * 0.95 + k * 1.7;
    p.position.set(0, WH + 0.05 + k * 5, -2.3 - k * 3.5);
    const sc = t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) / 0.55);
    p.scale.setScalar(Math.max(0.001, sc));
    p.visible = sc > 0.01;
    this.frontWall.scale.y = 1 - Math.min(1, t) * 0.78;
    this.latch.visible = t < 0.2;
  }

  openLid(now: number) { this.lidAnim = { from: 0, to: 1, t0: now, dur: 1.5 }; }
  closeLid(now: number) { this.lidAnim = { from: 1, to: 0, t0: now, dur: 0.9 }; }
  cutWindow() { if (this.windowCut) return; this.windowCut = true; this.cutAnim = 0; if (!this.importedCase) this.cutPiece.visible = true; this.holeView.visible = true; this.holeFrame.visible = true; }
  spawnTrain() { this.train.spawn(); this.holeTrainT = 0; }
  restoreWindow() { this.windowCut = false; this.holeView.visible = false; this.holeFrame.visible = false; this.cutAnim = -1; this.cutPiece.visible = !this.importedCase; this.cutPiece.position.set(1, (WIN.y0 + WIN.y1) / 2, -2.1); this.cutPiece.rotation.set(0, 0, 0); this.cutPiece.scale.set(1, 1, 1); }

  // ------------------------------------------------------------------ the descent through the clouds
  private buildIntroClouds() {
    for (let i = 0; i < 46; i++) {
      const c = makeCloud(2.4 + Math.random() * 3.2);
      const a = Math.random() * Math.PI * 2, rad = 2 + Math.random() * 20;
      c.position.set(Math.cos(a) * rad, 13 + Math.random() * 4, Math.sin(a) * rad * 0.8);
      c.userData.home = c.position.clone();
      this.introClouds.add(c);
    }
    this.scene.add(this.introClouds);
  }

  /** 0..1 camera fly from high in the clouds to the desk */
  setCamera(t: number) { this.introT = t; this.updateCamera(); }

  /** 0 = desk shot of the suitcase, 1 = pulled back over the shelf, following (fx, fz) */
  outK = 0;
  outFocus = new THREE.Vector2(0, 2);
  setOutside(k: number, fx: number, fz: number) {
    if (k === this.outK && fx === this.outFocus.x && fz === this.outFocus.y) return;
    this.outK = k; this.outFocus.set(fx, fz); this.updateCamera();
  }

  private updateCamera() {
    const asp = this.camera.aspect;
    const e = easeInOut(clamp01(this.introT));
    // desk shot: pitched ~32°, pulled back in portrait so the suitcase always fits
    const fov = 42;
    const tanH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * asp;
    const dist = Math.max(10.6, 4.7 / tanH);
    const dir = new THREE.Vector3(0, 0.5, 0.866).normalize();
    let finalTarget = new THREE.Vector3(0, 1.0, 0.2);
    let finalPos = finalTarget.clone().addScaledVector(dir, dist);
    if (this.outK > 0) {
      // out on the shelf: higher, wider, drifting after the proprietor so the suitcase stays in frame
      const k = easeInOut(clamp01(this.outK));
      const outTarget = new THREE.Vector3(this.outFocus.x * 0.55, 0.2, this.outFocus.y * 0.5 + 0.6);
      const outDir = new THREE.Vector3(0, 0.66, 0.75).normalize();
      const outPos = outTarget.clone().addScaledVector(outDir, dist * 1.62);
      finalTarget = finalTarget.lerp(outTarget, k);
      finalPos = finalPos.lerp(outPos, k);
    }
    const startPos = new THREE.Vector3(0, 46, 6);
    this.camera.position.lerpVectors(startPos, finalPos, e);
    this.target.set(finalTarget.x * e, THREE.MathUtils.lerp(0, finalTarget.y, e), THREE.MathUtils.lerp(0, finalTarget.z, e));
    this.camera.fov = THREE.MathUtils.lerp(55, fov, e);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    // clouds part as the camera drops through them
    const part = clamp01((this.introT - 0.25) / 0.55);
    this.introClouds.visible = this.introT < 0.97;
    for (const c of this.introClouds.children) {
      const h = c.userData.home as THREE.Vector3;
      const out = 1 + part * 2.4;
      c.position.set(h.x * out, h.y + part * 6, h.z * out);
      c.scale.setScalar((c.userData.s ??= c.scale.x) * (1 - part * 0.4));
      c.scale.y *= 0.8;
    }
    (this.scene.background as THREE.Color).set(lerpColor(PAL.sky, "#1d2a4a", 0));
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.updateCamera();
  }

  // ------------------------------------------------------------------ night
  setNight(n: number) {
    this.night = n;
    this.sun.color.set(lerpColor("#fff0d0", "#7f98d8", n));
    this.sun.intensity = 2.4 - n * 1.0;
    this.hemi.intensity = 1.15 - n * 0.4;
    this.hemi.color.set(lerpColor("#dbe9ff", "#6f86c4", n));
    (this.skyNight.material as THREE.MeshBasicMaterial).opacity = n;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.55 - n * 0.2;
    this.rainAmt = 1 - n * 0.65;
  }

  pickLatch(raycaster: THREE.Raycaster) { return raycaster.intersectObject(this.latchHit, false).length > 0; }

  update(dt: number, now: number) {
    this.time = now;
    if (this.lidAnim) {
      const a = this.lidAnim, k = clamp01((now - a.t0) / a.dur);
      // opening: ease with a little overshoot at the end (the lid slams down on the desk)
      const e = a.to > a.from ? (k < 0.82 ? easeInOut(k / 0.82) * 1.04 : 1.04 - 0.04 * easeInOut((k - 0.82) / 0.18)) : easeInOut(k);
      this.lidT = a.from + (a.to - a.from) * e;
      this.applyLid(this.lidT);
      if (k >= 1) { this.lidAnim = null; this.lidT = a.to; this.applyLid(a.to); }
    }
    if (this.cutAnim >= 0) {
      this.cutAnim += dt;
      const k = clamp01(this.cutAnim / 0.9);
      this.cutPiece.position.y = (WIN.y0 + WIN.y1) / 2 - k * k * 2.2;
      this.cutPiece.position.z = -2.1 + k * 1.4;
      this.cutPiece.rotation.x = k * 1.3; this.cutPiece.rotation.z = Math.sin(k * 5) * 0.2;
      if (k >= 1) { this.cutPiece.visible = false; this.cutAnim = -1; }
    }
    // clouds drift
    for (const c of this.clouds) { c.m.position.x += c.v.x * dt; if (c.m.position.x > 20) c.m.position.x = -20; c.m.position.y = c.base.y + Math.sin(now * 0.3 + c.base.x) * 0.15; }
    // rain
    const p = this.rainPos, sp = (6 + 5 * this.rainAmt) * dt;
    for (let i = 0; i < p.length; i += 6) {
      p[i + 1] -= sp; p[i + 4] -= sp; p[i] -= sp * 0.1; p[i + 3] -= sp * 0.1;
      if (p[i + 4] < 0.4) { const x = -9 + Math.random() * 18, y = 7 + Math.random() * 2; p[i] = x; p[i + 1] = y; p[i + 3] = x - 0.04; p[i + 4] = y - 0.38; }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.visible = true;
    this.train.update(dt);
    if (this.windowCut) this.drawHole(dt);
    // Pulse whichever latch art is currently visible.
    const latchVisual = this.importedLatch ?? this.latch;
    if (this.lidT < 0.01) { const s = 1 + Math.sin(now * 5) * 0.035; latchVisual.scale.setScalar(s); }
    else latchVisual.scale.setScalar(1);
    // the sky shows through the lamp/brass etc — nothing else per-frame
  }

  private drawHole(dt: number) {
    const g = this.holeCanvas.getContext("2d")!, W = 320, H = 144, n = this.night;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, lerpColor("#7fb4ee", "#142040", n).getStyle()); gr.addColorStop(1, lerpColor("#f6d7a8", "#3a4672", n).getStyle());
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // puffy clouds, drifting
    const t = this.time;
    g.fillStyle = lerpColor("#ffffff", "#8d9ac4", n).getStyle();
    for (let i = 0; i < 3; i++) {
      const x = ((t * (6 + i * 3) + i * 120) % (W + 90)) - 45, y = 24 + i * 22;
      for (const [dx, dy, r] of [[0, 0, 16], [16, 4, 12], [-15, 5, 11], [4, -8, 11]] as const) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill(); }
    }
    // far station: roofline, rails
    g.fillStyle = lerpColor("#4b6a85", "#1c2744", n).getStyle(); g.fillRect(0, 96, W, 48);
    g.fillStyle = lerpColor("#c9b79a", "#40476a", n).getStyle(); g.fillRect(0, 108, W, 8);
    g.fillStyle = "#3a3a44"; g.fillRect(0, 124, W, 4);
    if (this.holeTrainT >= 0) {
      this.holeTrainT += dt;
      const k = this.holeTrainT / 5.5, x = -260 + k * (W + 330);
      for (let c = 0; c < 4; c++) {
        g.fillStyle = c === 0 ? "#a02631" : c % 2 ? "#e0a93b" : "#C8323C";
        const cx = x - c * 62; g.beginPath(); g.roundRect(cx, 96, 58, 28, 6); g.fill();
        g.fillStyle = "#ffd98a"; for (let w = 0; w < 3; w++) g.fillRect(cx + 7 + w * 16, 103, 10, 9);
      }
      g.fillStyle = "#2a1d2e"; g.fillRect(x + 40, 88, 8, 10);
      if (k > 1) this.holeTrainT = -1;
    }
    this.holeTex.needsUpdate = true;
  }

  render() { this.renderer.render(this.scene, this.camera); }
  dispose() {
    this.disposed = true;
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        for (const v of Object.values(x as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
        x.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ------------------------------------------------------------------ a toy train that passes the window
export class Train {
  group = new THREE.Group();
  speed = 0;
  active = false;
  private wheels: THREE.Mesh[] = [];
  constructor() {
    const loco = rbox(2.6, 1.0, 1.0, PAL.train, 0.15); loco.position.set(0, 0.55, 0);
    const boiler = cyl(0.42, 0.42, 1.8, PAL.train, 18); boiler.rotation.z = Math.PI / 2; boiler.position.set(0.9, 0.62, 0);
    const cab = rbox(1.0, 1.35, 1.1, "#a02631", 0.12); cab.position.set(-0.8, 0.8, 0);
    const chim = cyl(0.14, 0.2, 0.55, PAL.ink, 10); chim.position.set(1.5, 1.2, 0);
    const lampG = ball(0.17, "#fff1b0", false); lampG.position.set(2.0, 0.7, 0); lampG.material = toon("#fff1b0", { emissive: "#ffe27a", emissiveIntensity: 1 });
    this.group.add(loco, boiler, cab, chim, lampG);
    for (let c = 0; c < 4; c++) {
      const car = rbox(2.6, 1.2, 1.0, c % 2 ? "#e0a93b" : PAL.train, 0.15); car.position.set(-3.2 - c * 2.9, 0.65, 0); this.group.add(car);
      for (let w = 0; w < 3; w++) { const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.5), new THREE.MeshBasicMaterial({ color: PAL.warm })); win.position.set(-3.2 - c * 2.9 - 0.8 + w * 0.8, 0.8, 0.51); this.group.add(win); }
    }
    for (let i = 0; i < 12; i++) { const w = cyl(0.22, 0.22, 0.14, PAL.ink, 12, false); w.rotation.x = Math.PI / 2; w.position.set(1.4 - i * 1.55, 0.12, 0.55); this.group.add(w); this.wheels.push(w); }
    this.group.position.x = 30; this.group.visible = false;
  }
  spawn() { this.group.position.x = -30; this.group.visible = true; this.active = true; this.speed = 7.5; }
  update(dt: number) {
    if (!this.active) return;
    this.group.position.x += this.speed * dt;
    for (const w of this.wheels) w.rotation.z -= this.speed * dt * 4;
    this.group.position.y = 0.25 + Math.sin(this.group.position.x * 3) * 0.01;
    if (this.group.position.x > 26) { this.active = false; this.group.visible = false; }
  }
}
