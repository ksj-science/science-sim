// 빛의 굴절 시뮬레이터
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { sound } from '../../lib/sound.js';
import { clamp, DEG, damp, fmt, paintRange, toast, FpsMonitor, ease } from '../../lib/utils.js';

// ───────────────────────── 상수 / 데이터 ─────────────────────────
const W = 9, H = 3.4, D = 2.4;     // 물질 블록 크기 (가로, 높이, 깊이)
const R = 2.7;                    // 레이저 출구 ~ 경계면 중심 거리
const C_KMS = 299792;               // 진공에서 빛의 속력 (km/s)
const BEAM_SPEED = 14;              // 레이저를 켤 때 빛줄기가 뻗어 나가는 화면 속력 (n=1 기준)
const PULSE_SPEED = 1.5;            // '빛의 빠르기 비교' 펄스 화면 속력 (n=1 기준)
const PULSE_PERIOD = 0.32;

const MEDIA = [
  { id: 'air', name: '공기', n: 1.00, color: 0xdfefff, opacity: 0.035, edge: 0.28 },
  { id: 'water', name: '물', n: 1.33, color: 0x2f8fff, opacity: 0.26, edge: 0.6 },
  { id: 'glass', name: '유리', n: 1.50, color: 0x8fe6d6, opacity: 0.30, edge: 0.7 },
  { id: 'diamond', name: '다이아몬드', n: 2.42, color: 0xe4f2ff, opacity: 0.40, edge: 0.9 },
];
const CUSTOM_NAME = '물질 X';

const LASER_COLORS = {
  red: { hex: 0xff2a2a, css: '#ff3b3b' },
  green: { hex: 0x2bff5a, css: '#39ff6a' },
  blue: { hex: 0x3d6bff, css: '#4b7bff' },
};

const DEFAULT_STATE = {
  angle: 40, m1: 'air', m2: 'water', n1: 1.0, n2: 1.33,
  laserOn: true, playing: true, color: 'red',
  show: { normal: true, angles: true, reflect: true, protractor: true, pulse: false, formula: false },
};
const state = structuredClone(DEFAULT_STATE);
state.quality = (navigator.hardwareConcurrency || 4) <= 2 ? 'low' : 'high';

SimBridge.init('빛의굴절'); // 제출 후 잠금은 style.css의 .sim-locked 규칙이 처리

// 화면에 보이는 값 (목표값을 부드럽게 따라감)
const disp = { angle: state.angle, n1: state.n1, n2: state.n2, laser: 1, color: new THREE.Color(LASER_COLORS.red.hex) };
let simT = 0;
let laserOnAt = 0;      // 펄스용 (일시정지하면 멈추는 시간)
let realT = 0, laserOnReal = 0; // 빛줄기 뻗기 연출용 (항상 흐르는 시간)

