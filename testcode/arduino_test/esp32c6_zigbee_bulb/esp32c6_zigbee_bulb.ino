#include "Zigbee.h"

#define ZIGBEE_ENDPOINT  10     
#define WS2812_PIN        8     
#define NUM_PIXELS        1

ZigbeeColorDimmableLight zbLight(ZIGBEE_ENDPOINT);

static bool    s_on    = false;
static uint8_t s_r     = 255, s_g = 255, s_b = 255;
static uint8_t s_level = 254;

// Sử dụng API neopixelWrite tích hợp sẵn trong ESP32 Arduino Core (RMT-based)
// Không cần thư viện Adafruit_NeoPixel nữa.

static void applyLED() {
    if (!s_on) {
        neopixelWrite(WS2812_PIN, 0, 0, 0); // Tắt đèn
    } else {
        float f = s_level / 254.0f;
        uint8_t r_out = (uint8_t)(s_r * f);
        uint8_t g_out = (uint8_t)(s_g * f);
        uint8_t b_out = (uint8_t)(s_b * f);
        neopixelWrite(WS2812_PIN, r_out, g_out, b_out); 
    }
}

void onLightChangeRgb(bool state, uint8_t red, uint8_t green, uint8_t blue, uint8_t level) {
    s_on = state;
    s_r = red; s_g = green; s_b = blue;
    s_level = level;
    applyLED();
    
    Serial.printf("[BULB] %s  RGB(%d,%d,%d)  L=%d\n", state ? "ON " : "OFF", red, green, blue, level);
}

void setup() {
    Serial.begin(115200);
    delay(2000); 

    // Khởi tạo đèn: Tắt LED
    neopixelWrite(WS2812_PIN, 0, 0, 0);

    zbLight.onLightChangeRgb(onLightChangeRgb);
    zbLight.setManufacturerAndModel("Espressif", "C6-RGB-Bulb");
    zbLight.setLightColorCapabilities(ZIGBEE_COLOR_CAPABILITY_HUE_SATURATION | ZIGBEE_COLOR_CAPABILITY_X_Y);
    
    Zigbee.addEndpoint(&zbLight);

    Serial.println("\nESP32-C6 Super Mini — Zigbee ED (RMT NeoPixel)");
    Serial.println("Starting Zigbee stack...");

    if (!Zigbee.begin(ZIGBEE_END_DEVICE, true)) {
        Serial.println("[ERROR] Zigbee.begin() failed. Restarting...");
        delay(3000);
        Zigbee.factoryReset();
        for (;;) delay(1000);
    }

    Serial.println("Waiting to join coordinator network...");
    while (!Zigbee.connected()) {
        Serial.print(".");
        delay(500);
    }

    Serial.println("\n*** Joined Zigbee network! ***");
    Serial.println("*** Hãy gửi lệnh AT+DSTADDR và AT+DSTEP từ Gateway! ***");

    // Chớp LED xanh biển 3 lần báo hiệu
    for (int i = 0; i < 3; i++) {
        neopixelWrite(WS2812_PIN, 0, 0, 128); // Blue
        delay(200);
        neopixelWrite(WS2812_PIN, 0, 0, 0);   // Off
        delay(150);
    }
}

void loop() {
    static bool lastConn = true;
    bool conn = Zigbee.connected();
    if (conn != lastConn) {
        Serial.println(conn ? "*** Re-joined network ***" : "*** Lost network ***");
        if (!conn) {
            // Chớp đỏ nếu mất kết nối
            for (int i = 0; i < 2; i++) {
                neopixelWrite(WS2812_PIN, 64, 0, 0);
                delay(200);
                neopixelWrite(WS2812_PIN, 0, 0, 0);
                delay(200);
            }
        }
        lastConn = conn;
    }
    delay(1000);
}