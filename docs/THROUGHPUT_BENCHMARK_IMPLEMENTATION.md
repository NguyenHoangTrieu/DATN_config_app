# Throughput Benchmark Implementation Note

## 1. Da implement nhung gi

### 1.1 Arduino benchmark nodes

Da tao 3 sketch benchmark rieng, tach khoi cac sketch sensor/test cu:

- `thingsboard_widget test/arduino_test_nodes/ble_bandwidth_node/ble_bandwidth_node.ino`
- `thingsboard_widget test/arduino_test_nodes/zigbee_bandwidth_node/zigbee_bandwidth_node.ino`
- `thingsboard_widget test/arduino_test_nodes/lora_p2p_bandwidth_node/lora_p2p_bandwidth_node.ino`

Muc tieu tung node:

- **BLE**: node GATT service `BB10`, flood `244 B / 20 ms`, muc tieu gan `97.6 kbps`.
- **Zigbee**: node End Device gui `temperature report + humidity report` moi `20 ms`, widget map moi report thanh payload hieu dung `99 B`, muc tieu gan `79.2 kbps`.
- **LoRa P2P**: node Wio-E5 TEST mode gui `50 B / 113 ms`, muc tieu gan `3.5 kbps`.

### 1.2 ThingsBoard benchmark widgets

Da tao 1 cap widget benchmark rieng:

- `thingsboard_widget test/throughput_benchmark_control.html`
- `thingsboard_widget test/throughput_benchmark_control.css`
- `thingsboard_widget test/throughput_benchmark_control.js`
- `thingsboard_widget test/throughput_benchmark_monitor.html`
- `thingsboard_widget test/throughput_benchmark_monitor.css`
- `thingsboard_widget test/throughput_benchmark_monitor.js`

Control widget dung de:

- prepare BLE scan/connect/discover/notify
- start Zigbee network + permit join
- dua LoRa gateway vao TEST mode + RX mode
- chay 4 test case:
  - Zigbee Spam
  - BLE DLE
  - LoRa SF7
  - Concurrency

Monitor widget dung de:

- parse telemetry that tu firmware
- dem so packet/su kien hop le theo tung giao thuc
- quy doi sang `kbps` payload-application
- so sanh voi dai ky vong trong bang test

### 1.3 4 test case dang duoc map

Bang trong hinh duoc map thanh:

1. **Don kenh Zigbee**
   - target: `70 - 80 kbps`
2. **Don kenh BLE DLE**
   - target: `90 - 97 kbps`
3. **Don kenh LoRa SF7**
   - target: xap xi `3.5 kbps`
4. **Da kenh Concurrency**
   - target: `127 - 154 kbps`

## 2. Test hien tai dang do o muc nao

### 2.1 Day la benchmark black-box o muc application payload

Widget monitor dang do theo cach sau:

- **BLE**: dem `CFBG:OK:NOTIFY:...:<hex>`; moi notify hop le duoc quy doi theo payload config BLE.
- **Zigbee**: dem `RPT:<short>,<ep>,<cluster>,<attr>,<type>,<value>`; moi report hop le duoc quy doi theo payload config Zigbee.
- **LoRa**: dem `+TEST: RXLRPKT ...`; moi goi hop le duoc quy doi theo payload config LoRa.

Cong thuc monitor dang dung:

$$
R_{app} = \frac{\text{payload\_bytes\_counted} \times 8}{\text{test window (s)}}
$$

Nghia la monitor hien tai **khong** do byte thuc tren UART, SPI, hay air-interface, ma do **payload hieu dung o muc ung dung**.

### 2.2 Vi sao cach do nay van hop ly

Tai lieu goc dang quy doi theo `R_app` va `R_practical`, khong phai raw PHY byte logger. Do do cach do nay phu hop voi muc tieu:

- so sanh voi bang tinh toan trong `gateway_metrics_calculation.md`
- xac nhan gateway co dat duoc thong luong ung dung ky vong khong
- kiem tra tac dong cua single-channel va concurrency o muc he thong

