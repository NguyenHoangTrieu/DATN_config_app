/**
 * uno_r4_lora_bandwidth.ino
 *
 * Target  : Arduino Uno R4 WiFi + Seeed WioE5 (LoRa-E5)
 * Role    : LoRaWAN OTAA Class C — Bandwidth Test Node
 *
 * ─── Protocol ─────────────────────────────────────────────────────
 * Uplink Payloads (fPort=1):
 *   0xC1 0x01        — report: TX flood active
 *   0xC1 0x00        — report: TX flood stopped
 *   0xC2 LL LL HH HH — stats: bytesRx(u16LE) bytesTx(u16LE)
 *   0xDD [N bytes]   — data payload for bandwidth uplink
 *
 * Downlink Payloads:
 *   0xC1 0x01        — start TX flood
 *   0xC1 0x00        — stop TX flood
 *   0xC3 0x01        — request stats (device replies 0xC2)
 *   0xDD [N bytes]   — data payload for bandwidth downlink
 *
 * ─── Uplink Sizes ─────────────────────────────────────────────────
 * DR0 (SF12/125kHz): max 51 bytes, slow
 * DR3 (SF9/125kHz) : max 115 bytes, moderate
 * DR5 (SF7/125kHz) : max 242 bytes, fastest
 *
 * ─── Hardware ─────────────────────────────────────────────────────
 * WioE5 TX → Arduino D1 (Serial1 RX)
 * WioE5 RX → Arduino D0 (Serial1 TX)
 * LED Matrix (built-in) for status display
 *
 * ─── Board Settings ──────────────────────────────────────────────
 * Board: Arduino UNO R4 WiFi
 */

#include "Arduino_LED_Matrix.h"

ArduinoLEDMatrix matrix;

// ─── LoRa keys (change for your deployment) ──────────────────────
#define APP_EUI  "0000000000000000"
#define DEV_EUI  "DA2DA2DA2DA2BW01"
#define APP_KEY  "DA2DA2DA2DA2DA2DA2DA2DA2DA2DAAAA"
#define DR_DEFAULT 3  // SF9/125kHz, max ~115 bytes
#define TX_PORT 1

// ─── State ────────────────────────────────────────────────────────
volatile bool txFloodActive = false;
uint32_t bytesRx       = 0;
uint32_t bytesTx       = 0;
uint32_t packetsRx     = 0;
uint32_t packetsTx     = 0;
uint32_t lastTx        = 0;
uint32_t lastLog       = 0;
bool     joined        = false;

#define TX_INTERVAL_MS   5000  // LoRa limited by airtime/duty cycle
#define TX_PAYLOAD_SIZE  50    // bytes per uplink in flood mode

// ─── LED Matrix Icons ─────────────────────────────────────────────
const uint32_t ICON_IDLE[] = {
  0x01C05020,
  0x88040204,
  0x0A0603C0
};
const uint32_t ICON_FLOOD[] = {
  0xFF93F93F,
  0x93F93FF9,
  0x3F93F9FF
};
const uint32_t ICON_WAIT[] = {
  0x30060030,
  0x00C00060,
  0x0C003000
};

// ─── WioE5 communication ─────────────────────────────────────────
String sendAT(const String &cmd, uint16_t timeout = 3000) {
  while (Serial1.available()) Serial1.read();
  Serial1.println(cmd);
  Serial.print("> "); Serial.println(cmd);
  String resp = "";
  unsigned long start = millis();
  while (millis() - start < timeout) {
    while (Serial1.available()) {
      char c = (char)Serial1.read();
      resp += c;
    }
    if (resp.indexOf("+JOIN: Done") >= 0  ||
        resp.indexOf("+JOIN: Join failed") >= 0  ||
        resp.indexOf("+MSG: Done") >= 0  ||
        resp.indexOf("+MSGHEX: Done") >= 0  ||
        resp.indexOf("+CMSGHEX: Done") >= 0  ||
        resp.indexOf("+CMSG: Done") >= 0  ||
        resp.indexOf("+ID:") >= 0  ||
        resp.indexOf("+DR:") >= 0  ||
        resp.indexOf("+PORT:") >= 0  ||
        resp.indexOf("+CLASS:") >= 0  ||
        resp.indexOf("+MODE:") >= 0) {
      break;
    }
  }
  resp.trim();
  Serial.print("< "); Serial.println(resp);
  return resp;
}

