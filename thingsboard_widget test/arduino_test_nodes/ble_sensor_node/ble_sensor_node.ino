/*
 * DA2 BLE Sensor Node — ESP32-S3
 * Target board : ESP32-S3 (Arduino IDE: "ESP32S3 Dev Module")
 * BLE Library  : ESP32 Arduino BLE (built-in ArduinoBLE or NimBLE-Arduino)
 *
 * Services / Characteristics:
 *   Service  0xAA10
 *     0xAA11  READ + NOTIFY   4 bytes: [temp_i16LE, hum_i16LE]
 *               temp_i16 = (Celsius * 100) as signed int16
 *               hum_i16  = (Percent * 100) as unsigned int16
 *     0xAA12  WRITE (no response)  2 bytes uint16 LE = notify interval (ms)
 *               min 100 ms, max 60000 ms
 *
 * Simulated sensor: sine-wave variation around base values
 *   Temp: 25.00 °C ± 2 °C (period ~60 s)
 *   Hum:  60.00 %  ± 5 %  (period ~45 s)
 *
 * Device name: "DA2_SENSOR_1"
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>   /* CCCD descriptor */
#include <math.h>

/* ── Configuration ────────────────────────────────────── */
#define DEVICE_NAME      "DA2_SENSOR_1"
#define SERVICE_UUID     "0000AA10-0000-1000-8000-00805F9B34FB"
#define CHAR_DATA_UUID   "0000AA11-0000-1000-8000-00805F9B34FB"
#define CHAR_CTRL_UUID   "0000AA12-0000-1000-8000-00805F9B34FB"

#define DEFAULT_INTERVAL_MS   1000u   /* default notify interval */
#define MIN_INTERVAL_MS        100u
#define MAX_INTERVAL_MS      60000u

/* ── Globals ──────────────────────────────────────────── */
BLEServer*         g_server    = nullptr;
BLECharacteristic* g_dataChar  = nullptr;   /* AA11 */
BLECharacteristic* g_ctrlChar  = nullptr;   /* AA12 */

volatile bool    g_clientConnected = false;
volatile bool    g_notifyEnabled   = false;
volatile uint32_t g_intervalMs     = DEFAULT_INTERVAL_MS;
uint32_t          g_lastNotifyMs   = 0;

/* ── BLE Callbacks ────────────────────────────────────── */
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* srv) override {
    g_clientConnected = true;
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(BLEServer* srv) override {
    g_clientConnected  = false;
    g_notifyEnabled    = false;
    Serial.println("[BLE] Client disconnected — restarting advertising");
    BLEDevice::startAdvertising();
  }
};

/* CCCD write callback — fires when central enables/disables NOTIFY */
class DataCharCallbacks : public BLECharacteristicCallbacks {
  void onDescriptorWrite(BLEDescriptor* desc) {
    uint8_t* val = desc->getValue();
    if (val && desc->getLength() >= 2) {
      g_notifyEnabled = (val[0] == 0x01);
      Serial.printf("[BLE] NOTIFY %s\n", g_notifyEnabled ? "enabled" : "disabled");
    }
  }
};

/* WRITE to AA12: set interval (uint16 LE, ms) */
class CtrlCharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* ch) override {
    uint8_t* v = ch->getData();
    size_t   l = ch->getLength();
    if (l >= 2) {
      uint16_t ms = (uint16_t)v[0] | ((uint16_t)v[1] << 8);  /* little-endian */
      if (ms < MIN_INTERVAL_MS) ms = MIN_INTERVAL_MS;
      if (ms > MAX_INTERVAL_MS) ms = MAX_INTERVAL_MS;
      g_intervalMs = ms;
      Serial.printf("[BLE] Interval set to %u ms\n", ms);
    }
  }
};

/* ── Simulated Sensor ─────────────────────────────────── */
/* Returns temperature (°C × 100 as int16) */
int16_t simulateTemp() {
  float t = millis() / 1000.0f;
  float deg = 25.0f + 2.0f * sinf(2.0f * M_PI * t / 60.0f);
  return (int16_t)(deg * 100.0f);
}

/* Returns humidity (% × 100 as uint16) */
uint16_t simulateHum() {
  float t = millis() / 1000.0f;
  float pct = 60.0f + 5.0f * sinf(2.0f * M_PI * t / 45.0f);
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  return (uint16_t)(pct * 100.0f);
}

/* ── Setup ────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  Serial.println("[DA2] BLE Sensor Node booting…");

  BLEDevice::init(DEVICE_NAME);
  g_server = BLEDevice::createServer();
  g_server->setCallbacks(new ServerCallbacks());

  BLEService* svc = g_server->createService(SERVICE_UUID);

  /* AA11 — DATA (READ + NOTIFY) */
  g_dataChar = svc->createCharacteristic(
    CHAR_DATA_UUID,
    BLECharacteristic::PROPERTY_READ  |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  g_dataChar->setCallbacks(new DataCharCallbacks());
  g_dataChar->addDescriptor(new BLE2902());   /* CCCD at handle+1 */

  /* AA12 — CTRL (WRITE) */
  g_ctrlChar = svc->createCharacteristic(
    CHAR_CTRL_UUID,
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  g_ctrlChar->setCallbacks(new CtrlCharCallbacks());

  svc->start();

  /* Advertising */
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising as " DEVICE_NAME);
}

/* ── Loop ─────────────────────────────────────────────── */
void loop() {
  uint32_t now = millis();

  if (g_clientConnected && g_notifyEnabled) {
    if (now - g_lastNotifyMs >= g_intervalMs) {
      g_lastNotifyMs = now;

      int16_t  tRaw = simulateTemp();
      uint16_t hRaw = simulateHum();

      /* Pack 4 bytes: [tHi tLo hHi hLo] little-endian */
      uint8_t payload[4];
      payload[0] = (uint8_t)(tRaw & 0xFF);
      payload[1] = (uint8_t)((tRaw >> 8) & 0xFF);
      payload[2] = (uint8_t)(hRaw & 0xFF);
      payload[3] = (uint8_t)((hRaw >> 8) & 0xFF);

      g_dataChar->setValue(payload, 4);
      g_dataChar->notify();

      Serial.printf("[BLE] NOTIFY T=%.2f°C H=%.2f%% interval=%ums\n",
                    tRaw * 0.01f, hRaw * 0.01f, g_intervalMs);
    }
  }

  /* Update READ value even without notify so central can READ on-demand */
  if (g_clientConnected && (now - g_lastNotifyMs < 100)) {
    /* already updated above — do nothing */
  }

  delay(10);
}
