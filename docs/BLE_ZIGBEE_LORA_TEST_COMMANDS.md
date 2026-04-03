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

## 2. BLE Native Mesh (`CFBN:`)

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

## 3. Zigbee via E18-ZG120B (`CFZB:`)

> E180-ZG120B is an Ebyte Zigbee 3.0 coordinator/router module with AT command interface (115200 baud).
> The gateway Zigbee handler forwards AT commands directly to the module via UART.
> Command format: `CFML:CFZB:<slot>:AT+<command> <params>`

### 3.1 Get device information

```
Send:    CFML:CFZB:0:AT+INFO?
Expect:  +INFO: TYPE=Router
         MAC=0xHHHHHHHHHHHHHHHH
         [PANID=0xHHHH, CHANNEL=11, ADDR=0xHHHH] (if networked)
```

### 3.2 Software reset

```
Send:    CFML:CFZB:0:AT+RESET
Expect:  +RESET: OK
         BOOT=0\r\nVERSION=...
```

### 3.3 Factory reset (erase all settings)

```
Send:    CFML:CFZB:0:AT+RESTORE
Expect:  +RESTORE:0
         (module restarts)
```

### 3.4 Start network (coordinator creates, end-device/router joins)

```
Send:    CFML:CFZB:0:AT+CREATENW
Expect:  +CREATENW:0
         NET:JOIN (when coordinator establishes)
         NETOPEN:180-Sec (coordinator permits join for 180s)
```

### 3.5 Stop network (coordinator stops accepting joins)

```
Send:    CFML:CFZB:0:AT+QUITNW
Expect:  +QUITNW:0
         NETCLOSE
```

### 3.6 Leave network (node exits current network)

```
Send:    CFML:CFZB:0:AT+LEAVE
Expect:  +LEAVE: OK
         BOOT=0
```

### 3.7 Get network status

```
Send:    CFML:CFZB:0:AT+NWINFO
Expect:  +NWINFO: TYPE=Router, MAC=0x..., PANID=0xHHHH, CHANNEL=11, ADDR=0xHHHH
         (or +NWINFO: NO NET if not networked)
```

### 3.8 Set channel

```
Send:    CFML:CFZB:0:AT+CH=11
Expect:  +CH:0
```

### 3.9 Set PAN ID

```
Send:    CFML:CFZB:0:AT+PANID=0x1234
Expect:  +PANID:0
```

### 3.10 Set TX power

```
Send:    CFML:CFZB:0:AT+POWER=20
Expect:  +POWER:0
```

### 3.11 Open network for joining (permit join window)

```
Send:    CFML:CFZB:0:AT+OPENWNET=60
         (60 seconds permit join)
Expect:  +OPENWNET:0
         JOIN:MAC=0xHHHHHHHHHHHHHHHH  (when end-device joins)
         NODE:MAC=0x..., ADDR=0xHHHH  (node assigned short address)
```

### 3.12 Query short address from IEEE address

```
Send:    CFML:CFZB:0:AT+QUERYSHORT=0xAABBCCDDEEFF0011
Expect:  +QUERYSHORT:0x1234
```

### 3.13 Get simple descriptor (for device endpoints/clusters)

```
Send:    CFML:CFZB:0:AT+SIMPLEDESC=0x1234,01
         (short_addr, endpoint)
Expect:  +SIMPLEDESC: clusters...
```

### 3.14 Delete node from network

```
Send:    CFML:CFZB:0:AT+ENTDEL=0x1234
Expect:  +ENTDEL:0
         LEAVE:MAC=0xHHHH...  (node removed)
```

### 3.15 Read Zigbee attribute

```
Send:    CFML:CFZB:0:AT+ATTRREAD=0x1234,01,0006,0000
         (short_addr, endpoint, cluster_hex, attr_hex)
Expect:  +ATTRREAD: <value>
         RPT:0x1234-01 ONOFF=0|1  (async attribute value)
```

### 3.16 Write Zigbee attribute

