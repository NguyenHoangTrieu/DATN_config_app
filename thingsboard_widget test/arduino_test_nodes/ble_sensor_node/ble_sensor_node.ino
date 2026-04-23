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
volatile uint32_t g_intervalMs     = DEFAULT_INTERVAL_MS;
uint32_t          g_lastNotifyMs   = 0;
bool              g_oldConnected   = false;

/* ── BLE Callbacks ────────────────────────────────────── */
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* srv) override {
    g_clientConnected = true;
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(BLEServer* srv) override {
    g_clientConnected = false;
    Serial.println("[BLE] Client disconnected — restarting advertising");
    BLEDevice::startAdvertising();
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
  delay(3000);  /* ESP32-S3 native USB often needs a short bring-up delay */
  Serial.println("[DA2] BLE Sensor Node booting…");

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  g_server = BLEDevice::createServer();
  g_server->setCallbacks(new ServerCallbacks());

  BLEService* svc = g_server->createService(BLEUUID((uint16_t)0xAA10));

  /* AA11 — DATA (READ + NOTIFY) */
  g_dataChar = svc->createCharacteristic(
    CHAR_DATA_UUID,
    BLECharacteristic::PROPERTY_READ  |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  g_dataChar->addDescriptor(new BLE2902());   /* CCCD at handle+1 */
  {
    uint8_t initPayload[4] = {0, 0, 0, 0};
    g_dataChar->setValue(initPayload, sizeof(initPayload));
  }

  /* AA12 — CTRL (WRITE) */
  g_ctrlChar = svc->createCharacteristic(
    CHAR_CTRL_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  g_ctrlChar->setCallbacks(new CtrlCharCallbacks());
  {
    uint8_t intervalLe[2];
    intervalLe[0] = (uint8_t)(g_intervalMs & 0xFF);
    intervalLe[1] = (uint8_t)((g_intervalMs >> 8) & 0xFF);
    g_ctrlChar->setValue(intervalLe, sizeof(intervalLe));
  }

  svc->start();

  /* Advertising */
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLEUUID((uint16_t)0xAA10));
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising as " DEVICE_NAME);
}

/* ── Loop ─────────────────────────────────────────────── */
void loop() {
  uint32_t now = millis();

  if (g_clientConnected && (now - g_lastNotifyMs >= g_intervalMs)) {
    g_lastNotifyMs = now;

    int16_t  tRaw = simulateTemp();
    uint16_t hRaw = simulateHum();

    /* Pack 4 bytes: [tLo tHi hLo hHi] little-endian */
    uint8_t payload[4];
    payload[0] = (uint8_t)(tRaw & 0xFF);
    payload[1] = (uint8_t)((tRaw >> 8) & 0xFF);
    payload[2] = (uint8_t)(hRaw & 0xFF);
    payload[3] = (uint8_t)((hRaw >> 8) & 0xFF);

    g_dataChar->setValue(payload, sizeof(payload));
    g_dataChar->notify();

    Serial.printf("[BLE] NOTIFY T=%.2f°C H=%.2f%% interval=%lums\n",
                  tRaw * 0.01f, hRaw * 0.01f, (unsigned long)g_intervalMs);
  }

  if (!g_clientConnected && g_oldConnected) {
    delay(500);
    BLEDevice::startAdvertising();
    Serial.println("[BLE] Advertising restarted");
    g_oldConnected = false;
  }

  if (g_clientConnected && !g_oldConnected) {
    g_oldConnected = true;
  }

  if (!g_clientConnected && (now - g_lastNotifyMs >= 1000)) {
    if (now - g_lastNotifyMs >= g_intervalMs) {
      int16_t  tRaw = simulateTemp();
      uint16_t hRaw = simulateHum();

      /* Keep READ value fresh even when no central is connected yet. */
      uint8_t payload[4];
      payload[0] = (uint8_t)(tRaw & 0xFF);
      payload[1] = (uint8_t)((tRaw >> 8) & 0xFF);
      payload[2] = (uint8_t)(hRaw & 0xFF);
      payload[3] = (uint8_t)((hRaw >> 8) & 0xFF);
      g_dataChar->setValue(payload, sizeof(payload));
      g_lastNotifyMs = now;
    }
  }

  delay(10);
}
