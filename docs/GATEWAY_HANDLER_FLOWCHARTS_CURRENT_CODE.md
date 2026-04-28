# Gateway Handler Diagrams - Current Firmware

## Hình 1: Luồng xử lý dữ liệu End-to-End Uplink

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
sequenceDiagram
    participant Sensor
    participant LAN_MCU as LAN MCU
    participant WAN_MCU as WAN MCU
    participant Cloud

    Sensor->>LAN_MCU: Data
    LAN_MCU->>WAN_MCU: SPI DATA (seq, crc, payload)
    
    alt SPI bad (CRC Error)
        WAN_MCU-->>LAN_MCU: NACK (seq)
    else SPI ok
        WAN_MCU-->>LAN_MCU: ACK (seq)
        WAN_MCU->>Cloud: MQTT Publish
    end
```
---

## Hình 2: Luồng xử lý dữ liệu End-to-End Downlink

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
sequenceDiagram
    participant Cloud
    participant WAN_MCU as WAN MCU
    participant LAN_MCU as LAN MCU
    participant Sensor

    Cloud->>WAN_MCU: Command (MQTT Downlink)
    WAN_MCU->>LAN_MCU: SPI CMD (seq, crc, payload)
    
    alt SPI bad (CRC Error)
        LAN_MCU-->>WAN_MCU: NACK (retry)
    else SPI ok
        LAN_MCU-->>WAN_MCU: ACK
        LAN_MCU->>Sensor: Forward command (UART/I2C/GPIO)
    end
```
---

## Hình 3: Giao tiếp LAN-MCU ↔ WAN-MCU qua SPI (Async GPIO Handshake)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
sequenceDiagram
    participant LAN_MCU as LAN-MCU (SPI Master)
    participant WAN_MCU as WAN-MCU (SPI Slave)

    Note over LAN_MCU, WAN_MCU: Uplink Data Flow (LAN -> WAN)
    LAN_MCU->>WAN_MCU: DATA (seq, crc, payload)
    alt CRC bad
        WAN_MCU-->>LAN_MCU: NACK (seq)
        LAN_MCU->>WAN_MCU: DATA retransmit
    else CRC ok
        WAN_MCU-->>LAN_MCU: ACK (seq)
    end

    Note over LAN_MCU, WAN_MCU: Downlink Data Flow (WAN -> LAN via GPIO Interrupt)
    WAN_MCU->>LAN_MCU: Assert GPIO Handshake (Tạo ngắt báo có dữ liệu)
    Note right of LAN_MCU: LAN-MCU xử lý ngắt (Interrupt)
    LAN_MCU->>WAN_MCU: SPI Clocking (Đọc dữ liệu)
    WAN_MCU-->>LAN_MCU: CMD (seq, crc, payload)
    WAN_MCU->>LAN_MCU: De-assert GPIO Handshake
    
    alt CRC bad
        LAN_MCU-->>WAN_MCU: NACK (seq)
    else CRC ok
        LAN_MCU-->>WAN_MCU: ACK (seq)
    end
```
---

## Hình 4: Cập nhật cấu hình từ App PC (USB/UART)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
sequenceDiagram
    participant PC as App PC (Python)
    participant WAN_MCU as WAN-MCU
    participant LAN_MCU as LAN-MCU

    Note over PC, WAN_MCU: Giai đoạn 1: Kết nối & Nhận diện
    PC->>WAN_MCU: Scan & Connect 
    WAN_MCU-->>PC: Trả về Device Info / Current Config
    
    Note over PC, LAN_MCU: Giai đoạn 2: Cập nhật cấu hình
    PC->>WAN_MCU: Gửi lệnh "CF..." (USB/UART)
    WAN_MCU-->>PC: OK CMD_QUEUED
    
    WAN_MCU->>WAN_MCU: Parse + Xác định Target (WAN/LAN)
    
    alt Target = WAN
        WAN_MCU->>WAN_MCU: Validate + Save NVS + Apply (Net/MQTT/...)
    else Target = LAN
        WAN_MCU->>LAN_MCU: Forward config (SPI)
        LAN_MCU->>LAN_MCU: Validate + Save NVS + Apply
        LAN_MCU-->>WAN_MCU: ACK (OK/FAIL)
    end
    
    WAN_MCU-->>PC: Reply Result (OK/FAIL)
```

---

## Hình 5: Cập nhật cấu hình từ Web Config Portal

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
sequenceDiagram
    participant Browser as Browser (HTTP)
    participant WAN_MCU as WAN MCU (DA2_esp)
    participant LAN_MCU as LAN MCU (DA2_esp_LAN)

    Note over Browser, LAN_MCU: Cấu hình WAN (WiFi, LTE, MQTT, ...)
    Browser->>WAN_MCU: POST /api/config {"wifi":{"ssid":"MyNetwork"}}
    WAN_MCU->>WAN_MCU: Parse JSON -> Build CFWF command<br/>Push vào config_handler_queue
    WAN_MCU->>WAN_MCU: config_handler_task apply<br/>NVS save + esp_wifi_set_config()
    WAN_MCU-->>Browser: HTTP 200 OK

    Note over Browser, LAN_MCU: Cấu hình LAN (BLE, LoRa, Zigbee)
    Browser->>WAN_MCU: POST /api/lan_config {"type":"BLE", "config":{...}}
    WAN_MCU->>WAN_MCU: Parse JSON -> Build CFBL:JSON<br/>Push vào config_handler_queue
    WAN_MCU->>LAN_MCU: SPI Master: [HEADER][CFBL:JSON][CHECKSUM]
    LAN_MCU->>LAN_MCU: SPI Slave receive complete<br/>Parse CFBL prefix
    LAN_MCU->>LAN_MCU: JSON Parser -> NVS save<br/>Module Monitor: Stop -> Reinit bus -> Start BLE handler
    LAN_MCU-->>WAN_MCU: SPI Uplink: ML:CFBL:0:OK
    WAN_MCU-->>Browser: HTTP 200 OK

