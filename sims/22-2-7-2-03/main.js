// 22-2-7-2-03 일식과 월식 관측소 — 화면 연결·상태 관리
import { sound } from '../../lib/sound.js';
import { toast, paintRange } from '../../lib/utils.js';
import { Space } from './scene3d.js';
import { Sky } from './sky.js';
import {
  EVENTS, bookGeom, freeGeom, bookAngle, eclipseState, STATE_KO,
  timeStr, timeDisplay, clockOf,
} from './model.js';

SimBridge.init('22-2-7-2-03');

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ── 효과음 ──
const sfx = {
  tick: v => sound.tick(v),
  edge: () => { sound._tone({ freq: 294, type: 'sine', dur: 0.8, vol: 0.2 }); sound._tone({ freq: 588, type: 'sine', dur: 0.5, vol: 0.05 }); },
  total: () => [262, 330, 392, 523].forEach((f, i) => sound._tone({ freq: f, type: 'sine', dur: 2.2, vol: 0.06, attack: 0.25, delay: i * 0.05 })),
  whoosh: () => sound.whoosh(),
  place: () => sound.soft(),
  good: () => { sound._tone({ freq: 880, type: 'triangle', dur: 0.16, vol: 0.15 }); sound._tone({ freq: 1318, type: 'triangle', dur: 0.3, vol: 0.15, delay: 0.13 }); },
  bad: () => sound._tone({ freq: 196, type: 'triangle', dur: 0.35, vol: 0.18 }),
  click: () => sound.click(),
  reset: () => sound.reset(),
};

// ── 상태 ──
const FREE_START = { angle: 300, h: 0 };
const H_MAX = 5;                          // 달의 높낮이 범위 −5 ~ +5 (모형 단위)
const hTick = h => (h + H_MAX) / (2 * H_MAX);
const st = {
  mode: 'solar',
  t: { solar: EVENTS.solar.tMin, lunar: EVENTS.lunar.tMin },
  tf: { solar: EVENTS.solar.tMin, lunar: EVENTS.lunar.tMin },   // 재생 중 소수 분
  angle: FREE_START.angle, h: FREE_START.h,
  playing: false, speed: 1, freeSpeed: 6,
  real: false,
  quality: 'high',
  lastBook: 'solar',
  orderTarget: 'solar',
  slots: { solar: [null, null, null], lunar: [null, null, null] },
  anim: null,           // 자유 배치 달 이동 애니메이션
  locked: false,
};
const rec = {
  maxCover: { solar: 0, lunar: 0, free: 0 },
  firstSide: { solar: '', lunar: '', free: '' },
  bins: { solar: new Set(), lunar: new Set() },
  viewed: { solar: false, lunar: false },
  order: { solar: '', lunar: '' },
  orderTried: 0,
  realViewed: false,
};
let prevCover = null, prevView = null, prevG = null;
let cur = null;   // 지금 기하

// ── 3D와 하늘 ──
const space = new Space($('#space3d'), {
  onMoonDrag: deg => {
    if (deg === null) { pushState(); return; }
    if (st.locked || st.mode !== 'free') return;
    stopAnim();
    const d = Math.round(deg) % 360;
    if (d !== st.angle) {
      const dir = angDiff(d, st.angle) > 0 ? 1 : -1;
      st.angle = d; sfx.tick(d / 360); update(dir);
    }
  },
  onDragBlocked: () => toast('달을 직접 끌어 옮기려면 자유 배치를 고르세요'),
});
const sky = new Sky($('#sky'));
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;

// ── 계산·화면 갱신 ──
function compute() {
  if (st.mode === 'free') {
    return { g: freeGeom(st.angle, st.h), angle: st.angle, h: st.h };
  }
  const g = bookGeom(st.mode, st.t[st.mode]);
  return { g, angle: bookAngle(st.mode, st.t[st.mode]), h: 0 };
}

function elapsed(mode) {
  const ev = EVENTS[mode];
  return Math.max(0, Math.min(ev.end - ev.start, st.t[mode] - ev.start));
}

