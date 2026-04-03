# UI Design — Zigbee Bandwidth Test Widget

## Mục đích

Widget ThingsBoard cho bài test đo băng thông tối đa Zigbee 3.0. Kết nối **1 thiết bị giả lập** gửi/nhận dữ liệu liên tục qua ZCL, đo throughput theo thời gian thực.

---

## Kiến trúc giao thức

```
ThingsBoard Widget
  → RPC sendCommand → Gateway
  → Zigbee Handler → E180-ZG120B Coordinator
  → Zigbee 3.0 Network → ESP32-C6 Bandwidth Node
```

**Prefix**: `CFML:CFZB:<slot>:AT+<command>`

---

## Thiết bị test

| Tên | Model ID | Endpoint | Clusters | Mô tả |
|-----|----------|----------|----------|-------|
| `ZB-BW-Test` | ZB-BW-Sensor | EP 1 | 0xFC00 (Private cluster) | Bandwidth test device |

### Giao thức đo (qua Private Cluster 0xFC00)

- **Attribute 0x0000** (uint8): Test control (0=stop, 1=start TX, 2=start RX)
- **Attribute 0x0001** (uint32): Bytes received counter (read-only)
- **Attribute 0x0002** (uint32): Bytes sent counter (read-only)
- **Downlink**: Widget gửi `AT+SENDDATA` liên tục
- **Uplink**: Node gửi attribute reports (`RPT:`) liên tục chứa data payload

---

## Bố cục giao diện

```
┌──────────────────────────────────────────────────────────────────┐
│  Zigbee Bandwidth Test                                          │
│  Stack: [0 ▼]   Network: ● Active   Node: ZB-BW-Test (0x1234) │
│  [▶ Start NW] [📡 Permit Join] [🔍 Find]                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────── TEST CONTROLS ────────┐                               │
│  │  Direction:                   │                               │
│  │  ( ) Uplink only (RX)        │                               │
│  │  ( ) Downlink only (TX)      │                               │
│  │  (●) Bidirectional           │                               │
│  │                              │                               │
│  │  Packet Size: [80   ] bytes  │  (max ZB APS: ~80 bytes)     │
│  │  Duration:    [30   ] sec    │                               │
│  │                              │                               │
│  │  [▶ START TEST]  [⏹ STOP]   │                               │
│  └──────────────────────────────┘                               │
│                                                                  │
│  ┌──────── REALTIME METRICS ────────────────────────────┐       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │       │
│  │  │ Uplink   │  │ Downlink │  │ Total    │          │       │
│  │  │ ↑ 3.5    │  │ ↓ 2.8   │  │ ⇅ 6.3   │          │       │
│  │  │ KB/s     │  │ KB/s     │  │ KB/s     │          │       │
│  │  └──────────┘  └──────────┘  └──────────┘          │       │
│  │                                                      │       │
│  │  Elapsed: 18.0s  Packets TX: 520  RX: 640           │       │
│  │  Bytes TX: 41,600    Bytes RX: 51,200               │       │
│  │  Errors: 2           APS Retries: 5                 │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── THROUGHPUT CHART ────────────────────────────┐       │
│  │  KB/s                                                │       │
│  │  6.0 ┤                                               │       │
│  │      │                                               │       │
│  │  4.0 ┤    ╱──╲──── Uplink                            │       │
│  │      │   ╱                                           │       │
│  │  2.0 ┤──╱       ── Downlink                          │       │
│  │      │                                               │       │
│  │  0.0 ┼───────────────────────────── time (s)         │       │
│  │      0    5    10   15   20   25   30                │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── TEST RESULTS ────────────────────────────────┐       │
│  │  Test #1 — Bidirectional — 30s — 80B packets         │       │
│  │  ┌─────────────┬──────────┬──────────┬─────────┐    │       │
│  │  │ Direction   │ Avg KB/s │ Peak KB/s│ Total KB│    │       │
│  │  ├─────────────┼──────────┼──────────┼─────────┤    │       │
│  │  │ ↑ Uplink    │  3.52    │  4.80    │ 105.6   │    │       │
│  │  │ ↓ Downlink  │  2.83    │  3.50    │  84.9   │    │       │
│  │  │ ⇅ Total     │  6.35    │  7.20    │ 190.5   │    │       │
│  │  └─────────────┴──────────┴──────────┴─────────┘    │       │
│  │  Error rate: 0.4%   Packet loss: 0.3%               │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Console Log                                          [Clear]   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Chi tiết

### Test Controls

| Thành phần | Mô tả |
|-----------|-------|
| Direction | Uplink / Downlink / Bidirectional |
| Packet Size | 1–80 bytes (ZB APS max payload ~80B) |
| Duration | 5–300 seconds |

### Giao thức

**Start Test:**
```
CFML:CFZB:0:AT+ATTRWRITE=<short>,01,FC00,0000,20,01
(write test_control=1 → device bắt đầu gửi data)
```

**Downlink (TX):**
```
CFML:CFZB:0:AT+SENDDATA=<short>,01,FC00,<hex_payload>
→ Chờ +SENDDATA:0 trước khi gửi tiếp
→ bytes_tx += payload.length; packets_tx++
```

**Uplink (RX):**
```
Nhận async: RPT:<short>-01,FC00,0003,<type>,<data_hex>
→ Parse data payload
→ bytes_rx += data.length; packets_rx++
```

**Stop Test:**
```
CFML:CFZB:0:AT+ATTRWRITE=<short>,01,FC00,0000,20,00
```

**Read Stats:**
```
CFML:CFZB:0:AT+ATTRREAD=<short>,01,FC00,0001  → bytes_received
CFML:CFZB:0:AT+ATTRREAD=<short>,01,FC00,0002  → bytes_sent
```

---

## Luồng hoạt động

### Setup

```
1. Start Network: AT+CREATENW
2. Permit Join: AT+OPENWNET=60
3. Bật ESP32-C6 bandwidth node → tự join
4. Find: AT+FIND → nhận short address
5. Widget sẵn sàng test
```

### Test Loop

```
1. [START TEST]
2. Ghi control attr = 1 (start)
3. Loop:
   a. TX: AT+SENDDATA liên tục
      → Chờ +SENDDATA:0 response (timeout 3s)
      → bytes_tx++
   b. RX: Nhận RPT async
      → bytes_rx++
   c. Mỗi 1s: metrics + chart
4. STOP → ghi control = 0
5. Read stats → verify
6. Hiển thị results
```

---

## Quy tắc gửi command

1. **Không gửi đè**: AT+SENDDATA phải chờ +SENDDATA:0 trước khi gửi tiếp
2. **Zigbee round-trip**: ~50–200ms per unicast
3. **Timeout**: 3s per SENDDATA, 5s cho ATTRWRITE

---

## Màu sắc

| Phần tử | Màu | Hex |
|---------|-----|-----|
| Header | Green darken-4 | #1b5e20 |
| Uplink line | Light green | #8bc34a |
| Downlink line | Deep orange | #ff5722 |
| Start button | Green | #4caf50 |
| Stop button | Red | #f44336 |

---

## Responsive

- Single column, chart responsive
- Metric cards: 3 cột ≥800px, 1 cột <800px
