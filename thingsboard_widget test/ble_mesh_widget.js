/* ╔══════════════════════════════════════════════════════════════════╗
   ║  BLE Native Mesh Widget — JavaScript                             ║
   ║  Protocol : CFML:CFBN:<slot>:<VERB>:<params>                     ║
   ║  Response : CFBN:<data>                                          ║
   ║                                                                  ║
   ║  Node types (from CID in SCAN_RESULT):                           ║
   ║    0xDA21  → LED node                                            ║
   ║    0xDA22  → Sensor node                                         ║
   ║                                                                  ║
   ║  Commands (minimum timeout 15 000 ms):                           ║
   ║    SCAN:<ms>                                                      ║
   ║    PROVISION:<uuid>                                               ║
   ║    NODE_LIST                                                      ║
   ║    APP_KEY_ADD:{"addr":"<hex>","net_idx":0,"app_idx":0}          ║
   ║    CONTROL:{"addr":"<hex>","func":"ONOFF","params":{...}}        ║
   ║    CONTROL:{"addr":"<hex>","func":"VENDOR_COLOR",                ║
   ║             "params":{"color_idx":<0-4>}}                        ║
   ║    GET_STATUS:{"addr":"<hex>","model":"ONOFF"}                   ║
   ║    NODE_RESET:<hex_addr>                                          ║
   ║                                                                  ║
   ║  Color index mapping:                                             ║
   ║    0=Red  1=Green  2=Blue  3=Yellow  4=White                     ║
   ║                                                                  ║
   ║  COMMAND QUEUE: each command waits for response or timeout       ║
   ║  before next command is dispatched.                              ║
   ╚══════════════════════════════════════════════════════════════════╝ */

/* ────────────────────────────────────────────────────────────────────
   STATE
   ──────────────────────────────────────────────────────────────────── */
var state = {
  slot:         '0',
  unprovDevices: [],    // [{uuid, name, rssi, cid}]
  nodes:         [],    // [{addr, name, type, appKeyAdded}]
  selectedNode:  null,  // currently selected node object
  scanning:      false,
};

/* ─── Command Queue ────────────────────────────────────────────────── */
var cmdQueue = [];    // [{fn, resolve, reject}]
var cmdBusy  = false;

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard / self binding (populated when embedded in TB)
   ──────────────────────────────────────────────────────────────────── */
var self = self || {};
var controlApi = (typeof self.ctx !== 'undefined' && self.ctx.controlApi)
  ? self.ctx.controlApi
  : null;

/* ────────────────────────────────────────────────────────────────────
   DOM helpers
   ──────────────────────────────────────────────────────────────────── */
function ge(id)       { return document.getElementById(id); }
function setEl(id, v) { var el = ge(id); if (el) el.textContent = v; }
function cls(el, c, add) { if (el) { if (add) el.classList.add(c); else el.classList.remove(c); } }

/* ────────────────────────────────────────────────────────────────────
   COMMAND QUEUE ENGINE
   ──────────────────────────────────────────────────────────────────── */

/** Add a command to the queue. Returns a Promise. */
function enqueue(fn) {
  return new Promise(function (resolve, reject) {
    cmdQueue.push({ fn: fn, resolve: resolve, reject: reject });
    _drainQueue();
  });
}

function _drainQueue() {
  if (cmdBusy || cmdQueue.length === 0) return;
  var item = cmdQueue.shift();
  cmdBusy = true;
  _showQueueBar(true);
  item.fn()
    .then(function (r) { item.resolve(r); })
    .catch(function (e) { item.reject(e); })
    .finally(function () {
      cmdBusy = false;
      _showQueueBar(cmdQueue.length > 0);
      _drainQueue();   // process next
    });
}

function _showQueueBar(show) {
  var bar = ge('queue-bar');
  if (!bar) return;
  if (show) bar.classList.add('visible');
  else      bar.classList.remove('visible');
}

/* ────────────────────────────────────────────────────────────────────
   CFML SEND (hex-encode payload → ThingsBoard RPC)
   ──────────────────────────────────────────────────────────────────── */

