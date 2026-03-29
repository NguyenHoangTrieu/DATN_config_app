# HMI Display UI Design — TJC3224K024_011RN

> **Hardware:** TJC3224K024_011RN — 2.4 inch USART HMI, 320×240 px, Resistive Touch  
> **Protocol:** TJC USART HMI (Nextion-compatible), UART 115200 baud  
> **MCU Connection:** ESP32-S3 WAN MCU — UART2 (TX=GPIO42, RX=GPIO41), via UART switch  
> **Purpose:** On-device configuration of WiFi + LTE (basic mode), live status display with battery %

---

## 1. Display Specifications

| Parameter | Value |
|---|---|
| Resolution | 320 × 240 px |
| Touch | Resistive, single-point |
| Interface | UART TTL 3.3V, 115200 baud |
| Power | 5V input |
| Protocol | TJC USART HMI (Nextion-compatible) |
| Command terminator | `0xFF 0xFF 0xFF` (3 bytes) |
| TJC Editor version | TJC Editor v1.x |

---

## 2. UART Interface to ESP32

```
ESP32 WAN MCU
  GPIO42 (UART2 TX) ───┐
                       ├──► [FSUSB42UMX-TP UART Switch] ── UART_SW1 ──► LAN MCU UART RX
  GPIO41 (UART2 RX) ◄──┘                                └─ UART_SW2 ──► LCD_3V3 TXD/RXD ──► HMI
                                │
                         UART_SEL = GPIO_NUM_46 (M_IO46)
                         LOW  (0) = Route to LAN MCU (normal / PPP / OTA)
                         HIGH (1) = Route to HMI Display (config mode)
```

`HMI_UART_SWITCH_GPIO = GPIO_NUM_46` — confirmed from schematic (`M_IO46` → `UART_SEL` of FSUSB42UMX-TP). Implemented in `DA2_esp.c` as `uart_switch_route_to_hmi()` / `uart_switch_route_to_lan_mcu()`.

---

## 3. Color Palette (RGB565 decimal values for TJC)

| Name | RGB888 | RGB565 (dec) | Usage |
|---|---|---|---|
| `COL_BG` | #000000 | **0** | Page background |
| `COL_PANEL` | #0D0D1A | **790** | Section panel background |
| `COL_TITLE_BG` | #0A1628 | **1316** | Status bar background |
| `COL_WHITE` | #FFFFFF | **65535** | Primary text |
| `COL_GRAY` | #808080 | **33808** | Secondary labels |
| `COL_CYAN` | #00BFFF | **1567** | Section headers |
| `COL_GREEN` | #00C000 | **6144** | Connected / OK |
| `COL_RED` | #FF3232 | **63494** | Disconnected / Error |
| `COL_YELLOW` | #FFBF00 | **64992** | Warning / Charging |
| `COL_ORANGE` | #FF8000 | **64512** | Battery low |
| `COL_BTN_BLUE` | #0A4FA0 | **2624** | Button normal bg |
| `COL_BTN_PRESS` | #1565C0 | **4920** | Button pressed bg |
| `COL_BTN_CANCEL` | #4A4A4A | **18728** | Cancel/Back button bg |
| `COL_SEPARATOR` | #2A2A40 | **2632** | Horizontal line color |
| `COL_INPUT_BG` | #152030 | **1380** | Text input field bg |
| `COL_INPUT_FG` | #E0E0E0 | **57083** | Text input text color |

---

## 4. Font Map

| ID | Size | Usage |
|---|---|---|
| 0 | 16 px | Small labels, hints |
| 1 | 20 px | Status text, field values |
| 2 | 24 px | Titles, section headers |

---

## 5. Page Overview

| Page ID | Page Name | Description |
|---|---|---|
| 0 | `home` | Status overview: WiFi, LTE, Ethernet, Battery %, nav buttons |
| 1 | `pgWifi` | WiFi SSID / Password / Auth config |
| 2 | `pgLTE` | LTE APN / Username / Password config |
| 3 | `pgKB` | Alphanumeric keyboard for text entry |

---

## 6. Page 0: `home` — Status Screen

### 6.1 Layout (320×240 px)

