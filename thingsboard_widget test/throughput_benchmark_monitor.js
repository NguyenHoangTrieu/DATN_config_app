var tbmState = {
  cfg: {
    durationSec: 15,
    payloadBytes: { ble: 244, zb: 99, lora: 50 },
    expected: {
      zigbee: { min: 70, max: 80, label: '70 - 80 kbps' },
      ble: { min: 90, max: 97, label: '90 - 97 kbps' },
      lora: { min: 3.0, max: 3.8, label: '~3.5 kbps' },
      concurrency: { min: 127, max: 154, label: '127 - 154 kbps' }
    }
  },
  activeCase: null,
  protocols: {
    ble: { packets: 0, bytes: 0 },
    zb: { packets: 0, bytes: 0 },
    lora: { packets: 0, bytes: 0 }
  },
  /* Firmware-reported counters — cumulative within reporting window */
  fw: {
    ble: { pkt: 0, b: 0, drop: 0, kbps: 0 },
    zb:  { pkt: 0, b: 0, drop: 0, kbps: 0 },
    lr:  { pkt: 0, b: 0, drop: 0, kbps: 0 },
    ms: 2000
  },
  seen: {},
  seenOrder: [],
  tick: null,
  lastMsgTs: 0
};

var TBM_SEEN_MAX = 500;

self.onInit = function () {
  try {
    tbmLoadConfig();
    tbmApplyTargets();
    tbmBindBridge();
    tbmRender();
    tbmState.tick = setInterval(tbmTick, 500);
  } catch (e) {}
};

self.onDestroy = function () {
  try { window.removeEventListener('da2_bw_bench', tbmBridgeHandler); } catch (e) {}
  try { window.removeEventListener('storage', tbmStorageHandler); } catch (e) {}
  if (tbmState.tick) clearInterval(tbmState.tick);
};

self.onDataUpdated = function () {
  try {
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var i = 0; i < data.length; i++) {
      var kd = data[i];
      if (!kd || !kd.data) continue;
      for (var j = 0; j < kd.data.length; j++) {
        tbmIngest(kd.data[j][0], kd.data[j][1]);
      }
    }
  } catch (e) {}
};

function tbmBridgeHandler(evt) {
  var d = evt && evt.detail;
  if (!d || !d.type) return;
  tbmHandleBridge(d.type, d.payload || {});
}

function tbmStorageHandler(e) {
  if (e.key === 'da2_bw_bench_msg' && e.newValue) {
    try {
      var msg = JSON.parse(e.newValue);
      if (msg && msg.type) tbmHandleBridge(msg.type, msg.payload || {});
    } catch (ex) {}
  }
}

function tbmBindBridge() {
  try { window.removeEventListener('da2_bw_bench', tbmBridgeHandler); } catch (e) {}
  try { window.removeEventListener('storage', tbmStorageHandler); } catch (e) {}
  window.addEventListener('da2_bw_bench', tbmBridgeHandler);
  // storage listener needed for cross-iframe communication (ThingsBoard separate iframes)
  window.addEventListener('storage', tbmStorageHandler);
  try {
    var raw = localStorage.getItem('da2_bw_bench_msg');
    if (raw) {
      var msg = JSON.parse(raw);
      tbmHandleBridge(msg.type, msg.payload || {});
    }
  } catch (e) {}
}

function tbmHandleBridge(type, payload) {
  if (type === 'config') {
    tbmState.cfg = payload;
    tbmApplyTargets();
    tbmLog('Config updated');
    return;
  }
  if (type === 'case-start') {
    tbmResetCounters();
    tbmState.activeCase = {
      id: payload.id,
      title: payload.title,
      protocols: payload.protocols,
      durationMs: (payload.durationSec || tbmState.cfg.durationSec || 15) * 1000,
      startTs: Date.now(),
      finished: false
    };
    tbmSetText('tbm-case-name', payload.title);
    tbmSetText('tbm-result', 'Running');
    tbmSetPill('live', 'Running');
    tbmLog('Case start: ' + payload.title);
    return;
  }
  if (type === 'case-stop') {
    if (tbmState.activeCase) tbmFinalize(true);
  }
}

