/* =====================================================================
   DA2 BLE Sensor Monitor — ThingsBoard Latest Values Widget
   Type    : Latest Values (has datasources → onDataUpdated fires)
   Datasource: Entity → Gateway device → key "data" (Latest Telemetry)

   Data flow (zero polling):
     BLE Sensor pushes NOTIFY every ~3 s
     → ESP32-LAN firmware captures BLE_NOTIFY_EVT
     → Uplinks to STM32-WAN via SPI
     → STM32 publishes MQTT: {"data": "<hex(CFBG:OK:NOTIFY:N:0xHH:AABBCCDD)>"}
     → ThingsBoard stores as telemetry key "data"
     → WebSocket pushes update to widget browser
     → onDataUpdated() fires → decode hex → render sensor cards

   IMPORTANT ThingsBoard notes:
     - Avoid .finally() — not polyfilled in all TB versions
     - Use document.getElementById, not querySelector inside TB sandbox
   ===================================================================== */

var monState = {
  sensors: {},   /* devIdx → {temp, hum, tempMax, tempMin, humMax, humMin, lastUpdate, rxCount, name, dataTs} */
  totalRx:  0,
  devNames: {}   /* idx→name loaded from localStorage (set by control widget) */
};

/* Shared localStorage key — written by ble_gatt_control_widget.js */
var LS_SAVED_KEY = 'ble_gatt_saved_devices_v2';

function loadSavedDevices() {
  try {
    var raw = localStorage.getItem(LS_SAVED_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function resolveDeviceName(idx) {
  var saved = loadSavedDevices();
  for (var i = 0; i < saved.length; i++) {
    if (saved[i].idx === idx) return saved[i].name || 'Device #' + idx;
  }
  return 'Sensor #' + idx;
}

function resolveDeviceType(idx) {
  var saved = loadSavedDevices();
  for (var i = 0; i < saved.length; i++) {
    if (saved[i].idx === idx) return saved[i].type || 'unknown';
  }
  return 'unknown';
}

/* A card is considered stale after this many ms with no new NOTIFY.
   NOTIFY fires every ~3 s; 30 s gives 10× tolerance for network jitter. */
var STALE_MS = 30000;

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
var _staleTimer = null;

self.onInit = function () {
  renderSensors();
  /* Sweep every 10 s — removes cards for sensors that stopped sending */
  _staleTimer = setInterval(function () {
    var now = Date.now();
    var changed = false;
    var keys = Object.keys(monState.sensors);
    for (var i = 0; i < keys.length; i++) {
      var s = monState.sensors[keys[i]];
      if (s.dataTs && (now - s.dataTs) > STALE_MS) {
        delete monState.sensors[keys[i]];
        changed = true;
      }
    }
    if (changed) {
      renderSensors();
      if (!Object.keys(monState.sensors).length) setPill('idle', 'No active sensors');
    }
  }, 10000);
};

self.onDestroy = function () {
  if (_staleTimer) { clearInterval(_staleTimer); _staleTimer = null; }
};

/* Fires every time telemetry data arrives via ThingsBoard WebSocket.
 * latest[0] = ThingsBoard-stored timestamp (ms since epoch).
 * latest[1] = telemetry value.
 * On widget reload TB immediately pushes the last stored value — we skip it
 * if the timestamp is older than STALE_MS so stale cards never reappear. */
self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    var now = Date.now();
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      /* Process ALL entries in the batch — when SCAN_DONE and NOTIFY arrive
       * close together, ThingsBoard stores both in kd.data.  Reading only the
       * last entry would miss NOTIFY entries that precede a SCAN_DONE response. */
      for (var di = 0; di < kd.data.length; di++) {
        var entry  = kd.data[di];
        var dataTs = entry[0];   /* ThingsBoard timestamp, ms */
        var raw    = entry[1];
        /* Skip stale replay on reload — only process fresh data */
        if (!dataTs || (now - dataTs) > STALE_MS) continue;
        var decoded = decodeHex(raw);
        splitLines(decoded).forEach(function (line) {
          parseAndUpdate(line, dataTs);
          /* Bridge: forward every line to control widget via CustomEvent so it
           * receives SCAN_DONE, CONNECTED, DISCONNECTED etc. even when those
           * arrive as telemetry (after RPC slot was consumed by a NOTIFY). */
          blmEmit(line, dataTs);
        });
      }
    }
  } catch (e) { /* silently ignore */ }
};

/* Forward a decoded telemetry line to the control widget.
 * Uses window CustomEvent (same-page, zero-latency) with localStorage as a
 * fallback bridge for widgets loaded in different iframes. */
function blmEmit(line, ts) {
  try {
    window.dispatchEvent(new CustomEvent('da2_blg_event', {
      detail: { line: line, ts: ts || Date.now() }
    }));
  } catch (e) { /* CustomEvent not supported */ }
  try {
    localStorage.setItem('da2_blg_bridge',
      JSON.stringify({ line: line, ts: ts || Date.now() }));
  } catch (e) { /* storage full / sandboxed */ }
}

/* ═══════════════════════════════════════════════════════════════════
   Parse one decoded telemetry line
   ═══════════════════════════════════════════════════════════════════ */
