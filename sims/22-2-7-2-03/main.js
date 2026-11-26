// 22-2-7-2-03 달의 위상 변화 — 우주 시점(위에서 본 태양·지구·달) + 지구에서 본 달
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { sound } from '../../lib/sound.js';
import { clamp, DEG, ease, paintRange, FpsMonitor } from '../../lib/utils.js';

const UNIT = '22-2-7-2-03';
SimBridge.init(UNIT);

/* ───────── 상수 (설계서 '화면에 나오는 모든 수치') ───────── */
const R_ORBIT = 4.2;        // 지구-달 거리(화면 단위, 실제 비율 아님)
const EARTH_R = 0.95;
const MOON_R = 0.5;
const SUN_X = 10.2, SUN_R = 1.25;
const LUNAR_MONTH = 29.5;   // 삭 → 다음 삭 (일)
const LAP_SECONDS = 24;     // 1배일 때 한 바퀴 (화면 시간, 초)
const SNAP_DEG = 3;         // 끌어 놓을 때 표시점에 붙는 범위
const NEAR_DEG = 10;        // 화면에 '(○) 근처'로 나오는 범위 — 과제 중에는 이 안에 놓으면 그 표시점에 붙임
const POS = ['가', '나', '다', '라', '마', '바', '사', '아'];
const NAMES = ['삭', '초승달', '상현달', '', '망(보름달)', '', '하현달', '그믐달'];
// 교과서에 이름이 없는 (라)·(바)는 어디쯤인지만 알려 줌
const BETWEEN = { 3: '상현달과 보름달 사이', 5: '보름달과 하현달 사이' };
const posLabel = i => `(${POS[i]}) ${NAMES[i] || BETWEEN[i]}`;

const norm = d => ((d % 360) + 360) % 360;
const angDiff = (a, b) => { let d = norm(b - a); if (d > 180) d -= 360; return d; }; // a→b 최단 (−180~180]
const nearestIdx = th => Math.round(norm(th) / 45) % 8;
const litPercent = th => Math.round((1 - Math.cos(th * DEG)) / 2 * 100);
const daysAfterNew = th => Math.round(norm(th) / 360 * LUNAR_MONTH * 10) / 10;
// 화면 '위치' 칸 글: 표시점 위면 이름, ±10° 안이면 '근처', 그 밖이면 두 표시점 '사이'
function posText(th) {
  th = norm(th); const i = nearestIdx(th), off = angDiff(i * 45, th);
  if (Math.abs(off) < 0.5) return posLabel(i);
  if (Math.abs(off) <= NEAR_DEG) return posLabel(i) + ' 근처';
  const a = off > 0 ? i : (i + 7) % 8, b = (a + 1) % 8;
  return `(${POS[a]})와 (${POS[b]}) 사이`;
}

/* ───────── 소리 (lib/sound.js 위에 이 단원용 소리) ───────── */
const sfx = {
  snap: () => sound._tone({ freq: 1250, freq2: 720, type: 'sine', dur: 0.07, vol: 0.2 }),
  start: () => { sound._noise({ dur: 0.45, from: 250, to: 900, vol: 0.09 }); sound._tone({ freq: 196, freq2: 262, type: 'sine', dur: 0.3, vol: 0.12 }); },
  stop: () => sound._tone({ freq: 520, freq2: 300, type: 'triangle', dur: 0.12, vol: 0.13 }),
  pass: () => sound._tone({ freq: 980, type: 'sine', dur: 0.05, vol: 0.05 }),
  right: () => { sound._tone({ freq: 880, type: 'triangle', dur: 0.22, vol: 0.14 }); sound._tone({ freq: 1318, type: 'triangle', dur: 0.32, vol: 0.14, delay: 0.11 }); },
  wrong: () => sound._tone({ freq: 190, freq2: 140, type: 'sine', dur: 0.2, vol: 0.2 }),
  bell: () => sound.bell(),
  done: () => [523, 659, 784, 1046, 1318].forEach((f, i) => sound._tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.12, delay: i * 0.08 })),
  toggle: () => sound.click(),
  pick: () => sound._tone({ freq: 700, freq2: 900, type: 'sine', dur: 0.05, vol: 0.1 }),
};

/* ───────── 상태 ───────── */
const S = {
  theta: 30,                 // 공전 각도 θ (°), 지구에서 본 태양 방향 0°, 시계 반대 방향 +
  playing: false,
  speed: 1,
  tween: null,               // {from, delta, t, dur}
  dragging: false,
  visited: new Set(),
  lapDone: false,
  cardsPlaced: 0,
  cardMistakes: 0,
  mirrorMistake: false,
  prediction: '',
  predictionAfter: '',
  taskFull: false, taskFirstQuarter: false,
  activeTask: null,          // 'full' | 'fq'
  taskFullFirstTry: '', taskFirstQuarterFirstTry: '',
  showLitHalf: false, showSeenHalf: false, showShadow: false,
  quality: 'high',
};
let needsRender = true;       // 바뀐 것이 있을 때만 3D를 다시 그림
// 웹앱의 잠금 메시지(SimBridge) 또는 html.sim-locked 클래스 둘 다 잠금으로 봄
function isLocked() { return SimBridge.locked || document.documentElement.classList.contains('sim-locked'); }

/* ───────── 절차적 텍스처 ───────── */
function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = t => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
           L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x, y, z, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}
function sphereTexture(w, h, shade) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); const img = g.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * Math.PI * 2;
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
      const [r, gg, b] = shade(x, y, z, lat);
      const k = (j * w + i) * 4;
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const craters = Array.from({ length: 46 }, (_, i) => {
  const u = hash3(i, 1, 7) * 2 - 1, ph = hash3(i, 9, 3) * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return { x: s * Math.cos(ph), y: u, z: s * Math.sin(ph), r: 0.04 + hash3(i, 5, 5) * 0.13 };
});
const moonShade = (x, y, z) => {
  let v = 0.62 + (fbm(x * 3 + 10, y * 3, z * 3, 5) - 0.5) * 0.35;
  const mare = fbm(x * 1.4 + 3, y * 1.4 + 1, z * 1.4, 3);
  if (mare > 0.55) v -= Math.min(0.22, (mare - 0.55) * 1.6);
  for (const c of craters) {
    const d = Math.hypot(x - c.x, y - c.y, z - c.z) / c.r;
    if (d < 1) v -= 0.1 * (1 - d) * 0.8; else if (d < 1.25) v += 0.08 * (1.25 - d) * 4;
  }
  v = clamp(v, 0.15, 0.95) * 255;
  return [v, v * 0.985, v * 0.95];
};
const earthShade = (x, y, z, lat) => {
  const n = fbm(x * 1.8 + 5, y * 1.8, z * 1.8, 5);
  const ice = Math.abs(lat) > 1.22 + (n - 0.5) * 0.3;
  if (ice) return [236, 242, 248];
  if (n > 0.53) {
    const dry = fbm(x * 4, y * 4 + 7, z * 4, 3);
    return dry > 0.55 ? [176, 150, 98] : [62 + n * 60, 128 + n * 40, 60];
  }
  const deep = clamp((0.53 - n) * 4, 0, 1);
  const cl = fbm(x * 3 + 20, y * 6, z * 3, 4) > 0.62 ? 1 : 0;
  if (cl) return [228, 236, 244];
  return [30 - deep * 14, 96 - deep * 40, 170 - deep * 40];
};
function glowTexture(inner, outer) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ───────── 3D 장면 ───────── */
const L_SHARED = 0, L_MAIN = 1; // L_MAIN: 우주 시점에만 보이는 것
const stageEl = document.getElementById('stage');
// WebGL 렌더러는 하나만 씀('지구에서 본 달'은 2D 캔버스에 빛 계산으로 그림).
// 품질 '낮음'은 안티에일리어싱을 끄려고 렌더러를 새로 만듦 → 이벤트는 캔버스가 아니라 stageEl에 붙임.
let renderer = null;
function makeRenderer(aa) {
  if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
  renderer = new THREE.WebGLRenderer({ antialias: aa, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = 'block';
  stageEl.prepend(renderer.domElement);
}
makeRenderer(true);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
stageEl.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
camera.layers.enable(L_MAIN);
const VIEW_TARGET = new THREE.Vector3(2.4, 0, 0.2);

// 빛: 태양 쪽(+x)에서 오는 평행광 + 아주 약한 주변광(지구 반사광 정도)
const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
sunLight.position.set(30, 0, 0); sunLight.layers.enableAll();
scene.add(sunLight, sunLight.target);
const amb = new THREE.AmbientLight(0x8090c0, 0.12); amb.layers.enableAll(); scene.add(amb);

function onMain(obj) { obj.traverse(o => o.layers.set(L_MAIN)); return obj; }
function label(html, cls, pos, parent = scene) {
  const d = document.createElement('div'); d.className = 'lbl ' + (cls || ''); d.innerHTML = html;
  const o = new CSS2DObject(d); o.position.copy(pos); o.layers.set(L_MAIN); parent.add(o); return o;
}

// 별
let stars;
function makeStars(n) {
  if (stars) { scene.remove(stars); stars.geometry.dispose(); }
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 80;
    p.set([r * s * Math.cos(ph), r * u, r * s * Math.sin(ph)], i * 3);
    const b = 0.45 + Math.random() * 0.55; c.set([b, b, b * (0.9 + Math.random() * 0.2)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, sizeAttenuation: true, depthWrite: false }));
  scene.add(stars);
}

// 태양 (우주 시점에만)
const sun = new THREE.Group();
sun.position.set(SUN_X, 0, 0);
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 32, 20), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
sun.add(sunBall);
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,220,120,0.9)', 'rgba(255,170,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
sunGlow.scale.set(SUN_R * 5, SUN_R * 5, 1); sun.add(sunGlow);
scene.add(onMain(sun));
label('태양', 'sun', new THREE.Vector3(SUN_X, 0, SUN_R + 0.9));

// 햇빛 화살표
const rays = new THREE.Group();
const rayMat = new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.55, depthWrite: false });
for (const z of [-3.6, -1.8, 1.8, 3.6]) {
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), rayMat);
  shaft.rotation.z = Math.PI / 2; shaft.position.set(7.6, 0, z);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.35, 12), rayMat);
  head.rotation.z = Math.PI / 2; head.position.set(6.35, 0, z);
  rays.add(shaft, head);
}
scene.add(onMain(rays));
label('햇빛', 'ray', new THREE.Vector3(7.6, 0, -4.3));

