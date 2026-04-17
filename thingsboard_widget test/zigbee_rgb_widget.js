/* =====================================================================
   Zigbee RGB LED Controller — ThingsBoard Widget JavaScript
   Protocol  : CFML:CFZB:<slot>:<cmd>  (hex-encoded via sendCommand RPC)
   Target    : ESP32-C6 Super Mini running ZigbeeColorDimmableLight (EP 0x0A)
   Coordinator: E180-ZG120B (Ebyte) on DA2 gateway stack slot 1

   Commands used:
     AT+FIND                                      — auto-discover + bind end device
     AT+UNBIND                                    — remove binding
     AT+TURNON / AT+TURNOFF / AT+TOGGLE           — on/off all bound devices
     AT+DSTADDR=<short>  +  AT+DSTEP=<ep>        — target specific device
     MODULE_ZCL_SEND_CONTROL_CMD:<s>,<ep>,0300,08,<xH>,<yH>,000A  — color XY
     MODULE_ZCL_SEND_CONTROL_CMD:<s>,<ep>,0008,04,<level>,0001    — brightness
   ===================================================================== */

/* ── State ── */
var state = {
  slot      : '1',       /* E180 is typically stack slot 1 */
  shortAddr : '',        /* e.g. "1A2B"  (4 hex digits, upper) */
  ieee      : '',        /* 16 hex digits */
  ep        : '0A',      /* ZCL endpoint of end device (0x0A = 10 decimal) */
  bound     : false,     /* true = AT+FIND succeeded and AT+DSTADDR set */
  finding   : false,
  onOffState: false,
  levelVal  : 254,
  rpcTimeout: 15000,
};

var _root = null;

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard Lifecycle
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  try {
    _root = document.getElementById('zb-rgb-root');
    syncSlotSelect();
    updateControlPanel();
    logInfo('Widget ready — Zigbee RGB (slot ' + state.slot + ')');
  } catch (e) {
    console.error('[ZB-RGB] onInit:', e);
  }
};

self.onDestroy = function () {};

/* Telemetry: receive async FIND events pushed by gateway */
self.onDataUpdated = function () {
  try {
    var data = self.ctx.data;
    if (!data || !data.length) return;
    for (var k = 0; k < data.length; k++) {
      var keyCtx = data[k];
      if (!keyCtx.data || !keyCtx.data.length) continue;
      var latest  = keyCtx.data[keyCtx.data.length - 1];
      var rawVal  = latest[1];
      var decoded = decodeResp(rawVal);
      decoded.split(/[\x1e\n]+/).map(function (l) { return l.trim(); })
        .filter(Boolean)
        .forEach(function (line) {
          logEvt('Uplink: ' + line);
          handleAsyncEvent(line);
        });
      break;
    }
  } catch (e) {}
};

/* ────────────────────────────────────────────────────────────────────
   RPC / CFML Helpers
   ──────────────────────────────────────────────────────────────────── */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi — assign target device in widget settings'));
      return;
    }
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs)
      .subscribe(
        function (r) { resolve(r); },
        function (e) { reject(e); }
      );
  });
}

function stringToHex(str) {
  var h = '';
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i).toString(16).toUpperCase();
    h += (c.length === 1 ? '0' : '') + c;
  }
  return h;
}

function hexToString(hex) {
  var s = '';
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(b)) s += String.fromCharCode(b);
  }
  return s;
}

function decodeResp(raw) {
  if (!raw) return '';
  if (typeof raw === 'object') {
    raw = raw.result !== undefined ? raw.result
         : raw.data  !== undefined ? raw.data : JSON.stringify(raw);
  }
  var s = String(raw);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0) s = hexToString(s);
  return s;
}

/**
 * sendCFML — wraps cmd in CFML:CFZB:<slot>: and sends as hex RPC
 * Examples:
 *   sendCFML('AT+FIND')
 *   sendCFML('AT+TURNON')
 *   sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:1A2B,0A,0300,08,3E5B,3C3C,000A')
 */
