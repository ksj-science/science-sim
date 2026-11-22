// 22-2-7-2-02 달의 위상 변화 — 우주 시점(위에서 본 태양·지구·달) + 지구에서 본 달
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { sound } from '../../lib/sound.js';
import { clamp, DEG, ease, paintRange, FpsMonitor } from '../../lib/utils.js';

const UNIT = '22-2-7-2-02';
SimBridge.init(UNIT);

/* ───────── 상수 (설계서 '화면에 나오는 모든 수치') ───────── */
const R_ORBIT = 4.2;        // 지구-달 거리(화면 단위, 실제 비율 아님)
const EARTH_R = 0.95;
const MOON_R = 0.5;
const SUN_X = 10.2, SUN_R = 1.25;
const LUNAR_MONTH = 29.5;   // 삭 → 다음 삭 (일)
const LAP_SECONDS = 24;     // 1배일 때 한 바퀴 (화면 시간, 초)
const SNAP_DEG = 3;         // 끌어 놓을 때 표시점에 붙는 범위
const POS = ['가', '나', '다', '라', '마', '바', '사', '아'];
const NAMES = ['삭', '초승달', '상현달', '', '망(보름달)', '', '하현달', '그믐달'];
const posLabel = i => `(${POS[i]}) ${NAMES[i] || '(이름 없음)'}`;

const norm = d => ((d % 360) + 360) % 360;
const angDiff = (a, b) => { let d = norm(b - a); if (d > 180) d -= 360; return d; }; // a→b 최단 (−180~180]
const nearestIdx = th => Math.round(norm(th) / 45) % 8;
const litPercent = th => Math.round((1 - Math.cos(th * DEG)) / 2 * 100);
const daysAfterNew = th => Math.round(norm(th) / 360 * LUNAR_MONTH * 10) / 10;

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
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
stageEl.appendChild(renderer.domElement);
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
sun.add(new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })));
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
const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 64, 40), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }));
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
const markerMat = new THREE.MeshBasicMaterial({ color: 0xe0453a });
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), markerMat.clone());
  m.position.copy(posOf(i * 45)); scene.add(onMain(m)); markers.push(m);
  const name = NAMES[i] ? `<small>${NAMES[i]}</small>` : '';
  markerLabels.push(label(`(${POS[i]})${name}`, 'pos', posOf(i * 45, R_ORBIT + 1.2 + 0.55 * Math.max(0, Math.sin(i * 45 * DEG)) + 0.5 * Math.abs(Math.cos(i * 45 * DEG)))));
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
const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 64, 40), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
moon.material.map = sphereTexture(512, 256, moonShade);
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
const shadowLabel = label('지구 그림자', 'shadow', new THREE.Vector3(-2.9, 0, 1.3));
shadowLabel.visible = false;

/* ───────── 지구에서 본 달 (두 번째 렌더러, 같은 장면) ───────── */
const moonViewEl = document.getElementById('moonView');
const viewRenderer = new THREE.WebGLRenderer({ antialias: true });
viewRenderer.outputColorSpace = THREE.SRGBColorSpace;
viewRenderer.setClearColor(0x02040c, 1);
moonViewEl.prepend(viewRenderer.domElement);
// 달 반지름이 보이는 각: atan(0.5/4.2)≈6.8° → 시야 19°면 원 지름이 창의 약 71 %
const viewCam = new THREE.PerspectiveCamera(19, 1, 0.5, 200);
viewCam.layers.set(L_SHARED);
viewCam.up.set(0, 1, 0); // 북쪽이 위

