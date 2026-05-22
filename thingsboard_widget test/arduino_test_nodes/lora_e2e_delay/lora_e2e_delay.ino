/*
 * DA2 LoRa E2E Latency Test Node
 *
 * Hardware : ESP32-C3 + Wio-E5 LoRa module (UART1)
 * Purpose  : Transmit 8-byte LoRa P2P packets carrying an NTP-synced
 *            Unix timestamp (ms) every SEND_INTERVAL_MS.  The gateway
 *            receives the raw hex payload and forwards it to ThingsBoard
 *            as telemetry key "lora_data".  The e2e latency widget then
 *            decodes the bytes and computes:
 *              e2e_delay_ms = thingsboard_ts - node_ts_ms
 *
 * Packet format (8 bytes, little-endian):
 *   Byte 0-7 : uint64_t node_ts_ms  (Unix epoch in milliseconds)
 *
 * WiFi / NTP :
 *   SSID     = "Devil"
 *   Password = "hamhap7604"
 *   NTP pool = pool.ntp.org, time.google.com
 */

#include <Arduino.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include "time.h"

/* ---- WiFi / NTP ----------------------------------------------------
 *  Sync to the SAME NTP source as the ThingsBoard server (RPi running
 *  chrony). Point NTP_SERVER1 at the RPi LAN IP so node clock matches
 *  server clock within ~1 ms — required for meaningful e2e-delay numbers.
 * ------------------------------------------------------------------- */
#define WIFI_SSID        "Devil"
#define WIFI_PASS        "hamhap7604"
#define NTP_SERVER1      "192.168.1.100"     /* ← RPi ThingsBoard server LAN IP */
#define NTP_SERVER2      "time.google.com"  /* ← fallback                       */
#define NTP_GMT_OFFSET   0    /* UTC */
#define NTP_DAYLIGHT     0

/* ---- LoRa UART (Wio-E5) ------------------------------------------- */
#define LORA_UART_TX_PIN  22
#define LORA_UART_RX_PIN  23
#define LORA_BAUD         115200
#define LORA_BAUD_FALLBACK 9600

/* ---- RF config ------------------------------------------------------ */
/* Match the widget/gateway default Wio-E5 TEST-mode format exactly:
 * freq in MHz, numeric BW, and explicit CRC/IQ/NET flags.              */
#define RF_CFG_STR  "868,SF7,125,8,8,14,ON,OFF,OFF"

/* ---- Timing --------------------------------------------------------- */
#define SEND_INTERVAL_MS  3000UL
#define WIFI_TIMEOUT_MS  15000UL
#define NTP_SYNC_TIMEOUT_MS 20000UL
#define NTP_POLL_MS      200UL
#define NTP_PRIMARY_PROBE_MS 5000UL
#define AT_MODE_MS       5000UL
#define AT_RFCFG_MS      7000UL
#define AT_TX_MS         6000UL
#define REINIT_FAIL_STREAK 3UL

/* ---- Payload size (8 bytes = 16 hex chars) ------------------------- */
#define PAYLOAD_BYTES 8

HardwareSerial LoRaSerial(1);

static uint32_t g_loraBaud       = LORA_BAUD;
static bool     g_loraReady      = false;
static bool     g_uartStarted    = false;
static uint64_t g_ntpBaseMs      = 0;   /* Unix epoch ms at ntp_millis */
static uint32_t g_ntpMillis      = 0;   /* millis() when NTP was synced */
static bool     g_ntpSynced      = false;
static const char *g_ntpSyncLabel = "unsynced";
static const char *g_ntpSyncHost  = "";
static uint32_t g_lastSendMs     = 0;
static uint32_t g_packetsSent    = 0;
static uint32_t g_packetsFailed  = 0;
static uint32_t g_failStreak     = 0;

/* -------------------------------------------------------------------- */
/*  NTP helpers                                                          */
/* -------------------------------------------------------------------- */

