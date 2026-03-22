# BÁO CÁO TỔNG QUAN DỰ ÁN — DA2 IoT Gateway

> **Vai trò review:** Embedded Senior Engineer  
> **Ngày review:** Tháng 3, 2026  
> **Firmware WAN:** v1.0.1 | **Firmware LAN:** v1.1.1.2

---

## 1. TỔNG QUAN HỆ THỐNG

### 1.1 Mô tả dự án

DA2 là một **IoT Gateway thế hệ mới** được thiết kế cho ứng dụng thu thập và truyền tải dữ liệu công nghiệp. Hệ thống bao gồm hai vi điều khiển ESP32-S3 hoạt động phối hợp, một module RF STM32WB55, cùng với một ứng dụng PC cấu hình. Toàn bộ codebase được viết trên nền **ESP-IDF (FreeRTOS)** với kiến trúc phân tầng rõ ràng.

### 1.2 Sơ đồ tổng quan hệ thống

```
┌───────────────────────────────────────────────────────────────────┐
│                         DA2 Gateway System                        │
│                                                                   │
│  ┌─────────────────┐   SPI 40MHz    ┌──────────────────────────┐  │
│  │  DA2_esp (WAN)  │◄──────────────►│  DA2_esp_LAN (LAN)       │  │
│  │   ESP32-S3      │   DMA + ACK    │   ESP32-S3               │  │
│  │                 │                │                          │  │
│  │ - WiFi          │                │ - Stack Port 0 (Module A)│  │
│  │ - LTE 4G (USB)  │    PPP/UART    │ - Stack Port 1 (Module B)│  │
│  │ - MQTT/HTTP/CoAP│◄───────────── │ - SD Card (100KB buffer) │  │
│  │ - FOTA (WAN)    │                │ - FOTA (LAN)             │  │
│  │ - OLED monitor  │                │ - BLE / LoRa / Zigbee    │  │
│  │ - Config UART   │                │   / RS485                │  │
│  └────────┬────────┘                └──────────┬───────────────┘  │
│           │ USB / LTE                          │ UART/SPI/I2C/USB  │
│    ┌──────┴───────┐                    ┌───────┴──────────┐        │
│    │ 4G Modem     │                    │ STM32WB55 BLE    │        │
│    │(Quectel/SIM) │                    │ Module (AT cmd)  │        │
│    └──────────────┘                    └──────────────────┘        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │         DATN_config_app (Python / Tkinter - PC)             │  │
│  │  UART/USB ──► CFSC Protocol ──► WAN MCU ──► All Config      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 1.3 Thành phần dự án

| Thành phần | Platform | Mô tả |
|---|---|---|
| `DA2_esp` | ESP32-S3 + ESP-IDF | WAN Gateway — kết nối internet, relay dữ liệu lên server |
| `DA2_esp_LAN` | ESP32-S3 + ESP-IDF | LAN Gateway — quản lý module RF, lưu trữ, giao tiếp qua SPI |
| `STM32WB55` | STM32WB55 + HAL | BLE Central module — AT command interface |
| `DATN_config_app` | Python 3 + Tkinter | Công cụ cấu hình qua UART/USB cho toàn bộ hệ thống |

---

## 2. KIẾN TRÚC PHẦN MỀM

### 2.1 DA2_esp — WAN Gateway

```
Application Layer
├── Config_Handler       — Nhận & phân tích lệnh cấu hình (CFSC, WiFi, LTE, MQTT...)
├── Data_Communication_Handler — Điều phối luồng dữ liệu WAN ↔ LAN
├── FOTA                 — OTA update qua HTTP/HTTPS
├── Internet_Handler
│   ├── wifi_handler     — WiFi connect/reconnect
│   └── lte_handler      — LTE 4G (Quectel A7600, SIMCom SIM7600)
├── MCU_LAN_Handler      — SPI Slave ↔ LAN MCU (frame-based + DMA)
├── PPP_Server           — Chia sẻ internet LTE cho LAN MCU
└── Server_Communication_Handler
    ├── mqtt_handler     — ThingsBoard MQTT
    ├── http_handler     — REST API over HTTP/HTTPS
    └── coap_handler     — CoAP

