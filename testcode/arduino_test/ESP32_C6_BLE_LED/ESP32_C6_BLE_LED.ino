/**
 * ESP32-C6 Mini — BLE RGB LED Controller
 *
 * Compatible with STM32WB55 AT Command Module (CFBL: gateway protocol).
 *
 * Hardware:
 *   - On-board WS2812B RGB LED on GPIO8  (ESP32-C6-DevKitM-1/DevKitC-1)
 *   - If your board has a plain LED instead, change RGB_TYPE to RGB_TYPE_GPIO
 *     and set RGB_PIN to the correct GPIO number.
 *
 * BLE Protocol:
 *   Service UUID : 0000FFE0-0000-1000-8000-00805F9B34FB
 *   Char UUID    : 0000FFE1-0000-1000-8000-00805F9B34FB
 *   Properties   : READ | WRITE | WRITE_NR | NOTIFY
 *
 * Write formats accepted:
 *   1 byte  [P]         — P: 0x00=OFF, 0x01=ON  (backward-compatible)
 *   4 bytes [P, R, G, B]— P: 0x00/0x01, RGB: 0x00–0xFF each
 *
 * Examples (via AT+WRITE=0,<handle>,<hex>):
 *   01FF0000  → ON,  Red
 *   0100FF00  → ON,  Green
 *   010000FF  → ON,  Blue
 *   01FFFFFF  → ON,  White
 *   01FF8000  → ON,  Orange
 *   0180008B  → ON,  Purple
 *   00000000  → OFF
 *
 * Requires: Adafruit NeoPixel library
 *   (Sketch → Include Library → Manage Libraries → search "Adafruit NeoPixel")
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Adafruit_NeoPixel.h>

/* =====================================================================
   Hardware Configuration — adjust for your board variant
   ===================================================================== */
#define RGB_PIN        8      // WS2812B data pin (GPIO8 on DevKitM-1)
#define RGB_COUNT      1      // Number of pixels (1 on-board LED)
#define RGB_BRIGHTNESS 40     // 0–255; keep low (≤50) for USB-powered use

/* =====================================================================
   BLE Configuration
   ===================================================================== */
#define SERVICE_UUID   "0000ffe0-0000-1000-8000-00805f9b34fb"
#define CHAR_RGB_UUID  "0000ffe1-0000-1000-8000-00805f9b34fb"
#define DEVICE_NAME    "ESP32C6_RGB"

/* =====================================================================
   Global State
   ===================================================================== */
Adafruit_NeoPixel strip(RGB_COUNT, RGB_PIN, NEO_GRB + NEO_KHZ800);

BLEServer         *pServer  = nullptr;
BLECharacteristic *pCharRGB = nullptr;
bool  deviceConnected    = false;
bool  oldDeviceConnected = false;

struct RGBState {
  bool    power;
  uint8_t r, g, b;
} ledState = { false, 255, 128, 0 };  // default: orange (shown on first ON)

/* =====================================================================
   LED Update Helper
   ===================================================================== */
static void applyLED() {
  if (ledState.power) {
    strip.setPixelColor(0, strip.Color(ledState.r, ledState.g, ledState.b));
  } else {
    strip.setPixelColor(0, 0);
  }
  strip.show();
}

/* =====================================================================
   BLE Server Callbacks
   ===================================================================== */
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *srv) {
    deviceConnected = true;
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(BLEServer *srv) {
    deviceConnected = false;
    Serial.println("[BLE] Client disconnected — restarting advertising");
  }
};

/* =====================================================================
   RGB Characteristic Callbacks
   ===================================================================== */
class RGBCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    std::string data = pChar->getValue();
    if (data.length() == 0) return;

    if (data.length() == 1) {
      // Backward-compatible: single byte = power toggle
      ledState.power = (data[0] != 0);
      Serial.printf("[RGB] 1-byte write  → power=%s\n",
                    ledState.power ? "ON" : "OFF");
    } else if (data.length() >= 4) {
      // Full format: [P, R, G, B]
      ledState.power = (data[0] != 0);
      ledState.r     = (uint8_t)data[1];
      ledState.g     = (uint8_t)data[2];
      ledState.b     = (uint8_t)data[3];
      Serial.printf("[RGB] 4-byte write  → power=%s  R=%-3u G=%-3u B=%-3u  (#%02X%02X%02X)\n",
                    ledState.power ? "ON" : "OFF",
                    ledState.r, ledState.g, ledState.b,
                    ledState.r, ledState.g, ledState.b);
    } else {
      Serial.printf("[RGB] Unexpected write length %u — ignored\n",
                    (unsigned)data.length());
      return;
    }

    applyLED();

    // Notify current state back to central
    uint8_t notif[4] = {
      ledState.power ? (uint8_t)1 : (uint8_t)0,
      ledState.r, ledState.g, ledState.b
    };
    pChar->setValue(notif, 4);
    pChar->notify();
  }

  void onRead(BLECharacteristic *pChar) {
    uint8_t cur[4] = {
      ledState.power ? (uint8_t)1 : (uint8_t)0,
      ledState.r, ledState.g, ledState.b
    };
    pChar->setValue(cur, 4);
    Serial.printf("[RGB] Read  → power=%s  R=%u G=%u B=%u\n",
                  ledState.power ? "ON" : "OFF",
                  ledState.r, ledState.g, ledState.b);
  }
};

