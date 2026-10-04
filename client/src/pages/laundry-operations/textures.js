import * as THREE from "three";

export const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

function tex(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Porcelain tile, 4x4 tiles per texture.
export function floorTexture(repeatX, repeatY) {
  const [c, g] = canvas(1024, 1024);
  const r = rng(7);
  const n = 4;
  const s = 1024 / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = (r() - 0.5) * 7;
      g.fillStyle = `rgb(${236 + v},${231 + v},${222 + v})`;
      g.fillRect(i * s, j * s, s, s);
      // faint veining
      g.strokeStyle = `rgba(160,150,135,${0.05 + r() * 0.05})`;
      g.lineWidth = 1.2;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        let x = i * s + r() * s,
          y = j * s + r() * s;
        g.moveTo(x, y);
        for (let q = 0; q < 6; q++) {
          x += (r() - 0.3) * 40;
          y += (r() - 0.5) * 40;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  for (let k = 0; k < 9000; k++) {
    g.fillStyle = `rgba(120,110,95,${r() * 0.05})`;
    g.fillRect(r() * 1024, r() * 1024, 1.5, 1.5);
  }
  g.fillStyle = "rgb(201,194,182)";
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * s - 2, 0, 4, 1024);
    g.fillRect(0, i * s - 2, 1024, 4);
  }
  return tex(c, { repeat: [repeatX, repeatY], aniso: 16 });
}

export function woodTexture() {
  const [c, g] = canvas(512, 512);
  const r = rng(11);
  const strip = 32;
  for (let x = 0; x < 512; x += strip) {
    const h = 30 + r() * 8,
      l = 62 + r() * 10;
    g.fillStyle = `hsl(${h},48%,${l}%)`;
    g.fillRect(x, 0, strip, 512);
    for (let k = 0; k < 7; k++) {
      g.strokeStyle = `hsla(${h - 4},45%,${l - 14}%,${0.15 + r() * 0.2})`;
      g.lineWidth = 0.8 + r();
      g.beginPath();
      const ox = x + r() * strip;
      g.moveTo(ox, 0);
      for (let y = 0; y < 512; y += 32) g.lineTo(ox + Math.sin(y * 0.02 + k) * 2, y);
      g.stroke();
    }
    g.fillStyle = "rgba(80,50,20,0.18)";
    g.fillRect(x, 0, 1.5, 512);
  }
  return tex(c, { repeat: [1, 1] });
}

export function weaveTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(3);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.03})`;
    g.fillRect(0, y, 256, 1);
  }
  for (let x = 0; x < 256; x += 3) {
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.03})`;
    g.fillRect(x, 0, 1, 256);
  }
  for (let k = 0; k < 2500; k++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  return tex(c, { repeat: [3, 3] });
}

export function perforatedTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#9da3a9";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#2a2e33";
  for (let y = 8; y < 256; y += 16)
    for (let x = (y / 16) % 2 ? 16 : 8; x < 256; x += 16) {
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fill();
    }
  return tex(c, { repeat: [6, 2] });
}

export function lcdTexture(text, color = "#ff5a4a") {
  const [c, g] = canvas(256, 112);
  g.fillStyle = "#07090b";
  g.fillRect(0, 0, 256, 112);
  g.fillStyle = color;
  g.font = `700 64px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 60);
  return tex(c);
}

export function plateTexture(text, { bg = "#f7f7f5", fg = "#1b1f26", w = 256, h = 160, size = 96 } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  roundRect(g, 0, 0, w, h, 18);
  g.fill();
  g.fillStyle = fg;
  g.font = `800 ${size}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 4);
  return tex(c);
}

