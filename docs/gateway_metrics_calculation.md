# TÍNH TOÁN CHI TIẾT CHỈ SỐ HIỆU SUẤT HỆ THỐNG GATEWAY IOT DUAL-MCU

Tài liệu này trình bày toàn bộ quá trình dẫn xuất toán học cho các chỉ số hiệu suất của hệ thống Gateway IoT kiến trúc Dual-MCU, bao gồm thông lượng dữ liệu, độ trễ hệ thống, khả năng chịu tải và các điểm nghẽn kỹ thuật. Mỗi giá trị được tính từ thông số phần cứng thực tế của hai firmware `DA2_esp` (WAN MCU) và `DA2_esp_LAN` (LAN MCU). Kết quả dẫn xuất ở đây là cơ sở đối chiếu cho tài liệu tóm tắt `summarize_calc.md`.

---

## 1. Kiến trúc Hệ thống và Thông số Phần cứng

### 1.1 Sơ đồ Kiến trúc Dual-MCU

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         IOT GATEWAY — DUAL-MCU                           │
│                                                                          │
│  ┌───────────────────────────────┐  SPI @ 10 MHz  ┌────────────────────┐ │
│  │   WAN Node (DA2_esp)          │◄──────────────►│  LAN Node          │ │
│  │   ESP32-S3 @ 240 MHz          │  16 KB TX/RX   │  (DA2_esp_LAN)     │ │
│  │   PSRAM Octal @ 80 MHz        │  DMA-enabled   │  ESP32-S3 @ 240 MHz│ │
│  │                               │  GPIO8 DR IRQ  │                    │ │
│  │  • MQTT / HTTP / CoAP uplink  │                │  • Zigbee UART     │ │
│  │  • JSON serialize (cJSON)     │                │    115200 bps (HEX)│ │
│  │  • FOTA Manager               │                │  • LoRa UART       │ │
│  │  • RTC PCF8563                │                │    115200 bps (AT) │ │
│  │  • HMI UART GPIO46            │                │  • BLE native      │ │
│  └───────────────────────────────┘                │  • RS485 UART      │ │
│                                                   └────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

**Chuỗi truyền dẫn dữ liệu (Data Pipeline) — 4 chặng:**

1. **Chặng 1 — Air Interface:** Node ngoại vi phát gói qua sóng vô tuyến (Zigbee, LoRa, BLE).
2. **Chặng 2 — Module → LAN MCU:** Module vô tuyến gửi dữ liệu về LAN MCU qua UART 115.200 bps với giao thức đặc thù: Zigbee dùng **HEX binary framing** (Ebyte protocol), LoRa dùng **AT command ASCII** (Seeed Wio-E5).
3. **Chặng 3 — Inter-MCU (SPI):** LAN MCU gom dữ liệu theo chu kỳ 50 ms và đẩy sang WAN MCU qua bus SPI 10 MHz với DMA.
4. **Chặng 4 — Cloud Interface:** WAN MCU serialize sang JSON bằng cJSON và publish lên server qua MQTT/HTTP.

### 1.2 Bảng Thông số Phần cứng Chính

| Tham số | WAN Node | LAN Node |
| :--- | :---: | :---: |
| **MCU** | ESP32-S3 (Xtensa LX7) | ESP32-S3 (Xtensa LX7) |
| **Tần số CPU** | 240 MHz | 240 MHz |
| **PSRAM** | Octal SPI @ 80 MHz | Octal SPI @ 80 MHz |
| **Internal SRAM always** | 16 KB | 16 KB |
| **Internal SRAM reserve** | 32 KB | 32 KB |
| **FreeRTOS Tick Rate** | 100 Hz (10 ms/tick) | 100 Hz (10 ms/tick) |
| **Inter-MCU bus** | SPI Slave (SPI2_HOST) | SPI Master |
| **SPI clock** | — | 10 MHz |
| **SPI TX/RX buffer** | 16 KB / 16 KB | — |
| **UART Zigbee baudrate** | — | 115.200 bps |
| **UART LoRa baudrate** | — | 115.200 bps |
| **UART RS485 baudrate** | — | 9.600 bps (mặc định) |
| **Listener buffer** | — | 512 byte |
| **Response packet buffer** | — | 2.048 byte |
| **WAN Uplink Queue depth** | 5 item | — |
| **Batch flush interval** | — | 50 ms |

---

## 2. Thông lượng Dữ liệu (Data Throughput) — Dẫn xuất Chi tiết

> **Ký hiệu:** $R_{PHY}$ = tốc độ vật lý lý thuyết, $R_{app}$ = thông lượng ứng dụng thực tế, $\eta = R_{app}/R_{PHY}$ = hiệu suất băng thông.

### 2.1 Zigbee — E18-ZG120 / CC2530

#### 2.1.1 Tốc độ PHY và Cấu trúc Frame IEEE 802.15.4

Module **Ebyte E18-ZG120** dùng chip **CC2530**, tuân theo chuẩn **IEEE 802.15.4** tại 2,4 GHz. Điều chế O-QPSK với chip-rate 2 Mchip/s, mỗi symbol 4 bit:

$$R_{PHY,Zigbee} = \frac{2 \times 10^6 \text{ chip/s}}{4 \text{ chip/symbol}} \times \frac{4 \text{ bit}}{2 \text{ chip}} = 250 \text{ kbps}$$

Thời gian một symbol: $T_{symbol} = 1/62500 = 16 \; \mu\text{s}$.

**Phân tách overhead theo lớp (PSDU tối đa 127 byte):**

| Lớp | Kích thước | Thành phần |
| :--- | :---: | :--- |
| MAC Frame Control + SeqNum | 3 B | FCF 2 B + Seq 1 B |
| MAC Dest PAN ID | 2 B | Short PAN |
| MAC Dest Addr (short) | 2 B | 16-bit addressing |
| MAC Src Addr (short) | 2 B | 16-bit addressing |
| MAC FCS | 2 B | CRC-16 |
| **Overhead MAC** | **11 B** | |
| Zigbee NWK (tối thiểu) | 8 B | FCF + Addr + Radius + Seq |
| Zigbee APS (tối thiểu) | 9 B | FCF + EP + ClusterID + ProfileID |
| **Overhead tổng** | **28 B** | |

