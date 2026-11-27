// 15-3-1-2-02 기체 반응 법칙 — ① 물 합성 장치 실험, ② 부피 상자 모형
// 단순화: 반응은 항상 완전히 일어나고, 생긴 수증기는 실온에서 물(액체)이 되어 부피를 0으로 본다(설계서 참고).
import { sound } from '../../lib/sound.js';
import { clamp, lerp, ease, damp, toast } from '../../lib/utils.js';

const UNIT = '15-3-1-2-02';
const SB = window.SimBridge;
SB.init(UNIT);

const $ = id => document.getElementById(id);
const locked = () => document.documentElement.classList.contains('sim-locked');
const FONT = '"Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
const fmtV = v => String(Math.round(v * 10) / 10);           // 3 → "3", 2.5 → "2.5"
const half = v => Math.round(v * 2) / 2;                       // 0.5 mL 단위로 정리(부동소수 오차 제거)
const rand = (a, b) => a + Math.random() * (b - a);
const easeOutBack = t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

let mode = 'lab', paused = false, quality = 'high', simT = 0;

// ─────────────────────────── 효과음 ───────────────────────────
const sfx = {
  clack() { sound._tone({ freq: 2200, freq2: 1500, type: 'square', dur: 0.025, vol: 0.06 }); sound._tone({ freq: 520, type: 'triangle', dur: 0.06, vol: 0.16, delay: 0.03 }); },
  hiss() { sound._noise({ dur: 0.8, from: 2600, to: 500, vol: 0.13 }); },
  spark() { sound._noise({ dur: 0.05, from: 6000, to: 3500, vol: 0.16 }); sound._tone({ freq: 3000, freq2: 1900, type: 'square', dur: 0.03, vol: 0.06 }); },
  boom() { sound._noise({ dur: 0.5, from: 1000, to: 70, vol: 0.4 }); sound._tone({ freq: 130, freq2: 38, type: 'sine', dur: 0.45, vol: 0.45, delay: 0.02 }); },
  drips() { [1.0, 1.3, 1.6].forEach(d => sound._tone({ freq: 1500, freq2: 650, type: 'sine', dur: 0.08, vol: 0.12, delay: d })); },
  thud() { sound._tone({ freq: 170, freq2: 110, type: 'triangle', dur: 0.18, vol: 0.24 }); },
  tok(up) { sound._tone({ freq: up ? 840 : 560, freq2: up ? 940 : 470, type: 'sine', dur: 0.08, vol: 0.17 }); },
  rise3() { [660, 880, 1175].forEach((f, i) => sound._tone({ freq: f, type: 'triangle', dur: 0.15, vol: 0.12, delay: i * 0.09 })); },
  dingdong() { sound._tone({ freq: 1318, type: 'sine', dur: 0.4, vol: 0.17 }); sound._tone({ freq: 1046, type: 'sine', dur: 0.6, vol: 0.17, delay: 0.22 }); },
  buzz() { sound._tone({ freq: 150, freq2: 118, type: 'sawtooth', dur: 0.38, vol: 0.07 }); },
  soft() { sound.soft(); },
  whoosh() { sound.whoosh(); },
  reset() { sound.reset(); },
  vent() { sound._noise({ dur: 0.6, from: 600, to: 2400, vol: 0.1 }); },
};

