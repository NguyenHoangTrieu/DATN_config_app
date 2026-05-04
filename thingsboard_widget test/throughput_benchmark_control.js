var TBC_LORA_RF_DEFAULT = '868,SF7,125,12,12,14,ON,OFF,OFF';
var TBC_LORA_RF_LEGACY = '920,SF7,125,8,15,14,ON,OFF,OFF';
var TBC_LORA_RF_PREV_DEFAULT = '868,SF7,125,12,15,14,ON,OFF,OFF';

var tbcState = {
  durationSec: 15,
  payloadBytes: { ble: 244, zb: 99, lora: 50 },
  ble: {
    scanResults: [],
    devIdx: null,
    connected: false,
    mac: '',
    name: '',
    handles: { bb11: null, bb12: null, bb13: null, bb14: null, cccd12: null }
  },
  zb: { slot: '0' },
  lora: { slot: '1', rfConfig: TBC_LORA_RF_DEFAULT, ready: false },
  loraRxRestartInFlight: false,
  loraAutoRearm: true,
  activeCase: null,
  teleSub: null,
  blePendingRpc: null,
  seen: {},
  seenOrder: []
};

var TBC_SEEN_MAX = 300;

self.onInit = function () {
  try {
    tbcBind();
    tbcRestore();
    tbcApplyUi();
    tbcSubscribeTelemetry();
    tbcPublishConfig();
    tbcSetPill('idle', 'Idle');
    tbcLog('Widget ready');
  } catch (e) {
    tbcLog('Init error: ' + (e && e.message ? e.message : e));
  }
};

self.onDestroy = function () {
  try {
    if (tbcState.teleSub && self.ctx && self.ctx.telemetryWsService) {
      self.ctx.telemetryWsService.unsubscribe(tbcState.teleSub);
    }
  } catch (e) {}
};

self.onDataUpdated = function () {
  try {
    if (tbcState.teleSub) return;
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var i = 0; i < data.length; i++) {
      var kd = data[i];
      if (!kd || !kd.data) continue;
      for (var j = 0; j < kd.data.length; j++) {
        tbcIngestEntry(kd.data[j][0], kd.data[j][1]);
      }
    }
  } catch (e) {}
};

function tbcBind() {
  tbcOn('tbc-save-cfg', 'click', tbcPublishConfig);
  tbcOn('tbc-ble-scan', 'click', tbcBleScan);
  tbcOn('tbc-ble-connect', 'click', tbcBleConnectSelected);
  tbcOn('tbc-ble-start', 'click', tbcBleStartFlood);
  tbcOn('tbc-ble-stop', 'click', tbcBleStopFlood);
  tbcOn('tbc-zb-start', 'click', tbcZbStartNetwork);
  tbcOn('tbc-zb-join', 'click', tbcZbPermitJoin);
  tbcOn('tbc-lora-prepare', 'click', tbcLoraPrepare);
  tbcOn('tbc-lora-rx', 'click', tbcLoraRestartRx);
  tbcOn('tbc-stop-case', 'click', tbcStopCase);

  var caseButtons = document.querySelectorAll('.tbc-case[data-case]');
  for (var i = 0; i < caseButtons.length; i++) {
    caseButtons[i].addEventListener('click', function (evt) {
      var caseId = evt.target.getAttribute('data-case');
      tbcRunCase(caseId);
    });
  }
}

function tbcOn(id, evt, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener(evt, fn);
}

function tbcRestore() {
  try {
    var raw = localStorage.getItem('da2_bw_cfg');
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (saved.durationSec) tbcState.durationSec = saved.durationSec;
    if (saved.payloadBytes) tbcState.payloadBytes = saved.payloadBytes;
    if (saved.zbSlot !== undefined) tbcState.zb.slot = String(saved.zbSlot);
    if (saved.loraSlot !== undefined) tbcState.lora.slot = String(saved.loraSlot);
    if (saved.rfConfig) {
      var rf = String(saved.rfConfig).trim();
      tbcState.lora.rfConfig = (rf === TBC_LORA_RF_LEGACY || rf === TBC_LORA_RF_PREV_DEFAULT)
        ? TBC_LORA_RF_DEFAULT
        : rf;
    }
  } catch (e) {}
}

