# Gateway Test Command Reference

All commands are sent via **UART** (115200 baud, 8N1) to the WAN MCU (ESP32-S3, GPIO 43/44).

**UART prefix convention:**
- All commands begin with `CF` (Config Frame).
- WAN MCU strips `CF`, recognises `ML` → routes to LAN MCU.
- LAN MCU strips `ML:` and dispatches the remaining frame to the relevant handler.

**Command structure:** `CFML:<handler_prefix>:<stack_id>:<verb>:<params>`

**Response:** The response is echoed back to UART with prefix `CFBL:` (BLE) or `CFZB:` (Zigbee) or `CFLR:` (LoRa).

---

## 1. BLE GATT Central (`CFBG:`)

### 1.1 Scan for BLE devices

```
Send:    CFML:CFBG:0:SCAN:5000
Expect:  CFBL:OK:CMD_QUEUED  (immediate)
         CFBL:0:OK:SCAN_RESULT:<idx> <MAC> <RSSI> <name>  (repeated per device)
         CFBL:0:OK:SCAN_DONE  (after 5000 ms)
```

### 1.2 Stop scan early

```
Send:    CFML:CFBG:0:STOP
```

### 1.3 List scan results

```
Send:    CFML:CFBG:0:LIST
Expect:  CFBL:0:OK:LIST:<idx> <MAC> <name> ...
```

### 1.4 Get device info (by scan index)

```
Send:    CFML:CFBG:0:INFO:0
Expect:  CFBL:0:OK:INFO:<MAC> <adv_data_hex>
```

### 1.5 Connect to a device

```
Send:    CFML:CFBG:0:CONNECT:<MAC>
Example: CFML:CFBG:0:CONNECT:AA:BB:CC:DD:EE:FF
Expect:  CFBL:0:OK:CONNECTED:<conn_idx>
         CFBL:0:FAIL:CONN_TIMEOUT  (on failure)
```

### 1.6 Discover services and characteristics

```
Send:    CFML:CFBG:0:DISC:<conn_idx>
Example: CFML:CFBG:0:DISC:0
Expect:  CFBL:0:OK:DISC:<handle_hex> <uuid> <props> ...  (repeated per characteristic)
         CFBL:0:OK:DISC_DONE
```

### 1.7 Read a characteristic

```
Send:    CFML:CFBG:0:READ:<conn_idx>:<handle_hex>
Example: CFML:CFBG:0:READ:0:002A
Expect:  CFBL:0:OK:READ:<handle_hex>:<data_hex>
```

### 1.8 Write a characteristic (with response)

```
Send:    CFML:CFBG:0:WRITE:<conn_idx>:<handle_hex>:<data_hex>
Example: CFML:CFBG:0:WRITE:0:002C:01FF
Expect:  CFBL:0:OK:WRITE:<handle_hex>
```

### 1.9 Write without response

```
Send:    CFML:CFBG:0:WRITENR:<conn_idx>:<handle_hex>:<data_hex>
Example: CFML:CFBG:0:WRITENR:0:002C:01FF
Expect:  CFBL:0:OK:WRITENR (immediate, no write response confirmation)
```

### 1.10 Enable notifications

```
Send:    CFML:CFBG:0:NOTIFY:<conn_idx>:<cccd_handle_hex>:1
Example: CFML:CFBG:0:NOTIFY:0:002E:1
Expect:  CFBL:0:OK:NOTIFY_ENABLED
         CFBL:0:NOTIF:<handle_hex>:<data_hex>  (whenever peripheral notifies)
```

### 1.11 Disable notifications

```
Send:    CFML:CFBG:0:NOTIFY:<conn_idx>:<cccd_handle_hex>:0
Expect:  CFBL:0:OK:NOTIFY_DISABLED
```

### 1.12 Enable indications

```
Send:    CFML:CFBG:0:INDICATE:<conn_idx>:<cccd_handle_hex>:1
```

### 1.13 Disconnect

```
Send:    CFML:CFBG:0:DISCONNECT:<conn_idx>
Expect:  CFBL:0:OK:DISCONNECTED:<conn_idx>
```

### 1.14 Clear scan list

```
Send:    CFML:CFBG:0:CLEAR
```

### Typical GATT test flow

```
1. CFML:CFBG:0:SCAN:5000       — scan 5 s
2. CFML:CFBG:0:LIST             — see found devices
3. CFML:CFBG:0:CONNECT:AA:BB:CC:DD:EE:FF
4. CFML:CFBG:0:DISC:0           — discover attributes
5. CFML:CFBG:0:NOTIFY:0:002E:1  — enable notifications
6. CFML:CFBG:0:WRITE:0:0029:0101— send command
7. CFML:CFBG:0:DISCONNECT:0
```

---

## 2. BLE Native Mesh (`CFBN:`) (NOT SUPPORTED DUE TO PROVISIONING TIMEOUT ISSUES)

### 2.1 Scan for unprovisioned devices

```
Send:    CFML:CFBN:0:SCAN:5000
Expect:  CFBN:0:OK:SCAN_STARTED
         CFBN:0:OK:SCAN_RESULT:<uuid_32hex> <RSSI>  (repeated)
```

### 2.2 Provision a device

```
Send:    CFML:CFBN:0:PROVISION:<uuid_32hex>
Example: CFML:CFBN:0:PROVISION:11223344556677889900AABBCCDDEEFF
Expect:  CFBN:0:OK:PROVISIONED:<unicast_addr_hex>
         CFBN:0:FAIL:PROVISION_TIMEOUT
```

### 2.3 List provisioned nodes

```
Send:    CFML:CFBN:0:NODE_LIST
Expect:  CFBN:0:OK:NODE_LIST:[{"addr":"0x0002","uuid":"11223344..."}]
```

### 2.4 Control — On/Off

```
Send:    CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":1}}
         CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":0}}
Expect:  CFBN:0:OK:ONOFF_STATUS:0x0002:<0|1>
```

### 2.5 Control — Lightness

```
Send:    CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"LIGHTNESS","params":{"lightness":32768}}
Expect:  CFBN:0:OK:LIGHTNESS_STATUS:0x0002:32768
```

### 2.6 Control — Color Temperature (CTL)

```
Send:    CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"CTL","params":{"lightness":65535,"temperature":4000}}
Expect:  CFBN:0:OK:CTL_STATUS:0x0002:65535:4000
```

### 2.7 Get model status

```
Send:    CFML:CFBN:0:GET_STATUS:{"addr":"0x0002","model":"ONOFF"}
Expect:  CFBN:0:OK:ONOFF_STATUS:0x0002:<value>
```

### 2.8 Add app key to node

```
Send:    CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0002","net_idx":0,"app_idx":0}
Expect:  CFBN:0:OK:APP_KEY_ADDED:0x0002
```

### 2.9 Reset a node

```
Send:    CFML:CFBN:0:NODE_RESET:<unicast_addr_hex>
Example: CFML:CFBN:0:NODE_RESET:0x0002
Expect:  CFBN:0:OK:NODE_RESET:0x0002
```

### Typical Mesh test flow

```
1. CFML:CFBN:0:SCAN:5000                         — scan for unprovisioned
2. CFML:CFBN:0:PROVISION:11223344...             — provision device
3. CFML:CFBN:0:NODE_LIST                         — verify node is listed
4. CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0002",...} — bind app key
5. CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":1}}
6. CFML:CFBN:0:GET_STATUS:{"addr":"0x0002","model":"ONOFF"}
```

---

## 3. Zigbee via E180-ZG120B (`CFZB:`)

> Module: **Ebyte E180-ZG120B** (Zigbee 3.0 Coordinator), UART **115200** baud.
> Format: `CFML:CFZB:<stack_id>:<AT_COMMAND>` — the AT command is forwarded verbatim to the module.
> The JSON config (`stack_001_config.json`) is matched by command prefix to supply GPIO, timeout, and expected response metadata.
> Response: `CFZB:<stack_id>:OK:<response>` or `CFZB:<stack_id>:FAIL:<reason>`.

### 3.1 Get module info

```
Send:    CFML:CFZB:0:AT+INFO?
Expect:  CFZB:0:OK:TYPE=...
```

### 3.2 Software reset

```
Send:    CFML:CFZB:0:AT+RESET
Expect:  CFZB:0:OK:OK
         (module restarts — wait ~1 s)
```

### 3.3 Factory reset

```
Send:    CFML:CFZB:0:AT+RESTORE
Expect:  CFZB:0:OK:+RESTORE:0
         (module power-cycles — wait ~2 s)
```

### 3.4 Create (start) Zigbee network (coordinator role)

```
Send:    CFML:CFZB:0:AT+CREATENW
Expect:  CFZB:0:OK:+CREATENW:0
```

### 3.5 Stop network

```
Send:    CFML:CFZB:0:AT+QUITNW
Expect:  CFZB:0:OK:+QUITNW:0
```

### 3.6 Get network info

```
Send:    CFML:CFZB:0:AT+NWINFO
Expect:  CFZB:0:OK:+NWINFO:<channel>,<PANID>,<short_addr>,...
```

### 3.7 Set channel

```
Send:    CFML:CFZB:0:AT+CH=<channel>
Example: CFML:CFZB:0:AT+CH=15
Expect:  CFZB:0:OK:+CH:0
Notes:   Valid range 11–26
```

### 3.8 Set PAN ID

```
Send:    CFML:CFZB:0:AT+PANID=<panid_hex>
Example: CFML:CFZB:0:AT+PANID=1301
Expect:  CFZB:0:OK:+PANID:0
Notes:   4 hex characters, big-endian
```

### 3.9 Set TX power

```
Send:    CFML:CFZB:0:AT+POWER=<dbm>
Example: CFML:CFZB:0:AT+POWER=20
Expect:  CFZB:0:OK:+POWER:0
Notes:   Range 0–20 dBm
```

### 3.10 Open network for joining (permit join)

```
Send:    CFML:CFZB:0:AT+OPENWNET=<duration_s>
Example: CFML:CFZB:0:AT+OPENWNET=60
Expect:  CFZB:0:OK:+OPENWNET:0
         CFZB:0:EVT:JOIN:<short_addr>    (when a device joins)
Notes:   duration_s=0 closes the network immediately
```

