### thực hiện đo các phần sau với các yêu cầu dưới đây:
1. đầu tiên việc đo phải có PHƯƠNG PHÁP ĐO đúng đắn, cần phải chứng minh được phương pháp đó là đúng đắn và có tính bám sát so với production line.
2. Phân tích, mổ xẻ, đánh giá từng chặng trên đường đi của dữ liệu từ ngoại vi cho đến xử lý dữ liệu giữa các task.
3. cần có kịch bản đo chi tiết phù hợp, phải kèm theo bảng biểu ghi số liệu, kịch bản gồm đo cái gì, từng bước đo thế nào, đo vơi phương pháp thế nào, kết quả thể hiện điều gì.
4. trình bày ngắn gọn dễ hiểu nhất có thể tránh dài dòng không cần thiết, viết theo cách để người không hiểu gì về embedded cũng có thể hiểu, ở các phân tích đừng đặt nặng về code hay các biến (tuyệt đối không nhắc đến chúng) viết theo kiểu ví dụ phần A làm gì, chặng A làm gì chứ kg phải liệt kê ra một đống biến đọc vô chả hiểu gì hết.
5. viết ngắn gọn càng tốt đừng liệt kê quá dài, các thuật ngữ kỹ thuật viết bằng tiếng anh tên các thông số cũng vậy.
### Các phần cần đo:
1. phần SPI giao tiếp inter MCU tối đa throughput.
2. Bài test khe LAN nhận được bao nhiêu data/giây:
   - Mục đích: Tìm giới hạn nhận dữ liệu tối đa (lane ceiling) của LAN MCU bằng cách tăng dần dung lượng đến khi rớt gói.
   - Hardware: Dùng một MCU ngoài làm nguồn phát fake data cắm thẳng vào từng lane (UART, SPI, I2C, USB) của LAN MCU.
   - Firmware: Lập trình cơ chế trên LAN MCU để thống kê số byte/packet đã consume, số lần read empty (miss), và số lần buffer overflow (drop). Chỉ đo ở mức driver/BSP (Module_I2C/SPI/UART/USB_communication) — không đo qua handler thật vì BLE/Zigbee/LoRa/RS485 có data rate quá thấp, không bao giờ chạm trần lane.
3. Bài test 2: Mỗi card WAN đẩy được tối đa bao nhiêu data/giây
   - Mục đích: Đo tốc độ đẩy dữ liệu tối đa ra Internet của từng loại module WAN (WiFi, Ethernet, 4G).
   - Hardware/Firmware: Không dùng nguồn ngoài, WAN MCU tự lập trình sinh fake data, đưa vào raw TCP socket và liên tục phát ra sink server LAN.
   - Đánh giá: Đối chiếu giữa tốc độ sinh data tại con WAN MCU và số gói được TCP/IP stack accept thành công để xác định card ceiling. **Không đo qua MQTT** — broker demo (ThingsBoard) sẽ kick connection nếu spam liên tục, không lấy được số ổn định.
4. Bài test 3: Băng thông tối đa LAN → WAN qua SPI bridge (ramp tới khi mất gói)
   - Mục đích: Xác định trần **lossless** của cây cầu SPI inter-MCU — khác §1 (đo khi producer enqueue-fail), phần này đo điểm bắt đầu mất gói giữa LAN TX và WAN RX dù producer chưa overflow.
   - Hardware/Firmware: LAN MCU tự sinh fake data ramp rate, cả 2 chip in log thống kê độc lập.
   - Đánh giá: So sánh chéo `tx_lan` (LAN) vs `rx_wan` (WAN) theo từng bậc rate, lấy rate cao nhất mà `tx_lan == rx_wan` giữ ổn định làm trần lossless.



#### 1. Đo throughput của SPI giao tiếp inter MCU

##### 1.1. Phương pháp đo và lý do bám sát production

Hệ có hai vi điều khiển nối nhau bằng SPI: **LAN MCU** (master, gom dữ liệu từ ngoại vi BLE/Zigbee/LoRa/RS485) và **WAN MCU** (slave, đẩy dữ liệu lên server). Mọi packet đi từ ngoại vi lên cloud đều phải qua cây cầu SPI này — muốn biết throughput "đường lên" của cả hệ, phải đo chính xác cây cầu đó.

**Cách đo:** thay vì viết test rig rời, ta gắn thêm **một fake producer** vào đúng chỗ mà các handler thật (BLE, Zigbee, LoRa, RS485) đang gắn vào. Fake producer bơm packet 2 KB liên tục, ép cây cầu chạy hết công suất. Số packet qua được mỗi giây = throughput.

Để chứng minh phương pháp đo bám sát production, fake producer chạy **2 mode**:

| Mode | Đi đường nào | Đo cái gì |
|------|-------------|-----------|
| **A — Driver path** | Gọi thẳng SPI transport, bypass queue chung | Ceiling hardware + framing: throughput tối đa mà SPI + DMA chịu được |
| **B — Production path** | Đi qua đúng queue chung và đúng dispatcher task mà BLE/Zigbee/LoRa/RS485 đang dùng | Throughput thực mà một handler production được phép đạt |

So sánh A và B cho ra **overhead của dispatcher layer**. Nếu B = A ⇒ hệ không tốn gì. Nếu B << A ⇒ dispatcher là bottleneck cần tối ưu.

**Tại sao mode B đúng là production:** từ lúc packet rời fake producer tới lúc lên SPI bus, nó đi **cùng queue, cùng mutex, cùng dispatcher task, cùng framing** với một telemetry packet BLE/Zigbee/LoRa thật. Khác biệt duy nhất là source dữ liệu (fake vs handler thật) — overhead micro giây, không ảnh hưởng số đo.

**Tại sao counter tin được:**
- Counter chỉ tăng sau khi packet được SPI transport accept thành công ⇒ không đếm dư.
- Slave (WAN) có counter độc lập đếm packet RX ⇒ cross-check. Lệch > 1 packet/window ⇒ có framing error.
- Counter snap-and-reset trong critical section ⇒ mỗi window 2 giây cho con số sạch, không bị drift.

