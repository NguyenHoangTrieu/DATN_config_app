/* =====================================================================
   DA2 RS485 Sensor Reader Widget
   Target sensor document: 4-channel 16-bit analog reader over MODBUS RTU 485.

   Gateway command path:
     Widget RPC -> sendCommand(hex("CFML:CFRS:<slot>:DATA:<hex_frame>"))
     Immediate ACK -> RPC response topic: CFRS:DATA:OK / FAIL
     Raw MODBUS reply -> telemetry key "data" as hex-encoded binary bytes

   Documented register map from the attached PDF:
     0x0000-0x0007 : AIN0..AIN3, float32 IEEE-754 big-endian
     0x0008        : Slave ID (read-only)
     0x0009        : Baud code (read/write)
     0x000A        : Sleep enable + wait time (read/write)
     0x00FF        : Reset to defaults when writing 0xFFFF

   Notes about this firmware:
     - RS485 handler starts after CFRS:JSON:<slot>:<json> is applied.
     - CFRS:BR:<baud> updates the stored baud, but it only affects the UART
       driver before the handler starts.
     - Because the first ACK consumes the current RPC response slot, the real
       MODBUS payload must be read from telemetry, not from sendTwoWayCommand.
   ===================================================================== */

var CFG = {
  RPC_TIMEOUT_MS: 12000,
  FRAME_TIMEOUT_MS: 5000,
  CMD_GAP_MS: 160,
  POLL_DEFAULT_MS: 2500,
  LOG_LIMIT: 220
};

var BAUD_CODES = [
  { code: 0, rate: 2400 },
  { code: 1, rate: 4800 },
  { code: 2, rate: 9600 },
  { code: 3, rate: 14400 },
  { code: 4, rate: 19200 },
  { code: 5, rate: 28800 },
  { code: 6, rate: 38400 },
  { code: 7, rate: 57600 },
  { code: 8, rate: 76800 },
  { code: 9, rate: 115200 }
];

var GATEWAY_BAUDS = ["9600", "19200", "38400", "57600", "115200"];

var POLL_INTERVAL_OPTIONS = [1000, 2500, 5000, 10000, 30000];
var SLEEP_WAIT_OPTIONS = [0, 1, 3, 5, 10, 30, 60, 120, 255];
var ACTION_BUTTON_IDS = [
  "sr-btn-prepare",
  "sr-btn-refresh",
  "sr-btn-json-only",
  "sr-btn-read-analog",
  "sr-btn-read-config",
  "sr-poll-toggle",
  "sr-btn-write-baud",
  "sr-btn-write-sleep",
  "sr-btn-reset",
  "sr-btn-custom-read",
  "sr-btn-custom-write",
  "sr-btn-send-raw",
  "sr-btn-raw-template"
];

var state = {
  slot: "0",
  gatewayBaud: "9600",
  slaveHex: "1F",
  autoPoll: false,
  pollMs: CFG.POLL_DEFAULT_MS,
  gatewayReady: false,
  rpcTimeout: CFG.RPC_TIMEOUT_MS,
  entityId: null,
  lastTelemetryTs: 0,
  lastAck: "-",
  lastFrameHex: "-",
  analogTs: 0,
  analog: {
    AIN0: null,
    AIN1: null,
    AIN2: null,
    AIN3: null
  },
  device: {
    slaveId: null,
    baudCode: null,
    baudRate: null,
    sleepEnabled: false,
    sleepWait: 0
  },
  queue: [],
  queueBusy: false,
  queueLastEndMs: 0,
  pendingResponse: null,
  pollTimer: null,
  logLines: [],
  monitorLastTs: 0,
  monitorLastRaw: "-",
  monitorLastSource: "-"
};

var _root = null;
var _teleSubscriber = null;
var _toastTimer = null;
var _uiBound = false;
var _bridgeEventHandler = null;
var _bridgeStorageTimer = null;
var _bridgeStorageSeenTs = 0;

self.onInit = function () {
  _root = document.getElementById("rs485-sensor-root");
  loadLocalState();
  populateSelects();
  bindUi();
  syncControls();
  syncRuntimeStateFromUi();
  renderAll();
  bindMonitorBridge();
  subscribeTelemetry();
  logInfo("Widget ready - slot " + state.slot + ", slave 0x" + state.slaveHex);
};

self.onDestroy = function () {
  unsubscribeTelemetry();
  unbindMonitorBridge();
  restartPollTimer(true);
  rejectPendingResponse("Widget destroyed");
};

/* Fallback path when the dashboard datasource is configured manually. */
self.onDataUpdated = function () {
  try {
    var rows = collectTelemetryRows(self.ctx && self.ctx.data, "data");
    if (!rows.length) return;
    for (var i = 0; i < rows.length; i++) {
      handleTelemetryValue(rows[i].value, rows[i].ts);
    }
  } catch (e) {
    logFail("onDataUpdated: " + errorText(e));
  }
};

/* ---------------------------------------------------------------------
   ThingsBoard entity + telemetry helpers
   ------------------------------------------------------------------ */

function resolveTargetEntityId() {
  var ctx = self.ctx;
  if (!ctx) return null;

  try {
    var td = ctx.widgetContext && ctx.widgetContext.targetDevice;
    if (td && td.id) return td.id;
  } catch (e) {}

  try {
    var sc = ctx.stateController;
    if (sc) {
      var eid = typeof sc.getEntityId === "function" ? sc.getEntityId() : null;
      if (eid && eid.entityType === "DEVICE" && eid.id) return eid.id;
      var sp = typeof sc.getStateParams === "function" ? sc.getStateParams() : null;
      if (sp && sp.entityId && sp.entityId.entityType === "DEVICE") return sp.entityId.id;
    }
  } catch (e) {}

  try {
    var ds = ctx.defaultSubscription;
    if (ds && ds.targetDeviceId) return ds.targetDeviceId;
  } catch (e) {}

  try {
    var ca = ctx.controlApi;
    if (ca && ca.targetDeviceId) return ca.targetDeviceId;
  } catch (e) {}

  return null;
}

