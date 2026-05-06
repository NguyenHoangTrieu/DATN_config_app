# TÍNH TOÁN CHI TIẾT CHỈ SỐ HIỆU SUẤT HỆ THỐNG GATEWAY IOT SINGLE-MCU ESP32-S3

Tài liệu này đối chiếu phương án single-MCU với tài liệu gốc `gateway_metrics_calculation.md`, nhưng thay kiến trúc hai vi điều khiển hiện tại bằng một ESP32-S3 duy nhất. Mục tiêu là trả lời câu hỏi: nếu không còn tách `DA2_esp` và `DA2_esp_LAN` thành hai firmware trên hai chip, mà gom toàn bộ Zigbee, LoRa, BLE, RS485, MQTT, HTTP, CoAP, cấu hình và FOTA về một ESP32-S3, thì thông lượng, độ trễ, áp lực scheduler và hiệu quả dùng internal RAM sẽ thay đổi như thế nào.

Tài liệu này không giả định đã có firmware single-MCU hoàn chỉnh. Các số liệu được xây dựng từ hai nguồn:

1. Công thức throughput và latency của tài liệu gốc.
2. Các hằng số runtime đọc trực tiếp từ code hiện tại trong `DA2_esp` và `DA2_esp_LAN`, đặc biệt là queue depth, task stack, priority, FreeRTOS tick, BLE connection budget và các vùng cấp phát `MALLOC_CAP_INTERNAL`.

---

## 1. Phạm vi và Giả định So sánh

Để phép so sánh công bằng, tài liệu này giữ nguyên các giới hạn ở lớp radio và module:

- Zigbee vẫn đi qua module E18-ZG120 và UART `115200 bps` với framing HEX.
- LoRa vẫn đi qua Wio-E5 ở chế độ `TEST/P2P`, nên giới hạn chính vẫn là `Time-on-Air + AT overhead`.
- BLE vẫn là BLE native trên ESP32-S3. Code hiện tại cho phép `interval_min = 16` và `interval_max = 32`, tương đương `20–40 ms`.
- RS485 trong tài liệu gốc lấy benchmark `9600 bps`; code hiện tại lại dùng macro mặc định `115200 bps`. Phần so sánh chính vẫn giữ mốc `9600 bps` để nhất quán với tài liệu nền, đồng thời có ghi chú trường hợp theo code hiện tại.

Các hằng số hệ thống quan trọng hiện đang dùng trong code:

- Cả hai firmware đều chạy `ESP32-S3 @ 240 MHz`.
- `CONFIG_FREERTOS_HZ = 100`, tức một tick là `10 ms`.
- Queue uplink bridge ở phía LAN hiện là `32 item`, mỗi item tối đa `2048 byte`.
- Queue publish của `MQTT`, `HTTP`, `CoAP` ở phía WAN đều là `32 item`.
- `BLE_GATT_MAX_DEVICES = 32`, nhưng số kết nối đồng thời thực dụng hiện bị chặn bởi `CONFIG_BT_ACL_CONNECTIONS = 8` và `CONFIG_BT_CTRL_BLE_MAX_ACT = 8`, nên usable concurrent connections là `8`.

---

## 2. Kịch bản Kiến trúc Single-MCU

### 2.1 Mô hình kiến trúc

Phương án được xét là:

- Một ESP32-S3 dual-core duy nhất chạy toàn bộ data-plane và control-plane.
- Zigbee, LoRa, RS485 vẫn đi vào MCU qua UART.
- BLE vẫn là stack native trên cùng ESP32-S3.
- Toàn bộ chặng `LAN MCU -> SPI -> WAN MCU` bị loại bỏ.
- Dữ liệu sau khi parse sẽ enqueue trực tiếp vào queue publish nội bộ của `MQTT`, `HTTP` hoặc `CoAP`.

Sơ đồ khái niệm:

```text
Air Interface -> Module/UART/BLE Callback -> RTOS Queue -> JSON -> Cloud
```

Nếu viết dưới dạng công thức độ trễ nội bộ, kiến trúc mới là:

$$T_{\text{single}} = T_{\text{air}} + T_{\text{module}} + T_{\text{dispatch}} + T_{\text{JSON}} + T_{\text{network}}$$

Trong khi kiến trúc dual-MCU hiện tại là:

$$T_{\text{dual}} = T_{\text{air}} + T_{\text{module}} + T_{\text{batch}} + T_{\text{SPI}} + T_{\text{JSON}} + T_{\text{network}}$$

Điểm khác biệt cốt lõi là single-MCU loại bỏ được hai thành phần mà dual-MCU đang phải gánh chỉ để phục vụ giao tiếp nội bộ giữa hai chip:

- $T_{\text{batch}}$: cửa sổ gom gói `50 ms`.
- $T_{\text{SPI}}$: truyền batch qua bus SPI.

---

## 3. Thông lượng Dữ liệu

### 3.1 Các nút thắt radio và UART gần như không đổi

Do single-MCU không thay đổi lớp radio và cũng không thay đổi đường UART từ module vào ESP32-S3, nên thông lượng thực tế của từng giao thức hầu như giữ nguyên.