$$P_{max,Zigbee} = 127 - 28 = 99 \text{ byte payload ứng dụng}$$

**Chu kỳ phát–ACK trên không trung:**

- PHY header (SHR + PHR): 6 byte
- Thời gian frame: $T_{frame} = (6 + 127) \times 8 / 250.000 = 4.256 \text{ ms}$
- Turnaround: $T_{TA} = 192 \; \mu\text{s}$ (12 symbol)
- ACK frame (11 byte): $T_{ACK} = 11 \times 8 / 250.000 = 352 \; \mu\text{s}$
- SIFS: $T_{SIFS} = 192 \; \mu\text{s}$

$$T_{cycle,air} = 4.256 + 0.192 + 0.352 + 0.192 = 4{,}992 \text{ ms} \approx 5{,}0 \text{ ms}$$

Thông lượng ứng dụng **trên không trung thuần túy** (nếu không bị nút thắt tầng dưới):

$$R_{app,air} = \frac{99 \times 8}{4{,}992 \times 10^{-3}} \approx 158{,}7 \text{ kbps}$$

#### 2.1.2 Phân tích Nút thắt UART — Thành phần Then chốt

**Đây là điểm quan trọng nhất quyết định thông lượng thực tế của Zigbee.** Module E18-ZG120 gửi bất đồng bộ mỗi gói nhận được về LAN MCU qua UART 115.200 bps theo **Ebyte HEX binary framing**. Cấu trúc frame UART gửi về cho mỗi gói Zigbee nhận được:

| Trường | Kích thước | Ghi chú |
| :--- | :---: | :--- |
| Header `0x55` | 1 B | Byte đồng bộ Ebyte |
| Length | 1 B | Độ dài phần cmd\_data |
| Cmd\_Type | 1 B | |
| Cmd\_Code | 1 B | |
| Cmd\_Data (payload ZCL) | tối đa 99 B | Dữ liệu ứng dụng |
| Overhead ZCL (trong cmd\_data) | ~22 B | ZCL header + routing info |
| Checksum | 1 B | |
| **Tổng frame UART** | **≈ 121 B** | cho 99 B payload |

Thời gian truyền một frame UART này (8N1, 10 bit/byte):

$$\boxed{T_{UART,Zigbee} = \frac{121 \times 10}{115.200} \approx 10{,}5 \text{ ms}}$$

**So sánh trực tiếp:**
- Chu kỳ air (phát + ACK): $T_{cycle,air} \approx 5{,}0 \text{ ms}$
- Thời gian UART gửi về MCU: $T_{UART} \approx 10{,}5 \text{ ms}$

**UART chậm hơn gấp đôi so với air** → UART trở thành nút thắt thực sự. Thông lượng thực tế bị giới hạn bởi UART:

$$R_{app,Zigbee} = \frac{99 \times 8}{10{,}5 \times 10^{-3}} \approx 75{,}4 \text{ kbps} \approx \mathbf{75 \div 80 \text{ kbps}}$$

$$\eta_{Zigbee} = \frac{R_{app}}{R_{PHY}} = \frac{75{,}4}{250} \approx 30{,}2\% \approx \mathbf{32\%}$$

> **Kết luận:** Mặc dù PHY IEEE 802.15.4 đạt 250 kbps, thông lượng thực tế của Zigbee qua UART 115.200 bps chỉ đạt $\approx 80$ kbps do frame HEX phản hồi (121 byte, 10,5 ms) chậm hơn gấp đôi chu kỳ air (5 ms). Đây là nút thắt hệ thống, không phải tốc độ vô tuyến.

---

### 2.2 LoRa TEST/P2P — Wio-E5 / STM32WLE5JC

**Lưu ý kịch bản kiểm thử:** Hệ thống sử dụng chế độ **TEST/P2P** (`AT+MODE=TEST`) thay vì LoRaWAN. Chế độ này **bỏ qua hoàn toàn** stack LoRaWAN, không áp dụng duty cycle ETSI 1%, không có overhead MAC LoRaWAN 13 byte. Giới hạn duy nhất là **Time-on-Air vật lý**.

#### 2.2.1 Tốc độ PHY và Công thức Time-on-Air

**Tốc độ bit PHY** của LoRa CSS (Chirp Spread Spectrum) phụ thuộc ba tham số SF, BW, CR:

$$R_{PHY,LoRa} = SF \times \frac{BW}{2^{SF}} \times \frac{4}{4 + CR_{code}}$$

với $CR_{code} \in \{1,2,3,4\}$ tương ứng CR 4/5, 4/6, 4/7, 4/8.

**Bảng $R_{PHY}$ theo cấu hình (kbps, CR = 4/5):**

| SF | $BW = 125$ kHz | $BW = 250$ kHz | $BW = 500$ kHz |
| :---: | :---: | :---: | :---: |
| 7 | $5{,}47$ | $10{,}94$ | $21{,}88$ |
| 8 | $3{,}13$ | $6{,}25$ | $12{,}50$ |
| 9 | $1{,}76$ | $3{,}52$ | $7{,}03$ |
| 10 | $0{,}98$ | $1{,}95$ | $3{,}91$ |
| 11 | $0{,}54$ | $1{,}07$ | $2{,}15$ |
| 12 | $0{,}29$ | $0{,}59$ | $1{,}17$ |

**Dẫn xuất Time-on-Air (ToA):**

Thời gian một symbol:
$$T_s = \frac{2^{SF}}{BW}$$

Thời gian preamble (mặc định $n_{pre} = 8$ symbol theo AT+TEST=RFCFG):
$$T_{pre} = (n_{pre} + 4{,}25) \times T_s$$

Số symbol payload (công thức Semtech AN1200.13):
$$n_{payload} = \max\!\left(\left\lceil \frac{8 \cdot PL - 4 \cdot SF + 28 + 16 - 20H}{4(SF - 2 \cdot DE)} \right\rceil \times (CR_{code} + 4),\; 0\right) + 8$$

với $PL$ = số byte payload, $H = 0$ (explicit header), $DE = 0$ (LDRO tắt, chỉ dùng khi SF $\geq$ 11).

$$\boxed{ToA = T_{pre} + n_{payload} \times T_s}$$

**Ví dụ dẫn xuất — SF7, BW = 125 kHz, $PL = 50$ byte, CR = 4/5:**

