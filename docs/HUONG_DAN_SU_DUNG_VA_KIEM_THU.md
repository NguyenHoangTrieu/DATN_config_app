# Kiểm thử và Hướng dẫn Vận hành
---
## Mục lục
1. [Hướng dẫn vận hành – Người dùng cuối](#3-hướng-dẫn-vận-hành--người-dùng-cuối)
2. [Hướng dẫn kỹ thuật – Kỹ sư IoT / System Admin](#4-hướng-dẫn-kỹ-thuật--kỹ-sư-iot--system-admin)
3. [Test case – Người dùng cuối](#5-test-case--người-dùng-cuối)
4. [Test case – Kỹ sư IoT / System Admin](#6-test-case--kỹ-sư-iot--system-admin)
5. [Phân loại và ưu tiên kiểm thử](#7-phân-loại-và-ưu-tiên-kiểm-thử)

---

## 1. Hướng dẫn vận hành – Người dùng cuối

Phần này hướng đến người dùng cuối đã nhận thiết bị từ kỹ sư lắp đặt. Người dùng không cần hiểu giao thức IoT hay cấu trúc firmware; các thao tác được thực hiện hoàn toàn qua trình duyệt web hoặc kết nối USB khi cần.

### 1.1 Kết nối WiFi lần đầu

Khi gateway chưa được lưu thông tin WiFi (hoặc sau khi factory reset), thiết bị tự khởi tạo Access Point với SSID dạng `DA2-Gateway-XXXX`. Người dùng kết nối điện thoại hoặc máy tính vào mạng này, mở trình duyệt và truy cập `192.168.4.1`. Điền SSID và mật khẩu WiFi nhà vào tab WiFi, nhấn **Set WiFi Config** rồi **Reboot**. Gateway khởi động lại và kết nối vào mạng WiFi vừa nhập; địa chỉ IP hiển thị trên màn hình OLED.

Nếu nhập sai mật khẩu, gateway sẽ thử lại nhiều lần rồi tự quay về chế độ AP để người dùng cấu hình lại.

### 1.2 Kiểm tra trạng thái hoạt động

Người dùng truy cập trang cấu hình qua địa chỉ IP trên OLED (ví dụ `http://192.168.1.100`) hoặc `http://gateway.local` nếu mạng hỗ trợ mDNS. Thanh trạng thái đầu trang hiển thị trạng thái kết nối Internet (chấm xanh = Online). Nhấn **Read Config** để tải thông tin chi tiết gồm phiên bản firmware, uptime, tín hiệu WiFi và trạng thái server.

### 1.3 Đổi mật khẩu WiFi hoặc chuyển router

Truy cập trang cấu hình, vào tab WiFi, nhập SSID và mật khẩu mới, nhấn **Set WiFi Config** rồi **Reboot**. Nếu mạng WiFi cũ không còn truy cập được, kết nối máy tính với gateway qua cáp USB, mở Gateway Config Tool, chọn cổng COM và cập nhật WiFi từ đó. Sau khi vượt số lần retry tối đa, gateway cũng tự chuyển về chế độ AP.

### 1.4 Cập nhật firmware

Đảm bảo gateway đang kết nối Internet, truy cập trang cấu hình, bật **Advanced Mode**, chọn tab **FW** rồi nhấn **Start Firmware OTA Update**. Quá trình mất 2–5 phút. Tuyệt đối không tắt nguồn trong thời gian này. Sau khi hoàn thành, thiết bị tự khởi động lại; số phiên bản firmware mới xuất hiện trong Status.

### 1.5 Kịch bản thực tế – Điều khiển đèn thông minh BLE hàng ngày

Người dùng có một đèn LED BLE trong phòng khách, kết nối BLE với gateway DA2. Điều khiển thực hiện qua dashboard ThingsBoard trên điện thoại — người dùng chỉ nhấn bật/tắt, không cần biết gì về BLE hay MQTT.

Khi nhấn nút bật trên dashboard, lệnh đi theo luồng: ThingsBoard → MQTT → gateway → BLE module → đèn vật lý. Phản hồi thường trong 1–3 giây.

**Xử lý khi đèn không phản hồi:** Kiểm tra đèn đang được cắm điện và trong tầm BLE (≤15 mét, ít vách ngăn). Nếu đèn trong tầm mà vẫn không phản hồi, tắt nguồn đèn 10 giây rồi bật lại — module BLE sẽ tự detect lại kết nối sau vài giây. Nếu vẫn lỗi, kiểm tra trang cấu hình gateway xem module BLE có hiện "Active" không; nếu không, liên hệ kỹ sư.

---

## 2. Hướng dẫn kỹ thuật – Kỹ sư IoT / System Admin

### 2.1 Kiến trúc lệnh và giao thức

Mọi lệnh cấu hình và điều khiển đều được đưa vào hàng đợi trung tâm `g_config_handler_queue` trên MCU WAN. Trong vận hành thực tế, nguồn phát lệnh chính là MQTT subscribe (server gửi xuống) hoặc HTTP POST `/api/config` từ Web Portal. PC App chỉ dùng trong giai đoạn lắp đặt và debug. `config_handler.c` phân tích prefix 2 ký tự để định tuyến:

| Prefix | Chức năng |
|---|---|
| `WF` | Cấu hình WiFi |
| `LT` | Cấu hình LTE |
| `MQ` | Cấu hình MQTT |
| `HP` | Cấu hình HTTP |
| `CP` | Cấu hình CoAP |
| `SV` | Chọn loại server |
| `IN` | Chọn loại kết nối Internet |
| `ML` | Forward lệnh sang MCU LAN qua SPI |
| `FW` | Kích hoạt FOTA WAN MCU |

Lệnh `ML` được forward sang MCU LAN qua SPI. Tại đây `config_handler` LAN phân tích tiếp prefix 4 ký tự:

| Prefix | Chức năng |
|---|---|
| `CFBL` | Lệnh BLE |
| `CFLR` | Lệnh LoRa |
| `CFZB` | Lệnh Zigbee |
| `CFRS` | Cấu hình RS485 |
| `CFFW` | FOTA LAN MCU |
| `CFSC` | Đọc toàn bộ cấu hình |

**Cấu trúc phản hồi lệnh `CFSC`:**

```
CFSC_RESP:START
[GATEWAY_INFO]
model=ESP32S3_IoT_Gateway
firmware=v1.2.0
hardware=HW_v2.0
serial=GW2025001
internet_status=ONLINE
rtc_time=2026-03-21 10:30:00

[WAN_CONFIG]
internet_type=WIFI
wifi_ssid=TenMangWifi
wifi_password=***HIDDEN***
wifi_auth_mode=0
lte_apn=internet
server_type=MQTT
mqtt_broker=mqtt://demo.thingsboard.io:1883
mqtt_device_token=***HIDDEN***
stack_wan_id=100

[LAN_CONFIG]
stack1_id=002
stack2_id=010
rs485_baudrate=115200
stack1_json_len=3800
stack2_json_len=2900
CFSC_RESP:END
```

### 2.2 Lắp đặt và cấu hình gateway từ đầu

**Phần cứng:** Lắp module vào hai khe vật lý. MCU LAN tự đọc ID module qua `stack_handler` và lưu vào `g_stack_1_id` / `g_stack_2_id`. ID quy ước: `002` = BLE STM32WB, `010` = LoRa RAK3172, `001` = Zigbee E180, `000` = chưa có module.

**Kết nối PC App:** Cắm cáp USB vào cổng MCU WAN. Tool quét cổng COM bằng cách lọc VID/PID (CH340, CP210x, FTDI, Espressif native USB) rồi probe CFSC — cổng nào trả về `CFSC_RESP:START` là đúng. Sau khi kết nối, nhấn **Read Config** để tải cấu hình hiện tại.

**Cấu hình Internet (WiFi):**
```
WF:TenMangWifi:MatKhau:0              # WiFi Personal (WPA2/WPA3)
WF:TenMangWifi:MatKhau:1:username     # WiFi Enterprise (WPA2-EAP)
IN:WIFI
```

**Cấu hình Internet (LTE):**
```
LT:A7600C1:internet:user:pass:UART:5:30000:true:WK:PE
IN:LTE
```

**Cấu hình server MQTT:**
```
SV:0
MQ:mqtt://demo.thingsboard.io:1883:tokenThietBi:v1/devices/me/rpc/request/+:v1/devices/me/telemetry:v1/devices/me/attributes
```

**Cấu hình server HTTP:**
```
SV:2
HP:http://server:8080/api/v1/token/telemetry:tokenXacThuc:8080:false:false:10000
```

**Gửi JSON config cho module LAN:**

Gateway Config Tool đóng gói và gửi lệnh theo định dạng:
```
ML:CFBL:JSON:0:<nội dung JSON>
```
MCU WAN forward qua SPI sang MCU LAN. MCU LAN parse và lưu vào NVS theo key tương ứng stack ID. Sau đó `module_monitor_task` spawn task handler cho module: thực hiện chuỗi `HW_RESET → GET_INFO → spawn uplink/downlink/listener task`.

### 2.3 Điều khiển module BLE từ server

Trong vận hành, lệnh BLE xuất phát từ server MQTT, đi theo luồng:

```
Server MQTT publish → topic subscribe gateway
  → mqtt_handler (WAN MCU)
  → g_config_handler_queue
  → config_handler forward ML:CFBL:...
  → SPI → MCU LAN
  → ble_downlink_task
  → AT command → module vật lý
  → response ngược lên SPI → WAN MCU → MQTT publish telemetry
```

Payload MQTT từ server gửi xuống (ví dụ ThingsBoard RPC):
```json
{"method": "sendCommand", "params": "CFBL:0:AT+SCAN=5000"}
```

Ví dụ: Quy trình kết nối và điều khiển đèn BLE:
```
# Scan tìm thiết bị
CFBL:0:AT+SCAN=5000
# Kết quả: +SCAN: A4:C1:38:XX:YY:ZZ -65dBm LED BLE

# Kết nối
CFBL:0:AT+CONNECT=A4C138XXYYZZ
# Chờ: +CONNECTED:0

# Discover GATT services → tìm characteristic UUID 2B11
CFBL:0:AT+DISC=0
# Kết quả: +CHAR:0x0001,0x000E,2B11 → handle 0x000E

# Bật đèn
CFBL:0:AT+WRITE=0,0x000E,55AA00010006000501010001010F

# Tắt đèn
CFBL:0:AT+WRITE=0,0x000E,55AA00020006000501010001000E

# Ngắt kết nối sau khi xong
CFBL:0:AT+DISCONNECT=0
```

Mỗi lệnh AT được firmware xử lý qua pipeline: `config_parse_ble_command()` → match function trong JSON config → `command_queue` → `ble_downlink_task` → `ble_handler_execute_command_with_config()` → UART tới module → `ble_read_until_terminator()` → forward response về WAN MCU qua SPI → MQTT publish.

### 2.4 Kịch bản thực tế – Triển khai điều khiển 1 đèn BLE qua ThingsBoard

Kỹ sư nhận yêu cầu: tích hợp 1 đèn LED BLE vào hệ thống, điều khiển bật/tắt từ ThingsBoard dashboard.

**Bước 1 – Chuẩn bị:** Lắp module BLE STM32WB55 vào Stack 1. Gửi JSON config BLE từ PC App (preset STM32WB, slot S1). Xác nhận log LAN MCU: `[BLE_TASK] [Stack 0] BLE uplink task started`.

**Bước 2 – Scan và lấy MAC đèn:** Từ ThingsBoard, gửi RPC xuống gateway:
```json
{"method": "sendCommand", "params": "CFBL:0:AT+SCAN=8000"}
```
Đọc response trả về trên topic telemetry, ghi lại MAC address của đèn LED BLE.

**Bước 3 – Lấy GATT handle:** Gửi tiếp:
```json
{"method": "sendCommand", "params": "CFBL:0:AT+CONNECT=<MAC>"}
{"method": "sendCommand", "params": "CFBL:0:AT+DISC=0"}
```
Từ response `+CHAR:...,2B11`, ghi lại handle (ví dụ `0x000E`). Gửi disconnect sau khi xong.

**Bước 4 – Cập nhật JSON config:** Điền MAC và handle vào JSON config của module, gửi lại lên gateway qua PC App. Từ đây firmware tự biết địa chỉ đèn mà không cần scan lại.

**Bước 5 – Test end-to-end từ ThingsBoard:**
```json
{"method": "sendCommand", "params": "CFBL:0:AT+CONNECT=<MAC>"}
{"method": "sendCommand", "params": "CFBL:0:AT+WRITE=0,0x000E,55AA00010006000501010001010F"}
{"method": "sendCommand", "params": "CFBL:0:AT+DISCONNECT=0"}
```
Xác nhận đèn bật. Gửi lệnh tắt tương tự. Kiểm tra response gateway publish đúng lên topic telemetry.

**Bước 6 – Bàn giao:** Thiết lập widget Switch trên ThingsBoard dashboard, bind vào RPC call bật/tắt tương ứng. Ghi lại hồ sơ: CFSC output, JSON config, MAC và handle đèn.

### 2.5 Cấu hình và kiểm thử module LoRa (OTAA)

```
CFLR:0:AT+BAND=8            # Region AS923
CFLR:0:AT+CLASS=A
CFLR:0:AT+NJM=1             # OTAA mode
CFLR:0:AT+DEVEUI=XXXXXXXXXXXX
CFLR:0:AT+APPEUI=XXXXXXXXXXXX
CFLR:0:AT+APPKEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
CFLR:0:AT+JOIN=1:0:10:8    # auto=false, interval=10s, max_retries=8

CFLR:0:AT+NJS=?             # Trả về 1 nếu đã joined
CFLR:0:AT+SEND=2:0:AABB1122 # port 2, unconfirmed, hex payload
```

Các lệnh trên được gửi từ server qua MQTT (payload RPC tương tự mục 2.3). Với môi trường AS923, khuyến nghị DR3 (SF9BW125). ADR nên bật khi triển khai thực tế.

### 2.6 Triển khai mạng Zigbee

Module EBYTE E180-ZG120B dùng giao thức binary HEX. Lệnh gửi từ server xuống:

```
CFZB:0:MODULE_HW_RESET
CFZB:0:MODULE_ENTER_HEX_MODE
CFZB:0:MODULE_START_NETWORK
CFZB:0:MODULE_SET_PERMIT_JOIN:60    # Mở join 60 giây
```

Khi thiết bị join, Zigbee listener task forward sự kiện lên WAN MCU → MQTT publish. Điều khiển ZCL node sau khi join:
```
CFZB:0:MODULE_ZCL_SEND_CONTROL_CMD:0x1234:0x0006:0x0000:0x01
```

### 2.7 Cấu hình RS485

```
CFRS:9600     # Đặt baudrate RS485 = 9600
CFRS:115200   # Đặt baudrate RS485 = 115200
```

Cấu hình lưu vào NVS, nạp lại tự động khi boot. RS485 handler forward toàn bộ dữ liệu từ bus lên WAN MCU. Đảm bảo thiết bị đầu cuối (Modbus RTU, PLC) cùng baudrate và địa chỉ slave không trùng.

### 2.8 Theo dõi log và debug

**MCU WAN – tag tiêu biểu:**
```
[wifi connect] Got IP: 192.168.1.100
[mqtt_handler] Connected to broker
[MCU_LAN_DL] Config sent to LAN MCU, 256 bytes
[config_handler] Processing WF command
```

**MCU LAN – tag tiêu biểu:**
```
[BLE_TASK] [Stack 0] BLE uplink task started
[BLE_HANDLER] Sending AT+SCAN=5000
[BLE_HANDLER] Response received: +SCAN: A4:C1:38:...
[LORA_TASK] [Stack 1] Join success
[MODULE_MONITOR] Module swap detected on Stack 0
```

**Web API status (`GET /api/status`):**
```json
{
  "firmware_version": "v1.2.0",
  "wan_fw": "1.2.0.0",
  "lan_fw": "1.0.0.0",
  "internet_type": 0,
  "server_type": 0,
  "wifi_connected": true,
  "wifi_rssi": -62,
  "internet_online": true,
  "uptime_s": 3600,
  "rtc": "2026-03-21 10:30:00",
  "free_heap": 156000
}
```

### 2.9 FOTA

**WAN MCU:** Trigger từ Web Portal (tab FW), PC App (tab Firmware) hoặc MQTT (lệnh `FW`). Firmware tải qua HTTPS, xác minh bằng certificate ký sẵn. Hỗ trợ OTA resumption — nếu mất điện giữa chừng, lần tiếp theo tiếp tục từ offset đã ghi trong NVS.

**LAN MCU:** Trigger bằng lệnh `ML:CFFW`. WAN MCU forward sang LAN MCU; LAN MCU chạy `fota_lan_handler_start()`, tải firmware từ URL và ghi vào partition OTA. Cả hai MCU đều có partition `otadata` theo dõi slot đang dùng, đảm bảo tự rollback nếu firmware mới không boot được.

### 2.10 Xử lý thay module vật lý

`module_monitor_task` chạy nền liên tục đọc ID module. Khi phát hiện ID thay đổi, task tự động: dừng handler cũ → xóa JSON config cũ trong NVS (JSON của BLE không dùng được cho LoRa) → cập nhật `g_stack_id` → chờ kỹ sư gửi JSON config mới. Kỹ sư chỉ cần gửi lại JSON config đúng loại cho stack tương ứng.

---

## 3. Test case – Người dùng cuối

> Tất cả test case dưới đây thực hiện qua trình duyệt web hoặc thao tác vật lý, không yêu cầu công cụ kỹ thuật.

---

### TC-EU-001: Kết nối WiFi lần đầu qua Access Point

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao nhất** |
| Điều kiện tiên quyết | Gateway chưa có WiFi được lưu (hoặc vừa factory reset) |

**Các bước thực hiện:**
1. Cắm nguồn gateway, chờ 10–15 giây.
2. Dùng điện thoại quét WiFi, tìm và kết nối vào mạng `DA2-Gateway-XXXX`.
3. Mở trình duyệt, truy cập `192.168.4.1`.
4. Vào tab WiFi, điền SSID = `TestWifi`, Password = `12345678`, nhấn **Set WiFi Config**.
5. Nhấn **Reboot**, chờ 15 giây.
6. Kết nối điện thoại vào mạng `TestWifi`, ping tới IP của gateway (đọc trên OLED hoặc kiểm tra router).

**Kết quả mong đợi:**
- Mạng `DA2-Gateway-XXXX` xuất hiện trong danh sách WiFi.
- Trang cấu hình tải được tại `192.168.4.1`.
- Sau reboot: gateway kết nối `TestWifi`, ping thành công, web hiển thị chấm xanh **Connected**.

**Điều kiện pass:** Toàn bộ các bước hoàn thành không cần thao tác lại lần hai.

---

### TC-EU-002: Xem trạng thái hoạt động từ trang web

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Điều kiện tiên quyết | Gateway đã kết nối WiFi, người dùng trong cùng mạng nội bộ |

**Các bước thực hiện:**
1. Mở trình duyệt, truy cập địa chỉ IP của gateway.
2. Quan sát thanh trạng thái đầu trang.
3. Nhấn **Read Config**, đọc thông tin hiển thị.

**Kết quả mong đợi:** Thanh trạng thái chấm xanh, IP hiển thị đúng; sau **Read Config** các tab hiện đầy đủ thông tin; trang tải trong 3 giây, không có lỗi.

**Điều kiện pass:** Thông tin cấu hình hiển thị đúng và nhất quán với cấu hình đã thiết lập.

---

### TC-EU-003: Đổi mật khẩu WiFi

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Điều kiện tiên quyết | Gateway đang kết nối WiFi `TestWifi` |

**Các bước thực hiện:**
1. Mở trang cấu hình, vào tab WiFi, nhập mật khẩu mới `NewPassword123`.
2. Nhấn **Set WiFi Config** rồi **Reboot**.
3. Đổi mật khẩu `TestWifi` trên router thành `NewPassword123`, chờ gateway tự kết nối lại.

**Điều kiện pass:** Kết nối lại thành công, trang web truy cập được bình thường, không cần can thiệp thêm.

---

### TC-EU-004: Cập nhật firmware qua web (OTA)

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Điều kiện tiên quyết | Gateway có kết nối Internet; URL firmware đã cấu hình trong firmware build |

**Các bước thực hiện:**
1. Mở trang cấu hình, bật **Advanced Mode**, chọn tab **FW**.
2. Nhấn **Start Firmware OTA Update**, chờ hoàn thành (3–10 phút, không tắt nguồn).
3. Sau khi gateway tự reboot, kiểm tra phiên bản firmware trong Status.

**Điều kiện pass:** Firmware mới chạy thành công; toàn bộ cấu hình (WiFi, server) vẫn còn sau khi cập nhật.

---

### TC-EU-005: Khôi phục cấu hình WiFi sau khi mất kết nối

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Điều kiện tiên quyết | Gateway không còn kết nối được WiFi |

**Các bước thực hiện:**
1. Chờ tối đa 2 phút sau khi mất kết nối WiFi.
2. Quét WiFi xác nhận mạng `DA2-Gateway-XXXX` đã xuất hiện lại.
3. Kết nối vào mạng này, truy cập `192.168.4.1`, cập nhật thông tin WiFi mới, nhấn **Reboot**.

**Điều kiện pass:** Gateway tự động tạo AP sau khi vượt số lần retry; giao diện AP mode hoạt động đầy đủ.

---

### TC-EU-006: Điều khiển đèn BLE từ dashboard và xử lý mất phản hồi

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Điều kiện tiên quyết | Hệ thống đèn BLE đã được kỹ sư cấu hình; ThingsBoard dashboard hoạt động |

**Các bước thực hiện:**
1. Mở dashboard ThingsBoard, nhấn nút bật đèn.
2. Quan sát đèn vật lý phản hồi và trạng thái trên dashboard cập nhật.
3. Nhấn tắt, xác nhận đèn tắt.
4. Ngắt nguồn điện đèn, gửi lệnh bật từ dashboard, quan sát kết quả.
5. Cắm lại nguồn đèn, thử lại lệnh bật.

**Kết quả mong đợi:**
- Bước 2–3: Đèn phản hồi trong vòng 3 giây; dashboard cập nhật trạng thái khớp thực tế.
- Bước 4: Lệnh gửi đi nhưng không có phản hồi từ đèn; các đèn khác không bị ảnh hưởng.
- Bước 5: Sau khi cắm lại nguồn, đèn tự kết nối lại BLE và phản hồi lệnh bình thường.

**Điều kiện pass:** Điều khiển đúng; sự cố 1 đèn không kéo theo lỗi hệ thống; tự phục hồi sau khi nguồn đèn khôi phục.

---

## 4. Test case – Kỹ sư IoT / System Admin

> Các test case dưới đây yêu cầu kiến thức kỹ thuật và sử dụng PC App, Serial Monitor. Lệnh điều khiển module trong vận hành được gửi từ server qua MQTT, không phải PC App.

---

### TC-ADM-001: Scan và kết nối tự động cổng COM

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao nhất** |
| Công cụ | Gateway Config Tool |

**Các bước thực hiện:**
1. Cắm cáp USB vào gateway và máy tính, mở Gateway Config Tool.
2. Nhấn **Scan Gateways**, chọn cổng đúng, nhấn **Connect**.
3. Nhấn **Read Config** (gửi lệnh `CFSC`), kiểm tra dữ liệu trả về.

**Kết quả mong đợi:** Tool phát hiện đúng cổng COM qua lọc VID/PID + probe `CFSC`; response `CFSC_RESP:START...END` nhận đầy đủ; tất cả field parse đúng.

**Điều kiện pass:** Phát hiện đúng trong lần scan đầu tiên.

---

### TC-ADM-002: Ghi cấu hình WiFi và xác nhận lưu NVS

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao nhất** |
| Công cụ | PC App, Serial Monitor (WAN MCU, 115200 baud) |

**Các bước thực hiện:**
1. Nhập SSID = `TestNet`, Password = `Test1234`, nhấn **Set WiFi Config**.
2. Xác nhận log: `[config_handler] Processing WF command` và `[nvs] Saving wifi config`.
3. Tắt và bật lại nguồn, xác nhận log boot kết nối đúng SSID `TestNet`.
4. Nhấn **Read Config**, kiểm tra `wifi_ssid` trong CFSC response.

**Điều kiện pass:** Config không thay đổi sau restart; SSID đúng, password trả về `***HIDDEN***`.

---

### TC-ADM-003: Ghi cấu hình MQTT và xác nhận kết nối server

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao nhất** |
| Công cụ | PC App, MQTT Explorer, Serial Monitor |
| Phụ thuộc | TC-ADM-002 pass |

**Các bước thực hiện:**
1. Nhập MQTT broker = `mqtt://demo.thingsboard.io:1883`, device token hợp lệ, nhấn **Set MQTT Config**.
2. Đặt `internet_type = WIFI`, `server_type = MQTT`, reboot gateway.
3. Subscribe topic `v1/devices/me/telemetry` trên MQTT Explorer, chờ message từ gateway.

**Điều kiện pass:** Nhận được ít nhất một message trong 120 giây sau khi gateway online.

---

### TC-ADM-004: Gửi JSON config module BLE và xác nhận handler khởi động

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | PC App, Serial Monitor (LAN MCU) |

**Các bước thực hiện:**
1. Lắp module BLE STM32WB55 vào Stack 1.
2. Trong PC App tab BLE Advanced, chọn slot S1, preset `STM32WB BLE`, nhấn **Send JSON to Gateway**.
3. Theo dõi Serial Monitor LAN MCU.

**Kết quả mong đợi:**
```
[BLE_TASK] [Stack 0] BLE uplink task started
[BLE_HANDLER] Module HW RESET executed
+VER: <version string>
```

**Điều kiện pass:** Task started trong 10 giây; module phản hồi `GET_INFO`.

---

### TC-ADM-005: Điều khiển BLE từ server – scan, kết nối, ghi GATT

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | MQTT Explorer hoặc ThingsBoard RPC, Serial Monitor (LAN MCU) |
| Phụ thuộc | TC-ADM-004 pass; có thiết bị BLE đích (đèn LED BLE) |

**Các bước thực hiện:**

Tất cả lệnh gửi từ server qua MQTT RPC payload `{"method": "sendCommand", "params": "<lệnh>"}`:

1. Gửi `CFBL:0:AT+SCAN=5000`, chờ response chứa MAC của đèn.
2. Gửi `CFBL:0:AT+CONNECT=<MAC>`, chờ `+CONNECTED:0`.
3. Gửi `CFBL:0:AT+DISC=0`, tìm handle của characteristic `2B11`.
4. Gửi `CFBL:0:AT+WRITE=0,0x000E,55AA00010006000501010001010F`, quan sát đèn bật.
5. Gửi lệnh tắt tương ứng, quan sát đèn tắt.
6. Gửi `CFBL:0:AT+DISCONNECT=0`.

**Kết quả mong đợi:**
- Bước 1: Response `+SCAN:` trả về trong 8 giây.
- Bước 2: `+CONNECTED:0` trong 10 giây.
- Bước 4–5: Đèn bật/tắt đúng theo lệnh.
- Toàn bộ response gateway publish về MQTT telemetry topic đúng format.

**Điều kiện pass:** Luồng server → MQTT → gateway → BLE → đèn → response về server hoàn thành không lỗi.

---

### TC-ADM-006: Triển khai end-to-end điều khiển đèn BLE qua ThingsBoard

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao nhất** |
| Công cụ | ThingsBoard dashboard, MQTT Explorer, Serial Monitor (LAN MCU) |
| Phụ thuộc | TC-ADM-005 pass; MAC và GATT handle của đèn đã biết |

**Các bước thực hiện:**
1. Trên ThingsBoard, tạo widget Switch, bind vào RPC call bật/tắt đèn.
2. Nhấn Switch bật → xác nhận đèn vật lý sáng trong 3 giây.
3. Nhấn Switch tắt → xác nhận đèn tắt.
4. Kiểm tra MQTT Explorer: response từ gateway publish đúng topic telemetry sau mỗi lệnh.
5. Tắt nguồn đèn 10 giây rồi bật lại, gửi lại lệnh bật từ dashboard.

**Kết quả mong đợi:**
- Độ trễ từ nhấn Switch đến đèn phản hồi ≤ 3 giây trong điều kiện bình thường.
- Response gateway đầy đủ trên MQTT, không mất message.
- Sau khi đèn bị mất nguồn và khôi phục: gateway tự reconnect BLE và điều khiển lại được.

**Điều kiện pass:** Toàn bộ luồng ThingsBoard → gateway → đèn → response hoạt động ổn định qua ít nhất 10 lần bật/tắt liên tiếp.

---

### TC-ADM-007: Gửi JSON config module LoRa và join LoRaWAN OTAA

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | PC App (cấu hình ban đầu); MQTT (lệnh runtime); Serial Monitor (LAN MCU); LoRaWAN network server |

**Các bước thực hiện:**
1. Lắp module LoRa RAK3172 vào Stack 2. Gửi JSON config từ PC App, preset `RAK3172`.
2. Từ server MQTT, gửi lần lượt các lệnh (payload RPC):
   ```
   CFLR:1:AT+BAND=8
   CFLR:1:AT+NJM=1
   CFLR:1:AT+DEVEUI=<DevEUI>
   CFLR:1:AT+APPEUI=<AppEUI>
   CFLR:1:AT+APPKEY=<AppKey>
   CFLR:1:AT+JOIN=1:0:10:8
   ```
3. Sau tối đa 60 giây, gửi `CFLR:1:AT+NJS=?`.

**Điều kiện pass:** `AT+NJS=1`; LoRaWAN server thấy thiết bị online.

---

### TC-ADM-008: Gửi dữ liệu LoRa uplink lên server

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Phụ thuộc | TC-ADM-007 pass |

**Các bước thực hiện:**
1. Gửi từ server MQTT: `CFLR:1:AT+SEND=2:0:DEADBEEF`.
2. Kiểm tra LoRaWAN server và MQTT topic telemetry.

**Điều kiện pass:** Message nhận được trên server trong 30 giây.

---

### TC-ADM-009: Khởi động Zigbee Coordinator và cho device join

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | PC App (cấu hình JSON); MQTT (lệnh runtime); thiết bị Zigbee 3.0 end device |

**Các bước thực hiện:**
1. Lắp module Zigbee E180 vào Stack 1, gửi JSON config từ PC App.
2. Từ server MQTT, gửi lần lượt:
   ```
   CFZB:0:MODULE_HW_RESET
   CFZB:0:MODULE_ENTER_HEX_MODE
   CFZB:0:MODULE_START_NETWORK
   CFZB:0:MODULE_SET_PERMIT_JOIN:60
   ```
3. Trong 60 giây, bật thiết bị Zigbee end device hoặc nhấn nút pairing.

**Điều kiện pass:** Nhận sự kiện `NODE_JOIN_NOTIFY` kèm địa chỉ ngắn của thiết bị trên MQTT telemetry.

---

### TC-ADM-010: Cấu hình RS485 và nhận dữ liệu Modbus

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Trung bình** |
| Công cụ | PC App, thiết bị RS485 Modbus |

**Các bước thực hiện:**
1. Gửi `CFRS:9600` từ PC App để đặt baudrate.
2. Thiết bị RS485 gửi dữ liệu định kỳ; theo dõi Serial Monitor LAN MCU.

**Điều kiện pass:** Log `[RS485_HANDLER] RX: xx bytes` xuất hiện đều đặn; dữ liệu forward lên WAN MCU qua SPI liên tục không mất gói.

---

### TC-ADM-011: FOTA WAN MCU qua HTTPS

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | Web Portal hoặc MQTT; Serial Monitor (WAN MCU) |
| Điều kiện tiên quyết | Gateway có Internet; URL firmware đã setup; có file firmware mới |

**Các bước thực hiện:**
1. Ghi nhận phiên bản firmware hiện tại từ `GET /api/status`.
2. Trigger FOTA từ Web Portal (tab FW) hoặc gửi lệnh `FW` qua MQTT.
3. Theo dõi Serial Monitor, chờ gateway tự reboot, đọc phiên bản mới.

**Kết quả mong đợi:**
```
[advanced_ota] Starting OTA update from URL...
[advanced_ota] OTA progress: X/Y bytes
[advanced_ota] OTA success, rebooting
```

**Điều kiện pass:** Firmware mới chạy thành công; NVS không mất; nếu firmware lỗi tự rollback về bản cũ.

---

### TC-ADM-012: FOTA LAN MCU

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Phụ thuộc | TC-ADM-011 pass |

**Các bước thực hiện:**
1. Ghi nhận `lan_fw` từ `GET /api/status`.
2. Trigger FOTA từ Web Portal (lệnh `ML:CFFW`) hoặc MQTT.
3. Chờ LAN MCU reboot, kiểm tra lại `lan_fw`.

**Điều kiện pass:** Trường `lan_fw` cập nhật thành công sang phiên bản mới.

---

### TC-ADM-013: Xác nhận bền vững NVS sau mất điện

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | PC App |

**Các bước thực hiện:**
1. Cấu hình đầy đủ: WiFi, MQTT, BLE JSON Stack 1, LoRa JSON Stack 2. Đọc `CFSC`, ghi lại giá trị tham chiếu.
2. Tắt nguồn hoàn toàn 60 giây, bật lại, chờ 30 giây.
3. Đọc `CFSC` lại, so sánh từng field.

**Điều kiện pass:** Không có field nào về default; `stack1_json_len > 0` và `stack2_json_len > 0`.

---

### TC-ADM-014: Hoạt động đồng thời hai module (BLE + LoRa)

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | MQTT Explorer, Serial Monitor (LAN MCU) |

**Các bước thực hiện:**
1. Cấu hình BLE ở Stack 1, LoRa ở Stack 2. Xác nhận cả hai task chạy từ log.
2. Đồng thời gửi từ server: `CFBL:0:AT+SCAN=5000` và `CFLR:1:AT+SEND=2:0:AABB`.
3. Xác nhận cả hai lệnh hoàn thành và dữ liệu từ cả hai module đến được server.

**Điều kiện pass:** Không có task bị treo, timeout bất thường hoặc deadlock; hai module hoạt động độc lập.

---

### TC-ADM-015: Bảo mật – password không lộ qua CFSC

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | PC App |

**Các bước thực hiện:**
1. Cấu hình WiFi password và MQTT device token.
2. Gửi `CFSC`, đọc toàn bộ response, kiểm tra các field nhạy cảm.

**Điều kiện pass:** `wifi_password`, `mqtt_device_token`, `lte_password` đều trả về `***HIDDEN***`; không có giá trị thực nào bị lộ.

---

### TC-ADM-016: Phát hiện thay module vật lý và reset JSON config cũ

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Trung bình** |
| Công cụ | PC App, Serial Monitor (LAN MCU) |

**Các bước thực hiện:**
1. Cấu hình BLE JSON cho Stack 1. Tắt nguồn, tháo module BLE, lắp module LoRa vào Stack 1.
2. Bật nguồn, quan sát log LAN MCU và gửi `CFSC`.

**Kết quả mong đợi:**
```
[MODULE_MONITOR] Module swap detected on Stack 0
[config_handler] Deleted stale JSON config for stack 0
```
`stack1_json_len = 0` trong CFSC response.

**Điều kiện pass:** JSON cũ bị xóa tự động; không có lỗi do sai lệnh trên module mới.

---

### TC-ADM-017: Tự phục hồi kết nối WiFi và MQTT sau khi mất mạng

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Cao** |
| Công cụ | Router (để tắt WiFi tạm thời) |

**Các bước thực hiện:**
1. Gateway đang kết nối WiFi và MQTT.
2. Tắt router 30 giây, bật lại.
3. Quan sát thời gian gateway tự kết nối lại và xác nhận MQTT tiếp tục nhận dữ liệu.

**Điều kiện pass:** Hệ thống tự phục hồi hoàn toàn trong 60 giây sau khi router online lại; không cần restart thủ công.

---

### TC-ADM-018: Đồng bộ thời gian SNTP và RTC

| Thông tin | Nội dung |
|---|---|
| Mức độ ưu tiên | **Trung bình** |
| Công cụ | Serial Monitor, PC App |

**Các bước thực hiện:**
1. Tắt nguồn 5 phút để RTC bị lệch, bật lại và kết nối WiFi.
2. Tìm log `SNTP time synchronized`, gửi `CFSC` đọc `rtc_time`, so sánh với thực tế.

**Điều kiện pass:** SNTP đồng bộ trong 2 phút sau khi có Internet; `rtc_time` khớp thực tế trong ±30 giây.

---

## 5. Phân loại và ưu tiên kiểm thử

### 7.1 Nhóm kiểm thử

**Nhóm 1 – Smoke Test** (bắt buộc chạy trước mọi thứ):

| Test case | Nội dung |
|---|---|
| TC-EU-001 | Kết nối WiFi lần đầu |
| TC-ADM-001 | Kết nối PC App qua cổng COM |
| TC-ADM-002 | Ghi WiFi config và xác nhận NVS |

**Nhóm 2 – Chức năng cốt lõi:**

| Test case | Nội dung |
|---|---|
| TC-EU-002 | Xem trạng thái từ web |
| TC-EU-003 | Đổi mật khẩu WiFi |
| TC-EU-004 | OTA firmware qua web |
| TC-ADM-003 | Kết nối MQTT |
| TC-ADM-013 | Bền vững NVS sau mất điện |
| TC-ADM-015 | Bảo mật password trong CFSC |

**Nhóm 3 – Module radio và sản phẩm IoT:**

| Test case | Nội dung |
|---|---|
| TC-ADM-004 | BLE: JSON config → handler start |
| TC-ADM-005 | BLE: scan → connect → write từ server |
| TC-ADM-006 | BLE: end-to-end ThingsBoard → đèn vật lý |
| TC-EU-006 | End user: điều khiển đèn + xử lý mất phản hồi |
| TC-ADM-007, 008 | LoRa: OTAA join → uplink |
| TC-ADM-009 | Zigbee: coordinator → device join |
| TC-ADM-010 | RS485: cấu hình baudrate → nhận Modbus |

**Nhóm 4 – Tích hợp và nâng cao:**

| Test case | Nội dung |
|---|---|
| TC-ADM-011, 012 | FOTA WAN MCU và LAN MCU |
| TC-ADM-014 | Đồng thời hai module |
| TC-ADM-016 | Phát hiện thay module |
| TC-ADM-017 | Tự phục hồi kết nối WiFi/MQTT |
| TC-ADM-018 | Đồng bộ SNTP/RTC |
| TC-EU-005 | Khôi phục AP mode sau mất WiFi |

### 7.2 Điều kiện dừng kiểm thử

Dừng ngay và báo cáo nếu xảy ra một trong các tình huống:
- Gateway không boot hoặc crash loop.
- NVS bị hỏng — dữ liệu cấu hình không ghi/đọc được.
- SPI giao tiếp WAN–LAN bị đứt hoàn toàn.
- FOTA khiến thiết bị brick, cơ chế rollback không hoạt động.

### 7.3 Môi trường kiểm thử tối thiểu

| Thiết bị / Phần mềm | Ghi chú |
|---|---|
| 1 bộ gateway DA2 hoàn chỉnh | WAN MCU + LAN MCU + nguồn |
| Module BLE STM32WB55 | Stack 1 |
| Module LoRa RAK3172 | Stack 2; cần LoRaWAN coverage hoặc single-channel GW |
| Module Zigbee EBYTE E180 + 1 end device | Test TC-ADM-009 |
| Thiết bị RS485 Modbus | Hoặc USB-RS485 dongle + phần mềm giả lập |
| 1 đèn LED BLE | Test TC-ADM-005, TC-ADM-006, TC-EU-006 |
| Router WiFi có thể bật/tắt chủ động | Test TC-ADM-017 |
| Máy tính, Python ≥ 3.10, Gateway Config Tool | Linux khuyến nghị |
| MQTT Explorer hoặc `mosquitto_sub` | Monitor MQTT |
| Tài khoản ThingsBoard (demo hoặc self-hosted) | Dashboard + RPC |
| Serial Monitor hỗ trợ lọc tag | VS Code Serial Monitor, CoolTerm, PuTTY |

---