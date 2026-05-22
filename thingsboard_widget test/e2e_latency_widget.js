/* ==========================================================================
   DA2 E2E Latency Monitor Widget — JavaScript
   Paste into ThingsBoard widget editor → JavaScript tab

   Datasource config (Latest Values widget):
     ─────────────────────────────────────────────────────────────────────
     Simplest setup (recommended) — single datasource on the GATEWAY device
     with one or more of these datakeys (whichever the gateway publishes):
       "data"        : text stream — widget auto-routes by prefix:
                        • CFBG:OK:NOTIFY:<idx>:0x<handle>:<hex>   → BLE
                        • +TEST: RXLRPKT "<rssi>,<snr>,<hex>"     → LoRa
                        • +TEST: RX "<hex>"                       → LoRa
       "ble_data"    : raw 16-char hex of node ts_ms LE             → BLE
       "lora_data"   : raw 16-char hex of node ts_ms LE             → LoRa
      "temperature" : float, legacy Zigbee E2E low16 carrier           → Zigbee
      "humidity"    : float, legacy Zigbee E2E high16 carrier OR humidity-only low16(ts_ms)
     ─────────────────────────────────────────────────────────────────────
    Legacy hex-key setup is still supported for BLE/LoRa. Zigbee E2E now
    derives node time from the humidity report only, using low16(ts_ms).

   e2e_delay_ms = ThingsBoard message ts − node_ts_ms
   ========================================================================== */

var E2E_MAX_HISTORY   = 100;
var E2E_MAX_CHART_PTS = 40;
var E2E_WARN_THRESH   = 1000;   /* ms — yellow pill  */
var E2E_BAD_THRESH    = 5000;   /* ms — red pill      */
var E2E_DEBUG_LINES   = 20;     /* lines kept in in-widget debug log */
var E2E_RPI_SAMPLES   = 30;     /* moving median window for server-clock drift */

var e2eState = {
  lora:   { cur: null, min: null, max: null, sum: 0, cnt: 0, pts: [] },
  ble:    { cur: null, min: null, max: null, sum: 0, cnt: 0, pts: [] },
  zigbee: { cur: null, min: null, max: null, sum: 0, cnt: 0, pts: [] },
  histRows: [],
  /* Dedup: gateway sometimes re-emits the same telemetry within ms */
  seenKeys: {},
  seenOrder: [],
  /* Zigbee supports both legacy temp+hum and new humidity-only timestamp modes. */
  zbTemp: null, zbTempTs: null,
  zbHum:  null, zbHumTs:  null,
  debug: []
};

/* ── Clock-sync state ─────────────────────────────────────────────────────
   Why: node ts_ms is NTP-locked to real UTC, but ThingsBoard's "server ts"
   is the host clock (Raspberry Pi). If the Pi is not chrony/ntpd-synced its
   clock can drift seconds — making (serverTs − nodeTs) look like big delay.
   We correct by:
     1) On widget load, fetch real UTC from a public HTTP time service.
        From that, derive browser-to-UTC offset (browser clock can drift too).
     2) When each telemetry arrives, the websocket frame arrives ms after
        the Pi published it. Estimate rpi-clock drift as:
              rpi_drift = serverTs − (Date.now() + browser_to_utc_offset)
        Use median over E2E_RPI_SAMPLES samples to ignore network jitter.
     3) Correct delay = rawDelay − rpi_drift                                 */
var e2eTimeSync = {
  realUtcOffset: 0,    /* (real UTC ms) − Date.now() at browser            */
  rpiDrift:      0,    /* RPi serverTs − real UTC at moment of receive     */
  rpiSamples:    [],
  syncedAt:      0,    /* Date.now() when sync succeeded, 0 if not synced  */
  sourceUrl:     '',
  enabled:       false /* default OFF — see e2eIsDriftCorrectionEnabled()  */
};

