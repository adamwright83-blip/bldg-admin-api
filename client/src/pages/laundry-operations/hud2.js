// HUD for the warm "Operations Command" direction.
const ic = {
  leaf: `<svg viewBox="0 0 64 64" width="58" height="58" fill="#fff"><path d="M32 58c-1-12 0-22 0-30 0 0-10-6-12-22 12 4 14 14 12 22 0 0 4-14 18-18-2 14-12 18-18 18v30z"/><path d="M30 56C22 52 10 44 8 30c10 2 18 10 22 26z" opacity=".95"/><path d="M34 56c8-4 20-12 22-26-10 2-18 10-22 26z" opacity=".95"/></svg>`,
  clip: `<svg viewBox="0 0 24 24" width="30" height="30"><rect x="4" y="4" width="16" height="18" rx="2.5" fill="#2f6df6"/><rect x="8.5" y="2" width="7" height="4" rx="1.4" fill="#2f6df6" stroke="#fff" stroke-width="1.2"/><path d="M8 10h8M8 13.5h8M8 17h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  dryer: `<svg viewBox="0 0 24 24" width="30" height="30"><rect x="3" y="2" width="18" height="20" rx="3" fill="#f26a1b"/><circle cx="12" cy="13.5" r="5" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M6.5 5.5h3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.5" cy="5.5" r="1" fill="#fff"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="10.5" fill="#16a34a"/><path d="M12 6.5V12l-3 3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  up: `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#16a34a" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M9 6h9v9"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1b1f26" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  towel: `<svg viewBox="0 0 24 24" width="28" height="28" fill="#2b2f36"><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="5" y="7" width="14" height="2" fill="#fff" opacity=".35"/></svg>`,
  tee: `<svg viewBox="0 0 24 24" width="28" height="28" fill="#2b2f36"><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z"/></svg>`,
  sheet: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#2b2f36" stroke-width="1.8" stroke-linejoin="round"><path d="M6 2.5h8l4 4V21.5H6z"/><path d="M14 2.5v4h4M9 11h6M9 14.5h6M9 18h4"/></svg>`,
  hoodie: `<svg viewBox="0 0 24 24" width="28" height="28" fill="#2b2f36"><path d="M9 3c0 2 1.3 3.5 3 3.5S15 5 15 3l5 3 1 15h-4v-8l-1 8H8l-1-8v8H3L4 6z"/></svg>`,
  chev: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#1b1f26" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>`,
};
const step = {
  picked: `<svg viewBox="0 0 24 24" width="34" height="34" fill="#5c6370"><path d="M2 6h12v10H2zM14 9h4l3 3.5V16h-7z"/><circle cx="6" cy="17.5" r="2.2" fill="#5c6370" stroke="#f1f2f4" stroke-width="1.2"/><circle cx="17" cy="17.5" r="2.2" fill="#5c6370" stroke="#f1f2f4" stroke-width="1.2"/></svg>`,
  received: `<svg viewBox="0 0 24 24" width="34" height="34" fill="#5c6370"><rect x="3" y="5" width="18" height="15" rx="2"/><rect x="5" y="7.5" width="14" height="3" rx="1" fill="#f1f2f4" opacity=".5"/></svg>`,
  washing: `<svg viewBox="0 0 24 24" width="34" height="34" fill="#3b4049"><path d="M12 2.5s7 7.6 7 12.5a7 7 0 0 1-14 0c0-4.9 7-12.5 7-12.5z"/></svg>`,
  drying: (on) => `<svg viewBox="0 0 24 24" width="36" height="36"><rect x="4" y="3" width="16" height="18" rx="2.5" fill="none" stroke="${on ? "#fff" : "#5c6370"}" stroke-width="2"/><circle cx="12" cy="13" r="4.4" fill="none" stroke="${on ? "#fff" : "#5c6370"}" stroke-width="2"/><path d="M7.5 6.5h3" stroke="${on ? "#fff" : "#5c6370"}" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  folding: (on) => `<svg viewBox="0 0 24 24" width="34" height="34" fill="${on ? "#fff" : "#3b4049"}"><path d="M5 2.5h9l5 5v14H5z"/><path d="M14 2.5v5h5" fill="${on ? "#f26a1b" : "#9aa1ab"}"/></svg>`,
  ready: (on) => `<svg viewBox="0 0 24 24" width="38" height="38"><circle cx="12" cy="12" r="4.5" fill="${on ? "#fff" : "#f6a91a"}"/><g stroke="${on ? "#fff" : "#f6a91a"}" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g></svg>`,
};
export const STEPS = [
  ["picked", "Picked Up"],
  ["received", "Received"],
  ["washing", "Washing"],
  ["drying", "Drying"],
  ["folding", "Folding"],
  ["ready", "Ready"],
];

export function buildHud(root) {
  root.innerHTML = `
  <div class="brand2"><div class="leaf">${ic.leaf}</div><div><b>Laundry Farm</b><small>OPERATIONS COMMAND</small></div></div>
  <div class="cards">
    <div class="card"><div class="ci">${ic.clip}</div><div><small>Orders in plant</small><b id="m-orders">24</b></div></div>
    <div class="card"><div class="ci">${ic.dryer}</div><div><small>Dryers running</small><b id="m-dryers">18/20</b></div></div>
    <div class="card"><div class="ci">${ic.clock}</div><div><small>On-time returns</small><b id="m-ontime">98.4% ${ic.up}</b></div></div>
  </div>
  <div class="insp" id="insp">
    <div class="ih"><b id="i-id">#2817</b><span>${ic.x}</span></div>
    <div class="isvc" id="i-svc">Wash &amp; Fold</div>
    <div class="isub" id="i-sub">2 bags · 28 lb.</div>
    <div class="ipill" id="i-pill">IN DRYER 04</div>
    <div class="iprog"><div class="ibar"><i id="i-bar"></i></div><span id="i-pct">72% complete</span></div>
    <div class="irows">
      <div class="ir">${ic.towel}<span>Towels</span><b>12</b></div>
      <div class="ir">${ic.tee}<span>Tees</span><b>9</b></div>
      <div class="ir">${ic.sheet}<span>Sheets</span><b>2</b></div>
      <div class="ir">${ic.hoodie}<span>Hoodies</span><b>2</b></div>
    </div>
  </div>
  <div class="strip"><div class="uline" id="uline"></div>${STEPS.map(([k, l], i) => `${i ? `<div class="chev">${ic.chev}</div>` : ""}<div class="st" data-k="${k}"><div class="sc"></div><span>${l}</span></div>`).join("")}</div>
  <svg class="link" id="link" width="1920" height="1080"><polyline id="link-l" fill="none" stroke="#ff7a1a" stroke-width="3" stroke-linejoin="round"/><circle id="link-a" r="7" fill="#ff7a1a" stroke="#fff" stroke-width="2.5"/><circle id="link-b" r="8" fill="#fff" stroke="#ff7a1a" stroke-width="3"/></svg>
  <div class="toast2" id="toast2"></div>
  `;
}

let lastStage = "";
export function setStage(root, active) {
  if (active === lastStage) return;
  lastStage = active;
  const idx = STEPS.findIndex(([k]) => k === active);
  root.querySelectorAll(".st").forEach((el, i) => {
    const k = el.dataset.k;
    const on = i === idx;
    el.classList.toggle("on", on);
    el.classList.toggle("done", i < idx);
    const f = step[k];
    el.querySelector(".sc").innerHTML = typeof f === "function" ? f(on) : f;
  });
}