function sendCFML(cmd, timeoutMs) {
  var full = 'CFML:CFZB:' + state.slot + ':' + cmd;
  logTx(full);
  return sendRPC('sendCommand', stringToHex(full), timeoutMs || state.rpcTimeout)
    .then(function (resp) {
      var text = decodeResp(resp);
      text.split(/[\x1e\n]+/).map(function (l) { return l.trim(); }).filter(Boolean)
        .forEach(function (line) {
          var ul = line.toUpperCase();
          if (ul.indexOf('FAIL') !== -1 || ul.indexOf('ERROR') !== -1 || ul.indexOf('MISS') !== -1) {
            logFail(line);
          } else if (ul.indexOf('OK') !== -1) {
            logOk(line);
          } else {
            logEvt(line);
          }
          handleAsyncEvent(line);
        });
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
   Async Event Handler
   ──────────────────────────────────────────────────────────────────── */
function handleAsyncEvent(line) {
  var m;

  /* FIND:<short4>,<ieee16>  — firmware format */
  m = line.match(/^FIND:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16})/i);
  if (m) { setFoundNode(m[1].toUpperCase(), m[2].toUpperCase()); return; }

  /* FIND:ADDR=<short>  — E180 AT response format */
  m = line.match(/^FIND:ADDR=([0-9A-Fa-f]{1,4})/i);
  if (m) { setFoundNode(m[1].toUpperCase().padStart(4,'0'), ''); return; }

  /* FIND:MISS */
  if (/^FIND:MISS/i.test(line)) {
    showFindMiss(); return;
  }

  /* JOIN:<short4>,<ieee16>,<type>  — new device joined */
  m = line.match(/^JOIN:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16}),(\d)/i);
  if (m) {
    logOk('New device joined: 0x' + m[1].toUpperCase() + ' (' +
          ({0:'Coord',1:'Router',2:'End Device',3:'Sleepy ED'}[m[3]]||'?') + ')');
    showToast('Device joined: 0x' + m[1].toUpperCase());
    return;
  }
}

function setFoundNode(short, ieee) {
  state.shortAddr = short;
  state.ieee      = ieee || '';
  state.bound     = true;
  state.finding   = false;

  /* Show node card */
  ge('node-empty').classList.add('hidden');
  ge('node-miss') .classList.add('hidden');
  var card = ge('node-card');
  card.classList.remove('hidden');
  card.classList.add('active');
  setEl('node-addr',     '0x' + short);
  setEl('node-ieee',     ieee ? 'IEEE: ' + ieee : 'IEEE: —');
  setEl('node-ep-label', 'EP:  0x' + state.ep.toUpperCase());

  /* Hero bar */
  setEl('hero-name', 'Node 0x' + short);
  setEl('hero-addr', ieee ? ieee.match(/.{2}/g).join(':') : '—');
  ge('hero-icon').classList.add('bound');

  /* Status */
  setStatus('bound', 'Bound 0x' + short);
  setFindSpinner(false);

  /* Show controls */
  ge('ctrl-overlay').classList.add('hidden');

  /* Set DSTADDR + DSTEP so AT+TURNON/TURNOFF target this specific node */
  sendCFML('AT+DSTADDR=' + short, 3000)
    .then(function () {
      var epDec = parseInt(state.ep, 16).toString();
      return sendCFML('AT+DSTEP=' + epDec, 3000);
    })
    .then(function () { logOk('DSTADDR=0x' + short + ' DSTEP=0x' + state.ep + ' set'); })
    .catch(function () {});

  showToast('Bound to 0x' + short + ' ✓');
  logOk('Device found and bound: 0x' + short);
}

function showFindMiss() {
  state.finding = false;
  setFindSpinner(false);
  setStatus('miss', 'FIND:MISS');
  ge('node-empty').classList.add('hidden');
  ge('node-card') .classList.add('hidden');
  ge('node-miss') .classList.remove('hidden');
  ge('overlay-spinner').classList.add('hidden');
  setEl('overlay-msg', 'FIND:MISS — Power on end device\nthen press Find again');
  showToast('FIND:MISS — end device not found');
}

/* ────────────────────────────────────────────────────────────────────
   Find / Unbind
   ──────────────────────────────────────────────────────────────────── */
function findDevice() {
  if (state.finding) return;
  state.finding = true;
  setFindSpinner(true);
  setStatus('finding', 'Finding…');
  ge('node-miss').classList.add('hidden');
  ge('ctrl-overlay').classList.remove('hidden');
  ge('overlay-spinner').classList.remove('hidden');
  setEl('overlay-msg', 'Searching for Zigbee end device…');
  logInfo('Sending AT+FIND…');

  sendCFML('MODULE_AUTO_FIND_TARGET', 8000)
    .then(function (resp) {
      /* FIND result may arrive inline (short RPC) or async via telemetry */
      var text = decodeResp(resp);
      if (/FIND:MISS/i.test(text)) { showFindMiss(); return; }
      /* If we got an inline FIND:<short> result, handleAsyncEvent handles it */
    })
    .catch(function () {
      state.finding = false;
      setFindSpinner(false);
      setStatus('idle', 'No Device');
      ge('overlay-spinner').classList.add('hidden');
      setEl('overlay-msg', 'RPC error — check gateway connection');
    });
}