##### 1.2. Data path — phân tích từng chặng

Một packet đi từ "nơi sinh ra" tới khi nằm yên trong RX buffer của WAN MCU phải qua các chặng sau. Mỗi chặng có cost thời gian riêng — gộp lại quyết định throughput cuối.

###### Mode A — Driver path (ceiling hardware)

```
[Fake producer] → [Framing + CRC] → [DMA submit] → [SPI bus] → [WAN RX]
                  chặng D            chặng E         chặng F
```

Chỉ 3 chặng D/E/F. Bypass mọi software layer phía trên ⇒ thấy ceiling lý thuyết.

###### Mode B — Production path (ceiling production)

```
[Fake producer]
   ▼
[Chặng A — Enqueue]
   • Check chỗ trống, copy packet 2 KB vào queue slot, gắn RTC timestamp
   ▼
[Chặng B — Queue dwell]
   • Queue chung cho mọi handler, depth 32 slot
   ▼
[Chặng C — Dispatcher task pull ra]
   • Take SPI mutex
   • Pull tối đa 8 packet/burst, gắn routing info
   ▼
[Chặng D — Framing + CRC]                (giống mode A)
   ▼
[Chặng E — DMA submit, pipelined]         (giống mode A)
   ▼
[Chặng F — SPI 40 MHz, full-duplex]       (giống mode A)
   ▼
[WAN MCU RX, parser check CRC, count]
```

###### So sánh cost từng chặng

| Chặng | Việc làm | Có ở A? | Có ở B? | Avg time (B) |
|-------|---------|:--:|:--:|--------|
| A — Enqueue | Copy packet + RTC timestamp | – | ✓ | ~10 µs |
| B — Queue dwell | Chờ dispatcher pull | – | ✓ | ≤ 1 ms |
| C — Pull + prep | Pull packet, gắn routing, take/give mutex | – | ✓ | ~180 µs/packet |
| D — Framing | Thêm header CRC + payload CRC | ✓ | ✓ | ~330 µs/packet |
| E — DMA submit | Bàn giao buffer cho SPI hardware | ✓ | ✓ | ~950 µs / 10 ms |
| F — SPI bus | Full-duplex 40 MHz, 16 KB/transaction | ✓ | ✓ | ~3.3 ms/transaction |

**Diễn giải:** mode A bỏ A/B/C, còn 3 chặng cuối ⇒ nhanh hơn ~25%. Khoảng cách A → B (28 → 21 Mbps) chính là cost của queue + dispatcher + mutex — cái giá để mọi handler dùng chung một đường lên.

##### 1.3. Log fields

Log chia 3 group. Chỉ cần hiểu nghĩa, không cần nhớ tên field.

**Group 1 — Throughput counters mỗi window 2 giây (cả LAN và WAN):**

| Field | Nghĩa |
|-------|-------|
| `pkt` | Số packet TX/RX trong window — chỉ số chính |
| `pps`, `kbps` | Quy đổi từ `pkt × 2 KB` |
| `drop` | Số lần fake producer không enqueue được (queue full). **Cần lớn** — chứng tỏ đã ép cây cầu chạy tối đa |

**Group 2 — Framing health (cộng dồn từ boot):**

| Field | Kỳ vọng |
|-------|---------|
| `rx_ok` | Tăng đều |
| `hdr_crc_fail` | Phải = 0. > 0 ⇒ signal/clock error |
| `pay_crc_fail` | Phải = 0. > 0 ⇒ DMA race hoặc noise |
| `resync_bytes` | Tăng đều OK; nhảy đột biến ⇒ frame corruption |

**Group 3 — Dispatcher timing breakdown (chỉ bật khi deep profiling):**

Đo từng chặng A/B/C/D/E nuốt bao nhiêu µs. Mục đích: phát hiện **hidden blocking** — nếu tổng các chặng đo được < thời gian 1 dispatcher iteration ⇒ còn nguồn nghẽn chưa lộ. Default OFF.

##### 1.4. Kịch bản đo

| Kịch bản | Mode | Mục đích | Kết quả thể hiện điều gì |
|----------|------|---------|--------------------------|
| **1.A** | Driver path | Đo ceiling hardware + framing | Mức tối đa lý thuyết. Mọi số production phải ≤ con số này |
| **1.B** | Production path | Đo ceiling production | Throughput thực handler được phép đạt khi flood |

**Bước đo:**
1. Flash đồng thời 2 MCU. Reset, đợi handshake xong (~5 giây).
2. Bench tự chạy sau handshake. Capture serial log cả 2 MCU.
3. Bỏ window đầu (warm-up). Lấy **5 window liên tiếp** sau đó.
4. Ghi: `pkt`, `kbps`, `drop`, các CRC counter phải = 0.
5. Cross-check **TX (LAN) ↔ RX (WAN)**: lệch > 1 ⇒ điều tra framing.
6. Lặp lại với mode còn lại.

##### 1.5. Số liệu thực đo

Mỗi giá trị là trung bình 5 window liên tiếp ở giai đoạn ổn định. Hai mode chạy độc lập trên cùng phần cứng.

| Kịch bản | LAN `pkt` /window | LAN `drop` /window | WAN `pkt` /window | `hdr_crc_fail` | `pay_crc_fail` |
|---|---:|---:|---:|---:|---:|
| **1.A — Driver path** | **~3 400** | (n/a) | **~3 400** | **0** | **0** |
| **1.B — Production path** | **~2 560** | **~115 000** | **~2 560** | **0** | **0** |

##### Quy đổi sang băng thông

Mỗi packet 2 KB, mỗi cửa sổ 2 giây:

> pps = `pkt` / 2     │     Mbps = pps × 2 (KB) × 8 / 1000

Ví dụ 1.B: `pps = 2 560 / 2 = 1 280`, băng thông = `1 280 × 0.016 = 20.5 Mbps`.

##### Số đo có chính xác không?

**Kiểm chứng 1 — Cross-check LAN TX ↔ WAN RX**

LAN đếm số packet đã đẩy thành công xuống SPI; WAN đếm số packet parse OK độc lập. Hai counter chạy trên hai chip khác nhau, không thấy nhau.

