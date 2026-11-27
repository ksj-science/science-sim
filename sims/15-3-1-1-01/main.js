// 화학 반응식 만들기 — 1단계(이름과 기호) → 2단계(화학식) → 3단계(계수 맞추기), 분자 모형으로 계수비 = 분자 수의 비 확인
// 계수의 정답은 어디에도 적지 않는다. 완성 판정은 화살표 양쪽 원소별 원자 수 비교 + 계수의 최대공약수로만 계산한다.
import { sound } from '../../lib/sound.js';
import { ease, clamp, lerp } from '../../lib/utils.js';

const UNIT = '15-3-1-1-01';
window.SimBridge.init(UNIT);

const $ = s => document.querySelector(s);
const locked = () => document.documentElement.classList.contains('sim-locked') || window.SimBridge.locked;

// ───────────────────── 소리 ─────────────────────
const T = o => { if (!locked()) sound._tone(o); };
const Nz = o => { if (!locked()) sound._noise(o); };
const sfx = {
  pick: () => T({ freq: 880, freq2: 1180, type: 'sine', dur: 0.05, vol: 0.14 }),
  place: () => { T({ freq: 520, type: 'triangle', dur: 0.08, vol: 0.2 }); T({ freq: 780, type: 'sine', dur: 0.1, vol: 0.12, delay: 0.03 }); },
  wrongDrop: () => T({ freq: 170, freq2: 115, type: 'sine', dur: 0.2, vol: 0.16 }),
  ding: () => { if (!locked()) sound.ding(); },
  buzz: () => { T({ freq: 150, type: 'square', dur: 0.13, vol: 0.05 }); T({ freq: 140, type: 'sawtooth', dur: 0.13, vol: 0.03 }); },
  up: () => T({ freq: 480, freq2: 900, type: 'sine', dur: 0.09, vol: 0.18 }),
  down: () => T({ freq: 820, freq2: 420, type: 'sine', dur: 0.09, vol: 0.16 }),
  ting: i => T({ freq: [1175, 1397, 1568, 1760][i % 4], type: 'sine', dur: 0.4, vol: 0.12 }),
  warn: () => { for (let k = 0; k < 4; k++) T({ freq: k % 2 ? 250 : 300, freq2: k % 2 ? 300 : 250, type: 'triangle', dur: 0.12, vol: 0.12, delay: k * 0.1 }); },
  rewind: () => Nz({ dur: 0.25, from: 2600, to: 500, vol: 0.12 }),
  ticks: n => { for (let k = 0; k < n; k++) T({ freq: 1300 + (k % 3) * 160, type: 'triangle', dur: 0.04, vol: 0.09, delay: k * 0.06 }); },
  swish: () => Nz({ dur: 0.9, from: 400, to: 2200, vol: 0.07 }),
  snap: n => { for (let k = 0; k < n; k++) T({ freq: 720, freq2: 480, type: 'square', dur: 0.035, vol: 0.06, delay: k * 0.08 }); },
  thud2: () => { T({ freq: 115, freq2: 75, type: 'sine', dur: 0.22, vol: 0.28 }); T({ freq: 115, freq2: 75, type: 'sine', dur: 0.22, vol: 0.28, delay: 0.26 }); },
  complete: () => { [523, 659, 784].forEach(f => T({ freq: f, type: 'triangle', dur: 0.7, vol: 0.1 })); T({ freq: 1046, type: 'sine', dur: 0.6, vol: 0.08, delay: 0.12 }); },
  step: () => { T({ freq: 660, type: 'triangle', dur: 0.12, vol: 0.14 }); T({ freq: 990, type: 'triangle', dur: 0.18, vol: 0.14, delay: 0.1 }); },
  reset: () => { if (!locked()) sound.reset(); },
  soft: () => { if (!locked()) sound.soft(); },
};

// ───────────────────── 화학 자료 ─────────────────────
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const subU = n => String(n).split('').map(d => SUBS[+d]).join('');

const ELEM = {
  C: { name: '탄소', color: '#4b5058', hi: '#a2a8b1', dk: '#24272c', r: 0.86, ink: '#fff' },
  H: { name: '수소', color: '#d3d9e1', hi: '#ffffff', dk: '#8d98a6', r: 0.56, ink: '#2a3140' },
  O: { name: '산소', color: '#dc3d34', hi: '#ffa49a', dk: '#8f1d17', r: 0.78, ink: '#fff' },
  N: { name: '질소', color: '#2f62d0', hi: '#9ab9ff', dk: '#173882', r: 0.8, ink: '#fff' },
  Cu: { name: '구리', color: '#c96a2b', hi: '#ffc590', dk: '#7d3a10', r: 0.95, ink: '#fff' },
  Mg: { name: '마그네슘', color: '#a9b2bc', hi: '#f4f7fa', dk: '#66707c', r: 0.95, ink: '#1d2433' },
  Cl: { name: '염소', color: '#84c548', hi: '#dcf7b8', dk: '#4b7e1f', r: 0.9, ink: '#1d2433' },
};

const SPECIES = {
  CH4: { name: '메테인', mol: true, choices: ['CH4', 'C4H', 'CH2'] },
  O2: { name: '산소', mol: true, choices: ['O', 'O2', 'O3'] },
  CO2: { name: '이산화 탄소', mol: true, choices: ['CO2', 'CO', 'C2O'] },
  H2O: { name: '물', mol: true, choices: ['H2O', 'HO2', 'H2O2'] },
  Cu: { name: '구리', mol: false, choices: ['Cu', 'Cu2', 'C'] },
  CuO: { name: '산화 구리(Ⅱ)', mol: false, choices: ['CuO', 'Cu2O', 'CuO2'] },
  Mg: { name: '마그네슘', mol: false, choices: ['Mg', 'Mn', 'Mg2'] },
  HCl: { name: '염산', mol: false, choices: ['HCl', 'HCl2', 'H2Cl'] },
  MgCl2: { name: '염화 마그네슘', mol: false, choices: ['MgCl2', 'MgCl', 'Mg2Cl'] },
  H2: { name: '수소', mol: true, choices: ['H2', 'H', 'H3'] },
  N2: { name: '질소', mol: true, choices: ['N2', 'N', 'NO'] },
  NH3: { name: '암모니아', mol: true, choices: ['NH3', 'N3H', 'NH4'] },
  H2O2: { name: '과산화 수소', mol: true, choices: ['H2O2', 'H2O', 'HO'] },
};
const OTHER_NAMES = { O3: '오존', CO: '일산화 탄소' };

const REACTIONS = [
  { id: 'methane', name: '메테인의 연소', text: '천연가스의 주성분인 메테인이 산소와 반응하여 연소한다.', L: ['CH4', 'O2'], R: ['CO2', 'H2O'] },
  { id: 'copper', name: '구리의 가열', text: '붉은색 구리판을 공기 중에서 가열하면 검은색 산화 구리(Ⅱ)로 변한다.', L: ['Cu', 'O2'], R: ['CuO'], extra: [{ key: 'heat', name: '가열(불꽃)' }] },
  { id: 'mg_hcl', name: '마그네슘과 염산', text: '마그네슘을 염산에 넣으면 수소 기체가 발생하고 염화 마그네슘이 생성된다.', L: ['Mg', 'HCl'], R: ['MgCl2', 'H2'] },
  { id: 'ammonia', name: '암모니아 생성', text: '질소와 수소가 반응하여 암모니아가 생성된다.', L: ['N2', 'H2'], R: ['NH3'] },
  { id: 'water', name: '물의 생성', text: '수소와 산소가 반응하여 물이 생성된다.', L: ['H2', 'O2'], R: ['H2O'] },
  { id: 'h2o2', name: '과산화 수소의 분해', text: '과산화 수소가 분해되어 물과 산소가 생성된다.', L: ['H2O2'], R: ['H2O', 'O2'] },
];
REACTIONS.forEach(rx => { rx.slots = [...rx.L.map(k => ({ k, side: 'L' })), ...rx.R.map(k => ({ k, side: 'R' }))]; });

const parse = s => [...s.matchAll(/([A-Z][a-z]?)(\d*)/g)].map(m => [m[1], m[2] ? +m[2] : 1]);
const fstr = g => g.map(([e, n]) => e + (n > 1 ? n : '')).join('');
const fU = g => g.map(([e, n]) => e + (n > 1 ? subU(n) : '')).join('');
const fHTML = g => g.map(([e, n]) => e + (n > 1 ? `<sub>${n}</sub>` : '')).join('');
const countAtoms = g => { const o = {}; for (const [e, n] of g) o[e] = (o[e] || 0) + n; return o; };
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const gcdAll = arr => arr.reduce((a, b) => gcd(a, b));
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const nameOfFormula = s => (SPECIES[s] && SPECIES[s].name) || OTHER_NAMES[s] || null;

