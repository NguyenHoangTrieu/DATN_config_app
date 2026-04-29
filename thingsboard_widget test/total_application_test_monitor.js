/* =====================================================================
   DA2 Total Application Test Monitor Widget — JavaScript
   Type    : Latest Values widget (no controlApi)
   Datasource: Gateway device → key "data" (Latest Telemetry)

   Data sources:
     1. window event 'da2_tat_event'    — structured device data from control widget
     2. window event 'da2_tat_raw_line' — raw telemetry line from control widget
     3. self.onDataUpdated              — datasource-driven Latest Telemetry "data" key

   State schema:
     tatmState.devices[key] = {
       proto, type, name, addr, slot, data:{temp,hum,on,color,seq,rssi,snr,ledState},
       lastTs, updateCount
     }
     key = proto + ':' + id  e.g. 'ble:1', 'zb:1234', 'lora:01'
   ===================================================================== */

/* ═══════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════ */
var TATM_STALE_MS      = 120000;   /* 2 minutes */
var TATM_STALE_CHECK   = 30000;    /* poll every 30s */
var TATM_LS_KEY        = 'da2_tatm_state';
var TATM_MAX_DEVICES   = 64;

/* ═══════════════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════════════ */
var tatmState = {
  devices:      {},
  filterProto:  'all',
  filterType:   'all',
  filterState:  'all',
  totalRx:      0,
  lastTs:       0,
  staleTimer:   null
};

/* Listeners */
var _tatmBridgeHandler  = null;
var _tatmRawLineHandler = null;
var _tatmLastRawTs      = 0;

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
self.onInit = function () {
  try {
    /* Clean up any stale listeners */
    if (_tatmBridgeHandler)  { window.removeEventListener('da2_tat_event', _tatmBridgeHandler);    _tatmBridgeHandler  = null; }
    if (_tatmRawLineHandler) { window.removeEventListener('da2_tat_raw_line', _tatmRawLineHandler); _tatmRawLineHandler = null; }
    if (tatmState.staleTimer) { clearInterval(tatmState.staleTimer); tatmState.staleTimer = null; }

    /* Restore persisted state */
    tatmRestoreState();

    /* ══════ EVENT DELEGATION FOR FILTER BUTTONS & CLEAR ══════ */
    var root = document.getElementById('tatm-root');
    if (root) {
      root.addEventListener('click', function(evt) {
        var el = evt.target;
        /* Filter chip buttons */
        if (el.className && el.className.indexOf('tatm-chip') >= 0) {
          var dim = el.getAttribute('data-dim');
          var val = el.getAttribute('data-val');
          if (dim && val) {
            tatmSetFilter(dim, val, el);
          }
          evt.preventDefault();
          return;
        }
        /* Clear button */
        if (el.className && el.className.indexOf('tatm-btn-clear') >= 0) {
          tatmClearState();
          evt.preventDefault();
          return;
        }
      });
    }

    /* Bridge event from control widget */
    _tatmBridgeHandler = function (evt) {
      try {
        var d = evt && evt.detail;
        if (!d || !d.proto) return;
        tatmHandleDeviceEvent(d);
      } catch (e) {}
    };
    window.addEventListener('da2_tat_event', _tatmBridgeHandler);

    /* Raw line events from control widget */
    _tatmRawLineHandler = function (evt) {
      try {
        var d = evt && evt.detail;
        if (!d || !d.line) return;
        tatmHandleRawLine(d.line);
      } catch (e) {}
    };
    window.addEventListener('da2_tat_raw_line', _tatmRawLineHandler);

    /* Stale-check periodic timer */
    tatmState.staleTimer = setInterval(tatmStaleCheck, TATM_STALE_CHECK);

    /* Initial render */
    tatmRenderCards();
    tatmUpdateFooter();
    tatmSetPill('idle', 'Waiting');

  } catch (e) {
    console.error('[TATM] onInit error:', e);
  }
};

self.onDestroy = function () {
  try {
    if (_tatmBridgeHandler)  { window.removeEventListener('da2_tat_event', _tatmBridgeHandler);    _tatmBridgeHandler  = null; }
    if (_tatmRawLineHandler) { window.removeEventListener('da2_tat_raw_line', _tatmRawLineHandler); _tatmRawLineHandler = null; }
    if (tatmState.staleTimer) { clearInterval(tatmState.staleTimer); tatmState.staleTimer = null; }
  } catch (e) {}
};

