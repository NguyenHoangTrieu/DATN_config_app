/* =====================================================================
   DA2 Total Sensor Monitor Widget — JavaScript
   Type    : Latest Values (datasource → onDataUpdated fires)
   Datasource: Gateway device → key "data" (Latest Telemetry)

   Data sources (in priority order):
     1. ThingsBoard WebSocket telemetry (onDataUpdated)
     2. window CustomEvent 'da2_total_event' from control widget
     3. localStorage polling fallback 'da2_total_data'

   RTT classes: < 200 ms = fast, 200–1000 ms = mid, > 1000 ms = slow
   Stale threshold: 30 s (BLE), 10 s (ZB), 15 s (LoRa)
   ===================================================================== */

var tmState = {
  ble: { temp: null, hum: null, rtt: null, rxCnt: 0, lastTs: 0, rttHistory: [] },
  zb:  { temp: null, hum: null, rtt: null, rxCnt: 0, lastTs: 0, rttHistory: [] },
  lr:  { temp: null, hum: null, rtt: null, rxCnt: 0, lastTs: 0, rttHistory: [], rssi: null, snr: null }
};
var TM_RTT_HISTORY = 10;   /* rolling window size */
var TM_STALE_BLE   = 30000;
var TM_STALE_ZB    = 10000;
var TM_STALE_LR    = 15000;

var _tmLastProcessedTs = 0;
var _tmBridgeHandler   = null;
var _tmStaleTimer      = null;
var _tmLsTimer         = null;
var TM_RAW_BRIDGE_KEY  = 'da2_total_raw_bridge';
var TM_DEBUG_MAX_LINES = 10;
var _tmDebugLines      = [];

function tmNormalizeBleNotifyHex(rawPayload) {
  var raw = String(rawPayload || '').trim();
  if (!raw) return '';
  var patched = raw.replace(/xy/ig, '16').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  return patched.length >= 8 ? patched.substr(0, 8) : '';
}

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
self.onInit = function () {
  tmEnsureDebugUI();
  tmSetPill('idle', 'Waiting');
  tmDebugLog('parse', 'Monitor ready');
  /* Listen for events from control widget (same-page CustomEvent) */
  _tmBridgeHandler = function (e) {
    var d = e && e.detail;
    if (!d || !d.tech || !d.payload) return;
    tmUpdateTech(d.tech, d.payload);
  };
  window.addEventListener('da2_total_event', _tmBridgeHandler);
  /* Stale-check timer */
  _tmStaleTimer = setInterval(tmCheckStale, 5000);
  /* Try to restore from localStorage immediately */
  tmPollLocalStorage();
};

self.onDestroy = function () {
  if (_tmBridgeHandler) {
    window.removeEventListener('da2_total_event', _tmBridgeHandler);
    _tmBridgeHandler = null;
  }
  if (_tmStaleTimer) { clearInterval(_tmStaleTimer); _tmStaleTimer = null; }
  if (_tmLsTimer) { clearInterval(_tmLsTimer); _tmLsTimer = null; }
};

/* WebSocket push — fires on every new telemetry value */
self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      for (var di = 0; di < kd.data.length; di++) {
        var entry = kd.data[di];
        var ts    = entry[0];
        var raw   = entry[1];
        if (ts <= _tmLastProcessedTs) continue;
        _tmLastProcessedTs = ts;
        var decoded = tmDecodeHex(raw);
        var lines = tmSplitLines(decoded);
        tmDebugLog('raw', 'WS ts=' + ts + ' raw=' + tmShortText(raw));
        tmDebugLog('raw', 'Decoded: ' + tmShortText(decoded));
        if (!lines.length) {
          tmDebugLog('warn', 'No split lines from decoded payload');
        }
        lines.forEach(function (line) {
          tmDebugLog('line', 'LINE: ' + tmShortText(line));
          tmParseLine(line, ts);
          try {
            window.dispatchEvent(new CustomEvent('da2_total_raw_line', {
              detail: { ts: ts, line: line }
            }));
          } catch (e2) {}
          try {
            localStorage.setItem(TM_RAW_BRIDGE_KEY, JSON.stringify({
              updatedAt: Date.now(),
              ts: ts,
              line: line
            }));
          } catch (e3) {}
        });
      }
    }
  } catch (e) {}
};

/* ═══════════════════════════════════════════════════════════════════
   Telemetry Line Parser
   ═══════════════════════════════════════════════════════════════════ */
