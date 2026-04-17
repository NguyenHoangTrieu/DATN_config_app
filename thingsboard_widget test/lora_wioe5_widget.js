/* =====================================================================
   DA2 LoRa WiOe5 (RAK3172) Widget — ThingsBoard JavaScript
   Protocol (from firmware: DA2_esp_LAN/Application/LoRa_Handler/):
     TX: CFML:CFLR:<slot>:<FUNCTION_NAME>[:<params>]  (hex-encoded via sendCommand RPC)
     RX: CFLR:<slot>:OK:<response>                    (lines split by \x1E)
         CFLR:<slot>:FAIL:<err>:<response_or_NOREPLY>
     Async: CFLR:<slot>:EVT:+EVT:<data>               via ThingsBoard telemetry key "data"

   Module: RAK3172 — always in AT command mode, no mode-switch needed.

   CFML Functions → AT commands → Expected responses:
     MODULE_GET_INFO               → AT+VER=?          → OK + version string
     MODULE_GET_DEVEUI             → AT+DEVEUI=?        → +DEVEUI:<16hex>
     MODULE_GET_JOIN_STATUS        → AT+NJS=?           → +NJS:0 (not joined) | +NJS:1 (joined)
     MODULE_SET_DEVEUI:<16hex>     → AT+DEVEUI=<val>    → OK
     MODULE_SET_APPEUI:<16hex>     → AT+APPEUI=<val>    → OK
     MODULE_SET_APPKEY:<32hex>     → AT+APPKEY=<val>    → OK
     MODULE_SET_DEVADDR:<8hex>     → AT+DEVADDR=<val>   → OK
     MODULE_SET_NWKSKEY:<32hex>    → AT+NWKSKEY=<val>   → OK
     MODULE_SET_APPSKEY:<32hex>    → AT+APPSKEY=<val>   → OK
     MODULE_SET_JOIN_MODE:<0|1>    → AT+NJM=<val>       → OK  (0=ABP, 1=OTAA)
     MODULE_JOIN                   → AT+JOIN=1:0:10:8   → OK (30 000 ms) + async +EVT:JOINED
     MODULE_SET_REGION:<0-8>       → AT+BAND=<val>      → OK
     MODULE_SET_DR:<0-5>           → AT+DR=<val>        → OK
     MODULE_SET_ADR:<0|1>          → AT+ADR=<val>       → OK
     MODULE_SET_TXP:<0-15>         → AT+TXP=<val>       → OK
     MODULE_SET_CONFIRM:<0|1>      → AT+CFM=<val>       → OK
     MODULE_SEND_UNCONFIRMED:<p:hex> → AT+SEND=<val>    → (30 000 ms) + async +EVT:SEND_CONFIRMED
     MODULE_SEND_CONFIRMED:<p:hex>   → AT+SEND=<val>    → (30 000 ms) + async +EVT:SEND_CONFIRMED
     MODULE_READ_RECV              → AT+RECV=?          → +RECV:<port>:<len>:<hex>

   Async events from telemetry (CFLR:<slot>:EVT: prefix stripped):
     +EVT:JOINED               → setJoinState(true)
     +EVT:JOIN_FAILED_<n>      → log retry
     +EVT:JOIN_FAILED          → setJoinState(false)
     +EVT:RX1:<port>:<len>:<hex> | RX2:… → updateRxPanel(…)
     +EVT:SEND_CONFIRMED       → TX confirmed toast + re-enable Send button
     +EVT:SEND_UNCONFIRMED     → TX sent toast + re-enable Send button

   IMPORTANT THINGSBOARD NOTES:
     - Use document.getElementById() — widget has single root DOM, no shadow DOM
     - Avoid .finally() — not polyfilled in all TB versions
     - Avoid Object.values() — use Object.keys() loop instead
     - Capture mutable state vars BEFORE async enqueue() to avoid closure bugs
   ===================================================================== */

/* ═══════════════════════════════════════════════════════════════════
   App State
   ═══════════════════════════════════════════════════════════════════ */
