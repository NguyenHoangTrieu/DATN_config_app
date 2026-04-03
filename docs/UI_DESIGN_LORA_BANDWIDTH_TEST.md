# UI Design — LoRa Bandwidth Test Widget

## Mục đích

Widget ThingsBoard cho bài test đo băng thông tối đa LoRaWAN. Kết nối **1 thiết bị giả lập** (Arduino + WioE5), gửi/nhận dữ liệu qua LoRaWAN Class C, đo throughput theo thời gian thực.

---

## Kiến trúc giao thức

```
ThingsBoard Widget
  → RPC sendCommand → Gateway
  → LoRa Handler → LoRa Module
  → LoRaWAN Network
  → Arduino Uno R4 WiFi + WioE5 (Bandwidth Test firmware)
```

**Prefix**: `CFML:CFLR:<slot>:AT+<command>`

---

## Thiết bị test

| Hardware | LoRa Class | DR | Mô tả |
|----------|-----------|-----|-------|
| Arduino Uno R4 WiFi + WioE5 | C (for continuous RX) | 0–5 (configurable) | Bandwidth test device |

### Giới hạn LoRaWAN

- **Max payload per frame**: DR-dependent (DR0: 51B, DR3: 115B, DR5: 222B)
- **Duty cycle**: Tùy band (EU868: 1%, AS923: thường 10%)
- **Class A**: Downlink chỉ sau uplink → throughput rất thấp
- **Class C**: Continuous RX → downlink mọi lúc → throughput tốt hơn
- **Thực tế**: LoRa throughput rất thấp (0.3–5 KB/s max lý thuyết)

---

## Bố cục giao diện

