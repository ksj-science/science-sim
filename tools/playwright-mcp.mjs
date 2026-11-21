#!/usr/bin/env node
/*
 * Playwright MCP 서버 실행기 — 윈도우(학교 PC)와 리눅스(클라우드 세션) 모두에서 같은 .mcp.json으로 돌게 함.
 * 윈도우는 npx가 npx.cmd라 shell을 거쳐야 하고, 리눅스는 화면이 없으니 headless + chromium으로 띄움.
 * 사용: node tools/playwright-mcp.mjs [추가 인자]
 */
import { spawn } from 'node:child_process';

const win = process.platform === 'win32';
const args = ['-y', '@playwright/mcp@latest', '--isolated'];
if (!win) args.push('--headless', '--browser', 'chromium');
args.push(...process.argv.slice(2));

// 윈도우는 명령 한 줄로 넘김(인자 배열 + shell은 Node 경고가 남). 인자는 고정 문자열이라 따옴표 처리 불필요.
const child = win
  ? spawn(['npx', ...args].join(' '), { stdio: 'inherit', shell: true })
  : spawn('npx', args, { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
