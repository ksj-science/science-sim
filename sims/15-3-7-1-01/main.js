// 15-3-7-1-01 별의 밝기가 다른 까닭은 — 화면 연결, 상태, 소리, SimBridge
import { sound } from '../../lib/sound.js';
import { clamp, ease, paintRange, toast, FpsMonitor } from '../../lib/utils.js';
import { createLamp, D_MIN, D_MAX, D_ONE, sideOf, cellsOf, brightOf } from './lamp.js';
import { createStarView, STARS, byId, magAt, PC_MIN, PC_MAX } from './star.js';

const UNIT = '15-3-7-1-01';
const $ = id => document.getElementById(id);
const Bridge = window.SimBridge;
Bridge.init(UNIT);
const locked = () => !!Bridge.locked;

// ---------------- 상태 ----------------
const D0 = 10;
const S = {
  mode: 'lamp',
  paused: false,
  quality: (navigator.hardwareConcurrency || 4) <= 2 ? 'low' : 'high',
  lamp: { d: D0, records: [], pred: '', beam: true, touched: false },
  star: { sel: 'sirius', dist: {}, found: new Set(), pred: '', anim: null, touched: false, visited: false },
  stairs: { pick: [], last: null, anim: null },
};
const resetStarDist = () => STARS.forEach(s => { S.star.dist[s.id] = s.dist; });
resetStarDist();

// ---------------- 숫자 모양 ----------------
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const fmtMag = m => { const v = Math.round(m * 10) / 10; return (Object.is(v, -0) ? 0 : v).toFixed(1); };
function bigNum(v) {
  const sig = x => (x < 10 ? (Math.round(x * 10) / 10).toString() : Math.round(x).toLocaleString('ko-KR'));
  if (v < 1e4) return sig(v);
  if (v < 1e8) return sig(v / 1e4) + '만';
  if (v < 1e12) return sig(v / 1e8) + '억';
  return sig(v / 1e12) + '조';
}
function fmtTimes(x) {           // 밝기 배수: 1보다 작으면 1/○배
  if (Math.abs(x - 1) < 0.005) return '1배';
  return x >= 1 ? `${bigNum(x)}배` : `1/${bigNum(1 / x)}배`;
}
function fmtDistMul(x) {
  if (Math.abs(x - 1) < 0.005) return '1배';
  if (x < 1) return `${x.toPrecision(2)}배`;
  return `${bigNum(x)}배`;
}
function fmtPc(D) {
  if (D < 0.01) return '0.00000485 pc';
  if (D < 9.95) return `${f1(D)} pc`;
  return `${Math.round(D)} pc`;
}
// 한 칸 밝기: 한 변이 정수 칸이면 분수도 함께
function fmtBright(d, withDec = true) {
  const s = sideOf(d), B = brightOf(d);
  const si = Math.round(s);
  if (Math.abs(s - si) < 1e-9 && si >= 1) {
    if (si === 1) return '1';
    return withDec ? `1/${si * si} (${B.toFixed(2)})` : `1/${si * si}`;
  }
  return B.toFixed(2);
}

// ---------------- SimBridge ----------------
let pushQueued = false;
function pushState() {
  if (pushQueued) return;
  pushQueued = true;
  requestAnimationFrame(() => {
    pushQueued = false;
    const st = byId(S.star.sel), D = S.star.dist[S.star.sel];
    Bridge.setState({
      mode: S.mode,
      lampDistanceCm: +S.lamp.d.toFixed(1),
      spotCells: +cellsOf(S.lamp.d).toFixed(2),
      cellBrightness: +brightOf(S.lamp.d).toFixed(3),
      records: S.lamp.records.map(r => ({ d: r.d, cells: +cellsOf(r.d).toFixed(2), b: +brightOf(r.d).toFixed(3) })),
      recordCount: S.lamp.records.length,
      lampPrediction: S.lamp.pred,
      starId: S.star.sel,
      starDistancePc: D < 0.01 ? D : +D.toFixed(2),
      apparentMagNow: +fmtMag(magAt(st, D)),
      absMagFound: STARS.filter(s => S.star.found.has(s.id)).map(s => s.id),
      starPrediction: S.star.pred,
      stepQuiz: S.stairs.last ? [...S.stairs.last] : [],
    });
  });
}

