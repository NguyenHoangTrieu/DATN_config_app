/* =====================================================================
   ESP32-C6 BLE GATT Peripheral — ThingsBoard Control Widget — NATIVE GATT
   Protocol: CFML:CFBG:<cmd> (native GATT, no AT commands)
   
   Service FFF0:
     - Char FFF1 (READ|NOTIFY): Counter value (4-byte uint32-LE)
     - Char FFF2 (WRITE): LED control (0x00=OFF, 0x01=ON)
   
   Gateway GATT commands (all use device table index obtained from SCAN_RESULT):
     CFML:CFBG:<slot>:SCAN:<duration_ms>          → scan for devices
     CFML:CFBG:<slot>:CONNECT:<mac>               → connect (returns CONNECTED:<idx>:...)
     CFML:CFBG:<slot>:DISC:<idx>                  → discover services (returns DISC_DONE batch)
     CFML:CFBG:<slot>:READ:<idx>:<handle>         → read characteristic
     CFML:CFBG:<slot>:WRITE:<idx>:<handle>:<hex>  → write characteristic
     CFML:CFBG:<slot>:NOTIFY:<idx>:<cccd_h>:1     → enable notifications
     CFML:CFBG:<slot>:DISCONNECT:<idx>            → disconnect device
   
   ===================================================================== */

/* -------------------------------------------------------------------
   STATE
------------------------------------------------------------------- */
var state = {
  slot       : 0,                     // Gateway stack slot
  targetName : 'DA2_TEST_GATT',       // Target device name
  mac        : null,                  // Connected device MAC
  devIdx     : null,                  // Device table index (from SCAN_RESULT)
  connected  : false,
  scanning   : false,
  connecting : false,
  
  // Discovered handles (integer, from DISC_DONE batch)
  fff1_handle: null,
  fff2_handle: null,
  
  // GATT data
  counterVal : 0,
  ledState   : false,                 // false=OFF, true=ON
  scanResults: [],                    // [{ idx, mac, rssi, name }]
  
  rpcTimeout : 15000,
  cmdBusy    : false,
};

/* -------------------------------------------------------------------
   THINGSBOARD LIFECYCLE
------------------------------------------------------------------- */
self.onInit = function () {
  self.ctx.ngZone.run(function () {
    loadLocalState();
    renderDeviceList([]);
    if (state.connected) {
      applyConnectedUI();
    } else {
      showOverlay('← Scan and connect device', false);
    }
  });
};

self.onDestroy = function () {};

/* -------------------------------------------------------------------
   PERSISTENCE (localStorage)
------------------------------------------------------------------- */
function storageKey() { return 'GATT_widget_' + state.slot; }

function saveLocalState() {
  try {
    var data = {
      slot       : state.slot,
      targetName : state.targetName,
      mac        : state.mac,
      devIdx     : state.devIdx,
      connected  : state.connected,
      counterVal : state.counterVal,
      ledState   : state.ledState,
      fff1_handle: state.fff1_handle,
      fff2_handle: state.fff2_handle,
    };
    localStorage.setItem(storageKey(), JSON.stringify(data));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem(storageKey());
    if (!raw) return;
    var d = JSON.parse(raw);
    state.slot        = d.slot        !== undefined ? d.slot        : state.slot;
    state.targetName  = d.targetName  || state.targetName;
    state.mac         = d.mac         || null;
    state.devIdx      = d.devIdx      !== undefined ? d.devIdx      : null;
    state.connected   = d.connected   || false;
    state.counterVal  = d.counterVal  || 0;
    state.ledState    = d.ledState    || false;
    state.fff1_handle = d.fff1_handle || null;
    state.fff2_handle = d.fff2_handle || null;
  } catch (e) {}
}

/* -------------------------------------------------------------------
   CONFIG CALLBACKS
------------------------------------------------------------------- */
/* These have been removed - config is now fixed, no UI for changing slot/target */

/* -------------------------------------------------------------------
   STATUS DOT HELPER
------------------------------------------------------------------- */
function setStatusDot(st) {
  var pill = document.getElementById('status-pill');
  var dot  = document.getElementById('status-dot');
  var txt  = document.getElementById('status-text');
  if (pill) pill.setAttribute('data-state', st);
  if (dot)  dot.setAttribute('data-state', st);
  var labels = {
    connected  : 'Connected',
    connecting : 'Connecting...',
    scanning   : 'Scanning',
    idle       : 'Disconnected',
    off        : 'Disconnected'
  };
  if (txt) txt.textContent = labels[st] || 'Disconnected';
}

