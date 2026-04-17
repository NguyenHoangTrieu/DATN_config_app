/* =====================================================================
   DA2 Zigbee Attribute Monitor — ThingsBoard Latest Values Widget JS
   Datasource: Gateway device → key "data" (Latest Telemetry)
   No RPC — purely passive monitoring widget.

   RPT line format (from zigbee_control_widget_v2 / firmware):
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
      splitLines(decoded).forEach(function (line) { parseLine(line, dataTs || now); });
    }
  } catch (e) { /* silent — monitor widget must not crash */ }
};

/* ═══════════════════════════════════════════════════════════════════
   Parse one telemetry line
   ═══════════════════════════════════════════════════════════════════ */
function parseLine(line, ts) {
  /* RPT:<short4>,<ep2>,<cluster4>,<attr4>,<type2>,<value> */
  var m = line.match(/^RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),(.*)/i);
  if (!m) return;

  var short   = m[1].toUpperCase();
  var cluster = m[3].toUpperCase();
  var attr    = m[4].toUpperCase();
  var value   = m[6].trim();
  var key     = cluster + '/' + attr;

  var info = formatAttr(cluster, attr, value);
  if (!info) return;  /* unknown / uninteresting attribute — skip */

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

  renderGrid();
  setPill('active', 'Live');
  var rc = ge('zbm-rx-count'); if (rc) rc.textContent = zbmState.totalRx + ' reports received';
  var lt = ge('zbm-last-ts');  if (lt) lt.textContent  = 'Last: ' + new Date().toLocaleTimeString();
}

/* ═══════════════════════════════════════════════════════════════════
   Attribute formatters
   ═══════════════════════════════════════════════════════════════════ */
var ATTR_META = {
  '0006/0000': { icon: '💡', label: 'On/Off'      },
  '0008/0000': { icon: '🔆', label: 'Level'       },
  '0402/0000': { icon: '🌡', label: 'Temperature' },
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
