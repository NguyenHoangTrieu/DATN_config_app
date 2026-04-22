/**
 * esp32c6_zigbee_sensor.ino
 *
 * Target  : ESP32-C6 (Arduino ESP32 core >= 3.0.5)
 * Role    : Zigbee Router/End Device — Simulated Temperature & Humidity Sensor
 *
 * ─── ZCL Clusters ─────────────────────────────────────────────────
 *  Endpoint 1:
 *    0x0402 — Temperature Measurement (attr 0x0000: MeasuredValue int16, unit 0.01°C)
 *    0x0405 — Relative Humidity (attr 0x0000: MeasuredValue uint16, unit 0.01%)
 *
 * ─── Hardware ─────────────────────────────────────────────────────
 *  GPIO 8 — WS2812 neopixel on ESP32-C6 Super Mini
 *    Orange blink = searching for coordinator
 *    Green solid  = joined network
 *    Cyan pulse   = reporting data
 *
 * ─── Simulated Data ──────────────────────────────────────────────
 *  Temperature: 20–35°C sinusoidal + noise
 *  Humidity:    40–80% sinusoidal + noise
 *  Reports every REPORT_INTERVAL_S seconds
 *
 * ─── Identification ──────────────────────────────────────────────
 *  Model ID: "ZB-TH-Sensor"
 *  Manufacturer: "DA2"
 *
 * IMPORTANT: Change DEVICE_INDEX for each device (1 or 2)
 *
 * Arduino IDE settings:
 *   Board               : ESP32C6 Dev Module
 *   Zigbee Mode         : Zigbee ZCZR (Router) or Zigbee ED (End Device)
 *   Partition Scheme    : Zigbee 4MB
 *   Flash Mode          : DIO
 */

// ─── CHANGE THIS for each device (1 or 2) ────────────────────────
#define DEVICE_INDEX  1

// ─── Hardware ─────────────────────────────────────────────────────
#define RGB_LED_PIN      8
#define REPORT_INTERVAL_S  10  // seconds between reports

// ─── Zigbee ───────────────────────────────────────────────────────
#include "Zigbee.h"

#define ZB_ENDPOINT      1
#define MANUFACTURER     "DA2"

static char modelId[20];

// Use Zigbee Temperature Sensor endpoint
ZigbeeTempSensor zbTempSensor(ZB_ENDPOINT);

// ─── Globals ──────────────────────────────────────────────────────
float simTime = 0.0f;
uint32_t lastReport = 0;

// ─── Simulated data ──────────────────────────────────────────────
float generateTemp() {
  simTime += 0.1f;
  float base = 25.0f + DEVICE_INDEX * 3.0f;
  float temp = base + 5.0f * sin(simTime * 0.04f + DEVICE_INDEX)
             + ((float)random(-100, 100)) / 100.0f;
  return constrain(temp, 10.0f, 50.0f);
}

float generateHum() {
  float base = 55.0f + DEVICE_INDEX * 5.0f;
  float hum = base + 15.0f * sin(simTime * 0.025f + DEVICE_INDEX * 0.7f)
            + ((float)random(-150, 150)) / 100.0f;
  return constrain(hum, 20.0f, 99.0f);
}

// ─── LED helpers ──────────────────────────────────────────────────
void ledSearching() {
  static bool t = false;
  t = !t;
  neopixelWrite(RGB_LED_PIN, t ? 30 : 0, t ? 15 : 0, 0);  // orange blink
}

void ledJoined() {
  neopixelWrite(RGB_LED_PIN, 0, 30, 0);  // green
}

void ledReporting() {
  neopixelWrite(RGB_LED_PIN, 0, 20, 20);  // cyan
}