function unbindDevice() {
  sendCFML('AT+UNBIND', 5000)
    .then(function () {
      state.bound     = false;
      state.shortAddr = '';
      state.ieee      = '';
      setStatus('idle', 'No Device');
      ge('node-card').classList.add('hidden');
      ge('node-card').classList.remove('active');
      ge('node-empty').classList.remove('hidden');
      ge('hero-icon').classList.remove('bound');
      setEl('hero-name', 'Not Bound');
      setEl('hero-addr', '—');
      ge('ctrl-overlay').classList.remove('hidden');
      ge('overlay-spinner').classList.add('hidden');
      setEl('overlay-msg', '← Press Find to discover\nZigbee end device');
      showToast('Unbound ✓');
    })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   On/Off Toggle
   ──────────────────────────────────────────────────────────────────── */
function onLedToggle(checked) {
  if (!state.bound) {
    var tog = ge('led-toggle');
    if (tog) tog.checked = !checked;
    showToast('Find a device first');
    return;
  }
  state.onOffState = checked;
  updateLEDUI();
  sendCFML(checked ? 'AT+TURNON' : 'AT+TURNOFF', 5000)
    .then(function () { logOk('LED ' + (checked ? 'ON' : 'OFF')); })
    .catch(function () {
      /* Fallback: addressed ZCL On/Off */
      var t = getTarget();
      sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + t + ',0006,' + (checked ? '01' : '00'), 5000)
        .catch(function () {});
    });
}

function updateLEDUI() {
  var tog  = ge('led-toggle');
  var wrap = ge('led-icon-wrap');
  var icon = ge('led-icon');
  var stat = ge('led-status-text');
  if (tog)  tog.checked = state.onOffState;
  if (wrap) wrap.setAttribute('data-on', state.onOffState ? 'true' : 'false');
  if (icon) icon.textContent = state.onOffState ? '💡' : '🔦';
  if (stat) stat.textContent = state.onOffState ? 'LED is ON' : 'LED is OFF';
}

/* ────────────────────────────────────────────────────────────────────
   Color Control — ZCL Move to Color (cmd 0x08, cluster 0x0300)
   ──────────────────────────────────────────────────────────────────── */
function sendFixedColor(hexStr, btnEl) {
  if (!state.bound) { showToast('Find a device first'); return; }

  var rgb = hexToRgb('#' + hexStr);
  if (!rgb) return;
  var xy = rgbToXY(rgb.r, rgb.g, rgb.b);
  var xH = pad4(Math.round(xy.x * 65535).toString(16).toUpperCase());
  var yH = pad4(Math.round(xy.y * 65535).toString(16).toUpperCase());

  /* Update color preview */
  var cp = ge('color-preview');
  if (cp) { cp.style.background = '#' + hexStr; cp.style.boxShadow = '0 0 14px #' + hexStr + '88'; }
  setEl('color-hex-label', '#' + hexStr.toUpperCase());

  /* Mark active button */
  var btns = (_root || document).querySelectorAll('.btn-color');
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
  if (btnEl) btnEl.classList.add('active');

  /* Turn on if currently off */
  if (!state.onOffState) {
    state.onOffState = true;
    updateLEDUI();
    sendCFML('AT+TURNON', 3000).catch(function () {});
  }

  logInfo('Sending color #' + hexStr.toUpperCase() + ' → XY(' + xH + ',' + yH + ')');
  /* ZCL cmd 0x08 = MoveToColor, params: X(2B), Y(2B), transitionTime(2B) */
  sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + getTarget() + ',0300,08,' + xH + ',' + yH + ',000A', 10000)
    .then(function () { showToast('Color sent ✓'); })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Brightness — ZCL Move to Level (cmd 0x04, cluster 0x0008)
   ──────────────────────────────────────────────────────────────────── */
function onLevelInput(v) {
  state.levelVal = parseInt(v, 10);
  refreshLevelSlider();
}

