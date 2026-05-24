/*
 * DA2 LoRa E2E Latency Test Node
 *
 * Hardware : ESP32-C3 + Wio-E5 LoRa module (UART1)
 * Purpose  : Transmit 10-byte LoRa P2P packets carrying an NTP-synced
 *            Unix timestamp (ms) + 16-bit sequence number every
 *            SEND_INTERVAL_MS. The gateway receives the raw hex payload
 *            and forwards it to ThingsBoard as telemetry key "lora_data".
 *            The e2e latency widget then decodes the bytes and computes:
 *              e2e_delay_ms = thingsboard_ts - node_ts_ms
 *              loss_rate    = derived from gaps in seq
 *
 * Packet format (10 bytes, little-endian):
 *   Byte 0-7 : uint64_t node_ts_ms  (Unix epoch in milliseconds)
 *   Byte 8-9 : uint16_t seq         (monotonic, wraps at 65536 — for loss tracking)
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

/* ---- WiFi / NTP ---------------------------------------------------- */
#define WIFI_SSID        "Devil"
#define WIFI_PASS        "hamhap7604"
#define NTP_SERVER1      "pool.ntp.org"
#define NTP_SERVER2      "time.google.com"
#define NTP_GMT_OFFSET   0    /* UTC */
#define NTP_DAYLIGHT     0

/* ---- LoRa UART (Wio-E5) ------------------------------------------- */
#define LORA_UART_TX_PIN  5
#define LORA_UART_RX_PIN  6
#define LORA_BAUD         115200
#define LORA_BAUD_FALLBACK 9600

/* ---- RF config ------------------------------------------------------ */
/* 868 MHz, SF7, 125 kHz BW, preamble 8, FEC 4/5, 14 dBm             */
#define RF_CFG_STR  "868000000,SF7,125KHZ,8,8,14"

/* ---- Timing --------------------------------------------------------- */
#define SEND_INTERVAL_MS  3000UL
#define AT_TIMEOUT_MS     5000UL
#define WIFI_TIMEOUT_MS  15000UL

/* ---- Payload size (10 bytes = 20 hex chars) ------------------------- */
#define PAYLOAD_BYTES 10

HardwareSerial LoRaSerial(1);

static uint32_t g_loraBaud       = LORA_BAUD;
static bool     g_loraReady      = false;
static uint64_t g_ntpBaseMs      = 0;   /* Unix epoch ms at ntp_millis */
static uint32_t g_ntpMillis      = 0;   /* millis() when NTP was synced */
static bool     g_ntpSynced      = false;
static uint32_t g_lastSendMs     = 0;
static uint32_t g_packetsSent    = 0;
static uint32_t g_packetsFailed  = 0;

/* -------------------------------------------------------------------- */
/*  NTP helpers                                                          */
/* -------------------------------------------------------------------- */

static void syncNTP(void) {
  Serial.println("[NTP] Connecting to WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > WIFI_TIMEOUT_MS) {
      Serial.println("[NTP] WiFi timeout — will retry next boot");
      return;
    }
    delay(300);
    Serial.print('.');
  }
  Serial.printf("\n[NTP] WiFi connected: %s\n", WiFi.localIP().toString().c_str());

  configTime(NTP_GMT_OFFSET, NTP_DAYLIGHT, NTP_SERVER1, NTP_SERVER2);
  Serial.print("[NTP] Waiting for time sync");

  struct tm info;
  uint32_t deadline = millis() + 10000UL;
  while (!getLocalTime(&info)) {
    if (millis() > deadline) {
      Serial.println("\n[NTP] Sync failed");
      WiFi.disconnect(true);
      return;
    }
    delay(300);
    Serial.print('.');
  }

  /* Record base: epoch seconds → ms, aligned to current millis() */
  time_t now_sec;
  time(&now_sec);
  g_ntpBaseMs  = (uint64_t)now_sec * 1000ULL;
  g_ntpMillis  = millis();
  g_ntpSynced  = true;

  Serial.printf("\n[NTP] Synced — epoch_sec=%llu  millis=%lu\n",
                (unsigned long long)now_sec, (unsigned long)g_ntpMillis);

  WiFi.disconnect(true);
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

static bool waitFor(const char *expect, uint32_t timeoutMs) {
  uint32_t t0 = millis();
  String line;
  while (millis() - t0 < timeoutMs) {
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
    yield();
  }
  return false;
}