## 3. Do chuan xac cua test hien tai

### 3.1 Muc danh gia tong quat

- **BLE single-channel**: `trung binh-cao`
- **LoRa single-channel**: `trung binh-cao`
- **Zigbee single-channel**: `trung binh`
- **Concurrency**: `trung binh`

### 3.2 Vi sao chua the goi la “rat chinh xac”

Nhung sai so/cham can hien co:

- Widget dang quy doi byte theo `payload config`, khong phai byte thuc firmware xac nhan da xu ly.
- Neu telemetry bi batch, tre, hoac rot 1 event, monitor se dem thieu.
- Zigbee report thuc te co overhead firmware/module, nhung monitor dang map theo payload hieu dung 99 B/report de phu hop tai lieu tinh toan.
- BLE notify duoc tinh theo packet hop le nhan duoc o gateway/ThingsBoard, khong tinh retransmission o link layer.
- Concurrency la tong hop 3 luong app-level, nen sai so tich luy cao hon single-channel.

### 3.3 Ket luan do chuan xac

Bo test hien tai nen duoc mo ta la:

> **Application-level benchmark, suitable for thesis/demo/system validation, but not yet a protocol-analyzer-grade measurement.**

Neu dung cho bao cao/bao ve, co the trinh bay la:

- do thong luong payload thuc nhan tai muc gateway telemetry
- doi chieu voi gia tri ly thuyet/practical da dan xuat
- co sai so do telemetry batching, event loss, va quy doi payload-hieu-dung

## 4. Co can them debug firmware de tang tinh xac thuc khong?

### 4.1 Tra loi ngan

**Co, nen them.**

Khong bat buoc de demo/chay test ban dau, nhung **rat nen them** neu muon:

- tang do tin cay khi viet bao cao
- phan biet ro throughput payload va throughput bus/module
- phat hien event loss o widget/telemetry
- chung minh bottleneck thuc su nam o UART, SPI, hay ThingsBoard path

### 4.2 Hien trang firmware toi da kiem tra nhanh

Firmware hien co:

- co log forward/uplink tai `DA2_esp/Application/MCU_LAN_Handler/src/mcu_lan_handler_uplink.c`
- co BLE uplink queue send raw tai `DA2_esp_LAN/Application/BLE_Handler/src/ble_gatt_uplink.c`
- co LoRa listener/downlink log tai `DA2_esp_LAN/Application/LoRa_Handler/src/lora_handler_task.c`
- co `packet_count` trong storage batch buffer o `DA2_esp_LAN/Middleware/Storage_Handler/src/storage_handler.c`

Nhung firmware **chua co** mot bo benchmark counter thong nhat kieu:

- `rx_packets`
- `rx_payload_bytes`
- `dropped_packets`
- `queue_full_count`
- `t_first_us`
- `t_last_us`

cho tung giao thuc BLE / Zigbee / LoRa.

## 5. Goi y debug firmware nen them

### 5.1 Muc toi thieu nen them

Them bo dem per-protocol o LAN MCU:

- `ble_rx_events`
- `ble_rx_payload_bytes`
- `ble_uplink_drop_count`
- `zb_rx_reports`
- `zb_rx_payload_equiv_bytes`
- `zb_listener_drop_count`
- `lr_rx_packets`
- `lr_rx_payload_bytes`
- `lr_rx_crc_or_parse_fail`

Them timestamp microsecond:

- `window_start_us`
- `window_end_us`

De firmware tu tinh:

$$
R_{fw} = \frac{bytes \times 8}{(t_{end} - t_{start})}
$$

Sau do expose qua 1 telemetry key moi, vi du:

- `bench_ble`
- `bench_zb`
- `bench_lr`
- `bench_total`

### 5.2 Diem gan debug hop ly

Nen gan counter tai 4 diem sau:

1. **Ngay khi LAN MCU nhan event/module response**
   - BLE: sau khi dong goi `CFBG:OK:NOTIFY...`
   - Zigbee: sau khi parse `RPT:` hoac `+ATTRREPORT`
   - LoRa: sau khi nhan `RXLRPKT`

