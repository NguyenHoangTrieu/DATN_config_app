/* =====================================================================
   DA2 CoAP Gateway Test Widget — ThingsBoard Widget JavaScript
   Protocol: CF<cmd> hex-encoded via ThingsBoard RPC → gateway receives
             via CoAP Observe on /api/v1/{token}/rpc
   Gateway sends telemetry upstream: CoAP POST → /api/v1/{token}/telemetry

   Widget tabs:
   - Telemetry: shows last values received from the gateway via CoAP
   - RPC Send : sends a raw CF command to the gateway via ThingsBoard RPC
   ===================================================================== */

var state = {
  rpcTimeout:   30000,
  lastPingMs:   0,
  pingPending:  false,
};

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard Lifecycle
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  logInfo('CoAP Gateway Test Widget ready');
  logInfo('Gateway publishes telemetry via CoAP POST → ThingsBoard');
  logInfo('RPC commands flow: TB RPC → CoAP Observe notification → gateway');
};

self.onDataUpdated = function () {
  /* Called whenever ThingsBoard pushes new telemetry/attribute data */
  try {
    var datasources = self.ctx.defaultSubscription.data;
    if (!datasources || !datasources.length) return;

    datasources.forEach(function (ds) {
      if (!ds || !ds.data || !ds.data.length) return;
      var key = ds.dataKey && ds.dataKey.label ? ds.dataKey.label : (ds.dataKey ? ds.dataKey.key : '?');
      var val = ds.data[ds.data.length - 1];
      if (val && val.length >= 2) {
        updateTelemetryRow(key, val[1], new Date(val[0]).toLocaleTimeString());
      }
    });
  } catch (e) {}
};

self.onDestroy = function () {};

/* ────────────────────────────────────────────────────────────────────
   RPC helpers
   ──────────────────────────────────────────────────────────────────── */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs || state.rpcTimeout)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err)  { reject(err);  }
      );
  });
}

function stringToHex(str) {
  var hex = '';
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i).toString(16).toUpperCase();
    if (code.length === 1) code = '0' + code;
    hex += code;
  }
  return hex;
}

/**
 * Send a CF (config frame) command to the gateway.
 * The gateway receives it via CoAP Observe notification from ThingsBoard.
 * Encoding: ASCII text → hex string (matching BLE/UART handler format).
 */
function sendCFCommand(cfCmd, label) {
  logTx(cfCmd);
  var hexCmd = stringToHex(cfCmd);
  return sendRPC('sendCommand', hexCmd, state.rpcTimeout)
    .then(function (resp) {
      var decoded = hexDecode(resp);
      logOk((label || cfCmd) + ' → ' + (decoded || String(resp)));
      return decoded || resp;
    })
    .catch(function (err) {
      logFail((label || cfCmd) + ' failed: ' + String(err));
      throw err;
    });
}

function hexDecode(hex) {
  if (!hex || typeof hex !== 'string') return String(hex || '');
  if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length % 2 !== 0) return hex;
  var out = '';
  for (var i = 0; i < hex.length; i += 2)
    out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return out;
}

/* ────────────────────────────────────────────────────────────────────
   Telemetry table
   ──────────────────────────────────────────────────────────────────── */
var telemValues = {};

function updateTelemetryRow(key, value, timeStr) {
  telemValues[key] = { value: value, time: timeStr };
  var tbody = ge('telem-body');
  if (!tbody) return;

  var rows = tbody.querySelectorAll('tr');
  var found = false;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-key') === key) {
      rows[i].cells[1].textContent = value;
      rows[i].cells[2].textContent = timeStr;
      found = true;
      break;
    }
  }
  if (!found) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-key', key);
    tr.innerHTML = '<td class="tkey">' + escapeHtml(key) + '</td>' +
                   '<td class="tval">' + escapeHtml(String(value)) + '</td>' +
                   '<td class="ttime">' + escapeHtml(timeStr) + '</td>';
    tbody.appendChild(tr);
  }
  ge('telem-count').textContent = String(Object.keys(telemValues).length);
}

/* ────────────────────────────────────────────────────────────────────
   Actions
   ──────────────────────────────────────────────────────────────────── */

/** Send CFSC to trigger a config scan response */
function doPing() {
  if (state.pingPending) return;
  state.pingPending = true;
  state.lastPingMs = Date.now();
  ge('ping-status').textContent = 'waiting…';
  sendCFCommand('CFSC', 'CFSC (ping/scan)')
    .then(function (resp) {
      var rtt = Date.now() - state.lastPingMs;
      ge('ping-status').textContent = 'OK — ' + rtt + ' ms';
      ge('ping-status').style.color = 'var(--accent2)';
      logOk('Config scan response: ' + String(resp).slice(0, 120));
    })
    .catch(function () {
      ge('ping-status').textContent = 'timeout';
      ge('ping-status').style.color = 'var(--error)';
    })
    .then(function () { state.pingPending = false; });
}

/** Send custom raw CF command from the text input */
function sendCustomCmd() {
  var input = ge('inp-cmd');
  var raw = input.value.trim();
  if (!raw) { showToast('Enter a CF command'); return; }
  sendCFCommand(raw, 'Custom: ' + raw);
}

/** Verify CoAP is alive by requesting a CFSC */
function verifyCoapConn() {
  logInfo('Sending CFSC to verify CoAP RPC channel…');
  doPing();
}

/* ────────────────────────────────────────────────────────────────────
   Console
   ──────────────────────────────────────────────────────────────────── */
function logToConsole(cls, msg) {
  var el = ge('console-log');
  if (!el) return;
  var ts = new Date().toLocaleTimeString('en', {hour12: false});
  var line = document.createElement('div');
  line.className = cls;
  line.textContent = '[' + ts + '] ' + msg;
  el.appendChild(line);
  while (el.children.length > 200) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function logTx(m)   { logToConsole('log-tx',   '→ ' + m); }
function logOk(m)   { logToConsole('log-ok',   '✓ ' + m); }
function logFail(m) { logToConsole('log-fail', '✗ ' + m); }
function logInfo(m) { logToConsole('log-info', '  ' + m); }
function clearLog() { var e = ge('console-log'); if (e) e.innerHTML = ''; }

/* ────────────────────────────────────────────────────────────────────
   Utilities
   ──────────────────────────────────────────────────────────────────── */
function ge(id) { return document.getElementById(id); }

function showToast(msg) {
  var t = ge('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._to);
  t._to = setTimeout(function () { t.classList.add('hidden'); }, 2500);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ────────────────────────────────────────────────────────────────────
   EXPOSE EXPORTS FOR THINGSBOARD HTML ONCLICK
   ──────────────────────────────────────────────────────────────────── */
window.doPing        = doPing;
window.verifyCoapConn = verifyCoapConn;
window.sendCustomCmd  = sendCustomCmd;
window.clearLog       = clearLog;