/* Drift correction is disabled by default. Enable ONLY when the RPi server
   clock is known to be unsync'd (no chrony/ntpd running). When chrony is
   running on the RPi and nodes use the same NTP source, drift is sub-ms and
   the auto-estimate adds more noise (websocket jitter, RTT asymmetry) than
   it removes — producing negative delays as you saw.

   Turn ON in one of two ways:
     1) Widget settings (TB editor → Advanced → Settings JSON):
            { "driftCorrection": true }
     2) Browser console once:  localStorage.setItem('e2e_drift_correct','1');
*/
function e2eIsDriftCorrectionEnabled() {
  try {
    if (self.ctx && self.ctx.settings && self.ctx.settings.driftCorrection === true) return true;
    if (localStorage.getItem('e2e_drift_correct') === '1') return true;
  } catch (e) {}
  return false;
}

/* ── ThingsBoard lifecycle ─────────────────────────────────────────────── */

self.onInit = function () {
  try { e2eDrawChart(); } catch (e) {}
  e2eTimeSync.enabled = e2eIsDriftCorrectionEnabled();
  if (e2eTimeSync.enabled) {
    /* Kick off async time-sync — don't block init.                        */
    e2eSyncRealUtc();
    /* Re-sync every 10 min to handle long-running dashboards              */
    setInterval(e2eSyncRealUtc, 10 * 60 * 1000);
  } else {
    e2eDebug('drift correction DISABLED — assuming node+server share NTP source. ' +
             'If RPi clock is unsynced, set localStorage e2e_drift_correct=1.');
  }
};

self.onDestroy = function () {};

self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var i = 0; i < data.length; i++) {
      var ds = data[i];
      if (!ds || !ds.data || !ds.data.length) continue;
      var keyName = '';
      if (ds.dataKey && ds.dataKey.name)        keyName = ds.dataKey.name;
      else if (typeof ds.name === 'string')      keyName = ds.name;
      for (var j = 0; j < ds.data.length; j++) {
        var pt = ds.data[j];
        e2eIngest(keyName, pt[0], pt[1]);
      }
    }
    e2eDrawChart();
  } catch (err) {
    e2eDebug('ERROR onDataUpdated: ' + (err && err.message ? err.message : err));
  }
};

self.onResize = function () {
  try { e2eDrawChart(); } catch (e) {}
};

/* ── Per-entry ingestion ─────────────────────────────────────────────────── */

function e2eIngest(keyName, ts, rawVal) {
  if (rawVal === null || rawVal === undefined) return;
  var dedupKey = String(keyName) + '|' + String(ts) + '|' + String(rawVal);
  if (e2eState.seenKeys[dedupKey]) return;
  e2eState.seenKeys[dedupKey] = 1;
  e2eState.seenOrder.push(dedupKey);
  if (e2eState.seenOrder.length > 500) {
    delete e2eState.seenKeys[e2eState.seenOrder.shift()];
  }

  var keyLower = String(keyName || '').toLowerCase();
  var sVal = String(rawVal).trim();

  /* ── Zigbee: accept both legacy temp+hum and humidity-only timestamp. ── */
  if (keyLower === 'temperature' || keyLower === 'temp') {
    var t = parseFloat(sVal);
    if (!isNaN(t)) {
      e2eState.zbTemp = t; e2eState.zbTempTs = ts;
      e2eDebug('ZB temp=' + t + ' ts=' + ts);
      e2eMaybeUpdateZigbee();
    }
    return;
  }
  if (keyLower === 'humidity' || keyLower === 'hum') {
    var h = parseFloat(sVal);
    if (!isNaN(h)) {
      e2eState.zbHum = h; e2eState.zbHumTs = ts;
      e2eDebug('ZB hum=' + h + ' ts=' + ts);
      e2eMaybeUpdateZigbee();
    }
    return;
  }

  /* ── Pure 16-char hex string: direct ts_ms encoding ─────────────────── */
  if (/^[0-9A-Fa-f]{16}$/.test(sVal)) {
    var nodeTs = e2eDecodeHexTs(sVal);
    if (nodeTs !== null) {
      var proto = e2eGuessProtoFromKey(keyLower) || 'ble';
      var d = ts - nodeTs;
      e2eDebug(proto.toUpperCase() + ' hex direct: nodeTs=' + nodeTs + ' delay=' + d);
      if (d >= 0 && d < 300000) e2eUpdateProto(proto, d, nodeTs, ts);
    }
    return;
  }

  /* ── Gateway text framing: try base64 / hex decode first ────────────── */
  var decoded = e2eDecodeText(sVal);
  var lines = e2eSplit(decoded);
  for (var k = 0; k < lines.length; k++) {
    e2eHandleLine(lines[k], ts);
  }
}

