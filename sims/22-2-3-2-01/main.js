// 파동의 발생과 전달 — 단계 전환·조작 패널·SimBridge·잠금
import { sound } from '../../lib/sound.js';
import { paintRange, toast } from '../../lib/utils.js';
import { Pond } from './pond.js';
import { Spring, TENSION_NAME } from './spring.js';

SimBridge.init('22-2-3-2-01');

const $ = id => document.getElementById(id);
const root = document.documentElement;
const isLocked = () => root.classList.contains('sim-locked');
let stage = 'pond';
let quality = (navigator.hardwareConcurrency || 4) <= 2 ? 'low' : 'high';

// ───────── SimBridge: 0.15초 단위로 모아서 보냄 ─────────
let bridgeDirty = true;
const markDirty = () => { bridgeDirty = true; };
const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;
function collect() {
  const p = pond, s = spring;
  const dt = s.graphDt();
  return {
    stage,
    dropCount: p.rec.dropCount,
    duckSideShiftCm: r1(p.rec.duckSideShiftCm),
    duckHeightCm: r1(p.duckH) || 0,
    leafWaveArrived: p.rec.leafWaveArrived,
    trailViewed: p.rec.trailViewed,
    shakeMode: s.mode,
    amplitude: r2(s.A),
    period: r2(s.T),
    frequency: r2(1 / s.T),
    tension: s.tension,
    rulerDx: s.ruler.used ? r2(s.rulerDx()) : '',
    rulerDy: s.ruler.used ? r2(s.rulerDy()) : '',
    rulerSnap: s.ruler.used ? s.rulerSnap() : '',
    ribbonX: r2(s.ribbonX),
    ribbonY: r2(s.yAt(s.ribbonX)) || 0,
    graphDt: dt == null ? '' : r2(dt),
    missionWavelength: s.rec.missionWavelength,
    missionAmplitude: s.rec.missionAmplitude,
    missionPeriod: s.rec.missionPeriod,
    photoCount: s.rec.photoCount,
    paused: stage === 'pond' ? !p.playing : !s.playing,
  };
}
let lastSent = '';
setInterval(() => {
  if (isLocked()) return;
  const st = collect();
  const js = JSON.stringify(st);
  if (js !== lastSent || bridgeDirty) { lastSent = js; bridgeDirty = false; SimBridge.setState(st); }
}, 150);

// ───────── 두 단계 ─────────
const pond = new Pond({ onChange: markDirty, isLocked });
const spring = new Spring({ onChange: markDirty, isLocked });
window.__sim = { pond, spring };   // 검수용 (값 읽기)
pond.onLowFps = () => { setQuality('low'); toast('화면이 느려서 그래픽 품질을 낮음으로 바꿨어요', 2600); };
if (quality === 'low') { pond.setQuality('low'); spring.setQuality('low'); }
$('qualityLbl').textContent = quality === 'high' ? '품질 높음' : '품질 낮음';

// 효과음 (틱은 0.08초에 한 번까지)
let lastTick = 0;
const tick = v => { const n = performance.now(); if (n - lastTick < 80) return; lastTick = n; sound.tick(v); };

// ───────── 탭 ─────────
function setStage(s, withSound = true) {
  if (s === stage) { if (withSound) sound.soft(); flashView(); return; }
  stage = s;
  $('viewPond').hidden = s !== 'pond';
  $('viewSpring').hidden = s !== 'spring';
  $('tabPond').setAttribute('aria-selected', s === 'pond');
  $('tabSpring').setAttribute('aria-selected', s === 'spring');
  pond.active = s === 'pond';
  spring.active = s === 'spring';
  if (withSound) sound.whoosh();
  requestAnimationFrame(() => { pond.resize(); spring.resize(); pond.dirty = true; });
  markDirty();
}
function flashView() {
  const el = stage === 'pond' ? $('pondScene') : $('boardCard');
  el.animate([{ boxShadow: '0 0 0 4px rgba(30,127,214,.5)' }, { boxShadow: '0 0 0 0 rgba(30,127,214,0)' }], { duration: 500 });
}
$('tabPond').addEventListener('click', () => !isLocked() && setStage('pond'));
$('tabSpring').addEventListener('click', () => !isLocked() && setStage('spring'));

