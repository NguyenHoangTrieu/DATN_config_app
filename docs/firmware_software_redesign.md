# Thiết kế Firmware và Software — Bản chỉnh sửa

> **Mục tiêu:** Trình bày lại phần 4.x Firmware và Software theo yêu cầu của giảng viên: tập trung vào kiến trúc, sơ đồ, và bảng mô tả; không đưa mã nguồn trực tiếp vào báo cáo.

---

## 4.x Thiết kế Firmware và Software

### 4.x.1 Tổng quan kiến trúc phần mềm

Phần mềm của hệ thống được xây dựng trên nền tảng **FreeRTOS** với cấu trúc phân lớp chuẩn hóa gồm bốn tầng: **Application**, **Middleware**, **BSP** (Board Support Package), và **Driver**. Kiến trúc này tách hệ thống thành hai miền xử lý độc lập theo mô hình **Dual-MCU Master–Slave**, trong đó **WAN-MCU** chịu trách nhiệm kết nối Internet và quản lý Cloud, còn **LAN-MCU** đảm nhiệm các giao thức mạng nội bộ và thu thập dữ liệu từ sensor.

> **Tham chiếu hình:** Hình X.1 — Kiến trúc phân lớp firmware tổng thể (xem file HTML đính kèm)  
> **Tham chiếu hình:** Hình X.2 — Sơ đồ khối firmware WAN-MCU  
> **Tham chiếu hình:** Hình X.3 — Sơ đồ khối firmware LAN-MCU

---

### 4.x.2 Kiến trúc phân lớp (Layered Architecture)

Bảng sau mô tả cấu trúc phân lớp firmware cho **WAN-MCU** (DA2\_esp):

| Tầng | Module | Chức năng chính |
|------|--------|-----------------|
| **Application** | Config Handler | Phân tích lệnh cấu hình (WF/MQ/LT/IN/SV…), định tuyến đến WAN hoặc LAN |
| **Application** | Server Communication Handler | Giao tiếp Cloud qua MQTT, HTTP, CoAP; Uplink telemetry và Downlink RPC |
| **Application** | MCU LAN Handler | Quản lý kênh SPI Slave; giao tiếp nội bộ với LAN-MCU |
| **Application** | Internet Communication Handler | Quản lý đa kênh Internet (Wi-Fi, LTE, Ethernet); Auto-reconnect, Fallback |
| **Application** | Internet Monitor Handler | Giám sát trạng thái kết nối theo thời gian thực |
| **Application** | Data Communication Handler | Giao tiếp cấu hình qua USB/UART với PC App |
| **Application** | Web Config Handler | Cổng Web Config Portal (AP/STA mode) |
| **Application** | FOTA Handler | Điều phối cập nhật firmware cho cả WAN-MCU và LAN-MCU |
| **Application** | HMI Task | Giao diện hiển thị trên màn hình TFT |
| **Middleware** | FreeRTOS | Lập lịch task, quản lý queue, semaphore, mutex |
| **Middleware** | ESP-IDF WiFi/LTE/ETH | Stack giao thức Internet |
| **Middleware** | MQTT/HTTP/CoAP Stack | Giao thức giao tiếp Server |
| **Middleware** | NVS (Non-Volatile Storage) | Lưu trữ cấu hình bền vững |
| **BSP** | SPI Driver (QSPI) | Giao tiếp SPI với LAN-MCU |
| **BSP** | UART/USB Driver | Giao tiếp với PC App |
| **Driver** | ESP32-S3 Hardware | GPIO, UART, SPI, I2C, USB, ADC |

Bảng sau mô tả cấu trúc phân lớp firmware cho **LAN-MCU** (DA2\_esp\_LAN):

