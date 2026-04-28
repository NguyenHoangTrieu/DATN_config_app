/* =====================================================================
   DA2 Total Application Test Control Widget — JavaScript
   Type    : Control widget (requires controlApi / target device)

   Gateway config:
     Internet / Server / Firmware FOTA actions are merged from the
     dedicated config widget so the dashboard can drive the whole gateway
     from one place.

   Poll Scheduler (sequential):
     BLE  → passive NOTIFY (firmware pushes after enable)
     ZB   → active READ_ATTR (0402/0000 + 0405/0000) per interval
     LoRa → TX_MODE → SEND(request) → RX_MODE → wait RXLRPKT

   RTT measurement:
     Each poll records t_request = Date.now()
     telemetry handler records t_recv  = Date.now()
     RTT = t_recv - t_request, stored per technology

   Bridge to Total Application Monitor:
     Broadcasts window CustomEvent 'da2_total_app_event' with decoded data
     so the companion monitor widget can render sensor cards + RTT.
   ===================================================================== */

var CURRENT_FW_VERSION = '2.1.1';

/* ═══════════════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════════════ */
var tcState = {
  /* BLE */
  ble: {
    slot:        '0',
    enabled:     false,
    connected:   false,
    scanBusy:    false,
    devIdx:      null,
    mac:         '',
    name:        '',
    aa11Handle:  null,
    cccdHandle:  null,
    aa12Handle:  null,   /* interval-write characteristic */
    intervalMs:  500,
    lastNotifyTs: 0,
    rtt:         null
  },

  /* Zigbee */
  zb: {
    slot:       '0',
    enabled:    false,
    netUp:      false,
    coordinatorIeee: '',
    shortAddr:  '',
    targetIeee: '',
    ep:         '0B',
    autoSelected: false,
    intervalMs: 1000,
    verified:   false,
    deviceName: '',
    reportConfigured: false,
    bindReady:  false,
    bindFailed: false,
    bindFailureReason: '',
    bindTarget: '',
    awaitingVerify: false,
    tReq:       0,       /* timestamp of last READ_ATTR */
    rtt:        null,
    pendingCluster: null,
    _hexSeq:    0
  },

  /* LoRa */
  lr: {
    slot:         '0',
    enabled:      false,
    configured:   false,
    intervalMs:   2000,
    rttTimeoutMs: 5000,
    rfConfig:     '868000000,SF7,125KHZ,8,8,22',
    seq:          0,
    tReq:         0,
    pendingSeq:   null,
    rtt:          null
  },

  /* Gateway configuration */
  gw: {
    internetType: 'WiFi',
    fallback: false,
    wifiSsid: '',
    wifiPwd: '',
    wifiAuth: 'PERSONAL',
    wifiUser: '',
    lteApn: 'm-wap',
    lteUser: '',
    ltePwd: '',
    serverType: 'MQTT',
    mqBroker: 'mqtt.thingsboard.cloud',
    mqToken: '',
    hpUrl: 'http://server:8080/api/v1/{token}/telemetry',
    hpToken: '',
    hpTls: false,
    cpHost: 'demo.thingsboard.io',
    cpResource: '/api/v1/{token}/telemetry',
    cpToken: '',
    lanUrl: '',
    wanUrl: '',
    lastAction: 'ready',
    lastStatus: 'Gateway config ready'
  },

  /* Scheduler */
  polling:   false,
  schedTimer: null,
  techOrder:  ['ble', 'zb', 'lr'],
  techIdx:    0,       /* current position in round-robin */
  rpcTimeout: 12000
};

var _tcLastTeleTs = 0;
var _tcLastProcessedTs = 0;
var _tcRawLineHandler = null;
var _tcRawBridgeTimer = null;
var _tcLastRawBridgeTs = 0;
var TC_RAW_BRIDGE_KEY = 'da2_total_app_raw_bridge';
var TC_EVENT_NAME = 'da2_total_app_event';
var TC_RAW_EVENT_NAME = 'da2_total_app_raw_line';
var TC_DATA_KEY = 'da2_total_app_data';
var _tcTeleSubscriber = null;

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
self.onInit = function () {
  try {
    if (_tcTeleSubscriber) {
      try {
        if (self.ctx && self.ctx.telemetryWsService) {
          self.ctx.telemetryWsService.unsubscribe(_tcTeleSubscriber);
        }
      } catch (e0) {}
      _tcTeleSubscriber = null;
    }
    tcLoadLocalState();
    tcGwApplyDefaultUrls();
    tcSyncUI();
    tcBindInputs();
    tcBindActions();
    _tcRawLineHandler = function (evt) {
      var detail = evt && evt.detail;
      if (!detail || !detail.line) return;
      tcDispatchLine(detail.line, detail.ts || Date.now());
    };
    window.addEventListener(TC_RAW_EVENT_NAME, _tcRawLineHandler);
    tcStartRawBridgePolling();
    tcSubscribeTelemetry();
    tcGwRefreshModes();
    tcLog('info', 'total_application_test_control ready');
  } catch (e) {
    tcLog('fail', 'onInit: ' + e);
  }
};

self.onDestroy = function () {
  if (_tcRawLineHandler) {
    window.removeEventListener(TC_RAW_EVENT_NAME, _tcRawLineHandler);
    _tcRawLineHandler = null;
  }
  if (_tcTeleSubscriber) {
    try {
      if (self.ctx && self.ctx.telemetryWsService) {
        self.ctx.telemetryWsService.unsubscribe(_tcTeleSubscriber);
      }
    } catch (e0) {}
    _tcTeleSubscriber = null;
  }
  if (_tcRawBridgeTimer) {
    clearInterval(_tcRawBridgeTimer);
    _tcRawBridgeTimer = null;
  }
  tcStopPolling();
};

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
        if (ts <= _tcLastProcessedTs) continue;
        _tcLastProcessedTs = ts;
        var decoded = tcDecodeHex(raw);
        tcSplitLines(decoded).forEach(function (line) { tcDispatchLine(line, ts); });
      }
    }
  } catch (e) {
    tcLog('fail', 'onDataUpdated: ' + e);
  }
};

/* ═══════════════════════════════════════════════════════════════════
   RPC helpers
   ═══════════════════════════════════════════════════════════════════ */
function tcSendRpc(method, params, timeout) {
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi'));
      return;
    }
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeout || tcState.rpcTimeout)
      .subscribe(function (r) { resolve(r); }, function (e) { reject(e); });
  });
}

function tcStrToHex(s) {
  var h = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i).toString(16);
    h += (c.length === 1 ? '0' : '') + c;
  }
  return h.toUpperCase();
}

function tcDecodeHex(val) {
  if (!val) return '';
  if (typeof val === 'object') {
    val = (val.result !== undefined) ? val.result
        : (val.data   !== undefined) ? val.data
        : JSON.stringify(val);
  }
  var s = String(val);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    var out = '';
    for (var i = 0; i < s.length; i += 2) {
      var b = parseInt(s.substr(i, 2), 16);
      if (!isNaN(b)) out += String.fromCharCode(b);
    }
    return out;
  }
  return s;
}

function tcPad2(v) {
  var s = Number(v & 0xFF).toString(16).toUpperCase();
  return s.length === 1 ? '0' + s : s;
}

function tcBytesToHexStr(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i++) out.push(tcPad2(arr[i]));
  return out.join(' ');
}

function tcBuildEbyteFrame(typeByte, codeByte, dataBytes) {
  dataBytes = dataBytes || [];
  var payload = [typeByte, codeByte].concat(dataBytes);
  var checksum = 0;
  for (var i = 0; i < payload.length; i++) checksum ^= payload[i];
  var length = payload.length + 1;
  return [0x55, length].concat(payload).concat([checksum]);
}

function tcBuildZdoFrame(codeByte, shortAddrInt, params) {
  return tcBuildEbyteFrame(0x01, codeByte, [shortAddrInt & 0xFF, (shortAddrInt >> 8) & 0xFF].concat(params || []));
}

function tcBuildZclReadAttrFrame(shortAddr, ep, cluster, attrId) {
  var seq = (tcState.zb._hexSeq++) & 0xFF;
  var aH = parseInt(attrId.substring(0, 2), 16);
  var aL = parseInt(attrId.substring(2, 4), 16);
  var header = [
    0x00,
    shortAddr & 0xFF,
    (shortAddr >> 8) & 0xFF,
    ep & 0xFF,
    seq,
    0x00,
    cluster & 0xFF,
    (cluster >> 8) & 0xFF,
    0x00,
    0x00,
    0x00
  ];
  return tcBuildEbyteFrame(0x02, 0x00, header.concat([0x01, aL, aH]));
}

function tcBuildZclWriteAttrFrame(shortAddr, ep, cluster, attrId, dataType, dataBytes) {
  var seq = (tcState.zb._hexSeq++) & 0xFF;
  var aH = parseInt(attrId.substring(0, 2), 16);
  var aL = parseInt(attrId.substring(2, 4), 16);
  var ext = [0x01, aL, aH, dataType & 0xFF].concat(dataBytes);
  var header = [
    0x00,
    shortAddr & 0xFF,
    (shortAddr >> 8) & 0xFF,
    ep & 0xFF,
    seq,
    0x00,
    cluster & 0xFF,
    (cluster >> 8) & 0xFF,
    0x00,
    0x00,
    0x00
  ];
  return tcBuildEbyteFrame(0x02, 0x01, header.concat(ext));
}

function tcBuildZclConfigureReportingFrame(shortAddr, ep, cluster, attrId, dataType, minIntervalSec, maxIntervalSec, reportableChange) {
  var seq = (tcState.zb._hexSeq++) & 0xFF;
  var aH = parseInt(attrId.substring(0, 2), 16);
  var aL = parseInt(attrId.substring(2, 4), 16);
  var ext = [
    aL,
    aH,
    dataType & 0xFF,
    minIntervalSec & 0xFF,
    (minIntervalSec >> 8) & 0xFF,
    maxIntervalSec & 0xFF,
    (maxIntervalSec >> 8) & 0xFF,
    reportableChange & 0xFF,
    (reportableChange >> 8) & 0xFF
  ];
  var header = [
    0x00,
    shortAddr & 0xFF,
    (shortAddr >> 8) & 0xFF,
    ep & 0xFF,
    seq,
    0x00,
    cluster & 0xFF,
    (cluster >> 8) & 0xFF,
    0x00,
    0x00,
    0x00
  ];
  return tcBuildEbyteFrame(0x02, 0x03, header.concat(ext));
}

function tcIeeeToLeBytes(ieee) {
  var clean = String(ieee || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length !== 16) return null;
  var out = [];
  for (var i = 14; i >= 0; i -= 2) out.push(parseInt(clean.substr(i, 2), 16));
  return out;
}

function tcBuildZclBindFrame(shortAddr, srcIeee, ep, cluster, dstIeee, dstEp) {
  var srcBytes = tcIeeeToLeBytes(srcIeee);
  var dstBytes = tcIeeeToLeBytes(dstIeee);
  if (!srcBytes || !dstBytes) throw new Error('Missing IEEE for Zigbee bind');
  return tcBuildZdoFrame(0x21, shortAddr, srcBytes.concat([
    ep & 0xFF,
    cluster & 0xFF,
    (cluster >> 8) & 0xFF,
    0x03
  ], dstBytes, [dstEp & 0xFF]));
}

function tcNormalizeBleNotifyHex(rawPayload) {
  var raw = String(rawPayload || '').trim();
  if (!raw) return '';
  var patched = raw.replace(/xy/ig, '16').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  return patched.length >= 8 ? patched.substr(0, 8) : '';
}

