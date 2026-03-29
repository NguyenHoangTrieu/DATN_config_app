# Tuya E27 LED Bulb — Full Command Reference
> Hai giao thức điều khiển song song: **BLE (STM32WB55 BLE Central)** và **Zigbee (STM32WB55 Coordinator)**

---

## Mục lục
1. [Tuya E27 — Tổng quan tính năng](#1-tuya-e27--tổng-quan-tính-năng)
2. [Giao thức BLE — STM32WB55 AT Commands](#2-giao-thức-ble--stm32wb55-at-commands)
3. [Giao thức Zigbee — STM32WB55 AT Commands](#3-giao-thức-zigbee--stm32wb55-at-commands)
4. [Tuya Private Protocol — Cấu trúc frame BLE](#4-tuya-private-protocol--cấu-trúc-frame-ble)
5. [ZCL Cluster Reference — Zigbee](#5-zcl-cluster-reference--zigbee)
6. [UI Interaction Flow](#6-ui-interaction-flow)
7. [Test Command Sequences](#7-test-command-sequences)

---

## 1. Tuya E27 — Tổng quan tính năng

| Tính năng           | BLE Path          | Zigbee Path              |
|---------------------|-------------------|--------------------------|
| Bật / Tắt           | DP 05 (bool)      | ZCL Cluster 0x0006       |
| Độ sáng (0–100%)    | DP 03 (value)     | ZCL Cluster 0x0008       |
| Nhiệt độ màu (CCT)  | DP 04 (value)     | ZCL Cluster 0x0300 Attr 0x0007 |
| Màu RGB / HSV       | DP 05 (string)    | ZCL Cluster 0x0300       |
| Chế độ màu          | DP 02 (enum)      | ZCL Cluster 0x0300       |

### UART Configuration

| Interface      | Baudrate | Data | Parity | Stop |
|----------------|----------|------|--------|------|
| BLE (LPUART1)  | **921600** | 8   | None   | 1    |
| Zigbee (UART)  | **115200** | 8   | None   | 1    |

---

## 2. Giao thức BLE — STM32WB55 AT Commands

> **Module**: STM32WB55 BLE Central (LPUART1: 921600 baud, 8N1)
> **Tham số `<idx>`**: Device index 0–7 từ scan list (NOT connection handle)

### 2.1 Module Lifecycle

| Lệnh              | Mô tả                              | Response                               | Timeout |
|-------------------|------------------------------------|----------------------------------------|---------|
| `AT`              | Echo test kiểm tra UART            | `OK`                                   | 1000 ms |
| `AT+RESET`        | Software reset module              | `OK`                                   | 2000 ms |
| `AT+HWRESET`      | Hardware reset (qua cơ chế HW)     | `OK`                                   | 2000 ms |
| `AT+FACTORY`      | Factory reset, xóa toàn bộ config  | `OK`                                   | 3000 ms |
| `AT+GETINFO`      | Lấy thông tin firmware & BLE stack | `+FW:<ver>` `+BLE:<ver>` `+BDADDR:<mac>` `+UPTIME:<ms>` `OK` | 1000 ms |
| `AT+SAVE`         | Lưu config vào NVM                 | `OK`                                   | 1000 ms |

**Ví dụ AT+GETINFO:**
```
>> AT+GETINFO
<< +FW:1.1.0
<< +BLE:STM32WB v1.13.0
<< +BDADDR:AA:BB:CC:DD:EE:FF
<< +UPTIME:123456 ms
<< OK
```

### 2.2 BLE Scan & Connect

| Lệnh                          | Mô tả                                               | Response                           | Timeout  |
|-------------------------------|-----------------------------------------------------|------------------------------------|----------|
| `AT+SCAN=<duration_ms>`       | Quét BLE (1–60000 ms)                               | `OK` rồi async `+SCAN:MAC,RSSI,name` | duration+2000 ms |
| `AT+STOP`                     | Dừng scan đang chạy                                 | `OK`                               | 1000 ms  |
| `AT+LIST`                     | Liệt kê tất cả device đã scan được                  | `+LIST:<n>` rồi `+DEV:<idx>,<MAC>,<RSSI>,<conn_hdl>,<name>` `OK` | 500 ms |
| `AT+CLEAR`                    | Xóa device list (không ảnh hưởng kết nối đang có)   | `OK`                               | 500 ms   |
| `AT+CONNECT=<MAC>`            | Kết nối tới MAC (phải scan trước)                   | `OK` → `+CONNECTING` → async `+CONNECTED:<idx>,<conn_hdl>` | 5000 ms |
| `AT+DISCONNECT=<idx>`         | Ngắt kết nối device theo **index** (0–7)             | `OK` → async `+DISCONNECTED:<conn_hdl>` | 2000 ms |
| `AT+INFO=<idx>`               | Lấy MAC của device theo index                       | `+INFO:<MAC>` `OK`                 | 500 ms   |
| `AT+STATUS[=<idx>]`           | Trạng thái kết nối (tất cả hoặc 1 device)           | `+STATUS:...` `OK`                 | 500 ms   |
| `AT+DIAG=<idx>`               | Thông tin debug: RSSI, conn_handle, TX power        | `+DIAG:...` `OK`                   | 500 ms   |

**Ví dụ scan và kết nối:**
```
>> AT+SCAN=5000
<< OK
<< +SCAN:AA:BB:CC:DD:EE:FF,-65,TuyaSmartLED_E27
<< +SCAN:11:22:33:44:55:66,-72,Unknown

>> AT+LIST
<< +LIST:2
<< +DEV:0,AA:BB:CC:DD:EE:FF,-65,0xFFFF,TuyaSmartLED_E27
<< +DEV:1,11:22:33:44:55:66,-72,0xFFFF,Unknown
<< OK

>> AT+CONNECT=AA:BB:CC:DD:EE:FF
<< OK
<< +CONNECTING
<< +CONNECTED:0,0x0001
```

> **Lưu ý**: `AT+CONNECT` yêu cầu device phải có trong scan list. Chạy `AT+SCAN` trước.

### 2.3 GATT Discovery (tìm Service & Characteristic handle)

Tuya E27 BLE sử dụng:
- **Service UUID**: `1910`
- **Write Characteristic (cmd)**: `2B11` — handle tìm qua `AT+DISC`
- **Notify Characteristic (rsp)**: `2B10` — CCCD handle = char_handle + 1

| Lệnh                                     | Mô tả                                                   | Response | Timeout |
|------------------------------------------|---------------------------------------------------------|----------|---------|
| `AT+DISC=<idx>`                          | Discover services & chars của device theo **index**     | `OK` → async `+SERVICE:` và `+CHAR:` | 5000 ms |
| `AT+NOTIFY=<idx>,<cccd_hdl>,<1\|0>`     | Enable/disable notify CCCD của device theo **index**    | `OK`     | 1000 ms |
| `AT+READ=<idx>,<handle>`                  | Read characteristic value                               | `OK` → async `+READ:<conn_hdl>,<handle>,<hex>` | 1000 ms |

**Response format của AT+DISC:**
```
>> AT+DISC=0
<< OK
<< +NAME:TuyaSmartLED_E27
<< +SERVICE:0x0001,0x0001,1800
<< +SERVICE:0x0001,0x000B,1910
<< +CHAR:0x0001,0x000D,2B10
<< +CHAR:0x0001,0x000E,2B11
```

**Enable notify và nhận event:**
```
>> AT+NOTIFY=0,0x000F,1
<< OK
[... khi đèn gửi status report ...]
<< +NOTIFICATION:0x0001,0x000E,55AA...
```

> **Note:** Handle `0x000E` (char 2B11) là mặc định trong JSON config. Luôn verify lại bằng `AT+DISC=0` sau mỗi lần re-pair vì handle có thể thay đổi.

### 2.4 LED Power Control

| Lệnh (AT+WRITE)                                                   | Mô tả    |
|-------------------------------------------------------------------|----------|
| `AT+WRITE=0,0x000E,55AA00010006000501010001010F` | LED **ON**  |
| `AT+WRITE=0,0x000E,55AA00020006000501010001000E` | LED **OFF** |

> `AT+WRITE=<dev_idx>,<char_handle>,<hex_data>` — `dev_idx=0` là device index 0 trong scan list

### 2.5 Brightness Control

| Lệnh (AT+WRITE)                                                                 | Mô tả              |
|---------------------------------------------------------------------------------|--------------------|
| `AT+WRITE=0,0x000E,55AA00030006000803020004000003E819`                     | Brightness **100%** (0x03E8) |
| `AT+WRITE=0,0x000E,55AA00040006000803020004000001F40C`                     | Brightness **50%**  (0x01F4) |
| `AT+WRITE=<dev_idx>,<char_hdl>,55AA00<seq>0006000803020004<value_4B_BE><crc>` | Brightness **custom** |

**Custom brightness format:**
```
value range : 0x0000 (0%) – 0x03E8 (100%)
seq         : increment per command (00, 01, 02, ...)
crc         : sum(ver..last_data_byte) mod 256
```

**Ví dụ — Brightness 25%:**
```
value = 0x0000FA (250 / 1000 = 25%)
>> AT+WRITE=0,0x000E,55AA0005000600080302000400_0000FA_XX
```

### 2.6 Color Temperature (White Mode)

| Lệnh (AT+WRITE)                                                                    | Mô tả                          |
|------------------------------------------------------------------------------------|--------------------------------|
| `AT+WRITE=0,0x000E,55AA00060006000804020004000000002400`                      | Color Temp **WARM** (0x0000)   |
| `AT+WRITE=0,0x000E,55AA00070006000804020004000003E82C`                        | Color Temp **COOL** (0x03E8)   |
| `AT+WRITE=<dev_idx>,<char_hdl>,55AA00<seq>0006000804020004<value_4B_BE><crc>` | Color Temp **custom** |

```
CCT range: 0x0000 (warm ~2700K) – 0x03E8 (cool ~6500K)
```

### 2.7 RGB / Color Mode

| Lệnh (AT+WRITE)                                                                    | Mô tả                        |
|------------------------------------------------------------------------------------|------------------------------|
| `AT+WRITE=0,0x000E,55AA00080006000502040001011B`                              | Enable **Color (HSV) mode** (DP mode = colour) |
| `AT+WRITE=0,0x000E,55AA000800060005020400010000`                              | White mode (DP mode = white) |
| `AT+WRITE=0,0x000E,55AA00090006000C0503000830303030363436343739`              | Color **RED** preset (HSV=000, 100%, 1000) |
| `AT+WRITE=<dev_idx>,<char_hdl>,55AA00<seq>0006000C050300<hsv_hex_12B><crc>`   | Custom **HSV color** |

**Custom HSV format (DP 05 = 12-byte hex string):**
```
HSV encoding : HHHHSSSSVVVV  (hue 4, sat 4, val 4 — ASCII hex digits = 12 bytes payload)
Hue          : 0000–016D (0–365°)
Saturation   : 0000–03E8 (0–100%)
Value/Bright : 0000–03E8 (0–100%)

Example — GREEN (H=120°, S=100%, V=80%):
  hue = 0x0078 = "0078"
  sat = 0x03E8 = "03E8"  
  val = 0x0320 = "0320"
  → HSV string: "007803E80320"
  → bytes: 30 30 37 38 30 33 45 38 30 33 32 30
```

---

## 3. Giao thức Zigbee — STM32WB55 AT Commands

### 3.1 Module Lifecycle

| Lệnh            | Mô tả                             | Response    | Timeout |
|-----------------|-----------------------------------|-------------|---------|
| *(GPIO P01 LOW 100ms → HIGH 500ms)* | Hardware reset        | —           | 500 ms  |
| `AT+ZB_RESET`   | Software reset coordinator        | `OK`        | 3000 ms |
| `AT+ZB_INFO`    | Đọc thông tin module (channel, PAN_ID, IEEE) | `+ZB_INFO:` | 2000 ms |
| `AT`            | Echo test (kiểm tra UART)          | `OK`        | 1000 ms |

**Response format của AT+ZB_INFO:**
```
+ZB_INFO: CHANNEL=11,PANID=0xABCD,IEEE=00:11:22:33:44:55:66:77,TYPE=COORDINATOR
OK
```

### 3.2 Network Formation & Management

| Lệnh                        | Mô tả                                  | Response      | Timeout |
|-----------------------------|----------------------------------------|---------------|---------|
| `AT+ZB_START`               | Khởi động Zigbee coordinator network   | `OK`          | 5000 ms |
| `AT+ZB_RESET`               | Dừng network (coordinator reset)       | `OK`          | 3000 ms |
| `AT+ZB_PERMIT=<duration>`   | Cho phép thiết bị join trong N giây    | `OK`          | 2000 ms |
| `AT+ZB_PERMIT=0`            | Tắt permit join                        | `OK`          | 2000 ms |
| `AT+ZB_LIST`                | Liệt kê tất cả thiết bị đã kết nối     | `OK`          | 2000 ms |

**Ví dụ khởi động network và pair thiết bị:**
```
>> AT+ZB_RESET
<< OK
>> AT+ZB_START
<< OK
>> AT+ZB_PERMIT=60
<< OK
--- (reset Tuya E27 để enter pairing mode) ---
<< +ZB_JOIN: SHORT=0x1234,IEEE=AA:BB:CC:DD:EE:FF:00:11,MODEL=TS0505B
```

### 3.3 Node Discovery

| Lệnh                          | Mô tả                              | Response      | Timeout |
|-------------------------------|------------------------------------|---------------|---------|
| `AT+ZB_GETNODE=<short_addr>`  | Lấy descriptor của node            | `+NODE:`      | 2000 ms |
| `AT+ZB_GETEP=<short_addr>`    | Lấy danh sách endpoint của node    | `+ENDPOINTS:` | 2000 ms |
| `AT+ZB_LIST`                  | Liệt kê toàn bộ joined devices     | `OK`          | 2000 ms |

**Ví dụ:**
```
>> AT+ZB_GETNODE=0x1234
<< +NODE: SHORT=0x1234,IEEE=AA:BB:CC:DD:EE:FF:00:11

>> AT+ZB_GETEP=0x1234
<< +ENDPOINTS: SHORT=0x1234,EP=[01,0A]
```

> **Tuya E27 (Zigbee) thường dùng endpoint 01.**

### 3.4 LED Power Control (ZCL Cluster 0x0006 — On/Off)

| Lệnh                             | Mô tả            |
|----------------------------------|------------------|
| `AT+ZCL_ONOFF=<addr>,01,1`       | LED **ON**       |
| `AT+ZCL_ONOFF=<addr>,01,0`       | LED **OFF**      |
| `AT+ZCL_ONOFF=<addr>,01,2`       | **Toggle** ON/OFF |

**Response:** `OK` (3000 ms timeout)

**Ví dụ:**
```
>> AT+ZCL_ONOFF=0x1234,01,1
<< OK
>> AT+ZCL_ONOFF=0x1234,01,0
<< OK
```

### 3.5 Brightness Control (ZCL Cluster 0x0008 — Level Control)

| Lệnh                                 | Mô tả                          |
|--------------------------------------|--------------------------------|
| `AT+ZCL_LEVEL=<addr>,01,<level>`     | Set brightness (0–254)         |
| `AT+ZCL_READ=<addr>,01,0008,0000`    | Đọc current level              |

```
level range: 0 (0%) – 254 (100%)
Ví dụ 50% : AT+ZCL_LEVEL=0x1234,01,127
Ví dụ 100%: AT+ZCL_LEVEL=0x1234,01,254
```

### 3.6 Color Temperature (ZCL Cluster 0x0300 — Attribute 0x0007)

| Lệnh                                             | Mô tả                           |
|--------------------------------------------------|---------------------------------|
| `AT+ZCL_COLORTEMP=<addr>,01,<mired>`             | Set CCT theo Mired              |
| `AT+ZCL_READ=<addr>,01,0300,0007`                | Đọc current color temp          |

```
Mired = 1,000,000 / Kelvin
Warm 2700K → mired = 370
Cool 6500K → mired = 154

Ví dụ warm: AT+ZCL_COLORTEMP=0x1234,01,370
Ví dụ cool: AT+ZCL_COLORTEMP=0x1234,01,154
```

### 3.7 RGB Color Control (ZCL Cluster 0x0300 — Hue/Saturation)

| Lệnh                                   | Mô tả                          |
|----------------------------------------|--------------------------------|
| `AT+ZCL_COLOR=<addr>,01,<hue>,<sat>`   | Set Hue (0–254) + Saturation (0–254) |
| `AT+ZCL_READ=<addr>,01,0300,0000`      | Đọc current hue                |
| `AT+ZCL_READ=<addr>,01,0300,0001`      | Đọc current saturation         |

```
Hue       : 0 (0°) – 254 (360°)
Saturation: 0 (0%) – 254 (100%)

Màu đỏ  (H=0°  , S=100%): AT+ZCL_COLOR=0x1234,01,0,254
Màu xanh lá (H=120°, S=100%): AT+ZCL_COLOR=0x1234,01,84,254
Màu xanh biển (H=240°, S=100%): AT+ZCL_COLOR=0x1234,01,169,254
```

### 3.8 ZCL Attribute Read/Write (generic)

| Lệnh                                                  | Mô tả                             |
|-------------------------------------------------------|-----------------------------------|
| `AT+ZCL_READ=<addr>,<ep>,<cluster>,<attr>`            | Đọc attribute                     |
| `AT+ZCL_WRITE=<addr>,<ep>,<cluster>,<attr>,<type>,<val>` | Ghi attribute                  |

**Ví dụ đọc on/off state:**
```
>> AT+ZCL_READ=0x1234,01,0006,0000
<< +ZCL_READ: VALUE=01
<< OK
```

---

## 4. Tuya Private Protocol — Cấu trúc frame BLE

```
Frame format:
┌────────┬─────────┬─────────┬────────────┬──────────── ~ ─────────┬──────────┐
│ 55 AA  │  VER    │  SEQ    │  LEN (2B)  │  PAYLOAD (LEN bytes)   │   CRC    │
│header  │ 1 byte  │ 1 byte  │            │  DP frames             │  1 byte  │
└────────┴─────────┴─────────┴────────────┴──────────── ~ ─────────┴──────────┘

CRC = sum(VER, SEQ, LEN[0], LEN[1], PAYLOAD...) mod 256

PAYLOAD (DP frame format):
┌─────────────┬─────────┬─────────────┬────────────────────────┐
│  DP_ID (2B) │ TYPE(1B)│ VAL_LEN(2B) │     VALUE (VAL_LEN B)  │
└─────────────┴─────────┴─────────────┴────────────────────────┘

TYPE values:
  0x01 = raw
  0x02 = bool (1 byte: 0x00 or 0x01)
  0x03 = value (4 bytes, big-endian signed int)
  0x04 = string
  0x05 = enum (1 byte)
  0x06 = bitmap
```

### DP Map của Tuya E27 (model TS0505B / tương tự)

| DP ID | Tên         | Type  | Range / Values             | Mô tả                    |
|-------|-------------|-------|----------------------------|--------------------------|
| 0x05  | switch      | bool  | 0x00=OFF, 0x01=ON          | Bật/tắt đèn              |
| 0x02  | mode        | enum  | 0x00=white, 0x01=colour    | Chế độ màu               |
| 0x03  | brightness  | value | 0x0000–0x03E8 (0–1000)     | Độ sáng                  |
| 0x04  | color_temp  | value | 0x0000–0x03E8 (warm–cool)  | Nhiệt độ màu (CCT)       |
| 0x05  | color       | string| HHHHSSSSVVVV (12 hex chars)| Màu HSV                  |

### Pre-built frames đầy đủ

| Chức năng           | Frame (hex)                                              |
|---------------------|----------------------------------------------------------|
| LED ON              | `55AA00010006000501010001010F`                           |
| LED OFF             | `55AA00020006000501010001000E`                           |
| Brightness 100%     | `55AA00030006000803020004000003E819`                     |
| Brightness 50%      | `55AA00040006000803020004000001F40C`                     |
| Color Temp WARM     | `55AA00060006000804020004000000002400`                   |
| Color Temp COOL     | `55AA00070006000804020004000003E82C`                     |
| Enable Color Mode   | `55AA00080006000502040001011B`                           |
| Color RED           | `55AA00090006000C0503000830303030363436343739`            |

---

## 5. ZCL Cluster Reference — Zigbee

### Clusters sử dụng cho Tuya E27

| Cluster ID | Cluster Name            | Attributes quan trọng                                     |
|------------|-------------------------|-----------------------------------------------------------|
| `0x0000`   | Basic                   | `0x0000`=ZCL version, `0x0004`=Manufacturer, `0x0005`=ModelID |
| `0x0006`   | On/Off                  | `0x0000`=OnOff (bool)                                     |
| `0x0008`   | Level Control           | `0x0000`=CurrentLevel (0–254)                             |
| `0x0300`   | Color Control           | `0x0000`=CurrentHue, `0x0001`=CurrentSaturation, `0x0007`=ColorTemperatureMireds |

### ZCL Command Codes (Cluster 0x0006 — On/Off)

| Code | Command  | Mô tả        |
|------|----------|--------------|
| `0`  | Off      | Tắt đèn      |
| `1`  | On       | Bật đèn      |
| `2`  | Toggle   | Đảo trạng thái |

### ZCL Attribute Types

| Type Code | Tên        | Kích thước |
|-----------|------------|------------|
| `0x10`    | Boolean    | 1 byte     |
| `0x20`    | uint8      | 1 byte     |
| `0x21`    | uint16     | 2 bytes    |
| `0x22`    | uint24     | 3 bytes    |
| `0x23`    | uint32     | 4 bytes    |

---

## 6. UI Interaction Flow

### UI Layout (ThingBoard Custom Dashboard — Tuya E27)

```
┌──────────────────────────────────────────────────────┐
│  Tuya E27 LED Controller                    [●] CONN │
├──────────────┬───────────────────────────────────────┤
│ Device       │  Short Address: 0x1234  (Zigbee)      │
│ Selection    │  MAC: AA:BB:CC:DD:EE:FF  (BLE)        │
│  [Dropdown]  │  Status: ● Online                     │
├──────────────┴───────────────────────────────────────┤
│                  POWER                                │
│          [ ON ]           [ OFF ]                    │
├───────────────────────────────────────────────────────┤
│  Brightness      0%▐████████████▌100%                │
│                  [slider 0–100]           [ 50% BTN ]│
├───────────────────────────────────────────────────────┤
│  Color Mode:  ● White   ○ Color                      │
│                                                       │
│  [WHITE MODE]                                        │
│  Warm 2700K ▐██████░░░░░░░░░░░░░░░▌ Cool 6500K      │
│             [slider CCT 2700–6500K]                  │
│                                                       │
│  [COLOR MODE]                                        │
│  Hue:        ▐██████░░░░░░░░░░░░░░▌  [Color Wheel]  │
│  Saturation: ▐████████████░░░░░░░░▌                  │
├───────────────────────────────────────────────────────┤
│  Quick Colors:  🔴  🟢  🔵  🟡  🟣  ⚪               │
├───────────────────────────────────────────────────────┤
│  Manual ZCL Command:                                  │
│  [ AT+ZCL_ONOFF=0x1234,01,1____________ ] [SEND]     │
└───────────────────────────────────────────────────────┘
```

### Button → Command Mapping

| UI Element          | BLE Command                              | Zigbee Command                        |
|---------------------|------------------------------------------|---------------------------------------|
| [ON] button         | `AT+WRITE=0,0x000E,55AA...(LED ON)`     | `AT+ZCL_ONOFF=<addr>,01,1`            |
| [OFF] button        | `AT+WRITE=0,0x000E,55AA...(LED OFF)`    | `AT+ZCL_ONOFF=<addr>,01,0`            |
| Brightness slider   | `AT+WRITE=...,55AA...(BRIGHTNESS custom)` | `AT+ZCL_LEVEL=<addr>,01,<0-254>`    |
| CCT slider          | `AT+WRITE=...,55AA...(COLOR TEMP custom)`| `AT+ZCL_COLORTEMP=<addr>,01,<mired>`|
| Hue+Sat sliders     | `AT+WRITE=...,55AA...(HSV custom)`       | `AT+ZCL_COLOR=<addr>,01,<hue>,<sat>`|
| 🔴 RED button       | `AT+WRITE=...,55AA...(RED preset)`       | `AT+ZCL_COLOR=0x1234,01,0,254`       |
| 🟢 GREEN button     | `AT+WRITE=...(HSV 0078,03E8,03E8)`       | `AT+ZCL_COLOR=0x1234,01,84,254`      |
| 🔵 BLUE button      | `AT+WRITE=...(HSV 00A9,03E8,03E8)`       | `AT+ZCL_COLOR=0x1234,01,169,254`     |
| 🟡 YELLOW button    | `AT+WRITE=...(HSV 003C,03E8,03E8)`       | `AT+ZCL_COLOR=0x1234,01,42,254`      |
| ⚪ WHITE button     | `AT+WRITE=...(WHITE mode DP02=0x00)`     | `AT+ZCL_COLORTEMP=0x1234,01,250`     |

---

## 7. Test Command Sequences

### 7.1 BLE — Full connect & control sequence

```bash
# 1. Scan tìm đèn
AT+SCAN=5000

# 2. Kết nối
AT+CONNECT=AA:BB:CC:DD:EE:FF

# 3. Discover services để lấy char handle
AT+DISC=0

# 4. Enable notify (CCCD handle = char 2B10 handle + 1)
AT+NOTIFY=0,0x000F,1

# 5. Bật đèn
AT+WRITE=0,0x000E,55AA00010006000501010001010F

# 6. Set brightness 75% (value = 0x02EE = 750/1000)
AT+WRITE=0,0x000E,55AA0002000800030200040000_02EE_XX

# 7. Set color temp cool (6500K)
AT+WRITE=0,0x000E,55AA00070006000804020004000003E82C

# 8. Enable màu RGB
AT+WRITE=0,0x000E,55AA00080006000502040001011B

# 9. Set màu đỏ (pre-built)
AT+WRITE=0,0x000E,55AA00090006000C0503000830303030363436343739

# 10. Tắt đèn
AT+WRITE=0,0x000E,55AA00020006000501010001000E

# 11. Ngắt kết nối (idx=0)
AT+DISCONNECT=0
```

### 7.2 Zigbee — Full network & control sequence

```bash
# 1. Khởi động coordinator
AT+ZB_RESET
AT+ZB_START

# 2. Lấy thông tin network
AT+ZB_INFO

# 3. Cho phép pair 60 giây
AT+ZB_PERMIT=60

# --- Reset Tuya E27 để vào pairing mode (nhấn nháy 3 lần) ---
# << +ZB_JOIN: SHORT=0x1234,IEEE=AA:BB:CC:DD:EE:FF:00:11

# 4. Kiểm tra endpoint
AT+ZB_GETEP=0x1234

# 5. Tắt permit join
AT+ZB_PERMIT=0

# 6. Bật đèn
AT+ZCL_ONOFF=0x1234,01,1

# 7. Đặt brightness 80% (level = 203 / 254)
AT+ZCL_LEVEL=0x1234,01,203

# 8. Set màu warm (2700K → 370 Mired)
AT+ZCL_COLORTEMP=0x1234,01,370

# 9. Set màu RGB: xanh lá (H=120°=84, S=100%=254)
AT+ZCL_COLOR=0x1234,01,84,254

# 10. Đọc trạng thái hiện tại
AT+ZCL_READ=0x1234,01,0006,0000
AT+ZCL_READ=0x1234,01,0008,0000
AT+ZCL_READ=0x1234,01,0300,0007

# 11. Tắt đèn
AT+ZCL_ONOFF=0x1234,01,0
```

### 7.3 Quick reference — Common color values

| Màu        | BLE (HSV hex string) | Zigbee Hue (0–254) | Zigbee Sat |
|------------|----------------------|--------------------|------------|
| Đỏ         | `000003E803E8`        | 0                  | 254        |
| Cam        | `001E03E803E8`        | 21                 | 254        |
| Vàng       | `003C03E803E8`        | 42                 | 254        |
| Xanh lá    | `007803E803E8`        | 84                 | 254        |
| Cyan       | `00B403E803E8`        | 127                | 254        |
| Xanh biển  | `00A903E803E8`        | 169                | 254        |
| Tím        | `00C803E803E8`        | 212                | 254        |
| Hồng       | `00E703E803E8`        | 240                | 254        |
| Trắng ấm   | Color temp → 0x0000  | CCT Mired = 370    | —          |
| Trắng lạnh | Color temp → 0x03E8  | CCT Mired = 154    | —          |

---

*File này được tạo ngày 2026-03-18. Tham khảo `tuya_e27_stm32wb55.json` (BLE config) và `stack_005_config.json` / `stack_005_app_commands.json` (Zigbee config).*
