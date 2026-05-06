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
#include <Wire.h>

/* ── Wiring ──────────────────────────────────────────────────────── */
#define PIN_LORA_RX   23       /* ESP32 RX ← Wio-E5 TX */
#define PIN_LORA_TX   22       /* ESP32 TX → Wio-E5 RX */
#define LORA_BAUD     115200

#define I2C_SDA_PIN   5
#define I2C_SCL_PIN   18
#define I2C_FREQ_HZ   100000UL
#define AHT20_I2C_ADDR 0x38
#define AHT20_STATUS_BUSY 0x80
#define AHT20_STATUS_CALIBRATED 0x08
#define AHT20_INIT_TIMEOUT_MS 500UL
#define AHT20_MEASURE_TIMEOUT_MS 200UL
#define AHT20_RECOVERY_DELAY_MS 10UL
#define AHT20_INIT_RETRY_INTERVAL_MS 2000UL
#define AHT20_VALID_TEMP_MIN_C -40.0f
#define AHT20_VALID_TEMP_MAX_C 85.0f
#define AHT20_VALID_HUMID_MIN_RH 0.0f
#define AHT20_VALID_HUMID_MAX_RH 100.0f

#define LED_PIN       2       /* built-in LED, active HIGH */
#define LED_ON()      digitalWrite(LED_PIN, HIGH)
#define LED_OFF()     digitalWrite(LED_PIN, LOW)

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
static bool      g_aht20Ready = false;
static uint32_t  g_i2cRecoveryCount = 0;
static unsigned long g_lastAht20InitAttemptMs = 0;

static const char *i2cErrorToString(uint8_t errorCode)
{
    switch (errorCode) {
        case 0: return "OK";
        case 1: return "DATA_TOO_LONG";
        case 2: return "NACK_ADDR";
        case 3: return "NACK_DATA";
        case 4: return "OTHER_ERROR";
        case 5: return "TIMEOUT";
        default: return "UNKNOWN";
    }
}

static void recoverI2CBus()
{
    pinMode(I2C_SDA_PIN, INPUT_PULLUP);
    pinMode(I2C_SCL_PIN, INPUT_PULLUP);
    delay(1);

    if (digitalRead(I2C_SDA_PIN) == HIGH && digitalRead(I2C_SCL_PIN) == HIGH) {
        return;
    }

    Serial.println("[I2C] Bus busy, attempting recovery pulses");
    pinMode(I2C_SDA_PIN, OUTPUT_OPEN_DRAIN);
    pinMode(I2C_SCL_PIN, OUTPUT_OPEN_DRAIN);
    digitalWrite(I2C_SDA_PIN, HIGH);

    for (uint8_t pulse = 0; pulse < 9; ++pulse) {
        digitalWrite(I2C_SCL_PIN, HIGH);
        delayMicroseconds(5);
        digitalWrite(I2C_SCL_PIN, LOW);
        delayMicroseconds(5);
    }

    digitalWrite(I2C_SDA_PIN, LOW);
    delayMicroseconds(5);
    digitalWrite(I2C_SCL_PIN, HIGH);
    delayMicroseconds(5);
    digitalWrite(I2C_SDA_PIN, HIGH);
    delayMicroseconds(5);

    pinMode(I2C_SDA_PIN, INPUT_PULLUP);
    pinMode(I2C_SCL_PIN, INPUT_PULLUP);
}

static bool aht20WriteCommand(const uint8_t *buffer, size_t length, const char *label)
{
    Wire.beginTransmission(AHT20_I2C_ADDR);
    size_t written = Wire.write(buffer, length);
    uint8_t errorCode = Wire.endTransmission(true);

    if (written != length || errorCode != 0) {
        Serial.printf("[AHT20] %s write failed: wrote=%u/%u err=%u (%s)\n",
                      label,
                      (unsigned int)written,
                      (unsigned int)length,
                      errorCode,
                      i2cErrorToString(errorCode));
        return false;
    }
    return true;
}

static bool aht20ReadBytes(uint8_t *buffer, size_t length, const char *label)
{
    size_t received = Wire.requestFrom((uint8_t)AHT20_I2C_ADDR, (uint8_t)length, (uint8_t)true);
    if (received != length) {
        Serial.printf("[AHT20] %s read failed: got=%u/%u\n",
                      label,
                      (unsigned int)received,
                      (unsigned int)length);
        while (Wire.available()) {
            (void)Wire.read();
        }
        return false;
    }

    for (size_t index = 0; index < length; ++index) {
        buffer[index] = (uint8_t)Wire.read();
    }
    return true;
}

