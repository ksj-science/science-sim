// ② 용수철 실험실 — 모눈 판 위 용수철 파동 y(x, t) = h(t − x/v), 자·리본·시간-위치 그래프·조건 맞추기
import { sound } from '../../lib/sound.js';
import { clamp, damp, toast } from '../../lib/utils.js';

export const SPEED = { loose: 0.6, normal: 1.0, tight: 1.5 };   // 파동이 퍼지는 빠르기 (모형 값, m/s) — 화면에 숫자로 안 보임
export const TENSION_NAME = { loose: '느슨하게', normal: '보통', tight: '팽팽하게' };
const LEN = 3.0;                 // 용수철 길이 (m)
const YMAX = 0.7;                // 모눈 세로 범위 ±0.7 m
const HS = 1 / 240;              // 손 위치 기록 간격 (초)
const CAP = 240 * 14;            // 손 위치 기록 14초 분량
const SNAP = 0.04;               // 자 끝이 붙는 거리 (m)
const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
const sgn2 = v => (v < -0.005 ? '−' : '') + f2(Math.abs(v));

export class Spring {
  constructor({ onChange, isLocked }) {
    this.onChange = onChange;
    this.isLocked = isLocked;
    this.board = document.getElementById('board');
    this.gcv = document.getElementById('ribbonGraph');
    this.bctx = this.board.getContext('2d');
    this.gctx = this.gcv.getContext('2d');
    this.quality = 'high';
    this.active = false;
    this.rec = { missionWavelength: false, missionAmplitude: false, missionPeriod: false, photoCount: 0 };
    this.photos = [];
    this.hist = new Float32Array(CAP);
    this.defaults();
    this.bindBoard();
    this.bindGraph();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.board.parentElement); ro.observe(this.gcv.parentElement);
  }

  defaults() {
    this.mode = 'auto';
    this.running = true;           // 자동 흔들기 중인지
    this.A = 0.30; this.Aeff = 0.30; this.T = 1.00;
    this.tension = 'normal';
    this.playing = true; this.slow = false;
    this.showLabels = true; this.showRibbonTrail = true;
    this.ribbonX = 1.5;
    this.ruler = { p: [{ x: 0.6, y: -0.6, snap: '' }, { x: 1.1, y: -0.6, snap: '' }], used: false };
    this.gpts = [];                // 그래프에서 누른 시간들
    this.handTarget = 0; this.handY = 0;
    this.clearSpring();
  }

  get v() { return SPEED[this.tension]; }

  clearSpring() {
    this.t = 0; this.acc = 0; this.phase = 0; this.cnt = 0;
    this.hist.fill(0);
    this.lastChange = 0;
    this.handY = 0; this.handTarget = 0;
    this.gpts = [];
  }

  // 손(파원)의 위치 기록에서 시각 tt의 값 (기록 전이면 0 — 파동이 아직 안 옴)
  hAt(tt) {
    if (tt <= 0) return 0;
    const k = tt / HS;
    const last = this.cnt - 1;
    if (last < 0) return 0;
    if (k >= last) return this.hist[last % CAP];
    if (k < this.cnt - CAP + 1) return 0;
    const i = Math.floor(k), f = k - i;
    return this.hist[i % CAP] * (1 - f) + this.hist[(i + 1) % CAP] * f;
  }
  yAt(x, tt = this.t) { return this.hAt(tt - x / this.v); }

  // ───────── 시간 진행 ─────────
  advance(dt) {
    this.acc += dt;
    while (this.acc >= HS) {
      this.acc -= HS;
      let h;
      if (this.mode === 'auto') {
        if (this.running) {
          this.Aeff = damp(this.Aeff, this.A, 30, HS);
          h = this.Aeff * Math.sin(this.phase);    // h(t) = A·sin(2πt/T), 위로 출발
          this.phase += 2 * Math.PI * HS / this.T;
        } else h = 0;
        this.handY = h;
      } else {
        this.handY = damp(this.handY, this.handTarget, 22, HS);
        h = this.handY;
      }
      this.hist[this.cnt % CAP] = h;          // 기록 k번째 = 시각 k·HS 의 손 위치
      this.t = this.cnt * HS;
      this.cnt++;
    }
  }

  update(realDt) {
    if (!this.active) return;
    if (this.playing) this.advance(Math.min(realDt, 0.05) * (this.slow ? 0.25 : 1));
    this.refreshSnapNames();
    this.draw();
    this.drawGraph();
  }

  stepOnce() { this.advance(0.05); }

  // ───────── 설정 ─────────
  setMode(m) {
    if (m === this.mode && (m === 'hand' || this.running)) return false;
    this.mode = m;
    if (m === 'auto') {
      this.running = true; this.phase = 0; this.Aeff = this.A;
      this.handTarget = 0;
      this.lastChange = this.t;
    } else {
      this.handTarget = this.handY;
    }
    return true;
  }
  setA(a) { this.A = a; this.lastChange = this.t; }
  setT(T) { this.T = T; this.lastChange = this.t; }
  setTension(k) {
    if (k === this.tension) return false;
    this.tension = k;
    // 팽팽함을 바꾸면 용수철을 새로 걸고 처음부터 흔듦
    this.clearSpring();
    if (this.mode === 'auto') { this.running = true; this.Aeff = this.A; }
    return true;
  }
  stopSpring() {
    this.running = false;
    this.clearSpring();
  }
  spreadDone() { return this.mode === 'auto' && this.running && this.t - this.lastChange >= LEN / this.v - 1e-6; }

  // ───────── 촬영 ─────────
  shoot() {
    const img = this.snapshot();
    const txt = this.mode === 'auto'
      ? `진폭 ${f2(this.A)} m · 주기 ${f2(this.T)} 초 · ${TENSION_NAME[this.tension]}`
      : `손으로 흔듦 · ${TENSION_NAME[this.tension]}`;
    this.photos.unshift({ img, txt });
    this.photos = this.photos.slice(0, 3);
    this.rec.photoCount++;
    this.renderPhotos();
    sound.record();
    const result = [];
    if (this.mode !== 'auto') {
      setTimeout(() => sound.soft(), 180);
      toast('손으로 흔든 파동은 진폭·주기가 일정하지 않아 자동 흔들기로 조건을 맞춰요', 3200);
    } else if (!this.spreadDone()) {
      setTimeout(() => sound.soft(), 180);
      toast('파동이 용수철 끝까지 퍼진 뒤에 찍어요', 2600);
    } else {
      const lam = this.v * this.T;                 // 파장 = v × T (판정에만 씀)
      if (Math.abs(lam - 0.5) <= 0.02) result.push(['missionWavelength', 'mWave']);
      if (Math.abs(this.A - 0.5) <= 0.02) result.push(['missionAmplitude', 'mAmp']);
      if (Math.abs(this.T - 0.5) <= 0.02) result.push(['missionPeriod', 'mPer']);
      if (result.length) {
        result.forEach(([k, id]) => {
          this.rec[k] = true;
          const li = document.getElementById(id);
          li.classList.add('ok'); li.classList.remove('pop'); void li.offsetWidth; li.classList.add('pop');
        });
        setTimeout(() => sound.chime(), 180);
        toast('조건에 맞는 파동이에요! ✓', 2000);
      } else {
        setTimeout(() => sound.soft(), 180);
        toast('어떤 조건에도 맞지 않아요. 자로 다시 재 볼까요?', 2600);
      }
    }
    this.onChange();
  }

  snapshot() {
    const c = document.createElement('canvas');
    c.width = 264; c.height = 120;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    const L = this.layout;
    if (L) {
      const sx = L.X(-0.15), sy = L.Y(YMAX), sw = L.X(LEN + 0.15) - sx, sh = L.Y(-YMAX) - sy;
      const d = this.dpr;
      x.drawImage(this.board, sx * d, sy * d, sw * d, sh * d, 0, 0, c.width, c.height);
    }
    return c.toDataURL('image/jpeg', 0.75);
  }

  renderPhotos() {
    const box = document.getElementById('photos');
    box.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const p = this.photos[i];
      const d = document.createElement('div');
      if (p) {
        d.className = 'photo' + (i === 0 ? ' fresh' : '');
        const im = document.createElement('img'); im.src = p.img; im.alt = '촬영한 용수철 파동';
        const t = document.createElement('p'); t.textContent = p.txt;
        d.append(im, t);
      } else { d.className = 'photo empty'; d.innerHTML = `<span>사진 ${i + 1}</span>`; }
      box.appendChild(d);
    }
  }

  // ───────── 크기 ─────────
  resize() {
    this.dpr = this.quality === 'high' ? Math.min(devicePixelRatio || 1, 2) : 1;
    for (const c of [this.board, this.gcv]) {
      const r = c.getBoundingClientRect();
      if (r.width < 2) continue;
      c.width = Math.round(r.width * this.dpr); c.height = Math.round(r.height * this.dpr);
      c._w = r.width; c._h = r.height;
    }
    const W = this.board._w || 600, H = this.board._h || 300;
    const narrow = W < 560;
    const ml = narrow ? 104 : 116, mr = narrow ? 44 : 58, mt = 30, mb = 28;
    const s = Math.min((W - ml - mr) / LEN, (H - mt - mb) / (2 * YMAX));
    const ox = ml + ((W - ml - mr) - LEN * s) / 2, oy = mt + (H - mt - mb) / 2;
    this.layout = { W, H, s, ox, oy, X: x => ox + x * s, Y: y => oy - y * s, ix: px => (px - ox) / s, iy: py => (oy - py) / s };
    this.paintGrid();
  }

  setQuality(q) { this.quality = q; this.resize(); }

  // 모눈은 크기가 바뀔 때만 그려 둠
  paintGrid() {
    const L = this.layout; if (!L) return;
    const c = this.gridCv || (this.gridCv = document.createElement('canvas'));
    c.width = this.board.width; c.height = this.board.height;
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#fbfaf3'; g.fillRect(0, 0, L.W, L.H);
    const x0 = L.X(0), x1 = L.X(LEN), y0 = L.Y(YMAX), y1 = L.Y(-YMAX);
    g.fillStyle = '#fffef9'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let i = 0; i <= 30; i++) {
      const x = L.X(i * 0.1), bold = i % 5 === 0;
      g.strokeStyle = bold ? '#a9c4cc' : '#dde9ec'; g.lineWidth = bold ? 1.2 : 0.8;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
    }
    for (let j = -7; j <= 7; j++) {
      const y = L.Y(j * 0.1), bold = j % 5 === 0;
      g.strokeStyle = bold ? '#a9c4cc' : '#dde9ec'; g.lineWidth = bold ? 1.2 : 0.8;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    }
    g.strokeStyle = '#8fb0ba'; g.lineWidth = 1.4; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = '#4b5e66'; g.font = '600 12px Pretendard, "Noto Sans KR", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let i = 0; i <= 6; i++) g.fillText((i * 0.5).toFixed(1), L.X(i * 0.5), y1 + 4);
    g.textAlign = 'left';
    g.fillText('(m)', L.X(LEN) + 14, y1 + 4);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const lx = L.X(0) - 70;
    for (let j = -7; j <= 7; j++) {
      if (L.s * 0.1 < 15 && j % 2) continue;
      g.fillStyle = j % 5 === 0 ? '#2e4650' : '#6b7f86';
      g.fillText(j === 0 ? '0' : sgn2(j / 10), lx, L.Y(j / 10));
    }
    g.textBaseline = 'bottom';
    g.fillText('(m)', lx, y0 - 6);
  }

  // ───────── 마루·골 찾기 (지금 프레임의 용수철 모양에서, 꼭짓점은 포물선 보간) ─────────
  extrema() {
    const out = [], d = 0.004, n = Math.round(LEN / d);
    let y0 = this.yAt(0), y1 = this.yAt(d);
    for (let i = 1; i < n; i++) {
      const y2 = this.yAt((i + 1) * d);
      const isMax = y1 > y0 && y1 >= y2, isMin = y1 < y0 && y1 <= y2;
      if ((isMax && y1 > 0.03) || (isMin && y1 < -0.03)) {
        const den = y0 - 2 * y1 + y2;
        const off = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
        const x = (i + off) * d;
        const y = y1 - 0.25 * (y0 - y2) * off;
        if (x > 0.02 && x < LEN - 0.02) out.push({ x, y, name: isMax ? '마루' : '골' });
      }
      y0 = y1; y1 = y2;
    }
    return out;
  }

  snapPoint(p) {
    const ex = this.extrema();
    let best = null, bd = SNAP;
    for (const e of ex) { const dd = Math.hypot(e.x - p.x, e.y - p.y); if (dd < bd) { bd = dd; best = e; } }
    if (best) return { x: best.x, y: best.y, snap: best.name };
    if (Math.abs(p.y) < SNAP) return { x: this.gridSnap(p.x), y: 0, snap: '중심' };
    return { x: this.gridSnap(p.x), y: this.gridSnap(p.y), snap: '' };
  }
  gridSnap(v) { const g = Math.round(v / 0.05) * 0.05; return Math.abs(g - v) < 0.012 ? g : v; }

  refreshSnapNames() {
    // 재생 중이면 파동이 움직이므로, 자 끝이 아직 그 꼭짓점에 있는지 다시 확인
    if (!this.playing || this.dragging) return;
    const ex = this.extrema();
    let changed = false;
    for (const p of this.ruler.p) {
      if (p.snap === '마루' || p.snap === '골') {
        const still = ex.some(e => e.name === p.snap && Math.hypot(e.x - p.x, e.y - p.y) < 0.015);
        if (!still) { p.snap = ''; changed = true; }
      }
    }
    if (changed) this.onChange();
  }

  rulerSnap() {
    const [a, b] = this.ruler.p;
    if (!a.snap && !b.snap) return '';
    return `${a.snap || '없음'}-${b.snap || '없음'}`;
  }
  rulerDx() { const [a, b] = this.ruler.p; return Math.abs(b.x - a.x); }
  rulerDy() { const [a, b] = this.ruler.p; return Math.abs(b.y - a.y); }

  // ───────── 판 위 입력 ─────────
  bindBoard() {
    const cv = this.board;
    const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let drag = null;
    cv.addEventListener('pointerdown', e => {
      if (this.isLocked() || !this.layout) return;
      const L = this.layout, [px, py] = pt(e);
      const pick = this.pick(px, py);
      if (!pick) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      drag = { ...pick, id: e.pointerId, sx: px, sy: py, start: this.ruler.p.map(p => ({ ...p })) };
      this.dragging = true;
      if (pick.kind === 'hand' && this.mode === 'auto') {
        this.setMode('hand');
        this.onModeUi && this.onModeUi();
        toast('손으로 흔들기로 바꿨어요 — 손잡이를 위아래로 끌어 보세요', 2400);
      }
      if (pick.kind === 'end' || pick.kind === 'ruler') {
        if (this.playing && !this.hintedPause) { this.hintedPause = true; toast('일시정지하면 마루·골이 멈춰서 재기 쉬워요', 2400); }
      }
      sound.click();
    });
    cv.addEventListener('pointermove', e => {
      const [px, py] = pt(e);
      if (!drag) { const p = this.layout && this.pick(px, py); cv.style.cursor = p ? (p.kind === 'hand' ? 'ns-resize' : p.kind === 'ribbon' ? 'ew-resize' : 'grab') : ''; return; }
      if (e.pointerId !== drag.id || this.isLocked()) return;
      const L = this.layout;
      const x = clamp(L.ix(px), -0.05, LEN + 0.05), y = clamp(L.iy(py), -YMAX, YMAX);
      if (drag.kind === 'end') {
        const p = this.ruler.p[drag.i];
        const sp = this.snapPoint({ x, y });
        if (sp.snap && sp.snap !== p.snap) sound.click();
        Object.assign(p, sp);
        this.ruler.used = true;
      } else if (drag.kind === 'ruler') {
        const dx = L.ix(px) - L.ix(drag.sx), dy = L.iy(py) - L.iy(drag.sy);
        this.ruler.p.forEach((p, i) => {
          p.x = clamp(drag.start[i].x + dx, -0.05, LEN + 0.05); p.y = clamp(drag.start[i].y + dy, -YMAX, YMAX); p.snap = '';
        });
        this.ruler.used = true;
      } else if (drag.kind === 'ribbon') {
        const nx = clamp(Math.round(L.ix(px) / 0.1) * 0.1, 0.2, 2.8);
        if (Math.abs(nx - this.ribbonX) > 1e-6) { this.ribbonX = nx; sound.tick(nx / 3); }
      } else if (drag.kind === 'hand') {
        this.handTarget = clamp(L.iy(py), -0.65, 0.65);
      }
      this.onChange();
    });
    const up = e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.kind === 'ruler') { this.ruler.p.forEach((p, i) => Object.assign(p, this.snapPoint(p))); }
      drag = null; this.dragging = false;
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      this.onChange();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  pick(px, py) {
    const L = this.layout;
    for (let i = 0; i < 2; i++) {
      const p = this.ruler.p[i];
      if (Math.hypot(L.X(p.x) - px, L.Y(p.y) - py) < 22) return { kind: 'end', i };
    }
    const ry = this.yAt(this.ribbonX);
    if (Math.hypot(L.X(this.ribbonX) - px, L.Y(ry) - py) < 22) return { kind: 'ribbon' };
    if (Math.hypot(L.X(0) - 22 - px, L.Y(this.handY) - py) < 36) return { kind: 'hand' };
    // 자 몸통
    const [a, b] = this.ruler.p;
    const ax = L.X(a.x), ay = L.Y(a.y), bx = L.X(b.x), by = L.Y(b.y);
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1;
    const u = clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1);
    if (Math.hypot(ax + u * vx - px, ay + u * vy - py) < 12) return { kind: 'ruler' };
    return null;
  }

  // ───────── 그래프 입력 ─────────
  bindGraph() {
    this.gcv.addEventListener('pointerdown', e => {
      if (this.isLocked() || !this.gl) return;
      const r = this.gcv.getBoundingClientRect();
      const px = e.clientX - r.left;
      const G = this.gl;
      let tt = G.it(px);
      if (tt < G.t0 - 0.05 || tt > Math.min(G.t1, this.t) + 0.05) return;
      tt = clamp(tt, Math.max(0, G.t0), this.t);
      tt = this.snapTime(tt);
      if (this.gpts.length >= 2) this.gpts = [];
      this.gpts.push(tt);
      sound.click();
      this.onChange();
    });
  }

  // 누른 곳 가까이(0.06초 안)에 마루·골 꼭짓점이 있으면 거기에 붙임
  snapTime(tt) {
    const xr = this.ribbonX, f = t => this.yAt(xr, t);
    let best = tt, bv = -1;
    for (let k = -30; k <= 30; k++) {
      const a = tt + k * 0.002;
      if (a < 0 || a > this.t) continue;
      const y0 = f(a - 0.002), y1 = f(a), y2 = f(a + 0.002);
      if (((y1 > y0 && y1 >= y2) || (y1 < y0 && y1 <= y2)) && Math.abs(y1) > 0.02) {
        const score = 1 / (1 + Math.abs(k));
        if (score > bv) { bv = score; best = a; }
      }
    }
    return best;
  }

  graphDt() { return this.gpts.length === 2 ? Math.abs(this.gpts[1] - this.gpts[0]) : null; }

  // ───────── 그리기: 판 ─────────
  draw() {
    const L = this.layout; if (!L || !this.gridCv) return;
    const c = this.bctx, d = this.dpr;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.gridCv, 0, 0);
    c.setTransform(d, 0, 0, d, 0, 0);
    const font = (w, s) => `${w} ${s}px Pretendard, "Noto Sans KR", sans-serif`;

    // 진동의 중심 (점선)
    c.strokeStyle = '#6a8a94'; c.lineWidth = 1.5; c.setLineDash([7, 6]);
    c.beginPath(); c.moveTo(L.X(0), L.Y(0)); c.lineTo(L.X(LEN), L.Y(0)); c.stroke();
    c.setLineDash([]);

    // 리본 흔적 (리본 아래 세로 흔적)
    if (this.showRibbonTrail) {
      const xr = L.X(this.ribbonX);
      for (let k = 0; k <= 60; k++) {
        const tt = this.t - k * 0.03;
        if (tt < 0) break;
        const y = this.yAt(this.ribbonX, tt);
        c.fillStyle = `rgba(214, 40, 40, ${0.35 * (1 - k / 60)})`;
        c.beginPath(); c.arc(xr, L.Y(y), 2.6, 0, Math.PI * 2); c.fill();
      }
    }

    // 용수철 모양
    const step = 0.01, n = Math.round(LEN / step);
    const ys = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) ys[i] = this.yAt(i * step);
    // 가운데 선 (파동 모양)
    c.strokeStyle = 'rgba(30, 110, 170, .55)'; c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i <= n; i++) { const X = L.X(i * step), Y = L.Y(ys[i]); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
    c.stroke();
    // 코일 고리
    const pitch = this.quality === 'high' ? 0.025 : 0.045;
    const R = clamp(0.034 * L.s, 6, 9.5);
    const yAtX = x => { const f = x / step, i = Math.min(n - 1, Math.floor(f)), t = f - i; return ys[i] * (1 - t) + ys[i + 1] * t; };
    c.lineWidth = this.quality === 'high' ? 1.7 : 1.4;
    for (let back = 1; back >= 0; back--) {
      c.strokeStyle = back ? '#7e8a93' : '#3f4f5b';
      for (let x = pitch / 2; x < LEN; x += pitch) {
        const y = yAtX(x), sl = (yAtX(Math.min(LEN, x + 0.01)) - yAtX(Math.max(0, x - 0.01))) / 0.02;
        const ang = Math.atan2(-sl, 1);
        c.beginPath();
        c.ellipse(L.X(x), L.Y(y), R * 0.32, R, ang, back ? Math.PI * 0.5 : -Math.PI * 0.5, back ? Math.PI * 1.5 : Math.PI * 0.5);
        c.stroke();
      }
    }

    // 마루·골 라벨 (화면 안 마루 1개·골 1개)
    const ex = this.extrema();
    if (this.showLabels) {
      // 자 끝이 붙어 있는 꼭짓점은 피해서 라벨을 붙임 (글자 겹침 방지)
      const free = e => e.x > 0.15 && e.x < 2.3 && this.ruler.p.every(p => Math.hypot(p.x - e.x, p.y - e.y) > 0.15);
      const crest = ex.find(e => e.name === '마루' && free(e));
      const trough = ex.find(e => e.name === '골' && free(e));
      const pill = (txt, x, y, col) => {
        c.font = font(800, 14);
        const w = c.measureText(txt).width + 16;
        c.fillStyle = col; this.round(c, x - w / 2, y - 11, w, 22, 11); c.fill();
        c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, x, y + 0.5);
      };
      if (crest) {
        const X = L.X(crest.x), Y = L.Y(crest.y) - R - 16;
        c.fillStyle = '#e0533d'; c.beginPath(); c.arc(L.X(crest.x), L.Y(crest.y), 4, 0, 7); c.fill();
        pill('마루', X, Math.max(L.Y(YMAX) + 4, Y), '#e0533d');
      }
      if (trough) {
        const X = L.X(trough.x), Y = L.Y(trough.y) + R + 16;
        c.fillStyle = '#2d6fd6'; c.beginPath(); c.arc(L.X(trough.x), L.Y(trough.y), 4, 0, 7); c.fill();
        pill('골', X, Math.min(L.Y(-YMAX) - 4, Y), '#2d6fd6');
      }
      c.font = font(700, 13); c.textAlign = 'right'; c.textBaseline = 'bottom';
      const tx = L.X(LEN) - 6, ty = L.Y(0) - 5, tw = c.measureText('진동의 중심').width;
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(tx - tw - 4, ty - 16, tw + 8, 17);
      c.fillStyle = '#35545e'; c.fillText('진동의 중심', tx, ty);
    }

    // 리본
    const ry = this.yAt(this.ribbonX), RX = L.X(this.ribbonX), RY = L.Y(ry);
    c.fillStyle = '#d62828'; c.strokeStyle = '#8f1414'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(RX, RY); c.lineTo(RX - 11, RY - 8); c.lineTo(RX - 11, RY + 8); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(RX, RY); c.lineTo(RX + 11, RY - 8); c.lineTo(RX + 11, RY + 8); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(RX - 2, RY + 3); c.lineTo(RX - 6, RY + 17); c.moveTo(RX + 2, RY + 3); c.lineTo(RX + 6, RY + 17);
    c.lineWidth = 3; c.strokeStyle = '#d62828'; c.stroke();
    c.fillStyle = '#ff5a4a'; c.beginPath(); c.arc(RX, RY, 4.5, 0, 7); c.fill();

    // 손 (왼쪽: 장갑 낀 손 = 파원, 오른쪽: 다른 사람 손)
    this.drawGlove(c, L.X(0), L.Y(this.handY), R);
    this.drawHand(c, L.X(LEN), L.Y(ys[n]), R);
    if (this.mode === 'hand') {
      const hx = L.X(0) - 22, hy = L.Y(this.handY);
      c.strokeStyle = 'rgba(240, 160, 0, .9)'; c.lineWidth = 2.5; c.setLineDash([4, 4]);
      c.beginPath(); c.arc(hx, hy, 30 + Math.sin(performance.now() / 250) * 2, 0, 7); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#c98500'; c.font = font(800, 16); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('▲', hx, hy - 44); c.fillText('▼', hx, hy + 44);
    }
    c.fillStyle = '#4b5e66'; c.font = font(800, 12); c.textAlign = 'center'; c.textBaseline = 'bottom';
    const pyTop = L.Y(this.handY) - R - 10;
    c.fillText('파원', L.X(0) - 24, pyTop > 16 ? pyTop : L.Y(this.handY) + R + 24);

    // 파동의 진행 방향
    c.font = font(800, 14); c.textAlign = 'right'; c.textBaseline = 'middle';
    const ax = L.X(LEN) - 4, ay = L.Y(YMAX) - 14;
    c.fillStyle = '#c0392b'; c.fillText('파동의 진행 방향 →', ax, ay);

    // 자
    this.drawRuler(c, font);
  }

  drawGlove(c, x, y, R) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#5b7f99'; this.round(c, -64, -14, 26, 28, 5); c.fill();               // 소매
    c.fillStyle = '#f4f1e8'; c.strokeStyle = '#a7a08c'; c.lineWidth = 1.5;
    this.round(c, -44, -R - 6, 40, 2 * R + 12, 10); c.fill(); c.stroke();               // 장갑 손바닥
    for (let k = 0; k < 4; k++) { this.round(c, -10, -R - 4 + k * ((2 * R + 8) / 4), 14, (2 * R + 8) / 4 - 1, 4); c.fill(); c.stroke(); } // 손가락
    c.beginPath(); c.ellipse(-30, -R - 4, 8, 6, -0.5, 0, 7); c.fill(); c.stroke();     // 엄지
    c.restore();
  }
  drawHand(c, x, y, R) {
    c.save(); c.translate(x, y);
    c.fillStyle = '#8a6f5a'; this.round(c, 38, -13, 24, 26, 5); c.fill();
    c.fillStyle = '#f2c9a0'; c.strokeStyle = '#c49a72'; c.lineWidth = 1.5;
    this.round(c, 4, -R - 5, 36, 2 * R + 10, 10); c.fill(); c.stroke();
    for (let k = 0; k < 4; k++) { this.round(c, -6, -R - 3 + k * ((2 * R + 6) / 4), 13, (2 * R + 6) / 4 - 1, 4); c.fill(); c.stroke(); }
    c.restore();
  }

  drawRuler(c, font) {
    const L = this.layout;
    const [a, b] = this.ruler.p;
    const ax = L.X(a.x), ay = L.Y(a.y), bx = L.X(b.x), by = L.Y(b.y);
    const len = Math.hypot(bx - ax, by - ay);
    const ang = Math.atan2(by - ay, bx - ax);
    // 가로·세로 성분 보조선
    const dx = this.rulerDx(), dy = this.rulerDy();
    if (dx > 0.02 && dy > 0.02) {
      c.strokeStyle = 'rgba(160, 110, 0, .7)'; c.lineWidth = 1.5; c.setLineDash([5, 4]);
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, ay); c.lineTo(bx, by); c.stroke(); c.setLineDash([]);
    }
    c.save(); c.translate(ax, ay); c.rotate(ang);
    c.fillStyle = 'rgba(255, 210, 40, .45)'; c.strokeStyle = 'rgba(190, 140, 0, .9)'; c.lineWidth = 1.2;
    this.round(c, 0, -9, len, 18, 3); c.fill(); c.stroke();
    // 눈금 (0.05 m 간격)
    const mlen = len / L.s;
    c.strokeStyle = 'rgba(120, 85, 0, .85)';
    for (let k = 0; k * 0.05 <= mlen + 1e-6; k++) {
      const X = k * 0.05 * L.s, big = k % 2 === 0;
      c.beginPath(); c.moveTo(X, -9); c.lineTo(X, big ? -1 : -4); c.stroke();
    }
    c.restore();
    // 끝점
    for (const p of [a, b]) {
      const X = L.X(p.x), Y = L.Y(p.y);
      c.fillStyle = p.snap ? '#ff9f1a' : '#ffd23f'; c.strokeStyle = '#7a5a00'; c.lineWidth = 2;
      c.beginPath(); c.arc(X, Y, 9, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#7a5a00'; c.beginPath(); c.arc(X, Y, 2.2, 0, 7); c.fill();
      if (p.snap) {
        c.font = font(800, 12); c.textAlign = 'center'; c.textBaseline = 'bottom';
        const w = c.measureText(p.snap).width + 10;
        c.fillStyle = 'rgba(122, 90, 0, .9)'; this.round(c, X - w / 2, Y - 31, w, 17, 8); c.fill();
        c.fillStyle = '#fff'; c.fillText(p.snap, X, Y - 15.5);
      }
    }
    // 읽음값 글상자
    let lines = [`가로 거리 ${f2(dx)} m · 세로 거리 ${f2(dy)} m`];
    const names = [a.snap, b.snap].sort().join('-');
    if (names === '골-마루') lines.push('↔ 마루~골 가로 거리는 파장의 절반이에요', '↕ 마루~골 세로 거리는 진폭의 2배예요');
    c.font = font(800, 13);
    const w = Math.max(...lines.map(s => c.measureText(s).width)) + 18, h = 8 + lines.length * 18;
    // 자가 아래쪽에 있으면 글상자를 자 위에, 위쪽에 있으면 자 아래에
    let lx = (ax + bx) / 2 - w / 2, ly = (a.y + b.y) / 2 < 0 ? Math.min(ay, by) - 16 - h : Math.max(ay, by) + 16;
    lx = clamp(lx, 4, L.W - w - 4); ly = clamp(ly, 4, L.H - h - 2);
    c.fillStyle = 'rgba(255, 250, 225, .96)'; c.strokeStyle = '#c9a227'; c.lineWidth = 1.2;
    this.round(c, lx, ly, w, h, 8); c.fill(); c.stroke();
    c.textAlign = 'left'; c.textBaseline = 'top';
    lines.forEach((s, i) => { c.fillStyle = i ? '#8a4b00' : '#3d2f00'; c.font = font(i ? 700 : 800, i ? 12.5 : 13); c.fillText(s, lx + 9, ly + 5 + i * 18); });
  }

  round(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ───────── 그리기: 리본 그래프 ─────────
  drawGraph() {
    const cv = this.gcv, W = cv._w, H = cv._h;
    if (!W) return;
    const c = this.gctx, d = this.dpr;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, W, H);
    const narrow = W < 560;
    const ml = narrow ? 64 : 92, mr = 40, mt = 10, mb = 26;
    const t1 = Math.max(4, this.t), t0 = t1 - 4;
    const gx = tt => ml + (tt - t0) / 4 * (W - ml - mr);
    const gy = y => mt + (YMAX - y) / (2 * YMAX) * (H - mt - mb);
    this.gl = { t0, t1, it: px => t0 + (px - ml) / (W - ml - mr) * 4 };
    const font = (w, s) => `${w} ${s}px Pretendard, "Noto Sans KR", sans-serif`;
    c.fillStyle = '#fbfdfd'; c.fillRect(ml, mt, W - ml - mr, H - mt - mb);
    // 눈금
    c.lineWidth = 1;
    for (let k = Math.ceil(t0 / 0.5) * 0.5; k <= t1 + 1e-6; k += 0.5) {
      const X = gx(k), major = Math.abs(k - Math.round(k)) < 1e-6;
      c.strokeStyle = major ? '#c9d8dd' : '#e6eef0';
      c.beginPath(); c.moveTo(X, mt); c.lineTo(X, H - mb); c.stroke();
      c.fillStyle = '#4b5e66'; c.font = font(major ? 700 : 500, 12); c.textAlign = 'center'; c.textBaseline = 'top';
      if (!narrow || major) c.fillText(k.toFixed(1), X, H - mb + 4);
    }
    for (let j = -6; j <= 6; j += 2) {
      const Y = gy(j / 10);
      c.strokeStyle = j === 0 ? '#7f9ba3' : '#e6eef0';
      if (j === 0) c.setLineDash([6, 5]);
      c.beginPath(); c.moveTo(ml, Y); c.lineTo(W - mr, Y); c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#6b7f86'; c.font = font(500, 12); c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(j === 0 ? '0' : sgn2(j / 10), W - mr + 4, Y);
    }
    c.strokeStyle = '#9fb6bd'; c.strokeRect(ml, mt, W - ml - mr, H - mt - mb);
    // 왼쪽 글자 (그림처럼 마루·진동의 중심·골)
    const lab = Math.min(0.55, Math.max(this.mode === 'auto' ? this.A : 0.4, 0.3));
    c.textAlign = 'right'; c.textBaseline = 'middle';
    c.font = font(800, 13);
    c.fillStyle = '#e0533d'; c.fillText('마루', ml - 6, gy(lab));
    c.fillStyle = '#35545e'; c.font = font(700, narrow ? 12 : 13); c.fillText(narrow ? '중심' : '진동의 중심', ml - 6, gy(0));
    c.fillStyle = '#2d6fd6'; c.font = font(800, 13); c.fillText('골', ml - 6, gy(-lab));
    c.fillStyle = '#4b5e66'; c.font = font(600, 12); c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('시간(초)', ml - 20, H - 4);
    c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('(m)', W - mr + 4, 0);

    // 곡선
    if (this.t > 0) {
      c.save(); c.beginPath(); c.rect(ml, mt, W - ml - mr, H - mt - mb); c.clip();
      c.strokeStyle = '#d62828'; c.lineWidth = 2.4; c.lineJoin = 'round';
      c.beginPath();
      const n = 360;
      let first = true;
      for (let i = 0; i <= n; i++) {
        const tt = t0 + (i / n) * 4;
        if (tt < 0 || tt > this.t) continue;
        const X = gx(tt), Y = gy(this.yAt(this.ribbonX, tt));
        first ? c.moveTo(X, Y) : c.lineTo(X, Y); first = false;
      }
      c.stroke();
      const X = gx(this.t), Y = gy(this.yAt(this.ribbonX));
      c.fillStyle = '#d62828'; c.beginPath(); c.arc(X, Y, 4.5, 0, 7); c.fill();
      c.restore();
    }
    // 누른 점
    this.gpts = this.gpts.filter(tt => tt >= t0 - 1e-6);
    const P = this.gpts.map(tt => ({ tt, X: gx(tt), Y: gy(this.yAt(this.ribbonX, tt)), y: this.yAt(this.ribbonX, tt) }));
    P.forEach((p, i) => {
      c.strokeStyle = '#0f5aa0'; c.lineWidth = 1.2; c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(p.X, mt); c.lineTo(p.X, H - mb); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#0f5aa0'; c.beginPath(); c.arc(p.X, p.Y, 5, 0, 7); c.fill();
      const s = `${p.tt.toFixed(2)} 초 · ${sgn2(p.y)} m`;
      c.font = font(700, 12);
      const w = c.measureText(s).width + 10;
      let bx = p.X + 7, by = p.Y + (p.y > 0 ? 8 : -26);
      if (bx + w > W - mr) bx = p.X - 7 - w;
      by = clamp(by, mt + 2, H - mb - 20);
      c.fillStyle = 'rgba(255,255,255,.95)'; c.strokeStyle = '#0f5aa0';
      this.round(c, bx, by, w, 18, 6); c.fill(); c.stroke();
      c.fillStyle = '#0f3d6e'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(s, bx + 5, by + 9.5);
    });
    if (P.length === 2) {
      const [p, q] = P[0].X < P[1].X ? P : [P[1], P[0]];
      const Y = mt + 12;
      c.strokeStyle = '#0f5aa0'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(p.X, Y); c.lineTo(q.X, Y); c.stroke();
      c.beginPath(); c.moveTo(p.X, Y - 5); c.lineTo(p.X, Y + 5); c.moveTo(q.X, Y - 5); c.lineTo(q.X, Y + 5); c.stroke();
      const s = `시간 차 ${f2(Math.abs(q.tt - p.tt))} 초`;
      c.font = font(800, 13);
      const w = c.measureText(s).width + 12, mx = clamp((p.X + q.X) / 2, ml + w / 2, W - mr - w / 2);
      c.fillStyle = '#0f5aa0'; this.round(c, mx - w / 2, Y - 10, w, 20, 10); c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, mx, Y + 0.5);
    }
  }
}
