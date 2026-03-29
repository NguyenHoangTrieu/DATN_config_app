# Power Monitor Task — Design Documentation

> **Date:** March 28, 2026  
> **Component:** DA2_esp WAN Gateway  
> **Task:** Battery Status Monitoring & HMI Display Update  

---

## 1. Overview

The **Power Monitor Task** is a periodic FreeRTOS task that:
- Reads battery IC status (BQ27441 fuel gauge, BQ25892 charger, INA230 monitor)
- Executes charge control logic (threshold-based enable/disable)
- Updates HMI display with current battery percentage, charging state, and voltages
- Publishes battery status to a global structure accessible by other tasks

**Key Design Goals:**
- Decouple power monitoring from HMI task (both can work independently)
- Thread-safe status publication via mutex
- Minimal latency for urgent events (battery critical, charge complete)
- Extensible to support battery alerts, logging, remote telemetry in future

---

## 2. Task Flowchart

```
┌─────────────────────────────────┐
│ Boot: app_main                  │
│ - pwr_source_init()             │
│ - pwr_monitor_task_start()      │
│ - hmi_handler_init()            │
│ - hmi_enter_mode() [optional]   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐      ┌──────────────────┐
│ Power Monitor Task Loop         │      │ Timer: 5000 ms   │
│ (Priority 4)                    │      └──────────────────┘
└──────────────┬──────────────────┘
               │
               ▼ (repeats every 5s)
        ┌──────────────────┐
        │ read_power_      │
        │ status()         │
        │ (all 3 ICs)      │
        └────────┬─────────┘
                 │
        ┌────────▼─────────┐
        │ pwr_source_      │
        │ charge_monitor() │
        │ - Check 4.1V/3.5V│
        │ - Control charge │
        └────────┬─────────┘
                 │
        ┌────────▼─────────────────────┐
        │ Acquire g_pwr_monitor_mutex  │
        └────────┬─────────────────────┘
                 │
        ┌────────▼─────────────────────────────┐
        │ memcpy() → g_pwr_monitor_status      │
        │ (timestamp_ms updated)               │
        └────────┬─────────────────────────────┘
                 │
        ┌────────▼─────────────────────┐
        │ Release g_pwr_monitor_mutex  │
        └────────┬─────────────────────┘
                 │
        ┌────────▼──────────────────────┐
        │ log_battery_status()           │
        │ (ESP_LOGI for debug output)    │
        └────────┬──────────────────────┘
                 │
        ┌────────▼──────────────────────────┐
        │ if hmi_is_active():                │
        │   update_hmi_battery_status()     │
        │   (calls hmi_refresh_status())    │
        └────────┬──────────────────────────┘
                 │
        ┌────────▼──────────────────┐
        │ vTaskDelay(5000 ms or     │
        │  remaining time to align) │
        └────────┬──────────────────┘
                 │
    ┌────────────┴────────────────┐
    │                             │
    │   (Loop continues)          │
    │                             │
    └─────────────────────────────┘
```

---

## 3. Data Flow Architecture

### 3.1 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Hardware (I2C Bus)                    │
├─────────────────────────────────────────────────────────┤
│  BQ27441 (0x55)    BQ25892 (0x6B)    INA230 (0x40)     │
│  Fuel Gauge        Battery Charger    Power Monitor     │
│  ↓                 ↓                  ↓                 │
│  SoC%, Voltage,    Charge State,      VSYS Voltage,    │
│  Current, Flags    Power Good         System Current    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │ pwr_source_handler.c         │
        │ pwr_source_get_status()      │ ◄─── Unified API
        │ pwr_source_charge_monitor()  │ ◄─── Threshold control
        │ pwr_source_set_charge_       │
        │  enable(bool)                │
        └──────────┬───────────────────┘
                   │
        ┌──────────▼───────────────────┐
        │ pwr_monitor_task.c           │
        │ (read_power_status)          │
        │ (update_hmi_battery_status)  │
        └──────────┬───────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│  g_pwr_monitor_status (global struct)                  │
│  ├─ bat_soc_pct (0–100%)                               │
│  ├─ bat_voltage_mv                                      │
│  ├─ bat_current_ma                                      │
│  ├─ bat_is_charging (bool)                              │
│  ├─ chrg_status (uint8_t)                               │
│  ├─ power_good (bool)                                   │
│  ├─ vsys_voltage_mv                                     │
│  ├─ isys_current_ma                                     │
│  └─ timestamp_ms                                        │
│  Protected by: g_pwr_monitor_mutex                      │
└──────────┬───────────────────────────────────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌─────────────┐ ┌──────────────────────┐
│  HMI Task   │ │  Application Tasks   │
│ (reads for  │ │  (status queries,    │
│  display    │ │   logging, etc.)     │
│  update)    │ │                      │
└─────────────┘ └──────────────────────┘
```

### 3.2 API Call Sequence (Typical Cycle)

```
Time  │ Task                    │ Operation
──────┼─────────────────────────┼───────────────────────────────
t0s   │ pwr_monitor_task       │ Read BQ27441, BQ25892, INA230
      │                         │   → new_status[0]