/* ───────── 카메라 조작 ───────── */
const raycaster = new THREE.Raycaster(); raycaster.layers.set(L_MAIN);
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let hintShown = true;
function hideHint() { if (hintShown) { hintShown = false; document.getElementById('stageHint').classList.add('hide'); } }
function setNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
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
renderer.domElement.addEventListener('pointerdown', e => {
  if (SimBridge.locked) { e.stopImmediatePropagation(); return; }
  setNdc(e); raycaster.setFromCamera(ndc, camera);
  if (raycaster.intersectObject(moonHit).length) {
    e.stopImmediatePropagation(); e.preventDefault();
    dragId = e.pointerId; renderer.domElement.setPointerCapture(e.pointerId);
    S.dragging = true; S.tween = null; if (S.playing) setPlaying(false);
    renderer.domElement.style.cursor = 'grabbing'; sfx.pick(); hideHint();
  }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (S.dragging && e.pointerId === dragId) {
    const a = angleAtPointer(e); if (a !== null) S.theta = a;
    return;
  }
  if (e.pointerType === 'mouse' && !S.dragging) {
    setNdc(e); raycaster.setFromCamera(ndc, camera);
    renderer.domElement.style.cursor = raycaster.intersectObject(moonHit).length ? 'grab' : '';
  }
});
function endDrag(e) {
  if (!S.dragging || e.pointerId !== dragId) return;
  S.dragging = false; dragId = null; renderer.domElement.style.cursor = '';
  const i = nearestIdx(S.theta);
  if (Math.abs(angDiff(S.theta, i * 45)) <= SNAP_DEG) moveTo(i * 45, { fast: true });
  else { placed(); pushState(true); }
}
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 7; controls.maxDistance = 34;
controls.maxPolarAngle = 88 * DEG;
controls.target.copy(VIEW_TARGET);
controls.addEventListener('start', hideHint);

let camTween = null;
function fitDistance() {
  const r = stageEl.getBoundingClientRect();
  const aspect = Math.max(0.3, r.width / Math.max(1, r.height));
  const halfW = 8.9, halfH = 5.9; // 보여야 할 범위(궤도 글자 + 태양)
  const vt = Math.tan(camera.fov / 2 * DEG);
  return Math.max(halfH / vt, halfW / (vt * aspect)) + 1.0;
}
function camHome(top) {
  const d = fitDistance();
  const tilt = top ? 0.02 : 40 * DEG; // 연직에서 기울인 각
  return new THREE.Vector3(VIEW_TARGET.x, d * Math.cos(tilt), VIEW_TARGET.z + d * Math.sin(tilt));
}
function flyCamera(top) {
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
  viewRenderer.setSize(v.width, v.height, false);
  viewCam.aspect = 1; viewCam.updateProjectionMatrix();
  lastViewTheta = null; // 크기를 바꾸면 캔버스가 지워지므로 다시 그림
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
  t.dataset.full = i === 8 ? `다시 삭 ${day}일` : `${NAMES[i] || `(${POS[i]})`} · ${day}일`;
  t.dataset.empty = `${day}일`;
  t.textContent = t.dataset.empty;
  d.append(cv, t); stripEl.appendChild(d); stripSlots.push({ el: d, cv, t, got: false });
}
function layoutStrip() {
  stripSlots.forEach((s, i) => { s.el.style.left = (i / 8 * 100) + '%'; });
}
function markStrip(i) {
  const s = stripSlots[i]; if (s.got) return;
  s.got = true; s.el.classList.add('got', 'pop'); drawPhase(s.cv, (i % 8) * 45); s.t.textContent = s.t.dataset.full;
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
  if (SimBridge.locked) return;
  if (S.playing) setPlaying(false);
  sfx.toggle(); hideHint(); moveTo(+b.dataset.pos * 45);
}));

