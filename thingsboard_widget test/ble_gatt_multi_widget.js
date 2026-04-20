/* =====================================================================
   DA2 BLE GATT Multi-Device Widget — JavaScript
   Protocol (from firmware source - DA2_esp_LAN/Application/BLE_Handler/):
     TX: CFBG:<slot>:<verb>:<params>   (hex-encoded, via RPC sendCommand)
     RX: CFBG:OK:<payload>             (lines split by \x1E record separator)
         CFBG:FAIL:<reason>
   Async events arrive via ThingsBoard telemetry subscription (onDataUpdated).

   Commands → Responses:
     CFBG:0:SCAN:<ms>             → CFBG:OK:SCAN_DONE:<N>\x1ESCAN_RESULT:<i>,<mac>,<rssi>,<name>
     CFBG:0:CONNECT:<MAC>         → CFBG:OK:CONNECTED:<idx>:0x<conn_id>:<MAC>
     CFBG:0:DISC:<idx>            → CFBG:OK:DISC_DONE:<idx>:<N>_CHARS\x1ESERVICE:...\x1ECHAR:<idx>:0x<uuid>:0x<handle>:0x<props>
     CFBG:0:NOTIFY:<idx>:<cccd>:1 → CFBG:OK:DESCR_WRITE_OK:<idx>:0x<handle>
     CFBG:0:WRITE:<idx>:<handle>:<hex> → CFBG:OK:WRITE_OK:<idx>:0x<handle>
     CFBG:0:DISCONNECT:<idx>      → async CFBG:OK:DISCONNECTED:<idx>:0x<cid>
   Async: CFBG:OK:NOTIFY:<idx>:0x<handle>:<hex>   (4B: temp_i16LE + hum_i16LE)

   IMPORTANT THINGSBOARD NOTE:
     - Use self.ctx.$container.find() NOT querySelector — jQuery find() is the
       correct ThingsBoard API and avoids element-not-found bugs
     - Avoid .finally() — not polyfilled in all TB versions
     - Avoid Object.values() — use Object.keys() loop instead
   ===================================================================== */

/* ═══════════════════════════════════════════════════════════════════
   App State
   ═══════════════════════════════════════════════════════════════════ */
var state = {
  slot:        '0',
  scanning:    false,
  scanResults: [],    /* [{idx, mac, rssi, name, type, connected}] */
  connected:   {},    /* key=devIdx → {idx, mac, name, type, connId, chars:{uuid16:handle}, aa11Handle, cccdHandle, fff2Handle} */
  selectedIdx: null,  /* currently highlighted device idx in grid */
  ledState:    {},    /* key=devIdx → {on:bool, colorHex:str} */
  sensorData:  {},    /* key=devIdx → {temp, hum, tempMax, tempMin, humMax, humMin, lastUpdate} */
  cmdQueue:    [],    /* FIFO command queue */
  cmdPending:  false,
  rpcTimeout:  12000,
  savedDevices:    [],  /* from localStorage */
  pendingConnects: {}   /* mac → {name,type}: fallback if RPC response is lost over WAN */
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

/* Async telemetry (unsolicited NOTIFY from sensor devices) */
var _tbLastLogTs = 0;
self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) {
      /* Fires on init — if this never shows any data, the ThingsBoard widget
         datasource is not configured (Entity → key = 'data', Latest Telemetry). */
      return;
    }
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      var latest  = kd.data[kd.data.length - 1];
      var raw     = latest[1];
      /* Throttled diagnostic: show at most once per 15 s so user can confirm
         TB telemetry is arriving without console spam */
      var now = Date.now();
      if (now - _tbLastLogTs > 15000) {
        _tbLastLogTs = now;
        var preview = String(raw).substr(0, 24);
        logEvt('[TB] telemetry rx: ' + preview + (String(raw).length > 24 ? '…' : ''));
      }
      var decoded = decodeRpcValue(raw);
      splitLines(decoded).forEach(function (line) {
        handleAsyncLine(line);
      });
      /* no break — process all subscribed data keys */
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
    if (val.result   !== undefined) val = val.result;
    else if (val.data !== undefined) val = val.data;
  }
  var s = String(val);
  /* If it looks like a pure hex blob, decode it */
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    s = hexToStr(s);
  }
  return s;
}