const mediumById = id => MEDIA.find(m => m.id === id);
const mediumName = slot => (mediumById(state[`m${slot}`])?.name ?? CUSTOM_NAME);
// 받침에 맞는 조사 '로/으로' (ㄹ 받침은 '로')
function withRo(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}로`; // '물질 X'(엑스) → 로
  const jong = code % 28;
  return word + (jong === 0 || jong === 8 ? '로' : '으로');
}
function mediumLook(id, n) {
  const m = mediumById(id);
  if (m) return m;
  const t = clamp((n - 1) / 1.5, 0, 1);
  return { color: new THREE.Color(0xe8ddff).lerp(new THREE.Color(0x9b6bff), t).getHex(), opacity: 0.05 + 0.32 * t, edge: 0.35 + 0.5 * t };
}

// ───────────────────────── 렌더러 / 장면 ─────────────────────────
const wrap = document.getElementById('canvasWrap');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'label-layer';
wrap.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = makeGradientTexture();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(1.5, 2, 16);

const lineMaterials = [];
function makeLineMat(opts) {
  const m = new LineMaterial({ linewidth: 2, transparent: true, ...opts });
  lineMaterials.push(m);
  return m;
}

// 조명
scene.add(new THREE.HemisphereLight(0xc4d8ff, 0x2a1d10, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(4, 10, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
sun.shadow.bias = -0.0005;
sun.shadow.radius = 4;
scene.add(sun);

// 실험대
const table = new THREE.Mesh(
  new THREE.BoxGeometry(16, 0.4, 7),
  new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.7, metalness: 0.0 })
);
table.position.set(0, -H - 0.2, 0);
table.receiveShadow = true;
scene.add(table);

// 블록 받침 (블록이 실험대 위에 놓인 느낌)
const baseShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(W + 0.6, D + 0.6),
  new THREE.MeshBasicMaterial({ map: makeSoftShadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 })
);
baseShadow.rotation.x = -Math.PI / 2;
baseShadow.position.y = -H + 0.005;
scene.add(baseShadow);

// 물질 블록
function makeBlock(yCenter) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.0,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
  mesh.position.y = yCenter;
  mesh.renderOrder = 1;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
  );
  mesh.add(edges);
  scene.add(mesh);
  return { mesh, mat, edges, color: new THREE.Color(), opacity: 0.1, edge: 0.4 };
}
const block1 = makeBlock(H / 2);
const block2 = makeBlock(-H / 2);

// 경계면 (가운데 단면 선 + 얇은 면)
const boundaryLine = new Line2(
  new LineGeometry().setPositions([-W / 2, 0, 0, W / 2, 0, 0]),
  makeLineMat({ color: 0xffffff, linewidth: 2, opacity: 0.55 })
);
scene.add(boundaryLine);

// 각도기 원판
const protractor = new THREE.Mesh(
  new THREE.PlaneGeometry(5.6, 5.6),
  new THREE.MeshBasicMaterial({ map: makeProtractorTexture(), transparent: true, depthWrite: false, opacity: 0.7, toneMapped: false })
);
protractor.position.z = -0.03;
protractor.renderOrder = 2;
scene.add(protractor);

// 법선 (점선)
const normalLine = new Line2(
  new LineGeometry().setPositions([0, -H * 0.95, 0, 0, H * 0.95, 0]),
  makeLineMat({ color: 0xdfe9ff, linewidth: 2.2, dashed: true, dashSize: 0.16, gapSize: 0.11, opacity: 0.85 })
);
normalLine.computeLineDistances();
normalLine.renderOrder = 3;
scene.add(normalLine);

// 각도 호 + 부채꼴
function makeArc(color) {
  const line = new Line2(new LineGeometry().setPositions([0, 0, 0, 0.1, 0, 0]), makeLineMat({ color, linewidth: 2.5, opacity: 0.95 }));
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
  );
  line.renderOrder = 4; fill.renderOrder = 3;
  const g = new THREE.Group();
  g.add(line, fill);
  g.position.z = 0.01;
  scene.add(g);
  return { g, line, fill, key: '' };
}
const arcInc = makeArc(0xffb547);
const arcRefr = makeArc(0x5ef0a0);
const arcRefl = makeArc(0xd39bff);

function setArc(arc, r, startDeg, lenDeg) {
  const key = `${r}|${startDeg.toFixed(2)}|${lenDeg.toFixed(2)}`;
  if (arc.key === key) return;
  arc.key = key;
  const n = Math.max(2, Math.ceil(Math.abs(lenDeg) / 3));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (startDeg + (lenDeg * i) / n) * DEG;
    pts.push(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  arc.line.geometry.setPositions(pts);
  arc.fill.geometry.dispose();
  arc.fill.geometry = new THREE.CircleGeometry(r, n, Math.min(startDeg, startDeg + lenDeg) * DEG, Math.abs(lenDeg) * DEG);
}

// 빛줄기
const UP = new THREE.Vector3(0, 1, 0);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0);
class Beam {
  constructor() {
    this.coreMat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glowMat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.core = new THREE.Mesh(beamGeo, this.coreMat);
    this.glow = new THREE.Mesh(beamGeo, this.glowMat);
    this.group = new THREE.Group();
    this.group.add(this.glow, this.core);
    this.core.renderOrder = 6; this.glow.renderOrder = 5;
    scene.add(this.group);
  }
  set(origin, dir, len, intensity, color) {
    const vis = len > 0.002 && intensity > 0.004;
    this.group.visible = vis;
    if (!vis) return;
    this.group.position.copy(origin);
    this.group.quaternion.setFromUnitVectors(UP, dir);
    this.core.scale.set(0.022, len, 0.022);
    this.glow.scale.set(0.075, len, 0.075);
    this.coreMat.color.copy(color).lerp(WHITE, 0.3).multiplyScalar(0.5 + 1.1 * intensity);
    this.coreMat.opacity = clamp(0.2 + 0.8 * intensity, 0, 1);
    this.glowMat.color.copy(color);
    this.glowMat.opacity = 0.05 + 0.3 * intensity;
  }
}
const WHITE = new THREE.Color(1, 1, 1);
const beamInc = new Beam();
const beamRefr = new Beam();
const beamRefl = new Beam();

// 경계면에 닿는 빛 점
const spot = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
}));
spot.renderOrder = 7;
scene.add(spot);

// 펄스 (빛의 빠르기 비교)
const MAX_PULSES = 256;
const pulseCore = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.07, 12, 8),
  new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  MAX_PULSES
);
const pulseHalo = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.12, 12, 8),
  new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
  MAX_PULSES
);
for (const im of [pulseCore, pulseHalo]) {
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.setColorAt(0, WHITE);
  im.count = 0;
  im.renderOrder = 8;
  im.frustumCulled = false;
  scene.add(im);
}

// 레이저 장치
const laser = new THREE.Group();
const laserPick = [];
let laserButton, laserLens, laserStripe;
(function buildLaser() {
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x2a3144, metalness: 0.7, roughness: 0.32 });
  const metalLight = new THREE.MeshStandardMaterial({ color: 0xc3cbe0, metalness: 0.9, roughness: 0.22 });
  const add = (geo, mat, x, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    laser.add(m);
    laserPick.push(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.17, 0.17, 1.4, 32).rotateZ(Math.PI / 2), metalDark, -0.82);
  add(new THREE.CylinderGeometry(0.2, 0.18, 0.16, 32).rotateZ(Math.PI / 2), metalLight, -0.08);
  add(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(Math.PI / 2), metalDark, -1.52);
  for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.172, 0.012, 8, 32).rotateY(Math.PI / 2), metalLight, -1.15 - i * 0.07);
  laserStripe = add(new THREE.CylinderGeometry(0.175, 0.175, 0.06, 32).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 0.4 }), -0.4);
  const btnBase = add(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 24), metalLight, -0.78, 0.17);
  laserButton = add(new THREE.CylinderGeometry(0.075, 0.075, 0.09, 24),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 0.8, roughness: 0.4 }), -0.78, 0.22);
  laserButton.userData.isButton = true;
  btnBase.userData.isButton = true;
  laserLens = add(new THREE.CircleGeometry(0.1, 24).rotateY(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }), 0.002);
  laser.traverse(o => { if (o.isMesh) o.renderOrder = 2; });
  scene.add(laser);
})();

// 3D 라벨
function makeLabel(cls, html = '') {
  const el = document.createElement('div');
  el.className = `lbl3d ${cls}`;
  el.innerHTML = html;
  const obj = new CSS2DObject(el);
  scene.add(obj);
  return { el, obj, html };
}
function setLabel(l, html) { if (l.html !== html) { l.el.innerHTML = html; l.html = html; } }
function showLabel(l, on) { l.obj.visible = on; }

const lblInc = makeLabel('inc');
const lblRefr = makeLabel('refr');
const lblRefl = makeLabel('refl');
const lblNormal = makeLabel('normal', '법선');
lblNormal.obj.position.set(0, -H * 0.95 - 0.05, 0);
const lblM1 = makeLabel('medium');
lblM1.obj.position.set(W / 2 - 1.0, H - 0.4, 0);
const lblM2 = makeLabel('medium');
lblM2.obj.position.set(W / 2 - 1.0, -H + 0.4, 0);
const lblTir = makeLabel('tir', '전반사!');
lblTir.obj.position.set(1.7, -0.9, 0);
lblTir.obj.visible = false;

// ───────────────────────── 후처리 / 카메라 ─────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// 카메라 회전/확대: 레이저 끌기 처리기를 먼저 등록해야 함
setupLaserDrag();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 30;
controls.minPolarAngle = 0.25;
controls.maxPolarAngle = Math.PI * 0.62;
controls.minAzimuthAngle = -1.2;
controls.maxAzimuthAngle = 1.2;
let userMoved = false;
controls.addEventListener('start', () => { userMoved = true; camTween = null; });

const HOME_DIR = new THREE.Vector3(0.16, 0.2, 1).normalize();
const HOME_TARGET = new THREE.Vector3(0, 0.35, 0);
const home = { pos: new THREE.Vector3(), target: HOME_TARGET.clone() };
// 겹쳐 있는 패널(측정값, 재생 바)을 피하도록 화면 중심을 옮긴다
// x>0: 내용을 오른쪽으로, y>0: 내용을 위로 / effW·effH: 장면을 맞춰 넣을 영역
const viewShift = { x: 0, y: 0, effW: 1, effH: 1 };
function computeViewShift(w, h) {
  const ro = document.getElementById('readout').getBoundingClientRect();
  const pb = document.getElementById('playbar').getBoundingClientRect();
  if (w > 640) {
    viewShift.x = Math.min(ro.width * 0.42, w * 0.14);
    viewShift.y = pb.height * 0.55;
    viewShift.effW = w - 2 * viewShift.x;
    viewShift.effH = h - 2 * viewShift.y;
  } else {
    // 좁은 화면: 측정값은 위쪽, 재생 바는 아래쪽에 있으므로 그 사이에 장면을 둔다
    const top = ro.height + 12, bottom = pb.height + 20;
    viewShift.x = 0;
    viewShift.y = (bottom - top) / 2;
    viewShift.effW = w;
    viewShift.effH = h - top - bottom;
  }
}
function computeHome(w, h) {
  const { effW, effH } = viewShift;
  const halfH = 4.6, halfW = 5.1;
  // 원근 카메라의 세로 시야각은 view offset 전체 프레임(h + 2·shiftY)에 걸쳐 있음
  const k = Math.tan((camera.fov * DEG) / 2) / (h + 2 * Math.abs(viewShift.y));
  const dist = Math.max(halfH / (k * effH), halfW / (k * effW));
  home.pos.copy(HOME_DIR).multiplyScalar(dist).add(HOME_TARGET);
}
let camTween = null;
function resetView(animate = true) {
  userMoved = false;
  if (!animate) {
    camera.position.copy(home.pos);
    controls.target.copy(home.target);
    controls.update();
    return;
  }
  camTween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone() };
}

// ───────────────────────── 크기 조절 / 품질 ─────────────────────────
let useBloom = true;
function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  labelRenderer.setSize(w, h);
  computeViewShift(w, h);
  const sx = viewShift.x, sy = viewShift.y;
  const fw = w + 2 * Math.abs(sx), fh = h + 2 * Math.abs(sy);
  camera.aspect = fw / fh;
  camera.setViewOffset(fw, fh, Math.abs(sx) - sx, Math.abs(sy) + sy, w, h);
  camera.updateProjectionMatrix();
  for (const m of lineMaterials) m.resolution.set(w, h);
  computeHome(w, h);
  if (!userMoved && !camTween) resetView(false);
}
new ResizeObserver(resize).observe(wrap);

function applyQuality(q, silent = false) {
  state.quality = q;
  const high = q === 'high';
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 2) : 1);
  sun.castShadow = high;
  useBloom = high;
  document.querySelector('#btnQuality .lbl').textContent = `품질: ${high ? '높음' : '낮음'}`;
  resize();
  if (!silent) toast(high ? '그래픽 품질: 높음 (빛 번짐·그림자 켜짐)' : '그래픽 품질: 낮음 (더 부드럽게 움직여요)');
}

let fpsWatchFrom = 2.5;
const fpsMon = new FpsMonitor(() => {
  if (state.quality === 'high') {
    applyQuality('low', true);
    toast('화면이 느려서 품질을 낮췄어요. ✨ 버튼으로 바꿀 수 있어요.', 3500);
  }
}, { threshold: 32, window: 3 });

// ───────────────────────── 레이저 끌기 ─────────────────────────
function setupLaserDrag() {
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  let dragging = false, downOnButton = false, moved = false;

  const pick = e => {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(laserPick, false)[0];
  };

  el.addEventListener('pointerdown', e => {
    const h = pick(e);
    if (!h) return;
    e.stopImmediatePropagation();
    el.setPointerCapture(e.pointerId);
    dragging = true; moved = false;
    downOnButton = !!h.object.userData.isButton;
    el.style.cursor = 'grabbing';
    hideDragHint();
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) {
      el.style.cursor = pick(e) ? 'grab' : '';
      return;
    }
    e.stopImmediatePropagation();
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    let a = Math.atan2(-hit.x, hit.y) / DEG;
    if (hit.y < 0) a = hit.x < 0 ? 89 : 0;
    a = Math.round(clamp(a, 0, 89));
    if (a !== state.angle) { moved = true; setAngle(a); }
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = '';
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (downOnButton && !moved) toggleLaser();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// ───────────────────────── 상태 변경 함수 ─────────────────────────
const $ = id => document.getElementById(id);
const angleInput = $('angle');

function setAngle(a, { silent = false } = {}) {
  state.angle = a;
  angleInput.value = a;
  paintRange(angleInput);
  $('angleOut').textContent = `${a}°`;
  if (!silent) sound.tick(a / 89);
  updateGraphPoint(true);
}

function setMedium(slot, id, n = null, { silent = false } = {}) {
  state[`m${slot}`] = id;
  state[`n${slot}`] = n ?? mediumById(id).n;
  const input = $(`n${slot}`);
  input.value = state[`n${slot}`];
  paintRange(input);
  $(`n${slot}Out`).textContent = state[`n${slot}`].toFixed(2);
  document.querySelectorAll(`#m${slot}chips .chip`).forEach(c => c.classList.toggle('active', c.dataset.id === id));
  if (!silent) sound.bubble();
  updateGraphCurve();
}

