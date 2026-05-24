/* =============================================================
   DA2 E2E Latency Control Widget — JavaScript
   ThingsBoard widget JavaScript tab

   Datasource: WAN gateway device, key "data" (telemetry)
   Entity    : WAN gateway device (for RPC)

   Simplified flow (one user action per protocol):
     BLE    — Scan → Connect
              Connect chains internally: CONNECT → DISC → NOTIFY (CCCD=1)
              Node is responsible for NTP sync + periodic ts_ms NOTIFY.
              Gateway forwards each NOTIFY to ThingsBoard telemetry, so
              the server compares its receive ts vs node ts → e2e delay.
    Zigbee — Open Network
          Chains: MODULE_START_NETWORK → MODULE_SET_PERMIT_JOIN:180.
          Node joins and reports humidity carrying low16(ts_ms).
     LoRa   — Open Network
              Chains: MODULE_ENTER_P2P_MODE → MODULE_SET_P2P_CONFIG → MODULE_ENTER_P2P_RX.
              Matches the throughput widget's gateway-side command set.

   RPC transport uses sendTwoWayCommand('sendCommand', hex(cmd)) — same as
   the throughput widget, so a single gateway RPC handler serves both.
   ============================================================= */

var EC_LORA_RF_DEFAULT = '868,SF7,125,8,8,14,ON,OFF,OFF';
var EC_SEEN_MAX = 200;

var ecState = {
  ble: {
    scanResults: [],
    devIdx: null,
    connected: false,
    mac: '',
    handles: { e2e1: null, e2e2: null, cccdE2e1: null }
  },
  zb:   { slot: '0' },
  lora: { slot: '1', rfConfig: EC_LORA_RF_DEFAULT, ready: false },
  blePendingRpc: null,
  teleSub: null,
  seen: {},
  seenOrder: []
};

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

self.onInit = function () {
  try {
    ecBind();
    ecRestore();
    ecApplyUi();
    ecSubscribeTelemetry();
    ecSetPill('idle', 'Idle');
    ecLog('Widget ready');
  } catch (e) {
    ecLog('Init error: ' + (e && e.message ? e.message : e));
  }
};

self.onDestroy = function () {
  try {
    if (ecState.teleSub && self.ctx && self.ctx.telemetryWsService) {
      self.ctx.telemetryWsService.unsubscribe(ecState.teleSub);
    }
  } catch (e) {}
};

self.onDataUpdated = function () {
  /* Primary data path when telemetryWsService.subscribe is unavailable on this
     TB version. Reads from the widget's configured datasource (gateway, key
     "data"). The widget operator MUST add a datasource entry for the gateway
     device with datakey "data" — otherwise CONNECTED / DISC_DONE telemetry
     will never reach this widget.                                            */
  try {
    if (ecState.teleSub) return;
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var i = 0; i < data.length; i++) {
      var kd = data[i];
      if (!kd || !kd.data) continue;
      for (var j = 0; j < kd.data.length; j++) {
        var decoded = ecDecode(kd.data[j][1]);
        if (decoded &&
            !/CFBG:OK:NOTIFY:/i.test(decoded) &&
            !/^RPT:[0-9A-Fa-f]/i.test(decoded)) {
          ecLog('TELE: ' + ecShort(decoded));
        }
        ecIngestEntry(kd.data[j][0], kd.data[j][1]);
      }
    }
  } catch (e) {}
};

/* ── Button binding ─────────────────────────────────────────────────────── */

function ecBind() {
  ecOn('ec-ble-scan',    'click', ecBleScan);
  ecOn('ec-ble-connect', 'click', ecBleConnectSelected);
  ecOn('ec-zb-open',     'click', ecZbOpenNetwork);
  ecOn('ec-lora-open',   'click', ecLoraOpenNetwork);
}

function ecOn(id, evt, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener(evt, fn);
}

/* ── Persist / restore ───────────────────────────────────────────────────── */