### Zigbee

Theo tài liệu gốc, frame UART phản hồi của Zigbee xấp xỉ `121 byte`. Thời gian đẩy một frame như vậy qua UART `115200 bps` là:

$$T_{\text{UART,Zigbee}} = \frac{121 \times 10}{115200} \approx 10{,}5 \text{ ms}$$

Thông lượng payload ứng dụng vì vậy vẫn là:

$$R_{\text{app,Zigbee}} = \frac{99 \times 8}{10{,}5 \times 10^{-3}} \approx 75{,}4 \text{ kbps}$$

Tức thực tế vẫn nằm trong khoảng:

$$R_{\text{app,Zigbee}} \approx 75\text{–}80 \text{ kbps}$$

Kết luận: single-MCU không làm Zigbee nhanh hơn về throughput, vì nút thắt vẫn nằm ở UART module, không nằm ở SPI giữa hai MCU.

### LoRa TEST/P2P

LoRa vẫn bị giới hạn bởi `Time-on-Air` và overhead AT command, nên các kết quả chính giữ nguyên:

- `SF7 / BW125 / 50 B`: khoảng `3,5 kbps`
- `SF7 / BW250 / 50 B`: khoảng `6,1 kbps`
- `SF7 / BW125 / 222 B benchmark`: khoảng `4,09 kbps`

### BLE Native ESP32-S3

Nếu lấy mốc tốt nhất trong tài liệu gốc với `CI = 20 ms` và payload ATT là `244 byte`, ta có:

$$R_{\text{app,BLE,max}} = \frac{244 \times 8}{20 \times 10^{-3}} = 97{,}6 \text{ kbps/thiết bị}$$

Tuy nhiên code hiện tại cho phép dải connection interval `20–40 ms`, nên dải thực tế là:

$$R_{\text{app,BLE,code}} \in [48{,}8 \;;\; 97{,}6] \text{ kbps/thiết bị}$$

### RS485

Theo benchmark gốc ở `9600 bps`, thông lượng ứng dụng là:

$$R_{\text{app,RS485,9600}} \approx 5{,}5 \text{ kbps}$$

Nếu chạy đúng theo macro mặc định của code hiện tại là `115200 bps`, giá trị xấp xỉ sẽ tăng lên:

$$R_{\text{app,RS485,115200}} \approx 65{,}8 \text{ kbps}$$

---

### 3.2 Tổng thông lượng đi vào gateway

Giữ đúng kịch bản concurrency test của tài liệu gốc:

- Zigbee: `80 kbps`
- BLE DLE: `97,6 kbps`
- LoRa SF7/125: `3,5 kbps`

Tổng vào gateway là:

$$R_{\text{total,in}} = 80 + 97{,}6 + 3{,}5 = 181{,}1 \text{ kbps}$$

Quy đổi ra byte:

$$181{,}1 \text{ kbps} = 22{,}64 \text{ KB/s}$$

Trong một cửa sổ `50 ms`, lượng dữ liệu đi vào gateway chỉ khoảng:

$$D_{50\text{ms}} = 22{,}64 \times 1024 \times 0{,}05 \approx 1159 \text{ byte} \approx 1{,}1 \text{ KB}$$

Điểm này rất quan trọng: về mặt data-plane thuần túy, lượng dữ liệu đồng thời đi vào gateway không quá lớn. Vấn đề của single-MCU không nằm ở "không đủ băng thông nội bộ", mà nằm ở scheduler contention, internal RAM pressure và số lượng task phải cùng chia sẻ một chip.

---

### 3.3 Khả năng đệm dữ liệu của single-MCU so với dual-MCU

Trong firmware WAN hiện tại, mỗi uplink transport (`MQTT`, `HTTP`, `CoAP`) đều có queue publish `32 item`, mỗi item payload tối đa `2048 byte`.

Dung lượng đệm hữu dụng của một queue publish là:

$$B_{\text{queue}} = 32 \times 2048 = 65536 \text{ byte} = 64 \text{ KB}$$

Nếu single-MCU bỏ hẳn bridge queue SPI và đẩy thẳng vào queue publish này, thời gian đệm tối đa ở mức tải `181,1 kbps` là:

$$T_{\text{buffer,single}} = \frac{65536}{22637} \approx 2{,}90 \text{ s}$$

Ở kiến trúc dual-MCU hiện tại, nếu xem bridge queue `LAN -> WAN` và queue publish `WAN -> server` là hai tầng đệm nối tiếp, thì headroom xấp xỉ:

$$T_{\text{buffer,dual}} \approx 2{,}90 + 2{,}90 = 5{,}8 \text{ s}$$

Kết luận:

- Single-MCU có đường dữ liệu ngắn hơn nên latency tốt hơn.
- Dual-MCU có hai tầng đệm nên chịu burst tốt hơn khi WAN tạm nghẽn.

---

### 3.4 Bảng Hiệu suất Băng thông $\eta$ theo Giao thức