/* ── Line dispatcher (single-datasource text stream from gateway) ───── */

function e2eHandleLine(line, ts) {
  if (!line) return;
  var m;

  /* BLE: CFBG:OK:NOTIFY:<idx>:0x<handle>:<hex 8 bytes LE> */
  m = line.match(/CFBG:OK:NOTIFY:\d+:0x[0-9A-Fa-f]+:([0-9A-Fa-f]+)/i);
  if (m) {
    var hex = m[1];
    if (hex.length >= 16) {
      var nodeTs = e2eDecodeHexTs(hex.substring(0, 16));
      if (nodeTs !== null) {
        var d = ts - nodeTs;
        e2eDebug('BLE NOTIFY hex=' + hex.substring(0, 16) + ' nodeTs=' + nodeTs + ' delay=' + d + 'ms');
        if (d >= 0 && d < 300000) e2eUpdateProto('ble', d, nodeTs, ts);
      }
    }
    return;
  }

  /* LoRa: +TEST: RXLRPKT "<rssi>,<snr>,<hex>"  or  +TEST: RX "<hex>" */
  m = line.match(/\+TEST:\s*(?:RXLRPKT|RX)\s*"([^"]+)"/i);
  if (m) {
    var parts = m[1].split(',');
    var hex = parts[parts.length - 1].trim();
    if (/^[0-9A-Fa-f]+$/.test(hex) && hex.length >= 16) {
      var nodeTsL = e2eDecodeHexTs(hex.substring(0, 16));
      if (nodeTsL !== null) {
        var dL = ts - nodeTsL;
        e2eDebug('LoRa RX hex=' + hex.substring(0, 16) + ' nodeTs=' + nodeTsL + ' delay=' + dL + 'ms');
        if (dL >= 0 && dL < 300000) e2eUpdateProto('lora', dL, nodeTsL, ts);
      }
    }
    return;
  }

  /* Zigbee bridge line from the full control widget:
       RPT:<short>,<ep>,<cluster>,<attr>,<type>,<valueHex> */
  m = line.match(/^RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]+)/i);
  if (m) {
    var clusterHex = m[3].toUpperCase();
    var attrHex    = m[4].toUpperCase();
    var typeHex    = parseInt(m[5], 16);
    var valueHex   = m[6].toUpperCase();
    var parsedRpt  = e2eParseHexAttrValue(valueHex, typeHex);
    if (parsedRpt && attrHex === '0000') {
      if (clusterHex === '0402') {
        e2eState.zbTemp = parsedRpt.value / 100.0;
        e2eState.zbTempTs = ts;
        e2eDebug('ZB RPT temp raw=' + parsedRpt.value + ' \u00b0C=' + (parsedRpt.value / 100.0).toFixed(2));
        e2eMaybeUpdateZigbee();
        return;
      }
      if (clusterHex === '0405') {
        e2eState.zbHum = parsedRpt.value / 100.0;
        e2eState.zbHumTs = ts;
        e2eDebug('ZB RPT hum raw=' + parsedRpt.value + ' %=' + (parsedRpt.value / 100.0).toFixed(2));
        e2eMaybeUpdateZigbee();
        return;
      }
    }
  }

  /* ── Zigbee raw gateway event ───────────────────────────────────────── */
  if (/CFZB:\d+:EVT:/i.test(line)) {
    var evtMatch = line.match(/:EVT:(?:\d+\/\d+:)?((?:[0-9A-Fa-f]{2}\s*)+)$/i);
    if (evtMatch && e2eDispatchZigbeeHexFrames(evtMatch[1].trim(), ts)) {
      return;
    }
    var parsed = e2eParseZbHexFrame(line);
    if (parsed) {
      if (parsed.kind === 'temp') {
        e2eState.zbTemp = parsed.value; e2eState.zbTempTs = ts;
        e2eDebug('ZB EVT temp raw=' + parsed.raw + ' °C=' + parsed.value.toFixed(2));
      } else {
        e2eState.zbHum  = parsed.value; e2eState.zbHumTs  = ts;
        e2eDebug('ZB EVT hum  raw=' + parsed.raw + ' %='  + parsed.value.toFixed(2));
      }
      e2eMaybeUpdateZigbee();
      return;
    }
    /* Couldn't parse — log so user can show me the exact format.          */
    e2eDebug('ZB EVT (unparsed): ' + line.substring(0, 140));
    return;
  }

  /* No match — log so we can see what the gateway actually sends.
     CFZB lines are NOT filtered anymore — we want to see them.            */
  if (line.length > 0 && !/CFBG:OK:(SCAN|CONNECT|CONNECTING|DISC|CHAR|SERVICE|DESCR|WRITE|RPT)|SCAN_RESULT|SCAN_DONE|CONNECTED|DISC_DONE/i.test(line)) {
    e2eDebug('? ' + line.substring(0, 120));
  }
}

