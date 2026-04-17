/* =====================================================================
   DA2 LoRa Wio-E5 Monitor Widget — ThingsBoard Latest Values Widget JS
   Type    : Latest Values (datasource only — no controlApi / RPC)
   Datasource: Gateway device → key "data" (Latest Telemetry)

   Handles async events from telemetry (Wio-E5 P2P TEST mode):
     CFLR:<slot>:EVT:+TEST: RXLRPKT <len>, <rssi>, <snr>, <hexdata>
     CFLR:<slot>:EVT:+TEST: TXLRPKT       — TX done ACK
     CFLR:<slot>:EVT:+TEST: RFCFG ...     — RF config info
     CFLR:<slot>:EVT:+MODE: TEST          — module mode

   IMPORTANT THINGSBOARD NOTES:
     - Avoid .finally() — not polyfilled in all TB versions
     - Use document.getElementById() — no shadow DOM
   ===================================================================== */

var lrmState = {
  slot:       '',     /* '' = all slots, '0' or '1' = filter one slot */
  rxCount:    0,
  txAckCount: 0,
  history:    [],     /* max LRM_HIST_MAX rows, newest first */
  lastRfCfg:  ''      /* last +TEST: RFCFG value seen */
};

var LRM_HIST_MAX = 40;

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
self.onInit = function () {
  loadState();
  applySlotSelect();
  renderHistory();
};

self.onDestroy = function () {};

/* WebSocket push — fires on every new telemetry value */
self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    var now = Date.now();
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      var latest = kd.data[kd.data.length - 1];
      var dataTs = latest[0];
      var raw    = latest[1];
      /* Skip stale data replayed on widget reload */
      if (dataTs && (now - dataTs) > 60000) continue;
      var decoded = lrmDecodeHex(raw);
      lrmSplitLines(decoded).forEach(function (line) { lrmParseLine(line); });
    }
  } catch (e) { /* silent — monitor must not crash */ }
};

/* ═══════════════════════════════════════════════════════════════════
   Line Parser (Wio-E5 P2P TEST mode events)
   ═══════════════════════════════════════════════════════════════════ */