function ecRestore() {
  try {
    var raw = localStorage.getItem('da2_ec_ctrl_state');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.zb   && s.zb.slot)        ecState.zb.slot       = String(s.zb.slot);
    if (s.lora && s.lora.slot)      ecState.lora.slot     = String(s.lora.slot);
    if (s.lora && s.lora.rfConfig)  ecState.lora.rfConfig = s.lora.rfConfig;
  } catch (e) {}
}

function ecSave() {
  try {
    localStorage.setItem('da2_ec_ctrl_state', JSON.stringify({
      zb:   { slot: ecState.zb.slot },
      lora: { slot: ecState.lora.slot, rfConfig: ecState.lora.rfConfig }
    }));
  } catch (e) {}
}

function ecApplyUi() {
  ecSetVal('ec-zb-slot',   ecState.zb.slot);
  ecSetVal('ec-lora-slot', ecState.lora.slot);
  ecSetVal('ec-lora-rf',   ecState.lora.rfConfig);
}

function ecReadUi() {
  ecState.zb.slot       = String(ecGetVal('ec-zb-slot')   || '0');
  ecState.lora.slot     = String(ecGetVal('ec-lora-slot') || '1');
  var rf = String(ecGetVal('ec-lora-rf') || '').trim();
  ecState.lora.rfConfig = rf || EC_LORA_RF_DEFAULT;
}

/* ── Telemetry subscription (telemetryWsService — preferred) ─────────────── */

function ecSubscribeTelemetry() {
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

    ecState.teleSub = self.ctx.telemetryWsService.subscribe({
      entityType: entityId.entityType,
      entityId: entityId.id,
      keys: ['data'],
      onData: function (d) {
        try {
          var arr = d && d.data;
          if (!arr) return;
          for (var i = 0; i < arr.length; i++) {
            /* Diagnostic: log every telemetry entry like throughput widget does.
               Filter out spammy keepalive lines but keep CONNECTED, DISC_DONE, etc. */
            var decoded = ecDecode(arr[i][1]);
            if (decoded &&
                !/CFBG:OK:NOTIFY:/i.test(decoded) &&
                !/^RPT:[0-9A-Fa-f]/i.test(decoded)) {
              ecLog('TELE: ' + ecShort(decoded));
            }
            ecIngestEntry(arr[i][0], arr[i][1]);
          }
        } catch (e) {}
      }
    });
    ecLog('Telemetry subscribed (entity=' + entityId.id + ')');
  } catch (e) {
    ecLog('Telemetry subscription unavailable — falling back to onDataUpdated: ' +
          (e && e.message ? e.message : e));
  }
}

function ecIngestEntry(ts, raw) {
  var decoded = ecDecode(raw);
  if (!decoded) return;
  var key = String(ts) + '|' + decoded;
  if (ecState.seen[key]) return;
  ecState.seen[key] = 1;
  ecState.seenOrder.push(key);
  if (ecState.seenOrder.length > EC_SEEN_MAX) {
    delete ecState.seen[ecState.seenOrder.shift()];
  }
  var lines = ecSplit(decoded);
  for (var i = 0; i < lines.length; i++) ecHandleLine(lines[i]);
}

/* ── Line handler ───────────────────────────────────────────────────────── */