$$T_s = \frac{2^7}{125.000} = \frac{128}{125.000} = 1{,}024 \text{ ms}$$

$$T_{pre} = (8 + 4{,}25) \times 1{,}024 = 12{,}54 \text{ ms}$$

$$n_{payload} = \left\lceil \frac{8 \times 50 - 4 \times 7 + 28 + 16}{4 \times 7} \right\rceil \times 5 + 8 = \left\lceil \frac{400 - 28 + 44}{28} \right\rceil \times 5 + 8 = \lceil 14{,}857 \rceil \times 5 + 8 = 83$$

$$ToA_{SF7/125} = 12{,}54 + 83 \times 1{,}024 = 12{,}54 + 84{,}99 = \mathbf{97{,}5 \text{ ms}}$$

**Tương tự — SF7, BW = 250 kHz:**

$$T_s = \frac{128}{250.000} = 0{,}512 \text{ ms}, \quad T_{pre} = 12{,}25 \times 0{,}512 = 6{,}27 \text{ ms}$$

$$n_{payload} = 83 \text{ symbol (không đổi, vì SF và PL giống nhau)}$$

$$ToA_{SF7/250} = 6{,}27 + 83 \times 0{,}512 = 6{,}27 + 42{,}50 = \mathbf{48{,}8 \text{ ms}}$$

#### 2.2.2 Overhead AT Command UART và Giới hạn Payload

Trong chế độ TEST/P2P, gateway nhận bằng `AT+TEST=RXLRPKT` (nhận liên tục, không gửi). Có hai biến thể quan trọng:

1. **Baseline cũ** dùng chuỗi HEX có dấu cách, ví dụ `"AA BB CC ..."`.
2. **Benchmark max-throughput hiện tại** dùng chuỗi HEX liền nhau, ví dụ `"AABBCC..."` với payload 222 byte.

Với biến thể baseline cũ, node phát lệnh:

```
AT+TEST=TXLRPKT,"AA BB CC DD ..."
```

Phân tích kích thước command:
- Prefix cố định: `AT+TEST=TXLRPKT,"` = 19 ký tự
- Mỗi byte payload → 3 ký tự (`XX ` hex + dấu cách), byte cuối → 2 ký tự → tổng: $3 \times PL - 1$ ký tự
- Hậu tố: `"\r\n` = 3 ký tự
- **Tổng command**: $19 + (3 \times PL - 1) + 3 = 3 \times PL + 21$ ký tự

**Giới hạn 528 ký tự (Wio-E5 AT command buffer, trường hợp có dấu cách):**

$$3 \times PL_{max} + 21 \leq 528 \implies PL_{max} = \left\lfloor \frac{507}{3} \right\rfloor = \mathbf{169 \text{ byte}}$$

Thời gian truyền AT command qua UART 115.200 bps cho $PL = 50$ byte:

$$T_{AT,TX} = \frac{(3 \times 50 + 21) \times 10}{115.200} = \frac{1710}{115.200} \approx 14{,}8 \text{ ms}$$

Thời gian nhận phản hồi `+TEST: TX DONE\r\n` (15 ký tự):

$$T_{AT,RX} = \frac{15 \times 10}{115.200} \approx 1{,}3 \text{ ms}$$

**Tổng overhead AT command:**

$$\boxed{T_{AT,overhead} \approx 14{,}8 + 1{,}3 \approx 15 \text{ ms}}$$

**Benchmark max-throughput hiện tại (payload 222 byte, HEX liền nhau):**

Node phát dùng lệnh:

```
AT+TEST=TXLRPKT,"AABBCCDDEEFF..."
```

Kích thước command khi không có dấu cách:
- Prefix `AT+TEST=TXLRPKT,"` = 17 ký tự
- Payload HEX = $2 \times PL$ ký tự
- Hậu tố `"\r\n` = 3 ký tự

$$L_{AT,TX}^{compact} = 17 + 2PL + 3 = 20 + 2PL$$

Với $PL = 222$ byte:

$$L_{AT,TX}^{compact} = 20 + 2 \times 222 = 464 \text{ ký tự}$$

$$T_{AT,TX}^{compact} = \frac{464 \times 10}{115.200} \approx 40{,}3 \text{ ms}$$

Wio-E5 còn echo lại chính dòng `+TEST: TXLRPKT "..."` trước khi trả `TX DONE`. Dòng echo này có kích thước xấp xỉ 463 ký tự:

$$T_{AT,echo} \approx \frac{463 \times 10}{115.200} \approx 40{,}2 \text{ ms}$$

Phản hồi `+TEST: TX DONE\r\n` khoảng 16 ký tự:

$$T_{AT,done} \approx \frac{16 \times 10}{115.200} \approx 1{,}4 \text{ ms}$$

Do đó overhead UART hiệu dụng trong firmware benchmark hiện tại là:

$$\boxed{T_{AT,overhead}^{compact} \approx 40{,}3 + 40{,}2 + 1{,}4 = 81{,}9 \text{ ms}}$$

#### 2.2.3 Thông lượng Ứng dụng Thực tế

Chu kỳ phát một gói hoàn chỉnh trong TEST/P2P:

$$T_{cycle,LoRa} = T_{AT,overhead} + ToA$$

**Trường hợp SF7 / BW = 125 kHz, $PL = 50$ byte:**

$$T_{cycle,SF7/125} = 15 + 97{,}5 = 112{,}5 \text{ ms}$$

$$R_{app,SF7/125} = \frac{50 \times 8}{0{,}1125} = \frac{400}{0{,}1125} \approx 3.556 \text{ bps} \approx \mathbf{3{,}5 \text{ kbps}}$$

$$\eta_{SF7/125} = \frac{3{,}5}{5{,}47} \approx 64\%$$

**Trường hợp SF7 / BW = 250 kHz, $PL = 50$ byte:**

$$T_{cycle,SF7/250} = 15 + 48{,}8 = 63{,}8 \text{ ms}$$

$$R_{app,SF7/250} = \frac{50 \times 8}{0{,}0638} \approx 6.270 \text{ bps} \approx \mathbf{6{,}1 \text{ kbps}}$$

$$\eta_{SF7/250} = \frac{6{,}1}{10{,}94} \approx 56\%$$

**Trường hợp benchmark hiện tại — SF7 / BW = 125 kHz, $PL = 222$ byte, TXPR = RXPR = 12:**

