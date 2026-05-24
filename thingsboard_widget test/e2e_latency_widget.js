/* ==========================================================================
   DA2 E2E Latency Monitor Widget — JavaScript
   Paste into ThingsBoard widget editor → JavaScript tab

   Datasource index mapping (configure in widget editor, Latest Values):
     ctx.data[0]  LoRa  gateway device, telemetry key "data"
                        value: hex string, 10 bytes LE = uint64 ts_ms + uint16 seq
                        (8-byte legacy payload still accepted, seq treated as null)
     ctx.data[1]  BLE   gateway device, telemetry key "data"
                        value: hex string, 10 bytes LE = uint64 ts_ms + uint16 seq
     ctx.data[2]  Zigbee gateway device, telemetry key "temp"
                        value: float = (int16_t)(epoch_sec & 0xFFFF) / 100.0
     ctx.data[3]  Zigbee gateway device, telemetry key "hum"
                        value: float = (uint16_t)(epoch_sec >> 16) / 100.0
                        Zigbee has no seq — loss tracking disabled for ZB.

   e2e_delay_ms = ThingsBoard message ts − node_ts_ms
   Min/avg/max are computed AFTER warm-up skip + IQR outlier filter.
   ========================================================================== */

var E2E_MAX_HISTORY   = 100;
var E2E_MAX_CHART_PTS = 40;
var E2E_WARN_THRESH   = 1000;   /* ms — yellow pill  */
var E2E_BAD_THRESH    = 5000;   /* ms — red pill      */
var E2E_WARMUP_SKIP   = 3;      /* first N samples per protocol are ignored */
var E2E_IQR_K         = 1.5;    /* Tukey fence multiplier for outlier filter */
var E2E_STATS_WINDOW  = 50;     /* sliding window used for min/avg/max + IQR */

/* Per-protocol state:
 *   cur         — last raw delay (always displayed, even during warm-up)
 *   pts         — last E2E_MAX_CHART_PTS raw delays for the chart line
 *   window      — last E2E_STATS_WINDOW raw delays used for stats + IQR
 *   warm        — samples seen so far (when < E2E_WARMUP_SKIP, ignored in stats)
 *   lastSeq     — last 16-bit seq seen (null = none yet)
 *   recvCount   — samples that contributed to stats (post-warmup)
 *   lossCount   — packets inferred lost from seq gaps (post-warmup)
 */
function _makeProtoState() {
  return { cur: null, pts: [], window: [],
           warm: 0, lastSeq: null,
           recvCount: 0, lossCount: 0 };
}

var e2eState = {
  lora:   _makeProtoState(),
  ble:    _makeProtoState(),
  zigbee: _makeProtoState(),
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
      var dec0 = e2eDecodeHexTsSeq(String(pt0[1]).trim());
      if (dec0 && ts0 > 0) {
        var d0 = ts0 - dec0.ts;
        if (d0 >= 0 && d0 < 300000) e2eUpdateProto('lora', d0, dec0.ts, ts0, dec0.seq);
      }
    }

    /* Index 1: BLE */
    if (data[1] && data[1].data && data[1].data.length > 0) {
      var pt1 = data[1].data[data[1].data.length - 1];
      var ts1 = pt1[0];
      var dec1 = e2eDecodeHexTsSeq(String(pt1[1]).trim());
      if (dec1 && ts1 > 0) {
        var d1 = ts1 - dec1.ts;
        if (d1 >= 0 && d1 < 300000) e2eUpdateProto('ble', d1, dec1.ts, ts1, dec1.seq);
      }
    }

    /* Indices 2+3: Zigbee temp + hum (no seq) */
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
        if (dZb >= 0 && dZb < 300000) e2eUpdateProto('zigbee', dZb, zbNodeTs, zbTs, null);
      }
    }

    e2eDrawChart();
  } catch (err) {}
};

self.onResize = function () {
  try { e2eDrawChart(); } catch (e) {}
};

/* ── Decode helpers ──────────────────────────────────────────────────────── */

/* Decode hex payload into {ts, seq}.
 *   20 hex chars (10 bytes) = uint64 ts_ms LE + uint16 seq LE
 *   16 hex chars  (8 bytes) = uint64 ts_ms LE only (legacy, seq = null)
 * Returns null on malformed input. */
function e2eDecodeHexTsSeq(hexStr) {
  if (!hexStr) return null;
  var s = hexStr.replace(/\s/g, '').toUpperCase();
  if (s.length < 16) return null;

  var lo32 = 0, hi32 = 0;
  for (var i = 0; i < 4; i++) lo32 |= (parseInt(s.slice(i*2, i*2+2), 16) << (i*8));
  for (var j = 0; j < 4; j++) hi32 |= (parseInt(s.slice(8+j*2, 10+j*2), 16) << (j*8));
  lo32 = lo32 >>> 0;
  hi32 = hi32 >>> 0;
  if (hi32 === 0 && lo32 === 0) return null;
  var ts = hi32 * 4294967296 + lo32;

  var seq = null;
  if (s.length >= 20) {
    var b8 = parseInt(s.slice(16, 18), 16);
    var b9 = parseInt(s.slice(18, 20), 16);
    if (!isNaN(b8) && !isNaN(b9)) seq = (b8 | (b9 << 8)) & 0xFFFF;
  }
  return { ts: ts, seq: seq };
}

