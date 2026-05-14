# PHÂN TÍCH HIỆU SUẤT VÀ CƠ SỞ LÝ THUYẾT KIỂM THỬ HỆ THỐNG GATEWAY IOT

Dưới đây là phân tích hiệu suất hệ thống được thiết lập làm cơ sở lý thuyết (baseline) cho quá trình kiểm thử thực nghiệm. Nội dung định lượng các giới hạn kỹ thuật tại từng chặng trong chuỗi truyền dẫn, từ đó đối chiếu với kết quả đo đạc thực tế.

---

## 1. Kiến trúc Hệ thống và Chuỗi Truyền dẫn Dữ liệu

Hệ thống được thiết kế theo kiến trúc **Dual-MCU** nhằm tối ưu hóa việc xử lý song song và tăng độ tin cậy. Luồng dữ liệu di chuyển qua một chuỗi (pipeline) gồm bốn chặng chính:

1. **Chặng 1 — Air Interface:** Node ngoại vi gửi dữ liệu qua sóng vô tuyến (Zigbee, LoRa, BLE).
2. **Chặng 2 — Module to MCU:** Module vô tuyến truyền dữ liệu vào **LAN MCU** (ESP32-S3) qua UART tốc độ 115.200 bps bằng giao thức đặc thù của từng module.
3. **Chặng 3 — Inter-MCU:** LAN MCU gom dữ liệu theo chu kỳ 50 ms và đẩy sang **WAN MCU** (ESP32-S3) qua bus SPI 10 MHz.
4. **Chặng 4 — Cloud Interface:** WAN MCU serialize dữ liệu sang JSON và publish lên server qua MQTT/HTTP/CoAP.

Điểm then chốt cần lưu ý là **tầng UART (Chặng 2)** — thường bị bỏ qua — có thể trở thành nút thắt chính quyết định thông lượng thực tế của cả hệ thống, đặc biệt với Zigbee. Hai module Zigbee và LoRa sử dụng hai giao thức UART khác nhau về bản chất: Zigbee dùng **HEX binary framing** (Ebyte protocol), còn LoRa dùng **AT command dạng ASCII văn bản**.

---

## 2. Thông lượng Dữ liệu (Data Throughput) và Hiệu suất $\eta$

Thông lượng ứng dụng thực tế $R_{app}$ là lượng dữ liệu hữu ích còn lại sau khi trừ đi overhead của giao thức tại tất cả các lớp. Hiệu suất băng thông được định nghĩa:

$$\eta = \frac{R_{app}}{R_{PHY}}$$

### 2.1. Phân tích Thông lượng và Nút thắt tại từng Giao thức

**Zigbee (E18-ZG120 / CC2530):** Tốc độ vật lý IEEE 802.15.4 đạt 250 kbps. Tuy nhiên, mỗi frame Zigbee chỉ chứa tối đa 99 byte payload ứng dụng sau khi trừ các header MAC/NWK/APS (28 byte tổng cộng trên tổng 127 byte PSDU). Trên không trung, thời gian hoàn thành một chu kỳ phát–nhận ACK là khoảng 5 ms, tương đương thông lượng air $\approx 158$ kbps. **Tuy nhiên, nút thắt thực sự nằm ở UART 115.200 bps:** module E18-ZG120 gửi frame HEX bất đồng bộ lên LAN MCU cho mỗi gói nhận được, với kích thước khoảng 121 byte (99 byte dữ liệu + 22 byte overhead ZCL/HEX frame). Thời gian truyền frame này là $121 \times 10 / 115200 \approx 10{,}5$ ms, **chậm hơn gấp đôi so với chu kỳ air 5 ms**, dẫn đến thông lượng thực tế bị giới hạn ở mức $\approx 80$ kbps.