| Tầng | Module | Chức năng chính |
|------|--------|-----------------|
| **Application** | MCU WAN Handler | Quản lý kênh SPI Master; giao tiếp nội bộ với WAN-MCU |
| **Application** | Config Handler | Phân tích cấu hình module (BLE/ZIG/LOR/RS4); nạp JSON preset |
| **Application** | Zigbee Handler | Thu thập dữ liệu qua giao thức Zigbee (E180-ZG120B) |
| **Application** | LoRa Handler | Thu thập/gửi dữ liệu qua LoRa P2P (Wio-E5) |
| **Application** | BLE Handler | Quản lý giao thức BLE (GATT Central + Native Mesh) |
| **Application** | RS-485 Handler | Giao tiếp Modbus/RS-485 với thiết bị công nghiệp |
| **Application** | FOTA LAN Handler | Tự cập nhật firmware qua Wi-Fi AP nội bộ do WAN-MCU phát |
| **Application** | Module Monitor Task | Giám sát trạng thái health của từng module kết nối |
| **Application** | Benchmark | Đo thông lượng và độ trễ giao thức trong kiểm thử |
| **Middleware** | Module Config Controller | Dispatcher lệnh JSON đến handler giao thức tương ứng |
| **Middleware** | JSON Config Parser | Phân tích file JSON preset và ánh xạ template lệnh AT |
| **Middleware** | Storage Handler | Đọc/ghi dữ liệu đệm trên SD Card (store-and-forward) |
| **Middleware** | FreeRTOS | Lập lịch task, quản lý queue |
| **BSP** | SPI Master Driver | Giao tiếp SPI Master với WAN-MCU |
| **BSP** | Module UART/I2C/SPI/USB | Giao tiếp với module RF (LoRa, Zigbee, BLE) |
| **BSP** | SD Card (SDIO 4-bit) | Lưu trữ cục bộ |
| **Driver** | ESP32-S3 Hardware | GPIO, UART, SPI, I2C, USB, SDIO |

---

### 4.x.3 Kiến trúc Task và Luồng ưu tiên

Hệ thống sử dụng FreeRTOS với mô hình đa task có mức ưu tiên khác nhau. Bảng sau tổng hợp các task chính và vai trò:

#### WAN-MCU — Danh sách Task

| Task | Ưu tiên | Vai trò | Kích hoạt |
|------|---------|---------|-----------|
| MCU LAN Uplink Task | 6 (Cao nhất) | Nhận dữ liệu từ LAN qua SPI Slave, đẩy vào queue | SPI interrupt |
| MCU LAN Downlink Task | 5 | Gửi lệnh/config từ WAN xuống LAN qua SPI | GPIO handshake assert |
| MQTT Handler Task | 4 | Publish telemetry; Subscribe lệnh từ ThingsBoard | Sự kiện MQTT |
| HTTP/CoAP Handler Task | 4 | Xử lý REST API, CoAP Observe | Request từ client |
| Config Handler Task | 3 | Xử lý lệnh cấu hình từ UART/USB/Web/MQTT | Queue cấu hình |
| Internet Monitor Task | 3 | Kiểm tra kết nối, kích hoạt Fallback | Định kỳ 5s |
| Web Config Handler Task | 3 | Phục vụ HTTP trên AP/STA Web Portal | HTTP request |
| FOTA Handler Task | 2 | Điều phối FOTA; kích hoạt AP mode | Lệnh từ Server |
| HMI Task | 2 | Cập nhật màn hình TFT | Sự kiện hệ thống |
| Data Communication Task | 2 | Xử lý lệnh từ PC App qua USB/UART | UART interrupt |

#### LAN-MCU — Danh sách Task

| Task | Ưu tiên | Vai trò | Kích hoạt |
|------|---------|---------|-----------|
| MCU WAN Uplink Task | 6 (Cao nhất) | Đóng gói dữ liệu batch, gửi lên WAN qua SPI Master | Định kỳ 10ms |
| MCU WAN Downlink Task | 5 | Nhận lệnh từ WAN; phân phối đến handler giao thức | GPIO interrupt từ WAN |
| Zigbee Handler Task | 4 | Thu thập và xác thực dữ liệu từ module Zigbee | UART interrupt |
| LoRa Handler Task | 4 | Thu thập dữ liệu từ module LoRa (P2P mode) | UART interrupt |
| BLE Handler Task | 4 | Quản lý kết nối BLE GATT/Native | BLE event |
| RS-485 Handler Task | 4 | Giao tiếp Modbus RTU với cảm biến dây | UART interrupt |
| Config Handler Task | 3 | Xử lý cấu hình module; nạp JSON preset | Queue lệnh |
| Module Monitor Task | 2 | Kiểm tra health module; báo cáo lên WAN | Định kỳ 30s |
| FOTA LAN Task | 2 | Tự update firmware qua Wi-Fi AP nội bộ | Lệnh từ WAN |

