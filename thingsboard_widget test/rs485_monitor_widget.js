var RM_STORAGE_KEY = "da2_rs485_last_data_v1";
var RM_LOG_LIMIT = 260;

var rmState = {
  lastTs: 0,
  lastFrameHex: "-",
  analogTs: 0,
  analog: { AIN0: null, AIN1: null, AIN2: null, AIN3: null },
  logLines: []
};

self.onInit = function () {
  bindUi();
  renderAll();
  logInfo("RS485 monitor ready");
};

self.onDataUpdated = function () {
  try {
    var rows = collectTelemetryRows(self.ctx && self.ctx.data, "data");
    if (!rows.length) return;

    for (var i = 0; i < rows.length; i++) {
      var ts = toIntTimestamp(rows[i].ts);
      var raw = rows[i].value;
      publishBridge(ts, raw, "");
      processTelemetry(raw, ts);
    }
  } catch (e) {
    logErr("onDataUpdated error: " + errText(e));
  }
};

function bindUi() {
  var btn = ge("rm-clear");
  if (btn && !btn.getAttribute("data-rm-bound")) {
    btn.setAttribute("data-rm-bound", "1");
    btn.addEventListener("click", function (evt) {
      evt.preventDefault();
      rmState.logLines = [];
      renderLog();
    });
  }
}

function processTelemetry(rawValue, ts) {
  var bytes = decodeTelemetryBytes(rawValue);
  if (!bytes || !bytes.length) return;

  rmState.lastTs = ts;

  var extracted = extractValidModbusFrame(bytes);
  if (extracted && extracted.prefixText) {
    logInfo(extracted.prefixText);
  }
  var frameBytes = extracted ? extracted.frame : bytes;

  if (isPrintableAscii(frameBytes)) {
    var text = asciiBytesToString(frameBytes).trim();
    if (!text) return;
    logRx(text);
    setPill("warn", "ASCII");
    setText("rm-last-ts", humanClock(ts));
    setText("rm-last-frame", text);
    return;
  }

  var parsed = parseModbusFrame(frameBytes);
  if (!parsed) return;

  var frameHex = bytesToHex(frameBytes);
  rmState.lastFrameHex = frameHex;
  setText("rm-last-ts", humanClock(ts));
  setText("rm-last-frame", frameHex);

  publishBridge(ts, rawValue, frameHex);

  if (!parsed.validCrc) {
    setPill("err", "CRC FAIL");
    logWarn("CRC fail: " + frameHex);
    return;
  }

  setPill("ok", "Live");
  logRx("MODBUS [0x" + toHex(parsed.slave, 2) + "] FC=0x" + toHex(parsed.functionCode, 2) + " len=" + frameBytes.length);

  if (parsed.functionCode === 0x03 && parsed.byteCount === 16) {
    var analog = parseAnalogPayload(parsed.data);
    if (analog) {
      rmState.analog = analog;
      rmState.analogTs = ts;
      renderAnalog();
    }
  }
}

function publishBridge(ts, rawTelemetryValue, frameHex) {
  var packet = {
    ts: toIntTimestamp(ts),
    rawTelemetryValue: String(rawTelemetryValue === undefined || rawTelemetryValue === null ? "" : rawTelemetryValue),
    frameHex: frameHex || ""
  };

  try { localStorage.setItem(RM_STORAGE_KEY, JSON.stringify(packet)); } catch (e) {}
  try {
    window.dispatchEvent(new CustomEvent("da2_rs485_last_data", { detail: packet }));
  } catch (e2) {}
}

function renderAll() {
  setPill("warn", "Waiting");
  renderAnalog();
  renderLog();
}

function renderAnalog() {
  renderAnalogOne("AIN0", "rm-ain0", "rm-ain0-meta");
  renderAnalogOne("AIN1", "rm-ain1", "rm-ain1-meta");
  renderAnalogOne("AIN2", "rm-ain2", "rm-ain2-meta");
  renderAnalogOne("AIN3", "rm-ain3", "rm-ain3-meta");
}