function splitLines(s) {
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    /* Strip gateway log prefix (e.g. UNK04/04/2026-17:03:40) that appears
       before CFBG: — only for lines that actually contain CFBG: */
    var ci = x.indexOf('CFBG:');
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

/* Send command: hex-encode "CFML:CFBG:<slot>:<verb>:<params>" and call sendCommand */
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
        /* parseScanDone updates state.scanResults and renders the list */
        var results = parseScanDone(resp);
        /* If parseScanDone got nothing (maybe results arrived via telemetry
           already in handleAsyncLine), use whatever is in state.scanResults */
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

/* Parse CFBG:OK:SCAN_DONE:<N>\x1ESCAN_RESULT:<idx>,<MAC>,<rssi>,<name> */
function parseScanDone(resp) {
  var lines  = splitLines(resp);
  var results = [];
  lines.forEach(function (line) {
    /* Strip leading CFBG:OK: prefix if present */
    var l = line.replace(/^CFBG:(OK|FAIL):/, '');
    var m = l.match(/^SCAN_RESULT:(\d+),([0-9a-fA-F:]{17}),(-?\d+),(.*)/);
    if (!m) return;
    var idx  = parseInt(m[1], 10);
    var mac  = m[2].toLowerCase();   /* keep firmware's lowercase format for CONNECT */
    var rssi = parseInt(m[3], 10);
    var name = m[4] || ('Device_' + idx);
    var type = detectType(name);
    /* Mark as already connected? */
    var alreadyConn = !!state.connected[idx];
    results.push({ idx: idx, mac: mac, rssi: rssi, name: name, type: type, connected: alreadyConn });
  });
  return results;
}

/* ═══════════════════════════════════════════════════════════════════
   Connect
   ═══════════════════════════════════════════════════════════════════ */
function connectDevice(scanIdx, mac, name) {
  if (Object.keys(state.connected).length >= 5) {
    showToast('Max 5 devices reached — disconnect one first');
    return;
  }
  var type = detectType(name);
  logInfo('Connecting to ' + name + ' (' + mac + ')…');
  /* Record for async fallback — if WAN MCU drops the RPC response,
     the async CONNECTED telemetry event in handleAsyncLine completes setup */
  state.pendingConnects[mac] = { name: name, type: type };

  enqueue(function () {
    return sendCFBG('CONNECT', mac, 15000)
      .then(function (resp) {
        delete state.pendingConnects[mac];
        var info = parseConnected(resp);
        if (!info) { logFail('Connect response parse failed for ' + name); return; }
        var devIdx = info.idx;
        /* Guard: async telemetry path may have already set this up */
        if (state.connected[devIdx]) {
          logInfo('Already set up by async path (idx=' + devIdx + '), skipping DISC');
          return;
        }
        state.connected[devIdx] = {
          idx: devIdx, mac: mac, name: name, type: type,
          connId: info.connId, chars: {}, aa11Handle: null, cccdHandle: null, fff2Handle: null
        };
        initDeviceData(devIdx, type);
        /* Save to storage so monitor widget can read device types */
        saveDeviceToStorage({ idx: devIdx, mac: mac, name: name, type: type });
        logInfo('Connected: ' + name + ' idx=' + devIdx);
        setConnectedCount();
        renderGrid();
        markScanItemConnected(mac);
        /* Auto-discover services + chars */
        return autoDiscover(devIdx);
      })
      .catch(function (err) {
        /* WAN MCU likely dropped the CONNECTED RPC response.
           pendingConnects[mac] stays — handleAsyncLine CONNECTED handler
           will complete setup when telemetry event arrives. */
        logFail('Connect RPC lost (' + (err && err.message ? err.message : err) + ') — awaiting async CONNECTED…');
      });
  });
}

/* Parse CFBG:OK:CONNECTED:<idx>:0x<conn_id>:<MAC> */
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
  if (type === 'sensor') {
    state.sensorData[devIdx] = { temp: null, hum: null, tempMax: null, tempMin: null, humMax: null, humMin: null, lastUpdate: null };
  }
  if (type === 'led') {
    state.ledState[devIdx] = { on: false, colorHex: 'FFFFFF' };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Auto-Discover + Enable Notify
   ═══════════════════════════════════════════════════════════════════ */
function autoDiscover(devIdx, _retry) {
  var retry = _retry || 0;
  logInfo('Discovering services/chars for idx=' + devIdx + (retry ? ' (retry ' + retry + '/2)' : '') + '…');
  /* NOTE: Called from inside an enqueued task — do NOT enqueue again or deadlock occurs */
  return sendCFBG('DISC', String(devIdx), 15000)
    .then(function (resp) {
      parseDiscDone(resp, devIdx);
      var dev = state.connected[devIdx];
      if (!dev) return;
      /* Re-render grid with updated type and open detail panel */
      renderGrid();
      selectDevice(devIdx);
      /* Enable notify if CCCD was found (LED FFF1 echo or sensor AA11) */
      if (dev.cccdHandle) {
        return enableNotify(devIdx);
      }
      /* No handles found — firmware returned wrong uplink (e.g. CONNECTED instead of DISC_DONE).
         Retry up to 2 times after a short delay to let the QSPI path settle. */
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

/*
 Parse CFBG:OK:DISC_DONE:<idx>:<N>_CHARS\x1ESERVICE:...\x1ECHAR:<idx>:0x<uuid>:0x<handle>:0x<props>
 char properties: 0x02=READ, 0x08=WRITE, 0x10=NOTIFY, 0x20=INDICATE
*/
function parseDiscDone(resp, devIdx) {
  var dev = state.connected[devIdx];
  if (!dev) return;
  var lines = splitLines(resp);
  lines.forEach(function (line) {
    var l = line.replace(/^CFBG:(OK|FAIL):/, '');
    /* CHAR:<idx>:0x<uuid16>:0x<handle>:0x<props> */
    var m = l.match(/^CHAR:\d+:0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{2})/i);
    if (!m) return;
    var uuid16  = m[1].toUpperCase();
    var handle  = parseInt(m[2], 16);
    var props   = parseInt(m[3], 16);
    dev.chars[uuid16] = handle;
    logInfo('CHAR uuid=0x' + uuid16 + ' handle=0x' + handle.toString(16).toUpperCase() + ' props=0x' + props.toString(16));

    /* Identify key handles */
    if (uuid16 === 'AA11') {
      dev.aa11Handle  = handle;
      dev.cccdHandle  = handle + 1;  /* CCCD immediately follows by BLE convention */
    }
    if (uuid16 === 'FFF1' && (props & 0x10)) {  /* FFF1 with NOTIFY — CCCD follows */
      dev.fff1Handle = handle;
      dev.cccdHandle = handle + 1;
    }
    if (uuid16 === 'FFF2') {
      dev.fff2Handle  = handle;
    }
  });
  /* Auto-detect device type from discovered characteristics */
  if (dev.fff2Handle && dev.type === 'unknown') {
    dev.type = 'led';
    if (!state.ledState[devIdx]) {
      state.ledState[devIdx] = { on: false, colorHex: 'FFFFFF' };
    }
  }
  if (dev.aa11Handle && dev.type === 'unknown') {
    dev.type = 'sensor';
    if (!state.sensorData[devIdx]) {
      state.sensorData[devIdx] = { temp: null, hum: null, tempMax: null, tempMin: null, humMax: null, humMin: null, lastUpdate: null };
    }
  }
  logInfo('Discovery done for ' + dev.name + ' (type=' + dev.type + ')');
}

function enableNotify(devIdx) {
  var dev = state.connected[devIdx];
  if (!dev || !dev.cccdHandle) return Promise.resolve();
  logInfo('Enabling NOTIFY on CCCD=0x' + dev.cccdHandle.toString(16).toUpperCase() + ' for idx=' + devIdx);
  /* NOTE: Called from inside an enqueued task — do NOT enqueue again or deadlock occurs */
  return sendCFBG('NOTIFY', devIdx + ':0x' + dev.cccdHandle.toString(16).toUpperCase() + ':1', 10000)
    .then(function () {
      logInfo('NOTIFY enabled for ' + dev.name);
      /* One-shot READ to show current value immediately without waiting for
         the next BLE push (which arrives every ~3 s from the sensor).      */
      if (dev.aa11Handle) {
        /* One-shot READ for immediate value — after this, data arrives via onDataUpdated (telemetry push) */
        return sendCFBG('READ', devIdx + ':0x' + dev.aa11Handle.toString(16).toUpperCase(), 5000)
          .then(function (resp) {
            var lines = splitLines(resp);
            for (var i = 0; i < lines.length; i++) {
              var l = lines[i].replace(/^CFBG:(OK|FAIL):/, '');
              var m = l.match(/^READ:(-?\d+):0x[0-9A-Fa-f]+:([0-9A-Fa-f]+)/i);
              if (m) { handleNotifyData(devIdx, dev.aa11Handle, m[2]); break; }
            }
          })
          .catch(function () {});
      }
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

  var capturedIdx = devIdx;  /* capture before async — selectedIdx may change */
  enqueue(function () {
    return sendCFBG('DISCONNECT', String(capturedIdx), 10000)
      .then(function (resp) {
        /* Parse the RPC response directly — on LAN the DISCONNECTED confirmation
           arrives as the inline RPC reply rather than/in addition to a telemetry push.
           handleDisconnected() is idempotent (guarded by !state.connected[devIdx]),
           so calling it from both the inline path and handleAsyncLine is safe. */
        var found = false;
        splitLines(resp || '').forEach(function (line) {
          if (/DISCONNECTED:\d+/.test(line)) {
            handleAsyncLine(line);
            found = true;
          }
        });
        /* Optimistic cleanup: no DISCONNECTED line in the RPC response means the
           firmware will send it asynchronously via telemetry — but if the telemetry
           path is slow/unreliable (WAN), clean up immediately so user can reconnect. */
        if (!found) {
          handleDisconnected(capturedIdx);
        }
      })
      .catch(function (err) {
        /* Timeout almost always means the BLE stack already disconnected the peer.
           Always clean up so the user can initiate a reconnect immediately. */
        logFail('Disconnect RPC error: ' + (err && err.message ? err.message : err) + ' — cleaning up anyway');
        handleDisconnected(capturedIdx);
      });
  });
}

function handleDisconnected(devIdx) {
  if (!state.connected[devIdx]) return;
  var name = state.connected[devIdx].name;
  delete state.connected[devIdx];
  delete state.sensorData[devIdx];
  delete state.ledState[devIdx];
  if (state.selectedIdx === devIdx) {
    state.selectedIdx = null;
    showDetailPanel(null);
  }
  setConnectedCount();
  renderGrid();
  renderScanList(state.scanResults); /* re-render to unmark connected state */
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

  /* Send 3-byte RGB value to FFF2 (device interprets 3 bytes as color + implicit ON) */
  enqueue(function () {
    return sendCFBG('WRITE', devIdx + ':0x' + dev.fff2Handle.toString(16).toUpperCase() + ':' + colorHex, 8000)
      .catch(function (e) { logFail('LED color write failed: ' + e); });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Async Event Handling (telemetry path AND direct RPC path)
   ═══════════════════════════════════════════════════════════════════ */
function handleAsyncLine(line) {
  /* Strip CFBG:OK: or CFBG:FAIL: prefix if present */
  var l = line.replace(/^CFBG:(OK|FAIL):/, '');

  /* DISCONNECTED:<idx>:0x<conn_id> */
  var m = l.match(/^DISCONNECTED:(\d+)/);
  if (m) { handleDisconnected(parseInt(m[1], 10)); return; }

  /* CONNECTED:<idx>:0x<conn_id>:<MAC>  (can arrive async via telemetry if RPC response was lost) */
  m = l.match(/^CONNECTED:(\d+):0x([0-9A-Fa-f]+):([0-9a-fA-F:]{17})/i);
  if (m) {
    var asyncDevIdx = parseInt(m[1], 10);
    var asyncMac    = m[3].toLowerCase();
    logEvt('Async CONNECTED idx=' + asyncDevIdx + ' ' + asyncMac);
    /* If RPC path hasn't set up the device yet, complete it now */
    if (!state.connected[asyncDevIdx]) {
      var asyncPending = state.pendingConnects[asyncMac];
      if (asyncPending) {
        delete state.pendingConnects[asyncMac];
        var asyncName = asyncPending.name;
        var asyncType = asyncPending.type;
        state.connected[asyncDevIdx] = {
          idx: asyncDevIdx, mac: asyncMac, name: asyncName, type: asyncType,
          connId: parseInt(m[2], 16), chars: {}, aa11Handle: null, cccdHandle: null, fff2Handle: null
        };
        initDeviceData(asyncDevIdx, asyncType);
        /* Save to storage so monitor widget can read device types */
        saveDeviceToStorage({ idx: asyncDevIdx, mac: asyncMac, name: asyncName, type: asyncType });
        setConnectedCount();
        renderGrid();
        markScanItemConnected(asyncMac);
        logInfo('Connected (async recovery): ' + asyncName + ' idx=' + asyncDevIdx);
        var capturedAsyncIdx = asyncDevIdx;
        enqueue(function () { return autoDiscover(capturedAsyncIdx); });
      }
    }
    return;
  }

  /* NOTIFY:<idx>:0x<handle>:<hex_data>  — sensor data */
  m = l.match(/^NOTIFY:(\d+):0x([0-9A-Fa-f]+):([0-9A-Fa-f]*)/i);
  if (m) {
    var notifyIdx    = parseInt(m[1], 10);
    var notifyHandle = parseInt(m[2], 16);
    /* MCU internal table index may differ from widget devIdx after reconnects.
       Try direct idx first; if not found or handle doesn't match, scan by handle. */
    var nd = state.connected[notifyIdx];
    if (!nd || (nd.aa11Handle !== null && nd.aa11Handle !== notifyHandle)) {
      var nkeys = Object.keys(state.connected);
      for (var ni = 0; ni < nkeys.length; ni++) {
        var cand = state.connected[nkeys[ni]];
        if (cand.aa11Handle === notifyHandle || cand.fff1Handle === notifyHandle) {
          notifyIdx = cand.idx;
          break;
        }
      }
    }
    handleNotifyData(notifyIdx, notifyHandle, m[3]);
    return;
  }

  /* DESCR_WRITE_OK:<idx>:0x<handle> — async CCCD write confirmation */
  m = l.match(/^DESCR_WRITE_OK:(\d+):0x([0-9A-Fa-f]+)/i);
  if (m) {
    var dwoIdx = parseInt(m[1], 10);
    var dwoHandle = parseInt(m[2], 16);
    var dwoDev = state.connected[dwoIdx];
    logEvt('CCCD write confirmed' + (dwoDev ? ' for ' + dwoDev.name : '') +
           ' handle=0x' + dwoHandle.toString(16).toUpperCase());
    return;
  }

  /* SCAN_DONE:<N> — scan completed via telemetry */
  m = l.match(/^SCAN_DONE:(\d+)/);
  if (m) { logEvt('Scan done — ' + m[1] + ' device(s)'); return; }

  /* SCAN_RESULT:<idx>,<mac>,<rssi>,<name> — results via telemetry while scanning */
  m = l.match(/^SCAN_RESULT:(\d+),([0-9a-fA-F:]{17}),(-?\d+),(.*)/i);
  if (m && state.scanning) {
    var idx  = parseInt(m[1], 10);
    var mac  = m[2].toUpperCase();
    var rssi = parseInt(m[3], 10);
    var name = m[4] || ('Device_' + idx);
    /* Deduplicate by MAC */
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

function handleNotifyData(devIdx, handle, hexData) {
  /* Always decode first — useful even if device isn't tracked yet */
  if (!hexData || hexData.length < 8) return;
  var b0   = parseInt(hexData.substr(0, 2), 16);
  var b1   = parseInt(hexData.substr(2, 2), 16);
  var b2   = parseInt(hexData.substr(4, 2), 16);
  var b3   = parseInt(hexData.substr(6, 2), 16);
  var rawT = (b1 << 8) | b0;
  var rawH = (b3 << 8) | b2;
  /* Sign extension for int16 */
  if (rawT & 0x8000) rawT = rawT - 0x10000;
  if (rawH & 0x8000) rawH = rawH - 0x10000;
  var temp  = rawT / 100.0;
  var hum   = rawH / 100.0;

  var dev = state.connected[devIdx];
  if (!dev || dev.type !== 'sensor') {
    /* Widget state reset (page reload) but firmware still sending — show raw value
       so user knows data IS flowing; they need to Scan → Connect to track it */
    logEvt('[Ghost] NOTIFY idx=' + devIdx + ': T=' + temp.toFixed(2) + '°C  H=' + hum.toFixed(2) + '%  ← Scan & Connect to display');
    return;
  }

  var sd = state.sensorData[devIdx];
  if (!sd) { sd = {}; state.sensorData[devIdx] = sd; }
  sd.temp  = temp;
  sd.hum   = hum;
  sd.tempMax = (sd.tempMax === null || sd.tempMax === undefined || temp > sd.tempMax) ? temp : sd.tempMax;
  sd.tempMin = (sd.tempMin === null || sd.tempMin === undefined || temp < sd.tempMin) ? temp : sd.tempMin;
  sd.humMax  = (sd.humMax  === null || sd.humMax  === undefined || hum  > sd.humMax)  ? hum  : sd.humMax;
  sd.humMin  = (sd.humMin  === null || sd.humMin  === undefined || hum  < sd.humMin)  ? hum  : sd.humMin;
  sd.lastUpdate  = new Date().toLocaleTimeString();
  sd._lastUpdateTs = Date.now();  /* timestamp for staleness check in startAutoRead */

  /* Auto-select this device if nothing is selected yet */
  if (state.selectedIdx === null) {
    selectDevice(devIdx);
  } else if (state.selectedIdx === devIdx) {
    updateSensorPanel(devIdx);
  }

  logEvt(dev.name + ': T=' + temp.toFixed(2) + '°C  H=' + hum.toFixed(2) + '%');
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
    var isConn = isDeviceConnected(d.mac);
    var rssiPct = Math.max(0, Math.min(100, (d.rssi + 100) * 2));
    html += '<div class="scan-item">';
    html +=   '<div class="scan-item-top">';
    html +=     '<span class="scan-item-icon">' + deviceIcon(d.type) + '</span>';
    html +=     '<span class="scan-item-name">' + escHtml(d.name) + '</span>';
    html +=   '</div>';
    html +=   '<div class="scan-item-mac">' + d.mac + '</div>';
    html +=   '<div class="scan-item-bottom">';
    html +=     '<div class="rssi-wrap">';
    html +=       '<div class="rssi-bar"><div class="rssi-fill" style="width:' + rssiPct + '%"></div></div>';
    html +=       '<span class="rssi-txt">' + d.rssi + ' dBm</span>';
    html +=     '</div>';
    if (isConn) {
      html += '<button class="btn-connect connected" disabled>&#10003; Connected</button>';
    } else {
      html += '<button class="btn-connect" onclick="connectDevice(' + d.idx + ',\'' + escJs(d.mac) + '\',\'' + escJs(d.name) + '\')">Connect</button>';
    }
    html +=   '</div>';
    html += '</div>';
  });
  el.innerHTML = html;
}

function markScanItemConnected(mac) {
  /* Update scan results array */
  state.scanResults.forEach(function (r) {
    if (r.mac === mac) r.connected = true;
  });
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
   UI: Device Grid (Connected)
   ═══════════════════════════════════════════════════════════════════ */
function getConnectedDevsList() {
  var keys = Object.keys(state.connected);
  var devs = [];
  for (var i = 0; i < keys.length; i++) devs.push(state.connected[keys[i]]);
  return devs;
}

function renderGrid() {
  var grid = ge('device-grid');
  if (!grid) return;
  var devs = getConnectedDevsList();
  setEl('connected-count-badge', String(devs.length));

  if (!devs.length) {
    grid.innerHTML = '<div id="grid-empty" class="empty-hint">No connected devices</div>';
    return;
  }

  var html = '';
  devs.forEach(function (d) {
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

function shortName(name) {
  if (name.length <= 10) return name;
  return name.substr(0, 9) + '…';
}

function setConnectedCount() {
  setEl('connected-count-badge', String(Object.keys(state.connected).length));
}

/* ═══════════════════════════════════════════════════════════════════
   UI: Device Detail Panel
   ═══════════════════════════════════════════════════════════════════ */
function selectDevice(devIdx) {
  state.selectedIdx = devIdx;
  renderGrid(); /* re-render to update selection highlight */
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
    updateSensorPanel(devIdx);
  } else {
    addClass(ledPanel, 'hidden');
    addClass(sensorPanel, 'hidden');
  }
}

function updateLedBadge(devIdx, on) {
  if (devIdx !== state.selectedIdx) return;
  var badge = ge('led-state-badge');
  if (badge) {
    badge.setAttribute('data-on', on ? 'true' : 'false');
    badge.textContent = on ? '🟢 ON' : '⚫ OFF';
  }
  var btnOn  = ge('btn-led-on');
  var btnOff = ge('btn-led-off');
  if (btnOn)  { btnOn.className  = 'btn-onoff btn-on'  + (on ? ' active' : ''); }
  if (btnOff) { btnOff.className = 'btn-onoff btn-off' + (!on ? ' active' : ''); }
}

function updateSensorPanel(devIdx) {
  /* Sensor data display removed from control widget — shown in Monitor widget only.
     State (state.sensorData) is still updated by handleNotifyData for the monitor. */
}

/* ═══════════════════════════════════════════════════════════════════
   UI: Status / Slot / Scan Button helpers
   ═══════════════════════════════════════════════════════════════════ */
function setStatus(state_str, text) {
  var pill = ge('status-pill');
  if (pill)   pill.setAttribute('data-state', state_str);
  var txt = ge('status-text');
  if (txt)    txt.textContent = text;
}

function setBtnScan(disabled) {
  var btn = ge('btn-scan');
  if (btn) btn.disabled = disabled;
}

function onSlotChange(val) {
  state.slot = val;
  logInfo('Stack slot changed to ' + val);
}

/* ═══════════════════════════════════════════════════════════════════
   Saved Devices (localStorage)
   ═══════════════════════════════════════════════════════════════════ */
var LS_KEY = 'ble_gatt_saved_devices_v2';

function loadSavedDevices() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) state.savedDevices = JSON.parse(raw);
  } catch (e) {}
}

function saveDeviceToStorage(dev) {
  try {
    var arr = state.savedDevices.filter(function (d) { return d.idx !== dev.idx; });
    arr.unshift({ idx: dev.idx, mac: dev.mac, name: dev.name, type: dev.type, lastSeen: new Date().toISOString() });
    if (arr.length > 10) arr = arr.slice(0, 10);
    state.savedDevices = arr;
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
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

function clearLog() {
  var el = ge('console-log');
  if (el) el.innerHTML = '';
}

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
function ge(id) {
  return document.getElementById(id);
}

function setEl(id, html) {
  var el = ge(id);
  if (el) el.innerHTML = html;
}

function addClass(el, cls) {
  if (el && !el.classList.contains(cls)) el.classList.add(cls);
}

function removeClass(el, cls) {
  if (el) el.classList.remove(cls);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escJs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

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
