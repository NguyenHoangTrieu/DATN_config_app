/*
 * DA2 LoRa P2P Bandwidth Node (TX only, MAX throughput)
 *
 * Optimization strategy:
 *   1. Auto-upgrade UART from 9600 → 115200 baud (key bottleneck)
 *   2. Max payload 222 bytes per packet (safe Wio-E5 P2P limit)
 *   3. Flood: next TX starts immediately after TX DONE
 *   4. Live throughput log every 2s in kbps
 *
 * Serial commands:
 *   START   - resume flood
 *   STOP    - pause flood
 *   STATUS  - print counters + kbps
 *   REINIT  - re-init (baud upgrade + TEST mode + RFCFG)
 */

#include <Arduino.h>
#include <HardwareSerial.h>

#define LORA_UART_TX_PIN   22
#define LORA_UART_RX_PIN   23
#define LORA_BAUD_DEFAULT  115200
#define LORA_BAUD_FALLBACK 9600

#define RF_CFG_STR         "868,SF7,125,12,12,14,ON,OFF,OFF"
/* 222 bytes = 444 hex chars — safe max for Wio-E5 P2P TEST mode */
#define PAYLOAD_SIZE       222
#define TX_GAP_MS          0UL

#define AT_INIT_MS         3000UL
#define AT_MODE_MS         5000UL
#define AT_RFCFG_MS        7000UL
#define AT_TX_MS           6000UL   /* 222-byte airtime ~290ms + margin */

#define REINIT_FAIL_STREAK 6

HardwareSerial LoRaSerial(1);

static bool     g_ready    = false;
static bool     g_running  = true;
static uint32_t g_loraBaud = LORA_BAUD_DEFAULT;
static uint32_t g_packetsTx = 0;
static uint32_t g_bytesTx   = 0;
static uint32_t g_failTx    = 0;
static uint32_t g_failStreak = 0;
static String   g_lineBuf;
/* throughput window */
static uint32_t g_windowBytes  = 0;
static uint32_t g_windowStartMs = 0;

static bool waitForResponseAny(const char *expectA, const char *expectB, uint32_t timeoutMs) {
  uint32_t start = millis();
  String line;

  while (millis() - start < timeoutMs) {
    while (LoRaSerial.available()) {
      char c = (char)LoRaSerial.read();
      if (c == '\n') {
        line.trim();
        if (line.length()) {
          Serial.println("[AT RX] " + line);
          if ((expectA && line.indexOf(expectA) >= 0) ||
              (expectB && line.indexOf(expectB) >= 0)) {
            return true;
          }
          if (line.indexOf("ERROR") >= 0) {
            return false;
          }
        }
        line = "";
      } else if (c != '\r') {
        line += c;
      }
    }
    yield();
  }
  return false;
}

static bool sendATAny(const String &cmd, const char *expectA, const char *expectB, uint32_t timeoutMs) {
  Serial.println("[AT TX] " + cmd);
  while (LoRaSerial.available()) LoRaSerial.read();
  LoRaSerial.println(cmd);
  LoRaSerial.flush();
  return waitForResponseAny(expectA, expectB, timeoutMs);
}

static void setLoraBaud(uint32_t baud) {
  LoRaSerial.end();
  delay(80);
  LoRaSerial.begin(baud, SERIAL_8N1, LORA_UART_RX_PIN, LORA_UART_TX_PIN);
  delay(120);
  g_loraBaud = baud;
  Serial.printf("[BAUD] UART=%lu\n", (unsigned long)g_loraBaud);
}

static bool pingAT(uint32_t timeoutMs) {
  return sendATAny("AT\r\n", "+AT: OK", "OK", timeoutMs);
}

/*
 * Keep default at 115200, but recover automatically if module is still at 9600.
 * This avoids init fail and still pushes baud back to 115200 for max throughput.
 */
static bool ensureBaudAndAT(void) {
  setLoraBaud(LORA_BAUD_DEFAULT);
  if (pingAT(1200)) return true;

  Serial.println("[BAUD] No AT at 115200, trying 9600...");
  setLoraBaud(LORA_BAUD_FALLBACK);
  if (!pingAT(1200)) {
    Serial.println("[BAUD] No AT at 9600 either");
    return false;
  }

  Serial.println("[BAUD] Module alive at 9600, switching to 115200...");
  if (!sendATAny("AT+UART=BR,115200", "+UART", "OK", 1500)) {
    Serial.println("[BAUD] AT+UART failed, stay at 9600 (throughput limited)");
    return true;
  }

  delay(250);
  setLoraBaud(LORA_BAUD_DEFAULT);
  if (!pingAT(1500)) {
    Serial.println("[BAUD] Switch verify failed, fallback to 9600");
    setLoraBaud(LORA_BAUD_FALLBACK);
    if (!pingAT(1200)) return false;
  }
  return true;
}