static bool aht20ReadStatus(uint8_t &status)
{
    return aht20ReadBytes(&status, 1, "STATUS");
}

static bool validateAHT20Sample(float tempC, float humPct)
{
    if (isnan(tempC) || isnan(humPct)) {
        Serial.println("[AHT20] sample invalid: NaN");
        return false;
    }

    if (tempC < AHT20_VALID_TEMP_MIN_C || tempC > AHT20_VALID_TEMP_MAX_C ||
        humPct < AHT20_VALID_HUMID_MIN_RH || humPct > AHT20_VALID_HUMID_MAX_RH) {
        Serial.printf("[AHT20] sample out of range: temp=%.2fC humid=%.2f%%RH\n", tempC, humPct);
        return false;
    }
    return true;
}

static bool waitAHT20Ready(uint32_t timeoutMs)
{
    uint32_t startedAt = millis();
    uint8_t status = 0xFF;

    while ((millis() - startedAt) < timeoutMs) {
        if (!aht20ReadStatus(status)) {
            return false;
        }
        if ((status & AHT20_STATUS_BUSY) == 0) {
            return true;
        }
        delay(10);
    }

    Serial.printf("[AHT20] busy timeout, last status=0x%02X\n", status);
    return false;
}

static bool initAHT20(bool doBusRecovery)
{
    g_lastAht20InitAttemptMs = millis();

    Serial.printf("[AHT20] init start (recovery=%s) SDA=%d SCL=%d\n",
                  doBusRecovery ? "yes" : "no",
                  I2C_SDA_PIN,
                  I2C_SCL_PIN);

    if (doBusRecovery) {
        recoverI2CBus();
    }

    Wire.end();
    delay(2);

    if (!Wire.setPins(I2C_SDA_PIN, I2C_SCL_PIN)) {
        Serial.printf("[I2C] setPins failed on SDA=%d SCL=%d\n", I2C_SDA_PIN, I2C_SCL_PIN);
        return false;
    }

    if (!Wire.begin()) {
        Serial.printf("[I2C] begin failed on SDA=%d SCL=%d (default begin after setPins)\n", I2C_SDA_PIN, I2C_SCL_PIN);
        return false;
    }

    Wire.setClock(I2C_FREQ_HZ);
    Wire.setTimeOut(20);
    Wire.flush();
    Serial.println("[AHT20] init stage: bus started");
    delay(40);

    Wire.beginTransmission(AHT20_I2C_ADDR);
    uint8_t probeError = Wire.endTransmission(true);
    if (probeError != 0) {
        Serial.printf("[AHT20] probe failed at 0x%02X err=%u (%s)\n",
                      AHT20_I2C_ADDR,
                      probeError,
                      i2cErrorToString(probeError));
        return false;
    }
    Serial.println("[AHT20] init stage: probe ok");

    const uint8_t softReset = 0xBA;
    if (!aht20WriteCommand(&softReset, 1, "SOFTRESET")) {
        return false;
    }
    Serial.println("[AHT20] init stage: soft reset sent");
    delay(20);

    uint8_t status = 0xFF;
    if (!aht20ReadStatus(status)) {
        return false;
    }
    if ((status & AHT20_STATUS_BUSY) != 0 && !waitAHT20Ready(AHT20_INIT_TIMEOUT_MS)) {
        return false;
    }
    if (!aht20ReadStatus(status)) {
        return false;
    }

    if ((status & AHT20_STATUS_CALIBRATED) == 0) {
        const uint8_t calibrateCmd[3] = {0xE1, 0x08, 0x00};
        if (!aht20WriteCommand(calibrateCmd, sizeof(calibrateCmd), "CALIBRATE")) {
            return false;
        }
        if (!waitAHT20Ready(AHT20_INIT_TIMEOUT_MS)) {
            return false;
        }
        if (!aht20ReadStatus(status)) {
            return false;
        }
    }

    if ((status & AHT20_STATUS_CALIBRATED) == 0) {
        Serial.printf("[AHT20] init incomplete, status=0x%02X\n", status);
        return false;
    }

    Serial.printf("[AHT20] initialized on SDA=%d SCL=%d addr=0x%02X status=0x%02X\n",
                  I2C_SDA_PIN,
                  I2C_SCL_PIN,
                  AHT20_I2C_ADDR,
                  status);
    return true;
}

