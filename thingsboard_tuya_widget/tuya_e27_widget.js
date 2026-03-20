/* =====================================================================
   Tuya E27 LED Controller -- ThingsBoard Widget JS (Single Window)
   RPC: sendCommand(string) -> CFBL:0:AT+... routed by Gateway
   ThingsBoard v4.x  Control widget
   ===================================================================== */

/* -------------------------------------------------------------------
   STATE
------------------------------------------------------------------- */
var state = {
  power: false,
  brightness: 75,
  cct: 30,
  mode: 'white',
  hue: 0,
  sat: 100,
  connectedMAC: null,
  connectedName: '',
  devIdx: 0,
  charHandle: '0x000E',
  cccdHandle: '0x000F',
  seq: 1,
  scanResults: [],
  rpcTimeout: 8000,
  cmdQueue: [],
  cmdBusy: false
};

/* -------------------------------------------------------------------
   THINGSBOARD LIFECYCLE
------------------------------------------------------------------- */
self.onInit = function () {
  self.ctx.ngZone.run(function () {
    startScan();
  });
};
self.onDestroy = function () {};

/* -------------------------------------------------------------------
   RPC HELPERS
------------------------------------------------------------------- */
function sendRPC(method, params) {
  return new Promise(function (resolve, reject) {
    self.ctx.controlApi.sendTwoWayCommand(method, params, state.rpcTimeout)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err)  { console.error('[Tuya RPC]', err); reject(err); }
      );
  });
}
function sendCommand(atCmd) {
  return sendRPC('sendCommand', 'CFBL:0:' + atCmd);
}
function enqueueCmd(atCmd) {
  state.cmdQueue.push(atCmd);
  drainQueue();
}
function drainQueue() {
  if (state.cmdBusy || state.cmdQueue.length === 0) return;
  state.cmdBusy = true;
  var cmd = state.cmdQueue.shift();
  sendCommand(cmd)
    .catch(function () {})
    .finally(function () { state.cmdBusy = false; drainQueue(); });
}

/* -------------------------------------------------------------------
   OVERLAY
------------------------------------------------------------------- */
function showOverlay(msg, withSpinner) {
  var overlay = document.getElementById('ctrl-overlay');
  var msgEl   = document.getElementById('overlay-msg');
  var spinEl  = document.getElementById('overlay-spinner');
  overlay.classList.remove('hidden');
  msgEl.textContent = msg;
  if (withSpinner) { spinEl.classList.remove('hidden'); }
  else             { spinEl.classList.add('hidden'); }
}
function hideOverlay() {
  document.getElementById('ctrl-overlay').classList.add('hidden');
}

