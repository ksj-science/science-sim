// 22-2-7-2-02 지구 공전과 별자리 변화 — ① 우주(Three.js) ② 지구에서 본 하늘(Canvas 2D) ③ 관측 기록 표
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { sound } from '../../lib/sound.js';
import { clamp, ease, toast } from '../../lib/utils.js';
import * as A from './astro.js';
import { CONSTELLATIONS } from './stars.js';

SimBridge.init('22-2-7-2-02');

const $ = (id) => document.getElementById(id);
const isLocked = () => SimBridge.locked || document.documentElement.classList.contains('sim-locked');
const RAD = A.RAD;

// 교과서 자료의 12개 별자리(띠 순서)
const ZNAMES = ['궁수자리', '염소자리', '물병자리', '물고기자리', '양자리', '황소자리', '쌍둥이자리', '게자리', '사자자리', '처녀자리', '천칭자리', '전갈자리'];
const MONTHS = [0, 3, 6, 9, 12];
const COLNAME = ['오늘', '3개월 뒤', '6개월 뒤', '9개월 뒤', '12개월 뒤'];

// 별 좌표 미리 계산 (적경·적위 → 라디안, 황경·황위 → °)
const CONS = CONSTELLATIONS.map((c) => {
  const stars = {};
  for (const [k, [h, m, dec, mag]] of Object.entries(c.stars)) {
    const ra = (h + m / 60) * 15 * RAD, de = dec * RAD;
    const e = A.eqToEcl(ra, de);
    stars[k] = { ra, dec: de, lam: A.norm360(e.lam / RAD), beta: e.beta / RAD, mag };
  }
  return { ...c, stars };
});

// ---------------------------------------------------------------- 상태
const now = new Date();
const todayIdx = A.dayIndex(now.getFullYear(), now.getMonth() + 1, now.getDate());
const S = {
  base: todayIdx, day: todayIdx, max: 365, cols: [],
  timeMode: 'noon', sunlight: false,
  playing: false, speed: 15, predictOn: false,
  rec: { noon: Array(5).fill(''), midnight: Array(5).fill('') },
  predictions: [], myPred: null,
  viewTop: false, fullYear: false, doneOnce: false,
  trail: [],
  quality: (navigator.hardwareConcurrency || 4) <= 2 ? 'low' : 'high',
  hover: null, flash: null,
};
let visDay = S.day;       // 3D 지구 위치(소수 가능 — 이징·재생 중)
let tween = null;         // 날짜 이징 {from,to,t0,dur}
let playAcc = 0;
let need3D = true, skyDirty = true, stateDirty = true;

// ---------------------------------------------------------------- 3D: 우주에서 본 지구의 공전
const R_ORBIT = 6, R_BAND = 15, H_BAND = 6, BETA_MAX = 22, R_EARTH = 0.6;
const P = (lamDeg, r, y = 0) => new THREE.Vector3(r * Math.cos(lamDeg * RAD), y, -r * Math.sin(lamDeg * RAD));

const spaceEl = $('space');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
spaceEl.prepend(renderer.domElement);
const labelR = new CSS2DRenderer();
labelR.domElement.className = 'labels';
spaceEl.appendChild(labelR.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 500);

// 배경(화면 고정 그라데이션)
{
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 118, 10, 128, 128, 190);
  gr.addColorStop(0, '#1b2a5a'); gr.addColorStop(.55, '#0c1533'); gr.addColorStop(1, '#050816');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}

// 먼 배경 별
const bgStars = (() => {
  const N = 1400, pos = new Float32Array(N * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 160;
    const s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xaab8ff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: .7 });
  const p = new THREE.Points(g, m); scene.add(p); return p;
})();

scene.add(new THREE.AmbientLight(0x8090c0, 0.35));
const sunLight = new THREE.PointLight(0xfff1d6, 3.2, 0, 0);
scene.add(sunLight);

// 동그란 빛 텍스처
function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(.25, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// 태양
const sun = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.25, 0.45) }));
scene.add(sun);
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,210,110,0.85)', 'rgba(255,160,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
sunGlow.scale.setScalar(5.2); scene.add(sunGlow);

// 지구 공전 궤도 + 공전 방향 화살표(시계 반대, 주황)
{
  const pts = [];
  for (let i = 0; i <= 256; i++) pts.push(P(i / 256 * 360, R_ORBIT));
  const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: .5 }));
  scene.add(orbit);
}
const arcLines = [];
for (const a0 of [30, 120, 210, 300]) {
  const pos = [];
  for (let a = a0; a <= a0 + 26; a += 2) { const v = P(a, R_ORBIT); pos.push(v.x, 0, v.z); }
  const geo = new LineGeometry(); geo.setPositions(pos);
  const mat = new LineMaterial({ color: 0xff8a2a, linewidth: 3, transparent: true, opacity: .95 });
  const ln = new Line2(geo, mat); scene.add(ln); arcLines.push(mat);
  const tip = a0 + 28, tan = new THREE.Vector3(-Math.sin(tip * RAD), 0, -Math.cos(tip * RAD));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 16), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
  cone.position.copy(P(tip, R_ORBIT)); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
  scene.add(cone);
}

// 별자리 띠 텍스처: 캔버스 x = (1 − λ/360)·W → 안쪽에서 볼 때 왼쪽이 λ 증가(하늘과 같은 방향)
function makeBandTexture(W) {
  const H = Math.round(W * H_BAND / (2 * Math.PI * R_BAND));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const sc = W / 4096;
  const X = (lam) => (1 - A.norm360(lam) / 360) * W;
  const Y = (b) => H / 2 - (b / BETA_MAX) * (H / 2 - 6 * sc);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(26,40,96,0.95)'); bg.addColorStop(.5, 'rgba(34,52,118,0.95)'); bg.addColorStop(1, 'rgba(18,28,70,0.95)');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // 뱀주인자리 구간(별 그림 없음)
  g.fillStyle = 'rgba(120,125,145,0.28)';
  g.fillRect(X(266.27), 0, X(247.70) - X(266.27), H);
  g.font = `600 ${Math.round(34 * sc)}px sans-serif`; g.textAlign = 'center'; g.fillStyle = 'rgba(190,195,215,0.75)';
  g.fillText('뱀주인자리', (X(266.27) + X(247.70)) / 2, H - 16 * sc);
  // 태양이 지나는 길(가운데 점선)
  g.setLineDash([14 * sc, 10 * sc]); g.strokeStyle = 'rgba(255,214,102,0.45)'; g.lineWidth = 2 * sc;
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  // 별자리 경계
  g.setLineDash([6 * sc, 8 * sc]); g.strokeStyle = 'rgba(170,190,255,0.5)'; g.lineWidth = 2 * sc;
  for (const [, l] of A.BOUNDS) { g.beginPath(); g.moveTo(X(l), 0); g.lineTo(X(l), H); g.stroke(); }
  g.setLineDash([]);
  // 위·아래 테두리
  g.fillStyle = 'rgba(160,185,255,0.8)'; g.fillRect(0, 0, W, 3 * sc); g.fillRect(0, H - 3 * sc, W, 3 * sc);
  for (const con of CONS) {
    if (!con.zodiac) continue;
    g.strokeStyle = 'rgba(150,195,255,0.8)'; g.lineWidth = 2.6 * sc;
    for (const [a, b] of con.lines) {
      const s1 = con.stars[a], s2 = con.stars[b];
      const x1 = X(s1.lam); let x2 = X(s2.lam);
      if (x2 - x1 > W / 2) x2 -= W; else if (x1 - x2 > W / 2) x2 += W; // λ=0 경계를 넘는 선
      for (const dx of [0, -W, W]) { g.beginPath(); g.moveTo(x1 + dx, Y(s1.beta)); g.lineTo(x2 + dx, Y(s2.beta)); g.stroke(); }
    }
    for (const s of Object.values(con.stars)) {
      const r = Math.max(2.2, (4.8 - s.mag) * 2.1) * sc;
      const x = X(s.lam), y = Y(s.beta);
      for (const dx of [0, -W, W]) {
        const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, r * 3);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(220,235,255,.9)'); gr.addColorStop(1, 'rgba(160,200,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x + dx, y, r * 3, 0, Math.PI * 2); g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
const bandGeo = new THREE.CylinderGeometry(R_BAND, R_BAND, H_BAND, 256, 1, true, Math.PI / 2, Math.PI * 2);
const bandMat = new THREE.MeshBasicMaterial({ map: makeBandTexture(S.quality === 'high' ? 4096 : 2048), side: THREE.BackSide, transparent: true, depthWrite: false });
const band = new THREE.Mesh(bandGeo, bandMat); scene.add(band);
const bandOuter = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ color: 0x24336e, side: THREE.FrontSide, transparent: true, opacity: .16, depthWrite: false }));
scene.add(bandOuter);
for (const y of [-H_BAND / 2, H_BAND / 2]) {
  const pts = []; for (let i = 0; i <= 256; i++) pts.push(P(i / 256 * 360, R_BAND, y));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8ea4ff, transparent: true, opacity: .55 })));
}