function tbcApplyUi() {
  tbcSetVal('tbc-duration', tbcState.durationSec);
  tbcSetVal('tbc-ble-payload', tbcState.payloadBytes.ble);
  tbcSetVal('tbc-zb-payload', tbcState.payloadBytes.zb);
  tbcSetVal('tbc-lora-payload', tbcState.payloadBytes.lora);
  tbcSetVal('tbc-zb-slot', tbcState.zb.slot);
  tbcSetVal('tbc-lora-slot', tbcState.lora.slot);
  tbcSetVal('tbc-lora-rf', tbcState.lora.rfConfig);
}

function tbcReadUi() {
  tbcState.durationSec = Math.max(5, parseInt(tbcGetVal('tbc-duration'), 10) || 15);
  tbcState.payloadBytes.ble = Math.max(20, parseInt(tbcGetVal('tbc-ble-payload'), 10) || 244);
  tbcState.payloadBytes.zb = Math.max(10, parseInt(tbcGetVal('tbc-zb-payload'), 10) || 99);
  tbcState.payloadBytes.lora = Math.max(5, parseInt(tbcGetVal('tbc-lora-payload'), 10) || 50);
  tbcState.zb.slot = String(tbcGetVal('tbc-zb-slot') || '0');
  tbcState.lora.slot = String(tbcGetVal('tbc-lora-slot') || '1');
  tbcState.lora.rfConfig = String(tbcGetVal('tbc-lora-rf') || '').trim();
}

function tbcPublishConfig() {
  tbcReadUi();
  var cfg = {
    durationSec: tbcState.durationSec,
    payloadBytes: tbcState.payloadBytes,
    expected: {
      zigbee: { min: 70, max: 80, label: '70 - 80 kbps' },
      ble: { min: 90, max: 97, label: '90 - 97 kbps' },
      lora: { min: 3.0, max: 3.8, label: '~3.5 kbps' },
      concurrency: { min: 127, max: 154, label: '127 - 154 kbps' }
    }
  };
  try {
    localStorage.setItem('da2_bw_cfg', JSON.stringify({
      durationSec: cfg.durationSec,
      payloadBytes: cfg.payloadBytes,
      zbSlot: tbcState.zb.slot,
      loraSlot: tbcState.lora.slot,
      rfConfig: tbcState.lora.rfConfig
    }));
  } catch (e) {}
  tbcBroadcast('config', cfg);
  tbcLog('Config published');
}

function tbcSubscribeTelemetry() {
  try {
    var sc = self.ctx && self.ctx.stateController;
    var params = sc && sc.getStateParams && sc.getStateParams();
    var entityId = params && params.entityId;
    if (!entityId && self.ctx.defaultSubscription && self.ctx.defaultSubscription.targetEntityId) {
      entityId = {
        entityType: self.ctx.defaultSubscription.targetEntityType || 'DEVICE',
        id: self.ctx.defaultSubscription.targetEntityId
      };
    }
    if (!entityId || !entityId.id || !self.ctx.telemetryWsService) return;

    tbcState.teleSub = self.ctx.telemetryWsService.subscribe({
      entityType: entityId.entityType,
      entityId: entityId.id,
      keys: ['data'],
      onData: function (data) {
        try {
          var arr = data && data.data;
          if (!arr) return;
          for (var i = 0; i < arr.length; i++) {
            var decoded = tbcDecode(arr[i][1]);
            if (decoded &&
                !/BENCH:/i.test(decoded) &&
                !/CFBG:OK:NOTIFY:/i.test(decoded)) {
              tbcLog('TELE: ' + tbcShort(decoded));
            }
            tbcIngestEntry(arr[i][0], arr[i][1]);
          }
        } catch (e) {}
      }
    });
    tbcLog('Telemetry subscribed');
  } catch (e) {
    tbcLog('Telemetry subscription unavailable');
  }
}

function tbcIngestEntry(ts, raw) {
  var decoded = tbcDecode(raw);
  if (!decoded) return;
  var key = String(ts) + '|' + decoded;
  if (tbcState.seen[key]) return;
  tbcState.seen[key] = 1;
  tbcState.seenOrder.push(key);
  if (tbcState.seenOrder.length > TBC_SEEN_MAX) {
    delete tbcState.seen[tbcState.seenOrder.shift()];
  }
  var lines = tbcSplit(decoded);
  for (var i = 0; i < lines.length; i++) tbcHandleLine(lines[i]);
}