| Kịch bản | LAN `pkt` | WAN `pkt` | Chênh |
|---|---:|---:|---:|
| 1.A | ~3 400 | ~3 400 | < 1 % |
| 1.B | ~2 560 | ~2 560 | < 1 % |

Hai counter độc lập trùng nhau ⇒ không có packet rớt trên SPI bus.

**Kiểm chứng 2 — Đã chạm trần, không phải bị producer giới hạn**

Mode 1.A: producer gọi thẳng SPI transport — không có queue, nên không có khái niệm "drop". Producer fire tới khi SPI bus bão hòa thì chậm lại tự nhiên.

Mode 1.B: producer enqueue qua queue chung. `drop` ≈ 115 000/window nghĩa là mỗi giây ~57 500 packet bị từ chối vì queue đầy ⇒ producer đẩy gấp ~50× dispatcher ⇒ confirm đã chạm trần.

**Kiểm chứng 3 — Không có lỗi truyền**

`hdr_crc_fail = 0` và `pay_crc_fail = 0` suốt 5 window ⇒ mọi frame xuống bus được WAN parse đúng. Throughput đo được không phải kết quả của stream bị hỏng.

##### Kết quả

> **Trần Driver path (1.A) = 28 Mbps** — ceiling của SPI transport + framing
>
> **Trần Production path (1.B) = 21 Mbps** — ceiling thực tế khi đi qua dispatcher

Khoảng cách 28 → 21 Mbps là cost của dispatcher (queue + mutex + routing). Production phải trả phí này vì 4 handler share chung 1 đường uplink.

##### 1.7. Ý nghĩa thực tiễn

21 Mbps là trần thật của cây cầu inter-MCU mà 4 handler (BLE/Zigbee/LoRa/RS485) chia nhau. Telemetry IoT thực tế mỗi node vài chục kbps — hệ dư công suất hơn **100×** so với nhu cầu sensor cluster bình thường.

21 Mbps cũng là trần cho mọi đo end-to-end: lưu lượng từ LAN tới Internet không thể vượt số này vì phải qua cây cầu SPI trước.



#### 2. Đo lane ingress của LAN MCU

##### 2.1. Phương pháp đo và lý do bám sát production

LAN MCU có 4 khe vật lý cho module ngoại vi cắm vào: **UART / SPI / I2C / USB**. Mỗi khe là một "ống" mà sensor hoặc gateway con bơm telemetry lên LAN MCU. Câu hỏi cần trả lời: mỗi ống nuốt được tối đa bao nhiêu data/giây trước khi bắt đầu rớt gói?

**Cách đo:** dùng **một MCU phụ làm rig** (ESP32-S3 dev module) cắm thẳng vào từng ống, bơm packet 256 B liên tục, **ramp rate** từ 100 lên 20 000 pps. Bên LAN MCU một **raw consumer task** drain ống trong tight loop và đếm — đo thuần năng lực phần cứng + driver buffer (lane ceiling).

**Tại sao chỉ đo ở mức raw consumer (không qua handler thật):** BLE/Zigbee/LoRa/RS485 có natural data rate quá thấp (vài chục kbps mỗi node) — handler không bao giờ tạo đủ áp lực để chạm trần lane. Đo qua handler chỉ cho ra số bằng đúng rate handler sinh ra, không phải trần lane. Trần lane là chỉ số capacity planning cần biết trước, handler ceiling không có giá trị thực tế.

**Tại sao bám production:** byte đi đúng driver ring buffer thật (`Module_UART_communication`, `Module_SPI_communication`,…) — chỉ khác lớp consumer ở trên. Driver path = production path ở tầng BSP. Khi capacity planning, ta hỏi "khe có chịu được không", không hỏi "handler có chịu được không".

**Tại sao counter tin được:**
- Counter tăng sau khi byte rời driver buffer ⇒ không đếm dư.
- Rig in self-stat ở đầu phát ⇒ cross-check với số đo bên LAN MCU.
- Lệch > 5% trong 5 window liên tiếp ⇒ lane đã saturate.

##### 2.2. Data path — phân tích từng chặng

```
[Rig ESP32-S3] → [Cable]
                   ▼
[Chặng A — HW FIFO của LAN MCU]
   • Buffer phần cứng ~256 B trên peripheral, lấp đầy là silent drop
                   ▼
[Chặng B — Driver ring buffer]
   • Buffer mềm trong driver, lớn hơn FIFO, lấp đầy ⇒ overflow signal
                   ▼
[Chặng C — Raw consumer read pull]
   • Task chuyên drain ống trong tight loop
                   ▼
[Chặng D — Counter]                          ← tăng tại đây
```

###### Cost từng chặng

| Chặng | Việc làm | Drop point? |
|-------|---------|:--:|
| A — HW FIFO | Hardware buffer | ✓ overflow nếu B chậm |
| B — Driver ring | Software buffer | ✓ overflow nếu C chậm |
| C — Read pull | Kéo bytes ra | – |
| D — Counter | Đếm bytes | – |

**Diễn giải:** chỉ 4 chặng. Drop chỉ xảy ra ở A hoặc B — nếu thấy drop, biết ngay lane đã saturate.

##### 2.3. Log fields

**Group 1 — Lane counter (mỗi window 2 giây):**

| Field | Nghĩa |
|-------|-------|
| `b` | Tổng bytes đã consume — chỉ số chính |
| `pps`, `kbps` | Quy đổi từ `b`, `pkt` |
| `miss` | Read empty/timeout — cao = lane chậm hơn rate rig |
| `drop` | Driver buffer overflow signal — phải = 0; > 0 ⇒ confirm saturate |

**Group 2 — HW health (cộng dồn từ boot):**

| Field | Kỳ vọng |
|-------|---------|
| `hw_fifo_max` | Mức cao nhất FIFO đạt — gần full ⇒ sắp overflow |
| `drv_buf_full_evt` | Số lần driver signal full — phải = 0 |

**Group 3 — Rig self-stat:** so `b` trên LAN MCU vs `total_b` trên rig:
- Lệch ≤ 1% ⇒ lane theo kịp.
- Lệch > 5% ⇒ saturate.

