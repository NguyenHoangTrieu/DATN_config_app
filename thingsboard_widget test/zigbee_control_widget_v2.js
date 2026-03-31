/* =====================================================================
   DA2 Zigbee Gateway Control — ThingsBoard Widget JavaScript v2
   Protocol: CFML:CFZB:<slot>:<AT_command>
   Routing: CF → WAN MCU → ML:CFZB → Zigbee handler → UART to E180-ZG120B

   Follows ble_gatt_app_widget.js patterns:
     - All ge() calls null-guarded via setEl()
     - onInit deferred via setTimeout (widget DOM ready)
     - controlApi null-checked before every RPC
     - onDataUpdated handles async ZB events from telemetry
     - querySelectorAll scoped to _root element
   ===================================================================== */

/* ── App State ── */
var state = {
  slot:         '0',
  shortAddr:    '',
  ep:           '01',
  cluster:      '0006',
  networkUp:    false,
  nodes:        {},          /* { shortAddr: { ieee, type, ep } } */
  selectedNode: null,        /* shortAddr string */
  rpcTimeout:   15000,
  onOffState:   false,
  levelVal:     127,
  hue:          30,
  brightness:   80,
  isWhite:      false,
  tempRaw:      null
};

/* ── Widget-root reference for scoped querySelectorAll ── */
var _root = null;

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard Lifecycle
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  try {
    _root = document.getElementById('zb-app-root');
    loadLocalState();
    syncSlotSelect();
    updateColorUI();
    renderNodeList();
    updateControlPanel();
    updateClusterTabs();
    logInfo('Widget ready — slot ' + state.slot);
    /* Defer network status query so DOM is ready */
    setTimeout(function () { queryNetStatus(); }, 600);
  } catch (e) {
    console.error('[ZB Widget] onInit error:', e);
  }
};

self.onDestroy = function () {};

/* Telemetry uplink — receives async Zigbee events pushed by gateway */
self.onDataUpdated = function () {
  try {
    var data = self.ctx.data;
    if (!data || !data.length) return;
    for (var k = 0; k < data.length; k++) {
      var keyCtx = data[k];
      if (!keyCtx.data || !keyCtx.data.length) continue;
      var latest  = keyCtx.data[keyCtx.data.length - 1];
      var rawVal  = latest[1];
      var decoded = rawVal;

      if (typeof rawVal === 'object' && rawVal !== null && rawVal.data !== undefined) {
        decoded = hexToString(String(rawVal.data));
      } else if (typeof rawVal === 'string') {
        try {
          var parsed = JSON.parse(rawVal);
          if (parsed && parsed.data !== undefined) decoded = hexToString(String(parsed.data));
        } catch (e2) {
          if (/^[0-9A-Fa-f]+$/.test(rawVal) && rawVal.length % 2 === 0) {
            decoded = hexToString(rawVal);
          }
        }
      }

      splitResp(decoded).forEach(function (line) {
        logEvt('Uplink: ' + line);
        handleAsyncEvent(line);
      });
      break;
    }
  } catch (e) {
    logFail('onDataUpdated: ' + (e && e.message ? e.message : e));
  }
};

/* ────────────────────────────────────────────────────────────────────
   RPC / CFML Helpers
   ──────────────────────────────────────────────────────────────────── */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi — assign a target device in widget settings'));
      return;
    }
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err)  { reject(err);  }
      );
  });
}

function stringToHex(str) {
  var hex = '';
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i).toString(16).toUpperCase();
    hex += (code.length === 1 ? '0' : '') + code;
  }
  return hex;
}

function hexToString(hex) {
  var str = '';
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(b)) str += String.fromCharCode(b);
  }
  return str;
}

/**
 * sendCFML — wraps atCmd in CFML:CFZB:<slot>: and sends as hex RPC.
 * atCmd examples:
 *   'AT+CREATENW'
 *   'AT+ZCL=1234,01,0006,01'
 *   'AT+ATTRREAD=1234,01,0402,0000'
 */
function sendCFML(atCmd, timeoutMs) {
  var cmd = 'CFML:CFZB:' + state.slot + ':' + atCmd;
  logTx(cmd);
  var hexCmd = stringToHex(cmd);
  return sendRPC('sendCommand', hexCmd, timeoutMs || state.rpcTimeout)
    .then(function (resp) {
      if (resp) logCFMLResponse(resp);
      return resp;
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      logFail('RPC: ' + msg);
      showToast('⚠ ' + msg);
      throw err;
    });
}