function ecHandleLine(line) {
  var bl = ecNormalizeBleLine(line);
  ecBleObservePendingRpc(bl);

  /* Forward to bypass monitor widget */
  if (/^SCAN_RESULT:|^SCAN_DONE:|^CONNECTED:|^CHAR:|^SERVICE:|^DISC_DONE:|^DESCR_WRITE_OK:|^WRITE_OK:|^WRITE_NR_OK:/i.test(bl) ||
      /CFZB:\d+:EVT:/i.test(line) ||
      /\+TEST:\s*(RXLRPKT|RFCFG)|\+MODE:\s*TEST/i.test(line)) {
    ecBroadcast('bypass-line', { line: line });
  }

  var m;

  /* SCAN_RESULT:<idx>,<mac>,<rssi>,<name> */
  m = bl.match(/^SCAN_RESULT:(\d+),([0-9A-Fa-f:]{17}),(-?\d+),(.*)/i);
  if (m) { ecBleUpsertDevice(parseInt(m[1], 10), m[2], parseInt(m[3], 10), m[4].trim()); return; }

  /* SCAN_DONE:<count> */
  m = bl.match(/^SCAN_DONE:(\d+)/i);
  if (m) {
    var n = parseInt(m[1], 10);
    ecSetText('ec-ble-status', n > 0 ? 'Scan done: ' + n + ' device(s)' : 'Scan done — no devices nearby');
    return;
  }

  /* CONNECTING:<devIdx>:<mac>  — ACK from gateway, contains devIdx immediately */
  m = bl.match(/^CONNECTING:(\d+):([0-9A-Fa-f:]{17})/i);
  if (m) {
    ecState.ble.devIdx = parseInt(m[1], 10);
    ecState.ble.mac    = m[2];
    ecSetText('ec-ble-status', 'Connecting idx=' + m[1] + '…');
    ecSetPill('run', 'Connecting');
    return;
  }

  /* CONNECTED:<devIdx>:0x<connHandle>:<mac> — actual connection-complete event */
  m = bl.match(/^CONNECTED:(\d+):0x[0-9A-Fa-f]+:([0-9A-Fa-f:]{17})/i);
  if (m) {
    ecState.ble.connected = true;
    ecState.ble.devIdx    = parseInt(m[1], 10);
    ecState.ble.mac       = m[2];
    ecSetText('ec-ble-status', 'Connected idx=' + m[1] + ' — discovering…');
    ecSetPill('active', 'BLE Connected');
    return;
  }

  /* CHAR:<devIdx>:0x<uuid16>:0x<handle>   (throughput-widget format) */
  m = bl.match(/^CHAR:(\d+):0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{4})/i);
  if (m) {
    var uuid   = m[2].toUpperCase();
    var handle = parseInt(m[3], 16);
    if (uuid === 'E2E1') {
      ecState.ble.handles.e2e1     = handle;
      ecState.ble.handles.cccdE2e1 = handle + 1;  /* CCCD typically right after */
      ecLog('  → E2E1 (notify) handle 0x' + ecHex4(handle));
    } else if (uuid === 'E2E2') {
      ecState.ble.handles.e2e2 = handle;
      ecLog('  → E2E2 (interval write) handle 0x' + ecHex4(handle));
    } else if (uuid === '2902' && ecState.ble.handles.e2e1 !== null) {
      ecState.ble.handles.cccdE2e1 = handle;
      ecLog('  → CCCD handle 0x' + ecHex4(handle));
    }
    return;
  }

  /* DISC_DONE:<devIdx> */
  m = bl.match(/^DISC_DONE:(\d+)/i);
  if (m) {
    var h1 = ecState.ble.handles.e2e1;
    var hc = ecState.ble.handles.cccdE2e1;
    ecSetText('ec-ble-status',
      'Discover done. E2E1:' + (h1 !== null ? '0x' + ecHex4(h1) : '?') +
      '  CCCD:' + (hc !== null ? '0x' + ecHex4(hc) : '?'));
    return;
  }

  /* Notify enabled */
  if (/^DESCR_WRITE_OK:/i.test(bl)) {
    ecSetText('ec-ble-status', 'Notifications enabled — gateway forwarding timestamps');
    ecSetPill('active', 'BLE Live');
    return;
  }

  /* Zigbee event */
  if (/CFZB:\d+:EVT:/i.test(line)) {
    var disp = line.length > 70 ? line.substring(0, 70) + '…' : line;
    ecSetText('ec-zb-status', disp);
    return;
  }

  /* LoRa RX active */
  if (/\+TEST:\s*RFCFG/i.test(line) || /\+TEST:\s*RXLRPKT/i.test(line)) {
    ecState.lora.ready = true;
    ecSetText('ec-lora-status', 'LoRa RX active — waiting for node packets');
    ecSetPill('active', 'LoRa RX');
    return;
  }
  if (/\+MODE:\s*TEST/i.test(line)) {
    ecSetText('ec-lora-status', 'TEST mode set — applying RF config…');
    return;
  }
}

