/* =====================================================================
   ESP32-C6 RGB LED — ThingsBoard Control Widget — BLE AT Module
   CFML: protocol routed via Gateway (DA2_esp → DA2_esp_LAN → STM32WB55)

   Flow:
     1. 🔍 Scan  → CFML:0:AT+SCAN=5000
                  Response: CFML:0:OK:OK\x1E+SCAN:<mac>,<rssi>,<name>\x1E...
     2. ⚡ Connect → CFML:0:AT+CONNECT=<MAC>
                    Response: CFML:0:OK:OK\x1E+CONNECTING\x1E+CONNECTED:0,0x0001
     3. 💡 Control → CFML:0:AT+WRITE=0,<handle>,<PRRGGBB>
                     Response: CFML:0:OK:OK
     4. ❌ Disconnect → CFML:0:AT+DISCONNECT=0

   Write hex format (4 bytes): PPRRGGGBB
       P  = power  (01 = ON, 00 = OFF)
       RR = Red    (00–FF)
       GG = Green  (00–FF)
       BB = Blue   (00–FF)

   Handle discovery:
       Click "Discover" → runs AT+DISC=0 then AT+CHARS=0,1,65535
       EVT lines from listener task show char handles.
       OR: read the handle from ESP32 Serial Monitor at startup.

   ===================================================================== */

/* -------------------------------------------------------------------
   STATE
------------------------------------------------------------------- */
var state = {
  slot       : 0,          // Gateway stack slot: 0 = S1, 1 = S2
  handle     : 14,         // GATT characteristic value handle (decimal)
  devIdx     : 0,          // Device index assigned by AT+CONNECT (usually 0)
  mac        : null,       // Connected device MAC (for display)
  name       : null,       // Connected device name
  connected  : false,
  scanning   : false,
  connecting : false,
  power      : false,
  r : 255, g : 128, b : 0, // Current RGB (orange default)
  brightness : 100,        // Brightness 0–100 %
  scanResults : [],        // [{ mac, rssi, name }]
  rpcSlot    : 0,          // derived from cfg slot — use state.slot
  rpcTimeout : 8000,
  cmdBusy    : false,
  cmdQueue   : [],
};

/* -------------------------------------------------------------------
   THINGSBOARD LIFECYCLE
------------------------------------------------------------------- */
self.onInit = function () {
  self.ctx.ngZone.run(function () {
    loadLocalState();
    renderDeviceList([]);
    if (state.connected) {
      // Restore visual state from localStorage
      applyConnectedUI(state.mac, state.name);
    } else {
      showOverlay('← Quét và kết nối thiết bị', false);
    }
  });
};

self.onDestroy = function () {};

/* -------------------------------------------------------------------
   PERSISTENCE (localStorage)
------------------------------------------------------------------- */
function storageKey() { return 'CFML_rgb_slot' + state.slot; }

function saveLocalState() {
  try {
    var data = {
      slot      : state.slot,
      handle    : state.handle,
      devIdx    : state.devIdx,
      mac       : state.mac,
      name      : state.name,
      connected : state.connected,
      power     : state.power,
      r : state.r, g : state.g, b : state.b,
      brightness: state.brightness,
    };
    localStorage.setItem(storageKey(), JSON.stringify(data));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem(storageKey());
    if (!raw) return;
    var d = JSON.parse(raw);
    state.slot       = d.slot       !== undefined ? d.slot       : state.slot;
    state.handle     = d.handle     !== undefined ? d.handle     : state.handle;
    state.devIdx     = d.devIdx     !== undefined ? d.devIdx     : state.devIdx;
    state.mac        = d.mac        || null;
    state.name       = d.name       || null;
    state.connected  = d.connected  || false;
    state.power      = d.power      || false;
    state.r          = d.r          !== undefined ? d.r : state.r;
    state.g          = d.g          !== undefined ? d.g : state.g;
    state.b          = d.b          !== undefined ? d.b : state.b;
    state.brightness = d.brightness !== undefined ? d.brightness : state.brightness;

    // Sync UI inputs
    document.getElementById('cfg-slot').value   = state.slot;
    document.getElementById('cfg-handle').value = state.handle;
  } catch (e) {}
}

