// 거울과 렌즈 상 관찰대 (22-2-3-1-02)
// 관찰자 시점(Canvas 2D) + 옆에서 본 빛의 길(Canvas 2D) + 정리하기 표
import { sound } from '../../lib/sound.js';
import { clamp, lerp, ease, paintRange, toast } from '../../lib/utils.js';

SimBridge.init('22-2-3-1-02');

// ───────────────────────── 모형 ─────────────────────────
// 네 종류 모두 빛이 모이는 점까지의 거리 |f| = 10 cm (모형)
const TYPES = {
  convexMirror: { name: '볼록 거울', mirror: true, f: -10 },
  concaveMirror: { name: '오목 거울', mirror: true, f: 10 },
  convexLens: { name: '볼록 렌즈', mirror: false, f: 10 },
  concaveLens: { name: '오목 렌즈', mirror: false, f: -10 },
};
const ORDER = ['convexMirror', 'concaveMirror', 'convexLens', 'concaveLens'];
const ZONES = {
  near: { name: '가까이', col: '가까이 있을 때', color: '#2f9e62' },
  far: { name: '멀리', col: '멀리 있을 때', color: '#2f6fde' },
  veryFar: { name: '매우 멀리', col: '매우 멀리 있을 때', color: '#7c4ddb' },
  blur: { name: '흐림', col: '', color: '#8b95a7' },
};
const ZONE_ORDER = ['near', 'far', 'veryFar'];
const REP = { near: 5, far: 15, veryFar: 30 }; // 표 판정 대표 거리
const D_MIN = 2, D_MAX = 50;
const SIZE_WORD = { larger: '물체보다 크다', smaller: '물체보다 작다', same: '물체와 같다', unclear: '알아보기 어려움' };
const ORIENT_WORD = { upright: '바로 섬', inverted: '거꾸로 섬', unclear: '알아보기 어려움' };

const isConv = t => TYPES[t].f > 0;
// 상의 크기(배율) m = f ÷ (f − d), 상까지의 거리 d′ = d·f ÷ (d − f)
function optics(t, d) {
  const f = TYPES[t].f;
  const m = f / (f - d);
  const dp = Math.abs(d - f) < 1e-9 ? Infinity : (d * f) / (d - f);
  return { m, dp, f };
}
// 구간: 오목 거울·볼록 렌즈 = 가까이 2~8, 흐림 9~11, 멀리 12~19, 매우 멀리 20~50
//       볼록 거울·오목 렌즈 = 흐림이 없으므로 가까이 2~10, 멀리 11~19, 매우 멀리 20~50
function zoneOf(t, d) {
  if (t && isConv(t)) return d <= 8 ? 'near' : d <= 11 ? 'blur' : d <= 19 ? 'far' : 'veryFar';
  return d <= 10 ? 'near' : d <= 19 ? 'far' : 'veryFar';
}
const sizeOf = m => (Math.abs(m) > 1.005 ? 'larger' : Math.abs(m) < 0.995 ? 'smaller' : 'same');
const orientOf = m => (m > 0 ? 'upright' : 'inverted');

// ───────────────────────── 상태 ─────────────────────────
const S = {
  mode: 'observe',
  type: 'convexMirror',
  d: 5,
  pos: 5,            // 화면에 보이는 물체 위치(cm, 실수 — 미끄러짐 애니메이션)
  glide: null,
  beam: false,
  beamT0: 0,
  playing: true,
  quality: 'high',
  mystery: { type: null, guess: null, solved: false, last: null },
  dragged: false,
};
try { S.quality = localStorage.getItem('sim-quality') || ((navigator.hardwareConcurrency || 4) <= 2 ? 'low' : 'high'); } catch { /* 기본값 */ }
const REC = {
  observed: [], beamViewed: new Set(), table: {}, tableCorrect: '', tableChecks: 0,
  mysteryTries: 0, mysterySolved: 0, marks: {}, allCorrect: false,
};

const curType = () => (S.mode === 'mystery' ? S.mystery.type : S.type);
const hidden = () => S.mode === 'mystery' && !S.mystery.solved; // 수수께끼: 정체 가림
const locked = () => document.documentElement.classList.contains('sim-locked');

function info() {
  const t = curType();
  const d = S.d;
  const o = optics(t, d);
  const realZone = zoneOf(t, d);
  const zone = hidden() ? zoneOf(null, d) : realZone; // 가린 동안은 흐림 띠도 숨김
  const blur = realZone === 'blur';
  return {
    t, d, zone, realZone, blur, ...o,
    size: blur ? 'unclear' : sizeOf(o.m),
    orient: blur ? 'unclear' : orientOf(o.m),
  };
}

// ───────────────────────── 소리 ─────────────────────────
const SND = {
  lastTick: 0,
  tick() {
    const now = performance.now();
    if (now - this.lastTick < 83) return; // 초당 최대 12번
    this.lastTick = now;
    sound._tone({ freq: 1500, type: 'square', dur: 0.018, vol: 0.035 });
  },
  zone(z) { const f = { near: 784, far: 988, veryFar: 1175 }[z] || 880; sound._tone({ freq: f, type: 'sine', dur: 0.4, vol: 0.15 }); sound._tone({ freq: f * 2, type: 'sine', dur: 0.2, vol: 0.03 }); },
  flip(up) {
    const [a, b] = up ? [420, 760] : [760, 420];
    sound._tone({ freq: a, freq2: b, type: 'triangle', dur: 0.14, vol: 0.14 });
    sound._tone({ freq: b, freq2: up ? b * 1.5 : b * 0.7, type: 'sine', dur: 0.16, vol: 0.1, delay: 0.12 });
  },
  blur() { sound._noise({ dur: 0.2, from: 2500, to: 1800, vol: 0.035 }); },
  type() { sound.soft(); },
  beam() { sound._tone({ freq: 260, freq2: 900, type: 'sine', dur: 0.45, vol: 0.12 }); sound._noise({ dur: 0.4, from: 400, to: 2400, vol: 0.05 }); },
  beamOff() { sound.off(); },
  cell() { sound._tone({ freq: 1250, freq2: 900, type: 'sine', dur: 0.05, vol: 0.12 }); },
  good() { sound.chime(); },
  retry() { sound._tone({ freq: 220, type: 'triangle', dur: 0.3, vol: 0.16 }); },
  reset() { sound.reset(); },
  ui() { sound.click(); },
};

// ───────────────────────── DOM ─────────────────────────
const $ = id => document.getElementById(id);
const el = {
  obs: $('obs'), ray: $('ray'), dist: $('dist'), distOut: $('distOut'),
  roDistLbl: $('roDistLbl'), roDist: $('roDist'), roZone: $('roZone'), roMag: $('roMag'), roSize: $('roSize'), roOrient: $('roOrient'),
  btnBeam: $('btnBeam'), btnPlay: $('btnPlay'), btnQuality: $('btnQuality'), btnMute: $('btnMute'), btnReset: $('btnReset'),
  tabObserve: $('tabObserve'), tabMystery: $('tabMystery'), cards: $('cards'), mysteryPanel: $('mysteryPanel'),
  qcard: $('qcard'), qcardName: $('qcardName'), table: $('sumTable'), tableMsg: $('tableMsg'), pairLegend: $('pairLegend'),
};

// ───────────────────────── 화면 크기 ─────────────────────────
const views = {};
function setupCanvas(name, canvas) {
  const v = { canvas, ctx: canvas.getContext('2d'), w: 1, h: 1, dpr: 1 };
  views[name] = v;
  const fit = () => {
    const r = canvas.parentElement.getBoundingClientRect();
    v.dpr = S.quality === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    v.w = Math.max(10, r.width); v.h = Math.max(10, r.height);
    canvas.width = Math.round(v.w * v.dpr); canvas.height = Math.round(v.h * v.dpr);
    dirty = true;
  };
  new ResizeObserver(fit).observe(canvas.parentElement);
  v.fit = fit;
  fit();
}