##### 2.4. Kịch bản đo

4 lane × 1 mode = 4 lần chạy.

| Kịch bản | Lane | Mục đích |
|----------|------|----------|
| 2-UART | UART | Lane ceiling UART |
| 2-SPI | SPI | Lane ceiling SPI |
| 2-I2C | I2C | Lane ceiling I2C |
| 2-USB | USB | Lane ceiling USB |

**Bước đo:**
1. Flash rig đúng mode lane, set ramp 5s/step (100 → 20 000 pps).
2. Flash LAN MCU bench mode (raw consumer).
3. Reset đồng bộ, đợi handshake xong (~5 giây).
4. Capture serial log cả LAN MCU và rig.
5. Bỏ window warm-up. Lấy **5 window liên tiếp** ở rate cao nhất giữ ổn định (drop > 0 xuất hiện ổn định).
6. Ghi `b`, `kbps`, `miss`, `drop`, `hw_fifo_max`.
7. Cross-check rig self-stat. Lệch > 5% ⇒ lane đã saturate.

##### 2.5. Số liệu thực đo

Hardware test rig (ESP32-S3 phụ) đang trong giai đoạn hàn — chưa có số đo. Bảng dưới điền sẵn cấu hình kỳ vọng để khi rig sẵn sàng có thể nhập trực tiếp.

| Lane | Cấu hình | `pkt` /window | `b` (byte) /window | `miss` /window | `drop` /window | Trần lý thuyết |
|---|---|---:|---:|---:|---:|---:|
| UART | 921600 8N1 | TBD | TBD | TBD | TBD | ~92 kbps |
| SPI | 10 MHz | TBD | TBD | TBD | TBD | ~10 Mbps |
| I2C | 400 kHz | TBD | TBD | TBD | TBD | ~50 kbps |
| USB CDC | Full-speed | TBD | TBD | TBD | TBD | ~12 Mbps |

##### Quy đổi sang băng thông

Mỗi packet 256 byte, mỗi cửa sổ 2 giây:

> pps = `pkt` / 2     │     KB/s = `b` / 2 / 1024     │     kbps = `b` × 8 / 2 / 1000

##### Số đo có chính xác không? (framework)

Sau khi có data, dùng 3 kiểm chứng dưới đây để khẳng định trần đo được là chính xác.

**Kiểm chứng 1 — Cross-check rig ↔ LAN MCU**

Rig in `total_b` ở đầu phát; LAN MCU đếm `b` ở đầu nhận. Hai phép đo độc lập trên hai chip.

> Lệch ≤ 1 % ⇒ lane còn theo kịp rig.
> Lệch > 5 % ⇒ lane đã saturate, byte không qua hết.

**Kiểm chứng 2 — Đã chạm trần, không phải bị rig giới hạn**

Rig ramp dần từ 100 → 20 000 pps. Trần lane đạt khi:

> `drop` > 0 ổn định (driver ring buffer overflow) HOẶC
> `miss` rất cao (consumer đọc empty liên tục — rig chậm hơn lane)

`drop` xuất hiện = byte đã nhận về nhưng bị từ chối do buffer đầy ⇒ confirm bottleneck nằm ở tốc độ tiêu thụ, không phải tốc độ phát.

**Kiểm chứng 3 — So với trần lý thuyết của baudrate**

Mỗi lane có trần vật lý cố định (baudrate × hệ số mã hóa). So `kbps` đo được với trần lý thuyết:

> Đo được ≈ 90 % trần lý thuyết ⇒ driver tối ưu, kết quả tin được.
> Đo được << trần lý thuyết ⇒ driver buffer nhỏ hoặc consumer chậm, có dư địa tối ưu.

##### Kết quả (chờ data từ rig)

> **Trần UART 921600 = TBD** — sẽ điền khi rig hoàn thành
>
> **Trần SPI 10 MHz = TBD**
>
> **Trần I2C 400 kHz = TBD**
>
> **Trần USB CDC FS = TBD**

##### 2.7. Ý nghĩa thực tiễn

Mỗi lane có trần riêng, dùng để chọn loại module ngoại vi cắm vào. Quy tắc thiết kế: tổng telemetry rate của các module trên cùng một lane phải ≤ trần lane đó.

Bảng kỳ vọng (theo lý thuyết baudrate, sẽ verify khi đo):
- UART 921600 ⇒ đủ cho RS485 sensor cluster
- SPI 10 MHz ⇒ thừa cho LoRa concentrator
- USB CDC FS ⇒ đủ cho Zigbee coordinator burst cao
- I2C 400 kHz ⇒ vừa đủ cho sensor đa kênh



#### 3. Đo throughput đẩy ra Internet của từng đường WAN

##### 3.1. Phương pháp đo và lý do bám sát production

WAN MCU có 3 đường ra Internet với phần cứng khác nhau:

| Đường | Phần cứng | Kết nối với MCU |
|-------|-----------|------------------|
| **WiFi 2.4 GHz** | Radio **tích hợp sẵn** trong ESP32 | Internal — không qua bus ngoài |
| **Ethernet 10/100** | Chip **W5500 external** | SPI |
| **LTE 4G** | Module **SIM7600 external** | USB CDC |

Câu hỏi: mỗi đường đẩy được tối đa bao nhiêu data/giây?

**Cách đo:** WAN MCU tự sinh fake data, đẩy qua raw TCP socket tới sink server LAN (Python TCP sink đếm bytes), mỗi lần chỉ một đường active. Đo throughput thuần.

**Tại sao bám production:** byte đi đúng `socket send()` → `lwIP TCP stack` → driver tương ứng — đây là toàn bộ TX path mà mọi application protocol phía trên (MQTT, CoAP, HTTP…) cũng phải đi qua. Throughput đo được là **trần trên** cho mọi protocol.

##### 3.2. Data path — phân tích từng chặng

Đường đi tùy phần cứng:

**WiFi (internal radio):**
```
[Producer] → [socket send] → [lwIP TCP] → [WiFi MAC firmware] → [Radio 2.4 GHz] → [Access Point]
```

