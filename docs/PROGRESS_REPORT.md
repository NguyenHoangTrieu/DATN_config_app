# DA2 IoT Gateway -- Project Progress Report

Author: Developer (DATN)
Date: March 2026
Firmware WAN: DA2_esp v1.1.1 | Firmware LAN: DA2_esp_LAN v1.1.1.2
PC App: DATN_config_app v4.0 (v5.0 in design)

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Feature 1 — JSON-Based Module Base Setting (Tested)](#2-feature-1--json-based-module-base-setting-tested)
3. [Feature 2 — Embedded Web Config Portal (Tested)](#3-feature-2--embedded-web-config-portal-tested)
4. [Feature 3 — ESP32-S3 Native BLE Mesh Provisioner (Not Tested)](#4-feature-3--esp32-s3-native-ble-mesh-provisioner-not-tested)
5. [Feature 4 — Test Application: Tuya E27 LED Control (Not Tested)](#5-feature-4--test-application-tuya-e27-led-control-not-tested)
6. [Feature 5 — New Hardware Board Adaptation (In Progress)](#6-feature-5--new-hardware-board-adaptation-in-progress)
7. [What Changed From the Previous Version](#7-what-changed-from-the-previous-version)
8. [Known Issues & Risks](#8-known-issues--risks)
9. [Summary Statistics](#9-summary-statistics)

---

## 1. System Architecture Overview

The DA2 Gateway is a **dual-MCU IoT gateway** built on two ESP32-S3 modules working cooperatively:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DA2 Gateway System                          │
│                                                                     │
│  ┌──────────────────┐  SPI 40MHz+DMA  ┌───────────────────────┐    │
│  │  DA2_esp (WAN)   │◄───────────────►│  DA2_esp_LAN (LAN)    │    │
│  │  ESP32-S3        │                 │  ESP32-S3             │    │
│  │                  │                 │                       │    │
│  │  - WiFi / LTE 4G │                 │ - Stack 0 (Module A)  │    │
│  │  - MQTT/HTTP/CoAP│  PPP/UART       │ - Stack 1 (Module B)  │    │
│  │  - FOTA (WAN)    │◄────────────────│ - SD Card 100KB buffer│    │
│  │  - OLED monitor  │                 │ - BLE/LoRa/Zigbee/    │    │
│  │  - Web Portal    │                 │   RS485 controllers   │    │
│  │  - UART Config   │                 │ - FOTA (LAN)          │    │
│  └────────┬─────────┘                 └────────────┬──────────┘    │
│           │ USB / LTE                              │ UART/SPI/I2C  │
│    ┌──────┴──────┐                       ┌─────────┴──────────┐    │
│    │  4G Modem   │                       │  STM32WB55 BLE     │    │
│    │(A7600/SIM76)│                       │  Module (AT cmd)   │    │
│    └─────────────┘                       └────────────────────┘    │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │        DATN_config_app  (Python Tkinter — PC Tool)          │    │
│  │  UART ──► CFSC Protocol ──► WAN MCU ──► All System Config  │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**Core design principles:**
- All configuration persisted to NVS — survives power cycles.
- Layered architecture: BSP → Middleware → Application on both MCUs.
- Single shared `g_config_handler_queue` routes commands from all sources (UART, USB, Web, MQTT, SPI).
- Two-byte frame header (`CF`/`DT`/`DQ`/`CQ`) + ACK mechanism over SPI for reliable LAN–WAN communication.

---

## 2. Feature 1 — JSON-Based Module Base Setting (Tested)

### 2.1 What It Is

The **Module Base Setting** is the central architectural innovation of this project. Instead of hardcoding driver behavior for each RF module, all interaction parameters (AT commands, GPIO sequences, timeouts, bus type) are described in a **JSON configuration file** stored in NVS. This makes the gateway firmware **module-agnostic** — adding support for a new module requires only a new JSON file, not a firmware recompile.

### 2.2 How It Was Implemented

#### Step 1 — JSON Schema Design

A standardized JSON schema was designed covering all module types (BLE, LoRa, Zigbee). Each config file includes:

```json
{
  "module_id": "002",
  "module_type": "BLE",
  "module_name": "STM32WB_BLE_Gateway",
  "module_communication": {
    "port_type": "uart",
    "parameters": { "baudrate": 115200, "parity": "none", "stopbit": 1 }
  },
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

Six pre-built config files were created in `DATN_config_app/src/config/`:
- `stack_001_config.json` — Zigbee (E180-ZG120B)
- `stack_002_config.json` — BLE (STM32WB55)
- `stack_003_config.json` — LoRa (RAK3172)
- `stack_004_config.json` — BLE (Custom)
- `stack_005_config.json` — Zigbee (STM32WB55)
- `stack_006_config.json` — LoRa (Wio-E5)

A `stack_id_map.json` maps hardware-detected stack IDs to module types and config prefixes.

#### Step 2 — Firmware Parser (DA2_esp_LAN / Middleware)

A dedicated `JSON_Config_Parser` middleware was created with separate parsers for each module type:

| Parser File | Module | Key Structs |
|---|---|---|
| `json_config_parser.c` | Common metadata | `module_metadata_t`, `comm_config_t` |
| `json_ble_config_parser.c` | BLE | `ble_config_t`, `ble_function_config_t` |
| `json_lora_config_parser.c` | LoRa | `lora_config_t`, `lora_function_config_t` |
| `json_zigbee_config_parser.c` | Zigbee | `zigbee_config_t`, `zigbee_function_config_t` |
| `json_rs485_config_parser.c` | RS485 | `rs485_config_t` |

Each function entry is parsed into a C struct carrying: function enum, AT command string, GPIO control list (before/after), `delay_start`, `expect_response`, `timeout`, `delay_end`, and an `is_prefix` flag.

#### Step 3 — Module Config Controller (Middleware)

The `Module_Config_Controller` middleware reads the parsed config and initializes the correct hardware bus:
- **UART**: configures ESP32 UART peripheral with parsed baudrate/parity/stop bits.
- **SPI**: initializes SPI bus with parsed clock/CS parameters.
- **I2C**: initializes I2C bus with parsed address/speed.
- **USB**: initializes USB CDC with parsed endpoint.

This abstraction means the handler task never calls low-level peripheral APIs directly.

#### Step 4 — Module Monitor Task (Application)

`Module_Monitor_Task` is the **lifecycle manager** for all RF module handlers. It is the first application task to start after boot:

```
Boot → NVS init → Stack Handler (detect IDs) → Config Handler starts
→ Module Monitor Task:
    1. Read stack IDs from hardware (TCA6424A I2C GPIO expander)
    2. Try loading saved JSON config from NVS for each slot
    3. If config found → parse → auto-start matching handler task
    4. Sit in queue loop → on new JSON from PC App:
         - Validate & parse module_type
         - Save to NVS
         - Start (or restart) the correct handler task
```

This replaces the old approach where the firmware would auto-start a hardcoded BLE handler unconditionally.

#### Step 5 — Config Handler Extended (Application)

The `Config_Handler` on LAN MCU was extended with sub-handlers for each module type:

| File | Handles | Command prefix |
|---|---|---|
| `config_handler_ble_commands.c` | BLE JSON load + BLE AT forwarding | `CFBL:` |
| `config_handler_lora_commands.c` | LoRa JSON load + LoRa AT forwarding | `CFLR:` |
| `config_handler_zigbee_commands.c` | Zigbee JSON load + Zigbee HEX forwarding | `CFZB:` |
| `config_handler_rs485_commands.c` | RS485 baudrate config | `CFRS:` |

The BLE command handler implements the **prefix matching** pattern: for commands coming from the server (e.g., `AT+SCAN=5000`), `config_parse_ble_command()` loops over all functions in the loaded JSON, finds the entry whose `command` field is a prefix of the incoming string, then applies that function's GPIO/delay/timeout parameters. This eliminates per-command hardcoding.

#### Step 6 — PC App JSON Builder (DATN_config_app)

The advanced tabs (BLE / LoRa / Zigbee) in the PC app were redesigned to be **JSON Config Builders** rather than direct AT command senders. The user fills in:
- Module ID, Name, Stack Slot
- Communication type (UART/SPI/I2C/USB) and parameters
- Per-function settings (AT command string, GPIO controls, timeouts)

The app generates the complete JSON and sends it as `CFBL:JSON:<len>:<json_data>` (or `CFLR:` / `CFZB:`). The gateway saves the config, restarts the appropriate handler, and confirms with `JSON_PARSED_OK`.

**Testing status:** The full pipeline (PC App → UART → WAN MCU → SPI → LAN MCU → parse → NVS save → handler restart) has been tested and confirmed working with the BLE module. Parser verification documents confirm all metadata and function fields parse correctly. Boot log capture shows the expected `MODULE_MONITOR: Config parsed for Stack 0: type=1 (BLE)` sequence.

---

## 3. Feature 2 — Embedded Web Config Portal (Tested)

### 3.1 What It Is

A browser-accessible configuration portal embedded directly in the `DA2_esp` (WAN MCU) firmware. It allows users to configure WiFi, LTE, MQTT/HTTP/CoAP, and module settings from any browser on the local network — without needing the Python PC app or a USB cable after initial setup.

### 3.2 How It Was Implemented

#### Architecture Decision — EMBED_TXTFILES (No Filesystem Partition)

The web UI is built as a **single-file SPA** and embedded into the firmware binary at compile time using CMake's `target_add_binary_data`. This choice was deliberate:

- No changes to `partitions.csv` required — the existing `ota_0` / `ota_1` (7 MB each) are large enough.
- Web UI and firmware are always in sync — same binary, no version mismatch risk.
- Simpler than adding a LittleFS partition and managing file upload.

#### Frontend (Vite SPA)

Location: `DA2_esp/Application/Web_Config_Handler/web/`

Built with Vite + `vite-plugin-singlefile`, which inlines all JS and CSS into one `index.html`. The build output (`dist/index.html`) is the file embedded into firmware. A `mock_server.js` enables local development against simulated API responses.

Key UI pages mirror the Python PC app layout:
- **Basic Mode**: Status cards for WiFi, LTE, Server status; read-only module info.
- **Advanced Mode**: Full-form tabs for WiFi, LTE, MQTT, HTTP, CoAP, BLE/LoRa/Zigbee, Firmware OTA.
- Color palette matches the PC app (`#1565C0` accent, `#F5F5F5` background, Segoe UI font).

#### Backend (ESP-IDF C)

Location: `DA2_esp/Application/Web_Config_Handler/src/`

Four source files:

| File | Role |
|---|---|
| `web_server.c` | `esp_http_server` init, route registration, AP/STA mode management |
| `api_config.c` | `GET /api/config` and `POST /api/config` handlers |
| `api_status.c` | `GET /api/status` — uptime, RSSI, firmware version, internet status |
| `captive_dns.c` | DNS server that redirects all queries to `192.168.4.1` in AP mode |

The web server integrates as a **new command source** that pushes to the same `g_config_handler_queue` used by UART, so `config_handler.c` needed zero changes.

**AP mode (first boot / no WiFi saved):**
1. ESP32 starts WiFi AP `DA2-Gateway-XXXX`.
2. DNS server intercepts all queries and returns `192.168.4.1`.
3. Browser displays captive portal automatically on Android/iOS.
4. User enters WiFi credentials → `POST /api/config` → saved to NVS → reboot to STA mode.

**STA mode (normal operation):**
- Web server continues running on the STA IP address.
- mDNS registers `gateway.local` for discovery without knowing the IP.
- `GET /api/status` polled every 5 seconds by the frontend status indicator.

#### API Contract Summary

| Endpoint | Method | Description |
|---|---|---|
| `/api/config` | GET | Returns full current config JSON (WiFi, LTE, MQTT, HTTP, CoAP, modules) |
| `/api/config` | POST | Accepts partial config JSON; pushes matching commands to config queue |
| `/api/status` | GET | Returns uptime, firmware version, internet status, RSSI |
| `/api/reboot` | POST | Calls `esp_restart()` |

**Testing status:** The web portal has been tested. WiFi provisioning via AP captive portal, config read/write via STA mode, and OTA URL trigger have all been verified on hardware.

---

## 4. Feature 3 — ESP32-S3 Native BLE Mesh Provisioner (Not Tested)

### 4.1 Why It Was Needed

During testing of BLE control for Tuya E27 smart bulbs, a fundamental incompatibility was discovered: the **AT command BLE Central approach (STM32WB55)** cannot connect to Tuya E27 because the bulb continuously broadcasts `ADV_NONCONN_IND (0x03)` — the BLE Mesh unprovisioned device beacon (BT SIG Mesh Profile v1.0). A GATT Central (`AT+CONNECT`) requires `ADV_IND (0x00)`. The `AT+CONNECT` command would hang indefinitely.

The solution is to implement a **BLE Mesh Provisioner** directly on the ESP32-S3 (LAN MCU), which natively supports provisioning and controlling BLE Mesh devices.

### 4.2 How It Was Implemented

All new code resides in **`DA2_esp_LAN`**. The WAN MCU (`DA2_esp`) requires no changes.

#### New File Structure

```
DA2_esp_LAN/Application/BLE_Handler/
├── src/
│   ├── ble_native_handler.c    — BLE Mesh stack init, callbacks (provisioner role)
│   ├── ble_native_config.c     — JSON config parser + runtime store
│   ├── ble_native_uplink.c     — Queue → mcu_wan_enqueue_uplink()
│   └── ble_native_downlink.c   — Verb dispatch → ESP BLE Mesh API
DA2_esp_LAN/Application/Config_Handler/
└── src/
    └── config_handler_ble_native_commands.c  — Parses CFBN: prefix commands
```

#### Changes to Existing Files

| File | Change |
|---|---|
| `Config_Handler/include/config_handler.h` | Added `CONFIG_UPDATE_BLE_NATIVE_JSON = 12`, `CONFIG_UPDATE_BLE_NATIVE_CMD = 13` |
| `Config_Handler/src/config_handler.c` | Added `"CFBN"` detection in `config_parse_type()` + 2 new switch cases |
| `MCU_WAN_Handler/include/frame_types.h` | Added `HANDLER_BLE_NATIVE = 0x06`, `HANDLER_TYPE_BLN "BLN"` |
| `main/DA2_esp_LAN.h` | Added `#include "ble_native_handler.h"` |
| `main/CMakeLists.txt` | Added 5 new source files |

#### BLE Mesh Models

The provisioner registers standard BT SIG client models:

| Model | SIG ID | Purpose |
|---|---|---|
| Config Server | built-in | Required by spec |
| Config Client | built-in | Bind app-key on remote nodes |
| Generic OnOff Client | `0x1000` | On/Off control |
| Light Lightness Client | `0x1300` | Brightness control |
| Light CTL Client | `0x1303` | Color temperature control |

Model selection is driven by the `"model_id"` field in the commands JSON — **no hardcoding in firmware**.

#### Command Protocol — `CFBN:`

Follows the same prefix pattern as `CFBL:`, `CFLR:`, `CFZB:`:

| Command | Description |
|---|---|
| `CFBN:JSON:0:<json>` | Load provisioner network key, app key, commands table |
| `CFBN:0:SCAN` | Scan for unprovisioned devices (returns `+UNPROV:UUID,RSSI`) |
| `CFBN:0:PROVISION:<uuid>` | Provision a device (returns `+PROV_DONE:addr` or `+PROV_FAIL`) |
| `CFBN:0:CONTROL:<json>` | Send mesh control payload (OnOff / Lightness / CTL) |
| `CFBN:0:STATUS:<addr>` | Request model status from a node |

#### sdkconfig Requirements

```
CONFIG_BT_ENABLED=y
CONFIG_BLE_MESH=y
CONFIG_BLE_MESH_PROVISIONER=y
CONFIG_BLE_MESH_PB_ADV=y
CONFIG_BLE_MESH_GENERIC_ONOFF_CLI=y
CONFIG_BLE_MESH_LIGHT_LIGHTNESS_CLI=y
CONFIG_BLE_MESH_LIGHT_CTL_CLI=y
```

**Testing status:** Code is written and compiles. Hardware testing has not yet been performed. The provisioner init sequence and command routing have been verified by code review but not on-device.

---

## 5. Feature 4 — Test Application: Tuya E27 LED Control (Not Tested)

### 5.1 What It Is

A test application demonstrating full end-to-end BLE control of a **Tuya E27 smart LED bulb** through the gateway. It covers two parallel BLE paths: the AT-command path via STM32WB55 and the native BLE Mesh path via ESP32-S3.

### 5.2 Command Set Developed

The Tuya E27 uses a **proprietary binary TLV protocol** sent over BLE GATT (Write Characteristic `2B11`, Notify `2B10`, Service UUID `1910`).

#### AT Command Path (STM32WB55)

The full command sequence from initialization through LED control was documented and tested manually:

**Init flow:**
```
CFBL:0:MODULE_HW_RESET          — GPIO toggle RST pin
CFBL:0:AT+GETINFO               — Verify module firmware
CFBL:0:AT+SCAN=5000             — Discover E27 bulb MAC
CFBL:0:AT+CONNECT=A4C138XXYYZZ  — Connect
CFBL:0:AT+DISC=0                — Discover GATT services
CFBL:0:AT+NOTIFY=0,0x000F,1    — Enable notification on 2B10
```

**Control commands** (characteristic handle `0x000E` for GATT Write):

| Action | Tuya DP | Payload |
|---|---|---|
| Turn ON (DP 05) | bool | `55AA00010006000501010001010F` |
| Turn OFF (DP 05) | bool | `55AA00020006000501010001000E` |
| Brightness 100% (DP 03) | value 1000 | `55AA0003...000003E8...` |
| Brightness 50% (DP 03) | value 500 | `55AA0004...000001F4...` |
| Color temp WARM (DP 04) | value 0 | `55AA0006...00000000...` |
| Color temp COOL (DP 04) | value 1000 | `55AA0007...000003E8...` |
| RGB mode (DP 02) | enum | `55AA00080006000502040001011B` |
| Red color (DP 05) HSV | string | `55AA0009...3030303036343634...` |

Also documented: the equivalent **ESP32 AT BLE** path using `AT+BLECONN`, `AT+BLEGATTCPRIMSRV`, and `AT+BLEGATTCWR` for comparison.

#### Native BLE Mesh Path (ESP32-S3)

The same light control operations mapped to ZCL-equivalent Mesh model opcodes, using `CFBN:0:CONTROL:` payloads with `model_id` and `opcode` fields.

### 5.3 Gateway Command Routing

The gateway firmware's `config_handler.c` was confirmed to correctly:
1. Strip the `CFBL:0:` prefix.
2. For `MODULE_HW_RESET` / `MODULE_WAKEUP`: execute GPIO-only sequences (no UART).
3. For all other commands: forward the bare AT string over UART to the module.

**Testing status:** Commands and their byte payloads are documented and verified against the Tuya DP specification. Code for command routing is tested as part of the Module Base Setting integration. Full end-to-end hardware test (LED physically responding) has not been performed yet.

---

## 6. Feature 5 — New Hardware Board Adaptation (In Progress)

### 6.1 What Changed in the New Board

The new board revision makes significant hardware changes that require firmware updates across both MCUs:

| Area | Old Board | New Board | Status |
|---|---|---|---|
| IO Expander | TCA6424A (24-pin) on main PCB | TCA6416A (16-pin) **on each adapter board** | Needs rewrite |
| IO Expander I2C address | Fixed `0x22` | `0x20` or `0x21` per adapter | Needs update |
| Stack ID detection | Pseudo / hardcoded | Read from P00–P03 (4-bit) on TCA6416A | Needs implement |
| WAN stack GPIO count | 13 | 16 (full P00–P17) | Needs update |
| LAN stack GPIO count | 11 per stack | 16 per adapter | Needs rewrite |
| LTE WAKE# pin | TCA pin 11 | TCA P05 | Needs update |
| LTE PERST# pin | TCA pin 12 | TCA P06 | Needs update |
| LAN2 UART TX | GPIO15 | GPIO8 | Needs update |
| LAN2 UART RX | GPIO16 | GPIO21 | Needs update |
| LAN SPI3 pins | Various | CS0=38, CS1=39, CLK=41, MISO=42, MOSI=40 | Needs update |
| LAN1 IO expander INT | GPIO21 (shared) | GPIO47 | Needs update |
| LAN2 IO expander INT | GPIO21 (shared) | GPIO48 | Needs update |
| USB switch control | N/A | GPIO46 | New GPIO needed |

### 6.2 Completed Tasks

| Task | Status |
|---|---|
| Task 1 — MCU WAN↔LAN SPI pins (CS=10, CLK=12, IO0=11, IO1=13) | ✅ Done |
| Task 2 — INT, RESET, DATA_READY pin verification | ✅ Done |
| Task 3 — MCU LAN↔WAN UART pins (TX=42, RX=41 WAN; TX=43, RX=44 LAN) | ✅ Done |

### 6.3 Pending Tasks

**DA2_esp (WAN MCU):**

- **Task 4** — Power & Charger Module Control (`pwr_source_handler.c`): Power rails were on TCA6424A Port 1, now need to be remapped to TCA6416A or direct GPIO. Not started.
- **Task 5** — WAN Stack Handler rewrite: Replace TCA6424A with TCA6416A, update GPIO enum from 13 to 16 pins, implement 4-bit stack ID detection from P00–P03. Not started.
- **Task 6** — LTE control pin remapping: `pwr_pin` default 11→5, `rst_pin` default 12→6; update `parse_tca_pin_label()` in `config_handler.c`. Not started.
- **Task 14** — Power source handler update (linked to Task 4). Not started.

**DA2_esp_LAN (LAN MCU):**

- **Task 7** — LAN adapter connector pin update: LAN2 UART (GPIO15/16 → GPIO8/21), SPI3 all pins. Not started.
- **Task 8** — LAN Stack Handler complete rewrite: Multi-instance TCA6416A (one per adapter), slot detection via P17, 4-bit ID read from P00–P03, separate INT pins per adapter (GPIO47/GPIO48). Not started.
- **Task 9** — Module SPI pin update (CS0=38, CS1=39, CLK=41, MISO=42, MOSI=40). Not started.
- **Task 10** — LAN2 Module UART pin update (GPIO8/21). Not started.
- **Task 11** — USB switch control pin (GPIO46). Not started.
- **Task 12** — SD Card / SDIO pin check. Not started.
- **Task 13** — TCA6416A register map update (different registers than TCA6424A), new I2C addresses. Not started.

### 6.4 Key Architecture Change: Multi-Instance Stack Handler

The most significant firmware change required is the **LAN Stack Handler rewrite** (Task 8). The current design uses a single TCA6424A (singleton). The new design requires two independent TCA6416A instances, one per adapter slot, with the following init logic:

```c
// New init flow (LAN MCU)
stack_handler_init():
    Scan I2C for TCA6416A at 0x20 and 0x21
    For each found TCA:
        Read P17 (IOX_SLOTDET):  0 → Slot 1,  1 → Slot 2
        Read P00–P03:  4-bit Stack ID
        Register TCA handle to correct slot
    Report: stack_1_id, stack_2_id (real hardware values)
```

GPIO mapping becomes trivially uniform (same for both adapters):
```
Pin 0–7  → TCA_PORT_0, bit 0–7
Pin 8–15 → TCA_PORT_1, bit 0–7
```

---

## 7. What Changed From the Previous Version

### 7.1 Architecture Before (v_old)

| Component | Old Behavior |
|---|---|
| Module type | Hardcoded in firmware (`#ifdef BLE_MODULE`) |
| Module driver init | Fixed UART config at compile time |
| BLE control from server | NOT supported — gateway had no AT command forwarding |
| PC App advanced tabs | Not present — basic config only (WiFi/LTE/MQTT) |
| Web portal | Not present |
| BLE Mesh | Not supported |
| Stack ID | Hardcoded or not used |

### 7.2 Architecture After (v_current)

| Component | New Behavior |
|---|---|
| Module type | Detected at runtime from hardware (I2C GPIO expander) |
| Module driver init | From JSON config (bus type, baudrate, parity all configurable) |
| BLE/LoRa/Zigbee control | Full AT command forwarding with JSON-driven GPIO/delay/timeout |
| PC App | Advanced tabs for BLE, LoRa, Zigbee with JSON Config Builder |
| Web portal | Embedded SPA, works in AP captive portal and STA mode |
| BLE Mesh | ESP32-S3 native provisioner (CFBN: protocol) — code written |
| Stack ID | Read from hardware (P00–P03 on TCA, 4-bit address) |

### 7.3 Key Upgrade: Command Routing Architecture

**Old approach:** PC App sends raw AT commands (`AT+RESET`, `AT+SCAN`...) directly over UART, handler has a long chain of `if/else` per command string.

**New approach:**
1. PC App sends JSON config once (`CFBL:JSON:<json>`) — gateway saves to NVS.
2. For each subsequent command from server/MQTT (`CFBL:0:AT+SCAN=5000`), the firmware:
   - Looks up the matching function in the saved JSON (by prefix matching `is_prefix=true` functions).
   - Applies that function's GPIO pre/post controls, `delay_start`, `timeout`, `delay_end`.
   - Sends the bare AT string to the module.
3. Non-prefix functions (`MODULE_HW_RESET`) are identified by exact name and execute GPIO-only sequences.

This design makes the gateway **polymorphic** — the same firmware logic handles BLE modules with completely different AT dialects (STM32WB55, JDY-23, ESP32 AT) without any code changes.

---

## 8. Known Issues & Risks

| Severity | Issue | Location | Note |
|---|---|---|---|
| ⚠️ Medium | Shared `last_isr_tick` for two GPIO ISRs | `DA2_esp/main/DA2_esp.c` | Race: simultaneous button presses lose second event |
| ⚠️ Medium | `PPP_GLOBAL_DNS` is commented out | `DA2_esp_LAN/main/DA2_esp_LAN.c` | Will cause compile error if `lan_ppp_connect()` called |
| ⚠️ Medium | `CONFIG_CMD_MAX_LEN 8192` struct on FreeRTOS stack | `config_handler.c` | Stack overflow risk if task stack < 8KB; should use heap |
| ⚠️ Medium | Missing mutex on `g_internet_type` | WAN MCU app | Read from main task, written from config task — race condition |
| ℹ️ Low | `wan_comm.h` comment says "4KB DMA limit" but value is 8192 | `BSP/MCU_WAN_Communication/` | Documentation inconsistency |
| ℹ️ Low | `HANDLER_STATUS_ERROR = 0xFF` could be confused with uninitialized | handler files | Use explicit numeric value instead |
| ℹ️ Low | MQTT device token / WiFi password in NVS plaintext | WAN MCU NVS | Acceptable for prototype; enable NVS encryption for production |
| ℹ️ Info | BLE Mesh (Feature 3) not yet hardware-tested | `DA2_esp_LAN` | BLE Mesh stack may need tuning once tested on device |
| ℹ️ Info | New board hardware tasks 4–14 not started | Both MCUs | Firmware will not boot correctly on new board until these tasks complete |

---

## 9. Summary Statistics

| Metric | Value |
|---|---|
| MCUs in system | 3 (ESP32-S3 WAN + ESP32-S3 LAN + STM32WB55) |
| Internet connectivity | WiFi / LTE 4G (Quectel A7600, SIMCom SIM7600) |
| Server protocols | MQTT (ThingsBoard) / HTTP-HTTPS REST / CoAP |
| RF module types supported | BLE / LoRa / Zigbee / RS485 |
| Physical stack slots (LAN) | 2 |
| JSON parsers written | 5 (common + BLE + LoRa + Zigbee + RS485) |
| SPI clock LAN↔WAN | 40 MHz + DMA |
| SD card RAM buffer | 100 KB |
| OTA partition size | 7 MB × 2 (dual bank) |
| Config buffer max | 8 KB |
| BLE AT functions defined | 15 core + 5 optional = 20 |
| New board change tasks | 14 total (3 done, 11 remaining) |
| Web API endpoints | 4 (`/api/config` GET/POST, `/api/status`, `/api/reboot`) |
| PC App config files | 6 pre-built JSON templates + `stack_id_map.json` |
| BLE Mesh models registered | 5 (Config Server/Client, OnOff, Lightness, CTL clients) |

---

*Report compiled by reviewing all source files, documentation, and TODO/design files in the DA2 workspace. March 2026.*
