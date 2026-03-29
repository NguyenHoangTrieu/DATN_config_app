# BLE Command Reference

This document lists **all BLE commands** supported by the DA2 gateway firmware (`DA2_esp_LAN`).

Three independent BLE paths are supported, each with its own command prefix:

| Prefix  | Path                            | Handler ID | Description                            |
|---------|----------------------------------|------------|----------------------------------------|
| `CFBL:` | BLE AT Module                   | `0x05`     | STM32WB55 or custom BLE module via UART |
| `CFBG:` | BLE GATT Central (Native)       | `0x07`     | ESP32-S3 native Bluedroid GATT Central  |
| `CFBN:` | BLE Mesh Provisioner (Native)   | `0x06`     | ESP32-S3 native BLE Mesh Provisioner    |

---

## Table of Contents

1. [CFBL: — BLE AT Module](#cfbl--ble-at-module)  
2. [CFBG: — BLE GATT Central (Native)](#cfbg--ble-gatt-central-native)  
3. [CFBN: — BLE Mesh Provisioner (Native)](#cfbn--ble-mesh-provisioner-native)  
4. [Response Format](#response-format)  
5. [Startup Sequence Examples](#startup-sequence-examples)  
6. [sdkconfig Requirements](#sdkconfig-requirements)

---

## CFBL: — BLE AT Module

Commands forwarded to an external BLE module over UART using a pre-configured AT command table.  
All configuration is stored in JSON and sent once during gateway startup or via the app.

### Configuration

```
CFBL:JSON:<slot>:<json>
```

Loads the AT module configuration for the given stack slot.

**JSON schema:**
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
      "function_name": "MODULE_SW_RESET",
      "command": "ATZ\r\n",
      "is_prefix": false,
      "gpio_start_control": [],
      "delay_start": 0,
      "expect_response": "OK",
      "timeout": 1000,
      "gpio_end_control": [],
      "delay_end": 0
    }
  ]
}
```

### Command Execution

```
CFBL:<slot>:<function_name>[:<params>]
```

Looks up `function_name` in the stored function table and sends the AT command to the BLE module.

**Common function names (mirrors STM32WB55 BLE README):**

| Function Name                    | Typical AT Command                   | Description                          |
|----------------------------------|--------------------------------------|--------------------------------------|
| `MODULE_HW_RESET`                | GPIO toggle                          | Hardware reset via GPIO              |
| `MODULE_SW_RESET`                | `ATZ\r\n`                            | Software reset                       |
| `MODULE_FACTORY_RESET`           | `AT+FACTORYRESET\r\n`                | Restore factory defaults             |
| `MODULE_ENTER_CMD_MODE`          | `+++`                                | Exit data mode → command mode        |
| `MODULE_ENTER_SLEEP`             | `AT+SLEEP\r\n`                       | Enter low-power sleep                |
| `MODULE_WAKEUP`                  | GPIO pulse                           | Wake from sleep                      |
| `MODULE_START_BROADCAST`         | `AT+ADVSTART\r\n`                    | Start advertising                    |
| `MODULE_GET_INFO`                | `AT+BLEINF\r\n`                      | Read firmware/hardware info          |
| `MODULE_GET_CONNECTION_STATUS`   | `AT+BLECONSTAT\r\n`                  | Read active connection status        |
| `MODULE_GET_DIAGNOSTICS`         | `AT+DIAG\r\n`                        | Read diagnostic counters             |
| `MODULE_SET_NAME`                | `AT+SETNAME=<name>\r\n`              | Set BLE device name (prefix command) |
| `MODULE_SET_COMM_CONFIG`         | `AT+UART=115200,0,1\r\n`             | Set UART params on module side       |
| `MODULE_SET_RF_PARAMS`           | `AT+RFPWR=4\r\n`                     | Set TX power / RF params             |
| `MODULE_START_DISCOVERY`         | `AT+SCAN\r\n`                        | Start BLE scan                       |
| `MODULE_DISCOVER_SERVICES`       | `AT+DISC_SERV\r\n`                   | Discover services on connected peer  |
| `MODULE_DISCOVER_CHARACTERISTICS`| `AT+DISC_CHAR\r\n`                   | Discover characteristics             |
| `MODULE_CONNECT`                 | `AT+CONNECT=<MAC>\r\n`               | Initiate connection (prefix command) |
| `MODULE_DISCONNECT`              | `AT+DISC\r\n`                        | Disconnect current connection        |
| `MODULE_ENTER_DATA_MODE`         | `AT+BLECFG\r\n`                      | Switch to transparent data mode      |
| `MODULE_SEND_DATA`               | raw bytes (in data mode)             | Send data to connected device        |

---

## CFBG: — BLE GATT Central (Native)

Native ESP32-S3 BLE GATT Central using Bluedroid (`esp_gattc` / `esp_gap_ble`).  
Supports scan, connect, service/characteristic discovery, read, write, notify/indicate.  
Up to **8 simultaneous connected-device slots** (internal table index `<idx>`; not in the command prefix).

> **Note:** CFBG: is native to the LAN MCU — there is only one instance, so **no slot number** is used in commands or responses.

### Configuration

```
CFBG:JSON:<json>
```

**JSON schema:**
```json
{
  "ble_gatt": {
    "scan": {
      "interval": 160,
      "window":   80,
      "active":   true
    },
    "connection": {
      "interval_min":        16,
      "interval_max":        32,
      "latency":              0,
      "supervision_timeout": 500
    }
  }
}
```

> Units: scan interval/window in BLE units (×0.625 ms); connection interval in BLE units (×1.25 ms); supervision timeout in ×10 ms.  
> Defaults: scan interval=100 ms, window=50 ms; connection interval 20–40 ms, supervision 5 s.

**Response:** `CFBG:OK:CONFIG_LOADED` or `CFBG:FAIL:INVALID_JSON`

---

### Scan Commands

#### Start Scan
```
CFBG:SCAN:<duration_ms>
```
Starts a BLE scan for the specified duration in milliseconds. Active or passive mode depends on the loaded config.

**Responses (async, one per device found):**
```
CFBG:OK:SCAN_STARTED:<duration_ms>
CFBG:OK:SCAN_RESULT:<idx>,<AA:BB:CC:DD:EE:FF>,<RSSI>,<device_name>
CFBG:OK:SCAN_DONE
```

#### Stop Scan
```
CFBG:STOP
```
**Response:** `CFBG:OK:SCAN_STOPPED`

---

### Device Table Commands

#### List Devices
```
CFBG:LIST
```
Lists all devices in the 8-slot table (from scan results and connections).

**Response:**
```
CFBG:OK:LIST:<count>
CFBG:OK:DEV:<idx>,<AA:BB:CC:DD:EE:FF>,<RSSI>,0x<conn_id>,<name>
```
`conn_id = 0xFFFF` means not connected.

#### Clear Device Table
```
CFBG:CLEAR
```
Frees all slots that are not currently connected.

**Response:** `CFBG:OK:CLEARED`

#### Get Device Info
```
CFBG:INFO:<idx>
```
**Response:**
```
CFBG:OK:INFO:<idx>:<AA:BB:CC:DD:EE:FF>:RSSI=<n>:CONN=0x<conn_id>:NAME=<name>
```

---

### Connection Commands

#### Connect
```
CFBG:CONNECT:<AA:BB:CC:DD:EE:FF>
```
Opens a GATT connection to the specified device. The device must be in the scan table or will be assigned a new slot.

**Responses (async):**
```
CFBG:OK:CONNECTING:<idx>:<AA:BB:CC:DD:EE:FF>
CFBG:OK:CONNECTED:<idx>:0x<conn_id>:<AA:BB:CC:DD:EE:FF>
```
On failure: `CFBG:FAIL:CONNECT_FAILED:<idx>:<reason>`

#### Disconnect
```
CFBG:DISCONNECT:<idx>
```
**Responses (async):**
```
CFBG:OK:DISCONNECTING:<idx>
CFBG:OK:DISCONNECTED:<idx>:0x<conn_id>
```

---

### Discovery Commands

#### Discover Services and Characteristics
```
CFBG:DISC:<idx>
```
Discovers all services and characteristics on the connected device at table index `<idx>`.

**Responses (async):**
```
CFBG:OK:DISC_STARTED:<idx>
CFBG:OK:SERVICE:<idx>:0x<UUID>:0x<start_handle>:0x<end_handle>
CFBG:OK:CHAR:<idx>:0x<UUID>:0x<handle>:0x<properties>
CFBG:OK:DISC_DONE:<idx>:<n>_CHARS
```

**Properties bitmask** (standard BLE):
| Bit | Meaning      |
|-----|--------------|
| 0x01| BROADCAST    |
| 0x02| READ         |
| 0x04| WRITE_NO_RSP |
| 0x08| WRITE        |
| 0x10| NOTIFY       |
| 0x20| INDICATE     |
| 0x40| AUTH_WRITE   |
| 0x80| EXT_PROP     |

---

### Data Commands

#### Read Characteristic
```
CFBG:READ:<idx>:<handle>
```
`<handle>` is the characteristic handle from discovery (hex: `0xXXXX` or decimal).

**Responses (async):**
```
CFBG:OK:READ_STARTED:<idx>:0x<handle>
CFBG:OK:READ:<idx>:0x<handle>:<hex_data>
```

#### Write Characteristic (with response)
```
CFBG:WRITE:<idx>:<handle>:<hex_data>
```
Writes with ATT Write Request (waits for ATT Write Response).

**Response (async):**
```
CFBG:OK:WRITE_OK:<idx>:0x<handle>
```

#### Write Characteristic (no response)
```
CFBG:WRITENR:<idx>:<handle>:<hex_data>
```
Writes with ATT Write Command (fire-and-forget).

**Response (immediate):**
```
CFBG:OK:WRITE_NR_OK:<idx>:0x<handle>
```

#### Enable / Disable Notifications
```
CFBG:NOTIFY:<idx>:<cccd_handle>:1
CFBG:NOTIFY:<idx>:<cccd_handle>:0
```
Writes `0x0001` / `0x0000` to the CCCD descriptor. `<cccd_handle>` is the CCCD descriptor handle (usually `<char_handle> + 1`).

**Response (async):**
```
CFBG:OK:DESCR_WRITE_OK:<idx>:0x<cccd_handle>
```

Notification data arrives asynchronously:
```
CFBG:OK:NOTIFY:<idx>:0x<char_handle>:<hex_data>
```

#### Enable / Disable Indications
```
CFBG:INDICATE:<idx>:<cccd_handle>:1
CFBG:INDICATE:<idx>:<cccd_handle>:0
```
Writes `0x0002` / `0x0000` to the CCCD descriptor.

**Response (async):**
```
CFBG:OK:DESCR_WRITE_OK:<idx>:0x<cccd_handle>
```

Indication data arrives asynchronously:
```
CFBG:OK:INDICATE:<idx>:0x<char_handle>:<hex_data>
```

---

## CFBN: — BLE Mesh Provisioner (Native)

Native ESP32-S3 BLE Mesh Provisioner using `esp_ble_mesh` stack.  
Supports provisioning unprovisioned devices, sending model control messages (Generic OnOff, Light Lightness, Light CTL, Scene, vendor), and full node configuration.

> **Note:** CFBN: is native to the LAN MCU — there is only one provisioner instance, so **no slot number** is used in commands or responses.

### Configuration

```
CFBN:JSON:<json>
```

**JSON schema:**
```json
{
  "ble_native": {
    "mesh": {
      "provisioner_name":    "DA2_GW",
      "net_key":             "A1B2C3D4E5F6A7B8C9DAEBFCAD1E2F30",
      "app_key":             "0102030405060708090A0B0C0D0E0F10",
      "primary_unicast_addr": 1,
      "ttl":                 7
    },
    "commands": [
      { "name": "ONOFF",     "opcode": "0x8202", "model_id": "0x1000",
        "ack_model_id": "0x1000", "ack_opcode": "0x8201", "param_schema": "value:uint8" },
      { "name": "LIGHTNESS", "opcode": "0x824C", "model_id": "0x1300",
        "ack_model_id": "0x1300", "ack_opcode": "0x824E", "param_schema": "lightness:uint16" },
      { "name": "CTL",       "opcode": "0x8265", "model_id": "0x1303",
        "ack_model_id": "0x1303", "ack_opcode": "0x8260",
        "param_schema": "lightness:uint16,temperature:uint16,delta_uv:int16" }
    ]
  }
}
```

**Response:** `CFBN:OK:CONFIG_LOADED` or `CFBN:FAIL:INVALID_JSON`

---

### Provisioning Commands

#### Scan for Unprovisioned Devices
```
CFBN:SCAN:<duration_ms>
```
**Responses (async):**
```
CFBN:OK:SCAN_STARTED
CFBN:OK:UNPROV_DEV:<uuid_32hex>:<AA:BB:CC:DD:EE:FF>:<oob_info>
CFBN:OK:SCAN_DONE
```

#### Provision a Device
```
CFBN:PROVISION:<uuid_32hex>
```
Provisions the unprovisioned device with the given UUID (32 hex characters, no separators).

**Responses (async):**
```
CFBN:OK:PROVISION_IN_PROGRESS:0x<unicast_addr>
CFBN:OK:PROVISIONED:0x<unicast_addr>:<uuid_32hex>
```
On failure: `CFBN:FAIL:PROVISION_FAILED:<uuid_32hex>:<reason>`

#### List Provisioned Nodes
```
CFBN:NODE_LIST
```
Returns a list of all provisioned nodes tracked by this provisioner.

**Response:** `CFBN:OK:NODE_LIST:SEE_HANDLER` + per-node details from provisioner DB.

---

### Control Commands

#### Send Control Message
```
CFBN:CONTROL:<json>
```
Looks up the command name in the loaded command table, then sends the corresponding mesh model message.

**JSON body:**
```json
{
  "cmd":   "ONOFF",
  "addr":  "0xC000",
  "params": {
    "value": 1,
    "tid": 0,
    "trans_time": 0,
    "delay": 0
  }
}
```
Send to a group address (e.g., `0xC000`) or unicast address (e.g., `0x0002`).

**Responses:**
```
CFBN:OK:CONTROL:SENT:<cmd_name>:0x<addr>
CFBN:OK:ONOFF_ACK:0x<addr>:OK          (async, if acknowledged)
```

#### Get Node Status
```
CFBN:GET_STATUS:<json>
```
Sends a GET state request to a node.

**JSON body:**
```json
{ "cmd": "ONOFF", "addr": "0x0002" }
```

**Responses:**
```
CFBN:OK:GET_STATUS:SENT:<cmd_name>:0x<addr>
CFBN:OK:ONOFF_STATUS:0x<addr>:<value>      (async)
```

---

### Node Configuration Commands

#### Add App Key to Node Model
```
CFBN:APP_KEY_ADD:<json>
```
**JSON body:**
```json
{ "addr": "0x0002", "net_idx": 0, "app_idx": 0 }
```
**Response:** `CFBN:OK:APP_KEY_ADD:SENT:0x<addr>:app_idx=<n>`

#### Subscribe Node Model to Group (Add)
```
CFBN:GROUP_ADD:<json>
```
**JSON body:**
```json
{
  "addr":       "0x0002",
  "elem_addr":  "0x0002",
  "model_id":   "0x1000",
  "group_addr": "0xC000"
}
```
**Response:** `CFBN:OK:GROUP_ADD:SENT:0x<addr>:model=0x<model_id>:group=0x<group_addr>`

#### Unsubscribe Node Model from Group (Delete)
```
CFBN:GROUP_DEL:<json>
```
Same JSON body as `GROUP_ADD`.  
**Response:** `CFBN:OK:GROUP_DEL:SENT:0x<addr>:model=0x<model_id>:group=0x<group_addr>`

#### Configure Node Parameters
```
CFBN:NODE_CONFIG:<json>
```
**JSON body:**
```json
{
  "addr":   "0x0002",
  "ttl":    7,
  "relay":  0,
  "proxy":  1,
  "friend": 0
}
```
All fields except `addr` are optional. Each present field generates a separate Config Client SET message.  
**Response:** `CFBN:OK:NODE_CONFIG:SENT:0x<addr>`

#### Configure Model Publication
```
CFBN:SET_PUB:<json>
```
**JSON body:**
```json
{
  "addr":       "0x0002",
  "elem_addr":  "0x0002",
  "model_id":   "0x1000",
  "pub_addr":   "0xC000",
  "app_idx":    0,
  "ttl":        7,
  "period":     0,
  "retransmit": 0
}
```
**Response:** `CFBN:OK:SET_PUB:SENT:0x<addr>:pub=0x<pub_addr>`

#### Configure Model Subscription
```
CFBN:SET_SUB:<json>
```
**JSON body:**
```json
{
  "addr":       "0x0002",
  "elem_addr":  "0x0002",
  "model_id":   "0x1000",
  "sub_addr":   "0xC000",
  "add":        true
}
```
`"add": true` → `GROUP_ADD`, `"add": false` → `GROUP_DEL`.  
**Response:** same as GROUP_ADD / GROUP_DEL.

#### Reset Node (Factory Reset)
```
CFBN:NODE_RESET:<unicast_addr_hex>
```
Example: `CFBN:NODE_RESET:0x0002`  
Sends Config Node Reset to the node and removes it from the provisioner database.  
**Response:** `CFBN:OK:NODE_RESET:SENT:0x<addr>`

---

### Scene Commands

#### Store Scene
```
CFBN:SCENE_STORE:<json>
```
**JSON body:**
```json
{ "addr": "0x0002", "scene_num": 1 }
```
**Response:** `CFBN:OK:SCENE_STORE:SENT:0x<addr>:scene=<n>`

#### Recall Scene
```
CFBN:SCENE_RECALL:<json>
```
**JSON body:**
```json
{
  "addr":      "0x0002",
  "scene_num": 1,
  "trans_time": 0,
  "delay":      0
}
```
**Response:** `CFBN:OK:SCENE_RECALL:SENT:0x<addr>:scene=<n>`

---

### Advanced Commands

#### Vendor Model Command
```
CFBN:VENDOR_CMD:<json>
```
Sends a raw vendor model command using ESP_BLE_MESH_MODEL_OP_3().

**JSON body:**
```json
{
  "addr":       "0x0002",
  "company_id": "0x0059",
  "opcode":     "0x01",
  "data":       "AABBCC"
}
```
`data` is hex-encoded payload bytes.  
**Response:** `CFBN:OK:VENDOR_CMD:SENT:0x<addr>:cid=0x<cid>:op=0x<op>`

#### Heartbeat Subscription
```
CFBN:HEARTBEAT_SUB:<json>
```
Configures the provisioner to subscribe to heartbeats from a node.

**JSON body:**
```json
{
  "src":    "0x0002",
  "dst":    "0x0001",
  "period": 60
}
```
`period` in seconds (0 = disable).  
**Response:** `CFBN:OK:HEARTBEAT_SUB:SENT:src=0x<s>:dst=0x<d>:period=<p>`

---

## Response Format

All responses from BLE handlers are forwarded to the WAN MCU in the standard frame format.

**CFBL: (AT Module)** — includes a slot number (there can be multiple physical modules):
```
CFBL:<slot>:<OK|FAIL>:<payload>
```

**CFBG: (GATT Central) and CFBN: (BLE Mesh)** — no slot (single native radio):
```
CFBG:<OK|FAIL>:<payload>
CFBN:<OK|FAIL>:<payload>
```

- Synchronous responses are sent immediately.
- Asynchronous responses (connection events, notifications, mesh ACKs) arrive later.
- `FAIL` responses include a short reason string.

**Handler IDs in MCU frame:**

| Handler ID | Value  | Description         |
|------------|--------|---------------------|
| BLE AT     | `0x05` | CFBL: responses     |
| BLE Mesh   | `0x06` | CFBN: responses     |
| BLE GATT   | `0x07` | CFBG: responses     |

---

## Startup Sequence Examples

### GATT Central — Scan and Connect

```
# 1. Load config (scan 100ms interval, 50ms window, active)
CFBG:JSON:{"ble_gatt":{"scan":{"interval":160,"window":80,"active":true},"connection":{"interval_min":16,"interval_max":32,"latency":0,"supervision_timeout":500}}}

# 2. Scan for 5 seconds
CFBG:SCAN:5000
  → CFBG:OK:SCAN_STARTED:5000
  → CFBG:OK:SCAN_RESULT:0,AA:BB:CC:DD:EE:FF,-62,DA2_TEST_GATT
  → CFBG:OK:SCAN_DONE

# 3. Connect to device at index 0
CFBG:CONNECT:AA:BB:CC:DD:EE:FF
  → CFBG:OK:CONNECTING:0:AA:BB:CC:DD:EE:FF
  → CFBG:OK:CONNECTED:0:0x0001:AA:BB:CC:DD:EE:FF

# 4. Discover services and characteristics
CFBG:DISC:0
  → CFBG:OK:SERVICE:0:0x1800:0x0001:0x0007
  → CFBG:OK:SERVICE:0:0xFFF0:0x0008:0x000F
  → CFBG:OK:CHAR:0:0xFFF1:0x000A:0x12      (READ|NOTIFY)
  → CFBG:OK:DISC_DONE:0:3_CHARS

# 5. Enable notifications on characteristic handle 0x000A (CCCD at 0x000B)
CFBG:NOTIFY:0:0x000B:1
  → CFBG:OK:DESCR_WRITE_OK:0:0x000B
  → CFBG:OK:NOTIFY:0:0x000A:DEADBEEF   (async data)

# 6. Write to characteristic
CFBG:WRITE:0:0x000A:0102
  → CFBG:OK:WRITE_OK:0:0x000A

# 7. Disconnect
CFBG:DISCONNECT:0
  → CFBG:OK:DISCONNECTED:0:0x0001
```

### BLE Mesh — Provision and Control

```
# 1. Load mesh config with net/app keys and command table
CFBN:JSON:{"ble_native":{"mesh":{"provisioner_name":"DA2_GW","net_key":"A1B2C3D4E5F6A7B8C9DAEBFCAD1E2F30","app_key":"0102030405060708090A0B0C0D0E0F10","primary_unicast_addr":1,"ttl":7},"commands":[{"name":"ONOFF","opcode":"0x8202","model_id":"0x1000","ack_model_id":"0x1000","ack_opcode":"0x8201","param_schema":"value:uint8"},{"name":"LIGHTNESS","opcode":"0x824C","model_id":"0x1300","ack_model_id":"0x1300","ack_opcode":"0x824E","param_schema":"lightness:uint16"}]}}

# 2. Scan for unprovisioned devices
CFBN:SCAN:10000
  → CFBN:OK:SCAN_STARTED
  → CFBN:OK:UNPROV_DEV:DA2C60010000000000000000000000001:AA:BB:CC:DD:EE:FF:0000
  → CFBN:OK:SCAN_DONE

# 3. Provision the device
CFBN:PROVISION:DA2C60010000000000000000000000001
  → CFBN:OK:PROVISION_IN_PROGRESS:0x0002
  → CFBN:OK:PROVISIONED:0x0002:DA2C60010000000000000000000000001

# 4. Add app key
CFBN:APP_KEY_ADD:{"addr":"0x0002","net_idx":0,"app_idx":0}
  → CFBN:OK:APP_KEY_ADD:SENT:0x0002:app_idx=0

# 5. Bind OnOff model to group
CFBN:GROUP_ADD:{"addr":"0x0002","elem_addr":"0x0002","model_id":"0x1000","group_addr":"0xC000"}
  → CFBN:OK:GROUP_ADD:SENT:0x0002:model=0x1000:group=0xc000

# 6. Turn on — send to group
CFBN:CONTROL:{"cmd":"ONOFF","addr":"0xC000","params":{"value":1,"tid":1}}
  → CFBN:OK:CONTROL:SENT:ONOFF:0xc000
  → CFBN:OK:ONOFF_ACK:0x0002:OK

# 7. Set lightness to 50%
CFBN:CONTROL:{"cmd":"LIGHTNESS","addr":"0x0002","params":{"lightness":32768,"tid":2}}
  → CFBN:OK:CONTROL:SENT:LIGHTNESS:0x0002

# 8. Store scene #1
CFBN:SCENE_STORE:{"addr":"0x0002","scene_num":1}
  → CFBN:OK:SCENE_STORE:SENT:0x0002:scene=1

# 9. Recall scene #1 later
CFBN:SCENE_RECALL:{"addr":"0x0002","scene_num":1,"trans_time":0,"delay":0}
  → CFBN:OK:SCENE_RECALL:SENT:0x0002:scene=1
```

---

## sdkconfig Requirements

The following ESP-IDF Kconfig symbols must be enabled to support all three BLE paths:

```ini
# BLE enable (common)
CONFIG_BT_ENABLED=y
CONFIG_BT_BLUEDROID_ENABLED=y

# BLE GATT Central (CFBG:)
CONFIG_BT_GATTC_ENABLE=y
CONFIG_BT_BLE_42_FEATURES_SUPPORTED=y

# BLE Mesh Provisioner (CFBN:)
CONFIG_BLE_MESH=y
CONFIG_BLE_MESH_PROVISIONER=y
CONFIG_BLE_MESH_CFG_CLI=y
CONFIG_BLE_MESH_GENERIC_ONOFF_CLI=y
CONFIG_BLE_MESH_LIGHT_LIGHTNESS_CLI=y
CONFIG_BLE_MESH_LIGHT_CTL_CLI=y
CONFIG_BLE_MESH_SCENE_CLI=y
CONFIG_BLE_MESH_VENDOR_MODELS=y

# Coexistence: BLE Mesh + GATT Central
# Both share the Bluedroid stack; BLE Mesh uses the ADV bearer
# while GATT Central uses ATT/L2CAP — they can coexist.
CONFIG_BLE_MESH_COEX_WITH_BLE=y
```

> **Init order matters**: `ble_native_handler_init()` (BLE Mesh) must be called first, as it initialises the Bluetooth controller and host. `ble_gatt_handler_init()` registers GAP/GATTC callbacks on the already-initialised stack.

---

*Generated for DA2_esp_LAN firmware — ESP-IDF v5.x, ESP32-S3*
