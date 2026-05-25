# bench_lane_rig — ESP32-S3 fake-data generator

Companion firmware for the LAN MCU lane ingress benchmark (Bài 2 / prof Q1).

## Hardware

- **Board**: ESP32-S3 Dev Module (Espressif / DevKitC-1 or compatible).
- **Arduino core**: 2.0.14 or newer (3.x recommended for native USB CDC).

## Pin map (default)

| Mode | Pins on ESP32-S3 rig                                  | Connect to LAN MCU lane |
|------|--------------------------------------------------------|--------------------------|
| UART | TX=GPIO17, RX=GPIO18 — cross with LAN MCU UART        | Stack 0 or 1 UART pins  |
| I2C  | SDA=GPIO8, SCL=GPIO9 — 4.7 kΩ pull-up to 3V3          | Stack 0 or 1 I2C pins   |
| SPI  | SCK=GPIO12, MISO=GPIO13, MOSI=GPIO11, CS=GPIO10       | Stack 0 or 1 SPI pins   |
| USB  | Native D-/D+ (built-in USB-OTG port)                  | USB host port of LAN MCU |

> SPI mode requires Arduino library **ESP32SPISlave** (Library Manager → search `ESP32SPISlave`).
> USB mode requires `Tools → USB CDC On Boot: Enabled` in Arduino IDE.

## Build & flash

1. Open `bench_lane_rig.ino` in Arduino IDE.
2. Tools → Board → "ESP32S3 Dev Module".
3. Pick the mode by editing the `#define RIG_MODE_*` at top — only ONE active.
4. Compile + upload.

## Runtime

- Boots into a per-mode rate ramp. Each step holds for 5 s, then advances.
- Packet size: 256 bytes (first 4 bytes = sequence number).
- Rate steps depend on mode (line rate caps push modes, pull modes are
  informational because the master sets the rate):
  - **UART** : 100, 200, 300, 400, 500, 600 pps  (capped near 921600 baud)
  - **USB**  : 100, 500, 1000, 2000, 3000, 5000 pps
  - **I2C / SPI**: ramp values informational; master clocks the bus
- Self-stat printed over the **debug** port on every step boundary:
  - UART / I2C / SPI modes: debug = `Serial` (USB JTAG, default)
  - USB CDC mode: debug = `Serial0` (UART0 on GPIO43/44) because `Serial`
    is the USB data port. Wire a USB-TTL adapter to GPIO43 to see logs.
  ```
  [RIG] step=3 req_rate=300 pps total_pkt=1500 total_b=384000
  ```
- `req_rate` is the *requested* rate; the actual line rate may be lower
  when the physical link is the bottleneck (which is the whole point of
  the test — saturation is the goal).

## Cross-check with LAN MCU

On the LAN MCU (DA2_esp_LAN) set `BENCH_LANE_INGRESS_ENABLE 1` in
`bench_lane_ingress.h` and re-flash.  The LAN MCU will print every 2 s:

```
LANE_BENCH stack=0 uart pkt=4000 b=1024000 miss=0 drop=0 pps=2000.0 kbps=4096.0
```

The lane is saturated when LAN MCU pps stops tracking the rig's rate (the
two numbers diverge or LAN MCU starts logging `miss`/`drop`).
