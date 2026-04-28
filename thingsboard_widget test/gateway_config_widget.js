var gwc = {
  rpcTimeout: 12000,
  maxConsoleLines: 300,
  lastTs: 0
};

// Single source for firmware URL default version in this widget.
var CURRENT_FW_VERSION = "2.1.1";

self.onInit = function () {
  try {
    // 1) wire tab behavior
    gwcBindTabs();
    // 2) bind form events + action buttons
    gwcBindUi();
    // 3) initial diagnostics
    gwcLog("INFO", "Gateway config widget ready");
  } catch (e) {
    gwcLog("FAIL", "onInit: " + e);
  }
};

self.onDestroy = function () {};

self.onDataUpdated = function () {
  try {
    // Telemetry stream from ThingsBoard datasource(s).
    var data = self.ctx && self.ctx.data;
    if (!data || !data.length) return;
    for (var i = 0; i < data.length; i++) {
      var kd = data[i];
      if (!kd || !kd.data || !kd.data.length) continue;
      for (var j = 0; j < kd.data.length; j++) {
        var item = kd.data[j];
        if (!item || item.length < 2) continue;
        var ts = item[0];
        // Skip older rows to avoid duplicate logs on dashboard refresh.
        if (ts <= gwc.lastTs) continue;
        gwc.lastTs = ts;
        var decoded = gwcDecodeHex(item[1]);
        var lines = gwcSplitLines(decoded);
        for (var k = 0; k < lines.length; k++) {
          gwcLog("RX", lines[k]);
        }
      }
    }
  } catch (e) {
    gwcLog("FAIL", "onDataUpdated: " + e);
  }
};

function gwcBindTabs() {
  var tabs = document.getElementById("gwc-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".gwc-tab") : null;
    if (!btn) return;
    var id = btn.getAttribute("data-tab");
    var allTabs = tabs.querySelectorAll(".gwc-tab");
    for (var i = 0; i < allTabs.length; i++) allTabs[i].classList.remove("active");
    btn.classList.add("active");

    // Show only the selected pane and hide others.
    var panes = document.querySelectorAll(".gwc-pane");
    for (var j = 0; j < panes.length; j++) panes[j].classList.add("hidden");
    var pane = document.getElementById("gwc-pane-" + id);
    if (pane) pane.classList.remove("hidden");
  });
}

function gwcBindUi() {
  // Fill firmware URLs once; user edits remain untouched.
  gwcApplyDefaultFirmwareUrls();

  var inetType = ge("gwc-inet-type");
  var wifiAuth = ge("gwc-wifi-auth");

  if (inetType) {
    inetType.addEventListener("change", gwcRefreshInternetMode);
    gwcRefreshInternetMode();
  }
  if (wifiAuth) {
    wifiAuth.addEventListener("change", gwcRefreshWifiAuth);
    gwcRefreshWifiAuth();
  }

  var srvType = ge("gwc-server-type");
  if (srvType) {
    srvType.addEventListener("change", gwcRefreshServerMode);
    gwcRefreshServerMode();
  }

  bindClick("gwc-btn-set-internet", gwcSetInternetConfig);
  bindClick("gwc-btn-set-server", gwcSetServerConfig);
  bindClick("gwc-btn-save-lan-url", gwcSaveLanUrl);
  bindClick("gwc-btn-save-wan-url", gwcSaveWanUrl);
  bindClick("gwc-btn-fota", gwcTriggerLanFota);
  bindClick("gwc-btn-clear-log", function () {
    var box = ge("gwc-console");
    if (box) box.textContent = "";
  });
}

function gwcApplyDefaultFirmwareUrls() {
  var lanEl = ge("gwc-lan-url");
  var wanEl = ge("gwc-wan-url");
  var lanDefault = "http://192.168.1.100:8080/api/v1/TOKEN/firmware?title=DA2_esp_LAN&version=" + CURRENT_FW_VERSION;
  var wanDefault = "http://192.168.1.100:8080/api/v1/TOKEN/firmware?title=DA2_esp&version=" + CURRENT_FW_VERSION;

  if (lanEl && !lanEl.value) lanEl.value = lanDefault;
  if (wanEl && !wanEl.value) wanEl.value = wanDefault;
}

function gwcRefreshInternetMode() {
  var t = gv("gwc-inet-type") || "WiFi";
  setHidden("gwc-wifi-box", t !== "WiFi");
  setHidden("gwc-lte-box", t !== "LTE");
  setHidden("gwc-eth-box", t !== "Ethernet");
}

function gwcRefreshWifiAuth() {
  var auth = gv("gwc-wifi-auth") || "PERSONAL";
  setHidden("gwc-wifi-user-wrap", auth !== "ENTERPRISE");
}