### 3.11 Query device short address by IEEE address

```
Send:    CFML:CFZB:0:AT+QUERYSHORT=<ieee_hex>
Example: CFML:CFZB:0:AT+QUERYSHORT=AABBCCDDEEFF0011
Expect:  CFZB:0:OK:+QUERYSHORT:<short_addr>
```

### 3.12 Get device simple descriptor

```
Send:    CFML:CFZB:0:AT+SIMPLEDESC=<short_addr>,<endpoint_hex>
Example: CFML:CFZB:0:AT+SIMPLEDESC=1234,0A
Expect:  CFZB:0:OK:+SIMPLEDESC:<profile>,<device_id>,<in_clusters>,...
```

### 3.13 Remove device from network

```
Send:    CFML:CFZB:0:AT+ENTDEL=<short_addr>
Example: CFML:CFZB:0:AT+ENTDEL=1234
Expect:  CFZB:0:OK:+ENTDEL:0
         CFZB:0:EVT:LEAVE:<short_addr>
```

### 3.14 Read Zigbee ZCL attribute

```
Send:    CFML:CFZB:0:AT+ATTRREAD=<short_addr>,<ep_hex>,<cluster_hex>,<attr_hex>
Example: CFML:CFZB:0:AT+ATTRREAD=1234,0A,0006,0000
Expect:  CFZB:0:OK:+ATTRREAD:<short_addr>,<ep>,<cluster>,<attr>,<type>,<value>
```

### 3.15 Write Zigbee ZCL attribute

```
Send:    CFML:CFZB:0:AT+ATTRWRITE=<short_addr>,<ep_hex>,<cluster_hex>,<attr_hex>,<type_hex>,<value_hex>
Example: CFML:CFZB:0:AT+ATTRWRITE=1234,0A,0006,0000,10,01
Expect:  CFZB:0:OK:+ATTRWRITE:0
```

### 3.16 Send ZCL cluster command

```
Send:    CFML:CFZB:0:AT+ZCL=<short_addr>,<ep_hex>,<cluster_hex>,<cmd_id_hex>[,<data_hex>]
Example: CFML:CFZB:0:AT+ZCL=1234,0A,0006,01
         (OnOff cluster cmd 0x01 = ON, no extra data)
Expect:  CFZB:0:OK:+ZCL:0
         CFZB:0:EVT:RSP:<data>    (ZCL response from device, if any)
```

### 3.17 Configure attribute reporting

```
Send:    CFML:CFZB:0:AT+CONFREPORT=<short_addr>,<ep_hex>,<cluster_hex>,<attr_hex>,<type_hex>,<min_s_hex>,<max_s_hex>,<change_hex>
Example: CFML:CFZB:0:AT+CONFREPORT=1234,01,0402,0000,29,0001,003C,0064
         (Temperature attr: min 1s, max 60s, change 100 = 1.00°C)
Expect:  CFZB:0:OK:+CONFREPORT:0
         CFZB:0:EVT:RPT:<short_addr>,<ep>,<cluster>,<attr>,<type>,<value>  (periodic)
```

### 3.18 Send raw unicast data

```
Send:    CFML:CFZB:0:AT+SENDDATA=<short_addr>,<ep_hex>,<cluster_hex>,<data_hex>
Example: CFML:CFZB:0:AT+SENDDATA=1234,01,0000,DEADBEEF
Expect:  CFZB:0:OK:+SENDDATA:0
```

### 3.19 Broadcast

```
Send:    CFML:CFZB:0:AT+BROADCAST=<cluster_hex>,<data_hex>
Example: CFML:CFZB:0:AT+BROADCAST=0000,AABB
Expect:  CFZB:0:OK:+BROADCAST:0
```

### Asynchronous Events (E180-ZG120B → gateway)

```
CFZB:0:EVT:JOIN:<short_addr>                                     ← new device joined
CFZB:0:EVT:LEAVE:<short_addr>                                    ← device left
CFZB:0:EVT:NODE:<data>                                           ← device announces itself
CFZB:0:EVT:RSP:<data>                                            ← ZCL cluster response
CFZB:0:EVT:RPT:<short_addr>,<ep>,<cluster>,<attr>,<type>,<value> ← periodic attribute data
```

### Typical Zigbee test flow

```
1. CFML:CFZB:0:AT+INFO?                                                    — verify module
2. CFML:CFZB:0:AT+CREATENW                                               — start coordinator
3. CFML:CFZB:0:AT+NWINFO                                              — confirm PAN formed
4. CFML:CFZB:0:AT+OPENWNET=60                                          — allow join
   [ power on E18 end-device — observe CFZB:0:EVT:JOIN:<short_addr> ]
5. CFML:CFZB:0:AT+SIMPLEDESC=<addr>,01                              — verify clusters
6. CFML:CFZB:0:AT+ATTRREAD=<addr>,01,0006,0000                           — read OnOff
7. CFML:CFZB:0:AT+ZCL=<addr>,01,0006,01                      — turn ON
8. CFML:CFZB:0:AT+CONFREPORT=<addr>,01,0402,0000,29,0001,003C,0064
   [ observe periodic CFZB:0:EVT:RPT:... ]
```

---

## 4. LoRa Wio-E5 mini (`CFLR:`)

> Module: **Seeed Wio-E5 mini** (LoRaWAN, STM32WLE5JC), UART **9600** baud.
> Format: `CFML:CFLR:<stack_id>:<AT_COMMAND>` — the AT command is forwarded verbatim to the module.
> The JSON config (`stack_006_config.json`) is matched by command prefix to supply GPIO, timeout, and expected response metadata.
> Response: `CFLR:<stack_id>:OK:<response>` or `CFLR:<stack_id>:FAIL:<reason>`.

### 4.1 Get firmware version

```
Send:    CFML:CFLR:0:AT+VER
Expect:  CFLR:0:OK:+VER: <version_string>
```

### 4.2 Software reset

```
Send:    CFML:CFLR:0:AT+RESET
Expect:  CFLR:0:OK:+RESET: OK
         (module restarts — wait ~1 s)
```

### 4.3 Factory reset

```
Send:    CFML:CFLR:0:AT+FDEFAULT
Expect:  CFLR:0:OK:+FDEFAULT: OK
         (wait ~1 s)
```

### 4.4 Set region / DR plan

```
Send:    CFML:CFLR:0:AT+DR <region>
Regions: EU868 | US915 | AU915 | AS923 | KR920 | IN865
Example: CFML:CFLR:0:AT+DR AS923    (Vietnam)
Expect:  CFLR:0:OK:+DR: AS923
```

### 4.5 Set LoRaWAN class (A, B, or C)

```
Send:    CFML:CFLR:0:AT+CLASS <A|B|C>
Example: CFML:CFLR:0:AT+CLASS A
Expect:  CFLR:0:OK:+CLASS: A
```

### 4.6 Set join mode

```
Send:    CFML:CFLR:0:AT+MODE <OTAA|ABP>
Example: CFML:CFLR:0:AT+MODE OTAA
         CFML:CFLR:0:AT+MODE ABP
Expect:  CFLR:0:OK:+MODE: OTAA
```

### 4.7 Set DevEUI (OTAA — 8 bytes as space-separated hex pairs)

```
Send:    CFML:CFLR:0:AT+ID DevEui,<eui>
Example: CFML:CFLR:0:AT+ID DevEui,00 11 22 33 44 55 66 77
Expect:  CFLR:0:OK:+ID: DevEui, 00:11:22:33:44:55:66:77
```

### 4.8 Get DevEUI

```
Send:    CFML:CFLR:0:AT+ID DevEui
Expect:  CFLR:0:OK:+ID: DevEui, 00:11:22:33:44:55:66:77
```

### 4.9 Set AppEUI / JoinEUI (OTAA)

```
Send:    CFML:CFLR:0:AT+ID AppEui,<eui>
Example: CFML:CFLR:0:AT+ID AppEui,00 00 00 00 00 00 00 01
Expect:  CFLR:0:OK:+ID: AppEui, 00:00:00:00:00:00:00:01
```

### 4.10 Set AppKey (OTAA — 16 bytes as space-separated hex pairs)

```
Send:    CFML:CFLR:0:AT+KEY APPKEY,<key>
Example: CFML:CFLR:0:AT+KEY APPKEY,00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE FF
Expect:  CFLR:0:OK:+KEY: APPKEY 00112233445566778899AABBCCDDEEFF
```

### 4.11 Set DevAddr (ABP only)

```
Send:    CFML:CFLR:0:AT+ID DevAddr,<addr>
Example: CFML:CFLR:0:AT+ID DevAddr,01 02 03 04
Expect:  CFLR:0:OK:+ID: DevAddr, 01:02:03:04
```

### 4.12 Get DevAddr (ABP)

```
Send:    CFML:CFLR:0:AT+ID DevAddr
Expect:  CFLR:0:OK:+ID: DevAddr, 01:02:03:04
```

### 4.13 Set NwkSKey (ABP only — 16 bytes)

```
Send:    CFML:CFLR:0:AT+KEY NWKSKEY,<key>
Example: CFML:CFLR:0:AT+KEY NWKSKEY,00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE FF
Expect:  CFLR:0:OK:+KEY: NWKSKEY 00112233445566778899AABBCCDDEEFF
```

### 4.14 Set AppSKey (ABP only — 16 bytes)

```
Send:    CFML:CFLR:0:AT+KEY APPSKEY,<key>
Example: CFML:CFLR:0:AT+KEY APPSKEY,FF EE DD CC BB AA 99 88 77 66 55 44 33 22 11 00
Expect:  CFLR:0:OK:+KEY: APPSKEY FFEEDDCCBBAA99887766554433221100
```

### 4.15 Join network

```
Send:    CFML:CFLR:0:AT+JOIN
Expect:  CFLR:0:OK:+JOIN: Start
         CFLR:0:OK:+JOIN: NORMAL          (joining in progress)
         CFLR:0:OK:+JOIN: Done            (join successful, ~5–30 s)
         or
         CFLR:0:FAIL:+JOIN: Fail          (join failed)
```