t+5ms │ pwr_monitor_task       │ Call pwr_source_charge_monitor()
      │                         │   - Check vbat >= 4.1V?
      │                         │   - Check vbat <= 3.5V?
      │                         │   - Drive BC_CE# GPIO
t+10ms│ pwr_monitor_task       │ xSemaphoreTake(g_pwr_monitor_mutex)
      │                         │ memcpy() → g_pwr_monitor_status
      │                         │ xSemaphoreGive(g_pwr_monitor_mutex)
t+15ms│ pwr_monitor_task       │ log_battery_status()
      │                         │   ESP_LOGI("Bat: SoC=75% Vbat=4050mV ...")
t+20ms│ pwr_monitor_task       │ if hmi_is_active():
      │                         │   update_hmi_battery_status()
      │                         │   hmi_refresh_status(&hmi_status)
      │                         │   → hmi_send() UART commands
t+50ms│ HMI Task (parallel)    │ [reads from hmi_status_t]
      │                         │ Updates display page home
t+5s  │ pwr_monitor_task       │ vTaskDelay(pdMS_TO_TICKS(5000))
      │                         │ Loop repeats
```

---

## 4. BSP (Board Support Package) Design

### 4.1 Hardware Dependencies

| Component | I2C Addr | Pin | Function |
|---|---|---|---|
| BQ27441 (Fuel Gauge) | 0x55 | GPIO1/2 (shared I2C) | Read SoC, voltage, flags |
| BQ25892 (Charger) | 0x6B | GPIO1/2 (shared I2C) | Read charge status, power good |
| INA230 (Power Monitor) | 0x40 | GPIO1/2 (shared I2C), shunt R65 | Read VSYS rail voltage/current |
| BC_INT (Charger IRQ) | — | GPIO_NUM_NC (TBD from schematic) | ISR on charger events |
| BC_CE# (Charge Enable) | — | GPIO_NUM_NC (TBD) | Active-low output |

### 4.2 Existing BSP Modules Utilized

```
DA2_esp/BSP/i2c_dev_support/
├─ i2c_dev_support.c  ← Base I2C driver
├─ bq27441_handler.c  ← Fuel gauge read API
├─ bq25892_handler.c  ← Charger read/control API
└─ ina230_handler.c   ← Power monitor read API

DA2_esp/main/
└─ pwr_source_handler.c  ← Unified power control + threshold logic
```

### 4.3 Power Monitor Task BSP Interface

```
pwr_monitor_task.c
    │
    ├─→ pwr_source_handler.h
    │   ├─ pwr_source_get_status() ◄─ reads all 3 ICs
    │   └─ pwr_source_charge_monitor() ◄─ controls charging
    │
    ├─→ hmi_handler.h
    │   ├─ hmi_is_active()
    │   └─ hmi_refresh_status()
    │
    ├─→ esp_log.h (logging)
    │
    └─→ FreeRTOS API (task, mutex, delay)
```

### 4.4 Initialization Sequence

```c
app_main()
  ├─ pwr_source_init()           /* Initialize 3 battery ICs */
  │   ├─ gpio_config(BC_* pins)
  │   ├─ bq25892_init()
  │   ├─ ina230_init()
  │   ├─ bq27441_init()
  │   └─ gpio_isr_handler_add(BC_INT, pwr_source_int_handler)
  │
  ├─ pwr_monitor_task_start()    /* Start monitor task */
  │   └─ xTaskCreate(power_monitor_task, ...)
  │
  ├─ hmi_handler_init()          /* Initialize HMI */
  │
  └─ hmi_enter_mode() [optional] /* Switch UART to HMI display */
```

---

## 5. Application Design

### 5.1 Task Integration in app_main

```c
void app_main(void) {
    // ... existing code ...
    
    /* Power management & monitoring */
    pwr_source_init();            /**< Init battery ICs (BQ25892/INA230/BQ27441) */
    pwr_monitor_task_start();     /**< Start 5-second battery monitor loop */
    
    /* HMI display */
    hmi_handler_init();
    hmi_enter_mode();             /**< Switch UART2 to HMI; monitor provides updates */
    
    // ... rest of app_main ...
}
```

### 5.2 Public API Usage Examples

#### Example 1: Retrieve Current Battery Status

```c
#include "pwr_monitor_task.h"

