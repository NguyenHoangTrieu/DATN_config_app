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

/* =====================================================================
   ── CONFIGURATION ──────────────────────────────────────────────────
   Tune these values to match your network latency and device response
   time. Increase RPC_MIN_GAP_MS if you still see 504 errors.

   RPC 504 root causes:
     1. E180 module drops a ZCL request if one transaction is already
        in-flight (no internal queue) → gateway never gets a reply →
        ThingsBoard times out the RPC → 504.
     2. Two sendCFML calls racing to the server within a few hundred ms
        both block on the same gateway serial port → second one starves.
   Both are fixed by serializing ALL RPCs through a single promise queue
   with a minimum inter-command gap of RPC_MIN_GAP_MS.
   ===================================================================== */
var CFG = {
  RPC_MIN_GAP_MS:   1000,   /* minimum ms between consecutive RPC calls (≥1000 recommended) */
  SENSOR_POLL_MS:   3000,   /* how often each sensor node is enqueued for a poll cycle       */
  SENSOR_NODE_GAP:   1000,   /* ms pause between finishing one node's reads and starting next */
};

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
/* ── Raw line forwarder (receives raw telemetry lines from Monitor widget) ── */
var g_rawLineHandler  = null;
/* ── Active polling timers: shortAddr → setInterval ID ───────────────────── */
/* Stored outside state so they are never serialised to localStorage.     */
var g_pollTimers = {};
/* ── Piggyback cooldown: shortAddr → timestamp of last temp read (ms) ─────── */
var g_lastTempReadTs = {};
/* ── Delete-in-flight flag: shortAddr → true while DELETE RPC is pending ───── */
var g_deletePending = {};
/* ── Delete FAIL observed via telemetry while delete was pending ────────────── */
var g_deleteOnlineFail = {};
/* ── Auto-verify queue: serialize auth reads so concurrent announces don't
   cause simultaneous RPCs → 504. Each item: { short, ep }.               ── */
var g_verifyQueue   = [];
var g_verifyRunning = false;

/* ── Global sensor poll queue: serializes ALL ZCL reads across ALL sensor nodes.
   Prevents concurrent RPCs to different nodes (E180 drops 2nd request → 504).
   Items: { shortAddr, ep }. One node's temp+humid reads finish before next
   node starts. Each node enqueues itself every 3 s via its own setInterval.  ── */
var g_sensorPollQueue = [];
var g_sensorPollBusy  = false;

/* Read one cluster attribute (0000) — returns promise, resolves on success OR timeout */
function doSensorReadCluster(sAddr, sEp, cluster) {
  return sendZclReadAttr(sAddr, sEp, cluster, '0000', 5000)
    .then(function (r) {
      var lines = splitResp(r);
      for (var i = 0; i < lines.length; i++) {
        if (/^55\s/i.test(lines[i])) {
          var frame = parseEbyteFrame(lines[i]);
          if (frame && frame.type === 0x82 && frame.code === 0x00) {
            handleZclReadAttrRsp(frame.data);
            return;
          }
        }
      }
    })
    .catch(function () {});
}

/* Enqueue a sensor node for polling. Deduplicates — only one entry per node. */
function enqueueSensorPoll(shortAddr, ep) {
  var n = state.nodes[shortAddr];
  if (!n || !n.connected) return;
  for (var qi = 0; qi < g_sensorPollQueue.length; qi++) {
    if (g_sensorPollQueue[qi].shortAddr === shortAddr) return; /* already queued */
  }
  g_sensorPollQueue.push({ shortAddr: shortAddr, ep: ep });
  if (!g_sensorPollBusy) drainSensorPollQueue();
}

/* Process queue one node at a time: temp → humid → next node */
function drainSensorPollQueue() {
  if (!g_sensorPollQueue.length) { g_sensorPollBusy = false; return; }
  g_sensorPollBusy = true;
  var item = g_sensorPollQueue.shift();
  var n = state.nodes[item.shortAddr];
  if (!n || !n.connected) {
    /* Node disconnected — skip, process next immediately */
    drainSensorPollQueue();
    return;
  }
  /* Sequential reads: temp first, then humid (same node, back-to-back, no overlap) */
  doSensorReadCluster(item.shortAddr, item.ep, '0402')
    .then(function () { return doSensorReadCluster(item.shortAddr, item.ep, '0405'); })
    .then(function () { setTimeout(drainSensorPollQueue, CFG.SENSOR_NODE_GAP); }); /* gap before next node */
}

function queueAutoVerify(short, ep) {
  /* Skip if already verified, already failed, or already queued */
  if (state.nodes[short] && state.nodes[short].verified === true)   return;
  if (state.nodes[short] && state.nodes[short].verifyFailed === true) return;
  for (var qi = 0; qi < g_verifyQueue.length; qi++) {
    if (g_verifyQueue[qi].short === short) return;
  }
  g_verifyQueue.push({ short: short, ep: ep });
  if (!g_verifyRunning) { runVerifyQueue(); }
}

var MAX_VERIFY_ATTEMPTS = 3;

function runVerifyQueue() {
  if (g_verifyQueue.length === 0) { g_verifyRunning = false; return; }
  g_verifyRunning = true;
  var item = g_verifyQueue.shift();
  var n = state.nodes[item.short];
  /* Node may have been deleted while queued */
  if (!n) { setTimeout(runVerifyQueue, 200); return; }
  /* Already verified or permanently failed — skip */
  if (n.verified || n.verifyFailed) { setTimeout(runVerifyQueue, 200); return; }

  n.verifyAttempts = (n.verifyAttempts || 0) + 1;
  logInfo('Auto-verify 0x' + item.short + ' attempt ' + n.verifyAttempts + '/' + MAX_VERIFY_ATTEMPTS + ' (reading Basic/0x0005)…');

  sendZclReadAttr(item.short, item.ep, '0000', '0005', 10000)
    .catch(function () {
      /* RPC timed out or gateway error — count as a failed attempt */
      var nn = state.nodes[item.short];
      if (!nn || nn.verified) return;
      if (nn.verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
        nn.verifyFailed = true;
        logWarn('Auto-verify GAVE UP on 0x' + item.short + ' after ' + MAX_VERIFY_ATTEMPTS + ' attempts — node blocked');
        showToast('⚠ Node 0x' + item.short + ' verify failed (3×)');
        renderNodeList();
        updateControlPanel();
        saveLocalState();
      } else {
        logWarn('Auto-verify attempt ' + nn.verifyAttempts + ' failed for 0x' + item.short + ' — will retry');
        /* Re-queue for another attempt */
        g_verifyQueue.push(item);
      }
    })
    .then(function () { setTimeout(runVerifyQueue, 500); });
}

