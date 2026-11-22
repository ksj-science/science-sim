// 천문 계산 — 설계서 '화면의 모든 수치와 공식·단위'를 그대로 옮김
export const RAD = Math.PI / 180;
const EPS = 23.439 * RAD;              // 황도 경사 ε
const J2000_MS = Date.UTC(2000, 0, 1, 12); // 2000-01-01 12:00 세계시
export const LAT = 37.5;               // 관측자 위도(°N)
export const LON = 135;                // 관측자 경도(°E, 한국 표준시 기준 자오선)

export const norm360 = (a) => ((a % 360) + 360) % 360;

// ---- 날짜(하루 단위 정수 번호) ----
export const dayIndex = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 864e5);
export function ymd(i) {
  const t = new Date(i * 864e5);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
export function iso(i) {
  const { y, m, d } = ymd(i);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function fromIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? dayIndex(+m[1], +m[2], +m[3]) : null;
}
// 달력 기준 n개월 뒤 같은 날(없는 날이면 그 달 마지막 날)
export function addMonths(i, n) {
  const { y, m, d } = ymd(i);
  const mm0 = m - 1 + n;
  const yy = y + Math.floor(mm0 / 12);
  const mm = ((mm0 % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return dayIndex(yy, mm + 1, Math.min(d, last));
}
// 2000년 1월 1일 12:00(세계시)부터 지난 날수 d — 날짜 i의 한국 시각 hourKST
export const jdays = (i, hourKST) => (i * 864e5 + (hourKST - 9) * 3600e3 - J2000_MS) / 864e5;

// ---- 태양 황경 λ (°) ----
export function sunLongitude(d) {
  const L = 280.460 + 0.9856474 * d;
  const g = (357.528 + 0.9856003 * d) * RAD;
  return norm360(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
}
// 그해 분점 기준으로 쓸 때 경계에 더하는 값(세차)
export const precess = (d) => 0.01397 * (d / 365.25);

// ---- 좌표 변환 (라디안) ----
export function eclToEq(lam, beta = 0) {
  const sl = Math.sin(lam), cl = Math.cos(lam), sb = Math.sin(beta), cb = Math.cos(beta);
  const dec = Math.asin(sb * Math.cos(EPS) + cb * Math.sin(EPS) * sl);
  const ra = Math.atan2(sl * Math.cos(EPS) - Math.tan(beta) * Math.sin(EPS), cl);
  return { ra, dec };
}
export function eqToEcl(ra, dec) {
  const beta = Math.asin(Math.sin(dec) * Math.cos(EPS) - Math.cos(dec) * Math.sin(EPS) * Math.sin(ra));
  const lam = Math.atan2(Math.sin(ra) * Math.cos(EPS) + Math.tan(dec) * Math.sin(EPS), Math.cos(ra));
  return { lam, beta };
}
// 지방 항성시(°) = GMST + 관측자 경도
export const lst = (d) => norm360(280.46061837 + 360.98564736629 * d + LON);

// 적경·적위(라디안) → 고도·방위각(°, 방위각은 북=0 동=90 남=180 서=270)
const SPHI = Math.sin(LAT * RAD), CPHI = Math.cos(LAT * RAD);
export function altAz(ra, dec, lstDeg) {
  const H = lstDeg * RAD - ra;
  const sd = Math.sin(dec), cd = Math.cos(dec), cH = Math.cos(H);
  const alt = Math.asin(SPHI * sd + CPHI * cd * cH);
  const az = Math.atan2(-cd * Math.sin(H), CPHI * sd - SPHI * cd * cH);
  return { alt: alt / RAD, az: norm360(az / RAD) };
}

// ---- 별자리 경계 (태양이 지나는 황도 위, J2000 분점 기준 황경, IAU) ----
export const BOUNDS = [
  ['물고기자리', 351.57], ['양자리', 29.09], ['황소자리', 53.47], ['쌍둥이자리', 90.43],
  ['게자리', 118.26], ['사자자리', 138.18], ['처녀자리', 174.15], ['천칭자리', 218.02],
  ['전갈자리', 241.05], ['뱀주인자리', 247.70], ['궁수자리', 266.27], ['염소자리', 299.68],
  ['물병자리', 327.65],
];
// 황경 λ(J2000 기준)가 속한 별자리
export function conAtJ2000(lam) {
  const l = norm360(lam);
  let name = BOUNDS[0][0];
  for (let k = 0; k < BOUNDS.length; k++) {
    const start = BOUNDS[k][1];
    const end = BOUNDS[(k + 1) % BOUNDS.length][1];
    const inside = start < end ? (l >= start && l < end) : (l >= start || l < end);
    if (inside) { name = BOUNDS[k][0]; break; }
  }
  return name;
}
// 그해 분점 기준 황경 → 별자리 (경계에 세차를 더한 것과 같음)
export const conOfDate = (lamOfDate, d) => conAtJ2000(lamOfDate - precess(d));

// ---- 하루치 계산 묶음 ----
export function noonSun(i) {
  const d = jdays(i, 12);
  const lam = sunLongitude(d);
  return { d, lam, con: conOfDate(lam, d) };
}
// 그날 밤 12시(다음 날 00:00) 남쪽 자오선 위 황도 점의 황경(그해 분점 기준)
export function midnightSouth(i) {
  const d = jdays(i + 1, 0);
  const a = lst(d) * RAD;
  const lam = norm360(Math.atan2(Math.sin(a), Math.cos(a) * Math.cos(EPS)) / RAD);
  return { d, lam, con: conOfDate(lam, d) };
}