// ─────────────────────────── 원자·분자 모형 ───────────────────────────
// 단위 u = 수소 원자 반지름. 수소 = 작은 연회색, 산소 = 큰 빨강, 질소 = 큰 파랑, 염소 = 큰 연두
const ATOM = {
  H: { r: 1, c: ['#ffffff', '#cbd3dc', '#7d8b9b'], ink: '#3a4656', flat: '#c9d1da' },
  O: { r: 1.45, c: ['#ffa49b', '#e04848', '#a32121'], ink: '#fff', flat: '#e04848' },
  N: { r: 1.45, c: ['#a8c8ff', '#3d7be0', '#1d4b9c'], ink: '#fff', flat: '#3d7be0' },
  Cl: { r: 1.55, c: ['#e3f8a8', '#93c943', '#5a8a1c'], ink: '#24380b', flat: '#93c943' },
};
const MOL = {
  H2: [['H', -0.75, 0], ['H', 0.75, 0]],
  O2: [['O', -1.05, 0], ['O', 1.05, 0]],
  N2: [['N', -1.05, 0], ['N', 1.05, 0]],
  Cl2: [['Cl', -1.1, 0], ['Cl', 1.1, 0]],
  H2O: [['H', -1.35, 0.85], ['H', 1.35, 0.85], ['O', 0, -0.3]],
  HCl: [['H', 1.6, 0], ['Cl', -0.45, 0]],
  NH3: [['H', -1.45, 0.75], ['H', 1.45, 0.75], ['H', 0, 1.35], ['N', 0, -0.45]],
  N2H6: [['H', -2.5, -0.5], ['H', -2.0, 0.85], ['H', -0.85, 1.15], ['H', 2.5, -0.5], ['H', 2.0, 0.85], ['H', 0.85, 1.15], ['N', -1.0, -0.4], ['N', 1.0, -0.4]],
  NH: [['H', 1.6, 0], ['N', -0.4, 0]],
};
const sprites = new Map();
function atomSprite(el, rpx, dpr) {
  const key = `${el}|${Math.round(rpx * dpr * 2)}|${quality}`;
  let c = sprites.get(key);
  if (c) return c;
  const A = ATOM[el], R = rpx * dpr, pad = 2 * dpr;
  c = document.createElement('canvas');
  c.width = c.height = Math.max(4, Math.ceil(2 * R + 2 * pad));
  const g = c.getContext('2d'), m = c.width / 2;
  if (quality === 'high') {
    const gr = g.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.08, m, m, R);
    gr.addColorStop(0, A.c[0]); gr.addColorStop(0.5, A.c[1]); gr.addColorStop(1, A.c[2]);
    g.fillStyle = gr;
  } else g.fillStyle = A.flat;
  g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.fill();
  g.lineWidth = Math.max(1, 0.9 * dpr); g.strokeStyle = 'rgba(30,40,60,.35)'; g.stroke();
  if (rpx >= 7) {
    g.fillStyle = A.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.round((el === 'Cl' ? 0.78 : el === 'H' ? 1.0 : 0.95) * R)}px ${FONT}`;
    g.fillText(el, m, m + R * 0.06);
  }
  sprites.set(key, c);
  if (sprites.size > 400) sprites.clear();
  return c;
}
function drawAtom(ctx, el, x, y, u, dpr, alpha = 1) {
  const r = ATOM[el].r * u, s = atomSprite(el, r, dpr), w = s.width / dpr;
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.drawImage(s, x - w / 2, y - w / 2, w, w);
  if (alpha < 1) ctx.globalAlpha /= alpha;
}
function molAtoms(type, x, y, u, ang = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return MOL[type].map(([el, dx, dy]) => ({ el, x: x + (dx * ca - dy * sa) * u, y: y + (dx * sa + dy * ca) * u }));
}
function drawMol(ctx, type, x, y, u, dpr, ang = 0, alpha = 1) {
  for (const a of molAtoms(type, x, y, u, ang)) drawAtom(ctx, a.el, a.x, a.y, u, dpr, alpha);
}

// ─────────────────────────── 캔버스 공통 ───────────────────────────
function makeView(canvas, W, H) {
  const v = { canvas, ctx: canvas.getContext('2d'), W, H, s: 1, ox: 0, oy: 0, dpr: 1, cw: 0, ch: 0 };
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    v.dpr = quality === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    v.cw = r.width; v.ch = r.height;
    canvas.width = Math.max(1, Math.round(r.width * v.dpr));
    canvas.height = Math.max(1, Math.round(r.height * v.dpr));
    v.s = Math.min(r.width / W, r.height / H);
    v.ox = (r.width - W * v.s) / 2; v.oy = (r.height - H * v.s) / 2;
  };
  v.fit = fit;
  new ResizeObserver(fit).observe(canvas);
  v.begin = () => {
    const c = v.ctx;
    if (!(v.s > 0) || !(v.dpr > 0)) return null;
    c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    c.clearRect(0, 0, v.cw, v.ch);
    c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
    return c;
  };
  v.toLocal = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - v.ox) / v.s, y: (e.clientY - r.top - v.oy) / v.s }; };
  v.toCss = (x, y) => ({ x: v.ox + x * v.s, y: v.oy + y * v.s });
  v.edpr = () => v.dpr * v.s; // 스프라이트 해상도용
  return v;
}
function rrect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

// ═══════════════════════════ ① 물 합성 장치 ═══════════════════════════
const G = {
  W: 900, H: 560, x0: 112, ppm: 12, top: 196, bot: 296, tubeEnd: 488, rod: 380,
  portX: 84, benchY: 452, ignX: 640, ignY: 394,
};
G.xAt = v => G.x0 + v * G.ppm;
const lab = {
  valveOpen: false, gas: 'o2', inj: 6,
  o2: 0, h2: 0,                 // 지금 관 속 산소·수소 부피(mL)
  injO2: 0, injH2: 0,           // 마지막 반응 뒤 넣은 양
  resid: 0, residGas: '없음',    // 마지막 반응에서 남아 있던 기체
  ignitions: 0, last: null, log: [], molView: true, sinceIgnite: false,
  disp: 0, mols: [], drops: [], anim: null, syr: null, spark: 0, btnPress: 0, flash: 0, fog: 0,
};
const labView = makeView($('labCanvas'), G.W, G.H);

function gasVol() { return half(lab.o2 + lab.h2); }

function newMol(type, u, v) {
  const sp = rand(18, 34), a = rand(0, Math.PI * 2);
  return { type, u: u ?? Math.random(), v: v ?? Math.random(), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
    ang: rand(0, 6.28), spin: rand(-1.2, 1.2), born: -1, alpha: 1, water: 0 };
}
function reconcile() {
  for (const [type, want] of [['o2', Math.round(lab.o2 * 2)], ['h2', Math.round(lab.h2 * 2)]]) {
    const list = lab.mols.filter(m => m.type === type);
    for (let i = list.length; i < want; i++) lab.mols.push(newMol(type));
    for (let i = want; i < list.length; i++) lab.mols.splice(lab.mols.indexOf(list[i]), 1);
  }
  lab.mols = lab.mols.filter(m => m.type !== 'w');
  for (const m of lab.mols) m.born = -1;
}
function finishLabAnim() {
  const a = lab.anim;
  if (!a) return;
  lab.anim = null;
  a.finish && a.finish();
  reconcile();
}

function labInject() {
  if (locked()) return;
  finishLabAnim();
  if (!lab.valveOpen) { sfx.thud(); toast('기체 주입구를 먼저 열어요'); return; }
  const n = lab.inj;
  if (gasVol() + n > 30 + 1e-9) { sfx.thud(); toast('장치에 30 mL까지만 넣을 수 있어요'); return; }
  const from = gasVol(), gas = lab.gas;
  if (gas === 'o2') { lab.o2 = half(lab.o2 + n); lab.injO2 += n; } else { lab.h2 = half(lab.h2 + n); lab.injH2 += n; }
  if (lab.ignitions > 0) lab.sinceIgnite = true;
  const to = gasVol();
  const fresh = [];
  for (let i = 0; i < n * 2; i++) { const m = newMol(gas, 0.02, 0.05); m.born = simT + 0.1 + (i / (n * 2)) * 0.7; m.vx = rand(30, 70); m.vy = rand(20, 60); fresh.push(m); lab.mols.push(m); }
  const t0 = simT;
  lab.syr = { gas, n, t0 };
  lab.anim = {
    t0, dur: 0.9,
    step(p) { lab.disp = lerp(from, to, ease.inOutCubic(clamp(p / 0.9, 0, 1))); },
    finish() { lab.disp = to; lab.syr = null; },
  };
  sfx.hiss();
  publish(); updateLabUI();
}

function labValve() {
  if (locked()) return;
  finishLabAnim();
  lab.valveOpen = !lab.valveOpen;
  if (lab.ignitions > 0) lab.sinceIgnite = true;
  sfx.clack();
  publish(); updateLabUI();
}

function labIgnite() {
  if (locked()) return;
  finishLabAnim();
  lab.btnPress = simT;
  sfx.spark();
  if (lab.valveOpen) {
    lab.spark = simT;
    sfx.thud(); toast('기체 주입구를 닫고 점화해요(안전)'); return;
  }
  lab.spark = simT;
  const O = lab.o2, H = lab.h2;
  if (!(O > 0 && H > 0)) {
    setTimeout(() => sfx.thud(), 120);
    toast('반응이 일어나지 않았어요(산소와 수소가 함께 있어야 해요)');
    return;
  }
  // 반응: 수소 : 산소 = 2 : 1 로 반응, 수증기는 응결해 기체 부피 0
  const before = half(O + H);
  let remain, gas;
  if (H >= 2 * O) { remain = half(H - 2 * O); gas = remain > 0 ? '수소' : '없음'; lab.h2 = remain; lab.o2 = 0; }
  else { remain = half(O - H / 2); gas = '산소'; lab.o2 = remain; lab.h2 = 0; }
  if (remain === 0) gas = '없음';
  lab.ignitions++;
  lab.last = { o2: O, h2: H, remain, gas };
  lab.log.push({ o2: O, h2: H, before, remain, gas, no: lab.ignitions });
  if (lab.log.length > 30) lab.log.shift();
  lab.resid = remain; lab.residGas = gas; lab.injO2 = 0; lab.injH2 = 0; lab.sinceIgnite = false;

  // 분자: 산소 분자 1개 + 수소 분자 2개 → 물 분자 2개
  const oL = lab.mols.filter(m => m.type === 'o2').sort(() => Math.random() - 0.5);
  const hL = lab.mols.filter(m => m.type === 'h2').sort(() => Math.random() - 0.5);
  const pairs = Math.min(oL.length, Math.floor(hL.length / 2));
  const peak = Math.min(30, before + Math.max(2.5, before * 0.35));
  let converted = false, dropsAdded = 0;
  const waterCount = pairs * 2;
  const convert = () => {
    if (converted) return; converted = true;
    for (let i = 0; i < pairs; i++) {
      oL[i].type = 'w'; oL[i].water = simT;
      hL[2 * i].type = 'w'; hL[2 * i].water = simT;
      lab.mols.splice(lab.mols.indexOf(hL[2 * i + 1]), 1);
    }
  };
  const totalDrops = clamp(Math.round(waterCount / 3), 3, 16);
  const addDrops = k => { for (; dropsAdded < k; dropsAdded++) lab.drops.push({ u: Math.random(), r: rand(1.8, 4.2), s: Math.random() }); };
  lab.anim = {
    t0: simT, dur: 1.9,
    step(p, t) {
      const tt = p * 1.9;
      if (tt > 0.12) convert();
      lab.flash = tt > 0.1 && tt < 0.35 ? 1 - Math.abs(tt - 0.17) / 0.18 : 0;
      lab.fog = tt < 0.15 ? 0 : tt < 0.35 ? (tt - 0.15) / 0.2 : Math.max(0, 1 - (tt - 0.35) / 1.1);
      if (tt < 0.12) lab.disp = before;
      else if (tt < 0.26) lab.disp = lerp(before, peak, ease.outCubic((tt - 0.12) / 0.14));
      else lab.disp = lerp(peak, remain, ease.inOutCubic(clamp((tt - 0.26) / 1.55, 0, 1)));
      if (tt > 0.9) for (const m of lab.mols) if (m.type === 'w') { m.vy = 55; m.alpha = clamp(1 - (tt - 0.9) / 0.8, 0, 1); }
      if (tt > 1.0) addDrops(Math.round(totalDrops * clamp((tt - 1.0) / 0.7, 0, 1)));
    },
    finish() { convert(); addDrops(totalDrops); lab.disp = remain; lab.flash = 0; lab.fog = 0; },
  };
  sfx.boom(); sfx.drips();
  publish(); updateLabUI();
}

function labEmpty() {
  if (locked()) return;
  finishLabAnim();
  const from = gasVol();
  lab.o2 = 0; lab.h2 = 0; lab.injO2 = 0; lab.injH2 = 0; lab.resid = 0; lab.residGas = '없음';
  if (lab.ignitions > 0) lab.sinceIgnite = true;
  const mols = lab.mols;
  lab.anim = {
    t0: simT, dur: 0.7,
    step(p) { lab.disp = lerp(from, 0, ease.inOutCubic(p)); for (const m of mols) m.alpha = 1 - p; lab.drops.forEach(d => d.fade = 1 - p); },
    finish() { lab.disp = 0; lab.mols = []; lab.drops = []; },
  };
  sfx.vent();
  publish(); updateLabUI();
}

function resetLab() {
  lab.anim = null;
  Object.assign(lab, { valveOpen: false, gas: 'o2', inj: 6, o2: 0, h2: 0, injO2: 0, injH2: 0, resid: 0, residGas: '없음',
    ignitions: 0, last: null, log: [], molView: true, sinceIgnite: false, disp: 0, mols: [], drops: [], syr: null,
    spark: -9, btnPress: -9, flash: 0, fog: 0 });
}

function labStep() {
  if (lab.ignitions === 0) {
    if (!lab.valveOpen && (lab.injO2 < 6 || lab.injH2 < 6)) return 0;
    if (lab.injO2 < 6) return 1;
    if (lab.injH2 < 6) return 2;
    if (lab.valveOpen) return 3;
    return 4;
  }
  return lab.sinceIgnite ? 6 : 5;
}

function updateLabUI() {
  $('volRange').value = lab.inj; $('volOut').textContent = `${lab.inj} mL`;
  document.querySelectorAll('[data-gas]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gas === lab.gas)));
  const vb = $('btnValve');
  vb.textContent = lab.valveOpen ? '기체 주입구 닫기' : '기체 주입구 열기';
  vb.setAttribute('aria-pressed', String(lab.valveOpen));
  $('btnMol').setAttribute('aria-pressed', String(lab.molView));
  $('nowVol').textContent = `${fmtV(gasVol())} mL`;
  const parts = [];
  if (lab.resid > 0) parts.push(`남아 있던 기체 ${fmtV(lab.resid)} mL`);
  if (lab.injO2 > 0) parts.push(`넣은 산소 기체 ${lab.injO2} mL`);
  if (lab.injH2 > 0) parts.push(`넣은 수소 기체 ${lab.injH2} mL`);
  let txt = parts.length ? parts.join(' · ') : '장치 속에 기체가 없어요.';
  if (lab.drops.length || (lab.anim && lab.ignitions && !lab.sinceIgnite)) txt += ' 관 벽에 물방울(액체)이 맺혔어요.';
  $('nowDetail').textContent = txt;
  // 기록표 (최근 6줄)
  const rows = lab.log.slice(-6);
  const body = $('logBody');
  const prevTop = body.dataset.last || '';
  const html = rows.map(r => {
    const g = lab.molView ? r.gas : '?';
    const cls = !lab.molView ? '' : r.gas === '산소' ? 'g-o' : r.gas === '수소' ? 'g-h' : '';
    return `<tr data-no="${r.no}"><td>${r.no}</td><td>${fmtV(r.before)}</td><td>${fmtV(r.remain)}</td><td class="${cls}">${g}</td></tr>`;
  }).join('');
  body.innerHTML = html || '<tr><td colspan="4" class="empty">점화해서 반응이 일어나면 한 줄씩 기록돼요.</td></tr>';
  const lastNo = rows.length ? String(rows[rows.length - 1].no) : '';
  if (lastNo && lastNo !== prevTop) body.lastElementChild.classList.add('newrow');
  body.dataset.last = lastNo;
  // 단계 안내
  const cur = labStep();
  document.querySelectorAll('#labSteps li').forEach((li, i) => {
    li.classList.toggle('now', i === cur);
    li.classList.toggle('done', i < cur || (i === 6 && lab.ignitions >= 2 && cur === 5));
  });
}

// ── 장치 그리기 ──
function drawLab(dt) {
  const v = labView, c = v.begin(), dpr = v.edpr(), hiQ = quality === 'high';
  if (!c) return;
  const { x0, top, bot, tubeEnd, benchY } = G;
  const midY = (top + bot) / 2;
  const disp = clamp(lab.disp, 0, 30);
  const px = G.xAt(disp);
  // 벽·실험대
  c.fillStyle = '#eef3f8'; c.fillRect(-400, -200, G.W + 800, benchY + 200);
  const bg = c.createLinearGradient(0, benchY, 0, G.H);
  bg.addColorStop(0, '#d7c3a5'); bg.addColorStop(0.08, '#b8976c'); bg.addColorStop(1, '#8e6c45');
  c.fillStyle = bg; c.fillRect(-400, benchY, G.W + 800, G.H - benchY + 200);
  c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(-400, benchY, G.W + 800, 3);
  c.fillStyle = 'rgba(255,255,255,.85)'; c.font = `600 15px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillText('온도와 압력은 실온·대기압으로 일정해요', 20, G.H - 40);
  if (lab.molView) { c.font = `14px ${FONT}`; c.fillText('분자 모형 1개 = 기체 0.5 mL (실제로는 훨씬 많은 분자가 있어요)', 20, G.H - 16); }

  // 분자 모형 범례
  if (lab.molView) {
    c.save();
    c.fillStyle = 'rgba(255,255,255,.8)'; rrect(c, 300, 22, 430, 46, 12); c.fill();
    c.strokeStyle = '#d9dee7'; c.lineWidth = 1; c.stroke();
    c.font = `600 14px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#1d2433';
    [['H2', '수소 분자', 330], ['O2', '산소 분자', 455], ['H2O', '물 분자 → 물방울', 582]].forEach(([t, name, x]) => {
      drawMol(c, t, x, 45, 5.5, dpr); c.fillText(name, x + 20, 46);
    });
    c.restore();
  }
  // 받침대
  for (const sx of [70, 230, 420]) {
    c.fillStyle = '#2b2f36';
    c.fillRect(sx - 5, bot + 8, 10, benchY - bot - 14);
    rrect(c, sx - 34, benchY - 10, 68, 12, 4); c.fill();
    c.beginPath(); c.moveTo(sx - 22, bot + 12); c.lineTo(sx + 22, bot + 12); c.lineTo(sx + 12, bot - 2); c.lineTo(sx - 12, bot - 2); c.closePath(); c.fill();
  }
  // 전선 (전극 → 점화기)
  c.strokeStyle = '#c0392b'; c.lineWidth = 3; c.lineCap = 'round';
  c.beginPath(); c.moveTo(78, bot + 22); c.bezierCurveTo(60, benchY - 10, 300, benchY + 2, G.ignX - 8, G.ignY + 30); c.stroke();
  c.strokeStyle = '#1d2433';
  c.beginPath(); c.moveTo(92, bot + 22); c.bezierCurveTo(90, benchY - 20, 330, benchY - 6, G.ignX - 8, G.ignY + 40); c.stroke();

  // 피스톤 막대·손잡이 (관 뒤에서 먼저)
  const rodEnd = px + 14 + G.rod;
  const rg = c.createLinearGradient(0, midY - 6, 0, midY + 6);
  rg.addColorStop(0, '#e9edf2'); rg.addColorStop(0.5, '#9aa4b1'); rg.addColorStop(1, '#6b7684');
  c.fillStyle = rg; c.fillRect(px + 12, midY - 5, G.rod + 4, 10);
  const hg = c.createLinearGradient(rodEnd, 0, rodEnd + 22, 0);
  hg.addColorStop(0, '#3b4350'); hg.addColorStop(1, '#1f242c');
  c.fillStyle = hg; rrect(c, rodEnd, midY - 38, 20, 76, 6); c.fill();
  c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(rodEnd + 3, midY - 34, 3, 68);

  // 머리 부분 (막힌 끝)
  const headG = c.createLinearGradient(0, top - 26, 0, bot + 26);
  headG.addColorStop(0, '#5d6776'); headG.addColorStop(0.5, '#8893a2'); headG.addColorStop(1, '#4a525e');
  c.fillStyle = headG; rrect(c, 44, top - 22, x0 - 44 + 2, bot - top + 44, 8); c.fill();
  // 점화 전극 단자
  c.fillStyle = '#c9a227'; c.fillRect(74, bot + 18, 8, 8); c.fillRect(88, bot + 18, 8, 8);
  // 기체 주입구 (꼭지)
  const pX = G.portX;
  c.fillStyle = '#7b8594'; c.fillRect(pX - 7, top - 64, 14, 44);
  const vOpen = lab.valveOpen;
  c.save(); c.translate(pX, top - 44);
  c.fillStyle = vOpen ? '#1a8f5a' : '#8a94a3';
  c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fill();
  c.rotate(vOpen ? 0 : Math.PI / 2);
  rrect(c, -4, -22, 8, 44, 4); c.fill();
  c.restore();
  c.fillStyle = vOpen ? '#1a8f5a' : '#5b6577'; c.font = `700 14px ${FONT}`; c.textAlign = 'left';
  c.fillText(vOpen ? '기체 주입구: 열림' : '기체 주입구: 닫힘', pX + 30, top - 58);

  // 유리관
  c.fillStyle = 'rgba(214,232,247,.35)'; rrect(c, x0 - 4, top - 7, tubeEnd - x0 + 4, bot - top + 14, 6); c.fill();
  // 기체 칸
  if (px > x0) {
    c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(x0, top, px - x0, bot - top);
    if (lab.fog > 0) { c.fillStyle = `rgba(236,240,246,${0.8 * lab.fog})`; c.fillRect(x0, top, px - x0, bot - top); }
  }
  // 물방울 (액체, 기체 부피에 들어가지 않음)
  for (const d of lab.drops) {
    const span = Math.max(6, px - x0 - 6);
    const dx = x0 + 3 + d.u * span, dy = bot - d.r - 0.5;
    c.globalAlpha = d.fade ?? 1;
    if (hiQ) {
      const dg = c.createRadialGradient(dx - d.r * 0.3, dy - d.r * 0.4, 0.3, dx, dy, d.r);
      dg.addColorStop(0, '#e8f4ff'); dg.addColorStop(0.6, '#5aa7f0'); dg.addColorStop(1, '#2f80ed');
      c.fillStyle = dg;
    } else c.fillStyle = '#4d9be9';
    c.beginPath(); c.ellipse(dx, dy, d.r * 1.15, d.r, 0, 0, Math.PI * 2); c.fill();
    if (d.s > 0.5) { c.beginPath(); c.ellipse(x0 + 3 + ((d.u + 0.37) % 1) * span, top + d.r * 0.8 + 1, d.r * 0.8, d.r * 0.7, 0, 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
  }
  // 분자 (기체 칸 안)
  const L = Math.max(4, px - x0 - 10), hgt = bot - top - 16;
  if (!paused) {
    for (const m of lab.mols) {
      if (m.born > simT) continue;
      m.u += (m.vx * dt) / L; m.v += (m.vy * dt) / hgt; m.ang += m.spin * dt;
      if (m.u < 0) { m.u = -m.u; m.vx = Math.abs(m.vx); } if (m.u > 1) { m.u = 2 - m.u; m.vx = -Math.abs(m.vx); }
      if (m.v < 0) { m.v = -m.v; m.vy = Math.abs(m.vy); } if (m.v > 1) { m.v = 2 - m.v; m.vy = -Math.abs(m.vy) * (m.type === 'w' ? 0 : 1); }
      m.u = clamp(m.u, 0, 1); m.v = clamp(m.v, 0, 1);
      const sp = Math.hypot(m.vx, m.vy);
      if (m.type !== 'w' && sp > 50) { m.vx *= 0.97; m.vy *= 0.97; }
      if (m.type !== 'w' && sp < 14) { m.vx *= 1.05; m.vy *= 1.05; }
    }
  }
  if (lab.molView) {
    c.save(); c.beginPath(); c.rect(x0, top, Math.max(0, px - x0), bot - top); c.clip();
    for (const m of lab.mols) {
      if (m.born > simT) continue;
      const x = x0 + 5 + m.u * L, y = top + 8 + m.v * hgt;
      const t = m.type === 'o2' ? 'O2' : m.type === 'h2' ? 'H2' : 'H2O';
      drawMol(c, t, x, y, 5, dpr, m.ang, m.alpha);
    }
    c.restore();
  }
  if (lab.flash > 0) {
    c.save();
    const fg = c.createRadialGradient(x0 + 10, midY, 2, x0 + 10, midY, Math.max(30, px - x0 + 40));
    fg.addColorStop(0, `rgba(255,250,200,${lab.flash})`); fg.addColorStop(1, `rgba(255,190,60,${0.4 * lab.flash})`);
    c.fillStyle = fg; c.fillRect(x0, top, Math.max(8, px - x0), bot - top);
    c.restore();
  }
  // 유리 테두리·반사
  c.strokeStyle = 'rgba(90,120,150,.55)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x0 - 2, top - 1); c.lineTo(tubeEnd, top - 1); c.moveTo(x0 - 2, bot + 1); c.lineTo(tubeEnd, bot + 1); c.stroke();
  if (hiQ) { c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(x0 + 4, top + 3, tubeEnd - x0 - 10, 3); }
  c.fillStyle = '#6b7684'; rrect(c, tubeEnd - 4, top - 10, 10, bot - top + 20, 3); c.fill();
  // 피스톤 (고무)
  const pg = c.createLinearGradient(px, 0, px + 14, 0);
  pg.addColorStop(0, '#2a2e35'); pg.addColorStop(0.5, '#4a505a'); pg.addColorStop(1, '#2a2e35');
  c.fillStyle = pg; rrect(c, px, top + 1, 14, bot - top - 2, 3); c.fill();
  c.fillStyle = '#1d2026'; c.fillRect(px + 3, top + 1, 2, bot - top - 2); c.fillRect(px + 9, top + 1, 2, bot - top - 2);

  // 점화 전극 불꽃
  const st = simT - lab.spark;
  if (st >= 0 && st < 0.22) {
    c.save(); c.strokeStyle = '#fff7a8'; c.lineWidth = 2.2; c.shadowColor = '#ffd23c'; c.shadowBlur = hiQ ? 14 : 0;
    c.beginPath(); c.moveTo(x0 + 1, midY + 18); c.lineTo(x0 + 7, midY + 22); c.lineTo(x0 + 3, midY + 26); c.lineTo(x0 + 9, midY + 30); c.stroke();
    c.restore();
  }
  c.fillStyle = '#c9a227'; c.fillRect(x0 - 6, midY + 16, 7, 3); c.fillRect(x0 - 6, midY + 30, 7, 3);

  // 눈금자 (관 위쪽, 0~30 mL)
  const ry = top - 34;
  c.fillStyle = '#fffdf3'; rrect(c, x0 - 10, ry, 30 * G.ppm + 20, 26, 4); c.fill();
  c.strokeStyle = '#b9b29a'; c.lineWidth = 1; c.stroke();
  c.strokeStyle = '#3a3f48'; c.fillStyle = '#3a3f48'; c.textAlign = 'center'; c.font = `600 12px ${FONT}`;
  for (let i = 0; i <= 30; i++) {
    const x = G.xAt(i), big = i % 5 === 0;
    c.lineWidth = big ? 1.4 : 1;
    c.beginPath(); c.moveTo(x, ry + 26); c.lineTo(x, ry + 26 - (big ? 11 : 6)); c.stroke();
    if (big) c.fillText(String(i), x, ry + 11);
  }
  c.textAlign = 'left'; c.font = `600 12px ${FONT}`; c.fillText('mL', G.xAt(30) + 12, ry + 20);
  // 피스톤 가장자리 표시선
  c.strokeStyle = '#e5533d'; c.lineWidth = 2; c.beginPath(); c.moveTo(px, ry + 14); c.lineTo(px, top + 2); c.stroke();

  // 눈금 읽기 돋보기 (피스톤 아래)
  const mx = clamp(px, 150, 520), my = bot + 34, mw = 180, mh = 78, zoom = 34;
  c.strokeStyle = 'rgba(229,83,61,.6)'; c.setLineDash([3, 3]); c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(px, bot + 2); c.lineTo(mx, my); c.stroke(); c.setLineDash([]);
  c.save();
  if (hiQ) { c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = 8; c.shadowOffsetY = 2; }
  c.fillStyle = '#fffdf3'; rrect(c, mx - mw / 2, my, mw, mh, 10); c.fill();
  c.restore();
  c.strokeStyle = '#1d2433'; c.lineWidth = 2; rrect(c, mx - mw / 2, my, mw, mh, 10); c.stroke();
  c.save(); rrect(c, mx - mw / 2 + 2, my + 2, mw - 4, 40, 8); c.clip();
  c.fillStyle = '#3a3f48'; c.strokeStyle = '#3a3f48'; c.textAlign = 'center'; c.font = `700 13px ${FONT}`;
  for (let i = Math.floor(disp) - 3; i <= Math.ceil(disp) + 3; i++) {
    for (const hf of [0, 0.5]) {
      const val = i + hf; if (val < 0 || val > 30) continue;
      const x = mx + (val - disp) * zoom, full = hf === 0;
      c.lineWidth = full ? 1.6 : 1;
      c.beginPath(); c.moveTo(x, my + 2); c.lineTo(x, my + (full ? 18 : 11)); c.stroke();
      if (full) c.fillText(String(val), x, my + 34);
    }
  }
  c.restore();
  c.strokeStyle = '#e5533d'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(mx, my + 1); c.lineTo(mx, my + 22); c.stroke();
  c.strokeStyle = '#d9d2b8'; c.lineWidth = 1; c.beginPath(); c.moveTo(mx - mw / 2 + 8, my + 43); c.lineTo(mx + mw / 2 - 8, my + 43); c.stroke();
  const settled = !lab.anim;
  c.fillStyle = '#1d2433'; c.font = `700 15px ${FONT}`; c.textAlign = 'center';
  c.fillText(settled ? `눈금 읽기: ${fmtV(disp)} mL` : '눈금 읽기: 움직이는 중…', mx, my + mh - 12);

  // 주사기
  if (lab.syr) {
    const s = lab.syr;
    const p = s ? clamp((simT - s.t0) / 0.8, 0, 1) : 1;
    const e = ease.inOutCubic(p);
    const bx = pX - 16, byTop = 26, byBot = top - 70, bw = 32;
    const fill = (1 - e);
    c.save();
    c.fillStyle = 'rgba(230,240,250,.8)'; rrect(c, bx, byTop, bw, byBot - byTop, 4); c.fill();
    c.strokeStyle = '#7d8b9b'; c.lineWidth = 1.5; c.stroke();
    const gasCol = s && s.gas === 'o2' ? '#e04848' : '#8a99aa';
    const plY = byTop + 6 + (byBot - byTop - 14) * e;
    c.fillStyle = gasCol; c.globalAlpha = 0.18; c.fillRect(bx + 2, plY + 6, bw - 4, byBot - plY - 7); c.globalAlpha = 1;
    c.fillStyle = gasCol; c.fillRect(bx, byTop + 12, 4, byBot - byTop - 20);
    for (let k = 1; k < 10; k++) { const yy = byTop + 6 + (byBot - byTop - 14) * k / 10; c.strokeStyle = '#7d8b9b'; c.lineWidth = 1; c.beginPath(); c.moveTo(bx + bw - 10, yy); c.lineTo(bx + bw, yy); c.stroke(); }
    c.fillStyle = '#3b4350'; c.fillRect(bx + 2, plY, bw - 4, 7);
    c.fillStyle = '#9aa4b1'; c.fillRect(pX - 3, plY - 30 * fill - 18, 6, 30 * fill + 18);
    c.fillStyle = '#3b4350'; rrect(c, pX - 18, plY - 30 * fill - 26, 36, 8, 3); c.fill();
    c.fillStyle = '#9aa4b1'; c.fillRect(pX - 1.5, byBot, 3, 12);
    if (s) {
      c.fillStyle = gasCol === '#e04848' ? '#c73636' : '#4f5d6e'; c.font = `700 15px ${FONT}`; c.textAlign = 'left';
      c.fillText(`${s.gas === 'o2' ? '산소 기체' : '수소 기체'} ${s.n} mL`, bx + bw + 10, byTop + 44);
    }
    c.restore();
  }

  // 점화기 (손잡이형)
  const ix = G.ignX, iy = G.ignY, pr = simT - lab.btnPress < 0.15 ? 3 : 0;
  c.save();
  if (hiQ) { c.shadowColor = 'rgba(0,0,0,.3)'; c.shadowBlur = 8; c.shadowOffsetY = 3; }
  const ig = c.createLinearGradient(ix, 0, ix + 120, 0);
  ig.addColorStop(0, '#4a525e'); ig.addColorStop(1, '#2b3038');
  c.fillStyle = ig; rrect(c, ix, iy + 14, 120, 44, 14); c.fill();
  c.restore();
  c.fillStyle = '#20242b'; rrect(c, ix + 34, iy + 6 + pr, 46, 14, 5); c.fill();
  const bgd = c.createRadialGradient(ix + 52, iy + 4 + pr, 2, ix + 57, iy + 10 + pr, 22);
  bgd.addColorStop(0, '#ff8b74'); bgd.addColorStop(1, '#c62f1a');
  c.fillStyle = bgd; rrect(c, ix + 38, iy + pr, 38, 14, 6); c.fill();
  c.fillStyle = '#fff'; c.font = `700 14px ${FONT}`; c.textAlign = 'center'; c.fillText('점화기', ix + 60, iy + 44);
  G.hitIgn = { x: ix, y: iy - 6, w: 120, h: 64 };
  G.hitValve = { x: pX - 24, y: top - 70, w: 48, h: 50 };
}

// ═══════════════════════════ ② 부피 상자 모형 ═══════════════════════════
const RX = {
  water: { A: { f: 'H₂', n: '수소', m: 'H2' }, B: { f: 'O₂', n: '산소', m: 'O2' }, C: { f: 'H₂O', n: '수증기', m: 'H2O' }, a: 2, b: 1, c: 2, init: [2, 1],
    note: '수증기가 기체로 있는 높은 온도에서, 온도와 압력이 일정할 때' },
  hcl: { A: { f: 'H₂', n: '수소', m: 'H2' }, B: { f: 'Cl₂', n: '염소', m: 'Cl2' }, C: { f: 'HCl', n: '염화 수소', m: 'HCl' }, a: 1, b: 1, c: 2, init: [1, 1], note: '온도와 압력이 일정할 때' },
  nh3: { A: { f: 'N₂', n: '질소', m: 'N2' }, B: { f: 'H₂', n: '수소', m: 'H2' }, C: { f: 'NH₃', n: '암모니아', m: 'NH3' }, a: 1, b: 3, c: 2, init: [1, 3], note: '온도와 압력이 일정할 때' },
};
const K = { W: 900, H: 470, S: 58, g: 10, rowB: 78, rowA: 282, eqY: 438, u: 9.5 };
const CARDS = [
  { key: '가', mols: [['NH3', 0, 0]] },
  { key: '나', mols: [['N2H6', 0, 0]] },
  { key: '다', mols: [['NH', 0, 0]] },
  { key: '라', mols: [['N2', 0, -1.35], ['H2', 0, 1.6]] },
];
const cube = { rx: 'water', st: {}, anim: null, sel: null, nh3Solved: false, nh3Tries: 0, pops: [], order: [] };
const cubeView = makeView($('cubeCanvas'), K.W, K.H);

function initCube() {
  cube.st = {};
  for (const k in RX) cube.st[k] = { A: RX[k].init[0], B: RX[k].init[1], reacted: false, n: 0 };
  cube.rx = 'water'; cube.anim = null; cube.sel = null; cube.nh3Solved = false; cube.nh3Tries = 0; cube.pops = [];
  cube.order = CARDS.map((_, i) => i).sort(() => Math.random() - 0.5);
  buildCards();
}
const curRx = () => RX[cube.rx];
const curSt = () => cube.st[cube.rx];
const nh3Locked = () => cube.rx === 'nh3' && !cube.nh3Solved;
const reactN = (rx, st) => Math.min(Math.floor(st.A / rx.a), Math.floor(st.B / rx.b));

// 상자 위치 계산 (논리 좌표). groups: [{count, kind, key}] → 상자 좌상단 x 목록
function rowLayout(groups, sepW) {
  const { S, g } = K;
  const ws = groups.map(gr => Math.max(S, gr.count * S + Math.max(0, gr.count - 1) * g));
  const total = ws.reduce((a, b) => a + b, 0) + sepW * Math.max(0, groups.length - 1);
  let x = (K.W - total) / 2;
  const out = [];
  groups.forEach((gr, i) => {
    const xs = [];
    const inner = gr.count * S + Math.max(0, gr.count - 1) * g;
    let bx = x + (ws[i] - Math.max(inner, 0)) / 2;
    for (let k = 0; k < gr.count; k++) { xs.push(bx); bx += S + g; }
    out.push({ ...gr, xs, cx: x + ws[i] / 2, x, w: ws[i] });
    x += ws[i] + sepW;
  });
  return out;
}
function beforeLayout(rx, st) {
  return rowLayout([{ count: st.A, key: 'A' }, { count: st.B, key: 'B' }], 56);
}
function afterLayout(rx, st, n) {
  const gs = [];
  if (n > 0) gs.push({ count: rx.c * n, key: 'C' });
  if (st.A - rx.a * n > 0) gs.push({ count: st.A - rx.a * n, key: 'LA' });
  if (st.B - rx.b * n > 0) gs.push({ count: st.B - rx.b * n, key: 'LB' });
  return rowLayout(gs, 44);
}

function drawBox(c, x, y, S, { alpha = 1, dashed = false, faint = false, scale = 1, hl = false } = {}) {
  c.save();
  c.globalAlpha *= alpha;
  const cx = x + S / 2, cy = y + S / 2;
  c.translate(cx, cy); c.scale(scale, scale); c.translate(-cx, -cy);
  const d = 9;
  // 윗면·옆면 (살짝 입체)
  c.fillStyle = faint ? 'rgba(200,210,225,.18)' : 'rgba(170,205,240,.32)';
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + d, y - d); c.lineTo(x + S + d, y - d); c.lineTo(x + S, y); c.closePath(); c.fill();
  c.fillStyle = faint ? 'rgba(200,210,225,.12)' : 'rgba(140,180,225,.3)';
  c.beginPath(); c.moveTo(x + S, y); c.lineTo(x + S + d, y - d); c.lineTo(x + S + d, y + S - d); c.lineTo(x + S, y + S); c.closePath(); c.fill();
  c.fillStyle = faint ? 'rgba(235,240,248,.35)' : 'rgba(225,238,252,.55)';
  c.fillRect(x, y, S, S);
  c.strokeStyle = hl ? '#1f6feb' : faint ? 'rgba(110,125,145,.55)' : 'rgba(70,110,160,.85)';
  c.lineWidth = hl ? 2.5 : 1.5;
  if (dashed) c.setLineDash([5, 4]);
  c.strokeRect(x, y, S, S);
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + d, y - d); c.lineTo(x + S + d, y - d); c.lineTo(x + S + d, y + S - d); c.lineTo(x + S, y + S); c.moveTo(x + S, y); c.lineTo(x + S + d, y - d); c.stroke();
  c.restore();
}

function label(c, text, x, y, color = '#1d2433', size = 15, weight = 600) {
  c.fillStyle = color; c.font = `${weight} ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(text, x, y);
}

