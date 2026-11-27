---
name: 시뮬레이터
description: 교과서 이미지(채팅 첨부 또는 inbox/ 폴더)를 받아 단원설계서 → 시뮬레이터 → 자동 점검 + 검수 1명(최대 2회 수정) → 활동지·교사용 안내·클래스룸 게시글 → units.json 등록·커밋·main 푸시까지 중간 확인 없이 끝까지 실행하고, 마지막에 대시보드 반영·웹앱 배포 여부만 한 번 묻는다(허락하면 대기 중인 것 전부 일괄 처리). 교과서 이미지만 첨부되고 다른 지시가 없을 때, 또는 /시뮬레이터 로 부를 때 쓴다. "/시뮬레이터 모의"는 이미지 없이 단계 목록만 출력하는 점검 실행. "/시뮬레이터 정밀"은 예전 3중 검수(QA·과학·UX 3명)로 돈다.
---

# /시뮬레이터 — 교과서 이미지 → 완성 시뮬레이터 전자동 파이프라인

선생님이 하는 일은 교과서 이미지를 첨부하는 것뿐입니다. **중간에 아무것도 묻지 않고** 끝까지 실행하고, 맨 끝(6-1단계)에서만 반영·배포 여부를 한 번 묻습니다.
판단이 애매하면 합리적으로 정하고 `내가 정한 것` 목록에 쌓아 최종 보고에 적습니다.
작업 위치는 저장소 루트(`science-sim/`)입니다. 진행 상황은 작업 목록(update_plan)으로 보여 줍니다.

## 0. 모의 실행 (`/시뮬레이터 모의`, `--dry-run`)
인자에 `모의` 또는 `--dry-run`이 있으면 **아무 파일도 만들거나 바꾸지 않고** 다음만 합니다.
1. 설정 점검 결과를 표로 출력: 각 항목 ✅/❌
   - `.claude/agents/`의 7개 파일(curriculum-analyst, sim-builder, sim-reviewer, activity-writer, 정밀 모드용 qa-tester, science-reviewer, student-ux-reviewer)
   - `node tools/check-sim.mjs sample-specific-heat --no-fps`가 실행되는지(playwright 패키지 없으면 ❌, 비고에 설치 명령)
   - `.claude/settings.json` 허용 목록에 Edit·Write·`npx serve`·`git add/commit/push`·`mcp__playwright*`
   - `.mcp.json`에 playwright, playwright-science, playwright-ux 서버(`node tools/playwright-mcp.mjs` — 윈도우·리눅스 공용)
   - ToolSearch로 세 서버의 `browser_navigate`가 실제로 잡히는지, 그리고 `mcp__playwright__browser_navigate`로 `about:blank`를 실제로 열 수 있는지
     (브라우저가 없다는 오류면 ❌로 적고 "실제 실행 때 `npx -y -p @playwright/mcp@latest playwright install --with-deps chromium`로 설치함"이라고 비고에 적음)
   - `.gitignore`가 `inbox/` 이미지와 `.work/`를 제외하는지(`git check-ignore inbox/a.png .work/x`)
   - `inbox/`, `inbox/done/` 폴더(저장소에 `inbox/README.md`, `inbox/done/.gitkeep`이 있어 클론하면 생김)
   - 실행 환경: 로컬(윈도우) / 클라우드(리눅스). 클라우드면 github.io 접속이 막혀 있어 배포 확인은 GitHub Actions로 한다고 적음
   - `units.json`이 JSON으로 읽히는지, 단원 ID가 모두 새 형식(`^\d{2}-\d-\d+-\d+-\d{2}$`, 채팅 시뮬레이터는 `^chat-[a-z-]+$`, 예시 제외)인지
   - `node tools/pending.mjs` 실행 결과(반영·배포 대기 개수)
   - `git remote -v`에 origin, 현재 브랜치
2. 아래 "파이프라인" 1~7단계를 단원 ID 자리에 `<ID>`를 넣어 **단계 목록**(단계 · 담당 · 입력 → 출력 · 통과 조건)으로 출력하고 끝냅니다.

## 처음부터 설계 (공통 규칙)
- `chat-sims/`(채팅으로 만든 시뮬레이터)는 어느 단계에서도 열어 보거나 참고하지 않습니다. 각 서브에이전트에 넘기는 지시에도 "chat-sims/는 참고하지 말고 교과서 자료·설계서만 보고 처음부터"를 적습니다.

## 입력 찾기
1. 채팅에 이미지가 첨부되어 있으면 그것이 입력입니다.
   - 첨부 이미지에 파일 경로가 있으면 `inbox/`로 복사합니다.
   - 경로가 없으면(붙여 넣은 이미지) 여기서 직접 꼼꼼히 읽어 `.work/_입력/전사.md`에 글로 옮깁니다:
     쪽수, 단원 제목(대·중·소), 본문 요지, 탐구 활동 전 과정, 표·그래프 값, 그림 설명, 성취기준·학습 목표 문구.
