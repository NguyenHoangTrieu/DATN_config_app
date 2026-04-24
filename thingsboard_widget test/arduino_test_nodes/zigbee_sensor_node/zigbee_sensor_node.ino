/**
 * @file    zigbee_sensor_node.ino
 * @brief   DA2 total-test Zigbee sensor node for ESP32-C6.
 *
 * Behaviour matches the native Zigbee sensor reference sketch:
 * - Zigbee.h end-device on endpoint 0x0B
 * - silent after join until the dashboard verifies the node and configures push reporting
 * - reporting suppression is only applied on join/rejoin so widget Configure Reporting can take over
 *
 * Difference for total-test:
 * - the local attribute refresh interval is adjustable at runtime over Serial
 *   with ATTR=<ms>, READ=<ms>, or INT=<ms>
 */

#ifndef ZIGBEE_MODE_ED
#error "Select Zigbee End Device mode in Arduino IDE: Tools > Zigbee mode > Zigbee ED (end device)"
#endif

#include "Zigbee.h"

#define ZIGBEE_EP_TEMP                    11
#define ATTR_UPDATE_INTERVAL_DEFAULT_MS   1000UL
#define ATTR_UPDATE_INTERVAL_MIN_MS       100UL
#define ATTR_UPDATE_INTERVAL_MAX_MS       60000UL
#define REJOIN_TIMEOUT_MS                 10000UL

#define TEMP_MIN_C  20.0f
#define TEMP_MAX_C  35.0f
#define HUMID_MIN_RH 45.0f
#define HUMID_MAX_RH 75.0f

#define HUMID_DELTA_IMPOSSIBLE 655.35f
#define TEMP_DELTA_IMPOSSIBLE  200.0f

#define DEVICE_NAME "total_zb_sensor"

static unsigned long g_attrUpdateIntervalMs = ATTR_UPDATE_INTERVAL_DEFAULT_MS;
static unsigned long g_lastAttrUpdateMs = 0;
static unsigned long g_disconnectedSinceMs = 0;
static bool g_disconnectPending = false;
static bool g_isReportingActive = false;

ZigbeeTempSensor zbTempSensor(ZIGBEE_EP_TEMP);

static float getSimulatedTemp(void) {
  return TEMP_MIN_C + (random(0, 1501) / 100.0f);
}

static float getSimulatedHumidity(void) {
  return HUMID_MIN_RH + (random(0, 3001) / 100.0f);
}

static void applyReportingSuppression(void) {
  zbTempSensor.setReporting(0xFFFF, 0xFFFF, TEMP_DELTA_IMPOSSIBLE);
  zbTempSensor.setHumidityReporting(0xFFFF, 0xFFFF, HUMID_DELTA_IMPOSSIBLE);
}

static void updateSensorAttrs(void) {
  float tempC = getSimulatedTemp();
  float humidRH = getSimulatedHumidity();

  zbTempSensor.setTemperature(tempC);
  zbTempSensor.setHumidity(humidRH);
  
  // Explicitly send report to gateway with a delay to prevent buffer collision
  zbTempSensor.reportTemperature();
  delay(50);
  zbTempSensor.reportHumidity();

  Serial.printf("[ATTR] Temp=%.1fC  Humid=%.1f%%RH  interval=%lu ms\n",
                tempC, humidRH, g_attrUpdateIntervalMs);
}

static void handleIdentify(uint16_t time) {
  if (time >= ATTR_UPDATE_INTERVAL_MIN_MS && time <= ATTR_UPDATE_INTERVAL_MAX_MS) {
    g_attrUpdateIntervalMs = time;
    g_isReportingActive = true; // Enable reporting when widget sets interval
    Serial.printf("[CFG] Interval updated via ZCL IdentifyTime: %lu ms\n", g_attrUpdateIntervalMs);
    g_lastAttrUpdateMs = 0; // force immediate update
  } else if (time >= 50000) {
    Serial.printf("[CFG] Verify Code received: %u\n", time);
  }
}

static void printStatus(void) {
  Serial.printf("[STATUS] joined=%d interval=%lu ms endpoint=0x%02X model=DATN_AUTH_KEY:%s\n",
                Zigbee.connected() ? 1 : 0,
                g_attrUpdateIntervalMs,
                ZIGBEE_EP_TEMP,
                DEVICE_NAME);
}