/* ── Zigbee Ebyte frame parsing ───────────────────────────────────────
   The proven reference implementation already exists in zigbee_control_widget_v2.js:
     1) split concatenated Ebyte frames using the [55][LEN] header,
     2) validate checksum,
     3) decode 0x82/0x0A ZCL Attribute Report payloads.
   We reuse the same layout here so the E2E widget can consume the exact
   raw CFZB EVT stream forwarded by the gateway.                         */

function e2eDispatchZigbeeHexFrames(hexStr, ts) {
  if (!hexStr) return false;
  var tokens = String(hexStr).trim().split(/\s+/);
  var bytes = [];
  for (var i = 0; i < tokens.length; i++) {
    if (!/^[0-9A-Fa-f]{2}$/.test(tokens[i])) return false;
    bytes.push(parseInt(tokens[i], 16));
  }
  if (!bytes.length) return false;

  var pos = 0;
  var handled = false;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0x55) { pos++; continue; }
    if (pos + 1 >= bytes.length) break;
    var frameLen = bytes[pos + 1];
    var totalLen = 2 + frameLen;
    if (frameLen < 3 || pos + totalLen > bytes.length) break;

    var frame = e2eParseEbyteFrame(bytes.slice(pos, pos + totalLen));
    if (frame && frame.valid && frame.type === 0x82 && frame.code === 0x0A) {
      if (e2eHandleZbAttrReportFrame(frame.data, ts)) handled = true;
    }
    pos += totalLen;
  }
  return handled;
}

function e2eParseEbyteFrame(bytes) {
  if (!bytes || bytes.length < 5 || bytes[0] !== 0x55) return null;
  var length  = bytes[1];
  var total   = 2 + length;
  if (total > bytes.length) return null;
  var type    = bytes[2];
  var code    = bytes[3];
  var dataLen = length - 3;
  if (dataLen < 0) dataLen = 0;
  var data    = bytes.slice(4, 4 + dataLen);
  var chkIdx  = 4 + dataLen;
  var rcvChk  = (chkIdx < bytes.length) ? bytes[chkIdx] : -1;
  var calcChk = type ^ code;
  for (var i = 0; i < data.length; i++) calcChk ^= data[i];
  return { type: type, code: code, data: data, valid: calcChk === rcvChk };
}

