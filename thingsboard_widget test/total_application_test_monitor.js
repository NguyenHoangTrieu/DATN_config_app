/* =====================================================================
   total_application_test_monitor — JavaScript
   ===================================================================== */

var TAM_EVENT_NAME = 'da2_total_app_event';
var TAM_DATA_KEY = 'da2_total_app_data';
var TAM_RAW_KEY = 'da2_total_app_raw_bridge';
var TAM_RAW_EVENT_NAME = 'da2_total_app_raw_line';
var TAM_RTT_HISTORY = 10;
var TAM_DEBUG_MAX = 14;

var tamState = {
  filter: 'all',
  devices: {},
  gateway: null,
  totalRx: 0,
  lastTs: 0,
  zbPending: {},
  lastDataStamp: { ble: 0, zb: 0, lr: 0, gw: 0 },
  lastRawStamp: 0,
  lastTelemetryTs: 0,
  debug: []
};

var _tamBridgeHandler = null;
var _tamStaleTimer = null;
var _tamLsTimer = null;

self.onInit = function () {
  tamBindFilters();
  tamRender();
  tamSetPill('idle', 'Waiting');
  tamDebug('parse', 'Monitor ready');

  _tamBridgeHandler = function (e) {
    var detail = e && e.detail;
    if (!detail || !detail.tech || !detail.payload) return;
    tamHandleBridgeEvent(detail.tech, detail.payload);
  };
  window.addEventListener(TAM_EVENT_NAME, _tamBridgeHandler);

  _tamStaleTimer = setInterval(tamRender, 5000);
  _tamLsTimer = setInterval(tamPollLocalStorage, 1200);
  tamPollLocalStorage();
};

self.onDestroy = function () {
  if (_tamBridgeHandler) {
    window.removeEventListener(TAM_EVENT_NAME, _tamBridgeHandler);
    _tamBridgeHandler = null;
  }
  if (_tamStaleTimer) {
    clearInterval(_tamStaleTimer);
    _tamStaleTimer = null;
  }
  if (_tamLsTimer) {
    clearInterval(_tamLsTimer);
    _tamLsTimer = null;
  }
};

self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      for (var di = 0; di < kd.data.length; di++) {
        var entry = kd.data[di];
        if (!entry || entry.length < 2) continue;
        var ts = entry[0];
        var raw = entry[1];
        if (ts <= tamState.lastTelemetryTs) continue;
        tamState.lastTelemetryTs = ts;
        tamProcessRawPayload(raw, ts);
      }
    }
  } catch (e) {
    tamDebug('warn', 'onDataUpdated: ' + e);
  }
};

function tamHandleBridgeEvent(tech, payload) {
  if (tech === 'gw') {
    tamUpdateGateway(payload);
    return;
  }
  tamUpsertSample(tech, payload, true);
}

function tamPollLocalStorage() {
  try {
    var raw = localStorage.getItem(TAM_DATA_KEY);
    if (raw) {
      var obj = JSON.parse(raw);
      var keys = ['gw', 'ble', 'zb', 'lr'];
      for (var i = 0; i < keys.length; i++) {
        var tech = keys[i];
        var payload = obj[tech];
        if (!payload || !payload.updatedAt) continue;
        if (payload.updatedAt <= tamState.lastDataStamp[tech]) continue;
        tamState.lastDataStamp[tech] = payload.updatedAt;
        tamHandleBridgeEvent(tech, payload);
      }
    }
  } catch (e0) {
    tamDebug('warn', 'LS data bridge failed');
  }

  try {
    var rawLine = localStorage.getItem(TAM_RAW_KEY);
    if (!rawLine) return;
    var lineObj = JSON.parse(rawLine);
    if (!lineObj || !lineObj.updatedAt || !lineObj.line) return;
    if (lineObj.updatedAt <= tamState.lastRawStamp) return;
    tamState.lastRawStamp = lineObj.updatedAt;
    tamProcessLine(lineObj.line, lineObj.ts || lineObj.updatedAt, true);
  } catch (e1) {
    tamDebug('warn', 'LS raw bridge failed');
  }
}