// 지구 (우주 시점에만 — 지구에서 본 달 카메라가 지구 안에 있으므로)
const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 48, 32), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }));
earth.material.map = sphereTexture(512, 256, earthShade);
scene.add(onMain(earth));
label('지구', 'earth', new THREE.Vector3(0, 0, EARTH_R + 0.45));
// 지구 위 관측자 쪽 표시: 북극점
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), new THREE.MeshBasicMaterial({ color: 0xdde6ff }));
pole.position.y = EARTH_R + 0.2; scene.add(onMain(pole));

// 궤도·표시점·화살표
const orbitPts = [];
for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; orbitPts.push(new THREE.Vector3(R_ORBIT * Math.cos(a), 0, -R_ORBIT * Math.sin(a))); }
const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbitPts), new THREE.LineBasicMaterial({ color: 0x8da2d8, transparent: true, opacity: 0.55 }));
scene.add(onMain(orbit));
const posOf = (deg, r = R_ORBIT) => new THREE.Vector3(r * Math.cos(deg * DEG), 0, -r * Math.sin(deg * DEG));
const markers = [], markerLabels = [];
// 위치 라벨은 달(반지름 0.5)과 겹치지 않게 궤도 바깥으로 넉넉히
const labelR = i => R_ORBIT + 1.5 + 0.85 * Math.max(0, Math.sin(i * 45 * DEG)) + 0.2 * Math.max(0, -Math.sin(i * 45 * DEG)) + 0.45 * Math.abs(Math.cos(i * 45 * DEG));
const markerMat = new THREE.MeshBasicMaterial({ color: 0xe0453a });
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), markerMat.clone());
  m.position.copy(posOf(i * 45)); scene.add(onMain(m)); markers.push(m);
  const name = NAMES[i] ? `<small>${NAMES[i]}</small>` : '';
  const ml = label(`<span class="in">(${POS[i]})${name}</span>`, 'pos', posOf(i * 45, labelR(i)));
  ml.inner = ml.element.firstChild; ml.push = 0; markerLabels.push(ml);
}
const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff6a4d });
for (let i = 0; i < 8; i++) {
  const a = i * 45 + 22.5;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 12), arrowMat);
  cone.position.copy(posOf(a));
  const tan = new THREE.Vector3(-Math.sin(a * DEG), 0, -Math.cos(a * DEG));
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
  scene.add(onMain(cone));
}

// 달 (두 화면 모두)
const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 48, 32), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
moon.material.map = sphereTexture(512, 256, moonShade);
const moonTexImg = moon.material.map.image.getContext('2d').getImageData(0, 0, 512, 256); // '지구에서 본 달'에도 같은 무늬를 씀
scene.add(moon);
const moonHit = new THREE.Mesh(new THREE.SphereGeometry(MOON_R * 2.1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
scene.add(onMain(moonHit));
const moonLabel = label('달', 'moon', new THREE.Vector3());
const moonHalo = new THREE.Mesh(new THREE.RingGeometry(MOON_R * 1.9, MOON_R * 2.02, 48), new THREE.MeshBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
moonHalo.rotation.x = -Math.PI / 2; scene.add(onMain(moonHalo));

// '햇빛 받는 반쪽'(노랑) · '지구에서 보이는 반쪽'(파랑) 반원 테두리
function halfRing(r1, r2, color) {
  const g = new THREE.RingGeometry(r1, r2, 64, 1, -Math.PI / 2, Math.PI);
  g.rotateX(-Math.PI / 2);
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false })));
  // 반쪽 경계(지름) 표시
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, r2 * 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  grp.add(edge);
  grp.visible = false; scene.add(onMain(grp));
  return grp;
}
const litRing = halfRing(MOON_R * 1.12, MOON_R * 1.4, 0xf5c518);
const seenRing = halfRing(MOON_R * 1.5, MOON_R * 1.78, 0x3b8cff);
// 지구 → 달 시선(파랑 점선)
const sightGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
const sight = new THREE.Line(sightGeo, new THREE.LineDashedMaterial({ color: 0x6aa6ff, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.9 }));
sight.visible = false; scene.add(onMain(sight));
// 지구 축소판 반쪽 테두리 (지구도 태양 쪽 절반이 밝음)
const earthLitRing = halfRing(EARTH_R * 1.08, EARTH_R * 1.16, 0xf5c518);

// 지구 그림자 (반투명 원뿔, 위치만 표시 — 달을 어둡게 하지는 않음)
const SH_LEN = 7.2;
const shadow = new THREE.Group();
const shGeo = new THREE.CylinderGeometry(EARTH_R * 0.35, EARTH_R, SH_LEN, 48, 1, true);
shGeo.rotateZ(Math.PI / 2); shGeo.translate(-SH_LEN / 2, 0, 0);
shadow.add(new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ color: 0x05030f, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide })));
const shEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(EARTH_R * 0.35, EARTH_R, SH_LEN, 2, 1, true).rotateZ(Math.PI / 2).translate(-SH_LEN / 2, 0, 0)),
  new THREE.LineBasicMaterial({ color: 0x9a92e0, transparent: true, opacity: 0.6 }));
shadow.add(shEdge);
shadow.visible = false; scene.add(onMain(shadow));
const shadowLabel = label('지구 그림자', 'shadow', new THREE.Vector3(-2.3, 0, 0));
shadowLabel.visible = false;

/* ───────── 지구에서 본 달 (2D 캔버스, 아래 drawMoonView) ───────── */
const moonViewEl = document.getElementById('moonView');
const mvCanvas = document.createElement('canvas');
moonViewEl.prepend(mvCanvas);
const mvCtx = mvCanvas.getContext('2d');
// 달 반지름이 보이는 각: atan(0.5/4.2)≈6.8° → 시야 19°면 원 지름이 창의 약 71 %

