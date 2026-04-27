# Báo Cáo Kiểm Thử Mạng Zigbee & LoRa — DA2 Gateway

> **Phạm vi:** DA2_esp_LAN firmware · ThingsBoard widgets · Arduino testcode  
> **Ngày:** 2026-04-15

---

## Tổng quan kiến trúc

```
[ThingsBoard Dashboard]
        │  RPC method: sendCommand  (payload HEX)
        ▼
[ThingsBoard Rule Chain]  ─MQTT─►  topic: v1/devices/me/rpc/request/+
        │
        ▼
[DA2 Gateway — ESP32-S3]
  ┌─────────────────────────────────────────────────────────────┐
  │  MCU_WAN_Handler  ← giải mã frame CFML:CF<XX>:<slot>:<cmd> │
  │        │                                                     │
  │  ┌─────┴──────────────────┐                                 │
  │  │  Config_Handler         │  (phân tích JSON config)        │
  │  └─────┬──────────────────┘                                 │
  │        │  enqueue command_request                            │
  │  ┌─────▼──────────────────┐  ┌──────────────────────────┐  │
  │  │  zigbee_handler_task   │  │  lora_handler_task        │  │
  │  │  (3 FreeRTOS tasks/stack)│  │  (3 FreeRTOS tasks/stack) │  │
  │  └─────┬──────────────────┘  └──────────┬───────────────┘  │
  │        │ UART                             │ UART             │
  └────────┼─────────────────────────────────┼──────────────────┘
           ▼                                 ▼
  [E180-ZG120B — AT coord]        [RAK3172 — LoRaWAN OTAA]
           │                                 │
     [ESP32-C6 nodes]               [Arduino Uno R4 + WioE5]
```

---

## 1. ThingsBoard Widget — Vai trò & Chi tiết

### 1.1 Zigbee Control Widget (`zigbee_control_widget_v2.*`)

**File:** `DATN_config_app/thingsboard_widget test/zigbee_control_widget_v2.{html,css,js}`

**Vai trò:** Giao diện điều khiển toàn bộ mạng Zigbee từ dashboard ThingsBoard. Widget đóng vai trò "remote controller" hoàn chỉnh — từ quản lý mạng tới điều khiển thiết bị đầu cuối qua ZCL, tất cả trong một trang web nhúng.

#### Giao thức truyền thông

| Chiều | Cơ chế | Format |
|-------|--------|--------|
| Downlink (widget → gateway) | RPC `sendTwoWayCommand("sendCommand", hexPayload)` | `CFML:CFZB:<slot>:<function_or_AT_cmd>` → encode HEX |
| Uplink (gateway → widget) | ThingsBoard telemetry key `onDataUpdated` | HEX chuỗi ASCII → decode → parse từng dòng `\x1E` |

#### Tính năng chính

| Tab / Nhóm | Lệnh widget | Lệnh gateway tương ứng |
|------------|-------------|------------------------|
| Network Start | `startNetwork()` | `CFML:CFZB:0:MODULE_START_NETWORK` → `AT+CREATENW` |
| Network Stop | `stopNetwork()` | `CFML:CFZB:0:MODULE_LEAVE_NETWORK` → `AT+QUITNW` |
| Network Status | `queryNetStatus()` | `CFML:CFZB:0:MODULE_GET_NET_STATUS` → `AT+NWINFO` |
| Permit Join | `openPermitJoin()` | `CFML:CFZB:0:MODULE_SET_PERMIT_JOIN:60` → `AT+OPENWNET=60` |
| Auto-find nodes | `autoFind()` | `CFML:CFZB:0:MODULE_AUTO_FIND_TARGET` |
| Delete node | `deleteNode(addr)` | `CFML:CFZB:0:MODULE_DELETE_NODE:<short>` |
| **ZCL On/Off** | `sendOnOff(1/0)` | `CFML:CFZB:0:MODULE_ZCL_SEND_CONTROL_CMD:<short>,<ep>,0006,01\|00` |
| **ZCL Level** | `sendLevel(val)` | `CFML:CFZB:0:MODULE_ZCL_SEND_CONTROL_CMD:<short>,<ep>,0008,04,<level>,0001` |
| **ZCL Color XY** | `sendColorXY(x,y)` | `CFML:CFZB:0:MODULE_ZCL_SEND_CONTROL_CMD:<short>,<ep>,0300,08,<X>,<Y>,0001` |
| Read attribute | `readAttr()` | `CFML:CFZB:0:MODULE_ZCL_READ_ATTR:<short>,<ep>,<cluster>,<attrID>` |
| Write attribute | `writeAttr()` | `CFML:CFZB:0:MODULE_ZCL_WRITE_ATTR:<short>,<ep>,<cluster>,<attrID,type,val>` |

