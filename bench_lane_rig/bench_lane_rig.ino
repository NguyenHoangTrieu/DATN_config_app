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

// #define RIG_MODE_UART
// #define RIG_MODE_I2C
// #define RIG_MODE_SPI
#define RIG_MODE_USB

/* ------------------------------------------------------------------ */
/*  Debug serial port — must never collide with the data port.         */
/*  USB CDC mode hijacks `Serial`, so we route debug to UART0 (Serial0)*/
/*  whenever USB is the data port. Wire UART0 TX (GPIO43) to your USB– */
/*  TTL adapter to see the logs.                                       */
/* ------------------------------------------------------------------ */
#ifdef RIG_MODE_USB
  /* MANDATORY: Tools → USB CDC On Boot must be ENABLED.
   * When disabled, the Arduino core maps `Serial` → UART0 (same physical
   * port as Serial0), so Serial.write() packet data and DBG_SERIAL debug
   * text collide on GPIO43 and produce garbled binary output.
   * The compile-time check below catches the misconfiguration early. */
  #if !defined(ARDUINO_USB_CDC_ON_BOOT) || (ARDUINO_USB_CDC_ON_BOOT == 0)
    #error "RIG_MODE_USB requires: Tools → USB CDC On Boot: Enabled. \
Please enable it in Arduino IDE before flashing, otherwise Serial != USB CDC."
  #endif
  #define DBG_SERIAL Serial0
#else
  #define DBG_SERIAL Serial
#endif

/* ------------------------------------------------------------------ */
/*  Common tunables                                                    */
/* ------------------------------------------------------------------ */
/* Packet size depends on lane type:
 *  - Pull lanes (I2C/SPI): each LAN read is ONE fixed-length transaction, so the
 *    rig packet MUST equal the LAN read chunk (512) or the master clocks padding.
 *  - Push lanes (UART/USB): the LAN sees a continuous byte stream — packet size is
 *    irrelevant to it. Use 256 (matches the original ~717 kbps UART baseline);
 *    512 here is the prime suspect for the UART throughput regression. */
#if defined(RIG_MODE_I2C) || defined(RIG_MODE_SPI)
static const size_t  PKT_SIZE          = 512;
#else
static const size_t  PKT_SIZE          = 256;
#endif
/* Step duration:
 *  USB ceiling measurement: 8 s gives 4 × 2s LAN windows per step for a
 *  stable plateau reading. Other modes can stay at 5 s. */
#if defined(RIG_MODE_USB)
static const uint32_t STEP_DURATION_MS = 8000; /* 8 s per step for USB ceiling */
#else
static const uint32_t STEP_DURATION_MS = 5000; /* hold each rate 5 s           */
#endif

/* Rate ramp (packets per second), per mode.
 * UART : 921600 baud, 10 bits/byte, 256 B/pkt ⇒ theoretical max ≈ 360 pps.
 *        Steps walk past it (up to 600 pps) to force saturation overshoot.
 * USB  : full-speed ~12 Mbps line, 256 B/pkt ⇒ theoretical max ≈ 5800 pps
 *        at 100% line utilisation; CDC overhead in practice caps around
 *        2000–3000 pps (4–6 Mbps). Steps are finer around the saturation
 *        zone (1500–3000 pps) to pinpoint the exact throughput ceiling.
 *        Step 4000 pps confirms hard saturation (rig TX FIFO blocks here).
 * I2C  : master-pulled; ramp values are informational, actual rate is set
 *        by how fast the LAN MCU calls i2c read.
 * SPI  : master-clocked; ramp values are informational.
 */
#if defined(RIG_MODE_UART)
  static const uint32_t RATE_STEPS[] = { 100, 200, 300, 400, 500, 600 };
#elif defined(RIG_MODE_USB)
  /* Fine-grained ramp through the 1500–3000 pps saturation zone.
   * Expected: kbps rises 1000→1500→2000, then plateaus/drops at 2500+.
   * The plateau IS the ceiling; step 4000 is the deliberate overshoot. */
  static const uint32_t RATE_STEPS[] = { 1000, 1500, 2000, 2500, 3000, 4000 };
#else /* I2C / SPI — info only */
  static const uint32_t RATE_STEPS[] = { 100, 500, 1000, 2000, 5000 };
#endif
static const size_t NUM_STEPS = sizeof(RATE_STEPS) / sizeof(RATE_STEPS[0]);

/* ------------------------------------------------------------------ */
/*  Shared statistics                                                  */
/* ------------------------------------------------------------------ */
/* s_pkt_buf is used by fill_pkt() and push modes (UART/USB).
 * In SPI mode it is an intermediate buffer; the DMA-aligned s_spi_tx
 * is what actually goes to the SPI peripheral. */
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
#define RIG_UART_TX_PIN 18
#define RIG_UART_RX_PIN 17
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
#define RIG_I2C_SDA     18
#define RIG_I2C_SCL     17
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
     * Bump so a full PKT_SIZE-byte packet fits in one transaction without
     * underrun (otherwise the master reads padding past the slave's data). */
    Wire.setBufferSize(PKT_SIZE + 16);
    Wire.begin((uint8_t)RIG_I2C_ADDR, RIG_I2C_SDA, RIG_I2C_SCL, RIG_I2C_FREQ);
    Wire.onRequest(on_i2c_request);
    DBG_SERIAL.println("[RIG] I2C slave mode initialised @0x42 (buf=512)");
}
#endif