### 4.16 Set data rate

```
Send:    CFML:CFLR:0:AT+DR <dr>
DR values (AS923): DR0=SF12/125kHz  DR3=SF9/125kHz  DR5=SF7/125kHz
Example: CFML:CFLR:0:AT+DR DR3        (SF9/125kHz)
Expect:  CFLR:0:OK:+DR: DR3
```

### 4.17 Enable/disable adaptive data rate (ADR)

```
Send:    CFML:CFLR:0:AT+ADR <ON|OFF>
Example: CFML:CFLR:0:AT+ADR OFF       (disable ADR)
         CFML:CFLR:0:AT+ADR ON        (enable ADR)
Expect:  CFLR:0:OK:+ADR: OFF
```

### 4.18 Set transmit power

```
Send:    CFML:CFLR:0:AT+POWER <dbm>
Example: CFML:CFLR:0:AT+POWER 14
Expect:  CFLR:0:OK:+POWER: 14
```

### 4.19 Set confirmed uplink retry count

```
Send:    CFML:CFLR:0:AT+RETRY <n>
Example: CFML:CFLR:0:AT+RETRY 3
Expect:  CFLR:0:OK:+RETRY: 3
```

### 4.20 Set application port

```
Send:    CFML:CFLR:0:AT+PORT <port>
Example: CFML:CFLR:0:AT+PORT 1
Expect:  CFLR:0:OK:+PORT: 1
```

### 4.21 Send unconfirmed uplink (string payload)

```
Send:    CFML:CFLR:0:AT+MSG <text>
Example: CFML:CFLR:0:AT+MSG Hello
Expect:  CFLR:0:OK:+MSG: Start
         CFLR:0:OK:+MSG: TX "Hello"
         CFLR:0:OK:+MSG: Done
```

### 4.22 Send confirmed uplink (string payload)

```
Send:    CFML:CFLR:0:AT+CMSG <text>
Example: CFML:CFLR:0:AT+CMSG Hello
Expect:  CFLR:0:OK:+CMSG: Start
         CFLR:0:OK:+CMSG: FPENDING
         CFLR:0:OK:+CMSG: ACK Received
```

### 4.23 Send unconfirmed uplink (hex payload)

```
Send:    CFML:CFLR:0:AT+MSGHEX <hex_payload>
Example: CFML:CFLR:0:AT+MSGHEX 48 65 6C 6C 6F    (sends "Hello" on set port)
Expect:  CFLR:0:OK:+MSGHEX: Start
         CFLR:0:OK:+MSGHEX: TX "48 65 6C 6C 6F"
         CFLR:0:OK:+MSGHEX: Done
```

### 4.24 Send confirmed uplink (hex payload)

```
Send:    CFML:CFLR:0:AT+CMSGHEX <hex_payload>
Example: CFML:CFLR:0:AT+CMSGHEX 01
Expect:  CFLR:0:OK:+CMSGHEX: Start
         CFLR:0:OK:+CMSGHEX: ACK Received
```

### 4.25 Check max payload length at current DR

```
Send:    CFML:CFLR:0:AT+LW LEN
Expect:  CFLR:0:OK:+LW: LEN, <max_bytes>
```

### 4.26 Read supply voltage

```
Send:    CFML:CFLR:0:AT+VDD
Expect:  CFLR:0:OK:+VDD: <mV>
```

### Asynchronous Events (Wio-E5 → gateway)

```
CFLR:0:EVT:+JOIN: Start                            ← join process started
CFLR:0:EVT:+JOIN: Done                             ← OTAA/ABP join successful
CFLR:0:EVT:+JOIN: Fail                             ← join failed
CFLR:0:EVT:RX: port <port>; RX: "<data_hex>"      ← downlink received
```

### Typical LoRa OTAA test flow (Wio-E5)

```
1.  CFML:CFLR:0:AT+RESET                                              — restart module
2.  CFML:CFLR:0:AT+VER                                              — verify firmware
3.  CFML:CFLR:0:AT+DR AS923                                      — AS923 (Vietnam)
4.  CFML:CFLR:0:AT+CLASS A                                           — Class A
5.  CFML:CFLR:0:AT+MODE OTAA                                    — OTAA mode
6.  CFML:CFLR:0:AT+ID DevEui,00 11 22 33 44 55 66 77                    — DevEUI
7.  CFML:CFLR:0:AT+ID AppEui,00 00 00 00 00 00 00 01                    — AppEUI
8.  CFML:CFLR:0:AT+KEY APPKEY,00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE FF
9.  CFML:CFLR:0:AT+ADR OFF                                           — disable ADR
10. CFML:CFLR:0:AT+DR DR3                                            — DR3 (SF9)
11. CFML:CFLR:0:AT+PORT 1                                            — port 1
12. CFML:CFLR:0:AT+JOIN                                                  — join (wait ~5-30 s)
    [ observe CFLR:0:EVT:+JOIN: Done ]
13. CFML:CFLR:0:AT+MSGHEX 48 65 6C 6C 6F                              — send "Hello"
    [ observe CFLR:0:OK:+MSGHEX: Done ]
    [ observe CFLR:0:EVT:RX: port 1; RX: "..." if server sends downlink ]
```

---

## Notes

| Response prefix | Handler      |
|-----------------|--------------|
| `CFBL:`         | BLE (GATT + Native) |
| `CFZB:`         | Zigbee       |
| `CFLR:`         | LoRa         |

Async events arrive as `<prefix>:<stack_id>:EVT:<text>` without being solicited.

**UART immediate ack:** After the `CFML:...` command is accepted into the queue, the WAN MCU replies `OK:CMD_QUEUED`. The actual handler response follows asynchronously.

---
---

# PHẦN 2: REAL APPLICATION TEST COMMANDS

> Các lệnh bên dưới dùng cho bài test ứng dụng thực tế với các thiết bị Arduino.
> **Quy tắc quan trọng:** Mỗi command gửi đi phải chờ phản hồi hoặc timeout trước khi gửi command tiếp theo. KHÔNG gửi 2 command cùng lúc.

---

## 5. Bài Test BLE GATT — 5 Thiết Bị

### 5.0 Danh sách thiết bị

| # | Tên thiết bị   | Loại     | Board   | Service UUID | Đặc điểm nhận dạng       |
|---|----------------|----------|---------|-------------|---------------------------|
| 1 | DA2_LED_1      | LED      | ESP32-S3 | 0xFFF0      | FFF2 WRITE: ON/OFF + RGB  |
| 2 | DA2_LED_2      | LED      | ESP32-S3 | 0xFFF0      | FFF2 WRITE: ON/OFF + RGB  |
| 3 | DA2_SENSOR_1   | Sensor   | ESP32-S3 | 0xAA10      | AA11 NOTIFY: temp+hum     |
| 4 | DA2_SENSOR_2   | Sensor   | ESP32-S3 | 0xAA10      | AA11 NOTIFY: temp+hum     |
| 5 | DA2_SENSOR_3   | Sensor   | ESP32-S3 | 0xAA10      | AA11 NOTIFY: temp+hum     |

**LED device (Service 0xFFF0):**
- Char FFF1 (NOTIFY): phản hồi — `[0xAA, val]` khi bật/tắt, `[0xCC, R, G, B]` khi đổi màu
- Char FFF2 (WRITE): `01` = ON, `00` = OFF, hoặc `01RRGGBB` = ON + màu RGB
- GPIO 48 = WS2812 RGB LED (ESP32-S3)

**Sensor device (Service 0xAA10):**
- Char AA11 (NOTIFY): 4 bytes `[temp_lo, temp_hi, hum_lo, hum_hi]` — int16 LE, đơn vị 0.01
  - Ví dụ: `E8 09 3A 13` → temp = 0x09E8 = 2536 → 25.36°C, hum = 0x133A = 4922 → 49.22%
- Char AA12 (WRITE): 2 bytes `[interval_lo, interval_hi]` — chu kỳ notify ms (mặc định 2000ms)

**5 màu cố định cho LED:**

| Màu    | Hex     | Lệnh WRITE (FFF2)   |
|--------|---------|----------------------|
| Đỏ     | FF0000  | `01FF0000`           |
| Xanh lá | 00FF00 | `0100FF00`           |
| Xanh dương | 0000FF | `010000FF`        |
| Vàng   | FFFF00  | `01FFFF00`           |
| Trắng  | FFFFFF  | `01FFFFFF`           |

### 5.1 Bước 1 — Quét thiết bị BLE

```
Send:    CFML:CFBG:0:SCAN:8000
Expect:  CFBL:0:OK:SCAN_RESULT:<idx> <MAC1> <RSSI> DA2_LED_1
         CFBL:0:OK:SCAN_RESULT:<idx> <MAC2> <RSSI> DA2_LED_2
         CFBL:0:OK:SCAN_RESULT:<idx> <MAC3> <RSSI> DA2_SENSOR_1
         CFBL:0:OK:SCAN_RESULT:<idx> <MAC4> <RSSI> DA2_SENSOR_2
         CFBL:0:OK:SCAN_RESULT:<idx> <MAC5> <RSSI> DA2_SENSOR_3
         CFBL:0:OK:SCAN_DONE
```

### 5.2 Bước 2 — Xem danh sách

```
Send:    CFML:CFBG:0:LIST
Expect:  CFBL:0:OK:LIST: ...
```

### 5.3 Bước 3 — Kết nối lần lượt 5 thiết bị

> Phải chờ CONNECTED trước khi kết nối thiết bị tiếp theo.

```
Send:    CFML:CFBG:0:CONNECT:<MAC1>
Expect:  CFBL:0:OK:CONNECTED:0         ← conn_idx=0 (DA2_LED_1)

Send:    CFML:CFBG:0:CONNECT:<MAC2>
Expect:  CFBL:0:OK:CONNECTED:1         ← conn_idx=1 (DA2_LED_2)

Send:    CFML:CFBG:0:CONNECT:<MAC3>
Expect:  CFBL:0:OK:CONNECTED:2         ← conn_idx=2 (DA2_SENSOR_1)

Send:    CFML:CFBG:0:CONNECT:<MAC4>
Expect:  CFBL:0:OK:CONNECTED:3         ← conn_idx=3 (DA2_SENSOR_2)

Send:    CFML:CFBG:0:CONNECT:<MAC5>
Expect:  CFBL:0:OK:CONNECTED:4         ← conn_idx=4 (DA2_SENSOR_3)
```

