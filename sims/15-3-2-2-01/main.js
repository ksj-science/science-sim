// 15-3-2-2-01 대기 중의 수증기 — 포화 수증기량과 이슬점
import { sound } from '../../lib/sound.js';
import { clamp, paintRange, toast } from '../../lib/utils.js';

const UNIT = '15-3-2-2-01';
SimBridge.init(UNIT);

/* ═════════════ 포화 수증기량 모형 (설계서 그대로) ═════════════
 * 매듭점(°C → g/kg), 매듭점 사이는 ln(ws)에 대한 단조 3차 에르미트 보간(Fritsch–Carlson). */
const KX = [-10, 0, 5, 10, 15, 20, 25, 30, 35];
const KY = [2.0, 3.5, 5.0, 7.0, 10.0, 14.0, 20.0, 26.5, 35.0];
const LY = KY.map(Math.log);
const NK = KX.length;
const KH = [], KD = [], KM = new Array(NK);
for (let i = 0; i < NK - 1; i++) { KH[i] = KX[i + 1] - KX[i]; KD[i] = (LY[i + 1] - LY[i]) / KH[i]; }
KM[0] = KD[0]; KM[NK - 1] = KD[NK - 2];
for (let k = 1; k < NK - 1; k++) {
  if (KD[k - 1] * KD[k] <= 0) { KM[k] = 0; continue; }
  const w1 = 2 * KH[k] + KH[k - 1], w2 = KH[k] + 2 * KH[k - 1];
  KM[k] = (w1 + w2) / (w1 / KD[k - 1] + w2 / KD[k]);
}
const TMIN = -10, TMAX = 35, WMAX = 36;