Thời gian một symbol:

$$T_s = \frac{2^7}{125.000} = 1{,}024 \text{ ms}$$

Preamble 12 symbol:

$$T_{pre,12} = (12 + 4{,}25) \times 1{,}024 = 16{,}64 \text{ ms}$$

Số symbol payload:

$$n_{payload} = \left\lceil \frac{8 \times 222 - 4 \times 7 + 28 + 16}{4 \times 7} \right\rceil \times 5 + 8 = \left\lceil \frac{1792}{28} \right\rceil \times 5 + 8 = 328$$

Time-on-Air:

$$ToA_{SF7/125,222B} = 16{,}64 + 328 \times 1{,}024 = \mathbf{352{,}5 \text{ ms}}$$

Chu kỳ phát hiệu dụng của node benchmark hiện tại:

$$T_{cycle,222B} = T_{AT,overhead}^{compact} + ToA = 81{,}9 + 352{,}5 = \mathbf{434{,}4 \text{ ms}}$$

Thông lượng payload thực tế:

$$R_{app,222B} = \frac{222 \times 8}{0{,}4344} \approx \mathbf{4{,}09 \text{ kbps}}$$

Giá trị này khớp với số đo tại node phát ($\approx 3{,}9 \div 4{,}1$ kbps).

**Tại sao Gateway lại thấy 8{,}3 đến 9{,}4 kbps?**

Ở chiều RX, Wio-E5 trả về hai dòng cho mỗi gói nhận được:

1. `+TEST: LEN:222, RSSI:..., SNR:...`
2. `+TEST: RX <444 ký tự HEX>`

Tổng kích thước UART RX mỗi gói xấp xỉ:

$$L_{UART,RX} \approx 33 + 456 = \mathbf{489 \text{ byte}}$$

Nếu lấy chu kỳ $T_{cycle,222B} \approx 434{,}4$ ms thì thông lượng raw UART RX stream là:

$$R_{UART,RX} = \frac{489 \times 8}{0{,}4344} \approx \mathbf{9{,}0 \text{ kbps}}$$

Đây chính là nguồn gốc của các số đo `LR_RX \approx 8{,}3 \div 9{,}4` kbps trên Gateway: bộ đếm benchmark hiện đếm **raw listener bytes**, không phải payload LoRa đã parse.

Ngoài ra, `lora_handler_listen()` đọc bus theo **chunk 128 byte**, vì vậy một gói RX hoàn chỉnh (~489 byte UART) thường bị tách thành khoảng 4 chunk. Do đó trường `pkt=` trong benchmark firmware hiện tại phản ánh **số chunk listener đọc được**, không phải số frame LoRa thực tế.

> **Kết luận:** Trong chế độ TEST/P2P, **Time-on-Air là nút thắt duy nhất** — duty cycle không áp dụng. Overhead AT command (~15 ms) đóng góp đáng kể với SF7/250 (chiếm 24% chu kỳ) và không đáng kể với SF12 (chiếm < 1% chu kỳ ≈ 2.317 ms).

---

### 2.3 BLE — Native ESP32-S3

#### 2.3.1 PHY và Overhead BLE LL / ATT

BLE 5.0 trên ESP32-S3 (1M PHY). Overhead các lớp trong một LL packet:

| Lớp | Kích thước | Ghi chú |
| :--- | :---: | :--- |
| LL Access Address | 4 B | Nhận diện kết nối |
| LL PDU Header | 2 B | LLID + Length |
| L2CAP Header | 4 B | Length 2 B + CID 2 B |
| ATT Opcode + Handle | 3 B | |
| LL CRC | 3 B | CRC-24 |
| **Tổng overhead** | **16 B** | |

**Không có DLE** (ATT MTU mặc định = 23 byte → 20 byte giá trị):

$$P_{app,no\text{-}DLE} = 23 - 3 = 20 \text{ byte/connection interval}$$

**Có DLE** (BLE 4.2+, MTU đàm phán tới 247 byte → 244 byte giá trị):

$$P_{app,DLE} = 247 - 3 = 244 \text{ byte/connection interval}$$

#### 2.3.2 Thông lượng theo Connection Interval

Hệ thống cấu hình Connection Interval $CI = 20$ ms:

$$R_{app,BLE} = \frac{P_{app} \times 8}{CI}$$

**Không DLE ($P_{app} = 20$ byte, $CI = 20$ ms):**

$$R_{app,BLE}^{no\text{-}DLE} = \frac{20 \times 8}{20 \times 10^{-3}} = \mathbf{8 \text{ kbps/thiết bị}}$$

**Có DLE ($P_{app} = 244$ byte, $CI = 20$ ms):**

$$\boxed{R_{app,BLE}^{DLE} = \frac{244 \times 8}{20 \times 10^{-3}} = \mathbf{97{,}6 \text{ kbps/thiết bị}}}$$

$$\eta_{BLE,DLE} = \frac{97{,}6}{1.000} = 9{,}76\% \approx 9{,}7\%$$

**Thời gian truyền một LL packet** (1M PHY, 251 byte PDU payload):

$$T_{packet} = \frac{(4 + 2 + 251 + 3) \times 8}{10^6} + 150 \; \mu\text{s} \approx 2{,}238 \text{ ms}$$

---

### 2.4 RS485 / Modbus RTU (Tham khảo)

RS485 dùng UART 8N1 (10 bit/byte). Modbus RTU overhead: 4 byte (Address + FuncCode + CRC-16). Tại baudrate mặc định 9.600 bps:

$$R_{data,RS485} = 9600 \times \frac{8}{10} = 7.680 \text{ bps} = 960 \text{ byte/s}$$

$$R_{app,RS485} = R_{data} \times \frac{n}{n + 4} = 960 \times \frac{10}{14} \approx 685{,}7 \text{ byte/s} = 5{,}49 \text{ kbps}$$

$$\eta_{RS485} = \frac{10}{10+4} \approx 71{,}4\%$$

---

### 2.5 Bảng Tổng hợp Thông lượng