function subscribeTelemetry() {
  unsubscribeTelemetry();
  state.entityId = resolveTargetEntityId();
  renderStatus();

  if (!state.entityId) {
    logWarn("No target device resolved. Assign a target device in widget settings.");
    return;
  }

  try {
    if (!self.ctx || !self.ctx.telemetryWsService || typeof self.ctx.telemetryWsService.subscribe !== "function") {
      logWarn("telemetryWsService is unavailable. Fallback requires a datasource key named data.");
      return;
    }

    var subscriber = {
      entityId: state.entityId,
      entityType: "DEVICE",
      keys: ["data"],
      onData: function (data) {
        var rows = collectTelemetryRows(data, "data");
        for (var i = 0; i < rows.length; i++) {
          handleTelemetryValue(rows[i].value, rows[i].ts);
        }
      }
    };

    self.ctx.telemetryWsService.subscribe(subscriber);
    _teleSubscriber = subscriber;
    logInfo("Telemetry subscribed - entityId=" + state.entityId + " key=data");
    renderStatus();
  } catch (e) {
    logWarn("Telemetry subscribe failed: " + errorText(e));
  }
}

function unsubscribeTelemetry() {
  if (!_teleSubscriber) return;
  try {
    if (self.ctx && self.ctx.telemetryWsService) {
      self.ctx.telemetryWsService.unsubscribe(_teleSubscriber);
    }
  } catch (e) {}
  _teleSubscriber = null;
}

/* ---------------------------------------------------------------------
   UI bootstrap
   ------------------------------------------------------------------ */

function populateSelects() {
  var slotSelect = ge("sr-slot-select");
  if (slotSelect && !slotSelect.options.length) {
    slotSelect.innerHTML = '' +
      '<option value="0">Slot 1</option>' +
      '<option value="1">Slot 2</option>';
  }

  var slaveSelect = ge("sr-slave-select");
  if (slaveSelect && !slaveSelect.options.length) {
    var slaveOptions = [];
    for (var i = 0; i <= 0x1F; i++) {
      var hx = toHex(i, 2);
      slaveOptions.push('<option value="' + hx + '">0x' + hx + ' (' + i + ')</option>');
    }
    slaveSelect.innerHTML = slaveOptions.join('');
  }

  var gwBaud = ge("sr-gateway-baud");
  if (gwBaud && !gwBaud.options.length) {
    gwBaud.innerHTML = GATEWAY_BAUDS.map(function (rate) {
      return '<option value="' + rate + '">' + rate + '</option>';
    }).join('');
  }

  var sensorBaud = ge("sr-sensor-baud");
  if (sensorBaud && !sensorBaud.options.length) {
    sensorBaud.innerHTML = BAUD_CODES.map(function (entry) {
      return '<option value="' + entry.code + '">' + entry.code + ' -> ' + entry.rate + ' baud</option>';
    }).join('');
  }

  var pollSelect = ge("sr-poll-ms");
  if (pollSelect && !pollSelect.options.length) {
    pollSelect.innerHTML = POLL_INTERVAL_OPTIONS.map(function (value) {
      return '<option value="' + value + '">' + humanPollInterval(value) + '</option>';
    }).join('');
  }

  var sleepWait = ge("sr-sleep-wait");
  if (sleepWait && !sleepWait.options.length) {
    sleepWait.innerHTML = SLEEP_WAIT_OPTIONS.map(function (value) {
      var label = value === 0 ? 'default 3 s' : value + ' s';
      return '<option value="' + value + '">' + label + '</option>';
    }).join('');
  }
}

function bindUi() {
  if (_uiBound) return;
  _uiBound = true;

  addBoundListener("sr-slot-select", "change", function (e) { rsOnSlotChange(e.target.value); });
  addBoundListener("sr-gateway-baud", "change", function (e) { rsOnGatewayBaudChange(e.target.value); });
  addBoundListener("sr-slave-select", "change", function (e) { rsOnSlaveChange(e.target.value); });
  addBoundListener("sr-poll-ms", "change", function (e) { rsOnPollIntervalChange(e.target.value); });

  addBoundListener("sr-btn-prepare", "click", rsPrepareGateway);
  addBoundListener("sr-btn-refresh", "click", rsRefreshAll);
  addBoundListener("sr-btn-json-only", "click", rsSendGatewayJsonOnly);
  addBoundListener("sr-btn-read-analog", "click", rsReadAnalogNow);
  addBoundListener("sr-btn-read-config", "click", rsReadDeviceConfig);
  addBoundListener("sr-poll-toggle", "click", rsTogglePolling);
  addBoundListener("sr-btn-write-baud", "click", rsApplySensorBaud);
  addBoundListener("sr-btn-write-sleep", "click", rsApplySleepConfig);
  addBoundListener("sr-btn-reset", "click", rsResetSensorDefaults);
  addBoundListener("sr-btn-custom-read", "click", rsReadCustomRange);
  addBoundListener("sr-btn-custom-write", "click", rsWriteCustomRegister);
  addBoundListener("sr-btn-send-raw", "click", rsSendRawFrame);
  addBoundListener("sr-btn-raw-template", "click", rsFillReadAllTemplate);
  addBoundListener("sr-btn-clear-log", "click", rsClearConsole);
}

function addBoundListener(id, eventName, handler) {
  var el = ge(id);
  if (!el || el.getAttribute("data-sr-bound-" + eventName) === "1") return;
  el.setAttribute("data-sr-bound-" + eventName, "1");
  el.addEventListener(eventName, handler);
}

function syncRuntimeStateFromUi() {
  state.slot = getValue("sr-slot-select") === "1" ? "1" : "0";
  state.gatewayBaud = String(getValue("sr-gateway-baud") || state.gatewayBaud || "9600");
  state.slaveHex = normalizeHex(getValue("sr-slave-select") || state.slaveHex, 2);
  state.pollMs = clampInt(getValue("sr-poll-ms"), 500, 60000, CFG.POLL_DEFAULT_MS);
}

function refreshTargetContext() {
  var resolved = resolveTargetEntityId();
  if (!resolved) return false;

  var changed = state.entityId !== resolved;
  state.entityId = resolved;
  if (changed || !_teleSubscriber) subscribeTelemetry();
  return true;
}

function syncControls() {
  setValue("sr-slot-select", state.slot);
  setValue("sr-gateway-baud", state.gatewayBaud);
  setValue("sr-slave-select", state.slaveHex);
  setValue("sr-poll-ms", String(state.pollMs));

  if (state.device && state.device.baudCode !== null && state.device.baudCode !== undefined) {
    setValue("sr-sensor-baud", String(state.device.baudCode));
  } else {
    setValue("sr-sensor-baud", "2");
  }

  setChecked("sr-sleep-enable", !!state.device.sleepEnabled);
  setValue("sr-sleep-wait", String(state.device.sleepWait || 0));
}

