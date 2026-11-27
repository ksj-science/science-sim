// 15-3-1-2-02 마그네슘을 태워 질량비 찾기
// 단순화(설계서): 도가니 질량은 저울 영점으로 맞춤, 연기 손실·질소 반응·측정 오차 없음.
// 완전 연소 시 산화 마그네슘 = 마그네슘 × 5/3. 가열 모형: T = 4 + 4m (초), s = min(1, t/T), f = s²(3 − 2s).
import { sound } from '../../lib/sound.js';
import { clamp, lerp, ease, damp } from '../../lib/utils.js';

const $ = id => document.getElementById(id);
const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;
const f2 = v => r2(v).toFixed(2);
const fmtS = v => (Math.abs(r1(v) - v) < 1e-9 ? r1(v).toFixed(1) : r2(v).toFixed(2));
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const isLocked = () => document.documentElement.classList.contains('sim-locked');
const COL = ['가', '나', '다', '라', '마', '바'];
const MAXROWS = 6;

SimBridge.init('15-3-1-2-02');

// ───────── 공통 상태 ─────────
const app = { tab: 'mg', paused: false, quality: 'high' };
const mg = {
  ribbon: null, ribbonSeq: 0,
  burning: false,
  atScale: true, move: null,      // move = { t, toScale }
  scaleReading: null,
  heatAfterComplete: 0,
  rows: [], rowSeq: 0,
  lineDrawn: false,
  ratioMgO: '', ratioMgMgO: '',
  mini: [],                       // 지금 리본의 [{x: 가열 시간, y: 저울 값}]
  eqOpen: false,
  particles: [], glow: 0,
};
const comp = { cur: 'water', mass: { water: 9.0, cuo: 5.0, mgo: 2.0 }, viewed: new Set(['water']), lawShown: false, frac: 1 / 9 };
const toastSt = { bread: 6, egg: 4, made: 0, started: 0, batches: [], shown: false };

const COMPOUNDS = {
  water: { name: '물', a: '수소', b: '산소', fa: 1 / 9, ca: '#8fb4d9', cb: '#e5533d', min: 0.9, max: 18, step: 0.9, ratio: '수소 : 산소 = 1 : 8' },
  cuo: { name: '산화 구리(Ⅱ)', a: '구리', b: '산소', fa: 4 / 5, ca: '#c8743a', cb: '#e5533d', min: 1, max: 10, step: 0.5, ratio: '구리 : 산소 = 4 : 1' },
  mgo: { name: '산화 마그네슘', a: '마그네슘', b: '산소', fa: 3 / 5, ca: '#9aa5b1', cb: '#e5533d', min: 0.5, max: 5, step: 0.5, ratio: '마그네슘 : 산소 = 3 : 2' },
};

// ───────── SimBridge (0.15초 모아서 보냄) ─────────
let pushTimer = null;
function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const rb = mg.ribbon;
    const c = COMPOUNDS[comp.cur], m = comp.mass[comp.cur];
    SimBridge.setState({
      mode: app.tab,
      mgMass: rb ? rb.m : 0,
      heatSec: rb ? r1(rb.heat) : 0,
      burning: mg.burning,
      complete: !!(rb && rb.complete),
      scaleReading: mg.scaleReading,
      heatAfterCompleteSec: r1(mg.heatAfterComplete),
      rows: mg.rows.map(r => ({ mg: r.mg, mgo: r.mgo, oInput: r.oInput === '' ? null : +r.oInput, oOk: r.oOk, complete: r.complete })),
      completeRowCount: mg.rows.filter(r => r.complete).length,
      oxygenOkCount: mg.rows.filter(r => r.oOk).length,
      lineDrawn: mg.lineDrawn,
      ratioMgO: mg.ratioMgO,
      ratioMgMgO: mg.ratioMgMgO,
      compound: comp.cur,
      compoundMass: m,
      piePartA: r1(m * c.fa),
      piePartB: r1(m * (1 - c.fa)),
      compoundsViewed: [...comp.viewed],
      lawShown: comp.lawShown,
      toastBread: toastSt.bread,
      toastEgg: toastSt.egg,
      toastMade: toastSt.made,
    });
  }, 150);
}

let toastTimer;
function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const beep = () => { sound._tone({ freq: 2093, type: 'square', dur: 0.07, vol: 0.05 }); sound._tone({ freq: 2093, type: 'square', dur: 0.07, vol: 0.05, delay: 0.1 }); };
const goodSnd = () => { sound._tone({ freq: 784, type: 'triangle', dur: 0.14, vol: 0.14 }); sound._tone({ freq: 1175, type: 'triangle', dur: 0.22, vol: 0.14, delay: 0.1 }); };
const badSnd = () => sound._tone({ freq: 220, type: 'triangle', dur: 0.25, vol: 0.16 });

