/*
 * DA2 Zigbee Bandwidth Node - ESP32-C6
 *
 * Test profile:
 * - Zigbee End Device, endpoint 0x0B
 * - Sends one temperature report and one humidity report every 20 ms
 * - With widget-side effective payload size configured to 99 B per report,
 *   2 reports / 20 ms ~= 79.2 kbps effective throughput
 */

#ifndef ZIGBEE_MODE_ED
#error "Select Zigbee End Device mode in Arduino IDE"
#endif

#include "Zigbee.h"

#define ZB_ENDPOINT            0x0B
#define DEVICE_NAME            "DA2_ZB_BW"
#define UPDATE_INTERVAL_MS     20UL
#define REJOIN_TIMEOUT_MS      10000UL

ZigbeeTempSensor g_sensor(ZB_ENDPOINT);

uint32_t g_lastReportMs = 0;
uint32_t g_reportCount = 0;
uint32_t g_lostSinceMs = 0;
bool g_lostPending = false;

static float simTempC(void) {
  float t = (float)millis() / 1000.0f;
  return 25.0f + 2.0f * sinf(2.0f * PI * t / 40.0f);
}

static float simHumPct(void) {
  float t = (float)millis() / 1000.0f;
  return 60.0f + 5.0f * sinf(2.0f * PI * t / 33.0f);
}

static void suppressDefaultReporting(void) {
  g_sensor.setReporting(0xFFFF, 0xFFFF, 200.0f);
  g_sensor.setHumidityReporting(0xFFFF, 0xFFFF, 655.35f);
}

static void sendBandwidthBurst(void) {
  float tempC = simTempC();
  float humPct = simHumPct();

  g_sensor.setTemperature(tempC);
  g_sensor.setHumidity(humPct);

  g_sensor.reportTemperature();
  delay(2);
  g_sensor.reportHumidity();

  g_reportCount += 2;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  randomSeed(esp_random());

  Serial.println("DA2 Zigbee Bandwidth Node");
  Serial.printf("Endpoint: 0x%02X, interval: %lu ms, effective target: 79.2 kbps\n",
                ZB_ENDPOINT,
                (unsigned long)UPDATE_INTERVAL_MS);

  g_sensor.setManufacturerAndModel("DA2", "DATN_AUTH_KEY:" DEVICE_NAME);
  g_sensor.setMinMaxValue(-10.0f, 80.0f);
  g_sensor.setTolerance(0.1f);
  g_sensor.addHumiditySensor(0.0f, 100.0f, 655.35f, 60.0f);
  suppressDefaultReporting();

  Zigbee.addEndpoint(&g_sensor);

  if (!Zigbee.begin(ZIGBEE_END_DEVICE, true)) {
    Serial.println("[ZB] Zigbee.begin failed");
    for (;;) delay(1000);
  }

  Serial.println("[ZB] Waiting to join network...");
  while (!Zigbee.connected()) {
    Serial.print('.');
    delay(400);
  }
  Serial.println();
  Serial.println("[ZB] Joined");
  g_sensor.setHumidity(60.0f);
  g_sensor.setTemperature(25.0f);
  sendBandwidthBurst();
}

void loop() {
  bool connected = Zigbee.connected();
  uint32_t now = millis();

  if (!connected && !g_lostPending) {
    g_lostPending = true;
    g_lostSinceMs = now;
    Serial.println("[ZB] Lost network");
  }

  if (connected && g_lostPending) {
    g_lostPending = false;
    suppressDefaultReporting();
    Serial.println("[ZB] Rejoined");
  }

  if (g_lostPending && (now - g_lostSinceMs >= REJOIN_TIMEOUT_MS)) {
    Serial.println("[ZB] Rejoin timeout -> factory reset");
    Zigbee.factoryReset();
    for (;;) delay(1000);
  }

  if (connected && (now - g_lastReportMs >= UPDATE_INTERVAL_MS)) {
    g_lastReportMs = now;
    sendBandwidthBurst();
  }

  static uint32_t lastLogMs = 0;
  if (connected && (now - lastLogMs >= 1000)) {
    lastLogMs = now;
    Serial.printf("[ZB] reports=%lu interval=%lu ms\n",
                  (unsigned long)g_reportCount,
                  (unsigned long)UPDATE_INTERVAL_MS);
  }

  delay(1);
}