### 5.4 Bước 4 — Discover services cho từng thiết bị

```
Send:    CFML:CFBG:0:DISC:0
Expect:  CFBL:0:OK:DISC:<handle> FFF0 ... FFF1 NOTIFY ... FFF2 WRITE ...
         CFBL:0:OK:DISC_DONE

Send:    CFML:CFBG:0:DISC:1
Expect:  (tương tự — FFF0, FFF1, FFF2)

Send:    CFML:CFBG:0:DISC:2
Expect:  CFBL:0:OK:DISC:<handle> AA10 ... AA11 NOTIFY ... AA12 WRITE ...
         CFBL:0:OK:DISC_DONE

Send:    CFML:CFBG:0:DISC:3
Expect:  (tương tự — AA10, AA11, AA12)

Send:    CFML:CFBG:0:DISC:4
Expect:  (tương tự — AA10, AA11, AA12)
```

### 5.5 Bước 5 — Bật notification cho sensor

> Ghi `0100` vào CCCD handle (handle ngay sau AA11) để enable NOTIFY.

```
Send:    CFML:CFBG:0:NOTIFY:2:<cccd_handle_AA11>:1
Expect:  CFBL:0:OK:NOTIFY_ENABLED
         CFBL:0:NOTIF:<AA11_handle>:<4_bytes_hex>    ← dữ liệu temp+hum mỗi 2s

Send:    CFML:CFBG:0:NOTIFY:3:<cccd_handle_AA11>:1
Expect:  CFBL:0:OK:NOTIFY_ENABLED

Send:    CFML:CFBG:0:NOTIFY:4:<cccd_handle_AA11>:1
Expect:  CFBL:0:OK:NOTIFY_ENABLED
```

**Parse dữ liệu notification (4 bytes):**
```
Byte[0..1] = temperature (int16 LE, đơn vị 0.01°C)
Byte[2..3] = humidity    (int16 LE, đơn vị 0.01%)

Ví dụ: "E8 09 3A 13"
  temp = 0x09E8 = 2536 → 25.36°C
  hum  = 0x133A = 4922 → 49.22%
```

### 5.6 Bước 6 — Điều khiển LED

**Bật LED 1 (conn_idx=0):**
```
Send:    CFML:CFBG:0:WRITE:0:<FFF2_handle>:01
Expect:  CFBL:0:OK:WRITE:<FFF2_handle>
         CFBL:0:NOTIF:<FFF1_handle>:AA01    ← echo confirm ON
```

**Đổi màu LED 1 sang Đỏ:**
```
Send:    CFML:CFBG:0:WRITE:0:<FFF2_handle>:01FF0000
Expect:  CFBL:0:OK:WRITE:<FFF2_handle>
         CFBL:0:NOTIF:<FFF1_handle>:CCFF0000   ← echo confirm color
```

**Tắt LED 1:**
```
Send:    CFML:CFBG:0:WRITE:0:<FFF2_handle>:00
Expect:  CFBL:0:OK:WRITE:<FFF2_handle>
         CFBL:0:NOTIF:<FFF1_handle>:AA00    ← echo confirm OFF
```

**Đổi màu LED 2 (conn_idx=1) sang Xanh lá:**
```
Send:    CFML:CFBG:0:WRITE:1:<FFF2_handle>:0100FF00
Expect:  CFBL:0:OK:WRITE:<FFF2_handle>
         CFBL:0:NOTIF:<FFF1_handle>:CC00FF00
```

### 5.7 Bước 7 — Thay đổi tần suất đọc sensor

**Đặt chu kỳ notify 1000ms (0x03E8) cho SENSOR_1:**
```
Send:    CFML:CFBG:0:WRITE:2:<AA12_handle>:E803
Expect:  CFBL:0:OK:WRITE:<AA12_handle>
```

### 5.8 Bước 8 — Ngắt kết nối

```
Send:    CFML:CFBG:0:DISCONNECT:4
Expect:  CFBL:0:OK:DISCONNECTED:4

Send:    CFML:CFBG:0:DISCONNECT:3
Expect:  CFBL:0:OK:DISCONNECTED:3

Send:    CFML:CFBG:0:DISCONNECT:2
Expect:  CFBL:0:OK:DISCONNECTED:2

Send:    CFML:CFBG:0:DISCONNECT:1
Expect:  CFBL:0:OK:DISCONNECTED:1

Send:    CFML:CFBG:0:DISCONNECT:0
Expect:  CFBL:0:OK:DISCONNECTED:0
```

### 5.9 Full Test Sequence (tóm tắt)

```
CFML:CFBG:0:SCAN:8000                          → quét 8s
CFML:CFBG:0:LIST                                → xem danh sách
CFML:CFBG:0:CONNECT:<MAC_LED1>                  → conn_idx=0
CFML:CFBG:0:CONNECT:<MAC_LED2>                  → conn_idx=1
CFML:CFBG:0:CONNECT:<MAC_SENSOR1>               → conn_idx=2
CFML:CFBG:0:CONNECT:<MAC_SENSOR2>               → conn_idx=3
CFML:CFBG:0:CONNECT:<MAC_SENSOR3>               → conn_idx=4
CFML:CFBG:0:DISC:0                              → discover LED1
CFML:CFBG:0:DISC:1                              → discover LED2
CFML:CFBG:0:DISC:2                              → discover SENSOR1
CFML:CFBG:0:DISC:3                              → discover SENSOR2
CFML:CFBG:0:DISC:4                              → discover SENSOR3
CFML:CFBG:0:NOTIFY:2:<cccd>:1                   → enable sensor1 notify
CFML:CFBG:0:NOTIFY:3:<cccd>:1                   → enable sensor2 notify
CFML:CFBG:0:NOTIFY:4:<cccd>:1                   → enable sensor3 notify
CFML:CFBG:0:WRITE:0:<FFF2>:01FF0000             → LED1 ON Đỏ
CFML:CFBG:0:WRITE:1:<FFF2>:0100FF00             → LED2 ON Xanh lá
…  (quan sát dữ liệu sensor qua NOTIF)
CFML:CFBG:0:WRITE:0:<FFF2>:00                   → LED1 OFF
CFML:CFBG:0:DISCONNECT:4
CFML:CFBG:0:DISCONNECT:3
CFML:CFBG:0:DISCONNECT:2
CFML:CFBG:0:DISCONNECT:1
CFML:CFBG:0:DISCONNECT:0
```

---

## 6. Bài Test BLE Mesh — 5 Thiết Bị

### 6.0 Danh sách thiết bị

| # | Tên BLE            | CID      | Loại     | Board   | Service UUID | Phân biệt                |
|---|--------------------|----------|----------|---------|-------------|---------------------------|
| 1 | DA2_MESH_LED_1     | 0xDA21   | LED      | ESP32-S3 | 0xDA20      | Manufacturer data CID     |
| 2 | DA2_MESH_LED_2     | 0xDA21   | LED      | ESP32-S3 | 0xDA20      | Manufacturer data CID     |
| 3 | DA2_MESH_SENSOR_1  | 0xDA22   | Sensor   | ESP32-S3 | 0xDA20      | Manufacturer data CID     |
| 4 | DA2_MESH_SENSOR_2  | 0xDA22   | Sensor   | ESP32-S3 | 0xDA20      | Manufacturer data CID     |
| 5 | DA2_MESH_SENSOR_3  | 0xDA22   | Sensor   | ESP32-S3 | 0xDA20      | Manufacturer data CID     |

**LED device (CID 0xDA21, Service 0xDA20):**
- Char DA21 (WRITE): 2 bytes `[ON/OFF, color_index]`
  - ON/OFF: 0x00=OFF, 0x01=ON
  - color_index: 0=Đỏ, 1=Xanh lá, 2=Xanh dương, 3=Vàng, 4=Trắng
- Char DA22 (READ): thiết bị info (JSON-like string: type, CID, device index)

**Sensor device (CID 0xDA22, Service 0xDA20):**
- Char DA23 (NOTIFY): 4 bytes `[temp_lo, temp_hi, hum_lo, hum_hi]` — int16 LE, đơn vị 0.01
- Char DA24 (WRITE): 2 bytes `[interval_lo, interval_hi]` — chu kỳ notify ms
- Char DA22 (READ): thiết bị info

**Nhận dạng loại thiết bị:** Qua CID trong manufacturer data advertising:
- `0xDA21` → LED device
- `0xDA22` → Sensor device

### 6.1 Bước 1 — Quét thiết bị unprovisioned

```
Send:    CFML:CFBN:0:SCAN:8000
Expect:  CFBN:0:OK:SCAN_STARTED
         CFBN:0:OK:SCAN_RESULT:<uuid1_32hex> <RSSI>    ← DA2_MESH_LED_1
         CFBN:0:OK:SCAN_RESULT:<uuid2_32hex> <RSSI>    ← DA2_MESH_LED_2
         CFBN:0:OK:SCAN_RESULT:<uuid3_32hex> <RSSI>    ← DA2_MESH_SENSOR_1
         CFBN:0:OK:SCAN_RESULT:<uuid4_32hex> <RSSI>    ← DA2_MESH_SENSOR_2
         CFBN:0:OK:SCAN_RESULT:<uuid5_32hex> <RSSI>    ← DA2_MESH_SENSOR_3
```

### 6.2 Bước 2 — Provision lần lượt

> Phải chờ PROVISIONED trước khi provision thiết bị tiếp.

```
Send:    CFML:CFBN:0:PROVISION:<uuid1_32hex>
Expect:  CFBN:0:OK:PROVISIONED:0x0002       ← addr LED_1

Send:    CFML:CFBN:0:PROVISION:<uuid2_32hex>
Expect:  CFBN:0:OK:PROVISIONED:0x0003       ← addr LED_2

Send:    CFML:CFBN:0:PROVISION:<uuid3_32hex>
Expect:  CFBN:0:OK:PROVISIONED:0x0004       ← addr SENSOR_1

Send:    CFML:CFBN:0:PROVISION:<uuid4_32hex>
Expect:  CFBN:0:OK:PROVISIONED:0x0005       ← addr SENSOR_2

Send:    CFML:CFBN:0:PROVISION:<uuid5_32hex>
Expect:  CFBN:0:OK:PROVISIONED:0x0006       ← addr SENSOR_3
```