function stateLabel(mode, g) {
  const s = eclipseState(g.view, g.cover);
  if (mode !== 'free' && s === 'none') {
    const ev = EVENTS[mode];
    return st.t[mode] <= ev.start ? '식 전' : '식 끝';
  }
  // 교과서 날짜(일식)는 진행 시간이 지구 전체 기준일 수 있어서, 우리나라에서 개기 일식인지 단정하지 않음
  if (mode === 'solar' && s === 'totalSolar') return '가장 많이 가려짐';
  return STATE_KO[s];
}

// 하늘 보기 왼쪽 위 글자 (1~2줄) + ⓘ 안에 접어 둔 자세한 안내
function skyText(g) {
  const who = g.view === 'solar' ? '태양' : '달';
  const o = {
    title: '하늘 보기 · 남쪽 하늘처럼 왼쪽=동, 오른쪽=서',
    sub: `${who}을 가운데에 두고 크게 본 모습이에요. 크기·거리는 모형이에요.`,
    subShort: `${who}을 가운데에 두고 크게 본 모형이에요.`,
    info: [
      '남쪽 하늘을 바라볼 때처럼 왼쪽을 동쪽, 오른쪽을 서쪽으로 놓고 그렸어요.',
      `하루 동안의 일주 운동은 빼고, ${who}을 화면 가운데에 고정했어요.`,
    ],
  };
  if (g.view === 'lunar') o.info.push('달을 가운데에 고정했기 때문에, 달이 동쪽으로 가면 지구의 그림자가 동쪽(왼쪽)에서 다가오는 것처럼 보여요.');
  if (st.mode === 'solar') {
    o.info.push('진행 시작·끝 시각만 교과서 값이고, 그 사이 가려지는 정도는 모형이에요.');
    o.info.push('교과서의 진행 시간은 지구 전체 기준일 수 있어요. 우리나라에서의 실제 모습은 천체 관측 프로그램(천문학습관)으로 확인해요.');
    o.maxNote = '모형에서 가장 많이 가려진 순간';
  } else if (st.mode === 'lunar') {
    o.info.push('진행 시작·끝 시각만 교과서 값이고, 그 사이 가려지는 정도는 모형이에요.');
    o.info.push('실제 모습은 천체 관측 프로그램(천문학습관)으로 확인해요.');
  } else {
    o.info.push('자유 배치는 크기·거리를 줄인 모형이라 실제 하늘과 달라요.');
  }
  return o;
}
let infoKey = '';
function syncSkyInfo(o) {
  const key = o.info.join('|');
  if (key === infoKey) return;
  infoKey = key;
  const ul = $('#skyInfo ul');
  ul.replaceChildren(...o.info.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
}
function setSkyInfo(open) {
  $('#skyInfo').hidden = !open;
  $('#skyInfoBtn').setAttribute('aria-expanded', String(open));
}
$('#skyInfoBtn').addEventListener('click', e => { e.stopPropagation(); setSkyInfo($('#skyInfo').hidden); sfx.click(); });
$('#skyInfo').addEventListener('click', () => setSkyInfo(false));
document.addEventListener('pointerdown', e => {
  if (!$('#skyInfo').hidden && !e.target.closest('#skyInfo, #skyInfoBtn')) setSkyInfo(false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') setSkyInfo(false); });

// dir: 시간·각도가 앞으로(+1) 갔는지 뒤로(−1) 갔는지 (0 = 알 수 없음)
function update(dir = 0, quiet = false) {
  const c = compute();
  cur = c;
  const g = c.g;
  space.setMoon(c.angle, c.h);

  const txt = skyText(g);
  sky.draw(g, txt);
  syncSkyInfo(txt);

  // 읽음값
  const moving = !!(st.anim && st.pendingOrder);   // 순서 카드 확인 뒤 달이 옮겨 가는 중에는 중간값을 숨김
  $('.read').classList.toggle('moving', moving);
  $('#rCover').textContent = moving ? '…' : g.cover.toFixed(1) + ' %';
  if (st.mode === 'free') {
    $('#rSecondK').textContent = '달의 위치 각도';
    $('#rSecond').textContent = moving ? '…' : `${Math.round(c.angle) % 360}°`;
  } else {
    $('#rSecondK').textContent = '지난 시간';
    $('#rSecond').textContent = `${elapsed(st.mode)}분`;
  }
  const s = eclipseState(g.view, g.cover);
  const rs = $('#rState');
  const label = stateLabel(st.mode, g);
  rs.textContent = moving ? '…' : label;
  rs.className = 'v' + (moving ? '' : s.startsWith('total') ? ' total' : s !== 'none' ? ' on' : '') + (label.length > 7 ? ' long' : '');
  // 일식 탭의 최대 가림은 모형 값이라는 표시는 칸 제목에 붙임 (값 글자가 두 줄로 넘어가 칸 높이가 흔들리지 않게)
  $('#rStateK').textContent = !moving && st.mode === 'solar' && s === 'totalSolar' ? '식 상태 (모형)' : '식 상태';
  $('#rBy').textContent = moving ? '…' : s === 'none' ? '없음' : g.view === 'solar' ? '달' : '지구의 그림자';

  // 기록
  const m = st.mode;
  rec.maxCover[m] = Math.max(rec.maxCover[m], g.cover);
  if (m !== 'free') {
    const ev = EVENTS[m], t = st.t[m];
    if (t <= ev.start) rec.bins[m].add('before');
    if (t >= ev.end) rec.bins[m].add('after');
    if (t >= ev.start && t <= ev.end) rec.bins[m].add(Math.floor((t - ev.start) / 10));
    const need = Math.floor((ev.end - ev.start) / 10);
    let all = rec.bins[m].has('before') && rec.bins[m].has('after');
    for (let i = 0; all && i <= need; i++) if (!rec.bins[m].has(i)) all = false;
    if (all) rec.viewed[m] = true;
  }

  // 소리와 '먼저 가려진 쪽'
  if (prevCover !== null && prevView === g.view && !quiet) {
    if (prevCover <= 0.0001 && g.cover > 0.0001) {
      sfx.edge();
      if (dir > 0) {
        // 가려지기 직전 가림체가 있던 쪽 = 먼저 가려진 쪽
        const p = prevG || g;
        const side = Math.abs(p.occX) < 0.15 * Math.abs(p.occY) ? '' : (p.occX > 0 ? 'west' : 'east');
        rec.firstSide[m] = side;
      }
    } else if (prevCover > 0.0001 && g.cover <= 0.0001) sfx.edge();
    if (prevCover < 99.95 && g.cover >= 99.95) sfx.total();
  }
  prevCover = g.cover; prevView = g.view; prevG = g;

  if (m !== 'free') st.lastBook = m;
  syncMission();
  syncControls();
  pushState();
}

function syncControls() {
  if (st.mode !== 'free') {
    const m = st.mode, ev = EVENTS[m], t = st.t[m];
    const d = timeDisplay(m, t);
    $('#tDate').textContent = d.date;
    $('#tClock').textContent = d.clock;
    $('#mlStart').textContent = `교과서 진행 시작 ${clockOf(ev.start)}`;
    $('#mlEnd').textContent = `진행 끝 ${clockOf(ev.end)}`;
    const sl = $('#tSlider');
    if (+sl.min !== ev.tMin) { sl.min = ev.tMin; sl.max = ev.tMax; }
    sl.value = t;
    sl.setAttribute('aria-valuetext', `${d.date} ${d.clock}`);
    paintRange(sl);
    const pct = v => `calc(${(v - ev.tMin) / (ev.tMax - ev.tMin)} * (100% - 16px) + 8px)`;
    $('#mkStart').style.left = pct(ev.start);
    $('#mkEnd').style.left = pct(ev.end);
    $('#mlStart').style.left = pct(ev.start);
    const fe = (ev.end - ev.tMin) / (ev.tMax - ev.tMin);
    $('#mlEnd').style.right = `calc(${1 - fe} * (100% - 16px) + 8px)`;
  } else {
    const a = Math.round(st.angle) % 360;
    $('#aSlider').value = a;
    $('#aOut').textContent = `${a}°`;
    $('#aSlider').setAttribute('aria-valuetext', `${a}도`);
    $('#hSlider').value = st.h;
    $('#hOut').textContent = `${st.h > 0 ? '+' : ''}${st.h.toFixed(1)} (모형 단위)`;
    $('#hSlider').setAttribute('aria-valuetext', `${st.h.toFixed(1)} 모형 단위`);
  }
  for (const b of $$('.play')) {
    const on = st.playing;
    b.classList.toggle('playing', on);
    b.querySelector('span').textContent = on ? '멈춤' : (b.id === 'btnFreePlay' ? '공전' : '재생');
    b.setAttribute('aria-label', b.querySelector('span').textContent);
  }
}

// ── 웹앱으로 상태 보내기 (몰아서) ──
let pushTimer = null;
function pushState() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const g = cur.g, m = st.mode;
    SimBridge.setState({
      mode: m,
      timeStr: timeStr(st.lastBook, st.t[st.lastBook]),
      elapsedMin: elapsed(st.lastBook),
      coverPct: Math.round(g.cover * 10) / 10,
      maxCoverPct: Math.round(rec.maxCover[m] * 10) / 10,
      eclipseState: eclipseState(g.view, g.cover),
      firstCoveredSide: rec.firstSide[m],
      firstCoveredSideSolar: rec.firstSide.solar,
      firstCoveredSideLunar: rec.firstSide.lunar,
      moonAngleDeg: Math.round(cur.angle) % 360,
      moonHeight: Math.round(cur.h * 10) / 10,
      orderSolar: rec.order.solar,
      orderLunar: rec.order.lunar,
      orderTried: rec.orderTried,
      viewedSolar: rec.viewed.solar,
      viewedLunar: rec.viewed.lunar,
      realScaleViewed: rec.realViewed,
    });
  }, 120);
}

// ── 모드 ──
// 단계별 탐구 질문 (정답은 넣지 않음)
const MISSION = {
  solar: '탐구 ① 08:15 무렵부터 1분씩 넘겨 보세요. 태양은 동쪽과 서쪽 중 어느 쪽부터 가려질까요?',
  lunar: '탐구 ② 22:27 무렵부터 1분씩 넘겨 보세요. 달은 어느 쪽부터 가려질까요? 가리는 것은 무엇일까요?',
  free: '탐구 ③ 달을 0°나 180°에 두고 높낮이를 바꿔 보세요. 달이 그 자리에 올 때마다 식이 일어날까요?',
};
// 식이 끝난 뒤 다음 단계 안내 (정답 없음)
const MISSION_DONE = {
  solar: { text: '탐구 ① 끝! 태양이 어느 쪽부터 가려졌는지 정리했나요? 다음은 위의 [월식] 탭이에요.', next: 'lunar' },
  lunar: { text: '탐구 ② 끝! 달이 어느 쪽부터, 무엇에 가려졌는지 정리했나요? 다음은 위의 [자유 배치] 탭이에요.', next: 'free' },
};
const doneShown = { solar: false, lunar: false };
function syncMission() {
  const m = st.mode;
  let text = MISSION[m];
  if (m !== 'free' && st.t[m] >= EVENTS[m].end) {
    text = MISSION_DONE[m].text;
    if (!doneShown[m]) { doneShown[m] = true; flashTab(MISSION_DONE[m].next); }
  }
  const el = $('#mission');
  if (el.textContent !== text) el.textContent = text;
}
function flashTab(mode) {
  const b = $(`.tabs button[data-mode="${mode}"]`);
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
  setTimeout(() => b.classList.remove('flash'), 2600);
}
const MSG0 = '카드를 끌어 칸에 놓거나, 카드를 눌러 빈칸에 차례로 넣어요.';
function setMode(m, { silent = false } = {}) {
  if (m === st.mode && !silent) return;
  setPlaying(false);
  stopAnim();
  st.mode = m;
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
  $('#timePanel').hidden = m === 'free';
  $('#freePanel').hidden = m !== 'free';
  space.dragEnabled = m === 'free';
  space.setFreeHints(m === 'free');
  if (m !== 'free') { setOrderTarget(m); setMsg(MSG0); }
  $('.space').classList.toggle('free', m === 'free');
  $('.space-head span').textContent = m === 'free' ? '달을 끌어 옮기기 · 빈 곳을 끌어 돌리기' : '끌어서 돌리기 · 휠/두 손가락 확대';
  setSkyInfo(false);
  if (st.real) setReal(false);
  space.setTilt(m === 'free' && Math.abs(st.h) > 0.05);
  prevCover = null;
  if (!silent) sfx.whoosh();
  update(0, true);
}

// ── 시간 ──
function setTime(t, dir) {
  const ev = EVENTS[st.mode];
  t = Math.max(ev.tMin, Math.min(ev.tMax, Math.round(t)));
  if (t === st.t[st.mode]) return false;
  const old = st.t[st.mode];
  st.t[st.mode] = t; st.tf[st.mode] = t;
  update(dir ?? Math.sign(t - old));
  return true;
}

function setPlaying(on) {
  if (on === st.playing) return;
  st.playing = on;
  if (on && st.mode !== 'free') {
    const ev = EVENTS[st.mode];
    if (st.t[st.mode] >= ev.tMax) { st.t[st.mode] = ev.tMin; st.tf[st.mode] = ev.tMin; prevCover = null; update(0, true); }
  }
  if (on) stopAnim();
  syncControls();
}

$$('.tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$$('[data-step]').forEach(b => b.addEventListener('click', () => {
  setPlaying(false);
  if (setTime(st.t[st.mode] + +b.dataset.step)) sfx.tick(0.5 + Math.sign(+b.dataset.step) * 0.2);
}));
$('#tSlider').addEventListener('input', e => {
  setPlaying(false);
  const v = +e.target.value;
  if (setTime(v)) sfx.tick((v - +e.target.min) / (+e.target.max - +e.target.min));
});
$('#btnPlay').addEventListener('click', () => { setPlaying(!st.playing); sfx.click(); });
$$('#speedSeg button').forEach(b => b.addEventListener('click', () => {
  st.speed = +b.dataset.speed;
  $$('#speedSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  sfx.click();
}));

// ── 자유 배치 ──
function setAngle(a, dir) {
  a = ((Math.round(a) % 360) + 360) % 360;
  if (a === st.angle) return false;
  const d = dir ?? Math.sign(angDiff(a, st.angle));
  st.angle = a;
  update(d);
  return true;
}
function setHeight(h) {
  h = Math.max(-H_MAX, Math.min(H_MAX, Math.round(h * 10) / 10));
  if (h === st.h) return false;
  st.h = h; update(0);
  space.setTilt(Math.abs(h) > 0.05);
  return true;
}
function stopAnim() {
  st.anim = null;
  if (st.pendingOrder) finishOrder();
}
// 달을 목표 각도로 부드럽게 옮김
function animateTo(angle, h = st.h) {
  setPlaying(false);
  const from = st.angle, d = angDiff(angle, from);
  st.anim = { from, d, hFrom: st.h, hTo: h, t: 0, dur: Math.min(1.3, 0.35 + Math.abs(d) / 160) };
}
$('#aSlider').addEventListener('input', e => {
  setPlaying(false); stopAnim();
  if (setAngle(+e.target.value)) sfx.tick(+e.target.value / 360);
});
$('#hSlider').addEventListener('input', e => {
  stopAnim();
  if (setHeight(+e.target.value)) sfx.tick(hTick(+e.target.value));
});
$$('[data-astep]').forEach(b => b.addEventListener('click', () => {
  setPlaying(false); stopAnim();
  if (setAngle(st.angle + +b.dataset.astep, Math.sign(+b.dataset.astep))) sfx.tick(st.angle / 360);
}));
$$('[data-hstep]').forEach(b => b.addEventListener('click', () => {
  stopAnim();
  if (setHeight(st.h + +b.dataset.hstep)) sfx.tick(hTick(st.h));
}));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => { animateTo(+b.dataset.goto); sfx.whoosh(); }));
$('[data-hzero]').addEventListener('click', () => { stopAnim(); if (setHeight(0)) sfx.tick(0.5); });
$('#btnFreePlay').addEventListener('click', () => { setPlaying(!st.playing); sfx.click(); });

