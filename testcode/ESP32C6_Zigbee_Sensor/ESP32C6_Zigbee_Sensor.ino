/**
 * @file    ESP32C6_Zigbee_Sensor.ino
 * @brief   ESP32-C6 Super Mini as native Zigbee END DEVICE (Temperature + Humidity Sensor)
 * @target  ESP32-C6 ONLY  (built-in IEEE 802.15.4 radio, no external module)
 * @sdk     Arduino-ESP32 >= 3.3.7  (ships with Zigbee.h)
 *
 * ─── ARCHITECTURE ───────────────────────────────────────────────────
 *
 *   DA2 Gateway (ESP32-S3)
 *     └─ UART ──► E180-ZG120B  ← Zigbee COORDINATOR  (HEX mode, stack_011)
 *                      │  (802.15.4 RF)
 *                      └──────────► ESP32-C6 Super Mini  ← THIS SKETCH
 *                                   Built-in temp sensor + humidity, endpoint 11 (0x0B)
 *
 * ─── REPORTING FLOW ─────────────────────────────────────────────────
 *   Device boots SILENT after joining. The JS widget first verifies the
 *   node by reading Basic/0x0005, then enables push reporting by sending
 *   ZCL Configure Reporting with the dashboard's chosen/default interval.
 *
 *   WHY SILENT IS HARD: addHumiditySensor() registers cluster 0x0405 with
 *   SDK default reporting (min=0, max=5s, change=50). When MODULE_AUTO_FIND_TARGET
 *   creates a binding, the stack activates this default and starts pushing
 *   humidity reports every 5 s independently of our code. Calling
 *   setHumidityReporting() once after join is not enough because it runs
 *   BEFORE the binding exists — the stack resets to defaults on bind.
 *
 *   SOLUTION: Join-time suppression only:
 *     1. addHumiditySensor tolerance=655.35f → ZCL reportable change = 0xFFFF
 *        (impossible to reach) prevents change-triggered reports.
 *     2. setHumidityReporting(0xFFFF, 0xFFFF, 655.35f) after join sets
 *        max_interval=0xFFFF (no time-based reports) + impossible delta.
 *   After verification, the widget sends Configure Reporting to replace
 *   this silent default and start push-mode telemetry.
 *
 * ─── WIRING ─────────────────────────────────────────────────────────
 *   Just power the ESP32-C6 Super Mini via USB.
 *   Uses the internal CPU temperature sensor (no external component needed).
 *
 * ─── ARDUINO IDE SETUP ──────────────────────────────────────────────
 *   1. Board manager  : "esp32 by Espressif" >= 3.3.7
 *   2. Board          : "ESP32C6 Dev Module"
 *   3. Tools → Zigbee mode → "Zigbee ED (end device)"   ← REQUIRED
 */

#include "Zigbee.h"

/* ─── Configuration ───────────────────────────────────────────────── */
#define ZIGBEE_EP_TEMP        11      /* Temperature + Humidity endpoint (0x0B) */
#define ATTR_UPDATE_INTERVAL  2000    /* How often to refresh temperature (ms) */
/* ─── Simulated sensor values: random within realistic ranges ───────── */
#define TEMP_MIN_C     20.0f   /* minimum simulated temperature °C */
#define TEMP_MAX_C     35.0f   /* maximum simulated temperature °C */
#define HUMID_MIN_RH   45.0f   /* minimum simulated humidity %RH */
#define HUMID_MAX_RH   75.0f   /* maximum simulated humidity %RH */

static float getSimulatedTemp() {
    /* random(0, 1501) → 0..1500 → /100.0f → 0.00..15.00 → + 20.0 → 20.00..35.00 °C */
    return TEMP_MIN_C + (random(0, 1501) / 100.0f);
}

static float getSimulatedHumidity() {
    /* random(0, 3001) → 0..3000 → /100.0f → 0.00..30.00 → + 45.0 → 45.00..75.00 %RH
       HUMID_DELTA_IMPOSSIBLE (ZCL unit 65535) prevents any change-based reports. */
    return HUMID_MIN_RH + (random(0, 3001) / 100.0f);
}

