# UI Design — Zigbee Application Test Widget

## Mục đích

Widget ThingsBoard cho bài test Zigbee: kết nối **tối đa 3 thiết bị** (1 đèn LED + 2 cảm biến nhiệt độ/độ ẩm) thông qua Zigbee coordinator (E180-ZG120B).

---

## Kiến trúc giao thức

```
ThingsBoard Widget
  → RPC sendCommand (hex-encoded)
  → MCU WAN (ESP32-S3)
  → UART → MCU LAN (ESP32-S3)
  → Zigbee Handler
  → UART → E180-ZG120B Coordinator
  → Zigbee 3.0 network → End Devices / Routers
```

**Prefix**: `CFML:CFZB:<slot>:AT+<command>`
**Response prefix**: `CFZB:<slot>:<OK|FAIL|EVT>:<payload>`

---

## Thiết bị test

| # | Loại | Zigbee Model | Endpoint | Clusters | Đặc điểm nhận dạng |
|---|------|-------------|----------|----------|---------------------|
| 1 | LED RGB | ZB-C6-Bulb | EP 10 | 0x0006 (OnOff), 0x0008 (Level), 0x0300 (Color) | Model ID = "ZB-C6-Bulb" |
| 2 | Cảm biến | ZB-SENSOR-1 | EP 1 | 0x0402 (Temperature), 0x0405 (Humidity) | Model ID = "ZB-TH-Sensor" |
| 3 | Cảm biến | ZB-SENSOR-2 | EP 1 | 0x0402 (Temperature), 0x0405 (Humidity) | Model ID = "ZB-TH-Sensor" |

### Nhận dạng loại thiết bị

- **LED**: Model ID chứa "Bulb", hoặc có cluster 0x0006 + 0x0300
- **Cảm biến**: Model ID chứa "Sensor", hoặc có cluster 0x0402

---

## Bố cục giao diện (Layout)

