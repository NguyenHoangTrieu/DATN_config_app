# UI Design — BLE GATT Bandwidth Test Widget

## Mục đích

Widget ThingsBoard cho bài test đo băng thông tối đa của BLE Native GATT. Kết nối **1 thiết bị giả lập** gửi/nhận dữ liệu liên tục, đo throughput theo thời gian thực.

---

## Kiến trúc giao thức

```
ThingsBoard Widget
  → RPC sendCommand → Gateway
  → BLE GATT Central (native) ←→ ESP32-S3 Bandwidth Test Peripheral
```

**Prefix**: `CFML:CFBG:<slot>:<verb>:<params>`

---

## Thiết bị test

| Tên BLE | Service | Characteristics | Mô tả |
|---------|---------|----------------|-------|
| `DA2_BW_GATT` | 0xBB10 | BB11: WRITE_NR (rx sink, 244B MTU), BB12: NOTIFY (tx flood, 244B) | Bandwidth test device |

### Giao thức đo

- **Downlink (Widget → Device)**: Ghi liên tục vào BB11 (WRITE_NR), device đếm bytes nhận
- **Uplink (Device → Widget)**: Device notify liên tục qua BB12, widget đếm bytes nhận
- **MTU**: Request MTU 247 → effective payload 244 bytes/packet

---

## Bố cục giao diện

```
┌──────────────────────────────────────────────────────────────────┐
│  BLE GATT Bandwidth Test                                        │
│  Stack: [0 ▼]    Device: DA2_BW_GATT    Status: ● Connected    │
│  [🔍 Scan]  [🔗 Connect]  [⛓ Disconnect]                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────── TEST CONTROLS ────────┐                               │
│  │  Direction:                   │                               │
│  │  ( ) Uplink only (RX)        │                               │
│  │  ( ) Downlink only (TX)      │                               │
│  │  (●) Bidirectional           │                               │
│  │                              │                               │
│  │  Packet Size: [244  ] bytes  │                               │
│  │  Duration:    [30   ] sec    │                               │
│  │                              │                               │
│  │  [▶ START TEST]  [⏹ STOP]   │                               │
│  └──────────────────────────────┘                               │
│                                                                  │
│  ┌──────── REALTIME METRICS ────────────────────────────┐       │
│  │                                                      │       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │       │
│  │  │ Uplink   │  │ Downlink │  │ Total    │          │       │
│  │  │ ↑ 12.5   │  │ ↓ 8.3   │  │ ⇅ 20.8  │          │       │
│  │  │ KB/s     │  │ KB/s     │  │ KB/s     │          │       │
│  │  └──────────┘  └──────────┘  └──────────┘          │       │
│  │                                                      │       │
│  │  Elapsed: 15.2s    Packets TX: 1240   RX: 1856      │       │
│  │  Bytes TX: 302,560    Bytes RX: 452,864             │       │
│  │  Errors: 0           Retries: 2                     │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── THROUGHPUT CHART ────────────────────────────┐       │
│  │  KB/s                                                │       │
│  │  20 ┤                                                │       │
│  │     │    ╱──╲    ╱──╲                                │       │
│  │  15 ┤   ╱    ╲  ╱    ╲──── Uplink                   │       │
│  │     │  ╱      ╲╱                                     │       │
│  │  10 ┤╱                          ── Downlink          │       │
│  │     │╲          ╱╲                                   │       │
│  │   5 ┤ ╲──╱╲──╱╲╱  ╲──                               │       │
│  │     │                                                │       │
│  │   0 ┼────────────────────────────────── time (s)     │       │
│  │     0    5    10   15   20   25   30                 │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── TEST RESULTS ────────────────────────────────┐       │
│  │  Test #3 — Bidirectional — 30s — 244B packets        │       │
│  │  ┌─────────────┬──────────┬──────────┬─────────┐    │       │
│  │  │ Direction   │ Avg KB/s │ Peak KB/s│ Total KB│    │       │
│  │  ├─────────────┼──────────┼──────────┼─────────┤    │       │
│  │  │ ↑ Uplink    │ 12.52    │ 15.80    │ 375.6   │    │       │
│  │  │ ↓ Downlink  │  8.34    │ 10.20    │ 250.2   │    │       │
│  │  │ ⇅ Total     │ 20.86    │ 24.50    │ 625.8   │    │       │
│  │  └─────────────┴──────────┴──────────┴─────────┘    │       │
│  │  Error rate: 0.0%   Packet loss: 0.16%              │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Console Log                                          [Clear]   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Chi tiết từng thành phần

### 1. Header Bar

- Tiêu đề, Stack selector, Device name, Connection status
- Scan, Connect, Disconnect buttons

### 2. Test Controls

| Thành phần | Mô tả |
|-----------|-------|
| Direction | Radio buttons: Uplink only / Downlink only / Bidirectional |
| Packet Size | Input number (1–244), default 244 |
| Duration | Input number (5–300 seconds), default 30 |
| Start button | `[▶ START TEST]` — disabled khi chưa connected hoặc đang test |
| Stop button | `[⏹ STOP]` — dừng test sớm |

### 3. Realtime Metrics

3 card lớn hiển thị throughput hiện tại:
- **Uplink** (↑): KB/s nhận được từ device notifications
- **Downlink** (↓): KB/s ghi thành công vào device  
- **Total** (⇅): Tổng cả hai

Counters chi tiết:
- Elapsed time (seconds, 0.1s resolution)
- Packets TX / RX count
- Bytes TX / RX count
- Errors / Retries

### 4. Throughput Chart (Realtime)

- **Line chart** (Canvas/SVG), cập nhật mỗi 1 giây
- 2 đường: Uplink (xanh), Downlink (cam)
- Trục X: thời gian (giây từ khi bắt đầu test)
- Trục Y: KB/s (tự scale)
- Giữ lại 300 data points (5 phút)
- Auto-scroll horizontal khi vượt viewport

### 5. Test Results (sau khi test kết thúc)

- Bảng tổng kết: Direction | Avg KB/s | Peak KB/s | Total KB
- Error rate, Packet loss percentage
- Timestamp bắt đầu/kết thúc
- Lưu lịch sử các lần test (localStorage)

---

## Luồng hoạt động

### Connect & Setup

```
1. Scan → CFML:CFBG:0:SCAN:5000
2. Tìm DA2_BW_GATT → Connect: CFML:CFBG:0:CONNECT:<MAC>
3. Discover: CFML:CFBG:0:DISC:<conn_idx>
4. Tìm BB11 (write sink) và BB12 (notify flood)
5. Enable notify trên BB12: CFML:CFBG:0:NOTIFY:<conn_idx>:<BB12_CCCD>:1
```

### Run Bandwidth Test

```
1. User nhấn [START TEST]
2. Widget bắt đầu:
   a. Uplink: Nhận NOTIFY từ BB12, đếm bytes
      → Device tự gửi liên tục 244-byte packets
   b. Downlink: Gửi WRITENR liên tục vào BB11
      → CFML:CFBG:0:WRITENR:<conn_idx>:<BB11_handle>:<244_bytes_hex>
      → Chờ OK trước khi gửi packet tiếp (KHÔNG gửi đè)
   c. Mỗi 1 giây: tính throughput, cập nhật chart + metrics