function renderAnalogOne(key, valueId, metaId) {
  var value = rmState.analog[key];
  if (typeof value === "number" && isFinite(value)) {
    setText(valueId, value.toFixed(4) + " V");
    setText(metaId, "Updated at " + humanClock(rmState.analogTs));
  } else {
    setText(valueId, "--.-- V");
    setText(metaId, "No sample");
  }
}

function renderLog() {
  var el = ge("rm-log");
  if (!el) return;
  el.innerHTML = rmState.logLines.join("");
  el.scrollTop = el.scrollHeight;
}

function setPill(stateName, text) {
  var el = ge("rm-pill");
  if (!el) return;
  el.setAttribute("data-state", stateName);
  el.textContent = text;
}

function setText(id, text) {
  var el = ge(id);
  if (el) el.textContent = text;
}

function ge(id) { return document.getElementById(id); }

function logInfo(msg) { pushLog("info", msg); }
function logRx(msg) { pushLog("rx", msg); }
function logWarn(msg) { pushLog("warn", msg); }
function logErr(msg) { pushLog("err", msg); }

function pushLog(kind, msg) {
  var cls = "rm-info";
  if (kind === "rx") cls = "rm-rx";
  else if (kind === "warn") cls = "rm-warn";
  else if (kind === "err") cls = "rm-err";

  rmState.logLines.push('<div class="rm-line ' + cls + '"><span class="rm-ts">' + esc(logTime()) + '</span><span>' + esc(msg) + '</span></div>');
  if (rmState.logLines.length > RM_LOG_LIMIT) {
    rmState.logLines = rmState.logLines.slice(rmState.logLines.length - RM_LOG_LIMIT);
  }
  renderLog();
}

function logTime() {
  var d = new Date();
  return humanClock(d.getTime());
}

function errText(e) {
  if (!e) return "Unknown error";
  if (e.message) return e.message;
  return String(e);
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function collectTelemetryRows(payload, preferredKey) {
  var rows = [];

  function pushPair(pair) {
    if (!pair) return;
    if (Array.isArray(pair) && pair.length >= 2) {
      rows.push({ ts: toIntTimestamp(pair[0]), value: pair[1] });
      return;
    }
    if (typeof pair === "object") {
      var ts = pair.ts !== undefined ? pair.ts : (pair.timestamp !== undefined ? pair.timestamp : Date.now());
      if (pair.value !== undefined) rows.push({ ts: toIntTimestamp(ts), value: pair.value });
    }
  }

  function fromSeries(series) {
    if (!series) return;
    if (Array.isArray(series)) {
      for (var i = 0; i < series.length; i++) pushPair(series[i]);
    } else {
      pushPair(series);
    }
  }

  if (!payload) return rows;

  if (Array.isArray(payload)) {
    for (var i = 0; i < payload.length; i++) {
      var item = payload[i];
      if (!item) continue;
      if (Array.isArray(item) && item.length >= 2) pushPair(item);
      else if (item.data !== undefined) fromSeries(item.data);
      else if (preferredKey && item[preferredKey] !== undefined) fromSeries(item[preferredKey]);
    }
    return rows;
  }

  if (typeof payload === "object") {
    if (payload.data !== undefined) fromSeries(payload.data);
    if (preferredKey && payload[preferredKey] !== undefined) fromSeries(payload[preferredKey]);
  }

  return rows;
}

function decodeTelemetryBytes(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if (value.data !== undefined) value = value.data;
    else if (value.result !== undefined) value = value.result;
  }

  var text = String(value);
  if (/^[0-9A-Fa-f\s]+$/.test(text)) {
    var normalized = text.replace(/\s+/g, "");
    if (normalized.length % 2 === 0 && normalized.length > 0) return hexToBytes(normalized);
  }

  var ascii = [];
  for (var i = 0; i < text.length; i++) ascii.push(text.charCodeAt(i) & 0xFF);
  return ascii;
}

