// 22-2-1-1-01 용해도 실험실 — 녹는 양 비교하기(물중탕) + 기체의 용해도
import { sound } from '../../lib/sound.js';
import { clamp, lerp, ease, fmt, FpsMonitor } from '../../lib/utils.js';

const $ = id => document.getElementById(id);
const UNIT = '22-2-1-1-01';

// ───────── 물리 데이터 (설계서 표, 10 ℃ 간격 직선 보간) ─────────
const SOL = {
  KNO3:  { name: '질산 칼륨',     color: '#d63b2f', s: [13.3, 20.9, 31.6, 45.8, 63.9, 85.5, 110, 138, 169, 202, 246] },
  NaNO3: { name: '질산 나트륨',   color: '#2f6fd6', s: [73.0, 80.0, 87.3, 95.3, 104.1, 113.7, 123.7, 135.3, 148.1, 161.8, 177.0] },
  CuSO4: { name: '황산 구리(Ⅱ)', color: '#1f9a55', s: [14.2, 16.8, 20.0, 23.9, 28.5, 34.1, 40.3, 47.7, 55.3, 63.9, 73.6] },
  NaCl:  { name: '염화 나트륨',   color: '#e08a12', s: [35.7, 35.7, 35.9, 36.1, 36.4, 36.7, 37.0, 37.5, 37.9, 38.5, 39.0] },
};
const CURVE_ORDER = ['KNO3', 'NaNO3', 'CuSO4', 'NaCl'];
function solub(key, T) {           // g / 물 100 g
  const s = SOL[key].s; T = clamp(T, 0, 100);
  const i = Math.min(9, Math.floor(T / 10)), f = (T - i * 10) / 10;
  return s[i] + (s[i + 1] - s[i]) * f;
}
function solubInv(key, v) {        // S(T) = v 인 온도 (없으면 null)
  const s = SOL[key].s;
  for (let i = 0; i < 10; i++) { const a = s[i], b = s[i + 1]; if ((v - a) * (v - b) <= 0 && a !== b) return i * 10 + 10 * (v - a) / (b - a); }
  return null;
}
const CO2 = [0.335, 0.232, 0.169, 0.126, 0.097, 0.076, 0.058];   // 0~60 ℃, 1기압, g/물 100 g
function co2(T) { T = clamp(T, 0, 60); const i = Math.min(5, Math.floor(T / 10)), f = (T - i * 10) / 10; return CO2[i] + (CO2[i + 1] - CO2[i]) * f; }
const O2 = [[10, 11.3], [15, 10.1], [20, 9.1], [25, 8.3], [30, 7.6]];    // 막대용 (숫자 표시 안 함)
function o2(T) { for (let i = 0; i < O2.length - 1; i++) if (T <= O2[i + 1][0]) { const [a, va] = O2[i], [b, vb] = O2[i + 1]; return va + (vb - va) * (T - a) / (b - a); } return O2[O2.length - 1][1]; }

const ROOM = 20;
const DISSOLVE = 0.6, DISSOLVE_STIR = 1.8;   // g/분
const r1 = v => Math.round(v * 10) / 10;
const gtxt = v => (Number.isInteger(v) ? String(v) : fmt(v, 1));

// ───────── 상태 ─────────
let tab = 'solid';
let playing = true;
let quality = (navigator.hardwareConcurrency || 4) <= 2 ? 'low' : 'high';
let speed = 30;
const solid = {
  mode: 'textbook', solute: 'KNO3', freeSolute: 'KNO3',
  T: ROOM, heater: false, place: 'hotplate', stir: false, time: 0,
  heatedOnce: false, lowTimer: 0, iceHint: false, boilAcc: 0,
  tubes: [], runRecorded: [false, false, false],
};
const freeCfg = [{ mass: 4, water: 10 }, { mass: 6, water: 10 }, { mass: 8, water: 10 }];
const recs = { KNO3_3: null, KNO3_5: null, KNO3_7: null, CuSO4_3: null, CuSO4_5: null, CuSO4_7: null };
let freeRecords = [];
let graphScale = 'water10';
const curvesOn = { KNO3: true, NaNO3: true, CuSO4: true, NaCl: true };
let curvesViewed = false;
let readX = null;

function seeds(n) { return Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random(), r: Math.random(), a: Math.random() * Math.PI })); }
function makeTube(mass, water) {
  return { mass, water, d: 0, eligible: false, crystal: false, recordable: false, reheat: false, flash: 0, seed: seeds(48) };
}
function soluteNow() { return solid.mode === 'textbook' ? solid.solute : solid.freeSolute; }
function newRun() {
  Object.assign(solid, { T: ROOM, heater: false, time: 0, heatedOnce: false, lowTimer: 0, iceHint: false, runRecorded: [false, false, false] });
  movePlace('hotplate', true);
  solid.tubes = solid.mode === 'textbook' ? [3, 5, 7].map(m => makeTube(m, 10)) : freeCfg.map(c => makeTube(c.mass, c.water));
  readyFlash = -1;
}

// ───────── 물중탕 한 단계 ─────────
let readyFlash = -1, prevT = ROOM;
function bathRate(T) {
  if (solid.place === 'ice') return (0 - T) / 3;
  if (solid.heater) return T >= 100 ? 0 : (105 - T) / 6;
  return (ROOM - T) / 10;
}
function stepSolid(dtMin) {
  const n = clamp(Math.ceil(Math.abs(bathRate(solid.T)) * dtMin / 0.02), 1, 800);
  const h = dtMin / n;
  for (let k = 0; k < n; k++) {
    prevT = solid.T;
    solid.T = Math.min(100, solid.T + bathRate(solid.T) * h);
    if (solid.heater && solid.T > 99.99) solid.T = 100;
    solid.time += h * 60;
    const stopped = stepTubes(h);
    if (stopped) return;
  }
  // 실온에서 더 안 내려갈 때 얼음물 안내
  if (solid.place === 'hotplate' && !solid.heater && solid.T < ROOM + 0.5 && solid.tubes.some(t => t.eligible && !t.crystal)) {
    solid.lowTimer += dtMin * 60;
    if (solid.lowTimer > 30 && !solid.iceHint) { solid.iceHint = true; showMsg('실온보다 낮은 온도가 필요해요. [얼음물로 옮기기]를 눌러 보세요.', false, 5000); }
  } else solid.lowTimer = 0;
}
function stepTubes(h) {
  const rate = solid.stir ? DISSOLVE_STIR : DISSOLVE;
  let stop = false;
  solid.tubes.forEach((t, i) => {
    const C = solub(soluteNow(), solid.T) * t.water / 100;
    if (t.d > C + 1e-9) {
      t.d = C;
      if (!t.crystal) {
        t.crystal = true;
        if (t.eligible) {
          // 고체가 생기기 시작한 정확한 온도로 맞춤 (한 단계 안에서의 오차 없앰)
          const ts = solubInv(soluteNow(), t.mass * 100 / t.water);
          if (ts != null && ts <= prevT && ts >= solid.T) solid.T = ts;
          t.eligible = false; t.recordable = true; t.flash = 1.6;
          onCrystal(i);
          if ($('chkPause').checked) stop = true;
        } else t.reheat = true;
      }
    } else if (t.d < t.mass && t.d < C) {
      t.d = Math.min(t.mass, C, t.d + rate * h);
      if (t.d >= t.mass - 1e-9) {
        t.d = t.mass;
        if (!t.eligible) { t.eligible = true; t.crystal = false; t.recordable = false; t.reheat = false; onDissolved(i); }
      }
    }
  });
  if (stop) { setPlaying(false); }
  return stop;
}
function onDissolved(i) {
  sound.ding();
  const all = solid.tubes.every(t => t.d >= t.mass);
  if (all && solid.heater) showMsg('세 시험관이 모두 녹았어요. 이제 가열을 끄세요.', false, 4000);
  else showMsg(`${tubeName(i)} 시험관이 모두 녹았어요.`, false, 1800);
}
function onCrystal(i) {
  sound._tone({ freq: 1568, type: 'triangle', dur: 0.18, vol: 0.13 });
  sound._tone({ freq: 2349, type: 'sine', dur: 0.3, vol: 0.1, delay: 0.1 });
  readyFlash = i;
  showMsg(`${tubeName(i)} 시험관에 고체가 생기기 시작했어요! 온도계를 보고 [기록]을 눌러요.`, false, 4000);
}
function tubeName(i) { const t = solid.tubes[i]; return solid.mode === 'textbook' ? `${t.mass} g` : `${i + 1}번(${gtxt(t.mass)} g)`; }