function ecNormalizeBleLine(line) {
  var l = String(line || '').trim();
  var ci = l.indexOf('CFBG:');
  if (ci > 0) l = l.substring(ci);
  if (/^CFBG:OK:/i.test(l))            l = l.substring(8);
  else if (/^CFBG:[0-9]+:EVT:/i.test(l)) l = l.replace(/^CFBG:[0-9]+:EVT:/i, '');
  else                                  l = l.replace(/^CFBG:/i, '');
  return l;
}

/* ── BLE pending-RPC state machine ──────────────────────────────────────── */

function ecBleRpcMatchState(verb, line) {
  if (!line) return 'ignore';
  if (/^(ERR|FAIL)[:]/i.test(line) || /^CFBG:FAIL:/i.test(line)) return 'error';
  switch (String(verb || '').toUpperCase()) {
    case 'SCAN':
      if (/^SCAN_RESULT:/i.test(line)) return 'collect';
      if (/^SCAN_DONE:/i.test(line))   return 'finish';
      return 'ignore';
    case 'CONNECT':
      /* Gateway's RPC-response ACK is "CONNECTING:<idx>:<mac>" — already carries
         devIdx, so accept that as a successful finish. The deferred CONNECTED:
         event would arrive via telemetry but most setups never publish it back
         to the widget — gateway log shows BLE connection completes in <150 ms,
         so a small delay before DISC is enough.                              */
      if (/^CONNECTED:/i.test(line) || /^CONNECTING:/i.test(line)) return 'finish';
      if (/^DISCONNECTED:/i.test(line)) return 'error';
      return 'ignore';
    case 'DISC':
      if (/^CHAR:/i.test(line) || /^SERVICE:/i.test(line)) return 'collect';
      if (/^DISC_DONE:/i.test(line)) return 'finish';
      return 'ignore';
    case 'NOTIFY':
      return /^DESCR_WRITE_OK:/i.test(line) ? 'finish' : 'ignore';
    default:
      return 'ignore';
  }
}

function ecBleFinishPendingRpc(pending, err) {
  if (!pending || ecState.blePendingRpc !== pending) return;
  ecState.blePendingRpc = null;
  if (pending.timer) clearTimeout(pending.timer);
  if (err) pending.reject(err instanceof Error ? err : new Error(String(err)));
  else     pending.resolve(pending.lines.join('\n'));
}

function ecBleStartPendingRpc(verb, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (ecState.blePendingRpc) {
      reject(new Error('BLE command overlap: ' + ecState.blePendingRpc.verb));
      return;
    }
    var pending = {
      verb: String(verb || '').toUpperCase(),
      lines: [],
      resolve: resolve, reject: reject,
      timer: setTimeout(function () {
        ecBleFinishPendingRpc(pending, new Error('BLE ' + pending.verb + ' timeout'));
      }, timeoutMs || 15000)
    };
    ecState.blePendingRpc = pending;
  });
}

function ecBleObservePendingRpc(line) {
  var pending = ecState.blePendingRpc;
  if (!pending) return;
  var state = ecBleRpcMatchState(pending.verb, line);
  if (state === 'ignore') return;
  pending.lines.push(line);
  if (state === 'error')  { ecBleFinishPendingRpc(pending, new Error(line)); return; }
  if (state === 'finish') { ecBleFinishPendingRpc(pending, null); }
}

/* ── BLE operations ─────────────────────────────────────────────────────── */

