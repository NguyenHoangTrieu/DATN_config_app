/*
 * DA2 Zigbee E2E Latency Test Node
 *
 * Hardware : ESP32-C6 (must be compiled with Zigbee End Device support)
 *            Set "Zigbee mode: Zigbee ED (end device)" in Arduino IDE
 *            Tools → Zigbee mode → Zigbee ED
 *
 * Purpose  : Transmit Zigbee attribute reports carrying an NTP-synced
 *            Unix timestamp (seconds) encoded across the standard
 *            Temperature and Humidity ZCL attributes.
 *
 * Encoding (compatible with existing gateway Zigbee handler):
 *   temp_raw (int16, ×100 in ZCL) = (int16_t)(ts_sec & 0xFFFF)
 *   hum_raw  (uint16, ×100 in ZCL) = (uint16_t)((ts_sec >> 16) & 0xFFFF)
 *
 * Widget reconstruction:
 *   lo     = Math.round(temp_c * 100) & 0xFFFF   // unsigned 16 bits
 *   hi     = Math.round(hum_rh * 100) & 0xFFFF
 *   ts_sec = (hi << 16) | lo
 *   e2e_delay_ms = thingsboard_msg_ts - ts_sec * 1000
 *
 * WiFi / NTP (sync at boot, then WiFi is disconnected before Zigbee init):
 *   SSID     = "Devil"
 *   Password = "hamhap7604"
 *   NTP pool = pool.ntp.org, time.google.com
 *
 * NOTE: Must select ZIGBEE_MODE_ED in the Arduino IDE board settings.
 */

#ifndef ZIGBEE_MODE_ED
#error "Select Zigbee End Device mode in Arduino IDE: Tools → Zigbee mode → Zigbee ED"
#endif

#include "Zigbee.h"
#include <WiFi.h>
#include "time.h"

/* ---- WiFi / NTP ---------------------------------------------------- */
#define WIFI_SSID       "Devil"
#define WIFI_PASS       "hamhap7604"
#define NTP_SERVER1     "pool.ntp.org"
#define NTP_SERVER2     "time.google.com"
#define NTP_GMT_OFFSET  0
#define NTP_DAYLIGHT    0
#define WIFI_TIMEOUT_MS 15000UL

/* ---- Zigbee -------------------------------------------------------- */
#define ZB_ENDPOINT         0x0B
#define DEVICE_NAME         "DA2_ZB_E2E"
#define SEND_INTERVAL_MS    3000UL
#define REJOIN_TIMEOUT_MS   15000UL
#define POST_JOIN_WARMUP_MS 2000UL

ZigbeeTempSensor g_sensor(ZB_ENDPOINT);

static uint32_t g_ntpBaseSec   = 0;   /* Unix epoch seconds at ntp_millis */
static uint32_t g_ntpMillis    = 0;   /* millis() when NTP was synced */
static bool     g_ntpSynced    = false;
static uint32_t g_lastReportMs = 0;
static uint32_t g_reportCount  = 0;

/* -------------------------------------------------------------------- */
/*  NTP helpers                                                          */
/* -------------------------------------------------------------------- */

static void syncNTP(void) {
  Serial.println("[NTP] Connecting WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > WIFI_TIMEOUT_MS) {
      Serial.println("[NTP] WiFi timeout");
      return;
    }
    delay(300);
    Serial.print('.');
  }
  Serial.printf("\n[NTP] WiFi OK: %s\n", WiFi.localIP().toString().c_str());

  configTime(NTP_GMT_OFFSET, NTP_DAYLIGHT, NTP_SERVER1, NTP_SERVER2);
  Serial.print("[NTP] Waiting for sync");

  struct tm info;
  uint32_t deadline = millis() + 10000UL;
  while (!getLocalTime(&info)) {
    if (millis() > deadline) {
      Serial.println("\n[NTP] Sync failed");
      WiFi.disconnect(true);
      return;
    }
    delay(300);
    Serial.print('.');
  }

  time_t now_sec;
  time(&now_sec);
  g_ntpBaseSec = (uint32_t)now_sec;
  g_ntpMillis  = millis();
  g_ntpSynced  = true;
  Serial.printf("\n[NTP] Synced — epoch_sec=%lu  millis=%lu\n",
                (unsigned long)g_ntpBaseSec, (unsigned long)g_ntpMillis);

  /* Disconnect WiFi before initialising Zigbee (both use 2.4 GHz).      */
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(200);
  Serial.println("[NTP] WiFi disconnected");
}