// 반응시키기: 계수 묶음 단위로 반응 n = min(⌊A/a⌋, ⌊B/b⌋)
function cubeReact(fromCard = false) {
  if (locked()) return;
  const rx = curRx(), st = curSt();
  if (nh3Locked() && !fromCard) return;
  finishCubeAnim();
  if (!fromCard) msgOverride = null;
  if (st.reacted) { st.reacted = false; }
  const n = reactN(rx, st);
  st.n = n; st.reacted = true;
  if (n === 0) { sfx.thud(); publish(); updateCubeUI(); return; }
  // 원자 이동 애니메이션 만들기
  const { S, u } = K;
  const bl = beforeLayout(rx, st), al = afterLayout(rx, st, n);
  const gA = bl[0], gB = bl[1], gC = al.find(x => x.key === 'C');
  const atoms = [];
  for (let k = 0; k < n; k++) {
    const pool = {};
    const take = (type, bx, by) => molAtoms(type, bx + S / 2, by + S / 2, u).forEach(a => (pool[a.el] = pool[a.el] || []).push(a));
    for (let i = 0; i < rx.a; i++) take(rx.A.m, gA.xs[rx.a * k + i], K.rowB);
    for (let i = 0; i < rx.b; i++) take(rx.B.m, gB.xs[rx.b * k + i], K.rowB);
    for (let i = 0; i < rx.c; i++) {
      const tx = gC.xs[rx.c * k + i];
      for (const t of molAtoms(rx.C.m, tx + S / 2, K.rowA + S / 2, u)) {
        const src = pool[t.el].shift();
        const ang = Math.random() * 6.28;
        atoms.push({ el: t.el, x0: src.x, y0: src.y, x1: t.x, y1: t.y, sx: src.x + Math.cos(ang) * 16, sy: src.y + Math.sin(ang) * 16 + 10 });
      }
    }
  }
  cube.anim = { t0: simT, dur: 2.0, rx: cube.rx, atoms, n };
  sfx.rise3();
  publish(); updateCubeUI();
}
function finishCubeAnim() { cube.anim = null; }
function cubeUndo() {
  if (locked()) return;
  const st = curSt();
  if (nh3Locked()) return;
  finishCubeAnim(); msgOverride = null;
  st.reacted = false; st.n = 0;
  sfx.whoosh(); publish(); updateCubeUI();
}
function cubeCount(which, d) {
  if (locked()) return;
  if (nh3Locked()) { sfx.buzz(); toast('먼저 아래 적용하기 카드로 빈 상자를 채워 보자'); return; }
  const st = curSt();
  const nv = clamp(st[which] + d, 0, 6);
  if (nv === st[which]) { sfx.thud(); toast(d > 0 ? '상자는 6개까지 넣을 수 있어요' : '상자가 없어요'); return; }
  finishCubeAnim(); msgOverride = null;
  st.reacted = false; st.n = 0;
  st[which] = nv;
  cube.pops.push({ which, idx: d > 0 ? nv - 1 : nv, t0: simT, dir: d });
  sfx.tok(d > 0);
  publish(); updateCubeUI();
}
function setRx(k) {
  if (locked()) return;
  finishCubeAnim(); msgOverride = null;
  cube.rx = k; cube.sel = null;
  hideBubble();
  sfx.soft(); publish(); updateCubeUI();
}

