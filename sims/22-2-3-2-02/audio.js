// 22-2-3-2-02 악기 소리 합성 (Web Audio, lib/sound.js의 오디오 문맥·마스터 이득 위에)
// 분석 화면과 같은 수식(model.js)으로 합성한다. 효과음은 sound.js 쪽.
import { sound } from '../../lib/sound.js';
import { INST, KAL_TAU, END_AMP } from './model.js';

const PEAK = 0.24;      // 진폭 4칸일 때 악기 이득(마스터 0.5를 지나 최대 약 0.12)
let bus = null, air = null, noiseBuf = null, recWave = null;
let voice = null;
let airLevel = 1;       // 지금 소리 나는 음 하나 (한 번에 한 음)

function ensure() {
  const ctx = sound.ctx;
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume();
  if (!bus) {
    bus = ctx.createGain(); bus.gain.value = 1;
    air = ctx.createGain(); air.gain.value = airLevel;          // 공기 빼기(진공) — 매질이 없으면 소리 안 남
    bus.connect(air).connect(sound.master);
    // 리코더 파형: sin(kωt + φ) = sinφ·cos(kωt) + cosφ·sin(kωt) → real = a·sinφ, imag = a·cosφ (부호 포함)
    const m = INST.recorder, n = m.a.length + 1;
    const re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 0; k < m.a.length; k++) { re[k + 1] = m.sign * m.a[k] * Math.sin(m.p[k]) / m.N; im[k + 1] = m.sign * m.a[k] * Math.cos(m.p[k]) / m.N; }
    recWave = ctx.createPeriodicWave(re, im, { disableNormalization: true });
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

const can = () => sound.ctx && !sound.muted;

// 앞 소리는 0.05초에 걸쳐 줄이고 끔
export function stopVoice(fade = 0.05) {
  if (!voice || !sound.ctx) { voice = null; return; }
  const t = sound.ctx.currentTime, v = voice;
  v.g.gain.cancelScheduledValues(t);
  v.g.gain.setValueAtTime(v.g.gain.value, t);
  v.g.gain.linearRampToValueAtTime(0, t + fade);
  v.nodes.forEach(n => { try { n.stop(t + fade + 0.02); } catch { /* 이미 멈춤 */ } });
  voice = null;
}

export function playKalimba(f, A0) {
  stopVoice();
  if (!can()) return;
  const ctx = ensure(); if (!ctx) return;
  const t = ctx.currentTime + 0.005;
  const g = ctx.createGain();
  const peak = PEAK * A0 / 4 / INST.kalimba.N;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, KAL_TAU);          // A(t) = A₀·e^(−t/τ)
  g.connect(bus);
  const end = t + KAL_TAU * Math.log(A0 / END_AMP) + 0.1;
  const nodes = [];
  [[1, 1], [2, 0.08]].forEach(([k, a]) => {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = f * k; og.gain.value = a;
    o.connect(og).connect(g); o.start(t); o.stop(end); nodes.push(o);
  });
  // 튕긴 순간의 짧은 '팅'(6배 진동수, 0.03초) — 소리에만 있고 분석 화면에는 그리지 않음
  const ting = ctx.createOscillator(), tg = ctx.createGain();
  ting.frequency.value = f * 6;
  tg.gain.setValueAtTime(0.35, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  ting.connect(tg).connect(g); ting.start(t); ting.stop(t + 0.05); nodes.push(ting);
  voice = { g, nodes, inst: 'kalimba' };
}

export function startRecorder(f, A) {
  stopVoice();
  if (!can()) return;
  const ctx = ensure(); if (!ctx) return;
  const t = ctx.currentTime + 0.005;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(PEAK * A / 4, t + 0.08);
  g.connect(bus);
  const o = ctx.createOscillator();
  o.setPeriodicWave(recWave); o.frequency.value = f;
  o.connect(g); o.start(t);
  // 약한 숨소리 잡음 (소리에만)
  const nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2.5; bp.Q.value = 0.9;
  const ng = ctx.createGain(); ng.gain.value = 0.05;
  nz.connect(bp).connect(ng).connect(g); nz.start(t);
  voice = { g, nodes: [o, nz], inst: 'recorder' };
}

export function setRecorderAmp(A) {
  if (!voice || voice.inst !== 'recorder' || !sound.ctx) return;
  voice.g.gain.setTargetAtTime(PEAK * A / 4, sound.ctx.currentTime, 0.03);
}

export function releaseRecorder(at = 0) {
  if (!voice || voice.inst !== 'recorder' || !sound.ctx) return;
  const v = voice, t = sound.ctx.currentTime + Math.max(0, at);
  voice = null;
  v.g.gain.cancelScheduledValues(t);
  v.g.gain.setTargetAtTime(0, t, 0.025);
  v.nodes.forEach(n => n.stop(t + 0.2));
}

// 공기 빼기: 매질 비율(0~1)
export function setAir(d) {
  airLevel = d;
  if (!sound.ctx || !air) return;
  air.gain.setTargetAtTime(d, sound.ctx.currentTime, 0.05);
}
