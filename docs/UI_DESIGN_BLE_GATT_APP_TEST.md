# UI Design — BLE GATT Application Test Widget

---

## ⭐ Kiến trúc 2-Widget (Cập nhật mới)

Hệ thống được tách thành **2 widget riêng biệt** cho 2 mục đích khác nhau:

| Widget | File | Loại ThingsBoard | Chức năng |
|--------|------|-----------------|-----------|
| **BLE Sensor Monitor** | `ble_monitor_widget.*` | **Latest Values** | Giám sát sensor (nhiệt độ / độ ẩm) qua WebSocket telemetry push — không polling, không RPC |
| **BLE GATT Control** | `ble_control_widget.*` | **Control widget** | Điều khiển LED (màu sắc / ON-OFF) + quản lý kết nối BLE (SCAN, CONNECT, DISC, NOTIFY) |

### Luồng dữ liệu

```
Sensor NOTIFY (mỗi ~3s)
  → ESP32-LAN → UART → ESP32-WAN
  → MQTT publish {"data": "<hex>"}
  → ThingsBoard telemetry key "data"
  → WebSocket push → ble_monitor_widget.onDataUpdated()
  → Decode hex → hiển thị nhiệt độ / độ ẩm

LED / BLE control
  → ble_control_widget (RPC sendCommand)
  → CFML:CFBG:<slot>:<verb>:<params>
  → Gateway → BLE GATT peripheral
```

### Cấu hình ThingsBoard Dashboard

**BLE Sensor Monitor widget:**
- Type: `Latest Values`
- Datasource: Entity → Gateway device, key = `data` (Latest Telemetry)
- Không cần target device / controlApi

**BLE GATT Control widget:**
- Type: `Control widget`
- Target device: Gateway device (để sử dụng `controlApi.sendTwoWayCommand`)
- Datasource: Entity → Gateway device, key = `data` (để nhận async events qua `onDataUpdated`)

> **Lưu ý**: Widget `ble_gatt_multi_widget.*` vẫn được giữ lại để tham khảo (all-in-one widget cũ).

---

## Mục đích

Widget ThingsBoard cho bài test BLE Native GATT: kết nối **tối đa 5 thiết bị** cùng lúc (2 đèn LED + 3 cảm biến nhiệt độ/độ ẩm), cho phép người dùng scan, kết nối, điều khiển đèn và xem dữ liệu cảm biến.

---

## Kiến trúc giao thức

```
ThingsBoard Widget
  → RPC sendCommand (hex-encoded)
  → MCU WAN (ESP32-S3)
  → UART → MCU LAN (ESP32-S3)
  → BLE GATT Central (native Bluedroid)
  → BLE GATT Peripheral devices
```

**Prefix**: `CFML:CFBG:<slot>:<verb>:<params>`
**Response prefix**: `CFBL:<slot>:<OK|FAIL>:<payload>`

---

## Thiết bị test

| # | Loại | Tên BLE | Service UUID | Đặc điểm nhận dạng |
|---|------|---------|-------------|---------------------|
| 1 | LED RGB | `DA2_LED_1` | 0xFFF0 | FFF2: WRITE (1B ON/OFF, 3B RGB) |
| 2 | LED RGB | `DA2_LED_2` | 0xFFF0 | FFF2: WRITE (1B ON/OFF, 3B RGB) |
| 3 | Cảm biến | `DA2_SENSOR_1` | 0xAA10 | AA11: NOTIFY (temp/hum, 4B) |
| 4 | Cảm biến | `DA2_SENSOR_2` | 0xAA10 | AA11: NOTIFY (temp/hum, 4B) |
| 5 | Cảm biến | `DA2_SENSOR_3` | 0xAA10 | AA11: NOTIFY (temp/hum, 4B) |

### Nhận dạng loại thiết bị

- **LED**: Service UUID chứa `0xFFF0`, tên bắt đầu bằng `DA2_LED_`
- **Cảm biến**: Service UUID chứa `0xAA10`, tên bắt đầu bằng `DA2_SENSOR_`

---

## Bố cục giao diện (Layout)

