# UI/UX Design — Total Application Test Widgets

## Mục tiêu

Thiết kế một cặp widget ThingsBoard mới cho bài toán **application test tổng hợp**:

1. `total_application_test_control`
2. `total_application_test_monitor`

Widget này dành cho **người dùng test ứng dụng** — không phải công cụ cấu hình hệ thống.
Không có tab Gateway config. Hệ thống giả định đã được cấu hình sẵn.

---

## Nguyên tắc thiết kế

1. **Chỉ test, không config hệ thống** — không có FOTA, server, internet settings trong widget này.
2. **Vai trò rõ ràng** — Control dùng tab theo giao thức; Monitor là mặt phẳng quan sát chung.
3. **Giữ ngôn ngữ UI hiện có** — header + status pill + dual-panel + console dock giống BLE/Zigbee widget.
4. **Ưu tiên luồng test thực tế** — thao tác ít bước, feedback ngay lập tức.
5. **Monitor phân loại thiết bị** — mỗi card phải có cả protocol badge và device type badge.

---

## Kiến trúc UX tổng thể

```
+---------------------------------------------------------------------+
|  total_application_test_control                                    |
|  [icon]  Total Application Test  *  BLE + Zigbee + LoRa P2P       |
|                                       [Slot v]  * Idle  [i]       |
|  -----------------------------------------------------------------  |
|  Tab bar:  [ BLE ]  [ Zigbee ]  [ LoRa P2P ]                       |
|  -----------------------------------------------------------------  |
|  Nội dung tab đang chọn — dual-panel layout                         |
|  Console log dock ---------------------------------------- [Clear] |
+---------------------------------------------------------------------+

+---------------------------------------------------------------------+
|  total_application_test_monitor                                    |
|  [icon]  Total Application Test Monitor  *  Live Device Overview   |
|  Filter: [All] [BLE] [Zigbee] [LoRa]  *  [All types] [Sensor]...  |
|  Card grid động — mỗi card là 1 thiết bị đang quan sát             |
+---------------------------------------------------------------------+
```

**Tab bar gồm 3 tab** (không có Test Flow):
```
[ BLE ]   [ Zigbee ]   [ LoRa P2P ]
```

---

## Thiết kế chi tiết — Control Widget

### Header

| Thành phần | Mô tả |
|-----------|-------|
| Title | `Total Application Test` |
| Subtitle | `BLE + Zigbee + LoRa P2P` |
| Slot selector | `[Stack 1 v]` — dùng chung cho tất cả tabs |
| Status pill | `Idle / Running / Warning / Error` |
| `[i]` | Query module info |

---

## Tab 1 — BLE

### Tổng quan

Giống hệt BLE GATT Application Test widget. Dual-panel: trái = scan results, phải = connected + detail.

### Bố cục

```
+--------------------------------------------------------------------+
|  BLE GATT              Stack [0 v]                * Idle  [Scan]  |
+---------------------+----------------------------------------------+
|  AVAILABLE DEVICES  |  CONNECTED DEVICES                    [0]   |
|  [0]                |  +----------+  +----------+  +----------+   |
|  ----------------   |  | 💡 LED_1 |  | 💡 LED_2 |  | 🌡 SEN_1 |   |
|  (scan results)     |  | * Online |  | * Online |  | * Online |   |
|                     |  +----------+  +----------+  +----------+   |
|  +---------------+  |  +----------+  +----------+                 |
|  | DA2_LED_1     |  |  | 🌡 SEN_2 |  | 🌡 SEN_3 |                 |
|  | -45dBm  💡    |  |  | * Online |  | * Stale  |                 |
|  | [Connect]     |  |  +----------+  +----------+                 |
|  +---------------+  |  ==========================================  |
|  | DA2_SENSOR_1  |  |  DEVICE DETAIL PANEL (node đang chọn)      |
|  | -52dBm  🌡    |  |                                             |
|  | [Connect]     |  |  (hiển thị LED panel HOẶC Sensor panel)    |
|  +---------------+  |                                             |
+---------------------+----------------------------------------------+
```

### Scan result item

Mỗi item trong danh sách Available Devices:
- Icon loại (💡 LED nếu tên bắt đầu `DA2_LED_`, 🌡 Sensor nếu `DA2_SENSOR_`)
- Tên thiết bị + MAC nhỏ
- Thanh RSSI (màu xanh → đỏ theo cường độ)
- Nút `[Connect]` → disabled + text `Connected ✓` nếu đã kết nối

### Connected device card (grid 3 cột)

- Icon loại (💡 / 🌡)
- Tên thiết bị (truncated)
- Badge `* Online` (xanh) / `* Offline` (đỏ)
- Click → mở detail panel bên dưới
- Selected card → viền highlight màu accent