/* ────────────────────────────────────────────────────────────────────
   Response Parsers
   ──────────────────────────────────────────────────────────────────── */
function splitResp(resp) {
  if (!resp) return [];
  if (typeof resp === 'object' && resp !== null) {
    if      (resp.result !== undefined) resp = resp.result;
    else if (resp.data   !== undefined) resp = resp.data;
  }
  var s = String(resp);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0) s = hexToString(s);
  return s.split(/\x1e|\n/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function logCFMLResponse(resp) {
  splitResp(resp).forEach(function (line) {
    if (/^JOIN:|^\+NWINFO:|^FIND:|^RPT:|^LEAVE:|^NODE:|^RSP:/.test(line)) {
      logEvt(line);
      handleAsyncEvent(line);
    } else {
      logOk(line);
    }
  });
}

function handleAsyncEvent(line) {
  var m;

  /* JOIN:<short4>,<ieee16>,<type>  (type: 0=coord,1=router,2=end) */
  m = line.match(/^JOIN:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16}),(\d)/);
  if (m) { addNode(m[1].toUpperCase(), m[2].toUpperCase(), m[3]); return; }

  /* NODE:<short4>,<ieee16>  (device announce) */
  m = line.match(/^NODE:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16})/);
  if (m) { addNode(m[1].toUpperCase(), m[2].toUpperCase(), '?'); return; }

  /* FIND:<short4>,<ieee16>  (auto-find result) */
  m = line.match(/^FIND:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16})/);
  if (m) { addNode(m[1].toUpperCase(), m[2].toUpperCase(), '?'); return; }

  /* +NWINFO:<data>  (network status — extended firmware) */
  m = line.match(/^\+NWINFO:(.*)/);
  if (m) { setEl('net-info-bar', m[1]); setNetState('on'); return; }

  /* LEAVE:<short4>  (node left network) */
  m = line.match(/^LEAVE:([0-9A-Fa-f]{4})/);
  if (m) {
    var gone = m[1].toUpperCase();
    delete state.nodes[gone];
    if (state.selectedNode === gone) { state.selectedNode = null; updateControlPanel(); }
    renderNodeList(); saveLocalState(); return;
  }

  /* RPT:<short>,<ep>,<cluster>,<attr>,<type>,<value>  (attribute report) */
  m = line.match(/^RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),(.*)/i);
  if (m) { handleAttrReport(m[1].toUpperCase(), m[3].toUpperCase(), m[4].toUpperCase(), m[6]); return; }

  /* RSP:<short>,<ep>,...  (ZCL command response) */
  m = line.match(/^RSP:(.*)/);
  if (m) { logOk('ZCL response: ' + m[1]); return; }
}

function handleAttrReport(short, cluster, attr, value) {
  if (short !== state.selectedNode) return;
  if (cluster === '0006' && attr === '0000') {
    var on = (parseInt(value, 16) !== 0);
    state.onOffState = on;
    var tog = ge('onoff-toggle');
    if (tog) tog.checked = on;
    setEl('onoff-status-text', on ? 'ON' : 'OFF');
    var wrap = ge('onoff-icon-wrap');
    if (wrap) wrap.setAttribute('data-on', on ? 'true' : 'false');
    setEl('onoff-icon', on ? '💡' : '🔦');
  }
  if (cluster === '0008' && attr === '0000') {
    state.levelVal = parseInt(value, 16);
    refreshLevelSlider();
  }
  if (cluster === '0402' && attr === '0000') {
    /* ZCL temperature: int16 in 0.01 °C */
    var raw = parseInt(value, 16);
    if (raw > 32767) raw -= 65536;
    var tempC = (raw / 100.0).toFixed(1);
    state.tempRaw = tempC;
    setEl('temp-val', tempC);
  }
}

function parseNetStatus(lines) {
  lines.forEach(function (l) {
    if (/^\+NWINFO:/.test(l)) {
      setEl('net-info-bar', l.replace(/^\+NWINFO:/, ''));
      setNetState('on');
    } else if (/NWSTATUS:OFF|NOT FOUND|NO_NET/i.test(l)) {
      setNetState('off');
    }
  });
}