// ───────────────────── 분자 모양 (단위: 원자 반지름 기준 근삿값) ─────────────────────
const SHAPES = {
  CH4: [['H', -1.25, 0], ['H', 1.25, 0], ['H', 0, -1.25], ['H', 0, 1.25], ['C', 0, 0]],
  O2: [['O', -0.6, 0], ['O', 0.6, 0]],
  N2: [['N', -0.62, 0], ['N', 0.62, 0]],
  H2: [['H', -0.42, 0], ['H', 0.42, 0]],
  CO2: [['O', -1.3, 0], ['O', 1.3, 0], ['C', 0, 0]],
  H2O: [['H', -0.82, 0.52], ['H', 0.82, 0.52], ['O', 0, -0.12]],
  NH3: [['H', -0.92, 0.48], ['H', 0.92, 0.48], ['H', 0, 0.95], ['N', 0, -0.15]],
  H2O2: [['H', -1.42, 0.62], ['H', 1.42, -0.62], ['O', -0.6, 0], ['O', 0.6, 0]],
  HCl: [['H', -0.88, 0], ['Cl', 0.3, 0]],
  CuO: [['Cu', -0.55, 0], ['O', 0.72, 0]],
  MgCl2: [['Cl', -1.45, 0], ['Cl', 1.45, 0], ['Mg', 0, 0]],
  Cu: [['Cu', 0, 0]], Mg: [['Mg', 0, 0]],
  O3: [['O', -1.05, 0.42], ['O', 1.05, 0.42], ['O', 0, -0.15]],
  CO: [['C', -0.6, 0], ['O', 0.62, 0]],
};
const R_ = el => (ELEM[el] ? ELEM[el].r : 0.8);
function genericShape(groups) {
  const list = []; groups.forEach(([e, n]) => { for (let i = 0; i < n; i++) list.push(e); });
  if (list.length === 1) return [[list[0], 0, 0]];
  const singles = groups.filter(g => g[1] === 1).sort((a, b) => R_(b[0]) - R_(a[0]));
  if (singles.length && list.length <= 7) {
    const c = singles[0][0]; const others = list.slice(); others.splice(others.indexOf(c), 1);
    const k = others.length, out = [];
    others.forEach((e, i) => {
      const a = k === 2 ? Math.PI * i : -Math.PI / 2 + (i * 2 * Math.PI) / k + (k === 3 ? Math.PI / 6 * 0 : 0);
      const d = (R_(c) + R_(e)) * 0.84;
      out.push([e, Math.cos(a) * d, Math.sin(a) * d]);
    });
    out.push([c, 0, 0]);
    return out;
  }
  // 사슬 모양
  const out = []; let x = 0;
  list.forEach((e, i) => { if (i) x += (R_(list[i - 1]) + R_(e)) * 0.8; out.push([e, x, i % 2 ? 0.3 : -0.3]); });
  return out.map(([e, xx, y]) => [e, xx - x / 2, y]);
}
const shapeCache = {};
function shapeOf(groups) {
  const key = fstr(groups);
  if (shapeCache[key]) return shapeCache[key];
  const raw = SHAPES[key] || genericShape(groups);
  const atoms = raw.map(([el, x, y]) => ({ el, x, y }));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  atoms.forEach(a => { const r = R_(a.el); x0 = Math.min(x0, a.x - r); x1 = Math.max(x1, a.x + r); y0 = Math.min(y0, a.y - r); y1 = Math.max(y1, a.y + r); });
  return (shapeCache[key] = { atoms, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
}

// ───────────────────── 상태 ─────────────────────
const G = { // 반응과 상관없는 기록
  runs: 0, unbalancedRunTried: false, subscriptTried: false, changedFormula: '', hintsUsed: 0, hintIdx: 0,
};
const STATES = {};
function freshState(rx, keep) {
  const cards = [...rx.slots.map(s => ({ key: s.k, name: SPECIES[s.k].name, side: s.side })), ...(rx.extra || []).map(e => ({ key: e.key, name: e.name, side: null }))];
  return {
    step: 1, placed: {}, cards: keep ? keep.cards : shuffle(cards), chosen: rx.slots.map(() => false),
    choiceOrder: keep ? keep.choiceOrder : rx.slots.map(s => shuffle(SPECIES[s.k].choices)),
    coefs: rx.slots.map(() => 1), groups: rx.slots.map(s => parse(s.k)),
    n: 1, m1: 0, m2: 0, table: null, wasComplete: false, solvedEq: null, prevBal: {},
  };
}
REACTIONS.forEach(rx => { STATES[rx.id] = freshState(rx); });
let curId = 'methane';
const cur = () => REACTIONS.find(r => r.id === curId);
const S = () => STATES[curId];
let paused = false;
let quality = 'high';
let selCard = null;
let run = null; // 반응 애니메이션
let clock = 0;

function elementOrder(rx) {
  const out = [];
  rx.slots.forEach(s => parse(s.k).forEach(([e]) => { if (!out.includes(e)) out.push(e); }));
  return out;
}
const isMolRx = rx => rx.slots.every(s => SPECIES[s.k].mol);

function evalRx() {
  const rx = cur(), st = S();
  const els = elementOrder(rx);
  const L = {}, R = {};
  let molL = 0, molR = 0;
  rx.slots.forEach((s, i) => {
    const cnt = countAtoms(st.groups[i]);
    const m = st.coefs[i] * st.n;
    if (s.side === 'L') molL += m; else molR += m;
    for (const e in cnt) { const t = s.side === 'L' ? L : R; t[e] = (t[e] || 0) + m * cnt[e]; }
  });
  els.forEach(e => { L[e] = L[e] || 0; R[e] = R[e] || 0; });
  const balanced = els.every(e => L[e] === R[e]);
  const g = gcdAll(st.coefs);
  const changed = st.groups.some((gr, i) => fstr(gr) !== rx.slots[i].k);
  return { els, L, R, molL, molR, balanced, g, simplest: g === 1, changed, complete: balanced && g === 1 && !changed };
}

function eqText(withHTML) {
  const rx = cur(), st = S();
  const part = side => rx.slots.map((s, i) => ({ s, i })).filter(o => o.s.side === side).map(({ i }) => {
    const c = st.coefs[i];
    const f = withHTML ? fHTML(st.groups[i]) : fU(st.groups[i]);
    return (c > 1 ? (withHTML ? `<span class="co">${c}</span>` : c) : '') + f;
  }).join(' + ');
  return part('L') + ' → ' + part('R');
}

// ───────────────────── SimBridge ─────────────────────
let bridgeTimer = null;
function buildState() {
  const rx = cur(), st = S(), ev = evalRx();
  const solved = REACTIONS.filter(r => STATES[r.id].solvedEq);
  const atomStr = side => ev.els.map(e => `${e}:${side[e]}`).join(',');
  return {
    reaction: rx.id, step: st.step, coefs: st.coefs.join(','), equation: eqText(false),
    balanced: ev.balanced, simplest: ev.simplest, formulaChanged: ev.changed,
    subscriptTried: G.subscriptTried, changedFormula: G.changedFormula,
    atomsLeft: atomStr(ev.L), atomsRight: atomStr(ev.R), moleculesLeft: ev.molL, moleculesRight: ev.molR,
    runs: G.runs, unbalancedRunTried: G.unbalancedRunTried, runCount: st.n,
    lastRun: G.lastRun || '', solved: solved.map(r => r.id).join(','), solvedEquations: solved.map(r => STATES[r.id].solvedEq).join(' / '),
    step1Mistakes: st.m1, step2Mistakes: st.m2, hintsUsed: G.hintsUsed,
  };
}
function pushState(now) {
  clearTimeout(bridgeTimer);
  if (now) { window.SimBridge.setState(buildState()); return; }
  bridgeTimer = setTimeout(() => window.SimBridge.setState(buildState()), 150);
}

// ───────────────────── 왼쪽 열 ─────────────────────
function renderList() {
  const box = $('#list');
  if (!box.children.length) box.innerHTML = REACTIONS.map(rx => `<button class="rx" data-rx="${rx.id}"><span class="rn">${rx.name}<span class="ck"></span></span><span class="re" hidden></span></button>`).join('');
  REACTIONS.forEach(rx => {
    const st = STATES[rx.id], b = box.querySelector(`[data-rx="${rx.id}"]`);
    b.classList.toggle('solved', !!st.solvedEq);
    b.setAttribute('aria-current', String(rx.id === curId));
    b.querySelector('.ck').textContent = st.solvedEq ? '✓' : '';
    const re = b.querySelector('.re'); re.hidden = !st.solvedEq; re.textContent = st.solvedEq || '';
  });
}
$('#list').addEventListener('click', e => {
  const b = e.target.closest('.rx'); if (!b || locked()) return;
  if (b.dataset.rx === curId) { sfx.soft(); toast(`지금 '${cur().name}' 반응을 하고 있어요`); return; }
  selectReaction(b.dataset.rx);
});
function selectReaction(id) {
  curId = id; run = null; selCard = null; closePop();
  sfx.soft(); setEqMsg('');
  $('#hintText').textContent = '';
  renderAll(true);
}

const STEP_NAMES = ['이름과 기호로 나타내기', '화학식으로 나타내기', '계수 맞추기'];
function renderSteps() {
  const st = S();
  const done3 = !!st.solvedEq && evalRx().complete;
  $('#steps').innerHTML = STEP_NAMES.map((n, i) => {
    const k = i + 1; const done = k < st.step || (k === 3 && done3);
    const cls = done ? 'done' : k === st.step ? 'now' : '';
    return `<li class="${cls}" aria-label="${k}단계 ${n}"><span class="no">${done ? '✓' : k}</span>${n}</li>`;
  }).join('');
}
const TIPS = [
  '이름 카드를 끌어 놓거나, 카드를 누른 뒤 칸을 눌러요. 반응물질은 화살표 왼쪽, 생성물질은 오른쪽이에요.',
  '분자 모형 속 원자의 종류와 개수를 세어 알맞은 화학식을 골라요.',
  '[−] [+]로 계수를 바꿔 화살표 양쪽 원자의 종류와 개수를 맞춰요. 원소 기호를 누르면 아래 첨자도 바꿔 볼 수 있어요.',
];
function renderSituation() {
  $('#sitText').textContent = cur().text;
  $('#sitTip').textContent = TIPS[S().step - 1];
}

// ───────────────────── 반응식 줄 ─────────────────────
function setHTML(el, html) { if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } }
function setEqMsg(text, cls = '') { const m = $('#eqMsg'); m.textContent = text; m.className = cls; }
function renderEq() {
  const rx = cur(), st = S();
  $('#eqStep').textContent = `${st.step}단계`;
  const body = $('#eqBody');
  if (st.step === 1) {
    const pool = st.cards.filter(c => !st.placed[c.key]);
    const zone = side => {
      const inside = rx.slots.filter(s => s.side === side && st.placed[s.k] === side);
      const label = side === 'L' ? '반응물질 (반응 전 물질)' : '생성물질 (반응으로 생긴 물질)';
      const html = inside.length ? inside.map(s => `<span class="pc">${SPECIES[s.k].name}</span>`).join('<span class="plus">+</span>') : '<span class="zph">여기에 놓아요</span>';
      return `<button class="zone ${side}" data-side="${side}" aria-label="${label} 칸"><span class="zl">${label}</span><span class="zin">${html}</span></button>`;
    };
    setHTML(body, `<div class="pool" id="pool">${pool.length ? pool.map(c => `<button class="ncard${selCard === c.key ? ' sel' : ''}" data-card="${c.key}">${c.name}</button>`).join('') : '<span class="pool-empty">모든 물질 카드를 놓았어요</span>'}</div>
      <div class="zones">${zone('L')}<span class="arrow">→</span>${zone('R')}</div>`);
    if (!$('#eqMsg').textContent) setEqMsg('이름 카드를 반응물질 칸과 생성물질 칸에 놓아 보세요.');
  } else {
    const parts = [];
    rx.slots.forEach((s, i) => {
      if (i > 0) parts.push(rx.slots[i - 1].side !== s.side ? '<span class="arrow">→</span>' : '<span class="plus">+</span>');
      parts.push(st.step === 2 ? slot2HTML(i) : slot3HTML(i));
    });
    setHTML(body, `<div class="eqline">${parts.join('')}</div>`);
    if (st.step === 2) { drawMinis(); if (!$('#eqMsg').textContent) setEqMsg('분자 모형을 보고 화학식을 골라 보세요.'); }
    if (st.step === 3) { updateEq(); if (!$('#eqMsg').textContent) setEqMsg('계수를 바꿔 화살표 양쪽 원자 수를 맞춰 보세요.'); }
  }
}
function slot2HTML(i) {
  const rx = cur(), st = S(), s = rx.slots[i];
  const sp = SPECIES[s.k];
  const inner = st.chosen[i]
    ? `<span class="fcard">${fHTML(parse(s.k))}</span>`
    : `<div class="choices">${st.choiceOrder[i].map(c => `<button class="btn" data-choice="${c}" data-i="${i}" aria-label="${sp.name}의 화학식 ${c}">${fHTML(parse(c))}</button>`).join('')}</div>`;
  return `<div class="slot ${s.side}" data-i="${i}"><span class="sname">${sp.name}</span><canvas class="mini" data-i="${i}" width="184" height="100"></canvas>${inner}</div>`;
}
function slot3HTML(i) {
  const s = cur().slots[i];
  return `<div class="slot ${s.side}" data-i="${i}">
    <div class="coef"><button class="btn" data-cm="${i}" aria-label="${SPECIES[s.k].name} 계수 줄이기">−</button>
      <span class="cval" data-cv="${i}" role="spinbutton" tabindex="0" aria-valuemin="1" aria-valuemax="6" aria-label="${SPECIES[s.k].name}의 계수"></span>
      <button class="btn" data-cp="${i}" aria-label="${SPECIES[s.k].name} 계수 늘리기">+</button></div>
    <span class="fcard" data-fc="${i}"></span>
    <span class="sname" data-sn="${i}"></span>
    <span class="omit" data-om="${i}"></span></div>`;
}
function updateEq() {
  const rx = cur(), st = S();
  if (st.step !== 3) return;
  rx.slots.forEach((s, i) => {
    const c = st.coefs[i];
    const cv = document.querySelector(`[data-cv="${i}"]`); if (!cv) return;
    cv.textContent = c; cv.classList.toggle('one', c === 1); cv.setAttribute('aria-valuenow', c);
    document.querySelector(`[data-om="${i}"]`).textContent = c === 1 ? '1은 생략' : '';
    document.querySelector(`[data-cm="${i}"]`).disabled = c <= 1;
    document.querySelector(`[data-cp="${i}"]`).disabled = c >= 6;
    const fc = document.querySelector(`[data-fc="${i}"]`);
    const key = fstr(st.groups[i]);
    if (fc.dataset.key !== key) {
      fc.dataset.key = key;
      fc.innerHTML = st.groups[i].map(([e, n], gi) => `<button class="elbtn${parse(s.k)[gi][1] !== n ? ' chg' : ''}" data-el="${i}:${gi}" title="${ELEM[e].name} 원자 수 바꿔 보기" aria-label="${fU(st.groups[i])}의 ${ELEM[e].name} 원자 수 바꿔 보기">${e}${n > 1 ? `<sub>${n}</sub>` : ''}</button>`).join('');
    }
    const changed = key !== s.k;
    fc.classList.toggle('changed', changed);
    const sn = document.querySelector(`[data-sn="${i}"]`);
    if (changed) {
      const nm = nameOfFormula(key);
      sn.textContent = nm ? `다른 물질! ${nm}(${fU(st.groups[i])})` : '다른 물질! 이 반응에 나오지 않는 물질';
      sn.classList.add('bad');
    } else { sn.textContent = SPECIES[s.k].name; sn.classList.remove('bad'); }
  });
}

// 2단계 미니 모형
const miniFlash = {};
function drawMinis(t = performance.now()) {
  document.querySelectorAll('canvas.mini').forEach(c => {
    const i = +c.dataset.i, g = c.getContext('2d');
    const sh = shapeOf(parse(cur().slots[i].k));
    g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, 92, 50);
    const s = Math.min(84 / sh.w, 44 / sh.h, 20);
    const ox = 46 - sh.cx * s, oy = 25 - sh.cy * s;
    const fl = miniFlash[i];
    sh.atoms.forEach((a, k) => {
      drawAtom(g, ox + a.x * s, oy + a.y * s, R_(a.el) * s, a.el, 1, true);
      if (fl) {
        const idx = Math.floor((t - fl) / 260);
        if (idx === k) { g.strokeStyle = '#f0b429'; g.lineWidth = 3; g.beginPath(); g.arc(ox + a.x * s, oy + a.y * s, R_(a.el) * s + 2, 0, Math.PI * 2); g.stroke(); }
      }
    });
  });
}
function flashMini(i) {
  miniFlash[i] = performance.now();
  const n = shapeOf(parse(cur().slots[i].k)).atoms.length;
  const loop = t => {
    if (!miniFlash[i]) return;
    drawMinis(t);
    if (t - miniFlash[i] < n * 260 + 60) requestAnimationFrame(loop);
    else { delete miniFlash[i]; drawMinis(); }
  };
  requestAnimationFrame(loop);
}

