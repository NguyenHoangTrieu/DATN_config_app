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
  lastRfCfg:  '',     /* last +TEST: RFCFG value seen */
  pendingRx:  null    /* partial P2P RX: { len, rssi, snr } waiting for RX payload line */
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

  /* P2P RX — Step 1: meta line
     "+TEST: LEN:4, RSSI:-36, SNR:9" */
  m = l.match(/^\+TEST:\s*LEN:\s*(\d+),\s*RSSI:\s*(-?\d+),\s*SNR:\s*(-?\d+)/i);
  if (m) {
    lrmState.pendingRx = { len: parseInt(m[1], 10), rssi: parseInt(m[2], 10), snr: parseInt(m[3], 10) };
    return;
  }

  /* P2P RX — Step 2: payload line
     "+TEST: RX \"010009EF\"" */
  m = l.match(/^\+TEST:\s*RX\s*"([0-9A-Fa-f]+)"/i);
  if (m) {
    var pr     = lrmState.pendingRx || { len: 0, rssi: 0, snr: 0 };
    var hexData = m[1].toUpperCase();
    lrmHandleP2PRx(pr.len, pr.rssi, pr.snr, hexData, lineSlot);
    lrmState.pendingRx = null;
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
   Payload Decoder
   Format: 6 bytes  nodeId | seq | tempHi | tempLo | humHi | humLo
           temp = int16(bytes[2..3]) / 100  (°C)
           hum  = uint16(bytes[4..5]) / 100  (%)
   ═══════════════════════════════════════════════════════════════════ */
function decodeP2PPayload(hex) {
  if (!hex || hex.length < 8) return null;
  var b = [];
  for (var i = 0; i < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16));
  var tempRaw = (b[2] << 8) | b[3];
  if (tempRaw & 0x8000) tempRaw = tempRaw - 0x10000;   /* sign-extend int16 */
  var result = {
    nodeId: b[0],
    seq:    b[1],
    tempC:  (tempRaw / 100).toFixed(2)
  };
  if (b.length >= 6) {
    var humRaw = (b[4] << 8) | b[5];
    result.humPct = (humRaw / 100).toFixed(2);
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════════
   Handle a received P2P packet (+TEST: RXLRPKT)
   ═══════════════════════════════════════════════════════════════════ */
function lrmHandleP2PRx(len, rssi, snr, hex, slot) {
  var ts      = new Date().toLocaleTimeString('en-GB', { hour12: false });
  var decoded = decodeP2PPayload(hex);
  var card    = ge('lrm-latest');
  if (card) {
    card.setAttribute('data-empty', 'false');
    var decodedHtml = '';
    if (decoded) {
      decodedHtml =
        '<div class="lrm-data-row" style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px">' +
          '<div class="lrm-rx-meta" style="margin-bottom:0">' +
            '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Node</span><span class="lrm-rx-val">' + decoded.nodeId + '</span></div>' +
            '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Seq</span><span class="lrm-rx-val">' + decoded.seq + '</span></div>' +
            '<div class="lrm-rx-meta-item"><span class="lrm-rx-label" style="color:#f97316">Temp</span><span class="lrm-rx-val" style="color:#f97316;font-size:15px">' + decoded.tempC + ' °C</span></div>' +
            (decoded.humPct !== undefined
              ? '<div class="lrm-rx-meta-item"><span class="lrm-rx-label" style="color:#60a5fa">Hum</span><span class="lrm-rx-val" style="color:#60a5fa;font-size:15px">' + decoded.humPct + ' %</span></div>'
              : '') +
          '</div>' +
        '</div>';
    }
    card.innerHTML =
      '<div class="lrm-rx-meta">' +
        '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">RSSI</span><span class="lrm-rx-val">' + rssi + ' dBm</span></div>' +
        '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">SNR</span><span class="lrm-rx-val">' + snr + ' dB</span></div>' +
        '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Size</span><span class="lrm-rx-val">' + len + ' B</span></div>' +
        (slot ? '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Slot</span><span class="lrm-rx-val">' + slot + '</span></div>' : '') +
        '<div class="lrm-rx-meta-item"><span class="lrm-rx-label">Time</span><span class="lrm-rx-val">' + ts + '</span></div>' +
      '</div>' +
      decodedHtml +
      '<div class="lrm-data-row">' +
        '<div class="lrm-data-label">Hex</div>' +
        '<div class="lrm-data-hex">' + escHtml(hex || '(empty)') + '</div>' +
      '</div>';
  }
  lrmState.history.unshift({ win: 'P2P', port: 0, len: len, hex: hex, ts: ts, slot: slot || '', rssi: rssi, snr: snr,
    tempC: decoded ? decoded.tempC : null, humPct: decoded ? (decoded.humPct || null) : null, seq: decoded ? decoded.seq : null });
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
    /* Show decoded T/H if available, otherwise fall back to hex preview */
    var dataStr;
    if (p.tempC !== null && p.tempC !== undefined) {
      dataStr = p.tempC + '°C' + (p.humPct !== null && p.humPct !== undefined ? '  ' + p.humPct + '%' : '');
    } else {
      dataStr = p.hex.length > 20 ? p.hex.substr(0, 20) + '…' : p.hex;
    }
    var seqStr = (p.seq !== null && p.seq !== undefined) ? ('#' + p.seq + ' ') : '';
    row.innerHTML =
      '<span class="lrm-hist-ts">'   + escHtml(p.ts)  + '</span>' +
      '<span class="lrm-hist-win">'  +
        '<span class="lrm-hist-win-badge">' + escHtml(p.win) + '</span>' +
      '</span>' +
      '<span class="lrm-hist-size">' + p.len + 'B</span>' +
      '<span class="lrm-hist-hex">'  + escHtml(seqStr + dataStr) + '</span>';
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
  /* Compact hex: "2B5445..." (even length, no spaces) */
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    var out = '';
    for (var i = 0; i < s.length; i += 2) {
      var b = parseInt(s.substr(i, 2), 16);
      if (!isNaN(b)) out += String.fromCharCode(b);
    }
    return out;
  }
  /* Spaced hex: "2B 54 45 53 54 3A ..." (firmware raw-byte log format) */
  if (/^([0-9A-Fa-f]{2}(\s+|$))+$/.test(s.trim())) {
    return s.trim().split(/\s+/).map(function (b) { return String.fromCharCode(parseInt(b, 16)); }).join('');
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