function e2eHandleZbAttrReportFrame(data, ts) {
  /* Layout copied from zigbee_control_widget_v2.js
     ZCL Header (11B) + [NumAttr(1B)] [AttrID(2B LE)] [DataType(1B)] [Value] */
  if (!data || data.length < 15) return false;
  var cluster = ((data[7] << 8) | data[6]).toString(16).toUpperCase();
  while (cluster.length < 4) cluster = '0' + cluster;
  var numAttr = data[11];
  var pos = 12;
  var handled = false;

  for (var i = 0; i < numAttr && pos + 2 < data.length; i++) {
    var attrId = ((data[pos + 1] << 8) | data[pos]).toString(16).toUpperCase();
    while (attrId.length < 4) attrId = '0' + attrId;
    var dataType = data[pos + 2];
    pos += 3;
    if (pos >= data.length) break;

    var parsed = e2eParseZclAttrValue(data, pos, dataType);
    pos += parsed.size;
    if (attrId !== '0000') continue;

    if (cluster === '0402') {
      e2eState.zbTemp = parsed.value / 100.0;
      e2eState.zbTempTs = ts;
      e2eDebug('ZB EVT temp raw=' + parsed.value + ' \u00b0C=' + (parsed.value / 100.0).toFixed(2));
      handled = true;
    } else if (cluster === '0405') {
      e2eState.zbHum = parsed.value / 100.0;
      e2eState.zbHumTs = ts;
      e2eDebug('ZB EVT hum raw=' + parsed.value + ' %=' + (parsed.value / 100.0).toFixed(2));
      handled = true;
    }
  }

  if (handled) e2eMaybeUpdateZigbee();
  return handled;
}

function e2eParseZclAttrValue(data, offset, dataType) {
  if (dataType === 0x21) {
    return { value: (data[offset + 1] << 8) | data[offset], size: 2 };
  }
  if (dataType === 0x29) {
    var v = (data[offset + 1] << 8) | data[offset];
    if (v > 32767) v -= 65536;
    return { value: v, size: 2 };
  }
  return { value: data[offset] || 0, size: 1 };
}

function e2eParseHexAttrValue(valueHex, dataType) {
  var s = String(valueHex || '').replace(/\s+/g, '').toUpperCase();
  if (dataType === 0x21 && s.length >= 4) {
    var v = parseInt(s.substring(2, 4) + s.substring(0, 2), 16);
    return isNaN(v) ? null : { value: v };
  }
  if (dataType === 0x29 && s.length >= 4) {
    var v2 = parseInt(s.substring(2, 4) + s.substring(0, 2), 16);
    if (isNaN(v2)) return null;
    if (v2 > 32767) v2 -= 65536;
    return { value: v2 };
  }
  return null;
}

/* ── Zigbee raw-hex fallback parser ────────────────────────────────────
   Keep the older heuristic as a fallback for older/raw gateway formats that
   do not align to full Ebyte frame boundaries. */

function e2eParseZbHexFrame(line) {
  /* Pull the byte payload after the CFZB:N:EVT: marker.                 */
  var m = line.match(/CFZB:\d+:EVT:(?:\d+\/\d+:)?([\s0-9A-Fa-f]+)/i);
  if (!m) return null;
  var tokens = m[1].trim().split(/\s+/);
  var bytes = [];
  for (var i = 0; i < tokens.length; i++) {
    if (!/^[0-9A-Fa-f]{1,2}$/.test(tokens[i])) return null;
    var v = parseInt(tokens[i], 16);
    if (isNaN(v) || v < 0 || v > 255) return null;
    bytes.push(v);
  }
  if (bytes.length < 8) return null;

  /* Scan for cluster id (LE) followed by matching data type             */
  for (var p = 0; p + 4 < bytes.length; p++) {
    var cluster = bytes[p] | (bytes[p+1] << 8);
    var expectedType, signed;
    if      (cluster === 0x0402) { expectedType = 0x29; signed = true;  }
    else if (cluster === 0x0405) { expectedType = 0x21; signed = false; }
    else continue;

    var stop = Math.min(p + 12, bytes.length - 2);
    for (var q = p + 2; q < stop; q++) {
      if (bytes[q] !== expectedType) continue;
      var raw = bytes[q+1] | (bytes[q+2] << 8);
      if (signed && (raw & 0x8000)) raw -= 0x10000;
      return {
        cluster: cluster,
        raw:     raw,
        value:   raw / 100.0,
        kind:    (cluster === 0x0402) ? 'temp' : 'hum'
      };
    }
  }
  return null;
}

