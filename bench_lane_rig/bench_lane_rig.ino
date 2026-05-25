/*
 * bench_lane_rig.ino — Fake-data generator for LAN MCU lane ingress benchmark
 * Target board: ESP32-S3 Dev Module (Arduino core 2.x or 3.x).
 *
 * One sketch, four selectable modes (build-time):
 *   RIG_MODE_UART  : UART TX on Serial1, default 921600 baud   (push mode)
 *   RIG_MODE_USB   : Native USB CDC device                     (push mode)
 *   RIG_MODE_I2C   : I2C slave at address 0x42                 (pull mode)
 *   RIG_MODE_SPI   : SPI slave on SPI2                         (pull mode)
 *
 * Push mode  : rig drives the bus, rate-paced by RATE_STEPS[].
 * Pull mode  : master (LAN MCU) drives the bus; rig just supplies data when
 *              clocked. Ramp table is informational only — actual rate is set
 *              by the master.
 *
 * At every step boundary the sketch prints its own gen-stat over the debug
 * port (UART0 = Serial0) so it never collides with the data port:
 *
 *   [RIG] step=3 req_rate=2000 pps total_pkt=12000 total_b=3072000
 *
 * Pin assignment (ESP32-S3 Dev Module default):
 *   UART : TX=GPIO17, RX=GPIO18   (cross to LAN MCU UART)
 *   I2C  : SDA=GPIO8,  SCL=GPIO9
 *   SPI  : SCK=GPIO12, MISO=GPIO13, MOSI=GPIO11, CS=GPIO10
 *   USB  : native D-/D+ (built-in)
 *
 * For SPI slave mode you need the Arduino library "ESP32SPISlave"
 * (https://github.com/hideakitai/ESP32SPISlave).  Install via Library Manager.
 *
 * Pick ONE mode by uncommenting the #define below before flashing.
 */

#define RIG_MODE_UART
//#define RIG_MODE_I2C
//#define RIG_MODE_SPI
//#define RIG_MODE_USB

/* ------------------------------------------------------------------ */
/*  Debug serial port — must never collide with the data port.         */
/*  USB CDC mode hijacks `Serial`, so we route debug to UART0 (Serial0)*/
/*  whenever USB is the data port. Wire UART0 TX (GPIO43) to your USB– */
/*  TTL adapter to see the logs.                                       */
/* ------------------------------------------------------------------ */
#ifdef RIG_MODE_USB
  #define DBG_SERIAL Serial0
#else
  #define DBG_SERIAL Serial
#endif

/* ------------------------------------------------------------------ */
/*  Common tunables                                                    */
/* ------------------------------------------------------------------ */
static const size_t  PKT_SIZE          = 256;  /* bytes per packet     */
static const uint32_t STEP_DURATION_MS = 5000; /* hold each rate 5 s   */

/* Rate ramp (packets per second), per mode.
 * UART : capped at line rate. 921600 baud, 10 bits/byte, 256 B/pkt
 *        ⇒ theoretical max ≈ 360 pps. Walk a small range that brackets it.
 * USB  : full-speed ~12 Mbps line, 256 B/pkt ⇒ theoretical max ≈ 5800 pps.
 *        MCU host CDC overhead usually caps far lower. Walk to 5000.
 * I2C  : master-pulled; ramp values are informational, actual rate is set
 *        by how fast the LAN MCU calls i2c read.
 * SPI  : master-clocked; ramp values are informational.
 */
#if defined(RIG_MODE_UART)
  static const uint32_t RATE_STEPS[] = { 100, 200, 300, 400, 500, 600 };
#elif defined(RIG_MODE_USB)
  static const uint32_t RATE_STEPS[] = { 100, 500, 1000, 2000, 3000, 5000 };
#else /* I2C / SPI — info only */
  static const uint32_t RATE_STEPS[] = { 100, 500, 1000, 2000, 5000 };
#endif
static const size_t NUM_STEPS = sizeof(RATE_STEPS) / sizeof(RATE_STEPS[0]);

/* ------------------------------------------------------------------ */
/*  Shared statistics                                                  */
/* ------------------------------------------------------------------ */
static uint8_t  s_pkt_buf[PKT_SIZE];
static volatile uint32_t s_total_pkt = 0;
static volatile uint64_t s_total_b   = 0;
static uint32_t s_step      = 0;
static uint32_t s_step_start_ms = 0;

static void fill_pkt(uint32_t seq) {
    /* 4-byte sequence header + recognizable payload pattern */
    s_pkt_buf[0] = (seq      ) & 0xFF;
    s_pkt_buf[1] = (seq >>  8) & 0xFF;
    s_pkt_buf[2] = (seq >> 16) & 0xFF;
    s_pkt_buf[3] = (seq >> 24) & 0xFF;
    for (size_t i = 4; i < PKT_SIZE; i++) s_pkt_buf[i] = (uint8_t)(i & 0xFF);
}

static void print_step_log(void) {
    DBG_SERIAL.printf("[RIG] step=%lu req_rate=%lu pps total_pkt=%lu total_b=%llu\n",
                      (unsigned long)s_step,
                      (unsigned long)RATE_STEPS[s_step],
                      (unsigned long)s_total_pkt,
                      (unsigned long long)s_total_b);
}

/* ------------------------------------------------------------------ */
/*  UART mode  (push, rate-paced)                                      */
/* ------------------------------------------------------------------ */
#ifdef RIG_MODE_UART
#define RIG_UART_TX_PIN 17
#define RIG_UART_RX_PIN 18
#define RIG_UART_BAUD   921600