static void handleSerialCommand(void) {
  if (!Serial.available()) {
    return;
  }

  String line = Serial.readStringUntil('\n');
  line.trim();
  if (!line.length()) {
    return;
  }

  line.toUpperCase();
  if (line == "STATUS") {
    printStatus();
    return;
  }

  int eq = line.indexOf('=');
  if (eq <= 0) {
    Serial.printf("[CFG] Unknown command: %s\n", line.c_str());
    return;
  }

  String key = line.substring(0, eq);
  unsigned long value = (unsigned long)line.substring(eq + 1).toInt();
  if (key != "ATTR" && key != "READ" && key != "INT") {
    Serial.printf("[CFG] Unsupported key: %s\n", key.c_str());
    return;
  }

  if (value < ATTR_UPDATE_INTERVAL_MIN_MS) {
    value = ATTR_UPDATE_INTERVAL_MIN_MS;
  }
  if (value > ATTR_UPDATE_INTERVAL_MAX_MS) {
    value = ATTR_UPDATE_INTERVAL_MAX_MS;
  }

  g_attrUpdateIntervalMs = value;
  g_isReportingActive = true;
  g_lastAttrUpdateMs = 0;
  Serial.printf("[CFG] Attribute refresh interval set to %lu ms (Reporting Activated)\n", g_attrUpdateIntervalMs);
}

void setup() {
  Serial.begin(115200);
  randomSeed(esp_random());

  Serial.println("\nDA2 Total Test — Zigbee Sensor Node");
  Serial.printf("Endpoint: %d (0x%02X)\n", ZIGBEE_EP_TEMP, ZIGBEE_EP_TEMP);
  Serial.printf("Default attr refresh interval: %lu ms\n", g_attrUpdateIntervalMs);
  Serial.println("Serial commands: STATUS | ATTR=<ms> | READ=<ms> | INT=<ms>");

  zbTempSensor.setMinMaxValue(TEMP_MIN_C, TEMP_MAX_C);
  zbTempSensor.setTolerance(1);
  zbTempSensor.setManufacturerAndModel("Espressif", "DATN_AUTH_KEY:" DEVICE_NAME);
  zbTempSensor.addHumiditySensor(0.0f, 100.0f, HUMID_DELTA_IMPOSSIBLE,
                                 (HUMID_MIN_RH + HUMID_MAX_RH) / 2.0f);
  zbTempSensor.onIdentify(handleIdentify);

  Zigbee.addEndpoint(&zbTempSensor);

  if (!Zigbee.begin(ZIGBEE_END_DEVICE, true)) {
    Serial.println("[ERROR] Zigbee.begin() failed");
    Serial.println("[ERROR] Set Tools > Zigbee mode to Zigbee ED (end device)");
    delay(3000);
    Zigbee.factoryReset();
    for (;;) {
      delay(1000);
    }
  }

  Serial.println("Silent mode enabled; wait for Verify Node + Setup Push from dashboard");
  Serial.println("Waiting to join coordinator network...");
  while (!Zigbee.connected()) {
    Serial.print('.');
    delay(500);
  }

  applyReportingSuppression();
  zbTempSensor.setHumidity((HUMID_MIN_RH + HUMID_MAX_RH) / 2.0f);
  updateSensorAttrs();

  Serial.println();
  Serial.println("*** Joined Zigbee network ***");
  Serial.println("Coordinator: run MODULE_START_NETWORK + MODULE_SET_PERMIT_JOIN");
  Serial.println("Gateway must verify Basic/0005, then configure push reporting on endpoint 0x0B");
}

void loop() {
  handleSerialCommand();

  static bool lastConn = true;
  bool conn = Zigbee.connected();
  if (conn != lastConn) {
    if (!conn) {
      Serial.println("*** Lost network — starting rejoin watchdog ***");
      g_disconnectPending = true;
      g_disconnectedSinceMs = millis();
    } else {
      Serial.println("*** Re-joined network ***");
      g_disconnectPending = false;
      applyReportingSuppression();
      updateSensorAttrs();
      Serial.println("[REPORT] Suppressed after rejoin; waiting for Setup Push");
    }
    lastConn = conn;
  }

  if (!conn && g_disconnectPending &&
      (millis() - g_disconnectedSinceMs >= REJOIN_TIMEOUT_MS)) {
    Serial.println("[REJOIN] Timeout — factoryReset() for full channel scan");
    delay(200);
    Zigbee.factoryReset();
    for (;;) {
      delay(1000);
    }
  }

  if (conn && g_isReportingActive && (millis() - g_lastAttrUpdateMs >= g_attrUpdateIntervalMs)) {
    g_lastAttrUpdateMs = millis();
    updateSensorAttrs();
  }

  delay(100);
}