// ---------------- 탭 ① ----------------
const lamp = createLamp($('lampCanvasWrap'), {
  onDrag: v => setLampD(v),
  onDragStart: () => { hideHint('lampHint'); sound.click(); },
  onDragEnd: () => {},
  isLocked: locked,
});
const dSlider = $('dSlider');
const insetCtx = $('insetCanvas').getContext('2d');

function setLampD(v, { silent = false } = {}) {
  v = clamp(Math.round(v * 2) / 2, D_MIN, D_MAX);
  const prev = S.lamp.d;
  if (v === prev && !silent) return;
  S.lamp.d = v;
  lamp.setDistance(v);
  if (!silent) {
    if (Math.floor(prev) !== Math.floor(v)) sound.tick((v - D_MIN) / (D_MAX - D_MIN));
    const s = sideOf(v);
    if (Math.abs(s - Math.round(s)) < 1e-9) { sound.ding(); lamp.flashExact(); }
    hideHint('lampHint');
    S.lamp.touched = true;
  }
  renderLampPanel();
  pushState();
}

function renderLampPanel() {
  const d = S.lamp.d, s = sideOf(d), A = cellsOf(d), B = brightOf(d);
  const exact = Math.abs(s - Math.round(s)) < 1e-9;
  $('roD').textContent = `${f1(d)} cm`;
  $('dOut').textContent = `${f1(d)} cm`;
  $('roA').textContent = `${f1(A)}칸`;
  $('roSide').textContent = `${f1(s)}칸 × ${f1(s)}칸`;
  $('roB').textContent = fmtBright(d, false);
  $('roB').title = B.toFixed(3);
  $('bbarFill').style.width = `${Math.min(B, 2) / 2 * 100}%`;
  if (+dSlider.value !== d) dSlider.value = d;
  paintRange(dSlider);
  $('cmpText').innerHTML = `지금 거리 <b>${f1(d)} cm</b>는 한 칸일 때의 거리 <b>${D_ONE} cm</b>의 <b>${(d / D_ONE).toFixed(2).replace(/\.?0+$/, '')}배</b>예요.`;
  const lbl = $('insetLabel');
  lbl.classList.toggle('exact', exact);
  lbl.innerHTML = exact ? `<b>칸에 딱 맞음 · ${Math.round(A)}칸</b>` : `넓이 <b>${f1(A)}칸</b>`;
  drawInset();
}

function drawInset() {
  const c = $('insetCanvas'), dpr = Math.min(devicePixelRatio, 2);
  const size = c.clientWidth || 180;
  if (c.width !== Math.round(size * dpr)) { c.width = c.height = Math.round(size * dpr); }
  const g = insetCtx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const N = 7, m = 8, cell = (size - 2 * m) / N;
  g.fillStyle = '#5f9e69'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#7fcf8a'; g.fillRect(m, m, size - 2 * m, size - 2 * m);
  // 빛 무늬 — 구멍 바로 앞 꼭짓점(왼쪽 아래에서 한 칸 안쪽)에서 위·오른쪽으로 커짐
  const d = S.lamp.d, s = sideOf(d), B = brightOf(d);
  const x0 = m + cell, y0 = size - m - cell, w = s * cell;
  const I = Math.min(1, 0.95 * Math.pow(Math.min(B, 2), 0.5));
  g.save();
  g.beginPath(); g.rect(m, m, size - 2 * m, size - 2 * m); g.clip();
  g.filter = S.quality === 'high' ? `blur(${(0.4 + d * 0.06).toFixed(1)}px)` : 'none';
  g.fillStyle = `rgba(255,248,205,${I})`;
  g.fillRect(x0, y0 - w, w, w);
  g.filter = 'none';
  g.restore();
  // 모눈
  g.strokeStyle = 'rgba(20,80,40,.85)'; g.lineWidth = 1.4;
  for (let i = 0; i <= N; i++) {
    const p = m + i * cell;
    g.beginPath(); g.moveTo(p, m); g.lineTo(p, size - m); g.stroke();
    g.beginPath(); g.moveTo(m, p); g.lineTo(size - m, p); g.stroke();
  }
  // 구멍 바로 앞 점
  g.fillStyle = '#ff4d4d'; g.beginPath(); g.arc(x0, y0, 3, 0, Math.PI * 2); g.fill();
  if (Math.abs(s - Math.round(s)) < 1e-9) {
    g.strokeStyle = '#22c55e'; g.lineWidth = 2.5;
    g.strokeRect(x0, y0 - w, w, w);
  }
}

