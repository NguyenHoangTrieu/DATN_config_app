/**
 *
 * Target  : ESP32-S3 (Arduino ESP32 core >= 3.x)
 *           Also compatible: ESP32, ESP32-S3 (select correct board in Arduino IDE)
 * Role    : BLE GATT Peripheral (server / advertiser)
 *           Designed to be scanned, connected and controlled by the
 *           DA2 Gateway's GATT Central (AT+CONNECT / AT+WRITE commands).
 *
 * ─── Service: 0xFFF0 "DA2 Test Service" ──────────────────────────────────────
 *  FFF1  READ | NOTIFY → 4-byte uint32 LE counter, every 2 s
 *                        Echo channel for ON/OFF and color replies
 *  FFF2  READ | WRITE | NOTIFY → LED / RGB control
 *                         1 byte  : 0x00 = OFF  |  non-zero = ON
 *                         3 bytes : R G B
 *
 * ─── Hardware ─────────────────────────────────────────────────────────────────
 *  GPIO 8     – onboard blue LED  (ESP32-C6 DevKit, active HIGH)
 *  RGB_BUILTIN – built-in WS2812 RGB LED (auto-defined by Arduino core)
 *
 * ─── Key patterns from esp32_ble_gatt_test_widget.ino ─────────────────────────
 *  - getData()/getLength() pointer API (core 3.x safe, no std::string)
 *  - volatile pending flags — notify() runs in loop(), NOT in BLE callback
 *  - Loop polls core data as fallback if onWrite is missed by BLE stack
 *  - neopixelWrite() built-in (no Adafruit library needed)
 *
 * ─── GATT handle map (typical — may shift ±1 after service creation) ──────────
 *  FFF0 Service           : 0x0008
 *  FFF1 Characteristic    : 0x0009  ← counter / echo (notify)
 *  FFF1 CCCD descriptor   : 0x000A  ← write 0x0100 to enable notify
 *  FFF2 Characteristic    : 0x000B  ← value handle
 *  FFF2 CCCD descriptor   : 0x000C  ← write 0x0100 to enable notify
 *
 *  ► Run AT+DISC=<idx> via widget to auto-detect actual handles.
 */

// ─── Pin / timing ─────────────────────────────────────────────────────────────
#define LED_GPIO        38       // Onboard LED (active HIGH). ESP32-C6: 8, ESP32: 2
#ifndef RGB_BUILTIN
  #define RGB_BUILTIN   8
#endif
#define NOTIFY_INTERVAL 2000    // ms between FFF1 counter notifications

// ─── BLE identifiers ──────────────────────────────────────────────────────────
#define DEVICE_NAME     "DA2_LED_GATT_4"
#define SERVICE_UUID    ((uint16_t)0xFFF0)
#define CHAR_FFF1_UUID  "0000FFF1-0000-1000-8000-00805F9B34FB"  // READ | NOTIFY
#define CHAR_FFF2_UUID  "0000FFF2-0000-1000-8000-00805F9B34FB"  // READ | WRITE | NOTIFY

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ─── Globals ──────────────────────────────────────────────────────────────────
BLEServer         *pServer   = nullptr;
BLECharacteristic *pCharFFF1 = nullptr;
BLECharacteristic *pCharFFF2 = nullptr;

bool     deviceConnected = false;
bool     oldConnected    = false;
uint32_t counter         = 0;
uint32_t lastNotify      = 0;

// Current LED state
bool    ledOn = false;
uint8_t ledR  = 0, ledG = 0, ledB = 0;

// Pending notify flags — set in onWrite(), consumed safely in loop()
volatile bool    pendingLedNotify   = false;
volatile uint8_t pendingLedVal      = 0;
volatile bool    pendingColorNotify = false;
volatile uint8_t pendingR = 0, pendingG = 0, pendingB = 0;

// ─── LED helpers ──────────────────────────────────────────────────────────────
void applyLedOff() {
  ledOn = false;
  digitalWrite(LED_GPIO, LOW);
  neopixelWrite(RGB_BUILTIN, 0, 0, 0);
  Serial.println("[LED] OFF");
}

