# Gateway Handler Diagrams - Current Firmware

Ban rut gon cho luan van, chi giu cac luong dung voi firmware hien tai.

Chinh sua chinh:
- MQTT chi cho reconnect toi da 10 giay, khong retry sau `publish()` fail.
- LAN duoc danh thuc bang GPIO ISR roi moi DQ.
- PC app theo thu tu scan -> connect -> thao tac.
- `POST /api/lan_config` tra ket qua sau enqueue.
- Parser LAN uu tien cu phap `MODULE_*`, van giu raw-command fallback.
- LAN FOTA di qua Wi-Fi AP `DA2-FOTA`, khong dung PPP lam duong download firmware.

---

## Figure 1 - MQTT publish and reconnect behavior

```mermaid
sequenceDiagram
    participant LAN as LAN MCU
    participant WANQ as WAN publish queue
    participant WAN as WAN MQTT publish task
    participant MQ as esp_mqtt_client
    participant SRV as Broker / ThingsBoard

    LAN->>WANQ: enqueue uplink payload
    WANQ->>WAN: dequeue item

    alt MQTT disconnected
        WAN->>WAN: wait auto-reconnect up to 10 s
        alt reconnect happens in time
            WAN->>WAN: continue publish flow
        else timeout after 10 s
            WAN->>WAN: discard queued item
            Note over WAN: timeout discard is recorded in perf metrics
        end
    end

    WAN->>WAN: convert binary payload to hex JSON

    alt RPC response pending
        WAN->>MQ: publish to .../response/{rpc_id}
    else normal uplink
        WAN->>MQ: publish to normal telemetry topic
    end

    MQ->>SRV: MQTT publish

    alt msg_id >= 0
        WAN->>WAN: mark publish success
    else msg_id < 0
        WAN->>WAN: log publish failure only
        Note over WAN: no extra retry loop after publish() fail
    end
```

Note: firmware hien tai khong retry lai ban tin sau khi `esp_mqtt_client_publish()` tra ve loi.

---

## Figure 2 - Cloud command to node and real response path

```mermaid
sequenceDiagram
    participant TB as ThingsBoard / MQTT server
    participant WAN as WAN MQTT event handler
    participant DLQ as WAN downlink queue
    participant LAN as LAN MCU
    participant MOD as BLE / LoRa / Zigbee module
    participant UQ as WAN publish queue

    TB->>WAN: MQTT data on RPC request topic or subscribed command topic
    WAN->>WAN: if topic is RPC request, store rpc_id

    alt payload is JSON
        WAN->>WAN: extract params from {"params":"..."}
    else raw string payload
        WAN->>WAN: use raw payload as command
    end

    WAN->>DLQ: enqueue command text
    DLQ->>LAN: forward downlink over SPI on next DQ service
    LAN->>MOD: execute command via handler task
    MOD-->>LAN: command response or event
    LAN->>UQ: uplink real module result
    UQ->>WAN: dequeue response payload

    alt rpc_id exists
        WAN->>TB: publish actual result to .../response/{rpc_id}
    else no rpc_id
        WAN->>TB: publish to normal uplink topic
    end
```

Note: there is no separate cloud-to-node delivery-status notification path in the current code. The observable response is the actual module output routed back from LAN to WAN.

---

## Figure 3 - Async GPIO notify plus DQ fetch

```mermaid
sequenceDiagram
    participant WAN as WAN MCU
    participant GPIO as DATA_READY GPIO
    participant ISR as LAN GPIO ISR
    participant DLT as LAN downlink task<br/>prio 7
    participant SPI as SPI bus
    participant PARSER as LAN dispatcher

    WAN->>GPIO: assert DATA_READY
    GPIO->>ISR: rising edge interrupt
    ISR->>DLT: xTaskNotifyFromISR()
    Note over DLT: task wakes immediately from blocked state

    DLT->>SPI: take SPI mutex

    loop up to 10 retries, 50 ms spacing
        DLT->>WAN: send DQ
        WAN-->>DLT: DT / CF frame or no-data polling frame
    end

    alt DT frame
        DLT->>WAN: ACK_RECEIVED_OK
        DLT->>PARSER: dispatch handler payload
    else CF frame
        DLT->>PARSER: dispatch config or config-query path
    else no data
        DLT->>DLT: exit this service cycle
    end

    DLT->>SPI: release mutex
    Note over DLT: CPU stays free until the next GPIO edge
```

Note: DQ van ton tai, nhung co che kich hoat chinh la GPIO ISR.

---

## Figure 4 - PC app scan first, connect second

```mermaid
sequenceDiagram
    participant USER as User
    participant APP as DATN_config_app
    participant SM as serial.manager
    participant PORT as Candidate COM ports
    participant GW as Gateway UART

    USER->>APP: click Scan
    APP->>SM: scan_for_gateways()
    SM->>SM: filter candidate ports by known USB-serial adapters

    loop candidate ports
        SM->>PORT: open port with DTR/RTS low
        SM->>GW: send CFSC\r\n probe
        GW-->>SM: CFSC_RESP:START ...
    end

    SM-->>APP: confirmed gateway port list
    APP->>APP: populate combo with confirmed ports only

    USER->>APP: choose port and click Connect
    APP->>SM: connect(port, baudrate)
    SM->>GW: open port, wait 150 ms, flush input, start read thread

    USER->>APP: send config / command after connection
```

