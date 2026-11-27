// 15-3-3-1-01 빠르기가 일정하다는 것은 (등속 운동)
import { sound } from '../../lib/sound.js';
import { clamp, ease, toast, FpsMonitor } from '../../lib/utils.js';

const UNIT = '15-3-3-1-01';
const V_TEXT = 25;          // 교과서 실험 자동차 속력(cm/s) — 화면에는 표시하지 않음
const T_MAX = 4;            // s
const CAR_LEN = 20;         // cm
const RULER_MAX = 150;      // cm
const ZOOM = 2.5;           // 확대경 배율
const EPS = 1e-6;

const PAL = {
  10: { mid: '#2f6fdb', hi: '#7fb0ff', lo: '#1b3f8a' },
  15: { mid: '#0e9aa7', hi: '#6fd6de', lo: '#076069' },
  20: { mid: '#2e9d4f', hi: '#86d79c', lo: '#1a6232' },
  25: { mid: '#e0392b', hi: '#ff8a7c', lo: '#97180f' },
  30: { mid: '#8a4fd8', hi: '#c59cff', lo: '#55288f' },
};
const RED = PAL[25];

const $ = s => document.querySelector(s);
const r1 = v => Math.round(v * 10) / 10;
const f1 = v => r1(v).toFixed(1);
const isLocked = () => document.documentElement.classList.contains('sim-locked');

// ── 상태 ─────────────────────────────────────────────
const TB = {                       // 교과서 실험 기록
  t: 0, ran4: false,
  table1: Array(5).fill(null), table2Dist: Array(4).fill(null), table2Speed: Array(4).fill(null),
  m1: Array(5).fill(null), m2d: Array(4).fill(null), m2s: Array(4).fill(null),
  table1Correct: 0, table2Correct: 0, bracket: null,
  st: [], vt: [], stMarks: null, vtMarks: null,
  stCorrect: false, vtCorrect: false, stUnlocked: false, vtUnlocked: false,
  stAnim: 1, vtAnim: 1, vtHint: false,
  msg1: ['', ''], msg2: ['', ''],
};
const VR = { t: 0, speed: 25, history: [], variedSpeeds: [] };   // 속력 바꾸기
const S = {
  mode: 'textbook', quality: 'high', playing: false, stopAt: T_MAX,
  runs: 0, step: 1, magnifierUses: 0, tableChecks: 0, graphChecks: 0,
  cumulativeMistakes: 0, vtIntegerMistakes: 0,
  lens: { cm: 46, dy: null },
  slope: { on: false, T1: 1, T2: 3, anim: 0, used: false, value: null, t1: null, t2: null },
  area: { on: false, T: 2, shown: 0, used: false, value: null, tUsed: null },
  flashes: [],
};
const G = {
  st: { erase: false, hover: null, cursor: null, drag: null, msg: ['', ''], fallback: '' },
  vt: { erase: false, hover: null, cursor: null, drag: null, msg: ['', ''], fallback: '' },
};

const cur = () => (S.mode === 'textbook' ? TB : VR);
const speed = () => (S.mode === 'textbook' ? V_TEXT : VR.speed);
const slopeAvail = () => S.mode === 'vary' || TB.stUnlocked;
const areaAvail = () => S.mode === 'vary' || TB.vtUnlocked;

let dirty = true;
let needPush = true;
const mark = () => { dirty = true; };
const push = () => { needPush = true; };

// ── 캔버스 크기 맞추기 ────────────────────────────────
function fit(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = S.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { W: r.width, H: r.height, dpr };
}

// ── 실험 장면 ────────────────────────────────────────
const cvScene = $('#scene');
const ctxS = cvScene.getContext('2d');
let SG = null;               // 장면 기하
let bgCanvas = document.createElement('canvas');

function sceneGeom(W, H) {
  const mL = 48, mR = 46;
  const ppc = (W - mL - mR) / RULER_MAX;
  const carL = CAR_LEN * ppc;
  const rulerH = clamp(H * 0.14, 34, 50);
  const rulerTop = Math.round(clamp(H * 0.6, carL * 0.42 + 68, H - rulerH - 46));
  const base = rulerTop - 2;
  const tableBack = Math.round(Math.max(30, base - carL * 0.42 - 44));
  const lensR = clamp(H * 0.2, 46, 62);
  return { W, H, mL, mR, ppc, carL, rulerH, rulerTop, base, tableBack, lensR, X: cm => mL + cm * ppc };
}