// 1단계: 카드 놓기 (끌기 + 누르기)
function tryPlace(key, side) {
  const rx = cur(), st = S();
  const card = st.cards.find(c => c.key === key); if (!card) return;
  selCard = null;
  if (card.side === side) {
    st.placed[key] = side; sfx.place();
    setEqMsg(`${card.name}: ${side === 'L' ? '반응물질' : '생성물질'} 칸에 놓았어요.`, 'good');
    const all = rx.slots.every(s => st.placed[s.k] === s.side);
    renderEq(); refresh();
    if (all) {
      setEqMsg('잘했어요! 여러 가지 물질은 +로 이어요. 이제 화학식으로 나타내 봐요.', 'good');
      setTimeout(() => { if (S() === st && st.step === 1) goStep(2); }, 900);
    }
  } else {
    st.m1++; sfx.wrongDrop();
    let why;
    if (!card.side) why = '가열은 물질이 아니라서 반응식에 쓰지 않아요.';
    else if (card.side === 'R') why = `${card.name}은(는) 반응으로 새로 생긴 물질이에요. 화살표는 반응물질이 생성물질로 변하는 방향이에요.`;
    else why = `${card.name}은(는) 반응 전에 있던 물질이에요. 화살표 왼쪽에는 반응 전 물질을 써요.`;
    setEqMsg(why, 'bad');
    renderEq();
    const b = document.querySelector(`.ncard[data-card="${key}"]`);
    if (b) { b.classList.add('shake'); }
    pushState();
  }
}
const ghost = $('#dragGhost');
let drag = null;
$('#eqBody').addEventListener('pointerdown', e => {
  const c = e.target.closest('.ncard'); if (!c || locked()) return;
  drag = { key: c.dataset.card, el: c, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
  c.setPointerCapture(e.pointerId);
});
$('#eqBody').addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
    drag.moved = true; sfx.pick();
    ghost.textContent = drag.el.textContent; ghost.style.display = 'block'; drag.el.classList.add('lifted');
  }
  if (drag.moved) {
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    const z = zoneAt(e.clientX, e.clientY);
    document.querySelectorAll('.zone').forEach(zz => zz.classList.toggle('hot', zz === z));
  }
});
const zoneAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('.zone'); };
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  ghost.style.display = 'none';
  document.querySelectorAll('.zone').forEach(zz => zz.classList.remove('hot'));
  d.el.classList.remove('lifted');
  if (d.moved) {
    const z = e.type === 'pointerup' ? zoneAt(e.clientX, e.clientY) : null;
    if (z) tryPlace(d.key, z.dataset.side);
    else { sfx.wrongDrop(); setEqMsg('칸 안에 놓아야 해요.'); }
    d.el.dataset.noclick = '1';
    setTimeout(() => { delete d.el.dataset.noclick; }, 50);
  }
}
$('#eqBody').addEventListener('pointerup', endDrag);
$('#eqBody').addEventListener('pointercancel', endDrag);

