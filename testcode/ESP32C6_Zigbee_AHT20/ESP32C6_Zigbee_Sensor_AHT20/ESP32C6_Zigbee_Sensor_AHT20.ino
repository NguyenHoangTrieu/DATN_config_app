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
#include <Wire.h>

/* ─── Configuration ───────────────────────────────────────────────── */
#define ZIGBEE_EP_TEMP        11      /* Temperature + Humidity endpoint (0x0B) */
#define ATTR_UPDATE_INTERVAL_DEFAULT_MS  5000    /* Default push interval until widget writes a new one */
#define I2C_SDA_PIN    14
#define I2C_SCL_PIN    15
#define I2C_FREQ_HZ    100000UL
#define AHT20_I2C_ADDR 0x38
#define AHT20_STATUS_BUSY 0x80
#define AHT20_STATUS_CALIBRATED 0x08
#define AHT20_INIT_TIMEOUT_MS 500UL
#define AHT20_MEASURE_TIMEOUT_MS 200UL
#define AHT20_RECOVERY_DELAY_MS 10UL
#define AHT20_VALID_TEMP_MIN_C -40.0f
#define AHT20_VALID_TEMP_MAX_C 85.0f
#define AHT20_VALID_HUMID_MIN_RH 0.0f
#define AHT20_VALID_HUMID_MAX_RH 100.0f
/* ─── AHT20 operating ranges for Zigbee metadata ────────────────────── */
#define TEMP_MIN_C     -40.0f
#define TEMP_MAX_C      85.0f
#define HUMID_MIN_RH     0.0f
#define HUMID_MAX_RH   100.0f

static bool g_aht20Ready = false;
static uint32_t g_i2cRecoveryCount = 0;

static const char *i2cErrorToString(uint8_t errorCode) {
   switch (errorCode) {
      case 0: return "OK";
      case 1: return "DATA_TOO_LONG";
      case 2: return "NACK_ADDR";
      case 3: return "NACK_DATA";
      case 4: return "OTHER_ERROR";
      case 5: return "TIMEOUT";
      default: return "UNKNOWN";
   }
}

static void recoverI2CBus() {
   pinMode(I2C_SDA_PIN, INPUT_PULLUP);
   pinMode(I2C_SCL_PIN, INPUT_PULLUP);
   delay(1);

   if (digitalRead(I2C_SDA_PIN) == HIGH && digitalRead(I2C_SCL_PIN) == HIGH) {
      return;
   }

   Serial.println("[I2C] Bus busy, attempting recovery pulses");
   pinMode(I2C_SDA_PIN, OUTPUT_OPEN_DRAIN);
   pinMode(I2C_SCL_PIN, OUTPUT_OPEN_DRAIN);
   digitalWrite(I2C_SDA_PIN, HIGH);

   for (uint8_t pulse = 0; pulse < 9; ++pulse) {
      digitalWrite(I2C_SCL_PIN, HIGH);
      delayMicroseconds(5);
      digitalWrite(I2C_SCL_PIN, LOW);
      delayMicroseconds(5);
   }

   digitalWrite(I2C_SDA_PIN, LOW);
   delayMicroseconds(5);
   digitalWrite(I2C_SCL_PIN, HIGH);
   delayMicroseconds(5);
   digitalWrite(I2C_SDA_PIN, HIGH);
   delayMicroseconds(5);

   pinMode(I2C_SDA_PIN, INPUT_PULLUP);
   pinMode(I2C_SCL_PIN, INPUT_PULLUP);
}

static bool aht20WriteCommand(const uint8_t *buffer, size_t length, const char *label) {
   Wire.beginTransmission(AHT20_I2C_ADDR);
   size_t written = Wire.write(buffer, length);
   uint8_t errorCode = Wire.endTransmission(true);

   if (written != length || errorCode != 0) {
      Serial.printf("[AHT20] %s write failed: wrote=%u/%u err=%u (%s)\n",
                    label,
                    (unsigned int)written,
                    (unsigned int)length,
                    errorCode,
                    i2cErrorToString(errorCode));
      return false;
   }
   return true;
}

static bool aht20ReadBytes(uint8_t *buffer, size_t length, const char *label) {
   size_t received = Wire.requestFrom((uint8_t)AHT20_I2C_ADDR, (uint8_t)length, (uint8_t)true);
   if (received != length) {
      Serial.printf("[AHT20] %s read failed: got=%u/%u\n",
                    label,
                    (unsigned int)received,
                    (unsigned int)length);
      while (Wire.available()) {
         (void)Wire.read();
      }
      return false;
   }

   for (size_t index = 0; index < length; ++index) {
      buffer[index] = (uint8_t)Wire.read();
   }
   return true;
}