function renderAll() {
  renderStatus();
  renderHero();
  renderMonitorBridge();
  renderDeviceConfig();
  renderPollingState();
  renderActionState();
  renderConsole();
}

function renderStatus() {
  var pill = ge("sr-status-pill");
  var badge = ge("sr-ready-badge");
  var text = "Idle";
  var stateName = "idle";

  if (!state.entityId) {
    stateName = "error";
    text = "Set Target Device";
  } else if (state.pendingResponse) {
    stateName = "waiting";
    text = "Reading...";
  } else if (state.autoPoll) {
    stateName = "ready";
    text = "Polling";
  } else if (state.gatewayReady || state.analogTs > 0) {
    stateName = "ready";
    text = "Ready";
  } else {
    stateName = "waiting";
    text = _teleSubscriber ? "Ready to Start" : "Idle";
  }

  if (pill) pill.setAttribute("data-state", stateName);
  setText("sr-status-text", text);

  if (badge) {
    badge.setAttribute("data-state", state.gatewayReady ? "on" : "off");
    badge.textContent = state.gatewayReady ? "READY" : "OFF";
  }

  setText("sr-slave-chip", "0x" + state.slaveHex);
  renderActionState();
}

function renderHero() {
  var title = "Slave 0x" + state.slaveHex + " · ";
  if (state.analogTs > 0) {
    title += "last sample " + humanClock(state.analogTs);
  } else {
    title += "waiting for data";
  }
  setText("sr-hero-title", title);

  var sub = "Slot " + (parseInt(state.slot, 10) + 1) + " · Gateway " + state.gatewayBaud + " baud";
  if (state.device.baudRate) sub += " · Sensor " + state.device.baudRate + " baud";
  sub += state.device.sleepEnabled ? " · Sleep ON" : " · Sleep OFF";
  setText("sr-hero-sub", sub);

  var tip = "Prepare Gateway, then Refresh All.";
  if (!state.entityId) {
    tip = "Set the target device in widget settings.";
  } else if (state.pendingResponse) {
    tip = "Sending command...";
  } else if (state.autoPoll) {
    tip = "Polling every " + humanPollInterval(state.pollMs) + ".";
  } else if (state.device.sleepEnabled) {
    tip = "Sensor sleep is on. Wakeup pin is required on real hardware.";
  } else if (state.gatewayReady) {
    tip = "Gateway ready. Press Refresh All.";
  } else if (state.analogTs > 0) {
    tip = "Use Read Config to verify settings after changes.";
  }
  setText("sr-hero-tip", tip);

  setText("sr-last-ack", state.lastAck || "-");
  setText("sr-last-frame", state.lastFrameHex || "-");
}

function renderMonitorBridge() {
  setText("sr-bridge-ts", state.monitorLastTs > 0 ? humanClock(state.monitorLastTs) : "-");
  setText("sr-bridge-source", state.monitorLastSource || "-");
  setText("sr-bridge-raw", state.monitorLastRaw || "-");
}

function renderDeviceConfig() {
  var slaveId = state.device.slaveId;
  setText("sr-device-id", slaveId === null ? "-" : "0x" + toHex(slaveId, 2) + " (" + slaveId + ")");

  var baudText = "-";
  if (state.device.baudCode !== null && state.device.baudCode !== undefined) {
    var rate = baudRateFromCode(state.device.baudCode);
    baudText = "code " + state.device.baudCode + (rate ? " -> " + rate + " baud" : " (unknown)");
  }
  setText("sr-device-baud", baudText);

  var sleepText = state.device.sleepEnabled
    ? "enabled, wait " + sleepWaitText(state.device.sleepWait)
    : "disabled";
  setText("sr-device-sleep", sleepText);

  setText("sr-config-note",
    state.device.slaveId === null
      ? "Press Read Config or Refresh All to load the live device registers."
      : state.device.sleepEnabled
        ? "Sleep is active. Real hardware will need WAKEUP control before the next response."
        : "Config is live. You can change baud or sleep settings from the left panel.");

  syncControls();
}

function renderPollingState() {
  var pollButton = ge("sr-poll-toggle");
  var pollNote = ge("sr-poll-note");
  if (pollButton) {
    pollButton.textContent = state.autoPoll ? "Stop Polling" : "Start Polling";
    pollButton.className = state.autoPoll
      ? "sr-btn sr-btn-danger"
      : "sr-btn sr-btn-muted";
  }
  if (pollNote) {
    pollNote.textContent = state.autoPoll
      ? "Polling is running."
      : "Polling is stopped.";
  }
}

function renderActionState() {
  var busy = !!state.pendingResponse;
  for (var i = 0; i < ACTION_BUTTON_IDS.length; i++) {
    var el = ge(ACTION_BUTTON_IDS[i]);
    if (el) el.disabled = busy;
  }
}

function renderConsole() {
  var log = ge("sr-console-log");
  if (!log) return;
  log.innerHTML = state.logLines.join("");
  log.scrollTop = log.scrollHeight;
}

/* ---------------------------------------------------------------------
   Local storage
   ------------------------------------------------------------------ */

function storageKey() {
  return "da2_rs485_sensor_reader_widget_v1";
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem(storageKey());
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (!saved) return;
    if (saved.slot === "0" || saved.slot === "1") state.slot = saved.slot;
    if (saved.gatewayBaud) state.gatewayBaud = String(saved.gatewayBaud);
    if (saved.slaveHex) state.slaveHex = normalizeHex(saved.slaveHex, 2);
    if (saved.pollMs) state.pollMs = clampInt(saved.pollMs, 500, 60000, CFG.POLL_DEFAULT_MS);
  } catch (e) {}
}

function saveLocalState() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({
      slot: state.slot,
      gatewayBaud: state.gatewayBaud,
      slaveHex: state.slaveHex,
      pollMs: state.pollMs
    }));
  } catch (e) {}
}

/* ---------------------------------------------------------------------
   Logging / toast
   ------------------------------------------------------------------ */

function logInfo(msg) { pushLog("info", msg); }
function logWarn(msg) { pushLog("warn", msg); }
function logFail(msg) { pushLog("fail", msg); }
function logTx(msg) { pushLog("tx", msg); }
function logRx(msg) { pushLog("rx", msg); }

