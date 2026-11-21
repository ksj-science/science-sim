---
name: 시뮬레이터
description: 교과서 이미지(채팅 첨부 또는 inbox/ 폴더)를 받아 단원설계서 → 시뮬레이터 → 3중 검수(최대 3회 수정) → 활동지·교사용 안내·클래스룸 게시글 → units.json 등록·커밋·main 푸시까지 중간 확인 없이 끝까지 실행한다. 교과서 이미지만 첨부되고 다른 지시가 없을 때, 또는 /시뮬레이터 로 부를 때 쓴다. "/시뮬레이터 모의"는 이미지 없이 단계 목록만 출력하는 점검 실행.
---

# /시뮬레이터 — 교과서 이미지 → 완성 시뮬레이터 전자동 파이프라인

선생님이 하는 일은 교과서 이미지를 첨부하는 것뿐입니다. **중간에 아무것도 묻지 않고** 끝까지 실행합니다.
판단이 애매하면 합리적으로 정하고 `내가 정한 것` 목록에 쌓아 최종 보고에 적습니다.
작업 위치는 저장소 루트(`science-sim/`)입니다. 진행 상황은 작업 목록(update_plan)으로 보여 줍니다.

## 0. 모의 실행 (`/시뮬레이터 모의`, `--dry-run`)
인자에 `모의` 또는 `--dry-run`이 있으면 **아무 파일도 만들거나 바꾸지 않고** 다음만 합니다.
1. 설정 점검 결과를 표로 출력: 각 항목 ✅/❌
   - `.claude/agents/`의 6개 파일(curriculum-analyst, sim-builder, qa-tester, science-reviewer, student-ux-reviewer, activity-writer)
   - `.claude/settings.json` 허용 목록에 Edit·Write·`npx serve`·`git add/commit/push`·`mcp__playwright*`
   - `.mcp.json`에 playwright, playwright-science, playwright-ux 서버(`node tools/playwright-mcp.mjs` — 윈도우·리눅스 공용)
   - ToolSearch로 세 서버의 `browser_navigate`가 실제로 잡히는지, 그리고 `mcp__playwright__browser_navigate`로 `about:blank`를 실제로 열 수 있는지
     (브라우저가 없다는 오류면 ❌로 적고 "실제 실행 때 `npx -y playwright install chromium`으로 설치함"이라고 비고에 적음)
   - `.gitignore`가 `inbox/` 이미지와 `.work/`를 제외하는지(`git check-ignore inbox/a.png .work/x`)
   - `inbox/`, `inbox/done/` 폴더(저장소에 `inbox/README.md`, `inbox/done/.gitkeep`이 있어 클론하면 생김)
   - 실행 환경: 로컬(윈도우) / 클라우드(리눅스). 클라우드면 github.io 접속이 막혀 있어 배포 확인은 GitHub Actions로 한다고 적음
   - `units.json`이 JSON으로 읽히는지, 단원 ID가 모두 새 형식(`^\d{2}-\d-\d+-\d+-\d{2}$`, 예시 제외)인지
   - `git remote -v`에 origin, 현재 브랜치
2. 아래 "파이프라인" 1~7단계를 단원 ID 자리에 `<ID>`를 넣어 **단계 목록**(단계 · 담당 · 입력 → 출력 · 통과 조건)으로 출력하고 끝냅니다.

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
  - 브라우저가 없다는 오류면 `npx -y playwright install chromium`(리눅스에서 의존성 오류면 `npx -y playwright install --with-deps chromium`)을 실행한 뒤 다시 엽니다.
- `내가 정한 것` 목록과 회차별 요약 표를 기억해 둘 곳: `.work/<ID>/진행.md`(ID가 정해진 뒤).

## 파이프라인
### 1. 설계 — `curriculum-analyst`
Agent(subagent_type: `curriculum-analyst`)에 이미지 경로들(또는 `.work/_입력/전사.md`)을 넘깁니다.
→ `단원설계서/<ID>.md`, `.work/<ID>/정답.tsv`, 시트 `문항` 줄, 내가 정한 것.
설계서가 생겼는지, ID가 형식에 맞고 기존 폴더와 겹치지 않는지 확인합니다.
`.work/_입력/전사.md`가 있었다면 `.work/<ID>/전사.md`로 옮깁니다.

### 2. 구현 — `sim-builder`
Agent(`sim-builder`)에 `<ID>`와 설계서 경로를 넘깁니다. → `sims/<ID>/`.
(가능하면 CLAUDE.md "실시간 미리보기 링크" 규칙대로 미리보기 Artifact를 띄우고 링크를 기록합니다. 안 되면 건너뜀.)

