# BLE AT RGB Widget — ThingsBoard Setup Guide

Controls the ESP32-C6 RGB LED via the gateway's CFBL: AT BLE protocol
(STM32WB55 module → BLE GATT → ESP32-C6 NeoPixel LED).

---

## Widget Files

| File | ThingsBoard Tab |
|---|---|
| `ble_at_rgb_widget.html` | HTML |
| `ble_at_rgb_widget.css` | CSS |
| `ble_at_rgb_widget.js` | JavaScript |

---

## ThingsBoard Widget Setup

1. **Widgets Library** → Add new widget bundle (or open existing)
2. **Create Widget** → type: **Control widget**
3. **Advanced** tab → paste HTML / CSS / JS from corresponding files
4. **Data** tab → set **Target device** to your gateway device entity
5. **Save** and add to dashboard

> The widget uses `controlApi.sendTwoWayCommand` with `method = "sendCommand"`.
> Your gateway device must be configured to handle RPC method `sendCommand`.

---

## First-Time Setup: Get the Char Handle

The char handle for the RGB characteristic must be configured once:

### Option A — Serial Monitor (recommended for new boards)
1. Flash `ESP32_C6_BLE_LED.ino` to the ESP32-C6
2. Open Serial Monitor (115200 baud)
3. Note the printed line:
   ```
   ║  Char handle  : 0x000E  (decimal: 14    )    ║
   ```
4. Enter `14` (or your value) in the widget's **Char Handle** field

### Option B — Widget Discover
1. Connect to the device first (Scan → click ⚡)
2. Click the **🔍 Discover** button in the widget config bar
3. Read the Console at the bottom for `+CHAR:` lines containing the handle

---

## Widget Controls

| Control | Description |
|---|---|
| **Stack** dropdown | Select gateway BLE slot (S1 = slot 0, S2 = slot 1) |
| **Char Handle** field | GATT char value handle (decimal or 0x hex) — set once from Serial Monitor |
| **⟳ Scan button** | Scan for nearby BLE devices (5 seconds) |
| **⚡ Connect button** | Connect to a discovered device |
| **✕ Disconnect button** | Disconnect current device |
| **Power toggle** | ON/OFF the LED |
| **Color picker** | Pick any RGB color using HTML color input |
| **Color presets** | Quick 8-color preset buttons |
| **Brightness slider** | 0–100% brightness (applied on top of color) |
| **🔍 Discover** | Runs AT+DISC + AT+CHARS for service/char exploration |
| **Console** | Shows all sent commands and received responses |

---

## RPC Commands Used

All commands are sent as:
```json
{ "method": "sendCommand", "params": "<CFBL_COMMAND>" }
```

| Operation | RPC params |
|---|---|
| Scan | `CFBL:0:AT+SCAN=5000` |
| Connect | `CFBL:0:AT+CONNECT=AA:BB:CC:DD:EE:FF` |
| Disconnect | `CFBL:0:AT+DISCONNECT=0` |
| Discover services | `CFBL:0:AT+DISC=0` |
| Discover chars | `CFBL:0:AT+CHARS=0,1,65535` |
| LED ON, Red | `CFBL:0:AT+WRITE=0,14,01FF0000` |
| LED ON, Green | `CFBL:0:AT+WRITE=0,14,0100FF00` |
| LED ON, Blue | `CFBL:0:AT+WRITE=0,14,010000FF` |
| LED ON, White | `CFBL:0:AT+WRITE=0,14,01FFFFFF` |
| LED OFF | `CFBL:0:AT+WRITE=0,14,00000000` |

> Replace `14` with your actual char handle if different.

---

## Write Hex Format

`AT+WRITE=0,<handle>,PPRRGGGBB`

| Byte | Symbol | Meaning |
|---|---|---|
| 0 | P | `01` = ON, `00` = OFF |
| 1 | R | Red intensity, 00–FF |
| 2 | G | Green intensity, 00–FF |
| 3 | B | Blue intensity, 00–FF |

The widget automatically applies brightness scaling before sending:
```
R_actual = round(R * brightness / 100)
```

---

## Expected Response Format

Responses arrive from the gateway as:
```
CFBL:0:OK:OK\x1E+SCAN:AA:BB:CC:DD:EE:FF,-65,ESP32C6_RGB
CFBL:0:OK:OK\x1E+CONNECTING\x1E+CONNECTED:0,0x0001
CFBL:0:OK:OK
CFBL:0:FAIL:<reason>
```

Lines are separated by `\x1E` (ASCII record separator, 0x1E).

---

## Comparison: CFBL: vs CFBN: Protocol

| Feature | CFBL: (AT Module) | CFBN: (Native Mesh) |
|---|---|---|
| Hardware | STM32WB55 → UART → ESP32-C6 | ESP32-S3 direct BLE Mesh |
| Connection type | GATT Central (connectable ADV) | BLE Mesh provisioner (PB-ADV) |
| Command prefix | `CFBL:` | `CFBN:` |
| Device discovery | AT+SCAN → MAC list | CFBN:SCAN → UUID list |
| Provisioning needed | No (direct connect) | Yes (CFBN:PROVISION) |
| Target devices | Any standard BLE GATT peripheral | Tuya Mesh / BLE Mesh nodes |
| Widget | `ble_at_rgb_widget.*` | `tuya_e27_widget.*` |

Both can run simultaneously on the same gateway (different prefixes).
