/**
 * @file    ZigbeeColorBulb_C6_SuperMini.ino
 * @brief   ESP32-C6 Super Mini as native Zigbee END DEVICE (Color Dimmable Light)
 * @target  ESP32-C6 ONLY  (built-in IEEE 802.15.4 radio, no external module)
 * @sdk     Arduino-ESP32 >= 3.3.7  (ships with Zigbee.h)
 * @dep     Adafruit NeoPixel library (install via Library Manager)
 *
 * ─── ARCHITECTURE ───────────────────────────────────────────────────
 *
 *   DA2 Gateway (ESP32-S3)
 *     └─ UART ──► E180-ZG120B  ← Zigbee COORDINATOR  (HEX mode, stack_011)
 *                      │  (802.15.4 RF)
 *                      └──────────► ESP32-C6 Super Mini  ← THIS SKETCH
 *                                   WS2812 RGB on GPIO8, endpoint 10 (0x0A)
 *
 * ─── WIRING ─────────────────────────────────────────────────────────
 *   Just power the ESP32-C6 Super Mini via USB.
 *   WS2812 RGB LED is on GPIO8 on ESP32-C6 Super Mini boards.
 *
 * ─── ARDUINO IDE SETUP ──────────────────────────────────────────────
 *   1. Board manager  : "esp32 by Espressif" >= 3.3.7
 *   2. Board          : "ESP32C6 Dev Module"
 *   3. Tools → Zigbee mode → "Zigbee ED (end device)"   ← REQUIRED
 *   4. Install library: "Adafruit NeoPixel" via Library Manager
 *
 * ─── COORDINATOR HEX MODE TEST FLOW ────────────────────────────────
 *   Gateway config stack_011_config.json uses native E180 binary (HEX)
 *   protocol.  All frames start with 0x55.  The firmware builds checksums
 *   automatically.  Commands below show the function name used by the
 *   gateway; see HEX_TEST_INSTRUCTIONS.txt for raw byte frames.
 *
 *   STEP 1 – Verify coordinator
 *     CFML:CFZB:1:MODULE_GET_INFO
 *     → response byte[2] device_type == 0x00 (Coordinator)
 *
 *   STEP 2 – Set coordinator type (if not already)
 *     CFML:CFZB:1:MODULE_SET_DEVICE_TYPE:00
 *     → reboot (MODULE_SW_RESET), wait ~2 s, repeat GET_INFO
 *
 *   STEP 3 – Open network / permit join for 180 s
 *     CFML:CFZB:1:MODULE_START_NETWORK
 *     → async event 0x80/0x02 (NOTIFY_NET_OPEN) with window_time > 0
 *
 *   STEP 4 – Power-on / reset this C6 board within 180 s
 *     → Gateway receives async 0x80/0x03 (NOTIFY_NODE_JOIN):
 *       EVT: 55 80 03 <len> <MAC 8 bytes> <short 2 bytes> <parent 2 bytes> <mode>
 *       Note <short> address from this frame — needed for ZCL commands.
 *
 *   STEP 5 – Auto-bind / find target
 *     CFML:CFZB:1:MODULE_AUTO_FIND_TARGET
 *     → async 0x80/0x10 (NOTIFY_FIND_BIND): 55 80 10 05 <short_L> <short_H> <ep> <cluster_L> <cluster_H>
 *
 *   STEP 6 – On/Off  (ZCL cluster 0x0006, C→S)
 *     ON:     CFML:CFZB:1:MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0006,01
 *     OFF:    CFML:CFZB:1:MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0006,00
 *     TOGGLE: CFML:CFZB:1:MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0006,02
 *
 *   STEP 7 – Brightness  (ZCL cluster 0x0008, MoveToLevelOnOff cmd 0x04)
 *     CFML:CFZB:1:MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0008,04,<level_byte>,00,01,00
 *     level_byte: 0x00 = 0%, 0x7F = 50%, 0xFE = 100%
 *
 *   STEP 8 – Color XY  (ZCL cluster 0x0300, MoveToColor cmd 0x07)
 *     CFML:CFZB:1:MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0300,07,<X_L>,<X_H>,<Y_L>,<Y_H>,0A,00
 *     Examples (16-bit XY, little-endian):
 *       Red:   X=0xB374 (45940), Y=0x3278 (12920)  → B3 74 32 78
 *       Green: X=0x302B (12331), Y=0x7AC0 (31424)  → 30 2B 7A C0
 *       Blue:  X=0x14CC  (5324), Y=0x0A55  (2645)  → 14 CC 0A 55
 *       White: X=0x4C2F (19503), Y=0x5129 (20777)  → 4C 2F 51 29
 *
 *   STEP 9 – Color Hue/Sat  (ZCL cluster 0x0300, MoveToHueAndSaturation cmd 0x06)
 *     CFML:CFZB:1:MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0300,06,<hue>,<sat>,0A,00
 *
 * ─── ZCL FRAME HEADER (11 bytes) built by firmware ──────────────────
 *   [transmit_mode=00][short_L][short_H][port][seq_num][dir=00]
 *   [cluster_L][cluster_H][manu_L=00][manu_H=00][resp_mode=00]
 *   The gateway auto-computes LEN and XOR checksum.
 *
 * ─── WHY FIND:MISS (if using old AT mode) ───────────────────────────
 *   In HEX mode MODULE_AUTO_FIND_TARGET (CFG_FIND_BIND 0x00/0x14) triggers
 *   the E180 to scan for identifiable ZigBee devices.  The device must have
 *   joined first (STEP 4 complete).  In HEX mode MODULE_SET_PERMIT_JOIN
 *   sends [55 04 00 02 00 02] to open network for 180 s.
 */

