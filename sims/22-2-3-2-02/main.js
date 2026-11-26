// 22-2-3-2-02 소리 분석기 — 화면 연결·상태 관리
import { sound } from '../../lib/sound.js';
import { toast, paintRange, clamp } from '../../lib/utils.js';
import {
  NOTES, INST, periodMs, shape, upCrossings, ampAt, kalA0, recA, FINGERING, strengthWord, strengthShort,
} from './model.js';
import { playKalimba, startRecorder, setRecorderAmp, releaseRecorder, stopVoice, setAir } from './audio.js';

SimBridge.init('22-2-3-2-02');

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const nowS = () => performance.now() / 1000;
const r2 = v => Math.round(v * 100) / 100;
const f2 = v => v.toFixed(2);
const locked = () => SimBridge.locked || document.documentElement.classList.contains('sim-locked');
const SVGNS = 'http://www.w3.org/2000/svg';

// ── 효과음 (분석 화면 파형에는 들어가지 않음) ──
const sfx = {
  tick: () => sound._tone({ freq: 1500, type: 'square', dur: 0.025, vol: 0.05 }),
  click: () => sound.click(),
  soft: () => sound.soft(),
  shutter: () => sound.record(),
  done: () => { sound._tone({ freq: 784, type: 'triangle', dur: 0.16, vol: 0.14 }); sound._tone({ freq: 1175, type: 'triangle', dur: 0.32, vol: 0.14, delay: 0.12 }); },
  whoosh: () => sound.whoosh(),
  airOut: () => sound._noise({ dur: 0.7, from: 3200, to: 260, vol: 0.10 }),
  airIn: () => sound._noise({ dur: 0.6, from: 260, to: 3200, vol: 0.09 }),
  reset: () => sound.reset(),
  bad: () => sound._tone({ freq: 220, type: 'triangle', dur: 0.25, vol: 0.12 }),
};

// ── 상태 ──
const DEF = { range: 10, tL: 1, tR: 3, amp: 2 };
const st = {
  step: '1',
  inst: 'kalimba',
  selTine: 0,          // 칼림바에서 고른 건반(음 번호)
  recNote: 4,          // 리코더 음 (솔)
  blowPct: 50,
  range: DEF.range,
  tL: DEF.tL, tR: DEF.tR, amp: DEF.amp,
  frozen: null,        // { sig, t, dens }
  overlay: false,
  analysis: false,
  vacuum: false,
  density: 1,          // 공기 비율 (공기 빼기 → 0)
  quality: 'high',
  blowing: false,
  drag: null,
};
let cur = null;        // 지금 소리(신호) 하나
const hist = [];       // 지난 신호들(공기 띠의 늦게 도착하는 진동용)
let sigId = 0;
const rec = {
  note: '', noteHz: 0, strengthPct: 0, plucks: 0, blows: 0,
  vacuumTried: false, analysisShown: false,
  measured: {},        // 음 이름 → 잰 주기(ms)
  overlayViewed: new Set(),
  labels: ['', '', ''],
  played1: false,
};
const steps = { 1: { A: null, B: null, done: false }, 2: { A: null, B: null, done: false }, 3: { A: null, B: null, done: false }, 4: { A: null, B: null, done: false } };

// ── SimBridge (0.15초 단위로 모아 보냄) ──
let pushTimer = 0, lastAmpSent = null;
function dispNow() {
  if (st.frozen) return st.frozen;
  return { sig: cur, t: nowS(), dens: st.density };
}
const dispAmp = d => (d.sig ? ampAt(d.sig, d.t) * d.dens : 0);
const tagOf = s => (s ? `${s.inst}|${s.note}|${strengthShort(s.pct)} ${s.amp.toFixed(1)}칸` : '');
function stateNow() {
  const dt = r2(Math.abs(st.tR - st.tL));
  const S = steps[st.step] || { A: null, B: null };
  return {
    step: st.step,
    instrument: st.inst,
    note: rec.note,
    noteHz: rec.noteHz,
    strengthPct: rec.strengthPct,
    amplitudeNow: r2(dispAmp(dispNow())),
    cursorDtMs: dt,
    cursorFreqHz: dt >= 0.05 ? Math.round(1000 / dt) : null,
    cursorAmp: Math.round(st.amp * 10) / 10,
    measuredPeriods: Object.entries(rec.measured).map(([k, v]) => `${k}:${f2(v)}`).join(', '),
    frozen: !!st.frozen,
    vacuum: st.vacuum,
    vacuumTried: rec.vacuumTried,
    plucks: rec.plucks,
    blows: rec.blows,
    snapA: tagOf(S.A),
    snapB: tagOf(S.B),
    step2Done: steps[2].done, step3Done: steps[3].done, step4Done: steps[4].done,
    overlayViewed: [...rec.overlayViewed].sort().join(','),
    summaryLabels: rec.labels.join(','),
    analysisShown: rec.analysisShown,
  };
}
function pushState() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = 0; const s = stateNow(); lastAmpSent = s.amplitudeNow; SimBridge.setState(s); }, 150);
}
SimBridge.setState(stateNow());