function ecBleScan() {
  ecState.ble.scanResults = [];
  ecSetText('ec-ble-status', 'Scanning 5 s…');
  ecSetPill('run', 'Scanning…');
  ecRpc('CFML:CFBG:0:SCAN:5000', 25000)
    .then(function () {
      var n = ecState.ble.scanResults.length;
      ecSetText('ec-ble-status', n > 0 ? 'Scan done: ' + n + ' device(s)' : 'Scan done — no devices nearby');
      ecSetPill('idle', 'Scan done');
    })
    .catch(function (e) {
      ecSetPill('error', 'Scan timeout');
      ecSetText('ec-ble-status', 'Scan failed / timeout');
      ecLog('SCAN: ' + (e && e.message ? e.message : e));
    });
}

function ecBleConnectSelected() {
  var mac = ecGetVal('ec-ble-device');
  if (!mac) { ecSetText('ec-ble-status', 'Select a device first'); return; }
  ecState.ble.mac       = mac;
  ecState.ble.handles   = { e2e1: null, e2e2: null, cccdE2e1: null };
  ecState.ble.devIdx    = null;
  ecState.ble.connected = false;
  ecSetText('ec-ble-status', 'Connecting ' + mac + '…');
  ecSetPill('run', 'Connecting…');

  ecRpc('CFML:CFBG:0:CONNECT:' + mac, 20000)
    .then(function () {
      if (ecState.ble.devIdx === null) throw new Error('CONNECT reply missing');
      ecSetText('ec-ble-status', 'BLE handshake in progress — waiting 400 ms…');
      /* Gateway returns CONNECTING ACK immediately, but actual BLE connection
         finishes ~100-150 ms later (per gateway log). Give it time before DISC. */
      return new Promise(function (r) { setTimeout(r, 400); });
    })
    .then(function () {
      ecSetText('ec-ble-status', 'Discovering services…');
      return ecRpc('CFML:CFBG:0:DISC:' + ecState.ble.devIdx, 20000);
    })
    .then(function () {
      if (ecState.ble.handles.cccdE2e1 === null) {
        if (ecState.ble.handles.e2e1 === null) throw new Error('E2E1 handle not found');
        ecState.ble.handles.cccdE2e1 = ecState.ble.handles.e2e1 + 1;
        ecLog('CCCD not reported, using E2E1+1 = 0x' + ecHex4(ecState.ble.handles.cccdE2e1));
      }
      ecSetText('ec-ble-status', 'Enabling notifications…');
      return ecRpc('CFML:CFBG:0:NOTIFY:' + ecState.ble.devIdx +
                   ':0x' + ecHex4(ecState.ble.handles.cccdE2e1) + ':1', 10000);
    })
    .then(function () {
      ecState.ble.connected = true;
      ecSetText('ec-ble-status', 'Notifications enabled — gateway forwarding timestamps');
      ecSetPill('active', 'BLE Live');
      ecLog('BLE ready — node pushes NTP-synced ts_ms every 3 s');
    })
    .catch(function (e) {
      ecSetText('ec-ble-status', 'Connect failed: ' + (e && e.message ? e.message : e));
      ecSetPill('error', 'BLE Error');
    });
}

function ecBleUpsertDevice(idx, mac, rssi, name) {
  var list = ecState.ble.scanResults;
  for (var i = 0; i < list.length; i++) {
    if (list[i].mac === mac) {
      list[i].idx = idx; list[i].rssi = rssi; list[i].name = name;
      ecBleRefreshSelect(); return;
    }
  }
  list.push({ idx: idx, mac: mac, rssi: rssi, name: name });
  ecBleRefreshSelect();
}

function ecBleRefreshSelect() {
  var sel = document.getElementById('ec-ble-device');
  if (!sel) return;
  var html = '<option value="">Select device</option>';
  var list = ecState.ble.scanResults;
  for (var i = 0; i < list.length; i++) {
    var d   = list[i];
    var lbl = (d.name || 'Unknown') + '  [' + d.mac + ']  ' + d.rssi + ' dBm';
    var sel2 = (d.name && d.name.indexOf('DA2_BLE_E2E') >= 0) ? ' selected' : '';
    html += '<option value="' + d.mac + '"' + sel2 + '>' + ecEsc(lbl) + '</option>';
  }
  sel.innerHTML = html;
}

