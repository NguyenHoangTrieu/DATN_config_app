# DA2 Total Sensor Widget — Design Document

> **Status:** Finalized — ready for implementation

---

## 1. Overview

Hai widget tổng hợp thay thế/bổ sung cho 3 widget đơn lẻ hiện có (BLE, Zigbee, LoRa), tập trung vào **đọc dữ liệu cảm biến** theo chu kỳ điều chỉnh được và **đo round-trip latency**.

| Widget | TB Type | Mục đích |
|---|---|---|
| **Total Monitor** | Latest Values | Hiển thị dữ liệu cảm biến realtime từ cả 3 loại node |
| **Total Control** | Control (RPC) | Cấu hình kết nối, điều chỉnh polling interval, trigger scan/join |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│               Total Control Widget                  │
│  ┌───────────┐  ┌───────────┐  ┌───────────────┐   │
│  │ BLE Panel │  │  ZB Panel │  │  LoRa Panel   │   │
│  │ (CFBG)    │  │  (CFZB)   │  │  (CFLR P2P)   │   │
│  └───────────┘  └───────────┘  └───────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Poll Scheduler  (sequential round-robin)   │   │
│  │  interval ≥ 100 ms per technology           │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         │  RPC sendCommand (hex CFML:...)
         ▼
     Gateway (ESP32-WAN)
         │
         ├── BLE  → NOTIFY (async telemetry)
         ├── ZB   → Read Attr response (async telemetry)
         └── LoRa → P2P RX packet (async telemetry)
         │
         ▼
   ThingsBoard key "data"
         │  WebSocket push
         ▼
┌─────────────────────────────────────────────────────┐
│               Total Monitor Widget                  │
│  Shows sensor cards per node + RTT badge            │
└─────────────────────────────────────────────────────┘
```

---

## 3. Protocol Mapping (CFML frame)

Tất cả RPC đều hex-encode frame `CFML:<sub-protocol>:<slot>:<verb>:<params>`.

### 3.1 BLE — `CFBG`
| Action | Frame |
|---|---|
| Scan | `CFML:CFBG:<slot>:SCAN:<ms>` |
| Connect | `CFML:CFBG:<slot>:CONNECT:<MAC>` |
| Enable NOTIFY | `CFML:CFBG:<slot>:NOTIFY:<idx>:<cccd>:1` |
| **Polling** | Passive — gateway gửi NOTIFY tự động sau enable |

> BLE không cần polling chủ động. Sau khi enable NOTIFY (dùng `CFBG:<slot>:NOTIFY:<idx>:<cccd>:1` như widget cũ), sensor node tự push data theo interval cố định của firmware. Interval điều chỉnh thông qua **GATT Write** vào characteristic `0xAA12` bằng lệnh `CFBG:<slot>:WRITE:<idx>:<handle>:<hex_interval_ms>` — dùng đúng command `WRITE` đã có sẵn trong firmware CFBG cũ.

### 3.2 Zigbee — `CFZB`
| Action | Frame |
|---|---|
| Start network | `CFML:CFZB:<slot>:NET_START` |
| Permit join | `CFML:CFZB:<slot>:PERMIT_JOIN:<s>` |
| **Read Attr** | `CFML:CFZB:<slot>:READ_ATTR:<short>,<ep>,<cluster>,<attr>` |

> Polling chủ động: scheduler gửi `READ_ATTR` cho từng node Zigbee theo interval. Node trả kết quả về async qua telemetry `RPT:` hoặc `HEX_FRAME:`.

### 3.3 LoRa P2P — `CFLR`
| Action | Frame | Mô tả |
|---|---|---|
| Switch TX | `CFML:CFLR:<slot>:P2P_TX_MODE` | Gateway switch sang TX |
| Send request | `CFML:CFLR:<slot>:P2P_SEND:<hex_payload>` | Gửi request đến node |
| Switch RX | `CFML:CFLR:<slot>:P2P_RX_MODE` | Gateway switch sang RX |
| Wait RX | — | Đợi `RXLRPKT` event qua telemetry |

> Mỗi poll cycle: TX_MODE → SEND(request) → RX_MODE → đợi RXLRPKT. Timeout nếu không nhận sau `rtt_timeout` ms.
**REQUEST payload (gateway → node):** `AA <seq>` (2 bytes hex)
**RESPONSE payload (node → gateway):** `<nodeId> <seq> <tHi> <tLo> <hHi> <hLo>` (6 bytes)
- `seq` dùng để match request/response cho RTT
- Node phản hồi đúng `seq` nhận được
---

## 4. Poll Scheduler

```
State machine (per technology):
  IDLE → REQUESTING → WAITING_RESP → IDLE
                              ↓ timeout
                           TIMEOUT → IDLE