function onLevelChange(v) {
  state.levelVal = parseInt(v, 10);
  refreshLevelSlider();
  if (!state.bound) return;
  var lvl = pad2(state.levelVal);
  /* ZCL cmd 0x04 = MoveToLevel(WithOnOff), params: level(1B), time(2B) */
  sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + getTarget() + ',0008,04,' + lvl + ',0001', 10000)
    .catch(function () {});
}

function refreshLevelSlider() {
  var pct = Math.round(state.levelVal / 254 * 100);
  var sl  = ge('level-slider');
  if (sl) {
    sl.value = state.levelVal;
    sl.style.background =
      'linear-gradient(to right, var(--zb) ' + pct + '%, var(--surface3) ' + pct + '%)';
  }
  setEl('level-val', pct + '%');
}

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */
function getTarget() {
  /* Returns "<short>,<ep>" for ZCL command — e.g. "1A2B,0A" */
  return (state.shortAddr || '0000') + ',' + (state.ep || '0A').toUpperCase();
}

function onSlotChange(v) { state.slot = v; logInfo('Slot changed to ' + v); }
function onEpChange(v) {
  var ep = v.replace(/[^0-9A-Fa-f]/g, '').substring(0, 2).toUpperCase() || '0A';
  state.ep = ep;
  setEl('node-ep-label', 'EP: 0x' + ep);
  ge('ep-input').value = ep;
}

function syncSlotSelect() {
  var s = ge('slot-select');
  if (s) s.value = state.slot;
}

function setStatus(st, txt) {
  var pill = ge('status-pill');
  var dot  = ge('status-dot');
  var stxt = ge('status-text');
  if (pill) pill.setAttribute('data-state', st);
  if (dot)  dot.setAttribute('data-state', st);
  if (stxt) stxt.textContent = txt || st;
}

function setFindSpinner(on) {
  var btn = ge('btn-find');
  if (!btn) return;
  btn.disabled = on;
  btn.style.opacity = on ? '0.5' : '1';
}

function updateControlPanel() {
  ge('ctrl-overlay').classList.toggle('hidden', state.bound);
  if (!state.bound) {
    ge('overlay-spinner').classList.add('hidden');
    setEl('overlay-msg', '← Press Find to discover\nZigbee end device');
  }
  refreshLevelSlider();
  updateLEDUI();
}

/* ── DOM helpers ── */
function ge(id) { return (_root || document).querySelector('#' + id); }
function setEl(id, txt) { var el = ge(id); if (el) el.textContent = txt; }

/* ── Log helpers ── */
var MAX_LOG = 80;
function _appendLog(cls, msg) {
  var el = ge('console-log');
  if (!el) return;
  var d = document.createElement('div');
  d.className = 'log-line ' + cls;
  d.textContent = msg;
  el.appendChild(d);
  while (el.children.length > MAX_LOG) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function logTx(m)   { _appendLog('log-tx',   '→ ' + m); }
function logOk(m)   { _appendLog('log-ok',   '✓ ' + m); }
function logFail(m) { _appendLog('log-fail', '✗ ' + m); }
function logEvt(m)  { _appendLog('log-evt',  '⚡ ' + m); }
function logInfo(m) { _appendLog('log-info', '  ' + m); }
function clearLog() { var el = ge('console-log'); if (el) el.innerHTML = ''; }

function showToast(msg) {
  var t = ge('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.add('hidden'); }, 2400);
}

/* ── Color helpers ── */
function pad2(n) { return ('0' + Math.round(n).toString(16)).slice(-2).toUpperCase(); }
function pad4(s) { while (s.length < 4) s = '0' + s; return s; }

function hexToRgb(hex) {
  var m = (hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
}

/* sRGB → CIE 1931 XY (Philips Wide Gamut matrix) */
function rgbToXY(r, g, b) {
  function lin(c) {
    c = c / 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  }
  var R = lin(r), G = lin(g), B = lin(b);
  var X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  var Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  var Z = R * 0.000088 + G * 0.072310 + B * 0.986039;
  var sum = X + Y + Z;
  return (sum === 0) ? { x: 0.3127, y: 0.3290 } : { x: X / sum, y: Y / sum };
}

/* ── Expose to ThingsBoard HTML onclick attributes ── */
window.findDevice     = findDevice;
window.unbindDevice   = unbindDevice;
window.onSlotChange   = onSlotChange;
window.onEpChange     = onEpChange;
window.onLedToggle    = onLedToggle;
window.onLevelInput   = onLevelInput;
window.onLevelChange  = onLevelChange;
window.sendFixedColor = sendFixedColor;
window.clearLog       = clearLog;
