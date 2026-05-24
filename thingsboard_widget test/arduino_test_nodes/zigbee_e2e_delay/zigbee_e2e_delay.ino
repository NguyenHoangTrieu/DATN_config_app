/*
 * DA2 Zigbee E2E Latency Test Node
 *
 * Hardware : ESP32-C6 (must be compiled with Zigbee End Device support)
 *            Set "Zigbee mode: Zigbee ED (end device)" in Arduino IDE
 *            Tools → Zigbee mode → Zigbee ED
 *
 * Purpose  : Transmit a Zigbee humidity attribute report carrying the
 *            low 16 bits of an NTP-synced Unix timestamp (milliseconds).
 *
 * Encoding:
 *   hum_raw (uint16, ×100 in ZCL) = (uint16_t)(ts_ms & 0xFFFF)
 *
 * Widget reconstruction:
 *   lo16   = Math.round(hum_rh * 100) & 0xFFFF
 *   ts_ms  = choose the epoch-nearest value to serverTs whose low16 = lo16
 *   e2e_delay_ms = thingsboard_msg_ts - ts_ms
 *
 * WiFi / NTP (sync at boot, then WiFi is disconnected before Zigbee init):
 *   SSID     = "Devil"
 *   Password = "hamhap7604"
 *   NTP pool = 192.168.1.100, time.google.com
 *
 * NOTE: Must select ZIGBEE_MODE_ED in the Arduino IDE board settings.
 */

#ifndef ZIGBEE_MODE_ED
#error "Select Zigbee End Device mode in Arduino IDE: Tools → Zigbee mode → Zigbee ED"
#endif

#include "Zigbee.h"
#include <WiFi.h>
#include <sys/time.h>
#include "time.h"
#include "esp_wifi.h"

/* ---- WiFi / NTP ----------------------------------------------------
 *  Sync to the SAME NTP source as the ThingsBoard server (RPi running
 *  chrony). Point NTP_SERVER1 at the RPi LAN IP so node clock matches
 *  server clock within ~1 ms — required for meaningful e2e-delay numbers.
 * ------------------------------------------------------------------- */
#define WIFI_SSID       "Devil"
#define WIFI_PASS       "hamhap7604"
#define NTP_SERVER1     "192.168.1.100"     /* ← RPi ThingsBoard server LAN IP */
#define NTP_SERVER2     "time.google.com"  /* ← fallback                       */
#define NTP_GMT_OFFSET  0
#define NTP_DAYLIGHT    0
#define WIFI_TIMEOUT_MS 15000UL
#define NTP_SYNC_TIMEOUT_MS 20000UL
#define NTP_POLL_MS     200UL
#define NTP_PRIMARY_PROBE_MS 5000UL

/* ---- Zigbee -------------------------------------------------------- */
#define ZB_ENDPOINT         0x0B
#define DEVICE_NAME         "DA2_ZB_E2E"
#define SEND_INTERVAL_MS    3000UL
#define REJOIN_TIMEOUT_MS   15000UL
#define POST_JOIN_WARMUP_MS 3000UL

ZigbeeTempSensor g_sensor(ZB_ENDPOINT);

static bool     g_ntpSynced    = false;
static const char *g_ntpSyncLabel = "unsynced";
static const char *g_ntpSyncHost  = "";
static uint32_t g_lastReportMs = 0;
static uint32_t g_reportCount  = 0;
static uint32_t g_lostSinceMs  = 0;
static uint32_t g_joinedAtMs   = 0;
static bool     g_lostPending  = false;

/* -------------------------------------------------------------------- */
/*  NTP helpers                                                          */
/* -------------------------------------------------------------------- */

static void stopWiFi(void) {
  /* Stop WiFi cleanly after SNTP so the radio is quiet before Zigbee starts. */
  esp_wifi_disconnect();
  delay(100);
  esp_wifi_stop();
  delay(200);
}

static bool syncNTPFromServer(const char *server, const char *label, uint32_t timeoutMs) {
  struct tm info = {};
  uint32_t syncStart = millis();

  Serial.printf("[NTP] Trying %s (%s)", label, server);
  configTime(NTP_GMT_OFFSET, NTP_DAYLIGHT, server);

  while (!getLocalTime(&info, NTP_POLL_MS)) {
    if (millis() - syncStart > timeoutMs) {
      Serial.printf("\n[NTP] %s timeout after %lu ms\n",
                    label,
                    (unsigned long)(millis() - syncStart));
      return false;
    }
    delay(NTP_POLL_MS);
    Serial.print('.');
  }

  g_ntpSyncLabel = label;
  g_ntpSyncHost  = server;
  Serial.printf("\n[NTP] Sync source locked: %s (%s)\n", g_ntpSyncLabel, g_ntpSyncHost);
  return true;
}

