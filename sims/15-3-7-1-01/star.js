// 탭 ② — 지구에서 본 밤하늘 + 거리 축 + 등급 자 (2D 캔버스)
import { clamp } from '../../lib/utils.js';

// 겉보기 등급은 교과서 값, 거리는 참고값. 절대 등급은 두 값으로 계산 (m = M + 5 log10(d / 10 pc))
export const STARS = [
  { id: 'sun', name: '태양', m0: -26.8, dist: 0.00000485, ui: '#ffc94d', glow: [255, 236, 170], sky: [0.13, 0.56] },
  { id: 'sirius', name: '시리우스', m0: -1.4, dist: 2.6, ui: '#6fd3ff', glow: [225, 238, 255], sky: [0.47, 0.42] },
  { id: 'mirzam', name: '미르잠', m0: 2.0, dist: 150, ui: '#9aa5ff', glow: [205, 220, 255], sky: [0.7, 0.72] },
  { id: 'muliphein', name: '물리펜', m0: 4.1, dist: 140, ui: '#ff9bd2', glow: [225, 232, 255], sky: [0.28, 0.2] },
];
STARS.forEach(s => { s.M = s.m0 - 5 * Math.log10(s.dist / 10); });
export const byId = id => STARS.find(s => s.id === id);
export const magAt = (s, D) => s.M + 5 * Math.log10(D / 10);

export const PC_MIN = 0.5, PC_MAX = 1000;
const LMIN = Math.log10(PC_MIN), LMAX = Math.log10(PC_MAX);

// 등급 자: -27 ~ -3은 줄여서, -3 ~ 8은 넓게, 8 ~ 16은 다시 줄여서 (8등급보다 어두운 별도 실제 등급 위치에)
const MAG_TOP = -27, MAG_BREAK = -3, MAG_BOT = 8, MAG_END = 16, BREAK_FRAC = 0.2, LOW_FRAC = 0.16;
export const NAKED_EYE = 6;   // 맨눈으로 볼 수 있는 가장 어두운 별 ≈ 6등급

