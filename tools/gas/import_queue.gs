/**
 * 클로드 코드 문항 대기열 → 수업용 웹앱 시트 자동 가져오기
 *
 * 한 번만 설치합니다(학교 계정, 수업용 웹앱 프로젝트).
 *   1. 이 파일 내용을 프로젝트에 새 파일(import_queue.gs)로 붙여 넣고 저장
 *   2. 편집기 위쪽 함수 목록에서 installClaudeQueueTrigger 를 골라 실행 → 권한 허용(드라이브 읽기·쓰기)
 *   3. 실행 로그에 "가져옴: 22-2-3-2-02 (문항 7개)" 같은 줄이 나오면 끝
 * 이후에는 10분마다 대기열 폴더를 보고 새·수정된 단원을 [단원설정]·[문항] 탭에 넣습니다.
 * 웹앱 코드는 바뀌지 않으므로 '새 버전 배포'는 필요 없습니다.
 *
 * 대기열 폴더: 선생님 개인 드라이브 "science-sim 문항 대기열"(학교 계정에만 공유, 비공개)
 *   - 클로드가 <단원ID>.json 을 올림: { unit: [단원설정 한 줄], questions: [[문항 한 줄], ...] }
 *     열 순서는 seed.gs 와 같음
 *       단원설정: 단원ID·단원명·학년·시뮬레이터파일·피드백·최대제출횟수·공개·비고·화면배치
 *       문항: 단원ID·번호·유형·문항·보기·정답·허용오차·단위·해설·성취기준·배점
 *   - 이 스크립트가 처리하면 같은 폴더에 <단원ID>.가져옴.txt 영수증을 남김(클로드가 보고 배포 완료로 표시)
 *   - 같은 단원ID 파일이 다시 올라오면 그 단원의 설정 줄을 덮어쓰고 문항을 통째로 바꿈(문항 수정용)
 * 정답이 들어 있으므로 이 폴더와 JSON은 공개 저장소에 올리지 않습니다. (이 코드에는 정답이 없음)
 */
var CC_QUEUE_FOLDER_ID = '1PsRpHVlr3t3IulQrb0r9ly7BBOF1Zmdk';
var CC_MARK = '🛠 ';

function installClaudeQueueTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importClaudeQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importClaudeQueue').timeBased().everyMinutes(10).create();
  Logger.log('10분마다 도는 트리거를 켰습니다.');
  importClaudeQueue();
}

function importClaudeQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var folder = DriveApp.getFolderById(CC_QUEUE_FOLDER_ID);
    var props = PropertiesService.getScriptProperties();
    var done = JSON.parse(props.getProperty('CC_QUEUE_DONE') || '{}');
    var todo = [];
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (!/^\d{2}-\d-\d+-\d+-\d{2}\.json$/.test(f.getName())) continue;
      var stamp = String(f.getLastUpdated().getTime());
      if (done[f.getId()] === stamp) continue;
      todo.push({ file: f, stamp: stamp });
    }
    if (!todo.length) { Logger.log('새로 가져올 단원 없음'); return; }
    todo.sort(function (a, b) { return a.file.getDateCreated() - b.file.getDateCreated(); });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var unitSheet = ccSheet_(ss, '단원설정');
    var qSheet = ccSheet_(ss, '문항');

    todo.forEach(function (job) {
      var data = JSON.parse(job.file.getBlob().getDataAsString('UTF-8'));
      var unit = data.unit.slice();
      var id = String(unit[0]);
      if (String(unit[1]).indexOf(CC_MARK.trim()) !== 0) unit[1] = CC_MARK + unit[1];
      ccUpsertUnit_(unitSheet, id, unit);
      ccReplaceQuestions_(qSheet, id, data.questions);
      done[job.file.getId()] = job.stamp;
      var receipt = id + '.가져옴.txt';
      var old = folder.getFilesByName(receipt);
      while (old.hasNext()) { try { old.next().setTrashed(true); } catch (e) {} }
      folder.createFile(receipt, new Date().toISOString() + ' 문항 ' + data.questions.length + '개', MimeType.PLAIN_TEXT);
      Logger.log('가져옴: ' + id + ' (문항 ' + data.questions.length + '개)');
    });
    props.setProperty('CC_QUEUE_DONE', JSON.stringify(done));
  } finally {
    lock.releaseLock();
  }
}

function ccSheet_(ss, name) {
  var sh = ss.getSheetByName(name) || ss.getSheetByName('[' + name + ']');
  if (!sh) throw new Error('시트 탭을 찾을 수 없음: ' + name);
  return sh;
}

function ccUpsertUnit_(sh, id, row) {
  var last = sh.getLastRow();
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) { sh.getRange(i + 2, 1, 1, row.length).setValues([row]); return; }
    }
  }
  sh.getRange(last + 1, 1, 1, row.length).setValues([row]);
}

function ccReplaceQuestions_(sh, id, rows) {
  var last = sh.getLastRow();
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === id) sh.deleteRow(i + 2);
    }
  }
  if (!rows.length) return;
  var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  var padded = rows.map(function (r) { r = r.slice(); while (r.length < width) r.push(''); return r; });
  sh.getRange(sh.getLastRow() + 1, 1, padded.length, width).setValues(padded);
}
