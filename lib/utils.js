// 공통 유틸리티
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const DEG = Math.PI / 180;

export const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

// 값을 목표로 부드럽게 따라가게 하는 지수 감쇠 (프레임률과 무관)
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export const fmt = (v, digits = 1) => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// 슬라이더 채움 표시 갱신
export function paintRange(input) {
  const min = +input.min, max = +input.max, v = +input.value;
  input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
}

// 간단한 토스트 알림
let toastTimer;
export function toast(msg, ms = 2200) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// FPS 측정기: 일정 시간 평균 fps가 낮으면 콜백
export class FpsMonitor {
  constructor(onLow, { threshold = 40, window = 3 } = {}) {
    this.onLow = onLow; this.threshold = threshold; this.window = window;
    this.frames = 0; this.time = 0; this.done = false; this.fps = 60;
  }
  update(dt) {
    this.frames++; this.time += dt;
    if (this.time >= this.window) {
      this.fps = this.frames / this.time;
      if (!this.done && this.fps < this.threshold) { this.done = true; this.onLow(this.fps); }
      this.frames = 0; this.time = 0;
    }
  }
}