// 달이 표시점에 놓였을 때(끌어 놓기·단추·키보드)
function placed() {
  const i = nearestIdx(S.theta);
  const exact = Math.abs(angDiff(S.theta, i * 45)) < 0.01;
  if (!exact) return;
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
btnPlay.addEventListener('click', () => { if (!SimBridge.locked) setPlaying(!S.playing); });
const speedEl = document.getElementById('speed'), speedOut = document.getElementById('speedOut');
function setSpeed(v) { S.speed = v; speedOut.textContent = v.toFixed(1) + '배'; paintRange(speedEl); }
speedEl.addEventListener('input', () => { setSpeed(+speedEl.value); sound.tick((S.speed - 0.5) / 3.5); });

// 키보드: 무대에서 ←/→ (Shift = 1°)
stageEl.addEventListener('keydown', e => {
  if (SimBridge.locked) return;
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

document.getElementById('btnTop').addEventListener('click', () => { sfx.toggle(); flyCamera(true); });

/* ───────── 보기 설정 ───────── */
const tLit = document.getElementById('tLit'), tSeen = document.getElementById('tSeen'), tShadow = document.getElementById('tShadow');
function applyToggles() {
  S.showLitHalf = tLit.checked; S.showSeenHalf = tSeen.checked; S.showShadow = tShadow.checked;
  litRing.visible = earthLitRing.visible = S.showLitHalf;
  seenRing.visible = sight.visible = S.showSeenHalf;
  shadow.visible = shadowLabel.visible = S.showShadow;
  document.getElementById('shadowNote').hidden = !S.showShadow;
}
[tLit, tSeen, tShadow].forEach(t => t.addEventListener('change', () => { sfx.toggle(); applyToggles(); pushState(true); }));

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
taskFullBtn.addEventListener('click', () => { if (SimBridge.locked) return; sfx.toggle(); setTask('full'); });
taskFQBtn.addEventListener('click', () => { if (SimBridge.locked) return; sfx.toggle(); setTask('fq'); });

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
    s.innerHTML = `<div class="nm">(${POS[i]}) ${NAMES[i] ? `<small>${NAMES[i]}</small>` : ''}</div><div class="hole"></div>`;
    s.addEventListener('click', () => { if (selected && !SimBridge.locked) tryPlace(selected, i); });
    s.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && selected) { e.preventDefault(); tryPlace(selected, i); } });
    slotsEl.appendChild(s); slots.push({ el: s, filled: false });
  }
  const angles = [0, 45, 90, 135, 180, 225, 270, 315, 90, 270];
  for (let k = angles.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [angles[k], angles[j]] = [angles[j], angles[k]]; }
  angles.forEach((a, n) => {
    const cell = document.createElement('div'); cell.className = 'card-cell';
    const c = document.createElement('div'); c.className = 'card'; c.tabIndex = 0; c.setAttribute('role', 'button');
    c.setAttribute('aria-label', `달 모양 카드 ${n + 1}`);
    c.appendChild(phaseCanvas(a, 32));
    const card = { el: c, cell, deg: a, used: false };
    c.addEventListener('pointerdown', e => startCardDrag(e, card));
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCard(card); } });
    cell.appendChild(c); cardsEl.appendChild(cell); cards.push(card);
  });
}
function selectCard(card) {
  if (SimBridge.locked || card.used) return;
  selected = selected === card ? null : card;
  cards.forEach(c => c.el.classList.toggle('sel', c === selected));
  slots.forEach(s => s.el.classList.toggle('target', !!selected && !s.filled));
  if (selected) sfx.pick();
}
let cd = null;
function startCardDrag(e, card) {
  if (SimBridge.locked || card.used || e.button > 0) return;
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
  if (over !== null && !SimBridge.locked) tryPlace(card, over);
  else { card.el.classList.remove('back'); void card.el.offsetWidth; card.el.classList.add('back'); }
}
window.addEventListener('pointerup', endCardDrag);
window.addEventListener('pointercancel', endCardDrag);