function tbmLoadConfig() {
  try {
    var raw = localStorage.getItem('da2_bw_cfg');
    if (!raw) return;
    var cfg = JSON.parse(raw);
    if (cfg.durationSec) tbmState.cfg.durationSec = cfg.durationSec;
    if (cfg.payloadBytes) tbmState.cfg.payloadBytes = cfg.payloadBytes;
  } catch (e) {}
}

function tbmApplyTargets() {
  tbmSetText('tbm-target-ble', tbmState.cfg.expected.ble.label);
  tbmSetText('tbm-target-zb', tbmState.cfg.expected.zigbee.label);
  tbmSetText('tbm-target-lora', tbmState.cfg.expected.lora.label);
  tbmSetText('tbm-target-agg', tbmState.cfg.expected.concurrency.label);
}

function tbmResetCounters() {
  tbmState.protocols.ble = { packets: 0, bytes: 0 };
  tbmState.protocols.zb  = { packets: 0, bytes: 0 };
  tbmState.protocols.lora = { packets: 0, bytes: 0 };
  /* Also reset cumulative firmware counters for the new test window */
  tbmState.fw.ble = { pkt: 0, b: 0, drop: 0, kbps: 0 };
  tbmState.fw.zb  = { pkt: 0, b: 0, drop: 0, kbps: 0 };
  tbmState.fw.lr  = { pkt: 0, b: 0, drop: 0, kbps: 0 };
  tbmRender();
}

function tbmIngest(ts, raw) {
  var decoded = tbmDecode(raw);
  if (!decoded) return;
  var key = String(ts) + '|' + decoded;
  if (tbmState.seen[key]) return;
  tbmState.seen[key] = 1;
  tbmState.seenOrder.push(key);
  if (tbmState.seenOrder.length > TBM_SEEN_MAX) {
    delete tbmState.seen[tbmState.seenOrder.shift()];
  }
  var lines = tbmSplit(decoded);
  for (var i = 0; i < lines.length; i++) tbmHandleLine(lines[i]);
}

function tbmHandleLine(line) {
  var m;
  m = line.match(/CFBG:OK:NOTIFY:\d+:0x[0-9A-Fa-f]+:([0-9A-Fa-f]+)/i);
  if (m) {
    var notifyBytes = m[1].length / 2;  // actual bytes from hex payload
    if (notifyBytes >= 32) {
      tbmCount('ble', notifyBytes, line);
    }
    return;
  }

  /* Firmware benchmark snapshot — sent every 2 s from bench_counter.c */
  m = line.match(/BENCH:\s*({[^}]+})/i);
  if (m) {
    tbmHandleBenchJson(m[1]);
    return;
  }

  m = line.match(/RPT:[0-9A-Fa-f]{4},[0-9A-Fa-f]{2},[0-9A-Fa-f]{4},[0-9A-Fa-f]{4},[0-9A-Fa-f]{2},[0-9A-Fa-f]+/i);
  if (m) {
    tbmCount('zb', tbmState.cfg.payloadBytes.zb, line);
    return;
  }

  m = line.match(/\+TEST:\s*RXLRPKT\s+(\d+),\s*-?\d+,\s*-?\d+,\s*"?([0-9A-Fa-f]+)"?/i);
  if (m) {
    tbmCount('lora', tbmState.cfg.payloadBytes.lora, line);
    return;
  }
}

function tbmCount(proto, payloadBytes, line) {
  var p = tbmState.protocols[proto];
  if (!p) return;
  p.packets += 1;
  p.bytes += payloadBytes;
  tbmState.lastMsgTs = Date.now();
  tbmSetPill('live', 'Live');
  tbmRender();
  tbmLog(proto.toUpperCase() + ' ' + tbmShort(line));
}