#### Xử lý sự kiện bất đồng bộ (Async Events)

Widget parse các dòng từ telemetry gateway qua hàm `handleAsyncEvent()`:

| Pattern nhận | Ý nghĩa | Hành động UI |
|-------------|---------|-------------|
| `JOIN:<short4>,<ieee16>,<type>` | Node mới join | Thêm vào node list |
| `NODE:<short4>,<ieee16>` | Device announce | Thêm vào node list |
| `FIND:<short4>,<ieee16>` | Kết quả auto-find | Thêm vào node list |
| `LEAVE:<short4>` | Node rời mạng | Xóa khỏi node list |
| `RPT:<short>,<ep>,<cluster>,<attr>,<type>,<val>` | Attribute report | Cập nhật UI (nhiệt độ, On/Off, Level) |
| `+NWINFO:<data>` | Thông tin mạng | Hiển thị net-info-bar |
| `RSP:<data>` | ZCL response | Log console |

#### Cấu hình

- **Stack slot:** ZB S1 (slot 0) / ZB S2 (slot 1)  
- **Persistence:** localStorage lưu trạng thái slot, node list  
- **Widget type:** ThingsBoard Control Widget  
- **Min size:** 350 × 520 px  
- **Entity:** Gateway device, RPC method `sendCommand`  

---

### 1.2 Widget LoRa — Trạng thái

> **Không có widget LoRa chuyên dụng** trong thư mục `thingsboard_widget test/`.  
> Firmware gateway hỗ trợ đầy đủ `CFML:CFLR:<slot>:<cmd>` (prefix `CFLR:`), nhưng widget ThingsBoard tương ứng chưa được xây dựng.  
> Các testcode LoRa hiện chỉ hoạt động standalone hoặc qua UART trực tiếp.

---

## 2. Handler Tasks — Vai trò & Cấu trúc

### 2.1 Zigbee Handler Task

**File:** `DA2_esp_LAN/Application/Zigbee_Handler/src/zigbee_handler_task.c`  
**Module phần cứng:** E180-ZG120B (EBYTE) — IEEE 802.15.4 Zigbee Coordinator  
**Giao thức:** ASCII AT commands, UART 115200, không CRLF  

#### Ba FreeRTOS task per stack (max 2 stacks)

| Task | Ưu tiên | Stack | Chức năng |
|------|---------|-------|-----------|
| `zb_ul_s<id>` (Uplink) | 5 | 24 KB PSRAM | Nhận từ `uplink_queue` → batch (8 packets / 50ms) → `mcu_wan_enqueue_uplink(HANDLER_ZIGBEE)` |
| `zb_dl_s<id>` (Downlink) | 6 | 32 KB PSRAM | Nhận từ `command_queue` → `zigbee_handler_execute_command_with_config()` → response `CFZB:<stack>:OK/FAIL:<cmd>:<resp>` → WAN MCU |
| `zb_ls_s<id>` (Listener) | 4 | 16 KB PSRAM | `zigbee_handler_listen()` (polling UART) → event `CFZB:<stack>:EVT:<hex_data>` → WAN MCU |

#### Response format gateway → server

```
CFZB:<stack_id>:OK:<cmd>:<ascii_response>       ← lệnh thành công, có response
CFZB:<stack_id>:OK:<cmd>                        ← lệnh thành công, không response
CFZB:<stack_id>:FAIL:<cmd>:<err>:NOREPLY        ← thất bại, không phản hồi từ module
CFZB:<stack_id>:EVT:<space_separated_hex>       ← async event từ listener task
```