// ─── Parse downlink from WioE5 async ─────────────────────────────
// +EVT:RX:<port>:<hex_payload>
// or embedded in +CMSG: RXWIN... +CMSG: PORT:... +CMSG: RX: <hex>
void processDownlink(const String &hexPayload) {
  int len = hexPayload.length() / 2;
  if (len < 2) return;

  uint8_t b0 = strtoul(hexPayload.substring(0, 2).c_str(), NULL, 16);
  uint8_t b1 = strtoul(hexPayload.substring(2, 4).c_str(), NULL, 16);

  bytesRx += len;
  packetsRx++;

  if (b0 == 0xC1 && b1 == 0x01) {
    txFloodActive = true;
    bytesTx = 0; packetsTx = 0;
    bytesRx = len; packetsRx = 1;
    Serial.println("DL: TX flood START");
  } else if (b0 == 0xC1 && b1 == 0x00) {
    txFloodActive = false;
    Serial.println("DL: TX flood STOP");
  } else if (b0 == 0xC3 && b1 == 0x01) {
    Serial.println("DL: Stats requested → sending");
    sendStats();
  } else if (b0 == 0xDD) {
    // data payload for downlink bandwidth measurement
    Serial.printf("DL: Data %d bytes\n", len);
  }
}

// ─── Send stats uplink ──────────────────────────────────────────
void sendStats() {
  char hex[20];
  uint16_t rx16 = (uint16_t)(bytesRx & 0xFFFF);
  uint16_t tx16 = (uint16_t)(bytesTx & 0xFFFF);
  snprintf(hex, sizeof(hex), "C2%02X%02X%02X%02X",
           (rx16 & 0xFF), ((rx16 >> 8) & 0xFF),
           (tx16 & 0xFF), ((tx16 >> 8) & 0xFF));
  String cmd = "AT+CMSGHEX=\"" + String(hex) + "\"";
  sendAT(cmd, 8000);
}

// ─── Send flood uplink ──────────────────────────────────────────
void sendFloodPacket() {
  String hex = "DD";
  for (int i = 1; i < TX_PAYLOAD_SIZE; i++) {
    char h[3];
    snprintf(h, sizeof(h), "%02X", (uint8_t)(packetsTx & 0xFF));
    hex += String(h);
  }
  String cmd = "AT+CMSGHEX=\"" + hex + "\"";
  String resp = sendAT(cmd, 10000);
  bytesTx += TX_PAYLOAD_SIZE;
  packetsTx++;

  // Check for embedded downlink in response
  int rxIdx = resp.indexOf("RX: \"");
  if (rxIdx >= 0) {
    int start = rxIdx + 5;
    int end = resp.indexOf("\"", start);
    if (end > start) {
      processDownlink(resp.substring(start, end));
    }
  }
}

// ─── Read and process async events from WioE5 ───────────────────
String serialBuf1 = "";
void pollWioE5() {
  while (Serial1.available()) {
    char c = (char)Serial1.read();
    serialBuf1 += c;
    if (c == '\n') {
      serialBuf1.trim();
      if (serialBuf1.length() > 0) {
        Serial.print("[WioE5] "); Serial.println(serialBuf1);

        // Check for async RX event
        int rxIdx = serialBuf1.indexOf("+EVT:RX:");
        if (rxIdx < 0) rxIdx = serialBuf1.indexOf("RX: \"");
        if (rxIdx >= 0) {
          // Extract hex after last colon or quote
          int hStart = serialBuf1.lastIndexOf(':');
          if (hStart < 0) hStart = serialBuf1.lastIndexOf('"');
          if (hStart >= 0) {
            String hexPart = serialBuf1.substring(hStart + 1);
            hexPart.trim();
            hexPart.replace("\"", "");
            if (hexPart.length() >= 4) {
              processDownlink(hexPart);
            }
          }
        }
      }
      serialBuf1 = "";
    }
  }
}