| Giao thức | $R_{PHY}$ | $R_{app}$ thực tế | $\eta$ | Nút thắt chính |
| :--- | :---: | :---: | :---: | :--- |
| **Zigbee** | $250 \text{ kbps}$ | $\approx 80 \text{ kbps}$ | $32\%$ | UART 115.200 bps (10,5 ms/frame HEX) |
| **LoRa SF7/125 (P2P, 50 B baseline)** | $5{,}47 \text{ kbps}$ | $\approx 3{,}5 \text{ kbps}$ | $64\%$ | $\text{ToA} \approx 97{,}5 \text{ ms/gói}$ |
| **LoRa SF7/125 (P2P, 222 B benchmark)** | $5{,}47 \text{ kbps}$ | $\approx 4{,}1 \text{ kbps}$ | $75\%$ | $\text{ToA} \approx 352{,}5 \text{ ms/gói} +$ UART echo |
| **LoRa SF7/125 (Gateway raw RX counter)** | $5{,}47 \text{ kbps}$ | $\approx 8{,}3 \div 9{,}4 \text{ kbps}$ | — | Đếm raw UART RX stream, không phải payload LoRa |
| **LoRa SF7/250 (P2P)** | $10{,}94 \text{ kbps}$ | $\approx 6{,}1 \text{ kbps}$ | $56\%$ | $\text{ToA} \approx 48{,}8 \text{ ms/gói}$ |
| **LoRa SF12/125 (P2P)** | $0{,}29 \text{ kbps}$ | $\approx 0{,}18 \text{ kbps}$ | $62\%$ | $\text{ToA} \approx 2.302 \text{ ms/gói}$ |
| **BLE (không DLE)** | $1.000 \text{ kbps}$ | $\approx 8 \text{ kbps}$ | $0{,}8\%$ | MTU = 20 byte, $CI = 20 \text{ ms}$ |
| **BLE (DLE bật)** | $1.000 \text{ kbps}$ | $\approx 97{,}6 \text{ kbps}$ | $9{,}7\%$ | $CI = 20 \text{ ms}$ |
| **RS485 @ 9.600 bps** | $9{,}6 \text{ kbps}$ | $\approx 5{,}5 \text{ kbps}$ | $57\%$ | Poll interval 20 ms, Modbus overhead 4 B |

---

## 3. Độ trễ Hệ thống (System Latency) — Dẫn xuất Chi tiết

### 3.1 Thành phần Độ trễ tại từng Chặng

#### 3.1.1 Độ trễ Phần cứng — Hardware Latency

**Độ trễ ngắt GPIO (data-ready từ LAN MCU):**

ESP32-S3 Xtensa LX7, pipeline 5 giai đoạn:

| Thành phần | Thời gian | Nguồn |
| :--- | :---: | :--- |
| Pipeline drain (tối đa 5 lệnh) | $\leq 20{,}8 \text{ ns}$ | LX7 @ 240 MHz |
| Interrupt entry (save PC, PS) | $\approx 37{,}5 \text{ ns}$ | Xtensa ISA |
| Vector fetch + prologue | $\approx 208 \text{ ns}$ | Cache hit |
| Context save (18 registers) | $\approx 75 \text{ ns}$ | Register window |
| **Tổng $T_{ISR}$** | **$\approx 341 \text{ ns} \approx 0{,}34 \; \mu\text{s}$** | |

**Độ trễ truyền SPI (Inter-MCU):**

$f_{SPI} = 10 \text{ MHz}$, thời gian 1 bit = 100 ns.

$$T_{SPI}(N \text{ byte}) = \frac{N \times 8}{10 \times 10^6} = 0{,}8 \; \mu\text{s} \times N$$

| Kích thước | $T_{SPI}$ |
| :---: | :---: |
| 256 B | $204{,}8 \; \mu\text{s}$ |
| $1 \text{ KB}$ | $\approx 0{,}82 \text{ ms}$ |
| $4 \text{ KB}$ | $\approx 3{,}28 \text{ ms}$ |
| $16 \text{ KB}$ (buffer max) | $\approx 13{,}1 \text{ ms}$ |

**Độ trễ UART từ module đến LAN MCU:**

$$T_{UART}(N \text{ byte}) = \frac{N \times 10}{115.200} = 86{,}8 \; \mu\text{s} \times N$$

- Zigbee frame HEX (121 byte): $T_{UART,Zigbee} = 121 \times 10 / 115.200 \approx 10{,}5 \text{ ms}$
- LoRa AT response `+TEST: RX "AA BB..."\r\n` (50 byte payload → ≈ 174 byte response):

$$T_{UART,LoRa,RX} = \frac{174 \times 10}{115.200} \approx 15{,}1 \text{ ms}$$

#### 3.1.2 Độ trễ FreeRTOS — RTOS Latency

FreeRTOS tick rate 100 Hz, $T_{tick} = 10 \text{ ms}$. Chi phí context switch Xtensa LX7:

$$T_{ctx\_switch} \approx \frac{(1{,}5 + 0{,}5 + 1{,}5) \; \mu\text{s}}{1} = 3{,}5 \; \mu\text{s}$$

Task MCU WAN Downlink (Priority 7 — cao nhất) preempt ngay tại ISR return:

$$T_{preempt,P7} = T_{ctx\_switch} \approx 3{,}5 \; \mu\text{s}$$

**Độ trễ gom gói Batch Flush** — thành phần lớn nhất với Zigbee và BLE:

$$T_{batch} \in [0 \text{ ms},\; 50 \text{ ms}] \quad \text{(tuỳ pha flush tại LAN MCU)}$$

Trung bình: $\mathbb{E}[T_{batch}] = 25 \text{ ms}$.

**Độ trễ JSON serialize** (WAN MCU):

$$T_{JSON} \approx 270 \div 300 \; \mu\text{s} \approx 0{,}3 \text{ ms}$$

### 3.2 Bảng Tổng hợp Độ trễ End-to-End

Công thức tổng độ trễ từ Node đến Server:

$$\boxed{T_{e2e} = T_{air} + T_{UART} + T_{batch} + T_{SPI} + T_{JSON} + T_{network}}$$