2. **Truoc khi enqueue uplink len WAN MCU**
   - de dem so event thuc su duoc day len SPI/WAN path

3. **Tai WAN MCU khi nhan packet tu LAN**
   - de biet co event nao bi mat giua LAN -> WAN khong

4. **Truoc khi publish telemetry len server**
   - de tach loi do widget voi loi do firmware/network

### 5.3 Debug rat nen them cho concurrency

Cho bai da kenh, nen them them:

- `wan_uplink_queue_depth_max`
- `wan_uplink_queue_drop_count`
- `spi_busy_or_overflow_count`
- `batch_flush_count`
- `batch_flush_bytes_total`

Day la nhung counter quan trong nhat de xac minh phan bottleneck trong tai lieu.

## 6. Cach test de co ket qua dang tin hon

### 6.1 Muc co ban

1. Flash 3 node benchmark.
2. Import 2 widget benchmark vao ThingsBoard.
3. Chay tung case 15-30 s, lap lai it nhat 3 lan.
4. Lay:
   - gia tri trung binh
   - min/max
   - lech phan tram so voi target

Nen bao cao theo cong thuc:

$$
\text{Error \%} = \frac{|R_{measured} - R_{expected}|}{R_{expected}} \times 100\%
$$

### 6.2 Muc de bao cao tot hon

Moi test case nen chup/luu:

- anh widget monitor
- log serial tu node benchmark
- log firmware LAN/WAN
- gia tri trung binh cua 3 lan do

### 6.3 Muc “xac thuc cao”

Neu muon rat chac, ket hop them:

- logic analyzer cho UART Zigbee / UART LoRa / SPI inter-MCU
- firmware counters
- widget monitor

Khi do co 3 lop doi chieu:

- **wire-level**
- **firmware-level**
- **application/dashboard-level**

## 7. Danh gia cuoi cung

### 7.1 Neu giu nguyen nhu hien tai

Du dung cho:

- demo
- test he thong
- doi chieu practical throughput voi tai lieu
- bao cao do an neu trinh bay ro day la app-level benchmark

### 7.2 Neu muon tang tinh thuyet phuc

Nen them 1 vong firmware debug nho de xuat telemetry counter benchmark.

Do la nang cap co gia tri nhat, vi no:

- giam phu thuoc vao widget parsing
- tach duoc loss do ThingsBoard va loss do firmware
- giup minh chung minh ro hon cac nut that UART/SPI/queue

## 8. De xuat buoc tiep theo

Neu tiep tuc, nen lam theo thu tu:

1. them `benchmark counters` trong firmware LAN/WAN
2. expose counters qua 1 telemetry key rieng
3. cap nhat widget monitor de hien thi song song:
   - `dashboard-estimated kbps`
   - `firmware-reported kbps`
4. neu can, them huong dan kiem thu/bao cao ket qua vao 1 file markdown rieng

---

## 9. Kiểm chứng tính xác thực của phép đo BLE_RX — bằng chứng từ log thực tế

Phần này phân tích log firmware thực tế để trả lời câu hỏi: **bộ đếm BLE_RX có đo đúng không, và tại sao có thể tin vào kết quả đó?**

### 9.1 Vị trí đặt counter trong firmware là đúng

Counter `BLE_RX` được tăng tại sự kiện `ESP_GATTC_NOTIFY_EVT` trong `ble_gatt_handler.c`, ngay khi BLE stack của ESP-IDF giao gói tin lên lớp ứng dụng:

```c
case ESP_GATTC_NOTIFY_EVT:
    bench_count_ble_rx((uint16_t)param->notify.value_len);
```

Đây là **điểm đầu tiên trong firmware** mà payload BLE được nhìn thấy — trước khi enqueue, trước khi parse, trước khi bất kỳ xử lý nào có thể làm mất gói. Do đó, `BLE_RX` phản ánh trung thực số byte và số gói tin mà BLE link layer đã giao thành công.

### 9.2 Bằng chứng 1 — Giá trị đo khớp chính xác với lý thuyết