static void stopWiFi(void) {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

static bool syncNTPFromServer(const char *server, const char *label, uint32_t timeoutMs) {
  struct tm info = {};
  uint32_t syncStart = millis();

  Serial.printf("[NTP] Trying %s (%s)", label, server);
  configTime(NTP_GMT_OFFSET, NTP_DAYLIGHT, server);

  while (!getLocalTime(&info, NTP_POLL_MS)) {
    if (millis() - syncStart > timeoutMs) {
      Serial.printf("\n[NTP] %s timeout after %lu ms\n",
                    label,
                    (unsigned long)(millis() - syncStart));
      return false;
    }
    delay(NTP_POLL_MS);
    Serial.print('.');
  }

  g_ntpSyncLabel = label;
  g_ntpSyncHost  = server;
  Serial.printf("\n[NTP] Sync source locked: %s (%s)\n", g_ntpSyncLabel, g_ntpSyncHost);
  return true;
}

static void syncNTP(void) {
  g_ntpSynced = false;
  g_ntpSyncLabel = "unsynced";
  g_ntpSyncHost  = "";

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  Serial.println("[NTP] Connecting to WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > WIFI_TIMEOUT_MS) {
      Serial.println("[NTP] WiFi timeout — will retry next boot");
      stopWiFi();
      return;
    }
    delay(300);
    Serial.print('.');
  }
  Serial.printf("\n[NTP] WiFi OK: %s  RSSI=%d dBm  GW=%s  DNS=%s\n",
                WiFi.localIP().toString().c_str(),
                WiFi.RSSI(),
                WiFi.gatewayIP().toString().c_str(),
                WiFi.dnsIP().toString().c_str());

  if (!syncNTPFromServer(NTP_SERVER1, "RPi", NTP_PRIMARY_PROBE_MS)) {
    Serial.printf("[NTP] Falling back to google.com (%s)\n", NTP_SERVER2);
    if (!syncNTPFromServer(NTP_SERVER2, "google.com", NTP_SYNC_TIMEOUT_MS)) {
      Serial.printf("[NTP] Sync failed after trying %s then %s (GW=%s DNS=%s)\n",
                    NTP_SERVER1,
                    NTP_SERVER2,
                    WiFi.gatewayIP().toString().c_str(),
                    WiFi.dnsIP().toString().c_str());
      stopWiFi();
      return;
    }
  }

  /* Record base: epoch seconds → ms, aligned to current millis() */
  time_t now_sec;
  time(&now_sec);
  g_ntpBaseMs  = (uint64_t)now_sec * 1000ULL;
  g_ntpMillis  = millis();
  g_ntpSynced  = true;

  Serial.printf("[NTP] Synced via %s (%s) — epoch_sec=%llu  millis=%lu\n",
                g_ntpSyncLabel,
                g_ntpSyncHost,
                (unsigned long long)now_sec, (unsigned long)g_ntpMillis);

  stopWiFi();
  delay(100);
  Serial.println("[NTP] WiFi disconnected");
}

/* Returns current Unix timestamp in milliseconds (NTP-aligned). */
static uint64_t currentMs(void) {
  if (!g_ntpSynced) return 0ULL;
  uint32_t elapsed = millis() - g_ntpMillis;
  return g_ntpBaseMs + (uint64_t)elapsed;
}

/* -------------------------------------------------------------------- */
/*  AT command helpers                                                   */
/* -------------------------------------------------------------------- */