/* ── Zigbee composite update ──────────────────────────────────────────── */

function e2eMaybeUpdateZigbee() {
  var humTs = e2eState.zbHumTs || 0;
  var tempTs = e2eState.zbTempTs || 0;
  var hasHum = e2eState.zbHum !== null;
  var hasFreshTemp = e2eState.zbTemp !== null && humTs && tempTs && Math.abs(humTs - tempTs) <= 15000;
  var chosen = null;

  if (hasFreshTemp) {
    var legacyTs = e2eDecodeZbLegacyTs(e2eState.zbTemp, e2eState.zbHum);
    var legacyServerTs = Math.max(tempTs, humTs);
    if (legacyTs !== null) {
      var legacyDelay = legacyServerTs - legacyTs;
      if (legacyDelay >= 0 && legacyDelay < 300000) {
        chosen = { nodeTs: legacyTs, serverTs: legacyServerTs, delay: legacyDelay, mode: 'legacy temp+hum' };
      }
    }
  }

  if (!chosen && hasHum && humTs) {
    var humOnlyTs = e2eDecodeZbHumOnlyTs(e2eState.zbHum, humTs);
    if (humOnlyTs !== null) {
      var humOnlyDelay = humTs - humOnlyTs;
      if (humOnlyDelay >= 0 && humOnlyDelay < 300000) {
        chosen = { nodeTs: humOnlyTs, serverTs: humTs, delay: humOnlyDelay, mode: 'humidity-only' };
      } else if (humOnlyDelay < 0) {
        e2eDebug('ZB humidity-only rejected future nodeTs=' + humOnlyTs + ' delay=' + humOnlyDelay + 'ms');
      }
    }
  }

  if (!chosen) return;
  e2eDebug('ZB ' + chosen.mode + ' nodeTs=' + chosen.nodeTs + ' delay=' + chosen.delay + 'ms');
  e2eUpdateProto('zigbee', chosen.delay, chosen.nodeTs, chosen.serverTs);
}

/* ── Decode helpers ──────────────────────────────────────────────────────── */

function e2eDecodeHexTs(hexStr) {
  if (!hexStr || hexStr.length < 16) return null;
  var s = String(hexStr).replace(/\s/g, '').toUpperCase();
  if (s.length < 16) return null;
  var lo32 = 0, hi32 = 0;
  for (var i = 0; i < 4; i++) {
    var b = parseInt(s.slice(i*2, i*2+2), 16);
    if (isNaN(b)) return null;
    lo32 |= (b << (i*8));
  }
  for (var i = 0; i < 4; i++) {
    var b2 = parseInt(s.slice(8+i*2, 10+i*2), 16);
    if (isNaN(b2)) return null;
    hi32 |= (b2 << (i*8));
  }
  lo32 = lo32 >>> 0;
  hi32 = hi32 >>> 0;
  if (hi32 === 0 && lo32 === 0) return null;
  return hi32 * 4294967296 + lo32;
}

function e2eDecodeZbLegacyTs(tempC, humRh) {
  if (tempC === null || tempC === undefined || humRh === null || humRh === undefined) return null;
  var lo = (Math.round(tempC * 100.0)) & 0xFFFF;
  var hi = (Math.round(humRh  * 100.0)) & 0xFFFF;
  var sec = (hi * 65536) + lo;
  if (sec < 1000000000 || sec > 4294967295) return null;
  return sec * 1000;
}

