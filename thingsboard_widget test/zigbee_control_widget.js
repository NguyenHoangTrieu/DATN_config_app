/* =====================================================================
   DA2 Zigbee Gateway Control — ThingsBoard Widget JavaScript
   Protocol: CFML:CFZB:<slot>:<function_name>[:<params>]
   Routing: CF=config frame → WAN MCU → ML=MCU LAN → CFZB=Zigbee handler
   ===================================================================== */

var state = {
  slot:         '0',
  shortAddr:    '',
  ep:           '01',
  cluster:      '0006',
  networkUp:    false,
  nodes:        {},    /* keyed by shortAddr → {ieee, ep, type} */
  selectedNode: null,  /* shortAddr string */
  rpcTimeout:   8000,
  onOffState:   false,
  levelVal:     127,
  colorHex:     '#ffcc00'
};

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard Lifecycle
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  loadLocalState();
  syncConfigBar();
  renderNodeList();
  updateControlPanel();
  updateClusterPresets();
  queryNetStatus();
};

self.onDestroy = function () {};

/* ────────────────────────────────────────────────────────────────────
   RPC / CFML helpers
   ──────────────────────────────────────────────────────────────────── */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err)  { reject(err);  }
      );
  });
}

function sendCFML(zbCmd, timeoutMs) {
  var cmd = 'CFML:CFZB:' + state.slot + ':' + zbCmd;
  logTx(cmd);
  return sendRPC('sendCommand', cmd, timeoutMs || state.rpcTimeout)
    .then(function (resp) {
      if (resp) logCFMLResponse(resp);
      return resp;
    })
    .catch(function (err) {
      logFail('RPC error: ' + (err && err.message ? err.message : String(err)));
      throw err;
    });
}

/* ────────────────────────────────────────────────────────────────────
   Config-bar handlers (called by HTML inline onchange/onclick)
   ──────────────────────────────────────────────────────────────────── */
function onSlotChange(v) {
  state.slot = v;
  saveLocalState();
}

function onShortAddrChange(v) {
  state.shortAddr = v.trim().toUpperCase();
  ge('cfg-short').value = state.shortAddr;
  saveLocalState();
}

function onClusterChange(v) {
  state.cluster = v;
  updateClusterPresets();
  updateControlPanel();
  saveLocalState();
}

function clusterPreset(cl) {
  state.cluster = cl;
  ge('cfg-cluster').value = cl;
  updateClusterPresets();
  updateControlPanel();
  saveLocalState();
}

/* ────────────────────────────────────────────────────────────────────
   Response parsers
   ──────────────────────────────────────────────────────────────────── */
function splitResp(resp) {
  if (!resp) return [];
  if (typeof resp === 'object' && resp.data !== undefined) resp = resp.data;
  return String(resp).split(/\x1e|\n/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function logCFMLResponse(resp) {
  splitResp(resp).forEach(function (line) {
    if (/^\+JOIN:|^\+NWINFO:|^\+FIND:|^\+ATTRREPORT:|^\+LEAVE:/.test(line)) {
      logEvt(line);
      handleAsyncEvent(line);
    } else {
      logOk(line);
    }
  });
}

function handleAsyncEvent(line) {
  var m;

  /* +JOIN:<short>,<ieee>,<type>  (0=coord,1=router,2=end) */
  m = line.match(/^\+JOIN:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16}),(\d)/);
  if (m) { addNode(m[1].toUpperCase(), m[2].toUpperCase(), m[3]); return; }

  /* +FIND:<short>,<ieee> */
  m = line.match(/^\+FIND:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16})/);
  if (m) { addNode(m[1].toUpperCase(), m[2].toUpperCase(), '?'); return; }

  /* +NWINFO:... */
  m = line.match(/^\+NWINFO:(.*)/);
  if (m) { ge('net-info').textContent = m[1]; return; }

  /* +LEAVE:<short> */
  m = line.match(/^\+LEAVE:([0-9A-Fa-f]{4})/);
  if (m) {
    var addr = m[1].toUpperCase();
    delete state.nodes[addr];
    if (state.selectedNode === addr) { state.selectedNode = null; updateControlPanel(); }
    renderNodeList();
    saveLocalState();
    return;
  }

  /* +ATTRREPORT:<short>,<ep>,<cluster>,<attr>,<type>,<value> */
  m = line.match(/^\+ATTRREPORT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),(.*)/i);
  if (m) handleAttrReport(m[1].toUpperCase(), m[3].toUpperCase(), m[4].toUpperCase(), m[6]);
}