function pushLog(kind, msg) {
  var cls = "sr-log-info";
  if (kind === "tx") cls = "sr-log-tx";
  else if (kind === "rx") cls = "sr-log-rx";
  else if (kind === "warn") cls = "sr-log-warn";
  else if (kind === "fail") cls = "sr-log-fail";

  state.logLines.push(
    '<div class="sr-log-line ' + cls + '">' +
      '<span class="sr-log-ts">' + escapeHtml(logTime()) + '</span>' +
      '<span>' + escapeHtml(msg) + '</span>' +
    '</div>'
  );

  if (state.logLines.length > CFG.LOG_LIMIT) {
    state.logLines = state.logLines.slice(state.logLines.length - CFG.LOG_LIMIT);
  }

  renderConsole();
}

function showToast(text) {
  var toast = ge("sr-toast");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.remove("hidden");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () {
    toast.classList.add("hidden");
  }, 2600);
}

function bindMonitorBridge() {
  unbindMonitorBridge();

  _bridgeEventHandler = function (evt) {
    var detail = evt && evt.detail;
    if (!detail) return;

    var ts = toIntTimestamp(detail.ts || Date.now());
    var raw = detail.rawTelemetryValue;
    if (raw === undefined || raw === null || raw === "") {
      raw = detail.frameHex || detail.rawHex || "";
    }
    if (raw === undefined || raw === null || raw === "") return;

    _bridgeStorageSeenTs = ts;
    updateMonitorMirror(ts, String(raw), "event");
    handleTelemetryValue(raw, ts);
  };
  window.addEventListener("da2_rs485_last_data", _bridgeEventHandler);

  _bridgeStorageTimer = setInterval(function () {
    var packet = readMonitorBridgeStorage();
    if (!packet || !packet.ts || packet.ts <= _bridgeStorageSeenTs) return;
    _bridgeStorageSeenTs = packet.ts;
    updateMonitorMirror(packet.ts, packet.rawTelemetryValue, "storage");
    handleTelemetryValue(packet.rawTelemetryValue, packet.ts);
  }, 1200);

  var initial = readMonitorBridgeStorage();
  if (initial && initial.ts) {
    _bridgeStorageSeenTs = initial.ts;
    updateMonitorMirror(initial.ts, initial.rawTelemetryValue, "storage");
  }
}

function unbindMonitorBridge() {
  if (_bridgeEventHandler) {
    window.removeEventListener("da2_rs485_last_data", _bridgeEventHandler);
    _bridgeEventHandler = null;
  }
  if (_bridgeStorageTimer) {
    clearInterval(_bridgeStorageTimer);
    _bridgeStorageTimer = null;
  }
}

function readMonitorBridgeStorage() {
  try {
    var raw = localStorage.getItem("da2_rs485_last_data_v1");
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed) return null;
    var ts = toIntTimestamp(parsed.ts);
    var value = parsed.rawTelemetryValue;
    if (value === undefined || value === null || value === "") {
      value = parsed.frameHex || parsed.rawHex || "";
    }
    if (value === undefined || value === null || value === "") return null;
    return { ts: ts || Date.now(), rawTelemetryValue: String(value) };
  } catch (e) {
    return null;
  }
}

function updateMonitorMirror(ts, raw, source) {
  state.monitorLastTs = ts || Date.now();
  state.monitorLastRaw = String(raw || "-");
  state.monitorLastSource = source || "-";
  renderMonitorBridge();
}

/* ---------------------------------------------------------------------
   Queue + RPC helpers
   ------------------------------------------------------------------ */

function enqueueTask(fn) {
  return new Promise(function (resolve, reject) {
    state.queue.push({ fn: fn, resolve: resolve, reject: reject });
    drainQueue();
  });
}

function drainQueue() {
  if (state.queueBusy || !state.queue.length) return;
  state.queueBusy = true;

  var item = state.queue.shift();
  var waitMs = Math.max(0, CFG.CMD_GAP_MS - (Date.now() - state.queueLastEndMs));

  setTimeout(function () {
    try {
      item.fn()
        .then(function (value) {
          state.queueBusy = false;
          state.queueLastEndMs = Date.now();
          item.resolve(value);
          drainQueue();
        })
        .catch(function (err) {
          state.queueBusy = false;
          state.queueLastEndMs = Date.now();
          item.reject(err);
          drainQueue();
        });
    } catch (e) {
      state.queueBusy = false;
      state.queueLastEndMs = Date.now();
      item.reject(e);
      drainQueue();
    }
  }, waitMs);
}

function sendRpc(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error("No controlApi - assign a target device in widget settings"));
      return;
    }

    self.ctx.controlApi.sendTwoWayCommand(method, params, timeoutMs || state.rpcTimeout)
      .subscribe(
        function (resp) { resolve(resp); },
        function (err) { reject(err); }
      );
  });
}

function sendGatewayCommand(cmd, timeoutMs) {
  logTx(cmd);
  return sendRpc("sendCommand", stringToHex(cmd), timeoutMs || state.rpcTimeout)
    .then(function (resp) {
      var ackText = normalizeRpcText(resp);
      if (ackText) {
        state.lastAck = ackText;
        logRx(ackText);
      }
      renderHero();
      return ackText;
    })
    .catch(function (err) {
      var msg = errorText(err);
      state.lastAck = msg;
      renderHero();
      logFail("RPC error: " + msg);
      showToast(msg);
      throw err;
    });
}

function registerPendingResponse(description, matcher, timeoutMs) {
  rejectPendingResponse("Superseded by a new command");

  var pending = {
    description: description,
    matcher: matcher,
    done: false,
    resolve: null,
    reject: null,
    timer: null,
    promise: null
  };

  pending.promise = new Promise(function (resolve, reject) {
    pending.resolve = resolve;
    pending.reject = reject;
  });

  pending.timer = setTimeout(function () {
    settlePendingResponse(pending, new Error(description + " timed out"), null);
  }, timeoutMs || CFG.FRAME_TIMEOUT_MS);

  state.pendingResponse = pending;
  renderStatus();
  return pending;
}

function rejectPendingResponse(reason) {
  if (!state.pendingResponse) return;
  settlePendingResponse(state.pendingResponse, new Error(reason), null);
}

function settlePendingResponse(pending, err, frame) {
  if (!pending || pending.done) return;
  pending.done = true;
  if (pending.timer) clearTimeout(pending.timer);
  if (state.pendingResponse === pending) state.pendingResponse = null;
  renderStatus();

  if (err) {
    logFail(err.message || String(err));
    pending.reject(err);
  } else {
    pending.resolve(frame);
  }
}