/* ───────── 카메라 조작 ───────── */
const raycaster = new THREE.Raycaster(); raycaster.layers.set(L_MAIN);
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let hintShown = true;
const hintEl = document.getElementById('stageHint');
function hideHint() { if (hintShown) { hintShown = false; hintEl.classList.add('hide'); } }
// 시작 안내는 무대 오른쪽 위(라벨 자리를 비워 둔 곳)에 두고, 학생이 처음 조작할 때까지 남김. 그동안 달 둘레 고리가 깜박임
function showHint() { hintShown = true; hintEl.classList.remove('hide'); needsRender = true; }
function setNdc(e) {
  const r = stageEl.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
function angleAtPointer(e) {
  setNdc(e); raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, p)) return null;
  return norm(Math.atan2(-p.z, p.x) / DEG);
}
let dragId = null;
// OrbitControls보다 먼저 등록해서 달을 잡으면 화면 회전을 막음
stageEl.addEventListener('pointerdown', e => {
  if (isLocked()) { e.stopImmediatePropagation(); return; }
  setNdc(e); raycaster.setFromCamera(ndc, camera);
  if (raycaster.intersectObject(moonHit).length) {
    e.stopImmediatePropagation(); e.preventDefault();
    dragId = e.pointerId; stageEl.setPointerCapture(e.pointerId);
    S.dragging = true; S.tween = null; if (S.playing) setPlaying(false);
    stageEl.style.cursor = 'grabbing'; sfx.pick(); hideHint(); needsRender = true;
  }
});
stageEl.addEventListener('pointermove', e => {
  if (S.dragging && e.pointerId === dragId) {
    const a = angleAtPointer(e); if (a !== null) S.theta = a;
    return;
  }
  if (e.pointerType === 'mouse' && !S.dragging && !e.buttons) {
    setNdc(e); raycaster.setFromCamera(ndc, camera);
    stageEl.style.cursor = raycaster.intersectObject(moonHit).length ? 'grab' : '';
  }
});
function endDrag(e) {
  if (!S.dragging || e.pointerId !== dragId) return;
  S.dragging = false; dragId = null; stageEl.style.cursor = ''; needsRender = true;
  const i = nearestIdx(S.theta);
  if (Math.abs(angDiff(S.theta, i * 45)) <= SNAP_DEG) moveTo(i * 45, { fast: true });
  else { placed(); pushState(true); }
}
stageEl.addEventListener('pointerup', endDrag);
stageEl.addEventListener('pointercancel', endDrag);

const controls = new OrbitControls(camera, stageEl);
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.55;               // 빈 곳을 조금 끌어도 확 돌아가지 않게
controls.minDistance = 7; controls.maxDistance = 34;
controls.minPolarAngle = 0; controls.maxPolarAngle = 62 * DEG; // 옆에서 보는 시점(라벨이 한 줄로 몰림)은 막음
controls.target.copy(VIEW_TARGET);
controls.addEventListener('start', hideHint);
controls.addEventListener('change', () => { needsRender = true; });

let camTween = null;
// 위치 라벨·태양·햇빛 화살표가 모두 화면 안에 들어오는 가장 가까운 거리를 찾음(화면비가 달라도 궤도를 최대한 크게)
// [점, 가로 여백 px, 위 여백 px, 아래 여백 px] — 라벨은 글자 크기만큼, 위쪽은 왼쪽 위 안내 글 자리만큼 더 비움
const FIT_PTS = [];
for (let i = 0; i < 8; i++) FIT_PTS.push([posOf(i * 45, labelR(i)), 44, -1, 22]); // 위 여백 -1: 왼쪽 위 제목 글 아래면 44, 아니면 22
for (let i = 0; i < 16; i++) FIT_PTS.push([posOf(i * 22.5 + 11.25, R_ORBIT + 0.6), 10, 30, 10]);
FIT_PTS.push([new THREE.Vector3(SUN_X + SUN_R + 0.2, 0, 0), 6, 30, 6], [new THREE.Vector3(SUN_X, 0, SUN_R + 0.9), 24, 30, 16],
  [new THREE.Vector3(SUN_X, 0, -SUN_R - 0.2), 6, 30, 6], [new THREE.Vector3(7.6, 0, -4.3), 24, 44, 12]);
const fitCam = new THREE.PerspectiveCamera();
function fitDistance(top = false) {
  const r = stageEl.getBoundingClientRect(), W = Math.max(1, r.width), H = Math.max(1, r.height);
  const tagR = document.querySelector('.stage-tag').getBoundingClientRect().right - r.left + 46;
  // 오른쪽 위 시작 안내 자리(사라진 뒤에도 자리는 그대로 비워 둠 → 카메라 거리가 바뀌지 않음)
  // '지구 그림자' 안내 글도 같은 자리에 뜨므로 둘 중 큰 쪽만큼 비움(숨겨져 있어도 잠깐 보이지 않게 펼쳐 잼)
  const hr = hintEl.getBoundingClientRect();
  const sn = document.getElementById('shadowNote'), wasHidden = sn.hidden;
  if (wasHidden) { sn.style.visibility = 'hidden'; sn.hidden = false; }
  const sr = sn.getBoundingClientRect();
  if (wasHidden) { sn.hidden = true; sn.style.visibility = ''; }
  const hintL = Math.min(hr.left, sr.left) - r.left - 6, hintB = Math.max(hr.bottom, sr.bottom) - r.top + 4;
  fitCam.copy(camera); fitCam.aspect = Math.max(0.3, W / H); fitCam.updateProjectionMatrix();
  const tilt = top ? 0.02 : homeTilt();
  const dir = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
  const v = new THREE.Vector3();
  const fits = d => {
    fitCam.position.copy(VIEW_TARGET).addScaledVector(dir, d); fitCam.lookAt(VIEW_TARGET); fitCam.updateMatrixWorld();
    return FIT_PTS.every(([p, mx, mt, mb]) => {
      v.copy(p).project(fitCam);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      const t = mt >= 0 ? mt : (x < tagR ? 44 : 22);
      if (x + mx > hintL && y < hintB + (mx >= 24 ? 20 : 4)) return false;
      return x > mx && x < W - mx && y > t && y < H - mb;
    });
  };
  let lo = 6, hi = 80;
  for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
  return hi;
}
// 연직에서 기울인 각: 가로로 아주 넓은 무대(태블릿 세로 화면)는 조금 더 눕혀 궤도를 크게
function homeTilt() { const r = stageEl.getBoundingClientRect(); return (r.width / Math.max(1, r.height) > 2 ? 50 : 40) * DEG; }
function camHome(top) {
  const d = fitDistance(top);
  const tilt = top ? 0.02 : homeTilt();
  return new THREE.Vector3(VIEW_TARGET.x, VIEW_TARGET.y + d * Math.cos(tilt), VIEW_TARGET.z + d * Math.sin(tilt));
}
let camIsTop = false;
function flyCamera(top) {
  camIsTop = top;
  camTween = { from: camera.position.clone(), to: camHome(top), fromT: controls.target.clone(), t: 0, dur: 0.9 };
}

/* ───────── 크기 맞춤 ───────── */
let lastViewTheta = null;
function resize() {
  const r = stageEl.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  labelRenderer.setSize(r.width, r.height);
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  const v = moonViewEl.getBoundingClientRect();
  const pr = S.quality === 'high' ? Math.min(devicePixelRatio || 1, 2) : 1;
  mvCanvas.width = Math.max(1, Math.round(v.width * pr)); mvCanvas.height = Math.max(1, Math.round(v.height * pr));
  prepMoonView();
  lastViewTheta = null; // 크기를 바꾸면 캔버스가 지워지므로 다시 그림
  needsRender = true;
  layoutStrip();
}
new ResizeObserver(() => resize()).observe(stageEl);
new ResizeObserver(() => resize()).observe(moonViewEl);

