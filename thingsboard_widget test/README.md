# DA2 Gateway — ThingsBoard Widgets Import Guide

> All widgets communicate via JSON-RPC method `sendCommand` with payloads routed through MCU WAN and MCU LAN:
> - **BLE**: `CFML:CFBL:<slot>:<AT_command>` (e.g., `CFML:CFBL:0:AT+SCAN=5000`)
> - **Zigbee**: `CFML:CFZB:<slot>:<function_name>` (e.g., `CFML:CFZB:0:MODULE_START_NETWORK`)
>
> `CF` prefix = Config Frame (parsed by MCU WAN)  
> `ML` = MCU LAN routing  
> `CFBL`/`CFZB` = Handler dispatch (BLE or Zigbee)

---

## Widget 1: BLE GATT Peripheral Test (`ble_at_rgb_widget.*`)

**NEW**: Test native BLE GATT peripherals (ESP32-C6 "DA2_TEST_GATT") via Gateway's GATT handler.  
No AT commands — uses pure GATT discovery, read, write, and notifications.

Service 0xFFF0 — FFF1: counter (READ+NOTIFY), FFF2: LED control (WRITE).

| Tab | File |
|-----|------|
| **HTML** | `ble_at_rgb_widget.html` |
| **CSS**  | `ble_at_rgb_widget.css` |
| **JS**   | `ble_at_rgb_widget.js` |

### Features (Native GATT)
- **Auto-connect**: Scan and auto-detect "DA2_TEST_GATT" device
- **GATT Discovery**: Auto-find FFF1 and FFF2 characteristic handles
- **Counter Display**: READ FFF1 characteristic (4-byte uint32-LE), poll every 2 s
- **LED Control**: WRITE to FFF2 (0x00=OFF, 0x01=ON) with visual feedback
- **Notifications**: Auto-subscribe to FFF1 updates
- **Live Status**: Connection state, device MAC, GATT handles display
- **Console**: Full RPC command/response logging

### Key Commands (CFML:CFBG format - Native GATT, no AT)
| Action | Command |
|--------|----------|
| Scan devices | `CFML:CFBG:SCAN:5000` |
| Connect | `CFML:CFBG:CONNECT:<MAC>` |
| Discover services | `CFML:CFBG:DISCOVER:<MAC>` |
| Read FFF1 | `CFML:CFBG:READ:<MAC>:0000fff1-0000-1000-8000-00805f9b34fb` |
| Subscribe FFF1 | `CFML:CFBG:SUBSCRIBE:<MAC>:0000fff1-0000-1000-8000-00805f9b34fb` |
| LED ON | `CFML:CFBG:WRITE:<MAC>:0000fff2-0000-1000-8000-00805f9b34fb:01` |
| LED OFF | `CFML:CFBG:WRITE:<MAC>:0000fff2-0000-1000-8000-00805f9b34fb:00` |

### Config bar
- **Stack slot**: BLE S1 (0) / BLE S2 (1)
- **Target Device**: Device name to auto-connect (default: `DA2_TEST_GATT`)
- **Auto-Connect button**: Scans and automatically connects to target device

### Compatible Arduino Sketch
Use with **`esp32c6_ble_gatt_peripheral.ino`** from `arduino_test/esp32c6_ble_gatt_peripheral/`:
- Service FFF0: displays "DA2_TEST_GATT" on scan
- FFF1: 4-byte counter incremented every 2 s, notifications enabled
- FFF2: accepts 0x00/0x01 to control onboard LED, echoes back via FFF1 notify

---

## Widget 2: Zigbee Gateway Control (`zigbee_control_widget.*`)

Control Zigbee end-devices via E180-ZG120B AT module (stack_001).

| Tab | File |
|-----|------|
| **HTML** | `zigbee_control_widget.html` |
| **CSS**  | `zigbee_control_widget.css` |
| **JS**   | `zigbee_control_widget.js` |

### Features
- Start / Stop Zigbee network
- Permit Join (60 s) + Auto-find target nodes
- Live node list with async `+JOIN` / `+LEAVE` events
- ZCL cluster control: On/Off, Level, Color (RGB→XY), Read/Write attribute, Raw ZCL command
- Attribute reports (`+ATTRREPORT`) update UI in real-time
- localStorage persistence for slot, node list, cluster state