/* -------------------------------------------------------------------
   RPC HELPERS
------------------------------------------------------------------- */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs || state.rpcTimeout)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err)  { reject(err); }
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

function sendCFML(gattCmd, timeoutMs) {
  var cmd = 'CFML:CFBG:' + gattCmd;
  logTx(cmd);
  var hexCmd = stringToHex(cmd);
  return sendRPC('sendCommand', hexCmd, timeoutMs || state.rpcTimeout);
}

/* -------------------------------------------------------------------
   RESPONSE PARSERS
------------------------------------------------------------------- */
function parseLines(resp) {
  var text = typeof resp === 'string' ? resp
           : (resp && (resp.data || resp.result || resp.value || JSON.stringify(resp))) || '';
           
  if (/^[0-9A-Fa-f]+$/.test(text) && text.length % 2 === 0) {
    text = hexToString(text);
  }
  
  return text.split(/[\x1E\n]+/).map(function (l) { return l.trim(); })
             .filter(function (l) { return l.length > 0; });
}

function parseScanLines(resp) {
  var devices = [];
  var lines = parseLines(resp);
  lines.forEach(function (line) {
    // Match SCAN_RESULT line: SCAN_RESULT:<idx>,<mac>,<rssi>,<name>
    var m = line.match(/SCAN_RESULT:(\d+),([0-9A-Fa-f:]{17}),(-?\d+),(.*)/);
    if (m) {
      devices.push({
        idx  : parseInt(m[1]),
        mac  : m[2].toUpperCase(),
        rssi : parseInt(m[3]),
        name : m[4].trim() || 'Unknown',
      });
    }
  });
  return devices;
}

function parseConnectResult(resp) {
  var lines = parseLines(resp);
  var text = lines.join(' ');
  if (text.indexOf('FAIL') !== -1 || text.indexOf('ERROR') !== -1) {
    return false;
  }
  if (text.indexOf('CONNECTED') !== -1 || text.indexOf('OK') !== -1) {
    return true;
  }
  return true;  // assume OK if any response received
}

function parseDiscoverResult(resp) {
  var lines = parseLines(resp);
  var text = lines.join(' ');
  if (text.indexOf('DISC_DONE') !== -1) return true;
  if (text.indexOf('FAIL') !== -1) return false;
  return false;
}

function logCFMLResponse(resp) {
  var lines = parseLines(resp);
  lines.forEach(function (l) {
    var ul = l.toUpperCase();
    if (ul.indexOf('FAIL') !== -1 || ul.indexOf('ERROR') !== -1) {
      logFail(l);
    } else if (ul.indexOf('OK') !== -1) {
      logOk(l);
    } else if (l.indexOf('+') === 0) {
      logEvt(l);
    } else if (l.length > 0) {
      logInfo(l);
    }
  });
}

/* -------------------------------------------------------------------
   SCAN (Removed auto-connect, now manual scan only)
------------------------------------------------------------------- */
function setScanSpinner(on) {
  var btn = document.getElementById('btn-scan');
  if (!btn) return;
  if (on) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
  } else {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

function startScan() {
  if (state.scanning || state.connecting) return;
  
  state.scanning = true;
  state.scanResults = [];
  setScanSpinner(true);
  var list = document.getElementById('device-list');
  if (list) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div><div class="empty-msg">Scanning...</div></div>';
  }

  sendCFML(state.slot + ':SCAN:5000', 15000)
    .then(function (resp) {
      logCFMLResponse(resp);
      state.scanResults = parseScanLines(resp);
    })
    .catch(function (e) {
      logFail('SCAN error: ' + (e ? e.message || e : 'timeout'));
    })
    .finally(function () {
      state.scanning = false;
      setScanSpinner(false);
      var count = state.scanResults.length;
      var badge = document.getElementById('scan-count');
      if (badge) badge.textContent = String(count);
      renderDeviceList(state.scanResults);
    });
}

