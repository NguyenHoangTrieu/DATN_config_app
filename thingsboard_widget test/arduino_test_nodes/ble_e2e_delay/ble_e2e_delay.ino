/*
 * DA2 BLE E2E Latency Test Node
 *
 * Hardware : ESP32-S3 (same board as ble_sensor_node)
 *
 * Purpose  : Advertise a GATT server, then NOTIFY an 8-byte payload
 *            carrying an NTP-synced Unix timestamp (ms) every
 *            SEND_INTERVAL_MS when a central is connected.
 *
 * Payload format (8 bytes, little-endian):
 *   Byte 0-7 : uint64_t node_ts_ms  (Unix epoch in milliseconds)
 *
 * ThingsBoard telemetry key sent by the gateway: "ble_data" (raw hex).
 * Widget decodes:
 *   lo32 = hex[0..7] decoded as uint32 LE
 *   hi32 = hex[8..15] decoded as uint32 LE
 *   node_ts_ms = hi32 * 2^32 + lo32
 *   e2e_delay_ms = thingsboard_msg_ts - node_ts_ms
 *
 * WiFi / NTP (sync at boot, WiFi disconnected before BLE starts):
 *   SSID     = "Devil"
 *   Password = "hamhap7604"
 *   NTP pool = pool.ntp.org, time.google.com
 *
 * GATT layout:
 *   Service UUID : 0000E2E0-0000-1000-8000-00805F9B34FB
 *   TS NOTIFY    : 0000E2E1-0000-1000-8000-00805F9B34FB  (8 bytes, NOTIFY)
 *   INTERVAL W   : 0000E2E2-0000-1000-8000-00805F9B34FB  (uint16 LE, WRITE)
 */

#ifndef RGB_BUILTIN
#define RGB_BUILTIN 48
#endif

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <WiFi.h>
#include "time.h"

/* ---- WiFi / NTP ----------------------------------------------------
 *
 *  IMPORTANT: For accurate e2e-delay measurement, the NODE and the
 *  ThingsBoard SERVER must share the same time reference. The cleanest
 *  setup is to run chrony on the RPi and point NTP_SERVER1 at the RPi's
 *  LAN IP — both will then track UTC within ~1 ms.
 *
 *  See chrony setup commands in the widget repo's README. After enabling
 *  chrony on the RPi, set NTP_SERVER1 to its LAN IP (e.g. 192.168.1.10)
 *  and keep a public fallback in NTP_SERVER2.
 * ------------------------------------------------------------------- */
#define WIFI_SSID        "Devil"
#define WIFI_PASS        "hamhap7604"
#define NTP_SERVER1      "192.168.1.100"     /* ← RPi ThingsBoard server LAN IP */
#define NTP_SERVER2      "time.google.com"  /* ← fallback if RPi unreachable    */
#define NTP_GMT_OFFSET   0
#define NTP_DAYLIGHT     0
#define WIFI_TIMEOUT_MS  15000UL
#define NTP_SYNC_TIMEOUT_MS 20000UL
#define NTP_POLL_MS      200UL
#define NTP_PRIMARY_PROBE_MS 5000UL

/* ---- BLE ----------------------------------------------------------- */
#define DEVICE_NAME      "DA2_BLE_E2E"
#define SERVICE_UUID     "0000E2E0-0000-1000-8000-00805F9B34FB"
#define CHAR_TS_UUID     "0000E2E1-0000-1000-8000-00805F9B34FB"
#define CHAR_INTV_UUID   "0000E2E2-0000-1000-8000-00805F9B34FB"

/* ---- Timing -------------------------------------------------------- */
#define SEND_INTERVAL_MS_DEFAULT  3000UL

/* -------------------------------------------------------------------- */
static BLEServer        *g_server    = nullptr;
static BLECharacteristic *g_tsChar   = nullptr;
static BLECharacteristic *g_intvChar = nullptr;

static volatile bool     g_connected    = false;
static volatile bool     g_notifyEn     = false;
static uint32_t          g_sendInterval = SEND_INTERVAL_MS_DEFAULT;
static uint32_t          g_lastSendMs   = 0;
static uint32_t          g_packetsSent  = 0;

/* NTP state */
static uint64_t g_ntpBaseMs  = 0;
static uint32_t g_ntpMillis  = 0;
static bool     g_ntpSynced  = false;
static const char *g_ntpSyncLabel = "unsynced";
static const char *g_ntpSyncHost  = "";

/* -------------------------------------------------------------------- */
/*  NTP helpers                                                          */
/* -------------------------------------------------------------------- */

static void stopWiFi(void) {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
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

  time_t now_sec;
  time(&now_sec);
  g_ntpBaseMs = (uint64_t)now_sec * 1000ULL;
  g_ntpMillis = millis();
  g_ntpSynced = true;
  Serial.printf("[NTP] Synced via %s (%s) — epoch_ms=%llu  millis=%lu\n",
                g_ntpSyncLabel,
                g_ntpSyncHost,
                (unsigned long long)g_ntpBaseMs, (unsigned long)g_ntpMillis);

  stopWiFi();
  delay(200);
  Serial.println("[NTP] WiFi disconnected");
}