/** 포화 수증기량 ws(T), g/kg */
function ws(T) {
  T = clamp(T, TMIN, TMAX);
  for (let i = 0; i < NK; i++) if (Math.abs(T - KX[i]) < 1e-9) return KY[i];
  let i = 0;
  while (i < NK - 2 && T > KX[i + 1]) i++;
  const h = KH[i], t = (T - KX[i]) / h, t2 = t * t, t3 = t2 * t;
  const ly = (2 * t3 - 3 * t2 + 1) * LY[i] + (t3 - 2 * t2 + t) * h * KM[i] + (-2 * t3 + 3 * t2) * LY[i + 1] + (t3 - t2) * h * KM[i + 1];
  return Math.exp(ly);
}
/** 이슬점 Td(w) = ws⁻¹(w), °C (범위 밖이면 null) */
function dewPoint(w) {
  for (let i = 0; i < NK; i++) if (Math.abs(w - KY[i]) < 1e-9) return KX[i];
  if (w < KY[0] || w > KY[NK - 1]) return null;
  let lo = TMIN, hi = TMAX;
  for (let n = 0; n < 60; n++) { const m = (lo + hi) / 2; if (ws(m) < w) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/* ═════════════ 표시 도우미 ═════════════ */
const r1 = v => Math.round(v * 10) / 10;
const sgn = x => (x < 0 ? '−' : '') + Math.abs(x);
const f1 = v => { const x = r1(v) || 0; return (x < 0 ? '−' : '') + Math.abs(x).toFixed(1); };
const f0 = v => sgn(Math.round(v) || 0);
const fT = v => (Math.abs(v - Math.round(v)) < 1e-6 ? f0(v) : f1(v)); // 기온: 정수면 정수
const $ = s => document.querySelector(s);

/* ═════════════ 상태 ═════════════ */
const app = { mode: 'saturate', paused: false, quality: 'high', locked: false, wasPaused: false };
const S1 = { T: 20, w: 3, time: 0, running: false, saturated: false, satTemps: [], runs: 0, trail: [], popT: 0, overDrop: 0 };
const S2 = { startT: 30, W: 14, Td: 20, T: 30, cooling: false, hold: 0, dewReached: false, minT: 30, dripStep: 0, log: [], end: '', flash: 0 };
const CARDS = [
  { key: '가', name: '공기 (가)', w: 7, T: 10 },
  { key: '나', name: '공기 (나)', w: 7, T: 20 },
  { key: '다', name: '연습 (다)', w: 14, T: 20 },
  { key: '라', name: '연습 (라)', w: 7, T: 30 },
  { key: '마', name: '연습 (마)', w: 3.5, T: 0 },
  { key: '바', name: '연습 (바)', w: 10, T: 25 },
];
const P0 = { T: -5, w: 30 };
const S3 = { idx: 0, pT: P0.T, pW: P0.w, choice: null, fb: null, results: {}, solved: {}, tries: 0, drag: false };

/* ═════════════ 소리 ═════════════ */
const tone = o => sound._tone(o);
const sfx = {
  pop() { tone({ freq: 650 + Math.random() * 350, freq2: 1300, type: 'sine', dur: 0.06, vol: 0.05 }); },
  satDing() { tone({ freq: 784, type: 'sine', dur: 0.45, vol: 0.14 }); tone({ freq: 1175, type: 'sine', dur: 0.6, vol: 0.13, delay: 0.16 }); },
  drip() { tone({ freq: 1500, freq2: 480, type: 'sine', dur: 0.09, vol: 0.13 }); },
  dew() { sound.ding(); setTimeout(() => sfx.drip(), 180); },
  wrong() { tone({ freq: 233, freq2: 196, type: 'triangle', dur: 0.32, vol: 0.18 }); },
};
let hiss = null;
function hissOn() { if (!hiss) { hiss = sound.sweep(); hiss.set(0.02); } hiss.pause(false); }
function hissOff() { if (hiss) { hiss.stop(); hiss = null; } }

/* ═════════════ SimBridge ═════════════ */
let dirty = true;
const mark = () => { dirty = true; };
function bridgeState() {
  const st = {
    mode: app.mode, satReachedTemps: S1.satTemps.join(','), evapRuns: S1.runs,
    startTempC: S2.startT, startVaporGkg: S2.W,
    dewPointC: S2.dewReached ? r1(S2.Td) : '',
    condensedG: r1(condensed2()), minTempC: r1(S2.minT),
    dewLog: S2.log.map(e => `${e.t}:${e.w}:${e.d}`).join(','),
    judgeResults: CARDS.filter(c => c.key in S3.results).map(c => `${c.key}:${S3.results[c.key]}`).join(','),
    judgeCorrect: Object.values(S3.results).filter(v => v === 1).length,
    judgeTries: S3.tries,
  };
  if (app.mode === 'saturate') Object.assign(st, { tempC: S1.T, vaporGkg: r1(S1.w), satVaporGkg: r1(ws(S1.T)), saturated: S1.saturated });
  else if (app.mode === 'dew') Object.assign(st, { tempC: r1(S2.T), vaporGkg: r1(vapor2()), satVaporGkg: r1(ws(S2.T)), saturated: S2.dewReached && S2.T <= S2.Td + 1e-6 });
  else Object.assign(st, { tempC: S3.pT, vaporGkg: S3.pW, satVaporGkg: r1(ws(S3.pT)), saturated: '' });
  return st;
}
function flush() { dirty = false; SimBridge.setState(bridgeState()); }
setInterval(() => { if (dirty) flush(); }, 200);

/* ═════════════ 캔버스 ═════════════ */
const sceneCv = $('#scene'), sctx = sceneCv.getContext('2d');
const graphCv = $('#graph'), gctx = graphCv.getContext('2d');
let dpr = 1, SW = 0, SH = 0, GW = 0, GH = 0, gStatic = null;
function resize() {
  dpr = app.quality === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const a = sceneCv.getBoundingClientRect(), b = graphCv.getBoundingClientRect();
  SW = Math.max(10, a.width); SH = Math.max(10, a.height);
  GW = Math.max(10, b.width); GH = Math.max(10, b.height);
  sceneCv.width = Math.round(SW * dpr); sceneCv.height = Math.round(SH * dpr);
  graphCv.width = Math.round(GW * dpr); graphCv.height = Math.round(GH * dpr);
  buildGraphStatic();
}
const ro = new ResizeObserver(() => resize());
[$('#sceneCard'), $('#graphCard .cv')].forEach(e => ro.observe(e));

/* ═════════════ 장면 기하 ═════════════ */
function geom() {
  const W = SW, H = SH;
  const base = H * 0.845;
  const jh = H * 0.64;
  const jw = Math.min(W * 0.6, jh * 0.95);
  const cx = W * 0.57;
  const x0 = cx - jw / 2, x1 = cx + jw / 2, top = base - jh;
  const ry = jw * 0.42, yS = top + ry;
  const ix0 = x0 + 5, ix1 = x1 - 5, irx = (ix1 - ix0) / 2, iry = ry - 5;
  const r = clamp(jw * 0.017, 3.5, 6);
  const G = { W, H, base, jh, jw, cx, x0, x1, top, ry, yS, ix0, ix1, irx, iry, r };
  if (app.mode === 'saturate') {
    const bw = jw * 0.78, bh = jh * 0.2;
    const drop = clamp((S1.w - 3) * 0.55, -4, 18) * (jh / 330);
    G.bowl = { x0: cx - bw / 2, x1: cx + bw / 2, top: base - bh, bot: base - 3, surf: base - bh + bh * 0.2 + drop };
    G.floor = base - 3;
  } else if (app.mode === 'dew') {
    const pt = clamp(jh * 0.05, 8, 14);
    G.plate = { top: base - pt, h: pt };
    G.floor = G.plate.top - 1;
  } else G.floor = base - 4;
  return G;
}
const topAt = (G, x) => { const q = (x - G.cx) / G.irx; return G.yS - G.iry * Math.sqrt(Math.max(0, 1 - q * q)); };

/* ═════════════ 물 분자 (입자 모형) ═════════════
 * 분자 1개 = 수증기 Q g/kg.
 * - 공기 속 분자는 기온이 높을수록 빠르게, 방향을 수시로 바꾸며 무작위로 움직인다.
 * - 우연히 물 표면(①: 그릇 입구로 들어가 수면, ②: 물방울이 맺힌 냉각 판)에 닿으면 응결해 사라진다.
 * - 증발은 수면의 무작위 위치에서 무작위 위쪽 방향으로 튀어 나온다.
 * 분자 하나가 1초 동안 물 표면에 닿을 확률 λ = v·L/(π·A) (2차원 기체의 벽 충돌 빈도, L=물 표면 길이, A=공기 넓이).
 * 증발 빈도 E = λ·Nsat(T) 로 두면 응결 빈도 λ·N 과 N = Nsat 에서 같아져 평형(포화)이 된다.
 * 기온이 높을수록 v·Nsat 가 커져 증발과 응결이 모두 많아진다. 화면 수치는 이 평균(dw/dt = λ(ws − w))을 쓴다. */
const Q = 0.25, MAXMOL = 150;
const mols = [], ripples = [], drops = [];
const RATE = { e: 0, c: 0, ne: 0, nc: 0 }; // 최근 증발·응결 빈도(개/초, 지수 평균)
const vMol = (G, T) => G.jh * (0.33 + 0.6 * (T - TMIN) / (TMAX - TMIN)); // 화면용(실제보다 차이를 키움)
function bottomAt(G, x) { // 공기 영역의 바닥(분자 중심 기준)
  if (app.mode === 'saturate') {
    const b = G.bowl;
    if (x > b.x0 - G.r && x < b.x1 + G.r) return b.top - (x > b.x0 && x < b.x1 ? 0 : G.r);
  }
  return G.floor - G.r;
}
function airArea(G) {
  const a = G.ix0 + G.r, z = G.ix1 - G.r, n = 60, h = (z - a) / n;
  let A = 0;
  for (let i = 0; i < n; i++) { const x = a + (i + 0.5) * h; A += Math.max(0, bottomAt(G, x) - (topAt(G, x) + G.r)) * h; }
  return Math.max(1, A);
}
function sinkLen(G) { return app.mode === 'saturate' ? G.bowl.x1 - G.bowl.x0 : app.mode === 'dew' ? G.ix1 - G.ix0 - 2 * G.r : 0; }
const lamOf = (G, T) => vMol(G, T) * sinkLen(G) / (Math.PI * airArea(G));
function newAir(G) {
  for (let k = 0; k < 30; k++) {
    const x = G.ix0 + G.r + Math.random() * (G.ix1 - G.ix0 - 2 * G.r);
    const y0 = topAt(G, x) + G.r, y1 = bottomAt(G, x);
    if (y1 - y0 < 2) continue;
    const a = Math.random() * Math.PI * 2;
    return { ph: 'air', x, y: y0 + Math.random() * (y1 - y0), vx: Math.cos(a), vy: Math.sin(a), tag: 0 };
  }
  return { ph: 'air', x: G.cx, y: (G.yS + G.floor) / 2, vx: 1, vy: 0, tag: 0 };
}
function targetCount() {
  const w = app.mode === 'saturate' ? S1.w : app.mode === 'dew' ? vapor2() : CARDS[S3.idx].w;
  return Math.min(MAXMOL, Math.round(w / Q));
}
function snapMolecules() { // 애니메이션 없이 바로 맞춤
  const G = geom(); mols.length = 0; drops.length = 0; ripples.length = 0;
  const n = targetCount();
  for (let i = 0; i < n; i++) mols.push(newAir(G));
  RATE.e = RATE.c = RATE.ne = RATE.nc = 0; evAcc = 0;
}
const waterWall = (G, y) => { const b = G.bowl, ins = (b.x1 - b.x0) * 0.07 * clamp((y - b.top) / (b.bot - b.top), 0, 1); return [b.x0 + ins + G.r, b.x1 - ins - G.r]; };
function evaporate(G) {
  if (mols.length >= MAXMOL) return;
  const a = (Math.random() - 0.5) * Math.PI * 0.85; // 위쪽 ±76° 안의 무작위 방향
  const vx = Math.sin(a), vy = -Math.cos(a);
  if (app.mode === 'saturate') {
    const b = G.bowl, [l, r] = waterWall(G, b.surf);
    mols.push({ ph: 'up', x: l + Math.random() * Math.max(1, r - l), y: b.surf - 1, vx, vy, tag: 0.8 });
    const now = performance.now(); if (now - S1.popT > 250) { S1.popT = now; sfx.pop(); }
  } else {
    mols.push({ ph: 'air', x: G.ix0 + G.r + Math.random() * (G.ix1 - G.ix0 - 2 * G.r), y: G.floor - G.r - 1, vx, vy, tag: 0.8 });
  }
  RATE.ne++;
}
let evAcc = 0, evThr = 1;
/** 증발 과정(포아송): 평균 빈도 = λ·N목표 (+ 분자 수를 평균값 근처로 붙잡는 작은 보정) */
function exchange(G, dt, Ntarget, sinkOn, lam) {
  const corr = 0.6 * (Ntarget - mols.length);
  const rate = Math.max(0, (sinkOn ? lam * Ntarget : 0) + corr);
  evAcc += rate * dt;
  while (evAcc >= evThr) { evAcc -= evThr; evThr = -Math.log(1 - Math.random()); evaporate(G); }
}
function condenseAt(x, y) { RATE.nc++; if (ripples.length < 40) ripples.push({ x, y, t: 0 }); }
function updateMolecules(G, dt, Tnow, sinkOn) {
  const v = vMol(G, Tnow), r = G.r, st = v * dt, b = G.bowl;
  for (let i = mols.length - 1; i >= 0; i--) {
    const m = mols[i];
    if (m.tag > 0) m.tag -= dt;
    const py = m.y;
    m.x += m.vx * st; m.y += m.vy * st;
    if (m.ph === 'air') {
      // 공기·다른 분자와 부딪혀 방향이 바뀜(무작위)
      if (Math.random() < 1.8 * dt) { const a = Math.random() * Math.PI * 2; m.vx = Math.cos(a); m.vy = Math.sin(a); }
      if (m.x < G.ix0 + r) { m.x = G.ix0 + r; m.vx = Math.abs(m.vx); }
      if (m.x > G.ix1 - r) { m.x = G.ix1 - r; m.vx = -Math.abs(m.vx); }
      const ty = topAt(G, m.x) + r;
      if (m.y < ty) { m.y = ty; m.vy = Math.abs(m.vy); m.vx += (G.cx - m.x) / G.irx * 0.3; const L = Math.hypot(m.vx, m.vy); m.vx /= L; m.vy /= L; }
      if (app.mode === 'saturate') {
        const inOpen = m.x > b.x0 && m.x < b.x1;
        if (inOpen && m.y >= b.top) {
          if (sinkOn) { m.ph = 'down'; if (m.vy < 0.35) { m.vy = 0.35; const L = Math.hypot(m.vx, m.vy); m.vx /= L; m.vy /= L; } RATE.nc++; continue; }
          m.y = b.top; m.vy = -Math.abs(m.vy);
        } else if (!inOpen && m.x > b.x0 - r && m.x < b.x1 + r && m.y > b.top - r) { // 그릇 가장자리·바깥 벽
          if (py <= b.top - r + 0.5) { m.y = b.top - r; m.vy = -Math.abs(m.vy); }
          else if (m.x <= b.x0) { m.x = b.x0 - r; m.vx = -Math.abs(m.vx); }
          else { m.x = b.x1 + r; m.vx = Math.abs(m.vx); }
        }
        if (m.y > G.floor - r) { m.y = G.floor - r; m.vy = -Math.abs(m.vy); }
      } else if (m.y > G.floor - r) {
        if (sinkOn) { mols.splice(i, 1); condenseAt(m.x, G.floor); continue; } // 물방울 맺힌 판에 닿음 → 응결
        m.y = G.floor - r; m.vy = -Math.abs(m.vy);
      }
    } else { // 그릇 안: 'down' 수면으로 떨어짐, 'up' 수면에서 튀어 나옴
      const [l, rr] = waterWall(G, m.y);
      if (m.x < l) { m.x = l; m.vx = Math.abs(m.vx); }
      if (m.x > rr) { m.x = rr; m.vx = -Math.abs(m.vx); }
      if (m.ph === 'down' && m.y >= b.surf - r * 0.4) { mols.splice(i, 1); if (ripples.length < 40) ripples.push({ x: m.x, y: b.surf, t: 0 }); continue; }
      if (m.ph === 'up' && m.y < b.top - r) m.ph = 'air';
    }
  }
  for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].t += dt; if (ripples[i].t > 0.6) ripples.splice(i, 1); }
  if (dt > 0) {
    const k = 1 - Math.exp(-dt / 2.5);
    RATE.e += (RATE.ne / dt - RATE.e) * k; RATE.c += (RATE.nc / dt - RATE.c) * k;
    RATE.ne = RATE.nc = 0;
  }
}

