// 우주에서 본 배치 — Three.js 3D (렌더러 1개, 바뀐 것이 있을 때만 그림)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { M, SHADOW_SLOPE } from './model.js';

const DEG = Math.PI / 180;
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// 진짜 크기 느낌: 태양을 멀리·크게 (지구에서 본 겉보기 크기가 달과 같아지도록)
const REAL_SUN_X = -60;
const REAL_SUN_R = M.moonR / M.orbitR * Math.abs(REAL_SUN_X);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 간단한 값 잡음 (지구 대륙·달 바다 무늬용)
function noise2(seed) {
  const g = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 64 * 32; i++) g.push(rnd());
  const at = (x, y) => g[((y & 31) * 64) + (x & 63)];
  return (u, v) => {
    const x = u * 64, y = v * 32, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function earthTexture() {
  return canvasTex(512, 256, (ctx, w, h) => {
    const n = noise2(7), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const e = n(u, v * 0.45) * 0.62 + n(u * 2 + 0.37, v * 0.9) * 0.28 + n(u * 4, v * 1.8) * 0.1;
      const lat = Math.abs(v - 0.5) * 2;
      let r, g, b;
      if (lat > 0.88) { r = 235; g = 240; b = 245; }
      else if (e > 0.56) { const k = Math.min(1, (e - 0.56) * 4); r = 62 + 80 * k; g = 128 - 8 * k; b = 58 + 10 * k; }
      else { const k = e / 0.55; r = 20 + 20 * k; g = 70 + 50 * k; b = 150 + 40 * k; }
      const i = (y * w + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

function moonTexture() {
  return canvasTex(512, 256, (ctx, w, h) => {
    const n = noise2(23), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const e = n(x / w, y / h * 0.6) * 0.7 + n(x / w * 4, y / h * 2.4) * 0.3;
      const c = e > 0.62 ? 120 : 175 + e * 50;
      const i = (y * w + x) * 4;
      img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c * 0.98; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    let s = 5;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 70; k++) {
      const x = rnd() * w, y = h * 0.1 + rnd() * h * 0.8, r = 2 + rnd() * 9;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80,80,80,0.35)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(220,220,220,0.18)'; ctx.fill();
    }
  });
}

function glowTexture() {
  return canvasTex(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,240,190,1)');
    g.addColorStop(0.25, 'rgba(255,210,110,0.55)');
    g.addColorStop(0.6, 'rgba(255,170,60,0.12)');
    g.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  });
}

// 표준 재질에 '그림자 속' 계산을 끼워 넣는다 (그림자 맵 없이 가볍게)
const VERT_HOOK = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
};

function makeLabel(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'lbl3d ' + cls;
  el.textContent = text;
  return new CSS2DObject(el);
}

