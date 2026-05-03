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