Vì single-MCU không thay đổi lớp radio và UART module, hiệu suất băng thông $\eta$ của từng giao thức **giống hệt** dual-MCU. Nút thắt vẫn nằm hoàn toàn ở các lớp vật lý bên dưới, không phải ở cầu nối nội bộ.

$$\eta = \frac{R_{\text{app}}}{R_{\text{PHY}}}$$

| Giao thức | $R_{\text{PHY}}$ | $R_{\text{app}}$ thực tế | $\eta$ | Nút thắt chính |
| :--- | :---: | :---: | :---: | :--- |
| Zigbee (giới hạn UART) | $250 \text{ kbps}$ | $\approx 80 \text{ kbps}$ | $32\%$ | UART `115200 bps`, `10,5 ms`/frame |
| Zigbee (ZCL thực tế, đa node) | $250 \text{ kbps}$ | $\approx 8{,}2 \text{ kbps}$ | $3{,}2\%$ | CSMA/CA Backoff + ZCL overhead |
| LoRa SF7/125 (payload thực) | $5{,}47 \text{ kbps}$ | $\approx 4{,}0 \text{ kbps}$ | $73\%$ | ToA $352{,}5 \text{ ms}$ + AT echo $81{,}9 \text{ ms}$ |
| LoRa SF7/125 (UART RX raw tại gateway) | $5{,}47 \text{ kbps}$ | $8{,}3\text{–}9{,}4 \text{ kbps}$ | — | Đếm raw UART stream, bao gồm metadata `LEN/RSSI/SNR` |
| LoRa SF7/250 | $10{,}94 \text{ kbps}$ | $\approx 6{,}1 \text{ kbps}$ | $56\%$ | ToA $48{,}8 \text{ ms}$/gói |
| BLE không DLE | $1000 \text{ kbps}$ | $\approx 8 \text{ kbps}$ | $0{,}8\%$ | MTU `20 byte`, CI `20 ms` |
| BLE DLE | $1000 \text{ kbps}$ | $\approx 97{,}6 \text{ kbps}$ | $9{,}7\%$ | CI `20 ms` |

Điều này xác nhận nhận định từ mục 3.1: **single-MCU không thay đổi thông lượng radio**, mà chỉ cải thiện độ trễ bằng cách loại bỏ $T_{\text{batch}}$ và $T_{\text{SPI}}$ khỏi pipeline.

---

### 3.5 Kiểm thử Đa kênh Đồng thời — Phân tích Con đường Dữ liệu Nội bộ

Phần này tính toán theo cùng phương pháp với mục 6.2 của `summarize_calc.md`, nhưng thay thế chặng SPI bằng internal dispatch của single-MCU.

#### Lượng dữ liệu thực tế tích lũy mỗi chu kỳ $T_{\text{batch}} = 50 \text{ ms}$

Dùng throughput thực tế có ZCL overhead (giống dual-MCU để so sánh công bằng):

- Zigbee ($8{,}2 \text{ kbps}$): $\dfrac{8200}{8} \times 0{,}05 \approx 51 \text{ byte}$
- BLE DLE ($97{,}6 \text{ kbps}$): $\dfrac{97600}{8} \times 0{,}05 = 610 \text{ byte}$
- LoRa SF7/125 ($3{,}5 \text{ kbps}$): $\dfrac{3500}{8} \times 0{,}05 \approx 22 \text{ byte}$

$$D_{\text{batch,total}} = 51 + 610 + 22 = 683 \text{ byte}$$

#### So sánh overhead chặng nội bộ: SPI (dual) vs. Internal Dispatch (single)

**Dual-MCU — truyền SPI 10 MHz (runtime thực tế):**

$$T_{\text{SPI}} = \frac{683 \times 8}{10 \times 10^{6}} = 0{,}547 \text{ ms}$$

$$U_{\text{SPI}} = \frac{T_{\text{SPI}}}{T_{\text{batch}}} = \frac{0{,}547}{50} = 1{,}09\%$$

**Single-MCU — internal dispatch vào queue publish:**

Toàn bộ `683 byte` được đẩy trực tiếp vào RTOS queue bằng `xQueueSend`. Với khoảng 3 giao thức × 2 lần gọi mỗi chu kỳ, overhead ước lượng là:

$$T_{\text{dispatch}} \approx 6 \times 10 \;\mu\text{s} = 0{,}06 \text{ ms}$$

$$U_{\text{dispatch}} = \frac{0{,}06}{50} = 0{,}12\%$$

Single-MCU internal dispatch **nhanh hơn gấp ~9 lần** so với SPI ở cùng lượng dữ liệu.

#### Mức lấp đầy queue publish

Queue publish hiện tại của mỗi transport (`MQTT`, `HTTP`, `CoAP`) có dung lượng $32 \times 2048 = 65536 \text{ byte}$.

$$U_{\text{queue,50ms}} = \frac{683}{65536} \approx 1{,}04\%$$

Queue gần như trống hoàn toàn giữa các lần flush, không tạo backpressure lên listener task.

#### Lợi thế thực sự: giảm được $T_{\text{batch}}$