// 3D 이름표
function label3(text, cls, pos, lift = 0) {
  const el = document.createElement('div'); el.className = 'l3 ' + (cls || '');
  if (lift) { const sp = document.createElement('span'); sp.textContent = text; sp.style.cssText = `position:relative;top:${-lift}px`; el.appendChild(sp); } else el.textContent = text;
  const o = new CSS2DObject(el); o.position.copy(pos); scene.add(o); return o;
}
const bandLabels = [];
for (let k = 0; k < A.BOUNDS.length; k++) {
  const [name, s] = A.BOUNDS[k];
  const e = A.BOUNDS[(k + 1) % A.BOUNDS.length][1];
  const mid = A.norm360(s + A.norm360(e - s) / 2);
  if (name === '뱀주인자리') continue; // 이름은 띠 그림에 흐리게 씀(별 그림 없음)
  // 전갈자리는 황도 위 구간이 약 7°로 좁아 옆(천칭자리) 이름과 겹치지 않게 띠 아래에
  const y = name === '전갈자리' ? -H_BAND / 2 - 0.6 : H_BAND / 2 + 0.6;
  const o = label3(name, '', P(mid, R_BAND - 0.05, y));
  bandLabels.push({ o, el: o.element, prio: 3, lam: mid });
}
const sunTag = label3('태양', 'tag sun', new THREE.Vector3(0, 0, 0), 36);
bandLabels.push({ o: sunTag, el: sunTag.element, prio: 4, dy: -36 });
for (const [t, pos] of [['지구의 공전 궤도', P(160, R_ORBIT + 0.2, 0.55)], ['공전 방향', P(318, R_ORBIT + 0.9, 0.3)]]) {
  const o = label3(t, 'tag', pos); bandLabels.push({ o, el: o.element, prio: 1 });
}

// 지구: 위치 → 자전축 기울기 → 자전(관측자 쪽을 태양/반대쪽으로)
function earthTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const oc = g.createLinearGradient(0, 0, 0, 256); oc.addColorStop(0, '#2b5fb8'); oc.addColorStop(.5, '#2f7fd6'); oc.addColorStop(1, '#2b5fb8');
  g.fillStyle = oc; g.fillRect(0, 0, 512, 256);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#3f9a4a';
  for (let i = 0; i < 9; i++) {
    const cx = rnd() * 512, cy = 60 + rnd() * 140;
    for (let j = 0; j < 14; j++) { g.beginPath(); g.ellipse(cx + (rnd() - .5) * 90, cy + (rnd() - .5) * 50, 8 + rnd() * 26, 6 + rnd() * 16, rnd() * 3, 0, Math.PI * 2); g.fill(); }
  }
  g.fillStyle = '#f2f6ff'; g.fillRect(0, 0, 512, 16); g.fillRect(0, 240, 512, 16);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const AXIS = new THREE.Vector3(0, Math.cos(23.44 * RAD), -Math.sin(23.44 * RAD)); // 하짓날 태양 쪽(λ=90° 방향)으로 기울어짐
const earthG = new THREE.Group(); scene.add(earthG);
const tiltG = new THREE.Group(); tiltG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), AXIS); earthG.add(tiltG);
const spinG = new THREE.Group(); tiltG.add(spinG);
const earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 48, 32), new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: .85, metalness: 0, emissive: 0x1a2a55, emissiveIntensity: .6 }));
spinG.add(earth);
const pin = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
pin.position.set(Math.cos(37.5 * RAD), Math.sin(37.5 * RAD), 0).multiplyScalar(R_EARTH + 0.03);
spinG.add(pin);
{ // 자전축과 자전 화살표(장식, 하늘색 — 공전 화살표와 색이 다름)
  const ax = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.85, 0), new THREE.Vector3(0, 0.85, 0)]),
    new THREE.LineBasicMaterial({ color: 0xdde6ff, transparent: true, opacity: .8 }));
  tiltG.add(ax);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.022, 6, 40, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: .75 }));
  ring.rotation.x = Math.PI / 2; tiltG.add(ring);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 10), new THREE.MeshBasicMaterial({ color: 0x5fd4ff }));
  const a = Math.PI * 1.4; tip.position.set(0.72 * Math.cos(a), 0, -0.72 * Math.sin(a));
  tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)));
  tiltG.add(tip);
}
const earthGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(120,180,255,0.55)', 'rgba(80,140,255,0)'), depthWrite: false, blending: THREE.AdditiveBlending }));
earthGlow.scale.setScalar(2.1); earthG.add(earthGlow); // 밤쪽이 카메라를 향해도 지구가 보이게
const earthHit = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
earthG.add(earthHit);
const earthTag = label3('지구', 'tag earth', new THREE.Vector3(), 24);
bandLabels.push({ o: earthTag, el: earthTag.element, prio: 5, dy: -24 });
let spinOff = 0, spinTween = null; // 낮 12시 0, 밤 12시 π

// 시선선: 지구 → 태양 → 띠(노랑), 지구 → 태양 반대쪽 → 띠(파랑)
function sightLine(color) {
  const geo = new LineGeometry(); geo.setPositions([0, 0, 0, 1, 0, 0]);
  const mat = new LineMaterial({ color, linewidth: 2, dashed: true, dashSize: 0.45, gapSize: 0.28, transparent: true, opacity: .95 });
  const l = new Line2(geo, mat); l.frustumCulled = false; scene.add(l); return l;
}
const lineSun = sightLine(0xffc21a), lineNight = sightLine(0x5aa9ff);
const markSun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,225,120,1)', 'rgba(255,170,40,0)'), depthWrite: false, blending: THREE.AdditiveBlending }));
markSun.scale.setScalar(2.0); scene.add(markSun);
const markMoon = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(61,139,255,0.35)'; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e9f1ff'; g.beginPath(); g.arc(32, 32, 17, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(41, 26, 15, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})(), depthWrite: false }));
markMoon.scale.setScalar(1.3); scene.add(markMoon);

// 후처리(태양 빛번짐)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// 카메라·조작
const CAM_TILT = { r: 41, phi: 58 * RAD, theta: 0 };
const CAM_TOP = { r: 56, phi: 0.0001, theta: 0 };
// 처음 시점: 기준일 지구 뒤쪽에서 비스듬히 → 지구→태양 시선선이 띠의 안쪽 면(먼 쪽)에 닿아 잘 보임
function aimCamera(base) {
  const lc = A.sunLongitude(A.jdays(base, 12)) + 180 + 50;
  const v = P(lc, 1);
  CAM_TILT.theta = CAM_TOP.theta = Math.atan2(v.x, v.z);
}
aimCamera(S.base);
camera.position.setFromSpherical(new THREE.Spherical(CAM_TILT.r, CAM_TILT.phi, CAM_TILT.theta));
camera.lookAt(0, 0, 0);