/* ═════════════ ① 포화 상태 만들기 ═════════════ */
function update1(dt, G) {
  if (!S1.running) return;
  S1.time += dt;
  const sat = ws(S1.T), lam = lamOf(G, S1.T);
  const was = S1.saturated;
  S1.w = sat + (S1.w - sat) * Math.exp(-lam * dt);
  if (Math.abs(sat - S1.w) < 0.05) S1.w = sat;
  S1.saturated = S1.w === sat;
  if (S1.saturated && !was) onSaturated();
  exchange(G, dt, S1.w / Q, true, lam);
  // 기온을 내려 과포화 → 벽에 물방울이 맺혔다 흘러내림
  if (S1.w > sat + 0.05) {
    S1.overDrop += (S1.w - sat) * dt * 2.2;
    while (S1.overDrop >= 1 && drops.length < 80) {
      S1.overDrop -= 1;
      const left = Math.random() < 0.5;
      drops.push({ side: left ? -1 : 1, y: G.yS + Math.random() * (G.bowl.top - G.yS) * 0.7, vy: 0, r: 2.2 + Math.random() * 2.2, t: 0 });
    }
  }
  if (S1.trail.length === 0 || Math.abs(S1.trail.at(-1).w - S1.w) > 0.08 || S1.trail.at(-1).T !== S1.T) S1.trail.push({ T: S1.T, w: S1.w });
  if (S1.trail.length > 400) S1.trail.shift();
  mark();
}
function onSaturated() {
  sfx.satDing();
  const t = S1.T;
  if (!S1.satTemps.includes(t)) S1.satTemps.push(t);
  mark();
}
function updateDrops1(G, dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.t += dt;
    if (d.t > 0.5) { d.vy += 60 * dt; d.y += d.vy * dt; }
    if (d.y > G.base - 6) drops.splice(i, 1);
  }
}
function setT1(v) {
  v = clamp(Math.round(v), TMIN, TMAX);
  if (v === S1.T) return;
  S1.T = v; sound.tick((v - TMIN) / (TMAX - TMIN));
  S1.saturated = Math.abs(ws(v) - S1.w) < 1e-9;
  mark();
}
function toggleEvap(force) {
  S1.running = force ?? !S1.running;
  if (S1.running) { S1.runs++; if (app.paused) setPaused(false); sound.on(); }
  else sound.off();
  mark();
}

/* ═════════════ ② 이슬점과 응결량 ═════════════ */
const vapor2 = () => Math.min(S2.W, ws(S2.T));
const condensed2 = () => Math.max(0, S2.W - ws(S2.T));
const dewSat2 = () => S2.dewReached && S2.T <= S2.Td + 1e-6; // 냉각 판에 물방울이 맺힌(포화) 상태
const wMax2 = T => Math.floor(ws(T) * 2 + 1e-9) / 2;
function setStart2(T, W, silent) {
  S2.startT = clamp(Math.round(T), 0, 35);
  S2.W = clamp(Math.round(W * 2) / 2, 1, wMax2(S2.startT));
  S2.Td = dewPoint(S2.W);
  resetAir2();
  if (!silent) snapMolecules();
}
function resetAir2() {
  S2.T = S2.startT; S2.cooling = false; S2.hold = 0; S2.dewReached = false; S2.minT = S2.startT; S2.dripStep = 0; S2.end = ''; S2.flash = 0;
  hissOff(); mark();
}
function setT2(T, fromUser) {
  T = clamp(T, TMIN, S2.startT);
  const prev = S2.T;
  if (Math.floor(prev + 1e-9) !== Math.floor(T + 1e-9) || fromUser) sound.tick((T - TMIN) / (TMAX - TMIN));
  S2.T = T; S2.minT = Math.min(S2.minT, T);
  if (!S2.dewReached && ws(T) <= S2.W + 1e-6) {
    S2.dewReached = true; S2.flash = 2.2; sfx.dew();
    const e = { t: S2.startT, w: S2.W, d: r1(S2.Td) };
    if (!S2.log.some(x => x.t === e.t && x.w === e.w)) { S2.log.push(e); if (S2.log.length > 6) S2.log.shift(); renderDewTable(true); }
  }
  const step = Math.floor(condensed2() / 0.5 + 1e-6);
  if (step > S2.dripStep) sfx.drip();
  S2.dripStep = step;
  S2.end = '';
  mark();
}
function update2(dt) {
  if (S2.flash > 0) S2.flash = Math.max(0, S2.flash - dt);
  if (!S2.cooling) return;
  if (S2.hold > 0) { S2.hold -= dt; return; }
  let nT = S2.T - 2 * dt;
  if (!S2.dewReached && S2.Td !== null && S2.T > S2.Td + 1e-9 && nT <= S2.Td) { nT = S2.Td; S2.hold = 0.6; }
  if (nT <= TMIN) { nT = TMIN; }
  setT2(nT);
  if (nT <= TMIN) { stopCool(); if (!S2.dewReached) S2.end = 'nodew'; }
}
function startCool() {
  if (S2.T <= TMIN + 1e-9) resetAir2();
  S2.cooling = true; if (app.paused) setPaused(false);
  hissOn(); sound.soft(); mark();
}
function stopCool() { S2.cooling = false; S2.hold = 0; hissOff(); mark(); }

/* ═════════════ ③ 공기 판정하기 ═════════════ */
function classify(c) { const s = ws(c.T); return Math.abs(c.w - s) < 1e-6 ? 'sat' : c.w < s ? 'unsat' : 'over'; }
function setPoint(T, w) {
  T = clamp(Math.round(T), TMIN, TMAX); w = clamp(Math.round(w * 2) / 2, 0, WMAX);
  if (T === S3.pT && w === S3.pW) return false;
  S3.pT = T; S3.pW = w; S3.fb = null; sound.tick((w / WMAX) * 0.6 + 0.2); mark();
  return true;
}
function chooseState(s) { if (S3.solved[CARDS[S3.idx].key]) return; S3.choice = s; S3.fb = null; sound.soft(); renderJudge(); }
function checkCard() {
  const c = CARDS[S3.idx];
  if (S3.solved[c.key]) { S3.fb = { type: 'info', msg: '이미 맞힌 공기예요. [다음 공기 ▶]를 눌러 보세요.' }; renderJudge(); return; }
  if (!S3.choice) { S3.fb = { type: 'info', msg: '먼저 [포화 상태] 또는 [불포화 상태]를 골라 주세요.' }; sound.soft(); renderJudge(); return; }
  S3.tries++;
  const posOK = S3.pT === c.T && Math.abs(S3.pW - c.w) < 1e-9;
  const stOK = S3.choice === classify(c);
  if (posOK && stOK) {
    S3.results[c.key] = 1; S3.solved[c.key] = { T: c.T, w: c.w, st: S3.choice };
    S3.fb = { type: 'ok', msg: `맞았어요! ${c.name}의 자리와 상태를 표에 기록했어요.` };
    sound.chime(); renderJudgeTable(c.key);
  } else {
    if (S3.results[c.key] !== 1) S3.results[c.key] = 0;
    S3.fb = !posOK
      ? { type: 'pos', msg: '점의 자리를 다시 보세요. 가로축은 기온, 세로축은 수증기량이에요. (초록 점선이 이 공기의 자리)' }
      : { type: 'state', msg: `이 기온에서 공기가 최대로 품을 수 있는 양은 ${f1(ws(c.T))} g/kg이에요. 곡선과 점을 비교해 보세요.` };
    sfx.wrong();
  }
  mark(); renderJudge();
}
function nextCard() {
  S3.idx = (S3.idx + 1) % CARDS.length;
  const c = CARDS[S3.idx], sv = S3.solved[c.key];
  S3.pT = sv ? sv.T : P0.T; S3.pW = sv ? sv.w : P0.w; S3.choice = sv ? sv.st : null; S3.fb = null;
  sound.whoosh(); snapMolecules(); renderJudge(); mark();
}

