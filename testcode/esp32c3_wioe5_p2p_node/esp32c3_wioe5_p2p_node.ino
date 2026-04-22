/**
 * esp32c3_wioe5_p2p_node.ino
 * ─────────────────────────────────────────────────────────────────────────────
 * ESP32-C3 sensor node — Wio-E5 P2P (TEST mode) transmitter
 *
 * Hardware
 *   MCU  : ESP32-C3 (e.g. XIAO ESP32C3 or bare devboard)
 *   LoRa : Seeed Wio-E5 connected via UART1 (3.3 V, 9600 baud)
 *   Sensor: ESP32-C3 internal temperature + simulated humidity
 *
 * Wiring (default)
 *   Wio-E5 TX → ESP32-C3 GPIO4 (Serial1 RX)
 *   Wio-E5 RX → ESP32-C3 GPIO5 (Serial1 TX)
 *
 * Behaviour
 *   1. On startup: ping Wio-E5 with "AT", then enter TEST mode
 *      (AT+MODE=TEST), then configure RF (AT+TEST=RFCFG,...).
 *   2. Every 2 000 ms (millis-based, no delay()): read internal chip
 *      temperature and generate simulated humidity, format as hex payload,
 *      and send via AT+TEST=TXLRPKT.
 *   3. All Wio-E5 UART output is forwarded to Serial Monitor.
 *
 * Payload format (6 bytes, big-endian):
 *   Byte 0    : node ID (0x01 by default)
 *   Byte 1    : sequence counter (wraps 0-255)
 *   Byte 2-3  : temperature × 100 as int16  (internal chip sensor, °C)
 *   Byte 4-5  : humidity   × 100 as uint16  (simulated, 40–80 %)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Wio-E5 P2P AT commands used
 *   AT             → ping (expects "AT: ERROR" or "+AT: OK" or bare "OK")
 *   AT+MODE=TEST   → enter P2P test mode  → +MODE: TEST
 *   AT+TEST=RFCFG,F,SF,BW,TXPR,RXPR,POW,CRC,IQ,NET
 *                  → set RF parameters    → +TEST: RFCFG ...
 *   AT+TEST=TXLRPKT,"<HEX>"
 *                  → transmit P2P packet  → +TEST: TXLRPKT
 * ─────────────────────────────────────────────────────────────────────────────
 */

#include <Arduino.h>
#include <math.h>   /* sinf() */

/* ── Configuration ──────────────────────────────────────────────── */
#define PIN_LORA_RX     6          /* ESP32-C3 GPIO receiving from Wio-E5 TX */
#define PIN_LORA_TX     5          /* ESP32-C3 GPIO transmitting to  Wio-E5 RX */
#define LORA_BAUD       9600

#define NODE_ID         0x01
#define TX_INTERVAL_MS  2000UL     /* transmit every 2 s */

/* RF parameters — tune to match gateway */
#define P2P_FREQ        868        /* MHz        */
#define P2P_SF          "SF7"
#define P2P_BW          125        /* kHz        */
#define P2P_TXPR        12         /* TX preamble */
#define P2P_RXPR        15         /* RX preamble */
#define P2P_POW         14         /* dBm, 1-22  */

/* AT command response timeout (ms) */
#define AT_TIMEOUT_MS   4000

/* ── Globals ────────────────────────────────────────────────────── */
HardwareSerial LoRaSerial(1);   /* UART1 */

static uint8_t  seqNum     = 0;
static uint32_t lastTxTime = 0;
static bool     initialized = false;

/* ── Forward declarations ───────────────────────────────────────── */
static bool  atSend(const char *cmd, const char *expectStr, uint32_t timeoutMs);

static void  drainLoRaSerial(void);

/* ═══════════════════════════════════════════════════════════════════
   setup()
   ═══════════════════════════════════════════════════════════════════ */
void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) {}   /* wait for USB CDC on XIAO */

  Serial.println("[BOOT] ESP32-C3 Wio-E5 P2P Node starting…");

  LoRaSerial.begin(LORA_BAUD, SERIAL_8N1, PIN_LORA_RX, PIN_LORA_TX);
  delay(500);   /* give Wio-E5 time to boot (acceptable in setup) */

  /* ── 1. Ping ──────────────────────────────────────────────────── */
  Serial.println("[INIT] Pinging Wio-E5…");
  if (!atSend("AT", "OK", AT_TIMEOUT_MS)) {
    /* Wio-E5 may echo "AT: ERROR" for bare AT — try again */
    atSend("AT", "OK", AT_TIMEOUT_MS);
  }
  delay(200);

  /* ── 2. Enter TEST mode ───────────────────────────────────────── */
  Serial.println("[INIT] Entering P2P TEST mode…");
  if (!atSend("AT+MODE=TEST", "+MODE: TEST", AT_TIMEOUT_MS)) {
    Serial.println("[WARN] AT+MODE=TEST did not return expected response. Retrying…");
    delay(500);
    atSend("AT+MODE=TEST", "+MODE: TEST", AT_TIMEOUT_MS);
  }
  delay(300);

  /* ── 3. Configure RF ─────────────────────────────────────────── */
  /* AT+TEST=RFCFG,<F>,<SF>,<BW>,<TXPR>,<RXPR>,<POW>,<CRC>,<IQ>,<NET> */
  char rfcfg[80];
  snprintf(rfcfg, sizeof(rfcfg),
           "AT+TEST=RFCFG,%d,%s,%d,%d,%d,%d,ON,OFF,OFF",
           P2P_FREQ, P2P_SF, P2P_BW, P2P_TXPR, P2P_RXPR, P2P_POW);
  Serial.print("[INIT] RF config: ");
  Serial.println(rfcfg);
  if (!atSend(rfcfg, "+TEST: RFCFG", AT_TIMEOUT_MS)) {
    Serial.println("[WARN] RF config response not confirmed — continuing anyway");
  }
  delay(300);

  initialized = true;
  Serial.println("[INIT] Wio-E5 P2P ready — starting TX loop (2 s interval)");
  lastTxTime = millis();
}

