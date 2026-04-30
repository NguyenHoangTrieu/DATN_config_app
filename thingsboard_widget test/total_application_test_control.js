/* =====================================================================
   DA2 Total Application Test Control Widget — JavaScript
   Type    : Control widget (requires controlApi / target device)
   Tabs    : BLE GATT | Zigbee | LoRa P2P
   Protocol: CFML:CFBG / CFML:CFZB / CFML:CFLR  (hex-encoded RPC)

   IMPORTANT THINGSBOARD NOTES:
     - Use document.getElementById() — no shadow DOM issues
     - Avoid .finally() — not polyfilled in all TB versions
     - Avoid Object.values() — use Object.keys() loop instead
     - Capture state vars BEFORE async to avoid closure bugs
   ===================================================================== */

/* ═══════════════════════════════════════════════════════════════════
   Global State
   ═══════════════════════════════════════════════════════════════════ */
var tatState = {
  slot:       '0',
  activeTab:  'ble',
  rpcTimeout: 15000,

  ble: {
    scanning:    false,
    scanResults: [],      /* [{idx,mac,rssi,name,type,connected}] */
    connected:   {},      /* devIdx → {idx,mac,name,type,connId,chars:{uuid16:handle},fff2Handle,aa11Handle,aa12Handle,cccdHandle} */
    selectedIdx: null,
    sensorData:  {},      /* devIdx → {temp,hum,count,lastTs} */
    cmdQueue:    [],
    cmdPending:  false,
    lastTeleTs:  0
  },

  zb: {
    networkUp:     false,
    channel:       '',
    panId:         '',
    nodes:         {},    /* short → {short,ieee,ep,name,type,verified,verifyFailed,verifyAttempts} */
    selectedNode:  null,
    sensorData:    {},    /* short → {temp,hum,count,lastTs,onOff,level} */
    cmdQueue:      [],
    cmdPending:    false,
    verifyQueue:   [],
    verifyRunning: false,
    hexSeq:        0,
    hexNative:     false
  },

  lr: {
    testMode:      false,
    rfConfigured:  false,
    rxActive:      false,
    nodeId:        null,
    nodeJoined:    false,
    nodeSeq:       0,
    temp:          null,
    hum:           null,
    rssi:          '',
    snr:           '',
    lastTx:        '',
    lastRx:        '',
    lastUp:        '',
    lastJoin:      '',
    lastCmd:       '',
    ledState:      '—',
    txPending:     false,
    pendingRxMeta: null,
    cmdQueue:      [],
    cmdPending:    false
  }
};

/* ── Bridge / telemetry listeners ── */
var _tatTeleSubscriber = null;
var _tatLastTeleTs     = 0;
var _tatBridgeHandler  = null;

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
self.onInit = function () {
  try {
    /* Clean up any stale listeners from prior init */
    if (_tatBridgeHandler) {
      window.removeEventListener('da2_tat_ctrl_event', _tatBridgeHandler);
      _tatBridgeHandler = null;
    }
    if (_tatTeleSubscriber && self.ctx && self.ctx.telemetryWsService) {
      try { self.ctx.telemetryWsService.unsubscribe(_tatTeleSubscriber); } catch(e) {}
      _tatTeleSubscriber = null;
    }

    tatSetTab('ble');
    tatSetPill('idle', 'Idle');
    tatLog('i', 'Widget ready — slot ' + tatState.slot);

    /* ══════ EVENT DELEGATION ══════ */
    var root = document.getElementById('tat-root');
    if (root) {
      root.addEventListener('click', function(evt) {
        var el = evt.target;
        while (el && el !== root &&
               (!(el.id && el.id.match(/^tat-tab-(ble|zb|lora)$/))) &&
               (!el.getAttribute || !el.getAttribute('data-action'))) {
          el = el.parentNode;
        }
        if (!el || el === root) return;
        var action = el.getAttribute('data-action');
        
        /* Tab clicks */
        if (el.id && el.id.match(/^tat-tab-(ble|zb|lora)$/)) {
          var tab = el.id.replace('tat-tab-', '');
          tatSetTab(tab);
          evt.preventDefault();
          return;
        }
        
        /* Action-based dispatch */
        if (action) {
          var param = el.getAttribute('data-param');
          try {
            if (action === 'scan') { bleScan(); }
            else if (action === 'queryInfo') { tatQueryInfo(); }
            else if (action === 'bleSendColor') { bleSendColor(param); }
            else if (action === 'bleLedOn') { bleLedOn(); }
            else if (action === 'bleLedOff') { bleLedOff(); }
            else if (action === 'bleDisconnect') { bleDisconnectSelected(); }
            else if (action === 'bleApplyInterval') { bleApplyInterval(); }
            else if (action === 'zbStart') { zbStart(); }
            else if (action === 'zbStop') { zbStop(); }
            else if (action === 'zbPermitJoin') { zbPermitJoin(); }
            else if (action === 'zbFind') { zbFind(); }
            else if (action === 'zbResetState') { zbResetState(); }
            else if (action === 'zbBulbOn') { zbBulbOn(); }
            else if (action === 'zbBulbOff') { zbBulbOff(); }
            else if (action === 'zbBulbToggle') { zbBulbToggle(); }
            else if (action === 'zbBulbLevel') { zbBulbLevel(parseInt(param)); }
            else if (action === 'zbBulbColor') { zbBulbColor(param); }
            else if (action === 'zbReadBulbStatus') { zbReadBulbStatus(); }
            else if (action === 'zbDeleteNode') { zbDeleteNode(); }
            else if (action === 'zbConfigReport') { zbConfigReport(); }
            else if (action === 'zbReadTemp') { zbReadTemp(); }
            else if (action === 'zbReadHum') { zbReadHum(); }
            else if (action === 'lrEnterTestMode') { lrEnterTestMode(); }
            else if (action === 'lrApplyRf') { lrApplyRf(); }
            else if (action === 'lrStartRx') { lrStartRx(); }
            else if (action === 'lrStopRx') { lrStopRx(); }
            else if (action === 'lrReadInfo') { lrReadInfo(); }
            else if (action === 'lrLedOn') { lrLedOn(); }
            else if (action === 'lrLedOff') { lrLedOff(); }
            else if (action === 'tatClearLog') { tatClearLog(); }
          } catch (e) {
            console.error('[TAT] Action error: ' + action + ' - ' + e.message);
          }
          evt.preventDefault();
          return;
        }
      });

      root.addEventListener('change', function(evt) {
        var el = evt.target;
        if (!el) return;
        if (el.id === 'tat-slot') {
          tatSetSlot(el.value);
        }
      });
    }

    /* Subscribe to telemetry programmatically (no datasource needed) */
    try {
      var sc = self.ctx && self.ctx.stateController;
      var params = sc && sc.getStateParams && sc.getStateParams();
      var entityId = params && params.entityId;
      if (entityId && entityId.id && self.ctx.telemetryWsService) {
        _tatTeleSubscriber = self.ctx.telemetryWsService.subscribe({
          entityType: entityId.entityType || 'DEVICE',
          entityId:   entityId.id,
          keys:       ['data'],
          onData: function (data) {
            try { tatHandleTeleData(data); } catch (e) { /* ignore */ }
          }
        });
        tatLog('i', 'Telemetry WS subscribed');
      }
    } catch (se) {
      tatLog('!', 'Telemetry subscribe: ' + (se && se.message ? se.message : se));
    }

    /* Bridge listener — receive structured events from monitor widget */
    _tatBridgeHandler = function (evt) {
      try {
        var d = evt && evt.detail;
        if (!d) return;
        tatHandleBridgeEvent(d);
      } catch (e) {}
    };
    window.addEventListener('da2_tat_ctrl_event', _tatBridgeHandler);

  } catch (e) {
    console.error('[TAT] onInit error:', e);
  }
};

self.onDestroy = function () {
  try {
    if (_tatBridgeHandler) {
      window.removeEventListener('da2_tat_ctrl_event', _tatBridgeHandler);
      _tatBridgeHandler = null;
    }
    if (_tatTeleSubscriber && self.ctx && self.ctx.telemetryWsService) {
      self.ctx.telemetryWsService.unsubscribe(_tatTeleSubscriber);
      _tatTeleSubscriber = null;
    }
  } catch (e) {}
};

/* Fallback: datasource-based telemetry */
self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      for (var di = 0; di < kd.data.length; di++) {
        var entry = kd.data[di];
        var ts    = entry[0];
        var raw   = entry[1];
        if (ts <= _tatLastTeleTs) continue;
        _tatLastTeleTs = ts;
        var decoded = tatDecodeRpcValue(raw);
        tatSplitLines(decoded).forEach(tatDispatchLine);
      }
    }
  } catch (e) {}
};

/* ═══════════════════════════════════════════════════════════════════
   Telemetry handler (programmatic WebSocket subscription)
   ═══════════════════════════════════════════════════════════════════ */
function tatHandleTeleData(data) {
  var arr = data && data['data'];
  if (!arr || !arr.length) return;
  for (var i = 0; i < arr.length; i++) {
    var entry = arr[i];
    var ts    = entry[0];
    var raw   = entry[1];
    if (ts <= _tatLastTeleTs) continue;
    _tatLastTeleTs = ts;
    var decoded = tatDecodeRpcValue(raw);
    tatSplitLines(decoded).forEach(tatDispatchLine);
  }
}

/* Bridge event from monitor widget */
function tatHandleBridgeEvent(d) {
  if (d.type === 'zbNodeJoin')     zbHandleNodeJoin(d.short, d.ieee || '????????????????');
  if (d.type === 'zbNodeAnnounce') zbHandleNodeAnnounce(d.short, d.ieee || '????????????????', d.ep || '?');
  if (d.type === 'zbNodeLeave')    zbHandleNodeLeave(d.ieee);
  if (d.type === 'zbAttrReport')   zbHandleAttrReport(d.short, d.cluster, d.attr, d.value);
}

/* ═══════════════════════════════════════════════════════════════════
   Encoding Helpers
   ═══════════════════════════════════════════════════════════════════ */
function tatStrToHex(s) {
  var h = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i).toString(16);
    h += (c.length === 1 ? '0' : '') + c;
  }
  return h.toUpperCase();
}

function tatHexToStr(h) {
  var s = '';
  for (var i = 0; i < h.length; i += 2) {
    var b = parseInt(h.substr(i, 2), 16);
    if (!isNaN(b)) s += String.fromCharCode(b);
  }
  return s;
}

function tatDecodeRpcValue(val) {
  if (!val) return '';
  if (typeof val === 'object') {
    if (val.result !== undefined) val = val.result;
    else if (val.data !== undefined) val = val.data;
  }
  var s = String(val);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    s = tatHexToStr(s);
  }
  return s;
}

function tatSplitLines(s) {
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    var ci = x.indexOf('CFBG:');
    if (ci > 0) x = x.substring(ci);
    var zi = x.indexOf('CFZB:');
    if (zi > 0) x = x.substring(zi);
    var li = x.indexOf('CFLR:');
    if (li > 0) x = x.substring(li);
    return x;
  }).filter(Boolean);
}

/* ═══════════════════════════════════════════════════════════════════
   RPC core
   ═══════════════════════════════════════════════════════════════════ */