$('#eqBody').addEventListener('click', e => {
  if (locked()) return;
  const st = S();
  const card = e.target.closest('.ncard');
  if (card) {
    if (card.dataset.noclick) return;
    selCard = selCard === card.dataset.card ? null : card.dataset.card;
    if (selCard) { sfx.pick(); setEqMsg(`'${card.textContent}' 카드를 골랐어요. 놓을 칸을 눌러요.`); } else sfx.soft();
    document.querySelectorAll('.ncard').forEach(b => b.classList.toggle('sel', b.dataset.card === selCard));
    return;
  }
  const zone = e.target.closest('.zone');
  if (zone) {
    if (selCard) tryPlace(selCard, zone.dataset.side);
    else { sfx.soft(); setEqMsg('먼저 위의 이름 카드를 누르거나 끌어 오세요.'); zone.classList.add('hot'); setTimeout(() => zone.classList.remove('hot'), 400); }
    return;
  }
  const ch = e.target.closest('[data-choice]');
  if (ch && st.step === 2) {
    const i = +ch.dataset.i, s = cur().slots[i];
    if (ch.dataset.choice === s.k) {
      st.chosen[i] = true; sfx.ding();
      setEqMsg(`맞아요! ${SPECIES[s.k].name}의 화학식은 ${fU(parse(s.k))}이에요.`, 'good');
      renderEq(); refresh();
      if (st.chosen.every(Boolean)) {
        setEqMsg('화학식을 모두 골랐어요. 이제 계수를 맞춰 봐요.', 'good');
        setTimeout(() => { if (S() === st && st.step === 2) goStep(3); }, 900);
      }
    } else {
      st.m2++; sfx.buzz();
      setEqMsg('모형에서 원자 수를 다시 세어 봐요.', 'bad');
      ch.classList.remove('no'); void ch.offsetWidth; ch.classList.add('no');
      flashMini(i); pushState();
    }
    return;
  }
  const cm = e.target.closest('[data-cm]'), cp = e.target.closest('[data-cp]');
  if (cm) return changeCoef(+cm.dataset.cm, -1);
  if (cp) return changeCoef(+cp.dataset.cp, +1);
  const eb = e.target.closest('[data-el]');
  if (eb) { const [i, gi] = eb.dataset.el.split(':').map(Number); openPop(i, gi, eb); }
});
$('#eqBody').addEventListener('keydown', e => {
  const cv = e.target.closest('[data-cv]'); if (!cv || locked()) return;
  const i = +cv.dataset.cv;
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); changeCoef(i, +1); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); changeCoef(i, -1); }
});

function goStep(k) {
  const st = S(); st.step = k; run = null; sfx.step();
  setEqMsg(k === 2 ? '분자 모형을 보고 화학식을 골라 보세요.' : '계수를 바꿔 화살표 양쪽 원자 수를 맞춰 보세요.');
  renderAll(true);
}

// 3단계: 계수
function changeCoef(i, d) {
  const st = S();
  const v = clamp(st.coefs[i] + d, 1, 6);
  if (v === st.coefs[i]) return;
  st.coefs[i] = v;
  run = null;
  (d > 0 ? sfx.up : sfx.down)();
  const ev = evalRx();
  if (!ev.complete) st.n = 1;
  updateEq();
  const cv = document.querySelector(`[data-cv="${i}"]`);
  if (cv) { cv.classList.remove('bump'); void cv.offsetWidth; cv.classList.add('bump'); }
  refresh();
}

// 아래 첨자 바꿔 보기
const pop = $('#subPop');
let popAt = null;
function openPop(i, gi, anchor) {
  popAt = { i, gi };
  const g = S().groups[i][gi];
  $('#spEl').innerHTML = `<span class="ball" style="${ballStyle(g[0])}">${g[0]}</span>`;
  $('#spVal').textContent = g[1];
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = clamp(r.left + r.width / 2 - pw / 2, 6, innerWidth - pw - 6);
  let y = r.bottom + 8; if (y + ph > innerHeight - 6) y = r.top - ph - 8;
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  sfx.soft();
  $('#spPlus').focus({ preventScroll: true });
}
function closePop() { pop.hidden = true; popAt = null; }
function changeSub(d) {
  if (!popAt || locked()) return;
  const rx = cur(), st = S(); const { i, gi } = popAt;
  const g = st.groups[i][gi];
  const v = clamp(g[1] + d, 1, 4); if (v === g[1]) return;
  st.groups[i] = st.groups[i].map((x, k) => (k === gi ? [x[0], v] : x));
  $('#spVal').textContent = v;
  run = null;
  const key = fstr(st.groups[i]);
  if (key !== rx.slots[i].k) { G.subscriptTried = true; G.changedFormula = fU(st.groups[i]); sfx.warn(); } else sfx.rewind();
  if (!evalRx().complete) st.n = 1;
  updateEq(); refresh();
}
$('#spPlus').addEventListener('click', () => changeSub(+1));
$('#spMinus').addEventListener('click', () => changeSub(-1));
$('#spClose').addEventListener('click', () => { closePop(); sfx.soft(); });
document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('[data-el]')) closePop(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) closePop(); });

$('#btnRevert').addEventListener('click', () => {
  if (locked()) return;
  const rx = cur(), st = S();
  st.groups = rx.slots.map(s => parse(s.k)); run = null; closePop();
  sfx.rewind(); updateEq(); refresh();
});