function tbcNormalizeBleLine(line) {
  var l = String(line || '').trim();
  var ci = l.indexOf('CFBG:');
  if (ci > 0) l = l.substring(ci);
  if (/^CFBG:OK:/i.test(l)) l = l.substring(8);
  else if (/^CFBG:[0-9]+:EVT:/i.test(l)) l = l.replace(/^CFBG:[0-9]+:EVT:/i, '');
  return l;
}

function tbcBleRpcMatchState(verb, line) {
  if (!line) return 'ignore';
  if (/^(ERR|FAIL)[:]/i.test(line) || /^CFBG:FAIL:/i.test(line)) return 'error';
  switch (String(verb || '').toUpperCase()) {
    case 'SCAN':
      if (/^SCAN_RESULT:/i.test(line)) return 'collect';
      if (/^SCAN_DONE:/i.test(line)) return 'finish';
      return 'ignore';
    case 'CONNECT':
      return /^CONNECTED:/i.test(line) ? 'finish' : 'ignore';
    case 'DISC':
      if (/^CHAR:/i.test(line) || /^SERVICE:/i.test(line)) return 'collect';
      if (/^DISC_DONE:/i.test(line)) return 'finish';
      return 'ignore';
    case 'NOTIFY':
      return /^DESCR_WRITE_OK:/i.test(line) ? 'finish' : 'ignore';
    case 'WRITE':
      return /^WRITE_OK:/i.test(line) ? 'finish' : 'ignore';
    case 'WRITENR':
      return /^WRITE_NR_OK:/i.test(line) ? 'finish' : 'ignore';
    default:
      return 'ignore';
  }
}

function tbcBleFinishPendingRpc(pending, err) {
  if (!pending || tbcState.blePendingRpc !== pending) return;
  tbcState.blePendingRpc = null;
  if (pending.timer) clearTimeout(pending.timer);
  if (err) pending.reject(err);
  else pending.resolve(pending.lines.join('\n'));
}

function tbcBleStartPendingRpc(verb, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (tbcState.blePendingRpc) {
      reject(new Error('BLE command overlap: ' + tbcState.blePendingRpc.verb));
      return;
    }
    var pending = {
      verb: String(verb || '').toUpperCase(),
      lines: [],
      resolve: resolve,
      reject: reject,
      timer: setTimeout(function () {
        tbcBleFinishPendingRpc(pending, new Error('BLE ' + pending.verb + ' timeout'));
      }, timeoutMs || 15000)
    };
    tbcState.blePendingRpc = pending;
  });
}

function tbcBleObservePendingRpc(line) {
  var pending = tbcState.blePendingRpc;
  if (!pending) return;
  var state = tbcBleRpcMatchState(pending.verb, line);
  if (state === 'ignore') return;
  pending.lines.push(line);
  if (state === 'error') {
    tbcBleFinishPendingRpc(pending, new Error(line));
    return;
  }
  if (state === 'finish') {
    tbcBleFinishPendingRpc(pending, null);
  }
}