function toggleLaser(force) {
  state.laserOn = force ?? !state.laserOn;
  if (state.laserOn) { laserOnAt = simT; laserOnReal = realT; sound.on(); } else sound.off();
  const b = $('btnLaser');
  b.classList.toggle('off', !state.laserOn);
  b.innerHTML = state.laserOn ? '🔴 <span class="lbl">레이저 끄기</span>' : '⭕ <span class="lbl">레이저 켜기</span>';
}

function setPlaying(p) {
  state.playing = p;
  $('btnPlay').innerHTML = p ? '⏸ <span class="lbl">일시정지</span>' : '▶ <span class="lbl">재생</span>';
}

function setColor(c, silent = false) {
  state.color = c;
  document.querySelectorAll('#colorChips .chip').forEach(x => x.classList.toggle('active', x.dataset.color === c));
  if (!silent) sound.click();
}

function setShow(key, v) {
  state.show[key] = v;
  const box = { normal: 'tNormal', angles: 'tAngles', reflect: 'tReflect', protractor: 'tProtractor', pulse: 'tPulse', formula: 'tFormula' }[key];
  $(box).checked = v;
  if (key === 'formula') $('roFormula').hidden = !v;
}

function resetAll() {
  const d = DEFAULT_STATE;
  setAngle(d.angle, { silent: true });
  setMedium(1, d.m1, null, { silent: true });
  setMedium(2, d.m2, null, { silent: true });
  setColor(d.color, true);
  for (const k in d.show) setShow(k, d.show[k]);
  setPlaying(true);
  if (!state.laserOn) toggleLaser(true); else { laserOnAt = simT; laserOnReal = realT; }
  resetView(true);
  sound.reset();
  toast('처음 상태로 돌아왔어요');
}