static bool aht20ReadStatus(uint8_t &status) {
   return aht20ReadBytes(&status, 1, "STATUS");
}

static bool validateAHT20Sample(float tempC, float humidRH) {
   if (isnan(tempC) || isnan(humidRH)) {
      Serial.println("[AHT20] sample invalid: NaN");
      return false;
   }

   if (tempC < AHT20_VALID_TEMP_MIN_C || tempC > AHT20_VALID_TEMP_MAX_C ||
       humidRH < AHT20_VALID_HUMID_MIN_RH || humidRH > AHT20_VALID_HUMID_MAX_RH) {
      Serial.printf("[AHT20] sample out of range: temp=%.2fC humid=%.2f%%RH\n", tempC, humidRH);
      return false;
   }
   return true;
}

static bool waitAHT20Ready(uint32_t timeoutMs) {
   uint32_t startedAt = millis();
   uint8_t status = 0xFF;

   while ((millis() - startedAt) < timeoutMs) {
      if (!aht20ReadStatus(status)) {
         return false;
      }
      if ((status & AHT20_STATUS_BUSY) == 0) {
         return true;
      }
      delay(10);
   }

   Serial.printf("[AHT20] busy timeout, last status=0x%02X\n", status);
   return false;
}

static bool initAHT20() {
   recoverI2CBus();
   if (!Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_FREQ_HZ)) {
      Serial.printf("[I2C] begin failed on SDA=%d SCL=%d\n", I2C_SDA_PIN, I2C_SCL_PIN);
      return false;
   }

   Wire.setClock(I2C_FREQ_HZ);
   Wire.setTimeOut(20);
   Wire.flush();
   delay(40);

   Wire.beginTransmission(AHT20_I2C_ADDR);
   uint8_t probeError = Wire.endTransmission(true);
   if (probeError != 0) {
      Serial.printf("[AHT20] probe failed at 0x%02X err=%u (%s)\n",
                    AHT20_I2C_ADDR,
                    probeError,
                    i2cErrorToString(probeError));
      return false;
   }

   const uint8_t softReset = 0xBA;
   if (!aht20WriteCommand(&softReset, 1, "SOFTRESET")) {
      return false;
   }
   delay(20);

   uint8_t status = 0xFF;
   if (!aht20ReadStatus(status)) {
      return false;
   }
   if ((status & AHT20_STATUS_BUSY) != 0 && !waitAHT20Ready(AHT20_INIT_TIMEOUT_MS)) {
      return false;
   }
   if (!aht20ReadStatus(status)) {
      return false;
   }

   if ((status & AHT20_STATUS_CALIBRATED) == 0) {
      const uint8_t calibrateCmd[3] = {0xE1, 0x08, 0x00};
      if (!aht20WriteCommand(calibrateCmd, sizeof(calibrateCmd), "CALIBRATE")) {
         return false;
      }
      if (!waitAHT20Ready(AHT20_INIT_TIMEOUT_MS)) {
         return false;
      }
      if (!aht20ReadStatus(status)) {
         return false;
      }
   }

   if ((status & AHT20_STATUS_CALIBRATED) == 0) {
      Serial.printf("[AHT20] init incomplete, status=0x%02X\n", status);
      return false;
   }

   Serial.printf("[AHT20] initialized on SDA=%d SCL=%d addr=0x%02X status=0x%02X\n",
                 I2C_SDA_PIN,
                 I2C_SCL_PIN,
                 AHT20_I2C_ADDR,
                 status);
   return true;
}

static bool recoverAHT20(const char *reason) {
   Serial.printf("[I2C] Recovering AHT20 bus: %s\n", reason);
   g_aht20Ready = false;
   Wire.flush();
   Wire.end();
   delay(AHT20_RECOVERY_DELAY_MS);

   bool ok = initAHT20();
   g_aht20Ready = ok;
   if (ok) {
      g_i2cRecoveryCount++;
      Serial.printf("[I2C] Recovery #%lu successful\n", (unsigned long)g_i2cRecoveryCount);
   } else {
      Serial.println("[I2C] Recovery failed");
   }
   return ok;
}