function tbcHandleLine(line) {
  var bleLine = tbcNormalizeBleLine(line);
  tbcBleObservePendingRpc(bleLine);

  /* Bridge control/management lines to a dedicated bypass monitor widget */
  if (/^SCAN_RESULT:|^SCAN_DONE:|^CONNECTED:|^CHAR:|^SERVICE:|^DISC_DONE:|^DESCR_WRITE_OK:|^WRITE_OK:|^WRITE_NR_OK:/i.test(bleLine) ||
      /CFZB:\d+:EVT:/i.test(line) ||
      /\+TEST:\s*(RXLRPKT|RFCFG)|\+MODE:\s*TEST/i.test(line)) {
    tbcBroadcast('bypass-line', { line: line });
  }

  /* ── Bridge data-telemetry lines to monitor ──────────── */
  if (/BENCH:/i.test(line) || /CFBG:OK:NOTIFY:/i.test(line) || /^RPT:[0-9A-Fa-f]/i.test(line)) {
    try {
      window.dispatchEvent(new CustomEvent('da2_bw_bench', { detail: { type: 'tbcRawLine', line: line } }));
    } catch(e) {}
    return;
  }

  var m;
  m = bleLine.match(/^SCAN_RESULT:(\d+),([0-9A-Fa-f:]{17}),(-?\d+),(.*)/i);
  if (m) {
    tbcBleUpsertDevice(m[1], m[2], m[3], m[4]);
    return;
  }
  m = bleLine.match(/^SCAN_DONE:(\d+)/i);
  if (m) {
    var n = parseInt(m[1], 10);
    tbcLog('Scan done: ' + n + ' device(s) found');
    tbcSetText('tbc-ble-status', n > 0 ? 'Scan done: ' + n + ' device(s)' : 'Scan done — no devices nearby');
    return;
  }
  m = bleLine.match(/^CONNECTED:(\d+):0x[0-9A-Fa-f]+:([0-9A-Fa-f:]{17})/i);
  if (m) {
    tbcState.ble.devIdx = parseInt(m[1], 10);
    tbcState.ble.connected = true;
    tbcSetText('tbc-ble-status', 'Connected idx=' + tbcState.ble.devIdx);
    return;
  }

  m = bleLine.match(/^CHAR:(\d+):0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{4})/i);
  if (m) {
    var uuid16 = m[2].toUpperCase();
    var handle = parseInt(m[3], 16);
    if (uuid16 === 'BB11') tbcState.ble.handles.bb11 = handle;
    if (uuid16 === 'BB12') {
      tbcState.ble.handles.bb12 = handle;
      tbcState.ble.handles.cccd12 = handle + 1;
    }
    if (uuid16 === 'BB13') tbcState.ble.handles.bb13 = handle;
    if (uuid16 === 'BB14') tbcState.ble.handles.bb14 = handle;
    return;
  }

  if (/CFZB:\d+:EVT:/i.test(line)) {
    tbcSetText('tbc-zb-status', 'Receiving Zigbee events');
    return;
  }

  var isLoraRxData = /\+TEST:\s*RX\s*"[0-9A-Fa-f]+"/i.test(line);
  if (isLoraRxData || /\+TEST:\s*RXLRPKT/i.test(line) || /\+TEST:\s*RFCFG/i.test(line) || /\+MODE:\s*TEST/i.test(line)) {
    tbcState.lora.ready = true;
    tbcSetText('tbc-lora-status', 'RX ready / TEST mode');
    if (isLoraRxData && tbcState.loraAutoRearm && !tbcState.loraRxRestartInFlight) {
      tbcState.loraRxRestartInFlight = true;
      setTimeout(function () {
        tbcLoraRestartRx()
          .catch(function () {})
          .finally(function () { tbcState.loraRxRestartInFlight = false; });
      }, 5);
    }
  }
}

function tbcBleUpsertDevice(idx, mac, rssi, name) {
  var list = tbcState.ble.scanResults;
  var found = false;
  for (var i = 0; i < list.length; i++) {
    if (list[i].mac === mac) {
      list[i] = { idx: idx, mac: mac, rssi: rssi, name: name };
      found = true;
      break;
    }
  }
  if (!found) list.push({ idx: idx, mac: mac, rssi: rssi, name: name });
  var sel = document.getElementById('tbc-ble-device');
  if (!sel) return;
  var html = '<option value="">Select device</option>';
  for (var j = 0; j < list.length; j++) {
    html += '<option value="' + tbcEsc(list[j].mac) + '">' +
      tbcEsc(list[j].name) + ' (' + tbcEsc(list[j].mac) + ', ' + tbcEsc(String(list[j].rssi)) + ' dBm)</option>';
  }
  sel.innerHTML = html;
}

function tbcBleScan() {
  tbcState.ble.scanResults = [];
  tbcSetText('tbc-ble-status', 'Scanning 5 s...');
  var scanMs = 5000;
  try { scanMs = Math.max(1000, parseInt(tbcGetVal('tbc-duration'), 10) * 200) || 5000; } catch (e) {}
  scanMs = 5000; /* always honour the SCAN:5000 command */

  tbcRpc('CFML:CFBG:0:SCAN:5000', scanMs + 18000)
    .then(function () {
      var n = tbcState.ble.scanResults.length;
      tbcSetText('tbc-ble-status',
        n > 0 ? 'Scan done: ' + n + ' device(s)' : 'Scan done — no devices nearby');
    })
    .catch(function (e) {
      tbcLog('Scan RPC: ' + (e && e.message ? e.message : 'timeout'));
      tbcSetText('tbc-ble-status', 'Scan failed / timeout');
    });
}