---

### BLE — LED Detail Panel

**Kích hoạt khi**: chọn card thiết bị loại LED (service `0xFFF0`, tên `DA2_LED_*`)

**Protocol**: `CFBG:<slot>:WRITE:<idx>:<FFF2_handle>:<hex>`

```
+-----------------------------------------------------+
|  💡 DA2_LED_1                     [Disconnect ✕]   |
|  MAC: AA:BB:CC:DD:EE:FF    Handle FFF2: 0x000B     |
|  Trạng thái: [🟢 BẬT] / [⚫ TẮT]                  |
|                                                     |
|  Màu sắc:                                          |
|  [🔴 Đỏ]  [🟢 Xanh lá]  [🔵 Xanh dương]           |
|  [🟡 Vàng]  [⚪ Trắng]                              |
|                                                     |
|  [ ◉ BẬT ]        [ ○ TẮT ]                        |
+-----------------------------------------------------+
```

**Command mapping (hex payload cho FFF2)**:

| Nút | Payload | Mô tả |
|-----|---------|-------|
| BẬT | `01` (1 byte) | LED bật |
| TẮT | `00` (1 byte) | LED tắt |
| 🔴 Đỏ | `FF 00 00` (3 bytes) | RGB đỏ |
| 🟢 Xanh lá | `00 FF 00` | RGB xanh lá |
| 🔵 Xanh dương | `00 00 FF` | RGB xanh dương |
| 🟡 Vàng | `FF FF 00` | RGB vàng |
| ⚪ Trắng | `FF FF FF` | RGB trắng |

> Ghi chú: Gửi màu tự động bật LED (non-zero). Nút màu và BẬT/TẮT là độc lập.

---

### BLE — Sensor Detail Panel

**Kích hoạt khi**: chọn card thiết bị loại Sensor (service `0xAA10`, tên `DA2_SENSOR_*`)

**Protocol**: Nhận NOTIFY từ characteristic `AA11` (4 bytes: `temp_i16LE + hum_i16LE`, đơn vị 0.01)

```
+-----------------------------------------------------+
|  🌡 DA2_SENSOR_1                  [Disconnect ✕]   |
|  MAC: 11:22:33:44:55:66    CCCD (AA11): 0x000A     |
|                                                     |
|  +-------------------+  +-------------------+      |
|  |  🌡 Nhiệt độ      |  |  💧 Độ ẩm         |      |
|  |    25.6 °C        |  |    63.2 %         |      |
|  +-------------------+  +-------------------+      |
|                                                     |
|  Cập nhật lần cuối: 10:35:22   42 samples          |
|                                                     |
|  Interval:  [3 ▼] giây   [Apply Interval]          |
+-----------------------------------------------------+
```

**Interaction**:
1. Widget tự động enable NOTIFY trên AA11 CCCD sau khi connect + discover
2. Nhận NOTIFY liên tục → parse 4 bytes → hiển thị Temp/Hum
3. `[Apply Interval]` → ghi 1 byte interval (1–60s) vào characteristic `AA12`
   - Command: `CFBG:<slot>:WRITE:<idx>:<AA12_handle>:<hex_interval>`

---

### BLE — Interaction flow

```
1. [Scan] → CFBG:0:SCAN:5000
   RX: CFBG:OK:SCAN_DONE:<N>  +  SCAN_RESULT:<i>,<mac>,<rssi>,<name>
   → cập nhật Available Devices list

2. [Connect] → CFBG:0:CONNECT:<MAC>
   RX: CFBG:OK:CONNECTED:<idx>:0x<cid>:<MAC>
   → thêm vào grid, tự gửi DISC

3. Auto discover → CFBG:0:DISC:<idx>
   RX: CFBG:OK:DISC_DONE + CHAR:<idx>:0x<uuid>:0x<handle>
   → nhận dạng: FFF0 = LED, AA10 = Sensor
   → Sensor: tự enable NOTIFY trên AA11 CCCD
     CFBG:0:NOTIFY:<idx>:<cccd_handle>:1

4. Click LED card → LED detail panel
5. Click Sensor card → Sensor detail panel
   Nhận async: CFBG:OK:NOTIFY:<idx>:0x<handle>:<hex4bytes>
   → parse int16LE[0]/100 = Temp°C, int16LE[1]/100 = Hum%

6. [Disconnect ✕] → CFBG:0:DISCONNECT:<idx>
```

---

## Tab 2 — Zigbee

### Tổng quan

**Lưu ý quan trọng**: Firmware sử dụng E180-ZG120B ở chế độ **HEX (binary) mode**, không phải AT text mode.
Command format: `CFML:CFZB:<slot>:<FUNCTION_NAME>[:<params>]`

### Bố cục

