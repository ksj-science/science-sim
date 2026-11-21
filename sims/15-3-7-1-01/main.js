// 15-3-7-1-01 별의 밝기가 다른 까닭은 — 화면 연결, 상태, 소리, SimBridge
import { sound } from '../../lib/sound.js';
import { clamp, ease, paintRange, toast, FpsMonitor } from '../../lib/utils.js';
import { createLamp, D_MIN, D_MAX, D_ONE, sideOf, cellsOf, brightOf } from './lamp.js';
import { createStarView, STARS, byId, magAt, PC_MIN, PC_MAX } from './star.js';

const UNIT = '15-3-7-1-01';
const $ = id => document.getElementById(id);
const Bridge = window.SimBridge;
Bridge.init(UNIT);
const locked = () => !!Bridge.locked || document.documentElement.classList.contains('sim-locked');

// ---------------- 상태 ----------------
const D0 = 10;
const S = {
  mode: 'lamp',
  paused: false,
  quality: (navigator.hardwareConcurrency || 4) <= 2 ? 'low' : 'high',
  lamp: { d: D0, records: [], pred: '', beam: true, touched: false, cmp: false },
  star: { sel: 'sirius', dist: {}, found: new Set(), pred: '', anim: null, touched: false, visited: false, cmp: false },
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
  if (v < 1e16) return sig(v / 1e12) + '조';
  return sig(v / 1e16) + '경';
}
// 받침에 따라 을/를
const eulReul = w => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '을' : '를'; };
// 원래 거리와 비교 (1보다 작으면 1/○)
// 반올림해서 보여 준 값이 실제와 1% 넘게 다르면 '약'을 붙임
const approx = (y, shown) => (Math.abs(shown - y) / y > 0.01 ? '약 ' : '');
function bigVal(v) {             // bigNum이 실제로 보여 주는 값(‘약’ 판단용)
  const u = v < 1e4 ? 1 : v < 1e8 ? 1e4 : v < 1e12 ? 1e8 : v < 1e16 ? 1e12 : 1e16, x = v / u;
  return (x < 10 ? Math.round(x * 10) / 10 : Math.round(x)) * u;
}
// '원래 거리의 ○'·'원래 밝기의 ○' — 1보다 작으면 1/○, 크면 ○배. 아주 작은 수는 '○분의 1'로 읽기 쉽게
function fmtRatio2(x) {
  if (Math.abs(x - 1) < 0.005) return '1배';
  if (x >= 1) return `${approx(x, bigVal(x))}${bigNum(x)}배`;
  const y = 1 / x, a = approx(y, bigVal(y));
  return y >= 1e4 ? `${a}${bigNum(y)}분의 1` : `${a}1/${bigNum(y)}`;
}
function fmtDistCmp(x) {
  if (Math.abs(x - 1) < 0.005) return { v: '1배', sub: '원래 자리' };
  return { v: fmtRatio2(x), sub: x < 1 ? '더 가까이' : '더 멀리' };
}
function fmtPc(D) {
  if (D < 0.01) return '1 AU';
  if (D < 99.95) return `${f1(D)} pc`;   // 10 pc 근처도 소수 첫째 자리까지(10.4 pc ≠ 10 pc)
  return `${Math.round(D)} pc`;
}
// 한 칸 밝기: 칸에 딱 맞으면 분수(1/4), 아니면 소수 + 가까운 분수(약 1/3)
function brightParts(d) {
  const s = sideOf(d), B = brightOf(d), si = Math.round(s);
  if (Math.abs(s - si) < 1e-9 && si >= 1) {
    return si === 1 ? { main: '1', sub: '기준 (1칸일 때)' } : { main: `1/${si * si}`, sub: `= ${B.toFixed(2)}` };
  }
  // 가까운 분수(약 1/3)는 반올림 차이가 작을 때(10% 이내)만 보여 줌
  const n = Math.round(1 / B);
  return { main: B.toFixed(2), sub: n >= 2 && Math.abs(n * B - 1) <= 0.1 ? `약 1/${n}` : '' };
}
function fmtBrightCell(d) {
  const p = brightParts(d);
  return p.sub.startsWith('약') ? `${p.main} <small>(${p.sub})</small>` : p.main;
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
      starDistancePc: D === st.dist ? D : D < 0.01 ? +D.toPrecision(3) : +D.toFixed(2),
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
  $('roSide').textContent = `한 변 ${f1(s)} cm`;
  const bp = brightParts(d);
  $('roB').textContent = bp.main;
  $('roBSub').textContent = bp.sub;
  $('roB').title = B.toFixed(3);
  $('bbarFill').style.width = `${Math.min(B, 1) * 100}%`;
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
  const I = Math.min(1, 0.3 + 0.7 * Math.sqrt(Math.min(B, 1)));   // 어두워도 무늬가 보이게(화면 밝기는 실제 비율이 아님)
  g.save();
  g.beginPath(); g.rect(m, m, size - 2 * m, size - 2 * m); g.clip();
  g.filter = S.quality === 'high' ? `blur(${(0.4 + d * 0.06).toFixed(1)}px)` : 'none';
  g.fillStyle = `rgba(255,248,205,${I})`;
  g.fillRect(x0, y0 - w, w, w);
  g.filter = 'none';
  g.strokeStyle = 'rgba(255,236,140,.95)'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
  g.strokeRect(x0, y0 - w, w, w); g.setLineDash([]);
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
    tr.innerHTML = `<td>${f1(r.d)}</td><td>${f1(cellsOf(r.d))}</td><td>${fmtBrightCell(r.d)}</td>` +
      `<td class="del"><button aria-label="${f1(r.d)} cm 줄 지우기" title="이 줄 지우기">✕</button></td>`;
    tr.querySelector('button').addEventListener('click', () => {
      S.lamp.records = S.lamp.records.filter(x => x !== r);
      sound.off(); renderRecords(); pushState();
    });
    tb.appendChild(tr);
  }
  $('recCount').textContent = `${S.lamp.records.length} / 6줄`;
  $('recEmpty').hidden = S.lamp.records.length > 0;
  checkCompare();
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
  toast(`${s.name}${eulReul(s.name)} 10 pc에 놓았어요 → 절대 등급 ${fmtMag(s.M)}등급`);
  renderStarPanel();
  checkCompare();
  const el = $('roAbs').closest('.ro');
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