dSlider.addEventListener('input', () => { if (!locked()) setLampD(+dSlider.value); });
$('tBeam').addEventListener('change', e => { S.lamp.beam = e.target.checked; lamp.setBeam(S.lamp.beam); sound.click(); });

document.querySelectorAll('.view-btns [data-view]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.view-btns [data-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  lamp.setView(b.dataset.view); sound.click();
}));

$('btnRecord').addEventListener('click', () => {
  const d = S.lamp.d, recs = S.lamp.records;
  const i = recs.findIndex(r => r.d === d);
  if (i >= 0) { recs[i].t = Date.now(); toast(`${f1(d)} cm 줄을 새로 기록했어요`); }
  else if (recs.length >= 6) { toast('표가 가득 찼어요. ✕를 눌러 줄을 지운 뒤 기록하세요'); sound.off(); return; }
  else recs.push({ d, t: Date.now() });
  recs.sort((a, b) => a.d - b.d);
  sound.record();
  renderRecords(d);
  pushState();
});

function renderRecords(flashD) {
  const tb = $('recTable').tBodies[0];
  tb.innerHTML = '';
  for (const r of S.lamp.records) {
    const tr = document.createElement('tr');
    if (r.d === flashD) tr.className = 'new';
    tr.innerHTML = `<td>${f1(r.d)}</td><td>${f1(cellsOf(r.d))}</td><td>${fmtBright(r.d, false)}</td>` +
      `<td class="del"><button aria-label="${f1(r.d)} cm 줄 지우기" title="이 줄 지우기">✕</button></td>`;
    tr.querySelector('button').addEventListener('click', () => {
      S.lamp.records = S.lamp.records.filter(x => x !== r);
      sound.off(); renderRecords(); pushState();
    });
    tb.appendChild(tr);
  }
  $('recCount').textContent = `${S.lamp.records.length} / 6줄`;
  $('recEmpty').hidden = S.lamp.records.length > 0;
}

// 예상 카드 ①
const LAMP_PRED = { half: '처음의 1/2', quarter: '처음의 1/4', same: '처음과 같다', double: '처음의 2배' };
document.querySelectorAll('#predictLamp [data-v]').forEach(b => b.addEventListener('click', () => {
  if (locked()) return;
  S.lamp.pred = b.dataset.v; sound.soft();
  $('predictLamp').hidden = true;
  renderPredLines(); pushState();
}));

// ---------------- 탭 ② ----------------
const starView = createStarView($('starCanvas'), {
  onSelect: id => selectStar(id),
  onDragStart: () => { stopAnim(); hideHint('starHint'); },
  onDrag: (id, D) => setStarDist(id, D),
  onDragEnd: () => {},
  isLocked: locked,
  getState: () => ({ dist: S.star.dist, sel: S.star.sel, paused: S.paused }),
});
const pcSlider = $('pcSlider');
const LSPAN = Math.log10(PC_MAX / PC_MIN);
const pcFromSlider = v => PC_MIN * Math.pow(10, (v / 1000) * LSPAN);
const sliderFromPc = D => (D < PC_MIN ? 0 : (Math.log10(D / PC_MIN) / LSPAN) * 1000);