| Kịch bản | $T_{air}$ | $T_{UART}$ | $T_{batch}$ | $T_{SPI}$ | $T_{JSON}$ | $T_{e2e}$ điển hình |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Zigbee → MQTT** | $5{,}0 \text{ ms}$ | $10{,}5 \text{ ms}$ | $0 \div 50 \text{ ms}$ | $0{,}82 \text{ ms}$ | $0{,}3 \text{ ms}$ | $\mathbf{10 \div 60 \text{ ms}}$ |
| **LoRa SF7/125 → MQTT** | $97{,}5 \text{ ms}$ | $15 \text{ ms}$ | $0 \div 50 \text{ ms}$ | $0{,}82 \text{ ms}$ | $0{,}3 \text{ ms}$ | $\mathbf{100 \div 150 \text{ ms}}$ |
| **LoRa SF12/125 → MQTT** | $2.302 \text{ ms}$ | $15 \text{ ms}$ | $0 \div 50 \text{ ms}$ | $0{,}82 \text{ ms}$ | $0{,}3 \text{ ms}$ | $\mathbf{\approx 2{,}6 \text{ giây}}$ |
| **BLE → MQTT** | $2{,}2 \text{ ms}$ | $0$ | $0 \div 50 \text{ ms}$ | $0{,}82 \text{ ms}$ | $0{,}3 \text{ ms}$ | $\mathbf{4 \div 55 \text{ ms}}$ |

> **Nhận xét:** $T_{batch}$ (0–50 ms) chiếm ưu thế với Zigbee và BLE. $T_{air}$ chiếm ưu thế với LoRa. Giảm batch interval xuống 10 ms sẽ cắt $T_{e2e,Zigbee}$ còn 10–20 ms.

---

## 4. Khả năng Chịu tải và Tài nguyên Bộ nhớ

### 4.1 Giới hạn Số lượng Node Kết nối

#### 4.1.1 Zigbee — Nút thắt SRAM CC2530

**CC2530 thông số:** SRAM tổng 8.192 byte, Flash 256 KB. Z-Stack 3.x OS + NWK chiếm ≈ 5.000 byte → vùng khả dụng:

$$SRAM_{avail} = 8.192 - 5.000 = 3.192 \text{ byte}$$

Kích thước mỗi entry bảng (Z-Stack):
- Neighbor Table entry: ≈ 18 byte
- Routing Table entry: ≈ 8 byte
- Zigbee Listener buffer (firmware LAN MCU): 512 byte

Bộ nhớ khả dụng cho bảng sau khi trừ buffer:

$$SRAM_{for\_tables} = 3.192 - 512 = 2.680 \text{ byte}$$

Số direct children tối đa theo SRAM:

$$N_{children,max} = \left\lfloor \frac{2.680}{18 + 8} \right\rfloor = \left\lfloor \frac{2.680}{26} \right\rfloor = 103 \text{ node}$$

Tuy nhiên, **Z-Stack 3.x hard-limit** `NWK_MAX_DEVICE_LIST = 20` (cấu hình mặc định để bảo vệ SRAM). Lỗi `0x11` (Memory Full) và `0x18` (Not Enough Cache) xuất hiện khi vượt ngưỡng này:

$$\boxed{N_{Zigbee,practical} = 20 \text{ node} \quad \text{(Z-Stack default config CC2530)}}$$

Quy mô mạng lý thuyết (mesh 5 hop): $N_{network} = 20^5 = 3{,}2 \times 10^6$ (giới hạn địa chỉ 16-bit: 65.535 node).

#### 4.1.2 LoRa TEST/P2P — Liên kết Point-to-Point

Trong chế độ P2P, Gateway chỉ liên kết **một node tại một thời điểm**. Không có giới hạn mạng lưới. Giới hạn duy nhất là thông lượng Time-on-Air và batch queue:

$$N_{LoRa,P2P} = 1 \text{ node/phiên kết nối}$$

#### 4.1.3 BLE — Giới hạn GATT Connection ESP32-S3

Giao thức **GATT (Generic Attribute Profile)** giới hạn số kết nối đồng thời của ESP32-S3 ở mức **8 thiết bị** do ràng buộc connection handle table trong BLE stack NimBLE của ESP-IDF:

$$\boxed{N_{BLE,GATT,max} = 8 \text{ kết nối đồng thời}}$$

Đây là giới hạn thực tế từ phía phần mềm stack — cao hơn giá trị này sẽ cần tăng `CONFIG_BT_NIMBLE_MAX_CONNECTIONS` và cấp phát thêm SRAM tương ứng. Bộ nhớ cho mỗi kết nối GATT ≈ 1,5–2 KB (connection handle + security keys + ATT cache):

$$RAM_{BLE,8conn} = 8 \times 2 \text{ KB} = 16 \text{ KB internal SRAM}$$

### 4.2 Ước lượng Heap Watermark Worst-Case

#### 4.2.1 PSRAM (External, Octal SPI @ 80 MHz)

Task stacks cấp phát trong PSRAM (`MALLOC_CAP_SPIRAM`):

| Task (tính cho 2 stack LAN) | Stack size | Số lượng | Tổng PSRAM |
| :--- | :---: | :---: | :---: |
| MCU WAN Downlink | 16 KB | 1 | 16 KB |
| MCU WAN Uplink | 16 KB | 1 | 16 KB |
| LoRa Uplink + Downlink | 24 KB | $2 \times 2$ | 96 KB |
| LoRa Listener | 8 KB | 2 | 16 KB |
| BLE Uplink + Downlink | 24 KB | $2 \times 2$ | 96 KB |
| BLE Listener | 8 KB | 2 | 16 KB |
| Zigbee Uplink | 24 KB | 2 | 48 KB |
| Zigbee Downlink | 32 KB | 2 | 64 KB |
| Zigbee Listener | 16 KB | 2 | 32 KB |
| RS485 Handler | 8 KB | 2 | 16 KB |
| MCU LAN Uplink | 6 KB | 1 | 6 KB |
| **Tổng task stacks** | | | **≈ 426 KB** |

Buffers tĩnh PSRAM: SPI TX/RX buffer ($16 \times 2 = 32$ KB) + Response packet buffers ($4 \times 2 \times 2 = 16$ KB):

$$PSRAM_{static} = 48 \text{ KB}$$

$$\boxed{PSRAM_{total} \approx 426 + 48 = 474 \text{ KB}}$$

#### 4.2.2 Internal SRAM — Worst-Case Heap Watermark

**TCBs (Task Control Blocks):**

$$TCB_{total} = 176 \text{ byte} \times 20 \text{ task} \approx 3{,}5 \text{ KB}$$

**Queue buffers (Internal SRAM):**

