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
#include <BLE2902.h>
#include <WiFi.h>
#include "time.h"

/* ---- WiFi / NTP ---------------------------------------------------- */
#define WIFI_SSID        "Devil"
#define WIFI_PASS        "hamhap7604"
#define NTP_SERVER1      "pool.ntp.org"
#define NTP_SERVER2      "time.google.com"
#define NTP_GMT_OFFSET   0
#define NTP_DAYLIGHT     0
#define WIFI_TIMEOUT_MS  15000UL

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
  g_ntpBaseMs = (uint64_t)now_sec * 1000ULL;
  g_ntpMillis = millis();
  g_ntpSynced = true;
  Serial.printf("\n[NTP] Synced — epoch_ms=%llu  millis=%lu\n",
                (unsigned long long)g_ntpBaseMs, (unsigned long)g_ntpMillis);

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
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
    g_connected = false;   /* wait for CCCD write before sending */
    neopixelWrite(RGB_BUILTIN, 0, 24, 0);
    Serial.println("[BLE] Central connected");
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

/* Track CCCD enables (client subscribes to NOTIFY) */
class TsCccdCB : public BLEDescriptorCallbacks {
  void onWrite(BLEDescriptor *d) override {
    uint8_t *v = d->getValue();
    if (v && d->getLength() >= 2) {
      bool en = (v[0] & 0x01) != 0;
      g_notifyEn  = en;
      g_connected = en;
      Serial.printf("[BLE] NOTIFY %s\n", en ? "ENABLED" : "DISABLED");
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

  g_server = BLEDevice::createServer();
  g_server->setCallbacks(new ServerCB());

  BLEService *svc = g_server->createService(SERVICE_UUID);

  /* TS NOTIFY characteristic */
  g_tsChar = svc->createCharacteristic(
      CHAR_TS_UUID,
      BLECharacteristic::PROPERTY_NOTIFY);
  BLE2902 *cccd = new BLE2902();
  cccd->setCallbacks(new TsCccdCB());
  g_tsChar->addDescriptor(cccd);

  /* INTERVAL WRITE characteristic */
  g_intvChar = svc->createCharacteristic(
      CHAR_INTV_UUID,
      BLECharacteristic::PROPERTY_WRITE);
  g_intvChar->setCallbacks(new IntvCB());

  svc->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising as \"" DEVICE_NAME "\"");
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