---

### 4.x.4 Firmware WAN-MCU — Chi tiết các Handler

#### Cơ chế Internet Fallback

WAN-MCU quản lý ba kênh Internet theo thứ tự ưu tiên cố định. Khi kênh ưu tiên cao gặp sự cố, hệ thống tự động chuyển sang kênh thay thế:

| Thứ tự ưu tiên | Kênh | Điều kiện kích hoạt | Điều kiện dự phòng |
|----------------|------|---------------------|-------------------|
| 1 (Cao nhất) | Ethernet (W5500) | Phát hiện link-up trên SPI | Khi Ethernet mất link |
| 2 | Wi-Fi (ESP32-S3 built-in) | Sau 3 lần thử kết nối Ethernet thất bại | Khi Wi-Fi mất kết nối |
| 3 (Thấp nhất) | LTE (SIM7600/A7600) | Khi cả Ethernet lẫn Wi-Fi không khả dụng | Luôn dự phòng cuối |

#### Server Communication Handler — Đa giao thức

| Tham số | MQTT | HTTP | CoAP |
|---------|------|------|------|
| **Giao thức truyền tải** | TCP với TLS | HTTPS | UDP với DTLS |
| **Kiểu kết nối** | Persistent connection | Request-Response | Request-Response / Observe |
| **Uplink (Telemetry)** | PUBLISH | POST | PUT |
| **Downlink (Command)** | SUBSCRIBE (topic) | Long polling | OBSERVE |
| **Bảo mật** | TLS + Auth Token | TLS + Bearer Token | DTLS + PSK |
| **Phù hợp với** | ThingsBoard, EMQX | Mọi REST API | Thiết bị năng lượng thấp |

#### Cơ chế cấu hình (Config Handler)

Mọi tham số vận hành được lưu trong NVS (Non-Volatile Storage) của ESP32 và có thể cập nhật runtime mà không cần biên dịch lại:

| Mã lệnh | Nhóm cấu hình | Phạm vi áp dụng | Ví dụ tham số |
|---------|---------------|-----------------|---------------|
| `WF` | Wi-Fi | WAN-MCU | SSID, Password, Auth mode (WPA2/Enterprise) |
| `MQ` | MQTT | WAN-MCU | Broker URL, Port, Auth token, TLS |
| `LT` | LTE | WAN-MCU | APN, Username, Modem type, GPIO pins |
| `IN` | Internet | WAN-MCU | Loại kênh ưu tiên (WiFi/LTE/Ethernet) |
| `SV` | Server | WAN-MCU | Server type (MQTT/HTTP/CoAP), Timeout |
| `HP` | HTTP Server | WAN-MCU | Endpoint URL, Method, Headers |
| `CP` | CoAP Server | WAN-MCU | URI, Port, DTLS key |
| `FW` | FOTA | WAN-MCU + LAN-MCU | Firmware URL (trigger cập nhật ngay) |
| `FU` | FOTA URL | WAN-MCU | Lưu URL vào NVS (chưa trigger) |
| `ML` | MCU LAN | LAN-MCU (forward qua SPI) | Cấu hình module RF, JSON preset |

---

### 4.x.5 Firmware LAN-MCU — Chi tiết các Handler

#### So sánh giao thức thu thập dữ liệu