function parseAndUpdate(line, dataTs) {
  /* Strip CFBG:OK: / CFBG:FAIL: prefix present in some paths */
  var l = line.replace(/^CFBG:(OK|FAIL):/, '');

  /* NOTIFY:<idx>:0x<handle>:<8 hex bytes = 4B sensor data> */
  var m = l.match(/^NOTIFY:(\d+):0x[0-9A-Fa-f]+:([0-9A-Fa-f]{8,})/i);
  if (!m) return;

  var idx = parseInt(m[1], 10);
  var hex = m[2];

  /* Skip non-sensor devices: LEDs may send NOTIFY bytes that decode as garbage T/H */
  if (resolveDeviceType(idx) === 'led') return;

  /* Decode 4 bytes little-endian: [temp_i16LE][hum_i16LE] */
  var b0 = parseInt(hex.substr(0, 2), 16);
  var b1 = parseInt(hex.substr(2, 2), 16);
  var b2 = parseInt(hex.substr(4, 2), 16);
  var b3 = parseInt(hex.substr(6, 2), 16);
  var rawT = (b1 << 8) | b0; if (rawT & 0x8000) rawT -= 0x10000;
  var rawH = (b3 << 8) | b2; if (rawH & 0x8000) rawH -= 0x10000;
  var temp = rawT / 100.0;
  var hum  = rawH / 100.0;

  /* Update sensor state */
  if (!monState.sensors[idx]) {
    monState.sensors[idx] = {
      temp: null, hum: null,
      tempMax: null, tempMin: null,
      humMax: null,  humMin: null,
      lastUpdate: null, rxCount: 0,
      name: resolveDeviceName(idx),
      dataTs: dataTs || Date.now()
    };
  }
  var s = monState.sensors[idx];
  s.temp   = temp;
  s.hum    = hum;
  s.dataTs = dataTs || Date.now();  /* refresh staleness clock */
  s.tempMax = (s.tempMax === null || temp > s.tempMax) ? temp : s.tempMax;
  s.tempMin = (s.tempMin === null || temp < s.tempMin) ? temp : s.tempMin;
  s.humMax  = (s.humMax  === null || hum  > s.humMax)  ? hum  : s.humMax;
  s.humMin  = (s.humMin  === null || hum  < s.humMin)  ? hum  : s.humMin;
  s.lastUpdate = new Date().toLocaleTimeString();
  s.rxCount++;
  monState.totalRx++;

  /* Update UI */
  renderSensors();
  var rc = ge('mon-rx-count'); if (rc) rc.textContent = monState.totalRx + ' packets received';
  var ts = ge('mon-last-ts');  if (ts) ts.textContent  = 'Last: ' + s.lastUpdate;
  setPill('active', 'Live');
}

/* ═══════════════════════════════════════════════════════════════════
   Render sensor card grid
   ═══════════════════════════════════════════════════════════════════ */
function renderSensors() {
  var el = ge('sensor-grid');
  if (!el) return;

  var keys = Object.keys(monState.sensors);
  var hint = ge('sensor-hint');

  if (!keys.length) {
    if (hint) hint.style.display = '';
    return;
  }
  if (hint) hint.style.display = 'none';

  /* Remove old sensor cards (keep hint node) */
  var old = el.querySelectorAll('.sensor-card-wrap');
  for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);

  /* Re-create one card per sensor */
  keys.forEach(function (k) {
    var s = monState.sensors[k];
    var card = document.createElement('div');
    card.className = 'sensor-card-wrap';
    card.innerHTML =
      '<div class="sc-header">' +
        '<span class="sc-icon">🌡</span>' +
        '<span class="sc-name">' + escHtml(s.name) + '</span>' +
        '<span class="sc-badge">● Active</span>' +
      '</div>' +
      '<div class="sc-vals">' +
        '<div class="sc-col">' +
          '<div class="sc-label">Temperature</div>' +
          '<div class="sc-val">' + (s.temp !== null ? s.temp.toFixed(2) : '—') +
            '<span class="sc-unit"> °C</span></div>' +
          '<div class="sc-mm">' +
            '<span>↑ ' + (s.tempMax !== null ? s.tempMax.toFixed(1) : '—') + '</span>' +
            '<span>↓ ' + (s.tempMin !== null ? s.tempMin.toFixed(1) : '—') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="sc-divider"></div>' +
        '<div class="sc-col">' +
          '<div class="sc-label">Humidity</div>' +
          '<div class="sc-val">' + (s.hum !== null ? s.hum.toFixed(2) : '—') +
            '<span class="sc-unit"> %</span></div>' +
          '<div class="sc-mm">' +
            '<span>↑ ' + (s.humMax !== null ? s.humMax.toFixed(1) : '—') + '</span>' +
            '<span>↓ ' + (s.humMin !== null ? s.humMin.toFixed(1) : '—') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sc-footer">' +
        '<span>Last update: ' + (s.lastUpdate || '—') + '</span>' +
        '<span class="sc-rxcnt">' + s.rxCount + ' rx</span>' +
      '</div>';
    el.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */
function decodeHex(val) {
  if (!val) return '';
  if (typeof val === 'object') {
    if (val.result !== undefined) val = val.result;
    else if (val.data !== undefined) val = val.data;
  }
  var s = String(val);
  /* If value looks like a pure hex blob, decode to ASCII */
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    var r = '';
    for (var i = 0; i < s.length; i += 2) {
      var b = parseInt(s.substr(i, 2), 16);
      if (!isNaN(b)) r += String.fromCharCode(b);
    }
    return r;
  }
  return s;
}

function splitLines(s) {
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    var ci = x.indexOf('CFBG:');
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

function ge(id)     { return document.getElementById(id); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function setPill(state, text) {
  var p = ge('mon-pill');     if (p) p.setAttribute('data-state', state);
  var t = ge('mon-pill-txt'); if (t) t.textContent = text;
}