/**
 * Build full command string:   CFML:CFBN:<slot>:<verb>:<args>
 * Then hex-encode and send via ThingsBoard two-way RPC.
 * Returns a Promise<string> (decoded response).
 */
function sendCFML(verbAndArgs, timeoutMs) {
  var fullCmd = 'CFML:CFBN:' + state.slot + ':' + verbAndArgs;
  logInfo('TX: ' + fullCmd);
  console.log('[BLE-MESH][TX]', fullCmd);
  if (!controlApi) {
    /* Dev/test mode — simulate firmware responses */
    return new Promise(function (resolve) {
      if (verbAndArgs.indexOf('SCAN:') === 0) {
        /* Step 1: emit SCAN_STARTED immediately, then SCAN_DONE after 1 s */
        logInfo('[SIM] SCAN_STARTED');
        setTimeout(function () {
          resolve('CFBN:OK:SCAN_DONE:1\x1eUNPROV_DEV:DA020100AABBCCDD00001100000000');
        }, 1000);
      } else {
        setTimeout(function () { resolve('CFBN:OK'); }, 300);
      }
    });
  }
  /* Hex-encode */
  var hex = '';
  for (var i = 0; i < fullCmd.length; i++) {
    var code = fullCmd.charCodeAt(i).toString(16).toUpperCase();
    if (code.length < 2) code = '0' + code;
    hex += code;
  }
  return new Promise(function (resolve, reject) {
    controlApi.sendTwoWayCommand('sendCommand', hex, timeoutMs)
      .subscribe({
        next: function (resp) {
          var decoded = _hexDecodeResp(resp);
          logObj('[RX]', decoded);
          console.log('[BLE-MESH][RX]', decoded);
          resolve(decoded);
        },
        error: function (e) {
          var msg = e ? (e.message || String(e)) : 'timeout';
          logFail('RPC error: ' + msg);
          console.error('[BLE-MESH][RPC ERROR]', msg, e);
          reject(e);
        }
      });
  });
}

/** Hex-decode the response string from ThingsBoard */
function _hexDecodeResp(resp) {
  if (!resp) return '';
  if (typeof resp === 'object' && resp.value) resp = resp.value;
  var str = String(resp).trim();
  /* If it looks hex-encoded, decode it */
  if (/^[0-9A-Fa-f]+$/.test(str) && str.length % 2 === 0) {
    try {
      var out = '';
      for (var i = 0; i < str.length; i += 2) {
        out += String.fromCharCode(parseInt(str.substring(i, i + 2), 16));
      }
      return out;
    } catch (_) {}
  }
  return str;
}

/* ────────────────────────────────────────────────────────────────────
   PROVISIONING — SCAN
   ──────────────────────────────────────────────────────────────────── */
function startScan() {
  if (state.scanning) return;
  state.scanning = true;
  var scanBtn  = ge('btn-scan');
  var scanIcon = ge('scan-icon');
  if (scanBtn)  scanBtn.classList.add('scanning');
  if (scanIcon) scanIcon.classList.add('spin');
  setEl('status-text', 'Đang quét...');

  enqueue(function () {
    /* Timeout = scan duration (15 s) + 5 s buffer.
     * Firmware no longer sends SCAN_STARTED — SCAN_DONE is the single response. */
    return sendCFML('SCAN:15000', 20000)
      .then(function (resp) {
        console.log('[BLE-MESH][SCAN RAW]', resp);
        state.unprovDevices = _parseScanResult(resp);
        console.log('[BLE-MESH][SCAN PARSED]', state.unprovDevices);
        renderUnprovList();
        setEl('status-text', 'Tìm thấy ' + state.unprovDevices.length + ' thiết bị');
        logOk('Scan done — ' + state.unprovDevices.length + ' device(s)');
      })
      .catch(function (e) {
        console.error('[BLE-MESH][SCAN ERROR]', e);
        setEl('status-text', 'Scan thất bại');
        logFail('Scan error: ' + (e ? e.message || e : 'timeout'));
      })
      .finally(function () {
        state.scanning = false;
        if (scanBtn)  scanBtn.classList.remove('scanning');
        if (scanIcon) scanIcon.classList.remove('spin');
      });
  });
}

