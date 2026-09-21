/* World Dwell — Act I parapet ruin graybox.
   Isolated tactile prototype. No Claire, Narrator, receipts, missions, XP.
   Touching a toy is never evidence that real work occurred.
   Authority: docs/goldline/GOLDLINE_WORLD_DWELL_GRAYBOX.md
              docs/goldline/GOLDLINE_ACT_I_RUIN_SPATIAL_PLAN.md
*/

(() => {
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const debugEl = document.getElementById("debug");
  const debugTab = document.getElementById("debugTab");

  const VW = 720;
  const VH = 1280;
  const TRAVEL = 640;
  const DEPTH = { far: 0.3, mid: 0.6, slack: 0.85, near: 1.1 };
  const DEFAULT_LEAN = -0.18;
  const LEAN_MIN = -1;
  const LEAN_MAX = 1;
  const DRAG_PX = 300;
  const COAST_TAU = 0.22;
  const SETTLE_OFF_STOP = 0.08;
  const WIRE_HIT = 34;
  const WIRE_SCRAPE = 22;
  const BOB_HIT = 42;
  const SLOW_TRACE_MS = 1100;
  const RUSH_PX_S = 780;

  const GOLD_PATH = [
    [40, 1008],
    [132, 944],
    [198, 902],
    [268, 888],
    [292, 848],
    [520, 768],
    [780, 708],
    [1088, 652],
  ];
  const SLACK_PATH = [
    [88, 1072],
    [196, 996],
    [430, 886],
    [690, 812],
  ];

  const state = {
    lean: DEFAULT_LEAN,
    vel: 0,
    settleY: 0,
    settleTarget: 0,
    shutterLift: 0,
    shutterLiftVel: 0,
    rattleX: 0,
    rattleV: 0,
    bobLift: 0,
    bobY: 0,
    bobV: 0,
    bobHeld: false,
    gold: false,
    slack: false,
    shutterMode: "none",
    clock: 14,
    sound: true,
    morningId: 0,
    goldNotedMorning: -1,
    seenColonnade: false,
    tracing: null,
    pointer: null,
    lastMove: null,
    samples: [],
    scrapeUntil: 0,
    nightWind: false,
  };

  let audioCtx = null;
  let windGain = null;
  let dpr = 1;
  let view = { x: 0, y: 0, s: 1, w: VW, h: VH };
  let lastT = performance.now();

  debugTab.addEventListener("click", () => {
    debugEl.classList.toggle("open");
  });

  document.getElementById("dbgGold").addEventListener("change", (e) => {
    state.gold = e.target.checked;
  });
  document.getElementById("dbgSlack").addEventListener("change", (e) => {
    state.slack = e.target.checked;
    if (!state.slack) {
      state.bobHeld = false;
      state.bobLift = 0;
      state.bobY = 0;
      state.bobV = 0;
    }
  });
  document.getElementById("dbgSound").addEventListener("change", (e) => {
    state.sound = e.target.checked;
    if (windGain) windGain.gain.value = state.sound && state.nightWind ? 0.03 : 0;
  });
  document.getElementById("dbgClock").addEventListener("input", (e) => {
    const next = Number(e.target.value);
    const prev = state.clock;
    state.clock = next;
    document.getElementById("clockRead").textContent = fmtClock(next);
    if (prev >= 20 && next < 8) state.morningId += 1;
  });
  for (const el of document.querySelectorAll('input[name="shutter"]')) {
    el.addEventListener("change", () => {
      if (el.checked) {
        state.shutterMode = el.value;
        if (el.value !== "keep") {
          state.shutterLift = 0;
          state.shutterLiftVel = 0;
        }
      }
    });
  }

  function fmtClock(h) {
    const wrapped = ((h % 24) + 24) % 24;
    const hh = Math.floor(wrapped);
    const mm = Math.floor((wrapped - hh) * 60);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createBufferSource();
      const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      src.buffer = buf;
      src.loop = true;
      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 380;
      bp.Q.value = 0.7;
      windGain = audioCtx.createGain();
      windGain.gain.value = 0;
      src.connect(bp);
      bp.connect(windGain);
      windGain.connect(audioCtx.destination);
      src.start();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function beep(kind) {
    if (!state.sound) return;
    ensureAudio();
    const t = audioCtx.currentTime;
    if (kind === "note") {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(196, t);
      o.frequency.exponentialRampToValueAtTime(174, t + 0.55);
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 1.15);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 1.2);
      return;
    }
    if (kind === "air") {
      noiseBurst(t, 0.18, 0.012, 1800, "highpass");
      return;
    }
    if (kind === "rasp") {
      noiseBurst(t, 0.12, 0.045, 900, "bandpass");
      return;
    }
    if (kind === "scrape") {
      noiseBurst(t, 0.07, 0.03, 1400, "highpass");
      return;
    }
    if (kind === "creak") {
      noiseBurst(t, 0.28, 0.04, 220, "lowpass");
      return;
    }
    if (kind === "clack") {
      noiseBurst(t, 0.05, 0.07, 420, "bandpass");
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "square";
      o.frequency.value = 90;
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.09);
      return;
    }
    if (kind === "knock") {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(70, t);
      g.gain.setValueAtTime(0.11, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.2);
      noiseBurst(t, 0.08, 0.03, 300, "lowpass");
      return;
    }
    if (kind === "gravel") {
      noiseBurst(t, 0.05, 0.012, 500, "bandpass");
    }
  }

  function noiseBurst(t, dur, gain, freq, type) {
    const n = audioCtx.createBufferSource();
    const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = audioCtx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    n.connect(f);
    f.connect(g);
    g.connect(audioCtx.destination);
    n.start(t);
    n.stop(t + dur + 0.02);
  }

  function polyLen(path) {
    let n = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i][0] - path[i - 1][0];
      const dy = path[i][1] - path[i - 1][1];
      n += Math.hypot(dx, dy);
    }
    return n;
  }

  function pointAt(path, t) {
    const total = polyLen(path);
    let remain = Math.max(0, Math.min(1, t)) * total;
    for (let i = 1; i < path.length; i++) {
      const ax = path[i - 1][0];
      const ay = path[i - 1][1];
      const bx = path[i][0];
      const by = path[i][1];
      const seg = Math.hypot(bx - ax, by - ay);
      if (remain <= seg || i === path.length - 1) {
        const u = seg ? remain / seg : 0;
        return [ax + (bx - ax) * u, ay + (by - ay) * u];
      }
      remain -= seg;
    }
    return path[path.length - 1];
  }

  function closest(path, x, y) {
    let best = { dist: Infinity, t: 0, x: path[0][0], y: path[0][1] };
    const total = polyLen(path);
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const ax = path[i - 1][0];
      const ay = path[i - 1][1];
      const bx = path[i][0];
      const by = path[i][1];
      const vx = bx - ax;
      const vy = by - ay;
      const seg = Math.hypot(vx, vy) || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (seg * seg)));
      const px = ax + vx * u;
      const py = ay + vy * u;
      const dist = Math.hypot(x - px, y - py);
      const t = (acc + u * seg) / total;
      if (dist < best.dist) best = { dist, t, x: px, y: py };
      acc += seg;
    }
    return best;
  }

  function tx(x, depth) {
    return x - state.lean * TRAVEL * depth + state.rattleX * (depth > 1 ? 1 : 0);
  }
  function ty(y, depth) {
    return y + state.settleY * depth * 0.35;
  }

  function worldFromPointer(clientX, clientY, depth) {
    const x = (clientX - view.x) / view.s;
    const y = (clientY - view.y) / view.s;
    return {
      x: x + state.lean * TRAVEL * depth,
      y: y - state.settleY * depth * 0.35,
    };
  }

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const s = Math.min(w / VW, h / VH);
    view = {
      s,
      w: VW * s,
      h: VH * s,
      x: (w - VW * s) / 2,
      y: (h - VH * s) / 2,
    };
    cv.style.width = `${view.w}px`;
    cv.style.height = `${view.h}px`;
    cv.width = Math.round(VW * dpr);
    cv.height = Math.round(VH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function isNightLook() {
    if (state.shutterMode === "keep" || state.shutterMode === "miss") return true;
    return state.clock >= 19.2 || state.clock < 5.2;
  }

  function sunT() {
    if (state.shutterMode === "keep" || state.shutterMode === "miss") return 1;
    return Math.max(0, Math.min(1, (state.clock - 6) / 13.5));
  }

  function stainClimb() {
    if (state.shutterMode !== "pending") return 0;
    return Math.max(0, Math.min(1, (state.clock - 12) / 7.5));
  }

  function skyColor() {
    const night = isNightLook();
    if (state.shutterMode === "keep") return "#1a1c22";
    if (night) return "#1d2026";
    const dusk = Math.max(0, Math.min(1, (state.clock - 16.5) / 3));
    const r = 122 - dusk * 50;
    const g = 136 - dusk * 55;
    const b = 148 - dusk * 40;
    return `rgb(${r|0},${g|0},${b|0})`;
  }

  function draw() {
    ctx.clearRect(0, 0, VW, VH);
    ctx.fillStyle = skyColor();
    ctx.fillRect(0, 0, VW, VH);

    drawFar();
    drawMid();
    drawStronghold();
    drawSlackAndBob();
    drawNearParapet();
    drawShutterLeaf();
  }

  function drawFar() {
    const d = DEPTH.far;
    const night = isNightLook();
    ctx.fillStyle = night ? "#2a323c" : "#5a6670";
    ctx.beginPath();
    ctx.moveTo(tx(-400, d), ty(338, d));
    ctx.lineTo(tx(1800, d), ty(338, d));
    ctx.lineTo(tx(1800, d), ty(540, d));
    ctx.lineTo(tx(-400, d), ty(520, d));
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = night ? "#3a4450" : "#6a7680";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const y = 370 + i * 22;
      ctx.beginPath();
      ctx.moveTo(tx(-400, d), ty(y, d));
      ctx.lineTo(tx(1800, d), ty(y + 6, d));
      ctx.stroke();
    }

    ctx.fillStyle = night ? "#3a3c38" : "#5c5c54";
    ctx.beginPath();
    ctx.moveTo(tx(180, d), ty(430, d));
    ctx.lineTo(tx(520, d), ty(300, d));
    ctx.lineTo(tx(820, d), ty(318, d));
    ctx.lineTo(tx(1100, d), ty(428, d));
    ctx.lineTo(tx(180, d), ty(500, d));
    ctx.closePath();
    ctx.fill();

    const hint = state.seenColonnade ? 72 : 0;
    const baseX = 820 - hint;
    const colW = 46;
    const gap = 78;
    for (let i = 0; i < 4; i++) {
      const half = i === 3;
      const x = baseX + i * gap;
      const w = half ? colW * 0.55 : colW;
      const top = 448;
      const bot = 860;
      ctx.fillStyle = night ? "#4a4944" : "#6e6c66";
      ctx.fillRect(tx(x, d), ty(top, d), w, bot - top);
      ctx.fillStyle = night ? "#3f3e3a" : "#5f5d57";
      ctx.fillRect(tx(x - 10, d), ty(top - 18, d), w + 20, 22);
      ctx.fillRect(tx(x - 8, d), ty(bot - 10, d), w + 16, 18);
    }
  }

  function drawMid() {
    const d = DEPTH.mid;
    ctx.fillStyle = isNightLook() ? "#3f3f3b" : "#6a6962";
    ctx.beginPath();
    ctx.moveTo(tx(-500, d), ty(520, d));
    ctx.lineTo(tx(1700, d), ty(548, d));
    ctx.lineTo(tx(1700, d), ty(1120, d));
    ctx.lineTo(tx(-500, d), ty(1060, d));
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#55544f";
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(tx(-400 + i * 180, d), ty(560, d));
      ctx.lineTo(tx(-220 + i * 180, d), ty(1080, d));
      ctx.stroke();
    }

    drawGroove(GOLD_PATH, d, state.gold);
  }

  function drawGroove(path, depth, gold) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2e2e2c";
    ctx.lineWidth = 14;
    strokePath(path, depth);
    if (gold) {
      ctx.strokeStyle = "#c4a35a";
      ctx.lineWidth = 7;
      strokePath(path, depth);
      ctx.strokeStyle = "#e0c57a";
      ctx.lineWidth = 2;
      strokePath(path, depth);
    } else {
      ctx.strokeStyle = "#3a3a36";
      ctx.lineWidth = 5;
      strokePath(path, depth);
    }
  }

  function strokePath(path, depth) {
    ctx.beginPath();
    ctx.moveTo(tx(path[0][0], depth), ty(path[0][1], depth));
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(tx(path[i][0], depth), ty(path[i][1], depth));
    }
    ctx.stroke();
  }

  function shutterRect() {
    return { x: -44, y: 612, w: 78, h: 148, d: DEPTH.near };
  }

  function drawStronghold() {
    const d = DEPTH.mid;
    const night = isNightLook();
    const keep = state.shutterMode === "keep";
    ctx.fillStyle = night ? "#2f2f2d" : "#4e4e4a";
    ctx.fillRect(tx(-260, d), ty(470, d), 420, 640);
    ctx.fillStyle = night ? "#262624" : "#42423e";
    ctx.beginPath();
    ctx.moveTo(tx(160, d), ty(470, d));
    ctx.lineTo(tx(228, d), ty(500, d));
    ctx.lineTo(tx(228, d), ty(1118, d));
    ctx.lineTo(tx(160, d), ty(1110, d));
    ctx.closePath();
    ctx.fill();

    const climb = stainClimb();
    if (climb > 0) {
      const wallH = 520;
      const h = 80 + climb * (wallH - 90);
      ctx.fillStyle = `rgba(212,176,122,${0.18 + climb * 0.22})`;
      ctx.fillRect(tx(-230, d), ty(1080 - h, d), 360, h);
    }

    const door = { x: -70, y: 600, w: 132, h: 200 };
    ctx.fillStyle = keep ? "#3a2414" : "#1a1a18";
    ctx.fillRect(tx(door.x, d), ty(door.y, d), door.w, door.h);

    if (keep) {
      const g = ctx.createLinearGradient(
        tx(door.x, d), ty(door.y, d),
        tx(door.x + door.w, d), ty(door.y + door.h, d)
      );
      g.addColorStop(0, "rgba(196,122,58,0.55)");
      g.addColorStop(1, "rgba(196,122,58,0.12)");
      ctx.fillStyle = g;
      ctx.fillRect(tx(door.x, d), ty(door.y, d), door.w, door.h);
    }

    ctx.fillStyle = keep ? "#5a4030" : "#2a2a28";
    ctx.fillRect(tx(-56, d), ty(742, d), 88, 14);

    const left = state.lean < -0.35;
    if (left || keep) {
      ctx.fillStyle = keep ? "#6a4a32" : "#30302c";
      ctx.fillRect(tx(-48, DEPTH.near * 0.95), ty(760, DEPTH.near * 0.95), 96, 18);
    }

    ctx.fillStyle = "#2a2a28";
    ctx.fillRect(tx(-250, d), ty(458, d), 400, 18);
  }

  function drawSlackAndBob() {
    if (!state.slack) return;
    const d = DEPTH.slack;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2a2a28";
    ctx.lineWidth = 10;
    strokePath(SLACK_PATH, d);
    ctx.strokeStyle = "#8a8478";
    ctx.lineWidth = 4;
    strokePath(SLACK_PATH, d);

    const tick = pointAt(SLACK_PATH, 0.42);
    const tx0 = tx(tick[0], d);
    const ty0 = ty(tick[1], d);
    ctx.strokeStyle = "#1f1f1d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tx0 - 11, ty0);
    ctx.lineTo(tx0 + 11, ty0);
    ctx.stroke();

    const restMiss = 16;
    const hang = 54 - state.bobLift + state.bobY;
    const bobX = tx0 + restMiss;
    const bobY = ty0 + hang;
    ctx.strokeStyle = "#6a6560";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tx0, ty0);
    ctx.lineTo(bobX, bobY - 16);
    ctx.stroke();
    ctx.fillStyle = "#6a6560";
    ctx.beginPath();
    ctx.arc(bobX, bobY, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8a8680";
    ctx.beginPath();
    ctx.arc(bobX - 3, bobY - 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawNearParapet() {
    const d = DEPTH.near;
    ctx.fillStyle = isNightLook() ? "#4a4944" : "#7a7870";
    ctx.fillRect(tx(-800, d), ty(1078, d), 2600, 240);
    ctx.fillStyle = isNightLook() ? "#3f3e3a" : "#6c6a64";
    ctx.fillRect(tx(-800, d), ty(1062, d), 2600, 22);
    ctx.strokeStyle = "#5a5852";
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.moveTo(tx(-700 + i * 180, d), ty(1078, d));
      ctx.lineTo(tx(-700 + i * 180, d), ty(1280, d));
      ctx.stroke();
    }
  }

  function drawShutterLeaf() {
    const r = shutterRect();
    const d = r.d;
    const keep = state.shutterMode === "keep";
    const open = state.shutterLift;
    const x = tx(r.x, d) + (keep ? 0 : state.rattleX);
    const y = ty(r.y, d) - open * (r.h - 18);
    const night = isNightLook();

    if (open > 0.15) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx(r.x, d), ty(r.y, d), r.w, r.h);
      ctx.clip();
      ctx.fillStyle = night ? "#2a323c" : "#5a6670";
      ctx.fillRect(tx(r.x, d), ty(r.y, d), r.w, r.h);
      ctx.fillStyle = "#3a3a38";
      ctx.fillRect(tx(r.x, d), ty(r.y, d), 10, r.h);
      ctx.fillRect(tx(r.x + r.w - 10, d), ty(r.y, d), 10, r.h);
      ctx.restore();
    }

    ctx.fillStyle = keep && open < 0.85 ? "#c47a3a" : "#2b2b29";
    if (keep && open < 0.2) {
      ctx.fillStyle = "#c47a3a";
      ctx.fillRect(tx(r.x - 3, d), ty(r.y - 3, d), r.w + 6, r.h + 6);
    }

    ctx.fillStyle = night ? "#3a3936" : "#5a5854";
    ctx.fillRect(x, y, r.w, r.h);
    ctx.strokeStyle = "#2a2a28";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, r.w - 3, r.h - 3);
    ctx.fillStyle = "#4a4844";
    ctx.fillRect(x + 8, y + r.h / 2 - 6, r.w - 16, 10);
    ctx.fillStyle = "#2e2e2c";
    ctx.fillRect(x + r.w / 2 - 5, y + 12, 10, r.h - 24);

    if (keep && open < 0.08) {
      ctx.strokeStyle = "rgba(196,122,58,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeRect(tx(r.x, d) + 2, ty(r.y, d) + 2, r.w - 4, r.h - 4);
    }
  }

  function hitShutter(px, py) {
    const r = shutterRect();
    const x = tx(r.x, r.d);
    const y = ty(r.y, r.d) - state.shutterLift * (r.h - 18);
    return px >= x - 10 && px <= x + r.w + 10 && py >= y - 10 && py <= y + r.h + 10;
  }

  function hitBob(px, py) {
    if (!state.slack) return false;
    const tick = pointAt(SLACK_PATH, 0.42);
    const d = DEPTH.slack;
    const hang = 54 - state.bobLift + state.bobY;
    const bobX = tx(tick[0], d) + 16;
    const bobY = ty(tick[1], d) + hang;
    return Math.hypot(px - bobX, py - bobY) < BOB_HIT;
  }

  function screenFromEvent(e) {
    return {
      x: (e.clientX - view.x) / view.s,
      y: (e.clientY - view.y) / view.s,
    };
  }

  function onDown(e) {
    if (e.target.closest("#debug") || e.target.closest("#debugTab")) return;
    e.preventDefault();
    ensureAudio();
    cv.setPointerCapture(e.pointerId);
    const p = screenFromEvent(e);
    const now = performance.now();

    if (hitBob(p.x, p.y)) {
      state.pointer = { kind: "bob", id: e.pointerId, y: p.y, lift0: state.bobLift };
      state.bobHeld = true;
      state.bobV = 0;
      state.settleTarget = 22;
      beep("creak");
      return;
    }

    const goldHit = closestWorld(GOLD_PATH, p, DEPTH.mid);
    if (goldHit.dist < WIRE_HIT) {
      state.pointer = {
        kind: "wire",
        id: e.pointerId,
        t0: goldHit.t,
        maxT: goldHit.t,
        start: now,
        rushed: false,
        off: false,
        last: p,
      };
      state.tracing = goldHit;
      state.settleTarget = 26;
      return;
    }

    if (state.slack) {
      const slackHit = closestWorld(SLACK_PATH, p, DEPTH.slack);
      if (slackHit.dist < WIRE_HIT) {
        state.pointer = { kind: "slack-wire", id: e.pointerId };
        beep("creak");
        state.settleTarget = 20;
        return;
      }
    }

    if (hitShutter(p.x, p.y)) {
      state.pointer = {
        kind: "shutter",
        id: e.pointerId,
        x: p.x,
        y: p.y,
        lift0: state.shutterLift,
        maxUp: 0,
      };
      return;
    }

    state.pointer = { kind: "lean", id: e.pointerId, x: p.x, y: p.y };
    state.vel = 0;
    state.samples = [{ t: now, x: p.x }];
  }

  function closestWorld(path, screenPt, depth) {
    const w = worldFromPointer(
      screenPt.x * view.s + view.x,
      screenPt.y * view.s + view.y,
      depth
    );
    const hit = closest(path, w.x, w.y);
    const sx = tx(hit.x, depth);
    const sy = ty(hit.y, depth);
    return { ...hit, dist: Math.hypot(screenPt.x - sx, screenPt.y - sy) };
  }

  function onMove(e) {
    if (!state.pointer || state.pointer.id !== e.pointerId) return;
    e.preventDefault();
    const p = screenFromEvent(e);
    const now = performance.now();
    const ptr = state.pointer;

    if (ptr.kind === "lean") {
      const dx = p.x - ptr.x;
      state.lean = clamp(state.lean + dx / DRAG_PX, LEAN_MIN, LEAN_MAX);
      ptr.x = p.x;
      ptr.y = p.y;
      state.samples.push({ t: now, x: p.x });
      if (state.samples.length > 8) state.samples.shift();
      if (Math.abs(dx) > 2 && now - (state.lastMove || 0) > 80) {
        beep("gravel");
        state.lastMove = now;
      }
      if (state.lean > 0.62) state.seenColonnade = true;
      return;
    }

    if (ptr.kind === "bob") {
      const dy = ptr.y - p.y;
      state.bobLift = clamp(ptr.lift0 + dy * 0.9, 0, 70);
      return;
    }

    if (ptr.kind === "wire") {
      const hit = closestWorld(GOLD_PATH, p, DEPTH.mid);
      if (hit.dist > WIRE_SCRAPE) {
        if (!ptr.off) beep("scrape");
        ptr.off = true;
        state.scrapeUntil = now + 90;
        return;
      }
      const dt = Math.max(8, now - (ptr.lastT || now));
      const speed = Math.hypot(p.x - ptr.last.x, p.y - ptr.last.y) / (dt / 1000);
      ptr.last = p;
      ptr.lastT = now;
      if (speed > RUSH_PX_S) ptr.rushed = true;
      if (hit.t + 0.02 >= ptr.maxT) ptr.maxT = hit.t;
      if (ptr.rushed && now - (ptr.lastRasp || 0) > 140) {
        beep("rasp");
        ptr.lastRasp = now;
      }
      return;
    }

    if (ptr.kind === "shutter") {
      const dy = ptr.y - p.y;
      const dx = p.x - ptr.x;
      ptr.maxUp = Math.max(ptr.maxUp, dy);
      if (state.shutterMode === "keep") {
        const next = clamp(ptr.lift0 + dy / 160, 0, 1);
        state.shutterLift = next;
      } else {
        state.rattleX = clamp(dx * 0.25, -10, 10);
        state.shutterLift = 0;
      }
    }
  }

  function onUp(e) {
    if (!state.pointer || state.pointer.id !== e.pointerId) return;
    const ptr = state.pointer;
    const now = performance.now();

    if (ptr.kind === "lean") {
      let v = 0;
      if (state.samples.length >= 2) {
        const a = state.samples[0];
        const b = state.samples[state.samples.length - 1];
        const dt = Math.max(16, b.t - a.t);
        v = (b.x - a.x) / dt;
      }
      state.vel = v * (1000 / DRAG_PX);
      if (state.lean > 0.62) state.seenColonnade = true;
    }

    if (ptr.kind === "bob") {
      state.bobHeld = false;
      state.bobY = -state.bobLift;
      state.bobLift = 0;
      state.bobV = 90;
      beep("creak");
    }

    if (ptr.kind === "wire") {
      const elapsed = now - ptr.start;
      const finished = ptr.maxT > 0.9 && !ptr.off;
      if (finished && state.gold && !ptr.rushed && elapsed >= SLOW_TRACE_MS) {
        if (state.goldNotedMorning === state.morningId) beep("air");
        else {
          beep("note");
          state.goldNotedMorning = state.morningId;
        }
      } else if (finished && ptr.rushed) {
        beep("rasp");
      } else if (ptr.off) {
        beep("scrape");
      }
    }

    if (ptr.kind === "shutter") {
      if (state.shutterMode === "keep") {
        if (ptr.maxUp > 48 && state.shutterLift > 0.42) {
          state.shutterLiftVel = 1.6;
        } else if (state.shutterLift < 0.92) {
          state.shutterLiftVel = -2.2;
        }
        if (state.shutterLift > 0.95) beep("knock");
      } else {
        state.rattleV = Math.abs(state.rattleX) > 1 ? -state.rattleX * 8 : 90;
        state.rattleX = state.rattleX || 8;
        beep("clack");
        state.shutterLift = 0;
      }
    }

    state.pointer = null;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function step(dt) {
    if (!state.pointer || state.pointer.kind !== "lean") {
      state.lean += state.vel * dt;
      if (state.lean > LEAN_MAX) {
        state.lean = LEAN_MAX;
        state.vel = 0;
      }
      if (state.lean < LEAN_MIN) {
        state.lean = LEAN_MIN;
        state.vel = 0;
      }
      state.vel *= Math.exp(-dt / COAST_TAU);
      if (Math.abs(state.vel) < 0.02) state.vel = 0;
      if (state.vel === 0 && !state.pointer) {
        if (state.lean > 1 - SETTLE_OFF_STOP) {
          state.lean += (1 - SETTLE_OFF_STOP - 0.02 - state.lean) * (1 - Math.exp(-dt * 6));
        }
        if (state.lean < -1 + SETTLE_OFF_STOP) {
          state.lean += (-1 + SETTLE_OFF_STOP + 0.02 - state.lean) * (1 - Math.exp(-dt * 6));
        }
      }
    }

    state.settleY += (state.settleTarget - state.settleY) * (1 - Math.exp(-dt * 7));
    /* Wire/shutter settle stays after release — no cut home. */

    if (!state.bobHeld) {
      state.bobV += 520 * dt;
      state.bobY += state.bobV * dt;
      if (state.bobY > 0) {
        state.bobY = 0;
        if (state.bobV > 80) state.bobV *= -0.18;
        else state.bobV = 0;
      }
      state.bobLift += (0 - state.bobLift) * (1 - Math.exp(-dt * 10));
    }

    if (state.shutterMode === "keep" && !state.pointer) {
      if (state.shutterLiftVel !== 0) {
        const prev = state.shutterLift;
        state.shutterLift = clamp(state.shutterLift + state.shutterLiftVel * dt, 0, 1);
        if (state.shutterLift === 1 && prev < 1) {
          beep("knock");
          state.shutterLiftVel = 0;
        }
        if (state.shutterLift === 0) state.shutterLiftVel = 0;
      }
    } else if (state.shutterMode !== "keep") {
      state.shutterLift = 0;
    }

    state.rattleX += state.rattleV * dt;
    state.rattleV += -state.rattleX * 70 - state.rattleV * 8;
    if (Math.abs(state.rattleX) < 0.2 && Math.abs(state.rattleV) < 0.4) {
      state.rattleX = 0;
      state.rattleV = 0;
    }

    const wind =
      state.shutterMode === "keep" && state.shutterLift > 0.7 && isNightLook();
    if (wind !== state.nightWind) {
      state.nightWind = wind;
      if (windGain) windGain.gain.value = state.sound && wind ? 0.03 : 0;
    }
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    step(dt);
    draw();
    requestAnimationFrame(loop);
  }

  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", layout);
  layout();
  requestAnimationFrame(loop);
  window.__worldDwell = state;
})();