// ───────────────────────── UI 연결 ─────────────────────────
for (const slot of [1, 2]) {
  const row = $(`m${slot}chips`);
  for (const m of MEDIA) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.id = m.id;
    b.innerHTML = `${m.name}<small>${m.n.toFixed(2)}</small>`;
    b.addEventListener('click', () => setMedium(slot, m.id));
    row.appendChild(b);
  }
  const input = $(`n${slot}`);
  input.addEventListener('input', () => {
    const n = +input.value;
    const preset = MEDIA.find(m => Math.abs(m.n - n) < 0.001);
    setMedium(slot, preset ? preset.id : 'custom', n, { silent: true });
    sound.tick((n - 1) / 1.5);
  });
}

angleInput.addEventListener('input', () => { setAngle(+angleInput.value); hideDragHint(); });

$('btnSwap').addEventListener('click', () => {
  const { m1, m2, n1, n2 } = state;
  setMedium(1, m2, n2, { silent: true });
  setMedium(2, m1, n1, { silent: true });
  sound.bubble();
  toast(`이제 빛이 ${mediumName(1)}에서 ${withRo(mediumName(2))} 나아가요`);
});

document.querySelectorAll('#colorChips .chip').forEach(b => b.addEventListener('click', () => setColor(b.dataset.color)));

for (const [key, id] of Object.entries({ normal: 'tNormal', angles: 'tAngles', reflect: 'tReflect', protractor: 'tProtractor', pulse: 'tPulse', formula: 'tFormula' })) {
  $(id).addEventListener('change', e => { setShow(key, e.target.checked); sound.click(); });
}

$('btnLaser').addEventListener('click', () => toggleLaser());
$('btnPlay').addEventListener('click', () => { setPlaying(!state.playing); sound.click(); });
$('btnReset').addEventListener('click', resetAll);
$('btnView').addEventListener('click', () => { resetView(true); sound.click(); });
$('btnQuality').addEventListener('click', () => { applyQuality(state.quality === 'high' ? 'low' : 'high'); sound.click(); });

const muteBtn = $('btnMute');
const paintMute = () => { muteBtn.textContent = sound.muted ? '🔇' : '🔊'; muteBtn.title = sound.muted ? '소리 켜기' : '소리 끄기'; };
muteBtn.addEventListener('click', () => { sound.toggleMute(); paintMute(); sound.click(); });
paintMute();