/* ═════════════ 화면 갱신 (HTML) ═════════════ */
const el = {
  valW: $('#valW'), valWs: $('#valWs'), barW: $('#barW'), barWs: $('#barWs'), barE: $('#barE'), barC: $('#barC'), numE: $('#numE'), numC: $('#numC'),
  bubble: $('#bubble'), legend: $('#legend'), t1: $('#t1'), t1Out: $('#t1Out'), time1: $('#time1'), satList: $('#satList'), btnEvap: $('#btnEvap'),
  t2s: $('#t2s'), t2sOut: $('#t2sOut'), w2s: $('#w2s'), w2sOut: $('#w2sOut'), t2: $('#t2'), t2Out: $('#t2Out'), btnCool: $('#btnCool'),
  lgW: $('#lgW'), lgC: $('#lgC'), lgT: $('#lgT'), graphTip: $('#graphTip'),
};
const LEG = {
  saturate: '<span><i class="dot"></i>물 분자 1개 = 수증기 0.25 g/kg</span><span>🌡 기온이 높을수록 분자가 빨라요</span><span><i class="red">↑</i>물 → 공기 (증발)</span><span><i class="blue">↓</i>공기 → 물 (응결)</span>',
  dew: '<span><i class="dot"></i>물 분자 1개 = 수증기 0.25 g/kg</span><span>판에 닿은 분자 → 물방울 (응결)</span><span>❄ 냉각 판</span>',
  judge: '<span><i class="dot"></i>물 분자 1개 = 수증기 0.25 g/kg</span><span>🌡 기온이 높을수록 분자가 빨라요</span>',
};
let lastBubble = '', lastBubbleCls = '';
function setBubble(html, cls = '') {
  if (html !== lastBubble) { el.bubble.innerHTML = html; lastBubble = html; }
  if (cls !== lastBubbleCls) { el.bubble.className = 'bubble ' + cls; lastBubbleCls = cls; }
}
let lastW = '', lastWs = '';
function setBars(w, s) {
  const a = f1(w) + ' g/kg', b = f1(s) + ' g/kg';
  if (a !== lastW) { el.valW.textContent = a; lastW = a; }
  if (b !== lastWs) { el.valWs.textContent = b; lastWs = b; }
  el.barW.style.width = (w / WMAX * 100).toFixed(2) + '%';
  el.barWs.style.width = (s / WMAX * 100).toFixed(2) + '%';
}
function renderHTML() {
  if (app.mode === 'saturate') {
    const s = ws(S1.T);
    setBars(S1.w, s);
    // 실제로 일어난 증발·응결 개수(최근 몇 초 평균). 기준: 30 °C 포화 때의 증발 빈도
    const G = geom(), ref = lamOf(G, 30) * ws(30) / Q;
    el.barE.style.width = clamp(RATE.e / ref * 100, 0, 100).toFixed(2) + '%';
    el.barC.style.width = clamp(RATE.c / ref * 100, 0, 100).toFixed(2) + '%';
    const ne = S1.running ? Math.round(RATE.e) + '개/초' : '—', nc = S1.running ? Math.round(RATE.c) + '개/초' : '—';
    if (el.numE.textContent !== ne) el.numE.textContent = ne;
    if (el.numC.textContent !== nc) el.numC.textContent = nc;
    el.t1Out.textContent = f0(S1.T) + ' °C';
    el.time1.textContent = S1.time.toFixed(1) + ' 초';
    el.satList.textContent = S1.satTemps.length ? S1.satTemps.map(t => sgn(t) + ' °C').join(', ') : '—';
    el.btnEvap.textContent = S1.running ? '⏸ 증발 멈춤' : (S1.time > 0 ? '▶ 증발 다시 시작' : '▶ 증발 시작');
    el.btnEvap.classList.toggle('on', S1.running);
    if (!S1.running && S1.time === 0) setBubble('▶ <b>증발 시작</b>을 눌러 덮개 속 물이 어떻게 되는지 지켜보세요.');
    else if (S1.saturated) setBubble('<b>포화 상태</b> — 증발도 응결도 계속 일어나요. 나가는 분자 수 ≈ 들어오는 분자 수', 'sat');
    else if (S1.w > s) setBubble('응결하는 양 > 증발하는 양 — 수증기가 물로 돌아가요', 'warn');
    else setBubble('<b>불포화 상태</b> — 공기가 수증기를 더 포함할 수 있어요' + (S1.running ? '' : ' (멈춤)'));
  } else if (app.mode === 'dew') {
    const w = vapor2(), s = ws(S2.T), c = condensed2();
    setBars(w, s);
    const wd = r1(w), cd = r1(S2.W - wd);
    el.lgW.textContent = wd.toFixed(1) + ' g'; el.lgC.textContent = cd.toFixed(1) + ' g'; el.lgT.textContent = S2.W.toFixed(1) + ' g';
    el.t2sOut.textContent = f0(S2.startT) + ' °C'; el.w2sOut.textContent = S2.W.toFixed(1) + ' g/kg';
    el.t2Out.textContent = fT(S2.T) + ' °C';
    el.btnCool.textContent = S2.cooling ? '⏸ 냉각 멈춤' : '❄ 냉각 시작';
    el.btnCool.classList.toggle('on', S2.cooling);
    const tv = String(Math.round(S2.T));
    if (document.activeElement !== el.t2 && el.t2.value !== tv) { el.t2.value = tv; paintRange(el.t2); }
    if (S2.end === 'nodew') setBubble('−10 °C까지 식혀도 이슬점에 닿지 않았어요. 수증기량을 늘려 보세요.', 'warn');
    else if (S2.hold > 0 || (S2.flash > 0 && c < 0.05)) setBubble(`<b>이슬점 ${f1(S2.Td)} °C!</b> 포화 상태가 되어 응결이 시작돼요`, 'dew');
    else if (c > 0) setBubble(`기온이 이슬점보다 낮아요 → 응결량 <b>${cd.toFixed(1)} g</b> (공기 1 kg당)`, 'dew');
    else if (S2.cooling) setBubble('냉각 중… 아직 물방울이 생기지 않아요 (불포화 상태)');
    else if (S2.T < S2.startT) setBubble('냉각을 멈췄어요. 계속 식히거나 기온을 올려 보세요.');
    else setBubble('❄ <b>냉각 시작</b>을 눌러 공기를 식혀 보세요. 물방울은 언제 생길까요?');
  } else {
    const c = CARDS[S3.idx];
    setBars(c.w, ws(c.T));
    const sv = S3.solved[c.key];
    if (sv) setBubble(`${c.name}: 판정 완료 ✔`, 'sat');
    else setBubble(`${c.name}의 공기: 수증기량 <b>${f1(c.w)} g/kg</b>, 기온 <b>${f0(c.T)} °C</b>`);
    el.graphTip.textContent = S3.drag ? `${f0(S3.pT)} °C, ${f1(S3.pW)} g/kg` : (sv ? '' : '● 점을 끌어 옮겨요 (화살표 키도 돼요)');
  }
  if (app.mode !== 'judge' && el.graphTip.textContent) el.graphTip.textContent = '';
}
function renderDewTable(fresh) {
  const tb = $('#dewTable tbody');
  const rows = S2.log.map((e, i) => `<tr${fresh && i === S2.log.length - 1 ? ' class="fresh"' : ''}><td>${sgn(e.t)} °C</td><td>${e.w.toFixed(1)} g/kg</td><td>${f1(e.d)} °C</td></tr>`);
  while (rows.length < 6) rows.push('<tr><td class="empty">—</td><td class="empty">—</td><td class="empty">—</td></tr>');
  tb.innerHTML = rows.join('');
}
function renderJudgeTable(freshKey) {
  const tb = $('#judgeTable tbody');
  tb.innerHTML = CARDS.map(c => {
    const sv = S3.solved[c.key];
    return `<tr${c.key === freshKey ? ' class="fresh"' : ''}><td>(${c.key})</td><td>${f1(c.w)}</td><td>${sgn(c.T)}</td><td${sv ? '' : ' class="empty"'}>${sv ? (sv.st === 'sat' ? '포화 상태' : '불포화 상태') : '—'}</td></tr>`;
  }).join('');
}
function renderJudge() {
  const c = CARDS[S3.idx];
  $('#jName').textContent = c.name;
  $('#jVals').textContent = `수증기량 ${f1(c.w)} g/kg · 기온 ${f0(c.T)} °C`;
  $('#jProg').textContent = `${S3.idx + 1} / ${CARDS.length}`;
  $('#jCardTitle').textContent = c.name;
  $('#btnSat').setAttribute('aria-pressed', S3.choice === 'sat');
  $('#btnUnsat').setAttribute('aria-pressed', S3.choice === 'unsat');
  const fb = $('#fb3');
  fb.textContent = S3.fb ? S3.fb.msg : '';
  fb.className = 'fb ' + (!S3.fb ? '' : S3.fb.type === 'ok' ? 'ok' : S3.fb.type === 'info' ? 'info' : 'no');
}