// 결이 매번 같게 나오는 의사 난수
const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function drawStatic(ctx, g, detail) {
  const { W, H, X, rulerTop: rt, rulerH: rh, tableBack: tb } = g;
  const hi = S.quality === 'high';
  // 벽
  let gr = ctx.createLinearGradient(0, 0, 0, tb);
  gr.addColorStop(0, '#dde6f1'); gr.addColorStop(1, '#eef3f9');
  ctx.fillStyle = gr; ctx.fillRect(-W, -H, W * 3, tb + H);
  if (hi) {
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 6; i++) ctx.fillRect((i + 0.5) * W / 6 - 1, 0, 2, tb);
  }
  // 탁자 윗면
  const front = H - 16;
  gr = ctx.createLinearGradient(0, tb, 0, front);
  gr.addColorStop(0, '#c8a27a'); gr.addColorStop(0.15, '#d9b48b'); gr.addColorStop(1, '#cfa274');
  ctx.fillStyle = gr; ctx.fillRect(-W, tb, W * 3, front - tb);
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-W, tb, W * 3, 2);
  if (hi) {   // 나뭇결
    ctx.save(); ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const y = tb + 8 + rnd(i) * (front - tb - 10);
      ctx.strokeStyle = `rgba(120,78,40,${0.05 + rnd(i + 50) * 0.08})`;
      ctx.beginPath(); ctx.moveTo(-10, y);
      for (let x = 0; x <= W + 20; x += 40) ctx.lineTo(x, y + Math.sin(x / (60 + rnd(i + 9) * 90) + i) * 2.2);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 탁자 앞 모서리
  gr = ctx.createLinearGradient(0, front, 0, H);
  gr.addColorStop(0, '#9a6a3e'); gr.addColorStop(1, '#6d4524');
  ctx.fillStyle = gr; ctx.fillRect(-W, front, W * 3, H - front + H);

  // 자
  const x0 = X(-3), x1 = X(RULER_MAX + 3);
  ctx.save();
  if (hi && !detail) { ctx.shadowColor = 'rgba(60,40,20,.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4; }
  gr = ctx.createLinearGradient(0, rt, 0, rt + rh);
  gr.addColorStop(0, '#fff8d9'); gr.addColorStop(0.55, '#f8e7a6'); gr.addColorStop(1, '#e9cf7c');
  ctx.fillStyle = gr;
  roundRect(ctx, x0, rt, x1 - x0, rh, 4); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#b89a4c'; ctx.lineWidth = detail ? 0.5 : 1;
  roundRect(ctx, x0, rt, x1 - x0, rh, 4); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(x0 + 3, rt + 1, x1 - x0 - 6, 1.5);

  // 눈금
  ctx.strokeStyle = '#3a3324';
  for (let cm = 0; cm <= RULER_MAX; cm++) {
    const len = cm % 10 === 0 ? rh * 0.42 : cm % 5 === 0 ? rh * 0.3 : rh * 0.18;
    ctx.lineWidth = detail ? (cm % 10 === 0 ? 0.6 : 0.4) : (cm % 10 === 0 ? 1.3 : 1);
    const x = Math.round(X(cm) * 2) / 2 + (detail ? 0 : 0.25);
    ctx.beginPath(); ctx.moveTo(x, rt); ctx.lineTo(x, rt + len); ctx.stroke();
  }
  ctx.fillStyle = '#2d2718'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (!detail) {
    ctx.font = '600 12px ' + getFont();
    for (let cm = 0; cm <= RULER_MAX; cm += 10) ctx.fillText(String(cm), X(cm), rt + rh * 0.72);
    ctx.textAlign = 'right'; ctx.font = '600 12px ' + getFont(); ctx.fillStyle = '#4a3f22';
    ctx.fillText('(cm)', X(RULER_MAX + 3), rt + rh + 13);
  } else {
    // 확대경 속: 1 cm마다 끝자리 숫자, 10 cm마다 전체 숫자
    ctx.font = '600 4.4px ' + getFont();
    for (let cm = 0; cm <= RULER_MAX; cm++) if (cm % 10) ctx.fillText(String(cm % 10), X(cm), rt + rh * 0.18 + 3.2);
    ctx.font = '800 6px ' + getFont();
    for (let cm = 0; cm <= RULER_MAX; cm += 10) ctx.fillText(String(cm), X(cm), rt + rh * 0.42 + 3.6);
  }
}

let _font = null;
function getFont() { return _font || (_font = getComputedStyle(document.body).fontFamily); }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// 장난감 자동차 옆모습 (x = 뒤 끝, base = 바퀴 닿는 선)
function drawCar(ctx, x, base, u, pal, { alpha = 1, wheelA = 0, shadow = true } = {}) {
  const hi = S.quality === 'high';
  ctx.save();
  ctx.translate(x, base);
  ctx.globalAlpha = alpha;
  if (shadow) {
    const sg = ctx.createRadialGradient(u * 0.5, 0, 1, u * 0.5, 0, u * 0.56);
    sg.addColorStop(0, 'rgba(50,30,10,.38)'); sg.addColorStop(1, 'rgba(50,30,10,0)');
    ctx.fillStyle = sg; ctx.save(); ctx.scale(1, 0.12); ctx.beginPath(); ctx.arc(u * 0.5, 0, u * 0.56, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const yb = -0.1 * u, yt = -0.27 * u, roof = -0.43 * u;
  // 차체 위쪽(지붕·창)
  let gr = ctx.createLinearGradient(0, roof, 0, yt);
  gr.addColorStop(0, pal.hi); gr.addColorStop(1, pal.mid);
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(0.17 * u, yt + 1);
  ctx.lineTo(0.29 * u, roof + 0.03 * u);
  ctx.quadraticCurveTo(0.31 * u, roof, 0.35 * u, roof);
  ctx.lineTo(0.6 * u, roof);
  ctx.quadraticCurveTo(0.64 * u, roof, 0.67 * u, roof + 0.03 * u);
  ctx.lineTo(0.8 * u, yt + 1);
  ctx.closePath(); ctx.fill();
  // 창문
  gr = ctx.createLinearGradient(0, roof, 0, yt);
  gr.addColorStop(0, '#e6f4ff'); gr.addColorStop(1, '#86aecd');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(0.23 * u, yt - 0.005 * u); ctx.lineTo(0.315 * u, roof + 0.035 * u); ctx.lineTo(0.465 * u, roof + 0.035 * u); ctx.lineTo(0.465 * u, yt - 0.005 * u); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.495 * u, yt - 0.005 * u); ctx.lineTo(0.495 * u, roof + 0.035 * u); ctx.lineTo(0.625 * u, roof + 0.035 * u); ctx.lineTo(0.735 * u, yt - 0.005 * u); ctx.closePath(); ctx.fill();
  if (hi) {
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.moveTo(0.33 * u, roof + 0.04 * u); ctx.lineTo(0.37 * u, roof + 0.04 * u); ctx.lineTo(0.3 * u, yt - 0.01 * u); ctx.lineTo(0.27 * u, yt - 0.01 * u); ctx.closePath(); ctx.fill();
  }
  // 아래 차체
  gr = ctx.createLinearGradient(0, yt, 0, yb);
  gr.addColorStop(0, pal.hi); gr.addColorStop(0.35, pal.mid); gr.addColorStop(1, pal.lo);
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(0, yb);
  ctx.lineTo(0, yt + 0.04 * u);
  ctx.quadraticCurveTo(0, yt, 0.05 * u, yt);
  ctx.lineTo(0.88 * u, yt + 0.005 * u);
  ctx.quadraticCurveTo(0.99 * u, yt + 0.015 * u, u, yt + 0.08 * u);
  ctx.lineTo(u, yb);
  ctx.closePath(); ctx.fill();
  // 바퀴집
  ctx.fillStyle = 'rgba(25,10,8,.85)';
  for (const wx of [0.22, 0.78]) { ctx.beginPath(); ctx.arc(wx * u, yb + 0.005 * u, 0.125 * u, Math.PI, 0); ctx.fill(); }
  // 줄무늬·반사광
  ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1, u * 0.018);
  ctx.beginPath(); ctx.moveTo(0.36 * u, -0.2 * u); ctx.lineTo(0.64 * u, -0.2 * u); ctx.stroke();
  if (hi) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0.06 * u, yt + 0.012 * u, 0.8 * u, 0.02 * u); }
  // 앞등·뒷등·범퍼
  ctx.fillStyle = '#ffe58a'; roundRect(ctx, 0.95 * u, -0.235 * u, 0.045 * u, 0.04 * u, 0.012 * u); ctx.fill();
  ctx.fillStyle = '#7a0d08'; ctx.fillRect(0.004 * u, -0.235 * u, 0.026 * u, 0.04 * u);
  ctx.fillStyle = '#39404d'; ctx.fillRect(0, yb - 0.045 * u, 0.04 * u, 0.045 * u); ctx.fillRect(0.96 * u, yb - 0.045 * u, 0.04 * u, 0.045 * u);
  // 바퀴
  for (const wx of [0.22, 0.78]) {
    const cx = wx * u, cy = -0.105 * u, r = 0.105 * u;
    ctx.fillStyle = '#20232a'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    const rg = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r * 0.6);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(1, '#9aa3b2');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6b7484'; ctx.lineWidth = Math.max(0.6, r * 0.12);
    for (let k = 0; k < 5; k++) {
      const a = wheelA + k * Math.PI * 2 / 5;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.15, cy + Math.sin(a) * r * 0.15); ctx.lineTo(cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52); ctx.stroke();
    }
    ctx.fillStyle = '#4b5361'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function pill(ctx, x, y, text, color, { size = 12, bg = 'rgba(255,255,255,.94)' } = {}) {
  ctx.save();
  ctx.font = `700 ${size}px ${getFont()}`;
  const w = ctx.measureText(text).width + size * 0.9, h = size + 8;
  ctx.fillStyle = bg; ctx.strokeStyle = color; ctx.lineWidth = 1.3;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
  return w;
}

function bracket(ctx, xa, xb, y, color, label) {
  if (xb - xa < 2) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const m = (xa + xb) / 2;
  ctx.beginPath();
  ctx.moveTo(xa, y - 7); ctx.quadraticCurveTo(xa, y, xa + 6, y); ctx.lineTo(m - 5, y); ctx.lineTo(m, y + 5);
  ctx.lineTo(m + 5, y); ctx.lineTo(xb - 6, y); ctx.quadraticCurveTo(xb, y, xb, y - 7);
  ctx.stroke();
  if (label) {
    ctx.font = `700 12px ${getFont()}`; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(label, m, y + 7);
  }
  ctx.restore();
}

function carPal() { return S.mode === 'textbook' ? RED : PAL[VR.speed]; }