$('btnHelp').addEventListener('click', () => { $('helpModal').hidden = false; sound.click(); });
$('btnHelpClose').addEventListener('click', () => { $('helpModal').hidden = true; sound.click(); });
$('helpModal').addEventListener('click', e => { if (e.target.id === 'helpModal') $('helpModal').hidden = true; });

$('btnGraph').addEventListener('click', () => toggleGraph());
$('btnGraphClose').addEventListener('click', () => toggleGraph(false));

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setAngle(clamp(state.angle - 1, 0, 89));
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setAngle(clamp(state.angle + 1, 0, 89));
  else if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); sound.click(); }
  else if (e.key === 'Escape') $('helpModal').hidden = true;
});

let hintHidden = false;
function hideDragHint() {
  if (hintHidden) return;
  hintHidden = true;
  $('dragHint').classList.add('hide');
}
setTimeout(hideDragHint, 12000);

// ───────────────────────── 그래프 ─────────────────────────
let chart = null;
function toggleGraph(force) {
  const panel = $('graphPanel');
  const open = force ?? panel.hidden;
  panel.hidden = !open;
  $('btnGraph').setAttribute('aria-pressed', open);
  sound.click();
  if (open && !chart && window.Chart) buildChart();
  if (open) { updateGraphCurve(); updateGraphPoint(true); }
}

function buildChart() {
  const Chart = window.Chart;
  Chart.defaults.color = '#9fb0c9';
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  chart = new Chart($('chart'), {
    type: 'scatter',
    data: {
      datasets: [
        { label: '굴절각', data: [], showLine: true, borderColor: '#5ef0a0', borderWidth: 2.5, pointRadius: 0, tension: 0 },
        { label: '꺾이지 않을 때', data: [{ x: 0, y: 0 }, { x: 90, y: 90 }], showLine: true, borderColor: 'rgba(200,215,240,0.35)', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
        { label: '지금', data: [], pointRadius: 6, pointBackgroundColor: '#ffb547', pointBorderColor: '#fff', pointBorderWidth: 2 },
      ],
    },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } }, tooltip: { enabled: false } },
      scales: {
        x: { min: 0, max: 90, title: { display: true, text: '입사각 (°)' }, ticks: { stepSize: 15 }, grid: { color: 'rgba(255,255,255,0.07)' } },
        y: { min: 0, max: 90, title: { display: true, text: '굴절각 (°)' }, ticks: { stepSize: 15 }, grid: { color: 'rgba(255,255,255,0.07)' } },
      },
    },
  });
}

function refractionDeg(a, n1, n2) {
  const s = (n1 * Math.sin(a * DEG)) / n2;
  return s > 1 ? null : Math.asin(s) / DEG;
}

// 웹앱(껍데기)으로 보내는 상태 — 값이 바뀔 때만 보냄. 키 이름은 단원설계서/빛의굴절.md 참고
let bridgeKey = '';
const tirSeen = new Set();
function pushBridge() {
  const refr = refractionDeg(state.angle, state.n1, state.n2);
  const tir = state.laserOn && refr === null;
  if (tir) tirSeen.add(`${mediumName(1)}→${mediumName(2)}`);
  const s = {
    incidence: state.angle,
    refraction: refr === null ? '' : Math.round(refr * 10) / 10,
    medium1: mediumName(1), n1: +state.n1.toFixed(2),
    medium2: mediumName(2), n2: +state.n2.toFixed(2),
    totalReflection: tir,
    tirSeen: [...tirSeen].join(','),
    laserOn: state.laserOn,
    color: state.color,
  };
  const key = JSON.stringify(s);
  if (key === bridgeKey) return;
  bridgeKey = key;
  SimBridge.setState(s);
}

function updateGraphCurve() {
  if (!chart || $('graphPanel').hidden) return;
  const pts = [];
  for (let a = 0; a <= 90; a += 1) {
    const b = refractionDeg(a, state.n1, state.n2);
    if (b === null) {
      const c = Math.asin(state.n2 / state.n1) / DEG;
      pts.push({ x: c, y: 90 });
      break;
    }
    pts.push({ x: a, y: b });
  }
  chart.data.datasets[0].data = pts;
  chart.update('none');
  const note = state.n1 > state.n2 + 0.001
    ? `임계각 ${fmt(Math.asin(state.n2 / state.n1) / DEG)}°보다 크면 굴절하지 않고 전반사해요.`
    : state.n2 > state.n1 + 0.001 ? '굴절각이 입사각보다 항상 작아요 (점선 아래).' : '두 물질이 같으면 점선 위에 있어요.';
  $('gpNote').textContent = note;
}

let lastPointUpdate = 0;
function updateGraphPoint(force = false) {
  if (!chart || $('graphPanel').hidden) return;
  const now = performance.now();
  if (!force && now - lastPointUpdate < 100) return;
  lastPointUpdate = now;
  const b = refractionDeg(disp.angle, disp.n1, disp.n2);
  chart.data.datasets[2].data = b === null ? [] : [{ x: disp.angle, y: b }];
  chart.update('none');
}

// ───────────────────────── 측정값 표시 ─────────────────────────
const ro = {};
function setText(id, txt) { if (ro[id] !== txt) { ro[id] = txt; $(id).textContent = txt; } }
function setHTML(id, html) { if (ro[id] !== html) { ro[id] = html; $(id).innerHTML = html; } }
const speedText = n => `약 ${(Math.round(C_KMS / n / 1000) * 1000).toLocaleString('ko-KR')} km/s`;