function tcSplitLines(s) {
  if (!s) return [];
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    /* strip gateway log prefix before protocol/event tag */
    var ci = x.search(/CF(BG|ZB|LR|ML):|RPT:|RXLRPKT|\+TEST:/);
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

function tcResolveTargetEntityId() {
  var ctx = self.ctx;
  if (!ctx) return null;

  try {
    var td = ctx.widgetContext && ctx.widgetContext.targetDevice;
    if (td && td.id) return td.id;
  } catch (e) {}

  try {
    var sc = ctx.stateController;
    if (sc) {
      var eid = typeof sc.getEntityId === 'function' ? sc.getEntityId() : null;
      if (eid && eid.entityType === 'DEVICE' && eid.id) return eid.id;
      var sp = typeof sc.getStateParams === 'function' ? sc.getStateParams() : null;
      if (sp && sp.entityId && sp.entityId.entityType === 'DEVICE') return sp.entityId.id;
    }
  } catch (e2) {}

  try {
    var ds = ctx.defaultSubscription;
    if (ds && ds.targetDeviceId) return ds.targetDeviceId;
  } catch (e3) {}

  try {
    var ca = ctx.controlApi;
    if (ca && ca.targetDeviceId) return ca.targetDeviceId;
  } catch (e4) {}

  return null;
}

function tcSubscribeTelemetry() {
  try {
    if (!self.ctx || !self.ctx.telemetryWsService) {
      tcLog('info', 'Telemetry WS unavailable — using datasource/bridge');
      return;
    }
    var entityId = tcResolveTargetEntityId();
    if (!entityId) {
      tcLog('warn', 'Cannot resolve target device for telemetry subscription');
      return;
    }
    var subscriber = {
      entityId: entityId,
      entityType: 'DEVICE',
      keys: ['data'],
      onData: function (data) {
        if (!data) return;
        var arr = data.data;
        if (!arr || !arr.length) return;
        for (var i = 0; i < arr.length; i++) {
          var latest = arr[i];
          if (!latest || latest.length < 2) continue;
          var ts = latest[0];
          var raw = latest[1];
          if (ts <= _tcLastProcessedTs) continue;
          _tcLastProcessedTs = ts;
          var decoded = tcDecodeHex(raw);
          tcSplitLines(decoded).forEach(function (line) { tcDispatchLine(line, ts); });
        }
      }
    };
    self.ctx.telemetryWsService.subscribe(subscriber);
    _tcTeleSubscriber = subscriber;
    tcLog('info', 'Telemetry WS subscribed → key=data');
  } catch (e) {
    tcLog('info', 'Telemetry direct subscribe unavailable — using datasource/bridge');
  }
}

function tcHexWordsToBytes(hexStr) {
  if (!hexStr) return [];
  var s = String(hexStr).trim();
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

function tcBytesContainFrame(bytes) {
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x55 && i + 1 < bytes.length) return true;
  }
  return false;
}

function tcPreviewFirstFrame(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x55) {
      for (var j = i; j < bytes.length && out.length < 24; j++) {
        out.push(tcPad2(bytes[j]));
      }
      break;
    }
  }
  return out.join(' ');
}

function tcParseEbyteFrame(hexStr) {
  var bytes = tcHexWordsToBytes(hexStr);
  if (bytes.length < 4 || bytes[0] !== 0x55) return null;
  var length = bytes[1];
  var dataLen = length - 3;
  if (dataLen < 0) dataLen = 0;
  var end = 4 + dataLen;
  if (end >= bytes.length + 1) return null;
  var type = bytes[2];
  var code = bytes[3];
  var data = bytes.slice(4, end);
  var recvChk = bytes[end];
  var calcChk = type ^ code;
  for (var i = 0; i < data.length; i++) calcChk ^= data[i];
  return { type: type, code: code, data: data, valid: calcChk === recvChk };
}

function tcParseZbAttrValue(data, offset, dataType) {
  if (dataType === 0x10 || dataType === 0x20 || dataType === 0x30) {
    return { hex: tcPad2(data[offset] || 0), size: 1 };
  }
  if (dataType === 0x21) {
    var uint16 = ((data[offset + 1] || 0) << 8) | (data[offset] || 0);
    return { hex: tcPad2((uint16 >> 8) & 0xFF) + tcPad2(uint16 & 0xFF), size: 2 };
  }
  if (dataType === 0x29) {
    var int16 = ((data[offset + 1] || 0) << 8) | (data[offset] || 0);
    if (int16 & 0x8000) int16 = int16 - 0x10000;
    return { hex: tcPad2(((int16 & 0xFFFF) >> 8) & 0xFF) + tcPad2(int16 & 0xFF), size: 2 };
  }
  if (dataType === 0x42) {
    var len = data[offset] || 0;
    var chars = [];
    for (var i = 0; i < len && (offset + 1 + i) < data.length; i++) {
      chars.push(String.fromCharCode(data[offset + 1 + i] || 0));
    }
    return { hex: chars.join(''), size: 1 + len };
  }
  return { hex: tcPad2(data[offset] || 0), size: 1 };
}

function tcZbIntervalSec() {
  return Math.max(1, Math.round((tcState.zb.intervalMs || 1000) / 1000));
}

function tcResetZbSession(reason) {
  tcState.zb.verified = false;
  tcState.zb.deviceName = '';
  tcState.zb.targetIeee = '';
  tcState.zb.reportConfigured = false;
  tcState.zb.bindReady = false;
  tcState.zb.bindFailed = false;
  tcState.zb.bindFailureReason = '';
  tcState.zb.bindTarget = '';
  tcState.zb.awaitingVerify = false;
  tcState.zb.tReq = 0;
  tcState.zb.rtt = null;
  delete tcState.zb._lastTemp;
  delete tcState.zb._lastHum;
  if (reason) {
    tcLog('info', '[ZB] Session reset: ' + reason);
  }
}

function tcRefreshZbStatus() {
  if (!tcState.zb.netUp) {
    tcSetStatus('zb', 'warn', 'Network not started');
    return;
  }
  if (!tcState.zb.shortAddr) {
    tcSetStatus('zb', 'warn', 'Waiting for node join/announce');
    return;
  }
  if (!tcState.zb.verified) {
    tcSetStatus('zb', 'warn', 'Target 0x' + tcState.zb.shortAddr + ' EP:' + tcState.zb.ep + ' — verify pending');
    return;
  }
  if (!tcState.zb.targetIeee) {
    tcSetStatus('zb', 'warn', 'Verified target 0x' + tcState.zb.shortAddr + ' — waiting node IEEE');
    return;
  }
  if (!tcState.zb.coordinatorIeee) {
    tcSetStatus('zb', 'warn', 'Verified target 0x' + tcState.zb.shortAddr + ' — waiting coordinator IEEE');
    return;
  }
  if (!tcState.zb.reportConfigured) {
    tcSetStatus('zb', 'warn', 'Verified ' + (tcState.zb.deviceName || ('0x' + tcState.zb.shortAddr)) + ' — setup push pending');
    return;
  }
  tcSetStatus('zb', 'ok', 'Push active @ ' + tcZbIntervalSec() + ' s — ' + (tcState.zb.deviceName || ('0x' + tcState.zb.shortAddr)));
}

function tcEmitZbSample(now) {
  if (tcState.zb._lastTemp === undefined && tcState.zb._lastHum === undefined) return;
  tcEmitData('zb', {
    temp: tcState.zb._lastTemp !== undefined ? tcState.zb._lastTemp : null,
    hum: tcState.zb._lastHum !== undefined ? tcState.zb._lastHum : null,
    rtt: null,
    ts: now,
    mode: 'push',
    intervalSec: tcZbIntervalSec(),
    node: tcState.zb.shortAddr
  });
  tcLog('evt', '[ZB] PUSH T=' + (tcState.zb._lastTemp !== undefined ? tcState.zb._lastTemp.toFixed(2) + '°C' : '--') + ' H=' + (tcState.zb._lastHum !== undefined ? tcState.zb._lastHum.toFixed(2) + '%' : '--') + ' @' + tcZbIntervalSec() + 's');
  tcSetStatus('zb', 'ok', 'T=' + (tcState.zb._lastTemp !== undefined ? tcState.zb._lastTemp.toFixed(1) + '°C' : '--') + ' H=' + (tcState.zb._lastHum !== undefined ? tcState.zb._lastHum.toFixed(1) + '%' : '--') + ' — push @ ' + tcZbIntervalSec() + ' s');
}

function tcWaitForZbBind(shortAddr, timeoutMs) {
  var expected = String(shortAddr || '').toUpperCase();
  return new Promise(function (resolve, reject) {
    var started = Date.now();
    var timer = setInterval(function () {
      if (tcState.zb.bindFailed) {
        clearInterval(timer);
        reject(new Error(tcState.zb.bindFailureReason || 'Bind failed'));
        return;
      }
      if (tcState.zb.bindReady && (!expected || tcState.zb.bindTarget === expected)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if ((Date.now() - started) >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('Bind notify timeout'));
      }
    }, 200);
  });
}

function tcQueryZbIeee(shortAddr, label) {
  var cleanShort = String(shortAddr || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase().substr(0, 4);
  if (cleanShort.length !== 4) return Promise.reject(new Error('Invalid short address for IEEE query'));
  var queryHex = tcBytesToHexStr(tcBuildZdoFrame(0x01, parseInt(cleanShort, 16), []));
  tcLog('info', '[ZB] Query ' + (label || 'node') + ' IEEE for 0x' + cleanShort + '…');
  return tcSendCFZB('MODULE_QUERY_IEEE_ADDR', queryHex, 8000);
}

function tcWaitForCoordinatorIeee(timeoutMs) {
  return new Promise(function (resolve, reject) {
    var started = Date.now();
    var timer = setInterval(function () {
      if (tcState.zb.coordinatorIeee) {
        clearInterval(timer);
        resolve(tcState.zb.coordinatorIeee);
        return;
      }
      if ((Date.now() - started) >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('Coordinator IEEE timeout'));
      }
    }, 200);
  });
}

function tcEnsureCoordinatorIeee() {
  if (tcState.zb.coordinatorIeee) return Promise.resolve(tcState.zb.coordinatorIeee);
  return tcQueryZbIeee('0000', 'coordinator')
    .then(function () { return tcWaitForCoordinatorIeee(4000); });
}

function tcHandleZbAttrValue(shortAddr, ep, cluster, attr, valueHex, now) {
  var currentShort = String(tcState.zb.shortAddr || '').toUpperCase();
  if (!currentShort || shortAddr !== currentShort) return;

  if (cluster === '0003' && attr === '0000') {
    tcState.zb.awaitingVerify = false;
    var raw16 = parseInt(valueHex, 16);
    if (tcState.zb.verifyCode && raw16 <= tcState.zb.verifyCode && raw16 >= tcState.zb.verifyCode - 5) {
      tcState.zb.verified = true;
      tcState.zb.deviceName = 'DATN-' + shortAddr;
      tcLog('info', '[ZB] Verify OK 0x' + shortAddr + ' (Code matched)');
      tcRefreshZbStatus();
      setTimeout(tcZbSetupPush, 1000);
      return;
    }
    tcState.zb.verified = false;
    tcState.zb.reportConfigured = false;
    tcState.zb.deviceName = '';
    tcLog('fail', '[ZB] Verify FAIL 0x' + shortAddr + ' (Expected ~' + tcState.zb.verifyCode + ' got ' + raw16 + ')');
    tcSetStatus('zb', 'fail', 'Verify failed for 0x' + shortAddr);
    return;
  }

  var raw16 = parseInt(valueHex, 16);
  if (cluster === '0402' && attr === '0000') {
    if (raw16 & 0x8000) raw16 = raw16 - 0x10000;
    tcState.zb._lastTemp = raw16 * 0.01;
    tcEmitZbSample(now);
    return;
  }

  if (cluster === '0405' && attr === '0000') {
    tcState.zb._lastHum = raw16 * 0.01;
    tcEmitZbSample(now);
  }
}