/* -------------------------------------------------------------------
   CONFIG CALLBACKS
------------------------------------------------------------------- */
function onSlotChange(val) {
  state.slot = parseInt(val);
  loadLocalState();   // reload slot-scoped storage
  if (!state.connected) {
    renderDeviceList([]);
    showOverlay('← Quét và kết nối thiết bị', false);
  }
  logInfo('Slot → S' + (state.slot + 1));
}

function onHandleChange(val) {
  var trimmed = val.trim().toLowerCase();
  var parsed;
  if (trimmed.startsWith('0x')) {
    parsed = parseInt(trimmed, 16);
  } else {
    parsed = parseInt(trimmed, 10);
  }
  if (isNaN(parsed) || parsed <= 0) {
    showToast('Handle không hợp lệ');
    return;
  }
  state.handle = parsed;
  document.getElementById('cfg-handle').value = state.handle;
  saveLocalState();
  logInfo('Char handle → ' + state.handle + ' (0x' + state.handle.toString(16).toUpperCase().padStart(4, '0') + ')');
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

function sendCFML(atCmd, timeoutMs) {
  var cmd = 'CFML:' + state.slot + ':' + atCmd;
  logTx(cmd);
  return sendRPC('sendCommand', cmd, timeoutMs || state.rpcTimeout);
}

/* Command queue — send one at a time to avoid BLE handler overload */
function enqueueWrite(atCmd) {
  state.cmdQueue.push(atCmd);
  drainQueue();
}

function drainQueue() {
  if (state.cmdBusy || state.cmdQueue.length === 0) return;
  state.cmdBusy = true;
  var cmd = state.cmdQueue.shift();
  sendCFML(cmd, 2000)
    .then(function (resp) { logCFMLResponse(resp); })
    .catch(function (e)   { logFail('WRITE timeout: ' + (e ? e.message || e : 'err')); })
    .finally(function ()  { state.cmdBusy = false; drainQueue(); });
}

/* -------------------------------------------------------------------
   RESPONSE PARSERS
------------------------------------------------------------------- */

/**
 * Parse lines from a CFML RPC response.
 * Lines are separated by \x1E (ASCII RS = 0x1E) or \n.
 */
function parseLines(resp) {
  var text = typeof resp === 'string' ? resp
           : (resp && (resp.result || resp.value || JSON.stringify(resp))) || '';
  return text.split(/[\x1E\n]+/).map(function (l) { return l.trim(); })
             .filter(function (l) { return l.length > 0; });
}

/**
 * Parse AT+SCAN response lines for device entries.
 * AT+SCAN format: +SCAN:<mac>,<rssi>,<name>
 * Response arrives as: CFML:0:OK:OK\x1E+SCAN:AA:BB...\x1E...
 */
function parseScanLines(resp) {
  var devices = [];
  var lines = parseLines(resp);
  lines.forEach(function (line) {
    // Match +SCAN: line directly (may be prefixed with CFML:N:OK:)
    var m = line.match(/\+SCAN:([0-9A-Fa-f:]{17}),(-?\d+),(.*)$/);
    if (m) {
      devices.push({
        mac  : m[1].toUpperCase(),
        rssi : parseInt(m[2]),
        name : m[3].trim() || 'Unknown',
      });
    }
  });
  return devices;
}

/**
 * Parse AT+CONNECT response for dev index.
 * +CONNECTED:0,0x0001  → devIdx = 0
 */
function parseConnectLines(resp) {
  var lines = parseLines(resp);
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/\+CONNECTED:(\d+)/i);
    if (m) return parseInt(m[1]);
  }
  return 0;   // fallback
}