function tbcBleConnectSelected() {
  var mac = tbcGetVal('tbc-ble-device');
  if (!mac) {
    tbcLog('Select a BLE device first');
    return;
  }
  tbcState.ble.mac = mac;
  tbcSetText('tbc-ble-status', 'Connecting ' + mac + '...');
  tbcRpc('CFML:CFBG:0:CONNECT:' + mac, 15000)
    .then(function (resp) {
      var lines = tbcSplit(resp);
      for (var i = 0; i < lines.length; i++) tbcHandleLine(lines[i]);
      if (tbcState.ble.devIdx === null) throw new Error('CONNECT reply missing');
      return tbcRpc('CFML:CFBG:0:DISC:' + tbcState.ble.devIdx, 15000);
    })
    .then(function (resp) {
      var lines = tbcSplit(resp);
      for (var i = 0; i < lines.length; i++) tbcHandleLine(lines[i]);
      if (!tbcState.ble.handles.cccd12) throw new Error('BB12 notify handle not found');
      return tbcRpc('CFML:CFBG:0:NOTIFY:' + tbcState.ble.devIdx + ':0x' + tbcHex4(tbcState.ble.handles.cccd12) + ':1', 10000);
    })
    .then(function () {
      tbcState.ble.connected = true;
      tbcSetText('tbc-ble-status', 'Connected and notify enabled');
      tbcLog('BLE ready for bandwidth test');
    })
    .catch(function (e) {
      tbcSetText('tbc-ble-status', 'BLE connect failed');
      tbcLog('BLE connect failed: ' + (e && e.message ? e.message : e));
    });
}

function tbcBleStartFlood() {
  if (!tbcState.ble.connected || tbcState.ble.devIdx === null || !tbcState.ble.handles.bb13) {
    tbcLog('BLE not ready - connect and discover first');
    return Promise.reject(new Error('BLE not ready'));
  }
  return tbcRpc('CFML:CFBG:0:WRITE:' + tbcState.ble.devIdx + ':0x' + tbcHex4(tbcState.ble.handles.bb13) + ':01', 10000)
    .then(function () {
      tbcSetText('tbc-ble-status', 'BLE flood active');
      tbcLog('BLE flood started');
    });
}

function tbcBleStopFlood() {
  if (!tbcState.ble.connected || tbcState.ble.devIdx === null || !tbcState.ble.handles.bb13) return Promise.resolve();
  return tbcRpc('CFML:CFBG:0:WRITE:' + tbcState.ble.devIdx + ':0x' + tbcHex4(tbcState.ble.handles.bb13) + ':00', 10000)
    .then(function () {
      tbcSetText('tbc-ble-status', 'BLE flood stopped');
      tbcLog('BLE flood stopped');
    })
    .catch(function () {});
}

function tbcZbStartNetwork() {
  tbcReadUi();
  tbcRpc('CFML:CFZB:' + tbcState.zb.slot + ':MODULE_START_NETWORK', 15000)
    .then(function () { tbcSetText('tbc-zb-status', 'Network started'); tbcLog('Zigbee network started'); })
    .catch(function (e) { tbcLog('Zigbee start failed: ' + (e && e.message ? e.message : e)); });
}

function tbcZbPermitJoin() {
  tbcReadUi();
  tbcRpc('CFML:CFZB:' + tbcState.zb.slot + ':MODULE_SET_PERMIT_JOIN:180', 15000)
    .then(function () { tbcSetText('tbc-zb-status', 'Permit join open for 180 s'); tbcLog('Permit join sent'); })
    .catch(function (e) { tbcLog('Permit join failed: ' + (e && e.message ? e.message : e)); });
}