function tcAdoptZbTarget(shortAddr, ep, source, ieee) {
  shortAddr = String(shortAddr || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase().substr(0, 4);
  ep = String(ep || tcState.zb.ep || '0B').replace(/[^0-9A-Fa-f]/g, '').toUpperCase().substr(0, 2) || '0B';
  ieee = String(ieee || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase().substr(0, 16);
  if (!shortAddr) return;

  var currentShort = String(tcState.zb.shortAddr || '').toUpperCase();
  var currentEp = String(tcState.zb.ep || '0B').toUpperCase();
  var currentIeee = String(tcState.zb.targetIeee || '').toUpperCase();
  var shouldOverride = !currentShort || tcState.zb.autoSelected || currentShort === shortAddr;
  if (!shouldOverride) return;

  var changed = currentShort !== shortAddr || currentEp !== ep || !tcState.zb.autoSelected;
  if (changed) tcResetZbSession('target changed');
  tcState.zb.shortAddr = shortAddr;
  tcState.zb.ep = ep;
  if (ieee && ieee.length === 16) tcState.zb.targetIeee = ieee;
  tcState.zb.autoSelected = true;

  var addrEl = document.getElementById('tc-zb-addr');
  if (addrEl) addrEl.value = shortAddr;
  var epEl = document.getElementById('tc-zb-ep');
  if (epEl) epEl.value = ep;

  tcSaveLocalState();
  if (changed || (ieee && ieee !== currentIeee)) {
    tcLog('info', '[ZB] Auto target from ' + source + ': 0x' + shortAddr + ' EP:' + ep + (tcState.zb.targetIeee ? ' IEEE:' + tcState.zb.targetIeee : ''));
    tcRefreshZbStatus();
  }
}

function tcHandleZbHexFrame(hexStr, ts) {
  var frame = tcParseEbyteFrame(hexStr);
  var now = ts || Date.now();
  if (!frame) return;
  /* Some CFZB replies reach the dashboard with the final checksum byte mangled
     by text transport/log formatting. The frame body is still usable, so accept
     known Zigbee runtime frame types even if checksum validation fails. */
  if (!frame.valid && frame.type !== 0x80 && frame.type !== 0x82 && frame.type !== 0x8F) return;

  if (frame.type === 0x80) {
    if (frame.code === 0x00 && frame.data.length >= 10) {
      tcState.zb.coordinatorIeee = frame.data.slice(2, 10).reverse().map(function (b) { return tcPad2(b); }).join('');
      tcLog('info', '[ZB] Coordinator IEEE: ' + tcState.zb.coordinatorIeee);
      tcRefreshZbStatus();
      return;
    }
    if (frame.code === 0x01 && frame.data.length >= 1) {
      tcState.zb.netUp = frame.data[0] === 0x01;
      tcSetStatus('zb', tcState.zb.netUp ? 'ok' : 'warn', tcState.zb.netUp ? 'Network up' : 'Network down');
      tcLog('evt', '[ZB] NetStatus: ' + (tcState.zb.netUp ? 'UP' : 'DOWN'));
      return;
    }
    if (frame.code === 0x02 && frame.data.length >= 1) {
      tcLog('evt', '[ZB] Network open: ' + frame.data[0] + 's');
      return;
    }
    if (frame.code === 0x03 && frame.data.length >= 10) {
      var joinIeee = frame.data.slice(0, 8).reverse().map(function (b) { return tcPad2(b); }).join('');
      var joinShort = tcPad2(frame.data[9] || 0) + tcPad2(frame.data[8] || 0);
      tcAdoptZbTarget(joinShort, tcState.zb.ep || '0B', 'join', joinIeee);
      tcLog('evt', '[ZB] Node joined: 0x' + joinShort + ' IEEE:' + joinIeee);
      return;
    }
    if (frame.code === 0x05 && frame.data.length >= 13) {
      var annIeee = frame.data.slice(2, 10).reverse().map(function (b) { return tcPad2(b); }).join('');
      var annShort = tcPad2(frame.data[11] || 0) + tcPad2(frame.data[10] || 0);
      var annEp = tcPad2(frame.data[12] || 0);
      tcAdoptZbTarget(annShort, annEp, 'announce', annIeee);
      tcLog('evt', '[ZB] Node announce: 0x' + annShort + ' EP:' + annEp + ' IEEE:' + annIeee);
      return;
    }
    if (frame.code === 0x06 && frame.data.length >= 8) {
      tcLog('evt', '[ZB] Node leave notify');
      return;
    }
    if (frame.code === 0x10 && frame.data.length >= 5) {
      var bindShort = tcPad2(frame.data[1] || 0) + tcPad2(frame.data[0] || 0);
      var bindEp = tcPad2(frame.data[2] || 0);
      var bindCluster = tcPad2(frame.data[4] || 0) + tcPad2(frame.data[3] || 0);
      if (bindShort === 'FFFE' || bindEp === 'FF' || bindCluster === 'FFFF') {
        tcState.zb.bindReady = false;
        tcState.zb.bindFailed = true;
        tcState.zb.bindFailureReason = 'No valid bind target found';
        tcState.zb.bindTarget = '';
        tcLog('warn', '[ZB] Find/Bind miss: short=0x' + bindShort + ' EP:' + bindEp + ' Cl:' + bindCluster);
        return;
      }
      tcState.zb.bindReady = true;
      tcState.zb.bindFailed = false;
      tcState.zb.bindFailureReason = '';
      tcState.zb.bindTarget = bindShort;
      tcLog('evt', '[ZB] Find/Bind ready: 0x' + bindShort + ' EP:' + bindEp + ' Cl:' + bindCluster);
      return;
    }
  }

  if (frame.type === 0x81 && frame.code === 0x01) {
    if (frame.data.length >= 11 && frame.data[0] === 0x00) {
      var len = frame.data.length;
      var ieeeRsp = frame.data.slice(len - 10, len - 2).reverse().map(function (b) { return tcPad2(b); }).join('');
      var shortRsp = tcPad2(frame.data[len - 1] || 0) + tcPad2(frame.data[len - 2] || 0);
      if (shortRsp === '0000') {
        tcState.zb.coordinatorIeee = ieeeRsp;
        tcLog('info', '[ZB] Coordinator IEEE: ' + tcState.zb.coordinatorIeee + ' (query)');
        tcRefreshZbStatus();
        return;
      }
      if (shortRsp === String(tcState.zb.shortAddr || '').toUpperCase()) {
        tcState.zb.targetIeee = ieeeRsp;
        tcLog('info', '[ZB] Target IEEE: ' + tcState.zb.targetIeee + ' (query)');
        tcRefreshZbStatus();
        return;
      }
    }
    tcLog('warn', '[ZB] IEEE query response not understood');
    return;
  }

  if (frame.type === 0x82 && frame.code === 0x00) {
    if (frame.data.length < 16) return;
    var srcAddrRsp = tcPad2(frame.data[2] || 0) + tcPad2(frame.data[1] || 0);
    var srcEpRsp = tcPad2(frame.data[3] || 0);
    var clusterRsp = tcPad2(frame.data[7] || 0) + tcPad2(frame.data[6] || 0);
    var numAttrRsp = frame.data[11] || 0;
    var posRsp = 12;
    for (var i = 0; i < numAttrRsp && posRsp + 3 < frame.data.length; i++) {
      var attrRsp = tcPad2(frame.data[posRsp + 1] || 0) + tcPad2(frame.data[posRsp] || 0);
      var statusRsp = frame.data[posRsp + 2] || 0;
      posRsp += 3;
      if (statusRsp !== 0x00 || posRsp >= frame.data.length) continue;
      var dataTypeRsp = frame.data[posRsp] || 0;
      posRsp += 1;
      var parsedRsp = tcParseZbAttrValue(frame.data, posRsp, dataTypeRsp);
      posRsp += parsedRsp.size;
      tcHandleZbAttrValue(srcAddrRsp, srcEpRsp, clusterRsp, attrRsp, parsedRsp.hex, now);
    }
    return;
  }

  if (frame.type === 0x82 && frame.code === 0x0A) {
    if (frame.data.length < 15) return;
    var srcAddrRpt = tcPad2(frame.data[2] || 0) + tcPad2(frame.data[1] || 0);
    var srcEpRpt = tcPad2(frame.data[3] || 0);
    var clusterRpt = tcPad2(frame.data[7] || 0) + tcPad2(frame.data[6] || 0);
    var numAttrRpt = frame.data[11] || 0;
    var posRpt = 12;
    for (var j = 0; j < numAttrRpt && posRpt + 2 < frame.data.length; j++) {
      var attrRpt = tcPad2(frame.data[posRpt + 1] || 0) + tcPad2(frame.data[posRpt] || 0);
      var dataTypeRpt = frame.data[posRpt + 2] || 0;
      posRpt += 3;
      var parsedRpt = tcParseZbAttrValue(frame.data, posRpt, dataTypeRpt);
      posRpt += parsedRpt.size;
      tcHandleZbAttrValue(srcAddrRpt, srcEpRpt, clusterRpt, attrRpt, parsedRpt.hex, now);
    }
  }
}

function tcParseAndDispatchAllHexFrames(hexStr, ts) {
  var bytes = tcHexWordsToBytes(hexStr);
  var pos = 0;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0x55) {
      pos++;
      continue;
    }
    if (pos + 1 >= bytes.length) break;
    var totalLen = 2 + bytes[pos + 1];
    if (pos + totalLen > bytes.length) break;
    var frameHex = bytes.slice(pos, pos + totalLen).map(function (b) {
      return tcPad2(b);
    }).join(' ');
    tcHandleZbHexFrame(frameHex, ts);
    pos += totalLen;
  }
}

function tcDispatchLine(line, ts) {
  var evtIdx = line.indexOf(':EVT:');
  if (evtIdx >= 0) {
    var evtPayload = line.substring(evtIdx + 5);
    var evtBytes = tcHexWordsToBytes(evtPayload);
    if (tcBytesContainFrame(evtBytes)) {
      var evtPreview = tcPreviewFirstFrame(evtBytes);
      tcLog('evt', '[ZB] HEX EVT: ' + evtPreview + (evtBytes.length > 24 ? '…' : ''));
      tcParseAndDispatchAllHexFrames(evtPayload, ts);
      return;
    }
  }

  var okIdx = line.indexOf(':OK:');
  if (okIdx >= 0) {
    var lastColon = line.lastIndexOf(':');
    if (lastColon > okIdx + 3) {
      var okPayload = line.substring(lastColon + 1);
      if (tcBytesContainFrame(tcHexWordsToBytes(okPayload))) {
        tcParseAndDispatchAllHexFrames(okPayload, ts);
      }
    }
  }

  if (/^55\s+[0-9A-Fa-f]{2}/i.test(line)) {
    tcParseAndDispatchAllHexFrames(line, ts);
    return;
  }

  tcHandleAsyncLine(line, ts);
}