/* ═════════════ 장면 그리기 ═════════════ */
function drawScene(dt, now) {
  const g = sctx, G = geom(), hq = app.quality === 'high';
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 배경
  const bg = g.createLinearGradient(0, 0, 0, SH);
  bg.addColorStop(0, '#f3f8fc'); bg.addColorStop(1, '#dfeaf3');
  g.fillStyle = bg; g.fillRect(0, 0, SW, SH);
  const tb = g.createLinearGradient(0, G.base, 0, SH);
  tb.addColorStop(0, '#d9c6a8'); tb.addColorStop(1, '#c7ae88');
  g.fillStyle = tb; g.fillRect(0, G.base, SW, SH - G.base);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, G.base, SW, 2);
  if (hq) { // 그림자
    g.save(); g.filter = 'blur(6px)'; g.fillStyle = 'rgba(40,40,30,.25)';
    g.beginPath(); g.ellipse(G.cx + 8, G.base + 6, G.jw * 0.55, 8, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  // 내용물
  if (app.mode === 'saturate') drawBowl(g, G, hq);
  if (app.mode === 'dew') drawPlate(g, G);
  // 분자
  const spr = molSprite(G.r, hq), sz = (G.r + 1) * 2;
  for (const m of mols) g.drawImage(spr, m.x - G.r - 1, m.y - G.r - 1, sz, sz);
  for (const m of mols) {
    if (m.ph === 'down') arrowAlong(g, m, G.r, '#2a78d6');
    else if (m.tag > 0) arrowAlong(g, m, G.r, '#d8452f');
  }
  for (const r of ripples) {
    g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - r.t / 0.6)})`; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(r.x, r.y, 4 + r.t * 26, 1.5 + r.t * 6, 0, 0, Math.PI * 2); g.stroke();
  }
  // 물방울
  if (app.mode === 'saturate') {
    updateDrops1(G, dt);
    for (const d of drops) drawDrop(g, d.side < 0 ? G.ix0 + d.r : G.ix1 - d.r, d.y, d.r * Math.min(1, d.t * 3));
  } else if (app.mode === 'dew') drawDewDrops(g, G);
  // 유리 덮개
  drawJar(g, G, hq);
  drawThermo(g, G);
}
let sprC = null, sprKey = '';
function molSprite(r, hq) { // 분자 그림을 한 번만 그려 두고 찍어 냄(분자가 많아도 가볍게)
  const key = r.toFixed(2) + '|' + dpr + '|' + hq;
  if (key === sprKey) return sprC;
  const n = Math.ceil((r + 1) * 2 * dpr);
  sprC = document.createElement('canvas'); sprC.width = sprC.height = n;
  const c = sprC.getContext('2d'); c.scale(n / ((r + 1) * 2), n / ((r + 1) * 2));
  drawMol(c, r + 1, r + 1, r, hq); sprKey = key; return sprC;
}
function arrowAlong(g, m, r, col) { // 분자가 움직이는 방향 화살표
  const d0 = r + 2, d1 = r + 2 + r * 2.6;
  arrow(g, m.x + m.vx * d0, m.y + m.vy * d0, m.x + m.vx * d1, m.y + m.vy * d1, col);
}
function drawMol(g, x, y, r, hq) {
  if (hq) {
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    gr.addColorStop(0, '#d4ebff'); gr.addColorStop(0.45, '#4f97e6'); gr.addColorStop(1, '#1b5fb8');
    g.fillStyle = gr;
  } else g.fillStyle = '#2f7fd8';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function arrow(g, x1, y1, x2, y2, col) {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 6;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2 - Math.cos(a) * h * 0.6, y2 - Math.sin(a) * h * 0.6); g.stroke();
  g.beginPath(); g.moveTo(x2, y2);
  g.lineTo(x2 - Math.cos(a - 0.5) * h * 1.4, y2 - Math.sin(a - 0.5) * h * 1.4);
  g.lineTo(x2 - Math.cos(a + 0.5) * h * 1.4, y2 - Math.sin(a + 0.5) * h * 1.4); g.closePath(); g.fill();
}
function drawDrop(g, x, y, r) {
  if (r <= 0.3) return;
  g.fillStyle = 'rgba(110,175,230,.75)'; g.strokeStyle = 'rgba(40,110,170,.7)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, y - r * 1.5);
  g.bezierCurveTo(x + r * 1.1, y - r * 0.3, x + r, y + r, x, y + r);
  g.bezierCurveTo(x - r, y + r, x - r * 1.1, y - r * 0.3, x, y - r * 1.5); g.fill(); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.1, r * 0.28, 0, Math.PI * 2); g.fill();
}
function drawBowl(g, G, hq) {
  const b = G.bowl, w = b.x1 - b.x0, inset = w * 0.07;
  const path = () => { g.beginPath(); g.moveTo(b.x0, b.top); g.lineTo(b.x0 + inset, b.bot); g.lineTo(b.x1 - inset, b.bot); g.lineTo(b.x1, b.top); };
  // 물
  const k = (b.surf - b.top) / (b.bot - b.top);
  const wx0 = b.x0 + inset * k, wx1 = b.x1 - inset * k;
  const wg = g.createLinearGradient(0, b.surf, 0, b.bot);
  wg.addColorStop(0, '#7cc0ee'); wg.addColorStop(1, '#2b7fc9');
  g.fillStyle = wg; g.beginPath(); g.moveTo(wx0, b.surf); g.lineTo(b.x0 + inset, b.bot); g.lineTo(b.x1 - inset, b.bot); g.lineTo(wx1, b.surf); g.closePath(); g.fill();
  g.fillStyle = 'rgba(220,240,255,.75)'; g.beginPath(); g.ellipse((wx0 + wx1) / 2, b.surf, (wx1 - wx0) / 2, 3.5, 0, 0, Math.PI * 2); g.fill();
  // 그릇
  const surf0 = b.top + (b.bot - b.top) * 0.2;
  if (b.surf - surf0 > 1.5) { // 처음 물 높이
    g.setLineDash([4, 3]); g.strokeStyle = 'rgba(30,80,140,.6)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(b.x0 + inset * 0.2 + 2, surf0); g.lineTo(b.x1 - inset * 0.2 - 2, surf0); g.stroke(); g.setLineDash([]);
    g.font = `700 12px ${FONT}`; g.fillStyle = '#1e4f80'; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText('처음 물 높이', b.x1 + 4 > G.ix1 - 70 ? b.x0 + 4 : b.x1 + 4, surf0 - 2);
  }
  path(); g.strokeStyle = 'rgba(80,120,150,.9)'; g.lineWidth = 2.2; g.stroke();
  if (hq) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(b.x0 + 6, b.top + 6); g.lineTo(b.x0 + inset + 4, b.bot - 6); g.stroke(); }
}
function drawPlate(g, G) {
  const p = G.plate, x0 = G.x0 - 4, x1 = G.x1 + 4;
  const cold = clamp((S2.startT - S2.T) / 30, 0, 1);
  const pg = g.createLinearGradient(0, p.top, 0, p.top + p.h);
  pg.addColorStop(0, `rgb(${Math.round(150 - cold * 60)},${Math.round(195 - cold * 30)},${Math.round(235)})`); pg.addColorStop(1, '#2d6fb5');
  g.fillStyle = pg; g.fillRect(x0, p.top, x1 - x0, p.h);
  g.strokeStyle = '#1f5592'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, p.top + 0.5, x1 - x0 - 1, p.h - 1);
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(p.h * 0.95)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('❄', G.cx, p.top + p.h / 2 + 1);
  if (S2.cooling && app.quality === 'high') { // 냉기
    g.strokeStyle = 'rgba(170,215,255,.5)'; g.lineWidth = 2;
    const t = performance.now() / 600;
    for (let i = 0; i < 5; i++) {
      const x = G.ix0 + (i + 0.5) * (G.ix1 - G.ix0) / 5, ph = (t + i * 0.37) % 1;
      g.globalAlpha = 1 - ph; g.beginPath(); g.moveTo(x, p.top - 4 - ph * 26); g.quadraticCurveTo(x + 6, p.top - 12 - ph * 26, x, p.top - 20 - ph * 26); g.stroke();
    }
    g.globalAlpha = 1;
  }
}
const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
function drawDewDrops(g, G) {
  const c = condensed2(); if (c <= 0) return;
  const n = Math.min(80, Math.ceil(c * 3));
  const grow = 0.75 + 0.25 * Math.min(1, c / 12);
  for (let i = 0; i < n; i++) {
    const h1 = hash(i), h2 = hash(i + 101), r = (2.2 + h2 * 2.8) * grow * (G.jh / 330 + 0.3) / 1.3;
    let x, y;
    if (h1 < 0.34) { x = G.ix0 + 14 + hash(i + 7) * (G.ix1 - G.ix0 - 28); y = G.plate.top - r * 0.6; }
    else if (h1 < 0.84) { const left = h1 < 0.59; y = G.yS + hash(i + 13) * (G.plate.top - G.yS - 8); x = left ? G.ix0 + r : G.ix1 - r; }
    else { const a = Math.PI * (1.12 + hash(i + 29) * 0.76); x = G.cx + Math.cos(a) * (G.irx - r); y = G.yS + Math.sin(a) * (G.iry - r); }
    drawDrop(g, x, y, r);
  }
}
function drawJar(g, G, hq) {
  g.beginPath(); g.moveTo(G.x0, G.base); g.lineTo(G.x0, G.yS); g.ellipse(G.cx, G.yS, G.jw / 2, G.ry, 0, Math.PI, Math.PI * 2); g.lineTo(G.x1, G.base);
  g.fillStyle = 'rgba(205,232,250,.18)'; g.fill();
  g.strokeStyle = 'rgba(85,135,170,.9)'; g.lineWidth = 2.5; g.stroke();
  if (hq) {
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(G.x0 + 12, G.base - 24); g.lineTo(G.x0 + 12, G.yS); g.ellipse(G.cx, G.yS, G.jw / 2 - 12, G.ry - 12, 0, Math.PI, Math.PI * 1.28); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(G.x1 - 10, G.base - 30); g.lineTo(G.x1 - 10, G.yS + 10); g.stroke();
  }
  // 손잡이
  g.fillStyle = 'rgba(150,190,215,.8)'; g.strokeStyle = 'rgba(85,135,170,.9)'; g.lineWidth = 2;
  g.beginPath(); g.arc(G.cx, G.top - 7, 8, 0, Math.PI * 2); g.fill(); g.stroke();
  // 받침
  g.fillStyle = '#7c8d99'; roundRect(g, G.x0 - 10, G.base - 3, G.jw + 20, 8, 3); g.fill();
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawThermo(g, G) {
  const T = app.mode === 'saturate' ? S1.T : app.mode === 'dew' ? S2.T : CARDS[S3.idx].T;
  const x = Math.max(34, G.x0 * 0.42), yt = G.top + 30, yb = G.base - 28, w = 10, br = 10;
  const yOf = t => yb - 8 - (t + 15) / 55 * (yb - 8 - yt);
  // 표시판
  g.fillStyle = '#fff'; g.strokeStyle = '#9fb1c1'; g.lineWidth = 1.5;
  const lbl = `기온 ${fT(T)} °C`; g.font = '800 15px "Pretendard","Noto Sans KR",sans-serif';
  const tw = g.measureText(lbl).width + 16, lx = clamp(x - tw / 2, 6, SW - tw - 6), ly = yt - 34;
  roundRect(g, lx, ly, tw, 26, 8); g.fill(); g.stroke();
  g.fillStyle = '#c0392b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(lbl, lx + tw / 2, ly + 13.5);
  // 관
  g.fillStyle = '#fff'; g.strokeStyle = '#8a9cad'; g.lineWidth = 1.5;
  roundRect(g, x - w / 2, yt, w, yb - yt, w / 2); g.fill(); g.stroke();
  g.beginPath(); g.arc(x, yb, br, 0, Math.PI * 2); g.fillStyle = '#e04a32'; g.fill(); g.stroke();
  g.fillStyle = '#e04a32'; const yl = yOf(T); g.fillRect(x - 2.5, yl, 5, yb - yl);
  // 눈금
  g.font = '600 12px "Pretendard","Noto Sans KR",sans-serif'; g.textAlign = 'left'; g.fillStyle = '#4a5a6a'; g.strokeStyle = '#8a9cad'; g.lineWidth = 1;
  for (let t = -10; t <= 30; t += 10) { const y = yOf(t); g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2 + 5, y); g.stroke(); g.fillText(sgn(t), x + w / 2 + 7, y); }
}

/* ═════════════ 그래프 ═════════════ */
const GP = { L: 62, R: 18, T: 16, B: 46 };
const gx = t => GP.L + (t - TMIN) / (TMAX - TMIN) * (GW - GP.L - GP.R);
const gy = w => GH - GP.B - w / WMAX * (GH - GP.T - GP.B);
const ix = x => TMIN + (x - GP.L) / (GW - GP.L - GP.R) * (TMAX - TMIN);
const iy = y => (GH - GP.B - y) / (GH - GP.T - GP.B) * WMAX;
const FONT = '"Pretendard","Noto Sans KR","Malgun Gothic",sans-serif';
function curvePath(g) { g.beginPath(); for (let i = 0; i <= 450; i++) { const t = TMIN + i / 450 * (TMAX - TMIN); i ? g.lineTo(gx(t), gy(ws(t))) : g.moveTo(gx(t), gy(ws(t))); } }
function buildGraphStatic() {
  gStatic = document.createElement('canvas'); gStatic.width = graphCv.width; gStatic.height = graphCv.height;
  const g = gStatic.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = GP.L, R = GW - GP.R, T = GP.T, B = GH - GP.B;
  g.fillStyle = '#fff'; g.fillRect(0, 0, GW, GH);
  // 위: 공기가 품을 수 없는 영역 (빗금)
  g.save(); g.beginPath(); g.rect(L, T, R - L, B - T); g.clip();
  g.fillStyle = '#f3f4f6'; g.fillRect(L, T, R - L, B - T);
  g.strokeStyle = 'rgba(140,150,165,.28)'; g.lineWidth = 1;
  for (let x = L - (B - T); x < R; x += 9) { g.beginPath(); g.moveTo(x, B); g.lineTo(x + (B - T), T); g.stroke(); }
  // 아래: 불포화
  curvePath(g); g.lineTo(gx(TMAX), B); g.lineTo(gx(TMIN), B); g.closePath();
  g.fillStyle = '#e8f3fd'; g.fill();
  g.restore();
  // 격자
  g.lineWidth = 1;
  for (let t = TMIN; t <= TMAX; t++) { const x = Math.round(gx(t)) + 0.5; g.strokeStyle = t % 5 === 0 ? 'rgba(80,110,140,.22)' : 'rgba(80,110,140,.08)'; g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke(); }
  for (let w = 0; w <= WMAX; w += 1) { const y = Math.round(gy(w)) + 0.5; g.strokeStyle = w % 5 === 0 ? 'rgba(80,110,140,.2)' : 'rgba(80,110,140,.06)'; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); }
  // 교과서 점선 (10–7.0, 20–14.0, 30–26.5)
  g.setLineDash([5, 4]); g.strokeStyle = 'rgba(200,60,40,.55)'; g.lineWidth = 1.3;
  for (const [t, w] of [[10, 7], [20, 14], [30, 26.5]]) { g.beginPath(); g.moveTo(L, gy(w)); g.lineTo(gx(t), gy(w)); g.lineTo(gx(t), B); g.stroke(); }
  g.setLineDash([]);
  // 축
  g.strokeStyle = '#33414f'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(L, T - 4); g.lineTo(L, B); g.lineTo(R + 4, B); g.stroke();
  g.fillStyle = '#33414f'; g.font = `600 12.5px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let t = TMIN; t <= TMAX; t += 5) { g.fillText(sgn(t), gx(t), B + 5); g.beginPath(); g.moveTo(gx(t), B); g.lineTo(gx(t), B + 4); g.stroke(); }
  g.font = `700 13px ${FONT}`; g.fillText('기온(°C)', (L + R) / 2, B + 24);
  // 세로 눈금 (교과서 값 우선, 겹치면 생략)
  const ticks = [[7, '7.0', 1], [14, '14.0', 1], [26.5, '26.5', 1], [0, '0', 2], [10, '10.0', 2], [20, '20.0', 2], [30, '30.0', 2], [5, '5.0', 3], [35, '35.0', 3]];
  const used = [];
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const [w, s, pr] of ticks) {
    const y = gy(w);
    if (used.some(u => Math.abs(u - y) < 15)) continue;
    used.push(y);
    g.font = pr === 1 ? `800 12.5px ${FONT}` : `600 12.5px ${FONT}`; g.fillStyle = pr === 1 ? '#b3361f' : '#33414f';
    g.fillText(s, L - 6, y); g.beginPath(); g.moveTo(L - 4, y); g.lineTo(L, y); g.stroke();
  }
  g.save(); g.translate(14, (T + B) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.font = `700 13px ${FONT}`; g.fillStyle = '#33414f'; g.fillText('수증기량(g/kg)', 0, 0); g.restore();
  // 곡선
  g.save(); g.beginPath(); g.rect(L, T - 2, R - L, B - T + 2); g.clip();
  curvePath(g); g.strokeStyle = '#d8452f'; g.lineWidth = 3.2; g.lineJoin = 'round'; g.stroke(); g.restore();
  // 영역·곡선 이름
  g.font = `700 13px ${FONT}`; g.textBaseline = 'middle';
  tag(g, '불포화 영역', gx(23), gy(2.4), '#1b5fb8', 'rgba(232,243,253,.95)', 'center');
  tag(g, '공기가 품을 수 없는 영역', gx(2), gy(31), '#5a6677', 'rgba(243,244,246,.95)', 'center');
  const ct = 27.5, cy = gy(ws(ct));
  tag(g, '포화 수증기량 곡선', gx(ct) - 14, cy, '#c0392b', 'rgba(255,255,255,.95)', 'right');
}
function tag(g, s, x, y, col, bg, align) {
  const w = g.measureText(s).width + 12;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  g.fillStyle = bg; roundRect(g, x0, y - 11, w, 22, 6); g.fill();
  g.fillStyle = col; g.textAlign = 'center'; g.fillText(s, x0 + w / 2, y + 0.5);
}
function dot(g, x, y, r, fill, ring = '#fff') { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 2.5; g.strokeStyle = ring; g.stroke(); }
function label(g, s, x, y, col, align = 'left') {
  g.font = `800 13px ${FONT}`; const w = g.measureText(s).width + 12;
  let x0 = align === 'left' ? x : x - w; x0 = clamp(x0, GP.L + 2, GW - GP.R - w - 2);
  const y0 = clamp(y, GP.T + 12, GH - GP.B - 12);
  g.fillStyle = 'rgba(255,255,255,.93)'; roundRect(g, x0, y0 - 11, w, 22, 6); g.fill();
  g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x0 + w / 2, y0 + 0.5);
}
function drawGraph() {
  const g = gctx; g.setTransform(1, 0, 0, 1, 0, 0);
  if (gStatic) g.drawImage(gStatic, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const B = GH - GP.B;
  if (app.mode === 'saturate') {
    if (S1.trail.length > 1) { g.strokeStyle = 'rgba(42,120,214,.45)'; g.lineWidth = 2; g.setLineDash([3, 3]); g.beginPath(); S1.trail.forEach((p, i) => i ? g.lineTo(gx(p.T), gy(p.w)) : g.moveTo(gx(p.T), gy(p.w))); g.stroke(); g.setLineDash([]); }
    const x = gx(S1.T), y = gy(S1.w), ys = gy(ws(S1.T));
    g.setLineDash([4, 3]); g.strokeStyle = 'rgba(42,120,214,.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, B); g.lineTo(x, Math.max(y, ys)); g.stroke(); g.setLineDash([]);
    if (S1.saturated) { const pr = 10 + 4 * Math.sin(performance.now() / 250); g.strokeStyle = 'rgba(240,170,0,.7)'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, pr, 0, Math.PI * 2); g.stroke(); }
    dot(g, x, y, 7, '#2a78d6');
    const right = S1.T < 22;
    label(g, `지금 공기 (${f0(S1.T)} °C, ${f1(S1.w)} g/kg)`, right ? x + 12 : x - 12, y - 22, '#1b5fb8', right ? 'left' : 'right');
  } else if (app.mode === 'dew') {
    const xs = gx(S2.startT), yW = gy(S2.W), x = gx(S2.T), c = condensed2();
    // 지금 기온 자리 막대 (높이 = 처음 수증기량)
    const bw = 14, ys = gy(Math.min(S2.W, ws(S2.T)));
    g.fillStyle = 'rgba(42,120,214,.55)'; g.fillRect(x - bw / 2, ys, bw, B - ys);
    if (c > 0) {
      g.save(); g.beginPath(); g.rect(x - bw / 2, yW, bw, ys - yW); g.clip();
      g.fillStyle = 'rgba(11,140,134,.18)'; g.fillRect(x - bw / 2, yW, bw, ys - yW);
      g.strokeStyle = '#0b8c86'; g.lineWidth = 1.5; for (let k = yW - bw; k < ys; k += 5) { g.beginPath(); g.moveTo(x - bw / 2, k + bw); g.lineTo(x + bw / 2, k); g.stroke(); }
      g.restore();
      g.setLineDash([4, 3]); g.strokeStyle = '#0b8c86'; g.lineWidth = 1.5; g.strokeRect(x - bw / 2, yW, bw, ys - yW); g.setLineDash([]);
    }
    // 냉각 화살표
    if (S2.startT - S2.T > 0.4) { arrow(g, xs - 9, yW, x + 8, yW, '#1f6fd0'); g.font = `800 13px ${FONT}`; g.fillStyle = '#1f6fd0'; g.textAlign = 'center'; g.textBaseline = 'bottom'; if (xs - x > 50) g.fillText('냉각', (xs + x) / 2, yW - 6); }
    // 처음 점
    g.beginPath(); g.arc(xs, yW, 7, 0, Math.PI * 2); g.strokeStyle = '#7a8796'; g.lineWidth = 3; g.stroke();
    label(g, `처음 (${f0(S2.startT)} °C, ${f1(S2.W)} g/kg)`, xs + 12, yW - 22, '#5a6677', 'left');
    // 이슬점
    if (S2.dewReached) {
      const xd = gx(S2.Td);
      g.setLineDash([4, 3]); g.strokeStyle = '#d8452f'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(xd, yW); g.lineTo(xd, B); g.stroke(); g.setLineDash([]);
      const pulse = S2.flash > 0 ? 3 * Math.sin(performance.now() / 90) : 0;
      g.beginPath(); g.arc(xd, yW, 11 + pulse, 0, Math.PI * 2); g.strokeStyle = '#f0a000'; g.lineWidth = 3; g.stroke();
      label(g, `이슬점 ${f1(S2.Td)} °C`, xd + 6, B - 16, '#c0392b', 'left');
    }
    // 지금 점
    dot(g, x, gy(vapor2()), 7, '#2a78d6');
    if (c > 0.05) label(g, `응결량 ${f1(S2.W - r1(vapor2()))} g/kg`, x - 12, (yW + ys) / 2, '#0b8c86', 'right');
  } else {
    const c = CARDS[S3.idx];
    // 맞힌 공기
    for (const k of CARDS) { const sv = S3.solved[k.key]; if (!sv || k === c) continue; dot(g, gx(sv.T), gy(sv.w), 5.5, '#19935a'); g.font = `800 12.5px ${FONT}`; g.fillStyle = '#19935a'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(`(${k.key})`, gx(sv.T) + 8, gy(sv.w) - 9); }
    if (S3.fb && S3.fb.type === 'pos') {
      g.setLineDash([6, 4]); g.strokeStyle = '#19935a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(gx(c.T), B); g.lineTo(gx(c.T), GP.T); g.moveTo(GP.L, gy(c.w)); g.lineTo(GW - GP.R, gy(c.w)); g.stroke(); g.setLineDash([]);
    }
    if (S3.fb && S3.fb.type === 'state') {
      const s = ws(c.T);
      g.setLineDash([6, 4]); g.strokeStyle = '#d8452f'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(GP.L, gy(s)); g.lineTo(gx(c.T), gy(s)); g.lineTo(gx(c.T), B); g.stroke(); g.setLineDash([]);
      label(g, `최대로 품을 수 있는 양 ${f1(s)} g/kg`, GP.L + 6, gy(s) - 18, '#c0392b', 'left');
    }
    const x = gx(S3.pT), y = gy(S3.pW), solved = S3.solved[c.key];
    if (S3.drag) { g.strokeStyle = 'rgba(240,138,0,.5)'; g.setLineDash([3, 3]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, B); g.lineTo(x, y); g.lineTo(GP.L, y); g.stroke(); g.setLineDash([]); }
    if (!solved) { g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fillStyle = 'rgba(240,138,0,.16)'; g.fill(); }
    dot(g, x, y, solved ? 7 : 9, solved ? '#19935a' : '#f08a00');
    const right = S3.pT < 24;
    label(g, `${solved ? '(' + c.key + ') ' : ''}${f0(S3.pT)} °C, ${f1(S3.pW)} g/kg`, right ? x + 16 : x - 16, y - 18, solved ? '#19935a' : '#b35f00', right ? 'left' : 'right');
  }
}