function updateReadout(phys) {
  const { a1, a2, tir, Rf } = phys;
  setText('roInc', `${fmt(a1)}°`);
  const refrEl = $('roRefr');
  if (tir) { setText('roRefr', '없음'); refrEl.classList.add('none'); }
  else { setText('roRefr', `${fmt(a2)}°`); refrEl.classList.remove('none'); }
  setText('roRefl', `${fmt(a1)}°`);
  $('roReflWrap').style.opacity = state.show.reflect || tir ? 1 : 0.35;

  setHTML('roM1', `${mediumName(1)} <small>n=${state.n1.toFixed(2)}</small>`);
  setHTML('roM2', `${mediumName(2)} <small>n=${state.n2.toFixed(2)}</small>`);
  setText('roV1', speedText(state.n1));
  setText('roV2', speedText(state.n2));
  $('sw1').style.background = `#${new THREE.Color(mediumLook(state.m1, state.n1).color).getHexString()}`;
  $('sw2').style.background = `#${new THREE.Color(mediumLook(state.m2, state.n2).color).getHexString()}`;

  const T = tir ? 0 : 1 - Rf;
  $('barT').style.width = `${T * 100}%`;
  $('barR').style.width = `${(1 - T) * 100}%`;
  setText('roEnergyTxt', tir ? '모두 반사 (100%)' : `굴절 ${Math.round(T * 100)}% · 반사 ${Math.round((1 - T) * 100)}%`);

  // 설명 문장
  const m1 = mediumName(1), m2 = mediumName(2);
  let msg, isTir = false;
  if (!state.laserOn) msg = '🔦 레이저를 켜서 빛을 비춰 보세요.';
  else if (Math.abs(state.n1 - state.n2) < 0.005) msg = `두 물질에서 빛의 속력이 같아서 빛이 꺾이지 않고 그대로 나아가요.`;
  else if (tir) {
    isTir = true;
    msg = `⚠️ <b>전반사!</b> 입사각이 임계각(${fmt(Math.asin(state.n2 / state.n1) / DEG)}°)보다 커서 빛이 ${withRo(m2)} 나가지 못하고 모두 반사돼요. 광섬유가 이 원리를 이용해요.`;
  } else if (state.angle === 0) msg = `빛이 경계면에 <b>수직</b>으로 들어가면 꺾이지 않고 똑바로 나아가요. (빛의 속력만 바뀌어요)`;
  else if (state.n2 > state.n1) msg = `빛이 ${m1}에서 ${withRo(m2)} 들어가며 <b>느려져서</b> 법선 <b>쪽으로</b> 꺾여요. → 굴절각 &lt; 입사각`;
  else msg = `빛이 ${m1}에서 ${withRo(m2)} 나가며 <b>빨라져서</b> 법선에서 <b>멀어지게</b> 꺾여요. → 굴절각 &gt; 입사각`;
  setHTML('roExplain', msg);
  $('roExplain').classList.toggle('tir', isTir);
  pushBridge();

  if (state.show.formula) {
    const s1 = state.n1 * Math.sin(state.angle * DEG);
    let html = `<div><span class="eq">n₁ × sin(입사각) = n₂ × sin(굴절각)</span></div>`;
    html += `<div>왼쪽: ${state.n1.toFixed(2)} × sin ${state.angle}° = <b>${s1.toFixed(3)}</b></div>`;
    if (tir) html += `<div>오른쪽: sin(굴절각) = ${(s1 / state.n2).toFixed(3)} &gt; 1 → 굴절각이 없어요!</div>`;
    else {
      const b = refractionDeg(state.angle, state.n1, state.n2);
      html += `<div>오른쪽: ${state.n2.toFixed(2)} × sin ${fmt(b)}° = <b>${(state.n2 * Math.sin(b * DEG)).toFixed(3)}</b></div>`;
    }
    html += `<div style="color:var(--text-dim)">굴절률 n = (진공에서 빛의 속력) ÷ (물질에서 빛의 속력)</div>`;
    setHTML('roFormula', html);
  }
}

// ───────────────────────── 물리 계산 ─────────────────────────
function physics(a1, n1, n2) {
  const t1 = a1 * DEG;
  const s2 = (n1 * Math.sin(t1)) / n2;
  const tir = s2 > 1;
  const t2 = tir ? 0 : Math.asin(s2);
  // 프레넬 반사율 (편광되지 않은 빛)
  let Rf = 1;
  if (!tir) {
    const ci = Math.cos(t1), ct = Math.cos(t2);
    const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
    const rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
    Rf = clamp((rs * rs + rp * rp) / 2, 0, 1);
  }
  return { a1, a2: t2 / DEG, t1, t2, tir, Rf };
}

// 원점에서 dir 방향으로 블록 안에서 나아갈 수 있는 거리
function lengthInBox(dx, dy) {
  const lx = Math.abs(dx) > 1e-6 ? (W / 2 - 0.05) / Math.abs(dx) : Infinity;
  const ly = Math.abs(dy) > 1e-6 ? (H - 0.05) / Math.abs(dy) : Infinity;
  return Math.min(lx, ly);
}

// ───────────────────────── 매 프레임 갱신 ─────────────────────────
const vP = new THREE.Vector3(), vD1 = new THREE.Vector3(), vD2 = new THREE.Vector3(), vDr = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3();
const targetColor = new THREE.Color();
let wasTir = false;

function updateBlock(block, id, n, dt) {
  const look = mediumLook(id, n);
  targetColor.setHex(look.color);
  block.mat.color.lerp(targetColor, 1 - Math.exp(-8 * dt));
  block.mat.opacity = damp(block.mat.opacity, look.opacity, 8, dt);
  block.edges.material.color.copy(block.mat.color);
  block.edges.material.opacity = damp(block.edges.material.opacity, look.edge, 8, dt);
}