#include "Zigbee.h"
#include <Adafruit_NeoPixel.h>

/* ─── Configuration ───────────────────────────────────────────────── */
#define ZIGBEE_ENDPOINT  10     // ZCL endpoint (must match DSTEP sent by coordinator)
#define WS2812_PIN        8     // GPIO8 = WS2812 on ESP32-C6 Super Mini
#define NUM_PIXELS        1
#define DEVICE_NAME       "bulb_1"  /* Model Identifier holds the handshake string read by the JS

/* ─── Reconnect watchdog ─────────────────────────────────────────────
   After being kicked (ZDO Remove Device) the device loses its network
   association. The built-in Zigbee stack will attempt passive rejoining
   but will only succeed on the exact channel/PAN it was on. If the
   coordinator was reset or the device is on a different channel, it will
   never rejoin passively. factoryReset() clears the saved channel mask
   and triggers a full scan on channels 11-26 so the device can find the
   coordinator again once Permit Join is opened.                          */
#define REJOIN_TIMEOUT_MS  10000   /* 10 s without a network → factory reset */
static unsigned long g_disconnectedSinceMs = 0;
static bool          g_disconnectPending   = false;
/* ─── WS2812 pixel strip ─────────────────────────────────────────── */
Adafruit_NeoPixel strip(NUM_PIXELS, WS2812_PIN, NEO_GRB + NEO_KHZ800);

/* ─── Zigbee Color Dimmable Light endpoint ───────────────────────── */
ZigbeeColorDimmableLight zbLight(ZIGBEE_ENDPOINT);

/* ─── LED state ──────────────────────────────────────────────────── */
static bool    s_on    = false;
static uint8_t s_r     = 255, s_g = 255, s_b = 255;

static void applyLED() {
    if (!s_on) {
        strip.setPixelColor(0, 0, 0, 0);
    } else {
        strip.setPixelColor(0, s_r, s_g, s_b);
    }
    strip.show();
}

/* ─── Callback: fires on any On/Off + color + level change ──────── */
// Signature: void cb(bool state, uint8_t red, uint8_t green, uint8_t blue, uint8_t level)
void onLightChangeRgb(bool state, uint8_t red, uint8_t green, uint8_t blue, uint8_t level) {
    s_on = state;
    s_r = red; s_g = green; s_b = blue;
    applyLED();
    Serial.printf("[BULB] %s  RGB(%d,%d,%d)\n",
                  state ? "ON " : "OFF", red, green, blue);
}