static bool sendAT(const String &cmd, const char *expect, uint32_t timeoutMs) {
  Serial.println("[AT TX] " + cmd);
  while (LoRaSerial.available()) LoRaSerial.read();
  LoRaSerial.println(cmd);
  LoRaSerial.flush();
  return waitFor(expect, timeoutMs);
}

static void setLoraBaud(uint32_t baud) {
  LoRaSerial.end();
  delay(80);
  LoRaSerial.begin(baud, SERIAL_8N1, LORA_UART_RX_PIN, LORA_UART_TX_PIN);
  delay(120);
  g_loraBaud = baud;
  Serial.printf("[UART] baud=%lu\n", (unsigned long)baud);
}

static bool pingOK(void) {
  return sendAT("AT\r\n", "+AT: OK", 1500);
}

/* Upgrade to 115200 if module is currently at 9600 */
static void tryUpgradeBaud(void) {
  setLoraBaud(LORA_BAUD);
  if (pingOK()) { Serial.println("[UART] Already at 115200"); return; }
  setLoraBaud(LORA_BAUD_FALLBACK);
  if (!pingOK()) { Serial.println("[UART] No response at 9600 either"); return; }
  sendAT("AT+UART=BR, 115200\r\n", "+UART:", 2000);
  setLoraBaud(LORA_BAUD);
  if (!pingOK()) {
    Serial.println("[UART] Upgrade failed, staying at 9600");
    setLoraBaud(LORA_BAUD_FALLBACK);
  }
}

static bool initLora(void) {
  tryUpgradeBaud();
  if (!pingOK())                                            return false;
  if (!sendAT("AT+MODE=TEST\r\n",   "+MODE: TEST",   AT_TIMEOUT_MS)) return false;
  if (!sendAT("AT+TEST=RFCFG," RF_CFG_STR "\r\n", "+TEST: RFCFG", AT_TIMEOUT_MS)) return false;
  return true;
}

/* -------------------------------------------------------------------- */
/*  Send one 8-byte timestamp packet                                     */
/* -------------------------------------------------------------------- */

static bool sendTimestampPacket(void) {
  uint64_t ts = currentMs();
  uint16_t seq = (uint16_t)(g_packetsSent & 0xFFFF);

  /* Pack little-endian: 8B ts_ms + 2B seq = 10B total */
  uint8_t buf[PAYLOAD_BYTES];
  for (int i = 0; i < 8; i++) {
    buf[i] = (uint8_t)((ts >> (i * 8)) & 0xFF);
  }
  buf[8] = (uint8_t)(seq        & 0xFF);
  buf[9] = (uint8_t)((seq >> 8) & 0xFF);

  /* Build hex string */
  char hexStr[PAYLOAD_BYTES * 2 + 1];
  for (int i = 0; i < PAYLOAD_BYTES; i++) {
    snprintf(&hexStr[i * 2], 3, "%02X", buf[i]);
  }
  hexStr[PAYLOAD_BYTES * 2] = '\0';

  String cmd = "AT+TEST=TXLRPKT,\"";
  cmd += hexStr;
  cmd += "\"\r\n";

  Serial.printf("[LORA TX] seq=%u  ts_ms=%llu  hex=%s\n",
                (unsigned)seq, (unsigned long long)ts, hexStr);

  return sendAT(cmd, "+TEST: TX DONE", AT_TIMEOUT_MS);
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
  LoRaSerial.begin(LORA_BAUD, SERIAL_8N1, LORA_UART_RX_PIN, LORA_UART_TX_PIN);
  delay(200);

  for (int attempt = 1; attempt <= 3; attempt++) {
    Serial.printf("[LORA] Init attempt %d/3\n", attempt);
    if (initLora()) {
      g_loraReady = true;
      Serial.println("[LORA] Ready");
      break;
    }
    delay(2000);
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
      Serial.println("[LORA] Ready");
    } else {
      delay(5000);
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
    } else {
      g_packetsFailed++;
      g_loraReady = false;  /* trigger re-init on next pass */
      Serial.println("[LORA] TX failed — will reinit");
    }

    Serial.printf("[STAT] sent=%lu  failed=%lu\n",
                  (unsigned long)g_packetsSent,
                  (unsigned long)g_packetsFailed);
  }
}
