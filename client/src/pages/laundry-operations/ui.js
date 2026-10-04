import { STAGES, STAGE_STYLE, STAGE_INDEX, SITE } from "./data.js";

const I = {
  search: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  bell: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  chev: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>`,
  mark: `<svg viewBox="0 0 24 24" fill="none" stroke="#1b2230" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="13" r="4.2"/><path d="M8 6.5h1.5"/></svg>`,
  bag: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>`,
  drum: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="3" width="16" height="18" rx="2.5"/><circle cx="12" cy="13" r="4.5"/><path d="M7.5 6.5h2"/></svg>`,
  clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
  cart: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c48300" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v9H4z"/><circle cx="7" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/></svg>`,
  check: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  pin: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`,
  ext: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
  dot: `<svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>`,
};

const stepIcon = {
  picked: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>`,
  received: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 4l9 6v10H3z"/><path d="M9 20v-6h6v6"/></svg>`,
  washing: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>`,
  drying: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 9c2-2 4 2 6 0s4 2 6 0 4 2 4 2M4 15c2-2 4 2 6 0s4 2 6 0 4 2 4 2"/></svg>`,
  folding: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16v4H4zM6 12h12v6H6z"/></svg>`,
  returned: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>`,
  ready: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/></svg>`,
};

export function renderHud(el, s) {
  const o = s.selected;
  const st = STAGE_STYLE[o.stage];
  const stageIdx = STAGE_INDEX[o.stage];
  const inMachine = o.stage === "drying" || o.stage === "washing";
  const pillText = inMachine ? `IN ${o.machine.toUpperCase()}` : o.stage === "returning" ? "OUT FOR RETURN · VAN 2" : o.stage === "returned" ? "RETURN COMPLETE" : st.text.toUpperCase();
  const metric = (ic, bg, fg, lbl, val, em, sub) => `
    <div class="metric"><div class="ic" style="background:${bg};color:${fg}">${ic}</div>
      <div><div class="lbl">${lbl}</div><div class="val">${val}${em ? `<em>${em}</em>` : ""}</div><div class="sub">${sub}</div></div></div>`;
  el.innerHTML = `
  <div class="topbar">
    <div class="brand"><div class="mark">${I.mark}</div>${SITE.brand}</div>
    <div class="search">${I.search}<span>Search orders, buildings, carts, machines…</span><kbd>/</kbd></div>
    <div class="spacer"></div>
    <div class="site"><span class="code">${SITE.code}</span><div><b>${SITE.name}</b><small>${SITE.sub}</small></div>${I.chev}</div>
    <div class="live"><i></i>Live ${s.clock}</div>
    <div class="bell">${I.bell}</div>
    <div class="user"><div class="avatar">AW</div><div><b>${SITE.user}</b><small>${SITE.role}</small></div>${I.chev}</div>
  </div>
  <div class="metrics">
    ${metric(I.bag, "#fff3d6", "#c48300", "Orders in plant", s.inPlant, "↑ 6", "6 picked up since 7 AM")}
    ${metric(I.drum, "#fff1e3", "#e2761a", "Dryers running", `${s.dryersOn}<span style="font-size:15px;color:#8a93a1;font-weight:700">/${s.dryersAll}</span>`, "", `${s.washersOn}/${s.washersAll} washers running`)}
    ${metric(I.clock, "#e7f8ee", "#12873f", "On-time returns", s.ontime, "↑ 0.6%", "last 30 days")}
  </div>
  <div class="maptools"><span>+</span><span>−</span><span>${I.pin}</span><span style="font-size:15px">⟲</span></div>
  <div class="panel">
    <div class="head">
      <div class="kind"><div class="ic">${I.cart}</div><div><small>CART ${o.cart}</small><b>Order ${o.order}</b></div></div>
      <div class="tools"><span>${I.pin}</span><span>${I.ext}</span><span>${I.x}</span></div>
    </div>
    <h2>${o.building}</h2>
    <div class="svc">${o.svc} · ${o.bags} bags · ${o.lb} lb</div>
    <div class="pill" style="color:${st.color};background:${st.bg}"><i></i>${pillText}</div>
    <div class="prog"><div class="row"><span>${o.stage === "drying" ? "Dry cycle" : o.stage === "washing" ? "Wash cycle" : o.stage === "returning" || o.stage === "returned" ? "Return route" : "Progress"}</span><b>${o.left}</b></div>
      <div class="bar"><i style="width:${Math.round(o.pct * 100)}%;background:${st.color}"></i></div></div>
    <div class="grid">
      <div class="r"><span>Picked up</span><b>${o.pickup}</b></div>
      <div class="r"><span>Return due</span><b>${o.due} · Today</b></div>
      <div class="r"><span>Next step</span><b>${o.next}</b></div>
    </div>
    <div class="items">${o.items.map((x) => `<span>${x}</span>`).join("")}</div>
  </div>
  <div class="track">
    <div>
      <div class="t-head">Order Tracking <small>${o.order} · ${o.building}</small></div>
      <div class="steps">
        ${STAGES.map((x, i) => {
          const cls = i < stageIdx ? (stageIdx >= 7 ? "done all" : "done") : i === stageIdx ? "now" : "";
          const sub = i < stageIdx ? o.times[i] : i === stageIdx ? (inMachine || o.stage === "returning" ? o.machine : "Now") : `ETA ${o.times[i]}`;
          const bg = i === stageIdx ? `style="background:${st.color};box-shadow:0 0 0 5px ${st.bg}"` : "";
          return `<div class="step ${cls}"><div class="dot" ${bg}>${i < stageIdx ? I.check : stepIcon[x.key]}</div><b ${i === stageIdx ? `style="color:${st.color}"` : ""}>${x.label}</b><small>${sub}</small></div>`;
        }).join("")}
      </div>
    </div>
    <div class="ret"><small>${o.stage === "returned" ? "RETURNED TO" : "RETURN TO"}</small><b>${o.building}</b><span>${o.stage === "returned" ? `Delivered 11:24 AM · <span class="ok">Early</span>` : `Due ${o.due} · <span class="ok">On track</span>`}</span></div>
  </div>
  <div class="machines">
    <div class="tabs"><span class="on">Active ${s.rows.length}</span><span>Washers ${s.washersOn}/${s.washersAll}</span><span>Dryers ${s.dryersOn}/${s.dryersAll}</span></div>
    ${s.rows.map((r) => {
      const t = STAGE_STYLE[r.stage];
      return `<div class="mrow"><span class="id">${r.machine}</span><span class="who">${r.building}</span><span class="tagp" style="color:${t.color};background:${t.bg}">${r.left}</span></div>`;
    }).join("")}
  </div>
  <div class="toast" id="toast"></div>
  `;
}

export function chipHtml(o, selected) {
  const st = STAGE_STYLE[o.stage];
  const what = o.stage === "drying" || o.stage === "washing" ? `In ${o.machine}` : o.stage === "returning" ? "Loading · Van 2" : st.text;
  return `<span class="cid" style="background:${st.color}">${o.cart}</span>${o.building}<small>${what}</small>`;
}