**LoRa (Wio-E5 / STM32WLE5JC) — Chế độ TEST/P2P:** Trong kịch bản kiểm thử, hệ thống sử dụng chế độ **TEST/P2P** (`AT+MODE=TEST`) thay vì LoRaWAN. Chế độ này bỏ qua hoàn toàn duty cycle (không áp dụng giới hạn 1% của ETSI) và stack LoRaWAN, cho phép phát liên tục chỉ bị giới hạn bởi Time-on-Air. Tốc độ bit PHY tại SF7/125 kHz đạt 5.470 bps. Mỗi chu kỳ phát bao gồm thời gian truyền AT command qua UART ($\approx 15$ ms) cộng Time-on-Air ($\approx 97{,}5$ ms cho gói 50 byte), tổng khoảng 115 ms, cho thông lượng ứng dụng $\approx 3{,}5$ kbps. Giới hạn payload tối đa qua AT command là **169 byte/gói** do độ dài lệnh tối đa là 528 ký tự.

**BLE (Native ESP32-S3):** BLE không qua module ngoài nên không có tầng UART. Thông lượng bị giới hạn bởi **Connection Interval** (CI = 20 ms) và **ATT MTU**. Mặc định ATT MTU = 23 byte (20 byte dữ liệu), thông lượng chỉ $\approx 8$ kbps. Khi kích hoạt **Data Length Extension (DLE)** và đàm phán MTU lên 247 byte (244 byte dữ liệu), thông lượng đạt $\approx 97{,}6$ kbps.

| Giao thức | $R_{PHY}$ | $R_{app}$ thực tế | $\eta$ | Nút thắt chính |
| :--- | :---: | :---: | :---: | :--- |
| **Zigbee** | $250 \text{ kbps}$ | $\approx 80 \text{ kbps}$ | $32\%$ | UART 115.200 bps (10,5 ms/frame) |
| **LoRa SF7/125 (P2P)** | $5{,}47 \text{ kbps}$ | $\approx 3{,}5 \text{ kbps}$ | $64\%$ | Time-on-Air ($\approx 97{,}5$ ms/gói) |
| **LoRa SF7/250 (P2P)** | $10{,}94 \text{ kbps}$ | $\approx 6{,}1 \text{ kbps}$ | $56\%$ | Time-on-Air ($\approx 48{,}8$ ms/gói) |
| **BLE (không DLE)** | $1.000 \text{ kbps}$ | $\approx 8 \text{ kbps}$ | $0{,}8\%$ | MTU = 20 byte, CI = 20 ms |
| **BLE (DLE bật)** | $1.000 \text{ kbps}$ | $\approx 97{,}6 \text{ kbps}$ | $9{,}7\%$ | CI = 20 ms |

---

## 3. Độ trễ Hệ thống (System Latency)

Độ trễ End-to-End $T_{e2e}$ là tổng thời gian xử lý và truyền dẫn qua tất cả các chặng:

$$\boxed{T_{e2e} = T_{air} + T_{UART} + T_{batch} + T_{SPI} + T_{JSON} + T_{network}}$$

Các thành phần chính:

- **Thời gian truyền sóng** $T_{air}$: Zigbee $\approx 5$ ms, LoRa SF7 $\approx 97{,}5$ ms, LoRa SF12 $\approx 2.300$ ms, BLE $\approx 2{,}2$ ms.
- **Độ trễ UART** $T_{UART}$: Khoảng $10{,}5$ ms/gói với Zigbee (bottleneck), $\approx 15$ ms với LoRa AT command.
- **Độ trễ gom gói** $T_{batch}$: Cố định $\approx 50$ ms do cơ chế batch flush tại LAN MCU — thành phần **lớn nhất với Zigbee và BLE**.
- **Độ trễ SPI** $T_{SPI}$: Truyền 1 KB mất $\approx 0{,}82$ ms tại xung nhịp 10 MHz.
- **Độ trễ JSON** $T_{JSON}$: Parse/format $\approx 0{,}3$ ms/bản tin trên ESP32-S3 @ 240 MHz.