function tamProcessRawPayload(raw, ts) {
  var decoded = tamDecodeHex(raw);
  var lines = tamSplitLines(decoded);
  tamDebug('raw', 'WS ' + ts + ': ' + tamShort(decoded));
  for (var i = 0; i < lines.length; i++) {
    var stamp = Date.now();
    try {
      window.dispatchEvent(new CustomEvent(TAM_RAW_EVENT_NAME, {
        detail: { ts: ts, line: lines[i] }
      }));
    } catch (e0) {}
    try {
      localStorage.setItem(TAM_RAW_KEY, JSON.stringify({
        updatedAt: stamp,
        ts: ts,
        line: lines[i]
      }));
      tamState.lastRawStamp = stamp;
    } catch (e1) {}
    tamProcessLine(lines[i], ts, false);
  }
}

function tamProcessLine(line, ts, fromBridge) {
  var now = ts || Date.now();
  var text = String(line || '').trim();
  if (!text) return;
  tamDebug(fromBridge ? 'parse' : 'raw', tamShort(text));

  var ble = text.match(/CFBG:OK:NOTIFY:(\d+):0x[0-9A-Fa-f]+:([^\s\x1E]+)/i);
  if (ble) {
    var hex4 = tamNormalizeBleNotify(ble[2]);
    if (!hex4) return;
    var tRaw = parseInt(hex4.substr(2, 2) + hex4.substr(0, 2), 16);
    var hRaw = parseInt(hex4.substr(6, 2) + hex4.substr(4, 2), 16);
    if (tRaw & 0x8000) tRaw -= 0x10000;
    tamUpsertSample('ble', {
      key: 'ble:' + ble[1],
      devIdx: parseInt(ble[1], 10),
      title: 'BLE Sensor #' + ble[1],
      temp: tRaw * 0.01,
      hum: hRaw * 0.01,
      ts: now
    }, false);
    return;
  }

  var zb = text.match(/RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]+)/i);
  if (zb) {
    tamHandleZbRpt(zb[1].toUpperCase(), zb[2].toUpperCase(), zb[3].toUpperCase(), zb[4].toUpperCase(), zb[6], now);
    return;
  }

  var slotMatch = text.match(/^CFLR:(\d):/i);
  var lrSlot = slotMatch ? slotMatch[1] : '';
  var lr = text.match(/\+TEST:\s*RXLRPKT\s+(\d+),\s*(-?\d+),\s*(-?\d+),\s*([0-9A-Fa-f]+)/i);
  if (lr) {
    tamHandleLoraHex(lr[4], lrSlot, parseInt(lr[2], 10), parseInt(lr[3], 10), now);
    return;
  }

  var lr2 = text.match(/\+TEST:\s*RX\s*"([0-9A-Fa-f]+)"/i);
  if (lr2) {
    tamHandleLoraHex(lr2[1], lrSlot, null, null, now);
    return;
  }

  if (/CF(IN|WF|LT|SV|MQ|HP|CP|FU|FW)|CFFU|CFFW/i.test(text)) {
    tamUpdateGateway({
      title: 'Gateway',
      status: text,
      ts: now
    });
  }
}

function tamHandleZbRpt(shortAddr, ep, cluster, attr, valueHex, now) {
  var key = 'zb:' + shortAddr;
  if (!tamState.zbPending[key]) tamState.zbPending[key] = {};
  var raw = parseInt(valueHex, 16);
  if (cluster === '0402' && attr === '0000') {
    if (raw & 0x8000) raw -= 0x10000;
    tamState.zbPending[key].temp = raw * 0.01;
  }
  if (cluster === '0405' && attr === '0000') {
    tamState.zbPending[key].hum = raw * 0.01;
  }
  tamUpsertSample('zb', {
    key: key,
    shortAddr: shortAddr,
    ep: ep,
    title: 'Zigbee 0x' + shortAddr,
    temp: tamState.zbPending[key].temp,
    hum: tamState.zbPending[key].hum,
    ts: now
  }, false);
}

function tamHandleLoraHex(hex, slot, rssi, snr, now) {
  if (!hex || hex.length < 12) return;
  var nodeId = parseInt(hex.substr(0, 2), 16);
  var t16 = parseInt(hex.substr(4, 4), 16);
  var h16 = parseInt(hex.substr(8, 4), 16);
  if (t16 & 0x8000) t16 -= 0x10000;
  tamUpsertSample('lr', {
    key: 'lr:' + (slot || '0') + ':' + nodeId,
    slot: slot || '0',
    nodeId: nodeId,
    title: 'LoRa Node ' + nodeId,
    temp: t16 * 0.01,
    hum: h16 * 0.01,
    rssi: rssi,
    snr: snr,
    ts: now
  }, false);
}

