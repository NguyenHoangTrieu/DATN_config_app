# TODO Application - Điều khiển Đèn LED Tuya E27 qua Bluetooth

---

## 🏗️ Kiến trúc hệ thống

```
PC/Server App (Web UI)
        │
        │  CFBL: commands (UART / Serial)
        ▼
  ESP32 LAN MCU (DA2_esp_LAN Gateway)
        │
        │  AT Commands qua UART 115200 baud
        │  (phần sau "CFBL:0:" được gửi thẳng xuống module)
        ▼
  STM32WB55 hoặc ESP32 AT (BLE Central)
        │
        │  BLE GATT Write (Service 1910 / Char 2B11)
        ▼
  Tuya E27 (BLE Peripheral)
```

### Cách firmware Gateway xử lý CFBL command

```
App gửi:  CFBL:0:AT+RESET
                   │
Gateway nhận → tách phần sau "CFBL:0:" → gửi qua UART: "AT+RESET\r\n"
                           ↓
                     Module nhận và xử lý

Ngoại lệ GPIO-only (không gửi UART):
  CFBL:0:MODULE_HW_RESET  → toggle RST pin (LOW 100ms → HIGH)
  CFBL:0:MODULE_WAKEUP    → toggle WAKE# pin
```

### GATT Info của Tuya E27
| Item | Giá trị |
|------|---------|
| Service UUID | `1910` |
| Write Characteristic | `2B11` (ghi lệnh xuống đèn) |
| Notify Characteristic | `2B10` (nhận phản hồi từ đèn) |

---

## 📋 Các Task chính

### **Task 1: Commands điều khiển đèn — STM32WB55**

#### Flow khởi tạo (1 lần khi bắt đầu)

```
# GPIO Reset module (không gửi AT, Gateway toggle RST pin)
CFBL:0:MODULE_HW_RESET

# Kiểm tra module sống — gửi AT+GETINFO xuống UART
CFBL:0:AT+GETINFO

# Scan BLE 5 giây — gửi AT+SCAN=5000 xuống UART
CFBL:0:AT+SCAN=5000

# Kết nối đèn (thay MAC thực) — gửi AT+CONNECT=... xuống UART
CFBL:0:AT+CONNECT=A4C138XXYYZZ

# Discover services/characteristics để lấy char handle
CFBL:0:AT+DISC=0

# Kết quả trả về:  +CHAR:0x0001,0x000E,2B11  → handle = 0x000E
# Enable Notify từ đèn (2B10 = Notify Char, CCCD = handle + 1 = 0x000F)
CFBL:0:AT+NOTIFY=0,0x000F,1
```

#### Commands điều khiển đèn (sau khi connected, handle = 0x000E)

```
# Bật đèn
CFBL:0:AT+WRITE=0,0x000E,55AA00010006000501010001010F

# Tắt đèn
CFBL:0:AT+WRITE=0,0x000E,55AA00020006000501010001000E

# Độ sáng 100% (value = 0x03E8 = 1000)
CFBL:0:AT+WRITE=0,0x000E,55AA00030006000803020004000003E819

# Độ sáng 50% (value = 0x01F4 = 500)
CFBL:0:AT+WRITE=0,0x000E,55AA00040006000803020004000001F40C

# Nhiệt độ màu WARM (giá trị = 0)
CFBL:0:AT+WRITE=0,0x000E,55AA00060006000804020004000000002400

# Nhiệt độ màu COOL (giá trị = 1000)
CFBL:0:AT+WRITE=0,0x000E,55AA00070006000804020004000003E82C

# Chuyển sang chế độ màu RGB
CFBL:0:AT+WRITE=0,0x000E,55AA00080006000502040001011B

# Màu đỏ (HSV: 0°, 100%, 100%)
CFBL:0:AT+WRITE=0,0x000E,55AA00090006000C0503000830303030363436343739

# Ngắt kết nối
CFBL:0:AT+DISCONNECT=0
```

---

### **Task 2: Commands điều khiển đèn — ESP32 AT BLE**

ESP32 AT dùng index (srv_index, char_index) thay vì char handle.
Cần discover sau connect để lấy đúng index.

#### Flow khởi tạo

```
# Reset module
CFBL:0:MODULE_HW_RESET

# Kiểm tra firmware
CFBL:0:AT+GMR

# Scan BLE (1 = enable, 0 = disable, 5000ms)
CFBL:0:AT+BLESCAN=1,5

# Kết nối đèn
CFBL:0:AT+BLECONN=0,"A4:C1:38:XX:YY:ZZ"

# Discover primary services → tìm service 1910
CFBL:0:AT+BLEGATTCPRIMSRV=0

# Discover characteristics trong service (srv_index = index của service 1910)
CFBL:0:AT+BLEGATTCCHAR=0,{srv_index}

# Kết quả ví dụ: +BLEGATTCCHAR:0,1,1,0x22,14,2B11  → char_index = 1
```