/* -------------------------------------------------------------------
   RENDER DEVICE LIST
------------------------------------------------------------------- */
function renderDeviceList(devices) {
  var list = document.getElementById('device-list');
  if (!list) return;
  
  if (devices.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div><div class="empty-msg">Press Scan to find<br>BLE devices</div></div>';
    return;
  }

  var html = devices.map(function (d, i) {
    var sel = (d.mac === state.mac && state.connected) ? ' selected' : '';
    var rssiPct = Math.max(0, Math.min(100, ((d.rssi + 110) / 70) * 100)).toFixed(0);
    return '<div class="device-item' + sel + '" onclick="connectToDevice(\'' +
      escapeJs(d.mac) + '\',\'' + escapeJs(d.name) + '\',' + d.idx + ')">' +
      '<span class="dev-name">' + escapeHtml(d.name || 'Unknown') + '</span>' +
      '<span class="dev-mac">' + escapeHtml(d.mac) + '</span>' +
      '<div class="dev-rssi-row">' +
        '<div class="rssi-bar-wrap"><div class="rssi-bar" style="width:' + rssiPct + '%"></div></div>' +
        '<span class="dev-rssi-val">' + d.rssi + ' dBm</span>' +
      '</div></div>';
  }).join('');
  
  list.innerHTML = html;
}

/* -------------------------------------------------------------------
   CONNECT / DISCONNECT  
------------------------------------------------------------------- */
function connectToDevice(mac, name, idx) {
  connectToMAC(mac, name, idx);
}

function connectToMAC(mac, name, idx) {
  if (state.connected || state.connecting) return;
  
  state.connecting = true;
  state.devIdx = (idx !== undefined && idx !== null) ? idx : null;
  name = name || 'Device';
  setStatusDot('connecting');
  showOverlay('Connecting to ' + name + '...', true);

  // CONNECT blocks until OPEN_EVT fires (up to 15s) — returns CONNECTED:<idx>:0x<id>:<mac>
  sendCFML(state.slot + ':CONNECT:' + mac, 15000)
    .then(function (resp) {
      logCFMLResponse(resp);
      
      if (!parseConnectResult(resp)) {
        throw new Error('Connection refused');
      }
      
      state.mac = mac;
      state.connected = true;
      saveLocalState();
      
      // Discover services — DISC blocks until SEARCH_CMPL_EVT sends batched DISC_DONE
      logInfo('Connected. Discovering GATT (idx=' + state.devIdx + ')...');
      return sendCFML(state.slot + ':DISC:' + state.devIdx, 15000);
    })
    .then(function (resp) {
      logCFMLResponse(resp);
      parseDiscoverHandles(resp);
      
      if (!state.fff1_handle || !state.fff2_handle) {
        logInfo('Handles not in discovery. Using defaults: FFF1=3, FFF2=6.');
        state.fff1_handle = 3;
        state.fff2_handle = 6;
      }
      saveLocalState();
      
      applyConnectedUI();
      
      // Subscribe to FFF1 notifications via CCCD (handle = fff1_handle + 1)
      var cccdHandle = state.fff1_handle + 1;
      logInfo('Subscribing to FFF1 notifications (CCCD handle=' + cccdHandle + ')...');
      return sendCFML(state.slot + ':NOTIFY:' + state.devIdx + ':' + cccdHandle + ':1', 5000);
    })
    .then(function (resp) {
      logCFMLResponse(resp);
      logInfo('✓ GATT ready. Polling counter and listening for notifications.');
      showToast('✅ Connected: ' + name);
      startNotificationListener();
    })
    .catch(function (e) {
      logFail('Connection error: ' + (e ? e.message || e : 'timeout'));
      state.connected = false;
      state.connecting = false;
      setStatusDot('off');
      showOverlay('Connection failed. Try again.', false);
    })
    .finally(function () {
      state.connecting = false;
    });
}

function parseDiscoverHandles(resp) {
  // Firmware DISC_DONE batch format (\x1E-separated):
  //   DISC_DONE:<idx>:<N>_CHARS\x1ECHAR:<idx>:0xFFF1:0x<handle>:0x<prop>\x1E...
  var lines = parseLines(resp);
  lines.forEach(function (line) {
    var upper = line.toUpperCase();
    if (upper.indexOf('CHAR:') !== 0) return;
    var parts = line.split(':');
    // parts: ['CHAR', '<idx>', '0xFFF1', '0x<handle>', '0x<prop>']
    if (parts.length < 5) return;
    var uuidField   = parts[2].toUpperCase().replace(/^0X/, '');
    var handleField = parts[3].replace(/^0[xX]/, '');
    var handle = parseInt(handleField, 16);
    if (isNaN(handle)) return;
    if (uuidField === 'FFF1') state.fff1_handle = handle;
    if (uuidField === 'FFF2') state.fff2_handle = handle;
  });
}

