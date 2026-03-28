/* =====================================================================
   ESP32-C6 BLE GATT Peripheral — ThingsBoard Control Widget — NATIVE GATT
   Protocol: CFML:CFBG:<cmd> (native GATT, no AT commands)
   
   Service FFF0:
     - Char FFF1 (READ|NOTIFY): Counter value (4-byte uint32-LE)
     - Char FFF2 (WRITE): LED control (0x00=OFF, 0x01=ON)
   
   Gateway GATT commands:
     CFML:CFBG:SCAN:<duration_ms>        → scan for devices
     CFML:CFBG:CONNECT:<mac>             → connect to device
     CFML:CFBG:DISCOVER:<mac>            → discover services
     CFML:CFBG:READ:<mac>:<uuid>         → read characteristic
     CFML:CFBG:WRITE:<mac>:<uuid>:<hex>  → write characteristic
     CFML:CFBG:SUBSCRIBE:<mac>:<uuid>    → enable notifications
   
   ===================================================================== */

/* -------------------------------------------------------------------
   STATE
------------------------------------------------------------------- */
var state = {
  slot       : 0,                     // Gateway stack slot
  targetName : 'DA2_TEST_GATT',       // Target device name
  mac        : null,                  // Connected device MAC
  connected  : false,
  scanning   : false,
  connecting : false,
  
  // GATT characteristic UUIDs (lowercase for comparison)
  svc_uuid   : '0000fff0-0000-1000-8000-00805f9b34fb',  // Service
  fff1_uuid  : '0000fff1-0000-1000-8000-00805f9b34fb',  // Counter (RD|NT)
  fff2_uuid  : '0000fff2-0000-1000-8000-00805f9b34fb',  // LED (WR)
  
  // Discovered handles
  fff1_handle: null,
  fff2_handle: null,
  
  // GATT data
  counterVal : 0,
  ledState   : false,                 // false=OFF, true=ON
  scanResults: [],                    // [{ mac, rssi, name }]
  
  rpcTimeout : 15000,
  cmdBusy    : false,
};

/* -------------------------------------------------------------------
   THINGSBOARD LIFECYCLE
------------------------------------------------------------------- */
self.onInit = function () {
  self.ctx.ngZone.run(function () {
    loadLocalState();
    renderDeviceList([]);
    if (state.connected) {
      applyConnectedUI();
    } else {
      showOverlay('← Scan and connect device', false);
    }
  });
};

self.onDestroy = function () {};

/* -------------------------------------------------------------------
   PERSISTENCE (localStorage)
------------------------------------------------------------------- */
function storageKey() { return 'GATT_widget_' + state.slot; }

function saveLocalState() {
  try {
    var data = {
      slot       : state.slot,
      targetName : state.targetName,
      mac        : state.mac,
      connected  : state.connected,
      counterVal : state.counterVal,
      ledState   : state.ledState,
      fff1_handle: state.fff1_handle,
      fff2_handle: state.fff2_handle,
    };
    localStorage.setItem(storageKey(), JSON.stringify(data));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem(storageKey());
    if (!raw) return;
    var d = JSON.parse(raw);
    state.slot        = d.slot        !== undefined ? d.slot        : state.slot;
    state.targetName  = d.targetName  || state.targetName;
    state.mac         = d.mac         || null;
    state.connected   = d.connected   || false;
    state.counterVal  = d.counterVal  || 0;
    state.ledState    = d.ledState    || false;
    state.fff1_handle = d.fff1_handle || null;
    state.fff2_handle = d.fff2_handle || null;
    
    document.getElementById('cfg-slot').value       = state.slot;
    document.getElementById('cfg-device-name').value= state.targetName;
  } catch (e) {}
}

/* -------------------------------------------------------------------
   CONFIG CALLBACKS
------------------------------------------------------------------- */
function onSlotChange(val) {
  state.slot = parseInt(val);
  loadLocalState();
  logInfo('Slot → S' + (state.slot + 1));
}