function tamUpsertSample(tech, payload, preferBridge) {
  if (!payload) return;
  var key = payload.key || tamFallbackKey(tech, payload);
  var entry = tamState.devices[key];
  if (!entry) {
    entry = {
      key: key,
      tech: tech,
      title: payload.title || tamDefaultTitle(tech, payload),
      temp: null,
      hum: null,
      rtt: null,
      rxCnt: 0,
      lastTs: 0,
      rttHistory: [],
      meta: {}
    };
    tamState.devices[key] = entry;
  }

  var isSameSample = !!(payload.ts && entry.lastTs === payload.ts && entry.temp === payload.temp && entry.hum === payload.hum);

  entry.title = payload.title || entry.title;
  if (typeof payload.temp === 'number') entry.temp = payload.temp;
  if (typeof payload.hum === 'number') entry.hum = payload.hum;
  if (payload.rtt !== null && payload.rtt !== undefined && !isNaN(payload.rtt)) {
    entry.rtt = payload.rtt;
    entry.rttHistory.push(payload.rtt);
    if (entry.rttHistory.length > TAM_RTT_HISTORY) entry.rttHistory.shift();
  }
  if (payload.rssi !== undefined) entry.meta.rssi = payload.rssi;
  if (payload.snr !== undefined) entry.meta.snr = payload.snr;
  if (payload.devIdx !== undefined) entry.meta.devIdx = payload.devIdx;
  if (payload.shortAddr) entry.meta.shortAddr = payload.shortAddr;
  if (payload.ep) entry.meta.ep = payload.ep;
  if (payload.slot !== undefined) entry.meta.slot = payload.slot;
  if (payload.nodeId !== undefined) entry.meta.nodeId = payload.nodeId;
  if (payload.ts || !entry.lastTs) entry.lastTs = payload.ts || Date.now();
  if (!isSameSample) {
    entry.rxCnt += 1;
    tamState.totalRx += 1;
  }
  tamState.lastTs = entry.lastTs;
  if (preferBridge) {
    tamDebug('parse', 'Bridge ' + tech.toUpperCase() + ': ' + entry.title);
  }
  tamRender();
}

function tamUpdateGateway(payload) {
  tamState.gateway = {
    title: payload.title || 'Gateway',
    status: payload.status || 'Gateway event',
    action: payload.action || '',
    internetType: payload.internetType || (tamState.gateway && tamState.gateway.internetType) || '—',
    serverType: payload.serverType || (tamState.gateway && tamState.gateway.serverType) || '—',
    lanUrl: payload.lanUrl || (tamState.gateway && tamState.gateway.lanUrl) || '',
    wanUrl: payload.wanUrl || (tamState.gateway && tamState.gateway.wanUrl) || '',
    lastTs: payload.ts || Date.now(),
    rxCnt: (tamState.gateway ? tamState.gateway.rxCnt : 0) + 1
  };
  tamState.lastTs = tamState.gateway.lastTs;
  tamRender();
}

function tamRender() {
  var grid = document.getElementById('tam-grid');
  var hint = document.getElementById('tam-hint');
  if (!grid) return;

  var cards = tamCollectCards();
  grid.innerHTML = cards.map(tamRenderCard).join('');
  if (hint) {
    if (cards.length) hint.classList.add('hidden');
    else hint.classList.remove('hidden');
  }

  tamSetText('tam-total-rx', tamState.totalRx + ' samples');
  tamSetText('tam-tech-count', cards.length + ' cards');
  tamSetText('tam-last-ts', tamState.lastTs ? ('Last: ' + tamTime(tamState.lastTs)) : '—');
  tamSetText('tam-toolbar-meta', cards.length ? ('Showing ' + cards.length + ' cards') : 'No samples yet');
  tamSetPill(cards.length ? tamPillState(cards) : 'idle', cards.length ? 'Active' : 'Waiting');
  tamRenderDebug();
}

function tamCollectCards() {
  var out = [];
  if ((tamState.filter === 'all' || tamState.filter === 'gw') && tamState.gateway) {
    out.push({ tech: 'gw', gateway: true, data: tamState.gateway });
  }

  var keys = Object.keys(tamState.devices);
  keys.sort();
  for (var i = 0; i < keys.length; i++) {
    var device = tamState.devices[keys[i]];
    if (tamState.filter !== 'all' && tamState.filter !== device.tech) continue;
    out.push({ tech: device.tech, gateway: false, data: device });
  }
  return out;
}