#### Commands điều khiển đèn
> Format: `AT+BLEGATTCWR=<conn>,<srv_idx>,<char_idx>,<desc_idx>,<len>`
> Gateway gửi command → đợi dấu `>` → gửi data bytes

```
# Bật đèn (14 bytes)
CFBL:0:AT+BLEGATTCWR=0,{srv_idx},{char_idx},0,14
# (Gateway tiếp tục gửi data khi nhận ">")   55AA00010006000501010001010F

# Tắt đèn (14 bytes)
CFBL:0:AT+BLEGATTCWR=0,{srv_idx},{char_idx},0,14
# data:  55AA00020006000501010001000E

# Brightness 100% (17 bytes)
CFBL:0:AT+BLEGATTCWR=0,{srv_idx},{char_idx},0,17
# data:  55AA00030006000803020004000003E819

# Brightness 50% (17 bytes)
CFBL:0:AT+BLEGATTCWR=0,{srv_idx},{char_idx},0,17
# data:  55AA00040006000803020004000001F40C

# Color Temp WARM (18 bytes)
CFBL:0:AT+BLEGATTCWR=0,{srv_idx},{char_idx},0,18
# data:  55AA00060006000804020004000000002400

# Color Temp COOL (17 bytes)
CFBL:0:AT+BLEGATTCWR=0,{srv_idx},{char_idx},0,17
# data:  55AA00070006000804020004000003E82C

# RGB Mode (14 bytes)
CFBL:0:AT+BLEGATTCWR=0,{srv_idx},{char_idx},0,14
# data:  55AA00080006000502040001011B

# Màu đỏ (22 bytes)
CFBL:0:AT+BLEGATTCWR=0,{srv_idx},{char_idx},0,22
# data:  55AA00090006000C0503000830303030363436343739

# Ngắt kết nối
CFBL:0:AT+BLEDISCONN=0
```

---

### **Task 3: Thiết kế Web UI điều khiển đèn**

Xem thiết kế UI ở phần bên dưới.

---

### **Task 4: Xây dựng Web UI + Backend**

Flow Web UI:
```
1. Chọn module → load app_commands JSON tương ứng
2. Nhấn "Init" → gateway gửi CFBL:0:MODULE_HW_RESET + CFBL:0:AT+GETINFO
3. Nhấn "Scan" → gateway gửi CFBL:0:AT+SCAN=5000 (hoặc AT+BLESCAN=1,5)
4. Chọn MAC → Nhấn "Connect" → gateway gửi CFBL:0:AT+CONNECT=MAC
5. Auto Discover → gateway gửi AT+DISC=0, parse handle của char 2B11
6. Enable Notify → gateway gửi AT+NOTIFY=0,{cccd_handle},1
7. User thao tác controls → Web build Tuya bytes → CFBL:0:AT+WRITE=... → Gateway
```

---

## 🎨 Thiết kế UI — Web Demo cho ThingBoard

> **Nguyên tắc thiết kế:** Người dùng chỉ thấy tên thiết bị và controls. Không có log, không có command, không có thông tin kỹ thuật nào hiện ra.
>
> **Ngữ cảnh:** Web demo chạy trên dashboard ThingBoard. Layout **một cửa sổ duy nhất** — panel trái (danh sách thiết bị) và panel phải (điều khiển) luôn hiển thị song song.

---

### Layout tổng thể — Single Window Split Panel

```
┌─────────────────────┬──────────────────────────────────────┐
│  THIẾT BỊ      [⟳]  │  ● Tuya Smart Bulb 1            [✕] │
│  3 thiết bị         │                                      │
│ ─────────────────  │  ╔══════════════════════════════╗    │
│  💡 Smart Bulb 1 ◀  │  ║            💡               ║    │  ← preview
│  💡 Smart Bulb 2    │  ║       (sáng vàng ấm)         ║    │
│  💡 Smart Light     │  ╚══════════════════════════════╝    │
│                     │                                      │
│  (scrollable)       │        ●━━━━━━━━━━━━━┤  BẬT         │  ← toggle
│                     │                                      │
│                     │  Độ sáng                       75%   │
│                     │  ████████████░░░░░░░░░░░░░░░░░       │  ← slider
│                     │                                      │
│                     │  ┌────────┐  ┌──────────────────┐   │
│                     │  │ White  │  │    Màu sắc        │   │  ← tabs
│                     │  └────────┘  └──────────────────┘   │
│                     │                                      │
│                     │  Vàng ấm             Trắng lạnh      │
│                     │  ████▓▒░░░░░░░░░░░░░░░░░░░░░░░░      │  ← CCT
│                     │                 ▲                    │
└─────────────────────┴──────────────────────────────────────┘
```

