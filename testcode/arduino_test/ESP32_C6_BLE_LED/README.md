# ESP32-C6 Mini — BLE RGB LED Controller

Controls the on-board WS2812B RGB LED via BLE GATT.
Compatible with the STM32WB55 AT Command Module (CFBL: gateway protocol).

---

## Hardware

| Item | Detail |
|---|---|
| Board | ESP32-C6-DevKitM-1 (or DevKitC-1) |
| RGB LED | WS2812B on **GPIO8** (1 pixel) |
| Connection | USB for power + Serial Monitor |

If your board has a plain (non-RGB) LED on GPIO8, it will only show ON/OFF (full brightness = white blink).

---

## Arduino IDE Setup

1. **Board support** — File → Preferences → Additional Boards Manager URLs:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
   Then Tools → Board Manager → install **"esp32" by Espressif**.

2. **Library** — Sketch → Include Library → Manage Libraries → install **Adafruit NeoPixel**.

3. **Board selection** — Tools → Board → **ESP32C6 Dev Module**

4. Upload `ESP32_C6_BLE_LED.ino`.

---

## BLE Service Details

| Field | Value |
|---|---|
| Device name | `ESP32C6_RGB` |
| Service UUID | `0000FFE0-0000-1000-8000-00805F9B34FB` |
| Char UUID | `0000FFE1-0000-1000-8000-00805F9B34FB` |
| Properties | READ \| WRITE \| WRITE_NR \| NOTIFY |

---

## Write Protocol (Characteristic FFE1)

### 4-byte format (PRRGGBB) — recommended

| Byte | Meaning | Range |
|---|---|---|
| 0 (P) | Power | `0x00` = OFF, `0x01` = ON |
| 1 (R) | Red | `0x00`–`0xFF` |
| 2 (G) | Green | `0x00`–`0xFF` |
| 3 (B) | Blue | `0x00`–`0xFF` |

### 1-byte format — backward-compatible

`0x00` = OFF, `0x01` = ON (color unchanged from last setting)

---

## Serial Monitor Output

After upload, open Serial Monitor at **115200 baud**:

```
================================================
  ESP32-C6 Mini — BLE RGB LED Controller
  Compatible with STM32WB55 AT Command Module
================================================

[LED] NeoPixel init on GPIO8, 1 pixel(s), brightness=40
[BLE] Advertising started as: ESP32C6_RGB

╔══════════════════════════════════════════════╗
║         GATT Handle Reference                ║
╠══════════════════════════════════════════════╣
║  Service UUID : 0000ffe0-0000-1000-8000-...  ║
║  Char UUID    : 0000ffe1-0000-1000-8000-...  ║
║  Char handle  : 0x000E  (decimal: 14    )    ║
║  CCCD handle  : 0x000F  (decimal: 15    )    ║
╚══════════════════════════════════════════════╝

── AT command examples (replace <handle> with decimal above) ──
[CMD] AT+WRITE=0,14,01FF0000   → ON,  Red
[CMD] AT+WRITE=0,14,0100FF00   → ON,  Green
...
```

> **Note the `Char handle` value** — you need it for AT+WRITE and the ThingsBoard widget.
> The value is typically `14` (0x000E) but may differ by ESP-IDF / Arduino BLE version.

---

## AT Command Test Sequence

```
AT+SCAN=5000
→ OK
→ +SCAN:AA:BB:CC:DD:EE:FF,-65,ESP32C6_RGB
→ (more devices within timeout)

AT+CONNECT=AA:BB:CC:DD:EE:FF
→ OK
→ +CONNECTING
→ +CONNECTED:0,0x0001

AT+DISC=0
→ OK
(service/char events follow via listener task)

AT+CHARS=0,1,65535
→ OK
(char events follow → note handle value, e.g. 14)

AT+WRITE=0,14,01FF0000     ← ON, Red
→ OK

AT+WRITE=0,14,0100FF00     ← ON, Green
→ OK

AT+WRITE=0,14,010000FF     ← ON, Blue
→ OK

AT+WRITE=0,14,01FFFFFF     ← ON, White
→ OK

AT+WRITE=0,14,00000000     ← OFF
→ OK
```

---

## CFBL: Gateway RPC Examples (ThingsBoard)

```
CFBL:0:AT+SCAN=5000
CFBL:0:AT+CONNECT=AA:BB:CC:DD:EE:FF
CFBL:0:AT+WRITE=0,14,01FF0000   → ON, Red
CFBL:0:AT+WRITE=0,14,01FFFFFF   → ON, White
CFBL:0:AT+WRITE=0,14,00000000   → OFF
```

See `ble_at_rgb_widget.*` in `DATN_config_app/thingsboard_tuya_widget/` for the full ThingsBoard widget.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| No BLE advertising | Check board = ESP32C6 Dev Module, re-upload |
| RGB not lighting up | Confirm NeoPixel library installed; check GPIO8 is the correct pin for your variant |
| AT+WRITE gives `+ERROR:INVALID_HEX` | Ensure hex string is 2, 8 characters (no spaces, no `0x`) |
| Wrong color | Swap R/G/B order — some boards use NEO_RGB instead of NEO_GRB; change in `Adafruit_NeoPixel strip(...)` constructor |
| `getHandle()` crashes at compile | Upgrade to esp32 Arduino board package ≥ 2.0.14 |