```
┌──────────────────────────────────────────────────────────────────┐
│  BLE GATT Application Test                            [Scan ▶]  │
│  Stack: [0 ▼]         Status: ● Idle / Scanning / Connected    │
├─────────────────────┬────────────────────────────────────────────┤
│  AVAILABLE DEVICES  │  CONNECTED DEVICES                        │
│  ─────────────────  │  ─────────────────                        │
│  📡 Scan Results    │  ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│                     │  │ 💡LED_1  │ │ 💡LED_2  │ │ 🌡SEN_1  │  │
│  ┌───────────────┐  │  │ ●Online  │ │ ●Online  │ │ ●Online  │  │
│  │ DA2_LED_1     │  │  └──────────┘ └──────────┘ └──────────┘  │
│  │ -45 dBm  💡   │  │  ┌──────────┐ ┌──────────┐               │
│  │ [Connect]     │  │  │ 🌡SEN_2  │ │ 🌡SEN_3  │               │
│  ├───────────────┤  │  │ ●Online  │ │ ●Offline │               │
│  │ DA2_SENSOR_1  │  │  └──────────┘ └──────────┘               │
│  │ -52 dBm  🌡   │  │                                          │
│  │ [Connect]     │  │  ════════════════════════════════════     │
│  ├───────────────┤  │  DEVICE DETAIL PANEL                     │
│  │ DA2_LED_2     │  │  (hiện khi chọn 1 thiết bị connected)   │
│  │ -60 dBm  💡   │  ├──────────────────────────────────────────┤
│  │ [Connect]     │  │  [LED Panel] hoặc [Sensor Panel]        │
│  └───────────────┘  │                                          │
├─────────────────────┴────────────────────────────────────────────┤
│  Console Log                                          [Clear]   │
│  [10:30:01] Scan started...                                     │
│  [10:30:04] Found DA2_LED_1 (-45 dBm)                          │
│  [10:30:04] Found DA2_SENSOR_1 (-52 dBm)                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Chi tiết từng thành phần

### 1. Header Bar

| Thành phần | Mô tả |
|-----------|-------|
| Tiêu đề | "BLE GATT Application Test" |
| Stack selector | Dropdown `[0]` hoặc `[1]` |
| Status pill | `● Idle` (xám), `● Scanning` (vàng nhấp nháy), `● Connected (N)` (xanh lá) |
| Nút Scan | `[🔍 Scan]` — trigger scan 5000ms, disabled khi đang scan |

### 2. Left Panel — Available Devices (Scan Results)

- Danh sách cuộn dọc, hiển thị kết quả scan
- Mỗi mục:
  - **Icon**: 💡 (LED) hoặc 🌡 (Cảm biến) — tự nhận dạng qua tên/UUID
  - **Tên BLE** (bold)
  - **MAC address** (nhỏ, xám)
  - **RSSI** bar (thanh cường độ tín hiệu)
  - **Nút [Connect]** — kết nối thiết bị
- Nếu thiết bị đã kết nối → hiển thị `[Connected ✓]` (disabled, xanh lá)
- Khi kết nối 1 thiết bị, các thiết bị khác trong danh sách vẫn có thể kết nối (tối đa 5)

### 3. Right Panel — Connected Devices

#### 3a. Device Card Grid (trên cùng)

Grid 3 cột, mỗi card nhỏ:
- **Icon loại** (💡 / 🌡)
- **Tên thiết bị** (truncated)
- **Trạng thái**: `● Online` (xanh lá) / `● Offline` (đỏ)
- **Click** → mở Detail Panel bên dưới
- **Selected** → viền highlight xanh

#### 3b. Device Detail Panel (bên dưới grid)

**Nếu thiết bị là LED (💡):**

```
┌───────────────────────────────────────────┐
│  💡 DA2_LED_1              [Disconnect ✕] │
│  MAC: AA:BB:CC:DD:EE:FF                  │
│  Trạng thái: 🟢 BẬT / ⚫ TẮT            │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │  [🔴 Đỏ] [🟢 Xanh lá] [🔵 Xanh]  │  │
│  │  [🟡 Vàng]  [⚪ Trắng]             │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  [ ◉ BẬT ]  [ ○ TẮT ]                   │
└───────────────────────────────────────────┘
```

- **5 nút màu**: Đỏ (FF0000), Xanh lá (00FF00), Xanh dương (0000FF), Vàng (FFFF00), Trắng (FFFFFF)
- Nút màu → Gửi 3 bytes RGB qua WRITE FFF2
- **Nút BẬT/TẮT**: Toggle LED ON (01) / OFF (00) qua WRITE FFF2

**Nếu thiết bị là Cảm biến (🌡):**

```
┌───────────────────────────────────────────┐
│  🌡 DA2_SENSOR_1           [Disconnect ✕] │
│  MAC: 11:22:33:44:55:66                  │
│                                           │
│  ┌──────────────┐  ┌──────────────┐      │
│  │  🌡 Nhiệt độ │  │ 💧 Độ ẩm    │      │
│  │   25.6 °C    │  │   65.3 %    │      │
│  │  ↑ 25.8      │  │  ↑ 67.0     │      │
│  │  ↓ 24.2      │  │  ↓ 62.1     │      │
│  └──────────────┘  └──────────────┘      │
│                                           │
│  Cập nhật lần cuối: 10:35:22             │
│  Interval: 3s                            │
└───────────────────────────────────────────┘
```

- **Nhiệt độ**: Giá trị hiện tại, cao nhất, thấp nhất
- **Độ ẩm**: Giá trị hiện tại, cao nhất, thấp nhất
- Dữ liệu tự động cập nhật qua NOTIFY từ characteristic AA11

### 4. Console Log (bottom)

- Hiển thị timestamp + message
- Tự cuộn xuống
- Nút `[Clear]` xóa log
- Hiển thị mọi command gửi đi và response nhận được

---

## Luồng hoạt động (Workflow)

### Scan & Connect

```
1. User nhấn [Scan]
   → Widget gửi: CFML:CFBG:0:SCAN:5000
   → Nhận: CFBL:0:OK:SCAN_RESULT:<idx> <MAC> <RSSI> <name>
   → Cập nhật danh sách Available Devices