function selectStar(id, quiet = false) {
  if (S.star.sel !== id) {
    if (S.star.anim && S.star.anim.id !== id) stopAnim();
    S.star.sel = id;
    if (!quiet) sound.soft();
  }
  renderStarPanel(); starView.draw(); pushState();
}

const tickIdx = D => Math.floor(Math.log10(D) * 10);
function setStarDist(id, D, { fromAnim = false } = {}) {
  const prev = S.star.dist[id];
  if (!fromAnim) D = clamp(D, PC_MIN, PC_MAX);
  S.star.dist[id] = D;
  if (!fromAnim && prev !== D && tickIdx(prev) !== tickIdx(D)) sound.tick(clamp(Math.log10(D) / 3, 0, 1));
  if (!fromAnim) S.star.touched = true;
  if (D === 10 && !S.star.found.has(id)) foundAbs(id);
  if (id === S.star.sel) renderStarPanel();
  starView.draw();
  pushState();
}

function foundAbs(id) {
  S.star.found.add(id);
  sound.bell();
  const s = byId(id);
  toast(`${s.name}을(를) 10 pc에 놓았어요 → 절대 등급 ${fmtMag(s.M)}등급`);
  renderStarPanel();
  const el = $('roAbs').closest('.ro');
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

function renderStarPanel() {
  const s = byId(S.star.sel), D = S.star.dist[s.id];
  document.querySelectorAll('#starChips .chip').forEach(c => c.setAttribute('aria-checked', String(c.dataset.id === s.id)));
  $('roReal').textContent = s.id === 'sun' ? '0.00000485 pc' : fmtPc(s.dist);
  $('roReal').title = s.id === 'sun' ? '1 AU (지구–태양 거리)' : '';
  $('roReal').classList.toggle('long', s.id === 'sun');
  $('roNow').classList.toggle('long', D < 0.01);
  $('roNow').textContent = fmtPc(D);
  $('roDMul').textContent = fmtDistMul(D / s.dist);
  $('roBMul').textContent = fmtTimes((s.dist / D) ** 2);
  $('roM0').textContent = `${fmtMag(s.m0)}등급`;
  $('roM').textContent = `${fmtMag(magAt(s, D))}등급`;
  $('roAbs').textContent = S.star.found.has(s.id) ? `${fmtMag(s.M)}등급` : '?';
  $('pcOut').textContent = fmtPc(D);
  const sv = sliderFromPc(D);
  if (Math.abs(+pcSlider.value - sv) > 0.6) pcSlider.value = Math.round(sv);
  paintRange(pcSlider);
  const atHome = Math.abs(D - s.dist) < 1e-9, at10 = D === 10;
  $('btnHome').disabled = atHome && !S.star.anim;
  $('btn10pc').disabled = at10 && !S.star.anim;
  renderResTable();
}

function renderResTable() {
  const tb = $('resTable').tBodies[0];
  tb.innerHTML = STARS.map(s => {
    const f = S.star.found.has(s.id);
    return `<tr class="${s.id === S.star.sel ? 'sel' : ''}"><td><span class="dot" style="background:${s.ui}"></span>${s.name}</td>` +
      `<td>${fmtMag(s.m0)}</td><td class="${f ? 'found' : 'q'}">${f ? fmtMag(s.M) : '?'}</td></tr>`;
  }).join('');
}

// 별 고르기 칩, 예상 보기
$('starChips').innerHTML = STARS.map(s =>
  `<button class="chip" role="radio" data-id="${s.id}" aria-checked="false"><i style="background:${s.ui}"></i>${s.name}</button>`).join('');
document.querySelectorAll('#starChips .chip').forEach(c => c.addEventListener('click', () => selectStar(c.dataset.id)));
$('predictStarOpts').innerHTML = STARS.map(s =>
  `<button data-v="${s.id}"><i style="background:${s.ui}"></i>${s.name}</button>`).join('');
document.querySelectorAll('#predictStarOpts [data-v]').forEach(b => b.addEventListener('click', () => {
  if (locked()) return;
  S.star.pred = b.dataset.v; sound.soft();
  $('predictStar').hidden = true;
  renderPredLines(); pushState();
}));

pcSlider.addEventListener('input', () => {
  if (locked()) return;
  stopAnim();
  let D = pcFromSlider(+pcSlider.value);
  if (Math.abs(D - 10) <= 0.3) D = 10;
  hideHint('starHint');
  setStarDist(S.star.sel, D);
});

// 이동 애니메이션 (일시정지 가능)
let sweep = null;
function startAnim(target, dur) {
  stopAnim();
  const id = S.star.sel, from = S.star.dist[id];
  if (Math.abs(from - target) < 1e-12) return;
  S.star.anim = { id, lf: Math.log10(from), lt: Math.log10(target), target, t: 0, dur };
  sweep = sound.sweep();
  if (S.paused) sweep.pause(true);
  renderStarPanel();
}
function stopAnim() {
  if (!S.star.anim) return;
  S.star.anim = null;
  if (sweep) { sweep.stop(); sweep = null; }
  renderStarPanel();
}
function stepAnim(dt) {
  const a = S.star.anim;
  if (!a || S.paused) return;
  a.t = Math.min(1, a.t + dt / a.dur);
  const l = a.lf + (a.lt - a.lf) * ease.inOutCubic(a.t);
  if (sweep) sweep.set(clamp((l + 5.4) / 8.4, 0, 1));
  if (a.t >= 1) {
    S.star.anim = null;
    if (sweep) { sweep.stop(); sweep = null; }
    setStarDist(a.id, a.target, { fromAnim: true });
    if (a.target !== 10) sound.ding();
  } else {
    setStarDist(a.id, Math.pow(10, l), { fromAnim: true });
  }
}
$('btn10pc').addEventListener('click', () => { hideHint('starHint'); startAnim(10, 1.5); S.star.touched = true; });
$('btnHome').addEventListener('click', () => { startAnim(byId(S.star.sel).dist, 1.0); });

// ---------------- 등급 계단 ----------------
const stairsCanvas = $('stairsCanvas');
const sctx = stairsCanvas.getContext('2d');
const GRADES = [6, 5, 4, 3, 2, 1];
const R = Math.pow(100, 1 / 5); // 한 등급 ≈ 2.512배
const fmtRatio = n => { const v = Math.pow(R, n); return v < 10 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)); };
$('stairsBtns').innerHTML = GRADES.map(gr => `<button data-g="${gr}" aria-pressed="false">${gr}등급</button>`).join('');
document.querySelectorAll('#stairsBtns button').forEach(b => b.addEventListener('click', () => {
  if (locked()) return;
  const gr = +b.dataset.g, st = S.stairs;
  if (st.pick.length >= 2) st.pick = [];
  st.pick.push(gr);
  sound.soft();
  if (st.pick.length === 2) {
    st.last = [...st.pick];
    const [a, c] = st.pick;
    st.anim = { lo: Math.min(a, c), hi: Math.max(a, c), p: 0 };
    pushState();
  } else st.anim = null;
  renderStairs();
}));
function renderStairs() {
  const st = S.stairs;
  document.querySelectorAll('#stairsBtns button').forEach(b => b.setAttribute('aria-pressed', String(st.pick.includes(+b.dataset.g))));
  const res = $('stairsResult');
  if (st.pick.length === 1) res.innerHTML = `${st.pick[0]}등급을 골랐어요. 비교할 등급을 하나 더 누르세요.`;
  else if (st.pick.length === 2) {
    const { lo, hi, p } = st.anim;
    const n = hi - lo;
    if (n === 0) res.innerHTML = '같은 등급이에요 → 밝기 차이 없음 (1배)';
    else if (p >= n) res.innerHTML = `${lo}등급인 별은 ${hi}등급인 별보다 <em>약 ${fmtRatio(n)}배</em> 밝게 보여요 (${n}등급 차이)`;
    else res.innerHTML = `${hi}등급에서 ${lo}등급까지 계단을 올라가는 중…`;
  } else res.innerHTML = '&nbsp;';
  drawStairs();
}
function drawStairs() {
  const c = stairsCanvas, dpr = Math.min(devicePixelRatio, 2);
  const W = c.clientWidth, H = c.clientHeight;
  if (!W) return;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = sctx, font = getComputedStyle(document.body).fontFamily;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const st = S.stairs, a = st.anim;
  const colW = W / 6, base = H - 22, stepH = Math.min(15, (H - 150) / 5);
  const pos = i => ({ x: colW * (i + 0.5), y: base - 58 - i * stepH });
  // 계단
  for (let i = 0; i < 6; i++) {
    const { x, y } = pos(i);
    const inRange = a && GRADES[i] >= a.lo && GRADES[i] <= a.hi;
    g.fillStyle = inRange ? 'rgba(255,204,77,.18)' : 'rgba(255,255,255,.06)';
    g.fillRect(x - colW / 2 + 3, y + 20, colW - 6, base - y - 22);
  }
  // 공 (6등급 → 1등급 밝아짐)
  for (let i = 0; i < 6; i++) {
    const { x, y } = pos(i), t = i / 5;
    const r = 11 + t * 7;
    const glow = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
    glow.addColorStop(0, `rgba(255,230,120,${0.1 + 0.5 * t})`); glow.addColorStop(1, 'rgba(255,230,120,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(x, y, r * 2.2, 0, Math.PI * 2); g.fill();
    const L = 28 + t * 55;
    g.fillStyle = `hsl(48, ${60 + t * 40}%, ${L}%)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e9f0fb'; g.font = `700 13px ${font}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(`${GRADES[i]}등급`, x, y + 24);
  }
  // 이웃 사이 ×2.5
  g.font = `600 12px ${font}`; g.textBaseline = 'bottom';
  for (let i = 0; i < 5; i++) {
    const p = pos(i), q = pos(i + 1);
    const mx = (p.x + q.x) / 2, my = Math.min(p.y, q.y) - 22;
    g.strokeStyle = 'rgba(200,215,255,.45)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(p.x + 10, p.y - 16); g.quadraticCurveTo(mx, my - 8, q.x - 10, q.y - 18); g.stroke();
    g.fillStyle = '#a9b8d8'; g.fillText('약 2.5배', mx, my - 6);
  }
  // 1등급~6등급 약 100배 괄호
  const p0 = pos(0), p5 = pos(5), by = 16;
  g.strokeStyle = 'rgba(255,204,77,.6)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(p0.x, by + 10); g.lineTo(p0.x, by); g.lineTo(p5.x, by); g.lineTo(p5.x, by + 10); g.stroke();
  g.fillStyle = '#ffcc4d'; g.font = `700 12.5px ${font}`; g.textBaseline = 'middle';
  const lw = g.measureText('약 100배').width + 14;
  g.fillStyle = '#1b263d'; g.fillRect(W / 2 - lw / 2, by - 9, lw, 18);
  g.fillStyle = '#ffcc4d'; g.fillText('약 100배', W / 2, by);
  // 아래 화살표
  g.fillStyle = '#93a6c8'; g.font = `600 12px ${font}`; g.textBaseline = 'bottom';
  g.fillText('어둡다 ←  밝기  → 밝다', W / 2, H - 2);
  // 누적 애니메이션
  if (a && a.hi > a.lo) {
    const iStart = GRADES.indexOf(a.hi), n = a.hi - a.lo, p = Math.min(a.p, n);
    for (let k = 0; k <= Math.floor(p); k++) {
      const { x, y } = pos(iStart + k);
      const txt = k === 0 ? '1배' : `×${fmtRatio(k)}`;
      g.font = `800 ${k === n && p >= n ? 15 : 13}px ${font}`; g.textBaseline = 'middle';
      const tw = g.measureText(txt).width + 12;
      g.fillStyle = k === n && p >= n ? '#ffcc4d' : 'rgba(79,179,255,.9)';
      roundRect(g, x - tw / 2, y + 42, tw, 22, 8); g.fill();
      g.fillStyle = '#06121f'; g.fillText(txt, x, y + 53);
    }
    // 움직이는 점
    if (p < n) {
      const k = Math.floor(p), f = ease.inOutCubic(p - k);
      const A = pos(iStart + k), B = pos(iStart + k + 1);
      const x = A.x + (B.x - A.x) * f, y = A.y + (B.y - A.y) * f - Math.sin(f * Math.PI) * 18;
      g.fillStyle = '#4fb3ff'; g.beginPath(); g.arc(x, y - 16, 6, 0, Math.PI * 2); g.fill();
    }
  }
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function stepStairs(dt) {
  const a = S.stairs.anim;
  if (!a || S.paused || $('stairs').hidden) return;
  const n = a.hi - a.lo;
  if (a.p >= n) return;
  const before = Math.floor(a.p);
  a.p = Math.min(n, a.p + dt / 0.55);
  if (Math.floor(a.p) !== before) {
    if (a.p >= n) sound.chime(); else sound.tick(Math.floor(a.p) / 5);
    renderStairs();
  } else drawStairs();
}
$('btnStairs').addEventListener('click', () => { $('stairs').hidden = false; sound.click(); requestAnimationFrame(renderStairs); });
$('btnStairsClose').addEventListener('click', () => { $('stairs').hidden = true; sound.click(); });

// ---------------- 공통 ----------------
function renderPredLines() {
  const lp = $('lampPredLine'), sp = $('starPredLine');
  lp.innerHTML = S.lamp.pred
    ? `<span>내 예상: 거리 2배 → 한 칸 밝기 <b>${LAMP_PRED[S.lamp.pred]}</b></span><button class="btn" data-open="predictLamp">바꾸기</button>`
    : `<span>아직 예상을 고르지 않았어요</span><button class="btn" data-open="predictLamp">예상하기</button>`;
  const ps = S.star.pred && byId(S.star.pred);
  sp.innerHTML = ps
    ? `<span>내 예상: 실제로 가장 밝은 별 <b>${ps.name}</b></span><button class="btn" data-open="predictStar">바꾸기</button>`
    : `<span>아직 예상을 고르지 않았어요</span><button class="btn" data-open="predictStar">예상하기</button>`;
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    if (locked()) return;
    $(b.dataset.open).hidden = false; sound.click();
    markPred();
  }));
  markPred();
}
function markPred() {
  document.querySelectorAll('#predictLamp [data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.lamp.pred)));
  document.querySelectorAll('#predictStar [data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.star.pred)));
}

function hideHint(id) { $(id).classList.add('gone'); }

function setMode(mode, quiet = false) {
  S.mode = mode;
  $('app').dataset.mode = mode;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
  $('lampScene').hidden = mode !== 'lamp'; $('lampPanel').hidden = mode !== 'lamp';
  $('starScene').hidden = mode !== 'star'; $('starPanel').hidden = mode !== 'star';
  $('predictLamp').hidden = !(mode === 'lamp' && !S.lamp.pred);
  $('predictStar').hidden = !(mode === 'star' && !S.star.pred);
  if (mode !== 'star') $('stairs').hidden = true;
  if (mode === 'lamp') { lamp.resize(); }
  else { S.star.visited = true; starView.layout(); renderStarPanel(); }
  if (!quiet) sound.whoosh();
  pushState();
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { if (t.dataset.mode !== S.mode) setMode(t.dataset.mode); }));

function setPaused(p) {
  S.paused = p;
  $('btnPlay').textContent = p ? '▶' : '⏸';
  $('btnPlay').title = p ? '재생 (스페이스바)' : '일시정지 (스페이스바)';
  $('btnPlay').setAttribute('aria-label', p ? '재생' : '일시정지');
  if (sweep) sweep.pause(p);
  if (p) toast('일시정지했어요 — 별 이동과 계단 애니메이션이 멈춰요', 1600);
}
$('btnPlay').addEventListener('click', () => { setPaused(!S.paused); sound.click(); });
window.addEventListener('keydown', e => {
  if (e.code !== 'Space' || locked()) return;
  const t = e.target;
  if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'SUMMARY' || t.tagName === 'A')) return;
  e.preventDefault(); setPaused(!S.paused); sound.click();
});