```
Send:    CFML:CFZB:0:AT+ATTRWRITE=0x1234,01,0006,0000,10,01
         (short_addr, endpoint, cluster, attr, type, value)
Expect:  +ATTRWRITE:0
         RSP:0x1234-01 ONOFF:SUCCESS|ERROR
```

### 3.17 Send ZCL command (On/Off, Level, etc.)

```
Send:    CFML:CFZB:0:AT+ZCL=0x1234,01,0006,01
         (short_addr, endpoint, cluster, cmd_id)
Expect:  +ZCL:0
         RSP:0x1234-01 ONOFF:SUCCESS|ERROR
```

### 3.18 Configure attribute reporting

```
Send:    CFML:CFZB:0:AT+CONFREPORT=0x1234,01,0402,0000,29,0001,003C,0064
         (short, ep, cluster, attr, type, min_s, max_s, change)
Expect:  +CONFREPORT:0
```

### 3.19 Send unicast data

```
Send:    CFML:CFZB:0:AT+SENDDATA=0x1234,01,0000,48656C6C6F
         (short_addr, ep, cluster, hex_data)
Expect:  +SENDDATA:0
```

### 3.20 Send broadcast

```
Send:    CFML:CFZB:0:AT+BROADCAST=0000,DEADBEEF
         (cluster, hex_data)
Expect:  +BROADCAST:0
```

### 3.21 Turn on remote switch

```
Send:    CFML:CFZB:0:AT+TURNON=0
         (bound device index)
Expect:  +TURNON:0|FAIL
```

### 3.22 Turn off remote switch

```
Send:    CFML:CFZB:0:AT+TURNOFF=0
Expect:  +TURNOFF:0|FAIL
```

### 3.23 Set device type

```
Send:    CFML:CFZB:0:AT+DEVTYPE=1
         (0=Coordinator, 1=Router, 2=End-Device, 3=Sleepy-End-Device)
Expect:  OK (requires reset to take effect)
```

### 3.24 Auto-find target (peer discovery)

```
Send:    CFML:CFZB:0:AT+FIND
Expect:  +FIND: ADDR=0x1234 EP=01 cluster=0xFC08 (transparent mode device)
         +FIND: ADDR=0x5678 EP=01 cluster=0x0006 (on/off light)
         +FIND: MISS (if not found)
```

### Typical Zigbee coordinator test flow

```
1.  CFML:CFZB:0:AT+RESET                         — restart module
2.  CFML:CFZB:0:AT+INFO?                         — verify device type
3.  CFML:CFZB:0:AT+DEVTYPE=0                    — set as coordinator (if needed)
4.  CFML:CFZB:0:AT+CH=11                         — set channel
5.  CFML:CFZB:0:AT+PANID=0x1234                  — set PAN ID
6.  CFML:CFZB:0:AT+CREATENW                      — start coordinator + network
    [ observe: NET:JOIN, NETOPEN:180-Sec ]
7.  CFML:CFZB:0:AT+NWINFO                        — verify network active
8.  CFML:CFZB:0:AT+OPENWNET=60                   — allow devices to join
    [ Power on E18 end-device, observe: JOIN:MAC=0x..., NODE:... ]
9.  CFML:CFZB:0:AT+QUERYSHORT=0xAABBCCDDEEFF0011 — get device short addr
10. CFML:CFZB:0:AT+SIMPLEDESC=0x1234,01         — get endpoints/clusters
11. CFML:CFZB:0:AT+ATTRREAD=0x1234,01,0006,0000 — read OnOff attribute
12. CFML:CFZB:0:AT+ATTRWRITE=0x1234,01,0006,0000,10,01 — write ON
    [ observe: RSP:0x1234-01 ONOFF:SUCCESS ]
13. CFML:CFZB:0:AT+ZCL=0x1234,01,0006,01        — send ZCL toggle
14. CFML:CFZB:0:AT+CONFREPORT=0x1234,01,0006,0000,10,0001,003C,0001
    [ observe periodic: RPT:0x1234-01 ONOFF=<0|1> ]
```

---

## 4. LoRa WioE5 mini (`CFLR:`)

