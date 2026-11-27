// 일식·월식 모형 계산 (화면 그리기와 무관한 순수 계산)
// 설계서 22-1-7-2-04 '화면에 나오는 모든 수치와 공식·단위' 절을 따른다.

// 3D 모형 치수 (모형 단위, 실제 비율 아님)
export const M = {
  earthR: 0.9,
  moonR: 0.27,
  orbitR: 3.6,
  sunX: -10,
  sunR: 1.6,
  hScale: 0.36,          // 달의 높낮이 1 모형 단위 → 3D 높이
};
// 지구 본그림자: 달 거리에서 반지름이 달 반지름의 2.6배가 되도록 한 원뿔(모형 값)
export const SHADOW_RATIO = 2.6;
export const SHADOW_SLOPE = (M.earthR - SHADOW_RATIO * M.moonR) / M.orbitR;
// 하늘 보기 단위(달 반지름 = 1)로 바꾸는 상수 k: 달이 궤도에서 1 rad 비켜날 때의 중심 간격
export const K = M.orbitR / M.moonR;

// 교과서 탐구 날짜(진행 시간 처음·끝만 교과서 값, 그 사이는 모형)
// 시각은 '첫날 0시부터 지난 분'으로 다룬다.
export const EVENTS = {
  solar: {
    date: [2035, 9, 2], tMin: 8 * 60, tMax: 13 * 60 + 50,
    start: 8 * 60 + 15, end: 13 * 60 + 35,
    rOcc: 1, rTarget: 1,
  },
  lunar: {
    date: [2032, 4, 25], tMin: 22 * 60, tMax: 24 * 60 + 2 * 60 + 15,
    start: 22 * 60 + 27, end: 24 * 60 + 2 * 60,
    rOcc: SHADOW_RATIO, rTarget: 1,
  },
};

const pad = n => String(n).padStart(2, '0');

// 분 → 날짜·시각
export function timeParts(mode, min) {
  const ev = EVENTS[mode];
  const d = new Date(Date.UTC(ev.date[0], ev.date[1] - 1, ev.date[2]) + Math.floor(min / 1440) * 86400000);
  const m = ((min % 1440) + 1440) % 1440;
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: Math.floor(m / 60), mi: m % 60 };
}
export const timeStr = (mode, min) => {
  const t = timeParts(mode, min);
  return `${t.y}-${pad(t.mo)}-${pad(t.d)} ${pad(t.h)}:${pad(t.mi)}`;
};
export const timeDisplay = (mode, min) => {
  const t = timeParts(mode, min);
  return { date: `${t.y}. ${t.mo}. ${t.d}.`, clock: `${pad(t.h)}:${pad(t.mi)}` };
};
export const clockOf = min => `${pad(Math.floor((min % 1440) / 60))}:${pad(min % 60)}`;

// 두 원의 겹친 넓이
export function overlapArea(r1, r2, d) {
  d = Math.abs(d);
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const k = Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return r1 * r1 * a1 + r2 * r2 * a2 - 0.5 * k;
}

// 가린 비율(%) = 겹친 넓이 ÷ 대상 원 넓이 × 100
export function coverPct(rOcc, rTarget, d) {
  const v = overlapArea(rOcc, rTarget, d) / (Math.PI * rTarget * rTarget) * 100;
  return Math.min(100, Math.max(0, v));          // 부동소수 오차로 −0.0 이 나오지 않게
}

// 교과서 모드: 시각 → 하늘 보기 기하
// moonRel = 가림 기준(태양 또는 그림자 중심)에 대한 달의 위치, x(+)=서쪽(화면 오른쪽), 하늘 단위
export function bookGeom(mode, min) {
  const ev = EVENTS[mode];
  const p = (min - ev.start) / (ev.end - ev.start);          // 진행 비율 (0~1 밖으로도 이어짐)
  const S = ev.rOcc + ev.rTarget;
  const moonRelX = (1 - 2 * p) * S;                            // d = (1 − 2p)(R가림 + R대상)
  return finishGeom(mode === 'solar' ? 'solar' : 'lunar', moonRelX, 0);
}

// 자유 배치: 달의 위치 각도(°)와 높낮이(모형 단위) → 하늘 보기 기하
export function freeGeom(angleDeg, height) {
  const a = ((angleDeg % 360) + 360) % 360;
  const view = (a < 90 || a > 270) ? 'solar' : 'lunar';
  let delta = (view === 'solar' ? a : a - 180) * Math.PI / 180;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  const x = -K * Math.sin(delta);                              // 공전 방향 뒤쪽(각도 작음) = 서쪽
  const y = (height * M.hScale) / M.moonR;
  return finishGeom(view, x, y);
}

function finishGeom(view, moonRelX, moonRelY) {
  const rOcc = view === 'solar' ? 1 : SHADOW_RATIO;
  const d = Math.hypot(moonRelX, moonRelY);
  const cover = coverPct(rOcc, 1, d);
  // 가림체가 대상에 대해 어디 있는지 (하늘 단위, x+=서쪽)
  const occX = view === 'solar' ? moonRelX : -moonRelX;
  const occY = view === 'solar' ? moonRelY : -moonRelY;
  return { view, moonRelX, moonRelY, occX, occY, d, rOcc, cover };
}

// 교과서 모드의 시각 → 3D 달 위치 각도(°)
export function bookAngle(mode, min) {
  const g = bookGeom(mode, min);
  const delta = Math.asin(Math.max(-1, Math.min(1, -g.moonRelX / K))) * 180 / Math.PI;
  return mode === 'solar' ? (delta + 360) % 360 : 180 + delta;
}

// 식 상태
export function eclipseState(view, cover) {
  if (cover <= 0.0001) return 'none';
  const total = cover >= 99.95;
  if (view === 'solar') return total ? 'totalSolar' : 'partialSolar';
  return total ? 'totalLunar' : 'partialLunar';
}
export const STATE_KO = {
  none: '식 없음', partialSolar: '부분 일식', totalSolar: '개기 일식',
  partialLunar: '부분 월식', totalLunar: '개기 월식',
};