| Giao thức | Module sử dụng | Tốc độ vật lý | Thông lượng ứng dụng thực tế | Nút thắt chính |
|-----------|---------------|---------------|------------------------------|----------------|
| Zigbee (IEEE 802.15.4) | E180-ZG120B | 250 kbps | ~8,2 kbps | UART 115200 bps + CSMA/CA |
| LoRa P2P (SF7/BW125) | Wio-E5 (STM32WLE5) | 5,47 kbps | ~3,5 kbps | Time-on-Air (~97,5 ms/gói) |
| BLE (không DLE) | ESP32-S3 native | 1000 kbps | ~8 kbps | MTU=20 byte, CI=20 ms |
| BLE (bật DLE, MTU=247) | ESP32-S3 native | 1000 kbps | ~97,6 kbps | Connection Interval=20 ms |
| RS-485 (Modbus RTU) | External transceiver | Cấu hình (9600–115200 bps) | Phụ thuộc payload | Polling half-duplex |

#### Module Monitor Task

Task này chạy nền với chu kỳ 30 giây, thực hiện kiểm tra health cho từng module gắn vào các khe adapter:

| Loại kiểm tra | Nội dung | Phản hồi khi lỗi |
|---------------|----------|------------------|
| Ping lệnh AT | Gửi `AT` và chờ phản hồi `OK` | Tăng lỗi; reset module sau N lần liên tiếp |
| Kiểm tra SLOTDET | Đọc GPIO SLOTDET để xác nhận module còn cắm | Cập nhật trạng thái slot = "disconnected" |
| Kiểm tra Device ID | Đọc 4-bit DEV\_ID qua IO Expander | Cảnh báo nếu ID không khớp preset đang chạy |
| Báo cáo uplink | Đẩy trạng thái health lên WAN-MCU | WAN-MCU forward lên Server |

---

### 4.x.6 Giao tiếp nội bộ LAN-MCU ↔ WAN-MCU

#### Cấu trúc khung tin SPI (Inter-MCU Frame Format)

Mọi trao đổi dữ liệu giữa hai MCU đều được đóng gói theo khung tin nội bộ có cấu trúc cố định:

| Trường | Kích thước | Giá trị ví dụ | Mô tả |
|--------|------------|---------------|-------|
| Header | 2 bytes | `DT` (0x4454) | Loại khung (DT/CF/DQ/CQ/RT) |
| Frame Type | 1 byte | `0x05` | Phân loại chi tiết |
| Handler ID | 3 bytes | `ZIG` / `LOR` / `BLE` | Định danh giao thức nguồn/đích |
| Sequence Number | 2 bytes | 0–65535 | Phát hiện mất gói, loại bỏ trùng lặp |
| Payload Length | 2 bytes | 0–2048 | Độ dài payload |
| Payload | N bytes | JSON / Raw data | Dữ liệu tải |
| CRC | 2 bytes | CRC-16 | Kiểm tra toàn vẹn |

#### Phân loại khung tin và vai trò

| Mã Header | Tên | Hướng | Mô tả |
|-----------|-----|-------|-------|
| `DT` | Data Frame | LAN → WAN | Dữ liệu cảm biến đã chuẩn hóa |
| `CF` | Command Frame | WAN → LAN | Lệnh điều khiển từ Server |
| `DQ` | Data Query | WAN → LAN | Yêu cầu truy vấn dữ liệu từ LAN |
| `CQ` | Config Query | WAN → LAN | Yêu cầu đọc cấu hình hiện tại của LAN |
| `RT` | RTC Response | WAN → LAN | Đồng bộ thời gian từ WAN sang LAN |
| `ACK` | Acknowledgment | Hai chiều | Xác nhận nhận thành công / lỗi |

#### Cơ chế Handshake GPIO (Interrupt-driven Downlink)

Thay vì LAN-MCU phải liên tục poll, hệ thống dùng cơ chế ngắt phần cứng để thông báo downlink:

| Bước | Mô tả | Tác nhân |
|------|-------|---------|
| 1 | WAN-MCU nhận lệnh từ Server (MQTT Subscribe / HTTP RPC) | WAN-MCU |
| 2 | WAN-MCU đóng gói lệnh vào downlink queue nội bộ | WAN-MCU |
| 3 | WAN-MCU kích hoạt (Assert) chân GPIO Handshake | WAN-MCU → GPIO |
| 4 | LAN-MCU phát hiện cạnh Rising/Falling trên chân Handshake | ISR LAN-MCU |
| 5 | LAN-MCU khởi tạo phiên SPI để đọc gói lệnh từ WAN | LAN-MCU (SPI Master) |
| 6 | LAN-MCU kiểm tra CRC và Sequence Number | LAN-MCU |
| 7 | LAN-MCU gửi ACK (OK/FAIL) ngược lại WAN qua SPI | LAN-MCU → WAN |
| 8 | LAN-MCU dispatch lệnh đến handler giao thức tương ứng | LAN-MCU |
| 9 | Handler thực thi lệnh, phản hồi trạng thái ngược lên WAN | LAN-MCU → WAN → Server |

---

### 4.x.7 Hệ thống cấu hình Module dựa trên JSON (Module Base Setting)

#### Vấn đề đặt ra

Mỗi nhà sản xuất module RF sử dụng cú pháp lệnh AT khác nhau dù chức năng tương tự. Bảng sau minh họa sự không đồng nhất giữa các module BLE:

| Chức năng | HC-05 | ESP32 (AT) | nRF52 (Uble) | STM32WB55 |
|-----------|-------|------------|--------------|-----------|
| Đặt tên thiết bị | `AT+NAME=` | `AT+BLENAME=` | `AT+UBTLN=` | `AT+LOCALNAME=` |
| Quét thiết bị | `AT+INQ` | `AT+BLESCAN=1` | `AT+UBTSCAN` | `AT+BLESCAN` |
| Kết nối | `AT+LINK=` | `AT+BLECONN=` | `AT+UBTACLC=` | `AT+CONNECT=` |
| Reset phần mềm | `AT+RESET` | `AT+RST` | `AT+CPWROFF` | `AT+RESET` |
| Reset phần cứng | Không có | GPIO toggle | GPIO toggle | GPIO toggle |

#### Giải pháp — Cấu hình hóa thông qua JSON

Hệ thống Module Base Setting đưa toàn bộ thông tin đặc thù của module ra ngoài firmware dưới dạng file JSON. Firmware chỉ cần biết **tên chức năng chuẩn hóa**, không cần biết cú pháp lệnh cụ thể:

| Thành phần JSON | Nội dung | Ví dụ |
|-----------------|----------|-------|
| `comm_type` | Loại giao tiếp vật lý | `"UART"`, `"SPI"`, `"I2C"` |
| `baud_rate` | Tốc độ UART | `115200` |
| `functions[]` | Danh sách chức năng | — |
| `functions[i].name` | Tên chức năng chuẩn hóa | `"MODULE_SCAN"` |
| `functions[i].cmd_template` | Chuỗi AT với placeholder | `"AT+BLESCAN={duration}"` |
| `functions[i].pre_gpio` | Chuỗi GPIO trước khi gửi | `"RST_HIGH,DELAY_100ms"` |
| `functions[i].post_gpio` | Chuỗi GPIO sau khi gửi | `""` |
| `functions[i].timeout_ms` | Timeout chờ phản hồi | `3000` |

#### File preset đã chuẩn bị cho kiểm thử

| Preset | Module | Giao thức | Giao tiếp |
|--------|--------|-----------|-----------|
| `zigbee_e180_zg120b.json` | E180-ZG120B | Zigbee | UART 115200 |
| `ble_stm32wb55.json` | NUCLEO-WB55 | BLE GATT | UART 115200 |
| `lora_wio_e5.json` | Seeed Wio-E5 | LoRa P2P (TEST mode) | UART 9600 |
| `stack_id_map.json` | — | — | Ánh xạ slot → preset module |

#### Luồng hoạt động Module Base Setting