```
+--------------------------------------------------------------------+
|  Zigbee Controller         Stack [1 v]              * OFF         |
+---------------------+----------------------------------------------+
|  NETWORK & NODES    |                                             |
|  [OFF]              |  [Zigbee hex icon]                          |
|  [▶ Start] [■ Stop] |                                             |
|  [* PJ 180s] [⊙ Find]|        <- Start network &                 |
|  [O Reset State]    |           select a node                     |
|  ----------------   |                                             |
|  NODES       [0]    |                                             |
|  (bắt đầu NW &      |                                             |
|   permit join)      |                                             |
+---------------------+----------------------------------------------+
```

### Network & Nodes panel (trái)

- **Network badge**: `* OFF` (đỏ) / `* Active CH:xx PAN:0xXXXX` (xanh)
- **Action chips**:
  - `[▶ Start]` → `MODULE_START_NETWORK`
  - `[■ Stop]` → `MODULE_STOP_NETWORK`
  - `[* PJ 180s]` → `MODULE_SET_PERMIT_JOIN:B4` (180s hex = 0xB4)
  - `[⊙ Find]` → `MODULE_AUTO_FIND_TARGET`
- **Reset State button** (đỏ, full width): xóa state + reset coordinator nếu cần
- **Node list** scrollable: mỗi node có icon + addr + type badge + trạng thái

### Node list item

```
+- - - - - - - - - - - - - - - - +
| 💡  bulb_1       0x1234   * Online |   ← click để chọn
| 🌡  sensor_1     0x5678   * Online |
| ?   Unknown      0x9ABC   * Stale  |
+- - - - - - - - - - - - - - - - +
```

**Nhận dạng loại node**:
- Model Identifier (ZCL Basic/0x0005) chứa `DATN_AUTH_KEY:<name>`
- Tên chứa `bulb` → LED/Bulb (💡)
- Tên chứa `sensor` → Sensor (🌡)
- Chưa đọc được → Unknown (?)

---

### Zigbee — Bulb Detail Panel

**Kích hoạt khi**: chọn node loại bulb (endpoint 0x0A, clusters 0006/0008/0300)

**Protocol**: `MODULE_ZCL_SEND_CONTROL_CMD:<short>,<ep>,<cluster>,<cmd>[,<params>]`

```
+------------------------------------------------------+
|  💡 bulb_1                           [Delete ✕]     |
|  Short: 0x1234   EP: 0x0A                           |
|  Model: DATN_AUTH_KEY:bulb_1                        |
|  Trạng thái: [🟢 BẬT] / [⚫ TẮT]                   |
|                                                      |
|  On/Off:                                            |
|  [ ◉ ON ]   [ ○ OFF ]   [ ↺ TOGGLE ]               |
|                                                      |
|  Độ sáng:                                           |
|  [  0%  ][  25%  ][  50%  ][  75%  ][ 100% ]       |
|                                                      |
|  Màu (XY):                                          |
|  [🔴 Đỏ] [🟢 Xanh] [🔵 Xanh dương] [⚪ Trắng]      |
|                                                      |
|  [🔄 Read Status]                                   |
+------------------------------------------------------+
```

**Command mapping**:

| Nút | Function | Params |
|-----|----------|--------|
| ON | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0006,01` |
| OFF | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0006,00` |
| TOGGLE | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0006,02` |
| 25% | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0008,04,3F,00,01,00` |
| 50% | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0008,04,7F,00,01,00` |
| 75% | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0008,04,BF,00,01,00` |
| 100% | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0008,04,FE,00,01,00` |
| 🔴 Đỏ | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0300,07,B3,74,32,78,0A,00` |
| 🟢 Xanh | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0300,07,30,2B,7A,C0,0A,00` |
| 🔵 Blue | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0300,07,14,CC,0A,55,0A,00` |
| ⚪ Trắng | `MODULE_ZCL_SEND_CONTROL_CMD` | `<short>,0A,0300,07,4C,2F,51,29,0A,00` |

> XY Color values lấy từ Arduino code `ESP32C6_Zigbee_Sensor.ino` — đây là native IEEE XY của E180.

**Read Status**: `MODULE_ZCL_READ_ATTR:<short>,0A,0006,0000` → đọc OnOff attribute

---

### Zigbee — Sensor Detail Panel

**Kích hoạt khi**: chọn node loại sensor (endpoint 0x0B, clusters 0402/0405)

**Lưu ý**: Node khởi động SILENT (không gửi report tự động). Widget phải gửi **Configure Reporting** để kích hoạt push telemetry.