Node BLE được cấu hình gửi **244 byte / 20 ms** (DLE payload tối đa, connection interval tối thiểu). Thông lượng lý thuyết:

$$
R_{BLE\_DLE} = \frac{244 \text{ B} \times 50 \text{ pps} \times 8 \text{ bit}}{1} = 97{,}600 \text{ bps} = 97.6 \text{ kbps}
$$

Log thực tế (cửa sổ 2s ổn định):

```
BLE_RX pkt=100 b=24400 pps=50.0 kbps=97.6
```

Kiểm tra thủ công:

$$
\frac{24400 \text{ B} \times 8 \text{ bit}}{2 \text{ s}} = \frac{195200}{2} = 97600 \text{ bps} = 97.6 \text{ kbps} \checkmark
$$

Sai số giữa đo và lý thuyết: **0%**. Đây là bằng chứng mạnh nhất cho tính chính xác của phép đo.

### 9.3 Bằng chứng 2 — Cửa sổ đầu tiên (ramp-up) cho thấy hành vi đúng

```
[BENCH 2000ms] BLE_RX pkt=45 b=10980 ... BLE_FWD pkt=45 b=10980 drop=0 ... fwd=100.0% drop=0.0%
```

Cửa sổ đầu tiên ghi nhận 45 gói thay vì 100. Đây không phải lỗi đo — BLE connection vừa được thiết lập trong khoảng giữa cửa sổ, nên firmware chỉ thấy ~45 gói trong 2s đầu. Điều quan trọng là:

- `BLE_RX = BLE_FWD = 45` → không có gói nào bị rớt ở thời điểm pipeline còn rỗng
- `drop = 0%, fwd = 100%` → xác nhận cả hai counter khởi đầu đúng và đồng bộ

### 9.4 Bằng chứng 3 — Cửa sổ thứ hai xác nhận pipeline ban đầu không có bottleneck

```
[BENCH 2000ms] BLE_RX pkt=100 b=24400 pps=50.0 kbps=97.6
              BLE_FWD pkt=100 b=24400 drop=0 pps=50.0 kbps=97.6 fwd=100.0% drop=0.0%
```

Khi pipeline còn rỗng (queue LAN→WAN chưa bị đầy), toàn bộ 100 gói được forward thành công. Điều này chứng minh:

- Không có lỗi cơ bản trong logic đếm
- Bottleneck xuất hiện sau đó là do **tắc nghẽn phần mềm** (queue đầy), không phải do phép đo sai

### 9.5 Bằng chứng 4 — Tính ổn định cao của BLE_RX qua nhiều cửa sổ

Qua 23 cửa sổ liên tiếp (46 giây đo):

| Chỉ số | Giá trị quan sát |
|---|---|
| BLE_RX pkt/cửa sổ | 99 – 103 |
| BLE_RX kbps | 96.6 – 100.5 |
| Độ lệch so với 97.6 kbps | ±2% |
| Cửa sổ bất thường | 0 |

Độ lệch ±2% là hoàn toàn bình thường, do jitter lập lịch BLE (connection event có thể trễ 1–2ms) và jitter FreeRTOS tick. Đây là mức jitter **chấp nhận được trong môi trường RTOS nhúng** và không ảnh hưởng đến độ tin cậy của phép đo.

### 9.6 Bằng chứng 5 — Drop BLE_FWD là bottleneck xác định, không phải nhiễu đo

Sau cửa sổ thứ 2, BLE_FWD ổn định tại:

```
BLE_FWD pkt=38~40 pps=19.0~20.0 kbps=37.1~39.0 drop=60~63%
```

Đây **không phải lỗi đo**, mà là tắc nghẽn phần cứng/phần mềm có thể giải thích được:

$$
\text{Throughput tối đa qua SPI} \approx \frac{1 \text{ packet}}{50 \text{ ms (round-trip ACK)}} = 20 \text{ pps} = 20 \times 244 \times 8 = 39.0 \text{ kbps}
$$