// 적용하기 카드 판정: 반응 전 원자 수 ÷ 생성물 상자 수 = 상자 1개의 원자 수
function cardAtoms(card) {
  const cnt = { N: 0, H: 0 };
  for (const [t] of card.mols) for (const [el] of MOL[t]) cnt[el] = (cnt[el] || 0) + 1;
  return cnt;
}
function tryCard(ci) {
  if (locked() || !nh3Locked()) return;
  const rx = RX.nh3, st = cube.st.nh3, card = CARDS[ci];
  cube.nh3Tries++;
  const atomsBefore = { N: st.A * 2, H: st.B * 2 };
  const boxes = rx.c * reactN(rx, st);
  const need = { N: atomsBefore.N / boxes, H: atomsBefore.H / boxes };
  const have = cardAtoms(card);
  const el = document.querySelector(`.card[data-i="${ci}"]`);
  cube.sel = null;
  if (card.mols.length === 1 && have.N === need.N && have.H === need.H) {
    cube.nh3Solved = true;
    sfx.dingdong();
    setMsg(`알맞아요! 반응 전 질소 원자 ${atomsBefore.N}개·수소 원자 ${atomsBefore.H}개가 상자 ${boxes}개에 똑같이 나뉘어 암모니아 분자 ${boxes}개가 되었어요.`, 'good', 6000);
    cubeReact(true);
    return;
  }
  sfx.buzz();
  if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  if (card.mols.length > 1) setMsg(`(${card.key})는 분자가 따로 떨어져 있어 반응하지 않은 혼합 기체예요. 상자 1개에는 새로 생긴 분자 1개가 들어가요.`, 'warn', 7000);
  else setMsg(`반응 전 질소 원자 ${atomsBefore.N}개·수소 원자 ${atomsBefore.H}개가 상자 ${boxes}개에 똑같이 나뉘어 들어가야 해요. (${card.key})를 상자 ${boxes}개에 넣으면 질소 원자 ${have.N * boxes}개·수소 원자 ${have.H * boxes}개가 돼요.`, 'warn', 7000);
  publish(); updateCubeUI();
}