function lrmParseLine(line) {
  /* Extract slot from CFLR:<slot>:... */
  var slotMatch = line.match(/^CFLR:(\d):/);
  var lineSlot  = slotMatch ? slotMatch[1] : null;

  /* Slot filter */
  if (lrmState.slot && lineSlot && lineSlot !== lrmState.slot) return;

  /* Strip CFLR:<slot>:EVT:/OK:/FAIL: prefix */
  var l = line.replace(/^CFLR:\d+:(EVT:|OK:|FAIL:[^:]*:)/, '');
  var m;

  /* +TEST: RXLRPKT <len>, <rssi>, <snr>, <hexdata>
     Wio-E5 P2P received-packet event.
     Example: "+TEST: RXLRPKT 8, -60, 10, AABBCCDD11223344" */
  m = l.match(/^\+TEST:\s*RXLRPKT\s+(\d+),\s*(-?\d+),\s*(-?\d+),\s*([0-9A-Fa-f]+)/i);
  if (m) {
    lrmHandleP2PRx(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4].toUpperCase(), lineSlot);
    return;
  }

  /* +TEST: TXLRPKT — P2P TX acknowledged by module */
  if (/^\+TEST:\s*TXLRPKT/i.test(l)) {
    lrmState.txAckCount++;
    setEl('lrm-tx-count', String(lrmState.txAckCount));
    setPill('active', 'TX ACK');
    return;
  }

  /* +TEST: RFCFG ... — RF config info */
  if (/^\+TEST:\s*RFCFG/i.test(l)) {
    lrmState.lastRfCfg = l.replace(/^\+TEST:\s*RFCFG\s*/i, '');
    setEl('lrm-rf-cfg', escHtml(lrmState.lastRfCfg));
    return;
  }

  /* +MODE: TEST — module in TEST mode */
  if (/^\+MODE:\s*TEST/i.test(l)) {
    setPill('joined', 'TEST Mode');
    return;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Handle a received downlink
   ═══════════════════════════════════════════════════════════════════ */
function lrmHandleRx(win, port, len, hex, slot) {
  var ts    = new Date().toLocaleTimeString('en-GB', { hour12: false });
  var ascii = lrmHexToAscii(hex);

  /* Update latest RX card */
  var card = ge('lrm-latest');
  if (card) {
    card.setAttribute('data-empty', 'false');
    card.innerHTML =
      '<div class="lrm-rx-meta">' +
        '<div class="lrm-rx-meta-item">' +
          '<span class="lrm-rx-label">Window</span>' +
          '<span class="lrm-win-badge">' + win + '</span>' +
        '</div>' +
        '<div class="lrm-rx-meta-item">' +
          '<span class="lrm-rx-label">Port</span>' +
          '<span class="lrm-rx-val">' + port + '</span>' +
        '</div>' +
        '<div class="lrm-rx-meta-item">' +
          '<span class="lrm-rx-label">Size</span>' +
          '<span class="lrm-rx-val">' + len + ' B</span>' +
        '</div>' +
        (slot ? '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Slot</span><span class="lrm-rx-val">' + slot + '</span></div>' : '') +
        '<div class="lrm-rx-meta-item">' +
          '<span class="lrm-rx-label">Time</span>' +
          '<span class="lrm-rx-val">' + ts + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="lrm-data-row">' +
        '<div class="lrm-data-label">Hex</div>' +
        '<div class="lrm-data-hex">' + escHtml(hex || '(empty)') + '</div>' +
        '<div class="lrm-data-label" style="margin-top:6px">ASCII</div>' +
        '<div class="lrm-data-ascii">' + escHtml(ascii || '(binary)') + '</div>' +
      '</div>';
  }

  /* Add to history (newest first) */
  lrmState.history.unshift({ win: win, port: port, len: len, hex: hex, ts: ts, slot: slot || '' });
  if (lrmState.history.length > LRM_HIST_MAX) lrmState.history.pop();

  lrmState.rxCount++;
  setEl('lrm-rx-count', String(lrmState.rxCount));
  setEl('lrm-last-ts',  'Last: ' + ts);
  setPill('active', 'RX ' + win);
  renderHistory();
  saveState();
}

/* ═══════════════════════════════════════════════════════════════════
   Handle a received P2P packet (+TEST: RXLRPKT)
   ═══════════════════════════════════════════════════════════════════ */
function lrmHandleP2PRx(len, rssi, snr, hex, slot) {
  var ts    = new Date().toLocaleTimeString('en-GB', { hour12: false });
  var ascii = lrmHexToAscii(hex);
  var card  = ge('lrm-latest');
  if (card) {
    card.setAttribute('data-empty', 'false');
    card.innerHTML =
      '<div class="lrm-rx-meta">' +
        '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">RSSI</span><span class="lrm-rx-val">' + rssi + ' dBm</span></div>' +
        '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">SNR</span><span class="lrm-rx-val">' + snr + ' dB</span></div>' +
        '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Size</span><span class="lrm-rx-val">' + len + ' B</span></div>' +
        (slot ? '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Slot</span><span class="lrm-rx-val">' + slot + '</span></div>' : '') +
        '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Time</span><span class="lrm-rx-val">' + ts + '</span></div>' +
      '</div>' +
      '<div class="lrm-data-row">' +
        '<div class="lrm-data-label">Hex</div>' +
        '<div class="lrm-data-hex">' + escHtml(hex || '(empty)') + '</div>' +
        '<div class="lrm-data-label" style="margin-top:6px">ASCII</div>' +
        '<div class="lrm-data-ascii">' + escHtml(ascii || '(binary)') + '</div>' +
      '</div>';
  }
  lrmState.history.unshift({ win: 'P2P', port: 0, len: len, hex: hex, ts: ts, slot: slot || '', rssi: rssi, snr: snr });
  if (lrmState.history.length > LRM_HIST_MAX) lrmState.history.pop();
  lrmState.rxCount++;
  setEl('lrm-rx-count', String(lrmState.rxCount));
  setEl('lrm-last-ts',  'Last: ' + ts);
  setPill('active', 'P2P RX');
  renderHistory();
  saveState();
}

/* ═══════════════════════════════════════════════════════════════════
   Render History List
   ═══════════════════════════════════════════════════════════════════ */
function renderHistory() {
  var el = ge('lrm-history');
  if (!el) return;
  el.innerHTML = '';

  if (!lrmState.history.length) {
    var hint = document.createElement('div');
    hint.className = 'lrm-hist-empty';
    hint.textContent = 'No packets received yet';
    el.appendChild(hint);
    return;
  }

  lrmState.history.forEach(function (p) {
    var row = document.createElement('div');
    row.className = 'lrm-hist-row';
    var hexPreview = p.hex.length > 24 ? p.hex.substr(0, 24) + '…' : p.hex;
    row.innerHTML =
      '<span class="lrm-hist-ts">'   + escHtml(p.ts)  + '</span>' +
      '<span class="lrm-hist-win">'  +
        '<span class="lrm-hist-win-badge">' + escHtml(p.win) + '</span>' +
      '</span>' +
      '<span class="lrm-hist-port">p:' + p.port + '</span>' +
      '<span class="lrm-hist-size">' + p.len + 'B</span>' +
      '<span class="lrm-hist-hex">'  + escHtml(hexPreview || '—') + '</span>';
    el.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Controls
   ═══════════════════════════════════════════════════════════════════ */
function lrmSetSlot(val) {
  lrmState.slot = val;
  saveState();
}

function lrmClearHistory() {
  lrmState.history  = [];
  lrmState.rxCount  = 0;
  lrmState.txAckCount = 0;
  setEl('lrm-rx-count', '0');
  setEl('lrm-tx-count', '0');
  setEl('lrm-last-ts',  '—');
  var card = ge('lrm-latest');
  if (card) {
    card.setAttribute('data-empty', 'true');
    card.innerHTML =
      '<div class="lrm-hint">' +
        '<div class="hint-icon">📡</div>' +
        '<div class="hint-title">No downlink received yet</div>' +
      '</div>';
  }
  renderHistory();
  setPill('idle', 'Waiting');
  saveState();
}

/* ═══════════════════════════════════════════════════════════════════
   LocalStorage Persistence
   ═══════════════════════════════════════════════════════════════════ */
var LRM_LS_KEY = 'lr_wioe5_mon_v1';

function saveState() {
  try {
    localStorage.setItem(LRM_LS_KEY, JSON.stringify({
      slot:       lrmState.slot,
      rxCount:    lrmState.rxCount,
      txAckCount: lrmState.txAckCount,
      history:    lrmState.history.slice(0, 20)   /* persist last 20 only */
    }));
  } catch (e) {}
}

function loadState() {
  try {
    var raw = localStorage.getItem(LRM_LS_KEY);
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.slot       !== undefined) lrmState.slot       = s.slot;
    if (s.rxCount    !== undefined) lrmState.rxCount    = s.rxCount;
    if (s.txAckCount !== undefined) lrmState.txAckCount = s.txAckCount;
    if (s.history    && s.history.length) lrmState.history = s.history;
    setEl('lrm-rx-count', String(lrmState.rxCount));
    setEl('lrm-tx-count', String(lrmState.txAckCount));
  } catch (e) {}
}

function applySlotSelect() {
  var s = ge('lrm-slot');
  if (s) s.value = lrmState.slot;
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */
function lrmDecodeHex(val) {
  if (!val) return '';
  if (typeof val === 'object') {
    if (val.result !== undefined) val = val.result;
    else if (val.data !== undefined) val = val.data;
  }
  var s = String(val);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    var out = '';
    for (var i = 0; i < s.length; i += 2) {
      var b = parseInt(s.substr(i, 2), 16);
      if (!isNaN(b)) out += String.fromCharCode(b);
    }
    return out;
  }
  return s;
}

function lrmSplitLines(s) {
  if (!s) return [];
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    var ci = x.indexOf('CFLR:');
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

function lrmHexToAscii(hex) {
  if (!hex) return '';
  var s = '';
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(b)) s += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.';
  }
  return s;
}

function setPill(st, txt) {
  var p = ge('lrm-pill');
  if (p) p.setAttribute('data-state', st);
  setEl('lrm-pill-txt', txt);
}

function ge(id) { return document.getElementById(id); }
function setEl(id, html) { var el = ge(id); if (el) el.innerHTML = html; }
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Window exports for HTML onclick= handlers */
window.lrmSetSlot      = lrmSetSlot;
window.lrmClearHistory = lrmClearHistory;