```

- Scheduler **tuần tự** (sequential): BLE → ZB → LoRa → BLE → ...  
  (hoặc chỉ những loại đang enabled)
- Mỗi cycle xử lý 1 technology tại 1 thời điểm, tránh spam đồng thời
- Nếu có nhiều node cùng loại: lần lượt từng node trong 1 cycle
- **Interval** riêng cho từng technology, min **100 ms**
- Có thể bật/tắt từng loại độc lập

```
Config UI (Control Widget):
  [BLE  ✓] interval: [__500__] ms   nodes: 2
  [ZB   ✓] interval: [_1000__] ms   nodes: 3
  [LoRa ✓] interval: [_2000__] ms   nodes: 1
  [▶ Start Polling]  [■ Stop]
```

---

## 5. Round-Trip Time (RTT) Measurement

```
t_request = Date.now()  ← ghi lúc gửi RPC / trigger poll
t_response = Date.now() ← ghi lúc nhận telemetry event tương ứng
RTT = t_response - t_request
```

- Mỗi request được tag bằng `seq` (sequence number) để match response
- RTT hiển thị dạng badge trên sensor card: `RTT: 342 ms`
- Lưu min/max/avg RTT theo rolling window 10 mẫu
- RTT > threshold (configurable, mặc định 5000 ms) → hiển thị warning

---

## 6. Total Monitor Widget — UI Layout

```
┌──────────────────────────────────────────────────────────┐
│ 🔗 DA2 Total Sensor Monitor          [Pill: Active ●]    │
├──────────────────────────────────────────────────────────┤
│  Filter: [All ▼]  Tech: [☑BLE ☑ZB ☑LoRa]  RX: 47       │
├──────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐  ┌────────────┐ │
│  │ 🔵 BLE Node 1  │  │ 🔶 ZB 0x1234  │  │ 📡 LoRa 1  │ │
│  │ T: 25.3°C      │  │ T: 24.1°C     │  │ T: 26.0°C  │ │
│  │ H: 60%         │  │ H: 55%        │  │ H: 58%     │ │
│  │ RTT: 45 ms     │  │ RTT: 312 ms   │  │ RTT: 870ms │ │
│  │ RSSI: -65 dBm  │  │ LQI: 200      │  │ RSSI:-80   │ │
│  └────────────────┘  └────────────────┘  └────────────┘ │
├──────────────────────────────────────────────────────────┤
│  0 errors  |  Last update: 14:32:05                      │
└──────────────────────────────────────────────────────────┘
```

---

## 7. Total Control Widget — UI Layout

```
┌──────────────────────────────────────────────────────────┐
│ ⚙ DA2 Total Sensor Control           Slot: [0 ▼]        │
├────────────┬─────────────────────────────────────────────┤
│ TECHNOLOGY │  CONFIGURATION                              │
├────────────┼─────────────────────────────────────────────┤
│ 🔵 BLE     │  [Scan] [Connect: DA2_SENSOR_1 ▼]          │
│  ☑ Enable  │  Interval: [500] ms    Nodes: [1,2 ✓]      │
├────────────┼─────────────────────────────────────────────┤
│ 🔶 Zigbee  │  [Start Net] [Permit Join]                  │
│  ☑ Enable  │  Interval: [1000] ms   Nodes: [0x1234 ✓]   │
├────────────┼─────────────────────────────────────────────┤
│ 📡 LoRa    │  [Join / P2P Mode]                          │
│  ☑ Enable  │  Interval: [2000] ms   RTT TO: [5000] ms   │
├────────────┴─────────────────────────────────────────────┤
│  [▶ Start Polling]    [■ Stop]    Poll mode: Sequential  │
├──────────────────────────────────────────────────────────┤
│  Console log                                [Clear]      │
│  > [14:32:00] BLE  Node1 RTT=45ms T=25.3 H=60          │
│  > [14:32:01] ZB   0x1234 RTT=312ms T=24.1             │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Arduino Test Node Firmware

