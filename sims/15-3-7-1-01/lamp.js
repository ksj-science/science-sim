// 탭 ① — 종이컵 손전등과 모눈종이 (Three.js). 길이 단위: 1 = 1 cm
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { clamp } from '../../lib/utils.js';

// 가장 가까운 거리 = 6 cm(빛 무늬가 딱 한 칸) — 더 가까우면 빛 무늬가 한 칸보다 작아져 '한 칸이 받는 빛의 양'과 맞지 않음
export const D_MIN = 6, D_MAX = 30, D_STEP = 0.5, D_ONE = 6; // 6 cm에서 빛 무늬 한 변 = 1칸
const Y0 = 8;          // 빛다발 중심 높이 (cm)
const CUP = 4;         // 종이컵 길이 (cm)
const GRID_N = 7;      // 모눈 7×7칸
// 휴대 전화 전등(점광원)은 모눈의 한 꼭짓점(왼쪽 아래에서 한 칸 안쪽) 바로 앞에 있음 → 빛이 종이컵 바닥의 정사각형 구멍을 지나
// 그 꼭짓점에서 위·오른쪽으로 커지는 빛 무늬를 만듦. 거리 d = 전등(점광원) ~ 모눈종이
const CORNER = -2.5;   // 모눈종이 가운데에서 그 꼭짓점까지 (cm, 가로·세로)
const PY = Y0 - CORNER, PZ = -CORNER; // 모눈종이 가운데 위치 (y, z)

export const sideOf = d => d / D_ONE;                 // 빛 무늬 한 변 (칸)
export const cellsOf = d => (d / D_ONE) ** 2;         // 빛을 받는 넓이 (칸)
export const brightOf = d => (D_ONE / d) ** 2;        // 한 칸 밝기 (1칸일 때 = 1)

const VIEWS = {
  main: { pos: [-38, 30, 50], target: [-15, 5, 2] },   // 30 cm 끝(휴대 전화 이름표)까지 화면 안에
  front: { pos: [-44, 17, 12], target: [0, 10, 2] },
  side: { pos: [-15, 9, 50], target: [-15, 7, 0] },
};

