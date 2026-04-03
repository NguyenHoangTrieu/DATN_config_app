# UI Design — BLE Native Mesh Application Test Widget

## Mục đích

Widget ThingsBoard cho bài test BLE Native Mesh: provision và điều khiển **tối đa 5 thiết bị** cùng lúc (2 đèn LED + 3 cảm biến nhiệt độ/độ ẩm) thông qua ESP BLE Mesh provisioner.

---

## Kiến trúc giao thức

```
ThingsBoard Widget
  → RPC sendCommand (hex-encoded)
  → MCU WAN (ESP32-S3)
  → UART → MCU LAN (ESP32-S3)
  → BLE Native Mesh Provisioner (ESP BLE Mesh)
  → Mesh Nodes (LED / Sensor)
```

**Prefix**: `CFML:CFBN:<slot>:<verb>:<params>`
**Response prefix**: `CFBN:<slot>:<OK|FAIL>:<payload>`

---

## Thiết bị test

| # | Loại | Tên Mesh Node | Model | Đặc điểm nhận dạng |
|---|------|--------------|-------|---------------------|
| 1 | LED RGB | `DA2_MESH_LED_1` | Generic OnOff Server + Light Lightness Server | CID=0xDA21 |
| 2 | LED RGB | `DA2_MESH_LED_2` | Generic OnOff Server + Light Lightness Server | CID=0xDA21 |
| 3 | Cảm biến | `DA2_MESH_SENSOR_1` | Sensor Server (Temperature + Humidity) | CID=0xDA22 |
| 4 | Cảm biến | `DA2_MESH_SENSOR_2` | Sensor Server (Temperature + Humidity) | CID=0xDA22 |
| 5 | Cảm biến | `DA2_MESH_SENSOR_3` | Sensor Server (Temperature + Humidity) | CID=0xDA22 |

### Nhận dạng loại thiết bị

- **LED**: Company ID (CID) = `0xDA21`, hoặc tên chứa `MESH_LED`
- **Cảm biến**: Company ID (CID) = `0xDA22`, hoặc tên chứa `MESH_SENSOR`
- UUID unprovisioned device advertisement chứa CID ở byte 0-1

---

## Bố cục giao diện (Layout)

```
┌──────────────────────────────────────────────────────────────────┐
│  BLE Mesh Application Test                    [🔍 Scan Unprov]  │
│  Stack: [0 ▼]      Provisioned: 3/5     Status: ● Ready        │
├─────────────────────┬────────────────────────────────────────────┤
│  UNPROVISIONED      │  PROVISIONED NODES                        │
│  DEVICES            │  ──────────────────                       │
│  ─────────────      │  ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  ┌───────────────┐  │  │ 💡LED_1  │ │ 💡LED_2  │ │ 🌡SEN_1  │  │
│  │ UUID: aabb... │  │  │ 0x0002   │ │ 0x0003   │ │ 0x0004   │  │
│  │ RSSI: -48     │  │  │ ●Online  │ │ ●Online  │ │ ●Online  │  │
│  │ Type: 💡 LED  │  │  └──────────┘ └──────────┘ └──────────┘  │
│  │ [Provision]   │  │  ┌──────────┐ ┌──────────┐               │
│  ├───────────────┤  │  │ 🌡SEN_2  │ │ 🌡SEN_3  │               │
│  │ UUID: ccdd... │  │  │ 0x0005   │ │ ●Saved   │               │
│  │ RSSI: -55     │  │  │ ●Online  │ │  (gray)  │               │
│  │ Type: 🌡 Sens │  │  └──────────┘ └──────────┘               │
│  │ [Provision]   │  │                                          │
│  └───────────────┘  │  ════════════════════════════════════     │
│                     │  NODE DETAIL PANEL                        │
│                     │  (hiện khi chọn 1 node)                  │
│                     ├──────────────────────────────────────────┤
│                     │  [LED Panel] hoặc [Sensor Panel]         │
├─────────────────────┴────────────────────────────────────────────┤
│  Console Log                                          [Clear]   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Chi tiết từng thành phần

### 1. Header Bar

| Thành phần | Mô tả |
|-----------|-------|
| Tiêu đề | "BLE Mesh Application Test" |
| Stack selector | Dropdown `[0]` hoặc `[1]` |
| Provisioned counter | `Provisioned: N/5` |
| Status pill | `● Ready` (xanh), `● Scanning` (vàng), `● Provisioning...` (cam) |
| Nút Scan | `[🔍 Scan Unprovisioned]` — scan 5000ms |

### 2. Left Panel — Unprovisioned Devices

- Hiển thị kết quả scan unprovisioned
- Mỗi mục:
  - **UUID** (32 hex, truncated)
  - **RSSI** (-xx dBm)
  - **Type icon**: Tự nhận dạng qua CID trong UUID → 💡 LED hoặc 🌡 Sensor
  - **Nút [Provision]** → bắt đầu provision thiết bị
- Nếu đã provision → hiển thị `[Provisioned ✓]` (disabled)

### 3. Right Panel — Provisioned Nodes

#### 3a. Node Card Grid

Grid 3 cột:
- **Icon loại** (💡 / 🌡)
- **Tên node** (từ CID mapping)
- **Unicast Address** (0x0002, 0x0003, ...)
- **Trạng thái**: `● Online` / `● Saved` (xám — lưu nhưng chưa kết nối)
- Click → mở Detail Panel
- Long press / nút `✕` → **Node Reset** (xóa khỏi mesh)

#### 3b. Node Detail Panel

**Nếu node là LED (💡):**

```
┌───────────────────────────────────────────────┐
│  💡 DA2_MESH_LED_1         [Reset Node ✕]     │
│  Addr: 0x0002                                 │
│  Trạng thái: 🟢 BẬT / ⚫ TẮT                │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  [🔴 Đỏ] [🟢 Xanh lá] [🔵 Xanh dương] │  │
│  │  [🟡 Vàng]  [⚪ Trắng]                  │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  [ ◉ BẬT ]  [ ○ TẮT ]                       │
│                                               │
│  [🔄 Get Status]                              │
└───────────────────────────────────────────────┘
```

- **5 nút màu cố định**: Đỏ, Xanh lá, Xanh dương, Vàng, Trắng
- Nút màu gửi: `CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"CTL","params":{"lightness":65535,"temperature":...}}`
  - Đỏ: lightness=65535, sử dụng ONOFF + set predefined
  - Thực tế: Vì Mesh OnOff model chỉ có ON/OFF, nên gửi custom vendor data cho màu
  - **Phương án**: Dùng Generic OnOff SET cho bật/tắt + vendor model data cho màu
- **Nút BẬT/TẮT**: `CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":1|0}}`
- **Get Status**: `CFML:CFBN:0:GET_STATUS:{"addr":"0x0002","model":"ONOFF"}`

