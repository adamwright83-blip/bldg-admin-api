/**
 * The tower cutaway: a building's towers drawn open like a dollhouse, every unit a window. A
 * customer's home burns gold; every other unit is dark glass; a floor with no customer on it at
 * all is marked so the dark floors (the doors to knock on) read at a glance.
 *
 * Canvas 2D, crisp at any size. The data comes from towerStack.ts.
 */
import { darkFloors, type BuildingModel, type Resident, type TowerModel } from "./towerStack";

export type CutawayHover = { residents: Resident[]; label: string; x: number; y: number } | null;

const CW = 24, CH = 30, SLAB = 5;             // unit cell and floor slab, logical px
const FRAME = 10, GAP = 90, LEFT = 44, RIGHT = 58, TOP = 118, LOBBY = 46, STREET = 34;

function hash(a: number, b: number) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function createTowerCutaway(host: HTMLElement, events: { onHover?: (h: CutawayHover) => void } = {}) {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  const g = canvas.getContext("2d")!;
  let model: BuildingModel | null = null;
  let layout: { scale: number; ox: number; oy: number; towers: { t: TowerModel; x: number; y: number; w: number; h: number }[]; W: number; H: number } | null = null;
  let hoverKey = "";

  function measure(m: BuildingModel) {
    let x = LEFT;
    const tallest = Math.max(...m.towers.map(t => t.spec.floors));
    const H = TOP + tallest * (CH + SLAB) + LOBBY + STREET;
    const towers = m.towers.map(t => {
      const w = t.spec.unitsPerFloor * CW + FRAME * 2, h = t.spec.floors * (CH + SLAB);
      const r = { t, x, y: TOP + (tallest - t.spec.floors) * (CH + SLAB), w, h };
      x += w + RIGHT + GAP;
      return r;
    });
    return { towers, W: x - GAP + 10, H };
  }

  function draw() {
    if (!model) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = host.clientWidth || 1, chh = host.clientHeight || 1;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(chh * dpr);
    const m = measure(model);
    const scale = Math.min(cw / m.W, chh / m.H);
    const ox = (cw - m.W * scale) / 2, oy = (chh - m.H * scale) / 2;
    layout = { scale, ox, oy, ...m };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // dusk sky
    const sky = g.createLinearGradient(0, 0, 0, chh);
    sky.addColorStop(0, "#141a33"); sky.addColorStop(0.55, "#3b2f5c"); sky.addColorStop(0.85, "#b8667a"); sky.addColorStop(1, "#f1a86a");
    g.fillStyle = sky; g.fillRect(0, 0, cw, chh);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + hash(i, 3) * 0.5})`;
      g.fillRect(hash(i, 1) * cw, hash(i, 2) * chh * 0.5, 1.2, 1.2);
    }
    // distant skyline
    g.fillStyle = "rgba(40,30,60,.55)";
    for (let i = 0; i < 40; i++) {
      const w = 20 + hash(i, 5) * 50, h = 40 + hash(i, 6) * 160, x = (i / 40) * cw + hash(i, 7) * 20;
      g.fillRect(x, chh - h - 20, w, h);
    }
    g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    // street
    g.fillStyle = "#2a2433"; g.fillRect(-2000, m.H - STREET, m.W + 4000, STREET);
    g.fillStyle = "#e9c27a";
    for (let x = -40; x < m.W + 40; x += 38) g.fillRect(x, m.H - STREET / 2 - 1, 18, 2);
    for (const tw of m.towers) drawTower(tw);
  }

  function drawTower({ t, x, y, w, h }: { t: TowerModel; x: number; y: number; w: number; h: number }) {
    const s = t.spec;
    const dark = new Set(darkFloors(t));
    // header
    g.fillStyle = "#fff4dc";
    g.font = `700 17px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillText(s.label.toUpperCase(), x, y - 64);
    g.font = `600 13px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.fillStyle = "#ffc84d";
    const units = s.floors * s.unitsPerFloor;
    g.fillText(`${t.lit} LIT OF ${units} UNITS · ${dark.size} OF ${s.floors} FLOORS DARK`, x, y - 46);
    if (s.unitsAssumed) { g.fillStyle = "rgba(255,244,220,.55)"; g.fillText(`${s.unitsPerFloor} UNITS A FLOOR ASSUMED`, x, y - 30); }
    // crown: parapet, water tank, mast with a beacon
    g.fillStyle = "#4a3f5c"; g.fillRect(x - 3, y - 10, w + 6, 10);
    g.fillStyle = "#5c4f70"; g.fillRect(x + w * 0.62, y - 26, 26, 16);
    g.fillStyle = "#3a3148"; g.fillRect(x + w * 0.3, y - 22, 4, 12);
    g.fillRect(x + w * 0.5 - 1, y - 44, 2, 34);
    g.fillStyle = "#ff4d3a"; g.beginPath(); g.arc(x + w * 0.5, y - 45, 2.5, 0, Math.PI * 2); g.fill();
    // structure
    g.fillStyle = "#3b3150"; g.fillRect(x, y, w, h + LOBBY);
    for (let f = s.floors; f >= 1; f--) {
      const fy = y + (s.floors - f) * (CH + SLAB);
      const rooms = t.floors[f - 1], floorOnly = t.floorOnly[f - 1];
      const isDark = dark.has(f);
      for (let u = 0; u < s.unitsPerFloor; u++) drawUnit(x + FRAME + u * CW, fy + SLAB, rooms[u], f, u);
      // a resident on this floor whose door isn't known: the floor's slab glows
      if (floorOnly.length) { g.fillStyle = "rgba(255,200,77,.85)"; g.fillRect(x + FRAME, fy + CH + SLAB - 2, s.unitsPerFloor * CW, 2); }
      // slab
      g.fillStyle = "#2a2238"; g.fillRect(x, fy, w, SLAB);
      // floor number and the floor's count
      g.font = `600 12px "Barlow Condensed", "Arial Narrow", sans-serif`;
      g.textAlign = "right"; g.textBaseline = "middle";
      g.fillStyle = isDark ? "rgba(255,244,220,.4)" : "#fff4dc";
      g.fillText(String(f), x - 8, fy + SLAB + CH / 2);
      const n = rooms.filter(r => r.length).length + (floorOnly.length ? 1 : 0);
      const px = x + w + 10, py = fy + SLAB + CH / 2;
      g.textAlign = "center";
      if (n) {
        g.fillStyle = "#ffc84d"; g.beginPath(); g.roundRect(px, py - 9, 30, 18, 9); g.fill();
        g.fillStyle = "#3a2600"; g.fillText(String(n), px + 15, py + 1);
      } else {
        g.strokeStyle = "rgba(255,244,220,.35)"; g.lineWidth = 1; g.beginPath(); g.roundRect(px + 0.5, py - 8.5, 29, 17, 8.5); g.stroke();
        g.fillStyle = "rgba(255,244,220,.45)"; g.fillText("0", px + 15, py + 1);
      }
    }
    // lobby: glass doors, lit
    const ly = y + h;
    g.fillStyle = "#2a2238"; g.fillRect(x, ly, w, SLAB);
    const lob = g.createLinearGradient(0, ly, 0, ly + LOBBY);
    lob.addColorStop(0, "#ffe2a8"); lob.addColorStop(1, "#e7a25a");
    g.fillStyle = lob; g.fillRect(x + FRAME, ly + SLAB, w - FRAME * 2, LOBBY - SLAB);
    g.strokeStyle = "rgba(60,40,30,.5)"; g.lineWidth = 1.5;
    for (let d = x + FRAME + 20; d < x + w - FRAME; d += 26) { g.beginPath(); g.moveTo(d, ly + SLAB); g.lineTo(d, ly + LOBBY); g.stroke(); }
    g.fillStyle = "#2a2238"; g.fillRect(x + w / 2 - 22, ly + 10, 44, 10);
    g.fillStyle = "#ffc84d"; g.font = `700 8px "Barlow Condensed", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(s.id.toUpperCase(), x + w / 2, ly + 15.5);
    if (t.unplaced.length) {
      g.fillStyle = "rgba(255,244,220,.7)"; g.font = `600 12px "Barlow Condensed", sans-serif`; g.textAlign = "left";
      g.fillText(`+${t.unplaced.length} here, unit not readable`, x, ly + LOBBY + STREET + 14);
    }
  }

  function drawUnit(x: number, y: number, who: Resident[], f: number, u: number) {
    const lit = who.length > 0;
    const r = hash(f, u);
    if (lit) {
      g.save();
      g.shadowColor = "rgba(255,190,80,.9)"; g.shadowBlur = 14;
      const gr = g.createLinearGradient(0, y, 0, y + CH);
      gr.addColorStop(0, "#ffe7a6"); gr.addColorStop(1, "#ff9d3c");
      g.fillStyle = gr; g.fillRect(x + 1, y, CW - 2, CH);
      g.restore();
      // a room: lamp, sofa or a figure
      g.fillStyle = "rgba(90,45,20,.55)";
      if (r < 0.4) g.fillRect(x + 5, y + CH - 9, 13, 6);
      else if (r < 0.75) { g.fillRect(x + 9, y + CH - 16, 5, 13); g.beginPath(); g.arc(x + 11.5, y + CH - 19, 3, 0, Math.PI * 2); g.fill(); }
      else g.fillRect(x + 4, y + CH - 12, 6, 9);
      g.fillStyle = "#fff6d8"; g.beginPath(); g.arc(x + CW / 2 + (r - 0.5) * 8, y + 5, 1.8, 0, Math.PI * 2); g.fill();
    } else {
      const gr = g.createLinearGradient(x, y, x + CW, y + CH);
      gr.addColorStop(0, "#27304f"); gr.addColorStop(1, "#1a2036");
      g.fillStyle = gr; g.fillRect(x + 1, y, CW - 2, CH);
      // sky reflection and the odd drawn blind
      g.fillStyle = "rgba(160,170,230,.1)";
      g.beginPath(); g.moveTo(x + 3, y + CH); g.lineTo(x + 9, y); g.lineTo(x + 13, y); g.lineTo(x + 7, y + CH); g.fill();
      if (r > 0.7) { g.fillStyle = "rgba(200,190,220,.12)"; g.fillRect(x + 1, y, CW - 2, CH * (0.3 + r * 0.4)); }
    }
    // mullion
    g.fillStyle = "#2a2238"; g.fillRect(x + CW - 1, y, 2, CH);
  }

  function pick(e: PointerEvent): CutawayHover {
    if (!layout || !model) return null;
    const rect = canvas.getBoundingClientRect();
    const lx = (e.clientX - rect.left - layout.ox) / layout.scale, ly = (e.clientY - rect.top - layout.oy) / layout.scale;
    for (const { t, x, y } of layout.towers) {
      const u = Math.floor((lx - x - FRAME) / CW);
      const fi = Math.floor((ly - y) / (CH + SLAB));
      if (u < 0 || u >= t.spec.unitsPerFloor || fi < 0 || fi >= t.spec.floors) continue;
      const f = t.spec.floors - fi;
      const who = t.floors[f - 1][u];
      if (who.length) return { residents: who, label: `${t.spec.label} · unit ${f}${String(u + 1).padStart(2, "0")}`, x: e.clientX, y: e.clientY };
      if (t.floorOnly[f - 1].length && (ly - y) % (CH + SLAB) > CH - 4) return { residents: t.floorOnly[f - 1], label: `${t.spec.label} · floor ${f}`, x: e.clientX, y: e.clientY };
    }
    return null;
  }
  const onMove = (e: PointerEvent) => {
    const h = pick(e);
    const key = h ? h.label : "";
    if (key !== hoverKey || h) events.onHover?.(h);
    hoverKey = key;
    canvas.style.cursor = h ? "pointer" : "";
  };
  const onLeave = () => { hoverKey = ""; events.onHover?.(null); };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  document.fonts?.ready.then(draw);

  return {
    show(m: BuildingModel) { model = m; draw(); },
    dispose() {
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.remove();
    },
  };
}