function updateMuteBtn() { $('btnMute').textContent = sound.muted ? '🔇' : '🔊'; $('btnMute').setAttribute('aria-pressed', String(sound.muted)); }
$('btnMute').addEventListener('click', () => { sound.toggleMute(); updateMuteBtn(); sound.click(); });
updateMuteBtn();

function applyQuality(q) {
  S.quality = q;
  $('btnQuality').querySelector('.lbl').textContent = `품질: ${q === 'high' ? '높음' : '낮음'}`;
  $('btnQuality').setAttribute('aria-pressed', String(q === 'low'));
  lamp.applyQuality(q);
  starView.setQuality(q);
  drawInset();
}
$('btnQuality').addEventListener('click', () => { applyQuality(S.quality === 'high' ? 'low' : 'high'); sound.click(); });

// 초기화
const menu = $('resetMenu');
$('btnReset').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; sound.click(); });
document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('.reset-wrap')) menu.hidden = true; });
function resetLamp() {
  S.lamp.records = []; S.lamp.beam = true; $('tBeam').checked = true; lamp.setBeam(true);
  document.querySelectorAll('.view-btns [data-view]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.view === 'main')));
  lamp.setView('main');
  setLampD(D0, { silent: true });
  renderRecords();
  $('cmpFold').open = false;
}
function resetStar() {
  stopAnim(); resetStarDist(); S.star.found.clear(); S.star.sel = 'sirius';
  S.stairs = { pick: [], last: null, anim: null }; $('stairs').hidden = true;
  renderStairs(); renderStarPanel(); starView.draw();
}
$('btnResetTab').addEventListener('click', () => {
  menu.hidden = true;
  S.mode === 'lamp' ? resetLamp() : resetStar();
  sound.reset(); sound.whoosh(); toast('이 탭을 처음 상태로 돌렸어요'); pushState();
});
$('btnResetAll').addEventListener('click', () => {
  if (!confirm('두 탭의 기록·예상·결과를 모두 지우고 처음으로 돌릴까요?')) { menu.hidden = true; return; }
  menu.hidden = true;
  resetLamp(); resetStar();
  S.lamp.pred = ''; S.star.pred = '';
  $('lampHint').classList.remove('gone'); $('starHint').classList.remove('gone');
  renderPredLines(); setMode('lamp', true); setPaused(false);
  sound.reset(); toast('모두 처음 상태로 돌렸어요'); pushState();
});

// 잠금 뒤에는 탭 전환(보기)만 허용 — 키보드로 누르는 것도 막음
['click', 'input', 'change'].forEach(type => document.addEventListener(type, e => {
  if (!locked() || (e.target.closest && e.target.closest('.tab'))) return;
  if (e.target.closest && e.target.closest('#app')) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true));
Bridge.onLock = () => {
  lamp.cancelDrag(); starView.cancelDrag(); stopAnim();
  document.querySelectorAll('#app input').forEach(i => { i.disabled = true; });
  menu.hidden = true;
};

// ---------------- 크기 변화 ----------------
const ro = new ResizeObserver(() => {
  if (S.mode === 'lamp') lamp.resize(); else starView.layout();
  drawInset();
  if (!$('stairs').hidden) drawStairs();
});
ro.observe($('scene'));

// ---------------- 반복 ----------------
const fps = new FpsMonitor(() => { if (S.quality === 'high') { applyQuality('low'); toast('화면이 느려서 그래픽 품질을 낮췄어요'); } }, { threshold: 30, window: 4 });
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!document.hidden) {
    fps.update(dt);
    stepAnim(dt);
    stepStairs(dt);
    if (S.mode === 'lamp') lamp.render(dt);
    else starView.tick(S.paused ? 0 : dt);
  }
  requestAnimationFrame(loop);
}

// 시작
applyQuality(S.quality);
setLampD(D0, { silent: true });
renderRecords();
renderPredLines();
renderStarPanel();
setMode('lamp', true);
requestAnimationFrame(loop);