/* -------------------------------------------------------------------
   SCAN STATUS
------------------------------------------------------------------- */
function setScanStatus(text, spinning) {
  document.getElementById('scan-status-text').textContent = text;
  var mini = document.getElementById('scan-spinner-mini');
  var btn  = document.getElementById('btn-rescan');
  if (spinning) {
    mini.classList.remove('hidden');
    btn.classList.add('spinning');
    btn.disabled = true;
  } else {
    mini.classList.add('hidden');
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

/* -------------------------------------------------------------------
   SCAN
------------------------------------------------------------------- */
function startScan() {
  state.scanResults = [];
  document.getElementById('device-list').innerHTML = '';
  setScanStatus('\u0110ang qu\u00e9t...', true);
  showOverlay('\u0110ang t\u00ecm thi\u1ebft b\u1ecb...', false);

  sendCommand('MODULE_HW_RESET')
    .catch(function () {})
    .then(function () { return sendCommand('AT+GETINFO'); })
    .catch(function () {})
    .then(function () { return sendCommand('AT+CLEAR'); })
    .catch(function () {})
    .then(function () { return sendCommand('AT+SCAN=5000'); })
    .then(function (resp) { parseScanResponse(resp); })
    .catch(function () {})
    .then(function () { return sendCommand('AT+LIST'); })
    .then(function (resp) { parseListResponse(resp); })
    .catch(function () {})
    .then(function () {
      setScanStatus(state.scanResults.length + ' thi\u1ebft b\u1ecb', false);
      renderDeviceList();
      if (state.scanResults.length === 0) {
        showOverlay('Kh\u00f4ng t\u00ecm th\u1ea5y thi\u1ebft b\u1ecb.\nNh\u1ea5n \u27f3 \u0111\u1ec3 qu\u00e9t l\u1ea1i.', false);
      } else if (!state.connectedMAC) {
        showOverlay('\u2190 Ch\u1ecdn thi\u1ebft b\u1ecb \u0111\u1ec3 \u0111i\u1ec1u khi\u1ec3n', false);
      }
    });
}

function parseScanResponse(resp) {
  if (!resp) return;
  var text = typeof resp === 'string' ? resp : (resp.result || resp.value || JSON.stringify(resp));
  text.split(/[\n\x1E]+/).forEach(function (line) {
    var m = line.match(/\+SCAN:([0-9A-Fa-f:]{17}),([-\d]+),(.*)/);
    if (m) addOrUpdateDevice(m[1].toUpperCase(), m[2], m[3].trim());
  });
}

function parseListResponse(resp) {
  if (!resp) return;
  var text = typeof resp === 'string' ? resp : (resp.result || resp.value || JSON.stringify(resp));
  text.split(/[\n\x1E]+/).forEach(function (line) {
    var m = line.match(/\+DEV:(\d+),([0-9A-Fa-f:]{17}),([-\d]+),([^,]+),(.*)/);
    if (m) addOrUpdateDevice(m[2].toUpperCase(), m[3], m[5].trim());
  });
}

function addOrUpdateDevice(mac, rssi, name) {
  var ex = state.scanResults.find(function (d) { return d.mac === mac; });
  if (ex) {
    ex.rssi = parseInt(rssi) || ex.rssi;
    if (name && name !== 'Unknown') ex.name = name;
  } else {
    state.scanResults.push({ mac: mac, rssi: parseInt(rssi) || -99, name: name || 'Smart Light' });
  }
  state.scanResults.sort(function (a, b) { return b.rssi - a.rssi; });
}

function renderDeviceList() {
  var list = document.getElementById('device-list');
  list.innerHTML = '';
  if (state.scanResults.length === 0) {
    list.innerHTML = '<div class="no-devices-msg">Kh\u00f4ng t\u00ecm th\u1ea5y thi\u1ebft b\u1ecb</div>';
    return;
  }
  state.scanResults.forEach(function (dev, idx) {
    var item = document.createElement('div');
    item.className = 'device-item' + (dev.mac === state.connectedMAC ? ' selected' : '');
    item.innerHTML =
      '<span class="device-icon">&#128161;</span>' +
      '<span class="device-name">' + escapeHtml(dev.name) + '</span>';
    item.addEventListener('click', function () { connectDevice(dev, idx); });
    list.appendChild(item);
  });
}

/* -------------------------------------------------------------------
   CONNECT
------------------------------------------------------------------- */
function connectDevice(dev, listIdx) {
  if (state.connectedMAC === dev.mac) return;

  state.connectedMAC  = dev.mac;
  state.connectedName = dev.name;

  document.querySelectorAll('.device-item').forEach(function (el, i) {
    el.classList.toggle('selected', i === listIdx);
  });

  setStatusDot('connecting');
  document.getElementById('ctrl-device-name').textContent = dev.name;
  showOverlay('\u0110ang k\u1ebft n\u1ed1i...', true);

  sendCommand('AT+CONNECT=' + dev.mac)
    .then(function (resp) {
      var m = (resp || '').toString().match(/\+CONNECTED:(\d+)/);
      if (m) state.devIdx = parseInt(m[1]);
      return sendCommand('AT+DISC=' + state.devIdx);
    })
    .then(function (resp) {
      parseDiscResponse(resp);
      return sendCommand('AT+NOTIFY=' + state.devIdx + ',' + state.cccdHandle + ',1');
    })
    .catch(function () {})
    .then(function () { enterControlScreen(); });
}

function parseDiscResponse(resp) {
  if (!resp) return;
  var text = resp.toString();
  var m = text.match(/\+CHAR:[^,]+,(0x[0-9A-Fa-f]+),2[Bb]11/);
  if (m) {
    state.charHandle = m[1];
    var hdl = parseInt(state.charHandle, 16);
    state.cccdHandle = '0x' + (hdl + 1).toString(16).padStart(4, '0').toUpperCase();
  }
}

/* -------------------------------------------------------------------
   CONTROL SCREEN
------------------------------------------------------------------- */
function enterControlScreen() {
  state.power = true;
  state.seq   = 1;
  document.getElementById('ctrl-device-name').textContent = state.connectedName;
  document.getElementById('btn-disconnect').classList.remove('hidden');
  setStatusDot('on');
  hideOverlay();

  updatePowerUI(true);
  updateBrightnessUI(state.brightness);
  updateCCTUI(state.cct);
  setMode(state.mode);

  enqueueCmd(buildWriteCmd(buildLEDOnFrame()));
  enqueueCmd(buildWriteCmd(buildBrightnessFrame(state.brightness)));
  enqueueCmd(buildWriteCmd(buildCCTFrame(state.cct)));
}

function disconnectDevice() {
  state.cmdQueue = [];
  sendCommand('AT+DISCONNECT=' + state.devIdx).catch(function () {});
  state.connectedMAC = null;
  state.charHandle   = '0x000E';
  state.cccdHandle   = '0x000F';
  state.devIdx       = 0;

  document.getElementById('ctrl-device-name').textContent = '\u2014';
  document.getElementById('btn-disconnect').classList.add('hidden');
  setStatusDot('off');

  document.querySelectorAll('.device-item').forEach(function (el) { el.classList.remove('selected'); });
  showOverlay('\u2190 Ch\u1ecdn thi\u1ebft b\u1ecb \u0111\u1ec3 k\u1ebft n\u1ed1i', false);
  startScan();
}

function setStatusDot(s) {
  document.getElementById('status-dot').setAttribute('data-state', s);
}

/* -------------------------------------------------------------------
   POWER
------------------------------------------------------------------- */
function onPowerToggle(checked) {
  state.power = checked;
  updatePowerUI(checked);
  enqueueCmd(buildWriteCmd(checked ? buildLEDOnFrame() : buildLEDOffFrame()));
}

function updatePowerUI(on) {
  document.getElementById('bulb-preview').className = 'bulb-preview ' + (on ? 'on' : 'off');
  document.getElementById('power-label').textContent = on ? 'B\u1eacT' : 'T\u1eaeT';
  document.getElementById('power-toggle').checked = on;
  document.getElementById('section-brightness').className = 'ctrl-section' + (on ? '' : ' dimmed');
  var tabs = document.getElementById('section-tabs');
  tabs.style.opacity = on ? '1' : '0.4';
  tabs.style.pointerEvents = on ? '' : 'none';
  document.querySelectorAll('#panel-white, #panel-color').forEach(function (p) {
    var isHidden = p.classList.contains('hidden');
    p.className = 'ctrl-section' + (isHidden ? ' hidden' : '') + (!on ? ' dimmed' : '');
  });
  if (on) updatePreviewColor();
}

/* -------------------------------------------------------------------
   BRIGHTNESS
------------------------------------------------------------------- */
function onBrightnessInput(val) {
  state.brightness = parseInt(val);
  updateBrightnessUI(state.brightness);
}
function sendBrightness(val) {
  state.brightness = parseInt(val);
  enqueueCmd(buildWriteCmd(buildBrightnessFrame(state.brightness)));
}
function updateBrightnessUI(pct) {
  document.getElementById('brightness-value').textContent = pct + '%';
  var s = document.getElementById('brightness-slider');
  s.value = pct;
  s.style.background = 'linear-gradient(to right, #e0a000 0%, #e0a000 ' + pct + '%, #1e2a40 ' + pct + '%, #1e2a40 100%)';
}

/* -------------------------------------------------------------------
   MODE TABS
------------------------------------------------------------------- */
function setMode(mode) {
  state.mode = mode;
  document.getElementById('tab-white').className = 'tab' + (mode === 'white' ? ' active' : '');
  document.getElementById('tab-color').className = 'tab' + (mode === 'color' ? ' active' : '');
  document.getElementById('panel-white').className =
    'ctrl-section' + (mode !== 'white' ? ' hidden' : '') + (!state.power ? ' dimmed' : '');
  document.getElementById('panel-color').className =
    'ctrl-section' + (mode !== 'color' ? ' hidden' : '') + (!state.power ? ' dimmed' : '');
  enqueueCmd(buildWriteCmd(mode === 'color' ? buildModeColorFrame() : buildModeWhiteFrame()));
}

/* -------------------------------------------------------------------
   CCT
------------------------------------------------------------------- */
function onCCTInput(val) { state.cct = parseInt(val); updateCCTUI(state.cct); }
function sendCCT(val)    { state.cct = parseInt(val); enqueueCmd(buildWriteCmd(buildCCTFrame(state.cct))); }
function updateCCTUI(pct) { document.getElementById('cct-slider').value = pct; updatePreviewColor(); }

/* -------------------------------------------------------------------
   PRESET COLORS
------------------------------------------------------------------- */
function sendHSV(hue, sat, val) {
  state.hue = hue;
  state.sat = sat;
  enqueueCmd(buildWriteCmd(buildHSVFrame(hue, sat, val)));
  updatePreviewColor();
}

/* -------------------------------------------------------------------
   CUSTOM PICKER
------------------------------------------------------------------- */
function openPicker() {
  document.getElementById('picker-panel').classList.toggle('hidden');
}
function onPickerInput() {
  var h = parseInt(document.getElementById('hue-slider').value);
  var s = parseInt(document.getElementById('sat-slider').value);
  document.getElementById('hue-val').textContent = h + '\u00b0';
  document.getElementById('sat-val').textContent = s + '%';
  document.getElementById('sat-slider').style.background =
    'linear-gradient(to right, #888, hsl(' + h + ',100%,50%))';
}
function sendCustomHSV() {
  var h = parseInt(document.getElementById('hue-slider').value);
  var s = parseInt(document.getElementById('sat-slider').value);
  state.hue = h; state.sat = s;
  sendHSV(h, s, state.brightness);
  document.getElementById('picker-panel').classList.add('hidden');
}

/* -------------------------------------------------------------------
   PREVIEW COLOR
------------------------------------------------------------------- */
function updatePreviewColor() {
  var glow    = document.getElementById('bulb-glow');
  var preview = document.getElementById('bulb-preview');
  if (!state.power) { glow.style.opacity = '0'; return; }

  var color;
  if (state.mode === 'white') {
    var t = state.cct / 100;
    var r = Math.round(255 * (1 - t * 0.2));
    var g = Math.round(160 + 40 * t);
    var b = Math.round(64  + 191 * t);
    color = 'rgba(' + r + ',' + g + ',' + b + ',0.55)';
    preview.style.background = 'linear-gradient(135deg, #2d2610, #3e3210, #2d2610)';
  } else {
    color = 'hsla(' + state.hue + ',' + state.sat + '%,55%,0.55)';
    preview.style.background =
      'radial-gradient(circle at center, hsla(' + state.hue + ',60%,20%,1) 0%, #1a1a2e 70%)';
  }
  glow.style.background = 'radial-gradient(circle, ' + color + ' 0%, transparent 70%)';
  glow.style.opacity = '1';
}

/* -------------------------------------------------------------------
   TUYA FRAME BUILDERS
   55 AA VER SEQ LEN_H LEN_L [DP_ID DP_TYPE DP_LEN_H DP_LEN_L VALUE...] CRC
------------------------------------------------------------------- */
function nextSeq() { var s = state.seq; state.seq = (state.seq + 1) & 0xFF; return s; }

function calcCRC(bytes) {
  var sum = 0;
  for (var i = 0; i < bytes.length; i++) sum += bytes[i];
  return sum & 0xFF;
}
function toHex(bytes) {
  return bytes.map(function (b) { return b.toString(16).padStart(2, '0').toUpperCase(); }).join('');
}

function buildFrame(dpId, dpType, valueBytes) {
  var seq     = nextSeq();
  var payload = [dpId >> 8, dpId & 0xFF, dpType,
                 (valueBytes.length >> 8) & 0xFF, valueBytes.length & 0xFF]
                .concat(valueBytes);
  var header  = [0x00, seq, (payload.length >> 8) & 0xFF, payload.length & 0xFF];
  var forCRC  = header.concat(payload);
  return [0x55, 0xAA].concat(forCRC).concat([calcCRC(forCRC)]);
}

function buildLEDOnFrame()   { return buildFrame(0x0005, 0x01, [0x00, 0x01, 0x00, 0x01, 0x01]); }
function buildLEDOffFrame()  { return buildFrame(0x0005, 0x01, [0x00, 0x01, 0x00, 0x01, 0x00]); }

function buildBrightnessFrame(pct) {
  var val = Math.round(pct * 10);
  return buildFrame(0x0003, 0x02, [0x00, 0x04,
    (val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF]);
}
function buildCCTFrame(pct) {
  var val = Math.round(pct * 10);
  return buildFrame(0x0004, 0x02, [0x00, 0x04,
    (val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF]);
}
function buildModeColorFrame() { return buildFrame(0x0002, 0x04, [0x00, 0x01, 0x01]); }
function buildModeWhiteFrame() { return buildFrame(0x0002, 0x04, [0x00, 0x01, 0x00]); }

function buildHSVFrame(hDeg, sPct, vPct) {
  var h = Math.round(hDeg * 1000 / 365);
  var s = Math.round(sPct * 10);
  var v = Math.round(vPct * 10);
  function pad4(n) { return n.toString(16).toUpperCase().padStart(4, '0'); }
  var strVal   = pad4(h) + pad4(s) + pad4(v);
  var strBytes = strVal.split('').map(function (c) { return c.charCodeAt(0); });
  return buildFrame(0x0005, 0x03, [0x00, 0x0C].concat(strBytes));
}

function buildWriteCmd(frameBytes) {
  return 'AT+WRITE=' + state.devIdx + ',' + state.charHandle + ',' + toHex(frameBytes);
}

/* -------------------------------------------------------------------
   UTILITIES
------------------------------------------------------------------- */
var toastTimer = null;
function showToast(msg) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 2500);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}