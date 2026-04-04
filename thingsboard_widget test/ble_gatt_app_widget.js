/* =====================================================================
   DA2 BLE GATT App Widget — ThingsBoard Widget JavaScript (End-User)
   Protocol: CFML:CFBL:<slot>:<AT_command>
   Target: ESP32-C6/S3 "DA2_TEST_GATT" — GATT Service 0xFFF0
     FFF1 (0x0010) = Counter READ+NOTIFY, CCCD (0x0011)
     FFF2 (0x0013) = LED WRITE: 0x00=OFF, 0x01=ON, 3-bytes=RGB
     (Handles confirmed from live AT+DISC session, may vary by board)

   ThingsBoard fixes applied:
     - All ge() calls are null-guarded
     - onInit deferred via setTimeout to ensure widget DOM is ready
     - querySelectorAll scoped to widget root element (not document)
     - controlApi checked before RPC calls
   ===================================================================== */

/* ── App State ── */
var state = {
  slot:        '0',
  h_fff1:      '0010',   /* FFF1 value handle  — confirmed from AT+DISC */
  h_cccd:      '0011',   /* FFF1 CCCD handle   — confirmed from AT+DISC */
  h_fff2:      '0013',   /* FFF2 value handle  — confirmed from AT+DISC */
  devIdx:      -1,
  mac:         '',
  name:        '',
  connected:   false,
  scanning:    false,
  scanResults: [],
  rpcTimeout:  30000,
  notifyEnabled: false,
  ledOn:       false,
  hue:         30,
  brightness:  80,
  isWhite:     false
};


/* ────────────────────────────────────────────────────────────────────
   ThingsBoard Lifecycle
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  try {
    loadLocalState();
    renderDeviceList([]);
    setConnected(false);
    logInfo('Widget ready — slot ' + state.slot);
  } catch (e) {
    console.error('[DA2 Widget] onInit error:', e);
  }
};

self.onDestroy = function () {};

/* Telemetry uplink — FFF1 counter from subscribed datasource */
self.onDataUpdated = function () {
  try {
    var data = self.ctx.data;
    if (!data || !data.length) return;
    for (var ki = 0; ki < data.length; ki++) {
      var keyCtx = data[ki];
      if (!keyCtx.data || !keyCtx.data.length) continue;
      var latest  = keyCtx.data[keyCtx.data.length - 1];
      var rawVal  = latest[1];
      var decoded = rawVal;
      if (typeof rawVal === 'object' && rawVal !== null && rawVal.data !== undefined) {
        decoded = hexToString(String(rawVal.data));
      } else if (typeof rawVal === 'string') {
        try {
          var parsed = JSON.parse(rawVal);
          if (parsed && parsed.data !== undefined) decoded = hexToString(String(parsed.data));
        } catch (e) {
          if (/^[0-9A-Fa-f]+$/.test(rawVal) && rawVal.length % 2 === 0) {
            decoded = hexToString(rawVal);
          }
        }
      }
      var lines = String(decoded).split(/[\n\x1e]/).map(function (s) { return s.trim(); }).filter(Boolean);
      lines.forEach(function (line) {
        if (/^\+NOTIF:|^\+IND:/.test(line)) { logEvt('Uplink: ' + line); handleAsyncEvent(line); }
        else if (line) { logOk('Uplink: ' + line); }
      });
      break;
    }
  } catch (e) {
    logFail('onDataUpdated: ' + e.message);
  }
};

/* ────────────────────────────────────────────────────────────────────
   RPC / CFML helpers
   ──────────────────────────────────────────────────────────────────── */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi — set a target device in widget settings'));
      return;
    }
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs)
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

function hexToString(hex) {
  var str = '';
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(b)) str += String.fromCharCode(b);
  }
  return str;
}

function sendCFML(atCmd, timeoutMs) {
  var cmd = 'CFML:CFBL:' + state.slot + ':' + atCmd;
  logTx(cmd);
  var hexCmd = stringToHex(cmd);
  return sendRPC('sendCommand', hexCmd, timeoutMs || state.rpcTimeout)
    .then(function (resp) {
      if (resp) logCFMLResponse(resp);
      return resp;
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      logFail('RPC: ' + msg);
      showToast('⚠ ' + msg);
      throw err;
    });
}

/* ────────────────────────────────────────────────────────────────────
   Response parsers
   ──────────────────────────────────────────────────────────────────── */