/* Datasource-driven fallback */
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
        if (ts <= _tatmLastRawTs) continue;
        _tatmLastRawTs = ts;
        var decoded = tatmDecodeVal(raw);
        var lines   = decoded.split(/\x1e|\n/).map(function(x){ return x.trim(); }).filter(Boolean);
        lines.forEach(tatmHandleRawLine);
      }
    }
  } catch (e) {}
};

/* ═══════════════════════════════════════════════════════════════════
   Device event handler (from control widget bridge)
   ═══════════════════════════════════════════════════════════════════ */
function tatmHandleDeviceEvent(d) {
  /* d = {proto, type, id, name, addr, slot, data:{…}} */
  var key = d.proto + ':' + String(d.id).toUpperCase();
  if (!tatmState.devices[key]) {
    /* Check cap */
    if (Object.keys(tatmState.devices).length >= TATM_MAX_DEVICES) return;
    tatmState.devices[key] = {
      proto: d.proto, type: d.type || 'unknown', name: d.name, addr: d.addr,
      slot: d.slot || '?', data: {}, lastTs: Date.now(), updateCount: 0
    };
  }
  var dev = tatmState.devices[key];
  dev.proto        = d.proto || dev.proto;
  dev.type         = d.type || dev.type || 'unknown';
  dev.name         = d.name || dev.name;
  dev.addr         = d.addr || dev.addr;
  dev.slot         = d.slot || dev.slot;
  dev.lastTs       = Date.now();
  dev.updateCount  = (dev.updateCount || 0) + 1;
  if (d.data && d.data.error !== undefined) dev.error = !!d.data.error;
  /* Merge data fields */
  var keys = d.data ? Object.keys(d.data) : [];
  for (var ki = 0; ki < keys.length; ki++) {
    if (d.data[keys[ki]] !== undefined && d.data[keys[ki]] !== null) {
      dev.data[keys[ki]] = d.data[keys[ki]];
    }
  }
  tatmState.totalRx++;
  tatmState.lastTs = dev.lastTs;
  tatmSetPill('active', 'Live');
  tatmPersistState();
  tatmRenderCards();
  tatmUpdateFooter();
}

/* ═══════════════════════════════════════════════════════════════════
   Raw telemetry line parser (fallback — no control widget running)
   ═══════════════════════════════════════════════════════════════════ */