function e2eDecodeZbHumOnlyTs(humRh, serverTs) {
  if (humRh === null || humRh === undefined || !serverTs) return null;
  var lo16 = (Math.round(humRh * 100.0)) & 0xFFFF;
  var approxMs = Math.round(serverTs);
  if (approxMs < 1000000000000 || approxMs > 9000000000000) return null;

  var baseWindow = Math.floor(approxMs / 65536);
  var bestTs = null;
  var bestDelta = Number.POSITIVE_INFINITY;

  for (var i = -1; i <= 1; i++) {
    var ts = (baseWindow + i) * 65536 + lo16;
    if (ts < 1000000000000 || ts > 9000000000000) continue;
    var delta = Math.abs(ts - approxMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestTs = ts;
    }
  }

  return bestTs;
}

/* Try to extract printable text from a value that may be hex-encoded by the
   gateway when crossing MQTT bridges. Falls back to the original string.   */
function e2eDecodeText(s) {
  if (!s) return '';
  s = String(s);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length >= 4) {
    /* Heuristic: if all hex AND length > 32 (too long for raw 8-byte ts),
       decode as ASCII text. Pure-16 hex was already handled above.        */
    if (s.length !== 16) {
      var out = '';
      for (var i = 0; i < s.length; i += 2) {
        out += String.fromCharCode(parseInt(s.substr(i, 2), 16));
      }
      /* Only accept if mostly printable */
      var printable = 0;
      for (var k = 0; k < out.length; k++) {
        var c = out.charCodeAt(k);
        if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13) printable++;
      }
      if (printable / out.length > 0.7) return out;
    }
  }
  return s;
}

function e2eSplit(s) {
  if (!s) return [];
  s = String(s).replace(/(\\x1e|\\x1E)/g, '\n');
  return s.split(/\x1e|\n|\r/).map(function (l) { return l.trim(); }).filter(Boolean);
}

function e2eGuessProtoFromKey(keyLower) {
  if (keyLower.indexOf('ble') >= 0)  return 'ble';
  if (keyLower.indexOf('lora') >= 0) return 'lora';
  if (keyLower.indexOf('lr') >= 0)   return 'lora';
  if (keyLower.indexOf('zb') >= 0 || keyLower.indexOf('zigbee') >= 0) return 'zigbee';
  return null;
}

/* ── Clock sync (HTTP time API → estimate RPi drift) ─────────────────── */