function drawDynamic(ctx, g, inLens) {
  const m = cur(), v = speed(), pal = carPal();
  const { X, base, carL: u, rulerTop: rt, rulerH: rh } = g;
  const hi = S.quality === 'high';
  // 처음 위치 점선
  ctx.save();
  ctx.setLineDash(inLens ? [1.6, 1.6] : [4, 4]); ctx.strokeStyle = 'rgba(40,50,70,.7)'; ctx.lineWidth = inLens ? 0.6 : 1.4;
  ctx.beginPath(); ctx.moveTo(X(0), base - u * 0.62); ctx.lineTo(X(0), rt); ctx.stroke();
  ctx.restore();
  // 잔상 (0초 ~ 지난 정수 초)
  const lastK = Math.floor(m.t + EPS);
  for (let k = 0; k <= Math.min(lastK, T_MAX); k++) {
    if (k === 0 && m.t < 0.001) continue;
    const xr = X(v * k);
    drawCar(ctx, xr, base, u, pal, { alpha: 0.2 + 0.08 * k, shadow: false });
    ctx.save();
    ctx.setLineDash(inLens ? [1, 1.2] : [3, 3]); ctx.strokeStyle = 'rgba(60,40,30,.45)'; ctx.lineWidth = inLens ? 0.5 : 1;
    ctx.beginPath(); ctx.moveTo(xr, base - u * 0.27); ctx.lineTo(xr, rt); ctx.stroke();
    ctx.restore();
  }
  // 움직이는 동안 잔상 꼬리
  const xNow = X(v * m.t);
  if (S.playing && hi && !inLens) {
    for (let i = 3; i >= 1; i--) drawCar(ctx, xNow - i * u * 0.07, base, u, pal, { alpha: 0.06, shadow: false });
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const y = base - u * (0.14 + i * 0.08), len = u * (0.18 + 0.06 * ((i + 1) % 2));
      ctx.beginPath(); ctx.moveTo(xNow - 6 - len, y); ctx.lineTo(xNow - 6, y); ctx.stroke();
    }
    ctx.restore();
  }
  // 자동차
  drawCar(ctx, xNow, base, u, pal, { wheelA: (v * m.t * g.ppc) / (0.105 * u), shadow: true });
  // 찰칵 빛
  for (const f of S.flashes) {
    const a = 1 - f.age / 0.45;
    if (a <= 0) continue;
    const cx = X(f.cm) + u / 2, cy = base - u * 0.22;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, u * 0.9);
    rg.addColorStop(0, `rgba(255,255,255,${0.85 * a})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(cx - u, cy - u, u * 2, u * 2);
  }
  if (inLens) return;
  // 잔상 꼬리표
  for (let k = 0; k <= Math.min(lastK, T_MAX); k++) {
    if (k === 0 && m.t < 0.001) continue;
    pill(ctx, X(v * k) + u / 2, base - u * 0.43 - 13, `${k}초`, pal.lo);
  }
  // 처음 위치 글자
  ctx.save();
  ctx.font = `700 12px ${getFont()}`; ctx.fillStyle = '#2b3447'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('처음 위치', X(0), rt + rh + 5);
  ctx.restore();
  // 괄호: 표 2 힌트(구간) / 넓이 보기(0~거리)
  const by = rt + rh + 24;
  if (S.mode === 'textbook' && TB.bracket != null) {
    const i = TB.bracket;
    bracket(ctx, X(V_TEXT * i), X(V_TEXT * (i + 1)), by, '#e07a1f', `${i}초~${i + 1}초 구간`);
  }
  if (S.area.on && areaAvail()) {
    const d = v * S.area.shown;
    bracket(ctx, X(0), X(d), by + (S.mode === 'textbook' && TB.bracket != null ? 22 : 0), '#1f9a55',
      S.mode === 'vary' ? `${r1(d)} cm` : '');
  }
}

function drawNote(ctx, g) {
  const top = 44, bottom = g.tableBack - 10;
  if (bottom - top < 34) return;
  const text = S.mode === 'textbook'
    ? (TB.t < 1 && !TB.ran4
      ? '▶ 출발을 누르면 1초마다 자동차의 흐린 자국(잔상)이 남아요.'
      : '잔상(흐린 자국)의 뒤 끝을 확대경으로 읽어 표에 써 보세요.')
    : '속력을 바꿔 가며 달려 보고, 그래프 선의 기울기와 높이를 비교해 보세요.';
  ctx.save();
  ctx.font = `600 13px ${getFont()}`;
  const w = Math.min(g.W - 40, ctx.measureText(text).width + 36), h = 32;
  const cx = g.W / 2, cy = top + Math.min(26, (bottom - top) / 2);
  ctx.translate(cx, cy); ctx.rotate(-0.012);
  if (S.quality === 'high') { ctx.shadowColor = 'rgba(40,50,80,.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; }
  ctx.fillStyle = '#fffbe6'; roundRect(ctx, -w / 2, -h / 2, w, h, 6); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#ecd98f'; ctx.lineWidth = 1; ctx.stroke();
  const pg = ctx.createRadialGradient(-1, -h / 2 - 1, 0, 0, -h / 2, 6);
  pg.addColorStop(0, '#ff9c8f'); pg.addColorStop(1, '#c73a2c');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, -h / 2, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a4128'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 2, w - 20);
  ctx.restore();
}

function drawTopBar(ctx, g) {
  const { W, mL } = g;
  // 이동 방향
  ctx.save();
  const y = 20;
  ctx.font = `700 13px ${getFont()}`; ctx.fillStyle = '#2b3447'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('이동 방향', mL, y);
  const tx = mL + ctx.measureText('이동 방향').width + 10;
  ctx.strokeStyle = '#2b3447'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(tx, y); ctx.lineTo(tx + 60, y); ctx.stroke();
  ctx.fillStyle = '#2b3447'; ctx.beginPath(); ctx.moveTo(tx + 70, y); ctx.lineTo(tx + 58, y - 7); ctx.lineTo(tx + 58, y + 7); ctx.closePath(); ctx.fill();
  let lx = tx + 96;
  // 시계
  const m = cur();
  const txt = `${f1(m.t)} s`;
  ctx.font = `800 17px ${getFont()}`;
  const tw = Math.max(64, ctx.measureText(txt).width + 30);
  const bx = W - 12 - tw;
  ctx.fillStyle = 'rgba(28,36,54,.88)'; roundRect(ctx, bx, 6, tw, 28, 8); ctx.fill();
  ctx.fillStyle = S.playing ? '#7cf0b0' : '#ffffff'; ctx.textAlign = 'center';
  ctx.fillText(txt, bx + tw / 2, 21);
  ctx.font = `600 12px ${getFont()}`; ctx.fillStyle = '#5b6577'; ctx.textAlign = 'right';
  ctx.fillText('시간', bx - 6, 21);
  // 속력 바꾸기: 선 색 범례
  if (S.mode === 'vary') {
    const list = [...new Set([...VR.history, VR.speed])].sort((a, b) => a - b);
    ctx.font = `600 12px ${getFont()}`; ctx.textAlign = 'left'; ctx.fillStyle = '#5b6577';
    const limit = bx - 50;
    if (lx + 80 < limit) {
      ctx.fillText('그래프 선 색', lx, y); lx += ctx.measureText('그래프 선 색').width + 8;
      for (const sp of list) {
        const label = `${sp} cm/s`;
        const w = ctx.measureText(label).width + 26;
        if (lx + w > limit) break;
        ctx.strokeStyle = PAL[sp].mid; ctx.lineWidth = sp === VR.speed ? 4 : 2.5;
        ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + 16, y); ctx.stroke();
        ctx.fillStyle = sp === VR.speed ? '#1d2433' : '#5b6577';
        ctx.font = `${sp === VR.speed ? 800 : 600} 12px ${getFont()}`;
        ctx.fillText(label, lx + 20, y);
        lx += w + 6;
      }
    }
  }
  ctx.restore();
}

function lensCenter(g) {
  const dy = S.lens.dy == null ? g.rulerH * 0.2 : S.lens.dy;
  return { cx: g.X(S.lens.cm), cy: g.rulerTop + dy };
}

function drawLens(ctx, g) {
  const { cx, cy } = lensCenter(g);
  const R = g.lensR;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#fff'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.translate(cx, cy); ctx.scale(ZOOM, ZOOM); ctx.translate(-cx, -cy);
  drawStatic(ctx, g, true);
  drawDynamic(ctx, g, true);
  ctx.restore();
  // 가운데 기준선
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = 'rgba(31,111,235,.55)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  if (S.quality === 'high') {
    const hg = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, 2, cx - R * 0.2, cy - R * 0.2, R * 1.1);
    hg.addColorStop(0, 'rgba(255,255,255,.45)'); hg.addColorStop(0.35, 'rgba(255,255,255,.06)'); hg.addColorStop(1, 'rgba(120,160,220,.12)');
    ctx.fillStyle = hg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  ctx.restore();
  // 손잡이
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
  const hgd = ctx.createLinearGradient(0, -6, 0, 6);
  hgd.addColorStop(0, '#6a4a2f'); hgd.addColorStop(1, '#3b2614');
  ctx.fillStyle = hgd; roundRect(ctx, R + 2, -6, R * 0.85, 12, 6); ctx.fill();
  ctx.fillStyle = '#8b93a3'; ctx.fillRect(R - 1, -5, 8, 10);
  ctx.restore();
  // 테두리
  ctx.save();
  if (S.quality === 'high') { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; }
  ctx.lineWidth = 7; ctx.strokeStyle = '#3b4352';
  ctx.beginPath(); ctx.arc(cx, cy, R + 3, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.beginPath(); ctx.arc(cx, cy, R + 0.5, Math.PI * 1.05, Math.PI * 1.6); ctx.stroke();
  // 처음 쓰는 학생용 안내
  if (S.magnifierUses === 0) {
    ctx.save();
    ctx.font = `700 12px ${getFont()}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = `700 12px ${getFont()}`;
    const w = ctx.measureText('← 확대경을 끌어 보세요').width + 12;
    const right = cx + R + 14 + w < g.W - 4;
    const tx = right ? cx + R + 12 + w / 2 : cx - R - 12 - w / 2;
    pill(ctx, tx, Math.max(cy + R * 0.35, g.rulerTop + g.rulerH + 16), right ? '← 확대경을 끌어 보세요' : '확대경을 끌어 보세요 →', '#1f6feb');
    ctx.restore();
  }
}

function renderScene() {
  const { W, H, dpr } = fit(cvScene);
  if (!SG || SG.W !== W || SG.H !== H || bgCanvas._q !== S.quality || bgCanvas._dpr !== dpr) {
    SG = sceneGeom(W, H);
    bgCanvas.width = cvScene.width; bgCanvas.height = cvScene.height;
    const b = bgCanvas.getContext('2d');
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStatic(b, SG, false);
    bgCanvas._q = S.quality; bgCanvas._dpr = dpr;
  }
  const ctx = ctxS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bgCanvas, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawNote(ctx, SG);
  drawDynamic(ctx, SG, false);
  drawTopBar(ctx, SG);
  drawLens(ctx, SG);
}

// 확대경 끌기
let lensDrag = null;
cvScene.addEventListener('pointerdown', e => {
  if (isLocked() || !SG) return;
  const r = cvScene.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const { cx, cy } = lensCenter(SG);
  const touch = e.pointerType !== 'mouse';
  const inside = Math.hypot(px - cx, py - cy) <= SG.lensR + 6;
  lensDrag = { ox: touch ? 0 : inside ? cx - px : 0, oy: touch ? -70 : inside ? cy - py : 0, lastCm: Math.floor(S.lens.cm) };
  cvScene.setPointerCapture(e.pointerId);
  cvScene.classList.add('dragging');
  moveLens(px + lensDrag.ox, py + lensDrag.oy);
  e.preventDefault();
});
cvScene.addEventListener('pointermove', e => {
  if (!SG) return;
  const r = cvScene.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  if (!lensDrag) {
    const { cx, cy } = lensCenter(SG);
    cvScene.style.cursor = Math.hypot(px - cx, py - cy) <= SG.lensR + 6 ? 'grab' : 'pointer';
    return;
  }
  moveLens(px + lensDrag.ox, py + lensDrag.oy);
});
const endLens = () => {
  if (!lensDrag) return;
  lensDrag = null; cvScene.classList.remove('dragging');
  S.magnifierUses++; sound.soft(); push(); mark();
};
cvScene.addEventListener('pointerup', endLens);
cvScene.addEventListener('pointercancel', endLens);