/* ───────── 위상 그림 (2D: 카드·위상 띠·피드백용) ───────── */
function drawPhase(cv, deg, { bg = null } = {}) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const css = cv.clientWidth || +cv.dataset.size || 40;
  cv.width = cv.height = Math.round(css * dpr);
  const g = cv.getContext('2d'); const s = cv.width, r = s * 0.42, c = s / 2;
  g.clearRect(0, 0, s, s);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, s, s); }
  g.fillStyle = '#272c3c'; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  const t = norm(deg) * DEG;
  const waxT = t > Math.PI ? 2 * Math.PI - t : t;
  const k = Math.cos(waxT);
  if (k < 0.999) {
    g.save(); g.translate(c, c); if (t > Math.PI) g.scale(-1, 1);
    g.beginPath(); g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    if (k >= 0) g.ellipse(0, 0, r * k, r, 0, Math.PI / 2, -Math.PI / 2, true);
    else g.ellipse(0, 0, -r * k, r, 0, Math.PI / 2, Math.PI * 1.5, false);
    const gr = g.createRadialGradient(r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
    gr.addColorStop(0, '#fffbe8'); gr.addColorStop(1, '#e8dcae');
    g.fillStyle = gr; g.fill(); g.restore();
  }
  g.strokeStyle = 'rgba(150,165,210,.45)'; g.lineWidth = Math.max(1, s * 0.02);
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
}
function phaseCanvas(deg, size) {
  const cv = document.createElement('canvas'); cv.dataset.size = size;
  cv.style.width = cv.style.height = size + 'px';
  drawPhase(cv, deg); return cv;
}

/* ───────── 위상 띠 ───────── */
const stripEl = document.getElementById('strip');
const stripCursor = document.getElementById('stripCursor');
const stripSlots = [];
for (let i = 0; i <= 8; i++) {
  const d = document.createElement('div'); d.className = 'strip-slot';
  const cv = document.createElement('canvas'); cv.dataset.size = 36;
  const day = i === 8 ? LUNAR_MONTH : Math.round(i * 45 / 360 * LUNAR_MONTH * 10) / 10;
  const t = document.createElement('div'); t.className = 't';
  t.dataset.full = i === 8 ? `다시 삭\n${day}일` : `${NAMES[i] || `(${POS[i]})`}\n${day}일`;
  t.dataset.empty = `\n${day}일`;
  t.textContent = t.dataset.empty;
  d.append(cv, t); stripEl.appendChild(d); stripSlots.push({ el: d, cv, t, got: false });
}
function layoutStrip() {
  stripSlots.forEach((s, i) => { s.el.style.left = (i / 8 * 100) + '%'; });
}
// 붙임딱지 8칸을 다 붙이기 전에는 위상 띠에 모양과 날짜만 보이고 이름은 가림(띠를 보고 베끼지 않게)
const stripNamesOn = () => S.cardsPlaced >= 8;
function markStrip(i) {
  const s = stripSlots[i]; if (s.got) return;
  s.got = true; s.el.classList.add('got', 'pop'); drawPhase(s.cv, (i % 8) * 45);
  s.t.textContent = stripNamesOn() ? s.t.dataset.full : s.t.dataset.empty;
}
function refreshStripNames() {
  stripSlots.forEach(s => { if (s.got) s.t.textContent = stripNamesOn() ? s.t.dataset.full : s.t.dataset.empty; });
}
function clearStrip() {
  stripSlots.forEach(s => { s.got = false; s.el.classList.remove('got', 'pop'); s.t.textContent = s.t.dataset.empty; const g = s.cv.getContext('2d'); g.clearRect(0, 0, s.cv.width, s.cv.height); });
}

/* ───────── 달 옮기기 ───────── */
const posBtns = [...document.querySelectorAll('.pos-btns button')];
function moveTo(deg, { fast = false } = {}) {
  const delta = angDiff(S.theta, deg);
  if (Math.abs(delta) < 0.01) { S.theta = deg; placed(); pushState(true); return; }
  S.tween = { from: S.theta, delta, t: 0, dur: fast ? 0.18 : clamp(0.35 + Math.abs(delta) / 180 * 0.9, 0.35, 1.25) };
}
posBtns.forEach(b => b.addEventListener('click', () => {
  if (isLocked()) return;
  if (S.playing) setPlaying(false);
  sfx.toggle(); hideHint(); moveTo(+b.dataset.pos * 45);
}));

// 달이 표시점에 놓였을 때(끌어 놓기·단추·키보드)
function placed() {
  const i = nearestIdx(S.theta);
  const off = Math.abs(angDiff(S.theta, i * 45));
  if (off >= 0.01) {
    // 과제 중에는 화면에 '근처'로 나오는 자리(±10°)에 놓아도 그 표시점에 붙여서 확인함
    if (S.activeTask && off <= NEAR_DEG && !S.playing && !S.dragging) moveTo(i * 45, { fast: true });
    return;
  }
  arriveAt(i, true);
  if (S.activeTask) checkTask(i);
}
function arriveAt(i, settled) {
  const first = !S.visited.has(POS[i]);
  S.visited.add(POS[i]); markStrip(i);
  posBtns[i].classList.add('seen');
  if (settled) { if (i === 0 || i === 4) sfx.bell(); else sfx.snap(); }
  else if (i === 0 || i === 4) sfx.bell(); else sfx.pass();
  flashMarker(i);
  if (first && S.visited.size === 8) toastMsg('8곳을 모두 돌아봤어요! 위상 띠의 순서를 살펴보세요.');
  else if (first && S.visited.size >= 3) recheckPrediction();
}
let flashT = new Array(8).fill(0);
function flashMarker(i) { flashT[i] = 1; }

/* ───────── 재생 ───────── */
const btnPlay = document.getElementById('btnPlay');
let sweep = null;
function setPlaying(p) {
  if (p === S.playing) return;
  S.playing = p; S.tween = null;
  btnPlay.setAttribute('aria-pressed', p);
  btnPlay.textContent = p ? '❚❚ 멈춤' : '▶ 공전';
  if (p) { sfx.start(); hideHint(); } else { sfx.stop(); placed(); pushState(true); }
}
btnPlay.addEventListener('click', () => { if (!isLocked()) setPlaying(!S.playing); });
const speedEl = document.getElementById('speed'), speedOut = document.getElementById('speedOut');
function setSpeed(v) { S.speed = v; speedOut.textContent = v.toFixed(1) + '배'; paintRange(speedEl); }
speedEl.addEventListener('input', () => {
  if (isLocked()) { speedEl.value = S.speed; paintRange(speedEl); return; }
  setSpeed(+speedEl.value); sound.tick((S.speed - 0.5) / 3.5);
});

// 키보드: 무대에서 ←/→ (Shift = 1°)
stageEl.addEventListener('keydown', e => {
  if (isLocked()) return;
  const step = e.shiftKey ? 1 : 5;
  let d = 0;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
  if (!d) return;
  e.preventDefault(); if (S.playing) setPlaying(false); S.tween = null; hideHint();
  S.theta = norm(Math.round(S.theta) + d); sound.tick(S.theta / 360);
  // 키를 떼고 잠시 멈추면 그 자리에 놓은 것으로 봄(지나가는 위치는 과제 시도로 세지 않음)
  clearTimeout(keySettle); keySettle = setTimeout(() => { placed(); pushState(true); }, 450);
  pushState(false);
});
let keySettle;

document.getElementById('btnTop').addEventListener('click', () => { sfx.toggle(); hideHint(); flyCamera(true); });

/* ───────── 보기 설정 ───────── */
const tLit = document.getElementById('tLit'), tSeen = document.getElementById('tSeen'), tShadow = document.getElementById('tShadow');
function applyToggles() {
  S.showLitHalf = tLit.checked; S.showSeenHalf = tSeen.checked; S.showShadow = tShadow.checked;
  litRing.visible = earthLitRing.visible = S.showLitHalf;
  seenRing.visible = sight.visible = S.showSeenHalf;
  shadow.visible = shadowLabel.visible = S.showShadow;
  document.getElementById('shadowNote').hidden = !S.showShadow;
  needsRender = true;
}
[tLit, tSeen, tShadow].forEach(t => t.addEventListener('change', () => {
  if (isLocked()) { t.checked = !t.checked; return; } // 잠긴 뒤에는 키보드로도 못 바꿈
  sfx.toggle(); hideHint(); applyToggles(); pushState(true);
  if (t === tShadow && t.checked) recheckPrediction();
}));