```
x:  0         80        160       240       320
    ┌─────────────────────────────────────────┐  y=0
    │ DA2 Gateway            [====] 85%       │  y=0..26  Status bar
    ├─────────────────────────────────────────┤  y=26
    │ WiFi                          (276MHz)  │  y=30..52  Section header
    │  ●  Connected        HomeNetwork        │  y=56..80  Status row
    │     Signal: ████░   Auth: PERSONAL      │  y=84..105 Detail row
    ├ · · · · · · · · · · · · · · · · · · · ·┤  y=108
    │ LTE                                     │  y=112..134 Section header
    │  ●  Connected        v-internet         │  y=138..160 Status row
    │     Modem: A7600C1  CSQ: 18/31          │  y=163..184 Detail row
    ├ · · · · · · · · · · · · · · · · · · · ·┤  y=188
    │ Ethernet                                │  y=192..210 Section header
    │  ●  Connected        192.168.1.50       │  y=214..235 Status row
    ├─────────────────────────────────────────┤  y=238
    │  [    WiFi CFG   ]    [    LTE CFG   ]  │  y=239..247 Action buttons (scrollable)
    └─────────────────────────────────────────┘  y=240
```

### 6.2 Component Table

| ID | Var Name | Type | x | y | w | h | Font | Initial Text / Value | Event |
|---|---|---|---|---|---|---|---|---|---|
| 0 | `t_title` | Text | 4 | 4 | 200 | 22 | 2 | `DA2 Gateway` | — |
| 1 | `t_bat_pct` | Text | 270 | 4 | 46 | 22 | 1 | `85%` | — |
| 2 | `j_bat` | Progress | 220 | 8 | 46 | 14 | — | val=85 | — |
| 3 | `t_wifi_hdr` | Text | 4 | 30 | 80 | 22 | 2 | `WiFi` | — |
| 4 | `t_wifi_dot` | Text | 4 | 58 | 20 | 22 | 1 | `●` | — |
| 5 | `t_wifi_status` | Text | 26 | 58 | 100 | 22 | 1 | `---` | — |
| 6 | `t_wifi_ssid` | Text | 135 | 58 | 180 | 22 | 1 | `---` | — |
| 7 | `t_wifi_detail` | Text | 26 | 84 | 289 | 20 | 0 | `Signal: ---   Auth: ---` | — |
| 8 | `t_lte_hdr` | Text | 4 | 112 | 80 | 22 | 2 | `LTE` | — |
| 9 | `t_lte_dot` | Text | 4 | 138 | 20 | 22 | 1 | `●` | — |
| 10 | `t_lte_status` | Text | 26 | 138 | 100 | 22 | 1 | `---` | — |
| 11 | `t_lte_apn` | Text | 135 | 138 | 180 | 22 | 1 | `---` | — |
| 12 | `t_lte_detail` | Text | 26 | 163 | 289 | 20 | 0 | `Modem: ---   CSQ: ---` | — |
| 13 | `t_eth_hdr` | Text | 4 | 192 | 80 | 22 | 2 | `Ethernet` | — |
| 14 | `t_eth_dot` | Text | 4 | 214 | 20 | 22 | 1 | `●` | — |
| 15 | `t_eth_status` | Text | 26 | 214 | 100 | 22 | 1 | `---` | — |
| 16 | `t_eth_ip` | Text | 135 | 214 | 180 | 22 | 1 | `---` | — |
| 17 | `b_wifi_cfg` | Button | 4 | 239 | 150 | 40 | 1 | `WiFi CFG` | → page 1 |
| 18 | `b_lte_cfg` | Button | 162 | 239 | 150 | 40 | 1 | `LTE CFG` | → page 2 |

### 6.3 Color Assignments

| Component | Background (bco) | Foreground (pco) |
|---|---|---|
| Page background | `COL_BG` | — |
| `t_title` | `COL_TITLE_BG` | `COL_WHITE` |
| `t_bat_pct` | `COL_TITLE_BG` | `COL_GREEN` → dynamic |
| `j_bat` | `COL_GRAY` (track) | `COL_GREEN` → dynamic |
| `t_wifi_hdr`, `t_lte_hdr`, `t_eth_hdr` | `COL_BG` | `COL_CYAN` |
| `t_wifi_dot`, `t_lte_dot`, `t_eth_dot` | `COL_BG` | `COL_GREEN` / `COL_RED` → dynamic |
| `t_wifi_status`, `t_lte_status`, `t_eth_status` | `COL_BG` | `COL_GREEN` / `COL_RED` → dynamic |
| `t_wifi_ssid`, `t_lte_apn`, `t_eth_ip` | `COL_BG` | `COL_WHITE` |
| `t_wifi_detail`, `t_lte_detail` | `COL_BG` | `COL_GRAY` |
| `b_wifi_cfg`, `b_lte_cfg` | `COL_BTN_BLUE` | `COL_WHITE` |