function e2eSyncRealUtc() {
  /* Sources tried in order — first to succeed wins. All must support CORS. */
  var sources = [
    {
      url: 'https://worldtimeapi.org/api/timezone/Etc/UTC',
      parse: function (txt) {
        var j = JSON.parse(txt);
        if (typeof j.unixtime === 'number') return j.unixtime * 1000;
        return null;
      }
    },
    {
      url: 'https://timeapi.io/api/Time/current/zone?timeZone=UTC',
      parse: function (txt) {
        var j = JSON.parse(txt);
        if (j.dateTime) {
          /* dateTime is local-naive ISO without Z; treat as UTC */
          return new Date(j.dateTime + 'Z').getTime();
        }
        return null;
      }
    },
    {
      /* Cloudflare trace returns plain text with "ts=<epoch>"          */
      url: 'https://1.1.1.1/cdn-cgi/trace',
      parse: function (txt) {
        var m = String(txt).match(/^ts=([0-9.]+)/m);
        if (m) return Math.round(parseFloat(m[1]) * 1000);
        return null;
      }
    }
  ];

  var idx = 0;
  function tryNext() {
    if (idx >= sources.length) {
      e2eDebug('TIMESYNC: all sources failed — using browser clock as-is');
      e2eTimeSync.syncedAt    = Date.now();
      e2eTimeSync.realUtcOffset = 0;
      return;
    }
    var src = sources[idx++];
    var t0 = Date.now();
    fetch(src.url, { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var t1 = Date.now();
        var serverMs = src.parse(txt);
        if (!serverMs) throw new Error('parse failed');
        /* Assume request and response paths are symmetric — best estimate of
           "server time at midpoint of RTT" pins to browser midpoint clock.  */
        var rtt = t1 - t0;
        var browserAtMid = t0 + rtt / 2;
        e2eTimeSync.realUtcOffset = serverMs - browserAtMid;
        e2eTimeSync.syncedAt      = Date.now();
        e2eTimeSync.sourceUrl     = src.url;
        e2eTimeSync.rpiSamples    = [];   /* reset rpi drift estimate */
        e2eTimeSync.rpiDrift      = 0;
        e2eDebug('TIMESYNC ok (' + src.url.replace(/^https?:\/\//, '') +
                 '): browser offset = ' + Math.round(e2eTimeSync.realUtcOffset) +
                 ' ms, rtt = ' + rtt + ' ms');
      })
      .catch(function (e) {
        e2eDebug('TIMESYNC ' + src.url.replace(/^https?:\/\//, '') +
                 ' failed: ' + (e && e.message ? e.message : e));
        tryNext();
      });
  }
  tryNext();
}

function e2eUpdateRpiDrift(serverTs) {
  if (!e2eTimeSync.syncedAt) return;
  /* Real UTC at the moment we just received the telemetry message.
     Approximation: assume websocket delivery RTT ≪ measurement precision.   */
  var realUtcNow = Date.now() + e2eTimeSync.realUtcOffset;
  var sample = serverTs - realUtcNow;
  e2eTimeSync.rpiSamples.push(sample);
  if (e2eTimeSync.rpiSamples.length > E2E_RPI_SAMPLES) e2eTimeSync.rpiSamples.shift();
  /* Median is more robust to network/JS-event-loop jitter than mean.        */
  var sorted = e2eTimeSync.rpiSamples.slice().sort(function (a, b) { return a - b; });
  e2eTimeSync.rpiDrift = sorted[Math.floor(sorted.length / 2)];
}

/* ── Core update ─────────────────────────────────────────────────────────── */

function e2eUpdateProto(proto, rawDelayMs, nodeTs, serverTs) {
  var delayMs = rawDelayMs;
  if (e2eTimeSync.enabled) {
    e2eUpdateRpiDrift(serverTs);
    /* Apply server-clock-drift correction only after we have ≥3 samples — a
       single noisy sample would zero everything out.                        */
    if (e2eTimeSync.syncedAt && e2eTimeSync.rpiSamples.length >= 3) {
      delayMs = rawDelayMs - e2eTimeSync.rpiDrift;
    }
    /* Guard absurd post-correction values (e.g. clock jumps during sync).   */
    if (delayMs < -10000 || delayMs > 600000) {
      e2eDebug('drift correction rejected: raw=' + Math.round(rawDelayMs) +
               ' drift=' + Math.round(e2eTimeSync.rpiDrift) +
               ' → corrected=' + Math.round(delayMs) + ' (keeping raw)');
      delayMs = rawDelayMs;
    }
  }

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
  if (el) {
    var driftStr = (e2eTimeSync.enabled && e2eTimeSync.syncedAt && e2eTimeSync.rpiSamples.length >= 3)
      ? ' (RPi drift ' + (e2eTimeSync.rpiDrift >= 0 ? '+' : '') +
        Math.round(e2eTimeSync.rpiDrift) + ' ms)'
      : '';
    el.textContent = 'Last: ' + new Date().toLocaleTimeString() + driftStr;
  }
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

/* ── In-widget debug log (visible to help diagnose telemetry format) ──── */

function e2eDebug(msg) {
  var now = new Date().toTimeString().substr(0, 8);
  e2eState.debug.unshift('[' + now + '] ' + msg);
  if (e2eState.debug.length > E2E_DEBUG_LINES) e2eState.debug.pop();
  var el = document.getElementById('e2e-debug-log');
  if (el) el.textContent = e2eState.debug.join('\n');
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
  c.fillText('← last ' + E2E_MAX_CHART_PTS + ' readings →', PL + W2 / 2, H - 4);
}

/* ── Utility ─────────────────────────────────────────────────────────────── */

function e2eSetText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}