// ───────────────────── 오른쪽 열 ─────────────────────
const ballStyle = el => { const E = ELEM[el]; return `background: radial-gradient(circle at 35% 32%, ${E.hi}, ${E.color} 55%, ${E.dk}); color: ${E.ink};`; };
let openRow = null;
function renderAtoms() {
  const els = elementOrder(cur());
  const box = $('#atomRows');
  if (box.dataset.key === els.join(',')) {
    box.querySelectorAll('.arow').forEach(b => b.setAttribute('aria-expanded', String(openRow === b.dataset.row)));
    box.querySelectorAll('.adetail').forEach(d => { d.hidden = openRow !== d.dataset.det; });
    return;
  }
  box.dataset.key = els.join(',');
  box.innerHTML = els.map(e => `<button class="arow" data-row="${e}" aria-expanded="${openRow === e}" aria-label="${ELEM[e].name} 원자 수 내역 보기">
      <span class="ball" style="${ballStyle(e)}">${e}</span>
      <span class="track L"><i></i></span><b class="nl">0</b><span class="eqs">=</span><b class="nr">0</b><span class="track R"><i></i></span>
    </button><div class="adetail" data-det="${e}" ${openRow === e ? '' : 'hidden'}></div>`).join('');
}
$('#atomRows').addEventListener('click', e => {
  const b = e.target.closest('.arow'); if (!b || locked()) return;
  openRow = openRow === b.dataset.row ? null : b.dataset.row;
  sfx.soft(); renderAtoms(); updateAtoms();
});
function updateAtoms() {
  const rx = cur(), st = S(), ev = evalRx();
  const on = st.step === 3;
  $('#atomsPanel').classList.toggle('dim', !on);
  const max = Math.max(8, ...ev.els.map(e => Math.max(ev.L[e], ev.R[e])));
  const trackW = (document.querySelector('.track') || { clientWidth: 80 }).clientWidth || 80;
  const u = Math.max(2, Math.min(11, trackW / max));
  ev.els.forEach((e, k) => {
    const row = document.querySelector(`.arow[data-row="${e}"]`); if (!row) return;
    const l = on ? ev.L[e] : 0, r = on ? ev.R[e] : 0;
    row.querySelector('.nl').textContent = on ? l : '-';
    row.querySelector('.nr').textContent = on ? r : '-';
    const eq = row.querySelector('.eqs');
    eq.textContent = !on ? '' : l === r ? '=' : '≠';
    eq.className = 'eqs ' + (!on ? '' : l === r ? 'ok' : 'no');
    row.querySelectorAll('.track i').forEach((bar, j) => { bar.style.setProperty('--u', (u - 1) + 'px'); bar.style.width = (j ? r : l) * u + 'px'; });
    // 원소 하나가 막 균형이 된 순간 '팅'
    const bal = on && l === r;
    if (on && bal && st.prevBal[e] === false) sfx.ting(k);
    st.prevBal[e] = on ? bal : undefined;
    const det = document.querySelector(`[data-det="${e}"]`);
    if (det && !det.hidden) {
      const side = sd => rx.slots.map((s, i) => ({ s, i })).filter(o => o.s.side === sd).map(({ i }) => {
        const c = countAtoms(st.groups[i])[e]; if (!c) return null;
        const m = st.coefs[i] * st.n;
        return `${fU(st.groups[i])} ${m}개 × ${c} = ${m * c}`;
      }).filter(Boolean).join(', ') || '없음';
      det.innerHTML = `<b>${e}(${ELEM[e].name})</b> <span class="bl">반응 전</span> ${side('L')}<br><span class="or">반응 후</span> ${side('R')}`;
    }
  });
  const unit = isMolRx(rx) ? '분자' : '입자';
  $('#totLabel').textContent = `${unit} 수 합계`;
  $('#totL').textContent = on ? `${ev.molL}개` : '-';
  $('#totR').textContent = on ? `${ev.molR}개` : '-';
  $('#totNote').textContent = on && ev.balanced && ev.molL !== ev.molR ? `원자 수는 같지만 ${unit} 수는 달라질 수 있어요.` : '';
}

function renderTable() {
  const rx = cur(), st = S();
  const unit = isMolRx(rx) ? '분자' : '입자';
  $('#tableTitle').textContent = `계수비와 ${unit} 수의 비`;
  const t = st.table;
  if (!t) {
    $('#tableBox').innerHTML = `<div class="tb-empty">${st.step < 3 ? '3단계에서 계수를 맞추고 [반응시키기]를 누르면 표가 채워져요.' : '계수를 맞춘 뒤 [반응시키기]를 누르면 표가 채워져요.'}</div>`;
    return;
  }
  const row = (label, vals) => `<tr><td>${label}</td>${vals.map((v, i) => (i ? '<td class="colon">:</td>' : '') + `<td><b>${v}</b></td>`).join('')}</tr>`;
  const g = gcdAll(t.counts);
  $('#tableBox').innerHTML = `<table class="rt"><thead><tr><th>물질</th>${t.formulas.map((f, i) => (i ? '<th></th>' : '') + `<th>${f}</th>`).join('')}</tr></thead><tbody>
    ${row('계수비', t.coefs)}${row(`${unit} 수(개)`, t.counts)}${row(`${unit} 수의 비`, t.counts.map(c => c / g))}</tbody></table>
    <div class="tb-note">반응 ${t.n}번 했을 때의 ${unit} 수예요.${unit === '입자' ? " 구리·염화 마그네슘처럼 분자가 아닌 물질은 '입자'로 세어요." : ''}</div>`;
}

function updateResult() {
  const st = S(), ev = evalRx();
  const fe = $('#finalEq'), vd = $('#verdict');
  $('#btnRevert').hidden = !(st.step === 3 && ev.changed);
  if (st.step < 3) {
    fe.innerHTML = st.step === 1 ? '<span style="color:#9aa3b2">1단계 진행 중</span>' : '<span style="color:#9aa3b2">2단계 진행 중</span>';
    fe.className = 'final-eq';
    vd.textContent = st.step === 1 ? '반응물질과 생성물질을 먼저 구분해요.' : '화학식을 모두 고르면 계수를 맞출 수 있어요.';
    vd.className = 'verdict';
    return;
  }
  fe.innerHTML = eqText(true);
  fe.className = 'final-eq' + (ev.complete ? ' ok' : '');
  let msg, cls;
  if (ev.changed) {
    const i = S().groups.findIndex((gr, k) => fstr(gr) !== cur().slots[k].k);
    const orig = SPECIES[cur().slots[i].k].name;
    msg = ev.balanced ? `원자 수는 같지만 ${orig}이(가) 아니라 다른 물질의 반응식이에요. 화학식을 바꾸면 전혀 다른 물질이 돼요. 계수만 바꿔야 해요.`
      : '화학식을 바꾸면 전혀 다른 물질이 돼요. 계수만 바꿔야 해요.';
    cls = 'bad';
  } else if (!ev.balanced) {
    const e = ev.els.find(x => ev.L[x] !== ev.R[x]);
    msg = `${e}(${ELEM[e].name}) 원자 수가 달라요 (반응 전 ${ev.L[e]}개, 반응 후 ${ev.R[e]}개).`; cls = 'warn';
  } else if (ev.g > 1) {
    msg = `원자 수는 같아요. 그런데 모든 계수를 ${ev.g}(으)로 나눌 수 있어요 — 가장 간단한 정수비로 나타내요.`; cls = 'warn';
  } else { msg = '완성! 화살표 양쪽 원자의 종류와 개수가 같아요.'; cls = 'good'; }
  vd.textContent = msg; vd.className = 'verdict ' + cls;
}

const HINTS = [
  '한 물질에만 들어 있는 원자부터 맞춰 봐요.',
  'O₂처럼 원소 하나로 된 물질은 마지막에 맞추면 쉬워요.',
  '원자 수 세기에서 ≠ 인 원소를 찾고, 그 원자가 든 물질의 계수를 바꿔 봐요.',
  '계수를 바꾸면 그 물질 속 모든 원자 수가 함께 늘어나요. 원소 줄을 누르면 내역이 보여요.',
];
$('#btnHint').addEventListener('click', () => {
  if (locked()) return;
  G.hintsUsed++;
  const st = S();
  $('#hintText').textContent = st.step < 3 ? `💡 ${TIPS[st.step - 1]}` : `💡 ${HINTS[G.hintIdx++ % HINTS.length]}`;
  sfx.soft(); pushState();
});

function updateCtrl() {
  const st = S(), ev = evalRx();
  const on = st.step === 3;
  $('#ctrl').classList.toggle('off', !on);
  document.querySelectorAll('#runSeg button').forEach(b => {
    b.disabled = !on || !ev.complete;
    b.setAttribute('aria-pressed', String(+b.dataset.n === st.n));
  });
  $('#runNote').textContent = on && !ev.complete ? '번 (계수를 맞추면 켜져요)' : '번';
  $('#btnRun').disabled = !on || (run && !run.done);
  $('#btnBack').disabled = !on || !run;
}
$('#runSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled || locked()) return;
  const st = S(); const n = +b.dataset.n; if (n === st.n) return;
  st.n = n; run = null; sfx.up(); refresh();
});
$('#btnRun').addEventListener('click', () => { if (!locked()) startRun(); });
$('#btnBack').addEventListener('click', () => {
  if (locked() || !run) return;
  run = null; sfx.rewind(); refresh();
});

// ───────────────────── 완성 판정 ─────────────────────
function checkComplete() {
  const st = S(), ev = evalRx();
  if (st.step !== 3) return;
  if (ev.complete && !st.wasComplete) {
    // 반응 횟수 1 기준 반응식을 기록 (n은 계수와 상관없음)
    st.solvedEq = eqText(false);
    sfx.complete();
    renderList();
  }
  st.wasComplete = ev.complete;
}