function tamRenderCard(card) {
  if (card.gateway) return tamRenderGatewayCard(card.data);
  var d = card.data;
  var stale = tamIsStale(d.tech, d.lastTs);
  var rttCls = tamRttClass(d.rtt);
  var rttText = d.rtt != null ? (Math.round(d.rtt) + ' ms') : '—';
  var avgRtt = d.rttHistory.length ? Math.round(tamAverage(d.rttHistory)) + ' ms avg' : '—';
  return '' +
    '<div class="tam-card" data-tech="' + d.tech + '" data-stale="' + (stale ? 'true' : 'false') + '">' +
      '<div class="tam-card-hdr">' +
        '<span class="tam-badge ' + d.tech + '">' + tamTechLabel(d.tech) + '</span>' +
        '<span class="tam-card-title">' + tamEsc(d.title) + '</span>' +
        '<span class="tam-rtt ' + rttCls + '">' + tamEsc(rttText) + '</span>' +
      '</div>' +
      '<div class="tam-card-body">' +
        '<div class="tam-values">' +
          tamValueBox('Temp', tamFormatNumber(d.temp), '°C') +
          tamValueBox('Humidity', tamFormatNumber(d.hum), '%') +
        '</div>' +
        '<div class="tam-meta-grid">' +
          tamMetaItem('Last', tamTime(d.lastTs)) +
          tamMetaItem('Samples', String(d.rxCnt)) +
          tamMetaItem('RTT avg', avgRtt) +
          tamMetaItem('Target', tamTargetText(d)) +
          (d.meta.rssi != null ? tamMetaItem('RSSI', String(d.meta.rssi)) : '') +
          (d.meta.snr != null ? tamMetaItem('SNR', String(d.meta.snr)) : '') +
        '</div>' +
      '</div>' +
      '<div class="tam-card-footer">' +
        '<span>' + tamEsc(tamStatusText(stale)) + '</span>' +
        '<span>' + tamEsc(tamTechLabel(d.tech)) + '</span>' +
      '</div>' +
    '</div>';
}

function tamRenderGatewayCard(gw) {
  return '' +
    '<div class="tam-card" data-tech="gw" data-stale="' + (tamIsStale('gw', gw.lastTs) ? 'true' : 'false') + '">' +
      '<div class="tam-card-hdr">' +
        '<span class="tam-badge gw">GW</span>' +
        '<span class="tam-card-title">' + tamEsc(gw.title) + '</span>' +
        '<span class="tam-rtt">' + tamEsc(gw.action || 'state') + '</span>' +
      '</div>' +
      '<div class="tam-card-body">' +
        '<div class="tam-gw-block"><strong>Status:</strong> ' + tamEsc(gw.status || '—') + '</div>' +
        '<div class="tam-meta-grid">' +
          tamMetaItem('Internet', gw.internetType || '—') +
          tamMetaItem('Server', gw.serverType || '—') +
          tamMetaItem('LAN URL', gw.lanUrl ? tamShort(gw.lanUrl) : '—') +
          tamMetaItem('WAN URL', gw.wanUrl ? tamShort(gw.wanUrl) : '—') +
        '</div>' +
      '</div>' +
      '<div class="tam-card-footer">' +
        '<span>' + tamEsc(tamTime(gw.lastTs)) + '</span>' +
        '<span>' + tamEsc(String(gw.rxCnt || 0) + ' events') + '</span>' +
      '</div>' +
    '</div>';
}

function tamBindFilters() {
  var host = document.getElementById('tam-filter-group');
  if (!host) return;
  host.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.tam-filter') : null;
    if (!btn) return;
    tamState.filter = btn.getAttribute('data-filter') || 'all';
    var all = host.querySelectorAll('.tam-filter');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
    btn.classList.add('active');
    tamRender();
  });
}

function tamNormalizeBleNotify(rawPayload) {
  var raw = String(rawPayload || '').trim();
  if (!raw) return '';
  var hex = raw.replace(/xy/ig, '16').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  return hex.length >= 8 ? hex.substr(0, 8) : '';
}

function tamFallbackKey(tech, payload) {
  if (tech === 'ble') return 'ble:' + String(payload.devIdx != null ? payload.devIdx : 0);
  if (tech === 'zb') return 'zb:' + String(payload.shortAddr || '0000');
  if (tech === 'lr') return 'lr:' + String(payload.slot || '0') + ':' + String(payload.nodeId != null ? payload.nodeId : 0);
  return tech + ':0';
}