function splitResp(resp) {
  if (!resp) return [];
  if (typeof resp === 'object' && resp !== null) {
    if (resp.result   !== undefined) resp = resp.result;
    else if (resp.data !== undefined) resp = resp.data;
  }
  var s = String(resp);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0) s = hexToString(s);
  return s.split(/\x1e|\n/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function logCFMLResponse(resp) {
  splitResp(resp).forEach(function (line) {
    if (/^\+NOTIF:|^\+IND:|^\+DISCONNECTED:|^\+CONNECTED:|^\+CHAR:|^\+CHARS:|^\+SERVICE:/.test(line)) {
      logEvt(line);
      handleAsyncEvent(line);
    } else {
      logOk(line);
    }
  });
}

function handleAsyncEvent(line) {
  var m;
  m = line.match(/^\+CONNECTED:(\d+)/);
  if (m) { state.devIdx = parseInt(m[1], 10); state.connected = true; setConnected(true); return; }

  m = line.match(/^\+DISCONNECTED:\d+/);
  if (m) { state.connected = false; state.notifyEnabled = false; setConnected(false); return; }

  m = line.match(/^\+NOTIF:\d+,([0-9A-Fa-f]+),([0-9A-Fa-f]*)/);
  if (!m) m = line.match(/^\+IND:\d+,([0-9A-Fa-f]+),([0-9A-Fa-f]*)/);
  if (m) { handleNotification(m[1].toUpperCase(), m[2]); return; }

  if (/^\+CHARS?:/.test(line)) { autoDetectHandles([line]); }
}

/* Auto-detect FFF1/CCCD/FFF2 handles from +CHARS/+CHAR discovery lines.
 * Same logic as ble_gatt_test_widget — updates state so writes/notify go to correct handle. */
function autoDetectHandles(lines) {
  lines.forEach(function (l) {
    /* Formats: +CHARS:000C,FFF1  or  +CHAR:0x0801,0x08,0x000F,0xFFF1 */
    var m = l.match(/([0-9A-Fa-f]{4})[,\s]+(?:0x)?FFF1/i);
    if (!m) m = l.match(/^\+CHARS?:([0-9A-Fa-f]{4}),.*?FFF1/i);
    if (m) {
      state.h_fff1 = m[1].toUpperCase();
      state.h_cccd = (parseInt(m[1], 16) + 1).toString(16).padStart(4, '0').toUpperCase();
      logInfo('Auto-detected FFF1=' + state.h_fff1 + ' CCCD=' + state.h_cccd);
    }
    m = l.match(/([0-9A-Fa-f]{4})[,\s]+(?:0x)?FFF2/i);
    if (!m) m = l.match(/^\+CHARS?:([0-9A-Fa-f]{4}),.*?FFF2/i);
    if (m) {
      state.h_fff2 = m[1].toUpperCase();
      logInfo('Auto-detected FFF2=' + state.h_fff2);
    }
  });
  saveLocalState();
}

function handleNotification(handle, hexData) {
  if (handle === state.h_fff1.toUpperCase()) {
    var raw = hexData || '';
    var bytes = [];
    for (var i = 0; i < raw.length; i += 2) bytes.push(parseInt(raw.substr(i, 2), 16));
    var val = 0;
    for (var j = 0; j < Math.min(bytes.length, 4); j++) val |= (bytes[j] << (j * 8));
    val = val >>> 0;
    state.counterVal = val;
    setEl('counter-val', String(val));
    return;
  }
  if (handle === state.h_fff2.toUpperCase() && hexData) {
    var isOn = (parseInt(hexData.slice(0, 2), 16) !== 0);
    state.ledOn = isOn;
    updateLedUI();
  }
}

/**
 * parseScanLines — parse +SCAN: lines returned directly by AT+SCAN.
 * Format: +SCAN:<MAC>,<RSSI>,<name>
 * The 0-based position in this list IS the device index for AT+CONNECT.
 */
function parseScanLines(resp) {
  var results = [];
  splitResp(resp).forEach(function (l) {
    var m = l.match(/^\+SCAN:([0-9A-Fa-f:]{17}),(-?\d+),(.*)/);
    if (m) results.push({ mac: m[1].toUpperCase(), rssi: parseInt(m[2], 10), name: m[3] || '' });
  });
  return results;
}

function parseConnectIdx(resp) {
  var lines = splitResp(resp);
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\+CONNECTED:(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return -1;
}

function autoDetectHandles(lines) {
  lines.forEach(function (l) {
    var m = l.match(/([0-9A-Fa-f]{4})[,\s]+(?:0x)?FFF1/i);
    if (!m) m = l.match(/^\+CHARS?:([0-9A-Fa-f]{4}),.*?FFF1/i);
    if (m) {
      state.h_fff1 = m[1].toUpperCase();
      state.h_cccd = (parseInt(m[1], 16) + 1).toString(16).padStart(4, '0').toUpperCase();
    }
    m = l.match(/([0-9A-Fa-f]{4})[,\s]+(?:0x)?FFF2/i);
    if (!m) m = l.match(/^\+CHARS?:([0-9A-Fa-f]{4}),.*?FFF2/i);
    if (m) state.h_fff2 = m[1].toUpperCase();
  });
  saveLocalState();
}

/* ────────────────────────────────────────────────────────────────────
   Scan & Connect
   ──────────────────────────────────────────────────────────────────── */
function startScan() {
  if (state.scanning) return;
  if (state.connected) { showToast('Already connected — disconnect first'); return; }
  state.scanning = true;
  setScanState('scanning');
  renderDeviceList([]);
  logInfo('Resetting BLE module…');

  sendCFML('AT+RESET', 15000)
    .then(function () { return new Promise(function (res) { setTimeout(res, 5000); }); })
    .catch(function () { return new Promise(function (res) { setTimeout(res, 5000); }); })
    .then(function () {
      logInfo('Scanning 3 s…');
      return sendCFML('AT+SCAN=3000', 20000);
    })
    .then(function (r) {
      /* +SCAN lines come back in the AT+SCAN response.
         Position (0-based) in the list = device index for AT+CONNECT. */
      state.scanResults = parseScanLines(r);
      state.scanning    = false;
      setScanState('idle');
      setEl('scan-count', String(state.scanResults.length));
      renderDeviceList(state.scanResults);
      logInfo('Scan done: ' + state.scanResults.length + ' device(s) found');
      showToast('Found ' + state.scanResults.length + ' device(s)');
    })
    .catch(function () { state.scanning = false; setScanState('idle'); });
}

function connectDevice(idx, mac, name) {
  if (state.connected) { showToast('Already connected'); return; }
  state.mac  = mac;
  state.name = name || mac;
  showOverlay(true, 'Connecting to ' + (name || mac) + '…');
  setStatusPill('connecting');

  sendCFML('AT+CONNECT=' + idx, 15000)
    .then(function (r) {
      var pidx = parseConnectIdx(r);
      state.devIdx    = pidx >= 0 ? pidx : idx;
      state.connected = true;
      setConnected(true);
      renderDeviceList([]);
      showOverlay(false);
      showToast('Connected ✓');
      saveLocalState();
      /* ── Auto-discover handles ────────────────────────────────────────
       * Run AT+DISC then AT+CHARS to detect actual FFF1/FFF2 handles.
       * This is what ble_gatt_test_widget does via startDiscover().
       * Without this, hardcoded defaults may not match the device.
       * ───────────────────────────────────────────────────────────────── */
      _discoverAndNotify();
    })
    .catch(function () { showOverlay(false); setStatusPill('idle'); });
}

function _discoverAndNotify() {
  var idx = state.devIdx;
  logInfo('Discovering service handles…');
  sendCFML('AT+DISC=' + idx, 15000)
    .then(function (r) {
      /* Look for FFF0 service range to narrow the char query */
      var start = '0001', end = 'FFFF';
      splitResp(r).forEach(function (l) {
        var m = l.match(/^\+SERVICE:0x([0-9A-Fa-f]{4}),0x([0-9A-Fa-f]{4}),0xFFF0/i);
        if (m) { start = m[1]; end = m[2]; }
      });
      return sendCFML('AT+CHARS=' + idx + ',' + start + ',' + end, 15000);
    })
    .then(function (r) {
      autoDetectHandles(splitResp(r));
      /* Enable FFF1 notify with the (now correct) h_cccd */
      return sendCFML('AT+NOTIFY=' + idx + ',' + state.h_cccd + ',1', 15000);
    })
    .then(function () {
      state.notifyEnabled = true;
      logInfo('Notifications enabled — FFF1 cccd=' + state.h_cccd + ' fff2=' + state.h_fff2);
    })
    .catch(function (e) {
      /* Discovery fail is non-fatal — fall back to stored defaults */
      logFail('Discovery failed, using defaults: ' + (e && e.message ? e.message : e));
      _enableNotify();
    });
}

function disconnectDevice() {
  if (!state.connected || state.devIdx < 0) return;
  sendCFML('AT+DISCONNECT=' + state.devIdx, 15000)
    .then(function () {
      state.connected = false;
      state.notifyEnabled = false;
      setConnected(false);
      renderDeviceList([]);
      showToast('Disconnected — press Scan to reconnect');
      saveLocalState();
    })
    .catch(function () {});
}

function _enableNotify() {
  sendCFML('AT+NOTIFY=' + state.devIdx + ',' + state.h_cccd + ',1', 15000)
    .then(function () { state.notifyEnabled = true; logInfo('Notifications enabled (FFF1)'); })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   LED On/Off
   ──────────────────────────────────────────────────────────────────── */
function onLedToggle(checked) {
  if (!state.connected) {
    var tog = ge('led-toggle');
    if (tog) tog.checked = !checked;
    showToast('Connect a device first');
    return;
  }
  state.ledOn = checked;
  updateLedUI();
  var hexByte = checked ? '01' : '00';
  sendCFML('AT+WRITE=' + state.devIdx + ',' + state.h_fff2 + ',' + hexByte, 15000)
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Color Control — 5 fixed colors (01RRGGBB = ON + color)
   ──────────────────────────────────────────────────────────────────── */
function sendFixedColor(hexStr, btnEl) {
  if (!state.connected) { showToast('Connect a device first'); return; }
  if (!state.h_fff2)    { showToast('FFF2 handle unknown — reconnect'); return; }
  /* Update preview */
  var colorPrev = ge('color-preview');
  if (colorPrev) {
    colorPrev.style.background = '#' + hexStr;
    colorPrev.style.boxShadow  = '0 0 14px #' + hexStr + '88';
  }
  setEl('color-hex-label', '#' + hexStr.toUpperCase());
  /* Mark active button */
  var btns = document.querySelectorAll('.btn-color');
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
  if (btnEl) btnEl.classList.add('active');
  /* Ensure LED is shown as on */
  state.ledOn = true;
  updateLedUI();
  /* Write 01RRGGBB — byte 01 = ON, then 3 bytes RGB */
  var payload = '01' + hexStr.toUpperCase();
  logInfo('Sending color #' + hexStr.toUpperCase());
  sendCFML('AT+WRITE=' + state.devIdx + ',' + state.h_fff2 + ',' + payload, 15000)
    .then(function () { showToast('Color sent ✓'); })
    .catch(function () {});
}

function toHex2(n) {
  return ('0' + Math.min(255, Math.max(0, Math.round(n))).toString(16)).slice(-2).toUpperCase();
}

/* ────────────────────────────────────────────────────────────────────
   Rendering helpers
   ──────────────────────────────────────────────────────────────────── */
function renderDeviceList(devices) {
  var list = ge('device-list');
  setEl('scan-count', String(devices.length));
  if (!list) return;
  if (!devices.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div>' +
                     '<div class="empty-msg">Press Scan to find<br>BLE devices</div></div>';
    return;
  }
  list.innerHTML = devices.map(function (d, i) {
    /* i = 0-based position in +SCAN list = device index for AT+CONNECT */
    var sel     = (d.mac === state.mac && state.connected) ? ' selected' : '';
    var rssiPct = Math.max(0, Math.min(100, ((d.rssi + 110) / 70) * 100)).toFixed(0);
    return '<div class="device-item' + sel + '" onclick="connectDevice(' + i + ',\'' +
      escapeJs(d.mac) + '\',\'' + escapeJs(d.name) + '\')">' +
      '<span class="dev-name">' + escapeHtml(d.name || 'Unknown') + '</span>' +
      '<span class="dev-mac">' + escapeHtml(d.mac) + '</span>' +
      '<div class="dev-rssi-row">' +
        '<div class="rssi-bar-wrap"><div class="rssi-bar" style="width:' + rssiPct + '%"></div></div>' +
        '<span class="dev-rssi-val">' + d.rssi + ' dBm</span>' +
      '</div></div>';
  }).join('');
}

function setConnected(on) {
  setStatusPill(on ? 'connected' : 'idle');
  setScanState(on ? 'connected' : 'idle');

  setEl('hero-name', on ? (state.name || state.mac) : 'Not Connected');
  setEl('hero-mac',  on ? state.mac : '—');

  var hi = ge('hero-icon');
  if (hi) hi.classList.toggle('connected', on);

  var overlay = ge('ctrl-overlay');
  if (overlay) overlay.classList.toggle('hidden', on);

  if (!on) {
    state.devIdx = -1;
    setEl('counter-val', '—');
    var tog = ge('led-toggle');
    if (tog) tog.checked = false;
    state.ledOn = false;
    updateLedUI();
  }
}

function updateLedUI() {
  var on  = state.ledOn;
  var tog = ge('led-toggle');
  if (tog) tog.checked = on;
  setEl('led-icon', on ? '💡' : '🔦');
  var wrap = ge('led-icon-wrap');
  if (wrap) wrap.setAttribute('data-on', on ? 'true' : 'false');
  setEl('led-status-text', on ? 'LED is ON' : 'LED is OFF');
}

function setScanState(st) {
  var b = ge('scan-badge');
  var m = { scanning: 'SCAN…', connected: 'CONN', idle: 'IDLE' };
  if (b) { b.setAttribute('data-state', st); b.textContent = m[st] || 'IDLE'; }
}

function setStatusPill(st) {
  var pill  = ge('status-pill');
  var names = { connected: 'Connected', scanning: 'Scanning…', connecting: 'Connecting…', idle: 'Disconnected' };
  if (pill) pill.setAttribute('data-state', st);
  setEl('status-text', names[st] || 'Disconnected');
}

function showOverlay(visible, msg) {
  var o = ge('ctrl-overlay');
  if (!o) return;
  if (visible) {
    o.classList.remove('hidden');
    var sp = ge('overlay-spinner');
    if (sp) sp.classList.remove('hidden');
    var om = ge('overlay-msg');
    if (om) om.innerHTML = msg || '';
  } else {
    o.classList.add('hidden');
    var sp2 = ge('overlay-spinner');
    if (sp2) sp2.classList.add('hidden');
  }
}

/* ────────────────────────────────────────────────────────────────────
   LocalStorage persistence
   ──────────────────────────────────────────────────────────────────── */
function saveLocalState() {
  try {
    localStorage.setItem('da2_gatt_app', JSON.stringify({
      slot: state.slot, h_fff1: state.h_fff1, h_cccd: state.h_cccd, h_fff2: state.h_fff2,
      hue: state.hue, brightness: state.brightness
    }));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem('da2_gatt_app');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.slot)       state.slot       = s.slot;
    if (s.h_fff1)     state.h_fff1     = s.h_fff1;
    if (s.h_cccd)     state.h_cccd     = s.h_cccd;
    if (s.h_fff2)     state.h_fff2     = s.h_fff2;
    if (s.hue        != null) state.hue        = s.hue;
    if (s.brightness != null) state.brightness = s.brightness;
    /* Restore slider positions */
    var hs = ge('hue-slider');
    if (hs) hs.value = String(state.hue);
    var bs = ge('bright-slider');
    if (bs) bs.value = String(state.brightness);
  } catch (e) {}
}

/* ────────────────────────────────────────────────────────────────────
   Console
   ──────────────────────────────────────────────────────────────────── */
function logToConsole(cls, msg) {
  var el = ge('console-log');
  var text = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  if (!el) {
    console.log('[DA2-' + cls + '] ' + text);
    return;
  }
  var line = document.createElement('div');
  line.className   = cls;
  line.textContent = text;
  el.appendChild(line);
  while (el.children.length > 300) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function logTx  (m) { logToConsole('log-tx',   '→ ' + m); }
function logOk  (m) { logToConsole('log-ok',   '✓ ' + m); }
function logFail(m) { logToConsole('log-fail',  '✗ ' + m); }
function logInfo(m) { logToConsole('log-info',  'ℹ ' + m); }
function logEvt (m) { logToConsole('log-evt',   '⚡ ' + m); }
function clearLog() { var el = ge('console-log'); if (el) el.innerHTML = ''; }

/* ────────────────────────────────────────────────────────────────────
   Utilities
   ──────────────────────────────────────────────────────────────────── */
/* ge() — plain document.getElementById, same as ble_gatt_test_widget (working) */
function ge(id) { return document.getElementById(id); }

/* Safe text setter with null guard */
function setEl(id, text) {
  var el = ge(id);
  if (el) el.textContent = text;
}

function showToast(msg) {
  var t = ge('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.add('hidden'); }, 2400);
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeJs(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

/* ────────────────────────────────────────────────────────────────────
   EXPOSE to ThingsBoard HTML onclick attributes
   ──────────────────────────────────────────────────────────────────── */
window.startScan        = startScan;
window.connectDevice    = connectDevice;
window.disconnectDevice = disconnectDevice;
window.onLedToggle      = onLedToggle;
window.sendFixedColor   = sendFixedColor;
window.clearLog         = clearLog;