| Kịch bản truyền | Độ trễ dự kiến | Thành phần chiếm ưu thế |
| :--- | :---: | :--- |
| **Zigbee → MQTT** | $10 \text{ ms} \div 60 \text{ ms}$ | Gom gói ($T_{batch}$) |
| **LoRa SF7 (P2P) → MQTT** | $100 \text{ ms} \div 150 \text{ ms}$ | Thời gian truyền sóng ($T_{air}$) |
| **LoRa SF12 (P2P) → MQTT** | $\approx 2{,}6 \text{ giây}$ | Thời gian truyền sóng ($T_{air}$) |
| **BLE → MQTT** | $4 \text{ ms} \div 55 \text{ ms}$ | Gom gói ($T_{batch}$) |

---

## 4. Khả năng Chịu tải và Tài nguyên Bộ nhớ

### 4.1. Giới hạn Số lượng Node Kết nối

- **Zigbee (E18-ZG120):** Giới hạn bởi **8 KB SRAM của CC2530**. Sau khi Z-Stack chiếm $\approx 5$ KB, phần còn lại chỉ đủ cho tối đa **20 node** trực tiếp theo cấu hình mặc định Z-Stack (`NWK_MAX_DEVICE_LIST = 20`). Lỗi `0x18` (Not enough cache) và `0x11` (Memory full) là các chỉ báo điển hình khi vượt ngưỡng này.
- **LoRa (P2P):** Trong chế độ P2P point-to-point, Gateway chỉ liên kết với **một node** tại một thời điểm. Không có giới hạn mạng lưới như LoRaWAN.
- **BLE:** Giao thức GATT giới hạn tối đa **8 kết nối đồng thời** trên ESP32-S3 (NimBLE stack). Thực tế bị giới hạn bởi RAM: mỗi kết nối chiếm ≈ 2 KB → tổng 16 KB internal SRAM.

### 4.2. Mức Sử dụng Bộ nhớ Động (Heap Watermark)

Kịch bản worst-case khi cả bốn giao diện đồng thời nhận dữ liệu và WAN MCU thực hiện build JSON:

- **Internal SRAM:** Tiêu thụ $\approx 92$ KB, chiếm $28{,}8\%$ vùng nhớ khả dụng (sau khi WiFi + BT stack chiếm $\approx 192$ KB từ tổng 512 KB).
- **PSRAM (Octal SPI @ 80 MHz):** Tiêu thụ $\approx 474$ KB cho các task stack và SPI buffer.

---

## 5. Các Điểm Nghẽn và Rủi ro Kỹ thuật (Bottlenecks)

1. **Nghẽn UART — Zigbee:** Tại 115.200 bps, UART mất $\approx 10{,}5$ ms để truyền một frame HEX phản hồi gói Zigbee, **chậm hơn 2 lần** so với chu kỳ air 5 ms. Đây là nguyên nhân chính giới hạn thông lượng Zigbee ở mức $\approx 80$ kbps thay vì 158 kbps theo lý thuyết vô tuyến.

2. **Tràn hàng đợi (Queue Overflow):** WAN Uplink Queue chỉ sâu 5 item. Nếu WAN MCU bận xử lý FOTA hoặc mất kết nối MQTT, queue tràn và mất dữ liệu. Rủi ro tăng cao trong bài test đa kênh đồng thời.

3. **Giới hạn SRAM CC2530:** Khi spam dữ liệu tốc độ cao, lỗi `0x11` (memory full) và `0x18` (not enough cache) có thể xuất hiện nếu LAN MCU không kịp đọc dữ liệu từ module E18-ZG120.

4. **Kích thước payload LoRa trong AT command:** Lệnh `AT+TEST=TXLRPKT` bị giới hạn 528 ký tự → tối đa **169 byte payload** mỗi gói, thấp hơn giới hạn vật lý 255 byte của radio LoRa.

5. **Không đồng bộ LDRO giữa TX và RX:** Ở SF11/SF12, Low Data Rate Optimize (LDRO) phải được bật đồng thời trên cả node phát lẫn Gateway thu. Nếu không khớp, Gateway nhận gói lỗi hoặc không nhận được.

---

