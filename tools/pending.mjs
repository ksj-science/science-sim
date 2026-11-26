#!/usr/bin/env node
/*
 * 반영·배포 대기 목록 — 아직 교사용 대시보드에 반영되지 않았거나 구글 스크립트(웹앱)에 배포되지 않은 시뮬레이터를 모아 보여 주고,
 * 선생님이 허락하면 한꺼번에 '반영됨/배포됨'으로 표시한다. (토큰 절약: 사람이 읽을 짧은 표만 출력)
 *
 * 사용
 *   node tools/pending.mjs                 대기 목록만 출력 (아무것도 바꾸지 않음)
 *   node tools/pending.mjs --json          같은 내용을 JSON으로
 *   node tools/pending.mjs --mark dashboard   대기 중인 모든 단원을 대시보드 반영(dashboard: true)으로 표시
 *   node tools/pending.mjs --mark gas [ID…]   웹앱 배포 끝난 단원에 오늘 날짜 기록(ID 없으면 대기 전부) + deploy.json의 shell 커밋 갱신
 *
 * 판정
 *   대시보드 대기: sims/<ID>/ 폴더는 있는데 units.json에 없음(→ 먼저 등록 필요) 또는 units.json의 dashboard가 false
 *   웹앱 대기:    units.json의 gas가 비어 있음(null) — 이 단원 문항·정답을 시트에 넣지 않았거나 웹앱이 열 수 없음
 *                 shell/ 최신 커밋 ≠ deploy.json의 shell → 웹앱 코드 재배포 필요
 *   정답 초안:    .work/<ID>/정답.tsv 유무(이 PC에만 있음, 저장소에 없음) — 없으면 문항 없이 시뮬레이터만 열림
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const args = process.argv.slice(2);
const unitsPath = path.join(root, 'units.json');
const deployPath = path.join(root, 'deploy.json');
const units = JSON.parse(fs.readFileSync(unitsPath, 'utf8'));
const deploy = fs.existsSync(deployPath) ? JSON.parse(fs.readFileSync(deployPath, 'utf8')) : {};
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜

let shellHead = '';
try { shellHead = execSync('git log -1 --format=%H -- shell/', { cwd: root }).toString().trim(); } catch { /* git 없음 */ }
const shellPending = !!shellHead && shellHead !== deploy.shell;

const real = units.filter(u => u.grade); // 예시 제외
const ids = new Set(units.map(u => u.id));
const unregistered = fs.readdirSync(path.join(root, 'sims'), { withFileTypes: true })
  .filter(d => d.isDirectory() && !ids.has(d.name) && !d.name.startsWith('sample'))
  .map(d => d.name);
const dash = real.filter(u => u.dashboard === false);
const gas = real.filter(u => !u.gas);
const hasKey = id => fs.existsSync(path.join(root, '.work', id, '정답.tsv'));

const i = args.indexOf('--mark');
if (i >= 0) {
  const what = args[i + 1];
  const pick = args.slice(i + 2);
  if (what === 'dashboard') {
    if (unregistered.length) console.log(`먼저 units.json에 등록해야 하는 폴더: ${unregistered.join(', ')}`);
    dash.forEach(u => { u.dashboard = true; });
    console.log(`대시보드 반영 표시: ${dash.length}개 ${dash.map(u => u.id).join(', ')}`);
  } else if (what === 'gas') {
    const list = pick.length ? gas.filter(u => pick.includes(u.id)) : gas;
    list.forEach(u => { u.gas = today; });
    if (shellHead) deploy.shell = shellHead;
    fs.writeFileSync(deployPath, JSON.stringify(deploy, null, 2) + '\n');
    console.log(`웹앱 배포 표시(${today}): ${list.length}개 ${list.map(u => u.id).join(', ')}${shellHead ? ' · deploy.json shell 갱신' : ''}`);
  } else {
    console.error('--mark 뒤에는 dashboard 또는 gas'); process.exit(2);
  }
  fs.writeFileSync(unitsPath, JSON.stringify(units, null, 2) + '\n');
  process.exit(0);
}

const out = {
  unregistered,
  dashboard: dash.map(u => ({ id: u.id, title: u.title, source: u.source || 'code' })),
  gas: gas.map(u => ({ id: u.id, title: u.title, source: u.source || 'code', answerDraft: hasKey(u.id) })),
  shellRedeploy: shellPending
};
if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const src = s => (s === 'chat' ? '채팅' : '코드');
console.log('# 반영·배포 대기');
console.log(`- 등록 안 된 시뮬레이터 폴더: ${unregistered.length ? unregistered.join(', ') : '없음'}`);
console.log(`- 대시보드 반영 대기 ${dash.length}개${dash.length ? ': ' + dash.map(u => `${u.id}(${src(u.source)})`).join(', ') : ''}`);
console.log(`- 웹앱(구글 스크립트) 배포 대기 ${gas.length}개${shellPending ? ' + 웹앱 코드(shell/) 재배포 필요' : ''}`);
if (gas.length) {
  const withKey = gas.filter(u => hasKey(u.id)).map(u => u.id);
  const chat = gas.filter(u => u.source === 'chat').length;
  console.log(`  · 문항·정답 초안 있음(시트에 넣을 것): ${withKey.length ? withKey.join(', ') : '없음'}`);
  console.log(`  · 채팅 시뮬레이터 ${chat}개 / 클로드 코드 ${gas.length - chat}개 (초안 없는 단원은 문항 없이 시뮬레이터만 열림)`);
}
