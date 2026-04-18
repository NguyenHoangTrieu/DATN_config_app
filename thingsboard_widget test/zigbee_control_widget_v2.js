/* =====================================================================
   DA2 Zigbee Gateway Control — ThingsBoard Widget JavaScript v2 (HEX)
   Protocol: CFML:CFZB:<slot>:<function_name|HEX_frame>
   Routing: CF → WAN MCU → ML:CFZB → Zigbee handler → UART to E180-ZG120B
   Frame:   [0x55][Length][Type][Code][Data...][Checksum]

   Follows ble_gatt_app_widget.js patterns:
     - All ge() calls null-guarded via setEl()
     - onInit deferred via setTimeout (widget DOM ready)
     - controlApi null-checked before every RPC
     - Self-subscribes telemetry WebSocket via telemetryWsService
       (no datasource required — entityId resolved from stateController)
     - querySelectorAll scoped to _root element

   Telemetry WS subscribe API note:
     telemetryWsService.subscribe() accepts a SubscriptionInfo object:
       { entityType, entityId, keys, onData(data) }
     onData receives: { [key]: [[ts, value], ...] }
     Access latest value: data['data'][data['data'].length - 1][1]
   ===================================================================== */

/* ── App State ── */
var state = {
  slot:         '0',
  shortAddr:    '',
  ep:           '01',
  cluster:      '0006',
  networkUp:    false,
  nodes:        {},          /* { shortAddr: { ieee, type, ep } } */
  selectedNode: null,        /* shortAddr string */
  rpcTimeout:   15000,
  onOffState:   false,
  hue:          30,
  brightness:   80,
  isWhite:      false,
  tempRaw:      null,
  _hexSeq:      0            /* ZCL frame sequence counter */
};

/* ── Widget-root reference for scoped querySelectorAll ── */
var _root = null;

/* ── Telemetry subscription (programmatic — no datasource needed) ── */
var g_teleSubscriber  = null;
var g_lastTeleTs      = 0;
/* ── Cross-widget bridge listener (receives events from Monitor widget) ── */
var g_zbmEventHandler = null;

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard Lifecycle
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  try {
    _root = document.getElementById('zb-app-root');
    loadLocalState();
    syncSlotSelect();
    renderNodeList();
    updateControlPanel();
    updateClusterTabs();
    logInfo('Widget ready — slot ' + state.slot);

    /* ── 1. Subscribe directly to gateway telemetry WebSocket ──
       No datasource needed. Resolve entityId via stateController.
       This path handles data the Control widget sends itself (RPC responses). */
    try {
      var entityId = resolveTargetEntityId();
      if (!entityId) {
        logWarn('Cannot resolve target device — add a Target Device in widget settings');
      } else {
        var subscriber = {
          entityId:   entityId,
          entityType: 'DEVICE',
          keys:       'data',
          onData: function (data) {
            if (!data) return;
            /* TB telemetryWsService shape: { [key]: [[ts, value], ...] }
               The key is the telemetry key name, e.g. 'data'. */
            var arr = data['data'];
            if (!arr || !arr.length) return;
            var latest = arr[arr.length - 1];   /* last point: [ts, value] */
            if (!latest || latest.length < 2) return;
            var raw     = latest[1];
            var decoded = hexToString(String(raw));
            splitResp(decoded).forEach(function (line) { dispatchLine(line); });
          }
        };
        self.ctx.telemetryWsService.subscribe(subscriber);
        g_teleSubscriber = subscriber;
        logInfo('Telemetry WS subscribed → entityId=' + entityId + ' key="data"');
      }
    } catch (se) {
      logWarn('WS subscribe failed: ' + (se && se.message ? se.message : se));
    }

    /* ── 2. Listen for events pushed by Monitor Widget (window CustomEvent bridge) ──
       Monitor widget dispatches 'da2_zb_event' when it discovers nodes or
       receives attribute reports via its datasource WebSocket.
       This is the PRIMARY source of node discovery when Control widget
       has no datasource configured. */
    g_zbmEventHandler = function (evt) {
      try {
        var d = evt.detail;
        if (!d || !d.type) return;
        var p = d.payload || {};

        if (d.type === 'nodeJoin') {
          /* Monitor received 0x80/0x03 Join Notify */
          addNode(p.short, p.ieee || '????????????????', '?');
          logEvt('⚡ [Bridge] Node join: 0x' + p.short);

        } else if (d.type === 'nodeAnnounce') {
          /* Monitor received 0x80/0x05 Announce Notify — has EP */
          addNode(p.short, p.ieee || '????????????????', '?');
          if (p.ep && state.nodes[p.short]) state.nodes[p.short].ep = p.ep;
          renderNodeList();
          saveLocalState();
          logEvt('⚡ [Bridge] Node announce: 0x' + p.short + ' EP:' + p.ep);

        } else if (d.type === 'nodeLeave') {
          /* Monitor received 0x80/0x06 Leave Notify */
          var ieee = p.ieee;
          Object.keys(state.nodes).forEach(function (addr) {
            if (state.nodes[addr].ieee === ieee) {
              delete state.nodes[addr];
              if (state.selectedNode === addr) {
                state.selectedNode = null;
                updateControlPanel();
              }
            }
          });
          renderNodeList();
          saveLocalState();
          logEvt('⚡ [Bridge] Node leave: IEEE=' + ieee);

        } else if (d.type === 'attrReport') {
          /* Monitor received 0x82/0x0A ZCL Attribute Report — sync UI state */
          handleAttrReport(p.short, p.cluster, p.attr, p.value);
        }
      } catch (be) {
        logWarn('[Bridge] event error: ' + (be && be.message ? be.message : be));
      }
    };
    window.addEventListener('da2_zb_event', g_zbmEventHandler);
    logInfo('Monitor bridge listener registered');

  } catch (e) {
    console.error('[ZB Widget] onInit error:', e);
  }
};

self.onDestroy = function () {
  /* ── Remove Monitor bridge listener ── */
  try {
    if (g_zbmEventHandler) {
      window.removeEventListener('da2_zb_event', g_zbmEventHandler);
      g_zbmEventHandler = null;
    }
  } catch (e) {}
  /* ── Unsubscribe telemetry WebSocket ── */
  try {
    if (g_teleSubscriber && self.ctx && self.ctx.telemetryWsService) {
      self.ctx.telemetryWsService.unsubscribe(g_teleSubscriber);
      g_teleSubscriber = null;
      logInfo('Telemetry WS unsubscribed');
    }
  } catch (e) { /* ignore — widget context may already be torn down */ }
};

/* ════════════════════════════════════════════════════════════════════
   Ebyte HEX Frame Utilities
   Frame: [0x55][Length][Type][Code][Data...][Checksum]
   Length = 1(Type) + 1(Code) + N(Data) + 1(Checksum) = N + 3
   Checksum = XOR(Type, Code, Data[0..N-1])
   All multi-byte fields are Little-Endian.
   ════════════════════════════════════════════════════════════════════ */