let msgOverride = null;
function setMsg(text, cls, ms) { msgOverride = { text, cls, until: performance.now() + ms }; }

function buildCards() {
  const list = $('cardList');
  list.innerHTML = '';
  for (const i of cube.order) {
    const b = document.createElement('button');
    b.className = 'card'; b.dataset.i = i;
    b.setAttribute('aria-label', `분자 모형 카드 (${CARDS[i].key})`);
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 124;
    const sp = document.createElement('span'); sp.textContent = `(${CARDS[i].key})`;
    b.append(cv, sp); list.appendChild(b);
    drawCard(cv, CARDS[i]);
    attachCardDrag(b, i);
  }
}
function drawCard(cv, card) {
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  const u = card.mols[0][0] === 'N2H6' ? 6.6 : card.mols.length > 1 ? 7.4 : 8.6;
  c.setTransform(2, 0, 0, 2, 0, 0);
  for (const [t, dx, dy] of card.mols) drawMol(c, t, 40 + dx * u, 31 + dy * u, u, 2);
}

// 카드 끌기 (Pointer Events)
function attachCardDrag(btn, i) {
  let st = null;
  btn.addEventListener('pointerdown', e => {
    if (locked() || !nh3Locked()) return;
    st = { x: e.clientX, y: e.clientY, drag: false, ghost: null, id: e.pointerId };
    btn.setPointerCapture(e.pointerId);
  });
  btn.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    if (!st.drag && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) {
      st.drag = true;
      const g = btn.cloneNode(true); g.classList.add('ghost'); g.classList.remove('sel', 'shake');
      const cv = g.querySelector('canvas'); drawCard(cv, CARDS[i]);
      document.body.appendChild(g); st.ghost = g;
      sfx.soft();
    }
    if (st.drag) { st.ghost.style.left = e.clientX + 'px'; st.ghost.style.top = e.clientY + 'px'; }
  });
  const end = e => {
    if (!st) return;
    const s = st; st = null;
    if (!s.drag) return;
    btn.dataset.dragged = '1';
    setTimeout(() => delete btn.dataset.dragged, 50);
    const p = cubeView.toLocal(e);
    const hit = (cube.empties || []).some(r => p.x > r.x - 12 && p.x < r.x + r.s + 20 && p.y > r.y - 20 && p.y < r.y + r.s + 12);
    if (hit) { s.ghost.remove(); tryCard(i); }
    else {
      const r = btn.getBoundingClientRect();
      s.ghost.classList.add('back');
      s.ghost.style.left = r.left + r.width / 2 + 'px'; s.ghost.style.top = r.top + r.height / 2 + 'px';
      setTimeout(() => s.ghost.remove(), 320);
    }
  };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('click', () => {
    if (locked() || !nh3Locked() || btn.dataset.dragged) return;
    if (cube.sel === i) { tryCard(i); return; }
    cube.sel = i; sfx.soft();
    setMsg(`(${CARDS[i].key}) 카드를 골랐어요. 빈 상자를 눌러 넣어 보자.`, '', 5000);
    updateCubeUI();
  });
}

