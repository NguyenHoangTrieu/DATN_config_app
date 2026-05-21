/* ==========================================================================
   DA2 E2E Latency Monitor Widget — JavaScript
   Paste into ThingsBoard widget editor → JavaScript tab

   Datasource index mapping (configure in widget editor, Latest Values):
     ctx.data[0]  LoRa  gateway device, telemetry key "data"
                        value: hex string, 8 bytes little-endian = uint64 ts_ms
     ctx.data[1]  BLE   gateway device, telemetry key "data"
                        value: hex string, 8 bytes little-endian = uint64 ts_ms
     ctx.data[2]  Zigbee gateway device, telemetry key "temp"
                        value: float = (int16_t)(epoch_sec & 0xFFFF) / 100.0
     ctx.data[3]  Zigbee gateway device, telemetry key "hum"
                        value: float = (uint16_t)(epoch_sec >> 16) / 100.0

   e2e_delay_ms = ThingsBoard message ts − node_ts_ms
   ========================================================================== */

var E2E_MAX_HISTORY   = 100;
var E2E_MAX_CHART_PTS = 40;
var E2E_WARN_THRESH   = 1000;   /* ms — yellow pill  */
var E2E_BAD_THRESH    = 5000;   /* ms — red pill      */

var e2eState = {
  lora:   { cur: null, min: null, max: null, sum: 0, cnt: 0, pts: [] },
  ble:    { cur: null, min: null, max: null, sum: 0, cnt: 0, pts: [] },
  zigbee: { cur: null, min: null, max: null, sum: 0, cnt: 0, pts: [] },
  histRows: []
};

var e2eZbTempTs = null;
var e2eZbHumTs  = null;

/* ── ThingsBoard lifecycle ─────────────────────────────────────────────── */

self.onInit = function () {
  try { e2eDrawChart(); } catch (e) {}
};

self.onDestroy = function () {};

self.onDataUpdated = function () {
  try {
    var data = self.ctx.data;
    if (!data) return;

    /* Index 0: LoRa */
    if (data[0] && data[0].data && data[0].data.length > 0) {
      var pt0 = data[0].data[data[0].data.length - 1];
      var ts0 = pt0[0];
      var nodeTs0 = e2eDecodeHexTs(String(pt0[1]).trim());
      if (nodeTs0 !== null && ts0 > 0) {
        var d0 = ts0 - nodeTs0;
        if (d0 >= 0 && d0 < 300000) e2eUpdateProto('lora', d0, nodeTs0, ts0);
      }
    }

    /* Index 1: BLE */
    if (data[1] && data[1].data && data[1].data.length > 0) {
      var pt1 = data[1].data[data[1].data.length - 1];
      var ts1 = pt1[0];
      var nodeTs1 = e2eDecodeHexTs(String(pt1[1]).trim());
      if (nodeTs1 !== null && ts1 > 0) {
        var d1 = ts1 - nodeTs1;
        if (d1 >= 0 && d1 < 300000) e2eUpdateProto('ble', d1, nodeTs1, ts1);
      }
    }

    /* Indices 2+3: Zigbee temp + hum */
    var zbTempC = null, zbHumRh = null, zbTs = null;
    if (data[2] && data[2].data && data[2].data.length > 0) {
      var pt2 = data[2].data[data[2].data.length - 1];
      e2eZbTempTs = pt2[0];
      zbTempC = parseFloat(pt2[1]);
      if (isNaN(zbTempC)) zbTempC = null;
    }
    if (data[3] && data[3].data && data[3].data.length > 0) {
      var pt3 = data[3].data[data[3].data.length - 1];
      e2eZbHumTs = pt3[0];
      zbHumRh = parseFloat(pt3[1]);
      if (isNaN(zbHumRh)) zbHumRh = null;
    }

    if (e2eZbTempTs !== null && e2eZbHumTs !== null) {
      zbTs = Math.max(e2eZbTempTs, e2eZbHumTs);
    } else {
      zbTs = e2eZbTempTs || e2eZbHumTs;
    }

    if (zbTempC !== null && zbHumRh !== null && zbTs !== null) {
      var zbNodeTs = e2eDecodeZbTs(zbTempC, zbHumRh);
      if (zbNodeTs !== null) {
        var dZb = zbTs - zbNodeTs;
        if (dZb >= 0 && dZb < 300000) e2eUpdateProto('zigbee', dZb, zbNodeTs, zbTs);
      }
    }

    e2eDrawChart();
  } catch (err) {}
};