function tryPlace(card, i) {
  const slot = slots[i];
  if (slot.filled || card.used) return;
  selected = null; cards.forEach(c => c.el.classList.remove('sel')); slots.forEach(s => s.el.classList.remove('target'));
  const actual = i * 45; // 그 위치에서 지구에서 본 달의 모양
  if (card.deg === actual) {
    card.used = true; slot.filled = true; S.cardsPlaced++;
    card.el.classList.remove('back'); slot.el.querySelector('.hole').appendChild(card.el);
    slot.el.classList.add('filled'); slot.el.removeAttribute('role'); slot.el.tabIndex = -1;
    card.el.tabIndex = -1;
    fbEl.className = 'feedback ok';
    fbEl.innerHTML = `<span><b>${posLabel(i)}</b> 칸에 붙였어요. (${S.cardsPlaced}/8)</span>`;
    sfx.right();
    if (S.cardsPlaced === 8) {
      setTimeout(() => { sfx.done(); fbEl.innerHTML = '<span><b>8칸 모두 완성!</b> 달이 시계 반대 방향으로 돌며 모양이 차례로 바뀌어요.</span>'; }, 450);
      setTimeout(() => openPrediction(true), 1800);
    }
  } else {
    S.cardMistakes++;
    const mirror = (i === 2 && card.deg === 270) || (i === 6 && card.deg === 90);
    if (mirror) S.mirrorMistake = true;
    slot.el.classList.remove('bad'); void slot.el.offsetWidth; slot.el.classList.add('bad');
    setTimeout(() => slot.el.classList.remove('bad'), 450);
    card.el.classList.remove('back'); void card.el.offsetWidth; card.el.classList.add('back');
    sfx.wrong();
    fbEl.className = 'feedback no'; fbEl.innerHTML = '';
    const pair = document.createElement('div'); pair.className = 'pair';
    const f1 = document.createElement('figure'); f1.append(phaseCanvas(card.deg, 36), '고른 카드');
    const f2 = document.createElement('figure'); f2.append(phaseCanvas(actual, 36), `(${POS[i]})의 달`);
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
let predAfterMode = false;
function openPrediction(after) {
  if (SimBridge.locked) return;
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
  if (predAfterMode) S.predictionAfter = b.dataset.pred; else S.prediction = b.dataset.pred;
  predModal.hidden = true; sfx.right(); pushState(true);
  if (!predAfterMode) stageEl.focus({ preventScroll: true });
}));
document.getElementById('btnRethink').addEventListener('click', () => { sfx.toggle(); openPrediction(true); });

/* ───────── 알림 ───────── */
let toastTimer;
function toastMsg(t) {
  taskMsg.style.color = 'var(--good)'; taskMsg.textContent = t;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { if (taskMsg.textContent === t) taskMsg.textContent = ''; }, 4000);
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
  renderer.setPixelRatio(q === 'high' ? Math.min(devicePixelRatio, 2) : 1);
  viewRenderer.setPixelRatio(q === 'high' ? Math.min(devicePixelRatio, 2) : 1);
  makeStars(q === 'high' ? 1800 : 600);
  sunGlow.visible = q === 'high';
  resize();
}
btnQuality.addEventListener('click', () => { sfx.toggle(); setQuality(S.quality === 'high' ? 'low' : 'high'); });

document.getElementById('btnReset').addEventListener('click', () => { if (SimBridge.locked) return; sound.reset(); resetAll(); });
function resetAll() {
  setPlaying(false);
  Object.assign(S, {
    theta: 30, tween: null, visited: new Set(), lapDone: false, cardsPlaced: 0, cardMistakes: 0, mirrorMistake: false,
    taskFull: false, taskFirstQuarter: false, activeTask: null, taskFullFirstTry: '', taskFirstQuarterFirstTry: '',
  });
  tLit.checked = tSeen.checked = tShadow.checked = false; applyToggles();
  speedEl.value = 1; setSpeed(1);
  posBtns.forEach(b => b.classList.remove('seen'));
  for (const t of Object.values(TASKS)) { t.btn.classList.remove('done'); t.btn.querySelector('.chk').textContent = '○'; t.btn.setAttribute('aria-pressed', 'false'); }
  taskMsg.textContent = ''; fbEl.className = 'feedback'; fbEl.innerHTML = '';
  clearStrip(); buildBoard(); flyCamera(false);
  pushState(true);
}