// ───────── 장면 메시지 ─────────
let msgTimer;
function showMsg(text, warn = false, ms = 2600) {
  const el = $('sceneMsg'); el.textContent = text; el.classList.toggle('warn', warn); el.classList.add('show');
  clearTimeout(msgTimer); msgTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ───────── 캔버스 도우미 ─────────
function makeView(id, LW, LH, anchor = 'center') {
  const cv = $(id);
  const v = { cv, ctx: cv.getContext('2d'), LW, LH, anchor, w: 1, h: 1, s: 1, ox: 0, oy: 0, dpr: 1 };
  new ResizeObserver(() => sizeView(v)).observe(cv);
  sizeView(v);
  return v;
}
function sizeView(v) {
  const r = v.cv.getBoundingClientRect();
  v.w = Math.max(1, r.width); v.h = Math.max(1, r.height);
  v.dpr = quality === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 0.8;
  v.cv.width = Math.round(v.w * v.dpr); v.cv.height = Math.round(v.h * v.dpr);
  v.s = Math.min(v.w / v.LW, v.h / v.LH);
  v.ox = (v.w - v.LW * v.s) / 2;
  v.oy = v.anchor === 'bottom' ? v.h - v.LH * v.s : (v.h - v.LH * v.s) / 2;
}
function deviceCtx(v) { const c = v.ctx; c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0); return c; }
function logicCtx(v) { const c = v.ctx; c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy); return c; }
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }
function tubePath(c, x, top, bottom, w) {
  const r = w / 2; c.beginPath(); c.moveTo(x - r, top); c.lineTo(x - r, bottom - r); c.arc(x, bottom - r, r, Math.PI, 0, true); c.lineTo(x + r, top);
}

// ───────── 탭 ① 장면 ─────────
const scene = makeView('scene', 760, 470, 'bottom');
const PLACES = { hotplate: { x: 190, y: 392 }, ice: { x: 570, y: 430 } };
const beak = { x: PLACES.hotplate.x, y: PLACES.hotplate.y, from: null, to: null, t: 1 };
function movePlace(p, instant) {
  solid.place = p;
  const to = PLACES[p];
  if (instant) { beak.x = to.x; beak.y = to.y; beak.t = 1; beak.from = beak.to = null; return; }
  beak.from = { x: beak.x, y: beak.y }; beak.to = to; beak.t = 0;
}
let bathBubbles = [], ices = [];
for (let i = 0; i < 9; i++) ices.push({ x: 452 + Math.random() * 236, y: 344 + Math.random() * 14, s: 14 + Math.random() * 10, a: (Math.random() - 0.5) * 0.8, front: i % 3 === 0 });
let animT = 0;

