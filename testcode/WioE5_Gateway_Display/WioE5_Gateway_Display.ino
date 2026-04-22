/*
 * WioE5_Gateway_Display.ino
 *
 * Arduino Uno R4 WiFi — LoRaWAN downlink display demo
 *
 * Hardware:
 *   - Arduino Uno R4 WiFi (onboard 12×8 LED matrix)
 *   - Seeed Studio WioE5 (or RAK3172) LoRa module on Serial1
 *     Wiring: WioE5 TX → Uno R4 RX (pin D0)
 *             WioE5 RX → Uno R4 TX (pin D1)
 *             WioE5 GND → GND
 *             WioE5 3V3 → 3V3
 *
 * Payload convention (1 byte = command):
 *   0x00  — all LEDs off
 *   0x01  — all LEDs on
 *   0x02  — blink animation
 *   0x03  — scroll "HI" message
 *   0x10  — display number (second byte = 0–9)
 *   0x20  — show heart icon
 *   0x21  — show check-mark icon
 *   0x22  — show X (error) icon
 *
 * Network:
 *   OTAA join with credentials defined below.
 *   After join, polls for downlinks every POLL_INTERVAL_MS.
 *   Async +EVT:RX1 / +EVT:RX2 lines are also parsed.
 *
 * Tested with WioE5 firmware v4.0.11 / RAK3172 RUI3.
 */

#include "Arduino_LED_Matrix.h"   // Uno R4 WiFi built-in matrix

// ─── LoRaWAN OTAA credentials ───────────────────────────────────────────────
// Paste your TTN / ChirpStack credentials here
static const char DEVEUI[]  = "0011223344556677";
static const char APPEUI[]  = "0000000000000001";
static const char APPKEY[]  = "00112233445566778899AABBCCDDEEFF";

static const int  LORA_BAND       = 8;    // 8 = AS923 — change for your region
static const char LORA_CLASS[]    = "A";
static const int  LORA_DR         = 3;
static const int  LORA_PORT       = 2;    // uplink/downlink port

// ─── Timing ──────────────────────────────────────────────────────────────────
static const unsigned long JOIN_TIMEOUT_MS   = 30000UL;
static const unsigned long CMD_TIMEOUT_MS    = 5000UL;
static const unsigned long POLL_INTERVAL_MS  = 15000UL;  // poll downlink every 15 s
static const unsigned long BLINK_PERIOD_MS   = 500UL;

// ─── Matrix bitmaps (12 columns × 8 rows, uint32_t[3]) ──────────────────────
//  Column 0 is the leftmost column.
//  Each uint32_t covers 32 bits of the flat 96-bit frame.

static const uint32_t FRAME_OFF[3]   = {0,         0,         0        };
static const uint32_t FRAME_ON[3]    = {0xFFFFFFFF,0xFFFFFFFF,0xFFFFFFFF};

static const uint32_t FRAME_HEART[3] = {
    0b00000000000000000000110011001100,
    0b11111100111111111111110000000000,
    0b00000000000000000000000000000000
};

static const uint32_t FRAME_CHECK[3] = {
    0b00000000000000000000000000000001,
    0b10000110000110000100001000010000,
    0b10000000000000000000000000000000
};

static const uint32_t FRAME_CROSS[3] = {
    0b10000010000100001000010000001000,
    0b01000010000100001000010000100001,
    0b00000000000000000000000000000000
};

// Digit bitmaps [0..9] — 5 columns wide, 7 rows tall, centred on the 12×8 matrix
// Stored as full 12×8 frames for simplicity
static const uint32_t FRAMES_DIGIT[10][3] = {
    /* 0 */ {0x3E222222, 0x3E000000, 0x00000000},
    /* 1 */ {0x0C080808, 0x08000000, 0x00000000},
    /* 2 */ {0x3E020218, 0x203E0000, 0x00000000},
    /* 3 */ {0x3E02021E, 0x023E0000, 0x00000000},
    /* 4 */ {0x22222222, 0x3E020200, 0x00000000},
    /* 5 */ {0x3E20203E, 0x023E0000, 0x00000000},
    /* 6 */ {0x3E20203E, 0x22220000, 0x00000000},
    /* 7 */ {0x3E020204, 0x08080000, 0x00000000},
    /* 8 */ {0x3E22223E, 0x22220000, 0x00000000},
    /* 9 */ {0x3E22223E, 0x02020000, 0x00000000}
};

// ─── Globals ──────────────────────────────────────────────────────────────────
ArduinoLEDMatrix matrix;

static bool  g_joined           = false;
static unsigned long g_last_poll = 0;

// Blink state
static bool  g_blinking         = false;
static bool  g_blink_state      = false;
static unsigned long g_blink_ts  = 0;

// ─── AT command helpers ───────────────────────────────────────────────────────

/** Flush all pending RX bytes */
static void lora_flush() {
    while (Serial1.available()) Serial1.read();
}

/**
 * Send an AT command and wait for a line containing `expect` (case-insensitive
 * prefix match) or until `timeout_ms` elapses.
 * Accepts both line-by-line OK responses and multi-line async events.
 *
 * @return true if the expected response was received.
 */