function e2eDecodeZbTs(tempC, humRh) {
  var lo = (Math.round(tempC * 100.0)) & 0xFFFF;
  var hi = (Math.round(humRh  * 100.0)) & 0xFFFF;
  var sec = (hi * 65536) + lo;
  if (sec < 1000000000 || sec > 4294967295) return null;
  return sec * 1000;
}

/* ── Core update ─────────────────────────────────────────────────────────── */

function e2eUpdateProto(proto, delayMs, nodeTs, serverTs, seq) {
  var s = e2eState[proto];
  s.cur = delayMs;

  /* always feed the chart line and history (warm-up + outliers visible there) */
  s.pts.push({ v: delayMs });
  if (s.pts.length > E2E_MAX_CHART_PTS) s.pts.shift();

  /* seq-based loss tracking (post-warm-up). Zigbee passes seq = null → skip. */
  if (seq !== null && seq !== undefined) {
    if (s.lastSeq !== null) {
      var gap = ((seq - s.lastSeq) & 0xFFFF) - 1; /* 16-bit wrap-safe */
      if (gap > 0 && gap < 1000 && s.warm >= E2E_WARMUP_SKIP) {
        s.lossCount += gap;
      }
    }
    s.lastSeq = seq;
  }

  s.warm++;
  if (s.warm > E2E_WARMUP_SKIP) {
    /* contribute to stats window after warm-up */
    s.window.push(delayMs);
    if (s.window.length > E2E_STATS_WINDOW) s.window.shift();
    s.recvCount++;
  }

  e2eUpdateCard(proto, s);
  e2eAddHistRow(proto, delayMs, nodeTs, serverTs);
  var el = document.getElementById('e2e-last-update');
  if (el) el.textContent = 'Last: ' + new Date().toLocaleTimeString();
}

/* ── IQR outlier filter ──────────────────────────────────────────────────── */

/* Given an array of numbers, return {min, max, avg, kept, dropped} where
 * outliers outside [Q1 − k·IQR, Q3 + k·IQR] are excluded.
 * Returns null if window too small (< 5 samples). */
function e2eIqrStats(arr) {
  if (!arr || arr.length === 0) return null;
  if (arr.length < 5) {
    /* not enough samples for IQR — fall back to raw */
    var raw_sum = 0, raw_mn = arr[0], raw_mx = arr[0];
    for (var i = 0; i < arr.length; i++) {
      raw_sum += arr[i];
      if (arr[i] < raw_mn) raw_mn = arr[i];
      if (arr[i] > raw_mx) raw_mx = arr[i];
    }
    return { min: raw_mn, max: raw_mx, avg: raw_sum / arr.length,
             kept: arr.length, dropped: 0 };
  }
  var sorted = arr.slice().sort(function (a, b) { return a - b; });
  var q1 = sorted[Math.floor(sorted.length * 0.25)];
  var q3 = sorted[Math.floor(sorted.length * 0.75)];
  var iqr = q3 - q1;
  var lo = q1 - E2E_IQR_K * iqr;
  var hi = q3 + E2E_IQR_K * iqr;
  var sum = 0, mn = null, mx = null, kept = 0, dropped = 0;
  for (var k = 0; k < arr.length; k++) {
    var v = arr[k];
    if (v < lo || v > hi) { dropped++; continue; }
    if (mn === null || v < mn) mn = v;
    if (mx === null || v > mx) mx = v;
    sum += v;
    kept++;
  }
  if (kept === 0) return null;
  return { min: mn, max: mx, avg: sum / kept, kept: kept, dropped: dropped };
}

/* ── Card render ─────────────────────────────────────────────────────────── */

function e2eUpdateCard(proto, s) {
  var id = proto === 'zigbee' ? 'zb' : proto;
  e2eSetText(id + '-delay', s.cur === null ? '—' : Math.round(s.cur).toLocaleString());

  var stats = e2eIqrStats(s.window);
  if (stats) {
    e2eSetText(id + '-min', Math.round(stats.min).toLocaleString());
    e2eSetText(id + '-avg', Math.round(stats.avg).toLocaleString());
    e2eSetText(id + '-max', Math.round(stats.max).toLocaleString());
  } else {
    e2eSetText(id + '-min', '—');
    e2eSetText(id + '-avg', '—');
    e2eSetText(id + '-max', '—');
  }

  /* loss rate (only for protocols with seq) */
  var lossEl = document.getElementById(id + '-loss');
  if (lossEl) {
    if (proto === 'zigbee' || s.lastSeq === null) {
      lossEl.textContent = 'n/a';
    } else {
      var total = s.recvCount + s.lossCount;
      var pct = total > 0 ? (s.lossCount * 100.0 / total) : 0;
      lossEl.textContent = s.lossCount + '/' + total + ' (' + pct.toFixed(1) + '%)';
    }
  }

  var pillEl = document.getElementById(id + '-pill');
  if (!pillEl) return;

  var cls, text;
  if (s.cur === null) {
    cls = 'idle'; text = 'Waiting';
  } else if (s.warm <= E2E_WARMUP_SKIP) {
    cls = 'warn'; text = 'Warm-up ' + s.warm + '/' + E2E_WARMUP_SKIP;
  } else if (s.cur > E2E_BAD_THRESH) {
    cls = 'bad';  text = 'Poor';
  } else if (s.cur > E2E_WARN_THRESH) {
    cls = 'warn'; text = 'Fair';
  } else {
    cls = 'ok';   text = 'Good';
  }
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