static bool loraInitTestMode(void) {
  if (!ensureBaudAndAT()) {
    Serial.println("[LoRa] AT ping failed on both baud rates");
    return false;
  }
  if (!sendATAny("AT+MODE=TEST", "+MODE: TEST", "TEST", AT_MODE_MS)) {
    Serial.println("[LoRa] Enter TEST mode failed");
    return false;
  }
  if (!sendATAny(String("AT+TEST=RFCFG,") + RF_CFG_STR, "+TEST: RFCFG", "RFCFG", AT_RFCFG_MS)) {
    Serial.println("[LoRa] RFCFG failed");
    return false;
  }
  return true;
}

static String buildPayload(void) {
  String hex;
  hex.reserve(PAYLOAD_SIZE * 2);
  for (uint16_t i = 0; i < PAYLOAD_SIZE; i++) {
    uint8_t value = (uint8_t)((g_packetsTx + i) & 0xFF);
    if (value < 0x10) hex += '0';
    hex += String(value, HEX);
  }
  hex.toUpperCase();
  return hex;
}

static bool txOnePacket(void) {
  String payload = buildPayload();
  String cmd = "AT+TEST=TXLRPKT,\"" + payload + "\"";
  if (!sendATAny(cmd, "TX DONE", "+TEST: TX DONE", AT_TX_MS)) {
    g_failTx++;
    g_failStreak++;
    Serial.println("[LoRa] TX timeout / fail");
    return false;
  }

  g_packetsTx++;
  g_bytesTx    += PAYLOAD_SIZE;
  g_windowBytes += PAYLOAD_SIZE;
  g_failStreak = 0;
  return true;
}

static void printStatus(void) {
  uint32_t elapsedMs = millis() - g_windowStartMs;
  float kbps = (elapsedMs > 0) ? ((float)g_windowBytes * 8.0f / elapsedMs) : 0.0f;
  Serial.printf("[STATUS] ready=%d running=%d baud=%lu bytes=%lu packets=%lu fail=%lu streak=%lu kbps=%.2f\n",
                g_ready ? 1 : 0,
                g_running ? 1 : 0,
                (unsigned long)g_loraBaud,
                (unsigned long)g_bytesTx,
                (unsigned long)g_packetsTx,
                (unsigned long)g_failTx,
                (unsigned long)g_failStreak,
                kbps);
}

static void handleSerial(void) {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      g_lineBuf.trim();
      if (g_lineBuf.equalsIgnoreCase("START")) {
        g_running = true;
        g_windowBytes = 0;
        g_windowStartMs = millis();
        Serial.println("[CMD] START");
      } else if (g_lineBuf.equalsIgnoreCase("STOP")) {
        g_running = false;
        Serial.println("[CMD] STOP");
        printStatus();
      } else if (g_lineBuf.equalsIgnoreCase("STATUS")) {
        printStatus();
      } else if (g_lineBuf.equalsIgnoreCase("REINIT")) {
        Serial.println("[CMD] REINIT");
        g_ready = loraInitTestMode();
        g_windowBytes = 0;
        g_windowStartMs = millis();
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

  setLoraBaud(LORA_BAUD_DEFAULT);

  Serial.println("DA2 LoRa P2P Bandwidth Node (MAX TX)");
  Serial.printf("RF=%s payload=%uB\n", RF_CFG_STR, (unsigned)PAYLOAD_SIZE);

  g_ready = loraInitTestMode();
  g_windowStartMs = millis();
  if (g_ready) Serial.println("[LoRa] Ready. Auto flood ON.");
  else         Serial.println("[LoRa] Init failed. Use REINIT command.");
}

void loop() {
  handleSerial();

  if (!g_ready || !g_running) {
    delay(20);
    return;
  }

  txOnePacket();

  if (g_failStreak >= REINIT_FAIL_STREAK) {
    Serial.println("[LoRa] Too many TX fails, reinit...");
    g_ready = loraInitTestMode();
    g_failStreak = 0;
    g_windowBytes = 0;
    g_windowStartMs = millis();
  }

  /* Print live kbps every 2 seconds */
  static uint32_t lastLogMs = 0;
  uint32_t now = millis();
  if (now - lastLogMs >= 2000) {
    lastLogMs = now;
    uint32_t elapsedMs = now - g_windowStartMs;
    float kbps = (elapsedMs > 0) ? ((float)g_windowBytes * 8.0f / elapsedMs) : 0.0f;
    Serial.printf("[LoRa] pkts=%lu bytes=%lu fail=%lu kbps=%.2f\n",
                  (unsigned long)g_packetsTx,
                  (unsigned long)g_bytesTx,
                  (unsigned long)g_failTx,
                  kbps);
  }

  delay(1);
}