```
┌──────────────────────────────────────────────────────────────────┐
│  Zigbee Application Test                                        │
│  Stack: [0 ▼]    Network: ● Active (CH:11 PAN:0x1234)          │
│  [▶ Start NW]  [⏹ Stop NW]  [📡 Permit Join 60s]  [🔍 Find]  │
├─────────────────────┬────────────────────────────────────────────┤
│  NETWORK NODES      │  NODE DETAIL                               │
│  ──────────────     │  ──────────                                │
│                     │                                            │
│  ┌───────────────┐  │  ┌──────────────────────────────────────┐  │
│  │ 🌐 Coordinator│  │  │ (Chọn 1 node từ danh sách bên trái)│  │
│  │ 0x0000        │  │  │                                      │  │
│  ├───────────────┤  │  │ Hiển thị LED Panel hoặc Sensor Panel│  │
│  │ 💡 ZB-Bulb    │  │  │ tùy loại thiết bị                   │  │
│  │ 0x1234  EP:10 │  │  │                                      │  │
│  │ ● Online      │  │  └──────────────────────────────────────┘  │
│  ├───────────────┤  │                                            │
│  │ 🌡 ZB-Sensor-1│  │                                            │
│  │ 0x5678  EP:1  │  │                                            │
│  │ ● Online      │  │                                            │
│  ├───────────────┤  │                                            │
│  │ 🌡 ZB-Sensor-2│  │                                            │
│  │ 0x9ABC  EP:1  │  │                                            │
│  │ ● Online      │  │                                            │
│  └───────────────┘  │                                            │
├─────────────────────┴────────────────────────────────────────────┤
│  Console Log                                          [Clear]   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Chi tiết từng thành phần

### 1. Header Bar

| Thành phần | Mô tả |
|-----------|-------|
| Tiêu đề | "Zigbee Application Test" |
| Stack selector | `[0]` hoặc `[1]` |
| Network status | `● Active` (xanh) + CH + PAN ID, hoặc `● Inactive` (đỏ) |
| Nút Start NW | `[▶ Start NW]` → `AT+CREATENW` |
| Nút Stop NW | `[⏹ Stop NW]` → `AT+QUITNW` |
| Nút Permit Join | `[📡 Permit Join 60s]` → `AT+OPENWNET=60` |
| Nút Find | `[🔍 Find]` → `AT+FIND` |

### 2. Left Panel — Network Nodes

- Tự động cập nhật khi thiết bị JOIN
- Async events: `JOIN:<short>,<ieee>,<type>`, `NODE:<short>,<ieee>`, `FIND:<short>,...`
- Mỗi node hiển thị:
  - **Icon**: 🌐 (Coordinator), 🔁 (Router / LED), 🌡 (Sensor)
  - **Model ID** hoặc tên
  - **Short Address** (0xHHHH)
  - **Endpoint** (EP:xx)
  - **Trạng thái**: `● Online` / `● Offline`
  - Click → mở Detail Panel
  - Nút `[✕ Delete]` → `AT+ENTDEL=<short>` (có confirm dialog)

### 3. Right Panel — Node Detail

**Nếu node là LED (💡 ZB-C6-Bulb):**

```
┌───────────────────────────────────────────────┐
│  💡 ZB-C6-Bulb              [Delete Node ✕]   │
│  Short: 0x1234    IEEE: 00:11:22:33:44:55     │
│  EP: 10           Clusters: 0006, 0008, 0300  │
│  Trạng thái: 🟢 BẬT / ⚫ TẮT                │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  [🔴 Đỏ] [🟢 Xanh lá] [🔵 Xanh dương] │  │
│  │  [🟡 Vàng]  [⚪ Trắng]                  │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  [ ◉ BẬT ]  [ ○ TẮT ]                       │
│                                               │
│  [🔄 Read OnOff Status]                      │
└───────────────────────────────────────────────┘
```

- **5 nút màu cố định** → Gửi ZCL Color XY command:
  - Đỏ: `AT+ZCL=<short>,<ep>,0300,07,9A99,3333,0001` (XY for red)
  - Xanh lá: `AT+ZCL=<short>,<ep>,0300,07,4CCD,B333,0001` (XY for green)
  - Xanh dương: `AT+ZCL=<short>,<ep>,0300,07,2666,1999,0001` (XY for blue)
  - Vàng: `AT+ZCL=<short>,<ep>,0300,07,A666,B333,0001` (XY for yellow)  
  - Trắng: `AT+ZCL=<short>,<ep>,0300,07,5555,5555,0001` (XY for white D65)
- **Nút BẬT**: `AT+ZCL=<short>,<ep>,0006,01` (ZCL ON command)
- **Nút TẮT**: `AT+ZCL=<short>,<ep>,0006,00` (ZCL OFF command)
- **Read Status**: `AT+ATTRREAD=<short>,<ep>,0006,0000`

**Nếu node là Cảm biến (🌡):**

```
┌───────────────────────────────────────────────┐
│  🌡 ZB-TH-Sensor-1          [Delete Node ✕]   │
│  Short: 0x5678    IEEE: AA:BB:CC:DD:EE:FF     │
│  EP: 1            Clusters: 0402, 0405        │
│                                               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │  🌡 Nhiệt độ │  │ 💧 Độ ẩm    │          │
│  │   25.6 °C    │  │   65.3 %    │          │
│  │  ↑ 25.8      │  │  ↑ 67.0     │          │
│  │  ↓ 24.2      │  │  ↓ 62.1     │          │
│  └──────────────┘  └──────────────┘          │
│                                               │
│  Cập nhật lần cuối: 10:35:22                 │
│  [🔄 Read Temp] [🔄 Read Humidity]           │
│  [⏱ Config Report 10s]                       │
└───────────────────────────────────────────────┘
```

- **Read Temp**: `AT+ATTRREAD=<short>,<ep>,0402,0000`
  - Response: `RPT:<short>-<ep> TEMP=<value>` → int16 / 100 → °C
- **Read Humidity**: `AT+ATTRREAD=<short>,<ep>,0405,0000`
  - Response: `RPT:<short>-<ep> HUM=<value>` → uint16 / 100 → %
- **Config Report**: `AT+CONFREPORT=<short>,<ep>,0402,0000,29,000A,003C,0064`
  - Min 10s, Max 60s, change 1°C
- Async reports tự động cập nhật UI: `RPT:<short>-<ep>,0402,0000,29,<value>`

### 4. Console Log

- Timestamp + message, auto-scroll
- Hiển thị tất cả AT commands và responses

---

## Luồng hoạt động

### Setup Network & Join

```
1. User nhấn [Start NW]
   → CFML:CFZB:0:AT+CREATENW
   → Nhận: +CREATENW:0, NET:JOIN, NETOPEN:180-Sec

