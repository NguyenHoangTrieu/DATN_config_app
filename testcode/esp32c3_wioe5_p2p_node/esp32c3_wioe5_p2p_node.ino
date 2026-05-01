/**
 * esp32c3_wioe5_p2p_node.ino
 * ─────────────────────────────────────────────────────────────────────────────
 * ESP32-C3 P2P LoRa node — Wio-E5 TEST mode with JOIN handshake
 *
 * State machine
 * ─────────────────────────────────────────────────────────────────────────────
 *  JOINING  →  TX JOIN_REQUEST  [0xFF, nodeId, seq]  (3 B)
 *              switch to RX, wait up to RX_WINDOW_MS for JOIN_ACCEPT [0xFE, nodeId]
 *              cycle repeats until JOIN_ACCEPT received
 *
 *  DATA     →  TX SENSOR_DATA   [0x01, nodeId, seq, tHi, tLo, hHi, hLo, led]  (8 B)
 *              switch to RX, wait up to RX_WINDOW_MS
 *              if [0x10] received → LED ON   (GPIO LED_PIN)
 *              if [0x11] received → LED OFF
 *              cycle repeats indefinitely
 *
 * Packet types (first byte)
 *   0xFF  JOIN_REQUEST   node → gateway
 *   0xFE  JOIN_ACCEPT    gateway → node
 *   0x01  SENSOR_DATA    node → gateway (last byte = LED state 0/1)
 *   0x10  LED_ON         gateway → node
 *   0x11  LED_OFF        gateway → node
 *
 * Wiring (change PIN_LORA_RX / PIN_LORA_TX to match your board)
 *   Wio-E5 TX  → ESP32-C3 PIN_LORA_RX  (GPIO6 default)
 *   Wio-E5 RX  ← ESP32-C3 PIN_LORA_TX  (GPIO5 default)
 *   Built-in LED on GPIO8 (active LOW on XIAO ESP32-C3)
 * ─────────────────────────────────────────────────────────────────────────────
 */

#include <Arduino.h>
#include <math.h>   /* sinf() */

/* ── Wiring ──────────────────────────────────────────────────────── */
#define PIN_LORA_RX   6       /* ESP32-C3 RX ← Wio-E5 TX */
#define PIN_LORA_TX   5       /* ESP32-C3 TX → Wio-E5 RX */
#define LORA_BAUD     9600

#define LED_PIN       8       /* built-in LED, active LOW */
#define LED_ON()      digitalWrite(LED_PIN, LOW)
#define LED_OFF()     digitalWrite(LED_PIN, HIGH)

/* ── Node identity ───────────────────────────────────────────────── */
#define NODE_ID       0x01

/* ── Timing ──────────────────────────────────────────────────────── */
#define RX_WINDOW_MS  2000UL /* RX listen window after each TX (ms) */
#define AT_INIT_MS    3000UL  /* timeout for setup AT commands        */
#define AT_TX_MS      2000UL  /* timeout for TXLRPKT confirmation     */

/* ── RF parameters (must match gateway) ─────────────────────────── */
#define P2P_FREQ   868        /* MHz   */
#define P2P_SF     "SF7"
#define P2P_BW     125        /* kHz   */
#define P2P_TXPR   12
#define P2P_RXPR   15
#define P2P_POW    14         /* dBm   */

/* ── Packet type bytes ───────────────────────────────────────────── */
#define PKT_JOIN_REQ  0xFF
#define PKT_JOIN_ACK  0xFE
#define PKT_SENSOR    0x01
#define PKT_LED_ON    0x10
#define PKT_LED_OFF   0x11

/* ── Globals ─────────────────────────────────────────────────────── */
HardwareSerial LoRaSerial(1);

typedef enum { ST_JOINING, ST_DATA } NodeState;

static NodeState g_state   = ST_JOINING;
static uint8_t   g_seq     = 0;
static bool      g_inited  = false;
static bool      g_ledOn   = false;

/* ════════════════════════════════════════════════════════════════════
   Low-level helpers
   ════════════════════════════════════════════════════════════════════ */

/** Send AT command, wait up to timeoutMs for a line containing expectStr.
 *  All received lines are printed to Serial Monitor.
 *  Returns true if expectStr found, false on timeout. */