function tatSendRpc(method, params, timeout) {
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

/* ═══════════════════════════════════════════════════════════════════
   Protocol-specific RPC wrappers
   ═══════════════════════════════════════════════════════════════════ */
function sendCFBG(verb, params, timeout) {
  var cmd = 'CFML:CFBG:' + tatState.slot + ':' + verb + (params ? ':' + params : '');
  tatLog('TX', cmd);
  var hex = tatStrToHex(cmd);
  return tatSendRpc('sendCommand', hex, timeout || tatState.rpcTimeout)
    .then(function (resp) {
      var decoded = tatDecodeRpcValue(resp);
      if (decoded) tatSplitLines(decoded).forEach(function(l) { tatLog('RX', l); });
      return decoded;
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      tatLog('!', 'BLE RPC: ' + msg);
      tatToast('BLE error: ' + msg);
      throw err;
    });
}

function sendCFZB(func, params, timeout) {
  var cmd = 'CFML:CFZB:' + tatState.slot + ':' + func + (params ? ':' + params : '');
  tatLog('TX', cmd);
  var hex = tatStrToHex(cmd);
  return tatSendRpc('sendCommand', hex, timeout || tatState.rpcTimeout)
    .then(function (resp) {
      var decoded = tatDecodeRpcValue(resp);
      if (decoded) tatSplitLines(decoded).forEach(function(l) { tatLog('RX', l); });
      return decoded;
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      tatLog('!', 'ZB RPC: ' + msg);
      tatToast('Zigbee error: ' + msg);
      throw err;
    });
}

function sendCFLR(func, params, timeout) {
  var cmd = 'CFML:CFLR:' + tatState.slot + ':' + func + (params ? ':' + params : '');
  tatLog('TX', cmd);
  var hex = tatStrToHex(cmd);
  return tatSendRpc('sendCommand', hex, timeout || tatState.rpcTimeout)
    .then(function (resp) {
      var decoded = tatDecodeRpcValue(resp);
      if (decoded) tatSplitLines(decoded).forEach(function(l) {
        if (/EVT:/i.test(l)) { tatLog('EVT', l); tatDispatchLine(l); }
        else                  { tatLog('RX', l); tatDispatchLine(l); }
      });
      return decoded;
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      tatLog('!', 'LoRa RPC: ' + msg);
      tatToast('LoRa error: ' + msg);
      throw err;
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Command Queues (one per protocol)
   ═══════════════════════════════════════════════════════════════════ */
function bleEnqueue(fn) {
  return new Promise(function (resolve, reject) {
    tatState.ble.cmdQueue.push({ fn: fn, resolve: resolve, reject: reject });
    bleDrainQueue();
  });
}
function bleDrainQueue() {
  var q = tatState.ble;
  if (q.cmdPending || q.cmdQueue.length === 0) return;
  var item = q.cmdQueue.shift();
  q.cmdPending = true;
  try {
    item.fn()
      .then(function(v) { q.cmdPending = false; item.resolve(v); bleDrainQueue(); })
      .catch(function(e){ q.cmdPending = false; item.reject(e);  bleDrainQueue(); });
  } catch(e) { q.cmdPending = false; item.reject(e); bleDrainQueue(); }
}

function zbEnqueue(fn) {
  return new Promise(function (resolve, reject) {
    tatState.zb.cmdQueue.push({ fn: fn, resolve: resolve, reject: reject });
    zbDrainQueue();
  });
}
function zbDrainQueue() {
  var q = tatState.zb;
  if (q.cmdPending || q.cmdQueue.length === 0) return;
  var item = q.cmdQueue.shift();
  q.cmdPending = true;
  try {
    item.fn()
      .then(function(v) { q.cmdPending = false; item.resolve(v); zbDrainQueue(); })
      .catch(function(e){ q.cmdPending = false; item.reject(e);  zbDrainQueue(); });
  } catch(e) { q.cmdPending = false; item.reject(e); zbDrainQueue(); }
}

function lrEnqueue(fn) {
  return new Promise(function (resolve, reject) {
    tatState.lr.cmdQueue.push({ fn: fn, resolve: resolve, reject: reject });
    lrDrainQueue();
  });
}
function lrDrainQueue() {
  var q = tatState.lr;
  if (q.cmdPending || q.cmdQueue.length === 0) return;
  var item = q.cmdQueue.shift();
  q.cmdPending = true;
  try {
    item.fn()
      .then(function(v) { q.cmdPending = false; item.resolve(v); lrDrainQueue(); })
      .catch(function(e){ q.cmdPending = false; item.reject(e);  lrDrainQueue(); });
  } catch(e) { q.cmdPending = false; item.reject(e); lrDrainQueue(); }
}

/* ═══════════════════════════════════════════════════════════════════
   Global telemetry line dispatcher
   ═══════════════════════════════════════════════════════════════════ */
function tatDispatchLine(line) {
  if (!line) return;
  /* BLE async events */
  if (/^CFBG:/i.test(line) || /^(SCAN_RESULT:|CONNECTED:|DISC_DONE:|CHAR:|NOTIFY:|DISCONNECTING:|DISCONNECTED:|DESCR_WRITE_OK|WRITE_OK|SCAN_DONE:)/i.test(line)) {
    bleHandleAsyncLine(line);
  }
  /* Zigbee hex frame (starts with "55 ") */
  if (/^55\s+[0-9A-Fa-f]{2}/i.test(line) || /CFZB:[0-9]+:(EVT|OK):/i.test(line)) { zbHandleAsyncLine(line); }
  /* LoRa async events */
  if (/CFLR:[0-9]+:EVT:/i.test(line)) { lrHandleAsyncLine(line); }
  /* Broadcast raw line to monitor widget */
  try {
    window.dispatchEvent(new CustomEvent('da2_tat_raw_line', { detail: { line: line } }));
  } catch(e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   Tab Management
   ═══════════════════════════════════════════════════════════════════ */
function tatSetTab(tab) {
  if (!tab) { console.log('[TAT] tatSetTab: tab param is null'); return; }
  console.log('[TAT] tatSetTab called with:', tab);
  tatState.activeTab = tab;
  var tabs = ['ble', 'zb', 'lora'];
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    var btn = document.getElementById('tat-tab-' + t);
    var cnt = document.getElementById('tat-content-' + t);
    if (!btn) console.log('[TAT] tatSetTab: button tat-tab-' + t + ' not found');
    if (!cnt) console.log('[TAT] tatSetTab: content tat-content-' + t + ' not found');
    if (btn) {
      btn.className = 'tat-tab' + (t === tab ? ' tat-tab-active' : '');
    }
    if (cnt) {
      cnt.style.display = t === tab ? 'flex' : 'none';
    }
  }
  tatLog('i', 'Tab switched to ' + tab);
}

function tatSetSlot(v) {
  var slot = String(v) === '1' ? '1' : '0';
  if (tatState.slot !== slot) tatState.zb.hexNative = false;
  tatState.slot = slot;
  var el = document.getElementById('tat-slot');
  if (el && el.value !== slot) el.value = slot;
  tatLog('i', 'Slot changed to ' + slot);
}

function tatQueryInfo() {
  switch (tatState.activeTab) {
    case 'ble':  bleScan();   break;
    case 'zb':   zbStart();   break;
    case 'lora': lrReadInfo(); break;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   BLE — Scan
   ═══════════════════════════════════════════════════════════════════ */
function bleScan() {
  if (tatState.ble.scanning) { tatLog('w', 'Scan already running'); return; }
  tatState.ble.scanning = true;
  tatState.ble.scanResults = [];
  tatSetPill('scanning', 'Scanning...');
  var btn = document.getElementById('tat-btn-scan');
  if (btn) { 
    btn.disabled = true; 
    btn.textContent = 'Scanning...'; 
  }
  var el = document.getElementById('tat-ble-scan-list');
  if (el) {
    el.innerHTML = '<div class="tat-empty-hint">Scanning...</div>';
  }
  tatLog('i', 'Starting BLE scan 5000 ms...');

  bleEnqueue(function () {
    return sendCFBG('SCAN', '5000', 18000)
      .then(function (resp) {
        if (!resp || resp.indexOf('SCAN_DONE') < 0) {
          /* Response may be a NOTIFY racing with SCAN_DONE — dispatch as async */
          if (resp) tatSplitLines(resp).forEach(bleHandleAsyncLine);
          /* Don't clear scanning flag — SCAN_DONE will arrive via telemetry */
          return;
        }
        tatSplitLines(resp).forEach(bleHandleAsyncLine);
      })
      .catch(function () {
        tatState.ble.scanning = false;
        tatSetPill('idle', 'Idle');
        var b = document.getElementById('tat-btn-scan');
        if (b) { b.disabled = false; b.textContent = 'Scan'; }
      });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   BLE — Connect / Discover
   ═══════════════════════════════════════════════════════════════════ */
function bleConnect(mac) {
  tatLog('i', 'Connecting to ' + mac + '…');
  bleEnqueue(function () {
    return sendCFBG('CONNECT', mac, tatState.rpcTimeout)
      .then(function (resp) {
        tatSplitLines(resp || '').forEach(bleHandleAsyncLine);
      });
  });
}

function bleAutoDiscover(idx) {
  bleEnqueue(function () {
    return sendCFBG('DISC', String(idx), tatState.rpcTimeout)
      .then(function (resp) {
        tatSplitLines(resp || '').forEach(bleHandleAsyncLine);
        bleMaybeEnableNotify(idx);
      });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   BLE — Disconnect
   ═══════════════════════════════════════════════════════════════════ */
function bleDisconnectSelected() {
  var idx = tatState.ble.selectedIdx;
  if (idx === null) return;
  tatLog('i', 'Disconnecting idx=' + idx);
  var capturedIdx = idx;
  bleEnqueue(function () {
    return sendCFBG('DISCONNECT', String(idx))
      .then(function (resp) {
        var found = false;
        tatSplitLines(resp || '').forEach(function (line) {
          if (/^CFBG:OK:DISCONNECT(ING|ED):/i.test(line) || /^DISCONNECT(ING|ED):/i.test(line)) found = true;
          bleHandleAsyncLine(line);
        });
        if (!found) {
          bleHandleDisconnected(capturedIdx);
        }
      })
      .catch(function (err) {
        tatLog('!', 'Disconnect RPC fallback cleanup: ' + (err && err.message ? err.message : err));
        bleHandleDisconnected(capturedIdx);
      });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   BLE — LED Commands
   ═══════════════════════════════════════════════════════════════════ */
function bleLedOn() {
  var idx = tatState.ble.selectedIdx;
  if (idx === null) return;
  var dev = tatState.ble.connected[idx];
  if (!dev || !dev.fff2Handle) { tatToast('FFF2 handle unknown — discover first'); return; }
  bleEnqueue(function () {
    return sendCFBG('WRITE', idx + ':' + dev.fff2Handle + ':01')
      .then(function () { bleLedSetState(idx, true, 'LED ON'); });
  });
}

function bleLedOff() {
  var idx = tatState.ble.selectedIdx;
  if (idx === null) return;
  var dev = tatState.ble.connected[idx];
  if (!dev || !dev.fff2Handle) { tatToast('FFF2 handle unknown'); return; }
  bleEnqueue(function () {
    return sendCFBG('WRITE', idx + ':' + dev.fff2Handle + ':00')
      .then(function () { bleLedSetState(idx, false, 'LED OFF'); });
  });
}

function bleSendColor(hexRGB) {
  var idx = tatState.ble.selectedIdx;
  if (idx === null) return;
  var dev = tatState.ble.connected[idx];
  if (!dev || !dev.fff2Handle) { tatToast('FFF2 handle unknown'); return; }
  bleEnqueue(function () {
    return sendCFBG('WRITE', idx + ':' + dev.fff2Handle + ':' + hexRGB)
      .then(function () {
        var names = { 'FF0000':'Red','00FF00':'Green','0000FF':'Blue','FFFF00':'Yellow','FFFFFF':'White' };
        bleRememberLedColor(idx, names[hexRGB] || hexRGB);
        tatToast('Color set: ' + (names[hexRGB] || hexRGB));
      });
  });
}

function bleApplyInterval() {
  var idx = tatState.ble.selectedIdx;
  if (idx === null) return;
  var dev = tatState.ble.connected[idx];
  if (!dev || !dev.aa12Handle) { tatToast('AA12 handle unknown'); return; }
  var el = document.getElementById('tat-sen-interval');
  var v = el ? parseInt(el.value, 10) : 3;
  if (isNaN(v) || v < 1 || v > 60) { tatToast('Interval must be 1–60 s'); return; }
  var hexV = (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
  bleEnqueue(function () {
    return sendCFBG('WRITE', idx + ':' + dev.aa12Handle + ':' + hexV)
      .then(function () { tatToast('Interval set: ' + v + 's'); });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   BLE — Async Line Handler
   ═══════════════════════════════════════════════════════════════════ */
function bleHandleAsyncLine(line) {
  if (!line) return;
  var l = String(line).trim();
  /* Strip leading log prefix to extract CFBG: part when present */
  var ci = l.indexOf('CFBG:');
  if (ci > 0) l = l.substring(ci);
  if (/^CFBG:OK:/i.test(l)) l = l.substring(8);
  else if (/^CFBG:[0-9]+:EVT:/i.test(l)) l = l.replace(/^CFBG:[0-9]+:EVT:/i, '');

  /* SCAN_DONE */
  var m = l.match(/^SCAN_DONE:(\d+)/i);
  if (m) {
    tatState.ble.scanning = false;
    tatSetPill('idle', 'Idle');
    var btn = document.getElementById('tat-btn-scan');
    if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
    tatLog('i', 'Scan done - ' + m[1] + ' devices');
    bleRenderScanList();
    return;
  }

  /* SCAN_RESULT */
  m = l.match(/^SCAN_RESULT:(\d+),([0-9A-Fa-f:]+),(-?\d+),([^\x1e\n]*)/i);
  if (m) {
    var scanIdx = parseInt(m[1], 10);
    var name = m[4].trim();
    var type = name.indexOf('DA2_LED_') === 0 ? 'led' : (name.indexOf('DA2_SENSOR_') === 0 ? 'sensor' : 'unknown');
    var mac  = m[2].toUpperCase();
    var rssi = parseInt(m[3], 10);
    /* Check if already connected */
    var alreadyConn = false;
    var connKeys = Object.keys(tatState.ble.connected);
    for (var ci2 = 0; ci2 < connKeys.length; ci2++) {
      if (tatState.ble.connected[connKeys[ci2]].mac === mac) { alreadyConn = true; break; }
    }
    var result = { idx: scanIdx, mac: mac, rssi: rssi, name: name, type: type, connected: alreadyConn };
    var found = false;
    for (var si0 = 0; si0 < tatState.ble.scanResults.length; si0++) {
      var existing = tatState.ble.scanResults[si0];
      if (existing.idx === scanIdx || existing.mac === mac) {
        tatState.ble.scanResults[si0] = result;
        found = true;
        break;
      }
    }
    if (!found) tatState.ble.scanResults.push(result);
    bleRenderScanList();
    return;
  }

  /* CONNECTED */
  m = l.match(/^CONNECTED:(\d+):0x([0-9A-Fa-f]+):([0-9A-Fa-f:]+)/i);
  if (m) {
    var devIdx  = parseInt(m[1], 10);
    var connId  = m[2];
    var devMac  = m[3].toUpperCase();
    /* Resolve name/type from scan results */
    var devName = devMac, devType = 'unknown';
    for (var si = 0; si < tatState.ble.scanResults.length; si++) {
      if (tatState.ble.scanResults[si].mac === devMac) {
        devName = tatState.ble.scanResults[si].name;
        devType = tatState.ble.scanResults[si].type;
        tatState.ble.scanResults[si].connected = true;
        break;
      }
    }
    tatState.ble.connected[devIdx] = {
      idx: devIdx,
      mac: devMac,
      name: devName,
      type: devType,
      connId: connId,
      chars: {},
      fff2Handle: null,
      aa11Handle: null,
      aa12Handle: null,
      cccdHandle: null,
      notifyPending: false,
      notifyEnabled: false
    };
    bleRenderGrid();
    bleRenderScanList();
    tatLog('i', 'Connected: ' + devName + ' idx=' + devIdx);
    tatToast('Connected: ' + devName);
    /* Auto discover */
    setTimeout(function () { bleAutoDiscover(devIdx); }, 500);
    return;
  }

  /* DISC_DONE */
  m = l.match(/^DISC_DONE:(\d+):/i);
  if (m) {
    var dIdx = parseInt(m[1], 10);
    tatLog('i', 'Discovered chars for idx=' + dIdx);
    if (!tatState.ble.connected[dIdx]) return;
    bleRenderGrid();
    return;
  }

  /* CHAR discovery line: CFBG:OK:CHAR:<idx>:0x<uuid>:0x<handle>:0x<props> */
  m = l.match(/^CHAR:(\d+):0x([0-9A-Fa-f]+):0x([0-9A-Fa-f]+):0x([0-9A-Fa-f]+)/i);
  if (m) {
    var cIdx    = parseInt(m[1], 10);
    var uuid16  = m[2].toUpperCase();
    var handle  = m[3].toUpperCase();
    var dev3 = tatState.ble.connected[cIdx];
    if (dev3) {
      dev3.chars[uuid16] = handle;
      /* FFF2 — LED write characteristic */
      if (uuid16 === 'FFF2') dev3.fff2Handle = handle;
      /* AA11 — Sensor NOTIFY characteristic */
      if (uuid16 === 'AA11') dev3.aa11Handle = handle;
      /* AA12 — Sensor interval write */
      if (uuid16 === 'AA12') dev3.aa12Handle = handle;
      /* AA12 CCCD: handle immediately after AA11 (handle+1) */
      if (uuid16 === 'AA11' && !dev3.cccdHandle) {
        var h = parseInt(handle, 16);
        dev3.cccdHandle = (h + 1).toString(16).toUpperCase().padStart(4, '0');
      }
      /* 2902 — explicit CCCD */
      if (uuid16 === '2902' && dev3.aa11Handle) dev3.cccdHandle = handle;
      bleMaybeEnableNotify(cIdx);
    }
    return;
  }

  /* NOTIFY async — sensor data */
  m = l.match(/^NOTIFY:(\d+):0x([0-9A-Fa-f]+):([0-9A-Fa-f]+)/i);
  if (m) {
    var nIdx = parseInt(m[1], 10);
    var hex4 = m[3];
    if (hex4.length >= 8) {
      var t = parseInt(hex4.substr(0,2), 16) | (parseInt(hex4.substr(2,2), 16) << 8);
      if (t > 32767) t -= 65536;
      var h2 = parseInt(hex4.substr(4,2), 16) | (parseInt(hex4.substr(6,2), 16) << 8);
      if (h2 > 32767) h2 -= 65536;
      var temp = (t / 100.0).toFixed(1);
      var hum  = (h2 / 100.0).toFixed(1);
      if (!tatState.ble.sensorData[nIdx]) tatState.ble.sensorData[nIdx] = { temp: null, hum: null, count: 0, lastTs: 0 };
      tatState.ble.sensorData[nIdx].temp  = temp;
      tatState.ble.sensorData[nIdx].hum   = hum;
      tatState.ble.sensorData[nIdx].count++;
      tatState.ble.sensorData[nIdx].lastTs = Date.now();
      if (tatState.ble.selectedIdx === nIdx) bleUpdateSensorPanel(nIdx);
      /* Broadcast to monitor */
      var dev4 = tatState.ble.connected[nIdx];
      if (dev4) tatBroadcastDeviceData('ble', 'sensor', nIdx, dev4.name, dev4.mac, {
        temp: temp,
        hum: hum,
        sampleCount: tatState.ble.sensorData[nIdx].count
      });
    }
    return;
  }

  /* DESCR_WRITE_OK — NOTIFY enabled confirmation */
  if (/^DESCR_WRITE_OK/i.test(l)) {
    tatLog('i', 'NOTIFY enabled OK');
    return;
  }

  /* WRITE_OK */
  if (/^WRITE_OK/i.test(l)) {
    return;
  }

  /* DISCONNECTED */
  m = l.match(/^DISCONNECTING:(\d+)/i);
  if (m) {
    bleHandleDisconnected(parseInt(m[1], 10));
    return;
  }

  /* DISCONNECTED */
  m = l.match(/^DISCONNECTED:(\d+)/i);
  if (m) {
    bleHandleDisconnected(parseInt(m[1], 10));
    return;
  }
}

function bleMaybeEnableNotify(idx) {
  var dev = tatState.ble.connected[idx];
  if (!dev || dev.type !== 'sensor' || !dev.aa11Handle || !dev.cccdHandle) return;
  if (dev.notifyPending || dev.notifyEnabled) return;
  dev.notifyPending = true;
  bleEnqueue(function () {
    return sendCFBG('NOTIFY', idx + ':' + dev.cccdHandle + ':1', 10000)
      .then(function (resp) {
        dev.notifyPending = false;
        dev.notifyEnabled = true;
        tatLog('i', 'NOTIFY enabled for ' + dev.name);
        tatSplitLines(resp || '').forEach(bleHandleAsyncLine);
      })
      .catch(function (err) {
        dev.notifyPending = false;
        tatLog('!', 'Enable NOTIFY failed for ' + dev.name + ': ' + (err && err.message ? err.message : err));
        throw err;
      });
  });
}

function bleHandleDisconnected(devIdx) {
  var dev = tatState.ble.connected[devIdx];
  if (!dev) return;
  var name = dev.name;
  var mac  = dev.mac;
  delete tatState.ble.connected[devIdx];
  delete tatState.ble.sensorData[devIdx];
  for (var i = 0; i < tatState.ble.scanResults.length; i++) {
    if (tatState.ble.scanResults[i].mac === mac) {
      tatState.ble.scanResults[i].connected = false;
    }
  }
  if (tatState.ble.selectedIdx === devIdx) {
    tatState.ble.selectedIdx = null;
    bleShowDetailHint();
  }
  bleRenderGrid();
  bleRenderScanList();
  tatLog('i', 'Disconnected: ' + name);
  tatToast('Disconnected: ' + name);
}

/* ═══════════════════════════════════════════════════════════════════
   BLE — Render functions
   ═══════════════════════════════════════════════════════════════════ */
function tatIconSvg(name) {
  if (name === 'led') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6m-5 3h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.9.8 1.4 1.8 1.6 2.9h4.4c.2-1.1.7-2.1 1.6-2.9A6 6 0 0 0 12 3z"/></svg>';
  }
  if (name === 'sensor') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14.5V6a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z"/><circle cx="12" cy="18" r="1.3" fill="currentColor" stroke="none"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.6 2.6 0 1 1 4.5 1.8c-.8.8-1.7 1.3-1.7 2.7"/><circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none"/></svg>';
}

function bleRenderScanList() {
  var el = document.getElementById('tat-ble-scan-list');
  if (!el) return;
  var results = tatState.ble.scanResults;
  var badge = document.getElementById('tat-ble-scan-cnt');
  if (badge) badge.textContent = results.length;
  if (!results.length) {
    el.innerHTML = '<div class="tat-empty-hint">No devices found</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var connectedNow = false;
    var connKeys = Object.keys(tatState.ble.connected);
    for (var j = 0; j < connKeys.length; j++) {
      var dev = tatState.ble.connected[connKeys[j]];
      if (dev && dev.mac === r.mac) {
        connectedNow = true;
        break;
      }
    }
    r.connected = connectedNow;
    var icon = tatIconSvg(r.type === 'led' ? 'led' : (r.type === 'sensor' ? 'sensor' : 'unknown'));
    var rssiPct = Math.max(0, Math.min(100, (r.rssi + 100) * 2));
    var connTxt = connectedNow ? 'Connected' : 'Connect';
    var connDis = connectedNow ? 'disabled' : '';
    html += '<div class="tat-scan-item">' +
      '<div class="tat-scan-top">' +
        '<span class="tat-scan-icon">' + icon + '</span>' +
        '<span class="tat-scan-name">' + tatEsc(r.name) + '</span>' +
      '</div>' +
      '<div class="tat-scan-mac">' + r.mac + '</div>' +
      '<div class="tat-scan-bot">' +
        '<div class="tat-rssi-wrap">' +
          '<div class="tat-rssi-bar"><div class="tat-rssi-fill" style="width:' + rssiPct + '%"></div></div>' +
          '<span class="tat-rssi-txt">' + r.rssi + 'dBm</span>' +
        '</div>' +
        '<button class="tat-btn-connect" ' + connDis + ' onclick="bleConnect(\'' + r.mac + '\')">' + connTxt + '</button>' +
      '</div>' +
    '</div>';
  }
  el.innerHTML = html;
}

function bleRenderGrid() {
  var el = document.getElementById('tat-ble-grid');
  if (!el) return;
  var keys = Object.keys(tatState.ble.connected);
  var badge = document.getElementById('tat-ble-conn-cnt');
  if (badge) badge.textContent = keys.length;
  if (!keys.length) {
    el.innerHTML = '<div class="tat-empty-hint">No connected devices yet</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < keys.length; i++) {
    var dev = tatState.ble.connected[keys[i]];
    var icon = tatIconSvg(dev.type === 'led' ? 'led' : (dev.type === 'sensor' ? 'sensor' : 'unknown'));
    var sel  = tatState.ble.selectedIdx == dev.idx ? ' selected' : '';
    html += '<div class="tat-dev-card' + sel + '" onclick="bleSelectDevice(' + dev.idx + ')">' +
      '<div class="tat-dev-card-icon">' + icon + '</div>' +
      '<div class="tat-dev-card-name">' + tatEsc(dev.name) + '</div>' +
      '<div class="tat-dev-card-badge badge-online">Online</div>' +
    '</div>';
  }
  el.innerHTML = html;
}

function bleSelectDevice(idx) {
  tatState.ble.selectedIdx = idx;
  bleRenderGrid();
  var dev = tatState.ble.connected[idx];
  if (!dev) { bleShowDetailHint(); return; }
  bleShowDetailHint();
  if (dev.type === 'led') {
    bleShowLedPanel(idx, dev);
  } else if (dev.type === 'sensor') {
    bleShowSensorPanel(idx, dev);
  }
}

function bleShowDetailHint() {
  var hint = document.getElementById('tat-ble-hint');
  var led  = document.getElementById('tat-ble-led');
  var sen  = document.getElementById('tat-ble-sensor');
  if (hint) hint.style.display = 'block';
  if (led)  led.style.display  = 'none';
  if (sen)  sen.style.display  = 'none';
}

function bleShowLedPanel(idx, dev) {
  var hint = document.getElementById('tat-ble-hint');
  var led  = document.getElementById('tat-ble-led');
  var sen  = document.getElementById('tat-ble-sensor');
  if (hint) hint.style.display = 'none';
  if (sen)  sen.style.display  = 'none';
  if (led)  led.style.display  = 'block';
  tatSet('tat-led-title', tatEsc(dev.name));
  tatSet('tat-led-mac', dev.mac);
  tatSet('tat-led-handle', dev.fff2Handle ? 'Handle FFF2: 0x' + dev.fff2Handle : '(discovering...)');
  bleRefreshLedBadge(idx);
}

function bleShowSensorPanel(idx, dev) {
  var hint = document.getElementById('tat-ble-hint');
  var led  = document.getElementById('tat-ble-led');
  var sen  = document.getElementById('tat-ble-sensor');
  if (hint) hint.style.display = 'none';
  if (led)  led.style.display  = 'none';
  if (sen)  sen.style.display  = 'block';
  tatSet('tat-sen-title', tatEsc(dev.name));
  tatSet('tat-sen-mac', dev.mac);
  tatSet('tat-sen-cccd', dev.cccdHandle ? 'CCCD (AA11): 0x' + dev.cccdHandle : '(discovering...)');
  bleUpdateSensorPanel(idx);
}

function bleUpdateSensorPanel(idx) {
  var sd = tatState.ble.sensorData[idx];
  if (!sd) return;
  tatSet('tat-sen-temp', sd.temp !== null ? sd.temp + ' °C' : '—');
  tatSet('tat-sen-hum',  sd.hum  !== null ? sd.hum  + ' %' : '—');
  tatSet('tat-sen-cnt',  String(sd.count));
  tatSet('tat-sen-last', sd.lastTs ? tatFmtTime(new Date(sd.lastTs)) : '—');
}

function bleLedSetState(idx, on, lastCmd) {
  if (!tatState.ble.sensorData[idx]) tatState.ble.sensorData[idx] = {};
  tatState.ble.sensorData[idx].on = on;
  tatState.ble.sensorData[idx].lastTs = Date.now();
  if (lastCmd) tatState.ble.sensorData[idx].lastCmd = lastCmd;
  bleRefreshLedBadge(idx);
  bleBroadcastLedState(idx);
}

function bleRememberLedColor(idx, colorName) {
  if (!tatState.ble.sensorData[idx]) tatState.ble.sensorData[idx] = {};
  tatState.ble.sensorData[idx].on = true;
  tatState.ble.sensorData[idx].color = colorName;
  tatState.ble.sensorData[idx].lastCmd = 'Set Color ' + colorName;
  tatState.ble.sensorData[idx].lastTs = Date.now();
  bleRefreshLedBadge(idx);
  bleBroadcastLedState(idx);
}

function bleRefreshLedBadge(idx) {
  if (tatState.ble.selectedIdx === idx) {
    var badge = document.getElementById('tat-led-state');
    var sd = tatState.ble.sensorData[idx] || {};
    if (badge) {
      if (sd.on === true || sd.on === false) {
        badge.textContent  = sd.on ? 'ON' : 'OFF';
        badge.className = 'tat-state-badge ' + (sd.on ? 'tat-state-on' : 'tat-state-off');
      } else {
        badge.textContent = '--';
        badge.className = 'tat-state-badge';
      }
    }
  }
}

function bleBroadcastLedState(idx) {
  var dev = tatState.ble.connected[idx];
  var sd = tatState.ble.sensorData[idx];
  if (dev && sd) {
    tatBroadcastDeviceData('ble', 'led', idx, dev.name, dev.mac, {
      on: sd.on,
      color: sd.color || '—',
      lastCmd: sd.lastCmd || '—'
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Zigbee — Network Actions
   ═══════════════════════════════════════════════════════════════════ */
function zbStart() {
  zbEnqueue(function () {
    zbSetNetBadge('starting');
    return sendCFZB('MODULE_START_NETWORK', '', 8000)
      .catch(function () { zbSetNetBadge('off'); });
  });
}

function zbStop() {
  zbEnqueue(function () {
    return sendCFZB('MODULE_STOP_NETWORK', '', 8000)
      .then(function () {
        tatState.zb.networkUp = false;
        zbSetNetBadge('off');
        tatLog('i', 'Network stopped');
      });
  });
}

function zbPermitJoin() {
  zbEnqueue(function () {
    return sendCFZB('MODULE_SET_PERMIT_JOIN', 'B4', 8000)
      .then(function () { tatLog('i', 'Permit join 180s sent'); tatToast('Permit join 180s'); });
  });
}

function zbFind() {
  zbEnqueue(function () {
    return sendCFZB('MODULE_AUTO_FIND_TARGET', '', 8000)
      .then(function () { tatLog('i', 'Find target sent'); });
  });
}

function zbResetState() {
  tatState.zb.nodes = {};
  tatState.zb.selectedNode = null;
  tatState.zb.networkUp = false;
  tatState.zb.hexNative = false;
  zbSetNetBadge('off');
  zbRenderNodeList();
  zbShowOverlay();
  tatLog('i', 'Zigbee state reset');
}

function zbSetNetBadge(state) {
  tatState.zb.networkUp = (state === 'active');
  var el = document.getElementById('tat-zb-net-badge');
  if (!el) return;
  el.setAttribute('data-state', state);
  if (state === 'active') {
    el.textContent = 'Active' + (tatState.zb.channel ? ' CH:' + tatState.zb.channel : '') +
                     (tatState.zb.panId ? ' PAN:' + tatState.zb.panId : '');
  } else if (state === 'starting') {
    el.textContent = 'Starting...';
  } else {
    el.textContent = 'OFF';
  }
}

function zbUseHexNative() {
  return tatState.zb.hexNative === true;
}

function zbParseHexNumber(value) {
  var clean = String(value === undefined || value === null ? '' : value)
    .replace(/^0x/i, '')
    .replace(/[^0-9A-Fa-f]/g, '');
  return clean ? parseInt(clean, 16) : 0;
}

function zbCsvHexToBytes(csv) {
  if (!csv) return [];
  return String(csv).split(',').map(function (part) {
    return zbParseHexNumber(part) & 0xFF;
  });
}

function zbBytesToHexStr(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xFF;
    out.push((b < 16 ? '0' : '') + b.toString(16).toUpperCase());
  }
  return out.join(' ');
}

function zbBuildEbyteFrame(typeByte, codeByte, dataBytes) {
  dataBytes = dataBytes || [];
  var payload = [typeByte, codeByte].concat(dataBytes);
  var checksum = 0;
  for (var i = 0; i < payload.length; i++) checksum ^= payload[i];
  var length = payload.length + 1;
  return [0x55, length].concat(payload).concat([checksum]);
}

function zbBuildZclFrame(codeByte, shortHex, epHex, clusterHex, extData) {
  var shortAddr = zbParseHexNumber(shortHex) & 0xFFFF;
  var ep = zbParseHexNumber(epHex) & 0xFF;
  var cluster = zbParseHexNumber(clusterHex) & 0xFFFF;
  var seq = (tatState.zb.hexSeq++) & 0xFF;
  var header = [
    0x00,
    shortAddr & 0xFF,
    (shortAddr >> 8) & 0xFF,
    ep,
    seq,
    0x00,
    cluster & 0xFF,
    (cluster >> 8) & 0xFF,
    0x00,
    0x00,
    0x00
  ];
  return zbBuildEbyteFrame(0x02, codeByte, header.concat(extData || []));
}

function zbBuildReadAttrCommand(shortHex, epHex, clusterHex, attrHex) {
  var attrId = zbParseHexNumber(attrHex) & 0xFFFF;
  return zbBytesToHexStr(zbBuildZclFrame(0x00, shortHex, epHex, clusterHex, [
    0x01,
    attrId & 0xFF,
    (attrId >> 8) & 0xFF
  ]));
}

function zbBuildControlCommand(shortHex, epHex, clusterHex, cmdHex, paramsCsv) {
  var ext = [zbParseHexNumber(cmdHex) & 0xFF].concat(zbCsvHexToBytes(paramsCsv));
  return zbBytesToHexStr(zbBuildZclFrame(0x0F, shortHex, epHex, clusterHex, ext));
}

function zbBuildReportRuleCommand(shortHex, epHex, clusterHex, attrHex, dataTypeHex, minHex, maxHex, changeHex) {
  var attrId = zbParseHexNumber(attrHex) & 0xFFFF;
  var minVal = zbParseHexNumber(minHex) & 0xFFFF;
  var maxVal = zbParseHexNumber(maxHex) & 0xFFFF;
  var delta = zbParseHexNumber(changeHex) & 0xFFFF;
  return zbBytesToHexStr(zbBuildZclFrame(0x03, shortHex, epHex, clusterHex, [
    attrId & 0xFF,
    (attrId >> 8) & 0xFF,
    zbParseHexNumber(dataTypeHex) & 0xFF,
    minVal & 0xFF,
    (minVal >> 8) & 0xFF,
    maxVal & 0xFF,
    (maxVal >> 8) & 0xFF,
    delta & 0xFF,
    (delta >> 8) & 0xFF
  ]));
}

function zbSendReadAttr(shortHex, epHex, clusterHex, attrHex, timeout) {
  if (zbUseHexNative()) {
    return sendCFZB('MODULE_ZCL_READ_ATTR', zbBuildReadAttrCommand(shortHex, epHex, clusterHex, attrHex), timeout);
  }
  return sendCFZB('MODULE_ZCL_READ_ATTR', shortHex + ',' + epHex + ',' + clusterHex + ',' + attrHex, timeout);
}

function zbSendControlCmd(shortHex, epHex, clusterHex, cmdHex, paramsCsv, timeout) {
  if (zbUseHexNative()) {
    return sendCFZB('MODULE_ZCL_SEND_CONTROL_CMD', zbBuildControlCommand(shortHex, epHex, clusterHex, cmdHex, paramsCsv), timeout);
  }
  var payload = shortHex + ',' + epHex + ',' + clusterHex + ',' + cmdHex;
  if (paramsCsv) payload += ',' + paramsCsv;
  return sendCFZB('MODULE_ZCL_SEND_CONTROL_CMD', payload, timeout);
}

function zbSendReportRule(shortHex, epHex, clusterHex, attrHex, dataTypeHex, minHex, maxHex, changeHex, timeout) {
  if (zbUseHexNative()) {
    return sendCFZB('MODULE_ZCL_SET_REPORT_RULE', zbBuildReportRuleCommand(shortHex, epHex, clusterHex, attrHex, dataTypeHex, minHex, maxHex, changeHex), timeout);
  }
  return sendCFZB(
    'MODULE_ZCL_SET_REPORT_RULE',
    shortHex + ',' + epHex + ',' + clusterHex + ',' + attrHex + ',' + dataTypeHex + ',' + minHex + ',' + maxHex + ',' + changeHex,
    timeout
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Zigbee — Node List
   ═══════════════════════════════════════════════════════════════════ */
function zbAddNode(short, ieee, ep) {
  if (!tatState.zb.nodes[short]) {
    tatState.zb.nodes[short] = {
      short: short, ieee: ieee, ep: ep || '?',
      name: '0x' + short, type: 'unknown',
      verified: false, verifyFailed: false, verifyAttempts: 0
    };
  } else {
    if (ieee && ieee !== '????????????????') tatState.zb.nodes[short].ieee = ieee;
    if (ep && ep !== '?') tatState.zb.nodes[short].ep = ep;
  }
  zbRenderNodeList();
}

function zbHandleNodeJoin(short, ieee) {
  tatLog('EVT', 'Node join: 0x' + short + ' IEEE:' + ieee);
  zbAddNode(short, ieee, '?');
  /* Schedule auto-verify after announce */
  ;(function(sh) {
    setTimeout(function () {
      var n = tatState.zb.nodes[sh];
      if (!n || n.verified) return;
      var ep = (n.ep && n.ep !== '?') ? n.ep : '0B';
      zbQueueVerify(sh, ep);
    }, 10000);
  }(short));
}

function zbHandleNodeAnnounce(short, ieee, ep) {
  tatLog('EVT', 'Node announce: 0x' + short + ' EP:' + ep);
  zbAddNode(short, ieee, ep);
  ;(function(sh, e) {
    setTimeout(function () { zbQueueVerify(sh, e); }, 2000);
  }(short, ep || '01'));
}

function zbHandleNodeLeave(ieee) {
  tatLog('EVT', 'Node leave: ' + ieee);
  var keys = Object.keys(tatState.zb.nodes);
  for (var i = 0; i < keys.length; i++) {
    if (tatState.zb.nodes[keys[i]].ieee === ieee) {
      delete tatState.zb.nodes[keys[i]];
      if (tatState.zb.selectedNode === keys[i]) {
        tatState.zb.selectedNode = null;
        zbShowOverlay();
      }
    }
  }
  zbRenderNodeList();
}

function zbRenderNodeList() {
  var el = document.getElementById('tat-zb-node-list');
  if (!el) return;
  var keys = Object.keys(tatState.zb.nodes);
  var badge = document.getElementById('tat-zb-node-cnt');
  if (badge) badge.textContent = keys.length;
  if (!keys.length) {
    el.innerHTML = '<div class="tat-empty-hint">Start network &amp; permit join to see nodes</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < keys.length; i++) {
    var n = tatState.zb.nodes[keys[i]];
    var icon = tatIconSvg(n.type === 'led' ? 'led' : (n.type === 'sensor' ? 'sensor' : 'unknown'));
    var badgeCls = n.verified ? 'tat-node-badge tat-verified' : (n.verifyFailed ? 'tat-node-badge tat-failed' : 'tat-node-badge tat-unverified');
    var badgeTxt = n.verified ? 'OK' : (n.verifyFailed ? 'ERR' : 'NEW');
    var sel = tatState.zb.selectedNode === n.short ? ' selected' : '';
    html += '<div class="tat-node-item' + sel + '" onclick="zbSelectNode(\'' + n.short + '\')">' +
      '<span class="tat-node-icon">' + icon + '</span>' +
      '<span class="tat-node-name">' + tatEsc(n.name) + '</span>' +
      '<span class="tat-node-addr">0x' + n.short + '</span>' +
      '<span class="' + badgeCls + '">' + badgeTxt + '</span>' +
    '</div>';
  }
  el.innerHTML = html;
}

function zbSelectNode(short) {
  tatState.zb.selectedNode = short;
  zbRenderNodeList();
  var n = tatState.zb.nodes[short];
  if (!n) { zbShowOverlay(); return; }
  zbHideOverlay();
  if (n.type === 'led') {
    zbShowBulbPanel(n);
  } else if (n.type === 'sensor') {
    zbShowSensorPanel(n);
  } else {
    /* Unknown — show overlay with hint */
    var ov = document.getElementById('tat-zb-overlay');
    if (ov) {
      ov.style.display = 'flex';
      var msg = ov.querySelector('.tat-overlay-msg');
      if (msg) msg.textContent = 'Verifying node 0x' + short + '... (auth key check)';
    }
  }
}

function zbShowOverlay() {
  var ov  = document.getElementById('tat-zb-overlay');
  var bl  = document.getElementById('tat-zb-bulb');
  var sen = document.getElementById('tat-zb-sensor');
  if (ov)  { ov.style.display = 'flex'; var m = ov.querySelector('.tat-overlay-msg'); if (m) m.textContent = 'Start network & select a node to control'; }
  if (bl)  bl.style.display  = 'none';
  if (sen) sen.style.display = 'none';
}

function zbHideOverlay() {
  var ov  = document.getElementById('tat-zb-overlay');
  if (ov) ov.style.display = 'none';
}

function zbShowBulbPanel(n) {
  var bl  = document.getElementById('tat-zb-bulb');
  var sen = document.getElementById('tat-zb-sensor');
  if (bl)  bl.style.display  = 'block';
  if (sen) sen.style.display = 'none';
  tatSet('tat-bulb-title', tatEsc(n.name));
  tatSet('tat-bulb-short', '0x' + n.short);
  tatSet('tat-bulb-ep', 'EP:0x0A');
  var sd = tatState.zb.sensorData[n.short];
  var onBadge = document.getElementById('tat-bulb-state');
  if (onBadge && sd) {
    onBadge.textContent = sd.onOff ? 'ON' : 'OFF';
    onBadge.className = 'tat-state-badge ' + (sd.onOff ? 'tat-state-on' : 'tat-state-off');
  }
}

function zbShowSensorPanel(n) {
  var bl  = document.getElementById('tat-zb-bulb');
  var sen = document.getElementById('tat-zb-sensor');
  if (bl)  bl.style.display  = 'none';
  if (sen) sen.style.display = 'block';
  tatSet('tat-zbsen-title', tatEsc(n.name));
  tatSet('tat-zbsen-short', '0x' + n.short);
  tatSet('tat-zbsen-ep', 'EP:0x0B');
  zbUpdateSensorPanel(n.short);
}

function zbUpdateSensorPanel(short) {
  var sd = tatState.zb.sensorData[short];
  if (!sd) return;
  tatSet('tat-zbsen-temp', sd.temp !== null && sd.temp !== undefined ? sd.temp.toFixed(1) + ' °C' : '—');
  tatSet('tat-zbsen-hum',  sd.hum  !== null && sd.hum  !== undefined ? sd.hum.toFixed(1)  + ' %' : '—');
  tatSet('tat-zbsen-cnt',  String(sd.count || 0));
  tatSet('tat-zbsen-last', sd.lastTs ? tatFmtTime(new Date(sd.lastTs)) : '—');
}

/* ═══════════════════════════════════════════════════════════════════
   Zigbee — ZCL Commands
   ═══════════════════════════════════════════════════════════════════ */
var ZB_BULB_EP = '0A';

function zbBulbOn() {
  var n = zbGetSelected(); if (!n) return;
  zbEnqueue(function() { return zbSendControlCmd(n.short, ZB_BULB_EP, '0006', '01', '', 8000); })
    .then(function() { zbSetBulbState(n.short, true, 'Turn ON'); });
}

function zbBulbOff() {
  var n = zbGetSelected(); if (!n) return;
  zbEnqueue(function() { return zbSendControlCmd(n.short, ZB_BULB_EP, '0006', '00', '', 8000); })
    .then(function() { zbSetBulbState(n.short, false, 'Turn OFF'); });
}

function zbBulbToggle() {
  var n = zbGetSelected(); if (!n) return;
  zbEnqueue(function() { return zbSendControlCmd(n.short, ZB_BULB_EP, '0006', '02', '', 8000); })
    .then(function() { zbRememberBulbUpdate(n.short, { lastCmd: 'Toggle' }); });
}

function zbBulbLevel(pct) {
  var n = zbGetSelected(); if (!n) return;
  var levelBytes = { 0: '00,00,01,00', 25: '3F,00,01,00', 50: '7F,00,01,00', 75: 'BF,00,01,00', 100: 'FE,00,01,00' };
  var params = levelBytes[pct] || '7F,00,01,00';
  zbEnqueue(function() { return zbSendControlCmd(n.short, ZB_BULB_EP, '0008', '04', params, 8000); })
    .then(function() { zbRememberBulbUpdate(n.short, { level: pct, lastCmd: 'Set Level ' + pct + '%' }); });
}

var ZB_XY_COLORS = {
  red:   'B3,74,32,78,0A,00',
  green: '30,2B,7A,C0,0A,00',
  blue:  '14,CC,0A,55,0A,00',
  white: '4C,2F,51,29,0A,00'
};

function zbBulbColor(colorName) {
  var n = zbGetSelected(); if (!n) return;
  var xy = ZB_XY_COLORS[colorName];
  if (!xy) return;
  zbEnqueue(function() { return zbSendControlCmd(n.short, ZB_BULB_EP, '0300', '07', xy, 8000); })
    .then(function() {
      var label = colorName.charAt(0).toUpperCase() + colorName.substring(1);
      zbRememberBulbUpdate(n.short, { color: label, lastCmd: 'Set Color ' + label });
      tatToast('Color: ' + colorName);
    });
}

function zbReadBulbStatus() {
  var n = zbGetSelected(); if (!n) return;
  zbEnqueue(function() { return zbSendReadAttr(n.short, ZB_BULB_EP, '0006', '0000', 10000); });
}

var ZB_SENSOR_EP = '0B';

function zbConfigReport() {
  var n = zbGetSelected(); if (!n || n.type !== 'sensor') return;
  var minEl = document.getElementById('tat-zbsen-min');
  var maxEl = document.getElementById('tat-zbsen-max');
  var minS = minEl ? (parseInt(minEl.value, 10) || 5) : 5;
  var maxS = maxEl ? (parseInt(maxEl.value, 10) || 60) : 60;
  var minHex = ('0000' + minS.toString(16).toUpperCase()).slice(-4);
  var maxHex = ('0000' + maxS.toString(16).toUpperCase()).slice(-4);
  var short = n.short;
  zbEnqueue(function() { return zbSendReportRule(short, ZB_SENSOR_EP, '0402', '0000', '29', minHex, maxHex, '0064', 10000); })
    .then(function() {
      return zbEnqueue(function() { return zbSendReportRule(short, ZB_SENSOR_EP, '0405', '0000', '21', minHex, maxHex, '0064', 10000); });
    })
    .then(function() { tatToast('Configure Reporting sent'); });
}

function zbReadTemp() {
  var n = zbGetSelected(); if (!n) return;
  zbEnqueue(function() { return zbSendReadAttr(n.short, ZB_SENSOR_EP, '0402', '0000', 10000); });
}

function zbReadHum() {
  var n = zbGetSelected(); if (!n) return;
  zbEnqueue(function() { return zbSendReadAttr(n.short, ZB_SENSOR_EP, '0405', '0000', 10000); });
}

function zbDeleteNode() {
  var short = tatState.zb.selectedNode;
  if (!short) return;
  delete tatState.zb.nodes[short];
  delete tatState.zb.sensorData[short];
  tatState.zb.selectedNode = null;
  zbShowOverlay();
  zbRenderNodeList();
  tatLog('i', 'Deleted node 0x' + short);
}

function zbGetSelected() {
  var short = tatState.zb.selectedNode;
  return short ? tatState.zb.nodes[short] : null;
}

function zbSetBulbState(short, on, lastCmd) {
  zbRememberBulbUpdate(short, { on: on, lastCmd: lastCmd || (on ? 'Turn ON' : 'Turn OFF') });
  if (tatState.zb.selectedNode === short) {
    var badge = document.getElementById('tat-bulb-state');
    if (badge) {
      badge.textContent = on ? 'ON' : 'OFF';
      badge.className = 'tat-state-badge ' + (on ? 'tat-state-on' : 'tat-state-off');
    }
  }
}

function zbRememberBulbUpdate(short, patch) {
  if (!tatState.zb.sensorData[short]) {
    tatState.zb.sensorData[short] = { temp: null, hum: null, count: 0, lastTs: 0, onOff: false, level: 0 };
  }
  var sd = tatState.zb.sensorData[short];
  var keys = Object.keys(patch || {});
  for (var i = 0; i < keys.length; i++) {
    sd[keys[i]] = patch[keys[i]];
  }
  if (patch && patch.on !== undefined) {
    sd.on = patch.on;
    sd.onOff = patch.on;
  }
  sd.lastTs = Date.now();
  var node = tatState.zb.nodes[short];
  if (node) {
    tatBroadcastDeviceData('zb', 'led', short, node.name, '0x' + short + ' / EP:' + ZB_BULB_EP, sd);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Zigbee — Auto-Verify (read Model Identifier = Basic/0x0005)
   ═══════════════════════════════════════════════════════════════════ */
function zbQueueVerify(short, ep) {
  var n = tatState.zb.nodes[short];
  if (!n) return;
  if (n.verified || n.verifyFailed) return;
  for (var i = 0; i < tatState.zb.verifyQueue.length; i++) {
    if (tatState.zb.verifyQueue[i].short === short) return;
  }
  tatState.zb.verifyQueue.push({ short: short, ep: ep });
  if (!tatState.zb.verifyRunning) zbRunVerifyQueue();
}

function zbRunVerifyQueue() {
  var q = tatState.zb;
  if (q.verifyQueue.length === 0) { q.verifyRunning = false; return; }
  q.verifyRunning = true;
  var item = q.verifyQueue.shift();
  var n = q.nodes[item.short];
  if (!n || n.verified || n.verifyFailed) {
    setTimeout(zbRunVerifyQueue, 200); return;
  }
  n.verifyAttempts = (n.verifyAttempts || 0) + 1;
  tatLog('i', 'Auto-verify 0x' + item.short + ' (attempt ' + n.verifyAttempts + ')…');
  /* Read Basic cluster Model Identifier (attr 0x0005) */
  zbEnqueue(function () {
    return zbSendReadAttr(item.short, item.ep, '0000', '0005', 10000)
      .then(function (resp) {
        var syncResp = resp || '';
        var respLines = tatSplitLines(syncResp);
        for (var ri = 0; ri < respLines.length; ri++) {
          zbHandleAsyncLine(respLines[ri]);
        }
        if (/DATN_AUTH_KEY:/i.test(syncResp)) {
          zbHandleModelIdResponse(item.short, syncResp);
        }
        setTimeout(zbRunVerifyQueue, 300);
      })
      .catch(function () {
        if (n.verifyAttempts < 3) {
          q.verifyQueue.push(item);
        } else {
          n.verifyFailed = true;
          tatLog('!', 'Verify gave up: 0x' + item.short);
          zbRenderNodeList();
        }
        setTimeout(zbRunVerifyQueue, 300);
      });
  });
}

function zbHandleModelIdResponse(short, resp) {
  var n = tatState.zb.nodes[short];
  if (!n) return;
  /* Try to extract model string from response */
  var m = resp.match(/DATN_AUTH_KEY:([^\x1e\n",]+)/i);
  if (!m) {
    /* Also scan hex character strings from ZCL attr response */
    var hexMatch = resp.match(/42\s+([0-9A-Fa-f\s]+)/);
    if (hexMatch) {
      var str = '';
      var bytes = hexMatch[1].trim().split(/\s+/);
      var len = parseInt(bytes[0], 16);
      for (var i = 1; i <= len && i < bytes.length; i++) {
        str += String.fromCharCode(parseInt(bytes[i], 16));
      }
      m = str.match(/DATN_AUTH_KEY:([^\s,]+)/i);
    }
  }
  if (m) {
    var deviceName = m[1].trim();
    n.verified = true;
    n.name = deviceName;
    n.type = (deviceName.indexOf('bulb') >= 0 || deviceName.indexOf('led') >= 0) ? 'led' :
             (deviceName.indexOf('sensor') >= 0) ? 'sensor' : 'unknown';
    tatLog('i', 'Node 0x' + short + ' verified: ' + deviceName + ' type=' + n.type);
    tatToast('Verified: ' + deviceName);
    /* Sensor: auto-configure reporting */
    if (n.type === 'sensor') {
      setTimeout(function () {
        zbEnqueue(function() { return zbSendReportRule(short, ZB_SENSOR_EP, '0402', '0000', '29', '0005', '003C', '0064', 10000); })
          .then(function() { return zbEnqueue(function() { return zbSendReportRule(short, ZB_SENSOR_EP, '0405', '0000', '21', '0005', '003C', '0064', 10000); }); });
      }, 1000);
    }
    zbRenderNodeList();
    /* If this node is selected, update control panel */
    if (tatState.zb.selectedNode === short) zbSelectNode(short);
  } else {
    tatLog('!', 'Auth key not found in response for 0x' + short);
    if (n.verifyAttempts >= 3) {
      n.verifyFailed = true;
      zbRenderNodeList();
    }
  }
}

function zbHexWordsToBytes(text) {
  if (!text) return [];
  var s = String(text).trim();
  if (!s) return [];
  if (/^[0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2})*$/.test(s)) {
    return s.split(/\s+/).map(function (b) {
      return parseInt(b, 16);
    }).filter(function (b) {
      return !isNaN(b);
    });
  }

  var bytes = [];
  var i = 0;
  while (i < s.length) {
    var ch = s.charAt(i);
    if (/\s|:|,/.test(ch)) {
      i++;
      continue;
    }
    var next = s.charAt(i + 1);
    var afterNext = s.charAt(i + 2);
    if (/[0-9A-Fa-f]/.test(ch) && /[0-9A-Fa-f]/.test(next) && (!afterNext || /\s|:|,/.test(afterNext))) {
      bytes.push(parseInt(s.substr(i, 2), 16));
      i += 2;
      continue;
    }
    bytes.push(s.charCodeAt(i) & 0xFF);
    i++;
  }
  return bytes;
}

function zbExtractEmbeddedFrames(text) {
  var bytes = zbHexWordsToBytes(text);
  var frames = [];
  for (var pos = 0; pos < bytes.length; ) {
    if (bytes[pos] !== 0x55) {
      pos++;
      continue;
    }
    if (pos + 1 >= bytes.length) break;
    var totalLen = 2 + bytes[pos + 1];
    if (totalLen < 6 || (pos + totalLen) > bytes.length) {
      pos++;
      continue;
    }
    frames.push(bytes.slice(pos, pos + totalLen).map(function (b) {
      return ('00' + b.toString(16).toUpperCase()).slice(-2);
    }).join(' '));
    pos += totalLen;
  }
  return frames;
}

function zbHandleEbyteFrame(hexStr) {
  var frame = zbParseEbyteFrame(hexStr);
  if (!frame) return false;
  /* 0x80/0x02 — Network Open */
  if (frame.type === 0x80 && frame.code === 0x02) {
    tatState.zb.networkUp = true;
    /* Extract channel and PAN from data */
    if (frame.data.length >= 10) {
      tatState.zb.channel = frame.data[0].toString(10);
      tatState.zb.panId   = '0x' + ('0000' + ((frame.data[2] | (frame.data[3] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
    }
    zbSetNetBadge('active');
    var info = document.getElementById('tat-zb-net-info');
    if (info) info.textContent = 'CH:' + tatState.zb.channel + ' PAN:' + tatState.zb.panId;
    tatLog('EVT', 'Network open CH:' + tatState.zb.channel + ' PAN:' + tatState.zb.panId);
    return true;
  }
  /* 0x80/0x03 — Node Join */
  if (frame.type === 0x80 && frame.code === 0x03) {
    if (frame.data.length >= 10) {
      var ieee  = zbBytesToIeee(frame.data.slice(0, 8));
      var short = ('0000' + ((frame.data[8] | (frame.data[9] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
      zbHandleNodeJoin(short, ieee);
    }
    return true;
  }
  /* 0x80/0x05 — Node Announce */
  if (frame.type === 0x80 && frame.code === 0x05) {
    if (frame.data.length >= 13) {
      var ieee2  = zbBytesToIeee(frame.data.slice(2, 10));
      var short2 = ('0000' + ((frame.data[10] | (frame.data[11] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
      var ep2    = ('00' + frame.data[12].toString(16).toUpperCase()).slice(-2);
      zbHandleNodeAnnounce(short2, ieee2, ep2);
    }
    return true;
  }
  /* 0x80/0x06 — Node Leave */
  if (frame.type === 0x80 && frame.code === 0x06) {
    if (frame.data.length >= 8) {
      zbHandleNodeLeave(zbBytesToIeee(frame.data.slice(0, 8)));
    }
    return true;
  }
  /* 0x82/0x0A — ZCL Attribute Report */
  if (frame.type === 0x82 && frame.code === 0x0A) {
    zbHandleZclAttrReport(frame.data);
    return true;
  }
  /* 0x82/0x00 — ZCL Read Attr Response */
  if (frame.type === 0x82 && frame.code === 0x00) {
    zbHandleZclReadAttrRsp(frame.data);
    return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════════════
   Zigbee — Async Line / Attribute Report Handler
   ═══════════════════════════════════════════════════════════════════ */
function zbHandleAsyncLine(line) {
  var frames = zbExtractEmbeddedFrames(line);
  if (frames.length) {
    tatState.zb.hexNative = true;
    for (var fi = 0; fi < frames.length; fi++) {
      zbHandleEbyteFrame(frames[fi]);
    }
    return;
  }
  /* Legacy RPT line: RPT:<short4>,<ep2>,<cluster4>,<attr4>,<type2>,<value> */
  var m = line.match(/RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]+)/i);
  if (m) {
    zbHandleAttrReport(m[1].toUpperCase(), m[3].toUpperCase(), m[4].toUpperCase(), parseInt(m[6], 16));
    return;
  }
}

function zbHandleAttrReport(short, cluster, attr, value) {
  if (!tatState.zb.sensorData[short]) tatState.zb.sensorData[short] = { temp: null, hum: null, count: 0, lastTs: 0, onOff: false, level: 0 };
  var sd = tatState.zb.sensorData[short];
  if (cluster === '0006' && attr === '0000') { sd.onOff = value !== 0; sd.on = sd.onOff; }
  else if (cluster === '0008' && attr === '0000') { sd.level = Math.round(value / 2.54); }
  else if (cluster === '0402' && attr === '0000') { sd.temp = value / 100.0; sd.count++; sd.lastTs = Date.now(); }
  else if (cluster === '0405' && attr === '0000') { sd.hum  = value / 100.0; sd.count++; sd.lastTs = Date.now(); }
  if (tatState.zb.selectedNode === short) {
    var n = tatState.zb.nodes[short];
    if (n) {
      if (n.type === 'led')    zbShowBulbPanel(n);
      if (n.type === 'sensor') zbUpdateSensorPanel(short);
    }
  }
  /* Broadcast to monitor */
  var node = tatState.zb.nodes[short];
  if (node) {
    var type = node.type === 'led' ? 'led' : 'sensor';
    var addr = '0x' + short + (node.type === 'led' ? ' / EP:' + ZB_BULB_EP : ' / EP:' + ZB_SENSOR_EP);
    tatBroadcastDeviceData('zb', type, short, node.name, addr, sd);
  }
}

function zbHandleZclAttrReport(data) {
  if (data.length < 12) return;
  var shortAddr = ('0000' + ((data[1] | (data[2] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
  var clusterId = ('0000' + ((data[6] | (data[7] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
  /* Attribute list starts at offset 11 */
  if (data.length > 13) {
    var attrId   = ('0000' + ((data[11] | (data[12] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
    var dataType = data[13];
    var value = 0;
    if (dataType === 0x10 || dataType === 0x20 || dataType === 0x30) {
      value = data[14] || 0;
    } else if (dataType === 0x21) {
      value = (data[15] << 8) | data[14];
    } else if (dataType === 0x29) {
      var v = (data[15] << 8) | data[14];
      value = v > 32767 ? v - 65536 : v;
    }
    zbHandleAttrReport(shortAddr, clusterId, attrId, value);
  }
}

function zbHandleZclReadAttrRsp(data) {
  if (data.length < 15) return;
  var shortAddr = ('0000' + ((data[1] | (data[2] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
  var clusterId = ('0000' + ((data[6] | (data[7] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
  if (data.length > 14) {
    var attrId   = ('0000' + ((data[11] | (data[12] << 8)) >>> 0).toString(16).toUpperCase()).slice(-4);
    var status   = data[13];
    var dataType = data[14];
    if (status !== 0) return;
    var value = 0;
    if (dataType === 0x10 || dataType === 0x20 || dataType === 0x30) {
      value = data[15] || 0;
    } else if (dataType === 0x21) {
      value = ((data[16] << 8) | data[15]) || 0;
    } else if (dataType === 0x29) {
      var v2 = ((data[16] << 8) | data[15]) || 0;
      value = v2 > 32767 ? v2 - 65536 : v2;
    } else if (dataType === 0x42) {
      /* String */
      var len = data[15] || 0;
      var str = '';
      for (var i = 0; i < len && (16 + i) < data.length; i++) {
        str += String.fromCharCode(data[16 + i]);
      }
      /* Check for auth key */
      zbHandleModelIdResponse(shortAddr, str);
      return;
    }
    if (clusterId === '0000' && attrId === '0005') {
      /* Model Identifier — already handled in String case above */
      return;
    }
    zbHandleAttrReport(shortAddr, clusterId, attrId, value);
  }
}

function zbParseEbyteFrame(hexStr) {
  var bytes = hexStr.trim().split(/\s+/).map(function(b) { return parseInt(b, 16); });
  if (bytes.length < 4 || bytes[0] !== 0x55) return null;
  var length  = bytes[1];
  var type    = bytes[2];
  var code    = bytes[3];
  var dataLen = length - 3;
  if (dataLen < 0) dataLen = 0;
  var data    = bytes.slice(4, 4 + dataLen);
  return { type: type, code: code, data: data };
}

function zbBytesToIeee(bytes) {
  var s = '';
  for (var i = 7; i >= 0; i--) {
    s += ('00' + bytes[i].toString(16).toUpperCase()).slice(-2);
    if (i > 0) s += ':';
  }
  return s;
}

/* ═══════════════════════════════════════════════════════════════════
   LoRa P2P — Commands
   ═══════════════════════════════════════════════════════════════════ */
function lrEnterTestMode() {
  lrEnqueue(function () {
    return sendCFLR('MODULE_ENTER_P2P_MODE', '', 10000)
      .then(function (resp) {
        if (/MODE.*TEST/i.test(resp || '')) {
          tatState.lr.testMode = true;
          lrSetPill('testmode', 'TEST Mode');
          tatToast('Entered P2P TEST mode');
        }
      });
  });
}

function lrApplyRf() {
  var freq  = (document.getElementById('tat-lr-freq')  || {}).value || '868';
  var sf    = (document.getElementById('tat-lr-sf')    || {}).value || 'SF7';
  var bw    = (document.getElementById('tat-lr-bw')    || {}).value || '125';
  var txpr  = (document.getElementById('tat-lr-txpr')  || {}).value || '12';
  var rxpr  = (document.getElementById('tat-lr-rxpr')  || {}).value || '15';
  var pow   = (document.getElementById('tat-lr-pow')   || {}).value || '14';
  var params = freq + ',' + sf + ',' + bw + ',' + txpr + ',' + rxpr + ',' + pow + ',ON,OFF,OFF';
  lrEnqueue(function () {
    var startPromise = Promise.resolve();
    if (!tatState.lr.testMode) {
      tatLog('i', 'Entering TEST mode before applying RF config');
      startPromise = sendCFLR('MODULE_ENTER_P2P_MODE', '', 10000);
    }
    return startPromise
      .then(function () {
        return sendCFLR('MODULE_SET_P2P_CONFIG', params, 10000);
      })
      .then(function (resp) {
        if (/RFCFG/i.test(resp || '')) {
          tatState.lr.rfConfigured = true;
          tatSet('tat-lr-rf-info', freq + 'MHz ' + sf + ' BW' + bw);
          tatToast('RF config applied');
        }
      });
  });
}

function lrStartRx() {
  lrEnqueue(function () {
    tatState.lr.rxActive = true;
    lrSetRxBadge(true);
    return sendCFLR('MODULE_ENTER_P2P_RX', '', 5000)
      .then(function () { tatLog('i', 'RX mode active'); })
      .catch(function () { tatState.lr.rxActive = false; lrSetRxBadge(false); });
  });
}

function lrStopRx() {
  lrEnqueue(function () {
    tatState.lr.rxActive = false;
    lrSetRxBadge(false);
    return sendCFLR('MODULE_GET_INFO', '', 5000);
  });
}

function lrReadInfo() {
  lrEnqueue(function () {
    return sendCFLR('MODULE_GET_INFO', '', 8000)
      .then(function (resp) {
        lrParseModuleInfo(resp || '');
      });
  });
}

function lrLedOn() {
  if (!tatState.lr.nodeJoined) { tatToast('Node not joined'); return; }
  lrSendLedCmd('10', 'LED ON');
}

function lrLedOff() {
  if (!tatState.lr.nodeJoined) { tatToast('Node not joined'); return; }
  lrSendLedCmd('11', 'LED OFF');
}

function lrSendLedCmd(hexCmd, label) {
  lrEnqueue(function () {
    tatState.lr.txPending = true;
    /* Step 1: exit RX mode */
    return sendCFLR('MODULE_GET_INFO', '', 5000)
      .then(function () {
        tatState.lr.rxActive = false;
        lrSetRxBadge(false);
        /* Step 2: send LED command */
        return sendCFLR('MODULE_SEND_P2P_PKT', '"' + hexCmd + '"', 8000)
          .then(function () {
            tatState.lr.lastCmd = hexCmd === '10' ? 'LED ON' : 'LED OFF';
            tatState.lr.ledState = hexCmd === '10' ? 'ON' : 'OFF';
            tatState.lr.lastTx = tatFmtTime(new Date());
            tatSet('tat-lr-last-tx', label + ' @ ' + tatState.lr.lastTx);
            tatToast('Sent: ' + label);
            lrBroadcastNodeSnapshot();
            /* Step 3: re-enter RX */
            return sendCFLR('MODULE_ENTER_P2P_RX', '', 5000)
              .then(function (resp) {
                tatState.lr.rxActive = true;
                lrSetRxBadge(true);
                return resp;
              });
          });
      })
      .then(function (resp) {
        tatState.lr.txPending = false;
        return resp;
      }, function (err) {
        tatState.lr.txPending = false;
        throw err;
      });
  });
}

function lrSendJoinAccept(nodeId) {
  var nodeIdHex = ('00' + nodeId.toString(16).toUpperCase()).slice(-2);
  lrEnqueue(function () {
    return sendCFLR('MODULE_GET_INFO', '', 5000)
      .then(function () {
        tatState.lr.rxActive = false;
        lrSetRxBadge(false);
        return sendCFLR('MODULE_SEND_P2P_PKT', '"FE' + nodeIdHex + '"', 8000)
          .then(function () {
            tatState.lr.lastCmd = 'JOIN_ACCEPT';
            tatLog('i', 'JOIN_ACCEPT sent → nodeId=0x' + nodeIdHex);
            lrBroadcastNodeSnapshot();
            return sendCFLR('MODULE_ENTER_P2P_RX', '', 5000)
              .then(function (resp) {
                tatState.lr.rxActive = true;
                lrSetRxBadge(true);
                return resp;
              });
          });
      });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   LoRa P2P — Async Line Handler
   ═══════════════════════════════════════════════════════════════════ */
function lrHandleAsyncLine(line) {
  var l = line;
  var ci = l.indexOf('CFLR:');
  if (ci > 0) l = l.substring(ci);

  /* +TEST: RFCFG */
  var m = l.match(/\+TEST:\s*RFCFG\s+(.+)/i);
  if (m) {
    tatSet('tat-lr-rf-info', m[1].trim().substring(0, 40));
    return;
  }

  /* +MODE: TEST */
  if (/\+MODE:\s*TEST/i.test(l)) {
    tatState.lr.testMode = true;
    lrSetPill('testmode', 'TEST Mode');
    tatSet('tat-lr-mode', 'P2P TEST');
    return;
  }

  /* Firmware / version info */
  m = l.match(/\+VER:\s*(.+)/i);
  if (m) { tatSet('tat-lr-fw', m[1].trim()); return; }

  /* +TEST: RXLRPKT <len>, <rssi>, <snr>, "<hex>" */
  m = l.match(/\+TEST:\s*RXLRPKT\s+(\d+),\s*(-?\d+),\s*(-?\d+),\s*"([0-9A-Fa-f]*)"/i);
  if (m) {
    var len  = parseInt(m[1], 10);
    var rssi = m[2];
    var snr  = m[3];
    var hex  = m[4].toUpperCase();
    tatState.lr.lastRx = tatFmtTime(new Date());
    tatState.lr.rssi   = rssi + ' dBm';
    tatState.lr.snr    = snr + ' dB';
    tatSet('tat-lr-last-rx', tatState.lr.lastRx);
    tatSet('tat-lr-rssi', tatState.lr.rssi);
    tatSet('tat-lr-snr',  tatState.lr.snr);
    lrHandleP2PPacket(hex, rssi, snr);
    return;
  }

  /* +TEST: TXLRPKT */
  if (/\+TEST:\s*TXLRPKT/i.test(l)) {
    tatLog('EVT', '+TEST: TXLRPKT — TX done');
    return;
  }
}

function lrHandleP2PPacket(hex, rssi, snr) {
  if (!hex || hex.length < 2) return;
  var b0 = parseInt(hex.substr(0, 2), 16);

  if (b0 === 0xFF) {
    /* JOIN_REQUEST: [0xFF, nodeId, seq] */
    var nodeId = hex.length >= 4 ? parseInt(hex.substr(2, 2), 16) : 1;
    tatState.lr.nodeId     = nodeId;
    tatState.lr.nodeJoined = true;
    tatState.lr.lastJoin   = tatFmtTime(new Date());
    if (tatState.lr.ledState === '—') tatState.lr.ledState = 'OFF';
    lrSetPill('joined', 'Joined');
    tatSet('tat-lr-node-id', '0x' + ('00' + nodeId.toString(16).toUpperCase()).slice(-2));
    tatSet('tat-lr-node-status', 'Joined');
    tatSet('tat-lr-last-join', tatState.lr.lastJoin);
    var btnOn  = document.getElementById('tat-btn-led-on');
    var btnOff = document.getElementById('tat-btn-led-off');
    if (btnOn)  btnOn.disabled  = false;
    if (btnOff) btnOff.disabled = false;
    tatLog('EVT', 'JOIN_REQUEST from nodeId=0x' + nodeId.toString(16).toUpperCase() + ' RSSI=' + rssi);
    tatToast('Node joined: 0x' + nodeId.toString(16).toUpperCase());
    lrBroadcastNodeSnapshot();
    /* Send JOIN_ACCEPT */
    lrSendJoinAccept(nodeId);
    return;
  }

  if (b0 === 0x01 && hex.length >= 14) {
    /* SENSOR_DATA: [0x01, nodeId, seq, tHi, tLo, hHi, hLo, led?] */
    var nodeId2 = parseInt(hex.substr(2, 2), 16);
    var seq     = parseInt(hex.substr(4, 2), 16);
    var tHi     = parseInt(hex.substr(6, 2), 16);
    var tLo     = parseInt(hex.substr(8, 2), 16);
    var hHi     = parseInt(hex.substr(10, 2), 16);
    var hLo     = parseInt(hex.substr(12, 2), 16);
    var tempRaw = (tHi << 8) | tLo;
    var humRaw  = (hHi << 8) | hLo;
    var temp    = (tempRaw / 100.0).toFixed(1);
    var hum     = (humRaw / 100.0).toFixed(1);
    tatState.lr.temp    = temp;
    tatState.lr.hum     = hum;
    tatState.lr.nodeSeq = seq;
    tatState.lr.lastUp  = tatFmtTime(new Date());
    if (hex.length >= 16) {
      tatState.lr.ledState = parseInt(hex.substr(14, 2), 16) ? 'ON' : 'OFF';
    }
    tatSet('tat-lr-temp',    temp + ' °C');
    tatSet('tat-lr-hum',     hum + ' %');
    tatSet('tat-lr-seq',     String(seq));
    tatSet('tat-lr-last-up', tatState.lr.lastUp);
    lrSetPill('active', 'Active');
    tatLog('EVT', 'SENSOR_DATA nodeId=0x' + nodeId2.toString(16).toUpperCase() + ' seq=' + seq + ' T=' + temp + '°C H=' + hum + '%');
    lrBroadcastNodeSnapshot();
    return;
  }
}

function lrParseModuleInfo(resp) {
  var mVer = resp.match(/\+VER:\s*(.+)/i);
  if (mVer) tatSet('tat-lr-fw', mVer[1].trim());
  var mMode = resp.match(/\+MODE:\s*(.+)/i);
  if (mMode) tatSet('tat-lr-mode', mMode[1].trim());
  var mRf = resp.match(/\+TEST:\s*RFCFG\s+(.+)/i);
  if (mRf) tatSet('tat-lr-rf-info', mRf[1].trim().substring(0, 40));
}

function lrSetPill(state, text) {
  var el = document.getElementById('tat-lr-pill');
  var txt = document.getElementById('tat-lr-pill-txt');
  if (el) el.setAttribute('data-state', state);
  if (txt) txt.textContent = text;
}

function lrSetRxBadge(active) {
  var el = document.getElementById('tat-lr-rx-badge');
  if (el) el.setAttribute('data-active', active ? 'true' : 'false');
}

function lrBroadcastNodeSnapshot() {
  if (tatState.lr.nodeId === null) return;
  var nodeHex = ('00' + tatState.lr.nodeId.toString(16).toUpperCase()).slice(-2);
  tatBroadcastDeviceData('lora', 'lora_node', nodeHex, 'LoRa Node 0x' + nodeHex, '', {
    temp: tatState.lr.temp,
    hum: tatState.lr.hum,
    seq: tatState.lr.nodeSeq,
    rssi: tatState.lr.rssi,
    snr: tatState.lr.snr,
    ledState: tatState.lr.ledState || '—',
    lastCmd: tatState.lr.lastCmd || '—',
    lastJoin: tatState.lr.lastJoin || '—'
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Cross-widget broadcast
   ═══════════════════════════════════════════════════════════════════ */
function tatBroadcastDeviceData(proto, type, id, name, addr, data) {
  try {
    window.dispatchEvent(new CustomEvent('da2_tat_event', {
      detail: { proto: proto, type: type, id: id, name: name, addr: addr, slot: tatState.slot, data: data }
    }));
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   UI Helpers
   ═══════════════════════════════════════════════════════════════════ */
function tatSet(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function tatSetPill(state, text) {
  var el = document.getElementById('tat-pill');
  var txt = document.getElementById('tat-pill-txt');
  if (el) el.setAttribute('data-state', state);
  if (txt) txt.textContent = text;
}

function tatFmtTime(d) {
  return ('0' + d.getHours()).slice(-2) + ':' +
         ('0' + d.getMinutes()).slice(-2) + ':' +
         ('0' + d.getSeconds()).slice(-2);
}

function tatEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* Console */
var TAT_LOG_MAX = 200;
var _tatLogLines = 0;

function tatLog(prefix, msg) {
  console.log('[TAT ' + prefix + '] ' + msg);
  var el = document.getElementById('tat-console');
  if (!el) return;
  if (_tatLogLines > TAT_LOG_MAX) {
    el.innerHTML = '';
    _tatLogLines = 0;
  }
  var cls = { 'TX':'log-tx','RX':'log-rx','EVT':'log-evt','i':'log-info','!':'log-warn','✕':'log-fail' }[prefix] || 'log-info';
  var now = tatFmtTime(new Date());
  var div = document.createElement('div');
  div.className = 'tat-log-line ' + cls;
  div.textContent = '[' + now + '] ' + prefix + '  ' + msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  _tatLogLines++;
}

function tatClearLog() {
  var el = document.getElementById('tat-console');
  if (el) { el.innerHTML = ''; _tatLogLines = 0; }
}

/* Toast */
var _tatToastTimer = null;
function tatToast(msg) {
  var el = document.getElementById('tat-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  if (_tatToastTimer) clearTimeout(_tatToastTimer);
  _tatToastTimer = setTimeout(function () {
    if (el) el.style.display = 'none';
    _tatToastTimer = null;
  }, 2800);
}

window.tatSetSlot = tatSetSlot;
window.bleConnect = bleConnect;
window.bleSelectDevice = bleSelectDevice;
window.zbSelectNode = zbSelectNode;