static void syncNTP(void) {
  g_ntpSynced = false;
  g_ntpSyncLabel = "unsynced";
  g_ntpSyncHost  = "";

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  Serial.println("[NTP] Connecting WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > WIFI_TIMEOUT_MS) {
      Serial.println("[NTP] WiFi timeout");
      stopWiFi();
      return;
    }
    delay(300);
    Serial.print('.');
  }
  Serial.printf("\n[NTP] WiFi OK: %s  RSSI=%d dBm  GW=%s  DNS=%s\n",
                WiFi.localIP().toString().c_str(),
                WiFi.RSSI(),
                WiFi.gatewayIP().toString().c_str(),
                WiFi.dnsIP().toString().c_str());

  if (!syncNTPFromServer(NTP_SERVER1, "RPi", NTP_PRIMARY_PROBE_MS)) {
    Serial.printf("[NTP] Falling back to google.com (%s)\n", NTP_SERVER2);
    if (!syncNTPFromServer(NTP_SERVER2, "google.com", NTP_SYNC_TIMEOUT_MS)) {
      Serial.printf("[NTP] Sync failed after trying %s then %s (GW=%s DNS=%s)\n",
                    NTP_SERVER1,
                    NTP_SERVER2,
                    WiFi.gatewayIP().toString().c_str(),
                    WiFi.dnsIP().toString().c_str());
      stopWiFi();
      return;
    }
  }

  struct timeval tv = {};
  if (gettimeofday(&tv, NULL) != 0) {
    Serial.println("[NTP] gettimeofday failed after sync");
    stopWiFi();
    return;
  }

  uint64_t epochMs = ((uint64_t)tv.tv_sec * 1000ULL) + ((uint64_t)tv.tv_usec / 1000ULL);
  g_ntpSynced = true;
  Serial.printf("[NTP] Synced via %s (%s) — epoch_ms=%llu\n",
                g_ntpSyncLabel,
                g_ntpSyncHost,
                (unsigned long long)epochMs);

  /* Disconnect WiFi before initialising Zigbee (both use 2.4 GHz).      */
  stopWiFi();
  Serial.println("[NTP] WiFi stopped (radio off, coex intact)");
}

/* Returns current Unix timestamp in milliseconds from the ESP32 system clock. */
static uint64_t currentMs(void) {
  if (!g_ntpSynced) return 0ULL;

  struct timeval tv = {};
  if (gettimeofday(&tv, NULL) != 0) return 0ULL;

  return ((uint64_t)tv.tv_sec * 1000ULL) + ((uint64_t)tv.tv_usec / 1000ULL);
}

static void suppressDefaultReporting(void) {
  g_sensor.setReporting(0xFFFF, 0xFFFF, 655.0f);
  g_sensor.setHumidityReporting(0xFFFF, 0xFFFF, 655.35f);
}

/* -------------------------------------------------------------------- */
/*  Arduino entry points                                                 */
/* -------------------------------------------------------------------- */

void setup(void) {
  Serial.begin(115200);
  delay(1000);
  randomSeed(esp_random());
  Serial.println("=== DA2 Zigbee E2E Delay Node ===");

  /* Sync NTP first; Zigbee reporting APIs are not touched until after
   * Zigbee.begin() returns because they require the Zigbee OS mutex. */
  syncNTP();
  if (!g_ntpSynced) {
    Serial.println("[WARN] NTP sync failed — timestamps will be zero");
  }

  /* Step 2: configure the ZCL endpoint. Reporting suppression is applied
   * only after Zigbee.begin() because it touches the live Zigbee stack. */
  g_sensor.setManufacturerAndModel("DA2", "DATN_AUTH_KEY:" DEVICE_NAME);
  /* Wide range so the gateway never clamps our encoded value */
  g_sensor.setMinMaxValue(-327.68f, 327.67f);
  g_sensor.setTolerance(0.01f);
  g_sensor.addHumiditySensor(0.0f, 655.35f, 655.35f, 60.0f);

  Zigbee.addEndpoint(&g_sensor);

  Serial.println("[ZB] Starting Zigbee (ED mode)...");
  if (!Zigbee.begin(ZIGBEE_END_DEVICE, false)) {
    Serial.println("[ZB] Zigbee.begin failed — halting");
    for (;;) delay(1000);
  }

  /* Reporting configuration touches the Zigbee stack and must only run
   * after Zigbee.begin() has created the internal OS primitives. */
  suppressDefaultReporting();

  Serial.println("[ZB] Waiting to join network...");
  while (!Zigbee.connected()) {
    Serial.print('.');
    delay(400);
  }
  Serial.println();
  Serial.println("[ZB] Joined network");

  g_joinedAtMs = millis();
  g_lastReportMs = millis();
  Serial.println("[ZB] Ready — sending humidity timestamp reports every " + String(SEND_INTERVAL_MS) + " ms");
}

void loop(void) {
  uint32_t now = millis();
  bool connected = Zigbee.connected();

  if (!connected && !g_lostPending) {
    g_lostPending = true;
    g_lostSinceMs = now;
    Serial.println("[ZB] Lost network");
  }

  if (connected && g_lostPending) {
    g_lostPending = false;
    g_joinedAtMs = now;
    suppressDefaultReporting();
    Serial.println("[ZB] Rejoined");
  }

  if (g_lostPending && (now - g_lostSinceMs >= REJOIN_TIMEOUT_MS)) {
    Serial.println("[ZB] Rejoin timeout -> factory reset");
    Zigbee.factoryReset();
    for (;;) delay(1000);
  }

  if (!connected || (now - g_joinedAtMs < POST_JOIN_WARMUP_MS)) {
    delay(1);
    return;
  }

  if (now - g_lastReportMs >= SEND_INTERVAL_MS) {
    g_lastReportMs = now;

    uint64_t ts = currentMs();

    /* Humidity attribute carries ts_ms low16 directly as uint16 ×100. */
    uint16_t hum_raw = (uint16_t)(ts & 0xFFFFULL);
    float humEncoded = (float)hum_raw / 100.0f;

    g_sensor.setHumidity(humEncoded);
    g_sensor.reportHumidity();

    g_reportCount++;
    Serial.printf("[ZB TX] #%lu  ts_ms=%llu  hum_raw=%u  hum=%.2f\n",
                  (unsigned long)g_reportCount,
                  (unsigned long long)ts,
                  (unsigned)hum_raw,
                  humEncoded);
  }
}