### 6.4 Battery Color Rules (firmware-side)

```c
if (soc >= 50)  → COL_GREEN  (6144)
if (soc >= 20)  → COL_YELLOW (64992)
if (soc >= 10)  → COL_ORANGE (64512)
if (soc <  10)  → COL_RED    (63494)
```

Battery bar `j_bat.val` = SoC % (0–100, from BQ27441).

---

## 7. Page 1: `pgWifi` — WiFi Configuration

### 7.1 Layout (320×240 px)

```
x:  0         80        160       240       320
    ┌─────────────────────────────────────────┐  y=0
    │ [←]  WiFi Configuration                 │  y=0..35  Header
    ├─────────────────────────────────────────┤  y=35
    │  SSID                                   │  y=40..58  Label
    │  ┌───────────────────────────────────┐  │  y=62..98
    │  │  HomeNetwork                      │  │  Input field (tap → keyboard)
    │  └───────────────────────────────────┘  │
    │  Password                               │  y=103..121 Label
    │  ┌───────────────────────────────────┐  │  y=125..161
    │  │  ********                         │  │  Input field (tap → keyboard)
    │  └───────────────────────────────────┘  │
    │  Auth Mode                              │  y=166..184 Label
    │  [ PERSONAL ▼ ]  (tap to toggle)        │  y=188..215 Toggle button
    ├─────────────────────────────────────────┤  y=218
    │  [ Cancel ]          [ ✓ Set WiFi ]     │  y=220..240 Action row
    └─────────────────────────────────────────┘  y=240
```

### 7.2 Component Table

| ID | Var Name | Type | x | y | w | h | Font | Initial Text | Event |
|---|---|---|---|---|---|---|---|---|---|
| 0 | `b_back` | Button | 4 | 4 | 40 | 28 | 1 | `←` | → page 0 |
| 1 | `t_hdr` | Text | 50 | 6 | 265 | 24 | 2 | `WiFi Configuration` | — |
| 2 | `t_ssid_lbl` | Text | 8 | 42 | 80 | 18 | 0 | `SSID` | — |
| 3 | `t_ssid_val` | xText | 8 | 62 | 302 | 36 | 1 | *(empty)* | touch → pgKB (field=SSID) |
| 4 | `t_pwd_lbl` | Text | 8 | 105 | 80 | 18 | 0 | `Password` | — |
| 5 | `t_pwd_val` | xText | 8 | 125 | 302 | 36 | 1 | *(empty, shown as `***`)* | touch → pgKB (field=PWD) |
| 6 | `t_auth_lbl` | Text | 8 | 168 | 80 | 18 | 0 | `Auth Mode` | — |
| 7 | `b_auth_toggle` | Button | 8 | 188 | 130 | 28 | 1 | `PERSONAL` | toggle PERSONAL↔ENTERPRISE |
| 8 | `b_cancel` | Button | 4 | 220 | 100 | 38 | 1 | `Cancel` | → page 0 (no save) |
| 9 | `b_set` | Button | 212 | 220 | 104 | 38 | 1 | `✓ Set WiFi` | send CFWF cmd |
| — | `va_field` | Variable | — | — | — | — | — | 0 = SSID, 1 = PWD | internal routing to KB |
| — | `va_auth` | Variable | — | — | — | — | — | 0=PERSONAL, 1=ENTERPRISE | toggle state |

> **xText note:** `xstr` component — tap opens TJC built-in keyboard overlay. After user confirms, the component's `.txt` attribute holds the entered value. ESP32 reads it via `get pgWifi.t_ssid_val.txt`.

### 7.3 Color Assignments

| Component | Background | Foreground |
|---|---|---|
| Page | `COL_BG` | — |
| Header | `COL_TITLE_BG` | `COL_WHITE` |
| `t_ssid_val`, `t_pwd_val` | `COL_INPUT_BG` | `COL_INPUT_FG` |
| `b_auth_toggle` PERSONAL | `COL_BTN_BLUE` | `COL_WHITE` |
| `b_auth_toggle` ENTERPRISE | `COL_BTN_PRESS` | `COL_YELLOW` |
| `b_set` | `COL_GREEN` (6144) | `COL_WHITE` |
| `b_cancel` | `COL_BTN_CANCEL` | `COL_WHITE` |