/* ═══════════════════════════════════════════════════════════════════
   loop()
   ═══════════════════════════════════════════════════════════════════ */
void loop() {
  /* ── Forward any incoming Wio-E5 output to Serial Monitor ─────── */
  drainLoRaSerial();

  if (!initialized) return;

  /* ── TX every TX_INTERVAL_MS (millis-based, non-blocking) ──────── */
  if ((millis() - lastTxTime) >= TX_INTERVAL_MS) {
    lastTxTime = millis();

    /* Read sensors — internal chip temp + simulated humidity */
    float tempC  = temperatureRead();
    /* Simulated humidity: slow sine wave 40–80 %, period ~60 s */
    float humPct = 60.0f + 20.0f * sinf((float)millis() / 60000.0f * 2.0f * 3.14159f);

    /* Build 6-byte payload */
    int16_t  tempI = (int16_t)(tempC  * 100.0f);   /* e.g. 25.43 → 2543 = 0x09EF */
    uint16_t humI  = (uint16_t)(humPct * 100.0f);   /* e.g. 65.20 → 6520 = 0x197C */

    uint8_t payload[6];
    payload[0] = NODE_ID;
    payload[1] = seqNum++;
    payload[2] = (uint8_t)((tempI >> 8) & 0xFF);
    payload[3] = (uint8_t)( tempI       & 0xFF);
    payload[4] = (uint8_t)((humI  >> 8) & 0xFF);
    payload[5] = (uint8_t)( humI        & 0xFF);

    /* Convert to uppercase hex string */
    char hexStr[13];
    snprintf(hexStr, sizeof(hexStr), "%02X%02X%02X%02X%02X%02X",
             payload[0], payload[1], payload[2], payload[3], payload[4], payload[5]);

    /* Build AT command: AT+TEST=TXLRPKT,"AABBCCDDEE FF" */
    char txCmd[36];
    snprintf(txCmd, sizeof(txCmd), "AT+TEST=TXLRPKT,\"%s\"", hexStr);

    Serial.print("[TX] seq=");
    Serial.print(seqNum - 1);
    Serial.print("  temp=");
    Serial.print(tempC, 2);
    Serial.print(" C  hum=");
    Serial.print(humPct, 2);
    Serial.print("%  payload=");
    Serial.print(hexStr);
    Serial.print("  cmd=");
    Serial.println(txCmd);

    /* Send — drainLoRaSerial() in next iterations will print the response */
    LoRaSerial.println(txCmd);
    LoRaSerial.flush();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   atSend()
   Send an AT command, wait up to timeoutMs for a line containing
   expectStr.  Returns true if expectStr found, false on timeout.
   All received lines are forwarded to Serial Monitor.
   ═══════════════════════════════════════════════════════════════════ */
static bool atSend(const char *cmd, const char *expectStr, uint32_t timeoutMs) {
  /* Flush any stale bytes */
  while (LoRaSerial.available()) LoRaSerial.read();

  Serial.print("[AT>>] ");
  Serial.println(cmd);
  LoRaSerial.println(cmd);

  uint32_t start = millis();
  String   buf   = "";
  bool     found = false;

  while ((millis() - start) < timeoutMs) {
    while (LoRaSerial.available()) {
      char c = (char)LoRaSerial.read();
      if (c == '\n') {
        buf.trim();
        if (buf.length() > 0) {
          Serial.print("[AT<<] ");
          Serial.println(buf);
          if (expectStr && buf.indexOf(expectStr) >= 0) {
            found = true;
          }
        }
        buf = "";
      } else if (c != '\r') {
        buf += c;
      }
    }
    if (found) break;
    /* Tiny yield to avoid starving other tasks; actual millis() loop is non-blocking */
    yield();
  }

  /* Print any leftover partial line */
  if (buf.length() > 0) {
    Serial.print("[AT<<] ");
    Serial.println(buf);
  }

  if (!found) {
    Serial.print("[AT] Timeout waiting for: ");
    Serial.println(expectStr ? expectStr : "(any)");
  }
  return found;
}

/* ═══════════════════════════════════════════════════════════════════
   drainLoRaSerial()
   Non-blocking forward of Wio-E5 UART output → Serial Monitor.
   ═══════════════════════════════════════════════════════════════════ */
static void drainLoRaSerial() {
  static String lineBuf = "";
  while (LoRaSerial.available()) {
    char c = (char)LoRaSerial.read();
    if (c == '\n') {
      lineBuf.trim();
      if (lineBuf.length() > 0) {
        Serial.print("[LORA] ");
        Serial.println(lineBuf);
      }
      lineBuf = "";
    } else if (c != '\r') {
      lineBuf += c;
    }
  }
}