// 상자 말풍선
let bubbleTimer = 0;
function showBubble(x, y) {
  const b = $('bubble'), p = cubeView.toCss(x, y);
  b.textContent = '일정한 온도와 압력에서 같은 부피 속 분자 수는 기체 종류와 관계없이 같아요(분자 사이 거리가 분자 크기보다 훨씬 멀어서).';
  b.hidden = false;
  const w = cubeView.cw;
  b.style.left = clamp(p.x, 150, Math.max(150, w - 150)) + 'px';
  b.style.top = Math.max(p.y, 110) + 'px';
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, 4500);
}
function hideBubble() { $('bubble').hidden = true; }

function drawCube() {
  const v = cubeView, c = v.begin(), dpr = v.edpr();
  if (!c) return;
  const rx = curRx(), st = curSt(), { S, u, rowB, rowA } = K;
  const an = cube.anim && cube.anim.rx === cube.rx ? cube.anim : null;
  const p = an ? clamp((simT - an.t0) / an.dur, 0, 1) : 1;
  if (an && p >= 1) cube.anim = null;
  const reacted = st.reacted, n = reacted ? st.n : 0;
  cube.hits = []; cube.empties = [];

  // 줄 제목
  c.fillStyle = 'rgba(255,255,255,.6)'; rrect(c, 12, rowB - 40, K.W - 24, S + 92, 14); c.fill();
  c.fillStyle = 'rgba(255,255,255,.6)'; rrect(c, 12, rowA - 40, K.W - 24, S + 92, 14); c.fill();
  c.textAlign = 'left'; c.font = `700 15px ${FONT}`; c.fillStyle = '#5b6577';
  c.fillText('반응 전', 26, rowB - 18); c.fillText('반응 후', 26, rowA - 18);
  // 화살표
  const ax = K.W / 2;
  c.fillStyle = reacted ? '#1f6feb' : '#b5bfcc';
  c.fillRect(ax - 7, rowB + S + 60, 14, 52);
  c.beginPath(); c.moveTo(ax - 20, rowB + S + 108); c.lineTo(ax + 20, rowB + S + 108); c.lineTo(ax, rowB + S + 128); c.closePath(); c.fill();

  // 반응 전 줄
  const bl = beforeLayout(rx, st);
  const leftA = st.A - rx.a * n, leftB = st.B - rx.b * n;
  bl.forEach((gr, gi) => {
    const sp = gi === 0 ? rx.A : rx.B;
    if (gr.count === 0) drawBox(c, gr.cx - S / 2, rowB, S, { dashed: true, faint: true, alpha: 0.7 });
    gr.xs.forEach((x, i) => {
      const pop = cube.pops.find(q => q.which === gr.key && q.idx === i && q.dir > 0);
      let sc = 1;
      if (pop) { const t = (simT - pop.t0) / 0.25; sc = t >= 1 ? 1 : easeOutBack(clamp(t, 0, 1)); }
      const reactedBox = reacted && i < (gi === 0 ? rx.a : rx.b) * n;
      const leftoverBox = reacted && !reactedBox;
      const fade = reactedBox ? (an ? 1 - 0.6 * clamp(p / 0.3, 0, 1) : 0.4) : leftoverBox ? (an ? 1 - 0.6 * clamp(p / 0.6, 0, 1) : 0.4) : 1;
      drawBox(c, x, rowB, S, { alpha: fade, dashed: reacted && !an, faint: reacted, scale: sc });
      if (!reacted) {
        c.save(); c.translate(x + S / 2, rowB + S / 2); c.scale(sc, sc);
        drawMol(c, sp.m, 0, 0, u, dpr); c.restore();
        cube.hits.push({ x, y: rowB, s: S });
      } else if (an && leftoverBox) {
        // 남은 상자: 반응 후 줄로 미끄러짐 (아래에서 그림)
      } else if (!an) {
        drawMol(c, sp.m, x + S / 2, rowB + S / 2, u, dpr, 0, 0.25);
      }
    });
    // 사라지는 상자
    for (const q of cube.pops) if (q.which === gr.key && q.dir < 0) {
      const t = (simT - q.t0) / 0.25;
      if (t < 1) {
        const x = gr.count ? gr.xs[gr.count - 1] + S + K.g : gr.cx - S / 2;
        drawBox(c, x, rowB, S, { scale: 1 - ease.outCubic(t), alpha: 1 - t });
      }
    }
    label(c, `${sp.n} ${gr.count} 부피`, gr.cx, rowB + S + 30, gi === 0 ? '#1d2433' : '#1d2433');
  });
  if (bl.length === 2) label(c, '+', (bl[0].x + bl[0].w + bl[1].x) / 2, rowB + S / 2 + 12, '#5b6577', 30, 700);
  cube.pops = cube.pops.filter(q => simT - q.t0 < 0.3);

  // 반응 후 줄
  if (nh3Locked()) {
    const al = afterLayout(rx, st, 1);
    const gC = al[0];
    gC.xs.forEach(x => {
      drawBox(c, x, rowA, S, { dashed: true, hl: cube.sel != null });
      label(c, '?', x + S / 2, rowA + S / 2 + 10, '#8a94a3', 28, 700);
      cube.empties.push({ x, y: rowA, s: S });
    });
    label(c, `${rx.C.n} ${gC.count} 부피`, gC.cx, rowA + S + 30);
  } else if (!reacted) {
    c.fillStyle = '#8a94a3'; c.font = `15px ${FONT}`; c.textAlign = 'center';
    c.fillText('[반응시키기]를 누르면 여기에 반응 후 기체 상자가 나타나요', K.W / 2, rowA + S / 2 + 6);
  } else {
    const al = afterLayout(rx, st, n);
    if (!al.length) { c.fillStyle = '#8a94a3'; c.font = `15px ${FONT}`; c.textAlign = 'center'; c.fillText('상자가 없어요', K.W / 2, rowA + S / 2 + 6); }
    al.forEach((gr, gi) => {
      const isC = gr.key === 'C';
      const sp = isC ? rx.C : gr.key === 'LA' ? rx.A : rx.B;
      gr.xs.forEach((x, i) => {
        if (isC) {
          const a = an ? clamp((p - 0.3) / 0.3, 0, 1) : 1;
          drawBox(c, x, rowA, S, { alpha: a, scale: an ? 0.6 + 0.4 * easeOutBack(a) : 1 });
          if (!an) { drawMol(c, sp.m, x + S / 2, rowA + S / 2, u, dpr); cube.hits.push({ x, y: rowA, s: S }); }
        } else {
          // 남은 상자: 반응 전 자리에서 미끄러져 옴
          let bx = x, by = rowA;
          if (an) {
            const src = bl[gr.key === 'LA' ? 0 : 1].xs[(gr.key === 'LA' ? rx.a : rx.b) * n + i];
            const e = ease.inOutCubic(clamp((p - 0.15) / 0.65, 0, 1));
            bx = lerp(src, x, e); by = lerp(rowB, rowA, e);
          }
          drawBox(c, bx, by, S, { dashed: true, faint: true });
          drawMol(c, sp.m, bx + S / 2, by + S / 2, u, dpr, 0, 0.7);
          if (!an) cube.hits.push({ x, y: rowA, s: S });
        }
      });
      const a = an ? clamp((p - 0.6) / 0.3, 0, 1) : 1;
      c.globalAlpha = a;
      label(c, isC ? `${sp.n} ${gr.count} 부피` : `남은 ${sp.n} ${gr.count} 부피`, gr.cx, rowA + S + 30, isC ? '#1d2433' : '#7a8495', 15, isC ? 600 : 500);
      c.globalAlpha = 1;
    });
    if (al.length > 1) {
      for (let i = 1; i < al.length; i++) label(c, '+', (al[i - 1].x + al[i - 1].w + al[i].x) / 2, rowA + S / 2 + 12, '#8a94a3', 26, 700);
    }
    // 원자 이동
    if (an) {
      for (const at of an.atoms) {
        let x, y;
        if (p < 0.2) { const e = ease.outCubic(p / 0.2); x = lerp(at.x0, at.sx, e); y = lerp(at.y0, at.sy, e); }
        else { const e = ease.inOutCubic(clamp((p - 0.2) / 0.6, 0, 1)); x = lerp(at.sx, at.x1, e); y = lerp(at.sy, at.y1, e); }
        drawAtom(c, at.el, x, y, u, dpr);
      }
    }
  }

  // 화학 반응식 띠
  c.fillStyle = '#1d2433'; rrect(c, 150, K.eqY - 30, K.W - 300, 44, 22); c.fill();
  const co = k => (k === 1 ? '' : String(k));
  const terms = [`${co(rx.a)}${rx.A.f}`, '+', `${co(rx.b)}${rx.B.f}`, '→', `${co(rx.c)}${rx.C.f}`];
  c.font = `700 24px ${FONT}`; c.textBaseline = 'middle';
  const widths = terms.map(t => c.measureText(t).width);
  const gap = 18, tot = widths.reduce((a, b) => a + b, 0) + gap * (terms.length - 1);
  let tx = K.W / 2 - tot / 2;
  terms.forEach((t, i) => { c.fillStyle = i % 2 ? '#aab4c3' : '#fff'; c.textAlign = 'left'; c.fillText(t, tx, K.eqY - 8); tx += widths[i] + gap; });
  c.textBaseline = 'alphabetic';
}