#### Middleware config (zigbee_config.json)

Module: **E180-ZG120B** — đầy đủ 20+ lệnh AT được map:  
`MODULE_HW_RESET` → GPIO NRST low/high  
`MODULE_START_NETWORK` → `AT+CREATENW` (expect `+CREATENW:0`, timeout 5s)  
`MODULE_SET_PERMIT_JOIN` → `AT+OPENWNET=<dur>` (expect `+OPENWNET:0`)  
`MODULE_ZCL_SEND_CONTROL_CMD` → `AT+ZCL=<addr>,<ep>,<cluster>,<cmd>` (prefix mode)  
`MODULE_ZCL_READ_ATTR` → `AT+ATTRREAD=...`  
`MODULE_ZCL_WRITE_ATTR` → `AT+ATTRWRITE=...`  
`MODULE_ZCL_SET_REPORT_RULE` → `AT+REPSETUP=...`  
`MODULE_ZCL_BIND` / `MODULE_ZCL_UNBIND` → `AT+BIND=...` / `AT+UNBIND=...`  

Async events (is_async_event: true): `+JOIN:`, `+LEFT:`, `+NODE:`, `+ATTRREPORT:`

---

### 2.2 LoRa Handler Task

**File:** `DA2_esp_LAN/Application/LoRa_Handler/src/lora_handler_task.c`  
**Module phần cứng:** RAK3172 — LoRaWAN Class A/B/C OTAA  
**Giao thức:** AT commands CRLF-terminated, UART 115200  

#### Ba FreeRTOS task per stack (max 2 stacks)

| Task | Ưu tiên | Stack | Chức năng |
|------|---------|-------|-----------|
| `lora_ul_s<id>` (Uplink) | 5 | 24 KB PSRAM | Nhận từ `uplink_queue` → batch → `mcu_wan_enqueue_uplink(HANDLER_LORA)` |
| `lora_dl_s<id>` (Downlink) | 6 | 24 KB PSRAM | Nhận từ `command_queue` → `lora_handler_execute_command_with_config()` → response `CFLR:<stack>:OK/FAIL:<resp>` → WAN MCU. Normalize `\r\n` → `\x1E` record separator |
| `lora_ls_s<id>` (Listener) | 4 | 8 KB PSRAM | `lora_handler_listen()` → event `CFLR:<stack>:EVT:<data>` → WAN MCU |

#### Response format gateway → server

```
CFLR:<stack_id>:OK:<clean_response>             ← lệnh thành công
CFLR:<stack_id>:FAIL:<err>:<clean_response>     ← thất bại, có response
CFLR:<stack_id>:FAIL:<err>:NOREPLY              ← thất bại, không response
CFLR:<stack_id>:EVT:<data>                      ← async event (e.g. +EVT:JOIN, +EVT:RX1)
```

#### Middleware config (lora_config.json)

Module: **RAK3172** — các lệnh AT map đầy đủ:  
`MODULE_GET_INFO` → `AT+VER=?\r\n`  
`MODULE_SET_REGION` → `AT+BAND=<n>` (prefix)  
`MODULE_SET_CLASS` → `AT+CLASS=<A|B|C>` (prefix)  
`MODULE_SET_JOIN_MODE` → `AT+NJM=<1=OTAA>` (prefix)  
`MODULE_SET_DEVEUI/APPEUI/APPKEY` → các lệnh AT cấu hình OTAA  
`MODULE_JOIN` → `AT+JOIN=1:0:10:8\r\n` (timeout 30s)  
`MODULE_GET_JOIN_STATUS` → `AT+NJS=?\r\n`  
`MODULE_SET_DEVADDR/NWKSKEY/APPSKEY` → ABP credentials  

#### Khởi động sequence

```
LoRa startup:  HW_RESET (GPIO) → delay 500ms → GET_INFO (AT+VER=?)
Zigbee startup: HW_RESET → 500ms → ENTER_HEX_MODE (AT+EXIT) → 200ms → GET_INFO (AT+INFO)
```

---

## 3. Testcode — Nội dung & Khả năng tương thích

### 3.1 Zigbee Testcode

