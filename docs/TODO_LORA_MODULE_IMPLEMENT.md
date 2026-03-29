# TODO: LoRaWAN Module – JSON Config + Full Handler Implementation

> **Scope**: Tạo toàn bộ lớp LoRaWAN (JSON schema + parser + middleware + app task + config routing) theo đúng pattern của BLE, không thay đổi kiến trúc hiện tại.
>
> **Reference pattern**: `Middleware/BLE_Handler/ble_config.json`, `Middleware/JSON_Config_Parser/*`, `Middleware/BLE_Handler/*`, `Application/BLE_Handler/*`, `Application/Config_Handler/src/config_handler_ble_commands.c`.

---

## Mục lục
1. [Review completeness của nhóm chức năng LoRaWAN](#1-review-completeness)
2. [JSON Schema thiết kế](#2-json-schema)
3. [Danh sách file cần tạo / chỉnh sửa](#3-file-list)
4. [Task chi tiết (ordered)](#4-tasks)

---

## 1. Review Completeness

### 1.1 Nhóm chức năng đã có – đánh giá theo module thị trường

Kiểm tra cross-vendor với:
- **RAK3172 / RAK4630 / RAK4260** (RAK Wireless – AT firmware, phổ biến nhất)
- **Murata CMWX1ZZABZ / Seeed LoRa-E5** (AT firmware)
- **Microchip RN2483 / RN2903** (sublayer `mac`/`radio` syntax khác AT)
- **Heltec LoRa AT** (HT-RA62, HT-M2808)
- **EBYTE E78 / E22-900T22S** (LoRaWAN variant)
- **Dragino LA66** (LoRa + GPS)
- **TTGO / LilyGO T-Beam** (AT firmware variant)

| Nhóm | Function (đề xuất) | RAK | Murata/E5 | RN2483 | Heltec | Kết luận |
|------|--------------------|-----|-----------|--------|--------|----------|
| Lifecycle | MODULE_HW_RESET | ✅ | ✅ | ✅ | ✅ | OK |
| Lifecycle | MODULE_SW_RESET | ✅ | ✅ | ✅ | ✅ | OK |
| Lifecycle | MODULE_GET_INFO | ✅ | ✅ | ✅ | ✅ | OK |
| Lifecycle | MODULE_FACTORY_RESET | ✅ | ✅ | ✅ | ✅ | OK |
| Region/Class | MODULE_SET_REGION | ✅ | ✅ | partial | ✅ | OK |
| Region/Class | MODULE_SET_CLASS | ✅ | ✅ | ✅ | ✅ | OK |
| OTAA | MODULE_SET_JOIN_MODE | ✅ | ✅ | ✅ | ✅ | OK (param OTAA/ABP) |
| OTAA | MODULE_SET_DEVEUI | ✅ | ✅ | ✅ | ✅ | OK |
| OTAA | MODULE_SET_APPEUI | ✅ | ✅ | ✅ | ✅ | OK (alias JOINEUI) |
| OTAA | MODULE_SET_APPKEY | ✅ | ✅ | ✅ | ✅ | OK |
| OTAA | MODULE_JOIN | ✅ | ✅ | ✅ | ✅ | OK |
| ABP | MODULE_SET_DEVADDR | ✅ | ✅ | ✅ | ✅ | OK |
| ABP | MODULE_SET_NWKSKEY | ✅ | ✅ | ✅ | ✅ | OK |
| ABP | MODULE_SET_APPSKEY | ✅ | ✅ | ✅ | ✅ | OK |
| MAC/RF | MODULE_SET_DR | ✅ | ✅ | ✅ | ✅ | OK |
| MAC/RF | MODULE_SET_ADR | ✅ | ✅ | ✅ | ✅ | OK |
| MAC/RF | MODULE_SET_TXP | ✅ | ✅ | ✅ | ✅ | OK |
| MAC/RF | MODULE_SET_CHANNEL | ✅ | ✅ | partial | ✅ | OK (US915/AU915 mask) |
| MAC/RF | MODULE_SET_CONFIRM | ✅ | ✅ | ✅ | ✅ | OK |
| Data | MODULE_SEND_UNCONFIRMED | ✅ | ✅ | ✅ | ✅ | OK |
| Data | MODULE_SEND_CONFIRMED | ✅ | ✅ | ✅ | ✅ | OK |
| Data | MODULE_READ_RECV | ✅ | ✅ | ✅ | ✅ | OK |

### 1.2 Các function **BỔ SUNG** cần thêm vào schema

Những function này MISSING trong list gốc nhưng cần thiết để support đa vendor:

| Thêm mới | Lý do bắt buộc | Vendor cần |
|----------|----------------|------------|
| **MODULE_GET_DEVEUI** | Nhiều module ghi EUI vào OTP khi sản xuất; gateway phải đọc để đăng ký backend trước khi provision | RAK, Murata/E5, RN2483 |
| **MODULE_GET_JOIN_STATUS** | JOIN là async (lệnh trả về "OK" ngay, joined-event đến sau); gateway poll/wait status trước khi gửi data | Tất cả |
| **MODULE_SET_PUBLIC_NET** | Sync word 0x34 (public) vs 0x12 (private); bắt buộc với private LoRa network | RAK (AT+PUBLIC), RN2483, E78 |
| **MODULE_SET_PORT** | FPort (1-223) định tuyến payload đến application endpoint trên server; bắt buộc khi multi-app trên cùng DevEUI | RAK (AT+APPPORT=), Wio-E5 (AT+PORT=), RN2483 |

### 1.3 Danh sách function cuối cùng (gateway build)

```
Lifecycle    (4): HW_RESET, SW_RESET, GET_INFO, FACTORY_RESET
Region/Class (2): SET_REGION, SET_CLASS
OTAA         (6): SET_JOIN_MODE, SET_DEVEUI, GET_DEVEUI, SET_APPEUI, SET_APPKEY, JOIN
Join/Status  (1): GET_JOIN_STATUS
ABP          (3): SET_DEVADDR, SET_NWKSKEY, SET_APPSKEY
MAC/RF       (6): SET_DR, SET_ADR, SET_TXP, SET_CHANNEL, SET_CONFIRM, SET_PORT
RF           (1): SET_PUBLIC_NET
Data         (3): SEND_UNCONFIRMED, SEND_CONFIRMED, READ_RECV
             ──────────────────────────────────────────────
TOTAL        26 functions  (C enum capacity: LORA_FUNC_COUNT=28, 26 defined + 2 reserved)
```

---

## 2. JSON Schema

### 2.1 Cấu trúc – giữ ĐỒNG nhất với BLE

```jsonc
{
    "module_id": "010",           // 3-char string, stack-specific ID
    "module_type": "LORA",        // phân biệt với "BLE", "ZIGBEE"
    "module_name": "RAK3172",     // vendor model name

    "module_communication": {     // GIỐNG hệt BLE schema
        "port_type": "uart",
        "parameters": {
            "baudrate": 115200,
            "parity": "none",
            "stopbit": 1
        }
    },

    "functions": [                // mảng giống BLE, cùng field set
        {
            "function_name": "MODULE_HW_RESET",
            "command": "",
            "is_prefix": false,
            "gpio_start_control": [{ "pin": "01", "state": "LOW" }],
            "delay_start": 100,
            "expect_response": "",
            "timeout": 0,
            "gpio_end_control": [{ "pin": "01", "state": "HIGH" }],
            "delay_end": 500
        },
        {
            "function_name": "MODULE_SW_RESET",
            "command": "ATZ\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 2000,
            "gpio_end_control": [],
            "delay_end": 1000
        },
        {
            "function_name": "MODULE_GET_INFO",
            "command": "AT+VER=?\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_FACTORY_RESET",
            "command": "ATR\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 5000,
            "gpio_end_control": [],
            "delay_end": 2000
        },
        {
            "function_name": "MODULE_SET_REGION",
            "command": "AT+BAND=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_CLASS",
            "command": "AT+CLASS=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_JOIN_MODE",
            "command": "AT+NJM=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_DEVEUI",
            "command": "AT+DEVEUI=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_GET_DEVEUI",
            "command": "AT+DEVEUI=?\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+DEVEUI:",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_APPEUI",
            "command": "AT+APPEUI=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_APPKEY",
            "command": "AT+APPKEY=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_NWKKEY",
            "command": "AT+NWKKEY=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_JOIN",
            "command": "AT+JOIN=1:0:10:8\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 30000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_GET_JOIN_STATUS",
            "command": "AT+NJS=?\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+NJS:",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_DEVADDR",
            "command": "AT+DEVADDR=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_GET_DEVADDR",
            "command": "AT+DEVADDR=?\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+DEVADDR:",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_NWKSKEY",
            "command": "AT+NWKSKEY=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_APPSKEY",
            "command": "AT+APPSKEY=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_DR",
            "command": "AT+DR=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_ADR",
            "command": "AT+ADR=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_TXP",
            "command": "AT+TXP=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_CHANNEL",
            "command": "AT+MASK=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_CONFIRM",
            "command": "AT+CFM=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_PUBLIC_NET",
            "command": "AT+PUBLIC=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_RX2",
            "command": "AT+RX2=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_PORT",
            "command": "AT+FPORT=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SET_NBTRIALS",
            "command": "AT+RETY=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_LINK_CHECK",
            "command": "AT+LINKCHECK=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+EVT:LINKCHECK:",
            "timeout": 15000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SEND_UNCONFIRMED",
            "command": "AT+SEND=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+EVT:SEND_CONFIRMED",
            "timeout": 30000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SEND_CONFIRMED",
            "command": "AT+SEND=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+EVT:SEND_CONFIRMED",
            "timeout": 30000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_SEND_HEX",
            "command": "AT+SEND=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+EVT:SEND_CONFIRMED",
            "timeout": 30000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_READ_RECV",
            "command": "AT+RECV=?\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+RECV:",
            "timeout": 2000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_DUTY_CYCLE_STATUS",
            "command": "AT+DUTYTIME=?\r\n",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "+DUTYTIME:",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 0
        },
        {
            "function_name": "MODULE_ENTER_SLEEP",
            "command": "AT+SLEEP=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 1000,
            "gpio_end_control": [],
            "delay_end": 100
        },
        {
            "function_name": "MODULE_WAKEUP",
            "command": "",
            "is_prefix": false,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "",
            "timeout": 0,
            "gpio_end_control": [],
            "delay_end": 300
        },
        {
            "function_name": "MODULE_SET_LPM",
            "command": "AT+LPM=",
            "is_prefix": true,
            "gpio_start_control": [],
            "delay_start": 0,
            "expect_response": "OK",
            "timeout": 500,
            "gpio_end_control": [],
            "delay_end": 0
        }
    ]
}
```

---

## 3. File list

### Tạo mới (NEW)

| # | File | Mô tả |
|---|------|--------|
| 1 | `DA2_esp_LAN/Middleware/LoRa_Handler/lora_config.json` | JSON config mẫu đầy đủ 25 functions (RAK3172) |
| 2 | `DA2_esp_LAN/Middleware/JSON_Config_Parser/include/json_lora_config_parser.h` | Header parser LoRa – mirror `json_ble_config_parser.h` |
| 3 | `DA2_esp_LAN/Middleware/JSON_Config_Parser/src/json_lora_config_parser.c` | Implementation parser LoRa – mirror `json_ble_config_parser.c` |
| 4 | `DA2_esp_LAN/Middleware/LoRa_Handler/include/lora_handler.h` | Middleware handler header – mirror `ble_handler.h` |
| 5 | `DA2_esp_LAN/Middleware/LoRa_Handler/src/lora_handler.c` | Middleware handler implementation – mirror `ble_handler.c` |
| 6 | `DA2_esp_LAN/Application/LoRa_Handler/include/lora_handler_task.h` | App task header – mirror `ble_handler_task.h` |
| 7 | `DA2_esp_LAN/Application/LoRa_Handler/src/lora_handler_task.c` | App task implementation – mirror `ble_handler_task.c` |
| 8 | `DA2_esp_LAN/Application/Config_Handler/include/config_handler_lora_commands.h` | LoRa command parser header |
| 9 | `DA2_esp_LAN/Application/Config_Handler/src/config_handler_lora_commands.c` | LoRa command parser implementation – mirror `config_handler_ble_commands.c` |

### Chỉnh sửa (MODIFY)

| # | File | Thay đổi |
|---|------|----------|
| 10 | `DA2_esp_LAN/Application/Config_Handler/include/config_handler.h` | Thêm `CONFIG_UPDATE_LORA_JSON = 8`, `CONFIG_UPDATE_LORA_CMD = 9` vào enum `config_type_t`; replace `CONFIG_UPDATE_LORA = 1` placeholder |
| 11 | `DA2_esp_LAN/Application/Config_Handler/src/config_handler.c` | Thêm parse logic `CFLR:JSON:` và `CFLR:` trong `config_parse_type()`; thêm 2 case vào switch routing |
| 12 | `DA2_esp_LAN/Application/Module_Monitor_Task/src/module_monitor_task.c` | Implement `module_start_handler_task()` và `module_stop_handler_task()` cho `MODULE_TYPE_LORA`; thêm `#include "lora_handler_task.h"` |

---

## 4. Tasks (ordered)

---

### TASK 1 – Tạo file JSON mẫu

**File**: `DA2_esp_LAN/Middleware/LoRa_Handler/lora_config.json`

Nội dung: copy đúng JSON schema ở Section 2.1. Đây là config mẫu cho RAK3172 UART 115200, band EU868, 25 functions.

**Acceptance**: File parse được bằng `cat` và valid JSON syntax.

---

### TASK 2 – Tạo `json_lora_config_parser.h`

**File**: `DA2_esp_LAN/Middleware/JSON_Config_Parser/include/json_lora_config_parser.h`

**Yêu cầu** (mirror chính xác pattern của `json_ble_config_parser.h`):

```c
#ifndef JSON_LORA_CONFIG_PARSER_H
#define JSON_LORA_CONFIG_PARSER_H

#include "json_config_parser.h"

#define LORA_MAX_FUNCTIONS  40          // 37 defined + 3 reserved
#define LORA_COMMAND_LEN    128
#define LORA_RESPONSE_LEN   64

typedef enum {
    // ── Lifecycle (0–3) ──────────────────────────────────────────────────────
    JSON_LORA_FUNC_HW_RESET = 0,
    JSON_LORA_FUNC_SW_RESET,
    JSON_LORA_FUNC_GET_INFO,
    JSON_LORA_FUNC_FACTORY_RESET,
    // ── Region / Class (4–5) ─────────────────────────────────────────────────
    JSON_LORA_FUNC_SET_REGION,
    JSON_LORA_FUNC_SET_CLASS,
    // ── OTAA Provisioning (6–12) ─────────────────────────────────────────────
    JSON_LORA_FUNC_SET_JOIN_MODE,
    JSON_LORA_FUNC_SET_DEVEUI,
    JSON_LORA_FUNC_GET_DEVEUI,
    JSON_LORA_FUNC_SET_APPEUI,
    JSON_LORA_FUNC_SET_APPKEY,
    JSON_LORA_FUNC_SET_NWKKEY,
    JSON_LORA_FUNC_JOIN,
    // ── Join Status / ABP (13–18) ─────────────────────────────────────────────
    JSON_LORA_FUNC_GET_JOIN_STATUS,
    JSON_LORA_FUNC_SET_DEVADDR,
    JSON_LORA_FUNC_GET_DEVADDR,
    JSON_LORA_FUNC_SET_NWKSKEY,
    JSON_LORA_FUNC_SET_APPSKEY,
    // ── MAC / RF (18–24) ─────────────────────────────────────────────────────
    JSON_LORA_FUNC_SET_DR,
    JSON_LORA_FUNC_SET_ADR,
    JSON_LORA_FUNC_SET_TXP,
    JSON_LORA_FUNC_SET_CHANNEL,
    JSON_LORA_FUNC_SET_CONFIRM,
    JSON_LORA_FUNC_SET_PUBLIC_NET,
    JSON_LORA_FUNC_SET_RX2,
    // ── Config extras (25–27) ────────────────────────────────────────────────
    JSON_LORA_FUNC_SET_PORT,
    JSON_LORA_FUNC_SET_NBTRIALS,
    JSON_LORA_FUNC_LINK_CHECK,
    // ── Data plane (28–31) ───────────────────────────────────────────────────
    JSON_LORA_FUNC_SEND_UNCONFIRMED,
    JSON_LORA_FUNC_SEND_CONFIRMED,
    JSON_LORA_FUNC_SEND_HEX,
    JSON_LORA_FUNC_READ_RECV,
    // ── Diagnostics (32) ─────────────────────────────────────────────────────
    JSON_LORA_FUNC_DUTY_CYCLE_STATUS,
    // ── Power (33–35) ────────────────────────────────────────────────────────
    JSON_LORA_FUNC_ENTER_SLEEP,
    JSON_LORA_FUNC_WAKEUP,
    JSON_LORA_FUNC_SET_LPM,
    // sentinel
    JSON_LORA_FUNC_MAX
} json_lora_function_id_t;

typedef struct {
    bool available;
    json_lora_function_id_t function_id;
    char command[LORA_COMMAND_LEN];
    bool is_prefix;
    gpio_control_t gpio_start[MAX_GPIO_ACTIONS];
    uint8_t gpio_start_count;
    uint16_t delay_start_ms;
    char expect_response[LORA_RESPONSE_LEN];
    uint16_t timeout_ms;
    gpio_control_t gpio_end[MAX_GPIO_ACTIONS];
    uint8_t gpio_end_count;
    uint16_t delay_end_ms;
} json_lora_function_config_t;

typedef struct {
    module_metadata_t metadata;
    json_lora_function_config_t functions[LORA_MAX_FUNCTIONS];
    uint8_t function_count;
} json_lora_module_config_t;

esp_err_t json_lora_config_parse(const char *json_str, json_lora_module_config_t *config);

#endif // JSON_LORA_CONFIG_PARSER_H
```

---

### TASK 3 – Tạo `json_lora_config_parser.c`

**File**: `DA2_esp_LAN/Middleware/JSON_Config_Parser/src/json_lora_config_parser.c`

**Yêu cầu**: Copy full logic của `json_ble_config_parser.c`, thay thế:
- Tên hằng `BLE_FUNCTION_NAMES[]` → `LORA_FUNCTION_NAMES[]`
- Exact 37 tên string khớp enum theo thứ tự (xem list ở Task 2)
- `BLE_MAX_FUNCTIONS` → `LORA_MAX_FUNCTIONS`
- `JSON_BLE_FUNC_MAX` → `JSON_LORA_FUNC_MAX`
- Kiểm tra `module_type == "LORA"` thay vì `"BLE"`
- Tên hàm: `json_lora_config_parse()`
- TAG log: `"LORA_PARSER"`

**Danh sách `LORA_FUNCTION_NAMES[]` theo thứ tự enum**:
```
"MODULE_HW_RESET",        // 0
"MODULE_SW_RESET",        // 1
"MODULE_GET_INFO",        // 2
"MODULE_FACTORY_RESET",   // 3
"MODULE_SET_REGION",      // 4
"MODULE_SET_CLASS",       // 5
"MODULE_SET_JOIN_MODE",   // 6
"MODULE_SET_DEVEUI",      // 7
"MODULE_GET_DEVEUI",      // 8
"MODULE_SET_APPEUI",      // 9
"MODULE_SET_APPKEY",      // 10
"MODULE_SET_NWKKEY",      // 11
"MODULE_JOIN",            // 12
"MODULE_GET_JOIN_STATUS", // 13
"MODULE_SET_DEVADDR",     // 14
"MODULE_GET_DEVADDR",     // 15
"MODULE_SET_NWKSKEY",     // 16
"MODULE_SET_APPSKEY",     // 17
"MODULE_SET_DR",          // 18
"MODULE_SET_ADR",         // 19
"MODULE_SET_TXP",         // 20
"MODULE_SET_CHANNEL",     // 21
"MODULE_SET_CONFIRM",     // 22
"MODULE_SET_PUBLIC_NET",  // 23
"MODULE_SET_RX2",         // 24
"MODULE_SET_PORT",        // 25
"MODULE_SET_NBTRIALS",    // 26
"MODULE_LINK_CHECK",      // 27
"MODULE_SEND_UNCONFIRMED",// 28
"MODULE_SEND_CONFIRMED",  // 29
"MODULE_SEND_HEX",        // 30
"MODULE_READ_RECV",       // 31
"MODULE_DUTY_CYCLE_STATUS",// 32
"MODULE_ENTER_SLEEP",     // 33
"MODULE_WAKEUP",          // 34
"MODULE_SET_LPM"          // 35
```

---

### TASK 4 – Tạo `lora_handler.h`

**File**: `DA2_esp_LAN/Middleware/LoRa_Handler/include/lora_handler.h`

**Yêu cầu**: Mirror chính xác `ble_handler.h`:

- Enum `lora_function_id_t` với 37 values + `LORA_FUNC_COUNT = 40` + `LORA_FUNC_INVALID = 0xFF`
- Giữ nguyên thứ tự và tên logic song song với `json_lora_function_id_t`
- Struct `lora_function_config_t` (giống `ble_function_config_t`)
- Struct `lora_module_config_t` (giống `ble_module_config_t`)
- Struct `lora_exec_result_t` (giống `ble_exec_result_t`)
- Public API:
  - `lora_handler_init()`
  - `lora_handler_load_config(stack_id, json_config, json_len)`
  - `lora_handler_hw_reset(stack_id)`
  - `lora_handler_sw_reset(stack_id)`
  - `lora_handler_factory_reset(stack_id)`
  - `lora_handler_get_info(stack_id, buffer, max_len)`
  - `lora_handler_join(stack_id)`
  - `lora_handler_get_join_status(stack_id, buffer, max_len)`
  - `lora_handler_get_function_by_command(stack_id, command, func_config)`
  - `lora_handler_execute_command_with_config(stack_id, command, func_config, result)`
  - `lora_handler_send_binary_command(stack_id, cmd_bytes, cmd_len, response, resp_len, timeout_ms)`
  - `lora_handler_listen(stack_id, buf, max, out_len)` – short non-blocking read; returns `ESP_ERR_TIMEOUT` if bus busy or no data

---

### TASK 5 – Tạo `lora_handler.c`

**File**: `DA2_esp_LAN/Middleware/LoRa_Handler/src/lora_handler.c`

**Yêu cầu**: Mirror chính xác `ble_handler.c`:

- Copy toàn bộ implementation, thay thế:
  - `ble_` → `lora_`
  - `BLE_` → `LORA_`
  - `g_ble_handler` → `g_lora_handler`
  - `json_ble_config_parse()` → `json_lora_config_parse()`
  - type check `"BLE"` → `"LORA"`
  - TAG: `"LORA_HANDLER"`
  - Binary marker: `LORA_BINARY_CMD_MARKER 0xC0` (giữ nguyên)
  - Function name table `s_lora_func_names[]` = 37 entries theo thứ tự
  - `lora_handler_init()` không gọi UART init ngay (lazy init khi load config)
  - `lora_handler_load_config()` verify `module_type == "LORA"`
  - startup sequence trong `lora_handler_task_load_config()`: `lora_handler_hw_reset()` → delay 500ms → gọi `lora_handler_get_info()` (không có enter_cmd_mode vì LoRa AT modules thường không có cmd mode toggle)

**Chú ý**:
- `lora_execute_function_internal()`: giữ nguyên logic GPIO + delay + send + read_until_terminator
- `lora_read_until_terminator()`: copy từ `ble_read_until_terminator()`, tăng chunk timeout lên 500ms vì LoRa response chậm hơn BLE (JOIN có thể mất 6–10s)
- `lora_handler_get_function_by_command()`: copy từ `ble_handler_get_function_by_command()`, giữ nguyên 2-pass logic (prefix match + function_name fallback)

**Bus Mutex (per-stack) – BẮT BUỘC:**

Thêm 2 mutex song song với BLE pattern để serialise bus access giữa command task và background listener:

```c
// Trong lora_handler.c – khai báo cùng vị trí với g_lora_handler_mutex
static SemaphoreHandle_t g_lora_bus_mutex[LORA_MAX_STACKS] = {NULL, NULL};

// Trong lora_handler_init() – khởi tạo sau g_lora_handler_mutex
for (int i = 0; i < LORA_MAX_STACKS; i++) {
    g_lora_bus_mutex[i] = xSemaphoreCreateMutex();
    // check NULL ...
}

// Trong lora_execute_function_internal() – take TRƯỚC module_bus_write, give ở mọi early-return và sau read
if (xSemaphoreTake(g_lora_bus_mutex[stack_id], pdMS_TO_TICKS(10000)) != pdTRUE) {
    // LoRa JOIN timeout lên đến 10s → cần mutex timeout tương đương
    return ESP_ERR_TIMEOUT;
}
// ... module_bus_write → lora_read_until_terminator ...
xSemaphoreGive(g_lora_bus_mutex[stack_id]);

// Tương tự cho lora_handler_execute_command_with_config() và lora_handler_send_binary_command()
```

**Implement `lora_handler_listen()`:**

```c
esp_err_t lora_handler_listen(uint8_t stack_id, char *buf, size_t max, size_t *out_len) {
    // Non-blocking mutex trylock (50 ms): nếu command task đang giữ bus → trả về TIMEOUT ngay
    if (xSemaphoreTake(g_lora_bus_mutex[stack_id], pdMS_TO_TICKS(50)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    // Short read: 100 ms (LoRa UART có thể slow-start, dùng 100ms thay vì 50ms của BLE)
    uint8_t chunk[LORA_RESPONSE_CHUNK];
    size_t chunk_len = 0;
    esp_err_t ret = module_bus_read(stack_id, port_type, chunk, sizeof(chunk) - 1, 100, &chunk_len);
    if (chunk_len > 0) {
        size_t copy = (chunk_len < max - 1) ? chunk_len : max - 1;
        memcpy(buf, chunk, copy);
        buf[copy] = '\0';
        *out_len = copy;
        ret = ESP_OK;
    } else {
        ret = ESP_ERR_TIMEOUT;
    }
    xSemaphoreGive(g_lora_bus_mutex[stack_id]);
    return ret;
}
```

**FIX BẮT BUỘC – CRLF auto-append (khác BLE):**

RN2483/RN2903 dùng syntax `mac ...`, `sys ...`, `radio ...` – không bắt đầu bằng `AT`.
Nếu copy nguyên logic này sang `lora_handler.c`, mọi RN2483 command sẽ thiếu `\r\n` → module không nhận ra delimiter → timeout.

Trong `lora_handler.c`, thay bằng logic **generic** (không check "AT" prefix):
```c
// lora_handler.c – generic CRLF append cho MỌI command
char lora_cmd_buf[LORA_CMD_MAX_LEN] = {0};
const uint8_t *write_ptr = (const uint8_t *)command;
size_t write_len = cmd_len;
if (cmd_len >= 2 &&
    (command[cmd_len - 2] != '\r' || command[cmd_len - 1] != '\n')) {
    strncpy(lora_cmd_buf, command, sizeof(lora_cmd_buf) - 3);
    lora_cmd_buf[sizeof(lora_cmd_buf) - 3] = '\0';
    strcat(lora_cmd_buf, "\r\n");
    write_ptr = (const uint8_t *)lora_cmd_buf;
    write_len = strlen(lora_cmd_buf);
    ESP_LOGD(TAG, "Appended CRLF to LoRa command");
}
```
Điều này đảm bảo:
- `AT+BAND=4` → `AT+BAND=4\r\n` ✅ (RAK3172)
- `mac set deveui 01020304` → `mac set deveui 01020304\r\n` ✅ (RN2483)
- `ATZ\r\n` (đã có `\r\n` trong JSON) → giữ nguyên ✅
- `mac join otaa\r\n` (đã có `\r\n` trong JSON) → giữ nguyên ✅

---

### TASK 6 – Tạo `lora_handler_task.h`

**File**: `DA2_esp_LAN/Application/LoRa_Handler/include/lora_handler_task.h`

**Yêu cầu**: Mirror chính xác `ble_handler_task.h`:

- `lora_uplink_packet_t`
- `lora_downlink_packet_t`
- `lora_command_request_t` (dùng `lora_function_config_t` thay vì `ble_function_config_t`)
- Public API:
  - `lora_handler_task_start(stack_id)`
  - `lora_handler_task_stop(stack_id)`
  - `lora_handler_is_running(stack_id)`
  - `lora_handler_task_load_config(stack_id, json_config, len)`
  - `lora_handler_task_execute_command(request)`
  - `lora_handler_task_enqueue_uplink(stack_id, data, len)`
  - `lora_handler_task_enqueue_downlink(data, len)`
  - `lora_handler_task_execute_command(request)`

*(Background listener task là internal – không cần public API)*

---

### TASK 7 – Tạo `lora_handler_task.c`

**File**: `DA2_esp_LAN/Application/LoRa_Handler/src/lora_handler_task.c`

**Yêu cầu**: Mirror `ble_handler_task.c`:

- Copy full implementation, thay thế:
  - `ble_` → `lora_`
  - `BLE_` → `LORA_`
  - `HANDLER_BLE` → `HANDLER_LORA`
  - Response format: `"CFLR:%d:OK:%s"` / `"CFLR:%d:FAIL:%s"`
  - TAG: `"LORA_TASK"`
  - Task names: `"lora_ul_s%d"`, `"lora_dl_s%d"`, `"lora_ls_s%d"` (listener)
  - Stack sizes: uplink `16*1024`, downlink `16*1024`, **listener `8*1024`**
- `lora_handler_task_load_config()`:
  - Gọi `lora_handler_load_config()` (middleware)
  - Startup sequence: `lora_handler_hw_reset()` → `vTaskDelay(500ms)` → `lora_handler_get_info()`
  - **Không** gọi `enter_cmd_mode` (khác với BLE)

**Background Listener Task – BẮT BUỘC:**

Thêm `lora_listener_task()` theo đúng pattern của `ble_listener_task()` trong `ble_handler_task.c`:

```c
// Defines cần thêm:
#define LORA_LISTENER_TASK_STACK_SIZE  (8 * 1024)
#define LORA_LISTENER_TASK_PRIORITY    4
#define LORA_LISTEN_BUFFER_SIZE        512

// State struct cần thêm field:
TaskHandle_t listener_task_handle[LORA_MAX_STACKS_TASK];

// Task function: mirror ble_listener_task() nhưng:
// - Gọi lora_handler_listen() thay vì ble_handler_listen()
// - Event format: "CFLR:%d:EVT:%s"
// - Yield 20ms khi bus busy (timeout), 50ms khi error
// - malloc 3 buffers: listen_buf, clean_buf, evt_packet

// Start/stop: tạo/xoá task listener trong lora_handler_task_start/stop()
// Listener failure là non-fatal (uplink/downlink vẫn hoạt động)
```

Event packet format: `"CFLR:<stack_id>:EVT:<data>"` → gửi qua `mcu_wan_enqueue_uplink(HANDLER_LORA, ...)`.

---

### TASK 8 – Tạo `config_handler_lora_commands.h`

**File**: `DA2_esp_LAN/Application/Config_Handler/include/config_handler_lora_commands.h`

**Yêu cầu**: Mirror `config_handler_ble_commands.h`:

```c
// Hai hàm công khai:
esp_err_t config_parse_lora_command(const uint8_t *data, uint16_t len);
esp_err_t config_parse_lora_json(const uint8_t *data, uint16_t len);
```

Format command:
- JSON config: `"CFLR:JSON:<stack_id>:<json_data>"`
- Execute command: `"CFLR:<stack_id>:<command>"`
- Response JSON OK: `"CFLR:JSON:OK"`
- Response JSON FAIL: `"CFLR:JSON:FAIL:<reason>"`
- Response CMD OK: `"CFLR:<stack_id>:OK:<response>"`
- Response CMD FAIL: `"CFLR:<stack_id>:FAIL:<reason>"`

---

### TASK 9 – Tạo `config_handler_lora_commands.c`

**File**: `DA2_esp_LAN/Application/Config_Handler/src/config_handler_lora_commands.c`

**Yêu cầu**: Mirror `config_handler_ble_commands.c`:

- `config_parse_lora_command()`:
  - Parse `"CFLR:<stack_id>:<command>"`
  - Gọi `lora_handler_get_function_by_command()`
  - Enqueue vào `lora_handler_task_execute_command()`
- `config_parse_lora_json()`:
  - Parse `"CFLR:JSON:<stack_id>:<json_data>"`
  - Gọi `module_monitor_send_config()`
  - ACK response qua `mcu_wan_enqueue_uplink(HANDLER_LORA, ...)`
- Include: `"lora_handler.h"`, `"lora_handler_task.h"`, `"config_handler_lora_commands.h"`
- TAG: `"lora_commands"`

---

### TASK 10 – Modify `config_handler.h`

**File**: `DA2_esp_LAN/Application/Config_Handler/include/config_handler.h`

**Thay đổi**: Trong enum `config_type_t`:
- Replace `CONFIG_UPDATE_LORA = 1` (placeholder cũ) thành:
  ```c
  CONFIG_UPDATE_LORA_JSON = 8,   // "CFLR:JSON" - LoRa JSON config
  CONFIG_UPDATE_LORA_CMD  = 9,   // "CFLR:<stack>:<cmd>" - LoRa command
  ```
- Giữ item `= 1` slot nếu không có gì đặt vào; hoặc comment "reserved".

---

### TASK 11 – Modify `config_handler.c`

**File**: `DA2_esp_LAN/Application/Config_Handler/src/config_handler.c`

**Thay đổi 1** – Thêm `#include`:
```c
#include "config_handler_lora_commands.h"
```

**Thay đổi 2** – Trong `config_parse_type()`, thêm block nhận biết `CFLR:`:
```c
} else if (cmd[2] == 'L' && cmd[3] == 'R') {
    // LoRa commands
    if (len >= 10 && strncmp(cmd + 5, "JSON:", 5) == 0) {
        return CONFIG_UPDATE_LORA_JSON;
    } else {
        return CONFIG_UPDATE_LORA_CMD;
    }
}
```

**Thay đổi 3** – Trong `config_handler_task()` switch, thêm 2 case sau BLE cases:
```c
case CONFIG_UPDATE_LORA_JSON: {
    if (config_parse_lora_json((const uint8_t *)cmd->raw_data, cmd->data_len) == ESP_OK) {
        ESP_LOGI(TAG, "LoRa JSON config loaded");
    } else {
        ESP_LOGE(TAG, "Failed to parse LoRa JSON config");
    }
    break;
}
case CONFIG_UPDATE_LORA_CMD: {
    if (config_parse_lora_command((const uint8_t *)cmd->raw_data, cmd->data_len) == ESP_OK) {
        ESP_LOGI(TAG, "LoRa command executed successfully");
    } else {
        ESP_LOGE(TAG, "Failed to execute LoRa command");
    }
    break;
}
```

---

### TASK 12 – Modify `module_monitor_task.c`

**File**: `DA2_esp_LAN/Application/Module_Monitor_Task/src/module_monitor_task.c`

**Thay đổi 1** – Thêm include:
```c
#include "lora_handler_task.h"
```

**Thay đổi 2** – Trong `module_start_handler_task()`, replace TODO stub cho LoRa:
```c
case MODULE_TYPE_LORA:
    ESP_LOGI(TAG, "Starting LoRa handler for Stack %d", stack_id);
    return lora_handler_task_start(stack_id);
```

**Thay đổi 3** – Trong `module_stop_handler_task()`, replace TODO stub cho LoRa:
```c
case MODULE_TYPE_LORA:
    return lora_handler_task_stop(stack_id);
```

**Thay đổi 4** – Trong `module_monitor_task_impl()` (phần sau config OK), thêm handler cho LoRa sau BLE block:
```c
} else if (info->module_type == MODULE_TYPE_LORA) {
    esp_err_t cfg_ret = lora_handler_task_load_config(msg.stack_id,
                                                      info->json_config_str,
                                                      info->json_config_len);
    if (cfg_ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to load config into LoRa handler for Stack %d", msg.stack_id);
        uint8_t error_resp[] = "CFLR:JSON:FAIL:LOAD";
        mcu_wan_enqueue_uplink(HANDLER_LORA, error_resp, sizeof(error_resp) - 1);
    } else {
        uint8_t ok_resp[] = "CFLR:JSON:OK";
        mcu_wan_enqueue_uplink(HANDLER_LORA, ok_resp, sizeof(ok_resp) - 1);
    }
}
```

**Thay đổi 5** – Trong NVS restore block (boot path), thêm LoRa config load sau BLE block:
```c
} else if (info->module_type == MODULE_TYPE_LORA) {
    esp_err_t cfg_ret = lora_handler_task_load_config(i,
                                                      info->json_config_str,
                                                      info->json_config_len);
    if (cfg_ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to load LoRa config after NVS restore (Stack %d)", i);
    } else {
        ESP_LOGI(TAG, "LoRa handler config loaded after NVS restore (Stack %d)", i);
    }
}
```

---

### TASK 13 – Kiểm tra `frame_types.h` và `mcu_wan_handler`

**File**: `DA2_esp_LAN/Application/MCU_WAN_Handler/include/frame_types.h`

**Kiểm tra**: Có `HANDLER_LORA` trong enum handler types không. Nếu chưa có → thêm:
```c
HANDLER_LORA = 2,   // LoRa module uplink/downlink
```

---

### TASK 14 – Build verification

Sau khi implement xong tất cả file:

1. Chạy `idf.py build` trong `DA2_esp_LAN/`
2. Verify không có warning `unused variable`, `implicit declaration`
3. Check stack usage report: task `lora_ul_s0/s1` và `lora_dl_s0/s1` không vượt 16KB
4. Verify `lora_config.json` parse OK bằng log `LORA_PARSER` khi load config

---

## 5. Checklist tổng

> **Trạng thái: HOÀN THÀNH ✅** – Tất cả 14 tasks đã được implement. Cập nhật thêm: thêm MODULE_SET_PORT (function 25), fix stack_003_app_commands.json sang raw AT command format.

| Task | File | Status |
|------|------|--------|
| 1 | `lora_config.json` | ✅ |
| 2 | `json_lora_config_parser.h` | ✅ |
| 3 | `json_lora_config_parser.c` | ✅ |
| 4 | `lora_handler.h` | ✅ |
| 5 | `lora_handler.c` | ✅ |
| 6 | `lora_handler_task.h` | ✅ |
| 7 | `lora_handler_task.c` | ✅ |
| 8 | `config_handler_lora_commands.h` | ✅ |
| 9 | `config_handler_lora_commands.c` | ✅ |
| 10 | `config_handler.h` (modify) | ✅ |
| 11 | `config_handler.c` (modify) | ✅ |
| 12 | `module_monitor_task.c` (modify) | ✅ |
| 13 | `frame_types.h` (verify/add HANDLER_LORA) | ✅ |
| 14 | Build verification | ✅ |
