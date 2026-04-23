/*
 * DA2 LoRa P2P Node — ESP32-C3 + Wio-E5 (RAK3172 / WioE5)
 * Target board : ESP32-C3 (Arduino IDE: "ESP32C3 Dev Module")
 * LoRa module  : Seeed Wio-E5 (STM32WLE5 with AT firmware) via UART
 *
 * Protocol:
 *   Gateway → Node  (REQUEST):  0xAA <seq>          (2 bytes)
 *   Node → Gateway  (RESPONSE): <nodeId> <seq> <tHi> <tLo> <hHi> <hLo>  (6 bytes)
 *
 *   temp int16 BE = (Celsius × 100)   range –40.00…+85.00 °C
 *   hum  uint16 BE = (Percent × 100)  range 0.00…100.00 %
 *
 * Flow:
 *   Boot → AT+MODE=TEST → AT+TEST=RFCFG,... → AT+TEST=RXLRPKT
 *   On receive REQUEST:
 *     parse payload → simulate sensor → AT+TEST=TXLRPKT,"<hex6>" → AT+TEST=RXLRPKT
 *
 * Simulated sensor: same sine-wave as BLE/ZB nodes
 *   Temp: 25.00 °C ± 2 °C (period 60 s)
 *   Hum:  60.00 % ± 5 %  (period 45 s)
 *
 * Wiring (ESP32-C3 ↔ Wio-E5):
 *   GPIO_TX (GPIO 6) → Wio-E5 RX
 *   GPIO_RX (GPIO 7) → Wio-E5 TX
 *   GND              → GND
 *   3.3 V            → VCC  (or 5 V depending on module board)
 */

#include <HardwareSerial.h>
#include <math.h>

/* ── Pin / UART config ────────────────────────────────── */
#define LORA_TX_PIN   5
#define LORA_RX_PIN   6
#define LORA_BAUD     9600
HardwareSerial LoRaSerial(1);   /* UART1 */

/* ── Node identity ────────────────────────────────────── */
#define NODE_ID       0x01

/* ── RF config (must match gateway configuration) ─────── */
/* AT+TEST=RFCFG,<freq>,<SF>,<BW>,<TX-Preamble>,<RX-Preamble>,<Power> */
#define RF_CFG_STR    "868000000,SF7,125KHZ,8,8,22"

/* ── Timeouts ─────────────────────────────────────────── */
#define AT_TIMEOUT_MS       5000
#define TX_WINDOW_MS        3000   /* wait up to 3 s for +TEST: TX DONE */

/* ── State machine ────────────────────────────────────── */
enum NodeState { ST_INIT, ST_RFCFG, ST_RX_MODE, ST_IDLE, ST_TX, ST_ERROR };
NodeState g_state = ST_INIT;

/* Pending TX payload (filled when REQUEST received) */
bool     g_txPending = false;
uint8_t  g_txBuf[6];

/* ── Sensor simulation ────────────────────────────────── */
int16_t sim_temp_raw(void) {
  float t   = (float)millis() / 1000.0f;
  float deg = 25.0f + 2.0f * sinf(2.0f * (float)M_PI * t / 60.0f);
  return (int16_t)(deg * 100.0f);
}

uint16_t sim_hum_raw(void) {
  float t   = (float)millis() / 1000.0f;
  float pct = 60.0f + 5.0f * sinf(2.0f * (float)M_PI * t / 45.0f);
  if (pct < 0.0f)   pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  return (uint16_t)(pct * 100.0f);
}

/* ── AT command helpers ───────────────────────────────── */
String readLoraLine(uint32_t timeoutMs = AT_TIMEOUT_MS) {
  String line = "";
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    if (LoRaSerial.available()) {
      char c = (char)LoRaSerial.read();
      if (c == '\n') break;
      if (c != '\r') line += c;
    }
  }
  if (line.length() > 0) Serial.println("[AT RX] " + line);
  return line;
}

/* Send AT command and wait for "+AT: OK" or target keyword */
bool sendAT(const String& cmd, const String& expectContains = "+AT: OK", uint32_t timeoutMs = AT_TIMEOUT_MS) {
  Serial.println("[AT TX] " + cmd);
  LoRaSerial.println(cmd);
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    if (LoRaSerial.available()) {
      char c = (char)LoRaSerial.read();
      static String lineBuf = "";
      if (c == '\n') {
        if (lineBuf.length() > 0) {
          Serial.println("[AT RX] " + lineBuf);
          if (lineBuf.indexOf(expectContains) >= 0) {
            lineBuf = "";
            return true;
          }
          if (lineBuf.indexOf("+AT: ERROR") >= 0) {
            lineBuf = "";
            return false;
          }
        }
        lineBuf = "";
      } else if (c != '\r') {
        lineBuf += c;
      }
    }
  }
  return false;
}

/* ── Send RXLRPKT command (enter receive mode) ────────── */
void enterRxMode() {
  Serial.println("[LoRa] Entering RX mode…");
  LoRaSerial.println("AT+TEST=RXLRPKT");
  g_state = ST_IDLE;   /* waiting for +TEST: RXLRPKT */
}