static bool ensureAHT20Ready()
{
    if (g_aht20Ready) {
        return true;
    }

    unsigned long now = millis();
    if (g_lastAht20InitAttemptMs != 0 &&
        (now - g_lastAht20InitAttemptMs) < AHT20_INIT_RETRY_INTERVAL_MS) {
        return false;
    }

    Serial.println("[AHT20] sensor not ready, attempting init");
    g_aht20Ready = initAHT20(false);
    if (!g_aht20Ready) {
        Serial.println("[AHT20] init attempt failed, will retry later");
    }
    return g_aht20Ready;
}

static bool recoverAHT20(const char *reason)
{
    Serial.printf("[I2C] Recovering AHT20 bus: %s\n", reason);
    g_aht20Ready = false;
    Wire.flush();
    Wire.end();
    delay(AHT20_RECOVERY_DELAY_MS);

    bool ok = initAHT20(true);
    g_aht20Ready = ok;
    if (ok) {
        g_i2cRecoveryCount++;
        Serial.printf("[I2C] Recovery #%lu successful\n", (unsigned long)g_i2cRecoveryCount);
    } else {
        Serial.println("[I2C] Recovery failed");
    }
    return ok;
}

static bool readAHT20Once(float &tempC, float &humPct)
{
    if (!g_aht20Ready) return false;

    const uint8_t triggerCmd[3] = {0xAC, 0x33, 0x00};
    if (!aht20WriteCommand(triggerCmd, sizeof(triggerCmd), "TRIGGER")) {
        return false;
    }
    if (!waitAHT20Ready(AHT20_MEASURE_TIMEOUT_MS)) {
        return false;
    }

    uint8_t data[6] = {0};
    if (!aht20ReadBytes(data, sizeof(data), "MEASURE")) {
        return false;
    }
    if ((data[0] & AHT20_STATUS_BUSY) != 0) {
        Serial.printf("[AHT20] measure returned busy status=0x%02X\n", data[0]);
        return false;
    }

    uint32_t rawHumidity = ((uint32_t)data[1] << 12) |
                           ((uint32_t)data[2] << 4) |
                           ((uint32_t)data[3] >> 4);
    uint32_t rawTemperature = ((uint32_t)(data[3] & 0x0F) << 16) |
                              ((uint32_t)data[4] << 8) |
                              data[5];

    humPct = (rawHumidity * 100.0f) / 1048576.0f;
    tempC = ((rawTemperature * 200.0f) / 1048576.0f) - 50.0f;
    return true;
}

static bool readAHT20(float &tempC, float &humPct)
{
    for (uint8_t attempt = 0; attempt < 2; ++attempt) {
        if (readAHT20Once(tempC, humPct) && validateAHT20Sample(tempC, humPct)) {
            return true;
        }

        if (attempt == 0 && recoverAHT20("transaction failure or invalid sample")) {
            continue;
        }
        break;
    }
    return false;
}

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

/** Send AT command, wait for either of two response markers.
 *  Useful when the module may return either "TX DONE" or "+TEST: TX DONE". */
static bool atSendAny(const char *cmd,
                      const char *expectA,
                      const char *expectB,
                      uint32_t timeoutMs)
{
    while (LoRaSerial.available()) LoRaSerial.read();

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
                    if ((expectA && buf.indexOf(expectA) >= 0) ||
                        (expectB && buf.indexOf(expectB) >= 0)) {
                        found = true;
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

    if (!found) {
        Serial.print("[AT] timeout waiting for: ");
        Serial.print(expectA ? expectA : "(null)");
        Serial.print(" | ");
        Serial.println(expectB ? expectB : "(null)");
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
 *  Waits for real TX completion, not just the echoed TXLRPKT command line. */
static bool p2pTx(const char *hexStr)
{
    char cmd[48];
    snprintf(cmd, sizeof(cmd), "AT+TEST=TXLRPKT,\"%s\"", hexStr);
    return atSendAny(cmd, "TX DONE", "+TEST: TX DONE", AT_TX_MS);
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
    Serial.println("[AHT20] Deferred init until runtime");

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
        float tempC = 0.0f;
        float humPct = 0.0f;
        if (!ensureAHT20Ready()) {
            Serial.println("[AHT20] not ready, skip TX cycle");
            return;
        }
        if (!readAHT20(tempC, humPct)) {
            Serial.println("[AHT20] read failed, skip TX cycle");
            return;
        }

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