function moveLens(cx, cy) {
  const g = SG;
  const cm = clamp((cx - g.mL) / g.ppc, -6, RULER_MAX + 6);
  const yy = clamp(cy, g.lensR * 0.7, g.H - g.lensR * 0.7);
  const fl = Math.floor(cm);
  if (lensDrag && fl !== lensDrag.lastCm) { sound.tick(clamp(cm / RULER_MAX, 0, 1)); lensDrag.lastCm = fl; }
  S.lens.cm = cm; S.lens.dy = yy - g.rulerTop;
  mark();
}

cvScene.addEventListener('keydown', e => {
  if (isLocked()) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    S.lens.cm = clamp(Math.round(S.lens.cm) + (e.key === 'ArrowRight' ? 1 : -1), -6, RULER_MAX + 6);
    sound.tick(clamp(S.lens.cm / RULER_MAX, 0, 1)); mark(); e.preventDefault();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const g = SG; const { cy } = lensCenter(g);
    const yy = clamp(cy + (e.key === 'ArrowDown' ? 4 : -4), g.lensR * 0.7, g.H - g.lensR * 0.7);
    S.lens.dy = yy - g.rulerTop; mark(); e.preventDefault();
  }
});
cvScene.addEventListener('keyup', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !isLocked()) { S.magnifierUses++; push(); }
});

// ── 그래프 ───────────────────────────────────────────
const GC = {
  st: { cv: $('#cvST'), yMax: 120, yGrid: 10, yLabel: 20, yTitle: '이동 거리(cm)', unit: 'cm', msgEl: $('#gmsgST') },
  vt: { cv: $('#cvVT'), yMax: 50, yGrid: 5, yLabel: 10, yTitle: '속력(cm/s)', unit: 'cm/s', msgEl: $('#gmsgVT') },
};
for (const k of ['st', 'vt']) GC[k].ctx = GC[k].cv.getContext('2d');

function gGeom(key, W, H) {
  const c = GC[key];
  const L = 46, R = 40, T = 24, B = 48;
  const pw = Math.max(40, W - L - R), ph = Math.max(40, H - T - B);
  return {
    W, H, L, R, T, B, pw, ph,
    X: t => L + (t / T_MAX) * pw, Y: v => T + ph * (1 - v / c.yMax),
    tOf: x => ((x - L) / pw) * T_MAX, vOf: y => (1 - (y - T) / ph) * c.yMax,
  };
}

const ptKey = p => `${p[0]}_${p[1]}`;
const snapPt = (key, t, v) => [clamp(Math.round(t * 2) / 2, 0, T_MAX), clamp(Math.round(v / 5) * 5, 0, GC[key].yMax)];

function linesFor(key) {
  // 그래프에 그려지는 선의 속력 목록(말풍선 자리 판단용)
  if (S.mode === 'vary') return [...new Set([...VR.history, VR.speed])];
  return (key === 'st' ? TB.stCorrect : TB.vtCorrect) ? [V_TEXT] : [];
}

function drawGraph(key) {
  const c = GC[key], ctx = c.ctx;
  const { W, H, dpr } = fit(c.cv);
  const g = gGeom(key, W, H);
  c.g = g;
  const { L, T, pw, ph, X, Y } = g;
  const F = getFont();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // 바탕·격자
  ctx.fillStyle = '#fbfcfe'; ctx.fillRect(L, T, pw, ph);
  ctx.lineWidth = 1;
  for (let t = 0; t <= T_MAX + EPS; t += 0.5) {
    ctx.strokeStyle = Math.abs(t - Math.round(t)) < EPS ? '#d3dae6' : '#e8edf4';
    ctx.beginPath(); ctx.moveTo(Math.round(X(t)) + 0.5, T); ctx.lineTo(Math.round(X(t)) + 0.5, T + ph); ctx.stroke();
  }
  for (let v = 0; v <= c.yMax + EPS; v += c.yGrid) {
    ctx.strokeStyle = v % c.yLabel === 0 ? '#d3dae6' : '#e8edf4';
    ctx.beginPath(); ctx.moveTo(L, Math.round(Y(v)) + 0.5); ctx.lineTo(L + pw, Math.round(Y(v)) + 0.5); ctx.stroke();
  }
  // 축
  ctx.strokeStyle = '#2b3447'; ctx.fillStyle = '#2b3447'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(L, T + ph); ctx.lineTo(L + pw + 14, T + ph); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(L + pw + 20, T + ph); ctx.lineTo(L + pw + 12, T + ph - 4.5); ctx.lineTo(L + pw + 12, T + ph + 4.5); ctx.fill();
  ctx.beginPath(); ctx.moveTo(L, T + ph); ctx.lineTo(L, T - 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(L, T - 16); ctx.lineTo(L - 4.5, T - 8); ctx.lineTo(L + 4.5, T - 8); ctx.fill();
  ctx.font = `600 12px ${F}`; ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let v = c.yLabel; v <= c.yMax + EPS; v += c.yLabel) ctx.fillText(String(v), L - 6, Y(v));
  ctx.textAlign = 'center';
  for (let t = 0; t <= T_MAX; t++) ctx.fillText(String(t), X(t), T + ph + 12);
  ctx.textAlign = 'left'; ctx.font = `700 12px ${F}`;
  ctx.fillText(c.yTitle, L + 8, T - 12);
  ctx.textAlign = 'left';
  ctx.fillText('시간', L + pw + 8, T + ph - 14);
  ctx.fillText('(s)', L + pw + 8, T + ph + 13);

  const m = cur(), v = speed();
  // 활동 길잡이: 시간 구간의 가운데
  if (key === 'vt' && S.mode === 'textbook' && TB.vtHint) {
    ctx.fillStyle = 'rgba(31,111,235,.08)'; ctx.fillRect(X(0), T, X(1) - X(0), ph);
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(31,111,235,.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(0.5), T); ctx.lineTo(X(0.5), T + ph); ctx.stroke(); ctx.restore();
    ctx.font = `700 12px ${F}`; ctx.fillStyle = '#1f5fc7'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('시간 구간의 가운데', X(0.5) + 5, T + ph - 18);
  }
  // 넓이 보기
  const aOn = key === 'vt' && S.area.on && areaAvail();
  if (aOn) {
    const ts = S.area.shown;
    const x0 = X(0), x1 = X(ts), y0 = Y(0), y1 = Y(v);
    ctx.fillStyle = 'rgba(46,170,90,.18)'; ctx.fillRect(x0, y1, x1 - x0, y0 - y1);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y1, x1 - x0, y0 - y1); ctx.clip();
    ctx.strokeStyle = 'rgba(30,140,70,.6)'; ctx.lineWidth = 1.4;
    for (let d = -ph; d < pw + ph; d += 8) { ctx.beginPath(); ctx.moveTo(x0 + d, y0); ctx.lineTo(x0 + d + (y0 - y1), y1); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#1e8c46'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y1, x1 - x0, y0 - y1);
  }
  // 선
  ctx.lineCap = 'round';
  const line = (sp, t1, w, alpha, col) => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath();
    if (key === 'st') { ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(t1), Y(sp * t1)); }
    else { ctx.moveTo(X(0), Y(sp)); ctx.lineTo(X(t1), Y(sp)); }
    ctx.stroke(); ctx.restore();
  };
  if (S.mode === 'vary') {
    for (const sp of VR.history) if (sp !== VR.speed) line(sp, T_MAX, 2.2, 0.45, PAL[sp].mid);
    ctx.save(); ctx.setLineDash([6, 5]); line(VR.speed, T_MAX, 2, 0.35, PAL[VR.speed].mid); ctx.restore();
    if (m.t > 0) line(VR.speed, m.t, 3.4, 1, PAL[VR.speed].mid);
    // 정수 초·구간 가운데 점
    ctx.fillStyle = PAL[VR.speed].mid;
    if (key === 'st') for (let k = 0; k <= Math.floor(m.t + EPS); k++) dot(ctx, X(k), Y(VR.speed * k), 4.5, PAL[VR.speed].mid);
    else for (let k = 0; k + 1 <= m.t + EPS; k++) dot(ctx, X(k + 0.5), Y(VR.speed), 4.5, PAL[VR.speed].mid);
  } else {
    const ok = key === 'st' ? TB.stCorrect : TB.vtCorrect;
    const an = ease.outCubic(key === 'st' ? TB.stAnim : TB.vtAnim);
    if (ok) line(V_TEXT, T_MAX * an, 3, 1, RED.mid);
  }
  // 지금 시각 세로선
  if (m.t > 0.001) {
    const x = X(m.t);
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(70,85,115,.75)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'rgba(70,85,115,.85)';
    ctx.beginPath(); ctx.moveTo(x - 5, T - 1); ctx.lineTo(x + 5, T - 1); ctx.lineTo(x, T + 6); ctx.fill();
  }
  // 기울기 보기
  const sOn = key === 'st' && S.slope.on && slopeAvail();
  if (sOn) {
    const a = ease.outCubic(S.slope.anim);
    const { T1, T2 } = S.slope;
    const s1 = v * T1, s2 = v * T2;
    const xa = X(T1), xb = X(T1 + (T2 - T1) * a), ya = Y(s1), yb = Y(s1 + (s2 - s1) * a);
    ctx.fillStyle = 'rgba(255,196,0,.16)';
    ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(X(T2), ya); ctx.lineTo(X(T2), yb); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#1f6feb';
    ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, ya); ctx.stroke();
    ctx.strokeStyle = '#e8790c';
    ctx.beginPath(); ctx.moveTo(X(T2), ya); ctx.lineTo(X(T2), yb); ctx.stroke();
    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(40,50,70,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xa, T + ph); ctx.moveTo(X(T2), ya); ctx.lineTo(X(T2), T + ph); ctx.stroke(); ctx.restore();
    if (a > 0.98) {
      ctx.font = `800 12px ${F}`; ctx.textBaseline = 'top'; ctx.textAlign = 'center'; ctx.fillStyle = '#1f5fc7';
      ctx.fillText(`${T2 - T1} s`, (xa + X(T2)) / 2, ya + 4);
      const lab = `${r1(s2 - s1)} ${c.unit}`;
      ctx.fillStyle = '#b55a00'; ctx.textBaseline = 'middle';
      const lw = ctx.measureText(lab).width;
      if (X(T2) + 6 + lw < W - 2) { ctx.textAlign = 'left'; ctx.fillText(lab, X(T2) + 6, (ya + yb) / 2); }
      else { ctx.textAlign = 'right'; ctx.fillText(lab, X(T2) - 6, (ya + yb) / 2 + 10); }
    }
    dot(ctx, X(T1), Y(s1), 5, '#1d2433'); dot(ctx, X(T2), Y(s2), 5, '#1d2433');
  }
  // 학생 점 (교과서 실험)
  if (S.mode === 'textbook') {
    const pts = key === 'st' ? TB.st : TB.vt, marks = key === 'st' ? TB.stMarks : TB.vtMarks;
    for (const p of pts) {
      const mk = marks && marks[ptKey(p)];
      const col = mk === 'ok' ? '#23a466' : mk ? '#f08c3a' : '#1f6feb';
      dot(ctx, X(p[0]), Y(p[1]), 6, col, true);
    }
  }
  // 미리보기(마우스)·키보드 커서
  const st = G[key];
  const ghost = st.cursor || st.hover;
  if (ghost && S.mode === 'textbook' && !st.drag) {
    const [t, vv] = ghost;
    ctx.save();
    ctx.strokeStyle = st.erase ? '#c0392b' : '#1f6feb'; ctx.lineWidth = 1.6; ctx.setLineDash(st.cursor ? [] : [3, 2]);
    ctx.beginPath(); ctx.arc(X(t), Y(vv), 8, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    const lab = `(${t.toFixed(1)} s, ${vv} ${c.unit})`;
    ctx.font = `600 12px ${F}`; ctx.textBaseline = 'bottom';
    const lw = ctx.measureText(lab).width;
    const lx = clamp(X(t) + 10, L + 2, L + pw - lw - 2), ly = Y(vv) - 10 < T + 14 ? Y(vv) + 26 : Y(vv) - 10;
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(lx - 3, ly - 15, lw + 6, 16);
    ctx.fillStyle = '#2b3447'; ctx.textAlign = 'left'; ctx.fillText(lab, lx, ly);
  }
  // 손잡이
  if (sOn) { handle(ctx, g, S.slope.T1, '처음', '#1f6feb'); handle(ctx, g, S.slope.T2, '나중', '#1f6feb'); }
  if (aOn) handle(ctx, g, S.area.T, '시간', '#1e8c46');
  // 말풍선
  st.fallback = '';
  if (sOn && S.slope.anim > 0.98) {
    const { T1, T2 } = S.slope;
    const ds = r1(v * (T2 - T1)), dt = T2 - T1, sl = r1(ds / dt);
    const full = ['기울기 = 세로축 값 변화량 ÷ 가로축 값 변화량', `= ${ds} cm ÷ ${dt} s = ${sl} cm/s`];
    const mid = ['기울기 = 세로축 값 변화량 ÷ 가로축 값 변화량', `= ${ds} cm ÷ ${dt} s`, `= ${sl} cm/s`];
    const compact = [`기울기 = ${ds} cm ÷ ${dt} s = ${sl} cm/s`];
    if (!bubble(ctx, g, key, [full, mid, compact], 'left')) st.fallback = `기울기 = 세로축 값 변화량 ${ds} cm ÷ 가로축 값 변화량 ${dt} s = ${sl} cm/s`;
  }
  if (aOn && Math.abs(S.area.shown - S.area.T) < 0.02) {
    const Tt = S.area.T, ar = r1(v * Tt);
    const full = [`넓이 = 속력 ${v} cm/s × 시간 ${Tt} s`, `= ${ar} cm`];
    const compact = [`넓이 = ${v} cm/s × ${Tt} s = ${ar} cm`];
    if (!bubble(ctx, g, key, [full, compact], 'right')) st.fallback = `넓이 = 속력 ${v} cm/s × 시간 ${Tt} s = ${ar} cm`;
  }
  showGmsg(key);
}

