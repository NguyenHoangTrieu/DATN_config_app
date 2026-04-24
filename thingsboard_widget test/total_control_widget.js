/* =====================================================================
   DA2 Total Sensor Control Widget — JavaScript
   Type    : Control widget (requires controlApi / target device)

   Poll Scheduler (sequential):
     BLE  → passive NOTIFY (firmware pushes after enable)
     ZB   → active READ_ATTR (0402/0000 + 0405/0000) per interval
     LoRa → TX_MODE → SEND(request) → RX_MODE → wait RXLRPKT

   RTT measurement:
     Each poll records t_request = Date.now()
     telemetry handler records t_recv  = Date.now()
     RTT = t_recv - t_request, stored per technology

   Bridge to Total Monitor:
     Broadcasts window CustomEvent 'da2_total_event' with decoded data
     so the companion monitor widget can render sensor cards + RTT.
   ===================================================================== */

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
    shortAddr:  '',
    ep:         '0B',
    intervalMs: 1000,
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
var TC_RAW_BRIDGE_KEY = 'da2_total_raw_bridge';
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
    tcSyncUI();
    tcBindInputs();
    tcBindActions();
    _tcRawLineHandler = function (evt) {
      var detail = evt && evt.detail;
      if (!detail || !detail.line) return;
      tcDispatchLine(detail.line, detail.ts || Date.now());
    };
    window.addEventListener('da2_total_raw_line', _tcRawLineHandler);
    tcStartRawBridgePolling();
    tcSubscribeTelemetry();
    tcLog('info', 'Total Control ready');
  } catch (e) {
    tcLog('fail', 'onInit: ' + e);
  }
};

self.onDestroy = function () {
  if (_tcRawLineHandler) {
    window.removeEventListener('da2_total_raw_line', _tcRawLineHandler);
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
      tcLog('warn', 'Telemetry WS unavailable in this widget context');
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
    tcLog('warn', 'Telemetry subscribe failed: ' + (e && e.message ? e.message : e));
  }
}

function tcHexWordsToBytes(hexStr) {
  if (!hexStr) return [];
  return String(hexStr).trim().split(/\s+/).map(function (b) {
    return parseInt(b, 16);
  }).filter(function (b) {
    return !isNaN(b);
  });
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
  if (dataType === 0x21 || dataType === 0x29) {
    var value16 = ((data[offset + 1] || 0) << 8) | (data[offset] || 0);
    return { hex: tcPad2(value16 & 0xFF) + tcPad2((value16 >> 8) & 0xFF), size: 2 };
  }
  return { hex: tcPad2(data[offset] || 0), size: 1 };
}

function tcHandleZbAttrValue(shortAddr, ep, cluster, attr, valueHex, now) {
  var currentShort = String(tcState.zb.shortAddr || '').toUpperCase();
  if (!currentShort || shortAddr !== currentShort) return;

  var raw16 = parseInt(valueHex, 16);
  if (cluster === '0402' && attr === '0000') {
    if (raw16 & 0x8000) raw16 = raw16 - 0x10000;
    tcState.zb._lastTemp = raw16 * 0.01;
    return;
  }

  if (cluster === '0405' && attr === '0000') {
    tcState.zb._lastHum = raw16 * 0.01;
    var zbRtt = (tcState.zb.tReq > 0) ? (now - tcState.zb.tReq) : null;
    tcState.zb.rtt = zbRtt;
    tcState.zb.tReq = 0;
    if (tcState.zb._lastTemp !== undefined) {
      tcEmitData('zb', { temp: tcState.zb._lastTemp, hum: tcState.zb._lastHum, rtt: zbRtt, ts: now });
      tcLog('evt', '[ZB] T=' + tcState.zb._lastTemp.toFixed(2) + '°C H=' + tcState.zb._lastHum.toFixed(2) + '%' + (zbRtt ? ' RTT=' + zbRtt + 'ms' : ''));
      tcSetStatus('zb', 'ok', 'T=' + tcState.zb._lastTemp.toFixed(1) + '°C H=' + tcState.zb._lastHum.toFixed(1) + '%');
    }
  }
}

