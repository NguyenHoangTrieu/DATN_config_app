# BLE Mesh Direct Implementation — DA2 Gateway

## ESP32-S3 Native BLE Mesh Provisioner for Tuya E27 LED Control

---

> **⚠️ TRẠNG THÁI: CHƯA HỖ TRỢ / NOT SUPPORTED**
>
> Tính năng BLE Mesh Provisioner đang trong giai đoạn phát triển và **chưa được kiểm chứng đủ để triển khai thực tế**.
> Tất cả các điểm truy cập đều đã bị khoá:
> - **Firmware** (`DA2_esp_LAN`): `config_handler_ble_native_commands.c` trả về `CFBN:FAIL:NOT_SUPPORTED` cho mọi lệnh CFBN: và CFBN:JSON:. Để mở khoá, đặt `#define BLE_NATIVE_MESH_SUPPORTED 1` trong file đó.
> - **Config App** (`DATN_config_app`): Tab "🔵 BLE Mesh" trong Advanced Panel bị vô hiệu hoá (`state='disabled'`).
> - **ThingsBoard Widget** (`ble_mesh_widget.html`): Overlay "Chưa hỗ trợ" phủ toàn bộ giao diện widget.
>
> Để kích hoạt lại tính năng này sau khi đã kiểm chứng đầy đủ:
> 1. Đặt `#define BLE_NATIVE_MESH_SUPPORTED  1` trong `config_handler_ble_native_commands.c`
> 2. Xoá dòng `state="disabled"` trong `advanced_panel.py`
> 3. Xoá thẻ `<div id="unsupported-overlay">` trong `ble_mesh_widget.html`

---

## 1. Why Native BLE Mesh

Tuya E27 và các thiết bị Tuya BLE Mesh **không thể** kết nối bằng GATT Central. Lý do:

| Aspect | GATT Central (STM32WB55 AT) | BLE Mesh Provisioner (ESP32-S3) |
|---|---|---|
| Advertising type | `ADV_IND (0x00)` — connectable | `ADV_NONCONN_IND (0x03)` — mesh bearer |
| Tuya E27 beacon | Broadcasts `0x03` always | ✅ Đây chính xác là mesh bearer |
| Protocol | L2CAP GATT connection | Provisioning bearer (PB-ADV) |
| Kết quả | `AT+CONNECT` treo vĩnh viễn | Hoạt động |

Tuya E27 phát `ADV_NONCONN_IND` ngay cả khi factory reset vì đây là **BLE Mesh Unprovisioned Device Beacon** theo BT SIG Mesh Profile v1.0.

---

## 2. Architecture

```
ThingsBoard / MQTT Server
    ↓  RPC: { method: "sendCommand", params: "CFBN:0:CONTROL:{...}" }
DA2_esp (WAN MCU)            — không thay đổi —
    ↓  SPI/DT frame (handler type byte = 0x06 / "BLN")
DA2_esp_LAN (LAN MCU — ESP32-S3)
    config_handler.c
        config_parse_type()   → phát hiện prefix "CFBN:"
        CONFIG_UPDATE_BLE_NATIVE_JSON  → config_parse_ble_native_json()
        CONFIG_UPDATE_BLE_NATIVE_CMD   → config_parse_ble_native_command()
    config_handler_ble_native_commands.c
        → ble_native_handler_load_config()   [khi nhận CFBN:JSON:]
        → ble_native_handler_execute()       [khi nhận CFBN:<slot>:verb]
    ble_native_handler.c
        esp_ble_mesh_init()  — khởi động BLE Mesh stack, role = provisioner
        Provisioner callbacks: prov_complete, unprov_adv_pkt
        Client model callbacks: onoff, lightness, ctl
        ← ble_native_config.c    [lưu JSON config runtime]
        → ble_native_downlink.c  [verb dispatch → ESP BLE Mesh API]
        → ble_native_uplink.c    [đẩy response lên WAN MCU]
    ble_native_uplink.c
        → mcu_wan_enqueue_uplink(HANDLER_BLE_NATIVE, ...)
        → DA2_esp → ThingsBoard/MQTT (WAN MCU không thay đổi gì)
    ↕  ESP-IDF BLE Mesh stack (ESP-IDF v5.x)
Tuya E27 / BLE Mesh nodes
```

---

## 3. Firmware Implementation

Tất cả code mới nằm trong **`DA2_esp_LAN`** — `DA2_esp` (WAN MCU) không thay đổi.