function dot(ctx, x, y, r, col, ring) {
  ctx.save();
  if (ring && S.quality === 'high') { ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1; }
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  if (ring) { ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.stroke(); }
  ctx.restore();
}

function handle(ctx, g, t, label, col) {
  const x = g.X(t), y = g.T + g.ph + 33;
  ctx.save();
  if (S.quality === 'high') { ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1; }
  ctx.fillStyle = col;
  ctx.font = `700 11px ${getFont()}`;
  const w = Math.max(30, ctx.measureText(label).width + 12);
  roundRect(ctx, x - w / 2, y - 9, w, 18, 9); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 5, y - 8); ctx.lineTo(x, y - 14); ctx.lineTo(x + 5, y - 8); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 0.5);
  ctx.restore();
}

// 말풍선: 선·점을 가리지 않는 자리에만 그림. 자리가 없으면 false
function bubble(ctx, g, key, variants, side) {
  const F = getFont();
  const sps = linesFor(key).concat([speed()]);
  const vmax = Math.max(...sps);
  for (const lines of variants) {
    ctx.font = `700 12.5px ${F}`;
    const w = Math.max(...lines.map(s => ctx.measureText(s).width)) + 16;
    const h = lines.length * 17 + 8;
    if (w > g.pw - 8) continue;
    const x = side === 'left' ? g.L + 6 : g.L + g.pw - w - 6, y = g.T + 4;
    let ok;
    if (key === 'st') {
      const tR = g.tOf(x + w);
      ok = g.Y(vmax * Math.min(tR, T_MAX)) > y + h + 4;
    } else ok = g.Y(vmax) > y + h + 4;
    if (!ok) continue;
    ctx.save();
    if (S.quality === 'high') { ctx.shadowColor = 'rgba(20,30,60,.18)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; }
    ctx.fillStyle = key === 'st' ? '#fffaf0' : '#f2fbf5';
    ctx.strokeStyle = key === 'st' ? '#e6b94a' : '#6cc191'; ctx.lineWidth = 1.3;
    roundRect(ctx, x, y, w, h, 8); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
    ctx.fillStyle = '#1d2433'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    lines.forEach((s, i) => ctx.fillText(s, x + 8, y + 5 + i * 17));
    ctx.restore();
    return true;
  }
  return false;
}

function setGmsg(key, text, cls = '') { G[key].msg = [text, cls]; showGmsg(key); }
function showGmsg(key) {
  const el = GC[key].msgEl, st = G[key];
  const varyMsg = key === 'st' ? '속력마다 선의 기울기를 비교해 보세요.' : '속력마다 선의 높이와 아랫부분 넓이를 비교해 보세요.';
  const [text, cls] = st.fallback ? [st.fallback, ''] : S.mode === 'vary' ? [varyMsg, ''] : st.msg;
  if (el.textContent !== text) el.textContent = text;
  el.className = 'gmsg' + (cls ? ' ' + cls : '');
}

// 그래프 조작
function gPos(key, e) {
  const r = GC[key].cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function liveG(key) {
  const r = GC[key].cv.getBoundingClientRect();
  return (GC[key].g = gGeom(key, r.width, r.height));
}
function hitHandle(key, x, y) {
  const g = liveG(key);
  const hy = g.T + g.ph + 33;
  if (Math.abs(y - hy) > 16) return null;
  const cands = [];
  if (key === 'st' && S.slope.on && slopeAvail()) cands.push(['T1', S.slope.T1], ['T2', S.slope.T2]);
  if (key === 'vt' && S.area.on && areaAvail()) cands.push(['T', S.area.T]);
  let best = null, bd = 22;
  for (const [n, t] of cands) { const d = Math.abs(g.X(t) - x); if (d < bd) { bd = d; best = n; } }
  return best;
}
function setHandle(key, name, t) {
  t = Math.round(t);
  if (key === 'st') {
    if (name === 'T1') t = clamp(t, 0, S.slope.T2 - 1); else t = clamp(t, S.slope.T1 + 1, T_MAX);
    if (S.slope[name] !== t) { S.slope[name] = t; sound.tick(t / T_MAX); updateTools(); }
  } else {
    t = clamp(t, 1, T_MAX);
    if (S.area.T !== t) { const d = Math.abs(t - S.area.T); S.area.T = t; sound.swish(0.12 + d * 0.12); updateTools(); }
  }
  mark();
}

for (const key of ['st', 'vt']) {
  const cv = GC[key].cv;
  cv.addEventListener('pointerdown', e => {
    if (isLocked()) return;
    const [x, y] = gPos(key, e);
    const h = hitHandle(key, x, y);
    if (h) { G[key].drag = h; cv.setPointerCapture(e.pointerId); e.preventDefault(); mark(); return; }
    if (S.mode !== 'textbook') return;
    const g = liveG(key);
    if (x < g.L - 10 || x > g.L + g.pw + 10 || y < g.T - 10 || y > g.T + g.ph + 8) return;
    togglePoint(key, snapPt(key, g.tOf(x), g.vOf(y)), [x, y]);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    const [x, y] = gPos(key, e);
    const st = G[key], g = liveG(key);
    if (st.drag) { setHandle(key, st.drag, g.tOf(x)); return; }
    if (e.pointerType === 'mouse') {
      const inPlot = x >= g.L - 10 && x <= g.L + g.pw + 10 && y >= g.T - 10 && y <= g.T + g.ph + 8;
      const hv = inPlot && S.mode === 'textbook' ? snapPt(key, g.tOf(x), g.vOf(y)) : null;
      const h = hitHandle(key, x, y);
      cv.style.cursor = h ? 'ew-resize' : inPlot && S.mode === 'textbook' ? 'crosshair' : 'default';
      if (String(hv) !== String(st.hover)) { st.hover = hv; mark(); }
    }
  });
  const up = () => { if (G[key].drag) { G[key].drag = null; push(); mark(); } };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { if (G[key].hover) { G[key].hover = null; mark(); } });
  cv.addEventListener('focus', () => { if (S.mode === 'textbook' && !G[key].cursor) { G[key].cursor = [0, 0]; mark(); } });
  cv.addEventListener('blur', () => { G[key].cursor = null; mark(); });
  cv.addEventListener('keydown', e => {
    if (isLocked()) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const st = G[key];
    if (arrows[e.key]) {
      const [dx, dy] = arrows[e.key];
      if (e.shiftKey || e.altKey) {
        if (dx) {
          if (key === 'st' && S.slope.on && slopeAvail()) { const n = e.altKey ? 'T1' : 'T2'; setHandle(key, n, S.slope[n] + dx); push(); }
          if (key === 'vt' && S.area.on && areaAvail()) { setHandle(key, 'T', S.area.T + dx); push(); }
        }
      } else if (S.mode === 'textbook') {
        const c = st.cursor || [0, 0];
        st.cursor = snapPt(key, c[0] + dx * 0.5, c[1] + dy * 5); mark();
      }
      e.preventDefault(); e.stopPropagation();
    } else if ((e.key === 'Enter' || e.key === ' ') && S.mode === 'textbook') {
      togglePoint(key, st.cursor || [0, 0]);
      e.preventDefault(); e.stopPropagation();
    }
  });
}

function togglePoint(key, p, px) {
  const pts = key === 'st' ? TB.st : TB.vt;
  const st = G[key], g = liveG(key);
  let idx = pts.findIndex(q => q[0] === p[0] && q[1] === p[1]);
  if (st.erase && idx < 0 && px) {      // 지우기: 가까운 점
    let bd = 16;
    pts.forEach((q, i) => { const d = Math.hypot(g.X(q[0]) - px[0], g.Y(q[1]) - px[1]); if (d < bd) { bd = d; idx = i; } });
  }
  if (idx >= 0) { pts.splice(idx, 1); sound.softLow(); }
  else if (st.erase) { sound.softLow(); setGmsg(key, '지울 점을 눌러요. 점을 찍으려면 [점 찍기]를 눌러요.'); return; }
  else if (pts.length >= 9) { sound.soft(); setGmsg(key, '점은 9개까지 찍을 수 있어요. 필요 없는 점을 지워 보세요.', 'fix'); return; }
  else { pts.push(p); pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]); sound.soft(); }
  // 점이 바뀌면 이전 확인 결과는 지움
  if (key === 'st') { TB.stMarks = null; TB.stCorrect = false; }
  else { TB.vtMarks = null; TB.vtCorrect = false; TB.vtHint = false; }
  setGmsg(key, '');
  updateTools(); updateSteps(); push(); mark();
}