// 3D에 초점이 있을 때 화살표 키
$('#space3d').addEventListener('keydown', e => {
  if (st.locked || st.mode !== 'free') return;
  const step = e.shiftKey ? 10 : 1;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    stopAnim(); setPlaying(false);
    if (setAngle(st.angle + (e.key === 'ArrowRight' ? step : -step))) sfx.tick(st.angle / 360);
    e.preventDefault();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    stopAnim();
    const hs = e.shiftKey ? 0.5 : 0.1;
    if (setHeight(st.h + (e.key === 'ArrowUp' ? hs : -hs))) sfx.tick(hTick(st.h));
    e.preventDefault();
  }
});

// ── 실제 크기 느낌 ──
function setReal(on) {
  st.real = on;
  $('#btnReal').setAttribute('aria-pressed', String(on));
  $('#bubble').hidden = !on;
  space.setRealScale(on);
  if (on) rec.realViewed = true;
}
$('#btnReal').addEventListener('click', () => {
  setReal(!st.real);
  sfx.whoosh();
  pushState();
});
$('#btnCam').addEventListener('click', () => {
  if (st.real) setReal(false); else space.setRealScale(false);
  space.setTilt(st.mode === 'free' && Math.abs(st.h) > 0.05, true);
  sfx.click();
});