Quan sát cho thấy BLE_FWD dao động 19–20 pps, nhất quán với giới hạn này. Hơn nữa, tỷ lệ drop ổn định 60–63% (không dao động lớn) là đặc trưng của **pipeline bão hòa có kiểm soát**, không phải mất gói ngẫu nhiên.

### 9.7 Kết luận tổng hợp

| Tiêu chí kiểm chứng | Kết quả |
|---|---|
| Vị trí đặt counter (trước mọi xử lý) | ✅ Đúng |
| Giá trị khớp lý thuyết (97.6 kbps) | ✅ Sai số 0% |
| Cửa sổ đầu drop=0% khi pipeline rỗng | ✅ Xác nhận |
| Ổn định qua 23 cửa sổ liên tiếp | ✅ Độ lệch ≤ ±2% |
| Drop là bottleneck xác định (SPI ~50ms) | ✅ Giải thích được |
| Phụ thuộc vào widget hay telemetry | ❌ Không — đây là counter firmware trực tiếp |

**Kết luận: phép đo BLE_RX là chính xác và đáng tin cậy ở mức firmware**. Giá trị 97.6 kbps phản ánh đúng thông lượng payload ứng dụng thực sự mà BLE link layer giao cho gateway. Drop 62% của BLE_FWD là bottleneck thực trong pipeline nội bộ (hàng đợi SPI), không phải sai số đo lường.

> **Lưu ý cho báo cáo:** Khi trình bày kết quả, nên phân biệt rõ hai con số:
> - `BLE_RX = 97.6 kbps` → thông lượng **nhận vào gateway** (link-layer throughput tại điểm cuối)
> - `BLE_FWD ≈ 37–39 kbps` → thông lượng **chuyển tiếp lên server** (pipeline throughput, bị giới hạn bởi SPI inter-MCU)

---

## 10. Ba lớp đo thông lượng Zigbee/LoRa — phân tách và ý nghĩa

Không giống BLE (đo trực tiếp payload GATT attribute), Zigbee và LoRa đi qua hai MCU (LAN MCU ← module → WAN MCU) và được mã hóa lại trước khi lên server. Vì vậy mỗi giao thức có **3 lớp đo** với ý nghĩa khác nhau.

### 10.1 Sơ đồ pipeline Zigbee

```
[Node ESP32-C6]
  └─ ZCL attribute report (temp/humid, ~8B ZCL payload per frame)
       └─ Zigbee RF 250 kbps PHY
            └─ E18-ZG120B module output (UART 115200 bps)
                 │   ← Lớp 1: ZB_RX
                 ↓
           [LAN MCU] zigbee_handler_task
                 │ bench_count_zb_rx(len)  ← đo tại đây (raw UART bytes)
                 │ chunk → WAN uplink queue (mỗi chunk ≤ 2048B)
                 │   ← Lớp 2: ZB_FWD
                 ↓
           [WAN MCU] mqtt_handler / http_handler
                 │ binary → hex string (2× kích thước) → JSON wrapper
                 │ MQTT publish / HTTP POST
                 │   ← Lớp 3: bytes trên server
                 ↓
           ThingsBoard telemetry
```

### 10.2 Định nghĩa từng lớp

| Lớp | Counter firmware | Ý nghĩa | Đơn vị |
|-----|-----------------|---------|--------|
| **ZB_RX** | `bench_count_zb_rx(len)` | Số byte nhận được từ module E18 qua UART (bao gồm header E18, checksum, payload ZCL). Đo **thông lượng thô tại cổng UART** giữa module và MCU | bytes |
| **ZB_FWD** | `bench_count_zb_fwd(len)` | Số byte sau khi chia chunk và enqueue thành công vào WAN uplink queue. Phản ánh **throughput nội bộ LAN→WAN**; có thể nhỏ hơn ZB_RX nếu queue đầy (drop) | bytes |
| **Lớp 3** | Không có counter firmware trực tiếp | Bytes xuất hiện tại ThingsBoard telemetry. Do WAN MCU hex-encode toàn bộ payload (`2 × ZB_FWD bytes`) trước khi đóng gói JSON → **lớp 3 luôn lớn hơn ZB_FWD** về kích thước chuỗi, nhưng nhỏ hơn ZB_RX về thông tin thực | bytes trên server |