/* Returns current Unix timestamp in seconds (NTP-aligned). */
static uint32_t currentSec(void) {
  if (!g_ntpSynced) return 0UL;
  uint32_t elapsed_sec = (millis() - g_ntpMillis) / 1000UL;
  return g_ntpBaseSec + elapsed_sec;
}

/* -------------------------------------------------------------------- */
/*  Arduino entry points                                                 */
/* -------------------------------------------------------------------- */

void setup(void) {
  Serial.begin(115200);
  delay(1000);
  Serial.println("=== DA2 Zigbee E2E Delay Node ===");

  /* Step 1: sync NTP while WiFi is safe to use */
  syncNTP();
  if (!g_ntpSynced) {
    Serial.println("[WARN] NTP sync failed — timestamps will be zero");
  }

  /* Step 2: configure ZCL endpoint — suppress default periodic reporting,
   *         we drive reports manually every SEND_INTERVAL_MS.          */
  g_sensor.setManufacturerAndModel("DA2", "DATN_AUTH_KEY:" DEVICE_NAME);
  /* Wide range so the gateway never clamps our encoded value */
  g_sensor.setMinMaxValue(-327.68f, 327.67f);
  g_sensor.setTolerance(0.01f);
  g_sensor.addHumiditySensor(0.0f, 655.35f, 655.35f, 60.0f);
  /* Disable automatic reporting — we call report*() ourselves */
  g_sensor.setReporting(0xFFFF, 0xFFFF, 655.0f);
  g_sensor.setHumidityReporting(0xFFFF, 0xFFFF, 655.35f);

  Zigbee.addEndpoint(&g_sensor);

  Serial.println("[ZB] Starting Zigbee (ED mode)...");
  if (!Zigbee.begin(ZIGBEE_END_DEVICE, false)) {
    Serial.println("[ZB] Zigbee.begin failed — halting");
    for (;;) delay(1000);
  }

  Serial.println("[ZB] Waiting to join network...");
  uint32_t joinStart = millis();
  while (!Zigbee.connected()) {
    if (millis() - joinStart > REJOIN_TIMEOUT_MS) {
      Serial.println("[ZB] Join timeout — will retry");
      Zigbee.begin(ZIGBEE_END_DEVICE, false);
      joinStart = millis();
    }
    delay(400);
    Serial.print('.');
  }
  Serial.println("\n[ZB] Joined network");

  delay(POST_JOIN_WARMUP_MS);
  g_lastReportMs = millis();
  Serial.println("[ZB] Ready — sending timestamp reports every " + String(SEND_INTERVAL_MS) + " ms");
}

void loop(void) {
  uint32_t now = millis();

  /* Rejoin if lost */
  if (!Zigbee.connected()) {
    Serial.println("[ZB] Lost network — attempting rejoin");
    Zigbee.begin(ZIGBEE_END_DEVICE, false);
    uint32_t t0 = millis();
    while (!Zigbee.connected() && millis() - t0 < REJOIN_TIMEOUT_MS) {
      delay(400);
      Serial.print('.');
    }
    if (Zigbee.connected()) {
      Serial.println("\n[ZB] Rejoined");
    } else {
      Serial.println("\n[ZB] Rejoin failed — retrying later");
      delay(3000);
      return;
    }
  }

  if (now - g_lastReportMs >= SEND_INTERVAL_MS) {
    g_lastReportMs = now;

    uint32_t ts = currentSec();

    /* Encode: low 16 bits → temperature attribute (raw ×100),
     *         high 16 bits → humidity attribute (raw ×100)     */
    int16_t  lo_raw = (int16_t)(ts & 0xFFFF);
    uint16_t hi_raw = (uint16_t)((ts >> 16) & 0xFFFF);

    float tempEncoded = (float)lo_raw / 100.0f;   /* ZCL stores ×100 */
    float humEncoded  = (float)hi_raw / 100.0f;

    g_sensor.setTemperature(tempEncoded);
    g_sensor.setHumidity(humEncoded);
    g_sensor.reportTemperature();
    delay(5);
    g_sensor.reportHumidity();

    g_reportCount++;
    Serial.printf("[ZB TX] #%lu  ts_sec=%lu  lo_raw=%d  hi_raw=%u  "
                  "temp=%.2f  hum=%.2f\n",
                  (unsigned long)g_reportCount,
                  (unsigned long)ts,
                  (int)lo_raw, (unsigned)hi_raw,
                  tempEncoded, humEncoded);
  }
}
