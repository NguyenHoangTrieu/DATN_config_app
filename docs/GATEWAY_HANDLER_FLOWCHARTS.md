# Gateway Handler Sequence Diagrams

Tài liệu mô tả luồng giao tiếp đầy đủ của 3 wireless handler (BLE, LoRa, Zigbee) trong hệ thống gateway DA2, từ physical module → LAN MCU → WAN MCU → MQTT → Server.

---

## Mục lục

1. [Kiến trúc tổng quan](#1-kiến-trúc-tổng-quan)
2. [Startup & Handshake Sequence](#2-startup--handshake-sequence)
3. [Config Load Sequence](#3-config-load-sequence)
4. [BLE Sequence Diagrams](#4-ble-sequence-diagrams)
5. [LoRa Sequence Diagrams](#5-lora-sequence-diagrams)
6. [Zigbee Sequence Diagrams](#6-zigbee-sequence-diagrams)
7. [SPI Frame Format Reference](#7-spi-frame-format-reference)
8. [So sánh 3 handler](#8-so-sánh-3-handler)

---

## 1. Kiến trúc tổng quan

```
┌─────────┐   MQTT pub/sub   ┌───────────┐   QSPI + GPIO ISR   ┌────────────────────────────────────────┐   UART   ┌──────────────┐
│  Server │ ◄──────────────► │  WAN MCU  │ ◄─────────────────► │         LAN MCU (ESP32)                │ ◄──────► │  BLE Module  │
│ (MQTT)  │                  │ (DA2_esp) │                      │         (DA2_esp_LAN)                  │          │  LoRa Module │
└─────────┘                  └───────────┘                      │                                        │          │  Zigbee Mod  │
                                                                 │  ┌───────────────────────────────────┐ │          └──────────────┘
     ▲                                                           │  │       mcu_wan_handler             │ │
     │                                                           │  │  ┌──────────┐  ┌───────────────┐  │ │
     │  MQTT subscribe                                           │  │  │ Uplink   │  │ Downlink Poll │  │ │
     │  topic: cmd/gateway                                       │  │  │  Task    │  │  Task Prio=7  │  │ │
     │                                                           │  │  │  Prio=5  │  │ GPIO ISR wake │  │ │
┌────┴────┐                                                      │  │  │ Queue=50 │  │ DQ 10×50ms   │  │ │
│  PC App │ ──── Serial/USB ────► WAN MCU                       │  │  └──────────┘  └───────────────┘  │ │
│ (Config)│                                                      │  └───────────────────────────────────┘ │
└─────────┘                                                      │                                        │
                                                                 │  ┌──────────┐ ┌──────────┐ ┌────────┐ │
                                                                 │  │BLE Handl.│ │LoRa Hand.│ │ZB Hand.│ │
                                                                 │  │UL/DL/LS  │ │UL/DL/LS  │ │UL/DL/LS│ │
                                                                 │  │ 3 tasks  │ │ 3 tasks  │ │3 tasks │ │
                                                                 │  └──────────┘ └──────────┘ └────────┘ │
                                                                 └────────────────────────────────────────┘

Uplink packet format gửi lên MQTT:
  BLE    : "CFBL:<stack_id>:<OK|FAIL|EVT>:<response>"
  LoRa   : "CFLR:<stack_id>:<OK|FAIL|EVT>:<response>"
  Zigbee : "CFZB:<stack_id>:<OK|FAIL|EVT>:<func_name>[:<hex_data>]"

Downlink packet format từ MQTT:
  SPI frame: [DT][handler_type(3B)][length(2B)][payload]
  handler_type: "BLE", "LOR", "ZIG"
  payload = "CFBL:0:AT+SCAN=5000" / "CFLR:0:AT+JOIN" / "CFZB:0:func_id:hex"

Config packet từ PC App → WAN MCU → LAN MCU:
  SPI frame: [CF][length(2B)][JSON config data]
```

---

## 2. Startup & Handshake Sequence

```mermaid
sequenceDiagram
    participant WAN as WAN MCU<br/>(DA2_esp)
    participant LAN as LAN MCU<br/>(DA2_esp_LAN)
    participant MOD as Physical Module<br/>(BLE/LoRa/Zigbee)

    Note over WAN,LAN: Phase 1 — SPI Handshake (trước khi handler chạy)

    LAN->>WAN: SPI: [CF][0x01][fw_version 4B]<br/>(handshake_request)
    WAN-->>LAN: SPI: [0x02][0x10][internet_flag][wan_fw 4B]<br/>(ACK_HANDSHAKE)
    Note over LAN: g_handshake_done = true<br/>Downlink task unblock

    LAN->>WAN: SPI: "RT" request (RTC + internet status)
    WAN-->>LAN: SPI: [RT][dd/mm/yyyy-hh:mm:ss][network_status]
    Note over LAN: Cache RTC timestamp<br/>Update internet_status

    Note over LAN,MOD: Phase 2 — Module Init (config_load triggered)

    LAN->>MOD: GPIO P01 LOW 100ms → HIGH (HW Reset)
    LAN->>LAN: vTaskDelay(500ms)

    alt BLE Module (STM32WB55)
        LAN->>MOD: UART: AT+GETINFO\r\n
        MOD-->>LAN: +FW:1.1.0 / +BDADDR:... / OK
    else LoRa Module (Wio-E5)
        LAN->>MOD: UART: AT+VER\r\n
        MOD-->>LAN: +VER: ... / OK
    else Zigbee Module (STM32WB55 Coord)
        LAN->>MOD: UART: AT+EXIT\r\n (Enter HEX mode)
        MOD-->>LAN: OK
        LAN->>LAN: vTaskDelay(200ms)
        LAN->>MOD: UART: binary frame [55][00][00][00][XOR]<br/>(GET_INFO CMD_TYPE=0 CMD_CODE=0)
        MOD-->>LAN: binary frame [55][80][01][data...][XOR]
    end

    Note over LAN: Module ready — tasks running
```

---

## 3. Config Load Sequence

```mermaid
sequenceDiagram
    participant APP as PC App<br/>(DATN_config_app)
    participant WAN as WAN MCU<br/>(DA2_esp)
    participant LAN as LAN MCU<br/>(DA2_esp_LAN)
    participant MOD as Physical Module

    APP->>WAN: Serial/USB: JSON config payload<br/>(stack_id + module config + app_commands)
    Note over WAN: Đóng gói SPI config frame
    WAN->>WAN: Assert GPIO DATA_READY pin

    Note over LAN: GPIO ISR fires → notify Downlink task (Prio=7)
    LAN->>LAN: xSemaphoreTake(g_qspi_mutex)
    LAN->>WAN: SPI: "DQ" command (request data)
    WAN-->>LAN: SPI: [CF][config_len 2B][JSON data]
    LAN->>WAN: SPI: [0x02][ACK_RECEIVED_OK]
    LAN->>LAN: xSemaphoreGive(g_qspi_mutex)

    Note over LAN: g_config_callback(data, len, is_fota)
    LAN->>LAN: config_handler_parse(JSON)<br/>config_handler_ble/lora/zigbee_commands.c

    LAN->>MOD: handler_task_load_config(stack_id, json)<br/>(Startup sequence: HW Reset → Init)
    MOD-->>LAN: Module info response

    LAN->>WAN: SPI mcu_wan_enqueue_uplink:<br/>"CFML:JSON:OK" hoặc "CFML:JSON:FAIL"
    WAN->>APP: Serial: config load result
```

---

## 4. BLE Sequence Diagrams

### 4.1 Downlink — PC App / Server gửi lệnh điều khiển BLE module

```mermaid
sequenceDiagram
    participant SRV as Server<br/>(MQTT Broker)
    participant WAN as WAN MCU<br/>(WiFi/LTE)
    participant LAN as LAN MCU<br/>(ESP32)
    participant BLE as BLE Module<br/>(STM32WB55)
    participant DEV as BLE Device<br/>(Tuya E27)

    SRV->>WAN: MQTT publish<br/>topic: cmd/gateway<br/>payload: "CFBL:0:AT+SCAN=5000"

    Note over WAN: Đóng gói DT frame
    WAN->>WAN: Assert GPIO DATA_READY
    Note over LAN: GPIO ISR fires (Prio=7) → xTaskNotify
    LAN->>LAN: xSemaphoreTake(g_qspi_mutex)
    LAN->>WAN: SPI: "DQ" retry (10×50ms)
    WAN-->>LAN: SPI: [DT]["BLE"][len][CFBL:0:AT+SCAN=5000]
    LAN->>WAN: SPI: ACK_RECEIVED_OK
    LAN->>LAN: xSemaphoreGive(g_qspi_mutex)

    Note over LAN: dispatch_downlink_to_handler(HANDLER_BLE)
    LAN->>LAN: config_parse_ble_command("CFBL:0:AT+SCAN=5000")<br/>→ ble_handler_get_function_by_command<br/>→ match JSON config (prefix/exact)<br/>→ xQueueSend(command_queue)

    Note over LAN: BLE Downlink Task (Prio=6) wakes
    LAN->>BLE: UART GPIO + delay_start<br/>UART: AT+SCAN=5000\r\n
    BLE-->>LAN: OK\r\n+SCAN:AA:BB:CC:DD:EE:FF,-65,TuyaLED\r\n
    BLE-->>DEV: (BLE scan over-the-air)

    Note over LAN: Normalize response: \r\n → \x1E
    LAN->>LAN: mcu_wan_enqueue_uplink(HANDLER_BLE,<br/>"CFBL:0:OK:OK\x1E+SCAN:AA:BB:CC:DD:EE:FF,-65,TuyaLED")

    Note over LAN: Uplink Task (Prio=5) flush batch
    LAN->>LAN: xSemaphoreTake(g_qspi_mutex)
    LAN->>WAN: SPI: [DT]["BLE"][len][CFBL:0:OK:OK\x1E+SCAN...]<br/>+ RTC timestamp
    WAN-->>LAN: SPI: ACK_INTERNET_OK
    LAN->>LAN: xSemaphoreGive(g_qspi_mutex)

    WAN->>SRV: MQTT publish<br/>topic: data/gateway/ble<br/>payload: "CFBL:0:OK:OK\x1E+SCAN:..."
```

### 4.2 BLE Connect & GATT Write (điều khiển đèn)

```mermaid
sequenceDiagram
    participant SRV as Server (MQTT)
    participant WAN as WAN MCU
    participant LAN as LAN MCU
    participant BLE as BLE Module<br/>(STM32WB55)
    participant DEV as Tuya E27<br/>(BLE Device)

    SRV->>WAN: MQTT: "CFBL:0:AT+CONNECT=AA:BB:CC:DD:EE:FF"
    WAN->>WAN: Assert GPIO DATA_READY
    LAN->>WAN: SPI DQ → [DT]["BLE"][...][CFBL:0:AT+CONNECT=...]
    LAN->>LAN: config_parse → match AT+CONNECT= prefix → command_queue

    LAN->>BLE: UART: AT+CONNECT=AA:BB:CC:DD:EE:FF\r\n
    BLE-->>DEV: BLE connection request
    DEV-->>BLE: BLE connected
    BLE-->>LAN: OK\r\n+CONNECTING\r\n+CONNECTED:0,0x0001\r\n

    LAN->>WAN: SPI uplink: "CFBL:0:OK:OK\x1E+CONNECTING\x1E+CONNECTED:0,0x0001"
    WAN->>SRV: MQTT publish result

    SRV->>WAN: MQTT: "CFBL:0:AT+WRITE=0,0x000E,55AA00010006000501010001010F"
    LAN->>WAN: SPI DQ → dispatch
    LAN->>LAN: match AT+WRITE= prefix → command_queue

    LAN->>BLE: UART: AT+WRITE=0,0x000E,55AA...010F\r\n
    BLE-->>DEV: GATT Write Request (char 2B11)<br/>Tuya frame: switch ON (DP05=0x01)
    DEV-->>BLE: GATT Write Response
    BLE-->>LAN: OK\r\n

    LAN->>WAN: SPI uplink: "CFBL:0:OK:OK"
    WAN->>SRV: MQTT publish: "CFBL:0:OK:OK"

    Note over DEV: Đèn BẬT
```

### 4.3 BLE Listener — Unsolicited Event từ module

```mermaid
sequenceDiagram
    participant DEV as BLE Device<br/>(Tuya E27)
    participant BLE as BLE Module<br/>(STM32WB55)
    participant LAN as LAN MCU<br/>(Listener Task Prio=4)
    participant WAN as WAN MCU
    participant SRV as Server (MQTT)

    Note over DEV,BLE: Device tự gửi notification (trạng thái thay đổi)
    DEV->>BLE: BLE Notification: +NOTIFICATION:0x0001,0x000E,55AA...
    BLE->>LAN: UART unsolicited: +NOTIFICATION:0x0001,0x000E,55AA0001...\r\n

    Note over LAN: ble_handler_listen() returns recv_len>0
    LAN->>LAN: Normalize: \r\n → \x1E
    LAN->>LAN: snprintf: "CFBL:0:EVT:+NOTIFICATION:0x0001,0x000E,55AA..."
    LAN->>LAN: mcu_wan_enqueue_uplink(HANDLER_BLE, evt_packet)

    LAN->>WAN: SPI uplink: [DT]["BLE"][len]["CFBL:0:EVT:+NOTIFICATION:..."]
    WAN->>SRV: MQTT publish<br/>topic: data/gateway/ble<br/>payload: "CFBL:0:EVT:+NOTIFICATION:..."
```

### 4.4 Uplink offline — SD card backup khi mất internet

```mermaid
sequenceDiagram
    participant LAN as LAN MCU
    participant WAN as WAN MCU
    participant SD  as SD Card
    participant SRV as Server (MQTT)

    LAN->>LAN: mcu_wan_enqueue_uplink(HANDLER_BLE, data)
    Note over LAN: Uplink Task flush batch
    LAN->>LAN: xSemaphoreTake(g_qspi_mutex)
    LAN->>WAN: SPI: [DT]["BLE"][len][payload]
    WAN-->>LAN: SPI: ACK_NO_INTERNET
    LAN->>LAN: xSemaphoreGive(g_qspi_mutex)

    LAN->>SD: storage_handler_save(packet)<br/>Write to SD card queue file

    Note over WAN: Internet restored
    WAN->>WAN: Assert GPIO DATA_READY (RT frame)
    LAN->>WAN: SPI DQ → [RT][dd/mm/yyyy][NETWORK_OK]
    Note over LAN: network_status = INTERNET_OK

    LAN->>SD: storage_handler_read_pending()<br/>Read buffered packets
    loop Retry from SD
        LAN->>WAN: SPI: [DT]["BLE"][len][buffered_payload]
        WAN-->>LAN: SPI: ACK_INTERNET_OK
        WAN->>SRV: MQTT publish (delayed)
    end
```

---

## 5. LoRa Sequence Diagrams

### 5.1 Downlink — Config & Join network

```mermaid
sequenceDiagram
    participant SRV as Server (MQTT)
    participant WAN as WAN MCU
    participant LAN as LAN MCU
    participant LOR as LoRa Module<br/>(Wio-E5 mini)
    participant NET as LoRaWAN Network

    Note over SRV,LOR: Bước 1 — Provision (set keys)
    SRV->>WAN: MQTT: "CFLR:0:AT+ID=DevEui,0011223344556677"
    WAN->>WAN: Assert GPIO DATA_READY
    LAN->>WAN: SPI DQ → [DT]["LOR"][...][CFLR:0:AT+ID=DevEui,...]
    LAN->>LAN: config_parse_lora_command<br/>Pass 1 prefix match: AT+ID=<br/>→ func_config{expect="+ID:", timeout=1500ms}
    LAN->>LAN: xQueueSend(command_queue)

    LAN->>LOR: UART: AT+ID=DevEui,0011223344556677\r\n
    LOR-->>LAN: +ID: DevEui, 00:11:22:33:44:55:66:77\r\nOK\r\n
    LAN->>WAN: SPI uplink: "CFLR:0:OK:+ID: DevEui, 00:11:...\x1EOK"
    WAN->>SRV: MQTT publish result

    SRV->>WAN: MQTT: "CFLR:0:AT+KEY=APPKEY,00112233445566778899AABBCCDDEEFF"
    LAN->>WAN: SPI DQ → dispatch
    LAN->>LOR: UART: AT+KEY=APPKEY,...\r\n
    LOR-->>LAN: +KEY: APPKEY, ...\r\nOK\r\n
    LAN->>WAN: SPI uplink: "CFLR:0:OK:..."
    WAN->>SRV: MQTT publish result

    Note over SRV,LOR: Bước 2 — Join OTAA
    SRV->>WAN: MQTT: "CFLR:0:AT+JOIN"
    LAN->>WAN: SPI DQ → dispatch
    LAN->>LAN: match AT+JOIN exact → timeout=30000ms

    LAN->>LOR: UART: AT+JOIN\r\n
    LOR-->>NET: LoRaWAN Join Request (OTAA)
    NET-->>LOR: Join Accept
    LOR-->>LAN: +JOIN: Starting\r\n+JOIN: NORMAL\r\n+JOIN: Network joined\r\nOK\r\n

    LAN->>WAN: SPI uplink: "CFLR:0:OK:+JOIN: Starting\x1E+JOIN: NORMAL\x1E+JOIN: Network joined\x1EOK"
    WAN->>SRV: MQTT publish join result

    Note over SRV,LOR: Bước 3 — Send uplink payload
    SRV->>WAN: MQTT: "CFLR:0:AT+MSG=Hello"
    LAN->>WAN: SPI DQ → dispatch
    LAN->>LOR: UART: AT+MSG=Hello\r\n
    LOR-->>NET: LoRaWAN uplink frame (unconfirmed)
    NET-->>LOR: (optional downlink ACK)
    LOR-->>LAN: +MSG: FPENDING\r\n+MSG: Done\r\nOK\r\n

    LAN->>WAN: SPI uplink: "CFLR:0:OK:+MSG: FPENDING\x1E+MSG: Done\x1EOK"
    WAN->>SRV: MQTT publish
```

### 5.2 LoRa Listener — Async downlink từ LoRaWAN server

```mermaid
sequenceDiagram
    participant NET as LoRaWAN Network<br/>Server
    participant LOR as LoRa Module<br/>(Wio-E5)
    participant LAN as LAN MCU<br/>(Listener Task Prio=4)
    participant WAN as WAN MCU
    participant SRV as MQTT Server

    Note over NET,LOR: Server gửi downlink payload (Class A RX window)
    NET->>LOR: LoRaWAN downlink frame
    LOR->>LAN: UART unsolicited: +EVT:RX1, RSSI=-87, SNR=4\r\n+EVT:RX1 DONE\r\n

    LAN->>LAN: lora_handler_listen() recv_len > 0
    LAN->>LAN: Normalize \r\n → \x1E
    LAN->>LAN: snprintf: "CFLR:0:EVT:+EVT:RX1, RSSI=-87, SNR=4\x1E+EVT:RX1 DONE"
    LAN->>LAN: mcu_wan_enqueue_uplink(HANDLER_LORA)

    LAN->>WAN: SPI: [DT]["LOR"][len]["CFLR:0:EVT:..."]
    WAN->>SRV: MQTT publish: "CFLR:0:EVT:+EVT:RX1..."

    Note over LOR: Join fail event
    LOR->>LAN: UART: +EVT:JOIN FAILED\r\n
    LAN->>LAN: "CFLR:0:EVT:+EVT:JOIN FAILED"
    LAN->>WAN: SPI uplink
    WAN->>SRV: MQTT publish
```

---

## 6. Zigbee Sequence Diagrams

### 6.1 Downlink — Start network & control thiết bị Tuya E27

```mermaid
sequenceDiagram
    participant SRV as Server (MQTT)
    participant WAN as WAN MCU
    participant LAN as LAN MCU
    participant ZB  as Zigbee Module<br/>(STM32WB55 Coord)
    participant DEV as Tuya E27<br/>(Zigbee End Device)

    Note over SRV,ZB: Bước 1 — Khởi động Coordinator
    SRV->>WAN: MQTT: "CFZB:0:6:00" (func_id=6=MODULE_START_NETWORK)
    WAN->>WAN: Assert GPIO DATA_READY
    LAN->>WAN: SPI DQ → [DT]["ZIG"][...][CFZB:0:6:00]
    LAN->>LAN: config_parse_zigbee_command<br/>Parse func_id=6, data=0x00
    LAN->>LAN: xQueueSend(command_queue)

    Note over LAN: Zigbee Downlink Task (Prio=6) wakes
    LAN->>LAN: zigbee_handler_execute_command_with_config<br/>func_id=6 → look up JSON → AT+ZB_START
    LAN->>ZB: UART: AT+ZB_START\r\n
    ZB-->>LAN: OK\r\n (timeout=5000ms)

    LAN->>LAN: zigbee_handler_get_function_config(func_id=6) → func_name
    LAN->>LAN: snprintf: "CFZB:0:OK:MODULE_START_NETWORK"
    LAN->>WAN: SPI uplink: "CFZB:0:OK:MODULE_START_NETWORK"
    WAN->>SRV: MQTT publish result

    Note over SRV,ZB: Bước 2 — Permit Join 60s
    SRV->>WAN: MQTT: "CFZB:0:11:3C" (func_id=11=SET_PERMIT_JOIN, data=0x3C=60s)
    LAN->>WAN: SPI DQ → dispatch func_id=11
    LAN->>ZB: UART: AT+ZB_PERMIT=60\r\n
    ZB-->>LAN: OK\r\n

    Note over DEV: User reset Tuya E27 để enter pairing mode (3 lần nhấn)
    DEV->>ZB: Zigbee Association Request (Join)
    ZB-->>DEV: Association Response (SHORT=0x1234)

    Note over ZB,LAN: Async join event (Listener Task)
    ZB->>LAN: UART unsolicited binary:<br/>[55][80][03][IEEE:8B][SHORT:2B][MODEL:...][XOR]

    LAN->>LAN: zigbee_handler_listen() recv_len>0
    LAN->>LAN: bytes_to_hex_str: "55 80 03 AA BB CC DD EE FF 00 11 34 12 ..."
    LAN->>LAN: snprintf: "CFZB:0:EVT:55 80 03 AA BB..."
    LAN->>WAN: SPI uplink: "CFZB:0:EVT:55 80 03..."
    WAN->>SRV: MQTT publish join event

    Note over SRV,DEV: Bước 3 — Điều khiển đèn (ZCL OnOff)
    SRV->>WAN: MQTT: "CFZB:0:20:34 12 01 01" (func_id=20=ZCL_ONOFF, addr=0x1234, ep=01, cmd=01=ON)
    LAN->>WAN: SPI DQ → dispatch func_id=20
    LAN->>LAN: Build binary frame: [55][AA][LEN][CMD_TYPE][CMD_CODE][SHORT][EP][CMD][XOR]
    LAN->>ZB: UART: AT+ZCL_ONOFF=0x1234,01,1\r\n
    ZB-->>DEV: ZCL OnOff command (unicast)
    DEV-->>ZB: ZCL Default Response: SUCCESS
    ZB-->>LAN: OK\r\n

    Note over DEV: Đèn BẬT
    LAN->>LAN: snprintf: "CFZB:0:OK:MODULE_ZCL_SEND_CONTROL_CMD"
    LAN->>WAN: SPI uplink
    WAN->>SRV: MQTT publish: "CFZB:0:OK:MODULE_ZCL_SEND_CONTROL_CMD"
```

### 6.2 Zigbee Listener — ZCL Report Attribute từ thiết bị

```mermaid
sequenceDiagram
    participant DEV as Tuya E27<br/>(Zigbee Device)
    participant ZB  as Zigbee Module<br/>(STM32WB55)
    participant LAN as LAN MCU<br/>(Listener Task Prio=4)
    participant WAN as WAN MCU
    participant SRV as Server (MQTT)

    Note over DEV,ZB: Thiết bị tự báo cáo trạng thái (Report Attribute)
    DEV->>ZB: ZCL Report Attribute: cluster=0x0006, attr=0x0000, value=0x01
    ZB->>LAN: UART unsolicited binary event:<br/>CMD_TYPE=0x82, CMD_CODE=0x0A<br/>[55][82][0A][SHORT:2B][EP][cluster:2B][attr:2B][type][val...][XOR]

    LAN->>LAN: zigbee_handler_listen() recv_len>0
    LAN->>LAN: bytes_to_hex_str:<br/>"55 82 0A 34 12 01 06 00 00 00 10 01 XX"
    LAN->>LAN: snprintf: "CFZB:0:EVT:55 82 0A 34 12 01 06 00 00 00 10 01 XX"
    LAN->>LAN: mcu_wan_enqueue_uplink(HANDLER_ZIGBEE)

    LAN->>WAN: SPI: [DT]["ZIG"][len]["CFZB:0:EVT:55 82 0A..."]
    WAN->>SRV: MQTT publish<br/>payload: "CFZB:0:EVT:55 82 0A 34 12 01 06 00 00 00 10 01 XX"

    Note over SRV: Server parse hex: CMD=0x82/0A=ATTR_REPORT<br/>SHORT=0x1234, EP=01, Cluster=0x0006, Attr=0x0000, Val=0x01 (ON)
```

---

## 7. SPI Frame Format Reference

```
DOWNLINK từ WAN MCU → LAN MCU (DATA packet):
┌──────┬─────────────────┬────────────────┬────────────────────────┐
│  DT  │  handler_type   │  length (2B)   │  payload (N bytes)     │
│ [44] │  [54][BLE/LOR/  │  [HI][LO]      │  CFBL/CFLR/CFZB:...   │
│ [54] │   ZIG]3B + \0   │                │                        │
└──────┴─────────────────┴────────────────┴────────────────────────┘
  Offset: 0   1           2    3    4       5    6         7+

CONFIG từ WAN MCU → LAN MCU:
┌──────┬────────────────┬────────────────────────────┐
│  CF  │  config_len    │  config_data (JSON)         │
│ [43] │  [HI][LO]      │  {"module_id":"002",...}    │
│ [46] │  2B            │                             │
└──────┴────────────────┴────────────────────────────┘

UPLINK từ LAN MCU → WAN MCU (DATA packet):
  Payload = "CFLR:0:OK:+JOIN: Network joined\x1EOK"
  Wrapped thêm header DT + handler_type + len + RTC timestamp

ACK types:
  0x11 = ACK_RECEIVED_OK    (LAN báo đã nhận)
  0x12 = ACK_INTERNET_OK    (WAN báo đã gửi server thành công)
  0x13 = ACK_NO_INTERNET    (WAN không có internet → LAN lưu SD card)
  0x10 = ACK_HANDSHAKE      (Handshake response)

Handshake flow:
  LAN → [CF][0x01][fw_version 4B]
  WAN → [0x02][0x10][internet_flag][wan_fw 4B]

DQ retry mechanism (Downlink poll):
  1. WAN assert GPIO DATA_READY → ISR fires → notify Downlink Task (Prio=7)
  2. LAN acquire g_qspi_mutex (block Uplink Task)
  3. Loop 10× {send "DQ" → wait 50ms → read response}
  4. On success: dispatch + send ACK + release mutex
  5. On fail (10 retries): log warning + release mutex
```

---

## 8. So sánh 3 handler

| Đặc điểm                   | BLE (`CFBL`)                        | LoRa (`CFLR`)                        | Zigbee (`CFZB`)                        |
|----------------------------|-------------------------------------|--------------------------------------|----------------------------------------|
| **MQTT topic**             | data/gateway/ble                    | data/gateway/lora                    | data/gateway/zigbee                    |
| **DT handler_type**        | `"BLE"`                             | `"LOR"`                              | `"ZIG"`                                |
| **Command format**         | String: `AT+CMD` hoặc func name     | String: `AT+CMD` hoặc func name      | Integer `func_id` + binary hex data    |
| **Command match**          | prefix hoặc exact vs JSON           | Pass 1: prefix / Pass 2: exact       | func_id lookup trong config table      |
| **Module protocol**        | ASCII AT commands                   | ASCII AT commands                    | Binary HEX frame `55 AA ...`           |
| **Startup sequence**       | HW_RESET → 500ms → GET_INFO         | HW_RESET → 500ms → GET_INFO          | HW_RESET → 500ms → AT+EXIT → 200ms → GET_INFO (binary) |
| **Response encoding**      | ASCII, `\r\n` → `\x1E`              | ASCII, `\r\n` → `\x1E`               | Binary → `bytes_to_hex_str` (space-sep hex) |
| **Uplink packet**          | `CFBL:id:OK/FAIL/EVT:response`      | `CFLR:id:OK/FAIL/EVT:response`       | `CFZB:id:OK/FAIL/EVT:func[:hex_data]`  |
| **Async event type**       | Unsolicited ASCII lines             | `+EVT:JOIN_FAILED` `+EVT:RX1`        | Binary CMD_TYPE 0x80/0x82 frames       |
| **Listener output**        | `CFBL:id:EVT:<ascii_line>`          | `CFLR:id:EVT:<ascii_event>`          | `CFZB:id:EVT:<hex_dump>`               |
| **Downlink queue**         | ✅ uplink + downlink + command       | ✅ uplink + downlink + command        | ❌ uplink + command (no downlink queue) |
| **Task priorities**        | UL=5, DL=6, LS=4                    | UL=5, DL=6, LS=4                     | UL=5, DL=6, LS=4                       |
| **Internet offline**       | → SD card backup                    | → SD card backup                     | → SD card backup                       |
| **Batch uplink**           | max 8 pkts / 50ms flush             | max 8 pkts / 50ms flush              | max 8 pkts / 50ms flush                |

### FreeRTOS resource summary (1 stack instance)

| Resource           | BLE / LoRa | Zigbee | Note                          |
|--------------------|------------|--------|-------------------------------|
| FreeRTOS Tasks     | 3          | 3      | uplink, downlink, listener    |
| Queues             | 3          | 2      | BLE/LoRa: +downlink_queue; Zigbee: no separate downlink |
| Task heap (total)  | ~40 KB     | ~40 KB | 16+16+8 KB stack per stack    |
| Listener buffers   | ~1.5 KB    | ~4.6 KB| Zigbee cần hex_str 1536B extra |
| Response alloc     | ~5 KB      | ~2 KB  | Per-command malloc/free        |
| WAN uplink queue   | 50 slots   | 50 slots| shared g_uplink_queue         |

---

*Tham chiếu source: `DA2_esp_LAN/Application/BLE_Handler/src/ble_handler_task.c`, `lora_handler_task.c`, `zigbee_handler_task.c`, `mcu_wan_handler_uplink.c`, `mcu_wan_handler_downlink.c`, `frame_types.h`*  
*Ngày: 2026-03-19*