---

## 8. Page 2: `pgLTE` — LTE Configuration

### 8.1 Layout (320×240 px)

```
x:  0         80        160       240       320
    ┌─────────────────────────────────────────┐  y=0
    │ [←]  LTE Configuration                  │  y=0..35  Header
    ├─────────────────────────────────────────┤  y=35
    │  APN                                    │  y=38..55  Label
    │  ┌───────────────────────────────────┐  │  y=58..88  Input field
    │  │  v-internet                       │  │
    │  └───────────────────────────────────┘  │
    │  Username  (optional)                   │  y=94..110 Label
    │  ┌───────────────────────────────────┐  │  y=113..143 Input field
    │  │                                   │  │
    │  └───────────────────────────────────┘  │
    │  Password  (optional)                   │  y=149..165 Label
    │  ┌───────────────────────────────────┐  │  y=168..198 Input field
    │  │  ******                           │  │
    │  └───────────────────────────────────┘  │
    ├─────────────────────────────────────────┤  y=202
    │  [ Cancel ]          [ ✓ Set LTE ]      │  y=204..240 Action row
    └─────────────────────────────────────────┘  y=240
```

### 8.2 Component Table

| ID | Var Name | Type | x | y | w | h | Font | Initial Text | Event |
|---|---|---|---|---|---|---|---|---|---|
| 0 | `b_back` | Button | 4 | 4 | 40 | 28 | 1 | `←` | → page 0 |
| 1 | `t_hdr` | Text | 50 | 6 | 265 | 24 | 2 | `LTE Configuration` | — |
| 2 | `t_apn_lbl` | Text | 8 | 40 | 120 | 18 | 0 | `APN` | — |
| 3 | `t_apn_val` | xText | 8 | 58 | 302 | 32 | 1 | `internet` | touch → pgKB (field=APN) |
| 4 | `t_user_lbl` | Text | 8 | 95 | 180 | 18 | 0 | `Username  (optional)` | — |
| 5 | `t_user_val` | xText | 8 | 113 | 302 | 32 | 1 | *(empty)* | touch → pgKB (field=USER) |
| 6 | `t_pwd_lbl` | Text | 8 | 150 | 180 | 18 | 0 | `Password  (optional)` | — |
| 7 | `t_pwd_val` | xText | 8 | 168 | 302 | 32 | 1 | *(empty, shown as `***`)* | touch → pgKB (field=PWD) |
| 8 | `b_cancel` | Button | 4 | 204 | 100 | 36 | 1 | `Cancel` | → page 0 |
| 9 | `b_set` | Button | 212 | 204 | 104 | 36 | 1 | `✓ Set LTE` | send CFLT cmd |

### 8.3 Hidden Defaults (set by firmware on page load)

The modem name, comm type, power pin, reset pin, and reconnect settings are **not shown** on the HMI — they use the same defaults as basic mode in the PC app:

| Parameter | Default Value | Source |
|---|---|---|
| Modem name | From WAN stack ID map | ESP32 sends on `page 2` event |
| Comm type | `USB` | Hardcoded in firmware |
| Auto reconnect | `true` | Hardcoded |
| Reconnect timeout | `30000` ms | Hardcoded |
| Max retry | `0` | Hardcoded |
| Power pin | `05` | New board default (P05) |
| Reset pin | `06` | New board default (P06) |

---

## 9. Page 3: `pgKB` — Alphanumeric Keyboard

### 9.1 Layout (320×240 px)

```
x:  0         80        160       240       320
    ┌─────────────────────────────────────────┐  y=0
    │  ┌───────────────────────────┐  [✓]     │  y=4..36   Input preview + confirm
    │  │  HomeNetwork_             │          │
    │  └───────────────────────────┘          │
    ├─────────────────────────────────────────┤  y=40
    │  q  w  e  r  t  y  u  i  o  p   [⌫]   │  y=44..82  Row 1
    │  a  s  d  f  g  h  j  k  l  ;         │  y=86..124 Row 2
    │  z  x  c  v  b  n  m  .  -  @   [↑]   │  y=128..166 Row 3
    │ [123]     [       SPACE       ]  [✗]   │  y=170..208 Bottom row
    └─────────────────────────────────────────┘  y=212..240 (padding)
```