Note: logic hien tai la `scan -> connect -> operate`.

---

## Figure 5 - Current web config API behavior

```mermaid
sequenceDiagram
    participant WEB as Browser / Web UI
    participant API as WAN web server
    participant CQ as WAN config queue
    participant LAN as LAN MCU

    alt POST /api/config
        WEB->>API: partial WAN config JSON
        API->>API: build WF / LT / IN / SV / MQ / HP / CP / ML:CFFU commands
        API->>CQ: enqueue matching commands
        API-->>WEB: {"ok":...,"queued":n,"errors":m}
    end

    alt GET /api/lan_config
        WEB->>API: request LAN config
        API->>LAN: mcu_lan_handler_request_config_async(..., timeout=5000)
        LAN-->>API: raw LAN config text
        API-->>WEB: {"ok":true,"data":"..."}
    end

    alt POST /api/lan_config
        WEB->>API: {type,data}
        API->>API: build ML:CFBL / ML:CFLR / ML:CFZB / ML:CFRS wire string
        API->>CQ: enqueue CONFIG_TYPE_MCU_LAN item
        API-->>WEB: {"ok":true}
        Note over API,WEB: HTTP response is sent after enqueue only
        CQ->>LAN: execution happens later over SPI
    end
```

Note: `GET /api/lan_config` cho LAN tra loi; `POST /api/lan_config` chi xac nhan enqueue thanh cong.

---

## Figure 6 - Current BLE / LoRa / Zigbee command parser model

```mermaid
flowchart TD
    A[Lenh tu UART / Web / MQTT] --> B[WAN forward CFBL / CFLR / CFZB sang LAN]
    B --> C{Loai lenh}

    C -->|MODULE_*| D[Parse CFxx:<slot>:MODULE_*[:data]]
    D --> E[Tra JSON function config]
    E --> F[Build lenh cuoi cung cho module]

    C -->|Raw command| G[Parse CFxx:<slot>:AT+...]
    G --> H[Raw-command fallback]
    H --> F

    F --> I[Enqueue vao task BLE / LoRa / Zigbee]
    I --> J[Module thuc thi]
    J --> K[Tra ve CFxx:<slot>:OK / FAIL / EVT]
```

Vi du uu tien:
- `CFBL:0:MODULE_START_DISCOVERY:5000`
- `CFLR:0:MODULE_SET_DEVEUI:0011223344556677`
- `CFZB:0:MODULE_START_NETWORK`

Note: raw-command fallback van duoc ho tro, nhung khong nen dung cu phap Zigbee so cu lam giao thuc chinh.

---

## Figure 7 - LAN FOTA over WAN Wi-Fi AP

```mermaid
flowchart TD
    A[CFML:CFFU:<url> tuy chon] --> B[Luu URL firmware LAN vao NVS]
    B --> C[CFML:CFFW[:url][:FORCE]]
    A --> C

    C --> D[WAN nhan lenh FOTA LAN]
    D --> E[fota_ap_start]
    E --> F[Mo SoftAP DA2-FOTA + DHCP + NAPT]
    F --> G[Forward CFFW sang LAN qua SPI]
    G --> H[LAN dung MCU-WAN handler]
    H --> I[LAN start FOTA task]
    I --> J[LAN ket noi Wi-Fi toi DA2-FOTA]
    J --> K[Tai firmware tu URL da luu]
    K --> L[Ghi OTA va reboot]
    L --> M[LAN reconnect ve WAN]
    M --> N[WAN dong FOTA AP]
```

Note: duong LAN OTA hien tai la Wi-Fi STA -> WAN SoftAP -> internet qua NAPT.

---

## Figure 8 - Command syntax mapping at the current interfaces

```mermaid
flowchart TD
    A[External command source] --> B{Entry interface}

    B -->|UART / Python app| U[CFML:CFxx:...]
    B -->|Web API| W[ML:CFxx:... built internally]
    B -->|MQTT RPC| M[JSON params or raw CFxx command]

    U --> Q[WAN config queue]
    W --> Q
    M --> R[WAN MQTT parser]
    R --> S[Downlink queue]
    S --> T[LAN receives CFxx payload]
    Q -->|CONFIG_TYPE_MCU_LAN strips outer ML| T

    T --> P{LAN parser family}

    P --> BLE[CFBL:JSON:<slot>:<json><br/>CFBL:<slot>:MODULE_*[:data]<br/>CFBL:<slot>:AT+... fallback]
    P --> LOR[CFLR:JSON:<slot>:<json><br/>CFLR:<slot>:MODULE_*[:data]<br/>CFLR:<slot>:AT+... fallback]
    P --> ZB[CFZB:JSON:<slot>:<json><br/>CFZB:<slot>:MODULE_*[:data]<br/>CFZB:<slot>:AT+... fallback]
    P --> RS[CFRS:JSON:<slot>:<json><br/>CFRS:BR:<baud>]
    P --> FOTA[CFFU:<url><br/>CFFW[:url][:FORCE]]
```

Syntax notes ngan:
- UART / Python dung `CFML:...` cho lenh di LAN.
- Web API tu build `ML:...` truoc khi enqueue.
- MQTT RPC tach `params` roi forward thanh lenh `CFBL/CFLR/CFZB...`.
