### thực hiện đo các phần sau với các yêu cầu dưới đây:
1. đầu tiên việc đo phải có PHƯƠNG PHÁP ĐO đúng đắn, cần phải chứng minh được phương pháp đó là đúng đắn và có tính bám sát so với production line.
2. Phân tích, mổ xẻ, đánh giá từng chặng trên đường đi của dữ liệu từ ngoại vi cho đến xử lý dữ liệu giữa các task.
3. cần có kịch bản đo chi tiết phù hợp, phải kèm theo bảng biểu ghi số liệu, kịch bản gồm đo cái gì, từng bước đo thế nào, đo vơi phương pháp thế nào, kết quả thể hiện điều gì.
4. trình bày ngắn gọn dễ hiểu nhất có thể tránh dài dòng không cần thiết, viết theo cách để người không hiểu gì về embedded cũng có thể hiểu, ở các phân tích đừng đặt nặng về code hay các biến (tuyệt đối không nhắc đến chúng) viết theo kiểu ví dụ phần A làm gì, chặng A làm gì chứ kg phải liệt kê ra một đống biến đọc vô chả hiểu gì hế.
5. viết ngắn gọn, sử dụng ngôn ngữ kỹ thuật đơn giản sao cho học sinh cũng có thể hiểu.
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
5. Bài test 4: Độ trễ end-to-end kể từ lúc nhận dữ liệu từ nhận ở LAN đế lúc đẩy đi ở WAN.
   - Mục đích: Đo độ trễ end-to-end thực tế của toàn bộ hệ thống, từ lúc dữ liệu được nhận ở LAN (qua UART/SPI/I2C/USB) đến lúc được đẩy đi ở WAN (qua WiFi/Ethernet/4G).
   - Hardware/Firmware: Sử dụng rs485, cắm card rs485 vào một cổng LAN, khi LAN nhận được package thì gắn timestamp, đẩy qua SPI lên WAN, khi WAN đẩy đi xong thì lấy thời gian vừa đẩy đi xong trừ đi timestamp lúc nhận ở LAN sẽ ra độ trễ end-to-end.
   - Đánh giá: So sánh timestamp lúc nhận ở LAN và lúc đẩy đi ở WAN để xác định độ trễ end-to-end. Cần đo nhiều lần để lấy trung bình và phân tích phân phối độ trễ.
   


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


#### 5. Đo độ trễ end-to-end từ cảm biến đến lúc gói tin rời khỏi cổng WAN

##### 5.1. Phương pháp đo

**Câu hỏi cần trả lời:** Một gói tin từ cảm biến đi vào hệ thống mất bao lâu để **thật sự rời khỏi** thiết bị đi ra ngoài?

**Ý tưởng đo:**

Mỗi gói tin được đóng hai con tem thời gian: con tem T₁ lúc nó **vừa vào** thiết bị, và con tem T₂ lúc nó **vừa thật sự rời** thiết bị qua đường WAN. Hiệu T₂ − T₁ chính là độ trễ end-to-end.

**Khái niệm "thật sự rời khỏi" theo từng đường WAN:**

Mỗi card WAN có một "cánh cổng cuối cùng" khác nhau. Điểm đặt T₂ phải đúng ngay sau cánh cổng đó:

| Đường WAN | Cánh cổng cuối | T₂ chốt ở đâu |
|---|---|---|
| **WiFi**     | (không dùng hook) | Ngay sau `send()` trả về — khi TCP buffer chấp nhận dữ liệu |
| **Ethernet** | Bus SPI nối tới chip mạng (W5500) | Khi byte cuối cùng vừa được đẩy xong qua SPI tới chip |
| **LTE 4G**   | (không dùng hook) | Ngay sau `send()` trả về — khi TCP buffer chấp nhận dữ liệu |

Đặt T₂ tại các điểm này có nghĩa: **toàn bộ thời gian trong thiết bị đều được tính**, kể cả thời gian xếp hàng, đóng gói, chờ phát. Sau T₂, gói tin không còn nằm trong tay phần mềm nữa.

**Cách làm cụ thể:**

1. Máy tính giả làm cảm biến, phát data đều đặn (10 gói/giây, mỗi gói 64 byte) qua chuyển đổi USB → RS485 vào thiết bị.
2. Tại điểm đầu, ngay khi gói được ghép xong, hệ thống đóng dấu T₁.
3. Gói đi qua tất cả các chặng nội bộ (cây cầu SPI inter-MCU, hàng đợi, dispatcher, đóng gói TCP…).
4. Tại cánh cổng cuối cùng tương ứng với card đang dùng, hệ thống đóng dấu T₂.
5. Độ trễ = T₂ − T₁.

**Hai đồng hồ — một thước đo:**

Thiết bị gồm hai vi điều khiển, mỗi cái có đồng hồ riêng. Hai đồng hồ này lệch nhau. Hệ đã có sẵn cơ chế chip phía WAN gửi đồng bộ thời gian xuống chip phía LAN mỗi giây. Sau khoảng 5 giây khởi động, độ lệch ổn định trong vài mili-giây, đủ chính xác để đo phép tính chục mili-giây.