```
┌──────────────────────────────────────────────────────────────────┐
│  LoRa Bandwidth Test                                            │
│  Stack: [0 ▼]         Status: ● Joined (DR3, Class C)          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────── TEST CONTROLS ────────┐                               │
│  │  Direction:                   │                               │
│  │  ( ) Uplink only              │                               │
│  │  ( ) Downlink only            │                               │
│  │  (●) Bidirectional            │                               │
│  │                              │                               │
│  │  Data Rate: [DR3 ▼]          │  (DR0–DR5)                    │
│  │  LoRa Class: [C ▼]           │  (A or C)                     │
│  │  Packet Size: [115  ] bytes  │  (auto max per DR)            │
│  │  Duration:    [60   ] sec    │                               │
│  │                              │                               │
│  │  [▶ START TEST]  [⏹ STOP]   │                               │
│  │                              │                               │
│  │  ⚠ Lưu ý: LoRa throughput   │                               │
│  │  rất thấp (~0.1–5 KB/s)     │                               │
│  └──────────────────────────────┘                               │
│                                                                  │
│  ┌──────── REALTIME METRICS ────────────────────────────┐       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │       │
│  │  │ Uplink   │  │ Downlink │  │ Total    │          │       │
│  │  │ ↑ 0.35   │  │ ↓ 0.28  │  │ ⇅ 0.63  │          │       │
│  │  │ KB/s     │  │ KB/s     │  │ KB/s     │          │       │
│  │  └──────────┘  └──────────┘  └──────────┘          │       │
│  │                                                      │       │
│  │  Elapsed: 25.0s  Frames TX: 12  RX: 8               │       │
│  │  Bytes TX: 1,380    Bytes RX: 920                   │       │
│  │  Duty Cycle Used: 4.2%                              │       │
│  │  Errors: 0    No ACK: 1                             │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── THROUGHPUT CHART ────────────────────────────┐       │
│  │  B/s (bytes per second)                              │       │
│  │  400 ┤                                               │       │
│  │      │    ╱╲                                         │       │
│  │  300 ┤   ╱  ╲    ╱╲── Uplink                        │       │
│  │      │  ╱    ╲  ╱                                    │       │
│  │  200 ┤ ╱      ╲╱       ── Downlink                   │       │
│  │      │╱                                              │       │
│  │  100 ┤                                               │       │
│  │      │                                               │       │
│  │    0 ┼───────────────────────────── time (s)         │       │
│  │      0   10   20   30   40   50   60                 │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── TEST RESULTS ────────────────────────────────┐       │
│  │  Test #1 — Bidir — 60s — DR3 Class C — 115B         │       │
│  │  ┌─────────────┬──────────┬──────────┬─────────┐    │       │
│  │  │ Direction   │ Avg B/s  │ Peak B/s │ Total B │    │       │
│  │  ├─────────────┼──────────┼──────────┼─────────┤    │       │
│  │  │ ↑ Uplink    │  352     │  460     │  21,120 │    │       │
│  │  │ ↓ Downlink  │  283     │  380     │  16,980 │    │       │
│  │  │ ⇅ Total     │  635     │  720     │  38,100 │    │       │
│  │  └─────────────┴──────────┴──────────┴─────────┘    │       │
│  │  Duty cycle used: 8.3%   Frame loss: 2.1%          │       │
│  │  Effective data rate: ~5.08 kbps                    │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────── DR COMPARISON TABLE ─────────────────────────┐       │
│  │  (Filled after running tests at multiple DRs)        │       │
│  │  ┌───────┬──────────┬──────────┬──────────────┐     │       │
│  │  │  DR   │ Payload  │ Avg B/s  │ Duty Cycle % │     │       │
│  │  ├───────┼──────────┼──────────┼──────────────┤     │       │
│  │  │  DR0  │   51 B   │   45     │   12.3%      │     │       │
│  │  │  DR3  │  115 B   │  352     │    8.3%      │     │       │
│  │  │  DR5  │  222 B   │  680     │    6.1%      │     │       │
│  │  └───────┴──────────┴──────────┴──────────────┘     │       │
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
| Data Rate | DR0 (SF12, 51B max) – DR5 (SF7, 222B max) |
| LoRa Class | A (chỉ RX sau TX) hoặc C (continuous RX) |
| Packet Size | Auto-fill max payload per DR, editable |
| Duration | 10–300 seconds (LoRa cần thời gian dài hơn) |
| Warning | Hiển thị cảnh báo LoRa throughput thấp |

### Đặc biệt LoRa: Throughput unit

- Vì LoRa throughput rất thấp → hiển thị **B/s** (bytes/second) thay vì KB/s
- Chart Y-axis: B/s
- Metric cards: hiển thị cả B/s và kbps (effective bitrate)

### Giao thức

**Configure Class:**
```
CFML:CFLR:0:AT+CLASS=C
```

**Configure DR:**
```
CFML:CFLR:0:AT+DR=3
```

**Start Test (thông báo device):**
```
CFML:CFLR:0:AT+SEND=2:02:C101
(port=2, payload=0xC1 0x01 = start uplink flood)
→ Chờ +EVT:DONE
```

**Downlink (TX):**
```
CFML:CFLR:0:AT+SEND=2:<len>:<hex_payload>
→ Chờ +EVT:DONE hoặc timeout (15s cho LoRa)
→ bytes_tx += payload.length
```

**Uplink (RX):**
```
Nhận async: +EVT:RX1:2:<len>:<hex_data>
hoặc: +RECV:2:<hex_data>
→ Parse data
→ bytes_rx += data.length
```

**Stop Test:**
```
CFML:CFLR:0:AT+SEND=2:02:C100
(payload=0xC1 0x00 = stop)
```

**Read Stats:**
```
CFML:CFLR:0:AT+SEND=2:01:C2
(payload=0xC2 = request stats)
→ Chờ uplink response: +EVT:RX:2:<len>:<stats_hex>
→ Parse: bytes_rx_total (uint32), bytes_tx_total (uint32), frames_count (uint16)
```

---

## Luồng hoạt động

### Setup

```
1. Configure: AT+CLASS=C, AT+DR=3
2. Verify joined: nhận uplink 0xAA
3. Widget sẵn sàng
```

### Test Loop

```
1. [START TEST]
2. Gửi start command (C101)
3. Chờ +EVT:DONE
4. Loop (duration):
   a. TX: AT+SEND liên tục
      → Chờ +EVT:DONE (timeout 15s)
      → bytes_tx++
   b. RX: Nhận +EVT:RX async
      → bytes_rx++
   c. Mỗi 5s: metrics + chart (LoRa update chậm hơn)
5. STOP → gửi C100
6. Request stats → C2
7. Hiển thị results + thêm vào DR Comparison table
```

### DR Comparison

- Widget lưu kết quả theo DR trong localStorage
- Bảng so sánh tự động fill sau mỗi test ở DR khác nhau
- Giúp so sánh throughput giữa các data rate

---

## Quy tắc gửi command

1. **Không gửi đè**: AT+SEND chờ +EVT:DONE (timeout 15s cho LoRa)
2. **Class A**: chỉ RX sau TX → downlink phải đợi next uplink
3. **Duty cycle**: Widget theo dõi estimated duty cycle, cảnh báo nếu > 10%
4. **LoRa chậm**: Cập nhật chart mỗi 5s thay vì 1s

---

## Màu sắc

| Phần tử | Màu | Hex |
|---------|-----|-----|
| Header | Orange darken-4 | #e65100 |
| Uplink line | Teal | #009688 |
| Downlink line | Amber | #ffc107 |
| Warning text | Orange | #ff9800 |
| Start button | Green | #4caf50 |
| Stop button | Red | #f44336 |

---

## Responsive

- Single column, chart responsive
- Metric cards + DR table: responsive grid
- Console: collapsible trên mobile