void rig_setup(void) {
    Serial1.begin(RIG_UART_BAUD, SERIAL_8N1, RIG_UART_RX_PIN, RIG_UART_TX_PIN);
    DBG_SERIAL.println("[RIG] UART mode initialised");
}

static inline void rig_push_packet(uint32_t seq) {
    fill_pkt(seq);
    Serial1.write(s_pkt_buf, PKT_SIZE); /* blocks on UART back-pressure */
}
#endif

/* ------------------------------------------------------------------ */
/*  USB CDC mode  (push, rate-paced)                                   */
/*  Requires Tools → USB CDC On Boot: Enabled.                         */
/* ------------------------------------------------------------------ */
#ifdef RIG_MODE_USB
void rig_setup(void) {
    /* `Serial` is now the USB CDC device (data). DBG_SERIAL = Serial0
     * (UART0 on GPIO43/44) carries debug logs. */
    Serial.begin(115200);    /* baud arg is ignored for CDC */
    DBG_SERIAL.println("[RIG] USB CDC mode initialised (data=Serial, debug=Serial0)");
}

static inline void rig_push_packet(uint32_t seq) {
    fill_pkt(seq);
    Serial.write(s_pkt_buf, PKT_SIZE);
}
#endif

/* ------------------------------------------------------------------ */
/*  I2C slave mode  (pull, master-driven, counter inside callback)     */
/* ------------------------------------------------------------------ */
#ifdef RIG_MODE_I2C
#include <Wire.h>
#define RIG_I2C_ADDR    0x42
#define RIG_I2C_SDA     8
#define RIG_I2C_SCL     9
#define RIG_I2C_FREQ    400000

static volatile uint32_t s_i2c_seq = 0;

static void on_i2c_request(void) {
    fill_pkt(s_i2c_seq++);
    Wire.write(s_pkt_buf, PKT_SIZE);
    /* Counter incremented HERE — master pulls one packet per request. */
    s_total_pkt++;
    s_total_b += PKT_SIZE;
}

void rig_setup(void) {
    /* Default Wire RX/TX buffer (~128 B) is smaller than PKT_SIZE.
     * Bump to 512 so a full 256-byte packet fits in one transaction. */
    Wire.setBufferSize(512);
    Wire.begin((uint8_t)RIG_I2C_ADDR, RIG_I2C_SDA, RIG_I2C_SCL, RIG_I2C_FREQ);
    Wire.onRequest(on_i2c_request);
    DBG_SERIAL.println("[RIG] I2C slave mode initialised @0x42 (buf=512)");
}
#endif

/* ------------------------------------------------------------------ */
/*  SPI slave mode  (pull, master-clocked)                             */
/* ------------------------------------------------------------------ */
#ifdef RIG_MODE_SPI
#include <ESP32SPISlave.h>
#define RIG_SPI_SCK   12
#define RIG_SPI_MISO  13
#define RIG_SPI_MOSI  11
#define RIG_SPI_CS    10
#define RIG_SPI_HOST  SPI2_HOST

static ESP32SPISlave s_spi_slave;
static uint8_t s_spi_rx[PKT_SIZE];

void rig_setup(void) {
    s_spi_slave.setDataMode(SPI_MODE0);
    s_spi_slave.begin(RIG_SPI_HOST, RIG_SPI_SCK, RIG_SPI_MISO,
                      RIG_SPI_MOSI, RIG_SPI_CS);
    DBG_SERIAL.println("[RIG] SPI slave mode initialised (MODE0)");
}

static inline void rig_pull_one_spi(void) {
    fill_pkt(s_total_pkt);
    s_spi_slave.queue(s_pkt_buf, s_spi_rx, PKT_SIZE);
    s_spi_slave.yield();    /* blocks until master completes one transaction */
    s_total_pkt++;
    s_total_b += PKT_SIZE;
}
#endif

/* ------------------------------------------------------------------ */
/*  Arduino entry points                                               */
/* ------------------------------------------------------------------ */
void setup() {
    DBG_SERIAL.begin(115200);
    delay(500);
    DBG_SERIAL.println();
    DBG_SERIAL.println("==== bench_lane_rig (ESP32-S3) ====");
    rig_setup();
    s_step_start_ms = millis();
    print_step_log();
}

void loop() {
    /* Step advance — common to all modes. */
    uint32_t now = millis();
    if (now - s_step_start_ms >= STEP_DURATION_MS) {
        s_step = (s_step + 1) % NUM_STEPS;
        s_step_start_ms = now;
        print_step_log();
    }

#if defined(RIG_MODE_UART) || defined(RIG_MODE_USB)
    /* Push mode — main loop rate-paces and increments the counter. */
    const uint32_t pps = RATE_STEPS[s_step];
    if (pps == 0) { delay(10); return; }
    const uint32_t period_us = 1000000UL / pps;
    static uint32_t s_last_us = 0;
    uint32_t cur_us = micros();
    /* Unsigned subtraction handles 32-bit wrap (~70 min) correctly. */
    if (cur_us - s_last_us >= period_us) {
        s_last_us = cur_us;
        rig_push_packet(s_total_pkt);
        s_total_pkt++;
        s_total_b += PKT_SIZE;
    }

#elif defined(RIG_MODE_SPI)
    /* Pull mode — master clocks the bus. queue+yield blocks until done;
     * counter is incremented inside rig_pull_one_spi after completion.
     * RATE_STEPS is informational only. */
    rig_pull_one_spi();

#elif defined(RIG_MODE_I2C)
    /* Pull mode — counter is incremented inside on_i2c_request callback.
     * Main loop just idles. */
    delay(10);
#endif
}