function handleAttrReport(short, cluster, attr, value) {
  if (short !== state.selectedNode) return;
  if (cluster === '0006' && attr === '0000') {
    state.onOffState = (parseInt(value, 16) !== 0);
    ge('onoff-toggle').checked    = state.onOffState;
    ge('onoff-label').textContent = state.onOffState ? 'ON' : 'OFF';
    ge('onoff-val').textContent   = state.onOffState ? 'ON' : 'OFF';
  }
  if (cluster === '0008' && attr === '0000') {
    state.levelVal = parseInt(value, 16);
    refreshSlider();
  }
}

function parseNetStatus(lines) {
  lines.forEach(function (l) {
    if (/^\+NWINFO:/.test(l)) {
      ge('net-info').textContent = l.replace(/^\+NWINFO:/, '');
      setNetBadge('on');
    } else if (/NETWORK NOT FOUND|NWSTATUS:OFF|NO_NET/i.test(l)) {
      setNetBadge('off');
    }
  });
}

function parseNodeList(lines) {
  lines.forEach(function (l) {
    var m = l.match(/^\+NODELIST:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16}),(\d)/i);
    if (m) addNode(m[1].toUpperCase(), m[2].toUpperCase(), m[3]);
  });
}

/* ────────────────────────────────────────────────────────────────────
   Network Commands
   ──────────────────────────────────────────────────────────────────── */
function queryNetStatus() {
  sendCFML('MODULE_GET_NET_STATUS', 5000)
    .then(function (r) { parseNetStatus(splitResp(r)); })
    .catch(function () {});
}

function startNetwork() {
  setNetBadge('starting');
  sendCFML('MODULE_START_NETWORK', 10000)
    .then(function (r) {
      var lines = splitResp(r);
      var ok    = lines.some(function (l) { return /CREATENW:0|NETWORK UP/i.test(l); });
      state.networkUp = ok;
      setNetBadge(ok ? 'on' : 'off');
      parseNetStatus(lines);
      showToast(ok ? 'Network started ✓' : 'Start failed');
    })
    .catch(function () { setNetBadge('off'); });
}

function stopNetwork() {
  sendCFML('MODULE_STOP_NETWORK', 5000)
    .then(function () { state.networkUp = false; setNetBadge('off'); showToast('Network stopped'); })
    .catch(function () {});
}

function openPermitJoin() {
  sendCFML('MODULE_SET_PERMIT_JOIN:60', 5000)
    .then(function () { showToast('Permit join: 60 s'); })
    .catch(function () {});
}

function autoFind() {
  logInfo('Auto-finding nodes…');
  sendCFML('MODULE_AUTO_FIND_TARGET', 8000)
    .then(function (r) { parseNodeList(splitResp(r)); renderNodeList(); showToast('Find complete'); })
    .catch(function () {});
}

function setNetBadge(st) {
  var b = ge('net-badge');
  b.setAttribute('data-state', st);
  b.textContent = (st === 'on') ? 'ON' : (st === 'starting') ? '…' : 'OFF';
}

/* ────────────────────────────────────────────────────────────────────
   Node Management
   ──────────────────────────────────────────────────────────────────── */
function addNode(short, ieee, type) {
  var names    = { '0': 'Coord', '1': 'Router', '2': 'End' };
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
  ge('cfg-short').value = short;
  ge('cfg-ep').value    = state.ep;
  renderNodeList();
  updateControlPanel();
  saveLocalState();
}

function deleteNode() {
  if (!state.selectedNode) return;
  var addr = state.selectedNode;
  sendCFML('MODULE_DELETE_NODE:' + addr, 5000)
    .then(function () {
      delete state.nodes[addr];
      if (state.selectedNode === addr) state.selectedNode = null;
      renderNodeList();
      updateControlPanel();
      saveLocalState();
      showToast('Node deleted');
    })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   ZCL Commands — On/Off
   ──────────────────────────────────────────────────────────────────── */
function getTarget() {
  return {
    s:  (state.shortAddr || '0000').toUpperCase(),
    ep: (state.ep        || '01').toUpperCase(),
    cl: (state.cluster   || '0006').toUpperCase()
  };
}

function onOnOffToggle(checked) {
  state.onOffState = checked;
  ge('onoff-label').textContent = checked ? 'ON' : 'OFF';
  ge('onoff-val').textContent   = checked ? 'ON' : 'OFF';
  var t = getTarget();
  sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + t.s + ',' + t.ep + ',0006,' + (checked ? '01' : '00'), 5000)
    .catch(function () {});
}

