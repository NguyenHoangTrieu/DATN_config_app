# HMI Display UI Design -- TJC3224K024_011

> **Hardware:** TJC3224K024_011 -- 2.4 inch USART HMI, native 240x320, **mounted LANDSCAPE (rotated 90 deg)**
> **Canvas:** 320(W) x 240(H) after rotation
> **Protocol:** TJC USART HMI (Nextion-compatible), UART 115200 baud
> **MCU Connection:** ESP32-S3 WAN MCU -- UART2 (TX=GPIO41, RX=GPIO42), via UART switch GPIO46
> **Purpose:** Live status display (WiFi/LTE/ETH/Battery), page navigation to detail views

---

## 1. Display Specifications

| Parameter | Value |
|---|---|
| Native resolution | 240 x 320 px |
| **Canvas (after 90 deg rotation)** | **320(W) x 240(H) px -- LANDSCAPE** |
| Touch | Resistive, single-point |
| Interface | UART TTL 3.3V, 115200 baud |
| Power | 5V DC |
| Protocol | TJC USART HMI (Nextion-compatible) |
| Command terminator | 0xFF 0xFF 0xFF (3 bytes) |
| TJC Editor orientation | **Landscape (90 degrees)** |

> All coordinates use x=column (0..319), y=row (0..239) with (0,0) at top-left of landscape view.

---

## 2. Three-Tier Software Architecture

```
+-------------------------------------------------------------+
|  Application Layer   hmi_task.h / hmi_task.c               |
|  FreeRTOS RX task, mode FSM (inactive <-> active), mutex   |
+-------------------------------------------------------------+
|  Middleware Layer    hmi_display.h / hmi_display.c         |
|  TJC xstr/fill/line commands, page navigation, touch       |
+-------------------------------------------------------------+
|  BSP Layer           hmi_handler.h / hmi_handler.c         |
|  Raw UART2 driver: install/deinit/write/read_frame/drain   |
+-------------------------------------------------------------+
             | UART2 (TX=GPIO41, RX=GPIO42)
  [FSUSB42UMX-TP switch: GPIO46=0->LAN MCU  GPIO46=1->HMI LCD]
             |
      TJC3224K024_011 display (320x240 LANDSCAPE canvas)
```

---

## 3. Color Palette (RGB565 decimal values for TJC)

| Constant | RGB888 | RGB565 dec | Usage |
|---|---|---|---|
| HMI_COL_BLACK | #000000 | 0 | Page background |
| HMI_COL_WHITE | #FFFFFF | 65535 | Primary text |
| HMI_COL_GRAY | #808080 | 33808 | Secondary labels |
| HMI_COL_CYAN | #00FFFF | 2047 | Section headers |
| HMI_COL_GREEN | #00FF00 | 2016 | Connected / OK / charging |
| HMI_COL_RED | #FF0000 | 63488 | Disconnected / Error |
| HMI_COL_YELLOW | #FFFF00 | 65504 | Battery 20-49% |
| HMI_COL_ORANGE | #FF8000 | 64512 | Battery 10-19% |

---

## 4. Page Overview

| Page ID | Name | Description |
|---|---|---|
| 0 | home | Status: Battery bar, WiFi (left col), LTE (right col), ETH, nav buttons |
| 1 | pgWifi | WiFi status detail + Back button |
| 2 | pgLTE | LTE status detail + Back button |
| 3 | pgKB | Reserved (empty) |

---

## 5. Page 0: home -- Status Screen (320x240 landscape)

### 5.1 Visual Layout

```
x:  0        80      158        240      319
    +------------------------------------------+  y=0
    |DA2 GW   [========]  85%   Chrg/Idle      |  y=0..23  Title bar (black bg)
    +------------------------------------------+  y=24 (gray separator line)
    |WiFi           |||  LTE                   |  y=26..47 Section headers (CYAN)
    | * Connected   |||   * Connected          |  y=50..71 Dot + status text
    | HomeNetwork   |||   v-internet           |  y=74..91 SSID / APN
    | -65dBm PERS   |||   A7600C1 18/31       |  y=94..111 Detail row (gray)
    +------------------------------------------+  y=116 (gray separator line)
    |ETH:  * Connected    192.168.1.50         |  y=119..137 ETH row
    +------------------------------------------+  y=141 (gray separator line)
    |                                          |  y=142..171 gap
    |  [    WiFi    ]      [    LTE    ]       |  y=172..207 TJC buttons
    +------------------------------------------+  y=239
```

### 5.2 Drawing Method

All content except the two buttons is drawn by ESP32 via UART commands:

| Command | Purpose |
|---|---|
| `fill x,y,w,h,color` | Clear an area (fill with black = 0) |
| `line x1,y1,x2,y2,color` | Draw separator lines |
| `xstr x,y,w,h,font,pco,bco,xcen,ycen,sta,"text"` | Draw text at pixel position |

The two TJC button components (comp 1 and comp 2) are rendered by the display controller and trigger touch events.

### 5.3 xstr Coordinate Table (home page)