// ───────────────────────── 그리기 도구 ─────────────────────────
// 펭귄 인형: 발 끝이 (0,0), 위로 h 만큼. flagSide: 깃발이 보이는 쪽(+1 오른쪽, −1 왼쪽)
function drawPenguin(c, h, { view = 'front', flagSide = 1, wave = 0, alpha = 1 } = {}) {
  c.save();
  c.globalAlpha *= alpha;
  const k = h / 118;
  c.scale(k, k);
  const s = flagSide;
  // 깃대·깃발
  c.strokeStyle = '#8a5a2b'; c.lineWidth = 3.2; c.lineCap = 'round';
  c.beginPath(); c.moveTo(s * 37, -30); c.lineTo(s * 37, -116); c.stroke();
  c.fillStyle = '#e53935';
  c.beginPath();
  c.moveTo(s * 38, -116);
  c.quadraticCurveTo(s * (50), -116 + wave * 4, s * 64, -110 + wave * 2);
  c.lineTo(s * 64, -96 + wave * 2);
  c.quadraticCurveTo(s * 50, -102 + wave * 4, s * 38, -98);
  c.closePath(); c.fill();
  c.fillStyle = '#ffeb3b';
  c.beginPath(); c.arc(s * 50, -106 + wave * 2.5, 3.6, 0, Math.PI * 2); c.fill();
  // 발
  c.fillStyle = '#f59e0b';
  c.beginPath(); c.ellipse(-13, -3, 12, 5, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(13, -3, 12, 5, 0, 0, Math.PI * 2); c.fill();
  // 몸
  c.fillStyle = '#243046';
  c.beginPath(); c.ellipse(0, -42, 30, 40, 0, 0, Math.PI * 2); c.fill();
  // 깃발 든 날개 / 반대쪽 날개
  c.beginPath(); c.ellipse(s * 31, -48, 7, 19, -s * 0.5, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(-s * 29, -40, 6, 18, s * 0.25, 0, Math.PI * 2); c.fill();
  if (view === 'front') {
    c.fillStyle = '#ffffff';
    c.beginPath(); c.ellipse(0, -37, 21, 30, 0, 0, Math.PI * 2); c.fill();
  }
  // 목도리
  c.fillStyle = '#2b7de9';
  c.beginPath(); c.ellipse(0, -72, 25, 6, 0, 0, Math.PI * 2); c.fill();
  // 머리
  c.fillStyle = '#243046';
  c.beginPath(); c.arc(0, -88, 20, 0, Math.PI * 2); c.fill();
  if (view === 'front') {
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(-7, -90, 7, 8, 0, 0, Math.PI * 2); c.ellipse(7, -90, 7, 8, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111';
    c.beginPath(); c.arc(-6, -89, 3, 0, Math.PI * 2); c.arc(6, -89, 3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f59e0b';
    c.beginPath(); c.moveTo(-6, -82); c.lineTo(6, -82); c.lineTo(0, -74); c.closePath(); c.fill();
  } else {
    // 뒷모습: 목도리 매듭
    c.fillStyle = '#2b7de9';
    c.beginPath(); c.moveTo(s * 6, -72); c.lineTo(s * 16, -58); c.lineTo(s * 10, -56); c.closePath(); c.fill();
  }
  // 털 뭉치(머리 위) — 위아래 구별
  c.fillStyle = '#243046';
  c.beginPath(); c.moveTo(-5, -106); c.quadraticCurveTo(0, -118, 6, -107); c.closePath(); c.fill();
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function pill(c, x, y, text, { bg = 'rgba(255,255,255,.88)', fg = '#24324d', size = 13, align = 'left', bold = true } = {}) {
  c.font = `${bold ? 700 : 500} ${size}px Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const w = c.measureText(text).width + 16, h = size + 10;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  c.fillStyle = bg; roundRect(c, x0, y, w, h, h / 2); c.fill();
  c.fillStyle = fg; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText(text, x0 + 8, y + h / 2 + 0.5);
  return { x: x0, w, h };
}
function arrowHead(c, x, y, ang, size = 8) {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x - size * Math.cos(ang - 0.45), y - size * Math.sin(ang - 0.45));
  c.lineTo(x - size * Math.cos(ang + 0.45), y - size * Math.sin(ang + 0.45));
  c.closePath(); c.fill();
}

// ───────────────────────── 애니메이션 값 ─────────────────────────
const A = {
  mag: Math.abs(optics(S.type, S.d).m), // 보이는 배율
  rot: 0,          // 0 = 바로, π = 거꾸로
  blur: 0,         // 0 또렷 ~ 1 흐림
  dim: 0,          // 나란한 빛 켜면 관찰자 창 어둡게
  sceneFade: 1,    // 종류 바꿀 때 살짝 번쩍
  t: 0,            // 흐르는 시간(일시정지하면 멈춤)
};
let dirty = true;
let lastFrame = performance.now();

function targets() {
  const I = info();
  return {
    mag: I.blur ? 6 : Math.min(Math.abs(I.m), 12),
    rot: I.blur ? A.rot : (I.m < 0 ? Math.PI : 0),
    blur: I.blur ? 1 : 0,
    dim: S.beam ? 1 : 0,
  };
}

// ───────────────────────── 관찰자 시점 ─────────────────────────
function drawObs() {
  const v = views.obs, c = v.ctx, W = v.w, H = v.h;
  c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  const hq = S.quality === 'high';
  const I = info();
  const T = TYPES[I.t];
  const horizon = H * 0.56;

  // 벽
  const wall = c.createLinearGradient(0, 0, 0, horizon);
  wall.addColorStop(0, '#dfe9f5'); wall.addColorStop(1, '#c9d7e8');
  c.fillStyle = wall; c.fillRect(0, 0, W, horizon);
  // 벽 무늬(세로 판)
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
  for (let x = 30; x < W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, horizon); c.stroke(); }
  // 탁자(원근)
  const tab = c.createLinearGradient(0, horizon, 0, H);
  tab.addColorStop(0, '#caa071'); tab.addColorStop(1, '#a87445');
  c.fillStyle = tab; c.fillRect(0, horizon, W, H - horizon);
  c.strokeStyle = 'rgba(90,50,20,.18)'; c.lineWidth = 1;
  for (let i = -8; i <= 8; i++) { c.beginPath(); c.moveTo(W / 2 + i * 40, horizon); c.lineTo(W / 2 + i * 190, H); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(0, horizon, W, 2);

  const R = Math.min(H * 0.36, W * 0.2);
  const cx = T.mirror ? W * 0.58 : W * 0.5;
  const cy = H * 0.42;
  const sil = R * 0.5; // 1배일 때 상의 높이(= 비교용 실루엣 높이)
  const t01 = (S.pos - D_MIN) / (D_MAX - D_MIN);
  const wave = S.playing && hq ? Math.sin(A.t * 3.2) : 0.3;

  // 바닥 거리 표시(가까이·멀리·매우 멀리 자리)
  const objPlace = tt => T.mirror
    ? { x: lerp(cx - R * 0.95, W * 0.16, Math.pow(tt, 0.8)), y: lerp(cy + R * 0.98, H * 0.97, Math.pow(tt, 0.8)), h: lerp(H * 0.14, H * 0.44, Math.pow(tt, 0.9)) }
    : { x: cx + R * 0.2, y: lerp(H * 0.97, horizon + 6, Math.pow(tt, 0.55)), h: lerp(H * 0.42, H * 0.11, Math.pow(tt, 0.55)) };

  // 가까이·멀리·매우 멀리 자리 표시(교과서 탐구처럼 탁자 위 세 자리)
  c.save();
  c.setLineDash([5, 4]); c.lineWidth = 2;
  for (const z of ZONE_ORDER) {
    const p = objPlace((REP[z] - D_MIN) / (D_MAX - D_MIN));
    c.strokeStyle = ZONES[z].color; c.globalAlpha = 0.75;
    c.beginPath(); c.ellipse(p.x, p.y, p.h * 0.34, p.h * 0.07, 0, 0, Math.PI * 2); c.stroke();
  }
  c.restore();

  // 렌즈: 물체가 렌즈 너머(뒤)에 있으므로 먼저 그림
  const obj = objPlace(t01);
  if (!T.mirror) {
    c.fillStyle = 'rgba(40,20,5,.28)';
    c.beginPath(); c.ellipse(obj.x, obj.y, obj.h * 0.3, obj.h * 0.055, 0, 0, Math.PI * 2); c.fill();
    c.save(); c.translate(obj.x, obj.y); drawPenguin(c, obj.h, { view: 'front', flagSide: -1, wave }); c.restore();
  }

  // 받침대
  const standCol = T.mirror ? '#7a5130' : '#6f7b8f';
  c.fillStyle = standCol;
  c.fillRect(cx - 5, cy + R * 0.9, 10, H * 0.66 - (cy + R * 0.9));
  c.beginPath(); c.ellipse(cx, H * 0.66, R * 0.45, R * 0.09, 0, 0, Math.PI * 2); c.fill();
  if (hq) {
    c.fillStyle = 'rgba(40,20,5,.22)';
    c.beginPath(); c.ellipse(cx + 6, H * 0.672, R * 0.5, R * 0.07, 0, 0, Math.PI * 2); c.fill();
  }

  // 거울(렌즈) 안쪽: 상
  c.save();
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
  c.translate(cx, cy);
  c.save();
  c.rotate(A.rot);
  // 안에 비친(보이는) 배경
  const hzIn = R * 0.3;
  if (T.mirror) {
    const g = c.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, '#e9f0f8'); g.addColorStop(1, '#b8c6d8');
    c.fillStyle = g; c.fillRect(-R * 1.5, -R * 1.5, R * 3, R * 3);
    c.fillStyle = '#c29a6c'; c.fillRect(-R * 1.5, hzIn, R * 3, R * 2);
  } else {
    c.fillStyle = '#d4dfec'; c.fillRect(-R * 1.5, -R * 1.5, R * 3, R * 3);
    c.fillStyle = '#c49a6a'; c.fillRect(-R * 1.5, hzIn, R * 3, R * 2);
  }
  // 상(펭귄)
  const imgH = sil * A.mag;
  const clear = 1 - A.blur;
  if (clear > 0.01) {
    const flipFade = 0.35 + 0.65 * Math.abs(Math.cos(A.rot)); // 뒤집히는 동안 흐려졌다 또렷해짐
    if (hq && flipFade < 0.95) c.filter = `blur(${((1 - flipFade) * 6).toFixed(1)}px)`;
    c.save(); c.translate(0, hzIn + imgH * 0.08);
    drawPenguin(c, imgH, { view: 'front', flagSide: T.mirror ? 1 : -1, wave, alpha: clear * flipFade });
    c.restore();
    c.filter = 'none';
  }
  c.restore();
  if (A.blur > 0.01) {
    // 흐림: 빛 번짐
    c.save();
    c.globalAlpha = A.blur;
    const blobs = [['#243046', 0, -R * 0.1, R * 1.0], ['#ffffff', 0, 0, R * 0.55], ['#f59e0b', R * 0.2, R * 0.3, R * 0.35], ['#e53935', -R * 0.4, -R * 0.5, R * 0.35], ['#2b7de9', 0, -R * 0.35, R * 0.3]];
    for (const [col, x, y, r] of blobs) {
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
  }
  // 유리·거울 반짝임
  if (hq) {
    const gl = c.createLinearGradient(-R, -R, R, R);
    gl.addColorStop(0, 'rgba(255,255,255,.0)'); gl.addColorStop(0.3, 'rgba(255,255,255,.35)');
    gl.addColorStop(0.38, 'rgba(255,255,255,.0)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gl; c.fillRect(-R, -R, R * 2, R * 2);
  }
  if (!T.mirror) { c.fillStyle = 'rgba(190,225,255,.12)'; c.fillRect(-R, -R, R * 2, R * 2); }
  c.restore();

  // 틀
  c.save();
  if (hq) { c.shadowColor = 'rgba(0,0,0,.3)'; c.shadowBlur = 10; c.shadowOffsetY = 3; }
  c.lineWidth = Math.max(6, R * 0.07);
  c.strokeStyle = hidden() ? '#8f98a8' : (T.mirror ? '#e8862f' : '#d9578f');
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
  c.restore();
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.6)';
  c.beginPath(); c.arc(cx, cy, R - c.lineWidth - R * 0.03, 0, Math.PI * 2); c.stroke();

  if (A.blur > 0.5) pill(c, cx, cy + R * 0.55, '상이 흐려서 알아보기 어려워요', { align: 'center', bg: 'rgba(30,40,60,.78)', fg: '#fff', size: 13 });

  // 거울: 물체는 거울 앞(관찰자 쪽)에 있으므로 나중에 그림 — 뒷모습
  if (T.mirror) {
    c.fillStyle = 'rgba(40,20,5,.28)';
    c.beginPath(); c.ellipse(obj.x, obj.y, obj.h * 0.3, obj.h * 0.055, 0, 0, Math.PI * 2); c.fill();
    c.save(); c.translate(obj.x, obj.y); drawPenguin(c, obj.h, { view: 'back', flagSide: 1, wave }); c.restore();
  }

  // 덮개 글자
  pill(c, 8, 8, '👁 관찰자 시점 · 관찰자 위치 고정', { bg: 'rgba(255,255,255,.9)' });
  const nm = hidden() ? '? 무엇일까요' : T.name;
  pill(c, W - 8, 8, nm, { align: 'right', bg: hidden() ? '#5b6577' : (T.mirror ? '#e8862f' : '#d9578f'), fg: '#fff', size: 14 });

  // 물체 크기 비교 실루엣
  c.font = '700 12px Pretendard, "Noto Sans KR", sans-serif';
  const bw = Math.max(sil * 0.95 + 18, c.measureText('물체 크기(1배)').width + 14), bh = sil + 34;
  const bx = W - bw - 8, by = H - bh - 8;
  c.fillStyle = 'rgba(255,255,255,.82)'; roundRect(c, bx, by, bw, bh, 8); c.fill();
  c.strokeStyle = 'rgba(80,90,110,.3)'; c.lineWidth = 1; c.stroke();
  c.save(); c.translate(bx + bw / 2, by + sil + 10); c.globalAlpha = 0.55;
  drawPenguin(c, sil, { view: 'front', flagSide: T.mirror ? 1 : -1, wave: 0.3 });
  c.restore();
  c.font = '700 12px Pretendard, "Noto Sans KR", sans-serif'; c.fillStyle = '#3b4660'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillText('물체 크기(1배)', bx + bw / 2, by + bh - 7);

  if (A.dim > 0.01) {
    c.fillStyle = `rgba(15,26,46,${0.62 * A.dim})`; c.fillRect(0, 0, W, H);
    if (A.dim > 0.5) pill(c, W / 2, H / 2 - 14, '아래 ‘옆에서 본 빛의 길’을 보세요 ↓', { align: 'center', bg: '#e53e3e', fg: '#fff', size: 15 });
  }
}

// ───────────────────────── 옆에서 본 빛의 길 ─────────────────────────
let rayMap = null; // 끌기 계산용
function drawRay() {
  const v = views.ray, c = v.ctx, W = v.w, H = v.h;
  c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  const hq = S.quality === 'high';
  const I = info();
  const T = TYPES[I.t];
  const hide = hidden();

  c.fillStyle = '#0f1a2e'; c.fillRect(0, 0, W, H);
  // 모눈
  c.strokeStyle = 'rgba(120,150,200,.07)'; c.lineWidth = 1;
  for (let x = 0; x < W; x += 24) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 0; y < H; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }

  const barH = 46;
  const plotB = H - barH - 4;
  const y0 = Math.round(plotB * 0.52 + 6);
  const ex = T.mirror ? W * 0.17 : W * 0.4;
  const kx = (W - 30 - ex) / D_MAX;
  const objPx = Math.max(22, Math.min(y0 * 0.42, 62));
  const ky = objPx;
  const X = cm => ex + cm * kx;
  const Y = u => y0 - u * ky;
  const outSign = T.mirror ? 1 : -1;
  rayMap = { X, ex, kx, y0, Y, plotB, barTop: H - barH };
  const eH = Math.min(objPx * 1.75, y0 - 10, plotB - y0 - 4 + objPx * 0.2);

  // 광축
  c.strokeStyle = 'rgba(200,215,240,.45)'; c.setLineDash([6, 5]); c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(0, y0); c.lineTo(W, y0); c.stroke(); c.setLineDash([]);

  // 관찰자 눈
  const eyeX = T.mirror ? W - 16 : 16;
  drawEye(c, eyeX, y0 - eH * 0.55, T.mirror ? -1 : 1);
  c.font = '600 12px Pretendard, "Noto Sans KR", sans-serif'; c.fillStyle = '#9fb3d6';
  c.textAlign = T.mirror ? 'right' : 'left'; c.textBaseline = 'top';
  c.fillText('관찰자', T.mirror ? W - 6 : 6, y0 - eH * 0.55 + 12);

  const clipPlot = () => { c.save(); c.beginPath(); c.rect(0, 0, W, plotB); c.clip(); };

  // 거울·렌즈
  if (hide) {
    c.fillStyle = '#4b5568'; c.strokeStyle = '#9aa6bb'; c.lineWidth = 2;
    roundRect(c, ex - 22, y0 - eH, 44, eH * 2, 8); c.fill(); c.stroke();
    c.fillStyle = '#e8edf6'; c.font = '400 30px Jua, Pretendard, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('?', ex, y0);
  } else drawElement(c, I.t, ex, y0, eH, hq);

  // 빛이 모이는 점
  if (!hide) {
    const fps = T.mirror ? [I.f] : [10, -10];
    for (const fx of fps) {
      const px = X(fx);
      c.fillStyle = '#ffd54f';
      if (hq) { c.shadowColor = '#ffd54f'; c.shadowBlur = 8; }
      c.beginPath(); c.arc(px, y0, 4.5, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
    }
    // 라벨(겹치지 않게 한 곳만)
    const lblX = T.mirror ? X(I.f) : X(outSign * I.f);
    const lines = I.f > 0 ? ['빛이 모이는 점'] : ['빛이 퍼져 나오는', '것처럼 보이는 점'];
    c.font = '600 12px Pretendard, "Noto Sans KR", sans-serif';
    const lw = Math.max(...lines.map(l => c.measureText(l).width));
    // 거울 뒤쪽 점은 왼쪽, 나머지는 점 아래 가운데
    const behind = lblX < ex;
    const lx = behind ? 4 : clamp(lblX - lw / 2, ex + 14, W - lw - 4);
    const ly = y0 + 9;
    c.fillStyle = 'rgba(15,26,46,.82)'; c.fillRect(lx - 3, ly - 2, lw + 6, lines.length * 15 + 3);
    c.fillStyle = '#ffd54f'; c.textAlign = 'left'; c.textBaseline = 'top';
    lines.forEach((l, i) => c.fillText(l, lx, ly + i * 15));
  }

  // 구간 띠·눈금
  drawBar(c, I, X, H - barH, W, hide);

  clipPlot();
  const rayCol = '#ff4d4d';
  const strokeRay = (pts, dashed = false, col = rayCol, w = 2.4) => {
    c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dashed ? [5, 5] : []);
    if (hq && !dashed) { c.shadowColor = col; c.shadowBlur = 6; }
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke(); c.setLineDash([]); c.shadowBlur = 0;
  };
  // 픽셀 공간에서 (x,y)부터 방향(dx,dy)로 창 끝까지
  const toEdge = (x, y, dx, dy) => {
    let tt = 1e9;
    if (dx > 1e-9) tt = Math.min(tt, (W + 5 - x) / dx);
    if (dx < -1e-9) tt = Math.min(tt, (-5 - x) / dx);
    if (dy > 1e-9) tt = Math.min(tt, (plotB + 5 - y) / dy);
    if (dy < -1e-9) tt = Math.min(tt, (-5 - y) / dy);
    return [x + dx * tt, y + dy * tt];
  };
  const dirPx = (dxCm, dyU) => [dxCm * kx, -dyU * ky];
  const midArrow = (a, b, col = rayCol, frac = 0.5) => {
    const x = lerp(a[0], b[0], frac), y = lerp(a[1], b[1], frac);
    c.fillStyle = col; arrowHead(c, x, y, Math.atan2(b[1] - a[1], b[0] - a[0]), 9);
  };

  if (S.beam && !hide) {
    // 나란한 빛 세 줄
    const prog = clamp((performance.now() - S.beamT0) / 1400, 0, 1);
    const hs = [-1.15, 0, 1.15];
    const paths = [];
    for (const hU of hs) {
      const start = [W + 5, Y(hU)];
      if (!T.mirror) start[0] = W + 5;
      const hit = [ex, Y(hU)];
      // 나간 방향 = sign(f)·(F − hit), F = (outSign·f, 0)
      const Fcm = outSign * I.f;
      let dcm = Math.sign(I.f) * (Fcm - 0), du = Math.sign(I.f) * (0 - hU);
      if (hU === 0) { dcm = outSign; du = 0; }
      const [dx, dy] = dirPx(dcm, du);
      const end = toEdge(hit[0], hit[1], dx, dy);
      paths.push({ pts: [start, hit, end], hU });
    }
    const flow = S.playing ? (A.t * 60) % 22 : 0;
    for (const p of paths) {
      const L1 = Math.hypot(p.pts[1][0] - p.pts[0][0], p.pts[1][1] - p.pts[0][1]);
      const L2 = Math.hypot(p.pts[2][0] - p.pts[1][0], p.pts[2][1] - p.pts[1][1]);
      const total = L1 + L2, shown = total * ease.outCubic(prog);
      const pts = [p.pts[0]];
      if (shown <= L1) pts.push([lerp(p.pts[0][0], p.pts[1][0], shown / L1), lerp(p.pts[0][1], p.pts[1][1], shown / L1)]);
      else { pts.push(p.pts[1]); const q = (shown - L1) / L2; pts.push([lerp(p.pts[1][0], p.pts[2][0], q), lerp(p.pts[1][1], p.pts[2][1], q)]); }
      strokeRay(pts, false, rayCol, 2.6);
      if (prog >= 1) {
        // 흐르는 빛 알갱이
        c.strokeStyle = 'rgba(255,220,220,.85)'; c.lineWidth = 2.6; c.setLineDash([3, 19]); c.lineDashOffset = -flow;
        c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.stroke();
        c.setLineDash([]); c.lineDashOffset = 0;
        midArrow(p.pts[0], p.pts[1]); midArrow(p.pts[1], p.pts[2], rayCol, 0.35);
        if (I.f < 0 && p.hU !== 0) strokeRay([p.pts[1], [X(outSign * I.f), y0]], true, 'rgba(255,140,140,.7)', 1.6);
      }
    }
    if (prog >= 1) {
      const fx = X(outSign * I.f);
      const msg = I.f > 0 ? (T.mirror ? '반사된 빛이 한 점에 모여요' : '굴절된 빛이 한 점에 모여요') : (T.mirror ? '반사된 빛이 퍼져요' : '굴절된 빛이 퍼져요');
      pill(c, clamp(fx, 110, W - 110), 8, msg, { align: 'center', bg: '#e53e3e', fg: '#fff', size: 14 });
    }
    c.restore();
    return;
  }

  // 물체(화살표 + 펭귄 머리)
  const ox = X(S.pos);
  const tip = [ox, Y(1)];
  if (!hide) {
    // 상까지 계산(공식) — 거울: 상 위치 x = d′(앞 +), 렌즈: x = −d′(관찰자 쪽 −)
    const d = S.d;
    const real = I.dp > 0 && isFinite(I.dp);
    const xi = isFinite(I.dp) ? (T.mirror ? I.dp : -I.dp) : null;
    const tipD = [X(d), Y(1)];
    // 빛 ①: 축과 나란히 → 반사·굴절 후 빛이 모이는 점 쪽(또는 퍼짐)
    const hit1 = [ex, Y(1)];
    const Fcm = outSign * I.f;
    const [d1x, d1y] = dirPx(Math.sign(I.f) * Fcm, Math.sign(I.f) * (0 - 1));
    const end1 = toEdge(hit1[0], hit1[1], d1x, d1y);
    // 빛 ②: 가운데로 → 거울은 대칭으로 반사, 렌즈는 곧게 지남
    const hit2 = [ex, y0];
    const [d2x, d2y] = dirPx(outSign * d, -1);
    const end2 = toEdge(hit2[0], hit2[1], d2x, d2y);
    strokeRay([tipD, hit1, end1]);
    strokeRay([tipD, hit2, end2]);
    midArrow(tipD, hit1); midArrow(tipD, hit2);
    midArrow(hit1, end1, rayCol, 0.3); midArrow(hit2, end2, rayCol, 0.3);

    if (xi !== null && !I.blur) {
      const ipx = X(xi), itop = Y(I.m);
      if (!real) {
        // 거꾸로 이은 선(점선)
        strokeRay([hit1, [ipx, itop]], true, 'rgba(255,150,150,.75)', 1.6);
        strokeRay([hit2, [ipx, itop]], true, 'rgba(255,150,150,.75)', 1.6);
      }
      drawArrowObj(c, ipx, y0, itop, { col: real ? '#ffa94d' : 'rgba(255,169,77,.9)', dashed: !real, inverted: I.m < 0, plotB });
      // 상 라벨
      const onScreen = ipx > 0 && ipx < W;
      const cut = itop < 4 || itop > plotB - 4;
      const ly = cut ? (I.m < 0 ? y0 + 26 : y0 - 46) : clamp(I.m < 0 ? itop + 6 : itop - 22, 4, plotB - 20);
      const itxt = real ? '상' : (T.mirror ? '거울 뒤에 있는 것처럼 보이는 상' : '렌즈 앞에 있는 것처럼 보이는 상');
      if (onScreen) {
        c.font = '700 12px Pretendard, "Noto Sans KR", sans-serif';
        const tw = c.measureText(itxt).width + 16;
        const away = ipx < ex ? -1 : 1; // 거울·렌즈에서 먼 쪽에 붙임
        let lx = away < 0 ? ipx - 8 - tw : ipx + 8;
        if (lx < 2 || lx + tw > W - 2) lx = clamp(ipx - tw / 2, 2, W - tw - 2);
        const lyy = (lx === ipx - 8 - tw || lx === ipx + 8) ? ly : clamp(I.m < 0 ? Y(I.m) + 8 : Y(I.m) - 46, 4, plotB - 22);
        pill(c, lx, lyy, itxt, { bg: 'rgba(255,169,77,.92)', fg: '#2a1a05', size: 12 });
      }
      else pill(c, ipx < 0 ? 6 : W - 6, y0 + 30, ipx < 0 ? '← 상은 창 밖 먼 곳에' : '상은 창 밖 먼 곳에 →', { align: ipx < 0 ? 'left' : 'right', bg: 'rgba(255,169,77,.92)', fg: '#2a1a05', size: 12 });
    } else {
      pill(c, W / 2, 8, '빛이 거의 나란히 나가 상이 또렷하게 생기지 않아요', { align: 'center', bg: 'rgba(139,149,167,.95)', fg: '#fff', size: 13 });
    }
  }
  // 물체
  drawArrowObj(c, ox, y0, tip[1], { col: '#ffe066', obj: true, plotB });
  c.restore();
  // 끌기 손잡이
  c.fillStyle = '#ffe066'; c.strokeStyle = '#0f1a2e'; c.lineWidth = 2;
  c.beginPath(); c.arc(ox, y0, 8, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = '#ffe066'; c.font = '700 12px Pretendard, "Noto Sans KR", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top';
  c.fillText('물체', ox, y0 + 11);
  if (!S.dragged) pill(c, clamp(ox + 26, 4, W - 210), Y(1) - 4, '👆 노란 물체를 끌어 옮겨요', { bg: 'rgba(255,224,102,.95)', fg: '#2a2205', size: 12 });
  if (hide) pill(c, W / 2, 8, '정체를 맞히면 빛의 길이 나타나요', { align: 'center', bg: 'rgba(91,101,119,.95)', fg: '#fff', size: 13 });
}

function drawEye(c, x, y, dir) {
  c.save(); c.translate(x, y); c.scale(dir, 1);
  c.fillStyle = '#e8eef9';
  c.beginPath(); c.moveTo(-9, 0); c.quadraticCurveTo(0, -8, 9, 0); c.quadraticCurveTo(0, 8, -9, 0); c.fill();
  c.fillStyle = '#2b4a7a'; c.beginPath(); c.arc(-2, 0, 3.6, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawArrowObj(c, x, yBase, yTip, { col, dashed = false, inverted = false, obj = false, plotB }) {
  const yT = clamp(yTip, 4, plotB - 4);
  const cut = yT !== yTip;
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = obj ? 4 : 3.2;
  c.setLineDash(dashed ? [6, 4] : []);
  c.beginPath(); c.moveTo(x, yBase); c.lineTo(x, yT); c.stroke(); c.setLineDash([]);
  const up = yT < yBase;
  if (!cut) {
    // 머리(펭귄 얼굴 모양 동그라미)
    const r = obj ? 8 : 7;
    const cyH = yT + (up ? -r + 2 : r - 2);
    c.beginPath(); c.arc(x, cyH, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#243046';
    c.beginPath(); c.arc(x - r * 0.35, cyH + (up ? -1 : 1), 1.6, 0, Math.PI * 2); c.arc(x + r * 0.35, cyH + (up ? -1 : 1), 1.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f59e0b';
    c.beginPath(); c.moveTo(x - 2.5, cyH + (up ? 2 : -2)); c.lineTo(x + 2.5, cyH + (up ? 2 : -2)); c.lineTo(x, cyH + (up ? 5 : -5)); c.closePath(); c.fill();
  } else {
    c.font = '700 12px Pretendard, "Noto Sans KR", sans-serif'; c.textAlign = 'center';
    c.textBaseline = up ? 'top' : 'bottom';
    const t = up ? '↑ 계속' : '↓ 계속';
    const w = c.measureText(t).width + 8;
    c.fillStyle = 'rgba(15,26,46,.8)'; c.fillRect(x + 6, up ? 4 : plotB - 20, w, 17);
    c.fillStyle = col; c.textAlign = 'left'; c.fillText(t, x + 10, up ? 6 : plotB - 5);
  }
}

function drawElement(c, t, ex, y0, eH, hq) {
  const T = TYPES[t];
  c.save();
  if (T.mirror) {
    const bend = (T.f > 0 ? 1 : -1) * Math.min(14, eH * 0.16); // 오목: 가장자리가 물체 쪽(오른쪽)으로
    const xAt = u => ex + bend * (u * u); // u: -1~1
    // 뒷면 빗금
    c.strokeStyle = 'rgba(232,134,47,.55)'; c.lineWidth = 1.5;
    for (let u = -1; u <= 1.001; u += 0.12) {
      const x = xAt(u), y = y0 - u * eH;
      c.beginPath(); c.moveTo(x - 2, y); c.lineTo(x - 10, y + 7); c.stroke();
    }
    c.strokeStyle = '#ffb066'; c.lineWidth = 5;
    if (hq) { c.shadowColor = '#ffb066'; c.shadowBlur = 8; }
    c.beginPath();
    for (let u = -1; u <= 1.001; u += 0.05) { const x = xAt(u), y = y0 - u * eH; u === -1 ? c.moveTo(x, y) : c.lineTo(x, y); }
    c.stroke();
  } else {
    const thick = Math.min(16, eH * 0.18);
    c.fillStyle = 'rgba(244,143,190,.35)'; c.strokeStyle = '#f48fbe'; c.lineWidth = 2.5;
    if (hq) { c.shadowColor = '#f48fbe'; c.shadowBlur = 8; }
    c.beginPath();
    if (T.f > 0) {
      c.moveTo(ex, y0 - eH);
      c.quadraticCurveTo(ex + thick * 2, y0, ex, y0 + eH);
      c.quadraticCurveTo(ex - thick * 2, y0, ex, y0 - eH);
    } else {
      const e = thick * 0.9, m = 3;
      c.moveTo(ex - e, y0 - eH); c.lineTo(ex + e, y0 - eH);
      c.quadraticCurveTo(ex + m - e * 0.9, y0, ex + e, y0 + eH);
      c.lineTo(ex - e, y0 + eH);
      c.quadraticCurveTo(ex - m + e * 0.9, y0, ex - e, y0 - eH);
    }
    c.closePath(); c.fill(); c.stroke();
  }
  c.restore();
}

function drawBar(c, I, X, top, W, hide) {
  const conv = !hide && isConv(I.t);
  const bands = conv
    ? [['near', 1.5, 8.5], ['blur', 8.5, 11.5], ['far', 11.5, 19.5], ['veryFar', 19.5, 50.5]]
    : [['near', 1.5, 10.5], ['far', 10.5, 19.5], ['veryFar', 19.5, 50.5]];
  const by = top + 4, bh = 14;
  c.fillStyle = 'rgba(8,14,26,.85)'; c.fillRect(0, top, W, 50);
  for (const [z, a, b] of bands) {
    const x1 = X(a), x2 = X(b);
    c.fillStyle = ZONES[z].color;
    c.globalAlpha = I.zone === z ? 1 : 0.55;
    c.fillRect(x1, by, x2 - x1, bh);
    if (z === 'blur') {
      c.save(); c.beginPath(); c.rect(x1, by, x2 - x1, bh); c.clip();
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.5;
      for (let x = x1 - bh; x < x2; x += 5) { c.beginPath(); c.moveTo(x, by + bh); c.lineTo(x + bh, by); c.stroke(); }
      c.restore();
    }
    c.globalAlpha = 1;
    c.font = '700 11.5px Pretendard, "Noto Sans KR", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#fff';
    const label = ZONES[z].name;
    if (c.measureText(label).width < x2 - x1 - 4) c.fillText(label, (x1 + x2) / 2, by + bh / 2 + 0.5);
  }
  // 눈금
  c.strokeStyle = 'rgba(200,215,240,.7)'; c.fillStyle = '#b9c7e0'; c.lineWidth = 1;
  c.font = '600 12px Pretendard, "Noto Sans KR", sans-serif'; c.textBaseline = 'top';
  for (let cm = 0; cm <= 50; cm += 5) {
    const x = X(cm);
    c.beginPath(); c.moveTo(x, by + bh); c.lineTo(x, by + bh + (cm % 10 ? 3 : 6)); c.stroke();
    if (cm % 10 === 0) { c.textAlign = cm === 50 ? 'right' : 'center'; c.fillText(cm === 50 ? '50 cm' : String(cm), x + (cm === 50 ? 10 : 0), by + bh + 7); }
  }
  if (!hide && !conv) {
    const nm = TYPES[I.t].mirror ? '거울' : '렌즈';
    pill(c, W - 6, top - 26, `이 ${nm}은 빛이 퍼져서 흐려지는 곳이 없어요`, { align: 'right', bg: 'rgba(139,149,167,.9)', fg: '#fff', size: 12 });
  }
  // 지금 위치 표시
  const px = X(S.pos);
  c.fillStyle = '#ffe066';
  c.beginPath(); c.moveTo(px, by + bh + 1); c.lineTo(px - 6, by + bh + 9); c.lineTo(px + 6, by + bh + 9); c.closePath(); c.fill();
}

// ───────────────────────── 종류 아이콘 ─────────────────────────
function drawIcons() {
  document.querySelectorAll('.card').forEach(b => {
    const cv = b.querySelector('canvas'), c = cv.getContext('2d');
    const dpr = 2; cv.width = 72 * dpr; cv.height = 44 * dpr; c.scale(dpr, dpr);
    const t = b.dataset.type, T = TYPES[t];
    c.clearRect(0, 0, 72, 44);
    if (T.mirror) {
      const bend = T.f > 0 ? 7 : -7;
      c.strokeStyle = 'rgba(232,134,47,.6)'; c.lineWidth = 1.2;
      for (let u = -1; u <= 1.01; u += 0.25) { const x = 36 + bend * u * u - (bend > 0 ? 3 : -0); const y = 22 - u * 17; c.beginPath(); c.moveTo(x - 1, y); c.lineTo(x - 6, y + 4); c.stroke(); }
      c.strokeStyle = '#e8862f'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); for (let u = -1; u <= 1.01; u += 0.1) { const x = 36 + bend * u * u; const y = 22 - u * 17; u === -1 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke();
      // 빛 방향 작은 화살
      c.strokeStyle = '#9aa3b2'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(64, 22); c.lineTo(48, 22); c.stroke();
      c.fillStyle = '#9aa3b2'; arrowHead(c, 46, 22, Math.PI, 5);
    } else {
      c.fillStyle = 'rgba(217,87,143,.28)'; c.strokeStyle = '#d9578f'; c.lineWidth = 2;
      c.beginPath();
      if (T.f > 0) { c.moveTo(36, 3); c.quadraticCurveTo(50, 22, 36, 41); c.quadraticCurveTo(22, 22, 36, 3); }
      else { c.moveTo(29, 3); c.lineTo(43, 3); c.quadraticCurveTo(35, 22, 43, 41); c.lineTo(29, 41); c.quadraticCurveTo(37, 22, 29, 3); }
      c.closePath(); c.fill(); c.stroke();
    }
  });
}

// ───────────────────────── 표 ─────────────────────────
const ROWS = [['size', '상의 크기'], ['orient', '상의 모양']];
const CYCLE = { size: ['', 'larger', 'smaller'], orient: ['', 'upright', 'inverted'] };
const CELL_WORD = { larger: '크다', smaller: '작다', upright: '바로 섬', inverted: '거꾸로 섬', '': '—' };
const portraitMQ = window.matchMedia('(orientation: portrait)');
const cellHtml = (t, r, z) => `<td><button class="cell" data-t="${t}" data-r="${r}" data-z="${z}"></button></td>`;
const nameTh = (t, attrs = '') => `<th ${attrs} class="tname ${TYPES[t].mirror ? 'mirror' : 'lens'}" data-t="${t}">${TYPES[t].name.replace(' ', '<br>')}</th>`;
function buildTable() {
  let h;
  if (portraitMQ.matches) {
    // 세로 화면: 종류를 줄로, (구간 × 크기·모양)을 칸으로
    h = '<colgroup><col style="width:11%"><col><col><col><col><col><col></colgroup><thead><tr><th rowspan="2">물체의<br>위치 →</th>';
    for (const z of ZONE_ORDER) h += `<th colspan="2" class="zn ${z}">${ZONES[z].col}</th>`;
    h += '</tr><tr>';
    for (let i = 0; i < 3; i++) h += '<th>상의 크기</th><th>상의 모양</th>';
    h += '</tr></thead><tbody>';
    for (const t of ORDER) {
      h += '<tr>' + nameTh(t);
      for (const z of ZONE_ORDER) for (const [r] of ROWS) h += cellHtml(t, r, z);
      h += '</tr>';
    }
  } else {
    h = '<colgroup><col style="width:21%"><col style="width:15%"><col><col><col></colgroup><thead><tr><th colspan="2">물체의 위치 →</th>';
    for (const z of ZONE_ORDER) h += `<th class="zn ${z}">${ZONES[z].col.replace(' 있을 때', '<br>있을 때')}</th>`;
    h += '</tr></thead><tbody>';
    for (const t of ORDER) {
      ROWS.forEach(([r, rl], i) => {
        h += '<tr>' + (i === 0 ? nameTh(t, 'rowspan="2"') : '') + `<th>${rl.replace('상의 ', '')}</th>`;
        for (const z of ZONE_ORDER) h += cellHtml(t, r, z);
        h += '</tr>';
      });
    }
  }
  h += '</tbody>';
  el.table.innerHTML = h;
  el.table.classList.toggle('wide', portraitMQ.matches);
}
portraitMQ.addEventListener('change', () => { buildTable(); renderTable(); });
const cellKey = (t, r, z) => `${t}|${r}|${z}`;
const isObserved = (t, z) => REC.observed.includes(`${t}-${z}`);
function renderTable() {
  el.table.querySelectorAll('.cell').forEach(b => {
    const { t, r, z } = b.dataset;
    const open = isObserved(t, z);
    const v = REC.table[cellKey(t, r, z)] || '';
    b.className = 'cell';
    if (!open) {
      b.classList.add('locked'); b.textContent = '🔒';
      b.title = '먼저 관찰해 보세요';
      b.setAttribute('aria-label', `${TYPES[t].name} ${ZONES[z].col} ${r === 'size' ? '상의 크기' : '상의 모양'}: 먼저 관찰해 보세요`);
    } else {
      b.textContent = CELL_WORD[v];
      b.title = '눌러서 바꾸기';
      b.setAttribute('aria-label', `${TYPES[t].name} ${ZONES[z].col} ${r === 'size' ? '상의 크기' : '상의 모양'}: ${v ? CELL_WORD[v] : '비어 있음'}`);
      if (!v) b.classList.add('empty'); else b.classList.add('v-' + v);
      const mk = REC.marks[cellKey(t, r, z)];
      if (mk === 'wrong') b.classList.add('wrong');
    }
  });
  el.table.querySelectorAll('th.tname').forEach(th => {
    th.classList.remove('pa', 'pb');
    if (REC.allCorrect) th.classList.add(isConv(th.dataset.t) ? 'pa' : 'pb');
  });
  el.pairLegend.hidden = !REC.allCorrect;
}
function expected(t, r, z) {
  const { m } = optics(t, REP[z]);
  return r === 'size' ? sizeOf(m) : orientOf(m);
}
function onCell(b) {
  const { t, r, z } = b.dataset;
  if (!isObserved(t, z)) {
    SND.retry();
    toast(`🔒 ${TYPES[t].name}을(를) ‘${ZONES[z].col}’에서 먼저 관찰해 보세요 (${r === 'size' ? '크기' : '모양'} 칸)`);
    b.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 220 });
    return;
  }
  const k = cellKey(t, r, z);
  const cyc = CYCLE[r];
  const cur = REC.table[k] || '';
  REC.table[k] = cyc[(cyc.indexOf(cur) + 1) % cyc.length];
  delete REC.marks[k];
  REC.allCorrect = false;
  SND.cell();
  renderTable();
  pushState();
}
function filledCount() { return Object.values(REC.table).filter(Boolean).length; }
function checkTable() {
  let correct = 0, wrong = 0, empty = 0;
  REC.marks = {};
  for (const t of ORDER) for (const [r] of ROWS) for (const z of ZONE_ORDER) {
    const k = cellKey(t, r, z), v = REC.table[k] || '';
    if (!v) { empty++; continue; }
    if (v === expected(t, r, z)) correct++;
    else { wrong++; REC.marks[k] = 'wrong'; }
  }
  REC.tableChecks++;
  REC.tableCorrect = correct;
  REC.allCorrect = correct === 24;
  el.tableMsg.className = 'tmsg';
  if (REC.allCorrect) {
    el.tableMsg.classList.add('good');
    el.tableMsg.textContent = '🎉 모두 관찰과 같아요! 같은 색 띠로 묶인 짝을 비교해 보세요.';
    SND.good();
  } else {
    el.tableMsg.classList.add('warn');
    const parts = [];
    if (wrong) parts.push(`주황 테두리 ${wrong}칸을 다시 관찰해 볼까요?`);
    if (empty) parts.push(`아직 ${empty}칸이 비어 있어요.`);
    el.tableMsg.textContent = parts.join(' ') + ` (확인 ${REC.tableChecks}번째)`;
    SND.retry();
  }
  renderTable();
  pushState();
}

// ───────────────────────── 기록 ─────────────────────────
function recordObservation() {
  if (S.mode !== 'observe') return;
  const I = info();
  if (I.blur) return;
  if (I.zone === 'veryFar' && isConv(I.t) && I.d < 21) return; // 20 cm(1배)는 '매우 멀리'로 세지 않음
  const key = `${I.t}-${I.zone}`;
  if (!REC.observed.includes(key) && REC.observed.length < 12) {
    REC.observed.push(key);
    renderTable();
  }
}

// ───────────────────────── 화면 갱신 ─────────────────────────
function updateReadout() {
  const I = info();
  const T = TYPES[I.t];
  const nm = T.mirror ? '거울' : '렌즈';
  el.roDistLbl.textContent = `물체와 ${nm} 사이 거리`;
  el.roDist.textContent = `${I.d} cm`;
  el.roZone.textContent = ZONES[I.zone].name + (I.zone === 'blur' ? ' (빛이 모이는 점 근처)' : '');
  el.roZone.className = 'z-' + I.zone;
  if (I.blur) {
    el.roMag.textContent = '알아보기 어려움';
    el.roSize.textContent = '상이 흐려요';
    el.roOrient.textContent = '알아보기 어려움';
    el.roOrient.className = '';
  } else {
    el.roMag.textContent = `물체의 ${Math.abs(I.m).toFixed(2)}배`;
    el.roSize.textContent = SIZE_WORD[I.size];
    el.roOrient.textContent = (I.orient === 'upright' ? '⬆ ' : '⬇ ') + ORIENT_WORD[I.orient];
    el.roOrient.className = I.orient === 'upright' ? 'up' : 'inv';
  }
  el.dist.value = I.d; paintRange(el.dist);
  el.distOut.textContent = `${I.d} cm`;
  document.querySelectorAll('.qk').forEach(b => {
    const z = { 5: 'near', 15: 'far', 30: 'veryFar' }[b.dataset.go];
    b.classList.toggle('on', I.zone === z);
  });
}

let pushTimer = null;
function pushState() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; flushState(); }, 150);
}
function flushState() {
  {
    const I = info();
    SimBridge.setState({
      mode: S.mode,
      elementType: S.mode === 'mystery' ? '' : I.t,
      elementName: S.mode === 'mystery' ? '' : TYPES[I.t].name,
      objectDistCm: I.d,
      zone: I.zone,
      magnification: I.blur ? '' : Math.round(Math.abs(I.m) * 100) / 100,
      imageSize: I.size,
      imageOrientation: I.orient,
      parallelBeamOn: S.beam,
      beamViewed: [...REC.beamViewed].join(','),
      observed: REC.observed.join(','),
      observedCount: REC.observed.length,
      tableFilled: filledCount(),
      tableCorrect: REC.tableCorrect,
      tableChecks: REC.tableChecks,
      mysteryTries: REC.mysteryTries,
      mysterySolved: REC.mysterySolved,
    });
  }
}

function refresh() {
  updateReadout();
  recordObservation();
  dirty = true;
  pushState();
}

// 거리 바꾸기 (소리·기록 포함)
function setD(d, { fromGlide = false } = {}) {
  d = clamp(Math.round(d), D_MIN, D_MAX);
  if (d === S.d) return;
  const before = info();
  S.d = d;
  if (!fromGlide) { S.pos = d; S.glide = null; }
  const after = info();
  SND.tick();
  if (after.blur && !before.blur) SND.blur();
  else if (after.zone !== before.zone && after.zone !== 'blur') SND.zone(after.zone);
  if (!after.blur && !before.blur && after.orient !== before.orient) SND.flip(after.orient === 'upright');
  else if (!after.blur && before.blur && after.orient !== orientOf(A.rot > Math.PI / 2 ? -1 : 1)) SND.flip(after.orient === 'upright');
  refresh();
}
function glideTo(d) {
  d = clamp(d, D_MIN, D_MAX);
  if (d === S.d && !S.glide) return;
  const dur = 350 + Math.min(900, Math.abs(d - S.pos) * 30);
  S.glide = { from: S.pos, to: d, t0: performance.now(), dur };
}

function setType(t) {
  if (t === S.type && S.mode === 'observe') return;
  const wasMirror = TYPES[S.type].mirror;
  S.type = t;
  document.querySelectorAll('.card').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === t)));
  if (wasMirror !== TYPES[t].mirror) A.mag = Math.abs(info().m); // 장면이 바뀌면 바로 맞춤
  if (S.beam) { S.beamT0 = performance.now(); REC.beamViewed.add(t); }
  SND.type();
  refresh();
}

function setBeam(on) {
  S.beam = on;
  el.btnBeam.setAttribute('aria-pressed', String(on));
  el.btnBeam.querySelector('.lbl').textContent = on ? '물체 보기로 돌아가기' : '나란한 빛 보내기';
  if (on) { S.beamT0 = performance.now(); REC.beamViewed.add(curType()); SND.beam(); } else SND.beamOff();
  dirty = true; pushState();
}

// ───────────────────────── 수수께끼 ─────────────────────────
function newMystery() {
  const pool = ORDER.filter(t => t !== S.mystery.last);
  const t = pool[Math.floor(Math.random() * pool.length)];
  S.mystery = { type: t, guess: null, solved: false, last: t };
  document.querySelectorAll('.gbtn').forEach(b => b.setAttribute('aria-pressed', 'false'));
  el.qcard.classList.remove('solved');
  el.qcard.querySelector('b').textContent = '?';
  el.qcardName.textContent = '무엇일까요?';
  A.mag = Math.abs(info().m);
  A.rot = info().m < 0 ? Math.PI : 0;
}
function setMode(m) {
  if (m === S.mode) return;
  S.mode = m;
  el.tabObserve.setAttribute('aria-pressed', String(m === 'observe'));
  el.tabMystery.setAttribute('aria-pressed', String(m === 'mystery'));
  el.cards.hidden = m === 'mystery';
  el.mysteryPanel.hidden = m !== 'mystery';
  if (m === 'mystery') {
    if (S.beam) setBeam(false);
    newMystery();
    toast('❓ 가려진 것은 거울일까요, 렌즈일까요? 물체를 옮기며 상을 관찰해 보세요');
  } else {
    A.mag = Math.abs(info().m);
  }
  sound.whoosh(); SND.ui();
  refresh();
}
function guess() {
  const g = S.mystery.guess;
  if (S.mystery.solved) { toast('이미 맞혔어요! [새 문제]로 다시 도전해 보세요'); SND.ui(); return; }
  if (!g) { toast('먼저 네 가지 중 하나를 골라 주세요'); SND.retry(); return; }
  REC.mysteryTries++;
  if (g === S.mystery.type) {
    S.mystery.solved = true;
    REC.mysterySolved++;
    el.qcard.classList.add('solved');
    el.qcard.querySelector('b').textContent = '✔';
    el.qcardName.textContent = TYPES[g].name;
    toast(`🎉 맞았어요! ${TYPES[g].name}이에요. 빛의 길을 확인해 보세요`);
    SND.good();
  } else {
    toast('🤔 아니에요. 가까이·매우 멀리에서 상의 모양을 비교해 보세요');
    SND.retry();
  }
  refresh();
}

// ───────────────────────── 이벤트 ─────────────────────────
function guard(fn) { return (...a) => { if (locked()) return; fn(...a); }; }

document.querySelectorAll('.card').forEach(b => b.addEventListener('click', guard(() => setType(b.dataset.type))));
el.btnBeam.addEventListener('click', guard(() => setBeam(!S.beam)));
el.dist.addEventListener('input', guard(() => { S.dragged = true; setD(+el.dist.value); }));
$('btnMinus').addEventListener('click', guard(() => setD(S.d - 1)));
$('btnPlus').addEventListener('click', guard(() => setD(S.d + 1)));
document.querySelectorAll('.qk').forEach(b => b.addEventListener('click', guard(() => { SND.ui(); glideTo(+b.dataset.go); })));
el.tabObserve.addEventListener('click', guard(() => setMode('observe')));
el.tabMystery.addEventListener('click', guard(() => setMode('mystery')));
document.querySelectorAll('.gbtn').forEach(b => b.addEventListener('click', guard(() => {
  S.mystery.guess = b.dataset.guess;
  document.querySelectorAll('.gbtn').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  SND.cell();
})));
$('btnGuess').addEventListener('click', guard(guess));
$('btnNewQ').addEventListener('click', guard(() => { newMystery(); sound.whoosh(); SND.type(); toast('🔀 새 문제를 냈어요'); refresh(); }));
el.table.addEventListener('click', guard(e => { const b = e.target.closest('.cell'); if (b) onCell(b); }));
$('btnCheck').addEventListener('click', guard(checkTable));
$('btnClear').addEventListener('click', guard(() => {
  REC.table = {}; REC.marks = {}; REC.allCorrect = false;
  el.tableMsg.className = 'tmsg'; el.tableMsg.textContent = '표를 비웠어요. 관찰한 칸부터 다시 채워 보세요.';
  toast('🧽 표를 비웠어요');
  sound.whoosh(); SND.cell(); renderTable(); pushState();
}));
el.btnPlay.addEventListener('click', guard(() => {
  S.playing = !S.playing;
  el.btnPlay.innerHTML = S.playing ? '⏸ <span class="lbl">일시정지</span>' : '▶ <span class="lbl">재생</span>';
  SND.ui(); dirty = true;
}));
function applyQuality() {
  el.btnQuality.querySelector('.lbl').textContent = `품질: ${S.quality === 'high' ? '높음' : '낮음'}`;
  el.btnQuality.setAttribute('aria-pressed', String(S.quality === 'low'));
  Object.values(views).forEach(v => v.fit());
}
el.btnQuality.addEventListener('click', () => {
  S.quality = S.quality === 'high' ? 'low' : 'high';
  try { localStorage.setItem('sim-quality', S.quality); } catch { /* 무시 */ }
  applyQuality(); SND.ui();
});
const paintMute = () => { el.btnMute.textContent = sound.muted ? '🔇' : '🔊'; el.btnMute.setAttribute('aria-pressed', String(sound.muted)); };
el.btnMute.addEventListener('click', () => { sound.toggleMute(); paintMute(); if (!sound.muted) SND.ui(); });
el.btnReset.addEventListener('click', guard(() => {
  SND.reset();
  if (S.beam) { S.beam = false; el.btnBeam.setAttribute('aria-pressed', 'false'); el.btnBeam.querySelector('.lbl').textContent = '나란한 빛 보내기'; }
  if (S.mode === 'observe' && S.type !== 'convexMirror') {
    S.type = 'convexMirror';
    document.querySelectorAll('.card').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === 'convexMirror')));
  }
  S.glide = null; S.pos = 5; S.d = 5;
  A.mag = Math.abs(info().m); A.rot = info().m < 0 ? Math.PI : 0; A.blur = 0;
  toast('↺ 처음 상태로 돌렸어요 (표와 관찰 기록은 그대로예요)');
  refresh();
}));

// 빛의 길 창에서 물체 끌기 (마우스·터치 — Pointer Events)
let drag = null;
function cmFromX(px) { return (px - rayMap.ex) / rayMap.kx; }
el.ray.addEventListener('pointerdown', e => {
  if (locked() || !rayMap || S.beam) return;
  const r = el.ray.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const ox = rayMap.X(S.pos);
  const onObj = Math.abs(x - ox) < 34 && y > rayMap.Y(1) - 34 && y < rayMap.y0 + 34;
  const onBar = y > rayMap.barTop;
  if (!onObj && !onBar) return;
  drag = { id: e.pointerId };
  el.ray.setPointerCapture(e.pointerId);
  S.dragged = true; S.glide = null;
  if (onBar) setD(cmFromX(x));
  dirty = true;
  e.preventDefault();
});
el.ray.addEventListener('pointermove', e => {
  if (!rayMap) return;
  const r = el.ray.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (drag && drag.id === e.pointerId) { setD(cmFromX(x)); return; }
  const ox = rayMap.X(S.pos);
  const near = !S.beam && ((Math.abs(x - ox) < 34 && y > rayMap.Y(1) - 34 && y < rayMap.y0 + 34) || y > rayMap.barTop);
  el.ray.style.cursor = near ? 'ew-resize' : 'default';
});
const endDrag = e => { if (drag && drag.id === e.pointerId) { drag = null; dirty = true; } };
el.ray.addEventListener('pointerup', endDrag);
el.ray.addEventListener('pointercancel', endDrag);

// 키보드: 슬라이더에 초점이 없을 때도 ← → 로 거리 조절
window.addEventListener('keydown', e => {
  if (locked()) return;
  if (e.target.matches('input, button, textarea, select')) return;
  if (e.key === 'ArrowLeft') { setD(S.d - 1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { setD(S.d + 1); e.preventDefault(); }
});

function onLocked() { drag = null; S.glide = null; S.pos = S.d; dirty = true; if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; flushState(); } }
SimBridge.onLock = onLocked;
new MutationObserver(() => { if (locked()) onLocked(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

// ───────────────────────── 반복 ─────────────────────────
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  let anim = false;
  if (S.glide && locked()) S.glide = null;
  if (S.glide) {
    const g = S.glide;
    const p = clamp((now - g.t0) / g.dur, 0, 1);
    S.pos = lerp(g.from, g.to, ease.inOutCubic(p));
    setD(Math.round(S.pos), { fromGlide: true });
    if (p >= 1) { S.pos = g.to; S.glide = null; }
    anim = true;
  } else if (S.pos !== S.d) { S.pos = S.d; anim = true; }
  const tg = targets();
  const k = 1 - Math.exp(-dt * 9);
  const step = (key, target, eps) => {
    if (Math.abs(A[key] - target) > eps) { A[key] += (target - A[key]) * k; anim = true; } else A[key] = target;
  };
  step('mag', tg.mag, 0.002);
  // 뒤집기: 일정한 속도 + 끝에서 부드럽게
  if (Math.abs(A.rot - tg.rot) > 0.002) {
    const diff = tg.rot - A.rot;
    A.rot += Math.sign(diff) * Math.min(Math.abs(diff), dt * 7 * (0.25 + Math.abs(diff)));
    anim = true;
  } else A.rot = tg.rot;
  step('blur', tg.blur, 0.003);
  step('dim', tg.dim, 0.003);
  const ambient = S.playing && S.quality === 'high';
  if (S.playing) A.t += dt;
  const beamAnim = S.beam && (S.playing || now - S.beamT0 < 1500);
  if (dirty || anim || ambient || beamAnim) {
    drawObs();
    drawRay();
    dirty = false;
  }
  requestAnimationFrame(frame);
}

// ───────────────────────── 시작 ─────────────────────────
buildTable();
drawIcons();
setupCanvas('obs', el.obs);
setupCanvas('ray', el.ray);
applyQuality();
paintMute();
refresh();
renderTable();
requestAnimationFrame(t => { lastFrame = t; frame(t); });