2. User nhấn [Permit Join 60s]
   → CFML:CFZB:0:AT+OPENWNET=60
   → Nhận: +OPENWNET:0

3. Bật thiết bị Zigbee (end device / router)
   → Async: JOIN:<short>,<ieee>,<type>
   → Node tự động thêm vào danh sách

4. User nhấn [Find] để tìm thêm
   → CFML:CFZB:0:AT+FIND
   → FIND:<short>,<ieee>,...

5. Sau khi tìm thấy node, widget tự gọi:
   → AT+SIMPLEDESC=<short>,01  (lấy endpoints/clusters)
   → Tự nhận dạng loại thiết bị
```

### Điều khiển LED

```
1. User chọn ZB-C6-Bulb → mở LED Panel
2. User nhấn [🔴 Đỏ]
   → CFML:CFZB:0:AT+ZCL=0x1234,10,0006,01  (bật)
   → Chờ response
   → CFML:CFZB:0:AT+ZCL=0x1234,10,0300,07,9A99,3333,0001 (màu đỏ)
3. User nhấn [TẮT]
   → CFML:CFZB:0:AT+ZCL=0x1234,10,0006,00
```

### Xem cảm biến

```
1. User chọn ZB-TH-Sensor → mở Sensor Panel
2. Widget tự config report:
   → AT+CONFREPORT=0x5678,01,0402,0000,29,0005,003C,0064
   → AT+CONFREPORT=0x5678,01,0405,0000,21,0005,003C,0064
3. Nhận async: RPT:<short>-<ep>,0402,0000,29,<temp_hex>
   → Parse int16 / 100 = °C
4. Hoặc user nhấn [Read Temp]
   → AT+ATTRREAD=0x5678,01,0402,0000
```

---

## Lưu trữ (localStorage)

```javascript
// Key: "zigbee_saved_nodes"
[
  {
    "short": "0x1234",
    "ieee": "00:11:22:33:44:55:66:77",
    "name": "ZB-C6-Bulb",
    "type": "led",
    "endpoint": 10,
    "clusters": ["0006", "0008", "0300"],
    "lastSeen": "2026-04-03T10:30:00Z"
  },
  ...
]
```

- Mở widget → load saved → hiển thị `● Saved` (xám)
- **KHÔNG** tự reconnect, user nhấn node → widget gọi `AT+NWINFO` để check network

---

## Quy tắc gửi command

1. **Không gửi đè**: Queue FIFO, timeout 5s per command
2. **Network commands** (CREATENW, QUITNW): timeout 10s
3. **ZCL commands**: chờ RSP hoặc 3s timeout
4. **AT+FIND**: chờ tất cả FIND responses (timeout 10s)
5. **Delete node**: confirm dialog, chờ LEAVE response

---

## Màu sắc & Icon

| Phần tử | Màu | Hex |
|---------|-----|-----|
| Header | Green darken-4 | #1b5e20 |
| LED node border | Amber | #ff8f00 |
| Sensor node border | Teal | #00897b |
| Coordinator node | Blue | #1565c0 |
| Online badge | Green | #4caf50 |
| Offline badge | Red | #f44336 |
| Network active | Green | #66bb6a |
| Network inactive | Red | #ef5350 |
| Console bg | Dark | #263238 |

---

## Responsive

- **≥ 1200px**: 2 cột (left: 30%, right: 70%)
- **800–1199px**: 2 cột (left: 35%, right: 65%)
- **< 800px**: 1 cột xếp dọc