/**
 * buildEbyteFrame — build raw Ebyte HEX frame as byte array.
 * @param {number} typeByte  Frame type (0x00=CFG, 0x01=ZDO, 0x02=ZCL)
 * @param {number} codeByte  Command code
 * @param {number[]} dataBytes  Data payload (may be empty)
 * @returns {number[]} Complete frame bytes [0x55, len, type, code, ...data, chk]
 */
function buildEbyteFrame(typeByte, codeByte, dataBytes) {
  dataBytes = dataBytes || [];
  var payload = [typeByte, codeByte].concat(dataBytes);
  var checksum = 0;
  for (var i = 0; i < payload.length; i++) checksum ^= payload[i];
  var length = payload.length + 1; /* +1 for checksum */
  return [0x55, length].concat(payload).concat([checksum]);
}

/**
 * buildZclFrame — build a ZCL command frame (Type=0x02).
 * @param {number} code       ZCL code (0x0F=control, 0x00=read, 0x01=write, 0x03=setReport)
 * @param {number} targetAddr 16-bit short address
 * @param {number} targetPort Endpoint number
 * @param {number} clusterId  16-bit cluster ID
 * @param {number[]} extData  Extended data after ZCL header
 * @returns {number[]} Complete frame bytes
 */
function buildZclFrame(code, targetAddr, targetPort, clusterId, extData) {
  var seq = (state._hexSeq++) & 0xFF;
  var zclHeader = [
    0x00,                          /* TxMode: unicast */
    targetAddr & 0xFF,             /* ShortAddr LE low */
    (targetAddr >> 8) & 0xFF,      /* ShortAddr LE high */
    targetPort & 0xFF,             /* TargetPort (endpoint) */
    seq,                           /* FrameSeq */
    0x00,                          /* Direction: C→S */
    clusterId & 0xFF,              /* ClusterID LE low */
    (clusterId >> 8) & 0xFF,       /* ClusterID LE high */
    0x00, 0x00,                    /* ManuCode: standard */
    0x00                           /* RespMode: default */
  ];
  return buildEbyteFrame(0x02, code, zclHeader.concat(extData || []));
}

/**
 * buildZdoFrame — build a ZDO request frame (Type=0x01).
 * @param {number} code      ZDO code
 * @param {number} shortAddr Target 16-bit short address
 * @param {number[]} params  Command-specific parameters
 * @returns {number[]} Complete frame bytes
 */
function buildZdoFrame(code, shortAddr, params) {
  var data = [shortAddr & 0xFF, (shortAddr >> 8) & 0xFF].concat(params || []);
  return buildEbyteFrame(0x01, code, data);
}

/**
 * parseEbyteFrame — parse space-separated hex string into frame parts.
 * @param {string} hexStr  e.g. "55 0D 80 03 AA BB ..."
 * @returns {object|null} { type, code, data[], valid }
 */
function parseEbyteFrame(hexStr) {
  var bytes = hexStr.trim().split(/\s+/).map(function (b) { return parseInt(b, 16); });
  if (bytes.length < 4 || bytes[0] !== 0x55) return null;
  var length  = bytes[1];
  var type    = bytes[2];
  var code    = bytes[3];
  var dataLen = length - 3;
  if (dataLen < 0) dataLen = 0;
  var data    = bytes.slice(4, 4 + dataLen);
  var chkIdx  = 4 + dataLen;
  var rcvChk  = (chkIdx < bytes.length) ? bytes[chkIdx] : -1;
  var calcChk = type ^ code;
  for (var i = 0; i < data.length; i++) calcChk ^= data[i];
  return { type: type, code: code, data: data, valid: (calcChk === rcvChk) };
}

/** Convert byte array to space-separated uppercase hex string */
function bytesToHexStr(arr) {
  return arr.map(function (b) { return pad2(b); }).join(' ');
}

/** Parse ZCL attribute value from response data at given offset */
function parseZclAttrValue(data, offset, dataType) {
  if (dataType === 0x10) { /* bool */
    return { val: data[offset], hex: pad2(data[offset]), size: 1 };
  } else if (dataType === 0x20) { /* uint8 */
    return { val: data[offset], hex: pad2(data[offset]), size: 1 };
  } else if (dataType === 0x21) { /* uint16 */
    var v = (data[offset + 1] << 8) | data[offset];
    return { val: v, hex: pad4(v), size: 2 };
  } else if (dataType === 0x29) { /* int16 */
    var v2 = (data[offset + 1] << 8) | data[offset];
    if (v2 > 32767) v2 -= 65536;
    return { val: v2, hex: pad4(v2 & 0xFFFF), size: 2 };
  } else if (dataType === 0x30) { /* enum8 */
    return { val: data[offset], hex: pad2(data[offset]), size: 1 };
  }
  /* Unknown type — return single byte */
  return { val: data[offset], hex: pad2(data[offset] || 0), size: 1 };
}

/* ────────────────────────────────────────────────────────────────────
   Entity ID Resolution (no datasource required)
   Priority chain:
     1. Widget settings → Target Device (widgetContext.targetDevice)
     2. Dashboard stateController → current state entity (DEVICE type)
     3. controlApi → targetDevice (works if Target Device set in widget)
   ──────────────────────────────────────────────────────────────────── */
/**
 * resolveTargetEntityId — returns the string entity ID of the target device,
 * or null if none can be resolved.
 */
function resolveTargetEntityId() {
  var ctx = self.ctx;
  if (!ctx) return null;

  /* ── 1. widgetContext.targetDevice (set in widget Edit mode → Settings → Target Device) ── */
  try {
    var td = ctx.widgetContext && ctx.widgetContext.targetDevice;
    if (td && td.id) return td.id;
  } catch (e) {}

  /* ── 2. stateController → getEntityId() → current entity on dashboard ── */
  try {
    var sc = ctx.stateController;
    if (sc) {
      /* getEntityId() returns { entityType, id } for the current state */
      var eid = typeof sc.getEntityId === 'function' ? sc.getEntityId() : null;
      if (eid && eid.entityType === 'DEVICE' && eid.id) return eid.id;

      /* Older TB: getStateParams().entityId */
      var sp = typeof sc.getStateParams === 'function' ? sc.getStateParams() : null;
      if (sp && sp.entityId && sp.entityId.entityType === 'DEVICE') return sp.entityId.id;
    }
  } catch (e) {}

  /* ── 3. defaultSubscription.targetDeviceId (only if datasource is configured) ── */
  try {
    var ds = ctx.defaultSubscription;
    if (ds && ds.targetDeviceId) return ds.targetDeviceId;
  } catch (e) {}

  /* ── 4. controlApi.targetDeviceId ── */
  try {
    var ca = ctx.controlApi;
    if (ca && ca.targetDeviceId) return ca.targetDeviceId;
  } catch (e) {}

  return null;
}

/* ────────────────────────────────────────────────────────────────────
   RPC / CFML Helpers
   ──────────────────────────────────────────────────────────────────── */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi — assign a target device in widget settings'));
      return;
    }
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err)  { reject(err);  }
      );
  });
}

function stringToHex(str) {
  var hex = '';
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i).toString(16).toUpperCase();
    hex += (code.length === 1 ? '0' : '') + code;
  }
  return hex;
}