function sendRs485Frame(frameBytes, description, matcher, timeoutMs) {
  return enqueueTask(function () {
    var requestHex = bytesToHex(frameBytes);
    var pending = registerPendingResponse(description, matcher, timeoutMs || CFG.FRAME_TIMEOUT_MS);

    state.lastFrameHex = requestHex;
    renderHero();

    return sendGatewayCommand("CFML:CFRS:" + state.slot + ":DATA:" + requestHex, state.rpcTimeout)
      .then(function (ackText) {
        if (ackText && ackText.indexOf("FAIL") !== -1) {
          throw new Error(ackText);
        }
        state.gatewayReady = true;
        renderStatus();
        return pending.promise;
      })
      .catch(function (err) {
        settlePendingResponse(pending, err, null);
        throw err;
      });
  });
}

/* ---------------------------------------------------------------------
   MODBUS RTU helpers
   ------------------------------------------------------------------ */

function buildReadHoldingFrame(slave, startReg, count) {
  return appendModbusCrc([
    slave & 0xFF,
    0x03,
    (startReg >> 8) & 0xFF,
    startReg & 0xFF,
    (count >> 8) & 0xFF,
    count & 0xFF
  ]);
}

function buildWriteSingleFrame(slave, register, value) {
  return appendModbusCrc([
    slave & 0xFF,
    0x06,
    (register >> 8) & 0xFF,
    register & 0xFF,
    (value >> 8) & 0xFF,
    value & 0xFF
  ]);
}

function appendModbusCrc(frameNoCrc) {
  var crc = crc16Modbus(frameNoCrc);
  var frame = frameNoCrc.slice();
  frame.push(crc & 0xFF);
  frame.push((crc >> 8) & 0xFF);
  return frame;
}

function crc16Modbus(bytes) {
  var crc = 0xFFFF;
  for (var i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (var bit = 0; bit < 8; bit++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
      else crc = crc >> 1;
    }
  }
  return crc & 0xFFFF;
}

function parseModbusFrame(bytes) {
  if (!bytes || bytes.length < 5) return null;

  var payload = bytes.slice(0, bytes.length - 2);
  var crcExpected = crc16Modbus(payload);
  var crcActual = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);

  var parsed = {
    raw: bytes.slice(),
    slave: bytes[0],
    functionCode: bytes[1],
    validCrc: crcExpected === crcActual,
    crcExpected: crcExpected,
    crcActual: crcActual,
    isException: (bytes[1] & 0x80) !== 0,
    exceptionCode: null,
    byteCount: null,
    data: [],
    register: null,
    value: null,
    summary: ""
  };

  if (parsed.isException) {
    parsed.exceptionCode = bytes.length > 2 ? bytes[2] : null;
    parsed.summary = "EXC 0x" + toHex(parsed.functionCode, 2) + " code 0x" + toHex(parsed.exceptionCode || 0, 2);
    return parsed;
  }

  if (parsed.functionCode === 0x03 && bytes.length >= 5) {
    parsed.byteCount = bytes[2];
    parsed.data = bytes.slice(3, 3 + parsed.byteCount);
    parsed.summary = "Read holding reply, " + parsed.byteCount + " data bytes";
    return parsed;
  }

  if (parsed.functionCode === 0x06 && bytes.length >= 8) {
    parsed.register = (bytes[2] << 8) | bytes[3];
    parsed.value = (bytes[4] << 8) | bytes[5];
    parsed.summary = "Write echo reg 0x" + toHex(parsed.register, 4) + " = 0x" + toHex(parsed.value, 4);
    return parsed;
  }

  parsed.summary = "Function 0x" + toHex(parsed.functionCode, 2) + ", len=" + bytes.length;
  return parsed;
}

function extractValidModbusFrame(bytes) {
  if (!bytes || bytes.length < 5) return null;

  var direct = parseModbusFrame(bytes);
  if (direct && direct.validCrc) {
    return { frame: bytes.slice(), prefixText: "" };
  }

  for (var i = 0; i <= bytes.length - 5; i++) {
    var fc = bytes[i + 1];
    var totalLen = 0;

    if (fc === 0x03) {
      var byteCount = bytes[i + 2];
      totalLen = 3 + byteCount + 2;
    } else if (fc === 0x06) {
      totalLen = 8;
    } else if ((fc & 0x80) !== 0) {
      totalLen = 5;
    } else {
      continue;
    }

    if (i + totalLen > bytes.length) continue;
    var candidate = bytes.slice(i, i + totalLen);
    var parsed = parseModbusFrame(candidate);
    if (parsed && parsed.validCrc) {
      var prefixText = "";
      if (i > 0) {
        var prefix = bytes.slice(0, i);
        if (isPrintableAscii(prefix)) {
          prefixText = "Prefix stripped: " + asciiBytesToString(prefix).trim();
        }
      }
      return { frame: candidate, prefixText: prefixText };
    }
  }

  return null;
}

function parseFloat32BigEndian(bytes, index) {
  var buffer = new ArrayBuffer(4);
  var view = new DataView(buffer);
  view.setUint8(0, bytes[index]);
  view.setUint8(1, bytes[index + 1]);
  view.setUint8(2, bytes[index + 2]);
  view.setUint8(3, bytes[index + 3]);
  return view.getFloat32(0, false);
}

function parseAnalogPayload(payload) {
  if (!payload || payload.length < 16) return null;
  return {
    AIN0: parseFloat32BigEndian(payload, 0),
    AIN1: parseFloat32BigEndian(payload, 4),
    AIN2: parseFloat32BigEndian(payload, 8),
    AIN3: parseFloat32BigEndian(payload, 12)
  };
}

function parseConfigPayload(payload) {
  if (!payload || payload.length < 6) return null;
  var slaveId = (payload[0] << 8) | payload[1];
  var baudCode = (payload[2] << 8) | payload[3];
  var sleepRaw = (payload[4] << 8) | payload[5];
  return {
    slaveId: slaveId & 0x001F,
    baudCode: baudCode,
    baudRate: baudRateFromCode(baudCode),
    sleepEnabled: ((sleepRaw >> 8) & 0xFF) === 0x01,
    sleepWait: sleepRaw & 0xFF
  };
}

/* ---------------------------------------------------------------------
   Telemetry processing
   ------------------------------------------------------------------ */

