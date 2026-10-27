/**
 * Painted-on-canvas surfaces for the Century Park East dollhouse: wallpaper, floors, the mailboxes, a notice board,
 * paintings, rugs, the washers' fronts, the dusk skyline in three parallax layers, pool water. Nothing here is a file;
 * every texture is drawn when the level opens, deterministically, so the building looks the same every night.
 */
import * as THREE from "three";

function rng(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l * k, 0, 1));
  return `#${c.getHexString()}`;
}

/** a very fine paper grain, multiplied over a flat colour so nothing reads as a plain computer fill */
function grain(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, amount = 0.06, n = 1400) {
  for (let i = 0; i < n; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${r() * amount})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

const cache = new Map<string, THREE.CanvasTexture>();
function tex(key: string, make: () => HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  let t = cache.get(key);
  if (t) return t;
  t = new THREE.CanvasTexture(make());
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

// ------------------------------------------------------------------ walls
export type WallPattern = "stripe" | "dots" | "lattice" | "plain" | "tile" | "panel";
export function wallpaper(base: string, pattern: WallPattern): THREE.CanvasTexture {
  return tex(`wall|${base}|${pattern}`, () => {
    const S = 256;
    const [c, g] = canvas(S);
    const r = rng(base.length * 31 + pattern.length);
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    if (pattern === "stripe") {
      g.fillStyle = shade(base, 0.94);
      for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 14, S);
    } else if (pattern === "dots") {
      g.fillStyle = shade(base, 1.12);
      for (let y = 12; y < S; y += 24) for (let x = (y / 24) % 2 ? 12 : 0; x < S; x += 24) {
        g.beginPath();
        g.arc(x, y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    } else if (pattern === "lattice") {
      g.strokeStyle = shade(base, 0.9);
      g.lineWidth = 1.5;
      for (let i = -S; i < S * 2; i += 32) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + S, S);
        g.moveTo(i + S, 0);
        g.lineTo(i, S);
        g.stroke();
      }
    } else if (pattern === "tile") {
      g.strokeStyle = shade(base, 0.82);
      g.lineWidth = 3;
      for (let y = 0; y < S; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < S; x += 64) g.strokeRect(x + 1.5, y + 1.5, 61, 29);
      g.fillStyle = "rgba(255,255,255,0.08)";
      for (let y = 0; y < S; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < S; x += 64) g.fillRect(x + 4, y + 4, 55, 6);
    } else if (pattern === "panel") {
      g.strokeStyle = shade(base, 0.86);
      g.lineWidth = 4;
      g.strokeRect(18, 18, S - 36, S - 36);
      g.strokeStyle = shade(base, 1.08);
      g.lineWidth = 2;
      g.strokeRect(26, 26, S - 52, S - 52);
    }
    grain(g, S, S, r, 0.05);
    return c;
  });
}

// ------------------------------------------------------------------ floors
export type FloorKind = "planks" | "tiles" | "carpet" | "rubber" | "deck" | "concrete" | "marble" | "checker";
export function floorTex(kind: FloorKind, base: string): THREE.CanvasTexture {
  return tex(`floor|${kind}|${base}`, () => {
    const S = 256;
    const [c, g] = canvas(S);
    const r = rng(kind.length * 97 + base.length);
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    if (kind === "planks" || kind === "deck") {
      const ph = kind === "deck" ? 24 : 40;
      for (let y = 0; y < S; y += ph) {
        const off = (r() * 120) | 0;
        g.fillStyle = shade(base, 0.9 + r() * 0.2);
        g.fillRect(0, y, S, ph - 2);
        g.fillStyle = shade(base, 0.6);
        g.fillRect(0, y + ph - 2, S, 2);
        g.fillRect(off, y, 2, ph - 2);
        g.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.06})`;
        g.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.moveTo(0, y + 6 + r() * (ph - 12));
          g.bezierCurveTo(S * 0.3, y + r() * ph, S * 0.7, y + r() * ph, S, y + 6 + r() * (ph - 12));
          g.stroke();
        }
      }
    } else if (kind === "tiles" || kind === "checker") {
      const n = 4, t = S / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const alt = kind === "checker" && (x + y) % 2 === 1;
        g.fillStyle = alt ? shade(base, 0.55) : shade(base, 0.96 + r() * 0.08);
        g.fillRect(x * t + 2, y * t + 2, t - 4, t - 4);
        g.fillStyle = "rgba(255,255,255,0.10)";
        g.fillRect(x * t + 3, y * t + 3, t - 6, 3);
      }
    } else if (kind === "carpet") {
      grain(g, S, S, r, 0.18, 9000);
      g.fillStyle = shade(base, 0.9);
      for (let y = 0; y < S; y += 8) g.fillRect(0, y, S, 1);
    } else if (kind === "rubber") {
      g.fillStyle = shade(base, 1.18);
      for (let y = 8; y < S; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < S; x += 16) {
        g.beginPath();
        g.arc(x, y, 2.5, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind === "concrete") {
      grain(g, S, S, r, 0.1, 5000);
      g.strokeStyle = "rgba(0,0,0,0.12)";
      g.lineWidth = 2;
      g.strokeRect(1, 1, S - 2, S - 2);
    } else if (kind === "marble") {
      g.strokeStyle = "rgba(90,80,70,0.16)";
      g.lineWidth = 1.5;
      for (let k = 0; k < 7; k++) {
        g.beginPath();
        g.moveTo(r() * S, 0);
        g.bezierCurveTo(r() * S, r() * S, r() * S, r() * S, r() * S, S);
        g.stroke();
      }
      g.strokeStyle = "rgba(255,255,255,0.25)";
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.moveTo(0, r() * S);
        g.bezierCurveTo(r() * S, r() * S, r() * S, r() * S, S, r() * S);
        g.stroke();
      }
      g.strokeStyle = "rgba(0,0,0,0.18)";
      g.lineWidth = 2;
      g.strokeRect(1, 1, S - 2, S - 2);
    }
    grain(g, S, S, r, 0.04);
    return c;
  });
}

// ------------------------------------------------------------------ the shell
export function brick(base = "#a9705a", mortar = "#d9cbb8"): THREE.CanvasTexture {
  return tex(`brick|${base}`, () => {
    const S = 256;
    const [c, g] = canvas(S);
    const r = rng(11);
    g.fillStyle = mortar;
    g.fillRect(0, 0, S, S);
    const bh = 16, bw = 48;
    for (let y = 0; y < S; y += bh) for (let x = (y / bh) % 2 ? -bw / 2 : 0; x < S; x += bw) {
      g.fillStyle = shade(base, 0.86 + r() * 0.28);
      g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
    grain(g, S, S, r, 0.07);
    return c;
  });
}

export function plaster(base = "#e9dfd0"): THREE.CanvasTexture {
  return tex(`plaster|${base}`, () => {
    const S = 256;
    const [c, g] = canvas(S);
    const r = rng(23);
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    grain(g, S, S, r, 0.09, 3000);
    return c;
  });
}

// ------------------------------------------------------------------ props
export function mailboxes(): THREE.CanvasTexture {
  return tex("mailboxes", () => {
    const [c, g] = canvas(512, 256);
    g.fillStyle = "#6f6454";
    g.fillRect(0, 0, 512, 256);
    const cols = 10, rows = 5, w = 512 / cols, h = 256 / rows;
    let n = 1201;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 7 === 3 ? "#c9a25a" : "#d8b36e";
      g.fillRect(x * w + 2, y * h + 2, w - 4, h - 4);
      g.fillStyle = "rgba(255,255,255,0.28)";
      g.fillRect(x * w + 3, y * h + 3, w - 6, 3);
      g.fillStyle = "#4a3a22";
      g.fillRect(x * w + 10, y * h + h / 2 - 1, w - 20, 3);
      g.fillStyle = "#2b211c";
      g.font = "700 9px Georgia, serif";
      g.textAlign = "center";
      g.fillText(String(n++), x * w + w / 2, y * h + 14);
      g.beginPath();
      g.arc(x * w + w - 9, y * h + h - 9, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }, false);
}

export function noticeBoard(): THREE.CanvasTexture {
  return tex("notice", () => {
    const [c, g] = canvas(256, 192);
    const r = rng(77);
    g.fillStyle = "#b78a5a";
    g.fillRect(0, 0, 256, 192);
    grain(g, 256, 192, r, 0.2, 5000);
    g.fillStyle = "#6a4a2a";
    g.fillRect(0, 0, 256, 8);
    g.fillRect(0, 184, 256, 8);
    g.fillRect(0, 0, 8, 192);
    g.fillRect(248, 0, 8, 192);
    const papers = ["#fff6e0", "#ffe9a8", "#dff0ff", "#ffd6e0", "#e7ffd8"];
    for (let i = 0; i < 9; i++) {
      const w = 40 + r() * 40, h = 34 + r() * 40, x = 14 + r() * (220 - w), y = 14 + r() * (160 - h);
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.rotate((r() - 0.5) * 0.25);
      g.fillStyle = papers[i % papers.length];
      g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = "rgba(0,0,0,0.35)";
      for (let l = 0; l < 4; l++) g.fillRect(-w / 2 + 5, -h / 2 + 8 + l * 7, w * (0.4 + r() * 0.5), 2);
      g.fillStyle = ["#d9534f", "#3b6ea8", "#2f8f8a"][i % 3];
      g.beginPath();
      g.arc(0, -h / 2 + 3, 3, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    return c;
  }, false);
}

export function painting(i: number): THREE.CanvasTexture {
  return tex(`painting|${i}`, () => {
    const [c, g] = canvas(256, 192);
    const r = rng(300 + i);
    const palettes = [
      ["#2a2350", "#7a4f86", "#e88f7a", "#ffcf98"],
      ["#1f3a2e", "#4f8a3c", "#c9d8a0", "#f4efe6"],
      ["#3b6ea8", "#9ad3ff", "#f2efe6", "#e4b04a"],
      ["#d9534f", "#f2b25c", "#1f2a3a", "#f4efe6"],
      ["#2f8f8a", "#1f2a3a", "#e0a22f", "#f4efe6"],
    ];
    const p = palettes[i % palettes.length];
    const sky = g.createLinearGradient(0, 0, 0, 192);
    sky.addColorStop(0, p[0]);
    sky.addColorStop(1, p[2]);
    g.fillStyle = sky;
    g.fillRect(0, 0, 256, 192);
    if (i % 3 === 0) {
      // hills
      for (let k = 0; k < 3; k++) {
        g.fillStyle = shade(p[1], 0.7 + k * 0.25);
        g.beginPath();
        g.moveTo(0, 192);
        for (let x = 0; x <= 256; x += 16) g.lineTo(x, 110 + k * 22 + Math.sin(x * 0.03 + k) * 18 + r() * 4);
        g.lineTo(256, 192);
        g.fill();
      }
      g.fillStyle = p[3];
      g.beginPath();
      g.arc(190, 50, 18, 0, Math.PI * 2);
      g.fill();
    } else if (i % 3 === 1) {
      // colour blocks
      for (let k = 0; k < 6; k++) {
        g.fillStyle = p[(k + 1) % 4];
        g.fillRect(r() * 200, r() * 140, 30 + r() * 80, 20 + r() * 60);
      }
    } else {
      // a dog portrait, naturally
      g.fillStyle = p[1];
      g.beginPath();
      g.ellipse(128, 110, 54, 48, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = shade(p[1], 0.8);
      g.beginPath();
      g.ellipse(88, 78, 18, 30, -0.4, 0, Math.PI * 2);
      g.ellipse(168, 78, 18, 30, 0.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#2b211c";
      g.beginPath();
      g.arc(108, 104, 5, 0, Math.PI * 2);
      g.arc(148, 104, 5, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(128, 128, 9, 6, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = p[3];
      g.fillRect(0, 160, 256, 32);
      g.fillStyle = "#2b211c";
      g.font = "700 14px Georgia, serif";
      g.textAlign = "center";
      g.fillText("RESIDENT OF THE MONTH", 128, 181);
    }
    return c;
  }, false);
}

export function rug(i: number): THREE.CanvasTexture {
  return tex(`rug|${i}`, () => {
    const [c, g] = canvas(256, 160);
    const r = rng(500 + i);
    const base = ["#8a4e3b", "#3f5f7a", "#6f8f76", "#b56a5a", "#c9a14a"][i % 5];
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = shade(base, 1.5);
    g.lineWidth = 6;
    g.strokeRect(10, 10, 236, 140);
    g.lineWidth = 2;
    g.strokeRect(22, 22, 212, 116);
    g.fillStyle = shade(base, 1.4);
    for (let k = 0; k < 14; k++) {
      g.beginPath();
      g.moveTo(128, 80);
      g.arc(128, 80, 30 + r() * 20, (k / 14) * Math.PI * 2, ((k + 0.5) / 14) * Math.PI * 2);
      g.fill();
    }
    grain(g, 256, 160, r, 0.12, 3000);
    return c;
  }, false);
}

export function washerFront(): THREE.CanvasTexture {
  return tex("washer", () => {
    const [c, g] = canvas(192, 160);
    g.fillStyle = "#eef1f4";
    g.fillRect(0, 0, 192, 160);
    g.fillStyle = "#d8dde3";
    g.fillRect(0, 0, 192, 30);
    g.fillStyle = "#3a3f46";
    g.beginPath();
    g.arc(150, 15, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#6fd0a0";
    g.fillRect(16, 10, 36, 10);
    g.fillStyle = "#9aa4ae";
    g.beginPath();
    g.arc(96, 95, 52, 0, Math.PI * 2);
    g.fill();
    const glass = g.createRadialGradient(80, 80, 6, 96, 95, 44);
    glass.addColorStop(0, "#9ad3e8");
    glass.addColorStop(0.7, "#29425a");
    glass.addColorStop(1, "#1b2a3a");
    g.fillStyle = glass;
    g.beginPath();
    g.arc(96, 95, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.ellipse(78, 72, 14, 8, -0.6, 0, Math.PI * 2);
    g.fill();
    return c;
  }, false);
}

export function parcel(i: number): THREE.CanvasTexture {
  return tex(`parcel|${i}`, () => {
    const [c, g] = canvas(128);
    const r = rng(900 + i);
    g.fillStyle = ["#c69a6b", "#a97e55", "#d8b384"][i % 3];
    g.fillRect(0, 0, 128, 128);
    grain(g, 128, 128, r, 0.08);
    g.fillStyle = "rgba(230,215,180,0.9)";
    g.fillRect(52, 0, 24, 128);
    g.fillStyle = "#fff6e0";
    g.fillRect(14, 70, 44, 30);
    g.fillStyle = "rgba(0,0,0,0.4)";
    for (let l = 0; l < 3; l++) g.fillRect(18, 76 + l * 7, 20 + r() * 16, 2);
    g.fillStyle = "#2b211c";
    g.fillRect(80, 76, 30, 18);
    g.fillStyle = "#fff";
    for (let k = 0; k < 8; k++) g.fillRect(82 + k * 3.5, 78, r() < 0.5 ? 1 : 2, 14);
    return c;
  }, false);
}

export function neon(text: string, color: string): THREE.CanvasTexture {
  return tex(`neon|${text}|${color}`, () => {
    const [c, g] = canvas(512, 128);
    g.clearRect(0, 0, 512, 128);
    g.font = "italic 700 72px Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = color;
    g.shadowBlur = 24;
    g.fillStyle = color;
    g.fillText(text, 256, 64);
    g.shadowBlur = 6;
    g.fillStyle = "#fff8ee";
    g.fillText(text, 256, 64);
    return c;
  }, false);
}

export function label(text: string, bg: string, fg: string, font = "600 54px Georgia, serif"): THREE.CanvasTexture {
  return tex(`label|${text}|${bg}|${fg}|${font}`, () => {
    const [c, g] = canvas(512, 128);
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = fg;
    g.font = font;
    let size = Number(font.match(/(\d+)px/)?.[1] ?? 54);
    while (size > 18 && g.measureText(text).width > 480) {
      size -= 2;
      g.font = font.replace(/\d+px/, `${size}px`);
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 256, 68);
    return c;
  }, false);
}

/** a soft radial pool of light on the floor under a lamp */
export function glowPool(): THREE.CanvasTexture {
  return tex("glow", () => {
    const [c, g] = canvas(128);
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,214,150,0.55)");
    gr.addColorStop(0.5, "rgba(255,200,130,0.18)");
    gr.addColorStop(1, "rgba(255,200,130,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c;
  }, false);
}

/** painted contact shadow: dark along one edge, gone by the other (v = 0 is the dark edge) */
export function aoEdge(): THREE.CanvasTexture {
  return tex("aoEdge", () => {
    const [c, g] = canvas(8, 64);
    const gr = g.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, "rgba(0,0,0,0.42)");
    gr.addColorStop(0.35, "rgba(0,0,0,0.14)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 64);
    return c;
  }, false);
}
/** painted contact shadow under a piece of furniture: dark in the middle, soft at every edge */
export function aoBlob(): THREE.CanvasTexture {
  return tex("aoBlob", () => {
    const [c, g] = canvas(64);
    const gr = g.createRadialGradient(32, 32, 6, 32, 32, 32);
    gr.addColorStop(0, "rgba(0,0,0,0.5)");
    gr.addColorStop(0.6, "rgba(0,0,0,0.22)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return c;
  }, false);
}

// ------------------------------------------------------------------ the city outside
/**
 * Three skyline layers for parallax. 0 is the sky itself with the farthest towers, a moon and stars; 1 and 2 are
 * transparent rows of nearer towers. Each one is a mix of slabs, set-back towers and spires with warm and cool lit
 * windows, a few dark ones, and a red aircraft light on the tallest.
 */
export function skyline(layer: 0 | 1 | 2): THREE.CanvasTexture {
  return tex(`skyline|${layer}`, () => {
    const W = 2048, H = 512;
    const [c, g] = canvas(W, H);
    const r = rng(41 + layer * 17);
    if (layer === 0) {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#1b1740");
      sky.addColorStop(0.4, "#4a3570");
      sky.addColorStop(0.72, "#b06a86");
      sky.addColorStop(0.9, "#f0a07c");
      sky.addColorStop(1, "#ffd3a0");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.6})`;
        const s = r() < 0.9 ? 1 : 2;
        g.fillRect(r() * W, r() * H * 0.45, s, s);
      }
      // the moon
      g.fillStyle = "#fff3d0";
      g.shadowColor = "#ffe9b0";
      g.shadowBlur = 30;
      g.beginPath();
      g.arc(1500, 90, 26, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = "#e8d8b8";
      g.beginPath();
      g.arc(1492, 84, 5, 0, Math.PI * 2);
      g.arc(1510, 98, 3.5, 0, Math.PI * 2);
      g.fill();
      // a long band of cloud catching the last light
      g.fillStyle = "rgba(255,190,160,0.22)";
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.ellipse(r() * W, 250 + r() * 90, 180 + r() * 220, 10 + r() * 10, 0, 0, Math.PI * 2);
        g.fill();
      }
    } else g.clearRect(0, 0, W, H);
    const tint = layer === 0 ? [62, 46, 96] : layer === 1 ? [40, 32, 66] : [26, 22, 44];
    const count = layer === 0 ? 48 : layer === 1 ? 26 : 12;
    const hMin = layer === 0 ? 90 : layer === 1 ? 110 : 120;
    const hMax = layer === 0 ? 260 : layer === 1 ? 300 : 230;
    const warm = layer === 2 ? 0.5 : 0.8;
    // the nearer the layer, the more sky between its towers, so the layers behind show through
    const gap = layer === 0 ? 0.55 : layer === 1 ? 1.0 : 1.6;
    let x = -40;
    const towers: { x: number; w: number; h: number }[] = [];
    while (x < W + 40) {
      const w = (layer === 2 ? 70 : 46) + r() * (layer === 2 ? 110 : 80);
      const h = hMin + r() * (hMax - hMin);
      towers.push({ x, w, h });
      x += w * (gap + r() * 0.8);
    }
    for (const t of towers.slice(0, count * 2)) {
      const k = 0.9 + r() * 0.25;
      g.fillStyle = `rgb(${tint[0] * k | 0},${tint[1] * k | 0},${tint[2] * k | 0})`;
      const top = H - t.h;
      g.fillRect(t.x, top, t.w, t.h);
      const kind = r();
      if (kind < 0.35) {
        // set-back crown
        g.fillRect(t.x + t.w * 0.2, top - t.h * 0.12, t.w * 0.6, t.h * 0.12);
        g.fillRect(t.x + t.w * 0.38, top - t.h * 0.2, t.w * 0.24, t.h * 0.08);
      } else if (kind < 0.5) {
        // spire
        g.fillRect(t.x + t.w / 2 - 2, top - t.h * 0.22, 4, t.h * 0.22);
        g.fillStyle = "#ff5a4a";
        g.fillRect(t.x + t.w / 2 - 2, top - t.h * 0.22 - 3, 4, 3);
      } else if (kind < 0.62) {
        // a rooftop water tank
        g.fillRect(t.x + t.w * 0.6, top - 14, 12, 14);
      }
      // windows
      const cw = layer === 2 ? 9 : 7, ch = layer === 2 ? 12 : 9;
      const litShare = layer === 2 ? 0.34 : 0.58;
      for (let wy = top + 8; wy < H - 12; wy += ch + 5) for (let wx = t.x + 5; wx < t.x + t.w - cw - 2; wx += cw + 4) {
        const on = r();
        if (on > litShare) continue;
        g.fillStyle = on < litShare * warm ? `rgba(255,214,150,${0.75 + r() * 0.25})` : `rgba(170,215,255,${0.6 + r() * 0.3})`;
        g.fillRect(wx, wy, cw - 2, ch - 3);
      }
    }
    if (layer === 0) {
      // haze on the horizon so the far layer sits behind everything
      const haze = g.createLinearGradient(0, H * 0.55, 0, H);
      haze.addColorStop(0, "rgba(240,160,124,0)");
      haze.addColorStop(1, "rgba(255,200,150,0.55)");
      g.fillStyle = haze;
      g.fillRect(0, 0, W, H);
    }
    return c;
  }, false);
}