function checkGraph(key) {
  S.graphChecks++;
  const pts = key === 'st' ? TB.st : TB.vt;
  const targets = key === 'st' ? [0, 1, 2, 3, 4].map(k => [k, V_TEXT * k]) : [0.5, 1.5, 2.5, 3.5].map(t => [t, V_TEXT]);
  const tset = new Set(targets.map(ptKey));
  const marks = {};
  let intCount = 0, bad = 0;
  for (const p of pts) {
    const k = ptKey(p);
    if (tset.has(k)) marks[k] = 'ok';
    else { marks[k] = 'bad'; bad++; if (key === 'vt' && Number.isInteger(p[0])) intCount++; }
  }
  const have = targets.filter(t => pts.some(p => ptKey(p) === ptKey(t))).length;
  const correct = have === targets.length && pts.length === targets.length;
  if (key === 'st') { TB.stMarks = marks; TB.stCorrect = correct; }
  else { TB.vtMarks = marks; TB.vtCorrect = correct; S.vtIntegerMistakes += intCount; TB.vtHint = intCount > 0; }
  if (!pts.length) { setGmsg(key, '먼저 그래프 칸을 눌러 점을 찍어 보세요.'); sound.soft(); }
  else if (correct) {
    if (key === 'st') { TB.stUnlocked = true; TB.stAnim = 0; } else { TB.vtUnlocked = true; TB.vtAnim = 0; }
    setGmsg(key, `맞았어요! 점을 이은 선이 그려져요. 이제 [${key === 'st' ? '기울기' : '넓이'} 보기]를 눌러 보세요.`, 'good');
    sound.ding(); setTimeout(() => sound.swish(0.6), 180);
  } else {
    let t;
    if (key === 'vt' && intCount) t = '구간의 평균 속력은 시간 구간의 가운데(0.5 s, 1.5 s …)에 찍어요. 주황색 점을 옮겨 보세요.';
    else if (bad) t = key === 'st' ? '주황색 점을 다시 살펴보세요. 표 1의 (시간, 이동 거리)를 찍어요.' : '주황색 점을 다시 살펴보세요. 표 2의 속력을 찍어요.';
    else t = key === 'st' ? '빠진 점이 있어요. 표 1의 칸마다 점이 하나씩 있어야 해요.' : '빠진 점이 있어요. 시간 구간마다 점이 하나씩 있어야 해요.';
    setGmsg(key, t, 'fix'); sound.soft();
  }
  updateTools(); updateSteps(); push(); mark();
}

// ── 표 ──────────────────────────────────────────────
const cells = [...document.querySelectorAll('.cell')];
const cellArr = c => (c.dataset.t === '1' ? TB.table1 : c.dataset.t === '2d' ? TB.table2Dist : TB.table2Speed);
const markArr = c => (c.dataset.t === '1' ? TB.m1 : c.dataset.t === '2d' ? TB.m2d : TB.m2s);
const msgEl = { 1: $('#msg1'), 2: $('#msg2') };

function renderTables() {
  const vary = S.mode === 'vary';
  for (const c of cells) {
    const i = +c.dataset.i;
    c.readOnly = vary;
    c.tabIndex = vary ? -1 : 0;
    c.classList.remove('ok', 'fix');
    if (vary) {
      const v = VR.speed, t = VR.t;
      let val = '';
      if (c.dataset.t === '1') { if (t + EPS >= i) val = String(v * i); }
      else if (t + EPS >= i + 1) val = String(v);
      c.value = val;
    } else {
      const a = cellArr(c)[i];
      if (document.activeElement !== c) c.value = a == null ? '' : String(a);
      const mk = markArr(c)[i];
      if (mk) c.classList.add(mk);
    }
  }
  for (const n of [1, 2]) {
    const [text, cls] = vary ? ['', ''] : TB['msg' + n];
    msgEl[n].textContent = text; msgEl[n].className = 'tmsg' + (cls ? ' ' + cls : '');
  }
}