/**
 * Parse actual firmware uplink format:
 *   CFBN:OK:SCAN_DONE:<n>\x1eUNPROV_DEV:<uuid32>\x1eUNPROV_DEV:<uuid32>...
 *
 * UUID format (DA2): DA <type> <index> 00 <MAC[6]> <zeros[6]>
 *   e.g. DA020100E4B063BAA75A000000000000
 *        ^^^^ cid (bytes 0-1 hex)
 *             ^^ device index (byte 2 hex)
 */
function _parseScanResult(resp) {
  /* ── Try legacy JSON format first (future extensibility) ────── */
  try {
    var jIdx = resp.indexOf('SCAN_RESULT:');
    if (jIdx >= 0) {
      var arr = JSON.parse(resp.substring(jIdx + 'SCAN_RESULT:'.length).trim());
      if (Array.isArray(arr)) return arr;
    }
  } catch (_) {}

  /* ── Parse firmware delimited format ────────────────────────── */
  var doneIdx = resp.indexOf('SCAN_DONE:');
  if (doneIdx < 0) return [];

  var devs  = [];
  var parts = resp.substring(doneIdx).split('\x1e');
  /* parts[0] = "SCAN_DONE:<n>", parts[1..] = "UNPROV_DEV:<uuid>" */
  for (var i = 1; i < parts.length; i++) {
    var p = parts[i].trim();
    if (p.indexOf('UNPROV_DEV:') !== 0) continue;
    var uuid = p.substring('UNPROV_DEV:'.length).trim();
    if (uuid.length < 32) continue;
    uuid = uuid.toUpperCase();
    /* cid = first 4 hex chars (bytes 0-1): 'DA01'=LED, 'DA02'=LED,
     * 'DA22'=Sensor — extendable per project convention              */
    var cid      = uuid.substring(0, 4);
    var devIndex = parseInt(uuid.substring(4, 6), 16) || 0;
    var name     = 'Node_' + devIndex;
    devs.push({ uuid: uuid, name: name, rssi: null, cid: cid });
  }
  return devs;
}

/* ── Provision a device ───────────────────────────────────────────── */
function provisionDevice(uuid, name, cid) {
  logInfo('Provisioning: ' + uuid);
  enqueue(function () {
    return sendCFML('PROVISION:' + uuid, 30000)
      .then(function (resp) {
        /* Expected: CFBN:PROV_DONE:{"uuid":"...","addr":"0x0002"} */
        var addrMatch = resp.match(/"addr"\s*:\s*"([^"]+)"/);
        var addr = addrMatch ? addrMatch[1] : null;
        if (!addr) throw new Error('No addr in response');

        /* Determine type from CID */
        var type = (cid === 'DA22' || cid === 0xDA22) ? 'sensor' : 'led';
        /* Add APP key */
        return sendCFML(
          'APP_KEY_ADD:' + JSON.stringify({ addr: addr, net_idx: 0, app_idx: 0 }),
          15000
        ).then(function () {
          var node = { addr: addr, name: name || ('Node_' + addr), type: type, uuid: uuid };
          state.nodes.push(node);
          saveNodes();
          renderNodeList();
          setEl('status-text', 'Đã thêm node ' + addr);
          logOk('Provisioned OK — ' + addr + ' (' + type + ')');
          showToast('Đã cấu hình: ' + node.name);
        });
      })
      .catch(function (e) {
        logFail('Provision failed: ' + (e ? e.message || e : 'timeout'));
        showToast('Cấu hình thất bại');
      });
  });
}

/* ────────────────────────────────────────────────────────────────────
   NODE MANAGEMENT
   ──────────────────────────────────────────────────────────────────── */