function tamDefaultTitle(tech, payload) {
  if (tech === 'ble') return 'BLE Sensor #' + String(payload.devIdx != null ? payload.devIdx : 0);
  if (tech === 'zb') return 'Zigbee 0x' + String(payload.shortAddr || '0000');
  if (tech === 'lr') return 'LoRa Node ' + String(payload.nodeId != null ? payload.nodeId : 0);
  return 'Gateway';
}

function tamTechLabel(tech) {
  return tech === 'gw' ? 'GW' : tech === 'ble' ? 'BLE' : tech === 'zb' ? 'ZB' : 'LoRa';
}

function tamPillState(cards) {
  for (var i = 0; i < cards.length; i++) {
    if (!tamIsStale(cards[i].tech, cards[i].data.lastTs)) return 'active';
  }
  return 'stale';
}

function tamIsStale(tech, ts) {
  if (!ts) return false;
  var now = Date.now();
  var limit = tech === 'ble' ? 30000 : tech === 'zb' ? 20000 : tech === 'lr' ? 25000 : 60000;
  return (now - ts) > limit;
}

function tamRttClass(rtt) {
  if (rtt == null || isNaN(rtt)) return '';
  if (rtt < 200) return 'fast';
  if (rtt < 1000) return 'mid';
  return 'slow';
}

function tamValueBox(label, value, unit) {
  return '' +
    '<div class="tam-value-box">' +
      '<div class="tam-label">' + tamEsc(label) + '</div>' +
      '<div class="tam-value">' + tamEsc(value) + '</div>' +
      '<div class="tam-unit">' + tamEsc(unit) + '</div>' +
    '</div>';
}

function tamMetaItem(label, value) {
  return '<div class="tam-meta-item"><strong>' + tamEsc(label) + ':</strong> ' + tamEsc(value) + '</div>';
}

function tamTargetText(device) {
  if (device.tech === 'ble') return device.meta.devIdx != null ? ('idx ' + device.meta.devIdx) : '—';
  if (device.tech === 'zb') return device.meta.shortAddr ? ('0x' + device.meta.shortAddr + ' / EP ' + (device.meta.ep || '—')) : '—';
  if (device.tech === 'lr') return 'slot ' + (device.meta.slot || '0') + ' / node ' + (device.meta.nodeId != null ? device.meta.nodeId : '—');
  return '—';
}

function tamStatusText(stale) {
  return stale ? 'stale' : 'live';
}

function tamFormatNumber(value) {
  return typeof value === 'number' && !isNaN(value) ? value.toFixed(1) : '—';
}

function tamAverage(arr) {
  var sum = 0;
  for (var i = 0; i < arr.length; i++) sum += arr[i];
  return arr.length ? (sum / arr.length) : 0;
}

function tamTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toTimeString().substr(0, 8);
}

function tamSetPill(state, text) {
  var pill = document.getElementById('tam-pill');
  var txt = document.getElementById('tam-pill-txt');
  if (pill) pill.setAttribute('data-state', state);
  if (txt) txt.textContent = text;
}

function tamSetText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function tamDebug(kind, text) {
  var stamp = new Date().toTimeString().substr(0, 8);
  tamState.debug.push({ kind: kind || 'raw', text: '[' + stamp + '] ' + text });
  if (tamState.debug.length > TAM_DEBUG_MAX) tamState.debug.shift();
}

function tamRenderDebug() {
  var host = document.getElementById('tam-debug-lines');
  var meta = document.getElementById('tam-debug-meta');
  if (meta) meta.textContent = tamState.debug.length + ' entries';
  if (!host) return;
  host.innerHTML = tamState.debug.map(function (entry) {
    return '<div class="tam-debug-line" data-kind="' + tamEsc(entry.kind) + '">' + tamEsc(entry.text) + '</div>';
  }).join('');
  host.scrollTop = host.scrollHeight;
}

function tamDecodeHex(val) {
  if (!val) return '';
  if (typeof val === 'object') {
    val = val.result !== undefined ? val.result
      : val.data !== undefined ? val.data
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

function tamSplitLines(s) {
  if (!s) return [];
  return s.split(/\x1e|\n/).map(function (line) {
    var text = String(line || '').trim();
    var idx = text.search(/CF(BG|ZB|LR|ML):|RPT:|\+TEST:/);
    if (idx > 0) text = text.substring(idx);
    return text;
  }).filter(Boolean);
}

function tamShort(value) {
  var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? text.substr(0, 117) + '...' : text;
}

function tamEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