**Cấu trúc layout (HTML):**
- `.main-layout` → `display: flex; flex-direction: row`
- `.panel-devices` → cố định `width: 195px`, có thanh cuộn cho danh sách
- `.panel-control` → `flex: 1`, có overlay mờ phủ lên khi chưa kết nối

---

### State A — Chưa kết nối (idle / đang scan)

Panel trái hiện danh sách thiết bị (hoặc spinner inline khi đang quét).
Panel phải bị phủ overlay mờ.

```
┌─────────────────────┬──────────────────────────────────────┐
│  THIẾT BỊ      [⟳]  │                                      │
│  ○ Đang quét...     │         ░░░░░░░░░░░░░░░░░░░░         │
│ ─────────────────  │      ░░░  ← Chọn thiết bị để bắt đầu ░░░  │
│  💡 Tuya Bulb 1     │         ░░░░░░░░░░░░░░░░░░░░         │
│  💡 Tuya Bulb 2     │                                      │
│  💡 Smart Light     │     (overlay mờ che phủ toàn bộ)     │
└─────────────────────┴──────────────────────────────────────┘
```

> Panel trái: icon [⟳] xoay khi đang scan. Số thiết bị hiện dưới tiêu đề.
> Panel phải: overlay `rgba(22,33,62,0.88)` + blur, text "← Chọn thiết bị để bắt đầu".

---

### State B — Đang kết nối

Thiết bị được chọn highlight (viền accent). Panel phải overlay chuyển sang spinner + "Đang kết nối...". Status dot màu vàng nhấp nháy.

```
┌─────────────────────┬──────────────────────────────────────┐
│  THIẾT BỊ      [⟳]  │  ● Tuya Smart Bulb 1                │
│  3 thiết bị         │                                      │
│ ─────────────────  │    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │
│ ▶💡 Tuya Bulb 1◀▶  │    ░░░       ⟳  Đang kết nối...  ░░░  │  ← overlay
│  💡 Tuya Bulb 2     │    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │
│  💡 Smart Light     │                                      │
└─────────────────────┴──────────────────────────────────────┘
```

> Status dot `data-state="connecting"` → màu vàng `#ff9f43`, animation pulse.
> Overlay spinner `display: block`, message "Đang kết nối...".

---

### State C — Đã kết nối, chế độ White (đèn BẬT)

Overlay ẩn hoàn toàn, toàn bộ controls hiện ra. Status dot xanh lá.

```
┌─────────────────────┬──────────────────────────────────────┐
│  THIẾT BỊ      [⟳]  │  🟢 Tuya Smart Bulb 1           [✕] │
│  3 thiết bị         ├──────────────────────────────────────┤
│ ─────────────────  │  ╔══════════════════════════════╗    │
│  💡 Tuya Bulb 1 ●  │  ║            💡               ║    │
│  💡 Tuya Bulb 2     │  ║       (sáng vàng ấm)         ║    │
│  💡 Smart Light     │  ╚══════════════════════════════╝    │
│                     │                                      │
│                     │        ●━━━━━━━━━━━━━┤  BẬT         │
│                     │  Độ sáng                       75%   │
│                     │  ████████████░░░░░░░░░░░░░░░         │
│                     │  [  White  ]  [  Màu sắc  ]          │
│                     │  Vàng ấm              Trắng lạnh     │
│                     │  ████▓▒░░░░░░░░░░░░░░░░░░░░░░        │
└─────────────────────┴──────────────────────────────────────┘
```

---

### State D — Đã kết nối, chế độ Màu sắc (đèn BẬT)

Tab "Màu sắc" active. Panel màu hiện lưới 8 swatch (4×2). Preview đổi sang màu đỏ.