export class Space {
  constructor(host, { onMoonDrag, onDragBlocked, quality = 'high' } = {}) {
    this.host = host;
    this.onMoonDrag = onMoonDrag;
    this.onDragBlocked = onDragBlocked;
    this.dirty = true;
    this.quality = quality;
    this.moonAngle = 0; this.moonH = 0;
    this.realT = 0; this.realTarget = 0; this.realAnim = null;
    this.dragEnabled = false;
    this.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b18);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 600);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels3d';
    host.appendChild(this.labelRenderer.domElement);

    this._makeRenderer();
    this.controls = new OrbitControls(this.camera, host);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 45;
    this.controls.maxPolarAngle = Math.PI * 0.92;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.controls.addEventListener('start', () => { this.userMoved = true; this.camAnim = null; });
    this._lblSize = new Map();
    this.avoidSel = ['.bubble', '.mission'];
    this.userMoved = false;
    this.dirTop = new THREE.Vector3(1.9, 8.6, 16.6).normalize();
    this.dirSide = new THREE.Vector3(1.9, 2.4, 16.6).normalize();   // 옆에 가깝게: 달이 위아래로 비켜난 것이 잘 보임
    this.homeDir = this.dirTop.clone();
    this.tilt = false;
    this.camAnim = null;
    this.homeTarget = new THREE.Vector3(-3.1, 0, 0);
    this.homePos = new THREE.Vector3(-1.2, 8.6, 16.6);
    this.resetCamera();

    this._build();
    this._bindDrag();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }

  _makeRenderer() {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
    const high = this.quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: high ? 'default' : 'low-power' });
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 1.5) : 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'gl';
    this.host.insertBefore(this.renderer.domElement, this.host.firstChild);
    this.renderer.domElement.addEventListener('webglcontextlost', e => e.preventDefault());
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this._makeRenderer();
    this._applySegments();
    this.stars.geometry.setDrawRange(0, q === 'high' ? this.starCount : Math.floor(this.starCount * 0.35));
    this.resize();
    this.dirty = true;
  }

  _applySegments() {
    const seg = this.quality === 'high' ? 64 : 18;
    for (const m of [this.sun, this.earth, this.moon]) {
      const r = m.geometry.parameters.radius;
      m.geometry.dispose();
      m.geometry = new THREE.SphereGeometry(r, seg, Math.max(10, seg / 2));
    }
  }

  _build() {
    const s = this.scene;
    s.add(new THREE.AmbientLight(0xffffff, 0.09));
    this.light = new THREE.PointLight(0xfff4e0, 3.2, 0, 0);
    s.add(this.light);

    // 별
    this.starCount = 900;
    const pos = new Float32Array(this.starCount * 3);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < this.starCount; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 300;
      const q = Math.sqrt(1 - u * u);
      pos.set([r * q * Math.cos(th), r * u, r * q * Math.sin(th)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaab4d0, size: 1.4, sizeAttenuation: false }));
    s.add(this.stars);

    // 태양
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: 0xffd25a }));
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sun.add(this.sunGlow);
    this.sunGlow.scale.setScalar(4.2);
    s.add(this.sun);

    // 지구 (달의 그림자 무늬를 셰이더로)
    this.u = {
      uSunPos: { value: new THREE.Vector3(M.sunX, 0, 0) },
      uMoonPos: { value: new THREE.Vector3() },
      uMoonR: { value: M.moonR },
      uEarthR: { value: M.earthR },
      uSlope: { value: SHADOW_SLOPE },
    };
    const earthMat = new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.85, metalness: 0 });
    earthMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.u);
      VERT_HOOK(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec3 uSunPos; uniform vec3 uMoonPos; uniform float uMoonR;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 b = normalize(uMoonPos - uSunPos);
            vec3 q = vWPos - uMoonPos;
            float t = dot(q, b);
            float perp = length(q - b * t);
            float rp = uMoonR * 1.15 + t * 0.05;
            float f = t > 0.0 ? (1.0 - smoothstep(rp * 0.3, rp, perp)) * 0.82 : 0.0;
            diffuseColor.rgb *= (1.0 - f);
          }`);
    };
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(M.earthR, 64, 32), earthMat);
    s.add(this.earth);

    // 달 (지구 본그림자 속이면 붉고 어둡게)
    const moonMat = new THREE.MeshStandardMaterial({ map: moonTexture(), roughness: 1, metalness: 0 });
    moonMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.u);
      VERT_HOOK(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec3 uSunPos; uniform float uEarthR; uniform float uSlope;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 sa = normalize(-uSunPos);
          float st = dot(vWPos, sa);
          float sperp = length(vWPos - sa * st);
          float srad = uEarthR - st * uSlope;
          float shadowF = st > 0.0 ? smoothstep(srad + 0.025, srad - 0.025, sperp) : 0.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.22, 0.06, 0.03), shadowF);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(0.34, 0.085, 0.03) * shadowF;`);
    };
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(M.moonR, 48, 24), moonMat);
    s.add(this.moon);
    // 끌기 판정용(보이지 않는 큰 구)
    this.moonHit = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.moon.add(this.moonHit);

    // 달 궤도 고리
    const ring = [];
    for (let i = 0; i <= 128; i++) {
      const a = i / 128 * Math.PI * 2;
      ring.push(new THREE.Vector3(-M.orbitR * Math.cos(a), 0, M.orbitR * Math.sin(a)));
    }
    this.orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring),
      new THREE.LineBasicMaterial({ color: 0x7f95c8, transparent: true, opacity: 0.55 }));
    s.add(this.orbit);
    // 공전 방향 화살표 (궤도 위 작은 삼각형 2개)
    const triG = new THREE.ConeGeometry(0.13, 0.36, 3);
    triG.rotateZ(-Math.PI / 2);
    for (const a of [90, 270]) {
      const tri = new THREE.Mesh(triG, new THREE.MeshBasicMaterial({ color: 0x9fb4e6 }));
      const r = a * DEG;
      tri.position.set(-M.orbitR * Math.cos(r), 0, M.orbitR * Math.sin(r));
      // 접선 방향 = 위치 각도가 늘어나는 쪽
      const tan = new THREE.Vector3(M.orbitR * Math.sin(r), 0, M.orbitR * Math.cos(r)).normalize();
      tri.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan);
      s.add(tri);
    }

    // 달의 높낮이 기준면 (태양·지구·달 궤도가 있는 면) — 높낮이를 바꿀 때만 보임
    const pg = new THREE.RingGeometry(M.earthR + 0.15, M.orbitR + 0.7, 64, 1);
    this.plane = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0x7f95c8, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.visible = false;
    s.add(this.plane);
    const edge = [];
    for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; edge.push(new THREE.Vector3((M.orbitR + 0.7) * Math.cos(a), 0, (M.orbitR + 0.7) * Math.sin(a))); }
    this.planeEdge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge),
      new THREE.LineDashedMaterial({ color: 0xaab9e6, dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.6 }));
    this.planeEdge.computeLineDistances();
    this.planeEdge.visible = false;
    s.add(this.planeEdge);

    // 태양-지구 일직선 (점선)
    const lineG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(M.sunX, 0, 0), new THREE.Vector3(9, 0, 0)]);
    this.axisLine = new THREE.Line(lineG, new THREE.LineDashedMaterial({ color: 0xffd889, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.45 }));
    this.axisLine.computeLineDistances();
    s.add(this.axisLine);

    // 그림자 원뿔 재질 (끝으로 갈수록 옅게)
    const coneMat = (color, a0, a1) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uA0: { value: a0 }, uA1: { value: a1 } },
      vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uA0; uniform float uA1; varying float vY; void main(){ gl_FragColor = vec4(uColor, mix(uA0, uA1, vY)); }',
    });
    // 지구 본그림자 (지구 → +x 방향)
    const L = 9;
    const eg = new THREE.CylinderGeometry(M.earthR - L * SHADOW_SLOPE, M.earthR, L, 40, 1, true);
    eg.translate(0, L / 2, 0);
    this.earthCone = new THREE.Mesh(eg, coneMat(0x8c97c4, 0.34, 0.0));
    this.earthCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    this.earthCone.renderOrder = 2;
    s.add(this.earthCone);
    // 달 그림자 (달 → 태양 반대쪽)
    const ML = M.orbitR - M.earthR + 0.08;
    const mg = new THREE.CylinderGeometry(0.02, M.moonR, ML, 28, 1, true);
    mg.translate(0, ML / 2, 0);
    this.moonCone = new THREE.Mesh(mg, coneMat(0x8c97c4, 0.42, 0.12));
    this.moonCone.renderOrder = 2;
    s.add(this.moonCone);

    // 달 높낮이 표시 (달에서 궤도면까지 세로선)
    this.hLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.7 }));
    s.add(this.hLine);
    this.hDot = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.13, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
    this.hDot.rotation.x = -Math.PI / 2;
    s.add(this.hDot);

    // 실제 크기 느낌: 지구에서 태양 가장자리로 가는 시선
    const sl = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    this.sight = new THREE.LineSegments(sl, new THREE.LineDashedMaterial({ color: 0x9ff0ff, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0 }));
    s.add(this.sight);

    // 라벨
    this.lblSun = makeLabel('태양', 'sun'); this.sun.add(this.lblSun);
    this.lblEarth = makeLabel('지구'); this.scene.add(this.lblEarth);
    this.lblEarth.position.set(0, -M.earthR - 0.42, 0);
    this.lblMoon = makeLabel('달', 'moon'); this.scene.add(this.lblMoon);
    this.lblShadow = makeLabel('지구의 그림자', 'shadow'); this.scene.add(this.lblShadow);
    this.lblShadow.position.set(2.5, 1.12, 0);
    this.lblMoonShadow = makeLabel('달의 그림자', 'shadow'); this.scene.add(this.lblMoonShadow);
    this.lbl0 = makeLabel('0°', 'deg'); this.lbl0.position.set(-M.orbitR - 0.45, 0, 0.45); this.scene.add(this.lbl0);
    this.lbl180 = makeLabel('180°', 'deg'); this.lbl180.position.set(M.orbitR + 0.4, 0, 0.95); this.scene.add(this.lbl180);

    this._applySegments();
    this._layoutSun();
    this.setMoon(0, 0);
  }

  _layoutSun() {
    const k = easeInOut(this.realT);
    const x = M.sunX + (REAL_SUN_X - M.sunX) * k;
    const r = M.sunR + (REAL_SUN_R - M.sunR) * k;
    this.sun.position.set(x, 0, 0);
    this.sun.scale.setScalar(r);
    this.lblSun.position.set(0, -1.32, 0);
    this.light.position.copy(this.sun.position);
    this.u.uSunPos.value.copy(this.sun.position);
    const pa = this.axisLine.geometry.attributes.position;
    pa.setX(0, x + r); pa.needsUpdate = true;
    this.axisLine.computeLineDistances();
    // 시선
    const sp = this.sight.geometry.attributes.position;
    sp.setXYZ(0, 0, 0, 0); sp.setXYZ(1, x, r, 0);
    sp.setXYZ(2, 0, 0, 0); sp.setXYZ(3, x, -r, 0);
    sp.needsUpdate = true;
    this.sight.computeLineDistances();
    this.sight.material.opacity = 0.85 * Math.max(0, (k - 0.5) * 2);
    this.sight.visible = k > 0.5;
    const plain = k < 0.5;
    for (const o of [this.earthCone, this.lblShadow, this.lbl0, this.lbl180]) {
      const show = plain && (o.userData.want ?? true);
      o.visible = show;
      if (o.element) o.element.style.display = show ? '' : 'none';
    }
    this._orientMoonCone();
  }

  setMoon(angleDeg, h) {
    this.moonAngle = angleDeg; this.moonH = h;
    const a = angleDeg * DEG, y = h * M.hScale;
    this.moon.position.set(-M.orbitR * Math.cos(a), y, M.orbitR * Math.sin(a));
    this.moon.rotation.y = a;   // 늘 같은 면이 지구를 향함
    this.u.uMoonPos.value.copy(this.moon.position);
    this.lblMoon.position.copy(this.moon.position).add(new THREE.Vector3(0, M.moonR + 0.32, 0));
    this.dirty = true;
    const hp = this.hLine.geometry.attributes.position;
    hp.setXYZ(0, this.moon.position.x, y, this.moon.position.z);
    hp.setXYZ(1, this.moon.position.x, 0, this.moon.position.z);
    hp.needsUpdate = true;
    this.hLine.computeLineDistances();
    const showH = Math.abs(y) > 0.03;
    this.hLine.visible = showH; this.hDot.visible = showH;
    this.plane.visible = showH && this.realT < 0.5; this.planeEdge.visible = this.plane.visible;
    this.hDot.position.set(this.moon.position.x, 0, this.moon.position.z);
    this._orientMoonCone();
    this.moonCone.visible = Math.cos(a) > -0.2 && this.realT < 0.5;
    const near0 = Math.cos(a) > Math.cos(40 * DEG);
    this.lblMoonShadow.visible = near0 && this.realT < 0.5;
    this.lblMoonShadow.element.style.display = this.lblMoonShadow.visible ? '' : 'none';
    this.dirty = true;
  }

  _orientMoonCone() {
    if (!this.moonCone) return;
    const dir = this.moon.position.clone().sub(this.sun.position).normalize();
    this.moonCone.position.copy(this.moon.position);
    this.moonCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const mid = this.moon.position.clone().addScaledVector(dir, 1.35);
    this._shadowMid = mid; this._shadowDir = dir;
    this.lblMoonShadow.position.copy(mid).add(new THREE.Vector3(0, -0.55, 0));
  }

  setFreeHints(on) {
    for (const l of [this.lbl0, this.lbl180]) {
      l.userData.want = on;
      const show = on && this.realT < 0.5;
      l.visible = show; l.element.style.display = show ? '' : 'none';
    }
    this.dirty = true;
  }

  // '실제 크기 느낌' 전환 (부드럽게)
  setRealScale(on) {
    this.realTarget = on ? 1 : 0;
    this.realAnim = { from: this.realT, to: this.realTarget, t: 0, dur: 1.4,
      camFrom: this.camera.position.clone(), tgtFrom: this.controls.target.clone(),
      camTo: on ? new THREE.Vector3(-27, 9, 84) : this.homePos.clone(),
      tgtTo: on ? new THREE.Vector3(-28, 0, 0) : this.homeTarget.clone() };
    this.controls.maxDistance = on ? 140 : 45;
    this.dirty = true;
  }

  // 높낮이 탐구 때 카메라를 옆에 가깝게 (학생이 직접 돌린 뒤에는 건드리지 않음, force면 그래도 바꿈)
  setTilt(on, force = false) {
    const changed = on !== this.tilt;
    this.tilt = on;
    this.homeDir.copy(on ? this.dirSide : this.dirTop);
    this._homeFromSize();
    if ((changed && !this.userMoved && this.realT === 0 && !this.realAnim) || force) {
      if (force) this.userMoved = false;
      this.camAnim = { t: 0, dur: 0.9, from: this.camera.position.clone(), to: this.homePos.clone(),
        tgtFrom: this.controls.target.clone(), tgtTo: this.homeTarget.clone() };
      this.dirty = true;
    }
  }

  resetCamera() {
    this.userMoved = false;
    this.camAnim = null;
    this.camera.position.copy(this.homePos);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
    this.dirty = true;
  }

  _bindDrag() {
    const ray = new THREE.Raycaster(), v = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPt = new THREE.Vector3();
    let dragging = false, pid = null;
    const toNdc = e => {
      const r = this.host.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, this.camera);
    };
    const overMoon = e => { toNdc(e); return ray.intersectObject(this.moonHit, false).length > 0; };
    this.host.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      if (!overMoon(e)) return;
      if (!this.dragEnabled) { this.onDragBlocked?.(); e.stopImmediatePropagation(); return; }
      dragging = true; pid = e.pointerId;
      this.controls.enabled = false;
      this.host.setPointerCapture(e.pointerId);
      this.host.classList.add('dragging');
      e.stopPropagation();
    }, true);
    this.host.addEventListener('pointermove', e => {
      if (!dragging) {
        if (e.pointerType === 'mouse') this.host.classList.toggle('can-grab', this.dragEnabled && this.enabled && overMoon(e));
        return;
      }
      if (e.pointerId !== pid) return;
      toNdc(e);
      plane.constant = -this.moon.position.y;
      if (ray.ray.intersectPlane(plane, hitPt)) {
        let deg = Math.atan2(hitPt.z, -hitPt.x) / DEG;
        if (deg < 0) deg += 360;
        this.onMoonDrag?.(deg);
      }
    });
    const end = e => {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      this.controls.enabled = this.enabled;
      this.host.classList.remove('dragging');
      this.onMoonDrag?.(null);
    };
    this.host.addEventListener('pointerup', end);
    this.host.addEventListener('pointercancel', end);
  }

  setEnabled(on) {
    this.enabled = on;
    this.controls.enabled = on;
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._homeFromSize();
    if (!this.userMoved && !this.realAnim && !this.camAnim && this.realT === 0) {
      this.camera.position.copy(this.homePos);
      this.controls.update();
    }
    this.dirty = true;
  }

  // 화면 비율에 맞춰 처음 보는 거리 정하기 (태양~지구 그림자가 한눈에 들어오게)
  _homeFromSize() {
    const tv = Math.tan(this.camera.fov * Math.PI / 360);
    const dist = Math.max(3.7 / tv, 9.4 / (tv * this.camera.aspect));
    this.homePos.copy(this.homeTarget).addScaledVector(this.homeDir, dist);
  }

  // 라벨 겹침 정리: 중요한 라벨부터 자리를 잡고, 겹치면 다른 자리 → 그래도 겹치면 숨김
  _declutter() {
    const W = this.host.clientWidth, H = this.host.clientHeight;
    const v = new THREE.Vector3();
    const toScr = p => { v.copy(p).project(this.camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, front: v.z < 1 }; };
    // 천체의 화면 속 원(중심·반지름 px)
    const disc = (obj, r) => {
      const c = obj.getWorldPosition(new THREE.Vector3());
      const a = toScr(c);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).multiplyScalar(r * obj.scale.x);
      const b = toScr(c.add(up));
      return { cx: a.x, cy: a.y, r: Math.max(4, Math.hypot(b.x - a.x, b.y - a.y)) };
    };
    const md = disc(this.moon, M.moonR), ed = disc(this.earth, M.earthR), sdk = disc(this.sun, 1);
    const moonBox = { x: md.cx - md.r, y: md.cy - md.r, w: md.r * 2, h: md.r * 2 };
    const hit = (a, b, pad = 2) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
    // 천체 둘레 화면 위·아래·왼쪽·오른쪽 자리 (카메라를 어디로 돌려도 천체를 가리지 않게)
    const around = (pos, d, size) => [
      { pos, off: [0, -(d.r + 4 + size.h / 2)] }, { pos, off: [0, d.r + 4 + size.h / 2] },
      { pos, off: [-(d.r + 6 + size.w / 2), 0] }, { pos, off: [d.r + 6 + size.w / 2, 0] },
      { pos, off: [-(d.r + 4 + size.w / 2), d.r + 4 + size.h / 2] }, { pos, off: [d.r + 4 + size.w / 2, d.r + 4 + size.h / 2] },
      { pos, off: [-(d.r + 4 + size.w / 2), -(d.r + 4 + size.h / 2)] }, { pos, off: [d.r + 4 + size.w / 2, -(d.r + 4 + size.h / 2)] },
    ];
    const sh = this._shadowMid || new THREE.Vector3(), sd = this._shadowDir || new THREE.Vector3(1, 0, 0);
    const P = (x, y, z) => ({ pos: new THREE.Vector3(x, y, z), off: [0, 0] });
    const items = [
      { o: this.lblSun, must: true, around: [new THREE.Vector3(), sdk], below: true },   // 태양 라벨은 태양의 자식(제자리 = 중심)
      { o: this.lblEarth, must: true, around: [new THREE.Vector3(), ed], below: true },
      { o: this.lblMoon, must: true, around: [this.moon.position.clone(), md] },
      { o: this.lblShadow, cands: [P(2.5, 1.12, 0), P(6.2, 0.95, 0), P(2.5, -1.12, 0), P(6.2, -0.95, 0)] },
      { o: this.lblMoonShadow, cands: [P(sh.x, sh.y - 0.55, sh.z), P(sh.x + sd.x * 0.45, sh.y - 0.72, sh.z + sd.z * 0.45), P(sh.x, sh.y + 0.55, sh.z)] },
      { o: this.lbl0 }, { o: this.lbl180 },
    ];
    // 3D 위에 떠 있는 말풍선·탐구 띠 자리도 피함
    const avoid = [];
    const hr = this.host.getBoundingClientRect();
    for (const sel of this.avoidSel || []) {
      const el = this.host.parentElement.querySelector(sel);
      if (!el || el.hidden || !el.offsetWidth) continue;
      const r = el.getBoundingClientRect();
      avoid.push({ x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height });
    }
    const placed = [];
    for (const it of items) {
      const el = it.o.element;
      if (!it.o.visible) { el.classList.remove('hide'); continue; }
      let size = this._lblSize.get(el);
      if (!size) {
        size = { w: el.offsetWidth, h: el.offsetHeight };
        if (size.w) this._lblSize.set(el, size);
        else size = { w: el.textContent.length * 13 + 18, h: 22 };
      }
      let cands = it.cands;
      if (it.around) {
        cands = around(it.around[0], it.around[1], size);
        if (it.below) cands.unshift(cands.splice(1, 1)[0]);   // 지구는 아래가 먼저
      }
      if (!cands) cands = [{ pos: null, off: [0, 0] }];
      let chosen = null, first = null;
      for (const c of cands) {
        if (c.pos) it.o.position.copy(c.pos);
        const s0 = toScr(it.o.getWorldPosition(new THREE.Vector3()));
        const r = { x: s0.x + c.off[0] - size.w / 2, y: s0.y + c.off[1] - size.h / 2, w: size.w, h: size.h };
        const freeOfAvoid = s0.front && !avoid.some(p => hit(r, p));
        // 꼭 보여야 하는 라벨: 자리가 없으면 말풍선·띠만은 피한 첫 자리를 씀
        if (!first || (!first.ok && freeOfAvoid)) first = { c, r, ok: freeOfAvoid };
        if (!s0.front) continue;
        const inside = r.x >= 2 && r.y >= 2 && r.x + r.w <= W - 2 && r.y + r.h <= H - 2;
        const clash = !freeOfAvoid || placed.some(p => hit(r, p)) || (it.o !== this.lblMoon && hit(r, moonBox, 0));
        if (inside && !clash) { chosen = { c, r }; break; }
      }
      if (!chosen && it.must) chosen = first;
      if (chosen) {
        if (chosen.c.pos) it.o.position.copy(chosen.c.pos);
        it.o.center.set(0.5 - chosen.c.off[0] / size.w, 0.5 - chosen.c.off[1] / size.h);
        placed.push(chosen.r);
        el.classList.remove('hide');
      } else el.classList.add('hide');
    }
  }

  // 매 프레임 호출. 그렸으면 true
  frame(dt) {
    if (this.realAnim) {
      const a = this.realAnim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = easeInOut(a.t);
      this.realT = a.from + (a.to - a.from) * a.t;
      this.camera.position.lerpVectors(a.camFrom, a.camTo, k);
      this.controls.target.lerpVectors(a.tgtFrom, a.tgtTo, k);
      this._layoutSun();
      this.setMoon(this.moonAngle, this.moonH);
      if (a.t >= 1) this.realAnim = null;
      this.dirty = true;
    }
    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = easeInOut(a.t);
      this.camera.position.lerpVectors(a.from, a.to, k);
      this.controls.target.lerpVectors(a.tgtFrom, a.tgtTo, k);
      if (a.t >= 1) this.camAnim = null;
      this.dirty = true;
    }
    if (this.controls.update(dt)) this.dirty = true;
    if (!this.dirty) return false;
    this.dirty = false;
    this.camera.updateMatrixWorld();
    this._declutter();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    return true;
  }
}
