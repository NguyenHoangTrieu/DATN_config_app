/* =====================================================================
   DA2 LoRa WiOe5 Control Widget — ThingsBoard JavaScript
   Type    : Control widget (requires controlApi / target device)
   Protocol: CFML:CFLR:<slot>:<FUNCTION_NAME>[:<params>]  hex-encoded

   Responsibilities:
     - OTAA / ABP key configuration
     - Join / Leave the LoRaWAN network
     - Send uplink packets (unconfirmed / confirmed)
     - Radio config (region, DR, TXP, ADR)
     - Console log for TX/RX debugging

   Received downlinks (RX1 / RX2 events) and packet history are
   displayed in the companion "LoRa WiOe5 Monitor" widget.
   The monitor widget uses the same telemetry key "data" (Latest Values).

   IMPORTANT THINGSBOARD NOTES:
     - Use document.getElementById() — no shadow DOM
     - Avoid .finally() — not polyfilled in all TB versions
     - Avoid Object.values() — use Object.keys() loop instead
     - Capture mutable state vars BEFORE async to avoid closure bugs
   ===================================================================== */

/* ═══════════════════════════════════════════════════════════════════
   App State
   ═══════════════════════════════════════════════════════════════════ */
var state = {
  slot:       '0',
  mode:       'OTAA',        /* 'OTAA' | 'ABP' */
  txType:     'unconfirmed',
  joined:     false,
  joining:    false,
  txPending:  false,
  rpcTimeout: 12000,
  /* P2P state */
  _p2pPendingRx:    false,   /* true after +TEST: LEN: line */
  _joinSent:        false,   /* debounce for auto JOIN_ACCEPT */
  lastP2pSensorTs:  0        /* millis of last SENSOR_DATA uplink from node */
};

var _root = null;

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
self.onInit = function () {
  try {
    _root = document.getElementById('lr-app-root');
    syncSlotSelect();
    loadLocalState();
    applyLocalState();
    injectP2PPanel();
    setInterval(updateLedButtons, 100);
    logInfo('Control widget ready — slot ' + state.slot);
    setTimeout(function () { queryModuleInfo(); }, 800);
  } catch (e) {
    logFail('onInit: ' + (e && e.message ? e.message : e));
  }
};

self.onDestroy = function () {};

/* Telemetry: async events from firmware — control widget cares about
   JOINED, JOIN_FAILED, SEND_CONFIRMED.  RX1/RX2 downlinks are routed
   to the companion monitor widget. */
var _tbLastLogTs = 0;
self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      var latest = kd.data[kd.data.length - 1];
      var raw    = latest[1];
      var now    = Date.now();
      if (now - _tbLastLogTs > 15000) {
        _tbLastLogTs = now;
        logEvt('[TB] telemetry rx: ' + String(raw).substr(0, 28) + '…');
      }
      var decoded = decodeResp(raw);
      splitResp(decoded).forEach(function (line) { handleAsyncEvent(line); });
    }
  } catch (e) {
    logFail('onDataUpdated: ' + (e && e.message ? e.message : e));
  }
};

/* ═══════════════════════════════════════════════════════════════════
   RPC / CFML Helpers
   ═══════════════════════════════════════════════════════════════════ */
function sendRPC(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error('No controlApi — assign a target device in widget settings'));
      return;
    }
    self.ctx.controlApi
      .sendTwoWayCommand(method, params, timeoutMs)
      .subscribe(
        function (r) { resolve(r); },
        function (e) { reject(e); }
      );
  });
}

function stringToHex(str) {
  var h = '';
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i).toString(16).toUpperCase();
    h += (c.length === 1 ? '0' : '') + c;
  }
  return h;
}

function hexToString(hex) {
  var s = '';
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(b)) s += String.fromCharCode(b);
  }
  return s;
}

