// ① 물결 연못 — Three.js 연못 + 높이장 물결 + 제자리에서 진동하는 오리·나뭇잎
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sound } from '../../lib/sound.js';
import { clamp, damp, ease } from '../../lib/utils.js';
import { Wave2D, POND_R, STEP } from './wave2d.js';

const VSCALE = 0.028;                // 수면 높이 1 cm → 화면 0.028 (보기 쉽게 약 3배 키움)
const STRENGTH = { 1: 6, 2: 12, 3: 18 };   // 물결 세기 → 파원 진폭 (cm, 모형 값)
const STRENGTH_NAME = { 1: '약하게', 2: '보통', 3: '세게' };
const DUCK_HOME = new THREE.Vector3(0.42, 0, 0.05);
const LEAF_HOME = new THREE.Vector3(-0.56, 0, 0.3);
const CAM_HOME = new THREE.Vector3(0.15, 1.35, 1.75);
const LEAF_TH = 0.1;                 // 나뭇잎이 '흔들린다'고 보는 높이 (cm)
const TRAIL_SEC = 3;

export class Pond {
  constructor({ onChange, isLocked }) {
    this.onChange = onChange;        // 기록 값이 바뀌면 부르는 함수
    this.isLocked = isLocked;
    this.wrap = document.getElementById('pondCanvas');
    this.labels = document.getElementById('pondLabels');
    this.quality = 'high';
    this.playing = true;
    this.slow = false;
    this.active = true;
    this.time = 0;                   // 연못 시간 (초)
    this.acc = 0;
    this.strength = 2;
    this.rain = false;
    this.rainNext = 0;
    this.showTrail = false;
    this.showDots = false;
    this.drops = [];                 // 떨어지는 중인 물방울
    this.tags = [];                  // 잠깐 뜨는 라벨
    this.lastSrc = new THREE.Vector3(0, 0, 0);
    this.rec = { dropCount: 0, duckSideShiftCm: 0, leafWaveArrived: false, trailViewed: false };
    this.duckH = 0;
    this.leafState = 'calm';         // calm | arrive | move
    this.leafActiveAt = -99; this.leafArriveAt = -99;
    this.graph = [];                 // [t, 오리 높이 cm]
    this.dirty = true;
    this.fps = { n: 0, t: 0, done: false };

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xcfe8f0);
    this.scene.fog = new THREE.Fog(0xcfe8f0, 5, 11);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    this.camera.position.copy(CAM_HOME);
    this.buildRenderer();
    this.controls = new OrbitControls(this.camera, this.wrap);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, enablePan: false, minDistance: 0.9, maxDistance: 3.6, minPolarAngle: 0.15, maxPolarAngle: 1.32 });
    this.controls.target.set(0, -0.05, 0.05);
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.controls.update();

    this.buildWorld();
    this.setGrid(160);
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    this.resize();
  }

  // ───────── 렌더러 (품질을 바꾸면 새로 만듦: 안티에일리어싱은 만들 때만 정할 수 있음) ─────────
  buildRenderer() {
    const hi = this.quality === 'high';
    if (this.renderer) { this.renderer.domElement.remove(); this.renderer.dispose(); }
    const r = new THREE.WebGLRenderer({ antialias: hi, powerPreference: 'high-performance' });
    r.setPixelRatio(hi ? Math.min(devicePixelRatio, 2) : 1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = hi;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.wrap.appendChild(r.domElement);
    this.renderer = r;
    // 하늘빛 환경맵 (물 표면 반사용)
    const sky = new THREE.Scene();
    const g = new THREE.SphereGeometry(10, 32, 16);
    const col = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 10;
      const c = y > 0 ? new THREE.Color(0xeaf6ff).lerp(new THREE.Color(0x5aa6e0), Math.pow(y, 0.6)) : new THREE.Color(0x7fae6a).lerp(new THREE.Color(0x3d6b35), -y);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sky.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pm = new THREE.PMREMGenerator(r);
    if (this.envTex) this.envTex.dispose();
    this.envTex = pm.fromScene(sky, 0.02).texture;
    this.scene.environment = this.envTex;
    pm.dispose();
    this.dirty = true;
  }

  buildWorld() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xdff2ff, 0x5c7a3a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
    sun.position.set(1.6, 3.2, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 8 });
    sun.shadow.bias = -0.0008;
    S.add(sun);
    this.sun = sun;

    // 땅 (연못 둘레 풀밭)
    const ground = new THREE.Mesh(new THREE.RingGeometry(POND_R * 0.99, 7, 96, 1),
      new THREE.MeshStandardMaterial({ color: 0x7fb85a, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0.035; ground.receiveShadow = true;
    S.add(ground);
    // 연못 둑과 바닥
    const bank = new THREE.Mesh(new THREE.CylinderGeometry(POND_R, POND_R * 0.9, 0.3, 96, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 1, side: THREE.BackSide }));
    bank.position.y = -0.115; S.add(bank);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(POND_R * 0.92, 64),
      new THREE.MeshStandardMaterial({ color: 0x8d7b55, roughness: 1 }));
    bottom.rotation.x = -Math.PI / 2; bottom.position.y = -0.26; bottom.receiveShadow = true;
    S.add(bottom);
    // 바닥 자갈
    const pebG = new THREE.IcosahedronGeometry(1, 0);
    const pebM = new THREE.MeshStandardMaterial({ color: 0x9c9384, roughness: 1, flatShading: true });
    const peb = new THREE.InstancedMesh(pebG, pebM, 40);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 0.85;
      ps.set(Math.cos(a) * rr, -0.255, Math.sin(a) * rr);
      const s = 0.015 + rnd() * 0.03; sc.set(s, s * 0.5, s * 1.2);
      q.setFromEuler(new THREE.Euler(0, rnd() * 3, 0));
      peb.setMatrixAt(i, m4.compose(ps, q, sc));
    }
    S.add(peb);

    // 가장자리 돌
    const stoneM = new THREE.MeshStandardMaterial({ color: 0xa39e93, roughness: 0.9, flatShading: true });
    const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), stoneM, 34);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + rnd() * 0.08;
      const rr = POND_R + 0.03 + rnd() * 0.05;
      ps.set(Math.cos(a) * rr, 0.02, Math.sin(a) * rr);
      const s = 0.06 + rnd() * 0.05; sc.set(s * 1.3, s * 0.65, s);
      q.setFromEuler(new THREE.Euler(rnd() * 0.5, -a + rnd(), rnd() * 0.4));
      stones.setMatrixAt(i, m4.compose(ps, q, sc));
    }
    stones.castShadow = true; stones.receiveShadow = true;
    S.add(stones);

    // 풀 (저다각형 원뿔 무더기)
    const grassM = new THREE.MeshStandardMaterial({ color: 0x4f9a3a, roughness: 0.9, flatShading: true });
    const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.018, 1, 4), grassM, 260);
    for (let i = 0; i < 260; i++) {
      const clump = Math.floor(i / 10), a0 = clump * 2.399 + 0.3;
      const a = a0 + (rnd() - 0.5) * 0.12, rr = POND_R + 0.14 + (clump % 4) * 0.12 + rnd() * 0.08;
      const hgt = 0.08 + rnd() * 0.12;
      ps.set(Math.cos(a) * rr, 0.035 + hgt / 2, Math.sin(a) * rr);
      sc.set(1, hgt, 1);
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.5, 0, (rnd() - 0.5) * 0.5));
      grass.setMatrixAt(i, m4.compose(ps, q, sc));
    }
    grass.castShadow = true;
    S.add(grass);

    // 연잎 (가장자리 흡수 띠 쪽에 떠 있음)
    this.pads = [];
    const padM = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.6, side: THREE.DoubleSide });
    [[0.1, 0.82, 0.13], [0.55, 0.7, 0.1], [-0.75, -0.45, 0.12], [-0.2, -0.82, 0.09]].forEach(([x, z, r], i) => {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 24, 0.35, Math.PI * 2 - 0.35), padM);
      pad.rotation.x = -Math.PI / 2; pad.rotation.z = i * 1.7;
      pad.position.set(x, 0.004, z); pad.receiveShadow = true;
      S.add(pad); this.pads.push(pad);
      if (i === 0) { // 연꽃 하나
        const fl = new THREE.Group();
        const petM = new THREE.MeshStandardMaterial({ color: 0xf7b6cf, roughness: 0.5, flatShading: true });
        for (let k = 0; k < 6; k++) {
          const pet = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4), petM);
          pet.position.set(Math.cos(k) * 0.018, 0.025, Math.sin(k) * 0.018);
          pet.rotation.set(Math.sin(k) * 0.5, 0, -Math.cos(k) * 0.5);
          fl.add(pet);
        }
        fl.position.set(x + 0.02, 0.01, z - 0.02); fl.castShadow = true;
        S.add(fl); this.flower = fl;
      }
    });

    // 오리
    this.duck = this.makeDuck();
    this.duck.position.copy(DUCK_HOME);
    this.duckAnchor = DUCK_HOME.clone();
    S.add(this.duck);
    // 나뭇잎
    this.leaf = this.makeLeaf();
    this.leaf.position.copy(LEAF_HOME);
    this.leafAnchor = LEAF_HOME.clone();
    S.add(this.leaf);

    // 물 알갱이 20개
    this.dotPos = [];
    for (let i = 0; i < 20; i++) {
      const a = i * 2.399 + 0.4, rr = 0.16 + 0.62 * Math.sqrt((i + 0.5) / 20);
      this.dotPos.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x666666 }), 20);
    this.dots.visible = false;
    S.add(this.dots);

    // 흔적 (오리·나뭇잎 옆 세로선) + 화살표
    this.trails = [this.makeTrail(0x183a66), this.makeTrail(0x1d4d1d)];
    this.trails.forEach(t => S.add(t.group));
    this.arrows = [this.makeArrows(), this.makeArrows()];
    this.arrows.forEach(a => S.add(a.group));

    // 떨어지는 물방울 모양
    this.dropGeo = new THREE.SphereGeometry(0.022, 16, 12);
    this.dropMat = new THREE.MeshStandardMaterial({ color: 0x9fdcff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.85 });
  }

  makeDuck() {
    const g = new THREE.Group();
    const yel = new THREE.MeshStandardMaterial({ color: 0xffd12e, roughness: 0.45 });
    const ora = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.5 });
    const blk = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), yel);
    body.scale.set(1.35, 0.8, 1); body.position.y = 0.025;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 12), yel);
    tail.position.set(0.075, 0.055, 0); tail.rotation.z = -1.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.038, 20, 14), yel);
    head.position.set(-0.05, 0.1, 0);
    const beak = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 10), ora);
    beak.scale.set(1.5, 0.5, 1); beak.position.set(-0.088, 0.093, 0);
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 8, 6), blk); e1.position.set(-0.075, 0.112, 0.022);
    const e2 = e1.clone(); e2.position.z = -0.022;
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf2bd18, roughness: 0.5 }));
    wing.scale.set(1.4, 0.6, 0.5); wing.position.set(0.012, 0.04, 0.05);
    const wing2 = wing.clone(); wing2.position.z = -0.05;
    [body, tail, head, beak, e1, e2, wing, wing2].forEach(m => { m.castShadow = true; g.add(m); });
    g.rotation.y = 0.5;
    g.userData.pick = true;
    const inner = new THREE.Group(); inner.add(g);
    inner.userData.body = g;
    return inner;
  }

  makeLeaf() {
    const s = new THREE.Shape();
    s.moveTo(-0.08, 0);
    s.quadraticCurveTo(-0.02, 0.055, 0.075, 0);
    s.quadraticCurveTo(-0.02, -0.055, -0.08, 0);
    const geo = new THREE.ShapeGeometry(s, 10);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6cb33f, roughness: 0.55, side: THREE.DoubleSide }));
    m.position.y = 0.004; m.castShadow = true;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.002, 0.004), new THREE.MeshStandardMaterial({ color: 0x3f7a22 }));
    rib.position.set(-0.005, 0.006, 0);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.04, 6), new THREE.MeshStandardMaterial({ color: 0x5a3e1f }));
    stem.rotation.z = Math.PI / 2; stem.position.set(-0.095, 0.006, 0);
    const g = new THREE.Group(); g.add(m, rib, stem); g.rotation.y = -0.7; g.scale.setScalar(1.4);
    const inner = new THREE.Group(); inner.add(g); inner.userData.body = g;
    return inner;
  }

  makeTrail(color) {
    const n = 200;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 4, sizeAttenuation: false }));
    const group = new THREE.Group(); group.add(line, pts); group.visible = false;
    return { group, geo, n, hist: [] };
  }

  makeArrows() {
    const group = new THREE.Group(); group.visible = false;
    const red = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.2, 0xe0332a, 0.05, 0.035);
    const up = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.08, 0x1aa34a, 0.03, 0.025);
    const dn = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.08, 0x1aa34a, 0.03, 0.025);
    group.add(red, up, dn);
    return { group, red, up, dn };
  }

  // ───────── 격자 (품질) ─────────
  setGrid(n) {
    const old = this.wave;
    this.wave = new Wave2D(n);
    if (old) { // 지금 물결을 새 격자로 옮김
      const w = this.wave;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -w.L + i * w.dx, z = -w.L + j * w.dx, id = j * n + i;
        if (!w.inside[id]) continue;
        w.cur[id] = old.heightAt(x, z);
        w.prev[id] = w.cur[id];
      }
      w.sources = old.sources;
    }
    if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); }
    const w = this.wave, N = n * n;
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let x = -w.L + i * w.dx, z = -w.L + j * w.dx;
      const r = Math.hypot(x, z);
      if (r > POND_R) { x *= POND_R / r; z *= POND_R / r; } // 가장자리 점은 원 위로 당겨 둥근 테두리
      const id = (j * n + i) * 3;
      pos[id] = x; pos[id + 2] = z; nor[id + 1] = 1;
    }
    const idx = [];
    const lim = POND_R + w.dx * 1.5;
    const inR = (i, j) => Math.hypot(-w.L + i * w.dx, -w.L + j * w.dx) < lim;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      if (!(inR(i, j) && inR(i + 1, j) && inR(i, j + 1) && inR(i + 1, j + 1))) continue;
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3).fill(1), 3));
    geo.setIndex(idx);
    if (!this.waterMat) this.waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a9cc0, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.8, envMapIntensity: 1.1, vertexColors: true,
      clearcoat: 0.6, clearcoatRoughness: 0.1,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.receiveShadow = true;
    this.scene.add(this.water);
    this.updateWaterMesh();
  }

  updateWaterMesh() {
    const w = this.wave, n = w.n, h = w.cur;
    const pos = this.water.geometry.attributes.position.array, nor = this.water.geometry.attributes.normal.array;
    const col = this.water.geometry.attributes.color.array;
    const k = VSCALE / (2 * w.dx);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const id = j * n + i, p = id * 3;
      pos[p + 1] = h[id] * VSCALE;
      const nx = -(h[id + 1] - h[id - 1]) * k, nz = -(h[id + n] - h[id - n]) * k;
      const l = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      nor[p] = nx * l; nor[p + 1] = l; nor[p + 2] = nz * l;
      // 마루는 밝게, 골은 어둡게 (물결 고리가 잘 보이도록)
      const b = 1 + clamp(h[id] * 0.16, -0.32, 0.32);
      col[p] = b; col[p + 1] = b; col[p + 2] = Math.min(1.25, b * 1.02);
    }
    this.water.geometry.attributes.position.needsUpdate = true;
    this.water.geometry.attributes.normal.needsUpdate = true;
    this.water.geometry.attributes.color.needsUpdate = true;
  }

  // ───────── 입력: 짧게 누르기 = 물방울, 끌기 = 돌려 보기, 오리·나뭇잎 끌기 = 옮기기 ─────────
  bindPointer() {
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();
    const toNdc = e => { const r = this.wrap.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, this.camera); };
    let down = null, drag = null;
    this.wrap.addEventListener('pointerdown', e => {
      if (this.isLocked()) { e.stopImmediatePropagation(); return; }
      toNdc(e);
      const hits = ray.intersectObjects([this.duck, this.leaf], true);
      if (hits.length) {
        let o = hits[0].object; while (o.parent && o !== this.duck && o !== this.leaf) o = o.parent;
        drag = { obj: o, id: e.pointerId };
        this.controls.enabled = false;
        this.wrap.setPointerCapture(e.pointerId);
        this.wrap.style.cursor = 'grabbing';
        sound.click();
        e.stopImmediatePropagation();
        return;
      }
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    }, { capture: true });
    this.wrap.addEventListener('pointermove', e => {
      if (drag && e.pointerId === drag.id) {
        toNdc(e);
        if (ray.ray.intersectPlane(plane, hitPoint)) {
          const r = Math.hypot(hitPoint.x, hitPoint.z), max = POND_R * 0.82;
          if (r > max) hitPoint.multiplyScalar(max / r);
          drag.obj.position.x = hitPoint.x; drag.obj.position.z = hitPoint.z;
          const anchor = drag.obj === this.duck ? this.duckAnchor : this.leafAnchor;
          anchor.set(hitPoint.x, 0, hitPoint.z);   // 끄는 동안 '놓은 자리'도 함께 옮김
          (drag.obj === this.duck ? this.trails[0] : this.trails[1]).hist.length = 0;
          this.dirty = true;
        }
        return;
      }
      if (!drag) {
        toNdc(e);
        const over = ray.intersectObjects([this.duck, this.leaf], true).length > 0;
        this.wrap.style.cursor = over ? 'grab' : '';
      }
    });
    const up = e => {
      if (drag && e.pointerId === drag.id) {
        drag = null; this.controls.enabled = true; this.wrap.style.cursor = '';
        if (this.wrap.hasPointerCapture(e.pointerId)) this.wrap.releasePointerCapture(e.pointerId);
        sound.soft(); this.onChange();
        return;
      }
      if (down && e.pointerId === down.id && e.type === 'pointerup') {
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
        if (moved < 7 && dt < 450 && !this.isLocked()) {
          toNdc(e);
          if (ray.ray.intersectPlane(plane, hitPoint) && Math.hypot(hitPoint.x, hitPoint.z) < POND_R * 0.95) this.dropAt(hitPoint.x, hitPoint.z);
        }
      }
      down = null;
    };
    this.wrap.addEventListener('pointerup', up);
    this.wrap.addEventListener('pointercancel', up);
  }

  // ───────── 조작 ─────────
  dropAt(x, z) {
    const mesh = new THREE.Mesh(this.dropGeo, this.dropMat);
    mesh.scale.set(1, 1.35, 1);
    mesh.position.set(x, 0.55, z);
    mesh.castShadow = this.quality === 'high';
    this.scene.add(mesh);
    this.drops.push({ mesh, x, z, t: 0 });
    this.dirty = true;
  }
  dropCenter() { this.dropAt(0, 0); }

  land(d) {
    this.scene.remove(d.mesh);
    this.wave.drop(d.x, d.z, STRENGTH[this.strength]);
    this.lastSrc.set(d.x, 0, d.z);
    sound.bubble();
    this.rec.dropCount++;
    this.addTag('파원', new THREE.Vector3(d.x, 0.02, d.z), 'src', 1.5);
    document.getElementById('pondDropCount').textContent = `물방울 ${this.rec.dropCount}번`;
    this.onChange();
  }

  addTag(text, pos, cls, life) {
    const el = document.createElement('div');
    el.className = 'tag3d ' + cls; el.textContent = text;
    this.labels.appendChild(el);
    const tag = { el, pos: pos.clone(), life, age: 0, follow: null };
    this.tags.push(tag);
    return tag;
  }

  setStrength(v) { this.strength = v; document.getElementById('strengthOut').textContent = STRENGTH_NAME[v]; }
  strengthName() { return STRENGTH_NAME[this.strength]; }

  setRain(on) { this.rain = on; this.rainNext = this.time; }

  setTrail(on) {
    this.showTrail = on;
    if (on) this.rec.trailViewed = true;
    this.trails.forEach(t => { t.group.visible = on; });
    this.arrows.forEach(a => { a.group.visible = on; });
    this.dirty = true;
    this.onChange();
  }

  setDots(on) { this.showDots = on; this.dots.visible = on; this.dirty = true; }

  calm() {
    this.wave.clear();
    this.drops.forEach(d => this.scene.remove(d.mesh));
    this.drops = [];
    this.rain = false;
    this.trails.forEach(t => { t.hist.length = 0; });
    this.leafState = 'calm';
    this.dirty = true;
  }

  resetView() {
    this.camera.position.copy(CAM_HOME);
    this.controls.target.set(0, -0.05, 0.05);
    this.controls.update();
    this.dirty = true;
  }

  // 화면·설정만 처음으로 (기록 값은 유지)
  reset() {
    this.calm();
    this.duck.position.copy(DUCK_HOME); this.duckAnchor.copy(DUCK_HOME);
    this.leaf.position.copy(LEAF_HOME); this.leafAnchor.copy(LEAF_HOME);
    this.setStrength(2);
    this.setTrail(false);
    this.setDots(false);
    this.playing = true; this.slow = false;
    this.graph = [];
    this.tags.forEach(t => t.el.remove()); this.tags = [];
    this.resetView();
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.buildRenderer();
    this.setGrid(q === 'high' ? 160 : 80);
    this.resize();
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    // 세로로 좁은 화면이면 조금 더 멀리서 봄
    this.camera.fov = r.width / r.height < 1.1 ? 50 : 42;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  // ───────── 매 프레임 ─────────
  update(realDt) {
    if (!this.active) return;
    this.controls.update();
    const dt = this.playing ? Math.min(realDt, 0.05) * (this.slow ? 0.25 : 1) : 0;
    if (dt > 0) {
      this.time += dt;
      // 계속 떨어뜨리기: 1초에 한 방울 (연못 가운데)
      if (this.rain && this.time >= this.rainNext) { this.dropCenter(); this.rainNext = this.time + 1; }
      // 떨어지는 물방울 (0.3초, 점점 빨라짐)
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        d.t += dt;
        const k = clamp(d.t / 0.3, 0, 1);
        d.mesh.position.y = 0.55 * (1 - k * k);
        if (k >= 1) { this.drops.splice(i, 1); this.land(d); }
      }
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) { this.wave.step(); this.acc -= STEP; steps++; }
      if (steps === 8) this.acc = 0;
    }
    const w = this.wave;
    const moving = w.energy > 2e-5 || w.sources.length > 0 || this.drops.length > 0;
    if (moving) this.dirty = true;

    // 오리·나뭇잎: 수면 높이만 따라감 (옆으로는 절대 안 움직임)
    this.floatOn(this.duck, 0.004);
    this.floatOn(this.leaf, 0.0);
    this.duckH = w.heightAt(this.duck.position.x, this.duck.position.z);
    const shift = Math.hypot(this.duck.position.x - this.duckAnchor.x, this.duck.position.z - this.duckAnchor.z) * 100;
    this.rec.duckSideShiftCm = Math.max(this.rec.duckSideShiftCm, shift);
    for (const p of this.pads) p.position.y = 0.004 + w.heightAt(p.position.x, p.position.z) * VSCALE;
    if (this.flower) this.flower.position.y = 0.01 + w.heightAt(this.pads[0].position.x, this.pads[0].position.z) * VSCALE;

    // 나뭇잎 상태
    const leafH = Math.abs(w.heightAt(this.leaf.position.x, this.leaf.position.z));
    if (dt > 0) {
      if (leafH > LEAF_TH) {
        if (this.leafState === 'calm') {
          this.leafState = 'arrive'; this.leafArriveAt = this.time;
          sound.ding();
          const t = this.addTag('물결 도착!', this.leaf.position, 'arrive', 1.6);
          t.follow = this.leaf; t.dy = 0.09;
          if (!this.rec.leafWaveArrived) { this.rec.leafWaveArrived = true; this.onChange(); }
        }
        this.leafActiveAt = this.time;
      }
      if (this.leafState === 'arrive' && this.time - this.leafArriveAt > 1.5) this.leafState = 'move';
      if (this.leafState !== 'calm' && this.time - this.leafActiveAt > 1.6) this.leafState = 'calm';
    }

    // 물 알갱이
    if (this.showDots) {
      const m4 = new THREE.Matrix4();
      this.dotPos.forEach(([x, z], i) => { m4.makeTranslation(x, w.heightAt(x, z) * VSCALE + 0.006, z); this.dots.setMatrixAt(i, m4); });
      this.dots.instanceMatrix.needsUpdate = true;
    }

    // 흔적·화살표
    if (dt > 0) {
      [[this.duck, this.trails[0]], [this.leaf, this.trails[1]]].forEach(([o, tr]) => {
        tr.hist.push([this.time, o.position.y]);
        while (tr.hist.length && this.time - tr.hist[0][0] > TRAIL_SEC) tr.hist.shift();
        if (tr.hist.length > tr.n) tr.hist.splice(0, tr.hist.length - tr.n);
      });
      this.graph.push([this.time, this.duckH]);
      while (this.graph.length && this.time - this.graph[0][0] > 6.2) this.graph.shift();
    }
    if (this.showTrail) {
      const side = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).cross(new THREE.Vector3(0, 1, 0)).setY(0).normalize().multiplyScalar(-0.1);
      [[this.duck, this.trails[0], this.arrows[0], 0.06], [this.leaf, this.trails[1], this.arrows[1], 0.03]].forEach(([o, tr, ar, base]) => {
        const p = tr.geo.attributes.position.array;
        tr.hist.forEach(([, y], i) => { p[i * 3] = o.position.x + side.x; p[i * 3 + 1] = y + base; p[i * 3 + 2] = o.position.z + side.z; });
        tr.geo.attributes.position.needsUpdate = true;
        tr.geo.setDrawRange(0, tr.hist.length);
        tr.geo.computeBoundingSphere();
        // 빨간 화살표: 파원 → 이 물체 방향 (물결이 퍼지는 방향)
        const dir = new THREE.Vector3(o.position.x - this.lastSrc.x, 0, o.position.z - this.lastSrc.z);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
        dir.normalize();
        ar.red.setDirection(dir);
        ar.red.position.set(o.position.x - dir.x * 0.1, base + 0.16, o.position.z - dir.z * 0.1);
        ar.up.position.set(o.position.x - side.x, base + 0.02, o.position.z - side.z);
        ar.dn.position.copy(ar.up.position);
      });
    }

    // 잠깐 뜨는 라벨 + 흔적 라벨
    this.updateTags(dt, realDt);

    if (this.dirty) {
      this.updateWaterMesh();
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
      // 처음 1.5초 평균 fps가 48보다 낮으면 품질을 낮춤
      if (!this.fps.done) {
        this.fps.n++; this.fps.t += realDt;
        if (this.fps.t > 1.5) {
          this.fps.done = true;
          if (this.fps.n / this.fps.t < 48 && this.quality === 'high' && this.onLowFps) this.onLowFps();
        }
      }
    }
  }

  floatOn(o, base) {
    const x = o.position.x, z = o.position.z;
    const h = this.wave.heightAt(x, z);
    o.position.y = base + h * VSCALE;
    const [sx, sz] = this.wave.slopeAt(x, z);
    o.rotation.z = damp(o.rotation.z, clamp(sx * VSCALE, -0.35, 0.35), 12, 1 / 60);
    o.rotation.x = damp(o.rotation.x, clamp(-sz * VSCALE, -0.35, 0.35), 12, 1 / 60);
  }

  project(v) {
    const r = this.wrap.getBoundingClientRect();
    const p = v.clone().project(this.camera);
    return [(p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height, p.z < 1];
  }

  updateTags(dt, realDt) {
    for (let i = this.tags.length - 1; i >= 0; i--) {
      const t = this.tags[i];
      t.age += realDt;
      if (t.age > t.life) { t.el.remove(); this.tags.splice(i, 1); continue; }
      const pos = t.follow ? t.follow.position.clone().setY(t.follow.position.y + (t.dy || 0)) : t.pos.clone().setY(t.pos.y + 0.05);
      const [x, y, ok] = this.project(pos);
      t.el.style.left = x + 'px'; t.el.style.top = y + 'px';
      t.el.style.opacity = !ok ? 0 : t.age > t.life - 0.4 ? (t.life - t.age) / 0.4 : 1;
      this.dirty = true;
    }
    // 흔적 보기 라벨 (오리 옆)
    if (!this.trailTags) {
      this.trailTags = [this.addFixedTag('물결이 퍼지는 방향', 'small'), this.addFixedTag('오리가 움직이는 방향', 'small leaf')];
    }
    const [a, b] = this.trailTags;
    a.style.display = b.style.display = this.showTrail ? '' : 'none';
    if (this.showTrail) {
      const ar = this.arrows[0];
      const p1 = ar.red.position.clone().add(ar.red.getWorldDirection(new THREE.Vector3()).multiplyScalar(0));
      p1.y += 0.05;
      const [x1, y1] = this.project(p1);
      a.style.left = x1 + 'px'; a.style.top = y1 + 'px';
      const p2 = ar.dn.position.clone(); p2.y -= 0.1;
      const [x2, y2] = this.project(p2);
      b.style.left = x2 + 'px'; b.style.top = (y2 + 26) + 'px';
    }
  }

  addFixedTag(text, cls) {
    const el = document.createElement('div');
    el.className = 'tag3d ' + cls; el.textContent = text;
    this.labels.appendChild(el);
    return el;
  }

  leafText() { return { calm: '잔잔함', arrive: '물결 도착!', move: '흔들리는 중' }[this.leafState]; }
}