/* =====================================================================
   setup()
   ===================================================================== */
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n================================================");
  Serial.println("  ESP32-C6 Mini — BLE RGB LED Controller       ");
  Serial.println("  Compatible with STM32WB55 AT Command Module  ");
  Serial.println("================================================\n");

  // ── LED init ──────────────────────────────────────────────────────
  strip.begin();
  strip.setBrightness(RGB_BRIGHTNESS);
  strip.clear();
  strip.show();
  Serial.printf("[LED] NeoPixel init on GPIO%d, %d pixel(s), brightness=%d\n",
                RGB_PIN, RGB_COUNT, RGB_BRIGHTNESS);

  // Brief white flash to confirm LED is wired correctly
  strip.setPixelColor(0, strip.Color(80, 80, 80));
  strip.show();
  delay(400);
  strip.clear();
  strip.show();

  // ── BLE init ──────────────────────────────────────────────────────
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharRGB = pService->createCharacteristic(
    CHAR_RGB_UUID,
    BLECharacteristic::PROPERTY_READ    |
    BLECharacteristic::PROPERTY_WRITE   |
    BLECharacteristic::PROPERTY_WRITE_NR |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharRGB->setCallbacks(new RGBCallbacks());
  pCharRGB->addDescriptor(new BLE2902());

  // Initial value: all-zero (OFF)
  uint8_t initVal[4] = {0, 0, 0, 0};
  pCharRGB->setValue(initVal, 4);

  pService->start();

  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);   // 7.5 ms
  pAdv->setMaxPreferred(0x12);   // 22.5 ms
  BLEDevice::startAdvertising();

  // ── Print GATT handle map (critical for AT+WRITE) ─────────────────
  Serial.println("[BLE] Advertising started as: " DEVICE_NAME);
  Serial.println("\n╔══════════════════════════════════════════════╗");
  Serial.println("║         GATT Handle Reference                ║");
  Serial.println("╠══════════════════════════════════════════════╣");
  Serial.printf( "║  Service UUID : %-28s║\n", SERVICE_UUID);
  Serial.printf( "║  Char UUID    : %-28s║\n", CHAR_RGB_UUID);
  Serial.printf( "║  Char handle  : 0x%04X  (decimal: %-5u)     ║\n",
                 pCharRGB->getHandle(), pCharRGB->getHandle());
  Serial.printf( "║  CCCD handle  : 0x%04X  (decimal: %-5u)     ║\n",
                 pCharRGB->getHandle() + 1, pCharRGB->getHandle() + 1);
  Serial.println("╚══════════════════════════════════════════════╝");

  Serial.println("\n── AT command examples (replace <handle> with decimal above) ──");
  Serial.printf("[CMD] AT+SCAN=5000\n");
  Serial.printf("[CMD] AT+CONNECT=<MAC_OF_THIS_DEVICE>\n");
  Serial.printf("[CMD] AT+DISC=0\n");
  Serial.printf("[CMD] AT+CHARS=0,1,65535\n");
  Serial.printf("[CMD] AT+WRITE=0,%u,01FF0000   → ON,  Red\n",   pCharRGB->getHandle());
  Serial.printf("[CMD] AT+WRITE=0,%u,0100FF00   → ON,  Green\n", pCharRGB->getHandle());
  Serial.printf("[CMD] AT+WRITE=0,%u,010000FF   → ON,  Blue\n",  pCharRGB->getHandle());
  Serial.printf("[CMD] AT+WRITE=0,%u,01FFFFFF   → ON,  White\n", pCharRGB->getHandle());
  Serial.printf("[CMD] AT+WRITE=0,%u,00000000   → OFF\n",        pCharRGB->getHandle());
  Serial.printf("[CMD] AT+NOTIFY=0,%u,1         → Enable notify\n", pCharRGB->getHandle() + 1);
  Serial.println("\n[READY] Waiting for connection...");

  // ── CFBL: ThingsBoard RPC examples ────────────────────────────────
  Serial.println("\n── ThingsBoard CFBL: RPC examples ──");
  Serial.printf("[RPC] CFBL:0:AT+SCAN=5000\n");
  Serial.printf("[RPC] CFBL:0:AT+CONNECT=<MAC>\n");
  Serial.printf("[RPC] CFBL:0:AT+DISC=0\n");
  Serial.printf("[RPC] CFBL:0:AT+CHARS=0,1,65535\n");
  Serial.printf("[RPC] CFBL:0:AT+WRITE=0,%u,01FF0000   → ON, Red\n",    pCharRGB->getHandle());
  Serial.printf("[RPC] CFBL:0:AT+WRITE=0,%u,0100FF00   → ON, Green\n",  pCharRGB->getHandle());
  Serial.printf("[RPC] CFBL:0:AT+WRITE=0,%u,01FFFFFF   → ON, White\n",  pCharRGB->getHandle());
  Serial.printf("[RPC] CFBL:0:AT+WRITE=0,%u,00000000   → OFF\n\n",      pCharRGB->getHandle());
}

/* =====================================================================
   loop()
   ===================================================================== */
void loop() {
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = true;
    // Brief blue flash on connect
    strip.setPixelColor(0, strip.Color(0, 0, 60));
    strip.show();
    delay(200);
    applyLED();   // restore previous state
  }

  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    oldDeviceConnected = false;
    // Brief red flash on disconnect
    strip.setPixelColor(0, strip.Color(60, 0, 0));
    strip.show();
    delay(200);
    strip.clear();
    strip.show();
    Serial.println("[BLE] Advertising restarted");
  }

  delay(20);
}