function parseModbusFrame(bytes) {
  if (!bytes || bytes.length < 5) return null;
  var payload = bytes.slice(0, bytes.length - 2);
  var crcExpected = crc16Modbus(payload);
  var crcActual = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);

  var parsed = {
    raw: bytes.slice(),
    slave: bytes[0],
    functionCode: bytes[1],
    validCrc: crcExpected === crcActual,
    isException: (bytes[1] & 0x80) !== 0,
    byteCount: null,
    data: [],
    register: null,
    value: null
  };

  if (parsed.functionCode === 0x03 && bytes.length >= 5) {
    parsed.byteCount = bytes[2];
    parsed.data = bytes.slice(3, 3 + parsed.byteCount);
  } else if (parsed.functionCode === 0x06 && bytes.length >= 8) {
    parsed.register = (bytes[2] << 8) | bytes[3];
    parsed.value = (bytes[4] << 8) | bytes[5];
  }
  return parsed;
}

function extractValidModbusFrame(bytes) {
  if (!bytes || bytes.length < 5) return null;

  var direct = parseModbusFrame(bytes);
  if (direct && direct.validCrc) {
    return { frame: bytes.slice(), prefixText: "" };
  }

  for (var i = 0; i <= bytes.length - 5; i++) {
    var fc = bytes[i + 1];
    var totalLen = 0;

    if (fc === 0x03) {
      var byteCount = bytes[i + 2];
      totalLen = 3 + byteCount + 2;
    } else if (fc === 0x06) {
      totalLen = 8;
    } else if ((fc & 0x80) !== 0) {
      totalLen = 5;
    } else {
      continue;
    }

    if (i + totalLen > bytes.length) continue;
    var candidate = bytes.slice(i, i + totalLen);
    var parsed = parseModbusFrame(candidate);
    if (parsed && parsed.validCrc) {
      var prefixText = "";
      if (i > 0) {
        var prefix = bytes.slice(0, i);
        if (isPrintableAscii(prefix)) {
          prefixText = "Prefix stripped: " + asciiBytesToString(prefix).trim();
        }
      }
      return { frame: candidate, prefixText: prefixText };
    }
  }

  return null;
}

function parseAnalogPayload(payload) {
  if (!payload || payload.length < 16) return null;
  return {
    AIN0: parseFloat32BigEndian(payload, 0),
    AIN1: parseFloat32BigEndian(payload, 4),
    AIN2: parseFloat32BigEndian(payload, 8),
    AIN3: parseFloat32BigEndian(payload, 12)
  };
}

function parseFloat32BigEndian(bytes, index) {
  var buffer = new ArrayBuffer(4);
  var view = new DataView(buffer);
  view.setUint8(0, bytes[index]);
  view.setUint8(1, bytes[index + 1]);
  view.setUint8(2, bytes[index + 2]);
  view.setUint8(3, bytes[index + 3]);
  return view.getFloat32(0, false);
}

function crc16Modbus(bytes) {
  var crc = 0xFFFF;
  for (var i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (var bit = 0; bit < 8; bit++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
      else crc = crc >> 1;
    }
  }
  return crc & 0xFFFF;
}

function hexToBytes(hex) {
  var clean = String(hex || "").replace(/[^0-9A-Fa-f]/g, "");
  if (!clean || clean.length % 2 !== 0) return [];
  var bytes = [];
  for (var i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substr(i, 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += toHex(bytes[i], 2);
  return out;
}

function asciiBytesToString(bytes) {
  var text = "";
  for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

function isPrintableAscii(bytes) {
  if (!bytes || !bytes.length) return false;
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b > 126) return false;
  }
  return true;
}

function humanClock(ts) {
  var d = new Date(ts);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function pad2(v) { return v < 10 ? "0" + v : String(v); }

function toHex(value, width) {
  var hex = (value >>> 0).toString(16).toUpperCase();
  while (hex.length < width) hex = "0" + hex;
  return hex;
}

function toIntTimestamp(value) {
  var n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) return Date.now();
  return n;
}