function hexToString(hex) {
  var str = '';
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(b)) str += String.fromCharCode(b);
  }
  return str;
}

/**
 * sendCFML — wraps payload in CFML:CFZB:<slot>: and sends as hex-encoded RPC.
 * payload: function_name for static, or function_name:params for dynamic.
 * Examples:
 *   'MODULE_START_NETWORK'
 *   'MODULE_ZCL_SEND_CONTROL_CMD:1234,0A,0006,01'
 *   'MODULE_SET_DEST_ADDR:1234'
 */
function sendCFML(payload, timeoutMs) {
  var cmd = 'CFML:CFZB:' + state.slot + ':' + payload;
  logTx(cmd);
  var hexCmd = stringToHex(cmd);
  return sendRPC('sendCommand', hexCmd, timeoutMs || state.rpcTimeout)
    .then(function (resp) {
      if (resp) logCFMLResponse(resp);
      return resp;
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      logFail('RPC: ' + msg);
      showToast('⚠ ' + msg);
      throw err;
    });
}

/**
 * sendZclCommand — build a complete Ebyte ZCL frame and send it as raw HEX bytes.
 * Sends: MODULE_ZCL_SEND_CONTROL_CMD:<space-separated-hex-frame>
 * No commas in the payload — firmware parses space-separated hex directly.
 *
 * @param {string}         shortAddr      4-char hex short address (e.g. "14B1")
 * @param {string}         ep             2-char hex endpoint (e.g. "0A")
 * @param {string}         cluster        4-char hex cluster ID (e.g. "0006")
 * @param {string}         cmdId          2-char hex ZCL command ID (e.g. "01")
 * @param {number[]|[]}    extPayload     ZCL payload bytes AFTER cmdId (may be empty array)
 * @param {number}         [timeoutMs]    RPC timeout
 */
function sendZclCommand(shortAddr, ep, cluster, cmdId, extPayload, timeoutMs) {
  var payBytes = Array.isArray(extPayload) ? extPayload : [];
  var frame = buildZclFrame(0x0F,
    parseInt(shortAddr, 16),
    parseInt(ep,        16),
    parseInt(cluster,   16),
    [parseInt(cmdId, 16)].concat(payBytes));
  var hexFrame = bytesToHexStr(frame);
  logInfo('ZCL Frame: ' + hexFrame);
  return sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + hexFrame, timeoutMs || 15000);
}

/**
 * sendZclReadAttr — convenience: read ZCL attribute via firmware.
 */
function sendZclReadAttr(shortAddr, ep, cluster, attrId, timeoutMs) {
  return sendCFML('MODULE_ZCL_READ_ATTR:' + shortAddr + ',' + ep + ',' + cluster + ',' + attrId,
                  timeoutMs || 15000);
}

/* ────────────────────────────────────────────────────────────────────
   Response Parsers
   ──────────────────────────────────────────────────────────────────── */
function splitResp(resp) {
  if (!resp) return [];
  if (typeof resp === 'object' && resp !== null) {
    if      (resp.result !== undefined) resp = resp.result;
    else if (resp.data   !== undefined) resp = resp.data;
  }
  var s = String(resp);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0) s = hexToString(s);
  return s.split(/\x1e|\n/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function logCFMLResponse(resp) {
  splitResp(resp).forEach(function (line) {
    /* HEX frame response (starts with "55 ") */
    if (/^55\s+[0-9A-Fa-f]{2}/i.test(line)) {
      var frame = parseEbyteFrame(line);
      if (frame) {
        var tag = pad2(frame.type) + '/' + pad2(frame.code);
        logOk('HEX [' + tag + '] ' + line);
        handleHexEvent(line);
      } else {
        logOk('HEX: ' + line);
      }
      return;
    }
    if (/^FAIL:|INVALID|ERROR/i.test(line)) {
      logFail(line);
    } else if (/^JOIN:|^\+NWINFO:|^FIND:|^RPT:|^LEAVE:|^NODE:|^RSP:|^NET:|^NETOPEN|:EVT:/i.test(line)) {
      logEvt(line);
      dispatchLine(line);
    } else {
      logOk(line);
    }
  });
}

/* ────────────────────────────────────────────────────────────────────
   Async Event Dispatch
   ──────────────────────────────────────────────────────────────────── */

/**
 * dispatchLine — route incoming telemetry/EVT line to the correct parser.
 * In HEX mode, EVT data is raw Ebyte frame bytes (first byte = 0x55).
 * In legacy AT mode, EVT data is hex-encoded ASCII text.
 */
function dispatchLine(line) {
  /* Match :EVT: followed by hex bytes at end of line */
  var evtM = line.match(/:EVT:((?:[0-9A-Fa-f]{2}\s*)+)$/i);
  if (evtM) {
    var hexData = evtM[1].trim();
    /* First byte 0x55 → Ebyte HEX frame */
    if (/^55\b/i.test(hexData)) {
      logEvt('HEX EVT: ' + hexData.substring(0, 40) + (hexData.length > 40 ? '…' : ''));
      handleHexEvent(hexData);
    } else {
      /* Legacy AT text mode — decode hex bytes to ASCII */
      var inner = hexToString(hexData.replace(/\s+/g, ''));
      inner.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)
        .forEach(function (subLine) {
          logEvt(subLine);
          handleAsyncEvent(subLine);
        });
    }
    return;
  }
  /* Direct HEX frame (line starts with "55 ") */
  if (/^55\s+[0-9A-Fa-f]{2}/i.test(line)) {
    handleHexEvent(line);
    return;
  }
  /* Fallback: legacy text event */
  handleAsyncEvent(line);
}

/* ────────────────────────────────────────────────────────────────────
   HEX Frame Event Handlers (Ebyte native mode)
   ──────────────────────────────────────────────────────────────────── */

/** Main dispatcher for parsed HEX frames */
function handleHexEvent(hexStr) {
  var frame = parseEbyteFrame(hexStr);
  if (!frame) return;
  if (!frame.valid) { logWarn('Bad checksum: ' + hexStr.substring(0, 30)); return; }

  if (frame.type === 0x80) {
    switch (frame.code) {
      case 0x00: handleBootNotify(frame.data);        break;
      case 0x01: handleNetStatusNotify(frame.data);   break;
      case 0x02: handleNetOpenNotify(frame.data);     break;
      case 0x03: handleNodeJoinNotify(frame.data);    break;
      case 0x05: handleNodeAnnounceNotify(frame.data);break;
      case 0x06: handleNodeLeaveNotify(frame.data);   break;
      case 0x10: handleFindBindNotify(frame.data);    break;
    }
  } else if (frame.type === 0x82) {
    switch (frame.code) {
      case 0x00: handleZclReadAttrRsp(frame.data);    break;
      case 0x0A: handleZclAttrReport(frame.data);     break;
      case 0x0B: handleZclDefaultRsp(frame.data);     break;
      case 0x0F: handleZclRecvControlCmd(frame.data); break;
    }
  } else if (frame.type === 0x8F && frame.code === 0x02) {
    handleSendConfirm(frame.data);
  } else if (frame.type === 0x00) {
    /* CFG feedback — network/config command acknowledged */
    logOk('CFG ACK: type=00 code=' + pad2(frame.code));
  }
}

