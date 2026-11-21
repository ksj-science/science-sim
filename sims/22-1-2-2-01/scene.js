/*
 * 22-1-2-2-01 장면 그리기 엔진 (캔버스)
 *  - 배경(하늘·산·숲·풀밭·마른 땅·강), 토끼(털 질감, 앉기·뛰기·정면), 매(깃털, 날갯짓·급강하·발톱 펴기·낚아채기)를
 *    코드로 직접 그립니다. 외부 이미지 없음.
 *  - 논리 좌표 1000×700 (화면 비율에 맞게 가운데를 기준으로 잘라 채움)
 */
(function () {
  'use strict';

  /* ---------------- 공통 도구 ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function strHash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function makeNoise(seed) {
    function h(i, j) {
      var n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177); n = n ^ (n >>> 16);
      return (n >>> 0) / 4294967295;
    }
    function sm(t) { return t * t * (3 - 2 * t); }
    function v(x, y) {
      var i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j);
      var a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    return function (x, y, oct) {
      var s = 0, amp = 0.5, f = 1, norm = 0;
      for (var k = 0; k < (oct || 4); k++) { s += amp * v(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
      return s / norm;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hex(c) { c = c.replace('#', ''); return [parseInt(c.substr(0, 2), 16), parseInt(c.substr(2, 2), 16), parseInt(c.substr(4, 2), 16)]; }
  var HC = {};
  function H(c) { return HC[c] || (HC[c] = hex(c)); }
  function mixA(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgb(a, al) { return 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + (al == null ? 1 : al) + ')'; }
  function mix(c1, c2, t) { return rgb(mixA(H(c1), H(c2), clamp(t, 0, 1))); }
  function mix3(cols, v) {   // cols = [어두운, 기본, 밝은] — v 0~1
    v = clamp(v, 0, 1);
    return v < 0.5 ? mixA(H(cols[0]), H(cols[1]), v * 2) : mixA(H(cols[1]), H(cols[2]), (v - 0.5) * 2);
  }
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function poly(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
  function inside(pts, x, y) {
    var c = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function bbox(pts) {
    var b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    pts.forEach(function (p) { b.x0 = Math.min(b.x0, p[0]); b.y0 = Math.min(b.y0, p[1]); b.x1 = Math.max(b.x1, p[0]); b.y1 = Math.max(b.y1, p[1]); });
    return b;
  }
  function ell(cx, cy, rx, ry, rot, n) {
    n = n || 56; var c = Math.cos(rot || 0), s = Math.sin(rot || 0), out = [];
    for (var i = 0; i < n; i++) { var t = i / n * Math.PI * 2, x = rx * Math.cos(t), y = ry * Math.sin(t); out.push([cx + x * c - y * s, cy + x * s + y * c]); }
    return out;
  }
  // 잎 모양(귀·깃털): 밑동(bx,by)에서 a 방향으로 길이 L, 폭 W
  function leaf(bx, by, a, L, W, opts) {
    opts = opts || {};
    var d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]], left = [], right = [], N = 22;
    for (var i = 0; i <= N; i++) {
      var s = i / N, hw;
      if (opts.feather) hw = W / 2 * (s < 0.12 ? 0.55 + s / 0.12 * 0.45 : 1 - Math.pow((s - 0.12) / 0.88, 2.4) * 0.75);
      else hw = W / 2 * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * s)), 0.75) * (s > 0.92 ? 1 - (s - 0.92) * 4 : 1);
      var cx = bx + d[0] * L * s, cy = by + d[1] * L * s;
      var bend = (opts.bend || 0) * Math.sin(Math.PI * s) * L;
      cx += n[0] * bend; cy += n[1] * bend;
      left.push([cx + n[0] * hw, cy + n[1] * hw]); right.push([cx - n[0] * hw, cy - n[1] * hw]);
    }
    return left.concat(right.reverse());
  }

  /* =========================================================
   *  토끼
   * ========================================================= */
  var RPAL = {
    white: { fur: ['#b8b2a6', '#e9e5dc', '#fffdf8'], belly: ['#cfcac0', '#f3f1eb', '#ffffff'], tick: null, nose: '#d99a96', inner: ['#e6b0aa', '#c88c87'], whisker: 'rgba(120,110,100,.45)', tail: ['#d9d6cf', '#f7f6f2', '#ffffff'], eyeRing: null },
    gray:  { fur: ['#4d4d50', '#8b8a88', '#c4c1bb'], belly: ['#8e8b86', '#cfccc5', '#ecebe6'], tick: '#2a2a2c', nose: '#9c7c76', inner: ['#cfa29c', '#9a7470'], whisker: 'rgba(235,235,230,.55)', tail: ['#bdbbb6', '#ecebe7', '#ffffff'], eyeRing: '#d6d3cc' },
    brown: { fur: ['#47321f', '#86643d', '#bf9a66'], belly: ['#9c8566', '#d8c6a6', '#efe4cf'], tick: '#22170e', nose: '#8d675a', inner: ['#cfa092', '#99705f'], whisker: 'rgba(240,232,220,.55)', tail: ['#cfc6b8', '#f1ece2', '#ffffff'], eyeRing: '#e2cfae' }
  };
  var PI = Math.PI;
  function rabbitParts(pose) {
    var P = [];
    function add(pts, tone, flow, o) { o = o || {}; o.pts = pts; o.tone = tone; o.flow = flow; P.push(o); return o; }
    var back = function () { return PI + 0.32; }, down = function () { return PI / 2 + 0.25; };
    if (pose === 'front') {
      add(leaf(-8, -62, -1.8, 29, 12), 'fur', function () { return -1.8; }, { light: 0.06, inner: leaf(-8.2, -64, -1.8, 23, 6), furLen: 2.2 });
      add(leaf(8, -62, -1.34, 29, 12), 'fur', function () { return -1.34; }, { light: 0.06, inner: leaf(8.2, -64, -1.34, 23, 6), furLen: 2.2 });
      add(ell(-15, -13, 12.5, 12.5, 0), 'fur', down, { furLen: 3.2 });
      add(ell(15, -13, 12.5, 12.5, 0), 'fur', down, { furLen: 3.2 });
      add(ell(0, -25, 23, 25, 0), 'fur', down, { furLen: 4.4 });
      add(ell(-10, -2.5, 7.5, 3.6, 0), 'belly', function () { return PI / 2; }, { noBottom: true, furLen: 1.6 });
      add(ell(10, -2.5, 7.5, 3.6, 0), 'belly', function () { return PI / 2; }, { noBottom: true, furLen: 1.6 });
      add(ell(0, -25, 12, 15, 0), 'belly', down, { furLen: 3, light: 0.08 });
      add(ell(-6.5, -9, 4.2, 8.5, 0.05), 'belly', function () { return PI / 2; }, { furLen: 1.8, noBottom: true });
      add(ell(6.5, -9, 4.2, 8.5, -0.05), 'belly', function () { return PI / 2; }, { furLen: 1.8, noBottom: true });
      var hf = function (x, y) { return Math.atan2(y + 43, x) + 0.2 * Math.sign(x || 1); };
      add(ell(0, -49, 17.5, 15, 0), 'fur', hf, { furLen: 2.6, light: 0.05 });
      add(ell(-8, -42.5, 8.5, 7.5, 0.2), 'fur', hf, { furLen: 2.2 });
      add(ell(8, -42.5, 8.5, 7.5, -0.2), 'fur', hf, { furLen: 2.2 });
      add(ell(0, -40.5, 7, 5, 0), 'belly', hf, { furLen: 1.6, light: 0.05 });
      return { parts: P, eyes: [[-10.8, -51, 3.4, 3.9], [10.8, -51, 3.4, 3.9]], nose: [0, -43.8], front: true };
    }
    var hop = pose === 'hop';
    var o = hop ? { far: [12, -48, -2.5], tail: [-37, -31], body: [-4, -28, 34, 17, -0.05], haunch: [-21, -25, 16, 13.5, 0.1], foot: [-37, -16, 18, 5, 0.55],
                    chest: [16, -28, 11, 11.5, 0], leg: [28, -16, 4.3, 11, -0.65], paw: [33, -7, 5, 2.6, -0.4], head: [29, -40, 15, 12, 0.3], cheek: [31, -36, 9, 8], near: [20, -48, -2.55], eye: [34, -43], nose: [42.2, -35.5] }
              : { far: [17, -56, -1.9], tail: [-34, -22], body: [-4, -26, 30, 24, -0.08], haunch: [-15, -18, 19, 17, 0], foot: [-4, -3.6, 17.5, 4.8, 0.02],
                  chest: [13, -28, 12, 14, 0.2], leg: [17, -11, 4.6, 10.5, 0.1], paw: [19.5, -2.4, 6, 3, 0], head: [21, -45, 16.5, 14.5, 0.35], cheek: [23.5, -39.5, 10.5, 9.5], near: [12, -55, -1.78], eye: [27.4, -47.5], nose: [36.6, -39.4] };
    var nose = o.nose;
    var headFlow = function (x, y) { return Math.atan2(y - nose[1] + 3, x - nose[0]); };
    add(leaf(o.far[0], o.far[1], o.far[2], 29, 11, { bend: 0.03 }), 'fur', function () { return o.far[2]; }, { light: -0.1, furLen: 2.1 });
    add(ell(o.tail[0], o.tail[1], 7.6, 7, 0), 'tail', function (x, y) { return Math.atan2(y - o.tail[1], x - o.tail[0]); }, { furLen: 2.6, dens: 1.2 });
    add(ell.apply(null, o.body), 'fur', back, { furLen: 4.4 });
    add(ell.apply(null, o.haunch), 'fur', function () { return PI + 0.6; }, { furLen: 4 });
    add(ell.apply(null, o.foot), 'fur', function () { return PI + 0.1; }, { furLen: 2, noBottom: !hop, light: 0.05 });
    add(ell.apply(null, o.chest), 'belly', down, { furLen: 3.6 });
    add(ell.apply(null, o.leg), 'belly', function () { return PI / 2; }, { furLen: 1.9, noBottom: !hop });
    add(ell.apply(null, o.paw), 'belly', function () { return 0; }, { furLen: 1.4, noBottom: !hop });
    add(ell(o.head[0], o.head[1], o.head[2], o.head[3], o.head[4]), 'fur', headFlow, { furLen: 2.4, light: 0.05 });
    add(ell(o.cheek[0], o.cheek[1], o.cheek[2], o.cheek[3], 0), 'fur', headFlow, { furLen: 2.1 });
    add(leaf(o.near[0], o.near[1], o.near[2], 31, 12, { bend: 0.04 }), 'fur', function () { return o.near[2]; },
        { furLen: 2.1, light: 0.06, inner: leaf(o.near[0] + 1, o.near[1] - 2, o.near[2], 24, 6) });
    return { parts: P, eyes: [[o.eye[0], o.eye[1], 4.3, 4]], nose: nose, hop: hop };
  }
  function furPart(g, part, pal, R) {
    var pts = part.pts, b = bbox(pts), cols = part.tone === 'belly' ? pal.belly : part.tone === 'tail' ? pal.tail : pal.fur;
    var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hx = (b.x1 - b.x0) / 2 || 1, hy = (b.y1 - b.y0) / 2 || 1, L0 = part.light || 0;
    function sv(x, y) { var nx = (x - cx) / hx, ny = (y - cy) / hy, r2 = nx * nx + ny * ny; return L0 + 0.56 - 0.36 * ny + 0.07 * nx - 0.34 * Math.max(0, r2 - 0.5); }
    g.save(); poly(g, pts); g.clip();
    var gr = g.createLinearGradient(0, b.y0, 0, b.y1);
    gr.addColorStop(0, rgb(mix3(cols, 0.82 + L0))); gr.addColorStop(0.55, rgb(mix3(cols, 0.52 + L0))); gr.addColorStop(1, rgb(mix3(cols, 0.18 + L0)));
    g.fillStyle = gr; g.fillRect(b.x0 - 2, b.y0 - 2, b.x1 - b.x0 + 4, b.y1 - b.y0 + 4);
    var n = Math.round((b.x1 - b.x0) * (b.y1 - b.y0) * 1.5 * (part.dens || 1)), fl = part.furLen || 3;
    g.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x = b.x0 + R() * (b.x1 - b.x0), y = b.y0 + R() * (b.y1 - b.y0);
      if (!inside(pts, x, y)) continue;
      var v = sv(x, y) + (R() - 0.5) * 0.26, col = mix3(cols, v), al = 0.85;
      if (pal.tick && part.tone === 'fur' && R() < 0.17) { col = H(pal.tick); al = 0.55; }
      var a = part.flow(x, y) + (R() - 0.5) * 0.55, L = fl * (0.55 + R() * 0.75);
      g.strokeStyle = rgb(col, al); g.lineWidth = 0.42 + R() * 0.18;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (R() - .5) * .4, y + Math.sin(a) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    }
    // 위쪽 결 따라 반짝이는 털
    for (var k = 0; k < n * 0.08; k++) {
      var x2 = b.x0 + R() * (b.x1 - b.x0), y2 = b.y0 + R() * (b.y1 - b.y0) * 0.55;
      if (!inside(pts, x2, y2)) continue;
      var a2 = part.flow(x2, y2) + (R() - 0.5) * 0.4, L2 = fl * (0.7 + R() * 0.6);
      g.strokeStyle = rgb(mix3(cols, 0.95), 0.6); g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 + Math.cos(a2) * L2, y2 + Math.sin(a2) * L2); g.stroke();
    }
    g.restore();
    // 가장자리 잔털
    for (var j = 0; j < pts.length; j++) {
      var p = pts[j], q = pts[(j + 1) % pts.length];
      if (part.noBottom && p[1] > -3) continue;
      var ex = q[0] - p[0], ey = q[1] - p[1], el = Math.hypot(ex, ey) || 1, nx2 = ey / el, ny2 = -ex / el;
      if (inside(pts, p[0] + nx2 * 0.8, p[1] + ny2 * 0.8)) { nx2 = -nx2; ny2 = -ny2; }
      for (var m = 0; m < 4; m++) {
        var t = R(), x3 = p[0] + ex * t, y3 = p[1] + ey * t, fa = part.flow(x3, y3);
        var dx = nx2 * 0.65 + Math.cos(fa) * 0.5, dy = ny2 * 0.65 + Math.sin(fa) * 0.5, dl = Math.hypot(dx, dy) || 1, L3 = fl * (0.5 + R() * 0.8);
        g.strokeStyle = rgb(mix3(cols, sv(x3, y3) + (R() - 0.5) * 0.2), 0.75); g.lineWidth = 0.38;
        g.beginPath(); g.moveTo(x3 - dx / dl * 0.6, y3 - dy / dl * 0.6); g.lineTo(x3 + dx / dl * L3, y3 + dy / dl * L3); g.stroke();
      }
    }
    // 귀 안쪽
    if (part.inner) {
      var ib = bbox(part.inner);
      g.save(); poly(g, part.inner); g.clip();
      var ig = g.createLinearGradient(ib.x0, ib.y0, ib.x1, ib.y1);
      ig.addColorStop(0, pal.inner[0]); ig.addColorStop(1, pal.inner[1]);
      g.globalAlpha = 0.9; g.fillStyle = ig; g.fillRect(ib.x0, ib.y0, ib.x1 - ib.x0, ib.y1 - ib.y0);
      g.globalAlpha = 0.25; g.strokeStyle = '#a0625e'; g.lineWidth = 0.3;
      for (var vv = 0; vv < 4; vv++) { var sx = ib.x0 + (ib.x1 - ib.x0) * (0.3 + vv * 0.12); g.beginPath(); g.moveTo(sx, ib.y1); g.quadraticCurveTo(sx + 2, (ib.y0 + ib.y1) / 2, sx + (R() - .5) * 3, ib.y0 + 3); g.stroke(); }
      g.restore(); g.globalAlpha = 1;
      for (var e = 0; e < part.inner.length; e++) {   // 안쪽 테두리 잔털
        var ip = part.inner[e];
        g.strokeStyle = rgb(mix3(pal.fur, 0.85), 0.6); g.lineWidth = 0.3;
        g.beginPath(); g.moveTo(ip[0], ip[1]); g.lineTo(ip[0] + (R() - .5) * 1.6, ip[1] + (R() - .5) * 1.6); g.stroke();
      }
    }
  }
  function rabbitDetails(g, info, pal, R) {
    info.eyes.forEach(function (e) {
      var ex = e[0], ey = e[1];
      var sh = g.createRadialGradient(ex, ey, 0, ex, ey, e[2] * 2.2);
      sh.addColorStop(0, 'rgba(0,0,0,.28)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh; g.beginPath(); g.ellipse(ex, ey, e[2] * 2.2, e[3] * 2, 0, 0, PI * 2); g.fill();
      if (pal.eyeRing) { g.fillStyle = rgb(H(pal.eyeRing), 0.75); g.beginPath(); g.ellipse(ex, ey, e[2] + 1.1, e[3] + 1, 0, 0, PI * 2); g.fill(); }
      var eg = g.createRadialGradient(ex - 0.6, ey - 0.6, 0.2, ex, ey, e[2]);
      eg.addColorStop(0, '#5a3720'); eg.addColorStop(0.55, '#24150b'); eg.addColorStop(1, '#070504');
      g.fillStyle = eg; g.beginPath(); g.ellipse(ex, ey, e[2], e[3], 0, 0, PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.ellipse(ex + e[2] * 0.3, ey - e[3] * 0.38, e[2] * 0.3, e[3] * 0.24, -0.4, 0, PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(ex - e[2] * 0.35, ey + e[3] * 0.35, e[2] * 0.15, 0, PI * 2); g.fill();
    });
    var n = info.nose;
    if (info.front) {
      g.fillStyle = pal.nose; g.beginPath(); g.moveTo(n[0] - 2.3, n[1] - 1); g.quadraticCurveTo(n[0], n[1] - 2.3, n[0] + 2.3, n[1] - 1); g.quadraticCurveTo(n[0], n[1] + 1.6, n[0] - 2.3, n[1] - 1); g.fill();
      g.strokeStyle = 'rgba(70,45,40,.6)'; g.lineWidth = 0.45;
      g.beginPath(); g.moveTo(n[0], n[1] + 0.5); g.lineTo(n[0], n[1] + 2.4); g.quadraticCurveTo(n[0] - 1.6, n[1] + 3.6, n[0] - 3, n[1] + 3); g.moveTo(n[0], n[1] + 2.4); g.quadraticCurveTo(n[0] + 1.6, n[1] + 3.6, n[0] + 3, n[1] + 3); g.stroke();
      g.strokeStyle = pal.whisker; g.lineWidth = 0.28;
      [-1, 1].forEach(function (sx) { for (var w = 0; w < 4; w++) { g.beginPath(); g.moveTo(n[0] + sx * 3, n[1] + 1.5); g.quadraticCurveTo(n[0] + sx * 10, n[1] - 1 + w * 1.6, n[0] + sx * (17 + w), n[1] - 3 + w * 3.2); g.stroke(); } });
      return;
    }
    // 옆모습 코·입·수염
    g.fillStyle = pal.nose; g.beginPath(); g.ellipse(n[0] - 0.6, n[1], 1.7, 1.3, 0.5, 0, PI * 2); g.fill();
    g.strokeStyle = 'rgba(60,40,35,.55)'; g.lineWidth = 0.45;
    g.beginPath(); g.moveTo(n[0] - 0.8, n[1] + 1); g.quadraticCurveTo(n[0] - 1.2, n[1] + 3, n[0] - 3.4, n[1] + 3.6); g.stroke();
    g.strokeStyle = pal.whisker; g.lineWidth = 0.28;
    for (var w = 0; w < 5; w++) { g.beginPath(); g.moveTo(n[0] - 2.5, n[1] + 1.2); g.quadraticCurveTo(n[0] + 5, n[1] - 1 + w * 1.5, n[0] + 12 + R() * 3, n[1] - 4 + w * 2.6); g.stroke(); }
  }
  var RB = { x0: -64, y0: -106, w: 128, h: 114 };
  function buildRabbit(color, pose, SPR) {
    var c = makeCanvas(RB.w * SPR, RB.h * SPR), g = c.getContext('2d');
    g.scale(SPR, SPR); g.translate(-RB.x0, -RB.y0);
    var R = mulberry32(strHash(color + pose)), pal = RPAL[color], info = rabbitParts(pose);
    info.parts.forEach(function (p) { furPart(g, p, pal, R); });
    rabbitDetails(g, info, pal, R);
    return c;
  }

  /* =========================================================
   *  매
   * ========================================================= */
  var HP = { dark: '#3a281b', mid: '#6b4a30', rufous: '#9b6a40', light: '#c8a679', cream: '#efe5d2', streak: '#5a3d28', foot: '#e3b73a', talon: '#161412' };
  function darken(c, k) { return k ? mix(c, '#140d08', k) : c; }
  function feather(g, bx, by, a, L, W, c1, c2, bars, R, opt) {
    opt = opt || {};
    var pts = leaf(bx, by, a, L, W, { feather: true, bend: opt.bend || 0 }), d = [Math.cos(a), Math.sin(a)];
    var gr = g.createLinearGradient(bx, by, bx + d[0] * L, by + d[1] * L);
    gr.addColorStop(0, c1); gr.addColorStop(0.75, c2); gr.addColorStop(1, opt.tip || c2);
    poly(g, pts); g.fillStyle = gr; g.fill();
    g.save(); poly(g, pts); g.clip();
    if (bars) {
      g.strokeStyle = 'rgba(25,15,8,.42)'; g.lineWidth = Math.max(1, L * 0.05);
      for (var b = 1; b <= bars; b++) {
        var s = 0.12 + b / (bars + 1) * 0.8, px = bx + d[0] * L * s, py = by + d[1] * L * s;
        g.beginPath(); g.moveTo(px - d[1] * W, py + d[0] * W); g.lineTo(px + d[1] * W, py - d[0] * W); g.stroke();
      }
    }
    g.strokeStyle = 'rgba(255,240,220,.08)'; g.lineWidth = 0.3;   // 깃가지
    for (var k = 0; k < L / 1.6; k++) {
      var s2 = k * 1.6 / L, qx = bx + d[0] * L * s2, qy = by + d[1] * L * s2, sd = k % 2 ? 1 : -1;
      g.beginPath(); g.moveTo(qx, qy); g.lineTo(qx + (d[0] * 0.6 - d[1] * sd) * W * 0.6, qy + (d[1] * 0.6 + d[0] * sd) * W * 0.6); g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(230,210,180,.45)'; g.lineWidth = 0.35;   // 깃대
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + d[0] * L * 0.93, by + d[1] * L * 0.93); g.stroke();
    g.strokeStyle = 'rgba(20,12,6,.55)'; g.lineWidth = 0.4; poly(g, pts); g.stroke();
  }
  function wing(g, S, ang, lenF, spread, dk, R) {
    var d = [Math.cos(ang), Math.sin(ang)], n1 = [-d[1], d[0]], n = n1[0] < 0 ? n1 : [-n1[0], -n1[1]];
    if (Math.abs(n[0]) < 0.25) n = n1[1] > 0 ? n1 : [-n1[0], -n1[1]];
    var L = 64 * lenF, wr = [S[0] + d[0] * L * 0.5, S[1] + d[1] * L * 0.5];
    function nd(v) { var l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; }
    // 첫째날개깃(손가락처럼 벌어짐)
    for (var i = 6; i >= 0; i--) {
      var t = i / 6, base = [wr[0] + d[0] * L * 0.03 * (6 - i) + n[0] * (2 + t * 7), wr[1] + d[1] * L * 0.03 * (6 - i) + n[1] * (2 + t * 7)];
      var dir = nd([d[0] * (1 - t * 0.55 * spread) + n[0] * t * 0.85 * spread, d[1] * (1 - t * 0.55 * spread) + n[1] * t * 0.85 * spread]);
      feather(g, base[0], base[1], Math.atan2(dir[1], dir[0]), L * (0.86 - t * 0.22) * (0.85 + 0.15 * spread), i < 3 ? 6 : 7.2,
        darken(i >= 3 ? '#cfc7ba' : '#3a2a1e', dk), darken('#1a120c', dk), 0, R, { tip: darken('#0c0805', dk), bend: -0.04 });
    }
    // 둘째날개깃
    for (var j = 8; j >= 0; j--) {
      var s = 0.06 + j * 0.055, b2 = [S[0] + d[0] * L * s + n[0] * 5, S[1] + d[1] * L * s + n[1] * 5];
      var dir2 = nd([n[0] + d[0] * 0.25, n[1] + d[1] * 0.25]);
      feather(g, b2[0], b2[1], Math.atan2(dir2[1], dir2[0]), (24 + 8 * spread) * (0.9 + R() * 0.15), 8.6,
        darken(j > 5 ? '#b9b0a2' : '#3b2a1e', dk), darken('#1d140d', dk), 2, R, { tip: darken('#140d08', dk) });
    }
    // 덮깃 부분
    var lead = [], trail = [];
    for (var k = 0; k <= 14; k++) {
      var u = k / 14 * 0.62;
      lead.push([S[0] + d[0] * L * u - n[0] * 3.2 * Math.sin(PI * u / 0.62), S[1] + d[1] * L * u - n[1] * 3.2 * Math.sin(PI * u / 0.62)]);
      var w = (15 * spread + 5) * (1 - u * 0.55);
      trail.push([S[0] + d[0] * L * u + n[0] * w, S[1] + d[1] * L * u + n[1] * w]);
    }
    var arm = lead.concat(trail.reverse()), ab = bbox(arm);
    var ag = g.createLinearGradient(S[0] - n[0] * 4, S[1] - n[1] * 4, S[0] + n[0] * 20, S[1] + n[1] * 20);
    ag.addColorStop(0, darken('#5a4130', dk)); ag.addColorStop(1, darken('#2e2017', dk));
    poly(g, arm); g.fillStyle = ag; g.fill();
    g.save(); poly(g, arm); g.clip();
    for (var r = 0; r < 4; r++) for (var q = 0; q < 12; q++) {   // 비늘처럼 겹친 덮깃
      var uu = q / 12 * 0.6 + (r % 2) * 0.025, ww = (15 * spread + 5) * (1 - uu * 0.55) * (0.15 + r * 0.24);
      var px = S[0] + d[0] * L * uu + n[0] * ww, py = S[1] + d[1] * L * uu + n[1] * ww, fa = Math.atan2(n[1] + d[1] * 0.4, n[0] + d[0] * 0.4);
      feather(g, px, py, fa, 7.5 - r * 0.4, 5, darken(r < 2 ? '#4a3527' : '#33241a', dk), darken(r < 2 ? '#6e5038' : '#2a1d14', dk), 0, R, { tip: darken(r < 1 ? '#a07a50' : '#5a4130', dk) });
    }
    g.restore();
    g.strokeStyle = rgb(H('#e8d2b0'), 0.35 * (1 - dk)); g.lineWidth = 1.2;
    g.beginPath(); lead.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke();
  }
  function hawkBody(g, f, R) {
    // 꽁지
    var spr = f.tail, tp = [[-32, -4], [-80, -6 - 8 * spr], [-84, 4], [-80, 13 + 8 * spr], [-32, 9]];
    var tg = g.createLinearGradient(-32, 0, -84, 0); tg.addColorStop(0, '#3a2a1e'); tg.addColorStop(1, '#1e150e');
    g.beginPath(); g.moveTo(tp[0][0], tp[0][1]); g.lineTo(tp[1][0], tp[1][1]); g.quadraticCurveTo(-90, 4, tp[3][0], tp[3][1]); g.lineTo(tp[4][0], tp[4][1]); g.closePath();
    g.fillStyle = tg; g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(120,100,80,.25)'; g.lineWidth = 1.6;
    for (var b = 0; b < 4; b++) { var x = -42 - b * 9; g.beginPath(); g.moveTo(x, -30); g.lineTo(x - 2, 40); g.stroke(); }
    g.strokeStyle = 'rgba(20,12,6,.35)'; g.lineWidth = 0.4;
    for (var k = 0; k < 7; k++) { g.beginPath(); g.moveTo(-34, 2.5); g.lineTo(-84, -6 - 8 * spr + k * (19 + 16 * spr) / 6); g.stroke(); }
    g.restore();
    // 다리(깃털 바지)
    function trousers(cx, cy, rot) {
      var tp2 = ell(cx, cy, 10, 8, rot, 30); poly(g, tp2);
      var gg = g.createLinearGradient(cx, cy - 8, cx, cy + 8); gg.addColorStop(0, '#5a4130'); gg.addColorStop(1, '#3a2a1e'); g.fillStyle = gg; g.fill();
      g.save(); poly(g, tp2); g.clip(); g.strokeStyle = 'rgba(150,115,80,.35)'; g.lineWidth = 0.8;
      for (var s = -8; s < 10; s += 2.6) { g.beginPath(); g.moveTo(cx - 10, cy + s); g.quadraticCurveTo(cx, cy + s + 2, cx + 10, cy + s); g.stroke(); }
      g.restore();
    }
    function foot(hx, hy, fx, fy, grip) {
      g.strokeStyle = HP.foot; g.lineCap = 'round'; g.lineWidth = 3.6;
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(fx, fy); g.stroke();
      g.strokeStyle = 'rgba(150,100,20,.6)'; g.lineWidth = 0.4;
      for (var s = 0.2; s < 0.95; s += 0.13) { var px = hx + (fx - hx) * s, py = hy + (fy - hy) * s; g.beginPath(); g.moveTo(px - 1.6, py); g.lineTo(px + 1.6, py); g.stroke(); }
      var toes = grip ? [[-0.2, 7], [0.5, 8], [1.2, 6.5], [PI - 0.3, 5.5]] : [[-0.5, 8], [0.15, 9], [0.8, 8], [PI - 0.6, 6]];
      toes.forEach(function (t) {
        var tx = fx + Math.cos(t[0]) * t[1], ty = fy + Math.sin(t[0]) * t[1];
        g.strokeStyle = HP.foot; g.lineWidth = 2.2; g.beginPath(); g.moveTo(fx, fy); g.lineTo(tx, ty); g.stroke();
        g.strokeStyle = HP.talon; g.lineWidth = 1.5; g.beginPath(); g.moveTo(tx, ty);
        g.quadraticCurveTo(tx + Math.cos(t[0]) * 3, ty + Math.sin(t[0]) * 3, tx + Math.cos(t[0] + 1.3) * 3.4, ty + Math.sin(t[0] + 1.3) * 3.4); g.stroke();
      });
    }
    if (f.legs === 'tuck') trousers(-6, 12, -0.2);
    // 몸통
    var bp = ell(0, 1, 40, 15.5, -0.05, 64);
    var bg = g.createLinearGradient(0, -15, 0, 17); bg.addColorStop(0, '#3c2a1e'); bg.addColorStop(0.5, '#2c1f16'); bg.addColorStop(1, '#3d2b1f');
    poly(g, bp); g.fillStyle = bg; g.fill();
    g.save(); poly(g, bp); g.clip(); g.lineCap = 'round';
    for (var i = 0; i < 900; i++) {
      var x = -40 + R() * 80, y = -15 + R() * 31; if (!inside(bp, x, y)) continue;
      var low = y > 2, a = PI + 0.12 + (R() - 0.5) * 0.3, L = 2.5 + R() * 2.5, col;
      col = rgb(mixA(H('#1c130c'), H(low ? '#5a4130' : '#7a5a3c'), R() * 0.9), 0.8);
      g.strokeStyle = col; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
    }
    g.restore();
    if (f.legs === 'fwd') { trousers(9, 13, 0.5); foot(13, 18, 30, 30, false); foot(9, 19, 24, 34, false); }
    if (f.legs === 'down') { trousers(8, 13, 1.2); foot(10, 19, 15, 37, true); foot(14, 18, 20, 35, true); }
    // 머리
    var hp = ell(37, -7, 12.5, 11, 0.05, 48);
    var hg = g.createLinearGradient(26, -18, 40, 4); hg.addColorStop(0, '#d2a35a'); hg.addColorStop(0.45, '#9a6c3a'); hg.addColorStop(1, '#2e2017');
    poly(g, hp); g.fillStyle = hg; g.fill();
    g.save(); poly(g, hp); g.clip();
    for (var j = 0; j < 260; j++) {
      var x2 = 25 + R() * 25, y2 = -18 + R() * 22; if (!inside(hp, x2, y2)) continue;
      var a2 = Math.atan2(y2 + 6, x2 - 52) + (R() - 0.5) * 0.3, L2 = 1.6 + R() * 1.6;
      g.strokeStyle = y2 > -5 ? rgb(mixA(H('#1e150e'), H('#5a4130'), R()), 0.7) : rgb(mixA(H('#8a5e2e'), H('#e3b86c'), R()), 0.75);
      g.lineWidth = 0.5; g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 + Math.cos(a2) * L2, y2 + Math.sin(a2) * L2); g.stroke();
    }
    g.fillStyle = 'rgba(40,25,15,.45)'; g.beginPath(); g.ellipse(41, -3, 3, 6, 0.4, 0, PI * 2); g.fill();   // 뺨 줄무늬
    g.restore();
    // 눈 + 눈썹뼈
    var ig = g.createRadialGradient(42.6, -10.5, 0.3, 42.6, -10.5, 3.2); ig.addColorStop(0, '#e9b54a'); ig.addColorStop(1, '#8b5a17');
    g.fillStyle = ig; g.beginPath(); g.arc(42.6, -10.5, 3.2, 0, PI * 2); g.fill();
    g.fillStyle = '#0b0705'; g.beginPath(); g.arc(43, -10.5, 1.55, 0, PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(43.7, -11.4, 0.7, 0, PI * 2); g.fill();
    g.fillStyle = '#2a1c12'; g.beginPath(); g.moveTo(38.5, -13.2); g.quadraticCurveTo(43, -16.6, 47.5, -12.6); g.quadraticCurveTo(43, -14.2, 38.5, -12); g.fill();
    // 부리
    g.fillStyle = '#e6be3f'; g.beginPath(); g.ellipse(47.2, -8.6, 2.6, 3.1, 0.2, 0, PI * 2); g.fill();
    var kg = g.createLinearGradient(47, -12, 55, 2); kg.addColorStop(0, '#55555c'); kg.addColorStop(1, '#141417');
    g.fillStyle = kg; g.beginPath(); g.moveTo(48, -11.4); g.bezierCurveTo(53, -12.2, 56.4, -8, 55.8, -2.6); g.bezierCurveTo(55.5, 0.4, 53.4, 1.6, 52.4, 0.6);
    g.bezierCurveTo(53.4, -1.4, 52.4, -3.6, 50, -3.8); g.lineTo(47.8, -5.4); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(49, -10.6); g.quadraticCurveTo(53, -10.6, 54.6, -6); g.stroke();
  }
  var HB = { x0: -125, y0: -135, w: 250, h: 270 };
  var HAWK_FRAMES = {
    soar:  { near: [1.48, 1.22, 1.15], far: [-1.48, 1.22, 1.15], farDk: 0.08, legs: 'tuck', tail: 1 },
    up:    { near: [-1.45, 1, 1], far: [-1.72, 0.92, 0.9], legs: 'tuck', tail: 0.7 },
    mid:   { near: [-0.55, 0.62, 0.9], far: [-0.8, 0.56, 0.85], legs: 'tuck', tail: 0.7 },
    down:  { near: [1.0, 0.95, 1], far: [0.78, 0.82, 0.9], legs: 'tuck', tail: 0.7 },
    glide: { near: [-0.42, 0.8, 1], far: [-0.62, 0.72, 0.95], legs: 'tuck', tail: 0.8 },
    stoop: { near: [PI - 0.2, 0.82, 0.32], far: [PI - 0.3, 0.76, 0.3], legs: 'tuck', tail: 0.1 },
    flare: { near: [-1.95, 1, 1.15], far: [-2.15, 0.92, 1.05], legs: 'fwd', tail: 1.1 },
    cup:   { near: [-1.35, 1, 1], far: [-1.6, 0.92, 0.9], legs: 'down', tail: 0.8 },
    cdown: { near: [0.95, 0.95, 1], far: [0.72, 0.82, 0.9], legs: 'down', tail: 0.8 }
  };
  function buildHawk(name, SPR) {
    var f = HAWK_FRAMES[name], c = makeCanvas(HB.w * SPR, HB.h * SPR), g = c.getContext('2d');
    g.scale(SPR, SPR); g.translate(-HB.x0, -HB.y0);
    var R = mulberry32(strHash('hawk' + name));
    wing(g, f.farDk != null ? [4, -6] : [8, -8], f.far[0], f.far[1], f.far[2], f.farDk != null ? f.farDk : 0.35, R);
    hawkBody(g, f, R);
    wing(g, [2, -5], f.near[0], f.near[1], f.near[2], 0, R);
    return c;
  }

  /* =========================================================
   *  배경
   * ========================================================= */
  function ridgeLine(R, base, amp, rough) {
    var n = 256, h = new Array(n + 1); h[0] = base + (R() - .5) * amp; h[n] = base + (R() - .5) * amp;
    var step = n, sc = amp;
    while (step > 1) { var half = step / 2; for (var i = half; i < n; i += step) h[i] = (h[i - half] + h[i + half]) / 2 + (R() - .5) * sc; sc *= rough; step = half; }
    return h;
  }
  function noiseCanvas(w, h, fn) {   // 저해상도로 계산해 크게 늘려 씀
    var c = makeCanvas(w, h), g = c.getContext('2d'), id = g.createImageData(w, h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var p = fn(x, y), o = (y * w + x) * 4; id.data[o] = p[0]; id.data[o + 1] = p[1]; id.data[o + 2] = p[2]; id.data[o + 3] = p[3]; }
    g.putImageData(id, 0, 0); return c;
  }
  var GROUND_Y = 288;
  function hillNear(x, N) { return 292 - 78 * Math.exp(-Math.pow((x - 330) / 230, 2)) - 26 * Math.exp(-Math.pow((x - 760) / 170, 2)) - 4 * N(x * 0.02, 2, 2); }
  function drawSky(g, R, N) {
    var sk = g.createLinearGradient(0, 0, 0, 300);
    sk.addColorStop(0, '#3b82d4'); sk.addColorStop(0.55, '#79b0e4'); sk.addColorStop(1, '#cfe1ee');
    g.fillStyle = sk; g.fillRect(0, 0, 1000, 320);
    var sg = g.createRadialGradient(860, 70, 0, 860, 70, 320);
    sg.addColorStop(0, 'rgba(255,250,235,.55)'); sg.addColorStop(1, 'rgba(255,250,235,0)');
    g.fillStyle = sg; g.fillRect(0, 0, 1000, 330);
    // 먼 언덕(옅은 청록) + 가까운 큰 초원 언덕
    function hill(fn, top, c1, c2) {
      g.beginPath(); g.moveTo(0, 330);
      for (var x = 0; x <= 1000; x += 5) g.lineTo(x, fn(x));
      g.lineTo(1000, 330); g.closePath();
      var hg = g.createLinearGradient(0, top, 0, 300); hg.addColorStop(0, c1); hg.addColorStop(1, c2); g.fillStyle = hg; g.fill();
    }
    hill(function (x) { return 262 - 18 * Math.sin(x / 120 + 1) - 10 * Math.sin(x / 47) - 8 * N(x * 0.01, 1, 3); }, 230, '#8fb4a4', '#a9c7b6');
    hill(function (x) { return hillNear(x, N); }, 210, '#86a948', '#7da343');
    // 언덕 결(풀 색 얼룩)
    var tex = noiseCanvas(250, 30, function (x, y) { var v = N(x * 0.12, y * 0.4 + 5, 4); return v > 0.5 ? [170, 200, 90, (v - 0.5) * 200] : [60, 100, 30, (0.5 - v) * 200]; });
    g.save(); g.beginPath(); g.moveTo(0, 330);
    for (var x = 0; x <= 1000; x += 5) g.lineTo(x, hillNear(x, N));
    g.lineTo(1000, 330); g.closePath(); g.clip();
    g.globalAlpha = 0.5; g.drawImage(tex, 0, 205, 1000, 100); g.globalAlpha = 1; g.restore();
  }
  function drawMeadow(g, R, N) {
    var mg = g.createLinearGradient(0, GROUND_Y, 0, 700);
    mg.addColorStop(0, '#7fa443'); mg.addColorStop(0.35, '#689a32'); mg.addColorStop(1, '#4f8a2a');
    g.fillStyle = mg; g.fillRect(0, GROUND_Y - 4, 1000, 720 - GROUND_Y);
    var patch = noiseCanvas(220, 90, function (x, y) {
      var v = N(x * 0.05, y * 0.12 / (0.3 + y / 90), 4);
      var c = v > 0.5 ? [150, 190, 70] : [50, 100, 30];
      return [c[0], c[1], c[2], Math.abs(v - 0.5) * 230];
    });
    g.globalAlpha = 0.4; g.drawImage(patch, 0, GROUND_Y, 1000, 700 - GROUND_Y + 10); g.globalAlpha = 1;
    // 짧고 촘촘한 풀
    var blades = [];
    for (var i = 0; i < 26000; i++) {
      var y = GROUND_Y + 1 + (700 - GROUND_Y) * Math.pow(R(), 0.85), x = R() * 1000;
      blades.push([x, y, (y - GROUND_Y) / (700 - GROUND_Y)]);
    }
    blades.sort(function (a, b) { return a[1] - b[1]; });
    g.lineCap = 'round';
    blades.forEach(function (b) {
      var x = b[0], y = b[1], k = b[2], len = 1 + 10 * Math.pow(k, 1.3) * (0.6 + R() * 0.7);
      var v = N(x * 0.012, y * 0.035, 3) * 0.6 + R() * 0.5;
      var col = v < 0.5 ? mixA(H('#3f7a22'), H('#64a032'), v / 0.5) : mixA(H('#64a032'), H('#a5cc5a'), (v - 0.5) / 0.5);
      col = mixA(col, H('#93b26a'), (1 - k) * 0.35);
      var lean = (R() - 0.5) * len * 0.5 + len * 0.1;
      g.strokeStyle = rgb(col, 0.85); g.lineWidth = 0.3 + 1.1 * k;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.2, y - len * 0.55, x + lean, y - len); g.stroke();
    });
    // 은빛 쑥 같은 풀 포기(가까운 곳)
    for (var s = 0; s < 900; s++) {
      var sy = GROUND_Y + 60 + Math.pow(R(), 0.6) * 350, sk = (sy - GROUND_Y) / 412, sx = R() * 1000;
      for (var b2 = 0; b2 < 5; b2++) {
        var ln = (2 + 7 * sk) * (0.5 + R() * 0.6);
        g.strokeStyle = rgb(mixA(H('#9fb59a'), H('#d4e0cc'), R()), 0.75); g.lineWidth = 0.3 + 0.6 * sk;
        g.beginPath(); g.moveTo(sx + (R() - .5) * 5 * sk, sy); g.lineTo(sx + (R() - .5) * 5 * sk, sy - ln); g.stroke();
      }
    }
    for (var f = 0; f < 60; f++) {
      var fy = GROUND_Y + 40 + R() * 370, fk = (fy - GROUND_Y) / 412;
      g.fillStyle = ['rgba(255,255,250,.8)', 'rgba(255,224,90,.8)', 'rgba(170,140,220,.75)'][f % 3];
      g.beginPath(); g.arc(R() * 1000, fy, 0.5 + 1.2 * fk, 0, PI * 2); g.fill();
    }
  }
  function drawDunes(g, R, N, rx0) {   // 사막 쪽 지평선: 모래 고원 + 모래 언덕
    g.beginPath(); g.moveTo(0, GROUND_Y + 6);
    for (var x = 0; x <= 1000; x += 5) g.lineTo(x, hillNear(x, N) + 6);
    g.lineTo(1000, GROUND_Y + 6); g.closePath();
    var pg = g.createLinearGradient(0, 210, 0, GROUND_Y); pg.addColorStop(0, '#e8c48c'); pg.addColorStop(1, '#d9a866'); g.fillStyle = pg; g.fill();
    [[rx0 + 170, 232, 120, 170], [rx0 + 360, 206, 190, 220], [rx0 + 540, 244, 150, 190]].forEach(function (d) {
      var px = d[0], py = d[1], wl = d[2], wr = d[3], base = GROUND_Y + 6;
      g.beginPath(); g.moveTo(px - wl, base);
      g.bezierCurveTo(px - wl * 0.5, base - 4, px - wl * 0.25, py + 6, px, py);
      g.bezierCurveTo(px + wr * 0.3, py + 10, px + wr * 0.6, base - 6, px + wr, base); g.closePath();
      var dg = g.createLinearGradient(0, py, 0, base); dg.addColorStop(0, '#f2c27f'); dg.addColorStop(1, '#e2aa66'); g.fillStyle = dg; g.fill();
      g.beginPath(); g.moveTo(px, py); g.bezierCurveTo(px - wl * 0.25, py + 6, px - wl * 0.5, base - 4, px - wl, base);
      g.lineTo(px - wl * 0.35, base); g.bezierCurveTo(px - wl * 0.15, base - 10, px - 8, py + 20, px, py); g.closePath();
      g.fillStyle = 'rgba(170,100,45,.42)'; g.fill();
      g.strokeStyle = 'rgba(255,228,175,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px, py); g.bezierCurveTo(px - wl * 0.15, base - 10, px - wl * 0.3, base - 2, px - wl * 0.35, base); g.stroke();
    });
    var hz = g.createLinearGradient(0, 200, 0, GROUND_Y + 6); hz.addColorStop(0, 'rgba(230,220,200,0)'); hz.addColorStop(1, 'rgba(230,220,200,.4)');
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = hz; g.fillRect(0, 190, 1000, 110); g.globalCompositeOperation = 'source-over';
  }
  function drawSand(g, R, N) {
    var sg = g.createLinearGradient(0, GROUND_Y, 0, 700);
    sg.addColorStop(0, '#e2b06c'); sg.addColorStop(0.35, '#d49e58'); sg.addColorStop(1, '#bd8547');
    g.fillStyle = sg; g.fillRect(0, GROUND_Y - 6, 1000, 720 - GROUND_Y);
    var patch = noiseCanvas(200, 84, function (x, y) {
      var v = N(x * 0.06 + 50, y * 0.15 / (0.3 + y / 84), 4);
      var c = v > 0.5 ? [242, 200, 140] : [176, 116, 58];
      return [c[0], c[1], c[2], Math.abs(v - 0.5) * 260];
    });
    g.globalAlpha = 0.4; g.drawImage(patch, 0, GROUND_Y - 6, 1000, 700 - GROUND_Y + 16); g.globalAlpha = 1;
    // 바람 무늬(모래 물결)
    for (var w = 0; w < 120; w++) {
      var wy = GROUND_Y + 6 + Math.pow(R(), 1.1) * 400, wk = (wy - GROUND_Y) / 412, wx = R() * 1000, wl = 40 + 160 * wk;
      g.strokeStyle = w % 2 ? 'rgba(255,225,175,.35)' : 'rgba(150,95,45,.22)'; g.lineWidth = 0.4 + 0.9 * wk;
      g.beginPath(); g.moveTo(wx, wy);
      for (var s = 1; s <= 8; s++) g.lineTo(wx + wl * s / 8, wy + Math.sin(s * 0.9 + w) * 1.5 * (0.3 + wk));
      g.stroke();
    }
    // 자갈 알갱이(가까울수록 굵게)
    var cols = ['#8a5f34', '#a7743f', '#6e4c2e', '#efc88f', '#9a7a5a', '#c08a50'];
    for (var i = 0; i < 16000; i++) {
      var y = GROUND_Y + (700 - GROUND_Y) * Math.pow(R(), 0.75), k = (y - GROUND_Y) / (700 - GROUND_Y);
      g.fillStyle = rgb(H(cols[i % cols.length]), 0.45 + 0.3 * k);
      var sz = 0.3 + 1.6 * k * R();
      g.fillRect(R() * 1000, y, sz, sz * 0.7);
    }
    // 드문드문 작은 덤불·돌
    for (var t = 0; t < 14; t++) {
      var tx = R() * 1000, ty = GROUND_Y + 10 + Math.pow(R(), 0.9) * 390, tk = (ty - GROUND_Y) / 412, tr = 2 + 7 * tk;
      if (t % 3 === 0) {
        g.fillStyle = 'rgba(80,50,25,.3)'; g.beginPath(); g.ellipse(tx - tr * 0.4, ty + 1, tr * 1.6, tr * 0.35, 0, 0, PI * 2); g.fill();
        var rg = g.createLinearGradient(tx + tr, ty - tr, tx - tr, ty); rg.addColorStop(0, '#d9b98c'); rg.addColorStop(1, '#7a5a3e');
        g.fillStyle = rg; g.beginPath(); g.ellipse(tx, ty - tr * 0.35, tr * 1.2, tr * 0.7, 0, PI, 0); g.fill();
      } else {
        for (var c = 0; c < 6; c++) { g.fillStyle = rgb(mixA(H('#4f4a26'), H('#8a7c45'), R()), 0.85); g.beginPath(); g.arc(tx + (R() - .5) * tr * 2, ty - tr * 0.4 - R() * tr * 0.6, tr * (0.3 + R() * 0.35), 0, PI * 2); g.fill(); }
      }
    }
  }

  /* =========================================================
   *  장면 엔진
   * ========================================================= */
  function Scene(canvas, wrap, opts) {
    var ctx = canvas.getContext('2d');
    var view = { s: 1, ox: 0, oy: 0, dpr: 1 }, Q = 1;
    var SPR = 2.6;
    var rabbitImg = {}, hawkImg = {};
    ['white', 'gray', 'brown'].forEach(function (c) { rabbitImg[c] = {}; ['sit', 'hop', 'front'].forEach(function (p) { rabbitImg[c][p] = buildRabbit(c, p, SPR); }); });
    Object.keys(HAWK_FRAMES).forEach(function (k) { hawkImg[k] = buildHawk(k, 2.2); });

    // 사이드 패널용 아이콘
    function icon(c, pose, w, h) {
      var cv = makeCanvas(w * 2, h * 2), g = cv.getContext('2d'), img = rabbitImg[c][pose];
      var crop = pose === 'front' ? { x: -30, y: -96, w: 60, h: 100 } : { x: -46, y: -88, w: 92, h: 92 };
      var sc = Math.min(w * 2 / crop.w, h * 2 / crop.h);
      g.drawImage(img, (crop.x - RB.x0) * SPR, (crop.y - RB.y0) * SPR, crop.w * SPR, crop.h * SPR, (w * 2 - crop.w * sc) / 2, (h * 2 - crop.h * sc) / 2, crop.w * sc, crop.h * sc);
      return cv.toDataURL();
    }
    var icons = { front: {}, side: {} };
    ['white', 'gray', 'brown'].forEach(function (c) { icons.front[c] = icon(c, 'front', 30, 40); icons.side[c] = icon(c, 'sit', 56, 52); });

    // 구름
    function makeCloud(seed) {
      var R = mulberry32(seed), c = makeCanvas(360, 170), g = c.getContext('2d'), puffs = [];
      for (var i = 0; i < 22; i++) {
        var t = i / 21, r = 14 + Math.sin(t * PI) * 32 * (0.6 + R() * 0.6);
        puffs.push([45 + t * 270 + (R() - .5) * 24, 128 - r * 0.75 - R() * 12, r]);
      }
      g.filter = 'blur(4px)';
      puffs.forEach(function (p) { g.fillStyle = 'rgba(178,176,200,.95)'; g.beginPath(); g.arc(p[0], p[1] + 6, p[2], 0, PI * 2); g.fill(); });
      g.filter = 'blur(2.5px)';
      puffs.forEach(function (p) {
        var gr = g.createRadialGradient(p[0] - p[2] * 0.25, p[1] - p[2] * 0.45, p[2] * 0.1, p[0], p[1] - 2, p[2] * 0.95);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(250,244,246,.95)'); gr.addColorStop(1, 'rgba(232,222,232,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(p[0], p[1] - 3, p[2] * 0.95, 0, PI * 2); g.fill();
      });
      g.filter = 'none';
      return c;
    }
    var clouds = [[90, 70, 0.9, 6], [420, 115, 0.65, 4], [680, 45, 0.8, 5], [240, 165, 0.45, 3]].map(function (c, i) { return { img: makeCloud(40 + i), x: c[0], y: c[1], s: c[2], v: c[3] }; });

    // 배경 캔버스
    var bgGrass = null, bgSplit = null, riverS = null;
    var river = { pts: null, samples: null, reveal: 0, alpha: 0 };
    function renderGrass() {
      var c = makeCanvas(1000 * Q, 700 * Q), g = c.getContext('2d'); g.scale(Q, Q);
      var R = mulberry32(11), N = makeNoise(5);
      drawSky(g, R, N); drawMeadow(g, R, N);
      return c;
    }
    function riverWidth(y) { var k = clamp((y - GROUND_Y) / (700 - GROUND_Y), 0, 1); return 30 + 74 * k; }
    function sampleRiver(pts) {
      var out = [];
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (var s = 0; s < 1; s += 0.05) {
          var t = s, t2 = t * t, t3 = t2 * t;
          var x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
          var y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
          out.push([x, y]);
        }
      }
      out.push(pts[pts.length - 1].slice());
      for (var j = 0; j < out.length; j++) {
        var a = out[Math.max(0, j - 1)], b = out[Math.min(out.length - 1, j + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
        out[j][2] = tx / l; out[j][3] = ty / l; out[j][4] = riverWidth(out[j][1]);
      }
      return out;
    }
    function edges(sm, wf, extra) {
      var L = [], Rr = [];
      sm.forEach(function (p) { var w = p[4] * wf / 2 + (extra || 0), nx = p[3], ny = -p[2]; L.push([p[0] - nx * w, p[1] - ny * w]); Rr.push([p[0] + nx * w, p[1] + ny * w]); });
      return { L: L, R: Rr };
    }
    function renderSplit() {
      var c = makeCanvas(1000 * Q, 700 * Q), g = c.getContext('2d'); g.scale(Q, Q);
      g.drawImage(bgGrass, 0, 0, 1000, 700);
      var sm = river.samples, R = mulberry32(77), N = makeNoise(9);
      // 강 오른쪽 = 마른 땅
      var e0 = edges(sm, 1, 10);
      g.save(); g.beginPath(); g.moveTo(sm[0][0] + 40, 150); g.lineTo(sm[0][0] + 20, GROUND_Y - 12);
      e0.R.forEach(function (p) { g.lineTo(p[0], p[1]); });
      g.lineTo(1000, 720); g.lineTo(1000, 150); g.closePath(); g.clip();
      var tmp = makeCanvas(1000 * Q, 700 * Q), tg = tmp.getContext('2d'); tg.scale(Q, Q);
      var rx0 = sm[0][0]; drawDunes(tg, R, N, rx0);
      tg.globalCompositeOperation = 'destination-in';   // 강 근처는 초원에서 사막으로 서서히 바뀜
      var mk = tg.createLinearGradient(rx0 + 10, 0, rx0 + 130, 0); mk.addColorStop(0, 'rgba(0,0,0,0)'); mk.addColorStop(1, 'rgba(0,0,0,1)');
      tg.fillStyle = mk; tg.fillRect(0, 0, 1000, 700);
      g.drawImage(tmp, 0, 0, 1000, 700);
      g.save(); g.beginPath(); g.rect(0, GROUND_Y - 6, 1000, 720); g.clip(); drawSand(g, R, N); g.restore();
      g.restore();
      // 강둑(젖은 흙) → 물
      function band(wf, extra, style, alpha) {
        var e = edges(sm, wf, extra); g.beginPath();
        e.L.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
        for (var i = e.R.length - 1; i >= 0; i--) g.lineTo(e.R[i][0], e.R[i][1]);
        g.closePath(); g.globalAlpha = alpha == null ? 1 : alpha; g.fillStyle = style; g.fill(); g.globalAlpha = 1;
      }
      band(1, 14, 'rgba(90,75,45,.45)', 1);
      band(1, 7, '#5a4a2c', 1);
      var wg = g.createLinearGradient(0, GROUND_Y, 0, 700); wg.addColorStop(0, '#86b3e0'); wg.addColorStop(0.3, '#3f78bd'); wg.addColorStop(1, '#1f4f8c');
      band(1, 0, wg, 1);
      band(0.5, 0, 'rgba(15,40,85,.35)', 1);
      var ref = g.createLinearGradient(0, GROUND_Y, 0, 700); ref.addColorStop(0, 'rgba(230,242,255,.5)'); ref.addColorStop(0.45, 'rgba(230,242,255,.1)'); ref.addColorStop(1, 'rgba(230,242,255,0)');
      band(1, 0, ref, 1);
      // 물가 얕은 곳 밝게
      var ee = edges(sm, 1, -1.5);
      [ee.L, ee.R].forEach(function (side) {
        g.strokeStyle = 'rgba(150,195,235,.5)'; g.lineCap = 'round';
        for (var i = 1; i < side.length; i++) { var k = (side[i][1] - GROUND_Y) / 412; g.lineWidth = 1 + 3 * k; g.beginPath(); g.moveTo(side[i - 1][0], side[i - 1][1]); g.lineTo(side[i][0], side[i][1]); g.stroke(); }
      });
      // 물가 돌
      var eb = edges(sm, 1, 6);
      for (var s = 0; s < 120; s++) {
        var arr = s % 2 ? eb.L : eb.R, p = arr[Math.floor(R() * arr.length)], k = clamp((p[1] - GROUND_Y) / 412, 0, 1), rx = 0.8 + 3.2 * k * (0.5 + R());
        var px = p[0] + (R() - .5) * 8 * k, py = p[1] + (R() - .5) * 4;
        var pg = g.createLinearGradient(px, py - rx, px, py + rx); pg.addColorStop(0, '#bdb6aa'); pg.addColorStop(1, '#5d574f');
        g.fillStyle = pg; g.beginPath(); g.ellipse(px, py, rx, rx * 0.6, R() - .5, 0, PI * 2); g.fill();
      }
      // 사막 쪽 젖은 모래 띠
      g.strokeStyle = 'rgba(150,100,55,.55)'; g.lineCap = 'round';
      for (var w2 = 1; w2 < eb.R.length; w2++) { var wk = (eb.R[w2][1] - GROUND_Y) / 412; g.lineWidth = 2 + 6 * wk; g.beginPath(); g.moveTo(eb.R[w2 - 1][0], eb.R[w2 - 1][1]); g.lineTo(eb.R[w2][0], eb.R[w2][1]); g.stroke(); }
      // 풀밭 쪽 물가 덤불
      var bush = edges(sm, 1, 4).L;
      for (var q = 0; q < bush.length; q += 3) {
        if (N(q * 0.15, 4, 2) < 0.42) continue;
        var bp = bush[q], bk = clamp((bp[1] - GROUND_Y) / 412, 0, 1), br = 4 + 13 * bk;
        g.fillStyle = 'rgba(20,45,15,.35)'; g.beginPath(); g.ellipse(bp[0] - br * 0.6, bp[1] + 1, br * 1.4, br * 0.35, 0, 0, PI * 2); g.fill();
        for (var c2 = 0; c2 < 9; c2++) {
          var bx = bp[0] - R() * br * 1.4, by = bp[1] - R() * br * 0.7, rr = br * (0.3 + R() * 0.4);
          var bgd = g.createRadialGradient(bx + rr * 0.3, by - rr * 0.5, rr * 0.1, bx, by, rr);
          bgd.addColorStop(0, '#7fb04a'); bgd.addColorStop(0.55, '#3f7a2c'); bgd.addColorStop(1, '#244d1c');
          g.fillStyle = bgd; g.beginPath(); g.arc(bx, by - rr * 0.6, rr, 0, PI * 2); g.fill();
        }
      }
      return c;
    }

    // ---------- 크기 맞추기 ----------
    function resize() {
      var cw = wrap.clientWidth, ch = wrap.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      view.s = Math.max(cw / 1000, ch / 700); view.ox = (cw - 1000 * view.s) / 2; view.oy = (ch - 700 * view.s) / 2; view.dpr = dpr;
      var nq = clamp(view.s * dpr, 1, 2.2);
      if (!bgGrass || Math.abs(nq - Q) > 0.15) {
        Q = nq; bgGrass = renderGrass();
        if (river.samples) bgSplit = renderSplit();
      }
    }
    var rt = null;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 150); });
    resize();

    // ---------- 움직임 ----------
    var now = performance.now(), last = now, tweens = [];
    function tween(dur, fn) {
      return new Promise(function (res) { tweens.push({ t0: now, dur: Math.max(1, dur), fn: fn, res: res }); });
    }
    var actors = [];   // 토끼
    var hawks = [], fx = [], trail = null;

    function depth(y) { return 0.62 + (y - 350) / 250 * 0.46; }
    function newRabbit(color, x, y) {
      var R = Math.random;
      var r = { color: color, x: x, y: y, dir: R() < 0.5 ? 1 : -1, alpha: 1, grow: 1, phase: R() * 10, move: null, tuft: [] };
      for (var i = 0; i < 7; i++) r.tuft.push([(R() - 0.5) * 44, 5 + R() * 8, (R() - 0.5) * 5, mixA(H('#3f7027'), H('#8fb84e'), R())]);
      actors.push(r);
      return r;
    }
    function hopTo(r, x, y, speed) {
      speed = speed || 1;
      var dist = Math.hypot(x - r.x, (y - r.y) * 1.3), n = Math.max(1, Math.ceil(dist / 42));
      var nd = Math.abs(x - r.x) > 3 ? (x > r.x ? 1 : -1) : r.dir, turn = nd !== r.dir ? 170 * speed : 0;
      r.move = { fx: r.x, fy: r.y, tx: x, ty: y, n: n, start: now + turn, dur: n * 270 * speed, turnEnd: now + turn, nd: nd };
      return new Promise(function (res) { r.move.res = res; });
    }
    function fade(r, ms) { r.fadeT0 = now; r.fadeDur = ms || 1; }
    function remove(r) { var i = actors.indexOf(r); if (i >= 0) actors.splice(i, 1); }

    // ---------- 강 ----------
    function riverX(y) {
      var sm = river.samples; if (!sm) return null;
      for (var i = 1; i < sm.length; i++) if (sm[i][1] >= y) { var a = sm[i - 1], b = sm[i], t = (y - a[1]) / ((b[1] - a[1]) || 1); return a[0] + (b[0] - a[0]) * clamp(t, 0, 1); }
      return sm[sm.length - 1][0];
    }
    function setRiver(pts) { river.pts = pts; river.samples = sampleRiver(pts); bgSplit = renderSplit(); river.alpha = 1; river.reveal = 0; }
    function revealRiver(ms) { return tween(ms, function (t) { river.reveal = t; }); }
    function hideRiver(ms) { return tween(ms, function (t) { river.alpha = 1 - t; }).then(function () { river.samples = null; river.pts = null; river.reveal = 0; }); }
    function clearRiver() { river.samples = null; river.pts = null; river.reveal = 0; river.alpha = 0; }
    function isSand(x, y) { return river.samples && river.alpha > 0.5 && river.reveal > 0.5 && x > riverX(y); }

    // ---------- 매 ----------
    function bez(p0, p1, p2, t) { var u = 1 - t; return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]; }
    function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    function hunt(r, side, T) {   // T(ms) → 속도 반영 시간
      var dir = side === 'L' ? (r.x > 260 ? -1 : 1) : (r.x < 740 ? 1 : -1);
      dir = Math.random() < 0.5 ? dir : -dir;
      var h = { x: 0, y: 0, dir: dir, rot: 0, frame: 'soar', flap: false, carry: null, groundY: r.y + 3, s: 0.74 + depth(r.y) * 0.36 };
      hawks.push(h);
      var start = [r.x - dir * 480, -140], above = [r.x - dir * 170, r.y - 250], pre = [r.x - dir * 30, r.y - 52];
      var d1 = T(650), d2 = T(330), d3 = T(170), d4 = T(700);
      return tween(d1, function (t) {
        var p = bez(start, [r.x - dir * 330, r.y - 330], above, ease(t)); h.x = p[0]; h.y = p[1]; h.rot = 0.08 + 0.06 * Math.sin(t * 6); h.flap = false; h.frame = t < 0.75 ? 'soar' : 'glide';
      }).then(function () {
        h.flap = false; h.frame = 'stoop';
        return tween(d2, function (t) {
          var e = t * t, p = bez(above, [r.x - dir * 120, r.y - 90], pre, e), q = bez(above, [r.x - dir * 120, r.y - 90], pre, Math.min(1, e + 0.02));
          h.x = p[0]; h.y = p[1]; h.rot = Math.atan2(q[1] - p[1], Math.abs(q[0] - p[0]) + 0.01) * 0.85;
        });
      }).then(function () {
        h.frame = 'flare';
        return tween(d3, function (t) { h.x = pre[0] + dir * 20 * t; h.y = pre[1] + 14 * t; h.rot = -0.35 * t; });
      }).then(function () {
        r.carried = h; h.carry = r; remove(r); h.flap = true; h.carryMode = true;
        var from = [h.x, h.y], to = [r.x + dir * 520, -200];
        return tween(d4, function (t) {
          var p = bez(from, [from[0] + dir * 160, from[1] - 30], to, t * (0.6 + 0.4 * t)); h.x = p[0]; h.y = p[1]; h.rot = -0.22;
        });
      }).then(function () { var i = hawks.indexOf(h); if (i >= 0) hawks.splice(i, 1); });
    }

    // ---------- 효과 ----------
    function addFx(type, x, y, size) { fx.push({ type: type, x: x, y: y, t0: now, size: size || 1 }); }
    function heart(g, x, y, s, broken, al) {
      g.save(); g.translate(x, y); g.scale(s, s); g.globalAlpha = al;
      var path = function () { g.beginPath(); g.moveTo(0, 7); g.bezierCurveTo(-11, 0, -8, -9, -2, -7); g.bezierCurveTo(-0.5, -6.5, 0, -5, 0, -4.5); g.bezierCurveTo(0, -5, 0.5, -6.5, 2, -7); g.bezierCurveTo(8, -9, 11, 0, 0, 7); g.closePath(); };
      var gr = g.createLinearGradient(0, -8, 0, 7);
      if (broken) { gr.addColorStop(0, '#b9c0c8'); gr.addColorStop(1, '#7b848f'); } else { gr.addColorStop(0, '#ff8aa5'); gr.addColorStop(1, '#e33d64'); }
      g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 4; g.shadowOffsetY = 1;
      if (broken) {
        g.save(); g.beginPath(); g.moveTo(-12, -10); g.lineTo(0, -10); g.lineTo(-2, -3); g.lineTo(1.5, 1); g.lineTo(-1, 8); g.lineTo(-12, 8); g.clip(); g.translate(-1.2, 0.5); g.rotate(-0.12); path(); g.fillStyle = gr; g.fill(); g.restore();
        g.save(); g.beginPath(); g.moveTo(12, -10); g.lineTo(0, -10); g.lineTo(-2, -3); g.lineTo(1.5, 1); g.lineTo(-1, 8); g.lineTo(12, 8); g.clip(); g.translate(1.2, 0.5); g.rotate(0.12); path(); g.fillStyle = gr; g.fill(); g.restore();
      } else { path(); g.fillStyle = gr; g.fill(); g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1; g.stroke(); }
      g.restore();
    }

    // ---------- 그리기 ----------
    function drawRabbitAt(g, r, x, y, pose, s, dir, al) {
      var img = rabbitImg[r.color][pose], br = 1 + 0.012 * Math.sin(now / 260 + r.phase);
      g.save(); g.globalAlpha = al; g.translate(x, y); g.scale(s * dir, s * br);
      g.drawImage(img, RB.x0, RB.y0, RB.w, RB.h); g.restore();
    }
    function frame() {
      now = performance.now(); var dt = Math.min(64, now - last); last = now;
      for (var i = tweens.length - 1; i >= 0; i--) {
        var tw = tweens[i], t = clamp((now - tw.t0) / tw.dur, 0, 1); tw.fn(t);
        if (t >= 1) { tweens.splice(i, 1); tw.res(); }
      }
      var g = ctx, d = view.dpr;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(d * view.s, 0, 0, d * view.s, d * view.ox, d * view.oy);
      g.drawImage(bgGrass, 0, 0, 1000, 700);
      if (river.samples && bgSplit && river.alpha > 0) {
        g.save(); g.globalAlpha = river.alpha;
        if (river.reveal < 1) {
          var ry = GROUND_Y - 30 + (740 - GROUND_Y) * river.reveal, grd = 40;
          g.beginPath(); g.rect(0, 0, 1000, ry); g.clip();
        }
        g.drawImage(bgSplit, 0, 0, 1000, 700); g.restore();
        // 물결 반짝임
        if (river.reveal > 0.9) {
          var sm = river.samples; g.lineCap = 'round';
          for (var k = 0; k < 70; k++) {
            var u = ((k * 0.6180339) % 1 + now * 0.00004 * (1 + (k % 5) * 0.15)) % 1, idx = Math.floor(u * (sm.length - 2)), p = sm[idx];
            var off = (((k * 0.7548776) % 1) - 0.5) * 0.75 * p[4], kk = clamp((p[1] - GROUND_Y) / 412, 0, 1), len = 5 + 14 * kk;
            var px = p[0] + p[3] * off, py = p[1] - p[2] * off, a = Math.sin(((now * 0.0011 + k) % PI));
            g.strokeStyle = 'rgba(235,248,252,' + (0.55 * Math.abs(a) * river.alpha) + ')'; g.lineWidth = 0.8 + 1.4 * kk;
            g.beginPath(); g.moveTo(px - p[2] * len / 2, py - p[3] * len / 2); g.quadraticCurveTo(px + p[3] * 1.5, py - p[2] * 1.5, px + p[2] * len / 2, py + p[3] * len / 2); g.stroke();
          }
        }
      }
      // 구름
      clouds.forEach(function (c) {
        c.x += c.v * dt / 1000; if (c.x > 1100) c.x = -380 * c.s;
        g.globalAlpha = 0.95; g.drawImage(c.img, c.x, c.y, 360 * c.s, 170 * c.s); g.globalAlpha = 1;
      });
      // 토끼 상태 갱신
      var list = actors.slice();
      list.forEach(function (r) {
        r.ox = r.x; r.oy = r.y; r.air = 0; r.pose = 'sit';
        var m = r.move;
        if (m) {
          if (now < m.turnEnd) { r.pose = 'front'; }
          else {
            r.dir = m.nd;
            var t = clamp((now - m.start) / m.dur, 0, 1), hi = Math.min(m.n - 1, Math.floor(t * m.n)), u = t * m.n - hi;
            r.ox = m.fx + (m.tx - m.fx) * t; r.oy = m.fy + (m.ty - m.fy) * t;
            r.air = Math.sin(PI * u) * 14 * depth(r.oy); r.pose = (u > 0.1 && u < 0.88) ? 'hop' : 'sit';
            if (t >= 1) { r.x = m.tx; r.y = m.ty; r.ox = r.x; r.oy = r.y; r.air = 0; r.pose = 'sit'; r.move = null; if (m.res) m.res(); }
          }
        }
        if (r.forcePose) r.pose = r.forcePose;
        if (r.fadeT0 != null) { r.alpha = 1 - clamp((now - r.fadeT0) / r.fadeDur, 0, 1); if (r.alpha <= 0) remove(r); }
        if (r.growT0 != null) { var gt = clamp((now - r.growT0) / r.growDur, 0, 1); r.grow = 0.45 + 0.55 * gt; }
      });
      list.sort(function (a, b) { return a.oy - b.oy; });
      // 그림자
      list.forEach(function (r) {
        var s = depth(r.oy) * r.grow, sh = 1 - Math.min(0.6, r.air / 30);
        g.fillStyle = 'rgba(25,35,15,' + (0.3 * sh * r.alpha) + ')';
        g.beginPath(); g.ellipse(r.ox - 2 * r.dir * s, r.oy + 1, 30 * s * sh, 6 * s * sh, 0, 0, PI * 2); g.fill();
      });
      hawks.forEach(function (h) {
        var alt = clamp(h.groundY - h.y, 0, 520), k = 1 - alt / 520;
        if (k <= 0) return;
        g.fillStyle = 'rgba(20,25,12,' + (0.38 * k * k) + ')';
        g.beginPath(); g.ellipse(h.x, h.groundY, 70 * h.s * (0.5 + 0.5 * k), 13 * h.s * (0.5 + 0.5 * k), 0, 0, PI * 2); g.fill();
      });
      // 토끼(먼 곳부터)
      list.forEach(function (r) {
        var s = depth(r.oy) * r.grow;
        if (r.ring) {
          g.strokeStyle = r.ring; g.lineWidth = 2.6; g.globalAlpha = 0.9 * r.alpha;
          g.beginPath(); g.ellipse(r.ox, r.oy + 1, 36 * s, 9 * s, 0, 0, PI * 2); g.stroke(); g.globalAlpha = 1;
        }
        if (r.selected) {
          g.fillStyle = 'rgba(255,214,90,.35)'; g.strokeStyle = '#ffc12e'; g.lineWidth = 3;
          g.beginPath(); g.ellipse(r.ox, r.oy + 1, 42 * s, 11 * s, 0, 0, PI * 2); g.fill(); g.stroke();
        }
        drawRabbitAt(g, r, r.ox, r.oy - r.air, r.pose, s, r.dir, r.alpha);
        if (!isSand(r.ox, r.oy)) {   // 발 앞을 가리는 풀
          r.tuft.forEach(function (b) {
            var bx = r.ox + b[0] * s, len = b[1] * s;
            g.strokeStyle = rgb(b[3], 0.95 * r.alpha); g.lineWidth = 0.6 + 0.9 * s;
            g.beginPath(); g.moveTo(bx, r.oy + 3 * s); g.quadraticCurveTo(bx + b[2] * 0.3 * s, r.oy + 3 * s - len * 0.6, bx + b[2] * s, r.oy + 3 * s - len); g.stroke();
          });
        }
      });
      // 매
      hawks.forEach(function (h) {
        var fr = h.frame;
        if (h.flap) {
          var seq = h.carryMode ? ['cup', 'cdown'] : ['up', 'mid', 'down', 'mid'], ph = Math.floor(now / (h.carryMode ? 105 : 95)) % seq.length;
          fr = seq[ph];
        }
        g.save(); g.translate(h.x, h.y); g.scale(h.dir, 1); g.rotate(h.rot); g.scale(h.s, h.s);
        if (h.carry) {
          g.save(); g.translate(19, 40); g.rotate(0.45);
          var rr = h.carry, rs = depth(rr.y) / h.s * 0.92;
          g.scale(rs * (rr.dir === h.dir ? 1 : 1), rs);
          g.drawImage(rabbitImg[rr.color].hop, RB.x0, RB.y0 + 32, RB.w, RB.h);
          g.restore();
        }
        g.drawImage(hawkImg[fr], HB.x0, HB.y0, HB.w, HB.h);
        g.restore();
      });
      // 효과
      for (var f = fx.length - 1; f >= 0; f--) {
        var e = fx[f], et = (now - e.t0) / (e.type === 'heart' ? 1100 : 1900);
        if (et >= 1) { fx.splice(f, 1); continue; }
        if (e.type === 'heart') heart(g, e.x, e.y - 40 * et, e.size * (0.6 + 0.5 * Math.min(1, et * 4)), false, et < 0.2 ? et * 5 : 1 - (et - 0.2) / 0.8);
        else heart(g, e.x, e.y, e.size * (et < 0.15 ? et / 0.15 * 1.15 : 1), e.type === 'broken', et > 0.8 ? (1 - et) * 5 : 1);   // love / broken
      }
      // 학생이 긋는 강 자국
      if (trail && trail.length > 1) {
        g.strokeStyle = 'rgba(80,170,225,.6)'; g.lineWidth = 16; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); trail.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke();
        g.strokeStyle = 'rgba(220,245,255,.8)'; g.lineWidth = 3; g.stroke();
      }
      // 가장자리 살짝 어둡게
      var vg = g.createRadialGradient(500, 380, 300, 500, 380, 760);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(10,20,30,.22)');
      g.fillStyle = vg; g.fillRect(-200, -100, 1400, 900);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    function toLogical(cx, cy) { var b = canvas.getBoundingClientRect(); return [(cx - b.left - view.ox) / view.s, (cy - b.top - view.oy) / view.s]; }
    function toScreen(x, y) { return { x: x * view.s + view.ox, y: y * view.s + view.oy }; }
    function hit(x, y) {
      var list = actors.filter(function (r) { return r.alpha > 0.5 && r.fadeT0 == null; }).sort(function (a, b) { return b.y - a.y; });
      for (var i = 0; i < list.length; i++) {
        var r = list[i], s = depth(r.y);
        if (Math.abs(x - r.x) < 34 * s && y < r.y + 6 * s && y > r.y - 82 * s) return r;
      }
      return null;
    }

    return {
      icons: icons, depth: depth, newRabbit: newRabbit, hopTo: hopTo, fade: fade, remove: remove, actors: actors,
      setRiver: setRiver, revealRiver: revealRiver, hideRiver: hideRiver, clearRiver: clearRiver, riverX: riverX, riverWidth: riverWidth,
      hasRiver: function () { return !!river.samples; }, isSand: isSand,
      hunt: hunt, fx: addFx, setTrail: function (t) { trail = t; }, toLogical: toLogical, toScreen: toScreen, hit: hit,
      clearHawks: function () { hawks.length = 0; fx.length = 0; tweens.length = 0; },
      tween: tween
    };
  }
  window.RabbitScene = Scene;
})();
