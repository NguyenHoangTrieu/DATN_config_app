/**
 * esp32s3_ble_gatt_bandwidth.ino
 *
 * Target  : ESP32-S3 (Arduino ESP32 core >= 3.x)
 * Role    : BLE GATT Peripheral — Bandwidth Test Device
 *
 * ─── Service: 0xBB10 "DA2 Bandwidth Test" ────────────────────────
 *  BB11  WRITE_NR         → RX sink (receive data, count bytes)
 *  BB12  NOTIFY           → TX flood (send data continuously when active)
 *  BB13  READ | WRITE     → Control: 0x01=start TX, 0x00=stop TX
 *  BB14  READ | NOTIFY    → Status: total bytes RX (uint32 LE)
 *
 * ─── Hardware ─────────────────────────────────────────────────────
 *  RGB_BUILTIN (GPIO 48) — status LED
 *    Blue = idle, Green = connected, Red pulse = TX flood active
 *
 * ─── Protocol ─────────────────────────────────────────────────────
 *  1. Central connects, discovers BB11-BB14
 *  2. Central enables NOTIFY on BB12 and BB14
 *  3. Central writes BB13 = 0x01 → device starts TX flood via BB12
 *  4. Central writes BB11 continuously → device counts bytes for RX metric
 *  5. Central writes BB13 = 0x00 → device stops TX, sends BB14 status
 *  6. Central reads BB14 → total bytes received (verification)
 */

// ─── Hardware ─────────────────────────────────────────────────────
#ifndef RGB_BUILTIN
  #define RGB_BUILTIN   48
#endif

// ─── BLE ──────────────────────────────────────────────────────────
#define DEVICE_NAME       "DA2_BW_GATT"
#define SERVICE_UUID      ((uint16_t)0xBB10)
#define CHAR_RX_UUID      "0000BB11-0000-1000-8000-00805F9B34FB"  // WRITE_NR
#define CHAR_TX_UUID      "0000BB12-0000-1000-8000-00805F9B34FB"  // NOTIFY
#define CHAR_CTRL_UUID    "0000BB13-0000-1000-8000-00805F9B34FB"  // R/W
#define CHAR_STATUS_UUID  "0000BB14-0000-1000-8000-00805F9B34FB"  // R/N

#define TX_PACKET_SIZE  244   // max ATT payload with 247 MTU
#define TX_INTERVAL_MS  0     // as fast as possible

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ─── Globals ──────────────────────────────────────────────────────
BLEServer         *pServer     = nullptr;
BLECharacteristic *pCharRx     = nullptr;
BLECharacteristic *pCharTx     = nullptr;
BLECharacteristic *pCharCtrl   = nullptr;
BLECharacteristic *pCharStatus = nullptr;

bool     deviceConnected = false;
bool     oldConnected    = false;

volatile bool     txActive     = false;
volatile uint32_t bytesRx      = 0;
volatile uint32_t bytesTx      = 0;
volatile uint32_t packetsRx    = 0;
volatile uint32_t packetsTx    = 0;
uint32_t lastStatusNotify      = 0;

// TX flood buffer (filled with incrementing pattern)
uint8_t txBuf[TX_PACKET_SIZE];

// ─── BLE Callbacks ────────────────────────────────────────────────
class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override {
    deviceConnected = true;
    bytesRx = 0;
    bytesTx = 0;
    packetsRx = 0;
    packetsTx = 0;
    txActive = false;
    neopixelWrite(RGB_BUILTIN, 0, 30, 0);
    Serial.println("[BLE] Connected — counters reset");
  }
  void onDisconnect(BLEServer *s) override {
    deviceConnected = false;
    txActive = false;
    neopixelWrite(RGB_BUILTIN, 0, 0, 30);
    Serial.println("[BLE] Disconnected");
    BLEDevice::startAdvertising();
  }
};

// BB11 — RX Sink
class RxSinkCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    size_t len = pChar->getLength();
    bytesRx += len;
    packetsRx++;
    // No response needed (WRITE_NR)
  }
};

// BB13 — Control
class CtrlCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    uint8_t *data = pChar->getData();
    size_t len = pChar->getLength();
    if (data && len >= 1) {
      if (data[0] == 0x01) {
        txActive = true;
        bytesTx = 0;
        packetsTx = 0;
        Serial.println("[CTRL] TX flood STARTED");
      } else {
        txActive = false;
        Serial.printf("[CTRL] TX flood STOPPED — RX=%lu bytes, TX=%lu bytes\n",
                      (unsigned long)bytesRx, (unsigned long)bytesTx);
        // Update status characteristic
        updateStatus();
      }
    }
  }
};