void applyLedOn() {
  ledOn = true;
  digitalWrite(LED_GPIO, HIGH);
  // Restore last color or default green
  uint8_t r = ledR ? ledR : 0;
  uint8_t g = ledG ? ledG : 255;
  uint8_t b = ledB ? ledB : 0;
  neopixelWrite(RGB_BUILTIN, r, g, b);
  Serial.println("[LED] ON");
}

void applyColor(uint8_t r, uint8_t g, uint8_t b) {
  ledR = r; ledG = g; ledB = b;
  ledOn = (r || g || b);
  digitalWrite(LED_GPIO, (ledOn && (r > 64 || g > 64 || b > 64)) ? HIGH : LOW);
  neopixelWrite(RGB_BUILTIN, r, g, b);
  Serial.printf("[COLOR] R=%u G=%u B=%u  #%02X%02X%02X\n", r, g, b, r, g, b);
}

// ─── BLE Callbacks ────────────────────────────────────────────────────────────
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

class WriteCallbacksFFF2 : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    Serial.println("\n[FFF2] ---- WRITE FROM GATEWAY ----");

    // getData()/getLength() — pointer-based API, safe across ESP32 core versions
    uint8_t *txData = pChar->getData();
    size_t   len    = pChar->getLength();

    Serial.printf("[FFF2] Received %u byte(s)\n", (unsigned)len);

    if (txData == nullptr || len == 0) {
      Serial.println("[FFF2 ERROR] Null or empty payload — ignored");
      return;
    }

    // Print raw HEX
    Serial.print("[FFF2] Raw HEX: ");
    for (size_t i = 0; i < len; i++) Serial.printf("%02X ", txData[i]);
    Serial.println();

    if (len == 1) {
      /* ── 1-byte: ON / OFF ─────────────────────────────────────────────── */
      uint8_t val = txData[0];
      Serial.printf("[FFF2 WRITE] CMD = 0x%02X (%s)\n", val, val ? "ON" : "OFF");
      if (val != 0) {
        applyLedOn();
      } else {
        applyLedOff();
      }
      // Schedule echo notify from loop()
      if (deviceConnected) {
        pendingLedVal    = val;
        pendingLedNotify = true;
        Serial.println("[FFF2] Pending LED echo notify set");
      }

    } else if (len >= 3) {
      /* ── 3-byte: RGB color ────────────────────────────────────────────── */
      uint8_t r = txData[0], g = txData[1], b = txData[2];
      applyColor(r, g, b);
      if (deviceConnected) {
        pendingR = r; pendingG = g; pendingB = b;
        pendingColorNotify = true;
        Serial.println("[FFF2] Pending color echo notify set");
      }

    } else {
      Serial.printf("[FFF2] Unexpected length %u — ignored\n", (unsigned)len);
    }

    Serial.println("[FFF2] ---- END WRITE ----\n");
  }

  void onRead(BLECharacteristic *pChar) override {
    Serial.println("[READ] FFF2 read by central");
  }
};

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(LED_GPIO, OUTPUT);
  digitalWrite(LED_GPIO, LOW);
  neopixelWrite(RGB_BUILTIN, 0, 0, 0);

  Serial.println("\n=== DA2 GATT Peripheral (ESP32-C6) ===");
  Serial.printf("  Device  : %s\n",  DEVICE_NAME);
  Serial.printf("  GPIO LED: %d\n",  LED_GPIO);
  Serial.printf("  FFF1    : counter + echo, notify every %d ms\n", NOTIFY_INTERVAL);
  Serial.println("  FFF2    : 1-byte ON/OFF | 3-byte RGB\n");
  Serial.println("  Echo protocol:");
  Serial.println("    LED ON/OFF  → FFF1 notify [0xAA, val]");
  Serial.println("    RGB color   → FFF1 notify [0xCC, R, G, B]\n");

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_P9);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  // Service
  BLEService *pService = pServer->createService(BLEUUID(SERVICE_UUID));

  // FFF1 — READ | NOTIFY
  pCharFFF1 = pService->createCharacteristic(
      BLEUUID(CHAR_FFF1_UUID),
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  pCharFFF1->addDescriptor(new BLE2902());
  uint8_t initCtr[4] = {0, 0, 0, 0};
  pCharFFF1->setValue(initCtr, sizeof(initCtr));

  // FFF2 — READ | WRITE | NOTIFY
  pCharFFF2 = pService->createCharacteristic(
      BLEUUID(CHAR_FFF2_UUID),
      BLECharacteristic::PROPERTY_READ  |
      BLECharacteristic::PROPERTY_WRITE |
      BLECharacteristic::PROPERTY_NOTIFY);
  pCharFFF2->addDescriptor(new BLE2902());
  pCharFFF2->setCallbacks(new WriteCallbacksFFF2());
  uint8_t initLed[1] = {0};
  pCharFFF2->setValue(initLed, sizeof(initLed));

  pService->start();

  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(BLEUUID(SERVICE_UUID));
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  pAdv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising started — waiting for DA2 Gateway...");
}