3. Sau duration hoặc user nhấn STOP:
   a. Dừng gửi
   b. Gửi STOP command: WRITENR BB11 with marker byte 0xFF
   c. Tính toán results
   d. Hiển thị bảng tổng kết
```

### Lắng nghe Notification (Uplink)

```
Widget nhận: CFBL:0:NOTIF:<handle>:<data_hex>
→ Parse data_hex (có thể 244 bytes)
→ bytes_rx += data.length
→ packets_rx++
→ Mỗi 1s: uplink_kbps = (bytes_rx_delta * 8) / 1000
```

---

## Command Queuing

```
QUAN TRỌNG: Mỗi command WRITENR phải chờ response trước khi gửi tiếp.

Workflow cho mỗi downlink packet:
1. Gửi: CFML:CFBG:0:WRITENR:<conn_idx>:<handle>:<hex>
2. Chờ: CFBL:0:OK:WRITENR (hoặc timeout 2s)
3. packets_tx++; bytes_tx += packet_size
4. Gửi packet tiếp theo

→ Throughput bị giới hạn bởi round-trip RPC time
→ Đây chính là throughput thực tế qua gateway
```

---

## Giao thức thiết bị (Arduino)

### Service 0xBB10 "DA2 Bandwidth Test"

| Char | UUID | Props | Mô tả |
|------|------|-------|-------|
| BB11 | 0xBB11 | WRITE_NR | RX sink — nhận data, đếm bytes |
| BB12 | 0xBB12 | NOTIFY | TX flood — gửi liên tục khi test active |
| BB13 | 0xBB13 | READ, WRITE | Control: 0x01=start TX, 0x00=stop TX |
| BB14 | 0xBB14 | READ, NOTIFY | Status: total bytes RX (uint32 LE) |

### Control Protocol

```
1. Widget ghi BB13 = 0x01 → device bắt đầu notify flood qua BB12
2. Widget ghi BB11 liên tục → device đếm bytes
3. Widget ghi BB13 = 0x00 → device dừng notify, gửi BB14 status
4. Widget đọc BB14 → tổng bytes device nhận (verify)
```

---

## Màu sắc

| Phần tử | Màu | Hex |
|---------|-----|-----|
| Header | Indigo | #283593 |
| Uplink line | Blue | #2196f3 |
| Downlink line | Orange | #ff9800 |
| Start button | Green | #4caf50 |
| Stop button | Red | #f44336 |
| Metric card bg | Light grey | #f5f5f5 |
| Console bg | Dark | #263238 |

---

## Responsive

- Single column layout
- Chart scales to container width
- Metric cards: 3 cột ≥800px, 1 cột <800px