function tmParseLine(line, ts) {
  var now = Date.now();

  /* ── BLE NOTIFY: CFBG:OK:NOTIFY:<idx>:0x<handle>:<hex4B> ── */
  var m = line.match(/CFBG:OK:NOTIFY:\d+:0x[0-9A-Fa-f]+:([^\s\x1E]+)/i);
  if (m) {
    var hex4 = tmNormalizeBleNotifyHex(m[1]);
    if (!hex4) {
      tmDebugLog('warn', 'BLE notify ignored, malformed payload: ' + tmShortText(m[1]));
      return;
    }
    var tRaw = parseInt(hex4.substr(2, 2) + hex4.substr(0, 2), 16);
    var hRaw = parseInt(hex4.substr(6, 2) + hex4.substr(4, 2), 16);
    if (tRaw & 0x8000) tRaw = tRaw - 0x10000;
    if (/xy/i.test(m[1])) {
      tmDebugLog('parse', 'BLE notify normalized: ' + m[1] + ' -> ' + hex4);
    }
    tmDebugLog('parse', 'BLE notify parsed: ' + (tRaw * 0.01).toFixed(2) + ' C / ' + (hRaw * 0.01).toFixed(2) + ' %');
    tmUpdateTech('ble', { temp: tRaw * 0.01, hum: hRaw * 0.01, ts: now });
    return;
  }

  /* ── ZB RPT line: RPT:<short>,<ep>,<cluster>,<attr>,<type>,<val> ── */
  m = line.match(/RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]+)/i);
  if (m) {
    var cluster = m[3].toUpperCase();
    var attr    = m[4].toUpperCase();
    var valHex  = m[6];
    var raw16   = parseInt(valHex, 16);
    if (cluster === '0402' && attr === '0000') {
      if (raw16 & 0x8000) raw16 = raw16 - 0x10000;
      tmState.zb._pendingTemp = raw16 * 0.01;
      tmDebugLog('parse', 'ZB temp attr: ' + tmState.zb._pendingTemp.toFixed(2) + ' C');
    }
    if (cluster === '0405' && attr === '0000') {
      var hum = raw16 * 0.01;
      if (tmState.zb._pendingTemp !== undefined) {
        tmDebugLog('parse', 'ZB hum attr: ' + hum.toFixed(2) + ' %');
        tmUpdateTech('zb', { temp: tmState.zb._pendingTemp, hum: hum, ts: now });
        delete tmState.zb._pendingTemp;
      }
    }
    return;
  }

  /* ── LoRa RXLRPKT (single-line format from monitor widget bridge) ── */
  m = line.match(/\+TEST:\s*RXLRPKT\s+(\d+),\s*(-?\d+),\s*(-?\d+),\s*([0-9A-Fa-f]+)/i);
  if (m) {
    tmDebugLog('parse', 'LoRa RXLRPKT: RSSI ' + m[2] + ', SNR ' + m[3]);
    tmParseLoraHex(m[4], parseInt(m[2], 10), parseInt(m[3], 10), now);
    return;
  }
  /* Two-line format: +TEST: RX "hex" */
  m = line.match(/\+TEST:\s*RX\s*"([0-9A-Fa-f]+)"/i);
  if (m) {
    tmDebugLog('parse', 'LoRa RX hex: ' + tmShortText(m[1]));
    tmParseLoraHex(m[1], null, null, now);
    return;
  }

  if (/CFZB:/i.test(line)) {
    tmDebugLog('warn', 'ZB raw line seen but not parsed by monitor: ' + tmShortText(line));
    return;
  }
}

function tmParseLoraHex(hex, rssi, snr, now) {
  if (hex.length < 12) return;
  var tHi = parseInt(hex.substr(4, 2), 16);
  var tLo = parseInt(hex.substr(6, 2), 16);
  var hHi = parseInt(hex.substr(8, 2), 16);
  var hLo = parseInt(hex.substr(10, 2), 16);
  var t16 = (tHi << 8) | tLo;
  var h16 = (hHi << 8) | hLo;
  if (t16 & 0x8000) t16 = t16 - 0x10000;
  tmUpdateTech('lr', { temp: t16 * 0.01, hum: h16 * 0.01, rssi: rssi, snr: snr, ts: now });
}

/* ═══════════════════════════════════════════════════════════════════
   Update & Render
   ═══════════════════════════════════════════════════════════════════ */