/* ───────── 과제 ───────── */
const taskFullBtn = document.getElementById('taskFull'), taskFQBtn = document.getElementById('taskFQ'), taskMsg = document.getElementById('taskMsg');
const TASKS = {
  full: { btn: taskFullBtn, idx: 4, key: 'taskFull', firstKey: 'taskFullFirstTry', ask: '보름달이 되도록 달을 옮겨 보세요. (끌기, 위치 단추)', ok: '보름달 완성! 태양·지구·달이 어떻게 놓였는지 위에서 보세요.' },
  fq: { btn: taskFQBtn, idx: 2, key: 'taskFirstQuarter', firstKey: 'taskFirstQuarterFirstTry', ask: '오른쪽이 둥근 반달(상현달)이 되도록 달을 옮겨 보세요.', ok: '상현달 완성! 지구에서 볼 때 태양과 달이 직각 방향이에요.' },
};
function setTask(name) {
  S.activeTask = S.activeTask === name ? null : name;
  for (const [k, t] of Object.entries(TASKS)) t.btn.setAttribute('aria-pressed', S.activeTask === k && !S[t.key]);
  taskMsg.style.color = ''; taskMsg.textContent = S.activeTask ? TASKS[S.activeTask].ask : '';
  // 과제를 고를 때 달이 이미 표시점에 멈춰 있으면 그 자리를 바로 확인함(이미 알맞은 자리면 바로 완성)
  // 화면에 '근처'로 나오는 자리(±10°)면 그 표시점에 붙여서 확인
  if (S.activeTask && !S.playing && !S.tween && !S.dragging) {
    const i = nearestIdx(S.theta), off = Math.abs(angDiff(S.theta, i * 45));
    if (i === TASKS[S.activeTask].idx) {
      if (off < 0.01) { checkTask(i); pushState(true); }
      else if (off <= NEAR_DEG) moveTo(i * 45, { fast: true });
    }
  }
}
function checkTask(i) {
  const t = TASKS[S.activeTask]; if (!t) return;
  if (!S[t.firstKey]) S[t.firstKey] = POS[i];
  if (i === t.idx && !S[t.key]) {
    S[t.key] = true; t.btn.classList.add('done'); t.btn.querySelector('.chk').textContent = '✓';
    t.btn.setAttribute('aria-pressed', 'false'); S.activeTask = null;
    taskMsg.style.color = 'var(--good)'; taskMsg.textContent = t.ok; setTimeout(() => sfx.right(), 350);
  } else if (i !== t.idx) {
    taskMsg.style.color = ''; taskMsg.textContent = `(${POS[i]})에서는 다른 모양이에요. '지구에서 본 달' 창을 보며 다시 옮겨 보세요.`;
  }
}
taskFullBtn.addEventListener('click', () => { if (isLocked()) return; sfx.toggle(); hideHint(); setTask('full'); });
taskFQBtn.addEventListener('click', () => { if (isLocked()) return; sfx.toggle(); hideHint(); setTask('fq'); });

/* ───────── 붙임딱지 ───────── */
// 위상 카드 8장 + 좌우가 바뀐 반달 카드 2장(서로 짝이 바뀐 모양)
const slotsEl = document.getElementById('slots'), cardsEl = document.getElementById('cards'), fbEl = document.getElementById('feedback');
const ghost = document.getElementById('ghost');
let slots = [], cards = [], selected = null;
function buildBoard() {
  slotsEl.innerHTML = ''; cardsEl.innerHTML = ''; slots = []; cards = []; selected = null;
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('div'); s.className = 'slot'; s.tabIndex = 0; s.dataset.idx = i;
    s.setAttribute('role', 'button'); s.setAttribute('aria-label', `${posLabel(i)} 칸`);
    s.innerHTML = `<div class="nm">(${POS[i]}) ${NAMES[i] ? `<small>${NAMES[i].replace('(', '<br>(')}</small>` : ''}</div><div class="hole"></div>`;
    s.addEventListener('click', () => { if (selected && !isLocked()) tryPlace(selected, i); });
    s.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && selected && !isLocked()) { e.preventDefault(); tryPlace(selected, i); } });
    slotsEl.appendChild(s); slots.push({ el: s, filled: false });
  }
  const angles = [0, 45, 90, 135, 180, 225, 270, 315, 90, 270];
  for (let k = angles.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [angles[k], angles[j]] = [angles[j], angles[k]]; }
  angles.forEach((a, n) => {
    const cell = document.createElement('div'); cell.className = 'card-cell';
    const c = document.createElement('div'); c.className = 'card'; c.tabIndex = 0; c.setAttribute('role', 'button');
    c.setAttribute('aria-label', `달 모양 카드 ${n + 1}`); c.setAttribute('aria-pressed', 'false');
    c.appendChild(phaseCanvas(a, 40));
    const card = { el: c, cell, deg: a, used: false };
    c.addEventListener('pointerdown', e => startCardDrag(e, card));
    c.addEventListener('animationend', () => c.classList.remove('return-anim'));
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCard(card); } });
    cell.appendChild(c); cardsEl.appendChild(cell); cards.push(card);
  });
}
function selectCard(card) {
  if (isLocked() || card.used) return;
  selected = selected === card ? null : card;
  cards.forEach(c => { c.el.classList.toggle('sel', c === selected); c.el.setAttribute('aria-pressed', c === selected); });
  slots.forEach(s => s.el.classList.toggle('target', !!selected && !s.filled));
  if (selected) sfx.pick();
}
let cd = null;
function startCardDrag(e, card) {
  if (isLocked() || card.used || e.button > 0) return;
  e.preventDefault();
  cd = { card, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, over: null };
  card.el.setPointerCapture(e.pointerId);
}
function slotAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const s = el && el.closest('.slot'); return s ? +s.dataset.idx : null;
}
window.addEventListener('pointermove', e => {
  if (!cd || e.pointerId !== cd.id) return;
  if (!cd.moved && Math.hypot(e.clientX - cd.x0, e.clientY - cd.y0) > 6) {
    cd.moved = true; ghost.innerHTML = ''; ghost.appendChild(phaseCanvas(cd.card.deg, 44)); ghost.hidden = false;
    cd.card.el.classList.add('lifted'); sfx.pick();
  }
  if (cd.moved) {
    ghost.style.transform = `translate(${e.clientX - 26}px, ${e.clientY - 26}px)`;
    const i = slotAt(e.clientX, e.clientY);
    if (i !== cd.over) { if (cd.over !== null) slots[cd.over].el.classList.remove('over'); cd.over = i; if (i !== null && !slots[i].filled) slots[i].el.classList.add('over'); }
  }
});
function endCardDrag(e) {
  if (!cd || e.pointerId !== cd.id) return;
  const { card, moved, over } = cd; cd = null;
  ghost.hidden = true; card.el.classList.remove('lifted');
  slots.forEach(s => s.el.classList.remove('over'));
  if (!moved) { selectCard(card); return; }
  if (over !== null && !isLocked()) tryPlace(card, over);
  else { card.el.classList.remove('return-anim'); void card.el.offsetWidth; card.el.classList.add('return-anim'); }
}
window.addEventListener('pointerup', endCardDrag);
window.addEventListener('pointercancel', endCardDrag);