cells.forEach((c, idx) => {
  c.addEventListener('input', () => {
    if (S.mode === 'vary') return;
    const digits = c.value.replace(/[^0-9]/g, '').slice(0, 3);
    if (digits !== c.value) c.value = digits;
    const i = +c.dataset.i;
    cellArr(c)[i] = digits === '' ? null : clamp(parseInt(digits, 10), 0, 150);
    markArr(c)[i] = null; c.classList.remove('ok', 'fix');
    push();
  });
  c.addEventListener('change', () => { const a = cellArr(c)[+c.dataset.i]; if (a != null) c.value = String(a); });
  c.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = cells[idx + 1];
      if (next) { next.focus(); next.select(); }
      else c.blur();
      sound.record();
    }
  });
  c.addEventListener('focus', () => { if (!c.readOnly) c.select(); });
});

function checkTable1() {
  S.tableChecks++;
  let ok = 0, empty = 0;
  for (let i = 0; i < 5; i++) {
    const v = TB.table1[i];
    if (v == null) { TB.m1[i] = 'fix'; empty++; continue; }
    TB.m1[i] = Math.abs(v - V_TEXT * i) <= 1 ? 'ok' : 'fix';
    if (TB.m1[i] === 'ok') ok++;
  }
  TB.table1Correct = ok;
  if (ok === 5) { TB.msg1 = ['표 1 완성! 이제 표 2를 채워 보세요.', 'good']; sound.ding(); }
  else {
    const pre = TB.ran4 ? '' : '먼저 자동차를 4초까지 달리게 해 보세요. ';
    TB.msg1 = [pre + (empty === 5 - ok ? '빈칸을 채워 보세요.' : '주황색 칸은 확대경을 잔상의 뒤 끝에 대고 처음 위치(0 cm)부터 다시 읽어 보세요.'), 'fix'];
    sound.soft();
  }
  renderTables(); updateSteps(); push(); mark();
}

function checkTable2() {
  S.tableChecks++;
  let ok = 0, cumul = 0, firstCumul = null, speedBad = 0, empty = 0;
  for (let i = 0; i < 4; i++) {
    const d = TB.table2Dist[i], s = TB.table2Speed[i];
    if (d == null) { TB.m2d[i] = 'fix'; empty++; }
    else if (Math.abs(d - V_TEXT) <= 1) { TB.m2d[i] = 'ok'; ok++; }
    else {
      TB.m2d[i] = 'fix';
      const t1 = TB.table1[i + 1];
      if (d === V_TEXT * (i + 1) || (t1 != null && d === t1)) { cumul++; if (firstCumul == null) firstCumul = i; }
    }
    if (s == null) { TB.m2s[i] = 'fix'; empty++; }
    else if (d != null && s === d) { TB.m2s[i] = 'ok'; ok++; }
    else { TB.m2s[i] = 'fix'; speedBad++; }
  }
  S.cumulativeMistakes += cumul;
  TB.table2Correct = ok;
  TB.bracket = firstCumul;
  if (ok === 8) { TB.msg2 = ['표 2 완성! 이제 두 그래프에 점을 찍어 보세요.', 'good']; sound.ding(); }
  else {
    let t;
    if (cumul) t = '구간 이동 거리 = 나중 위치 − 처음 위치예요. 장면의 주황색 괄호 구간을 보세요.';
    else if (empty) t = '빈칸을 채워 보세요.';
    else if (speedBad) t = '속력 = 그 구간의 이동 거리 ÷ 걸린 시간(1 s)이에요.';
    else t = '주황색 칸은 두 잔상의 뒤 끝 사이 거리를 다시 읽어 보세요.';
    TB.msg2 = [t, 'fix']; sound.soft();
  }
  renderTables(); updateSteps(); push(); mark();
}

// ── 조작줄 ───────────────────────────────────────────
const btnPlay = $('#btnPlay'), btnStep = $('#btnStep'), timeRange = $('#timeRange'), timeOut = $('#timeOut');
const speedRange = $('#speedRange'), speedOut = $('#speedOut'), distOut = $('#distOut');
let engine = null;

function startEngine() { if (!engine) engine = sound.engine((speed() - 10) / 20); }
function stopEngine() { if (engine) { engine.stop(); engine = null; } }

function play() {
  if (isLocked()) return;
  const m = cur();
  if (S.playing) { pause(); sound.soft(); return; }
  if (m.t >= T_MAX - EPS) { m.t = 0; }
  if (m.t < EPS) { S.runs++; sound.vroom(); snapshot(0); }
  S.stopAt = T_MAX; S.playing = true; startEngine();
  updateCtrl(); push(); mark();
}
function stepOnce() {
  if (isLocked()) return;
  const m = cur();
  if (m.t >= T_MAX - EPS) { m.t = 0; renderTables(); }
  if (m.t < EPS) { snapshot(0); sound.vroom(); }
  S.stopAt = Math.min(T_MAX, Math.floor(m.t + EPS) + 1);
  S.playing = true; startEngine();
  updateCtrl(); push(); mark();
}
function pause() { S.playing = false; stopEngine(); updateCtrl(); push(); mark(); }

function snapshot(k) {
  S.flashes.push({ cm: speed() * k, age: 0 });
  sound.shutter();
}

function reach4() {
  if (S.mode === 'textbook') TB.ran4 = true;
  else {
    VR.history = VR.history.filter(s => s !== VR.speed); VR.history.push(VR.speed);
    if (!VR.variedSpeeds.includes(VR.speed)) VR.variedSpeeds = [...VR.variedSpeeds, VR.speed].sort((a, b) => a - b);
  }
  updateSteps();
}

function updateCtrl() {
  const m = cur();
  btnPlay.textContent = S.playing ? '⏸ 일시정지' : m.t < EPS ? '▶ 출발' : m.t >= T_MAX - EPS ? '▶ 다시 출발' : '▶ 계속';
  btnPlay.setAttribute('aria-label', btnPlay.textContent.replace(/^[^ ]+ /, ''));
  btnStep.disabled = S.playing;
  if (+timeRange.value !== r1(m.t)) timeRange.value = String(r1(m.t));
  timeOut.textContent = `${f1(m.t)} s`;
  speedOut.textContent = `${VR.speed} cm/s`;
  distOut.textContent = `${f1(VR.speed * r1(VR.t))} cm`;
}

btnPlay.addEventListener('click', play);
btnStep.addEventListener('click', stepOnce);
timeRange.addEventListener('input', () => {
  if (isLocked()) return;
  const m = cur();
  if (S.playing) { S.playing = false; stopEngine(); }
  const old = m.t;
  m.t = clamp(+timeRange.value, 0, T_MAX);
  if (Math.floor(old + EPS) !== Math.floor(m.t + EPS)) sound.tick(m.t / T_MAX);
  if (m.t >= T_MAX - EPS) reach4();
  if (S.mode === 'vary') renderTables();
  updateCtrl(); push(); mark();
});
speedRange.addEventListener('input', () => {
  if (isLocked()) return;
  const v = clamp(Math.round(+speedRange.value / 5) * 5, 10, 30);
  if (v === VR.speed) return;
  VR.speed = v; VR.t = 0;
  if (S.playing) { S.playing = false; stopEngine(); }
  S.flashes = [];
  sound.tick((v - 10) / 20);
  renderTables(); updateTools(); updateCtrl(); push(); mark();
});

// 탭
const tabs = { textbook: $('#tabTextbook'), vary: $('#tabVary') };
function setMode(mode) {
  if (S.mode === mode) {           // 이미 고른 탭: 살짝 흔들어 알려 줌
    const b = tabs[mode]; b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
    sound.click(); return;
  }
  if (S.playing) { S.playing = false; stopEngine(); }
  S.mode = mode; S.flashes = [];
  document.body.classList.toggle('mode-vary', mode === 'vary');
  for (const k in tabs) tabs[k].setAttribute('aria-pressed', String(k === mode));
  for (const k of ['st', 'vt']) { G[k].hover = null; G[k].cursor = null; }
  sound.whoosh();
  renderTables(); updateTools(); updateCtrl(); push(); mark();
  SG = null;
}
tabs.textbook.addEventListener('click', () => setMode('textbook'));
tabs.vary.addEventListener('click', () => setMode('vary'));