BSP Layer
├── bg96_communication   — Modem Quectel driver
├── sim7600_communication — Modem SIMCom driver
├── esp_modem_uart/usb   — esp-modem abstraction
├── stack_handler        — TCA6424A GPIO expander (1 stack, 13 GPIO)
├── i2c_dev_support      — I2C bus manager + TCA init
└── rbg_led_ws_handler   — WS2812 LED status indicator
```

**Phân vùng Flash (partitions.csv):**
```
nvs       : 24 KB  — cấu hình NVS
otadata   :  8 KB  — OTA metadata
phy_init  :  4 KB  — RF calibration
ota_0     :  7 MB  — firmware slot 0
ota_1     :  7 MB  — firmware slot 1 (dual-bank OTA)
```

### 2.2 DA2_esp_LAN — LAN Gateway

```
Application Layer
├── Config_Handler       — Phân tích lệnh từ WAN MCU (CFBL/CFLR/CFZB/CFRS...)
├── BLE_Handler          — BLE Central logic (20 hàm chuẩn + AT command)
├── LoRa_Handler         — LoRa Gateway
├── Zigbee_Handler       — Zigbee Coordinator
├── RS485_Handler        — RS485 Master/Slave
├── MCU_WAN_Handler      — SPI Master ↔ WAN MCU (uplink/downlink queue)
├── Module_Monitor_Task  — Quản lý lifecycle module, auto-start handler
└── FOTA_LAN             — OTA cho LAN MCU (qua PPP/LAN)

Middleware Layer
├── BLE_Handler          — Transport layer cho BLE AT commands
├── LoRa_Handler         — Transport layer cho LoRa AT commands
├── Zigbee_Handler       — Transport layer cho Zigbee AT commands
├── JSON_Config_Parser   — Parse JSON module config → cấu trúc C
├── Module_Config_Controller — Khởi tạo bus (UART/SPI/I2C/USB) theo JSON
└── Storage_Handler      — 100KB RAM buffer → batch write SD Card

BSP Layer
├── MCU_WAN_Communication — SPI Master driver (DMA, 40MHz, frame protocol)
├── Module_UART/SPI/I2C/USB_Communication — Driver giao tiếp với module
├── RS485_Communication  — RS485 half-duplex driver
├── SDCard_Communication — SPI SD card driver
├── stack_handler        — TCA6424A GPIO expander (2 stacks, 11 GPIO mỗi stack)
└── i2c_dev_support      — I2C bus manager
```

### 2.3 STM32WB55 BLE Module

Triển khai đầy đủ **AT Command Interface** với 15 core functions + 3 optional:
- Lifecycle: HW Reset, SW Reset, Factory Reset
- Config: Get Info, Set Name, Set COMM, Set RF Params
- Mode: CMD Mode, Data Mode (transparent)
- Connection: Scan, Connect, Disconnect, Status
- Power: Sleep (4 modes), Wake

### 2.4 DATN_config_app (PC Tool)

Python Tkinter application cấu hình gateway qua UART/USB Serial:
- **CFSC Protocol**: handshake-based, có section `[GATEWAY_INFO]`, `[WAN_CONFIG]`, `[LAN_CONFIG]`
- Hỗ trợ cấu hình: WiFi, LTE (Quectel/SIMCom), MQTT, HTTP, CoAP, BLE, LoRa, RS485, Zigbee, CAN
- Stack ID mapping JSON (`stack_id_map.json`) — auto-load đúng config template cho module
- Build PyInstaller executable

---

## 3. ĐIỂM NỔI BẬT KỸ THUẬT

### 3.1 Kiến trúc Dual-MCU với giao thức SPI có ACK

Giao tiếp LAN–WAN dùng **SPI 40 MHz với DMA** và giao thức frame có header 2-byte:

| Header | Ý nghĩa |
|--------|---------|
| `CF` (0x4346) | Command Frame |
| `DT` (0x4454) | Data Frame (telemetry) |
| `DQ` (0x4451) | Data Query |
| `CQ` (0x4351) | Config Query |
| `RT` (0x5254) | RTC Response |
| `0x0241` | ACK byte |

Cơ chế ACK với timeout 200ms và retry, phân biệt ACK_INTERNET_OK / ACK_NO_INTERNET — đảm bảo **delivery guarantee** cho dữ liệu cảm biến.

### 3.2 JSON-Configurable Module HAL

Đây là điểm kiến trúc **đặc biệt nổi bật**:

Thay vì hardcode driver cho từng module RF, toàn bộ cách giao tiếp với module (AT command, GPIO sequence, timeout, bus type) được mô tả trong **file JSON** lưu trong NVS:

```json
{
  "module_id": "002",
  "module_type": "BLE",
  "module_communication": { "port_type": "uart", "parameters": { "baudrate": 115200 } },
  "functions": [
    {
      "function_name": "MODULE_HW_RESET",
      "gpio_start_control": [{ "pin": "01", "state": "LOW" }],
      "delay_start": 100,
      "gpio_end_control": [{ "pin": "01", "state": "HIGH" }],
      "delay_end": 1000
    },
    {
      "function_name": "MODULE_SW_RESET",
      "command": "AT+RESET\r\n",
      "expect_response": "OK",
      "timeout": 2000
    }
  ]
}
```

`Module_Monitor_Task` đọc JSON từ NVS → parse qua `JSON_Config_Parser` → khởi tạo bus qua `Module_Config_Controller` → auto-start đúng handler (BLE/LoRa/Zigbee). Thêm module mới chỉ cần thêm JSON và một stack ID — **không cần recompile firmware**.

### 3.3 Reliable Data Pipeline với SD Card Fallback

```
[Module RF] → [Handler Queue] → [MCU_WAN_Handler]
                                      │
                          ┌─── Internet OK ──► WAN MCU ──► Server
                          │
                          └─── No Internet ──► Storage_Handler
                                                   │
                                          RAM buffer (100KB)
                                                   │ flush khi đầy / định kỳ
                                              SD Card (file per batch)
                                                   │
                                          retry khi internet trở lại