function refreshNodeList() {
  enqueue(function () {
    return sendCFML('NODE_LIST', 15000)
      .then(function (resp) {
        /* Expected: CFBN:NODE_LIST:[{...}] */
        try {
          var idx = resp.indexOf('NODE_LIST:');
          if (idx >= 0) {
            var json = resp.substring(idx + 'NODE_LIST:'.length).trim();
            var arr  = JSON.parse(json);
            if (Array.isArray(arr)) {
              /* Merge remote list into local — keep local names */
              arr.forEach(function (rn) {
                var local = state.nodes.find(function (n) { return n.addr === rn.addr; });
                if (!local) {
                  var type = (rn.cid === 'DA22' || rn.cid === '0xDA22') ? 'sensor' : 'led';
                  state.nodes.push({ addr: rn.addr, name: rn.name || rn.addr, type: type, uuid: rn.uuid || '' });
                }
              });
              saveNodes();
              renderNodeList();
              logOk('NODE_LIST refreshed — ' + state.nodes.length + ' node(s)');
            }
          }
        } catch (_) {}
      })
      .catch(function (e) { logFail('NODE_LIST error: ' + (e ? e.message || e : 'timeout')); });
  });
}

function resetNode() {
  if (!state.selectedNode) return;
  if (!confirm('Xoá node ' + state.selectedNode.name + ' khỏi mesh?')) return;
  var addr = state.selectedNode.addr;
  enqueue(function () {
    return sendCFML('NODE_RESET:' + addr, 15000)
      .then(function () {
        state.nodes = state.nodes.filter(function (n) { return n.addr !== addr; });
        saveNodes();
        state.selectedNode = null;
        renderNodeList();
        updateControlPanel();
        logOk('Node reset: ' + addr);
        showToast('Node đã bị xoá');
      })
      .catch(function (e) { logFail('NODE_RESET error: ' + (e ? e.message || e : 'timeout')); });
  });
}

function selectNode(addr) {
  var node = state.nodes.find(function (n) { return n.addr === addr; });
  if (!node) return;
  state.selectedNode = node;
  renderNodeList();
  updateControlPanel();
}

/* ────────────────────────────────────────────────────────────────────
   LED CONTROL
   ──────────────────────────────────────────────────────────────────── */
function onLedToggle(checked) {
  if (!state.selectedNode) {
    var tog = ge('led-toggle');
    if (tog) tog.checked = !checked;
    showToast('Chọn một node trước');
    return;
  }
  updateLEDUI(checked);
  enqueue(function () {
    return sendCFML(
      'CONTROL:' + JSON.stringify({
        addr: state.selectedNode.addr,
        func: 'ONOFF',
        params: { onoff: checked ? 1 : 0 }
      }),
      15000
    )
    .then(function () { showToast(checked ? 'LED BẬT ✓' : 'LED TẮT ✓'); })
    .catch(function (e) { logFail('ONOFF error: ' + (e ? e.message || e : 'timeout')); });
  });
}

/**
 * Send a fixed color via BLE Mesh vendor model.
 * color_idx: 0=Red, 1=Green, 2=Blue, 3=Yellow, 4=White
 */
var COLOR_IDX = { 'FF0000': 0, '00FF00': 1, '0000FF': 2, 'FFFF00': 3, 'FFFFFF': 4 };

function sendFixedColor(hexStr, btnEl) {
  if (!state.selectedNode) { showToast('Chọn một node trước'); return; }
  var colorIdx = COLOR_IDX[hexStr.toUpperCase()];
  if (colorIdx === undefined) { showToast('Màu không hợp lệ'); return; }

  /* Update preview */
  var cp = ge('color-preview');
  if (cp) { cp.style.background = '#' + hexStr; cp.style.boxShadow = '0 0 14px #' + hexStr + '88'; }
  setEl('color-hex-label', '#' + hexStr.toUpperCase());

  /* Mark active button */
  var btns = document.querySelectorAll('.btn-color');
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
  if (btnEl) btnEl.classList.add('active');

  /* Turn LED on visually when color is sent */
  updateLEDUI(true);

  logInfo('Color → #' + hexStr + ' (idx=' + colorIdx + ')');

  enqueue(function () {
    return sendCFML(
      'CONTROL:' + JSON.stringify({
        addr: state.selectedNode.addr,
        func: 'VENDOR_COLOR',
        params: { color_idx: colorIdx }
      }),
      15000
    )
    .then(function () { showToast('Màu đã gửi ✓'); logOk('Color sent: #' + hexStr); })
    .catch(function (e) { logFail('VENDOR_COLOR error: ' + (e ? e.message || e : 'timeout')); });
  });
}

