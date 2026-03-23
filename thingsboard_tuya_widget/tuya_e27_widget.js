cd DA2_esp
./build.sh/* =====================================================================
   Tuya E27 LED — ThingsBoard Control Widget — ESP32-S3 Native BLE Mesh
   RPC: sendCommand(CFML:CFBN:S1:<verb>) routed by Gateway
   ThingsBoard v4.x  Control widget

   Flow:
     1. Load provisioned nodes from localStorage on init
     2. 🔍 Scan  → CFML:CFBN:S1:SCAN:10000  → parse UNPROV_DEV lines
     3. + Provision → CFML:CFBN:S1:PROVISION:<uuid> → unicast addr assigned
     4. Select node → Control via CFML:CFBN:S1:CONTROL:{cmd,addr,params}

   Commands used (must be in JSON config loaded via CFML:CFBN:S1:JSON:{...}):
     ONOFF     — Generic OnOff (0x1000), params: {value:0|1}
     LIGHTNESS — Light Lightness (0x1300), params: {lightness:0-65535}
     CTL       — Light CTL (0x1303), params: {lightness, temperature(K), delta_uv}
   ===================================================================== */

/* -------------------------------------------------------------------
   STATE
------------------------------------------------------------------- */
var state = {
  slot: 0,              // BLE Mesh stack slot (0 = S1, 1 = S2)
  scanning: false,
  provisioning: false,
  selectedNode: null,   // { uuid, unicast, name }
  nodes: [],            // provisioned: [{ uuid, unicast, name }]
  unprovisioned: [],    // found by scan: [{ uuid, addr, name }]
  power: false,
  brightness: 75,
  cct: 30,
  rpcTimeout: 8000,
  cmdQueue: [],
  cmdBusy: false,
};

/* -------------------------------------------------------------------
   THINGSBOARD LIFECYCLE
------------------------------------------------------------------- */
self.onInit = function () {
  self.ctx.ngZone.run(function () {
    state.nodes = loadNodes();
    renderNodeList();
    if (state.nodes.length > 0) {
      showOverlay('\u2190 Ch\u1ecdn thi\u1ebft b\u1ecb \u0111\u1ec3 \u0111i\u1ec1u khi\u1ec3n', false);
    } else {
      showOverlay('Ch\u01b0a c\u00f3 thi\u1ebft b\u1ecb \u2014 nh\u1ea5n \ud83d\udd0d \u0111\u1ec3 qu\u00e9t', false);
    }
  });
};
self.onDestroy = function () {};

/* -------------------------------------------------------------------
   NODE PERSISTENCE (localStorage keyed by slot)
------------------------------------------------------------------- */
function nodeKey() { return 'cfbn_nodes_slot' + state.slot; }

function saveNodes() {
  try { localStorage.setItem(nodeKey(), JSON.stringify(state.nodes)); } catch (e) {}
}

function loadNodes() {
  try { return JSON.parse(localStorage.getItem(nodeKey()) || '[]'); } catch (e) { return []; }
}

/* -------------------------------------------------------------------
   RPC HELPERS
------------------------------------------------------------------- */
function sendRPC(method, params, timeout) {
  return new Promise(function (resolve, reject) {
    self.ctx.controlApi.sendTwoWayCommand(method, params, timeout || state.rpcTimeout)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err)  { console.error('[CFBN RPC]', err); reject(err); }
      );
  });
}

function sendCFBN(verb, timeout) {
  var slotLabel = 'S' + (state.slot + 1);   // 0 → S1, 1 → S2
  return sendRPC('sendCommand', 'CFML:CFBN:' + slotLabel + ':' + verb, timeout);
}

function enqueueControl(verb) {
  state.cmdQueue.push(verb);
  drainQueue();
}

function drainQueue() {
  if (state.cmdBusy || state.cmdQueue.length === 0) return;
  state.cmdBusy = true;
  var verb = state.cmdQueue.shift();
  sendCFBN(verb)
    .catch(function () {})
    .finally(function () { state.cmdBusy = false; drainQueue(); });
}