### 6.3 Bước 3 — Xác nhận danh sách node

```
Send:    CFML:CFBN:0:NODE_LIST
Expect:  CFBN:0:OK:NODE_LIST:[
           {"addr":"0x0002","uuid":"..."},
           {"addr":"0x0003","uuid":"..."},
           {"addr":"0x0004","uuid":"..."},
           {"addr":"0x0005","uuid":"..."},
           {"addr":"0x0006","uuid":"..."}
         ]
```

### 6.4 Bước 4 — Add App Key cho mỗi node

```
Send:    CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0002","net_idx":0,"app_idx":0}
Expect:  CFBN:0:OK:APP_KEY_ADDED:0x0002

Send:    CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0003","net_idx":0,"app_idx":0}
Expect:  CFBN:0:OK:APP_KEY_ADDED:0x0003

Send:    CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0004","net_idx":0,"app_idx":0}
Expect:  CFBN:0:OK:APP_KEY_ADDED:0x0004

Send:    CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0005","net_idx":0,"app_idx":0}
Expect:  CFBN:0:OK:APP_KEY_ADDED:0x0005

Send:    CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0006","net_idx":0,"app_idx":0}
Expect:  CFBN:0:OK:APP_KEY_ADDED:0x0006
```

### 6.5 Bước 5 — Điều khiển LED

**Bật LED 1 màu Đỏ (color_index=0):**
```
Send:    CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":1}}
Expect:  CFBN:0:OK:ONOFF_STATUS:0x0002:1
```

**Bật LED 2 màu Xanh dương (color_index=2):**
```
Send:    CFML:CFBN:0:CONTROL:{"addr":"0x0003","func":"ONOFF","params":{"onoff":1}}
Expect:  CFBN:0:OK:ONOFF_STATUS:0x0003:1
```

**Tắt LED 1:**
```
Send:    CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":0}}
Expect:  CFBN:0:OK:ONOFF_STATUS:0x0002:0
```

> Lưu ý: Điều khiển màu sắc cụ thể thông qua vendor model hoặc qua kết nối GATT trực tiếp
> với service 0xDA20, ghi vào char DA21 giá trị `[0x01, color_index]`.

### 6.6 Bước 6 — Đọc trạng thái

```
Send:    CFML:CFBN:0:GET_STATUS:{"addr":"0x0002","model":"ONOFF"}
Expect:  CFBN:0:OK:ONOFF_STATUS:0x0002:1

Send:    CFML:CFBN:0:GET_STATUS:{"addr":"0x0004","model":"SENSOR"}
Expect:  CFBN:0:OK:SENSOR_STATUS:0x0004:<data>
```

### 6.7 Bước 7 — Reset node (nếu cần)

```
Send:    CFML:CFBN:0:NODE_RESET:0x0006
Expect:  CFBN:0:OK:NODE_RESET:0x0006
```

### 6.8 Full Test Sequence (tóm tắt)

```
CFML:CFBN:0:SCAN:8000                                                  → quét 8s
CFML:CFBN:0:PROVISION:<uuid_LED1>                                      → addr=0x0002
CFML:CFBN:0:PROVISION:<uuid_LED2>                                      → addr=0x0003
CFML:CFBN:0:PROVISION:<uuid_SENSOR1>                                   → addr=0x0004
CFML:CFBN:0:PROVISION:<uuid_SENSOR2>                                   → addr=0x0005
CFML:CFBN:0:PROVISION:<uuid_SENSOR3>                                   → addr=0x0006
CFML:CFBN:0:NODE_LIST                                                  → xác nhận 5 node
CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0002","net_idx":0,"app_idx":0}      → bind LED1
CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0003","net_idx":0,"app_idx":0}      → bind LED2
CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0004","net_idx":0,"app_idx":0}      → bind SENSOR1
CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0005","net_idx":0,"app_idx":0}      → bind SENSOR2
CFML:CFBN:0:APP_KEY_ADD:{"addr":"0x0006","net_idx":0,"app_idx":0}      → bind SENSOR3
CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":1}}  → LED1 ON
CFML:CFBN:0:CONTROL:{"addr":"0x0003","func":"ONOFF","params":{"onoff":1}}  → LED2 ON
CFML:CFBN:0:GET_STATUS:{"addr":"0x0004","model":"SENSOR"}              → đọc sensor1
… (quan sát dữ liệu sensor)
CFML:CFBN:0:CONTROL:{"addr":"0x0002","func":"ONOFF","params":{"onoff":0}}  → LED1 OFF
CFML:CFBN:0:NODE_RESET:0x0006                                         → reset nếu cần
```

---

## 7. Bài Test Zigbee — 3 Thiết Bị

### 7.0 Danh sách thiết bị

| # | Model ID        | Loại   | Board    | Endpoint | Clusters                         |
|---|-----------------|--------|----------|----------|----------------------------------|
| 1 | ZB-C6-Bulb      | LED    | ESP32-C6 | EP 10    | 0x0006 (OnOff), 0x0008 (Level), 0x0300 (Color) |
| 2 | ZB-TH-Sensor-1  | Sensor | ESP32-C6 | EP 1     | 0x0402 (Temperature), 0x0405 (Humidity) |
| 3 | ZB-TH-Sensor-2  | Sensor | ESP32-C6 | EP 1     | 0x0402 (Temperature), 0x0405 (Humidity) |

**LED device (ZB-C6-Bulb, EP 10):**
- Cluster 0x0006: OnOff — cmd 0x01=ON, 0x00=OFF, 0x02=Toggle
- Cluster 0x0008: Level Control — cmd 0x04=Move to Level `[level, transition_time_lo, transition_time_hi]`
- Cluster 0x0300: Color Control — cmd 0x07=Move to Color XY `[X_lo, X_hi, Y_lo, Y_hi, time_lo, time_hi]`

**5 màu cố định (Color XY CIE 1931):**

| Màu       | X      | Y      | X hex  | Y hex  |
|-----------|--------|--------|--------|--------|
| Đỏ        | 0.6915 | 0.3083 | 0xB0A3 | 0x4F05 |
| Xanh lá   | 0.1700 | 0.7000 | 0x2B9D | 0xB333 |
| Xanh dương | 0.1500 | 0.0600 | 0x2666 | 0x0F5C |
| Vàng      | 0.4317 | 0.5003 | 0x6EA1 | 0x8028 |
| Trắng     | 0.3127 | 0.3290 | 0x5013 | 0x5438 |

**Sensor device (ZB-TH-Sensor, EP 1):**
- Cluster 0x0402, Attr 0x0000: MeasuredValue (int16, đơn vị 0.01°C)
- Cluster 0x0405, Attr 0x0000: MeasuredValue (uint16, đơn vị 0.01%)
- Hỗ trợ Attribute Reporting tự động

### 7.1 Bước 1 — Khởi tạo mạng Zigbee

```
Send:    CFML:CFZB:0:AT+INFO?
Expect:  CFZB:0:OK:TYPE=...

Send:    CFML:CFZB:0:AT+CREATENW
Expect:  CFZB:0:OK:+CREATENW:0

Send:    CFML:CFZB:0:AT+NWINFO
Expect:  CFZB:0:OK:+NWINFO:<ch>,<panid>,<short_addr>,...
```

### 7.2 Bước 2 — Cho phép thiết bị join

```
Send:    CFML:CFZB:0:AT+OPENWNET=120
Expect:  CFZB:0:OK:+OPENWNET:0
```

> Bật nguồn 3 thiết bị ESP32-C6. Chờ sự kiện JOIN:

```
Expect:  CFZB:0:EVT:JOIN:<short_addr_1>    ← ZB-C6-Bulb
         CFZB:0:EVT:JOIN:<short_addr_2>    ← ZB-TH-Sensor-1
         CFZB:0:EVT:JOIN:<short_addr_3>    ← ZB-TH-Sensor-2
```

### 7.3 Bước 3 — Xác nhận thiết bị (Simple Descriptor)

```
Send:    CFML:CFZB:0:AT+SIMPLEDESC=<short_1>,0A
Expect:  CFZB:0:OK:+SIMPLEDESC:<profile>,<device_id>,...
         → EP=10, Profile=0x0104, DeviceID=0x0102 (Color Dimmable Light)
         → InClusters: 0x0006, 0x0008, 0x0300

Send:    CFML:CFZB:0:AT+SIMPLEDESC=<short_2>,01
Expect:  CFZB:0:OK:+SIMPLEDESC:<profile>,<device_id>,...
         → EP=1, Profile=0x0104, DeviceID=0x0302 (Temperature Sensor)
         → InClusters: 0x0402, 0x0405

Send:    CFML:CFZB:0:AT+SIMPLEDESC=<short_3>,01
Expect:  (tương tự sensor 2)
```

### 7.4 Bước 4 — Cấu hình reporting cho sensor

```
Send:    CFML:CFZB:0:AT+CONFREPORT=<short_2>,01,0402,0000,29,0005,003C,0064
         (Temperature: min 5s, max 60s, change 100=1.00°C, type 0x29=int16)
Expect:  CFZB:0:OK:+CONFREPORT:0

Send:    CFML:CFZB:0:AT+CONFREPORT=<short_2>,01,0405,0000,21,0005,003C,0064
         (Humidity: min 5s, max 60s, change 100=1.00%, type 0x21=uint16)
Expect:  CFZB:0:OK:+CONFREPORT:0

Send:    CFML:CFZB:0:AT+CONFREPORT=<short_3>,01,0402,0000,29,0005,003C,0064
Expect:  CFZB:0:OK:+CONFREPORT:0

Send:    CFML:CFZB:0:AT+CONFREPORT=<short_3>,01,0405,0000,21,0005,003C,0064
Expect:  CFZB:0:OK:+CONFREPORT:0
```

