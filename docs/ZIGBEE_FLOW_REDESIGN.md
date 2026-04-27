# Zigbee Flow Redesign — Phân Tích & Sửa Lỗi

## 1. Flow Mong Muốn (Desired Flow)

```
Device Join
    │
    ▼  (silent — no data transmitted)
[Auto Read Name]  ← JS gửi ZCL Read Attr 0x0000/0x0005 sau 2s
    │
    ▼
Display device name in node list
    │
    ▼  (user action)
User clicks [Connect]
    │
    ▼
JS starts polling: sendZclReadAttr every 5s (Temp 0402 + Humid 0405)
    │
    ▼
UI displays live Temperature & Humidity
```

---

## 2. Flow Hiện Tại — Tại Sao Không Đúng

```
Device Join
    │
    ▼
Zigbee.begin() → setReporting(1, 5s, 0.5°C) ← ❌ BUG 1: cấu hình auto-push ngay
    │
    ▼
~5s sau khi join
    │
    ├── Firmware loop() gọi zbTempSensor.report() ← ❌ BUG 2: tự động gửi ZCL 0x82/0x0A
    │
    ▼
JS nhận auto-report
    │
    ├── verified=false → bị drop bởi auth gatekeeper   ← OK (bị chặn)
    │   (nhưng dữ liệu vẫn được truyền qua RF!)
    │
    ▼
Auto-read name sau 2s (nodeAnnounce)
    │
    ▼
verified=true → control panel unlocked
    │
    ▼
connected=false → Temp/Humid bị drop ← Passive filter, KHÔNG gửi request
    │
    ▼  (user clicks Connect)
connected=true → Nhận incoming auto-reports ← ❌ BUG 3: không chủ động read
```

---

## 3. Chi Tiết Vấn Đề

### ❌ BUG 1 & 2 — Firmware tự động gửi dữ liệu ngay khi join

**File:** `ESP32C6_Zigbee_Sensor.ino`

**Vị trí 1 — `setup()`:**
```cpp
// Cấu hình ZCL Attribute Reporting:
// Khi stack hoạt động, thiết bị TỰ ĐỘNG push dữ liệu theo min/max interval.
zbTempSensor.setReporting(1, REPORT_INTERVAL / 1000, 0.5f);         // ← gây ra auto-push
zbTempSensor.setHumidityReporting(1, REPORT_INTERVAL / 1000, 1.0f); // ← gây ra auto-push
```

**Vị trí 2 — `loop()`:**
```cpp
zbTempSensor.setTemperature(tempC);
zbTempSensor.setHumidity(humidPct);
zbTempSensor.report();   // ← chủ động gửi ZCL 0x82/0x0A mỗi 5s
```

**Kết quả:** Thiết bị liên tục phát ZCL Attribute Report frames (0x82/0x0A) lên coordinator
mỗi 5 giây, bất kể người dùng có nhấn Connect hay chưa.

**Vi phạm yêu cầu:** *"khi thiết bị join mạng, thiết bị KHÔNG được gửi gì hết"*

---

### ❌ BUG 3 — `toggleNodeConnect()` là passive filter, không phải active trigger

**File:** `zigbee_control_widget_v2.js`

**Code hiện tại:**
```js
function toggleNodeConnect(shortAddr) {
  var n = state.nodes[shortAddr];
  if (!n) return;
  n.connected = !n.connected;
  // Chỉ đổi flag — không làm gì thêm!
  renderNodeList();
  saveLocalState();
}
```

**Kết quả:** Khi `connected = true`, UI chỉ cho phép nhận auto-report từ firmware.
Nếu firmware không auto-report (sau khi fix Bug 1&2), nhấn Connect sẽ không có tác dụng gì.

**Yêu cầu thực tế:** *"nhấn Connect → bắt đầu GỬI YÊU CẦU để đọc"* → phải chủ động poll.

---

### ⚠️ NOTE — `verified` vs `connected`: Hai gate riêng biệt

| Flag | Meaning | Gated by |
|------|---------|---------|
| `verified` | Auth handshake passed (model = `DATN_AUTH_KEY`) | ZCL Basic 0x0000/0x0005 read |
| `connected` | User đã nhấn Connect | Manual UI button |

Cả hai phải `true` thì sensor data mới hiển thị. Flow đúng:
1. `verified` được set sau khi đọc tên → **Auto** (JS tự làm)
2. `connected` được set khi user nhấn → **Manual** (user action)

---

## 4. Thiết Kế Lại (Redesign)

### 4.1 Firmware — Chuyển sang "On-Demand" mode

**Nguyên tắc:**
- Device **KHÔNG** tự push bất kỳ dữ liệu nào
- Coordinator **CHỦ ĐỘNG** đọc bằng ZCL Read Attribute Request
- Device respond với giá trị hiện tại khi có request

**Giữ lại:**
- `setTemperature()` và `setHumidity()` trong `loop()` → cập nhật giá trị ZCL attribute trong bộ nhớ nội bộ của device → để coordinator đọc được giá trị mới nhất

**Bỏ đi:**
- `setReporting()` / `setHumidityReporting()` → không cấu hình auto-push
- `zbTempSensor.report()` trong loop → không chủ động gửi

### 4.2 JS — Connect kích hoạt polling

**Nguyên tắc:**
- Dùng `setInterval` để poll ZCL Read Attr sau khi user Connect
- Dùng `clearInterval` để dừng poll khi Disconnect
- Lưu interval ID vào `g_pollTimers` (biến module-level, KHÔNG trong `state`)