function tcStartRawBridgePolling() {
  if (_tcRawBridgeTimer) return;
  _tcRawBridgeTimer = setInterval(function () {
    try {
      var raw = localStorage.getItem(TC_RAW_BRIDGE_KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (!obj || !obj.updatedAt || !obj.line) return;
      if (obj.updatedAt <= _tcLastRawBridgeTs) return;
      _tcLastRawBridgeTs = obj.updatedAt;
      tcDispatchLine(obj.line, obj.ts || obj.updatedAt);
    } catch (e) {}
  }, 500);
}

/* Send CFBG command */
function tcSendCFBG(verb, params, timeout, options) {
  options = options || {};
  var cmd = 'CFML:CFBG:' + tcState.ble.slot + ':' + verb + (params ? ':' + params : '');
  tcLog('tx', cmd);
  return tcSendRpc('sendCommand', tcStrToHex(cmd), timeout || tcState.rpcTimeout)
    .then(function (r) {
      var d = tcDecodeHex(r);
      tcSplitLines(d).forEach(function (l) { tcLog('rx', l); });
      return d;
    })
    .catch(function (e) {
      if (!options.allowAsyncTimeout || !tcIsRpcTimeoutError(e)) {
        tcLog('fail', 'CFBG RPC: ' + (e && e.message ? e.message : e));
      }
      throw e;
    });
}

/* Send CFZB command */
function tcSendCFZB(verb, params, timeout) {
  var cmd = 'CFML:CFZB:' + tcState.zb.slot + ':' + verb + (params ? ':' + params : '');
  tcLog('tx', cmd);
  return tcSendRpc('sendCommand', tcStrToHex(cmd), timeout || tcState.rpcTimeout)
    .then(function (r) {
      var d = tcDecodeHex(r);
      tcSplitLines(d).forEach(function (l) {
        tcLog('rx', l);
        tcDispatchLine(l, Date.now());
      });
      return d;
    })
    .catch(function (e) {
      tcLog('fail', 'CFZB RPC: ' + (e && e.message ? e.message : e));
      throw e;
    });
}

/* Send CFLR command */
function tcSendCFLR(verb, params, timeout) {
  var cmd = 'CFML:CFLR:' + tcState.lr.slot + ':' + verb + (params ? ':' + params : '');
  tcLog('tx', cmd);
  return tcSendRpc('sendCommand', tcStrToHex(cmd), timeout || tcState.rpcTimeout)
    .then(function (r) {
      var d = tcDecodeHex(r);
      tcSplitLines(d).forEach(function (l) { tcLog('rx', l); });
      return d;
    })
    .catch(function (e) {
      tcLog('fail', 'CFLR RPC: ' + (e && e.message ? e.message : e));
      throw e;
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Async Telemetry Handler
   ═══════════════════════════════════════════════════════════════════ */
function tcHandleAsyncLine(line, ts) {
  var now = Date.now();

  /* ── BLE scan result / completion (may arrive async via telemetry) ── */
  var m = line.match(/SCAN_RESULT:(\d+),([0-9a-fA-F:]{17}),(-?\d+),(.*)/i);
  if (m) {
    tcBleAddScanResult(m[1], m[2], m[3], m[4]);
    return;
  }

  m = line.match(/CFBG:OK:SCAN_DONE:(\d+)/i);
  if (m) {
    tcState.ble.scanBusy = false;
    tcBleSetScanBusy(false);
    tcLog('info', 'BLE scan done (' + parseInt(m[1], 10) + ' device(s))');
    return;
  }

  m = line.match(/CFBG:FAIL:SCAN:BUSY/i);
  if (m) {
    tcState.ble.scanBusy = true;
    tcBleSetScanBusy(true);
    tcLog('warn', 'BLE scan busy — waiting for current scan to finish');
    return;
  }

  /* ── BLE NOTIFY ──────────────────────────────────────────────── */
  /* CFBG:OK:NOTIFY:<idx>:0x<handle>:<hex4B> */
  m = line.match(/CFBG:OK:NOTIFY:(\d+):0x[0-9A-Fa-f]+:([^\s\x1E]+)/i);
  if (m) {
    var hex4 = tcNormalizeBleNotifyHex(m[2]);
    if (!hex4) {
      tcLog('warn', '[BLE] Ignore malformed notify payload: ' + m[2]);
      return;
    }
    var tRaw = parseInt(hex4.substr(2, 2) + hex4.substr(0, 2), 16);
    var hRaw = parseInt(hex4.substr(6, 2) + hex4.substr(4, 2), 16);
    /* Signed 16-bit */
    if (tRaw & 0x8000) tRaw = tRaw - 0x10000;
    var temp = tRaw * 0.01;
    var hum  = hRaw * 0.01;
    /* RTT: time since NOTIFY was enabled (continuous) — use last tx time */
    var rtt = (tcState.ble.tReq > 0) ? (now - tcState.ble.tReq) : null;
    tcState.ble.rtt = rtt;
    tcState.ble.lastNotifyTs = now;
    tcEmitData('ble', {
      key: 'ble:' + String(tcState.ble.devIdx != null ? tcState.ble.devIdx : 0),
      devIdx: tcState.ble.devIdx,
      title: tcState.ble.name || ('BLE Sensor #' + String(tcState.ble.devIdx != null ? tcState.ble.devIdx : 0)),
      temp: temp,
      hum: hum,
      rtt: rtt,
      ts: now
    });
    tcLog('evt', '[BLE] T=' + temp.toFixed(2) + '°C H=' + hum.toFixed(2) + '%' + (rtt ? ' RTT=' + rtt + 'ms' : ''));
    tcSetStatus('ble', 'ok', 'T=' + temp.toFixed(1) + '°C H=' + hum.toFixed(1) + '%');
    return;
  }

  /* ── BLE CONNECTED (async) ──────────────────────────────────── */
  m = line.match(/CFBG:OK:CONNECTED:(\d+):0x[0-9A-Fa-f]+:([0-9a-fA-F:]{17})/i);
  if (m) {
    tcState.ble.devIdx = parseInt(m[1], 10);
    tcLog('evt', '[BLE] Connected idx=' + tcState.ble.devIdx);
    return;
  }

  /* ── BLE DISC_DONE — extract AA11/AA12/CCCD handles ─────────── */
  m = line.match(/(?:CFBG:OK:)?CHAR:(\d+):0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{2})/i);
  if (m) {
    var uuid16 = m[2].toUpperCase();
    var handle = parseInt(m[3], 16);
    if (uuid16 === 'AA11') {
      tcState.ble.aa11Handle = handle;
      tcState.ble.cccdHandle = handle + 1;
      tcLog('info', 'BLE: AA11 handle=0x' + handle.toString(16).toUpperCase() + ' CCCD=0x' + tcState.ble.cccdHandle.toString(16).toUpperCase());
    }
    if (uuid16 === 'AA12') {
      tcState.ble.aa12Handle = handle;
      tcLog('info', 'BLE: AA12 handle=0x' + handle.toString(16).toUpperCase());
    }
    return;
  }

  /* ── ZB attribute report (RPT line from firmware) ──────────── */
  /* RPT:<short4>,<ep2>,<cluster4>,<attr4>,<type2>,<value> */
  m = line.match(/RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]+)/i);
  if (m) {
    var rptShort   = m[1].toUpperCase();
    var rptCluster = m[3].toUpperCase();
    var rptAttr    = m[4].toUpperCase();
    var rptVal     = m[6];
    if (rptShort === tcState.zb.shortAddr.toUpperCase()) {
      var raw16 = parseInt(rptVal, 16);
      if (rptCluster === '0402' && rptAttr === '0000') {
        /* Temperature: signed int16 × 0.01 °C */
        if (raw16 & 0x8000) raw16 = raw16 - 0x10000;
        tcState.zb._lastTemp = raw16 * 0.01;
      }
      if (rptCluster === '0405' && rptAttr === '0000') {
        /* Humidity: uint16 × 0.01 % */
        tcState.zb._lastHum = raw16 * 0.01;
        /* RTT: recorded when both T and H received (H comes second) */
        var zbRtt = (tcState.zb.tReq > 0) ? (now - tcState.zb.tReq) : null;
        tcState.zb.rtt = zbRtt;
        tcState.zb.tReq = 0;
        if (tcState.zb._lastTemp !== undefined) {
          tcEmitData('zb', {
            key: 'zb:' + tcState.zb.shortAddr,
            shortAddr: tcState.zb.shortAddr,
            ep: tcState.zb.ep,
            title: tcState.zb.deviceName || ('Zigbee 0x' + tcState.zb.shortAddr),
            temp: tcState.zb._lastTemp,
            hum: tcState.zb._lastHum,
            rtt: zbRtt,
            ts: now
          });
          tcLog('evt', '[ZB] T=' + tcState.zb._lastTemp.toFixed(2) + '°C H=' + tcState.zb._lastHum.toFixed(2) + '%' + (zbRtt ? ' RTT=' + zbRtt + 'ms' : ''));
          tcSetStatus('zb', 'ok', 'T=' + tcState.zb._lastTemp.toFixed(1) + '°C H=' + tcState.zb._lastHum.toFixed(1) + '%');
        }
      }
    }
    return;
  }

  /* ── LoRa P2P RX (monitor widget +TEST: RXLRPKT) ───────────── */
  /* CFLR:<slot>:EVT:+TEST: RXLRPKT <len>, <rssi>, <snr>, <hexdata> */
  m = line.match(/\+TEST:\s*RXLRPKT\s+(\d+),\s*(-?\d+),\s*(-?\d+),\s*([0-9A-Fa-f]+)/i);
  if (!m) {
    /* Also handle two-line format: LEN: … then RX "hex" */
    m = line.match(/\+TEST:\s*RX\s*"([0-9A-Fa-f]+)"/i);
    if (m) { tcHandleLoraRxHex(m[1], now); }
    return;
  }
  var lrHex  = m[4].toUpperCase();
  var lrRssi = parseInt(m[2], 10);
  var lrSnr  = parseInt(m[3], 10);
  tcHandleLoraRxHex(lrHex, now, lrRssi, lrSnr);
}

function tcHandleLoraRxHex(hex, now, rssi, snr) {
  if (hex.length < 12) return; /* need ≥6 bytes */
  var nodeId = parseInt(hex.substr(0, 2), 16);
  var rxSeq  = parseInt(hex.substr(2, 2), 16);
  /* Check seq match */
  if (tcState.lr.pendingSeq !== null && rxSeq !== tcState.lr.pendingSeq) {
    tcLog('warn', '[LoRa] seq mismatch: expected ' + tcState.lr.pendingSeq + ' got ' + rxSeq);
  }
  var tHi = parseInt(hex.substr(4, 2), 16);
  var tLo = parseInt(hex.substr(6, 2), 16);
  var hHi = parseInt(hex.substr(8, 2), 16);
  var hLo = parseInt(hex.substr(10, 2), 16);
  var tRaw16 = (tHi << 8) | tLo;
  var hRaw16 = (hHi << 8) | hLo;
  if (tRaw16 & 0x8000) tRaw16 = tRaw16 - 0x10000;
  var temp = tRaw16 * 0.01;
  var hum  = hRaw16 * 0.01;
  var lrRtt = (tcState.lr.tReq > 0) ? (now - tcState.lr.tReq) : null;
  tcState.lr.rtt = lrRtt;
  tcState.lr.tReq = 0;
  tcState.lr.pendingSeq = null;
  tcEmitData('lr', {
    key: 'lr:' + tcState.lr.slot + ':' + nodeId,
    slot: tcState.lr.slot,
    nodeId: nodeId,
    title: 'LoRa Node ' + nodeId,
    temp: temp,
    hum: hum,
    rtt: lrRtt,
    rssi: rssi || null,
    snr: snr || null,
    ts: now
  });
  tcLog('evt', '[LoRa] node=' + nodeId + ' T=' + temp.toFixed(2) + '°C H=' + hum.toFixed(2) + '%' + (lrRtt ? ' RTT=' + lrRtt + 'ms' : ''));
  tcSetStatus('lr', 'ok', 'T=' + temp.toFixed(1) + '°C H=' + hum.toFixed(1) + '%');
}

/* ═══════════════════════════════════════════════════════════════════
   Cross-widget broadcast
   ═══════════════════════════════════════════════════════════════════ */
function tcEmitData(tech, payload) {
  try {
    window.dispatchEvent(new CustomEvent(TC_EVENT_NAME, {
      detail: { tech: tech, payload: payload }
    }));
  } catch (e) {}
  /* localStorage fallback */
  try {
    var existing = {};
    try { existing = JSON.parse(localStorage.getItem(TC_DATA_KEY) || '{}'); } catch (_) {}
    existing[tech] = payload;
    existing[tech].updatedAt = Date.now();
    localStorage.setItem(TC_DATA_KEY, JSON.stringify(existing));
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   BLE Actions
   ═══════════════════════════════════════════════════════════════════ */
function tcBleScan() {
  if (tcState.ble.scanBusy) {
    tcLog('warn', 'BLE scan already running');
    return;
  }
  tcBleResetScanList();
  tcState.ble.scanBusy = true;
  tcBleSetScanBusy(true);
  tcLog('info', 'BLE: scanning 5 s…');
  tcSendCFBG('SCAN', '5000', 15000, { allowAsyncTimeout: true })
    .then(function (resp) {
      tcSplitLines(resp).forEach(function (line) { tcHandleAsyncLine(line, Date.now()); });
    })
    .catch(function (e) {
      if (tcIsRpcTimeoutError(e)) {
        tcLog('warn', 'BLE scan RPC timed out — waiting for async scan results…');
        return;
      }
      tcState.ble.scanBusy = false;
      tcBleSetScanBusy(false);
    });
}

function tcBleConnect() {
  var sel = document.getElementById('tc-ble-dev');
  if (!sel || !sel.value) { tcShowToast('Select a device first'); return; }
  tcReadUiState();
  tcState.ble.aa11Handle = null;
  tcState.ble.aa12Handle = null;
  tcState.ble.cccdHandle = null;
  var mac  = sel.value;
  var name = sel.options[sel.selectedIndex].textContent;
  tcState.ble.mac  = mac;
  tcState.ble.name = name;
  tcLog('info', 'BLE: connecting ' + mac + '…');
  tcSendCFBG('CONNECT', mac, 15000)
    .then(function (resp) {
      var m = resp.match(/CONNECTED:(\d+)/);
      if (m) {
        tcState.ble.devIdx = parseInt(m[1], 10);
        tcLog('info', 'BLE: connected idx=' + tcState.ble.devIdx + ', discovering…');
        return tcSendCFBG('DISC', String(tcState.ble.devIdx), 15000);
      }
    })
    .then(function (discResp) {
      tcSplitLines(discResp).forEach(function (line) { tcHandleAsyncLine(line, Date.now()); });
      var dev = tcState.ble;
      if (dev.cccdHandle) {
        tcLog('info', 'BLE: enabling NOTIFY on CCCD=0x' + dev.cccdHandle.toString(16).toUpperCase());
        return tcSendCFBG('NOTIFY', dev.devIdx + ':0x' + dev.cccdHandle.toString(16).toUpperCase() + ':1', 10000);
      }
      throw new Error('BLE notify handle not found after DISC');
    })
    .then(function () {
      tcState.ble.connected = true;
      tcSetStatus('ble', 'ok', 'Connected — NOTIFY active');
      tcShowToast('BLE connected');
      tcSaveLocalState();
    })
    .catch(function (e) {
      tcLog('fail', 'BLE connect: ' + (e && e.message ? e.message : e));
    });
}

function tcBleSetInterval() {
  tcReadUiState();
  var inp = document.getElementById('tc-ble-interval');
  if (!inp) return;
  var ms = Math.max(100, parseInt(inp.value, 10) || 500);
  inp.value = ms;
  tcState.ble.intervalMs = ms;
  tcSaveLocalState();
  /* Write interval (uint16 LE, ms) to AA12 characteristic */
  var dev = tcState.ble;
  if (!dev.connected || dev.devIdx === null) {
    tcLog('warn', 'BLE not connected — interval saved locally');
    return;
  }
  if (!dev.aa12Handle) {
    tcLog('warn', 'BLE AA12 handle not found — reconnect to discover');
    return;
  }
  /* Encode ms as uint16 LE hex */
  var hi = (ms >> 8) & 0xFF;
  var lo = ms & 0xFF;
  var hexVal = (lo < 16 ? '0' : '') + lo.toString(16).toUpperCase() +
               (hi < 16 ? '0' : '') + hi.toString(16).toUpperCase();
  tcSendCFBG('WRITE', dev.devIdx + ':0x' + dev.aa12Handle.toString(16).toUpperCase() + ':' + hexVal, 8000)
    .then(function () { tcLog('info', 'BLE interval set to ' + ms + ' ms'); })
    .catch(function () {});
}

function tcBleResetScanList() {
  var sel = document.getElementById('tc-ble-dev');
  if (!sel) return;
  sel.innerHTML = '<option value="">— scan first —</option>';
}

function tcBleAddScanResult(idx, mac, rssi, name) {
  var sel = document.getElementById('tc-ble-dev');
  if (!sel) return;
  var normalizedMac = String(mac || '').toLowerCase();
  var option = null;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === normalizedMac) {
      option = sel.options[i];
      break;
    }
  }
  if (!option) {
    option = document.createElement('option');
    option.value = normalizedMac;
    sel.appendChild(option);
  }
  option.dataset.idx = String(idx);
  option.textContent = (name || ('Device_' + idx)) + ' (' + rssi + ' dBm)';
}

function tcBleSetScanBusy(isBusy) {
  var btn = document.getElementById('tc-ble-scan');
  if (btn) btn.disabled = !!isBusy;
}

function tcIsRpcTimeoutError(e) {
  var s = String(e && e.message ? e.message : e || '');
  return s.indexOf('504') >= 0 || s.indexOf('Http failure response') >= 0;
}

/* ═══════════════════════════════════════════════════════════════════
   Zigbee Actions
   ═══════════════════════════════════════════════════════════════════ */
function tcZbNetStart() {
  tcReadUiState();
  tcLog('info', 'ZB: starting network…');
  tcSendCFZB('MODULE_START_NETWORK', null, 15000)
    .then(function () {
      tcState.zb.netUp = true;
      tcSetStatus('zb', 'ok', 'Network up');
      tcShowToast('Zigbee network started');
      return tcEnsureCoordinatorIeee().catch(function (e) {
        tcLog('warn', '[ZB] Coordinator IEEE still unavailable: ' + (e && e.message ? e.message : e));
      });
    })
    .catch(function () {});
}

function tcZbPermitJoin() {
  tcReadUiState();
  tcLog('info', 'ZB: permit join 60 s…');
  tcSendCFZB('MODULE_SET_PERMIT_JOIN', '60', 10000)
    .then(function () { tcLog('info', 'ZB: permit join active'); })
    .catch(function () {});
}

function tcZbVerifyNode() {
  tcReadUiState();
  var addr = tcState.zb.shortAddr.trim().toUpperCase();
  var ep = tcState.zb.ep.trim().toUpperCase() || '0B';
  if (!addr) {
    tcShowToast('Set or auto-detect Zigbee short address first');
    tcRefreshZbStatus();
    return;
  }
  
  var code = Math.floor(Math.random() * 10000) + 50000;
  tcState.zb.verifyCode = code;
  
  tcState.zb.awaitingVerify = true;
  tcState.zb.verified = false;
  tcState.zb.reportConfigured = false;
  tcLog('info', '[ZB] Send Verify Code ' + code + ' to 0x' + addr + ' (IdentifyTime)…');
  tcSetStatus('zb', 'warn', 'Verify sent for 0x' + addr + ' — waiting auth');
  
  var writeBytes = [code & 0xFF, (code >> 8) & 0xFF];
  var writeHex = tcBytesToHexStr(tcBuildZclWriteAttrFrame(parseInt(addr, 16), parseInt(ep, 16), 0x0003, '0000', 0x21, writeBytes));
  var readHex = tcBytesToHexStr(tcBuildZclReadAttrFrame(parseInt(addr, 16), parseInt(ep, 16), 0x0003, '0000'));
  
  tcSendCFZB('MODULE_ZCL_WRITE_ATTR', writeHex, 8000)
    .then(function () {
      tcLog('info', '[ZB] Verify Code sent, reading back to verify…');
      setTimeout(function() {
        tcSendCFZB('MODULE_ZCL_READ_ATTR', readHex, 8000)
          .catch(function(e) {
            tcState.zb.awaitingVerify = false;
            tcLog('fail', '[ZB] Verify Read failed: ' + (e && e.message ? e.message : e));
          });
      }, 500);
    })
    .catch(function (e) {
      tcState.zb.awaitingVerify = false;
      tcLog('fail', '[ZB] Verify Write failed: ' + (e && e.message ? e.message : e));
      tcSetStatus('zb', 'fail', 'Verify RPC failed');
    });
}

function tcZbSetupPush() {
  tcReadUiState();
  var addr = tcState.zb.shortAddr.trim().toUpperCase();
  var ep = tcState.zb.ep.trim().toUpperCase() || '0B';
  var intervalMs = parseInt(document.getElementById('tc-zb-interval').value) || 1000;
  if (!addr) {
    tcShowToast('Set or auto-detect Zigbee short address first');
    return;
  }
  if (!tcState.zb.verified) {
    tcShowToast('Verify node first');
    tcRefreshZbStatus();
    return;
  }
  if (!tcState.zb.targetIeee) {
    tcShowToast('Waiting for Zigbee node IEEE from join/announce');
    tcRefreshZbStatus();
    return;
  }
  
  if (intervalMs < 100) intervalMs = 100;
  if (intervalMs > 30000) intervalMs = 30000;
  
  tcState.zb.bindReady = false;
  tcState.zb.bindFailed = false;
  tcState.zb.bindFailureReason = '';
  tcState.zb.bindTarget = '';
  tcState.zb.reportConfigured = false;
  tcLog('info', '[ZB] Setup push for 0x' + addr + ' @ ' + intervalMs + ' ms via direct bind…');
  tcSetStatus('zb', 'warn', 'Resolving coordinator IEEE and configuring push…');
  
  tcEnsureCoordinatorIeee()
    .then(function () {
      tcSetStatus('zb', 'warn', 'Binding sensor to coordinator and configuring push…');
      var tempBindHex = tcBytesToHexStr(tcBuildZclBindFrame(parseInt(addr, 16), tcState.zb.targetIeee, parseInt(ep, 16), 0x0402, tcState.zb.coordinatorIeee, 0x01));
      var humBindHex = tcBytesToHexStr(tcBuildZclBindFrame(parseInt(addr, 16), tcState.zb.targetIeee, parseInt(ep, 16), 0x0405, tcState.zb.coordinatorIeee, 0x01));
      return tcSendCFZB('MODULE_ZCL_BIND', tempBindHex, 10000)
        .then(function () { return tcSendCFZB('MODULE_ZCL_BIND', humBindHex, 10000); });
    })
    .then(function () {
      tcState.zb.bindReady = true;
      tcState.zb.bindTarget = addr;
      // 1. ZCL Configure Reporting: Min=0, Max=0xFFFE, Change=0 to report on EVERY sensor update
      var tempHex = tcBytesToHexStr(tcBuildZclConfigureReportingFrame(parseInt(addr, 16), parseInt(ep, 16), 0x0402, '0000', 0x29, 0, 0xFFFE, 0));
      var humHex = tcBytesToHexStr(tcBuildZclConfigureReportingFrame(parseInt(addr, 16), parseInt(ep, 16), 0x0405, '0000', 0x21, 0, 0xFFFE, 0));
      // 2. Write intervalMs to IdentifyTime (0003/0000) so node updates its internal loop
      var intBytes = [intervalMs & 0xFF, (intervalMs >> 8) & 0xFF];
      var writeIntHex = tcBytesToHexStr(tcBuildZclWriteAttrFrame(parseInt(addr, 16), parseInt(ep, 16), 0x0003, '0000', 0x21, intBytes));
      
      return tcSendCFZB('MODULE_ZCL_SET_REPORT_RULE', tempHex, 10000)
        .then(function () { return tcSendCFZB('MODULE_ZCL_SET_REPORT_RULE', humHex, 10000); })
        .then(function () { return tcSendCFZB('MODULE_ZCL_WRITE_ATTR', writeIntHex, 10000); });
    })
    .then(function () {
      tcState.zb.reportConfigured = true;
      tcLog('info', '[ZB] Push armed @ ' + intervalMs + ' ms for 0x' + addr);
      tcRefreshZbStatus();
      tcShowToast('Push setup complete ✓');
    })
    .catch(function (e) {
      tcState.zb.reportConfigured = false;
      tcLog('fail', '[ZB] Setup push failed: ' + (e && e.message ? e.message : e));
      tcSetStatus('zb', 'fail', 'Setup push failed: ' + (tcState.zb.bindFailureReason || (e && e.message ? e.message : e)));
    });
}

/* One READ_ATTR poll: build Ebyte ZCL Read Attribute frames like the working Zigbee widget */
function tcZbPollOnce() {
  tcRefreshZbStatus();
  return Promise.resolve();
}

/* ═══════════════════════════════════════════════════════════════════
   LoRa Actions
   ═══════════════════════════════════════════════════════════════════ */
function tcLrSetupTestMode() {
  tcReadUiState();
  tcLog('info', 'LoRa: entering P2P TEST mode…');
  /* Set module to TEST mode, apply RF config, then arm RX */
  tcSendCFLR('MODULE_ENTER_P2P_MODE', null, 15000)
    .then(function () {
      return tcSendCFLR('MODULE_SET_P2P_CONFIG', tcState.lr.rfConfig, 8000);
    })
    .then(function () {
      return tcSendCFLR('MODULE_ENTER_P2P_RX', null, 8000);
    })
    .then(function () {
      tcState.lr.configured = true;
      tcSetStatus('lr', 'ok', 'P2P mode — RX ready');
      tcShowToast('LoRa P2P configured');
    })
    .catch(function (e) {
      tcLog('fail', 'LoRa setup: ' + (e && e.message ? e.message : e));
    });
}

/* One LoRa poll: TX_MODE → SEND request → RX_MODE → wait RXLRPKT via telemetry */
function tcLrPollOnce() {
  tcReadUiState();
  if (!tcState.lr.configured) {
    tcSetStatus('lr', 'warn', 'P2P not configured');
    return Promise.resolve();
  }
  var seq = (tcState.lr.seq + 1) & 0xFF;
  tcState.lr.seq = seq;
  tcState.lr.pendingSeq = seq;
  var reqHex = 'AA' + (seq < 16 ? '0' : '') + seq.toString(16).toUpperCase();
  var reqPayload = '"' + reqHex + '"';
  tcState.lr.tReq = Date.now();

  return tcSendCFLR('MODULE_SEND_P2P_PKT', reqPayload, 8000)
    .then(function () { return tcSendCFLR('MODULE_ENTER_P2P_RX', null, 5000); })
    .then(function () {
      tcLog('info', '[LoRa] request sent seq=' + seq + ', waiting RX…');
      /* RTT timeout: if no RXLRPKT arrives within rttTimeoutMs, clear pending */
      var capturedSeq = seq;
      setTimeout(function () {
        if (tcState.lr.pendingSeq === capturedSeq) {
          tcState.lr.pendingSeq = null;
          tcState.lr.tReq = 0;
          tcLog('warn', '[LoRa] RX timeout (seq=' + capturedSeq + ')');
          tcSetStatus('lr', 'warn', 'RX timeout');
        }
      }, tcState.lr.rttTimeoutMs);
    })
    .catch(function (e) {
      tcState.lr.pendingSeq = null;
      tcLog('fail', 'LoRa poll: ' + (e && e.message ? e.message : e));
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Poll Scheduler — sequential round-robin
   ═══════════════════════════════════════════════════════════════════ */
function tcStartPolling() {
  if (tcState.polling) return;
  tcReadUiState();
  tcSaveLocalState();
  var anyEnabled = tcState.ble.enabled || tcState.lr.enabled;
  if (!anyEnabled) {
    tcShowToast('Enable BLE or LoRa polling. Zigbee now uses Verify + Setup Push.');
    return;
  }
  tcState.polling = true;
  tcState.techIdx  = 0;
  tcSetPill('polling', 'Polling');
  document.getElementById('tc-btn-start').disabled = true;
  document.getElementById('tc-btn-stop').disabled  = false;
  tcLog('info', 'Polling started');
  tcSchedTick();
}

function tcStopPolling() {
  tcState.polling = false;
  if (tcState.schedTimer) { clearTimeout(tcState.schedTimer); tcState.schedTimer = null; }
  tcSetPill('idle', 'Idle');
  var btnStart = document.getElementById('tc-btn-start');
  var btnStop  = document.getElementById('tc-btn-stop');
  if (btnStart) btnStart.disabled = false;
  if (btnStop)  btnStop.disabled  = true;
  tcLog('info', 'Polling stopped');
  tcSetSchedInfo('Stopped');
}

function tcSchedTick() {
  if (!tcState.polling) return;
  var order = tcState.techOrder;
  /* Find next enabled tech */
  var startIdx = tcState.techIdx;
  var found    = false;
  for (var i = 0; i < order.length; i++) {
    var idx  = (startIdx + i) % order.length;
    var tech = order[idx];
    if (tcCanScheduleTech(tech)) {
      tcState.techIdx = (idx + 1) % order.length; /* advance for next tick */
      found = true;
      var intervalMs = Math.max(100, tcState[tech].intervalMs || 1000);
      var tickStartedAt = Date.now();
      tcSetSchedInfo('Polling ' + tech.toUpperCase() + ' (target ' + intervalMs + ' ms)…');
      tcRunPollForTech(tech)
        .then(function () {
          if (!tcState.polling) return;
          var delayMs = intervalMs - (Date.now() - tickStartedAt);
          if (delayMs < 0) delayMs = 0;
          tcState.schedTimer = setTimeout(tcSchedTick, delayMs);
        });
      break;
    }
  }
  if (!found) {
    tcLog('warn', 'No runnable technologies — stopping');
    tcStopPolling();
  }
}

function tcCanScheduleTech(tech) {
  if (!tcState[tech] || !tcState[tech].enabled) return false;
  if (tech === 'ble') return !!tcState.ble.connected;
  if (tech === 'lr') return !!tcState.lr.configured;
  if (tech === 'zb') return false;
  return true;
}

function tcRunPollForTech(tech) {
  if (tech === 'ble') {
    /* BLE: record tReq (for RTT of next NOTIFY), NOTIFY is passive */
    tcState.ble.tReq = Date.now();
    return Promise.resolve();
  }
  if (tech === 'zb')  { return tcZbPollOnce(); }
  if (tech === 'lr')  { return tcLrPollOnce(); }
  return Promise.resolve();
}

/* ═══════════════════════════════════════════════════════════════════
   UI helpers
   ═══════════════════════════════════════════════════════════════════ */
function tcToggleTech(tech, enabled) {
  tcReadUiState();
  tcState[tech].enabled = enabled;
  tcRefreshTechCards();
  tcSaveLocalState();
  tcLog('info', tech.toUpperCase() + ' ' + (enabled ? 'enabled' : 'disabled'));
}

function tcOnSlotChange(val) {
  tcReadUiState();
  tcSaveLocalState();
  tcLog('info', 'Stack selection updated');
}

function tcSetPill(state, text) {
  var pill = document.getElementById('tc-pill');
  var txt  = document.getElementById('tc-pill-txt');
  if (pill) pill.setAttribute('data-state', state);
  if (txt)  txt.textContent = text;
}

function tcSetStatus(tech, cls, msg) {
  var map = { gw: 'tc-gw-status', ble: 'tc-ble-status', zb: 'tc-zb-status', lr: 'tc-lr-status' };
  var el = document.getElementById(map[tech]);
  if (!el) return;
  el.className = 'tc-status-row ' + (cls || '');
  el.textContent = msg;
}

function tcSetSchedInfo(msg) {
  var el = document.getElementById('tc-sched-info');
  if (el) el.textContent = msg;
}

function tcSyncUI() {
  /* restore interval inputs */
  var bleInt = document.getElementById('tc-ble-interval');
  if (bleInt) bleInt.value = tcState.ble.intervalMs;
  var zbSlot = document.getElementById('tc-zb-slot');
  if (zbSlot) zbSlot.value = tcState.zb.slot;
  var zbInt = document.getElementById('tc-zb-interval');
  if (zbInt) zbInt.value = tcState.zb.intervalMs;
  var zbAddr = document.getElementById('tc-zb-addr');
  if (zbAddr) zbAddr.value = tcState.zb.shortAddr;
  var zbEp = document.getElementById('tc-zb-ep');
  if (zbEp) zbEp.value = tcState.zb.ep;
  var lrInt = document.getElementById('tc-lr-interval');
  if (lrInt) lrInt.value = tcState.lr.intervalMs;
  var lrSlot = document.getElementById('tc-lr-slot');
  if (lrSlot) lrSlot.value = tcState.lr.slot;
  var lrTo = document.getElementById('tc-lr-rtt-to');
  if (lrTo) lrTo.value = tcState.lr.rttTimeoutMs;
  tcSyncGatewayUi();
  /* toggle switches */
  var bleEn = document.getElementById('tc-ble-en');
  if (bleEn) bleEn.checked = tcState.ble.enabled;
  var zbEn = document.getElementById('tc-zb-en');
  if (zbEn) zbEn.checked = tcState.zb.enabled;
  var lrEn = document.getElementById('tc-lr-en');
  if (lrEn) lrEn.checked = tcState.lr.enabled;
  tcRefreshTechCards();
  tcRefreshZbStatus();
}

function tcBindInputs() {
  var ids = [
    'tc-ble-interval', 'tc-zb-slot', 'tc-zb-addr', 'tc-zb-ep', 'tc-zb-interval', 'tc-lr-slot', 'tc-lr-interval', 'tc-lr-rtt-to',
    'tc-gw-inet-type', 'tc-gw-inet-fallback', 'tc-gw-wifi-ssid', 'tc-gw-wifi-pwd', 'tc-gw-wifi-auth', 'tc-gw-wifi-user',
    'tc-gw-lte-apn', 'tc-gw-lte-user', 'tc-gw-lte-pwd', 'tc-gw-server-type', 'tc-gw-mq-broker', 'tc-gw-mq-token',
    'tc-gw-hp-url', 'tc-gw-hp-token', 'tc-gw-hp-tls', 'tc-gw-cp-host', 'tc-gw-cp-resource', 'tc-gw-cp-token',
    'tc-gw-lan-url', 'tc-gw-wan-url'
  ];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (!el || el.getAttribute('data-tc-bound') === '1') continue;
    el.setAttribute('data-tc-bound', '1');
    el.addEventListener('change', tcOnConfigInputChange);
    el.addEventListener('input', tcOnConfigInputChange);
  }
}

function tcBindActions() {
  var actions = [
    { id: 'tc-ble-en', type: 'change', fn: function (e) { tcToggleTech('ble', !!e.target.checked); } },
    { id: 'tc-zb-en', type: 'change', fn: function (e) { tcToggleTech('zb', !!e.target.checked); } },
    { id: 'tc-lr-en', type: 'change', fn: function (e) { tcToggleTech('lr', !!e.target.checked); } },
    { id: 'tc-ble-scan', type: 'click', fn: tcBleScan },
    { id: 'tc-ble-dev', type: 'change', fn: function () { tcReadUiState(); } },
    { id: 'tc-ble-conn-btn', type: 'click', fn: tcBleConnect },
    { id: 'tc-ble-set-interval', type: 'click', fn: tcBleSetInterval },
    { id: 'tc-zb-net-start', type: 'click', fn: tcZbNetStart },
    { id: 'tc-zb-permit-join', type: 'click', fn: tcZbPermitJoin },
    { id: 'tc-zb-verify', type: 'click', fn: tcZbVerifyNode },
    { id: 'tc-zb-setup-push', type: 'click', fn: tcZbSetupPush },
    { id: 'tc-lr-setup', type: 'click', fn: tcLrSetupTestMode },
    { id: 'tc-gw-inet-type', type: 'change', fn: tcGwRefreshModes },
    { id: 'tc-gw-wifi-auth', type: 'change', fn: tcGwRefreshModes },
    { id: 'tc-gw-server-type', type: 'change', fn: tcGwRefreshModes },
    { id: 'tc-gw-set-internet', type: 'click', fn: tcGwSetInternetConfig },
    { id: 'tc-gw-set-server', type: 'click', fn: tcGwSetServerConfig },
    { id: 'tc-gw-save-lan-url', type: 'click', fn: tcGwSaveLanUrl },
    { id: 'tc-gw-save-wan-url', type: 'click', fn: tcGwSaveWanUrl },
    { id: 'tc-gw-fota', type: 'click', fn: tcGwTriggerLanFota },
    { id: 'tc-btn-start', type: 'click', fn: tcStartPolling },
    { id: 'tc-btn-stop', type: 'click', fn: tcStopPolling },
    { id: 'tc-btn-clear', type: 'click', fn: tcClearLog }
  ];
  for (var i = 0; i < actions.length; i++) {
    var item = actions[i];
    var el = document.getElementById(item.id);
    if (!el || el.getAttribute('data-tc-action-bound') === '1') continue;
    el.setAttribute('data-tc-action-bound', '1');
    el.addEventListener(item.type, item.fn);
  }
}

function tcOnConfigInputChange() {
  if (this && (this.id === 'tc-zb-addr' || this.id === 'tc-zb-ep')) {
    tcState.zb.autoSelected = false;
    tcResetZbSession('manual target edit');
  }
  tcReadUiState();
  if (this && this.id === 'tc-zb-interval' && tcState.zb.reportConfigured) {
    tcSetStatus('zb', 'warn', 'Interval changed — click Setup Push to apply');
  }
  tcSaveLocalState();
}

function tcReadUiState() {
  var bleInt = document.getElementById('tc-ble-interval');
  if (bleInt) {
    tcState.ble.intervalMs = Math.max(100, parseInt(bleInt.value, 10) || tcState.ble.intervalMs || 500);
    bleInt.value = tcState.ble.intervalMs;
  }

  tcState.ble.slot = '0';

  var zbSlot = document.getElementById('tc-zb-slot');
  if (zbSlot) {
    tcState.zb.slot = zbSlot.value === '1' ? '1' : '0';
    zbSlot.value = tcState.zb.slot;
  }

  var zbAddr = document.getElementById('tc-zb-addr');
  if (zbAddr) {
    tcState.zb.shortAddr = String(zbAddr.value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase().substr(0, 4);
    zbAddr.value = tcState.zb.shortAddr;
  }

  var zbEp = document.getElementById('tc-zb-ep');
  if (zbEp) {
    tcState.zb.ep = String(zbEp.value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase().substr(0, 2) || '0B';
    zbEp.value = tcState.zb.ep;
  }

  var zbInt = document.getElementById('tc-zb-interval');
  if (zbInt) {
    tcState.zb.intervalMs = Math.max(100, parseInt(zbInt.value, 10) || tcState.zb.intervalMs || 1000);
    zbInt.value = tcState.zb.intervalMs;
  }

  var lrInt = document.getElementById('tc-lr-interval');
  if (lrInt) {
    tcState.lr.intervalMs = Math.max(100, parseInt(lrInt.value, 10) || tcState.lr.intervalMs || 2000);
    lrInt.value = tcState.lr.intervalMs;
  }

  var lrSlot = document.getElementById('tc-lr-slot');
  if (lrSlot) {
    tcState.lr.slot = lrSlot.value === '1' ? '1' : '0';
    lrSlot.value = tcState.lr.slot;
  }

  var lrTo = document.getElementById('tc-lr-rtt-to');
  if (lrTo) {
    tcState.lr.rttTimeoutMs = Math.max(500, parseInt(lrTo.value, 10) || tcState.lr.rttTimeoutMs || 5000);
    lrTo.value = tcState.lr.rttTimeoutMs;
  }

  tcReadGatewayUiState();
}

function tcRefreshTechCards() {
  var cards = [
    { id: 'tc-ble-card', enabled: tcState.ble.enabled },
    { id: 'tc-zb-card', enabled: tcState.zb.enabled },
    { id: 'tc-lr-card', enabled: tcState.lr.enabled }
  ];
  for (var i = 0; i < cards.length; i++) {
    var card = document.getElementById(cards[i].id);
    if (!card) continue;
    card.setAttribute('data-enabled', cards[i].enabled ? 'true' : 'false');
  }
}

function tcSyncGatewayUi() {
  tcSetInputValue('tc-gw-inet-type', tcState.gw.internetType);
  tcSetCheckboxValue('tc-gw-inet-fallback', tcState.gw.fallback);
  tcSetInputValue('tc-gw-wifi-ssid', tcState.gw.wifiSsid);
  tcSetInputValue('tc-gw-wifi-pwd', tcState.gw.wifiPwd);
  tcSetInputValue('tc-gw-wifi-auth', tcState.gw.wifiAuth);
  tcSetInputValue('tc-gw-wifi-user', tcState.gw.wifiUser);
  tcSetInputValue('tc-gw-lte-apn', tcState.gw.lteApn);
  tcSetInputValue('tc-gw-lte-user', tcState.gw.lteUser);
  tcSetInputValue('tc-gw-lte-pwd', tcState.gw.ltePwd);
  tcSetInputValue('tc-gw-server-type', tcState.gw.serverType);
  tcSetInputValue('tc-gw-mq-broker', tcState.gw.mqBroker);
  tcSetInputValue('tc-gw-mq-token', tcState.gw.mqToken);
  tcSetInputValue('tc-gw-hp-url', tcState.gw.hpUrl);
  tcSetInputValue('tc-gw-hp-token', tcState.gw.hpToken);
  tcSetCheckboxValue('tc-gw-hp-tls', tcState.gw.hpTls);
  tcSetInputValue('tc-gw-cp-host', tcState.gw.cpHost);
  tcSetInputValue('tc-gw-cp-resource', tcState.gw.cpResource);
  tcSetInputValue('tc-gw-cp-token', tcState.gw.cpToken);
  tcSetInputValue('tc-gw-lan-url', tcState.gw.lanUrl);
  tcSetInputValue('tc-gw-wan-url', tcState.gw.wanUrl);
  tcGwRefreshModes();
  tcSetStatus('gw', 'info', tcState.gw.lastStatus || 'Gateway config ready');
}

function tcReadGatewayUiState() {
  tcState.gw.internetType = tcGetValue('tc-gw-inet-type') || 'WiFi';
  tcState.gw.fallback = tcGetChecked('tc-gw-inet-fallback');
  tcState.gw.wifiSsid = tcGetValue('tc-gw-wifi-ssid');
  tcState.gw.wifiPwd = tcGetValue('tc-gw-wifi-pwd');
  tcState.gw.wifiAuth = tcGetValue('tc-gw-wifi-auth') || 'PERSONAL';
  tcState.gw.wifiUser = tcGetValue('tc-gw-wifi-user');
  tcState.gw.lteApn = tcGetValue('tc-gw-lte-apn') || 'm-wap';
  tcState.gw.lteUser = tcGetValue('tc-gw-lte-user');
  tcState.gw.ltePwd = tcGetValue('tc-gw-lte-pwd');
  tcState.gw.serverType = tcGetValue('tc-gw-server-type') || 'MQTT';
  tcState.gw.mqBroker = tcGetValue('tc-gw-mq-broker') || 'mqtt.thingsboard.cloud';
  tcState.gw.mqToken = tcGetValue('tc-gw-mq-token');
  tcState.gw.hpUrl = tcGetValue('tc-gw-hp-url') || 'http://server:8080/api/v1/{token}/telemetry';
  tcState.gw.hpToken = tcGetValue('tc-gw-hp-token');
  tcState.gw.hpTls = tcGetChecked('tc-gw-hp-tls');
  tcState.gw.cpHost = tcGetValue('tc-gw-cp-host') || 'demo.thingsboard.io';
  tcState.gw.cpResource = tcGetValue('tc-gw-cp-resource') || '/api/v1/{token}/telemetry';
  tcState.gw.cpToken = tcGetValue('tc-gw-cp-token');
  tcState.gw.lanUrl = tcGetValue('tc-gw-lan-url');
  tcState.gw.wanUrl = tcGetValue('tc-gw-wan-url');
}

function tcGwApplyDefaultUrls() {
  if (!tcState.gw.lanUrl) {
    tcState.gw.lanUrl = 'http://192.168.1.100:8080/api/v1/TOKEN/firmware?title=DA2_esp_LAN&version=' + CURRENT_FW_VERSION;
  }
  if (!tcState.gw.wanUrl) {
    tcState.gw.wanUrl = 'http://192.168.1.100:8080/api/v1/TOKEN/firmware?title=DA2_esp&version=' + CURRENT_FW_VERSION;
  }
}

function tcGwRefreshModes() {
  tcReadGatewayUiState();
  tcSetHidden('tc-gw-wifi-box', tcState.gw.internetType !== 'WiFi');
  tcSetHidden('tc-gw-lte-box', tcState.gw.internetType !== 'LTE');
  tcSetHidden('tc-gw-eth-box', tcState.gw.internetType !== 'Ethernet');
  tcSetHidden('tc-gw-wifi-user', tcState.gw.wifiAuth !== 'ENTERPRISE');
  tcSetHidden('tc-gw-mqtt-box', tcState.gw.serverType !== 'MQTT');
  tcSetHidden('tc-gw-http-box', tcState.gw.serverType !== 'HTTP/HTTPS');
  tcSetHidden('tc-gw-coap-box', tcState.gw.serverType !== 'CoAP');
}

function tcGwComputeFallback(primary) {
  if (!tcState.gw.fallback) return null;
  if (primary === 'LTE' || primary === 'ETHERNET') return 'WIFI';
  return tcState.gw.lteApn ? 'LTE' : 'ETHERNET';
}

function tcGwSendCommand(cmd) {
  tcLog('tx', '[GW] ' + cmd);
  return tcSendRpc('sendCommand', tcStrToHex(cmd), tcState.rpcTimeout)
    .then(function (resp) {
      var decoded = tcDecodeHex(resp);
      tcSplitLines(decoded).forEach(function (line) {
        tcLog('rx', line);
        tcDispatchLine(line, Date.now());
      });
      return decoded;
    })
    .catch(function (e) {
      tcLog('fail', '[GW] ' + (e && e.message ? e.message : e));
      throw e;
    });
}

function tcGwSetInternetConfig() {
  tcReadUiState();
  var itype = tcState.gw.internetType;
  var primary = itype.toUpperCase() === 'WIFI' ? 'WIFI' : itype.toUpperCase();
  var fallback = tcGwComputeFallback(primary);
  var cfin = tcState.gw.fallback ? ('CFIN:' + primary + ':1:' + fallback) : ('CFIN:' + primary + ':0');

  if (itype === 'WiFi') {
    if (!tcState.gw.wifiSsid) {
      tcSetStatus('gw', 'fail', 'WiFi SSID is required');
      return;
    }
    if (tcState.gw.wifiAuth === 'ENTERPRISE' && !tcState.gw.wifiUser) {
      tcSetStatus('gw', 'fail', 'WiFi username is required for ENTERPRISE');
      return;
    }
    var cfwf = tcState.gw.wifiAuth === 'ENTERPRISE'
      ? ('CFWF:' + tcState.gw.wifiSsid + ':' + tcState.gw.wifiPwd + ':' + tcState.gw.wifiUser + ':ENTERPRISE')
      : ('CFWF:' + tcState.gw.wifiSsid + ':' + tcState.gw.wifiPwd + ':PERSONAL');
    tcGwSendCommand(cfwf)
      .then(function () { return tcGwSendCommand(cfin); })
      .then(function () { tcGwUpdateSummary('internet', 'WiFi applied'); })
      .catch(function (e) { tcSetStatus('gw', 'fail', 'Internet apply failed: ' + (e.message || e)); });
    return;
  }

  if (itype === 'LTE') {
    var cflt = 'CFLT::' + (tcState.gw.lteApn || 'm-wap') + ':' + tcState.gw.lteUser + ':' + tcState.gw.ltePwd + ':USB:true:30000:0:05:06';
    tcGwSendCommand(cflt)
      .then(function () { return tcGwSendCommand(cfin); })
      .then(function () { tcGwUpdateSummary('internet', 'LTE applied'); })
      .catch(function (e) { tcSetStatus('gw', 'fail', 'Internet apply failed: ' + (e.message || e)); });
    return;
  }

  tcGwSendCommand(cfin)
    .then(function () { tcGwUpdateSummary('internet', 'Ethernet applied'); })
    .catch(function (e) { tcSetStatus('gw', 'fail', 'Internet apply failed: ' + (e.message || e)); });
}

function tcGwSetServerConfig() {
  tcReadUiState();
  var type = tcState.gw.serverType;

  if (type === 'MQTT') {
    if (!tcState.gw.mqBroker) {
      tcSetStatus('gw', 'fail', 'MQTT broker is required');
      return;
    }
    var cfsv = 'CFSV:0';
    var cfmq = 'CFMQ:' + tcState.gw.mqBroker + '|' + tcState.gw.mqToken + '|v1/devices/me/rpc/request/+|v1/devices/me/telemetry|v1/devices/me/attributes|0|0';
    tcGwSendCommand(cfsv)
      .then(function () { return tcGwSendCommand(cfmq); })
      .then(function () { tcGwUpdateSummary('server', 'MQTT applied'); })
      .catch(function (e) { tcSetStatus('gw', 'fail', 'Server apply failed: ' + (e.message || e)); });
    return;
  }

  if (type === 'HTTP/HTTPS') {
    if (!tcState.gw.hpUrl) {
      tcSetStatus('gw', 'fail', 'HTTP URL is required');
      return;
    }
    var cfsvHttp = 'CFSV:2';
    var cfhp = 'CFHP:' + tcState.gw.hpUrl + '|' + tcState.gw.hpToken + '|8080|' + (tcState.gw.hpTls ? 1 : 0) + '|0|10000';
    tcGwSendCommand(cfsvHttp)
      .then(function () { return tcGwSendCommand(cfhp); })
      .then(function () { tcGwUpdateSummary('server', 'HTTP/HTTPS applied'); })
      .catch(function (e) { tcSetStatus('gw', 'fail', 'Server apply failed: ' + (e.message || e)); });
    return;
  }

  if (!tcState.gw.cpHost) {
    tcSetStatus('gw', 'fail', 'CoAP host is required');
    return;
  }
  var cfsvCoap = 'CFSV:1';
  var cfcp = 'CFCP:' + tcState.gw.cpHost + '|' + tcState.gw.cpResource + '|' + tcState.gw.cpToken + '|5683|0|2000|4|1500';
  tcGwSendCommand(cfsvCoap)
    .then(function () { return tcGwSendCommand(cfcp); })
    .then(function () { tcGwUpdateSummary('server', 'CoAP applied'); })
    .catch(function (e) { tcSetStatus('gw', 'fail', 'Server apply failed: ' + (e.message || e)); });
}

function tcGwSaveLanUrl() {
  tcReadUiState();
  if (!tcState.gw.lanUrl) {
    tcSetStatus('gw', 'fail', 'LAN URL is required');
    return;
  }
  tcGwSendCommand('CFML:CFFU:' + tcState.gw.lanUrl)
    .then(function () { tcGwUpdateSummary('firmware', 'LAN URL saved'); })
    .catch(function (e) { tcSetStatus('gw', 'fail', 'Save LAN URL failed: ' + (e.message || e)); });
}

function tcGwSaveWanUrl() {
  tcReadUiState();
  if (!tcState.gw.wanUrl) {
    tcSetStatus('gw', 'fail', 'WAN URL is required');
    return;
  }
  tcGwSendCommand('CFFU:' + tcState.gw.wanUrl)
    .then(function () { tcGwUpdateSummary('firmware', 'WAN URL saved'); })
    .catch(function (e) { tcSetStatus('gw', 'fail', 'Save WAN URL failed: ' + (e.message || e)); });
}

function tcGwTriggerLanFota() {
  tcGwSendCommand('CFML:CFFW')
    .then(function () { tcGwUpdateSummary('firmware', 'LAN FOTA trigger sent'); })
    .catch(function (e) { tcSetStatus('gw', 'fail', 'FOTA trigger failed: ' + (e.message || e)); });
}

function tcGwUpdateSummary(action, status) {
  tcState.gw.lastAction = action;
  tcState.gw.lastStatus = status;
  tcSetStatus('gw', 'ok', status);
  tcEmitData('gw', {
    action: action,
    status: status,
    internetType: tcState.gw.internetType,
    serverType: tcState.gw.serverType,
    lanUrl: tcState.gw.lanUrl,
    wanUrl: tcState.gw.wanUrl,
    ts: Date.now(),
    title: 'Gateway'
  });
  tcSaveLocalState();
}

function tcSetHidden(id, hidden) {
  var el = document.getElementById(id);
  if (!el) return;
  if (hidden) el.classList.add('hidden');
  else el.classList.remove('hidden');
}

function tcSetInputValue(id, value) {
  var el = document.getElementById(id);
  if (el && el.value !== undefined) el.value = value == null ? '' : value;
}

function tcSetCheckboxValue(id, checked) {
  var el = document.getElementById(id);
  if (el) el.checked = !!checked;
}

function tcGetValue(id) {
  var el = document.getElementById(id);
  return el && el.value !== undefined ? String(el.value || '').trim() : '';
}

function tcGetChecked(id) {
  var el = document.getElementById(id);
  return !!(el && el.checked);
}

/* ═══════════════════════════════════════════════════════════════════
   LocalStorage persistence
   ═══════════════════════════════════════════════════════════════════ */
var TC_LS_KEY = 'da2_total_app_ctrl_v1';

function tcSaveLocalState() {
  try {
    var saved = {
      ble: { slot: tcState.ble.slot, enabled: tcState.ble.enabled, intervalMs: tcState.ble.intervalMs },
      zb:  { slot: tcState.zb.slot, enabled: tcState.zb.enabled, shortAddr: tcState.zb.shortAddr, targetIeee: tcState.zb.targetIeee, coordinatorIeee: tcState.zb.coordinatorIeee, ep: tcState.zb.ep, intervalMs: tcState.zb.intervalMs },
      lr:  { slot: tcState.lr.slot, enabled: tcState.lr.enabled, intervalMs: tcState.lr.intervalMs, rttTimeoutMs: tcState.lr.rttTimeoutMs },
      gw:  tcState.gw
    };
    localStorage.setItem(TC_LS_KEY, JSON.stringify(saved));
  } catch (e) {}
}

function tcLoadLocalState() {
  try {
    var raw = localStorage.getItem(TC_LS_KEY);
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (saved.ble) {
      tcState.ble.slot       = saved.ble.slot || '0';
      tcState.ble.enabled    = !!saved.ble.enabled;
      tcState.ble.intervalMs = Math.max(100, saved.ble.intervalMs || 500);
    }
    if (saved.zb) {
      tcState.zb.slot       = saved.zb.slot || '0';
      tcState.zb.enabled    = !!saved.zb.enabled;
      tcState.zb.shortAddr  = saved.zb.shortAddr || '';
      tcState.zb.targetIeee = saved.zb.targetIeee || '';
      tcState.zb.coordinatorIeee = saved.zb.coordinatorIeee || '';
      tcState.zb.ep         = saved.zb.ep || '0B';
      tcState.zb.intervalMs = Math.max(100, saved.zb.intervalMs || 1000);
    }
    if (saved.lr) {
      tcState.lr.slot         = saved.lr.slot || '0';
      tcState.lr.enabled      = !!saved.lr.enabled;
      tcState.lr.intervalMs   = Math.max(100, saved.lr.intervalMs || 2000);
      tcState.lr.rttTimeoutMs = Math.max(500, saved.lr.rttTimeoutMs || 5000);
    }
    if (saved.gw) {
      for (var key in saved.gw) {
        if (Object.prototype.hasOwnProperty.call(saved.gw, key) && Object.prototype.hasOwnProperty.call(tcState.gw, key)) {
          tcState.gw[key] = saved.gw[key];
        }
      }
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   Console log
   ═══════════════════════════════════════════════════════════════════ */
var TC_MAX_LOG = 200;

function tcLog(type, msg) {
  var el = document.getElementById('tc-console');
  if (!el) return;
  var ts  = new Date().toTimeString().substr(0, 8);
  var div = document.createElement('div');
  div.className = 'tc-log-' + type;
  div.textContent = '[' + ts + '] ' + msg;
  el.appendChild(div);
  /* trim */
  while (el.childElementCount > TC_MAX_LOG) { el.removeChild(el.firstChild); }
  el.scrollTop = el.scrollHeight;
}

function tcClearLog() {
  var el = document.getElementById('tc-console');
  if (el) el.innerHTML = '';
}

function tcShowToast(msg) {
  var t = document.getElementById('tc-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(function () { t.classList.add('hidden'); }, 3000);
}