function refresh() {
  checkComplete();
  renderSteps(); renderSituation(); updateAtoms(); renderTable(); updateResult(); updateCtrl();
  syncInstances(false);
  kick();
  pushState();
}
function renderAll(immediate) {
  const st = S();
  renderList(); renderEq(); renderAtoms();
  checkComplete();
  renderSteps(); renderSituation(); updateAtoms(); renderTable(); updateResult(); updateCtrl();
  layoutDirty = true; syncInstances(immediate); kick();
  pushState();
}

// ───────────────────── 모형 상자 (Canvas 2D) ─────────────────────
const cv = $('#stage'), ctx = cv.getContext('2d');
let CW = 600, CH = 300, DPR = 1, layoutDirty = true, LAY = null;
function resize() {
  const r = $('#stageWrap').getBoundingClientRect();
  CW = Math.max(200, r.width); CH = Math.max(140, r.height);
  DPR = quality === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
  layoutDirty = true; syncInstances(true); kick();
}
new ResizeObserver(resize).observe($('#stageWrap'));

function visibleCount(i) {
  const st = S(), s = cur().slots[i];
  if (st.step === 1) return st.placed[s.k] === s.side ? 1 : 0;
  if (st.step === 2) return 1;
  return st.coefs[i] * st.n;
}
function fit(k, sh, x, y, w, h) {
  let best = { s: 0, cols: 1, rows: 1 };
  for (let cols = 1; cols <= Math.max(1, k); cols++) {
    const rows = Math.ceil(k / cols);
    const s = Math.min(w / cols / (sh.w + 0.6), h / rows / (sh.h + 0.6));
    if (s > best.s) best = { s, cols, rows };
  }
  const s = Math.min(best.s, 22);
  const cw = (sh.w + 0.6) * s * 1.08, ch = (sh.h + 0.6) * s * 1.08;
  const pos = [];
  for (let j = 0; j < k; j++) {
    const r = Math.floor(j / best.cols), c = j % best.cols;
    const inRow = Math.min(best.cols, k - r * best.cols);
    const gx = x + w / 2 + (c - (inRow - 1) / 2) * cw;
    const gy = y + h / 2 + (r - (best.rows - 1) / 2) * ch;
    pos.push({ x: gx - sh.cx * s, y: gy - sh.cy * s });
  }
  return { s, pos };
}
function layout() {
  const rx = cur(), st = S();
  const top = 30, head = 24, foot = 22;
  const stripH = st.step === 3 ? 46 : 0;
  const arrowW = clamp(CW * 0.1, 46, 86);
  const sideW = (CW - arrowW - 24) / 2;
  const sideH = CH - top - stripH - 10;
  const regions = { L: { x: 12, y: top, w: sideW, h: sideH }, R: { x: 12 + sideW + arrowW, y: top, w: sideW, h: sideH } };
  const cols = [];
  ['L', 'R'].forEach(side => {
    const idx = rx.slots.map((s, i) => ({ s, i })).filter(o => o.s.side === side).map(o => o.i);
    const reg = regions[side];
    const cwid = reg.w / idx.length;
    idx.forEach((i, j) => {
      const box = { x: reg.x + j * cwid + 4, y: reg.y + head, w: cwid - 8, h: reg.h - head - foot };
      const sh = shapeOf(st.groups[i]);
      const k = visibleCount(i);
      // 계수 6까지 늘어도 모형 크기가 들쭉날쭉하지 않게, 크기는 '최소 4개'가 들어갈 크기 이하로
      const f = fit(Math.max(k, 1), sh, box.x, box.y, box.w, box.h);
      const f4 = fit(Math.max(k, Math.min(4, st.step === 3 ? 4 : 1)), sh, box.x, box.y, box.w, box.h);
      const s = Math.min(f.s, f4.s);
      const ff = s < f.s ? fitWith(k, sh, box, s) : f;
      cols[i] = { i, side, box, s, pos: ff.pos, k, sh };
    });
  });
  const strip = { x: 12, y: CH - stripH - 4, w: CW - 24, h: stripH };
  const arrow = { x1: 12 + sideW + 8, x2: 12 + sideW + arrowW - 8, y: top + sideH / 2 };
  return { regions, cols, strip, arrow };
}
function fitWith(k, sh, box, s) {
  let best = null;
  for (let cols = 1; cols <= Math.max(1, k); cols++) {
    const rows = Math.ceil(k / cols);
    if ((sh.w + 0.6) * s * cols <= box.w + 0.5 && (sh.h + 0.6) * s * rows <= box.h + 0.5) { best = { cols, rows }; break; }
  }
  if (!best) return fit(k, sh, box.x, box.y, box.w, box.h);
  const cw = (sh.w + 0.6) * s * 1.06, ch = (sh.h + 0.6) * s * 1.06;
  const pos = [];
  for (let j = 0; j < k; j++) {
    const r = Math.floor(j / best.cols), c = j % best.cols;
    const inRow = Math.min(best.cols, k - r * best.cols);
    pos.push({ x: box.x + box.w / 2 + (c - (inRow - 1) / 2) * cw - sh.cx * s, y: box.y + box.h / 2 + (r - (best.rows - 1) / 2) * ch - sh.cy * s });
  }
  return { s, pos };
}

// 분자 모형 인스턴스 (계수 변화 때 생기고 사라지는 애니메이션)
let INST = [];
let instKey = '';
function syncInstances(immediate) {
  LAY = layout(); layoutDirty = false;
  const key = curId + ':' + S().step;
  if (key !== instKey) { INST = []; instKey = key; immediate = true; }
  LAY.cols.forEach(col => {
    const i = col.i;
    INST[i] = INST[i] || [];
    const alive = INST[i].filter(o => o.dying == null);
    while (alive.length < col.k) {
      const p = col.pos[alive.length];
      const o = { x: p.x, y: p.y, tx: p.x, ty: p.y, born: immediate ? -99 : clock, dying: null, s: col.s };
      INST[i].push(o); alive.push(o);
    }
    while (alive.length > col.k) { const o = alive.pop(); o.dying = clock; }
    alive.forEach((o, j) => { o.tx = col.pos[j].x; o.ty = col.pos[j].y; if (immediate) { o.x = o.tx; o.y = o.ty; o.s = col.s; } });
    if (immediate) INST[i] = alive;
  });
}

