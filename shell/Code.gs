/**
 * 과학 시뮬레이터 웹앱 (껍데기) — 학교 계정 Apps Script
 *
 * 하는 일: 학생 학번 확인 → GitHub Pages 시뮬레이터를 창 안에 표시 → 문항 표시 → 채점 → 결과 시트 기록
 * 배포: 실행 사용자 '나', 액세스 '하남중학교 도메인 내 사용자'
 * 단원 주소: <웹앱 주소>?unit=22-2-3-1-01 (클로드 코드), ?unit=chat-boyle (채팅으로 만든 chat-sims/sim_boyle.html)
 *
 * 결과 시트 탭 (setupSheets()가 만듦)
 *   문항: 단원 | 번호 | 유형(객관식/수치/단답/서술) | 문항 | 보기(|로 구분) | 단위
 *   정답: 단원 | 번호 | 정답 | 허용오차 | 배점 | 키워드(서술형, 쉼표로 구분)
 *   결과: 제출 시각 | 단원 | 학번 | 이메일 | 점수 | 만점 | 확인 필요 | 답안(JSON) | 시뮬레이터 상태(JSON)
 */

var SIM_BASE = 'https://ksj-science.github.io/science-sim/';

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.unit = String((e && e.parameter && e.parameter.unit) || '').trim();
  t.simBase = SIM_BASE;
  return t.evaluate()
    .setTitle('과학 시뮬레이터 활동')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 처음 한 번 실행: 결과 시트를 만들고 탭과 머리글을 준비합니다. */
function setupSheets() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('과학 시뮬레이터 결과');
  props.setProperty('SHEET_ID', ss.getId());
  var heads = {
    '문항': ['단원', '번호', '유형', '문항', '보기', '단위'],
    '정답': ['단원', '번호', '정답', '허용오차', '배점', '키워드'],
    '결과': ['제출 시각', '단원', '학번', '이메일', '점수', '만점', '확인 필요', '답안', '시뮬레이터 상태']
  };
  Object.keys(heads).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, heads[name].length).setValues([heads[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (first && ss.getSheets().length > 3) ss.deleteSheet(first);
  Logger.log(ss.getUrl());
  return ss.getUrl();
}

function sheet_(name) {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('결과 시트가 아직 없어요. setupSheets()를 먼저 실행해 주세요.');
  return SpreadsheetApp.openById(id).getSheetByName(name);
}

/** 학교 계정 이메일(26 + 학번 4자리 @hanam.ms.kr)에서 학번을 읽습니다. */
function whoAmI_() {
  var email = Session.getActiveUser().getEmail() || '';
  var m = /^\d{2}(\d)(\d)(\d{2})@hanam\.ms\.kr$/i.exec(email);
  if (!m) return { email: email, studentNo: '', label: email || '로그인 정보 없음' };
  return {
    email: email,
    studentNo: m[1] + m[2] + m[3],
    label: m[1] + '학년 ' + Number(m[2]) + '반 ' + Number(m[3]) + '번'
  };
}

/** 화면에 필요한 정보: 학생 표시, 문항(정답 제외), 이미 제출했는지 */
function getUnit(unit) {
  var me = whoAmI_();
  var rows = sheet_('문항').getDataRange().getValues().slice(1);
  var qs = rows.filter(function (r) { return String(r[0]) === unit; }).map(function (r) {
    return { no: String(r[1]), type: String(r[2]), text: String(r[3]),
             choices: r[4] ? String(r[4]).split('|') : [], unitLabel: String(r[5] || '') };
  });
  var done = sheet_('결과').getDataRange().getValues().slice(1).some(function (r) {
    return String(r[1]) === unit && String(r[3]) === me.email;
  });
  return { me: { label: me.label, studentNo: me.studentNo }, questions: qs, submitted: done };
}

/** 제출 → 채점 → 기록. 학생에게는 점수만 돌려줍니다. */
function submit(unit, answers, simPayload) {
  var me = whoAmI_();
  if (!me.email) throw new Error('학교 계정으로 로그인해 주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var keys = sheet_('정답').getDataRange().getValues().slice(1)
      .filter(function (r) { return String(r[0]) === unit; });
    var score = 0, total = 0, review = [];
    keys.forEach(function (k) {
      var no = String(k[1]), pts = Number(k[4]) || 1;
      total += pts;
      var g = grade_(String(k[2]), answers[no], k[3], k[5]);
      if (g === true) score += pts;
      if (g === 'review') review.push(no);
    });
    sheet_('결과').appendRow([new Date(), unit, me.studentNo, me.email, score, total,
      review.join(','), JSON.stringify(answers), JSON.stringify(simPayload || {})]);
    return { score: score, total: total, review: review.length > 0 };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 채점 규칙
 *  - 키워드가 있으면(서술형): 모두 포함 → 정답, 일부만 → 'review'(선생님 확인), 없음 → 오답
 *  - 정답이 숫자면: |답 - 정답| ≤ 허용오차
 *  - 그 밖: 공백을 빼고 정확히 같으면 정답
 */
function grade_(key, ans, tol, keywords) {
  if (ans === undefined || ans === null || String(ans).trim() === '') return false;
  var a = String(ans).trim(), squash = function (s) { return String(s).replace(/\s+/g, ''); };
  if (keywords) {
    var ks = String(keywords).split(',').map(function (s) { return s.trim(); }).filter(String);
    var hit = ks.filter(function (k) { return squash(a).indexOf(squash(k)) >= 0; }).length;
    return hit === ks.length ? true : (hit > 0 ? 'review' : false);
  }
  var n = Number(a), kn = Number(key);
  if (key !== '' && !isNaN(kn) && !isNaN(n)) return Math.abs(n - kn) <= (Number(tol) || 0) + 1e-9;
  return squash(a) === squash(key);
}