function handleTelemetryValue(rawValue, timestamp) {
  if (timestamp && timestamp <= state.lastTelemetryTs) return;
  if (timestamp) state.lastTelemetryTs = timestamp;

  var bytes = decodeTelemetryBytes(rawValue);
  if (!bytes || !bytes.length) return;

  var extracted = extractValidModbusFrame(bytes);
  var frameBytes = extracted ? extracted.frame : bytes;
  if (extracted && extracted.prefixText) {
    logInfo(extracted.prefixText);
  }

  if (isPrintableAscii(frameBytes)) {
    var text = asciiBytesToString(frameBytes).trim();
    if (!text) return;
    logRx(text);
    if (text.indexOf("CFRS:") === 0) {
      state.lastAck = text;
      renderHero();
      renderStatus();
    }
    return;
  }

  var parsed = parseModbusFrame(frameBytes);
  if (!parsed) return;

  var pendingMatched = false;
  if (state.pendingResponse && typeof state.pendingResponse.matcher === "function") {
    try {
      pendingMatched = !!state.pendingResponse.matcher(parsed);
    } catch (e) {
      pendingMatched = false;
    }
  }

  /* The gateway publishes multiple handler responses to the same telemetry key.
     Only consume a MODBUS frame when it belongs to the selected slave or to the
     exact request currently waiting for a response. */
  if (parsed.slave !== currentSlave() && !pendingMatched) {
    return;
  }

  state.lastFrameHex = bytesToHex(frameBytes);
  renderHero();

  if (!parsed.validCrc) {
    logWarn("CRC mismatch: " + state.lastFrameHex);
    return;
  }

  logRx(formatModbusSummary(parsed));
  applyParsedFrame(parsed);

  if (pendingMatched) {
    settlePendingResponse(state.pendingResponse, null, parsed);
  }
}

function applyParsedFrame(parsed) {
  if (!parsed) return;

  if (parsed.isException) {
    showToast("MODBUS exception 0x" + toHex(parsed.exceptionCode || 0, 2));
    return;
  }

  if (parsed.functionCode === 0x03 && parsed.byteCount === 16) {
    var analog = parseAnalogPayload(parsed.data);
    if (analog) {
      state.analog = analog;
      state.analogTs = Date.now();
      state.gatewayReady = true;
      renderHero();
      renderStatus();
    }
    return;
  }

  if (parsed.functionCode === 0x03 && parsed.byteCount === 6) {
    var cfg = parseConfigPayload(parsed.data);
    if (cfg) {
      state.device = cfg;
      renderDeviceConfig();
      renderHero();
      renderStatus();
    }
    return;
  }

  if (parsed.functionCode === 0x06) {
    if (parsed.register === 0x0009) {
      state.device.baudCode = parsed.value;
      state.device.baudRate = baudRateFromCode(parsed.value);
      renderDeviceConfig();
      showToast("Sensor baud register updated");
    } else if (parsed.register === 0x000A) {
      state.device.sleepEnabled = ((parsed.value >> 8) & 0xFF) === 0x01;
      state.device.sleepWait = parsed.value & 0xFF;
      renderDeviceConfig();
      showToast("Sleep register updated");
    } else if (parsed.register === 0x00FF && parsed.value === 0xFFFF) {
      showToast("Factory reset command echoed");
    }
  }
}

/* ---------------------------------------------------------------------
   User actions
   ------------------------------------------------------------------ */

function rsOnSlotChange(value) {
  state.slot = value === "1" ? "1" : "0";
  saveLocalState();
  renderAll();
}

function rsOnGatewayBaudChange(value) {
  state.gatewayBaud = String(value || "9600");
  saveLocalState();
  renderHero();
}

function rsOnSlaveChange(value) {
  state.slaveHex = normalizeHex(value, 2);
  saveLocalState();
  renderAll();
}

function rsOnPollIntervalChange(value) {
  state.pollMs = clampInt(value, 500, 60000, CFG.POLL_DEFAULT_MS);
  saveLocalState();
  if (state.autoPoll) restartPollTimer();
  syncControls();
  renderHero();
  renderPollingState();
}

function rsTogglePolling() {
  syncRuntimeStateFromUi();
  if (!state.autoPoll && !refreshTargetContext()) {
    showToast("Assign target device before starting polling");
    return;
  }

  state.autoPoll = !state.autoPoll;
  if (state.autoPoll) {
    restartPollTimer();
    runPollingCycle();
    showToast("Sensor polling started");
  } else {
    restartPollTimer(true);
    renderStatus();
    renderHero();
    renderPollingState();
    showToast("Sensor polling stopped");
  }
}

function rsPrepareGateway() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  var slotNum = parseInt(state.slot, 10);
  var cfgJson = JSON.stringify(buildDefaultRs485Json(slotNum));

  enqueueTask(function () {
    return sendGatewayCommand("CFML:CFRS:BR:" + state.gatewayBaud, 8000)
      .then(function (ack) {
        if (ack && ack.indexOf("FAIL") !== -1) throw new Error(ack);
        return sendGatewayCommand("CFML:CFRS:JSON:" + state.slot + ":" + cfgJson, 12000);
      })
      .then(function (ack) {
        if (ack && ack.indexOf("FAIL") !== -1) throw new Error(ack);
        state.gatewayReady = true;
        renderStatus();
        showToast("Gateway RS485 interface prepared");
      });
  }).catch(function () {});
}

function rsSendGatewayJsonOnly() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  var slotNum = parseInt(state.slot, 10);
  var cfgJson = JSON.stringify(buildDefaultRs485Json(slotNum));
  enqueueTask(function () {
    return sendGatewayCommand("CFML:CFRS:JSON:" + state.slot + ":" + cfgJson, 12000)
      .then(function (ack) {
        if (ack && ack.indexOf("FAIL") !== -1) throw new Error(ack);
        state.gatewayReady = true;
        renderStatus();
        showToast("RS485 GPIO JSON applied");
      });
  }).catch(function () {});
}

function rsReadAnalogNow() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  readHoldingRange(currentSlave(), 0x0000, 0x0008, "Read AIN0..AIN3", function (parsed) {
    return parsed && parsed.functionCode === 0x03 && parsed.slave === currentSlave() && parsed.byteCount === 16;
  }).then(function () {
    showToast("Analog channels updated");
  }).catch(function () {});
}

function rsReadDeviceConfig() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  readHoldingRange(currentSlave(), 0x0008, 0x0003, "Read device registers", function (parsed) {
    return parsed && parsed.functionCode === 0x03 && parsed.slave === currentSlave() && parsed.byteCount === 6;
  }).then(function () {
    showToast("Device registers updated");
  }).catch(function () {});
}

