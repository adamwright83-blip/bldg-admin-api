import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve("client/public/assets/goldline/missions/bio-containment");
const css = await readFile(
  resolve("client/src/game/fiction/CampaignRunMission.css"),
  "utf8"
);
const output = "artifacts/bio-containment-mission-qa";
await mkdir(output, { recursive: true });

async function dataUrl(filename) {
  const bytes = await readFile(resolve(root, filename));
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

const assets = {
  icon: await dataUrl("bio-containment-mission-icon.png"),
  hero: await dataUrl("bio-containment-mission-hero.png"),
  field: await dataUrl("bio-containment-field-bg.png"),
  offline: await dataUrl("detector-node-offline.png"),
  active: await dataUrl("detector-node-active.png"),
  online: await dataUrl("detector-node-online.png"),
  comms: await dataUrl("clockhead-field-comms.png"),
  complete: await dataUrl("bio-containment-grid-complete.png"),
};

const states = [
  {
    name: "01-selector-icon",
    scene: assets.icon,
    nodes: [],
    kicker: "CAMPAIGN RUN",
    role: "BIO CONTAINMENT",
    progress: "ICON",
  },
  {
    name: "02-briefing-hero",
    scene: assets.hero,
    nodes: [],
    kicker: "BIO CONTAINMENT",
    role: "FIELD AGENT",
    progress: "0 / 24",
  },
  {
    name: "03-field-offline-active-online",
    scene: assets.field,
    nodes: [assets.online, assets.active, assets.offline],
    kicker: "BIO CONTAINMENT",
    role: "FIELD AGENT",
    progress: "1 / 24",
  },
  {
    name: "04-clockhead-comms",
    scene: assets.comms,
    nodes: [],
    kicker: "BIO CONTAINMENT",
    role: "FIELD AGENT",
    progress: "6 / 24",
  },
  {
    name: "05-grid-complete",
    scene: assets.complete,
    nodes: [],
    kicker: "BIO CONTAINMENT",
    role: "FIELD AGENT",
    progress: "24 / 24",
  },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  colorScheme: "light",
});

for (const state of states) {
  const nodeHtml = state.nodes
    .map(
      (src, index) =>
        `<li data-node-state="${index === 1 ? "active" : index === 0 ? "online" : "offline"}"><img src="${src}" alt=""></li>`
    )
    .join("");
  const html = `<!doctype html>
<html>
<head>
  <style>
    html,body{margin:0;background:#fffaf0;color-scheme:light}
    ${css}
  </style>
</head>
<body>
  <section class="bc-mission">
    <img class="bc-mission-scene" src="${state.scene}" alt="">
    <header class="bc-mission-hud">
      <small>${state.kicker}</small>
      <b>${state.role}</b>
      <span>${state.progress}</span>
      <button class="bc-mission-close" type="button">CLOSE</button>
    </header>
    ${
      nodeHtml
        ? `<div class="bc-mission-field"><p class="bc-mission-echo">Nodes holding. Confirm each one as you place it.</p><ol class="bc-mission-nodes">${nodeHtml}</ol></div>`
        : state.name === "02-briefing-hero"
          ? `<div class="bc-mission-panel"><p>Every node you bring online extends the containment field.</p><button type="button">ENTER FIELD</button></div>`
          : state.name === "04-clockhead-comms"
            ? `<div class="bc-mission-panel"><p>6 NODES ACTIVE. First sector reads coherent.</p><button type="button">RETURN TO FIELD</button></div>`
            : state.name === "05-grid-complete"
              ? `<div class="bc-mission-panel"><p>GRID COMPLETE. Source isolated. Containment holding.</p></div>`
              : ""
    }
  </section>
</body>
</html>`;
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: `${output}/${state.name}.png`,
  });
}

await writeFile(
  `${output}/README.md`,
  [
    "# BIO CONTAINMENT mobile visual QA",
    "",
    "Portrait 390×844 captures of the approved source PNGs inside the mobile mission chrome.",
    "These illustrate presentation; mission truth still comes from Campaign Run projection.",
    "",
  ].join("\n")
);

await browser.close();
console.log(`wrote ${states.length} screenshots to ${output}`);
