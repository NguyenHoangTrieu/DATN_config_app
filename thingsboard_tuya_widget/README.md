# Tuya E27 Widget — ThingsBoard Import Guide

## Cách nhúng widget vào ThingsBoard

### Bước 1 — Tạo widget mới

1. Vào **Widgets Library** → `+` → **Create new widget**
2. Widget type: **Control widget**
3. Đặt tên: `Tuya E27 LED Controller`

### Bước 2 — Paste code

| Tab | File |
|-----|------|
| **HTML** | Nội dung file `tuya_e27_widget.html` |
| **CSS** | Nội dung file `tuya_e27_widget.css` |
| **JavaScript** | Nội dung file `tuya_e27_widget.js` |

### Bước 3 — Widget Settings (tab "Widget settings")

Không cần thêm settings — widget tự quản lý toàn bộ state.

### Bước 4 — Data key settings

Không cần data key. Widget hoạt động pure RPC.

### Bước 5 — Cấu hình RPC trên Gateway

Widget gọi RPC method `sendCommand` với string payload `CFBL:0:AT+...`

Phía Gateway (ThingsBoard device) phải có rule chain xử lý:
```
Incoming RPC "sendCommand"  →  MQTT forward tới Gateway  →  Gateway parse CFBL:  →  UART AT command
```

### Bước 6 — Add widget vào Dashboard

1. Mở Dashboard → **Add widget** → chọn widget vừa tạo
2. **Entity**: chọn device Gateway của bạn
3. Resize widget: tối thiểu **300×500 px** để UI đẹp

---

## Luồng hoạt động

```
User load widget
     │
     ▼
MODULE_HW_RESET  → AT+GETINFO  → AT+CLEAR  → AT+SCAN=5000
     │
     ▼
Hiển thị danh sách đèn (từ +SCAN / +LIST response)
     │  User nhấn chọn đèn
     ▼
AT+CONNECT=MAC  → AT+DISC=<idx>  → AT+NOTIFY=<idx>,<cccd>,1
     │
     ▼
Screen điều khiển (Screen 3)
  ├── Toggle ON/OFF  → AT+WRITE=<idx>,0x000E,<Tuya 55AA frame>
  ├── Brightness     → AT+WRITE ... DP03 value 0–1000
  ├── CCT (White)    → AT+WRITE ... DP04 value 0–1000
  └── Color (HSV)    → AT+WRITE ... DP05 string HHHHSSSSVVVV
```

---

## Tuya Frame Reference (built dynamically in JS)

| Control       | DP ID | Type  | Frame build function   |
|---------------|-------|-------|------------------------|
| Power ON      | 0x05  | bool  | `buildLEDOnFrame()`    |
| Power OFF     | 0x05  | bool  | `buildLEDOffFrame()`   |
| Brightness    | 0x03  | value | `buildBrightnessFrame(pct)` |
| Color Temp    | 0x04  | value | `buildCCTFrame(pct)`   |
| Mode → Color  | 0x02  | enum  | `buildModeColorFrame()`|
| Mode → White  | 0x02  | enum  | `buildModeWhiteFrame()`|
| HSV Color     | 0x05  | str   | `buildHSVFrame(h,s,v)` |

---

## Troubleshooting

| Triệu chứng | Kiểm tra |
|-------------|----------|
| Widget không scan được | RPC `sendCommand` − kiểm tra Gateway đang online trên ThingsBoard |
| Không thấy đèn trong list | Đảm bảo đèn đang bật và trong range BLE (~10m) |
| Connect thành công nhưng write fail | Handle `0x000E` mặc định; chạy `AT+DISC` lại để verify |
| Màu không đúng | Kiểm tra `state.seq` không bị overflow (tự xử lý, reset khi disconnect) |