```
+------------------------------------------------------+
|  🌡 sensor_1                         [Delete ✕]     |
|  Short: 0x5678   EP: 0x0B                           |
|  Model: DATN_AUTH_KEY:sensor_1                      |
|                                                      |
|  +------------------+  +------------------+         |
|  |  🌡 Nhiệt độ     |  |  💧 Độ ẩm        |         |
|  |    25.6 °C       |  |    63.2 %        |         |
|  +------------------+  +------------------+         |
|                                                      |
|  Cập nhật: 10:35:22    42 reports                   |
|                                                      |
|  Reporting:                                         |
|  Min [5 v]s  Max [60 v]s   [Configure Report]       |
|                                                      |
|  [🔄 Read Temp]   [🔄 Read Humidity]                 |
+------------------------------------------------------+
```

**Interaction flow**:

1. Widget tự động đọc Model Identifier sau khi node join:
   `MODULE_ZCL_READ_ATTR:<short>,0B,0000,0005`
   → verify `DATN_AUTH_KEY` → đánh dấu node verified
2. Sau verify, widget gửi Configure Reporting để bật push:
   - Temp: `MODULE_CONFIGURE_REPORT:<short>,0B,0402,0000,29,<min_s>,<max_s>,0064`
   - Hum:  `MODULE_CONFIGURE_REPORT:<short>,0B,0405,0000,21,<min_s>,<max_s>,0064`
3. Nhận async ZCL attribute report → hiển thị Temp/Hum
4. `[Read Temp]`: `MODULE_ZCL_READ_ATTR:<short>,0B,0402,0000`
5. `[Read Humidity]`: `MODULE_ZCL_READ_ATTR:<short>,0B,0405,0000`
6. `[Configure Report]`: áp dụng min/max interval đang chọn

---

### Zigbee — Interaction flow

```
1. [Start] → MODULE_START_NETWORK
   Async EVT: 0x80/0x02 NET_OPEN → badge chuyển Active

2. [PJ 180s] → MODULE_SET_PERMIT_JOIN:B4
   Async EVT: 0x80/0x03 NODE_JOIN(<mac>,<short>,<ep>)
   → thêm node vào list (Unknown)

3. Widget tự đọc Basic/0x0005 của node mới:
   MODULE_ZCL_READ_ATTR:<short>,<ep>,0000,0005
   → parse "DATN_AUTH_KEY:<name>" → nhận dạng loại node
   → Sensor: gửi Configure Reporting tự động
   → Bulb: không cần gì thêm, chờ user chọn

4. [Find] → MODULE_AUTO_FIND_TARGET
   → async 0x80/0x10 NOTIFY_FIND_BIND: short + ep + cluster
   → bind endpoint

5. User click node trong list → mở detail panel phải
```

---

## Tab 3 — LoRa P2P

### Quan trọng — Đây là P2P TEST mode, không phải LoRaWAN

Arduino node (`esp32c3_wioe5_p2p_node.ino`) sử dụng:
- `AT+MODE=TEST` — P2P test mode của Wio-E5
- `AT+TEST=TXLRPKT,"hex"` — gửi packet P2P
- `AT+TEST=RXLRPKT` — bật RX mode

Node có **2 chức năng**:
1. **Sensor**: gửi SENSOR_DATA (temp + hum) lên gateway sau mỗi cycle
2. **Actuator**: nhận LED ON/OFF command từ gateway, bật/tắt LED onboard

### Packet protocol (P2P binary)

| Loại packet | Byte[0] | Payload | Chiều |
|-------------|---------|---------|-------|
| JOIN_REQUEST | `0xFF` | `[0xFF, nodeId, seq]` (3B) | node → gateway |
| JOIN_ACCEPT | `0xFE` | `[0xFE, nodeId]` (2B) | gateway → node |
| SENSOR_DATA | `0x01` | `[0x01, nodeId, seq, tHi, tLo, hHi, hLo]` (7B) | node → gateway |
| LED_ON | `0x10` | `[0x10]` (1B) | gateway → node |
| LED_OFF | `0x11` | `[0x11]` (1B) | gateway → node |

**Sensor data decode**:
- `tHi, tLo` → `int16 = (tHi << 8) | tLo` → `/100.0` = °C
- `hHi, hLo` → `int16 = (hHi << 8) | hLo` → `/100.0` = %

### RF parameters phải match với Arduino node

```
#define P2P_FREQ   868    // MHz
#define P2P_SF     "SF7"
#define P2P_BW     125    // kHz
#define P2P_TXPR   12
#define P2P_RXPR   15
#define P2P_POW    14     // dBm
```

### Bố cục Tab LoRa P2P