function drawScene(dtReal) {
  const v = scene, c = deviceCtx(v);
  // 배경(벽·실험대) — 화면 전체
  const g = c.createLinearGradient(0, 0, 0, v.h);
  g.addColorStop(0, '#eaf0f8'); g.addColorStop(1, '#d9e2ee');
  c.fillStyle = g; c.fillRect(0, 0, v.w, v.h);
  const benchY = v.oy + 440 * v.s;
  const bg = c.createLinearGradient(0, benchY, 0, v.h);
  bg.addColorStop(0, '#b98d5f'); bg.addColorStop(0.08, '#9c7148'); bg.addColorStop(1, '#7d5838');
  c.fillStyle = bg; c.fillRect(0, benchY, v.w, v.h - benchY);

  const L = logicCtx(v);
  // 비커 이동 애니메이션
  if (beak.t < 1 && beak.to) {
    beak.t = Math.min(1, beak.t + dtReal / 1.2);
    const p = ease.inOutCubic(beak.t);
    beak.x = lerp(beak.from.x, beak.to.x, p);
    beak.y = lerp(beak.from.y, beak.to.y, p) - Math.sin(Math.PI * p) * 60;
  }
  drawHotplate(L);
  drawTubBack(L);
  drawBeaker(L, dtReal);
  drawTubFront(L);
  drawThermo(L);
  drawCards(L);
  // HUD (화면 좌표)
  const D = deviceCtx(v);
  const mm = Math.floor(solid.time / 60), ss = Math.floor(solid.time % 60);
  const status = solid.place === 'ice' ? '얼음물에서 식는 중' : solid.heater ? (solid.T >= 100 ? '끓는 중 (100 ℃)' : '가열 중') : (solid.heatedOnce ? '공기 중에서 식는 중' : '준비');
  D.font = '600 14px ' + getComputedStyle(document.body).fontFamily;
  const txt = `⏱ ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}  ·  ×${speed} 빠르게  ·  ${status}`;
  const tw = D.measureText(txt).width;
  D.fillStyle = 'rgba(255,255,255,.88)'; rr(D, 8, 8, tw + 20, 28, 14); D.fill();
  D.fillStyle = '#1d2433'; D.textBaseline = 'middle'; D.textAlign = 'left'; D.fillText(txt, 18, 22);
  if (!playing) {
    D.fillStyle = 'rgba(29,36,51,.85)'; rr(D, 8, 42, 104, 28, 14); D.fill();
    D.fillStyle = '#fff'; D.fillText('⏸ 일시정지', 20, 56);
  }
}
function drawHotplate(c) {
  const on = solid.heater && solid.place === 'hotplate';
  rr(c, 60, 400, 260, 40, 8); c.fillStyle = '#3b4250'; c.fill();
  rr(c, 60, 400, 260, 6, 3); c.fillStyle = '#525a6a'; c.fill();
  const heat = on ? clamp((solid.T - 20) / 60, 0.35, 1) : 0;
  const pg = c.createLinearGradient(70, 392, 70, 402);
  pg.addColorStop(0, on ? `rgb(${200 + 55 * heat},${110 - 40 * heat},${80 - 40 * heat})` : '#c9ced6');
  pg.addColorStop(1, on ? '#8a3324' : '#9aa1ad');
  rr(c, 72, 391, 236, 11, 3); c.fillStyle = pg; c.fill();
  if (on && quality === 'high') { c.save(); c.globalAlpha = 0.25 + 0.15 * Math.sin(animT * 4); c.fillStyle = '#ff7a4a'; c.filter = 'blur(6px)'; c.fillRect(80, 384, 220, 10); c.restore(); }
  // 다이얼·표시등
  c.save(); c.translate(98, 421); c.beginPath(); c.arc(0, 0, 12, 0, Math.PI * 2); c.fillStyle = '#d9dde4'; c.fill();
  c.rotate(on ? 1.9 : -0.6); c.fillStyle = '#3b4250'; c.fillRect(-2, -11, 4, 9); c.restore();
  c.beginPath(); c.arc(292, 421, 5.5, 0, Math.PI * 2); c.fillStyle = on ? '#ff3b2f' : '#5d1f1a'; c.fill();
  if (on) { c.beginPath(); c.arc(292, 421, 10, 0, Math.PI * 2); c.fillStyle = 'rgba(255,60,40,.25)'; c.fill(); }
  c.fillStyle = '#e4e7ee'; c.font = '600 13px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('가열판', 195, 422);
}
function drawTubBack(c) {
  c.beginPath(); c.moveTo(440, 330); c.lineTo(700, 330); c.lineTo(690, 440); c.lineTo(450, 440); c.closePath();
  c.fillStyle = '#b8c7d6'; c.fill();
  c.beginPath(); c.moveTo(446, 352); c.lineTo(694, 352); c.lineTo(689, 436); c.lineTo(451, 436); c.closePath();
  c.fillStyle = '#cfe9f7'; c.fill();
  ices.filter(i => !i.front).forEach(i => drawIce(c, i));
}
function drawTubFront(c) {
  c.beginPath(); c.moveTo(446, 352); c.lineTo(694, 352); c.lineTo(689, 436); c.lineTo(451, 436); c.closePath();
  c.fillStyle = 'rgba(150,205,235,.38)'; c.fill();
  ices.filter(i => i.front).forEach(i => drawIce(c, i));
  c.strokeStyle = '#8193a8'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(440, 330); c.lineTo(450, 440); c.lineTo(690, 440); c.lineTo(700, 330); c.stroke();
  c.fillStyle = '#41556e'; c.font = '700 14px sans-serif'; c.textAlign = 'center'; c.fillText('얼음물 (0 ℃)', 570, 428);
}
function drawIce(c, i) {
  c.save(); c.translate(i.x, i.y + Math.sin(animT * 1.3 + i.x) * 1.2); c.rotate(i.a);
  rr(c, -i.s / 2, -i.s / 2, i.s, i.s, 3); c.fillStyle = 'rgba(240,250,255,.85)'; c.fill();
  c.strokeStyle = 'rgba(140,180,210,.9)'; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(-i.s / 2 + 3, -i.s / 2 + 3, i.s * 0.3, 2.5);
  c.restore();
}
const BW = 230, BH = 200, WATER_H = 150, TUBE_DX = 66, TUBE_W = 30, TUBE_LEN = 228, TUBE_BOT = 14;
function tubeGeo(i) {
  const x = beak.x + (i - 1) * TUBE_DX, bottom = beak.y - TUBE_BOT, top = bottom - TUBE_LEN;
  return { x, bottom, top };
}
function drawBeaker(c, dtReal) {
  const x0 = beak.x - BW / 2, bot = beak.y, top = bot - BH, wy = bot - WATER_H;
  // 물중탕 물
  const k = clamp(solid.T / 100, 0, 1);
  const wc = `rgba(${Math.round(lerp(140, 240, k))},${Math.round(lerp(195, 170, k))},${Math.round(lerp(240, 150, k))},0.42)`;
  rr(c, x0 + 3, wy, BW - 6, WATER_H - 3, [0, 0, 10, 10]); c.fillStyle = wc; c.fill();
  c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(x0 + 3, wy, BW - 6, 2);
  // 기포 (가열 중)
  const heating = solid.heater && solid.place === 'hotplate' && playing;
  if (heating) {
    const boil = solid.T >= 99.9;
    const rate = (boil ? 36 : clamp((solid.T - 45) / 55, 0, 1) * 10) * (quality === 'high' ? 1 : 0.5);
    let n = rate * dtReal; while (n > 0) { if (Math.random() < n) bathBubbles.push({ x: x0 + 12 + Math.random() * (BW - 24), y: bot - 6, r: boil ? 2 + Math.random() * 4 : 1 + Math.random() * 2, vy: 30 + Math.random() * 40 }); n -= 1; }
  }
  bathBubbles = bathBubbles.filter(b => {
    if (playing) { b.y -= b.vy * dtReal; b.x += Math.sin(animT * 6 + b.vy) * 0.3; b.r += dtReal * 0.6; }
    const dy = b.y - (beak.y - WATER_H);
    if (dy < 2 || bathBubbles.length > 220) return false;
    return true;
  });
  c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1;
  bathBubbles.forEach(b => { c.beginPath(); c.arc(b.x - (beak.x - beak.x), b.y, b.r, 0, Math.PI * 2); c.stroke(); });
  // 김 (끓을 때)
  if (heating && solid.T >= 99.9 && quality === 'high') {
    c.save(); c.globalAlpha = 0.22; c.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) { const p = (animT * 0.4 + i / 4) % 1; c.beginPath(); c.arc(x0 + 40 + i * 50 + Math.sin(p * 6 + i) * 8, top - p * 50, 10 + p * 14, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }
  // 시험관
  solid.tubes.forEach((t, i) => drawTube(c, t, i));
  // 비커 유리
  c.save();
  rr(c, x0, top, BW, BH, [2, 2, 12, 12]);
  c.fillStyle = 'rgba(220,235,250,.18)'; c.fill();
  c.strokeStyle = 'rgba(90,120,150,.85)'; c.lineWidth = 2.5; c.stroke();
  c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(x0 + 8, top + 10, 5, BH - 30);
  c.fillStyle = 'rgba(40,60,90,.75)'; c.font = '700 13px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('물중탕', x0 + 18, bot - 16);
  c.strokeStyle = 'rgba(90,120,150,.6)'; c.lineWidth = 1;
  for (let m = 1; m <= 4; m++) { const yy = bot - m * 40; c.beginPath(); c.moveTo(x0 + BW - 18, yy); c.lineTo(x0 + BW - 6, yy); c.stroke(); }
  c.restore();
}
function drawTube(c, t, i) {
  const { x, bottom, top } = tubeGeo(i);
  const key = soluteNow(), blue = key === 'CuSO4';
  const level = bottom - t.water * 7.5;
  c.save();
  tubePath(c, x, top, bottom, TUBE_W); c.closePath(); c.save(); c.clip();
  // 용액
  if (blue) {
    const a = clamp(0.1 + 1.25 * t.d / t.water, 0.08, 0.85);
    c.fillStyle = `rgba(30,105,215,${a})`;
  } else c.fillStyle = 'rgba(235,243,252,.75)';
  c.fillRect(x - 20, level, 40, bottom - level + 2);
  c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(x - 15, level, 30, 1.5);
  // 고체
  const solidAmt = t.mass - t.d;
  if (solidAmt > 0.005) {
    const hh = Math.min(t.water * 7.5 - 6, 3 + solidAmt * 4.3);
    if (!t.crystal) {
      c.beginPath(); c.moveTo(x - 16, bottom); c.lineTo(x - 16, bottom - hh * 0.55);
      c.quadraticCurveTo(x, bottom - hh * 1.35, x + 16, bottom - hh * 0.55); c.lineTo(x + 16, bottom); c.closePath();
      c.fillStyle = blue ? '#3d7fd6' : '#f4f3ee'; c.fill();
      c.fillStyle = blue ? '#245aa8' : '#c9c6bc';
      const nd = quality === 'high' ? 40 : 18;
      for (let k = 0; k < nd; k++) { const s = t.seed[k]; const px = x - 13 + s.x * 26, py = bottom - s.y * hh * 0.85; c.fillRect(px, py, 1.6, 1.6); }
    } else {
      const n = Math.min(44, 3 + Math.round(solidAmt * 6));
      for (let k = 0; k < n; k++) {
        const s = t.seed[k % 48];
        const floating = k % 6 === 5;
        const px = x - 12 + s.x * 24, py = floating ? level + 8 + s.y * (bottom - level - 20) : bottom - 2 - s.y * hh;
        const sz = 2.2 + s.r * 3.2;
        c.save(); c.translate(px, py); c.rotate(s.a);
        c.beginPath(); c.moveTo(0, -sz); c.lineTo(sz * 0.6, 0); c.lineTo(0, sz); c.lineTo(-sz * 0.6, 0); c.closePath();
        c.fillStyle = blue ? '#2c6fd0' : '#ffffff'; c.fill();
        c.strokeStyle = blue ? '#163f86' : '#9aa3b0'; c.lineWidth = 0.8; c.stroke();
        c.restore();
      }
    }
  }
  c.restore(); // clip
  // 반짝임 (고체가 막 생김)
  if (t.flash > 0) {
    const a = clamp(t.flash / 1.6, 0, 1);
    for (let k = 0; k < 5; k++) {
      const s = t.seed[k + 10], px = x - 10 + s.x * 20, py = bottom - 8 - s.y * 30, r = (4 + 4 * Math.sin(animT * 10 + k)) * a + 2;
      c.strokeStyle = `rgba(255,214,60,${a})`; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(px - r, py); c.lineTo(px + r, py); c.moveTo(px, py - r); c.lineTo(px, py + r); c.stroke();
    }
  }
  // 젓기 막대
  if (solid.stir) {
    const ph = animT * 5 + i;
    c.strokeStyle = 'rgba(200,225,245,.95)'; c.lineWidth = 3.5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + Math.sin(ph) * 3, top - 26); c.lineTo(x + Math.sin(ph + 0.6) * 8, bottom - 12); c.stroke();
    c.strokeStyle = 'rgba(110,140,170,.7)'; c.lineWidth = 1; c.stroke();
  }
  // 유리
  tubePath(c, x, top, bottom, TUBE_W);
  c.strokeStyle = 'rgba(80,105,135,.9)'; c.lineWidth = 2; c.stroke();
  c.beginPath(); c.ellipse(x, top, TUBE_W / 2 + 2, 3, 0, 0, Math.PI * 2); c.strokeStyle = 'rgba(80,105,135,.9)'; c.stroke();
  c.fillStyle = 'rgba(255,255,255,.45)'; c.fillRect(x - 10, top + 8, 3, bottom - top - 26);
  // 라벨 칩
  const lab = `${gtxt(t.mass)} g`;
  c.font = '700 13px sans-serif'; const lw = Math.max(34, c.measureText(lab).width + 12);
  rr(c, x - lw / 2, top + 6, lw, 19, 5); c.fillStyle = '#fffbea'; c.fill(); c.strokeStyle = '#c9a43c'; c.lineWidth = 1; c.stroke();
  c.fillStyle = '#4a3800'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(lab, x, top + 16);
  c.font = '600 12px sans-serif'; c.fillStyle = '#334055'; c.font = '600 11.5px sans-serif'; c.fillText(`물 ${t.water} mL`, x, top + 36);
  c.restore();
}
function drawCards(c) {
  solid.tubes.forEach((t, i) => {
    const { x, top } = tubeGeo(i);
    let l1, l2, col, bgc;
    if (t.crystal && t.recordable) { l1 = '고체 생김'; l2 = '✦ 기록 가능'; col = '#1550b8'; bgc = '#e3eeff'; }
    else if (t.d >= t.mass) { l1 = '모두 녹음'; l2 = '✓'; col = '#14724a'; bgc = '#e4f6ec'; }
    else if (t.reheat && !solid.heater) { l1 = '다시 가열'; l2 = '필요'; col = '#a24812'; bgc = '#fff0e2'; }
    else { l1 = '남은 고체'; l2 = `${fmt(t.mass - t.d, 1)} g`; col = '#3b4557'; bgc = '#ffffff'; }
    const y = top - 46;
    c.save();
    if (t.flash > 0) { c.shadowColor = 'rgba(255,200,40,.9)'; c.shadowBlur = 14 * clamp(t.flash, 0, 1); }
    rr(c, x - 32, y, 64, 38, 8); c.fillStyle = bgc; c.fill(); c.restore();
    rr(c, x - 32, y, 64, 38, 8); c.strokeStyle = col; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 12px sans-serif'; c.fillText(l1, x, y + 11);
    c.font = '700 14px sans-serif'; c.fillText(l2, x, y + 27);
  });
}
function drawThermo(c) {
  const px = beak.x + 98, ptop = beak.y - BH - 34, ptip = beak.y - 34;
  // 선
  c.strokeStyle = '#2d3340'; c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(px, ptop - 8); c.bezierCurveTo(px, ptop - 60, 382, 140, 382, 92); c.stroke();
  // 탐침
  c.strokeStyle = '#9aa3b0'; c.lineWidth = 3; c.beginPath(); c.moveTo(px, ptop); c.lineTo(px, ptip); c.stroke();
  rr(c, px - 5, ptop - 18, 10, 22, 3); c.fillStyle = '#2d3340'; c.fill();
  // 본체
  rr(c, 316, 12, 132, 80, 12); c.fillStyle = '#2b3242'; c.fill();
  rr(c, 326, 22, 112, 44, 6); c.fillStyle = '#c9f0c4'; c.fill();
  c.fillStyle = '#10301a'; c.font = '700 26px ui-monospace, Menlo, Consolas, monospace'; c.textAlign = 'right'; c.textBaseline = 'middle';
  c.fillText(solid.T.toFixed(1), 404, 45);
  c.font = '700 15px sans-serif'; c.textAlign = 'left'; c.fillText('℃', 408, 46);
  c.fillStyle = '#cfd6e2'; c.font = '600 12px sans-serif'; c.textAlign = 'center'; c.fillText('디지털 온도계', 382, 80);
}

