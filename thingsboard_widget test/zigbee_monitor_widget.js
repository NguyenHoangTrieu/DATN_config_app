/* =====================================================================
   DA2 Zigbee Attribute Monitor — ThingsBoard Latest Values Widget JS
   Datasource: Gateway device → key "data" (Latest Telemetry)
   No RPC — purely passive monitoring widget.

   HEX frame format (Ebyte E180-ZG120B native mode):
     [0x55][Length][Type][Code][Data...][Checksum]
     Relevant async events:
       Type=0x80, Code=0x03 — Node Join Notify
       Type=0x80, Code=0x05 — Node Announce Notify
       Type=0x80, Code=0x06 — Node Leave Notify
       Type=0x82, Code=0x0A — ZCL Attribute Report

   Legacy RPT line format (backward compatibility):
     RPT:<short4>,<ep2>,<cluster4>,<attr4>,<type2>,<value>
     value is a hex string, e.g. "01", "00A0", "0915"

   Known cluster/attribute pairs rendered as readable values:
     0006/0000  On/Off          bool (0=OFF, nonzero=ON)
     0008/0000  Current Level   uint8 0-254 → percentage
     0402/0000  Temperature     int16 × 0.01 °C
     0300/0000  Hue             uint8 (0-254 → 0-360°)
     0300/0001  Saturation      uint8 (0-254 → %)
     0300/0007  Color X         uint16 (CIE 1931 x)
     0300/0008  Color Y         uint16 (CIE 1931 y)

   Node names / IEEE addresses are loaded from localStorage key 'da2_zb_v2'
   written by the companion zigbee_control_widget_v2.js.
   ===================================================================== */

var zbmState = {
  devices: {},   /* shortAddr → { ieee, type, attrs: {'CL/AT': {icon,label,html,raw,ts}}, lastTs, rxCount } */
  totalRx: 0,
  nodes:   {}    /* loaded from da2_zb_v2 localStorage */
};

/* Attribute reports less frequent than BLE NOTIFY — give 2 min stale window */
var ZBM_STALE_MS = 120000;

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
var _zbmStaleTimer = null;

self.onInit = function () {
  loadNodes();
  renderGrid();
  _zbmStaleTimer = setInterval(function () {
    var now     = Date.now();
    var changed = false;
    var keys    = Object.keys(zbmState.devices);
    for (var i = 0; i < keys.length; i++) {
      var d = zbmState.devices[keys[i]];
      if (d.lastTs && (now - d.lastTs) > ZBM_STALE_MS) {
        delete zbmState.devices[keys[i]];
        changed = true;
      }
    }
    if (changed) renderGrid();
  }, 30000);
};

self.onDestroy = function () {
  if (_zbmStaleTimer) { clearInterval(_zbmStaleTimer); _zbmStaleTimer = null; }
};

/* ═══════════════════════════════════════════════════════════════════
   Cross-widget event bridge via window CustomEvent
   Control widget listens for 'da2_zb_event' events dispatched here.
   Event detail: { type: string, payload: object }
   Types emitted:
     'nodeJoin'     — { short, ieee }
     'nodeAnnounce' — { short, ieee, ep }
     'nodeLeave'    — { ieee }
     'attrReport'   — { short, ep, cluster, attr, value }
   ═══════════════════════════════════════════════════════════════════ */
function zbmEmit(type, payload) {
  try {
    window.dispatchEvent(new CustomEvent('da2_zb_event', {
      detail: { type: type, payload: payload }
    }));
  } catch (e) { /* CustomEvent not supported — ignore */ }
}

/* WebSocket push fires every time new telemetry arrives */
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
      /* Skip replayed stale data on widget reload */
      if (dataTs && (now - dataTs) > ZBM_STALE_MS) continue;
      var decoded = decodeHex(raw);
      splitLines(decoded).forEach(function (line) {
        parseLine(line, dataTs || now);
        /* Bridge: forward raw lines to control widget via localStorage */
        try {
          localStorage.setItem('da2_zb_bridge',
            JSON.stringify({ ts: dataTs || now, line: line }));
        } catch (be) { /* ignore storage errors */ }
      });
    }
  } catch (e) { /* silent — monitor widget must not crash */ }
};

/* ═══════════════════════════════════════════════════════════════════
   Ebyte HEX Frame Parser
   Frame: [0x55][Length][Type][Code][Data...][Checksum]
   Length = N(data) + 3, Checksum = XOR(Type, Code, Data[0..N-1])
   ═══════════════════════════════════════════════════════════════════ */