function rsRefreshAll() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  readHoldingRange(currentSlave(), 0x0000, 0x0008, "Read AIN0..AIN3", function (parsed) {
    return parsed && parsed.functionCode === 0x03 && parsed.slave === currentSlave() && parsed.byteCount === 16;
  })
    .then(function () {
      return readHoldingRange(currentSlave(), 0x0008, 0x0003, "Read device registers", function (parsed) {
        return parsed && parsed.functionCode === 0x03 && parsed.slave === currentSlave() && parsed.byteCount === 6;
      });
    })
    .then(function () {
      showToast("Analog and config registers updated");
    })
    .catch(function () {});
}

function rsApplySensorBaud() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  var code = clampInt(getValue("sr-sensor-baud"), 0, 255, 2);
  writeSingleRegister(currentSlave(), 0x0009, code, "Write baud register", function (parsed) {
    return parsed && parsed.functionCode === 0x06 && parsed.slave === currentSlave() && parsed.register === 0x0009;
  }).then(function () {
    showToast("Sensor baud register changed; align gateway baud before the next read");
  }).catch(function () {});
}

function rsApplySleepConfig() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  var enabled = !!getChecked("sr-sleep-enable");
  var wait = clampInt(getValue("sr-sleep-wait"), 0, 255, 0);
  var value = ((enabled ? 0x01 : 0x00) << 8) | (wait & 0xFF);

  writeSingleRegister(currentSlave(), 0x000A, value, "Write sleep register", function (parsed) {
    return parsed && parsed.functionCode === 0x06 && parsed.slave === currentSlave() && parsed.register === 0x000A;
  }).then(function () {
    if (enabled) {
      showToast("Sleep enabled - real hardware will need WAKEUP pin to resume");
    } else {
      showToast("Sleep disabled");
    }
  }).catch(function () {});
}

function rsResetSensorDefaults() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  writeSingleRegister(currentSlave(), 0x00FF, 0xFFFF, "Reset to defaults", function (parsed) {
    return parsed && parsed.functionCode === 0x06 && parsed.slave === currentSlave() && parsed.register === 0x00FF;
  }).then(function () {
    showToast("Factory reset command echoed by the sensor");
  }).catch(function () {});
}

function rsReadCustomRange() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  var startReg = parseHexOrZero(getValue("sr-custom-read-start"), 4);
  var count = parseHexOrZero(getValue("sr-custom-read-count"), 4);
  if (count <= 0 || count > 0x007D) {
    showToast("Register count must be between 0x0001 and 0x007D");
    return;
  }

  readHoldingRange(currentSlave(), startReg, count, "Custom read 0x03", function (parsed) {
    return parsed && parsed.functionCode === 0x03 && parsed.slave === currentSlave();
  }).then(function () {
    showToast("Custom read completed");
  }).catch(function () {});
}

function rsWriteCustomRegister() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  var reg = parseHexOrZero(getValue("sr-custom-write-reg"), 4);
  var value = parseHexOrZero(getValue("sr-custom-write-value"), 4);
  writeSingleRegister(currentSlave(), reg, value, "Custom write 0x06", function (parsed) {
    return parsed && parsed.functionCode === 0x06 && parsed.slave === currentSlave() && parsed.register === reg;
  }).then(function () {
    showToast("Custom write echoed");
  }).catch(function () {});
}

function rsFillReadAllTemplate() {
  syncRuntimeStateFromUi();
  setValue("sr-raw-frame", state.slaveHex + "0300000008");
}

function rsSendRawFrame() {
  syncRuntimeStateFromUi();
  refreshTargetContext();
  var raw = normalizeHexText(getValue("sr-raw-frame"));
  if (!raw || raw.length < 12) {
    showToast("Raw frame must contain at least addr + func + payload");
    return;
  }

  var frame = hexToBytes(raw);
  if (!frame.length) {
    showToast("Invalid hex frame");
    return;
  }

  /* If the user omitted CRC, add it automatically. */
  if (frame.length < 8 || !looksLikeValidModbusFrame(frame)) {
    frame = appendModbusCrc(frame);
  }

  sendRs485Frame(frame, "Raw frame", function (parsed) {
    return parsed && parsed.validCrc && parsed.slave === frame[0];
  }, CFG.FRAME_TIMEOUT_MS).then(function () {
    showToast("Raw frame response received");
  }).catch(function () {});
}

function rsClearConsole() {
  state.logLines = [];
  renderConsole();
}

function runPollingCycle() {
  syncRuntimeStateFromUi();
  if (!state.autoPoll || state.pendingResponse) return Promise.resolve();

  return readHoldingRange(currentSlave(), 0x0000, 0x0008, "Polling AIN0..AIN3", function (parsed) {
    return parsed && parsed.functionCode === 0x03 && parsed.slave === currentSlave() && parsed.byteCount === 16;
  }).catch(function () {});
}

function restartPollTimer(stopOnly) {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  if (stopOnly || !state.autoPoll) {
    renderPollingState();
    return;
  }

  renderStatus();
  renderHero();
  renderPollingState();

  state.pollTimer = setInterval(function () {
    runPollingCycle();
  }, state.pollMs);
}

function readHoldingRange(slave, startReg, count, description, matcher) {
  var frame = buildReadHoldingFrame(slave, startReg, count);
  return sendRs485Frame(frame, description, matcher || function (parsed) {
    return parsed && parsed.functionCode === 0x03 && parsed.slave === slave;
  }, CFG.FRAME_TIMEOUT_MS);
}

function writeSingleRegister(slave, register, value, description, matcher) {
  var frame = buildWriteSingleFrame(slave, register, value);
  return sendRs485Frame(frame, description, matcher || function (parsed) {
    return parsed && parsed.functionCode === 0x06 && parsed.slave === slave && parsed.register === register;
  }, CFG.FRAME_TIMEOUT_MS);
}

/* ---------------------------------------------------------------------
   Widget-specific config helpers
   ------------------------------------------------------------------ */

function buildDefaultRs485Json(slotId) {
  return {
    module_id: "RS485",
    module_type: "RS485",
    stack_id: slotId,
    functions: [
      {
        function_name: "RS485_SEND_MODE",
        gpio_start_control: [
          { pin: "03", state: "HIGH" },
          { pin: "02", state: "HIGH" }
        ],
        delay_start: 1,
        gpio_end_control: [],
        delay_end: 0
      },
      {
        function_name: "RS485_RECEIVE_MODE",
        gpio_start_control: [
          { pin: "03", state: "LOW" },
          { pin: "02", state: "LOW" }
        ],
        delay_start: 1,
        gpio_end_control: [],
        delay_end: 0
      }
    ]
  };
}

