// 하늘 보기(관측자 시점) — Canvas 2D. 바뀐 것이 있을 때만 다시 그림.

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// 달 표면 무늬 (한 번만 만들어 두고 잘라 씀)
function makeMoonFace() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(110, 100, 10, 128, 128, 128);
  g.addColorStop(0, '#f2f1ea'); g.addColorStop(0.8, '#d9d7cf'); g.addColorStop(1, '#b9b7ae');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const r = rng(3);
  // 바다(어두운 무늬)
  for (const [cx, cy, rr] of [[95, 90, 42], [150, 80, 30], [165, 135, 38], [110, 150, 26], [80, 170, 18]]) {
    const mg = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
    mg.addColorStop(0, 'rgba(120,120,116,0.42)'); mg.addColorStop(0.7, 'rgba(125,125,120,0.3)'); mg.addColorStop(1, 'rgba(130,130,125,0)');
    x.fillStyle = mg; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.fill();
  }
  for (let i = 0; i < 40; i++) {
    const cx = r() * 256, cy = r() * 256, rr = 2 + r() * 7;
    x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2);
    x.strokeStyle = 'rgba(110,110,105,0.35)'; x.lineWidth = 1.2; x.stroke();
  }
  return c;
}

export class Sky {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.quality = 'high';
    this.moonFace = makeMoonFace();
    const r = rng(41);
    this.stars = Array.from({ length: 110 }, () => [r(), r(), 0.4 + r() * 1.3, 0.3 + r() * 0.7]);
    this.last = null;
    this.dirty = true;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  setQuality(q) { this.quality = q; this.resize(); }

  resize() {
    const p = this.cv.parentElement;
    const w = Math.max(10, p.clientWidth), h = Math.max(10, p.clientHeight);
    this.dpr = this.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.w = w; this.h = h;
    this.dirty = true;
    if (this.last) this.draw(this.last.g, this.last.opt);
  }

  draw(g, opt) {
    this.last = { g, opt };
    const { ctx: c, w, h } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    this.text = this._layoutText(c, w, h, g, opt);
    this.textBottom = this.text.bottom;
    // 글자 아래 ~ 아래 띠 위 사이에 천체를 둠 (아래 라벨 자리 26px)
    const top = this.textBottom + 6, bottom = h - 46;
    this.fitR = Math.max(16, (bottom - top - 30) / 2);
    const cx = w / 2, cy = Math.min(h * 0.5, (top + bottom - 26) / 2 + 2);
    if (g.view === 'solar') this._solar(c, w, h, cx, cy, g, opt);
    else this._lunar(c, w, h, cx, cy, g, opt);
    this._frame(c, w, h, g, opt);
    this.dirty = false;
  }

  // 왼쪽 위 글자(제목·설명·안내)를 줄바꿈해 자리를 미리 정함
  _layoutText(c, w, h, g, opt) {
    const F = wt => `${wt} 13px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`;
    const maxW = w - 24;
    const small = h < 330;
    const out = [];
    let y = 10;
    const push = (text, font, lh, kind) => {
      c.font = font;
      for (const line of wrap(c, text, maxW)) { out.push({ text: line, font, y, kind }); y += lh; }
    };
    push(opt?.title || '하늘 보기', '700 14px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif', 20, 'title');
    if (opt?.sub && !small) push(opt.sub, F(500), 18, 'sub');
    for (const n of (small ? opt?.notesShort : opt?.notes) || []) push(n, F(500), small ? 17 : 18, 'note');
    return { lines: out, bottom: y };
  }

  // 별은 크기가 바뀔 때 한 번만 따로 그려 두고 붙여 씀 (저사양 크롬북 부담 줄이기)
  _starLayer() {
    const key = `${this.w}x${this.h}@${this.dpr}`;
    if (this.starKey === key) return this.starCv;
    const cv = this.starCv || document.createElement('canvas');
    cv.width = Math.round(this.w * this.dpr); cv.height = Math.round(this.h * this.dpr);
    const x = cv.getContext('2d');
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.fillStyle = '#fff';
    for (const [sx, sy, r, a] of this.stars) {
      x.globalAlpha = a;
      x.beginPath(); x.arc(sx * this.w, sy * this.h, r, 0, Math.PI * 2); x.fill();
    }
    this.starCv = cv; this.starKey = key;
    return cv;
  }