function renderStarPanel() {
  const s = byId(S.star.sel), D = S.star.dist[s.id];
  document.querySelectorAll('#starChips .chip').forEach(c => c.setAttribute('aria-checked', String(c.dataset.id === s.id)));
  $('roReal').textContent = fmtPc(s.dist);
  $('roRealSub').textContent = s.id === 'sun' ? '지구–태양 거리' : '';
  $('roReal').title = s.id === 'sun' ? '1 AU = 지구와 태양 사이 거리 ≈ 0.00000485 pc' : '';
  $('roNow').textContent = fmtPc(D);
  const dc = fmtDistCmp(D / s.dist);
  $('roDMul').textContent = dc.v; $('roDMulSub').textContent = dc.sub;
  const bm = (s.dist / D) ** 2;
  $('roBMul').textContent = fmtRatio2(bm);
  const dm = Math.abs(magAt(s, D) - s.m0);   // 등급 차이로도 함께 보여 줌
  $('roBMulSub').textContent = Math.abs(bm - 1) < 0.005 ? '그대로'
    : dm >= 0.05 ? `${f1(dm)}등급 ${bm > 1 ? '더 밝게' : '더 어둡게'}` : bm > 1 ? '더 밝게 보임' : '더 어둡게 보임';
  fitText($('roDMul')); fitText($('roBMul')); fitText($('roNow'));
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
    const mine = S.star.pred === s.id ? ' <span class="mine" title="처음에 고른 예상">내 예상</span>' : '';
    return `<tr class="${s.id === S.star.sel ? 'sel' : ''}"><td><span class="dot" style="background:${s.ui}"></span>${s.name}${mine}</td>` +
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
  renderPredLines(); renderResTable(); pushState();
}));