/* ── Send TXLRPKT with 6-byte payload ─────────────────── */
void sendResponse(uint8_t* buf, uint8_t len) {
  /* Build hex string */
  String hexStr = "";
  for (uint8_t i = 0; i < len; i++) {
    if (buf[i] < 0x10) hexStr += '0';
    hexStr += String(buf[i], HEX);
  }
  hexStr.toUpperCase();

  String cmd = "AT+TEST=TXLRPKT,\"" + hexStr + "\"";
  Serial.println("[LoRa] TX: " + hexStr);
  LoRaSerial.println(cmd);

  /* Wait for TX DONE */
  uint32_t t0 = millis();
  static String lb = "";
  while (millis() - t0 < TX_WINDOW_MS) {
    if (LoRaSerial.available()) {
      char c = (char)LoRaSerial.read();
      if (c == '\n') {
        if (lb.indexOf("TX DONE") >= 0 || lb.indexOf("TXLRPKT") >= 0) {
          Serial.println("[LoRa] TX done");
          lb = "";
          break;
        }
        lb = "";
      } else if (c != '\r') { lb += c; }
    }
  }
}

/* ── Handle incoming packet from Wio-E5 ─────────────────
   Wio-E5 outputs two lines when a packet is received:
     +TEST: LEN:2, RSSI:-80, SNR:7
     +TEST: RX "AABB"
   ---------------------------------------------------------------- */
String g_rxLineBuf  = "";
bool   g_rxLenSeen  = false;
int    g_rxLen      = 0;

void processLoraLine(const String& line) {
  /* +TEST: LEN:<n>, RSSI:<r>, SNR:<s> */
  if (line.startsWith("+TEST: LEN:")) {
    g_rxLenSeen = true;
    /* parse length */
    int commaIdx = line.indexOf(',');
    if (commaIdx > 11) {
      g_rxLen = line.substring(11, commaIdx).toInt();
    }
    return;
  }

  /* +TEST: RX "<hex>" */
  if (g_rxLenSeen && line.startsWith("+TEST: RX ")) {
    g_rxLenSeen = false;
    int q1 = line.indexOf('"');
    int q2 = line.lastIndexOf('"');
    if (q1 < 0 || q2 <= q1) return;
    String hexData = line.substring(q1 + 1, q2);
    hexData.toUpperCase();
    Serial.println("[LoRa] RX hex=" + hexData);

    /* Validate: REQUEST must be ≥ 2 bytes and start with 0xAA */
    if (hexData.length() < 4) return;
    uint8_t b0 = (uint8_t)strtol(hexData.substring(0, 2).c_str(), NULL, 16);
    uint8_t seq = (uint8_t)strtol(hexData.substring(2, 4).c_str(), NULL, 16);
    if (b0 != 0xAA) {
      Serial.printf("[LoRa] Unknown packet type 0x%02X — ignoring\n", b0);
      /* Re-enter RX */
      enterRxMode();
      return;
    }

    /* Build response: [nodeId, seq, tHi, tLo, hHi, hLo] */
    int16_t  tRaw = sim_temp_raw();
    uint16_t hRaw = sim_hum_raw();
    uint8_t  resp[6];
    resp[0] = NODE_ID;
    resp[1] = seq;
    resp[2] = (uint8_t)((tRaw >> 8) & 0xFF);   /* tHi */
    resp[3] = (uint8_t)(tRaw & 0xFF);            /* tLo */
    resp[4] = (uint8_t)((hRaw >> 8) & 0xFF);    /* hHi */
    resp[5] = (uint8_t)(hRaw & 0xFF);            /* hLo */

    Serial.printf("[LoRa] REQUEST seq=%u → T=%.2f°C H=%.2f%% — sending response\n",
                  seq, tRaw * 0.01f, hRaw * 0.01f);

    /* Send response then re-enter RX */
    sendResponse(resp, 6);
    delay(50);
    enterRxMode();
    return;
  }
}

/* ── Async line reader from Wio-E5 ───────────────────── */
void readLoraAsync() {
  while (LoRaSerial.available()) {
    char c = (char)LoRaSerial.read();
    if (c == '\n') {
      g_rxLineBuf.trim();
      if (g_rxLineBuf.length() > 0) {
        processLoraLine(g_rxLineBuf);
      }
      g_rxLineBuf = "";
    } else if (c != '\r') {
      g_rxLineBuf += c;
    }
  }
}

/* ── Setup ────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("[DA2] LoRa P2P Node booting (ESP32-C3 + Wio-E5)…");

  LoRaSerial.begin(LORA_BAUD, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);
  delay(200);

  /* Flush any garbage */
  while (LoRaSerial.available()) LoRaSerial.read();

  Serial.println("[LoRa] Initialising Wio-E5…");

  /* Basic AT handshake */
  if (!sendAT("AT", "+AT: OK", 3000)) {
    Serial.println("[LoRa] WARNING: no response to AT — proceeding anyway");
  }

  /* Enter TEST mode (P2P) */
  if (!sendAT("AT+MODE=TEST", "+MODE: TEST", 5000)) {
    Serial.println("[LoRa] ERROR: cannot enter TEST mode");
    g_state = ST_ERROR;
    return;
  }

  /* RF configuration */
  String rfCmd = "AT+TEST=RFCFG," + String(RF_CFG_STR);
  if (!sendAT(rfCmd, "RFCFG", 5000)) {
    Serial.println("[LoRa] WARNING: RFCFG response not confirmed — continuing");
  }
  delay(200);

  /* Enter RX mode */
  enterRxMode();
  Serial.println("[LoRa] Listening for gateway REQUEST…");
}

/* ── Loop ─────────────────────────────────────────────── */
void loop() {
  if (g_state == ST_ERROR) {
    /* Try to recover every 10 s */
    static uint32_t lastRetry = 0;
    if (millis() - lastRetry > 10000) {
      lastRetry = millis();
      Serial.println("[LoRa] Attempting recovery…");
      sendAT("AT+MODE=TEST", "+MODE: TEST", 5000);
      enterRxMode();
      g_state = ST_IDLE;
    }
    return;
  }

  readLoraAsync();
  delay(5);
}
