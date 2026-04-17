/* =====================================================================
   DA2 LoRa Wio-E5 P2P Widget — ThingsBoard JavaScript
   Protocol (from firmware: DA2_esp_LAN/Application/LoRa_Handler/):
     TX: CFML:CFLR:<slot>:<FUNCTION_NAME>[:<params>]  (hex-encoded via sendCommand RPC)
     RX: CFLR:<slot>:OK:<response>                    (lines split by \x1E)
         CFLR:<slot>:FAIL:<err>:<response_or_NOREPLY>
     Async: CFLR:<slot>:EVT:<raw_module_line>          via ThingsBoard telemetry key "data"

   Module: Seeed Wio-E5 (STM32WL) — P2P TEST mode.

   CFML Functions → AT commands → Expected responses (stack_006_config.json):
     MODULE_GET_INFO               → AT+VER                              → +VER:<version>
     MODULE_SW_RESET               → AT+RESET                            → (module resets)
     MODULE_ENTER_P2P_MODE         → AT+MODE=TEST                        → +MODE: TEST
     MODULE_SET_P2P_CONFIG:<args>  → AT+TEST=RFCFG,F,SF,BW,TXPR,RXPR,  → +TEST: RFCFG ...
                                       POW,CRC,IQ,NET
     MODULE_SEND_P2P_PKT:<hex>     → AT+TEST=TXLRPKT,"<hex>"            → +TEST: TXLRPKT
     MODULE_ENTER_P2P_RX           → AT+TEST=RXLRPKT                    → +TEST: RXLRPKT

   Async events handled (inline RPC response only — no telemetry datasource):
     +MODE: TEST      → set testMode, update status pill
     +TEST: RFCFG ... → update RF config info display
     +TEST: RXLRPKT (bare, no data) → set rxActive, update status pill
     +TEST: STOP/ERROR              → clear rxActive, update status pill
     NOTE: +TEST: RXLRPKT with packet data is handled by the Monitor Widget.

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
  slot:       '0',
  testMode:   false,    /* true once AT+MODE=TEST confirmed */
  rxActive:   false,    /* true while in RXLRPKT listen mode */
  txPending:  false,
  rpcTimeout: 12000
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
    logInfo('Widget ready — LoRa P2P slot ' + state.slot);
    setTimeout(function () { queryModuleInfo(); }, 800);
  } catch (e) {
    logFail('onInit: ' + (e && e.message ? e.message : e));
  }
};

