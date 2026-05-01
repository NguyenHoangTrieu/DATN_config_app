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
#define ATTR_UPDATE_INTERVAL_DEFAULT_MS  5000    /* Default push interval until widget writes a new one */
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
#define ATTR_UPDATE_INTERVAL_MIN_MS  100UL
#define ATTR_UPDATE_INTERVAL_MAX_MS  60000UL
#define DEBUG_HEARTBEAT_MS       10000
#define DEBUG_WATCHDOG_LOG_MS    2000

static unsigned long  g_lastAttrUpdateMs    = 0;
static unsigned long  g_bootMs              = 0;
static unsigned long  g_lastHeartbeatMs     = 0;
static unsigned long  g_lastWatchdogLogMs   = 0;
static unsigned long  g_lastConfigRxMs      = 0;
static uint32_t       g_attrUpdateCount     = 0;
static uint32_t       g_joinCount           = 0;
static uint32_t       g_configRxCount       = 0;
static unsigned long  g_lastIdentifyRxMs    = 0;
static uint16_t       g_lastIdentifyRaw     = 0;
static unsigned long  g_attrUpdateIntervalMs = ATTR_UPDATE_INTERVAL_DEFAULT_MS;

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
   /* Keep local explicit push loop alive; suppression only disables stack auto-report. */
}

/* ─── Identify callback — widget writes intervalMs into IdentifyTime ─────── */
static void onIdentifyCallback(uint16_t time) {
   unsigned long nowMs = millis();
   unsigned long prevMs = g_lastIdentifyRxMs;
   uint16_t prevRaw = g_lastIdentifyRaw;
   g_lastIdentifyRxMs = nowMs;
   g_lastIdentifyRaw = time;

   /* Ignore Identify countdown ticks emitted by the stack (N -> N-1 -> ... -> 0). */
   if (time == 0 && prevRaw > 0 && prevRaw <= 60) {
      unsigned long dt0 = nowMs - prevMs;
      if (dt0 >= 700 && dt0 <= 1500) {
         Serial.printf("[CFG] Ignore identify countdown end raw=0 (prev=%u) at uptime=%lums\n", prevRaw, nowMs);
         return;
      }
   }
   if (time > 0 && time <= 60 && prevRaw > 1 && prevRaw <= 60 && (time + 1) == prevRaw) {
      unsigned long dt = nowMs - prevMs;
      if (dt >= 700 && dt <= 1500) {
         Serial.printf("[CFG] Ignore identify countdown tick raw=%u (prev=%u) at uptime=%lums\n", time, prevRaw, nowMs);
         return;
      }
   }

   unsigned long intervalMs = 0;
   const char* unit = "invalid";

   /* Accept both Identify(seconds) and IdentifyTime(ms) styles. */
   if (time >= 1 && time <= 60) {
      intervalMs = (unsigned long)time * 1000UL;
      unit = "s";
   } else if ((unsigned long)time >= ATTR_UPDATE_INTERVAL_MIN_MS && (unsigned long)time <= ATTR_UPDATE_INTERVAL_MAX_MS) {
      intervalMs = (unsigned long)time;
      unit = "ms";
   }

   if (intervalMs < ATTR_UPDATE_INTERVAL_MIN_MS || intervalMs > ATTR_UPDATE_INTERVAL_MAX_MS) {
      Serial.printf("[CFG] Ignore identify payload=%u at uptime=%lums (expected 1..60s or %lu..%lu ms)\n",
                    time,
                    nowMs,
                    (unsigned long)ATTR_UPDATE_INTERVAL_MIN_MS,
                    (unsigned long)ATTR_UPDATE_INTERVAL_MAX_MS);
      return;
   }

   g_configRxCount++;
   g_lastConfigRxMs = nowMs;
   g_attrUpdateIntervalMs = intervalMs;
   g_lastAttrUpdateMs = 0;
   Serial.printf("[CFG] RX#%lu uptime=%lums raw=%u%s -> interval=%lu ms\n",
                 (unsigned long)g_configRxCount,
                 nowMs,
                 time,
                 unit,
                 g_attrUpdateIntervalMs);
}