### 3.1 File structure

```
DA2_esp_LAN/Application/BLE_Handler/
├── include/
│   ├── ble_native_handler.h      — Public interface chính
│   ├── ble_native_config.h       — Config structs + JSON parse API
│   ├── ble_native_uplink.h       — Gửi events → WAN MCU
│   └── ble_native_downlink.h     — Nhận commands → BLE Mesh API
└── src/
    ├── ble_native_handler.c      — BLE Mesh stack init + callbacks
    ├── ble_native_config.c       — JSON config parser + runtime store
    ├── ble_native_uplink.c       — Uplink task (queue → mcu_wan_enqueue_uplink)
    └── ble_native_downlink.c     — Downlink task (verb dispatch)

DA2_esp_LAN/Application/Config_Handler/
├── include/
│   └── config_handler_ble_native_commands.h
└── src/
    └── config_handler_ble_native_commands.c  — Parse CFBN: prefix
```

### 3.2 Files đã chỉnh sửa

| File | Thay đổi |
|---|---|
| `Config_Handler/include/config_handler.h` | Thêm `CONFIG_UPDATE_BLE_NATIVE_JSON = 12`, `CONFIG_UPDATE_BLE_NATIVE_CMD = 13` |
| `Config_Handler/src/config_handler.c` | Phát hiện `"CFBN"` trong `config_parse_type()` + 2 switch cases mới |
| `MCU_WAN_Handler/include/frame_types.h` | Thêm `HANDLER_BLE_NATIVE = 0x06`, `HANDLER_TYPE_BLN "BLN"` |
| `main/DA2_esp_LAN.h` | `#include "ble_native_handler.h"` |
| `main/CMakeLists.txt` | 5 nguồn `.c` mới |

### 3.3 BLE Mesh Models (static trong ble_native_handler.c)

| Model | SIG ID | Vai trò |
|---|---|---|
| Config Server | — | Bắt buộc theo spec |
| Config Client | — | Bind app-key trên remote nodes |
| Generic OnOff Client | 0x1000 | Bật/tắt |
| Light Lightness Client | 0x1300 | Độ sáng |
| Light CTL Client | 0x1303 | Nhiệt độ màu |

Model được chọn dựa vào trường `"model_id"` trong bảng commands JSON — **không hardcode trong firmware**.

### 3.4 sdkconfig cần thêm

```
CONFIG_BT_ENABLED=y
CONFIG_BLE_MESH=y
CONFIG_BLE_MESH_PROVISIONER=y
CONFIG_BLE_MESH_PB_ADV=y
CONFIG_BLE_MESH_GENERIC_ONOFF_CLI=y
CONFIG_BLE_MESH_LIGHT_LIGHTNESS_CLI=y
CONFIG_BLE_MESH_LIGHT_CTL_CLI=y
```

### 3.5 Startup sequence

```c
void app_main(void) {
    nvs_flash_init();               // Bắt buộc trước khi init BLE Mesh

    // ... hardware init ...

    ble_native_handler_init();      // Init BLE Mesh stack + tasks
                                    // Chưa có key → chờ CFBN:JSON:

    config_handler_task_start();
    // ...
}
```

**Sau `ble_native_handler_init()`:** BLE Mesh init xong, role provisioner enabled, tasks running. Chưa có network key / app key → mesh operations bị block.

**Sau `CFBN:JSON:0:<json>`:** Net key + app key nạp vào provisioner, bảng commands populated → stack sẵn sàng SCAN / PROVISION / CONTROL.

---

## 4. Command Protocol — CFBN:

Tất cả commands dùng prefix `CFBN:` (cùng pattern với `CFBL:`, `CFLR:`, `CFZB:`).

### 4.1 Init — Load JSON config (bắt buộc làm trước)

```
CFBN:JSON:<slot>:<json_object>
slot = 0 (S1)  hoặc  1 (S2)
```

**Ví dụ:**
```
CFBN:JSON:0:{"stack_id":"007","stack_type":"esp32_native_ble","ble_native":{...}}
```

**Response:** `CFBN:0:OK:JSON_LOADED`

Firmware thực hiện:
1. Parse JSON → lưu vào config store
2. `esp_ble_mesh_provisioner_add_local_net_key()` với net_key
3. `esp_ble_mesh_provisioner_add_local_app_key()` với app_key
4. Set provisioner unicast address + TTL
5. Populate bảng command-name → model_id + opcode

### 4.2 Scan unprovisioned devices