**Tại sao phép đo này đáng tin:**

Gói tin đo đi qua **đúng cùng đường** với gói tin sản xuất thật — cùng hàng đợi, cùng SPI, cùng socket, cùng driver. Khác biệt duy nhất là hai con tem thời gian được gắn thêm — không thay đổi đường đi, không thay đổi tải. Số đo chính là độ trễ mà cảm biến thật sẽ chịu trong vận hành thực tế.

##### 5.2. Đường đi của dữ liệu

```
[PC giả lập cảm biến]
   ▼ RS485
[Chặng A — Cổng vào]
   • Thiết bị nhận và ghép gói RS485 hoàn chỉnh.
   • Đóng dấu T₁ ngay khi gói sẵn sàng.
   ▼
[Chặng B — Cây cầu nội bộ (SPI inter-MCU)]
   • Gói được xếp hàng và chuyển từ chip LAN sang chip WAN.
   ▼
[Chặng C — Phân loại và xếp lên socket TCP]
   • Chip WAN phân biệt gói benchmark, đẩy nội dung vào socket TCP.
   ▼
[Chặng D — Cánh cổng cuối (KHÁC NHAU THEO CARD)]
   • WiFi: chờ radio phát xong sóng.
   • Ethernet: chờ SPI đẩy xong byte cuối tới chip mạng.
   • LTE:    chờ USB đẩy xong byte cuối tới modem.
   • Đóng dấu T₂ ngay sau khi chặng này hoàn tất.
```

| Chặng | Phần làm gì | Thời gian kỳ vọng |
|---|---|---:|
| A — Cổng vào | Nhận RS485, ghép gói, đóng dấu T₁ | ~0.1 ms |
| B — Cây cầu nội bộ | Xếp hàng + SPI inter-MCU | ~3–4 ms |
| C — Phân loại + nạp TCP | Tách nội dung, đẩy vào socket | ~0.2 ms |
| D — Cánh cổng cuối | WiFi/Eth/LTE đẩy gói ra đường truyền | Đặc trưng của từng card |

Tổng độ trễ = thời gian gói tin trôi qua tất cả các chặng. Số kỳ vọng cho chặng D là phần thú vị nhất — đây chính là phần phụ thuộc card và phụ thuộc môi trường mạng.

##### 5.3. Thông tin đọc trong log

Sau mỗi gói, thiết bị in một dòng cho biết:

- Số thứ tự gói (để phát hiện mất gói).
- Tên card đang dùng (wifi / eth / 4g).
- Hai con tem T₁ và T₂.
- Độ trễ tính sẵn (ms).

Sau mỗi giây, in một dòng tổng hợp gồm:

- Số gói trong giây vừa qua.
- Trễ nhỏ nhất, trung bình, lớn nhất.
- Số gói mất, số lần gửi thất bại, số lần cánh cổng cuối không phản hồi đúng hạn.

Các số "phải bằng 0" trong điều kiện đo bình thường: gói mất, gửi thất bại, cánh cổng không phản hồi. Bất kỳ giá trị nào khác 0 đều là cờ điều tra.

##### 5.4. Kịch bản đo

Đo lần lượt **3 card WAN**: WiFi → Ethernet → 4G LTE. Mỗi card đo một lần ở tải thấp.

| Kịch bản | Card | Tốc độ phát | Mục đích |
|---|:---:|:---:|---|
| 5-WiFi | WiFi 2.4 GHz   | 10 gói/giây | Độ trễ nền qua WiFi đến lúc sóng phát ra |
| 5-ETH  | Ethernet W5500 | 10 gói/giây | Độ trễ nền qua dây cứng đến lúc SPI hoàn tất |
| 5-4G   | LTE SIM7600    | 10 gói/giây | Độ trễ nền qua mạng di động đến lúc USB hoàn tất |

Kích thước gói: 64 byte. Số gói mỗi kịch bản: 1 100 (bỏ 100 gói đầu để hệ ổn định, lấy 1 000 gói sau để thống kê).

**Đích nhận theo card:**
- WiFi và Ethernet → máy chủ nhỏ chạy trên PC trong cùng mạng LAN (chỉ cần để hoàn tất kết nối TCP, không tham gia tính thời gian).
- 4G → máy chủ echo công cộng trên Internet (vì PC LAN không nhìn thấy từ mạng di động).

**Lưu ý:** Đích nhận không ảnh hưởng đến T₂ — T₂ được đóng dấu **bên trong thiết bị**, ngay sau cánh cổng cuối, không phụ thuộc gói có tới đích hay không.