// 지구 끌기 — OrbitControls보다 먼저 등록해서 지구를 잡으면 회전을 막음
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragEarth = false, lamTable = [];
function setNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (isLocked()) { e.stopImmediatePropagation(); return; }
  setNdc(e);
  if (ray.intersectObject(earthHit).length) {
    e.stopImmediatePropagation(); e.preventDefault();
    dragEarth = true; renderer.domElement.setPointerCapture(e.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
    stopPlay(); tween = null; sound.soft(); hideHint();
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  setNdc(e);
  if (!dragEarth) { renderer.domElement.style.cursor = ray.intersectObject(earthHit).length ? 'grab' : ''; return; }
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, hit)) return;
  const helio = A.norm360(Math.atan2(-hit.z, hit.x) / RAD);
  const target = A.norm360(helio - 180);
  // 날짜 범위 안에서 태양 황경이 가장 가까운 날 — 여러 개면 지금 날과 가까운 쪽
  let best = null, bestScore = 1e9; const cur = S.day - S.base;
  for (let i = 0; i <= S.max; i++) {
    const diff = Math.abs(((lamTable[i] - target + 540) % 360) - 180);
    if (diff > 1.2) continue;
    const score = diff + Math.abs(i - cur) * 0.002;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best !== null && S.base + best !== S.day) {
    const old = S.day;
    visDay = S.base + best; setDay(S.base + best);
    if (Math.abs(best - (old - S.base)) <= 3) addTrail(old);
    tickSound();
  }
});
const endDrag = (e) => {
  if (!dragEarth) return;
  dragEarth = false; renderer.domElement.style.cursor = '';
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 이미 놓음 */ }
};
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.enablePan = false; controls.minDistance = 16; controls.maxDistance = 90;
controls.maxPolarAngle = 88 * RAD; controls.rotateSpeed = 0.7;
controls.addEventListener('change', () => { need3D = true; checkTopView(); });
controls.addEventListener('start', () => { camTween = null; userCam = true; hideHint(); });
let camTween = null, userCam = false;

function checkTopView() {
  const sph = new THREE.Spherical().setFromVector3(camera.position);
  const top = sph.phi < 10 * RAD;
  $('topNote').hidden = !top; $('hint3d').hidden = top;
  if (top && !S.viewTop) { S.viewTop = true; stateDirty = true; }
  document.querySelectorAll('#viewSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', String((b.dataset.view === 'top') === top));
  });
}
function flyTo(t) {
  userCam = false;
  const from = new THREE.Spherical().setFromVector3(camera.position);
  let dth = t.theta - from.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
  camTween = { from: { r: from.radius, phi: from.phi, theta: from.theta }, to: { r: t.r, phi: t.phi, theta: from.theta + dth }, t0: performance.now(), dur: 800 };
}
function hideHint() { $('hint3d').style.opacity = '0'; }

function resize3D() {
  const w = spaceEl.clientWidth, h = spaceEl.clientHeight;
  if (!w || !h) return;
  const pr = S.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr); composer.setSize(w, h);
  labelR.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 1.25 ? 44 : 36;
  camera.updateProjectionMatrix();
  // 패널 모양에 맞춰 띠 전체가 꽉 차게 거리 맞춤
  const t = Math.tan(camera.fov / 2 * RAD);
  CAM_TILT.r = Math.max(20.5 / (t * camera.aspect), 11.5 / t);
  CAM_TOP.r = Math.max(19 / (t * camera.aspect), 19.5 / t);
  if (!userCam && !camTween) {
    const sph = new THREE.Spherical().setFromVector3(camera.position);
    sph.radius = sph.phi < 10 * RAD ? CAM_TOP.r : CAM_TILT.r;
    camera.position.setFromSpherical(sph); camera.lookAt(0, 0, 0);
  }
  for (const m of [lineSun.material, lineNight.material, ...arcLines]) m.resolution.set(w, h);
  need3D = true;
}

const _v = new THREE.Vector3();
function update3D() {
  const n = A.sunLongitude(A.jdays(visDay, 12));
  curSunLam = n;
  const helio = n + 180;
  earthG.position.copy(P(helio, R_ORBIT));
  earthTag.position.copy(earthG.position);
  // 관측자(빨간 점)의 자오선이 태양 쪽(낮 12시) 또는 반대쪽(밤 12시)을 보게
  const s = earthG.position.clone().negate().normalize().applyQuaternion(tiltG.quaternion.clone().invert());
  spinG.rotation.y = Math.atan2(-s.z, s.x) + spinOff;
  const e = earthG.position;
  const pSun = P(n, R_BAND - 0.15), pNight = P(helio, R_BAND - 0.15);
  lineSun.geometry.setPositions([e.x, 0, e.z, pSun.x, 0, pSun.z]); lineSun.computeLineDistances();
  lineNight.geometry.setPositions([e.x, 0, e.z, pNight.x, 0, pNight.z]); lineNight.computeLineDistances();
  markSun.position.copy(P(n, R_BAND - 0.3)); markMoon.position.copy(P(helio, R_BAND - 0.3));
  const noon = S.timeMode === 'noon';
  lineSun.material.linewidth = noon ? 4.5 : 2.2; lineSun.material.opacity = noon ? 1 : .7;
  lineNight.material.linewidth = noon ? 2.2 : 4.5; lineNight.material.opacity = noon ? .8 : 1;
  markSun.scale.setScalar(noon ? 2.4 : 1.6); markMoon.scale.setScalar(noon ? 1.0 : 1.5);
}

function render3D() {
  update3D();
  if (S.quality === 'high') composer.render(); else renderer.render(scene, camera);
  labelR.render(scene, camera);
  cullLabels();
}

// 띠 이름표가 겹치면 뒤(우선순위 낮은 것·카메라에서 가까운 앞쪽)를 숨김
const _rects = [];
const angDist = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
let curSunLam = 0;
function cullLabels() {
  const w = spaceEl.clientWidth, h = spaceEl.clientHeight;
  spaceEl.classList.toggle('small', h < 300);
  const list = bandLabels.map((L) => {
    _v.copy(L.o.position).project(camera);
    const near = L.lam !== undefined && Math.min(angDist(L.lam, curSunLam), angDist(L.lam, curSunLam + 180)) < 20 ? 0.5 : 0; // 시선선 끝 근처 이름 먼저
    return { L, near, x: (_v.x + 1) / 2 * w, y: (1 - _v.y) / 2 * h + (L.dy || 0), d: camera.position.distanceTo(L.o.position), z: _v.z };
  });
  list.sort((a, b) => (b.L.prio + b.near - a.L.prio - a.near) || (b.d - a.d));
  _rects.length = 0;
  for (const it of list) {
    const el = it.L.el;
    if (!el._w) { el._w = el.offsetWidth || 70; el._h = el.offsetHeight || 18; }
    const r = { x0: it.x - el._w / 2 - 2, x1: it.x + el._w / 2 + 2, y0: it.y - el._h / 2 - 1, y1: it.y + el._h / 2 + 1 };
    const clash = _rects.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
    el.classList.toggle('hid', clash || it.z > 1);
    if (!clash) _rects.push(r);
  }
}

// ---------------------------------------------------------------- 하늘 (Canvas 2D)
const skyWrap = $('sky'), cv = $('skyCanvas'), ctx = cv.getContext('2d');
let SW = 0, SH = 0, SDPR = 1;
let hits = [];
const bgSky = (() => {
  const N = 520, arr = []; let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) arr.push({ ra: rnd() * Math.PI * 2, dec: Math.asin(rnd() * 2 - 1), a: .25 + rnd() * .55 });
  return arr;
})();
function resizeSky() {
  const r = skyWrap.getBoundingClientRect();
  SDPR = S.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  SW = Math.max(1, r.width); SH = Math.max(1, r.height);
  cv.width = Math.round(SW * SDPR); cv.height = Math.round(SH * SDPR);
  skyDirty = true;
}