> Sau khi cấu hình, sẽ nhận được report tự động:
```
CFZB:0:EVT:RPT:<short_2>,01,0402,0000,29,<value_hex>
CFZB:0:EVT:RPT:<short_2>,01,0405,0000,21,<value_hex>
```

**Parse giá trị temperature:**
```
Type 0x29 = int16: value_hex = "0A09" → 0x090A = 2314 → 23.14°C
```

**Parse giá trị humidity:**
```
Type 0x21 = uint16: value_hex = "8413" → 0x1384 = 4996 → 49.96%
```

### 7.5 Bước 5 — Điều khiển LED

**Bật LED (OnOff cluster 0x0006, cmd 0x01=ON):**
```
Send:    CFML:CFZB:0:AT+ZCL=<short_1>,0A,0006,01
Expect:  CFZB:0:OK:+ZCL:0
```

**Tắt LED (cmd 0x00=OFF):**
```
Send:    CFML:CFZB:0:AT+ZCL=<short_1>,0A,0006,00
Expect:  CFZB:0:OK:+ZCL:0
```

**Đổi màu Đỏ (Color XY cluster 0x0300, cmd 0x07=MoveToColorXY, transition=1s=0x000A):**
```
Send:    CFML:CFZB:0:AT+ZCL=<short_1>,0A,0300,07,A3B0054F0A00
         Bytes: X_lo=A3 X_hi=B0 (→0xB0A3) Y_lo=05 Y_hi=4F (→0x4F05) time_lo=0A time_hi=00
Expect:  CFZB:0:OK:+ZCL:0
```

**Đổi màu Xanh lá:**
```
Send:    CFML:CFZB:0:AT+ZCL=<short_1>,0A,0300,07,9D2B33B30A00
         (X=0x2B9D, Y=0xB333)
```

**Đổi màu Xanh dương:**
```
Send:    CFML:CFZB:0:AT+ZCL=<short_1>,0A,0300,07,66265C0F0A00
         (X=0x2666, Y=0x0F5C)
```

**Đổi màu Vàng:**
```
Send:    CFML:CFZB:0:AT+ZCL=<short_1>,0A,0300,07,A16E28800A00
         (X=0x6EA1, Y=0x8028)
```

**Đổi màu Trắng:**
```
Send:    CFML:CFZB:0:AT+ZCL=<short_1>,0A,0300,07,135038540A00
         (X=0x5013, Y=0x5438)
```

### 7.6 Bước 6 — Đọc attribute thủ công (nếu cần)

**Đọc trạng thái OnOff:**
```
Send:    CFML:CFZB:0:AT+ATTRREAD=<short_1>,0A,0006,0000
Expect:  CFZB:0:OK:+ATTRREAD:<short_1>,0A,0006,0000,10,<00|01>
```

**Đọc nhiệt độ:**
```
Send:    CFML:CFZB:0:AT+ATTRREAD=<short_2>,01,0402,0000
Expect:  CFZB:0:OK:+ATTRREAD:<short_2>,01,0402,0000,29,<value_hex>
```

### 7.7 Bước 7 — Xóa thiết bị (nếu cần)

```
Send:    CFML:CFZB:0:AT+ENTDEL=<short_3>
Expect:  CFZB:0:OK:+ENTDEL:0
         CFZB:0:EVT:LEAVE:<short_3>
```

### 7.8 Full Test Sequence (tóm tắt)

```
CFML:CFZB:0:AT+INFO?                                                              → verify module
CFML:CFZB:0:AT+CREATENW                                                         → start coordinator
CFML:CFZB:0:AT+OPENWNET=120                                                   → permit join 120s
  [ bật nguồn 3 thiết bị ESP32-C6, chờ CFZB:0:EVT:JOIN events ]
CFML:CFZB:0:AT+SIMPLEDESC=<short_1>,0A                                     → verify LED (EP10)
CFML:CFZB:0:AT+SIMPLEDESC=<short_2>,01                                     → verify sensor1
CFML:CFZB:0:AT+SIMPLEDESC=<short_3>,01                                     → verify sensor2
CFML:CFZB:0:AT+CONFREPORT=<short_2>,01,0402,0000,29,0005,003C,0064         → temp report
CFML:CFZB:0:AT+CONFREPORT=<short_2>,01,0405,0000,21,0005,003C,0064         → hum report
CFML:CFZB:0:AT+CONFREPORT=<short_3>,01,0402,0000,29,0005,003C,0064
CFML:CFZB:0:AT+CONFREPORT=<short_3>,01,0405,0000,21,0005,003C,0064
CFML:CFZB:0:AT+ZCL=<short_1>,0A,0006,01                            → LED ON
CFML:CFZB:0:AT+ZCL=<short_1>,0A,0300,07,A3B0054F0A00              → màu Đỏ
  [ quan sát CFZB:0:EVT:RPT từ sensor ]
CFML:CFZB:0:AT+ZCL=<short_1>,0A,0006,00                            → LED OFF
```

---

## 8. Bài Test LoRa — 1 Thiết Bị

### 8.0 Danh sách thiết bị

| # | Tên              | Board                 | Module      | Mô tả                           |
|---|------------------|-----------------------|-------------|---------------------------------|
| 1 | DA2_LORA_DISPLAY | Arduino Uno R4 WiFi   | Wio-E5 mini | LED Matrix 12×8, LoRaWAN OTAA   |

**Thông tin LoRaWAN:**
- DevEUI: `DA 2D A2 DA 2D A2 DA 01` (ví dụ)
- AppEUI: `00 00 00 00 00 00 00 00`
- AppKey: `DA 2D A2 DA 2D A2 DA 2D A2 DA 2D A2 DA 2D A2 DA`
- Region: AS923, Class A, DR3

**Downlink payload (fPort=1):**

| Payload hex | Chức năng          |
|-------------|---------------------|
| `00`        | Tắt tất cả LED     |
| `01`        | Bật tất cả LED     |
| `02`        | Blink (nhấp nháy)  |
| `03`        | Scroll chữ "HI"    |
| `10`–`19`   | Hiển thị số 0–9    |
| `20`        | Hiển thị Heart ❤️  |
| `21`        | Hiển thị Check ✓   |
| `22`        | Hiển thị Cross ✕   |

**Uplink payload (fPort=1):**
- `AA` — initial report (thiết bị vừa khởi động)
- `BB` — keepalive (mỗi 15 giây)

### 8.1 Bước 1 — Cấu hình Wio-E5 trên Gateway

```
Send:    CFML:CFLR:0:AT+RESET
Expect:  CFLR:0:OK:+RESET: OK    (wait ~1s)

Send:    CFML:CFLR:0:AT+VER
Expect:  CFLR:0:OK:+VER: <version_string>

Send:    CFML:CFLR:0:AT+DR AS923
Expect:  CFLR:0:OK:+DR: AS923

Send:    CFML:CFLR:0:AT+CLASS A
Expect:  CFLR:0:OK:+CLASS: A

Send:    CFML:CFLR:0:AT+MODE OTAA
Expect:  CFLR:0:OK:+MODE: OTAA

Send:    CFML:CFLR:0:AT+ID DevEui,DA 2D A2 DA 2D A2 DA 01
Expect:  CFLR:0:OK:+ID: DevEui, DA:2D:A2:DA:2D:A2:DA:01

Send:    CFML:CFLR:0:AT+ID AppEui,00 00 00 00 00 00 00 00
Expect:  CFLR:0:OK:+ID: AppEui, 00:00:00:00:00:00:00:00

Send:    CFML:CFLR:0:AT+KEY APPKEY,DA 2D A2 DA 2D A2 DA 2D A2 DA 2D A2 DA 2D A2 DA
Expect:  CFLR:0:OK:+KEY: APPKEY DA2DA2DA2DA2DA2DA2DA2DA2DA2DA2DA

Send:    CFML:CFLR:0:AT+ADR OFF
Expect:  CFLR:0:OK:+ADR: OFF

Send:    CFML:CFLR:0:AT+DR DR3
Expect:  CFLR:0:OK:+DR: DR3    (SF9/125kHz)

Send:    CFML:CFLR:0:AT+PORT 1
Expect:  CFLR:0:OK:+PORT: 1
```

### 8.2 Bước 2 — Join mạng LoRaWAN

> Đảm bảo thiết bị Arduino đã bật và đang chờ join.

```
Send:    CFML:CFLR:0:AT+JOIN
Expect:  CFLR:0:OK:+JOIN: Start
         CFLR:0:OK:+JOIN: Done    (thành công, ~5-30s)
```

> Chờ uplink `AA` từ thiết bị (initial report):
```
Expect:  CFLR:0:EVT:RX: port 1; RX: "AA"
```

### 8.3 Bước 3 — Gửi downlink điều khiển

> LoRa Class A: downlink chỉ nhận được trong RX window SAU khi thiết bị gửi uplink.
> Keepalive `BB` mỗi 15s — downlink sẽ giao trong RX window của uplink tiếp theo.

**Bật tất cả LED (payload=01, port=1):**
```
Send:    CFML:CFLR:0:AT+MSGHEX 01
Expect:  CFLR:0:OK:+MSGHEX: Start
         CFLR:0:OK:+MSGHEX: Done
```

**Tắt tất cả LED:**
```
Send:    CFML:CFLR:0:AT+MSGHEX 00
```

**Blink:**
```
Send:    CFML:CFLR:0:AT+MSGHEX 02
```

**Hiển thị "HI":**
```
Send:    CFML:CFLR:0:AT+MSGHEX 03
```

**Hiển thị số 5:**
```
Send:    CFML:CFLR:0:AT+MSGHEX 15
         (0x10 + 5 = 0x15)
```

**Hiện Heart:**
```
Send:    CFML:CFLR:0:AT+MSGHEX 20
```

**Hiện Check:**
```
Send:    CFML:CFLR:0:AT+MSGHEX 21
```

**Hiện Cross:**
```
Send:    CFML:CFLR:0:AT+MSGHEX 22
```

### 8.4 Bước 4 — Quan sát uplink keepalive

