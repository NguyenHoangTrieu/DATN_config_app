/*
 * DA2 LoRa P2P Bandwidth Node - ESP32-C3 + Wio-E5
 *
 * Test profile:
 * - TEST/P2P mode transmitter
 * - Sends 50-byte payload every 113 ms
 * - Expected application throughput ~= 3.5 kbps at SF7 / 125 kHz
 *
 * Serial commands:
 *   START   - start flooding
 *   STOP    - stop flooding
 *   STATUS  - print counters
 */

#include <HardwareSerial.h>

#define LORA_UART_TX_PIN   5
#define LORA_UART_RX_PIN   6
#define LORA_BAUD          9600
#define RF_CFG_STR         "920,SF7,125,8,15,14,ON,OFF,OFF"
#define PAYLOAD_SIZE       50
#define TX_INTERVAL_MS     113UL

HardwareSerial LoRaSerial(1);

bool g_ready = false;
bool g_running = true;
uint32_t g_lastTxMs = 0;
uint32_t g_packetsTx = 0;
uint32_t g_bytesTx = 0;
String g_lineBuf;

static bool waitForResponse(const char *expect, uint32_t timeoutMs) {
  uint32_t start = millis();
  String line;
  while (millis() - start < timeoutMs) {
    while (LoRaSerial.available()) {
      char c = (char)LoRaSerial.read();
      if (c == '\n') {
        line.trim();
        if (line.length()) {
          Serial.println("[AT RX] " + line);
          if (line.indexOf(expect) >= 0) return true;
          if (line.indexOf("ERROR") >= 0) return false;
        }
        line = "";
      } else if (c != '\r') {
        line += c;
      }
    }
  }
  return false;
}

static bool sendAT(const String &cmd, const char *expect, uint32_t timeoutMs) {
  Serial.println("[AT TX] " + cmd);
  LoRaSerial.println(cmd);
  return waitForResponse(expect, timeoutMs);
}

static String buildPayload(void) {
  String hex;
  for (uint8_t i = 0; i < PAYLOAD_SIZE; i++) {
    uint8_t value = (uint8_t)((g_packetsTx + i) & 0xFF);
    if (value < 0x10) hex += '0';
    hex += String(value, HEX);
  }
  hex.toUpperCase();
  return hex;
}

static void sendPacket(void) {
  String payload = buildPayload();
  String cmd = "AT+TEST=TXLRPKT,\"" + payload + "\"";
  LoRaSerial.println(cmd);
  Serial.println("[AT TX] " + cmd);
  if (waitForResponse("TX DONE", 5000) || waitForResponse("TXLRPKT", 5000)) {
    g_packetsTx++;
    g_bytesTx += PAYLOAD_SIZE;
  }
}

static void handleSerial(void) {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      g_lineBuf.trim();
      if (g_lineBuf.equalsIgnoreCase("START")) {
        g_running = true;
        Serial.println("[CMD] START");
      } else if (g_lineBuf.equalsIgnoreCase("STOP")) {
        g_running = false;
        Serial.println("[CMD] STOP");
      } else if (g_lineBuf.equalsIgnoreCase("STATUS")) {
        Serial.printf("[STATUS] ready=%d running=%d bytes=%lu packets=%lu\n",
                      g_ready ? 1 : 0,
                      g_running ? 1 : 0,
                      (unsigned long)g_bytesTx,
                      (unsigned long)g_packetsTx);
      }
      g_lineBuf = "";
    } else {
      g_lineBuf += c;
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  LoRaSerial.begin(LORA_BAUD, SERIAL_8N1, LORA_UART_RX_PIN, LORA_UART_TX_PIN);
  delay(300);

  Serial.println("DA2 LoRa P2P Bandwidth Node");
  Serial.printf("Payload: %u B, interval: %lu ms, expected: 3.5 kbps\n",
                (unsigned)PAYLOAD_SIZE,
                (unsigned long)TX_INTERVAL_MS);

  while (LoRaSerial.available()) LoRaSerial.read();

  if (!sendAT("AT", "+AT: OK", 3000)) {
    Serial.println("[LoRa] No AT response");
  }
  if (!sendAT("AT+MODE=TEST", "+MODE: TEST", 5000)) {
    Serial.println("[LoRa] Failed to enter TEST mode");
    return;
  }
  if (!sendAT("AT+LW=LDRO,ON", "+LW: LDRO,ON", 4000)) {
    Serial.println("[LoRa] LDRO command not acknowledged");
  }
  if (!sendAT(String("AT+TEST=RFCFG,") + RF_CFG_STR, "+TEST: RFCFG", 5000)) {
    Serial.println("[LoRa] RFCFG failed");
    return;
  }

  g_ready = true;
  Serial.println("[LoRa] Ready. Auto-start flood enabled.");
}

void loop() {
  handleSerial();
  if (!g_ready || !g_running) {
    delay(20);
    return;
  }

  uint32_t now = millis();
  if (now - g_lastTxMs >= TX_INTERVAL_MS) {
    g_lastTxMs = now;
    sendPacket();
  }

  static uint32_t lastLogMs = 0;
  if (now - lastLogMs >= 1000) {
    lastLogMs = now;
    Serial.printf("[LoRa] bytes=%lu packets=%lu running=%d\n",
                  (unsigned long)g_bytesTx,
                  (unsigned long)g_packetsTx,
                  g_running ? 1 : 0);
  }

  delay(1);
}