/* ZCL Commands — Level */
function onLevelInput(v) {
  state.levelVal = parseInt(v, 10);
  refreshSlider();
}

function onLevelChange(v) {
  state.levelVal = parseInt(v, 10);
  refreshSlider();
  saveLocalState();
  var t = getTarget();
  /* Level Control cluster cmd 0x04 (Move to Level w/ On/Off): level, transition 0.1s */
  sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + t.s + ',' + t.ep + ',0008,04,' + pad2(state.levelVal) + ',0001', 5000)
    .catch(function () {});
}

function refreshSlider() {
  var pct = Math.round(state.levelVal / 254 * 100);
  ge('level-slider').value = state.levelVal;
  ge('level-slider').style.background =
    'linear-gradient(to right, var(--zb-color) ' + pct + '%, #21262d ' + pct + '%)';
  ge('level-val').textContent = pct + '%';
}

/* ZCL Commands — Color */
function onColorInput(v) {
  ge('color-hex-val').textContent = v.toUpperCase();
}

function onColorChange(v) {
  state.colorHex = v;
  ge('color-hex-val').textContent = v.toUpperCase();
  saveLocalState();
  doSendColor(v);
}

function applyColorPreset(hex) {
  state.colorHex = hex;
  ge('color-picker').value        = hex;
  ge('color-hex-val').textContent = hex.toUpperCase();
  saveLocalState();
  doSendColor(hex);
}

function doSendColor(hex) {
  var rgb = hexToRgb(hex);
  if (!rgb) return;
  var t  = getTarget();
  var xy = rgbToXY(rgb.r, rgb.g, rgb.b);
  var xH = Math.round(xy.x * 65535).toString(16).padStart(4, '0').toUpperCase();
  var yH = Math.round(xy.y * 65535).toString(16).padStart(4, '0').toUpperCase();
  /* Color Control cluster cmd 0x08 (Move to Color): colorX, colorY, transition */
  sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + t.s + ',' + t.ep + ',0300,08,' + xH + ',' + yH + ',0001', 5000)
    .catch(function () {});
}

/* ZCL Commands — Attribute */
function readAttribute() {
  var t   = getTarget();
  var aid = ge('inp-attr-id').value.trim().toUpperCase() || '0000';
  sendCFML('MODULE_ZCL_READ_ATTR:' + t.s + ',' + t.ep + ',' + t.cl + ',' + aid, 5000)
    .then(function (r) {
      var found = splitResp(r).find(function (l) { return /ATTRVAL:|READATTR:/i.test(l); });
      if (found) ge('attr-read-val').textContent = found.split(':').pop().trim();
    })
    .catch(function () {});
}

function writeAttribute() {
  var t = getTarget();
  var v = ge('inp-write-attr').value.trim();
  if (!v) { showToast('Format: AttrID,Type,Value'); return; }
  sendCFML('MODULE_ZCL_WRITE_ATTR:' + t.s + ',' + t.ep + ',' + t.cl + ',' + v, 5000)
    .catch(function () {});
}

function sendZclCmd() {
  var t = getTarget();
  var v = ge('inp-zcl-cmd').value.trim();
  if (!v) { showToast('Format: CmdID[,data]'); return; }
  sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + t.s + ',' + t.ep + ',' + t.cl + ',' + v, 5000)
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Rendering
   ──────────────────────────────────────────────────────────────────── */
function renderNodeList() {
  var list  = ge('node-list');
  var addrs = Object.keys(state.nodes);
  ge('node-count').textContent = String(addrs.length);

  if (!addrs.length) {
    list.innerHTML = '<div class="no-items-msg">Chưa có node.<br>Nhấn ▶ Start → ⚡ Permit Join</div>';
    return;
  }

  list.innerHTML = addrs.map(function (a) {
    var n   = state.nodes[a];
    var sel = (a === state.selectedNode) ? ' selected' : '';
    var icon = (n.type === 'Router') ? '🔁' : (n.type === 'Coord') ? '🌐' : '💡';
    return '<div class="node-item' + sel + '" onclick="selectNode(\'' + escapeJs(a) + '\')">' +
      '<span class="node-icon">' + icon + '</span>' +
      '<div class="node-info">' +
        '<span class="node-name">0x' + escapeHtml(a) + '</span>' +
        '<span class="node-addr">' + escapeHtml(n.type || '?') +
          ' · EP:' + escapeHtml(n.ep || '--') + '</span>' +
      '</div></div>';
  }).join('');
}