self.onResize = function () {
  try { e2eDrawChart(); } catch (e) {}
};

/* ── Decode helpers ──────────────────────────────────────────────────────── */

function e2eDecodeHexTs(hexStr) {
  if (!hexStr || hexStr.length < 16) return null;
  var s = hexStr.replace(/\s/g, '').toUpperCase();
  if (s.length < 16) return null;
  var lo32 = 0, hi32 = 0;
  for (var i = 0; i < 4; i++) lo32 |= (parseInt(s.slice(i*2, i*2+2), 16) << (i*8));
  for (var i = 0; i < 4; i++) hi32 |= (parseInt(s.slice(8+i*2, 10+i*2), 16) << (i*8));
  lo32 = lo32 >>> 0;
  hi32 = hi32 >>> 0;
  if (hi32 === 0 && lo32 === 0) return null;
  return hi32 * 4294967296 + lo32;
}

function e2eDecodeZbTs(tempC, humRh) {
  var lo = (Math.round(tempC * 100.0)) & 0xFFFF;
  var hi = (Math.round(humRh  * 100.0)) & 0xFFFF;
  var sec = (hi * 65536) + lo;
  if (sec < 1000000000 || sec > 4294967295) return null;
  return sec * 1000;
}

/* ── Core update ─────────────────────────────────────────────────────────── */

function e2eUpdateProto(proto, delayMs, nodeTs, serverTs) {
  var s = e2eState[proto];
  s.cur = delayMs;
  if (s.min === null || delayMs < s.min) s.min = delayMs;
  if (s.max === null || delayMs > s.max) s.max = delayMs;
  s.sum += delayMs;
  s.cnt++;
  s.pts.push({ v: delayMs });
  if (s.pts.length > E2E_MAX_CHART_PTS) s.pts.shift();
  e2eUpdateCard(proto, s);
  e2eAddHistRow(proto, delayMs, nodeTs, serverTs);
  var el = document.getElementById('e2e-last-update');
  if (el) el.textContent = 'Last: ' + new Date().toLocaleTimeString();
}

/* ── Card render ─────────────────────────────────────────────────────────── */

function e2eUpdateCard(proto, s) {
  var id = proto === 'zigbee' ? 'zb' : proto;
  e2eSetText(id + '-delay', s.cur === null ? '—' : Math.round(s.cur).toLocaleString());
  e2eSetText(id + '-min',   s.min === null ? '—' : Math.round(s.min).toLocaleString());
  e2eSetText(id + '-avg',   s.cnt > 0 ? Math.round(s.sum / s.cnt).toLocaleString() : '—');
  e2eSetText(id + '-max',   s.max === null ? '—' : Math.round(s.max).toLocaleString());
  var pillEl = document.getElementById(id + '-pill');
  if (!pillEl) return;
  var cls  = s.cur === null ? 'idle' : (s.cur > E2E_BAD_THRESH ? 'bad' : s.cur > E2E_WARN_THRESH ? 'warn' : 'ok');
  var text = s.cur === null ? 'Waiting' : (s.cur > E2E_BAD_THRESH ? 'Poor' : s.cur > E2E_WARN_THRESH ? 'Fair' : 'Good');
  pillEl.className = 'e2e-pill ' + cls;
  pillEl.innerHTML = '<span class="e2e-pill-dot"></span>' + text;
}

/* ── History ─────────────────────────────────────────────────────────────── */

function e2eAddHistRow(proto, delay, nodeTs, serverTs) {
  var now = new Date();
  var t = now.getHours().toString().padStart(2,'0') + ':' +
          now.getMinutes().toString().padStart(2,'0') + ':' +
          now.getSeconds().toString().padStart(2,'0');
  e2eState.histRows.unshift({ t: t, proto: proto, delay: delay, nodeTs: nodeTs, serverTs: serverTs });
  if (e2eState.histRows.length > E2E_MAX_HISTORY) e2eState.histRows.pop();
  e2eRenderHistory();
}