// ───────── 탭 ② 기체 ─────────
const vTemp = makeView('gTemp', 520, 340), vPress = makeView('gPress', 520, 340), vFish = makeView('gFish', 440, 130);
const gasT = { inserted: false, anim: 0, time: 0, hot: { T: 10, C: 0.36, e: 0, Tw: 50 }, cold: { T: 10, C: 0.36, e: 0, Tw: 0 }, done: false, bub: [[], []] };
const gasP = { P: 1, C: 0.20, T: 20, e: 0, minP: 1, airFrom: null, airT: 1, pump: 0, bub: [] };
let fishTemp = 15;
function resetGasT() { Object.assign(gasT, { inserted: false, anim: 0, time: 0, done: false, bub: [[], []] }); Object.assign(gasT.hot, { T: 10, C: 0.36, e: 0 }); Object.assign(gasT.cold, { T: 10, C: 0.36, e: 0 }); }
function resetGasP(keepMin) { Object.assign(gasP, { P: 1, C: 0.20, e: 0, airFrom: null, airT: 1, pump: 0, bub: [] }); if (!keepMin) gasP.minP = 1; }
function bubbleWord(e) { return e >= 0.15 ? '아주 많음' : e >= 0.05 ? '많음' : e >= 0.01 ? '조금' : '거의 없음'; }
function excess(o, P) { return Math.max(0, o.C - co2(o.T) * P); }
function stepGas(dtReal) {
  const dtMin = dtReal * 10 / 60;   // 기체 탭은 ×10
  if (gasT.inserted) {
    gasT.time += dtMin;
    if (gasT.time >= 1) gasT.done = true;
    [gasT.hot, gasT.cold].forEach(o => { o.T += (o.Tw - o.T) / 0.5 * dtMin; o.e = excess(o, 1); o.C -= 1.5 * o.e * dtMin; });
  }
  gasP.e = excess(gasP, gasP.P);
  gasP.C -= 1.5 * gasP.e * dtMin;
}
let fizzAcc = 0;
function gasSound(dtReal) {
  fizzAcc += dtReal; if (fizzAcc < 1) return; fizzAcc = 0;
  const e = Math.max(gasT.inserted ? Math.max(gasT.hot.e, gasT.cold.e) : 0, gasP.e);
  if (e > 0.01) sound._noise({ dur: 0.5, from: 3500, to: 6000, vol: Math.min(0.05, 0.012 + e * 0.15) });
}
function spawnBubbles(list, e, dtReal, mk) {
  let n = Math.min(60, 400 * e) * (quality === 'high' ? 1 : 0.5) * dtReal;
  while (n > 0) { if (Math.random() < n) list.push(mk()); n -= 1; }
}
function bar(c, x, y, h, frac, color) {
  rr(c, x, y, 16, h, 5); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#8b95a8'; c.lineWidth = 1; c.stroke();
  const fh = h * clamp(frac, 0, 1);
  rr(c, x + 2, y + h - fh + 2, 12, Math.max(0, fh - 4), 4); c.fillStyle = color; c.fill();
  c.fillStyle = '#475166'; c.font = '600 12px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText('많음', x + 20, y + 6); c.fillText('적음', x + 20, y + h - 6);
}
function drawGasTemp(dtReal) {
  const v = vTemp, c = deviceCtx(v); c.clearRect(0, 0, v.w, v.h);
  const L = logicCtx(v);
  if (gasT.inserted && gasT.anim < 1) gasT.anim = Math.min(1, gasT.anim + dtReal / 1.0);
  const p = ease.inOutCubic(gasT.anim);
  L.fillStyle = '#c7a27a'; L.fillRect(-200, 290, 920, 60);
  [[140, gasT.hot, true], [380, gasT.cold, false]].forEach(([cx, o, hot], idx) => {
    const bot = 288, top = 158, wy = 178, x0 = cx - 75;
    rr(L, x0 + 2, wy, 146, bot - wy - 2, [0, 0, 8, 8]); L.fillStyle = hot ? 'rgba(240,140,110,.45)' : 'rgba(150,205,240,.5)'; L.fill();
    if (!hot) for (let k = 0; k < 4; k++) { const ix = x0 + 18 + k * 34; L.save(); L.translate(ix, wy + 6 + Math.sin(animT + k) * 1.5); L.rotate(0.3 * (k - 1.5)); rr(L, -9, -9, 18, 18, 3); L.fillStyle = 'rgba(245,252,255,.9)'; L.fill(); L.strokeStyle = 'rgba(130,175,205,.9)'; L.stroke(); L.restore(); }
    if (hot && quality === 'high') { L.save(); L.globalAlpha = 0.18; L.fillStyle = '#fff'; for (let k = 0; k < 3; k++) { const q = (animT * 0.35 + k / 3) % 1; L.beginPath(); L.arc(x0 + 35 + k * 40, top - 4 - q * 30, 7 + q * 8, 0, Math.PI * 2); L.fill(); } L.restore(); }
    // 시험관
    const ang = lerp(0, 0.26, p), bx = lerp(cx - 18, cx - 22, p), by = lerp(150, 280, p);
    L.save(); L.translate(bx, by); L.rotate(ang);
    const len = 140, w = 28, lvl = -len * 0.62;
    tubePath(L, 0, -len, 0, w); L.closePath(); L.save(); L.clip();
    L.fillStyle = 'rgba(205,130,45,.62)'; L.fillRect(-20, lvl, 40, -lvl + 2);
    const list = gasT.bub[idx];
    if (gasT.inserted && playing) spawnBubbles(list, o.e, dtReal, () => ({ x: -10 + Math.random() * 20, y: -4 - Math.random() * 6, r: 1 + Math.random() * 1.8, vy: 40 + Math.random() * 50 }));
    for (let k = list.length - 1; k >= 0; k--) { const b = list[k]; if (playing) { b.y -= b.vy * dtReal; b.r += dtReal * 0.8; } if (b.y < lvl + 2) list.splice(k, 1); }
    L.strokeStyle = 'rgba(255,255,255,.95)'; L.lineWidth = 1;
    list.forEach(b => { L.beginPath(); L.arc(b.x, b.y, b.r, 0, Math.PI * 2); L.stroke(); });
    if (list.length > 12) { L.fillStyle = 'rgba(255,250,240,.8)'; L.fillRect(-14, lvl - 3, 28, 4); }
    L.restore();
    tubePath(L, 0, -len, 0, w); L.strokeStyle = 'rgba(80,105,135,.9)'; L.lineWidth = 2; L.stroke();
    L.fillStyle = 'rgba(255,255,255,.45)'; L.fillRect(-9, -len + 8, 3, len - 24);
    L.restore();
    // 비커 유리
    rr(L, x0, top, 150, bot - top, [2, 2, 10, 10]); L.strokeStyle = 'rgba(90,120,150,.85)'; L.lineWidth = 2.2; L.stroke();
    // 막대 (녹을 수 있는 이산화 탄소 양)
    bar(L, cx + 84, 150, 132, co2(o.T) / 0.335, hot ? '#e0785a' : '#4a90d9');
    // 글
    L.fillStyle = '#1d2433'; L.textAlign = 'center'; L.textBaseline = 'middle';
    L.font = '700 14px sans-serif'; L.fillText(hot ? '뜨거운 물 (약 50 ℃)' : '얼음물 (0 ℃)', cx, 306);
    L.font = '600 13px sans-serif';
    L.fillText(`음료 온도 ${Math.round(o.T)} ℃ · 기포 ${gasT.inserted ? bubbleWord(o.e) : '-'}`, cx, 326);
  });
  L.fillStyle = '#475166'; L.font = '600 12px sans-serif'; L.textAlign = 'center';
  L.fillText(gasT.inserted ? '막대: 녹을 수 있는 이산화 탄소 양' : '[탄산음료 시험관 넣기]를 눌러요', 260, 18);
}
function drawGasPress(dtReal) {
  const v = vPress, c = deviceCtx(v); c.clearRect(0, 0, v.w, v.h);
  const L = logicCtx(v);
  if (gasP.airFrom != null && gasP.airT < 1) {
    gasP.airT = Math.min(1, gasP.airT + dtReal / 0.5);
    gasP.P = lerp(gasP.airFrom, 1, gasP.airT);
    if (gasP.airT >= 1) gasP.airFrom = null;
  }
  if (gasP.pump > 0) gasP.pump = Math.max(0, gasP.pump - dtReal * 3);
  L.fillStyle = '#c7a27a'; L.fillRect(-200, 300, 920, 60);
  rr(L, 100, 288, 240, 14, 4); L.fillStyle = '#4a5161'; L.fill();
  // 컵 속 탄산음료
  L.save(); L.beginPath(); L.moveTo(178, 200); L.lineTo(262, 200); L.lineTo(254, 286); L.lineTo(186, 286); L.closePath(); L.save(); L.clip();
  L.fillStyle = 'rgba(205,130,45,.62)'; L.fillRect(170, 216, 100, 80);
  if (playing) spawnBubbles(gasP.bub, gasP.e, dtReal, () => ({ x: 190 + Math.random() * 60, y: 284, r: 1 + Math.random() * 2, vy: 35 + Math.random() * 45 }));
  for (let k = gasP.bub.length - 1; k >= 0; k--) { const b = gasP.bub[k]; if (playing) { b.y -= b.vy * dtReal; b.r += dtReal; } if (b.y < 218) gasP.bub.splice(k, 1); }
  L.strokeStyle = 'rgba(255,255,255,.95)'; L.lineWidth = 1;
  gasP.bub.forEach(b => { L.beginPath(); L.arc(b.x, b.y, b.r, 0, Math.PI * 2); L.stroke(); });
  if (gasP.bub.length > 15) { L.fillStyle = 'rgba(255,250,240,.85)'; L.fillRect(170, 213, 100, 5); }
  L.restore();
  L.beginPath(); L.moveTo(178, 200); L.lineTo(254 + 8, 200); L.lineTo(254, 286); L.lineTo(186, 286); L.closePath(); L.strokeStyle = 'rgba(80,105,135,.9)'; L.lineWidth = 2; L.stroke();
  // 감압 용기
  rr(L, 120, 96, 200, 192, [30, 30, 4, 4]); L.fillStyle = 'rgba(210,230,250,.22)'; L.fill(); L.strokeStyle = 'rgba(70,100,135,.9)'; L.lineWidth = 3; L.stroke();
  L.fillStyle = 'rgba(255,255,255,.5)'; L.fillRect(134, 120, 6, 150);
  // 펌프
  const hy = 30 + gasP.pump * 26;
  rr(L, 207, 54, 26, 44, 4); L.fillStyle = '#5b6577'; L.fill();
  L.fillStyle = '#8b95a8'; L.fillRect(217, hy, 6, 60 - hy + 4);
  rr(L, 186, hy - 10, 68, 12, 6); L.fillStyle = '#e5533d'; L.fill();
  L.fillStyle = '#475166'; L.font = '600 12px sans-serif'; L.textAlign = 'left'; L.textBaseline = 'middle'; L.fillText('펌프', 260, hy - 4);
  // 압력계
  const gx = 405, gy = 140, gr = 52;
  L.beginPath(); L.arc(gx, gy, gr, 0, Math.PI * 2); L.fillStyle = '#fff'; L.fill(); L.strokeStyle = '#4a5161'; L.lineWidth = 4; L.stroke();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  L.lineWidth = 1.5; L.strokeStyle = '#4a5161'; L.fillStyle = '#1d2433'; L.font = '600 11.5px sans-serif'; L.textAlign = 'center';
  for (let k = 0; k <= 10; k++) {
    const a = lerp(a0, a1, k / 10), r0 = k % 5 === 0 ? gr - 12 : gr - 7;
    L.beginPath(); L.moveTo(gx + Math.cos(a) * r0, gy + Math.sin(a) * r0); L.lineTo(gx + Math.cos(a) * (gr - 3), gy + Math.sin(a) * (gr - 3)); L.stroke();
    if (k % 5 === 0) L.fillText(String(k / 10), gx + Math.cos(a) * (gr - 22), gy + Math.sin(a) * (gr - 22));
  }
  const na = lerp(a0, a1, gasP.P);
  L.strokeStyle = '#d63b2f'; L.lineWidth = 3; L.beginPath(); L.moveTo(gx, gy); L.lineTo(gx + Math.cos(na) * (gr - 10), gy + Math.sin(na) * (gr - 10)); L.stroke();
  L.beginPath(); L.arc(gx, gy, 4, 0, Math.PI * 2); L.fillStyle = '#1d2433'; L.fill();
  L.font = '600 11.5px sans-serif'; L.fillText('기압', gx, gy + 24);
  L.strokeStyle = '#4a5161'; L.lineWidth = 3; L.beginPath(); L.moveTo(320, 200); L.lineTo(gx, 200); L.lineTo(gx, gy + gr); L.stroke();
  L.fillStyle = '#1d2433'; L.font = '700 16px sans-serif'; L.fillText(`${gasP.P.toFixed(2)} 기압`, gx, 228);
  L.font = '600 13px sans-serif'; L.fillText(`기포 ${bubbleWord(gasP.e)}`, gx, 250);
  bar(L, 470, 84, 150, co2(gasP.T) * gasP.P / 0.335, '#4a90d9');
  L.fillStyle = '#475166'; L.font = '600 12px sans-serif'; L.textAlign = 'center';
  L.fillText('막대: 녹을 수 있는 이산화 탄소 양 (음료 20 ℃)', 300, 326);
}
const fishes = [{ x: 70, ph: 0, c: '#f28c28' }, { x: 160, ph: 2, c: '#e8553a' }, { x: 240, ph: 4, c: '#f5b335' }];
function drawFish() {
  const v = vFish, c = deviceCtx(v); c.clearRect(0, 0, v.w, v.h);
  const L = logicCtx(v);
  const k = (fishTemp - 10) / 20;
  rr(L, 8, 8, 296, 114, 8); L.fillStyle = `rgb(${Math.round(lerp(170, 205, k))},${Math.round(lerp(220, 228, k))},${Math.round(lerp(245, 220, k))})`; L.fill();
  L.strokeStyle = '#7c90a8'; L.lineWidth = 2; L.stroke();
  L.fillStyle = 'rgba(255,255,255,.6)'; L.fillRect(10, 20, 292, 2);
  L.fillStyle = '#6aa84f'; for (let i = 0; i < 5; i++) { L.beginPath(); L.ellipse(30 + i * 60, 118, 6, 18 + (i % 2) * 8, 0.1 * Math.sin(animT + i), 0, Math.PI * 2); L.fill(); }
  fishes.forEach((f, i) => {
    const ty = lerp(96, 30, k) + Math.sin(animT * 1.6 + f.ph) * lerp(10, 3, k);
    const fx = f.x + Math.sin(animT * 0.6 + f.ph) * 14;
    const dir = Math.cos(animT * 0.6 + f.ph) >= 0 ? 1 : -1;
    L.save(); L.translate(fx, ty); L.scale(dir, 1);
    L.beginPath(); L.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2); L.fillStyle = f.c; L.fill();
    L.beginPath(); L.moveTo(-13, 0); L.lineTo(-26, -8 + Math.sin(animT * 8 + i) * 2); L.lineTo(-26, 8 + Math.sin(animT * 8 + i) * 2); L.closePath(); L.fill();
    L.beginPath(); L.arc(8, -2, 2, 0, Math.PI * 2); L.fillStyle = '#1d2433'; L.fill();
    if (k > 0.6) { L.beginPath(); L.arc(16, 1, 2.5, 0, Math.PI * 2); L.strokeStyle = '#7a2a10'; L.lineWidth = 1.2; L.stroke(); }
    L.restore();
  });
  bar(L, 322, 14, 104, o2(fishTemp) / 11.5, '#3fa7d6');
  L.fillStyle = '#1d2433'; L.font = '600 12px sans-serif'; L.textAlign = 'left';
  L.fillText('물에 녹을 수', 370, 58); L.fillText('있는 산소 양', 370, 74);
}