| Giai đoạn | Bước | Mô tả |
|-----------|------|-------|
| **Nạp cấu hình** | 1 | PC App / Server gửi file JSON preset qua chuỗi lệnh `ML` |
| | 2 | WAN-MCU nhận, đóng gói vào CF frame, forward xuống LAN-MCU |
| | 3 | LAN-MCU JSON Parser phân tích, lưu vào bộ nhớ runtime |
| | 4 | Module Config Controller cập nhật bảng ánh xạ slot → handler |
| **Thực thi lệnh** | 5 | Server gửi lệnh (ví dụ: `ZIG:MODULE_SCAN`) qua MQTT RPC |
| | 6 | WAN-MCU nhận, đóng gói CF frame với Handler ID = `ZIG` |
| | 7 | LAN-MCU nhận qua GPIO handshake, tra cứu `MODULE_SCAN` trong JSON |
| | 8 | Nếu lệnh tĩnh: trích xuất chuỗi AT trực tiếp |
| | 9 | Nếu lệnh động: ghép tham số từ Server vào template |
| | 10 | Kích hoạt chuỗi GPIO nếu `pre_gpio` được định nghĩa |
| | 11 | Gửi lệnh AT hoàn chỉnh xuống module vật lý |
| | 12 | Đọc phản hồi, gửi status (OK/FAIL + data) ngược lên Server |

---

### 4.x.8 Cơ chế FOTA cho hệ thống Dual-MCU

Quá trình cập nhật firmware từ xa được thiết kế theo thứ tự nghiêm ngặt: **LAN-MCU cập nhật trước, WAN-MCU cập nhật sau**. Điều này đảm bảo WAN-MCU luôn có thể điều phối và xử lý lỗi trong suốt quá trình.

| Bước | Thành phần | Hành động | Kênh giao tiếp |
|------|-----------|-----------|----------------|
| 1 | Server | Gửi lệnh FOTA kèm URL firmware LAN và WAN | MQTT / HTTP |
| 2 | WAN-MCU | Phân tích lệnh; đánh dấu hệ thống vào FOTA mode | — |
| 3 | WAN-MCU | Forward URL firmware LAN xuống LAN-MCU qua SPI CF frame | SPI |
| 4 | WAN-MCU | Kích hoạt Wi-Fi AP mode để LAN-MCU dùng Internet | Wi-Fi AP |
| 5 | LAN-MCU | Kết nối vào Wi-Fi AP của WAN-MCU | Wi-Fi STA |
| 6 | LAN-MCU | Tải firmware qua HTTPS, kiểm tra hash, ghi flash | HTTPS qua Wi-Fi |
| 7 | LAN-MCU | Khởi động lại; sau khi boot OK, gửi handshake "LAN FOTA DONE" | SPI |
| 8 | WAN-MCU | Nhận tín hiệu; ngay lập tức bắt đầu tự cập nhật firmware | — |
| 9 | WAN-MCU | Tải firmware WAN qua HTTPS, kiểm tra hash, ghi flash | HTTPS |
| 10 | WAN-MCU | Khởi động lại; gửi bản tin FOTA status (OK/FAIL + version) | MQTT / HTTP |

---

## Ghi chú cho bản LaTeX

- Thêm hình `design_mculanfirmware.jpg` và `design_mcuwanfirmware.jpg` đã có sẵn trong thư mục `figures/DATN/`.
- Bổ sung bảng kiến trúc phân lớp (Bảng 4.x.2a/b) thay cho đoạn văn mô tả hiện tại.
- Bảng so sánh giao thức (4.x.5) có thể thay thế hoặc bổ sung phần tính toán thông lượng đang bị comment.
- Bảng lệnh Config Handler (4.x.4) giúp người đọc nắm rõ hệ thống cấu hình mà không cần đọc code.
- Cơ chế FOTA (4.x.8) có thể bổ sung dạng bảng bên cạnh hình `design_FOTA.png` đã có.
- Bảng Module Base Setting (4.x.7) phù hợp để đặt sau hình `design_mbs.png`.