/* ── 0x80/0x00: Boot Notify ── */
function handleBootNotify(data) {
  if (data.length < 10) return;
  var resetMode = data[0];
  var version   = data[1];
  var mac = data.slice(2, 10).reverse().map(function (b) { return pad2(b); }).join(':');
  logInfo('Boot: reset=' + resetMode + ' ver=' + version + ' MAC=' + mac);
}

/* ── 0x80/0x01: Network Status Notify ── */
function handleNetStatusNotify(data) {
  if (data.length < 1) return;
  var status = data[0]; /* 0x00=not networked, 0x01=networked, 0x02=config mode */
  if (status === 0x01) {
    setNetState('on');
  } else {
    setNetState('off');
  }
  if (data.length >= 14) {
    var ch     = data[9];
    var panid  = pad4((data[11] << 8) | data[10]);
    var sAddr  = pad4((data[13] << 8) | data[12]);
    setEl('net-info-bar', 'CH:' + ch + ' PAN:0x' + panid + ' Addr:0x' + sAddr);
  }
  logEvt('NetStatus: ' + (status === 1 ? 'UP' : 'DOWN'));
}

/* ── 0x80/0x02: Network Open Notify ── */
function handleNetOpenNotify(data) {
  if (data.length < 1) return;
  var windowTime = data[0]; /* seconds, 0 = closed */
  if (windowTime > 0) {
    setNetState('on');
    setEl('net-info-bar', 'Open: ' + windowTime + 's');
    showToast('Network open — ' + windowTime + 's ✓');
  } else {
    setEl('net-info-bar', 'Permit join closed');
  }
  logEvt('NetOpen: ' + windowTime + 's');
}

/* ── 0x80/0x03: Node Join Notify ── */
function handleNodeJoinNotify(data) {
  /* [MAC(8B LE)] [ShortAddr(2B LE)] [ParentAddr(2B LE)] [AccessMode(1B)] */
  if (data.length < 13) return;
  var ieee      = data.slice(0, 8).reverse().map(function (b) { return pad2(b); }).join('');
  var shortAddr = pad4((data[9] << 8) | data[8]);
  var accessMode = data[12]; /* 0=first join, 1=rejoin */
  logEvt('Node joined: 0x' + shortAddr + ' IEEE:' + ieee +
    (accessMode === 0 ? ' (new)' : ' (rejoin)'));
  addNode(shortAddr, ieee.toUpperCase(), '?');
  showToast('Node joined: 0x' + shortAddr);
}

/* ── 0x80/0x05: Node Announce Notify ── */
function handleNodeAnnounceNotify(data) {
  /* [TermFlag(1B)] [DevSN: port(1B)+IEEE(8B LE)] [ShortAddr(2B LE)] [PortNum(1B)] ... */
  if (data.length < 13) return;
  var port      = data[1];
  var ieee      = data.slice(2, 10).reverse().map(function (b) { return pad2(b); }).join('');
  var shortAddr = pad4((data[11] << 8) | data[10]);
  var epNum     = data[12];
  logEvt('Announce: 0x' + shortAddr + ' EP:' + pad2(epNum) + ' IEEE:' + ieee);
  var existing = state.nodes[shortAddr];
  if (existing) {
    existing.ep   = pad2(epNum);
    existing.ieee = ieee.toUpperCase();
  } else {
    addNode(shortAddr, ieee.toUpperCase(), '?');
    if (state.nodes[shortAddr]) state.nodes[shortAddr].ep = pad2(epNum);
  }
  renderNodeList();
  saveLocalState();
}

/* ── 0x80/0x06: Node Leave Notify ── */
function handleNodeLeaveNotify(data) {
  /* [MAC(8B LE)] */
  if (data.length < 8) return;
  var ieee = data.slice(0, 8).reverse().map(function (b) { return pad2(b); }).join('').toUpperCase();
  logEvt('Node left: IEEE=' + ieee);
  Object.keys(state.nodes).forEach(function (addr) {
    if (state.nodes[addr].ieee === ieee) {
      delete state.nodes[addr];
      if (state.selectedNode === addr) { state.selectedNode = null; updateControlPanel(); }
    }
  });
  renderNodeList();
  saveLocalState();
}

/* ── 0x80/0x10: Find & Bind Notify ── */
function handleFindBindNotify(data) {
  /* [TargetShortAddr(2B LE)] [TargetPort(1B)] [ClusterID(2B LE)] */
  if (data.length < 5) return;
  var shortAddr = pad4((data[1] << 8) | data[0]);
  var ep        = pad2(data[2]);
  var cluster   = pad4((data[4] << 8) | data[3]);
  logEvt('Find/Bind: 0x' + shortAddr + ' EP:' + ep + ' Cluster:0x' + cluster);
  var existing = state.nodes[shortAddr];
  addNode(shortAddr, existing ? existing.ieee : '????????????????', '?');
  if (state.nodes[shortAddr]) state.nodes[shortAddr].ep = ep;
  renderNodeList();
  saveLocalState();
  showToast('Bound 0x' + shortAddr + ' ✓');
}

/* ── 0x82/0x00: ZCL Read Attribute Response ── */
function handleZclReadAttrRsp(data) {
  /* ZCL Header (11B) + [NumAttr(1B)] [AttrID(2B LE)] [Status(1B)] [DataType(1B)] [Value] ... */
  if (data.length < 16) return;
  var srcAddr = pad4((data[2] << 8) | data[1]);
  var cluster = pad4((data[7] << 8) | data[6]);
  var numAttr = data[11];
  var pos     = 12;
  for (var i = 0; i < numAttr && pos + 3 < data.length; i++) {
    var attrId = pad4((data[pos + 1] << 8) | data[pos]);
    var status = data[pos + 2];
    pos += 3;
    if (status !== 0x00 || pos >= data.length) continue;
    var dataType = data[pos];
    pos += 1;
    if (pos >= data.length) break;
    var parsed = parseZclAttrValue(data, pos, dataType);
    pos += parsed.size;
    logOk('ReadRsp: 0x' + srcAddr + ' Cl:' + cluster + ' Attr:' + attrId +
      ' = 0x' + parsed.hex + ' (' + parsed.val + ')');
    handleAttrReport(srcAddr, cluster, attrId, parsed.hex);
  }
}