> WioE5 is a Seeed LoRaWAN module with Semtech SX1262 chipset.
> The gateway LoRa handler forwards AT commands directly to the module via UART (9600 baud).
> Command format: `CFML:CFLR:<slot>:<AT+command> <params>`
> Responses and async events arrive from the module and are echoed back to UART.

### 4.1 Get firmware version

```
Send:    CFML:CFLR:0:AT+VER
Expect:  +VER: <version_string>
```

### 4.2 Software reset

```
Send:    CFML:CFLR:0:AT+RESET
Expect:  +RESET: OK
```

### 4.3 Factory reset (erase all settings)

```
Send:    CFML:CFLR:0:AT+FDEFAULT
Expect:  +FDEFAULT: OK
         (module restarts after reset)
```

### 4.4 Set region/band

```
Send:    CFML:CFLR:0:AT+DR AS923
         (Valid: AS923, AU915, CN470, EU868, IN865, KR920, US915, RU864)
Expect:  +DR: AS923
```

### 4.5 Set LoRaWAN class

```
Send:    CFML:CFLR:0:AT+CLASS A
         (Valid: A, B, C)
Expect:  +CLASS: A
```

### 4.6 Set join mode

```
Send:    CFML:CFLR:0:AT+MODE OTAA
         (Valid: OTAA, ABP)
Expect:  +MODE: OTAA
```

### 4.7 Set DevEUI

```
Send:    CFML:CFLR:0:AT+ID DevEui,0011223344556677
Expect:  +ID: DevEui, 0011223344556677
```

### 4.8 Get DevEUI

```
Send:    CFML:CFLR:0:AT+ID DevEui
Expect:  +ID: DevEui, 0011223344556677
```

### 4.9 Set AppEUI / JoinEUI (OTAA only)

```
Send:    CFML:CFLR:0:AT+ID AppEui,0000000000000001
Expect:  +ID: AppEui, 0000000000000001
```

### 4.10 Set AppKey (OTAA only, 32 hex chars = 16 bytes)

```
Send:    CFML:CFLR:0:AT+KEY APPKEY,00112233445566778899AABBCCDDEEFF
Expect:  +KEY: APPKEY, 00112233445566778899AABBCCDDEEFF
```

### 4.11 Set DevAddr (ABP only, 8 hex chars = 4 bytes)

```
Send:    CFML:CFLR:0:AT+ID DevAddr,01020304
Expect:  +ID: DevAddr, 01020304
```

### 4.12 Get DevAddr

```
Send:    CFML:CFLR:0:AT+ID DevAddr
Expect:  +ID: DevAddr, 01020304
```

### 4.13 Set NwkSKey (ABP only)

```
Send:    CFML:CFLR:0:AT+KEY NWKSKEY,00112233445566778899AABBCCDDEEFF
Expect:  +KEY: NWKSKEY, ...
```

### 4.14 Set AppSKey (ABP only)

```
Send:    CFML:CFLR:0:AT+KEY APPSKEY,FFEEDDCCBBAA99887766554433221100
Expect:  +KEY: APPSKEY, ...
```

### 4.15 Join network (OTAA, waits up to 30 s)

```
Send:    CFML:CFLR:0:AT+JOIN
Expect:  +JOIN: Start
         +JOIN: NORMAL
         +JOIN: Network joined
         +JOIN: Done
         (or +JOIN: Join failed if no network)
```

### 4.16 Set transmit power

```
Send:    CFML:CFLR:0:AT+POWER 14
Expect:  +POWER: 14
```

### 4.17 Set data rate

```
Send:    CFML:CFLR:0:AT+DR DR3
         (DR0=SF12/125k → DR5=SF7/125k for AS923)
Expect:  +DR: DR3
```

### 4.18 Enable/disable adaptive data rate (ADR)

```
Send:    CFML:CFLR:0:AT+ADR ON
         (Valid: ON, OFF)
Expect:  +ADR: ON
```

### 4.19 Set confirmed message retry count