### Key Commands (CFML:CFZB format)
| Action | Command |
|--------|----------|
| Start network | `CFML:CFZB:0:MODULE_START_NETWORK` |
| Stop network  | `CFML:CFZB:0:MODULE_STOP_NETWORK` |
| Net status    | `CFML:CFZB:0:MODULE_GET_NET_STATUS` |
| Permit join   | `CFML:CFZB:0:MODULE_SET_PERMIT_JOIN:60` |
| Auto-find     | `CFML:CFZB:0:MODULE_AUTO_FIND_TARGET` |
| On/Off        | `CFML:CFZB:0:MODULE_ZCL_SEND_CONTROL_CMD:<short>,<ep>,0006,<01\|00>` |
| Level         | `CFML:CFZB:0:MODULE_ZCL_SEND_CONTROL_CMD:<short>,<ep>,0008,04,<level>,0001` |
| Color XY      | `CFML:CFZB:0:MODULE_ZCL_SEND_CONTROL_CMD:<short>,<ep>,0300,08,<X>,<Y>,0001` |
| Read attr     | `CFML:CFZB:0:MODULE_ZCL_READ_ATTR:<short>,<ep>,<cluster>,<attrID>` |
| Write attr    | `CFML:CFZB:0:MODULE_ZCL_WRITE_ATTR:<short>,<ep>,<cluster>,<attrID,type,val>` |
| Delete node   | `CFML:CFZB:0:MODULE_DELETE_NODE:<short>` |

### Config bar
- **Stack slot**: ZB S1 (0) / ZB S2 (1)
- **Node Addr**: 4-hex short address of target node (auto-filled on select)
- **EP**: endpoint (default 01)
- **Cluster**: On/Off 0006 / Level 0008 / Color 0300 / Temp 0402 / Humidity 0405 / Basic 0000

---

## Widget 3: BLE GATT Test (`ble_gatt_test_widget.*`)

Test ESP32-C6 "DA2_TEST_GATT" GATT peripheral via STM32WB55 (stack_002).  
Service 0xFFF0 — FFF1: counter (READ+NOTIFY), FFF2: LED toggle (WRITE).

| Tab | File |
|-----|------|
| **HTML** | `ble_gatt_test_widget.html` |
| **CSS**  | `ble_gatt_test_widget.css` |
| **JS**   | `ble_gatt_test_widget.js` |

### Features
- BLE scan → device list → connect
- Auto service/characteristic discovery with handle auto-detection
- Enable/disable FFF1 notifications (live counter display)
- LED ON/OFF via FFF2 write
- Custom handle read + custom handle write
- Disconnect; reconnect from device list

### Key Commands (CFML:CFBL format)
| Action | Command |
|--------|----------|
| Scan        | `CFML:CFBL:0:AT+SCAN=5000` |
| Connect     | `CFML:CFBL:0:AT+CONNECT=<MAC>` |
| Disc svc    | `CFML:CFBL:0:AT+DISC=<idx>` |
| Disc chars  | `CFML:CFBL:0:AT+CHARS=<idx>,1,65535` |
| Enable CCCD | `CFML:CFBL:0:AT+NOTIFY=<idx>,<cccd>,1` |
| Read FFF1   | `CFML:CFBL:0:AT+READ=<idx>,0009` |
| LED ON      | `CFML:CFBL:0:AT+WRITE=<idx>,000C,01` |
| LED OFF     | `CFML:CFBL:0:AT+WRITE=<idx>,000C,00` |
| Disconnect  | `CFML:CFBL:0:AT+DISCONNECT=<idx>` |

### Config bar
- **Stack slot**: BLE S1 (0) / BLE S2 (1)
- **FFF1 Hdl**: default `0009`
- **CCCD Hdl**: default `000A`
- **FFF2 Hdl**: default `000C`  
  *(Handles auto-update after Discover if FFF1/FFF2 UUIDs found)*

---

## Common Import Steps (all 3 widgets)

### Step 1 — Create widget
1. **Widgets Library** → `+` → **Create new widget**
2. Widget type: **Control widget**

### Step 2 — Paste code
Paste the `.html`, `.css`, `.js` files into the corresponding HTML / CSS / JavaScript tabs.

### Step 3 — Dashboard setup
1. Add widget to Dashboard → **Entity**: your Gateway device
2. RPC method checked: **`sendCommand`**
3. Minimum size: **350 × 520 px**

### Step 4 — Rule chain (if not already done)
```
Incoming RPC "sendCommand"
    → MQTT forward to Gateway (topic: v1/devices/me/rpc/request/+)
    → Gateway parses CFML:<slot>:<cmd>
    → Routes to appropriate MCU LAN stack
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Commands have no response | Gateway online on ThingsBoard? RPC method `sendCommand` correct? |
| Zigbee: no `+JOIN` events | Permit Join sent? Node in pairing mode? |
| BLE: connect fails | Device in range? Not already paired to another central? |
| GATT handles wrong | Run Discover first; handles auto-detected from FFF1/FFF2 UUIDs |
| Counter not updating | Enable Notify via CCCD button after connecting |

---

# Tuya E27 Widget — (Legacy reference)



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