/* ------------------------------------------------------------------ */
/*  SPI slave mode  (pull, master-clocked)                             */
/* ------------------------------------------------------------------ */
#ifdef RIG_MODE_SPI
/* -----------------------------------------------------------------
 * Double-buffer pre-queue fix  (v2)
 *
 * Problem with the naïve single-buffer approach:
 *   queue_trans(T_N) → get_trans_result(T_N) → queue_trans(T_N+1)
 *
 * At CS-deassert the ISR fires and looks for a pending transaction
 * in the trans_queue. If queue_size=1 and we haven't called
 * queue_trans(T_N+1) yet, the queue is EMPTY → ISR cannot pre-load
 * DMA → slave goes IDLE until the task runs queue_trans(T_N+1).
 * This idle window is ~1600 µs (task wakeup + IDF overhead), while
 * the master polls every ~556 µs (1798 pps). So the slave catches
 * only 1 in ~3 master polls → rig shows ~440 pps vs LAN ~1798 pps.
 *
 * Fix: pre-queue T_N+1 BEFORE calling get_trans_result(T_N).
 * When ISR fires at CS-deassert for T_N, T_N+1 is already in the
 * trans_queue → ISR immediately pre-loads DMA for T_N+1 → slave
 * is ALWAYS ready → every master poll is a real transaction →
 * LAN count ≈ rig count.
 *
 * Requirements for this to work correctly:
 *   1. queue_size=2: 1 slot for the transaction in hardware DMA +
 *      1 slot for the pre-queued next transaction in the SW queue.
 *   2. Two separate DMA-aligned TX buffers (ping-pong): filling
 *      T_N+1's buffer must NOT corrupt T_N's DMA buffer (which the
 *      peripheral is still reading/writing until CS-deassert).
 *   3. Persistent spi_slave_transaction_t descriptors (NOT stack-
 *      local): IDF stores a pointer to the descriptor internally;
 *      if it goes out of scope the pointer dangles.
 *   4. portMAX_DELAY: finite timeouts cascade into a deadlock when
 *      the queue fills (queue_trans blocks 500 ms, then
 *      get_trans_result blocks 500 ms → net ~1 pps effective rate).
 * ----------------------------------------------------------------- */
#include <driver/spi_slave.h>
#include <esp_heap_caps.h>

/* -----------------------------------------------------------------
 * SPI pin wiring — ESP32-S3 RIG (slave) ↔ LAN MCU (master)
 *
 * The bench consumer uses BENCH_LANE_RAW_STACK_ID=1 (Stack 1) which
 * maps to SPI3_HOST on the LAN MCU with these GPIO pins:
 *   LAN MCU GPIO41 = SCK
 *   LAN MCU GPIO40 = MOSI  (data from master TO slave)
 *   LAN MCU GPIO42 = MISO  (data from slave TO master)
 *   LAN MCU GPIO39 = CS    (Stack 1 chip-select)
 *
 * Physical wires must connect LAN MCU GPIOs above to the following
 * ESP32-S3 RIG GPIOs (configurable — set to match your board):
 *   RIG_SPI_SCK  → LAN MCU GPIO41
 *   RIG_SPI_MOSI → LAN MCU GPIO40   (master→slave)
 *   RIG_SPI_MISO → LAN MCU GPIO42   (slave→master)
 *   RIG_SPI_CS   → LAN MCU GPIO39
 *
 * WARNING: Do NOT connect to LAN MCU GPIO12/11/13/10 — those are the
 * WAN module SPI2 pins. The WAN handler continuously clocks SPI2 and
 * the slave would count WAN traffic instead of bench consumer traffic,
 * producing wildly inflated pps numbers (600–1800+) on the slave while
 * the master shows a constant 100 pps.
 * ----------------------------------------------------------------- */
#define RIG_SPI_SCK   12   /* → LAN MCU GPIO41 (Stack1 SPI3 SCK)  */
#define RIG_SPI_MOSI  11   /* → LAN MCU GPIO40 (Stack1 SPI3 MOSI) */
#define RIG_SPI_MISO  13   /* → LAN MCU GPIO42 (Stack1 SPI3 MISO) */
#define RIG_SPI_CS    10   /* → LAN MCU GPIO39 (Stack1 CS)         */
/* On ESP32-S3 any SPI host can be routed to any GPIO via GPIO matrix.
 * SPI2_HOST (FSPI) is used here; host selection is independent of the
 * LAN MCU's SPI3_HOST — only the physical wire mapping above matters. */
#define RIG_SPI_HOST  SPI2_HOST

