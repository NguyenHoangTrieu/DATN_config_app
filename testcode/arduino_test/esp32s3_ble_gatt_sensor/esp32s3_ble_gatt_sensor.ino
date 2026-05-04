/**
 * esp32s3_ble_gatt_sensor.ino
 *
 * Target  : ESP32-S3 (Arduino ESP32 core >= 3.x)
 * Role    : BLE GATT Peripheral — Simulated Temperature & Humidity Sensor
 *           Designed for DA2 Gateway BLE GATT Central test
 *
 * ─── Service: 0xAA10 "DA2 Sensor Service" ──────────────────────────────
 *  AA11  READ | NOTIFY  → 4 bytes: temp_i16LE + hum_i16LE (unit: 0.01)
 *  AA12  READ | WRITE   → 1 byte: notify interval in seconds (default 3)
 *
 * ─── Simulated Sensor Data ────────────────────────────────────────────
 *  Temperature: 20.0–35.0°C, sinusoidal with random noise
 *  Humidity:    40.0–80.0%, sinusoidal with random noise (phase offset)
 *
 * ─── Identification ──────────────────────────────────────────────────
 *  Device name contains "DA2_SENSOR_" prefix
 *  Service UUID 0xAA10 distinguishes from LED devices (0xFFF0)
 *
 * IMPORTANT: Change DEVICE_INDEX (1, 2, or 3) for each physical device
 *            to get unique names: DA2_SENSOR_1, DA2_SENSOR_2, DA2_SENSOR_3
 */

// ─── CHANGE THIS for each device (1, 2, or 3) ────────────────────────
#define DEVICE_INDEX    4

// ─── Pin / Timing ─────────────────────────────────────────────────────

#define DEFAULT_NOTIFY_INTERVAL 5   // seconds

// ─── BLE identifiers ─────────────────────────────────────────────────
#define SERVICE_UUID    ((uint16_t)0xAA10)
#define CHAR_DATA_UUID  "0000AA11-0000-1000-8000-00805F9B34FB"  // READ | NOTIFY
#define CHAR_CFG_UUID   "0000AA12-0000-1000-8000-00805F9B34FB"  // READ | WRITE

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ─── Build device name from index ─────────────────────────────────────
static char deviceName[20];

// ─── Globals ──────────────────────────────────────────────────────────
BLEServer         *pServer    = nullptr;
BLECharacteristic *pCharData  = nullptr;
BLECharacteristic *pCharCfg   = nullptr;

bool     deviceConnected = false;
bool     oldConnected    = false;
uint32_t lastNotify      = 0;
uint8_t  notifyInterval  = DEFAULT_NOTIFY_INTERVAL;  // seconds

// Simulation state
float simTime = 0.0f;

// ─── Simulated sensor data ────────────────────────────────────────────
struct SensorData {
  int16_t temp;  // 0.01°C units
  int16_t hum;   // 0.01% units
};

SensorData generateSensorData() {
  SensorData d;
  simTime += 0.1f;

  // Temperature: 20–35°C sinusoidal + noise
  float baseTemp = 27.5f + 7.5f * sin(simTime * 0.05f);
  float noise = ((float)random(-100, 100)) / 100.0f;  // ±1.0°C
  float temp = baseTemp + noise;
  temp = constrain(temp, 15.0f, 45.0f);
  d.temp = (int16_t)(temp * 100.0f);

  // Humidity: 40–80% sinusoidal (phase offset) + noise
  float baseHum = 60.0f + 20.0f * sin(simTime * 0.03f + 1.5f);
  float humNoise = ((float)random(-200, 200)) / 100.0f;  // ±2.0%
  float hum = baseHum + humNoise;
  hum = constrain(hum, 20.0f, 99.0f);
  d.hum = (int16_t)(hum * 100.0f);

  return d;
}

// ─── BLE Callbacks ────────────────────────────────────────────────────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pSrv) override {
    deviceConnected = true;
    Serial.println("[BLE] Central connected");
  }
  void onDisconnect(BLEServer *pSrv) override {
    deviceConnected = false;
    Serial.println("[BLE] Central disconnected — restarting advertising...");
    BLEDevice::startAdvertising();
  }
};

class CfgWriteCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    uint8_t *data = pChar->getData();
    size_t len = pChar->getLength();
    if (data && len >= 1) {
      uint8_t newInterval = data[0];
      if (newInterval >= 1 && newInterval <= 60) {
        notifyInterval = newInterval;
        Serial.printf("[CFG] Notify interval changed to %u seconds\n", notifyInterval);
      } else {
        Serial.printf("[CFG] Invalid interval %u (must be 1–60)\n", newInterval);
      }
    }
  }
};

// ─── Setup ────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(3000);  // ESP32-S3 Native USB needs time

  // Build device name
  snprintf(deviceName, sizeof(deviceName), "DA2_SENSOR_%d", DEVICE_INDEX);

  Serial.printf("\n=== %s — BLE GATT Sensor ===\n", deviceName);
  Serial.printf("  Service : 0x%04X\n", SERVICE_UUID);
  Serial.printf("  AA11    : Temp+Hum NOTIFY every %ds\n", notifyInterval);
  Serial.printf("  AA12    : Config (write interval)\n\n");

  // Seed random
  randomSeed(analogRead(0) ^ micros());

  // BLE Init
  BLEDevice::init(deviceName);
  BLEDevice::setPower(ESP_PWR_LVL_P9);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(BLEUUID(SERVICE_UUID));

  // AA11 — Sensor Data (READ | NOTIFY)
  pCharData = pService->createCharacteristic(
      BLEUUID(CHAR_DATA_UUID),
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  pCharData->addDescriptor(new BLE2902());
  uint8_t initData[4] = {0, 0, 0, 0};
  pCharData->setValue(initData, sizeof(initData));

  // AA12 — Config (READ | WRITE)
  pCharCfg = pService->createCharacteristic(
      BLEUUID(CHAR_CFG_UUID),
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
  pCharCfg->setCallbacks(new CfgWriteCallback());
  pCharCfg->setValue(&notifyInterval, 1);

  pService->start();

  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(BLEUUID(SERVICE_UUID));
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  pAdv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising started — waiting for DA2 Gateway...");
}

// ─── Loop ─────────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  // Periodic sensor data notification
  if (deviceConnected && (now - lastNotify >= (uint32_t)notifyInterval * 1000)) {
    lastNotify = now;

    SensorData d = generateSensorData();

    // Pack as 4 bytes: temp_i16LE + hum_i16LE
    uint8_t buf[4];
    buf[0] = (uint8_t)(d.temp & 0xFF);
    buf[1] = (uint8_t)((d.temp >> 8) & 0xFF);
    buf[2] = (uint8_t)(d.hum & 0xFF);
    buf[3] = (uint8_t)((d.hum >> 8) & 0xFF);

    pCharData->setValue(buf, sizeof(buf));
    pCharData->notify();

    float tempF = d.temp / 100.0f;
    float humF = d.hum / 100.0f;
    Serial.printf("[SENSOR] Temp=%.2f°C  Hum=%.2f%%  (raw: %04X %04X)\n",
                  tempF, humF, (uint16_t)d.temp, (uint16_t)d.hum);

  }

  // Reconnect advertising after disconnect
  if (!deviceConnected && oldConnected) {
    delay(500);
    BLEDevice::startAdvertising();
    Serial.println("[BLE] Advertising restarted");
    oldConnected = false;
  }
  if (deviceConnected && !oldConnected) {
    oldConnected = true;
  }

  delay(10);
}