```
┌─────────────────────┬──────────────────────────────────────┐
│  THIẾT BỊ      [⟳]  │  🟢 Tuya Smart Bulb 1           [✕] │
│  3 thiết bị         │  ╔══════════════════════════════╗    │
│ ─────────────────  │  ║            💡   (đỏ)         ║    │
│  💡 Tuya Bulb 1 ●  │  ╚══════════════════════════════╝    │
│  💡 Tuya Bulb 2     │        ●━━━━━━━━━━━━━┤  BẬT         │
│  💡 Smart Light     │  Độ sáng                       80%   │
│                     │  [  White  ]  [● Màu sắc ●]          │
│                     │  ┌──┐ ┌──┐ ┌──┐ ┌──┐               │
│                     │  │🔴│ │🟠│ │🟡│ │🟢│               │
│                     │  └──┘ └──┘ └──┘ └──┘               │
│                     │  ┌──┐ ┌──┐ ┌──┐ ┌──┐               │
│                     │  │🔵│ │🟣│ │⬜│ │🎨│  ← custom     │
│                     │  └──┘ └──┘ └──┘ └──┘               │
└─────────────────────┴──────────────────────────────────────┘
```

---

### State E — Đèn TẮT

Controls vẫn hiển thị nhưng mờ (`opacity: 0.35`). Toggle ở trạng thái OFF (xám).

```
┌─────────────────────┬──────────────────────────────────────┐
│  THIẾT BỊ      [⟳]  │  🟢 Tuya Smart Bulb 1           [✕] │
│                     │  ╔══════════════════════════════╗    │
│  💡 Tuya Bulb 1 ●  │  ║            💡  (xám)         ║    │  ← grayscale
│                     │  ╚══════════════════════════════╝    │
│                     │        ○━━━━━━━━━━━━━┤  TẮT  ← xám  │
│                     │  ░ Độ sáng (mờ)               75% ░ │  ← dimmed
│                     │  ░ [White]  [Màu sắc]             ░ │  ← dimmed
│                     │  ░ Vàng ấm         Trắng lạnh    ░ │  ← dimmed
└─────────────────────┴──────────────────────────────────────┘
```

---

### Interaction flow (Single Window)

```
Widget load
   │
   ├─→ startScan():
   │     MODULE_HW_RESET → AT+GETINFO → AT+CLEAR → AT+SCAN=5000 → AT+LIST
   │     Panel trái: spinner mini + "Đang quét..."
   │     Panel phải: overlay "← Chọn thiết bị để bắt đầu"
   │
   ├─→ User nhấn thiết bị trong danh sách:
   │     Item highlight (viền accent)
   │     Panel phải overlay: spinner + "Đang kết nối..."
   │     AT+CONNECT=MAC → AT+DISC=idx → AT+NOTIFY=idx,cccd,1
   │
   ├─→ Kết nối xong:
   │     Overlay ẩn, status dot xanh lá, nút [✕] hiện
   │     Gửi ngay: LED ON + Brightness + CCT
   │
   ├─→ User thao tác (tất cả gửi ngầm qua command queue):
   │     Toggle Power    → buildLEDOn/OffFrame()   → AT+WRITE
   │     Kéo Brightness  → buildBrightnessFrame()  → AT+WRITE (onchange)
   │     Kéo CCT         → buildCCTFrame()         → AT+WRITE (onchange)
   │     Chọn màu swatch → buildHSVFrame()         → AT+WRITE
   │     Custom picker   → buildHSVFrame()         → AT+WRITE
   │
   └─→ Nhấn [✕]:
         AT+DISCONNECT=idx
         Overlay hiện lại, status dot xám
         startScan() tự động
```

---

### Quy tắc UX

| Quy tắc | Chi tiết |
|---------|---------|
| Không log | Không có command log, terminal, hay thông tin kỹ thuật nào |
| Tên thân thiện | Hiện tên BLE advertising, không hiện MAC, không hiện RSSI |
| Phản hồi tức thì | Preview đèn cập nhật ngay khi user kéo slider/chọn màu |
| Error ẩn | Nếu lỗi, chỉ hiện toast ngắn, không có error code |
| Controls mờ khi OFF | Khi đèn tắt: `opacity: 0.35`, `pointer-events: none` |
| Luôn thấy danh sách | Panel trái **không bao giờ ẩn** — user có thể chọn thiết bị khác bất kỳ lúc nào |
| Gateway ẩn | User không biết/không cần biết về Gateway |
| Responsive | Widget width ≤ 380px → stack dọc (danh sách trên, controls dưới) |

---

## ✅ Tiêu chí hoàn thành

- [ ] Task 1: Test commands STM32WB55 thành công end-to-end
- [ ] Task 2: Test commands ESP32 AT BLE thành công end-to-end
- [ ] Task 3: UI pass test: người không biết BLE/IoT vẫn có thể dùng được
- [ ] Task 4: Tất cả controls (power, brightness, color temp, RGB) hoạt động
- [ ] Task 5: Web demo ThingBoard ready: chỉ cần nhúng iframe hoặc load như widget