/* ═════════════ 그래프 점 끌기 (③) ═════════════ */
function pointerToPoint(e) { const r = graphCv.getBoundingClientRect(); return { T: ix(e.clientX - r.left), w: iy(e.clientY - r.top) }; }
graphCv.addEventListener('pointerdown', e => {
  if (app.locked || app.mode !== 'judge' || S3.solved[CARDS[S3.idx].key]) return;
  e.preventDefault(); graphCv.setPointerCapture(e.pointerId); S3.drag = true;
  const p = pointerToPoint(e); setPoint(p.T, p.w);
});
graphCv.addEventListener('pointermove', e => { if (!S3.drag || app.locked) return; const p = pointerToPoint(e); setPoint(p.T, p.w); });
const endDrag = () => { if (!S3.drag) return; S3.drag = false; sound.soft(); renderJudge(); mark(); };
graphCv.addEventListener('pointerup', endDrag);
graphCv.addEventListener('pointercancel', endDrag);
graphCv.addEventListener('keydown', e => {
  if (app.locked || app.mode !== 'judge' || S3.solved[CARDS[S3.idx].key]) return;
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 0.5], ArrowDown: [0, -0.5] }[e.key];
  if (!d) return; e.preventDefault();
  if (setPoint(S3.pT + d[0], S3.pW + d[1])) renderJudge();
});

