# CẬP NHẬT NỘI DUNG BÁO CÁO ĐỒ ÁN — TIẾN ĐỘ 50%

> **Họ tên:** Nguyễn Hoàng Triều — MSSV: 2213612
> **Ngày cập nhật:** Tháng 3, 2026
> **Phạm vi tài liệu này:** Gợi ý nội dung cần bổ sung / cập nhật cho từng chương trong báo cáo 50%. Các chương phần cứng (chỉ có tiêu đề) và chương Kết luận **không cần cập nhật**, tập trung vào các chương phần mềm.

---

## MỤC LỤC CẬP NHẬT

1. [Chương 2 — Kiến trúc phần mềm hệ thống](#chuong-2--kien-truc-phan-mem-he-thong)
2. [Chương 3 — Module Base Setting (cấu hình module bằng JSON)](#chuong-3--module-base-setting-cau-hinh-module-bang-json)
3. [Chương 4 — Web Config Portal (cổng cấu hình nhúng)](#chuong-4--web-config-portal-cong-cau-hinh-nhung)
4. [Chương 5 — BLE Mesh Native trên ESP32-S3](#chuong-5--ble-mesh-native-tren-esp32-s3)
5. [Chương 6 — Ứng dụng kiểm thử: Điều khiển đèn Tuya E27](#chuong-6--ung-dung-kiem-thu-dieu-khien-den-tuya-e27)
6. [Chương 7 — Cập nhật bo mạch phần cứng mới](#chuong-7--cap-nhat-bo-mach-phan-cung-moi)
7. [Hướng tiếp theo (Công việc còn lại)](#huong-tiep-theo)

---

## CHƯƠNG 2 — KIẾN TRÚC PHẦN MỀM HỆ THỐNG

### Nội dung cần bổ sung

Phần này mô tả tổng quan kiến trúc phần mềm của toàn hệ thống — nên đặt trước các chương triển khai cụ thể để người đọc nắm được bức tranh tổng thể.

---

### 2.1 Tổng quan hệ thống Dual-MCU

Hệ thống DA2 Gateway gồm hai vi điều khiển ESP32-S3 hoạt động phối hợp:

| Thành phần | Vai trò |
|---|---|
| `DA2_esp` (WAN MCU) | Kết nối Internet (WiFi / LTE 4G), MQTT/HTTP/CoAP lên server, Web Config Portal, firmware FOTA |
| `DA2_esp_LAN` (LAN MCU) | Quản lý module RF (BLE / LoRa / Zigbee / RS485), lưu trữ SD Card, Module Base Setting |
| `STM32WB55` | Module BLE Central — giao tiếp AT command với LAN MCU |
| `DATN_config_app` | Python Tkinter PC App — cấu hình ban đầu qua UART/USB |

---

### 2.2 Sơ đồ kiến trúc hệ thống

```mermaid
graph TB
    subgraph Server["☁️ Cloud Server (ThingsBoard / HTTP / CoAP)"]
        MQTT[MQTT Broker]
        HTTP[HTTP REST API]
    end

    subgraph PC["💻 Máy tính kỹ sư"]
        APP[Python Config App\nDAT_config_app]
        BROWSER[Trình duyệt Web\nhttp://gateway.local]
    end

    subgraph WAN["DA2_esp — WAN MCU (ESP32-S3)"]
        WEB[Web Config Portal\nAP + STA mode]
        CFG_WAN[Config Handler\nWF / LT / MQ / HP / CP]
        SERVER_COMM[Server Communication\nMQTT / HTTP / CoAP]
        MCU_LAN_HDLR[MCU LAN Handler\nSPI Master→Slave]
        LTE[LTE 4G Handler\nA7600 / SIM7600]
        WIFI[WiFi Handler]
        FOTA_WAN[FOTA WAN]
    end

    subgraph LAN["DA2_esp_LAN — LAN MCU (ESP32-S3)"]
        CFG_LAN[Config Handler\nCFBL / CFLR / CFZB / CFRS]
        MONITOR[Module Monitor Task\nLifecycle Manager]
        BLE_HDLR[BLE Handler Task]
        LORA_HDLR[LoRa Handler Task]
        ZB_HDLR[Zigbee Handler Task]
        MESH[BLE Mesh Provisioner\nble_native_handler]
        SD[SD Card Storage\n100KB RAM buffer]
        JSON_PARSER[JSON Config Parser\nBLE / LoRa / Zigbee / RS485]
    end

    subgraph MODULE["📡 Modules RF"]
        STM32[STM32WB55\nBLE Central]
        LORA[LoRa Module\nRAK3172]
        ZBB[Zigbee Module\nE180-ZG120B]
        MESHDEV[Tuya E27\nBLE Mesh Device]
    end

    MQTT -- RPC JSON --> SERVER_COMM
    HTTP -- REST --> SERVER_COMM
    SERVER_COMM --> CFG_WAN
    APP -- UART/USB CFSC protocol --> CFG_WAN
    BROWSER -- HTTP POST /api/config --> WEB
    WEB --> CFG_WAN
    CFG_WAN -- ML:CF... --> MCU_LAN_HDLR
    MCU_LAN_HDLR -- SPI 40MHz + DMA --> CFG_LAN
    CFG_LAN --> MONITOR
    MONITOR --> BLE_HDLR
    MONITOR --> LORA_HDLR
    MONITOR --> ZB_HDLR
    MONITOR --> JSON_PARSER
    BLE_HDLR -- UART 115200 --> STM32
    LORA_HDLR -- UART --> LORA
    ZB_HDLR -- UART --> ZBB
    MESH -- ESP-IDF BLE Mesh API --> MESHDEV
    WAN -- WiFi / USB --> LTE
    WAN -- WiFi --> WIFI
```

---

### 2.3 Phân tầng phần mềm LAN MCU

```mermaid
graph TB
    subgraph APP["Application Layer"]
        A1[Config_Handler]
        A2[BLE_Handler Task]
        A3[LoRa_Handler Task]
        A4[Zigbee_Handler Task]
        A5[Module_Monitor_Task]
        A6[MCU_WAN_Handler]
        A7[RS485_Handler]
    end

    subgraph MW["Middleware Layer"]
        M1[BLE_Handler\nTransport + AT send/recv]
        M2[LoRa_Handler\nTransport]
        M3[Zigbee_Handler\nTransport + HEX frame]
        M4[JSON_Config_Parser\nBLE / LoRa / Zigbee / RS485]
        M5[Module_Config_Controller\nBus init UART/SPI/I2C/USB]
        M6[Storage_Handler\n100KB buffer → SD Card]
    end

    subgraph BSP["BSP Layer"]
        B1[Module_UART_Communication]
        B2[Module_SPI_Communication]
        B3[Module_I2C_Communication]
        B4[Module_USB_Communication]
        B5[MCU_WAN_Communication\nSPI Master 40MHz DMA]
        B6[stack_handler\nTCA6424A GPIO expander]
        B7[SDCard_Communication]
    end

    APP --> MW
    MW --> BSP
```

---

### 2.4 Giao thức lệnh cấu hình (Command Protocol)

Toàn bộ luồng lệnh đi qua hàng đợi trung tâm `g_config_handler_queue`. Phân biệt nguồn lệnh bằng trường `command_source_t`:

| Source | Giá trị | Mô tả |
|---|---|---|
| `CMD_SOURCE_UART` | 0 | PC App kết nối UART/USB |
| `CMD_SOURCE_WAN` | 1 | SPI từ WAN MCU (MQTT/HTTP/Web) |
| `CMD_SOURCE_HTTP` | 3 | Web Config Portal POST /api/config |

**Định tuyến lệnh tại WAN MCU** (prefix 2 ký tự):

| Prefix | Handler |
|---|---|
| `WF` | WiFi config |
| `LT` | LTE config |
| `MQ` | MQTT config |
| `HP` | HTTP config |
| `CP` | CoAP config |
| `SV` | Server type selection |
| `IN` | Internet type selection |
| `ML` | Forward → LAN MCU qua SPI |
| `FW` | FOTA WAN |

**Định tuyến lệnh tại LAN MCU** (prefix 4 ký tự sau `ML:`):

| Prefix | Handler | JSON load | AT/HEX cmd |
|---|---|---|---|
| `CFBL` | BLE AT | `CFBL:0:JSON:<json>` | `CFBL:0:<at_cmd>` |
| `CFLR` | LoRa AT | `CFLR:0:JSON:<json>` | `CFLR:0:<at_cmd>` |
| `CFZB` | Zigbee HEX | `CFZB:0:JSON:<json>` | `CFZB:0:<hex_cmd>` |
| `CFBN` | BLE Mesh Native | `CFBN:JSON:0:<json>` | `CFBN:0:SCAN/PROVISION/CONTROL` |
| `CFBG` | BLE GATT Central | `CFBG:JSON:0:<json>` | `CFBG:0:<cmd>` |
| `CFRS` | RS485 | — | `CFRS:BR:<baud>` |
| `CFFW` | FOTA LAN | — | `CFFW:<url>` |
| `CFSC` | Config Scan (đọc) | — | — |

---

## CHƯƠNG 3 — MODULE BASE SETTING (CẤU HÌNH MODULE BẰNG JSON)

### Nội dung cần bổ sung

Đây là đóng góp kỹ thuật chính của đồ án — cần trình bày kỹ nhất.

---

### 3.1 Vấn đề và động lực

Hệ thống cần hỗ trợ nhiều loại module RF (BLE, LoRa, Zigbee) từ nhiều nhà sản xuất khác nhau. Mỗi module có cú pháp AT command, giao thức vật lý, và trình tự GPIO hoàn toàn khác nhau:

| Hàm | STM32WB55 | HC-05 | ESP32 AT | nRF52 |
|---|---|---|---|---|
| SW Reset | `AT+RESET\r\n` | `AT+RESET\r\n` | `AT+RST\r\n` | `AT+RESET\r\n` |
| Set Name | `AT+NAME=` | `AT+NAME:` | `AT+BLENAME=` | `AT+GAPDEVNAME=` |
| Scan | `AT+SCAN=` | `AT+INQ` | `AT+BLESCAN=` | `AT+GAPSCAN` |
| Connect | `AT+CONNECT=` | `AT+LINK=` | `AT+BLECONN=` | `AT+GAPCONNECT=` |

**Nhận xét:** Cùng một **chức năng** (`MODULE_SCAN`) nhưng AT command hoàn toàn khác nhau giữa các module. Nếu hardcode, mỗi lần thay module phải recompile firmware.

**Giải pháp:** Chuẩn hóa theo **tên hàm (function name)** thay vì theo command. Toàn bộ chi tiết command nằm trong file JSON — firmware chỉ biết tên hàm.

---

### 3.2 Kiến trúc ba tầng trừu tượng

```mermaid
graph TB
    A["📄 JSON Config File\nstackXXX_config.json\n(Module-specific — External)"]
    B["⚙️ JSON Config Parser\njson_ble_config_parser.c\njson_lora_config_parser.c\n(Firmware — Generic)"]
    C["🔌 Module Config Controller\nmodule_config_controller.c\n(Firmware — Generic)"]
    D["🔧 BSP Driver Layer\nUART / SPI / I2C / USB\n(Hardware-specific)"]

    A -->|parse| B
    B -->|cấu hình bus| C
    C -->|gọi driver| D
```

---

### 3.3 Cấu trúc JSON schema

File JSON mô tả toàn bộ cách tương tác với một module. Ví dụ cho `stack_002_config.json` (BLE STM32WB55):

```json
{
  "module_id": "002",
  "module_type": "BLE",
  "module_name": "STM32WB_BLE_Gateway",
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
      "is_prefix": false,
      "gpio_start_control": [{ "pin": "01", "state": "LOW" }],
      "delay_start": 100,
      "expect_response": "",
      "timeout": 0,
      "gpio_end_control": [{ "pin": "01", "state": "HIGH" }],
      "delay_end": 1000
    },
    {
      "function_name": "MODULE_START_DISCOVERY",
      "command": "AT+SCAN=",
      "is_prefix": true,
      "gpio_start_control": [],
      "delay_start": 0,
      "expect_response": "+SCAN:",
      "timeout": 7000,
      "gpio_end_control": [],
      "delay_end": 0
    }
  ]
}
```

Ý nghĩa từng trường:

| Trường | Kiểu | Mô tả |
|---|---|---|
| `function_name` | string | Tên hàm chuẩn — firmware nhận biết qua enum |
| `command` | string | AT command gửi xuống module (hoặc rỗng nếu GPIO-only) |
| `is_prefix` | bool | `true`: command là prefix, phần còn lại do server gửi. `false`: command chính xác |
| `gpio_start_control` | array | Danh sách GPIO cần toggle trước khi gửi command |
| `delay_start` | ms | Độ trễ sau GPIO start và trước khi gửi command |
| `expect_response` | string | Chuỗi prefix mong đợi trong phản hồi |
| `timeout` | ms | Timeout chờ phản hồi |
| `gpio_end_control` | array | GPIO toggle sau khi gửi xong command |
| `delay_end` | ms | Độ trễ sau GPIO end |

---

### 3.4 Cơ chế phân biệt Non-Prefix và Prefix command

```mermaid
sequenceDiagram
    participant Server
    participant Config_Handler
    participant JSON_Parser
    participant BLE_Handler
    participant Module

    Note over Server,Module: Luồng Prefix Command (is_prefix = true)
    Server->>Config_Handler: CFBL:0:AT+SCAN=5000
    Config_Handler->>JSON_Parser: config_parse_ble_command("AT+SCAN=5000")
    Note over JSON_Parser: Loop functions[]\nTìm entry có command = "AT+SCAN=" (prefix match)
    JSON_Parser-->>Config_Handler: match: MODULE_START_DISCOVERY\ngpio=[], timeout=7000ms
    Config_Handler->>BLE_Handler: Gửi "AT+SCAN=5000" + apply GPIO/delay/timeout từ JSON
    BLE_Handler->>Module: UART: "AT+SCAN=5000\r\n"
    Module-->>BLE_Handler: "+SCAN:MAC,RSSI,NAME\r\nOK"
    BLE_Handler-->>Server: Forward response

    Note over Server,Module: Luồng Non-Prefix Command (is_prefix = false)
    Server->>Config_Handler: CFBL:0:MODULE_HW_RESET
    Config_Handler->>JSON_Parser: Lookup exact name "MODULE_HW_RESET"
    JSON_Parser-->>Config_Handler: gpio=[RST=LOW → delay 100ms → RST=HIGH]\n command="" (GPIO-only)
    Config_Handler->>BLE_Handler: Execute GPIO sequence only (không gửi UART)
    BLE_Handler->>Module: Toggle RST pin LOW → 100ms → HIGH
```

---

### 3.5 Luồng khởi động và tự động nhận dạng module

```mermaid
flowchart TD
    A[Boot LAN MCU] --> B[NVS + I2C + TCA Init]
    B --> C[stack_handler_init\nĐọc module ID từ TCA GPIO expander]
    C --> D[config_handler_task_start]
    D --> E[mcu_wan_handler_start]
    E --> F[module_monitor_task_start]
    F --> G{NVS có JSON\nconfigcho stack 0?}
    G -- Có --> H[Parse JSON\nconfig_parse_json]
    G -- Không --> I[Chờ JSON từ PC App\nqua queue]
    H --> J{module_type?}
    J -- BLE --> K[ble_handler_task_start\nStack 0]
    J -- LORA --> L[lora_handler_task_start\nStack 0]
    J -- ZIGBEE --> M[zigbee_handler_task_start\nStack 0]
    K --> N[Chạy vòng lặp monitor\nLắng nghe config mới]
    L --> N
    M --> N
    I --> N
    N --> O{Nhận config\nmới từ queue?}
    O -- Có --> P[Parse JSON\nSave NVS\nRestart handler task]
    P --> N
```

---

### 3.6 Danh sách file cài đặt

**Firmware DA2_esp_LAN:**

| File | Layer | Mô tả |
|---|---|---|
| `Middleware/JSON_Config_Parser/src/json_config_parser.c` | Middleware | Parse metadata chung (module_id, comm type, baudrate...) |
| `Middleware/JSON_Config_Parser/src/json_ble_config_parser.c` | Middleware | Parse BLE functions + GPIO sequences |
| `Middleware/JSON_Config_Parser/src/json_lora_config_parser.c` | Middleware | Parse LoRa functions |
| `Middleware/JSON_Config_Parser/src/json_zigbee_config_parser.c` | Middleware | Parse Zigbee HEX functions |
| `Middleware/JSON_Config_Parser/src/json_rs485_config_parser.c` | Middleware | Parse RS485 baudrate config |
| `Middleware/Module_Config_Controller/` | Middleware | Khởi tạo bus UART/SPI/I2C/USB theo parsed config |
| `Application/Module_Monitor_Task/src/module_monitor_task.c` | Application | Lifecycle manager: detect → parse → start handler |
| `Application/Config_Handler/src/config_handler_ble_commands.c` | Application | Routing CFBL: commands + prefix matching |
| `Application/Config_Handler/src/config_handler_lora_commands.c` | Application | Routing CFLR: commands |
| `Application/Config_Handler/src/config_handler_zigbee_commands.c` | Application | Routing CFZB: commands |
| `Application/Config_Handler/src/config_global.c` | Application | Global state: stack IDs, JSON buffers |

**PC App DATN_config_app:**

| File | Mô tả |
|---|---|
| `src/config/stack_002_config.json` | Template JSON cho BLE STM32WB55 |
| `src/config/stack_003_config.json` | Template JSON cho LoRa RAK3172 |
| `src/config/stack_001_config.json` | Template JSON cho Zigbee E180-ZG120B |
| `src/config/stack_id_map.json` | Mapping stack ID → module type + cmd prefix |
| `src/ui/advanced/ble_tab.py` | JSON Config Builder UI cho BLE |
| `src/ui/advanced/lora_tab.py` | JSON Config Builder UI cho LoRa |
| `src/ui/advanced/zigbee_tab.py` | JSON Config Builder UI cho Zigbee |

---

### 3.7 Kết quả kiểm thử

Sau khi triển khai, hệ thống đã được kiểm thử với module BLE STM32WB55:

| Test case | Kết quả |
|---|---|
| Gửi JSON config từ PC App → WAN MCU → SPI → LAN MCU | ✅ Pass |
| JSON được parse đúng: module_id, baudrate, parity, stopbit | ✅ Pass |
| NVS lưu JSON, reload đúng sau power cycle | ✅ Pass |
| Module Monitor Task tự restart BLE handler sau khi nhận config mới | ✅ Pass |
| Prefix command `AT+SCAN=5000` match đúng `MODULE_START_DISCOVERY` | ✅ Pass |
| GPIO-only command `MODULE_HW_RESET` không gửi UART, chỉ toggle pin | ✅ Pass |
| Thay JSON config (module khác) → handler tự restart với config mới | ✅ Pass |

---

## CHƯƠNG 4 — WEB CONFIG PORTAL (CỔNG CẤU HÌNH NHÚNG)

### Nội dung cần bổ sung

---

### 4.1 Lý do thiết kế

Trong phiên bản trước, cấu hình gateway chỉ có thể thực hiện qua Python PC App — yêu cầu cài đặt phần mềm và kết nối cáp USB. Web Config Portal cho phép kỹ sư và người dùng cấu hình hoàn toàn qua **trình duyệt web** trên bất kỳ thiết bị nào (máy tính, điện thoại). Đây cũng là yêu cầu cần thiết cho triển khai sản phẩm thực tế.

---

### 4.2 Kiến trúc tổng thể Web Portal

```mermaid
graph LR
    subgraph Build["Build-time (Vite + vite-plugin-singlefile)"]
        SRC["src/\nmain.js, tabs/, style.css"]
        VITE[Vite bundler]
        HTML["dist/index.html\n(single-file, all JS+CSS inlined)"]
        SRC --> VITE --> HTML
    end

    subgraph Firmware["Firmware (ESP-IDF CMake)"]
        EMBED["CMakeLists.txt\ntarget_add_binary_data\n(index.html → Flash)"]
        C_PTR["extern const char index_html_start[]\nasm('_binary_index_html_start')"]
        HTML -->|EMBED_TXTFILES| EMBED --> C_PTR
    end

    subgraph Runtime["Runtime (ESP32-S3)"]
        HTTPD["esp_http_server\nweb_server.c"]
        APICFG["api_config.c\nGET/POST /api/config\nGET/POST /api/lan_config"]
        APISTAT["api_status.c\nGET /api/status"]
        DNS["captive_dns.c\nUDP port 53"]
        QUEUE["g_config_handler_queue\n(shared với UART handler)"]
        C_PTR --> HTTPD
        HTTPD --> APICFG
        HTTPD --> APISTAT
        HTTPD --> DNS
        APICFG --> QUEUE
    end

    subgraph Browser["Trình duyệt"]
        B["SPA React-less\nVanilla JS\nfetch /api/*"]
    end

    Browser -->|HTTP WiFi| HTTPD
```

---

### 4.3 Chế độ AP và STA — Quy trình cấp phát WiFi

```mermaid
flowchart TD
    BOOT[Khởi động WAN MCU] --> CHECK{NVS có\nWiFi credentials?}
    CHECK -- Không --> AP[Khởi động WiFi AP Mode\nSSID: DA2-Gateway-XXXX\nIP: 192.168.4.1]
    AP --> DNS_START[Captive DNS server khởi động\nport 53 — phản hồi mọi query bằng 192.168.4.1]
    DNS_START --> HTTP_START[HTTP server khởi động\nphục vụ SPA tại 192.168.4.1]
    HTTP_START --> POPUP["📱 Điện thoại / PC kết nối AP\n→ OS hiện popup 'Sign in to network'\n→ Mở trang cấu hình tự động"]
    POPUP --> USER[Người dùng nhập SSID + Password\nNhấn Set WiFi → Reboot]
    USER --> SAVE[NVS lưu WiFi credentials]
    SAVE --> REBOOT[esp_restart]
    REBOOT --> CHECK

    CHECK -- Có --> STA[Kết nối WiFi STA mode]
    STA --> STA_OK{Kết nối thành công?}
    STA_OK -- Có --> WEB_STA[HTTP server + mDNS\nhttp://gateway.local\nTruy cập từ LAN]
    STA_OK -- Không\n(retry > max) --> AP
```

---

### 4.4 Cấu trúc REST API

| Endpoint | Phương thức | Mô tả |
|---|---|---|
| `/api/config` | GET | Trả về toàn bộ cấu hình WAN (WiFi, LTE, MQTT, HTTP, CoAP) dạng JSON |
| `/api/config` | POST | Cập nhật cấu hình WAN — đẩy lệnh vào `g_config_handler_queue` |
| `/api/lan_config` | GET | Trả về cấu hình LAN (BLE/LoRa/Zigbee JSON templates) |
| `/api/lan_config` | POST | Gửi JSON config cho module LAN (CFBL/CFLR/CFZB) |
| `/api/status` | GET | Trạng thái live: uptime, RSSI, firmware version, internet status |
| `/api/reboot` | POST | Gọi `esp_restart()` sau 500ms |

**Ví dụ response GET /api/config:**
```json
{
  "internet_type": 0,
  "server_type": 0,
  "wifi": { "ssid": "MyNetwork", "password": "***", "auth_mode": "PERSONAL" },
  "lte": { "modem": "A7600C1", "apn": "m-wap" },
  "mqtt": { "broker": "mqtt://demo.thingsboard.io:1883", "token": "***" }
}
```

---

### 4.5 Giao diện Web SPA

Giao diện được xây dựng bằng Vanilla JS (không framework) với Vite bundler. Toàn bộ JS và CSS được inline vào một file `index.html` duy nhất để nhúng vào firmware.

**Basic Mode** — tab cố định:
- `📶 WiFi` — SSID, Password, Auth Mode, Set WiFi Config
- `🌐 Server` — chọn protocol (MQTT/HTTP/CoAP) và cấu hình chi tiết
- `🔌 Interfaces` — trạng thái kết nối Internet, module RF

**Advanced Mode** — thêm các tab:
- `📱 LTE` — modem model, APN, username, password
- `🔷 BLE` — JSON Config Builder (hai pane: form + JSON preview)
- `🔵 BLE Native` — BLE Mesh Provisioner config (net key, app key, commands)
- `🟩 LoRa` — JSON Config Builder
- `🔶 Zigbee` — JSON Config Builder
- `🔌 RS485` — baudrate
- `🔄 FW` — Firmware OTA URL

**JSON Config Builder** (dùng chung cho BLE / LoRa / Zigbee):

```
┌─ Header ──────────────────────────────────────────────────────┐
│  Stack Slot: [S1▼]  Preset: [BLE STM32WB55▼]  [🔄 Reload]   │
│  Module ID: [002]   Module Name: [STM32WB_BLE_Gateway]        │
├─ LEFT (55%) ──────────────────┬─ RIGHT (45%) ─────────────────┤
│ 🔌 Communication              │ 📄 Generated JSON             │
│   Port type: [uart▼]          │  { "module_id": "002", ...}   │
│   Baudrate: [115200]          │  (editable, syntax highlight) │
│   Parity: [none▼]             ├───────────────────────────────┤
│                               │ 🚀 Actions                    │
│ ⚙️ Functions (accordion)      │  [✅ Send to Gateway]         │
│  ▼ MODULE_HW_RESET            │  [💾 Save JSON File]          │
│     GPIO: pin01 LOW→HIGH      │  [📂 Load JSON File]          │
│  ▼ MODULE_SW_RESET            ├───────────────────────────────┤
│     CMD: AT+RESET\r\n         │ 📊 Status                     │
│     Expected: OK, 2000ms      │  Last sent: 2026-03-21 10:30  │
│  ▼ MODULE_START_DISCOVERY     │  Response: JSON_PARSED_OK     │
│     CMD prefix: AT+SCAN=      │                               │
└───────────────────────────────┴───────────────────────────────┘
```

---

### 4.6 Quyết định thiết kế — EMBED_TXTFILES thay vì LittleFS

| Tiêu chí | EMBED_TXTFILES ✅ (đã chọn) | LittleFS partition ❌ |
|---|---|---|
| Thay đổi partitions.csv | Không cần | Phải thêm partition mới |
| Web UI và firmware luôn đồng bộ | Cùng binary, tự đồng bộ | Có thể lệch phiên bản |
| Phức tạp trong C | Tối thiểu (`extern const char*`) | Phải mount FS, xử lý lỗi |
| Ảnh hưởng đến FOTA flow | Không bao giờ | Có thể ảnh hưởng nếu shrink OTA |
| Kích thước điển hình của SPA | 150–300 KB (nằm gọn trong 7 MB OTA) | Như nhau |

---

### 4.7 Kết quả kiểm thử

| Test case | Kết quả |
|---|---|
| Kết nối phone vào AP — hiện captive portal tự động (Android + iOS) | ✅ Pass |
| Nhập WiFi credentials → reboot → kết nối STA thành công | ✅ Pass |
| Truy cập `http://gateway.local` từ LAN (mDNS hoạt động) | ✅ Pass |
| `GET /api/config` trả đầy đủ JSON cấu hình hiện tại | ✅ Pass |
| `POST /api/config` với WiFi config → gateway update và reconnect WiFi | ✅ Pass |
| `POST /api/lan_config` gửi BLE JSON → LAN MCU nhận và parse | ✅ Pass |
| `POST /api/reboot` → gateway restart trong 500ms | ✅ Pass |
| Firmware OTA tab: nhập URL → kích hoạt FOTA thành công | ✅ Pass |

---

## CHƯƠNG 5 — BLE MESH NATIVE TRÊN ESP32-S3

### Nội dung cần bổ sung

---

### 5.1 Lý do triển khai

Trong quá trình kiểm thử điều khiển đèn Tuya E27 qua BLE truyền thống (STM32WB55 AT command), phát hiện vấn đề cơ bản:

- Tuya E27 liên tục phát frame `ADV_NONCONN_IND (0x03)` — đây là **BLE Mesh Unprovisioned Device Beacon** theo BT SIG Mesh Profile v1.0.
- Lệnh `AT+CONNECT=<MAC>` của STM32WB55 chỉ kết nối được với thiết bị phát `ADV_IND (0x00)` (connectable advertisement).
- Kết quả: `AT+CONNECT` bị treo vĩnh viễn, không timeout.

| Phương pháp | Kiểu advertisement | Tuya E27 | Kết quả |
|---|---|---|---|
| GATT Central (STM32WB55 AT) | Cần `ADV_IND 0x00` | Phát `ADV_NONCONN_IND 0x03` | ❌ Không kết nối được |
| BLE Mesh Provisioner (ESP32-S3) | Nhận `ADV_NONCONN_IND 0x03` | Phát `ADV_NONCONN_IND 0x03` | ✅ Hoạt động |

**Giải pháp:** Triển khai **BLE Mesh Provisioner** trực tiếp trên ESP32-S3 (LAN MCU) sử dụng ESP-IDF BLE Mesh API. WAN MCU không thay đổi gì.

---

### 5.2 Kiến trúc triển khai

```mermaid
graph TB
    SERVER["☁️ ThingsBoard / MQTT Server\nRPC: {method: sendCommand, params: CFBN:0:CONTROL:{...}}"]
    WAN["DA2_esp WAN MCU\n(không thay đổi)\nForward SPI frame HANDLER_BLE_NATIVE=0x06"]
    
    subgraph LAN["DA2_esp_LAN — LAN MCU"]
        CFG["config_handler.c\nPhát hiện prefix CFBN:"]
        NATIVE_CMD["config_handler_ble_native_commands.c\nParse CFBN:JSON: / CFBN:0:verb"]
        NATIVE_HDL["ble_native_handler.c\nBLE Mesh stack init\nRole: Provisioner\nCallbacks: prov_complete, unprov_adv"]
        NATIVE_CFG["ble_native_config.c\nJSON parser: net_key, app_key, commands table"]
        NATIVE_DL["ble_native_downlink.c\nVerb dispatcher → ESP BLE Mesh API"]
        NATIVE_UL["ble_native_uplink.c\nForward response → mcu_wan_enqueue_uplink"]
    end

    MESH["📡 Tuya E27 BLE Mesh Nodes\nADV_NONCONN_IND bearer"]

    SERVER -->|MQTT RPC| WAN
    WAN -->|SPI HANDLER_BLE_NATIVE| CFG
    CFG --> NATIVE_CMD
    NATIVE_CMD --> NATIVE_HDL
    NATIVE_HDL --> NATIVE_CFG
    NATIVE_HDL --> NATIVE_DL
    NATIVE_HDL --> NATIVE_UL
    NATIVE_DL -->|esp_ble_mesh_generic_client_set_state| MESH
    NATIVE_UL -->|SPI uplink| WAN
```

---

### 5.3 Các BLE Mesh model đăng ký

| Model | SIG ID | Vai trò |
|---|---|---|
| Config Server | bắt buộc | Yêu cầu theo BT SIG Mesh spec |
| Config Client | bắt buộc | Bind app-key lên các node từ xa |
| Generic OnOff Client | `0x1001` | Bật/Tắt thiết bị |
| Light Lightness Client | `0x1303` | Điều chỉnh độ sáng |
| Light CTL Client | `0x1305` | Điều chỉnh nhiệt độ màu |
| Scene Client | `0x1205` | Lưu/gọi lại scene |

Model selection tại runtime được điều khiển bởi trường `"model_id"` trong bảng commands JSON — **không hardcode trong firmware**.

---

### 5.4 Giao thức lệnh CFBN:

Tuân theo cùng pattern với `CFBL:`, `CFLR:`, `CFZB:`:

| Lệnh | Mô tả | Response |
|---|---|---|
| `CFBN:JSON:0:<json>` | Nạp config: net_key, app_key, provisioner address, bảng commands | `CFBN:0:OK:JSON_LOADED` |
| `CFBN:0:SCAN` | Scan unprovisioned devices | `+UNPROV:UUID,RSSI` (async stream) |
| `CFBN:0:PROVISION:<uuid>` | Provision một device | `+PROV_DONE:addr` or `+PROV_FAIL` |
| `CFBN:0:CONTROL:<json>` | Gửi lệnh điều khiển theo model_id + opcode | Response qua notify |
| `CFBN:0:STATUS:<addr>` | Request status từ node | `+STATUS:addr,value` |

---

### 5.5 Luồng hoạt động sau khi nạp JSON

```mermaid
sequenceDiagram
    participant Server
    participant WAN
    participant LAN_Config
    participant BLE_Mesh_Stack

    Server->>WAN: CFBN:JSON:0:{ "net_key": "...", "app_key": "...", "commands": [...] }
    WAN->>LAN_Config: SPI forward
    LAN_Config->>BLE_Mesh_Stack: esp_ble_mesh_provisioner_add_local_net_key()
    LAN_Config->>BLE_Mesh_Stack: esp_ble_mesh_provisioner_add_local_app_key()
    Note over BLE_Mesh_Stack: Stack sẵn sàng

    Server->>WAN: CFBN:0:SCAN
    WAN->>BLE_Mesh_Stack: esp_ble_mesh_provisioner_prov_enable()
    BLE_Mesh_Stack-->>Server: +UNPROV:UUID=AABBCCDD...,RSSI=-65

    Server->>WAN: CFBN:0:PROVISION:AABBCCDD...
    WAN->>BLE_Mesh_Stack: esp_ble_mesh_provisioner_prov_device_with_addr()
    BLE_Mesh_Stack-->>Server: +PROV_DONE:addr=0x0005

    Server->>WAN: CFBN:0:CONTROL:{"node":0x0005,"cmd":"TURN_ON"}
    WAN->>BLE_Mesh_Stack: esp_ble_mesh_generic_client_set_state(ONOFF=1)
    BLE_Mesh_Stack->>Server: (Tuya E27 bật đèn)
```

---

### 5.6 Trạng thái kiểm thử

Code đã được viết và biên dịch thành công. **Chưa kiểm thử trên phần cứng** — chờ hoàn thành bo mạch mới. Các điểm cần xác minh khi kiểm thử:

- Khởi tạo BLE Mesh stack không xung đột với Wi-Fi stack
- Callback `ESP_BLE_MESH_PROVISIONER_RECV_UNPROV_ADV_PKT_EVT` nhận đúng beacon từ Tuya E27
- Provisioning flow hoàn thành: PB-ADV → Provisioning PDU → PROV_DONE
- OnOff / Lightness / CTL client model gửi đúng opcode và nhận ACK

---

## CHƯƠNG 6 — ỨNG DỤNG KIỂM THỬ: ĐIỀU KHIỂN ĐÈN TUYA E27

### Nội dung cần bổ sung

---

### 6.1 Mô tả kịch bản kiểm thử

Kịch bản kiểm thử tích hợp đầu-cuối: Điều khiển đèn LED thông minh **Tuya E27** thông qua gateway DA2, từ ThingsBoard MQTT dashboard xuống đèn vật lý. Đây là ứng dụng thực tế nhất để kiểm chứng toàn bộ hệ thống.

```
ThingsBoard Dashboard
        │ MQTT RPC
        ▼
DA2_esp (WAN MCU)
        │ CFBL: commands qua SPI
        ▼
DA2_esp_LAN (LAN MCU)
        │ UART 115200 baud
        ▼
STM32WB55 (BLE Central)
        │ BLE GATT Write (Service 1910, Char 0x2B11)
        ▼
Tuya E27 (BLE Peripheral)
```

---

### 6.2 GATT Info của Tuya E27

| Thông số | Giá trị |
|---|---|
| Service UUID | `1910` |
| Write Characteristic | `2B11` — gửi lệnh xuống đèn |
| Notify Characteristic | `2B10` — nhận phản hồi từ đèn |
| UART baudrate STM32WB55 | 115200 baud, 8N1 |

---

### 6.3 Giao thức Tuya DP (Data Point)

Tuya E27 dùng định dạng TLV binary qua BLE GATT:

```
Header:  55 AA
Seq:     XX XX  (sequence number, tăng mỗi lần gửi)
Length:  00 XX  (độ dài payload)
DP ID:   XX     (Data Point ID: 02=mode, 03=brightness, 04=CCT, 05=on_off)
DP Type: XX     (01=bool, 02=enum, 03=value/int32, 05=string)
DP Len:  00 XX  (độ dài data)
Data:    XX...
Checksum: XX    (tổng các byte từ Header đến hết Data, mod 256)
```

---

### 6.4 Bảng lệnh điều khiển (qua STM32WB55 AT)

Sau khi thực hiện init flow và kết nối thành công, handle write characteristic = `0x000E`:

| Lệnh | CFBL command | Payload GATT |
|---|---|---|
| Bật đèn | `CFBL:0:AT+WRITE=0,0x000E,...` | `55AA00010006000501010001010F` |
| Tắt đèn | `CFBL:0:AT+WRITE=0,0x000E,...` | `55AA00020006000501010001000E` |
| Độ sáng 100% (DP03=1000) | `CFBL:0:AT+WRITE=0,0x000E,...` | `55AA0003...000003E8...` |
| Độ sáng 50% (DP03=500) | `CFBL:0:AT+WRITE=0,0x000E,...` | `55AA0004...000001F4...` |
| CCT ấm (DP04=0) | `CFBL:0:AT+WRITE=0,0x000E,...` | `55AA0006...0000000024...` |
| CCT lạnh (DP04=1000) | `CFBL:0:AT+WRITE=0,0x000E,...` | `55AA0007...000003E8...` |
| Chế độ RGB | `CFBL:0:AT+WRITE=0,0x000E,...` | `55AA00080006000502040001011B` |
| Màu đỏ HSV(0°,100%,100%) | `CFBL:0:AT+WRITE=0,0x000E,...` | `55AA0009...303030303634363437...` |

---

### 6.5 Init flow chi tiết

```mermaid
sequenceDiagram
    participant App
    participant Gateway
    participant STM32WB55
    participant TuyaE27

    App->>Gateway: CFBL:0:MODULE_HW_RESET
    Gateway->>STM32WB55: Toggle RST pin LOW→100ms→HIGH (GPIO only)

    App->>Gateway: CFBL:0:AT+GETINFO
    Gateway->>STM32WB55: UART: AT+GETINFO\r\n
    STM32WB55-->>Gateway: +FW:1.1.0 / +BDADDR:AA:BB:CC:DD:EE:FF / OK

    App->>Gateway: CFBL:0:AT+SCAN=5000
    Gateway->>STM32WB55: UART: AT+SCAN=5000\r\n
    STM32WB55-->>Gateway: +SCAN:A4C138XXYYZZ,-65,TuyaE27

    App->>Gateway: CFBL:0:AT+CONNECT=A4C138XXYYZZ
    Gateway->>STM32WB55: UART: AT+CONNECT=A4C138XXYYZZ\r\n
    STM32WB55-->>Gateway: +CONNECTED:0 / OK

    App->>Gateway: CFBL:0:AT+DISC=0
    Gateway->>STM32WB55: UART: AT+DISC=0\r\n
    STM32WB55-->>Gateway: +CHAR:0x0001,0x000E,2B11 / +CHAR:0x0001,0x000F,2B10

    App->>Gateway: CFBL:0:AT+NOTIFY=0,0x000F,1
    Gateway->>STM32WB55: UART: AT+NOTIFY=0,0x000F,1\r\n
    STM32WB55-->>TuyaE27: BLE Enable CCCD notify
    STM32WB55-->>Gateway: OK

    Note over App,TuyaE27: Hệ thống sẵn sàng điều khiển
```

---

### 6.6 Trạng thái kiểm thử

| Hạng mục | Trạng thái |
|---|---|
| Command sequences (STM32WB55 AT path) | ✅ Tài liệu hóa đầy đủ, payload Tuya DP đã xác minh |
| Command sequences (ESP32 AT BLE path) | ✅ Tài liệu hóa |
| Command routing gateway (CFBL: → UART) | ✅ Đã kiểm thử với Module Base Setting |
| Kiểm thử vật lý đèn phản hồi lệnh | ⏳ Chưa thực hiện (chờ bo mạch mới) |
| Tích hợp ThingsBoard dashboard | ⏳ Chưa thực hiện |

---

## CHƯƠNG 7 — CẬP NHẬT BO MẠCH PHẦN CỨNG MỚI

### Nội dung cần bổ sung

> **Lưu ý:** Chương này **không phải chương phần cứng** (không có sơ đồ mạch, PCB layout). Đây là chương mô tả các thay đổi firmware cần thiết để tương thích với phiên bản bo mạch mới.

---

### 7.1 Những thay đổi phần cứng chính

| Thay đổi | Bo cũ | Bo mới |
|---|---|---|
| IO Expander | TCA6424A (24 chân, 3 port, `0x22`) trên mainboard | TCA6416A (16 chân, 2 port) **trên từng adapter board** (`0x20` / `0x21`) |
| Phát hiện Stack ID | Giả lập / hardcode | Đọc từ P00–P03 (4-bit) của TCA6416A |
| Số GPIO per stack (WAN) | 13 (11 GPIO + WAKE# + PERST#) | 16 (P00–P17 flat mapping) |
| Số GPIO per stack (LAN) | 11 per stack | 16 per adapter |
| LTE WAKE# pin | TCA pin 11 | P05 |
| LTE PERST# pin | TCA pin 12 | P06 |
| LAN2 UART TX/RX | GPIO15 / GPIO16 | GPIO8 / GPIO21 |
| SPI3 (LAN module) | các GPIO cũ | CS0=38, CS1=39, CLK=41, MISO=42, MOSI=40 |
| IO Expander INT pin (LAN1) | GPIO21 (chung) | GPIO47 |
| IO Expander INT pin (LAN2) | GPIO21 (chung) | GPIO48 |
| USB Switch Control | Không có | GPIO46 (mới) |

---

### 7.2 Tiến độ thay đổi firmware

| Task | Nội dung | DA2_esp (WAN) | DA2_esp_LAN (LAN) | Trạng thái |
|---|---|---|---|---|
| Task 1 | SPI pins WAN↔LAN (CS=10, CLK=12, MOSI=11, MISO=13) | ✅ | ✅ | Hoàn thành |
| Task 2 | INT, RESET, DATA_READY pins | ✅ | ✅ | Hoàn thành |
| Task 3 | UART WAN↔LAN compatibility (TX=42,RX=41 WAN; TX=43,RX=44 LAN) | ✅ | ✅ | Hoàn thành |
| Task 4 | Power & Charger Module Control (pwr_source_handler) | ❌ | — | Chưa bắt đầu |
| Task 5 | WAN Stack Handler rewrite (TCA6416A, 16-pin enum) | ❌ | — | Chưa bắt đầu |
| Task 6 | LTE control pin remap (WAKE#: 11→5, PERST#: 12→6) | ❌ | — | Chưa bắt đầu |
| Task 7 | LAN adapter connector pin: LAN2 UART, SPI3 | — | ❌ | Chưa bắt đầu |
| Task 8 | LAN Stack Handler rewrite (multi-instance TCA6416A) | — | ❌ | Chưa bắt đầu |
| Task 9 | LAN Module SPI pin update | — | ❌ | Chưa bắt đầu |
| Task 10 | LAN2 Module UART pin update (GPIO8/21) | — | ❌ | Chưa bắt đầu |
| Task 11 | USB Switch Control (GPIO46) | — | ❌ | Chưa bắt đầu |
| Task 12 | SD Card / SDIO pin check | — | ❌ | Chưa bắt đầu |
| Task 13 | TCA6416A register map, I2C addresses (0x20/0x21) | ❌ | ❌ | Chưa bắt đầu |
| Task 14 | WAN Power Source Handler update | ❌ | — | Chưa bắt đầu |

**Tiến độ:** 3 / 14 tasks hoàn thành (21%)

---

### 7.3 Thay đổi kiến trúc quan trọng nhất — Multi-Instance Stack Handler (Task 8)

Thay đổi phức tạp nhất: LAN Stack Handler phải được viết lại hoàn toàn từ một TCA singleton thành hai TCA6416A instance độc lập:

```mermaid
graph TB
    subgraph Old["Kiến trúc CŨ"]
        direction TB
        MAIN_PCB["Mainboard\nTCA6424A (0x22)\n3 port × 8 = 24 GPIO"]
        S1_OLD["Stack 1 (LAN1)\nPort 1+2 → 11 GPIO"]
        S2_OLD["Stack 2 (LAN2)\nPort 0+1 → 11 GPIO"]
        MAIN_PCB --> S1_OLD
        MAIN_PCB --> S2_OLD
    end

    subgraph New["Kiến trúc MỚI"]
        direction TB
        ADP1["Adapter Board 1\nTCA6416A (0x20)\n2 port × 8 = 16 GPIO\nP17=0 → Slot 1"]
        ADP2["Adapter Board 2\nTCA6416A (0x21)\n2 port × 8 = 16 GPIO\nP17=1 → Slot 2"]
        S1_NEW["Stack 1 (LAN1)\nP00–P07, P10–P17 → 16 GPIO\nP00–P03 = Stack ID (4-bit)"]
        S2_NEW["Stack 2 (LAN2)\nP00–P07, P10–P17 → 16 GPIO\nP00–P03 = Stack ID (4-bit)"]
        ADP1 --> S1_NEW
        ADP2 --> S2_NEW
    end
```

**Luồng khởi động mới của `stack_handler_init()`:**
1. Scan I2C bus tìm TCA6416A tại `0x20` và `0x21`.
2. Với mỗi TCA tìm thấy, đọc **P17 (IOX_SLOTDET)**:
   - P17 = 0 → Đây là **Adapter Slot 1 (LAN ADAPTER 1)**
   - P17 = 1 → Đây là **Adapter Slot 2 (LAN ADAPTER 2)**
3. Đọc P00–P03 → 4-bit Stack ID (0b0000 đến 0b1111)
4. Lưu: handle TCA riêng cho từng slot, `stack_1_id`, `stack_2_id`

---

## HƯỚNG TIẾP THEO

### Công việc còn lại theo thứ tự ưu tiên

| # | Công việc | Mức độ ưu tiên | Ghi chú |
|---|---|---|---|
| 1 | Hoàn thành Task 5 + Task 8: Rewrite Stack Handler (WAN & LAN) cho TCA6416A | 🔴 Cao | Block toàn bộ kiểm thử trên bo mới |
| 2 | Hoàn thành Task 6: LTE pin remap | 🔴 Cao | Cần để kết nối 4G hoạt động |
| 3 | Hoàn thành Task 7 + 9 + 10: LAN pin updates | 🔴 Cao | UART, SPI pins cho module RF |
| 4 | Hoàn thành Task 13: TCA6416A register map | 🔴 Cao | Dependency của Task 5 + 8 |
| 5 | Hoàn thành Task 4 + 14: Power control | 🟡 Vừa | Cần để khởi động bo mới |
| 6 | Kiểm thử BLE Mesh Native (Chương 5) trên phần cứng | 🟡 Vừa | Cần bo mới + Tuya E27 |
| 7 | Kiểm thử ứng dụng đèn E27 end-to-end (Chương 6) | 🟡 Vừa | Cần BLE Mesh hoạt động |
| 8 | Tích hợp ThingsBoard MQTT dashboard điều khiển đèn | 🟢 Thấp | Demo cuối kỳ |
| 9 | Hoàn thiện PC App v5.0 (Basic Info Card, LoRa/Zigbee tab) | 🟢 Thấp | Tham khảo TODO_ADD_APP.md |
| 10 | Kiểm thử FOTA LAN MCU qua PPP tunnel | 🟢 Thấp | |

---

### Tóm tắt tiến độ tổng thể

| Hạng mục | Trạng thái |
|---|---|
| **Module Base Setting (JSON-driven)** | ✅ Triển khai và kiểm thử xong (BLE) |
| **Web Config Portal** | ✅ Triển khai và kiểm thử xong |
| **BLE Mesh Native Provisioner** | 🔧 Code xong, chưa kiểm thử phần cứng |
| **Test App: Tuya E27** | 🔧 Tài liệu hóa xong, payload xác minh, chưa chạy trên phần cứng |
| **Cập nhật bo mạch mới** | 🔄 21% (3/14 tasks hoàn thành) |
| **PC App v5.0** | 🔄 Thiết kế xong, một phần triển khai |

---

*Tài liệu này tóm tắt những nội dung cần bổ sung vào báo cáo đồ án giữa kỳ. Các chương phần cứng (sơ đồ nguyên lý, PCB layout) và chương Kết luận không thuộc phạm vi cập nhật.*
