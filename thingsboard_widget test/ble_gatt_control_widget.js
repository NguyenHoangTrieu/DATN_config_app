/* =====================================================================
   DA2 BLE GATT Control Widget — ThingsBoard Control Widget (RPC)
   Protocol:
     TX: CFML:CFBG:<slot>:<verb>:<params>  (hex-encoded via RPC sendCommand)
     RX: CFBG:OK:<payload> | CFBG:FAIL:<reason>  (lines split by \x1E)

   Responsibilities:
     - SCAN, CONNECT, DISC (auto), NOTIFY-enable, WRITE, DISCONNECT
     - LED control: ON/OFF + RGB color presets
     - Sensor: connects + enables NOTIFY so data streams to telemetry
       Data is displayed in the companion BLE Sensor Monitor widget (Latest Values)

   IMPORTANT ThingsBoard notes:
     - Avoid .finally() — not polyfilled in all TB versions
     - Avoid Object.values() — use Object.keys() loop only
   ===================================================================== */

/* ═══════════════════════════════════════════════════════════════════
   App State
   ═══════════════════════════════════════════════════════════════════ */
var state = {
  slot:        '0',
  scanning:    false,
  scanResults: [],   /* [{idx, mac, rssi, name, type, connected}] */
  connected:   {},   /* key=devIdx → {idx, mac, name, type, connId, chars, aa11Handle, cccdHandle, fff2Handle} */
  selectedIdx: null,
  ledState:    {},   /* key=devIdx → {on, colorHex} */
  cmdQueue:    [],
  cmdPending:  false,
  rpcTimeout:  12000,
  savedDevices:    [],
  pendingConnects: {}
};

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
self.onInit = function () {
  try {
    loadSavedDevices();
    renderGrid();
    renderScanList([]);
    setStatus('idle', 'Idle');
    logInfo('Widget ready — using stack ' + state.slot);
  } catch (e) {
    logFail('onInit: ' + e);
  }
};

self.onDestroy = function () {};

/* Receives async telemetry events (NOTIFY, CONNECTED, DISCONNECTED) from gateway */
self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      var latest  = kd.data[kd.data.length - 1];
      var raw     = latest[1];
      var decoded = decodeRpcValue(raw);
      splitLines(decoded).forEach(function (line) { handleAsyncLine(line); });
    }
  } catch (e) {
    logFail('onDataUpdated: ' + e);
  }
};

/* ═══════════════════════════════════════════════════════════════════
   RPC / Encoding helpers
   ═══════════════════════════════════════════════════════════════════ */
function sendRpc(method, params, timeout) {
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi — assign a target device in widget settings'));
      return;
    }
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeout)
      .subscribe(
        function (r) { resolve(r); },
        function (e) { reject(e); }
      );
  });
}

function strToHex(s) {
  var h = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i).toString(16);
    h += (c.length === 1 ? '0' : '') + c;
  }
  return h.toUpperCase();
}

function hexToStr(h) {
  var s = '';
  for (var i = 0; i < h.length; i += 2) {
    var b = parseInt(h.substr(i, 2), 16);
    if (!isNaN(b)) s += String.fromCharCode(b);
  }
  return s;
}

function decodeRpcValue(val) {
  if (!val) return '';
  if (typeof val === 'object') {
    if (val.result !== undefined) val = val.result;
    else if (val.data !== undefined) val = val.data;
  }
  var s = String(val);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    s = hexToStr(s);
  }
  return s;
}