**Nếu node là Cảm biến (🌡):**

```
┌───────────────────────────────────────────────┐
│  🌡 DA2_MESH_SENSOR_1      [Reset Node ✕]     │
│  Addr: 0x0004                                 │
│                                               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │  🌡 Nhiệt độ │  │ 💧 Độ ẩm    │          │
│  │   25.6 °C    │  │   65.3 %    │          │
│  │  ↑ 25.8      │  │  ↑ 67.0     │          │
│  │  ↓ 24.2      │  │  ↓ 62.1     │          │
│  └──────────────┘  └──────────────┘          │
│                                               │
│  Cập nhật lần cuối: 10:35:22                 │
│  [🔄 Get Sensor Data]                        │
└───────────────────────────────────────────────┘
```

- Sensor data nhận qua Mesh Sensor Server model publish
- **Get Sensor Data**: `CFML:CFBN:0:GET_STATUS:{"addr":"0x0004","model":"SENSOR"}`
- Response: `CFBN:0:OK:SENSOR_STATUS:0x0004:<temp_hex>:<hum_hex>`

### 4. Console Log

- Timestamp + message, cuộn tự động
- Hiển thị tất cả commands và responses

---

## Luồng hoạt động (Workflow)

### Scan & Provision

```
1. User nhấn [Scan Unprovisioned]
   → CFML:CFBN:0:SCAN:5000
   → CFBN:0:OK:SCAN_RESULT:<uuid_32hex> <RSSI>
   → Hiển thị trong danh sách, tự nhận dạng loại

2. User nhấn [Provision] trên 1 thiết bị
   → CFML:CFBN:0:PROVISION:<uuid_32hex>
   → CFBN:0:OK:PROVISIONED:<unicast_addr>
   → Thêm node vào grid
   → Tự động App Key Add: CFML:CFBN:0:APP_KEY_ADD:{"addr":"<addr>","net_idx":0,"app_idx":0}
   → CFBN:0:OK:APP_KEY_ADDED:<addr>

3. Provision tiếp thiết bị khác (tối đa 5)
```

### Điều khiển LED

```
1. User chọn DA2_MESH_LED_1 → mở LED Panel
2. User nhấn [🔴 Đỏ]
   → CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":1}}
   (Bật trước, rồi gửi thêm vendor data cho màu)
3. User nhấn [TẮT]
   → CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":0}}
```

### Xem cảm biến

```
1. User chọn DA2_MESH_SENSOR_1 → mở Sensor Panel
2. Node tự publish sensor data định kỳ (5s)
   → CFBN:0:OK:SENSOR_STATUS:0x0004:<data>
   → Parse temperature + humidity
3. Hoặc user nhấn [Get Sensor Data] để poll thủ công
```

---

## Lưu trữ thiết bị (localStorage)

```javascript
// Key: "ble_mesh_saved_nodes"
[
  {
    "addr": "0x0002",
    "uuid": "11223344556677889900AABBCCDDEEFF",
    "name": "DA2_MESH_LED_1",
    "type": "led",
    "lastSeen": "2026-04-03T10:30:00Z"
  },
  ...
]
```

- Khi mở widget → load danh sách → hiển thị trạng thái `● Saved` (xám)
- User có thể chọn node → gửi GET_STATUS để kiểm tra online
- **KHÔNG** tự động kết nối/publish lại

---

## Quy tắc gửi command

1. **Không gửi đè**: Queue FIFO, chờ response/timeout (5s) trước khi gửi tiếp
2. **Provision**: Chờ PROVISIONED hoặc PROVISION_TIMEOUT mới cho phép provision tiếp
3. **Control**: Mỗi lệnh CONTROL chờ STATUS response (3s timeout)
4. **Node Reset**: Confirm dialog trước khi reset

---

## Màu sắc & Icon

| Phần tử | Màu | Hex |
|---------|-----|-----|
| Header | Deep purple | #4a148c |
| LED card border | Amber | #ff8f00 |
| Sensor card border | Teal | #00897b |
| Online badge | Green | #4caf50 |
| Saved/Offline badge | Grey | #9e9e9e |
| Provision button | Purple | #7b1fa2 |
| Console bg | Dark | #263238 |

---

## Responsive

- **≥ 1200px**: 2 cột (left: 30%, right: 70%)
- **800–1199px**: 2 cột (left: 35%, right: 65%)
- **< 800px**: 1 cột xếp dọc