void updateStatus() {
  uint8_t buf[8];
  // bytes RX (uint32 LE)
  buf[0] = (uint8_t)(bytesRx & 0xFF);
  buf[1] = (uint8_t)((bytesRx >> 8) & 0xFF);
  buf[2] = (uint8_t)((bytesRx >> 16) & 0xFF);
  buf[3] = (uint8_t)((bytesRx >> 24) & 0xFF);
  // bytes TX (uint32 LE)
  buf[4] = (uint8_t)(bytesTx & 0xFF);
  buf[5] = (uint8_t)((bytesTx >> 8) & 0xFF);
  buf[6] = (uint8_t)((bytesTx >> 16) & 0xFF);
  buf[7] = (uint8_t)((bytesTx >> 24) & 0xFF);

  pCharStatus->setValue(buf, sizeof(buf));
  if (deviceConnected) {
    pCharStatus->notify();
  }
}

// ─── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(3000);

  neopixelWrite(RGB_BUILTIN, 0, 0, 30);  // blue = idle

  // Fill TX buffer with pattern
  for (int i = 0; i < TX_PACKET_SIZE; i++) {
    txBuf[i] = (uint8_t)(i & 0xFF);
  }

  Serial.println("\n=== DA2_BW_GATT — Bandwidth Test Device ===");
  Serial.printf("  TX packet size: %d bytes\n", TX_PACKET_SIZE);
  Serial.printf("  BB11: RX sink (WRITE_NR)\n");
  Serial.printf("  BB12: TX flood (NOTIFY)\n");
  Serial.printf("  BB13: Control (0x01=start, 0x00=stop)\n");
  Serial.printf("  BB14: Status (bytes RX/TX)\n\n");

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  BLEDevice::setMTU(247);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCB());

  BLEService *pService = pServer->createService(BLEUUID(SERVICE_UUID), 20);

  // BB11 — RX Sink (WRITE_NR)
  pCharRx = pService->createCharacteristic(
      BLEUUID(CHAR_RX_UUID),
      BLECharacteristic::PROPERTY_WRITE_NR);
  pCharRx->setCallbacks(new RxSinkCB());

  // BB12 — TX Flood (NOTIFY)
  pCharTx = pService->createCharacteristic(
      BLEUUID(CHAR_TX_UUID),
      BLECharacteristic::PROPERTY_NOTIFY);
  pCharTx->addDescriptor(new BLE2902());

  // BB13 — Control (READ | WRITE)
  pCharCtrl = pService->createCharacteristic(
      BLEUUID(CHAR_CTRL_UUID),
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
  pCharCtrl->setCallbacks(new CtrlCB());
  uint8_t initCtrl = 0;
  pCharCtrl->setValue(&initCtrl, 1);

  // BB14 — Status (READ | NOTIFY)
  pCharStatus = pService->createCharacteristic(
      BLEUUID(CHAR_STATUS_UUID),
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  pCharStatus->addDescriptor(new BLE2902());
  uint8_t initStatus[8] = {0};
  pCharStatus->setValue(initStatus, sizeof(initStatus));

  pService->start();

  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(BLEUUID(SERVICE_UUID));
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  pAdv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising — waiting for central...");
}

// ─── Loop ─────────────────────────────────────────────────────────
void loop() {
  // TX flood when active
  if (deviceConnected && txActive) {
    // Send one notification packet
    pCharTx->setValue(txBuf, TX_PACKET_SIZE);
    pCharTx->notify();
    bytesTx += TX_PACKET_SIZE;
    packetsTx++;

    // Red pulse while active
    if (packetsTx % 100 == 0) {
      neopixelWrite(RGB_BUILTIN, 30, 0, 0);
    } else if (packetsTx % 100 == 50) {
      neopixelWrite(RGB_BUILTIN, 10, 0, 0);
    }

    // Brief yield to avoid WDT
    delay(1);
  }

  // Periodic status update (every 2s)
  if (deviceConnected && (millis() - lastStatusNotify >= 2000)) {
    lastStatusNotify = millis();
    if (txActive || bytesRx > 0) {
      updateStatus();
      Serial.printf("[STATS] RX=%lu (%lu pkts)  TX=%lu (%lu pkts)\n",
                    (unsigned long)bytesRx, (unsigned long)packetsRx,
                    (unsigned long)bytesTx, (unsigned long)packetsTx);
    }
  }

  // Advertising blink
  if (!deviceConnected) {
    static uint32_t lastBlink = 0;
    if (millis() - lastBlink >= 1000) {
      lastBlink = millis();
      static bool t = false;
      t = !t;
      neopixelWrite(RGB_BUILTIN, 0, 0, t ? 30 : 5);
    }
  }

  if (!deviceConnected && oldConnected) {
    delay(500);
    BLEDevice::startAdvertising();
    oldConnected = false;
  }
  if (deviceConnected && !oldConnected) {
    oldConnected = true;
  }

  if (!txActive) {
    delay(10);
  }
}