/* ---------------------------------------------------------------------
   Formatting helpers
   ------------------------------------------------------------------ */

function ge(id) { return document.getElementById(id); }

function setText(id, text) {
  var el = ge(id);
  if (el) el.textContent = text;
}

function setValue(id, value) {
  var el = ge(id);
  if (el) el.value = value;
}

function getValue(id) {
  var el = ge(id);
  return el ? String(el.value || "") : "";
}

function setChecked(id, checked) {
  var el = ge(id);
  if (el) el.checked = !!checked;
}

function getChecked(id) {
  var el = ge(id);
  return !!(el && el.checked);
}

function currentSlave() {
  return parseInt(state.slaveHex, 16) & 0xFF;
}

function toHex(value, width) {
  var hex = (value >>> 0).toString(16).toUpperCase();
  while (hex.length < width) hex = "0" + hex;
  return hex;
}

function normalizeHex(value, width) {
  var clean = String(value || "").replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (!clean) clean = "0";
  if (width && clean.length > width) clean = clean.slice(clean.length - width);
  while (width && clean.length < width) clean = "0" + clean;
  return clean;
}

function normalizeHexText(value) {
  return String(value || "").replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

function parseHexOrZero(value, width) {
  var clean = normalizeHex(value, width);
  return parseInt(clean, 16) || 0;
}

function clampInt(value, min, max, fallback) {
  var num = parseInt(value, 10);
  if (isNaN(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function bytesToHex(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += toHex(bytes[i], 2);
  return out;
}

function hexToBytes(hex) {
  var clean = normalizeHexText(hex);
  if (!clean || clean.length % 2 !== 0) return [];
  var bytes = [];
  for (var i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substr(i, 2), 16));
  }
  return bytes;
}

function stringToHex(str) {
  var hex = "";
  for (var i = 0; i < str.length; i++) {
    hex += toHex(str.charCodeAt(i), 2);
  }
  return hex;
}

function asciiBytesToString(bytes) {
  var text = "";
  for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return text;
}

function isPrintableAscii(bytes) {
  if (!bytes || !bytes.length) return false;
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b > 126) return false;
  }
  return true;
}

function decodeTelemetryBytes(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if (value.data !== undefined) value = value.data;
    else if (value.result !== undefined) value = value.result;
  }

  var text = String(value);
  if (/^[0-9A-Fa-f\s]+$/.test(text)) {
    var normalized = text.replace(/\s+/g, "");
    if (normalized.length % 2 === 0 && normalized.length > 0) {
      return hexToBytes(normalized);
    }
  }

  if (/^[0-9A-Fa-f]+$/.test(text) && text.length % 2 === 0) {
    return hexToBytes(text);
  }

  var ascii = [];
  for (var i = 0; i < text.length; i++) ascii.push(text.charCodeAt(i) & 0xFF);
  return ascii;
}

function normalizeRpcText(resp) {
  if (resp === null || resp === undefined) return "";
  if (typeof resp === "object") {
    if (resp.result !== undefined) resp = resp.result;
    else if (resp.data !== undefined) resp = resp.data;
  }
  var text = String(resp);
  if (/^[0-9A-Fa-f]+$/.test(text) && text.length % 2 === 0) {
    var bytes = hexToBytes(text);
    if (isPrintableAscii(bytes)) return asciiBytesToString(bytes).trim();
  }
  return text;
}

function baudRateFromCode(code) {
  for (var i = 0; i < BAUD_CODES.length; i++) {
    if (BAUD_CODES[i].code === code) return BAUD_CODES[i].rate;
  }
  return null;
}

function sleepWaitText(value) {
  if (value === 0) return "default 3 s";
  return value + " s";
}

function humanPollInterval(value) {
  if (value >= 1000 && value % 1000 === 0) return (value / 1000) + " s";
  return value + " ms";
}

function formatVoltage(value) {
  return value.toFixed(4) + " V";
}

function looksLikeValidModbusFrame(bytes) {
  if (!bytes || bytes.length < 4) return false;
  return parseModbusFrame(bytes).validCrc;
}

function formatModbusSummary(parsed) {
  if (!parsed) return "Unknown frame";
  return "MODBUS RX [0x" + toHex(parsed.slave, 2) + "] " + parsed.summary +
    (parsed.validCrc ? "" : " (CRC FAIL)");
}

function humanClock(ts) {
  var d = new Date(ts);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function pad2(value) {
  return value < 10 ? "0" + value : String(value);
}

function logTime() {
  var d = new Date();
  return humanClock(d.getTime());
}

function errorText(err) {
  if (!err) return "Unknown error";
  if (err.message) return err.message;
  return String(err);
}

function collectTelemetryRows(payload, preferredKey) {
  var rows = [];

  function pushPair(pair) {
    if (!pair) return;
    if (Array.isArray(pair) && pair.length >= 2) {
      rows.push({ ts: toIntTimestamp(pair[0]), value: pair[1] });
      return;
    }
    if (typeof pair === "object") {
      if (Array.isArray(pair.value) && pair.value.length >= 2) {
        rows.push({ ts: toIntTimestamp(pair.value[0]), value: pair.value[1] });
        return;
      }
      var ts = pair.ts !== undefined ? pair.ts : (pair.timestamp !== undefined ? pair.timestamp : Date.now());
      if (pair.value !== undefined) {
        rows.push({ ts: toIntTimestamp(ts), value: pair.value });
      }
    }
  }

  function fromSeries(series) {
    if (!series) return;
    if (Array.isArray(series)) {
      for (var i = 0; i < series.length; i++) pushPair(series[i]);
    } else {
      pushPair(series);
    }
  }

  if (!payload) return rows;

  if (Array.isArray(payload)) {
    for (var i = 0; i < payload.length; i++) {
      var item = payload[i];
      if (!item) continue;
      if (Array.isArray(item) && item.length >= 2) {
        pushPair(item);
      } else if (item.data !== undefined) {
        fromSeries(item.data);
      } else if (preferredKey && item[preferredKey] !== undefined) {
        fromSeries(item[preferredKey]);
      }
    }
    return rows;
  }

  if (typeof payload === "object") {
    if (payload.data !== undefined) fromSeries(payload.data);
    if (preferredKey && payload[preferredKey] !== undefined) fromSeries(payload[preferredKey]);
  }

  return rows;
}

function toIntTimestamp(value) {
  var n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) return Date.now();
  return n;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}