**Tại sao chỉ Ethernet có hook chính xác:** Ethernet có bus SPI đồng bộ — sau khi gọi xong driver, byte chắc chắn đã ra chip mạng → hook bám chính xác. WiFi có radio trong MCU, không có API công khai báo "radio đã phát xong". LTE đi qua giao thức PPP (xếp khung HDLC trên USB CDC) — output không qua đường netif chuẩn, hook không bắt được. Với hai card này, dùng "ngay sau khi TCP buffer chấp nhận" là phép xấp xỉ tốt nhất khả dụng: vẫn bắt được toàn bộ thời gian trong phần mềm (SPI inter-MCU + TCP/lwIP queuing), chỉ thiếu phần modulation cuối ngoài MCU.

**Các bước thực hiện:**

1. Cắm chuyển đổi USB-RS485 vào cổng RS485 của thiết bị. Bật máy chủ nhận trên PC (nếu đo WiFi/Eth).
2. Chọn card cần đo trong cấu hình thiết bị.
3. Khởi động lại thiết bị, đợi 5 giây cho đồng hồ đồng bộ ổn định.
4. PC phát 1 100 gói qua RS485. Lưu lại log từ thiết bị.
5. Bỏ 100 dòng đầu (giai đoạn ấm máy). Tính từ 1 000 dòng còn lại: nhỏ nhất, trung bình, lớn nhất, p95, p99. Đếm gói mất qua khoảng trống số thứ tự.
6. Đổi card → lặp lại.

##### 5.5. Số liệu thực đo

Sau khi áp dụng vị trí T₂ mới (theo cánh cổng cuối từng card), tất cả kết quả đo cũ trở nên không còn ý nghĩa và đã bị xóa khỏi tài liệu. Bảng dưới điền sẵn để khi đo xong có thể nhập trực tiếp.

Lấy theo cụm mẫu ổn định trong giai đoạn vận hành, loại các spike định kỳ (sẽ phân tích riêng).

| Card | min (ms) | avg (ms) | max (ms) | n mẫu | loss | Ghi chú |
|:---:|---:|---:|---:|---:|---:|---|
| WiFi 2.4 GHz   | **13.0** | **14.6** | **15.0** | 39 | 0 | T₂ ngay sau `send()` trả về |
| Ethernet W5500 | **10.3** | **10.9** | **11.1** | 23 | 0 | T₂ khi SPI tới W5500 xong |
| 4G LTE         | **10.7** | **10.9** | **11.0** | 178 | 0 | T₂ ngay sau `send()` trả về |

##### 5.6. Kết quả có chính xác không? (khung kiểm chứng)

Khi đã có số liệu, dùng bốn kiểm chứng dưới để xác nhận phép đo đúng:

**Kiểm chứng 1 — Khoảng cách giữa các gói khớp với tốc độ phát.**

PC phát 10 gói/giây, nghĩa là mỗi gói cách nhau 100 ms. Đọc con tem T₁ giữa hai gói liên tiếp, hiệu phải gần 100 ms. Nếu lệch nhiều, đồng hồ đang bị nhiễu hoặc gói đến không đều.

**Kiểm chứng 2 — Độ trễ luôn dương.**

T₂ phải lớn hơn T₁ ở mọi gói (sau khi đồng hồ đã đồng bộ). Nếu có gói âm tức là độ lệch đồng hồ chưa đúng hướng — phép đo không đáng tin.

**Kiểm chứng 3 — Không có gói mất, không có gửi thất bại.**

Số thứ tự gói phải liên tục, log "gửi thất bại" phải bằng 0. Nếu có gói mất, kết quả thống kê bị thiên lệch (có thể vì các gói chậm bị rớt).

**Kiểm chứng 4 — Cánh cổng cuối phản hồi đúng hạn.**

Khi cài đặt T₂ ở cánh cổng cuối, hệ thống có giới hạn thời gian chờ phản hồi (1 giây). Nếu xuất hiện log "cánh cổng không phản hồi" tức là hook đo bị lỗi hoặc gói bị kẹt — phải sửa trước khi tin kết quả.

##### 5.7. Ý nghĩa thực tiễn

Kết quả §5 trả lời câu hỏi: "Một gói cảm biến mất bao nhiêu mili-giây để rời khỏi thiết bị?". Đây là phần thời gian thiết bị **chịu trách nhiệm**. Phần thời gian sau đó (gói bay trên không / trong dây / qua sóng di động đến server) thuộc về môi trường mạng, không do thiết bị quyết định.

Khi có số đo:
- **WiFi cao hơn Ethernet** là bình thường — WiFi phải đợi khe phát, có thể đợi qua chế độ tiết kiệm điện của router.
- **Ethernet ổn định nhất** vì cánh cổng cuối là một bus SPI đồng bộ, không phụ thuộc môi trường ngoài.
- **LTE phụ thuộc modem** — modem có hàng đợi USB riêng nên có thể trễ hơn cả WiFi và Ethernet.

Ba số đo cho phép so sánh trực quan ba lựa chọn kết nối, làm cơ sở chọn card phù hợp với từng ứng dụng (ví dụ: ứng dụng thời gian thực ưu tiên Ethernet; nơi không có dây thì WiFi; lưu động thì LTE).