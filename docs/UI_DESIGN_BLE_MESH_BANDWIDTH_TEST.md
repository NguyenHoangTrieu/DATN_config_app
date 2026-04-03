# UI Design — BLE Mesh Bandwidth Test Widget

## Mục đích

Widget ThingsBoard cho bài test đo băng thông tối đa BLE Native Mesh. Kết nối **1 node giả lập**, gửi/nhận dữ liệu liên tục qua Mesh models, đo throughput theo thời gian thực.

---

## Kiến trúc giao thức

```
ThingsBoard Widget
  → RPC sendCommand → Gateway
  → BLE Mesh Provisioner (ESP BLE Mesh) ←→ Mesh Bandwidth Node
```

**Prefix**: `CFML:CFBN:<slot>:<verb>:<params>`

---

## Thiết bị test

| Tên | CID | Models | Mô tả |
|-----|-----|--------|-------|
| `DA2_BW_MESH` | 0xDA2B | Vendor Server (CID=0x02E5, Model=0x0001) | Bandwidth test node |

### Giao thức đo (qua Vendor Model)

- **Downlink**: Provisioner gửi Vendor Model SET messages liên tục
- **Uplink**: Node gửi Vendor Model STATUS messages liên tục
- **MTU Mesh**: ~11 bytes segmented → ~380 bytes max (32 segments)
- **Thực tế**: Unsegmented access message = ~11 bytes payload, segmented = lên tới ~380B

---

## Bố cục giao diện

```
┌──────────────────────────────────────────────────────────────────┐
│  BLE Mesh Bandwidth Test                                        │
│  Stack: [0 ▼]   Node: DA2_BW_MESH (0x0002)  Status: ● Prov'd  │
│  [🔍 Scan]  [📌 Provision]  [🔑 AppKey Add]                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────── TEST CONTROLS ────────┐                               │
│  │  Direction:                   │                               │
│  │  ( ) Uplink only (RX)        │                               │
│  │  ( ) Downlink only (TX)      │                               │
│  │  (●) Bidirectional           │                               │
│  │                              │                               │
│  │  Packet Size: [11   ] bytes  │  (max unseg: 11)              │
│  │  Duration:    [30   ] sec    │                               │
│  │  Use Segmented: [ ] ☑        │  (cho packet > 11 bytes)      │
│  │                              │                               │
│  │  [▶ START TEST]  [⏹ STOP]   │                               │
│  └──────────────────────────────┘                               │
│                                                                  │
│  ┌──────── REALTIME METRICS ────────────────────────────┐       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │       │
│  │  │ Uplink   │  │ Downlink │  │ Total    │          │       │
│  │  │ ↑ 1.2    │  │ ↓ 0.8   │  │ ⇅ 2.0   │          │       │
│  │  │ KB/s     │  │ KB/s     │  │ KB/s     │          │       │
│  │  └──────────┘  └──────────┘  └──────────┘          │       │
│  │                                                      │       │
│  │  Elapsed: 12.0s  Msgs TX: 340  RX: 420              │       │
│  │  Bytes TX: 3,740    Bytes RX: 4,620                 │       │
│  │  Errors: 1           Timeouts: 3                    │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── THROUGHPUT CHART ────────────────────────────┐       │
│  │  KB/s                                                │       │
│  │  3.0 ┤                                               │       │
│  │      │                                               │       │
│  │  2.0 ┤    ╱──╲                                       │       │
│  │      │   ╱    ╲──── Uplink                           │       │
│  │  1.0 ┤──╱              ── Downlink                   │       │
│  │      │                                               │       │
│  │  0.0 ┼───────────────────────────── time (s)         │       │
│  │      0    5    10   15   20   25   30                │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── TEST RESULTS ────────────────────────────────┐       │
│  │  Test #2 — Bidirectional — 30s — 11B unseg           │       │
│  │  ┌─────────────┬──────────┬──────────┬─────────┐    │       │
│  │  │ Direction   │ Avg KB/s │ Peak KB/s│ Total KB│    │       │
│  │  ├─────────────┼──────────┼──────────┼─────────┤    │       │
│  │  │ ↑ Uplink    │  1.23    │  1.80    │  36.9   │    │       │
│  │  │ ↓ Downlink  │  0.85    │  1.10    │  25.5   │    │       │
│  │  │ ⇅ Total     │  2.08    │  2.60    │  62.4   │    │       │
│  │  └─────────────┴──────────┴──────────┴─────────┘    │       │
│  │  Error rate: 0.3%   Message loss: 0.7%              │       │
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
| Packet Size | 1–11 (unseg), 12–380 (segmented) |
| Duration | 5–300 seconds |
| Use Segmented | Checkbox, cho phép packet > 11 bytes |
| Start/Stop | Điều khiển test |

### Giao thức vendor model

**Downlink (TX) — Widget gửi:**
```
CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"VENDOR_SET","params":{"opcode":"0xC0","data":"<hex_payload>"}}
```
- Chờ response trước khi gửi tiếp (KHÔNG gửi đè)
- Response: `CFBN:0:OK:VENDOR_STATUS:0x0002:<ack_data>`

**Uplink (RX) — Node publish:**
```
CFBN:0:OK:VENDOR_STATUS:0x0002:<hex_payload>
```
- Widget đếm bytes nhận
- Node gửi liên tục khi test active

### Control Protocol

```
1. Gửi start: CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"VENDOR_SET","params":{"opcode":"0xC1","data":"01"}}
   → Node bắt đầu publish liên tục
2. Gửi stop: ...{"opcode":"0xC1","data":"00"}
   → Node dừng publish
3. Read stats: ...{"opcode":"0xC2","data":""}
   → Node trả về: bytes_received (uint32), packets_received (uint32)
```

---

## Luồng hoạt động

### Setup

```
1. Scan unprovisioned: CFML:CFBN:0:SCAN:5000
2. Tìm DA2_BW_MESH → Provision
3. App Key Add
4. Widget sẵn sàng test
```

### Test Loop

```
1. [START TEST]
2. Gửi VENDOR_SET opcode=0xC1, data=01 (start)
3. Loop:
   a. TX: Gửi VENDOR_SET opcode=0xC0, data=<payload>
      → Chờ VENDOR_STATUS response (timeout 2s)
      → bytes_tx += payload.length; msgs_tx++
   b. RX: Nhận VENDOR_STATUS async từ node
      → bytes_rx += data.length; msgs_rx++
   c. Mỗi 1s: cập nhật metrics + chart
4. Khi hết duration hoặc STOP:
   → Gửi VENDOR_SET opcode=0xC1, data=00 (stop)
   → Read stats: opcode=0xC2
   → Hiển thị results
```

---

## Quy tắc gửi command

1. **Không gửi đè**: Chờ response/timeout trước khi gửi command tiếp
2. **Mesh round-trip**: ~100–500ms per message → throughput bị giới hạn
3. **Timeout**: 2s per vendor message, 5s cho control commands

---

## Màu sắc

| Phần tử | Màu | Hex |
|---------|-----|-----|
| Header | Deep purple | #4a148c |
| Uplink line | Cyan | #00bcd4 |
| Downlink line | Pink | #e91e63 |
| Start button | Green | #4caf50 |
| Stop button | Red | #f44336 |

---

## Responsive

- Single column layout, chart responsive
- Metric cards: 3 cột ≥800px, 1 cột <800px