/* ────────────────────────────────────────────────────────────────────
   SENSOR CONTROL
   ──────────────────────────────────────────────────────────────────── */
function readSensor() {
  if (!state.selectedNode) { showToast('Chọn một node trước'); return; }
  enqueue(function () {
    return sendCFML(
      'GET_STATUS:' + JSON.stringify({ addr: state.selectedNode.addr, model: 'SENSOR' }),
      15000
    )
    .then(function (resp) {
      /* Expected: CFBN:SENSOR_DATA:{"temp":25.4,"humi":60.1} */
      try {
        var idx  = resp.indexOf('SENSOR_DATA:');
        if (idx >= 0) {
          var data = JSON.parse(resp.substring(idx + 'SENSOR_DATA:'.length).trim());
          if (data.temp !== undefined) setEl('sensor-temp', parseFloat(data.temp).toFixed(1));
          if (data.humi !== undefined) setEl('sensor-humi', parseFloat(data.humi).toFixed(1));
          logOk('Sensor: ' + JSON.stringify(data));
        }
      } catch (_) {}
    })
    .catch(function (e) { logFail('SENSOR read error: ' + (e ? e.message || e : 'timeout')); });
  });
}

/* ────────────────────────────────────────────────────────────────────
   UI RENDERS
   ──────────────────────────────────────────────────────────────────── */
function updateLEDUI(isOn) {
  var tog    = ge('led-toggle');
  var icon   = ge('led-icon');
  var status = ge('led-status-text');
  if (tog)    tog.checked     = isOn;
  if (icon)   icon.textContent = isOn ? '💡' : '🔦';
  if (status) status.textContent = isOn ? 'LED is ON' : 'LED is OFF';
}

function updateControlPanel() {
  var overlay  = ge('ctrl-overlay');
  var ledSec   = ge('section-led');
  var snsSec   = ge('section-sensor');
  var hdrCard  = ge('node-header-card');
  var typeBadge= ge('node-type-badge');

  if (!state.selectedNode) {
    if (overlay) overlay.classList.remove('hidden');
    if (hdrCard) hdrCard.style.display = 'none';
    return;
  }

  if (overlay) overlay.classList.add('hidden');
  if (hdrCard) hdrCard.style.display = '';

  setEl('node-name', state.selectedNode.name);
  setEl('node-addr', 'addr: ' + state.selectedNode.addr);

  var isLed = (state.selectedNode.type !== 'sensor');
  if (typeBadge) {
    typeBadge.textContent = isLed ? 'LED' : 'SENSOR';
    typeBadge.className   = 'node-type-badge' + (isLed ? '' : ' sensor');
  }
  if (ledSec) ledSec.classList.toggle('hidden', !isLed);
  if (snsSec) snsSec.classList.toggle('hidden', isLed);
}

function renderUnprovList() {
  var list = ge('unprov-list');
  if (!list) return;
  if (state.unprovDevices.length === 0) {
    list.innerHTML = '<div class="empty-hint">Không tìm thấy thiết bị</div>';
    return;
  }
  list.innerHTML = '';
  state.unprovDevices.forEach(function (dev) {
    var item = document.createElement('div');
    item.className = 'unprov-item';
    var uuid  = escJs(dev.uuid  || '');
    var name  = escJs(dev.name  || dev.uuid || 'Unknown');
    var cid   = escJs(String(dev.cid || ''));
    var rssi  = dev.rssi !== undefined ? dev.rssi : '—';
    item.innerHTML =
      '<div style="flex:1;overflow:hidden">' +
        '<div class="unprov-name">' + name + '</div>' +
        '<div class="unprov-uuid">' + uuid.substring(0, 12) + '... RSSI:' + rssi + '</div>' +
      '</div>' +
      '<button class="btn-provision" onclick="provisionDevice(\'' + uuid + '\',\'' + name + '\',\'' + cid + '\')">' +
        'Thêm' +
      '</button>';
    list.appendChild(item);
  });
}