// ─── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  // ── Consume pending LED echo notify (set by onWrite) ───────────────────────
  if (deviceConnected && pendingLedNotify) {
    pendingLedNotify = false;
    uint8_t resp[2] = { 0xAA, pendingLedVal };   // 0xAA = LED echo marker
    pCharFFF1->setValue(resp, sizeof(resp));
    pCharFFF1->notify();
    Serial.printf("[FFF1 NOTIFY] LED echo: 0xAA 0x%02X\n", pendingLedVal);
  }

  // ── Consume pending color echo notify ──────────────────────────────────────
  if (deviceConnected && pendingColorNotify) {
    pendingColorNotify = false;
    uint8_t buf[4] = { 0xCC, pendingR, pendingG, pendingB };
    pCharFFF1->setValue(buf, sizeof(buf));
    pCharFFF1->notify();
    Serial.printf("[FFF1 NOTIFY] Color echo: 0xCC %02X %02X %02X\n",
                  pendingR, pendingG, pendingB);
  }

  // ── Periodic counter notification ──────────────────────────────────────────
  if (deviceConnected && (now - lastNotify >= NOTIFY_INTERVAL)) {
    lastNotify = now;
    counter++;

    uint8_t buf[4];
    buf[0] = (uint8_t)(counter        & 0xFF);
    buf[1] = (uint8_t)((counter >> 8) & 0xFF);
    buf[2] = (uint8_t)((counter >>16) & 0xFF);
    buf[3] = (uint8_t)((counter >>24) & 0xFF);
    pCharFFF1->setValue(buf, sizeof(buf));
    pCharFFF1->notify();
    Serial.printf("[NOTIFY] Counter = %lu  (0x%08lX)\n",
                  (unsigned long)counter, (unsigned long)counter);

    // Brief LED blink for heartbeat (only when LED is off)
    if (!ledOn) {
      digitalWrite(LED_GPIO, HIGH);
      delay(20);
      digitalWrite(LED_GPIO, LOW);
    }
  }

  // ── Loop-level fallback: poll FFF2 for missed onWrite ──────────────────────
  // The BLE stack may deliver writes without triggering onWrite in some cases.
  // ONLY process 1-byte on/off commands, SKIP RGB (3 bytes) to avoid interfering with color echo.
  static uint8_t lastCoreVal = 0xFF;
  uint8_t *coreData = pCharFFF2->getData();
  size_t coreLenVal = pCharFFF2->getLength();
  if (coreData != nullptr && coreLenVal == 1) {  // ONLY 1-byte commands
    uint8_t coreVal = coreData[0];
    if (coreVal != lastCoreVal && lastCoreVal != 0xFF) {
      Serial.printf("\n[WARN] Loop detected FFF2 core value change: 0x%02X\n", coreVal);
      if (coreVal != 0) {
        applyLedOn();
      } else {
        applyLedOff();
      }
    }
    lastCoreVal = coreVal;
  } else if (coreLenVal >= 3) {
    // For RGB (3+ bytes), DON'T update lastCoreVal — only onWrite() should handle it
    // This prevents loop fallback from interfering with color echo.
  }

  // ── Advertising restart after disconnect ───────────────────────────────────
  if (!deviceConnected && oldConnected) {
    delay(500);
    BLEDevice::startAdvertising();
    Serial.println("[BLE] Advertising restarted");
    oldConnected = false;
  }
  if (deviceConnected && !oldConnected) {
    oldConnected = true;
  }

  delay(10);  // Prevent WDT on BLE RTOS background tasks
}