function tmUpdateTech(tech, payload) {
  var s = tmState[tech];
  if (!s) return;
  s.temp   = payload.temp;
  s.hum    = payload.hum;
  s.lastTs = payload.ts || Date.now();
  s.rxCnt++;
  if (payload.rtt !== null && payload.rtt !== undefined) {
    s.rtt = payload.rtt;
    s.rttHistory.push(payload.rtt);
    if (s.rttHistory.length > TM_RTT_HISTORY) s.rttHistory.shift();
  }
  if (tech === 'lr') {
    s.rssi = payload.rssi || null;
    s.snr  = payload.snr  || null;
  }
  tmRenderCard(tech);
  tmUpdateStats();
  tmSetPill('active', 'Active');
}

function tmRenderCard(tech) {
  var s    = tmState[tech];
  var card = document.getElementById('tm-card-' + tech);
  if (!card) return;
  card.setAttribute('data-state', 'active');

  /* Values */
  tmSetEl('tm-' + tech + '-temp', typeof s.temp === 'number' ? s.temp.toFixed(1) : '—');
  tmSetEl('tm-' + tech + '-hum',  typeof s.hum === 'number'  ? s.hum.toFixed(1)  : '—');

  /* RTT badge */
  var rttEl = document.getElementById('tm-' + tech + '-rtt');
  if (rttEl && s.rtt !== null) {
    var rttMs = Math.round(s.rtt);
    rttEl.textContent = rttMs + ' ms';
    rttEl.className = 'tm-rtt-badge ' + (rttMs < 200 ? 'fast' : rttMs < 1000 ? 'mid' : 'slow');
  }

  /* Timestamp */
  var d = new Date(s.lastTs);
  var tStr = d.toTimeString().substr(0, 8);
  tmSetEl('tm-' + tech + '-ts', tStr);
  tmSetEl('tm-' + tech + '-cnt', s.rxCnt + ' rx');
}