```
+--------------------------------------------------------------------+
|  LoRa P2P                   Stack [1 v]        * Not in TEST mode  |
+----------------------------+---------------------------------------+
|  P2P CONFIGURATION         |  SENSOR NODE                        |
|  -----------------------   |  -----------------------------------  |
|  Frequency:  [868] MHz     |  Node ID: --     Status: * Waiting  |
|  SF:         [SF7 v]       |  Seq: --         Last uplink: --     |
|  BW:         [125 v] kHz   |                                     |
|  TX Power:   [14] dBm      |  +----------------+  +-----------+  |
|  TX Preamble:[12]          |  | 🌡 Temperature  |  | 💧 Hum    |  |
|  RX Preamble:[15]          |  |   25.6 °C      |  |  63.2 %   |  |
|                            |  +----------------+  +-----------+  |
|  [⚡ Enter TEST Mode]       |                                     |
|  [📡 Apply RF Config]      |  -----------------------------------  |
|                            |  LED CONTROL (Node GPIO 8)          |
|  -----------------------   |                                     |
|  RX WINDOW                 |  [💡 LED ON]     [⚫ LED OFF]        |
|  [▶ Start RX]  [■ Stop]    |                                     |
|                            |  Last TX: --                        |
|  -----------------------   |  Last RX: --                        |
|  MODULE INFO               |                                     |
|  Firmware: --              |                                     |
|  Mode: --                  |                                     |
|  RF: --                    |                                     |
|  [v Read Info]             |                                     |
+----------------------------+---------------------------------------+
```

### Left panel — P2P Configuration

**RF Config inputs** (pre-filled với giá trị mặc định từ Arduino code):

| Field | Default | Mô tả |
|-------|---------|-------|
| Frequency (MHz) | `868` | Phải match Arduino `P2P_FREQ` |
| SF | `SF7` dropdown | Phải match Arduino `P2P_SF` |
| BW (kHz) | `125` dropdown | Phải match Arduino `P2P_BW` |
| TX Power (dBm) | `14` | Phải match Arduino `P2P_POW` |
| TX Preamble | `12` | Phải match Arduino `P2P_TXPR` |
| RX Preamble | `15` | Phải match Arduino `P2P_RXPR` |

**Action buttons**:
- `[Enter TEST Mode]` → `CFML:CFLR:<slot>:MODULE_ENTER_P2P_MODE` — bắt buộc trước mọi P2P operation
- `[Apply RF Config]` → `CFML:CFLR:<slot>:MODULE_SET_P2P_CONFIG:<freq>,<sf>,<bw>,<txpr>,<rxpr>,<pow>,8,0` → status pill chuyển `* TEST Mode`

**RX Window**:
- `[Start RX]` → `CFML:CFLR:<slot>:MODULE_ENTER_P2P_RX` — bật RX mode, chờ packet từ node
- `[Stop RX]` → `CFML:CFLR:<slot>:MODULE_GET_INFO` — bất kỳ AT command nào sẽ thoát RX mode
- RX active badge nhấp nháy khi đang listen

**Module Info** (compact):
- Firmware, Mode, RF summary (chỉ đọc)
- `[Read Info]` → `CFML:CFLR:<slot>:MODULE_GET_INFO`

---

### Right panel — Sensor Node

**Node Status card**:
- `Node ID`: hiển thị nodeId nhận được từ JOIN_REQUEST
- `Status`: `* Waiting` / `* Joined` / `* Active`
- `Seq`: sequence number packet cuối
- `Last uplink`: timestamp packet cuối

**Sensor data** (decode từ SENSOR_DATA packet `0x01`):

```
+----------------------------+  +----------------------------+
|  🌡 Temperature             |  |  💧 Humidity               |
|    25.6 °C                 |  |    63.2 %                  |
|  Parse: tHi:tLo / 100      |  |  Parse: hHi:hLo / 100     |
+----------------------------+  +----------------------------+
```

Decode logic:
```
byte[0] = 0x01 (SENSOR_DATA)
byte[1] = nodeId
byte[2] = seq
byte[3] = tHi, byte[4] = tLo → temp = ((tHi << 8) | tLo) / 100.0
byte[5] = hHi, byte[6] = hLo → hum  = ((hHi << 8) | hLo) / 100.0
```

**LED Control**:
- `[💡 LED ON]`  → `CFML:CFLR:<slot>:MODULE_SEND_P2P_PKT:"10"` (hex byte 0x10 = LED_ON)
- `[⚫ LED OFF]` → `CFML:CFLR:<slot>:MODULE_SEND_P2P_PKT:"11"` (hex byte 0x11 = LED_OFF)
- Buttons disabled khi node chưa Joined

> Note: Widget tự quản lý TX/RX flow: `MODULE_GET_INFO` (thoát RX) → `MODULE_SEND_P2P_PKT` → `MODULE_ENTER_P2P_RX` (vào lại RX).

### LoRa P2P — Interaction flow đầy đủ