// ─── Serial commands ──────────────────────────────────────────────
void handleSerial(const String &cmd) {
  String c = cmd;
  c.trim();
  c.toUpperCase();

  if (c == "STATUS") {
    float t = generateTemp();
    float h = generateHum();
    Serial.printf("Temp=%.2f°C  Hum=%.2f%%  ZB=%d\n", t, h, (int)Zigbee.connected());
  } else if (c == "RESET") {
    Serial.println("Factory reset...");
    delay(100);
    Zigbee.factoryReset();
  } else if (c == "REPORT") {
    float t = generateTemp();
    float h = generateHum();
    zbTempSensor.setTemperature(t);
    zbTempSensor.setHumidity(h);
    zbTempSensor.report();
    Serial.printf("Forced report: T=%.2f H=%.2f\n", t, h);
  } else if (c.length() > 0) {
    Serial.println("Commands: STATUS REPORT RESET");
  }
}

// ─── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  snprintf(modelId, sizeof(modelId), "ZB-TH-Sensor-%d", DEVICE_INDEX);

  Serial.printf("\n=== %s — Zigbee Temp/Hum Sensor ===\n", modelId);
  Serial.printf("  EP: %d  Mfg: %s\n", ZB_ENDPOINT, MANUFACTURER);

  neopixelWrite(RGB_LED_PIN, 0, 0, 0);
  randomSeed(analogRead(0) ^ micros());

  // Startup blink
  for (int i = 0; i < 3; i++) {
    neopixelWrite(RGB_LED_PIN, 0, 0, 40);
    delay(100);
    neopixelWrite(RGB_LED_PIN, 0, 0, 0);
    delay(100);
  }

  // Configure Zigbee sensor endpoint
  zbTempSensor.setManufacturerAndModel(MANUFACTURER, modelId);

  // Set min/max ranges
  zbTempSensor.setMinMaxValue(10.0f, 50.0f);
  // Set tolerance
  zbTempSensor.setTolerance(0.5f);
  // Set initial reporting config
  zbTempSensor.setReporting(REPORT_INTERVAL_S, REPORT_INTERVAL_S * 6, 0.5f);

  Zigbee.addEndpoint(&zbTempSensor);

  Serial.println("Starting Zigbee...");
  if (!Zigbee.begin(ZIGBEE_ROUTER)) {
    Serial.println("ERROR: Zigbee.begin() failed!");
    while (true) {
      neopixelWrite(RGB_LED_PIN, 40, 0, 0);
      delay(300);
      neopixelWrite(RGB_LED_PIN, 0, 0, 0);
      delay(300);
    }
  }

  Serial.println("Waiting for coordinator...");
  uint32_t waitStart = millis();
  while (!Zigbee.connected()) {
    ledSearching();
    delay(500);
    if (millis() - waitStart > 30000) {
      Serial.println("No coordinator after 30s — continuing.");
      break;
    }
  }

  if (Zigbee.connected()) {
    Serial.println("Joined Zigbee network!");
    ledJoined();
    delay(500);

    // Send initial report
    float t = generateTemp();
    float h = generateHum();
    zbTempSensor.setTemperature(t);
    zbTempSensor.setHumidity(h);
    zbTempSensor.report();
    Serial.printf("Initial report: T=%.2f H=%.2f\n", t, h);
  }

  Serial.println("Ready. Commands: STATUS REPORT RESET");
}

// ─── Loop ─────────────────────────────────────────────────────────
void loop() {
  // Serial commands
  static String serBuf;
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (serBuf.length() > 0) {
        handleSerial(serBuf);
        serBuf = "";
      }
    } else {
      serBuf += ch;
    }
  }

  // Periodic reporting
  if (Zigbee.connected() && (millis() - lastReport >= (uint32_t)REPORT_INTERVAL_S * 1000)) {
    lastReport = millis();

    float t = generateTemp();
    float h = generateHum();
    zbTempSensor.setTemperature(t);
    zbTempSensor.setHumidity(h);
    zbTempSensor.report();

    Serial.printf("[REPORT] T=%.2f°C H=%.2f%%\n", t, h);
    ledReporting();
    delay(50);
    ledJoined();
  }

  delay(10);
}
