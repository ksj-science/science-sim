#!/usr/bin/env node
/*
 * 시뮬레이터 자동 점검 — AI 검수자 대신 기계로 확인할 수 있는 항목을 한 번에 검사한다.
 * (토큰을 거의 쓰지 않음: 결과는 짧은 보고서 한 장 + 첫 화면 스크린샷 3장)
 *
 * 사용: node tools/check-sim.mjs <단원ID> [--out .work/<ID>/자동점검] [--no-fps]
 *   - 저장소 루트를 정적 서버로 직접 띄우므로 npx serve가 없어도 됨
 *   - playwright 패키지가 필요: 없으면 `npm i --no-save playwright && npx playwright install chromium`
 *
 * 검사 항목 (심각도는 CLAUDE.md·qa-tester 기준과 같음)
 *   1366×768·1280×800·768×1024: 페이지 스크롤, 화면 밖 요소, 글자 잘림, 작은 글자(<12px), 작은 터치 대상(<32px), 겹침
 *   콘솔 오류·페이지 오류·404, 모든 버튼·슬라이더·선택 상자 실제 조작 → 화면/SimBridge 변화, 효과음 호출 수
 *   음소거 후 소리, fps(보통·CPU 4배 느리게), 제출 잠금(.sim-locked)
 * 결과: <out>/보고서.md, <out>/결과.json, <out>/<해상도>.png — 종료 코드 0=PASS, 1=FAIL(높음 있음), 2=실행 오류
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const unit = argv.find(a => !a.startsWith('--'));
if (!unit) { console.error('사용: node tools/check-sim.mjs <단원ID>'); process.exit(2); }
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const outDir = path.resolve(root, opt('--out', `.work/${unit}/자동점검`));
const doFps = !argv.includes('--no-fps');
if (!fs.existsSync(path.join(root, 'sims', unit, 'index.html'))) { console.error(`sims/${unit}/index.html 이 없어요`); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

// playwright 찾기: 저장소 node_modules → 전역 설치
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch { /* 아래에서 전역 시도 */ }
  try { return createRequire(path.join(execSync('npm root -g').toString().trim(), 'x'))('playwright'); } catch { /* 없음 */ }
  console.error('playwright 패키지가 없어요: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
const { chromium } = loadPlaywright();

// ── 정적 서버 ─────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/sims/${unit}/`;

const issues = [];   // { sev: '높음'|'중간'|'낮음', where, what }
const add = (sev, where, what) => issues.push({ sev, where, what });
const hash = buf => crypto.createHash('md5').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 효과음 호출 수 세기 (오디오 시작 전 설치)
const SOUND_HOOK = () => {
  window.__snd = 0;
  const P = window.AudioScheduledSourceNode && window.AudioScheduledSourceNode.prototype;
  if (P && P.start) { const s = P.start; P.start = function () { window.__snd++; return s.apply(this, arguments); }; }
};

// 화면 배치 검사 (브라우저 안에서 실행)
const LAYOUT = () => {
  const W = innerWidth, H = innerHeight, de = document.documentElement;
  const vis = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 0 && r.height > 0 && !el.closest('[hidden]'); };
  const name = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''))
    + (el.textContent ? ' "' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 20) + '"' : '');
  const all = [...document.querySelectorAll('body *')].filter(el => !['SCRIPT', 'STYLE', 'svg', 'path'].includes(el.tagName) && vis(el));
  const out = { scrollX: de.scrollWidth > W + 1, scrollY: de.scrollHeight > H + 1, offscreen: [], clipped: [], small: [], tiny: [], overlap: [] };
  for (const el of all) {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (s.position !== 'fixed' && (r.right > W + 2 || r.bottom > H + 2 || r.left < -2) && el.closest('dialog,[role=dialog]') === null && r.width < W * 2)
      if (!el.parentElement || !all.includes(el.parentElement) || (() => { const p = el.parentElement.getBoundingClientRect(); return p.right <= W + 2 && p.bottom <= H + 2; })())
        out.offscreen.push(name(el));
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (ownText) {
      if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible') out.clipped.push(name(el));
      if (parseFloat(s.fontSize) < 12) out.small.push(name(el) + ' ' + s.fontSize);
    }
    if (el.matches('button, input:not([type=hidden]), select, [role=button], [role=slider]') && (r.width < 32 || r.height < 32) && el.type !== 'range')
      out.tiny.push(name(el) + ` ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  // 겹침: 글자를 가진 잎 요소와 조작 요소끼리만 (조상·자손 관계 제외)
  const leaves = all.filter(el => el.matches('button,input,select,label,[role=button]') ||
    ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !el.querySelector('*')));
  for (let i = 0; i < leaves.length && out.overlap.length < 15; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j]; if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ix > 4 && iy > 4) out.overlap.push(name(a) + ' ↔ ' + name(b));
  }
  for (const k of ['offscreen', 'clipped', 'small', 'tiny', 'overlap']) out[k] = [...new Set(out[k])].slice(0, 12);
  return out;
};

const fpsOf = page => page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now();
  const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(Math.round(n / 3)); }; requestAnimationFrame(f); }));
const bridge = page => page.evaluate(() => { try { return JSON.stringify(window.SimBridge && window.SimBridge.state || null); } catch { return 'ERR'; } });

const result = { unit, when: new Date().toISOString(), views: {}, controls: [], sound: {}, fps: {}, lock: null, console: [], notFound: [] };
let browser;
try {
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });

  // ── 1. 해상도별 배치 ─────────────────────────────────
  for (const [w, h] of [[1366, 768], [1280, 800], [768, 1024]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w === 768 });
    const page = await ctx.newPage();
    if (w === 1366) {
      page.on('console', m => { if (m.type() === 'error') result.console.push(m.text().slice(0, 200)); });
      page.on('pageerror', e => result.console.push('페이지 오류: ' + String(e.message).slice(0, 200)));
      page.on('response', r => { if (r.status() >= 400) result.notFound.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
    }
    await page.goto(url, { waitUntil: 'load' });
    await sleep(1500);
    await page.screenshot({ path: path.join(outDir, `${w}x${h}.png`) });
    const L = await page.evaluate(LAYOUT);
    result.views[`${w}x${h}`] = L;
    const tag = `${w}×${h}`, main = w === 1366;
    if (L.scrollX || L.scrollY) add(main ? '높음' : '중간', tag, `페이지 스크롤 생김 (${[L.scrollX && '가로', L.scrollY && '세로'].filter(Boolean).join('·')})`);
    if (L.offscreen.length) add(main ? '높음' : '중간', tag, '화면 밖으로 나간 요소: ' + L.offscreen.join(', '));
    if (L.clipped.length) add('중간', tag, '글자 잘림: ' + L.clipped.join(', '));
    if (L.overlap.length) add('중간', tag, '겹침(확인 필요): ' + L.overlap.slice(0, 6).join(' / '));
    if (main && L.small.length) add('중간', tag, '12px보다 작은 글자: ' + L.small.join(', '));
    if (main && L.tiny.length) add('낮음', tag, '32px보다 작은 누름 대상: ' + L.tiny.join(', '));
    if (!main) { await ctx.close(); continue; }

    // ── 2. 조작 전부 해 보기 (1366×768) ─────────────────
    await page.addInitScript(SOUND_HOOK);
    await page.reload({ waitUntil: 'load' }); await sleep(1200);
    await page.mouse.click(5, h - 5); // 오디오 잠금 해제용 첫 입력
    await page.evaluate(SOUND_HOOK); await sleep(200);
    const init = await bridge(page);
    if (init === 'null') add('중간', 'SimBridge', 'SimBridge.state가 없음 (SimBridge.init·setState 확인)');
    const covered = [];
    const handles = await page.$$('button, input[type=range], input[type=checkbox], input[type=radio], select, input[type=number]');
    for (const el of handles) {
      const info = await el.evaluate(e => ({ tag: e.tagName.toLowerCase(), type: e.type, id: e.id,
        text: (e.getAttribute('aria-label') || e.title || e.textContent || e.name || '').trim().replace(/\s+/g, ' ').slice(0, 24),
        vis: !!(e.offsetWidth || e.offsetHeight) && getComputedStyle(e).visibility !== 'hidden', disabled: e.disabled,
        link: !!e.closest('a'), mute: /음소거|소리|mute/i.test((e.id || '') + (e.title || '') + (e.getAttribute('aria-label') || '')) }));
      if (!info.vis || info.disabled || info.link || info.mute) continue;
      const label = `${info.id ? '#' + info.id : info.tag} ${info.text}`.trim();
      const before = { shot: hash(await page.screenshot()), state: await bridge(page), snd: await page.evaluate(() => window.__snd) };
      try {
        if (info.type === 'range') {
          await el.evaluate(e => { const v = +e.value, mn = +e.min || 0, mx = e.max === '' ? 100 : +e.max;
            e.value = String(v < (mn + mx) / 2 ? mx : mn); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
          await el.focus(); await page.keyboard.press('ArrowLeft');
        } else if (info.tag === 'select') {
          await el.evaluate(e => { e.selectedIndex = (e.selectedIndex + 1) % e.options.length; e.dispatchEvent(new Event('change', { bubbles: true })); });
        } else if (info.type === 'number') {
          await el.fill('1'); await el.press('Enter');
        } else {
          try { await el.click({ timeout: 3000 }); }
          catch {
            // 앞 조작으로 열린 창이 가리는 경우: 닫고 다시 → 그래도 안 되면 코드로 눌러 기능만 확인
            await page.keyboard.press('Escape').catch(() => {});
            try { await el.click({ timeout: 1500 }); }
            catch { await el.evaluate(e => e.click()); covered.push(label); }
          }
        }
      } catch (e) { result.controls.push({ label, error: '조작 실패: ' + String(e.message).split('\n')[0] }); add('중간', label, '조작할 수 없음'); continue; }
      await sleep(400);
      const after = { shot: hash(await page.screenshot()), state: await bridge(page), snd: await page.evaluate(() => window.__snd) };
      const row = { label, screen: before.shot !== after.shot, bridge: before.state !== after.state, sound: after.snd > before.snd };
      result.controls.push(row);
      if (!row.screen && !row.bridge) add('중간', label, '눌러도 화면·상태 변화 없음');
      // 열린 대화창·도움말은 Escape로 닫기
      await page.keyboard.press('Escape').catch(() => {});
    }
    if (covered.length) add('낮음', '조작', '다른 요소(열린 창 등)에 가려 바로 누를 수 없었던 버튼: ' + covered.join(', '));
    const ctl = result.controls.filter(c => !c.error);
    if (ctl.length && !ctl.some(c => c.bridge)) add('중간', 'SimBridge', '어떤 조작으로도 SimBridge 상태가 바뀌지 않음');
    if (ctl.length && !ctl.some(c => c.sound)) add('중간', '소리', '조작해도 효과음이 한 번도 나지 않음');

    // ── 3. 음소거 ───────────────────────────────────────
    const mute = await page.$('#btnMute, [aria-label*="소리"], [title*="소리"], [title*="음소거"], [aria-label*="음소거"]');
    if (!mute) add('높음', '소리', '음소거 버튼을 찾지 못함 (id="btnMute" 또는 title/aria-label에 "소리" 권장)');
    else {
      await mute.click(); await sleep(200);
      const s0 = await page.evaluate(() => window.__snd);
      for (const c of (await page.$$('main button, #stage button')).slice(0, 3)) await c.click({ timeout: 1000 }).catch(() => {});
      await sleep(300);
      result.sound = { mutedCalls: (await page.evaluate(() => window.__snd)) - s0 };
      await mute.click(); // 되돌림
    }

    // ── 4. fps ─────────────────────────────────────────
    if (doFps) {
      result.fps.normal = await fpsOf(page);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      result.fps.slow4x = await fpsOf(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      if (result.fps.slow4x < 30) add('중간', 'fps', `CPU 4배 느리게 ${result.fps.slow4x}fps (헤드리스·소프트웨어 렌더링 수치라 실제보다 낮게 나옴 — 30 미만이면 품질 낮춤 확인)`);
    }

    // ── 5. 제출 잠금 ────────────────────────────────────
    await page.evaluate(() => document.documentElement.classList.add('sim-locked'));
    const s1 = await bridge(page), h1 = hash(await page.screenshot());
    for (const c of (await page.$$('input[type=range], main button')).slice(0, 3)) {
      await c.click({ timeout: 800, force: true }).catch(() => {});
    }
    await sleep(300);
    result.lock = { stateSame: s1 === await bridge(page), screenSame: h1 === hash(await page.screenshot()) };
    if (!result.lock.stateSame) add('중간', '잠금', '.sim-locked 뒤에도 조작으로 SimBridge 상태가 바뀜');
    await ctx.close();
  }
  if (result.console.length) add('높음', '콘솔', `오류 ${result.console.length}개: ` + result.console.slice(0, 3).join(' | '));
  if (result.notFound.length) add('높음', '파일', '불러오기 실패: ' + [...new Set(result.notFound)].slice(0, 5).join(', '));
} catch (e) {
  add('높음', '실행', '점검 도구 실행 오류: ' + String(e.message).split('\n')[0]);
} finally {
  if (browser) await browser.close();
  server.close();
}

// ── 보고서 ─────────────────────────────────────────────
const order = { 높음: 0, 중간: 1, 낮음: 2 };
issues.sort((a, b) => order[a.sev] - order[b.sev]);
const n = s => issues.filter(i => i.sev === s).length;
const verdict = n('높음') ? 'FAIL' : 'PASS';
result.issues = issues; result.verdict = verdict;
fs.writeFileSync(path.join(outDir, '결과.json'), JSON.stringify(result, null, 1));
const md = [
  `# 자동 점검 — ${unit}`, `판정: **${verdict}** (높음 ${n('높음')}, 중간 ${n('중간')}, 낮음 ${n('낮음')})`, '',
  `스크린샷: ${['1366x768', '1280x800', '768x1024'].map(v => `\`${path.relative(root, path.join(outDir, v + '.png'))}\``).join(', ')}`,
  doFps ? `fps: 보통 ${result.fps.normal ?? '-'}, CPU 4배 느리게 ${result.fps.slow4x ?? '-'} (헤드리스 수치)` : '', '',
  '## 문제', '| # | 심각도 | 어디 | 내용 |', '|---|---|---|---|',
  ...issues.map((i, k) => `| ${k + 1} | ${i.sev} | ${i.where} | ${i.what.replace(/\|/g, '/')} |`),
  issues.length ? '' : '| - | - | - | 없음 |', '',
  `## 조작 점검 (${result.controls.length}개)`, '| 조작 | 화면 변화 | SimBridge | 효과음 |', '|---|---|---|---|',
  ...result.controls.map(c => c.error ? `| ${c.label} | ${c.error} | | |` : `| ${c.label} | ${c.screen ? '○' : '×'} | ${c.bridge ? '○' : '×'} | ${c.sound ? '○' : '×'} |`),
  '', `음소거 뒤 효과음 호출: ${result.sound.mutedCalls ?? '-'}회 (0이 아니면 출력 음량이 0인지 코드로 확인)`,
  `잠금(.sim-locked): 상태 유지 ${result.lock ? (result.lock.stateSame ? '○' : '×') : '-'}`,
].join('\n');
fs.writeFileSync(path.join(outDir, '보고서.md'), md);
console.log(md);
process.exit(verdict === 'PASS' ? 0 : 1);