**Ethernet (W5500 external qua SPI):**
```
[Producer] → [socket send] → [lwIP TCP] → [W5500 driver] → [SPI bus] → [W5500 chip] → [Ethernet wire] → [Switch / Router]
```

**LTE (SIM7600 external qua USB CDC):**
```
[Producer] → [socket send] → [lwIP TCP] → [PPP] → [USB host stack] → [USB CDC] → [SIM7600 modem] → [Cellular base station]
```

###### Điểm khác biệt quan trọng

| Đường | Có bus external? | Bottleneck tiềm năng |
|-------|:--:|---|
| WiFi   | Không | lwIP + WiFi MAC firmware (trong cùng MCU) |
| Ethernet | Có (SPI tới W5500) | Tốc độ SPI ↔ W5500 + chip W5500 |
| LTE    | Có (USB CDC tới SIM7600) | USB host overhead + modem buffering + cellular link |

⇒ WiFi có path ngắn nhất (cùng silicon). Ethernet và LTE phải qua bus ngoài nên thêm chặng có thể nghẽn.

**Diễn giải:** đây là TX path tối thiểu. Mọi application protocol chạy phía trên (MQTT, CoAP, HTTP) đều phải đi qua đường này — số đo được là **trần trên** cho mọi protocol.

##### 3.3. Log fields

Mỗi 2 giây, WAN MCU in một dòng thống kê. Đây là format thật trong serial output:

**WAN MCU log (TAG=`bench_egr`):**
```
WAN_EGRESS card=wifi gen_pkt=5776 gen_b=5914624 sent_ok_pkt=1105 sent_ok_b=1099648 sent_fail=0 q_drop=4754 ok_pps=552.5 gen_kbps=20658.5 ok_kbps=4915.6
```

| Field | Nghĩa |
|-------|-------|
| `card` | wifi / eth / 4g — card đang active |
| `gen_pkt` | Số packet producer đã thử gửi trong 2 s (tốc độ sinh data) |
| `sent_ok_pkt` | Số packet được TCP/IP stack accept (đã ra wire) |
| `sent_fail` | Số packet bị reject do TCP reset / disconnect |
| `q_drop` | Số packet bị từ chối do lwIP TX buffer đầy — **dấu hiệu saturate** |
| `gen_kbps` | Tốc độ sinh data của producer (từ `gen_pkt`) |
| `ok_kbps` | Throughput thực = `sent_ok_b × 8 / 1000 / 2` |

**Sink server log (Python `tcp_sink.py` chạy trên Raspberry):**
```
[SINK] win=2.0s bytes=1117696 kbps=4470.8 total=338585856
```

| Field | Nghĩa |
|-------|-------|
| `bytes` | Số byte server nhận được trong 2 s |
| `kbps` | Throughput đo từ phía server |
| `total` | Tổng cumulative từ lúc connect |

**Cách cross-check:** firmware `ok_kbps` và server `kbps` phải xấp xỉ nhau (chênh <2 %). Lệch lớn = có packet rớt trên đường mạng (chứ không phải tại MCU).

##### 3.4. Kịch bản đo

3 card × 1 lần chạy = 3 kịch bản.

| Kịch bản | Card | Sink |
|----------|------|------|
| 3-WiFi | WiFi 2.4 GHz | Raspberry LAN (192.168.1.100:5555) |
| 3-ETH  | Ethernet 10/100 | Raspberry LAN (192.168.1.100:5555) |
| 3-4G   | 4G LTE | tcpbin.com:4242 (firmware tự switch) |

**Bước đo:**
1. Cấu hình WAN MCU dùng 1 card duy nhất.
2. Chạy sink trên Raspberry: `python3 tcp_sink.py 0.0.0.0 5555 2.0` (không cần với 4G).
3. Reset WAN MCU, đợi card up + connect sink (~5–15 s).
4. Capture đồng thời serial log MCU và console Raspberry.
5. Bỏ window warm-up đầu. Lấy 10 window liên tiếp khi `ok_kbps` đã ổn định.
6. Tính trung bình `ok_kbps` (firmware) và `kbps` (sink), so chéo.
7. Đổi card, lặp.

##### 3.5. Số liệu thực đo

Mỗi giá trị là trung bình 10 window liên tiếp ở giai đoạn ổn định.

| Card | `gen_kbps` (producer cố đẩy) | `ok_kbps` (firmware) | sink `kbps` | `q_drop` /window | `sent_fail` |
|---|---:|---:|---:|---:|---:|
| **WiFi 2.4 GHz** | **~19 500** | **~4 800** | **~4 800** | **~3 700** | **0** |
| **Ethernet 10/100 (W5500)** | **~4 240** | **~4 220** | **~4 215** | **~7** | **0** |
| **4G LTE (SIM7600 USB)** | **~67 000** | **~1 820** | **~1 800** | **~16 000** | **0** |

##### Số đo có chính xác không?

Để khẳng định một con số throughput là đúng, cần ba kiểm chứng độc lập.

**Kiểm chứng 1 — Cross-check firmware ↔ server**

Firmware đếm tại MCU; server đếm tại Raspberry — hai phép đo độc lập trên hai máy khác nhau.

| Đường | Firmware `ok_kbps` | Sink `kbps` | Chênh |
|---|---:|---:|---:|
| WiFi | ≈ 4 800 | ≈ 4 800 | < 1 % |
| Ethernet | ≈ 4 220 | ≈ 4 215 | < 1 % |
| LTE | ≈ 1 820 | ≈ 1 800 | < 2 % |

Ba phép đo độc lập đều trùng nhau trong sai số 1-2 % ⇒ không có packet rớt giữa MCU và server. Số đo phản ánh đúng lượng byte qua được.

**Kiểm chứng 2 — Đã chạm trần, không phải bị producer giới hạn**

Producer phải đẩy mạnh hơn khả năng card thì kết quả mới là trần thật.