static uint64_t currentMs(void) {
  if (!g_ntpSynced) return 0ULL;
  return g_ntpBaseMs + (uint64_t)(millis() - g_ntpMillis);
}

/* -------------------------------------------------------------------- */
/*  GATT callbacks                                                       */
/* -------------------------------------------------------------------- */

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    /* NimBLE auto-creates the CCCD (0x2902) for NOTIFY-capable characteristics,
     * and a manually-added BLE2902 will NEVER receive the subscribe callback
     * on current Arduino-ESP32 BLE stack versions (the library log warns:
     *   "NimBLE automatically creates the 0x2902 descriptor ...").
     * So we cannot reliably gate on a CCCD-write callback.
     *
     * Instead, set both flags on connect — notify() is a safe no-op if the
     * client has not yet written CCCD=0x0100. The gateway subscribes within
     * ~1 s after CONNECT so at most one packet is dropped.                  */
    g_connected = true;
    g_notifyEn  = true;
    neopixelWrite(RGB_BUILTIN, 0, 24, 0);
    Serial.println("[BLE] Central connected — TX enabled");
  }
  void onDisconnect(BLEServer *) override {
    g_connected = false;
    g_notifyEn  = false;
    neopixelWrite(RGB_BUILTIN, 0, 0, 24);
    Serial.println("[BLE] Disconnected — restarting advertising");
    BLEDevice::startAdvertising();
  }
};

class IntvCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    uint8_t *d = c->getData();
    size_t   n = c->getLength();
    if (n >= 2) {
      uint16_t v = (uint16_t)d[0] | ((uint16_t)d[1] << 8);
      if (v >= 100 && v <= 60000) {
        g_sendInterval = v;
        Serial.printf("[BLE] Interval set to %u ms\n", v);
      }
    }
  }
};

/* -------------------------------------------------------------------- */
/*  Arduino entry points                                                 */
/* -------------------------------------------------------------------- */

void setup(void) {
  Serial.begin(115200);
  delay(1500);
  neopixelWrite(RGB_BUILTIN, 0, 0, 24); /* blue = booting */
  Serial.println("=== DA2 BLE E2E Delay Node ===");

  /* Step 1: sync NTP over WiFi */
  syncNTP();
  if (!g_ntpSynced) {
    Serial.println("[WARN] NTP not synced — timestamps will be zero");
  }

  /* Step 2: init BLE GATT server */
  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(64);
  BLEDevice::setPower(ESP_PWR_LVL_P9);

  g_server = BLEDevice::createServer();
  g_server->setCallbacks(new ServerCB());

  BLEService *svc = g_server->createService(SERVICE_UUID);

  /* TS NOTIFY characteristic.
   * Do NOT manually add a BLE2902 descriptor — NimBLE auto-creates one for
   * NOTIFY-capable characteristics; adding our own results in a duplicate
   * CCCD and the manual callback never fires.                              */
  g_tsChar = svc->createCharacteristic(
      CHAR_TS_UUID,
      BLECharacteristic::PROPERTY_NOTIFY);

  /* INTERVAL WRITE characteristic */
  g_intvChar = svc->createCharacteristic(
      CHAR_INTV_UUID,
      BLECharacteristic::PROPERTY_WRITE);
  g_intvChar->setCallbacks(new IntvCB());

  svc->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  BLEAdvertisementData advData;
  advData.setFlags(ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);
  advData.setName(DEVICE_NAME);

  BLEAdvertisementData scanRspData;
  scanRspData.setCompleteServices(BLEUUID(SERVICE_UUID));

  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanRspData);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising as \"" DEVICE_NAME "\"");
  Serial.printf("[BLE] MAC %s\n", BLEDevice::getAddress().toString().c_str());
  g_lastSendMs = millis();
}

void loop(void) {
  uint32_t now = millis();

  if (!g_connected || !g_notifyEn) {
    delay(100);
    return;
  }

  if (now - g_lastSendMs >= g_sendInterval) {
    g_lastSendMs = now;

    if (!g_ntpSynced) {
      Serial.println("[WARN] Skipping — NTP not synced");
      return;
    }

    uint64_t ts = currentMs();

    /* Pack little-endian into 8 bytes */
    uint8_t buf[8];
    for (int i = 0; i < 8; i++) {
      buf[i] = (uint8_t)((ts >> (i * 8)) & 0xFF);
    }

    g_tsChar->setValue(buf, sizeof(buf));
    g_tsChar->notify();
    g_packetsSent++;

    Serial.printf("[BLE TX] #%lu  ts_ms=%llu\n",
                  (unsigned long)g_packetsSent,
                  (unsigned long long)ts);
  }
}