function renderNodeList() {
  var list = ge('node-list');
  setEl('node-count', String(state.nodes.length));
  if (!list) return;
  if (state.nodes.length === 0) {
    list.innerHTML = '<div class="empty-hint">Chưa có node nào được cấu hình</div>';
    return;
  }
  list.innerHTML = '';
  state.nodes.forEach(function (node) {
    var isActive = state.selectedNode && state.selectedNode.addr === node.addr;
    var item = document.createElement('div');
    item.className = 'node-item' + (isActive ? ' active' : '');
    item.onclick   = function () { selectNode(node.addr); };
    var isSensor   = (node.type === 'sensor');
    item.innerHTML =
      '<div class="node-dot' + (isSensor ? ' sensor' : '') + '"></div>' +
      '<div class="node-item-name">' + escText(node.name) + '</div>' +
      '<div class="node-item-addr">' + escText(node.addr) + '</div>';
    list.appendChild(item);
  });
}

/* ────────────────────────────────────────────────────────────────────
   SLOT
   ──────────────────────────────────────────────────────────────────── */
function onSlotChange(val) {
  state.slot = String(val);
  saveNodes();
}

/* ────────────────────────────────────────────────────────────────────
   LOCAL STORAGE
   ──────────────────────────────────────────────────────────────────── */
var STORE_KEY = 'da2_mesh_nodes';

function saveNodes() {
  try {
    localStorage.setItem(STORE_KEY + '_' + state.slot, JSON.stringify(state.nodes));
  } catch (_) {}
}

function loadNodes() {
  try {
    var raw = localStorage.getItem(STORE_KEY + '_' + state.slot);
    if (raw) state.nodes = JSON.parse(raw) || [];
  } catch (_) { state.nodes = []; }
}

/* ────────────────────────────────────────────────────────────────────
   LOG
   ──────────────────────────────────────────────────────────────────── */
function logInfo(msg) { _log(msg, 'log-info'); }
function logOk(msg)   { _log(msg, 'log-ok'); }
function logFail(msg) { _log(msg, 'log-err'); }
function logObj(label, obj) { logInfo(label + ' ' + (typeof obj === 'string' ? obj : JSON.stringify(obj))); }

function _log(msg, cls) {
  var body = ge('log-body');
  if (!body) return;
  var ts   = new Date().toTimeString().slice(0, 8);
  var line = document.createElement('div');
  line.className = cls;
  line.textContent = '[' + ts + '] ' + msg;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
  /* Keep last 200 lines */
  while (body.children.length > 200) body.removeChild(body.firstChild);
}

function clearLog() {
  var body = ge('log-body');
  if (body) body.innerHTML = '';
}

/* ────────────────────────────────────────────────────────────────────
   TOAST
   ──────────────────────────────────────────────────────────────────── */
function showToast(msg) {
  var t = ge('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(function () { t.classList.add('hidden'); }, 2500);
}

/* ────────────────────────────────────────────────────────────────────
   UTILITIES
   ──────────────────────────────────────────────────────────────────── */
function escJs(s)   { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function escText(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard LIFECYCLE
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  try {
    controlApi = self.ctx && self.ctx.controlApi ? self.ctx.controlApi : null;
    /* Restore slot from TB ctx if available */
    if (self.ctx && self.ctx.settings && self.ctx.settings.slot !== undefined) {
      state.slot = String(self.ctx.settings.slot);
      var sel = ge('slot-select');
      if (sel) sel.value = state.slot;
    }
    loadNodes();
    renderNodeList();
    updateControlPanel();
    logInfo('BLE Mesh widget ready — slot ' + state.slot);
  } catch (e) {
    console.error('[Mesh Widget] onInit error:', e);
  }
};

self.onDestroy = function () {};

/* ────────────────────────────────────────────────────────────────────
   EXPOSE EXPORTS FOR THINGSBOARD HTML ONCLICK
   ──────────────────────────────────────────────────────────────────── */
window.onSlotChange      = onSlotChange;
window.startScan         = startScan;
window.provisionDevice   = provisionDevice;
window.selectNode        = selectNode;
window.refreshNodeList   = refreshNodeList;
window.resetNode         = resetNode;
window.onLedToggle       = onLedToggle;
window.sendFixedColor    = sendFixedColor;
window.readSensor        = readSensor;
window.clearLog          = clearLog;