/* ═════════════ 조작 연결 ═════════════ */
const guard = fn => (...a) => { if (!app.locked) fn(...a); };
function setPaused(p) {
  app.paused = p;
  $('#btnPlay').firstChild.textContent = p ? '▶' : '⏸';
  $('#playLbl').textContent = p ? '재생' : '일시정지';
  if (hiss) hiss.pause(p);
  mark();
}
$('#btnPlay').addEventListener('click', guard(() => { setPaused(!app.paused); sound.click(); }));
$('#btnQuality').addEventListener('click', guard(() => {
  app.quality = app.quality === 'high' ? 'low' : 'high';
  $('#qualityLbl').textContent = app.quality === 'high' ? '품질 높음' : '품질 낮음';
  $('#btnQuality').setAttribute('aria-pressed', app.quality === 'low');
  resize(); sound.click();
}));
const btnMute = $('#btnMute');
const showMute = () => { btnMute.textContent = sound.muted ? '🔇' : '🔊'; btnMute.setAttribute('aria-pressed', sound.muted); };
btnMute.addEventListener('click', () => { sound.toggleMute(); showMute(); if (!sound.muted) sound.click(); });
showMute();
$('#btnReset').addEventListener('click', guard(() => {
  if (app.mode === 'saturate') {
    Object.assign(S1, { T: 20, w: 3, time: 0, running: false, saturated: false, trail: [] });
    el.t1.value = 20; paintRange(el.t1);
  } else if (app.mode === 'dew') {
    setStart2(30, 14, true); syncDewSliders();
  } else {
    const c = CARDS[S3.idx], sv = S3.solved[c.key];
    S3.pT = sv ? sv.T : P0.T; S3.pW = sv ? sv.w : P0.w; S3.choice = sv ? sv.st : null; S3.fb = null; renderJudge();
  }
  snapMolecules(); sound.reset(); mark();
}));
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', guard(() => setMode(t.dataset.mode))));
function setMode(m) {
  if (m === app.mode) return;
  if (app.mode === 'saturate' && S1.running) S1.running = false;
  if (app.mode === 'dew') stopCool();
  S3.drag = false;
  app.mode = m;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.mode === m));
  document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== m; });
  el.legend.innerHTML = LEG[m];
  if (m === 'judge') renderJudge();
  snapMolecules(); sound.ding(); mark();
}
// ①
el.t1.addEventListener('input', guard(() => { setT1(+el.t1.value); paintRange(el.t1); }));
el.btnEvap.addEventListener('click', guard(() => toggleEvap()));
// ②
function syncDewSliders() {
  el.t2s.value = S2.startT; el.w2s.max = wMax2(S2.startT); el.w2s.value = S2.W;
  el.t2.max = S2.startT; el.t2.value = Math.round(S2.T);
  [el.t2s, el.w2s, el.t2].forEach(paintRange);
}
el.t2s.addEventListener('input', guard(() => { setStart2(+el.t2s.value, S2.W); syncDewSliders(); sound.tick(+el.t2s.value / 35); }));
el.w2s.addEventListener('input', guard(() => { setStart2(S2.startT, +el.w2s.value); syncDewSliders(); sound.tick(+el.w2s.value / 35); }));
$('#btnExample').addEventListener('click', guard(() => { setStart2(30, 14); syncDewSliders(); sound.record(); }));
el.btnCool.addEventListener('click', guard(() => { S2.cooling ? (stopCool(), sound.off()) : startCool(); }));
$('#btnDown').addEventListener('click', guard(() => { if (S2.cooling) stopCool(); setT2(Math.ceil(S2.T - 1e-9) - 1, true); }));
$('#btnUp').addEventListener('click', guard(() => { if (S2.cooling) stopCool(); setT2(Math.floor(S2.T + 1e-9) + 1, true); }));
el.t2.addEventListener('input', guard(() => { if (S2.cooling) stopCool(); setT2(+el.t2.value, true); paintRange(el.t2); }));
// ③
$('#btnSat').addEventListener('click', guard(() => chooseState('sat')));
$('#btnUnsat').addEventListener('click', guard(() => chooseState('unsat')));
$('#btnCheck').addEventListener('click', guard(checkCard));
$('#btnNext').addEventListener('click', guard(nextCard));
// 키보드: 스페이스바 = 일시정지/재생
window.addEventListener('keydown', e => {
  if (e.code !== 'Space' || app.locked) return;
  const t = e.target; if (t && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(t.tagName)) return;
  e.preventDefault(); setPaused(!app.paused); sound.click();
});