/* ── Zigbee operations ──────────────────────────────────────────────────── */

function ecZbOpenNetwork() {
  ecReadUi(); ecSave();
  ecSetText('ec-zb-status', 'Starting Zigbee network…');
  ecSetPill('run', 'ZB starting');

  ecRpc('CFML:CFZB:' + ecState.zb.slot + ':MODULE_START_NETWORK', 15000)
    .then(function () {
      ecSetText('ec-zb-status', 'Network up — opening permit join 180 s');
      return ecRpc('CFML:CFZB:' + ecState.zb.slot + ':MODULE_SET_PERMIT_JOIN:180', 15000);
    })
    .then(function () {
      ecSetText('ec-zb-status', 'Permit join open 180 s — power on node now');
      ecSetPill('active', 'ZB Join Open');
      ecLog('Zigbee network open — node reports timestamps via temp/hum attrs');
    })
    .catch(function (e) {
      ecSetText('ec-zb-status', 'Open network failed: ' + (e && e.message ? e.message : e));
      ecSetPill('error', 'ZB Error');
    });
}

/* ── LoRa operations (throughput's gateway command set) ─────────────────── */

function ecLoraOpenNetwork() {
  ecReadUi(); ecSave();
  ecState.lora.ready = false;
  ecSetText('ec-lora-status', 'Entering P2P mode…');
  ecSetPill('run', 'LoRa setup');

  var preferred = String(ecState.lora.slot || '1');
  var fallback  = preferred === '1' ? '0' : '1';

  function doPrepare(slot) {
    return ecRpc('CFML:CFLR:' + slot + ':MODULE_ENTER_P2P_MODE', 15000)
      .then(function () {
        ecSetText('ec-lora-status', 'Applying RF config…');
        return ecRpc('CFML:CFLR:' + slot + ':MODULE_SET_P2P_CONFIG:' + ecState.lora.rfConfig, 12000);
      })
      .then(function () {
        ecSetText('ec-lora-status', 'Starting RX…');
        return ecRpc('CFML:CFLR:' + slot + ':MODULE_ENTER_P2P_RX', 8000)
          .catch(function () {
            /* Some module profiles arm RX but don't emit an immediate ACK */
            return '';
          });
      })
      .then(function () {
        ecState.lora.slot  = slot;
        ecSetVal('ec-lora-slot', slot);
        ecState.lora.ready = true;
        ecSetText('ec-lora-status', 'LoRa RX armed (slot ' + slot + ') — waiting for node packets');
        ecSetPill('active', 'LoRa RX');
        ecLog('LoRa ready on slot ' + slot + ' — node TX every 3 s after NTP sync');
      });
  }

  return doPrepare(preferred).catch(function (e1) {
    ecLog('LoRa open failed on slot ' + preferred + ', retry slot ' + fallback);
    return doPrepare(fallback).catch(function (e2) {
      ecSetText('ec-lora-status', 'LoRa open failed');
      ecSetPill('error', 'LoRa Error');
      ecLog('LoRa open failed: ' + (e2 && e2.message ? e2.message : e2));
    });
  });
}

/* ── RPC transport (matches throughput widget) ──────────────────────────── */

function ecRpcIsDataNoise(decoded, cmd) {
  decoded = String(decoded || '');
  cmd     = String(cmd || '');
  if (/^CFML:CFLR:\d+:MODULE_ENTER_P2P_RX/i.test(cmd) && /\+TEST:\s*RXLRPKT/i.test(decoded)) {
    return false;
  }
  return /CFBG:OK:NOTIFY:/i.test(decoded) ||
         /(^|\x1E)RPT:[0-9A-Fa-f]/i.test(decoded) ||
         /\+TEST:\s*RXLRPKT/i.test(decoded);
}

