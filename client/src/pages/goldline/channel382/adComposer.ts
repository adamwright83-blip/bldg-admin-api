/**
 * The finished ad: the diorama frame from the studio, set in Laundry Farm's own type and colours (the site's Playfair
 * Display and DM Sans; forest, cream and gold), 1080×1350 for an Instagram feed post. Nothing from the studio is
 * written on it.
 */
import { BRAND } from "./channel382Copy";

export type AdText = { headline: string; subline: string; offer: string };

const FONT_CSS = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=DM+Sans:wght@500;600;700&display=swap";

/** loads the brand's two typefaces once; the ad waits for them so the export never falls back to Times */
export async function loadAdFonts(): Promise<void> {
  if (typeof document === "undefined") return;
  if (!document.querySelector(`link[data-channel382-fonts]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_CSS;
    link.setAttribute("data-channel382-fonts", "1");
    document.head.appendChild(link);
  }
  try {
    await Promise.all([
      document.fonts.load('600 96px "Playfair Display"'),
      document.fonts.load('italic 500 96px "Playfair Display"'),
      document.fonts.load('600 40px "DM Sans"'),
      document.fonts.load('700 40px "DM Sans"'),
    ]);
  } catch {
    // a font that won't load falls back to Georgia / system sans; the ad still exports
  }
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (g.measureText(next).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function composeAd(photo: HTMLCanvasElement, text: AdText): HTMLCanvasElement {
  const W = 1080, H = 1350, M = 76;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.drawImage(photo, 0, 0, W, H);

  // a soft forest fade at the foot for the type, and a whisper of vignette
  const fade = g.createLinearGradient(0, H * 0.48, 0, H);
  fade.addColorStop(0, "rgba(26,58,42,0)");
  fade.addColorStop(0.45, "rgba(26,58,42,0.72)");
  fade.addColorStop(1, "rgba(20,46,33,0.96)");
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  const vig = g.createRadialGradient(W / 2, H * 0.42, H * 0.3, W / 2, H * 0.5, H * 0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.18)");
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);

  // wordmark: the name, as the site sets it, on a cream tab
  g.font = '700 38px "DM Sans", system-ui, sans-serif';
  const wm = BRAND.name;
  const wmW = g.measureText(wm).width;
  roundRect(g, M - 26, M - 18, wmW + 52, 72, 36);
  g.fillStyle = BRAND.cream;
  g.fill();
  g.fillStyle = BRAND.forest;
  g.textBaseline = "middle";
  g.fillText(wm, M, M + 18);

  // from the bottom up: CTA, subline, offer, headline
  let y = H - M;
  g.textBaseline = "alphabetic";
  g.font = '600 31px "DM Sans", system-ui, sans-serif';
  const cta = `Book a pickup  ·  ${BRAND.site}`;
  const ctaW = g.measureText(cta).width;
  roundRect(g, M - 2, y - 58, ctaW + 60, 74, 37);
  g.fillStyle = BRAND.cream;
  g.fill();
  g.fillStyle = BRAND.forest;
  g.fillText(cta, M + 28, y - 9);
  g.fillStyle = "rgba(250,247,242,0.75)";
  g.font = '600 26px "DM Sans", system-ui, sans-serif';
  g.textAlign = "right";
  g.fillText(BRAND.phone, W - M, y - 9);
  g.textAlign = "left";
  y -= 104;

  const sub = text.subline.trim();
  if (sub) {
    g.font = '500 36px "DM Sans", system-ui, sans-serif';
    g.fillStyle = "rgba(250,247,242,0.9)";
    const lines = wrap(g, sub, W - M * 2);
    for (let i = lines.length - 1; i >= 0; i--) {
      g.fillText(lines[i], M, y);
      y -= 48;
    }
    y -= 14;
  }

  const offer = text.offer.trim();
  if (offer) {
    g.font = '700 30px "DM Sans", system-ui, sans-serif';
    const ow = Math.min(W - M * 2, g.measureText(offer).width + 48);
    roundRect(g, M, y - 46, ow, 58, 29);
    g.fillStyle = BRAND.gold;
    g.fill();
    g.fillStyle = BRAND.forest;
    g.fillText(offer, M + 24, y - 7, W - M * 2 - 48);
    y -= 84;
  }

  // the headline in Playfair, the size that fits
  const head = text.headline.trim();
  let size = 92;
  let lines: string[] = [];
  for (; size >= 54; size -= 4) {
    g.font = `600 ${size}px "Playfair Display", Georgia, serif`;
    lines = wrap(g, head, W - M * 2);
    if (lines.length <= 3) break;
  }
  g.fillStyle = BRAND.cream;
  const lh = size * 1.1;
  for (let i = lines.length - 1; i >= 0; i--) {
    g.fillText(lines[i], M, y);
    y -= lh;
  }
  // the site's gold rule above the headline
  g.fillStyle = BRAND.gold;
  g.fillRect(M, y + lh - size - 26, 64, 4);
  return c;
}