```
CFBN:<slot>:SCAN:<duration_ms>
```

**Responses:**
```
CFBN:0:OK:SCAN_STARTED:10000
CFBN:0:OK:UNPROV_DEV:<uuid_32hex>:<mac>:<oob_info>   ← mỗi device một dòng
CFBN:0:OK:SCAN_DONE
```

### 4.3 Provision một device

```
CFBN:<slot>:PROVISION:<uuid_32hex>
```

**Responses:**
```
CFBN:0:OK:PROVISION_IN_PROGRESS:0x0002
CFBN:0:OK:PROVISIONED:0x0002:<uuid>
```

### 4.4 Control

```
CFBN:<slot>:CONTROL:<json_object>
```

**Body JSON:**
```json
{ "cmd": "<name>", "addr": "0x0002", "params": { ... } }
```

**Responses:**
```
CFBN:0:OK:CONTROL:SENT:<name>:0x0002
CFBN:0:OK:<MODEL>_ACK:0x0002:OK
CFBN:0:FAIL:CONTROL:MESH_SEND_FAIL
```

### 4.5 Response format chung

```
CFBN:<slot>:OK:<payload>
CFBN:<slot>:FAIL:<reason>
```

---

## 5. JSON Config Schema

```json
{
  "stack_id":   "007",
  "stack_type": "esp32_native_ble",
  "ble_native": {
    "mesh": {
      "provisioner_name":    "DA2_GW",
      "net_key":             "A1B2C3D4E5F6A7B8C9DAEBFCAD1E2F30",
      "app_key":             "0102030405060708090A0B0C0D0E0F10",
      "ttl":                 7,
      "primary_unicast_addr": 1
    },
    "commands": [
      {
        "name":         "ONOFF",
        "model_id":     "0x1000",
        "opcode":       "0x8202",
        "ack_model_id": "0x1000",
        "ack_opcode":   "0x8204",
        "param_schema": "value:uint8"
      },
      {
        "name":         "LIGHTNESS",
        "model_id":     "0x1300",
        "opcode":       "0x824C",
        "ack_model_id": "0x1300",
        "ack_opcode":   "0x824E",
        "param_schema": "lightness:uint16"
      },
      {
        "name":         "CTL",
        "model_id":     "0x1303",
        "opcode":       "0x8260",
        "ack_model_id": "0x1303",
        "ack_opcode":   "0x8262",
        "param_schema": "lightness:uint16,temperature:uint16,delta_uv:int16"
      }
    ]
  }
}
```

**Ràng buộc:**

| Field | Constraint |
|---|---|
| `net_key` / `app_key` | 32 hex chars, không có `0x` prefix (128-bit) |
| `ttl` | 1–127, recommend 7 |
| `primary_unicast_addr` | 1–32767 |
| `model_id` / `opcode` | Hex với `0x` prefix, VD: `"0x1000"` |
| `param_schema` | `"key:type[,key:type…]"` — informational cho server |
| Max commands | 16 (compile-time `BLE_NATIVE_MAX_COMMANDS`) |

---

## 6. Server Development Guide (ThingsBoard)

### 6.1 Flow tổng quát

```
Gateway khởi động
  → Gửi CFBN:JSON:0:{config}           (1 lần setup)
  ← CFBN:0:OK:JSON_LOADED

Lần đầu dùng đèn (provisioning)
  → Gửi CFBN:0:SCAN:10000
  ← CFBN:0:OK:UNPROV_DEV:<uuid>:...    (mỗi đèn tìm thấy)
  → Gửi CFBN:0:PROVISION:<uuid>
  ← CFBN:0:OK:PROVISIONED:0x0002:<uuid>

Vận hành bình thường (control)
  → CFBN:0:CONTROL:{"cmd":"ONOFF","addr":"0x0002","params":{"value":1}}
  ← CFBN:0:OK:ONOFF_ACK:0x0002:OK
```

### 6.2 RPC payloads (ThingsBoard → Gateway)

**Bật đèn:**
```json
{ "method": "sendCommand",
  "params": "CFBN:0:CONTROL:{\"cmd\":\"ONOFF\",\"addr\":\"0x0002\",\"params\":{\"value\":1}}" }
```

**Tắt đèn:**
```json
{ "method": "sendCommand",
  "params": "CFBN:0:CONTROL:{\"cmd\":\"ONOFF\",\"addr\":\"0x0002\",\"params\":{\"value\":0}}" }
```