function applyConnectedUI() {
  var pill = document.getElementById('status-pill');
  var dot = document.getElementById('status-dot');
  if (pill) pill.setAttribute('data-state', 'connected');
  if (dot) {
    dot.setAttribute('data-state', 'connected');
  }
  
  var heroName = document.getElementById('hero-name');
  var heroMac = document.getElementById('hero-mac');
  var heroIcon = document.getElementById('hero-icon');
  if (heroName) heroName.textContent = state.mac || 'Connected';
  if (heroMac) heroMac.textContent = state.mac || '—';
  if (heroIcon) heroIcon.classList.add('connected');
  
  var btn = document.getElementById('btn-disconnect');
  if (btn) btn.classList.remove('hidden');
  
  var overlay = document.getElementById('ctrl-overlay');
  if (overlay) overlay.classList.add('hidden');
  
  renderDeviceList(state.scanResults);
  updateLEDUI();
}

function disconnectDevice() {
  if (!state.connected) return;
  
  // Send DISCONNECT to firmware first
  if (state.devIdx !== null) {
    sendCFML(state.slot + ':DISCONNECT:' + state.devIdx, 3000)
      .catch(function () {}); // best-effort, proceed regardless
  }
  
  state.connected = false;
  state.mac = null;
  state.devIdx = null;
  state.counterVal = 0;
  state.ledState = false;
  saveLocalState();
  
  var pill = document.getElementById('status-pill');
  var dot = document.getElementById('status-dot');
  if (pill) pill.setAttribute('data-state', 'idle');
  if (dot) dot.setAttribute('data-state', 'off');
  
  var heroName = document.getElementById('hero-name');
  var heroMac = document.getElementById('hero-mac');
  var heroIcon = document.getElementById('hero-icon');
  if (heroName) heroName.textContent = 'Not Connected';
  if (heroMac) heroMac.textContent = '—';
  if (heroIcon) heroIcon.classList.remove('connected');
  
  var counterVal = document.getElementById('counter-val');
  if (counterVal) counterVal.textContent = '—';
  
  var btn = document.getElementById('btn-disconnect');
  if (btn) btn.classList.add('hidden');
  
  var overlay = document.getElementById('ctrl-overlay');
  if (overlay) overlay.classList.remove('hidden');
  
  renderDeviceList([]);
  updateLEDUI();
  showToast('Disconnected — press Scan to reconnect');
}

/* -------------------------------------------------------------------
   NOTIFICATION LISTENER & POLLING
------------------------------------------------------------------- */
function startNotificationListener() {
  // Poll counter every 2 seconds
  setInterval(function () {
    if (state.connected && state.mac) {
      pollCounterUpdate();
    }
  }, 2000);
}

function pollCounterUpdate() {
  if (state.devIdx === null || !state.fff1_handle) return;
  sendCFML(state.slot + ':READ:' + state.devIdx + ':' + state.fff1_handle, 3000)
    .then(function (resp) {
      var lines = parseLines(resp);
      var text = lines.join(' ');
      
      // Response: READ:<idx>:0x<handle>:<hex>
      var m = text.match(/READ:\d+:0x[0-9A-Fa-f]+:([0-9A-Fa-f]{2,})/i);
      if (m) {
        var hex = m[1];
        if (hex.length >= 8) {
          state.counterVal = hexToUint32LE(hex.substring(0, 8));
          var el = document.getElementById('counter-value');
          if (el) el.textContent = state.counterVal.toString();
        }
      }
    })
    .catch(function () {});  // Silently fail
}