#### A. `esp32c6_zigbee_bulb.ino`

**Path:** `testcode/arduino_test/esp32c6_zigbee_bulb/`  
**Platform:** ESP32-C6 Super Mini, Arduino ESP32 ≥ 3.0.5  
**Role:** Zigbee Router — Color Dimmable Light Bulb  

| Thuộc tính | Giá trị |
|-----------|---------|
| Endpoint | 10 (0x0A) |
| ZCL Clusters | On/Off (0x0006), Level Control (0x0008), Color Control (0x0300) |
| Device Type | Color Dimmable Light (DeviceID 0x0102, Profile 0x0104) |
| LED | WS2812 GPIO 8 (neopixelWrite) |
| Manufacturer | "DA2", Model: "ZB-C6-Bulb" |

**ZCL command mapping (gateway AT → device behavior):**

```
AT+ZCL=<addr>,0A,0006,01          → bật đèn (full white, level 254)
AT+ZCL=<addr>,0A,0006,00          → tắt đèn
AT+ZCL=<addr>,0A,0008,04,7F,0A00  → brightness 50% (level 0x7F), 1s transition
AT+ZCL=<addr>,0A,0300,07,A3B0054F0A00 → màu Đỏ (XY color space)
AT+ZCL=<addr>,0A,0300,07,9D2B33B30A00 → màu Xanh lá
AT+ZCL=<addr>,0A,0300,07,66265C0F0A00 → màu Xanh dương
```

**Serial test commands (USB trực tiếp):** `ON`, `OFF`, `RED`, `GREEN`, `BLUE`, `WHITE`, `RGB r g b`, `BRIGHT n`, `STATUS`, `RESET`

**Tương thích với widget:** ✅ **HOÀN TOÀN TƯƠNG THÍCH**

| Widget control | Endpoint ZCL | Testcode cluster |
|---------------|-------------|-----------------|
| On/Off tab | 0x0006 @ ep 0A | ✅ On/Off cluster |
| Level slider | 0x0008 @ ep 0A | ✅ Level Control |
| Color picker (RGB→XY) | 0x0300 @ ep 0A | ✅ Color Control |
| Read temp | 0x0402 @ ep 0A | ❌ Không có sensor cluster |

> **Lưu ý:** Widget mặc định dùng endpoint `01`. Cần chỉnh EP field thành `0A` (10 decimal) khi điều khiển bulb này.

---

#### B. `esp32c6_zigbee_sensor.ino`

**Path:** `testcode/arduino_test/esp32c6_zigbee_sensor/`  
**Role:** Zigbee Router/End Device — Simulated Temperature & Humidity Sensor  

| Thuộc tính | Giá trị |
|-----------|---------|
| Endpoint | 1 |
| ZCL Clusters | Temperature (0x0402), Humidity (0x0405) |
| Report interval | 10 giây |
| Data | Mô phỏng: nhiệt độ 20–35°C (sin + noise), độ ẩm 40–80% |
| Multi-device | `#define DEVICE_INDEX 1` hoặc `2` |

**Tương thích với widget:**  ✅ **TƯƠNG THÍCH (read-only)**

| Widget Operation | Kết quả |
|-----------------|---------|
| Node join → hiển thị node list | ✅ |
| ZCL Read Attr 0x0402:0x0000 | ✅ Đọc được nhiệt độ |
| ZCL Read Attr 0x0405:0x0000 | ✅ Đọc được độ ẩm |
| `RPT:` event → auto update temp-val | ✅ (nếu sensor gửi report) |
| On/Off, Level, Color tabs | ❌ Sensor không có cluster này |

---

#### C. `esp32c6_zigbee_bandwidth.ino`

**Path:** `testcode/arduino_test/esp32c6_zigbee_bandwidth/`  
**Role:** Zigbee Router — Bandwidth Test Node  

| Thuộc tính | Giá trị |
|-----------|---------|
| Endpoint | 1 (ZigbeeTempSensor) |
| Mode flood | TX 10 reports/s, 40 bytes/report ≈ **400 B/s uplink** |
| Control | On/Off ZCL → start/stop TX flood |
| Counters | bytesRx, bytesTx, packetsRx, packetsTx |
| Model | "ZB-BW-Sensor" |