function ecRpc(cmd, timeoutMs) {
  ecLog('TX ' + cmd);
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi — assign target device'));
      return;
    }
    var bleVerbMatch = cmd.match(/^CFML:CFBG:\d+:([A-Z_]+)/i);
    var bleVerb     = bleVerbMatch ? bleVerbMatch[1].toUpperCase() : '';
    var blePending  = bleVerb ? ecBleStartPendingRpc(bleVerb, timeoutMs || 15000) : null;

    self.ctx.controlApi.sendTwoWayCommand('sendCommand', ecTextToHex(cmd), timeoutMs || 15000)
      .subscribe(function (resp) {
        var decoded = ecDecode(resp);
        /* Diagnostic: log every emission from sendTwoWayCommand.
           ThingsBoard normally delivers ONE response per RPC, but some gateways
           publish multiple frames to the same /rpc/response/<id> topic.        */
        ecLog('RPC-RX ' + ecShort(decoded));
        var lines   = ecSplit(decoded);
        for (var i = 0; i < lines.length; i++) ecHandleLine(lines[i]);

        if (ecRpcIsDataNoise(decoded, cmd)) return;
        if (blePending) return;  /* let pending-state-machine resolve */

        ecLog('RX ' + ecShort(decoded));
        resolve(decoded);
      }, function (err) {
        if (blePending) {
          blePending.catch(function () {});
          if (ecState.blePendingRpc && ecState.blePendingRpc.verb === bleVerb) {
            ecBleFinishPendingRpc(ecState.blePendingRpc, err);
          }
          return;
        }
        reject(err);
      });

    if (blePending) {
      blePending.then(function (decoded) {
        ecLog('RX ' + ecShort(decoded));
        resolve(decoded);
      }).catch(function (err) {
        reject(err);
      });
    }
  });
}

/* ── Bridge to bypass-monitor widget ────────────────────────────────────── */

function ecBroadcast(type, payload) {
  var msg = { type: type, payload: payload, ts: Date.now() };
  try { window.dispatchEvent(new CustomEvent('da2_bw_bench', { detail: msg })); } catch (e) {}
  try { localStorage.setItem('da2_bw_bench_msg', JSON.stringify(msg)); } catch (e) {}
}

/* ── Encoding / DOM helpers ─────────────────────────────────────────────── */

function ecTextToHex(str) {
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var h = str.charCodeAt(i).toString(16).toUpperCase();
    out += (h.length === 1 ? '0' : '') + h;
  }
  return out;
}

function ecDecode(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object') {
    raw = raw.result !== undefined ? raw.result
        : (raw.data !== undefined ? raw.data : JSON.stringify(raw));
  }
  var s = String(raw);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0) {
    var out = '';
    for (var i = 0; i < s.length; i += 2) out += String.fromCharCode(parseInt(s.substr(i, 2), 16));
    return out;
  }
  return s;
}

function ecSplit(s) {
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

function ecSetPill(cls, text) {
  var el = document.getElementById('ec-pill');
  if (!el) return;
  el.className   = 'ec-pill ' + cls;
  el.textContent = text;
}

function ecLog(msg) {
  var el = document.getElementById('ec-log');
  if (!el) return;
  var now = new Date().toTimeString().substr(0, 8);
  el.textContent = '[' + now + '] ' + msg + '\n' + el.textContent;
  if (el.textContent.length > 12000) el.textContent = el.textContent.substring(0, 12000);
}

function ecHex4(v) {
  var x = (v >>> 0).toString(16).toUpperCase();
  while (x.length < 4) x = '0' + x;
  return x;
}

function ecShort(s) {
  s = String(s || '');
  return s.length > 90 ? s.substr(0, 90) + '...' : s;
}

function ecEsc(s) {
  return String(s || '').replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function ecSetText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = String(text);
}

function ecSetVal(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = String(val);
}

function ecGetVal(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}