/* ───────── 화면 값 · SimBridge ───────── */
const vPos = document.getElementById('vPos'), vAngle = document.getElementById('vAngle'), vDays = document.getElementById('vDays'), vLit = document.getElementById('vLit'), mLit = document.getElementById('mLit');
let lastShown = '', lastSent = 0, pendingSend = false;
function readout() {
  const th = norm(S.theta), deg = Math.round(th) % 360, i = nearestIdx(th);
  const key = deg + '|' + i;
  if (key === lastShown) return false;
  lastShown = key;
  vPos.textContent = posLabel(i);
  vAngle.textContent = deg + '°';
  vDays.textContent = '약 ' + daysAfterNew(deg).toFixed(1) + '일';
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
SimBridge.onLock = () => { setPlaying(false); predModal.hidden = true; if (cd) { cd = null; ghost.hidden = true; } S.dragging = false; };

/* ───────── 매 프레임 ───────── */
const clock = new THREE.Clock();
const fps = new FpsMonitor(() => { if (S.quality === 'high') setQuality('low'); }, { threshold: 28, window: 4 });
let frame = 0;
const tmp = new THREE.Vector3();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  frame++; fps.update(dt);

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
    if (S.theta < before) { /* 한 바퀴 넘김 */ }
  } else if (S.tween) {
    const tw = S.tween; tw.t += dt / tw.dur;
    const e = ease.inOutCubic(Math.min(1, tw.t));
    S.theta = norm(tw.from + tw.delta * e);
    if (tw.t >= 1) { S.theta = norm(Math.round(tw.from + tw.delta)); S.tween = null; placed(); pushState(true); }
  }

  // 달·덧그림 위치
  const p = posOf(S.theta);
  moon.position.copy(p); moonHit.position.copy(p);
  moon.rotation.y = S.theta * DEG; // 같은 면이 늘 지구를 향함
  moonHalo.position.copy(p);
  moonLabel.position.copy(p).multiplyScalar(1 - (MOON_R + 0.45) / R_ORBIT);
  const nearI = nearestIdx(S.theta);
  const onMarker = Math.abs(angDiff(S.theta, nearI * 45)) < 0.6 && !S.dragging;
  moonHalo.material.opacity += ((S.dragging ? 0.75 : onMarker ? 0.35 : 0) - moonHalo.material.opacity) * Math.min(1, dt * 8);
  litRing.position.copy(p); litRing.rotation.y = 0;
  seenRing.position.copy(p); seenRing.rotation.y = (S.theta + 180) * DEG;
  if (S.showSeenHalf) {
    tmp.copy(p).multiplyScalar(1 - (MOON_R * 1.5) / R_ORBIT);
    const pa = sightGeo.attributes.position; pa.setXYZ(0, p.x * EARTH_R * 1.2 / R_ORBIT, 0, p.z * EARTH_R * 1.2 / R_ORBIT); pa.setXYZ(1, tmp.x, 0, tmp.z); pa.needsUpdate = true;
    sight.computeLineDistances();
  }
  for (let i = 0; i < 8; i++) {
    const m = markers[i];
    flashT[i] = Math.max(0, flashT[i] - dt * 1.6);
    const s = 1 + flashT[i] * 0.8 + (i === nearI ? 0.25 : 0);
    m.scale.setScalar(s);
    m.material.color.setHex(flashT[i] > 0 ? 0xffd45a : (i === nearI ? 0xff7a5a : 0xe0453a));
  }
  rayMat.opacity = 0.4 + 0.18 * Math.sin(clock.elapsedTime * 2.2);

  // 카메라 이동
  if (camTween) {
    camTween.t += dt / camTween.dur; const e = ease.inOutCubic(Math.min(1, camTween.t));
    camera.position.lerpVectors(camTween.from, camTween.to, e);
    controls.target.lerpVectors(camTween.fromT, VIEW_TARGET, e);
    if (camTween.t >= 1) camTween = null;
  }
  controls.update();

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);

  // 지구에서 본 달: 바뀌었을 때만(품질 낮음이면 더 드물게)
  const changed = lastViewTheta === null || Math.abs(S.theta - lastViewTheta) > 0.05;
  if (changed && (S.quality === 'high' || frame % 2 === 0)) {
    viewCam.position.set(0, 0, 0); viewCam.lookAt(p);
    viewRenderer.render(scene, viewCam);
    lastViewTheta = S.theta;
  }

  if (readout()) pushState(false);
  else if (pendingSend && performance.now() - lastSent > 200) pushState(true);
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
let lastFit = fitDistance();
new ResizeObserver(() => {
  const d = fitDistance(); if (Math.abs(d - lastFit) < 0.3) return;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, d); lastFit = d;
}).observe(stageEl);
// 개발 확인용 접근점 (정답 정보 없음)
window.__moon = {
  S, moveTo, setPlaying,
  screenOf(deg) { const v = posOf(deg).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
};