function tbcLoraPrepare() {
  tbcReadUi();
  tbcSetText('tbc-lora-status', 'Preparing TEST mode...');
  var preferred = String(tbcState.lora.slot || '1');
  var fallback = preferred === '1' ? '0' : '1';

  function doPrepare(slot) {
    return tbcRpc('CFML:CFLR:' + slot + ':MODULE_ENTER_P2P_MODE', 15000)
      .then(function () {
        return tbcRpc('CFML:CFLR:' + slot + ':MODULE_SET_P2P_CONFIG:' + tbcState.lora.rfConfig, 12000);
      })
      .then(function () {
        return tbcRpc('CFML:CFLR:' + slot + ':MODULE_ENTER_P2P_RX', 8000)
          .catch(function () {
            // Some module profiles keep RX active but don't emit immediate ACK for RXLRPKT.
            return '';
          });
      })
      .then(function () {
        tbcState.lora.slot = slot;
        tbcSetVal('tbc-lora-slot', slot);
        tbcState.lora.ready = true;
        tbcSetText('tbc-lora-status', 'LoRa RX armed (slot ' + slot + ')');
        tbcLog('LoRa TEST/RX ready on slot ' + slot);
      });
  }

  return doPrepare(preferred).catch(function (e1) {
    tbcLog('LoRa prepare failed on slot ' + preferred + ', retry slot ' + fallback);
    return doPrepare(fallback).catch(function (e2) {
      tbcSetText('tbc-lora-status', 'LoRa prepare failed');
      tbcLog('LoRa prepare failed: ' + (e2 && e2.message ? e2.message : e2));
      throw (e2 || e1);
    });
  });
}

function tbcLoraRestartRx() {
  tbcReadUi();
  var preferred = String(tbcState.lora.slot || '1');
  var fallback = preferred === '1' ? '0' : '1';
  return tbcRpc('CFML:CFLR:' + preferred + ':MODULE_ENTER_P2P_RX', 8000)
    .then(function () {
      tbcState.lora.slot = preferred;
      tbcSetVal('tbc-lora-slot', preferred);
      tbcState.lora.ready = true;
      tbcSetText('tbc-lora-status', 'RX restarted (slot ' + preferred + ')');
    })
    .catch(function () {
      return tbcRpc('CFML:CFLR:' + fallback + ':MODULE_ENTER_P2P_RX', 8000)
        .then(function () {
          tbcState.lora.slot = fallback;
          tbcSetVal('tbc-lora-slot', fallback);
          tbcState.lora.ready = true;
          tbcSetText('tbc-lora-status', 'RX restarted (slot ' + fallback + ')');
          tbcLog('Switched LoRa slot to ' + fallback + ' after RX restart failure on ' + preferred);
        });
    });
}

function tbcRunCase(caseId) {
  tbcPublishConfig();
  tbcStopCase();
  var titleMap = {
    zigbee: 'Zigbee Spam',
    ble: 'BLE DLE',
    lora: 'LoRa SF7',
    concurrency: 'Concurrency'
  };
  var protocols = {
    zigbee: { ble: false, zb: true, lora: false },
    ble: { ble: true, zb: false, lora: false },
    lora: { ble: false, zb: false, lora: true },
    concurrency: { ble: true, zb: true, lora: true }
  }[caseId];
  if (!protocols) return;

  var start = Promise.resolve();
  if (protocols.ble) start = start.then(function () { return tbcBleStartFlood(); });
  if (protocols.lora) start = start.then(function () { return tbcLoraPrepare(); });

  start.then(function () {
    tbcState.activeCase = caseId;
    tbcSetPill('running', 'Running');
    tbcSetText('tbc-case-status', 'Running: ' + titleMap[caseId] + ' for ' + tbcState.durationSec + ' s');
    tbcBroadcast('case-start', {
      id: caseId,
      title: titleMap[caseId],
      durationSec: tbcState.durationSec,
      protocols: protocols
    });
    tbcLog('Case start: ' + titleMap[caseId]);
  }).catch(function (e) {
    tbcLog('Cannot start case ' + caseId + ': ' + (e && e.message ? e.message : e));
  });
}

function tbcStopCase() {
  if (!tbcState.activeCase) return;
  tbcBleStopFlood();
  tbcBroadcast('case-stop', { id: tbcState.activeCase });
  tbcSetText('tbc-case-status', 'Stopped: ' + tbcState.activeCase);
  tbcSetPill('active', 'Prepared');
  tbcLog('Case stop: ' + tbcState.activeCase);
  tbcState.activeCase = null;
}

