/* =====================================================================
   DA2 BLE GATT Test Widget — ThingsBoard Widget JavaScript
   Protocol: CFML:CFBL:<slot>:<AT_command>
   Routing: CF=config frame → WAN MCU → ML=MCU LAN → CFBL=BLE handler
   Target: ESP32-C6 "DA2_TEST_GATT"
     Service 0xFFF0:
       FFF1 (handle ~0009) = Counter, READ + NOTIFY, CCCD (~000A)
       FFF2 (handle ~000C) = LED control, WRITE (0x01=ON, 0x00=OFF)
   ===================================================================== */

var state = {
  slot:      '0',
  proto:     'http',   /* active protocol under test: http | coap | mqtt */
  h_fff1:    '0009',   /* FFF1 characteristic handle */
  h_cccd:    '000A',   /* CCCD descriptor handle for FFF1 */
  h_fff2:    '000C',   /* FFF2 characteristic handle */
  devIdx:    -1,       /* STM32WB device index after connect */
  mac:       '',
  name:      '',
  connected: false,
  scanning:  false,
  scanResults: [],
  rpcTimeout: 30000,
  notifyEnabled: false,
  ledState:  false,
  counterVal: 0
};

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard Lifecycle
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  loadLocalState();
  syncConfigBar();
  renderDeviceList([]);
};

self.onDestroy = function () {};

/* Telemetry uplink — called by ThingsBoard when subscribed datasource updates */
self.onDataUpdated = function () {
  try {
    var data = self.ctx.data;
    if (!data || !data.length) return;
    /* Iterate all subscribed keys; look for "data" key (our telemetry format) */
    for (var ki = 0; ki < data.length; ki++) {
      var keyCtx = data[ki];
      var keyName = keyCtx.dataKey && keyCtx.dataKey.name ? keyCtx.dataKey.name : '';
      if (!keyCtx.data || !keyCtx.data.length) continue;
      var latest = keyCtx.data[keyCtx.data.length - 1];
      var rawVal = latest[1];  /* [timestamp, value] */
      ge('telem-raw').textContent = 'key: ' + keyName + '  ts: ' + new Date(latest[0]).toLocaleTimeString();
      /* If the value is a JSON object with "data" field (our {"data":"HEX"} format) */
      var decoded = rawVal;
      if (typeof rawVal === 'object' && rawVal !== null && rawVal.data !== undefined) {
        decoded = hexToString(String(rawVal.data));
      } else if (typeof rawVal === 'string') {
        /* Try parse as JSON */
        try {
          var parsed = JSON.parse(rawVal);
          if (parsed && parsed.data !== undefined) decoded = hexToString(String(parsed.data));
        } catch (e) {
          /* plain string — try hex decode */
          if (/^[0-9A-Fa-f]+$/.test(rawVal) && rawVal.length % 2 === 0) {
            decoded = hexToString(rawVal);
          }
        }
      }
      ge('telem-val').textContent = decoded;
      /* Check for BLE notifications within decoded string */
      var lines = decoded.split(/[\n\x1e]/).map(function(s){return s.trim();}).filter(Boolean);
      lines.forEach(function(line) {
        if (/^\+NOTIF:|^\+IND:/.test(line)) { logEvt('Uplink: ' + line); handleAsyncEvent(line); }
        else if (line) { logOk('Uplink: ' + line); }
      });
      break; /* process first matching key */
    }
  } catch (e) {
    logFail('onDataUpdated error: ' + e.message);
  }
};

/* ────────────────────────────────────────────────────────────────────
   RPC / CFML helpers
   ──────────────────────────────────────────────────────────────────── */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
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
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
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
      logFail('RPC error: ' + (err && err.message ? err.message : String(err)));
      throw err;
    });
}

/* ────────────────────────────────────────────────────────────────────
   Config-bar events
   ──────────────────────────────────────────────────────────────────── */
function onSlotChange(v) {
  state.slot = v;
  saveLocalState();
}

function onProtoChange(v) {
  state.proto = v;
  var badge = ge('proto-badge');
  if (badge) { badge.setAttribute('data-proto', v); badge.textContent = v.toUpperCase(); }
  logInfo('Protocol under test: ' + v.toUpperCase());
  saveLocalState();
}

/* ────────────────────────────────────────────────────────────────────
   Response parsers
   ──────────────────────────────────────────────────────────────────── */
