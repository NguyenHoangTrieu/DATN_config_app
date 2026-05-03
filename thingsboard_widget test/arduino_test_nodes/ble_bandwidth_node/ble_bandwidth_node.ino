/*
 * DA2 BLE Bandwidth Node - ESP32-S3
 *
 * Test profile:
 * - Service BB10
 * - BB11 WRITE_NR sink     -> gateway can push bytes to the node
 * - BB12 NOTIFY data pipe  -> node pushes 244-byte packets every 20 ms
 * - BB13 READ/WRITE ctrl   -> 0x01 start flood, 0x00 stop flood
 * - BB14 READ/NOTIFY stats -> RX bytes + TX bytes (uint32 LE + uint32 LE)
 *
 * Expected application throughput:
 *   244 B every 20 ms ~= 97.6 kbps
 */

#ifndef RGB_BUILTIN
#define RGB_BUILTIN 48
#endif

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define DEVICE_NAME        "DA2_BW_GATT"
#define SERVICE_UUID       ((uint16_t)0xBB10)
#define CHAR_RX_UUID       "0000BB11-0000-1000-8000-00805F9B34FB"
#define CHAR_TX_UUID       "0000BB12-0000-1000-8000-00805F9B34FB"
#define CHAR_CTRL_UUID     "0000BB13-0000-1000-8000-00805F9B34FB"
#define CHAR_STATUS_UUID   "0000BB14-0000-1000-8000-00805F9B34FB"

#define TX_PACKET_SIZE     244
#define TX_INTERVAL_MS     20UL

BLEServer *g_server = nullptr;
BLECharacteristic *g_rxChar = nullptr;
BLECharacteristic *g_txChar = nullptr;
BLECharacteristic *g_ctrlChar = nullptr;
BLECharacteristic *g_statusChar = nullptr;

volatile bool g_connected = false;
volatile bool g_txActive = false;
volatile uint32_t g_bytesRx = 0;
volatile uint32_t g_bytesTx = 0;
volatile uint32_t g_packetsRx = 0;
volatile uint32_t g_packetsTx = 0;
uint32_t g_lastTxMs = 0;
uint32_t g_lastStatusMs = 0;
uint8_t g_txBuf[TX_PACKET_SIZE];

static void updateStatus(void) {
  uint8_t buf[8];
  buf[0] = (uint8_t)(g_bytesRx & 0xFF);
  buf[1] = (uint8_t)((g_bytesRx >> 8) & 0xFF);
  buf[2] = (uint8_t)((g_bytesRx >> 16) & 0xFF);
  buf[3] = (uint8_t)((g_bytesRx >> 24) & 0xFF);
  buf[4] = (uint8_t)(g_bytesTx & 0xFF);
  buf[5] = (uint8_t)((g_bytesTx >> 8) & 0xFF);
  buf[6] = (uint8_t)((g_bytesTx >> 16) & 0xFF);
  buf[7] = (uint8_t)((g_bytesTx >> 24) & 0xFF);
  g_statusChar->setValue(buf, sizeof(buf));
  if (g_connected) {
    g_statusChar->notify();
  }
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    g_connected = true;
    g_txActive = false;
    g_bytesRx = 0;
    g_bytesTx = 0;
    g_packetsRx = 0;
    g_packetsTx = 0;
    neopixelWrite(RGB_BUILTIN, 0, 24, 0);
    Serial.println("[BLE] Connected");
  }

  void onDisconnect(BLEServer *server) override {
    g_connected = false;
    g_txActive = false;
    neopixelWrite(RGB_BUILTIN, 0, 0, 24);
    Serial.println("[BLE] Disconnected");
    BLEDevice::startAdvertising();
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    size_t len = characteristic->getLength();
    g_bytesRx += len;
    g_packetsRx++;
  }
};

class CtrlCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    uint8_t *data = characteristic->getData();
    size_t len = characteristic->getLength();
    if (!data || len < 1) return;

    if (data[0] == 0x01) {
      g_txActive = true;
      g_bytesTx = 0;
      g_packetsTx = 0;
      g_lastTxMs = 0;
      Serial.println("[BLE] Flood start");
    } else {
      g_txActive = false;
      updateStatus();
      Serial.println("[BLE] Flood stop");
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(1500);

  neopixelWrite(RGB_BUILTIN, 0, 0, 24);
  for (int i = 0; i < TX_PACKET_SIZE; i++) {
    g_txBuf[i] = (uint8_t)(i & 0xFF);
  }

  Serial.println("DA2 BLE Bandwidth Node");
  Serial.printf("Payload: %u B, interval: %lu ms, expected: 97.6 kbps\n",
                (unsigned)TX_PACKET_SIZE,
                (unsigned long)TX_INTERVAL_MS);

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  BLEDevice::setMTU(247);

  g_server = BLEDevice::createServer();
  g_server->setCallbacks(new ServerCallbacks());

  BLEService *service = g_server->createService(BLEUUID(SERVICE_UUID), 20);

  g_rxChar = service->createCharacteristic(
    BLEUUID(CHAR_RX_UUID),
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  g_rxChar->setCallbacks(new RxCallbacks());

  g_txChar = service->createCharacteristic(
    BLEUUID(CHAR_TX_UUID),
    BLECharacteristic::PROPERTY_NOTIFY
  );
  g_txChar->addDescriptor(new BLE2902());

  g_ctrlChar = service->createCharacteristic(
    BLEUUID(CHAR_CTRL_UUID),
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE
  );
  g_ctrlChar->setCallbacks(new CtrlCallbacks());
  {
    uint8_t ctrlInit = 0;
    g_ctrlChar->setValue(&ctrlInit, 1);
  }

  g_statusChar = service->createCharacteristic(
    BLEUUID(CHAR_STATUS_UUID),
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  g_statusChar->addDescriptor(new BLE2902());
  {
    uint8_t statusInit[8] = {0};
    g_statusChar->setValue(statusInit, sizeof(statusInit));
  }

  service->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLEUUID(SERVICE_UUID));
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising as DA2_BW_GATT");
}

void loop() {
  uint32_t now = millis();

  if (g_connected && g_txActive && (now - g_lastTxMs >= TX_INTERVAL_MS)) {
    g_lastTxMs = now;
    g_txBuf[0] = (uint8_t)(g_packetsTx & 0xFF);
    g_txBuf[1] = (uint8_t)((g_packetsTx >> 8) & 0xFF);
    g_txChar->setValue(g_txBuf, TX_PACKET_SIZE);
    g_txChar->notify();
    g_bytesTx += TX_PACKET_SIZE;
    g_packetsTx++;
    neopixelWrite(RGB_BUILTIN, 24, 0, 0);
  }

  if (g_connected && (now - g_lastStatusMs >= 1000)) {
    g_lastStatusMs = now;
    updateStatus();
    Serial.printf("[BLE] RX=%lu B (%lu pkt) TX=%lu B (%lu pkt) active=%d\n",
                  (unsigned long)g_bytesRx,
                  (unsigned long)g_packetsRx,
                  (unsigned long)g_bytesTx,
                  (unsigned long)g_packetsTx,
                  g_txActive ? 1 : 0);
    if (!g_txActive) {
      neopixelWrite(RGB_BUILTIN, 0, 24, 0);
    }
  }

  if (!g_connected) {
    static uint32_t lastBlink = 0;
    static bool on = false;
    if (now - lastBlink >= 800) {
      lastBlink = now;
      on = !on;
      neopixelWrite(RGB_BUILTIN, 0, 0, on ? 24 : 4);
    }
  }

  delay(1);
}