function logCFMLResponse(resp) {
  var lines = parseLines(resp);
  lines.forEach(function (l) {
    if (l.indexOf(':FAIL:') !== -1 || l.indexOf('ERROR') !== -1) {
      logFail(l);
    } else if (l.indexOf(':OK:') !== -1 || l === 'OK') {
      logOk(l);
    } else if (l.indexOf(':EVT:') !== -1) {
      logEvt(l);
    } else if (l.length > 0) {
      logOk(l);
    }
  });
}

/* -------------------------------------------------------------------
   SCAN
------------------------------------------------------------------- */
function setScanSpinner(on) {
  var btn  = document.getElementById('btn-scan');
  var mini = document.getElementById('scan-spinner-mini');
  if (on) {
    mini.classList.remove('hidden');
    btn.classList.add('spinning');
    btn.disabled = true;
  } else {
    mini.classList.add('hidden');
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

function startScan() {
  if (state.scanning || state.connecting) return;
  state.scanning = true;
  state.scanResults = [];
  renderDeviceList([]);
  setScanSpinner(true);
  document.getElementById('scan-status-text').textContent = 'Đang quét…';

  // AT+SCAN with 5s duration; allow 7s for response
  sendCFML('AT+SCAN=5000', 8000)
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
      document.getElementById('scan-status-text').textContent =
        count > 0 ? count + ' thiết bị' : 'Không tìm thấy';
      renderDeviceList(state.scanResults);
      if (count === 0 && !state.connected) {
        showOverlay('Không tìm thấy. Nhấn ⟳ thử lại.', false);
      }
    });
}