export function createStarView(canvas, { onSelect, onDrag, onDragStart, onDragEnd, isLocked, getState }) {
  const g = canvas.getContext('2d');
  let W = 1, H = 1, dpr = 1, L = {}, quality = 'high', time = 0;
  const bg = [];
  // 고정된 씨앗으로 배경 별 만들기
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) bg.push({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.1, a: 0.15 + rnd() * 0.45, p: rnd() * 6.28 });

  function layout() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = quality === 'high' ? Math.min(devicePixelRatio, 2) : 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const portrait = W < 700;
    const skyH = Math.round(H * 0.6);
    const rulerW = portrait ? 116 : 130;
    const earthW = portrait ? 56 : 66;
    const sunCell = portrait ? 74 : 92;
    const x0 = earthW + sunCell + 18;        // 0.5 pc 위치
    const x1 = W - 26;                        // 1000 pc 위치
    const laneTop = skyH + 30, laneBot = H - 26;
    L = {
      portrait, skyH, rulerW, earthW, sunCell, x0, x1, laneTop, laneBot,
      laneH: (laneBot - laneTop) / 4,
      skyW: W - rulerW,
      rulerX: W - rulerW + (portrait ? 64 : 74),
      magTop: 52, magBot: skyH - 24,
      sunX: earthW + sunCell / 2 + 4,
    };
    draw();
  }

  // 거리 → 축 위 x (0.5 pc 미만은 '생략' 칸 안에서 로그로)
  const SUN_L = Math.log10(0.00000485);
  function xOf(D) {
    const l = Math.log10(D);
    if (l >= LMIN) return L.x0 + ((l - LMIN) / (LMAX - LMIN)) * (L.x1 - L.x0);
    const t = clamp((l - SUN_L) / (LMIN - SUN_L), 0, 1);
    return L.sunX + t * (L.x0 - L.sunX);
  }
  function dOfX(x) {
    const t = clamp((x - L.x0) / (L.x1 - L.x0), 0, 1);
    return Math.pow(10, LMIN + t * (LMAX - LMIN));
  }
  function yOfMag(m) {
    const top = L.magTop, bot = L.magBot, span = bot - top;
    const bh = span * BREAK_FRAC, lh = span * LOW_FRAC, mh = span - bh - lh;
    if (m <= MAG_BREAK) return top + ((clamp(m, MAG_TOP, MAG_BREAK) - MAG_TOP) / (MAG_BREAK - MAG_TOP)) * bh;
    if (m <= MAG_BOT) return top + bh + ((m - MAG_BREAK) / (MAG_BOT - MAG_BREAK)) * mh;
    return top + bh + mh + ((clamp(m, MAG_BOT, MAG_END) - MAG_BOT) / (MAG_END - MAG_BOT)) * lh;
  }
  const laneY = i => L.laneTop + L.laneH * (i + 0.5);

  // 보이는 밝기 → 그림 크기 (-2등급 이상 밝으면 최대 + 번짐 테두리)
  function vis(m) {
    const t = clamp((6.5 - m) / 8.5, 0, 1);
    const k = clamp(Math.min(L.skyH / 420, 1), 0.7, 1);
    return { t, core: (1.3 + 7.5 * Math.pow(t, 1.4)) * k, glow: (4 + 30 * t * t) * k, a: 0.25 + 0.75 * Math.pow(t, 0.6), over: m < -2, hidden: Math.round(m * 10) / 10 > NAKED_EYE };   // 표시한(반올림) 등급 기준
  }

  function drawStarGlow(x, y, s, m, sel) {
    const v = vis(m);
    const [r, gg, b] = s.glow;
    if (v.hidden) {
      g.setLineDash([3, 4]); g.strokeStyle = 'rgba(160,180,220,.45)'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    } else {
      const tw = quality === 'high' && !getState().paused ? 1 + 0.06 * Math.sin(time * 3 + x) : 1;
      const gr = v.glow * tw * (v.over ? 1.25 : 1);
      const grad = g.createRadialGradient(x, y, 0, x, y, gr + v.core);
      grad.addColorStop(0, `rgba(${r},${gg},${b},${0.85 * v.a})`);
      grad.addColorStop(0.25, `rgba(${r},${gg},${b},${0.35 * v.a})`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, gr + v.core, 0, Math.PI * 2); g.fill();
      if (quality === 'high' && v.t > 0.55) { // 빛 십자
        g.strokeStyle = `rgba(${r},${gg},${b},${0.35 * v.t})`; g.lineWidth = 1.2;
        const ll = gr * 1.3;
        g.beginPath(); g.moveTo(x - ll, y); g.lineTo(x + ll, y); g.moveTo(x, y - ll); g.lineTo(x, y + ll); g.stroke();
      }
      g.fillStyle = `rgba(255,255,255,${v.a})`;
      g.beginPath(); g.arc(x, y, v.core, 0, Math.PI * 2); g.fill();
      if (v.over) {
        g.strokeStyle = 'rgba(255,204,77,.8)'; g.lineWidth = 1.5; g.setLineDash([5, 4]);
        g.beginPath(); g.arc(x, y, gr + v.core + 6, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      }
    }
    if (sel) {
      g.strokeStyle = s.ui; g.lineWidth = 2; g.setLineDash([6, 5]); g.lineDashOffset = -time * 12;
      g.beginPath(); g.arc(x, y, Math.max(16, v.core + 10), 0, Math.PI * 2); g.stroke();
      g.setLineDash([]); g.lineDashOffset = 0;
    }
    return v;
  }

  const fmtMag = m => { const v = Math.round(m * 10) / 10; return (Object.is(v, -0) ? 0 : v).toFixed(1); };

  function draw() {
    const st = getState();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // ---- 하늘 ----
    const sky = g.createLinearGradient(0, 0, 0, L.skyH);
    sky.addColorStop(0, '#050914'); sky.addColorStop(1, '#0f1c38');
    g.fillStyle = sky; g.fillRect(0, 0, W, L.skyH);
    for (const s of bg) {
      const a = s.a * (quality === 'high' ? 0.75 + 0.25 * Math.sin(time * 1.7 + s.p) : 1);
      g.fillStyle = `rgba(200,215,255,${a})`;
      g.beginPath(); g.arc(s.x * L.skyW, s.y * L.skyH, s.r, 0, Math.PI * 2); g.fill();
    }
    g.font = `700 ${L.portrait ? 14 : 15}px ${getComputedStyle(document.body).fontFamily}`;
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#cfe0ff';
    g.fillText('지구에서 본 밤하늘 (보이는 밝기)', 12, 10);
    g.font = `400 13px ${getComputedStyle(document.body).fontFamily}`;
    g.fillStyle = '#a9b8d8'; g.textBaseline = 'bottom';
    g.fillText('별 점의 크기는 보이는 밝기만 나타내요 (실제 별의 크기와 상관없음)', 12, L.skyH - 8);

    const font = getComputedStyle(document.body).fontFamily;
    for (const s of STARS) {
      const D = st.dist[s.id], m = magAt(s, D);
      const x = s.sky[0] * L.skyW, y = s.sky[1] * (L.skyH - 40) + 24;
      const v = drawStarGlow(x, y, s, m, st.sel === s.id);
      // 이름표는 번짐 테두리(점선 원) 밖에. 아래 공간이 모자라면 별 위쪽에 씀
      const off = v.over ? v.glow * 1.25 + v.core + 12 : Math.max(16, v.core + 10);
      const lines = v.over ? 3 : 2, blockH = lines * 17;
      const ty = y + off + blockH > L.skyH - 22 ? y - off - blockH : y + off;   // 아래쪽 안내 글(skyH-8)과 겹치면 위로
      g.textAlign = 'center'; g.textBaseline = 'top';
      const l2 = v.hidden ? `${fmtMag(m)}등급 · 맨눈으로 안 보임` : `${fmtMag(m)}등급`;
      const l3 = L.portrait ? '너무 밝아 다 못 나타냄' : '너무 밝아 화면에 다 못 나타냄';
      // 글자가 밤하늘 창 밖으로 잘리지 않게 가운데를 안쪽으로
      g.font = `600 13px ${font}`;
      let half = g.measureText(l2).width / 2;
      if (v.over) { g.font = `600 12.5px ${font}`; half = Math.max(half, g.measureText(l3).width / 2); }
      const nm = s.id === 'sun' ? `${s.name} (비교를 위해 함께 표시)` : s.name;   // 태양은 밤하늘에 실제로 같이 보이지 않음
      g.font = `700 14px ${font}`;
      half = Math.max(half, g.measureText(nm).width / 2);
      const lx = clamp(x, half + 8, L.skyW - half - 8);
      g.fillStyle = s.ui;
      g.fillText(nm, lx, ty);
      g.font = `600 13px ${font}`; g.fillStyle = '#e9f0fb';
      g.fillText(l2, lx, ty + 17);
      if (v.over) {
        g.font = `600 12.5px ${font}`; g.fillStyle = '#ffcc4d';
        g.fillText(l3, lx, ty + 34);
      }
    }

    // ---- 등급 자 ----
    drawRuler(st, font);

    // ---- 거리 축 ----
    g.fillStyle = '#0a1122'; g.fillRect(0, L.skyH, W, H - L.skyH);
    g.strokeStyle = 'rgba(150,175,220,.25)'; g.beginPath(); g.moveTo(0, L.skyH + 0.5); g.lineTo(W, L.skyH + 0.5); g.stroke();
    g.font = `700 14px ${font}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#cfe0ff';
    g.fillText('지구에서 별까지의 거리', 12, L.skyH + 15);
    g.font = `400 13px ${font}`; g.fillStyle = '#a9b8d8';
    g.textAlign = 'right';
    g.fillText(L.portrait ? '굵은 눈금 한 칸마다 거리 10배' : '굵은 눈금(1·10·100·1000 pc) 한 칸마다 거리 10배', W - 12, L.skyH + 15);

    // 레인
    STARS.forEach((s, i) => {
      const y = laneY(i);
      if (st.sel === s.id) { g.fillStyle = 'rgba(79,179,255,.12)'; g.fillRect(L.earthW, y - L.laneH / 2 + 1, W - L.earthW, L.laneH - 2); }
      g.strokeStyle = 'rgba(150,175,220,.18)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L.x0, y); g.lineTo(L.x1, y); g.stroke();
    });
    // 생략 칸 (태양 거리)
    const cx0 = L.earthW + 4, cx1 = L.x0 - 12;
    g.fillStyle = 'rgba(255,201,77,.07)'; g.strokeStyle = 'rgba(255,201,77,.35)'; g.setLineDash([4, 4]);
    g.fillRect(cx0, L.laneTop, cx1 - cx0, L.laneBot - L.laneTop); g.strokeRect(cx0, L.laneTop, cx1 - cx0, L.laneBot - L.laneTop); g.setLineDash([]);
    g.fillStyle = '#d9b75a'; g.font = `600 12.5px ${font}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(L.portrait ? '아주 가까움' : '아주 가까움(생략)', (cx0 + cx1) / 2, L.laneBot + 4);
    // 물결 (끊김 표시)
    g.strokeStyle = '#8aa0c8'; g.lineWidth = 1.5;
    for (const dx of [-7, -2]) {
      g.beginPath();
      for (let yy = L.laneTop; yy <= L.laneBot; yy += 2) { const xx = L.x0 + dx + Math.sin(yy / 5) * 2; yy === L.laneTop ? g.moveTo(xx, yy) : g.lineTo(xx, yy); }
      g.stroke();
    }
    // 눈금
    g.textBaseline = 'top'; g.font = `600 13px ${font}`;
    for (let e = -1; e <= 3; e++) for (let k = 1; k <= 9; k++) {
      const D = k * Math.pow(10, e);
      if (D < PC_MIN - 1e-9 || D > PC_MAX + 1e-9) continue;
      const x = xOf(D), major = k === 1;
      g.strokeStyle = major ? 'rgba(200,215,255,.55)' : 'rgba(200,215,255,.18)';
      g.lineWidth = major ? 1.2 : 1;
      g.beginPath(); g.moveTo(x, L.laneTop); g.lineTo(x, L.laneBot); g.stroke();
      if (major) { g.fillStyle = '#b8c7e2'; g.textAlign = 'center'; g.fillText(`${D} pc`, x, L.laneBot + 4); }
    }
    // 0.5 눈금 글자는 '생략' 칸 이름과 붙지 않게 눈금 오른쪽에
    g.fillStyle = '#93a6c8'; g.textAlign = 'left'; g.fillText('0.5', xOf(0.5) + 3, L.laneBot + 4);
    // 10 pc 선
    const x10 = xOf(10);
    g.strokeStyle = '#ffcc4d'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x10, L.laneTop - 6); g.lineTo(x10, L.laneBot + 2); g.stroke();
    g.fillStyle = '#ffcc4d'; g.font = `800 13px ${font}`; g.textBaseline = 'bottom';
    g.fillText('10 pc', x10, L.laneTop - 6);
    // 지구
    const ex = L.earthW / 2 + 2, ey = (L.laneTop + L.laneBot) / 2;
    const eg = g.createRadialGradient(ex - 5, ey - 5, 2, ex, ey, 17);
    eg.addColorStop(0, '#9ee0ff'); eg.addColorStop(0.6, '#2f7fd6'); eg.addColorStop(1, '#174a8c');
    g.fillStyle = eg; g.beginPath(); g.arc(ex, ey, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4fb56b'; g.beginPath(); g.ellipse(ex - 4, ey - 2, 6, 4, 0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#cfe0ff'; g.font = `700 13px ${font}`; g.textBaseline = 'top';
    g.fillText('지구', ex, ey + 20);

    // 별 아이콘
    STARS.forEach((s, i) => {
      const y = laneY(i), D = st.dist[s.id];
      // 원래 위치 표시
      const xo = xOf(s.dist);
      g.strokeStyle = s.ui; g.globalAlpha = 0.6; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(xo, y - 10); g.lineTo(xo, y + 10); g.stroke();
      g.globalAlpha = 1;
      const x = xOf(D), sel = st.sel === s.id;
      g.fillStyle = s.ui;
      star5(x, y, sel ? 12 : 10);
      g.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.4)'; g.lineWidth = sel ? 2 : 1; g.stroke();
      // 이름표: 오른쪽 공간이 없으면 왼쪽
      g.font = `700 13px ${font}`; g.textBaseline = 'middle';
      const label = sel ? `${s.name} · ${D < 0.01 ? '1 AU' : D < 99.95 ? (Math.round(D * 10) / 10).toFixed(1) + ' pc' : Math.round(D) + ' pc'}` : s.name;
      const tw = g.measureText(label).width;
      const right = x + 16 + tw < L.x1 + 20;
      g.textAlign = right ? 'left' : 'right';
      g.fillStyle = sel ? '#fff' : '#c8d4ea';
      if (s.id === 'sun' && D < PC_MIN) { g.textAlign = 'center'; g.font = `700 12px ${font}`; g.textBaseline = 'top'; g.fillText(label, x, y + 12); }
      else g.fillText(label, right ? x + 16 : x - 16, y);
    });
  }

  function star5(x, y, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  }

  function drawRuler(st, font) {
    const x = L.rulerX, top = L.magTop, bot = L.magBot;
    g.fillStyle = 'rgba(10,17,34,.82)';
    g.fillRect(L.skyW, 0, L.rulerW, L.skyH);
    g.strokeStyle = 'rgba(150,175,220,.25)'; g.beginPath(); g.moveTo(L.skyW + 0.5, 0); g.lineTo(L.skyW + 0.5, L.skyH); g.stroke();
    g.fillStyle = '#cfe0ff'; g.font = `700 13px ${font}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText('겉보기 등급', L.skyW + L.rulerW / 2, 8);
    // 막대 (위가 밝음)
    const grad = g.createLinearGradient(0, top, 0, bot);
    grad.addColorStop(0, '#fff6cf'); grad.addColorStop(0.3, '#a9b8d8'); grad.addColorStop(1, '#1d2740');
    g.fillStyle = grad; g.fillRect(x - 4, top, 8, bot - top);
    // 맨눈으로 안 보이는 범위 (6등급보다 어두움) — 빗금
    const y6 = yOfMag(NAKED_EYE);
    g.save(); g.beginPath(); g.rect(x - 4, y6, 8, bot - y6); g.clip();
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1;
    for (let yy = y6 - 8; yy < bot + 8; yy += 5) { g.beginPath(); g.moveTo(x - 4, yy + 8); g.lineTo(x + 4, yy); g.stroke(); }
    g.restore();
    // 끊김 표시 (눈금 간격이 바뀌는 곳) — 막대 폭 안에만 그려 별 표시(▶)와 겹치지 않게
    for (const mb of [MAG_BREAK, MAG_BOT]) {
      const yb = yOfMag(mb) + (mb === MAG_BREAK ? -3 : 3);
      g.fillStyle = 'rgba(10,17,34,1)'; g.fillRect(x - 5, yb - 3, 10, 6);
      g.strokeStyle = '#8aa0c8'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x - 5, yb - 1); g.lineTo(x + 5, yb - 4); g.moveTo(x - 5, yb + 4); g.lineTo(x + 5, yb + 1); g.stroke();
    }
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const ticks = [-27, -20, -10, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16];
    for (const m of ticks) {
      const y = yOfMag(m), strong = m === 0 || m === 1 || m === 6;
      g.strokeStyle = strong ? '#ffcc4d' : 'rgba(200,215,255,.6)'; g.lineWidth = strong ? 2 : 1;
      g.beginPath(); g.moveTo(x + 4, y); g.lineTo(x + (strong ? 13 : 9), y); g.stroke();
      g.font = `${strong ? 800 : 500} ${strong ? 13 : 12}px ${font}`;
      g.fillStyle = strong ? '#ffcc4d' : '#a9b8d8';
      g.fillText(String(m), x + 15, y);
    }
    g.font = `600 12.5px ${font}`; g.fillStyle = '#a9b8d8'; g.textAlign = 'center';
    g.fillText('↑ 밝다', x, top - 14);
    g.fillText('↓ 어둡다', x, bot + 12);
    // 별 표시 (겹치지 않게 밀기)
    const items = STARS.map(s => ({ s, m: magAt(s, st.dist[s.id]) }))
      .map(o => ({ ...o, y0: yOfMag(o.m) })).sort((a, b) => a.y0 - b.y0);
    let last = -1e9;
    const GAP = 17;
    for (const o of items) { o.y = Math.max(o.y0, last + GAP); last = o.y; }
    const over = last - (bot + 8);
    if (over > 0) for (const o of items) o.y -= over;
    for (let i = items.length - 2; i >= 0; i--) items[i].y = Math.min(items[i].y, items[i + 1].y - GAP);
    for (const o of items) {
      g.fillStyle = o.s.ui;
      g.beginPath(); g.moveTo(x - 7, o.y0); g.lineTo(x - 15, o.y0 - 5); g.lineTo(x - 15, o.y0 + 5); g.closePath(); g.fill();
      if (Math.abs(o.y - o.y0) > 1) { g.strokeStyle = o.s.ui; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 15, o.y0); g.lineTo(x - 19, o.y); g.stroke(); }
      g.font = `${st.sel === o.s.id ? 800 : 600} 12.5px ${font}`; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(o.s.name, x - 19, o.y);
    }
  }

  // ---- 끌기 ----
  let drag = null;
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function hitStar(px, py) {
    const st = getState();
    let best = null, bd = 26;
    STARS.forEach((s, i) => {
      const dx = px - xOf(st.dist[s.id]), dy = py - laneY(i);
      const dd = Math.hypot(dx, dy);
      if (dd < bd) { bd = dd; best = s; }
    });
    return best;
  }
  function hitSky(px, py) {
    if (py > L.skyH || px > L.skyW) return null;
    for (const s of STARS) {
      const x = s.sky[0] * L.skyW, y = s.sky[1] * (L.skyH - 40) + 24;
      if (Math.hypot(px - x, py - y) < 30) return s;
    }
    return null;
  }
  function laneAt(py) {
    if (py < L.laneTop || py > L.laneBot) return null;
    return STARS[clamp(Math.floor((py - L.laneTop) / L.laneH), 0, 3)];
  }
  canvas.addEventListener('pointerdown', e => {
    if (isLocked()) return;
    const [px, py] = pos(e);
    const s = hitStar(px, py);
    if (s) {
      onSelect(s.id);
      drag = { id: s.id, pid: e.pointerId, dx: px - xOf(getState().dist[s.id]) };
      if (getState().dist[s.id] < PC_MIN) drag.dx = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      onDragStart(s.id);
      e.preventDefault();
      return;
    }
    const k = hitSky(px, py) || laneAt(py);
    if (k) onSelect(k.id);
  });
  canvas.addEventListener('pointermove', e => {
    const [px, py] = pos(e);
    if (drag && e.pointerId === drag.pid) {
      let D = dOfX(px - drag.dx);
      if (Math.abs(D - 10) <= 0.3) D = 10;
      onDrag(drag.id, D);
    } else if (e.pointerType === 'mouse') {
      canvas.style.cursor = hitStar(px, py) ? 'grab' : (hitSky(px, py) || laneAt(py)) ? 'pointer' : '';
    }
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const id = drag.id; drag = null; canvas.style.cursor = '';
    onDragEnd(id);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return {
    layout, draw,
    // 반짝임은 품질 '높음'에서만 → 낮음이거나 멈춤이면 바뀐 것이 있을 때만 다시 그림
    tick(dt) { time += dt; if (quality === 'high' && dt > 0) draw(); },
    setQuality(q) { quality = q; layout(); },
    cancelDrag() { drag = null; },
    get dragging() { return !!drag; },
  };
}