```

`Storage_Handler` dùng **batch buffer 100KB trên RAM** — gộp nhiều gói nhỏ thành một lần ghi vật lý, tối ưu wear leveling SD Card. Khi internet phục hồi, tự động retry gửi lại dữ liệu đã lưu.

### 3.4 Dual-Bank OTA với Anti-Rollback

Phân vùng dual-bank (ota_0 / ota_1 mỗi cái 7MB) cho phép:
- Cập nhật firmware không gián đoạn hoạt động
- Kiểm tra firmware mới trước khi commit
- Rollback tự động nếu boot lần đầu thất bại
- Anti-rollback bằng eFuse (chống downgrade)

Hỗ trợ FOTA trên cả WAN MCU (qua internet trực tiếp) và LAN MCU (qua PPP tunnel từ WAN MCU).

### 3.5 Cơ chế chuyển đổi chế độ CONFIG/NORMAL an toàn

```
NORMAL Mode ──[GPIO45 / UART cmd]──► CONFIG Mode
                                         │
                               - LTE task dừng hẳn
                               - Chờ 10s modem release USB
                               - USB switch → HOST (PC tool)
                               - LED → Yellow
                                         │
                          [GPIO45 / UART cmd] ──► esp_restart()
                                                    │
                                         - Config mới đã lưu NVS
                                         - Boot lại với config mới