/**
 * parseEbyteFrame — parse space-separated hex string into frame parts.
 * @param {string} hexStr  e.g. "55 0D 80 03 AA BB ..."
 * @returns {object|null} { type, code, data[], valid }
 */
function parseEbyteFrame(hexStr) {
  var bytes = hexStr.trim().split(/\s+/).map(function (b) { return parseInt(b, 16); });
  if (bytes.length < 4 || bytes[0] !== 0x55) return null;
  var length  = bytes[1];
  var type    = bytes[2];
  var code    = bytes[3];
  var dataLen = length - 3;
  if (dataLen < 0) dataLen = 0;
  var data    = bytes.slice(4, 4 + dataLen);
  var chkIdx  = 4 + dataLen;
  var rcvChk  = (chkIdx < bytes.length) ? bytes[chkIdx] : -1;
  var calcChk = type ^ code;
  for (var i = 0; i < data.length; i++) calcChk ^= data[i];
  return { type: type, code: code, data: data, valid: (calcChk === rcvChk) };
}

/** Parse ZCL attribute value from data array at given offset */
function parseZclAttrValue(data, offset, dataType) {
  if (dataType === 0x10) { /* bool */
    return { val: data[offset], hex: pad2(data[offset]), size: 1 };
  } else if (dataType === 0x20) { /* uint8 */
    return { val: data[offset], hex: pad2(data[offset]), size: 1 };
  } else if (dataType === 0x21) { /* uint16 */
    var v = (data[offset + 1] << 8) | data[offset];
    return { val: v, hex: pad4(v), size: 2 };
  } else if (dataType === 0x29) { /* int16 */
    var v2 = (data[offset + 1] << 8) | data[offset];
    if (v2 > 32767) v2 -= 65536;
    return { val: v2, hex: pad4(v2 & 0xFFFF), size: 2 };
  } else if (dataType === 0x30) { /* enum8 */
    return { val: data[offset], hex: pad2(data[offset]), size: 1 };
  }
  return { val: data[offset] || 0, hex: pad2(data[offset] || 0), size: 1 };
}

function pad2(n) { return ('0' + (Math.round(n) & 0xFF).toString(16)).slice(-2).toUpperCase(); }
function pad4(n) { return ('000' + (n & 0xFFFF).toString(16)).slice(-4).toUpperCase(); }

/* ═══════════════════════════════════════════════════════════════════
   Parse one telemetry line — supports both HEX frames and legacy RPT
   ═══════════════════════════════════════════════════════════════════ */
function parseLine(line, ts) {
  /* ── Check for :EVT: wrapper with HEX frame inside ── */
  var evtM = line.match(/:EVT:((?:[0-9A-Fa-f]{2}\s*)+)$/i);
  if (evtM) {
    var hexData = evtM[1].trim();
    if (/^55\b/i.test(hexData)) {
      parseHexFrame(hexData, ts);
      return;
    }
    /* Legacy AT text — decode and re-parse */
    var inner = decodeHexBytes(hexData.replace(/\s+/g, ''));
    splitLines(inner).forEach(function (sub) { parseLine(sub, ts); });
    return;
  }

  /* ── Direct HEX frame (starts with "55 ") ── */
  if (/^55\s+[0-9A-Fa-f]{2}/i.test(line)) {
    parseHexFrame(line, ts);
    return;
  }

  /* ── Legacy RPT text format ── */
  var m = line.match(/^RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),(.*)/i);
  if (!m) return;

  var short   = m[1].toUpperCase();
  var ep      = m[2].toUpperCase();
  var cluster = m[3].toUpperCase();
  var attr    = m[4].toUpperCase();
  var value   = m[6].trim();

  updateDeviceAttr(short, ep, cluster, attr, value, ts);
}

/* ═══════════════════════════════════════════════════════════════════
   HEX Frame Dispatcher
   ═══════════════════════════════════════════════════════════════════ */