function update(dt) {
  realT += dt;
  if (state.playing) simT += dt;

  // 부드러운 보간
  disp.angle = damp(disp.angle, state.angle, 16, dt);
  if (Math.abs(disp.angle - state.angle) < 0.01) disp.angle = state.angle;
  disp.n1 = damp(disp.n1, state.n1, 10, dt);
  disp.n2 = damp(disp.n2, state.n2, 10, dt);
  disp.laser = damp(disp.laser, state.laserOn ? 1 : 0, 14, dt);
  disp.color.lerp(tmpC.setHex(LASER_COLORS[state.color].hex), 1 - Math.exp(-10 * dt));

  updateBlock(block1, state.m1, state.n1, dt);
  updateBlock(block2, state.m2, state.n2, dt);

  const ph = physics(disp.angle, disp.n1, disp.n2);
  const { t1, t2, tir, Rf } = ph;

  // 방향 벡터
  vP.set(-R * Math.sin(t1), R * Math.cos(t1), 0);
  vD1.set(Math.sin(t1), -Math.cos(t1), 0);
  vD2.set(Math.sin(t2), -Math.cos(t2), 0);
  vDr.set(Math.sin(t1), Math.cos(t1), 0);
  const L2 = lengthInBox(vD2.x, vD2.y);
  const Lr = lengthInBox(vDr.x, vDr.y);

  // 레이저 장치
  laser.position.copy(vP);
  laser.rotation.z = Math.atan2(vD1.y, vD1.x);
  laserLens.material.color.copy(disp.color).multiplyScalar(0.25 + 2.2 * disp.laser);
  laserStripe.material.color.copy(disp.color);
  laserStripe.material.emissive.copy(disp.color);
  laserButton.material.emissiveIntensity = 0.15 + 0.9 * disp.laser;
  laserButton.position.y = 0.22 - 0.03 * disp.laser;

  // 빛줄기 (켤 때 뻗어 나가는 모습)
  const on = disp.laser > 0.003;
  const front = state.laserOn ? (realT - laserOnReal) * BEAM_SPEED : Infinity; // 빛이 나아간 '시간 × 속력'
  const dIncMax = front / disp.n1;                                    // 1번 물질 안 이동 거리
  const incLen = Math.min(R, dIncMax);
  const tAfter = Math.max(0, front - R * disp.n1);                     // 경계면 도착 후 남은 양
  const refrLen = Math.min(L2, tAfter / disp.n2);
  const reflLen = Math.min(Lr, tAfter / disp.n1);
  const pulseDim = state.show.pulse ? 0.35 : 1;
  const I = disp.laser * pulseDim;

  beamInc.set(vP, vD1, on ? incLen : 0, I, disp.color);
  beamRefr.set(ORIGIN, vD2, on && !tir ? refrLen : 0, I * (1 - Rf), disp.color);
  const reflVisible = state.show.reflect || tir;
  beamRefl.set(ORIGIN, vDr, on && reflVisible ? reflLen : 0, I * (tir ? 1 : 0.12 + 0.88 * Rf), disp.color);

  const hitting = on && incLen >= R - 1e-3;
  spot.visible = hitting;
  if (hitting) {
    const flick = 1 + 0.06 * Math.sin(simT * 23) + 0.04 * Math.sin(simT * 37);
    spot.scale.setScalar(0.75 * disp.laser * flick);
    spot.material.color.copy(disp.color).lerp(WHITE, 0.3);
  }

  // 펄스
  updatePulses(ph, L2, Lr);

  // 법선, 각도기, 각도 표시
  normalLine.visible = state.show.normal;
  lblNormal.obj.visible = state.show.normal;
  protractor.visible = state.show.protractor;
  protractor.material.opacity = damp(protractor.material.opacity, state.show.protractor ? 0.7 : 0, 10, dt);

  const a1 = ph.a1, a2 = ph.a2;
  const showAng = state.show.angles && on && a1 > 0.4;
  arcInc.g.visible = showAng;
  arcRefr.g.visible = showAng && !tir && hitting;
  arcRefl.g.visible = showAng && reflVisible && hitting;
  if (showAng) {
    setArc(arcInc, 1.25, 90, a1);
    if (!tir) setArc(arcRefr, 1.25, -90, a2);
    setArc(arcRefl, 0.9, 90, -a1);
  }
  showLabel(lblInc, showAng);
  showLabel(lblRefr, showAng && !tir && hitting);
  showLabel(lblRefl, showAng && reflVisible && hitting);
  const polar = (deg, r) => tmpV.set(Math.cos(deg * DEG) * r, Math.sin(deg * DEG) * r, 0);
  // 라벨이 겹치지 않도록 각 호의 바깥쪽 옆에 둔다
  lblInc.obj.position.copy(polar(90 + Math.max(a1 / 2, 22), 1.95));
  lblRefr.obj.position.copy(polar(-90 + Math.max(a2 / 2, 22), 1.95));
  lblRefl.obj.position.copy(polar(90 - Math.max(a1 / 2, 22), 1.95));
  setLabel(lblInc, `입사각 ${fmt(a1)}°`);
  setLabel(lblRefr, `굴절각 ${fmt(a2)}°`);
  setLabel(lblRefl, `반사각 ${fmt(a1)}°`);
  setLabel(lblM1, `${mediumName(1)}<small>n = ${state.n1.toFixed(2)}</small>`);
  setLabel(lblM2, `${mediumName(2)}<small>n = ${state.n2.toFixed(2)}</small>`);

  // 전반사 알림
  const tirNow = tir && hitting && state.laserOn;
  if (tirNow && !wasTir) {
    sound.chime();
    lblTir.obj.visible = true;
    lblTir.el.style.animation = 'none'; void lblTir.el.offsetWidth; lblTir.el.style.animation = '';
  }
  if (!tirNow) lblTir.obj.visible = false;
  wasTir = tirNow;

  updateReadout({ ...ph, a1: disp.angle });
  updateGraphPoint();
}