function rulerTexture() {
  const W = 2048, H = 160, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#f3e2a9'); grad.addColorStop(1, '#e2c983');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const x0 = -31.4, span = 31.4; // 자: x = -31.4 ~ 0 cm (0 눈금이 모눈종이 면)
  const px = xw => Math.min(W - 2, ((xw - x0) / span) * W);
  g.strokeStyle = '#2a2116'; g.fillStyle = '#2a2116';
  for (let mm = 0; mm <= 300; mm++) {
    const x = px(-mm / 10);
    const len = mm % 50 === 0 ? 62 : mm % 10 === 0 ? 46 : mm % 5 === 0 ? 32 : 20;
    g.lineWidth = mm % 10 === 0 ? 3.5 : 2;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, len); g.stroke();
    if (mm % 10 === 0) {
      g.font = `bold ${mm % 50 === 0 ? 46 : 34}px sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(String(mm / 10), x, mm % 50 === 0 ? 72 : 60);
    }
  }
  g.font = 'bold 30px sans-serif'; g.textAlign = 'left';
  g.fillText('cm', px(-30.9) , 108);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function gridTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#7fcf8a'; g.fillRect(0, 0, S, S);
  const m = S * 0.4 / 7.8, cell = (S - 2 * m) / GRID_N;
  g.strokeStyle = 'rgba(20,80,40,0.35)'; g.lineWidth = 2;
  for (let i = 0; i <= GRID_N * 5; i++) {
    const p = m + (i * cell) / 5;
    g.beginPath(); g.moveTo(p, m); g.lineTo(p, S - m); g.stroke();
    g.beginPath(); g.moveTo(m, p); g.lineTo(S - m, p); g.stroke();
  }
  g.strokeStyle = '#1b5e30'; g.lineWidth = 6;
  for (let i = 0; i <= GRID_N; i++) {
    const p = m + i * cell;
    g.beginPath(); g.moveTo(p, m); g.lineTo(p, S - m); g.stroke();
    g.beginPath(); g.moveTo(m, p); g.lineTo(S - m, p); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function makeLabel(html, cls = 'l3d') {
  const el = document.createElement('div');
  el.className = cls; el.innerHTML = html;
  return new CSS2DObject(el);
}

export function createLamp(wrap, { onDrag, onDragStart, onDragEnd, onOrbit, isLocked }) {
  // 렌더러 — 품질 '낮음'에서는 안티에일리어싱을 끈 새 렌더러로 바꿈(만들 때만 정할 수 있음)
  let renderer = null, rendererAA = null;
  function buildRenderer(aa) {
    if (renderer && rendererAA === aa) return;
    if (renderer) {
      renderer.domElement.remove();
      renderer.dispose(); renderer.forceContextLoss();
    }
    renderer = new THREE.WebGLRenderer({ antialias: aa, powerPreference: aa ? 'default' : 'low-power' });
    rendererAA = aa;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;   // 그림자는 물체가 움직일 때만 다시 계산(카메라 회전 때는 그대로)
    wrap.insertBefore(renderer.domElement, wrap.firstChild);
  }
  buildRenderer(true);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'label-layer';
  wrap.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d1424');
  const fog = new THREE.Fog('#0d1424', 90, 170);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
  camera.position.set(...VIEWS.main.pos);
  // 끌기·회전은 캔버스를 감싼 상자에서 받음 → 렌더러를 바꿔도 조작이 그대로 이어짐
  // (휴대 전화 끌기 처리를 OrbitControls보다 먼저 받도록 capture 단계에 등록)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = new THREE.Vector3();
  let dragging = false, grabOffset = 0, pid = null;
  const el = wrap;
  el.addEventListener('pointerdown', e => onDown(e), { capture: true });
  const controls = new OrbitControls(camera, el);
  controls.target.set(...VIEWS.main.target);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 18; controls.maxDistance = 85;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = false;
  controls.update();
  let dirty = true;                       // 장면이 바뀌었을 때만 다시 그림
  controls.addEventListener('change', () => { dirty = true; });
  // 손으로 카메라를 돌리거나 확대하면 시점 버튼 눌림 해제
  controls.addEventListener('start', () => { tween = null; onOrbit && onOrbit(); });

  // 조명 (어둑한 실험실)
  scene.add(new THREE.HemisphereLight('#bcd2ff', '#3a2c20', 0.55));
  const key = new THREE.DirectionalLight('#fff1dc', 1.6);
  key.position.set(-20, 45, 25);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -40, right: 15, top: 25, bottom: -25, near: 5, far: 120 });
  key.shadow.bias = -0.0008; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#8fb4ff', 0.35);
  fill.position.set(20, 15, -30);
  scene.add(fill);

  // 실험대
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(90, 3, 44),
    new THREE.MeshStandardMaterial({ color: '#6b5440', roughness: 0.75 })
  );
  table.position.set(-14, -1.5, 2);
  table.receiveShadow = true;
  scene.add(table);

  // 자 (레일) — 모눈종이(x=0)에서 시작해 왼쪽으로 0~30 cm
  const ruler = new THREE.Mesh(
    new THREE.BoxGeometry(31.4, 0.3, 3.6),
    [null, null, new THREE.MeshStandardMaterial({ map: rulerTexture(), roughness: 0.6 }), null, null, null]
      .map(m => m || new THREE.MeshStandardMaterial({ color: '#cfb46c', roughness: 0.6 }))
  );
  ruler.position.set(-15.7, 0.15, 5.6);
  ruler.receiveShadow = true;
  scene.add(ruler);
  // 레일 홈 (휴대 전화 받침이 미끄러지는 길)
  const track = new THREE.Mesh(
    new THREE.BoxGeometry(34, 0.25, 2.2),
    new THREE.MeshStandardMaterial({ color: '#2b3342', metalness: 0.5, roughness: 0.4 })
  );
  track.position.set(-16, 0.13, 0);
  track.receiveShadow = true;
  scene.add(track);

  // 모눈종이 판
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 12, 12),
    new THREE.MeshStandardMaterial({ color: '#e8ece6', roughness: 0.9 })
  );
  board.position.set(0.3, PY, PZ);
  board.castShadow = true; board.receiveShadow = true;
  scene.add(board);
  const foot = new THREE.Mesh(
    new THREE.BoxGeometry(5, 1.5, 12),
    new THREE.MeshStandardMaterial({ color: '#5d6675', roughness: 0.7 })
  );
  foot.position.set(2.6, 0.75, PZ);
  foot.castShadow = true; foot.receiveShadow = true;
  scene.add(foot);
  const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 3), foot.material);
  post.position.set(1.1, 2.2, PZ); post.scale.y = 1.6; scene.add(post);

  const PAPER = 7.8;
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(PAPER, PAPER),
    new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.95 })
  );
  paper.rotation.y = -Math.PI / 2;
  paper.position.set(0.04, PY, PZ);
  paper.receiveShadow = true;
  scene.add(paper);

  // 빛 무늬 (모눈종이 위) — 가장자리 흐림이 있는 정사각형
  const spotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uS: { value: 1 }, uC: { value: CORNER }, uBlur: { value: 0.05 }, uI: { value: 1 }, uColor: { value: new THREE.Color('#fff2c2') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec2 vUv; uniform float uS, uC, uBlur, uI; uniform vec3 uColor;
      void main(){
        vec2 p = (vUv - 0.5) * ${PAPER.toFixed(1)} - vec2(uC + uS * 0.5);
        float h = uS * 0.5;
        float mx = 1.0 - smoothstep(h - uBlur, h + uBlur, abs(p.x));
        float my = 1.0 - smoothstep(h - uBlur, h + uBlur, abs(p.y));
        float m = mx * my;
        gl_FragColor = vec4(uColor * uI * m, m);
      }`,
  });
  const spot = new THREE.Mesh(new THREE.PlaneGeometry(PAPER, PAPER), spotMat);
  spot.rotation.y = -Math.PI / 2;
  spot.position.set(-0.01, PY, PZ);
  scene.add(spot);

  // 칸에 딱 맞을 때 초록 테두리
  const okGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 1),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0)]);
  const okLine = new THREE.Line(okGeo, new THREE.LineBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.75 }));
  okLine.position.set(-0.05, Y0, 0); // 꼭짓점(전등 바로 앞)에서 시작
  scene.add(okLine);

  // 빛다발 (사각뿔)
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
  const beamMat = new THREE.MeshBasicMaterial({
    color: '#ffe9a6', transparent: true, opacity: 0.13, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
  const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.55 }));
  const beamGroup = new THREE.Group();
  beamGroup.add(beam, edges);
  scene.add(beamGroup);

  // 휴대 전화 + 종이컵 (원점 = 휴대 전화 전등 = 점광원, x방향으로 빛이 나감)
  // 종이컵 입구(넓은 쪽)는 전화에 붙고, 바닥(좁은 쪽, x = CUP)에 정사각형 구멍 — 구멍 한 변 = CUP/6 → 빛 무늬 한 변 = d/6
  const phone = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.85 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.8, CUP, 40, 1, true), black);
  cup.rotation.z = -Math.PI / 2;
  cup.position.set(CUP / 2, Y0, 0);
  cup.castShadow = true;
  const cap = new THREE.Mesh(new THREE.CircleGeometry(2.0, 40), black);
  cap.rotation.y = Math.PI / 2; cap.position.set(CUP, Y0, 0);
  const HOLE = CUP / D_ONE;
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(HOLE, HOLE), new THREE.MeshBasicMaterial({ color: '#fff8dc' }));
  hole.rotation.y = Math.PI / 2; hole.position.set(CUP + 0.02, Y0 + HOLE / 2, HOLE / 2);
  // 전등(점광원) — 전화 앞면의 작은 LED
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: '#fffbe6' }));
  led.position.set(0.05, Y0, 0);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 7),
    new THREE.MeshStandardMaterial({ color: '#3b4252', metalness: 0.4, roughness: 0.35 }));
  body.position.set(-0.4, Y0, 0); body.castShadow = true;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 13),
    new THREE.MeshStandardMaterial({ color: '#0b1730', emissive: '#16305e', emissiveIntensity: 0.6, roughness: 0.2 }));
  screen.rotation.y = -Math.PI / 2; screen.position.set(-0.81, Y0, 0);
  const sled = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 5.2),
    new THREE.MeshStandardMaterial({ color: '#4f8fd6', roughness: 0.5 }));
  sled.position.set(-0.4, 0.75, 0); sled.castShadow = true;
  const clip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 7.4), sled.material);
  clip.position.set(-0.4, 1.6, 0); clip.castShadow = true;
  // 자 읽는 눈금 바늘 (전등 = 점광원 위치)
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 5.6), new THREE.MeshBasicMaterial({ color: '#ff4d4d' }));
  needle.position.set(0, 0.38, 4.6);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 2.2), new THREE.MeshStandardMaterial({ color: '#ff4d4d' }));
  arm.position.set(0, 0.4, 2.7);
  phone.add(cup, cap, hole, led, body, screen, sled, clip, needle, arm);
  scene.add(phone);
  const pickables = [cup, cap, body, screen, sled, clip, hole];

  // 거리 표시 (치수선)
  const dimGeo = new THREE.BufferGeometry();
  dimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
  const dim = new THREE.LineSegments(dimGeo, new THREE.LineBasicMaterial({ color: '#9fd0ff' }));
  scene.add(dim);
  const dimLabel = makeLabel('', 'l3d dimlbl');
  scene.add(dimLabel);

  const lblPaper = makeLabel('모눈종이');
  lblPaper.position.set(0.5, PY + 7, PZ); scene.add(lblPaper);
  const lblPhone = makeLabel('휴대 전화 + 종이컵<br><small>👆 끌어서 움직이기</small>');
  phone.add(lblPhone); lblPhone.position.set(-0.4, Y0 + 8.6, 0);
  const lblLed = makeLabel('💡 전등(점광원)', 'l3d ledlbl');
  phone.add(lblLed); lblLed.position.set(0, Y0 + 3.4, 0);
  const lblRuler = makeLabel('자 (cm)');
  lblRuler.position.set(-29, 0.6, 9); scene.add(lblRuler);

  scene.traverse(o => { if (o.isMesh) o.userData.cast = o.castShadow; });

  // 상태
  let d = 10, beamOn = true, quality = 'high', okGlow = 0, w = 1, h = 1;
  let view = 'main', tween = null;

  function update() {
    const s = sideOf(d), B = brightOf(d);
    phone.position.x = -d;
    spotMat.uniforms.uS.value = s;
    spotMat.uniforms.uBlur.value = 0.02 + d * 0.004;
    spotMat.uniforms.uI.value = 0.95 * Math.pow(Math.min(B, 2), 0.5);
    // 사각뿔
    const a = [-d, Y0, 0];
    const c = [[0, Y0, 0], [0, Y0, s], [0, Y0 + s, s], [0, Y0 + s, 0]];
    const P = beamGeo.attributes.position.array;
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4];
      P.set([...a, ...p, ...q], i * 9);
    }
    beamGeo.attributes.position.needsUpdate = true; beamGeo.computeBoundingSphere();
    const E = edgeGeo.attributes.position.array;
    for (let i = 0; i < 4; i++) E.set([...a, ...c[i]], i * 6);
    edgeGeo.attributes.position.needsUpdate = true; edgeGeo.computeBoundingSphere();
    beamMat.opacity = 0.05 + 0.1 * Math.min(1, Math.sqrt(B));
    // 치수선 (전등 ~ 모눈종이, 종이컵 아래)
    const yy = Y0 - 3.3, D = dimGeo.attributes.position.array;
    D.set([-d, yy, 0, 0, yy, 0, -d, yy - 0.7, 0, -d, yy + 0.7, 0, 0, yy - 0.7, 0, 0, yy + 0.7, 0]);
    dimGeo.attributes.position.needsUpdate = true; dimGeo.computeBoundingSphere();
    dimLabel.position.set(-d / 2, yy - 1.6, 0);
    dimLabel.element.textContent = `${d.toFixed(1)} cm`;
    // 테두리
    okLine.scale.set(1, s, s);
    const exact = Math.abs(s - Math.round(s)) < 1e-6;
    okLine.visible = exact;
    if (renderer) renderer.shadowMap.needsUpdate = true;
    dirty = true;
  }

  function setDistance(v) { d = clamp(v, D_MIN, D_MAX); update(); }
  function flashExact() { okGlow = 1; dirty = true; }
  function setBeam(on) { beamOn = on; applyQuality(); dirty = true; }
  // 품질 '낮음'용 가벼운 재질: PBR(MeshStandard) → Lambert(정점 단위 조명), 같은 색·무늬
  const loCache = new Map();
  function loMat(m) {
    if (!m.isMeshStandardMaterial) return m;
    if (!loCache.has(m)) {
      const L = new THREE.MeshLambertMaterial({ color: m.color, map: m.map || null });
      if (m.emissive) { L.emissive.copy(m.emissive); L.emissiveIntensity = m.emissiveIntensity; }
      loCache.set(m, L);
    }
    return loCache.get(m);
  }
  scene.traverse(o => { if (o.isMesh) o.userData.hiMat = o.material; });
  function applyQuality(q = quality) {
    quality = q;
    const high = q === 'high';
    buildRenderer(high);
    // 렌더 해상도: 높음은 화면 배율 최대 1.5, 낮음은 0.75배로 그린 뒤 늘려 보여 줌(그리는 픽셀 수 약 0.56배)
    renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 1.5) : 0.75);
    renderer.shadowMap.enabled = high;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = high ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    key.castShadow = high;
    scene.fog = high ? fog : null;
    scene.traverse(o => {
      if (!o.isMesh || !o.userData.hiMat) return;
      const hm = o.userData.hiMat;
      o.material = high ? hm : Array.isArray(hm) ? hm.map(loMat) : loMat(hm);
      o.castShadow = high && !!o.userData.cast;
    });
    scene.traverse(o => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      ms.forEach(m => { m.needsUpdate = true; });
    });
    beamGroup.visible = beamOn;
    beam.visible = high;           // 낮은 품질: 반투명 면은 끄고 모서리 선만
    resize();
  }

  function setView(name) {
    const v = VIEWS[name]; if (!v) return;
    dirty = true;
    view = name;
    tween = {
      t: 0, fromPos: camera.position.clone(), toPos: new THREE.Vector3(...v.pos),
      fromT: controls.target.clone(), toT: new THREE.Vector3(...v.target),
    };
  }

  function resize() {
    w = Math.max(1, wrap.clientWidth); h = Math.max(1, wrap.clientHeight);
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    // 좁은(세로) 화면에서는 시야를 넓혀 장면이 잘리지 않게
    camera.fov = camera.aspect < 1.2 ? 50 : 38;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  // 끌기
  function setNdc(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function dragPlane() {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const n = new THREE.Vector3(0, dir.y, dir.z);
    if (n.lengthSq() < 0.05) n.set(0, 1, 0);
    n.normalize();
    plane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(0, Y0, 0));
  }
  function onDown(e) {
    if (isLocked()) { e.stopPropagation(); return; }
    if (e.target !== renderer.domElement) return;
    setNdc(e);
    if (ray.intersectObjects(pickables, false).length) {
      dragPlane();
      if (!ray.ray.intersectPlane(plane, hit)) return;
      dragging = true; pid = e.pointerId;
      grabOffset = hit.x - (-d);
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
      onDragStart && onDragStart();
      e.preventDefault();
      e.stopPropagation();        // 카메라 회전은 시작하지 않음
    }
  }
  el.addEventListener('pointermove', e => {
    if (dragging && e.pointerId === pid) {
      setNdc(e);
      if (ray.ray.intersectPlane(plane, hit)) {
        const raw = -(hit.x - grabOffset);
        const v = clamp(Math.round(raw / D_STEP) * D_STEP, D_MIN, D_MAX);
        if (v !== d) onDrag(v);
      }
    } else if (e.pointerType === 'mouse') {
      setNdc(e);
      el.style.cursor = ray.intersectObjects(pickables, false).length ? 'grab' : '';
    }
  });
  const end = e => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false; el.style.cursor = '';
    onDragEnd && onDragEnd();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  function render(dt) {
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 0.9);
      const k = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - Math.pow(-2 * tween.t + 2, 3) / 2;
      camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
      controls.target.lerpVectors(tween.fromT, tween.toT, k);
      if (tween.t >= 1) tween = null;
      dirty = true;
    }
    controls.update();             // 'change'가 나면 dirty
    if (okLine.visible && okGlow > 0) {
      okGlow = Math.max(0, okGlow - dt * 0.8);
      okLine.material.opacity = 0.75 + 0.25 * okGlow;
      dirty = true;
    }
    if (!dirty) return false;      // 바뀐 것이 없으면 그리지 않음 (저사양 크롬북 배려)
    dirty = false;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    return true;
  }

  function cancelDrag() { dragging = false; el.style.cursor = ''; }
  function invalidate() { dirty = true; }

  update();
  resize();
  return { setDistance, setBeam, setView, applyQuality, resize, render, flashExact, cancelDrag, invalidate, get view() { return view; } };
}