function onPcInput() {
  if (locked()) return;
  stopAnim();
  let D = pcFromSlider(+pcSlider.value);
  if (Math.abs(D - 10) <= 0.3) D = 10;
  hideHint('starHint');
  setStarDist(S.star.sel, D);
}
pcSlider.addEventListener('input', onPcInput);
// 키보드: ←/→ 한 번에 눈금 1/100(약 8%), PageUp/Down 1/10, Home/End 끝 — 누를 때마다 틱 소리
pcSlider.addEventListener('keydown', e => {
  const step = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10, PageUp: 100, PageDown: -100, Home: -1000, End: 1000 }[e.key];
  if (step === undefined || locked()) return;
  e.preventDefault();
  let v = clamp(+pcSlider.value + step, 0, 1000);
  // 10 pc를 건너뛰지 않게
  const v10 = sliderFromPc(10), cur = +pcSlider.value;
  if ((cur < v10 - 0.5 && v > v10) || (cur > v10 + 0.5 && v < v10)) v = v10;
  pcSlider.value = v;
  onPcInput();
  sound.tick(v / 1000);
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

// 슬라이더 눈금 글자를 실제 값 위치에 (손잡이 폭 24px 고려)
function buildScale(el, ticks) {
  el.innerHTML = ticks.map(([f, label], i) => {
    const cls = i === 0 ? 'first' : i === ticks.length - 1 ? 'last' : '';
    return `<span class="${cls}" style="--f:${f.toFixed(4)}">${label}</span>`;
  }).join('');
}
buildScale($('dScale'), [[6, '6 cm'], [10, '10'], [20, '20'], [30, '30 cm']].map(([v, l]) => [(v - D_MIN) / (D_MAX - D_MIN), l]));
buildScale($('pcScale'), [[0.5, '0.5 pc'], [10, '10 pc'], [100, '100'], [1000, '1000 pc']].map(([v, l]) => [sliderFromPc(v) / 1000, l]));

// 칸보다 긴 값은 글자를 조금 줄임
function fitText(b) {
  b.classList.remove('long');
  if (b.scrollWidth > b.clientWidth + 1) b.classList.add('long');
}

// 예상과 결과를 비교할 때 (정답은 보여 주지 않고 비교하라고만 알림)
function lampReady() {
  const r = S.lamp.records.map(x => x.d);
  return r.length >= 3 || r.some(a => r.some(b => Math.abs(b - 2 * a) < 1e-9));
}
const starReady = () => ['sirius', 'mirzam', 'muliphein'].every(id => S.star.found.has(id));
function checkCompare() {
  const lr = lampReady(), sr = starReady();
  if (lr && !S.lamp.cmp) {
    sound.chime();
    toast(S.lamp.pred ? '기록이 모였어요! 처음 예상과 기록 표의 \'한 칸 밝기\'를 비교해 보세요' : '기록이 모였어요! [예상하기]로 생각을 정리하고 기록 표와 비교해 보세요', 3600);
  }
  if (sr && !S.star.cmp) {
    sound.chime();
    toast(S.star.pred ? '시리우스·미르잠·물리펜의 절대 등급을 모두 찾았어요! 결과 표에서 \'내 예상\'과 비교해 보세요' : '시리우스·미르잠·물리펜의 절대 등급을 모두 찾았어요! [예상하기]로 생각을 정리하고 결과 표와 비교해 보세요', 3600);
  }
  S.lamp.cmp = lr; S.star.cmp = sr;
  renderPredLines();
}

// 알림(토스트)은 장면 영역 위쪽 가운데에 — 등급 자·제목을 가리지 않게
// 탭 ①: 장면 아래쪽(정면 보기 창 왼쪽, 실험대 위) — 이름표들은 장면 위·가운데에 있음
// 탭 ②: 밤하늘 창 오른쪽 위(별 이름표가 없는 곳)
function placeToast() {
  const t = document.querySelector('.toast'), r = $('scene').getBoundingClientRect();
  if (!t || !r.width) return;
  if (S.mode === 'lamp') {
    const inset = $('frontInset').getBoundingClientRect();
    const right = inset.width ? inset.left - 12 : r.right - 12, left = r.left + 12;
    t.style.left = `${(left + right) / 2}px`;
    t.style.top = 'auto';
    t.style.bottom = `${Math.max(8, innerHeight - r.bottom + 14)}px`;
    t.style.maxWidth = `${Math.max(240, right - left)}px`;
  } else {
    const portrait = innerWidth < innerHeight, rulerW = r.width < 700 ? 116 : 130, skyW = r.width - rulerW;
    // 세로 화면: 밤하늘 제목 오른쪽 맨 위(별들이 아래쪽에 모여 있음)
    const left = r.left + (portrait ? 252 : skyW * 0.5), right = r.left + skyW - 10;
    t.style.left = `${(left + right) / 2}px`;
    t.style.bottom = 'auto';
    t.style.top = `${r.top + (portrait ? 6 : 36)}px`;
    t.style.maxWidth = `${Math.max(240, right - left)}px`;
  }
}

// ---------------- 공통 ----------------
// 예상 옆에 실험 값만 나란히 (맞았는지는 학생이 판단)
function lampExpLine() {
  const r = S.lamp.records.map(x => x.d);
  let pair = null;
  for (const a of r) { const b = r.find(x => Math.abs(x - 2 * a) < 1e-9); if (b) { pair = [a, b]; break; } }
  const bt = d => brightParts(d).main;
  return pair
    ? `<span class="vs">↔ 실험: <b>${f1(pair[0])} cm</b>일 때 <b>${bt(pair[0])}</b> → <b>${f1(pair[1])} cm</b>일 때 <b>${bt(pair[1])}</b></span>`
    : '<span class="vs">↔ 실험: 거리가 2배인 두 줄을 기록하면 여기에 나와요</span>';
}
function renderPredLines() {
  const lp = $('lampPredLine'), sp = $('starPredLine');
  const lc = S.lamp.cmp, sc = S.star.cmp;
  lp.classList.toggle('compare', lc); sp.classList.toggle('compare', sc);
  lp.innerHTML = S.lamp.pred
    ? `<span>${lc ? '<em>기록 표와 비교!</em> ' : ''}내 예상: 거리 2배 → 한 칸 밝기 <b>${LAMP_PRED[S.lamp.pred]}</b>${lc ? lampExpLine() : ''}</span><button class="btn" data-open="predictLamp">바꾸기</button>`
    : `<span>${lc ? '<em>기록이 모였어요.</em> ' : ''}아직 예상을 고르지 않았어요</span><button class="btn" data-open="predictLamp">예상하기</button>`;
  const ps = S.star.pred && byId(S.star.pred);
  sp.innerHTML = ps
    ? `<span>${sc ? '<em>결과 표와 비교!</em> ' : ''}내 예상: ${sc ? '' : '실제로 가장 밝은 별 '}<b>${ps.name}</b></span><button class="btn" data-open="predictStar">바꾸기</button>`
    : `<span>${sc ? '<em>결과가 모였어요.</em> ' : ''}아직 예상을 고르지 않았어요</span><button class="btn" data-open="predictStar">예상하기</button>`;
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
  $('predictLamp').hidden = !(mode === 'lamp' && !S.lamp.pred && !locked());
  $('predictStar').hidden = !(mode === 'star' && !S.star.pred && !locked());
  placeToast();
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
const ALLOW_LOCKED = '.tab, #btnMute, #btnQuality';   // 잠금 뒤에도 되는 것: 탭 보기, 소리, 화질
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

// 초기화 — 브라우저 confirm() 대신 메뉴 안에서 한 번 더 묻기 (웹앱 창 안에서도 동작)
const menu = $('resetMenu');
function setMenu(open, confirmStep = false) {
  menu.hidden = !open;
  $('resetChoices').hidden = confirmStep;
  $('resetConfirm').hidden = !confirmStep;
  $('btnReset').setAttribute('aria-expanded', String(open));
}
$('btnReset').addEventListener('click', e => { e.stopPropagation(); setMenu(menu.hidden); sound.click(); });
document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('.reset-wrap')) setMenu(false); });
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
  checkCompare();
}
$('btnResetTab').addEventListener('click', () => {
  setMenu(false);
  S.mode === 'lamp' ? resetLamp() : resetStar();
  sound.reset(); sound.whoosh(); toast('이 탭을 처음 상태로 돌렸어요'); pushState();
});
$('btnResetAll').addEventListener('click', () => { setMenu(true, true); sound.click(); $('btnResetNo').focus(); });
$('btnResetNo').addEventListener('click', () => { setMenu(false); sound.click(); $('btnReset').focus(); });
$('btnResetYes').addEventListener('click', () => {
  setMenu(false);
  resetLamp(); resetStar();
  S.lamp.pred = ''; S.star.pred = ''; S.lamp.cmp = false; S.star.cmp = false;
  $('lampHint').classList.remove('gone'); $('starHint').classList.remove('gone');
  renderPredLines(); setMode('lamp', true); setPaused(false);
  sound.reset(); toast('모두 처음 상태로 돌렸어요'); pushState();
});