// ───────── 그래프 ─────────
let chart = null;
function curveData(key) { const a = []; for (let i = 0; i <= 200; i++) { const T = i / 2; a.push({ x: T, y: solub(key, T) }); } return a; }
function pointsFor(key) {
  const k = graphScale === 'water100' ? 10 : 1;
  return [3, 5, 7].filter(m => recs[`${key}_${m}`] != null).map(m => ({ x: recs[`${key}_${m}`], y: m * k }));
}
function freePoints() {
  return freeRecords.map(r => ({ x: r.temp, y: graphScale === 'water100' ? r.mass * 100 / r.waterMl : r.mass * 10 / r.waterMl, c: SOL[r.solute].color }));
}
const guidePlugin = {
  id: 'guide',
  afterDatasetsDraw(ch) {
    if (readX == null) return;
    const { ctx, chartArea: a, scales } = ch, px = scales.x.getPixelForValue(readX);
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#1d2433'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.setLineDash([]);
    if (graphScale === 'water100') CURVE_ORDER.forEach(k => {
      if (!curvesOn[k]) return; const y = solub(k, readX); if (y > 160) return;
      ctx.beginPath(); ctx.arc(px, scales.y.getPixelForValue(y), 4.5, 0, Math.PI * 2); ctx.fillStyle = SOL[k].color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    });
    ctx.restore();
  },
};
function buildChart() {
  const Chart = window.Chart;
  if (!Chart) return;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 13;
  Chart.defaults.color = '#475166';
  const pt = (key) => ({ label: SOL[key].name, data: [], showLine: true, borderColor: SOL[key].color, backgroundColor: SOL[key].color, pointRadius: 6, pointHoverRadius: 6, borderWidth: 2, order: 0 });
  const curve = (key) => ({ label: SOL[key].name + ' 곡선', data: curveData(key), showLine: true, borderColor: SOL[key].color + 'b0', borderWidth: 2.2, pointRadius: 0, pointHoverRadius: 0, hidden: true, order: 2 });
  chart = new Chart($('chart'), {
    type: 'scatter',
    data: { datasets: [pt('KNO3'), pt('CuSO4'),
      { label: '내 실험', data: [], pointRadius: 5.5, pointBorderWidth: 2.2, backgroundColor: '#fff', borderColor: [], pointStyle: 'circle', order: 1 },
      ...CURVE_ORDER.map(curve)] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      events: [], plugins: { legend: { display: false }, tooltip: { enabled: false } },
      layout: { padding: { right: 6, top: 4 } },
      scales: {
        x: { type: 'linear', min: 0, max: 100, ticks: { stepSize: 20 }, title: { display: true, text: '온도(℃)' }, grid: { color: '#e6e9ef' } },
        y: { min: 0, max: 10, ticks: { stepSize: 5 }, title: { display: true, text: '용질의 질량(g)' }, grid: { color: '#e6e9ef' } },
      },
    },
    plugins: [guidePlugin],
  });
  updateChart();
}
function updateChart() {
  if (!chart) return;
  const big = graphScale === 'water100';
  const ds = chart.data.datasets;
  ds[0].data = pointsFor('KNO3'); ds[1].data = pointsFor('CuSO4');
  const fp = freePoints(); ds[2].data = fp; ds[2].borderColor = fp.map(p => p.c);
  CURVE_ORDER.forEach((k, i) => { ds[3 + i].hidden = !(big && curvesOn[k]); });
  const y = chart.options.scales.y;
  y.max = big ? 160 : 10; y.ticks.stepSize = big ? 20 : 5;
  y.title.text = big ? '용해도(g/물 100 g)' : '용질의 질량(g) · 물 10 g';
  chart.update();
  // 범례
  const has20 = freeRecords.some(r => r.waterMl !== 10);
  const lg = [
    `<span><i style="background:${SOL.KNO3.color}"></i>질산 칼륨 (탐구)</span>`,
    `<span><i style="background:${SOL.CuSO4.color}"></i>황산 구리(Ⅱ) (탐구)</span>`,
  ];
  if (freeRecords.length) lg.push(`<span><i class="ring" style="border-color:#5b6577"></i>내 실험${has20 && !big ? ' (물 10 g으로 환산)' : ''}</span>`);
  if (big) lg.push('<span>선: 용해도 곡선</span>');
  $('legend').innerHTML = lg.join('');
  $('curveChips').hidden = !big; $('srcNote').hidden = !big;
  $('btnScale').setAttribute('aria-pressed', String(big));
  $('btnScale').textContent = big ? '물 10 g 기준으로 보기' : '물 100 g 기준으로 보기';
  $('gTitle').textContent = big ? '결과 그래프 · 용해도 곡선' : '결과 그래프';
  if (big && CURVE_ORDER.every(k => curvesOn[k])) curvesViewed = true;
  paintReadout();
}
function paintReadout() {
  const el = $('readout');
  if (readX == null) { el.hidden = true; return; }
  el.hidden = false;
  const T = Math.round(readX);
  if (graphScale !== 'water100') { el.innerHTML = `<b>${T} ℃</b> — [물 100 g 기준으로 보기]를 켜면 용해도 곡선 값을 읽을 수 있어요`; return; }
  const on = CURVE_ORDER.filter(k => curvesOn[k]);
  el.innerHTML = `<b>${T} ℃</b> (g/물 100 g)<br>` + (on.length ? on.map(k => `<span style="color:${SOL[k].color}">● ${SOL[k].name} <b>${fmt(solub(k, T), 1)}</b></span>`).join('') : '곡선을 켜 보세요');
}
function chartRead(e) {
  if (!chart) return;
  const r = $('chart').getBoundingClientRect();
  const x = chart.scales.x.getValueForPixel(e.clientX - r.left);
  readX = Math.round(clamp(x, 0, 100));
  chart.draw(); paintReadout();
}
let chartDown = false;
$('chart').addEventListener('pointerdown', e => { if (isLocked()) return; chartDown = true; $('chart').setPointerCapture(e.pointerId); chartRead(e); sound.tick(0.5); });
$('chart').addEventListener('pointermove', e => { if (isLocked()) return; if (chartDown || e.pointerType === 'mouse') chartRead(e); });
$('chart').addEventListener('pointerup', () => { chartDown = false; });
$('chart').addEventListener('pointercancel', () => { chartDown = false; });
$('chart').addEventListener('keydown', e => {
  if (isLocked()) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  readX = clamp((readX ?? 40) + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, 100);
  sound.tick(readX / 100); chart && chart.draw(); paintReadout();
});