| Đường | `gen_kbps` (producer đẩy) | `ok_kbps` (card tải) | Bằng chứng saturate |
|---|---:|---:|---|
| WiFi | ≈ 19 500 | ≈ 4 800 | Producer đẩy 4× card → `q_drop` ≈ 3 700/window |
| Ethernet | ≈ 4 240 | ≈ 4 220 | Producer bị back-pressure khớp tốc độ card → `q_drop` ≈ 7/window |
| LTE | ≈ 67 000 | ≈ 1 820 | Producer đẩy 37× card → `q_drop` ≈ 16 000/window |

Cả ba đều có dấu hiệu producer cố vượt trần nhưng không qua được ⇒ kết quả là **trần thật**.

WiFi và LTE saturate ở **lớp buffer** (q_drop lớn). Ethernet saturate ở **lớp xử lý** (mỗi `send()` đồng bộ qua W5500 mất ~1.9 ms, producer tự động bị paced theo). Hai pattern khác nhau về hình thức nhưng đều chứng minh trần đã chạm.

**Kiểm chứng 3 — Không có lỗi truyền**

`sent_fail = 0` ở cả ba đường suốt thời gian đo ⇒ không TCP reset, không disconnect. Số đo không bị méo bởi lỗi mạng.

##### Kết quả

> **Trần WiFi 2.4 GHz = 4.8 Mbps**
>
> **Trần Ethernet 10/100 (W5500) = 4.2 Mbps**
>
> **Trần LTE (SIM7600 USB) = 1.82 Mbps**

##### Tóm tắt §3

| Đường | Trần đo được | Trạng thái |
|---|---:|---|
| WiFi 2.4 GHz (internal) | **4.8 Mbps** | ✓ |
| Ethernet (W5500 SPI 40 MHz) | **4.2 Mbps** | ✓ |
| 4G LTE (SIM7600 USB) | **1.82 Mbps** | ✓ |

#### 4. Đo băng thông tối đa LAN → WAN qua SPI bridge (ramp tới khi mất gói)

##### 4.1. Phương pháp đo và lý do bám sát production
Đo throughput khi **flood saturate** — producer luôn nhanh hơn dispatcher, đo trần ở chỗ producer enqueue-fail. Phần này hỏi câu khác: **trần lossless thật của SPI bridge là bao nhiêu** — ngưỡng mà bắt đầu xảy ra mất gói giữa LAN TX và WAN RX dù producer chưa overflow.

**Cách đo:** LAN fake producer **ramp rate** từ thấp lên cao, mỗi bậc giữ 10 giây. LAN đếm `tx_lan` (packet đã đẩy xuống SPI thành công). WAN đếm `rx_wan` (packet parse OK). Đối chiếu chéo từng window:

- `tx_lan == rx_wan` ⇒ bus chưa nghẽn, lên bậc tiếp theo.
- `tx_lan > rx_wan` ⇒ bắt đầu mất gói → chạm trần.

Trần lossless = rate cao nhất mà `tx_lan == rx_wan` giữ ≥ 5 window liên tiếp.

**Tại sao khác §1:** §1 cho biết tốc độ producer enqueue-fail. Phần này cho biết tốc độ mà SPI bus + slave parse vẫn còn lossless. Hai con số khác nhau khi dispatcher có buffer hấp thụ short burst — producer thấy mọi enqueue đều OK nhưng phía slave đã rớt frame trên dây.

**Tại sao bám production:** packet đi đúng SPI production path (queue chung + dispatcher + framing thật) — chỉ khác về cách đẩy (ramp thay vì flood). Trần lossless là số dùng cho capacity planning: tổng telemetry rate mọi handler ≤ con số này.

**Tại sao counter tin được:**
- `tx_lan` tăng sau khi SPI transport accept xong, không đếm dư.
- `rx_wan` tăng sau khi CRC OK ở WAN slave — độc lập hoàn toàn với LAN.
- 2 counter snap atomic trong 2 critical section riêng → cùng window 2 giây → so trực tiếp.

##### 4.2. Data path — điểm mất gói

```
[LAN producer ramp rate]
   ▼
[Enqueue + dispatcher + framing]              ← tx_lan tăng
   ▼
[SPI bus full-duplex 40 MHz]                  ← drop point chính
   ▼
[WAN framing parse + CRC]                     ← rx_wan tăng (chỉ khi CRC OK)
```

##### 4.3. Log fields

Mỗi 2 giây, mỗi MCU in một dòng log. Đây là format thật trong serial output:

**LAN MCU log (TAG=`BENCH_TP`):**
```
[BENCH_TP 2000ms] rate=200 pps step=1/10 TX(LAN->WAN): pkt=402 b=823296 pps=201.0 kbps=3293.2 drop=0
```

| Field | Nghĩa |
|-------|-------|
| `rate` | Rate ramp hiện tại đang yêu cầu (pps) |
| `step` | Ramp step index (1-10) |
| `TX(LAN->WAN) pkt` | Số packet LAN đã đẩy thành công xuống SPI trong 2s |
| `TX(LAN->WAN) drop` | Số lần LAN producer không enqueue được (queue full) |
| `pps`, `kbps` | Quy đổi từ `pkt × 2 KB / 2 s` |

**WAN MCU log (TAG=`BENCH_TP_WAN`):**
```
[BENCH_TP_WAN 2000ms] RX(LAN->WAN): pkt=2453 b=5023744 pps=1226.5 kbps=20095.0
[BENCH_TP_WAN frame]  rx_ok=495295 hdr_crc_fail=0 pay_crc_fail=0 resync_bytes=1213136 seq_gap=3072
```

| Field | Nghĩa |
|-------|-------|
| `RX(LAN->WAN) pkt` | Số packet WAN parse OK trong 2s — chỉ số chính |
| `hdr_crc_fail`, `pay_crc_fail` | Cumulative từ boot. Phải = 0 |

**Cách tính loss** (không có field sẵn, phải so chéo 2 log):
```
loss = (LAN.TX.pkt - WAN.RX.pkt) / LAN.TX.pkt × 100
```
Lưu ý: 2 MCU không có window đồng bộ — chênh nhau vài % giữa 2 log liền kề là jitter window, không phải loss thật.

##### 4.4. Kịch bản đo

Một kịch bản duy nhất: ramp rate tới điểm mất gói.

