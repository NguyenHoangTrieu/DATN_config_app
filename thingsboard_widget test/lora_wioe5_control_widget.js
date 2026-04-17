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