// ── 소리·품질·초기화 ──
function syncMute() {
  const b = $('#btnMute');
  b.setAttribute('aria-pressed', String(sound.muted));
  b.querySelector('span').textContent = sound.muted ? '소리 꺼짐' : '소리';
  b.title = sound.muted ? '소리 켜기' : '소리 끄기';
}
$('#btnMute').addEventListener('click', () => { sound.toggleMute(); syncMute(); sfx.click(); });
syncMute();

function setQuality(q, auto = false) {
  st.quality = q;
  space.setQuality(q);
  sky.setQuality(q);
  if (cur) sky.draw(cur.g, sky.last?.opt);
  $('#btnQuality span').textContent = q === 'high' ? '품질 높음' : '품질 낮음';
  $('#btnQuality').setAttribute('aria-label', `그래픽 품질 ${q === 'high' ? '높음' : '낮음'}, 눌러서 바꾸기`);
  if (auto) toast('화면이 느려서 그래픽 품질을 \'낮음\'으로 바꿨어요', 3200);
}
$('#btnQuality').addEventListener('click', () => {
  const q = st.quality === 'high' ? 'low' : 'high';
  setQuality(q); sfx.click();
  // 학생이 '높음'으로 되돌리면 다시 재 봄 — 그래도 느리면 바꾸지 않고 알려만 줌 (학생 선택 존중)
  if (q === 'high') perf = { time: 0, frames: 0, prevDrew: false, done: false, from: performance.now() + 1500, again: true };
});