```
1. [Enter TEST Mode] → CFML:CFLR:<slot>:MODULE_ENTER_P2P_MODE
   RX: CFLR:<slot>:OK:+MODE: TEST
   → status pill: * TEST Mode

2. [Apply RF Config] → CFML:CFLR:<slot>:MODULE_SET_P2P_CONFIG:868,SF7,125,12,15,14,8,0
   RX: CFLR:<slot>:OK:+TEST: RFCFG ...
   → status pill: * Ready

3. [Start RX] → CFML:CFLR:<slot>:MODULE_ENTER_P2P_RX
   → widget enters RX listen mode
   → RX badge nhấp nháy

4. Node gửi JOIN_REQUEST [FF, 01, seq]:
   Async: CFLR:<slot>:EVT:+TEST: RXLRPKT <len>, <rssi>, <snr>, "FF0100"
   → Widget detect byte[0]=0xFF → JOIN_REQUEST
   → Widget gửi JOIN_ACCEPT [FE, nodeId]:
     CFML:CFLR:<slot>:MODULE_GET_INFO (thoát RX)
     CFML:CFLR:<slot>:MODULE_SEND_P2P_PKT:"FE01"
     CFML:CFLR:<slot>:MODULE_ENTER_P2P_RX (vào lại RX)
   → Status: * Joined  Node ID: 01

5. Node gửi SENSOR_DATA [01, nodeId, seq, tHi, tLo, hHi, hLo]:
   Async: CFLR:<slot>:EVT:+TEST: RXLRPKT <len>, <rssi>, <snr>, "01010001140003E8"
   → Widget decode → Temp = 0x0114/100 = 2.76°C... (tuỳ giá trị)
   → Cập nhật sensor cards

6. [LED ON]:
     CFML:CFLR:<slot>:MODULE_GET_INFO (thoát RX)
     CFML:CFLR:<slot>:MODULE_SEND_P2P_PKT:"10"
     CFML:CFLR:<slot>:MODULE_ENTER_P2P_RX (vào lại RX)
   [LED OFF]:
     CFML:CFLR:<slot>:MODULE_GET_INFO (thoát RX)
     CFML:CFLR:<slot>:MODULE_SEND_P2P_PKT:"11"
     CFML:CFLR:<slot>:MODULE_ENTER_P2P_RX (vào lại RX)
   → Node nhận, toggle LED GPIO8

7. Console log mọi TX/RX/EVT với timestamp
```

---

## Console chung

Dock cố định ở đáy, luôn hiển thị khi ở bất kỳ tab nào.

```
* * *  CONSOLE                                              [Clear]
[19:59:07] i  Widget ready
[20:00:01] TX  CFML:CFBG:0:SCAN:5000
[20:00:05] RX  CFBL:0:OK:SCAN_RESULT:0 AA:BB:CC:DD:EE:FF -45 DA2_LED_1
[20:01:10] TX  CFML:CFLR:1:MODULE_ENTER_P2P_MODE
[20:01:11] RX  CFLR:1:OK:+MODE: TEST
[20:01:12] TX  CFML:CFLR:1:MODULE_SET_P2P_CONFIG:868,SF7,125,12,15,14,8,0
[20:01:13] RX  CFLR:1:OK:+TEST: RFCFG ...
[20:01:14] TX  CFML:CFLR:1:MODULE_ENTER_P2P_RX
[20:01:20] EVT CFLR:1:EVT:+TEST: RXLRPKT 7, -45, 8, "FF010A"
[20:01:21] TX  CFML:CFLR:1:MODULE_GET_INFO
[20:01:21] TX  CFML:CFLR:1:MODULE_SEND_P2P_PKT:"FE01"
[20:01:22] TX  CFML:CFLR:1:MODULE_ENTER_P2P_RX
```

| Prefix | Màu | Ý nghĩa |
|--------|-----|---------|
| `TX` | trắng | Command gửi đi |
| `RX` | xanh lá nhạt | Response nhận về |
| `EVT` | xanh dương nhạt | Async event (NOTIFY, SENSOR, RX) |
| `i` | xám | Trạng thái nội bộ |
| `!` | vàng | Cảnh báo |
| `✕` | đỏ | Lỗi / timeout |

---

## Thiết kế — Monitor Widget

Monitor không có tab. Dùng filter chips để lọc.

```
+---------------------------------------------------------------------+
|  Total Application Test Monitor                            * Live  |
|  Shared monitor — BLE + Zigbee + LoRa P2P                         |
|  Proto: [All] [BLE] [Zigbee] [LoRa]                               |
|  Type:  [All types] [Sensor] [LED/Light] [P2P Node] [Unknown]     |
|  State: [All] [Live] [Stale] [Error]                               |
+---------------------------------------------------------------------+
|  [card]  [card]  [card]  [card]  ...                               |
+---------------------------------------------------------------------+
|  0 reports / 3 devices active                      10:35:22  Clear |
+---------------------------------------------------------------------+
```