2. User nhấn [Connect] trên DA2_LED_1
   → Widget gửi: CFML:CFBG:0:CONNECT:<MAC>
   → Nhận: CFBL:0:OK:CONNECTED:<conn_idx>
   → Thêm vào Connected Devices grid
   → Tự động discover services: CFML:CFBG:0:DISC:<conn_idx>
   → Nhận: CFBL:0:OK:DISC:<handle> <uuid> <props>
   → Tự nhận dạng loại (LED hay Sensor) qua UUID
   → Nếu Sensor: tự enable NOTIFY trên AA11 CCCD

3. Có thể kết nối tiếp thiết bị khác (tối đa 5)
```

### Điều khiển LED

```
1. User chọn DA2_LED_1 trong grid → mở LED Panel
2. User nhấn nút [🔴 Đỏ]
   → Widget gửi: CFML:CFBG:0:WRITE:<conn_idx>:<FFF2_handle>:FF0000
   → Nhận echo: CFBL:0:OK:WRITE:<handle>
3. User nhấn [TẮT]
   → Widget gửi: CFML:CFBG:0:WRITE:<conn_idx>:<FFF2_handle>:00
```

### Xem cảm biến

```
1. User chọn DA2_SENSOR_1 trong grid → mở Sensor Panel
2. Widget đã tự enable NOTIFY khi connect
   → Nhận liên tục: CFBL:0:NOTIF:<handle>:<data_hex>
   → Parse 4 bytes: [temp_int16_LE, hum_int16_LE] (đơn vị: x100)
   → Hiển thị: temp/100 °C, hum/100 %
```

---

## Lưu trữ thiết bị (localStorage)

```javascript
// Key: "ble_gatt_saved_devices"
// Value: JSON array
[
  {
    "mac": "AA:BB:CC:DD:EE:FF",
    "name": "DA2_LED_1",
    "type": "led",        // "led" | "sensor"
    "serviceUuid": "FFF0",
    "lastSeen": "2026-04-03T10:30:00Z"
  },
  ...
]
```

- Khi mở widget → load danh sách saved → hiển thị trong Connected Devices grid với trạng thái `● Offline`
- User phải nhấn vào card hoặc nút Reconnect để kết nối lại
- **KHÔNG** tự động kết nối lại

---

## Quy tắc gửi command

1. **Không gửi đè**: Mỗi command phải chờ response hoặc timeout (5s) trước khi gửi command tiếp theo
2. **Queue**: Implement command queue FIFO, xử lý từng command một
3. **Retry**: Nếu timeout → hiển thị lỗi, không tự retry
4. **Disconnect**: Khi disconnect 1 thiết bị, chờ response xong mới cho thao tác tiếp

---

## Giao thức chi tiết cho cảm biến

### Service 0xAA10 "DA2 Sensor Service"

| Characteristic | UUID | Properties | Format |
|---------------|------|-----------|--------|
| Sensor Data | 0xAA11 | READ, NOTIFY | 4 bytes: temp_i16LE + hum_i16LE |
| Sensor Config | 0xAA12 | READ, WRITE | 1 byte: notify interval (seconds) |

### Data format (AA11 — 4 bytes):

```
Byte 0-1: Temperature (int16 LE, unit: 0.01°C)
          Ví dụ: 0x0A 0x0A = 2570 → 25.70°C
Byte 2-3: Humidity (int16 LE, unit: 0.01%)
          Ví dụ: 0x82 0x19 = 6530 → 65.30%
```

### Echo protocol (qua AA11 NOTIFY):

- Mỗi 3 giây MCU peripheral tự gửi NOTIFY với dữ liệu cảm biến
- Widget parse và cập nhật UI realtime

---

## Màu sắc & Icon

| Phần tử | Màu | Hex |
|---------|-----|-----|
| Header | Dark blue | #1a237e |
| LED card border | Amber | #ff8f00 |
| Sensor card border | Teal | #00897b |
| Online badge | Green | #4caf50 |
| Offline badge | Red | #f44336 |
| Scan button | Blue | #1976d2 |
| Console bg | Dark | #263238 |

---

## Responsive

- **≥ 1200px**: 2 cột (left: 30%, right: 70%)
- **800–1199px**: 2 cột (left: 35%, right: 65%)  
- **< 800px**: 1 cột xếp dọc (scan list → connected grid → detail panel)