| Area | xstr call | Description |
|---|---|---|
| Title | `xstr 2,2,82,20,0,65535,0,0,1,0,"DA2 GW"` | Title text |
| Bat bar | `fill 88,6,74,12,gray` then `fill 89,7,W,10,bat_col` | Battery bar x=88..161 |
| Bat % | `xstr 166,2,50,20,0,bat_col,0,1,1,0,"85%"` | Percentage |
| Bat status | `xstr 220,2,70,20,0,col,0,0,1,0,"Chrg"` | Idle/Chrg |
| WiFi hdr | `xstr 4,27,70,20,0,cyan,0,0,1,0,"WiFi"` | Static |
| WiFi dot | `xstr 4,51,14,20,0,wifi_col,0,1,1,0,"*"` | Green/Red |
| WiFi status | `xstr 20,51,92,20,0,wifi_col,0,0,1,0,"Connected"` | Dynamic |
| WiFi SSID | `xstr 4,75,150,18,0,white,0,0,1,0,"HomeNet"` | Truncated 16 chars |
| WiFi detail | `xstr 4,97,150,18,0,gray,0,0,1,0,"-65dBm PERS"` | Signal + auth |
| LTE hdr | `xstr 162,27,70,20,0,cyan,0,0,1,0,"LTE"` | Static |
| LTE dot | `xstr 166,51,14,20,0,lte_col,0,1,1,0,"*"` | Green/Red |
| LTE status | `xstr 182,51,92,20,0,lte_col,0,0,1,0,"Connected"` | Dynamic |
| LTE APN | `xstr 166,75,150,18,0,white,0,0,1,0,"v-internet"` | Truncated 16 chars |
| LTE detail | `xstr 166,97,150,18,0,gray,0,0,1,0,"A7600C1 18/31"` | Modem + CSQ |
| ETH label | `xstr 4,120,40,18,0,cyan,0,0,1,0,"ETH:"` | Static |
| ETH dot | `xstr 48,120,14,18,0,eth_col,0,1,1,0,"*"` | Green/Red |
| ETH status | `xstr 64,120,90,18,0,eth_col,0,0,1,0,"Connected"` | Dynamic |
| ETH IP | `xstr 158,120,148,18,0,white,0,0,1,0,"192.168.1.50"` | Dynamic |

### 5.4 TJC Button Components

| Comp ID | Name | Position (x,y,w,h) | Label | Touch Release |
|---|---|---|---|---|
| **1** | `b_wifi_cfg` | 4, 172, 150, 36 | "WiFi" | `page pgWifi` |
| **2** | `b_lte_cfg` | 166, 172, 150, 36 | "LTE" | `page pgLTE` |

> Comp ID is auto-assigned in order added. Add b_wifi_cfg FIRST, b_lte_cfg SECOND.

---

## 6. Page 1: pgWifi -- WiFi Status Detail (320x240 landscape)

Content drawn by ESP32 via xstr at page load. One TJC button component:

| Comp ID | Name | Position (x,y,w,h) | Label | Touch |
|---|---|---|---|---|
| 1 | `b_back` | 4, 196, 312, 36 | "Back" | `page home` |

xstr content (drawn by `wifi_page_draw()` in Middleware):
- y=0..23: "WiFi Status" header (white, centered)
- y=28: "Status: Connected/Disconnected" (green/red)
- y=52: "SSID: ..." (white)
- y=76: "Signal: -65 dBm" (white)
- y=100: "Auth: PERSONAL" (white)
- y=148: "Configure via BLE/web app" (cyan)

---

## 7. Page 2: pgLTE -- LTE Status Detail (320x240 landscape)

Identical layout to pgWifi with LTE fields. One TJC button:

| Comp ID | Name | Position | Label | Touch |
|---|---|---|---|---|
| 1 | `b_back` | 4, 196, 312, 36 | "Back" | `page home` |

---

## 8. Page 3: pgKB -- Reserved

Empty page, no components. Reserved for future on-screen keyboard.

---

## 9. TJC Editor Project Settings

| Setting | Value |
|---|---|
| Device | TJC3224K024_011 |
| **Orientation** | **Landscape (90 deg)** |
| Canvas | 320 x 240 |
| Baud rate | 115200 |
| Background color | 0 (black) |
| Font 0 | auto-generated 16px ASCII by TJC Editor |
| Touch debounce | 30 ms (default) |

---

## 10. Files Reference

| File | Layer | Location | Purpose |
|---|---|---|---|
| hmi_handler.h | BSP | BSP/hmi_handler/include/ | UART2 hardware constants + raw hmi_bsp_* API |
| hmi_handler.c | BSP | BSP/hmi_handler/src/ | UART2 install/deinit/write/read_frame |
| hmi_display.h | Middleware | Middleware/HMI_Display/include/ | TJC protocol, colors, page IDs, hmi_status_t |
| hmi_display.c | Middleware | Middleware/HMI_Display/src/ | xstr/fill drawing, page nav, touch dispatch |
| hmi_task.h | Application | Application/HMI_Task/include/ | FreeRTOS task API + legacy shims |
| hmi_task.c | Application | Application/HMI_Task/src/ | RX task, mode FSM, thread-safe status cache |
| DA2_gateway.HMI | TJC project | HMI_Project/ | XML project file (open in TJC Editor, compile to .tft) |