var state = {
  slot:        '0',
  mode:        'OTAA',    /* 'OTAA' | 'ABP' */
  txType:      'unconfirmed',
  joined:      false,
  joining:     false,
  txPending:   false,
  rpcTimeout:  12000
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
    logInfo('Widget ready — LoRa slot ' + state.slot);
    /* Deferred so DOM is fully ready */
    setTimeout(function () { queryModuleInfo(); }, 800);
  } catch (e) {
    logFail('onInit: ' + (e && e.message ? e.message : e));
  }
};

self.onDestroy = function () {};

/* Telemetry: async events from firmware (unsolicited module output) */
var _tbLastLogTs = 0;
self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var ki = 0; ki < data.length; ki++) {
      var kd = data[ki];
      if (!kd || !kd.data || !kd.data.length) continue;
      var latest  = kd.data[kd.data.length - 1];
      var raw     = latest[1];
      var now = Date.now();
      if (now - _tbLastLogTs > 15000) {
        _tbLastLogTs = now;
        logEvt('[TB] telemetry rx: ' + String(raw).substr(0, 28) + '…');
      }
      var decoded = decodeResp(raw);
      splitResp(decoded).forEach(function (line) {
        handleAsyncEvent(line);
      });
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
    /* Strip gateway log prefix before CFLR: if present */
    var ci = x.indexOf('CFLR:');
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

/**
 * sendCFLR — hex-encode "CFML:CFLR:<slot>:<func>[:<params>]" and send as RPC.
 * ALWAYS returns a Promise that resolves with the decoded string response.
 * The inline RPC response is logged here; async events are handled in handleAsyncEvent().
 */
function sendCFLR(func, params, timeoutMs) {
  var cmd = 'CFML:CFLR:' + state.slot + ':' + func + (params ? ':' + params : '');
  logTx(cmd);
  return sendRPC('sendCommand', stringToHex(cmd), timeoutMs || state.rpcTimeout)
    .then(function (resp) {
      var decoded = decodeResp(resp);
      splitResp(decoded).forEach(function (line) {
        /* Log and route inline response lines as async events — handles the case
           where the module emits an event-style line in the synchronous response */
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
   Handles both:
     - Lines received via onDataUpdated (telemetry path)
     - +EVT: lines that appear inside an RPC response (inline path)
   ═══════════════════════════════════════════════════════════════════ */
function handleAsyncEvent(line) {
  /* Strip CFLR:<slot>:EVT: or CFLR:<slot>:OK: prefix */
  var l = line.replace(/^CFLR:\d+:(EVT:|OK:|FAIL:[^:]*:)/, '');

  /* +EVT:JOINED */
  if (/^\+EVT:JOINED/i.test(l)) {
    state.joining = false;
    state.joined  = true;
    setJoinState(true);
    showToast('✓ Joined network!');
    logInfo('+EVT:JOINED — LoRaWAN session active');
    queryJoinStatus(); /* refresh module NJS to confirm */
    return;
  }

  /* +EVT:JOIN_FAILED_<n> — retry in progress */
  var m = l.match(/^\+EVT:JOIN_FAILED_(\d+)/i);
  if (m) {
    logFail('+EVT:JOIN_FAILED attempt ' + m[1] + ' — retrying…');
    return;
  }

  /* +EVT:JOIN_FAILED — all retries exhausted */
  if (/^\+EVT:JOIN_FAILED/i.test(l)) {
    state.joining = false;
    state.joined  = false;
    setJoinState(false);
    showToast('✗ Join failed — check keys / coverage');
    logFail('+EVT:JOIN_FAILED — join aborted');
    return;
  }

  /* +EVT:SEND_CONFIRMED — confirmed uplink ACK'd by server */
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

  /* +EVT:SEND_UNCONFIRMED — unconfirmed uplink sent */
  if (/^\+EVT:SEND_UNCONFIRMED/i.test(l)) {
    if (state.txPending) {
      state.txPending = false;
      setBtnSend(false);
      setTxStatus('ok', '✓ Sent');
      showToast('Uplink sent (unconfirmed)');
    }
    logInfo('+EVT:SEND_UNCONFIRMED');
    return;
  }

  /* +EVT:RX1:<port>:<len>:<hex> or +EVT:RX2:<port>:<len>:<hex> — downlink */
  m = l.match(/^\+EVT:(RX[12]):(\d+):(\d+):([0-9A-Fa-f]*)/i);
  if (m) {
    updateRxPanel(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[4]);
    return;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Module Info (on init)
   ═══════════════════════════════════════════════════════════════════ */
function queryModuleInfo() {
  logInfo('Reading module info…');
  sendCFLR('MODULE_GET_INFO', '', 3000)
    .then(function (resp) {
      /* Version string is somewhere in the response */
      var fw = '—';
      splitResp(resp).forEach(function (l) {
        var stripped = l.replace(/^CFLR:\d+:OK:/, '');
        /* RAK3172 returns e.g. "RUI_4.1.1_RAK3172" */
        if (stripped && stripped !== 'OK' && fw === '—') fw = stripped;
      });
      setEl('inf-fw', fw);
    })
    .catch(function () {});

  sendCFLR('MODULE_GET_DEVEUI', '', 3000)
    .then(function (resp) {
      var m = resp.match(/\+DEVEUI:([0-9A-Fa-f]{16})/i);
      if (m) {
        setEl('inf-deveui', m[1].toUpperCase());
        /* Pre-fill the DevEUI input if it's empty */
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
      /* +NJS:1 = joined, +NJS:0 = not joined */
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
   OTAA / ABP Key Configuration
   ═══════════════════════════════════════════════════════════════════ */
function setOtaaKeys() {
  var deveui = (ge('inp-deveui') ? ge('inp-deveui').value.trim().toUpperCase() : '');
  var appeui = (ge('inp-appeui') ? ge('inp-appeui').value.trim().toUpperCase() : '');
  var appkey = (ge('inp-appkey') ? ge('inp-appkey').value.trim().toUpperCase() : '');

  if (deveui.length !== 16 || appeui.length !== 16 || appkey.length !== 32) {
    showToast('Check key lengths: DevEUI=16, AppEUI=16, AppKey=32 hex chars');
    return;
  }

  logInfo('Setting OTAA keys…');
  /* Set join mode to OTAA first (NJM=1), then set keys sequentially */
  sendCFLR('MODULE_SET_JOIN_MODE', '1', 3000)
    .then(function () { return sendCFLR('MODULE_SET_DEVEUI', deveui, 3000); })
    .then(function () { return sendCFLR('MODULE_SET_APPEUI', appeui, 3000); })
    .then(function () { return sendCFLR('MODULE_SET_APPKEY', appkey, 3000); })
    .then(function () {
      showToast('✓ OTAA keys set');
      logInfo('OTAA keys configured — ready to Join');
      saveLocalState();
    })
    .catch(function (err) {
      logFail('Set OTAA keys failed: ' + (err && err.message ? err.message : err));
    });
}

function setAbpKeys() {
  var devaddr = (ge('inp-devaddr') ? ge('inp-devaddr').value.trim().toUpperCase() : '');
  var nwkskey = (ge('inp-nwkskey') ? ge('inp-nwkskey').value.trim().toUpperCase() : '');
  var appskey = (ge('inp-appskey') ? ge('inp-appskey').value.trim().toUpperCase() : '');

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
      /* ABP: mark as joined immediately — no JOIN procedure needed */
      state.joined = true;
      setJoinState(true);
      showToast('✓ ABP keys set — session active');
      logInfo('ABP keys configured — session active');
      saveLocalState();
    })
    .catch(function (err) {
      logFail('Set ABP keys failed: ' + (err && err.message ? err.message : err));
    });
}

function readDevEui() {
  sendCFLR('MODULE_GET_DEVEUI', '', 3000)
    .then(function (resp) {
      var m = resp.match(/\+DEVEUI:([0-9A-Fa-f]{16})/i);
      if (m) {
        var inp = ge('inp-deveui');
        if (inp) inp.value = m[1].toUpperCase();
        setEl('inf-deveui', m[1].toUpperCase());
        logInfo('DevEUI read: ' + m[1].toUpperCase());
      } else {
        logFail('Could not parse DevEUI from: ' + resp);
      }
    })
    .catch(function () {});
}

/* ═══════════════════════════════════════════════════════════════════
   Join / Leave
   BEHAVIOUR:
     doJoin()  — Optimistic: update UI to "Joining…" immediately.
                 RPC returns OK quickly (firmware queues the JOIN).
                 The actual join result arrives async via +EVT:JOINED
                 or +EVT:JOIN_FAILED. handleAsyncEvent() handles both
                 the telemetry path AND the inline-in-RPC-response path.
                 In .catch(): revert to not-joined UI.
   ═══════════════════════════════════════════════════════════════════ */
function doJoin() {
  if (state.joining) return;
  state.joining = true;
  state.joined  = false;
  setJoinState('joining');
  setBtnJoin(true, '⏳ Joining…');
  logInfo('Sending JOIN (timeout 30 s)…');

  sendCFLR('MODULE_JOIN', '', 32000)
    .then(function (resp) {
      /* The RPC response arrives when the AT command returns.
         The +EVT:JOINED event may be inline here OR arrive later via telemetry.
         handleAsyncEvent() is called for every line in sendCFLR().then() already,
         so no extra parsing needed — just handle the case where the event
         was NOT in the response (will arrive via onDataUpdated). */
      var joinedInline = /\+EVT:JOINED/i.test(resp);
      var failedInline = /\+EVT:JOIN_FAILED(?!_)/i.test(resp);

      if (!joinedInline && !failedInline) {
        /* Event not in inline response — waiting for async telemetry */
        logInfo('JOIN command sent — waiting for +EVT:JOINED via telemetry…');
        setBtnJoin(true, '⏳ Joining…');
        /* Safety fallback: if telemetry never arrives (WAN drop), let user retry after 35 s */
        setTimeout(function () {
          if (state.joining) {
            state.joining = false;
            setBtnJoin(false, '⚡ Join Network');
            setJoinState(false);
            logFail('JOIN timeout — no +EVT received. Check coverage and keys.');
            showToast('Join timeout — no response from network');
          }
        }, 35000);
      }
      /* If inline: handleAsyncEvent already called setJoinState() */
    })
    .catch(function (err) {
      state.joining = false;
      setJoinState(false);
      setBtnJoin(false, '⚡ Join Network');
      logFail('JOIN RPC error: ' + (err && err.message ? err.message : err));
    });
}

function doLeave() {
  logInfo('Leaving network (software reset)…');
  /* RAK3172 has no explicit LEAVE command — reset via MODULE_SW_RESET which
     clears the session.  Use MODULE_FACTORY_RESET only if explicitly needed. */
  sendCFLR('MODULE_SW_RESET', '', 5000)
    .then(function () {
      state.joined  = false;
      state.joining = false;
      setJoinState(false);
      setBtnJoin(false, '⚡ Join Network');
      setEl('inf-njs', 'Not joined');
      showToast('Module reset — session cleared');
      logInfo('Session cleared via SW reset');
    })
    .catch(function (err) {
      /* Even on error, treat as left — module may have reset */
      state.joined  = false;
      state.joining = false;
      setJoinState(false);
      setBtnJoin(false, '⚡ Join Network');
      logFail('Leave/reset error: ' + (err && err.message ? err.message : err));
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Uplink Send
   BEHAVIOUR:
     sendUplink() — Optimistic: disable Send button + set status "Sending…"
                    RPC timeout is 32 000 ms (firmware waits for TX complete).
                    +EVT:SEND_CONFIRMED/UNCONFIRMED may arrive inline in the
                    RPC response or later via telemetry.
                    In .catch(): re-enable button + show error.
   ═══════════════════════════════════════════════════════════════════ */
function sendUplink() {
  if (!state.joined) { showToast('Join the network first'); return; }
  if (state.txPending) { showToast('TX in progress — wait'); return; }

  var portEl = ge('inp-port');
  var payEl  = ge('inp-payload');
  var port   = portEl ? parseInt(portEl.value, 10) : 2;
  var raw    = payEl ? payEl.value.trim() : '';

  if (isNaN(port) || port < 1 || port > 223) { showToast('Port must be 1–223'); return; }
  if (!raw) { showToast('Enter a payload'); return; }

  /* Convert payload: if starts with "0x" treat as hex literal, else encode as ASCII hex */
  var hexPayload;
  if (/^0x/i.test(raw)) {
    hexPayload = raw.replace(/^0x/i, '').toUpperCase();
    if (!/^[0-9A-F]*$/.test(hexPayload) || hexPayload.length % 2 !== 0) {
      showToast('Invalid hex payload after 0x prefix');
      return;
    }
  } else {
    hexPayload = stringToHex(raw);
  }

  var func = (state.txType === 'confirmed') ? 'MODULE_SEND_CONFIRMED' : 'MODULE_SEND_UNCONFIRMED';
  var params = port + ':' + hexPayload;

  state.txPending = true;
  setBtnSend(true);
  setTxStatus('', 'Sending…');
  logInfo('Sending uplink port=' + port + ' len=' + (hexPayload.length / 2) + 'B type=' + state.txType + '…');

  sendCFLR(func, params, 32000)
    .then(function (resp) {
      /* +EVT:SEND_CONFIRMED/UNCONFIRMED may be inline — handled by sendCFLR's own
         splitResp → handleAsyncEvent chain. If NOT inline, txPending stays true until
         the event arrives via telemetry (or the safety timeout below triggers). */
      var confirmed   = /\+EVT:SEND_CONFIRMED/i.test(resp);
      var unconfirmed = /\+EVT:SEND_UNCONFIRMED/i.test(resp);
      if (!confirmed && !unconfirmed) {
        logInfo('TX sent — waiting for +EVT:SEND_CONFIRMED via telemetry…');
        /* Safety timeout: re-enable button after 35 s regardless */
        setTimeout(function () {
          if (state.txPending) {
            state.txPending = false;
            setBtnSend(false);
            setTxStatus('fail', 'No ACK');
            logFail('TX timeout — no +EVT:SEND_CONFIRMED received');
          }
        }, 35000);
      }
      /* If inline: handleAsyncEvent already called setBtnSend(false) */
    })
    .catch(function (err) {
      state.txPending = false;
      setBtnSend(false);
      setTxStatus('fail', 'Failed');
      logFail('Send uplink error: ' + (err && err.message ? err.message : err));
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Read Last Downlink
   ═══════════════════════════════════════════════════════════════════ */
function readRecv() {
  sendCFLR('MODULE_READ_RECV', '', 5000)
    .then(function (resp) {
      /* +RECV:<port>:<len>:<hex> */
      var lines = splitResp(resp);
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].replace(/^CFLR:\d+:OK:/, '');
        var m = l.match(/^\+RECV:(\d+):(\d+):([0-9A-Fa-f]*)/i);
        if (m) {
          updateRxPanel('POLL', parseInt(m[1], 10), parseInt(m[2], 10), m[3]);
          return;
        }
      }
      logInfo('No downlink data buffered');
    })
    .catch(function () {});
}

function updateRxPanel(window_str, port, len, hexData) {
  setEl('rx-port',   String(port));
  setEl('rx-size',   String(len) + ' B');
  setEl('rx-window', window_str);
  setEl('rx-time',   new Date().toLocaleTimeString());
  setEl('rx-hex',    hexData || '(empty)');
  var ascii = hexData ? hexToString(hexData).replace(/[^\x20-\x7e]/g, '.') : '';
  setEl('rx-ascii',  ascii || '(binary)');
  logInfo('Downlink [' + window_str + '] port=' + port + ' ' + len + 'B: ' + (hexData || '—'));
}

/* ═══════════════════════════════════════════════════════════════════
   Radio Config — each fires immediately on UI change
   ═══════════════════════════════════════════════════════════════════ */
function setRegion(val) {
  sendCFLR('MODULE_SET_REGION', val, 3000)
    .then(function () { showToast('Region set to ' + val); saveLocalState(); })
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
      /* Revert toggle on failure */
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
  var tabOtaa = ge('tab-otaa');
  var tabAbp  = ge('tab-abp');
  var panOtaa = ge('panel-otaa');
  var panAbp  = ge('panel-abp');
  if (tabOtaa) tabOtaa.className = 'btn-mode-tab' + (mode === 'OTAA' ? ' active' : '');
  if (tabAbp)  tabAbp.className  = 'btn-mode-tab' + (mode === 'ABP'  ? ' active' : '');
  if (panOtaa) panOtaa.className = 'keys-panel'   + (mode === 'OTAA' ? '' : ' hidden');
  if (panAbp)  panAbp.className  = 'keys-panel'   + (mode === 'ABP'  ? '' : ' hidden');
  saveLocalState();
}

function selectTxType(type) {
  state.txType = type;
  var btnU = ge('btn-unconfirmed');
  var btnC = ge('btn-confirmed');
  if (btnU) btnU.className = 'btn-txtype' + (type === 'unconfirmed' ? ' active' : '');
  if (btnC) btnC.className = 'btn-txtype' + (type === 'confirmed'   ? ' active' : '');
  saveLocalState();
}

function setJoinState(joined) {
  /* 'joining' = special intermediate string */
  var s = (joined === 'joining') ? 'joining' : (joined ? 'joined' : 'offline');
  var pill = ge('status-pill');
  if (pill) pill.setAttribute('data-state', s);
  var txt = ge('status-text');
  if (txt) txt.textContent = s === 'joining' ? 'Joining…' : (s === 'joined' ? 'Joined' : 'Not Joined');

  if (s !== 'joining') {
    setBtnJoin(false, joined ? '✓ Re-Join' : '⚡ Join Network');
  }
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
  el.className = 'tx-status' + (cls ? ' ' + cls : '');
}

function onSlotChange(val) {
  state.slot = val;
  logInfo('Stack slot changed to ' + val);
  saveLocalState();
}

function syncSlotSelect() {
  var s = ge('cfg-slot');
  if (s) s.value = state.slot;
}

/* Restrict input to hex characters and max length */
function formatHexInput(inp, maxLen) {
  var v = inp.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (v.length > maxLen) v = v.substr(0, maxLen);
  inp.value = v;
}

/* ═══════════════════════════════════════════════════════════════════
   LocalStorage Persistence
   ═══════════════════════════════════════════════════════════════════ */
var LS_KEY = 'lr_wioe5_state_v1';

function saveLocalState() {
  try {
    var obj = {
      slot:   state.slot,
      mode:   state.mode,
      txType: state.txType,
      region: ge('inp-region') ? ge('inp-region').value : '8',
      dr:     ge('inp-dr')     ? ge('inp-dr').value     : '3',
      txp:    ge('inp-txp')    ? ge('inp-txp').value    : '0',
      adr:    ge('chk-adr')    ? ge('chk-adr').checked  : false,
      cfm:    ge('chk-cfm')    ? ge('chk-cfm').checked  : false
    };
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
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
    /* Store for applyLocalState */
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
  if (obj.adr    !== undefined && ge('chk-adr')) {
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
  /* Keep log bounded to 200 lines */
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
  t.className = 'toast';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, 2800);
}

/* ═══════════════════════════════════════════════════════════════════
   DOM Helpers
   ═══════════════════════════════════════════════════════════════════ */
function ge(id) { return document.getElementById(id); }

function setEl(id, html) {
  var el = ge(id);
  if (el) el.innerHTML = html;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════════════════
   Window exports — required for ThingsBoard inline onclick handlers
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
window.readRecv        = readRecv;
window.queryModuleInfo = queryModuleInfo;
window.setRegion       = setRegion;
window.setDR           = setDR;
window.setTxPower      = setTxPower;
window.setADR          = setADR;
window.setConfirm      = setConfirm;
window.formatHexInput  = formatHexInput;
window.clearLog        = clearLog;