| Queue | Depth | Item size | RAM |
| :--- | :---: | :---: | :---: |
| WAN Uplink | 5 | 8 B (pointer) | 40 B |
| Handler queues (×12 giao diện) | 20 | 8 B | 1.920 B |
| Command queues (×6) | 10 | 8 B | 480 B |
| **Tổng queue RAM** | | | **≈ 2{,}5 KB** |

**cJSON Heap — Worst-case 4 giao diện đồng thời:**

| Thành phần | Kích thước |
| :--- | :---: |
| 4× cJSON tree (10 nodes, 48 B/node) | $4 \times 10 \times 48 = 1.920 \text{ B}$ |
| 4× output buffer JSON (2 KB each) | $4 \times 2.048 = 8.192 \text{ B}$ |
| 4× input raw buffer (2 KB each) | $4 \times 2.048 = 8.192 \text{ B}$ |
| **Tổng cJSON heap** | **≈ 18{,}3 KB** |

**Tổng Internal SRAM worst-case:**

$$SRAM_{WC} = SRAM_{always} + SRAM_{reserve} + TCB + Queue + cJSON + System$$

$$= 16 + 32 + 3{,}5 + 2{,}5 + 18{,}3 + 20 \approx \mathbf{92 \text{ KB}}$$

> **Đánh giá:** ESP32-S3 có 512 KB Internal SRAM; sau khi WiFi + BT stack chiếm ≈ 192 KB, vùng khả dụng ≈ 320 KB. Heap watermark 92 KB chiếm **28,8%** vùng available — còn biên độ an toàn tốt. Khi WiFi và BLE đồng thời overhead có thể tăng thêm 30–50 KB.

---

## 5. Điểm Nghẽn và Rủi ro Kỹ thuật (Bottlenecks)

### 5.1 Nghẽn UART — Zigbee (Nút thắt Chủ yếu)

Tại 115.200 bps, UART mất **10,5 ms** để truyền frame HEX phản hồi gói Zigbee trong khi chu kỳ air chỉ **5 ms**. Xác suất mất gói khi gateway nhận liên tục với tốc độ tối đa không kịp drain buffer:

$$\frac{T_{UART}}{T_{cycle,air}} = \frac{10{,}5}{5{,}0} = 2{,}1 \implies \text{UART chỉ phục vụ được } \frac{1}{2{,}1} \approx 48\% \text{ lượng gói air}$$

**Hệ quả:** Listener buffer 512 byte bắt đầu tích lũy sau $T_{fill} = 512 \times 10 / 115.200 = 44{,}4 \text{ ms}$. Với batch flush 50 ms, margin chỉ **5,6 ms** — nguy cơ tràn buffer ở tải cao.

### 5.2 Tràn WAN Uplink Queue

WAN Uplink Queue depth = **5 item**. Nếu WAN MCU bận FOTA (flash write ≈ 100 ms/block) hoặc mất kết nối MQTT:

$$T_{queue\_full} = 5 \text{ item} \times T_{batch} = 5 \times 50 = 250 \text{ ms trước khi tràn}$$

Sau khi tràn, toàn bộ dữ liệu đến trong khoảng thời gian FOTA bị mất. Rủi ro tăng cao trong bài test đa kênh đồng thời.

### 5.3 Giới hạn SRAM CC2530 — Zigbee Node Capacity

Khi gateway spam dữ liệu tốc độ cao, CC2530 có thể báo lỗi:
- **Lỗi `0x11`** (Memory Full): Neighbor table đầy → gói mới bị từ chối
- **Lỗi `0x18`** (Not Enough Cache): Buffer nội bộ Z-Stack đầy khi LAN MCU không drain kịp

Tốc độ tối đa trước khi overflow CC2530:

$$R_{CC2530,max} \approx \frac{3.192 \text{ byte}}{1 \text{ entry} \times T_{process}} \implies \text{giới hạn thực tế tại } N = 20 \text{ node (Z-Stack default)}$$

### 5.4 Cách diễn giải Benchmark LoRa tại Gateway

Trong firmware hiện tại, `LR_RX` và `LR_FWD` được tăng theo số byte listener đọc được từ UART module trước khi parse payload. Vì vậy:

- Số `kbps` ở Gateway là **raw UART stream throughput**.
- Số `pkt` ở Gateway là **số chunk listener**, không phải số frame LoRa vật lý.

Điều này giải thích vì sao bài test payload 222 byte có thể cho `LR_RX \approx 8{,}3 \div 9{,}4` kbps trong khi node phát chỉ đạt `\approx 4{,}0` kbps payload thực tế.

### 5.5 Không đồng bộ LDRO — LoRa SF ≥ 11

Low Data Rate Optimize (LDRO) phải được bật **đồng thời** trên cả node phát và Gateway thu khi SF ≥ 11. Nếu không khớp:

$$T_s^{SF11,125kHz} = \frac{2^{11}}{125.000} = 16{,}384 \text{ ms} \implies \text{symbol quá dài, chip đồng hồ lệch pha}$$

Gateway sẽ nhận gói lỗi hoặc không nhận được gì. Lệnh cấu hình: `AT+LW=LDRO,ON` phải được gửi trước `AT+TEST=RFCFG` trên cả hai đầu.

### 5.6 SPI Buffer Overflow khi FOTA

SPI Slave RX buffer: 16.384 byte. Thời gian lấp đầy ở tốc độ tối đa:

$$T_{overflow,SPI} = \frac{16.384 \times 8}{10 \times 10^6} = 13{,}1 \text{ ms}$$

WAN MCU trong khi flash write FOTA bị block ≈ 100 ms → SPI buffer tràn 7,6 lần. **Khuyến nghị:** Assert tín hiệu GPIO BUSY từ WAN về LAN để tạm dừng SPI khi flash write.

---

## 6. Thiết lập Kịch bản Kiểm thử Thực tế

### 6.1 Kịch bản Đơn kênh — Max Bandwidth Test

Từng node (Zigbee, LoRa, BLE) gửi dữ liệu liên tục với tốc độ tối đa.

**Cấu hình LoRa TEST/P2P** (thực hiện trên cả node phát lẫn Gateway thu cho bài benchmark max-throughput hiện tại):

```
AT+MODE=TEST
AT+TEST=RFCFG,868,SF7,125,12,12,14,ON,OFF,OFF
AT+TEST=RXLRPKT
```