function syncConfigBar() {
  ge('cfg-slot').value     = state.slot;
  ge('cfg-short').value    = state.shortAddr;
  ge('cfg-ep').value       = state.ep;
  ge('cfg-cluster').value  = state.cluster;
  ge('color-picker').value = state.colorHex;
  ge('color-hex-val').textContent = state.colorHex.toUpperCase();
  setNetBadge(state.networkUp ? 'on' : 'off');
  refreshSlider();
}

function updateControlPanel() {
  var hasNode = !!state.selectedNode;
  ge('ctrl-overlay').classList.toggle('hidden', hasNode);
  if (hasNode) {
    ge('ctrl-node-name').textContent = '0x' + state.selectedNode;
    ge('status-dot').setAttribute('data-state', 'active');
    ge('btn-del').classList.remove('hidden');
  } else {
    ge('ctrl-node-name').textContent = '— Chọn node —';
    ge('status-dot').setAttribute('data-state', 'off');
    ge('btn-del').classList.add('hidden');
  }
  ge('section-onoff').classList.toggle('hidden', state.cluster !== '0006');
  ge('section-level').classList.toggle('hidden', state.cluster !== '0008');
  ge('section-color').classList.toggle('hidden', state.cluster !== '0300');
  ge('onoff-toggle').checked    = state.onOffState;
  ge('onoff-label').textContent = state.onOffState ? 'ON' : 'OFF';
  ge('onoff-val').textContent   = state.onOffState ? 'ON' : 'OFF';
}

function updateClusterPresets() {
  ['0006','0008','0300','0402'].forEach(function (cl) {
    document.querySelectorAll('.btn-cluster-preset').forEach(function (btn) {
      var m = (btn.getAttribute('onclick') || '').match(/'([0-9A-F]{4})'/i);
      if (m) btn.classList.toggle('active', m[1] === state.cluster);
    });
  });
}

/* ────────────────────────────────────────────────────────────────────
   localStorage persistence
   ──────────────────────────────────────────────────────────────────── */
function saveLocalState() {
  try {
    localStorage.setItem('CFML_zb_slot', JSON.stringify({
      slot: state.slot, shortAddr: state.shortAddr, ep: state.ep,
      cluster: state.cluster, nodes: state.nodes, networkUp: state.networkUp,
      onOffState: state.onOffState, levelVal: state.levelVal, colorHex: state.colorHex,
      selectedNode: state.selectedNode
    }));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem('CFML_zb_slot');
    if (!raw) return;
    var s = JSON.parse(raw);
    state.slot          = s.slot        || '0';
    state.shortAddr     = s.shortAddr   || '';
    state.ep            = s.ep          || '01';
    state.cluster       = s.cluster     || '0006';
    state.nodes         = s.nodes       || {};
    state.networkUp     = !!s.networkUp;
    state.onOffState    = !!s.onOffState;
    state.levelVal      = (s.levelVal !== undefined) ? s.levelVal : 127;
    state.colorHex      = s.colorHex    || '#ffcc00';
    state.selectedNode  = (s.selectedNode && state.nodes[s.selectedNode]) ? s.selectedNode : null;
    if (state.selectedNode) state.shortAddr = state.selectedNode;
  } catch (e) {}
}

/* ────────────────────────────────────────────────────────────────────
   Console
   ──────────────────────────────────────────────────────────────────── */
function logToConsole(cls, msg) {
  var el   = ge('console-log');
  var line = document.createElement('div');
  line.className   = cls;
  line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  el.appendChild(line);
  while (el.children.length > 200) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function logTx   (m) { logToConsole('log-tx',   '→ ' + m); }
function logOk   (m) { logToConsole('log-ok',   '✓ ' + m); }
function logFail (m) { logToConsole('log-fail',  '✗ ' + m); }
function logInfo (m) { logToConsole('log-info',  'ℹ ' + m); }
function logEvt  (m) { logToConsole('log-evt',   '⚡ ' + m); }
function clearLog () { ge('console-log').innerHTML = ''; }

/* ────────────────────────────────────────────────────────────────────
   Utilities
   ──────────────────────────────────────────────────────────────────── */
function ge(id) { return document.getElementById(id); }

function showToast(msg) {
  var t = ge('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.add('hidden'); }, 2200);
}

function pad2(n)       { return ('0' + Math.round(n).toString(16)).slice(-2).toUpperCase(); }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeJs(s)   { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

function hexToRgb(hex) {
  var m = hex.replace('#','').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
}

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