// ───────── 캔버스 맞춤 ─────────
function fit(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = app.quality === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// ═════════ ② 마그네슘 태우기 ═════════
const T_OF = m => 4 + 4 * m;
const fOf = rb => { const s = Math.min(1, rb.heat / T_OF(rb.m)); return s * s * (3 - 2 * s); };
const readingOf = rb => r2(rb.m + (2 / 3) * rb.m * rb.f);

function newRibbon(m) {
  mg.ribbon = { id: ++mg.ribbonSeq, m: r2(m), heat: 0, f: 0, complete: false };
  mg.atScale = true; mg.move = null;
  mg.scaleReading = mg.ribbon.m;
  mg.mini = [{ x: 0, y: mg.ribbon.m }];
  mg.particles = [];
  updateMini();
}

const slider = $('mgSlider');
const sliderVal = () => r2(+slider.value);

function setMsg(text, cls = '') { const el = $('mgMsg'); el.textContent = text; el.className = 'msg ' + cls; }
function guide() {
  const rb = mg.ribbon;
  if (mg.move) return;
  if (mg.burning) {
    if (rb.complete) setMsg('완전히 연소했어요. 계속 가열하면 어떻게 될까요? 불을 끄고 저울로 재 보세요.', 'good');
    else setMsg('마그네슘이 밝은 빛을 내며 타고 있어요. 공기 중의 산소가 결합하고 있어요.');
    return;
  }
  if (mg.atScale) {
    if (rb.heat === 0) setMsg(`가열 전 질량 ${f2(rb.m)} g을 재었어요. 도가니를 삼발이로 옮겨 불을 붙여 보세요.`);
    else if (rb.complete) setMsg('더 이상 질량이 늘지 않아요 = 완전히 연소했어요. [표에 기록]을 눌러 보세요.', 'good');
    else setMsg('아직 덜 탔어요. 기록할 수도 있고, 다시 가열해 볼 수도 있어요.', 'warn');
  } else {
    setMsg(rb.heat === 0 ? '[불 붙이기]를 눌러 가열해 보세요.' : '불을 다시 붙여 더 가열하거나, 저울에 올려 질량을 재 보세요.');
  }
}

function syncSteps() {
  const rb = mg.ribbon;
  const recorded = mg.rows.some(r => r.ribbonId === rb.id && r.mgo === mg.scaleReading);
  const now = rb.heat === 0 ? 1 : (mg.burning || !mg.atScale || mg.move) ? 2 : recorded ? 4 : 3;
  document.querySelectorAll('#stepsCard li').forEach((li, i) => { li.className = i < now ? 'done' : i === now ? 'now' : ''; });
}
function syncMgUI() {
  const rb = mg.ribbon, moving = !!mg.move;
  syncSteps();
  $('mgOut').textContent = f2(sliderVal()) + ' g';
  const fire = $('btnFire');
  fire.textContent = mg.burning ? '🧯 불 끄기' : '🔥 불 붙이기';
  fire.classList.toggle('on', mg.burning);
  fire.disabled = moving || mg.atScale;
  $('btnScale').textContent = mg.atScale ? '↩ 삼발이로 옮기기' : '⚖ 저울에 올려 재기';
  $('btnScale').disabled = moving || mg.burning;
  $('btnNew').disabled = moving || mg.burning;
  $('btnRecord').disabled = moving || !mg.atScale || mg.burning;
  $('heatOut').textContent = (rb ? rb.heat : 0).toFixed(1) + ' 초';
  $('eqBtn').textContent = mg.eqOpen ? '반응식 접기' : '반응식 보기';
  $('eqBtn').setAttribute('aria-expanded', String(mg.eqOpen));
  $('eqText').hidden = !mg.eqOpen;
  guide();
}

// ─── 조작 ───
let lastSliderTick = 0;
slider.addEventListener('input', () => {
  if (isLocked()) return;
  sound.tick((+slider.value - 0.15) / 1.65);
  const rb = mg.ribbon;
  // 아직 가열하지 않은 리본이 저울 위에 있으면 바로 바꿔 넣음
  if (rb && rb.heat === 0 && mg.atScale && !mg.move && !mg.burning) { newRibbon(sliderVal()); }
  else if (performance.now() - lastSliderTick > 1500) { lastSliderTick = performance.now(); toast('[새 리본 넣기]를 누르면 이 질량의 리본으로 바뀌어요.'); }
  syncMgUI(); push();
});

$('btnNew').addEventListener('click', () => {
  if (isLocked() || mg.burning || mg.move) return;
  sound.swish(0.16);
  newRibbon(sliderVal());
  syncMgUI(); push();
});

function toggleFire() {
  if (isLocked() || mg.move || mg.atScale) return;
  mg.burning = !mg.burning;
  if (mg.burning) { sound.whoosh(); startFlameSound(); }
  else { sound.off(); stopFlameSound(); }
  syncMgUI(); push();
}
$('btnFire').addEventListener('click', toggleFire);

function toggleScale() {
  if (isLocked() || mg.move || mg.burning) return;
  mg.move = { t: 0, toScale: !mg.atScale };
  sound.soft();
  syncMgUI();
}
$('btnScale').addEventListener('click', toggleScale);

$('btnRecord').addEventListener('click', () => {
  if (isLocked() || !mg.atScale || mg.move || mg.burning) return;
  const rb = mg.ribbon;
  if (rb.heat === 0) { badSnd(); toast('먼저 가열한 뒤에 기록해 보세요.'); return; }
  const vals = { mg: rb.m, mgo: mg.scaleReading, complete: rb.complete };
  let row = mg.rows.find(r => r.ribbonId === rb.id);
  if (row) {
    if (row.mgo === vals.mgo && row.complete === vals.complete) { toast('이미 표에 기록한 값이에요.'); sound.softLow(); return; }
    Object.assign(row, vals, { oInput: '', oOk: false });
    toast(`(${COL[mg.rows.indexOf(row)]}) 열을 새로 잰 값으로 고쳤어요. 산소의 질량을 다시 구해 보세요.`);
  } else {
    if (mg.rows.length >= MAXROWS) { badSnd(); toast('표가 가득 찼어요. 가장 오래된 실험부터 [×]로 지워 주세요.', 3000); return; }
    row = { id: ++mg.rowSeq, ribbonId: rb.id, ...vals, oInput: '', oOk: false };
    mg.rows.push(row);
  }
  sound.record();
  syncSteps(); renderTable(); updateGraphs(); renderRatio(row.id);
  push();
  setTimeout(() => { const inp = document.querySelector(`input[data-row="${row.id}"]`); if (inp && !matchMedia('(pointer: coarse)').matches) inp.focus(); }, 30);
});

$('eqBtn').addEventListener('click', () => { if (isLocked()) return; mg.eqOpen = !mg.eqOpen; sound.soft(); syncMgUI(); });

// 실험대 직접 누르기 (버너 → 불, 도가니 → 옮기기)
const benchCv = $('benchCv');
let benchView = { k: 1, ox: 0, oy: 0 };
const toVirtual = e => { const r = benchCv.getBoundingClientRect(); return { x: (e.clientX - r.left - benchView.ox) / benchView.k, y: (e.clientY - r.top - benchView.oy) / benchView.k }; };
const hitCrucible = p => { const c = cruciblePos(); return Math.abs(p.x - c.x) < 50 && p.y > c.y - 70 && p.y < c.y + 8; };
const hitBurner = p => p.x > 160 && p.x < 290 && p.y > 300 && p.y < 405;
benchCv.addEventListener('pointerdown', e => {
  if (isLocked()) return;
  const p = toVirtual(e);
  if (hitCrucible(p)) { if (mg.burning) { toast('불을 먼저 꺼야 옮길 수 있어요.'); badSnd(); } else toggleScale(); }
  else if (hitBurner(p)) { if (mg.atScale) { toast('도가니를 먼저 삼발이에 올려 주세요.'); badSnd(); } else toggleFire(); }
});
benchCv.addEventListener('pointermove', e => { const p = toVirtual(e); benchCv.style.cursor = hitCrucible(p) || hitBurner(p) ? 'pointer' : 'default'; });

// ─── 소리: 불꽃 쉬익 + 타는 지글 ───
let hiss = null, sizzle = null;
function startFlameSound() {
  hiss = sound.sweep(); hiss.set(0.05);
  if (!mg.ribbon.complete) { sizzle = sound.sweep(); sizzle.set(0.95); }
}
function stopFlameSound() { if (hiss) hiss.stop(); if (sizzle) sizzle.stop(); hiss = sizzle = null; }

// ─── 표 ───
function renderTable() {
  const rows = mg.rows;
  let h = '<table class="data rtab"><thead><tr><th>실험</th>';
  for (let i = 0; i < MAXROWS; i++) {
    const r = rows[i];
    h += r ? `<th class="${r.complete ? '' : 'part'}"><span class="colhead">(${COL[i]})<button class="del" data-del="${r.id}" aria-label="(${COL[i]}) 실험 지우기" title="이 실험 지우기">×</button></span>${r.complete ? '' : '<span class="badge">덜 탔어요</span>'}</th>`
           : `<th class="empty">(${COL[i]})</th>`;
  }
  h += '</tr></thead><tbody>';
  const line = (label, fn) => {
    h += `<tr><th>${label}</th>`;
    for (let i = 0; i < MAXROWS; i++) { const r = rows[i]; h += r ? `<td class="${r.complete ? '' : 'part'}">${fn(r)}</td>` : '<td class="empty">·</td>'; }
    h += '</tr>';
  };
  line('마그네슘의 질량(g)', r => f2(r.mg));
  line('산화 마그네슘의 질량(g)', r => f2(r.mgo));
  line('산소의 질량(g)', r => `<input type="number" inputmode="decimal" step="0.01" min="0" data-row="${r.id}" value="${r.oInput}" class="${r.oInput === '' ? '' : r.oOk ? 'ok' : 'bad'}" aria-label="산소의 질량(g) 입력" placeholder="?">`);
  h += '</tbody></table>';
  $('tableWrap').innerHTML = h;
}
function checkOxygen(inp) {
  if (isLocked()) return;
  const row = mg.rows.find(r => r.id === +inp.dataset.row); if (!row) return;
  const raw = inp.value.trim();
  if (raw === '') { row.oInput = ''; row.oOk = false; inp.className = ''; updateGraphs(); push(); return; }
  const v = +raw;
  if (!isFinite(v)) return;
  if (row.oInput === raw && inp.classList.contains(row.oOk ? 'ok' : 'bad')) return;
  row.oInput = raw;
  row.oOk = Math.abs(v - (row.mgo - row.mg)) <= 0.005;
  inp.className = row.oOk ? 'ok' : 'bad';
  const tm = $('tableMsg');
  if (row.oOk) { goodSnd(); tm.textContent = `✓ (${COL[mg.rows.indexOf(row)]}) 산소의 질량을 그래프 2에 찍었어요.`; tm.className = 'tmsg good'; }
  else { badSnd(); tm.textContent = '산화 마그네슘 질량에서 마그네슘 질량을 빼 보세요.'; tm.className = 'tmsg'; }
  updateGraphs(); renderRatio(); push();
}
$('tableWrap').addEventListener('keydown', e => { if (e.target.matches('input') && e.key === 'Enter') { e.preventDefault(); checkOxygen(e.target); } });
$('tableWrap').addEventListener('change', e => { if (e.target.matches('input')) checkOxygen(e.target); });
$('tableWrap').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b || isLocked()) return;
  const id = +b.dataset.del;
  mg.rows = mg.rows.filter(r => r.id !== id);
  sound.softLow();
  $('tableMsg').textContent = '';
  renderTable(); updateGraphs(); renderRatio(); push();
});