/* Two DMA-aligned TX buffers (ping-pong).
 * Req 2: T_N+1 buffer fill must not corrupt T_N's active DMA buffer. */
static DMA_ATTR WORD_ALIGNED_ATTR uint8_t s_spi_tx[2][PKT_SIZE];
static DMA_ATTR WORD_ALIGNED_ATTR uint8_t s_spi_rx[PKT_SIZE];

/* Persistent transaction descriptors — NOT stack-local (Req 3).
 * IDF stores a pointer to this struct inside its internal queue. */
static spi_slave_transaction_t s_trans[2];

/* Index of the buffer whose transaction is currently in hardware DMA. */
static uint8_t s_cur_buf = 0;

/* Prepare transaction descriptor for buf_idx with sequence number seq.
 * Only the 4-byte header changes; the rest of the payload is static. */
static inline void spi_prep_trans(uint8_t buf_idx, uint32_t seq) {
    s_spi_tx[buf_idx][0] = (seq      ) & 0xFF;
    s_spi_tx[buf_idx][1] = (seq >>  8) & 0xFF;
    s_spi_tx[buf_idx][2] = (seq >> 16) & 0xFF;
    s_spi_tx[buf_idx][3] = (seq >> 24) & 0xFF;
    spi_slave_transaction_t *t = &s_trans[buf_idx];
    memset(t, 0, sizeof(*t));
    t->length    = PKT_SIZE * 8;          /* IDF takes size in BITS */
    t->tx_buffer = s_spi_tx[buf_idx];
    t->rx_buffer = s_spi_rx;
}

void rig_setup(void) {
    /* Initialise static payload pattern (bytes 4..511 never change). */
    for (int b = 0; b < 2; b++) {
        memset(s_spi_tx[b], 0, PKT_SIZE);
        for (size_t i = 4; i < PKT_SIZE; i++)
            s_spi_tx[b][i] = (uint8_t)(i & 0xFF);
    }
    memset(s_spi_rx, 0, PKT_SIZE);

    spi_bus_config_t bus_cfg = {
        .mosi_io_num     = RIG_SPI_MOSI,
        .miso_io_num     = RIG_SPI_MISO,
        .sclk_io_num     = RIG_SPI_SCK,
        .quadwp_io_num   = -1,
        .quadhd_io_num   = -1,
        .max_transfer_sz = PKT_SIZE,
        .flags           = SPICOMMON_BUSFLAG_SLAVE,
    };
    spi_slave_interface_config_t slave_cfg = {
        .spics_io_num  = RIG_SPI_CS,
        .flags         = 0,
        .queue_size    = 2,   /* Req 1: 1 in DMA + 1 pre-queued (Req 1) */
        .mode          = 0,   /* SPI MODE0 */
        .post_setup_cb = NULL,
        .post_trans_cb = NULL,
    };

    /* SPI_DMA_CH_AUTO: IDF allocates a DMA channel automatically.
     * DMA is REQUIRED for PKT_SIZE=512 (hw FIFO is only 64 bytes). */
    esp_err_t ret = spi_slave_initialize(RIG_SPI_HOST, &bus_cfg,
                                          &slave_cfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK) {
        DBG_SERIAL.printf("[RIG] SPI slave init FAILED: %s\n",
                          esp_err_to_name(ret));
        return;
    }

    /* Pre-queue transaction 0 so the slave is ready the moment the
     * master asserts CS for the very first time. */
    spi_prep_trans(0, 0);
    spi_slave_queue_trans(RIG_SPI_HOST, &s_trans[0], portMAX_DELAY);
    s_cur_buf = 0;

    DBG_SERIAL.println("[RIG] SPI slave ready (MODE0, DMA, double-buf pre-queue)");
}

static inline void rig_pull_one_spi(void) {
    uint8_t  next_buf = 1 - s_cur_buf;
    uint32_t next_seq = s_total_pkt + 1;

    /* Step 1: Fill NEXT buffer header (payload bytes 4..511 are static). */
    spi_prep_trans(next_buf, next_seq);

    /* Step 2: PRE-QUEUE T_N+1 BEFORE waiting for T_N.
     * Critical ordering: when the ISR fires at CS-deassert for T_N it
     * will find T_N+1 already in the trans_queue and immediately pre-
     * loads DMA → no idle gap between consecutive transactions. */
    esp_err_t ret = spi_slave_queue_trans(RIG_SPI_HOST,
                                           &s_trans[next_buf],
                                           portMAX_DELAY);  /* Req 4 */
    if (ret != ESP_OK) return;

    /* Step 3: Now wait for the CURRENT transaction (T_N) to complete. */
    spi_slave_transaction_t *done;
    ret = spi_slave_get_trans_result(RIG_SPI_HOST, &done,
                                      portMAX_DELAY);       /* Req 4 */
    if (ret == ESP_OK) {
        s_total_pkt++;
        s_total_b += PKT_SIZE;
    }

    /* Step 4: The pre-queued buffer is now the "current" one. */
    s_cur_buf = next_buf;
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