// 남쪽 지평선(방위 180°, 고도 0°)을 가운데로 한 평사 투영 — 별자리 모양이 찌그러지지 않고 지평선은 곧은 선
function skyGeom() {
  const groundH = clamp(SH * 0.12, 30, 54);
  const hy = SH - groundH, top = 24;
  const U_TOP = 2 * Math.tan(40 * RAD);         // 남쪽 고도 80°
  const HMAX = 1.75;                             // 가로로 최대 약 ±82°까지
  let ky = (hy - top) / U_TOP;
  let kx = Math.max(ky, (SW / 2) / HMAX);
  if (kx / ky > 1.45) ky = kx / 1.45;
  return { hy, ky, kx, groundH };
}
function stereo(alt, az) {
  const A_ = (az - 180) * RAD, h = alt * RAD;
  const x = Math.cos(h) * Math.sin(A_), y = Math.sin(h), z = Math.cos(h) * Math.cos(A_);
  if (z < -0.35) return null;
  return { u: 2 * x / (1 + z), v: 2 * y / (1 + z) };
}

function drawSky() {
  const G = skyGeom();
  const { hy, ky, kx } = G;
  const X = (az) => SW / 2 + 2 * Math.tan(((az - 180) / 2) * RAD) * kx; // 지평선 위 방위(남쪽을 보면 왼쪽이 동쪽)
  ctx.setTransform(SDPR, 0, 0, SDPR, 0, 0);
  const noon = S.timeMode === 'noon';
  const sunOn = noon && S.sunlight;
  const d = noon ? A.jdays(S.day, 12) : A.jdays(S.day + 1, 0);
  const L = A.lst(d);
  const pre = A.precess(d);
  hits = [];
  let eclLabelAt = null;

  // 하늘 바탕
  const sg = ctx.createLinearGradient(0, 0, 0, hy);
  if (!noon) { sg.addColorStop(0, '#040817'); sg.addColorStop(.7, '#0b1838'); sg.addColorStop(1, '#1b2c55'); }
  else if (sunOn) { sg.addColorStop(0, '#2f78d8'); sg.addColorStop(.75, '#7fbaf0'); sg.addColorStop(1, '#cfe9ff'); }
  else { sg.addColorStop(0, '#1d3a78'); sg.addColorStop(.75, '#3d66ad'); sg.addColorStop(1, '#6f95cf'); }
  ctx.fillStyle = sg; ctx.fillRect(0, 0, SW, SH);

  const proj = (ra, dec) => {
    const h = A.altAz(ra, dec, L); const q = stereo(h.alt, h.az);
    if (!q) return { x: -9999, y: -9999, alt: -90, az: h.az };
    return { x: SW / 2 + q.u * kx, y: hy - q.v * ky, alt: h.alt, az: h.az };
  };

  // 배경 별
  if (!sunOn) {
    const step = S.quality === 'high' ? 1 : 2;
    for (let i = 0; i < bgSky.length; i += step) {
      const s = bgSky[i]; const p = proj(s.ra, s.dec);
      if (p.alt < 0 || p.x < -2 || p.x > SW + 2) continue;
      ctx.fillStyle = `rgba(255,255,255,${(noon ? .35 : .8) * s.a})`;
      ctx.fillRect(p.x, p.y, 1.2, 1.2);
    }
  }

  // 태양이 지나는 길(황도)
  if (!sunOn) {
    ctx.save();
    ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,214,102,.6)';
    ctx.beginPath(); let pen = false, lastX = 0, best = null;
    for (let l = 0; l <= 360; l += 1) {
      const q = A.eclToEq((l - pre) * RAD, 0);
      const p = proj(q.ra, q.dec);
      if (p.alt < -1 || Math.abs(p.x - lastX) > SW / 2) { pen = false; }
      if (p.alt >= -1) {
        if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y);
        if (p.x > SW * .62 && p.x < SW - 40 && p.alt > 3 && (!best || p.x > best.x)) best = p;
      }
      lastX = p.x;
    }
    ctx.stroke(); ctx.restore();
    eclLabelAt = best;
  }

  // 별자리
  const labels = [];

  const hl = S.flash && performance.now() < S.flash.until ? S.flash.id : null;
  if (!sunOn) {
    for (const con of CONS) {
      if (!con.zodiac && noon) continue;
      const pts = {}; let vis = 0;
      for (const [k, s] of Object.entries(con.stars)) { const p = proj(s.ra, s.dec); pts[k] = { ...p, mag: s.mag }; if (p.alt > 0 && p.x > -20 && p.x < SW + 20) vis++; }
      if (!vis) continue;
      const strong = con.zodiac;
      const isHot = con.id === hl || con.id === S.hover;
      // 선
      ctx.lineWidth = isHot ? 3 : strong ? 1.6 : 1;
      ctx.strokeStyle = isHot ? 'rgba(255,214,90,.95)' : strong ? (noon ? 'rgba(230,240,255,.65)' : 'rgba(140,190,255,.8)') : 'rgba(150,170,210,.3)';
      ctx.beginPath();
      for (const [a, b] of con.lines) {
        const p1 = pts[a], p2 = pts[b];
        if (p1.alt < -3 && p2.alt < -3) continue;
        if (Math.abs(p1.x - p2.x) > SW / 2) continue;
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
      // 별
      const list = [];
      for (const p of Object.values(pts)) {
        if (p.alt < 0) continue;
        const r = clamp(3.7 - 0.6 * p.mag, 0.9, 4.4) * (strong ? 1 : .8);
        if (!noon && r > 2) {
          const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
          gr.addColorStop(0, 'rgba(220,235,255,.55)'); gr.addColorStop(1, 'rgba(220,235,255,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = strong ? (isHot ? '#fff3c4' : '#ffffff') : 'rgba(225,232,255,.75)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        list.push(p);
      }
      if (list.length && (con.zodiac || (con.showName && !noon))) {
        const xs = list.map((p) => p.x), ys = list.map((p) => p.y);
        const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
        labels.push({ con, bb, cx: xs.reduce((a, b) => a + b, 0) / xs.length, isHot });
        hits.push({ con, pts: list, bb });
      }
    }
  }

  // 태양 발자취와 태양 (낮 12시)
  let sunRect = null;
  if (noon) {
    const sunAt = (day) => {
      const dd = A.jdays(day, 12); const lam = A.sunLongitude(dd) - A.precess(dd);
      const q = A.eclToEq(lam * RAD, 0); return proj(q.ra, q.dec);
    };
    if (!sunOn && S.trail.length) {
      const tr = S.trail.filter((t) => t !== S.day);
      tr.forEach((t, i) => {
        const p = sunAt(t); if (p.alt < 0) return;
        const age = Math.abs(S.day - t);
        const a = clamp(1 - age / 45, .25, .95);
        ctx.fillStyle = `rgba(255,170,60,${a})`; ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255,240,200,${a * .8})`; ctx.lineWidth = 1; ctx.stroke();
      });
      // 가장 오래된 발자취에 날짜 표시
      const oldest = tr.reduce((m, t) => (Math.abs(S.day - t) > Math.abs(S.day - m) ? t : m), tr[0]);
      if (oldest !== undefined) {
        const p = sunAt(oldest), dd = A.ymd(oldest);
        if (p.alt > 0) {
          ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,220,170,.95)';
          ctx.fillText(`${dd.m}/${dd.d}의 태양`, p.x, p.y + 16);
        }
      }
    }
    const p = sunAt(S.day);
    if (p.alt > -2) {
      const R = clamp(SH / 30, 8, 12);
      if (sunOn) {
        const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 9);
        gl.addColorStop(0, 'rgba(255,255,240,.95)'); gl.addColorStop(.25, 'rgba(255,250,220,.55)'); gl.addColorStop(1, 'rgba(255,250,220,0)');
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, R * 9, 0, Math.PI * 2); ctx.fill();
      }
      const gl2 = ctx.createRadialGradient(p.x, p.y, R * .6, p.x, p.y, R * 3.2);
      gl2.addColorStop(0, 'rgba(255,220,100,.75)'); gl2.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = gl2; ctx.beginPath(); ctx.arc(p.x, p.y, R * 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff4c2'; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffb627'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = '800 13px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(40,30,0,.55)'; ctx.strokeText('태양', p.x, p.y - R - 6);
      ctx.fillStyle = '#ffe9a0'; ctx.fillText('태양', p.x, p.y - R - 6);
      sunRect = { x0: p.x - R - 18, x1: p.x + R + 18, y0: p.y - R - 22, y1: p.y + R + 4 };
    }
  }

  // 땅(언덕·나무)
  ctx.fillStyle = noon ? (sunOn ? '#4f8f3f' : '#2f5a35') : '#0b1710';
  ctx.beginPath(); ctx.moveTo(0, SH);
  for (let x = 0; x <= SW; x += 8) ctx.lineTo(x, hy + 3 - 7 * Math.sin(x / SW * Math.PI * 2.2 + .6) * Math.sin(x / SW * 7.3 + 1.1));
  ctx.lineTo(SW, SH); ctx.closePath(); ctx.fill();
  ctx.fillStyle = noon ? (sunOn ? '#2f6a2c' : '#1f3f26') : '#050c08';
  for (const fx of [0.06, 0.1, 0.83, 0.9, 0.95]) {
    const x = SW * fx, base = hy + 6, hgt = 18 + (fx * 97 % 9);
    ctx.beginPath(); ctx.moveTo(x - 9, base); ctx.lineTo(x, base - hgt); ctx.lineTo(x + 9, base); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 1.5, base - 2, 3, 6);
  }
  // 별자리 이름 — 아래·위·오른쪽·왼쪽 순서로 빈자리를 찾고, 없으면 생략
  const placed = sunRect ? [sunRect] : [];
  ctx.font = '700 13px ' + getComputedStyle(document.body).fontFamily;
  labels.sort((a, b) => (b.isHot - a.isHot) || (b.con.zodiac - a.con.zodiac));
  for (const lb of labels) {
    const name = lb.con.name, tw = ctx.measureText(name).width, th = 15;
    const cands = [
      [lb.cx, lb.bb.y1 + 15], [lb.cx, lb.bb.y0 - 8], [lb.bb.x1 + tw / 2 + 8, (lb.bb.y0 + lb.bb.y1) / 2 + 5], [lb.bb.x0 - tw / 2 - 8, (lb.bb.y0 + lb.bb.y1) / 2 + 5],
    ];
    // 화면 밖이면 안쪽으로 당긴 자리도 시도(12개 별자리 이름은 되도록 남김)
    for (const [x, y] of cands.slice()) cands.push([clamp(x, tw / 2 + 4, SW - tw / 2 - 4), clamp(y, 22 + th, hy - 8)]);
    for (const [x, y] of cands) {
      const r = { x0: x - tw / 2 - 3, x1: x + tw / 2 + 3, y0: y - th + 2, y1: y + 4 };
      if (r.x0 < 2 || r.x1 > SW - 2 || r.y0 < 22 || r.y1 > hy - 6) continue;
      if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
      placed.push(r); lb.rect = r;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = noon ? 'rgba(10,25,60,.55)' : 'rgba(0,0,0,.6)'; ctx.strokeText(name, x, y);
      ctx.fillStyle = lb.isHot ? '#ffe08a' : lb.con.zodiac ? (noon ? '#ffffff' : '#cfe0ff') : '#ffc9a8';
      ctx.fillText(name, x, y);
      const h = hits.find((q) => q.con === lb.con); if (h) h.rect = r;
      break;
    }
  }

  // '태양이 지나는 길' 이름 — 별자리 이름과 겹치지 않는 자리에만
  if (eclLabelAt) {
    ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
    const tw = ctx.measureText('태양이 지나는 길').width;
    for (const [dx, dy] of [[-4, 15], [-4, -8], [-60, 15], [-60, -8]]) {
      const x1 = eclLabelAt.x + dx, y = eclLabelAt.y + dy;
      const r = { x0: x1 - tw - 2, x1: x1 + 2, y0: y - 11, y1: y + 3 };
      if (r.x0 < 2 || r.y0 < 22 || r.y1 > hy - 4) continue;
      if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
      ctx.fillStyle = 'rgba(255,224,140,.95)'; ctx.textAlign = 'right'; ctx.fillText('태양이 지나는 길', x1, y);
      break;
    }
  }
  // 방위
  ctx.textAlign = 'center';
  ctx.font = '800 14px ' + getComputedStyle(document.body).fontFamily;
  const lab = (t, az) => { const x = X(az); if (x < 20 || x > SW - 20) return; ctx.fillStyle = '#ffffff'; ctx.fillText(t, x, hy + 22); ctx.fillRect(x - .75, hy - 2, 1.5, 6); };
  lab('남', 180); ctx.font = '700 12.5px ' + getComputedStyle(document.body).fontFamily; lab('남동', 135); lab('남서', 225);
  ctx.font = '800 13px ' + getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.textAlign = 'left'; ctx.fillText('← 동', 8, hy + 22);
  ctx.textAlign = 'right'; ctx.fillText('서 →', SW - 8, hy + 22);
}

function skyPick(e, hoverOnly) {
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bd = 26;
  for (const h of hits) {
    if (h.rect && x >= h.rect.x0 && x <= h.rect.x1 && y >= h.rect.y0 && y <= h.rect.y1) { best = h; bd = 0; break; }
    for (const p of h.pts) { const dd = Math.hypot(p.x - x, p.y - y); if (dd < bd) { bd = dd; best = h; } }
    if (x >= h.bb.x0 - 6 && x <= h.bb.x1 + 6 && y >= h.bb.y0 - 6 && y <= h.bb.y1 + 6 && bd > 12) { const c = Math.min(bd, 14); if (c < bd) { bd = c; best = h; } }
  }
  return best ? best.con : null;
}
cv.addEventListener('pointermove', (e) => {
  if (isLocked() || e.pointerType === 'touch') return;
  const c = skyPick(e, true);
  const id = c && c.zodiac ? c.id : null;
  cv.style.cursor = c ? 'pointer' : 'default';
  if (id !== S.hover) { S.hover = id; skyDirty = true; }
});
cv.addEventListener('pointerleave', () => { if (S.hover) { S.hover = null; skyDirty = true; } });
cv.addEventListener('pointerdown', (e) => {
  if (isLocked()) return;
  const c = skyPick(e);
  if (!c) return;
  if (!c.zodiac) { toast(`${c.name}는 자료의 12개 별자리가 아니에요`); sound.soft(); return; }
  S.flash = { id: c.id, until: performance.now() + 900 }; skyDirty = true;
  const col = S.cols.indexOf(S.day);
  if (col < 0) {
    toast('표의 날짜(오늘·3개월 뒤…)에 맞추면 기록할 수 있어요 — 3개월 ▶ 버튼을 써 보세요', 2600);
    sound.soft(); return;
  }
  setRecord(S.timeMode, col, c.name);
});

// ---------------------------------------------------------------- 날짜 다루기
function setBase(b) {
  S.base = b;
  S.cols = MONTHS.map((m) => A.addMonths(b, m));
  S.max = S.cols[4] - b;
  lamTable = [];
  aimCamera(b);
  for (let i = 0; i <= S.max; i++) lamTable.push(A.sunLongitude(A.jdays(b + i, 12)));
  const sl = $('daySlider'); sl.max = S.max;
  $('baseInput').value = A.iso(b);
  buildTicks(); buildTableHead();
  S.trail = []; S.myPred = null;
  tween = null; visDay = b; S.day = b - 1; setDay(b);
}
function setDay(d) {
  d = clamp(Math.round(d), S.base, S.base + S.max);
  if (d === S.day) return;
  S.day = d;
  if (d === S.base + S.max && !S.fullYear) {
    S.fullYear = true;
    sound.bell();
    toast('1년 — 지구가 태양을 한 바퀴 돌고, 태양도 처음 별자리로 돌아왔어요', 3600);
  }
  skyDirty = true; need3D = true; stateDirty = true;
  updateUI();
}
function addTrail(day) {
  if (S.trail.includes(day)) return;
  S.trail.push(day); if (S.trail.length > 40) S.trail.shift();
}
function stepDay(n) {
  if (isLocked()) return;
  stopPlay();
  const old = S.day;
  const t = clamp(S.day + n, S.base, S.base + S.max);
  if (t === old) { sound.soft(); return; }
  addTrail(old); tween = null; visDay = t; setDay(t); addTrail(t);
  tickSound(true);
}
function jump3(dir) {
  if (isLocked()) return;
  stopPlay();
  const col = S.cols.indexOf(S.day);
  let t;
  if (col >= 0) t = S.cols[clamp(col + dir, 0, 4)];
  else t = clamp(A.addMonths(S.day, 3 * dir), S.base, S.base + S.max);
  if (t === S.day) { sound.soft(); toast(dir > 0 ? '12개월 뒤가 마지막 칸이에요' : '기준일(오늘)이 첫 칸이에요'); return; }
  const go = () => { tween = { from: visDay, to: t, t0: performance.now(), dur: 800 }; sound.whoosh(); sound._tone({ freq: dir > 0 ? 420 : 760, freq2: dir > 0 ? 760 : 420, type: 'sine', dur: .5, vol: .08 }); };
  if (dir > 0 && S.predictOn) {
    const md = A.ymd(t);
    openPicker({
      title: `${MONTHS[col + 1] ?? 3}개월 뒤(${md.m}월 ${md.d}일) 낮 12시, 태양과 가장 가까운 별자리는?`,
      sub: '먼저 예측하고, 날짜를 옮긴 뒤 하늘과 비교해 보세요. (맞고 틀림은 표시하지 않아요)',
      erase: false,
      onPick: (name) => {
        S.predictions.push(`${A.iso(t)}:${name}`); S.myPred = { day: t, name }; stateDirty = true;
        sound.click(); go();
      },
    });
    return;
  }
  go();
}
let lastTick = 0;
function tickSound(force) {
  const n = performance.now();
  if (!force && n - lastTick < 83) return; // 초당 최대 12번
  lastTick = n;
  sound.tick((S.day - S.base) / Math.max(1, S.max));
}

// 재생
function startPlay() {
  if (isLocked()) return;
  if (S.day >= S.base + S.max) { visDay = S.base; S.trail = []; setDay(S.base); }
  S.playing = true; playAcc = 0; tween = null; sound.on(); hideHint();
  updatePlayBtn();
}
function stopPlay() { if (!S.playing) return; S.playing = false; updatePlayBtn(); }
function updatePlayBtn() {
  const b = $('btnPlay');
  b.textContent = S.playing ? '❚❚ 멈춤' : '▶ 재생';
  b.setAttribute('aria-pressed', String(S.playing));
}

// ---------------------------------------------------------------- 기록 표
function buildTableHead() {
  const tr = document.querySelector('#rec thead tr');
  tr.querySelectorAll('th.col').forEach((x) => x.remove());
  S.cols.forEach((d, i) => {
    const th = document.createElement('th'); th.className = 'col'; th.tabIndex = 0; th.dataset.col = i;
    const md = A.ymd(d);
    th.innerHTML = `${COLNAME[i]}<small>${md.m}/${md.d}</small>`;
    th.title = `${md.y}년 ${md.m}월 ${md.d}일로 가기`;
    const go = () => {
      if (isLocked() || d === S.day) return; stopPlay();
      tween = { from: visDay, to: d, t0: performance.now(), dur: 800 }; sound.whoosh();
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    tr.appendChild(th);
  });
  for (const row of ['noon', 'midnight']) {
    const r = document.querySelector(`#rec tr[data-row=${row}]`);
    r.querySelectorAll('td').forEach((x) => x.remove());
    for (let i = 0; i < 5; i++) {
      const td = document.createElement('td'); td.tabIndex = 0; td.dataset.col = i;
      const open = () => {
        if (isLocked()) return;
        const md = A.ymd(S.cols[i]);
        openPicker({
          title: `${COLNAME[i]}(${md.m}/${md.d}) ${row === 'noon' ? '낮 12시 태양과 가장 가까운 별자리' : '밤 12시 남쪽 하늘 별자리'}`,
          sub: '하늘에서 직접 찾은 별자리를 골라요. 하늘의 별자리를 눌러도 기록돼요.',
          current: S.rec[row][i], erase: true,
          onPick: (name) => setRecord(row, i, name),
        });
      };
      td.addEventListener('click', open);
      td.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      r.appendChild(td);
    }
  }
  renderTable();
}
function renderTable() {
  const col = S.cols.indexOf(S.day);
  document.querySelectorAll('#rec thead th.col').forEach((th, i) => th.classList.toggle('cur', i === col));
  for (const row of ['noon', 'midnight']) {
    const r = document.querySelector(`#rec tr[data-row=${row}]`);
    r.classList.toggle('dim', S.timeMode !== row);
    r.querySelectorAll('td').forEach((td, i) => {
      const v = S.rec[row][i];
      td.textContent = v || '';
      td.classList.toggle('filled', !!v);
      td.classList.toggle('cur', i === col && S.timeMode === row);
      td.setAttribute('aria-label', `${COLNAME[i]} ${row === 'noon' ? '낮 12시' : '밤 12시'}: ${v || '비어 있음'}`);
    });
  }
}
function setRecord(row, i, name) {
  const before = S.rec[row][i];
  S.rec[row][i] = name || '';
  renderTable();
  const td = document.querySelectorAll(`#rec tr[data-row=${row}] td`)[i];
  if (name && td) { td.classList.remove('flash'); void td.offsetWidth; td.classList.add('flash'); }
  const done = [...S.rec.noon, ...S.rec.midnight].every(Boolean);
  if (name && name !== before) {
    if (done && !S.doneOnce) {
      S.doneOnce = true; sound.chime();
      toast('기록 완료! 왼쪽 우주 화면의 시선선과 비교해 보세요', 3400);
    } else sound.ding();
  } else if (!name) sound.soft();
  stateDirty = false; pushState(); // 기록은 바로 보냄
}

// 별자리 고르기 창
let pickCb = null;
function openPicker({ title, sub, current = '', erase = true, onPick }) {
  $('pickTitle').textContent = title; $('pickSub').textContent = sub || '';
  const grid = $('pickGrid'); grid.innerHTML = '';
  for (const n of ZNAMES) {
    const b = document.createElement('button'); b.textContent = n; if (n === current) b.classList.add('sel');
    b.addEventListener('click', () => { closePicker(); onPick(n); });
    grid.appendChild(b);
  }
  $('pickErase').hidden = !erase;
  pickCb = onPick;
  $('picker').hidden = false; sound.soft();
  grid.querySelector('button').focus();
}
function closePicker() { $('picker').hidden = true; pickCb = null; }
$('pickCancel').addEventListener('click', closePicker);
$('pickErase').addEventListener('click', () => { const cb = pickCb; closePicker(); if (cb) cb(''); });
$('picker').addEventListener('pointerdown', (e) => { if (e.target.id === 'picker') closePicker(); });

function askConfirm(msg) {
  return new Promise((res) => {
    $('confirmMsg').textContent = msg; $('confirmBox').hidden = false; $('confirmNo').focus();
    const done = (v) => { $('confirmBox').hidden = true; $('confirmYes').onclick = $('confirmNo').onclick = null; res(v); };
    $('confirmYes').onclick = () => done(true); $('confirmNo').onclick = () => done(false);
  });
}

// ---------------------------------------------------------------- 화면 갱신
const fmtDate = (i) => { const d = A.ymd(i); return `${d.y}년 ${d.m}월 ${d.d}일`; };
function orbitAngle() {
  const days = S.day - S.base;
  let ang = A.norm360(lamTable[days] - lamTable[0]);
  if (days > 300 && ang < 180) ang += 360;
  return { days, ang };
}
function updateUI() {
  const noon = S.timeMode === 'noon';
  $('dateOut').innerHTML = `${fmtDate(S.day)}<span class="tm ${S.timeMode}">${noon ? '낮 12시' : '밤 12시'}</span>`;
  const sl = $('daySlider'); sl.value = S.day - S.base;
  const md = A.ymd(S.day);
  sl.setAttribute('aria-valuetext', `${md.m}월 ${md.d}일, 기준일부터 ${S.day - S.base}일`);
  const { days, ang } = orbitAngle();
  $('obAngle').textContent = `${ang.toFixed(1)}°`;
  $('obDays').textContent = `${days}일`;
  $('obRate').textContent = days > 0 ? `${(ang / days).toFixed(2)}°/일` : '–';
  const nx = A.ymd(S.day + 1);
  if (noon) {
    const dd = A.jdays(S.day, 12), L = A.lst(dd);
    const q = A.eclToEq((A.sunLongitude(dd) - A.precess(dd)) * RAD, 0);
    const alt = A.altAz(q.ra, q.dec, L).alt;
    $('skyTime').innerHTML = `${md.m}월 ${md.d}일 12:00<span class="alt">태양 고도 ${Math.round(alt)}°</span>`;
  } else $('skyTime').textContent = `밤 12시 = ${nx.m}월 ${nx.d}일 00:00`;
  // 안내
  let note = '';
  if (noon && S.sunlight) note = '☀ 햇빛이 밝아 태양 근처 별자리는 볼 수 없어요';
  else if (noon && A.noonSun(S.day).con === '뱀주인자리') note = '이때 태양은 뱀주인자리 근처예요. 자료의 12개 중에서 더 가까운 별자리를 고르세요';
  $('skyNote').hidden = !note; $('skyNote').textContent = note;
  $('skyNote').classList.toggle('top', !!note && !S.sunlight); // 뱀주인자리 안내는 위쪽(12월 태양은 낮음)
  const pt = S.myPred && S.myPred.day === S.day;
  $('predTag').hidden = !pt; if (pt) $('predTag').textContent = `내 예측(낮 12시): ${S.myPred.name}`;
  document.querySelectorAll('#ticks .tk').forEach((t) => t.classList.toggle('cur', +t.dataset.day === S.day));
  document.querySelectorAll('#timeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === S.timeMode)));
  $('btnSun').disabled = !noon;
  $('btnSun').setAttribute('aria-pressed', String(S.sunlight));
  $('btnSun').textContent = S.sunlight ? '햇빛 끄기' : '햇빛 켜기';
  document.querySelectorAll('#legend .lg').forEach((l) => l.classList.toggle('on', l.dataset.mode === S.timeMode));
  $('m3').disabled = $('m1').disabled = S.day <= S.base;
  $('p3').disabled = $('p1').disabled = S.day >= S.base + S.max;
  renderTable();
}

function buildTicks() {
  const tk = $('ticks'); tk.innerHTML = '';
  const pct = (d) => `calc(${(d - S.base) / S.max * 100}% + ${(0.5 - (d - S.base) / S.max) * 16}px)`; // 손잡이 폭 보정
  S.cols.forEach((d, i) => {
    const el = document.createElement('span'); el.className = 'tk'; el.dataset.day = d;
    el.textContent = COLNAME[i]; el.style.left = pct(d);
    el.addEventListener('click', () => { if (isLocked()) return; stopPlay(); tween = { from: visDay, to: d, t0: performance.now(), dur: 800 }; sound.whoosh(); });
    tk.appendChild(el);
  });
  // 계절 색 띠(북반구: 봄 3~5월, 여름 6~8월, 가을 9~11월, 겨울 12~2월)
  const col = (m) => (m >= 3 && m <= 5 ? '#8fd18a' : m >= 6 && m <= 8 ? '#ffb36b' : m >= 9 && m <= 11 ? '#e0a35a' : '#9cc3f0');
  const segsS = []; // [색, 시작 i, 끝 i]
  for (let i = 0; i <= S.max; i++) {
    const c = col(A.ymd(S.base + i).m);
    if (!segsS.length || segsS[segsS.length - 1][0] !== c) segsS.push([c, i, i]); else segsS[segsS.length - 1][2] = i;
  }
  const stops = [];
  for (const [c, a, b] of segsS) {
    stops.push(`${c} ${(a / S.max * 100).toFixed(2)}%`, `${c} ${((b + 1) / S.max * 100).toFixed(2)}%`);
    if ((b - a) / S.max < 0.1) continue; // 너무 짧은 구간은 이름 생략
    const nm = { '#8fd18a': '봄', '#ffb36b': '여름', '#e0a35a': '가을', '#9cc3f0': '겨울' }[c];
    const sp = document.createElement('span'); sp.className = 'ssn'; sp.textContent = nm;
    sp.style.left = `${((a + b) / 2 / S.max) * 100}%`; tk.appendChild(sp);
  }
  $('seasonBand').style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
}

// ---------------------------------------------------------------- SimBridge
function pushState() {
  const n = A.noonSun(S.day), m = A.midnightSouth(S.day);
  const { days, ang } = orbitAngle();
  const col = S.cols.indexOf(S.day);
  SimBridge.setState({
    baseDate: A.iso(S.base),
    date: A.iso(S.day),
    monthsAfter: col >= 0 ? MONTHS[col] : '',
    timeMode: S.timeMode,
    daysElapsed: days,
    orbitAngle: +ang.toFixed(1),
    sunLongitude: +n.lam.toFixed(1),
    sunCon: n.con,
    nightSouthCon: m.con,
    sunlight: S.sunlight,
    recordNoon: S.rec.noon.join(','),
    recordNight: S.rec.midnight.join(','),
    recordDone: [...S.rec.noon, ...S.rec.midnight].every(Boolean),
    predictions: S.predictions.join(','),
    viewTop: S.viewTop,
    fullYear: S.fullYear,
  });
}

// ---------------------------------------------------------------- 조작 연결
function holdRepeat(btn, fn) {
  let t1 = 0, t2 = 0;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || btn.disabled) return;
    fn(); stop();
    t1 = setTimeout(() => { t2 = setInterval(() => { if (btn.disabled) stop(); else fn(); }, 90); }, 420);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('click', (e) => { if (e.detail === 0) fn(); }); // 키보드 Enter/Space
}
holdRepeat($('m1'), () => stepDay(-1));
holdRepeat($('p1'), () => stepDay(1));
$('m3').addEventListener('click', () => jump3(-1));
$('p3').addEventListener('click', () => jump3(1));

const slider = $('daySlider');
slider.addEventListener('input', () => {
  if (isLocked()) { slider.value = S.day - S.base; return; }
  stopPlay();
  const old = S.day, t = S.base + +slider.value;
  if (Math.abs(t - old) <= 3) addTrail(old);
  tween = null; visDay = t; setDay(t); tickSound();
});
slider.addEventListener('keydown', (e) => {
  if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); jump3(e.key === 'ArrowRight' ? 1 : -1); }
  else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); jump3(e.key === 'PageUp' ? 1 : -1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault(); stepDay(e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1);
  }
});

$('btnPlay').addEventListener('click', () => { if (S.playing) { stopPlay(); sound.off(); } else startPlay(); });
document.querySelectorAll('#speedSeg button').forEach((b) => b.addEventListener('click', () => {
  if (isLocked()) return;
  S.speed = +b.dataset.sp; sound.click();
  document.querySelectorAll('#speedSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
$('predictToggle').addEventListener('change', (e) => {
  if (isLocked()) { e.target.checked = S.predictOn; return; }
  S.predictOn = e.target.checked; sound.click();
  if (S.predictOn) toast('3개월 ▶ 를 누르면 먼저 예측해요');
});

function setTime(mode) {
  if (isLocked() || mode === S.timeMode) return;
  S.timeMode = mode;
  spinTween = { from: spinOff, to: mode === 'noon' ? 0 : Math.PI, t0: performance.now(), dur: 650 };
  if (mode === 'noon') { [1046, 1318, 1568].forEach((f, i) => sound._tone({ freq: f, type: 'triangle', dur: .3, vol: .1, delay: i * .06 })); }
  else { [392, 330, 262].forEach((f, i) => sound._tone({ freq: f, type: 'sine', dur: .45, vol: .14, delay: i * .08 })); }
  skyDirty = true; need3D = true; stateDirty = true; updateUI();
}
document.querySelectorAll('#timeSeg button').forEach((b) => b.addEventListener('click', () => setTime(b.dataset.t)));
$('btnSun').addEventListener('click', () => {
  if (isLocked() || S.timeMode !== 'noon') return;
  S.sunlight = !S.sunlight;
  if (S.sunlight) sound._noise({ dur: .35, from: 2600, to: 400, vol: .1 }); else sound.on();
  skyDirty = true; stateDirty = true; updateUI();
});

document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => {
  if (isLocked()) return;
  flyTo(b.dataset.view === 'top' ? CAM_TOP : CAM_TILT); sound.whoosh(); hideHint();
}));

async function changeBase(b) {
  if (b === null || b === S.base) { $('baseInput').value = A.iso(S.base); return; }
  const has = [...S.rec.noon, ...S.rec.midnight].some(Boolean);
  if (has && !(await askConfirm('기준일을 바꾸면 기록 표의 날짜가 달라져요. 지금 기록을 지우고 바꿀까요?'))) {
    $('baseInput').value = A.iso(S.base); return;
  }
  stopPlay();
  S.rec.noon.fill(''); S.rec.midnight.fill(''); S.doneOnce = false;
  setBase(b); sound.whoosh(); stateDirty = true;
  toast(`기준일: ${fmtDate(b)}`);
}
$('baseInput').addEventListener('change', (e) => { if (isLocked()) { e.target.value = A.iso(S.base); return; } changeBase(A.fromIso(e.target.value)); });
$('btnExample').addEventListener('click', () => { if (!isLocked()) changeBase(A.dayIndex(2025, 11, 3)); });

$('btnClear').addEventListener('click', async () => {
  if (isLocked()) return;
  if (!(await askConfirm('기록 표의 10칸을 모두 지울까요?'))) return;
  S.rec.noon.fill(''); S.rec.midnight.fill(''); S.doneOnce = false; renderTable(); stateDirty = true; sound.reset();
});
$('btnAstro').addEventListener('click', () => {
  const p = $('astroPop'); p.hidden = !p.hidden; $('btnAstro').setAttribute('aria-expanded', String(!p.hidden)); sound.soft();
});
$('astroClose').addEventListener('click', () => { $('astroPop').hidden = true; $('btnAstro').setAttribute('aria-expanded', 'false'); });

$('btnReset').addEventListener('click', () => {
  if (isLocked()) return;
  stopPlay();
  S.sunlight = false; S.trail = []; S.myPred = null;
  if (S.timeMode !== 'noon') { S.timeMode = 'noon'; spinTween = { from: spinOff, to: 0, t0: performance.now(), dur: 650 }; }
  tween = null; visDay = S.base; S.day = S.base + 1; setDay(S.base);
  flyTo(CAM_TILT);
  sound.reset(); skyDirty = true; need3D = true; stateDirty = true; updateUI();
});
$('btnMute').addEventListener('click', () => {
  const m = sound.toggleMute(); $('btnMute').textContent = m ? '🔇' : '🔊';
  if (!m) sound.click();
});
$('btnMute').textContent = sound.muted ? '🔇' : '🔊';
function applyQuality() {
  $('qLbl').textContent = `품질: ${S.quality === 'high' ? '높음' : '낮음'}`;
  bgStars.geometry.setDrawRange(0, S.quality === 'high' ? 1400 : 600);
  resize3D(); resizeSky();
}
$('btnQuality').addEventListener('click', () => {
  S.quality = S.quality === 'high' ? 'low' : 'high'; applyQuality(); sound.click();
  toast(S.quality === 'high' ? '그래픽 품질: 높음 (빛번짐 켬)' : '그래픽 품질: 낮음 (빠르게)');
});

document.addEventListener('keydown', (e) => {
  if (!$('picker').hidden) { if (e.key === 'Escape') closePicker(); return; }
  if (!$('confirmBox').hidden) return;
  if (e.key === 'Escape' && !$('astroPop').hidden) { $('astroPop').hidden = true; return; }
  const tg = e.target;
  if (tg === slider || (tg.tagName === 'INPUT' && tg.type !== 'checkbox') || tg.tagName === 'SELECT') return;
  if (isLocked()) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    if (e.shiftKey) jump3(e.key === 'ArrowRight' ? 1 : -1); else stepDay(e.key === 'ArrowRight' ? 1 : -1);
  } else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); jump3(e.key === 'PageUp' ? 1 : -1); }
  else if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') setTime(S.timeMode === 'noon' ? 'midnight' : 'noon');
  else if (e.key === ' ' && (tg === document.body || tg === renderer.domElement)) { e.preventDefault(); $('btnPlay').click(); }
});