function gwcRefreshServerMode() {
  var t = gv("gwc-server-type") || "MQTT";
  setHidden("gwc-mqtt-box", t !== "MQTT");
  setHidden("gwc-http-box", t !== "HTTP/HTTPS");
  setHidden("gwc-coap-box", t !== "CoAP");
}

function gwcComputeFallback(primary, fallbackEnabled) {
  // Mirror Basic app behavior.
  if (!fallbackEnabled) return null;
  if (primary === "LTE" || primary === "ETHERNET") return "WIFI";
  var apn = (gv("gwc-lte-apn") || "").trim();
  return apn ? "LTE" : "ETHERNET";
}

function gwcSetInternetConfig() {
  var itype = gv("gwc-inet-type") || "WiFi";
  var fb = gc("gwc-inet-fallback");
  var primary = itype.toUpperCase() === "WIFI" ? "WIFI" : itype.toUpperCase();
  var fbType = gwcComputeFallback(primary, fb);
  var cfin = fb ? ("CFIN:" + primary + ":1:" + fbType) : ("CFIN:" + primary + ":0");

  if (itype === "WiFi") {
    var ssid = (gv("gwc-wifi-ssid") || "").trim();
    var pwd = gv("gwc-wifi-pwd") || "";
    var auth = gv("gwc-wifi-auth") || "PERSONAL";
    var user = (gv("gwc-wifi-user") || "").trim();
    if (!ssid) return gwcLog("FAIL", "WiFi SSID is required");
    if (auth === "ENTERPRISE" && !user) return gwcLog("FAIL", "WiFi username is required for ENTERPRISE");

    var cfwf = auth === "ENTERPRISE"
      ? ("CFWF:" + ssid + ":" + pwd + ":" + user + ":ENTERPRISE")
      : ("CFWF:" + ssid + ":" + pwd + ":PERSONAL");

    // WiFi config must be sent before CFIN apply.
    gwcSendCommand(cfwf)
      .then(function () { return gwcSendCommand(cfin); })
      .then(function () { gwcLog("OK", "Internet config applied (WiFi)"); })
      .catch(function (e) { gwcLog("FAIL", "Internet set failed: " + e.message); });
    return;
  }

  if (itype === "LTE") {
    var apn = (gv("gwc-lte-apn") || "m-wap").trim() || "m-wap";
    var lu = (gv("gwc-lte-user") || "").trim();
    var lp = gv("gwc-lte-pwd") || "";
    var cflt = "CFLT::" + apn + ":" + lu + ":" + lp + ":USB:true:30000:0:05:06";

    // LTE config must be sent before CFIN apply.
    gwcSendCommand(cflt)
      .then(function () { return gwcSendCommand(cfin); })
      .then(function () { gwcLog("OK", "Internet config applied (LTE)"); })
      .catch(function (e) { gwcLog("FAIL", "Internet set failed: " + e.message); });
    return;
  }

  gwcSendCommand(cfin)
    .then(function () { gwcLog("OK", "Internet config applied (Ethernet)"); })
    .catch(function (e) { gwcLog("FAIL", "Internet set failed: " + e.message); });
}

function gwcSetServerConfig() {
  var type = gv("gwc-server-type") || "MQTT";

  if (type === "MQTT") {
    var broker = (gv("gwc-mq-broker") || "").trim();
    var token = (gv("gwc-mq-token") || "").trim();
    if (!broker) return gwcLog("FAIL", "MQTT broker is required");

    var cfsv = "CFSV:0";
    var cfmq = "CFMQ:" + broker + "|" + token + "|v1/devices/me/rpc/request/+|v1/devices/me/telemetry|v1/devices/me/attributes|0|0";
    // Keep command order consistent with Python app (CFSV first, then protocol config).
    gwcSendCommand(cfsv)
      .then(function () { return gwcSendCommand(cfmq); })
      .then(function () { gwcLog("OK", "Server config applied (MQTT)"); })
      .catch(function (e) { gwcLog("FAIL", "Server set failed: " + e.message); });
    return;
  }

  if (type === "HTTP/HTTPS") {
    var url = (gv("gwc-hp-url") || "").trim();
    var htk = (gv("gwc-hp-token") || "").trim();
    var tls = gc("gwc-hp-tls") ? 1 : 0;
    if (!url) return gwcLog("FAIL", "HTTP URL is required");

    var cfsv2 = "CFSV:2";
    var cfhp = "CFHP:" + url + "|" + htk + "|8080|" + tls + "|0|10000";
    gwcSendCommand(cfsv2)
      .then(function () { return gwcSendCommand(cfhp); })
      .then(function () { gwcLog("OK", "Server config applied (HTTP/HTTPS)"); })
      .catch(function (e) { gwcLog("FAIL", "Server set failed: " + e.message); });
    return;
  }

  var host = (gv("gwc-cp-host") || "").trim();
  var path = (gv("gwc-cp-resource") || "").trim();
  var ctk = (gv("gwc-cp-token") || "").trim();
  if (!host) return gwcLog("FAIL", "CoAP host is required");
  var cfsv1 = "CFSV:1";
  var cfcp = "CFCP:" + host + "|" + path + "|" + ctk + "|5683|0|2000|4|1500";
  gwcSendCommand(cfsv1)
    .then(function () { return gwcSendCommand(cfcp); })
    .then(function () { gwcLog("OK", "Server config applied (CoAP)"); })
    .catch(function (e) { gwcLog("FAIL", "Server set failed: " + e.message); });
}

