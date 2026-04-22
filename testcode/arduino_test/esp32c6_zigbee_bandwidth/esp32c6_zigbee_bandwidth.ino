/**
 * esp32c6_zigbee_bandwidth.ino
 *
 * Target  : ESP32-C6 (Arduino ESP32 core >= 3.0.5)
 * Role    : Zigbee Router — Bandwidth Test Node
 *
 * ─── ZCL Private Cluster 0xFC00 ───────────────────────────────────
 *  Attr 0x0000 (uint8)  : Test control (0=stop, 1=start TX flood)
 *  Attr 0x0001 (uint32) : Bytes received counter (read-only)
 *  Attr 0x0002 (uint32) : Bytes sent counter (read-only)
 *  Attr 0x0003 (octstr) : Data payload (reportable, up to 80 bytes)
 *
 * ─── Hardware ─────────────────────────────────────────────────────
 *  GPIO 8 — WS2812 neopixel
 *
 * ─── Protocol ─────────────────────────────────────────────────────
 *  Since ESP32-C6 Arduino Zigbee library doesn't support custom
 *  clusters easily, we use the Temperature Sensor endpoint with
 *  a "bandwidth test" mode:
 *
 *  - When coordinator sends AT+SENDDATA with cluster 0x0000 and
 *    payload starting with 0xBW, device counts as RX
 *  - Device can send rapid reports (temperature attribute) as TX
 *  - Control via On/Off cluster: ON=start TX flood, OFF=stop
 *
 * ─── Identification ──────────────────────────────────────────────
 *  Model ID: "ZB-BW-Sensor"
 *  Manufacturer: "DA2"
 *
 * Arduino IDE settings:
 *   Board           : ESP32C6 Dev Module
 *   Zigbee Mode     : Zigbee ZCZR
 *   Partition Scheme: Zigbee 4MB
 */

#include "Zigbee.h"

#define RGB_LED_PIN      8
#define ZB_ENDPOINT      1
#define MANUFACTURER     "DA2"
#define MODEL_ID         "ZB-BW-Sensor"

#define TX_INTERVAL_MS   100   // flood rate: 10 reports/s
#define REPORT_BYTES     40    // bytes per report payload approximation

ZigbeeTempSensor zbSensor(ZB_ENDPOINT);

// ─── State ────────────────────────────────────────────────────────
volatile bool     txFloodActive = false;
volatile uint32_t bytesRx       = 0;
volatile uint32_t bytesTx       = 0;
volatile uint32_t packetsRx     = 0;
volatile uint32_t packetsTx     = 0;
uint32_t lastTx   = 0;
uint32_t lastLog  = 0;
float simCounter  = 0.0f;

// ─── LED ──────────────────────────────────────────────────────────
void ledIdle()      { neopixelWrite(RGB_LED_PIN, 0, 20, 0); }
void ledFlood()     { neopixelWrite(RGB_LED_PIN, 30, 0, 0); }
void ledSearching() {
  static bool t = false; t = !t;
  neopixelWrite(RGB_LED_PIN, t?30:0, t?15:0, 0);
}

// ─── Zigbee callbacks ─────────────────────────────────────────────
// We repurpose the ZigbeeColorDimmableLight for On/Off control
// But since we only need On/Off, we use a simpler approach:
// The coordinator sends AT+ZCL commands which the stack processes.
// We detect On/Off state changes as start/stop signals.

// For the temp sensor approach: we'll use setTemperature to send
// different values rapidly as a "data flood"

// ─── Serial commands ──────────────────────────────────────────────
void handleSerial(const String &cmd) {
  String c = cmd;
  c.trim();
  c.toUpperCase();

  if (c == "START") {
    txFloodActive = true;
    bytesTx = 0;
    packetsTx = 0;
    Serial.println("TX flood STARTED");
  } else if (c == "STOP") {
    txFloodActive = false;
    Serial.printf("Stopped. RX=%lu TX=%lu\n",
                  (unsigned long)bytesRx, (unsigned long)bytesTx);
  } else if (c == "STATUS") {
    Serial.printf("Active=%d RX=%lu(%lu) TX=%lu(%lu) ZB=%d\n",
                  txFloodActive, (unsigned long)bytesRx, (unsigned long)packetsRx,
                  (unsigned long)bytesTx, (unsigned long)packetsTx,
                  (int)Zigbee.connected());
  } else if (c == "RESET") {
    bytesRx = bytesTx = packetsRx = packetsTx = 0;
    Serial.println("Counters reset");
  } else if (c == "ZBRESET") {
    Zigbee.factoryReset();
  } else if (c.length() > 0) {
    Serial.println("Commands: START STOP STATUS RESET ZBRESET");
  }
}

// ─── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.printf("\n=== %s — Zigbee Bandwidth Test ===\n", MODEL_ID);
  neopixelWrite(RGB_LED_PIN, 0, 0, 0);
  randomSeed(analogRead(0) ^ micros());

  // Startup blink
  for (int i = 0; i < 3; i++) {
    neopixelWrite(RGB_LED_PIN, 40, 0, 0);
    delay(100);
    neopixelWrite(RGB_LED_PIN, 0, 0, 0);
    delay(100);
  }

  zbSensor.setManufacturerAndModel(MANUFACTURER, MODEL_ID);
  zbSensor.setMinMaxValue(-10.0f, 100.0f);
  zbSensor.setTolerance(0.1f);
  // Fast reporting for bandwidth test
  zbSensor.setReporting(1, 5, 0.1f);

  Zigbee.addEndpoint(&zbSensor);

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
  uint32_t ws = millis();
  while (!Zigbee.connected()) {
    ledSearching();
    delay(500);
    if (millis() - ws > 30000) break;
  }

  if (Zigbee.connected()) {
    Serial.println("Joined network!");
    ledIdle();
  }

  Serial.println("Commands: START STOP STATUS RESET ZBRESET");
}

// ─── Loop ─────────────────────────────────────────────────────────
void loop() {
  // Serial
  static String serBuf;
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (serBuf.length() > 0) { handleSerial(serBuf); serBuf = ""; }
    } else { serBuf += ch; }
  }

  uint32_t now = millis();

  // TX flood via rapid temperature reports
  if (Zigbee.connected() && txFloodActive && (now - lastTx >= TX_INTERVAL_MS)) {
    lastTx = now;
    simCounter += 0.01f;
    if (simCounter > 99.0f) simCounter = 0.0f;

    // Each report carries ~REPORT_BYTES of ZCL data
    zbSensor.setTemperature(simCounter);
    zbSensor.setHumidity(100.0f - simCounter);
    zbSensor.report();

    bytesTx += REPORT_BYTES;
    packetsTx++;

    if (packetsTx % 20 == 0) ledFlood();
    else if (packetsTx % 20 == 10) neopixelWrite(RGB_LED_PIN, 10, 0, 0);
  }

  // Log every 2s
  if (now - lastLog >= 2000) {
    lastLog = now;
    if (txFloodActive || bytesRx > 0 || bytesTx > 0) {
      Serial.printf("[BW] RX=%lu(%lu) TX=%lu(%lu)\n",
                    (unsigned long)bytesRx, (unsigned long)packetsRx,
                    (unsigned long)bytesTx, (unsigned long)packetsTx);
    }
  }

  if (!txFloodActive) delay(10);
  else delay(1);
}
