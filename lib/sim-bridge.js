/*
 * SimBridge — 시뮬레이터와 Apps Script 웹앱(껍데기) 사이의 통신
 *
 * 시뮬레이터 쪽 사용법
 *   SimBridge.init('2-6-02');              // 단원 ID
 *   SimBridge.setState({ volume: 40 });     // 현재 조작 상태·측정값 (덮어쓰기 병합)
 *   SimBridge.log({ t: 30, temp: 42.1 });   // 측정 기록 한 줄 추가 (표·그래프용)
 *
 * 웹앱 쪽에서 받는 메시지 (window 'message' 이벤트, origin은 https://ksj-science.github.io)
 *   { source: 'science-sim', type: 'ready' | 'state', unit, payload }
 *   payload(state) = { state: {...}, log: [...] }
 * 웹앱이 보내는 메시지
 *   { source: 'science-shell', type: 'get-state' }  → 즉시 'state'로 응답
 *   { source: 'science-shell', type: 'lock' }       → 제출 후 조작 잠금
 *
 * 웹앱 밖에서 단독으로 열어도 그대로 동작합니다(메시지만 보내지 않음).
 */
(function () {
  var embedded = window.parent && window.parent !== window;
  var bridge = {
    unit: null,
    state: {},
    records: [],
    locked: false,
    onLock: null,

    init: function (unit) {
      this.unit = unit;
      var self = this;
      window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || d.source !== 'science-shell') return;
        if (d.type === 'get-state') self._send('state');
        if (d.type === 'lock') {
          self.locked = true;
          document.documentElement.classList.add('sim-locked');
          if (typeof self.onLock === 'function') self.onLock();
        }
      });
      this._send('ready');
    },

    setState: function (obj) {
      for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) this.state[k] = obj[k];
      this._send('state');
    },

    log: function (row) {
      this.records.push(row);
      this._send('state');
    },

    clearLog: function () {
      this.records = [];
      this._send('state');
    },

    _send: function (type) {
      if (!embedded) return;
      window.parent.postMessage({
        source: 'science-sim',
        type: type,
        unit: this.unit,
        payload: { state: this.state, log: this.records }
      }, '*');
    }
  };
  window.SimBridge = bridge;
})();
