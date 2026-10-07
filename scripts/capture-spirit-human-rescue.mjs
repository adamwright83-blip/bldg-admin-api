import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const coreArt = resolve("client/src/assets/spirit-human/core");
const output = "artifacts/spirit-human-rescue-qa";
await mkdir(output, { recursive: true });

async function dataUrl(filename, mime = "image/png") {
  const bytes = await readFile(resolve(coreArt, filename));
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

const environment = await dataUrl("environment.webp", "image/webp");
const threat = await dataUrl("threat.png");
const captive = await dataUrl("captive.png");
const playerMark = await dataUrl("playerMark.png");

const states = [
  { name: "calm", y: 0, label: "CALM" },
  { name: "descent", y: 28, label: "DESCENT" },
  { name: "holding", y: 36, label: "HOLDING — DRAFT VISIBLE" },
  { name: "unstable", y: 48, label: "UNSTABLE" },
  { name: "impact", y: 78, label: "IMPACT — GAME RESET" },
  { name: "send_failed", y: 36, label: "SEND FAILED — RETRY" },
  { name: "rescue", y: -8, label: "RESCUE — PROVIDER ACCEPTED" },
];

const css = `
body { margin: 0; background: #fffaf0; color: #3b2d1b; font-family: Inter, sans-serif; }
.stage { position: relative; width: 390px; height: 844px; overflow: hidden; color-scheme: light; }
.stage img.env { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.stage img.threat { position: absolute; top: -6%; left: 50%; width: 78%; transform: translate(-50%, var(--y)); }
.stage img.captive { position: absolute; left: 50%; bottom: 28%; width: 34%; transform: translateX(-50%); }
.stage img.player { position: absolute; left: 12%; bottom: 22%; width: 72px; }
.hud { position: absolute; left: 12px; right: 12px; top: 16px; padding: 12px; border-radius: 14px; background: #fffaf0e8; border: 1px solid #d7c28a; }
.hud small { display: block; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: #795a26; }
.note { position: absolute; left: 12px; right: 12px; bottom: 24px; padding: 12px; border-radius: 16px; background: #fffaf0f2; border: 1px solid #d7c28a; font-size: 14px; }
`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  colorScheme: "light",
});

for (const state of states) {
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
    <div class="stage" style="--y: ${state.y}%">
      <img class="env" src="${environment}" alt="">
      <img class="threat" src="${threat}" alt="">
      <img class="captive" src="${captive}" alt="">
      <img class="player" src="${playerMark}" alt="">
      <div class="hud"><small>JOYSTICK MISSION</small><b>Tallow is caged</b></div>
      <div class="note">${state.label}. Sending outreach is rescue. Reply/order is later.</div>
    </div>
  </body></html>`);
  await page.waitForTimeout(80);
  await page.screenshot({ path: resolve(output, `${state.name}.png`) });
}

await writeFile(
  resolve(output, "README.md"),
  "Deterministic Spirit Human rescue visual QA with final Pack 10 runtime art. No real customer send.\n"
);
await browser.close();