Trong dual-MCU, $T_{\text{batch}} = 50 \text{ ms}$ là bắt buộc để amortize overhead SPI. Trong single-MCU, không còn lý do kỹ thuật nào buộc phải giữ cửa sổ này ở `50 ms`. Có thể rút xuống `5–10 ms` hoặc chuyển sang publish event-driven.

Nếu lấy $T_{\text{batch,new}} = 10 \text{ ms}$:

$$D_{\text{batch,10ms}} = \frac{683}{5} \approx 137 \text{ byte}$$

$$T_{\text{dispatch,10ms}} \approx 4 \times 10 \;\mu\text{s} = 0{,}04 \text{ ms}$$

$$U_{\text{dispatch,10ms}} = \frac{0{,}04}{10} = 0{,}40\%$$

$$U_{\text{queue,10ms}} = \frac{137}{65536} \approx 0{,}21\%$$

Độ trễ trung bình cải thiện được khi giảm $T_{\text{batch}}$ từ `50 ms` xuống `10 ms` (giả sử phân phối đều):

$$\Delta T_{\text{avg}} = \frac{50}{2} - \frac{10}{2} = 25 - 5 = 20 \text{ ms}$$

Đây là phần cải thiện có thể đo được trong kiểm thử thực tế, đặc biệt rõ ràng với Zigbee và BLE.

#### Thông lượng tổng và headroom đệm

Tổng throughput thực tế ba kênh đồng thời không đổi:

$$R_{\text{total,practical}} = 8{,}2 + 97{,}6 + 3{,}5 = 109{,}3 \text{ kbps}$$

Tương đương:

$$109{,}3 \text{ kbps} = 13{,}66 \text{ KB/s}$$

Thời gian đệm tối đa của queue publish đơn ở tải `109,3 kbps`:

$$T_{\text{buffer,queue}} = \frac{65536}{13662} \approx 4{,}80 \text{ s}$$

Dual-MCU có hai tầng đệm nối tiếp nên headroom lý thuyết lên đến $\approx 9{,}6 \text{ s}$, nhưng single-MCU bù lại bằng độ trễ đường đi thấp hơn và không có điểm nghẽn tại SPI.

#### Bảng tổng hợp so sánh hiệu năng nội bộ

| Tham số | Dual-MCU (SPI 10 MHz) | Single-MCU ($T_{\text{batch}}=50 \text{ ms}$) | Single-MCU ($T_{\text{batch}}=10 \text{ ms}$) |
| :--- | :---: | :---: | :---: |
| Cửa sổ gom gói $T_{\text{batch}}$ | $0\text{–}50 \text{ ms}$ | $0\text{–}50 \text{ ms}$ | $0\text{–}10 \text{ ms}$ |
| $T_{\text{SPI}}$ / $T_{\text{dispatch}}$ | $0{,}547 \text{ ms}$ | $0{,}06 \text{ ms}$ | $0{,}04 \text{ ms}$ |
| Hệ số sử dụng chặng nội bộ | $1{,}09\%$ | $0{,}12\%$ | $0{,}40\%$ |
| Dữ liệu mỗi cửa sổ | $683 \text{ byte}$ | $683 \text{ byte}$ | $137 \text{ byte}$ |
| Mức lấp đầy queue publish | $1{,}04\%$ (bridge queue) | $1{,}04\%$ | $0{,}21\%$ |
| Headroom đệm tổng | ${\approx}9{,}6 \text{ s}$ (2 tầng) | ${\approx}4{,}8 \text{ s}$ (1 tầng) | ${\approx}4{,}8 \text{ s}$ (1 tầng) |
| $T_{\text{e2e}}$ Zigbee → MQTT (trung bình) | ${\approx}35 \text{ ms}$ | ${\approx}35 \text{ ms}$ | ${\approx}20 \text{ ms}$ |
| $T_{\text{e2e}}$ BLE → MQTT (trung bình) | ${\approx}30 \text{ ms}$ | ${\approx}30 \text{ ms}$ | ${\approx}15 \text{ ms}$ |

**Nhận xét:**

- Chặng nội bộ của single-MCU **không bao giờ là nút thắt** — $U_{\text{dispatch}} < 0{,}5\%$ trong mọi kịch bản.
- Lợi ích định lượng rõ nhất đến từ việc rút ngắn $T_{\text{batch}}$, không phải từ tốc độ truyền tải raw.
- Headroom đệm của single-MCU giảm đi một nửa so với dual-MCU, cần được bù đắp bằng cách tăng độ sâu queue publish nếu WAN thường xuyên bị nghẽn burst.

---

## 4. Độ trễ End-to-End nếu Chỉ Thay Đổi Kiến trúc

### 4.1 Thành phần độ trễ nội bộ mới

Khi bỏ SPI, hai thành phần biến mất là:

- $T_{\text{batch}} = 0\text{–}50 \text{ ms}$
- $T_{\text{SPI}} \approx 0{,}82 \text{ ms}$ cho batch khoảng `1 KB`

Thay vào đó là $T_{\text{dispatch}}$, tức thời gian queue nội bộ, wake-up task publish, copy dữ liệu và jitter scheduler bình thường. Với `FreeRTOS 100 Hz`, một ước lượng sạch, chưa tính trạng thái quá tải, là:

$$T_{\text{dispatch,clean}} = 0\text{–}10 \text{ ms}$$

Vẫn giữ:

$$T_{\text{JSON}} \approx 0{,}3 \text{ ms}$$

### 4.2 Độ trễ end-to-end ở chế độ sạch

#### Zigbee -> MQTT

$$T_{\text{e2e,Zigbee,single}} = 5{,}0 + 10{,}5 + (0\text{–}10) + 0{,}3 = 15{,}8\text{–}25{,}8 \text{ ms}$$

#### LoRa SF7/125 -> MQTT

$$T_{\text{e2e,LoRa,single}} = 97{,}5 + 15 + (0\text{–}10) + 0{,}3 = 112{,}8\text{–}122{,}8 \text{ ms}$$

#### LoRa SF12/125 -> MQTT

$$T_{\text{e2e,LoRa12,single}} = 2302 + 15 + (0\text{–}10) + 0{,}3 = 2317{,}3\text{–}2327{,}3 \text{ ms}$$

#### BLE -> MQTT

$$T_{\text{e2e,BLE,single}} = 2{,}2 + 0 + (0\text{–}10) + 0{,}3 = 2{,}5\text{–}12{,}5 \text{ ms}$$

### 4.3 So sánh với dual-MCU

| Kịch bản | Dual-MCU | Single-MCU sạch | Nhận xét |
| :--- | :---: | :---: | :--- |
| Zigbee -> MQTT | `10–60 ms` | `15,8–25,8 ms` | Giảm jitter rõ rệt vì bỏ batch `50 ms` |
| LoRa SF7/125 -> MQTT | `100–150 ms` | `112,8–122,8 ms` | Cải thiện nhỏ vì LoRa bị air time thống trị |
| LoRa SF12/125 -> MQTT | `~2,6 s` | `~2,32 s` | Cải thiện ít, vẫn bị ToA thống trị |
| BLE -> MQTT | `4–55 ms` | `2,5–12,5 ms` | Cải thiện lớn nhất |

Nếu chỉ nhìn ở trạng thái sạch, single-MCU trông rất hấp dẫn: không tăng throughput radio, nhưng giảm đáng kể latency của Zigbee và BLE.

Tuy nhiên đây chưa phải bức tranh đầy đủ, vì khi dồn mọi task về một MCU, $T_{\text{dispatch}}$ không còn chỉ là `0–10 ms`. Nó còn phụ thuộc mạnh vào scheduler contention.

---

## 5. Độ trễ Xử lý Task khi Dồn Tất Cả về 1 MCU

Đây là phần quan trọng nhất để đánh giá tính khả thi thực tế của single-MCU.

### 5.1 Bản đồ priority hiện tại trong code

Các nhóm task dữ liệu hiện nay đang có priority như sau:

- Listener Zigbee, LoRa, BLE module: `priority 4`
- Uplink Zigbee, LoRa, BLE và các publish task WAN: `priority 5`
- Downlink Zigbee, LoRa, BLE và config xử lý nặng: `priority 6`
- `wan_downlink` ở LAN MCU hiện tại: `priority 7`
- Monitor, benchmark, internet monitor: `priority 3`

Điều đó có nghĩa là trong một single-MCU, listener task của Zigbee, BLE, LoRa sẽ luôn bị chặn bởi mọi burst công việc ở mức `priority 5` và `priority 6`.

### 5.2 Một MCU sẽ phải handle bao nhiêu task?

#### Nếu tái kiến trúc single-MCU đúng cách

Các nhóm task chính cần giữ lại là:

| Nhóm task | Số lượng |
| :--- | :---: |
| Zigbee: uplink + downlink + listener, 2 stack | `6` |
| LoRa: uplink + downlink + listener, 2 stack | `6` |
| BLE module: uplink + downlink + listener, 2 stack | `6` |
| BLE Native: uplink + downlink | `2` |
| BLE GATT: uplink + downlink | `2` |
| RS485 handler | `1` |
| LAN config handler | `1` |
| Module monitor | `1` |
| Benchmark counter | `1` |
| WAN config handler | `1` |
| UART/data handler | `1` |
| Internet monitor | `1` |
| HMI RX | `1` |
| Server transport (`MQTT` hoặc `HTTP` hoặc `CoAP`) | `2` |
| Internet link: `LTE = 1`, `Ethernet = 1`, `Wi-Fi = 2` | `1–2` |

Tổng application task ở bản single-MCU tái kiến trúc gọn là:

$$N_{\text{app,single,clean}} = 33\text{–}34 \text{ task}$$

Nếu thêm captive portal, OTA task hoặc một số service phụ, con số thực tế dễ lên:

$$N_{\text{app,single,clean+opt}} = 35\text{–}37 \text{ task}$$

#### Nếu dồn nguyên xi hai firmware hiện tại lên một chip

Nếu cộng cơ học cả các task dùng riêng cho giao tiếp liên-MCU mà chưa tái kiến trúc, sẽ còn phải cộng thêm `wan_uplink`, `wan_downlink`, `lan_uplink`, `lan_fota`.