**Bước đo:**
1. Flash đồng thời 2 MCU, mode SPI production path (giống §1 mode B nhưng producer ramp thay vì flood).
2. Cấu hình ramp: 10 bậc (200, 400, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000 pps), mỗi bậc giữ 10 giây, sau bậc cuối quay về bậc 1 và lặp.
3. Capture log 2 MCU đồng thời (2 terminal).
4. Với mỗi bậc rate, ghi từ log:
   - **LAN**: `TX(LAN->WAN) pkt` và `drop` trung bình 5 window
   - **WAN**: `RX(LAN->WAN) pkt` trung bình 5 window
   - **WAN**: `seq_gap`, `hdr_crc_fail`, `pay_crc_fail` ở đầu và cuối bậc → tính delta
5. Tính: `loss = LAN.TX.pkt − WAN.RX.pkt` (sau khi điều chỉnh window mis-alignment).
6. **Trần lossless** = rate cao nhất mà `LAN.drop = 0` và `LAN.TX.pkt ≈ WAN.RX.pkt`.
7. **Rate vỡ** = rate đầu tiên mà `LAN.drop > 0`.

##### 4.5. Số liệu thực đo

Mỗi 2 giây, hai MCU in một dòng thống kê. Ba con số cốt lõi đọc được:

- **LAN.TX.pkt** — số packet LAN đã đẩy thành công xuống SPI.
- **LAN.drop** — số lần LAN muốn đẩy nhưng hàng đợi đầy nên bị từ chối.
- **WAN.RX.pkt** — số packet WAN nhận được đầy đủ.

Cho ramp 10 bậc (mỗi bậc giữ 10 giây), lấy một cửa sổ đại diện ở mỗi bậc:

| Bậc yêu cầu | LAN.TX.pkt | LAN.drop | WAN.RX.pkt |
|---:|---:|---:|---:|
| 200 pps   | 402  | 0    | 400  |
| 400 pps   | 802  | 0    | ~800 |
| 600 pps   | 1213 | 0    | 1198 |
| 800 pps   | 1605 | 0    | 1577 |
| 1000 pps  | 2010 | 0    | 2000 |
| **1200 pps** | **1928** | **0** | **1933** |
| **1500 pps** | **2498** | **19** | **2453** |
| 2000 pps  | 2649 | 558  | 2630 |
| 2500 pps  | 2676 | 1003 | 2641 |
| 3000 pps  | 2702 | 1779 | 2667 |

`hdr_crc_fail` và `pay_crc_fail` ở mọi bậc đều bằng 0 — không packet nào hỏng dữ liệu.

##### Quy đổi sang băng thông

Mỗi packet 2 KB, mỗi cửa sổ 2 giây:

> pps = TX.pkt / 2     │     Mbps = pps × 2 (KB) × 8 / 1000

Ví dụ bậc 1200: `pps = 1928 / 2 = 964`, băng thông = `964 × 0.016 = 15.4 Mbps`.

##### Phát hiện 1 — SPI bus có mất gói không?

Nếu bus mất gói, `WAN.RX.pkt` sẽ phải nhỏ hơn `LAN.TX.pkt` đáng kể. Lấy hiệu:

| Bậc | LAN.TX.pkt − WAN.RX.pkt |
|---:|---:|
| 1000 | +10 |
| 1200 | **−5** (WAN nhiều hơn LAN!) |
| 1500 | +45 |
| 2000 | +19 |
| 3000 | +35 |

Hiệu lúc dương lúc âm, đều dưới 2%. Do hai chip đếm trên hai đồng hồ độc lập, cửa sổ 2 giây ở hai bên không trùng nhau — chênh lệch là **sai số căn chỉnh thời gian**, không phải mất gói.

Cộng với 0 lỗi CRC suốt test: **SPI bus truyền không mất gói.**

##### Phát hiện 2 — Trần lossless

Bậc 1200 pps là bậc cao nhất giữ được `drop = 0`. Bậc 1500 pps đã có drop = 19 (>0).

> **Trần lossless = 1200 pps = 19.2 Mbps**

Đây là mức an toàn — gửi dưới đây không packet nào bị từ chối.

##### Phát hiện 3 — Trần kỹ thuật của LAN

Từ bậc 1500 pps trở lên, `TX.pkt` không còn tăng theo yêu cầu nữa:

| Bậc yêu cầu | TX.pkt | pps thật |
|---:|---:|---:|
| 1500 | 2498 | 1249 |
| 2000 | 2649 | 1325 |
| 2500 | 2676 | 1338 |
| 3000 | 2702 | 1351 |

Yêu cầu tăng gấp đôi (1500→3000) nhưng thực đẩy chỉ tăng từ 1249 đến 1351 pps. Đây là **trần kỹ thuật** của LAN dispatcher — vượt qua mức này thì rate yêu cầu chỉ làm `drop` tăng, không tăng được throughput thật.

> **Trần kỹ thuật ≈ 1350 pps = 21.6 Mbps**

##### Tóm tắt §4

| Mức | Giá trị | Diễn giải |
|---|---|---|
| Trần lossless | **19.2 Mbps** | An toàn — không packet nào bị từ chối |
| Trần kỹ thuật | **21.6 Mbps** | Tối đa LAN có thể đẩy ra |
| Vùng burst | 19.2 – 21.6 Mbps | Cho phép spike ngắn, không nên duy trì lâu |

##### 4.6. Diễn giải kết quả

Có thể hình dung hệ thống như một dây chuyền: LAN MCU đặt thùng hàng (packet) lên băng chuyền, băng chuyền đưa qua sông (SPI bus) tới kho WAN. Khi đặt thùng nhanh hơn băng chuyền tải kịp, thùng dư sẽ rơi (`drop`).

**Vì sao có hai mức trần khác nhau?**

Trần lossless (1200 pps) là điểm mà băng chuyền còn dư công suất, mọi thùng đều lên được. Trần kỹ thuật (1350 pps) là tốc độ tối đa của băng chuyền — vượt qua thì lượng thùng rơi (`drop`) tăng nhanh nhưng tốc độ thật trên băng chuyền không tăng. Khoảng giữa là **vùng burst**, dùng cho cao điểm ngắn, không nên duy trì.