function updateCubeUI() {
  const rx = curRx(), st = curSt();
  document.querySelectorAll('[data-rx]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rx === cube.rx)));
  $('rxNote').textContent = cube.rx === 'water' ? rx.note : '';
  $('nameA').textContent = rx.A.n; $('nameB').textContent = rx.B.n;
  $('cntA').textContent = st.A; $('cntB').textContent = st.B;
  const lk = nh3Locked();
  ['aMinus', 'aPlus', 'bMinus', 'bPlus'].forEach(id => $(id).disabled = lk);
  $('btnReact').hidden = lk; $('btnUndo').hidden = lk;
  $('cardTray').hidden = !lk;
  document.querySelectorAll('.card').forEach(b => b.classList.toggle('sel', +b.dataset.i === cube.sel));
  const n = st.reacted ? st.n : 0;
  const before = st.A + st.B;
  const after = st.reacted ? rx.c * n + (st.A - rx.a * n) + (st.B - rx.b * n) : null;
  $('sumBefore').textContent = `${before} 부피`;
  $('sumAfter').textContent = after == null ? '–' : `${after} 부피`;
  const sign = $('sumSign');
  sign.textContent = after == null ? '?' : after === before ? '=' : '≠';
  sign.className = after == null ? '' : after === before ? 'eq' : 'ne';
  $('sumNote').textContent = after == null ? '반응시킨 뒤 비교해 보자.'
    : after === before ? '이 반응은 반응 전후 기체 부피 합이 같아요. 다른 반응과 비교해 보자.'
    : '질량은 보존되지만 기체의 부피 합은 반응에 따라 달라질 수 있어요.';
  // 비 표
  const t = $('ratioTable');
  const filled = st.reacted && n > 0;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g3 = gcd(gcd(rx.a, rx.b), rx.c);
  const cell = x => (filled ? x : '–');
  const ra = [rx.a / g3, rx.b / g3, rx.c / g3];
  const gN = gcd(gcd(rx.a * n, rx.b * n), rx.c * n) || 1;
  const rn = [rx.a * n / gN, rx.b * n / gN, rx.c * n / gN];
  const row = (name, vals, sep, cls = '') => `<tr class="${cls}"><td>${name}</td><td>${cell(vals[0])}</td><td class="sep">${filled ? sep[0] : ''}</td><td>${cell(vals[1])}</td><td class="sep">${filled ? sep[1] : ''}</td><td>${cell(vals[2])}</td></tr>`;
  t.innerHTML = `<thead><tr><th></th><th>${rx.A.f}</th><th class="sep">+</th><th>${rx.B.f}</th><th class="sep">→</th><th>${rx.C.f}</th></tr></thead><tbody>`
    + row('계수비', ra, [':', ':'], 'rr')
    + row('분자 수(개)', [rx.a * n, rx.b * n, rx.c * n], ['', ''])
    + row('부피(부피)', [rx.a * n, rx.b * n, rx.c * n], ['', ''])
    + row('분자 수의 비', rn, [':', ':'], 'rr')
    + row('부피비', rn, [':', ':'], 'rr') + '</tbody>';
  // 알림
  const m = $('cubeMsg');
  let text = '', cls = '';
  if (msgOverride && performance.now() < msgOverride.until) { text = msgOverride.text; cls = msgOverride.cls; }
  else if (lk) text = '반응 전: 질소 1 부피 + 수소 3 부피. 반응 후 암모니아 2 부피의 빈 상자에는 어떤 분자 모형이 들어갈까?';
  else if (!st.reacted) text = st.A + st.B === 0 ? '상자를 넣어 보자.' : '상자 수를 정했으면 [반응시키기]를 눌러 보자.';
  else if (n === 0) {
    cls = 'warn';
    if (st.A < rx.a) text = `반응이 일어나지 않았어요. ${rx.A.n} ${rx.a} 부피가 있어야 ${rx.B.n} ${rx.b} 부피와 모두 반응해요.`;
    else text = `반응이 일어나지 않았어요. ${rx.B.n} ${rx.b} 부피가 있어야 ${rx.A.n} ${rx.a} 부피와 모두 반응해요.`;
  } else {
    const la = st.A - rx.a * n, lb = st.B - rx.b * n, parts = [];
    if (la) parts.push(`${rx.A.n} ${la} 부피`);
    if (lb) parts.push(`${rx.B.n} ${lb} 부피`);
    if (parts.length) { text = `${parts.join(', ')}가 반응하지 않고 남았어요.`; cls = 'warn'; }
    else { text = `모두 반응해서 ${rx.C.n} ${rx.c * n} 부피가 생겼어요. 남은 기체가 없어요.`; cls = 'good'; }
  }
  m.textContent = text; m.className = 'msg ' + cls;
}

// ═══════════════════════════ 공통: 상태 보내기·루프 ═══════════════════════════
function publish() {
  const rx = curRx(), st = curSt(), n = st.reacted ? st.n : 0;
  SB.setState({
    mode, valveOpen: lab.valveOpen,
    o2Vol: lab.o2, h2Vol: lab.h2, gasVol: gasVol(), ignitions: lab.ignitions,
    lastO2Before: lab.last ? lab.last.o2 : null, lastH2Before: lab.last ? lab.last.h2 : null,
    lastRemainVol: lab.last ? lab.last.remain : null, lastRemainGas: lab.last ? lab.last.gas : null,
    labLog: lab.log.map(r => ({ o2: r.o2, h2: r.h2, remain: r.remain, gas: r.gas })),
    molView: lab.molView,
    reaction: cube.rx, boxA: st.A, boxB: st.B,
    boxProduct: st.reacted ? rx.c * n : null,
    leftA: st.reacted ? st.A - rx.a * n : null, leftB: st.reacted ? st.B - rx.b * n : null,
    volBefore: st.A + st.B, volAfter: st.reacted ? rx.c * n + (st.A - rx.a * n) + (st.B - rx.b * n) : null,
    reacted: st.reacted, nh3Solved: cube.nh3Solved, nh3Tries: cube.nh3Tries,
  });
}

let lastT = performance.now(), lastMsgCheck = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!paused) simT += dt;
  if (mode === 'lab') {
    if (lab.anim) {
      const a = lab.anim, p = clamp((simT - a.t0) / a.dur, 0, 1);
      a.step(p);
      if (p >= 1) { finishLabAnim(); updateLabUI(); }
    }
    drawLab(paused ? 0 : dt);
  } else {
    drawCube();
    if (msgOverride && now > msgOverride.until && now - lastMsgCheck > 300) { lastMsgCheck = now; msgOverride = null; updateCubeUI(); }
  }
}