/* -------------------------------------------------------------------
   RENDER DEVICE LIST
------------------------------------------------------------------- */
function renderDeviceList(devices) {
  var list = document.getElementById('device-list');
  list.innerHTML = '';

  if (devices.length === 0) {
    list.innerHTML = '<div class="no-devices-msg">Nhấn &#8635; để quét BLE</div>';
    return;
  }

  devices.forEach(function (dev) {
    var isConnected = state.connected && state.mac === dev.mac;
    var item = document.createElement('div');
    item.className = 'device-item' + (isConnected ? ' selected' : '');
    item.innerHTML =
      '<span class="device-icon">&#128246;</span>' +
      '<div class="device-info">' +
        '<span class="device-name">' + escapeHtml(dev.name) + '</span>' +
        '<span class="device-addr">' + escapeHtml(dev.mac) + '</span>' +
      '</div>' +
      '<span class="device-rssi">' + dev.rssi + 'dBm</span>' +
      (isConnected
        ? ''
        : '<button class="btn-connect" onclick="connectDevice(\'' + dev.mac + '\',\'' +
          escapeHtml(dev.name).replace(/'/g, "\\'") + '\')">&#9889;</button>');
    list.appendChild(item);
  });
}

/* -------------------------------------------------------------------
   CONNECT / DISCONNECT
------------------------------------------------------------------- */
function connectDevice(mac, name) {
  if (state.connected || state.connecting) return;
  state.connecting = true;
  setStatusDot('connecting');
  showOverlay('Đang kết nối tới ' + name + '…', true);

  sendCFML('AT+CONNECT=' + mac, 6000)
    .then(function (resp) {
      logCFMLResponse(resp);

      // Check for error in response
      var text = typeof resp === 'string' ? resp : (resp.result || resp.value || '');
      if (text.indexOf(':FAIL:') !== -1 || text.indexOf('+ERROR:') !== -1) {
        throw new Error('Connection refused: ' + text);
      }

      state.devIdx    = parseConnectLines(resp);
      state.mac       = mac;
      state.name      = name;
      state.connected = true;
      saveLocalState();
      applyConnectedUI(mac, name);
      showToast('✅ Đã kết nối: ' + name);
    })
    .catch(function (e) {
      logFail('CONNECT fail: ' + (e ? e.message || e : 'timeout'));
      state.connected = false;
      state.connecting = false;
      setStatusDot('off');
      showOverlay('Kết nối thất bại. Thử lại.', false);
    })
    .finally(function () {
      state.connecting = false;
    });
}

function applyConnectedUI(mac, name) {
  setStatusDot('connected');
  document.getElementById('ctrl-device-name').textContent =
    (name || 'Thiết bị') + ' (' + mac + ')';
  document.getElementById('btn-disconnect').classList.remove('hidden');
  hideOverlay();

  // Restore RGB controls state
  updatePowerUI(state.power);
  updateColorUI();
  updateBrightnessUI(state.brightness);

  renderDeviceList(state.scanResults);   // refresh list to show 'selected' style
}

function disconnectDevice() {
  if (!state.connected) return;
  sendCFML('AT+DISCONNECT=' + state.devIdx, 3000)
    .then(function (resp) { logCFMLResponse(resp); })
    .catch(function () {})
    .finally(function () {
      state.connected = false;
      state.mac       = null;
      state.name      = null;
      state.devIdx    = 0;
      saveLocalState();
      setStatusDot('off');
      document.getElementById('ctrl-device-name').textContent = '—';
      document.getElementById('btn-disconnect').classList.add('hidden');
      renderDeviceList(state.scanResults);
      showOverlay('← Quét và kết nối thiết bị', false);
      showToast('Đã ngắt kết nối');
    });
}

/* -------------------------------------------------------------------
   DISCOVER (AT+DISC + AT+CHARS)
------------------------------------------------------------------- */
function startDiscover() {
  if (!state.connected) {
    showToast('Kết nối trước khi Discover');
    return;
  }
  logInfo('── Discovering services (AT+DISC=0) ──');
  sendCFML('AT+DISC=' + state.devIdx, 6000)
    .then(function (resp) {
      logCFMLResponse(resp);
      logInfo('── Discovering chars (AT+CHARS=0,1,65535) ──');
      return sendCFML('AT+CHARS=' + state.devIdx + ',1,65535', 6000);
    })
    .then(function (resp) {
      logCFMLResponse(resp);
      logInfo('── Discover done — check Console for +CHAR lines ──');
      showToast('Discover xong — xem Console để lấy handle');
    })
    .catch(function (e) {
      logFail('Discover error: ' + (e ? e.message || e : 'timeout'));
    });
}

/* -------------------------------------------------------------------
   RGB CONTROL
------------------------------------------------------------------- */

/** Build 8-char hex string: PPRRGGGBB */
function buildWriteHex(power, r, g, b, brightness) {
  var br = brightness / 100;
  var pr = Math.min(255, Math.round(r * br));
  var pg = Math.min(255, Math.round(g * br));
  var pb = Math.min(255, Math.round(b * br));
  var p  = power ? 0x01 : 0x00;
  return toHex2(p) + toHex2(pr) + toHex2(pg) + toHex2(pb);
}

function toHex2(v) { return ('00' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2).toUpperCase(); }

function sendWriteRGB() {
  if (!state.connected) return;
  var hex = buildWriteHex(state.power, state.r, state.g, state.b, state.brightness);
  var atCmd = 'AT+WRITE=' + state.devIdx + ',' + state.handle + ',' + hex;
  enqueueWrite(atCmd);
}

/* -------------------------------------------------------------------
   POWER
------------------------------------------------------------------- */
function onPowerToggle(checked) {
  state.power = checked;
  updatePowerUI(checked);
  saveLocalState();
  sendWriteRGB();
}

function updatePowerUI(on) {
  document.getElementById('power-toggle').checked = on;
  document.getElementById('power-label').textContent = on ? 'BẬT' : 'TẮT';
  document.getElementById('bulb-preview').className = 'bulb-preview ' + (on ? 'on' : 'off');
  document.getElementById('section-color').className      = 'ctrl-section' + (on ? '' : ' dimmed');
  document.getElementById('section-brightness').className = 'ctrl-section' + (on ? '' : ' dimmed');
  updateBulbGlow();
}

/* -------------------------------------------------------------------
   COLOR
------------------------------------------------------------------- */
function onColorInput(hexStr) {
  var rgb = hexToRgb(hexStr);
  if (!rgb) return;
  state.r = rgb.r; state.g = rgb.g; state.b = rgb.b;
  document.getElementById('color-hex-value').textContent = hexStr.toUpperCase();
  updateBulbGlow();
}

function onColorChange(hexStr) {
  var rgb = hexToRgb(hexStr);
  if (!rgb) return;
  state.r = rgb.r; state.g = rgb.g; state.b = rgb.b;
  document.getElementById('color-hex-value').textContent = hexStr.toUpperCase();
  updateBulbGlow();
  saveLocalState();
  if (state.power) sendWriteRGB();
}

function applyPreset(hexStr) {
  document.getElementById('color-picker').value = hexStr;
  onColorChange(hexStr);
}

function updateColorUI() {
  var hexStr = '#' + toHex2(state.r) + toHex2(state.g) + toHex2(state.b);
  document.getElementById('color-picker').value = hexStr.toLowerCase();
  document.getElementById('color-hex-value').textContent = hexStr.toUpperCase();
  updateBulbGlow();
}

/* -------------------------------------------------------------------
   BRIGHTNESS
------------------------------------------------------------------- */
function onBrightnessInput(val) {
  state.brightness = parseInt(val);
  updateBrightnessUI(state.brightness);
}

function onBrightnessChange(val) {
  state.brightness = parseInt(val);
  updateBrightnessUI(state.brightness);
  saveLocalState();
  if (state.power) sendWriteRGB();
}

function updateBrightnessUI(pct) {
  document.getElementById('brightness-value').textContent = pct + '%';
  var s = document.getElementById('brightness-slider');
  s.value = pct;
  s.style.background =
    'linear-gradient(to right, #e0a000 0%, #e0a000 ' + pct + '%, #21262d ' + pct + '%, #21262d 100%)';
  updateBulbGlow();
}

/* -------------------------------------------------------------------
   BULB GLOW PREVIEW
------------------------------------------------------------------- */
function updateBulbGlow() {
  var ring  = document.getElementById('bulb-ring');
  var glow  = document.getElementById('bulb-glow');
  if (!state.power) {
    ring.style.background = '#30363d';
    glow.style.opacity = '0';
    return;
  }
  var brt = state.brightness / 100;
  var pr  = Math.round(state.r * brt);
  var pg  = Math.round(state.g * brt);
  var pb  = Math.round(state.b * brt);
  var hex = '#' + toHex2(pr) + toHex2(pg) + toHex2(pb);
  ring.style.background = hex;
  glow.style.background = 'radial-gradient(circle, rgba(' + pr + ',' + pg + ',' + pb + ',0.6) 0%, transparent 70%)';
  glow.style.opacity = '1';
}

/* -------------------------------------------------------------------
   OVERLAY / STATUS DOT
------------------------------------------------------------------- */
function showOverlay(msg, withSpinner) {
  var ov  = document.getElementById('ctrl-overlay');
  var msg_el = document.getElementById('overlay-msg');
  var spin = document.getElementById('overlay-spinner');
  ov.classList.remove('hidden');
  msg_el.textContent = msg;
  if (withSpinner) { spin.classList.remove('hidden'); }
  else             { spin.classList.add('hidden'); }
}

function hideOverlay() {
  document.getElementById('ctrl-overlay').classList.add('hidden');
}

function setStatusDot(st) {
  document.getElementById('status-dot').setAttribute('data-state', st);
}

/* -------------------------------------------------------------------
   CONSOLE LOG
------------------------------------------------------------------- */
function logToConsole(cls, text) {
  var log = document.getElementById('console-log');
  if (!log) return;
  var line = document.createElement('div');
  line.className = cls;
  line.textContent = '[' + new Date().toLocaleTimeString('vi-VN', {hour12:false}) + '] ' + text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  // Cap to 200 lines
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
function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

var toastTimer = null;
function showToast(msg) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 2500);
}