function tryPlace(card, i) {
  const slot = slots[i];
  if (slot.filled || card.used) return;
  selected = null; cards.forEach(c => { c.el.classList.remove('sel'); c.el.setAttribute('aria-pressed', 'false'); }); slots.forEach(s => s.el.classList.remove('target'));
  const actual = i * 45; // 그 위치에서 지구에서 본 달의 모양
  if (card.deg === actual) {
    card.used = true; slot.filled = true; S.cardsPlaced++;
    card.el.classList.remove('return-anim'); slot.el.querySelector('.hole').appendChild(card.el);
    slot.el.classList.add('filled'); slot.el.removeAttribute('role'); slot.el.tabIndex = -1;
    card.el.tabIndex = -1;
    fbEl.className = 'feedback ok';
    fbEl.innerHTML = `<span><b>${posLabel(i)}</b> 칸에 붙였어요. (${S.cardsPlaced}/8)</span>`;
    sfx.right();
    if (S.cardsPlaced === 8) {
      refreshStripNames();
      setTimeout(() => { sfx.done(); fbEl.innerHTML = '<span><b>8칸 모두 완성!</b> 달이 시계 반대 방향으로 돌며 모양이 차례로 바뀌어요. 남은 카드 2장은 이미 붙인 반달과 같은 모양이라 붙일 칸이 없어요.</span>'; }, 450);
      setTimeout(() => openPrediction(true), 1800);
    }
  } else {
    S.cardMistakes++;
    const mirror = (i === 2 && card.deg === 270) || (i === 6 && card.deg === 90);
    if (mirror) S.mirrorMistake = true;
    slot.el.classList.remove('bad'); void slot.el.offsetWidth; slot.el.classList.add('bad');
    setTimeout(() => slot.el.classList.remove('bad'), 450);
    card.el.classList.remove('return-anim'); void card.el.offsetWidth; card.el.classList.add('return-anim');
    sfx.wrong();
    fbEl.className = 'feedback no'; fbEl.innerHTML = '';
    const pair = document.createElement('div'); pair.className = 'pair';
    const f1 = document.createElement('figure'); f1.append(phaseCanvas(card.deg, 30), '고른 카드');
    const f2 = document.createElement('figure'); f2.append(phaseCanvas(actual, 30), `(${POS[i]})의 달`);
    pair.append(f1, f2);
    const msg = document.createElement('span');
    msg.innerHTML = mirror
      ? `좌우가 바뀌었어요. 달은 <b>태양이 있는 쪽</b>이 밝아요. (${POS[i]})에서 태양은 달의 ${i === 2 ? '오른쪽(서쪽 하늘 쪽)' : '왼쪽(동쪽 하늘 쪽)'}에 있어요.`
      : `(${POS[i]})에 달을 놓고 '지구에서 본 달' 창과 비교해 보세요.`;
    fbEl.append(pair, msg);
  }
  pushState(true);
}

/* ───────── 예측 ───────── */
const predModal = document.getElementById('predModal');
const PRED_TEXT = { '그림자': '①', '방향': '②', '거리': '③' };
// 실험 도중 처음 예측을 한 번 되물음(맞고 틀림은 알려 주지 않고, 고른 생각을 직접 확인할 거리만 줌)
const RECHECK = {
  '그림자': '처음 예측 ① — 지구 그림자를 켜고 (나)·(다)를 보세요. 그림자가 달에 닿나요?',
  '방향': '처음 예측 ② — 노란·파란 반쪽을 켜고, 겹치는 부분을 달 모양과 견주어 보세요.',
  '거리': '처음 예측 ③ — 지구와 달 사이 거리가 크게 바뀌지 않아도 모양은 바뀌나요?',
};
let recheckDone = false;
function recheckPrediction() {
  if (recheckDone || !S.prediction || S.cardsPlaced >= 8 || isLocked()) return;
  recheckDone = true;
  setTimeout(() => toastMsg(RECHECK[S.prediction], 12000, 'var(--ink)'), 700);
}
let predAfterMode = false;
function openPrediction(after) {
  if (isLocked()) return;
  predAfterMode = after;
  document.getElementById('predTitle').textContent = after ? '다시 생각해 보세요' : '먼저 예측해 보세요';
  document.getElementById('predText').textContent = after
    ? '시뮬레이터에서 관찰한 것을 떠올려 보세요. 달 모양이 바뀌는 까닭은 무엇일까요?'
    : '달은 날마다 모양이 조금씩 바뀌어 보여요. 달 모양이 바뀌는 까닭은 무엇일까요?';
  document.getElementById('predFoot').textContent = after
    ? '고르고 나서도 계속 실험할 수 있어요. 언제든 \'다시 생각해 보기\'로 바꿀 수 있어요.'
    : '고르면 바로 시작해요. 맞는지는 실험하며 직접 확인해 보세요.';
  const cur = after ? S.predictionAfter : S.prediction;
  predModal.querySelectorAll('[data-pred]').forEach(b => b.classList.toggle('chosen', b.dataset.pred === cur));
  predModal.hidden = false;
  predModal.querySelector('.modal-box').focus();
}
predModal.querySelectorAll('[data-pred]').forEach(b => b.addEventListener('click', () => {
  if (isLocked()) return;
  if (predAfterMode) S.predictionAfter = b.dataset.pred; else S.prediction = b.dataset.pred;
  predModal.hidden = true; sfx.right(); pushState(true);
  if (!predAfterMode) { stageEl.focus({ preventScroll: true }); if (hintShown) showHint(); }
  else if (S.prediction) {
    // 처음 생각과 지금 생각을 나란히 보여 줌(맞고 틀림은 알려 주지 않음)
    const same = S.prediction === S.predictionAfter;
    toastMsg(`처음 생각 ${PRED_TEXT[S.prediction]} → 지금 생각 ${PRED_TEXT[S.predictionAfter]} · ${same ? '어떤 관찰이 근거인가요?' : '무엇을 보고 바뀌었나요?'}`, 9000, ''); // 맞고 틀림을 뜻하지 않게 기본 색
  }
}));
document.getElementById('btnRethink').addEventListener('click', () => { sfx.toggle(); openPrediction(true); });

/* ───────── 알림 ───────── */
let toastTimer;
function toastMsg(t, ms = 4000, color = 'var(--good)') {
  taskMsg.style.color = color; taskMsg.textContent = t;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { if (taskMsg.textContent === t) taskMsg.textContent = ''; }, ms);
}

/* ───────── 머리줄 단추 ───────── */
const btnMute = document.getElementById('btnMute');
function showMute() { btnMute.textContent = sound.muted ? '🔇 소리 끔' : '🔊 소리 켬'; btnMute.setAttribute('aria-pressed', sound.muted); }
btnMute.addEventListener('click', () => { sound.toggleMute(); showMute(); sfx.toggle(); });
showMute();

const btnQuality = document.getElementById('btnQuality');
function setQuality(q) {
  S.quality = q;
  btnQuality.textContent = q === 'high' ? '그래픽: 높음' : '그래픽: 낮음';
  btnQuality.setAttribute('aria-pressed', q === 'low');
  const hi = q === 'high';
  // 낮음: 안티에일리어싱 끔(렌더러 새로 만듦) · 화소 비율 1 · 구 분할 줄임 · 별 줄임 · 빛무리 끔
  if (renderer.getContextAttributes()?.antialias !== hi) makeRenderer(hi);
  renderer.setPixelRatio(hi ? Math.min(devicePixelRatio, 1.5) : 1); // 고해상도 화면도 1.5배까지만(안티에일리어싱이 켜져 있으므로)
  setSegments(hi);
  makeStars(hi ? 1800 : 500);
  sunGlow.visible = hi;
  rayMat.opacity = 0.5;
  resize();
}
function setSegments(hi) {
  const swap = (mesh, r, w, h) => { mesh.geometry.dispose(); mesh.geometry = new THREE.SphereGeometry(r, w, h); };
  swap(earth, EARTH_R, hi ? 48 : 24, hi ? 32 : 16);
  swap(moon, MOON_R, hi ? 48 : 28, hi ? 32 : 18);
  swap(sunBall, SUN_R, hi ? 32 : 16, hi ? 20 : 10);
}
btnQuality.addEventListener('click', () => { sfx.toggle(); setQuality(S.quality === 'high' ? 'low' : 'high'); });

document.getElementById('btnReset').addEventListener('click', () => { if (isLocked()) return; sound.reset(); resetAll(); });
function resetAll() {
  setPlaying(false);
  Object.assign(S, {
    theta: 30, tween: null, visited: new Set(), lapDone: false, cardsPlaced: 0, cardMistakes: 0, mirrorMistake: false,
    taskFull: false, taskFirstQuarter: false, activeTask: null, taskFullFirstTry: '', taskFirstQuarterFirstTry: '',
    predictionAfter: '', // 처음 예측은 남기고, 끝 예측은 다시 받음
  });
  recheckDone = false;
  tLit.checked = tSeen.checked = tShadow.checked = false; applyToggles();
  speedEl.value = 1; setSpeed(1);
  posBtns.forEach(b => b.classList.remove('seen'));
  for (const t of Object.values(TASKS)) { t.btn.classList.remove('done'); t.btn.querySelector('.chk').textContent = '○'; t.btn.setAttribute('aria-pressed', 'false'); }
  taskMsg.textContent = ''; fbEl.className = 'feedback'; fbEl.innerHTML = '';
  clearStrip(); buildBoard(); flyCamera(false); showHint();
  needsRender = true; lastShown = '';
  pushState(true);
}