```
Expect:  CFLR:0:EVT:RX: port 1; RX: "BB"    (mỗi ~15s)
         CFLR:0:EVT:RX: port 1; RX: "BB"
         ...
```

### 8.5 Full Test Sequence (tóm tắt)

```
CFML:CFLR:0:AT+RESET                                               → reset module
CFML:CFLR:0:AT+DR AS923                                       → AS923
CFML:CFLR:0:AT+CLASS A                                            → Class A
CFML:CFLR:0:AT+MODE OTAA                                     → OTAA mode
CFML:CFLR:0:AT+ID DevEui,DA 2D A2 DA 2D A2 DA 01                    → DevEUI
CFML:CFLR:0:AT+ID AppEui,00 00 00 00 00 00 00 00                    → AppEUI
CFML:CFLR:0:AT+KEY APPKEY,DA 2D A2 DA 2D A2 DA 2D A2 DA 2D A2 DA 2D A2 DA
CFML:CFLR:0:AT+ADR OFF                                            → disable ADR
CFML:CFLR:0:AT+DR DR3                                             → DR3 (SF9)
CFML:CFLR:0:AT+PORT 1                                             → port 1
CFML:CFLR:0:AT+JOIN                                                   → join (chờ ~5-30s)
  [ quan sát CFLR:0:EVT:+JOIN: Done ]
  [ quan sát CFLR:0:EVT:RX: port 1; RX: "AA" = initial report ]
CFML:CFLR:0:AT+MSGHEX 01                                            → bật LED
  [ chờ keepalive BB → CFLR:0:EVT:RX: port 1; RX: "BB" ]
CFML:CFLR:0:AT+MSGHEX 03                                            → scroll "HI"
CFML:CFLR:0:AT+MSGHEX 20                                            → Heart icon
CFML:CFLR:0:AT+MSGHEX 15                                            → số 5
CFML:CFLR:0:AT+MSGHEX 00                                            → tắt LED
```

---
---

# PHẦN 3: BANDWIDTH TEST COMMANDS

> Các bài test đo băng thông tối đa (throughput) của từng giao thức.
> Mỗi bài chỉ kết nối 1 thiết bị, gửi/nhận dữ liệu liên tục.

---

## 9. Bandwidth Test — BLE GATT

### 9.0 Thiết bị

| Tên           | Board    | Service  | Firmware                     |
|---------------|----------|----------|------------------------------|
| DA2_BW_GATT   | ESP32-S3 | 0xBB10   | esp32s3_ble_gatt_bandwidth.ino |

**Characteristics:**

| UUID   | Properties | Chức năng                              |
|--------|-----------|----------------------------------------|
| BB11   | WRITE_NR  | Data sink (ghi dữ liệu để đo downlink)|
| BB12   | NOTIFY    | Data flood (nhận dữ liệu để đo uplink)|
| BB13   | WRITE     | Control: `01`=start TX, `00`=stop TX  |
| BB14   | READ      | Status: 8 bytes (bytesRx u32LE + bytesTx u32LE) |

**Max MTU:** 247 bytes → max payload per packet = 244 bytes

### 9.1 Kết nối và discover

```
Send:    CFML:CFBG:0:SCAN:5000
Expect:  CFBL:0:OK:SCAN_RESULT:<idx> <MAC> <RSSI> DA2_BW_GATT
         CFBL:0:OK:SCAN_DONE

Send:    CFML:CFBG:0:CONNECT:<MAC>
Expect:  CFBL:0:OK:CONNECTED:0

Send:    CFML:CFBG:0:DISC:0
Expect:  CFBL:0:OK:DISC:<h> BB10 ... BB11 WRITE_NR ... BB12 NOTIFY ... BB13 WRITE ... BB14 READ
         CFBL:0:OK:DISC_DONE
```

### 9.2 Test Uplink (device → gateway)

**Bật notification trên BB12:**
```
Send:    CFML:CFBG:0:NOTIFY:0:<cccd_BB12>:1
Expect:  CFBL:0:OK:NOTIFY_ENABLED
```

**Start TX flood trên device:**
```
Send:    CFML:CFBG:0:WRITE:0:<BB13_handle>:01
Expect:  CFBL:0:OK:WRITE:<BB13_handle>
         CFBL:0:NOTIF:<BB12_handle>:<244_bytes_hex>    ← liên tục
         CFBL:0:NOTIF:<BB12_handle>:<244_bytes_hex>
         CFBL:0:NOTIF:<BB12_handle>:<244_bytes_hex>
         ...
```

**Stop TX flood:**
```
Send:    CFML:CFBG:0:WRITE:0:<BB13_handle>:00
Expect:  CFBL:0:OK:WRITE:<BB13_handle>
```

**Đọc stats:**
```
Send:    CFML:CFBG:0:READ:0:<BB14_handle>
Expect:  CFBL:0:OK:READ:<BB14_handle>:<8_bytes_hex>
         → Parse: bytesRx(u32LE) + bytesTx(u32LE)
```

### 9.3 Test Downlink (gateway → device)

**Gửi dữ liệu liên tục vào BB11 (WRITE_NR):**
```
Send:    CFML:CFBG:0:WRITENR:0:<BB11_handle>:<244_bytes_data>
Expect:  CFBL:0:OK:WRITENR

Send:    CFML:CFBG:0:WRITENR:0:<BB11_handle>:<244_bytes_data>
Expect:  CFBL:0:OK:WRITENR
... (lặp lại nhiều lần)
```

> Widget sẽ gửi WRITENR liên tục (sau mỗi OK) và đếm bytes/thời gian để tính throughput.

**Đọc stats sau test:**
```
Send:    CFML:CFBG:0:READ:0:<BB14_handle>
Expect:  CFBL:0:OK:READ:<BB14_handle>:<8_bytes_hex>
```

### 9.4 Tính throughput

```
Throughput (KB/s) = total_bytes / elapsed_seconds / 1024
BLE GATT lý thuyết: ~20-80 KB/s tùy PHY và MTU
```

### 9.5 Ngắt kết nối

```
Send:    CFML:CFBG:0:DISCONNECT:0
Expect:  CFBL:0:OK:DISCONNECTED:0
```

---

## 10. Bandwidth Test — BLE Mesh

### 10.0 Thiết bị

| Tên           | Board    | Service  | CID      | Firmware                      |
|---------------|----------|----------|----------|-------------------------------|
| DA2_BW_MESH   | ESP32-S3 | 0xBB20   | 0xDA2B   | esp32s3_ble_mesh_bandwidth.ino |

**Characteristics (giống structure GATT BW nhưng service khác):**

| UUID   | Properties | Chức năng                              |
|--------|-----------|----------------------------------------|
| BB21   | WRITE_NR  | Data sink (downlink)                   |
| BB22   | NOTIFY    | Data flood (uplink), gói 11 bytes/50ms |
| BB23   | WRITE     | Control: `01`=start, `00`=stop         |
| BB24   | READ      | Status: 8 bytes                        |

> Mesh-like: mỗi gói chỉ 11 bytes (unsegmented), interval 50ms → ~220 B/s lý thuyết

### 10.1 Kết nối (qua GATT trực tiếp, không qua mesh provisioning)

```
Send:    CFML:CFBG:0:SCAN:5000
Expect:  CFBL:0:OK:SCAN_RESULT:<idx> <MAC> <RSSI> DA2_BW_MESH
         CFBL:0:OK:SCAN_DONE

Send:    CFML:CFBG:0:CONNECT:<MAC>
Expect:  CFBL:0:OK:CONNECTED:0

Send:    CFML:CFBG:0:DISC:0
Expect:  CFBL:0:OK:DISC:... BB20 ... BB21 ... BB22 ... BB23 ... BB24 ...
         CFBL:0:OK:DISC_DONE
```

### 10.2 Test Uplink (mesh-like rate)

```
Send:    CFML:CFBG:0:NOTIFY:0:<cccd_BB22>:1
Expect:  CFBL:0:OK:NOTIFY_ENABLED

Send:    CFML:CFBG:0:WRITE:0:<BB23_handle>:01
Expect:  CFBL:0:OK:WRITE:<BB23_handle>
         CFBL:0:NOTIF:<BB22_handle>:<11_bytes_hex>    ← mỗi 50ms
         CFBL:0:NOTIF:<BB22_handle>:<11_bytes_hex>
         ...

Send:    CFML:CFBG:0:WRITE:0:<BB23_handle>:00        ← stop
```

### 10.3 Test Downlink (mesh-like rate)

```
(Gửi gói 11 bytes qua WRITENR, widget tự limit rate ~50ms/gói)
Send:    CFML:CFBG:0:WRITENR:0:<BB21_handle>:<11_bytes_hex>
Expect:  CFBL:0:OK:WRITENR
... (lặp lại)
```

### 10.4 Đọc stats & disconnect

```
Send:    CFML:CFBG:0:READ:0:<BB24_handle>
Expect:  CFBL:0:OK:READ:<BB24_handle>:<8_bytes_hex>

Send:    CFML:CFBG:0:DISCONNECT:0
Expect:  CFBL:0:OK:DISCONNECTED:0
```

### 10.5 Tính throughput

```
Throughput (B/s) = total_bytes / elapsed_seconds
BLE Mesh unsegmented lý thuyết: ~220 B/s (11 bytes × 20 packets/s)
```

---

## 11. Bandwidth Test — Zigbee

### 11.0 Thiết bị

| Tên           | Board    | Model ID       | Firmware                        |
|---------------|----------|----------------|---------------------------------|
| DA2_BW_ZB     | ESP32-C6 | ZB-BW-Sensor   | esp32c6_zigbee_bandwidth.ino    |

**Endpoint 1, sử dụng Temperature Sensor + rapid reporting:**
- Cluster 0x0402: nhiệt độ (rapid report khi TX flood active)
- Control: qua serial `START`/`STOP` trên device hoặc qua OnOff cluster

**Gateway AT commands cho bandwidth test:**
- `AT+ATTRREAD` để đọc dữ liệu
- `AT+SENDDATA` để gửi dữ liệu raw đến device
- Device gửi report liên tục → gateway nhận qua `+ATTRREPORT` async

### 11.1 Kết nối thiết bị