// 그래프 도구 버튼
function setErase(key, on) {
  G[key].erase = on;
  $(`#${key}Draw`).setAttribute('aria-pressed', String(!on));
  $(`#${key}Erase`).setAttribute('aria-pressed', String(on));
  sound.click(); mark();
}
for (const key of ['st', 'vt']) {
  $(`#${key}Draw`).addEventListener('click', () => setErase(key, false));
  $(`#${key}Erase`).addEventListener('click', () => setErase(key, true));
  $(`#${key}Check`).addEventListener('click', () => checkGraph(key));
  const up = key.toUpperCase();
  const conf = $(`#confirm${up}`);
  $(`#${key}Clear`).addEventListener('click', () => { conf.hidden = false; sound.click(); });
  $(`#no${up}`).addEventListener('click', () => { conf.hidden = true; sound.click(); });
  $(`#yes${up}`).addEventListener('click', () => {
    conf.hidden = true;
    if (key === 'st') { TB.st = []; TB.stMarks = null; TB.stCorrect = false; }
    else { TB.vt = []; TB.vtMarks = null; TB.vtCorrect = false; TB.vtHint = false; }
    setGmsg(key, '점을 모두 지웠어요.'); sound.softLow();
    updateTools(); updateSteps(); push(); mark();
  });
}
$('#stSlope').addEventListener('click', () => {
  S.slope.on = !S.slope.on;
  if (S.slope.on) { S.slope.anim = 0; S.slope.used = true; sound.rise(); } else sound.soft();
  updateTools(); push(); mark();
});
$('#vtArea').addEventListener('click', () => {
  S.area.on = !S.area.on;
  if (S.area.on) { S.area.shown = 0; S.area.used = true; sound.swish(0.2 + S.area.T * 0.12); } else sound.soft();
  updateTools(); push(); mark();
});
for (const n of [1, 2]) {
  const conf = $(`#confirm${n}`);
  $(`#btnCheck${n}`).addEventListener('click', n === 1 ? checkTable1 : checkTable2);
  $(`#btnClear${n}`).addEventListener('click', () => { conf.hidden = false; sound.click(); });
  $(`#no${n}`).addEventListener('click', () => { conf.hidden = true; sound.click(); });
  $(`#yes${n}`).addEventListener('click', () => {
    conf.hidden = true;
    if (n === 1) { TB.table1.fill(null); TB.m1.fill(null); TB.msg1 = ['표 1을 비웠어요.', '']; }
    else { TB.table2Dist.fill(null); TB.table2Speed.fill(null); TB.m2d.fill(null); TB.m2s.fill(null); TB.bracket = null; TB.msg2 = ['표 2를 비웠어요.', '']; }
    sound.softLow(); renderTables(); push(); mark();
  });
}

function updateTools() {
  const sa = slopeAvail(), aa = areaAvail();
  const bS = $('#stSlope'), bA = $('#vtArea');
  bS.disabled = !sa; bA.disabled = !aa;
  bS.title = sa ? '두 시각 사이의 기울기를 보여 줘요' : '그래프를 맞게 그리면 열려요';
  bA.title = aa ? '그래프 아랫부분의 넓이를 보여 줘요' : '그래프를 맞게 그리면 열려요';
  bS.setAttribute('aria-pressed', String(S.slope.on && sa));
  bA.setAttribute('aria-pressed', String(S.area.on && aa));
  const v = speed();
  if (S.slope.on && sa) {
    S.slope.t1 = S.slope.T1; S.slope.t2 = S.slope.T2;
    S.slope.value = r1(v * (S.slope.T2 - S.slope.T1) / (S.slope.T2 - S.slope.T1));
  }
  if (S.area.on && aa) { S.area.tUsed = S.area.T; S.area.value = r1(v * S.area.T); }
}

function updateSteps() {
  let s = 1;
  const t1ok = TB.table1Correct === 5, t2ok = TB.table2Correct === 8;
  if (TB.ran4) s = 2;
  if (TB.ran4 && t1ok) s = 3;
  if (TB.ran4 && t1ok && t2ok) s = 4;
  if (TB.ran4 && t1ok && t2ok && TB.stUnlocked && TB.vtUnlocked) s = 5;
  S.step = Math.max(S.step, s);
  document.querySelectorAll('.chip').forEach(ch => {
    const n = +ch.dataset.step;
    ch.classList.toggle('done', n < S.step || (n === 5 && (S.slope.used || S.area.used) && S.step === 5));
    ch.classList.toggle('now', n === S.step);
  });
}

// 초기화 (기록 값은 남김)
$('#btnReset').addEventListener('click', () => {
  if (isLocked()) return;
  if (S.playing) { S.playing = false; stopEngine(); }
  cur().t = 0;
  S.flashes = [];
  S.lens = { cm: 46, dy: null };
  S.slope.T1 = 1; S.slope.T2 = 3; S.slope.anim = 0;
  S.area.T = 2; S.area.shown = 0;
  TB.bracket = null;
  for (const n of ['1', '2', 'ST', 'VT']) $(`#confirm${n}`).hidden = true;
  sound.whoosh();
  toast('처음 상태로 돌렸어요. 표와 그래프 점은 그대로예요.');
  renderTables(); updateTools(); updateCtrl(); push(); mark();
});

// 품질
const btnQuality = $('#btnQuality');
function setQuality(q) {
  S.quality = q;
  btnQuality.textContent = `품질: ${q === 'high' ? '높음' : '낮음'}`;
  SG = null; mark();
}
btnQuality.addEventListener('click', () => { setQuality(S.quality === 'high' ? 'low' : 'high'); sound.click(); });
const fpsMon = new FpsMonitor(() => {
  if (S.quality === 'high') { setQuality('low'); toast('화면이 느려서 그래픽 품질을 낮췄어요.'); }
}, { threshold: 30, window: 4 });

// 음소거
const btnMute = $('#btnMute');
const paintMute = () => { btnMute.textContent = sound.muted ? '🔇' : '🔊'; btnMute.setAttribute('aria-pressed', String(sound.muted)); };
btnMute.addEventListener('click', () => { sound.toggleMute(); paintMute(); if (!sound.muted) sound.click(); });
paintMute();

// 스페이스바: 출발/일시정지
window.addEventListener('keydown', e => {
  if (e.key !== ' ' || isLocked()) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'SELECT' || t.tagName === 'A')) return;
  e.preventDefault(); play();
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') for (const n of ['1', '2', 'ST', 'VT']) $(`#confirm${n}`).hidden = true;
});

// ── SimBridge ───────────────────────────────────────
window.SimBridge.init(UNIT);
window.SimBridge.onLock = () => { if (S.playing) { pause(); needPush = false; sendState(); } };
// 잠금 클래스가 붙으면(웹앱 제출 뒤) 달리던 자동차도 멈춤
new MutationObserver(() => { if (isLocked() && S.playing) { pause(); needPush = false; sendState(); } })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
function sendState() {
  const m = cur(), v = speed();
  window.SimBridge.setState({
    mode: S.mode,
    speedCmS: v,
    timeS: r1(m.t),
    distanceCm: r1(v * r1(m.t)),
    runs: S.runs,
    step: S.step,
    magnifierUses: S.magnifierUses,
    table1: [...TB.table1],
    table1Correct: TB.table1Correct,
    table2Dist: [...TB.table2Dist],
    table2Speed: [...TB.table2Speed],
    table2Correct: TB.table2Correct,
    cumulativeMistakes: S.cumulativeMistakes,
    tableChecks: S.tableChecks,
    stPoints: TB.st.map(p => [...p]),
    vtPoints: TB.vt.map(p => [...p]),
    stCorrect: TB.stCorrect,
    vtCorrect: TB.vtCorrect,
    vtIntegerMistakes: S.vtIntegerMistakes,
    graphChecks: S.graphChecks,
    slopeT1: S.slope.used ? S.slope.t1 : null,
    slopeT2: S.slope.used ? S.slope.t2 : null,
    slopeValue: S.slope.used ? S.slope.value : null,
    areaT: S.area.used ? S.area.tUsed : null,
    areaValue: S.area.used ? S.area.value : null,
    variedSpeeds: [...VR.variedSpeeds],
  });
}

// ── 반복 ────────────────────────────────────────────
let last = performance.now(), lastPush = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsMon.update(dt);
  const m = cur();
  if (S.playing) {
    const prev = m.t;
    m.t = Math.min(S.stopAt, m.t + dt);
    for (let k = 1; k <= T_MAX; k++) if (prev < k - EPS && m.t >= k - EPS) snapshot(k);
    if (m.t >= S.stopAt - EPS) {
      m.t = S.stopAt; S.playing = false; stopEngine();
      if (m.t >= T_MAX - EPS) { sound.arrive(); reach4(); }
      push();
    }
    if (S.mode === 'vary') renderTables();
    updateCtrl(); needPush = true; dirty = true;
  }
  if (S.flashes.length) { S.flashes.forEach(f => (f.age += dt)); S.flashes = S.flashes.filter(f => f.age < 0.45); dirty = true; }
  if (TB.stAnim < 1) { TB.stAnim = Math.min(1, TB.stAnim + dt / 0.7); dirty = true; }
  if (TB.vtAnim < 1) { TB.vtAnim = Math.min(1, TB.vtAnim + dt / 0.7); dirty = true; }
  if (S.slope.on && S.slope.anim < 1) { S.slope.anim = Math.min(1, S.slope.anim + dt / 0.45); dirty = true; }
  if (S.area.on && Math.abs(S.area.shown - S.area.T) > 0.001) {
    const d = S.area.T - S.area.shown, stepv = dt * 3.2;
    S.area.shown = Math.abs(d) <= stepv ? S.area.T : S.area.shown + Math.sign(d) * stepv;
    dirty = true;
  }
  if (dirty) {
    dirty = false;
    renderScene(); drawGraph('st'); drawGraph('vt');
  }
  if (needPush && (now - lastPush > 120 || !S.playing)) { needPush = false; lastPush = now; sendState(); }
  requestAnimationFrame(frame);
}

const ro = new ResizeObserver(() => { SG = null; mark(); });
ro.observe(cvScene); ro.observe(GC.st.cv); ro.observe(GC.vt.cv);

if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { _font = null; SG = null; mark(); });
renderTables(); updateTools(); updateCtrl(); updateSteps(); sendState();
requestAnimationFrame(frame);