/* ═════════════ 잠금 (웹앱 제출 후) ═════════════ */
function applyLock(on) {
  if (on === app.locked) return;
  app.locked = on;
  if (on) { app.wasPaused = app.paused; setPaused(true); S3.drag = false; }
  else setPaused(app.wasPaused);
  flush();
}
SimBridge.onLock = () => applyLock(true);
new MutationObserver(() => applyLock(document.documentElement.classList.contains('sim-locked')))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

/* ═════════════ 주 루프 ═════════════ */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (SW < 20) resize();
  const G = geom();
  const run = !app.paused && !app.locked;
  if (run) {
    if (app.mode === 'saturate') update1(dt, G);
    else if (app.mode === 'dew') { update2(dt); exchange(G, dt, vapor2() / Q, dewSat2(), lamOf(G, S2.T)); }
    const Tn = app.mode === 'saturate' ? S1.T : app.mode === 'dew' ? S2.T : CARDS[S3.idx].T;
    const sinkOn = app.mode === 'saturate' ? S1.running : app.mode === 'dew' ? dewSat2() : false;
    updateMolecules(G, dt, Tn, sinkOn);
  }
  drawScene(run ? dt : 0, now);
  drawGraph();
  renderHTML();
  requestAnimationFrame(frame);
}

/* ═════════════ 시작 ═════════════ */
el.legend.innerHTML = LEG.saturate;
setStart2(30, 14, true); syncDewSliders();
[el.t1].forEach(paintRange);
renderDewTable(); renderJudgeTable(); renderJudge();
resize(); snapMolecules(); flush();
requestAnimationFrame(frame);

// 콘솔 검산용 (정답 아님: 모형 함수와 현재 상태만)
window.__sim = { ws, dewPoint, S1, S2, S3, app, bridgeState, mols, RATE, Q };