// ───────── 표·조작 UI ─────────
function buildTables() {
  $('tbBody').innerHTML = [3, 5, 7].map(m => `<tr><td>${m} g</td>` +
    ['KNO3', 'CuSO4'].map(k => `<td class="cell"><b id="v_${k}_${m}" class="empty">-</b><button class="rec-btn" data-k="${k}_${m}" aria-label="${SOL[k].name} ${m} g 기록">기록</button></td>`).join('') + '</tr>').join('');
  $('tubeSet').innerHTML = freeCfg.map((f, i) => `<div class="tube-row" data-i="${i}">
      <span class="tn">시험관 ${i + 1}</span>
      <input type="range" min="1" max="10" step="0.5" value="${f.mass}" aria-label="시험관 ${i + 1}에 넣을 질량">
      <output>${gtxt(f.mass)} g</output>
      <div class="seg" role="group" aria-label="시험관 ${i + 1} 물의 양" title="물의 양"><button data-w="10" aria-pressed="${f.water === 10}">10 mL</button><button data-w="20" aria-pressed="${f.water === 20}">20 mL</button></div>
      <button class="rec-btn" data-fi="${i}" aria-label="시험관 ${i + 1} 기록">기록</button>
    </div>`).join('');
  document.querySelectorAll('#tbBody .rec-btn').forEach(b => b.addEventListener('click', () => recordTextbook(b.dataset.k)));
  document.querySelectorAll('#tubeSet .tube-row').forEach(row => {
    const i = +row.dataset.i, inp = row.querySelector('input'), out = row.querySelector('output');
    inp.addEventListener('input', () => {
      freeCfg[i].mass = +inp.value; out.textContent = `${gtxt(+inp.value)} g`;
      sound.tick((+inp.value - 1) / 9); resetFreeTube(i);
    });
    row.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
      freeCfg[i].water = +b.dataset.w;
      row.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      sound.soft(); resetFreeTube(i);
    }));
    row.querySelector('.rec-btn').addEventListener('click', () => recordFree(i));
  });
}
function resetFreeTube(i) {
  if (solid.mode !== 'free') return;
  solid.tubes[i] = makeTube(freeCfg[i].mass, freeCfg[i].water);
  solid.runRecorded[i] = false;
}
function buildSoluteSeg() {
  const keys = solid.mode === 'textbook' ? ['KNO3', 'CuSO4'] : CURVE_ORDER;
  const cur = soluteNow();
  $('soluteSeg').innerHTML = keys.map(k => `<button data-k="${k}" aria-pressed="${k === cur}">${SOL[k].name}</button>`).join('');
  $('soluteSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.k === soluteNow()) return;
    if (solid.mode === 'textbook') solid.solute = b.dataset.k; else solid.freeSolute = b.dataset.k;
    sound.whoosh(); buildSoluteSeg(); newRun();
    showMsg(`${SOL[b.dataset.k].name}(으)로 새로 시작해요. 물중탕은 실온(20 ℃)이에요.`);
  }));
}
function recordTextbook(k) {
  const [key, m] = k.split('_'); const i = [3, 5, 7].indexOf(+m);
  const t = solid.tubes[i];
  if (!(solid.mode === 'textbook' && solid.solute === key && t && t.recordable)) return;
  recs[k] = r1(solid.T); solid.runRecorded[i] = true; readyFlash = -1;
  sound.record(); showMsg(`${SOL[key].name} ${m} g: ${fmt(recs[k], 1)} ℃ 기록`);
  updateChart(); refreshUI(true);
}
function recordFree(i) {
  const t = solid.tubes[i];
  if (!(solid.mode === 'free' && t && t.recordable)) return;
  const row = { solute: solid.freeSolute, mass: t.mass, waterMl: t.water, temp: r1(solid.T) };
  freeRecords = freeRecords.filter(r => !(r.solute === row.solute && r.mass === row.mass && r.waterMl === row.waterMl));
  freeRecords.push(row); if (freeRecords.length > 20) freeRecords.shift();
  solid.runRecorded[i] = true; readyFlash = -1;
  sound.record(); showMsg(`${SOL[row.solute].name} ${gtxt(row.mass)} g · 물 ${row.waterMl} mL: ${fmt(row.temp, 1)} ℃ 기록`);
  updateChart(); refreshUI(true);
}
function paintFreeList() {
  const rows = freeRecords.slice().reverse();
  $('freeBody').innerHTML = rows.length ? rows.map(r => `<tr><td>${SOL[r.solute].name}</td><td>${gtxt(r.mass)} g</td><td>${r.waterMl} mL</td><td>${fmt(r.temp, 1)} ℃</td></tr>`).join('')
    : '<tr><td colspan="4" class="hint">아직 기록이 없어요</td></tr>';
}