/* ────────────────────────────────────────────────────────────────────
   ThingsBoard Lifecycle
   ──────────────────────────────────────────────────────────────────── */
self.onInit = function () {
  try {
    /* ── Pre-cleanup: remove any listeners left over from a previous onInit
       that was not paired with onDestroy (TB re-init on widget save / navigation).
       Without this, every re-init adds a new listener and the same event fires
       N times → N identical log entries and N duplicate RPC calls. ── */
    if (g_rawLineHandler) {
      window.removeEventListener('da2_raw_line', g_rawLineHandler);
      g_rawLineHandler = null;
    }
    if (g_zbmEventHandler) {
      window.removeEventListener('da2_zb_event', g_zbmEventHandler);
      g_zbmEventHandler = null;
    }
    if (g_teleSubscriber) {
      try {
        if (self.ctx && self.ctx.telemetryWsService) {
          self.ctx.telemetryWsService.unsubscribe(g_teleSubscriber);
        }
      } catch (ue) {}
      g_teleSubscriber = null;
    }

    _root = document.getElementById('zb-app-root');
    loadLocalState();
    /* On reload: keep known nodes (names, IEEEs) but reset connection state —
       actual Zigbee sessions don't survive a page reload. */
    Object.keys(state.nodes).forEach(function (addr) {
      if (state.nodes[addr]) state.nodes[addr].connected = false;
    });
    state.selectedNode = null;
    saveLocalState();
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
          keys:       ['data'],
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
      /* WS subscribe is a convenience path — data arrives via Bridge + RPC anyway */
      logInfo('WS subscribe unavailable: ' + (se && se.message ? se.message.substring(0, 60) : se));
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
          /* Fallback: if announce (0x80/0x05) is missed or arrives late, schedule
             a delayed verify. By 10 s the announce should have set node.ep;
             if not, fall back to endpoint 0x0B (standard sensor EP). */
          (function (short) {
            setTimeout(function () {
              var n = state.nodes[short];
              if (!n || n.verified) return;
              var ep = (n.ep && n.ep !== '?') ? n.ep : '0B';
              logInfo('[Auto] Fallback verify 0x' + short + ' EP:' + ep + ' (announce may have been missed)');
              queueAutoVerify(short, ep);
            }, 10000);
          }(p.short));

        } else if (d.type === 'nodeAnnounce') {
          /* Monitor received 0x80/0x05 Announce Notify — has EP */
          addNode(p.short, p.ieee || '????????????????', '?');
          if (p.ep && state.nodes[p.short]) state.nodes[p.short].ep = p.ep;
          renderNodeList();
          saveLocalState();
          logEvt('⚡ [Bridge] Node announce: 0x' + p.short + ' EP:' + p.ep);
          /* Auto-handshake: read Basic Cluster Model Identifier (0x0000/0x0005)
             to verify the DATN_AUTH_KEY and mark the node as trusted. */
          (function (short, ep) {
            setTimeout(function () { queueAutoVerify(short, ep); }, 2000);
          }(p.short, p.ep || '01'));

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

    /* ── 3. Listen for raw telemetry lines forwarded by Monitor widget ──
       Monitor widget dispatches 'da2_raw_line' for every telemetry line it
       receives. Control processes it via dispatchLine so ALL Ebyte frame
       types (announce 0x80/0x05, net-status 0x80/0x02, etc.) are handled
       directly without relying solely on the structured event bridge. */
    g_rawLineHandler = function (evt) {
      try {
        var d = evt && evt.detail;
        if (!d || !d.line) return;
        dispatchLine(d.line);
      } catch (re) { /* ignore */ }
    };
    window.addEventListener('da2_raw_line', g_rawLineHandler);
    logInfo('Raw line bridge listener registered');

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
  /* ── Remove raw line bridge listener ── */
  try {
    if (g_rawLineHandler) {
      window.removeEventListener('da2_raw_line', g_rawLineHandler);
      g_rawLineHandler = null;
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
  /* ── Clear all active poll timers ── */
  try {
    Object.keys(g_pollTimers).forEach(function (addr) {
      clearInterval(g_pollTimers[addr]);
    });
    g_pollTimers = {};
  } catch (e) {}
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
  } else if (dataType === 0x42) { /* Character String: [len(1B)][chars...] */
    var L = data[offset] || 0;
    var chars = data.slice(offset + 1, offset + 1 + L);
    var strVal = chars.map(function (c) { return String.fromCharCode(c); }).join('');
    return { val: strVal, hex: strVal, size: 1 + L };
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

/* ── Global RPC serializer (priority queue) ───────────────────────────
   All sendCFML calls go through an explicit priority queue so that
   user-triggered light control commands ('high') always execute before
   automated sensor reads and verify reads ('low').
   When a 'high' item is enqueued it is inserted in front of all 'low'
   items that are already waiting — it cannot preempt an in-flight RPC,
   but it will be next the moment the current one finishes.
   g_rpcLastEndMs tracks when the last RPC finished to calculate the
   remaining wait time before the next one may start.                 ── */
var g_cmdQueue     = [];   /* { fn, priority, resolve, reject } */
var g_cmdBusy      = false;
var g_rpcLastEndMs = 0;

/* Internal: pop next task and run it */
function _drainCmdQueue() {
  if (!g_cmdQueue.length) { g_cmdBusy = false; return; }
  g_cmdBusy = true;
  var task = g_cmdQueue.shift();
  var wait = Math.max(0, CFG.RPC_MIN_GAP_MS - (Date.now() - g_rpcLastEndMs));
  setTimeout(function () {
    task.fn()
      .then(function (v)  { g_rpcLastEndMs = Date.now(); task.resolve(v); })
      .catch(function (e) { g_rpcLastEndMs = Date.now(); task.reject(e);  })
      .then(function ()   { _drainCmdQueue(); })
      .catch(function ()  { _drainCmdQueue(); });
  }, wait);
}

/* Enqueue fn with priority 'high' | 'low' (default 'low').
   'high' items are inserted before the first 'low' item in the queue. */
function enqueueCmd(fn, priority) {
  return new Promise(function (resolve, reject) {
    var task = { fn: fn, priority: priority || 'low', resolve: resolve, reject: reject };
    if (priority === 'high') {
      /* Insert before first 'low' item — high items retain their own order */
      var idx = g_cmdQueue.length;
      for (var i = 0; i < g_cmdQueue.length; i++) {
        if (g_cmdQueue[i].priority !== 'high') { idx = i; break; }
      }
      g_cmdQueue.splice(idx, 0, task);
    } else {
      g_cmdQueue.push(task);
    }
    if (!g_cmdBusy) _drainCmdQueue();
  });
}

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
 * All calls are serialized through the priority queue with a mandatory ≥1 s gap.
 * priority: 'high' for user-triggered light commands, 'low' (default) for
 * automated sensor reads and verify operations.
 * payload: function_name for static, or function_name:params for dynamic.
 * Examples:
 *   'MODULE_START_NETWORK'
 *   'MODULE_ZCL_SEND_CONTROL_CMD:1234,0A,0006,01'
 *   'MODULE_SET_DEST_ADDR:1234'
 */
function sendCFML(payload, timeoutMs, priority) {
  var cmd = 'CFML:CFZB:' + state.slot + ':' + payload;
  return enqueueCmd(function () {
    logTx(cmd);
    return sendRPC('sendCommand', stringToHex(cmd), timeoutMs || state.rpcTimeout)
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
  }, priority || 'low');
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
 * @param {string}         [priority]     'high' for user commands, 'low' (default) for automated reads
 */
function sendZclCommand(shortAddr, ep, cluster, cmdId, extPayload, timeoutMs, priority) {
  var payBytes = Array.isArray(extPayload) ? extPayload : [];
  var frame = buildZclFrame(0x0F,
    parseInt(shortAddr, 16),
    parseInt(ep,        16),
    parseInt(cluster,   16),
    [parseInt(cmdId, 16)].concat(payBytes));
  var hexFrame = bytesToHexStr(frame);
  logInfo('ZCL Frame: ' + hexFrame);
  return sendCFML('MODULE_ZCL_SEND_CONTROL_CMD:' + hexFrame, timeoutMs || 15000, priority || 'low');
}

/**
 * sendZclReadAttr — convenience: read ZCL attribute via firmware.
 */
function sendZclReadAttr(shortAddr, ep, cluster, attrId, timeoutMs) {
  /* Build a proper Ebyte ZCL Read Attribute frame (Type=0x02, Code=0x00).
     ZCL Read Attributes payload: [NumAttr(1B)] [AttrID_L][AttrID_H] ...
     BUG FIX: first extData byte MUST be 0x01 (NumAttr=1).
     Without it the firmware receives NumAttr=0x00 and returns ESP_ERR_INVALID_RESPONSE. */
  var aH = parseInt(attrId.substring(0, 2), 16);
  var aL = parseInt(attrId.substring(2, 4), 16);
  var frame = buildZclFrame(0x00, parseInt(shortAddr, 16), parseInt(ep, 16),
                            parseInt(cluster, 16), [0x01, aL, aH]);
  var hexFrame = bytesToHexStr(frame);
  return sendCFML('MODULE_ZCL_READ_ATTR:' + hexFrame, timeoutMs || 15000);
}

/**
 * sendZclConfigureReporting — send ZCL Configure Reporting (code 0x03) to a device.
 * This tells the device to automatically push attribute reports at the given interval.
 *
 * @param {string} shortAddr      4-char hex short address
 * @param {string} ep             2-char hex endpoint
 * @param {string} cluster        4-char hex cluster ID
 * @param {string} attrId         4-char hex attribute ID
 * @param {string} dataType       2-char hex ZCL data type (e.g. '29'=int16, '21'=uint16)
 * @param {number} minInterval    Minimum reporting interval in seconds
 * @param {number} maxInterval    Maximum reporting interval in seconds (0xFFFF = disable)
 * @param {number} reportableChange  Minimum change that triggers a report (in ZCL units)
 */
function sendZclConfigureReporting(shortAddr, ep, cluster, attrId, dataType, minInterval, maxInterval, reportableChange) {
  var aH = parseInt(attrId.substring(0, 2), 16);
  var aL = parseInt(attrId.substring(2, 4), 16);
  var dt = parseInt(dataType, 16);
  /* ZCL Configure Reporting payload:
     [NumRecords(1B)] [Direction(1B)=0x00] [AttrID(2B LE)] [DataType(1B)]
     [MinInterval(2B LE)] [MaxInterval(2B LE)] [ReportableChange(2B LE)] */
  var extData = [
    0x01,                                       /* NumRecords = 1 */
    0x00,                                       /* Direction: client configures device to report */
    aL, aH,                                     /* AttrID LE */
    dt,                                         /* DataType */
    minInterval  & 0xFF, (minInterval  >> 8) & 0xFF,  /* MinInterval LE */
    maxInterval  & 0xFF, (maxInterval  >> 8) & 0xFF,  /* MaxInterval LE */
    reportableChange & 0xFF, (reportableChange >> 8) & 0xFF  /* ReportableChange LE */
  ];
  var frame = buildZclFrame(0x03, parseInt(shortAddr, 16), parseInt(ep, 16),
                            parseInt(cluster, 16), extData);
  var hexFrame = bytesToHexStr(frame);
  logInfo('ZCL ConfigureReport: cl=' + cluster + ' attr=' + attrId +
    ' min=' + minInterval + 's max=' + maxInterval + 's');
  return sendCFML('MODULE_ZCL_SET_REPORT_RULE:' + hexFrame, 10000);
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
    /* ── CFZB OK response: "ZIG<ts>CFZB:<slot>:OK:<sent_hex>:<reply_hex>"
       The reply_hex is multi-frame (e.g. ACK + Confirm + ZCL ReadAttr Response
       all concatenated). Extract it and dispatch ALL frames inside it.
       Pattern: :OK: followed by sent_hex (no colons) then : then reply_hex. */
    var okM = line.match(/:OK:[^:]+(:[0-9A-Fa-f]{2}[\s0-9A-Fa-f]*)$/i);
    if (okM) {
      var replyHex = okM[1].substring(1).trim(); /* strip leading ':' */
      logOk(line);
      if (replyHex.length) parseAndDispatchAllHexFrames(replyHex);
      return;
    }
    /* Direct HEX frame response (line starts with "55 ") */
    if (/^55\s+[0-9A-Fa-f]{2}/i.test(line)) {
      logOk('HEX: ' + line.substring(0, 40) + (line.length > 40 ? '…' : ''));
      parseAndDispatchAllHexFrames(line);
      return;
    }
    if (/^FAIL:|INVALID|ERROR/i.test(line)) {
      logFail(line);
      /* If a DELETE_NODE FAIL arrives via telemetry (gateway uplink), mark it.
         The concurrent RPC may time out with 504; we'll still show the right toast. */
      if (line.indexOf('00 17') >= 0 && line.indexOf('INVALID_RESPONSE') >= 0) {
        var failM = line.match(/CFZB:\d+:FAIL:(55 [0-9A-Fa-f ]+):/i);
        if (failM && failM[1].indexOf('00 17') >= 0) {
          /* Mark all pending deletes as "device online" failure */
          Object.keys(g_deletePending).forEach(function (a) {
            g_deleteOnlineFail[a] = Date.now();
          });
        }
      }
      /* Extract embedded HEX frames from FAIL reply (last colon-delimited hex segment). */
      var failHexM = line.match(/:([0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2})+)\s*$/i);
      if (failHexM) parseAndDispatchAllHexFrames(failHexM[1]);
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
 * parseAndDispatchAllHexFrames — split a space-separated HEX string that may
 * contain multiple concatenated Ebyte frames and dispatch each individually.
 *
 * The gateway packs the ZCL ReadAttr reply as 3 frames in one uplink:
 *   [55 05 02 00 00 00 02]   ← CFG ACK
 *   [55 0A 8F 02 ...]        ← Send Confirm
 *   [55 21 82 00 ...]        ← ZCL Read Attr Response  ← carries auth key
 *
 * Without this function, handleHexEvent only sees frame 1 and drops the rest.
 */
function parseAndDispatchAllHexFrames(hexStr) {
  var bytes = hexStr.trim().split(/\s+/).map(function (b) { return parseInt(b, 16); });
  var pos = 0;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0x55) { pos++; continue; }
    if (pos + 1 >= bytes.length) break;
    var frameLen = bytes[pos + 1];       /* Ebyte Length field */
    var totalLen = 2 + frameLen;         /* 0x55 byte + Length byte + frameLen bytes */
    if (pos + totalLen > bytes.length) break;
    var frameHex = bytes.slice(pos, pos + totalLen)
      .map(function (b) { return ('0' + b.toString(16).toUpperCase()).slice(-2); })
      .join(' ');
    handleHexEvent(frameHex);
    pos += totalLen;
  }
}

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
    /* First byte 0x55 → Ebyte HEX frame(s) — may be concatenated */
    if (/^55\b/i.test(hexData)) {
      logEvt('HEX EVT: ' + hexData.substring(0, 40) + (hexData.length > 40 ? '…' : ''));
      parseAndDispatchAllHexFrames(hexData);
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
  /* Direct HEX frame(s) (line starts with "55 ") — may be concatenated */
  if (/^55\s+[0-9A-Fa-f]{2}/i.test(line)) {
    parseAndDispatchAllHexFrames(line);
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
  var epHex = pad2(epNum);
  if (existing) {
    existing.ep   = epHex;
    existing.ieee = ieee.toUpperCase();
  } else {
    addNode(shortAddr, ieee.toUpperCase(), '?');
    if (state.nodes[shortAddr]) state.nodes[shortAddr].ep = epHex;
  }
  renderNodeList();
  saveLocalState();
  /* Auto-handshake: read Basic Cluster Model Identifier to verify auth key */
  setTimeout(function () { queueAutoVerify(shortAddr, epHex); }, 2000);
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
  /* ── Auth Key handshake: ALWAYS processed, regardless of selectedNode. ──
     This MUST come before the selectedNode gate. Auto-verify fires on
     nodeAnnounce (2s after join) before the user has clicked on the node,
     so state.selectedNode is null at that point. Without this exception the
     verified flag is never set and the node stays locked behind verify-overlay. */
  if (cluster === '0000' && attr === '0005') {
    if (state.nodes[short]) {
      /* Format: "DATN_AUTH_KEY:<device_name>" or legacy "DATN_AUTH_KEY" */
      if (value === 'DATN_AUTH_KEY' || value.indexOf('DATN_AUTH_KEY:') === 0) {
        state.nodes[short].verified = true;
        var deviceName = (value.indexOf(':') >= 0) ? value.split(':')[1] : '';
        state.nodes[short].name = deviceName || ('DATN-' + short);
        logOk('Auth OK: 0x' + short + ' — name="' + state.nodes[short].name + '"');
        showToast('Auth ✓ ' + state.nodes[short].name);
        /* Flow: after auth, only the name has been read. No sensor data is fetched
           until the user clicks Connect. This satisfies requirement 1. */
      } else {
        state.nodes[short].verified = false;
        state.nodes[short].verifyAttempts = (state.nodes[short].verifyAttempts || 0) + 1;
        logWarn('Auth FAIL: 0x' + short + ' key="' + value + '" (expected DATN_AUTH_KEY...) attempt ' +
          state.nodes[short].verifyAttempts + '/' + MAX_VERIFY_ATTEMPTS);
        if (state.nodes[short].verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
          state.nodes[short].verifyFailed = true;
          showToast('⚠ Node 0x' + short + ' verify failed (3×)');
          logWarn('Auto-verify GAVE UP on 0x' + short + ' — node blocked');
        } else {
          showToast('⚠ Auth fail: ' + short);
        }
      }
      renderNodeList();
      updateControlPanel();
      saveLocalState();
      setEl('device-name-result', state.nodes[short].name || value);
    }
    return;
  }

  /* ── Temperature: only log/process from verified nodes ── */
  if (cluster === '0402' && attr === '0000') {
    if (!state.nodes[short] || state.nodes[short].verified !== true) return;
    var raw = parseInt(value, 16);
    if (raw > 32767) raw -= 65536;
    var tempC = (raw / 100.0).toFixed(1);
    logEvt('🌡 0x' + short + ' Temp = ' + tempC + ' °C (→ Monitor)');
    g_lastTempReadTs[short] = Date.now();
    state.nodes[short].lastTemp = tempC;   /* persist for state save */
    saveLocalState();
    /* Bridge to Monitor via CustomEvent (same window — storage event won't fire) */
    var epT = (state.nodes[short] && state.nodes[short].ep) || '0B';
    try { window.dispatchEvent(new CustomEvent('da2_ctrl_bridge', { detail: { ts: Date.now(), line: 'RPT:' + short + ',' + epT + ',0402,0000,29,' + value } })); } catch (e) {}
    return;
  }

  /* ── Humidity: only log/process from verified nodes ── */
  if (cluster === '0405' && attr === '0000') {
    if (!state.nodes[short] || state.nodes[short].verified !== true) return;
    var humid = (parseInt(value, 16) / 100.0).toFixed(1);
    logEvt('💧 0x' + short + ' Humid = ' + humid + ' %RH (→ Monitor)');
    state.nodes[short].lastHumid = humid;   /* persist for state save */
    saveLocalState();
    /* Bridge to Monitor via CustomEvent (same window — storage event won't fire) */
    var epH = (state.nodes[short] && state.nodes[short].ep) || '0B';
    try { window.dispatchEvent(new CustomEvent('da2_ctrl_bridge', { detail: { ts: Date.now(), line: 'RPT:' + short + ',' + epH + ',0405,0000,21,' + value } })); } catch (e) {}
    return;
  }

  /* For all other clusters: only process the currently-selected node */
  if (short !== state.selectedNode) return;

  /* ── Gatekeeper: drop control data from unverified nodes ── */
  if (!state.nodes[short] || state.nodes[short].verified !== true) {
    logWarn('Drop payload from unverified 0x' + short + ' (Cl:' + cluster + ' At:' + attr + ')');
    return;
  }

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
  var entry = {
    ieee: ieee,
    type: names[type] || (existing ? existing.type : type),
    ep:   existing ? existing.ep : '?',
    verified:       existing ? existing.verified       : false,  /* false until auth handshake passes */
    connected:      existing ? existing.connected      : false,  /* false until user clicks Connect */
    verifyAttempts: existing ? existing.verifyAttempts : 0,      /* number of auth read attempts made */
    verifyFailed:   existing ? existing.verifyFailed   : false   /* true after MAX_VERIFY_ATTEMPTS failures */
  };
  /* Preserve device name and auth state if already resolved via Basic Cluster */
  if (existing && existing.name) entry.name = existing.name;
  state.nodes[short] = entry;
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

/**
 * isSensorNode — return true if the node's name indicates it is a sensor device.
 * Used to choose between sensor data display and bulb control display.
 */
function isSensorNode(n) {
  var nm = ((n && n.name) || '').toLowerCase();
  return nm.indexOf('sensor') >= 0 || nm.indexOf('temp') >= 0 ||
         nm.indexOf('humid') >= 0  || nm.indexOf('motion') >= 0 ||
         nm.indexOf('pir') >= 0    || nm.indexOf('contact') >= 0 ||
         nm.indexOf('door') >= 0   || nm.indexOf('window') >= 0;
}

/**
 * toggleNodeConnect — Connect/Disconnect the data stream for a node.
 *
 * SENSOR (detected by name):
 *   ON  connect : send ZCL Configure Reporting to device (5s interval) so the
 *                 device starts pushing temp+humid; also do an immediate read.
 *   ON  disconnect: send Configure Reporting with maxInterval=0xFFFF to stop.
 *   Falls back to polling if Configure Reporting is not acked.
 *
 * BULB / other:
 *   ON  connect : show control panel (on/off, color) — no data polling needed.
 *   ON  disconnect: hide control panel.
 */
function toggleNodeConnect(shortAddr) {
  var n = state.nodes[shortAddr];
  if (!n) return;
  n.connected = !n.connected;

  if (n.connected) {
    var ep = n.ep || '0B';

    if (isSensorNode(n)) {
      /* ── SENSOR CONNECT ───────────────────────────────────────────────
         Enqueues this node into the global sensor poll queue every 3 s.
         The queue reads temp (0x0402) then humid (0x0405) sequentially —
         no concurrent ZCL transactions. Multiple sensor nodes are also
         serialized through the same queue (one node at a time).           */
      logInfo('🔗 Sensor connect 0x' + shortAddr + ' — starting polling…');

      /* Immediate poll on connect */
      enqueueSensorPoll(shortAddr, ep);

      /* 3 s tick: enqueue this node — queue drains sequentially */
      if (g_pollTimers[shortAddr]) { clearInterval(g_pollTimers[shortAddr]); }
      g_pollTimers[shortAddr] = setInterval(function () {
        var nn = state.nodes[shortAddr];
        if (!nn || !nn.connected) {
          clearInterval(g_pollTimers[shortAddr]);
          delete g_pollTimers[shortAddr];
          return;
        }
        enqueueSensorPoll(shortAddr, ep);
      }, CFG.SENSOR_POLL_MS);

      logInfo('✓ Sensor 0x' + shortAddr + ' polling active (3s queue)');

    } else {
      /* ── BULB / other: just enable the control panel — no data polling ── */
      logInfo('🔗 Bulb connected 0x' + shortAddr + ' — control panel active');
    }

  } else {
    /* ── DISCONNECT ── */
    if (isSensorNode(n)) {
      logInfo('⛔ Sensor 0x' + shortAddr + ' disconnected — polling stopped');
    }
    if (g_pollTimers[shortAddr]) {
      clearInterval(g_pollTimers[shortAddr]);
      delete g_pollTimers[shortAddr];
    }
    logInfo('⛔ Disconnected 0x' + shortAddr);
  }

  renderNodeList();
  updateControlPanel();
  saveLocalState();
}


function deleteNode() {
  if (!state.selectedNode) return;
  var addr = state.selectedNode;
  var node = state.nodes[addr];

  if (!node || !node.ieee || node.ieee.indexOf('?') !== -1) {
    showToast('Cannot delete: MAC address unknown');
    return;
  }

  /* Build 8-byte MAC array in Little-Endian order from the 16-char IEEE string */
  var macBytes = [];
  for (var i = 14; i >= 0; i -= 2) {
    macBytes.push(parseInt(node.ieee.substring(i, i + 2), 16));
  }

  /* Ebyte Type=0x00 Code=0x17 (Kick Device) — payload is 8-byte LE MAC */
  var frame    = buildEbyteFrame(0x00, 0x17, macBytes);
  var hexFrame = bytesToHexStr(frame);

  /* Mark delete as pending — blocks piggyback reads during the operation */
  g_deletePending[addr]    = true;
  g_deleteOnlineFail[addr] = false;
  /* Also extend temp cooldown for this device so piggyback can't sneak in */
  g_lastTempReadTs[addr]   = Date.now() + 20000;

  sendCFML('MODULE_DELETE_NODE:' + hexFrame, 15000)
    .then(function (resp) {
      /* sendCFML always RESOLVES even on FAIL (the RPC transport succeeded).
         We must inspect the text to detect a gateway-side failure. */
      var r = resp != null
        ? String(typeof resp === 'object' ? JSON.stringify(resp) : resp)
        : '';
      var isFailText   = r.indexOf(':FAIL:') >= 0;
      var isOnlineText = r.indexOf('INVALID_RESPONSE') >= 0 || r.indexOf('FF E8') >= 0;
      var isOnlineTele = !!g_deleteOnlineFail[addr];
      delete g_deletePending[addr];
      delete g_deleteOnlineFail[addr];
      if (isFailText && (isOnlineText || isOnlineTele)) {
        showToast('⚠ Device is online — power it off first');
        logWarn('DELETE_NODE: device online (0xFF) — node kept in state.');
        return;
      }
      if (isFailText) {
        showToast('⚠ Delete failed: ' + r.substring(0, 40));
        return;
      }
      delete state.nodes[addr];
      if (g_pollTimers[addr]) { clearInterval(g_pollTimers[addr]); delete g_pollTimers[addr]; }
      state.selectedNode = null;
      renderNodeList();
      updateControlPanel();
      saveLocalState();
      showToast('Node ' + addr + ' removed');
    })
    .catch(function (err) {
      var msg = (err && err.message) ? err.message : String(err);
      var is504       = msg.indexOf('504') >= 0;
      var isOnlineTel = !!g_deleteOnlineFail[addr];
      delete g_deletePending[addr];
      delete g_deleteOnlineFail[addr];
      /* 504 with a prior FAIL-via-telemetry = device was online */
      if (is504 && isOnlineTel) {
        showToast('⚠ Device is online — power it off first');
        logWarn('DELETE_NODE: device online (seen via telemetry), RPC returned 504.');
      } else if (is504) {
        showToast('⚠ Delete timed out — if device is online, power it off first');
        logWarn('DELETE_NODE: 504 timeout (concurrent RPC may have interfered).');
      } else {
        showToast('⚠ Delete failed: ' + msg.substring(0, 40));
        logWarn('DELETE_NODE error: ' + msg);
      }
    });
}

/**
 * kickNode — send ZDO Remove Device (Type=0x01, Code=0x34) to eject a node
 * from the network while allowing it to rejoin when Permit Join is next opened.
 *
 * Frame layout built by buildZdoFrame(0x34, shortInt, params):
 *   [0x55][len][0x01][0x34][shortL][shortH][MAC(8B LE)][Re-entry=0x01][DeleteChild=0x00][chk]
 *
 * Re-entry=0x01  : device is allowed back into the network (soft kick, not ban)
 * DeleteChild=0x00: do not remove child entries of the kicked node
 *
 * Expected response from E180: Type=0x05, Code=0x01 (execution status)
 * Async follow-up: 0x80/0x06 Leave Notify → handleNodeLeaveNotify removes node from state
 *
 * End-device firmware must call Zigbee.factoryReset() after REJOIN_TIMEOUT_MS
 * of being disconnected so it performs a full channel scan and rejoins.
 */
function kickNode() {
  if (!state.selectedNode) return;
  var addr = state.selectedNode;
  var node = state.nodes[addr];

  if (!node || !node.ieee || node.ieee.indexOf('?') !== -1) {
    showToast('Cannot kick: MAC address unknown');
    return;
  }

  /* Build 8-byte MAC array in Little-Endian order from 16-char IEEE string */
  var macBytes = [];
  for (var i = 14; i >= 0; i -= 2) {
    macBytes.push(parseInt(node.ieee.substring(i, i + 2), 16));
  }

  /* Parse short address as integer */
  var shortInt = parseInt(addr, 16);

  /* buildZdoFrame prepends [shortL, shortH] then appends params:
     params = MAC(8B LE) + Re-entry(0x01) + DeleteChild(0x00) */
  var params   = macBytes.concat([0x01, 0x00]);
  var frame    = buildZdoFrame(0x34, shortInt, params);
  var hexFrame = bytesToHexStr(frame);

  /* Stop data polling immediately — node is leaving */
  if (g_pollTimers[addr]) { clearInterval(g_pollTimers[addr]); delete g_pollTimers[addr]; }

  /* Mark disconnected now; 0x80/0x06 Leave Notify will remove from state */
  node.connected = false;
  renderNodeList();
  updateControlPanel();

  logInfo('KICK (MODULE_DELETE_NODE) 0x' + addr + ': ZDO Remove Device (re-entry=1), frame: ' + hexFrame);

  sendCFML('MODULE_DELETE_NODE:' + hexFrame, 8000)
    .then(function (resp) {
      var r = resp != null
        ? String(typeof resp === 'object' ? JSON.stringify(resp) : resp)
        : '';
      var isFail = r.indexOf(':FAIL:') >= 0;
      if (isFail) {
        showToast('Kick failed — ' + r.substring(0, 40));
        logWarn('KICK_NODE gateway FAIL: ' + r.substring(0, 80));
        return;
      }
      logOk('MODULE_DELETE_NODE (kick) 0x' + addr + ' sent — awaiting Leave Notify (0x80/0x06)');
      showToast('Node 0x' + addr + ' kicked — open Permit Join to allow rejoin');
    })
    .catch(function (err) {
      var msg = (err && err.message) ? err.message : String(err);
      showToast('Kick error: ' + msg.substring(0, 40));
      logWarn('KICK_NODE error: ' + msg);
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
  sendZclCommand(t.s, t.ep, '0006', checked ? '01' : '00', [], 5000, 'high')
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
  logInfo('Sending ON + color #' + hexStr.toUpperCase());
  /* Step 1: Turn ON (cluster 0006, cmd 01) to ensure LED is lit */
  sendZclCommand(t.s, t.ep, '0006', '01', [], 5000, 'high')
    .then(function () {
      /* Step 2: Send color after ON succeeds (cluster 0300, cmd 07 = Move to Color XY)
         params: colorX(2B LE), colorY(2B LE), transitionTime(2B LE = 0x000A = 1s) */
      var xInt = Math.round(xy.x * 65535);
      var yInt = Math.round(xy.y * 65535);
      return sendZclCommand(t.s, t.ep, '0300', '07',
        [xInt & 0xFF, (xInt >> 8) & 0xFF,
         yInt & 0xFF, (yInt >> 8) & 0xFF,
         0x0A, 0x00],
        15000, 'high');
    })
    .then(function () { showToast('ON + Color sent ✓'); })
    .catch(function () { showToast('Color send failed'); });
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
   ZCL Humidity Read (cluster 0405)
   ──────────────────────────────────────────────────────────────────── */
function readHumidAttr() {
  if (!state.selectedNode) { showToast('Select a node first'); return; }
  var t = getTarget();
  sendZclReadAttr(t.s, t.ep, '0405', '0000', 15000)
    .then(function (r) {
      var lines = splitResp(r);
      for (var i = 0; i < lines.length; i++) {
        if (/^55\s/i.test(lines[i])) {
          var frame = parseEbyteFrame(lines[i]);
          if (frame && frame.type === 0x82 && frame.code === 0x00) {
            handleZclReadAttrRsp(frame.data);
            return;
          }
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

/**
 * getDeviceName — read Basic Cluster 0x0000 attr 0x0005 (Model Identifier)
 * from the currently selected node. The response is routed through
 * handleZclReadAttrRsp → handleAttrReport → stores name in state.nodes[addr].name.
 */
function getDeviceName() {
  var t = getTarget();
  if (!t.s) { showToast('Select a node first'); return; }
  setEl('device-name-result', '…');
  logTx('Read ModelIdentifier: 0x' + t.s + ' EP:' + t.ep);
  sendZclReadAttr(t.s, t.ep, '0000', '0005', 5000)
    .catch(function () { setEl('device-name-result', 'ERR'); });
}

/* ────────────────────────────────────────────────────────────────────
   Rendering
   ──────────────────────────────────────────────────────────────────── */
/** Map a node object to a display icon based on its type/device name. */
function getNodeIcon(n) {
  if (n.type === 'Coordinator') return '🌐';
  if (n.type === 'Router')      return '🔁';
  var nm = (n.name || '').toLowerCase();
  if (nm.indexOf('sensor') >= 0)                                   return '🌡️';
  if (nm.indexOf('bulb') >= 0 || nm.indexOf('light') >= 0 ||
      nm.indexOf('led')  >= 0 || nm.indexOf('lamp')  >= 0)         return '💡';
  if (nm.indexOf('switch') >= 0 || nm.indexOf('btn') >= 0)         return '🔘';
  if (nm.indexOf('plug') >= 0 || nm.indexOf('outlet') >= 0 ||
      nm.indexOf('socket') >= 0)                                   return '🔌';
  if (nm.indexOf('door') >= 0 || nm.indexOf('window') >= 0 ||
      nm.indexOf('contact') >= 0)                                  return '🚪';
  if (nm.indexOf('motion') >= 0 || nm.indexOf('pir') >= 0)         return '👁️';
  return '📡';
}

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
    var n    = state.nodes[a];
    var sel  = (a === state.selectedNode) ? ' selected' : '';
    var icon = getNodeIcon(n);
    var displayName = n.name ? escapeHtml(n.name) : '0x' + escapeHtml(a);
    var subLine     = n.name ? '0x' + escapeHtml(a) + ' · ' : '';
    subLine        += escapeHtml(n.type || '?') + ' EP:' + escapeHtml(n.ep || '--');
    var connCls  = n.connected ? ' connected' : '';
    var connTxt  = n.connected ? 'Disconnect' : 'Connect';
    return '<div class="node-item' + sel + '" onclick="selectNode(\'' + escapeJs(a) + '\')">' +
      '<span class="node-icon">' + icon + '</span>' +
      '<div class="node-info">' +
        '<span class="node-name">' + displayName + '</span>' +
        '<span class="node-addr">' + subLine + '</span>' +
      '</div>' +
      '<button class="btn-node-connect' + connCls + '" ' +
        'onclick="event.stopPropagation();toggleNodeConnect(\'' + escapeJs(a) + '\')" ' +
        'title="' + connTxt + ' telemetry stream">' + connTxt + '</button>' +
      '</div>';
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
    var heroName = n.name ? n.name + ' (0x' + state.selectedNode + ')' : '0x' + state.selectedNode;
    setEl('hero-name', heroName);
    setEl('hero-sub', (n.ieee ? n.ieee.substring(0, 8) + '…' : '—') +
      (n.type ? '  ' + n.type : ''));
    setEl('hero-ep-val', (state.ep || '01').toUpperCase());
    var hi = ge('hero-icon');
    if (hi) hi.classList.add('active');
    var bd = ge('btn-del-node');
    if (bd) bd.classList.remove('hidden');

    /* If the node has not yet passed the auth handshake, hide controls and
       show a "Verifying device…" overlay instead of the cluster sections. */
    if (n.verified !== true) {
      ['section-onoff', 'section-color'].forEach(function (id) {
        var el = ge(id); if (el) el.classList.add('hidden');
      });
      var vov = ge('verify-overlay');
      if (vov) {
        vov.classList.remove('hidden');
        /* Distinguish permanently-failed nodes from in-progress verify */
        var vmsg = vov.querySelector('.overlay-msg');
        if (vmsg) {
          if (n.verifyFailed) {
            vmsg.innerHTML = '⛔ Verify failed (3×)<br><span style="font-size:9px;opacity:0.6">Node not authorized — reset to retry</span>';
          } else {
            vmsg.innerHTML = '🔐 Verifying device…<br><span style="font-size:9px;opacity:0.6">Reading auth key from Basic Cluster</span>';
          }
        }
        var spinner = vov.querySelector('.spinner');
        if (spinner) spinner.classList.toggle('hidden', !!n.verifyFailed);
      }
      var tabs = _root ? _root.querySelectorAll('.btn-cluster-tab') : [];
      for (var t = 0; t < tabs.length; t++) tabs[t].disabled = true;
      return; /* Skip cluster section logic below */
    }

    /* Node is verified — restore tabs and hide verify overlay */
    var vov2 = ge('verify-overlay');
    if (vov2) vov2.classList.add('hidden');

    /* Detect sensor-type device by name: disable LED cluster tabs */
    var isSensor = isSensorNode(n);

    var tabs2 = _root ? _root.querySelectorAll('.btn-cluster-tab') : [];
    for (var t2 = 0; t2 < tabs2.length; t2++) {
      var cl2 = tabs2[t2].getAttribute('data-cluster');
      /* Sensor: disable lighting clusters (0006 On/Off, 0300 Color) */
      var isLightCluster = (cl2 === '0006' || cl2 === '0300');
      tabs2[t2].disabled = isSensor && isLightCluster;
      tabs2[t2].style.opacity = (isSensor && isLightCluster) ? '0.3' : '';
      tabs2[t2].title = (isSensor && isLightCluster) ? 'Not available for sensor devices' : '';
    }

    /* ── SENSOR: no control sections shown (data appears in Monitor widget) ── */
    if (isSensor) {
      ['section-onoff', 'section-color'].forEach(function (id) {
        var el = ge(id); if (el) el.classList.add('hidden');
      });
      return;
    }

    /* ── BULB / other: show control sections only when connected ── */

    if (!n.connected) {
      /* Not connected — hide all control sections */
      ['section-onoff', 'section-color'].forEach(function (id) {
        var el = ge(id); if (el) el.classList.add('hidden');
      });
      return;
    }

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
  var sections = { '0006': 'section-onoff', '0300': 'section-color' };
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

/**
 * resetState — hard-reset all widget state and clear localStorage.
 * Stops all poll timers, wipes nodes, resets network status, and
 * re-renders the UI from scratch. Called by the Reset button.
 */
function resetState() {
  /* Stop all sensor poll timers */
  var addrs = Object.keys(g_pollTimers);
  for (var i = 0; i < addrs.length; i++) { clearInterval(g_pollTimers[addrs[i]]); }
  g_pollTimers     = {};
  g_lastTempReadTs = {};

  /* Flush sensor poll queue */
  g_sensorPollQueue = [];
  g_sensorPollBusy  = false;

  /* Flush verify queue */
  g_verifyQueue   = [];
  g_verifyRunning = false;

  /* Flush RPC queue */
  g_cmdQueue     = [];
  g_cmdBusy      = false;
  g_rpcLastEndMs = 0;

  /* Reset runtime state */
  state.nodes        = {};
  state.networkUp    = false;
  state.selectedNode = null;
  state.onOffState   = false;

  /* Wipe localStorage */
  try { localStorage.removeItem('da2_zb_v2');      } catch (e) {}
  try { localStorage.removeItem('da2_ctrl_bridge'); } catch (e) {}
  try { localStorage.removeItem('da2_zbm_state');   } catch (e) {}

  /* Notify Monitor widget to clear its state too */
  try { window.dispatchEvent(new CustomEvent('da2_reset')); } catch (e) {}

  /* Re-render UI */
  setNetState('off');
  renderNodeList();
  updateControlPanel();
  saveLocalState();

  showToast('State cleared ✓');
  logInfo('🗑 Reset — all nodes and network data cleared');
}

function saveLocalState() {
  try {
    localStorage.setItem('da2_zb_v2', JSON.stringify({
      slot:         state.slot,
      ep:           state.ep,
      cluster:      state.cluster,
      hue:          state.hue,
      brightness:   state.brightness,
      networkUp:    state.networkUp,
      selectedNode: state.selectedNode,
      nodes:        state.nodes   /* includes name, ieee, type, ep, connected, lastTemp, lastHumid */
    }));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem('da2_zb_v2');
    if (!raw) return;
    var s = JSON.parse(raw);
    if (s.slot)                  state.slot         = s.slot;
    if (s.ep)                    state.ep           = s.ep;
    if (s.cluster)               state.cluster      = s.cluster;
    if (s.hue        !== undefined) state.hue        = s.hue;
    if (s.brightness !== undefined) state.brightness = s.brightness;
    if (s.networkUp  !== undefined) state.networkUp  = s.networkUp;
    if (s.selectedNode)          state.selectedNode = s.selectedNode;
    if (s.nodes && typeof s.nodes === 'object') state.nodes = s.nodes;
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
window.toggleNodeConnect = toggleNodeConnect;
window.kickNode       = kickNode;
window.selectCluster  = selectCluster;
window.onOnOffToggle  = onOnOffToggle;
window.sendFixedColor = sendFixedColor;
window.readTempAttr   = readTempAttr;
window.readHumidAttr  = readHumidAttr;
window.readAttribute  = readAttribute;
window.writeAttribute = writeAttribute;
window.sendZclCmd     = sendZclCmd;
window.getDeviceName  = getDeviceName;
window.clearLog       = clearLog;
window.resetState     = resetState;