/* -------------------------------------------------------------------
   CONTROL VERBS  (cmd names must match JSON config command table)
------------------------------------------------------------------- */
function ctrlVerb(cmd, params) {
  var addr = state.selectedNode ? state.selectedNode.unicast : '0xFFFF';
  return 'CONTROL:' + JSON.stringify({ cmd: cmd, addr: addr, params: params });
}

function sendPower(on) {
  enqueueControl(ctrlVerb('ONOFF', { value: on ? 1 : 0 }));
}

function sendBrightness(pct) {
  // BLE Mesh Light Lightness: uint16, range 1\u201365535
  var lightness = Math.max(1, Math.round(pct / 100 * 65535));
  enqueueControl(ctrlVerb('LIGHTNESS', { lightness: lightness }));
}

function sendCCT(pct) {
  // Temperature: 2700K (warm, 0%) \u2192 6500K (cool, 100%)
  var temperature = Math.round(2700 + (pct / 100) * 3800);
  var lightness   = state.power ? Math.max(1, Math.round(state.brightness / 100 * 65535)) : 1;
  enqueueControl(ctrlVerb('CTL', { lightness: lightness, temperature: temperature, delta_uv: 0 }));
}

/* -------------------------------------------------------------------
   OVERLAY
------------------------------------------------------------------- */
function showOverlay(msg, withSpinner) {
  var overlay = document.getElementById('ctrl-overlay');
  var msgEl   = document.getElementById('overlay-msg');
  var spinEl  = document.getElementById('overlay-spinner');
  overlay.classList.remove('hidden');
  msgEl.textContent = msg;
  if (withSpinner) { spinEl.classList.remove('hidden'); }
  else             { spinEl.classList.add('hidden'); }
}
function hideOverlay() {
  document.getElementById('ctrl-overlay').classList.add('hidden');
}

