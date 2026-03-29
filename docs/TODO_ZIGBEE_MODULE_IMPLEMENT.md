# TODO: Zigbee 3.0 Module – JSON Config + Full Handler Implementation

> **Scope**: Tạo toàn bộ lớp Zigbee 3.0 (JSON schema + parser + middleware + app task + config routing) theo đúng pattern của BLE và LoRaWAN, với 3 điểm khác biệt quan trọng so với hai module trên: **binary HEX protocol**, **async-heavy event stream**, và **XOR checksum**.
>
> **Reference pattern**: `Middleware/BLE_Handler/ble_config.json`, `Middleware/JSON_Config_Parser/src/json_ble_config_parser.c`, `Middleware/BLE_Handler/src/ble_handler.c`, `Application/BLE_Handler/src/ble_handler_task.c`, `Application/Config_Handler/src/config_handler_ble_commands.c`.
>
> **Target module**: EBYTE E180-ZG120B (EFR32MG1B232, Coordinator-only, HEX binary mode)

---

## Mục lục
1. [Review completeness nhóm chức năng Zigbee 3.0](#1-review-completeness)
2. [Điểm khác biệt kiến trúc so với BLE / LoRa](#2-kien-truc-khac-biet)
3. [JSON Schema thiết kế (zigbee_config.json)](#3-json-schema)
4. [Danh sách file cần tạo / chỉnh sửa](#4-file-list)
5. [Task chi tiết (ordered by dependency)](#5-tasks)

---

## 1. Review Completeness

### 1.1 Cross-vendor coverage check

Kiểm tra 7 function group đề xuất với tất cả module Zigbee 3.0 Coordinator tiêu biểu trên thị trường:

| Module | Chip | Protocol | Coordinator Role |
|--------|------|----------|-----------------|
| EBYTE E180-ZG120B | EFR32MG1B232 | HEX binary + AT + Transparent | Fixed coordinator |
| EBYTE E18-MS1-PCB | CC2530 | HEX binary + AT + Transparent | Fixed coordinator |
| EBYTE E72-2G4M20S1E | CC2652 | HEX binary | Configurable |
| Digi XBee 3 Zigbee | CC2652 | AT transparent / API binary frame | Configurable |
| TLSR8258 (Tuya ZS3L) | Telink TLSR8258 | Proprietary `55 AA…` | Configurable |
| Silicon Labs MGM210 | EFR32MG21 | AT (RT-Thread) | Configurable |

---

#### Group 1 – Lifecycle / Local Config

| Function | E180-ZG120B | E18-MS1 | E72 | XBee3 | Tuya | MGM210 | Verdict |
|----------|------------|---------|-----|-------|------|--------|---------|
| MODULE_HW_RESET | ✅ GPIO NRST | ✅ | ✅ | ✅ | ✅ | ✅ | OK |
| MODULE_SW_RESET | ✅ `55 04 00 04 01 05` | ✅ | ✅ | ✅ AT+FR | ✅ `55 AA 06` | ✅ | OK |
| MODULE_FACTORY_RESET | ✅ `55 04 00 04 02 06` | ✅ | ✅ | ✅ AT+RE | ✅ | ✅ | OK |
| MODULE_GET_INFO | ✅ `55 03 00 00 00` | ✅ | ✅ | ✅ ATVR | ✅ | ✅ | OK |
| MODULE_ENTER_HEX_MODE | ✅ `AT+EXIT\r\n` | ✅ | N/A | N/A | N/A | N/A | OK |

---

#### Group 2 – Network Management (Coordinator)

| Function | E180-ZG120B | E18-MS1 | E72 | XBee3 | Tuya | MGM210 | Verdict |
|----------|------------|---------|-----|-------|------|--------|---------|
| MODULE_START_NETWORK | ✅ `55 03 00 02 02` | ✅ | ✅ | ✅ AI=0 | ✅ | ✅ | OK |
| MODULE_STOP_NETWORK | ✅ `55 03 00 03 03` | ✅ | ✅ | ✅ | N/A | ✅ | OK |
| MODULE_GET_NET_STATUS | ✅ `55 03 00 00 00` | ✅ | ✅ | ✅ ATAI | ✅ | ✅ | OK |
| MODULE_SET_CHANNEL | ✅ `55 07 00 06…` | ✅ | ✅ | ✅ ATSC | ✅ | ✅ | OK |
| MODULE_SET_PANID | ✅ `55 05 00 08…` | ✅ | ✅ | ✅ ATID | ✅ | ✅ | OK |
| MODULE_SET_TX_POWER | ✅ `55 04 00 0D…` | ✅ | ✅ | ✅ ATPL | ✅ | ✅ | OK |
| MODULE_SET_PERMIT_JOIN | ✅ `55 04 00 12…` | ✅ | ✅ | ✅ | partial | ✅ | OK |

---

#### Group 3 – Node Discovery / Device Management

| Function | E180-ZG120B | E18-MS1 | E72 | XBee3 | Tuya | MGM210 | Verdict |
|----------|------------|---------|-----|-------|------|--------|---------|
| MODULE_NODE_JOIN_NOTIFY | ✅ async 0x80/0x03 | ✅ | ✅ | ✅ API frame | ✅ | ✅ | OK – RX-only |
| MODULE_NODE_LEAVE_NOTIFY | ✅ async 0x80/0x06 | ✅ | ✅ | ✅ | partial | ✅ | OK – RX-only |
| MODULE_NODE_ANNOUNCE_NOTIFY | ✅ async 0x80/0x05 | ✅ | ✅ | implicit | partial | partial | OK – RX-only |
| MODULE_QUERY_SHORT_ADDR | ✅ 0x01/0x00 | ✅ | ✅ | ✅ ND | N/A | ✅ | OK |
| MODULE_QUERY_NODE_PORT_INFO | ✅ 0x01/0x04 | partial | ✅ | ✅ | N/A | partial | OK |
| MODULE_DELETE_NODE | ✅ 0x01/0x34 | ✅ | ✅ | ✅ | partial | ✅ | OK |

---

#### Group 4 – ZCL Device Control

| Function | E180-ZG120B | E18-MS1 | E72 | XBee3 | Tuya | MGM210 | Verdict |
|----------|------------|---------|-----|-------|------|--------|---------|
| MODULE_ZCL_READ_ATTR | ✅ 0x02/0x00 | ✅ | ✅ | ✅ API | partial | ✅ | OK |
| MODULE_ZCL_WRITE_ATTR | ✅ 0x02/0x01 | ✅ | ✅ | ✅ API | partial | ✅ | OK |
| MODULE_ZCL_SEND_CONTROL_CMD | ✅ 0x02/0x0F | ✅ | ✅ | ✅ | ✅ | ✅ | OK |
| MODULE_ZCL_RECV_CONTROL_CMD | ✅ async 0x82/0x0F | ✅ | ✅ | ✅ | ✅ | ✅ | OK – RX-only |
| MODULE_ZCL_RECV_ATTR_REPORT | ✅ async 0x82/0x0A | ✅ | ✅ | ✅ | ✅ | ✅ | OK – RX-only |
| MODULE_ZCL_SET_REPORT_RULE | ✅ 0x02/0x03 | ✅ | ✅ | ✅ | N/A | partial | OK |

---

#### Group 5 – Data Transmission

| Function | E180-ZG120B | E18-MS1 | E72 | XBee3 | Tuya | MGM210 | Verdict |
|----------|------------|---------|-----|-------|------|--------|---------|
| MODULE_SEND_UNICAST | ✅ HEX ZCL | ✅ | ✅ | ✅ API 0x11 | ✅ | ✅ | OK |
| MODULE_SEND_BROADCAST | ✅ dst=0xFFFF | ✅ | ✅ | ✅ | partial | ✅ | OK |

---

### 1.2 Gap Analysis

| # | Function bổ sung | Quyết định | Lý do |
|---|------------------|------------|-------|
| G3 | MODULE_SET_PERMIT_JOIN | ✅ **THÊM** | **Critical** – không onboard được node mới nếu thiếu |
| G5 | MODULE_NODE_ANNOUNCE_NOTIFY | ✅ **THÊM** | Node reboot không có leave event trước → cần để detect rejoin |

### 1.3 Danh sách function CUỐI CÙNG (26 functions)

```
Group 1 – Lifecycle      (5): HW_RESET, SW_RESET, FACTORY_RESET,
                               GET_INFO, ENTER_HEX_MODE

Group 2 – Network Mgmt   (7): START_NETWORK, STOP_NETWORK, GET_NET_STATUS,
                               SET_CHANNEL, SET_PANID, SET_TX_POWER,
                               SET_PERMIT_JOIN

Group 3 – Node Discovery (6): NODE_JOIN_NOTIFY, NODE_LEAVE_NOTIFY,
                               NODE_ANNOUNCE_NOTIFY,
                               QUERY_SHORT_ADDR, QUERY_NODE_PORT_INFO,
                               DELETE_NODE

Group 4 – ZCL Control    (6): ZCL_READ_ATTR, ZCL_WRITE_ATTR,
                               ZCL_SEND_CONTROL_CMD, ZCL_RECV_CONTROL_CMD,
                               ZCL_RECV_ATTR_REPORT, ZCL_SET_REPORT_RULE

Group 5 – Data TX        (2): SEND_UNICAST, SEND_BROADCAST
                    ──────────────────────────────────────────────
TOTAL            26 functions  →  #define ZIGBEE_MAX_FUNCTIONS 28 (2 reserve)
```

**Giảm từ 46 → 26 functions (giảm 43%).** Tất cả chức năng core của Zigbee 3.0 coordinator gateway được giữ lại.

---

## 2. Kiến Trúc Khác Biệt So Với BLE/LoRa

### 2.1 Binary frame thay vì ASCII AT

BLE/LoRa dùng `command` string ASCII (`"AT+JOIN=1:0:10:8\r\n"`).  
Zigbee E180 dùng HEX binary frame:
```
[0x55] [LEN] [CMD_TYPE] [CMD_CODE] [DATA 0–252 bytes] [XOR_CHECK]
```
JSON KHÔNG lưu toàn bộ frame vì DATA là runtime input. JSON chỉ lưu `cmd_type` + `cmd_code`.  
Frame builder + XOR checksum là trách nhiệm của `zigbee_handler_execute_command_with_config()`.

Để backward-compatible với common parser, trường `command` vẫn giữ nhưng được dùng cho **AT-mode commands** (enter/exit mode). Trường mới `cmd_type` / `cmd_code` dành cho HEX mode.

### 2.2 Async event stream – listener task bắt buộc

| Module | Listener model |
|--------|---------------|
| BLE | Optional – chỉ cần cho SCAN |
| LoRa | Optional – JOIN/downlink wait |
| **Zigbee** | **Bắt buộc** – async event loop thường trực (node join, leave, ZCL report đến không báo trước) |

`zigbee_handler_task.c` phải có **dedicated RX task** chạy song song với command execution task.

### 2.3 `expect_response` là binary prefix, không phải ASCII

LoRa: `"expect_response": "+EVT:JOINED"`  
Zigbee: `"expect_response": "55 xx 81 00"` (hex bytes, `xx` là wildcard)

JSON lưu hex string dạng `"55 81 00"` (space-separated), parser convert sang byte array so sánh. Cần thêm field:
```json
"response_format": "hex"   // "ascii" (default) | "hex"
```

### 2.4 XOR Checksum – không hardcode trong JSON

```c
uint8_t xor = CMD_TYPE ^ CMD_CODE;
for (int i = 0; i < data_len; i++) xor ^= data[i];
frame[frame_len - 1] = xor;
```
Handler tự tính trước khi gửi. JSON không encode checksum.

### 2.5 Module mode switching

E180-ZG120B có 3 mode: **AT mode** → **HEX mode** → **Transparent mode**.  
- Sau power-on ở AT mode → cần `MODULE_ENTER_HEX_MODE` trước khi gửi bất kỳ HEX command nào.
- `MODULE_ENTER_AT_MODE` (`55 03 00 16 16`) để quay về AT mode.
- Mode state được lưu trong handler context (`zigbee_module_state_t`).

---

## 3. JSON Schema Thiết Kế

### 3.1 `zigbee_config.json` – cấu trúc đầy đủ

```json
{
    "module_id": "003",
    "module_type": "ZIGBEE",
    "module_name": "E180-ZG120B",

    "module_communication": {
        "port_type": "uart",
        "parameters": {
            "baudrate": 115200,
            "parity": "none",
            "stopbit": 1
        }
    },

    "functions": [
        {
            "function_name": "MODULE_HW_RESET",
            "command": "",
            "cmd_type": -1,
            "cmd_code": -1,
            "is_prefix": false,
            "response_format": "ascii",
            "gpio_start_control": [{ "pin": "01", "state": "LOW" }],
            "delay_start": 100,
            "expect_response": "",
            "timeout": 0,
            "gpio_end_control": [{ "pin": "01", "state": "HIGH" }],
            "delay_end": 500
        },
        {
            "function_name": "MODULE_SW_RESET",
            "command": "",
            "cmd_type": 0,
            "cmd_code": 4,
            "is_prefix": false,
            "response_format": "hex",
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "55 00 04",
            "timeout": 2000,
            "gpio_end_control": [],
            "delay_end": 1000
        },
        {
            "function_name": "MODULE_ENTER_HEX_MODE",
            "command": "AT+EXIT\r\n",
            "cmd_type": -1,
            "cmd_code": -1,
            "is_prefix": false,
            "response_format": "ascii",
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 100
        },
        {
            "function_name": "MODULE_SET_PERMIT_JOIN",
            "command": "",
            "cmd_type": 0,
            "cmd_code": 18,
            "is_prefix": true,
            "response_format": "hex",
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "55 00 12",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_NODE_JOIN_NOTIFY",
            "command": "",
            "cmd_type": 128,
            "cmd_code": 3,
            "is_prefix": false,
            "response_format": "hex",
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "55 80 03",
            "timeout": 0,
            "gpio_end_control": [],
            "delay_end": 0
        }
    ]
}
```

### 3.2 Quy tắc field mới

| Field | Type | Mô tả |
|-------|------|-------|
| `cmd_type` | int | `CMD_TYPE` byte của HEX frame. `-1` = không dùng HEX mode (GPIO-only hoặc AT command) |
| `cmd_code` | int | `CMD_CODE` byte của HEX frame. `-1` = không dùng HEX mode |
| `response_format` | string | `"ascii"` (default, tương thích BLE/LoRa) hoặc `"hex"` (Zigbee binary response) |
| `expect_response` | string | Hex mode: space-separated hex bytes `"55 80 03"`. ASCII mode: substring như cũ |

**Quy tắc is_prefix với HEX mode:**
- `"is_prefix": false` → frame DATA section rỗng, handler chỉ gửi `[0x55][LEN][CMD_TYPE][CMD_CODE][XOR]`.
- `"is_prefix": true` → caller cung cấp DATA bytes (binary blob), handler append vào frame trước khi tính XOR.

**Backward-compatibility**: Common parser (`json_config_parser`) không thay đổi. `cmd_type`, `cmd_code`, `response_format` chỉ được parse bởi `json_zigbee_config_parser`.

---

## 4. Danh Sách File Cần Tạo / Chỉnh Sửa

### 4.1 File MỚI cần TẠO

```
DA2_esp_LAN/
├── Middleware/
│   ├── Zigbee_Handler/
│   │   ├── zigbee_config.json                          [NEW] – Full 46-function config
│   │   ├── include/
│   │   │   └── zigbee_handler.h                        [NEW] – Middleware handler API
│   │   └── src/
│   │       └── zigbee_handler.c                        [NEW] – Frame build, XOR, execute/listen
│   └── JSON_Config_Parser/
│       ├── include/
│       │   └── json_zigbee_config_parser.h             [NEW] – Struct + enum + parse API
│       └── src/
│           └── json_zigbee_config_parser.c             [NEW] – Parser implementation
└── Application/
    ├── Zigbee_Handler/
    │   ├── include/
    │   │   └── zigbee_handler_task.h                   [NEW] – Task API (start/stop/load/send)
    │   └── src/
    │       └── zigbee_handler_task.c                   [NEW] – FreeRTOS tasks (cmd + RX listener)
    └── Config_Handler/
        ├── include/
        │   └── config_handler_zigbee_commands.h        [NEW] – config_parse_zigbee_command/json()
        └── src/
            └── config_handler_zigbee_commands.c        [NEW] – CFZB:<stack>:<cmd> parser
```

### 4.2 File HIỆN CÓ cần CHỈNH SỬA

```
DA2_esp_LAN/
├── Application/
│   └── Config_Handler/
│       ├── include/
│       │   └── config_handler.h                        [EDIT] – Thêm CONFIG_UPDATE_ZIGBEE_JSON/CMD
│       └── src/
│           └── config_handler.c                        [EDIT] – Thêm case ZIGBEE trong switch
└── main/
    └── CMakeLists.txt (hoặc tương đương)               [EDIT] – Thêm source files mới vào build
```

---

## 5. Tasks Chi Tiết

> **Thứ tự thực hiện**: Mỗi task phụ thuộc task trước. Không skip.

---

### Task 1 – Tạo `zigbee_config.json` đầy đủ 26 functions

**File**: `DA2_esp_LAN/Middleware/Zigbee_Handler/zigbee_config.json`

**Checklist**:
- [ ] Group 1 – Lifecycle **(5)**: HW_RESET, SW_RESET, FACTORY_RESET, GET_INFO, ENTER_HEX_MODE
- [ ] Group 2 – Network Mgmt **(7)**: START_NETWORK, STOP_NETWORK, GET_NET_STATUS, SET_CHANNEL, SET_PANID, SET_TX_POWER, SET_PERMIT_JOIN
- [ ] Group 3 – Node Discovery **(6)**: NODE_JOIN_NOTIFY, NODE_LEAVE_NOTIFY, NODE_ANNOUNCE_NOTIFY, QUERY_SHORT_ADDR, QUERY_NODE_PORT_INFO, DELETE_NODE
- [ ] Group 4 – ZCL Control **(6)**: ZCL_READ_ATTR, ZCL_WRITE_ATTR, ZCL_SEND_CONTROL_CMD, ZCL_RECV_CONTROL_CMD, ZCL_RECV_ATTR_REPORT, ZCL_SET_REPORT_RULE
- [ ] Group 5 – Data TX **(2)**: SEND_UNICAST, SEND_BROADCAST
- [ ] Mỗi function có đầy đủ: `cmd_type`, `cmd_code`, `response_format`, `expect_response` đúng với E180-ZG120B datasheet
- [ ] Async-only RX functions (NODE_JOIN_NOTIFY, NODE_LEAVE_NOTIFY, NODE_ANNOUNCE_NOTIFY, ZCL_RECV_*): `cmd_type` = -1, `timeout` = 0, `expect_response` = hex prefix của event frame

**Tham khảo**: E180-ZG120 User Manual – Section 4 (Local Config), Section 5 (ZDO), Section 6 (ZCL)

---

### Task 2 – Tạo `json_zigbee_config_parser.h` và `json_zigbee_config_parser.c`

**Files**:
- `DA2_esp_LAN/Middleware/JSON_Config_Parser/include/json_zigbee_config_parser.h`
- `DA2_esp_LAN/Middleware/JSON_Config_Parser/src/json_zigbee_config_parser.c`

**Checklist**:

**Header** (`json_zigbee_config_parser.h`):
- [ ] `#define ZIGBEE_MAX_FUNCTIONS 28`
- [ ] `#define ZIGBEE_COMMAND_LEN 128` (AT-mode commands)
- [ ] `#define ZIGBEE_RESPONSE_LEN 32` (hex prefix bytes)
- [ ] Enum `json_zigbee_function_id_t` với 26 entries đúng thứ tự, khớp `ZIGBEE_FUNCTION_NAMES[]`
- [ ] Enum `zigbee_response_format_t { ZIGBEE_RESP_ASCII = 0, ZIGBEE_RESP_HEX }`
- [ ] Struct `json_zigbee_function_config_t`:
  ```c
  bool available;
  json_zigbee_function_id_t function_id;
  char command[ZIGBEE_COMMAND_LEN];    // AT-mode command string
  int16_t cmd_type;                    // HEX frame CMD_TYPE, -1 = not HEX
  int16_t cmd_code;                    // HEX frame CMD_CODE, -1 = not HEX
  bool is_prefix;
  zigbee_response_format_t response_format;
  gpio_control_t gpio_start[MAX_GPIO_ACTIONS];
  uint8_t gpio_start_count;
  uint16_t delay_start_ms;
  uint8_t expect_response_bytes[ZIGBEE_RESPONSE_LEN]; // parsed from hex string
  uint8_t expect_response_len;
  uint16_t timeout_ms;
  gpio_control_t gpio_end[MAX_GPIO_ACTIONS];
  uint8_t gpio_end_count;
  uint16_t delay_end_ms;
  ```
- [ ] Struct `json_zigbee_module_config_t` gồm `module_metadata_t` + `functions[]` + `function_count`
- [ ] Khai báo `esp_err_t json_zigbee_config_parse(const char *json_str, json_zigbee_module_config_t *config)`

**Source** (`json_zigbee_config_parser.c`):
- [ ] `static const char *ZIGBEE_FUNCTION_NAMES[JSON_ZIGBEE_FUNC_MAX]` – 26 entries
- [ ] Helper `parse_hex_response_string()`: convert `"55 80 03"` → `uint8_t[]`
- [ ] Helper `parse_gpio_array()` – copy từ `json_ble_config_parser.c` (identical)
- [ ] `parse_function()`: parse `cmd_type`, `cmd_code`, `response_format`, `expect_response` (hex or ascii), cùng các field chung
- [ ] `json_zigbee_config_parse()`: gọi `json_config_parse_metadata()` rồi iterate `functions[]`
- [ ] Log warning (không fail) khi function không có trong JSON (set `available = false`)

---

### Task 3 – Tạo `zigbee_handler.h` và `zigbee_handler.c`

**Files**:
- `DA2_esp_LAN/Middleware/Zigbee_Handler/include/zigbee_handler.h`
- `DA2_esp_LAN/Middleware/Zigbee_Handler/src/zigbee_handler.c`

**Checklist**:

**Header** (`zigbee_handler.h`):
- [ ] Enum `zigbee_module_mode_t { ZIGBEE_MODE_AT, ZIGBEE_MODE_HEX, ZIGBEE_MODE_TRANSPARENT }`
- [ ] Struct `zigbee_command_request_t`:
  ```c
  uint8_t stack_id;
  json_zigbee_function_config_t *func_config;
  uint8_t data[252];          // runtime DATA bytes for HEX frame
  uint8_t data_len;
  char response_buf[512];
  size_t response_len;
  esp_err_t result;
  ```
- [ ] API:
  ```c
  esp_err_t zigbee_handler_init(uint8_t stack_id, const json_zigbee_module_config_t *config);
  esp_err_t zigbee_handler_load_config(uint8_t stack_id, const json_zigbee_module_config_t *config);
  esp_err_t zigbee_handler_execute_command_with_config(uint8_t stack_id, json_zigbee_function_id_t func_id, const uint8_t *data, uint8_t data_len, char *out_buf, size_t out_max, size_t *out_len);
  esp_err_t zigbee_handler_read_async_event(uint8_t stack_id, uint8_t *out_buf, size_t out_max, size_t *out_len, uint32_t timeout_ms);
  json_zigbee_module_config_t *zigbee_handler_get_config(uint8_t stack_id);
  zigbee_module_mode_t zigbee_handler_get_mode(uint8_t stack_id);
  ```

**Source** (`zigbee_handler.c`):
- [ ] `static zigbee_module_mode_t s_mode[ZIGBEE_MAX_STACKS]` – track mode per stack
- [ ] `build_hex_frame()`:
  ```c
  // [0x55][LEN][CMD_TYPE][CMD_CODE][DATA...][XOR]
  // LEN = 1(CMD_TYPE) + 1(CMD_CODE) + data_len
  // XOR = CMD_TYPE ^ CMD_CODE ^ DATA[0] ^ ... ^ DATA[n-1]
  ```
- [ ] `compare_hex_response()`: so sánh binary response với `expect_response_bytes` (prefix match)
- [ ] `zigbee_handler_execute_command_with_config()`:
  - Nếu `cmd_type == -1` → gửi ASCII `func->command` (AT-mode, giống BLE)
  - Nếu `cmd_type >= 0` → gọi `build_hex_frame()`, gửi qua `module_config_controller_write()`
  - Đọc response bằng `zigbee_read_until_response()` với binary prefix match
  - Update `s_mode[]` nếu function là ENTER_HEX_MODE / ENTER_AT_MODE / ENTER_TRANSPARENT_MODE
- [ ] `zigbee_read_until_response()`: timeout loop đọc UART, accumulate bytes, check prefix match cho hex format hoặc substring match cho ascii format
- [ ] `zigbee_handler_read_async_event()`: non-blocking read với timeout, return first available bytes từ UART (dùng cho listener task)
- [ ] Bus mutex (SemaphoreHandle_t) per stack – timeout 5000ms

---

### Task 4 – Tạo `zigbee_handler_task.h` và `zigbee_handler_task.c`

**Files**:
- `DA2_esp_LAN/Application/Zigbee_Handler/include/zigbee_handler_task.h`
- `DA2_esp_LAN/Application/Zigbee_Handler/src/zigbee_handler_task.c`

**Checklist**:

**Header**:
- [ ] Enum `zigbee_cmd_type_t { ZIGBEE_CMD_EXECUTE, ZIGBEE_CMD_LOAD_CONFIG, ZIGBEE_CMD_STOP }`
- [ ] Struct `zigbee_task_command_t` với `func_id`, `data[]`, `data_len`, `source`, `stack_id`
- [ ] `esp_err_t zigbee_handler_task_start(uint8_t stack_id)`
- [ ] `esp_err_t zigbee_handler_task_stop(uint8_t stack_id)`
- [ ] `esp_err_t zigbee_handler_task_load_config(uint8_t stack_id, const char *json_str)`
- [ ] `esp_err_t zigbee_handler_task_send_command(uint8_t stack_id, json_zigbee_function_id_t func_id, const uint8_t *data, uint8_t data_len, config_source_t source)`
- [ ] `QueueHandle_t g_zigbee_cmd_queue[ZIGBEE_MAX_STACKS]` – extern

**Source**:
- [ ] **Command task** (`zigbee_cmd_task()`): dequeue từ `g_zigbee_cmd_queue`, gọi `zigbee_handler_execute_command_with_config()`, route ACK về `source` (UART/USB/WAN MCU)
- [ ] **Listener task** (`zigbee_listener_task()`): loop `zigbee_handler_read_async_event()` → classify bằng `CMD_TYPE` byte (0x80 = join/leave events, 0x82 = ZCL events) → forward lên `mcu_wan_handler` uplink queue
- [ ] Listener task chạy liên tục (không exit), priority thấp hơn command task
- [ ] Config load: parse JSON → `zigbee_handler_load_config()` → ACK về source
- [ ] Stack init: gọi `module_config_controller_init_uart()` dựa trên `comm_config` trong JSON

---

### Task 5 – Tạo `config_handler_zigbee_commands.h` và `.c`

**Files**:
- `DA2_esp_LAN/Application/Config_Handler/include/config_handler_zigbee_commands.h`
- `DA2_esp_LAN/Application/Config_Handler/src/config_handler_zigbee_commands.c`

**Command protocol**:
```
CFZB:JSON:<stack_id>:<json_data>           → Load Zigbee JSON config
CFZB:<stack_id>:<function_name>            → Execute function (GPIO-only / AT / HEX no data)
CFZB:<stack_id>:<function_name>:<hex_data> → Execute function with binary data payload
```

**Checklist**:

**Header**:
- [ ] `esp_err_t config_parse_zigbee_command(const uint8_t *data, uint16_t len)`
- [ ] `esp_err_t config_parse_zigbee_json(const uint8_t *data, uint16_t len)`

**Source** (`config_handler_zigbee_commands.c`):
- [ ] `config_parse_zigbee_json()`: tách `stack_id` và JSON payload, gọi `zigbee_handler_task_load_config()`, ACK: `"CFZB:JSON:OK"` / `"CFZB:JSON:FAIL"`
- [ ] `config_parse_zigbee_command()`:
  - Parse `stack_id` (field sau `CFZB:`)
  - Parse `function_name` → lookup trong loaded config của stack đó
  - Nếu có `:<hex_data>` → decode hex string thành byte array
  - Gọi `zigbee_handler_task_send_command()` với data payload
  - ACK: `"CFZB:OK:<function_name>"` / `"CFZB:FAIL:<function_name>:<reason>"`
- [ ] Validate: stack_id trong range, function `available == true` trong loaded config

---

### Task 6 – Chỉnh sửa `config_handler.h` và `config_handler.c`

**File**: `DA2_esp_LAN/Application/Config_Handler/include/config_handler.h`

- [ ] Thêm 2 enum values vào `config_type_t`:
  ```c
  CONFIG_UPDATE_ZIGBEE_JSON = 10, // "CFZB:JSON" - Zigbee JSON config
  CONFIG_UPDATE_ZIGBEE_CMD  = 11, // "CFZB:<stack>:<cmd>" - Zigbee command
  ```

**File**: `DA2_esp_LAN/Application/Config_Handler/src/config_handler.c`

- [ ] Thêm detection `"CFZB:JSON"` → `CONFIG_UPDATE_ZIGBEE_JSON`
- [ ] Thêm detection `"CFZB:"` → `CONFIG_UPDATE_ZIGBEE_CMD`
- [ ] Thêm 2 case trong switch:
  ```c
  case CONFIG_UPDATE_ZIGBEE_JSON:
      config_parse_zigbee_json(...)
  case CONFIG_UPDATE_ZIGBEE_CMD:
      config_parse_zigbee_command(...)
  ```
- [ ] `#include "config_handler_zigbee_commands.h"`

---

### Task 7 – Cập nhật CMakeLists.txt

**File**: `DA2_esp_LAN/CMakeLists.txt` (hoặc component CMakeLists.txt tương ứng)

- [ ] Thêm source files vào `SRCS`:
  ```cmake
  "Middleware/Zigbee_Handler/src/zigbee_handler.c"
  "Middleware/JSON_Config_Parser/src/json_zigbee_config_parser.c"
  "Application/Zigbee_Handler/src/zigbee_handler_task.c"
  "Application/Config_Handler/src/config_handler_zigbee_commands.c"
  ```
- [ ] Thêm include dirs:
  ```cmake
  "Middleware/Zigbee_Handler/include"
  "Application/Zigbee_Handler/include"
  ```
- [ ] Thêm `zigbee_config.json` vào SPIFFS/LittleFS partition nếu config được load từ flash

---

### Task 8 – Tích hợp Listener Task vào `module_monitor_task`

**Tham khảo**: `DA2_esp_LAN/Application/Module_Monitor_Task/src/module_monitor_task.c`

- [ ] Trong `module_monitor_task_start()`: gọi `zigbee_handler_task_start()` cho mỗi stack có Zigbee
- [ ] Forward async events từ Zigbee listener lên WAN uplink đúng format frame (`frame_types.h`)
- [ ] Zigbee join/leave events → uplink với type riêng biệt để server distinguish

---

### Task 9 – Testing

**Unit Tests (có thể mock UART)**:
- [ ] `build_hex_frame()` với known inputs → verify XOR checksum
- [ ] `parse_hex_response_string()` với `"55 80 03"` → `{0x55, 0x80, 0x03}`
- [ ] `compare_hex_response()` – prefix match, length mismatch, middle-byte mismatch
- [ ] `json_zigbee_config_parse()` với `zigbee_config.json` full → verify all 26 functions parsed
- [ ] Unknown function name trong JSON → ESP_ERR_INVALID_ARG (fail-fast)

**Integration Tests (cần E180-ZG120B hardware)**:
- [ ] Gửi `CFZB:JSON:0:<content_of_zigbee_config.json>` → response `CFZB:JSON:OK`
- [ ] Gửi `CFZB:0:MODULE_HW_RESET` → module reset, power-cycle verify
- [ ] Gửi `CFZB:0:MODULE_ENTER_HEX_MODE` → verify module enters HEX mode
- [ ] Gửi `CFZB:0:MODULE_START_NETWORK` → `GET_NET_STATUS` returns network formed
- [ ] Gửi `CFZB:0:MODULE_SET_PERMIT_JOIN:3C` (60 seconds) → join window opens
- [ ] Pair sensor node → listener task nhận `NODE_JOIN_NOTIFY` async event → event forwarded uplink
- [ ] Gửi `CFZB:0:MODULE_ZCL_READ_ATTR:...` với target endpoint → response parsed, forwarded

---

## Phụ lục – Mapping CMD_TYPE/CMD_CODE hex → decimal cho 26 functions

> JSON dùng `int`. `cmd_type = -1` = không có HEX frame (GPIO-only hoặc AT string).

| Function | CMD_TYPE | CMD_CODE | Ghi chú |
|----------|----------|----------|---------|
| MODULE_HW_RESET | -1 | -1 | GPIO NRST pulse |
| MODULE_SW_RESET | 0 | 4 | DATA byte 0x01; response `55 00 04` |
| MODULE_FACTORY_RESET | 0 | 4 | DATA byte 0x02; response `55 00 04` |
| MODULE_GET_INFO | 0 | 0 | Frame `55 03 00 00 00`; response `55 xx 00 00 ...` |
| MODULE_ENTER_HEX_MODE | -1 | -1 | ASCII `AT+EXIT\r\n`; response `OK` |
| MODULE_START_NETWORK | 0 | 2 | Frame `55 03 00 02 02`; response `55 00 02` |
| MODULE_STOP_NETWORK | 0 | 3 | Frame `55 03 00 03 03`; response `55 00 03` |
| MODULE_GET_NET_STATUS | 0 | 0 | Reuse GET_INFO frame; parse status byte |
| MODULE_SET_CHANNEL | 0 | 6 | DATA: 4-byte channel mask LE; is_prefix=true |
| MODULE_SET_PANID | 0 | 8 | DATA: 2-byte PANID LE; is_prefix=true |
| MODULE_SET_TX_POWER | 0 | 13 | DATA: 1-byte power level; is_prefix=true |
| MODULE_SET_PERMIT_JOIN | 0 | 18 | DATA: 1-byte duration (0=close, 0xFF=always open); is_prefix=true |
| MODULE_NODE_JOIN_NOTIFY | 128 | 3 | **Async RX-only**; expect `55 80 03` prefix |
| MODULE_NODE_LEAVE_NOTIFY | 128 | 6 | **Async RX-only**; expect `55 80 06` prefix |
| MODULE_NODE_ANNOUNCE_NOTIFY | 128 | 5 | **Async RX-only**; expect `55 80 05` prefix |
| MODULE_QUERY_SHORT_ADDR | 1 | 0 | DATA: 8-byte IEEE MAC; response `55 xx 81 00` |
| MODULE_QUERY_NODE_PORT_INFO | 1 | 4 | DATA: 2-byte short addr; response `55 xx 81 04` |
| MODULE_DELETE_NODE | 1 | 52 | DATA: 2-byte short addr; response status 0/0xFF |
| MODULE_ZCL_READ_ATTR | 2 | 0 | DATA: short addr + EP + cluster + attr ID; is_prefix=true |
| MODULE_ZCL_WRITE_ATTR | 2 | 1 | DATA: short addr + EP + cluster + attr + type + value; is_prefix=true |
| MODULE_ZCL_SEND_CONTROL_CMD | 2 | 15 | DATA: short addr + EP + cluster + cmd; is_prefix=true |
| MODULE_ZCL_RECV_CONTROL_CMD | 130 | 15 | **Async RX-only**; expect `55 82 0F` prefix |
| MODULE_ZCL_RECV_ATTR_REPORT | 130 | 10 | **Async RX-only**; expect `55 82 0A` prefix |
| MODULE_ZCL_SET_REPORT_RULE | 2 | 3 | DATA: short addr + EP + cluster + min/max interval + threshold; is_prefix=true |
| MODULE_SEND_UNICAST | 2 | 15 | Wrapper trên ZCL_SEND_CONTROL_CMD với địa chỉ unicast |
| MODULE_SEND_BROADCAST | 2 | 15 | DstAddr = 0xFFFF, DstEP = 0xFF; is_prefix=true |