static bool atSend(const char *cmd, const char *expectStr, uint32_t timeoutMs)
{
    while (LoRaSerial.available()) LoRaSerial.read();  /* flush stale bytes */

    Serial.print("[AT>>] "); Serial.println(cmd);
    LoRaSerial.println(cmd);
    LoRaSerial.flush();

    uint32_t deadline = millis() + timeoutMs;
    String   buf      = "";
    bool     found    = false;

    while (millis() < deadline) {
        while (LoRaSerial.available()) {
            char c = (char)LoRaSerial.read();
            if (c == '\n') {
                buf.trim();
                if (buf.length() > 0) {
                    Serial.print("[AT<<] "); Serial.println(buf);
                    if (expectStr && buf.indexOf(expectStr) >= 0) found = true;
                }
                buf = "";
            } else if (c != '\r') {
                buf += c;
            }
        }
        if (found) break;
        yield();
    }
    if (!found) {
        Serial.print("[AT] timeout waiting for: ");
        Serial.println(expectStr ? expectStr : "(any)");
    }
    return found;
}

/** Enter RX mode (AT+TEST=RXLRPKT), then read for up to windowMs.
 *  If a "+TEST: RX \"hex\"" line is received, copy hex into hexOut
 *  and return true.  Exits early on match. */
static bool p2pRxWindow(uint32_t windowMs, String &hexOut)
{
    /* Enter RX mode — don't block long waiting for confirmation */
    LoRaSerial.println("AT+TEST=RXLRPKT");
    LoRaSerial.flush();
    Serial.println("[P2P] RX window open");

    uint32_t deadline = millis() + windowMs;
    String   buf      = "";
    bool     found    = false;

    while (millis() < deadline) {
        while (LoRaSerial.available()) {
            char c = (char)LoRaSerial.read();
            if (c == '\n') {
                buf.trim();
                if (buf.length() > 0) {
                    Serial.print("[P2P<<] "); Serial.println(buf);

                    /* +TEST: RX "AABB..." — payload line */
                    if (buf.indexOf("+TEST: RX") >= 0) {
                        int q1 = buf.indexOf('"');
                        int q2 = buf.lastIndexOf('"');
                        if (q1 >= 0 && q2 > q1) {
                            hexOut = buf.substring(q1 + 1, q2);
                            hexOut.toUpperCase();
                            found = true;
                        }
                    }
                }
                buf = "";
            } else if (c != '\r') {
                buf += c;
            }
        }
        if (found) break;
        yield();
    }

    /* Interrupt RX mode so we can TX next cycle */
    Serial.println("[P2P] RX window close");
    LoRaSerial.println("AT");
    LoRaSerial.flush();
    /* drain AT response */
    uint32_t t = millis();
    while (millis() - t < 200) {
        while (LoRaSerial.available()) LoRaSerial.read();
        yield();
    }
    return found;
}

/** Transmit a P2P packet.  hexStr must be uppercase hex without quotes.
 *  Waits up to AT_TX_MS for +TEST: TXLRPKT confirmation. */
static bool p2pTx(const char *hexStr)
{
    char cmd[48];
    snprintf(cmd, sizeof(cmd), "AT+TEST=TXLRPKT,\"%s\"", hexStr);
    return atSend(cmd, "+TEST: TXLRPKT", AT_TX_MS);
}

/* ════════════════════════════════════════════════════════════════════
   setup()
   ════════════════════════════════════════════════════════════════════ */
void setup()
{
    Serial.begin(115200);
    while (!Serial && millis() < 3000) {}

    /* LED */
    pinMode(LED_PIN, OUTPUT);
    LED_OFF();

    Serial.println("\n[BOOT] ESP32-C3 Wio-E5 P2P Node");

    LoRaSerial.begin(LORA_BAUD, SERIAL_8N1, PIN_LORA_RX, PIN_LORA_TX);
    delay(500);

    /* 1. Ping */
    Serial.println("[INIT] Pinging Wio-E5…");
    if (!atSend("AT", "OK", AT_INIT_MS))
        atSend("AT", "OK", AT_INIT_MS);   /* retry once */
    delay(200);

    /* 2. Enter P2P TEST mode */
    Serial.println("[INIT] Entering TEST mode…");
    if (!atSend("AT+MODE=TEST", "+MODE: TEST", AT_INIT_MS)) {
        delay(500);
        atSend("AT+MODE=TEST", "+MODE: TEST", AT_INIT_MS);
    }
    delay(300);

    /* 3. Configure RF */
    char rfcfg[80];
    snprintf(rfcfg, sizeof(rfcfg),
             "AT+TEST=RFCFG,%d,%s,%d,%d,%d,%d,ON,OFF,OFF",
             P2P_FREQ, P2P_SF, P2P_BW, P2P_TXPR, P2P_RXPR, P2P_POW);
    Serial.print("[INIT] RF: "); Serial.println(rfcfg);
    if (!atSend(rfcfg, "+TEST: RFCFG", AT_INIT_MS))
        Serial.println("[WARN] RF config not confirmed — continuing");
    delay(300);

    g_inited = true;
    g_state  = ST_JOINING;
    Serial.println("[INIT] Ready — starting JOIN phase");
}