function e2eRenderHistory() {
  var tbody = document.getElementById('e2e-hist-body');
  if (!tbody) return;
  var clsMap = { lora: 'lora-txt', ble: 'ble-txt', zigbee: 'zb-txt' };
  var html = '';
  var rows = e2eState.histRows.slice(0, 50);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var cls = clsMap[r.proto] || '';
    var ntStr = r.nodeTs   ? new Date(r.nodeTs).toISOString().slice(11,23) : '—';
    var svStr = r.serverTs ? new Date(r.serverTs).toISOString().slice(11,23) : '—';
    html += '<tr>' +
      '<td>' + r.t + '</td>' +
      '<td class="' + cls + '">' + r.proto.toUpperCase() + '</td>' +
      '<td class="' + cls + '" style="font-weight:700">' + Math.round(r.delay) + '</td>' +
      '<td style="color:var(--sub);font-size:10px">' + ntStr + '</td>' +
      '<td style="color:var(--sub);font-size:10px">' + svStr + '</td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
}

function e2eClearHistory() {
  e2eState.histRows.length = 0;
  var tbody = document.getElementById('e2e-hist-body');
  if (tbody) tbody.innerHTML = '';
}

/* ── Canvas chart ────────────────────────────────────────────────────────── */

function e2eDrawChart() {
  var canvas = document.getElementById('e2e-chart');
  if (!canvas) return;
  var wrap = canvas.parentElement;
  var W = wrap.clientWidth - 28;
  var H = 110;
  canvas.width  = W;
  canvas.height = H;
  var c = canvas.getContext('2d');

  var allPts = [];
  ['lora','ble','zigbee'].forEach(function(p) {
    e2eState[p].pts.forEach(function(pt) { allPts.push(pt.v); });
  });
  if (allPts.length === 0) {
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#4a4e5f';
    c.font = '11px monospace';
    c.textAlign = 'center';
    c.fillText('Waiting for data…', W/2, H/2);
    return;
  }

  var maxV = Math.max.apply(null, allPts.concat([100]));
  var PL = 44, PR = 8, PT = 8, PB = 18;
  var W2 = W - PL - PR, H2 = H - PT - PB;

  c.clearRect(0, 0, W, H);

  /* Grid */
  c.strokeStyle = 'rgba(255,255,255,0.05)';
  c.lineWidth = 1;
  for (var gi = 0; gi <= 4; gi++) {
    var gy = PT + H2 - (gi / 4) * H2;
    c.beginPath(); c.moveTo(PL, gy); c.lineTo(W - PR, gy); c.stroke();
    c.fillStyle = '#4a4e5f';
    c.font = '9px monospace';
    c.textAlign = 'right';
    c.fillText(Math.round(maxV * gi / 4) + 'ms', PL - 3, gy + 3);
  }

  /* Series */
  var COLORS = { lora: '#2ecc71', ble: '#3498db', zigbee: '#9b59b6' };
  ['lora', 'ble', 'zigbee'].forEach(function (proto) {
    var pts = e2eState[proto].pts;
    var col = COLORS[proto];
    if (pts.length === 0) return;

    if (pts.length === 1) {
      var sx = PL + W2 * 0.5;
      var sy = PT + H2 - Math.min(1, pts[0].v / maxV) * H2;
      c.beginPath(); c.arc(sx, sy, 3, 0, Math.PI * 2);
      c.fillStyle = col; c.fill();
      return;
    }

    c.beginPath();
    pts.forEach(function (p, idx) {
      var px = PL + (idx / (E2E_MAX_CHART_PTS - 1)) * W2;
      var py = PT + H2 - Math.min(1, p.v / maxV) * H2;
      idx === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    });
    c.strokeStyle = col; c.lineWidth = 1.8; c.lineJoin = 'round'; c.stroke();

    /* last dot */
    var lp = pts[pts.length - 1];
    var lx = PL + ((pts.length - 1) / (E2E_MAX_CHART_PTS - 1)) * W2;
    var ly = PT + H2 - Math.min(1, lp.v / maxV) * H2;
    c.beginPath(); c.arc(lx, ly, 3.5, 0, Math.PI * 2);
    c.fillStyle = col; c.fill();
  });

  /* X label */
  c.fillStyle = '#4a4e5f'; c.font = '9px monospace'; c.textAlign = 'center';
  c.fillText('\u2190 last ' + E2E_MAX_CHART_PTS + ' readings \u2192', PL + W2 / 2, H - 4);
}

/* ── Utility ─────────────────────────────────────────────────────────────── */

function e2eSetText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}