function onDeviceNameChange(val) {
  state.targetName = val.trim();
  saveLocalState();
  logInfo('Target device → ' + state.targetName);
}

/* -------------------------------------------------------------------
   RPC HELPERS
------------------------------------------------------------------- */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs || state.rpcTimeout)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err)  { reject(err); }
      );
  });
}

function stringToHex(str) {
  var hex = '';
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i).toString(16).toUpperCase();
    if (code.length === 1) code = '0' + code;
    hex += code;
  }
  return hex;
}

function hexToString(hex) {
  var str = '';
  for (var i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return str;
}

function sendCFML(gattCmd, timeoutMs) {
  var cmd = 'CFML:CFBG:' + gattCmd;
  logTx(cmd);
  var hexCmd = stringToHex(cmd);
  return sendRPC('sendCommand', hexCmd, timeoutMs || state.rpcTimeout);
}

/* -------------------------------------------------------------------
   RESPONSE PARSERS
------------------------------------------------------------------- */
function parseLines(resp) {
  var text = typeof resp === 'string' ? resp
           : (resp && (resp.result || resp.value || JSON.stringify(resp))) || '';
           
  if (/^[0-9A-Fa-f]+$/.test(text) && text.length % 2 === 0) {
    text = hexToString(text);
  }
  
  return text.split(/[\x1E\n]+/).map(function (l) { return l.trim(); })
             .filter(function (l) { return l.length > 0; });
}

function parseScanLines(resp) {
  var devices = [];
  var lines = parseLines(resp);
  lines.forEach(function (line) {
    // Match +SCAN: line
    var m = line.match(/\+SCAN:([0-9A-Fa-f:]{17}),(-?\d+),(.*)$/);
    if (m) {
      devices.push({
        mac  : m[1].toUpperCase(),
        rssi : parseInt(m[2]),
        name : m[3].trim() || 'Unknown',
      });
    }
  });
  return devices;
}

function parseConnectResult(resp) {
  var text = typeof resp === 'string' ? resp : (resp && (resp.result || resp.value || '')) || '';
  if (text.indexOf('FAIL') !== -1 || text.indexOf('ERROR') !== -1) {
    return false;
  }
  if (text.indexOf('CONNECTED') !== -1 || text.indexOf('OK') !== -1) {
    return true;
  }
  return true;  // assume OK if response received
}

function parseDiscoverResult(resp) {
  var text = typeof resp === 'string' ? resp : (resp && (resp.result || resp.value || '')) || '';
  if (text.indexOf('OK') !== -1 || text.indexOf('DISCOVER') !== -1) {
    return true;
  }
  return false;
}

function logCFMLResponse(resp) {
  var lines = parseLines(resp);
  lines.forEach(function (l) {
    var ul = l.toUpperCase();
    if (ul.indexOf('FAIL') !== -1 || ul.indexOf('ERROR') !== -1) {
      logFail(l);
    } else if (ul.indexOf('OK') !== -1) {
      logOk(l);
    } else if (l.indexOf('+') === 0) {
      logEvt(l);
    } else if (l.length > 0) {
      logInfo(l);
    }
  });
}

/* -------------------------------------------------------------------
   AUTO-CONNECT
------------------------------------------------------------------- */
function startAutoConnect() {
  if (state.connected) return;
  
  state.scanning = true;
  setScanSpinner(true);
  document.getElementById('scan-status-text').textContent = 'Auto-scanning...';

  sendCFML(state.slot + ':SCAN:5000', 8000)
    .then(function (resp) {
      logCFMLResponse(resp);
      state.scanResults = parseScanLines(resp);
      
      // Find device matching targetName
      var found = null;
      for (var i = 0; i < state.scanResults.length; i++) {
        if (state.scanResults[i].name === state.targetName) {
          found = state.scanResults[i];
          break;
        }
      }
      
      if (!found) {
        throw new Error('Device "' + state.targetName + '" not found in scan');
      }
      
      return connectToMAC(found.mac);
    })
    .catch(function (e) {
      logFail('Auto-connect error: ' + (e ? e.message || e : 'timeout'));
      state.connected = false;
      setStatusDot('off');
      showOverlay('Connection failed. Try manual scan.', false);
    })
    .finally(function () {
      state.scanning = false;
      setScanSpinner(false);
      var count = state.scanResults.length;
      document.getElementById('scan-status-text').textContent =
        count > 0 ? count + ' devices' : 'No devices';
      renderDeviceList(state.scanResults);
    });
}

/* -------------------------------------------------------------------
   SCAN
------------------------------------------------------------------- */
function setScanSpinner(on) {
  var btn  = document.getElementById('btn-scan');
  var mini = document.getElementById('scan-spinner-mini');
  if (on) {
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
  if (state.scanning || state.connecting) return;
  
  state.scanning = true;
  state.scanResults = [];
  renderDeviceList([]);
  setScanSpinner(true);
  document.getElementById('scan-status-text').textContent = 'Scanning...';

  sendCFML(state.slot + ':SCAN:5000', 15000)
    .then(function (resp) {
      logCFMLResponse(resp);
      state.scanResults = parseScanLines(resp);
    })
    .catch(function (e) {
      logFail('SCAN error: ' + (e ? e.message || e : 'timeout'));
    })
    .finally(function () {
      state.scanning = false;
      setScanSpinner(false);
      var count = state.scanResults.length;
      document.getElementById('scan-status-text').textContent =
        count > 0 ? count + ' devices' : 'No devices';
      renderDeviceList(state.scanResults);
    });
}

/* -------------------------------------------------------------------
   RENDER DEVICE LIST
------------------------------------------------------------------- */
function renderDeviceList(devices) {
  var list = document.getElementById('device-list');
  list.innerHTML = '';

  if (devices.length === 0) {
    list.innerHTML = '<div class="no-devices-msg">Click &#8635; to scan for BLE devices</div>';
    return;
  }

  devices.forEach(function (dev) {
    var isConnected = state.connected && state.mac === dev.mac;
    var item = document.createElement('div');
    item.className = 'device-item' + (isConnected ? ' selected' : '');
    item.innerHTML =
      '<span class="device-icon">&#128246;</span>' +
      '<div class="device-info">' +
        '<span class="device-name">' + escapeHtml(dev.name) + '</span>' +
        '<span class="device-addr">' + escapeHtml(dev.mac) + '</span>' +
      '</div>' +
      '<span class="device-rssi">' + dev.rssi + 'dBm</span>' +
      (isConnected
        ? ''
        : '<button class="btn-connect" onclick="connectToDevice(\'' + dev.mac + '\',\'' +
          escapeHtml(dev.name).replace(/'/g, "\\'") + '\')">⚡</button>');
    list.appendChild(item);
  });
}

/* -------------------------------------------------------------------
   CONNECT / DISCONNECT  
------------------------------------------------------------------- */
function connectToDevice(mac, name) {
  connectToMAC(mac, name);
}

function connectToMAC(mac, name) {
  if (state.connected || state.connecting) return;
  
  state.connecting = true;
  name = name || 'Device';
  setStatusDot('connecting');
  showOverlay('Connecting to ' + name + '...', true);

  sendCFML(state.slot + ':CONNECT:' + mac, 6000)
    .then(function (resp) {
      logCFMLResponse(resp);
      
      if (!parseConnectResult(resp)) {
        throw new Error('Connection refused');
      }
      
      state.mac = mac;
      state.connected = true;
      saveLocalState();
      
      // Now discover services
      logInfo('Connected. Discovering GATT...');
      return sendCFML(state.slot + ':DISCOVER:' + mac, 6000);
    })
    .then(function (resp) {
      logCFMLResponse(resp);
      parseDiscoverHandles(resp);
      
      if (!state.fff1_handle || !state.fff2_handle) {
        logInfo('Handles not in discovery. Using defaults: FFF1=2, FFF2=3.');
        state.fff1_handle = 2;
        state.fff2_handle = 3;
      }
      
      applyConnectedUI();
      
      // Subscribe to FFF1 notifications
      logInfo('Subscribing to FFF1 notifications...');
      return sendCFML(state.slot + ':SUBSCRIBE:' + mac + ':' + state.fff1_uuid, 3000);
    })
    .then(function (resp) {
      logCFMLResponse(resp);
      logInfo('✓ GATT ready. Listening for notifications and polling counter.');
      showToast('✅ Connected: ' + name);
      startNotificationListener();
    })
    .catch(function (e) {
      logFail('Connection error: ' + (e ? e.message || e : 'timeout'));
      state.connected = false;
      state.connecting = false;
      setStatusDot('off');
      showOverlay('Connection failed. Try again.', false);
    })
    .finally(function () {
      state.connecting = false;
    });
}

function parseDiscoverHandles(resp) {
  var text = typeof resp === 'string' ? resp : (resp && (resp.result || resp.value || '')) || '';
  var lines = parseLines(text);
  lines.forEach(function (line) {
    if (line.toUpperCase().indexOf('FFF1') !== -1) {
      var m = line.match(/(\d+)/);
      if (m) state.fff1_handle = parseInt(m[1]);
    }
    if (line.toUpperCase().indexOf('FFF2') !== -1) {
      var m = line.match(/(\d+)/);
      if (m) state.fff2_handle = parseInt(m[1]);
    }
  });
}

function applyConnectedUI() {
  setStatusDot('connected');
  document.getElementById('ctrl-device-name').textContent = state.mac || 'Connected Device';
  document.getElementById('btn-disconnect').classList.remove('hidden');
  hideOverlay();
  renderDeviceList(state.scanResults);
  
  // Update GATT info display
  document.getElementById('service-uuid').textContent = state.svc_uuid.substring(0, 8) + '...';
  document.getElementById('handle-fff1').textContent = state.fff1_handle ? '0x' + state.fff1_handle.toString(16) : '—';
  document.getElementById('handle-fff2').textContent = state.fff2_handle ? '0x' + state.fff2_handle.toString(16) : '—';
  updateLEDUI();
}

function disconnectDevice() {
  if (!state.connected) return;
  
  state.connected = false;
  state.mac = null;
  state.counterVal = 0;
  state.ledState = false;
  saveLocalState();
  
  setStatusDot('off');
  document.getElementById('ctrl-device-name').textContent = '—';
  document.getElementById('btn-disconnect').classList.add('hidden');
  document.getElementById('counter-value').textContent = '—';
  document.getElementById('led-icon').classList.remove('on');
  document.getElementById('led-state').textContent = 'OFF';
  
  renderDeviceList(state.scanResults);
  showOverlay('← Scan and connect device', false);
  showToast('Disconnected');
}

/* -------------------------------------------------------------------
   NOTIFICATION LISTENER & POLLING
------------------------------------------------------------------- */
function startNotificationListener() {
  // Poll counter every 2 seconds
  setInterval(function () {
    if (state.connected && state.mac) {
      pollCounterUpdate();
    }
  }, 2000);
}

function pollCounterUpdate() {
  sendCFML(state.slot + ':READ:' + state.mac + ':' + state.fff1_uuid, 3000)
    .then(function (resp) {
      var text = typeof resp === 'string' ? resp : (resp && (resp.result || resp.value || '')) || '';
      
      // Try to extract hex value from response
      var m = text.match(/([0-9A-Fa-f]{8})/i);
      if (m) {
        var hex = m[1];
        state.counterVal = hexToUint32LE(hex);
        document.getElementById('counter-value').textContent = state.counterVal.toString();
      }
    })
    .catch(function () {});  // Silently fail
}

function hexToUint32LE(hexStr) {
  if (hexStr.length < 8) return 0;
  var b0 = parseInt(hexStr.substring(0, 2), 16) || 0;
  var b1 = parseInt(hexStr.substring(2, 4), 16) || 0;
  var b2 = parseInt(hexStr.substring(4, 6), 16) || 0;
  var b3 = parseInt(hexStr.substring(6, 8), 16) || 0;
  return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

/* -------------------------------------------------------------------
   LED CONTROL (FFF2 WRITE)
------------------------------------------------------------------- */
function sendLedCommand(onOff) {
  if (!state.connected || !state.mac) {
    showToast('Device not connected');
    return;
  }
  
  // FFF2 expects 0x00 (OFF) or 0x01 (ON)
  var hex = onOff ? '01' : '00';
  var cmd = state.slot + ':WRITE:' + state.mac + ':' + state.fff2_uuid + ':' + hex;
  
  state.ledState = (onOff !== 0);
  updateLEDUI();
  
  sendCFML(cmd, 3000)
    .then(function (resp) {
      logOk('LED ' + (state.ledState ? 'ON' : 'OFF'));
      logCFMLResponse(resp);
    })
    .catch(function (e) {
      logFail('LED write error: ' + (e ? e.message || e : 'timeout'));
      state.ledState = !state.ledState;
      updateLEDUI();
    });
}

function updateLEDUI() {
  var icon = document.getElementById('led-icon');
  var state_el = document.getElementById('led-state');
  var btn_on = document.getElementById('btn-led-on');
  var btn_off = document.getElementById('btn-led-off');
  
  if (state.ledState) {
    icon.classList.add('on');
    state_el.textContent = 'ON (Green)';
    if (btn_on) btn_on.classList.add('active');
    if (btn_off) btn_off.classList.remove('active');
  } else {
    icon.classList.remove('on');
    state_el.textContent = 'OFF';
    if (btn_on) btn_on.classList.remove('active');
    if (btn_off) btn_off.classList.add('active');
  }
}

/* -------------------------------------------------------------------
   OVERLAY / STATUS DOT
------------------------------------------------------------------- */
function showOverlay(msg, withSpinner) {
  var ov = document.getElementById('ctrl-overlay');
  var msg_el = document.getElementById('overlay-msg');
  var spin = document.getElementById('overlay-spinner');
  ov.classList.remove('hidden');
  msg_el.textContent = msg;
  if (withSpinner) { spin.classList.remove('hidden'); }
  else { spin.classList.add('hidden'); }
}

function hideOverlay() {
  document.getElementById('ctrl-overlay').classList.add('hidden');
}

function setStatusDot(st) {
  document.getElementById('status-dot').setAttribute('data-state', st);
}

/* -------------------------------------------------------------------
   CONSOLE LOG
------------------------------------------------------------------- */
function logToConsole(cls, text) {
  var log = document.getElementById('console-log');
  if (!log) return;
  var line = document.createElement('div');
  line.className = cls;
  var time = new Date().toLocaleTimeString();
  line.textContent = '[' + time + '] ' + text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  while (log.childNodes.length > 200) { log.removeChild(log.firstChild); }
}

function logTx(t)   { logToConsole('log-tx',   '→ ' + t); }
function logOk(t)   { logToConsole('log-ok',   '← ' + t); }
function logFail(t) { logToConsole('log-fail', '✗ ' + t); }
function logInfo(t) { logToConsole('log-info', '  ' + t); }
function logEvt(t)  { logToConsole('log-evt',  '★ ' + t); }
function clearLog() { var l = document.getElementById('console-log'); if (l) l.innerHTML = ''; }

/* -------------------------------------------------------------------
   UTILITIES
------------------------------------------------------------------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

var toastTimer = null;
function showToast(msg) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.add('hidden');
  }, 2500);
}

/* ────────────────────────────────────────────────────────────────────
   EXPOSE EXPORTS FOR THINGSBOARD HTML ONCLICK
   ──────────────────────────────────────────────────────────────────── */
window.onSlotChange       = onSlotChange;
window.onDeviceNameChange = onDeviceNameChange;
window.startAutoConnect   = startAutoConnect;
window.startScan          = startScan;
window.connectToDevice    = connectToDevice;
window.disconnectDevice   = disconnectDevice;
window.sendLedCommand     = sendLedCommand;
window.clearLog           = clearLog;

