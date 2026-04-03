# UI Design — LoRa Application Test Widget

## Mục đích

Widget ThingsBoard cho bài test LoRa: điều khiển **1 thiết bị** Arduino Uno R4 WiFi + Wio-E5 (LoRaWAN) hiển thị 12×8 LED matrix.

---

## Kiến trúc giao thức

```
ThingsBoard Widget
  → RPC sendCommand (hex-encoded)
  → MCU WAN (ESP32-S3)
  → UART → MCU LAN (ESP32-S3)
  → LoRa Handler
  → UART → LoRa Module (WioE5/E220/etc.)
  → LoRaWAN Network
  → Arduino Uno R4 WiFi + WioE5
  → 12×8 LED Matrix
```

**Prefix**: `CFML:CFLR:<slot>:AT+<command>`
**Response prefix**: `CFLR:<slot>:<OK|FAIL>:<payload>`

---

## Thiết bị test

| # | Loại | Hardware | Khả năng |
|---|------|----------|----------|
| 1 | Display | Arduino Uno R4 WiFi + WioE5 | LED Matrix 12×8, LoRaWAN Class A, OTAA |

### Payload Convention (Downlink → Arduino)

| Byte 0 (CMD) | Byte 1 (Param) | Hiệu ứng |
|--------------|----------------|-----------|
| 0x00 | — | Tắt tất cả LED |
| 0x01 | — | Bật tất cả LED |
| 0x02 | — | Blink animation |
| 0x03 | — | Scroll "HI" |
| 0x10 | 0x00–0x09 | Hiển thị số 0–9 |
| 0x20 | — | Icon trái tim ❤ |
| 0x21 | — | Icon check ✓ |
| 0x22 | — | Icon X (error) ✕ |

### Uplink từ Arduino

| Payload | Ý nghĩa |
|---------|---------|
| 0xAA | Initial status (vừa join) |
| 0xBB | Keepalive (mỗi 15s) |

---

## Bố cục giao diện (Layout)