function tbmHandleBenchJson(jsonStr) {
  try {
    /* Minimal safe parser — avoids eval() */
    var fw = tbmState.fw;
    function extractNum(key) {
      var re = new RegExp('"' + key + '"\\s*:\\s*(\\d+)');
      var m = jsonStr.match(re);
      return m ? parseInt(m[1], 10) : 0;
    }
    var ble_pkt = extractNum('ble_pkt'), ble_b = extractNum('ble_b'), ble_drop = extractNum('ble_drop');
    var zb_pkt  = extractNum('zb_pkt'),  zb_b  = extractNum('zb_b'),  zb_drop  = extractNum('zb_drop');
    var lr_pkt  = extractNum('lr_pkt'),  lr_b  = extractNum('lr_b'),  lr_drop  = extractNum('lr_drop');
    var ms      = extractNum('ms') || 2000;

    fw.ms = ms;
    fw.ble.pkt  += ble_pkt;  fw.ble.b  += ble_b;  fw.ble.drop  += ble_drop;
    fw.zb.pkt   += zb_pkt;   fw.zb.b   += zb_b;   fw.zb.drop   += zb_drop;
    fw.lr.pkt   += lr_pkt;   fw.lr.b   += lr_b;   fw.lr.drop   += lr_drop;

    /* Per-window kbps = bytes_in_this_2s_window * 8 / ms * 1000 */
    fw.ble.kbps = (ble_b * 8) / ms;  /* already kbps since ms gives s/1000 */
    fw.zb.kbps  = (zb_b  * 8) / ms;
    fw.lr.kbps  = (lr_b  * 8) / ms;

    tbmRender();
    tbmLog('FW bench: BLE ' + fw.ble.kbps.toFixed(1) + ' kbps | ZB ' +
           fw.zb.kbps.toFixed(1) + ' kbps | LR ' + fw.lr.kbps.toFixed(1) + ' kbps');
  } catch (e) {}
}

function tbmTick() {
  tbmRender();
  if (!tbmState.activeCase || tbmState.activeCase.finished) return;
  var elapsed = Date.now() - tbmState.activeCase.startTs;
  if (elapsed >= tbmState.activeCase.durationMs) {
    tbmFinalize(false);
  }
}

function tbmFinalize(stopped) {
  if (!tbmState.activeCase || tbmState.activeCase.finished) return;
  // Record actual end time so tbmRates uses real window, not ever-growing Date.now()
  tbmState.activeCase.endTs = Date.now();
  tbmState.activeCase.finished = true;
  var result = tbmComputeResult();
  tbmSetText('tbm-result', result.label);
  tbmSetPill(result.pass ? 'pass' : 'fail', result.pass ? 'PASS' : 'FAIL');
  tbmRender();
  tbmLog((stopped ? 'Case stopped: ' : 'Case finished: ') + result.label);
}

function tbmComputeResult() {
  if (!tbmState.activeCase) return { pass: false, label: '-' };
  var rates = tbmRates();
  var id = tbmState.activeCase.id;
  if (id === 'zigbee') return tbmJudge(rates.zb, tbmState.cfg.expected.zigbee, 'Zigbee');
  if (id === 'ble') return tbmJudge(rates.ble, tbmState.cfg.expected.ble, 'BLE');
  if (id === 'lora') return tbmJudge(rates.lora, tbmState.cfg.expected.lora, 'LoRa');
  return tbmJudge(rates.agg, tbmState.cfg.expected.concurrency, 'Concurrency');
}

function tbmJudge(rate, expected, label) {
  var pass = rate >= expected.min && rate <= expected.max;
  return {
    pass: pass,
    label: label + ': ' + rate.toFixed(1) + ' kbps vs ' + expected.label
  };
}

function tbmRates() {
  var elapsedMs = 1;
  if (tbmState.activeCase && tbmState.activeCase.startTs) {
    var endRef = (tbmState.activeCase.finished && tbmState.activeCase.endTs)
      ? tbmState.activeCase.endTs
      : Date.now();
    elapsedMs = Math.max(1, endRef - tbmState.activeCase.startTs);
  } else if (tbmState.lastMsgTs) {
    elapsedMs = Math.max(1, Date.now() - tbmState.lastMsgTs + 1000);
  }
  function calc(bytes) {
    return (bytes * 8) / (elapsedMs / 1000) / 1000;
  }
  var ble = calc(tbmState.protocols.ble.bytes);
  var zb = calc(tbmState.protocols.zb.bytes);
  var lora = calc(tbmState.protocols.lora.bytes);
  return { ble: ble, zb: zb, lora: lora, agg: ble + zb + lora, elapsedMs: elapsedMs };
}