```
Send:    CFML:CFZB:0:AT+CREATENW
Expect:  CFZB:0:OK:+CREATENW:0

Send:    CFML:CFZB:0:AT+OPENWNET=60
Expect:  CFZB:0:OK:+OPENWNET:0
         CFZB:0:EVT:JOIN:<short_bw>         ← ZB-BW-Sensor joined
```

### 11.2 Cấu hình fast reporting

```
Send:    CFML:CFZB:0:AT+CONFREPORT=<short_bw>,01,0402,0000,29,0001,0005,0001
         (min 1s, max 5s, change 0x0001=0.01°C → report rất thường xuyên)
Expect:  CFZB:0:OK:+CONFREPORT:0
```

### 11.3 Test Uplink (device → gateway)

> Device gửi serial `START` → tự flood report qua Zigbee.
> Gateway nhận `EVT:RPT` liên tục.

```
Expect:  CFZB:0:EVT:RPT:<short_bw>,01,0402,0000,29,<value>
         CFZB:0:EVT:RPT:<short_bw>,01,0402,0000,29,<value>
         ... (mỗi ~100ms nếu device flood)
```

> Đếm số report × ~40 bytes/report để tính throughput.

### 11.4 Test Downlink (gateway → device)

**Gửi dữ liệu liên tục qua AT+SENDDATA:**
```
Send:    CFML:CFZB:0:AT+SENDDATA=<short_bw>,01,0000,<80_bytes_hex>
Expect:  CFZB:0:OK:+SENDDATA:0

Send:    CFML:CFZB:0:AT+SENDDATA=<short_bw>,01,0000,<80_bytes_hex>
Expect:  CFZB:0:OK:+SENDDATA:0
... (lặp lại)
```

> Max ~80 bytes/packet qua Zigbee APS layer.

### 11.5 Tính throughput

```
Zigbee 250 kbps PHY → sau overhead thực tế: ~5-20 KB/s
Report fast mode: ~40 bytes × 10 report/s = ~400 B/s (ước lượng)
```

### 11.6 Xóa thiết bị

```
Send:    CFML:CFZB:0:AT+ENTDEL=<short_bw>
Expect:  CFZB:0:OK:+ENTDEL:0
         CFZB:0:EVT:LEAVE:<short_bw>
```

---

## 12. Bandwidth Test — LoRa

### 12.0 Thiết bị

| Tên           | Board                 | Module      | Firmware                         |
|---------------|-----------------------|-------------|----------------------------------|
| DA2_BW_LORA   | Arduino Uno R4 WiFi   | Wio-E5 mini | uno_r4_lora_bandwidth.ino        |

**LoRaWAN config:**
- DevEUI: `DA 2D A2 DA 2D A2 BW 01`
- Class C (continuous RX cho downlink test)
- DR3 (SF9/125kHz), max payload ~115 bytes

**Control protocol (downlink payload):**

| Payload hex     | Chức năng                  |
|-----------------|----------------------------|
| `C1 01`         | Start TX flood (uplink)    |
| `C1 00`         | Stop TX flood              |
| `C3 01`         | Request stats              |
| `DD ...`        | Data payload (downlink BW) |

**Status uplink:**

| Payload hex         | Chức năng                       |
|---------------------|----------------------------------|
| `C1 01`             | Report: TX flood started        |
| `C1 00`             | Report: TX flood stopped        |
| `C2 LL LL HH HH`   | Stats: bytesRx(u16LE) bytesTx(u16LE) |
| `DD ...`            | Data payload (uplink BW)        |

### 12.1 Cấu hình Gateway LoRa

```
Send:    CFML:CFLR:0:AT+RESET
Expect:  CFLR:0:OK:+RESET: OK    (wait ~1s)

Send:    CFML:CFLR:0:AT+DR AS923
Expect:  CFLR:0:OK:+DR: AS923

Send:    CFML:CFLR:0:AT+CLASS C
Expect:  CFLR:0:OK:+CLASS: C    (Class C — always-on RX)

Send:    CFML:CFLR:0:AT+MODE OTAA
Expect:  CFLR:0:OK:+MODE: OTAA

Send:    CFML:CFLR:0:AT+DR DR3
Expect:  CFLR:0:OK:+DR: DR3    (SF9/125kHz)
```

> Lưu ý: DevEUI/AppEUI/AppKey set trên device (Arduino), gateway chỉ cần cùng network server.

### 12.2 Join & test uplink

> Device tự join khi bật nguồn. Sau join thành công:

```
Expect:  CFLR:0:EVT:... (initial uplink AA01)
```

**Start uplink flood (gửi downlink C1 01 trên port 1):**
```
Send:    CFML:CFLR:0:AT+MSGHEX C1 01
Expect:  CFLR:0:OK:+MSGHEX: Start
         CFLR:0:OK:+MSGHEX: Done
```

> Device nhận C101 trong RX window → bắt đầu gửi uplink DD liên tục:
```
Expect:  CFLR:0:EVT:RX: port 1; RX: "DD<50_bytes_hex>"
         CFLR:0:EVT:RX: port 1; RX: "DD<50_bytes_hex>"
         ... (mỗi ~5 giây do LoRa airtime + duty cycle)
```

**Stop flood:**
```
Send:    CFML:CFLR:0:AT+MSGHEX C1 00
Expect:  CFLR:0:OK:+MSGHEX: Done
```

### 12.3 Test downlink

**Class C → device luôn lắng nghe RX2.**

**Gửi data payloads liên tục:**
```
Send:    CFML:CFLR:0:AT+MSGHEX DD 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F
Expect:  CFLR:0:OK:+MSGHEX: Done    (chờ 1-2s rồi gửi tiếp)

Send:    CFML:CFLR:0:AT+MSGHEX DD 10 11 12 13 14 15 16 17 18 19 1A 1B 1C 1D 1E 1F
Expect:  CFLR:0:OK:+MSGHEX: Done
... (lặp lại)
```

> LoRa airtime limit: mỗi gói DR3 ~200ms airtime → ~5 gói/s max lý thuyết
> Thực tế do duty cycle + 1% rule: ~1 gói mỗi vài giây

### 12.4 Request stats

```
Send:    CFML:CFLR:0:AT+MSGHEX C3 01
Expect:  CFLR:0:OK:+MSGHEX: Done

         (device gửi uplink C2 LL LL HH HH)
Expect:  CFLR:0:EVT:RX: port 1; RX: "C2<4_bytes_hex>"
         → Parse: bytesRx(u16LE) + bytesTx(u16LE)
```

### 12.5 Tính throughput

```
LoRa BW rất thấp — đo bằng B/s (KHÔNG phải KB/s):
DR0 (SF12): ~50 B/s
DR3 (SF9):  ~170 B/s
DR5 (SF7):  ~590 B/s

Bảng Data Rate LoRaWAN AS923:
| DR | SF   | BW     | Max Payload | Bitrate (PHY) |
|----|------|--------|-------------|---------------|
| 0  | SF12 | 125kHz | 51 bytes    | 250 bps       |
| 1  | SF11 | 125kHz | 51 bytes    | 440 bps       |
| 2  | SF10 | 125kHz | 51 bytes    | 980 bps       |
| 3  | SF9  | 125kHz | 115 bytes   | 1760 bps      |
| 4  | SF8  | 125kHz | 222 bytes   | 3125 bps      |
| 5  | SF7  | 125kHz | 222 bytes   | 5470 bps      |
```

---
---

# PHẦN 4: TÓM TẮT FILE ARDUINO

## Danh sách Arduino code cho bài test

### Application Test

| File                                                | Board    | Giao thức | Loại   |
|-----------------------------------------------------|----------|-----------|--------|
| `esp32c6_ble_gatt_peripheral.ino` (có sẵn)          | ESP32-S3* | BLE GATT  | LED    |
| `esp32s3_ble_gatt_sensor.ino` (mới)                 | ESP32-S3 | BLE GATT  | Sensor |
| `esp32s3_ble_mesh_led.ino` (mới)                    | ESP32-S3 | BLE Mesh  | LED    |
| `esp32s3_ble_mesh_sensor.ino` (mới)                 | ESP32-S3 | BLE Mesh  | Sensor |
| `esp32c6_zigbee_bulb.ino` (có sẵn)                  | ESP32-C6 | Zigbee    | LED    |
| `esp32c6_zigbee_sensor.ino` (mới)                   | ESP32-C6 | Zigbee    | Sensor |
| `WioE5_Gateway_Display.ino` (có sẵn)                | Uno R4   | LoRa      | Display|

> *`esp32c6_ble_gatt_peripheral.ino`: tên file là C6 nhưng thực tế flash lên ESP32-S3

### Bandwidth Test

| File                                                | Board    | Giao thức | Service/Cluster |
|-----------------------------------------------------|----------|-----------|-----------------|
| `esp32s3_ble_gatt_bandwidth.ino` (mới)               | ESP32-S3 | BLE GATT  | 0xBB10          |
| `esp32s3_ble_mesh_bandwidth.ino` (mới)               | ESP32-S3 | BLE Mesh  | 0xBB20          |
| `esp32c6_zigbee_bandwidth.ino` (mới)                 | ESP32-C6 | Zigbee    | Temp rapid rpt  |
| `uno_r4_lora_bandwidth.ino` (mới)                    | Uno R4   | LoRa      | 0xC1/C2/DD      |

---

## Lưu ý chung

1. **FIFO queue:** Mỗi command phải chờ response/timeout trước khi gửi tiếp. Widget PHẢI implement command queue.
2. **Handle discovery:** Các `<handle_hex>` (ví dụ `002A`, `002E`) chỉ biết sau khi chạy `DISC`. Widget phải cache handle.
3. **ThingsBoard RPC timeout:** Mặc định 10000ms. Có thể tăng cho các cmd JOIN, SCAN.
4. **Hex encoding:** Tất cả data qua RPC đều ở dạng hex string (không binary).
5. **Multi-line response:** Các response nhiều dòng dùng `\x1E` (Record Separator) làm delimiter.
6. **5 màu cố định LED:** Đỏ(FF0000), Xanh lá(00FF00), Xanh dương(0000FF), Vàng(FFFF00), Trắng(FFFFFF).