static void dbgPrintHeartbeat(bool connectedNow) {
    unsigned long now = millis();
    if (now - g_lastHeartbeatMs < DEBUG_HEARTBEAT_MS) return;
    g_lastHeartbeatMs = now;
   Serial.printf("[DBG] heartbeat | conn=%s | uptime=%lus | joins=%lu | attr_updates=%lu | cfg_rx=%lu | last_cfg_uptime=%lums | pending_rejoin=%s\n",
                  connectedNow ? "yes" : "no",
                  (unsigned long)((now - g_bootMs) / 1000UL),
                  (unsigned long)g_joinCount,
                  (unsigned long)g_attrUpdateCount,
              (unsigned long)g_configRxCount,
              (unsigned long)g_lastConfigRxMs,
                  g_disconnectPending ? "yes" : "no");
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
   g_bootMs = millis();

    Serial.println("\nESP32-C6 Super Mini — Zigbee Temperature + Humidity Sensor");
    Serial.printf("Temp+Humid endpoint: %d (0x%02X), Clusters 0x0402 + 0x0405\n", ZIGBEE_EP_TEMP, ZIGBEE_EP_TEMP);
   Serial.printf("Attr update interval: %lu ms\n", g_attrUpdateIntervalMs);
   Serial.printf("[DBG] DEVICE_NAME=%s\n", DEVICE_NAME);
   Serial.printf("[DBG] Auth model string=DATN_AUTH_KEY:%s\n", DEVICE_NAME);
   Serial.println("[DBG] Test flow: JOIN -> widget verify -> Configure Reporting + IdentifyTime interval write");
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
   zbTempSensor.onIdentify(onIdentifyCallback);

    if (!Zigbee.begin(ZIGBEE_END_DEVICE, /* erase_nvs= */ true)) {
        Serial.println("[ERROR] Zigbee.begin() failed (wrong Zigbee mode?)");
        Serial.println("  → Tools > Zigbee mode = 'Zigbee ED (end device)'");
        Serial.println("  Calling factoryReset() and restarting in 3 s...");
        delay(3000);
        Zigbee.factoryReset();
        for (;;) delay(1000);   /* unreachable — factoryReset reboots */
    }

   Serial.println("Silent mode: waits for auth verify, then JS widget Configure Reporting + IdentifyTime");
   Serial.println("[DBG] Reporting suppression active (max=0xFFFF, impossible delta)");

    Serial.println("Waiting to join coordinator network...");
    Serial.println("(Run MODULE_START_NETWORK + MODULE_SET_PERMIT_JOIN on coordinator)");
    while (!Zigbee.connected()) {
        Serial.print(".");
        delay(500);
    }

      Serial.printf("[REPORT] Local push loop interval @ %lu ms\n", g_attrUpdateIntervalMs);

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
   g_joinCount++;
   Serial.printf("[DBG] Join #%lu at uptime %lus\n",
              (unsigned long)g_joinCount,
              (unsigned long)((millis() - g_bootMs) / 1000UL));
    Serial.println("Coordinator: run MODULE_AUTO_FIND_TARGET to bind");
   Serial.println("Device is SILENT — verify first, then JS widget enables push reporting");
   Serial.println("[DBG] Expect on widget: node status NEW -> verify OK -> Configure Reporting + IdentifyTime");
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
         g_lastWatchdogLogMs   = 0;
        } else {
            Serial.println("*** Re-joined network ***");
         g_joinCount++;
         Serial.printf("[DBG] Rejoin success | join_count=%lu | uptime=%lus\n",
                    (unsigned long)g_joinCount,
                    (unsigned long)((millis() - g_bootMs) / 1000UL));
            g_disconnectPending = false;
         applyReportingSuppression();
             Serial.printf("[REPORT] Suppressed after rejoin; current interval @ %lu ms\n", g_attrUpdateIntervalMs);
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

   if (!conn && g_disconnectPending) {
      unsigned long nowMs = millis();
      if (g_lastWatchdogLogMs == 0 || (nowMs - g_lastWatchdogLogMs) >= DEBUG_WATCHDOG_LOG_MS) {
         g_lastWatchdogLogMs = nowMs;
         unsigned long elapsed = nowMs - g_disconnectedSinceMs;
         unsigned long remain = (elapsed >= REJOIN_TIMEOUT_MS) ? 0 : (REJOIN_TIMEOUT_MS - elapsed);
         Serial.printf("[DBG] rejoin watchdog | elapsed=%lums | remain=%lums\n",
                    elapsed,
                    remain);
      }
   }

    /* ── Temperature + Humidity updater ─────────────────────────────
       Always updates and pushes by one active interval (default or IdentifyTime).
       This keeps behavior aligned with the widget's single-interval setting. ── */
    if (conn && (millis() - g_lastAttrUpdateMs >= g_attrUpdateIntervalMs)) {
        g_lastAttrUpdateMs = millis();
        g_attrUpdateCount++;

        float tempC   = getSimulatedTemp();
        float humidRH = getSimulatedHumidity();
        zbTempSensor.setTemperature(tempC);
        zbTempSensor.setHumidity(humidRH);

        /* Some Zigbee.h builds only emit the latest changed cluster with report().
           Send both clusters explicitly to guarantee temp+humidity uplink. */
        zbTempSensor.reportTemperature();
        delay(20);
        zbTempSensor.reportHumidity();
        delay(20);
        Serial.printf("[ATTR] #%lu Temp=%.1f°C  Humid=%.1f%%RH  (push interval @ %lu ms)\n",
                      (unsigned long)g_attrUpdateCount,
                      tempC,
                      humidRH,
                      g_attrUpdateIntervalMs);
   }

      dbgPrintHeartbeat(conn);

    delay(100);
}