```

---

## Hình 6: Lưu đồ giải thuật Data Communication Handler

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
flowchart TD
    A[PC send command] --> B[WAN parse command]
    B --> C{Scan/Read?}
    
    C -- Yes --> D[Read config từ NVS/RAM]
    D --> E[Reply config về PC]
    
    C -- No --> F[Queue + validate config]
    F --> G{Target MCU?}
    
    G -- WAN --> H[Save to NVS + Apply]
    G -- LAN --> I[Forward to LAN via SPI]
    
    I --> J{LAN ACK?}
    J -- OK --> K[LAN: Save + Apply<br/>WAN: Ghi nhận OK]
    J -- FAIL --> L[LAN: Giữ config cũ<br/>WAN: Ghi nhận Lỗi]
    
    H --> M[Reply OK/FAIL về PC]
    K --> M
    L --> M
```
---

## Hình 7: Lưu đồ giải thuật FOTA Dual-MCU

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
flowchart TD
    A[Server gửi lệnh OTA] --> B[Gateway nhận lệnh, WAN đánh dấu OTA mode]
    B --> C[WAN khởi tạo chế độ WiFi AP]
    C --> D[LAN kết nối vào WiFi AP của WAN, lấy IP]
    D --> E[LAN tải Firmware & tiến hành Update]
    
    E --> F{LAN Update OK?}
    F -- No --> G[Fallback về phiên bản cũ]
    F -- Yes --> H[LAN gửi tín hiệu Handshake báo xong cho WAN]
    
    H --> I[WAN tự tiến hành OTA Update]
    I --> J{WAN Update OK?}
    J -- No --> G
    J -- Yes --> K[Báo cáo OK & Version mới lên Server]
```
---

## Hình 8 Hệ thống cấu hình Module Base Setting (JSON)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
flowchart TD
    A[Nhận JSON Config<br/>vào LAN MCU] --> B[LAN MCU Parse JSON]
    B --> C[Khởi tạo Hardware<br/>UART, SPI, I2C, GPIO]
    C --> D[Khởi động Handler Task<br/>Chờ lệnh điều khiển]
    
    D --> E[Nhận lệnh thực thi<br/>vd: MODULE_BLE_SCAN:5000 / MODULE_HW_RESET]
    E --> F{Match function<br/>trong JSON?}
    
    F -- Prefix match --> G[Trích xuất GPIO & Timeout từ JSON<br/>Gửi lệnh qua UART đến Module]
    F -- Exact match / GPIO-only --> H[Thực thi chuỗi Toggle GPIO<br/>Không giao tiếp UART]
    F -- Mismatch --> I[Báo lỗi Command Not Found]
    
    G --> J([Phản hồi kết quả])
    H --> J
    I --> J
```
---

## Hình 9: Luồng điều khiển End-to-End từ ThingsBoard đến thiết bị BLE (ESP32 LED Bulb)
```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontSize': '30px', 'fontWeight': '900', 'fontFamily': 'Segoe UI, Arial, sans-serif', 'lineColor': '#111', 'primaryBorderColor': '#111', 'secondaryBorderColor': '#111', 'tertiaryBorderColor': '#111', 'textColor': '#000', 'primaryTextColor': '#000'}, 'themeCSS': '.label, .nodeLabel, .edgeLabel, .messageText, .actor, .noteText, .loopText, .taskText, .sectionTitle, text, tspan { font-size: 30px !important; font-weight: 900 !important; font-family: Segoe UI, Arial, sans-serif !important; fill: #000 !important; } .messageLine0, .messageLine1, .messageLine2, .signal, .edgePath path, .flowchart-link, .actor-line { stroke-width: 2.6px !important; stroke: #111 !important; } rect, circle, polygon, path { stroke-width: 2.4px !important; stroke: #111 !important; }'}}}%%
sequenceDiagram
    participant TB as ThingsBoard Dashboard
    participant WAN as WAN MCU (DA2_esp)
    participant LAN as LAN MCU (DA2_esp_LAN)
    participant BLE as STM32WB55 (BLE Central)
    participant LED as ESP32 LED Bulb

    Note over TB, LED: Stage 1 - Load BLE module config (one-time)
    
    TB->>WAN: MQTT: CFBL:JSON:{module_id, baudrate, functions[]}
    WAN->>LAN: SPI forward
    LAN->>LAN: Parse JSON -> Init UART 115200 -> Start BLE handler
    LAN-->>WAN: ACK: OK
    WAN-->>TB: MQTT: config_saved

    Note over TB, LED: Stage 2 - Control LED device
    
    TB->>WAN: MQTT RPC: CFBL:0:MODULE_BLE_CONNECT:AA:BB:CC:DD:EE:FF
    WAN->>LAN: SPI forward
    LAN->>BLE: UART: AT+CONNECT=AA:BB:CC:DD:EE:FF\r\n
    BLE->>LED: BLE GATT Connect
    BLE-->>LAN: +CONNECTED:0
    LAN-->>WAN: SPI uplink: OK
    WAN-->>TB: MQTT: connected
    
    TB->>WAN: MQTT RPC: CFBL:0:MODULE_BLE_WRITE=0,0x000F,01 (Turn ON)
    WAN->>LAN: SPI forward
    LAN->>BLE: UART: AT+WRITE=...
    BLE->>LED: BLE GATT Write Characteristic
    LED-->>BLE: BLE Notify: ACK
    BLE-->>LAN: +NOTIFY:...
    LAN-->>WAN: SPI uplink: OK
    WAN-->>TB: MQTT: lamp_on
```