function drawAtom(g, x, y, r, el, alpha = 1, hiQ = quality === 'high') {
  const E = ELEM[el] || { color: '#999', hi: '#ddd', dk: '#555', ink: '#fff' };
  if (r <= 0.5) return;
  g.globalAlpha = alpha;
  if (hiQ) {
    g.fillStyle = 'rgba(20,30,50,.16)';
    g.beginPath(); g.ellipse(x + r * 0.12, y + r * 0.2, r, r * 0.96, 0, 0, Math.PI * 2); g.fill();
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
    gr.addColorStop(0, E.hi); gr.addColorStop(0.55, E.color); gr.addColorStop(1, E.dk);
    g.fillStyle = gr;
  } else g.fillStyle = E.color;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = E.dk; g.lineWidth = 1; g.stroke();
  if (r >= 7) {
    g.fillStyle = E.ink; g.font = `800 ${Math.round(Math.max(9, r * (el.length > 1 ? 0.72 : 0.9)))}px ${getComputedStyle(document.body).fontFamily}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(el, x, y + 0.5);
  }
  g.globalAlpha = 1;
}
function drawGhostAtom(x, y, r, alpha = 0.35, q = false) {
  ctx.globalAlpha = alpha;
  ctx.setLineDash([4, 3]); ctx.strokeStyle = '#8a95a8'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  if (q) { ctx.fillStyle = '#8a95a8'; ctx.font = `800 ${Math.round(r)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x, y + 1); }
  ctx.globalAlpha = 1;
}
function drawMolecule(groups, x, y, s, alpha = 1, scale = 1) {
  const sh = shapeOf(groups);
  const cx = x + sh.cx * s, cy = y + sh.cy * s;
  sh.atoms.forEach(a => drawAtom(ctx, cx + (a.x - sh.cx) * s * scale, cy + (a.y - sh.cy) * s * scale, R_(a.el) * s * scale, a.el, alpha));
}
function drawGhostMolecule(groups, x, y, s, alpha) {
  shapeOf(groups).atoms.forEach(a => drawGhostAtom(x + a.x * s, y + a.y * s, R_(a.el) * s, alpha));
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

function label(rx, st, i) {
  const s = rx.slots[i];
  if (st.step === 1) return st.placed[s.k] ? SPECIES[s.k].name : '';
  if (st.step === 2) return st.chosen[i] ? fU(parse(s.k)) : SPECIES[s.k].name;
  return fU(st.groups[i]);
}

function draw() {
  const rx = cur(), st = S();
  if (layoutDirty || !LAY) syncInstances(true);
  const L = LAY;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, CW, CH);
  const font = getComputedStyle(document.body).fontFamily;
  // 영역
  [['L', '#eef4ff', '#c9d9f7', '반응 전'], ['R', '#fff4e8', '#f3d3b0', '반응 후']].forEach(([k, bg, bd, t]) => {
    const r = L.regions[k];
    ctx.fillStyle = bg; roundRect(r.x, r.y - 22, r.w, r.h + 22, 12); ctx.fill();
    ctx.strokeStyle = bd; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = k === 'L' ? '#1e56c4' : '#b35a0c'; ctx.font = `800 14px ${font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(t, r.x + 10, r.y - 9);
  });
  // 열 머리·꼬리
  L.cols.forEach(col => {
    const b = col.box;
    if (st.step > 1 && rx.slots.filter(s => s.side === col.side).length > 1 && rx.slots.findIndex((s, i) => s.side === col.side && i < col.i) >= 0) {
      ctx.strokeStyle = 'rgba(120,130,150,.25)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(b.x - 4, b.y); ctx.lineTo(b.x - 4, b.y + b.h + 14); ctx.stroke(); ctx.setLineDash([]);
    }
    const lb = label(rx, st, col.i);
    ctx.fillStyle = '#1d2433'; ctx.font = `800 16px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (lb) ctx.fillText(lb, b.x + b.w / 2, b.y - 8);
    if (st.step === 3) {
      ctx.fillStyle = col.side === 'L' ? '#1e56c4' : '#b35a0c'; ctx.font = `700 13.5px ${font}`;
      const holes = run && run.done && col.side === 'R' && run.slots.some(sl => sl.col === col.i && !sl.filled);
      const doneTxt = holes ? `${col.k}개 자리 (빈자리 있음)` : run && run.done && col.side === 'R' ? `${col.k}개 생성` : run && run.done ? `${col.k}개 반응` : `${col.k}개`;
      ctx.fillText(doneTxt, b.x + b.w / 2, b.y + b.h + 10);
    }
  });
  // 화살표
  const a = L.arrow; const glow = run && !run.done ? (run.t / 2.4) : -1;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#4a5870'; ctx.fillStyle = '#4a5870'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(a.x1, a.y); ctx.lineTo(a.x2 - 12, a.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(a.x2, a.y); ctx.lineTo(a.x2 - 18, a.y - 13); ctx.lineTo(a.x2 - 18, a.y + 13); ctx.closePath(); ctx.fill();
  if (glow >= 0) {
    const gx = lerp(a.x1 - 20, a.x2 + 20, glow);
    const gr = ctx.createRadialGradient(gx, a.y, 1, gx, a.y, 26);
    gr.addColorStop(0, 'rgba(255,230,120,.95)'); gr.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = gr; ctx.fillRect(a.x1 - 30, a.y - 28, a.x2 - a.x1 + 60, 56);
  }
  // 남은 원자 칸
  if (st.step === 3) {
    const s = L.strip;
    ctx.fillStyle = '#f5f6f9'; roundRect(s.x, s.y, s.w, s.h, 10); ctx.fill();
    ctx.strokeStyle = '#d6dce6'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#5b6577'; ctx.font = `700 13px ${font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('남은 원자', s.x + 12, s.y + s.h / 2);
    if (!run || !run.done || !run.left.length) {
      ctx.fillStyle = '#9aa3b2'; ctx.font = `500 12.5px ${font}`;
      ctx.fillText(run && run.done ? '없음 — 모든 원자가 생성물질로 갔어요' : '반응시키면 짝이 없는 원자가 여기로 와요', s.x + 84, s.y + s.h / 2);
    }
  }
  // 1단계: 아직 놓지 않은 칸 안내
  if (st.step === 1) {
    ['L', 'R'].forEach(side => {
      if (L.cols.some(c => c.side === side && c.k > 0)) return;
      const r = L.regions[side];
      ctx.fillStyle = '#8a95a8'; ctx.font = `600 14px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(side === 'L' ? '반응물질 카드를 놓으면' : '생성물질 카드를 놓으면', r.x + r.w / 2, r.y + r.h / 2 - 10);
      ctx.fillText('분자 모형이 여기에 나와요', r.x + r.w / 2, r.y + r.h / 2 + 12);
    });
  }
  // 분자
  if (!run) {
    L.cols.forEach(col => {
      const i = col.i;
      (INST[i] || []).forEach(o => {
        let sc = 1, al = 1;
        if (o.dying != null) { const k = clamp((clock - o.dying) / 0.25, 0, 1); sc = 1 - ease.outCubic(k); al = 1 - k; }
        else { const k = clamp((clock - o.born) / 0.25, 0, 1); sc = outBack(k); }
        const ghostR = st.step === 3 && col.side === 'R';
        if (ghostR) drawGhostMolecule(st.groups[i], o.x, o.y, o.s, 0.5 * al * Math.min(1, sc));
        else drawMolecule(st.groups[i], o.x, o.y, o.s, al, Math.max(0, sc));
      });
    });
    if (st.step === 3) {
      const r = L.regions.R;
      ctx.fillStyle = 'rgba(179,90,12,.75)'; ctx.font = `600 12.5px ${font}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('점선 = 반응시키면 생길 자리', r.x + r.w - 10, r.y - 9);
    }
  } else drawRun(font);
}
const outBack = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

// ───────────────────── 반응 애니메이션 ─────────────────────
function startRun() {
  const rx = cur(), st = S();
  if (st.step !== 3 || (run && !run.done)) return;
  const ev = evalRx();
  syncInstances(true);
  const lay = LAY;
  const atoms = [], slots = [], ghostsL = [];
  lay.cols.forEach(col => {
    const sh = shapeOf(st.groups[col.i]);
    col.pos.forEach(p => {
      const mc = { x: p.x + sh.cx * col.s, y: p.y + sh.cy * col.s };
      sh.atoms.forEach(a => {
        const o = { el: a.el, x: p.x + a.x * col.s, y: p.y + a.y * col.s, r: R_(a.el) * col.s, mc };
        if (col.side === 'L') { atoms.push(o); ghostsL.push(o); } else slots.push({ ...o, filled: false, col: col.i });
      });
    });
  });
  // 원소별로 반응 전 원자 → 반응 후 빈자리 짝짓기 (순서대로)
  const free = {}; slots.forEach((s, k) => { (free[s.el] = free[s.el] || []).push(k); });
  const left = [];
  atoms.forEach(at => {
    const dx = at.x - at.mc.x, dy = at.y - at.mc.y, d = Math.hypot(dx, dy) || 1;
    const ang = d > 1 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
    at.sx = at.x + Math.cos(ang) * (at.r * 0.6 + 5); at.sy = at.y + Math.sin(ang) * (at.r * 0.6 + 5);
    at.delay = Math.random() * 0.2;
    const q = free[at.el];
    if (q && q.length) {
      const k = q.shift(); const sl = slots[k]; sl.filled = true; at.slot = k;
      at.tx = sl.x; at.ty = sl.y; at.tr = sl.r;
      const ddx = sl.x - sl.mc.x, ddy = sl.y - sl.mc.y, dd = Math.hypot(ddx, ddy);
      const an2 = dd > 1 ? Math.atan2(ddy, ddx) : ang;
      at.ox = Math.cos(an2) * (sl.r * 0.5 + 4); at.oy = Math.sin(an2) * (sl.r * 0.5 + 4);
      at.order = k;
    } else { left.push(at); at.order = 1e4 + left.length; }
  });
  const strip = lay.strip;
  const lr = Math.min(15, strip.h / 2 - 5);
  left.forEach((at, k) => {
    const sp = Math.min(2 * lr + 6, (strip.w - 110) / Math.max(1, left.length));
    at.tx = strip.x + 100 + lr + k * sp; at.ty = strip.y + strip.h / 2; at.tr = lr; at.ox = 0; at.oy = 0; at.leftover = true;
  });
  atoms.sort((p, q) => p.order - q.order);
  run = { t: 0, atoms, slots, ghostsL, left, done: false, fired: {}, balanced: ev.balanced && !ev.changed, complete: ev.complete, blinkUntil: 0 };
  G.runs++;
  if (!ev.balanced) G.unbalancedRunTried = true;
  setEqMsg('반응 중… 원자들이 떨어졌다가 다시 결합해요.');
  updateCtrl(); pushState(); kick();
}
function stepRun(dt) {
  if (!run || run.done) return;
  const t0 = run.t; run.t += dt;
  const cross = x => t0 <= x && run.t > x;
  if (t0 === 0 && run.t > 0 && !run.fired.a) { run.fired.a = 1; sfx.ticks(Math.min(8, run.atoms.length)); }
  if (cross(0.6)) sfx.swish();
  if (cross(1.8)) sfx.snap(Math.min(6, run.slots.filter(s => s.filled).length ? 4 : 1));
  if (run.t >= 2.4) { run.t = 2.4; run.done = true; finishRun(); }
}
function finishRun() {
  const rx = cur(), st = S();
  const missing = run.slots.filter(s => !s.filled).length;
  const formulas = rx.slots.map((s, i) => fU(st.groups[i]));
  const counts = rx.slots.map((s, i) => st.coefs[i] * st.n);
  G.lastRun = formulas.map((f, i) => `${f}:${counts[i]}`).join(',');
  if (run.left.length || missing) {
    sfx.thud2(); run.blinkUntil = clock + 3;
    setEqMsg('원자는 반응 중에 새로 생기거나 없어지지 않아요. 계수를 다시 맞춰 봐요.', 'bad');
  } else {
    if (!locked()) sound.chime();
    setEqMsg(run.complete ? '모든 원자가 같은 종류·같은 개수 그대로 자리만 바꿨어요.' : '원자는 모두 짝을 찾았어요. 화학식이나 계수비를 다시 확인해 봐요.', 'good');
    if (run.complete) st.table = { formulas, coefs: st.coefs.slice(), counts, n: st.n };
  }
  renderTable(); updateCtrl(); pushState();
}
function drawRun(font) {
  const st = S(), t = run.t;
  // 반응 전 자리(점선)
  run.ghostsL.forEach(g => drawGhostAtom(g.x, g.y, g.r, 0.28));
  // 비어 있는 생성물질 자리
  run.slots.forEach(sl => { if (!sl.filled) drawGhostAtom(sl.x, sl.y, sl.r, run.done ? 0.85 : 0.4, run.done); });
  if (!run.done) run.slots.forEach(sl => { if (sl.filled) drawGhostAtom(sl.x, sl.y, sl.r, 0.18); });
  // 결합이 끊기는 반짝임
  if (t > 0.05 && t < 0.6) {
    const k = t / 0.6;
    ctx.strokeStyle = `rgba(255,200,60,${(1 - k) * 0.9})`; ctx.lineWidth = 2;
    const seen = new Set();
    run.atoms.forEach(at => {
      if (seen.has(at.mc)) return; seen.add(at.mc);
      for (let q = 0; q < 6; q++) {
        const an = q * Math.PI / 3 + 0.3, r1 = 6 + k * 14, r2 = r1 + 6;
        ctx.beginPath(); ctx.moveTo(at.mc.x + Math.cos(an) * r1, at.mc.y + Math.sin(an) * r1); ctx.lineTo(at.mc.x + Math.cos(an) * r2, at.mc.y + Math.sin(an) * r2); ctx.stroke();
      }
    });
  }
  run.atoms.forEach(at => {
    let x, y, r = at.r, al = 1;
    if (t < 0.6) {
      const k = ease.outCubic(t / 0.6); x = lerp(at.x, at.sx, k); y = lerp(at.y, at.sy, k);
    } else if (t < 1.8) {
      const k = ease.inOutCubic(clamp((t - 0.6 - at.delay) / 1.0, 0, 1));
      const ex = at.tx + at.ox, ey = at.ty + at.oy;
      const mx = (at.sx + ex) / 2, my = Math.min(at.sy, ey) - 40 - Math.abs(ex - at.sx) * 0.08;
      x = (1 - k) * (1 - k) * at.sx + 2 * (1 - k) * k * mx + k * k * ex;
      y = (1 - k) * (1 - k) * at.sy + 2 * (1 - k) * k * my + k * k * ey;
      r = lerp(at.r, at.tr, k);
    } else {
      const k = clamp((t - 1.8) / 0.6, 0, 1);
      const e = Math.exp(-4 * k) * Math.cos(k * 9) * (1 - k);
      x = at.tx + at.ox * e; y = at.ty + at.oy * e; r = at.tr;
    }
    if (at.leftover && run.done) {
      al = clock < run.blinkUntil ? 0.55 + 0.45 * Math.cos((run.blinkUntil - clock) * 9) : 1;
      ctx.strokeStyle = '#d63a2f'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
    }
    drawAtom(ctx, x, y, r, at.el, al);
  });
  if (run.done && run.slots.some(s => !s.filled)) {
    const r = LAY.regions.R;
    ctx.fillStyle = '#b3261e'; ctx.font = `700 12.5px ${font}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('? = 들어갈 원자가 없는 자리', r.x + r.w - 10, r.y - 9);
  }
}

// ───────────────────── 그리기 루프 ─────────────────────
let looping = false, last = 0;
function busy() {
  if (paused) return false;
  if (run && !run.done) return true;
  if (run && run.done && clock < run.blinkUntil) return true;
  return INST.some(arr => arr && arr.some(o => o.dying != null || clock - o.born < 0.3 || Math.abs(o.x - o.tx) + Math.abs(o.y - o.ty) > 0.3 || Math.abs(o.s - (LAY.cols[INST.indexOf(arr)] || { s: o.s }).s) > 0.01));
}
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
  if (!paused) {
    clock += dt;
    if (LAY) INST.forEach((arr, i) => {
      if (!arr) return;
      const ts2 = LAY.cols[i] ? LAY.cols[i].s : null;
      arr.forEach(o => {
        const k = 1 - Math.exp(-14 * dt);
        o.x = lerp(o.x, o.tx, k); o.y = lerp(o.y, o.ty, k); if (ts2) o.s = lerp(o.s, ts2, k);
      });
      INST[i] = arr.filter(o => o.dying == null || clock - o.dying < 0.26);
    });
    stepRun(dt);
  }
  draw();
  if (busy()) requestAnimationFrame(frame); else looping = false;
}
function kick() { if (!looping) { looping = true; last = performance.now(); requestAnimationFrame(frame); } }

// ───────────────────── 위 띠 단추 ─────────────────────
const btnPlay = $('#btnPlay');
function setPaused(p) {
  paused = p;
  btnPlay.innerHTML = p ? '▶<span class="lbl">재생</span>' : '⏸<span class="lbl">일시정지</span>';
  btnPlay.setAttribute('aria-pressed', String(p));
  if (!p) kick();
}
btnPlay.addEventListener('click', () => { if (locked()) return; setPaused(!paused); sfx.soft(); });

const btnMute = $('#btnMute');
const paintMute = () => { btnMute.textContent = sound.muted ? '🔇' : '🔊'; btnMute.setAttribute('aria-pressed', String(sound.muted)); };
btnMute.addEventListener('click', () => { if (locked()) return; sound.toggleMute(); paintMute(); sfx.soft(); });
paintMute();

$('#btnQuality').addEventListener('click', () => {
  if (locked()) return;
  quality = quality === 'high' ? 'low' : 'high';
  $('#qualityLbl').textContent = quality === 'high' ? '품질 높음' : '품질 낮음';
  sfx.soft(); resize(); if (S().step === 2) drawMinis();
});

// 초기화: 누르면 지금 반응만, 길게(0.8초) 누르면 모든 반응
let holdTimer = null, held = false;
const btnReset = $('#btnReset');
btnReset.addEventListener('pointerdown', () => {
  held = false; clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (locked()) return;
    held = true;
    REACTIONS.forEach(rx => { STATES[rx.id] = freshState(rx); });
    Object.assign(G, { runs: 0, unbalancedRunTried: false, subscriptTried: false, changedFormula: '', hintsUsed: 0, hintIdx: 0, lastRun: '' });
    run = null; selCard = null; closePop(); setEqMsg(''); $('#hintText').textContent = '';
    sfx.reset(); toast('모든 반응을 처음부터 시작해요');
    renderAll(true);
  }, 800);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btnReset.addEventListener(ev, () => clearTimeout(holdTimer)));
btnReset.addEventListener('click', () => {
  if (locked()) return;
  if (held) { held = false; return; }
  STATES[curId] = freshState(cur(), STATES[curId]);
  run = null; selCard = null; closePop(); setEqMsg(''); $('#hintText').textContent = '';
  sfx.reset(); toast('지금 반응을 1단계부터 다시 해요 (길게 누르면 모든 반응을 처음부터)');
  renderAll(true);
});

let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// 잠금: 조작 막기 + 소리 끄기
window.SimBridge.onLock = () => {
  closePop(); setPaused(true);
  if (sound.master && sound.ctx) sound.master.gain.setTargetAtTime(0, sound.ctx.currentTime, 0.02);
  document.querySelectorAll('#app button, #top button').forEach(b => b.setAttribute('tabindex', '-1'));
};

// ───────────────────── 시작 ─────────────────────
renderAll(true);
resize();
pushState(true);

// 점검용: 화면에 보이지 않는 읽기 전용 정보 (정답 없음)
window.__sim = { evalRx: () => evalRx(), state: () => buildState() };