/* ─── setup ──────────────────────────────────────────────────────── */
void setup() {
    Serial.begin(115200);

    strip.begin();
    strip.setBrightness(200);
    strip.clear();
    strip.show();

    // Register RGB callback and device metadata
    zbLight.onLightChangeRgb(onLightChangeRgb);
    /* Auth Key: Model Identifier holds the handshake string read by the JS
       widget (Basic Cluster 0x0000, Attr 0x0005). Node is only marked verified
       when the widget reads back "DATN_AUTH_KEY" from this field. */
    zbLight.setManufacturerAndModel("Espressif", "DATN_AUTH_KEY:" DEVICE_NAME);

    // Enable both Hue/Sat and XY color modes so either works from coordinator
    zbLight.setLightColorCapabilities(
        ZIGBEE_COLOR_CAPABILITY_HUE_SATURATION |
        ZIGBEE_COLOR_CAPABILITY_X_Y);

    Zigbee.addEndpoint(&zbLight);

    Serial.println("\nESP32-C6 Super Mini — Zigbee Color Dimmable Bulb");
    Serial.println("Starting Zigbee stack...");

    // erase_nvs=true: always clear the saved channel mask and do a full
    // channel scan (11-26).  Without this, after the first successful join the
    // library saves a single-channel mask to NVRAM.  On the next boot it only
    // scans that one channel — if the E180 coordinator was reset and created a
    // new network (different PAN or channel) the C6 never finds it, begin()
    // times out after 30 s, and the device halts.
    if (!Zigbee.begin(ZIGBEE_END_DEVICE, /* erase_nvs= */ true)) {
        Serial.println("[ERROR] Zigbee.begin() failed (wrong Zigbee mode?)");
        Serial.println("  → Tools > Zigbee mode = 'Zigbee ED (end device)'");
        Serial.println("  Calling factoryReset() and restarting in 3 s...");
        delay(3000);
        Zigbee.factoryReset(); // erases NVRAM and reboots
        for (;;) delay(1000); // unreachable — factoryReset reboots
    }

    Serial.println("Waiting to join coordinator network...");
    Serial.println("(Run MODULE_START_NETWORK + MODULE_SET_PERMIT_JOIN on coordinator, then reset this board)");
    while (!Zigbee.connected()) {
        Serial.print(".");
        delay(500);
    }

    Serial.println();
    Serial.println("*** Joined Zigbee network! ***");
    Serial.println("Coordinator: run MODULE_AUTO_FIND_TARGET to bind, then:");
    Serial.println("  MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0006,01/00/02  — on/off");
    Serial.println("  MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0300,08,<xH>,<yH>,000A  — color XY");
    Serial.println("  MODULE_ZCL_SEND_CONTROL_CMD:<short>,0A,0008,04,<level>,0001    — brightness");

    // Blink RGB 3x (R→G→B) to confirm join
    uint32_t colors[3] = {strip.Color(128,0,0), strip.Color(0,128,0), strip.Color(0,0,128)};
    for (int i = 0; i < 3; i++) {
        strip.setPixelColor(0, colors[i]); strip.show(); delay(200);
        strip.clear(); strip.show();       delay(150);
    }
}

/* ─── loop ───────────────────────────────────────────────────────── */
void loop() {
    static bool lastConn = true;
    bool conn = Zigbee.connected();
    if (conn != lastConn) {
        if (!conn) {
            Serial.println("*** Lost network — starting rejoin watchdog ***");
            g_disconnectPending   = true;
            g_disconnectedSinceMs = millis();
            // Flash red 2x on disconnect
            for (int i = 0; i < 2; i++) {
                strip.setPixelColor(0, 64, 0, 0); strip.show(); delay(200);
                strip.clear(); strip.show();       delay(200);
            }
        } else {
            Serial.println("*** Re-joined network ***");
            g_disconnectPending = false;
        }
        lastConn = conn;
    }

    /* ── Reconnect watchdog ──────────────────────────────────────────
       If still disconnected after REJOIN_TIMEOUT_MS, call factoryReset()
       to clear the saved channel mask and force a full 11-26 channel scan.
       The device will rejoin automatically once the coordinator opens
       Permit Join (openPermitJoin button in the JS widget).              */
    if (!conn && g_disconnectPending &&
        (millis() - g_disconnectedSinceMs >= REJOIN_TIMEOUT_MS)) {
        Serial.println("[REJOIN] Timeout — factoryReset() for full channel scan");
        delay(200);
        Zigbee.factoryReset();   /* clears NVS and reboots */
        for (;;) delay(1000);    /* unreachable — factoryReset reboots */
    }

    delay(1000);
}