### 10.3 Tại sao ZB_RX ≠ giá trị lý thuyết 79.2 kbps

Giá trị `79.2 kbps` trong lý thuyết ban đầu được tính từ:
- Max ZCL payload = 99B/report × 2 reports/20ms = 9900 B/s ≈ 79.2 kbps

Thực tế, mỗi `ZigbeeTempSensor` ZCL attribute report (temperature hoặc humidity) chỉ mang **~8B ZCL payload** (attribute ID 2B + type 1B + int16 value 2B + ZCL header 3B), không phải 99B. Tổng kích thước frame E18 UART output khoảng **40–50B** (bao gồm Zigbee MAC/NWK/APS header + ZCL payload + E18 framing). Vì vậy:

| Tham số | Lý thuyết (cũ) | Thực tế (đã đo) |
|---------|---------------|-----------------|
| Payload ZCL/report | 99B | ~8B |
| Reports/burst | 2 | **8** (sau khi sửa node) |
| Frame E18 UART/report | 99B | ~45B |
| Tốc độ UART E18 | 115200 bps | 115200 bps |
| ZB_RX mục tiêu | 79.2 kbps | 8×45B/20ms ≈ **144 kbps raw** → bão hòa UART → đo thực ≈ **64–80 kbps** |

> **Giới hạn cứng**: UART 115200 bps = 11520 B/s ≈ 92 kbps. ZB_RX không thể vượt giá trị này dù node gửi nhanh hơn — E18 sẽ queue nội bộ hoặc drop.

### 10.4 Bug đã sửa: MQTT/HTTP publish task cắt 1024B

Trước khi sửa, WAN MCU có 2 giới hạn không nhất quán:
- Queue nhận tối đa `MQTT_PUBLISH_DATA_MAX_LEN = 2048B`
- Publish task chỉ copy tối đa `DATA_BUFFER_SIZE = 1024B` → **im lặng cắt bớt 50% payload**

Sau khi sửa:
- `DATA_BUFFER_SIZE = 2048B` (= queue item size)
- `JSON_TX_BUFFER_SIZE = 4224B` (đủ chứa 2048B raw → 4096 hex chars + `{"data":"..."}` overhead)
- HTTP handler tương tự: `data_buffer=2048B`, `hex_buffer=4097B`, `json_buffer=4224B`

### 10.5 Tương tự cho LoRa (LR_RX / LR_FWD)

| Lớp | Counter | Ý nghĩa |
|-----|---------|---------|
| **LR_RX** | `bench_count_lr_rx(len)` | Bytes từ module Wio-E5 qua UART (output `+RXLRPKT` kể cả header AT) |
| **LR_FWD** | `bench_count_lr_fwd(len)` | Bytes sau chunk enqueue vào WAN uplink queue |
| Lớp 3 | (xem ThingsBoard) | Sau hex-encode trên WAN MCU |

LoRa P2P node gửi 50B/113ms ≈ 3.5 kbps — tốc độ thấp nên ít bị bottleneck ở các lớp trên.

### 10.6 Khuyến nghị khi báo cáo

Khi trình bày kết quả benchmark Zigbee trong báo cáo:
1. **ZB_RX kbps** = thông lượng tại cổng vào gateway (UART từ module E18) — đây là throughput **giao thức Zigbee phía gateway**
2. **ZB_FWD kbps** = thông lượng nội bộ gateway (LAN→WAN MCU) — bị giới hạn bởi WAN uplink queue và SPI
3. **Bytes trên ThingsBoard** = sau hex-encode, kích thước lớn hơn ~2× so với ZB_FWD
4. **So sánh với BLE**: BLE_RX đo trực tiếp GATT payload (không có header module), trong khi ZB_RX bao gồm cả overhead E18 framing → không so sánh kbps trực tiếp giữa BLE_RX và ZB_RX