static bool lora_cmd(const char *cmd, const char *expect,
                     unsigned long timeout_ms = CMD_TIMEOUT_MS,
                     char *resp_buf = nullptr, size_t resp_buf_len = 0)
{
    Serial1.println(cmd);
    Serial.print("[TX] "); Serial.println(cmd);

    unsigned long deadline = millis() + timeout_ms;
    String line;
    while (millis() < deadline) {
        if (Serial1.available()) {
            char c = (char)Serial1.read();
            if (c == '\n') {
                line.trim();
                if (line.length() > 0) {
                    Serial.print("[RX] "); Serial.println(line);
                }
                if (resp_buf && resp_buf_len > 0) {
                    strncpy(resp_buf, line.c_str(), resp_buf_len - 1);
                    resp_buf[resp_buf_len - 1] = '\0';
                }
                // Check if this line matches the expected response (case-insensitive)
                if (expect && (line.indexOf(expect) >= 0 || 
                              line.toUpperCase().indexOf(String(expect).toUpperCase()) >= 0)) {
                    return true;
                }
                line = "";
            } else if (c != '\r') {
                line += c;
            }
        }
    }
    return false;
}

/** Read one unsolicited line from the module (non-blocking, returns "" if none) */
static String lora_read_line_nb() {
    static String buf;
    while (Serial1.available()) {
        char c = (char)Serial1.read();
        if (c == '\n') {
            String out = buf;
            out.trim();
            buf = "";
            return out;
        } else if (c != '\r') {
            buf += c;
        }
    }
    return "";
}

// ─── LoRaWAN setup ───────────────────────────────────────────────────────────

static bool lora_configure() {
    Serial.println("=== Configuring LoRa module ===");
    lora_flush();

    // Query version — simple connectivity check
    if (!lora_cmd("AT+VER=?", "OK", 2000)) {
        Serial.println("Module not responding");
        return false;
    }

    // Set LoRaWAN region
    {
        char buf[32];
        snprintf(buf, sizeof(buf), "AT+BAND=%d", LORA_BAND);
        if (!lora_cmd(buf, "OK")) return false;
    }

    // Set class
    {
        char buf[32];
        snprintf(buf, sizeof(buf), "AT+CLASS=%s", LORA_CLASS);
        if (!lora_cmd(buf, "OK")) return false;
    }

    // OTAA mode
    if (!lora_cmd("AT+NJM=1", "OK")) return false;

    // Credentials
    {
        char buf[80];
        snprintf(buf, sizeof(buf), "AT+DEVEUI=%s", DEVEUI);
        if (!lora_cmd(buf, "OK")) return false;
        snprintf(buf, sizeof(buf), "AT+APPEUI=%s", APPEUI);
        if (!lora_cmd(buf, "OK")) return false;
        snprintf(buf, sizeof(buf), "AT+APPKEY=%s", APPKEY);
        if (!lora_cmd(buf, "OK")) return false;
    }

    // Data rate & ADR
    {
        char buf[32];
        snprintf(buf, sizeof(buf), "AT+DR=%d", LORA_DR);
        lora_cmd(buf, "OK");
    }
    lora_cmd("AT+ADR=0", "OK");

    Serial.println("=== Configuration OK ===");
    return true;
}

static bool lora_join() {
    Serial.println("=== Joining network (OTAA) ===");

    // AT+JOIN=1:0:10:8 — join once, auto-retry 8 times, 10 s interval
    // WioE5 responds with either +EVT:JOINED or +JOIN:joined depending on firmware variant
    if (!lora_cmd("AT+JOIN=1:0:10:8", "+EVT", JOIN_TIMEOUT_MS)) {
        // Also try plain OK or JOIN event without +EVT prefix
        lora_flush();
        if (!lora_cmd("AT+JOIN=1:0:10:8", "OK", JOIN_TIMEOUT_MS)) {
            Serial.println("Join failed or timed out");
            return false;
        }
    }
    Serial.println("=== JOINED ===");
    return true;
}

// ─── Downlink payload handler ─────────────────────────────────────────────────

/**
 * Parse a "+EVT:RX1:<port>:<len>:<hex_payload>" or "+RECV:<port>:<hex_payload>"
 * line and execute the LED matrix command encoded in the first byte.
 */