function tbmRender() {
  var rates = tbmRates();
  tbmSetText('tbm-rate-ble', rates.ble.toFixed(1) + ' kbps');
  tbmSetText('tbm-rate-zb', rates.zb.toFixed(1) + ' kbps');
  tbmSetText('tbm-rate-lora', rates.lora.toFixed(1) + ' kbps');
  tbmSetText('tbm-rate-agg', rates.agg.toFixed(1) + ' kbps');
  tbmSetText('tbm-agg', rates.agg.toFixed(1) + ' kbps');
  tbmSetText('tbm-pkts-ble', String(tbmState.protocols.ble.packets));
  tbmSetText('tbm-pkts-zb', String(tbmState.protocols.zb.packets));
  tbmSetText('tbm-pkts-lora', String(tbmState.protocols.lora.packets));
  tbmSetText('tbm-bytes-ble', tbmState.protocols.ble.bytes + ' B');
  tbmSetText('tbm-bytes-zb', tbmState.protocols.zb.bytes + ' B');
  tbmSetText('tbm-bytes-lora', tbmState.protocols.lora.bytes + ' B');
  tbmSetText('tbm-state-agg', tbmState.activeCase ? tbmState.activeCase.title : 'Idle');
  tbmSetText('tbm-window-agg', (rates.elapsedMs / 1000).toFixed(1) + ' s');

  if (tbmState.activeCase) {
    var elapsedSec = (Date.now() - tbmState.activeCase.startTs) / 1000;
    tbmSetText('tbm-case-name', tbmState.activeCase.title);
    tbmSetText('tbm-case-timer', elapsedSec.toFixed(1) + ' s');
  } else {
    tbmSetText('tbm-case-name', 'None');
    tbmSetText('tbm-case-timer', '0.0 s');
  }

  /* Firmware-reported values */
  var fw = tbmState.fw;
  tbmSetText('tbm-fw-ble-kbps',  fw.ble.kbps.toFixed(1) + ' kbps');
  tbmSetText('tbm-fw-zb-kbps',   fw.zb.kbps.toFixed(1)  + ' kbps');
  tbmSetText('tbm-fw-lr-kbps',   fw.lr.kbps.toFixed(1)  + ' kbps');
  var fwAgg = fw.ble.kbps + fw.zb.kbps + fw.lr.kbps;
  tbmSetText('tbm-fw-agg-kbps',  fwAgg.toFixed(1) + ' kbps');
  tbmSetText('tbm-fw-ble-pkt',   String(fw.ble.pkt));
  tbmSetText('tbm-fw-zb-pkt',    String(fw.zb.pkt));
  tbmSetText('tbm-fw-lr-pkt',    String(fw.lr.pkt));
  tbmSetText('tbm-fw-ble-drop',  String(fw.ble.drop));
  tbmSetText('tbm-fw-zb-drop',   String(fw.zb.drop));
  tbmSetText('tbm-fw-lr-drop',   String(fw.lr.drop));
}

function tbmDecode(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object') {
    raw = raw.result !== undefined ? raw.result : (raw.data !== undefined ? raw.data : JSON.stringify(raw));
  }
  var s = String(raw);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0) {
    var out = '';
    for (var i = 0; i < s.length; i += 2) out += String.fromCharCode(parseInt(s.substr(i, 2), 16));
    return out;
  }
  return s;
}

function tbmSplit(s) {
  if (!s) return [];
  return s.split(/\x1e|\n/).map(function (line) {
    line = String(line || '').trim();
    var idx = line.search(/CF(BG|ZB|LR):|RPT:|\+TEST:|BENCH:/i);
    if (idx > 0) line = line.substring(idx);
    return line;
  }).filter(Boolean);
}

function tbmSetPill(cls, text) {
  var pill = document.getElementById('tbm-pill');
  if (!pill) return;
  pill.className = 'tbm-pill ' + cls;
  pill.textContent = text;
}

function tbmLog(msg) {
  var el = document.getElementById('tbm-log');
  if (!el) return;
  var now = new Date().toTimeString().substr(0, 8);
  el.textContent = '[' + now + '] ' + msg + '\n' + el.textContent;
}

function tbmShort(s) {
  s = String(s || '');
  return s.length > 96 ? s.substr(0, 96) + '...' : s;
}

function tbmSetText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}