### Sensor card (BLE / Zigbee)

```
+----------------------------------------------------+
|  BLE   🌡 Sensor   DA2_SENSOR_1             Live   |
|  MAC: AA:BB:CC:DD:EE:FF          Last: 10:35:22   |
|  --------------------------------------------------  |
|  Temperature        Humidity                       |
|    25.6 °C            63.2 %                       |
|  --------------------------------------------------  |
|  42 samples                                        |
+----------------------------------------------------+
```

### Actuator card (BLE LED / Zigbee Bulb)

```
+----------------------------------------------------+
|  Zigbee   💡 Bulb   bulb_1                  Live   |
|  0x1234 / EP:0A               Last: 10:34:10      |
|  --------------------------------------------------  |
|  State:   ON                                       |
|  Color:   Red (XY: B374,3278)                      |
|  Last cmd: Set Color Red                           |
+----------------------------------------------------+
```

### LoRa P2P Node card

```
+----------------------------------------------------+
|  LoRa P2P   📡 Sensor+LED   Node 0x01       Live   |
|  Slot: 1   RSSI: -45dBm    Last: 10:35:22         |
|  --------------------------------------------------  |
|  Temperature        Humidity                       |
|    25.6 °C            63.2 %                       |
|  --------------------------------------------------  |
|  LED State:   OFF                                  |
|  Seq: 42   Last join: 10:30:00                    |
+----------------------------------------------------+
```

**Lưu ý LoRa P2P card**: Node này là HYBRID (cả Sensor lẫn Actuator) nên card hiển thị cả sensor data và LED state.

### Stale state

- Card không biến mất — viền vàng + badge `Stale`.
- Timestamp giữ nguyên.

---

## Arduino Compatibility Analysis

### BLE — ESP32-S3 GATT Peripheral LED (`esp32s3_led_ble_gatt.ino`)

| Yêu cầu widget | Code Arduino | Kết quả |
|----------------|-------------|---------|
| Device name `DA2_LED_*` | `DEVICE_NAME "DA2_LED_GATT_2"` | ✅ |
| Service UUID `0xFFF0` | `SERVICE_UUID 0xFFF0` | ✅ |
| FFF2 WRITE 1 byte ON/OFF | `if (len == 1): applyLedOn/Off()` | ✅ |
| FFF2 WRITE 3 bytes RGB | `else if (len >= 3): applyColor(R,G,B)` | ✅ |
| NOTIFY echo qua FFF1 | `pendingLedNotify = true` → notify từ loop() | ✅ |
| RSSI trong scan result | Handled by gateway firmware BLE scan | ✅ |

**Kết luận BLE LED**: ✅ Hoàn toàn tương thích.

---

### BLE — ESP32-S3 GATT Sensor (`esp32s3_ble_gatt_sensor.ino`)

| Yêu cầu widget | Code Arduino | Kết quả |
|----------------|-------------|---------|
| Device name `DA2_SENSOR_*` | `snprintf(deviceName, ..., "DA2_SENSOR_%d", DEVICE_INDEX)` | ✅ |
| Service UUID `0xAA10` | `SERVICE_UUID 0xAA10` | ✅ |
| AA11 NOTIFY 4 bytes temp+hum | `temp*100 + hum*100` → i16LE pairs | ✅ |
| AA12 WRITE interval 1-60s | `CfgWriteCallback: notifyInterval = data[0]` (validate 1-60) | ✅ |
| Data unit: 0.01 | `d.temp = (int16_t)(temp * 100.0f)` | ✅ |
| Temperature range | 20-35°C sinusoidal + noise | ✅ |
| Humidity range | 40-80% sinusoidal + noise | ✅ |

**Kết luận BLE Sensor**: ✅ Hoàn toàn tương thích.

---

### Zigbee — ESP32-C6 Bulb (`E180_ZG120B_Test.ino` = ZigbeeColorBulb)

| Yêu cầu widget | Code Arduino / E180 | Kết quả |
|----------------|---------------------|---------|
| Endpoint 0x0A | `ZIGBEE_ENDPOINT 10` | ✅ |
| On/Off cluster 0x0006 | `ZigbeeColorDimmableLight` = includes 0x0006 | ✅ |
| Level cluster 0x0008 | Included in ColorDimmableLight | ✅ |
| Color XY cluster 0x0300 | `setLightColorCapabilities(HUE_SAT + XY)` | ✅ |
| XY values (Red, Green, Blue, White) | Documented trong sketch comment | ✅ |
| Model ID Auth Key | `"DATN_AUTH_KEY:bulb_1"` | ✅ |
| HEX mode commands | `MODULE_ZCL_SEND_CONTROL_CMD` | ✅ |
| Rejoin watchdog | `REJOIN_TIMEOUT_MS 10000` → factoryReset | ✅ |