### 9.2 Keyboard Layout

**Row 1 (y=44, key h=36, key w=28, gap=1):**  
`q w e r t y u i o p [⌫]`  
x positions: 2, 31, 60, 89, 118, 147, 176, 205, 234, 263, 289

**Row 2 (y=86, key h=36):**  
`a s d f g h j k l ;`  
x positions: 16, 45, 74, 103, 132, 161, 190, 219, 248, 277

**Row 3 (y=128, key h=36):**  
`z x c v b n m . - @  [↑ Shift]`  
x positions: 2, 31, 60, 89, 118, 147, 176, 205, 234, 263, 289

**Bottom row (y=170, key h=36):**  
`[123/ABC]` (x=2, w=58) | `[SPACE]` (x=62, w=194) | `[✗ Cancel]` (x=258, w=58)

### 9.3 Number/Symbol Mode (toggled by [123])

**Row 1:** `1  2  3  4  5  6  7  8  9  0  [⌫]`  
**Row 2:** `!  @  #  $  %  ^  &  *  (  )`  
**Row 3:** `-  _  =  +  [  ]  {  }  /  \   [↑]`  
**Bottom:** `[ABC]` | `[SPACE]` | `[✗]`

### 9.4 Component Table (Key Buttons)

All key buttons follow this structure — 44 total letter/symbol buttons + 6 control buttons:

| Name pattern | Type | Event |
|---|---|---|
| `b_k_X` (letter key) | Button | Append char to `t_input.txt`, update preview |
| `b_ctrl_bs` | Button | Backspace: remove last char from `t_input.txt` |
| `b_ctrl_shift` | Button | Toggle uppercase, redraw labels |
| `b_ctrl_123` | Button | Toggle num/symbol mode, redraw labels |
| `b_ctrl_space` | Button | Append space to `t_input.txt` |
| `b_ctrl_ok` | Button | Confirm: send `0x86 [field_id] 0xFF 0xFF 0xFF` to ESP32 |
| `b_ctrl_cancel` | Button | Cancel: → return to calling page (va_caller) |

### 9.5 Routing Variables

| Variable | Name | Purpose |
|---|---|---|
| `va_caller` | Calling page ID | 1 = pgWifi, 2 = pgLTE |
| `va_field` | Field being edited | 0=SSID, 1=WiFi-PWD, 2=APN, 3=LTE-USER, 4=LTE-PWD |
| `t_input` | Current input text | Input buffer, max 64 chars |

> **Firmware flow for keyboard:**
> 1. ESP32 receives touch event on an `xText` field  
> 2. ESP32 sends: `pgKB.va_caller.val=1\xFF\xFF\xFF` + `pgKB.va_field.val=0\xFF\xFF\xFF` + `pgKB.t_input.txt="current_value"\xFF\xFF\xFF`  
> 3. ESP32 sends: `page pgKB\xFF\xFF\xFF`  
> 4. User types and taps [✓]  
> 5. TJC sends confirm event: `0x65 0x03 [b_ctrl_ok_id] 0x01 0xFF 0xFF 0xFF`  
> 6. ESP32 reads result: `get pgKB.t_input.txt\xFF\xFF\xFF`  
> 7. TJC responds: `0x70 [string] 0xFF 0xFF 0xFF`  
> 8. ESP32 navigates back: `page pgWifi\xFF\xFF\xFF` or `page pgLTE\xFF\xFF\xFF`  
> 9. ESP32 writes result to calling field: `pgWifi.t_ssid_val.txt="HomeNetwork"\xFF\xFF\xFF`

---

## 10. ESP32 Firmware UART Protocol

### 10.1 Constants and Terminator

```c
// In hmi_handler.h
#define HMI_UART_BAUD        115200
#define HMI_UART_NUM         UART_NUM_2          // shared with LAN MCU via switch
#define HMI_UART_SWITCH_GPIO GPIO_NUM_46         // UART_SEL: 0=LAN MCU, 1=HMI LCD
#define HMI_TERM             "\xFF\xFF\xFF"      // 3-byte command terminator

// Page IDs
#define HMI_PAGE_HOME        0
#define HMI_PAGE_WIFI        1
#define HMI_PAGE_LTE         2
#define HMI_PAGE_KB          3

// Touch event header
#define HMI_EVT_TOUCH        0x65
#define HMI_EVT_STRING       0x70
#define HMI_EVT_NUMBER       0x71
#define HMI_EVT_STARTUP      0x88
#define HMI_EVT_PAGE_CHANGE  0x66
```

