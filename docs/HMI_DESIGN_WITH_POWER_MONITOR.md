# HMI Display Handler — Design & Integration with Power Monitor

> **Date:** March 28, 2026 (updated April 2026)
> **Component:** DA2_esp WAN Gateway
> **Display:** TJC3224K024_011 (2.4" 320x240 landscape UART HMI, rotated 90°)

---

## 1. Overview

The **HMI subsystem** manages a UART touchscreen display using a **three-tier architecture**:

| Layer | Files | Responsibility |
|---|---|---|
| **BSP** | `hmi_handler.h/.c` | Raw UART2 driver (install/deinit/write/read_frame) |
| **Middleware** | `hmi_display.h/.c` | TJC protocol, page navigation, component updates, touch dispatch |
| **Application** | `hmi_task.h/.c` | FreeRTOS RX task, mode FSM, thread-safe status update API |

Features:
- **Page Navigation:** Home -> WiFi Config -> LTE Config -> Keyboard input
- **Real-time Updates:** Battery status from `pwr_monitor_task` every 5 s
- **Config Submission:** WiFi/LTE settings posted to `config_handler_queue`
- **UART Switch:** GPIO46 routes UART2 between LAN MCU and HMI display

---

## 2. Integration with Power Monitor

### 2.1 Data Flow

```
pwr_monitor_task (every 5s)
  - Read BQ27441, BQ25892, INA230
  - Build hmi_status_t
  - Call hmi_task_update_status()          <-- Application layer API
        |
        v
  hmi_task_update_status()  [hmi_task.c]  Application layer
  - Mutex-protect copy to s_cached
  - Call hmi_display_refresh_status()
        |
        v
  hmi_display_refresh_status()  [hmi_display.c]  Middleware layer
  - Guard: only runs when cur_page == home
  - Compute color from SoC%
  - hmi_display_send("fill 0,0,320,24,0")        clear title bar
  - hmi_display_send("xstr 89,7,72,10,0,...")     battery bar (landscape x=88..161)
  - hmi_display_send("xstr 4,51,14,20,...\"*\"")  WiFi dot (x=4, cot trai)
  - hmi_display_send("xstr 166,51,14,20,...")     LTE dot  (x=166, cot phai)
  - ... (all drawn via xstr/fill, no named components)
        |
        v
  hmi_display_send() -> hmi_bsp_write()  [hmi_handler.c]  BSP layer
  - Appends 0xFF 0xFF 0xFF terminator
  - uart_write_bytes() -> UART2 TX (GPIO41)
        |
        v
  TJC3224K024_011 display (240x320 portrait)
```

### 2.2 hmi_status_t Population

```
pwr_monitor_status_t        ->   hmi_status_t fields
  bat_soc_pct               ->   .bat_soc
  bat_voltage_mv            ->   .bat_voltage_mv
  chrg_status==1 or 2       ->   .bat_is_charging
  (wifi/lte/eth updated by respective connect handlers)
```

---

## 3. Home Page Layout (landscape 320x240)

```
x:  0        80      158        240      319
    +------------------------------------------+  y=0
    |DA2 GW   [========]  85%   Chrg/Idle      |  y=0..23   Title bar
    +------------------------------------------+  y=24 (separator)
    |WiFi          |||   LTE                   |  y=26..47  Section headers (CYAN)
    | * Connected  |||    * Connected           |  y=50..71  Dot + status text
    | HomeNet      |||    m-wap            |  y=74..91  SSID / APN
    | -65dBm PERS  |||    A7600C1 18/31        |  y=94..111 Detail (gray)
    +------------------------------------------+  y=116 (separator)
    |ETH:  * Connected    192.168.1.50          |  y=119..137 ETH row
    +------------------------------------------+  y=141 (separator)
    |                                          |  y=142..171 gap
    |  [ WiFi ]              [ LTE ]          |  y=172..207 TJC buttons
    +------------------------------------------+  y=239
```

Vertical divider at x=158, y=26..115 (WiFi left col 0..157, LTE right col 162..319).

TJC project components (only buttons -- all text drawn by ESP32 via xstr):
- Button comp 1: `b_wifi_cfg` at 4,172,150,36 (MUST be comp ID 1)
- Button comp 2: `b_lte_cfg` at 166,172,150,36 (MUST be comp ID 2)
- Button comp 1 on pgWifi/pgLTE: `b_back` at 4,196,312,36

---

## 4. Task Architecture

### 4.1 Responsibilities

| Operation | Layer | Frequency |
|---|---|---|
| Read power status | pwr_monitor_task | Every 5s |
| Call hmi_task_update_status() | pwr_monitor_task | Every 5s |
| Refresh home page content | Middleware hmi_display.c | Every 5s (xstr/fill via UART) |
| Read RX frames from UART2 | Application hmi_rx task | Continuous (event-driven) |
| Dispatch touch events | Middleware hmi_display.c | On each touch press |
| WiFi/LTE config read + submit | Middleware hmi_display.c | On b_set press |
| UART switch + BSP init/deinit | Application hmi_task.c | On mode transition |

### 4.2 RX Task Flow (hmi_task.c)

```
rx_task_fn() runs while s_active == true:
  |
  +-- hmi_bsp_read_frame(frame, 256, 200ms)
  |     reads UART2 bytes until 3x 0xFF or timeout
  |
  +-- hmi_display_handle_frame(frame, len)
        |     |
        |     +-- frame[0]==0x65 (TOUCH): dispatch by page+comp ID
        |     |     home.1 -> goto pgWifi   (b_wifi_cfg = comp 1)
        |     |     home.2 -> goto pgLTE    (b_lte_cfg  = comp 2)
        |     |     pgWifi.1 -> back to home (b_back = comp 1)
        |     |     pgLTE.1  -> back to home
        |     |
        |     +-- frame[0]==0x88 (STARTUP): goto home page
        |     |
        |     +-- frame[0]==0x66 (PAGE_CHG): update s_cur_page
```

### 4.3 Mode State Machine (hmi_task.c)

```
app_main()
  -> hmi_task_init()        (one-time, before scheduler)
  -> hmi_task_enter_mode()  (at normal boot)
        |
        +--> uart_switch_route_to_hmi()   GPIO46=HIGH
        +--> hmi_bsp_init()               UART2 driver install
        +--> s_active = true
        +--> xTaskCreate(rx_task_fn)      start RX task
        +--> hmi_display_goto_page(home)  show home page

On exit (e.g. CONFIG mode switch):
  -> hmi_task_exit_mode()
        |
        +--> s_active = false
        +--> wait for RX task to exit (max 500ms)
        +--> hmi_bsp_deinit()
        +--> uart_switch_route_to_lan_mcu()  GPIO46=LOW
```

---

## 5. Battery Status Display Logic

### 5.1 Color Rules

```
SoC >= 50%  -> HMI_COL_GREEN  (2016)    healthy
SoC >= 20%  -> HMI_COL_YELLOW (65504)  caution
SoC >= 10%  -> HMI_COL_ORANGE (64512)  warning
SoC <  10%  -> HMI_COL_RED    (63488)  critical
```

Applied to: battery bar fill color, percentage text color

### 5.2 Charging Indicator

```
bat_is_charging == true   -> t_bat_status.txt="Chrg" pco=HMI_COL_GREEN
bat_is_charging == false  -> t_bat_status.txt="Idle" pco=HMI_COL_GRAY
```

### 5.3 Implementation (hmi_display.c Middleware)

```c
void hmi_display_refresh_status(const hmi_status_t *s)
{
    if (!s || s_cur_page != HMI_PAGE_HOME) return;

    // Battery bar (landscape x=88..161, 74px wide)
    uint16_t bat_col = (s->bat_soc >= 50) ? HMI_COL_GREEN  :
                       (s->bat_soc >= 20) ? HMI_COL_YELLOW :
                       (s->bat_soc >= 10) ? HMI_COL_ORANGE : HMI_COL_RED;

    hmi_display_send("fill 0,0,320,24,0");  // clear title bar
    hmi_display_send("xstr 2,2,82,20,0,65535,0,0,1,0,\"DA2 GW\"");
    uint8_t bar_w = (s->bat_soc * 72) / 100;
    hmi_display_sendf("fill 88,6,74,12,%u", HMI_COL_GRAY);
    hmi_display_sendf("fill 89,7,%u,10,%u", bar_w, bat_col);
    hmi_display_sendf("xstr 166,2,50,20,0,%u,0,1,1,0,\"%u%%\"", bat_col, s->bat_soc);

    // WiFi dot + status (left column x=0..157)
    uint16_t wifi_col = s->wifi_connected ? HMI_COL_GREEN : HMI_COL_RED;
    hmi_display_sendf("xstr 4,51,14,20,0,%u,0,1,1,0,\"*\"", wifi_col);
    hmi_display_sendf("xstr 20,51,92,20,0,%u,0,0,1,0,\"%s\"",
                      wifi_col, s->wifi_connected ? "Connected" : "No WiFi");
    // ... LTE and ETH follow same xstr pattern
}
```

---

## 6. Integration with app_main (DA2_esp.c)

### 6.1 Boot Sequence

```c
void app_main(void)
{
    // ... NVS, GPIO, I2C, etc. ...

    pwr_source_init();
    pwr_monitor_task_start();    // starts 5s battery monitor + HMI updates
    hmi_task_init();             // one-time init (replaces hmi_handler_init)

    // ...

    hmi_task_enter_mode();       // switch to HMI, start RX task, show home
    internet_connect_start(current_internet_type);
    // ...
}
```

### 6.2 API Summary

| Old API (still works via shim) | New API | Layer |
|---|---|---|
| `hmi_handler_init()` | `hmi_task_init()` | Application |
| `hmi_enter_mode()` | `hmi_task_enter_mode()` | Application |
| `hmi_exit_mode()` | `hmi_task_exit_mode()` | Application |
| `hmi_is_active()` | `hmi_task_is_active()` | Application |
| `hmi_refresh_status(s)` | `hmi_task_update_status(s)` | Application |

The legacy shims are defined as `static inline` in `hmi_task.h`, so existing code
(`pwr_monitor_task.c`, `DA2_esp.c`) only needs to change its `#include` from
`hmi_handler.h` to `hmi_task.h`.

---

## 7. hmi_status_t Structure

```c
// Defined in hmi_display.h (Middleware layer)
typedef struct {
    // Battery (from BQ27441 / BQ25892)
    uint8_t  bat_soc;           // 0-100 %
    bool     bat_is_charging;   // true while BQ25892 charging
    uint16_t bat_voltage_mv;    // mV

    // WiFi (from wifi_connect handler)
    bool     wifi_connected;
    char     wifi_ssid[33];
    char     wifi_rssi_str[12]; // e.g. "-65 dBm"
    char     wifi_auth[16];     // "PERSONAL" / "ENTERPRISE"

    // LTE (from lte_connect handler)
    bool     lte_connected;
    char     lte_apn[64];
    char     lte_modem[32];     // e.g. "A7600C1"
    char     lte_csq_str[12];   // e.g. "18/31"

    // Ethernet (from eth_connect handler)
    bool     eth_connected;
    char     eth_ip[16];        // e.g. "192.168.1.50"
} hmi_status_t;
```

---

## 8. Integration Checklist

- [x] BSP layer: `hmi_handler.h/.c` refactored to raw UART2 functions only
- [x] Middleware layer: `Middleware/HMI_Display/hmi_display.h/.c` created
- [x] Application layer: `Application/HMI_Task/hmi_task.h/.c` created
- [x] Legacy shims in `hmi_task.h` for backward compatibility
- [x] `pwr_monitor_task.c` updated: `#include "hmi_task.h"` (was hmi_handler.h)
- [x] `DA2_esp.h` updated: `#include "hmi_task.h"` (was hmi_handler.h)
- [x] `CMakeLists.txt` updated: added hmi_display.c and hmi_task.c sources + include dirs
- [x] Portrait 240x320 -> **Landscape 320x240** (module mounted sideways, TJC Editor Landscape)
- [x] All home-page content drawn by ESP32 via xstr/fill (no named text components)
- [x] TJC project: 5 button components only (comp IDs 1,2 on home; comp ID 1 on pgWifi/pgLTE)

---

## 9. Performance Metrics

| Metric | Target | Notes |
|---|---|---|
| Power monitor update interval | 5000 ms | FreeRTOS tick-based |
| HMI refresh latency | < 200 ms | ~20 UART commands x 10ms each |
| Thread safety (mutex wait) | < 50 ms | Status copy under mutex |
| Battery SoC reading accuracy | ±2% | BQ27441 spec (after IT calibration) |
| Charge control response | < 1s | From threshold cross to GPIO action |
| UART2 baud rate | 115200 | TJC K-series default |
