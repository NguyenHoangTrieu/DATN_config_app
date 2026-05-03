var tbbState = {
  caseTitle: 'None',
  counts: { ble: 0, zb: 0, lr: 0 },
  tick: null,
  lastTs: 0
};

self.onInit = function () {
  try {
    tbbBindBridge();
    tbbRender();
  } catch (e) {}
};

self.onDestroy = function () {
  try { window.removeEventListener('storage', tbbStorageHandler); } catch (e) {}
};

function tbbBindBridge() {
  try { window.removeEventListener('storage', tbbStorageHandler); } catch (e) {}
  window.addEventListener('storage', tbbStorageHandler);
  try {
    var raw = localStorage.getItem('da2_bw_bench_msg');
    if (raw) {
      var msg = JSON.parse(raw);
      tbbHandleBridge(msg.type, msg.payload || {});
    }
  } catch (e) {}
}

function tbbStorageHandler(e) {
  if (e.key !== 'da2_bw_bench_msg' || !e.newValue) return;
  try {
    var msg = JSON.parse(e.newValue);
    if (msg && msg.type) tbbHandleBridge(msg.type, msg.payload || {});
  } catch (e2) {}
}

function tbbHandleBridge(type, payload) {
  if (type === 'case-start') {
    tbbState.caseTitle = payload.title || payload.id || 'Running';
    tbbSetPill('run', 'Running');
    tbbLog('Case start: ' + tbbState.caseTitle);
    tbbRender();
    return;
  }

  if (type === 'case-stop') {
    tbbState.caseTitle = 'None';
    tbbSetPill('live', 'Live');
    tbbLog('Case stop');
    tbbRender();
    return;
  }

  if (type === 'config') {
    tbbSetPill('live', 'Config');
    tbbLog('Config updated');
    tbbRender();
    return;
  }

  if (type === 'bypass-line') {
    var line = payload && payload.line ? String(payload.line) : '';
    if (!line) return;
    if (/SCAN_RESULT:|SCAN_DONE:|CONNECTED:|CHAR:|SERVICE:|DISC_DONE:|DESCR_WRITE_OK:|WRITE_OK:|WRITE_NR_OK:|CFBG:/i.test(line)) {
      tbbState.counts.ble += 1;
    } else if (/CFZB:\d+:EVT:|^RPT:/i.test(line)) {
      tbbState.counts.zb += 1;
    } else if (/\+TEST:\s*RXLRPKT|\+TEST:\s*RFCFG|\+MODE:\s*TEST/i.test(line)) {
      tbbState.counts.lr += 1;
    }
    tbbState.lastTs = Date.now();
    tbbSetPill('live', 'Control Live');
    tbbLog(line);
    tbbRender();
  }
}

function tbbRender() {
  tbbSetText('tbb-case', tbbState.caseTitle);
  tbbSetText('tbb-ble', String(tbbState.counts.ble));
  tbbSetText('tbb-zb', String(tbbState.counts.zb));
  tbbSetText('tbb-lr', String(tbbState.counts.lr));
  if (tbbState.lastTs) tbbSetText('tbb-last', new Date(tbbState.lastTs).toTimeString().substr(0, 8));
  else tbbSetText('tbb-last', 'none');
}

function tbbSetPill(cls, text) {
  var el = document.getElementById('tbb-pill');
  if (!el) return;
  el.className = 'tbb-pill ' + cls;
  el.textContent = text;
}

function tbbLog(msg) {
  var el = document.getElementById('tbb-log');
  if (!el) return;
  var now = new Date().toTimeString().substr(0, 8);
  el.textContent = '[' + now + '] ' + msg + '\n' + el.textContent;
}

function tbbSetText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}