### 10.2 Display Update Commands (ESP32 → Display)

```c
// Navigate to page
hmi_send("page home");              // go to status page
hmi_send("page pgWifi");            // go to WiFi config page

// Set text component
hmi_send("home.t_wifi_ssid.txt=\"HomeNetwork\"");
hmi_send("home.t_lte_apn.txt=\"v-internet\"");
hmi_send("home.t_eth_ip.txt=\"192.168.1.50\"");

// Set colored dot (connected = GREEN=6144, disconnected = RED=63494)
hmi_send("home.t_wifi_dot.pco=6144");    // green
hmi_send("home.t_wifi_status.txt=\"Connected\"");
hmi_send("home.t_wifi_status.pco=6144");

// Ethernet dot and status
hmi_send("home.t_eth_dot.pco=6144");     // green if connected
hmi_send("home.t_eth_status.txt=\"Connected\"");
hmi_send("home.t_eth_status.pco=6144");

// Battery percentage
hmi_send("home.j_bat.val=85");           // progress bar 0..100
hmi_send("home.t_bat_pct.txt=\"85%\"");
hmi_send("home.t_bat_pct.pco=6144");     // green at 85%
```

### 10.3 Full Status Refresh Sequence (every 30 seconds or on change)

```c
void hmi_refresh_status(const hmi_status_t *s) {
    // Battery
    char buf[32];
    snprintf(buf, sizeof(buf), "home.j_bat.val=%u", s->bat_soc);
    hmi_send(buf);
    snprintf(buf, sizeof(buf), "home.t_bat_pct.txt=\"%u%%\"", s->bat_soc);
    hmi_send(buf);
    uint16_t bat_color = s->bat_soc >= 50 ? 6144 :
                         s->bat_soc >= 20 ? 64992 :
                         s->bat_soc >= 10 ? 64512 : 63494;
    snprintf(buf, sizeof(buf), "home.t_bat_pct.pco=%u", bat_color);
    hmi_send(buf);
    snprintf(buf, sizeof(buf), "home.j_bat.pco=%u", bat_color);
    hmi_send(buf);

    // WiFi
    uint16_t wifi_col = s->wifi_connected ? 6144 : 63494;
    snprintf(buf, sizeof(buf), "home.t_wifi_dot.pco=%u", wifi_col);
    hmi_send(buf);
    hmi_send(s->wifi_connected
        ? "home.t_wifi_status.txt=\"Connected\""
        : "home.t_wifi_status.txt=\"Disconnected\"");
    snprintf(buf, sizeof(buf), "home.t_wifi_status.pco=%u", wifi_col);
    hmi_send(buf);
    snprintf(buf, sizeof(buf), "home.t_wifi_ssid.txt=\"%s\"",
             s->wifi_connected ? s->wifi_ssid : "---");
    hmi_send(buf);
    snprintf(buf, sizeof(buf),
             "home.t_wifi_detail.txt=\"Signal: %s   Auth: %s\"",
             s->wifi_rssi_str, s->wifi_auth);
    hmi_send(buf);

    // LTE
    uint16_t lte_col = s->lte_connected ? 6144 : 63494;
    snprintf(buf, sizeof(buf), "home.t_lte_dot.pco=%u", lte_col);
    hmi_send(buf);
    hmi_send(s->lte_connected
        ? "home.t_lte_status.txt=\"Connected\""
        : "home.t_lte_status.txt=\"Disconnected\"");
    snprintf(buf, sizeof(buf), "home.t_lte_status.pco=%u", lte_col);
    hmi_send(buf);
    snprintf(buf, sizeof(buf), "home.t_lte_apn.txt=\"%s\"",
             strlen(s->lte_apn) > 0 ? s->lte_apn : "---");
    hmi_send(buf);
    snprintf(buf, sizeof(buf),
             "home.t_lte_detail.txt=\"Modem: %s  CSQ: %s\"",
             s->lte_modem, s->lte_csq_str);
    hmi_send(buf);

    // Ethernet
    uint16_t eth_col = s->eth_connected ? 6144 : 63494;
    snprintf(buf, sizeof(buf), "home.t_eth_dot.pco=%u", eth_col);
    hmi_send(buf);
    hmi_send(s->eth_connected
        ? "home.t_eth_status.txt=\"Connected\""
        : "home.t_eth_status.txt=\"Disconnected\"");
    snprintf(buf, sizeof(buf), "home.t_eth_status.pco=%u", eth_col);
    hmi_send(buf);
    snprintf(buf, sizeof(buf), "home.t_eth_ip.txt=\"%s\"",
             strlen(s->eth_ip) > 0 ? s->eth_ip : "---");
    hmi_send(buf);
}
```