static bool waitForResponseAny(const char *expectA, const char *expectB, uint32_t timeoutMs) {
  uint32_t t0 = millis();
  String line;
  while (millis() - t0 < timeoutMs) {
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
          if (line.indexOf("ERROR") >= 0) return false;
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
  if (g_uartStarted && g_loraBaud == baud) {
    Serial.printf("[BAUD] UART already at %lu\n", (unsigned long)baud);
    return;
  }

  Serial.printf("[BAUD] Reconfig start -> %lu (started=%d current=%lu)\n",
                (unsigned long)baud,
                g_uartStarted ? 1 : 0,
                (unsigned long)g_loraBaud);

  if (g_uartStarted) {
    LoRaSerial.end();
    delay(80);
  }

  Serial.printf("[BAUD] Begin UART -> %lu\n", (unsigned long)baud);
  LoRaSerial.begin(baud, SERIAL_8N1, LORA_UART_RX_PIN, LORA_UART_TX_PIN);
  delay(120);
  g_uartStarted = true;
  g_loraBaud = baud;
  Serial.printf("[BAUD] UART=%lu\n", (unsigned long)baud);
}

static bool pingAT(uint32_t timeoutMs) {
  return sendATAny("AT", "+AT: OK", "OK", timeoutMs);
}

/* Upgrade to 115200 if module is currently at 9600 */
static bool ensureBaudAndAT(void) {
  setLoraBaud(LORA_BAUD);
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
  setLoraBaud(LORA_BAUD);
  if (!pingAT(1500)) {
    Serial.println("[BAUD] Switch verify failed, fallback to 9600");
    setLoraBaud(LORA_BAUD_FALLBACK);
    if (!pingAT(1200)) return false;
  }
  return true;
}

static bool initLora(void) {
  if (!ensureBaudAndAT()) {
    Serial.println("[LORA] AT ping failed on both baud rates");
    return false;
  }
  if (!sendATAny("AT+MODE=TEST", "+MODE: TEST", "TEST", AT_MODE_MS)) {
    Serial.println("[LORA] Enter TEST mode failed");
    return false;
  }
  if (!sendATAny(String("AT+TEST=RFCFG,") + RF_CFG_STR,
                 "+TEST: RFCFG", "RFCFG", AT_RFCFG_MS)) {
    Serial.println("[LORA] RFCFG failed");
    return false;
  }
  return true;
}

/* -------------------------------------------------------------------- */
/*  Send one 8-byte timestamp packet                                     */
/* -------------------------------------------------------------------- */

static bool sendTimestampPacket(void) {
  uint64_t ts = currentMs();

  /* Pack little-endian into 8 bytes */
  uint8_t buf[PAYLOAD_BYTES];
  for (int i = 0; i < 8; i++) {
    buf[i] = (uint8_t)((ts >> (i * 8)) & 0xFF);
  }

  /* Build hex string */
  char hexStr[PAYLOAD_BYTES * 2 + 1];
  for (int i = 0; i < PAYLOAD_BYTES; i++) {
    snprintf(&hexStr[i * 2], 3, "%02X", buf[i]);
  }
  hexStr[PAYLOAD_BYTES * 2] = '\0';

  String cmd = "AT+TEST=TXLRPKT,\"";
  cmd += hexStr;
  cmd += "\"";

  Serial.printf("[LORA TX] ts_ms=%llu  hex=%s\n",
                (unsigned long long)ts, hexStr);

  return sendATAny(cmd, "TX DONE", "+TEST: TX DONE", AT_TX_MS);
}

/* -------------------------------------------------------------------- */
/*  Arduino entry points                                                 */
/* -------------------------------------------------------------------- */

void setup(void) {
  Serial.begin(115200);
  delay(1500);
  Serial.println("=== DA2 LoRa E2E Delay Node ===");

  /* Step 1: sync NTP over WiFi */
  syncNTP();
  if (!g_ntpSynced) {
    Serial.println("[WARN] No NTP — timestamps will be zero!");
  }

  /* Step 2: init LoRa module */
  for (int attempt = 1; attempt <= 3; attempt++) {
    Serial.printf("[LORA] Init attempt %d/3\n", attempt);
    if (initLora()) {
      g_loraReady = true;
      g_failStreak = 0;
      Serial.println("[LORA] Ready");
      break;
    }
    delay(1500);
  }
  if (!g_loraReady) {
    Serial.println("[LORA] Init failed — will retry in loop");
  }

  g_lastSendMs = millis();
}

void loop(void) {
  uint32_t now = millis();

  /* Re-init if not ready */
  if (!g_loraReady) {
    Serial.println("[LORA] Retrying init...");
    if (initLora()) {
      g_loraReady = true;
      g_failStreak = 0;
      Serial.println("[LORA] Ready");
    } else {
      delay(2000);
      return;
    }
  }

  /* Send every SEND_INTERVAL_MS */
  if (now - g_lastSendMs >= SEND_INTERVAL_MS) {
    g_lastSendMs = now;

    if (!g_ntpSynced) {
      Serial.println("[WARN] Skipping TX — NTP not synced");
      return;
    }

    if (sendTimestampPacket()) {
      g_packetsSent++;
      g_failStreak = 0;
    } else {
      g_packetsFailed++;
      g_failStreak++;
      if (g_failStreak >= REINIT_FAIL_STREAK) {
        g_loraReady = false;  /* trigger re-init on next pass */
        Serial.println("[LORA] Too many TX fails — will reinit");
      } else {
        Serial.println("[LORA] TX failed — keeping link and retrying");
      }
    }

    Serial.printf("[STAT] sent=%lu  failed=%lu  streak=%lu  baud=%lu\n",
                  (unsigned long)g_packetsSent,
                  (unsigned long)g_packetsFailed,
                  (unsigned long)g_failStreak,
                  (unsigned long)g_loraBaud);
  }
}