// Cart placard: building name + order + status stripe.
export function tagTexture(name, sub, color) {
  const W = 1024,
    H = 400;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#fbfaf7";
  roundRect(g, 0, 0, W, H, 40);
  g.fill();
  g.fillStyle = color;
  roundRect(g, 0, 0, 70, H, 40);
  g.fill();
  g.fillRect(40, 0, 30, H);
  g.fillStyle = "#151a22";
  let size = 132;
  g.font = `800 ${size}px ${FONT}`;
  while (g.measureText(name).width > W - 150 && size > 60) {
    size -= 4;
    g.font = `800 ${size}px ${FONT}`;
  }
  g.textBaseline = "alphabetic";
  g.fillText(name, 110, 190);
  g.fillStyle = "#5b6472";
  g.font = `600 78px ${FONT}`;
  g.fillText(sub, 112, 318);
  return tex(c);
}

export function floorLabelTexture(text, sub) {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = "rgba(60,58,54,0.55)";
  g.font = `800 120px ${FONT}`;
  g.textBaseline = "middle";
  g.letterSpacing = "18px";
  g.fillText(text, 10, 100);
  if (sub) {
    g.font = `600 56px ${FONT}`;
    g.letterSpacing = "6px";
    g.fillStyle = "rgba(60,58,54,0.4)";
    g.fillText(sub, 14, 205);
  }
  return tex(c);
}

export function signTexture(title, sub) {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = "#16191e";
  roundRect(g, 0, 0, 1024, 256, 24);
  g.fill();
  g.fillStyle = "#f2b632";
  g.fillRect(48, 64, 14, 128);
  g.fillStyle = "#ffffff";
  g.font = `800 104px ${FONT}`;
  g.letterSpacing = "10px";
  g.textBaseline = "middle";
  g.fillText(title, 96, 112);
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.font = `600 48px ${FONT}`;
  g.letterSpacing = "4px";
  g.fillText(sub, 100, 196);
  return tex(c);
}

export function monitorTexture(rows) {
  const [c, g] = canvas(1024, 576);
  const grd = g.createLinearGradient(0, 0, 0, 576);
  grd.addColorStop(0, "#111821");
  grd.addColorStop(1, "#0b1016");
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 576);
  g.fillStyle = "#f2b632";
  g.font = `800 44px ${FONT}`;
  g.fillText("TODAY · 24 ORDERS IN PLANT", 48, 80);
  rows.forEach((r, i) => {
    const y = 140 + i * 80;
    g.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(g, 40, y, 944, 64, 12);
    g.fill();
    g.fillStyle = r[2];
    g.beginPath();
    g.arc(76, y + 32, 10, 0, 7);
    g.fill();
    g.fillStyle = "#e8edf3";
    g.font = `700 34px ${FONT}`;
    g.fillText(r[0], 104, y + 44);
    g.fillStyle = "rgba(232,237,243,0.6)";
    g.font = `600 30px ${FONT}`;
    g.textAlign = "right";
    g.fillText(r[1], 960, y + 44);
    g.textAlign = "left";
  });
  return tex(c);
}

export function haloTexture() {
  const [c, g] = canvas(256, 256);
  const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,196,64,0.38)");
  grd.addColorStop(0.7, "rgba(255,190,50,0.14)");
  grd.addColorStop(1, "rgba(255,190,50,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return tex(c);
}

export function vanLogoTexture(brand) {
  const [c, g] = canvas(1024, 320);
  g.fillStyle = "#e9a91f";
  roundRect(g, 20, 70, 180, 180, 40);
  g.fill();
  g.strokeStyle = "#1b2230";
  g.lineWidth = 16;
  roundRect(g, 66, 100, 88, 120, 16);
  g.stroke();
  g.beginPath();
  g.arc(110, 168, 26, 0, 7);
  g.stroke();
  g.fillStyle = "#1b2230";
  g.font = `800 112px ${FONT}`;
  g.textBaseline = "middle";
  g.fillText(brand, 236, 140);
  g.fillStyle = "#6b7280";
  g.font = `700 50px ${FONT}`;
  g.fillText("WASH · DRY · FOLD · DELIVERED", 240, 240);
  return tex(c);
}

export function lanternIcon() { return null; }