function hexToUint32LE(hexStr) {
  if (hexStr.length < 8) return 0;
  var b0 = parseInt(hexStr.substring(0, 2), 16) || 0;
  var b1 = parseInt(hexStr.substring(2, 4), 16) || 0;
  var b2 = parseInt(hexStr.substring(4, 6), 16) || 0;
  var b3 = parseInt(hexStr.substring(6, 8), 16) || 0;
  return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

/* -------------------------------------------------------------------
   LED CONTROL (FFF2 WRITE)
------------------------------------------------------------------- */
function sendLedCommand(onOff) {
  if (!state.connected || state.devIdx === null) {
    showToast('Device not connected');
    return;
  }
  if (!state.fff2_handle) {
    showToast('FFF2 handle unknown — reconnect to discover');
    return;
  }
  
  // FFF2 expects 0x00 (OFF) or 0x01 (ON)
  var hex = onOff ? '01' : '00';
  var cmd = state.slot + ':WRITE:' + state.devIdx + ':' + state.fff2_handle + ':' + hex;
  
  state.ledState = (onOff !== 0);
  updateLEDUI();
  
  sendCFML(cmd, 3000)
    .then(function (resp) {
      logOk('LED ' + (state.ledState ? 'ON' : 'OFF'));
      logCFMLResponse(resp);
    })
    .catch(function (e) {
      logFail('LED write error: ' + (e ? e.message || e : 'timeout'));
      state.ledState = !state.ledState;
      updateLEDUI();
    });
}

function updateLEDUI() {
  var toggle = document.getElementById('led-toggle');
  var wrap = document.getElementById('led-icon-wrap');
  var icon = document.getElementById('led-icon');
  var status = document.getElementById('led-status-text');
  
  if (toggle) toggle.checked = state.ledState;
  if (wrap) wrap.setAttribute('data-on', state.ledState ? 'true' : 'false');
  if (icon) icon.textContent = state.ledState ? '💡' : '🔦';
  if (status) status.textContent = state.ledState ? 'LED is ON' : 'LED is OFF';
}

/* -------------------------------------------------------------------
   OVERLAY / STATUS
------------------------------------------------------------------- */
function showOverlay(msg, withSpinner) {
  var ov = document.getElementById('ctrl-overlay');
  if (!ov) return;
  ov.classList.remove('hidden');
  var msg_el = document.getElementById('overlay-msg');
  var spin = document.getElementById('overlay-spinner');
  if (msg_el) msg_el.textContent = msg;
  if (spin) {
    if (withSpinner) { spin.classList.remove('hidden'); }
    else { spin.classList.add('hidden'); }
  }
}

function hideOverlay() {
  var ov = document.getElementById('ctrl-overlay');
  if (ov) ov.classList.add('hidden');
}

function onLedToggle(checked) {
  if (!state.connected) {
    var tog = document.getElementById('led-toggle');
    if (tog) tog.checked = !checked;
    showToast('Connect a device first');
    return;
  }
  sendLedCommand(checked ? 1 : 0);
}

/* -------------------------------------------------------------------
   CONSOLE LOG
------------------------------------------------------------------- */
function logToConsole(cls, text) {
  var log = document.getElementById('console-log');
  if (!log) return;
  var line = document.createElement('div');
  line.className = cls;
  var time = new Date().toLocaleTimeString();
  line.textContent = '[' + time + '] ' + text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  while (log.childNodes.length > 200) { log.removeChild(log.firstChild); }
}

function logTx(t)   { logToConsole('log-tx',   '→ ' + t); }
function logOk(t)   { logToConsole('log-ok',   '← ' + t); }
function logFail(t) { logToConsole('log-fail', '✗ ' + t); }
function logInfo(t) { logToConsole('log-info', '  ' + t); }
function logEvt(t)  { logToConsole('log-evt',  '★ ' + t); }
function clearLog() { var l = document.getElementById('console-log'); if (l) l.innerHTML = ''; }

/* -------------------------------------------------------------------
   UTILITIES
------------------------------------------------------------------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJs(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

var toastTimer = null;
function showToast(msg) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.add('hidden');
  }, 2500);
}

/* ────────────────────────────────────────────────────────────────────
   EXPOSE EXPORTS FOR THINGSBOARD HTML ONCLICK
   ──────────────────────────────────────────────────────────────────── */
window.startScan          = startScan;
window.connectToDevice    = connectToDevice;
window.disconnectDevice   = disconnectDevice;
window.onLedToggle        = onLedToggle;
window.sendLedCommand     = sendLedCommand;
window.clearLog           = clearLog;