// ─── 그래프 ───
Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.font.size = 12;
Chart.defaults.color = '#5b6577';
function scatter(cv, xt, yt) {
  return new Chart(cv, {
    type: 'scatter',
    data: { datasets: [
      { label: '선', data: [], showLine: true, borderColor: '#1d2433', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, order: 3 },
      { label: '완전히 연소', data: [], backgroundColor: '#1f6feb', borderColor: '#fff', borderWidth: 1.5, pointRadius: 6, pointHoverRadius: 8, order: 1 },
      { label: '덜 탔어요', data: [], backgroundColor: '#f08c2e', borderColor: '#fff', borderWidth: 1.5, pointStyle: 'triangle', pointRadius: 7, pointHoverRadius: 9, order: 1 },
      { label: '원점', data: [], backgroundColor: '#fff', borderColor: '#e5533d', borderWidth: 3, pointRadius: 6, order: 0 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      layout: { padding: { top: 6, right: 8 } },
      plugins: { legend: { display: false }, tooltip: { filter: i => i.datasetIndex === 1 || i.datasetIndex === 2,
        callbacks: { label: c => `${c.raw.tag ? '(' + c.raw.tag + ') ' : ''}${c.parsed.x.toFixed(2)} g, ${c.parsed.y.toFixed(2)} g` } } },
      scales: {
        x: { type: 'linear', min: 0, max: 1.2, ticks: { stepSize: 0.3, callback: v => (+v).toFixed(1) }, title: { display: true, text: xt }, grid: { color: '#e6e9ef' } },
        y: { min: 0, max: 2, ticks: { stepSize: 0.5, callback: v => (+v).toFixed(1) }, title: { display: true, text: yt }, grid: { color: '#e6e9ef' } },
      },
    },
  });
}
const g1 = scatter($('g1'), '마그네슘의 질량(g)', '산화 마그네슘의 질량(g)');
const g2 = scatter($('g2'), '마그네슘의 질량(g)', '산소의 질량(g)');
const mini = new Chart($('miniChart'), {
  type: 'scatter',
  data: { datasets: [
    { data: [], showLine: true, borderColor: '#1f6feb', backgroundColor: '#1f6feb', pointRadius: 4, borderWidth: 1.5 },
    { data: [], showLine: true, borderColor: '#1a8f5a', borderDash: [5, 4], borderWidth: 2, pointRadius: 0 },
  ] },
  options: {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.x.toFixed(1)} 초, ${c.parsed.y.toFixed(2)} g` } } },
    scales: {
      x: { min: 0, max: 10, ticks: { maxTicksLimit: 6 }, title: { display: true, text: '가열 시간(초)', padding: 0 } },
      y: { min: 0, max: 1.2, ticks: { maxTicksLimit: 5, callback: v => (+v).toFixed(1) }, title: { display: true, text: '저울 값(g)', padding: 0 } },
    },
  },
});

function updateMini() {
  const rb = mg.ribbon; if (!rb) return;
  const pts = mg.mini;
  const xmax = Math.max(10, Math.ceil((Math.max(...pts.map(p => p.x)) + 2) / 5) * 5);
  const ymax = Math.max(0.5, Math.ceil(rb.m * 5 / 3 * 1.15 * 2) / 2);
  mini.options.scales.x.max = xmax;
  mini.options.scales.y.max = ymax;
  mini.data.datasets[0].data = pts.map(p => ({ x: p.x, y: p.y }));
  const firstFull = pts.find(p => p.full);
  mini.data.datasets[1].data = firstFull ? [{ x: firstFull.x, y: firstFull.y }, { x: xmax, y: firstFull.y }] : [];
  mini.update();
}

function updateGraphs() {
  const big = mg.rows.some(r => r.mg > 1.2 + 1e-9);
  const sx = big ? 1.8 : 1.2;
  g1.options.scales.x.max = sx; g2.options.scales.x.max = sx;
  g1.options.scales.y.max = big ? 3 : 2;
  g2.options.scales.y.max = big ? 1.2 : 0.8;
  g2.options.scales.y.ticks.stepSize = 0.2;
  const tag = r => COL[mg.rows.indexOf(r)];
  const full = mg.rows.filter(r => r.complete), part = mg.rows.filter(r => !r.complete);
  g1.data.datasets[1].data = full.map(r => ({ x: r.mg, y: r.mgo, tag: tag(r) }));
  g1.data.datasets[2].data = part.map(r => ({ x: r.mg, y: r.mgo, tag: tag(r) }));
  const oFull = full.filter(r => r.oOk), oPart = part.filter(r => r.oOk);
  g2.data.datasets[1].data = oFull.map(r => ({ x: r.mg, y: r2(r.mgo - r.mg), tag: tag(r) }));
  g2.data.datasets[2].data = oPart.map(r => ({ x: r.mg, y: r2(r.mgo - r.mg), tag: tag(r) }));
  // 선: 완전히 연소한 점들을 원점과 함께 지나는 직선(원점을 지나는 최소 제곱)
  const lineFor = pts => {
    const sxx = pts.reduce((s, p) => s + p.x * p.x, 0), sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const k = sxy / sxx; return [{ x: 0, y: 0 }, { x: sx, y: k * sx }];
  };
  const ok1 = g1.data.datasets[1].data.length >= 3, ok2 = g2.data.datasets[1].data.length >= 3;
  g1.data.datasets[0].data = mg.lineDrawn && ok1 ? lineFor(g1.data.datasets[1].data) : [];
  g2.data.datasets[0].data = mg.lineDrawn && ok2 ? lineFor(g2.data.datasets[1].data) : [];
  g1.data.datasets[3].data = mg.lineDrawn && ok1 ? [{ x: 0, y: 0 }] : [];
  g2.data.datasets[3].data = mg.lineDrawn && ok2 ? [{ x: 0, y: 0 }] : [];
  g1.update(); g2.update();
  const btn = $('btnLine');
  btn.disabled = !ok1;
  btn.title = ok1 ? '' : '완전히 연소한 실험이 3개 이상이면 선을 이어 볼 수 있어요';
  btn.textContent = mg.lineDrawn ? '📈 선 지우기' : '📈 선 이어 보기';
}
$('btnLine').addEventListener('click', () => {
  if (isLocked()) return;
  mg.lineDrawn = !mg.lineDrawn;
  if (mg.lineDrawn) {
    sound.rise();
    if (g2.data.datasets[1].data.length < 3) toast('그래프 2는 완전히 연소한 실험의 산소의 질량을 3개 이상 맞게 넣으면 선이 그어져요.', 3200);
  } else sound.softLow();
  updateGraphs(); push();
});

// ─── 질량비 정리 ───
const ratioSel = $('ratioSel');
let ratioShown = { r1: '', r2: '' };
function renderRatio(selectId) {
  const prev = selectId ?? +ratioSel.value;
  ratioSel.innerHTML = mg.rows.length ? mg.rows.map((r, i) => `<option value="${r.id}">(${COL[i]}) 마그네슘 ${f2(r.mg)} g${r.complete ? '' : ' · 덜 탐'}</option>`).join('')
    : '<option value="">기록한 실험 없음</option>';
  if (mg.rows.some(r => r.id === prev)) ratioSel.value = String(prev);
  ratioSel.disabled = !mg.rows.length;
  const row = mg.rows.find(r => r.id === +ratioSel.value);
  $('r1btn').disabled = $('r2btn').disabled = !row;
  if (!row) { $('r1raw').textContent = '= ? : ?'; $('r2raw').textContent = '= ? : ?'; $('r1out').textContent = $('r2out').textContent = ''; return; }
  $('r1raw').textContent = row.oOk ? `= ${f2(row.mg)} : ${f2(row.mgo - row.mg)}` : `= ${f2(row.mg)} : ?`;
  $('r2raw').textContent = `= ${f2(row.mg)} : ${f2(row.mgo)}`;
  if (ratioShown.r1 !== row.id + ':' + row.mgo + ':' + row.oOk) $('r1out').textContent = '';
  if (ratioShown.r2 !== row.id + ':' + row.mgo) $('r2out').textContent = '';
}
ratioSel.addEventListener('change', () => { if (isLocked()) return; sound.soft(); renderRatio(); push(); });
function simplest(a, b) { const A = Math.round(a * 100), B = Math.round(b * 100), g = gcd(A, B) || 1; return [A / g, B / g]; }
function doRatio(which) {
  if (isLocked()) return;
  const row = mg.rows.find(r => r.id === +ratioSel.value); if (!row) return;
  const out = $(which === 1 ? 'r1out' : 'r2out');
  out.className = 'rout';
  if (!row.complete) { out.textContent = '완전히 연소한 실험을 골라 보세요'; out.className = 'rout warn'; badSnd(); return; }
  if (which === 1 && !row.oOk) { out.textContent = '먼저 표에 산소의 질량을 구해 넣어 보세요'; out.className = 'rout warn'; badSnd(); return; }
  const [a, b] = which === 1 ? simplest(row.mg, row.mgo - row.mg) : simplest(row.mg, row.mgo);
  out.textContent = `= ${a} : ${b}`;
  if (which === 1) { mg.ratioMgO = `${a}:${b}`; ratioShown.r1 = row.id + ':' + row.mgo + ':' + row.oOk; }
  else { mg.ratioMgMgO = `${a}:${b}`; ratioShown.r2 = row.id + ':' + row.mgo; }
  sound.chime();
  renderCompoundText(); push();
}
$('r1btn').addEventListener('click', () => doRatio(1));
$('r2btn').addEventListener('click', () => doRatio(2));

// ─── 실험대 그리기 ───
const TRIPOD = { x: 220, y: 258 }, SCALE = { x: 590, y: 331 };
function cruciblePos() {
  if (!mg.move) return mg.atScale ? { ...SCALE } : { ...TRIPOD };
  const e = ease.inOutCubic(clamp(mg.move.t, 0, 1));
  const u = mg.move.toScale ? e : 1 - e;
  return { x: lerp(TRIPOD.x, SCALE.x, u), y: lerp(TRIPOD.y, SCALE.y, u) - 60 * Math.sin(Math.PI * u) };
}

function stepMg(dt) {
  const rb = mg.ribbon;
  if (mg.move) {
    mg.move.t += dt / 0.8;
    if (mg.move.t >= 1) {
      mg.atScale = mg.move.toScale; mg.move = null;
      if (mg.atScale) {
        mg.scaleReading = readingOf(rb);
        const last = mg.mini[mg.mini.length - 1];
        if (!last || last.x !== r1(rb.heat)) mg.mini.push({ x: r1(rb.heat), y: mg.scaleReading, full: rb.complete });
        updateMini(); beep();
      } else sound.arrive();
      syncMgUI(); push();
    }
  }
  if (mg.burning && rb) {
    rb.heat += dt;
    rb.f = fOf(rb);
    if (rb.f >= 1 && !rb.complete) {
      rb.complete = true; rb.f = 1; sound.ding();
      if (sizzle) { sizzle.stop(); sizzle = null; }
      toast('🔆 다 탔어요! 이제 흰색 고체만 남았어요.');
      syncMgUI();
    }
    if (rb.complete) mg.heatAfterComplete = Math.max(mg.heatAfterComplete, rb.heat - T_OF(rb.m));
    $('heatOut').textContent = rb.heat.toFixed(1) + ' 초';
    push();
  }
  // 밝은 빛의 세기: 타는 동안(반응 속도에 비례) 밝아짐
  let target = 0;
  if (mg.burning && rb && !rb.complete) { const s = Math.min(1, rb.heat / T_OF(rb.m)); target = clamp(0.25 + 4 * s * (1 - s), 0, 1) * clamp(s * 6, 0, 1); }
  mg.glow = damp(mg.glow, target, 6, dt);
  // 입자(불꽃 튐·흰 연기)
  if (app.quality === 'high' && mg.glow > 0.15 && dt > 0) {
    const c = cruciblePos(), fr = ribbonFront(c);
    const n = Math.random() < mg.glow * 0.9 ? 2 : 0;
    for (let i = 0; i < n; i++) mg.particles.push({ x: fr.x, y: fr.y, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 120, life: 0.5 + Math.random() * 0.4, t: 0, kind: 'spark' });
    if (Math.random() < mg.glow * 0.25) mg.particles.push({ x: c.x + (Math.random() - 0.5) * 30, y: c.y - 50, vx: (Math.random() - 0.5) * 10, vy: -25 - Math.random() * 15, life: 2.2, t: 0, kind: 'smoke', r: 6 + Math.random() * 6 });
  }
  for (const p of mg.particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.kind === 'spark') p.vy += 420 * dt; else { p.r += 8 * dt; p.vx += (Math.random() - 0.5) * 6 * dt; } }
  mg.particles = mg.particles.filter(p => p.t < p.life);
}

function coilPoint(c, t, m) {
  const loops = 2.5 + m * 2.6, len = 26 + m * 10;
  const th = Math.PI * 2 * loops * t;
  return { x: c.x - len / 2 + len * t + 5 * Math.cos(th), y: c.y - 15 + 7 * Math.sin(th), back: Math.sin(th) < 0 };
}
function ribbonFront(c) { const rb = mg.ribbon; return coilPoint(c, rb ? Math.min(0.999, rb.f) : 0, rb ? rb.m : 0.6); }

function drawBench() {
  const { ctx, w, h } = fit(benchCv);
  // 보이는 범위: 가로 40~760, 세로는 책상(460) 기준 아래 맞춤, 최소 300 높이
  const k = Math.min(w / 720, h / 300), ox = (w - 720 * k) / 2 - 40 * k, oy = h - 460 * k;
  benchView = { k, ox, oy };
  const hq = app.quality === 'high';
  // 벽·책상 (화면 전체)
  const tableY = oy + 400 * k;
  let g = ctx.createLinearGradient(0, 0, 0, tableY);
  g.addColorStop(0, '#e9eef5'); g.addColorStop(1, '#d4dce7');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, tableY);
  if (hq) { // 실험실 벽 타일
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
    const ts = 46 * k;
    ctx.beginPath();
    for (let y = tableY - ts; y > 0; y -= ts) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    for (let x = ox % ts; x < w; x += ts) { ctx.moveTo(x, 0); ctx.lineTo(x, tableY); }
    ctx.stroke();
  }
  g = ctx.createLinearGradient(0, tableY, 0, h);
  g.addColorStop(0, '#b98a5e'); g.addColorStop(0.08, '#a87a50'); g.addColorStop(1, '#8a6240');
  ctx.fillStyle = g; ctx.fillRect(0, tableY, w, h - tableY);
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, tableY, w, 2);

  ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k);
  const fs = Math.max(13, 12 / k);
  const c = cruciblePos();
  const rb = mg.ribbon;

  // 그림자
  if (hq) {
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(220, 402, 95, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(590, 402, 135, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  // 가스 버너
  ctx.strokeStyle = '#d46a3a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(180, 388); ctx.bezierCurveTo(120, 392, 90, 396, 20, 396); ctx.stroke();
  g = ctx.createLinearGradient(178, 0, 262, 0); g.addColorStop(0, '#5f6670'); g.addColorStop(0.45, '#c9cfd6'); g.addColorStop(1, '#4d535b');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(220, 392, 44, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(176, 378, 88, 14);
  g = ctx.createLinearGradient(208, 0, 232, 0); g.addColorStop(0, '#6b727b'); g.addColorStop(0.5, '#dfe4ea'); g.addColorStop(1, '#5b626b');
  ctx.fillStyle = g; ctx.fillRect(209, 300, 22, 80);
  ctx.fillStyle = '#8b939d'; ctx.fillRect(206, 352, 28, 10);
  ctx.fillStyle = mg.burning ? '#e5533d' : '#3b4048';
  ctx.beginPath(); ctx.arc(250, 386, 6, 0, Math.PI * 2); ctx.fill();
  // 불꽃
  if (mg.burning) {
    const tt = performance.now() / 1000, fl = 1 + 0.06 * Math.sin(tt * 23) + 0.04 * Math.sin(tt * 37);
    const top = 300 - 46 * fl;
    g = ctx.createLinearGradient(0, 300, 0, top);
    g.addColorStop(0, 'rgba(70,120,255,.95)'); g.addColorStop(0.7, 'rgba(120,170,255,.6)'); g.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(209, 300); ctx.quadraticCurveTo(204, 275, 220, top); ctx.quadraticCurveTo(236, 275, 231, 300); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(40,80,220,.85)';
    ctx.beginPath(); ctx.moveTo(213, 300); ctx.quadraticCurveTo(213, 287, 220, 280 - 4 * fl); ctx.quadraticCurveTo(227, 287, 227, 300); ctx.closePath(); ctx.fill();
  }
  // 삼발이 + 점토 삼각형
  ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(158, 262); ctx.lineTo(140, 400); ctx.moveTo(282, 262); ctx.lineTo(300, 400); ctx.stroke();
  ctx.strokeStyle = '#6c727b'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(220, 266); ctx.lineTo(220, 270); ctx.stroke();
  ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.ellipse(220, 262, 64, 8, 0, Math.PI, 0); ctx.stroke();
  ctx.strokeStyle = '#efe6da'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(170, 263); ctx.lineTo(220, 250); ctx.lineTo(270, 263); ctx.stroke();
  ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.ellipse(220, 262, 64, 8, 0, 0, Math.PI); ctx.stroke();

  // 전자저울
  g = ctx.createLinearGradient(0, 340, 0, 400); g.addColorStop(0, '#f4f6f9'); g.addColorStop(1, '#c9d0da');
  ctx.fillStyle = g; rr(ctx, 465, 340, 250, 60, 12); ctx.fill();
  ctx.strokeStyle = '#a8b1be'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#9aa3b0'; ctx.fillRect(578, 333, 24, 8);
  g = ctx.createLinearGradient(0, 326, 0, 336); g.addColorStop(0, '#e9edf2'); g.addColorStop(1, '#aab3bf');
  ctx.fillStyle = g; rr(ctx, 512, 326, 156, 9, 4); ctx.fill();
  // 숫자 창
  const onScale = mg.atScale && !mg.move;
  const disp = onScale ? f2(mg.scaleReading) : '0.00';
  ctx.fillStyle = '#1e2a22'; rr(ctx, 520, 350, 140, 40, 7); ctx.fill();
  ctx.fillStyle = onScale ? '#9dff8a' : '#6fd65e';
  ctx.font = `700 26px ui-monospace, "Consolas", monospace`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(disp, 628, 371);
  ctx.font = `700 15px ${getComputedStyle(document.body).fontFamily}`; ctx.fillText('g', 648, 372);
  ctx.fillStyle = '#5b6577'; ctx.textAlign = 'left'; ctx.font = `600 12px sans-serif`;
  ctx.fillText('0', 478, 360); ctx.fillText('영점', 474, 378);
  ctx.beginPath(); ctx.arc(700, 370, 7, 0, Math.PI * 2); ctx.fillStyle = '#7c8794'; ctx.fill();

  // 도가니 + 리본
  drawCrucible(ctx, c, rb);

  // 빛 번짐
  if (mg.glow > 0.01) {
    const fr = ribbonFront(c);
    const R = 60 + 160 * mg.glow;
    g = ctx.createRadialGradient(fr.x, fr.y, 0, fr.x, fr.y, R);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * mg.glow})`); g.addColorStop(0.25, `rgba(255,255,240,${0.6 * mg.glow})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fr.x, fr.y, R, 0, Math.PI * 2); ctx.fill();
  }
  // 입자
  for (const p of mg.particles) {
    const a = 1 - p.t / p.life;
    if (p.kind === 'spark') { ctx.fillStyle = `rgba(255,250,215,${a})`; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
    else { ctx.fillStyle = `rgba(250,250,250,${0.35 * a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
  }

  // 상태 표시(도가니 위)
  if (rb && rb.heat > 0 && !mg.move) {
    const txt = rb.complete ? '완전히 연소' : mg.burning ? '타는 중' : '덜 탔어요';
    const col = rb.complete ? '#1a8f5a' : mg.burning ? '#c2410c' : '#b8620b';
    ctx.font = `700 ${fs}px ${getComputedStyle(document.body).fontFamily}`;
    const tw = ctx.measureText(txt).width + 18, cy = c.y - 86;
    ctx.fillStyle = 'rgba(255,255,255,.92)'; rr(ctx, c.x - tw / 2, cy - fs * 0.8, tw, fs * 1.6, 8); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, c.x, cy + 1);
  }
  // 이름표
  ctx.font = `600 ${fs}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.fillStyle = '#4b5565'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left'; ctx.fillText('삼발이·점토 삼각형', 302, 300); ctx.textAlign = 'center';
  ctx.fillText('가스버너', 220, 432);
  ctx.fillText('전자저울 (도가니 영점)', 590, 432);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#8a93a3'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(298, 292); ctx.lineTo(266, 266); ctx.stroke();
  ctx.restore();

  // 전체가 잠깐 밝아짐
  if (mg.glow > 0.01) { ctx.fillStyle = `rgba(255,255,250,${0.16 * mg.glow})`; ctx.fillRect(0, 0, w, h); }
}

function drawCrucible(ctx, c, rb) {
  const hq = app.quality === 'high';
  const H = 52, TW = 78, BW = 48;
  // 몸통
  let g = ctx.createLinearGradient(c.x - TW / 2, 0, c.x + TW / 2, 0);
  g.addColorStop(0, '#d9d6cf'); g.addColorStop(0.35, '#ffffff'); g.addColorStop(1, '#bdb8ae');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(c.x - TW / 2, c.y - H); ctx.lineTo(c.x + TW / 2, c.y - H);
  ctx.quadraticCurveTo(c.x + BW / 2 + 4, c.y - 6, c.x + BW / 2, c.y);
  ctx.lineTo(c.x - BW / 2, c.y); ctx.quadraticCurveTo(c.x - BW / 2 - 4, c.y - 6, c.x - TW / 2, c.y - H);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#9c968b'; ctx.lineWidth = 1.5; ctx.stroke();
  // 안쪽(입구)
  ctx.fillStyle = '#8f8a80';
  ctx.beginPath(); ctx.ellipse(c.x, c.y - H, TW / 2, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6f6a62';
  ctx.beginPath(); ctx.ellipse(c.x, c.y - H + 1.5, TW / 2 - 4, 5, 0, 0, Math.PI * 2); ctx.fill();
  if (!rb) return;
  // 리본(도가니 입구 위로 보이게 감은 모양)
  const base = { x: c.x, y: c.y - H + 4 };
  const N = 90, f = rb.f;
  const pts = []; for (let i = 0; i <= N; i++) pts.push(coilPoint(base, i / N, rb.m));
  // 뒤쪽 → 앞쪽 순으로
  for (const pass of [true, false]) {
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[i + 1]; if (p.back !== pass) continue;
      const burned = i / N < f;
      if (burned) {
        ctx.strokeStyle = pass ? '#dcdcd6' : '#f7f7f2'; ctx.lineWidth = 5.5;
      } else {
        ctx.strokeStyle = pass ? '#7f8a96' : '#c8d0da'; ctx.lineWidth = 2.6;
      }
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      if (!burned && !pass && hq && i % 6 === 0) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y - 0.8); ctx.lineTo(q.x, q.y - 0.8); ctx.stroke(); }
    }
  }
  // 다 탄 흰 가루 덩어리
  if (f > 0.02) {
    ctx.fillStyle = 'rgba(250,250,246,.95)';
    for (let i = 0; i < N * f; i += 7) {
      const p = pts[i]; const r = 2.5 + ((i * 37) % 5) * 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y + 1, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ═════════ ① 토스트 ═════════
const toastCv = $('toastCv');
const BREAD_POS = i => ({ x: 120 + (i % 2) * 74, y: 340 - Math.floor(i / 2) * 18 });
const EGG_POS = i => ({ x: 330 + (i % 4) * 40, y: 318 + Math.floor(i / 4) * 34 });
const PLATE = { x: 620, y: 350 };
function syncToastUI() {
  const t = toastSt;
  $('breadOut').textContent = t.bread + '조각';
  $('eggOut').textContent = t.egg + '개';
  const busy = t.batches.some(b => !b.landed);
  $('breadMinus').disabled = busy || t.bread <= 0; $('breadPlus').disabled = busy || t.bread >= 12;
  $('eggMinus').disabled = busy || t.egg <= 0; $('eggPlus').disabled = busy || t.egg >= 8;
  const can = Math.min(Math.floor((t.bread - 2 * t.started) / 2), t.egg - t.started);
  $('toastMake').disabled = busy || can <= 0;
  $('toastAgain').disabled = busy || t.started === 0;
  if (t.shown && !busy) $('toastResult').innerHTML = `토스트 <b>${t.made}개</b>, 남은 식빵 <b>${t.bread - 2 * t.made}조각</b>, 남은 달걀 <b>${t.egg - t.made}개</b>`;
  else if (!busy) $('toastResult').textContent = '[토스트 만들기]를 눌러 보세요.';
}
function stepToast(dt) {
  for (const b of toastSt.batches) {
    if (b.landed) continue;
    b.t += dt;
    if (b.t >= b.delay && !b.started) { b.started = true; toastSt.started++; }
    if (b.t >= b.delay + 0.75) { b.landed = true; toastSt.made++; sound.bubble(); syncToastUI(); push(); }
  }
}
function changeStock(key, d) {
  if (isLocked()) return;
  const max = key === 'bread' ? 12 : 8;
  toastSt[key] = clamp(toastSt[key] + d, 0, max);
  toastSt.made = 0; toastSt.started = 0; toastSt.batches = []; toastSt.shown = false;
  sound.tick(toastSt[key] / max);
  syncToastUI(); push();
}
$('breadMinus').addEventListener('click', () => changeStock('bread', -1));
$('breadPlus').addEventListener('click', () => changeStock('bread', 1));
$('eggMinus').addEventListener('click', () => changeStock('egg', -1));
$('eggPlus').addEventListener('click', () => changeStock('egg', 1));
$('toastMake').addEventListener('click', () => {
  if (isLocked()) return;
  const t = toastSt;
  const n = Math.min(Math.floor((t.bread - 2 * t.started) / 2), t.egg - t.started);
  if (n <= 0) return;
  t.shown = true;
  for (let i = 0; i < n; i++) {
    const k = t.started + i;
    t.batches.push({ k, t: 0, delay: i * 0.6, started: false, landed: false });
  }
  sound.click();
  $('toastResult').textContent = '만드는 중…';
  syncToastUI();
});
$('toastAgain').addEventListener('click', () => {
  if (isLocked()) return;
  Object.assign(toastSt, { made: 0, started: 0, batches: [], shown: false });
  sound.reset(); syncToastUI(); push();
});
$('goMg').addEventListener('click', () => setTab('mg'));

function drawBread(ctx, x, y, s = 1, toasted = false) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = toasted ? '#b8732f' : '#d9a066';
  ctx.beginPath(); ctx.moveTo(-30, 10); ctx.lineTo(-30, -14); ctx.bezierCurveTo(-36, -34, -10, -36, 0, -30); ctx.bezierCurveTo(10, -36, 36, -34, 30, -14); ctx.lineTo(30, 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = toasted ? '#e2a65a' : '#fbe7c2';
  ctx.beginPath(); ctx.moveTo(-25, 6); ctx.lineTo(-25, -13); ctx.bezierCurveTo(-30, -29, -9, -30, 0, -25); ctx.bezierCurveTo(9, -30, 30, -29, 25, -13); ctx.lineTo(25, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawEgg(ctx, x, y, s = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const g = ctx.createRadialGradient(-5, -8, 2, 0, 0, 18); g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#e8d5b5');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 13, 17, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}
function drawToast(ctx, x, y, s = 1) {
  drawBread(ctx, x, y, s, true);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, -10, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffc21a'; ctx.beginPath(); ctx.arc(1, -11, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawToastScene() {
  const { ctx, w, h } = fit(toastCv);
  const VW = 800, VH = 460;
  const k = Math.min(w / VW, h / VH), ox = (w - VW * k) / 2, oy = (h - VH * k) / 2;
  const fam = getComputedStyle(document.body).fontFamily;
  const topY = oy + 380 * k;
  let g = ctx.createLinearGradient(0, 0, 0, topY); g.addColorStop(0, '#fff7ea'); g.addColorStop(1, '#f6e3c6');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, topY);
  ctx.fillStyle = '#c9d6e3'; ctx.fillRect(0, topY, w, h - topY);
  ctx.fillStyle = '#a9b9ca'; ctx.fillRect(0, topY, w, 5);
  ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k);
  const t = toastSt;
  // 레시피 카드
  ctx.fillStyle = '#fff'; rr(ctx, 230, 24, 340, 92, 14); ctx.fill();
  ctx.strokeStyle = '#e8d2ad'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#5b6577'; ctx.font = `700 16px ${fam}`; ctx.textAlign = 'center';
  ctx.fillText('토스트 1개 만드는 법', 400, 46);
  drawBread(ctx, 280, 96, 0.7); drawBread(ctx, 318, 96, 0.7);
  ctx.fillStyle = '#1d2433'; ctx.font = `800 26px ${fam}`; ctx.fillText('+', 352, 92);
  drawEgg(ctx, 385, 84, 0.85);
  ctx.fillText('→', 425, 92);
  drawToast(ctx, 490, 98, 0.85);
  // 남은 재료 더미
  const breadLeft = t.bread - 2 * t.started, eggLeft = t.egg - t.started;
  for (let i = 0; i < breadLeft; i++) { const p = BREAD_POS(i); drawBread(ctx, p.x, p.y); }
  ctx.fillStyle = '#efe3cf'; rr(ctx, 305, 296, 180, 78, 10); ctx.fill();
  for (let i = 0; i < 8; i++) { const p = EGG_POS(i); ctx.fillStyle = '#e2d2b6'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 6, 15, 8, 0, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 0; i < eggLeft; i++) { const p = EGG_POS(i); drawEgg(ctx, p.x, p.y - 4); }
  // 접시
  ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.beginPath(); ctx.ellipse(PLATE.x, PLATE.y + 22, 120, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(PLATE.x, PLATE.y + 14, 116, 24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d6dde6'; ctx.lineWidth = 2; ctx.stroke();
  const plateSpot = i => ({ x: PLATE.x - 70 + (i % 3) * 70, y: PLATE.y + 6 - Math.floor(i / 3) * 40 });
  for (let i = 0; i < t.made; i++) { const p = plateSpot(i); drawToast(ctx, p.x, p.y); }
  // 날아가는 재료
  for (const b of t.batches) {
    if (!b.started || b.landed) continue;
    const u = ease.inOutCubic(clamp((b.t - b.delay) / 0.75, 0, 1));
    const to = plateSpot(b.k);
    const fromB1 = BREAD_POS(t.bread - 2 * b.k - 1), fromB2 = BREAD_POS(t.bread - 2 * b.k - 2), fromE = EGG_POS(t.egg - b.k - 1);
    const arc = (a, lift) => ({ x: lerp(a.x, to.x, u), y: lerp(a.y, to.y, u) - lift * Math.sin(Math.PI * u) });
    if (u < 0.85) {
      const p1 = arc(fromB1, 120), p2 = arc(fromB2, 140), pe = arc(fromE, 160);
      drawBread(ctx, p1.x, p1.y); drawBread(ctx, p2.x, p2.y); drawEgg(ctx, pe.x, pe.y);
    } else drawToast(ctx, to.x, to.y, 0.8 + (u - 0.85));
  }
  // 이름표
  ctx.fillStyle = '#4b5565'; ctx.font = `700 17px ${fam}`; ctx.textAlign = 'center';
  ctx.fillText(`식빵 ${breadLeft}조각`, 157, 410);
  ctx.fillText(`달걀 ${eggLeft}개`, 395, 410);
  ctx.fillText(`토스트 ${t.made}개`, PLATE.x, 410);
  ctx.restore();
}

// ═════════ ③ 여러 화합물 ═════════
const pieCv = $('pieCv'), smallCv = $('smallCv'), compSlider = $('compSlider');
function setCompound(key) {
  comp.cur = key; comp.viewed.add(key);
  const c = COMPOUNDS[key];
  compSlider.min = c.min; compSlider.max = c.max; compSlider.step = c.step; compSlider.value = comp.mass[key];
  document.querySelectorAll('[data-comp]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.comp === key)));
  syncCompUI();
}
function syncCompUI() {
  $('compOut').textContent = comp.mass[comp.cur].toFixed(1) + ' g';
  $('lawText').hidden = !comp.lawShown;
  $('lawBtn').textContent = comp.lawShown ? '법칙 이름 접기' : '법칙 이름 보기';
  renderCompoundText();
}
function renderCompoundText() {
  const c = COMPOUNDS[comp.cur];
  const el = $('compRatio');
  if (comp.cur === 'mgo' && !mg.ratioMgO) el.innerHTML = `${c.name}의 성분 원소의 질량비 = <span class="hint">② 탭에서 직접 구해 보세요</span>`;
  else el.textContent = `성분 원소의 질량비  ${c.ratio}`;
}
document.querySelectorAll('[data-comp]').forEach(b => b.addEventListener('click', () => {
  if (isLocked() || comp.cur === b.dataset.comp) return;
  sound.bubble(); setCompound(b.dataset.comp); push();
}));
compSlider.addEventListener('input', () => {
  if (isLocked()) return;
  const c = COMPOUNDS[comp.cur];
  comp.mass[comp.cur] = r1(clamp(Math.round(+compSlider.value / c.step) * c.step, c.min, c.max));
  sound.tick((comp.mass[comp.cur] - c.min) / (c.max - c.min));
  syncCompUI(); push();
});
$('lawBtn').addEventListener('click', () => {
  if (isLocked()) return;
  if (!comp.lawShown) { comp.lawShown = true; sound.bell(); } else { comp.lawShown = false; sound.soft(); }
  syncCompUI(); push();
});

function drawPie(ctx, cx, cy, R, fa, c, total, opt) {
  const fam = getComputedStyle(document.body).fontFamily;
  const a0 = -Math.PI / 2, a1 = a0 + fa * Math.PI * 2, a2 = a0 + Math.PI * 2;
  if (opt.shadow) { ctx.fillStyle = 'rgba(0,0,0,.10)'; ctx.beginPath(); ctx.arc(cx + 3, cy + 5, R, 0, Math.PI * 2); ctx.fill(); }
  const slice = (s, e, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, s, e); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, R * 0.02); ctx.stroke(); };
  slice(a0, a1, c.ca); slice(a1, a2, c.cb);
  const hole = R * opt.hole;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, hole, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (opt.center) {
    ctx.fillStyle = '#1d2433'; ctx.font = `800 ${Math.max(13, hole * 0.3)}px ${fam}`;
    ctx.fillText(c.name, cx, cy - hole * 0.22);
    ctx.font = `800 ${Math.max(14, hole * 0.36)}px ${fam}`; ctx.fillStyle = '#1f6feb';
    ctx.fillText(opt.totalText, cx, cy + hole * 0.25);
  }
  if (opt.labels) {
    const parts = [{ name: c.a, m: total * c.fa, s: a0, e: a1 }, { name: c.b, m: total * (1 - c.fa), s: a1, e: a2 }];
    for (const p of parts) {
      const mid = (p.s + p.e) / 2, span = p.e - p.s;
      const big = span > 0.9;
      const rr0 = big ? (R + hole) / 2 : R + opt.fs * 1.9;
      const x = cx + Math.cos(mid) * rr0, y = cy + Math.sin(mid) * rr0;
      if (!big) {
        ctx.strokeStyle = '#8a93a3'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(mid) * R * 0.92, cy + Math.sin(mid) * R * 0.92); ctx.lineTo(cx + Math.cos(mid) * (rr0 - opt.fs), cy + Math.sin(mid) * (rr0 - opt.fs)); ctx.stroke();
      }
      ctx.fillStyle = big ? '#fff' : '#1d2433';
      ctx.font = `700 ${opt.fs}px ${fam}`;
      ctx.fillText(p.name, x, y - opt.fs * 0.6);
      ctx.font = `800 ${opt.fs * 1.1}px ${fam}`;
      ctx.fillText(opt.fmt(p.m) + ' g', x, y + opt.fs * 0.65);
    }
  }
}
function drawCompound(dt) {
  const c = COMPOUNDS[comp.cur], m = comp.mass[comp.cur];
  comp.frac = damp(comp.frac, c.fa, 9, dt || 1);
  const shown = { ...c };
  let { ctx, w, h } = fit(pieCv);
  ctx.clearRect(0, 0, w, h);
  const fs = clamp(Math.min(w, h) * 0.045, 13, 20);
  const R = Math.max(30, Math.min(w / 2 - fs * 6, h / 2 - fs * 3.6));
  drawPie(ctx, w / 2, h / 2, R, comp.frac, shown, m, { hole: 0.42, center: true, labels: true, fs, totalText: m.toFixed(1) + ' g', shadow: app.quality === 'high', fmt: v => r1(v).toFixed(1) });
  ({ ctx, w, h } = fit(smallCv));
  ctx.clearRect(0, 0, w, h);
  const masses = [m / 2, m, m * 2];
  const fam = getComputedStyle(document.body).fontFamily;
  const cell = w / 3, Rmax = Math.max(14, Math.min(cell * 0.36, (h - 58) / 2));
  masses.forEach((mm, i) => {
    const Ri = Rmax * Math.sqrt(mm / (m * 2)) * 0.95 + Rmax * 0.05;
    const cx = cell * (i + 0.5), cy = (h - 50) / 2 + 4;
    drawPie(ctx, cx, cy, Ri, comp.frac, shown, mm, { hole: 0, center: false, labels: false, shadow: false });
    ctx.fillStyle = '#1d2433'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `800 14px ${fam}`; ctx.fillText(`${c.name} ${fmtS(mm)} g`, cx, h - 28);
    ctx.font = `600 13px ${fam}`; ctx.fillStyle = '#5b6577';
    ctx.fillText(`${c.a} ${fmtS(mm * c.fa)} g · ${c.b} ${fmtS(mm * (1 - c.fa))} g`, cx, h - 9);
  });
}

// ═════════ 탭·위 띠 ═════════
function setTab(t) {
  if (app.tab === t) return;
  app.tab = t;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === t)));
  $('viewToast').hidden = t !== 'toast'; $('viewMg').hidden = t !== 'mg'; $('viewCompound').hidden = t !== 'compound';
  sound.whoosh(); sound._tone({ freq: 520, freq2: 780, type: 'sine', dur: 0.1, vol: 0.06 });
  if (t === 'compound') comp.viewed.add(comp.cur);
  disarmReset();
  push();
}
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => { if (!isLocked()) setTab(b.dataset.tab); }));

function syncPause() {
  $('btnPause').textContent = app.paused ? '▶ 재생' : '⏸ 일시정지';
  if (hiss) hiss.pause(app.paused); if (sizzle) sizzle.pause(app.paused);
}
$('btnPause').addEventListener('click', () => { if (isLocked()) return; app.paused = !app.paused; sound.soft(); syncPause(); });
$('btnQuality').addEventListener('click', () => {
  if (isLocked()) return;
  app.quality = app.quality === 'high' ? 'low' : 'high';
  if (app.quality === 'low') mg.particles = [];
  $('btnQuality').textContent = app.quality === 'high' ? '✨ 품질: 높음' : '⚡ 품질: 낮음';
  sound.click();
});
const muteBtn = $('btnMute');
const syncMute = () => { muteBtn.textContent = sound.muted ? '🔇' : '🔊'; muteBtn.setAttribute('aria-pressed', String(sound.muted)); };
muteBtn.addEventListener('click', () => { sound.toggleMute(); syncMute(); sound.click(); });
syncMute();

let resetArmed = null;
function disarmReset() { clearTimeout(resetArmed); resetArmed = null; $('btnReset').classList.remove('confirm'); $('btnReset').textContent = '↺ 초기화'; }
$('btnReset').addEventListener('click', () => {
  if (isLocked()) return;
  const needConfirm = app.tab === 'mg' && (mg.rows.length > 0 || (mg.ribbon && mg.ribbon.heat > 0));
  if (needConfirm && !resetArmed) {
    $('btnReset').classList.add('confirm'); $('btnReset').textContent = '한 번 더 누르면 지워져요';
    sound.softLow();
    resetArmed = setTimeout(disarmReset, 3000);
    return;
  }
  disarmReset();
  sound.reset();
  if (app.tab === 'mg') resetMg();
  else if (app.tab === 'compound') resetCompound();
  else resetToast();
  push();
});

function resetMg() {
  if (mg.burning) { mg.burning = false; stopFlameSound(); }
  Object.assign(mg, { rows: [], lineDrawn: false, ratioMgO: '', ratioMgMgO: '', heatAfterComplete: 0, eqOpen: false, particles: [], glow: 0 });
  ratioShown = { r1: '', r2: '' };
  slider.value = 0.6;
  newRibbon(0.6);
  $('tableMsg').textContent = '';
  renderTable(); updateGraphs(); renderRatio(); syncMgUI(); renderCompoundText();
}
function resetCompound() {
  comp.mass = { water: 9.0, cuo: 5.0, mgo: 2.0 }; comp.lawShown = false; comp.viewed = new Set(['water']);
  setCompound('water');
}
function resetToast() { Object.assign(toastSt, { bread: 6, egg: 4, made: 0, started: 0, batches: [], shown: false }); syncToastUI(); }

// 잠금 시 진행 중인 것 멈춤
SimBridge.onLock = () => { if (mg.burning) { mg.burning = false; stopFlameSound(); syncMgUI(); push(); } };

// ═════════ 루프 ═════════
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const sdt = app.paused ? 0 : dt;
  stepMg(sdt);
  stepToast(sdt);
  if (app.tab === 'mg') drawBench();
  else if (app.tab === 'toast') drawToastScene();
  else drawCompound(dt);
  requestAnimationFrame(frame);
}

// 시작
newRibbon(0.6);
renderTable(); updateGraphs(); renderRatio(); syncMgUI();
setCompound('water'); syncToastUI(); syncPause();
push();
requestAnimationFrame(frame);