Khi đó số task application có thể lên tới:

$$N_{\text{app,single,cơ học}} = 37\text{–}41 \text{ task}$$

#### Nếu tính cả task hệ thống của ESP-IDF

Ngoài application task, scheduler còn phải gánh thêm: idle task của core 0 và core 1, timer service, event loop, `tcpip_thread`, BT controller và BT host task, Wi-Fi driver task nếu bật Wi-Fi, callback nội bộ của MQTT, HTTP và socket stack.

Vì vậy số task thực mà một single-MCU phải scheduling ở runtime rất dễ nằm trong miền:

$$N_{\text{sched,real}} \approx 42\text{–}50{+} \text{ task}$$

Đây là khác biệt lớn nhất so với dual-MCU: ở dual-MCU, các task WAN không tranh CPU trực tiếp với listener Zigbee, LoRa, BLE ở LAN MCU.

### 5.3 Mô hình độ trễ scheduler bổ sung

Có thể mô hình hóa phần trễ do dồn task như sau:

$$T_{\text{sched,extra}} = T_{\text{higher-prio}} + T_{\text{same-prio}} + T_{\text{tick-jitter}}$$

Với `tick = 10 ms`, nếu tại một thời điểm có 3 uplink task đang bận đóng gói dữ liệu, 1 publish task đang hex-encode và tạo JSON, và 1 downlink hoặc config task đang xử lý lệnh, thì một ước lượng thực tế cho phần trễ scheduler thêm vào listener task là:

$$T_{\text{sched,extra,normal}} = 5\text{–}15 \text{ ms}$$

Trong các pha xấu hơn như MQTT reconnect, Wi-Fi và BLE coexistence, HTTP hoặc CoAP transaction lớn, hay OTA flash write, extra scheduling delay hoàn toàn có thể nhảy lên:

$$T_{\text{sched,extra,stress}} = 20\text{–}40 \text{ ms}$$

Nói cách khác, best-case latency của single-MCU rất đẹp, nhưng nếu hệ thống bị dồn việc vào cùng một thời điểm thì phần lợi thế đó có thể bị ăn mòn đáng kể.

### 5.4 Ảnh hưởng theo từng giao thức

#### Zigbee

Zigbee là giao thức nhạy nhất với scheduler delay ở phía MCU vì cứ khoảng `10,5 ms` là có thể nhận thêm một frame UART cỡ `121 byte`. Nếu listener task bị chậm thêm `20–30 ms`, có thể tích lũy tương đương `2–3 frame` trước khi drain được UART.

Code hiện tại cấp `ZIGBEE_LISTEN_BUFFER_SIZE = 2048`, tương đương thời gian lấp đầy lý thuyết:

$$T_{\text{fill,2048}} = \frac{2048 \times 10}{115200} \approx 177{,}8 \text{ ms}$$

Biên này nhìn qua có vẻ rộng, nhưng đây chỉ là buffer ở tầng software. Trước đó vẫn còn UART driver buffer và buffer nội bộ của module. Vì vậy khi scheduler bị kẹt bởi publish hoặc network task, Zigbee là luồng dễ bị drop trước.

#### BLE

BLE native và BLE GATT tuy không phải đi qua UART module, nhưng lại chia sẻ cùng BT stack và RF front-end. Nếu single-MCU dùng cả Wi-Fi lẫn BLE, callback BLE, notify uplink, scan result và công việc WAN sẽ chen nhau trên cùng chip. Vì vậy BLE có thể không mất throughput lý thuyết, nhưng latency callback-to-uplink và nguy cơ queue buildup sẽ tăng rõ.

#### LoRa

LoRa ít nhạy hơn với scheduler delay vì bản thân số gói trên giây thấp và `Time-on-Air` lớn. Delay thêm `10–20 ms` không thay đổi đáng kể throughput, nhưng sẽ làm phản hồi lệnh và thời gian xuất hiện dữ liệu ở server chậm hơn.

### 5.5 Bảng latency khi tính thêm áp lực scheduler

| Kịch bản | Dual-MCU | Single-MCU sạch | Single-MCU khi task bị dồn |
| :--- | :---: | :---: | :---: |
| Zigbee -> MQTT | `10–60 ms` | `15,8–25,8 ms` | `25,8–55,8 ms` |
| LoRa SF7/125 -> MQTT | `100–150 ms` | `112,8–122,8 ms` | `122,8–152,8 ms` |
| BLE -> MQTT | `4–55 ms` | `2,5–12,5 ms` | `12,5–42,5 ms` |

Ý nghĩa của bảng này là:

- Single-MCU vẫn có thể tốt hơn trong trạng thái tải bình thường.
- Nhưng khi tất cả task cùng thức dậy và tranh CPU, latency của single-MCU sẽ bị kéo gần trở lại vùng dual-MCU.
- Lợi thế lớn nhất của dual-MCU không phải throughput, mà là tách scheduler contention thành hai chip khác nhau.

---

## 6. Hiệu quả Sử dụng Internal RAM: Single so với Dual

Phần này cần tách thành hai góc nhìn khác nhau vì "hiệu quả" ở đây có thể hiểu theo hai nghĩa:

1. Ít lãng phí tổng byte internal RAM trên toàn hệ thống.
2. Ít áp lực peak internal RAM trên từng chip tại runtime.

Hai nghĩa này không cho cùng một kết luận.

### 6.1 Những gì chắc chắn đang nằm ở internal RAM trong code hiện tại

#### Các vùng reserve ở cả hai firmware

Cả `DA2_esp` và `DA2_esp_LAN` đều đang cấu hình:

- `CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL = 16384`
- `CONFIG_SPIRAM_MALLOC_RESERVE_INTERNAL = 32768`

Tức mỗi firmware luôn dành riêng:

$$M_{\text{reserve/fw}} = 16 + 32 = 48 \text{ KB}$$

#### Các stack đang buộc dùng internal RAM

Những task application có stack internal được xác nhận trực tiếp trong code hiện tại gồm:

- `LAN config_handler`: `16 KB internal`
- `module_monitor`: `16 KB internal`
- `WAN config_handler`: `4 KB internal`
- `internet_monitor`: `4 KB internal`
- `Wi-Fi init + Wi-Fi config`: `8 KB internal` nếu chọn đường Wi-Fi
- `advanced_ota_task`: `16 KB internal` khi OTA vì flash-sensitive API không được phép chạy stack trên PSRAM

Như vậy, chỉ riêng các stack nội bộ chắc chắn internal ở kịch bản single-MCU đã vào khoảng:

$$M_{\text{stack,internal,baseline}} = 40\text{–}48 \text{ KB}$$

và khi OTA hoạt động sẽ thành:

$$M_{\text{stack,internal,OTA}} = 56\text{–}64 \text{ KB}$$

#### TCB và queue control block vẫn ở internal RAM

Dù rất nhiều stack và queue storage đã được đẩy sang PSRAM, mỗi task vẫn cần `StaticTask_t`, mỗi queue vẫn cần `StaticQueue_t` hoặc queue object ở internal RAM.

Nếu dùng quy đổi gần đúng như tài liệu gốc với mỗi task control block khoảng `176 byte`, thì với bản single-MCU tái kiến trúc sạch:

$$M_{\text{TCB,single,clean}} = 33\text{–}37 \times 176 \text{ B} = 5{,}8\text{–}6{,}5 \text{ KB}$$

Nếu cộng cơ học gần như toàn bộ hai firmware:

$$M_{\text{TCB,single,cơ học}} = 37\text{–}41 \times 176 \text{ B} = 6{,}5\text{–}7{,}2 \text{ KB}$$

Phần queue control block không lớn bằng stack, nhưng với khoảng hơn hai chục queue hoạt động, vẫn phải tính thêm vài KB internal RAM. Một xấp xỉ hợp lý là:

$$M_{\text{queue-ctrl}} \approx 2\text{–}3 \text{ KB}$$

### 6.2 So sánh theo góc nhìn ít lãng phí tổng hệ thống

Nếu chỉ nhìn tổng byte reserve bị nhân đôi bởi kiến trúc dual-MCU, thì single-MCU hiệu quả hơn.

**Dual-MCU:**

$$M_{\text{reserve,dual}} = 2 \times 48 = 96 \text{ KB}$$

**Single-MCU:**

$$M_{\text{reserve,single}} = 48 \text{ KB}$$

Khoản reserve bị trùng lặp mà single-MCU loại bỏ được là:

$$\Delta M_{\text{reserve}} = 96 - 48 = 48 \text{ KB}$$

Ngoài ra, single-MCU cũng loại bỏ được một ít overhead metadata của các queue và task chỉ phục vụ bridge giữa hai MCU.

**Kết luận:** Single-MCU hiệu quả hơn về tổng byte internal RAM bị nhân đôi ở cấp hệ thống.

### 6.3 So sánh theo góc nhìn áp lực peak trên một chip

Theo góc nhìn runtime safety, kết luận lại ngược lại.

**Dual-MCU:**

- Tổng raw internal SRAM của cả hệ thống là $2 \times 512 = 1024 \text{ KB}$.
- Wi-Fi, LWIP, TLS, MQTT, HTTP, CoAP tập trung chủ yếu trên WAN MCU.
- BT/BLE, Zigbee, LoRa, listener và monitor tập trung chủ yếu trên LAN MCU.
- Peak internal RAM pressure được chia thành hai miền tách biệt.

**Single-MCU:**

- Tổng raw internal SRAM chỉ còn `512 KB`.
- Tất cả các thành phần Wi-Fi, LWIP, TLS và BT/BLE controller hoặc host cùng tranh chấp trên một chip.
- Các stack buộc internal, TCB, queue control block, semaphore, event group, driver object đều dồn về một nơi.

Chỉ tính phần rõ ràng nhìn thấy được trong code, bản single-MCU đã phải dành khoảng:

$$M_{\text{known,internal}} = \underbrace{48}_{\text{reserve}} + \underbrace{40\text{–}48}_{\text{stacks}} + \underbrace{6\text{–}7}_{\text{TCB}} + \underbrace{2\text{–}3}_{\text{queue-ctrl}} \approx 96\text{–}106 \text{ KB}$$