Node phát gửi liên tiếp `AT+TEST=TXLRPKT,"001122..."` và chờ `+TEST: TX DONE` trước khi gửi tiếp.

**Chỉ số đánh giá:** Thông lượng thực đo (byte/s tại LAN MCU và tại server), PDR, mã lỗi phần cứng (`0x11`, `0x18` cho Zigbee), RSSI và SNR cho LoRa.

**Kết quả baseline kỳ vọng:**

| Giao thức | Thông lượng vào LAN MCU | PDR kỳ vọng |
| :--- | :---: | :---: |
| **Zigbee** | $\approx 80 \text{ kbps}$ | $> 95\%$ |
| **LoRa SF7/125 (P2P, payload 222 B)** | $\approx 4{,}0 \text{ kbps}$ | $> 99\%$ |
| **LoRa SF7/125 (Gateway LR\_RX)** | $\approx 8{,}3 \div 9{,}4 \text{ kbps}$ | $> 99\%$ |
| **LoRa SF7/250 (P2P)** | $\approx 6{,}1 \text{ kbps}$ | $> 99\%$ |
| **BLE (DLE bật)** | $\approx 97{,}6 \text{ kbps}$ | $> 99\%$ |

### 6.2 Kịch bản Đa kênh Đồng thời — Concurrency Test

Ba node (Zigbee, LoRa, BLE) cùng spam dữ liệu tối đa. **Mục tiêu:** Đánh giá thông lượng LAN→WAN tổng hợp, tranh chấp SPI bus giữa các Uplink task, năng lực xử lý đa luồng FreeRTOS, và ngưỡng tràn WAN Uplink Queue.

#### 6.2.1 Thông lượng LAN → WAN — Lý thuyết

Tổng thông lượng vào LAN MCU từ 3 giao thức chạy đồng thời:

$$\boxed{R_{total,theory} = R_{Zigbee} + R_{BLE,DLE} + R_{LoRa,SF7/125} = 80 + 97{,}6 + 3{,}5 = 181{,}1 \text{ kbps}}$$

Dữ liệu tích lũy tại LAN MCU trong một batch interval ($T_{batch} = 50 \text{ ms}$):

| Giao thức | Thông lượng | Dữ liệu/batch |
| :---: | :---: | :---: |
| Zigbee | 80 kbps | $80.000 / 8 \times 0{,}050 = 500 \text{ byte}$ |
| BLE (DLE) | 97,6 kbps | $97.600 / 8 \times 0{,}050 = 610 \text{ byte}$ |
| LoRa SF7/125 | 3,5 kbps | $3.500 / 8 \times 0{,}050 \approx 22 \text{ byte}$ |
| **Tổng** | **181,1 kbps** | **≈ 1.132 byte ≈ 1,1 KB** |

Thời gian SPI cần để truyền 1.132 byte sang WAN MCU:

$$T_{SPI,batch} = \frac{1.132 \times 8}{10 \times 10^6} = 0{,}906 \text{ ms}$$

Hệ số sử dụng bus SPI:

$$U_{SPI} = \frac{T_{SPI,batch}}{T_{batch}} = \frac{0{,}906}{50} = \mathbf{1{,}81\%}$$

Thông lượng SPI tối đa lý thuyết tại 10 MHz:

$$R_{SPI,max} = 10 \text{ MHz} \times 1 \text{ byte/8 bit} \times 8 = 10 \text{ Mbps} = 1{,}25 \text{ MB/s}$$

**Kết luận: SPI không phải nút thắt.** Tải thực tế chỉ chiếm **1,81%** capacity SPI, còn dư 55× biên độ.

#### 6.2.2 Thông lượng LAN → WAN — Thực tế (Sau tranh chấp và Queue)

Thông lượng thực tế bị suy giảm bởi ba yếu tố:

1. **SPI bus arbitration:** 3 Uplink task (Zigbee P5, BLE P5, LoRa P5) cùng ưu tiên tranh nhau mutex SPI → task nào đến trước chiếm bus, task kia block chờ → overhead scheduling.

2. **FreeRTOS context switching:** Mỗi lần task block/unblock tốn $T_{ctx} \approx 3{,}5 \; \mu\text{s}$. Với $N$ lần tranh chấp/batch:
$$T_{arbitration} = N \times T_{ctx} \approx N \times 3{,}5 \; \mu\text{s}$$

3. **WAN Uplink Queue (depth = 5) saturation:** Queue chứa được tối đa:
$$N_{queue,capacity} = 5 \text{ item} \Rightarrow T_{buffer,max} = 5 \times T_{batch} = 250 \text{ ms}$$
Nếu WAN MCU bận liên tục > 250 ms (ví dụ FOTA), queue tràn và mất dữ liệu.

**Thông lượng LAN→WAN thực tế kỳ vọng:**

$$\boxed{R_{LAN\to WAN,practical} \approx (70 \div 85\%) \times 181{,}1 \approx 127 \div 154 \text{ kbps}}$$

#### 6.2.3 Bảng Kỳ vọng Concurrency Test

| Chỉ số | Lý thuyết | Thực tế kỳ vọng |
| :--- | :---: | :---: |
| Tổng thông lượng vào LAN MCU | $181{,}1 \text{ kbps}$ | $181{,}1 \text{ kbps}$ (không suy hao) |
| Tải SPI bus (LAN→WAN) | $181{,}1 \text{ kbps}$ | $127 \div 154 \text{ kbps}$ ($70 \div 85\%$) |
| Hệ số sử dụng SPI | $1{,}81\%$ | $< 5\%$ (vẫn rất thấp) |
| PDR toàn hệ thống | — | $> 85\%$ |
| Thời gian queue đầy (khi WAN bận) | — | $\geq 250 \text{ ms}$ |

> **Nhận xét:** Suy giảm 15–30% thông lượng chủ yếu đến từ Zigbee do buffer 512 byte có thể tràn khi LoRa và BLE chiếm queue và WAN MCU không kịp drain. LoRa và BLE ít bị ảnh hưởng hơn do thông lượng thấp (LoRa) và native stack (BLE).

---

*Tài liệu tính toán chi tiết dành cho đối chiếu nội bộ và luận văn tốt nghiệp. Tài liệu tóm tắt để đưa vào báo cáo: `summarize_calc.md`.*