SimBridge.onLock = () => { stopPlay(); closePicker(); };

// ---------------------------------------------------------------- 크기 맞춤·반복
new ResizeObserver(() => { resize3D(); }).observe(spaceEl);
new ResizeObserver(() => { resizeSky(); }).observe(skyWrap);

let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  // 재생
  if (S.playing) {
    playAcc += dt * S.speed;
    const n = Math.floor(playAcc);
    const end = S.base + S.max;
    if (n > 0) {
      playAcc -= n;
      const old = S.day, d = Math.min(end, S.day + n);
      for (let k = old; k <= d; k++) if ((k - S.base) % 5 === 0) addTrail(k); // 재생 중에는 5일마다 발자취
      setDay(d);
      if (d >= end) { S.playing = false; playAcc = 0; updatePlayBtn(); }
    }
    visDay = S.day + (S.playing ? Math.min(playAcc, 0.999) : 0);
    need3D = true;
  }
  // 날짜 이징(3개월 건너뛰기 등)
  if (tween) {
    const k = clamp((t - tween.t0) / tween.dur, 0, 1);
    visDay = tween.from + (tween.to - tween.from) * ease.inOutCubic(k);
    setDay(Math.round(visDay));
    if (k >= 1) { visDay = tween.to; setDay(tween.to); tween = null; }
    need3D = true;
  }
  if (spinTween) {
    const k = clamp((t - spinTween.t0) / spinTween.dur, 0, 1);
    spinOff = spinTween.from + (spinTween.to - spinTween.from) * ease.inOutCubic(k);
    if (k >= 1) spinTween = null;
    need3D = true;
  }
  if (camTween) {
    const k = clamp((t - camTween.t0) / camTween.dur, 0, 1), e = ease.inOutCubic(k);
    const f = camTween.from, to = camTween.to;
    camera.position.setFromSpherical(new THREE.Spherical(f.r + (to.r - f.r) * e, f.phi + (to.phi - f.phi) * e, f.theta + (to.theta - f.theta) * e));
    camera.lookAt(0, 0, 0);
    if (k >= 1) camTween = null;
    need3D = true; checkTopView();
  } else if (controls.update()) need3D = true;
  if (S.flash && t < S.flash.until + 50) skyDirty = true;
  if (need3D) { need3D = false; render3D(); }
  if (skyDirty) { skyDirty = false; drawSky(); }
  if (stateDirty && (!S.playing || t - lastPush > 200)) { stateDirty = false; lastPush = t; pushState(); }
}
let lastPush = 0;

// 시작
setBase(S.base);
applyQuality();
updatePlayBtn();
requestAnimationFrame(loop);