function tmUpdateStats() {
  var total = tmState.ble.rxCnt + tmState.zb.rxCnt + tmState.lr.rxCnt;
  tmSetEl('tm-total-rx', total + ' total rx');
  tmSetEl('tm-last-ts', new Date().toTimeString().substr(0, 8));
  /* Per-tech RTT stat */
  ['ble', 'zb', 'lr'].forEach(function (tech) {
    var s  = tmState[tech];
    var el = document.getElementById('tm-' + tech + '-rtt-stat');
    if (!el) return;
    if (s.rttHistory.length === 0) { el.textContent = '—'; return; }
    var sum = 0;
    for (var i = 0; i < s.rttHistory.length; i++) sum += s.rttHistory[i];
    var avg = Math.round(sum / s.rttHistory.length);
    var mn  = Math.round(Math.min.apply(null, s.rttHistory));
    var mx  = Math.round(Math.max.apply(null, s.rttHistory));
    el.textContent = 'avg ' + avg + ' ms (min ' + mn + ' / max ' + mx + ')';
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Stale detection
   ═══════════════════════════════════════════════════════════════════ */
function tmCheckStale() {
  var now = Date.now();
  var thresholds = { ble: TM_STALE_BLE, zb: TM_STALE_ZB, lr: TM_STALE_LR };
  var anyActive = false;
  var keys = ['ble', 'zb', 'lr'];
  for (var i = 0; i < keys.length; i++) {
    var tech = keys[i];
    var s    = tmState[tech];
    var card = document.getElementById('tm-card-' + tech);
    if (!card) continue;
    if (s.lastTs === 0) continue;
    var age = now - s.lastTs;
    if (age > thresholds[tech]) {
      card.setAttribute('data-state', 'stale');
    } else {
      anyActive = true;
    }
  }
  if (!anyActive) tmSetPill('stale', 'Stale');
}

/* ═══════════════════════════════════════════════════════════════════
   localStorage polling fallback (for cross-iframe scenarios)
   ═══════════════════════════════════════════════════════════════════ */
var _tmLsLastPoll = 0;

function tmPollLocalStorage() {
  if (_tmLsTimer) return;
  _tmLsTimer = setInterval(function () {
    try {
      var raw = localStorage.getItem('da2_total_data');
      if (!raw) return;
      var obj = JSON.parse(raw);
      var keys = ['ble', 'zb', 'lr'];
      for (var i = 0; i < keys.length; i++) {
        var tech = keys[i];
        var d = obj[tech];
        if (!d || !d.updatedAt) continue;
        if (d.updatedAt <= _tmLsLastPoll) continue;
        _tmLsLastPoll = d.updatedAt;
        tmDebugLog('parse', 'LS bridge ' + tech.toUpperCase() + ': ' + tmShortText(JSON.stringify(d)));
        tmUpdateTech(tech, d);
      }
    } catch (e) {}
  }, 2000);
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */
function tmDecodeHex(val) {
  if (!val) return '';
  if (typeof val === 'object') {
    val = (val.result !== undefined) ? val.result
        : (val.data   !== undefined) ? val.data
        : JSON.stringify(val);
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

function tmSplitLines(s) {
  if (!s) return [];
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    var ci = x.search(/CF(BG|ZB|LR|ML):|RPT:|RXLRPKT|\+TEST:/);
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

function tmSetEl(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function tmSetPill(state, text) {
  var pill = document.getElementById('tm-pill');
  var txt  = document.getElementById('tm-pill-txt');
  if (pill) pill.setAttribute('data-state', state);
  if (txt)  txt.textContent = text;
}

function tmDebugLog(kind, text) {
  var stamp = new Date().toTimeString().substr(0, 8);
  _tmDebugLines.push({ kind: kind || 'raw', text: '[' + stamp + '] ' + text });
  if (_tmDebugLines.length > TM_DEBUG_MAX_LINES) _tmDebugLines.shift();
  tmRenderDebug();
}

function tmRenderDebug() {
  tmEnsureDebugUI();
  var host = document.getElementById('tm-debug-lines');
  var meta = document.getElementById('tm-debug-meta');
  if (meta) meta.textContent = _tmDebugLines.length + ' latest entries';
  if (!host) return;
  host.innerHTML = _tmDebugLines.map(function (entry) {
    return '<div class="tm-debug-line" data-kind="' + entry.kind + '">' + tmEscapeHtml(entry.text) + '</div>';
  }).join('');
  host.scrollTop = host.scrollHeight;
}

function tmShortText(value) {
  if (value === null || value === undefined) return '';
  var s = String(value).replace(/\s+/g, ' ').trim();
  if (s.length > 140) return s.substr(0, 137) + '...';
  return s;
}

function tmEnsureDebugUI() {
  if (document.getElementById('tm-debug-lines')) return;
  var root = document.getElementById('tm-root');
  if (!root) return;

  var panel = document.createElement('div');
  panel.id = 'tm-debug';
  panel.style.margin = '0 12px 12px';
  panel.style.border = '1px solid rgba(148,163,184,0.18)';
  panel.style.borderRadius = '12px';
  panel.style.overflow = 'hidden';
  panel.style.background = 'linear-gradient(180deg, rgba(13,20,34,0.98), rgba(9,15,28,0.98))';
  panel.style.boxShadow = 'inset 0 0 0 1px rgba(148,163,184,0.05)';
  panel.style.flexShrink = '0';

  var header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '8px';
  header.style.padding = '8px 12px';
  header.style.background = 'rgba(24,36,59,0.9)';
  header.style.borderBottom = '1px solid rgba(148,163,184,0.18)';

  var title = document.createElement('span');
  title.textContent = 'Monitor Debug';
  title.style.fontSize = '11px';
  title.style.fontWeight = '700';
  title.style.letterSpacing = '0.5px';
  title.style.textTransform = 'uppercase';
  title.style.color = '#e8eef8';

  var meta = document.createElement('span');
  meta.id = 'tm-debug-meta';
  meta.textContent = 'Waiting for telemetry...';
  meta.style.fontSize = '11px';
  meta.style.color = '#9fb0c8';

  var lines = document.createElement('div');
  lines.id = 'tm-debug-lines';
  lines.style.maxHeight = '124px';
  lines.style.overflowY = 'auto';
  lines.style.padding = '8px 12px 10px';
  lines.style.fontFamily = 'Consolas, Courier New, monospace';
  lines.style.fontSize = '11px';
  lines.style.lineHeight = '1.45';
  lines.style.color = '#cdd9ec';

  header.appendChild(title);
  header.appendChild(meta);
  panel.appendChild(header);
  panel.appendChild(lines);

  var statsBar = document.querySelector('.tm-stats-bar');
  if (statsBar && statsBar.parentNode === root) {
    root.insertBefore(panel, statsBar);
  } else {
    root.appendChild(panel);
  }
}

function tmEscapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