### 3. 검수 — 3명 병렬
한 메시지에서 Agent 세 개를 동시에 부릅니다: `qa-tester`, `science-reviewer`, `student-ux-reviewer`.
각자에게 `<ID>`, 회차 `N`, 서버 주소 `http://localhost:5173/sims/<ID>/`만 넘깁니다(이전 회차 결과는 넘기지 않음).
**매 회차 새 Agent로 부릅니다**(SendMessage로 이어 쓰지 않음) — 이전 판단에 끌려가지 않게.
돌아온 보고서를 `.work/<ID>/회차<N>/{qa,science,ux}.md`로 저장하고 `진행.md`에 요약 한 줄씩:
`회차 N | QA PASS/FAIL (높음 a, 중간 b, 낮음 c) | 과학 … | UX …`

### 4. 수정 반복 — `sim-builder`
세 보고서 중 하나라도 FAIL이거나 '높음'이 있으면:
Agent(`sim-builder`, 새로 부름)에 `<ID>`와 이번 회차 보고서 3개 경로를 넘겨 고치게 한 뒤 3단계를 회차 N+1로 다시 합니다.
- 수정은 **최대 3회**(검수는 최대 4회차: 1회차 + 수정 후 재검수 3번).
- 모두 PASS이고 '높음'이 없으면 반복을 끝냅니다. 남은 중간·낮음 중 쉬운 것은 마지막 수정 때 함께 고치게 해도 됩니다.
- 3회 수정 뒤에도 FAIL이면 멈추지 말고 다음 단계로 가되, 남은 문제를 최종 보고에 그대로 적고 `units.json`의 `status`를 `"검토 중"`으로 둡니다.

### 5. 수업 자료 — `activity-writer`
Agent(`activity-writer`)에 `<ID>`를 넘깁니다. → `activities/<ID>/활동지.md`, `교사용안내.md`, `클래스룸게시글.md`.
돌려받은 예시 답안은 `.work/<ID>/활동지-예시답안.md`에 저장(저장소 제외).
세 파일에 정답이 들어가 있지 않은지 훑어봅니다.

### 6. 등록·커밋·푸시
1. `units.json`에 항목 추가(기존 형식 그대로, id 순 정렬은 포털이 함):
   ```json
   { "id": "<ID>", "grade": <학년>, "chapter": "<대단원 로마숫자>. <대단원 이름> · <중단원 번호>. <중단원 이름>",
     "title": "<차시 제목>", "summary": "<한 문장, 중학생 말투>", "path": "sims/<ID>/", "status": "검토 중" }
   ```
2. Playwright로 포털(`http://localhost:5173/`)을 열어 새 카드가 보이고 링크가 열리는지, 기존 시뮬레이터 카드도 그대로인지 확인.
3. 커밋(한국어 메시지, 끝에 Co-Authored-By 줄): 설계서, `sims/<ID>/`, `activities/<ID>/`, `units.json`.
   커밋 전에 `git status`로 이미지·`.work/`·`inbox/`가 들어가지 않았는지 확인합니다.
4. 푸시: 현재 브랜치가 `main`이면 `git push origin main`. 다른 브랜치면 그 브랜치를 푸시하고 `main`에 합친 뒤 `git push origin main`.
5. 처리한 inbox 이미지를 `inbox/done/`으로 옮깁니다(같은 이름이 있으면 앞에 `<ID>-`를 붙임).

### 7. 최종 보고 (한국어, 이 순서)
1. **완성 주소** — 시뮬레이터 `https://ksj-science.github.io/science-sim/sims/<ID>/`, 웹앱 `…/exec?unit=<ID>`, 포털, 미리보기 링크(있으면). Pages 반영 1~2분.
2. **검수 회차별 요약** — 표: 회차 | QA | 과학 | 학생 UX | 고친 것 요약
3. **남은 문제** — 심각도와 함께(없으면 "없음")
4. **내가 정한 것** — 개정연도 판단 근거, 단원 ID·순번, 고른 아이디어와 이유, 단순화, 문항 유형, 반복 중 내린 판단 등
5. **구글 시트에 넣을 단원 값** — 붙여 넣기용 탭 구분 코드 블록 두 개
   - `문항` 탭: 단원 | 번호 | 유형 | 문항 | 보기 | 단위
   - `정답` 탭: 단원 | 번호 | 정답 | 허용오차 | 배점 | 키워드 (`.work/<ID>/정답.tsv`, 채팅에만 — 저장소에는 없음)
6. **클래스룸 게시글 전문** — `activities/<ID>/클래스룸게시글.md` 내용 그대로