/* ── 0x82/0x0A: ZCL Attribute Report ── */
function handleZclAttrReport(data) {
  /* ZCL Header (11B) + [NumAttr(1B)] [AttrID(2B LE)] [DataType(1B)] [Value] ... */
  if (data.length < 15) return;
  var srcAddr = pad4((data[2] << 8) | data[1]);
  var srcPort = pad2(data[3]);
  var cluster = pad4((data[7] << 8) | data[6]);
  var numAttr = data[11];
  var pos     = 12;
  for (var i = 0; i < numAttr && pos + 2 < data.length; i++) {
    var attrId   = pad4((data[pos + 1] << 8) | data[pos]);
    var dataType = data[pos + 2];
    pos += 3;
    if (pos >= data.length) break;
    var parsed = parseZclAttrValue(data, pos, dataType);
    pos += parsed.size;
    logEvt('RPT: 0x' + srcAddr + ':' + srcPort + ' Cl:' + cluster +
      ' Attr:' + attrId + ' = 0x' + parsed.hex);
    handleAttrReport(srcAddr, cluster, attrId, parsed.hex);
    /* Bridge to monitor widget — emit RPT line for compatibility */
    try {
      var rptLine = 'RPT:' + srcAddr + ',' + srcPort + ',' + cluster + ',' +
        attrId + ',' + pad2(dataType) + ',' + parsed.hex;
      localStorage.setItem('da2_zb_bridge',
        JSON.stringify({ ts: Date.now(), line: rptLine }));
    } catch (be) { /* ignore */ }
  }
}

/* ── 0x82/0x0B: ZCL Default Response ── */
function handleZclDefaultRsp(data) {
  if (data.length < 13) return;
  var cmdId  = data[11];
  var status = data[12]; /* 0x00=OK, 0x81=not supported */
  if (status === 0x00) {
    logOk('ZCL ACK cmd=' + pad2(cmdId));
  } else {
    logWarn('ZCL NAK cmd=' + pad2(cmdId) + ' status=' + pad2(status));
  }
}

/* ── 0x82/0x0F: ZCL Receive Control Command ── */
function handleZclRecvControlCmd(data) {
  if (data.length < 12) return;
  var srcAddr = pad4((data[2] << 8) | data[1]);
  var cluster = pad4((data[7] << 8) | data[6]);
  var cmdId   = data[11];
  logEvt('ZCL Cmd from 0x' + srcAddr + ': Cl=' + cluster + ' CmdID=' + pad2(cmdId));
}

/* ── 0x8F/0x02: Send Confirm ── */
function handleSendConfirm(data) {
  if (data.length < 7) return;
  var result = data[6]; /* 0x00=OK, 0x01=fail, 0x66=E180 fail */
  if (result === 0x00) {
    logOk('TX confirmed ✓');
  } else {
    logWarn('TX failed: 0x' + pad2(result));
  }
}

/* ────────────────────────────────────────────────────────────────────
   Legacy AT Text Event Handler (backward compatibility)
   ──────────────────────────────────────────────────────────────────── */
function handleAsyncEvent(line) {
  var m;

  /* JOIN:<short4>,<ieee16>,<type> */
  m = line.match(/^JOIN:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16}),(\d)/);
  if (m) { addNode(m[1].toUpperCase(), m[2].toUpperCase(), m[3]); return; }

  /* JOIN:MAC=0x<ieee16> */
  m = line.match(/^JOIN:MAC=0x([0-9A-Fa-f]{16})/i);
  if (m) { addNode('????', m[1].toUpperCase(), '?'); return; }

  /* NODE:<short4>,<ieee16> */
  m = line.match(/^NODE:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16})/);
  if (m) { addNode(m[1].toUpperCase(), m[2].toUpperCase(), '?'); return; }

  /* NODE:MAC=0x<ieee>,ADDR=0x<short> */
  m = line.match(/^NODE:MAC=0x([0-9A-Fa-f]{16}),ADDR=0x([0-9A-Fa-f]{4})/i);
  if (m) { addNode(m[2].toUpperCase(), m[1].toUpperCase(), '?'); return; }

  /* FIND:<short4>,<ieee16> */
  m = line.match(/^FIND:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16})/);
  if (m) { addNode(m[1].toUpperCase(), m[2].toUpperCase(), '?'); return; }

  /* NETOPEN:<duration> */
  m = line.match(/^NETOPEN:(.*)/i);
  if (m) { setNetState('on'); setEl('net-info-bar', 'Open: ' + m[1]); showToast('Network open ✓'); return; }

  /* NET:JOIN / NET:OPEN / NET:IDLE */
  m = line.match(/^NET:(JOIN|OPEN|IDLE|CLOSE)/i);
  if (m) {
    var s = m[1].toUpperCase();
    if (s === 'JOIN' || s === 'OPEN') { setNetState('on'); setEl('net-info-bar', 'NET:' + s); }
    else { setNetState('off'); }
    return;
  }

  /* +NWINFO:<data> */
  m = line.match(/^\+NWINFO:(.*)/);
  if (m) { setEl('net-info-bar', m[1]); setNetState('on'); return; }

  /* LEAVE:<short4> */
  m = line.match(/^LEAVE:([0-9A-Fa-f]{4})/);
  if (m) {
    var gone = m[1].toUpperCase();
    delete state.nodes[gone];
    if (state.selectedNode === gone) { state.selectedNode = null; updateControlPanel(); }
    renderNodeList(); saveLocalState();
    logInfo('Node ' + gone + ' left network');
    return;
  }

  /* LEAVE:MAC=0x<ieee16> */
  m = line.match(/^LEAVE:MAC=0x([0-9A-Fa-f]{16})/i);
  if (m) {
    var ieeeGone = m[1].toUpperCase();
    Object.keys(state.nodes).forEach(function (addr) {
      if (state.nodes[addr].ieee === ieeeGone) {
        delete state.nodes[addr];
        if (state.selectedNode === addr) { state.selectedNode = null; updateControlPanel(); }
      }
    });
    renderNodeList(); saveLocalState(); return;
  }

  /* RPT:<short>,<ep>,<cluster>,<attr>,<type>,<value> */
  m = line.match(/^RPT:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{4}),([0-9A-Fa-f]{2}),(.*)/i);
  if (m) { handleAttrReport(m[1].toUpperCase(), m[3].toUpperCase(), m[4].toUpperCase(), m[6]); return; }

  /* FAIL:<reason> */
  m = line.match(/^FAIL:(.*)/i);
  if (m) { logFail('Module error: ' + m[1]); showToast('⚠ ' + m[1]); return; }

  /* RSP:<data> */
  m = line.match(/^RSP:(.*)/);
  if (m) { logOk('ZCL response: ' + m[1]); return; }
}

/* ── Shared Attribute Report Handler (used by both HEX and text paths) ── */
function handleAttrReport(short, cluster, attr, value) {
  if (short !== state.selectedNode) return;
  if (cluster === '0006' && attr === '0000') {
    var on = (parseInt(value, 16) !== 0);
    state.onOffState = on;
    var tog = ge('onoff-toggle');
    if (tog) tog.checked = on;
    setEl('onoff-status-text', on ? 'ON' : 'OFF');
    var wrap = ge('onoff-icon-wrap');
    if (wrap) wrap.setAttribute('data-on', on ? 'true' : 'false');
    setEl('onoff-icon', on ? '💡' : '🔦');
  }
  if (cluster === '0402' && attr === '0000') {
    var raw = parseInt(value, 16);
    if (raw > 32767) raw -= 65536;
    var tempC = (raw / 100.0).toFixed(1);
    state.tempRaw = tempC;
    setEl('temp-val', tempC);
  }
}

function parseNetStatus(lines) {
  lines.forEach(function (l) {
    if (/^\+NWINFO:/.test(l)) {
      setEl('net-info-bar', l.replace(/^\+NWINFO:/, ''));
      setNetState('on');
    } else if (/NWSTATUS:OFF|NOT FOUND|NO_NET/i.test(l)) {
      setNetState('off');
    }
  });
}