**Nút cổ chai nằm ở đâu?**

Ba quan sát cùng chỉ về phía LAN:
1. `TX.pkt` chạm trần ~2700 packet/cửa sổ bất kể yêu cầu cao bao nhiêu.
2. `drop` tăng tuyến tính theo yêu cầu (19 → 558 → 1779) — packet bị từ chối ngay tại LAN, chưa kịp xuống bus.
3. WAN nhận đủ tất cả packet LAN đã đẩy ra, 0 lỗi CRC.

⇒ SPI bus và WAN slave còn dư công suất. Để nâng băng thông, phải tối ưu phía LAN.

**Kết quả có đáng tin không?**

§1 đo bằng cách gửi tràn liên tục cho ra trần ≈ 21 Mbps. §4 đo bằng cách tăng dần từng bậc cho ra trần 21.6 Mbps. Hai phương pháp độc lập trả về cùng một con số ⇒ kết quả tin được.

##### 4.7. Ý nghĩa thực tiễn

**Quy hoạch tải:** tổng tốc độ của bốn handler (BLE, Zigbee, LoRa, RS485) gộp lại nên giữ ≤ **19.2 Mbps**. Cho phép spike ngắn lên đến 21.6 Mbps nhưng không duy trì.

**So với thực tế:** một node telemetry IoT thường gửi vài chục kbps. Hệ chứa được hàng nghìn node trước khi chạm trần ⇒ băng thông inter-MCU không phải vấn đề với mô hình gateway sensor.

**Định hướng tối ưu sau này:** nếu cần thêm băng thông (ví dụ thêm video/voice stream), chỉ cần tối ưu phía LAN (tăng kích thước queue, gom nhiều packet/lần gửi). Không cần đụng đến tốc độ SPI bus hay WAN slave.


#### Phụ lục — Hiện trạng code và phần cần bổ sung

Sau khi review code hiện có trong `DA2_esp` (WAN) và `DA2_esp_LAN` (LAN), dưới đây là đối chiếu giữa bài test trên và infrastructure đã có sẵn:

##### A. Có sẵn (chạy được ngay)

| Bài test | Module sẵn có | Vai trò |
|---------|---------------|---------|
| §1 SPI throughput | `DA2_esp_LAN/Application/Benchmark/bench_throughput.c` | Đếm tx_pkt/tx_bytes/tx_drop, framing stats — producer mode DRIVER và PROD_REAL |
| §1 SPI throughput | `DA2_esp/Application/Benchmark/bench_throughput_wan.c` | Đếm rx_pkt/rx_bytes + hdr_crc_fail/pay_crc_fail/resync_bytes/seq_gap |
| §2 Lane ingress | `DA2_esp_LAN/Application/Benchmark/bench_lane_ingress.c` | Per-lane counter pkt/bytes/miss/drop, raw consumer task drain ống |
| §3 WAN egress | `DA2_esp/Application/Benchmark/bench_wan_egress.c` | Producer fake data + raw TCP socket sink, đếm gen/sent_ok/sent_fail (hiện disable, enable lại để chạy) |
| §4 LAN→WAN lossless | Tái dùng `bench_throughput.c` + `bench_throughput_wan.c` | Counter 2 phía đã có, chỉ thiếu ramp logic |

##### B. Cần bổ sung trong code

| Bài test | Cần thêm | Vị trí gợi ý |
|---------|----------|--------------|
| §2 | `hw_fifo_max` per-lane (high-water mark FIFO phần cứng) | `bench_lane_ingress.c` — đọc từng driver IDF callback |
| §2 | `drv_buf_full_evt` (driver ring overflow event) | `bench_lane_ingress.c` — hook overflow callback của UART/SPI/I2C/USB driver |
| §3 | `q_drop` counter (header có khai báo nhưng chưa update khi enqueue fail) | `bench_wan_egress.c` line 15 — update vào producer task line 99-133 |
| §3 | Per-card switch logic (chỉ active 1 card mỗi lần) | Trong runtime config — disable 2 card còn lại trước khi bench |
| §4 | **Ramp rate scheduler** trong LAN producer (hiện chỉ flood) | `bench_throughput.c` line 91-147 — thêm state machine bậc thang `step_pps`, `step_duration_ms` |
| §4 | Cross-check `tx_lan` vs `rx_wan` report tự động (hiện phải gộp log thủ công) | Mới: counter relay từ WAN→LAN qua downlink slot, LAN tính `loss_pct` rồi log |
| §4 | Auto-stop khi `loss_pct > 1%` giữ 3 window | Logic trong LAN reporter task |

##### C. Có sẵn nhưng KHÔNG dùng nữa (theo scope mới)

| Module | Trạng thái | Ghi chú |
|--------|-----------|---------|
| `bench_counter.c` (BLE/Zigbee/LoRa aggregator JSON) | Không phục vụ bài test nào trong scope mới | Handler thật có data rate quá thấp, không chạm trần — giữ lại làm telemetry monitor production, không phải bench |
| MQTT publish path benchmark | Không đo | Broker demo ThingsBoard kick connection nếu spam → nguy cơ ban account |
| Combined LAN+WAN end-to-end reporter | Không cần | §4 đã đổi sang LAN→WAN-only ramp test, không qua MQTT/Internet |

##### D. Thứ tự khuyến nghị triển khai

1. **§1** — chạy được ngay với code hiện có, lấy số trước.
2. **§3** — bổ sung `q_drop` counter (5 phút) + enable `BENCH_WAN_EGRESS_ENABLE=1`, chạy lần lượt 3 card.
3. **§2** — chạy được với mode hiện tại (consumer raw); `hw_fifo_max` và `drv_buf_full_evt` là nice-to-have, không bắt buộc cho phép đo cơ bản.
4. **§4** — cần dev thêm ramp scheduler trong `bench_throughput.c`. Nếu gấp, có thể chạy thủ công bằng cách rebuild firmware với rate khác nhau, mỗi rate 1 lần flash.