function updatePulses(ph, L2, Lr) {
  if (!state.show.pulse || !state.laserOn) { pulseCore.count = 0; pulseHalo.count = 0; return; }
  const { tir, Rf } = ph;
  const n1 = disp.n1, n2 = disp.n2;
  const v1 = PULSE_SPEED / n1, v2 = PULSE_SPEED / n2;
  const tHit = R / v1;
  const life = tHit + Math.max(tir ? 0 : L2 / v2, Lr / v1);
  const reflVisible = state.show.reflect || tir;
  let count = 0;
  const kNewest = Math.floor(simT / PULSE_PERIOD);
  const put = (pos, intensity) => {
    if (count >= MAX_PULSES) return;
    tmpM.makeTranslation(pos.x, pos.y, pos.z);
    pulseCore.setMatrixAt(count, tmpM);
    pulseHalo.setMatrixAt(count, tmpM);
    tmpC.copy(disp.color).lerp(WHITE, 0.35).multiplyScalar(0.3 + 1.7 * intensity);
    pulseCore.setColorAt(count, tmpC);
    tmpC.copy(disp.color).multiplyScalar(intensity);
    pulseHalo.setColorAt(count, tmpC);
    count++;
  };
  for (let k = kNewest; k >= 0; k--) {
    const e = k * PULSE_PERIOD;
    if (e < laserOnAt) break;
    const age = simT - e;
    if (age > life) break;
    if (age < tHit) {
      put(tmpV.copy(vP).addScaledVector(vD1, age * v1), 1);
    } else {
      const ta = age - tHit;
      const d2 = ta * v2, dr = ta * v1;
      if (!tir && d2 < L2) put(tmpV.copy(vD2).multiplyScalar(d2), (1 - Rf) * fadeEnd(d2, L2));
      if (reflVisible && dr < Lr) put(tmpV.copy(vDr).multiplyScalar(dr), (tir ? 1 : Math.max(Rf, 0.12)) * fadeEnd(dr, Lr));
    }
  }
  pulseCore.count = count;
  pulseHalo.count = count;
  pulseCore.instanceMatrix.needsUpdate = pulseHalo.instanceMatrix.needsUpdate = true;
  if (pulseCore.instanceColor) pulseCore.instanceColor.needsUpdate = true;
  if (pulseHalo.instanceColor) pulseHalo.instanceColor.needsUpdate = true;
}
const fadeEnd = (d, L) => clamp((L - d) / 0.5, 0, 1);

// ───────────────────────── 루프 ─────────────────────────
const clock = new THREE.Clock();
let elapsed = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (elapsed > fpsWatchFrom) fpsMon.update(dt);

  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt / 0.9);
    const k = ease.inOutCubic(camTween.t);
    camera.position.lerpVectors(camTween.fromPos, home.pos, k);
    controls.target.lerpVectors(camTween.fromTarget, home.target, k);
    if (camTween.t >= 1) camTween = null;
  }
  controls.update();
  update(dt);

  if (useBloom) composer.render(); else renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ───────────────────────── 시작 ─────────────────────────
setAngle(state.angle, { silent: true });
setMedium(1, state.m1, null, { silent: true });
setMedium(2, state.m2, null, { silent: true });
setColor(state.color, true);
applyQuality(state.quality, true);
updateBlock(block1, state.m1, state.n1, 10); // 처음에는 바로 목표 색으로
updateBlock(block2, state.m2, state.n2, 10);
resize();
resetView(false);
renderer.setAnimationLoop(loop);
// 자동 테스트용: 레이저의 화면 좌표 등을 확인할 수 있게 공개
window.__sim = {
  state, disp, physics,
  laserScreen() {
    const p = laser.localToWorld(new THREE.Vector3(-0.9, 0, 0)).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  },
};

// ───────────────────────── 텍스처 생성 ─────────────────────────
function makeGradientTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#0b1322');
  grd.addColorStop(0.55, '#16253d');
  grd.addColorStop(1, '#0d1727');
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5a3d27';
  g.fillRect(0, 0, 1024, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const y = rnd() * 256;
    g.strokeStyle = `rgba(${rnd() > 0.5 ? '30,18,10' : '120,85,55'},${0.08 + rnd() * 0.18})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 4 * rnd());
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeSoftShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeProtractorTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, r = S / 2 - 8;
  g.strokeStyle = 'rgba(220,232,255,0.55)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cx, r - 46, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(220,232,255,0.8)';
  g.font = 'bold 22px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let a = 0; a < 360; a++) {
    // a: 위쪽 법선(12시)에서 시계 방향 각도
    const rad = (a - 90) * DEG;
    const len = a % 10 === 0 ? 30 : a % 5 === 0 ? 20 : 10;
    g.strokeStyle = `rgba(220,232,255,${a % 10 === 0 ? 0.75 : 0.4})`;
    g.lineWidth = a % 10 === 0 ? 2.5 : 1.2;
    g.beginPath();
    g.moveTo(cx + Math.cos(rad) * r, cx + Math.sin(rad) * r);
    g.lineTo(cx + Math.cos(rad) * (r - len), cx + Math.sin(rad) * (r - len));
    g.stroke();
    if (a % 10 === 0) {
      const v = a <= 90 ? a : a <= 180 ? 180 - a : a <= 270 ? a - 180 : 360 - a;
      g.fillText(`${v}`, cx + Math.cos(rad) * (r - 62), cx + Math.sin(rad) * (r - 62));
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