static bool readAHT20Once(float &tempC, float &humidRH) {
   if (!g_aht20Ready) return false;

   const uint8_t triggerCmd[3] = {0xAC, 0x33, 0x00};
   if (!aht20WriteCommand(triggerCmd, sizeof(triggerCmd), "TRIGGER")) {
      return false;
   }
   if (!waitAHT20Ready(AHT20_MEASURE_TIMEOUT_MS)) {
      return false;
   }

   uint8_t data[6] = {0};
   if (!aht20ReadBytes(data, sizeof(data), "MEASURE")) {
      return false;
   }
   if ((data[0] & AHT20_STATUS_BUSY) != 0) {
      Serial.printf("[AHT20] measure returned busy status=0x%02X\n", data[0]);
      return false;
   }

   uint32_t rawHumidity = ((uint32_t)data[1] << 12) |
                          ((uint32_t)data[2] << 4) |
                          ((uint32_t)data[3] >> 4);
   uint32_t rawTemperature = ((uint32_t)(data[3] & 0x0F) << 16) |
                             ((uint32_t)data[4] << 8) |
                             data[5];

   humidRH = (rawHumidity * 100.0f) / 1048576.0f;
   tempC = ((rawTemperature * 200.0f) / 1048576.0f) - 50.0f;
   return true;
}

static bool readAHT20(float &tempC, float &humidRH) {
   for (uint8_t attempt = 0; attempt < 2; ++attempt) {
      if (readAHT20Once(tempC, humidRH) && validateAHT20Sample(tempC, humidRH)) {
         return true;
      }

      if (attempt == 0 && recoverAHT20("transaction failure or invalid sample")) {
         continue;
      }
      break;
   }
   return false;
}

/* ─── Local reporting profile ─────────────────────────────────────────
   Coordinator-side Configure Reporting may be rejected (status 0xFF), so
   device applies a local report interval for BOTH temp (0402) and humid (0405).
   Deltas are small but non-zero to avoid spam while still pushing regularly. */
#define TEMP_DELTA_LOCAL_REPORT   0.10f
#define HUMID_DELTA_LOCAL_REPORT  0.50f
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

static uint16_t msToReportSeconds(unsigned long intervalMs) {
   unsigned long sec = (intervalMs + 999UL) / 1000UL;
   if (sec < 1UL) sec = 1UL;
   if (sec > 65535UL) sec = 65535UL;
   return (uint16_t)sec;
}