---

## 5. Code Changes

### 5.1 `ESP32C6_Zigbee_Sensor.ino` — Remove auto-reporting

**Xóa khỏi `setup()`:**
```cpp
// ← XÓA 2 dòng này:
zbTempSensor.setReporting(1, REPORT_INTERVAL / 1000, 0.5f);
zbTempSensor.setHumidityReporting(1, REPORT_INTERVAL / 1000, 1.0f);
```

**Sửa `loop()` — xóa `report()`, giữ `setTemperature`/`setHumidity`:**
```cpp
// BEFORE:
zbTempSensor.setTemperature(tempC);
zbTempSensor.setHumidity(humidPct);
zbTempSensor.report();   // ← XÓA

// AFTER:
zbTempSensor.setTemperature(tempC);   // cập nhật ZCL attr (để on-demand read hoạt động)
zbTempSensor.setHumidity(humidPct);   // cập nhật ZCL attr (để on-demand read hoạt động)
// Không gọi report() — device im lặng cho đến khi có Read Request
```

### 5.2 `zigbee_control_widget_v2.js` — Polling on Connect

**Thêm module-level variable:**
```js
var g_pollTimers = {};  // shortAddr → setInterval ID (không lưu vào state)
```

**Viết lại `toggleNodeConnect()`:**
```js
function toggleNodeConnect(shortAddr) {
  var n = state.nodes[shortAddr];
  if (!n) return;
  n.connected = !n.connected;

  if (n.connected) {
    // Đọc ngay lần đầu
    var ep = n.ep || '0B';
    sendZclReadAttr(shortAddr, ep, '0402', '0000', 8000).catch(function(){});
    sendZclReadAttr(shortAddr, ep, '0405', '0000', 8000).catch(function(){});
    // Poll định kỳ mỗi 5s
    g_pollTimers[shortAddr] = setInterval(function () {
      var node = state.nodes[shortAddr];
      if (!node || !node.connected) {
        clearInterval(g_pollTimers[shortAddr]);
        delete g_pollTimers[shortAddr];
        return;
      }
      sendZclReadAttr(shortAddr, node.ep || '0B', '0402', '0000', 8000).catch(function(){});
      sendZclReadAttr(shortAddr, node.ep || '0B', '0405', '0000', 8000).catch(function(){});
    }, 5000);
    logInfo('🔗 Connected — polling 0x' + shortAddr + ' every 5s');
  } else {
    if (g_pollTimers[shortAddr]) {
      clearInterval(g_pollTimers[shortAddr]);
      delete g_pollTimers[shortAddr];
    }
    logInfo('⛔ Disconnected — stopped polling 0x' + shortAddr);
  }

  renderNodeList();
  saveLocalState();
}
```

**Thêm cleanup vào `onDestroy`:**
```js
// Dừng tất cả poll timers khi widget bị destroy
try {
  Object.keys(g_pollTimers).forEach(function (addr) {
    clearInterval(g_pollTimers[addr]);
  });
  g_pollTimers = {};
} catch (e) {}
```

---

## 6. Summary

| Component | Thay đổi | Lý do |
|-----------|----------|-------|
| `ESP32C6_Zigbee_Sensor.ino` | Xóa `setReporting()`, `setHumidityReporting()` | Không cấu hình ZCL auto-push |
| `ESP32C6_Zigbee_Sensor.ino` | Xóa `report()` trong `loop()` | Thiết bị im lặng sau khi join |
| `ESP32C6_Zigbee_Sensor.ino` | Giữ `setTemperature()`, `setHumidity()` | Attr values luôn fresh cho on-demand read |
| `zigbee_control_widget_v2.js` | Thêm `var g_pollTimers = {}` | Lưu interval ID ngoài state |
| `zigbee_control_widget_v2.js` | Viết lại `toggleNodeConnect()` | Connect → start poll; Disconnect → stop |
| `zigbee_control_widget_v2.js` | Thêm cleanup trong `onDestroy` | Dọn dẹp interval khi widget bị hủy |

---

## 7. Final Correct Flow (After Fix)

```
Device powers on
    │
    ▼
Zigbee.begin() → join network → SILENT (no reporting configured)
    │
    ▼  [0x80/0x03 Node Join → JS addNode()]
Node appears in list as "0x{short} · Unknown"
    │
    ▼  [0x80/0x05 Node Announce → JS setTimeout(2s)]
sendZclReadAttr(short, ep, '0000', '0005')  ← read Basic/ModelIdentifier
    │
    ▼  [0x82/0x00 Read Attr Response]
handleZclReadAttrRsp → handleAttrReport → node.name = "DATN Node", verified = true
Node list shows: "DATN Node · 0x{short} · End Device EP:0B"  [Connect] button
    │
    ▼  (user clicks [Connect])
toggleNodeConnect(short)
  → immediate: sendZclReadAttr(0402) + sendZclReadAttr(0405)
  → g_pollTimers[short] = setInterval(poll, 5000)
    │
    ▼  [0x82/0x00 Read Attr Response — Temp]
handleZclReadAttrRsp → handleAttrReport → node.connected=true ✓ → update UI
    │
    ▼  every 5s: repeat poll
    │
    ▼  (user clicks [Disconnect])
toggleNodeConnect(short)
  → clearInterval(g_pollTimers[short])
  → node.connected = false
  → UI stops updating
```
