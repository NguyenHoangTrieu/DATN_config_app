/**
 * esp32s3_ble_gatt_sensor.ino
 *
 * Target  : ESP32-S3 (Arduino ESP32 core >= 3.x)
 * Role    : BLE GATT Peripheral — Real AHT20 Temperature & Humidity Sensor
 *           Designed for DA2 Gateway BLE GATT Central test
 *
 * ─── Service: 0xAA10 "DA2 Sensor Service" ──────────────────────────────
 *  AA11  READ | NOTIFY  → 4 bytes: temp_i16LE + hum_i16LE (unit: 0.01)
 *  AA12  READ | WRITE   → 1 byte: notify interval in seconds (default 5)
 */

// ─── CHANGE THIS for each device ─────────────────────────────────────
#define DEVICE_INDEX    3

// ─── Pin / Timing ─────────────────────────────────────────────────────
#define I2C_SDA_PIN 3
#define I2C_SCL_PIN 4
#define I2C_FREQ_HZ 100000UL
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

#define DEFAULT_NOTIFY_INTERVAL 5

// ─── BLE identifiers ─────────────────────────────────────────────────
#define SERVICE_UUID    ((uint16_t)0xAA10)
#define CHAR_DATA_UUID  "0000AA11-0000-1000-8000-00805F9B34FB"
#define CHAR_CFG_UUID   "0000AA12-0000-1000-8000-00805F9B34FB"

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Wire.h>

static char deviceName[20];

BLEServer         *pServer    = nullptr;
BLECharacteristic *pCharData  = nullptr;
BLECharacteristic *pCharCfg   = nullptr;

bool     deviceConnected = false;
bool     oldConnected    = false;
uint32_t lastNotify      = 0;
uint8_t  notifyInterval  = DEFAULT_NOTIFY_INTERVAL;
bool     aht20Ready      = false;
uint32_t i2cRecoveryCount = 0;

struct SensorData {
  int16_t temp;
  int16_t hum;
};

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
  aht20Ready = false;
  Wire.flush();
  Wire.end();
  delay(AHT20_RECOVERY_DELAY_MS);

  bool ok = initAHT20();
  aht20Ready = ok;
  if (ok) {
    i2cRecoveryCount++;
    Serial.printf("[I2C] Recovery #%lu successful\n", (unsigned long)i2cRecoveryCount);
  } else {
    Serial.println("[I2C] Recovery failed");
  }
  return ok;
}

static bool readAHT20Once(float &tempC, float &humidRH) {
  if (!aht20Ready) return false;

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

static bool readSensorData(SensorData &data) {
  float tempC = 0.0f;
  float humidRH = 0.0f;
  if (!readAHT20(tempC, humidRH)) {
    return false;
  }

  data.temp = (int16_t)(tempC * 100.0f);
  data.hum = (int16_t)(humidRH * 100.0f);
  return true;
}

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

void setup() {
  Serial.begin(115200);
  delay(3000);

  snprintf(deviceName, sizeof(deviceName), "DA2_SENSOR_%d", DEVICE_INDEX);

  Serial.printf("\n=== %s — BLE GATT Sensor ===\n", deviceName);
  Serial.printf("  Service : 0x%04X\n", SERVICE_UUID);
  Serial.printf("  AA11    : Temp+Hum NOTIFY every %ds\n", notifyInterval);
  Serial.printf("  AA12    : Config (write interval)\n");
  Serial.printf("  I2C     : SDA=%d SCL=%d addr=0x%02X\n\n",
                I2C_SDA_PIN,
                I2C_SCL_PIN,
                AHT20_I2C_ADDR);

  aht20Ready = initAHT20();
  if (!aht20Ready) {
    Serial.println("[AHT20] init failed. Check SDA/SCL, pull-up resistors, sensor power, or wrong pins.");
  } else {
    Serial.println("[AHT20] sensor ready");
  }

  BLEDevice::init(deviceName);
  BLEDevice::setPower(ESP_PWR_LVL_P9);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(BLEUUID(SERVICE_UUID));

  pCharData = pService->createCharacteristic(
      BLEUUID(CHAR_DATA_UUID),
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  uint8_t initData[4] = {0, 0, 0, 0};
  pCharData->setValue(initData, sizeof(initData));

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

void loop() {
  uint32_t now = millis();

  if (deviceConnected && (now - lastNotify >= (uint32_t)notifyInterval * 1000U)) {
    lastNotify = now;

    SensorData sensorData;
    if (!readSensorData(sensorData)) {
      Serial.println("[AHT20] read failed, skip notify");
      return;
    }

    uint8_t buf[4];
    buf[0] = (uint8_t)(sensorData.temp & 0xFF);
    buf[1] = (uint8_t)((sensorData.temp >> 8) & 0xFF);
    buf[2] = (uint8_t)(sensorData.hum & 0xFF);
    buf[3] = (uint8_t)((sensorData.hum >> 8) & 0xFF);

    pCharData->setValue(buf, sizeof(buf));
    pCharData->notify();

    Serial.printf("[SENSOR] Temp=%.2f°C  Hum=%.2f%%  (raw: %04X %04X)\n",
                  sensorData.temp / 100.0f,
                  sensorData.hum / 100.0f,
                  (uint16_t)sensorData.temp,
                  (uint16_t)sensorData.hum);
  }

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