function tcHandleZbHexFrame(hexStr, ts) {
  var frame = tcParseEbyteFrame(hexStr);
  var now = ts || Date.now();
  if (!frame || !frame.valid) return;

  if (frame.type === 0x80) {
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
      var joinShort = tcPad2(frame.data[9] || 0) + tcPad2(frame.data[8] || 0);
      tcLog('evt', '[ZB] Node joined: 0x' + joinShort);
      return;
    }
    if (frame.code === 0x05 && frame.data.length >= 13) {
      var annShort = tcPad2(frame.data[11] || 0) + tcPad2(frame.data[10] || 0);
      var annEp = tcPad2(frame.data[12] || 0);
      tcLog('evt', '[ZB] Node announce: 0x' + annShort + ' EP:' + annEp);
      return;
    }
    if (frame.code === 0x06 && frame.data.length >= 8) {
      tcLog('evt', '[ZB] Node leave notify');
      return;
    }
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
  var evtMatch = line.match(/CFZB:\d+:EVT:((?:[0-9A-Fa-f]{2}\s*)+)$/i);
  if (evtMatch) {
    var evtHex = evtMatch[1].trim();
    if (/^55\b/i.test(evtHex)) {
      tcLog('evt', '[ZB] HEX EVT: ' + evtHex.substring(0, 48) + (evtHex.length > 48 ? '…' : ''));
      tcParseAndDispatchAllHexFrames(evtHex, ts);
      return;
    }
  }

  var okMatch = line.match(/CFZB:\d+:OK:[^:]+:([0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2})+)$/i);
  if (okMatch) {
    tcParseAndDispatchAllHexFrames(okMatch[1], ts);
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
  m = line.match(/CFBG:OK:NOTIFY:(\d+):0x[0-9A-Fa-f]+:([0-9A-Fa-f]{8,})/i);
  if (m) {
    var hex4 = m[2].toUpperCase();
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
    tcEmitData('ble', { temp: temp, hum: hum, rtt: rtt, ts: now });
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
          tcEmitData('zb', { temp: tcState.zb._lastTemp, hum: tcState.zb._lastHum, rtt: zbRtt, ts: now });
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
  tcEmitData('lr', { temp: temp, hum: hum, rtt: lrRtt, rssi: rssi || null, snr: snr || null, ts: now, nodeId: nodeId });
  tcLog('evt', '[LoRa] node=' + nodeId + ' T=' + temp.toFixed(2) + '°C H=' + hum.toFixed(2) + '%' + (lrRtt ? ' RTT=' + lrRtt + 'ms' : ''));
  tcSetStatus('lr', 'ok', 'T=' + temp.toFixed(1) + '°C H=' + hum.toFixed(1) + '%');
}

/* ═══════════════════════════════════════════════════════════════════
   Cross-widget broadcast
   ═══════════════════════════════════════════════════════════════════ */
function tcEmitData(tech, payload) {
  try {
    window.dispatchEvent(new CustomEvent('da2_total_event', {
      detail: { tech: tech, payload: payload }
    }));
  } catch (e) {}
  /* localStorage fallback */
  try {
    var existing = {};
    try { existing = JSON.parse(localStorage.getItem('da2_total_data') || '{}'); } catch (_) {}
    existing[tech] = payload;
    existing[tech].updatedAt = Date.now();
    localStorage.setItem('da2_total_data', JSON.stringify(existing));
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

/* One READ_ATTR poll: build Ebyte ZCL Read Attribute frames like the working Zigbee widget */
function tcZbPollOnce() {
  tcReadUiState();
  var addr = tcState.zb.shortAddr.trim().toUpperCase();
  var ep   = tcState.zb.ep.trim().toUpperCase() || '0B';
  if (!addr) { tcLog('warn', 'ZB: no short address configured'); return Promise.resolve(); }
  tcState.zb.tReq = Date.now();
  var tempHex = tcBytesToHexStr(tcBuildZclReadAttrFrame(parseInt(addr, 16), parseInt(ep, 16), 0x0402, '0000'));
  var humHex  = tcBytesToHexStr(tcBuildZclReadAttrFrame(parseInt(addr, 16), parseInt(ep, 16), 0x0405, '0000'));
  return tcSendCFZB('MODULE_ZCL_READ_ATTR', tempHex, 8000)
    .then(function () {
      return tcSendCFZB('MODULE_ZCL_READ_ATTR', humHex, 8000);
    })
    .catch(function () {});
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
  if (!tcState.lr.configured) { tcLog('warn', 'LoRa not configured'); return Promise.resolve(); }
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
  var anyEnabled = tcState.ble.enabled || tcState.zb.enabled || tcState.lr.enabled;
  if (!anyEnabled) { tcShowToast('Enable at least one technology'); return; }
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
    if (tcState[tech].enabled) {
      tcState.techIdx = (idx + 1) % order.length; /* advance for next tick */
      found = true;
      var intervalMs = Math.max(100, tcState[tech].intervalMs || 1000);
      tcSetSchedInfo('Polling ' + tech.toUpperCase() + ' (every ' + intervalMs + ' ms)…');
      tcRunPollForTech(tech)
        .then(function () {
          if (!tcState.polling) return;
          tcState.schedTimer = setTimeout(tcSchedTick, intervalMs);
        });
      break;
    }
  }
  if (!found) {
    tcLog('warn', 'No technologies enabled — stopping');
    tcStopPolling();
  }
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
  var map = { ble: 'tc-ble-status', zb: 'tc-zb-status', lr: 'tc-lr-status' };
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
  /* toggle switches */
  var bleEn = document.getElementById('tc-ble-en');
  if (bleEn) bleEn.checked = tcState.ble.enabled;
  var zbEn = document.getElementById('tc-zb-en');
  if (zbEn) zbEn.checked = tcState.zb.enabled;
  var lrEn = document.getElementById('tc-lr-en');
  if (lrEn) lrEn.checked = tcState.lr.enabled;
  tcRefreshTechCards();
}

function tcBindInputs() {
  var ids = ['tc-ble-interval', 'tc-zb-slot', 'tc-zb-addr', 'tc-zb-ep', 'tc-zb-interval', 'tc-lr-slot', 'tc-lr-interval', 'tc-lr-rtt-to'];
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
    { id: 'tc-lr-setup', type: 'click', fn: tcLrSetupTestMode },
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
  tcReadUiState();
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

/* ═══════════════════════════════════════════════════════════════════
   LocalStorage persistence
   ═══════════════════════════════════════════════════════════════════ */
var TC_LS_KEY = 'da2_total_ctrl_v1';

function tcSaveLocalState() {
  try {
    var saved = {
      ble: { slot: tcState.ble.slot, enabled: tcState.ble.enabled, intervalMs: tcState.ble.intervalMs },
      zb:  { slot: tcState.zb.slot, enabled: tcState.zb.enabled, shortAddr: tcState.zb.shortAddr, ep: tcState.zb.ep, intervalMs: tcState.zb.intervalMs },
      lr:  { slot: tcState.lr.slot, enabled: tcState.lr.enabled, intervalMs: tcState.lr.intervalMs, rttTimeoutMs: tcState.lr.rttTimeoutMs }
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
      tcState.zb.ep         = saved.zb.ep || '0B';
      tcState.zb.intervalMs = Math.max(100, saved.zb.intervalMs || 1000);
    }
    if (saved.lr) {
      tcState.lr.slot         = saved.lr.slot || '0';
      tcState.lr.enabled      = !!saved.lr.enabled;
      tcState.lr.intervalMs   = Math.max(100, saved.lr.intervalMs || 2000);
      tcState.lr.rttTimeoutMs = Math.max(500, saved.lr.rttTimeoutMs || 5000);
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