/* -------------------------------------------------------------------
   SCAN
------------------------------------------------------------------- */
function setScanStatus(text, spinning) {
  document.getElementById('scan-status-text').textContent = text;
  var mini = document.getElementById('scan-spinner-mini');
  var btn  = document.getElementById('btn-rescan');
  if (spinning) {
    mini.classList.remove('hidden');
    btn.classList.add('spinning');
    btn.disabled = true;
  } else {
    mini.classList.add('hidden');
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

function startScan() {
  if (state.scanning) return;
  state.scanning      = true;
  state.unprovisioned = [];
  renderUnprovisionedList();
  setScanStatus('\u0110ang qu\u00e9t...', true);

  sendCFBN('SCAN:10000', 12000)
    .then(function (resp) { parseScanResponse(resp); })
    .catch(function () {})
    .finally(function () {
      state.scanning = false;
      var count = state.unprovisioned.length;
      setScanStatus(count > 0 ? count + ' ch\u01b0a provision' : 'Kh\u00f4ng t\u00ecm th\u1ea5y', false);
      renderUnprovisionedList();
      if (count === 0 && state.nodes.length === 0) {
        showOverlay('Kh\u00f4ng t\u00ecm th\u1ea5y thi\u1ebft b\u1ecb. Nh\u1ea5n \u27f3 \u0111\u1ec3 th\u1eed l\u1ea1i.', false);
      }
    });
}

function parseScanResponse(resp) {
  if (!resp) return;
  var text = typeof resp === 'string' ? resp
           : (resp.result || resp.value || JSON.stringify(resp));
  // Expected line format: CFBN:<slot>:OK:UNPROV_DEV:<uuid32hex>:<mac>:<oob>
  text.split(/[\n\x1E]+/).forEach(function (line) {
    var m = line.match(/CFBN:\d+:OK:UNPROV_DEV:([0-9A-Fa-f]{32}):([0-9A-Fa-f:]+)/i);
    if (m) {
      var uuid = m[1].toUpperCase();
      var mac  = m[2].toUpperCase();
      if (!state.unprovisioned.find(function (d) { return d.uuid === uuid; })) {
        state.unprovisioned.push({
          uuid: uuid,
          addr: mac,
          name: 'BLE Mesh \u2026' + uuid.substring(28),  // last 4 hex of UUID as hint
        });
      }
    }
  });
}

/* -------------------------------------------------------------------
   PROVISION
------------------------------------------------------------------- */
function provisionDevice(dev) {
  if (state.provisioning) return;
  state.provisioning = true;
  showOverlay('Provision ' + dev.name + '\u2026', true);

  sendCFBN('PROVISION:' + dev.uuid, 30000)
    .then(function (resp) {
      var text = typeof resp === 'string' ? resp : (resp.result || resp.value || '');
      // Expected: CFBN:<slot>:OK:PROVISIONED:0x0002:<uuid>
      var m = text.match(/CFBN:\d+:OK:PROVISIONED:(0x[0-9A-Fa-f]+)/i);
      if (m) {
        var unicast = m[1].toLowerCase();
        var node    = { uuid: dev.uuid, unicast: unicast, name: dev.name };
        state.nodes.push(node);
        state.unprovisioned = state.unprovisioned.filter(function (d) { return d.uuid !== dev.uuid; });
        saveNodes();
        renderNodeList();
        renderUnprovisionedList();
        hideOverlay();
        showToast('\u2705 ' + dev.name + ' \u2192 ' + unicast);
      } else {
        hideOverlay();
        showOverlay('Provision th\u1ea5t b\u1ea1i. Th\u1eed l\u1ea1i.', false);
      }
    })
    .catch(function () {
      hideOverlay();
      showOverlay('L\u1ed7i provision (timeout?). Th\u1eed l\u1ea1i.', false);
    })
    .finally(function () { state.provisioning = false; });
}

/* -------------------------------------------------------------------
   NODE SELECTION
------------------------------------------------------------------- */
function selectNode(node) {
  state.selectedNode = node;
  document.getElementById('ctrl-device-name').textContent =
    node.name + ' (' + node.unicast + ')';
  document.getElementById('btn-remove-node').classList.remove('hidden');
  setStatusDot('on');
  hideOverlay();

  state.power = true;
  updatePowerUI(true);
  updateBrightnessUI(state.brightness);
  updateCCTUI(state.cct);

  // Push initial state to device on selection
  sendPower(true);
  sendBrightness(state.brightness);
}

function removeSelectedNode() {
  if (!state.selectedNode) return;
  state.nodes = state.nodes.filter(function (n) {
    return n.unicast !== state.selectedNode.unicast;
  });
  saveNodes();
  state.selectedNode = null;
  document.getElementById('ctrl-device-name').textContent = '\u2014';
  document.getElementById('btn-remove-node').classList.add('hidden');
  setStatusDot('off');
  renderNodeList();
  showOverlay(state.nodes.length > 0
    ? '\u2190 Ch\u1ecdn thi\u1ebft b\u1ecb \u0111\u1ec3 \u0111i\u1ec1u khi\u1ec3n'
    : 'Ch\u01b0a c\u00f3 thi\u1ebft b\u1ecb \u2014 nh\u1ea5n \ud83d\udd0d \u0111\u1ec3 qu\u00e9t', false);
}

/* -------------------------------------------------------------------
   STATUS DOT
------------------------------------------------------------------- */
function setStatusDot(s) {
  document.getElementById('status-dot').setAttribute('data-state', s);
}

/* -------------------------------------------------------------------
   RENDER LISTS
------------------------------------------------------------------- */
function renderNodeList() {
  var list = document.getElementById('device-list');
  list.innerHTML = '';
  if (state.nodes.length === 0) {
    list.innerHTML = '<div class="no-devices-msg">Ch\u01b0a c\u00f3 thi\u1ebft b\u1ecb<br>Nh\u1ea5n \ud83d\udd0d \u0111\u1ec3 qu\u00e9t</div>';
    return;
  }
  state.nodes.forEach(function (node) {
    var item = document.createElement('div');
    item.className = 'device-item' +
      (state.selectedNode && state.selectedNode.unicast === node.unicast ? ' selected' : '');
    item.innerHTML =
      '<span class="device-icon">\ud83d\udca1</span>' +
      '<div class="device-info">' +
        '<span class="device-name">' + escapeHtml(node.name) + '</span>' +
        '<span class="device-addr">' + escapeHtml(node.unicast) + '</span>' +
      '</div>';
    item.addEventListener('click', function () { selectNode(node); });
    list.appendChild(item);
  });
}

function renderUnprovisionedList() {
  var section = document.getElementById('unprov-section');
  var list    = document.getElementById('unprov-list');
  list.innerHTML = '';
  if (state.unprovisioned.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  state.unprovisioned.forEach(function (dev) {
    var item = document.createElement('div');
    item.className = 'device-item unprov';
    item.innerHTML =
      '<span class="device-icon">\ud83d\udce1</span>' +
      '<div class="device-info">' +
        '<span class="device-name">' + escapeHtml(dev.name) + '</span>' +
        '<span class="device-addr">' + escapeHtml(dev.addr) + '</span>' +
      '</div>' +
      '<button class="btn-provision" title="Provision thi\u1ebft b\u1ecb n\u00e0y">+</button>';
    item.querySelector('.btn-provision').addEventListener('click', function (e) {
      e.stopPropagation();
      provisionDevice(dev);
    });
    list.appendChild(item);
  });
}

/* -------------------------------------------------------------------
   POWER
------------------------------------------------------------------- */
function onPowerToggle(checked) {
  state.power = checked;
  updatePowerUI(checked);
  sendPower(checked);
}

function updatePowerUI(on) {
  document.getElementById('bulb-preview').className = 'bulb-preview ' + (on ? 'on' : 'off');
  document.getElementById('power-label').textContent = on ? 'B\u1eacT' : 'T\u1eaeT';
  document.getElementById('power-toggle').checked = on;
  document.getElementById('section-brightness').className = 'ctrl-section' + (on ? '' : ' dimmed');
  document.getElementById('section-cct').className        = 'ctrl-section' + (on ? '' : ' dimmed');
  if (on) { updatePreviewColor(); }
  else    { document.getElementById('bulb-glow').style.opacity = '0'; }
}

/* -------------------------------------------------------------------
   BRIGHTNESS
------------------------------------------------------------------- */
function onBrightnessInput(val) {
  state.brightness = parseInt(val);
  updateBrightnessUI(state.brightness);
}
function onBrightnessChange(val) {
  state.brightness = parseInt(val);
  if (state.power) sendBrightness(state.brightness);
}
function updateBrightnessUI(pct) {
  document.getElementById('brightness-value').textContent = pct + '%';
  var s = document.getElementById('brightness-slider');
  s.value = pct;
  s.style.background = 'linear-gradient(to right, #e0a000 0%, #e0a000 ' + pct + '%, #1e2a40 ' + pct + '%, #1e2a40 100%)';
  updatePreviewColor();
}

/* -------------------------------------------------------------------
   CCT
------------------------------------------------------------------- */
function onCCTInput(val)   { state.cct = parseInt(val); updateCCTUI(state.cct); }
function onCCTChange(val)  { state.cct = parseInt(val); if (state.power) sendCCT(state.cct); }
function updateCCTUI(pct) {
  var tempK = Math.round(2700 + (pct / 100) * 3800);
  document.getElementById('cct-value').textContent = tempK + 'K';
  document.getElementById('cct-slider').value = pct;
  updatePreviewColor();
}

/* -------------------------------------------------------------------
   PREVIEW COLOR
------------------------------------------------------------------- */
function updatePreviewColor() {
  var glow    = document.getElementById('bulb-glow');
  var preview = document.getElementById('bulb-preview');
  if (!state.power) { glow.style.opacity = '0'; return; }
  var t   = state.cct / 100;
  var r   = 255;
  var g   = Math.round(160 + 80 * t);
  var b   = Math.round(64 + 191 * t);
  var a   = 0.3 + (state.brightness / 100) * 0.5;
  glow.style.background = 'radial-gradient(circle, rgba(' + r + ',' + g + ',' + b + ',' + a + ') 0%, transparent 70%)';
  glow.style.opacity    = '1';
  preview.style.background = state.brightness > 50
    ? 'linear-gradient(135deg, #2d2610, #3e3210, #2d2610)'
    : 'var(--surface)';
}

/* -------------------------------------------------------------------
   UTILITIES
------------------------------------------------------------------- */
var toastTimer = null;
function showToast(msg) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 2500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