```

Quan trọng: khi LTE đang chạy, USB bus đang bị modem chiếm. Code xử lý đúng thứ tự: stop LTE → đợi modem release USB → switch sang HOST. Tránh xung đột USB enumeration.

### 3.6 Multi-Protocol Server Support (Runtime Switching)

WAN MCU hỗ trợ 3 protocol server runtime, có thể switch không cần recompile:

| Protocol | Use Case |
|----------|---------|
| MQTT (ThingsBoard) | Realtime telemetry, bidirectional command |
| HTTP/HTTPS REST | Batch upload, REST API integration |
| CoAP | Low-power, UDP-based IoT protocol |

### 3.7 Multi-Stack Module Interface (LAN)

LAN MCU có **2 stack port** vật lý, mỗi stack hỗ trợ:
- **9 GPIO** điều khiển qua TCA6424A I2C GPIO expander + WAKE# + PERST#
- Giao tiếp: UART, SPI, I2C, USB CDC
- Module hiện tại: BLE (STM32WB55), LoRa, Zigbee, RS485
- Có thể gắn 2 module khác nhau đồng thời

---

## 4. PHÂN TÍCH CODE REVIEW

### 4.1 Điểm mạnh

**[+] ISR implementation đúng chuẩn**  
`gpio45_isr_handler` và `gpio38_isr_handler` có debounce bằng tick counter (500ms), dùng `xTaskNotifyFromISR` + `portYIELD_FROM_ISR()` — đúng pattern FreeRTOS, không xử lý logic trong ISR.

**[+] Task Notification thay vì Semaphore**  
Main loop dùng `xTaskNotifyWait(portMAX_DELAY)` với các notification value riêng biệt (BUTTON_PRESS=1, POWER_MODE=2, UART_MODE=3). Nhẹ hơn semaphore, phù hợp single consumer.

**[+] DMA buffer alignment tuân thủ ESP32**  
```c
#define DMA_ALIGN_SIZE(x) (((x) + (DMA_ALIGNMENT - 1)) & ~(DMA_ALIGNMENT - 1))
```
Có macro align 4-byte cho DMA buffer — quan trọng cho SDMMC và SPI DMA trên ESP32-S3.

**[+] Phân tầng BSP/Middleware/Application rõ ràng**  
Module driver nằm trong BSP, logic nghiệp vụ trong Application. Middleware làm cầu nối mà không bị phụ thuộc chéo.

**[+] Config được persist vào NVS, không hardcode**  
Tất cả cấu hình (WiFi SSID, MQTT broker, LTE APN, module JSON) đều lưu NVS và đọc lại khi boot. Hệ thống hoạt động đúng sau power cycle.

**[+] Firmware version management**  
```c
#define LAN_FW_VERSION_MAJOR 1
#define LAN_FW_VERSION_MINOR 1
#define LAN_FW_VERSION_PATCH 1
#define LAN_FW_VERSION_BUILD 2
```
Versioning 4 trường, dùng macro `FW_VERSION_MAKE` để đóng gói — handshake SPI trao đổi version giữa 2 MCU.

**[+] Storage_Handler batch buffer**  
Dùng 100KB RAM buffer trước khi flush ra SD Card — giảm đáng kể số lần ghi, tốt cho tuổi thọ SD Card và throughput.

---

### 4.2 Điểm cần cải thiện / Rủi ro kỹ thuật

**[!] ISR debounce dùng chung `last_isr_tick` cho 2 GPIO**  
```c
// DA2_esp.c
static uint32_t last_isr_tick = 0;  // DÙNG CHUNG cho GPIO45 và GPIO38
```
Nếu cả 2 nút bấm gần như cùng lúc, nút sau sẽ bị bỏ qua. Nên tách thành 2 biến riêng.

**[!] `eSetValueWithOverwrite` cho task notification**  
Khi dùng `eSetValueWithOverwrite`, nếu main task đang bận xử lý notification hiện tại và một notification mới cùng type đến, notification mới sẽ **overwrite** cái cũ. Trong trường hợp này có thể chấp nhận được (toggle mode), nhưng cần document rõ ràng.

**[!] `vTaskDelay(pdMS_TO_TICKS(10000))` blocking trong `switch_to_config_mode`**  
```c
lte_connect_task_stop();
vTaskDelay(pdMS_TO_TICKS(10000));    /* wait for modem to release USB */
```
10 giây delay cứng trong app_main task có thể ảnh hưởng nếu có notification khác đến trong thời gian này. Nên dùng event flag từ LTE task callback thay vì delay cố định.

**[!] `PPP_GLOBAL_DNS` dùng nhưng không define khi không có PPP**  
Trong `DA2_esp_LAN.c`, hàm `lan_ppp_connect()` dùng `PPP_GLOBAL_DNS` nhưng define này bị **comment out**:
```c
// #define PPP_GLOBAL_DNS 0x08080808
```
Sẽ gây compile error nếu `lan_ppp_connect()` được gọi thực sự.

**[!] `CONFIG_CMD_MAX_LEN 8192` trên stack có thể gây stack overflow**  
Nếu `config_command_t` (chứa `raw_data[8192]`) được khai báo trên stack trong task FreeRTOS mà stack size không đủ (mặc định thường 4KB-8KB), sẽ gây stack overflow. Nên dùng `malloc` hoặc static buffer.

**[!] Thiếu mutex bảo vệ `g_internet_type` và `current_internet_type`**  
`g_internet_type` được đọc từ main task và có thể được update từ config_handler task — cần `volatile` hoặc mutex bảo vệ để tránh race condition.

**[!] `wan_comm.h` có buffer size legacy không nhất quán**  
```c
#define WAN_COMM_DEFAULT_TX_BUFFER  16384  // 16KB per design (legacy)
#define WAN_COMM_DMA_BUFFER_SIZE    8192   // 4KB DMA limit
#define WAN_COMM_MAX_TRANSFER_SIZE  8192
#define WAN_COMM_FIXED_XFER_LEN    1024
```
Comment "4KB DMA limit" nhưng giá trị là 8192 (8KB). Comment bị sai. Cần đồng bộ lại documentation.

**[!] `handler_status_t` enum có giá trị `0xFF` cho ERROR**  
```c
HANDLER_STATUS_ERROR = 0xFF
```
Khi lưu vào `uint8_t` field, giá trị 0xFF có thể bị hiểu nhầm là "uninitialized". Nên dùng giá trị rõ ràng hơn (ví dụ `= 4`).

---

### 4.3 Bảo mật

**[+] Xác thực server TLS certificate**  
FOTA dùng `esp_https_ota` với CA certificate bundle — tránh MITM attack khi download firmware.

**[~] MQTT Device Token trong NVS plaintext**  
Token MQTT và password WiFi được lưu NVS plaintext. Đây là mức chấp nhận được cho thiết bị embedded (NVS không được encrypt mặc định), nhưng nên bật NVS encryption nếu yêu cầu bảo mật cao.

**[~] JSON config injection qua UART**  
Lệnh CFBL/CFLR/CFZB nhận JSON từ PC App qua UART. Có giới hạn `CONFIG_CMD_MAX_LEN 8192` nhưng cần kiểm tra việc validate JSON trước khi parse để tránh buffer overflow từ cJSON.

---

## 5. ROADMAP & CÔNG VIỆC ĐANG THỰC HIỆN

Theo `TODO.md` trong DA2_esp, các mục tiêu giai đoạn 2.1:

| Mục tiêu | Mô tả | Độ ưu tiên |
|---|---|---|
| **Quad SPI LAN-WAN** | Nâng cấp từ Standard SPI lên QSPI (4-bit), tách 2 task Uplink/Downlink, DMA bắt buộc, ISR về BSP | Cao |
| **SD Card Optimization** | Block write lớn hơn, RAM buffer 100KB (đã có), task riêng ghi SD card | Trung bình |
| **Sleep Mode** | Tối ưu năng lượng cho baseboard và gateway | Thấp |

---

## 6. THỐNG KÊ TỔNG QUAN

| Chỉ số | Giá trị |
|---|---|
| Số MCU trong hệ thống | 3 (ESP32-S3 WAN + ESP32-S3 LAN + STM32WB55) |
| Số protocol internet hỗ trợ | 3 (WiFi / LTE 4G / Ethernet — planned) |
| Số protocol server | 3 (MQTT / HTTP-HTTPS / CoAP) |
| Số loại module LAN | 4 (BLE / LoRa / Zigbee / RS485) |
| Số stack port vật lý (LAN) | 2 |
| SPI clock LAN-WAN | 40 MHz |
| DMA buffer size | 8 KB |
| RAM batch buffer (Storage) | 100 KB |
| Flash OTA partition size | 7 MB × 2 |
| AT command functions (BLE) | 15 core + 3 optional = 18 |
| Config MAX buffer | 8 KB (JSON config) |
| PC App protocol | CFSC (section-based text protocol) |

---

## 7. KẾT LUẬN

DA2 Gateway là một dự án **IoT gateway cấp sản phẩm** với kiến trúc tốt, có tư duy thiết kế rõ ràng về:
- Tách biệt trách nhiệm (BSP / Middleware / Application)  
- Khả năng mở rộng module (JSON-configurable HAL)  
- Độ tin cậy dữ liệu (ACK + SD card fallback)  
- Khả năng bảo trì (FOTA dual-bank, PC config tool)

Các điểm cần chú ý nhất khi hoàn thiện là: **shared ISR tick variable**, **blocking delay trong mode transition**, **define bị comment gây lỗi tiềm ẩn**, và **stack overflow risk** với buffer lớn trên FreeRTOS task stack.

---
*Report generated by Embedded Senior review — DA2 IoT Gateway Project*