function tatmHandleRawLine(line) {
  if (!line) return;
  /* BLE NOTIFY → sensor: CFBG:OK:NOTIFY:<idx>:0x<handle>:<hexdata> */
  var m = line.match(/CFBG:OK:NOTIFY:(\d+):0x([0-9A-Fa-f]+):([0-9A-Fa-f]{8,})/i);
  if (m) {
    var idx  = m[1];
    var hex4 = m[3];
    var t = parseInt(hex4.substr(0,2), 16) | (parseInt(hex4.substr(2,2), 16) << 8);
    if (t > 32767) t -= 65536;
    var h = parseInt(hex4.substr(4,2), 16) | (parseInt(hex4.substr(6,2), 16) << 8);
    if (h > 32767) h -= 65536;
    tatmHandleDeviceEvent({
      proto: 'ble', type: 'sensor', id: idx,
      name:  'BLE Sensor ' + idx,
      addr:  '—', slot: '?',
      data:  { temp: (t/100.0).toFixed(1), hum: (h/100.0).toFixed(1) }
    });
    return;
  }

  /* Zigbee attr report: RPT:<short4>,<ep>,<cluster>,<attr>,<type>,<value> */
  m = line.match(/RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]+)/i);
  if (m) {
    var short   = m[1].toUpperCase();
    var cluster = m[3].toUpperCase();
    var attr    = m[4].toUpperCase();
    var val     = parseInt(m[6], 16);
    var dkey    = 'zb:' + short;
    var dev2    = tatmState.devices[dkey];
    var data2   = {};
    if (cluster === '0402' && attr === '0000') { data2.temp = (val / 100.0).toFixed(1); }
    if (cluster === '0405' && attr === '0000') { data2.hum  = (val / 100.0).toFixed(1); }
    if (cluster === '0006' && attr === '0000') { data2.on = val !== 0; }
    if (cluster === '0008' && attr === '0000') { data2.level = Math.round(val / 2.54); }
    tatmHandleDeviceEvent({
      proto: 'zb', type: (cluster === '0006' || cluster === '0008') ? 'led' : ((dev2 && dev2.type) || 'sensor'), id: short,
      name:  (dev2 && dev2.name) || ('ZB 0x' + short),
      addr:  '0x' + short, slot: '?', data: data2
    });
    return;
  }

  /* LoRa P2P sensor packet: parsed from RXLRPKT */
  m = line.match(/\+TEST:\s*RXLRPKT\s+\d+,\s*(-?\d+),\s*(-?\d+),\s*"([0-9A-Fa-f]+)"/i);
  if (m) {
    var rssi2 = m[1]; var snr2 = m[2]; var hex2 = m[3].toUpperCase();
    if (hex2.length >= 14 && hex2.substr(0,2) === '01') {
      var nodeId  = parseInt(hex2.substr(2,2), 16);
      var seq2    = parseInt(hex2.substr(4,2), 16);
      var tRaw    = (parseInt(hex2.substr(6,2),16) << 8) | parseInt(hex2.substr(8,2),16);
      var hRaw    = (parseInt(hex2.substr(10,2),16) << 8) | parseInt(hex2.substr(12,2),16);
      var ledState2 = hex2.length >= 16 ? (parseInt(hex2.substr(14,2),16) ? 'ON' : 'OFF') : '—';
      tatmHandleDeviceEvent({
        proto: 'lora', type: 'lora_node',
        id:    nodeId.toString(16).toUpperCase(),
        name:  'LoRa Node 0x' + ('00' + nodeId.toString(16).toUpperCase()).slice(-2),
        addr:  '', slot: '?',
        data:  {
          temp: (tRaw/100.0).toFixed(1), hum: (hRaw/100.0).toFixed(1),
          seq:  seq2, rssi: rssi2 + ' dBm', snr: snr2 + ' dB', ledState: ledState2
        }
      });
    }
    return;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Stale check
   ═══════════════════════════════════════════════════════════════════ */
function tatmStaleCheck() {
  var now   = Date.now();
  var keys  = Object.keys(tatmState.devices);
  var dirty = false;
  for (var i = 0; i < keys.length; i++) {
    var dev = tatmState.devices[keys[i]];
    var stale = tatmDeviceState(dev, now) === 'stale';
    if (stale !== !!dev._stale) { dev._stale = stale; dirty = true; }
  }
  if (dirty) {
    tatmRenderCards();
    /* Update header pill */
    var anyError = keys.length > 0 && keys.some(function(k){ return tatmDeviceState(tatmState.devices[k], now) === 'error'; });
    var allStale = keys.length > 0 && keys.every(function(k){ return tatmDeviceState(tatmState.devices[k], now) === 'stale'; });
    if (anyError) tatmSetPill('error', 'Error');
    else if (allStale) tatmSetPill('stale', 'Stale');
    else if (keys.length > 0) tatmSetPill('active', 'Live');
    else tatmSetPill('idle', 'Waiting');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Filter functions
   ═══════════════════════════════════════════════════════════════════ */
function tatmSetFilter(dim, val, el) {
  /* Update active chip in the same filter group */
  if (el && el.parentNode) {
    try {
      var chips = el.parentNode.querySelectorAll('.tatm-chip');
      for (var i = 0; i < chips.length; i++) chips[i].classList.remove('tatm-chip-active');
      el.classList.add('tatm-chip-active');
    } catch (e) {}
  }
  if (dim === 'proto') tatmState.filterProto = val;
  if (dim === 'type')  tatmState.filterType  = val;
  if (dim === 'state') tatmState.filterState = val;
  tatmRenderCards();
}

function tatmDeviceState(dev, now) {
  if (dev && (dev.error || (dev.data && dev.data.error))) return 'error';
  return ((now - dev.lastTs) > TATM_STALE_MS) ? 'stale' : 'live';
}

function tatmTypeLabel(type) {
  if (type === 'sensor') return 'Sensor';
  if (type === 'led') return 'LED/Light';
  if (type === 'lora_node') return 'Sensor+LED';
  return 'Unknown';
}

function tatmTypeClass(type) {
  if (type === 'sensor') return 'type-sensor';
  if (type === 'led') return 'type-led';
  if (type === 'lora_node') return 'type-lora-node';
  return 'type-unknown';
}

function tatmStateLabel(state) {
  if (state === 'error') return 'Error';
  if (state === 'stale') return 'Stale';
  return 'Live';
}

function tatmStateClass(state) {
  if (state === 'error') return 'state-error';
  if (state === 'stale') return 'state-stale';
  return 'state-live';
}

function tatmNormalizeOnState(data) {
  if (!data) return null;
  if (data.on !== undefined) return !!data.on;
  if (data.onOff !== undefined) return !!data.onOff;
  if (data.ledState === 'ON') return true;
  if (data.ledState === 'OFF') return false;
  return null;
}

function tatmSampleCount(dev) {
  if (dev.data.sampleCount !== undefined) return dev.data.sampleCount;
  if (dev.data.count !== undefined) return dev.data.count;
  return dev.updateCount || 0;
}

/* ═══════════════════════════════════════════════════════════════════
   Render cards
   ═══════════════════════════════════════════════════════════════════ */
function tatmRenderCards() {
  console.log('[TATM] tatmRenderCards called, filterProto=' + tatmState.filterProto + ', filterType=' + tatmState.filterType + ', filterState=' + tatmState.filterState);
  var grid = document.getElementById('tatm-grid');
  if (!grid) { console.log('[TATM] ERROR: tatm-grid not found'); return; }
  var hint = document.getElementById('tatm-hint');
  var now  = Date.now();
  var keys = Object.keys(tatmState.devices);
  console.log('[TATM] renderCards: ' + keys.length + ' devices total');

  /* Apply filters */
  var visible = keys.filter(function (k) {
    var dev   = tatmState.devices[k];
    var state = tatmDeviceState(dev, now);
    if (tatmState.filterProto !== 'all' && dev.proto !== tatmState.filterProto) return false;
    if (tatmState.filterType  !== 'all' && dev.type  !== tatmState.filterType)  return false;
    if (tatmState.filterState !== 'all' && state !== tatmState.filterState) return false;
    return true;
  });

  if (hint) hint.style.display = (visible.length === 0 && keys.length === 0) ? 'block' : 'none';

  /* Remove old dynamic cards */
  var oldCards = grid.querySelectorAll('.tatm-card, .tatm-filter-empty');
  for (var i = 0; i < oldCards.length; i++) grid.removeChild(oldCards[i]);

  if (visible.length === 0) {
    if (keys.length > 0) {
      /* Devices exist but all filtered out */
      var noMatch = document.createElement('div');
      noMatch.className = 'tatm-hint tatm-filter-empty';
      noMatch.innerHTML = '<div class="tatm-hint-icon">🔍</div><div class="tatm-hint-title">No devices match filters</div>';
      grid.appendChild(noMatch);
    }
    return;
  }

  /* Sort: lora first, then ble, then zb, by key alphabetically within each */
  visible.sort(function(a, b) {
    var pa = tatmState.devices[a].proto;
    var pb = tatmState.devices[b].proto;
    var order = { 'lora': 0, 'ble': 1, 'zb': 2 };
    var oa = order[pa] !== undefined ? order[pa] : 9;
    var ob = order[pb] !== undefined ? order[pb] : 9;
    if (oa !== ob) return oa - ob;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (var vi = 0; vi < visible.length; vi++) {
    var card = tatmBuildCard(visible[vi], now);
    if (card) grid.appendChild(card);
  }
}

function tatmBuildCard(key, now) {
  var dev   = tatmState.devices[key];
  if (!dev) return null;
  var state = tatmDeviceState(dev, now);
  var div   = document.createElement('div');
  div.className  = 'tatm-card';
  div.setAttribute('data-key', key);
  div.setAttribute('data-state', state);

  /* Protocol badge */
  var protoLabel = { ble: 'BLE', zb: 'Zigbee', lora: 'LoRa P2P' }[dev.proto] || dev.proto.toUpperCase();
  var protoCls   = { ble: 'proto-ble', zb: 'proto-zb', lora: 'proto-lora' }[dev.proto] || '';
  var typeLabel = tatmTypeLabel(dev.type);
  var typeIcon  = { sensor: '🌡', led: '💡', lora_node: '📡', unknown: '❓' }[dev.type] || '❓';
  var stateTxt  = tatmStateLabel(state);
  var stateCls  = tatmStateClass(state);

  /* Timestamps */
  var lastTsTxt = dev.lastTs ? tatmFmtTime(new Date(dev.lastTs)) : '—';

  /* Build inner HTML */
  var html = '';

  /* Header row */
  html += '<div class="tatm-card-hdr">' +
    '<span class="tatm-card-proto-badge ' + protoCls + '">' + tatmEsc(protoLabel) + '</span>' +
    '<span class="tatm-card-type-badge ' + tatmTypeClass(dev.type) + '">' + typeIcon + ' ' + tatmEsc(typeLabel) + '</span>' +
    '<span class="tatm-card-name" title="' + tatmEsc(dev.name) + '">' + tatmEsc(dev.name) + '</span>' +
    '<span class="tatm-card-state-badge ' + stateCls + '">' + stateTxt + '</span>' +
  '</div>';

  /* Meta: addr + timestamp */
  if (dev.type === 'lora_node') {
    html += '<div class="tatm-card-meta">' +
      '<span class="tatm-card-addr">Slot: ' + tatmEsc(String(dev.slot || '?')) + '</span>' +
      '<span class="tatm-card-addr">RSSI: ' + tatmEsc(String(dev.data.rssi || '—')) + '</span>' +
      '<span class="tatm-card-ts">Last: ' + lastTsTxt + '</span>' +
    '</div>';
  } else {
    html += '<div class="tatm-card-meta">' +
      '<span class="tatm-card-addr">' + tatmEsc(dev.addr || '—') + '</span>' +
      '<span class="tatm-card-ts">Last: ' + lastTsTxt + '</span>' +
    '</div>';
  }

  html += '<div class="tatm-card-div"></div>';

  /* Data section based on type */
  if (dev.type === 'sensor' || dev.type === 'lora_node') {
    var tempVal = (dev.data.temp !== undefined && dev.data.temp !== null) ? dev.data.temp + ' °C' : '—';
    var humVal  = (dev.data.hum  !== undefined && dev.data.hum  !== null) ? dev.data.hum  + ' %' : '—';
    html += '<div class="tatm-card-data">' +
      '<div class="tatm-data-item"><div class="tatm-data-lbl">Temp</div><div class="tatm-data-val">' + tatmEsc(String(tempVal)) + '</div></div>' +
      '<div class="tatm-data-item"><div class="tatm-data-lbl">Hum</div><div class="tatm-data-val">' + tatmEsc(String(humVal)) + '</div></div>' +
    '</div>';
  }

  if (dev.type === 'led') {
    var onState  = tatmNormalizeOnState(dev.data);
    var onBadge  = onState === null ? '—' : (onState ? '<span class="badge-on">ON</span>' : '<span class="badge-off">OFF</span>');
    var colorVal = dev.data.color || '—';
    var lastCmd  = dev.data.lastCmd || '—';
    html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">State</span><span class="tatm-attr-val">' + onBadge + '</span></div>';
    if (dev.data.level !== undefined) {
      html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">Level</span><span class="tatm-attr-val">' + tatmEsc(String(dev.data.level)) + '%</span></div>';
    }
    html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">Color</span><span class="tatm-attr-val">' + tatmEsc(String(colorVal)) + '</span></div>';
    html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">Last cmd</span><span class="tatm-attr-val">' + tatmEsc(String(lastCmd)) + '</span></div>';
  }

  if (dev.type === 'lora_node') {
    var ledState = dev.data.ledState || '—';
    var seq      = dev.data.seq      !== undefined ? dev.data.seq : '—';
    var lastJoin = dev.data.lastJoin || '—';
    var lastCmd2 = dev.data.lastCmd  || '—';
    html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">LED State</span><span class="tatm-attr-val">' + tatmEsc(String(ledState)) + '</span></div>';
    html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">Seq</span><span class="tatm-attr-val">' + tatmEsc(String(seq)) + '</span></div>';
    html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">Last join</span><span class="tatm-attr-val">' + tatmEsc(String(lastJoin)) + '</span></div>';
    html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">Last cmd</span><span class="tatm-attr-val">' + tatmEsc(String(lastCmd2)) + '</span></div>';
  }

  if (dev.type === 'unknown') {
    html += '<div class="tatm-card-attr"><span class="tatm-attr-lbl">Status</span><span class="tatm-attr-val">Awaiting auth key</span></div>';
  }

  if (dev.type === 'sensor') {
    html += '<div class="tatm-card-div"></div>';
    html += '<div class="tatm-card-footer"><span>' + tatmEsc(String(tatmSampleCount(dev))) + ' samples</span></div>';
  }

  div.innerHTML = html;
  return div;
}

/* ═══════════════════════════════════════════════════════════════════
   Footer
   ═══════════════════════════════════════════════════════════════════ */
function tatmUpdateFooter() {
  var stats = document.getElementById('tatm-stats');
  var lastEl = document.getElementById('tatm-last-ts');
  var cnt = Object.keys(tatmState.devices).length;
  if (stats) stats.textContent = tatmState.totalRx + ' reports / ' + cnt + ' devices active';
  if (lastEl) lastEl.textContent = tatmState.lastTs ? 'Last: ' + tatmFmtTime(new Date(tatmState.lastTs)) : '—';
}

/* ═══════════════════════════════════════════════════════════════════
   Clear state
   ═══════════════════════════════════════════════════════════════════ */
function tatmClearState() {
  tatmState.devices   = {};
  tatmState.totalRx   = 0;
  tatmState.lastTs    = 0;
  try { localStorage.removeItem(TATM_LS_KEY); } catch (e) {}
  tatmSetPill('idle', 'Waiting');
  tatmRenderCards();
  tatmUpdateFooter();
}

/* ═══════════════════════════════════════════════════════════════════
   Persistence (localStorage)
   ═══════════════════════════════════════════════════════════════════ */
function tatmPersistState() {
  try {
    var state = {
      devices:  tatmState.devices,
      totalRx:  tatmState.totalRx,
      lastTs:   tatmState.lastTs
    };
    localStorage.setItem(TATM_LS_KEY, JSON.stringify(state));
  } catch (e) {}
}

function tatmRestoreState() {
  try {
    var s = localStorage.getItem(TATM_LS_KEY);
    if (!s) return;
    var parsed = JSON.parse(s);
    if (parsed && parsed.devices) {
      tatmState.devices  = parsed.devices;
      tatmState.totalRx  = parsed.totalRx  || 0;
      tatmState.lastTs   = parsed.lastTs   || 0;
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   Utility helpers
   ═══════════════════════════════════════════════════════════════════ */
function tatmDecodeVal(val) {
  if (!val) return '';
  if (typeof val === 'object') {
    if (val.result   !== undefined) val = val.result;
    else if (val.data !== undefined) val = val.data;
  }
  var s = String(val);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    var str = '';
    for (var i = 0; i < s.length; i += 2) {
      var b = parseInt(s.substr(i, 2), 16);
      if (!isNaN(b)) str += String.fromCharCode(b);
    }
    return str;
  }
  return s;
}

function tatmFmtTime(d) {
  return ('0' + d.getHours()).slice(-2) + ':' +
         ('0' + d.getMinutes()).slice(-2) + ':' +
         ('0' + d.getSeconds()).slice(-2);
}

function tatmEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function tatmSetPill(state, text) {
  console.log('[TATM] tatmSetPill:', state, text);
  var el  = document.getElementById('tatm-pill');
  var txt = document.getElementById('tatm-pill-txt');
  if (!el) console.log('[TATM] ERROR: tatm-pill not found');
  if (!txt) console.log('[TATM] ERROR: tatm-pill-txt not found');
  if (el)  el.setAttribute('data-state', state);
  if (txt) txt.textContent = text;
}
