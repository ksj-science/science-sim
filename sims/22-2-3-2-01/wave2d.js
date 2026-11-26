// 연못 물결 모형 — 2차원 파동 방정식 높이장(감쇠·가장자리 흡수 포함). three.js와 무관한 순수 계산.
// 높이 단위: cm, 길이 단위: m (연못 반지름 R = 1 m 모형)
export const POND_R = 1.0;          // 연못 반지름 (m)
export const WAVE_C = 0.42;         // 물결이 퍼지는 빠르기 (모형 값, m/s)
export const STEP = 1 / 120;        // 계산 한 걸음 (초)

export class Wave2D {
  constructor(n) {
    this.n = n;
    this.L = POND_R * 1.04;                 // 격자 반 너비 (m)
    this.dx = (2 * this.L) / (n - 1);
    const N = n * n;
    this.cur = new Float32Array(N);
    this.prev = new Float32Array(N);
    this.next = new Float32Array(N);
    this.keep = new Float32Array(N);        // 걸음마다 곱하는 감쇠 (가장자리에서 흡수)
    this.inside = new Uint8Array(N);
    this.k = (WAVE_C * STEP / this.dx) ** 2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -this.L + i * this.dx, z = -this.L + j * this.dx;
      const r = Math.hypot(x, z), id = j * n + i;
      this.inside[id] = r < POND_R ? 1 : 0;
      let keep = 0.997;                       // 물 자체의 약한 감쇠 (속도에 곱함)
      const edge = POND_R * 0.74;
      if (r > edge) keep -= 0.16 * ((r - edge) / (POND_R - edge)) ** 2; // 흡수 띠: 가장자리로 갈수록 점점 세게
      this.keep[id] = r < POND_R ? Math.max(0, keep) : 0;
    }
    // 격자가 성길 때(품질 낮음) 같은 세기로 보이도록 맞추는 보정
    this.gain = n >= 140 ? 1 : 1.4;
    this.sources = [];                        // 물방울이 닿은 뒤 잠깐 출렁이는 파원
    this.energy = 0;
  }

  clear() { this.cur.fill(0); this.prev.fill(0); this.sources = []; this.energy = 0; }

  // 물방울이 (x, z)에 닿음. strength: 파원 진폭 (cm)
  drop(x, z, strength) { this.sources.push({ x, z, a: strength * this.gain, t: 0 }); }

  step() {
    const { n, cur, prev, next, keep, k } = this;
    // 파원: 물방울이 닿은 자리를 짧게(약 0.5초) 위아래로 흔듦 → 동심원 물결 몇 겹
    for (let s = this.sources.length - 1; s >= 0; s--) {
      const src = this.sources[s];
      const F = t => (t <= 0 || t >= 0.6) ? 0
        : -src.a * Math.sin(2 * Math.PI * t / 0.24) * Math.exp(-t / 0.25) * Math.sin(Math.PI * t / 0.6);
      const dF = F(src.t + STEP) - F(src.t);   // 더한 높이의 합이 0이 되도록 '변화량'만 더함 (물이 새로 생기지 않음)
      src.t += STEP;
      if (src.t > 0.6) { this.sources.splice(s, 1); continue; }
      const rad = 0.06, rc = Math.ceil(rad * 2 / this.dx);
      const ci = Math.round((src.x + this.L) / this.dx), cj = Math.round((src.z + this.L) / this.dx);
      for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
        if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
        const x = -this.L + i * this.dx - src.x, z = -this.L + j * this.dx - src.z;
        const w = Math.exp(-(x * x + z * z) / (rad * rad));
        const id = j * n + i;
        cur[id] += dF * w;
      }
    }
    let e = 0;
    for (let j = 1; j < n - 1; j++) {
      const row = j * n;
      for (let i = 1; i < n - 1; i++) {
        const id = row + i;
        const c = cur[id];
        const lap = cur[id - 1] + cur[id + 1] + cur[id - n] + cur[id + n] - 4 * c;
        const v = c + (c - prev[id]) * keep[id] + k * lap;
        next[id] = v;
        e += v < 0 ? -v : v;
      }
    }
    this.prev = cur; this.cur = next; this.next = prev;
    this.energy = e / (n * n);
  }

  // (x, z) 자리의 수면 높이 (cm) — 쌍선형 보간
  heightAt(x, z) {
    const { n, L, dx, cur } = this;
    const fx = (x + L) / dx, fz = (z + L) / dx;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return 0;
    const tx = fx - i, tz = fz - j, id = j * n + i;
    return (cur[id] * (1 - tx) + cur[id + 1] * tx) * (1 - tz) + (cur[id + n] * (1 - tx) + cur[id + n + 1] * tx) * tz;
  }

  // 수면 기울기 (오리 기우뚱 표현용)
  slopeAt(x, z) {
    const d = this.dx;
    return [(this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d), (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d)];
  }
}