### 10.4 WiFi Config Submit (triggered by b_set touch event on pgWifi)

```c
void hmi_submit_wifi(void) {
    char ssid[64] = {0}, pwd[64] = {0}, auth[16] = "PERSONAL";

    // Read SSID from display
    hmi_send("get pgWifi.t_ssid_val.txt");
    hmi_read_string(ssid, sizeof(ssid));   // blocks, reads 0x70 response

    // Read password
    hmi_send("get pgWifi.t_pwd_val.txt");
    hmi_read_string(pwd, sizeof(pwd));

    // Read auth mode from va_auth variable
    hmi_send("get pgWifi.va_auth.val");
    uint32_t auth_val = 0;
    if (auth_val == 1) strcpy(auth, "ENTERPRISE");

    // Build and send CFWF command (same as basic_panel._set_wifi_config)
    char cmd[256];
    snprintf(cmd, sizeof(cmd), "CFWF:%s:%s:%s", ssid, pwd, auth);
    gateway_uart_send(cmd);                // send to gateway via LAN MCU UART

    // Navigate back to home
    hmi_send("page home");
}
```

**Gateway commands sent (match PC app basic mode):**
```
CFWF:<SSID>:<PASSWORD>:<AUTH_MODE>
CFIN:WIFI       (sent 1 second after CFWF)
```

### 10.5 LTE Config Submit (triggered by b_set touch event on pgLTE)

```c
void hmi_submit_lte(void) {
    char apn[64] = {0}, user[64] = {0}, pwd[64] = {0};

    hmi_send("get pgLTE.t_apn_val.txt");
    hmi_read_string(apn, sizeof(apn));

    hmi_send("get pgLTE.t_user_val.txt");
    hmi_read_string(user, sizeof(user));

    hmi_send("get pgLTE.t_pwd_val.txt");
    hmi_read_string(pwd, sizeof(pwd));

    // Build CFLT command (basic mode: fixed defaults from new board)
    // CFLT:MODEM:APN:USER:PASS:COMM:RECONNECT:TIMEOUT:MAX_RETRY:PWR_PIN:RST_PIN
    char cmd[256];
    snprintf(cmd, sizeof(cmd),
             "CFLT:%s:%s:%s:%s:USB:true:30000:0:05:06",
             s_hmi_lte_modem,   // set by firmware from detected WAN stack ID
             apn, user, pwd);
    gateway_uart_send(cmd);

    // Navigate back
    hmi_send("page home");
}
```

**Gateway commands sent:**
```
CFLT:<modem>:<apn>:<user>:<pass>:USB:true:30000:0:05:06
CFIN:LTE        (sent 1 second after CFLT)
```

### 10.6 Touch Event Parsing

```c
// TJC touch event format: 0x65 [page] [comp] [event] 0xFF 0xFF 0xFF
typedef struct {
    uint8_t page;       // page ID
    uint8_t component;  // component ID
    uint8_t event;      // 0x01=press, 0x00=release
} hmi_touch_event_t;

void hmi_handle_touch(const hmi_touch_event_t *e) {
    if (e->event != 0x01) return;  // only process press

    if (e->page == HMI_PAGE_HOME) {
        if (e->component == 13) hmi_send("page pgWifi");   // b_wifi_cfg
        if (e->component == 14) hmi_send("page pgLTE");    // b_lte_cfg
    }
    else if (e->page == HMI_PAGE_WIFI) {
        if (e->component == 0)  hmi_send("page home");     // b_back
        if (e->component == 8)  hmi_send("page home");     // b_cancel
        if (e->component == 9)  hmi_submit_wifi();         // b_set
        if (e->component == 7)  hmi_toggle_auth_mode();    // b_auth_toggle
        if (e->component == 3)  hmi_open_kb(HMI_PAGE_WIFI, 0); // t_ssid_val
        if (e->component == 5)  hmi_open_kb(HMI_PAGE_WIFI, 1); // t_pwd_val
    }
    else if (e->page == HMI_PAGE_LTE) {
        if (e->component == 0)  hmi_send("page home");     // b_back
        if (e->component == 8)  hmi_send("page home");     // b_cancel
        if (e->component == 9)  hmi_submit_lte();          // b_set
        if (e->component == 3)  hmi_open_kb(HMI_PAGE_LTE, 2); // t_apn_val
        if (e->component == 5)  hmi_open_kb(HMI_PAGE_LTE, 3); // t_user_val
        if (e->component == 7)  hmi_open_kb(HMI_PAGE_LTE, 4); // t_pwd_val
    }
    else if (e->page == HMI_PAGE_KB) {
        if (e->component == b_ctrl_ok_id) hmi_kb_confirm();
        if (e->component == b_ctrl_cancel_id) {
            // navigate back without saving
            uint32_t caller = hmi_get_variable("pgKB.va_caller.val");
            hmi_send(caller == 1 ? "page pgWifi" : "page pgLTE");
        }
    }
}
```