2. 첨부가 없으면 `inbox/` 바로 아래(`done/` 제외)의 이미지(`png jpg jpeg webp heic pdf`)를 이름 순으로 모두 씁니다.
3. 둘 다 없으면 "교과서 이미지를 첨부하거나 inbox/ 폴더에 넣어 주세요" 한 줄만 말하고 끝냅니다.
- 여러 쪽이 한 단원이면 한 번에 처리합니다. 서로 다른 단원이 섞여 있으면 단원별로 파이프라인을 차례로 돌립니다.
- 교과서 이미지는 저장소에 절대 커밋하지 않습니다(`inbox/`·`.work/`는 .gitignore).

## 준비
- `git status`가 깨끗한지 확인하고(아니면 그 변경은 건드리지 않고 이번 작업 파일만 커밋), `git pull --ff-only origin main`.
- `mkdir -p inbox/done .work` (없으면 만듦).
- 로컬 서버: `npx serve -l 5173 .` 을 백그라운드로 띄웁니다(이미 떠 있으면 그대로).
- Playwright 확인: `mcp__playwright__browser_navigate`로 `http://localhost:5173/`을 엽니다.
  - 도구가 없으면(서버 연결 실패) `node tools/playwright-mcp.mjs`가 실행되는지 Bash로 확인하고, 세션을 다시 열어야 하면 그 사실을 최종 보고에 적습니다.
  - 브라우저가 없다는 오류(`Browser "chrome-for-testing" is not installed` 등)면 `npx -y -p @playwright/mcp@latest playwright install --with-deps chromium`을 실행한 뒤(1~3분) 다시 엽니다. (그냥 `npx playwright install`은 MCP와 Playwright 버전이 달라 엉뚱한 브라우저를 받으므로 쓰지 않음) 윈도우에서는 `--with-deps`를 빼도 됩니다.
- `내가 정한 것` 목록과 회차별 요약 표를 기억해 둘 곳: `.work/<ID>/진행.md`(ID가 정해진 뒤).

## 파이프라인
### 1. 설계 — `curriculum-analyst`
Agent(subagent_type: `curriculum-analyst`)에 이미지 경로들(또는 `.work/_입력/전사.md`)을 넘깁니다.
→ `단원설계서/<ID>.md`, `.work/<ID>/seed.gs`(수업용 웹앱 단원·문항·정답 — 자동 생성), 내가 정한 것.
설계서가 생겼는지, ID가 형식에 맞고 기존 폴더와 겹치지 않는지 확인합니다.
`.work/_입력/전사.md`가 있었다면 `.work/<ID>/전사.md`로 옮깁니다.

### 2. 구현 — `sim-builder`
Agent(`sim-builder`)에 `<ID>`와 설계서 경로를 넘깁니다. → `sims/<ID>/`.
sim-builder는 스스로 `node tools/check-sim.mjs <ID>`(자동 점검)를 돌려 '높음'이 없을 때까지 고친 뒤 돌려줍니다.
(가능하면 CLAUDE.md "실시간 미리보기 링크" 규칙대로 미리보기 Artifact를 띄우고 링크를 기록합니다. 안 되면 건너뜀.)

### 3. 검수 — 자동 점검 + 검수자 1명 (기본 모드)
1. Bash로 `node tools/check-sim.mjs <ID>` 실행 → `.work/<ID>/자동점검/보고서.md`. 이 보고서는 읽고 요약만 합니다(오케스트레이터가 스크린샷을 직접 보지 않음).
   - playwright 패키지가 없다는 오류면 `npm i --no-save playwright && npx playwright install chromium` 후 다시 실행.
2. Agent(`sim-reviewer`)를 부릅니다: `<ID>`, 회차 `N`, 자동 점검 보고서 경로. (과학 검산 + 학생 눈 — 기계가 못 보는 것만)
3. 보고서를 `.work/<ID>/회차<N>/검수.md`로 저장하고 `진행.md`에 한 줄: `회차 N | 자동 PASS/FAIL (높음 a, 중간 b) | 검수 PASS/FAIL (높음 c, 중간 d)`

**정밀 모드**(`/시뮬레이터 정밀`, 또는 3D·물리 엔진을 쓰는 큰 단원에서 선생님이 요청할 때만): 예전처럼 `qa-tester`·`science-reviewer`·`student-ux-reviewer` 셋을 한 메시지에서 병렬로 부르고 `.work/<ID>/회차<N>/{qa,science,ux}.md`로 저장합니다.

### 4. 수정 — `sim-builder` (최대 2회)
자동 점검이나 검수에 '높음'이 있거나 FAIL이면:
1. Agent(`sim-builder`, 새로 부름)에 `<ID>`와 이번 회차 보고서 2개(자동점검·검수) 경로를 넘겨 높음 → 중간 순으로 고치게 합니다. 쉬운 낮음은 함께 고쳐도 됩니다.
2. 다시 `node tools/check-sim.mjs <ID>` 실행(자동 점검은 매번 처음부터).
3. 검수자는 고친 것만 확인합니다: Agent(`sim-reviewer`, 새로 부름)에 회차 N+1과 직전 검수 보고서 경로를 함께 넘깁니다(전체 재검수 아님).
- 수정은 최대 2회. 모두 PASS이고 높음이 없으면 바로 다음 단계로.
- 직전 회차에 높음이 없고 중간만 있었다면 재검수 없이 자동 점검만 다시 돌리고 끝냅니다.
- 2회 수정 뒤에도 FAIL이면 멈추지 말고 다음 단계로 가되, 남은 문제를 최종 보고에 적고 `units.json`의 `status`를 `"검토 중"`으로 둡니다.