// ───────── 위 띠 단추 ─────────
$('btnMute').textContent = sound.muted ? '🔇' : '🔊';
$('btnMute').addEventListener('click', () => {
  const m = sound.toggleMute();
  $('btnMute').textContent = m ? '🔇' : '🔊';
  if (!m) sound.click();
});
function setQuality(q) {
  quality = q;
  pond.setQuality(q); spring.setQuality(q);
  $('qualityLbl').textContent = q === 'high' ? '품질 높음' : '품질 낮음';
}
$('btnQuality').addEventListener('click', () => {
  if (isLocked()) return;
  setQuality(quality === 'high' ? 'low' : 'high');
  sound.click();
  toast(quality === 'high' ? '그래픽 품질: 높음 (물결이 더 매끄러워요)' : '그래픽 품질: 낮음 (느린 기기에서 더 부드러워요)');
});
const modal = $('helpModal');
const openHelp = () => { modal.hidden = false; sound.soft(); $('btnHelpClose').focus(); };
const closeHelp = () => { if (!modal.hidden) { modal.hidden = true; sound.click(); } };
$('btnHelp').addEventListener('click', openHelp);
$('btnHelpClose').addEventListener('click', closeHelp);
modal.addEventListener('pointerdown', e => { if (e.target === modal) closeHelp(); });

$('btnReset').addEventListener('click', () => {
  if (isLocked()) return;
  sound.reset();
  if (stage === 'pond') { pond.reset(); syncPondUi(); toast('연못을 처음 상태로 되돌렸어요'); }
  else { resetSpring(); toast('용수철 실험실을 처음 상태로 되돌렸어요'); }
  markDirty();
});

// ───────── ① 연못 조작 ─────────
function syncPondUi() {
  $('strength').value = pond.strength; paintRange($('strength'));
  $('btnRain').setAttribute('aria-pressed', pond.rain);
  $('btnTrail').setAttribute('aria-pressed', pond.showTrail);
  $('btnDots').setAttribute('aria-pressed', pond.showDots);
  $('pondSlow').setAttribute('aria-pressed', pond.slow);
  setPlayBtn($('pondPlayBtn'), pond.playing);
}
function setPlayBtn(btn, playing) {
  btn.innerHTML = playing ? '⏸<span class="lbl">일시정지</span>' : '▶<span class="lbl">재생</span>';
  btn.classList.toggle('primary', !playing);
}
const guard = fn => (...a) => { if (!isLocked()) fn(...a); };
$('btnDrop').addEventListener('click', guard(() => { pond.dropCenter(); if (!pond.playing) toast('일시정지 중이에요. 재생하면 물방울이 떨어져요'); }));
$('btnRain').addEventListener('click', guard(() => {
  pond.setRain(!pond.rain);
  pond.rain ? sound.on() : sound.off();
  syncPondUi(); markDirty();
}));
$('strength').addEventListener('input', guard(() => {
  pond.setStrength(+$('strength').value); paintRange($('strength')); tick((+$('strength').value - 1) / 2); markDirty();
}));
$('btnTrail').addEventListener('click', guard(() => { pond.setTrail(!pond.showTrail); pond.showTrail ? sound.on() : sound.off(); syncPondUi(); }));
$('btnDots').addEventListener('click', guard(() => { pond.setDots(!pond.showDots); pond.showDots ? sound.on() : sound.off(); syncPondUi(); }));
$('btnCalm').addEventListener('click', guard(() => { pond.calm(); sound.reset(); syncPondUi(); markDirty(); }));
$('pondPlayBtn').addEventListener('click', guard(() => { pond.playing = !pond.playing; pond.playing ? sound.on() : sound.off(); syncPondUi(); markDirty(); }));
$('pondSlow').addEventListener('click', guard(() => { pond.slow = !pond.slow; sound.click(); syncPondUi(); }));
$('pondView').addEventListener('click', guard(() => { pond.resetView(); sound.whoosh(); }));

// 단계 끝 안내 (처음 한 번)
let pondDone = false;
function checkPondDone() {
  if (pondDone || pond.rec.dropCount < 3 || !pond.rec.leafWaveArrived) return;
  pondDone = true;
  $('pondQText').innerHTML = '오리와 나뭇잎은 물결을 따라 밀려갔나요? 이제 <b>[② 용수철 실험실]</b>에서 파동을 재 봐요.';
  $('pondQuestion').classList.add('done');
  $('tabSpring').classList.add('flash');
  setTimeout(() => $('tabSpring').classList.remove('flash'), 3000);
  sound.chime();
}