function parseNodeList(lines) {
  lines.forEach(function (l) {
    /* FIND:<short4>,<ieee16>  format from AT+FIND */
    var m = l.match(/^FIND:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16})/i);
    if (m) addNode(m[1].toUpperCase(), m[2].toUpperCase(), '?');
  });
}

/* ────────────────────────────────────────────────────────────────────
   Network Commands
   ──────────────────────────────────────────────────────────────────── */
function queryNetStatus() {
  sendCFML('AT+NWINFO', 5000)
    .then(function (r) { parseNetStatus(splitResp(r)); })
    .catch(function () {});
}

function startNetwork() {
  setNetState('starting');
  sendCFML('AT+CREATENW', 12000)
    .then(function (r) {
      var lines = splitResp(r);
      var ok    = lines.some(function (l) { return /\+CREATENW:0|NETWORK UP/i.test(l); });
      state.networkUp = ok;
      setNetState(ok ? 'on' : 'off');
      parseNetStatus(lines);
      showToast(ok ? 'Network started ✓' : 'Start failed');
    })
    .catch(function () { setNetState('off'); });
}

function stopNetwork() {
  sendCFML('AT+QUITNW', 5000)
    .then(function () {
      state.networkUp = false;
      setNetState('off');
      setEl('net-info-bar', '—');
      showToast('Network stopped');
    })
    .catch(function () {});
}

function openPermitJoin() {
  sendCFML('AT+OPENWNET=60', 5000)
    .then(function () { showToast('Permit join: 60 s — waiting for nodes…'); })
    .catch(function () {});
}

function autoFind() {
  logInfo('Auto-finding nodes…');
  sendCFML('AT+FIND', 8000)
    .then(function (r) {
      var lines = splitResp(r);
      parseNodeList(lines);   /* handles FIND:<short>,<ieee> */
      renderNodeList();
      showToast('Find complete (' + Object.keys(state.nodes).length + ' nodes)');
    })
    .catch(function () {});
}

function setNetState(st) {
  state.networkUp = (st === 'on');
  var b = ge('net-badge');
  if (b) {
    b.setAttribute('data-state', st);
    b.textContent = st === 'on' ? 'ON' : st === 'starting' ? '…' : 'OFF';
  }
  var p = ge('status-pill');
  if (p) p.setAttribute('data-state', st);
  setEl('status-text', st === 'on' ? 'Network ON' : st === 'starting' ? 'Starting…' : 'OFF');
  saveLocalState();
}

/* ────────────────────────────────────────────────────────────────────
   Node Management
   ──────────────────────────────────────────────────────────────────── */
function addNode(short, ieee, type) {
  var names    = { '0': 'Coordinator', '1': 'Router', '2': 'End Device', '?': 'Unknown' };
  var existing = state.nodes[short];
  state.nodes[short] = {
    ieee: ieee,
    type: names[type] || (existing ? existing.type : type),
    ep:   existing ? existing.ep : state.ep
  };
  renderNodeList();
  saveLocalState();
}

function selectNode(short) {
  state.selectedNode = short;
  state.shortAddr    = short;
  var n = state.nodes[short];
  if (n && n.ep) state.ep = n.ep;
  renderNodeList();
  updateControlPanel();
  saveLocalState();
}

function deleteNode() {
  if (!state.selectedNode) return;
  var addr = state.selectedNode;
  var sp = ge('overlay-spinner');
  if (sp) sp.classList.remove('hidden');
  setEl('overlay-msg', 'Removing node ' + addr + '…');
  var ov = ge('ctrl-overlay');
  if (ov) ov.classList.remove('hidden');

  sendCFML('AT+ENTDEL=' + addr, 5000)
    .then(function () {
      delete state.nodes[addr];
      state.selectedNode = null;
      renderNodeList();
      updateControlPanel();
      saveLocalState();
      showToast('Node ' + addr + ' removed');
    })
    .catch(function () {
      var ov2 = ge('ctrl-overlay');
      if (ov2) ov2.classList.add('hidden');
    });
}

/* ────────────────────────────────────────────────────────────────────
   Cluster Selection
   ──────────────────────────────────────────────────────────────────── */
function selectCluster(cl) {
  state.cluster = cl;
  updateClusterTabs();
  updateControlPanel();
  saveLocalState();
}

/* ────────────────────────────────────────────────────────────────────
   ZCL Helpers
   ──────────────────────────────────────────────────────────────────── */