function splitResp(resp) {
  if (!resp) return [];

  // Unwrap the object formats the gateway / ThingsBoard may deliver:
  //   { data:   "HEX_OR_TEXT" }  — old telemetry wrapper
  //   { result: "CFML:0:OK:..." } — new RPC response wrapper (gateway sends this)
  if (typeof resp === 'object' && resp !== null) {
    if (resp.result !== undefined)  resp = resp.result;        // ← NEW: RPC response
    else if (resp.data !== undefined) resp = resp.data;        // old telemetry
  }

  var strResp = String(resp);
  // Hex-encoded string → decode first
  if (/^[0-9A-Fa-f]+$/.test(strResp) && strResp.length % 2 === 0) {
    strResp = hexToString(strResp);
  }

  return strResp.split(/\x1e|\n/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function logCFMLResponse(resp) {
  splitResp(resp).forEach(function (line) {
    if (/^\+NOTIF:|^\+IND:|^\+DISCONNECTED:|^\+CONNECTED:|^\+CHAR:|^\+CHARS:|^\+SERVICE:/.test(line)) {
      logEvt(line);
      handleAsyncEvent(line);
      /* Also print discovery logs to the discovery box */
      if (/^\+CHAR:|^\+CHARS:|^\+SERVICE:/.test(line)) {
        logOk(line);
      }
    } else {
      logOk(line);
    }
  });
}

function handleAsyncEvent(line) {
  var m;

  /* +CONNECTED:<idx>  (echoed async) */
  m = line.match(/^\+CONNECTED:(\d+)/);
  if (m) {
    state.devIdx   = parseInt(m[1], 10);
    state.connected = true;
    setConnected(true);
    return;
  }

  /* +DISCONNECTED:<idx> */
  m = line.match(/^\+DISCONNECTED:\d+/);
  if (m) {
    state.connected = false;
    state.notifyEnabled = false;
    setConnected(false);
    return;
  }

  /* +NOTIF:<idx>,<handle>,<hex>  — FFF1 counter notification */
  m = line.match(/^\+NOTIF:\d+,([0-9A-Fa-f]+),([0-9A-Fa-f]*)/);
  if (m) {
    handleNotification(m[1].toUpperCase(), m[2]);
    return;
  }

  /* +IND:<idx>,<handle>,<hex>  — indication variant */
  m = line.match(/^\+IND:\d+,([0-9A-Fa-f]+),([0-9A-Fa-f]*)/);
  if (m) {
    handleNotification(m[1].toUpperCase(), m[2]);
    return;
  }

  /* Async Discovery Events */
  if (/^\+CHARS?:/.test(line)) {
    autoDetectHandles([line]);
    return;
  }
}

function handleNotification(handle, hexData) {
  /* FFF1 counter — parse as little-endian uint32 */
  if (handle === state.h_fff1.toUpperCase()) {
    var raw = hexData || '';
    /* Try to interpret as uint32 LE (4 bytes) or uint8 (1 byte) */
    var bytes = [];
    for (var i = 0; i < raw.length; i += 2) bytes.push(parseInt(raw.substr(i, 2), 16));
    var val = 0;
    for (var j = 0; j < Math.min(bytes.length, 4); j++) val |= (bytes[j] << (j * 8));
    val = val >>> 0;  /* treat as unsigned */
    state.counterVal = val;
    ge('counter-val').textContent = String(val);
    ge('counter-raw').textContent = 'raw: 0x' + raw.toUpperCase();
    return;
  }
  /* FFF2 echo (if ESP32-C6 echoes write) */
  if (handle === state.h_fff2.toUpperCase() && hexData) {
    var isOn = (parseInt(hexData.slice(0, 2), 16) !== 0);
    state.ledState = isOn;
    updateLedUI();
  }
}

function parseScanLines(resp) {
  var results = [];
  splitResp(resp).forEach(function (l) {
    /* +SCAN:<MAC>,<RSSI>,<NAME>  or  +DEV:<MAC>,<RSSI>,<NAME> */
    var m = l.match(/^\+(?:SCAN|DEV):([0-9A-Fa-f:]{17}),(-?\d+),(.*)/);
    if (m) results.push({ mac: m[1].toUpperCase(), rssi: parseInt(m[2],10), name: m[3] || '' });
  });
  return results;
}

function parseConnectIdx(resp) {
  for (var _, lines = splitResp(resp), i = 0; i < lines.length; i++) {
    _ = lines[i].match(/^\+CONNECTED:(\d+)/);
    if (_) return parseInt(_[1], 10);
  }
  return -1;
}

/* ────────────────────────────────────────────────────────────────────
   Scan & Connect
   ──────────────────────────────────────────────────────────────────── */
function startScan() {
  if (state.scanning) return;
  state.scanning = true;
  setScanBadge('scanning');
  renderDeviceList([]);
  logInfo('Resetting module…');
  
  sendCFML('AT+RESET', 8000)   /* 8 s: BLE module needs ~3-5 s to reset fully */
    .then(function() {
      return new Promise(function(res) { setTimeout(res, 5000); });
    })
    .catch(function() {
      return new Promise(function(res) { setTimeout(res, 5000); });
    })
    .then(function() {
      logInfo('Scanning 3 s…');
      return sendCFML('AT+SCAN=3000', 20000);
    })
    .then(function (r) {
      state.scanResults = parseScanLines(r);
      state.scanning    = false;
      setScanBadge('idle');
      ge('scan-count').textContent = String(state.scanResults.length);
      renderDeviceList(state.scanResults);
      showToast('Found ' + state.scanResults.length + ' device(s)');
    })
    .catch(function () { state.scanning = false; setScanBadge('idle'); });
}

function connectDevice(idx, mac, name) {
  if (state.connected) { showToast('Already connected'); return; }
  state.mac  = mac;
  state.name = name || mac;
  showOverlay(true, 'Connecting to ' + (name || mac) + '…');
  sendCFML('AT+CONNECT=' + idx, 10000)
    .then(function (r) {
      var parsedIdx = parseConnectIdx(r);
      if (parsedIdx >= 0) {
        state.devIdx = parsedIdx;
      } else {
        /* Keep the originally requested index if not specified in response */
        state.devIdx = idx;
      }
      state.connected = true;
      setConnected(true);
      showOverlay(false);
      showToast('Connected ✓');
      saveLocalState();
    })
    .catch(function () { showOverlay(false); });
}

function disconnectDevice() {
  if (!state.connected || state.devIdx < 0) return;
  sendCFML('AT+DISCONNECT=' + state.devIdx, 5000)
    .then(function () { state.connected = false; state.notifyEnabled = false; setConnected(false); showToast('Disconnected'); saveLocalState(); })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Service Discovery
   ──────────────────────────────────────────────────────────────────── */
function startDiscover() {
  if (!state.connected) { showToast('Connect first'); return; }
  logInfo('Discovering services…');
  var idx = state.devIdx;
  var start = '0001', end = 'FFFF';
  sendCFML('AT+DISC=' + idx, 6000)
    .then(function (r) {
      var lines = splitResp(r);
      appendDiscResults(lines);
      
      /* Look for the FFF0 service range in the discovery results */
      lines.forEach(function(l) {
        var m = l.match(/^\+SERVICE:0x([0-9A-Fa-f]{4}),0x([0-9A-Fa-f]{4}),0xFFF0/i);
        if (m) {
          start = m[1];
          end = m[2];
        }
      });
      
      /* Query only the FFF0 custom service range to avoid STM32 GATT buffer overflows */
      logInfo('Querying chars in range ' + start + ' to ' + end + '…');
      return sendCFML('AT+CHARS=' + idx + ',' + start + ',' + end, 6000);
    })
    .then(function (r) {
      appendDiscResults(splitResp(r));
      /* Auto-detect FFF1 / CCCD / FFF2 handles from discovery */
      autoDetectHandles(splitResp(r));
      showToast('Discovery complete');
    })
    .catch(function () {});
}

function autoDetectHandles(lines) {
  /* Look for FFF1/FFF2 UUID in +CHARS or +CHAR lines */
  lines.forEach(function (l) {
    /* Handle formats: 
       +CHARS:000C,FFF1
       +CHAR:0x0801,0x08,0x000F,0xFFF1 (ST Firmware format) 
    */
    var m = l.match(/([0-9A-Fa-f]{4})[,\s]+(?:0x)?FFF1/i);
    if (!m) m = l.match(/^\+CHARS?:([0-9A-Fa-f]{4}),.*?FFF1/i);
    if (m) {
      state.h_fff1 = m[1].toUpperCase();
      /* CCCD is typically handle+1 */
      state.h_cccd = (parseInt(m[1],16) + 1).toString(16).padStart(4,'0').toUpperCase();
      ge('cfg-fff1').value = state.h_fff1;
      ge('cfg-cccd').value = state.h_cccd;
    }

    m = l.match(/([0-9A-Fa-f]{4})[,\s]+(?:0x)?FFF2/i);
    if (!m) m = l.match(/^\+CHARS?:([0-9A-Fa-f]{4}),.*?FFF2/i);
    if (m) {
      state.h_fff2 = m[1].toUpperCase();
      ge('cfg-fff2').value = state.h_fff2;
    }
  });
  saveLocalState();
}

/* ────────────────────────────────────────────────────────────────────
   Notify
   ──────────────────────────────────────────────────────────────────── */
function enableNotify() {
  if (!state.connected) { showToast('Connect first'); return; }
  sendCFML('AT+NOTIFY=' + state.devIdx + ',' + state.h_cccd + ',1', 5000)
    .then(function () { state.notifyEnabled = true; showToast('Notifications enabled'); })
    .catch(function () {});
}

function disableNotify() {
  if (!state.connected) return;
  sendCFML('AT+NOTIFY=' + state.devIdx + ',' + state.h_cccd + ',0', 5000)
    .then(function () { state.notifyEnabled = false; showToast('Notifications disabled'); })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   LED Control (FFF2)
   ──────────────────────────────────────────────────────────────────── */
function sendLedOn() {
  if (!state.connected) { showToast('Connect first'); return; }
  state.ledState = true;
  updateLedUI();
  sendCFML('AT+WRITE=' + state.devIdx + ',' + state.h_fff2 + ',01', 5000)
    .catch(function () {});
}

function sendLedOff() {
  if (!state.connected) { showToast('Connect first'); return; }
  state.ledState = false;
  updateLedUI();
  sendCFML('AT+WRITE=' + state.devIdx + ',' + state.h_fff2 + ',00', 5000)
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Custom Read / Write
   ──────────────────────────────────────────────────────────────────── */
function readHandle() {
  if (!state.connected) { showToast('Connect first'); return; }
  var hdl = ge('inp-read-hdl').value.trim() || state.h_fff1;
  sendCFML('AT+READ=' + state.devIdx + ',' + hdl, 5000)
    .then(function (r) {
      var found = splitResp(r).find(function (l) { return /^\+READ:/.test(l); });
      if (found) {
        ge('read-result').textContent = found;
        /* If it's FFF1, also update counter */
        var m = found.match(/^\+READ:\d+,([0-9A-Fa-f]+),([0-9A-Fa-f]*)/);
        if (m && m[1].toUpperCase() === state.h_fff1.toUpperCase()) {
          handleNotification(m[1].toUpperCase(), m[2]);
        }
      }
    })
    .catch(function () {});
}

function writeHandle() {
  if (!state.connected) { showToast('Connect first'); return; }
  var hdl  = ge('inp-write-hdl').value.trim();
  var data = ge('inp-write-data').value.trim().replace(/\s/g,'');
  if (!hdl || !data) { showToast('Enter handle and hex data'); return; }
  sendCFML('AT+WRITE=' + state.devIdx + ',' + hdl + ',' + data, 5000)
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Rendering helpers
   ──────────────────────────────────────────────────────────────────── */
function renderDeviceList(devices) {
  var list = ge('device-list');
  ge('scan-count').textContent = String(devices.length);
  if (!devices.length) {
    list.innerHTML = '<div class="no-items-msg">Nhấn ⦿ Scan để tìm thiết bị</div>';
    return;
  }
  list.innerHTML = devices.map(function (d, i) {
    var sel = (d.mac === state.mac && state.connected) ? ' selected' : '';
    return '<div class="device-item' + sel + '" onclick="connectDevice(' + i + ',\'' + escapeJs(d.mac) + '\',\'' + escapeJs(d.name) + '\')">' +
      '<span class="dev-name">' + escapeHtml(d.name || 'Unknown') + '</span>' +
      '<span class="dev-mac">' + escapeHtml(d.mac) + '</span>' +
      '<span class="dev-rssi">' + d.rssi + ' dBm</span>' +
    '</div>';
  }).join('');
}

function setConnected(on) {
  ge('status-dot').setAttribute('data-state', on ? 'active' : 'off');
  ge('ctrl-dev-name').textContent = on ? (state.name || state.mac) : '— Chưa kết nối —';
  ge('ctrl-dev-mac').textContent  = on ? state.mac : '';
  ge('ctrl-overlay').classList.toggle('hidden', on);
  setScanBadge(on ? 'connected' : 'idle');
  if (!on) {
    state.devIdx = -1;
    ge('counter-val').textContent = '—';
    ge('counter-raw').textContent = 'raw: —';
    ge('led-state-txt').textContent = '—';
    ge('led-icon').classList.remove('on');
  }
}

function updateLedUI() {
  ge('led-icon').classList.toggle('on', state.ledState);
  ge('led-icon').textContent      = state.ledState ? '💡' : '🔦';
  ge('led-state-txt').textContent = state.ledState ? 'ON' : 'OFF';
}

function setScanBadge(st) {
  var b = ge('scan-badge');
  b.setAttribute('data-state', st);
  b.textContent = st === 'scanning' ? 'SCAN…' : st === 'connected' ? 'CONN' : 'IDLE';
}

function appendDiscResults(lines) {
  var area = ge('disc-results');
  lines.forEach(function (l) { area.textContent += l + '\n'; });
  area.scrollTop = area.scrollHeight;
}

function showOverlay(visible, msg) {
  var overlay = ge('ctrl-overlay');
  if (visible) {
    overlay.classList.remove('hidden');
    ge('overlay-spinner').classList.remove('hidden');
    ge('overlay-msg').textContent = msg || '';
  } else {
    overlay.classList.add('hidden');
    ge('overlay-spinner').classList.add('hidden');
  }
}

function syncConfigBar() {
  ge('cfg-slot').value = state.slot;
  ge('cfg-fff1').value = state.h_fff1;
  ge('cfg-cccd').value = state.h_cccd;
  ge('cfg-fff2').value = state.h_fff2;
  if (ge('cfg-proto')) {
    ge('cfg-proto').value = state.proto;
    onProtoChange(state.proto);
  }
  if (!state.connected) setConnected(false);
}

/* ────────────────────────────────────────────────────────────────────
   LocalStorage persistence
   ──────────────────────────────────────────────────────────────────── */
function saveLocalState() {
  try {
    localStorage.setItem('CFML_bg_slot', JSON.stringify({
      slot: state.slot, proto: state.proto,
      h_fff1: state.h_fff1, h_cccd: state.h_cccd, h_fff2: state.h_fff2
    }));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem('CFML_bg_slot');
    if (!raw) return;
    var s = JSON.parse(raw);
    state.slot   = s.slot   || '0';
    state.proto  = s.proto  || 'http';
    state.h_fff1 = s.h_fff1 || '0009';
    state.h_cccd = s.h_cccd || '000A';
    state.h_fff2 = s.h_fff2 || '000C';
  } catch (e) {}
}

/* ────────────────────────────────────────────────────────────────────
   Console
   ──────────────────────────────────────────────────────────────────── */
function logToConsole(cls, msg) {
  var el   = ge('console-log');
  var line = document.createElement('div');
  line.className   = cls;
  line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  el.appendChild(line);
  while (el.children.length > 200) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function logTx   (m) { logToConsole('log-tx',   '→ ' + m); }
function logOk   (m) { logToConsole('log-ok',   '✓ ' + m); }
function logFail (m) { logToConsole('log-fail',  '✗ ' + m); }
function logInfo (m) { logToConsole('log-info',  'ℹ ' + m); }
function logEvt  (m) { logToConsole('log-evt',   '⚡ ' + m); }
function clearLog () { ge('console-log').innerHTML = ''; }

/* ────────────────────────────────────────────────────────────────────
   Utilities
   ──────────────────────────────────────────────────────────────────── */
function ge(id) { return document.getElementById(id); }

function showToast(msg) {
  var t = ge('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.add('hidden'); }, 2200);
}

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeJs(s)   { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

/* ────────────────────────────────────────────────────────────────────
   EXPOSE EXPORTS FOR THINGSBOARD HTML ONCLICK
   ──────────────────────────────────────────────────────────────────── */
window.onSlotChange     = onSlotChange;
window.onProtoChange    = onProtoChange;
window.startScan        = startScan;
window.connectDevice    = connectDevice;
window.disconnectDevice = disconnectDevice;
window.startDiscover    = startDiscover;
window.enableNotify     = enableNotify;
window.disableNotify    = disableNotify;
window.sendLedOn        = sendLedOn;
window.sendLedOff       = sendLedOff;
window.readHandle       = readHandle;
window.writeHandle      = writeHandle;
window.clearLog         = clearLog;