  _starsDraw(c, w, h, alpha) {
    if (alpha <= 0) return;
    c.globalAlpha = Math.min(1, alpha);
    c.drawImage(this._starLayer(), 0, 0, w, h);
    c.globalAlpha = 1;
  }

  _solar(c, w, h, cx, cy, g, opt) {
    const R = Math.min(w * 0.14, h * 0.19, this.fitR);
    const k = g.cover / 100;
    const dark = Math.pow(k, 6);                     // 거의 다 가려질 때만 하늘이 어두워짐
    const mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * dark));
    const top = mix([86, 160, 226], [10, 18, 44]), bot = mix([170, 214, 245], [28, 36, 70]);
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, `rgb(${top})`); bg.addColorStop(1, `rgb(${bot})`);
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    this._starsDraw(c, w, h, Math.max(0, (k - 0.97) / 0.03));

    // 코로나 (완전히 가려졌을 때만)
    if (g.cover >= 99.95) {
      const cg = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 2.6);
      cg.addColorStop(0, 'rgba(255,255,245,0.9)'); cg.addColorStop(0.3, 'rgba(220,230,255,0.35)'); cg.addColorStop(1, 'rgba(200,210,255,0)');
      c.fillStyle = cg; c.beginPath(); c.arc(cx, cy, R * 2.6, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(cx, cy);
      c.strokeStyle = 'rgba(235,240,255,0.35)'; c.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2 + 0.2, l = R * (1.6 + (i % 3) * 0.35);
        c.beginPath(); c.moveTo(Math.cos(a) * R, Math.sin(a) * R); c.lineTo(Math.cos(a) * l, Math.sin(a) * l); c.stroke();
      }
      c.restore();
    } else {
      const glow = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 2.2);
      glow.addColorStop(0, `rgba(255,250,220,${0.75 * (1 - k)})`); glow.addColorStop(1, 'rgba(255,250,220,0)');
      c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, R * 2.2, 0, Math.PI * 2); c.fill();
    }
    // 태양 원판 (가장자리가 조금 어두움)
    const sg = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    sg.addColorStop(0, '#fffbe8'); sg.addColorStop(0.7, '#ffe48a'); sg.addColorStop(1, '#ffb43c');
    c.fillStyle = sg; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();

    // 달: 태양 앞 부분은 검게, 바깥은 거의 안 보임(점선)
    const mx = cx + g.occX * R, my = cy - g.occY * R;
    c.save(); c.beginPath(); c.arc(cx, cy, R + 0.5, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#17181f'; c.beginPath(); c.arc(mx, my, R, 0, Math.PI * 2); c.fill();
    c.restore();
    const onScreen = Math.abs(mx - cx) < w / 2 + R && Math.abs(my - cy) < h / 2 + R;
    if (onScreen) {
      c.save();
      c.setLineDash([6, 5]); c.lineWidth = 1.5;
      c.strokeStyle = g.cover > 99 ? 'rgba(255,255,255,0.35)' : 'rgba(25,40,70,0.55)';
      c.beginPath(); c.arc(mx, my, R, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
    this.geo = { R, cx, cy, mx, my, occR: R };
    const sunTxt = opt?.maxNote && g.cover >= 99.95 ? `태양 · ${opt.maxNote}` : '태양';
    c.font = '600 14px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
    const sunHalf = c.measureText(sunTxt).width / 2 + 7;
    this._label(c, sunTxt, cx, cy + R + 22, g.cover > 98 ? '#fff' : '#3a2a00', g.cover > 98 ? 'rgba(0,0,0,.45)' : 'rgba(255,245,200,.85)');
    if (onScreen) {
      // 달 라벨: 태양 반대쪽 바깥 → 위 → 아래 → 옆 순서로, 태양·동서 표시와 겹치지 않는 자리
      const dd = Math.hypot(mx - cx, my - cy);
      const cands = [];
      if (dd > R * 0.3) cands.push([mx + (mx - cx) / dd * (R + 22), my + (my - cy) / dd * (R + 18)]);
      cands.push([mx, my - R - 18], [mx, my + R + 18], [mx + R + 30, my], [mx - R - 30, my]);
      let lx = mx, ly = my - R - 18;
      for (const [x, y] of cands) {
        if (x < 30 || x > w - 30 || y < this.textBottom + 14 || y > h - 50) continue;
        if (dd > R * 0.3 && Math.hypot(x - cx, y - cy) < R + 14) continue;
        if (Math.abs(y - (cy + R + 22)) < 24 && Math.abs(x - cx) < sunHalf + 22) continue;   // 태양 라벨과 겹침
        lx = x; ly = y; break;
      }
      const dk = g.cover > 98;
      this._label(c, '달', lx, ly, dk ? '#fff' : '#1d2a44', dk ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.75)');
    }
    if (!onScreen) this._offArrow(c, w, h, cx, cy, mx, my, '달', '#ffffff');
  }

  _lunar(c, w, h, cx, cy, g) {
    const R = Math.min(w * 0.095, h * 0.115, this.fitR);
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#050816'); bg.addColorStop(1, '#121a33');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    this._starsDraw(c, w, h, 0.9);
    const k = g.cover / 100;
    const sx = cx + g.occX * R, sy = cy - g.occY * R, SR = g.rOcc * R;

    // 달 빛무리
    const glow = c.createRadialGradient(cx, cy, R, cx, cy, R * 2.4);
    glow.addColorStop(0, `rgba(230,235,255,${0.35 * (1 - k * 0.9)})`); glow.addColorStop(1, 'rgba(230,235,255,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, R * 2.4, 0, Math.PI * 2); c.fill();

    // 달 원판
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
    c.drawImage(this.moonFace, cx - R, cy - R, R * 2, R * 2);
    // 그림자 속은 붉고 어둡게 (가장자리는 부드럽게)
    const deep = 0.80 + 0.12 * k;
    const sh = c.createRadialGradient(sx, sy, 0, sx, sy, SR * 1.04);
    sh.addColorStop(0, `rgba(70,18,8,${deep})`);
    sh.addColorStop(0.93, `rgba(105,32,14,${deep - 0.06})`);
    sh.addColorStop(1, 'rgba(105,32,14,0)');
    c.fillStyle = sh; c.beginPath(); c.arc(sx, sy, SR * 1.04, 0, Math.PI * 2); c.fill();
    c.restore();

    // 지구의 그림자 경계 (실제로는 보이지 않으므로 점선)
    c.save();
    c.setLineDash([7, 6]); c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,150,120,0.55)';
    c.beginPath(); c.arc(sx, sy, SR, 0, Math.PI * 2); c.stroke();
    c.restore();
    this.geo = { R, cx, cy, mx: sx, my: sy, occR: SR };

    this._label(c, '달', cx, cy + R + 22, '#fff', 'rgba(0,0,0,.45)');
    // 그림자 라벨: 그림자 원 안쪽에서 달·동서 표시와 겹치지 않는 자리를 고름
    const away = Math.atan2(sy - cy, sx - cx);
    const cands = [away, away - 0.6, away + 0.6, -Math.PI / 2, Math.PI / 2, away - 1.2, away + 1.2];
    let lx = null, ly = null;
    for (const a of cands) {
      for (const f of [0.62, 0.45, 0.8]) {
        const x = sx + Math.cos(a) * SR * f, y = sy + Math.sin(a) * SR * f;
        if (x < 70 || x > w - 70 || y < this.textBottom + 14 || y > h - 56) continue;
        if (Math.hypot(x - cx, y - cy) < R + 34) continue;
        if (Math.abs(y - cy) < 22 && Math.abs(x - cx) < R + 90) continue;
        lx = x; ly = y; break;
      }
      if (lx !== null) break;
    }
    if (lx === null) { lx = cx; ly = Math.max(this.textBottom + 14, cy - R - 40); }
    const shadowVisible = sx + SR > 0 && sx - SR < w;
    if (shadowVisible) this._label(c, '지구의 그림자', lx, ly, '#ffd9cc', 'rgba(60,15,10,.7)');
    else this._offArrow(c, w, h, cx, cy, sx, sy, '지구의 그림자', '#ffd9cc');
  }

  _offArrow(c, w, h, cx, cy, tx, ty, text, color) {
    const ang = Math.atan2(ty - cy, tx - cx);
    let ex = Math.max(34, Math.min(w - 34, cx + Math.cos(ang) * w));
    const ey = Math.max(this.textBottom + 16, Math.min(h - 60, cy + Math.sin(ang) * h));
    c.save(); c.translate(ex, ey); c.rotate(ang);
    c.fillStyle = color; c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(16, 0); c.lineTo(-8, -11); c.lineTo(-8, 11); c.closePath(); c.fill(); c.stroke();
    c.restore();
    const right = Math.cos(ang) > 0;
    c.font = '600 14px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
    const tw = c.measureText(text + ' (멀리 있음)').width;
    const lx = right ? ex - 22 - tw / 2 - 8 : ex + 22 + tw / 2 + 8;
    this._label(c, text + ' (멀리 있음)', Math.max(tw / 2 + 12, Math.min(w - tw / 2 - 12, lx)), ey, color, 'rgba(0,0,0,.35)');
  }

  _label(c, text, x, y, color, bg) {
    c.font = '600 14px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
    const tw = c.measureText(text).width;
    c.fillStyle = bg;
    const px = 7, ph = 22;
    c.beginPath();
    c.roundRect(x - tw / 2 - px, y - ph / 2, tw + px * 2, ph, 8);
    c.fill();
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, x, y + 1);
  }

  // 방향 표시와 안내 (가장자리)
  _frame(c, w, h, g) {
    const light = g.view === 'solar' && g.cover < 98;
    const ink = light ? '#13284a' : '#e8eefc';
    const pill = light ? 'rgba(255,255,255,.72)' : 'rgba(255,255,255,.12)';
    // 왼쪽 위 글자
    c.textAlign = 'left'; c.textBaseline = 'top';
    // 글자 뒤 반투명 바탕 (코로나·그림자 위에서도 읽히게)
    let tw = 0;
    for (const l of this.text.lines) { c.font = l.font; tw = Math.max(tw, c.measureText(l.text).width); }
    c.fillStyle = light ? 'rgba(255,255,255,.38)' : 'rgba(4,7,20,.62)';
    c.beginPath(); c.roundRect(5, 4, tw + 14, this.text.bottom - 2, 8); c.fill();
    for (const l of this.text.lines) {
      c.font = l.font;
      c.fillStyle = l.kind === 'title' ? ink : (light ? 'rgba(19,40,74,.82)' : 'rgba(232,238,252,.8)');
      c.fillText(l.text, 12, l.y);
    }
    // 아래 띠: 동(왼쪽) ← 달이 움직이는 방향 ← 서(오른쪽)
    const ay = h - 20;
    c.font = '700 15px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
    this._label(c, '동 (왼쪽)', 50, ay, ink, pill);
    this._label(c, '서 (오른쪽)', w - 54, ay, ink, pill);
    const half = Math.max(30, Math.min(70, w / 2 - 120));
    c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 2;
    const ax0 = w / 2 + half, ax1 = w / 2 - half;
    c.beginPath(); c.moveTo(ax0, ay); c.lineTo(ax1 + 8, ay); c.stroke();
    c.beginPath(); c.moveTo(ax1, ay); c.lineTo(ax1 + 10, ay - 6); c.lineTo(ax1 + 10, ay + 6); c.closePath(); c.fill();
    c.font = '500 13px Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('달이 움직이는 방향', w / 2, ay - 6);
  }
}

// 글자를 maxW 안에 들어가게 줄바꿈 (띄어쓰기 단위)
function wrap(c, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const wd of words) {
    const t = cur ? cur + ' ' + wd : wd;
    if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
