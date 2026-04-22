/**
 * esp32_ble_gatt_test_widget.ino
 *
 * Target : ESP32/ESP32-C6/ESP32-S3 (Arduino ESP32 core >= 3.x)
 * Role   : BLE GATT Peripheral (server)
 *          Designed specifically to be 100% compatible with the Web UI
 *          "ble_gatt_test_widget.js" (GATT Test Widget using CFBL AT Commands).
 *
 * Service   : 0xFFF0 
 * Char FFF1 : READ | NOTIFY 
 *             - Sends a 4-byte LE uint32 counter every 2 seconds.
 *             - Parsed directly by the widget to update the "FFF1 Counter".
 * Char FFF2 : READ | WRITE | NOTIFY
 *             - Controls the built-in LED (GPIO 8 for ESP32-C6).
 *             - When written by the Central (0x01 or 0x00), it updates the LED 
 *               AND immediately echoes back the state via FFF2 NOTIFY.
 *             - Parsed directly by the widget to update the LED icon UI.
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ─── Constants ───────────────────────────────────────────────────────────────

#define DEVICE_NAME     "WIDGET_TEST_GATT"
#define SERVICE_UUID    ((uint16_t)0xFFF0)
#define CHAR_FFF1_UUID  "0000FFF1-0000-1000-8000-00805F9B34FB"  // Counter
#define CHAR_FFF2_UUID  "0000FFF2-0000-1000-8000-00805F9B34FB"  // LED Control

// Thay pin này tương ứng với LED trên board của bạn. 
// ESP32-C6 DevKit: 8, ESP32 thuờng: 2.
#define LED_GPIO        8

// ESP32-S3 DevKitC-1 dùng WS2812 RGB LED (Neopixel) ở PIN 38
#ifndef RGB_BUILTIN
  #define RGB_BUILTIN 38
#endif

#define NOTIFY_INTERVAL 2000   

// ─── Globals ─────────────────────────────────────────────────────────────────

BLEServer         *pServer     = nullptr;
BLECharacteristic *pCharFFF1   = nullptr;
BLECharacteristic *pCharFFF2   = nullptr;

bool     deviceConnected = false;
bool     oldConnected    = false;
uint32_t counter         = 0;
uint32_t lastNotify      = 0;

volatile bool pendingLedNotify = false;
volatile uint8_t pendingLedVal = 0;

// ─── Callbacks ───────────────────────────────────────────────────────────────

class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer *pSrv) override {
        deviceConnected = true;
        Serial.println("[BLE] Gateway Connected!");
    }
    void onDisconnect(BLEServer *pSrv) override {
        deviceConnected = false;
        Serial.println("[BLE] Gateway Disconnected! Restarting advertising...");
        BLEDevice::startAdvertising();
    }
};

class WriteCallbacksFFF2 : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) override {
        Serial.println("\n[FFF2] ---- BẮT ĐẦU NHẬN LỆNH WRITE TỪ GATEWAY ----");
        
        uint8_t* txData = pChar->getData();
        size_t len = pChar->getLength();
        
        Serial.printf("[FFF2] Kích thước dữ liệu nhận được: %d bytes\n", len);

        if (txData == nullptr) {
            Serial.println("[FFF2 LỖI] Con trỏ dữ liệu bị NULL!");
            return;
        }

        if (len == 0) {
            Serial.println("[FFF2 LỖI] Dữ liệu RỖNG (0 bytes)!");
            return;
        }

        // In ra toàn bộ chuỗi HEX nhận được để kiểm tra
        Serial.print("[FFF2] Chuỗi HEX thô: ");
        for (size_t i = 0; i < len; i++) {
            Serial.printf("%02X ", txData[i]);
        }
        Serial.println();

        uint8_t val = txData[0];
        Serial.printf("[FFF2 WRITE] Giá trị trích xuất lệnh điều khiển: 0x%02X\n", val);

        // Control ESP32-S3 RGB LED
        if (val != 0) {
            Serial.println("[FFF2] >>> BẬT ĐÈN LED (XANH LÁ) <<<");
#ifdef RGB_BUILTIN
            // Bật màu Xanh lá (Green) cho RGB LED
            neopixelWrite(RGB_BUILTIN, 0, 255, 0); 
#endif
        } else {
            Serial.println("[FFF2] >>> TẮT ĐÈN LED <<<");
#ifdef RGB_BUILTIN
            // Tắt LED
            neopixelWrite(RGB_BUILTIN, 0, 0, 0); 
#endif
        }

        // Flags for main loop to execute notify safely
        if (deviceConnected) {
            Serial.println("[FFF2] Gắn cờ chờ hàm loop() thông báo trả về (Notify).");
            pendingLedVal = val;
            pendingLedNotify = true;
        }
        Serial.println("[FFF2] ---- KẾT THÚC XỬ LÝ WRITE ----\n");
    }
};

// ─── Setup ───────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    
    // ESP32-S3 Native USB mất một lúc để kết nối tới máy tính, ta cần chờ 3s
    delay(3000); 

#ifdef RGB_BUILTIN
    // Tắt đèn RGB lúc mới khởi động
    neopixelWrite(RGB_BUILTIN, 0, 0, 0);
#endif

    Serial.println("\n=== WIDGET GATT TEST (Target: ESP32-S3 DevKit) ===");

    BLEDevice::init(DEVICE_NAME);
    
    // Tạo chuẩn Server 
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());

    // Tạo Service 0xFFF0
    BLEService *pService = pServer->createService(BLEUUID(SERVICE_UUID));

    // Đặc tính FFF1: Bộ đếm 4 bytes (READ | NOTIFY)
    pCharFFF1 = pService->createCharacteristic(
        BLEUUID(CHAR_FFF1_UUID),
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
    );
    pCharFFF1->addDescriptor(new BLE2902());
    
    uint8_t initCounter[4] = {0, 0, 0, 0};
    pCharFFF1->setValue(initCounter, sizeof(initCounter));

    // Đặc tính FFF2: Điều khiển bóng đèn (READ | WRITE | NOTIFY)
    pCharFFF2 = pService->createCharacteristic(
        BLEUUID(CHAR_FFF2_UUID),
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
    );
    pCharFFF2->addDescriptor(new BLE2902()); // Cần CCCD Descriptor để Widget mở Notify
    pCharFFF2->setCallbacks(new WriteCallbacksFFF2());
    
    uint8_t initLed[1] = {0};
    pCharFFF2->setValue(initLed, 1);

    // Kích hoạt Bluetooth
    pService->start();

    BLEAdvertising *pAdv = BLEDevice::getAdvertising();
    pAdv->addServiceUUID(BLEUUID(SERVICE_UUID));
    pAdv->setScanResponse(true);
    pAdv->setMinPreferred(0x06);  
    pAdv->setMaxPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("[BLE] Đang phát Bluetooth... Hãy dùng Widget rò tìm và kết nối!");
}

// ─── Loop ────────────────────────────────────────────────────────────────────

void loop() {
    uint32_t now = millis();

    // Xử lý báo cáo Notify LED an toàn ngoài ngắt
    if (deviceConnected && pendingLedNotify) {
        pendingLedNotify = false;
        uint8_t resp[1] = {pendingLedVal};
        pCharFFF2->setValue(resp, 1);
        pCharFFF2->notify();
        Serial.printf("[FFF2 NOTIFY] Echoed LED state: 0x%02X\n", pendingLedVal);
    }

    // Thông báo (Notify) bộ đếm FFF1 định kỳ mỗi 2 giây
    if (deviceConnected && (now - lastNotify >= NOTIFY_INTERVAL)) {
        lastNotify = now;
        counter++;

        // Nén 4 bytes bộ đếm vào mảng bằng chuẩn Little-Endian
        uint8_t buf[4];
        buf[0] = (uint8_t)(counter & 0xFF);
        buf[1] = (uint8_t)((counter >> 8) & 0xFF);
        buf[2] = (uint8_t)((counter >> 16) & 0xFF);
        buf[3] = (uint8_t)((counter >> 24) & 0xFF);

        pCharFFF1->setValue(buf, sizeof(buf));
        pCharFFF1->notify();
        // Giảm Comment dòng này để Serial đỡ bị trôi:
        // Serial.printf("[FFF1 NOTIFY] Đã đẩy Counter: %lu\n", (unsigned long)counter);
    }

    // CHECK VÒNG LẶP: Đọc thẳng giá trị lõi của Characteristic FFF2 từ trong gầm của BLE Stack
    // Để xem có thực sự là Gateway ghi thành công nhưng hàm onWrite bị thư viện BLE lơ đi không!
    static uint8_t last_core_val = 0xFF;
    uint8_t* core_data = pCharFFF2->getData();
    if (core_data != nullptr && pCharFFF2->getLength() > 0) {
        uint8_t core_val = core_data[0];
        if (core_val != last_core_val && last_core_val != 0xFF) {
            Serial.printf("\n[CẢNH BÁO LẠ] Loop nhặt được giá trị Data lõi thay đổi: 0x%02X\n", core_val);
            if (core_val != 0) {
#ifdef RGB_BUILTIN
                neopixelWrite(RGB_BUILTIN, 0, 255, 0);
#endif
                Serial.println("[LOOP] Đã TRỰC TIẾP bật đèn LED xanh lá từ loop!");
            } else {
#ifdef RGB_BUILTIN
                neopixelWrite(RGB_BUILTIN, 0, 0, 0);
#endif
                Serial.println("[LOOP] Đã TRỰC TIẾP tắt đèn LED từ loop!");
            }
        }
        last_core_val = core_val;
    }

    // Tự động phát lại sóng nếu gateway ngắt kết nối
    if (!deviceConnected && oldConnected) {
        delay(500);
        BLEDevice::startAdvertising();
        Serial.println("[BLE] Đẩy lại quảng cáo Bluetooth (Advertising restarted)");
        oldConnected = false;
    }
    
    // Lưu trạng thái nối khi có gateway móc vào
    if (deviceConnected && !oldConnected) {
        oldConnected = true;
    }
    
    // Ngăn chặn treo Watchdog Timer (WDT) cho các tác vụ ngầm của BLE RTOS
    delay(10);
}