**Độ sáng 80% (lightness = 80/100 × 65535 = 52428):**
```json
{ "method": "sendCommand",
  "params": "CFBN:0:CONTROL:{\"cmd\":\"LIGHTNESS\",\"addr\":\"0x0002\",\"params\":{\"lightness\":52428}}" }
```

**CTL — 70% sáng, 3500K:**
```json
{ "method": "sendCommand",
  "params": "CFBN:0:CONTROL:{\"cmd\":\"CTL\",\"addr\":\"0x0002\",\"params\":{\"lightness\":45875,\"temperature\":3500,\"delta_uv\":0}}" }
```

**Scan:**
```json
{ "method": "sendCommand", "params": "CFBN:0:SCAN:10000" }
```

**Provision:**
```json
{ "method": "sendCommand", "params": "CFBN:0:PROVISION:A1B2C3D4E5F6A7B8C9DAEBFCAD1E2F30" }
```

### 6.3 Mapping param_schema → giá trị API

| Command | param_schema | Giá trị | Ví dụ |
|---|---|---|---|
| `ONOFF` | `value:uint8` | 0 = tắt, 1 = bật | `{"value":1}` |
| `LIGHTNESS` | `lightness:uint16` | 1–65535 | `{"lightness":32767}` |
| `CTL` | `lightness:uint16,temperature:uint16,delta_uv:int16` | temp: 800–20000K | `{"lightness":32767,"temperature":4000,"delta_uv":0}` |

Công thức mapping:
- **Brightness %** → `lightness = round(pct / 100 × 65535)`, min 1
- **CCT %, warm↔cool** → `temperature = round(2700 + (pct/100) × 3800)` (2700K–6500K)

### 6.4 Broadcast tới nhiều đèn

```json
{ "method": "sendCommand",
  "params": "CFBN:0:CONTROL:{\"cmd\":\"ONOFF\",\"addr\":\"0xC000\",\"params\":{\"value\":0}}" }
```

> `0xC000` = BLE Mesh All-nodes group address. Cần subscribe nodes vào group sau khi provision (firmware tự xử lý nếu được cấu hình).

### 6.5 ThingsBoard Widget (có sẵn trong repo)

`DATN_config_app/thingsboard_tuya_widget/`:

| File | Nội dung |
|---|---|
| `tuya_e27_widget.html` | Paste vào tab "HTML" của TB custom widget |
| `tuya_e27_widget.css` | Paste vào tab "CSS" |
| `tuya_e27_widget.js` | Paste vào tab "JavaScript" |

Widget tự động:
1. Load provisioned nodes từ `localStorage`
2. Scan (CFBN:SCAN) → hiện danh sách unprovisioned devices
3. Provision (CFBN:PROVISION) → lưu node vào localStorage
4. Select node → điều khiển Power / Brightness / CCT qua CFBN:CONTROL

---

## 7. API Reference

| Function | File | Vai trò |
|---|---|---|
| `ble_native_handler_init()` | `ble_native_handler.c` | Init BLE Mesh stack + tasks |
| `ble_native_handler_load_config(slot, json, len)` | `ble_native_handler.c` | Nạp JSON config vào provisioner |
| `ble_native_handler_execute(data, len)` | `ble_native_handler.c` | Enqueue raw CFBN: command |
| `ble_native_uplink_send_ok(slot, payload)` | `ble_native_uplink.c` | Gửi CFBN:OK response lên WAN |
| `ble_native_uplink_send_fail(slot, reason)` | `ble_native_uplink.c` | Gửi CFBN:FAIL response lên WAN |
| `ble_native_config_load(slot, json, len)` | `ble_native_config.c` | Parse JSON vào config store |
| `ble_native_config_find_cmd(slot, name, &out)` | `ble_native_config.c` | Lookup command theo name |
| `ble_native_config_get_mesh(slot, &out)` | `ble_native_config.c` | Lấy mesh keys/TTL |
| `ble_native_config_alloc_unicast(slot, &addr)` | `ble_native_config.c` | Cấp phát unicast address mới |
| `ble_native_get_model(model_id)` | `ble_native_handler.c` | Lấy ESP model handle theo ID |
| `config_parse_ble_native_json(data, len)` | `config_handler_ble_native_commands.c` | Gọi bởi config_handler cho JSON init |
| `config_parse_ble_native_command(data, len)` | `config_handler_ble_native_commands.c` | Gọi bởi config_handler cho operations |

