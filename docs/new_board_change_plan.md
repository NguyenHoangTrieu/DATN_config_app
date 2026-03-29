# New Board Hardware Change Plan

> **Scope:** All firmware changes needed to support the new hardware revision for both **DA2_esp (WAN MCU)** and **DA2_esp_LAN (LAN MCU)** projects.

---

## Table of Contents

1. [Overview of Changes](#1-overview-of-changes)
2. [Task 1 — MCU WAN↔LAN SPI Communication Pins (DONE)](#2-task-1--mcu-wanlan-spi-communication-pins)
3. [Task 2 — INT, RESET, DATA_READY Pins (DONE)](#3-task-2--int-reset-data_ready-pins)
4. [Task 3 — MCU LAN↔WAN UART Compatibility (DONE + NEW)](#4-task-3--mcu-lanwan-uart-compatibility)
5. [Task 4 — Power & Charger Module Control (IN DESIGN)](#5-task-4--power--charger-module-control)
6. [Task 5 — WAN Adapter Connector & Stack Handler Rewrite](#6-task-5--wan-adapter-connector--stack-handler-rewrite)
7. [Task 6 — WAN LTE Control Pin Remapping](#7-task-6--wan-lte-control-pin-remapping)
8. [Task 7 — LAN Adapter Connector Pin Changes](#8-task-7--lan-adapter-connector-pin-changes)
9. [Task 8 — LAN Stack Handler Rewrite (IO Expander on Adapter)](#9-task-8--lan-stack-handler-rewrite-io-expander-on-adapter)
10. [Task 9 — LAN Module SPI Pin Update](#10-task-9--lan-module-spi-pin-update)
11. [Task 10 — LAN Module UART Pin Update (LAN2)](#11-task-10--lan-module-uart-pin-update-lan2)
12. [Task 11 — LAN USB Switch Control Pin](#12-task-11--lan-usb-switch-control-pin)
13. [Task 12 — LAN SD Card / SDIO Pin Check](#13-task-12--lan-sd-card--sdio-pin-check)
14. [Task 13 — TCA6424A Address & IC Change (TCA6416A)](#14-task-13--tca6424a-address--ic-change-tca6416a)
15. [Task 14 — WAN Power Source Handler Update](#15-task-14--wan-power-source-handler-update)
16. [Task 15 — LoRa Gateway (Uplink) Implementation](#16-task-15--lora-gateway-uplink-implementation)
17. [Task 16 — HMI Display Integration (TJC3224K024_011RN)](#17-task-16--hmi-display-integration-tjc3224k024_011rn)
18. [Summary Matrix](#18-summary-matrix)

---

## 1. Overview of Changes

The new board revision introduces the following key architectural changes:

| Change Area | Old Design | New Design |
|---|---|---|
| **IO Expander** | TCA6424A (24-pin, 3 ports) on the main board | TCA6416A (16-pin, 2 ports) **on each adapter board** |
| **IO Expander Address** | Fixed `0x22` | `0x20` or `0x21` per adapter |
| **Stack ID Detection** | Hardcoded/pseudo module ID | Read from IO expander P00–P03 (4-bit address) |
| **WAN Stack** | 13 GPIO pins (11 GPIO + WAKE# + PERST#) | 16 GPIO pins (P00–P07, P10–P17) direct mapping |
| **LAN Stacks** | 11 GPIO pins per stack, fixed TCA mapping | 16 GPIO pins per adapter, slot detect via P17 |
| **LAN Adapter Slots** | Single TCA shared between 2 stacks | Each adapter has its own TCA6416A |
| **LTE Control** | WAKE# = pin 11, PERST# = pin 12 | WAKE# = P05, PERST# = P06 |
| **LAN2 UART** | TX=GPIO15, RX=GPIO16 | TX=GPIO8, RX=GPIO21 |
| **LAN SPI3** | Various pins | CS0=38, CS1=39, CLK=41, MISO=42, MOSI=40 |
| **IO Expander INT** | GPIO21 (single) | LAN1=GPIO47, LAN2=GPIO48 |
| **IO Expander RST** | GPIO47 | Moved to adapter board (per-adapter RST) |

---

## 2. Task 1 — MCU WAN↔LAN SPI Communication Pins

**Status: ✅ DONE**

Both WAN (SPI Slave) and LAN (SPI Master) already use the correct pins:

| Signal | GPIO | Project |
|---|---|---|
| CS | GPIO_NUM_10 | Both |
| CLK | GPIO_NUM_12 | Both |
| IO0 (MOSI) | GPIO_NUM_11 | Both |
| IO1 (MISO) | GPIO_NUM_13 | Both |

**Files verified:**
- `DA2_esp/BSP/MCU_LAN_Communication/` — SPI Slave config
- `DA2_esp_LAN/BSP/MCU_WAN_Communication/` — SPI Master config

---

## 3. Task 2 — INT, RESET, DATA_READY Pins

**Status: ✅ DONE**

SPI Data Ready signal (GPIO8 on WAN side, GPIO46 on LAN side) verified correct.

---

## 4. Task 3 — MCU LAN↔WAN UART Compatibility

**Status: ✅ DONE (partially)**

| Signal | WAN Side | LAN Side | Status |
|---|---|---|---|
| WAN UART2 TX | GPIO_NUM_42 | — | SAME ✅ |
| WAN UART2 RX | GPIO_NUM_41 | — | SAME ✅ |
| LAN UART0 TX | — | GPIO_NUM_TX0 (43) | SAME ✅ |
| LAN UART0 RX | — | GPIO_NUM_RX0 (44) | SAME ✅ |

### ⚠️ NEW: UART Switch Mechanism

The new board adds a **UART switch** (FSUSB42UMX-TP) controlled by **`UART_SEL = GPIO_NUM_46`** on the WAN MCU:

| GPIO46 (UART_SEL) | Path | Destination |
|---|---|---|
| LOW (0) | UART_SW1 | LAN MCU (normal operation, PPP, OTA) |
| HIGH (1) | UART_SW2 → LCD_3V3 | HMI LCD display (TJC3224K024) |

**Status: ✅ GPIO confirmed from schematic (M_IO46 → UART_SEL)**

**Action Required:**
- [x] **UART_SEL = GPIO_NUM_46** — confirmed, implemented in `DA2_esp.c` as `uart_switch_init()`, `uart_switch_route_to_lan_mcu()`, `uart_switch_route_to_hmi()`
- [x] Default state (GPIO46 LOW) routes UART2 to LAN MCU on boot
- [x] `uart_switch_route_to_lan_mcu()` called before `ppp_server_init()` in `config_handler.c` CFFW handler
- [ ] Add `mcu_lan_comm_pause()` / `mcu_lan_comm_resume()` gate around HMI session (see **Task 16**)

---

## 5. Task 4 — Power & Charger Module Control

**Status: ⚠️ IN DESIGN — Hardware confirmed from schematic**

### Hardware Overview (from schematic — `Battery_Charger_and_Power_Monitor` block)

The new board introduces **three dedicated ICs** replacing the old TCA6424A power-rail control:

| IC | Part Number | I2C Address | Function |
|---|---|---|---|
| Battery Charger | BQ25892RTWR | `0x6B` | Buck-boost charger, ILIM = 2.96A (R66 = 120Ω) |
| Power Monitor | INA230AIRGTR | `0x40` | Current/voltage monitor on +4V2_VSYS rail, shunt R65 = 10mΩ |
| Battery Fuel Gauge | BQ27441DRZR-G1B | `0x55` | Coulomb-counter fuel gauge, shunt R72 = 10mΩ |

### Power Architecture (New Board)

```
VBUS (12V/5V) ──► BQ25892 ──► +4V2_VSYS ──► regulators ──► 3.3V / 1.8V system rails
                      │
                      └────────── BAT pin ──► Battery (3.7V Li-Ion)
```

- The old 1.8V / 3.3V / 5V TCA6424A rail control is **removed**. System rails are always-on once VSYS is active.
- BQ25892 SW output drives L3 inductor → charges battery AND supplies VSYS simultaneously.
- INA230 measures total system current on the VSYS rail (IN- / IN+ via R65).
- BQ27441 measures battery coulombs directly at the battery terminals (SRN/SRP via R72).

### Battery Voltage Thresholds

| Threshold | Value | Purpose |
|---|---|---|
| **Upper (stop charge)** | **4.1 V** | Set BQ25892 VREG = 4096 mV (REG04[7:2] = 0b010000) |
| **Lower (low-battery alert)** | **3.5 V** | Used by BQ27441 BATLOWV flag; trigger charge enable via BC_CE# |

### BQ25892 Control Signals (BC_IO)

The ESP32 controls the BQ25892 via both I2C and discrete GPIO pins (BC_IO net):

| Signal | Direction | ESP32 GPIO | Description |
|---|---|---|---|
| BC_I2C SCL | Master out | GPIO1 (shared I2C bus) | I2C clock |
| BC_I2C SDA | Bidirectional | GPIO2 (shared I2C bus) | I2C data |
| BC_INT | Input | TBD — check BC_IO net | Charger fault / event interrupt (active-low) |
| BC_OTG | Output | TBD — check BC_IO net | OTG mode enable (HIGH = boost battery → VBUS) |
| BC_CE# | Output | TBD — check BC_IO net | Charge Enable (active-low; LOW = charging on) |
| BC_PSEL | Output | TBD — check BC_IO net | Input source select (GND-attached adapter vs USB) |
| BC_STAT | Input | TBD — check BC_IO net | Charge status (open-drain LED driver output) |
| BC_PG# | Input | TBD — check BC_IO net | Power Good (active-low; LOW = valid VBUS present) |

> **Action**: Verify the exact ESP32 GPIO numbers for the BC_IO nets from the full schematic netlist before implementation.

### BQ25892 Key Register Map (Implementation Reference)

| Register | Address | Field | Value for New HW |
|---|---|---|---|
| Input Source Control | REG00 | IINLIM | 3.0A (matches R66 ILIM) |
| Power-On Config | REG01 | CHG_CONFIG (bit 4) | 1 = enable charging |
| Charge Voltage Limit | REG04 | VREG[7:2] | `0b01000000` → 4096 mV ≈ **4.1 V** |
| Charge Voltage Limit | REG04 | BATLOWV (bit 1) | 1 = 3.0 V pre-charge threshold |
| ADC Control | REG02 | CONV_START (bit 7) | 1 = single ADC conversion |
| System Status | REG0B | CHRG_STAT[2:1] | 00=not chg, 01=pre-chg, 10=fast-chg, 11=done |
| Battery Voltage ADC | REG0E | BATV[6:0] | 2304 + BATV × 20 mV |
| Fault Register | REG09 | CHRG_FAULT, BAT_FAULT | Read on BC_INT |

### New Driver Files to Create

| File | Location | Purpose |
|---|---|---|
| `bq25892_handler.h/.c` | `DA2_esp/BSP/i2c_dev_support/` | BQ25892 I2C driver: init, set VREG, CHG_CONFIG, read status, read BATV ADC |
| `ina230_handler.h/.c` | `DA2_esp/BSP/i2c_dev_support/` | INA230 I2C driver: init with calibration, read bus voltage, shunt voltage, current |
| `bq27441_handler.h/.c` | `DA2_esp/BSP/i2c_dev_support/` | BQ27441 I2C driver: read VOLT, STATE_OF_CHARGE, FLAGS (BATLOWV, FC), AVG_CURRENT |

### Charge Control Logic

```c
// In pwr_source_handler — charge management loop (called periodically or on BC_INT)
void pwr_source_charge_monitor(void) {
    uint16_t vbat_mv = bq27441_read_voltage();  // or bq25892_read_batv_adc()

    if (vbat_mv >= 4100) {
        // Stop charge: set CHG_CONFIG=0 in BQ25892 REG01 OR pull BC_CE# HIGH
        bq25892_set_charge_enable(false);
    } else if (vbat_mv <= 3500) {
        // Resume charge
        bq25892_set_charge_enable(true);
    }
    // BQ25892 hardware VREG at 4.096V also limits charge autonomously as backup
}
```

### Action Checklist

- [ ] **Verify BC_IO GPIO numbers** from full schematic netlist
- [ ] **Create `bq25892_handler.c/h`**: I2C init at 0x6B, `bq25892_init()`, `bq25892_set_charge_enable()`, `bq25892_set_charge_voltage(mv)`, `bq25892_read_status()`, `bq25892_read_batv_mv()`
- [ ] **Create `ina230_handler.c/h`**: I2C init at 0x40, calibration for 10mΩ shunt, `ina230_read_bus_voltage_mv()`, `ina230_read_current_ma()`
- [ ] **Create `bq27441_handler.c/h`**: I2C init at 0x55, `bq27441_read_voltage_mv()`, `bq27441_read_soc_percent()`, `bq27441_read_flags()`, `bq27441_read_avg_current_ma()`
- [ ] **Init BC_CE# and BC_OTG GPIOs** as outputs; BC_INT, BC_STAT, BC_PG# as interrupt/input
- [ ] **Rewrite `pwr_source_handler.c/h`** (see Task 14 for full spec)
- [ ] **Remove all TCA-based power rail calls** (`tca_configure_port`, `tca_set_pin_verified` for P1_5/P1_6/P1_7)

---

## 6. Task 5 — WAN Adapter Connector & Stack Handler Rewrite

**Status: ⚠️ NEEDS REWORK**

### Current State

**File:** `DA2_esp/BSP/stack_handler/`

```c
// Current: 13 pins, old mapping style
typedef enum {
  STACK_GPIO_PIN_1    = 0,   // → P00
  STACK_GPIO_PIN_2    = 1,   // → P01
  ...
  STACK_GPIO_PIN_11   = 10,  // → P12
  STACK_GPIO_PIN_WAKE  = 11, // → P13
  STACK_GPIO_PIN_PERST = 12  // → P14
} stack_gpio_pin_num_t;
```

### Required New Design

```c
// New: 16 pins, direct TCA6416A port mapping
typedef enum {
  STACK_GPIO_PIN_00 = 0,   // P00 — ADDR bit 0
  STACK_GPIO_PIN_01 = 1,   // P01 — ADDR bit 1
  STACK_GPIO_PIN_02 = 2,   // P02 — ADDR bit 2
  STACK_GPIO_PIN_03 = 3,   // P03 — ADDR bit 3
  STACK_GPIO_PIN_04 = 4,   // P04
  STACK_GPIO_PIN_05 = 5,   // P05 (LTE WAKE#)
  STACK_GPIO_PIN_06 = 6,   // P06 (LTE PERST#)
  STACK_GPIO_PIN_07 = 7,   // P07
  STACK_GPIO_PIN_10 = 8,   // P10
  STACK_GPIO_PIN_11 = 9,   // P11
  STACK_GPIO_PIN_12 = 10,  // P12
  STACK_GPIO_PIN_13 = 11,  // P13
  STACK_GPIO_PIN_14 = 12,  // P14
  STACK_GPIO_PIN_15 = 13,  // P15
  STACK_GPIO_PIN_16 = 14,  // P16
  STACK_GPIO_PIN_17 = 15,  // P17
} stack_gpio_pin_num_t;
```

### Changes Required

**A) TCA IC Change:**
- [ ] Replace `tca_handler` from TCA6424A (3 ports × 8 = 24 pins) to **TCA6416A (2 ports × 8 = 16 pins)**
- [ ] Remove all references to `TCA_PORT_2` (TCA6416A only has Port 0 and Port 1)
- [ ] Update I2C address from `0x22` to `0x20` (or `0x21`)
- [ ] Update register addresses (TCA6416A uses different register map than TCA6424A)

**B) GPIO Pin Mapping Update:**
- [ ] Replace `stack1_gpio_map[]` with direct 16-pin flat mapping:
  - Pins 0–7 → TCA_PORT_0, pins 0–7 (P00–P07)
  - Pins 8–15 → TCA_PORT_1, pins 0–7 (P10–P17)
- [ ] Update `STACK_GPIO_PIN_COUNT` from 13 to 16
- [ ] Remove `STACK_GPIO_PIN_WAKE` / `STACK_GPIO_PIN_PERST` named aliases (they are now regular pins P05/P06)

**C) Stack ID Detection (NEW FLOW):**
- [ ] Implement new `stack_handler_detect_id()` function:
  1. Scan I2C bus for TCA6416A at addresses `0x20` and `0x21`
  2. Read P00, P01, P02, P03 as inputs → 4-bit address (0b0000 to 0b1111)
  3. Store detected address in `g_stack_id`
  4. Replace hardcoded `stack_handler_get_module_id()` returning "001" with actual detected ID
- [ ] Update `stack_handler_init()` to include detection flow

**D) IO Expander Control Pins:**
- [ ] `IO_EXPANDER_RST_GPIO_NUM` = GPIO_NUM_48 (new, was GPIO47)
- [ ] `IO_EXPANDER_INT_GPIO_NUM` = GPIO_NUM_47 (new, was GPIO21)
- [ ] Update `tca_handler` reset pin and interrupt pin accordingly

**E) Remove Port 2 References:**
- [ ] `stack_handler_init()`: Remove `tca_configure_port(TCA_PORT_2, 0xFF)` call
- [ ] `pwr_source_handler.c`: Relocate power pin logic (see Task 14)

### Files to Modify

| File | Changes |
|---|---|
| `DA2_esp/BSP/stack_handler/include/stack_handler.h` | New enum, new constants, new detect API |
| `DA2_esp/BSP/stack_handler/src/stack_handler.c` | New flat mapping, detection logic, remove Port 2 |
| `DA2_esp/BSP/i2c_dev_support/include/tca_handler.h` | TCA6416A address, remove Port 2 enum |
| `DA2_esp/BSP/i2c_dev_support/src/tca_handler.c` | TCA6416A register map, 2-port only, new I2C addr |

---

## 7. Task 6 — WAN LTE Control Pin Remapping

**Status: ⚠️ NEEDS REWORK**

### Current State

The LTE handler uses stack_handler GPIO pins for modem power control:

```c
// In lte_config_persistent_t:
uint8_t pwr_pin;  // Default: STACK_GPIO_PIN_WAKE = 11
uint8_t rst_pin;  // Default: STACK_GPIO_PIN_PERST = 12
```

Pin label parsing (`parse_tca_pin_label()`):
- `"WK"` → pin 11 (old STACK_GPIO_PIN_WAKE)
- `"PE"` → pin 12 (old STACK_GPIO_PIN_PERST)

### Required Changes

With the new pin enum, the LTE module control pins move to:

| Signal | Old Pin | New Pin (TCA6416A) |
|---|---|---|
| WAKE# (power) | STACK_GPIO_PIN_WAKE = 11 | STACK_GPIO_PIN_05 = 5 (P05) |
| PERST# (reset) | STACK_GPIO_PIN_PERST = 12 | STACK_GPIO_PIN_06 = 6 (P06) |

### Action Required

- [ ] **Update `parse_tca_pin_label()` in config_handler.c:**
  - `"WK"` → `STACK_GPIO_PIN_05` (= 5) instead of 11
  - `"PE"` → `STACK_GPIO_PIN_06` (= 6) instead of 12
  - Update numeric labels `"01"`–`"11"` → `"00"`–`"17"` to match new 16-pin scheme
- [ ] **Update default values in `lte_config_persistent_t`:**
  - `pwr_pin` default → 5 (was 11)
  - `rst_pin` default → 6 (was 12)
- [ ] **Update CFLT command format** (if renamed from LT):
  - New format should accept pin labels matching the new IO expander layout
  - Example: `LT:A7600C1:v-internet:::USB:true:30000:0:05:06`
- [ ] **Update `lte_connect.c`** — any code that calls `stack_handler_gpio_write(0, pwr_pin, ...)` will work automatically if pin enum is updated, but verify the logic
- [ ] **Update NVS migration** — existing NVS `"lte_cfg"` with old pin numbers need migration or reset

### Files to Modify

| File | Changes |
|---|---|
| `DA2_esp/Application/Config_Handler/src/config_handler.c` | `parse_tca_pin_label()`, default pin values |
| `DA2_esp/Application/Config_Handler/include/config_handler.h` | If struct is there |
| `DA2_esp/Middleware/LTE_Handler/src/lte_handler.c` | Verify pin usage |
| LTE connect files | Default pin values |

---

## 8. Task 7 — LAN Adapter Connector Pin Changes

**Status: ⚠️ NEEDS UPDATE**

### Pin Comparison Table

| Signal | Old GPIO | New GPIO | Status |
|---|---|---|---|
| **LAN1 UART TX** | GPIO_NUM_17 | GPIO_NUM_17 | ✅ SAME |
| **LAN1 UART RX** | GPIO_NUM_18 | GPIO_NUM_18 | ✅ SAME |
| **LAN2 UART TX** | GPIO_NUM_15 | **GPIO_NUM_8** | ❌ DIFF |
| **LAN2 UART RX** | GPIO_NUM_16 | **GPIO_NUM_21** | ❌ DIFF |
| **SPI3 CS0** | GPIO_NUM_15 | **GPIO_NUM_38** | ❌ DIFF |
| **SPI3 CS1** | GPIO_NUM_5 | **GPIO_NUM_39** | ❌ DIFF |
| **SPI3 CLK** | GPIO_NUM_14/18 | **GPIO_NUM_41** | ❌ DIFF |
| **SPI3 MISO** | GPIO_NUM_12/19 | **GPIO_NUM_42** | ❌ DIFF |
| **SPI3 MOSI** | GPIO_NUM_13/23 | **GPIO_NUM_40** | ❌ DIFF |
| **I2C SDA** | GPIO_NUM_02 | GPIO_NUM_02 | ✅ SAME |
| **I2C SCL** | GPIO_NUM_01 | GPIO_NUM_01 | ✅ SAME |
| **USB D+/D-** | MCU fixed | MCU fixed | ✅ SAME |
| **LAN1 IO_EXP INT** | GPIO21 (shared) | **GPIO_NUM_47** | ❌ DIFF |
| **LAN2 IO_EXP INT** | GPIO21 (shared) | **GPIO_NUM_48** | ❌ DIFF |
| **USB Switch Ctrl** | N/A | **GPIO_NUM_46** | 🆕 NEW |

---

## 9. Task 8 — LAN Stack Handler Rewrite (IO Expander on Adapter)

**Status: ❌ NEEDS COMPLETE REWRITE**

### Current State

**File:** `DA2_esp_LAN/BSP/stack_handler/`

```c
// Current: Single TCA6424A (3 ports) shared between 2 stacks
// Stack 1: GPIO1-9 mapped across Port 1 & Port 2
// Stack 2: GPIO1-9 mapped across Port 0 & Port 1
#define STACK_HANDLER_MAX_STACKS 2
#define STACK_GPIO_PIN_COUNT 11  // 9 GPIO + WAKE# + PERST#
```

### Required New Design

Each adapter board now has **its own TCA6416A** IO expander. The main board no longer has a TCA.

```c
// New: Each adapter has TCA6416A (2 ports × 8 = 16 pins)
// Both adapters have identical pin layout:
typedef enum {
  STACK_GPIO_PIN_00 = 0,   // P00 — ADDR bit 0
  STACK_GPIO_PIN_01 = 1,   // P01 — ADDR bit 1
  STACK_GPIO_PIN_02 = 2,   // P02 — ADDR bit 2
  STACK_GPIO_PIN_03 = 3,   // P03 — ADDR bit 3
  STACK_GPIO_PIN_04 = 4,   // P04
  STACK_GPIO_PIN_05 = 5,   // P05
  STACK_GPIO_PIN_06 = 6,   // P06
  STACK_GPIO_PIN_07 = 7,   // P07
  STACK_GPIO_PIN_10 = 8,   // P10
  STACK_GPIO_PIN_11 = 9,   // P11
  STACK_GPIO_PIN_12 = 10,  // P12
  STACK_GPIO_PIN_13 = 11,  // P13
  STACK_GPIO_PIN_14 = 12,  // P14
  STACK_GPIO_PIN_15 = 13,  // P15
  STACK_GPIO_PIN_16 = 14,  // P16
  STACK_GPIO_PIN_17 = 15,  // P17 — IOX_SLOTDET (0 = Slot 1, 1 = Slot 2)
} stack_gpio_pin_num_t;
```

### Major Architectural Changes

**A) TCA Handler Refactor (Multi-Instance):**

The current `tca_handler` is a singleton — one global TCA device. The new design requires **two independent TCA6416A instances** (one per adapter slot):

- [ ] Refactor `tca_handler` to support multiple instances (pass handle/context instead of using globals)
- [ ] Each TCA6416A has its own I2C address (0x20 or 0x21)
- [ ] Each adapter has its own INT pin (LAN1=GPIO47, LAN2=GPIO48)
- [ ] TCA reset is per-adapter (adapter board has its own RST circuit)

**B) Stack Handler Multi-Instance:**

- [ ] Each stack (adapter slot) gets its own TCA handle
- [ ] `stack_handler_init()` flow:
  1. Scan I2C for TCA6416A at 0x20 and 0x21
  2. For each found TCA, read **P17 (IOX_SLOTDET)**:
     - P17 = 0 → this is **Slot 1 (LAN ADAPTER 1)**
     - P17 = 1 → this is **Slot 2 (LAN ADAPTER 2)**
  3. Read P00–P03 to get the 4-bit stack address (0b0000 to 0b1111)
  4. Store: `stack_1_id`, `stack_2_id`, and corresponding TCA handles
- [ ] `stack_handler_gpio_read/write()` routes to the correct TCA instance based on `stack_id`

**C) Address Collision Bug Fix:**

> "Both adapters could have the same I2C address, so the gateway 2 adapters must have different addresses."

- [ ] The two adapter boards MUST be configured with different I2C addresses (one at 0x20, one at 0x21)
- [ ] If both are 0x20, the firmware must detect collision and log error
- [ ] The ADDR pin on the TCA6416A must be wired differently on each adapter

**D) GPIO Pin Mapping Simplification:**

Since each adapter has its own TCA6416A with identical pinout, the mapping becomes trivial:

```c
// For ANY adapter:
// pin 0-7  → TCA_PORT_0, pin 0-7
// pin 8-15 → TCA_PORT_1, pin 0-7
static void get_tca_mapping(stack_gpio_pin_num_t pin, tca_port_t *port, uint8_t *pin_num) {
    *port    = (pin < 8) ? TCA_PORT_0 : TCA_PORT_1;
    *pin_num = pin % 8;
}
```

No more separate `stack1_gpio_map[]` and `stack2_gpio_map[]`.

### Files to Modify

| File | Changes |
|---|---|
| `DA2_esp_LAN/BSP/stack_handler/include/stack_handler.h` | New enum, multi-instance API |
| `DA2_esp_LAN/BSP/stack_handler/src/stack_handler.c` | Complete rewrite: multi-TCA, slot detect, ID read |
| `DA2_esp_LAN/BSP/i2c_dev_support/include/tca_handler.h` | Multi-instance, TCA6416A support, new addr |
| `DA2_esp_LAN/BSP/i2c_dev_support/src/tca_handler.c` | Multi-instance, TCA6416A register map |
| `DA2_esp_LAN/Application/Module_Monitor_Task/` | Use real detected stack IDs instead of hardcoded |

---

## 10. Task 9 — LAN Module SPI Pin Update

**Status: ❌ NEEDS UPDATE**

### Current State

**File:** `DA2_esp_LAN/BSP/Module_SPI_Communication/include/module_spi_comm.h`

```c
// Current Stack 0: SPI2_HOST
MOSI=GPIO13, MISO=GPIO12, SCLK=GPIO14, CS=GPIO15

// Current Stack 1: SPI3_HOST
MOSI=GPIO23, MISO=GPIO19, SCLK=GPIO18, CS=GPIO5
```

### New Pin Assignment

Both LAN1 and LAN2 adapters share the same SPI3 bus, distinguished by CS:

```c
// New: Shared SPI3 bus for both adapters
S_SPI3_CLK  = GPIO_NUM_41
S_SPI3_MOSI = GPIO_NUM_40
S_SPI3_MISO = GPIO_NUM_42
S_SPI3_CS0  = GPIO_NUM_38  // LAN1 adapter
S_SPI3_CS1  = GPIO_NUM_39  // LAN2 adapter
```

### Action Required

- [ ] Update `module_spi_comm.h` pin definitions for both stacks
- [ ] Both stacks now use the **same SPI host** (SPI3_HOST) with different CS pins
- [ ] Update bus initialization — single SPI bus init, two device configs with different CS
- [ ] Ensure mutual exclusion: only one adapter talks SPI at a time (use mutex)

### Files to Modify

| File | Changes |
|---|---|
| `DA2_esp_LAN/BSP/Module_SPI_Communication/include/module_spi_comm.h` | New GPIO defines |
| `DA2_esp_LAN/BSP/Module_SPI_Communication/src/module_spi_comm.c` | Shared bus, 2 CS |

---

## 11. Task 10 — LAN Module UART Pin Update (LAN2)

**Status: ❌ NEEDS UPDATE (LAN2 only)**

### Current State

**File:** `DA2_esp_LAN/BSP/Module_UART_Communication/include/module_uart_comm.h`

```c
// Current:
// Stack 0 (LAN1): UART_NUM_2, TX=GPIO17, RX=GPIO18  ← OK
// Stack 1 (LAN2): UART_NUM_1, TX=GPIO15, RX=GPIO16  ← WRONG
```

### New Pin Assignment

```c
// Stack 0 (LAN1): UART_NUM_2, TX=GPIO17, RX=GPIO18  ← SAME ✅
// Stack 1 (LAN2): UART_NUM_1, TX=GPIO8,  RX=GPIO21  ← NEW ❌
```

### Action Required

- [ ] Update LAN2 (Stack 1) UART TX pin: GPIO15 → **GPIO8**
- [ ] Update LAN2 (Stack 1) UART RX pin: GPIO16 → **GPIO21**
- [ ] Also update RS485 handler if it shares same UART pins for Stack 2
- [ ] Verify no GPIO conflict with SD card (GPIO8 is also SD D0 — potential conflict!)

### ⚠️ GPIO Conflict Warning

GPIO8 is currently used by SD card as D0 data line. If both SD card and LAN2 UART are active simultaneously, this is a hardware conflict. Verify with schematic if SD card pins have changed too.

### Files to Modify

| File | Changes |
|---|---|
| `DA2_esp_LAN/BSP/Module_UART_Communication/include/module_uart_comm.h` | Stack 1 TX/RX pins |
| `DA2_esp_LAN/BSP/Module_UART_Communication/src/module_uart_comm.c` | If pins are hardcoded in init |
| `DA2_esp_LAN/BSP/RS485_Communication/include/rs485_comm.h` | Stack 2 TX/RX if shared |
| `DA2_esp_LAN/BSP/RS485_Communication/src/rs485_comm.c` | If pins are hardcoded |

---

## 12. Task 11 — LAN USB Switch Control Pin

**Status: 🆕 NEW FEATURE**

### Description

Both LAN1 and LAN2 adapters share the same USB D+/D- lines. A USB switch IC (controlled by GPIO46) selects which adapter is connected.

### Action Required

- [ ] Add GPIO46 initialization as output in `DA2_esp_LAN.c` boot sequence
- [ ] Define `USB_SWITCH_CTRL_GPIO = GPIO_NUM_46`
- [ ] Convention: `LOW` = connect to LAN1 adapter, `HIGH` = connect to LAN2 adapter (verify with schematic)
- [ ] Update `module_usb_comm` to accept a stack_id and switch USB before communication
- [ ] Add mutual exclusion — USB can only serve one adapter at a time

### Files to Modify

| File | Changes |
|---|---|
| `DA2_esp_LAN/BSP/Module_USB_Communication/include/module_usb_comm.h` | USB switch GPIO define |
| `DA2_esp_LAN/BSP/Module_USB_Communication/src/module_usb_comm.c` | Switch logic before USB ops |
| `DA2_esp_LAN/main/DA2_esp_LAN.c` | GPIO46 init |

---

## 13. Task 12 — LAN SD Card / SDIO Pin Check

**Status: ⚠️ NEEDS VERIFICATION**

### Current SD Card Pins

```c
// From sdcard_comm.h:
CLK=GPIO7, CMD=GPIO6, D0=GPIO8, D1=GPIO3, D2=GPIO4, D3=GPIO5
```

### Concern

The todo.md mentions `S_SDIO0 CHECK: MSD_CD` — this suggests the SD card detect pin needs checking. Also, GPIO8 conflict with LAN2 UART TX noted above.

### Action Required

- [ ] Verify SD card GPIO pins against new schematic
- [ ] Check if MSD_CD (card detect) pin needs a GPIO assignment
- [ ] Resolve GPIO8 conflict: if SD card still uses GPIO8, LAN2 UART TX must change or SD card must be disabled during LAN2 UART use
- [ ] If SD card pins changed, update `sdcard_comm.h`

---

## 14. Task 13 — TCA6424A Address & IC Change (TCA6416A)

**Status: ❌ NEEDS COMPLETE REWORK (BOTH PROJECTS)**

### Current State (Both DA2_esp and DA2_esp_LAN)

```c
// tca_handler.h:
#define TCA_I2C_ADDR   0x22    // TCA6424A with ADDR=GND
#define TCA_INT_GPIO   21      // Interrupt pin
#define TCA_RST_GPIO   47      // Hardware reset pin

typedef enum { TCA_PORT_0, TCA_PORT_1, TCA_PORT_2 } tca_port_t;  // 3 ports
```

### TCA6424A vs TCA6416A Register Map Comparison

| Register | TCA6424A | TCA6416A |
|---|---|---|
| Input Port 0 | 0x00 | 0x00 |
| Input Port 1 | 0x01 | 0x01 |
| Input Port 2 | 0x02 | *N/A* |
| Output Port 0 | 0x04 | 0x02 |
| Output Port 1 | 0x05 | 0x03 |
| Output Port 2 | 0x06 | *N/A* |
| Polarity Port 0 | 0x08 | 0x04 |
| Polarity Port 1 | 0x09 | 0x05 |
| Polarity Port 2 | 0x0A | *N/A* |
| Config Port 0 | 0x0C | 0x06 |
| Config Port 1 | 0x0D | 0x07 |
| Config Port 2 | 0x0E | *N/A* |

### Action Required

**For both DA2_esp and DA2_esp_LAN:**

- [ ] Update `tca_handler` register definitions for TCA6416A
- [ ] Remove TCA_PORT_2 from `tca_port_t` enum
- [ ] Update I2C address: `0x22` → `0x20` / `0x21`
- [ ] **WAN (DA2_esp):**
  - Single TCA6416A on adapter, INT=GPIO47, RST=GPIO48
  - I2C address: 0x20 or 0x21 (scan to find)
- [ ] **LAN (DA2_esp_LAN):**  
  - Multi-instance: two TCA6416A (one per adapter)
  - LAN1 INT=GPIO47, LAN2 INT=GPIO48
  - Addresses: 0x20 and 0x21 (one each)
  - Refactor to instance-based API (handle per TCA)

### Files to Modify

| File | Changes |
|---|---|
| `DA2_esp/BSP/i2c_dev_support/include/tca_handler.h` | Register map, addr, remove Port 2 |
| `DA2_esp/BSP/i2c_dev_support/src/tca_handler.c` | Register offsets, 2-port operations |
| `DA2_esp_LAN/BSP/i2c_dev_support/include/tca_handler.h` | Same + multi-instance |
| `DA2_esp_LAN/BSP/i2c_dev_support/src/tca_handler.c` | Same + multi-instance |

---

## 15. Task 14 — WAN Power Source Handler Update

**Status: ❌ NOT STARTED — Full rewrite needed**

### Current State

`pwr_source_handler.c/h` directly calls `tca_set_pin_verified(TCA_PORT_1, P1_5/6/7, ...)` to switch 1.8V / 3.3V / 5V rails. This no longer applies — TCA6424A is gone and the new board manages power via the BQ25892 charger IC. System power rails are regulator-fed from VSYS and are always-on.

### New Responsibility of `pwr_source_handler`

The file is repurposed as the **power management coordinator**:

| Old Responsibility | New Responsibility |
|---|---|
| Set 1.8V/3.3V/5V via TCA GPIO | **Removed** (rails are regulator-controlled) |
| *(none)* | Battery charger control (BQ25892 via I2C + GPIO) |
| *(none)* | System voltage/current monitoring (INA230 via I2C) |
| *(none)* | Battery SoC and health (BQ27441 via I2C) |
| *(none)* | Threshold-based charge enable/disable logic |

### New Header (`pwr_source_handler.h`)

```c
// Battery voltage thresholds
#define PWR_BATT_UPPER_THRESHOLD_MV   4100   // Stop charging above this
#define PWR_BATT_LOWER_THRESHOLD_MV   3500   // Low battery alert below this

// BC_IO discrete GPIO pins (verify from schematic netlist)
#define BC_CE_GPIO_NUM    GPIO_NUM_XX   // Charge Enable (active-low output)
#define BC_OTG_GPIO_NUM   GPIO_NUM_XX   // OTG Enable (output)
#define BC_INT_GPIO_NUM   GPIO_NUM_XX   // Charger Interrupt (input)
#define BC_STAT_GPIO_NUM  GPIO_NUM_XX   // Charge Status (input)
#define BC_PG_GPIO_NUM    GPIO_NUM_XX   // Power Good (input, active-low)
#define BC_PSEL_GPIO_NUM  GPIO_NUM_XX   // Power Select (output)

typedef struct {
    uint16_t vbat_mv;          // Battery voltage from BQ27441
    uint16_t vsys_mv;          // System voltage from INA230
    int16_t  isys_ma;          // System current from INA230
    int16_t  ibat_ma;          // Battery avg current from BQ27441
    uint8_t  soc_percent;      // State of charge from BQ27441
    bool     is_charging;      // BQ25892 CHRG_STAT != 0b00
    bool     power_good;       // BC_PG# pin state (LOW = PG)
    bool     charge_enabled;   // Current CE# state
} pwr_source_status_t;

esp_err_t pwr_source_init(void);                         // Init all 3 ICs + GPIO
esp_err_t pwr_source_set_charge_enable(bool enable);     // Drive BC_CE# + BQ25892 CHG_CONFIG
esp_err_t pwr_source_set_otg(bool enable);               // Drive BC_OTG
esp_err_t pwr_source_get_status(pwr_source_status_t *s); // Read all ICs into struct
esp_err_t pwr_source_charge_monitor(void);               // Threshold check, call periodically
void      pwr_source_int_handler(void *arg);             // GPIO ISR for BC_INT
```

### New Implementation (`pwr_source_handler.c`)

#### `pwr_source_init()`
1. Configure BC_CE#, BC_OTG, BC_PSEL as outputs (default: charge enabled, OTG off)
2. Configure BC_INT, BC_STAT, BC_PG# as inputs (INT with falling-edge interrupt)
3. Call `bq25892_init()` → set IINLIM=3A, VREG=4096mV (≈4.1V), BATLOWV=3V
4. Call `ina230_init()` → set calibration for R=10mΩ, max_current=5A
5. Call `bq27441_init()` → check device present, read initial VOLT + FLAGS
6. Register BC_INT GPIO ISR → `pwr_source_int_handler()`

#### `pwr_source_charge_monitor()` (called every 30s from a monitor task)
```c
esp_err_t pwr_source_charge_monitor(void) {
    uint16_t vbat_mv = bq27441_read_voltage_mv();
    if (vbat_mv == 0) return ESP_FAIL;  // Comms error

    if (vbat_mv > PWR_BATT_UPPER_THRESHOLD_MV) {
        pwr_source_set_charge_enable(false);
        ESP_LOGI(TAG, "Charge stopped: VBAT=%umV > %umV", vbat_mv, PWR_BATT_UPPER_THRESHOLD_MV);
    } else if (vbat_mv < PWR_BATT_LOWER_THRESHOLD_MV) {
        pwr_source_set_charge_enable(true);
        ESP_LOGW(TAG, "Low battery: VBAT=%umV < %umV", vbat_mv, PWR_BATT_LOWER_THRESHOLD_MV);
    }
    return ESP_OK;
}
```

#### `pwr_source_int_handler()` (ISR for BC_INT)
- From ISR: post a task notification or give a binary semaphore to the monitor task
- Monitor task reads BQ25892 REG09 (Fault Register) and REG0B (Status)
- Logs: charge complete, fault type, input overvoltage, etc.

### Files to Modify / Create

| File | Action | Changes |
|---|---|---|
| `DA2_esp/main/pwr_source_handler.h` | **Rewrite** | New struct, new API, BC_IO pin defines, threshold defines |
| `DA2_esp/main/pwr_source_handler.c` | **Rewrite** | Remove all TCA calls; add BQ25892/INA230/BQ27441 coordination |
| `DA2_esp/BSP/i2c_dev_support/include/bq25892_handler.h` | **Create** | BQ25892 I2C driver API |
| `DA2_esp/BSP/i2c_dev_support/src/bq25892_handler.c` | **Create** | BQ25892 register read/write, charge voltage set, status read |
| `DA2_esp/BSP/i2c_dev_support/include/ina230_handler.h` | **Create** | INA230 I2C driver API |
| `DA2_esp/BSP/i2c_dev_support/src/ina230_handler.c` | **Create** | INA230 calibration, voltage/current read |
| `DA2_esp/BSP/i2c_dev_support/include/bq27441_handler.h` | **Create** | BQ27441 I2C driver API |
| `DA2_esp/BSP/i2c_dev_support/src/bq27441_handler.c` | **Create** | BQ27441 standard commands, VOLT/SoC/FLAGS read |
| `DA2_esp/BSP/i2c_dev_support/CMakeLists.txt` | **Update** | Add new source files |
| `DA2_esp/main/DA2_esp.c` | **Update** | Remove old `pwr_source_init()` call path that assumed TCA; no API break |

### Dependencies

- Depends on **Task 5** (TCA6416A handler done) — shared I2C bus is already initialized by `i2c_dev_support_init()`
- `bq25892_init()`, `ina230_init()`, `bq27441_init()` all call `i2c_dev_support_add_device()` with their respective addresses
- The BC_IO GPIO numbers must be confirmed from the schematic netlist before writing `pwr_source_handler.h`

---

## 16. Task 15 — LoRa Gateway (Uplink) Implementation

**Status: ❌ NOT STARTED — New Feature**

### Overview

To use the Wio-E5 module as a **LoRaWAN uplink gateway** (receive any LoRa packet and forward to ChirpStack LNS), three components must be built:

1. **JSON config** — 4 TEST mode functions already added to `stack_006_config.json`
2. **LAN MCU** — dedicated `lora_gateway_rx_task` that arms the module and loops on `+TEST:` events
3. **WAN MCU** — Semtech UDP Packet Forwarder handler to push raw packets to ChirpStack port 1700

---

### 16.1. Module-Side: TEST Mode Function Set

The following functions are already present in `stack_006_config.json` (added in this revision):

| Function | Command | Purpose |
|---|---|---|
| `MODULE_SET_TEST_MODE` | `AT+MODE=TEST` | Switch module to TEST mode |
| `MODULE_SET_RFCFG` | `AT+TEST=RFCFG,<params>` | Configure freq/SF/BW/power |
| `MODULE_START_RX` | `AT+TEST=RXLRPKT` | Arm one RX cycle |
| `MODULE_READ_TESTPKT` | *(async)* | Listener for `+TEST: LEN:` event |

RFCFG parameter format: `<freq_MHz>,<SF>,<BW_kHz>,<preamble>,<TX_timeout>,<TX_power>,NET:<ON/OFF>,IQ:<ON/OFF>,CRC:<ON/OFF>`
Example: `AT+TEST=RFCFG,923.2,SF7,125,12,15,14,ON,OFF,ON`

**Gateway RX event format** (two consecutive UART lines):
```
+TEST: LEN:23, RSSI:-57, SNR:9
+TEST: RX "401A2B3C00..."
```
This is different from end-node downlink (`+MSG: RX:`) and requires a separate parser.

---

### 16.2. LAN MCU — Gateway RX Task

**File to create:** `DA2_esp_LAN/Application/LoRa_Gateway_Task/lora_gateway_task.c`

```c
// Active only when module_type == LORA and gateway mode is set
// Stateful loop: arm → wait for +TEST: LEN: → parse → forward → re-arm
void lora_gateway_rx_task(void *arg) {
    char line1[128], line2[128];
    /* Arm the first RX cycle */
    stack_module_exec_function(stack_id, "MODULE_START_RX", NULL);
    for (;;) {
        /* Block on +TEST: LEN: line from UART */
        if (module_uart_readline(stack_id, line1, sizeof(line1), portMAX_DELAY) <= 0)
            goto rearm;
        if (strncmp(line1, "+TEST: LEN:", 11) != 0)
            goto rearm;
        /* Read the paired +TEST: RX line (500ms window) */
        if (module_uart_readline(stack_id, line2, sizeof(line2), 500) <= 0)
            goto rearm;
        if (strncmp(line2, "+TEST: RX", 9) != 0)
            goto rearm;
        /* Parse metadata from line1 and payload from line2 */
        lora_raw_pkt_t pkt;
        if (lora_parse_test_rx(line1, line2, &pkt) == ESP_OK)
            spi_send_to_wan(FRAME_LORA_RAW_PKT, &pkt, sizeof(pkt));
rearm:
        vTaskDelay(pdMS_TO_TICKS(20));
        stack_module_exec_function(stack_id, "MODULE_START_RX", NULL);
    }
}
```

**Packet struct:**
```c
typedef struct {
    uint8_t  payload[256];
    uint16_t len;
    int16_t  rssi;
    int8_t   snr;
    uint32_t tmst_us;   /* local timestamp for Semtech PF */
} lora_raw_pkt_t;
```

**Action Required:**
- [ ] Create `DA2_esp_LAN/Application/LoRa_Gateway_Task/` directory and source files
- [ ] Implement `lora_parse_test_rx()` — parse RSSI/SNR from line1, hex payload from line2
- [ ] Add `FRAME_LORA_RAW_PKT` frame type constant to SPI WAN-LAN protocol header
- [ ] Spawn `lora_gateway_rx_task` from `module_monitor_task` when gateway mode is active
- [ ] Ensure task does NOT run simultaneously with normal end-node TX operations (mutex)

---

### 16.3. WAN MCU — Semtech UDP Packet Forwarder

**File to create:** `DA2_esp/Middleware/LoRa_Gateway_Handler/lora_gw_handler.c`

The WAN MCU must implement the **Semtech UDP Packet Forwarder protocol** (not MQTT) to talk to ChirpStack:

```
LAN MCU → SPI (FRAME_LORA_RAW_PKT) → WAN MCU → UDP port 1700 → ChirpStack LNS
                                                     PUSH_DATA JSON
```

**PUSH_DATA JSON structure:**
```json
{
  "rxpk": [{
    "tmst": 1234567,
    "freq": 923.2,
    "datr": "SF7BW125",
    "rssi": -57,
    "lsnr": 9.0,
    "size": 23,
    "data": "<base64(payload)>"
  }]
}
```

**Semtech UDP packet structure:**
```
[0]    Protocol version: 0x02
[1-2]  Random token (2 bytes)
[3]    Identifier: 0x00 (PUSH_DATA)
[4-11] Gateway EUI (8 bytes, use ESP32 MAC)
[12+]  JSON payload (null-terminated)
```

**Action Required:**
- [ ] Add `FRAME_LORA_RAW_PKT` handler to SPI receive dispatch in WAN MCU
- [ ] Create `lora_gw_handler.c` with `semtech_push_uplink()` function
- [ ] Use `lwip` UDP socket (`sendto()` to ChirpStack IP:1700) — already available in ESP-IDF
- [ ] Handle PULL_DATA/PULL_RESP for confirmed downlink (future, not required for uplink-only)
- [ ] Add ChirpStack server IP and port to gateway NVS config (new CFGW command or extend existing web portal)
- [ ] Generate gateway EUI from ESP32 Wi-Fi MAC (`esp_wifi_get_mac()`)

---

### 16.4. Data Path Summary

```
Server (ChirpStack)
  │
  │  [Config phase — once]
  │  MQTT config/update → MODULE_SET_TEST_MODE
  │  MQTT config/update → MODULE_SET_RFCFG,923.2,SF7,125,12,15,14,ON,OFF,ON
  │  MQTT config/update → MODULE_START_RX
  ↓
WAN MCU → SPI → LAN MCU → AT commands → Wio-E5 (enters continuous RX loop)

[LoRa end-node transmits]
  ↓
Wio-E5 → UART → LAN MCU (parse +TEST: lines) → SPI → WAN MCU → UDP 1700 → ChirpStack
                                                                     PUSH_DATA JSON  ↑
                                                              Application Server ← MQTT
```

### Files to Create / Modify

| File | Change |
|---|---|
| `DA2_esp_LAN/Application/LoRa_Gateway_Task/lora_gateway_task.c` | New: gateway RX loop + parser |
| `DA2_esp_LAN/Application/LoRa_Gateway_Task/lora_gateway_task.h` | New: task API + `lora_raw_pkt_t` |
| `DA2_esp/Middleware/LoRa_Gateway_Handler/lora_gw_handler.c` | New: Semtech UDP PF handler |
| `DA2_esp/Middleware/LoRa_Gateway_Handler/lora_gw_handler.h` | New: `semtech_push_uplink()` API |
| `DA2_esp_LAN/BSP/MCU_WAN_Communication/include/lan_comm.h` | Add `FRAME_LORA_RAW_PKT` frame ID |
| `DA2_esp/BSP/MCU_LAN_Communication/include/lan_comm.h` | Add `FRAME_LORA_RAW_PKT` frame ID |
| `DATN_config_app/src/config/stack_006_config.json` | Already updated (4 new test mode functions) |

---

## 17. Task 16 — HMI Display Integration (TJC3224K024_011RN)

**Status: ❌ NOT STARTED — New Feature**

### Overview

Add an on-device touchscreen configuration and status interface using the **TJC3224K024_011RN** 2.4" USART HMI display (320×240 px, resistive touch). The display connects to the WAN MCU via UART2 through the existing UART switch (see Task 3).

> **Full UI design:** See [`docs/HMI_DISPLAY_UI_DESIGN.md`](HMI_DISPLAY_UI_DESIGN.md)

### Feature Set

| Feature | Details |
|---|---|
| **WiFi Config** | SSID, Password, Auth Mode (PERSONAL/ENTERPRISE) → sends `CFWF` + `CFIN:WIFI` |
| **LTE Config** | APN, Username, Password → sends `CFLT` + `CFIN:LTE` (all other params are defaults) |
| **WiFi Status** | Connected/Disconnected + SSID + signal + auth mode, color-coded |
| **LTE Status** | Connected/Disconnected + APN + modem name + CSQ, color-coded |
| **Battery %** | SoC % from BQ27441, color-coded progress bar + text (green→yellow→orange→red) |

### Display Pages

| Page | Name | Purpose |
|---|---|---|
| 0 | `home` | Always-on status: WiFi, LTE, battery %, nav buttons |
| 1 | `pgWifi` | WiFi SSID / Password / Auth config form |
| 2 | `pgLTE` | LTE APN / Username / Password config form |
| 3 | `pgKB` | Alphanumeric keyboard for text entry |

### Page 0 — Home Status Screen (320×240 px)

```
┌─────────────────────────────────────────┐  y=0
│ DA2 Gateway             [====] 85%      │  y=0..26  status bar
├─────────────────────────────────────────┤  y=26
│ WiFi                                    │  y=30..51 section header (cyan)
│  ● Connected          HomeNetwork       │  y=55..76 status row (green dot)
│    Signal: -65 dBm  Auth: PERSONAL      │  y=80..100 detail (gray)
├ · · · · · · · · · · · · · · · · · · · ·┤  y=105
│ LTE                                     │  y=109..130 section header (cyan)
│  ● Connected          v-internet        │  y=134..155 status row (green dot)
│    Modem: A7600C1   CSQ: 18/31          │  y=159..179 detail (gray)
├─────────────────────────────────────────┤  y=184
│  [    WiFi CFG    ]   [    LTE CFG    ] │  y=192..237 nav buttons (blue)
└─────────────────────────────────────────┘  y=240
```

### Page 1 — WiFi Config (320×240 px)

```
┌─────────────────────────────────────────┐  y=0
│ [←]   WiFi Configuration               │  y=0..35  header
├─────────────────────────────────────────┤  y=35
│  SSID                                   │  y=42 label
│  ┌──────────────────────────────────┐   │  y=60 xstr input (tap → keyboard)
│  │  HomeNetwork                     │   │  h=36
│  └──────────────────────────────────┘   │
│  Password                               │  y=103 label
│  ┌──────────────────────────────────┐   │  y=121 xstr input (masked)
│  │  ●●●●●●●●                        │   │  h=36
│  └──────────────────────────────────┘   │
│  Auth Mode                              │  y=164 label
│  [ PERSONAL ▼ ]  (tap to toggle)        │  y=184 toggle button
├─────────────────────────────────────────┤
│  [ Cancel ]           [ ✓ Set WiFi ]    │  y=220..240 action row
└─────────────────────────────────────────┘
```

### Page 2 — LTE Config (320×240 px)

```
┌─────────────────────────────────────────┐  y=0
│ [←]   LTE Configuration                │  y=0..35  header
├─────────────────────────────────────────┤  y=35
│  APN                                    │  y=40 label
│  ┌──────────────────────────────────┐   │  y=58 xstr input (tap → keyboard)
│  │  v-internet                      │   │  h=32
│  └──────────────────────────────────┘   │
│  Username  (optional)                   │  y=95 label
│  ┌──────────────────────────────────┐   │  y=113 xstr input
│  │                                  │   │  h=32
│  └──────────────────────────────────┘   │
│  Password  (optional)                   │  y=150 label
│  ┌──────────────────────────────────┐   │  y=168 xstr input (masked)
│  │  ●●●●●●                          │   │  h=32
│  └──────────────────────────────────┘   │
├─────────────────────────────────────────┤
│  [ Cancel ]           [ ✓ Set LTE ]     │  y=204..240 action row
└─────────────────────────────────────────┘
```

### Commands Sent to Gateway

| Action | Commands Sent |
|---|---|
| WiFi Set | `CFWF:<SSID>:<PASSWORD>:<AUTH_MODE>` then after 1s: `CFIN:WIFI` |
| LTE Set | `CFLT:<modem>:<apn>:<user>:<pass>:USB:true:30000:0:05:06` then after 1s: `CFIN:LTE` |

All commands are identical to the PC app basic mode (`basic_panel.py` — `_set_wifi_config()` / `_set_lte_config()`). The modem name is read from the detected WAN stack ID at runtime.

### Battery % Color Rules

| SoC Range | Display Color | TJC RGB565 |
|---|---|---|
| ≥ 50% | Green | 6144 |
| 20–49% | Yellow | 64992 |
| 10–19% | Orange | 64512 |
| < 10% | Red | 63494 |

SoC value comes from `bq27441_read_soc_percent()` (Task 4 / Task 14 dependency).

### Action Checklist

- [ ] **Verify UART switch GPIO** from schematic netlist (shared with Task 3)
- [ ] **Create `DA2_esp/BSP/hmi_handler.h`** — API: `hmi_init()`, `hmi_enter_mode()`, `hmi_exit_mode()`, `hmi_refresh_status()`, `hmi_handle_touch()`, `hmi_status_t` struct; `#define HMI_UART_SWITCH_GPIO GPIO_NUM_46`
- [ ] **Create `DA2_esp/BSP/hmi_handler.c`** — UART send/receive, page management, keyboard routing, `hmi_submit_wifi()`, `hmi_submit_lte()`
- [ ] **Design TJC project** (`.hmi` file in TJC Editor) — 4 pages with component IDs matching design doc
- [ ] **Flash TJC firmware** (`.tft` binary) to display over UART
- [ ] **Add status refresh call** in `DA2_esp.c` main task loop (every 30s) or create a dedicated `hmi_monitor_task`
- [ ] **Integrate battery SoC** from `pwr_source_get_status()` (depends on Task 14)
- [ ] **Integrate WiFi/LTE status** from `wifi_connect` / `lte_connect` handlers
- [ ] **Add HMI mode trigger** — long-press GPIO45 button (500ms) switches to HMI mode
- [ ] **Add auto-exit from HMI** — after 2 minutes of no touch, auto return to LAN MCU mode

### Files to Create / Modify

| File | Action | Changes |
|---|---|---|
| `DA2_esp/BSP/hmi_handler.h` | **Create** | `hmi_status_t`, all API functions, GPIO/UART defines |
| `DA2_esp/BSP/hmi_handler.c` | **Create** | Full implementation (UART, page nav, touch handler, cmd builder) |
| `DA2_esp/BSP/CMakeLists.txt` | **Update** | Add `hmi_handler.c` to sources |
| `DA2_esp/main/DA2_esp.c` | **Update** | Add `hmi_enter_mode()` on long-press, `hmi_refresh_status()` in main loop |
| `DA2_esp/main/DA2_esp.h` | **Update** | Include `hmi_handler.h` |
| `docs/HMI_DISPLAY_UI_DESIGN.md` | **Created** | Full UI design: page layouts, component tables, TJC UART protocol |

### Dependencies

- **Task 3** (UART switch GPIO) — must be resolved first
- **Task 14** (BQ27441 fuel gauge driver) — required for battery SoC data
- WiFi connect handler and LTE connect handler must expose status query API

---

## 18. Summary Matrix

| # | Task | DA2_esp (WAN) | DA2_esp_LAN (LAN) | Status |
|---|---|---|---|---|
| 1 | SPI WAN↔LAN pins | ✅ | ✅ | DONE |
| 2 | INT/RST/DATA_READY | ✅ | ✅ | DONE |
| 3 | UART WAN↔LAN | ✅ | ✅ | DONE (+ UART switch TBD) |
| 4 | Power/Charger control | ❌ Redesign | — | NOT STARTED |
| 5 | WAN Stack Handler | ❌ Rewrite | — | NEEDS REWORK |
| 6 | LTE Pin Remapping | ❌ Update | — | NEEDS REWORK |
| 7 | LAN Adapter Pin Changes | — | ❌ Update | NEEDS UPDATE |
| 8 | LAN Stack Handler | — | ❌ Complete Rewrite | NEEDS REWORK |
| 9 | LAN SPI Pin Update | — | ❌ Update | NEEDS UPDATE |
| 10 | LAN UART Pin (LAN2) | — | ❌ Update | NEEDS UPDATE |
| 11 | LAN USB Switch | — | 🆕 New Feature | NEW |
| 12 | LAN SD Card Check | — | ⚠️ Verify | NEEDS VERIFICATION |
| 13 | TCA6416A IC Migration | ❌ Rewrite | ❌ Rewrite + Multi-Instance | NEEDS REWORK |
| 14 | Power Source Handler | ❌ Redesign | — | NEEDS REDESIGN |
| 15 | LoRa Gateway (Uplink) | ❌ New | ❌ New | NOT STARTED |
| 16 | HMI Display (TJC3224K024) | ❌ New | — | NOT STARTED |

### Priority Order (Recommended)

1. **Task 13** — TCA6416A driver migration (foundation for everything else)
2. **Task 5** — WAN stack handler rewrite (depends on Task 13)
3. **Task 8** — LAN stack handler rewrite (depends on Task 13)
4. **Task 6** — LTE control pin remapping (depends on Task 5)
5. **Task 10** — LAN2 UART pin update (independent, quick)
6. **Task 9** — LAN SPI pin update (independent, quick)
7. **Task 11** — USB switch control (independent, new feature)
8. **Task 7** — LAN adapter pin verification (verification pass)
9. **Task 12** — SD card pin check (verification, conflict resolution)
10. **Task 4** — Power/charger design (needs HW info)
11. **Task 14** — Power source handler (depends on Task 4)
12. **Task 3** — UART switch mechanism (needs HW info)
13. **Task 15** — LoRa Gateway — LAN MCU gateway RX task (depends on Tasks 8 + 10)
14. **Task 15** — LoRa Gateway — WAN MCU Semtech UDP handler (depends on Task 15 LAN + WiFi stack)
15. **Task 16** — HMI Display — after Task 3 UART switch + Task 14 battery SoC confirmed

---

## Appendix: Key File Locations

### DA2_esp (WAN MCU)
```
BSP/stack_handler/include/stack_handler.h        — Stack GPIO enum & API
BSP/stack_handler/src/stack_handler.c            — Stack GPIO implementation
BSP/i2c_dev_support/include/tca_handler.h        — TCA IO expander driver
BSP/i2c_dev_support/src/tca_handler.c            — TCA implementation
BSP/MCU_LAN_Communication/include/lan_comm.h     — SPI slave config
BSP/MCU_LAN_Communication/src/lan_comm.c         — SPI slave implementation
Application/Config_Handler/src/config_handler.c  — CFLT/LT command parsing
Middleware/LTE_Handler/include/lte_config.h       — LTE config defines
Middleware/LTE_Handler/src/lte_handler.c          — LTE handler
main/pwr_source_handler.c                        — Power rail control
main/DA2_esp.h                                   — Main includes
```

### DA2_esp_LAN (LAN MCU)
```
BSP/stack_handler/include/stack_handler.h        — Stack GPIO enum & API
BSP/stack_handler/src/stack_handler.c            — Stack GPIO implementation
BSP/i2c_dev_support/include/tca_handler.h        — TCA IO expander driver
BSP/i2c_dev_support/src/tca_handler.c            — TCA implementation
BSP/MCU_WAN_Communication/include/wan_comm.h     — SPI master config
BSP/Module_UART_Communication/include/module_uart_comm.h — UART pins
BSP/Module_SPI_Communication/include/module_spi_comm.h   — SPI adapter pins
BSP/Module_USB_Communication/include/module_usb_comm.h   — USB config
BSP/RS485_Communication/include/rs485_comm.h     — RS485 pins
BSP/SDCard_Communication/include/sdcard_comm.h   — SD card pins
Application/Module_Monitor_Task/                 — Module lifecycle
main/DA2_esp_LAN.h                              — Main includes
main/DA2_esp_LAN.c                              — Init sequence
```