self.onDestroy = function () {};

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
        /* Route P2P async event lines — +TEST: RXLRPKT / +TEST: TXLRPKT / +TEST: RFCFG */
        if (/^\+TEST:|CFLR:[0-9]:EVT/.test(line)) {
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
   Async Event Handler (Wio-E5 P2P TEST mode)
   Only handles inline RPC response lines for RF/mode state.
   RX packet events ("+TEST: RXLRPKT ...") are handled exclusively by
   the Monitor Widget via telemetry.
   ═══════════════════════════════════════════════════════════════════ */
function handleAsyncEvent(line) {
  var l = line.replace(/^CFLR:\d+:(EVT:|OK:|FAIL:[^:]*:)/, '');

  /* +TEST: RFCFG — RF config acknowledged */
  if (/^\+TEST:\s*RFCFG/i.test(l)) {
    setEl('inf-deveui', l.replace(/^\+TEST:\s*RFCFG\s*/i, ''));
    logInfo('RF config applied: ' + l);
    return;
  }

  /* +MODE: TEST — module entered TEST mode */
  if (/^\+MODE:\s*TEST/i.test(l)) {
    state.testMode = true;
    setP2PStatus('ready', 'TEST Mode');
    setEl('inf-njs', 'TEST mode');
    logInfo('Module entered TEST (P2P) mode');
    return;
  }

  /* +TEST: RXLRPKT (bare, without data — listening started) */
  if (/^\+TEST:\s*RXLRPKT\s*$/i.test(l)) {
    state.rxActive = true;
    setP2PStatus('rx', 'Listening\u2026');
    logInfo('P2P RX mode active \u2014 listening for packets');
    return;
  }

  /* +TEST: STOP or +TEST: ERROR */
  if (/^\+TEST:\s*(STOP|ERROR)/i.test(l)) {
    state.rxActive = false;
    setP2PStatus('ready', 'TEST Mode');
    logInfo(l);
    return;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Module Info (on init)
   ═══════════════════════════════════════════════════════════════════ */
function queryModuleInfo() {
  logInfo('Reading module info\u2026');
  sendCFLR('MODULE_GET_INFO', '', 3000)
    .then(function (resp) {
      var fw = '—';
      splitResp(resp).forEach(function (l) {
        var stripped = l.replace(/^CFLR:\d+:OK:/, '');
        var vm = stripped.match(/^\+VER:\s*(.+)/i);
        if (vm && fw === '—') fw = vm[1].trim();
      });
      setEl('inf-fw', fw);
    })
    .catch(function () {});
  setEl('inf-njs', state.testMode ? 'TEST mode' : 'LoRaWAN mode');
}

/* ═══════════════════════════════════════════════════════════════════
   P2P Control Functions
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Enter Wio-E5 TEST mode: AT+MODE=TEST → +MODE: TEST
 */
function p2pEnterMode() {
  logInfo('Entering P2P TEST mode…');
  sendCFLR('MODULE_ENTER_P2P_MODE', '', 4000)
    .then(function (resp) {
      if (/\+MODE:\s*TEST/i.test(resp)) {
        state.testMode = true;
        setP2PStatus('ready', 'TEST Mode');
        showToast('✓ TEST mode active');
        logInfo('+MODE: TEST — ready to configure RF');
      } else {
        logFail('Unexpected response to AT+MODE=TEST: ' + resp);
      }
      saveLocalState();
    })
    .catch(function (err) {
      logFail('Enter P2P mode failed: ' + (err && err.message ? err.message : err));
    });
}

/**
 * Send AT+TEST=RFCFG,F,SF,BW,TXPR,RXPR,POW,CRC,IQ,NET
 * All values read from the UI inputs.
 */
function p2pSetConfig() {
  if (!state.testMode) {
    showToast('Enter TEST mode first');
    return;
  }
  var freq = (ge('inp-p2p-freq') ? ge('inp-p2p-freq').value.trim() : '868');
  var sf   = (ge('inp-p2p-sf')   ? ge('inp-p2p-sf').value   : 'SF7');
  var bw   = (ge('inp-p2p-bw')   ? ge('inp-p2p-bw').value   : '125');
  var txp  = (ge('inp-p2p-txp')  ? ge('inp-p2p-txp').value  : '14');
  var txpr = (ge('inp-p2p-txpr') ? ge('inp-p2p-txpr').value : '12');
  var rxpr = (ge('inp-p2p-rxpr') ? ge('inp-p2p-rxpr').value : '15');

  /* AT+TEST=RFCFG,<F>,<SF>,<BW>,<TXPR>,<RXPR>,<POW>,ON,OFF,OFF */
  var rfArgs = freq + ',' + sf + ',' + bw + ',' + txpr + ',' + rxpr + ',' + txp + ',ON,OFF,OFF';
  logInfo('Setting RF config: RFCFG,' + rfArgs);
  sendCFLR('MODULE_SET_P2P_CONFIG', rfArgs, 4000)
    .then(function (resp) {
      if (/\+TEST:\s*RFCFG/i.test(resp)) {
        showToast('✓ RF config applied');
        setEl('inf-deveui', freq + ' MHz ' + sf + ' BW' + bw);
        logInfo('RF config OK');
      } else {
        logFail('Unexpected RFCFG response: ' + resp);
      }
      saveLocalState();
    })
    .catch(function (err) {
      logFail('Set RF config failed: ' + (err && err.message ? err.message : err));
    });
}

/**
 * Start continuous P2P receive: AT+TEST=RXLRPKT
 * Received packets arrive as +TEST: RXLRPKT <len>, <rssi>, <snr>, <hex>
 */
function p2pStartRx() {
  if (!state.testMode) { showToast('Enter TEST mode first'); return; }
  if (state.rxActive)  { showToast('RX already active'); return; }
  logInfo('Starting P2P RX (AT+TEST=RXLRPKT)…');
  setBtnRx(true, '⏳ Listening…');
  sendCFLR('MODULE_ENTER_P2P_RX', '', state.rpcTimeout)
    .then(function (resp) {
      /* +TEST: RXLRPKT acknowledgement; packets arrive via telemetry async */
      if (/\+TEST:\s*RXLRPKT/i.test(resp)) {
        state.rxActive = true;
        setP2PStatus('rx', 'Listening…');
        showToast('P2P RX active');
        logInfo('Listening for P2P packets…');
      } else {
        setBtnRx(false, '📡 Start RX');
        logFail('Unexpected RXLRPKT response: ' + resp);
      }
    })
    .catch(function (err) {
      setBtnRx(false, '📡 Start RX');
      logFail('Start RX failed: ' + (err && err.message ? err.message : err));
    });
}

/**
 * Stop P2P receive by issuing a SW reset (Wio-E5 has no explicit STOP RX in P2P mode).
 */
function p2pStopRx() {
  logInfo('Stopping RX via SW reset…');
  sendCFLR('MODULE_SW_RESET', '', 5000)
    .then(function () {
      state.rxActive = false;
      state.testMode = false;
      setP2PStatus('offline', 'Idle');
      setBtnRx(false, '📡 Start RX');
      setEl('inf-njs', 'LoRaWAN mode');
      showToast('Module reset — P2P stopped');
      logInfo('SW reset: P2P RX stopped');
    })
    .catch(function (err) {
      state.rxActive = false;
      setBtnRx(false, '📡 Start RX');
      logFail('Stop RX error: ' + (err && err.message ? err.message : err));
    });
}

/* ═══════════════════════════════════════════════════════════════════
   P2P TX
   ═══════════════════════════════════════════════════════════════════ */
function sendP2P() {
  if (!state.testMode) { showToast('Enter TEST mode first'); return; }
  if (state.txPending)  { showToast('TX in progress — wait'); return; }

  var payEl = ge('inp-payload');
  var raw   = payEl ? payEl.value.trim() : '';
  if (!raw) { showToast('Enter a payload'); return; }

  /* Build hex payload */
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

  state.txPending = true;
  setBtnSend(true);
  setTxStatus('', 'Sending…');
  logInfo('P2P TX: AT+TEST=TXLRPKT,"' + hexPayload + '" (' + (hexPayload.length / 2) + ' B)…');

  sendCFLR('MODULE_SEND_P2P_PKT', hexPayload, 8000)
    .then(function () {
      state.txPending = false;
      setBtnSend(false);
      setTxStatus('ok', '\u2713 Sent');
      showToast('P2P packet sent');
      logInfo('\u2713 TXLRPKT sent');
    })
    .catch(function (err) {
      state.txPending = false;
      setBtnSend(false);
      setTxStatus('fail', 'Failed');
      logFail('P2P TX error: ' + (err && err.message ? err.message : err));
    });
}

/* ═══════════════════════════════════════════════════════════════════
   UI Helpers — P2P
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Update the status pill.
 * state: 'offline' | 'ready' | 'rx'
 */
function setP2PStatus(s, text) {
  var pill = ge('status-pill');
  if (pill) pill.setAttribute('data-state', s);
  var txt = ge('status-text');
  if (txt) txt.textContent = text || s;
}

function setBtnRx(disabled, text) {
  var btn = ge('btn-rx');
  if (btn) btn.disabled = disabled;
  if (text) {
    var el = ge('rx-btn-text');
    if (el) el.textContent = text;
  }
}

function setBtnSend(disabled) {
  var btn = ge('btn-send');
  if (btn) btn.disabled = disabled;
  setEl('send-btn-text', disabled ? '\u23f3 Sending\u2026' : '\u25b6 Send TXLRPKT');
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
var LS_KEY = 'lr_wioe5_p2p_state_v1';

function saveLocalState() {
  try {
    var obj = {
      slot:     state.slot,
      testMode: state.testMode,
      freq:     ge('inp-p2p-freq') ? ge('inp-p2p-freq').value : '868',
      sf:       ge('inp-p2p-sf')   ? ge('inp-p2p-sf').value   : 'SF7',
      bw:       ge('inp-p2p-bw')   ? ge('inp-p2p-bw').value   : '125',
      txp:      ge('inp-p2p-txp')  ? ge('inp-p2p-txp').value  : '14',
      txpr:     ge('inp-p2p-txpr') ? ge('inp-p2p-txpr').value : '12',
      rxpr:     ge('inp-p2p-rxpr') ? ge('inp-p2p-rxpr').value : '15'
    };
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch (e) {}
}

function loadLocalState() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    var obj = JSON.parse(raw);
    if (obj.slot) state.slot = obj.slot;
    if (obj.testMode !== undefined) state.testMode = !!obj.testMode;
    state._saved = obj;
  } catch (e) {}
}

function applyLocalState() {
  var obj = state._saved;
  syncSlotSelect();
  if (!obj) return;
  if (obj.freq && ge('inp-p2p-freq')) ge('inp-p2p-freq').value = obj.freq;
  if (obj.sf   && ge('inp-p2p-sf'))   ge('inp-p2p-sf').value   = obj.sf;
  if (obj.bw   && ge('inp-p2p-bw'))   ge('inp-p2p-bw').value   = obj.bw;
  if (obj.txp  && ge('inp-p2p-txp'))  ge('inp-p2p-txp').value  = obj.txp;
  if (obj.txpr && ge('inp-p2p-txpr')) ge('inp-p2p-txpr').value = obj.txpr;
  if (obj.rxpr && ge('inp-p2p-rxpr')) ge('inp-p2p-rxpr').value = obj.rxpr;
  setP2PStatus(state.testMode ? 'ready' : 'offline',
               state.testMode ? 'TEST Mode' : 'Idle');
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
window.p2pEnterMode    = p2pEnterMode;
window.p2pSetConfig    = p2pSetConfig;
window.p2pStartRx      = p2pStartRx;
window.p2pStopRx       = p2pStopRx;
window.sendP2P         = sendP2P;
window.queryModuleInfo = queryModuleInfo;
window.formatHexInput  = formatHexInput;
window.clearLog        = clearLog;