// ───────── ② 실험실 조작 ─────────
function syncSpringUi() {
  const s = spring;
  $('modeAuto').setAttribute('aria-pressed', s.mode === 'auto' && s.running);
  $('modeHand').setAttribute('aria-pressed', s.mode === 'hand');
  $('ampField').classList.toggle('off', s.mode !== 'auto');
  $('perField').classList.toggle('off', s.mode !== 'auto');
  $('handNote').hidden = s.mode !== 'hand';
  $('amp').value = s.A.toFixed(2); paintRange($('amp'));
  $('per').value = s.T.toFixed(2); paintRange($('per'));
  if (s.mode === 'auto') {
    $('ampOut').textContent = `${s.A.toFixed(2)} m`;
    $('perOut').textContent = `${s.T.toFixed(2)} 초`;
    $('freqOut').textContent = `${(1 / s.T).toFixed(2)} Hz`;
  } else {
    $('ampOut').textContent = '그래프에서 재 보세요';
    $('perOut').textContent = '그래프에서 재 보세요';
    $('freqOut').textContent = '– Hz';
  }
  document.querySelectorAll('[data-tension]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tension === s.tension));
  $('btnLabels').setAttribute('aria-pressed', s.showLabels);
  $('btnRibbonTrail').setAttribute('aria-pressed', s.showRibbonTrail);
  $('springSlow').setAttribute('aria-pressed', s.slow);
  setPlayBtn($('springPlayBtn'), s.playing);
  ['mWave', 'mAmp', 'mPer'].forEach((id, i) => $(id).classList.toggle('ok', [s.rec.missionWavelength, s.rec.missionAmplitude, s.rec.missionPeriod][i]));
}
spring.onModeUi = () => { syncSpringUi(); markDirty(); };
$('modeAuto').addEventListener('click', guard(() => {
  if (spring.setMode('auto')) { sound.on(); toast('자동으로 흔들기 시작!'); } else sound.soft();
  syncSpringUi(); markDirty();
}));
$('modeHand').addEventListener('click', guard(() => {
  if (spring.setMode('hand')) { sound.off(); toast('왼쪽 장갑 손잡이를 위아래로 끌어 흔들어 보세요', 2400); } else sound.soft();
  syncSpringUi(); markDirty();
}));
$('amp').addEventListener('input', guard(() => {
  spring.setA(+$('amp').value);
  ghostAmp();
  tick((+$('amp').value - 0.1) / 0.5); syncSpringUi(); markDirty();
}));
$('per').addEventListener('input', guard(() => {
  spring.setT(+$('per').value);
  tick(1 - (+$('per').value - 0.25) / 1.75); syncSpringUi(); markDirty();
}));
document.querySelectorAll('[data-tension]').forEach(b => b.addEventListener('click', guard(() => {
  if (spring.setTension(b.dataset.tension)) { tick(0.5); toast(`용수철을 '${TENSION_NAME[spring.tension]}' 걸고 처음부터 흔들어요`); }
  else sound.soft();
  syncSpringUi(); markDirty();
})));
$('btnLabels').addEventListener('click', guard(() => { spring.showLabels = !spring.showLabels; sound.click(); syncSpringUi(); }));
$('btnRibbonTrail').addEventListener('click', guard(() => { spring.showRibbonTrail = !spring.showRibbonTrail; sound.click(); syncSpringUi(); }));
$('btnShoot').addEventListener('click', guard(() => { spring.shoot(); syncSpringUi(); }));
$('springPlayBtn').addEventListener('click', guard(() => { spring.playing = !spring.playing; spring.playing ? sound.on() : sound.off(); syncSpringUi(); markDirty(); }));
$('springStep').addEventListener('click', guard(() => {
  if (spring.playing) { spring.playing = false; syncSpringUi(); }
  spring.stepOnce(); sound.tick(0.6); markDirty();
}));
$('springSlow').addEventListener('click', guard(() => { spring.slow = !spring.slow; sound.click(); syncSpringUi(); }));
$('springStop').addEventListener('click', guard(() => {
  spring.stopSpring(); sound.reset(); toast('용수철을 멈췄어요. [자동으로 흔들기]를 누르면 다시 흔들어요', 2600);
  syncSpringUi(); markDirty();
}));
function resetSpring() {
  const rec = spring.rec;
  spring.defaults();
  spring.rec = rec;   // 조건 체크·촬영 횟수는 유지
  syncSpringUi();
}

// 진폭을 바꾸면 '파장 그대로'를 비교하도록 바꾸기 전 모양을 잠깐 흐리게 겹쳐 보여 줌
let ghostTimer = 0;
function ghostAmp() {
  if (!spring.ghost) {
    const L = spring.layout; if (!L) return;
    const pts = [];
    for (let x = 0; x <= 3.0001; x += 0.01) pts.push([x, spring.yAt(x)]);
    spring.ghost = pts;
  }
  clearTimeout(ghostTimer);
  ghostTimer = setTimeout(() => { spring.ghost = null; }, 1400);
}
const drawOrig = spring.draw.bind(spring);
spring.draw = function () {
  drawOrig();
  if (!this.ghost || !this.layout) return;
  const c = this.bctx, L = this.layout;
  c.save();
  c.strokeStyle = 'rgba(120, 120, 140, .55)'; c.lineWidth = 3; c.setLineDash([3, 4]);
  c.beginPath(); this.ghost.forEach(([x, y], i) => (i ? c.lineTo(L.X(x), L.Y(y)) : c.moveTo(L.X(x), L.Y(y)))); c.stroke();
  c.setLineDash([]);
  c.font = '700 12px Pretendard, "Noto Sans KR", sans-serif'; c.fillStyle = '#55556a'; c.textAlign = 'left';
  c.fillText('흐린 선: 진폭을 바꾸기 전 모양', L.X(0.05), L.Y(-0.7) - 6);
  c.restore();
};

// 그래프 읽음값
function updateSpringReadouts() {
  const s = spring;
  $('springTime').textContent = `${s.t.toFixed(1)} 초`;
  const y = s.yAt(s.ribbonX);
  $('ribbonInfo').textContent = `리본 ${s.ribbonX.toFixed(2)} m · 위치 ${(Math.abs(y) < 0.005 ? 0 : y).toFixed(2).replace('-', '−')} m`;
  const dt = s.graphDt();
  $('graphDtOut').textContent = dt == null ? (s.gpts.length === 1 ? '한 점 더 누르면 시간 차가 보여요' : '그래프를 두 번 눌러 시간 차를 재요') : `시간 차 ${dt.toFixed(2)} 초`;
  $('boardHint').style.opacity = s.ruler.used ? 0 : 1;
}

// 연못 읽음값
let lastLeaf = '';
function updatePondReadouts() {
  const h = pond.duckH;
  $('roShift').textContent = `${Math.hypot(pond.duck.position.x - pond.duckAnchor.x, pond.duck.position.z - pond.duckAnchor.z).toFixed(1)} cm`;
  $('roHeight').textContent = `${h > 0.05 ? '+' : h < -0.05 ? '−' : ''}${Math.abs(h).toFixed(1)} cm`;
  const lt = pond.leafText();
  if (lt !== lastLeaf) {
    lastLeaf = lt;
    $('roLeaf').textContent = lt;
    $('roLeaf').className = { calm: 'leaf-calm', arrive: 'leaf-arrive', move: 'leaf-move' }[pond.leafState];
  }
  checkPondDone();
}

// 오리 그래프 (최근 6초)
const dcv = $('duckGraph'), dctx = dcv.getContext('2d');
function sizeDuckGraph() {
  const r = dcv.getBoundingClientRect(), d = quality === 'high' ? Math.min(devicePixelRatio || 1, 2) : 1;
  dcv.width = Math.max(1, Math.round(r.width * d)); dcv.height = Math.max(1, Math.round(r.height * d));
  dcv._w = r.width; dcv._h = r.height; dcv._d = d;
}
new ResizeObserver(sizeDuckGraph).observe(dcv.parentElement);
function drawDuckGraph() {
  const W = dcv._w, H = dcv._h; if (!W || H < 20) return;
  const c = dctx; c.setTransform(dcv._d, 0, 0, dcv._d, 0, 0); c.clearRect(0, 0, W, H);
  const ml = 86, mr = 34, mt = 16, mb = 20;
  let ymax = 3;
  for (const [, h] of pond.graph) ymax = Math.max(ymax, Math.ceil(Math.abs(h)));
  const t1 = Math.max(6, pond.time), t0 = t1 - 6;
  const gx = t => ml + (t - t0) / 6 * (W - ml - mr), gy = y => mt + (ymax - y) / (2 * ymax) * (H - mt - mb);
  c.fillStyle = '#fbfdfd'; c.fillRect(ml, mt, W - ml - mr, H - mt - mb);
  const font = (w, s) => `${w} ${s}px Pretendard, "Noto Sans KR", sans-serif`;
  c.lineWidth = 1;
  for (let k = 0; k <= 6; k++) {
    const X = ml + k / 6 * (W - ml - mr);
    c.strokeStyle = '#e3ecee'; c.beginPath(); c.moveTo(X, mt); c.lineTo(X, H - mb); c.stroke();
    c.fillStyle = '#5a6b74'; c.font = font(600, 12); c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText(k === 6 ? '지금' : `${6 - k}초 전`, X, H - mb + 4);
  }
  for (let y = -ymax; y <= ymax; y += ymax >= 6 ? 2 : 1) {
    const Y = gy(y);
    c.strokeStyle = y === 0 ? '#7f9ba3' : '#e3ecee'; if (y === 0) c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(ml, Y); c.lineTo(W - mr, Y); c.stroke(); c.setLineDash([]);
    if (y % 1 === 0 && (H > 110 || y % 3 === 0 || y === 0)) {
      c.fillStyle = '#6b7f86'; c.font = font(500, 12); c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(y > 0 ? `+${y}` : y < 0 ? `−${-y}` : '0', W - mr + 4, Y);
    }
  }
  c.strokeStyle = '#9fb6bd'; c.strokeRect(ml, mt, W - ml - mr, H - mt - mb);
  c.textAlign = 'right'; c.textBaseline = 'middle';
  c.font = font(800, 13); c.fillStyle = '#e0533d'; c.fillText('마루', ml - 6, gy(ymax * 0.7));
  c.font = font(700, 12.5); c.fillStyle = '#35545e'; c.fillText('진동의 중심', ml - 6, gy(0));
  c.font = font(800, 13); c.fillStyle = '#2d6fd6'; c.fillText('골', ml - 6, gy(-ymax * 0.7));
  c.font = font(600, 12); c.fillStyle = '#5a6b74'; c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText('높이(cm)', ml - 6, mt - 2);
  c.save(); c.beginPath(); c.rect(ml, mt, W - ml - mr, H - mt - mb); c.clip();
  c.strokeStyle = '#e8a400'; c.lineWidth = 2.4; c.lineJoin = 'round';
  c.beginPath();
  pond.graph.forEach(([t, h], i) => (i ? c.lineTo(gx(t), gy(h)) : c.moveTo(gx(t), gy(h))));
  c.stroke();
  if (pond.graph.length) { const [t, h] = pond.graph[pond.graph.length - 1]; c.fillStyle = '#e8a400'; c.beginPath(); c.arc(gx(t), gy(h), 4.5, 0, 7); c.fill(); }
  c.restore();
}

// ───────── 키보드: 스페이스바 = 일시정지/재생, Esc = 안내 닫기 ─────────
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeHelp(); return; }
  if (isLocked()) return;
  if (e.code === 'Space' && !e.target.closest('button, input, a')) {
    e.preventDefault();
    (stage === 'pond' ? $('pondPlayBtn') : $('springPlayBtn')).click();
  }
});

// ───────── 잠금 (.sim-locked 또는 lock 메시지): 재생 멈춤, 풀리면 되살림 ─────────
let lockSaved = null;
function applyLock(on) {
  if (on && !lockSaved) {
    lockSaved = { p: pond.playing, s: spring.playing };
    pond.playing = false; spring.playing = false; pond.rain = false;
    closeHelp();
    syncPondUi(); syncSpringUi();
  } else if (!on && lockSaved) {
    pond.playing = lockSaved.p; spring.playing = lockSaved.s; lockSaved = null;
    syncPondUi(); syncSpringUi();
  }
}
SimBridge.onLock = () => applyLock(true);
new MutationObserver(() => applyLock(isLocked())).observe(root, { attributes: true, attributeFilter: ['class'] });

// ───────── 반복 ─────────
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (stage === 'pond') {
    pond.update(dt);
    updatePondReadouts();
    drawDuckGraph();
  } else {
    spring.update(dt);
    updateSpringReadouts();
  }
  requestAnimationFrame(loop);
}
syncPondUi(); syncSpringUi();
paintRange($('strength'));
requestAnimationFrame(loop);