---

## 11. UART Switch Control

The WAN MCU must switch UART2 routing before entering HMI mode:

```c
// In hmi_handler.c
static bool s_hmi_active = false;

void hmi_enter_mode(void) {
    if (s_hmi_active) return;
    // 1. Stop LAN MCU UART communication (pause MCU_LAN communication handler)
    mcu_lan_comm_pause();
    // 2. Switch UART2 output to HMI display (GPIO46 HIGH)
    uart_switch_route_to_hmi();   // calls gpio_set_level(GPIO_NUM_46, 1)
    vTaskDelay(pdMS_TO_TICKS(50));
    // 3. Initialize HMI and show home page
    hmi_send("page home");
    s_hmi_active = true;
    ESP_LOGI("HMI", "Entered HMI mode");
}

void hmi_exit_mode(void) {
    if (!s_hmi_active) return;
    // 1. Switch UART2 back to LAN MCU (GPIO46 LOW)
    uart_switch_route_to_lan_mcu();  // calls gpio_set_level(GPIO_NUM_46, 0)
    vTaskDelay(pdMS_TO_TICKS(50));
    // 2. Resume LAN MCU communication
    mcu_lan_comm_resume();
    s_hmi_active = false;
    ESP_LOGI("HMI", "Exited HMI mode");
}
```

**Trigger for entering HMI mode:** Physical button (GPIO45 or GPIO38 long-press), or via BLE/UART config command.

---

## 12. Status Data Structure

```c
// In hmi_handler.h
typedef struct {
    // Battery (from BQ27441 via pwr_source_handler)
    uint8_t  bat_soc;           // 0–100 %
    bool     bat_is_charging;   // from BQ25892 CHRG_STAT
    uint16_t bat_voltage_mv;    // mV

    // WiFi (from wifi_connect handler)
    bool     wifi_connected;
    char     wifi_ssid[33];     // max SSID length
    char     wifi_rssi_str[12]; // e.g. "-65 dBm"
    char     wifi_auth[16];     // "PERSONAL" / "ENTERPRISE"

    // LTE (from lte_connect handler)
    bool     lte_connected;
    char     lte_apn[64];
    char     lte_modem[32];     // e.g. "A7600C1"
    char     lte_csq_str[12];   // e.g. "18/31"
} hmi_status_t;
```

---

## 13. Files to Create

| File | Location | Purpose |
|---|---|---|
| `hmi_handler.h` | `DA2_esp/BSP/` | API: init, mode switch, status refresh, touch event handler |
| `hmi_handler.c` | `DA2_esp/BSP/` | Implementation: UART send/receive, page management, cmd builder |
| `hmi_display.hjpg` | TJC project file | TJC Editor project with all 4 pages (binary, not in git) |
| `DA2_esp/BSP/CMakeLists.txt` | existing | Add `hmi_handler.c` to sources |

---

## 14. TJC Editor Notes

| Setting | Value |
|---|---|
| Device | TJC3224K024_011 |
| Orientation | Landscape (0°) |
| Baud rate | 115200 |
| Background color | 0 (black) |
| Font 0 | 16px, HZK encoding |
| Font 1 | 20px |
| Font 2 | 24px |
| Touch debounce | 30 ms |
| Wake on touch | Yes |

> The TJC project file (`.hmi`) compiles to a `.tft` binary that is flashed to the display's internal flash using the TJC Upload tool over UART at upload baud rate (typically 115200 or 230400).