let uiKey = '';
function refreshUI(force) {
  // 표 값
  for (const k in recs) { const el = $('v_' + k); if (!el) continue; el.textContent = recs[k] == null ? '-' : `${fmt(recs[k], 1)} ℃`; el.classList.toggle('empty', recs[k] == null); }
  // 기록 버튼
  document.querySelectorAll('#tbBody .rec-btn').forEach(b => {
    const [key, m] = b.dataset.k.split('_'); const i = [3, 5, 7].indexOf(+m), t = solid.tubes[i];
    const ok = solid.mode === 'textbook' && solid.solute === key && t && t.recordable;
    b.disabled = !ok || isLocked(); b.classList.toggle('ready', ok && !solid.runRecorded[i]);
  });
  document.querySelectorAll('#tubeSet .rec-btn').forEach(b => {
    const i = +b.dataset.fi, t = solid.tubes[i];
    const ok = solid.mode === 'free' && t && t.recordable;
    b.disabled = !ok || isLocked(); b.classList.toggle('ready', ok && !solid.runRecorded[i]);
  });
  const key = JSON.stringify([solid.heater, solid.place, solid.stir, solid.mode, freeRecords.length, solid.iceHint, stepNow()]);
  if (!force && key === uiKey) return; uiKey = key;
  const heatBtn = $('btnHeat');
  heatBtn.textContent = solid.heater ? '⏻ 가열 끄기' : '🔥 가열 켜기';
  heatBtn.setAttribute('aria-pressed', String(solid.heater));
  heatBtn.disabled = solid.place === 'ice' || isLocked();
  heatBtn.title = solid.place === 'ice' ? '가열판으로 돌린 뒤 가열할 수 있어요' : '';
  $('btnIce').textContent = solid.place === 'ice' ? '↩ 가열판으로 돌리기' : '🧊 얼음물로 옮기기';
  $('btnIce').classList.toggle('pulse', solid.iceHint && solid.place === 'hotplate');
  $('btnStir').setAttribute('aria-pressed', String(solid.stir));
  $('btnStir').textContent = solid.stir ? '🥢 젓는 중 (끄기)' : '🥢 유리 막대로 젓기';
  $('tbView').hidden = solid.mode !== 'textbook'; $('freeView').hidden = solid.mode !== 'free';
  $('btnInfo').hidden = soluteNow() !== 'CuSO4' && !(solid.mode === 'textbook');
  $('recHint').textContent = solid.mode === 'textbook' ? '고체가 생긴 시험관만 [기록]할 수 있어요.' : '같은 조건을 다시 기록하면 바뀌어요.';
  paintFreeList();
  // 단계 안내
  const s = stepNow();
  $('step4').textContent = solid.mode === 'free' ? '④ 조건을 바꿔 반복' : solid.solute === 'KNO3' ? '④ 황산 구리(Ⅱ)로 반복' : '④ 질산 칼륨과 비교';
  document.querySelectorAll('#steps li').forEach(li => { const n = +li.dataset.s; li.classList.toggle('now', n === s); li.classList.toggle('done', n < s); });
}
function stepNow() {
  const all = solid.tubes.every(t => t.d >= t.mass);
  if (solid.heater) return all ? 2 : 1;
  if (!solid.heatedOnce) return 1;
  if (solid.runRecorded.every(Boolean)) return 4;
  return 3;
}

// 버튼
$('btnHeat').addEventListener('click', () => {
  if (solid.place === 'ice') return;
  solid.heater = !solid.heater; sound.click();
  if (solid.heater) { solid.heatedOnce = true; solid.iceHint = false; showMsg('가열을 켰어요. 물중탕 온도가 올라가요.'); }
  else heaterOffCheck();
  refreshUI(true);
});
function heaterOffCheck() {
  const left = solid.tubes.map((t, i) => (t.d < t.mass ? i : -1)).filter(i => i >= 0);
  left.forEach(i => { solid.tubes[i].reheat = true; });
  if (left.length) showMsg('아직 다 녹지 않은 시험관이 있어요. 모두 녹은 뒤 식혀야 정확해요.', true, 4200);
  else showMsg('가열을 껐어요. 식으면서 고체가 생기는지 지켜봐요.');
}
$('btnStir').addEventListener('click', () => {
  solid.stir = !solid.stir;
  sound._tone({ freq: 2350, type: 'sine', dur: 0.14, vol: 0.12 }); sound._tone({ freq: 3520, type: 'sine', dur: 0.1, vol: 0.05, delay: 0.05 });
  if (solid.stir) showMsg('저으면 빨리 녹지만, 녹을 수 있는 양은 그대로예요.', false, 3200);
  refreshUI(true);
});
$('btnIce').addEventListener('click', () => {
  if (solid.place === 'hotplate') {
    if (solid.heater) { solid.heater = false; heaterOffCheck(); }
    movePlace('ice'); solid.iceHint = false;
    [0, 0.06, 0.13].forEach((d, i) => sound._tone({ freq: 2400 + i * 500, type: 'triangle', dur: 0.06, vol: 0.09, delay: d }));
    showMsg('비커를 얼음물로 옮겼어요. 0 ℃를 향해 식어요.');
  } else {
    movePlace('hotplate'); sound.soft(); showMsg('비커를 가열판으로 돌렸어요.');
  }
  refreshUI(true);
});
$('speedSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  speed = +b.dataset.sp; sound.soft();
  $('speedSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
}));
$('chkPause').addEventListener('change', () => sound.soft());
$('modeSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === solid.mode) return;
  solid.mode = b.dataset.mode; sound.whoosh();
  $('modeSeg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  buildSoluteSeg(); newRun(); refreshUI(true);
  showMsg(solid.mode === 'free' ? '내 실험: 오른쪽에서 시험관마다 질량과 물의 양을 정해요.' : '탐구 (교과서): 물 10 mL에 3 g, 5 g, 7 g');
}));
$('btnInfo').addEventListener('click', () => { sound.soft(); showMsg('황산 구리(Ⅱ)는 그림 I-6과 같은 기준으로 계산했어요.', false, 3500); });
let clearTimer;
$('btnClear').addEventListener('click', () => {
  const b = $('btnClear');
  if (!b.classList.contains('confirm')) {
    b.classList.add('confirm'); b.textContent = '정말 지울까요?'; sound.soft();
    clearTimeout(clearTimer); clearTimer = setTimeout(() => { b.classList.remove('confirm'); b.textContent = '기록 지우기'; }, 3000);
    return;
  }
  clearTimeout(clearTimer); b.classList.remove('confirm'); b.textContent = '기록 지우기';
  for (const k in recs) recs[k] = null; freeRecords = []; solid.runRecorded = [false, false, false];
  sound.reset(); updateChart(); refreshUI(true); showMsg('기록을 모두 지웠어요.');
});
$('btnScale').addEventListener('click', () => {
  graphScale = graphScale === 'water10' ? 'water100' : 'water10'; sound.whoosh(); updateChart();
});
$('curveChips').innerHTML = CURVE_ORDER.map(k => `<button data-k="${k}" aria-pressed="true" style="color:${SOL[k].color}"><i></i>${SOL[k].name}</button>`).join('');
$('curveChips').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.k; curvesOn[k] = !curvesOn[k]; b.setAttribute('aria-pressed', String(curvesOn[k]));
  curvesOn[k] ? sound.soft() : sound.click(); updateChart();
}));