// ── 캔버스 도우미 ──
function fit(c) {
  const dpr = st.quality === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

// ═════════ 칼림바 ═════════
const ORDER = [6, 4, 2, 0, 1, 3, 5, 7];      // 왼쪽→오른쪽: 시 솔 미 도 레 파 라 높은 도 (가운데가 가장 낮고 긺)
const tineLen = i => 186 * Math.sqrt(NOTES[0].f / NOTES[i].f);
const TOP = 44;
const tines = [];
(function buildKalimba() {
  const svg = $('#kalimba');
  svg.innerHTML = `
  <defs>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dca267"/><stop offset=".55" stop-color="#c4864a"/><stop offset="1" stop-color="#a86a35"/></linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa3ae"/><stop offset=".45" stop-color="#f4f7fa"/><stop offset="1" stop-color="#8c96a3"/></linearGradient>
    <linearGradient id="metalHot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d4a017"/><stop offset=".45" stop-color="#fff6cf"/><stop offset="1" stop-color="#c99312"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".25"/></filter>
  </defs>
  <path d="M34 14h352a18 18 0 0 1 18 18v224a30 30 0 0 1-30 30H46a30 30 0 0 1-30-30V32a18 18 0 0 1 18-18z" fill="url(#wood)" filter="url(#sh)"/>
  <path d="M40 120c80 8 260-8 340 4M36 200c90-6 250 8 344-2M50 250c70 6 250 4 320-4" fill="none" stroke="#a5672f" stroke-opacity=".35" stroke-width="2"/>
  <rect x="34" y="30" width="352" height="16" rx="6" fill="#5e3d20"/>
  <rect x="40" y="60" width="340" height="5" rx="2.5" fill="#c3c8cf" stroke="#7d848e" stroke-width="1"/>
  <text x="210" y="274" text-anchor="middle" font-size="13" font-weight="700" fill="#fff6e6" fill-opacity=".92" pointer-events="none">↓ 건반 끝을 아래로 끌었다 놓으면 튕겨져요 · 끌수록 세게</text>
  <g id="tines"></g>`;
  const g = svg.querySelector('#tines');
  ORDER.forEach((ni, pos) => {
    const x = 210 + (pos - 3.5) * 42, L = tineLen(ni);
    const el = document.createElementNS(SVGNS, 'g');
    el.setAttribute('class', 'tine');
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${NOTES[ni].name} 건반 (Enter: 보통 세기로 튕기기)`);
    el.innerHTML = `<rect class="hit" x="${x - 21}" y="24" width="42" height="${L + 44}" fill="transparent"/>
      <rect class="tbody" x="${x - 7}" y="${TOP - 16}" width="14" height="${L + 16}" rx="6" fill="url(#metal)" stroke="#6f7782" stroke-width="1"/>
      <text class="tlabel" x="${x}" y="${TOP + L + 17}">${NOTES[ni].name}</text>`;
    g.appendChild(el);
    tines[ni] = { el, x, L, body: el.querySelector('.tbody'), label: el.querySelector('.tlabel'), off: 0 };
  });
})();

function svgPt(svg, e) {
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
function selectTine(i) {
  st.selTine = i;
  tines.forEach((t, k) => t.el.classList.toggle('sel', k === i));
  $('#selTine').textContent = NOTES[i].name;
}
selectTine(0);

const pop = $('#strengthPop');
function showPop(pct) {
  pop.hidden = false;
  $('#popVal').textContent = `${Math.round(pct)} %`;
  $('#popBar').style.width = `${pct}%`;
}
tines.forEach((t, i) => {
  t.el.addEventListener('pointerdown', e => {
    if (locked()) return;
    e.preventDefault();
    t.el.setPointerCapture(e.pointerId);
    selectTine(i);
    st.drag = { kind: 'tine', i, y0: svgPt($('#kalimba'), e).y, pct: 0, moved: false };
    t.el.classList.add('dragging');
    kick();
  });
  t.el.addEventListener('pointermove', e => {
    const d = st.drag; if (!d || d.kind !== 'tine' || d.i !== i) return;
    const dy = Math.max(0, svgPt($('#kalimba'), e).y - d.y0);
    if (dy > 4) d.moved = true;
    d.pct = clamp(dy / 70 * 100, 0, 100);
    t.off = Math.min(26, dy * 0.38);
    if (d.moved) { showPop(d.pct); sound.tick(d.pct / 100); }
    kick();
  });
  const end = () => {
    const d = st.drag; if (!d || d.kind !== 'tine' || d.i !== i) return;
    st.drag = null; t.el.classList.remove('dragging'); pop.hidden = true; t.off = 0;
    pluck(i, d.moved ? Math.max(1, Math.round(d.pct)) : 50);
    if (!d.moved) toast('건반 끝을 아래로 끌었다 놓으면 세기를 정할 수 있어요 (끌수록 세게)', 2000);
  };
  t.el.addEventListener('pointerup', end);
  t.el.addEventListener('pointercancel', end);
  t.el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTine(i); pluck(i, 50); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const pos = ORDER.indexOf(i) + (e.key === 'ArrowLeft' ? -1 : 1);
      if (pos >= 0 && pos < 8) { tines[ORDER[pos]].el.focus(); selectTine(ORDER[pos]); }
    }
  });
});
$('#btnSoft').addEventListener('click', () => pluck(st.selTine, 30));
$('#btnHard').addEventListener('click', () => pluck(st.selTine, 90));

// ═════════ 리코더 ═════════
const HOLE_X = [0, 150, 180, 210, 252, 282, 312, 350];
(function buildRecorder() {
  const svg = $('#recorder');
  svg.innerHTML = `
  <defs>
    <linearGradient id="ivory" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset=".5" stop-color="#f1e6cf"/><stop offset="1" stop-color="#d9c8a6"/></linearGradient>
  </defs>
  <g transform="rotate(-6 220 70)">
    <g class="rwaves" id="rWaves" fill="none" stroke="#e0352b" stroke-width="2" stroke-linecap="round">
      <path d="M86 40q6-8 0-16"/><path d="M96 36q9-12 0-24"/><path d="M106 32q12-16 0-32"/>
    </g>
    <path d="M14 58 Q14 50 26 50 L118 50 L118 82 L26 82 Q14 82 14 74 Z" fill="url(#ivory)" stroke="#b5a27c" stroke-width="1.5"/>
    <path d="M14 58 L4 62 L4 70 L14 74 Z" fill="#e8dcc0" stroke="#b5a27c" stroke-width="1.2"/>
    <rect x="78" y="52" width="14" height="9" rx="2" fill="#5a4a33"/>
    <rect x="118" y="52" width="216" height="28" fill="url(#ivory)" stroke="#b5a27c" stroke-width="1.5"/>
    <rect x="114" y="49" width="10" height="34" rx="3" fill="#e4d6b8" stroke="#b5a27c"/>
    <path d="M334 52 L392 50 Q420 48 428 42 L428 90 Q420 84 392 82 L334 80 Z" fill="url(#ivory)" stroke="#b5a27c" stroke-width="1.5"/>
    <rect x="330" y="49" width="10" height="34" rx="3" fill="#e4d6b8" stroke="#b5a27c"/>
    <g id="holes"></g>
  </g>
  <circle id="thumb" cx="64" cy="128" r="8" stroke="#6b5d45" stroke-width="1.6" stroke-dasharray="3 2"/>
  <text x="78" y="133" font-size="13" fill="#5b6577">뒤 구멍(엄지)</text>
  <text x="232" y="133" font-size="13" fill="#5b6577">● 막는 구멍  ○ 여는 구멍</text>`;
  const g = svg.querySelector('#holes');
  for (let k = 1; k <= 7; k++) {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', HOLE_X[k]); c.setAttribute('cy', 66); c.setAttribute('r', k >= 6 ? 6.5 : 7.5);
    c.setAttribute('stroke', '#6b5d45'); c.setAttribute('stroke-width', '1.6'); c.dataset.h = k;
    g.appendChild(c);
  }
})();
function drawFingering() {
  const closed = new Set(FINGERING[st.recNote]);
  $$('#holes circle').forEach(c => c.setAttribute('fill', closed.has(+c.dataset.h) ? '#1d2433' : '#ffffff'));
  $('#thumb').setAttribute('fill', closed.has(0) ? '#1d2433' : '#ffffff');
}
const chipBox = $('#noteChips');
NOTES.forEach((n, i) => {
  const b = document.createElement('button');
  b.textContent = n.name; b.dataset.n = i; b.setAttribute('aria-pressed', String(i === st.recNote));
  b.addEventListener('click', () => {
    if (locked()) return;
    st.recNote = i;
    $$('#noteChips button').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.n === i)));
    drawFingering(); sfx.soft();
    if (st.blowing) startBlow(true);
    pushState();
  });
  chipBox.appendChild(b);
});
drawFingering();

const blowStr = $('#blowStr');
function setBlowPct(v) {
  st.blowPct = v; blowStr.value = v; paintRange(blowStr);
  $('#blowOut').textContent = `${v} %`;
  if (st.blowing && cur && cur.inst === 'recorder') { cur.A = recA(v); cur.pct = v; setRecorderAmp(cur.A); rec.strengthPct = v; }
}
blowStr.addEventListener('input', () => { if (locked()) return; setBlowPct(+blowStr.value); sound.tick(+blowStr.value / 100); pushState(); kick(); });
setBlowPct(50);

const blowBtn = $('#btnBlow');
let blowStart = 0;
function startBlow(changeNote = false) {
  if (locked()) return;
  const t = nowS(), ni = st.recNote;
  retire(t);
  const sig = { id: ++sigId, inst: 'recorder', note: NOTES[ni].name, ni, f: NOTES[ni].f, pct: st.blowPct, A: recA(st.blowPct), t0: t, tOff: null };
  cur = sig; hist.push(sig);
  startRecorder(sig.f, sig.A);
  st.blowing = true; blowBtn.classList.add('on'); $('#rWaves').classList.add('on');
  if (!changeNote) { rec.blows++; blowStart = t; }
  noteRecord(sig);
  kick(); pushState();
}
function endBlow() {
  if (!st.blowing) return;
  st.blowing = false; blowBtn.classList.remove('on'); $('#rWaves').classList.remove('on');
  if (!cur || cur.inst !== 'recorder') return;
  const t = nowS(), tOff = Math.max(t, blowStart + 0.3);   // 짧게 눌러도 0.3초는 소리
  cur.tOff = tOff;
  releaseRecorder(tOff - t);
  kick(); pushState();
}
blowBtn.addEventListener('pointerdown', e => { e.preventDefault(); blowBtn.setPointerCapture(e.pointerId); startBlow(); });
blowBtn.addEventListener('pointerup', endBlow);
blowBtn.addEventListener('pointercancel', endBlow);
blowBtn.addEventListener('lostpointercapture', endBlow);
blowBtn.addEventListener('click', e => {
  // 키보드가 아닌 프로그램 클릭(보조 기술 등)도 짧게 한 번 불기
  if (e.detail === 0 && !st.blowing) { startBlow(); endBlow(); }
});
blowBtn.addEventListener('keydown', e => {
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startBlow(); }
  else if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
});
blowBtn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endBlow(); } });

// ═════════ 소리 내기 ═════════
function retire(t) {
  if (cur && cur.replacedAt == null) {
    cur.replacedAt = t;
    if (cur.inst === 'recorder' && cur.tOff == null) cur.tOff = t;
  }
  stopVoice();
  while (hist.length > 12) hist.shift();
}
function noteRecord(sig) {
  rec.note = sig.note; rec.noteHz = Math.round(sig.f * 10) / 10; rec.strengthPct = Math.round(sig.pct);
  if (st.step === '1') rec.played1 = true;
  if (st.vacuum || st.density < 0.5) rec.vacuumTried = true;
  renderGuide(); renderAnalysis();
}
function pluck(i, pct) {
  if (locked()) return;
  if (st.inst !== 'kalimba') return;
  const t = nowS();
  retire(t);
  const sig = { id: ++sigId, inst: 'kalimba', note: NOTES[i].name, ni: i, f: NOTES[i].f, pct, A0: kalA0(pct), t0: t };
  cur = sig; hist.push(sig);
  playKalimba(sig.f, sig.A0);
  rec.plucks++;
  noteRecord(sig);
  kick(); pushState();
}

// 악기 고르기
function setInst(inst, quiet = false) {
  if (st.inst === inst) return;
  endBlow(); retire(nowS());
  st.inst = inst;
  $$('#instSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.inst === inst)));
  $('#kalBox').hidden = inst !== 'kalimba';
  $('#recBox').hidden = inst !== 'recorder';
  if (!quiet) sfx.soft();
  kick(); pushState();
}
$$('#instSeg button').forEach(b => b.addEventListener('click', () => { if (!locked()) setInst(b.dataset.inst); }));

// ═════════ 소리 분석 화면 ═════════
const scopeC = $('#scope'), wrap = $('#scopeWrap');
const M = { l: 40, r: 14, t: 12, b: 26 };
let geo = null;
const tToX = t => geo.x0 + t / st.range * geo.pw;
const aToY = a => geo.yc - a * geo.cy;
const WAVE = '#e0352b', COL_A = '#1a9a5c', COL_B = '#8a4fd6';

function plotWave(g, inst, f, A, color, width, dash) {
  if (A <= 0) return;
  const n = Math.max(200, Math.round(geo.pw * 1.5));
  g.save();
  g.beginPath(); g.rect(geo.x0, geo.y0 - 1, geo.pw, geo.ph + 2); g.clip();
  g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round';
  if (dash) g.setLineDash(dash);
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const tau = i / n * st.range, y = aToY(A * shape(inst, f, tau));
    const x = geo.x0 + i / n * geo.pw;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke(); g.restore();
}
function drawGrid(g, x0, y0, pw, ph, labels) {
  const cx = pw / 20, cy = ph / 10;
  g.fillStyle = '#ffffff'; g.fillRect(x0, y0, pw, ph);
  g.lineWidth = 1;
  for (let i = 0; i <= 20; i++) {
    g.strokeStyle = i % 5 === 0 ? '#cfd6e2' : '#e7ebf2';
    const x = Math.round(x0 + i * cx) + 0.5; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + ph); g.stroke();
  }
  for (let j = 0; j <= 10; j++) {
    g.strokeStyle = j % 5 === 0 ? '#cfd6e2' : '#e7ebf2';
    const y = Math.round(y0 + j * cy) + 0.5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + pw, y); g.stroke();
  }
  // 시간축(가운데)과 세로축
  g.strokeStyle = '#4a5160'; g.lineWidth = labels ? 1.6 : 1.2;
  g.beginPath(); g.moveTo(x0, y0 + ph / 2); g.lineTo(x0 + pw, y0 + ph / 2); g.stroke();
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y0 + ph); g.stroke();
}

function drawScope() {
  const F = fit(scopeC); if (!F) return;
  const { g, w, h } = F;
  geo = { x0: M.l, y0: M.t, pw: w - M.l - M.r, ph: h - M.t - M.b };
  geo.cx = geo.pw / 20; geo.cy = geo.ph / 10; geo.yc = geo.y0 + geo.ph / 2;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#f7f8fb'; g.fillRect(0, 0, w, h);
  drawGrid(g, geo.x0, geo.y0, geo.pw, geo.ph, true);
  // 눈금 글자
  g.fillStyle = '#5b6577'; g.font = '12px ' + getComputedStyle(document.body).fontFamily;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let a = -5; a <= 5; a++) if (a !== 0) g.fillText(String(a), geo.x0 - 6, aToY(a));
  g.font = 'bold 13px ' + getComputedStyle(document.body).fontFamily;
  g.fillText('O', geo.x0 - 6, geo.yc + 1);
  g.font = '12px ' + getComputedStyle(document.body).fontFamily;
  g.textAlign = 'center'; g.textBaseline = 'top';
  const every = geo.pw < 420 ? 4 : 2;
  for (let i = every; i < 20; i += every) {
    const t = i * st.range / 20;
    g.fillText(st.range === 5 ? t.toFixed(1) : String(t), geo.x0 + i * geo.cx, geo.y0 + geo.ph + 5);
  }
  g.textAlign = 'right';
  g.fillText('시간(ms)', geo.x0 + geo.pw, geo.y0 + geo.ph + 5);
  g.textAlign = 'left'; g.fillText('0', geo.x0 - 3, geo.y0 + geo.ph + 5);
  g.textBaseline = 'top'; g.fillStyle = '#5b6577';
  g.fillText('진폭(칸)', geo.x0 + 5, geo.y0 + 3);
  g.textAlign = 'right';
  g.fillText(`한 칸 = ${st.range / 20} ms`, geo.x0 + geo.pw - 5, geo.y0 + 3);

  // 겹쳐 보기 (저장 파형)
  const S = steps[st.step];
  if (st.overlay && S) {
    if (S.A) plotWave(g, S.A.inst, S.A.f, S.A.amp, COL_A, 2.2, [7, 5]);
    if (S.B) plotWave(g, S.B.inst, S.B.f, S.B.amp, COL_B, 2.2, [3, 4]);
  }
  // 지금 파형
  const d = dispNow(), A = dispAmp(d);
  if (A > 0) plotWave(g, d.sig.inst, d.sig.f, A, WAVE, 2.6);
  else {
    g.strokeStyle = WAVE; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(geo.x0, geo.yc); g.lineTo(geo.x0 + geo.pw, geo.yc); g.stroke();
  }

  // 진폭 커서 (파란 가로선)
  const ya = aToY(st.amp);
  g.strokeStyle = '#2f80ed'; g.lineWidth = 2; g.setLineDash([]);
  g.beginPath(); g.moveTo(geo.x0, ya); g.lineTo(geo.x0 + geo.pw, ya); g.stroke();
  g.fillStyle = '#2f80ed';
  g.beginPath(); g.moveTo(geo.x0 + geo.pw, ya); g.lineTo(geo.x0 + geo.pw + 10, ya - 6); g.lineTo(geo.x0 + geo.pw + 10, ya + 6); g.fill();
  // 주기 커서 (노란 세로선 두 개)
  const xl = tToX(st.tL), xr = tToX(st.tR);
  for (const x of [xl, xr]) {
    g.strokeStyle = '#8a6a00'; g.lineWidth = 4; g.globalAlpha = 0.35;
    g.beginPath(); g.moveTo(x, geo.y0); g.lineTo(x, geo.y0 + geo.ph); g.stroke();
    g.globalAlpha = 1; g.strokeStyle = '#f2b705'; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(x, geo.y0); g.lineTo(x, geo.y0 + geo.ph); g.stroke();
    g.fillStyle = '#f2b705';
    g.beginPath(); g.moveTo(x - 7, geo.y0 + geo.ph); g.lineTo(x + 7, geo.y0 + geo.ph); g.lineTo(x, geo.y0 + geo.ph - 10); g.fill();
  }
  // Δt 화살표·글자
  const dt = Math.abs(st.tR - st.tL), ay = geo.y0 + 46;
  const lo = Math.min(xl, xr), hi = Math.max(xl, xr);
  g.strokeStyle = '#8a6a00'; g.fillStyle = '#8a6a00'; g.lineWidth = 1.6;
  if (hi - lo > 16) {
    g.beginPath(); g.moveTo(lo + 2, ay); g.lineTo(hi - 2, ay); g.stroke();
    for (const [x, s] of [[lo + 2, 1], [hi - 2, -1]]) { g.beginPath(); g.moveTo(x, ay); g.lineTo(x + 7 * s, ay - 4); g.lineTo(x + 7 * s, ay + 4); g.fill(); }
  }
  const txt = `Δt = ${f2(r2(dt))} ms`;
  g.font = 'bold 13px ' + getComputedStyle(document.body).fontFamily;
  const tw = g.measureText(txt).width + 12;
  let tx = clamp((lo + hi) / 2 - tw / 2, geo.x0 + 2, geo.x0 + geo.pw - tw - 2);
  g.fillStyle = 'rgba(255,250,225,.95)'; g.strokeStyle = '#e2c45a'; g.lineWidth = 1;
  roundRect(g, tx, ay - 25, tw, 20, 5); g.fill(); g.stroke();
  g.fillStyle = '#6b5200'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(txt, tx + 6, ay - 15);
  // 진폭 커서 글자
  const at = `${st.amp.toFixed(1)}칸`;
  const aw = g.measureText(at).width + 12;
  const ax = geo.x0 + geo.pw - aw - 14, aty = clamp(ya - 24, geo.y0 + 44, geo.y0 + geo.ph - 22);
  g.fillStyle = 'rgba(234,242,255,.95)'; g.strokeStyle = '#9cc0f5';
  roundRect(g, ax, aty, aw, 20, 5); g.fill(); g.stroke();
  g.fillStyle = '#1f5fbf'; g.fillText(at, ax + 6, aty + 10);

  // 상태 글
  g.font = '13px ' + getComputedStyle(document.body).fontFamily;
  const notes = [];
  if (st.frozen) notes.push(['멈춤', '#1f6feb']);
  if (st.density < 0.05 && cur && ampAt(cur, nowS()) > 0) notes.push(['진공: 마이크에 소리가 오지 않아요', '#2b3348']);
  else if (!(A > 0) && !st.frozen) notes.push([st.inst === 'kalimba' ? '칼림바 건반을 튕겨 보세요' : '[불기]를 누르고 있어 보세요', '#7a8293']);
  if (sound.muted) notes.push(['음소거 중 — 파형은 그대로 볼 수 있어요', '#e5533d']);
  let ny = geo.y0 + geo.ph - 26, nx = geo.x0 + 8;
  for (const [s, c] of notes) {
    const ww = g.measureText(s).width + 14;
    g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = c; g.lineWidth = 1.2;
    roundRect(g, nx, ny, ww, 20, 10); g.fill(); g.stroke();
    g.fillStyle = c; g.textAlign = 'left'; g.fillText(s, nx + 7, ny + 10);
    nx += ww + 6;
  }

  // 커서 DOM(끌기·키보드용 투명 손잡이) 위치
  placeCursor($('#curL'), st.tL); placeCursor($('#curR'), st.tR);
  const ca = $('#curA');
  ca.style.left = geo.x0 + 'px'; ca.style.width = geo.pw + 'px'; ca.style.top = ya + 'px';
  ca.setAttribute('aria-valuenow', st.amp.toFixed(1)); ca.setAttribute('aria-valuetext', `${st.amp.toFixed(1)}칸`);
}
function placeCursor(el, t) {
  el.style.left = tToX(t) + 'px'; el.style.top = geo.y0 + 'px'; el.style.height = geo.ph + 'px';
  el.setAttribute('aria-valuemax', String(st.range)); el.setAttribute('aria-valuenow', f2(t)); el.setAttribute('aria-valuetext', `${f2(t)} ms`);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// 커서 끌기
function cursorFromEvent(kind, e) {
  const r = scopeC.getBoundingClientRect();
  if (kind === 'amp') {
    const a = (geo.yc - (e.clientY - r.top)) / geo.cy;
    st.amp = clamp(Math.round(a * 10) / 10, 0, 5);
  } else {
    const t = (e.clientX - r.left - geo.x0) / geo.pw * st.range;
    st[kind] = clamp(Math.round(t * 100) / 100, 0, st.range);
  }
}
function snapCursor(kind) {
  const d = dispNow(), A = dispAmp(d);
  if (!(A > 0)) return;
  if (kind === 'amp') {
    if (Math.abs(st.amp - A) <= 0.1 + 1e-9) st.amp = A;
    return;
  }
  const xs = upCrossings(d.sig.inst, d.sig.f, st.range);
  let best = null, bd = 6;
  for (const t of xs) { const dx = Math.abs(tToX(t) - tToX(st[kind])); if (dx <= bd) { bd = dx; best = t; } }
  if (best != null) st[kind] = best;
}
function checkMeasured() {
  const d = dispNow();
  if (!(dispAmp(d) > 0)) return;
  const T = 1000 / d.sig.f, dt = Math.abs(st.tR - st.tL);
  if (Math.abs(dt - T) / T <= 0.05) rec.measured[d.sig.note] = r2(dt);
}
[['#curL', 'tL'], ['#curR', 'tR'], ['#curA', 'amp']].forEach(([sel, kind]) => {
  const el = $(sel);
  el.addEventListener('pointerdown', e => {
    if (locked()) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
    st.drag = { kind: 'cursor', which: kind };
    cursorFromEvent(kind, e); kick();
  });
  el.addEventListener('pointermove', e => {
    if (!st.drag || st.drag.which !== kind) return;
    cursorFromEvent(kind, e); updateReadouts(); kick();
  });
  const up = () => {
    if (!st.drag || st.drag.which !== kind) return;
    st.drag = null;
    snapCursor(kind); if (kind !== 'amp') checkMeasured();
    sfx.tick(); updateReadouts(); drawScope(); pushState();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('keydown', e => {
    if (locked()) return;
    let dv = 0;
    if (kind === 'amp') { if (e.key === 'ArrowUp') dv = 0.1; else if (e.key === 'ArrowDown') dv = -0.1; }
    else {
      const stp = e.shiftKey ? 0.01 : st.range / 200;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dv = stp; else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dv = -stp;
    }
    if (!dv) return;
    e.preventDefault();
    if (kind === 'amp') st.amp = clamp(Math.round((st.amp + dv) * 10) / 10, 0, 5);
    else { st[kind] = clamp(Math.round((st[kind] + dv) * 100) / 100, 0, st.range); checkMeasured(); }
    sound.tick(kind === 'amp' ? st.amp / 5 : st[kind] / st.range);
    updateReadouts(); drawScope(); pushState();
  });
});

function updateReadouts() {
  $('#rAmp').textContent = `${st.amp.toFixed(1)}칸`;
  const dt = r2(Math.abs(st.tR - st.tL));
  $('#rDt').textContent = `${f2(dt)} ms`;
  $('#rFreq').textContent = dt >= 0.05 ? `${Math.round(1000 / dt)} Hz` : '— Hz';
}
let lastAna = '';
function renderAnalysis() {
  const cell = $('#anaCell'), v = $('#rAna');
  cell.classList.toggle('on', st.analysis);
  let s;
  if (!st.analysis) s = '분석값 보기를 켜면 나와요';
  else {
    const d = dispNow(), A = dispAmp(d);
    if (!(A > 0)) s = '소리 없음';
    else s = `${Math.round(d.sig.f)} Hz · '${d.sig.note}' · 주기 ${f2(periodMs(d.sig.ni))} ms · 진폭 ${A.toFixed(1)}칸`;
  }
  if (s !== lastAna) { v.textContent = s; lastAna = s; }
}

// 화면 멈춤 / 다시 보기
function setFrozen(on) {
  if (locked()) return;
  if (on) {
    const t = nowS();
    st.frozen = { sig: cur ? { ...cur } : null, t, dens: st.density };
  } else st.frozen = null;
  const b = $('#btnFreeze');
  b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '다시 보기' : '화면 멈춤';
  const p = $('#btnPlay');
  p.setAttribute('aria-pressed', String(on)); p.querySelector('span').textContent = on ? '재생' : '일시정지';
  sfx.click();
  drawAll(); kick(); pushState();
}
$('#btnFreeze').addEventListener('click', () => setFrozen(!st.frozen));
$('#btnPlay').addEventListener('click', () => setFrozen(!st.frozen));

// 시간 범위
function setRange(r, quiet = false) {
  st.range = r;
  st.tL = Math.min(st.tL, r); st.tR = Math.min(st.tR, r);
  $$('#rangeSeg button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.range === r)));
  if (!quiet) sfx.soft();
  updateReadouts(); drawAll(); pushState();
}
$$('#rangeSeg button').forEach(b => b.addEventListener('click', () => { if (!locked()) setRange(+b.dataset.range); }));

// 겹쳐 보기·분석값
$('#btnOverlay').addEventListener('click', () => {
  if (locked()) return;
  st.overlay = !st.overlay;
  $('#btnOverlay').setAttribute('aria-pressed', String(st.overlay));
  if (st.overlay) {
    rec.overlayViewed.add(st.step);
    const S = steps[st.step];
    if (S && !S.A && !S.B) toast('A·B에 저장한 파형이 있으면 점선으로 겹쳐 보여요');
  }
  sfx.soft(); renderGuide(); drawScope(); pushState();
});
$('#btnAnalysis').addEventListener('click', () => {
  if (locked()) return;
  st.analysis = !st.analysis;
  if (st.analysis) rec.analysisShown = true;
  $('#btnAnalysis').setAttribute('aria-pressed', String(st.analysis));
  sfx.soft(); renderAnalysis(); pushState();
});

// ═════════ A·B 저장 ═════════
function save(slot) {
  if (locked()) return;
  const S = steps[st.step]; if (!S) return;
  const d = dispNow(), A = dispAmp(d);
  if (!(A > 0.05)) {
    sfx.bad();
    toast(st.density < 0.05 ? '진공에서는 분석 화면에 파형이 없어요. 공기를 다시 넣어 보세요' : '먼저 악기를 연주한 뒤 저장해요 (화면 멈춤을 누르고 저장하면 편해요)');
    return;
  }
  S[slot] = { inst: d.sig.inst, note: d.sig.note, ni: d.sig.ni, f: d.sig.f, amp: r2(A), pct: Math.round(d.sig.pct) };
  sfx.shutter();
  drawMinis(); checkStep(st.step); renderGuide(); drawScope(); pushState();
}
$('#btnSaveA').addEventListener('click', () => save('A'));
$('#btnSaveB').addEventListener('click', () => save('B'));

function condOf(step, A, B) {
  if (!A || !B) return null;
  if (step === '2') {
    if (A.inst !== B.inst || A.ni !== B.ni) return '② 단계는 같은 악기, 같은 음(같은 건반)으로 저장해요';
    if (Math.max(A.amp, B.amp) / Math.min(A.amp, B.amp) < 1.5) return '약하게와 세게의 차이를 더 크게 해 보세요';
    return true;
  }
  if (step === '3') {
    if (A.inst !== B.inst) return '③ 단계는 같은 악기로 저장해요';
    if (A.ni === B.ni) return '③ 단계는 서로 다른 음(예: 도와 솔)으로 저장해요';
    if (Math.abs(A.amp - B.amp) > 0.3) return '두 소리의 세기를 비슷하게 맞춰요 (진폭 차 0.3칸 이내)';
    return true;
  }
  if (step === '4') {
    if (A.inst === B.inst) return '④ 단계는 칼림바와 리코더, 서로 다른 악기로 저장해요';
    if (A.ni !== B.ni) return '④ 단계는 두 악기로 같은 음을 내요';
    if (Math.abs(A.amp - B.amp) > 0.3) return '진폭 커서로 두 소리의 진폭을 비슷하게 맞춰요 (차 0.3칸 이내)';
    return true;
  }
  return null;
}
function checkStep(step) {
  const S = steps[step]; if (!S) return;
  const c = condOf(step, S.A, S.B);
  const was = S.done;
  S.done = c === true;
  if (S.done && !was) {
    setTimeout(() => sfx.done(), 120);
    const next = { 2: '3', 3: '4', 4: 'summary' }[step];
    const nb = $(`#stepTabs [data-step="${next}"]`);
    if (nb) { nb.classList.remove('flash'); void nb.offsetWidth; nb.classList.add('flash'); }
    toast('이 단계를 마쳤어요! 겹쳐 보기로 비교하고 다음 단계로 가 보세요', 2600);
  } else if (typeof c === 'string') toast(c, 2600);
  renderTabs();
}

// ── 작은 격자 화면(A·B 칸, 정리 탭) ──
const SNAP_KO = s => `${INST[s.inst].ko} · ${s.note} · ${strengthWord(s.pct)}`;
function drawMini(c, s, color) {
  const F = fit(c); if (!F) return;
  const { g, w, h } = F;
  g.clearRect(0, 0, w, h);
  drawGrid(g, 0, 0, w, h, false);
  if (!s) {
    g.fillStyle = '#7a8293'; g.font = '12px ' + getComputedStyle(document.body).fontFamily;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('저장하면 여기에 그려져요', w / 2, h / 2 - 10);
    return;
  }
  g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
  g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round';
  g.beginPath();
  const n = Math.max(160, Math.round(w * 1.5)), cy = h / 10;
  for (let i = 0; i <= n; i++) {
    const tau = i / n * st.range, y = h / 2 - s.amp * shape(s.inst, s.f, tau) * cy;
    if (i) g.lineTo(i / n * w, y); else g.moveTo(0, y);
  }
  g.stroke(); g.restore();
}
function drawMinis() {
  const S = steps[st.step] || {};
  drawMini($('#miniA'), S.A, COL_A); drawMini($('#miniB'), S.B, COL_B);
  $('#tagA').textContent = S.A ? SNAP_KO(S.A) : '비어 있음';
  $('#tagB').textContent = S.B ? SNAP_KO(S.B) : '비어 있음';
}

// ═════════ 정리 탭 ═════════
const CHIPS = ['세기', '높낮이', '음색'];
const SBOX = [
  { step: '2', cls: 'c2', from: '② 같은 건반을 약하게·세게 튕긴 소리' },
  { step: '3', cls: 'c3', from: '③ 같은 악기로 낸 서로 다른 두 음' },
  { step: '4', cls: 'c4', from: '④ 칼림바와 리코더로 낸 같은 음' },
];
(function buildSummary() {
  const box = $('#sboxes');
  SBOX.forEach((b, k) => {
    const el = document.createElement('div');
    el.className = `panel sbox ${b.cls}`;
    el.innerHTML = `<div class="stitle">소리의 ( <span class="slot" id="slot${k}">&nbsp;</span> )</div>
      <div class="chips" role="group" aria-label="상자 ${k + 1} 제목 고르기">${CHIPS.map(c => `<button data-k="${k}" data-c="${c}" aria-pressed="false">${c}</button>`).join('')}</div>
      <p class="from">${b.from}</p>
      <div class="sw"><span class="lab"><b class="a">A</b><span id="sTagA${k}">비어 있음</span></span><canvas id="sA${k}" role="img" aria-label="저장한 파형 A"></canvas></div>
      <div class="sw"><span class="lab"><b class="b">B</b><span id="sTagB${k}">비어 있음</span></span><canvas id="sB${k}" role="img" aria-label="저장한 파형 B"></canvas></div>`;
    box.appendChild(el);
  });
  $$('.chips button').forEach(b => b.addEventListener('click', () => {
    if (locked()) return;
    const k = +b.dataset.k, c = b.dataset.c;
    rec.labels[k] = rec.labels[k] === c ? '' : c;
    sfx.soft(); renderSummary(); pushState();
  }));
})();
function renderSummary() {
  SBOX.forEach((b, k) => {
    const S = steps[b.step];
    drawMini($(`#sA${k}`), S.A, COL_A); drawMini($(`#sB${k}`), S.B, COL_B);
    $(`#sTagA${k}`).textContent = S.A ? SNAP_KO(S.A) : `비어 있음 (${b.step === '2' ? '②' : b.step === '3' ? '③' : '④'} 단계에서 저장)`;
    $(`#sTagB${k}`).textContent = S.B ? SNAP_KO(S.B) : '비어 있음';
    $(`#slot${k}`).innerHTML = rec.labels[k] || '&nbsp;';
  });
  $$('.chips button').forEach(b => b.setAttribute('aria-pressed', String(rec.labels[+b.dataset.k] === b.dataset.c)));
  $('#triad').hidden = !rec.labels.every(Boolean);
}
// 모두 지우기 (확인창 한 번)
$('#btnClearAll').addEventListener('click', () => { if (locked()) return; $('#confirm').hidden = false; sfx.soft(); $('#btnNo').focus(); });
$('#btnNo').addEventListener('click', () => { $('#confirm').hidden = true; sfx.soft(); });
$('#btnYes').addEventListener('click', () => {
  $('#confirm').hidden = true;
  for (const k of Object.keys(steps)) steps[k] = { A: null, B: null, done: false };
  rec.labels = ['', '', '']; rec.overlayViewed.clear(); rec.played1 = false;
  sfx.reset(); renderTabs(); renderGuide(); renderSummary(); drawMinis(); pushState();
});
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#confirm').hidden) $('#confirm').hidden = true; });

// ═════════ 단계 ═════════
const GUIDE = {
  1: '칼림바 건반 끝을 아래로 끌었다 놓아 튕겨 보세요. 아래 <b>소리의 전달</b> 띠에서 빨간 알갱이가 어떻게 움직이는지 보고, <b>[공기 빼기]</b>를 켠 뒤 다시 연주해 보세요.',
  2: '칼림바의 <b>같은 건반</b>을 약하게 튕겨 <b>[A에 저장]</b>, 세게 튕겨 <b>[B에 저장]</b>한 뒤 <b>[겹쳐 보기]</b>로 비교해요. (화면 멈춤 뒤 저장하면 편해요)',
  3: '칼림바의 <b>도</b>와 <b>솔</b>(또는 높은 도)을 비슷한 세기로 튕겨 A·B에 저장해요. 화면 멈춤 뒤 <b>노란 주기 커서</b> 두 개를 끌어 한 번 진동하는 시간(주기)을 재 보세요.',
  4: '칼림바와 리코더로 <b>같은 음</b>(예: 솔)을 내요. <b>파란 진폭 커서</b>로 두 소리의 진폭을 맞춰 A·B에 저장하고 겹쳐 보세요.',
  summary: '각 상자에서 비교한 것이 소리의 무엇인지 골라 <b>소리의 (  )</b> 칸을 채워 보세요. 저장한 파형을 다시 볼 수 있어요.',
};
const NUM = { 1: '①', 2: '②', 3: '③', 4: '④', summary: '✓' };
function renderGuide() {
  $('#guideNum').textContent = NUM[st.step];
  $('#guideText').innerHTML = GUIDE[st.step];
  const S = steps[st.step], c = [];
  if (st.step === '1') {
    c.push(['연주해 보기', rec.played1 || rec.plucks + rec.blows > 0]);
    c.push(['진공에서 연주해 보기', rec.vacuumTried]);
  } else if (S) {
    c.push(['A 저장', !!S.A], ['B 저장', !!S.B]);
    c.push([{ 2: '같은 음 · 세기 차이', 3: '같은 악기 · 다른 음 · 비슷한 세기', 4: '다른 악기 · 같은 음 · 같은 진폭' }[st.step], S.done]);
    c.push(['겹쳐 보기', rec.overlayViewed.has(st.step)]);
  } else {
    c.push(...CHIPS.map((_, k) => [`상자 ${k + 1}`, !!rec.labels[k]]));
  }
  $('#guideChecks').innerHTML = c.map(([t, ok]) => `<li class="${ok ? 'ok' : ''}">${t}</li>`).join('');
}
function renderTabs() {
  $$('#stepTabs button').forEach(b => {
    const s = b.dataset.step;
    b.setAttribute('aria-selected', String(s === st.step));
    b.classList.toggle('done', !!(steps[s] && steps[s].done && s !== '1'));
  });
}
function setStep(s) {
  if (st.step === s) {   // 지금 단계를 다시 누르면 안내를 한 번 더 강조
    const gp = $('#guideText'); gp.classList.remove('pulse'); void gp.offsetWidth; gp.classList.add('pulse');
    sfx.soft(); return;
  }
  st.step = s;
  const sum = s === 'summary';
  $('#layout').classList.toggle('sum', sum);
  $('#summary').hidden = !sum;
  sfx.whoosh(); sfx.soft();
  renderTabs(); renderGuide();
  requestAnimationFrame(() => { drawAll(); if (sum) renderSummary(); });
  pushState();
}
$$('#stepTabs button').forEach(b => b.addEventListener('click', () => { if (!locked()) setStep(b.dataset.step); }));

// ═════════ 소리의 전달 띠 ═════════
const airC = $('#airCanvas');
let parts = [];
function makeParticles() {
  const n = st.quality === 'high' ? 300 : 150;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rows = 8, cols = Math.round(n / rows);
  parts = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    parts.push({ u: (c + 0.2 + rnd() * 0.6) / cols, v: (r + 0.15 + rnd() * 0.7) / rows, th: rnd(), red: false });
  }
  // 가운데 알갱이 하나를 빨간색으로
  let best = 0, bd = 9;
  parts.forEach((p, i) => { const d = Math.hypot(p.u - 0.42, (p.v - 0.5) * 0.3); if (d < bd) { bd = d; best = i; } });
  parts[best].red = true; parts[best].th = 0;
}
makeParticles();
const V_PX = 170;                                     // 띠에서 진동이 나아가는 빠르기(모형, px/초)
const lamPx = f => 84 * NOTES[0].f / f;               // 띠 위 파장(모형, 진동수에 반비례)
function sigAt(t) {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t0 <= t) return hist[i];
  return null;
}
function drawAir() {
  const F = fit(airC); if (!F) return;
  const { g, w, h } = F;
  const t = st.frozen ? st.frozen.t : nowS();
  const dens = st.frozen ? st.frozen.dens : st.density;
  const xs = 66, xe = w - 74, bw = xe - xs;
  g.clearRect(0, 0, w, h);
  // 공기 바탕
  const bg = g.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, `rgba(214,233,252,${0.25 + 0.75 * dens})`); bg.addColorStop(1, `rgba(232,242,252,${0.25 + 0.75 * dens})`);
  g.fillStyle = '#eef0f4'; g.fillRect(0, 0, w, h);
  g.fillStyle = bg; g.fillRect(xs - 6, 0, bw + 12, h);
  // 악기(왼쪽)
  const s0 = sigAt(t), a0 = s0 ? ampAt(s0, t) : 0;
  const jig = a0 > 0 ? Math.sin(t * 2 * Math.PI * 9) * Math.min(2.5, a0 * 0.7) : 0;
  g.save(); g.translate(30 + jig, h / 2 - 6);
  if (st.inst === 'kalimba') {
    g.fillStyle = '#c4864a'; roundRect(g, -20, -20, 40, 40, 7); g.fill();
    g.fillStyle = '#5e3d20'; g.fillRect(-18, -16, 36, 5);
    g.fillStyle = '#dfe4ea'; for (let k = -3; k <= 3; k++) g.fillRect(k * 5 - 1.2, -14, 2.4, 22 - Math.abs(k) * 2);
  } else {
    g.rotate(-0.5); g.fillStyle = '#f1e6cf'; g.strokeStyle = '#b5a27c'; roundRect(g, -24, -5, 48, 10, 4); g.fill(); g.stroke();
    g.fillStyle = '#1d2433'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(-6 + k * 7, 0, 1.8, 0, 7); g.fill(); }
  }
  g.restore();
  g.fillStyle = '#5b6577'; g.font = '12px ' + getComputedStyle(document.body).fontFamily; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText(INST[st.inst].ko, 30, h - 4);
  // 스마트 기기(오른쪽)
  const px = w - 40;
  g.fillStyle = '#2b3348'; roundRect(g, px - 17, h / 2 - 30, 34, 52, 6); g.fill();
  g.fillStyle = '#ffffff'; g.fillRect(px - 13, h / 2 - 24, 26, 38);
  g.strokeStyle = '#e0352b'; g.lineWidth = 1.4; g.beginPath();
  const dA = dispAmp(st.frozen || { sig: cur, t, dens });
  for (let k = 0; k <= 24; k++) { const yy = h / 2 - 5 - Math.sin(k / 24 * Math.PI * 4) * Math.min(14, dA * 4); if (k) g.lineTo(px - 12 + k, yy); else g.moveTo(px - 12, yy); }
  g.stroke();
  g.fillStyle = '#5b6577'; g.fillText('스마트 기기', px, h - 4);
  // 알갱이
  const ph = h - 22, py = 4;
  const r = st.quality === 'high' ? 2.4 : 2.8;
  let red = null;
  g.fillStyle = '#5d8fc9';
  for (const p of parts) {
    if (p.th >= dens) continue;
    const d = p.u * bw, tr = t - d / V_PX, s = sigAt(tr);
    let dx = 0;
    if (s) {
      const a = ampAt(s, tr) * dens;
      if (a > 0) dx = (2.5 + 4.5 * Math.min(1, a / 4)) * Math.sin(2 * Math.PI * (V_PX / lamPx(s.f)) * (tr - s.t0));
    }
    const x = xs + d + dx, y = py + p.v * ph;
    if (p.red) { red = { x, y, x0: xs + d }; continue; }
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  if (red) {
    g.strokeStyle = 'rgba(224,53,43,.45)'; g.setLineDash([2, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(red.x0, py); g.lineTo(red.x0, py + ph); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#e0352b'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(red.x, red.y, 4.2, 0, 7); g.fill(); g.stroke();
  }
  // 진행 방향 화살표
  g.strokeStyle = '#e0352b'; g.fillStyle = '#e0352b'; g.lineWidth = 2;
  const ay = h - 9, ax0 = xs + bw * 0.62, ax1 = xe - 4;
  g.beginPath(); g.moveTo(ax0, ay); g.lineTo(ax1, ay); g.stroke();
  g.beginPath(); g.moveTo(ax1 + 4, ay); g.lineTo(ax1 - 5, ay - 5); g.lineTo(ax1 - 5, ay + 5); g.fill();
  g.fillStyle = '#b3261e'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.font = '12px ' + getComputedStyle(document.body).fontFamily;
  g.fillText('소리의 진행 방향', ax0 - 6, ay);
  if (dens < 0.05) {
    const msg = '진공: 소리를 전달할 매질이 없어요';
    g.font = 'bold 14px ' + getComputedStyle(document.body).fontFamily;
    const mw = g.measureText(msg).width + 20;
    g.fillStyle = 'rgba(43,51,72,.9)'; roundRect(g, xs + bw / 2 - mw / 2, h / 2 - 22, mw, 26, 13); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(msg, xs + bw / 2, h / 2 - 9);
  }
  return bw;
}

$('#btnVacuum').addEventListener('click', () => {
  if (locked()) return;
  st.vacuum = !st.vacuum;
  $('#btnVacuum').setAttribute('aria-pressed', String(st.vacuum));
  $('#btnVacuum').textContent = st.vacuum ? '공기 넣기' : '공기 빼기(진공)';
  st.vacuum ? sfx.airOut() : sfx.airIn();
  if (st.vacuum && cur && ampAt(cur, nowS()) > 0) rec.vacuumTried = true;
  renderGuide(); kick(); pushState();
});

// ═════════ 칼림바 건반 그림 갱신 ═════════
let hotTine = -1;
function drawTines(t) {
  const sounding = cur && cur.inst === 'kalimba' ? ampAt(cur, t) : 0;
  tines.forEach((tn, i) => {
    let off = tn.off;
    const hot = sounding > 0 && cur.ni === i;
    if (hot && !(st.drag && st.drag.i === i)) off = Math.sin((t - cur.t0) * 2 * Math.PI * 11) * Math.min(5, sounding * 1.4);
    tn.body.setAttribute('height', (tn.L + 16 + off).toFixed(1));
    tn.label.setAttribute('y', (TOP + tn.L + 17 + Math.max(0, off)).toFixed(1));
    if (hot !== (hotTine === i)) tn.body.setAttribute('fill', hot ? 'url(#metalHot)' : 'url(#metal)');
  });
  hotTine = sounding > 0 && cur ? cur.ni : -1;
}

// ═════════ 그리기 반복 ═════════
let raf = 0, soundUntil = 0, lastT = nowS();
function drawAll() {
  drawScope(); drawAir(); drawMinis(); renderAnalysis();
  if (st.step === 'summary') renderSummary();
}
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame() {
  raf = 0;
  const t = nowS(), dt = Math.min(0.1, t - lastT); lastT = t;
  const target = st.vacuum ? 0 : 1;
  let densMoving = false;
  if (st.density !== target) {
    st.density = target > st.density ? Math.min(1, st.density + dt / 1.5) : Math.max(0, st.density - dt / 1.5);
    setAir(st.density); densMoving = true;
  }
  const sounding = cur && ampAt(cur, t) > 0;
  if (sounding) soundUntil = t;
  const bw = st.step === 'summary' ? 0 : (airC.clientWidth || 400);
  const airMoving = t - soundUntil < bw / V_PX + 0.3;
  if (st.step !== 'summary') {
    if (!st.frozen || st.drag || densMoving) { drawScope(); drawAir(); }
    drawTines(t);
    renderAnalysis();
  }
  if (!st.frozen) {
    const a = r2(dispAmp(dispNow()));
    if (a !== lastAmpSent) pushState();
  }
  if (st.drag || densMoving || (!st.frozen && (sounding || airMoving)) || sounding) kick();
}

// ═════════ 위 띠 도구 ═════════
const muteBtn = $('#btnMute');
const syncMute = () => { muteBtn.setAttribute('aria-pressed', String(sound.muted)); muteBtn.querySelector('span').textContent = sound.muted ? '소리 꺼짐' : '소리'; };
syncMute();
muteBtn.addEventListener('click', () => {
  const m = sound.toggleMute();
  if (m) { stopVoice(); endBlow(); }
  syncMute(); if (!m) sfx.click();
  drawScope();
});
$('#btnQuality').addEventListener('click', () => {
  st.quality = st.quality === 'high' ? 'low' : 'high';
  $('#btnQuality span').textContent = st.quality === 'high' ? '품질 높음' : '품질 낮음';
  $('#btnQuality').setAttribute('aria-label', `그래픽 품질 ${st.quality === 'high' ? '높음' : '낮음'}, 눌러서 바꾸기`);
  makeParticles(); sfx.click(); drawAll();
});
$('#btnReset').addEventListener('click', () => {
  if (locked()) return;
  endBlow(); retire(nowS()); cur = null;
  if (st.frozen) setFrozen(false);
  setInst('kalimba', true); selectTine(0);
  st.recNote = 4; drawFingering();
  $$('#noteChips button').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.n === st.recNote)));
  setBlowPct(50);
  st.tL = DEF.tL; st.tR = DEF.tR; st.amp = DEF.amp;
  setRange(DEF.range, true);
  st.vacuum = false; st.density = 1; setAir(1);
  $('#btnVacuum').setAttribute('aria-pressed', 'false'); $('#btnVacuum').textContent = '공기 빼기(진공)';
  sfx.reset(); toast('처음 상태로 돌렸어요 (저장한 파형은 그대로예요)');
  updateReadouts(); drawAll(); kick(); pushState();
});

// 단축키: P = 화면 멈춤, 스페이스 = 리코더 불기
const typing = e => /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.getAttribute?.('role') === 'slider' || e.target.closest?.('.tine');
window.addEventListener('keydown', e => {
  if (locked()) return;
  if ((e.key === 'p' || e.key === 'P') && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); setFrozen(!st.frozen); }
  else if (e.key === ' ' && st.inst === 'recorder' && st.step !== 'summary' && !typing(e)) { e.preventDefault(); if (!e.repeat) startBlow(); }
});
window.addEventListener('keyup', e => { if (e.key === ' ' && st.blowing && !typing(e)) endBlow(); });
window.addEventListener('blur', endBlow);

// 잠금
SimBridge.onLock = () => { endBlow(); stopVoice(); retire(nowS()); st.drag = null; pop.hidden = true; kick(); };

// 크기 바뀔 때 다시 그리기
const ro = new ResizeObserver(() => drawAll());
[wrap, airC, $('#miniA'), $('#miniB'), $('#sboxes')].forEach(el => ro.observe(el));

renderTabs(); renderGuide(); updateReadouts(); drawAll();
