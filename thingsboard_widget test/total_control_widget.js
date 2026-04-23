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
  slot: '0',

  /* BLE */
  ble: {
    enabled:     false,
    connected:   false,
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
    enabled:    false,
    netUp:      false,
    shortAddr:  '',
    ep:         '0B',
    intervalMs: 1000,
    tReq:       0,       /* timestamp of last READ_ATTR */
    rtt:        null,
    pendingCluster: null
  },

  /* LoRa */
  lr: {
    enabled:      false,
    configured:   false,
    intervalMs:   2000,
    rttTimeoutMs: 5000,
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

/* ═══════════════════════════════════════════════════════════════════
   ThingsBoard Lifecycle
   ═══════════════════════════════════════════════════════════════════ */
self.onInit = function () {
  try {
    tcLoadLocalState();
    tcSyncUI();
    tcLog('info', 'Total Control ready — slot ' + tcState.slot);
  } catch (e) {
    tcLog('fail', 'onInit: ' + e);
  }
};

self.onDestroy = function () {
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
        tcSplitLines(decoded).forEach(function (line) { tcHandleAsyncLine(line, ts); });
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

function tcSplitLines(s) {
  if (!s) return [];
  return s.split(/\x1e|\n/).map(function (x) {
    x = x.trim();
    /* strip gateway log prefix before protocol tag */
    var ci = x.search(/CF(BG|ZB|LR|ML):/);
    if (ci > 0) x = x.substring(ci);
    return x;
  }).filter(Boolean);
}

/* Send CFBG command */
function tcSendCFBG(verb, params, timeout) {
  var cmd = 'CFML:CFBG:' + tcState.slot + ':' + verb + (params ? ':' + params : '');
  tcLog('tx', cmd);
  return tcSendRpc('sendCommand', tcStrToHex(cmd), timeout || tcState.rpcTimeout)
    .then(function (r) {
      var d = tcDecodeHex(r);
      tcSplitLines(d).forEach(function (l) { tcLog('rx', l); });
      return d;
    })
    .catch(function (e) {
      tcLog('fail', 'CFBG RPC: ' + (e && e.message ? e.message : e));
      throw e;
    });
}

/* Send CFZB command */
function tcSendCFZB(verb, params, timeout) {
  var cmd = 'CFML:CFZB:' + tcState.slot + ':' + verb + (params ? ':' + params : '');
  tcLog('tx', cmd);
  return tcSendRpc('sendCommand', tcStrToHex(cmd), timeout || tcState.rpcTimeout)
    .then(function (r) {
      var d = tcDecodeHex(r);
      tcSplitLines(d).forEach(function (l) { tcLog('rx', l); });
      return d;
    })
    .catch(function (e) {
      tcLog('fail', 'CFZB RPC: ' + (e && e.message ? e.message : e));
      throw e;
    });
}

/* Send CFLR command */
function tcSendCFLR(verb, params, timeout) {
  var cmd = 'CFML:CFLR:' + tcState.slot + ':' + verb + (params ? ':' + params : '');
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

  /* ── BLE NOTIFY ──────────────────────────────────────────────── */
  /* CFBG:OK:NOTIFY:<idx>:0x<handle>:<hex4B> */
  var m = line.match(/CFBG:OK:NOTIFY:(\d+):0x[0-9A-Fa-f]+:([0-9A-Fa-f]{8,})/i);
  if (m) {
    var hex4 = m[2].toUpperCase();
    var tRaw = parseInt(hex4.substr(0, 4), 16);
    var hRaw = parseInt(hex4.substr(4, 4), 16);
    /* Signed 16-bit */
    if (tRaw & 0x8000) tRaw = tRaw - 0x10000;
    if (hRaw & 0x8000) hRaw = hRaw - 0x10000;
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
  m = line.match(/CFBG:OK:CHAR:(\d+):0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{4}):0x([0-9A-Fa-f]{2})/i);
  if (m) {
    var uuid16 = m[2].toUpperCase();
    var handle = parseInt(m[3], 16);
    if (uuid16 === 'AA11') {
      tcState.ble.aa11Handle = handle;
      tcState.ble.cccdHandle = handle + 1;
    }
    if (uuid16 === 'AA12') { tcState.ble.aa12Handle = handle; }
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
  tcLog('info', 'BLE: scanning 5 s…');
  tcSendCFBG('SCAN', '5000', 15000)
    .then(function (resp) {
      var sel = document.getElementById('tc-ble-dev');
      if (!sel) return;
      sel.innerHTML = '<option value="">— select device —</option>';
      tcSplitLines(resp).forEach(function (line) {
        var m = line.match(/SCAN_RESULT:(\d+),([0-9a-fA-F:]{17}),(-?\d+),(.*)/);
        if (!m) return;
        var opt = document.createElement('option');
        opt.value = m[2].toLowerCase();
        opt.dataset.idx = m[1];
        opt.textContent = (m[4] || 'Device_' + m[1]) + ' (' + m[3] + ' dBm)';
        sel.appendChild(opt);
      });
      tcLog('info', 'BLE scan done');
    })
    .catch(function () {});
}

function tcBleConnect() {
  var sel = document.getElementById('tc-ble-dev');
  if (!sel || !sel.value) { tcShowToast('Select a device first'); return; }
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
    .then(function () {
      var dev = tcState.ble;
      if (dev.cccdHandle) {
        tcLog('info', 'BLE: enabling NOTIFY on CCCD=0x' + dev.cccdHandle.toString(16).toUpperCase());
        return tcSendCFBG('NOTIFY', dev.devIdx + ':0x' + dev.cccdHandle.toString(16).toUpperCase() + ':1', 10000);
      }
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
  var inp = document.getElementById('tc-ble-interval');
  if (!inp) return;
  var ms = Math.max(100, parseInt(inp.value, 10) || 500);
  inp.value = ms;
  tcState.ble.intervalMs = ms;
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

/* ═══════════════════════════════════════════════════════════════════
   Zigbee Actions
   ═══════════════════════════════════════════════════════════════════ */
function tcZbNetStart() {
  tcLog('info', 'ZB: starting network…');
  tcSendCFZB('NET_START', null, 15000)
    .then(function () {
      tcState.zb.netUp = true;
      tcSetStatus('zb', 'ok', 'Network up');
      tcShowToast('Zigbee network started');
    })
    .catch(function () {});
}

function tcZbPermitJoin() {
  tcLog('info', 'ZB: permit join 60 s…');
  tcSendCFZB('PERMIT_JOIN', '60', 10000)
    .then(function () { tcLog('info', 'ZB: permit join active'); })
    .catch(function () {});
}

/* One READ_ATTR poll: reads temp (0402/0000) then humid (0405/0000) */
function tcZbPollOnce() {
  var addr = tcState.zb.shortAddr.trim().toUpperCase();
  var ep   = tcState.zb.ep.trim().toUpperCase() || '0B';
  if (!addr) { tcLog('warn', 'ZB: no short address configured'); return Promise.resolve(); }
  tcState.zb.tReq = Date.now();
  /* Build ZCL Read Attribute frames manually via CFZB READ_ATTR */
  return tcSendCFZB('READ_ATTR', addr + ',' + ep + ',0402,0000', 8000)
    .then(function () {
      return tcSendCFZB('READ_ATTR', addr + ',' + ep + ',0405,0000', 8000);
    })
    .catch(function () {});
}

/* ═══════════════════════════════════════════════════════════════════
   LoRa Actions
   ═══════════════════════════════════════════════════════════════════ */
function tcLrSetupTestMode() {
  tcLog('info', 'LoRa: entering P2P TEST mode…');
  /* Set module to TEST mode (P2P) then RX */
  tcSendCFLR('P2P_SETUP', null, 15000)
    .then(function () {
      return tcSendCFLR('P2P_RX_MODE', null, 8000);
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
  if (!tcState.lr.configured) { tcLog('warn', 'LoRa not configured'); return Promise.resolve(); }
  var seq = (tcState.lr.seq + 1) & 0xFF;
  tcState.lr.seq = seq;
  tcState.lr.pendingSeq = seq;
  var reqHex = 'AA' + (seq < 16 ? '0' : '') + seq.toString(16).toUpperCase();
  tcState.lr.tReq = Date.now();

  return tcSendCFLR('P2P_TX_MODE', null, 5000)
    .then(function () { return tcSendCFLR('P2P_SEND', reqHex, 8000); })
    .then(function () { return tcSendCFLR('P2P_RX_MODE', null, 5000); })
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
  tcState[tech].enabled = enabled;
  tcSaveLocalState();
}

function tcOnSlotChange(val) {
  tcState.slot = val;
  tcLog('info', 'Slot changed to ' + val);
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
  var slotSel = document.getElementById('tc-slot');
  if (slotSel) slotSel.value = tcState.slot;
  /* restore interval inputs */
  var bleInt = document.getElementById('tc-ble-interval');
  if (bleInt) bleInt.value = tcState.ble.intervalMs;
  var zbInt = document.getElementById('tc-zb-interval');
  if (zbInt) zbInt.value = tcState.zb.intervalMs;
  var zbAddr = document.getElementById('tc-zb-addr');
  if (zbAddr) zbAddr.value = tcState.zb.shortAddr;
  var zbEp = document.getElementById('tc-zb-ep');
  if (zbEp) zbEp.value = tcState.zb.ep;
  var lrInt = document.getElementById('tc-lr-interval');
  if (lrInt) lrInt.value = tcState.lr.intervalMs;
  var lrTo = document.getElementById('tc-lr-rtt-to');
  if (lrTo) lrTo.value = tcState.lr.rttTimeoutMs;
  /* toggle switches */
  var bleEn = document.getElementById('tc-ble-en');
  if (bleEn) bleEn.checked = tcState.ble.enabled;
  var zbEn = document.getElementById('tc-zb-en');
  if (zbEn) zbEn.checked = tcState.zb.enabled;
  var lrEn = document.getElementById('tc-lr-en');
  if (lrEn) lrEn.checked = tcState.lr.enabled;
}

/* ═══════════════════════════════════════════════════════════════════
   LocalStorage persistence
   ═══════════════════════════════════════════════════════════════════ */
var TC_LS_KEY = 'da2_total_ctrl_v1';

function tcSaveLocalState() {
  try {
    var saved = {
      slot: tcState.slot,
      ble: { enabled: tcState.ble.enabled, intervalMs: tcState.ble.intervalMs },
      zb:  { enabled: tcState.zb.enabled, shortAddr: tcState.zb.shortAddr, ep: tcState.zb.ep, intervalMs: tcState.zb.intervalMs },
      lr:  { enabled: tcState.lr.enabled, intervalMs: tcState.lr.intervalMs, rttTimeoutMs: tcState.lr.rttTimeoutMs }
    };
    localStorage.setItem(TC_LS_KEY, JSON.stringify(saved));
  } catch (e) {}
}

function tcLoadLocalState() {
  try {
    var raw = localStorage.getItem(TC_LS_KEY);
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (saved.slot) tcState.slot = saved.slot;
    if (saved.ble) {
      tcState.ble.enabled    = !!saved.ble.enabled;
      tcState.ble.intervalMs = Math.max(100, saved.ble.intervalMs || 500);
    }
    if (saved.zb) {
      tcState.zb.enabled    = !!saved.zb.enabled;
      tcState.zb.shortAddr  = saved.zb.shortAddr || '';
      tcState.zb.ep         = saved.zb.ep || '0B';
      tcState.zb.intervalMs = Math.max(100, saved.zb.intervalMs || 1000);
    }
    if (saved.lr) {
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