// 탭 ② 조작
$('btnInsert').addEventListener('click', () => {
  if (gasT.inserted) return;
  gasT.inserted = true; gasT.anim = 0; sound._noise({ dur: 0.7, from: 2500, to: 6000, vol: 0.07 });
  refreshGasUI();
});
$('btnRedo').addEventListener('click', () => { resetGasT(); sound.reset(); refreshGasUI(); });
let pumpRep = null;
function pumpOnce() {
  if (isLocked()) return;
  gasP.airFrom = null; gasP.airT = 1;
  gasP.P = Math.max(0.20, gasP.P * 0.85); gasP.minP = Math.min(gasP.minP, gasP.P); gasP.pump = 1;
  sound._noise({ dur: 0.09, from: 1800, to: 800, vol: 0.13 });
}
$('btnPump').addEventListener('pointerdown', e => {
  if (isLocked() || e.button > 0) return;
  pumpOnce(); clearInterval(pumpRep); pumpRep = setInterval(pumpOnce, 420);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('btnPump').addEventListener(ev, () => { clearInterval(pumpRep); pumpRep = null; }));
$('btnPump').addEventListener('click', e => { if (e.detail === 0) pumpOnce(); });
$('btnAir').addEventListener('click', () => {
  if (gasP.P >= 0.999) { showGasNote(); return; }
  gasP.airFrom = gasP.P; gasP.airT = 0; sound._noise({ dur: 0.6, from: 2600, to: 500, vol: 0.1 });
});
function showGasNote() { sound.soft(); }
$('btnNewSoda').addEventListener('click', () => { resetGasP(true); sound.bubble(); });
$('fishT').addEventListener('input', () => {
  fishTemp = +$('fishT').value; $('fishOut').textContent = `${fishTemp} ℃`; sound.tick((fishTemp - 10) / 20);
});
function refreshGasUI() {
  $('btnInsert').disabled = gasT.inserted || isLocked();
  $('obsHot').textContent = gasT.inserted ? bubbleWord(gasT.hot.e) : '-';
  $('obsCold').textContent = gasT.inserted ? bubbleWord(gasT.cold.e) : '-';
  $('obsPress').textContent = `${gasP.P.toFixed(2)} 기압 / ${bubbleWord(gasP.e)}`;
  $('obsMin').textContent = `${gasP.minP.toFixed(2)} 기압`;
}

// 공통
function setPlaying(p) {
  playing = p; $('btnPlay').textContent = p ? '⏸' : '▶';
  $('btnPlay').title = p ? '일시정지' : '재생'; $('btnPlay').setAttribute('aria-label', p ? '일시정지' : '재생');
}
$('btnPlay').addEventListener('click', () => { setPlaying(!playing); playing ? sound.on() : sound.off(); });
$('btnReset').addEventListener('click', () => {
  sound.reset();
  if (tab === 'solid') { newRun(); bathBubbles = []; showMsg('장면을 처음으로 돌렸어요. 기록은 그대로예요.'); refreshUI(true); }
  else { resetGasT(); resetGasP(false); fishTemp = 15; $('fishT').value = 15; $('fishOut').textContent = '15 ℃'; refreshGasUI(); }
  setPlaying(true);
});
$('btnMute').addEventListener('click', () => {
  const m = sound.toggleMute(); paintMute(); if (!m) sound.soft();
});
function paintMute() { $('btnMute').textContent = sound.muted ? '🔇' : '🔊'; $('btnMute').setAttribute('aria-pressed', String(sound.muted)); }
function paintQuality() { $('btnQuality').querySelector('.lbl').textContent = '품질: ' + (quality === 'high' ? '높음' : '낮음'); }
function setQuality(q) { quality = q; paintQuality(); [scene, vTemp, vPress, vFish].forEach(sizeView); }
$('btnQuality').addEventListener('click', () => { fpsMon.done = true; sound.click(); setQuality(quality === 'high' ? 'low' : 'high'); });
function setTab(t) {
  if (t === tab) return;
  tab = t; sound.whoosh();
  $('tabSolid').setAttribute('aria-selected', String(t === 'solid')); $('tabGas').setAttribute('aria-selected', String(t === 'gas'));
  $('paneSolid').hidden = t !== 'solid'; $('paneGas').hidden = t !== 'gas';
  requestAnimationFrame(() => { [scene, vTemp, vPress, vFish].forEach(sizeView); chart && chart.resize(); });
}
$('tabSolid').addEventListener('click', () => setTab('solid'));
$('tabGas').addEventListener('click', () => setTab('gas'));

// ───────── 잠금 ─────────
function isLocked() { return SimBridge.locked || document.documentElement.classList.contains('sim-locked'); }
function applyLock() {
  const L = isLocked();
  document.querySelectorAll('main button, main input, #btnPlay, #btnReset, .tabs button').forEach(el => { if (L) el.disabled = true; });
  if (L) { clearInterval(pumpRep); setPlaying(false); }
  else { document.querySelectorAll('main button, main input, #btnPlay, #btnReset, .tabs button').forEach(el => { el.disabled = false; }); refreshUI(true); refreshGasUI(); }
}
SimBridge.onLock = applyLock;
new MutationObserver(applyLock).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

// ───────── SimBridge ─────────
SimBridge.init(UNIT);
let lastSent = '', sendAcc = 0;
function sendState() {
  const st = {
    tab, solidMode: solid.mode, solute: soluteNow(), bathTemp: r1(solid.T), heaterOn: solid.heater, place: solid.place, stirOn: solid.stir,
    tubes: solid.tubes.map(t => ({ mass: t.mass, waterMl: t.water, undissolved: r1(t.mass - t.d), allDissolved: t.d >= t.mass, crystal: t.crystal })),
    recKNO3_3: recs.KNO3_3, recKNO3_5: recs.KNO3_5, recKNO3_7: recs.KNO3_7, recCuSO4_3: recs.CuSO4_3, recCuSO4_5: recs.CuSO4_5, recCuSO4_7: recs.CuSO4_7,
    freeRecords: freeRecords.slice(), lastFree: freeRecords.length ? freeRecords[freeRecords.length - 1] : null,
    graphScale, curvesOn: CURVE_ORDER.filter(k => curvesOn[k]), curvesViewed,
    gasTempDone: gasT.done, gasHotBubbles: gasT.inserted ? bubbleWord(gasT.hot.e) : null, gasColdBubbles: gasT.inserted ? bubbleWord(gasT.cold.e) : null,
    gasPressure: Math.round(gasP.P * 100) / 100, gasMinPressure: Math.round(gasP.minP * 100) / 100, fishTemp,
  };
  const key = JSON.stringify(st);
  if (key !== lastSent) { lastSent = key; SimBridge.setState(st); }
}

// ───────── 반복 ─────────
const fpsMon = new FpsMonitor(() => { if (quality === 'high') { setQuality('low'); showMsg('화면이 느려서 그래픽 품질을 \'낮음\'으로 바꿨어요'); } }, { threshold: 28, window: 4 });
let last = performance.now(), boilSnd = 0, uiAcc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  animT += dt;
  if (playing && !isLocked()) {
    if (tab === 'solid') {
      stepSolid(dt * speed / 60);
      solid.tubes.forEach(t => { if (t.flash > 0) t.flash -= dt; });
      if (solid.heater && solid.T >= 99.9 && solid.place === 'hotplate') {
        boilSnd += dt; if (boilSnd > 1.1) { boilSnd = 0; [0, 0.12, 0.25].forEach(d => sound._tone({ freq: 160 + Math.random() * 120, freq2: 300 + Math.random() * 200, type: 'sine', dur: 0.08, vol: 0.05, delay: d })); }
      }
    } else { stepGas(dt); gasSound(dt); }
  }
  if (tab === 'solid') drawScene(dt); else { drawGasTemp(dt); drawGasPress(dt); drawFish(); }
  uiAcc += dt;
  if (uiAcc > 0.1) { uiAcc = 0; if (tab === 'solid') refreshUI(false); else refreshGasUI(); }
  sendAcc += dt; if (sendAcc >= 0.2) { sendAcc = 0; sendState(); }
  if (playing) fpsMon.update(dt);
  requestAnimationFrame(frame);
}

// 시작
buildTables(); buildSoluteSeg(); newRun(); paintMute(); paintQuality();
buildChart(); refreshUI(true); refreshGasUI(); sendState();
requestAnimationFrame(frame);

// 검산용 (화면에는 안 씀): 고체가 생기기 시작하는 온도 계산
window.__sim = { solub, solid, recs, get freeRecords() { return freeRecords; } };