function splitLines(s) {
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    var ci = x.indexOf('CFBG:');
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

function sendCFBG(verb, params, timeout) {
  var cmd = 'CFML:CFBG:' + state.slot + ':' + verb + (params ? ':' + params : '');
  logTx(cmd);
  var hex = strToHex(cmd);
  return sendRpc('sendCommand', hex, timeout || state.rpcTimeout)
    .then(function (resp) {
      var decoded = decodeRpcValue(resp);
      if (decoded) {
        splitLines(decoded).forEach(function (line) { logRx(line); });
      }
      return decoded;
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      logFail('RPC error: ' + msg);
      showToast('⚠ ' + msg);
      throw err;
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Command Queue — serialize all CFBG operations
   ═══════════════════════════════════════════════════════════════════ */
function enqueue(fn) {
  return new Promise(function (resolve, reject) {
    state.cmdQueue.push({ fn: fn, resolve: resolve, reject: reject });
    drainQueue();
  });
}

function drainQueue() {
  if (state.cmdPending || state.cmdQueue.length === 0) return;
  var item = state.cmdQueue.shift();
  state.cmdPending = true;
  try {
    item.fn()
      .then(function (v) { state.cmdPending = false; item.resolve(v); drainQueue(); })
      .catch(function (e) { state.cmdPending = false; item.reject(e); drainQueue(); });
  } catch (e) {
    state.cmdPending = false;
    item.reject(e);
    drainQueue();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Scan
   ═══════════════════════════════════════════════════════════════════ */
function startScan() {
  if (state.scanning) return;
  state.scanning = true;
  state.scanResults = [];
  setStatus('scanning', 'Scanning…');
  setBtnScan(true);
  renderScanList([]);
  logInfo('Starting scan (5000 ms)…');

  enqueue(function () {
    return sendCFBG('SCAN', '5000', 15000)
      .then(function (resp) {
        var results = parseScanDone(resp);
        if (results.length === 0 && state.scanResults.length > 0) {
          results = state.scanResults;
        } else if (results.length > 0) {
          state.scanResults = results;
          renderScanList(results);
        }
        var cnt = state.scanResults.length;
        var connCount = Object.keys(state.connected).length;
        setStatus(connCount > 0 ? 'connected' : 'idle',
                  cnt + ' device' + (cnt !== 1 ? 's' : '') + ' found');
        logInfo('Scan complete — ' + cnt + ' device(s)');
        showToast('Found ' + cnt + ' device(s)');
        state.scanning = false;
        setBtnScan(false);
      })
      .catch(function (err) {
        logFail('Scan failed: ' + (err && err.message ? err.message : err));
        setStatus('idle', 'Scan failed');
        state.scanning = false;
        setBtnScan(false);
      });
  });
}

function parseScanDone(resp) {
  var lines   = splitLines(resp);
  var results = [];
  lines.forEach(function (line) {
    var l = line.replace(/^CFBG:(OK|FAIL):/, '');
    var m = l.match(/^SCAN_RESULT:(\d+),([0-9a-fA-F:]{17}),(-?\d+),(.*)/);
    if (!m) return;
    var idx  = parseInt(m[1], 10);
    var mac  = m[2].toLowerCase();
    var rssi = parseInt(m[3], 10);
    var name = m[4] || ('Device_' + idx);
    results.push({ idx: idx, mac: mac, rssi: rssi, name: name, type: detectType(name), connected: !!state.connected[idx] });
  });
  return results;
}

/* ═══════════════════════════════════════════════════════════════════
   Connect
   ═══════════════════════════════════════════════════════════════════ */
function connectDevice(scanIdx, mac, name) {
  /* Prevent duplicate connection to the same MAC */
  if (isDeviceConnected(mac)) {
    logInfo(name + ' (' + mac + ') is already connected — selecting panel');
    var ckeys = Object.keys(state.connected);
    for (var cki = 0; cki < ckeys.length; cki++) {
      if (state.connected[ckeys[cki]].mac === mac) {
        selectDevice(state.connected[ckeys[cki]].idx);
        break;
      }
    }
    return;
  }
  /* Prevent duplicate connect-in-progress for the same MAC */
  if (state.pendingConnects[mac]) {
    logInfo(name + ': connect already in progress…');
    return;
  }
  if (Object.keys(state.connected).length >= 5) {
    showToast('Max 5 devices reached — disconnect one first');
    return;
  }
  var type = detectType(name);
  logInfo('Connecting to ' + name + ' (' + mac + ')…');
  state.pendingConnects[mac] = { name: name, type: type };

  enqueue(function () {
    return sendCFBG('CONNECT', mac, 15000)
      .then(function (resp) {
        delete state.pendingConnects[mac];
        var info = parseConnected(resp);
        if (!info) { logFail('Connect response parse failed for ' + name); return; }
        var devIdx = info.idx;
        if (state.connected[devIdx]) {
          logInfo('Already set up by async path (idx=' + devIdx + '), skipping DISC');
          return;
        }
        state.connected[devIdx] = {
          idx: devIdx, mac: mac, name: name, type: type,
          connId: info.connId, chars: {}, aa11Handle: null, cccdHandle: null, fff2Handle: null
        };
        initDeviceData(devIdx, type);
        logInfo('Connected: ' + name + ' idx=' + devIdx);
        setConnectedCount();
        renderGrid();
        markScanItemConnected(mac);
        return autoDiscover(devIdx);
      })
      .catch(function (err) {
        logFail('Connect RPC lost (' + (err && err.message ? err.message : err) + ') — awaiting async CONNECTED…');
      });
  });
}

function parseConnected(resp) {
  var lines = splitLines(resp);
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/^CFBG:(OK|FAIL):/, '');
    var m = l.match(/^CONNECTED:(\d+):0x([0-9A-Fa-f]+)/);
    if (m) return { idx: parseInt(m[1], 10), connId: parseInt(m[2], 16) };
  }
  return null;
}

function initDeviceData(devIdx, type) {
  if (type === 'led') {
    state.ledState[devIdx] = { on: false, colorHex: 'FFFFFF' };
  }
  /* Persist idx→{name,type} so the Monitor widget can label cards and skip LEDs. */
  var dev = state.connected[devIdx];
  if (dev && dev.name) saveDeviceMeta(devIdx, dev.name, type);
  /* sensor: no other local state — data goes directly to ThingsBoard telemetry */
}

/* ═══════════════════════════════════════════════════════════════════
   Auto-Discover + Enable Notify
   ═══════════════════════════════════════════════════════════════════ */
function autoDiscover(devIdx, _retry) {
  var retry = _retry || 0;
  logInfo('Discovering services/chars for idx=' + devIdx + (retry ? ' (retry ' + retry + '/2)' : '') + '…');
  return sendCFBG('DISC', String(devIdx), 15000)
    .then(function (resp) {
      parseDiscDone(resp, devIdx);
      var dev = state.connected[devIdx];
      if (!dev) return;
      renderGrid();
      selectDevice(devIdx);
      if (dev.cccdHandle) {
        return enableNotify(devIdx);
      }
      if (retry < 2) {
        logInfo('DISC returned no handles — waiting 2s then retrying…');
        return new Promise(function (res) { setTimeout(res, 2000); })
          .then(function () { return autoDiscover(devIdx, retry + 1); });
      }
      logFail('DISC failed after ' + (retry + 1) + ' attempts — no handles found for idx=' + devIdx);
    })
    .catch(function (e) {
      logFail('DISC failed for idx=' + devIdx + ': ' + e);
    });
}

function parseDiscDone(resp, devIdx) {
  var dev = state.connected[devIdx];
  if (!dev) return;
  var lines = splitLines(resp);
  lines.forEach(function (line) {
    var l = line.replace(/^CFBG:(OK|FAIL):/, '');
    var m = l.match(/^CHAR:\d+:0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{2})/i);
    if (!m) return;
    var uuid16 = m[1].toUpperCase();
    var handle = parseInt(m[2], 16);
    var props  = parseInt(m[3], 16);
    dev.chars[uuid16] = handle;
    logInfo('CHAR uuid=0x' + uuid16 + ' handle=0x' + handle.toString(16).toUpperCase() + ' props=0x' + props.toString(16));

    if (uuid16 === 'AA11') { dev.aa11Handle = handle; dev.cccdHandle = handle + 1; }
    if (uuid16 === 'FFF1' && (props & 0x10)) { dev.fff1Handle = handle; dev.cccdHandle = handle + 1; }
    if (uuid16 === 'FFF2') { dev.fff2Handle = handle; }
  });
  if (dev.fff2Handle && dev.type === 'unknown') {
    dev.type = 'led';
    if (!state.ledState[devIdx]) state.ledState[devIdx] = { on: false, colorHex: 'FFFFFF' };
  }
  if (dev.aa11Handle && dev.type === 'unknown') {
    dev.type = 'sensor';
  }
  logInfo('Discovery done for ' + dev.name + ' (type=' + dev.type + ')');
}

function enableNotify(devIdx) {
  var dev = state.connected[devIdx];
  if (!dev || !dev.cccdHandle) return Promise.resolve();
  logInfo('Enabling NOTIFY on CCCD=0x' + dev.cccdHandle.toString(16).toUpperCase() + ' for idx=' + devIdx);
  return sendCFBG('NOTIFY', devIdx + ':0x' + dev.cccdHandle.toString(16).toUpperCase() + ':1', 10000)
    .then(function () {
      logInfo('NOTIFY enabled for ' + dev.name + ' → data streams to telemetry → Monitor widget');
    })
    .catch(function (e) {
      logFail('Enable NOTIFY failed: ' + e);
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Disconnect
   ═══════════════════════════════════════════════════════════════════ */
function disconnectSelected() {
  var devIdx = state.selectedIdx;
  if (devIdx === null || !state.connected[devIdx]) return;
  logInfo('Disconnecting idx=' + devIdx + '…');

  enqueue(function () {
    return sendCFBG('DISCONNECT', String(devIdx), 10000)
      .then(function (resp) {
        /* Firmware sends DISCONNECTING:<idx> immediately (ack), then
           DISCONNECTED:<idx>:0x<connId> later from the BLE callback.
           We clean up UI here on the first ack so the panel clears
           without waiting for the async telemetry event. */
        var r = resp || '';
        if (r.indexOf('DISCONNECTING') !== -1 ||
            r.indexOf('DISCONNECTED')  !== -1 ||
            r.indexOf('NOT_CONNECTED') !== -1) {
          handleDisconnected(devIdx);
        }
      })
      .catch(function (err) {
        logFail('Disconnect failed: ' + (err && err.message ? err.message : err));
        /* Clean up UI anyway — the BLE link is likely already broken */
        handleDisconnected(devIdx);
      });
  });
}

function handleDisconnected(devIdx) {
  if (!state.connected[devIdx]) return;
  var name = state.connected[devIdx].name;
  delete state.connected[devIdx];
  delete state.ledState[devIdx];
  if (state.selectedIdx === devIdx) {
    state.selectedIdx = null;
    showDetailPanel(null);
  }
  setConnectedCount();
  renderGrid();
  renderScanList(state.scanResults);
  logInfo('Disconnected: ' + name + ' (idx=' + devIdx + ')');
  showToast('Disconnected: ' + name);
}

/* ═══════════════════════════════════════════════════════════════════
   LED Commands
   ═══════════════════════════════════════════════════════════════════ */
function sendLedOnOff(turnOn) {
  var devIdx = state.selectedIdx;
  if (devIdx === null) return;
  var dev = state.connected[devIdx];
  if (!dev || dev.type !== 'led' || !dev.fff2Handle) {
    showToast('LED handle not discovered — reconnect');
    return;
  }
  var hexData = turnOn ? '01' : '00';
  if (state.ledState[devIdx]) state.ledState[devIdx].on = turnOn;
  updateLedBadge(devIdx, turnOn);

  enqueue(function () {
    return sendCFBG('WRITE', devIdx + ':0x' + dev.fff2Handle.toString(16).toUpperCase() + ':' + hexData, 8000)
      .catch(function (e) { logFail('LED write failed: ' + e); });
  });
}

function sendLedColor(colorHex) {
  var devIdx = state.selectedIdx;
  if (devIdx === null) return;
  var dev = state.connected[devIdx];
  if (!dev || dev.type !== 'led' || !dev.fff2Handle) {
    showToast('LED handle not discovered — reconnect');
    return;
  }
  if (state.ledState[devIdx]) {
    state.ledState[devIdx].colorHex = colorHex;
    state.ledState[devIdx].on = true;
  }
  updateLedBadge(devIdx, true);

  enqueue(function () {
    return sendCFBG('WRITE', devIdx + ':0x' + dev.fff2Handle.toString(16).toUpperCase() + ':' + colorHex, 8000)
      .catch(function (e) { logFail('LED color write failed: ' + e); });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Async Event Handling
   ═══════════════════════════════════════════════════════════════════ */
function handleAsyncLine(line) {
  var l = line.replace(/^CFBG:(OK|FAIL):/, '');

  var m = l.match(/^DISCONNECTED:(\d+)/);
  if (m) { handleDisconnected(parseInt(m[1], 10)); return; }

  /* DISCONNECTING:<idx> is the immediate ack when DISCONNECT command is received.
     Also handle it as a disconnect trigger so spontaneous disconnects arriving
     via onDataUpdated clean up the UI (e.g. when controlApi datasource fires). */
  m = l.match(/^DISCONNECTING:(\d+)/);
  if (m) { handleDisconnected(parseInt(m[1], 10)); return; }

  m = l.match(/^CONNECTED:(\d+):0x([0-9A-Fa-f]+):([0-9a-fA-F:]{17})/i);
  if (m) {
    var asyncDevIdx = parseInt(m[1], 10);
    var asyncMac    = m[3].toLowerCase();
    logEvt('Async CONNECTED idx=' + asyncDevIdx + ' ' + asyncMac);
    /* Remove any stale widget entry for the same MAC with a DIFFERENT idx.
       This can happen when a scan runs while a device is connected: the firmware
       clears its device table (wiping the old slot), so on the next connect the
       device lands in a fresh slot with a new idx. Without cleanup the old entry
       stays in state.connected and produces a phantom second tab. */
    var ck = Object.keys(state.connected);
    for (var ci = 0; ci < ck.length; ci++) {
      var ce = state.connected[ck[ci]];
      if (ce.mac === asyncMac && parseInt(ck[ci], 10) !== asyncDevIdx) {
        logInfo('Removing stale slot ' + ck[ci] + ' for ' + asyncMac);
        delete state.connected[ck[ci]];
        delete state.ledState[ck[ci]];
      }
    }
    if (!state.connected[asyncDevIdx]) {
      var asyncPending = state.pendingConnects[asyncMac];
      if (asyncPending) {
        delete state.pendingConnects[asyncMac];
        state.connected[asyncDevIdx] = {
          idx: asyncDevIdx, mac: asyncMac,
          name: asyncPending.name, type: asyncPending.type,
          connId: parseInt(m[2], 16), chars: {}, aa11Handle: null, cccdHandle: null, fff2Handle: null
        };
        initDeviceData(asyncDevIdx, asyncPending.type);
        setConnectedCount();
        renderGrid();
        markScanItemConnected(asyncMac);
        logInfo('Connected (async recovery): ' + asyncPending.name + ' idx=' + asyncDevIdx);
        var capturedIdx = asyncDevIdx;
        enqueue(function () { return autoDiscover(capturedIdx); });
      }
    }
    return;
  }

  /* NOTIFY:<idx>:0x<handle>:<hex> — just log, data already going to telemetry */
  m = l.match(/^NOTIFY:(\d+):0x([0-9A-Fa-f]+):([0-9A-Fa-f]*)/i);
  if (m) {
    var notifyIdx    = parseInt(m[1], 10);
    var notifyHandle = parseInt(m[2], 16);
    var nd = state.connected[notifyIdx];
    if (!nd || (nd.aa11Handle !== null && nd.aa11Handle !== notifyHandle)) {
      var nkeys = Object.keys(state.connected);
      for (var ni = 0; ni < nkeys.length; ni++) {
        var cand = state.connected[nkeys[ni]];
        if (cand.aa11Handle === notifyHandle || cand.fff1Handle === notifyHandle) {
          notifyIdx = cand.idx; break;
        }
      }
    }
    /* Log notification — only decode T/H for sensor-type devices.
       LED devices may also fire NOTIFY (e.g. confirmation bytes) and must not
       be decoded as temperature/humidity. */
    var hexData   = m[3];
    var notifyDev = state.connected[notifyIdx];
    var devName   = (notifyDev && notifyDev.name) || ('idx=' + notifyIdx);
    if (notifyDev && notifyDev.type === 'sensor' && hexData && hexData.length >= 8) {
      var b0 = parseInt(hexData.substr(0,2),16), b1 = parseInt(hexData.substr(2,2),16);
      var b2 = parseInt(hexData.substr(4,2),16), b3 = parseInt(hexData.substr(6,2),16);
      var rawT = (b1<<8)|b0; if(rawT&0x8000) rawT-=0x10000;
      var rawH = (b3<<8)|b2; if(rawH&0x8000) rawH-=0x10000;
      logEvt(devName + ': T=' + (rawT/100).toFixed(2) + '°C  H=' + (rawH/100).toFixed(2) + '%  → telemetry');
    } else if (hexData) {
      logEvt('[NOTIFY] ' + devName + ' data=' + hexData);
    }
    return;
  }

  m = l.match(/^DESCR_WRITE_OK:(\d+):0x([0-9A-Fa-f]+)/i);
  if (m) {
    var dwoIdx = parseInt(m[1], 10);
    var dwoDev = state.connected[dwoIdx];
    logEvt('CCCD write confirmed' + (dwoDev ? ' for ' + dwoDev.name : '') +
           ' handle=0x' + parseInt(m[2], 16).toString(16).toUpperCase());
    return;
  }

  m = l.match(/^SCAN_DONE:(\d+)/);
  if (m) { logEvt('Scan done — ' + m[1] + ' device(s)'); return; }

  m = l.match(/^SCAN_RESULT:(\d+),([0-9a-fA-F:]{17}),(-?\d+),(.*)/i);
  if (m && state.scanning) {
    var idx  = parseInt(m[1], 10);
    var mac  = m[2].toUpperCase();
    var rssi = parseInt(m[3], 10);
    var name = m[4] || ('Device_' + idx);
    var exists = false;
    for (var ri = 0; ri < state.scanResults.length; ri++) {
      if (state.scanResults[ri].mac === mac) { exists = true; break; }
    }
    if (!exists) {
      state.scanResults.push({ idx: idx, mac: mac, rssi: rssi, name: name,
                               type: detectType(name), connected: isDeviceConnected(mac) });
      renderScanList(state.scanResults);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Type Detection
   ═══════════════════════════════════════════════════════════════════ */
function detectType(name) {
  if (!name) return 'unknown';
  var n = name.toUpperCase();
  if (n.indexOf('DA2_LED') === 0)    return 'led';
  if (n.indexOf('DA2_SENSOR') === 0) return 'sensor';
  return 'unknown';
}

function deviceIcon(type) {
  if (type === 'led')    return '💡';
  if (type === 'sensor') return '🌡';
  return '📶';
}

/* ═══════════════════════════════════════════════════════════════════
   UI: Scan List
   ═══════════════════════════════════════════════════════════════════ */
function renderScanList(results) {
  var el = ge('scan-list');
  if (!el) return;
  setEl('scan-count-badge', String(results.length));

  if (!results.length) {
    el.innerHTML = '<div class="empty-hint" style="text-align:center;padding:20px 8px">📡<br>Press Scan to find BLE devices</div>';
    return;
  }

  var html = '';
  results.forEach(function (d) {
    var isConn  = isDeviceConnected(d.mac);
    var rssiPct = Math.max(0, Math.min(100, (d.rssi + 100) * 2));
    html += '<div class="scan-item">';
    html +=   '<div class="scan-item-top">';
    html +=     '<span class="scan-item-icon">' + deviceIcon(d.type) + '</span>';
    html +=     '<span class="scan-item-name">' + escHtml(d.name) + '</span>';
    html +=   '</div>';
    html +=   '<div class="scan-item-mac">' + d.mac + '</div>';
    html +=   '<div class="scan-item-bottom">';
    html +=     '<div class="rssi-wrap"><div class="rssi-bar"><div class="rssi-fill" style="width:' + rssiPct + '%"></div></div>';
    html +=     '<span class="rssi-txt">' + d.rssi + ' dBm</span></div>';
    if (isConn) {
      html += '<button class="btn-connect connected" disabled>&#10003; Connected</button>';
    } else {
      html += '<button class="btn-connect" onclick="connectDevice(' + d.idx + ',\'' + escJs(d.mac) + '\',\'' + escJs(d.name) + '\')">Connect</button>';
    }
    html +=   '</div></div>';
  });
  el.innerHTML = html;
}

function markScanItemConnected(mac) {
  state.scanResults.forEach(function (r) { if (r.mac === mac) r.connected = true; });
  renderScanList(state.scanResults);
}

function isDeviceConnected(mac) {
  var keys = Object.keys(state.connected);
  for (var i = 0; i < keys.length; i++) {
    if (state.connected[keys[i]].mac === mac) return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════════════
   UI: Device Grid
   ═══════════════════════════════════════════════════════════════════ */
function renderGrid() {
  var grid = ge('device-grid');
  if (!grid) return;
  var keys = Object.keys(state.connected);
  setEl('connected-count-badge', String(keys.length));

  if (!keys.length) {
    grid.innerHTML = '<div class="empty-hint">No connected devices</div>';
    return;
  }

  var html = '';
  keys.forEach(function (k) {
    var d   = state.connected[k];
    var cls = d.type === 'led' ? 'led-card' : d.type === 'sensor' ? 'sensor-card' : '';
    var sel = state.selectedIdx === d.idx ? 'true' : 'false';
    html += '<div class="device-card ' + cls + '" data-selected="' + sel + '" onclick="selectDevice(' + d.idx + ')">';
    html +=   '<div class="device-card-icon">' + deviceIcon(d.type) + '</div>';
    html +=   '<div class="device-card-name">' + escHtml(shortName(d.name)) + '</div>';
    html +=   '<div class="online-badge online">● Online</div>';
    html += '</div>';
  });
  grid.innerHTML = html;
}

function shortName(name) { return name.length <= 10 ? name : name.substr(0, 9) + '…'; }
function setConnectedCount() { setEl('connected-count-badge', String(Object.keys(state.connected).length)); }

/* ═══════════════════════════════════════════════════════════════════
   UI: Device Detail Panel
   ═══════════════════════════════════════════════════════════════════ */
function selectDevice(devIdx) {
  state.selectedIdx = devIdx;
  renderGrid();
  showDetailPanel(devIdx);
}

function showDetailPanel(devIdx) {
  var placeholder = ge('detail-placeholder');
  var ledPanel    = ge('led-panel');
  var sensorPanel = ge('sensor-panel');
  if (!ledPanel || !sensorPanel) return;

  if (devIdx === null || !state.connected[devIdx]) {
    addClass(ledPanel, 'hidden');
    addClass(sensorPanel, 'hidden');
    if (placeholder) placeholder.style.display = '';
    return;
  }

  var dev = state.connected[devIdx];
  if (placeholder) placeholder.style.display = 'none';

  if (dev.type === 'led') {
    addClass(sensorPanel, 'hidden');
    removeClass(ledPanel, 'hidden');
    setEl('led-device-name', dev.name);
    setEl('led-device-mac', dev.mac);
    updateLedBadge(devIdx, state.ledState[devIdx] && state.ledState[devIdx].on);
  } else if (dev.type === 'sensor') {
    addClass(ledPanel, 'hidden');
    removeClass(sensorPanel, 'hidden');
    setEl('sensor-device-name', dev.name);
    setEl('sensor-device-mac', dev.mac);
  } else {
    addClass(ledPanel, 'hidden');
    addClass(sensorPanel, 'hidden');
  }
}

function updateLedBadge(devIdx, on) {
  if (devIdx !== state.selectedIdx) return;
  var badge = ge('led-state-badge');
  if (badge) { badge.setAttribute('data-on', on ? 'true' : 'false'); badge.textContent = on ? '🟢 ON' : '⚫ OFF'; }
  var btnOn  = ge('btn-led-on');
  var btnOff = ge('btn-led-off');
  if (btnOn)  btnOn.className  = 'btn-onoff btn-on'  + (on  ? ' active' : '');
  if (btnOff) btnOff.className = 'btn-onoff btn-off' + (!on ? ' active' : '');
}

/* ═══════════════════════════════════════════════════════════════════
   UI: Status helpers
   ═══════════════════════════════════════════════════════════════════ */
function setStatus(state_str, text) {
  var pill = ge('status-pill'); if (pill) pill.setAttribute('data-state', state_str);
  var txt  = ge('status-text'); if (txt)  txt.textContent = text;
}
function setBtnScan(disabled) { var btn = ge('btn-scan'); if (btn) btn.disabled = disabled; }
function onSlotChange(val)    { state.slot = val; logInfo('Stack slot → ' + val); }

/* ═══════════════════════════════════════════════════════════════════
   Saved Devices (localStorage)
   ═══════════════════════════════════════════════════════════════════ */
var LS_KEY       = 'ble_ctrl_saved_devices_v1';
var LS_NAMES_KEY = 'ble_gatt_dev_names_v1';  /* shared with monitor widget */

function loadSavedDevices() {
  try { var raw = localStorage.getItem(LS_KEY); if (raw) state.savedDevices = JSON.parse(raw); } catch (e) {}
}

/** Save/update the idx→{name,type} map so the Monitor widget can label cards and filter by type. */
function saveDeviceMeta(devIdx, name, type) {
  try {
    var raw  = localStorage.getItem(LS_NAMES_KEY);
    var map  = raw ? JSON.parse(raw) : {};
    map[String(devIdx)] = { name: name, type: type || 'unknown' };
    localStorage.setItem(LS_NAMES_KEY, JSON.stringify(map));
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   Console log
   ═══════════════════════════════════════════════════════════════════ */
function log(cls, msg) {
  var el = ge('console-log');
  if (!el) return;
  var ts   = new Date().toLocaleTimeString('en-GB', { hour12: false });
  var line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = '<span class="log-ts">[' + ts + ']</span><span class="' + cls + '">' + escHtml(msg) + '</span>';
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
function logTx(msg)   { log('log-tx',   'TX: ' + msg); }
function logRx(msg)   { log('log-ok',   'RX: ' + msg); }
function logFail(msg) { log('log-fail', '✗ ' + msg); }
function logEvt(msg)  { log('log-evt',  '◈ ' + msg); }
function logInfo(msg) { log('log-info', msg); }
function clearLog()   { var el = ge('console-log'); if (el) el.innerHTML = ''; }

/* ═══════════════════════════════════════════════════════════════════
   Toast
   ═══════════════════════════════════════════════════════════════════ */
var _toastTimer = null;
function showToast(msg) {
  var t = ge('toast');
  if (!t) return;
  t.textContent = msg;
  removeClass(t, 'hidden');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { addClass(t, 'hidden'); }, 2500);
}

/* ═══════════════════════════════════════════════════════════════════
   DOM helpers
   ═══════════════════════════════════════════════════════════════════ */
function ge(id)     { return document.getElementById(id); }
function setEl(id, html) { var el = ge(id); if (el) el.innerHTML = html; }
function addClass(el, cls)    { if (el && !el.classList.contains(cls)) el.classList.add(cls); }
function removeClass(el, cls) { if (el) el.classList.remove(cls); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escJs(s)   { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

/* ═══════════════════════════════════════════════════════════════════
   Window exports — required for ThingsBoard inline onclick handlers
   ═══════════════════════════════════════════════════════════════════ */
window.startScan          = startScan;
window.connectDevice      = connectDevice;
window.selectDevice       = selectDevice;
window.disconnectSelected = disconnectSelected;
window.sendLedOnOff       = sendLedOnOff;
window.sendLedColor       = sendLedColor;
window.onSlotChange       = onSlotChange;
window.clearLog           = clearLog;