function parseNodeList(lines) {
  lines.forEach(function (l) {
    var m = l.match(/^FIND:([0-9A-Fa-f]{4}),([0-9A-Fa-f]{16})/i);
    if (m) addNode(m[1].toUpperCase(), m[2].toUpperCase(), '?');
  });
}

/* ────────────────────────────────────────────────────────────────────
   Network Commands
   ──────────────────────────────────────────────────────────────────── */
function queryNetStatus() {
  sendCFML('MODULE_GET_NET_STATUS', 15000)
    .then(function (r) { parseNetStatus(splitResp(r)); })
    .catch(function () {});
}

function startNetwork() {
  setNetState('starting');
  logInfo('Starting network…');
  doNetworkJoin()
    .catch(function (err) {
      logFail('Start network failed: ' + (err && err.message ? err.message : err));
      setNetState('off');
      showToast('⚠ Start failed');
    });
}

/**
 * doNetworkJoin — sends MODULE_START_NETWORK.
 * Firmware sends HEX frame [55 04 00 02 00 02] to E180.
 * E180 echoes the frame on success, then fires async NOTIFY_NET_OPEN (0x80/0x02).
 */
function doNetworkJoin() {
  return sendCFML('MODULE_START_NETWORK', 15000)
    .then(function (r) {
      var lines = splitResp(r);
      var failed = lines.some(function (l) { return /^FAIL:|INVALID/i.test(l); });
      if (failed) {
        setNetState('off');
        showToast('⚠ Network join failed');
        return;
      }
      /* Check for HEX frame ACK (Type=0x00, Code=0x02) or legacy text */
      var hexConfirmed = lines.some(function (l) { return /^55\s/i.test(l); });
      var textConfirmed = lines.some(function (l) {
        return /NETOPEN|\+CREATENW:0|NETWORK UP/i.test(l);
      });
      if (hexConfirmed || textConfirmed) {
        setNetState('on');
        showToast('Network started ✓');
      } else {
        setNetState('starting');
        showToast('Joining… await NETOPEN event');
      }
      parseNetStatus(lines);
    });
}

function stopNetwork() {
  sendCFML('MODULE_STOP_NETWORK', 15000)
    .then(function () {
      state.networkUp = false;
      setNetState('off');
      setEl('net-info-bar', '—');
      showToast('Network stopped');
    })
    .catch(function () {
      state.networkUp = false;
      setNetState('off');
    });
}

function openPermitJoin() {
  /* MODULE_SET_PERMIT_JOIN sends [55 04 00 02 00 02] — opens network for 180s */
  logInfo('Opening permit join window (180 s)…');
  sendCFML('MODULE_SET_PERMIT_JOIN', 15000)
    .then(function (r) {
      var lines = splitResp(r);
      var opened = lines.some(function (l) {
        return /NETOPEN|OK/i.test(l) || /^55\s/i.test(l);
      });
      showToast(opened ? 'Permit join open — 180 s ✓' : 'Permit join sent');
      if (opened) setNetState('on');
    })
    .catch(function () {});
}

function autoFind() {
  logInfo('Auto-finding nodes…');
  sendCFML('MODULE_AUTO_FIND_TARGET', 5000)
    .then(function () {
      showToast('Finding… nodes will appear when discovered');
      if (state.selectedNode) bindSelectedNode();
    })
    .catch(function () {});
}

/**
 * bindSelectedNode — sets destination address and endpoint on coordinator.
 * Builds proper Ebyte HEX frames (Type=0x00, Code=0x11) for both commands.
 */
function bindSelectedNode() {
  var t = getTarget();

  /* Build Set Dest Addr frame: Type=0x00, Code=0x11, Data=[Port(00), Attr(01 00), ShortAddr LE] */
  var addrL = parseInt(t.s.substring(2, 4), 16);
  var addrH = parseInt(t.s.substring(0, 2), 16);
  var addrFrame = buildEbyteFrame(0x00, 0x11, [0x00, 0x01, 0x00, addrL, addrH]);

  /* Build Set Dest EP frame: Type=0x00, Code=0x11, Data=[Port(00), Attr(02 00), EP] */
  var epVal = parseInt(t.ep, 16);
  var epFrame = buildEbyteFrame(0x00, 0x11, [0x00, 0x02, 0x00, epVal]);

  sendCFML('MODULE_SET_DEST_ADDR:' + bytesToHexStr(addrFrame), 3000)
    .then(function () { return sendCFML('MODULE_SET_DEST_EP:' + bytesToHexStr(epFrame), 3000); })
    .then(function () {
      logOk('Dest → 0x' + t.s + ':' + t.ep);
      showToast('Bound to 0x' + t.s + ' ✓');
    })
    .catch(function () {});
}

function setNetState(st) {
  state.networkUp = (st === 'on');
  var b = ge('net-badge');
  if (b) {
    b.setAttribute('data-state', st);
    b.textContent = st === 'on' ? 'ON' : st === 'starting' ? '…' : 'OFF';
  }
  var p = ge('status-pill');
  if (p) p.setAttribute('data-state', st);
  setEl('status-text', st === 'on' ? 'Network ON' : st === 'starting' ? 'Starting…' : 'OFF');
  saveLocalState();
}

/* ────────────────────────────────────────────────────────────────────
   Node Management
   ──────────────────────────────────────────────────────────────────── */
function addNode(short, ieee, type) {
  var names    = { '0': 'Coordinator', '1': 'Router', '2': 'End Device', '?': 'Unknown' };
  var existing = state.nodes[short];
  state.nodes[short] = {
    ieee: ieee,
    type: names[type] || (existing ? existing.type : type),
    ep:   existing ? existing.ep : state.ep
  };
  renderNodeList();
  saveLocalState();
}

function selectNode(short) {
  state.selectedNode = short;
  state.shortAddr    = short;
  var n = state.nodes[short];
  if (n && n.ep) state.ep = n.ep;
  renderNodeList();
  updateControlPanel();
  saveLocalState();
}

function deleteNode() {
  if (!state.selectedNode) return;
  var addr = state.selectedNode;
  var sp = ge('overlay-spinner');
  if (sp) sp.classList.remove('hidden');
  setEl('overlay-msg', 'Removing node ' + addr + '…');
  var ov = ge('ctrl-overlay');
  if (ov) ov.classList.remove('hidden');

  sendCFML('MODULE_DELETE_NODE:' + addr, 15000)
    .then(function () {
      delete state.nodes[addr];
      state.selectedNode = null;
      renderNodeList();
      updateControlPanel();
      saveLocalState();
      showToast('Node ' + addr + ' removed');
    })
    .catch(function () {
      var ov2 = ge('ctrl-overlay');
      if (ov2) ov2.classList.add('hidden');
      var sp2 = ge('overlay-spinner');
      if (sp2) sp2.classList.add('hidden');
      showToast('⚠ Delete failed');
    });
}

/* ────────────────────────────────────────────────────────────────────
   Cluster Selection
   ──────────────────────────────────────────────────────────────────── */