```
┌──────────────────────────────────────────────────────────────────┐
│  LoRa Application Test                                          │
│  Stack: [0 ▼]          Status: ● Connected / ● Disconnected    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────┐         │
│  │              DEVICE STATUS                         │         │
│  │  🎯 Arduino Uno R4 WiFi + WioE5                    │         │
│  │  Join: OTAA        Class: A       DR: 3            │         │
│  │  Last uplink: 10:35:22  (0xBB = Alive)             │         │
│  │  Last downlink: 10:35:10                           │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                  │
│  ┌────────────────────────────────────────────────────┐         │
│  │              LED MATRIX PREVIEW                    │         │
│  │  ┌─────────────────────────────┐                   │         │
│  │  │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  │  (12 × 8 grid)   │         │
│  │  │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  │  Hiển thị preview │         │
│  │  │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  │  của lệnh gửi     │         │
│  │  │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  │                   │         │
│  │  │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  │                   │         │
│  │  │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  │                   │         │
│  │  │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  │                   │         │
│  │  │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  │                   │         │
│  │  └─────────────────────────────┘                   │         │
│  │  Hiển thị hiện tại: ❤ Heart                        │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                  │
│  ┌────────────────────────────────────────────────────┐         │
│  │              ĐIỀU KHIỂN                            │         │
│  │                                                    │         │
│  │  ── Cơ bản ──                                      │         │
│  │  [💡 All ON]  [⚫ All OFF]  [✨ Blink]  [📜 "HI"] │         │
│  │                                                    │         │
│  │  ── Số ──                                          │         │
│  │  [0] [1] [2] [3] [4] [5] [6] [7] [8] [9]         │         │
│  │                                                    │         │
│  │  ── Icon ──                                        │         │
│  │  [❤ Heart]  [✓ Check]  [✕ Cross]                  │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Console Log                                          [Clear]   │
│  [10:35:10] TX: AT+SEND=2:02:20 (Heart icon)                   │
│  [10:35:11] RX: +EVT:DONE                                      │
│  [10:35:22] RX: +EVT:RX1:2:01:BB (Keepalive)                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Chi tiết từng thành phần

### 1. Header Bar

| Thành phần | Mô tả |
|-----------|-------|
| Tiêu đề | "LoRa Application Test" |
| Stack selector | `[0]` hoặc `[1]` |
| Status | `● Connected` (xanh, khi nhận uplink gần đây ≤60s) / `● Disconnected` (đỏ) |

### 2. Device Status Card

- Hiển thị thông tin thiết bị Arduino
- **Join method**: OTAA (fixed)
- **Class**: A
- **Data Rate**: DR 3 (configurable)
- **Last uplink**: timestamp + payload decoded (0xAA=Initial, 0xBB=Alive)
- **Last downlink**: timestamp + lệnh gửi gần nhất

### 3. LED Matrix Preview

- Grid SVG/Canvas 12 cột × 8 hàng
- Mỗi ô tròn nhỏ: `○` (tắt, xám nhạt) hoặc `●` (bật, vàng sáng)
- Preview cập nhật khi user gửi lệnh mới:
  - All ON → tất cả `●`
  - All OFF → tất cả `○`
  - Heart → hiển thị pattern trái tim
  - Digit → hiển thị số
  - Blink → animation nhấp nháy
- **Label** bên dưới: "Hiển thị hiện tại: ❤ Heart"

### 4. Điều khiển

#### 4a. Cơ bản

| Nút | Payload gửi | Mô tả |
|-----|-------------|-------|
| 💡 All ON | `01` | Bật hết |
| ⚫ All OFF | `00` | Tắt hết |
| ✨ Blink | `02` | Animation nhấp nháy |
| 📜 "HI" | `03` | Scroll text "HI" |

#### 4b. Số (0–9)

| Nút | Payload |
|-----|---------|
| [0] | `1000` |
| [1] | `1001` |
| ... | ... |
| [9] | `1009` |

#### 4c. Icon

| Nút | Payload | Mô tả |
|-----|---------|-------|
| ❤ Heart | `20` | Trái tim |
| ✓ Check | `21` | Dấu tích |
| ✕ Cross | `22` | Dấu X |

### 5. Console Log

- Timestamp + TX/RX direction + hex payload + decoded meaning
- Auto-scroll, nút Clear

---

## Luồng hoạt động

### Gửi lệnh

```
1. User nhấn nút (ví dụ [❤ Heart])
2. Widget xây hex payload: "20"
3. Widget gửi: CFML:CFLR:0:AT+SEND=2:01:20
   (port=2, len=1, hex=20)
4. Chờ response: CFLR:0:OK:+EVT:DONE hoặc timeout
5. Cập nhật LED Matrix Preview
6. Log: [10:35:10] TX: Heart icon (0x20)
```

### Nhận uplink

```
1. LoRa Handler nhận async: +EVT:RX1:2:01:BB
2. Widget parse: port=2, payload=0xBB
3. Cập nhật Last uplink: "BB = Keepalive"
4. Cập nhật status: ● Connected
5. Log: [10:35:22] RX: Keepalive (0xBB)
```

---

## Quy tắc gửi command

1. **Không gửi đè**: Queue FIFO, AT+SEND chờ +EVT:DONE hoặc timeout (10s)
2. **LoRa Class A**: Downlink chỉ gửi được sau uplink → widget có thể phải chờ keepalive cycle (15s)
3. **Hiển thị thông báo**: "Lệnh đã queue, chờ next uplink window..."
4. **Retry**: Không tự retry, user nhấn lại nếu cần

---

## Màu sắc & Icon

| Phần tử | Màu | Hex |
|---------|-----|-----|
| Header | Orange darken-4 | #e65100 |
| Matrix LED on | Amber | #ffc107 |
| Matrix LED off | Grey lighten | #e0e0e0 |
| Status connected | Green | #4caf50 |
| Status disconnected | Red | #f44336 |
| Control button bg | Blue grey | #546e7a |
| Console bg | Dark | #263238 |

---

## Responsive

- **≥ 1200px**: Single column centered, max-width 800px
- **800–1199px**: Full width
- **< 800px**: Control buttons wrap thành 2 hàng, matrix preview nhỏ hơn