static void applyLocalReportingProfile(unsigned long intervalMs) {
   uint16_t reportSec = msToReportSeconds(intervalMs);
   zbTempSensor.setReporting(reportSec, reportSec, TEMP_DELTA_LOCAL_REPORT);
   zbTempSensor.setHumidityReporting(reportSec, reportSec, HUMID_DELTA_LOCAL_REPORT);
   Serial.printf("[REPORT] Local profile applied: interval=%lu ms (~%us) temp_delta=%.2fC humid_delta=%.2f%%RH\n",
                 intervalMs,
                 (unsigned int)reportSec,
                 TEMP_DELTA_LOCAL_REPORT,
                 HUMID_DELTA_LOCAL_REPORT);
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
   applyLocalReportingProfile(g_attrUpdateIntervalMs);
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
/* ─── setup ──────────────────────────────────────────────────────── */
void setup() {
    Serial.begin(115200);
   g_bootMs = millis();

   g_aht20Ready = initAHT20();
   if (!g_aht20Ready) {
      Serial.println("[AHT20] Cannot continue without sensor. Halt.");
      for (;;) delay(1000);
   }

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
       Keep standard tolerance so stack accepts normal reporting behavior. */
   zbTempSensor.addHumiditySensor(0.0, 100.0, 0.5f, 50.0f);

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

   Serial.println("Startup mode: widget verify + IdentifyTime drives local temp/humid reporting interval");

    Serial.println("Waiting to join coordinator network...");
    Serial.println("(Run MODULE_START_NETWORK + MODULE_SET_PERMIT_JOIN on coordinator)");
    while (!Zigbee.connected()) {
        Serial.print(".");
        delay(500);
    }

      Serial.printf("[REPORT] Local push loop interval @ %lu ms\n", g_attrUpdateIntervalMs);

   /* Apply local reporting for BOTH clusters so temperature self-reports
      even when coordinator-side ConfigureReporting is rejected. */
   applyLocalReportingProfile(g_attrUpdateIntervalMs);

   /* Prime both attributes once right after join. */
   float tempC = 0.0f;
   float humidRH = 0.0f;
   if (readAHT20(tempC, humidRH)) {
      zbTempSensor.setTemperature(tempC);
      forceReportAttribute(ESP_ZB_ZCL_CLUSTER_ID_TEMP_MEASUREMENT, ESP_ZB_ZCL_ATTR_TEMP_MEASUREMENT_VALUE_ID);

      delay(200);

      zbTempSensor.setHumidity(humidRH);
      forceReportAttribute(ESP_ZB_ZCL_CLUSTER_ID_REL_HUMIDITY_MEASUREMENT, ESP_ZB_ZCL_ATTR_REL_HUMIDITY_MEASUREMENT_VALUE_ID);
      Serial.printf("[AHT20] Prime Temp=%.2fC Hum=%.2f%%RH\n", tempC, humidRH);
   } else {
      Serial.println("[AHT20] Prime read failed, skip initial report");
   }

    Serial.println();
    Serial.println("*** Joined Zigbee network! ***");
   g_joinCount++;
   Serial.printf("[DBG] Join #%lu at uptime %lus\n",
              (unsigned long)g_joinCount,
              (unsigned long)((millis() - g_bootMs) / 1000UL));
    Serial.println("Coordinator: run MODULE_AUTO_FIND_TARGET to bind");
   Serial.println("Device pushes both temp+humid by local profile after join");
   Serial.println("[DBG] Expect on widget: verify OK -> IdentifyTime updates interval -> both clusters keep reporting");
}

/* ─── forceReportAttribute: Bypass binding and explicitly send to 0x0000 EP1 ─── */
static void forceReportAttribute(uint16_t cluster_id, uint16_t attr_id) {
    esp_zb_zcl_report_attr_cmd_t cmd;
    memset(&cmd, 0, sizeof(cmd));
    cmd.zcl_basic_cmd.dst_addr_u.addr_short = 0x0000;
    cmd.zcl_basic_cmd.dst_endpoint = 1;
    cmd.zcl_basic_cmd.src_endpoint = ZIGBEE_EP_TEMP;
    
    cmd.address_mode = ESP_ZB_APS_ADDR_MODE_16_ENDP_PRESENT;
    cmd.clusterID = cluster_id;
    cmd.attributeID = attr_id;
    cmd.direction = ESP_ZB_ZCL_CMD_DIRECTION_TO_CLI;
    cmd.manuf_specific = 0;
    cmd.dis_default_resp = 0;
    
    esp_zb_lock_acquire(portMAX_DELAY);
    esp_err_t ret = esp_zb_zcl_report_attr_cmd_req(&cmd);
    esp_zb_lock_release();
    if (ret != ESP_OK) {
        Serial.printf("[ERROR] forceReportAttribute failed for cluster 0x%04X (err %d)\n", cluster_id, ret);
    }
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
          applyLocalReportingProfile(g_attrUpdateIntervalMs);
             Serial.printf("[REPORT] Rejoin profile applied; current interval @ %lu ms\n", g_attrUpdateIntervalMs);
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

      float tempC = 0.0f;
      float humidRH = 0.0f;
      if (!readAHT20(tempC, humidRH)) {
         Serial.println("[AHT20] Skip update due to read error");
         return;
      }
        
        /* Update and push Temperature */
        zbTempSensor.setTemperature(tempC);
        forceReportAttribute(ESP_ZB_ZCL_CLUSTER_ID_TEMP_MEASUREMENT, ESP_ZB_ZCL_ATTR_TEMP_MEASUREMENT_VALUE_ID);
        
        /* Small delay to prevent Zigbee APS queue overflow / MAC collisions */
        delay(200);
        
        /* Update and push Humidity */
        zbTempSensor.setHumidity(humidRH);
        forceReportAttribute(ESP_ZB_ZCL_CLUSTER_ID_REL_HUMIDITY_MEASUREMENT, ESP_ZB_ZCL_ATTR_REL_HUMIDITY_MEASUREMENT_VALUE_ID);
        Serial.printf("[ATTR] #%lu Temp=%.1f°C  Humid=%.1f%%RH  (push interval @ %lu ms)\n",
                      (unsigned long)g_attrUpdateCount,
                      tempC,
                      humidRH,
                      g_attrUpdateIntervalMs);
   }

      dbgPrintHeartbeat(conn);

    delay(100);
}