Đó mới chỉ là phần application-side nhìn thấy rõ từ code. Chưa tính BT controller và BT host, Wi-Fi driver, LWIP / TCPIP thread, TLS / socket buffer, các vùng DMA hoặc internal của driver, OTA transient pressure khi flash đang ghi.

**Kết luận:** Dual-MCU hiệu quả hơn về peak internal RAM headroom trên từng chip.

### 6.4 Bảng kết luận về internal RAM

| Tiêu chí | Dual-MCU | Single-MCU | Đánh giá |
| :--- | :---: | :---: | :--- |
| Reserve bị nhân đôi toàn hệ thống | `96 KB` | `48 KB` | Single-MCU tốt hơn |
| Tổng raw internal SRAM của hệ thống | `1024 KB` | `512 KB` | Dual-MCU tốt hơn |
| Áp lực peak Wi-Fi + BLE cùng một chip | Không | Có | Dual-MCU tốt hơn |
| Độ đơn giản về metadata và bridge | Kém hơn | Tốt hơn | Single-MCU tốt hơn |
| Rủi ro thiếu contiguous internal RAM khi OTA / reconnect | Thấp hơn | Cao hơn | Dual-MCU tốt hơn |

Tóm lại:

- Nếu hỏi "hệ thống nào ít lãng phí internal RAM hơn ở cấp kiến trúc" → **single-MCU thắng**.
- Nếu hỏi "hệ thống nào an toàn hơn về headroom internal RAM khi chạy thật" → **dual-MCU thắng**.

---

## 7. Kết luận Tổng hợp

### 7.1 Những gì single-MCU cải thiện được

- Bỏ hoàn toàn chặng SPI giữa hai MCU.
- Bỏ được batch `50 ms` vốn chỉ sinh ra để amortize SPI.
- Giảm mạnh latency sạch của Zigbee và BLE.
- Giảm duplication overhead của reserve internal RAM ở cấp hệ thống.
- Kiến trúc dữ liệu ngắn hơn, ít lớp ACK và handshake nội bộ hơn.

### 7.2 Những gì single-MCU không cải thiện được

- Không làm Zigbee nhanh hơn về throughput, vì nút thắt vẫn là UART `115200 bps` của module.
- Không làm LoRa nhanh hơn về throughput, vì `Time-on-Air` và overhead AT vẫn giữ nguyên.
- Không làm BLE có nhiều connection hơn, vì budget usable hiện vẫn bị chặn ở `8` kết nối đồng thời.

### 7.3 Những gì single-MCU sẽ tệ hơn nếu dồn nguyên xi toàn bộ task

- Một MCU phải scheduling khoảng `33–37` application task ở bản tái kiến trúc sạch, hoặc `37–41` task nếu cộng cơ học hai firmware.
- Khi tính cả task hệ thống, runtime scheduler hoàn toàn có thể phải xoay `42–50+` task.
- Internal RAM pressure sẽ tập trung lên một chip duy nhất.
- Scheduler contention sẽ làm lợi thế latency tốt nhất của single-MCU bị co lại, đặc biệt với Zigbee và BLE.

### 7.4 Kết luận cuối cùng

Nếu mục tiêu là: **BOM thấp hơn**, **đường dữ liệu ngắn hơn**, **latency sạch thấp hơn**, và uplink WAN chủ yếu là `LTE` hoặc `Ethernet` — thì single-MCU ESP32-S3 là một hướng **khả thi**.

Nhưng nếu mục tiêu là: **chạy đồng thời nhiều giao thức**, **ít rủi ro scheduler contention**, **ít áp lực peak internal RAM**, **có vùng cách ly rõ giữa LAN-side và WAN-side** — thì kiến trúc dual-MCU hiện tại vẫn có lợi thế kỹ thuật rất rõ.

Nói ngắn gọn:

- **Single-MCU thắng** về độ gọn kiến trúc và latency sạch.
- **Dual-MCU thắng** về isolation, peak internal RAM headroom và độ an toàn scheduler khi hệ thống bị dồn tải.

---

## 8. Khuyến nghị nếu Muốn Thử Single-MCU Thực Tế

Nếu muốn đi tiếp từ phân tích này sang prototype thật, thứ tự hợp lý là:

1. Không cộng cơ học nguyên hai firmware, mà phải xóa hẳn các task bridge liên-MCU trước.
2. Giảm số task bằng cách gom listener hoặc chuyển một phần logic sang event-driven callback.
3. Ưu tiên uplink `LTE` hoặc `Ethernet`; tránh để `Wi-Fi` và `BLE` phải cùng tranh RF nếu không cần.
4. Đo lại internal heap watermark ở các pha sau:
   - Zigbee + BLE + LoRa concurrency
   - reconnect mạng
   - OTA flash write
   - BLE notify tốc độ cao
5. Nếu internal heap headroom còn thấp, single-MCU sẽ chỉ phù hợp khi cắt bớt feature set, không còn là bản gộp đầy đủ của cả hai firmware hiện tại.
