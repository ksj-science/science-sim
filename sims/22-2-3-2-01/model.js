// 22-2-3-2-01 소리 분석기 — 음·악기 파형 모형 (설계서 '단순화한 부분'의 수식 그대로)

// 평균율: f = 440 × 2^((n − 69) ÷ 12), n = 미디 번호 (도 72 ~ 높은 도 84)
export const NOTES = [
  { name: '도', midi: 72 }, { name: '레', midi: 74 }, { name: '미', midi: 76 }, { name: '파', midi: 77 },
  { name: '솔', midi: 79 }, { name: '라', midi: 81 }, { name: '시', midi: 83 }, { name: '높은 도', midi: 84 },
].map(n => ({ ...n, f: 440 * Math.pow(2, (n.midi - 69) / 12) }));
export const periodMs = i => 1000 / NOTES[i].f;

// 악기 파형: y = A × sign × Σ aₖ·sin(2π·k·θ + φₖ) ÷ N   (θ = f·t, 한 주기 = 1)
// 리코더는 sign = −1 (모든 위상에 π를 더한 것과 같음): 가장 큰 흔들림이 위쪽 봉우리가 되어
// '진폭 = 화면에 보이는 가장 높은 봉우리 높이 = |합|의 최댓값'이 함께 성립하게 함
export const INST = {
  kalimba: { ko: '칼림바', a: [1, 0.08], p: [0, 0], sign: 1 },
  recorder: { ko: '리코더', a: [1, 0.35, 0.25, 0.10, 0.08], p: [0, 1.2, 0.4, 2.0, 0.9], sign: -1 },
};

const raw = (m, th) => {
  let s = 0;
  for (let k = 0; k < m.a.length; k++) s += m.a[k] * Math.sin(2 * Math.PI * (k + 1) * th + m.p[k]);
  return m.sign * s;
};

// 정규화 계수 N(한 주기 안의 |합|의 최댓값)과 트리거 위상(위로 올라가며 0을 지나는 점) 미리 계산
for (const m of Object.values(INST)) {
  const n = 4000;
  let mx = 0;
  const ups = [];
  for (let i = 0; i < n; i++) {
    const a = raw(m, i / n), b = raw(m, (i + 1) / n);
    mx = Math.max(mx, Math.abs(a));
    if (a < 0 && b >= 0) {
      // 이분법으로 정확한 교차점
      let lo = i / n, hi = (i + 1) / n;
      for (let j = 0; j < 30; j++) { const mid = (lo + hi) / 2; if (raw(m, mid) < 0) lo = mid; else hi = mid; }
      ups.push({ th: (lo + hi) / 2, slope: (b - a) * n });
    }
    if (i === 0 && Math.abs(a) < 1e-9 && b > 0) ups.push({ th: 0, slope: (b - a) * n });
  }
  m.N = mx;
  ups.sort((x, y) => y.slope - x.slope);
  m.trig = ups.length ? ups[0].th : 0;                       // 화면 왼쪽 끝에 맞출 위상
  m.ups = ups.map(u => { const v = ((u.th - m.trig) % 1 + 1) % 1; return v > 1 - 1e-6 ? 0 : v; })
    .sort((x, y) => x - y).filter((v, i, arr) => i === 0 || v - arr[i - 1] > 1e-6); // 트리거 기준 위로 지나는 점들(한 주기 안)
}

// 트리거 기준 화면 시간 τ(ms)에서의 모양 (진폭 1)
export function shape(inst, f, tauMs) {
  const m = INST[inst];
  return raw(m, m.trig + f * tauMs / 1000) / m.N;
}

// 화면 0 ~ rangeMs 사이에서 파형이 O를 위로 지나는 시각들(ms)
export function upCrossings(inst, f, rangeMs) {
  const m = INST[inst], T = 1000 / f, out = [];
  for (let n = 0; n * T <= rangeMs + T; n++) for (const u of m.ups) {
    const t = (n + u) * T;
    if (t <= rangeMs + 1e-9) out.push(t);
  }
  return out;
}

// 칼림바: A(t) = A₀·e^(−t/τ), τ = 1.2 s, A₀ = 0.5 + 3.5 × 세기 ÷ 100 (칸)
export const KAL_TAU = 1.2;
export const kalA0 = pct => 0.5 + 3.5 * pct / 100;
// 리코더: 진폭 = 0.5 ~ 3.5칸 (부는 세기 0 ~ 100 %)
export const recA = pct => 0.5 + 3.0 * pct / 100;
export const END_AMP = 0.05;

// 신호 하나의 시각 t(초)에서의 진폭(칸)
export function ampAt(sig, t) {
  if (!sig || t < sig.t0) return 0;
  let a;
  if (sig.inst === 'kalimba') {
    a = sig.A0 * Math.exp(-(t - sig.t0) / KAL_TAU);
    if (a < END_AMP) return 0;
  } else {
    const rise = Math.min(1, (t - sig.t0) / 0.08);
    const fall = sig.tOff != null ? Math.max(0, 1 - (t - sig.tOff) / 0.08) : 1;
    a = sig.A * rise * fall;
  }
  if (sig.replacedAt != null && t >= sig.replacedAt) a *= Math.max(0, 1 - (t - sig.replacedAt) / 0.05);
  return a;
}

// 리코더 운지(표준 바로크식 근삿값): 0 = 뒤 구멍(엄지), 1~7 = 앞 구멍. 막힌 구멍 목록
export const FINGERING = [
  [0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 6, 7],
  [0, 1, 2, 3], [0, 1, 2], [0, 1], [0, 2],
];

export const strengthWord = pct => (pct < 40 ? '약하게' : pct < 70 ? '보통' : '세게');
export const strengthShort = pct => (pct < 40 ? '약' : pct < 70 ? '중' : '강');