**Tương thích với widget:** ⚠️ **TƯƠNG THÍCH GIỚI HẠN**

| Widget Operation | Kết quả |
|-----------------|---------|
| Node join | ✅ |
| On/Off tab (bật = start flood, tắt = stop) | ✅ (qua ZCL 0x0006) |
| RPT: events từ temperature attribute (flood) | ✅ — widget nhận & log |
| Xem counter qua Read Attr | ❌ — cluster 0xFC00 chưa support trong widget |
| Serial commands `START/STOP/STATUS` | Chỉ qua USB, không qua widget |

---

### 3.2 LoRa Testcode

#### D. `uno_r4_lora_bandwidth.ino`

**Path:** `testcode/arduino_test/uno_r4_lora_bandwidth/`  
**Platform:** Arduino Uno R4 WiFi + Seeed WioE5 (LoRa-E5)  
**Role:** LoRaWAN OTAA Class C — Bandwidth Test Node  

| Thuộc tính | Giá trị |
|-----------|---------|
| Join mode | OTAA, keys: `DEV_EUI=DA2DA2DA2DA2BW01` |
| Default DR | DR3 (SF9/125kHz, max ~115 bytes) |
| TX interval | 5000ms (duty cycle limited) |
| Payload size | 50 bytes/uplink |

**LoRaWAN payload protocol:**

| Byte | Ý nghĩa |
|------|---------|
| `0xC1 0x01` | Uplink: TX flood active |
| `0xC1 0x00` | Uplink: TX flood stopped |
| `0xC2 LL LL HH HH` | Stats: bytesRx(u16LE) + bytesTx(u16LE) |
| `0xDD [N B]` | Data payload (bandwidth uplink) |
| `0xC1 0x01` downlink | → start TX flood |
| `0xC1 0x00` downlink | → stop TX flood |
| `0xC3 0x01` downlink | → request stats |

**Tương thích với widget:** ❌ **KHÔNG CÓ WIDGET LoRa**

Không có ThingsBoard widget LoRa trong project. Firmware gateway hỗ trợ đầy đủ giao thức `CFML:CFLR:<slot>:<cmd>` (RAK3172) nhưng widget phía ThingsBoard chưa được phát triển. Việc điều khiển hiện chỉ qua DATN_config_app (Python) hoặc direct UART.

---

#### E. `WioE5_Gateway_Display.ino`

**Path:** `testcode/WioE5_Gateway_Display/`  
**Platform:** Arduino Uno R4 WiFi + WioE5 / RAK3172  
**Role:** LoRaWAN downlink display demo — nhận lệnh từ server, hiển thị LED matrix  

| Thuộc tính | Giá trị |
|-----------|---------|
| Join | OTAA, credentials thay thế tùy deployment |
| Downlink poll | Mỗi 15 giây (`POLL_INTERVAL_MS`) |
| Band | 8 = AS923 |
| DR | 3 |
| Port | 2 |

**Payload downlink map:**

| Byte | LED Matrix |
|------|-----------|
| `0x00` | Tắt tất cả |
| `0x01` | Bật tất cả |
| `0x02` | Animation blink |
| `0x03` | Scroll "HI" |
| `0x10 0xNN` | Hiển thị số 0–9 |
| `0x20` | Icon trái tim |
| `0x21` | Dấu check |
| `0x22` | Dấu X (lỗi) |

**Tương thích với widget:** ❌ **STANDALONE DEMO** — Không kết nối qua DA2 Gateway, dùng LoRaWAN network server trực tiếp (TTN/ChirpStack).

---

## 4. Ma trận tương thích tổng hợp