/* ─── Impossible reportable-change delta values ──────────────────────
   Setting these to values that can never be reached prevents the Zigbee
   stack from triggering change-based attribute reports even after binding.
   655.35f → ZCL unit = 65535 (max uint16); humidity range is 0–100 %RH.
   200.0f  → ZCL unit = 20000; temperature ZCL range is –40 to 125 °C.  ── */
#define HUMID_DELTA_IMPOSSIBLE   655.35f
#define TEMP_DELTA_IMPOSSIBLE    200.0f

static unsigned long  g_lastAttrUpdateMs    = 0;

/* ─── Device name: embedded in Model Identifier attr (Basic Cluster 0x0005).
   Format: "DATN_AUTH_KEY:<name>"  — JS widget parses auth key + friendly name
   in one single ZCL read. Change this string to identify each device.
   Examples: "sensor_1", "sensor_2", "bulb_1", "switch_1", "plug_1" */
#define DEVICE_NAME  "sensor_1"

/* ─── Reconnect watchdog ─────────────────────────────────────────────
   After being kicked (ZDO Remove Device) the device loses network
   association. factoryReset() clears the saved channel mask so the
   device performs a full scan on channels 11-26 and rejoins once the
   coordinator opens Permit Join.                                        */
#define REJOIN_TIMEOUT_MS  10000   /* 10 s without a network → factory reset */
static unsigned long g_disconnectedSinceMs = 0;
static bool          g_disconnectPending   = false;

/* ─── Zigbee endpoints ───────────────────────────────────────────── */
/* ZigbeeHumiditySensor does not exist in SDK 3.3.8 — use addHumiditySensor()
   on ZigbeeTempSensor instead (both clusters 0x0402 + 0x0405 share EP 11) */
ZigbeeTempSensor zbTempSensor(ZIGBEE_EP_TEMP);

static void applyReportingSuppression() {
   zbTempSensor.setReporting(0xFFFF, 0xFFFF, TEMP_DELTA_IMPOSSIBLE);
   zbTempSensor.setHumidityReporting(0xFFFF, 0xFFFF, HUMID_DELTA_IMPOSSIBLE);
}


/* ─── Internal temperature sensor reading ────────────────────────── */
static float readInternalTemp() {
    /* ESP32-C6 internal temperature sensor
       Returns die temperature — typically 10-15 °C above ambient.
       For demo purposes, we subtract an offset to approximate room temp. */
    return temperatureRead();
}