$('#btnReset').addEventListener('click', () => {
  setPlaying(false); stopAnim();
  st.t.solar = st.tf.solar = EVENTS.solar.tMin;
  st.t.lunar = st.tf.lunar = EVENTS.lunar.tMin;
  st.angle = FREE_START.angle; st.h = FREE_START.h;
  st.slots.solar = [null, null, null]; st.slots.lunar = [null, null, null];
  st.pendingOrder = null;
  st.speed = 1;
  $$('#speedSeg button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.speed === '1')));
  if (st.real) { st.real = false; $('#btnReal').setAttribute('aria-pressed', 'false'); $('#bubble').hidden = true; }
  space.setRealScale(false);
  space.setTilt(false);
  space.resetCamera();
  setOrderTarget(st.mode === 'lunar' ? 'lunar' : 'solar');
  setMsg(MSG0);
  prevCover = null;
  update(0, true);
  sfx.reset();
});

// ── 순서 카드 ──
const tray = $('#tray');
const slotEls = $$('.slot');
const cardEls = $$('.card');
const cardOf = name => cardEls.find(c => c.dataset.body === name);

function renderSlots() {
  const arr = st.slots[st.orderTarget];
  cardEls.forEach(c => tray.appendChild(c));
  arr.forEach((name, i) => {
    const s = slotEls[i];
    s.querySelector('.ph').hidden = !!name;
    if (name) s.appendChild(cardOf(name));
  });
  // 카드 순서를 태양·지구·달로 유지
  for (const n of ['태양', '지구', '달']) if (!arr.includes(n)) tray.appendChild(cardOf(n));
}
function setOrderTarget(t) {
  st.orderTarget = t;
  $$('#orderSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.target === t)));
  renderSlots();
}
function setMsg(text, cls = '') { const m = $('#orderMsg'); m.textContent = text; m.className = 'msg ' + cls; }

function placeCard(name, i) {
  const arr = st.slots[st.orderTarget];
  const from = arr.indexOf(name);
  if (i === null) { if (from >= 0) arr[from] = null; }
  else {
    const other = arr[i];
    if (from >= 0) arr[from] = other; else if (other) { /* 칸에 있던 카드는 카드 칸으로 */ }
    arr[i] = name;
  }
  renderSlots();
  sfx.place();
}
$$('#orderSeg button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.target !== st.orderTarget) setMsg(MSG0);
  setOrderTarget(b.dataset.target); sfx.click();
}));