**Kết luận Zigbee Bulb**: ✅ Hoàn toàn tương thích. Widget phải dùng XY color values từ sketch.

---

### Zigbee — ESP32-C6 Sensor (`ESP32C6_Zigbee_Sensor.ino`)

| Yêu cầu widget | Code Arduino | Kết quả |
|----------------|-------------|---------|
| Endpoint 0x0B | `ZIGBEE_EP_TEMP 11` | ✅ |
| Temp cluster 0x0402 | `ZigbeeTempSensor` | ✅ |
| Humidity cluster 0x0405 | `zbTempSensor.addHumiditySensor()` | ✅ |
| Model ID Auth Key | `"DATN_AUTH_KEY:sensor_1"` | ✅ |
| Silent by default | `DELTA_IMPOSSIBLE` prevents auto-reports | ✅ |
| Widget phải gửi Configure Reporting | Explicitly documented trong sketch | ✅ |
| Rejoin watchdog | `REJOIN_TIMEOUT_MS 10000` → factoryReset | ✅ |

**Kết luận Zigbee Sensor**: ✅ Tương thích. **Lưu ý quan trọng**: Widget PHẢI gửi Configure Reporting sau khi verify auth key, vì node không tự gửi report.

---

### LoRa P2P — ESP32-C3 Wio-E5 Node (`esp32c3_wioe5_p2p_node.ino`)

| Yêu cầu widget | Code Arduino | Kết quả |
|----------------|-------------|---------|
| P2P mode (không phải LoRaWAN) | `AT+MODE=TEST` + `AT+TEST=TXLRPKT` | ✅ |
| RF: 868MHz, SF7, 125kHz, 14dBm | `P2P_FREQ 868, SF7, BW 125, POW 14` | ✅ |
| Preamble: TX 12 / RX 15 | `P2P_TXPR 12, P2P_RXPR 15` | ✅ |
| JOIN_REQUEST 0xFF [nodeId, seq] | `PKT_JOIN_REQ 0xFF`, 3B payload | ✅ |
| JOIN_ACCEPT 0xFE [nodeId] | `PKT_JOIN_ACK 0xFE`, expects 2B | ✅ |
| SENSOR_DATA 0x01 [nodeId,seq,tHi,tLo,hHi,hLo] | `PKT_SENSOR 0x01`, 7B | ✅ |
| LED_ON 0x10 / LED_OFF 0x11 | `PKT_LED_ON 0x10, PKT_LED_OFF 0x11` | ✅ |
| LED onboard GPIO8 active LOW | `LED_PIN 8, LED_ON() = LOW` | ✅ |
| RX window sau mỗi TX | `p2pRxWindow(RX_WINDOW_MS=2000)` | ✅ |

**Lưu ý critical**: Widget phải quản lý TX/RX flow:
- Muốn TX → phải thoát RX mode trước (gửi `AT`)
- Sau TX → phải restart RX: `AT+TEST=RXLRPKT`
- Nếu không, node sẽ không nhận được LED command

**Kết luận LoRa P2P**: ✅ Tương thích. **Đây là P2P mode** — không phải LoRaWAN. Widget cũ (OTAA/ABP keys) không dùng được ở đây.

---

## Hard Constraints

1. **Không** có tab Gateway, form FOTA, server config.
2. **Không** có tab Test Flow — 3 tab protocol là đủ.
3. **Không** hiển thị OTAA/ABP keys trong LoRa tab — node dùng P2P TEST mode.
4. **Không** ẩn console — dock cố định ở đáy.
5. **Không** lấy total widget cũ làm base code.
6. LoRa tab phải quản lý TX/RX mode tự động — user không thấy flow này.

---

## Implementation Plan

**Thứ tự triển khai code khi sẵn sàng**:

1. HTML layout: header + tabbar (3 tabs) + tab panels + console dock
2. CSS: dark theme, dual-panel, card grid, console
3. BLE tab: dựa trên `ble_gatt_multi_widget.*`, wrap trong tab
4. Zigbee tab: dựa trên `zigbee_control_widget_v2.*`, wrap trong tab, đổi sang HEX mode commands
5. LoRa P2P tab: **dựng mới hoàn toàn** theo thiết kế P2P này
6. Monitor widget: header + filter + dynamic card grid (kế thừa pattern từ `zbm-*` và `mon-*`)

**Files**:
```
total_application_test_control.html / .css / .js
total_application_test_monitor.html / .css / .js
```