/* ─── setup ──────────────────────────────────────────────────────── */
void setup() {
    Serial.begin(115200);
    randomSeed(esp_random());   /* seed Arduino RNG with hardware entropy */

    Serial.println("\nESP32-C6 Super Mini — Zigbee Temperature + Humidity Sensor");
    Serial.printf("Temp+Humid endpoint: %d (0x%02X), Clusters 0x0402 + 0x0405\n", ZIGBEE_EP_TEMP, ZIGBEE_EP_TEMP);
    Serial.printf("Attr update interval: %d ms\n", ATTR_UPDATE_INTERVAL);
    Serial.println("Starting Zigbee stack...");

    /* ── Configure endpoint BEFORE addEndpoint() + begin() ── */
    /* setMinMaxValue / setTolerance / setManufacturerAndModel are safe before begin() */
    zbTempSensor.setMinMaxValue(TEMP_MIN_C, TEMP_MAX_C);  /* ZCL range in °C */
    zbTempSensor.setTolerance(1);                    /* ±1 °C tolerance */
    /* Auth Key: Model Identifier (Basic Cluster 0x0000, Attr 0x0005) stores
       the application handshake string. The JS widget reads this via ZCL
       Read Attribute and only marks the node as verified if the value equals
       "DATN_AUTH_KEY". Keep manufacturer "Espressif" as required by SDK. */
    zbTempSensor.setManufacturerAndModel("Espressif", "DATN_AUTH_KEY:" DEVICE_NAME);
    /* Add humidity cluster (0x0405) to the same endpoint as temperature.
       addHumiditySensor(min, max, tolerance, defaultValue) — all in %RH float.
       tolerance=655.35f → ZCL unit = 65535 (max uint16): an impossible
       reportable change — prevents the SDK from generating change-based
       reports for humidity even after a binding is created by AUTO_FIND_TARGET.
       (The normal spec value of 0.5 was causing 5 s auto-reports on bind.) */
    zbTempSensor.addHumiditySensor(0.0, 100.0, HUMID_DELTA_IMPOSSIBLE, (HUMID_MIN_RH + HUMID_MAX_RH) / 2.0f);

    /* NOTE: setReporting() / setHumidityReporting() MUST NOT be called before
       Zigbee.begin(). Those calls try to acquire the Zigbee OS mutex which has
       not been initialized yet → "Zigbee lock is not ready!" panic crash.
       Reporting is configured AFTER Zigbee.begin() returns (see below). */

    Zigbee.addEndpoint(&zbTempSensor);

    /* erase_nvs=true: always clear saved channel mask so the device does
       a full scan (channels 11-26) on each boot. This prevents the
       single-channel lock-in issue when the coordinator resets. */
    if (!Zigbee.begin(ZIGBEE_END_DEVICE, /* erase_nvs= */ true)) {
        Serial.println("[ERROR] Zigbee.begin() failed (wrong Zigbee mode?)");
        Serial.println("  → Tools > Zigbee mode = 'Zigbee ED (end device)'");
        Serial.println("  Calling factoryReset() and restarting in 3 s...");
        delay(3000);
        Zigbee.factoryReset();
        for (;;) delay(1000);   /* unreachable — factoryReset reboots */
    }

   Serial.println("Silent mode: waits for auth verify, then JS widget Configure Reporting");

    Serial.println("Waiting to join coordinator network...");
    Serial.println("(Run MODULE_START_NETWORK + MODULE_SET_PERMIT_JOIN on coordinator)");
    while (!Zigbee.connected()) {
        Serial.print(".");
        delay(500);
    }

    /* ── Post-join: suppress all auto-reporting ────────────────────────
       Layer 1: set impossible delta + max_interval=0xFFFF (no time-based
       reporting). delta=0 was WRONG — it means "report on every attribute
       write". We use impossible deltas instead.
       This call may not stick if no binding exists yet (stack resets on
       bind). Layer 2 (loop re-application every 5 s) handles that case.
       Must be called AFTER Zigbee.begin() so the Zigbee OS mutex exists. */
   applyReportingSuppression();

    /* Set initial humidity value */
    zbTempSensor.setHumidity((HUMID_MIN_RH + HUMID_MAX_RH) / 2.0f);

    Serial.println();
    Serial.println("*** Joined Zigbee network! ***");
    Serial.println("Coordinator: run MODULE_AUTO_FIND_TARGET to bind");
   Serial.println("Device is SILENT — verify first, then JS widget enables push reporting");
}

/* ─── loop ───────────────────────────────────────────────────────── */

void loop() {
    /* ── Connection monitor ── */
    static bool lastConn = true;
    bool conn = Zigbee.connected();
    if (conn != lastConn) {
        if (!conn) {
            Serial.println("*** Lost network — starting rejoin watchdog ***");
            g_disconnectPending   = true;
            g_disconnectedSinceMs = millis();
        } else {
            Serial.println("*** Re-joined network ***");
            g_disconnectPending = false;
         applyReportingSuppression();
         Serial.println("[REPORT] Suppressed after rejoin; waiting for Configure Reporting");
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

    /* ── Temperature + Humidity updater ─────────────────────────────
       Refresh both attributes every ATTR_UPDATE_INTERVAL ms so the device
       has current data ready for ZCL Read Attr requests (0x0402 + 0x0405).
       Once Configure Reporting is received, the updated attributes are
       pushed automatically by the Zigbee stack.                           ── */
    if (conn && (millis() - g_lastAttrUpdateMs >= ATTR_UPDATE_INTERVAL)) {
        g_lastAttrUpdateMs = millis();

        float tempC   = getSimulatedTemp();
        float humidRH = getSimulatedHumidity();
        zbTempSensor.setTemperature(tempC);
        zbTempSensor.setHumidity(humidRH);

      Serial.printf("[ATTR] Temp=%.1f°C  Humid=%.1f%%RH  (awaiting/reporting by config)\n", tempC, humidRH);
    }

    delay(100);
}
