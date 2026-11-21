// 공통 효과음 (Web Audio API) — 첫 사용자 클릭 후에 오디오를 시작한다.
const STORE_KEY = 'sim-muted';

class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    // 저장소가 막힌 창(시크릿·웹앱 iframe 등)에서도 멈추지 않게 try로 감쌈
    try { this.muted = localStorage.getItem(STORE_KEY) === '1'; } catch { this.muted = false; }
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
    try { localStorage.setItem(STORE_KEY, m ? '1' : '0'); } catch { /* 저장 못 해도 이번 화면에서는 적용 */ }
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

  // 맑은 '딩' (딱 맞는 값을 찾았을 때)
  ding() {
    this._tone({ freq: 1318, type: 'sine', dur: 0.5, vol: 0.16 });
    this._tone({ freq: 2636, type: 'sine', dur: 0.3, vol: 0.04 });
  }

  // 기록할 때 '딸깍'
  record() {
    this._tone({ freq: 1800, freq2: 1200, type: 'square', dur: 0.03, vol: 0.06 });
    this._tone({ freq: 700, type: 'triangle', dur: 0.08, vol: 0.14, delay: 0.035 });
  }

  // 부드러운 '톡' (선택)
  soft() { this._tone({ freq: 620, freq2: 520, type: 'sine', dur: 0.09, vol: 0.16 }); }

  // 짧은 '휙' (탭 전환·초기화)
  whoosh() { this._noise({ dur: 0.18, from: 600, to: 2600, vol: 0.12 }); }

  // 작은 종소리
  bell() {
    [1568, 2093].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 0.9, vol: 0.11, delay: i * 0.09 }));
    this._tone({ freq: 3136, type: 'sine', dur: 0.4, vol: 0.03, delay: 0.09 });
  }

  // 띠 잡음 한 번
  _noise({ dur = 0.2, from = 500, to = 2000, vol = 0.1 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // 이어지는 '슈욱' — 반환한 객체의 set(0~1)로 음 높이, stop()으로 끝
  sweep() {
    const none = { set() {}, pause() {}, stop() {} };
    if (!this.ready) return none;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.value = 800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.1);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    const ctx = this.ctx;
    return {
      set(v) { bp.frequency.setTargetAtTime(300 + v * 2200, ctx.currentTime, 0.03); },
      pause(p) { g.gain.setTargetAtTime(p ? 0.0001 : 0.09, ctx.currentTime, 0.03); },
      stop() {
        const n = ctx.currentTime;
        g.gain.cancelScheduledValues(n);
        g.gain.setTargetAtTime(0.0001, n, 0.05);
        src.stop(n + 0.3);
      },
    };
  }

  reset() {
    this._tone({ freq: 660, freq2: 330, type: 'triangle', dur: 0.15, vol: 0.15 });
    this._tone({ freq: 440, type: 'sine', dur: 0.15, vol: 0.12, delay: 0.1 });
  }
}

export const sound = new SoundFX();