function parseHexFrame(hexStr, ts) {
  var frame = parseEbyteFrame(hexStr);
  if (!frame || !frame.valid) return;

  /* ── 0x80/0x03: Node Join Notify ── */
  if (frame.type === 0x80 && frame.code === 0x03) {
    if (frame.data.length < 13) return;
    var ieee = frame.data.slice(0, 8).reverse().map(function (b) { return pad2(b); }).join('');
    var shortAddr = pad4((frame.data[9] << 8) | frame.data[8]);
    /* Register device so it shows up in the grid */
    ensureDevice(shortAddr, ieee.toUpperCase(), ts);
    /* Notify Control widget immediately */
    zbmEmit('nodeJoin', { short: shortAddr, ieee: ieee.toUpperCase() });
    return;
  }

  /* ── 0x80/0x05: Node Announce Notify ── */
  if (frame.type === 0x80 && frame.code === 0x05) {
    if (frame.data.length < 13) return;
    var ieee2 = frame.data.slice(2, 10).reverse().map(function (b) { return pad2(b); }).join('');
    var shortAddr2 = pad4((frame.data[11] << 8) | frame.data[10]);
    var epNum = frame.data[12];
    ensureDevice(shortAddr2, ieee2.toUpperCase(), ts);
    /* Update endpoint if device entry exists */
    var d = zbmState.devices[shortAddr2];
    if (d) d.ep = pad2(epNum);
    /* Notify Control widget with EP info */
    zbmEmit('nodeAnnounce', { short: shortAddr2, ieee: ieee2.toUpperCase(), ep: pad2(epNum) });
    return;
  }

  /* ── 0x80/0x06: Node Leave Notify ── */
  if (frame.type === 0x80 && frame.code === 0x06) {
    if (frame.data.length < 8) return;
    var ieeeLeave = frame.data.slice(0, 8).reverse().map(function (b) { return pad2(b); }).join('').toUpperCase();
    var changed = false;
    Object.keys(zbmState.devices).forEach(function (addr) {
      if (zbmState.devices[addr].ieee === ieeeLeave) {
        delete zbmState.devices[addr];
        changed = true;
      }
    });
    if (changed) renderGrid();
    /* Notify Control widget */
    zbmEmit('nodeLeave', { ieee: ieeeLeave });
    return;
  }

  /* ── 0x82/0x0A: ZCL Attribute Report ── */
  if (frame.type === 0x82 && frame.code === 0x0A) {
    /* ZCL Header (11 bytes):
       [TxMode(1B)] [SrcShortAddr(2B LE)] [SrcPort(1B)] [FrameSeq(1B)]
       [Direction(1B)] [ClusterID(2B LE)] [ManuCode(2B LE)] [SignalStrength(1B)]
       Extended: [NumAttr(1B)] [AttrID(2B LE)] [DataType(1B)] [Value(NB)] ... */
    if (frame.data.length < 15) return;
    var srcAddr = pad4((frame.data[2] << 8) | frame.data[1]);
    var srcPort = pad2(frame.data[3]);
    var cluster = pad4((frame.data[7] << 8) | frame.data[6]);
    var numAttr = frame.data[11];
    var pos     = 12;

    for (var i = 0; i < numAttr && pos + 2 < frame.data.length; i++) {
      var attrId   = pad4((frame.data[pos + 1] << 8) | frame.data[pos]);
      var dataType = frame.data[pos + 2];
      pos += 3;
      if (pos >= frame.data.length) break;
      var parsed = parseZclAttrValue(frame.data, pos, dataType);
      pos += parsed.size;

      updateDeviceAttr(srcAddr, srcPort, cluster, attrId, parsed.hex, ts);
    }
    return;
  }

  /* ── 0x82/0x00: ZCL Read Attribute Response ── */
  if (frame.type === 0x82 && frame.code === 0x00) {
    if (frame.data.length < 16) return;
    var srcAddrR = pad4((frame.data[2] << 8) | frame.data[1]);
    var srcPortR = pad2(frame.data[3]);
    var clusterR = pad4((frame.data[7] << 8) | frame.data[6]);
    var numAttrR = frame.data[11];
    var posR     = 12;

    for (var j = 0; j < numAttrR && posR + 3 < frame.data.length; j++) {
      var attrIdR = pad4((frame.data[posR + 1] << 8) | frame.data[posR]);
      var statusR = frame.data[posR + 2];
      posR += 3;
      if (statusR !== 0x00 || posR >= frame.data.length) continue;
      var dataTypeR = frame.data[posR];
      posR += 1;
      if (posR >= frame.data.length) break;
      var parsedR = parseZclAttrValue(frame.data, posR, dataTypeR);
      posR += parsedR.size;

      updateDeviceAttr(srcAddrR, srcPortR, clusterR, attrIdR, parsedR.hex, ts);
    }
    return;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Shared: update device attribute and re-render
   ═══════════════════════════════════════════════════════════════════ */
function updateDeviceAttr(short, ep, cluster, attr, value, ts) {
  var key  = cluster + '/' + attr;
  var info = formatAttr(cluster, attr, value);
  if (!info) return; /* unknown / uninteresting attribute — skip */

  /* Lazy-create device entry */
  if (!zbmState.devices[short]) {
    var node = resolveNode(short);
    zbmState.devices[short] = {
      ieee:    node ? node.ieee : '????????????????',
      type:    node ? node.type : 'Unknown',
      attrs:   {},
      lastTs:  ts,
      rxCount: 0
    };
  }

  var d = zbmState.devices[short];
  /* Refresh node info (control widget may have added it since widget init) */
  var node2 = resolveNode(short);
  if (node2) { d.ieee = node2.ieee || d.ieee; d.type = node2.type || d.type; }

  d.attrs[key] = info;
  d.lastTs     = ts;
  d.rxCount++;
  zbmState.totalRx++;

  /* Notify Control widget of attribute report so it can sync state */
  zbmEmit('attrReport', { short: short, ep: ep, cluster: cluster, attr: attr, value: value });

  renderGrid();
  setPill('active', 'Live');
  var rc = ge('zbm-rx-count'); if (rc) rc.textContent = zbmState.totalRx + ' reports received';
  var lt = ge('zbm-last-ts');  if (lt) lt.textContent  = 'Last: ' + new Date().toLocaleTimeString();
}

/** Ensure a device entry exists (e.g. from node join/announce events) */
function ensureDevice(short, ieee, ts) {
  if (!zbmState.devices[short]) {
    var node = resolveNode(short);
    zbmState.devices[short] = {
      ieee:    ieee || (node ? node.ieee : '????????????????'),
      type:    node ? node.type : 'Unknown',
      attrs:   {},
      lastTs:  ts,
      rxCount: 0
    };
  } else {
    var d = zbmState.devices[short];
    if (ieee && ieee !== '????????????????') d.ieee = ieee;
    d.lastTs = ts;
  }
  renderGrid();
}

/* ═══════════════════════════════════════════════════════════════════
   Attribute formatters
   ═══════════════════════════════════════════════════════════════════ */
var ATTR_META = {
  '0006/0000': { icon: '💡', label: 'On/Off'      },
  '0008/0000': { icon: '🔆', label: 'Level'       },
  '0402/0000': { icon: '🌡', label: 'Temperature' },
  '0405/0000': { icon: '💧', label: 'Humidity'    },
  '0300/0000': { icon: '🎨', label: 'Hue'         },
  '0300/0001': { icon: '🎨', label: 'Saturation'  },
  '0300/0007': { icon: '🎨', label: 'Color X'     },
  '0300/0008': { icon: '🎨', label: 'Color Y'     }
};

function formatAttr(cluster, attr, value) {
  var key  = cluster + '/' + attr;
  var meta = ATTR_META[key];
  if (!meta) return null;

  var raw  = parseInt(value, 16);
  var html;

  if (cluster === '0006' && attr === '0000') {
    var on = (raw !== 0);
    html = on ? '<span class="zbm-badge-on">● ON</span>'
               : '<span class="zbm-badge-off">○ OFF</span>';

  } else if (cluster === '0008' && attr === '0000') {
    var pct = Math.round(raw / 254 * 100);
    html = '<div class="zbm-level-wrap">' +
             '<div class="zbm-level-bar"><div class="zbm-level-fill" style="width:' + pct + '%"></div></div>' +
             '<span class="zbm-level-pct">' + pct + '%</span>' +
           '</div>';

  } else if (cluster === '0402' && attr === '0000') {
    /* ZCL temperature is int16 in 0.01 °C */
    if (raw > 32767) raw -= 65536;
    html = (raw / 100).toFixed(1) + ' °C';

  } else if (cluster === '0405' && attr === '0000') {
    /* ZCL Relative Humidity Measurement: uint16 in 0.01 %RH */
    html = (raw / 100).toFixed(1) + ' %RH';

  } else if (cluster === '0300' && attr === '0000') {
    /* Hue: 0-254 → 0-360 degrees */
    html = Math.round(raw / 254 * 360) + '°';

  } else if (cluster === '0300' && attr === '0001') {
    html = Math.round(raw / 254 * 100) + '%';

  } else {
    html = '0x' + value.toUpperCase().slice(-4) + ' (' + raw + ')';
  }

  return { icon: meta.icon, label: meta.label, html: html, raw: value };
}

/* ═══════════════════════════════════════════════════════════════════
   Render card grid
   ═══════════════════════════════════════════════════════════════════ */
function renderGrid() {
  var el   = ge('zbm-grid');
  var hint = ge('zbm-hint');
  if (!el) return;

  var devKeys = Object.keys(zbmState.devices);

  if (!devKeys.length) {
    if (hint) hint.style.display = '';
    var old = el.querySelectorAll('.zbm-card');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    setPill('idle', 'Waiting');
    return;
  }
  if (hint) hint.style.display = 'none';

  /* Remove cards whose device has gone stale and been deleted */
  var existing = el.querySelectorAll('.zbm-card');
  for (var j = 0; j < existing.length; j++) {
    var addr = existing[j].getAttribute('data-addr');
    if (!zbmState.devices[addr]) existing[j].parentNode.removeChild(existing[j]);
  }

  /* Add / update one card per device */
  devKeys.forEach(function (short) {
    var d      = zbmState.devices[short];
    var cardId = 'zbm-card-' + short;
    var card   = ge(cardId);

    var age    = d.lastTs ? (Math.round((Date.now() - d.lastTs) / 1000) + 's ago') : '—';
    var typeIcon = { 'Router': '⬡', 'End Device': '◆', 'Coordinator': '★' }[d.type] || '🔶';

    /* Resolve device name from runtime state or persisted localStorage */
    var node    = resolveNode(short);
    var devName = d.name || (node ? node.name : null);
    /* Sync name back into device state so subsequent renders are instant */
    if (!d.name && devName) d.name = devName;

    var nameHtml = devName
      ? '<div class="zbm-card-name">' + escHtml(devName) + '</div>'
      : '';

    var attrKeys = Object.keys(d.attrs);
    var attrsHtml;
    if (!attrKeys.length) {
      attrsHtml = '<div class="zbm-attr-row"><span class="zbm-attr-label" style="font-style:italic">No attributes yet</span></div>';
    } else {
      attrsHtml = attrKeys.map(function (k) {
        var a = d.attrs[k];
        return '<div class="zbm-attr-row">' +
          '<span class="zbm-attr-icon">' + a.icon + '</span>' +
          '<span class="zbm-attr-label">' + escHtml(a.label) + '</span>' +
          '<span class="zbm-attr-val">' + a.html + '</span>' +
          '</div>';
      }).join('');
    }

    var inner =
      '<div class="zbm-card-header">' +
        '<span class="zbm-card-icon">' + typeIcon + '</span>' +
        '<div class="zbm-card-info">' +
          nameHtml +
          '<div class="zbm-card-addr">0x' + short + '</div>' +
          '<div class="zbm-card-type">' + escHtml(d.type) + '</div>' +
          '<div class="zbm-card-ieee">' + escHtml(d.ieee) + '</div>' +
        '</div>' +
        '<div class="zbm-card-meta">' +
          '<span class="zbm-card-age">' + age + '</span>' +
          '<span class="zbm-card-cnt">' + d.rxCount + ' rpt</span>' +
        '</div>' +
      '</div>' +
      attrsHtml;

    if (card) {
      card.innerHTML = inner;
    } else {
      card = document.createElement('div');
      card.id        = cardId;
      card.className = 'zbm-card';
      card.setAttribute('data-addr', short);
      card.innerHTML = inner;
      el.appendChild(card);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */
function loadNodes() {
  try {
    var raw = localStorage.getItem('da2_zb_v2');
    if (raw) {
      var s = JSON.parse(raw);
      if (s.nodes) zbmState.nodes = s.nodes;
    }
  } catch (e) {}
}

function resolveNode(short) {
  loadNodes();   /* refresh each call — control widget may have updated localStorage */
  return zbmState.nodes[short] || null;
}

function decodeHex(val) {
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

/** Decode concatenated hex bytes (no spaces) to ASCII string */
function decodeHexBytes(hex) {
  var out = '';
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(b)) out += String.fromCharCode(b);
  }
  return out;
}

function splitLines(s) {
  if (!s) return [];
  return s.split(/\x1e|\n/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function setPill(st, txt) {
  var p = ge('zbm-pill');
  if (p) p.setAttribute('data-state', st);
  setEl('zbm-pill-txt', txt);
}

function ge(id) { return document.getElementById(id); }
function setEl(id, html) { var el = ge(id); if (el) el.innerHTML = html; }
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