| Testcode | Protocol | Zigbee Widget v2 | LoRa Widget | Ghi chú |
|----------|----------|-----------------|-------------|---------|
| esp32c6_zigbee_bulb | ZCL native IEEE 802.15.4 | ✅ **Đầy đủ** On/Off+Level+Color | N/A | Chỉnh EP = 0A |
| esp32c6_zigbee_sensor | ZCL 0402/0405 + auto-report | ✅ **Read-only** Temp/Hum | N/A | |
| esp32c6_zigbee_bandwidth | ZCL On/Off (flood ctrl) | ⚠️ **Giới hạn** chỉ On/Off | N/A | Không xem counter |
| uno_r4_lora_bandwidth | LoRaWAN OTAA binary payload | N/A | ❌ **Thiếu widget** | Qua DATN_config_app |
| WioE5_Gateway_Display | LoRaWAN standalone | N/A | ❌ **Không qua gateway** | Demo độc lập |

---

## 5. Luồng dữ liệu đầy đủ — Zigbee On/Off test-case

```
[Widget: onClick "ON"]
    │
    ▼
sendRPC("sendCommand", hex("CFML:CFZB:0:MODULE_ZCL_SEND_CONTROL_CMD:1A2B,0A,0006,01"))
    │
    ▼  ThingsBoard MQTT
[DA2 Gateway — MCU_WAN_Handler]
    │  parse "CF" → CFZB → stack 0, function: MODULE_ZCL_SEND_CONTROL_CMD, params: 1A2B,0A,0006,01
    ▼
[Config_Handler] → lookup zigbee_config.json → func_config (AT+ZCL=, prefix, timeout 2s)
    ▼
[zigbee_command_queue[0]]
    ▼
[zb_dl_s0 task] → zigbee_handler_execute_command_with_config()
    │  UART write: "AT+ZCL=1A2B,0A,0006,01"
    ▼
[E180-ZG120B] → ZCL OnCommand frame 802.15.4 → IEEE addr broadcast
    ▼
[ESP32-C6 Bulb (short=1A2B, ep=0A)]
    │  ZCL OnOff cluster handler
    ▼
neopixelWrite(8, 255, 255, 255)   ← đèn bật trắng

[E180-ZG120B] → "+ZCL:1A2B,0A,0006,OK\r\n" → UART RX
    ▼
[zb_dl_s0] → response: "CFZB:0:OK:MODULE_ZCL_SEND_CONTROL_CMD:+ZCL:1A2B,0A,0006,OK"
    ▼
[MCU_WAN → ThingsBoard] → RPC response HEX
    ▼
[Widget: logOk("ZCL response: +ZCL:1A2B,0A,0006,OK")]
```

---

## 6. Kết luận & Đề xuất

### Tóm tắt

| Hạng mục | Kết quả |
|---------|---------|
| Zigbee widget ↔ handler protocol | ✅ Đồng bộ hoàn toàn (CFML:CFZB prefix, function name lookup, async event parse) |
| Zigbee testcode ↔ widget | ✅ bulb & sensor tương thích sẵn sàng test |
| LoRa handler firmware | ✅ Đầy đủ (CFLR prefix, RAK3172 cmd set, 3-task architecture) |
| LoRa ThingsBoard widget | ❌ Chưa có — cần phát triển |
| LoRa testcode ↔ gateway | ⚠️ Thiếu widget; có thể test qua Python app |

### Đề xuất

1. **Xây dựng LoRa widget** cho ThingsBoard tương tự Zigbee widget v2, sử dụng prefix `CFML:CFLR:<slot>:<function_name>` và parse `CFLR:<stack>:EVT:` cho uplink events (`+EVT:JOIN`, `+EVT:RX1`, downlink payload).

2. **Zigbee bulb test:** Khi dùng widget v2, chọn Stack S1, set **EP = 0A** (endpoint 10), sau đó Start Network → Permit Join → chờ `JOIN:` event → chọn node → dùng On/Off/Level/Color tabs.

3. **Zigbee sensor test:** Dùng widget Read Attr tab với cluster `0402` attr `0000` (temp int16 × 0.01°C) và cluster `0405` attr `0000` (humidity uint16 × 0.01%). Bật Report Rule để nhận tự động thay vì polling.

4. **Bandwidth test Zigbee:** Thêm field "TX flood %" vào widget để đọc counter từ cluster 0xFC00 (hoặc parse trực tiếp từ telemetry `RPT:` events).

5. **LoRa bandwidth test:** binary payload `0xDD` cần decoder node-RED hoặc rule chain parser phía ThingsBoard trước khi có widget.