void my_task(void *arg) {
    pwr_monitor_status_t status;
    
    while (1) {
        esp_err_t ret = pwr_monitor_get_status(&status);
        if (ret == ESP_OK) {
            printf("Battery SoC: %u%%\n", status.bat_soc_pct);
            printf("Charging: %s\n", status.bat_is_charging ? "Yes" : "No");
        }
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}
```

#### Example 2: Force Immediate Status Update (e.g., Button Press)

```c
void on_power_button_pressed(void) {
    /* Get fresh battery status and update HMI immediately */
    pwr_monitor_update_now();
}
```

#### Example 3: HMI Integration (Automatic)

```c
/* In hmi_handler.c (already integrated) */
void update_hmi_battery_status(const pwr_monitor_status_t *s) {
    if (!hmi_is_active()) return;
    
    hmi_status_t hmi_status = {
        .bat_soc = s->bat_soc_pct,
        .bat_is_charging = s->bat_is_charging,
        .bat_voltage_mv = s->bat_voltage_mv,
    };
    
    hmi_refresh_status(&hmi_status);  /* Update home page */
}
```

### 5.3 Thread Safety

**Mutex Protection:**
```c
/* Global status structure is protected by mutex */
SemaphoreHandle_t g_pwr_monitor_mutex;

/* Writer (pwr_monitor_task) */
xSemaphoreTake(g_pwr_monitor_mutex, pdMS_TO_TICKS(100));
memcpy(&g_pwr_monitor_status, &new_status, sizeof(new_status));
xSemaphoreGive(g_pwr_monitor_mutex);

/* Reader (other tasks) */
pwr_monitor_get_status(&my_status);  /* Acquires mutex internally */
```

### 5.4 Integration with Other Subsystems

| Subsystem | Integration Point | Purpose |
|---|---|---|
| **HMI Task** | `update_hmi_battery_status()` | Real-time battery status display |
| **Web Config** | `pwr_monitor_get_status()` | Battery status API endpoint |
| **MQTT Server** | Future telemetry publisher | Send battery metrics upstream |
| **Alert System** | `bat_critical_low` flag | Trigger low-battery warning/shutdown |
| **Data Logging** | `log_battery_status()` | Record battery history for analysis |

---

## 6. Charge Control Logic

### 6.1 Threshold-Based Control

```c
void pwr_source_charge_monitor(void) {
    uint16_t vbat_mv = bq27441_read_voltage();
    
    if (vbat_mv >= 4100) {  /* Upper threshold: 4.1V */
        pwr_source_set_charge_enable(false);
        ESP_LOGI(TAG, "Battery full — charging DISABLED");
    } 
    else if (vbat_mv <= 3500) {  /* Lower threshold: 3.5V */
        pwr_source_set_charge_enable(true);
        ESP_LOGI(TAG, "Battery low — charging ENABLED");
    }
    else {
        /* Stay in current state (hysteresis) */
    }
}
```

### 6.2 Charge State Machine

```
      ┌─────────────────┐
      │  DISCHARGING    │  (vbat > 3.5V and < 4.1V)
      │  (User decides) │
      └────┬────────┬───┘
           │        │
      vbat │        │ vbat
      ≤3.5V │        │ ≥4.1V
           │        │
           ▼        ▼
      ┌──────────┐ ┌──────────┐
      │ CHARGING │ │    FULL  │
      │  ACTIVE  │ │  CHARGED │
      └──────────┘ └──────────┘
           ▲             ▼
           └─────────────┘
           (stay full until
            discharge drops
            to 3.5V)
```

---

## 7. Configuration Parameters

| Parameter | Value | Purpose |
|---|---|---|
| `PWR_MONITOR_TASK_STACK_SIZE` | 4096 bytes | Task stack depth |
| `PWR_MONITOR_TASK_PRIORITY` | 4 | Medium priority (below ISR handlers, above idle) |
| `PWR_MONITOR_UPDATE_INTERVAL_MS` | 5000 ms | Monitor update frequency |
| `PWR_BATT_UPPER_THRESHOLD_MV` | 4100 mV | Charge stop threshold |
| `PWR_BATT_LOWER_THRESHOLD_MV` | 3500 mV | Charge resume threshold |

---

## 8. Error Handling

```
Scenario                         | Behavior
─────────────────────────────────┼────────────────────────────────
BQ27441 read fails               │ Log warning, fall back to BQ25892 ADC
BQ25892 communication error      │ Log warning, continue (defaults safe)
INA230 unavailable               │ Log warning, VSYS data = 0
BC_INT GPIO not configured       │ No ISR; monitor task still works
HMI not active                   │ Skip hmi_refresh_status() call
pwr_monitor_mutex creation fails │ Return ESP_ERR_NO_MEM on start
Task creation fails              │ Return ESP_FAIL, log error
```

---

## 9. Testing Checklist

- [ ] Task starts without errors in app_main
- [ ] Battery status updates every 5 seconds
- [ ] HMI display updates in real-time with battery %
- [ ] Charge threshold logic works (triggers at 4.1V / 3.5V)
- [ ] Thread-safe access to g_pwr_monitor_status
- [ ] Log output shows expected battery values
- [ ] pwr_monitor_update_now() forces immediate update
- [ ] Task stops cleanly on shutdown
- [ ] No memory leaks (check FreeRTOS heap)

---

## 10. Future Enhancements

- [ ] Battery health estimation (cycle count, capacity fade)
- [ ] Temperature monitoring & thermal throttling
- [ ] Remote telemetry to MQTT server
- [ ] Low-battery shutdown trigger
- [ ] Battery statistics logging to SD card or MQTT
- [ ] Predictive battery life estimation
- [ ] Charge rate optimization based on load