// 끌어 놓기 (마우스·터치 모두 Pointer Events)
let drag = null;
cardEls.forEach(card => {
  card.addEventListener('pointerdown', e => {
    if (st.locked || e.button > 0) return;
    drag = { card, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', e => {
    if (!drag || drag.card !== card || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      const r = card.getBoundingClientRect();
      drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
      const g = card.cloneNode(true);
      g.classList.add('ghost'); g.style.width = r.width + 'px';
      document.body.appendChild(g); drag.ghost = g;
      card.classList.add('placeholder');
    }
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
    drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
    const over = slotAt(e.clientX, e.clientY);
    slotEls.forEach(s => s.classList.toggle('over', s === over));
  });
  const end = e => {
    if (!drag || drag.card !== card || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    card.classList.remove('placeholder');
    slotEls.forEach(s => s.classList.remove('over'));
    if (d.ghost) d.ghost.remove();
    if (!d.moved) return;   // 눌러서 놓기는 click에서 처리
    card.dataset.justDragged = '1';
    setTimeout(() => delete card.dataset.justDragged, 0);
    if (e.type === 'pointercancel') return;
    const over = slotAt(e.clientX, e.clientY);
    if (over) placeCard(card.dataset.body, +over.dataset.i);
    else if (tray.contains(document.elementFromPoint(e.clientX, e.clientY))) placeCard(card.dataset.body, null);
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  // 누르기(또는 Enter): 카드 칸 → 빈칸 / 칸 안 → 카드 칸으로
  card.addEventListener('click', () => {
    if (st.locked || card.dataset.justDragged) return;
    const arr = st.slots[st.orderTarget];
    if (arr.includes(card.dataset.body)) placeCard(card.dataset.body, null);
    else {
      const i = arr.indexOf(null);
      if (i >= 0) placeCard(card.dataset.body, i);
    }
    card.focus();
  });
});
function slotAt(x, y) {
  return slotEls.find(s => { const r = s.getBoundingClientRect(); return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 8 && y <= r.bottom + 8; }) || null;
}
$('#btnClear').addEventListener('click', () => {
  st.slots[st.orderTarget] = [null, null, null];
  renderSlots(); sfx.click();
  setMsg(MSG0);
});
$('#btnCheck').addEventListener('click', () => {
  const t = st.orderTarget, arr = st.slots[t];
  if (arr.includes(null)) { setMsg('세 칸을 모두 채운 뒤 확인을 눌러요.', 'bad'); sfx.bad(); return; }
  const str = arr.join('-');
  rec.order[t] = str;
  rec.orderTried++;
  const want = t === 'solar' ? '일식' : '월식';
  let made = null;
  if (arr[1] === '태양') made = null;
  else if (arr[1] === '달') made = 'solar';
  else made = 'lunar';
  if (made === null) {
    setMsg(`${str}: 달은 지구 둘레를 돌기 때문에 태양이 지구와 달 사이에 올 수 없어요. 다시 해 보세요.`, 'bad');
    sfx.bad();
  } else {
    st.pendingOrder = null;
    setMode('free', { silent: true });
    flashTab('free');
    animateTo(made === 'solar' ? 0 : 180, 0);
    st.pendingOrder = { made, t, str, want };
    setMsg(`${str}: 자유 배치에서 이 순서대로 달을 옮겨 직접 확인해 볼게요…`, 'wait');
    sfx.whoosh();
    update(0, true);
  }
  pushState();
});

// 달이 다 옮겨 간 뒤 결과 알림
function finishOrder() {
  const p = st.pendingOrder;
  st.pendingOrder = null;
  if (!p) return;
  const what = p.made === 'solar' ? '일식' : '월식';
  if (p.made === p.t) { setMsg(`${p.str}: 이렇게 늘어서면 ${what}이 생겨요. 하늘 보기와 가린 비율을 확인해 보세요.`, 'good'); sfx.good(); }
  else { setMsg(`${p.str}: 이렇게 늘어서면 ${what}이 생겨요. ${p.want}이 되려면 어떻게 놓아야 할까요?`, 'bad'); sfx.bad(); }
  update(0, true);
}

// ── 잠금 (웹앱 제출 후) ──
const lockables = () => $$('button, input');
function applyLock(on) {
  if (on === st.locked) return;
  st.locked = on;
  if (on) {
    setPlaying(false); stopAnim();
    lockables().forEach(el => { if (el.disabled) el.dataset.wasDisabled = '1'; el.disabled = true; });
    $('#space3d').tabIndex = -1;
    space.setEnabled(false);
  } else {
    lockables().forEach(el => { if (!el.dataset.wasDisabled) el.disabled = false; delete el.dataset.wasDisabled; });
    $('#space3d').tabIndex = 0;
    space.setEnabled(true);
  }
}
SimBridge.onLock = () => applyLock(true);
new MutationObserver(() => applyLock(document.documentElement.classList.contains('sim-locked')))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('message', e => {
  const d = e.data;
  if (d && d.source === 'science-shell' && d.type === 'unlock') {
    SimBridge.locked = false;
    document.documentElement.classList.remove('sim-locked');
  }
});

// ── 반복 (바뀐 것이 있을 때만 그림, 느리면 품질 자동 낮춤) ──
let last = performance.now(), tickAcc = 0;
// 처음 1.5초(셰이더 준비)는 빼고 잼. 평균 48fps보다 느리면 품질을 낮춤
let perf = { time: 0, frames: 0, prevDrew: false, done: false, from: performance.now() + 1500 };
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (st.playing && !st.locked) {
    tickAcc += dt;
    const beat = tickAcc >= 1;
    if (beat) tickAcc -= 1;
    if (st.mode === 'free') {
      st.angleF = (st.angleF ?? st.angle) + st.freeSpeed * dt;
      const a = Math.floor(st.angleF) % 360;
      if (a !== st.angle) { st.angle = a; update(1); }
      if (beat) sfx.tick(0.4);
    } else {
      const m = st.mode, ev = EVENTS[m];
      st.tf[m] += st.speed * dt;
      const t = Math.min(ev.tMax, Math.floor(st.tf[m]));
      if (t !== st.t[m]) { st.t[m] = t; update(1); }
      if (beat) sfx.tick(0.4);
      if (t >= ev.tMax) setPlaying(false);
    }
  } else {
    st.angleF = null; tickAcc = 0.9;
  }
  if (st.anim) {
    const a = st.anim;
    a.t = Math.min(1, a.t + dt / a.dur);
    const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
    st.angle = ((a.from + a.d * k) % 360 + 360) % 360;
    st.h = a.hFrom + (a.hTo - a.hFrom) * k;
    const done = a.t >= 1;
    if (done) { st.anim = null; st.angle = Math.round(st.angle) % 360; st.h = a.hTo; }
    update(a.d > 0 ? 1 : -1);
    if (done && st.pendingOrder) finishOrder();
  }
  const drew = space.frame(dt);
  // 그린 직후 프레임 간격으로 빠르기 측정 (40번 모아 평균이 느리면 품질 낮춤)
  if (perf.prevDrew && !perf.done && st.quality === 'high' && now > perf.from) {
    perf.time += dt; perf.frames++;
    if (perf.frames >= 40) {
      if (perf.time / perf.frames > 1 / 48) {
        perf.done = true;
        if (perf.again) toast('\'높음\' 품질에서 화면이 느려요. 움직임이 끊기면 \'품질 높음\' 단추를 눌러 \'낮음\'으로 바꿔 보세요.', 4200);
        else setQuality('low', true);
      }
      perf.time = 0; perf.frames = 0;
    }
  }
  perf.prevDrew = drew;
  requestAnimationFrame(loop);
}

// ── 시작 ──
setMode('solar', { silent: true });
renderSlots();
requestAnimationFrame(loop);

// 디버그·검수용 (정답 없음): 현재 상태 보기
window.__sim = { st, rec, space, sky, get geom() { return cur; }, get perf() { return perf; } };