### 5. 수업 자료 — `activity-writer`
Agent(`activity-writer`)에 `<ID>`를 넘깁니다. → `activities/<ID>/활동지.md`, `교사용안내.md`, `클래스룸게시글.md`.
돌려받은 예시 답안은 `.work/<ID>/활동지-예시답안.md`에 저장(저장소 제외).
세 파일에 정답이 들어가 있지 않은지 훑어봅니다.

### 6. 등록·커밋·푸시
1. `units.json`에 항목 추가(기존 형식 그대로, id 순 정렬은 포털이 함):
   ```json
   { "id": "<ID>", "grade": <학년>, "chapter": "<대단원 로마숫자>. <대단원 이름> · <중단원 번호>. <중단원 이름>",   ← 단원설계서/_차례.md 문구 그대로
     "title": "<차시 제목>", "summary": "<한 문장, 중학생 말투>", "path": "sims/<ID>/",
     "source": "code", "dashboard": false, "gas": null }
   ```
   `status`는 넣지 않습니다. 4단계에서 2회 수정 뒤에도 FAIL로 끝난 경우에만 `"status": "검토 중"`을 더합니다(포털·대시보드에 라벨로 보임). 나중에 남은 문제를 고치면 이 줄을 지웁니다.
   `dashboard: false`라 아직 포털·대시보드에 안 보입니다(6-1단계에서 허락받으면 반영).
2. `http://localhost:5173/sims/<ID>/`가 열리는지만 확인(포털 카드 확인은 반영할 때 한 번에).
3. 커밋(한국어 메시지, 끝에 Co-Authored-By 줄): 설계서, `sims/<ID>/`, `activities/<ID>/`, `units.json`.
   커밋 전에 `git status`로 이미지·`.work/`·`inbox/`가 들어가지 않았는지 확인합니다.
4. 푸시: 현재 브랜치가 `main`이면 `git push origin main`. 다른 브랜치면 그 브랜치를 푸시하고 `main`에 합친 뒤 `git push origin main`.
5. 처리한 inbox 이미지를 `inbox/done/`으로 옮깁니다(같은 이름이 있으면 앞에 `<ID>-`를 붙임).

### 6-1. 대시보드 반영·웹앱 배포 묻기 (한 번)
1. `node tools/pending.mjs` → 대기 개수 확인(이번 단원 포함).
2. AskUserQuestion 한 번(multiSelect, 질문 하나): "만든 시뮬레이터를 어디에 반영할까요?"
   - "교사용 대시보드에 반영" — 설명: `대기 <n>개를 한꺼번에 반영`
   - "수업용 웹앱에 등록(학생 링크·문항·자동 채점)" — 설명: `대기 <m>개를 문항 대기열로 한꺼번에(10분 안에 자동 반영)`
   - (둘 다 안 고르거나 "나중에" → 아무것도 안 함, 대기로 남김)
3. 고른 것을 CLAUDE.md "대시보드 반영·웹앱 배포" 절차대로 **대기 중인 전부** 처리합니다. 대시보드는 `--mark dashboard` 후 포털·`teacher.html`을 열어 새 카드와 출처 배지를 확인하고 커밋·푸시는 한 번만.
4. AskUserQuestion이 없거나 답이 없으면(무인 실행) 묻지 않고 대기로 남긴 뒤 최종 보고에 "반영·배포 대기 n개 — '반영해 줘'·'배포해 줘'라고 하면 한꺼번에 처리"라고 적습니다.

### 7. 최종 보고 (한국어, 이 순서)
1. **완성 주소** — 시뮬레이터 `https://ksj-science.github.io/science-sim/sims/<ID>/`, 웹앱 `…/exec?unit=<ID>`, 교사용 대시보드 `…/teacher.html`, 미리보기 링크(있으면). Pages 반영 1~2분.
   반영·배포 결과: 이번에 처리한 개수, 남은 대기 개수.
2. **검수 회차별 요약** — 표: 회차 | 자동 점검 | 검수(과학·UX) | 고친 것 요약
3. **남은 문제** — 심각도와 함께(없으면 "없음")
4. **내가 정한 것** — 개정연도 판단 근거, 단원 ID·순번, 고른 아이디어와 이유, 단순화, 문항 유형, 반복 중 내린 판단 등
5. **문항 요약** — 번호·유형·문항 한 줄씩과 정답(채팅에만 — 저장소에는 없음). 웹앱 등록을 이번에 못 했으면 `.work/<ID>/seed.gs` 내용을 코드 블록으로.
6. **클래스룸 게시글 전문** — `activities/<ID>/클래스룸게시글.md` 내용 그대로
