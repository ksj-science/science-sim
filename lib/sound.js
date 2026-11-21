// 공통 효과음 (Web Audio API) — 첫 사용자 클릭 후에 오디오를 시작한다.
const STORE_KEY = 'sim-muted';

class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorage.getItem(STORE_KEY) === '1';
    this._lastTick = 0;
    const unlock = () => {
      this._init();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  _init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  get ready() { return !!this.ctx && !this.muted; }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem(STORE_KEY, m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  // 기본 음 하나를 엔벨로프와 함께 재생
  _tone({ freq = 440, freq2 = null, type = 'sine', dur = 0.12, vol = 0.3, attack = 0.005, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  click() { this._tone({ freq: 880, freq2: 660, type: 'triangle', dur: 0.07, vol: 0.18 }); }

  // 슬라이더 틱: value(0~1)에 따라 음높이 변화, 너무 잦지 않게 제한
  tick(value = 0.5) {
    const now = performance.now();
    if (now - this._lastTick < 45) return;
    this._lastTick = now;
    this._tone({ freq: 500 + value * 700, type: 'sine', dur: 0.04, vol: 0.08 });
  }

  on() {
    this._tone({ freq: 300, freq2: 1400, type: 'sawtooth', dur: 0.18, vol: 0.07 });
    this._tone({ freq: 1400, type: 'sine', dur: 0.25, vol: 0.12, delay: 0.12 });
  }

  off() { this._tone({ freq: 900, freq2: 200, type: 'triangle', dur: 0.18, vol: 0.12 }); }

  // 물방울 같은 소리 (매질 바꾸기)
  bubble() {
    this._tone({ freq: 300, freq2: 900, type: 'sine', dur: 0.12, vol: 0.22 });
    this._tone({ freq: 500, freq2: 1300, type: 'sine', dur: 0.1, vol: 0.12, delay: 0.07 });
  }

  // 반짝이는 알림음 (특별한 현상 발견)
  chime() {
    [1046, 1318, 1568].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.35, vol: 0.12, delay: i * 0.07 }));
  }

  reset() {
    this._tone({ freq: 660, freq2: 330, type: 'triangle', dur: 0.15, vol: 0.15 });
    this._tone({ freq: 440, type: 'sine', dur: 0.15, vol: 0.12, delay: 0.1 });
  }
}

export const sound = new SoundFX();