function gwcSaveLanUrl() {
  var url = (gv("gwc-lan-url") || "").trim();
  if (!url) return gwcLog("FAIL", "LAN URL is required");
  gwcSendCommand("CFML:CFFU:" + url)
    .then(function () { gwcLog("OK", "LAN OTA URL saved"); })
    .catch(function (e) { gwcLog("FAIL", "Save LAN URL failed: " + e.message); });
}

function gwcSaveWanUrl() {
  var url = (gv("gwc-wan-url") || "").trim();
  if (!url) return gwcLog("FAIL", "WAN URL is required");
  gwcSendCommand("CFFU:" + url)
    .then(function () { gwcLog("OK", "WAN OTA URL saved"); })
    .catch(function (e) { gwcLog("FAIL", "Save WAN URL failed: " + e.message); });
}

function gwcTriggerLanFota() {
  gwcSendCommand("CFML:CFFW")
    .then(function () { gwcLog("OK", "FOTA trigger sent: CFML:CFFW"); })
    .catch(function (e) { gwcLog("FAIL", "FOTA trigger failed: " + e.message); });
}

function gwcSendCommand(cmd) {
  gwcLog("TX", cmd);
  var hex = gwcStringToHex(cmd);
  return new Promise(function (resolve, reject) {
    if (!self.ctx || !self.ctx.controlApi) {
      reject(new Error("No controlApi target"));
      return;
    }
    // RPC method must match backend routing contract.
    self.ctx.controlApi.sendTwoWayCommand("sendCommand", hex, gwc.rpcTimeout)
      .subscribe(function (resp) {
        var decoded = gwcDecodeHex(resp);
        var lines = gwcSplitLines(decoded);
        if (!lines.length && decoded) lines = [decoded];
        for (var i = 0; i < lines.length; i++) gwcLog("RX", lines[i]);
        resolve(decoded);
      }, function (err) {
        reject(err || new Error("RPC failed"));
      });
  });
}

function gwcStringToHex(s) {
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var h = s.charCodeAt(i).toString(16).toUpperCase();
    out += h.length === 1 ? ("0" + h) : h;
  }
  return out;
}

function gwcDecodeHex(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object") {
    raw = raw.result !== undefined ? raw.result
      : raw.data !== undefined ? raw.data
      : JSON.stringify(raw);
  }
  var s = String(raw);
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0 && s.length > 0) {
    // Response may be hex-encoded string from firmware uplink.
    var out = "";
    for (var i = 0; i < s.length; i += 2) {
      var b = parseInt(s.substr(i, 2), 16);
      if (!isNaN(b)) out += String.fromCharCode(b);
    }
    return out;
  }
  return s;
}

function gwcSplitLines(s) {
  if (!s) return [];
  // Firmware may pack multiple lines by Record Separator or newline.
  return s.split(/\x1e|\n/)
    .map(function (x) { return (x || "").trim(); })
    .filter(function (x) { return !!x; });
}

function gwcLog(level, msg) {
  var box = ge("gwc-console");
  var line = "[" + gwcNow() + "] [" + level + "] " + msg;
  if (!box) return;
  box.textContent += (box.textContent ? "\n" : "") + line;

  var lines = box.textContent.split("\n");
  // Prevent unbounded DOM/log growth.
  if (lines.length > gwc.maxConsoleLines) {
    lines = lines.slice(lines.length - gwc.maxConsoleLines);
    box.textContent = lines.join("\n");
  }
  box.scrollTop = box.scrollHeight;
}

function gwcNow() {
  var d = new Date();
  var hh = ("0" + d.getHours()).slice(-2);
  var mm = ("0" + d.getMinutes()).slice(-2);
  var ss = ("0" + d.getSeconds()).slice(-2);
  return hh + ":" + mm + ":" + ss;
}

function bindClick(id, fn) {
  var el = ge(id);
  if (!el) return;
  el.addEventListener("click", fn);
}

function ge(id) { return document.getElementById(id); }
function gv(id) { var e = ge(id); return e ? e.value : ""; }
function gc(id) { var e = ge(id); return !!(e && e.checked); }
function setHidden(id, hidden) {
  var e = ge(id);
  if (!e) return;
  if (hidden) e.classList.add("hidden");
  else e.classList.remove("hidden");
}