static void handle_downlink(const String &line) {
    // Locate a colon-delimited payload field
    // Accepted formats:
    //   +EVT:RX1:<port>:<len>:<HEX>
    //   +EVT:RX2:<port>:<len>:<HEX>
    //   +RECV:<port>:<HEX>
    int last_colon = line.lastIndexOf(':');
    if (last_colon < 0) return;

    String hex = line.substring(last_colon + 1);
    hex.trim();
    if (hex.length() < 2) return; // need at least 1 byte

    Serial.print("[DOWNLINK] hex="); Serial.println(hex);

    // Convert first hex byte
    char byte_str[3] = {hex[0], hex[1], '\0'};
    uint8_t cmd = (uint8_t)strtoul(byte_str, nullptr, 16);

    // Second byte (optional)
    uint8_t param = 0;
    if (hex.length() >= 4) {
        char p[3] = {hex[2], hex[3], '\0'};
        param = (uint8_t)strtoul(p, nullptr, 16);
    }

    g_blinking = false; // cancel blink unless command sets it

    switch (cmd) {
        case 0x00:
            matrix.loadFrame(FRAME_OFF);
            Serial.println("[MATRIX] Off");
            break;

        case 0x01:
            matrix.loadFrame(FRAME_ON);
            Serial.println("[MATRIX] On");
            break;

        case 0x02:
            g_blinking = true;
            g_blink_state = true;
            g_blink_ts = millis();
            matrix.loadFrame(FRAME_ON);
            Serial.println("[MATRIX] Blink");
            break;

        case 0x03:
            // "HI" scroll — use built-in text renderer
            matrix.beginDraw();
            matrix.stroke(0xFFFFFFFF);
            matrix.textScrollSpeed(100);
            matrix.textFont(Font_4x6);
            matrix.beginText(0, 1);
            matrix.println(" HI");
            matrix.endText(SCROLL_LEFT);
            matrix.endDraw();
            Serial.println("[MATRIX] Scroll HI");
            break;

        case 0x10:
            if (param <= 9) {
                matrix.loadFrame(FRAMES_DIGIT[param]);
                Serial.print("[MATRIX] Digit "); Serial.println(param);
            }
            break;

        case 0x20:
            matrix.loadFrame(FRAME_HEART);
            Serial.println("[MATRIX] Heart");
            break;

        case 0x21:
            matrix.loadFrame(FRAME_CHECK);
            Serial.println("[MATRIX] Check");
            break;

        case 0x22:
            matrix.loadFrame(FRAME_CROSS);
            Serial.println("[MATRIX] Cross");
            break;

        default:
            Serial.print("[MATRIX] Unknown command 0x");
            Serial.println(cmd, HEX);
            break;
    }
}

// ─── Arduino lifecycle ────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    while (!Serial && millis() < 3000) {}  // wait up to 3 s for Serial monitor

    Serial1.begin(115200);  // WioE5 / RAK3172 default baud

    matrix.begin();
    matrix.loadFrame(FRAME_OFF);

    // Show "connecting" pattern — alternating columns
    const uint32_t wait_frame[3] = {0xAAAAAAAA, 0xAAAAAAAA, 0xAAAAAAAA};
    matrix.loadFrame(wait_frame);

    // Configure and join
    if (!lora_configure()) {
        // Show cross — configuration failed
        matrix.loadFrame(FRAME_CROSS);
        Serial.println("FATAL: module configuration failed — halting");
        while (true) delay(1000);
    }

    if (!lora_join()) {
        matrix.loadFrame(FRAME_CROSS);
        Serial.println("FATAL: LoRa join failed — halting");
        while (true) delay(1000);
    }

    g_joined = true;

    // Send a test uplink so the server knows we are alive
    // Payload 0xAA = initial status
    {
        char buf[32];
        snprintf(buf, sizeof(buf), "AT+SEND=%d:01:AA", LORA_PORT);
        lora_cmd(buf, "OK", 10000UL);
    }

    matrix.loadFrame(FRAME_CHECK);  // show check — joined
    delay(2000);
    matrix.loadFrame(FRAME_OFF);

    g_last_poll = millis();
}

void loop() {
    // ── 1. Handle blink animation ────────────────────────────────────────────
    if (g_blinking && (millis() - g_blink_ts >= BLINK_PERIOD_MS)) {
        g_blink_state = !g_blink_state;
        matrix.loadFrame(g_blink_state ? FRAME_ON : FRAME_OFF);
        g_blink_ts = millis();
    }

    // ── 2. Parse async unsolicited lines from module ─────────────────────────
    String async_line = lora_read_line_nb();
    if (async_line.length() > 0) {
        Serial.print("[ASYNC] "); Serial.println(async_line);
        if (async_line.indexOf("+EVT:RX") >= 0 ||
            async_line.indexOf("+RECV:")  >= 0) {
            handle_downlink(async_line);
        } else if (async_line.indexOf("+EVT:JOIN_FAILED") >= 0) {
            g_joined = false;
            matrix.loadFrame(FRAME_CROSS);
            Serial.println("Join lost — will retry on next poll");
        }
    }

    if (!g_joined) return;

    // ── 3. Periodic downlink poll (AT+RECV=?) ────────────────────────────────
    if (millis() - g_last_poll >= POLL_INTERVAL_MS) {
        g_last_poll = millis();

        char resp[128] = {0};
        if (lora_cmd("AT+RECV=?", "+RECV:", CMD_TIMEOUT_MS, resp, sizeof(resp))) {
            String resp_str(resp);
            // Strip "OK" acknowledgement lines; look for the data line
            if (resp_str.indexOf(":") > 0) {
                handle_downlink(resp_str);
            }
        }

        // Send a keepalive uplink every poll interval
        // Payload 0xBB = "I am alive"
        {
            char buf[32];
            snprintf(buf, sizeof(buf), "AT+SEND=%d:01:BB", LORA_PORT);
            lora_cmd(buf, "OK", 10000UL);
        }
    }
}