function getTarget() {
  return {
    s:  (state.shortAddr || '0000').toUpperCase(),
    ep: (state.ep        || '01').toUpperCase(),
    cl: (state.cluster   || '0006').toUpperCase()
  };
}

/* ────────────────────────────────────────────────────────────────────
   ZCL On/Off (cluster 0006)
   ──────────────────────────────────────────────────────────────────── */
function onOnOffToggle(checked) {
  if (!state.selectedNode) {
    var tog = ge('onoff-toggle');
    if (tog) tog.checked = !checked;
    showToast('Select a node first');
    return;
  }
  state.onOffState = checked;
  setEl('onoff-status-text', checked ? 'ON' : 'OFF');
  var wrap = ge('onoff-icon-wrap');
  if (wrap) wrap.setAttribute('data-on', checked ? 'true' : 'false');
  setEl('onoff-icon', checked ? '💡' : '🔦');
  var t = getTarget();
  /* ZCL On/Off cmd: 01=ON, 00=OFF */
  sendCFML('AT+ZCL=' + t.s + ',' + t.ep + ',0006,' + (checked ? '01' : '00'), 5000)
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   ZCL Level Control (cluster 0008)
   ──────────────────────────────────────────────────────────────────── */
function onLevelInput(v) {
  state.levelVal = parseInt(v, 10);
  refreshLevelSlider();
}

function onLevelChange(v) {
  state.levelVal = parseInt(v, 10);
  refreshLevelSlider();
  saveLocalState();
  var t = getTarget();
  /* ZCL Level Control cmd 0x04 = Move to Level (with On/Off)
     params: level (1 byte), transition time in 100ms units (2 bytes LE) */
  var lvlHex  = pad2(state.levelVal);
  /* AT+ZCL=<short>,<ep>,0008,04,<level>,0001  (ZCL Move to Level with On/Off) */
  sendCFML('AT+ZCL=' + t.s + ',' + t.ep + ',0008,04,' + lvlHex + ',0001', 5000)
    .catch(function () {});
}

function refreshLevelSlider() {
  var pct = Math.round(state.levelVal / 254 * 100);
  var sl  = ge('level-slider');
  if (sl) {
    sl.value = state.levelVal;
    sl.style.background =
      'linear-gradient(to right, var(--zb) ' + pct + '%, var(--surface3) ' + pct + '%)';
  }
  setEl('level-val', pct + '%');
}

/* ────────────────────────────────────────────────────────────────────
   ZCL Color Control (cluster 0300)
   ──────────────────────────────────────────────────────────────────── */
function onHueChange(v) {
  state.hue = parseInt(v, 10);
  state.isWhite = false;
  clearSwatchActive();
  updateColorUI();
}

function onHueCommit(v) {
  state.hue = parseInt(v, 10);
  state.isWhite = false;
  updateColorUI();
}

function onBrightChange(v) {
  state.brightness = parseInt(v, 10);
  updateColorUI();
}

function onBrightCommit(v) {
  state.brightness = parseInt(v, 10);
  updateColorUI();
}

function applySwatch(hue, brightness) {
  if (hue === -1) {
    state.isWhite   = true;
    state.brightness = brightness;
  } else {
    state.isWhite    = false;
    state.hue        = hue;
    state.brightness = brightness;
    var hs = ge('hue-slider');
    if (hs) hs.value = String(hue);
  }
  var bs = ge('bright-slider');
  if (bs) bs.value = String(brightness);
  clearSwatchActive();
  if (_root) {
    var swatches = _root.querySelectorAll('.swatch');
    for (var i = 0; i < swatches.length; i++) {
      var s = swatches[i];
      if (parseInt(s.getAttribute('data-h'), 10) === hue &&
          parseInt(s.getAttribute('data-b'), 10) === brightness) {
        s.classList.add('active');
      }
    }
  }
  updateColorUI();
}

function clearSwatchActive() {
  if (!_root) return;
  var swatches = _root.querySelectorAll('.swatch');
  for (var i = 0; i < swatches.length; i++) swatches[i].classList.remove('active');
}

function sendCurrentColor() {
  if (!state.selectedNode) { showToast('Select a node first'); return; }
  var rgb = getCurrentRgb();
  var hex = '#' + toHex2(rgb[0]) + toHex2(rgb[1]) + toHex2(rgb[2]);
  logInfo('Sending color ' + hex.toUpperCase());
  doSendColor(hex);
}

function doSendColor(hex) {
  var rgb = hexToRgb(hex);
  if (!rgb) return;
  var t  = getTarget();
  /* Convert sRGB → CIE 1931 XY for ZCL Color Control cluster */
  var xy = rgbToXY(rgb.r, rgb.g, rgb.b);
  var xH = Math.round(xy.x * 65535).toString(16).toUpperCase();
  var yH = Math.round(xy.y * 65535).toString(16).toUpperCase();
  while (xH.length < 4) xH = '0' + xH;
  while (yH.length < 4) yH = '0' + yH;
  /* ZCL cmd 0x08 = Move to Color, params: colorX(2B), colorY(2B), transition(2B) */
  sendCFML('AT+ZCL=' + t.s + ',' + t.ep + ',0300,08,' + xH + ',' + yH + ',0001', 5000)
    .then(function () { showToast('Color sent ✓'); })
    .catch(function () {});
}

function updateColorUI() {
  try {
    var rgb = getCurrentRgb();
    var hex = '#' + toHex2(rgb[0]) + toHex2(rgb[1]) + toHex2(rgb[2]);
    var cp  = ge('color-preview');
    if (cp) { cp.style.background = hex; cp.style.boxShadow = '0 0 14px ' + hex + '88'; }
    setEl('color-hex-label', hex.toUpperCase());
    var baseColor = state.isWhite ? '#FFFFFF' : ('hsl(' + state.hue + ',100%,50%)');
    var bs = ge('bright-slider');
    if (bs) bs.style.background = 'linear-gradient(to right, #111 0%, ' + baseColor + ' 100%)';
  } catch (e) {}
}

function getCurrentRgb() {
  if (state.isWhite) {
    var w = Math.round(state.brightness * 2.55);
    return [w, w, w];
  }
  var h = state.hue, s = 1.0, v = state.brightness / 100.0;
  var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  var r1, g1, b1;
  if      (h <  60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else              { r1 = c; g1 = 0; b1 = x; }
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/* ────────────────────────────────────────────────────────────────────
   ZCL Temperature Read (cluster 0402)
   ──────────────────────────────────────────────────────────────────── */
function readTempAttr() {
  if (!state.selectedNode) { showToast('Select a node first'); return; }
  var t = getTarget();
  /* AT+ATTRREAD=<short>,<ep>,0402,0000  — ZCL Measured Temperature */
  sendCFML('AT+ATTRREAD=' + t.s + ',' + t.ep + ',0402,0000', 5000)
    .then(function (r) {
      var lines = splitResp(r);
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/\+ATTRREAD:.*,([0-9A-Fa-f]+)$/i);
        if (m) {
          var raw = parseInt(m[1], 16);
          if (raw > 32767) raw -= 65536;
          setEl('temp-val', (raw / 100.0).toFixed(1));
          return;
        }
      }
    })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Advanced ZCL Operations
   ──────────────────────────────────────────────────────────────────── */
function readAttribute() {
  var attrId = (ge('inp-attr-id') ? ge('inp-attr-id').value.trim().toUpperCase() : '') || '0000';
  var t = getTarget();
  sendCFML('AT+ATTRREAD=' + t.s + ',' + t.ep + ',' + t.cl + ',' + attrId, 5000)
    .then(function (r) {
      var lines = splitResp(r);
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(/\+ATTRREAD:.*,([^,]+)$/i);
        if (m) { setEl('attr-read-result', m[1].trim()); return; }
      }
      setEl('attr-read-result', '—');
    })
    .catch(function () {});
}

function writeAttribute() {
  var inp = ge('inp-write-val');
  var v   = inp ? inp.value.trim() : '';
  if (!v) { showToast('Format: AttrID,Type,Value'); return; }
  var t = getTarget();
  sendCFML('AT+ATTRWRITE=' + t.s + ',' + t.ep + ',' + t.cl + ',' + v, 5000)
    .then(function () { showToast('Write sent ✓'); })
    .catch(function () {});
}

function sendZclCmd() {
  var inp = ge('inp-zcl-cmd');
  var v   = inp ? inp.value.trim() : '';
  if (!v) { showToast('Format: CmdID[,data]'); return; }
  var t = getTarget();
  sendCFML('AT+ZCL=' + t.s + ',' + t.ep + ',' + t.cl + ',' + v, 5000)
    .then(function () { showToast('Cmd sent ✓'); })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Rendering
   ──────────────────────────────────────────────────────────────────── */
function renderNodeList() {
  var list  = ge('node-list');
  var addrs = Object.keys(state.nodes);
  setEl('node-count', String(addrs.length));
  if (!list) return;
  if (!addrs.length) {
    list.innerHTML =
      '<div class="empty-state"><div class="empty-icon">🔶</div>' +
      '<div class="empty-msg">Start network &amp;<br>open Permit Join</div></div>';
    return;
  }
  list.innerHTML = addrs.map(function (a) {
    var n   = state.nodes[a];
    var sel = (a === state.selectedNode) ? ' selected' : '';
    var icon = n.type === 'Coordinator' ? '🌐' : n.type === 'Router' ? '🔁' : '💡';
    return '<div class="node-item' + sel + '" onclick="selectNode(\'' + escapeJs(a) + '\')">' +
      '<span class="node-icon">' + icon + '</span>' +
      '<div class="node-info">' +
        '<span class="node-name">0x' + escapeHtml(a) + '</span>' +
        '<span class="node-addr">' + escapeHtml(n.type || '?') + ' EP:' + escapeHtml(n.ep || '--') + '</span>' +
      '</div></div>';
  }).join('');
}

function syncSlotSelect() {
  var s = ge('cfg-slot');
  if (s) s.value = state.slot;
}

function updateControlPanel() {
  var hasNode = !!state.selectedNode;
  var ov = ge('ctrl-overlay');
  if (ov) ov.classList.toggle('hidden', hasNode);

  if (hasNode) {
    var n = state.nodes[state.selectedNode] || {};
    setEl('hero-name', '0x' + state.selectedNode);
    setEl('hero-sub', (n.ieee ? n.ieee.substring(0, 8) + '…' : '—') +
      (n.type ? '  ' + n.type : ''));
    setEl('hero-ep-val', (state.ep || '01').toUpperCase());
    var hi = ge('hero-icon');
    if (hi) hi.classList.add('active');
    var bd = ge('btn-del-node');
    if (bd) bd.classList.remove('hidden');
  } else {
    setEl('hero-name', '— Select a node —');
    setEl('hero-sub', '—');
    setEl('hero-ep-val', '—');
    var hi2 = ge('hero-icon');
    if (hi2) hi2.classList.remove('active');
    var bd2 = ge('btn-del-node');
    if (bd2) bd2.classList.add('hidden');
  }

  /* Show/hide ZCL sections based on selected cluster */
  var sections = { '0006': 'section-onoff', '0008': 'section-level',
                   '0300': 'section-color', '0402': 'section-temp' };
  Object.keys(sections).forEach(function (cl) {
    var el = ge(sections[cl]);
    if (el) el.classList.toggle('hidden', cl !== state.cluster);
  });

  /* Sync toggle state */
  var tog = ge('onoff-toggle');
  if (tog) tog.checked = state.onOffState;
  setEl('onoff-status-text', state.onOffState ? 'ON' : 'OFF');
  var wrap = ge('onoff-icon-wrap');
  if (wrap) wrap.setAttribute('data-on', state.onOffState ? 'true' : 'false');
  setEl('onoff-icon', state.onOffState ? '💡' : '🔦');

  refreshLevelSlider();
  updateColorUI();
}

function updateClusterTabs() {
  if (!_root) return;
  var tabs = _root.querySelectorAll('.btn-cluster-tab');
  for (var i = 0; i < tabs.length; i++) {
    var cl = tabs[i].getAttribute('data-cluster');
    tabs[i].classList.toggle('active', cl === state.cluster);
  }
}

/* ────────────────────────────────────────────────────────────────────
   LocalStorage Persistence
   ──────────────────────────────────────────────────────────────────── */
function saveLocalState() {
  try {
    localStorage.setItem('da2_zb_v2', JSON.stringify({
      slot: state.slot, shortAddr: state.shortAddr, ep: state.ep,
      cluster: state.cluster, nodes: state.nodes, networkUp: state.networkUp,
      onOffState: state.onOffState, levelVal: state.levelVal,
      hue: state.hue, brightness: state.brightness, isWhite: state.isWhite,
      selectedNode: state.selectedNode
    }));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem('da2_zb_v2');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.slot)         state.slot         = s.slot;
    if (s.shortAddr)    state.shortAddr     = s.shortAddr;
    if (s.ep)           state.ep            = s.ep;
    if (s.cluster)      state.cluster       = s.cluster;
    if (s.nodes)        state.nodes         = s.nodes;
    state.networkUp  = !!s.networkUp;
    state.onOffState = !!s.onOffState;
    if (s.levelVal   != null) state.levelVal   = s.levelVal;
    if (s.hue        != null) state.hue        = s.hue;
    if (s.brightness != null) state.brightness = s.brightness;
    if (s.isWhite    != null) state.isWhite    = s.isWhite;
    state.selectedNode = (s.selectedNode && state.nodes[s.selectedNode]) ? s.selectedNode : null;
    if (state.selectedNode) state.shortAddr = state.selectedNode;
    /* Restore slider positions */
    var hs = ge('hue-slider');
    if (hs) hs.value = String(state.hue);
    var bs = ge('bright-slider');
    if (bs) bs.value = String(state.brightness);
    var ls = ge('level-slider');
    if (ls) ls.value = String(state.levelVal);
  } catch (e) {}
}

/* ────────────────────────────────────────────────────────────────────
   Console
   ──────────────────────────────────────────────────────────────────── */
function logToConsole(cls, msg) {
  var el   = ge('console-log');
  var text = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  if (!el) { console.log('[ZB-' + cls + '] ' + text); return; }
  var line = document.createElement('div');
  line.className   = cls;
  line.textContent = text;
  el.appendChild(line);
  while (el.children.length > 300) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function logTx  (m) { logToConsole('log-tx',   '→ ' + m); }
function logOk  (m) { logToConsole('log-ok',   '✓ ' + m); }
function logFail(m) { logToConsole('log-fail',  '✗ ' + m); }
function logInfo(m) { logToConsole('log-info',  'ℹ ' + m); }
function logEvt (m) { logToConsole('log-evt',   '⚡ ' + m); }
function clearLog() { var el = ge('console-log'); if (el) el.innerHTML = ''; }

/* ────────────────────────────────────────────────────────────────────
   Utilities
   ──────────────────────────────────────────────────────────────────── */
function ge(id)        { return document.getElementById(id); }
function setEl(id, v)  { var el = ge(id); if (el) el.textContent = v; }

function showToast(msg) {
  var t = ge('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.add('hidden'); }, 2400);
}

function pad2(n) { return ('0' + Math.round(n).toString(16)).slice(-2).toUpperCase(); }

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeJs(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

function hexToRgb(hex) {
  var m = (hex || '').replace('#','').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
}

function toHex2(n) {
  return ('0' + Math.min(255, Math.max(0, Math.round(n))).toString(16)).slice(-2).toUpperCase();
}

/* sRGB → CIE 1931 XY (Philips Wide Gamut matrix) */
function rgbToXY(r, g, b) {
  function lin(c) {
    c = c / 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  }
  var R = lin(r), G = lin(g), B = lin(b);
  var X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  var Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  var Z = R * 0.000088 + G * 0.072310 + B * 0.986039;
  var sum = X + Y + Z;
  return (sum === 0) ? { x: 0.3127, y: 0.3290 } : { x: X / sum, y: Y / sum };
}

/* ────────────────────────────────────────────────────────────────────
   Expose to ThingsBoard HTML onclick attributes
   ──────────────────────────────────────────────────────────────────── */
window.onSlotChange   = function (v) { state.slot = v; saveLocalState(); };
window.startNetwork   = startNetwork;
window.stopNetwork    = stopNetwork;
window.openPermitJoin = openPermitJoin;
window.autoFind       = autoFind;
window.selectNode     = selectNode;
window.deleteNode     = deleteNode;
window.selectCluster  = selectCluster;
window.onOnOffToggle  = onOnOffToggle;
window.onLevelInput   = onLevelInput;
window.onLevelChange  = onLevelChange;
window.onHueChange    = onHueChange;
window.onHueCommit    = onHueCommit;
window.onBrightChange = onBrightChange;
window.onBrightCommit = onBrightCommit;
window.applySwatch    = applySwatch;
window.sendCurrentColor = sendCurrentColor;
window.readTempAttr   = readTempAttr;
window.readAttribute  = readAttribute;
window.writeAttribute = writeAttribute;
window.sendZclCmd     = sendZclCmd;
window.clearLog       = clearLog;