function setMode(m) {
  if (locked()) return;
  if (m === mode) {
    const g = $('guide'); g.classList.remove('flash'); void g.offsetWidth; g.classList.add('flash');
    sfx.soft(); return;
  }
  mode = m;
  $('viewLab').hidden = m !== 'lab'; $('viewCube').hidden = m !== 'cube';
  $('labSteps').hidden = m !== 'lab'; $('labSafe').hidden = m !== 'lab'; $('cubeGuide').hidden = m !== 'cube';
  $('tabLab').setAttribute('aria-selected', String(m === 'lab')); $('tabCube').setAttribute('aria-selected', String(m === 'cube'));
  hideBubble();
  requestAnimationFrame(() => { labView.fit(); cubeView.fit(); });
  sfx.whoosh(); publish();
}

// ── 이벤트 ──
$('tabLab').addEventListener('click', () => setMode('lab'));
$('tabCube').addEventListener('click', () => setMode('cube'));
$('btnPlay').addEventListener('click', () => {
  if (locked()) return;
  paused = !paused;
  $('btnPlay').setAttribute('aria-pressed', String(paused));
  $('btnPlay').querySelector('span').textContent = paused ? '재생' : '일시정지';
  sfx.clack();
});
const muteBtn = $('btnMute');
muteBtn.setAttribute('aria-pressed', String(sound.muted));
muteBtn.addEventListener('click', () => { const m = sound.toggleMute(); muteBtn.setAttribute('aria-pressed', String(m)); if (!m) sfx.soft(); });
$('btnQuality').addEventListener('click', () => {
  if (locked()) return;
  quality = quality === 'high' ? 'low' : 'high';
  $('btnQuality').querySelector('span').textContent = quality === 'high' ? '품질 높음' : '품질 낮음';
  sprites.clear(); labView.fit(); cubeView.fit();
  document.querySelectorAll('.card').forEach(b => drawCard(b.querySelector('canvas'), CARDS[+b.dataset.i]));
  sfx.clack();
});
$('btnReset').addEventListener('click', () => {
  if (locked()) return;
  resetLab(); initCube(); msgOverride = null; hideBubble();
  if (paused) $('btnPlay').click();
  sfx.reset(); publish(); updateLabUI(); updateCubeUI();
  toast('처음 상태로 돌아갔어요');
});

document.querySelectorAll('[data-gas]').forEach(b => b.addEventListener('click', () => {
  if (locked()) return;
  lab.gas = b.dataset.gas; sfx.soft(); updateLabUI();
  toast(lab.gas === 'o2' ? '산소 기체 주사기를 골랐어요' : '수소 기체 주사기를 골랐어요', 1200);
}));
const setInj = v => { if (locked()) return; const nv = clamp(Math.round(v), 1, 10); if (nv !== lab.inj) { lab.inj = nv; sound.tick((nv - 1) / 9); } updateLabUI(); };
$('volRange').addEventListener('input', e => setInj(+e.target.value));
$('volMinus').addEventListener('click', () => { setInj(lab.inj - 1); sfx.tok(false); });
$('volPlus').addEventListener('click', () => { setInj(lab.inj + 1); sfx.tok(true); });
$('btnInject').addEventListener('click', labInject);
$('btnValve').addEventListener('click', labValve);
$('btnIgnite').addEventListener('click', labIgnite);
$('btnEmpty').addEventListener('click', labEmpty);
$('btnMol').addEventListener('click', () => {
  if (locked()) return;
  lab.molView = !lab.molView; sfx.clack(); publish(); updateLabUI();
});
// 장치 그림 직접 누르기: 주입구 꼭지·점화기
const inR = (p, r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
$('labCanvas').addEventListener('pointerdown', e => {
  if (locked()) return;
  const p = labView.toLocal(e);
  if (inR(p, G.hitValve)) labValve();
  else if (inR(p, G.hitIgn)) labIgnite();
});
$('labCanvas').addEventListener('pointermove', e => {
  const p = labView.toLocal(e);
  e.target.style.cursor = inR(p, G.hitValve) || inR(p, G.hitIgn) ? 'pointer' : 'default';
});

document.querySelectorAll('[data-rx]').forEach(b => b.addEventListener('click', () => setRx(b.dataset.rx)));
$('aMinus').addEventListener('click', () => cubeCount('A', -1));
$('aPlus').addEventListener('click', () => cubeCount('A', 1));
$('bMinus').addEventListener('click', () => cubeCount('B', -1));
$('bPlus').addEventListener('click', () => cubeCount('B', 1));
$('btnReact').addEventListener('click', () => cubeReact());
$('btnUndo').addEventListener('click', cubeUndo);
$('cubeCanvas').addEventListener('pointerdown', e => {
  if (locked()) return;
  const p = cubeView.toLocal(e);
  const inBox = r => p.x >= r.x && p.x <= r.x + r.s + 9 && p.y >= r.y - 9 && p.y <= r.y + r.s;
  const emp = (cube.empties || []).find(inBox);
  if (emp) {
    if (cube.sel != null) tryCard(cube.sel);
    else { sfx.soft(); setMsg('아래 카드 중 하나를 골라 이 빈 상자에 넣어 보자.', '', 4000); updateCubeUI(); }
    return;
  }
  const hit = (cube.hits || []).find(inBox);
  if (hit) { sfx.soft(); showBubble(hit.x + hit.s / 2, hit.y - 10); }
  else hideBubble();
});
$('cubeCanvas').addEventListener('pointermove', e => {
  const p = cubeView.toLocal(e);
  const on = [...(cube.hits || []), ...(cube.empties || [])].some(r => p.x >= r.x && p.x <= r.x + r.s && p.y >= r.y && p.y <= r.y + r.s);
  e.target.style.cursor = on ? 'pointer' : 'default';
});
SB.onLock = () => { cube.sel = null; hideBubble(); };

// ── 시작 ──
resetLab(); initCube();
updateLabUI(); updateCubeUI(); publish();
requestAnimationFrame(frame);