/** the view from a back window: nearer towers over the dusk gradient */
export function windowView(): THREE.CanvasTexture {
  return tex("windowView", () => {
    const [c, g] = canvas(2048, 512);
    g.drawImage(skyline(0).image as HTMLCanvasElement, 0, 0);
    g.drawImage(skyline(1).image as HTMLCanvasElement, 0, 60);
    return c;
  });
}

export function water(): THREE.CanvasTexture {
  return tex("water", () => {
    const S = 256;
    const [c, g] = canvas(S);
    const r = rng(5);
    g.fillStyle = "#3fb6dc";
    g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 2.5;
    for (let k = 0; k < 26; k++) {
      g.beginPath();
      const x = r() * S, y = r() * S;
      g.moveTo(x, y);
      g.bezierCurveTo(x + 20, y - 14, x + 40, y + 14, x + 60 + r() * 30, y);
      g.stroke();
    }
    g.fillStyle = "rgba(30,120,170,0.35)";
    for (let k = 0; k < 20; k++) {
      g.beginPath();
      g.ellipse(r() * S, r() * S, 14 + r() * 20, 5 + r() * 6, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  });
}

export function asphalt(): THREE.CanvasTexture {
  return tex("asphalt", () => {
    const S = 256;
    const [c, g] = canvas(S);
    const r = rng(9);
    g.fillStyle = "#2c2838";
    g.fillRect(0, 0, S, S);
    grain(g, S, S, r, 0.12, 6000);
    return c;
  });
}

export function sidewalk(): THREE.CanvasTexture {
  return tex("sidewalk", () => {
    const S = 256;
    const [c, g] = canvas(S);
    const r = rng(13);
    g.fillStyle = "#8f8a9c";
    g.fillRect(0, 0, S, S);
    grain(g, S, S, r, 0.1, 3000);
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 3;
    g.strokeRect(1, 1, S / 2 - 2, S - 2);
    g.strokeRect(S / 2 + 1, 1, S / 2 - 2, S - 2);
    return c;
  });
}