### 8.1 ESP32-S3 — BLE Sensor Node

**Concept:**
- BLE GATT Server (Peripheral)
- Service `0xAA10`, Characteristic `0xAA11` (READ + NOTIFY) → 4 bytes: `[temp_i16LE, hum_i16LE]`
- Characteristic `0xAA12` (WRITE) → nhận interval từ gateway (2 bytes, ms)
- Simulate cảm biến: tạo ra giá trị temp/hum giả có dao động nhẹ
- Gửi NOTIFY theo interval (mặc định 1000 ms, tối thiểu 100 ms)
- Tên BLE: `DA2_SENSOR_1`

### 8.2 ESP32-C6 — Zigbee Sensor Node

**Concept:**
- Zigbee End Device (ZED) join vào coordinator trên gateway
- Cluster `0x0402` (Temperature Measurement), Attr `0x0000`
- Cluster `0x0405` (Relative Humidity), Attr `0x0000`
- Trả về giá trị khi gateway gửi Read Attribute
- Không tự report (không dùng Configure Reporting) — chỉ phản hồi Read Attr
- Tên: `DA2_ZB_SENSOR`

### 8.3 ESP32-C3 — LoRa P2P Node (via WioE5)

**Concept:**
- ESP32-C3 giao tiếp WioE5 qua UART (AT commands) ở P2P TEST mode
- Boot vào `AT+MODE=TEST` → `AT+TEST=RFCFG,...` (cùng RF config với gateway) → `AT+TEST=RXLRPKT`
- Khi nhận REQUEST `[0xAA, seq]` từ gateway:
  1. Parse seq từ packet
  2. Tạo dữ liệu giả temp (2000–3000, ×0.01°C) + humid (4000–9000, ×0.01%)
  3. `AT+TEST=TXLRPKT,"<nodeId><seq><tHi><tLo><hHi><hLo>"` — gửi 6-byte response
  4. Quay lại `AT+TEST=RXLRPKT`
- Node ID cố định = `0x01`
- Không tự gửi — chỉ phản hồi khi có REQUEST

---

## 9. Payload Format (chung)

| Byte | Nội dung |
|---|---|
| `[0]` | `nodeId` (1 byte) |
| `[1]` | `seq` (1 byte, tăng dần) |
| `[2:3]` | Temperature × 100 (int16 BE) |
| `[4:5]` | Humidity × 100 (int16 BE) |

---

## 10. File Structure (sau khi implement)

```
thingsboard_widget test/
  total_monitor_widget.html / .css / .js
  total_control_widget.html / .css / .js

arduino_test_nodes/
  ble_sensor_node/          ← ESP32-S3
    ble_sensor_node.ino
  zigbee_sensor_node/       ← ESP32-C6
    zigbee_sensor_node.ino
  lora_p2p_node/            ← ESP32-C3 + WioE5
    lora_p2p_node.ino
```

---

## 11. Quyết định đã xác nhận

| # | Vấn đề | Quyết định |
|---|---|---|
| 1 | LoRa REQUEST payload | `[0xAA, seq]` 2 bytes. Response `[nodeId, seq, tHi, tLo, hHi, hLo]` 6 bytes. Tất cả node trả temp + humid |
| 2 | BLE interval | Dùng `CFBG:WRITE` command cũ để write interval vào char `0xAA12`. Notify cơ chế như cũ |
| 3 | Số node | **1 node duy nhất mỗi loại**: 1 BLE, 1 Zigbee, 1 LoRa |
| 4 | Zigbee RTT | `t_send` lúc gửi READ_ATTR, `t_recv` lúc nhận RPT telemetry cùng cluster/attr |
| 5 | Dashboard | Widget mới trên dashboard **riêng biệt**, không liên quan widget cũ |