```
Send:    CFML:CFLR:0:AT+RETRY 3
Expect:  +RETRY: 3
```

### 4.20 Set unconfirmed message repeat count

```
Send:    CFML:CFLR:0:AT+REPT 1
Expect:  +REPT: 1
```

### 4.21 Set application port

```
Send:    CFML:CFLR:0:AT+PORT 10
         (Valid: 1–223)
Expect:  +PORT: 10
```

### 4.22 Set channel

```
Send:    CFML:CFLR:0:AT+CH NUM,0-7
Expect:  +CH: NUM, 0-7
```

### 4.23 Set RX window 2 parameters

```
Send:    CFML:CFLR:0:AT+RXWIN2 923.2,DR2
Expect:  +RXWIN2: 923.2, DR2
```

### 4.24 Set RX delay

```
Send:    CFML:CFLR:0:AT+DELAY RX1,1000
Expect:  +DELAY: RX1, 1000
```

### 4.25 Send unconfirmed uplink (ASCII string)

```
Send:    CFML:CFLR:0:AT+MSG Hello
Expect:  +MSG: Start
         +MSG: Done
         +RX1: <port>, <hex_data>  (if server sends downlink in RX window 1)
         +RX2: <port>, <hex_data>  (if server sends downlink in RX window 2)
```

### 4.26 Send confirmed uplink (waits for server ACK)

```
Send:    CFML:CFLR:0:AT+CMSG Hello
Expect:  +CMSG: Start
         +CMSG: ACK Received
         (or +CMSG: No free channel / +CMSG: Timeout on no ACK)
```

### 4.27 Send hex payload unconfirmed

```
Send:    CFML:CFLR:0:AT+MSGHEX 48656C6C6F
         (hex encoding of "Hello")
Expect:  +MSGHEX: Start
         +MSGHEX: Done
```

### 4.28 Send hex payload confirmed

```
Send:    CFML:CFLR:0:AT+CMSGHEX 48656C6C6F
Expect:  +CMSGHEX: Start
         +CMSGHEX: ACK Received
```

### 4.29 Check maximum payload length for current DR

```
Send:    CFML:CFLR:0:AT+LW LEN
Expect:  +LW: LEN, <max_bytes>
```

### 4.30 Read supply voltage

```
Send:    CFML:CFLR:0:AT+VDD
Expect:  +VDD: <millivolts>
```

### 4.31 Enter low-power sleep mode

```
Send:    CFML:CFLR:0:AT+LOWPOWER
Expect:  LOWPOWER SLEEP
         (wake on UART activity → LOWPOWER WAKEUP)
```

### 4.32 Enable auto low-power after TX/RX

```
Send:    CFML:CFLR:0:AT+LOWPOWER AUTOON
```

### 4.33 Disable auto low-power

```
Send:    CFML:CFLR:0:AT+LOWPOWER AUTOOFF
```

### Typical LoRa OTAA test flow

```
1.  CFML:CFLR:0:AT+RESET                                       — restart module
2.  CFML:CFLR:0:AT+VER                                         — verify firmware
3.  CFML:CFLR:0:AT+DR AS923                                    — set region
4.  CFML:CFLR:0:AT+CLASS A                                     — Class A
5.  CFML:CFLR:0:AT+MODE OTAA                                   — OTAA mode
6.  CFML:CFLR:0:AT+ID DevEui,0011223344556677                  — DevEUI
7.  CFML:CFLR:0:AT+ID AppEui,0000000000000001                  — AppEUI
8.  CFML:CFLR:0:AT+KEY APPKEY,00112233445566778899AABBCCDDEEFF — AppKey
9.  CFML:CFLR:0:AT+ADR ON                                      — enable ADR
10. CFML:CFLR:0:AT+JOIN                                        — join (wait up to 30 s)
    [ observe: +JOIN: Network joined ]
11. CFML:CFLR:0:AT+PORT 10                                     — set port
12. CFML:CFLR:0:AT+MSG HelloWorld                              — send uplink
    [ observe: +MSG: Done, optionally +RX1/+RX2 for downlink ]
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