/* ───────── 화면 값 · SimBridge ───────── */
const vPos = document.getElementById('vPos'), vAngle = document.getElementById('vAngle'), vDays = document.getElementById('vDays'), vLit = document.getElementById('vLit'), mLit = document.getElementById('mLit');
let lastShown = '', lastSent = 0, pendingSend = false;
function readout() {
  const th = norm(S.theta), deg = Math.round(th) % 360, i = nearestIdx(th);
  const key = deg + '|' + i + '|' + Math.round(th * 2);
  if (key === lastShown) return false;
  lastShown = key;
  vPos.textContent = posText(th);
  vAngle.textContent = deg + '°';
  vDays.textContent = deg === 0 ? '0일 (삭)' : '약 ' + daysAfterNew(deg).toFixed(1) + '일';
  const lp = litPercent(deg);
  vLit.textContent = lp + ' %'; mLit.style.width = lp + '%';
  posBtns.forEach((b, k) => b.classList.toggle('cur', k === i));
  markerLabels.forEach((l, k) => l.element.classList.toggle('on', k === i));
  stripCursor.style.left = (th / 360 * 100) + '%';
  return true;
}
function pushState(force) {
  const now = performance.now();
  if (!force && now - lastSent < 200) { pendingSend = true; return; }
  lastSent = now; pendingSend = false;
  const deg = Math.round(norm(S.theta)) % 360, i = nearestIdx(deg);
  SimBridge.setState({
    angleDeg: deg,
    position: POS[i],
    phaseName: NAMES[i],
    positionShown: posText(S.theta), // 화면 '위치' 칸과 같은 글(표시점/근처 ±10°/사이)
    litPercent: litPercent(deg),
    daysAfterNew: daysAfterNew(deg),
    visited: POS.filter(p => S.visited.has(p)).join(','),
    cardsPlaced: S.cardsPlaced,
    cardMistakes: S.cardMistakes,
    mirrorMistake: S.mirrorMistake,
    prediction: S.prediction,
    predictionAfter: S.predictionAfter,
    taskFull: S.taskFull,
    taskFirstQuarter: S.taskFirstQuarter,
    taskFullFirstTry: S.taskFullFirstTry,
    taskFirstQuarterFirstTry: S.taskFirstQuarterFirstTry,
    showLitHalf: S.showLitHalf,
    showSeenHalf: S.showSeenHalf,
    showShadow: S.showShadow,
  });
}
let lockApplied = false, lockedEls = [];
function applyLock() {
  if (lockApplied) return; lockApplied = true;
  setPlaying(false); S.tween = null; predModal.hidden = true;
  if (cd) { cd = null; ghost.hidden = true; } S.dragging = false; selected = null;
  // 키보드(Tab·Space)로도 못 바꾸게 조작 요소를 모두 끔(소리·그래픽 품질은 그대로 둠)
  lockedEls = [...document.querySelectorAll('.app button, .app input, .modal button, #btnReset')].filter(el => !el.disabled);
  lockedEls.forEach(el => { el.disabled = true; });
  document.querySelectorAll('.card, .slot').forEach(el => { el.tabIndex = -1; });
}
// 잠금이 풀리면(클래스가 빠지고 웹앱 잠금도 아닐 때) 끈 요소를 되살림
function releaseLock() {
  if (!lockApplied || isLocked()) return; lockApplied = false;
  lockedEls.forEach(el => { el.disabled = false; }); lockedEls = [];
  cards.forEach(c => { if (!c.used) c.el.tabIndex = 0; });
  slots.forEach(s => { if (!s.filled) s.el.tabIndex = 0; });
}
SimBridge.onLock = applyLock;
new MutationObserver(() => { if (isLocked()) applyLock(); else releaseLock(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

/* ───────── 매 프레임 ───────── */
const clock = new THREE.Clock();
const fps = new FpsMonitor(() => {
  if (S.quality !== 'high') return;
  setQuality('low');
  toastMsg('화면이 느려서 그래픽을 \'낮음\'으로 바꿨어요. 오른쪽 위 단추로 다시 높일 수 있어요.', 8000, 'var(--ink)');
}, { threshold: 28, window: 4 });
let frame = 0, lastRenderTheta = null;
const tmp = new THREE.Vector3();

// '지구에서 본 달': 지구 중심에서 달 쪽을 본 모습(북쪽이 위)을 화소마다 빛 계산으로 그림.
// 화면 오른쪽 방향 r=(sinθ,0,cosθ), 위 u=(0,1,0), 시선 f=(cosθ,0,−sinθ)일 때 표면 법선 n=r·x+u·y−f·μ, 햇빛 L=(1,0,0)
// → 빛 받는 정도 s = n·L = x·sinθ − μ·cosθ. 모양(위상)은 그리는 사람이 정하는 것이 아니라 이 계산의 결과.
// (WebGL 화면을 하나 더 쓰거나 읽어 오면 저사양 크롬북에서 느려서, 같은 계산을 2D 캔버스에서 직접 함)
const MV_R = 0.355; // 창 지름에 대한 달 반지름 비율(점선 원과 같음)
let mvBg = null, mvAlb = null, mvImg = null;
function prepMoonView() {
  const w = mvCanvas.width, h = mvCanvas.height;
  mvImg = mvCtx.createImageData(w, h);
  // 배경: 밤하늘 + 희미한 별 몇 개
  mvBg = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) { mvBg[k * 4] = 2; mvBg[k * 4 + 1] = 4; mvBg[k * 4 + 2] = 12; mvBg[k * 4 + 3] = 255; }
  for (let n = 0; n < 26; n++) {
    const x = Math.floor(hash3(n, 3, 1) * w), y = Math.floor(hash3(n, 7, 2) * h), b = 90 + hash3(n, 1, 9) * 140;
    const k = (y * w + x) * 4; mvBg[k] = mvBg[k + 1] = b; mvBg[k + 2] = Math.min(255, b + 20);
  }
  // 달 표면 무늬(조석 고정이라 지구에서 늘 같은 면이 보임 → 한 번만 계산)
  const R = w * MV_R, c = w / 2, tw = moonTexImg.width, th = moonTexImg.height, td = moonTexImg.data;
  mvAlb = new Float32Array(w * h).fill(-1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = (i + 0.5 - c) / R, y = -(j + 0.5 - c) / R, rr = x * x + y * y;
    if (rr > 1.04) continue;
    const mu = Math.sqrt(Math.max(0, 1 - rr));
    // 달 자체 좌표의 법선 (−μ, y, x) → 구 텍스처 좌표(three.js SphereGeometry 방식)
    const lx = -mu, ly = Math.max(-1, Math.min(1, y)), lz = x;
    let phi = Math.atan2(lz, -lx); if (phi < 0) phi += Math.PI * 2;
    const tu = Math.min(tw - 1, Math.floor(phi / (Math.PI * 2) * tw)), tv = Math.min(th - 1, Math.floor((0.5 - Math.asin(ly) / Math.PI) * th));
    mvAlb[j * w + i] = td[(tv * tw + tu) * 4] / 255;
  }
}
function drawMoonView(thetaDeg) {
  if (!mvImg) return;
  const w = mvCanvas.width, h = mvCanvas.height, R = w * MV_R, c = w / 2;
  const st = Math.sin(thetaDeg * DEG), ct = Math.cos(thetaDeg * DEG);
  const d = mvImg.data; d.set(mvBg);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = mvAlb[j * w + i]; if (a < 0) continue;
    const x = (i + 0.5 - c) / R, y = -(j + 0.5 - c) / R, rr = x * x + y * y;
    const cov = Math.max(0, Math.min(1, (1 - Math.sqrt(rr)) * R + 0.5)); // 가장자리 부드럽게
    if (cov <= 0) continue;
    const mu = Math.sqrt(Math.max(0, 1 - rr));
    const s = Math.max(0, x * st - mu * ct);
    // 람베르트 + 로멜-젤리거(실제 달처럼 가장자리까지 고르게 밝음) 섞음, 어두운 쪽은 아주 희미하게
    const b = a * (0.6 * s + 1.1 * (s / (s + mu + 1e-4)) + 0.05);
    const k = (j * w + i) * 4;
    const r = Math.min(255, b * 300), g = Math.min(255, b * 294), bl = Math.min(255, b * 280);
    d[k] = d[k] + (r - d[k]) * cov; d[k + 1] = d[k + 1] + (g - d[k + 1]) * cov; d[k + 2] = d[k + 2] + (bl - d[k + 2]) * cov;
  }
  mvCtx.putImageData(mvImg, 0, 0);
}

// 달이 위치 라벨 가까이 오면(특히 비스듬한 시점의 먼 쪽) 라벨을 달 반대쪽으로 살짝 밀어 겹치지 않게
const scrA = new THREE.Vector3(), scrB = new THREE.Vector3(), camRight = new THREE.Vector3();
function toScreen(v, out, W, H) { out.copy(v).project(camera); out.set((out.x + 1) / 2 * W, (1 - out.y) / 2 * H, 0); return out; }
function nudgeLabels(p) {
  const W = stageEl.clientWidth, H = stageEl.clientHeight;
  camera.updateMatrixWorld();
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  const mc = toScreen(p, new THREE.Vector3(), W, H);
  const rr = toScreen(scrA.copy(p).addScaledVector(camRight, MOON_R * 2.05), scrB, W, H).distanceTo(mc); // 고리까지의 화면 반지름
  markerLabels.forEach(l => {
    const lc = toScreen(l.position, scrA, W, H);
    const dx = lc.x - mc.x, dy = lc.y - mc.y, d = Math.hypot(dx, dy) || 1;
    if (!l.half) { const w = l.inner.offsetWidth, h = l.inner.offsetHeight; if (w) l.half = [w / 2, h / 2]; }
    const [halfW, halfH] = l.half || [30, 14];
    // 라벨 상자 가장자리까지 거리(진행 방향 기준)
    const reach = Math.abs(dy / d) * halfH + Math.abs(dx / d) * halfW;
    const need = rr + reach + 3 - d;
    const push = need > 0 ? need : 0;
    if (Math.abs(push - l.push) > 0.5) { l.push = push; l.inner.style.translate = push ? `${(dx / d * push).toFixed(1)}px ${(dy / d * push).toFixed(1)}px` : ''; }
  });
}
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  frame++; fps.update(dt);
  if (S.playing && isLocked()) setPlaying(false);

  // 공전
  if (S.playing && !S.dragging) {
    const before = S.theta;
    const raw = before + 360 / LAP_SECONDS * S.speed * dt;
    // 표시점을 지날 때 기록
    const k0 = Math.floor(before / 45), k1 = Math.floor(raw / 45);
    for (let k = k0 + 1; k <= k1; k++) {
      const idx = ((k % 8) + 8) % 8;
      if (idx === 0 && k > 0) { markStrip(8); S.lapDone = true; }
      arriveAt(idx, false);
    }
    S.theta = norm(raw);
  } else if (S.tween) {
    const tw = S.tween; tw.t += dt / tw.dur;
    const e = ease.inOutCubic(Math.min(1, tw.t));
    S.theta = norm(tw.from + tw.delta * e);
    if (tw.t >= 1) { S.theta = norm(Math.round(tw.from + tw.delta)); S.tween = null; placed(); pushState(true); }
  }

  // 카메라 이동
  let dirty = needsRender || S.theta !== lastRenderTheta;
  if (camTween) {
    camTween.t += dt / camTween.dur; const e = ease.inOutCubic(Math.min(1, camTween.t));
    camera.position.lerpVectors(camTween.from, camTween.to, e);
    controls.target.lerpVectors(camTween.fromT, VIEW_TARGET, e);
    if (camTween.t >= 1) camTween = null;
    dirty = true;
  }
  if (controls.update()) dirty = true;

  // 깜박이는 표시점·달 둘레 고리가 움직이는 동안만 다시 그림
  const nearI = nearestIdx(S.theta);
  const onMarker = Math.abs(angDiff(S.theta, nearI * 45)) < 0.6 && !S.dragging;
  // 시작 안내가 떠 있는 동안 달 둘레 고리를 천천히 깜박여 '이 달을 끌 수 있어요'를 알림
  const hintPulse = hintShown && predModal.hidden && !isLocked();
  const haloTarget = S.dragging ? 0.75 : hintPulse ? 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4)) : onMarker ? 0.35 : 0;
  if (hintPulse) { moonHalo.material.opacity = haloTarget; dirty = true; }
  else if (Math.abs(haloTarget - moonHalo.material.opacity) > 0.01) {
    moonHalo.material.opacity += (haloTarget - moonHalo.material.opacity) * Math.min(1, dt * 8); dirty = true;
  }
  for (let i = 0; i < 8; i++) {
    if (flashT[i] > 0) { flashT[i] = Math.max(0, flashT[i] - dt * 1.6); dirty = true; }
  }
  if (S.playing && S.quality === 'high') rayMat.opacity = 0.4 + 0.18 * Math.sin(clock.elapsedTime * 2.2);

  if (readout()) pushState(false);
  else if (pendingSend && performance.now() - lastSent > 200) pushState(true);

  if (!dirty) return;
  // 품질 낮음도 프레임은 거르지 않음(바뀐 것이 있을 때만 그리므로 가벼운 장면은 그대로 매끄럽게)
  needsRender = false; lastRenderTheta = S.theta;

  // 달·덧그림 위치
  const p = posOf(S.theta);
  moon.position.copy(p); moonHit.position.copy(p);
  moon.rotation.y = S.theta * DEG; // 같은 면이 늘 지구를 향함
  moonHalo.position.copy(p);
  moonLabel.position.copy(p).multiplyScalar(1 - (MOON_R + 0.45) / R_ORBIT);
  litRing.position.copy(p); litRing.rotation.y = 0;
  seenRing.position.copy(p); seenRing.rotation.y = (S.theta + 180) * DEG;
  if (S.showSeenHalf) {
    tmp.copy(p).multiplyScalar(1 - (MOON_R * 1.5) / R_ORBIT);
    const pa = sightGeo.attributes.position; pa.setXYZ(0, p.x * EARTH_R * 1.2 / R_ORBIT, 0, p.z * EARTH_R * 1.2 / R_ORBIT); pa.setXYZ(1, tmp.x, 0, tmp.z); pa.needsUpdate = true;
    sight.computeLineDistances();
  }
  // 그림자 라벨은 달이 (마) 근처에 오면 '달' 라벨과 겹치므로 숨김
  shadowLabel.visible = S.showShadow && Math.abs(angDiff(S.theta, 180)) > 40;
  for (let i = 0; i < 8; i++) {
    const m = markers[i];
    m.scale.setScalar(1 + flashT[i] * 0.8 + (i === nearI ? 0.25 : 0));
    m.material.color.setHex(flashT[i] > 0 ? 0xffd45a : (i === nearI ? 0xff7a5a : 0xe0453a));
  }

  nudgeLabels(p);
  if (lastViewTheta === null || S.theta !== lastViewTheta) { drawMoonView(S.theta); lastViewTheta = S.theta; }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

/* ───────── 시작 ───────── */
buildBoard();
setSpeed(1);
setQuality('high');
applyToggles();
resize();
camera.position.copy(camHome(false));
camera.lookAt(VIEW_TARGET);
readout(); pushState(true);
tick();
openPrediction(false);
// 화면 크기가 바뀌면 카메라 거리도 다시 맞춤(사용자가 돌려 놓은 방향은 유지)
let lastFit = fitDistance(camIsTop);
new ResizeObserver(() => {
  const d = fitDistance(camIsTop); if (Math.abs(d - lastFit) < 0.3) return;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, d); lastFit = d; needsRender = true;
}).observe(stageEl);
// 개발 확인용 접근점 (정답 정보 없음)
window.__moon = {
  S, moveTo, setPlaying, setQuality, fps,
  get renderer() { return renderer; }, scene, camera, drawMoonView, labelRenderer, posOf,
  screenOf(deg) { const v = posOf(deg).project(camera), r = stageEl.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
};