// Esc: 열린 창 닫기 (초기화 메뉴 → 등급 계단 → 다시 연 예상 창 순서)
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!menu.hidden) { setMenu(false); $('btnReset').focus(); }
  else if (!$('stairs').hidden) { $('stairs').hidden = true; sound.click(); $('btnStairs').focus(); }
  else if (!$('predictLamp').hidden && S.lamp.pred) $('predictLamp').hidden = true;
  else if (!$('predictStar').hidden && S.star.pred) $('predictStar').hidden = true;
});

// 잠금 뒤에는 탭 전환(보기)·소리·화질만 허용 — 마우스·터치·키보드 모두 막음
const blockedTarget = t => t && t.closest && t.closest('#app') && !t.closest(ALLOW_LOCKED);
['click', 'input', 'change', 'pointerdown'].forEach(type => document.addEventListener(type, e => {
  if (locked() && blockedTarget(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true));
window.addEventListener('keydown', e => {
  if (!locked() || e.key === 'Tab' || e.key === 'Shift') return;
  if (blockedTarget(e.target) || (e.code === 'Space' && e.target === document.body)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
Bridge.onLock = () => {
  lamp.cancelDrag(); starView.cancelDrag(); stopAnim();
  document.querySelectorAll('#app input').forEach(i => { i.disabled = true; });
  setMenu(false);
  $('predictLamp').hidden = true; $('predictStar').hidden = true;   // 잠긴 뒤에는 닫을 수 없으므로 예상 카드를 치움
};

// ---------------- 크기 변화 ----------------
const ro = new ResizeObserver(() => {
  placeToast();
  if (S.mode === 'lamp') lamp.resize(); else starView.layout();
  drawInset();
  if (!$('stairs').hidden) drawStairs();
});
ro.observe($('scene'));
window.addEventListener('resize', placeToast);

// ---------------- 반복 ----------------
const fps = new FpsMonitor(() => {
  if (S.quality !== 'high') return;
  applyQuality('low');
  toast('화면이 느려서 그래픽 품질을 \'낮음\'으로 바꿨어요 (✨ 버튼으로 되돌릴 수 있어요)', 5000);
  const b = $('btnQuality'); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
}, { threshold: 30, window: 4 });
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
placeToast();
applyQuality(S.quality);
setLampD(D0, { silent: true });
renderRecords();
renderPredLines();
renderStarPanel();
setMode('lamp', true);
requestAnimationFrame(loop);