## 6. Thiết lập Kịch bản Kiểm thử Thực tế (Stress Test)

Dựa trên phân tích lý thuyết, kịch bản kiểm thử được chia làm hai giai đoạn:

### 6.1. Kiểm thử Đơn kênh — Max Bandwidth Test

**Phương pháp:** Từng node (Zigbee, LoRa, BLE) gửi dữ liệu liên tục với tốc độ tối đa.

**Cấu hình LoRa TEST/P2P (thực hiện trên cả node phát và Gateway thu):**
```
AT+MODE=TEST                             // Vào chế độ TEST (bỏ qua LoRaWAN và duty cycle)
AT+LW=LDRO,ON                            // Bật Low Data Rate Optimize (cần cho SF ≥ 11)
AT+TEST=RFCFG,920,SF7,125,8,15,14,ON,OFF,OFF
                                         // Tần số AS923 920 MHz (Việt Nam), SF7, BW 125 kHz,
                                         // TX preamble 8, RX preamble 15, Power 14 dBm
AT+TEST=RXLRPKT                          // Gateway vào chế độ nhận liên tục
```
Node phát gửi liên tiếp: `AT+TEST=TXLRPKT,"00 AA BB..."` và chờ `+TEST: TX DONE` trước khi gửi tiếp.

**Chỉ số đánh giá:** Thông lượng thực đo (kbps hoặc byte/s tại LAN MCU và tại server), tỷ lệ giao tin thành công PDR, mã lỗi phần cứng (đặc biệt `0x11`, `0x18` cho Zigbee), RSSI và SNR cho LoRa.

**Kết quả baseline kỳ vọng:**

| Giao thức | Thông lượng vào LAN MCU | PDR kỳ vọng |
| :--- | :---: | :---: |
| Zigbee | $\approx 80$ kbps | $> 95\%$ |
| LoRa SF7/125 (P2P) | $\approx 3{,}5$ kbps | $> 99\%$ |
| LoRa SF7/250 (P2P) | $\approx 6{,}1$ kbps | $> 99\%$ |
| BLE (DLE bật) | $\approx 97{,}6$ kbps | $> 99\%$ |

### 6.2. Kiểm thử Đa kênh Đồng thời — Concurrency Test

**Phương pháp:** Ba node (Zigbee, LoRa, BLE) cùng spam dữ liệu tối đa.

**Thông lượng LAN→WAN lý thuyết** (tổng 3 giao thức):

$$R_{total,theory} = 80 + 97{,}6 + 3{,}5 = 181{,}1 \text{ kbps}$$

Dữ liệu tích lũy mỗi batch 50 ms: Zigbee 500 B + BLE 610 B + LoRa 22 B ≈ **1.132 byte**. Thời gian SPI để truyền lô này:

$$T_{SPI,batch} = \frac{1.132 \times 8}{10 \times 10^6} = 0{,}906 \text{ ms} \implies U_{SPI} = \frac{0{,}906}{50} = \mathbf{1{,}81\%}$$

**SPI không phải nút thắt** — tải thực tế chỉ chiếm 1,81% capacity 10 Mbps. Nút thắt thực sự là **WAN Uplink Queue depth = 5** (chứa tối đa 250 ms tải trước khi tràn) và tranh chấp mutex SPI giữa 3 Uplink task.

**Thông lượng LAN→WAN thực tế kỳ vọng:**

$$R_{LAN\to WAN,practical} \approx (70 \div 85\%) \times 181{,}1 \approx 127 \div 154 \text{ kbps}$$

**Mục tiêu:** PDR toàn hệ thống $> 85\%$ dưới tải nặng. Suy giảm chủ yếu do Zigbee Listener buffer (512 byte) dễ tràn khi LAN MCU bận phục vụ SPI cho BLE.

---

*Tài liệu này được biên soạn nhằm cung cấp cơ sở đối chiếu baseline cho kết quả thực nghiệm trong luận văn tốt nghiệp. Tài liệu tính toán chi tiết: `gateway_metrics_calculation.md`.*