function selectCluster(cl) {
  state.cluster = cl;
  updateClusterTabs();
  updateControlPanel();
  saveLocalState();
}

/* ────────────────────────────────────────────────────────────────────
   ZCL Helpers
   ──────────────────────────────────────────────────────────────────── */
function getTarget() {
  return {
    s:  (state.shortAddr || '0000').toUpperCase(),
    ep: (state.ep        || '01').toUpperCase(),
    cl: (state.cluster   || '0006').toUpperCase()
  };
}

/* ────────────────────────────────────────────────────────────────────
   ZCL On/Off (cluster 0006)
   Sends addressed ZCL On/Off command via HEX frame.
   CmdID: 0x00=Off, 0x01=On, 0x02=Toggle
   ──────────────────────────────────────────────────────────────────── */
function onOnOffToggle(checked) {
  if (!state.selectedNode) {
    var tog = ge('onoff-toggle');
    if (tog) tog.checked = !checked;
    showToast('Select a node first');
    return;
  }
  state.onOffState = checked;
  setEl('onoff-status-text', checked ? 'ON' : 'OFF');
  var wrap = ge('onoff-icon-wrap');
  if (wrap) wrap.setAttribute('data-on', checked ? 'true' : 'false');
  setEl('onoff-icon', checked ? '💡' : '🔦');
  /* ZCL On/Off: cmdId 0x01=On, 0x00=Off — addressed to selected node */
  var t = getTarget();
  sendZclCommand(t.s, t.ep, '0006', checked ? '01' : '00', [], 5000)
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   ZCL Color Control (cluster 0300) — 5 fixed colors
   ──────────────────────────────────────────────────────────────────── */
function sendFixedColor(hexStr, btnEl) {
  if (!state.selectedNode) { showToast('Select a node first'); return; }
  var rgb = hexToRgb('#' + hexStr);
  if (!rgb) return;
  var t  = getTarget();
  /* Convert sRGB → CIE 1931 XY for ZCL Color Control cluster */
  var xy = rgbToXY(rgb.r, rgb.g, rgb.b);
  var xH = Math.round(xy.x * 65535).toString(16).toUpperCase();
  var yH = Math.round(xy.y * 65535).toString(16).toUpperCase();
  while (xH.length < 4) xH = '0' + xH;
  while (yH.length < 4) yH = '0' + yH;
  /* Update preview */
  var cp = ge('color-preview');
  if (cp) { cp.style.background = '#' + hexStr; cp.style.boxShadow = '0 0 14px #' + hexStr + '88'; }
  setEl('color-hex-label', '#' + hexStr.toUpperCase());
  /* Mark active button */
  var btns = (_root || document).querySelectorAll('.btn-color');
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
  if (btnEl) btnEl.classList.add('active');
  logInfo('Sending color #' + hexStr.toUpperCase());
  /* ZCL cmd 0x07 = Move to Color XY
     params: colorX(2B LE), colorY(2B LE), transitionTime(2B LE = 0x000A = 1s) */
  var xInt = Math.round(xy.x * 65535);
  var yInt = Math.round(xy.y * 65535);
  sendZclCommand(t.s, t.ep, '0300', '07',
    [xInt & 0xFF, (xInt >> 8) & 0xFF,
     yInt & 0xFF, (yInt >> 8) & 0xFF,
     0x0A, 0x00],
    15000).then(function () { showToast('Color sent ✓'); })
          .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   ZCL Temperature Read (cluster 0402)
   ──────────────────────────────────────────────────────────────────── */
function readTempAttr() {
  if (!state.selectedNode) { showToast('Select a node first'); return; }
  var t = getTarget();
  sendZclReadAttr(t.s, t.ep, '0402', '0000', 15000)
    .then(function (r) {
      var lines = splitResp(r);
      for (var i = 0; i < lines.length; i++) {
        /* Try HEX frame parsing (0x82/0x00 read attr response) */
        if (/^55\s/i.test(lines[i])) {
          var frame = parseEbyteFrame(lines[i]);
          if (frame && frame.type === 0x82 && frame.code === 0x00) {
            handleZclReadAttrRsp(frame.data);
            return;
          }
        }
        /* Legacy AT text fallback */
        var m = lines[i].match(/\+ATTRREAD:.*,([0-9A-Fa-f]+)$/i);
        if (m) {
          var raw = parseInt(m[1], 16);
          if (raw > 32767) raw -= 65536;
          setEl('temp-val', (raw / 100.0).toFixed(1));
          return;
        }
      }
    })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Advanced ZCL Operations
   ──────────────────────────────────────────────────────────────────── */
function readAttribute() {
  var attrId = (ge('inp-attr-id') ? ge('inp-attr-id').value.trim().toUpperCase() : '') || '0000';
  var t = getTarget();
  sendZclReadAttr(t.s, t.ep, t.cl, attrId, 15000)
    .then(function (r) {
      var lines = splitResp(r);
      for (var i = 0; i < lines.length; i++) {
        /* HEX frame read response */
        if (/^55\s/i.test(lines[i])) {
          var frame = parseEbyteFrame(lines[i]);
          if (frame && frame.type === 0x82 && frame.code === 0x00 && frame.data.length >= 16) {
            var status = frame.data[14];
            if (status === 0x00) {
              var dataType = frame.data[15];
              var parsed = parseZclAttrValue(frame.data, 16, dataType);
              setEl('attr-read-result', '0x' + parsed.hex + ' (' + parsed.val + ')');
              return;
            }
            setEl('attr-read-result', 'Status: 0x' + pad2(status));
            return;
          }
        }
        /* Legacy AT text fallback */
        var m = lines[i].match(/\+ATTRREAD:.*,([^,]+)$/i);
        if (m) { setEl('attr-read-result', m[1].trim()); return; }
      }
      setEl('attr-read-result', '—');
    })
    .catch(function () {});
}

function writeAttribute() {
  var inp = ge('inp-write-val');
  var v   = inp ? inp.value.trim() : '';
  if (!v) { showToast('Format: AttrID,Type,Value'); return; }
  var t = getTarget();
  sendCFML('MODULE_ZCL_WRITE_ATTR:' + t.s + ',' + t.ep + ',' + t.cl + ',' + v, 15000)
    .then(function () { showToast('Write sent ✓'); })
    .catch(function () {});
}

function sendZclCmd() {
  var inp = ge('inp-zcl-cmd');
  var v   = inp ? inp.value.trim() : '';
  if (!v) { showToast('Format: CmdID[,data]'); return; }
  var t = getTarget();
  sendZclCommand(t.s, t.ep, t.cl, v, null, 15000)
    .then(function () { showToast('Cmd sent ✓'); })
    .catch(function () {});
}

/* ────────────────────────────────────────────────────────────────────
   Rendering
   ──────────────────────────────────────────────────────────────────── */
function renderNodeList() {
  var list  = ge('node-list');
  var addrs = Object.keys(state.nodes);
  setEl('node-count', String(addrs.length));
  if (!list) return;
  if (!addrs.length) {
    list.innerHTML =
      '<div class="empty-state"><div class="empty-icon">🔶</div>' +
      '<div class="empty-msg">Start network &amp;<br>open Permit Join</div></div>';
    return;
  }
  list.innerHTML = addrs.map(function (a) {
    var n   = state.nodes[a];
    var sel = (a === state.selectedNode) ? ' selected' : '';
    var icon = n.type === 'Coordinator' ? '🌐' : n.type === 'Router' ? '🔁' : '💡';
    return '<div class="node-item' + sel + '" onclick="selectNode(\'' + escapeJs(a) + '\')">' +
      '<span class="node-icon">' + icon + '</span>' +
      '<div class="node-info">' +
        '<span class="node-name">0x' + escapeHtml(a) + '</span>' +
        '<span class="node-addr">' + escapeHtml(n.type || '?') + ' EP:' + escapeHtml(n.ep || '--') + '</span>' +
      '</div></div>';
  }).join('');
}

function syncSlotSelect() {
  var s = ge('cfg-slot');
  if (s) s.value = state.slot;
}

function updateControlPanel() {
  var hasNode = !!state.selectedNode;
  var ov = ge('ctrl-overlay');
  if (ov) ov.classList.toggle('hidden', hasNode);

  if (hasNode) {
    var n = state.nodes[state.selectedNode] || {};
    setEl('hero-name', '0x' + state.selectedNode);
    setEl('hero-sub', (n.ieee ? n.ieee.substring(0, 8) + '…' : '—') +
      (n.type ? '  ' + n.type : ''));
    setEl('hero-ep-val', (state.ep || '01').toUpperCase());
    var hi = ge('hero-icon');
    if (hi) hi.classList.add('active');
    var bd = ge('btn-del-node');
    if (bd) bd.classList.remove('hidden');
  } else {
    setEl('hero-name', '— Select a node —');
    setEl('hero-sub', '—');
    setEl('hero-ep-val', '—');
    var hi2 = ge('hero-icon');
    if (hi2) hi2.classList.remove('active');
    var bd2 = ge('btn-del-node');
    if (bd2) bd2.classList.add('hidden');
  }

  /* Show/hide ZCL sections based on selected cluster */
  var sections = { '0006': 'section-onoff',
                   '0300': 'section-color', '0402': 'section-temp' };
  Object.keys(sections).forEach(function (cl) {
    var el = ge(sections[cl]);
    if (el) el.classList.toggle('hidden', cl !== state.cluster);
  });

  /* Sync toggle state */
  var tog = ge('onoff-toggle');
  if (tog) tog.checked = state.onOffState;
  setEl('onoff-status-text', state.onOffState ? 'ON' : 'OFF');
  var wrap = ge('onoff-icon-wrap');
  if (wrap) wrap.setAttribute('data-on', state.onOffState ? 'true' : 'false');
  setEl('onoff-icon', state.onOffState ? '💡' : '🔦');
}

function updateClusterTabs() {
  if (!_root) return;
  var tabs = _root.querySelectorAll('.btn-cluster-tab');
  for (var i = 0; i < tabs.length; i++) {
    var cl = tabs[i].getAttribute('data-cluster');
    tabs[i].classList.toggle('active', cl === state.cluster);
  }
}

/* ────────────────────────────────────────────────────────────────────
   LocalStorage Persistence
   ──────────────────────────────────────────────────────────────────── */
function saveLocalState() {
  try {
    localStorage.setItem('da2_zb_v2', JSON.stringify({
      slot:       state.slot,
      ep:         state.ep,
      cluster:    state.cluster,
      hue:        state.hue,
      brightness: state.brightness
    }));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem('da2_zb_v2');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.slot)              state.slot       = s.slot;
    if (s.ep)                state.ep         = s.ep;
    if (s.cluster)           state.cluster    = s.cluster;
    if (s.hue      !== undefined) state.hue        = s.hue;
    if (s.brightness !== undefined) state.brightness = s.brightness;
  } catch (e) {}
}

/* ────────────────────────────────────────────────────────────────────
   Console
   ──────────────────────────────────────────────────────────────────── */
function logToConsole(cls, msg) {
  var el   = ge('console-log');
  var text = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  if (!el) { console.log('[ZB-' + cls + '] ' + text); return; }
  var line = document.createElement('div');
  line.className   = cls;
  line.textContent = text;
  el.appendChild(line);
  while (el.children.length > 300) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function logTx  (m) { logToConsole('log-tx',   '→ ' + m); }
function logOk  (m) { logToConsole('log-ok',   '✓ ' + m); }
function logFail(m) { logToConsole('log-fail',  '✗ ' + m); }
function logInfo(m) { logToConsole('log-info',  'ℹ ' + m); }
function logWarn(m) { logToConsole('log-info',  '⚠ ' + m); }
function logEvt (m) { logToConsole('log-evt',   '⚡ ' + m); }
function clearLog() { var el = ge('console-log'); if (el) el.innerHTML = ''; }

/* ────────────────────────────────────────────────────────────────────
   Utilities
   ──────────────────────────────────────────────────────────────────── */
function ge(id)        { return document.getElementById(id); }
function setEl(id, v)  { var el = ge(id); if (el) el.textContent = v; }

function showToast(msg) {
  var t = ge('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.add('hidden'); }, 2400);
}

function pad2(n) { return ('0' + (Math.round(n) & 0xFF).toString(16)).slice(-2).toUpperCase(); }

function pad4(n) { return ('000' + (n & 0xFFFF).toString(16)).slice(-4).toUpperCase(); }

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeJs(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

function hexToRgb(hex) {
  var m = (hex || '').replace('#','').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : null;
}

function toHex2(n) {
  return ('0' + Math.min(255, Math.max(0, Math.round(n))).toString(16)).slice(-2).toUpperCase();
}

/* sRGB → CIE 1931 XY (Philips Wide Gamut matrix) */
function rgbToXY(r, g, b) {
  function lin(c) {
    c = c / 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  }
  var R = lin(r), G = lin(g), B = lin(b);
  var X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  var Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  var Z = R * 0.000088 + G * 0.072310 + B * 0.986039;
  var sum = X + Y + Z;
  return (sum === 0) ? { x: 0.3127, y: 0.3290 } : { x: X / sum, y: Y / sum };
}

/* ────────────────────────────────────────────────────────────────────
   Expose to ThingsBoard HTML onclick attributes
   ──────────────────────────────────────────────────────────────────── */
window.onSlotChange      = function (v) { state.slot = v; saveLocalState(); };
window.startNetwork      = startNetwork;
window.stopNetwork       = stopNetwork;
window.openPermitJoin    = openPermitJoin;
window.autoFind          = autoFind;
window.bindSelectedNode  = bindSelectedNode;
window.selectNode        = selectNode;
window.deleteNode     = deleteNode;
window.selectCluster  = selectCluster;
window.onOnOffToggle  = onOnOffToggle;
window.sendFixedColor = sendFixedColor;
window.readTempAttr   = readTempAttr;
window.readAttribute  = readAttribute;
window.writeAttribute = writeAttribute;
window.sendZclCmd     = sendZclCmd;
window.clearLog       = clearLog;