function decodeResp(raw) {
  if (!raw) return '';
  if (typeof raw === 'object') {
    raw = (raw.result !== undefined) ? raw.result
        : (raw.data   !== undefined) ? raw.data
        : JSON.stringify(raw);
  }
  var s = String(raw);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    s = hexToString(s);
  }
  return s;
}

function splitResp(s) {
  if (!s) return [];
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    var ci = x.indexOf('CFLR:');
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

function sendCFLR(func, params, timeoutMs) {
  var cmd = 'CFML:CFLR:' + state.slot + ':' + func + (params ? ':' + params : '');
  logTx(cmd);
  return sendRPC('sendCommand', stringToHex(cmd), timeoutMs || state.rpcTimeout)
    .then(function (resp) {
      var decoded = decodeResp(resp);
      splitResp(decoded).forEach(function (line) {
        if (/\+EVT:|CFLR:[0-9]:EVT/.test(line)) {
          logEvt('RX: ' + line);
          handleAsyncEvent(line);
        } else {
          logOk('RX: ' + line);
        }
      });
      return decoded;
    })
    .catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      logFail('RPC: ' + msg);
      showToast('⚠ ' + msg);
      throw err;
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Async Event Handler
   Handles JOINED, JOIN_FAILED, SEND_CONFIRMED/UNCONFIRMED.
   RX1/RX2 downlinks are intentionally NOT handled here — they are
   displayed exclusively in the companion monitor widget.
   ═══════════════════════════════════════════════════════════════════ */
function handleAsyncEvent(line) {
  var l = line.replace(/^CFLR:\d+:(EVT:|OK:|FAIL:[^:]*:)/, '');

  if (/^\+EVT:JOINED/i.test(l)) {
    state.joining = false;
    state.joined  = true;
    setJoinState(true);
    showToast('✓ Joined network!');
    logInfo('+EVT:JOINED — session active');
    queryJoinStatus();
    return;
  }

  var m = l.match(/^\+EVT:JOIN_FAILED_(\d+)/i);
  if (m) { logFail('+EVT:JOIN_FAILED attempt ' + m[1] + ' — retrying…'); return; }

  if (/^\+EVT:JOIN_FAILED/i.test(l)) {
    state.joining = false;
    state.joined  = false;
    setJoinState(false);
    showToast('✗ Join failed — check keys / coverage');
    logFail('+EVT:JOIN_FAILED');
    return;
  }

  if (/^\+EVT:SEND_CONFIRMED/i.test(l)) {
    if (state.txPending) {
      state.txPending = false;
      setBtnSend(false);
      setTxStatus('ok', '✓ Confirmed');
      showToast('✓ Uplink acknowledged');
    }
    logInfo('+EVT:SEND_CONFIRMED');
    return;
  }

  if (/^\+EVT:SEND_UNCONFIRMED/i.test(l)) {
    if (state.txPending) {
      state.txPending = false;
      setBtnSend(false);
      setTxStatus('ok', '✓ Sent');
      showToast('Uplink sent');
    }
    logInfo('+EVT:SEND_UNCONFIRMED');
    return;
  }

  /* RX1/RX2 downlinks are handled by the monitor widget — log only */
  m = l.match(/^\+EVT:(RX[12]):/i);
  if (m) {
    logEvt('+EVT:' + m[1] + ' — downlink received (see Monitor widget)');
    return;
  }

  /* ── P2P TEST mode events ────────────────────────────────────────
     The gateway WioE5 is in P2P TEST mode; telemetry from the gateway
     includes these lines alongside LoRaWAN events.                  */

  /* Step 1: meta line — +TEST: LEN:x, RSSI:x, SNR:x */
  m = l.match(/^\+TEST:\s*LEN:\s*(\d+),\s*RSSI:\s*(-?\d+),\s*SNR:\s*(-?\d+)/i);
  if (m) {
    state._p2pPendingRx = true;
    return;
  }

  /* Step 2: payload line — +TEST: RX "HEXDATA" */
  m = l.match(/^\+TEST:\s*RX\s*"([0-9A-Fa-f]+)"/i);
  if (m && state._p2pPendingRx) {
    state._p2pPendingRx = false;
    handleP2PRxPayload(m[1].toUpperCase());
    return;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   P2P TEST mode — JOIN handshake + LED control
   ═══════════════════════════════════════════════════════════════════ */
var P2P_LED_WINDOW_MS = 2000;   /* must match RX_WINDOW_MS in node sketch */

function handleP2PRxPayload(hex) {
  var type = parseInt(hex.substr(0, 2), 16);

  if (type === 0xFF) {
    /* JOIN_REQUEST from node */
    var nodeId = hex.length >= 4 ? parseInt(hex.substr(2, 2), 16) : 0;
    logEvt('P2P JOIN_REQUEST from node 0x' + ('00' + nodeId.toString(16).toUpperCase()).slice(-2) +
           ' seq=' + (hex.length >= 6 ? parseInt(hex.substr(4, 2), 16) : '?'));
    autoSendJoinAccept(nodeId);
    return;
  }

  if (type === 0x01) {
    /* SENSOR_DATA from node — open LED control window */
    var nodeId = hex.length >= 4 ? parseInt(hex.substr(2, 2), 16) : 0;
    state.lastP2pSensorTs = Date.now();
    logEvt('P2P SENSOR_DATA from node 0x' + ('00' + nodeId.toString(16).toUpperCase()).slice(-2) +
           ' → LED window open (' + P2P_LED_WINDOW_MS + ' ms)');
    updateLedButtons();
    return;
  }
}

function autoSendJoinAccept(nodeId) {
  if (state._joinSent) return;   /* debounce — one accept per JOIN burst */
  state._joinSent = true;
  var nidHex   = ('00' + nodeId.toString(16).toUpperCase()).slice(-2);
  var payload  = '"FE' + nidHex + '"';   /* JOIN_ACCEPT: [0xFE, nodeId] */
  logInfo('Auto-sending JOIN_ACCEPT to node 0x' + nidHex + '…');
  sendCFLR('MODULE_SEND_P2P_PKT', payload, 3000)
    .then(function () {
      logOk('JOIN_ACCEPT sent to node 0x' + nidHex);
      showToast('✓ JOIN_ACCEPT → node 0x' + nidHex);
      setTimeout(function () { state._joinSent = false; }, 6000); /* allow resend after 6 s */
    })
    .catch(function (err) {
      state._joinSent = false;
      logFail('JOIN_ACCEPT failed: ' + (err && err.message ? err.message : err));
    });
}

function sendLedCmd(on) {
  var elapsed = Date.now() - state.lastP2pSensorTs;
  if (elapsed > P2P_LED_WINDOW_MS) {
    showToast('⚠ RX window closed — wait for next sensor packet');
    return;
  }
  var label   = on ? 'ON' : 'OFF';
  var payload = on ? '"10"' : '"11"';
  logInfo('Sending LED ' + label + ' (elapsed ' + elapsed + ' ms in window)…');
  sendCFLR('MODULE_SEND_P2P_PKT', payload, 3000)
    .then(function () {
      logOk('LED ' + label + ' command sent');
      showToast('LED ' + label);
    })
    .catch(function (err) {
      logFail('LED ' + label + ' failed: ' + (err && err.message ? err.message : err));
    });
}

function updateLedButtons() {
  var inWindow = (Date.now() - state.lastP2pSensorTs) < P2P_LED_WINDOW_MS;
  var btnOn  = ge('btn-p2p-led-on');
  var btnOff = ge('btn-p2p-led-off');
  if (btnOn)  { btnOn.disabled  = !inWindow; btnOn.style.opacity  = inWindow ? '1' : '.35'; btnOn.style.cursor  = inWindow ? 'pointer' : 'not-allowed'; }
  if (btnOff) { btnOff.disabled = !inWindow; btnOff.style.opacity = inWindow ? '1' : '.35'; btnOff.style.cursor = inWindow ? 'pointer' : 'not-allowed'; }
  var bar = ge('p2p-win-bar');
  if (bar) {
    var pct = inWindow
      ? Math.max(0, Math.floor(100 * (1 - (Date.now() - state.lastP2pSensorTs) / P2P_LED_WINDOW_MS)))
      : 0;
    bar.style.width = pct + '%';
  }
  var txt = ge('p2p-win-txt');
  if (txt) txt.textContent = inWindow ? 'Window open — send command now' : 'Waiting for data…';
}

function injectP2PPanel() {
  if (!_root || ge('p2p-ctrl-panel')) return;

  /* Find the console-wrap to place LED panel before it */
  var consoleWrap = null;
  for (var i = 0; i < _root.children.length; i++) {
    if (_root.children[i].className === 'console-wrap') {
      consoleWrap = _root.children[i]; break;
    }
  }

  /* P2P LED control strip (left side of bottom row) */
  var panel = document.createElement('div');
  panel.id = 'p2p-ctrl-panel';
  panel.style.cssText =
    'width:220px;flex-shrink:0;padding:8px 12px;' +
    'border-right:1px solid rgba(255,255,255,.07);background:#070a10;' +
    'display:flex;flex-direction:column;justify-content:center;gap:6px';
  panel.innerHTML =
    '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280">P2P LED (GPIO 8)</div>' +
    '<div style="font-size:10px;color:#6b7280" id="p2p-win-txt">Waiting for data…</div>' +
    '<div style="height:3px;background:#1c2030;border-radius:2px">' +
      '<div id="p2p-win-bar" style="height:100%;width:0;background:#22c55e;border-radius:2px;transition:width .1s linear"></div>' +
    '</div>' +
    '<div style="display:flex;gap:6px">' +
      '<button id="btn-p2p-led-on"  disabled onclick="sendLedCmd(true)"  ' +
        'style="flex:1;padding:5px 0;border-radius:5px;border:1px solid #22c55e;background:transparent;color:#22c55e;font-size:11px;font-weight:700;cursor:pointer;opacity:.4">' +
        'LED ON</button>' +
      '<button id="btn-p2p-led-off" disabled onclick="sendLedCmd(false)" ' +
        'style="flex:1;padding:5px 0;border-radius:5px;border:1px solid #ef4444;background:transparent;color:#ef4444;font-size:11px;font-weight:700;cursor:pointer;opacity:.4">' +
        'LED OFF</button>' +
    '</div>';

  /* Button opacity reflects disabled state */
  panel.addEventListener('click', function () {});   /* trigger repaint */

  if (consoleWrap) {
    /* Create a compact bottom row: [LED panel] [console] */
    var row = document.createElement('div');
    row.id = 'bottom-row';
    row.style.cssText =
      'display:flex;flex-direction:row;flex-shrink:0;height:88px;' +
      'border-top:1px solid rgba(255,255,255,.07)';
    _root.insertBefore(row, consoleWrap);
    _root.removeChild(consoleWrap);
    row.appendChild(panel);
    row.appendChild(consoleWrap);
  } else {
    _root.appendChild(panel);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Module Info
   ═══════════════════════════════════════════════════════════════════ */
function queryModuleInfo() {
  logInfo('Reading module info…');
  sendCFLR('MODULE_GET_INFO', '', 3000)
    .then(function (resp) {
      var fw = '—';
      splitResp(resp).forEach(function (l) {
        var s = l.replace(/^CFLR:\d+:OK:/, '');
        if (s && s !== 'OK' && fw === '—') fw = s;
      });
      setEl('inf-fw', fw);
    })
    .catch(function () {});

  sendCFLR('MODULE_GET_DEVEUI', '', 3000)
    .then(function (resp) {
      var m = resp.match(/\+DEVEUI:([0-9A-Fa-f]{16})/i);
      if (m) {
        setEl('inf-deveui', m[1].toUpperCase());
        var inp = ge('inp-deveui');
        if (inp && !inp.value) inp.value = m[1].toUpperCase();
      }
    })
    .catch(function () {});

  queryJoinStatus();
}

function queryJoinStatus() {
  sendCFLR('MODULE_GET_JOIN_STATUS', '', 3000)
    .then(function (resp) {
      var m = resp.match(/\+NJS:(\d)/i);
      if (m) {
        var joined = (parseInt(m[1], 10) === 1);
        state.joined = joined;
        if (!state.joining) setJoinState(joined);
        setEl('inf-njs', joined ? '✓ Joined' : 'Not joined');
      }
    })
    .catch(function () {});
}

/* ═══════════════════════════════════════════════════════════════════
   Key Configuration
   ═══════════════════════════════════════════════════════════════════ */
function setOtaaKeys() {
  var deveui = ge('inp-deveui') ? ge('inp-deveui').value.trim().toUpperCase() : '';
  var appeui = ge('inp-appeui') ? ge('inp-appeui').value.trim().toUpperCase() : '';
  var appkey = ge('inp-appkey') ? ge('inp-appkey').value.trim().toUpperCase() : '';

  if (deveui.length !== 16 || appeui.length !== 16 || appkey.length !== 32) {
    showToast('Check key lengths: DevEUI=16, AppEUI=16, AppKey=32 hex chars');
    return;
  }
  logInfo('Setting OTAA keys…');
  sendCFLR('MODULE_SET_JOIN_MODE', '1', 3000)
    .then(function () { return sendCFLR('MODULE_SET_DEVEUI', deveui, 3000); })
    .then(function () { return sendCFLR('MODULE_SET_APPEUI', appeui, 3000); })
    .then(function () { return sendCFLR('MODULE_SET_APPKEY', appkey, 3000); })
    .then(function () { showToast('✓ OTAA keys set'); saveLocalState(); })
    .catch(function (err) { logFail('Set OTAA keys: ' + (err && err.message ? err.message : err)); });
}

function setAbpKeys() {
  var devaddr = ge('inp-devaddr') ? ge('inp-devaddr').value.trim().toUpperCase() : '';
  var nwkskey = ge('inp-nwkskey') ? ge('inp-nwkskey').value.trim().toUpperCase() : '';
  var appskey = ge('inp-appskey') ? ge('inp-appskey').value.trim().toUpperCase() : '';

  if (devaddr.length !== 8 || nwkskey.length !== 32 || appskey.length !== 32) {
    showToast('Check: DevAddr=8, NwkSKey=32, AppSKey=32 hex chars');
    return;
  }
  logInfo('Setting ABP keys…');
  sendCFLR('MODULE_SET_JOIN_MODE', '0', 3000)
    .then(function () { return sendCFLR('MODULE_SET_DEVADDR', devaddr, 3000); })
    .then(function () { return sendCFLR('MODULE_SET_NWKSKEY', nwkskey, 3000); })
    .then(function () { return sendCFLR('MODULE_SET_APPSKEY', appskey, 3000); })
    .then(function () {
      state.joined = true;
      setJoinState(true);
      showToast('✓ ABP keys set — session active');
      saveLocalState();
    })
    .catch(function (err) { logFail('Set ABP keys: ' + (err && err.message ? err.message : err)); });
}

function readDevEui() {
  sendCFLR('MODULE_GET_DEVEUI', '', 3000)
    .then(function (resp) {
      var m = resp.match(/\+DEVEUI:([0-9A-Fa-f]{16})/i);
      if (m) {
        var inp = ge('inp-deveui');
        if (inp) inp.value = m[1].toUpperCase();
        setEl('inf-deveui', m[1].toUpperCase());
      }
    })
    .catch(function () {});
}

/* ═══════════════════════════════════════════════════════════════════
   Join / Leave
   BEHAVIOUR (anti-bug pattern):
     Optimistic UI update BEFORE async RPC.
     State finally set in .then(resp) after parsing inline response.
     .catch() always reverts UI so user can retry.
     Safety timeout re-enables button if telemetry never arrives.
   ═══════════════════════════════════════════════════════════════════ */
function doJoin() {
  if (state.joining) return;
  state.joining = true;
  state.joined  = false;
  setJoinState('joining');
  setBtnJoin(true, '⏳ Joining…');
  logInfo('Sending JOIN (30 s)…');

  sendCFLR('MODULE_JOIN', '', 32000)
    .then(function (resp) {
      var joinedInline = /\+EVT:JOINED/i.test(resp);
      var failedInline = /\+EVT:JOIN_FAILED(?!_)/i.test(resp);
      if (!joinedInline && !failedInline) {
        logInfo('JOIN sent — waiting for +EVT:JOINED via telemetry…');
        /* Safety: re-enable button after 35 s if telemetry never arrives */
        setTimeout(function () {
          if (state.joining) {
            state.joining = false;
            setBtnJoin(false, '⚡ Join Network');
            setJoinState(false);
            logFail('JOIN timeout — no +EVT received. Check coverage and keys.');
            showToast('Join timeout');
          }
        }, 35000);
      }
    })
    .catch(function (err) {
      state.joining = false;
      setJoinState(false);
      setBtnJoin(false, '⚡ Join Network');
      logFail('JOIN RPC error: ' + (err && err.message ? err.message : err));
    });
}

function doLeave() {
  logInfo('Leaving (SW reset)…');
  sendCFLR('MODULE_SW_RESET', '', 5000)
    .then(function () {
      state.joined  = false;
      state.joining = false;
      setJoinState(false);
      setBtnJoin(false, '⚡ Join Network');
      setEl('inf-njs', 'Not joined');
      showToast('Session cleared');
    })
    .catch(function (err) {
      /* Treat as left even on error — module may have reset */
      state.joined  = false;
      state.joining = false;
      setJoinState(false);
      setBtnJoin(false, '⚡ Join Network');
      logFail('Leave error: ' + (err && err.message ? err.message : err));
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Uplink Send
   BEHAVIOUR: same dual-path pattern as doJoin().
   ═══════════════════════════════════════════════════════════════════ */
function sendUplink() {
  if (!state.joined)    { showToast('Join the network first'); return; }
  if (state.txPending)  { showToast('TX in progress — wait'); return; }

  var portEl = ge('inp-port');
  var payEl  = ge('inp-payload');
  var port   = portEl ? parseInt(portEl.value, 10) : 2;
  var raw    = payEl  ? payEl.value.trim() : '';

  if (isNaN(port) || port < 1 || port > 223) { showToast('Port must be 1–223'); return; }
  if (!raw) { showToast('Enter a payload'); return; }

  var hexPayload;
  if (/^0x/i.test(raw)) {
    hexPayload = raw.replace(/^0x/i, '').toUpperCase();
    if (!/^[0-9A-F]*$/.test(hexPayload) || hexPayload.length % 2 !== 0) {
      showToast('Invalid hex after 0x prefix'); return;
    }
  } else {
    hexPayload = stringToHex(raw);
  }

  var func   = (state.txType === 'confirmed') ? 'MODULE_SEND_CONFIRMED' : 'MODULE_SEND_UNCONFIRMED';
  var params = port + ':' + hexPayload;

  state.txPending = true;
  setBtnSend(true);
  setTxStatus('', 'Sending…');
  logInfo('TX port=' + port + ' len=' + (hexPayload.length / 2) + 'B type=' + state.txType);

  sendCFLR(func, params, 32000)
    .then(function (resp) {
      var confirmed   = /\+EVT:SEND_CONFIRMED/i.test(resp);
      var unconfirmed = /\+EVT:SEND_UNCONFIRMED/i.test(resp);
      if (!confirmed && !unconfirmed) {
        logInfo('TX sent — waiting for +EVT via telemetry…');
        setTimeout(function () {
          if (state.txPending) {
            state.txPending = false;
            setBtnSend(false);
            setTxStatus('fail', 'No ACK');
            logFail('TX timeout — no +EVT received');
          }
        }, 35000);
      }
    })
    .catch(function (err) {
      state.txPending = false;
      setBtnSend(false);
      setTxStatus('fail', 'Failed');
      logFail('TX error: ' + (err && err.message ? err.message : err));
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Radio Config — each fires immediately on UI change
   ═══════════════════════════════════════════════════════════════════ */
function setRegion(val) {
  sendCFLR('MODULE_SET_REGION', val, 3000)
    .then(function () { showToast('Region → ' + val); saveLocalState(); })
    .catch(function () {});
}

function setDR(val) {
  sendCFLR('MODULE_SET_DR', val, 3000)
    .then(function () { saveLocalState(); })
    .catch(function () {});
}

function setTxPower(val) {
  sendCFLR('MODULE_SET_TXP', val, 3000)
    .then(function () { saveLocalState(); })
    .catch(function () {});
}

function setADR(checked) {
  setEl('adr-label', checked ? 'ON' : 'OFF');
  sendCFLR('MODULE_SET_ADR', checked ? '1' : '0', 3000)
    .then(function () { saveLocalState(); })
    .catch(function () {
      var chk = ge('chk-adr');
      if (chk) chk.checked = !checked;
      setEl('adr-label', !checked ? 'ON' : 'OFF');
    });
}

function setConfirm(checked) {
  setEl('cfm-label', checked ? 'ON' : 'OFF');
  sendCFLR('MODULE_SET_CONFIRM', checked ? '1' : '0', 3000)
    .then(function () { saveLocalState(); })
    .catch(function () {
      var chk = ge('chk-cfm');
      if (chk) chk.checked = !checked;
      setEl('cfm-label', !checked ? 'ON' : 'OFF');
    });
}

/* ═══════════════════════════════════════════════════════════════════
   UI Helpers
   ═══════════════════════════════════════════════════════════════════ */
function selectMode(mode) {
  state.mode = mode;
  var tabOtaa = ge('tab-otaa'); var tabAbp  = ge('tab-abp');
  var panOtaa = ge('panel-otaa'); var panAbp  = ge('panel-abp');
  if (tabOtaa) tabOtaa.className = 'btn-mode-tab' + (mode === 'OTAA' ? ' active' : '');
  if (tabAbp)  tabAbp.className  = 'btn-mode-tab' + (mode === 'ABP'  ? ' active' : '');
  if (panOtaa) panOtaa.className = 'keys-panel'   + (mode === 'OTAA' ? '' : ' hidden');
  if (panAbp)  panAbp.className  = 'keys-panel'   + (mode === 'ABP'  ? '' : ' hidden');
  saveLocalState();
}

function selectTxType(type) {
  state.txType = type;
  var btnU = ge('btn-unconfirmed'); var btnC = ge('btn-confirmed');
  if (btnU) btnU.className = 'btn-txtype' + (type === 'unconfirmed' ? ' active' : '');
  if (btnC) btnC.className = 'btn-txtype' + (type === 'confirmed'   ? ' active' : '');
  saveLocalState();
}

function setJoinState(joined) {
  var s = (joined === 'joining') ? 'joining' : (joined ? 'joined' : 'offline');
  var pill = ge('status-pill');
  if (pill) pill.setAttribute('data-state', s);
  var txt = ge('status-text');
  if (txt) txt.textContent = (s === 'joining') ? 'Joining…' : (s === 'joined' ? 'Joined' : 'Not Joined');
  if (s !== 'joining') setBtnJoin(false, joined ? '✓ Re-Join' : '⚡ Join Network');
}

function setBtnJoin(disabled, text) {
  var btn = ge('btn-join');
  if (btn) btn.disabled = disabled;
  if (text) setEl('join-btn-text', text);
}

function setBtnSend(disabled) {
  var btn = ge('btn-send');
  if (btn) btn.disabled = disabled;
  setEl('send-btn-text', disabled ? '⏳ Sending…' : '▶ Send');
}

function setTxStatus(cls, text) {
  var el = ge('tx-status');
  if (!el) return;
  el.textContent = text;
  el.className   = 'tx-status' + (cls ? ' ' + cls : '');
}

function onSlotChange(val) {
  state.slot = val;
  logInfo('Slot → ' + val);
  saveLocalState();
}

function syncSlotSelect() {
  var s = ge('cfg-slot');
  if (s) s.value = state.slot;
}

function formatHexInput(inp, maxLen) {
  var v = inp.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (v.length > maxLen) v = v.substr(0, maxLen);
  inp.value = v;
}

/* ═══════════════════════════════════════════════════════════════════
   LocalStorage Persistence
   ═══════════════════════════════════════════════════════════════════ */
var LS_KEY = 'lr_wioe5_ctl_v1';

function saveLocalState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      slot:   state.slot,
      mode:   state.mode,
      txType: state.txType,
      region: ge('inp-region') ? ge('inp-region').value : '8',
      dr:     ge('inp-dr')     ? ge('inp-dr').value     : '3',
      txp:    ge('inp-txp')    ? ge('inp-txp').value    : '0',
      adr:    ge('chk-adr')    ? ge('chk-adr').checked  : false,
      cfm:    ge('chk-cfm')    ? ge('chk-cfm').checked  : false
    }));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    var obj = JSON.parse(raw);
    if (obj.slot)   state.slot   = obj.slot;
    if (obj.mode)   state.mode   = obj.mode;
    if (obj.txType) state.txType = obj.txType;
    state._saved = obj;
  } catch (e) {}
}

function applyLocalState() {
  var obj = state._saved;
  syncSlotSelect();
  selectMode(state.mode);
  selectTxType(state.txType);
  if (!obj) return;
  if (obj.region && ge('inp-region')) ge('inp-region').value = obj.region;
  if (obj.dr     && ge('inp-dr'))     ge('inp-dr').value     = obj.dr;
  if (obj.txp    && ge('inp-txp'))    ge('inp-txp').value    = obj.txp;
  if (obj.adr !== undefined && ge('chk-adr')) {
    ge('chk-adr').checked = !!obj.adr;
    setEl('adr-label', obj.adr ? 'ON' : 'OFF');
  }
  if (obj.cfm !== undefined && ge('chk-cfm')) {
    ge('chk-cfm').checked = !!obj.cfm;
    setEl('cfm-label', obj.cfm ? 'ON' : 'OFF');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Console Log
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
  while (el.childNodes.length > 200) el.removeChild(el.firstChild);
}

function logTx(msg)   { log('log-tx',   'TX: ' + msg); }
function logOk(msg)   { log('log-ok',   msg); }
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
  t.className   = 'toast';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer   = setTimeout(function () { t.className = 'toast hidden'; }, 2800);
}

/* ═══════════════════════════════════════════════════════════════════
   DOM Helpers
   ═══════════════════════════════════════════════════════════════════ */
function ge(id) { return document.getElementById(id); }
function setEl(id, html) { var el = ge(id); if (el) el.innerHTML = html; }
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════════════════
   Window exports — required for HTML onclick= handlers
   ═══════════════════════════════════════════════════════════════════ */
window.onSlotChange    = onSlotChange;
window.selectMode      = selectMode;
window.selectTxType    = selectTxType;
window.setOtaaKeys     = setOtaaKeys;
window.setAbpKeys      = setAbpKeys;
window.readDevEui      = readDevEui;
window.doJoin          = doJoin;
window.doLeave         = doLeave;
window.sendUplink      = sendUplink;
window.queryModuleInfo = queryModuleInfo;
window.setRegion       = setRegion;
window.setDR           = setDR;
window.setTxPower      = setTxPower;
window.setADR          = setADR;
window.setConfirm      = setConfirm;
window.formatHexInput  = formatHexInput;
window.clearLog        = clearLog;
window.sendLedCmd      = sendLedCmd;