/* ════════════════════════════════════════════════════════════════════
   loop()
   ════════════════════════════════════════════════════════════════════ */
void loop()
{
    if (!g_inited) return;

    /* ── JOINING state ────────────────────────────────────────────── */
    if (g_state == ST_JOINING) {
        /* Build JOIN_REQUEST: [0xFF, nodeId, seq] */
        char hexStr[7];
        snprintf(hexStr, sizeof(hexStr), "%02X%02X%02X",
                 PKT_JOIN_REQ, NODE_ID, g_seq++);

        Serial.print("[JOIN] TX JOIN_REQUEST seq=");
        Serial.print(g_seq - 1);
        Serial.print(" payload=");
        Serial.println(hexStr);

        if (!p2pTx(hexStr)) {
            Serial.println("[JOIN] TX JOIN_REQUEST failed");
        }

        /* Listen for JOIN_ACCEPT [0xFE, nodeId] */
        String rxHex = "";
        bool got = p2pRxWindow(RX_WINDOW_MS, rxHex);

        if (got && rxHex.length() >= 4) {
            uint8_t type = (uint8_t)strtoul(rxHex.substring(0, 2).c_str(), NULL, 16);
            uint8_t nid  = (uint8_t)strtoul(rxHex.substring(2, 4).c_str(), NULL, 16);
            if (type == PKT_JOIN_ACK && nid == NODE_ID) {
                Serial.println("[JOIN] JOIN_ACCEPT received! → DATA state");
                /* Flash LED 3x to signal join OK */
                for (int i = 0; i < 3; i++) {
                    LED_ON();  delay(150);
                    LED_OFF(); delay(150);
                }
                g_state = ST_DATA;
                g_seq   = 0;
            } else {
                Serial.print("[JOIN] Unexpected packet type=0x");
                Serial.println(type, HEX);
            }
        } else {
            Serial.println("[JOIN] No JOIN_ACCEPT in RX window — retrying");
        }
        return;   /* next loop() call = next TX/RX cycle */
    }

    /* ── DATA state ───────────────────────────────────────────────── */
    if (g_state == ST_DATA) {
        /* Read sensors */
        float tempC  = temperatureRead();
        float humPct = 60.0f + 20.0f * sinf((float)millis() / 60000.0f * 2.0f * 3.14159f);

        int16_t  tempI = (int16_t)(tempC  * 100.0f);
        uint16_t humI  = (uint16_t)(humPct * 100.0f);

        /* Build SENSOR_DATA: [0x01, nodeId, seq, tHi, tLo, hHi, hLo, led] (8 B) */
        char hexStr[17];
        snprintf(hexStr, sizeof(hexStr), "%02X%02X%02X%02X%02X%02X%02X%02X",
                 PKT_SENSOR, NODE_ID, g_seq++,
                 (uint8_t)((tempI >> 8) & 0xFF), (uint8_t)(tempI & 0xFF),
             (uint8_t)((humI  >> 8) & 0xFF), (uint8_t)(humI  & 0xFF),
             g_ledOn ? 0x01 : 0x00);

        Serial.print("[DATA] TX seq=");
        Serial.print(g_seq - 1);
        Serial.print(" temp=");
        Serial.print(tempC, 2);
        Serial.print("C hum=");
        Serial.print(humPct, 2);
        Serial.print("% payload=");
        Serial.println(hexStr);

        if (!p2pTx(hexStr)) {
            Serial.println("[DATA] TX SENSOR_DATA failed");
        }

        /* RX window: listen for LED command */
        String rxHex = "";
        bool got = p2pRxWindow(RX_WINDOW_MS, rxHex);

        if (got && rxHex.length() >= 2) {
            uint8_t type = (uint8_t)strtoul(rxHex.substring(0, 2).c_str(), NULL, 16);
            if (type == PKT_LED_ON) {
                g_ledOn = true;
                LED_ON();
                Serial.println("[LED] ON");
            } else if (type == PKT_LED_OFF) {
                g_ledOn = false;
                LED_OFF();
                Serial.println("[LED] OFF");
            } else {
                Serial.print("[DATA] Received type=0x");
                Serial.println(type, HEX);
            }
        }
        return;   /* next loop() call = next TX/RX cycle */
    }
}