function tbcRpcIsDataNoise(decoded, cmd) {
  decoded = String(decoded || '');
  cmd = String(cmd || '');
  if (/^CFML:CFLR:\d+:MODULE_ENTER_P2P_RX/i.test(cmd) && /\+TEST:\s*RXLRPKT/i.test(decoded)) {
    return false;
  }
  return /BENCH:/i.test(decoded) ||
    /CFBG:OK:NOTIFY:/i.test(decoded) ||
    /(^|\x1E)RPT:[0-9A-Fa-f]/i.test(decoded) ||
    /\+TEST:\s*RXLRPKT/i.test(decoded);
}

function tbcRpc(cmd, timeoutMs) {
  tbcLog('TX ' + cmd);
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi - assign target device'));
      return;
    }
    var bleVerbMatch = cmd.match(/^CFML:CFBG:\d+:([A-Z_]+)/i);
    var bleVerb = bleVerbMatch ? bleVerbMatch[1].toUpperCase() : '';
    var blePending = bleVerb ? tbcBleStartPendingRpc(bleVerb, timeoutMs || 15000) : null;

    self.ctx.controlApi.sendTwoWayCommand('sendCommand', tbcTextToHex(cmd), timeoutMs || 15000)
      .subscribe(function (resp) {
        var decoded = tbcDecode(resp);
        var lines = tbcSplit(decoded);
        for (var i = 0; i < lines.length; i++) tbcHandleLine(lines[i]);

        if (tbcRpcIsDataNoise(decoded, cmd)) {
          return;
        }

        if (blePending) {
          return;
        }

        tbcLog('RX ' + tbcShort(decoded));
        resolve(decoded);
      }, function (err) {
        if (blePending) {
          blePending.catch(function () {});
          if (tbcState.blePendingRpc && tbcState.blePendingRpc.verb === bleVerb) {
            tbcBleFinishPendingRpc(tbcState.blePendingRpc, err);
          }
          return;
        }
        reject(err);
      });

    if (blePending) {
      blePending.then(function (decoded) {
        tbcLog('RX ' + tbcShort(decoded));
        resolve(decoded);
      }).catch(function (err) {
        reject(err);
      });
    }
  });
}

function tbcBroadcast(type, payload) {
  var msg = { type: type, payload: payload, ts: Date.now() };
  try { window.dispatchEvent(new CustomEvent('da2_bw_bench', { detail: msg })); } catch (e) {}
  try { localStorage.setItem('da2_bw_bench_msg', JSON.stringify(msg)); } catch (e) {}
}

function tbcSetPill(cls, text) {
  var pill = document.getElementById('tbc-pill');
  if (!pill) return;
  pill.className = 'tbc-pill ' + cls;
  pill.textContent = text;
}

function tbcLog(msg) {
  var el = document.getElementById('tbc-log');
  if (!el) return;
  var now = new Date().toTimeString().substr(0, 8);
  el.textContent = '[' + now + '] ' + msg + '\n' + el.textContent;
}

function tbcTextToHex(str) {
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var h = str.charCodeAt(i).toString(16).toUpperCase();
    out += (h.length === 1 ? '0' : '') + h;
  }
  return out;
}

function tbcDecode(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object') {
    raw = raw.result !== undefined ? raw.result : (raw.data !== undefined ? raw.data : JSON.stringify(raw));
  }
  var s = String(raw);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0) {
    var out = '';
    for (var i = 0; i < s.length; i += 2) out += String.fromCharCode(parseInt(s.substr(i, 2), 16));
    return out;
  }
  return s;
}

function tbcSplit(s) {
  if (!s) return [];
  s = String(s).replace(/(\\x1e|\\x1E)/g, '\n');
  s = s.replace(/(SCAN_RESULT:|SERVICE:|CHAR:)/g, '\n$1');
  return s.split(/\x1e|\n/).map(function (line) {
    line = String(line || '').trim();
    var idx = line.search(/CF(BG|ZB|LR):|SCAN_DONE:|SCAN_RESULT:|CONNECTED:|CHAR:|\+TEST:/i);
    if (idx > 0) line = line.substring(idx);
    return line;
  }).filter(Boolean);
}

function tbcHex4(v) {
  var x = Number(v || 0).toString(16).toUpperCase();
  while (x.length < 4) x = '0' + x;
  return x;
}

function tbcShort(s) {
  s = String(s || '');
  return s.length > 90 ? s.substr(0, 90) + '...' : s;
}

function tbcEsc(s) {
  return String(s || '').replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function tbcSetText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function tbcSetVal(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = val;
}

function tbcGetVal(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}