// ─── Serial commands from PC ─────────────────────────────────────
void handleSerial(const String &cmd) {
  String c = cmd;
  c.trim();
  c.toUpperCase();

  if (c == "START") {
    txFloodActive = true;
    bytesRx = bytesTx = packetsRx = packetsTx = 0;
    Serial.println("TX flood started (manual)");
  } else if (c == "STOP") {
    txFloodActive = false;
    Serial.printf("Stopped. RX=%lu TX=%lu\n",
                  (unsigned long)bytesRx, (unsigned long)bytesTx);
  } else if (c == "STATUS") {
    Serial.printf("Active=%d Joined=%d RX=%lu(%lu) TX=%lu(%lu)\n",
                  txFloodActive, joined,
                  (unsigned long)bytesRx, (unsigned long)packetsRx,
                  (unsigned long)bytesTx, (unsigned long)packetsTx);
  } else if (c == "RESET") {
    bytesRx = bytesTx = packetsRx = packetsTx = 0;
    Serial.println("Counters reset");
  } else if (c == "STATS") {
    sendStats();
  } else if (c.startsWith("AT+") || c.startsWith("AT ")) {
    sendAT(c, 5000);
  } else if (c.length() > 0) {
    Serial.println("Commands: START STOP STATUS RESET STATS AT+...");
  }
}

// ─── Setup ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);  // WioE5 default baud

  delay(1000);
  Serial.println("\n=== LoRa Bandwidth Test — Uno R4 WiFi + WioE5 ===");
  matrix.begin();
  matrix.loadFrame(ICON_WAIT);

  // Configure WioE5
  sendAT("AT+MODE=LWOTAA", 2000);
  delay(200);
  sendAT("AT+ID=DevEui,\"" DEV_EUI "\"", 2000);
  delay(200);
  sendAT("AT+ID=AppEui,\"" APP_EUI "\"", 2000);
  delay(200);
  sendAT("AT+KEY=APPKEY,\"" APP_KEY "\"", 2000);
  delay(200);
  sendAT("AT+DR=" + String(DR_DEFAULT), 2000);
  delay(200);
  sendAT("AT+PORT=" + String(TX_PORT), 2000);
  delay(200);
  // Class C for continuous RX (better for downlink bandwidth)
  sendAT("AT+CLASS=C", 2000);
  delay(200);
  sendAT("AT+ADR=OFF", 2000);
  delay(200);

  // Join
  Serial.println("Joining LoRaWAN...");
  for (int attempt = 0; attempt < 5; attempt++) {
    String resp = sendAT("AT+JOIN", 15000);
    if (resp.indexOf("Done") >= 0 || resp.indexOf("joined") >= 0) {
      joined = true;
      Serial.println("Joined!");
      break;
    }
    Serial.printf("Join attempt %d failed, retrying...\n", attempt + 1);
    delay(5000);
  }

  if (joined) {
    matrix.loadFrame(ICON_IDLE);
    // Initial uplink
    sendAT("AT+CMSGHEX=\"AA01\"", 8000);
    delay(2000);
  } else {
    Serial.println("WARNING: Not joined, will retry.");
  }

  Serial.println("Commands: START STOP STATUS RESET STATS AT+...");
}

// ─── Loop ─────────────────────────────────────────────────────────
void loop() {
  // Serial from PC
  static String serBuf;
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (serBuf.length() > 0) { handleSerial(serBuf); serBuf = ""; }
    } else { serBuf += ch; }
  }

  // Poll WioE5 async events (Class C downlinks)
  pollWioE5();

  uint32_t now = millis();

  // TX flood
  if (joined && txFloodActive && (now - lastTx >= TX_INTERVAL_MS)) {
    lastTx = now;
    matrix.loadFrame(ICON_FLOOD);
    sendFloodPacket();

    // Brief visual feedback
    if (packetsTx % 2 == 0) matrix.loadFrame(ICON_FLOOD);
    else matrix.loadFrame(ICON_IDLE);
  }

  // Periodic log
  if (now - lastLog >= 5000) {
    lastLog = now;
    if (txFloodActive || bytesRx > 0 || bytesTx > 0) {
      Serial.printf("[BW] RX=%lu(%lu) TX=%lu(%lu)\n",
                    (unsigned long)bytesRx, (unsigned long)packetsRx,
                    (unsigned long)bytesTx, (unsigned long)packetsTx);
    }

    // Retry join if not joined
    if (!joined) {
      String resp = sendAT("AT+JOIN", 15000);
      if (resp.indexOf("Done") >= 0) {
        joined = true;
        matrix.loadFrame(ICON_IDLE);
      }
    }
  }

  delay(10);
}
