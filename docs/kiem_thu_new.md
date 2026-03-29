# 5.2.4. Kiểm Tra Firmware và Software

Sau khi hoàn tất kiểm tra phần cứng, hệ thống được đưa vào giai đoạn Firmware & Software Verification nhằm xác nhận bo mạch có thể vận hành ổn định với firmware thực tế, đồng thời kiểm chứng các luồng chức năng cốt lõi của kiến trúc Dual MCU (WAN MCU + LAN MCU giao tiếp qua SPI). Giai đoạn này bổ sung các nhóm kiểm thử mới so với phiên bản trước, bao gồm: hệ thống cấu hình module dựa trên JSON (Module Base Setting), cổng cấu hình Web nhúng (Web Config Portal), BLE Mesh Native Provisioner, và các loại server mới (HTTP, CoAP) cũng như loại kết nối Internet mới (Ethernet).

## 5.2.4.1. Mục Tiêu

- Xác nhận khả năng nạp và khởi chạy firmware cho cả hai MCU, đảm bảo vào đúng boot mode và ổn định dưới FreeRTOS.

- Kiểm chứng các giao tiếp bắt buộc: SPI nội bộ WAN–LAN, UART nạp firmware gián tiếp, và các tín hiệu handshake GPIO.

- Kiểm chứng đầy đủ các loại kết nối Internet được hỗ trợ: Wi-Fi (Personal/Enterprise), LTE, PPP và Ethernet.

- Kiểm chứng đầy đủ các loại server được hỗ trợ: MQTT, HTTP và CoAP.

- Kiểm chứng cổng cấu hình Web nhúng: chế độ AP captive portal và chế độ STA, toàn bộ REST API endpoint.

- Kiểm chứng hệ thống Module Base Setting: nạp JSON config, prefix command matching, GPIO-only command, auto-restore sau reboot.

- Kiểm chứng BLE Mesh Native Provisioner: scan thiết bị chưa provision, provisioning flow, điều khiển node.

- Định lượng nhanh các tiêu chí "đủ dùng" cho version hiện tại: chạy lâu không treo, truyền dữ liệu đúng/đủ, phục hồi khi mất mạng.

## 5.2.4.2. Quy Trình Nạp Và Khởi Động Firmware

Nạp WAN MCU qua cổng USB-C (USB Serial/JTAG) bằng công cụ nạp chuẩn (ESP-IDF / esptool). Sau khi nạp, kiểm tra log UART/USB và trạng thái task khởi tạo.

Nạp LAN MCU gián tiếp từ WAN MCU qua kênh UART kết hợp GPIO control (Reset/Boot) để đưa LAN MCU vào Download Mode và flash. LAN MCU tự reboot sau khi nạp thành công.

Khởi động đồng thời hệ thống và kiểm tra:
- FreeRTOS scheduler chạy ổn định (không reset bất thường).
- Watchdog (nếu bật) không kích hoạt sai.
- Các task chính lên đủ và không bị deadlock.
- Module Monitor Task tự đọc stack ID và nạp lại config từ NVS nếu có.

## 5.2.4.3. Nội Dung Kiểm Thử Firmware (Theo Nhóm Chức Năng)

**A. Kiểm thử nền tảng (Boot/RTOS/Log)**

Kiểm tra boot ổn định, log xuất đều, không reset ngẫu nhiên. Kiểm tra hoạt động song song của các task chính (LAN thu thập/xử lý; WAN Internet/server; liên MCU). Xác nhận Module Monitor Task tự khởi động handler đúng dựa trên stack ID phát hiện được.

**B. Kiểm thử giao tiếp liên MCU (Dual MCU Integration)**

SPI data path: Truyền gói dữ liệu uplink từ LAN → WAN. WAN phản hồi ACK/NACK theo kiểm tra CRC/sequence. GPIO handshake downlink: WAN toggle GPIO để LAN thực hiện phiên SPI nhận dữ liệu. Tiêu chí: dữ liệu không sai lệch (integrity), retry hoạt động khi lỗi CRC, không nghẽn SPI khi mạng dao động.

**C. Kiểm thử Internet Communication (WAN MCU)**

Wi-Fi: hỗ trợ Personal và Enterprise; sau khi vào mạng thực hiện SNTP đồng bộ thời gian và cập nhật RTC. LTE: kết nối modem LTE qua USB/UART, theo dõi link và tự reconnect. PPP Server: bật PPP qua UART để tạo IP link hỗ trợ LAN MCU thực hiện OTA. **Ethernet**: kết nối qua W5500 SPI Ethernet, lấy IP qua DHCP và hoạt động song song với WiFi fallback.

**D. Kiểm thử Cloud/Server (WAN MCU)**

MQTT: duy trì kết nối, tự reconnect, uplink telemetry và downlink command. **HTTP**: gửi HTTP POST telemetry, nhận HTTP GET command từ server polling. **CoAP**: truyền telemetry qua CoAP, nhận lệnh downlink qua CoAP observe.

**E. Kiểm thử Web Config Portal (WAN MCU)**

Captive DNS portal ở chế độ AP: redirect tự động đến trang cấu hình. Cấu hình WiFi và kết nối lại ở chế độ STA. Toàn bộ REST API endpoint: đọc/ghi cấu hình WAN, đọc/ghi config LAN, kiểm tra trạng thái, khởi động lại.

**F. Kiểm thử cấu hình tại chỗ (USB/UART)**

Scan/Read config: PC yêu cầu đọc cấu hình CFSC → WAN trả key–value (mask thông tin nhạy cảm). Config write: PC gửi lệnh (prefix CF...) → WAN validate → lưu NVS + apply runtime; nếu thuộc LAN thì forward SPI. Tiêu chí: cấu hình tồn tại sau reboot, không làm gián đoạn SPI/MQTT.

**G. Kiểm thử Module Base Setting (LAN MCU)**

Nạp JSON config cho module BLE/LoRa/Zigbee qua PC App và qua Web Portal. Prefix command matching: gửi AT command động, firmware tự tra JSON để lấy GPIO/timeout. GPIO-only command: MODULE_HW_RESET không gửi UART, chỉ toggle GPIO. Auto-restore: tắt nguồn và kiểm tra handler tự khởi động lại với config từ NVS.

**H. Kiểm thử BLE AT Command Handler (CFBL)**

Toàn bộ chuỗi lệnh: reset, scan, connect, discover GATT, write characteristic, nhận notify, disconnect. Kiểm thử trên module STM32WB55 với thiết bị BLE peripheral thực tế.

**I. Kiểm thử BLE Mesh Native Provisioner (CFBN)**

Nạp JSON config mesh (net key, app key, danh sách lệnh). Scan thiết bị chưa provision. Provisioning flow. Điều khiển node đã provision. Trả kết quả về server.

**J. Kiểm thử LoRa Handler (CFLR)**

Nạp JSON config LoRa. Gửi/nhận frame LoRa. Kiểm thử TDMA slot.

**K. Kiểm thử Zigbee Handler (CFZB)**

Nạp JSON config Zigbee. Gửi/nhận HEX frame. Kiểm thử ZCL commands.

**L. Kiểm thử RS485 Handler (CFRS)**

Cấu hình baudrate/parity. Gửi/nhận raw frame. Kiểm thử Modbus.

**M. Kiểm thử FOTA toàn gateway**

Server gửi CFML:CFFW → WAN parse và xác định OTA mode. WAN trigger LAN OTA + start PPP để LAN tải firmware. Sau khi LAN cập nhật xong, WAN tự cập nhật. Tiêu chí: cả hai MCU cập nhật thành công và boot lại bình thường.

---

## Bảng Kiểm Thử Chi Tiết

---

### Bảng 5.1. Kiểm Thử Scan/Read Cấu Hình (CFSC)

| STT | Nhóm | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|------|-----------|----------|-------------------|---------|
| 1 | Scan device | Cắm USB/UART, gateway ở NORMAL | PC thực hiện quét thiết bị | PC nhận diện đúng cổng/thiết bị | |
| 2 | Read config | Có cấu hình mặc định | PC gửi lệnh CFSC | WAN trả key–value đầy đủ, mask secret | |
| 3 | Read after write | Đã ghi cấu hình mới | PC đọc lại cấu hình | Giá trị phản ánh đúng cấu hình mới | |
| 4 | Read after reboot | Reset gateway | PC đọc cấu hình | Cấu hình giữ nguyên sau reboot (NVS) | |
| 5 | Read LAN config | LAN MCU đang chạy | PC gửi CFSC, đọc trường LAN | stack1_id, stack2_id, json_len hiển thị đúng | |

---

### Bảng 5.2. Kiểm Thử Ghi Cấu Hình Tham Số Chung

| STT | Nhóm tham số | Ví dụ tham số | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|-------------|--------------|----------|-------------------|---------|
| 1 | Chọn loại Internet | Wi-Fi / LTE / PPP / **Ethernet** | Ghi internet_type | Chuyển đúng chế độ, log trạng thái đúng | |
| 2 | Chọn loại Server | MQTT / **HTTP** / **CoAP** | Ghi server_type | Module connection tương ứng khởi động | |
| 3 | Chu kỳ gửi | period_ms | Ghi period_ms | Áp dụng runtime, không nghẽn SPI/Server | |
| 4 | Chính sách retry | backoff/retry | Ghi retry policy | Mất mạng → reconnect theo chính sách | |
| 5 | Giá trị ngoài dải | period_ms = 0 hoặc quá lớn | Ghi tham số lỗi | Trả FAIL, không áp dụng, NVS không đổi | |

---

### Bảng 5.3. Kiểm Thử Wi-Fi (Personal/Enterprise)

| STT | Chế độ | Tham số chính | Điều kiện | Tiêu chí chấp nhận | Kết quả |
|-----|--------|--------------|-----------|-------------------|---------|
| 1 | Personal | SSID + PSK | AP hoạt động | Kết nối thành công, có IP | |
| 2 | Personal | Sai mật khẩu | AP hoạt động | Không vào mạng, tự retry, không treo | |
| 3 | Enterprise | SSID + user/pass (EAP) | AP Enterprise | Auth OK, có IP | |
| 4 | Enterprise | Sai credential | AP Enterprise | Auth FAIL, retry có kiểm soát | |
| 5 | Đồng bộ thời gian | SNTP + RTC | Internet OK | RTC được cập nhật sau khi vào mạng | |
| 6 | Reconnect | Ngắt/khôi phục WiFi | Tắt AP rồi bật lại | Online trở lại, không cần reboot | |

---

### Bảng 5.4. Kiểm Thử LTE và PPP

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | LTE connect | Có modem + SIM | Chọn LTE, cấu hình APN | Có IP, online ổn định | |
| 2 | LTE reconnect | Ngắt/khôi phục sóng | Quan sát tự reconnect | Online trở lại, không cần reboot | |
| 3 | PPP Server | Có UART link LAN | Bật PPP Server | LAN nhận IP link qua PPP | |
| 4 | PPP stability | Truyền firmware OTA | Truyền dữ liệu qua PPP | Link không drop bất thường | |
| 5 | LTE config update | Gateway đang dùng LTE | Ghi APN mới qua UART | APN mới được lưu NVS, apply sau reconnect | |

---

### Bảng 5.5. Kiểm Thử Ethernet

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | Ethernet connect | W5500 gắn SPI, có cáp LAN | Chọn internet_type = Ethernet | DHCP lấy IP, online ổn định | |
| 2 | Ethernet reconnect | Rút/cắm lại cáp LAN | Quan sát tự reconnect | Online trở lại sau khi cắm cáp | |
| 3 | Ethernet + WiFi fallback | Ethernet connected | Rút cáp Ethernet | Tự fallback sang WiFi (nếu đã cấu hình) | |
| 4 | Static IP | Cấu hình IP tĩnh | Ghi static IP config | Dùng đúng IP tĩnh, không qua DHCP | |

---

### Bảng 5.6. Kiểm Thử Server MQTT

| STT | Hạng mục | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|----------|-------------------|---------|
| 1 | Broker config | Ghi host/port/user/pass | MQTT connect OK, log xác nhận | |
| 2 | Topic config | Ghi topic telemetry/downlink | Publish/subscribe đúng topic | |
| 3 | Uplink telemetry | LAN gửi data → SPI → WAN publish | Broker nhận payload đúng format | |
| 4 | Downlink RPC | Server publish RPC → gateway | WAN nhận, decode, forward sang LAN qua SPI | |
| 5 | Reconnect | Ngắt/khôi phục broker | Tự reconnect, không mất lệnh downlink đang pending | |
| 6 | QoS 1 | Publish với QoS 1 | Broker xác nhận PUBACK, không gửi duplicate | |

---

### Bảng 5.7. Kiểm Thử Server HTTP

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | HTTP config | Server HTTP endpoint | Ghi HTTP host/port/token | HTTP POST đến endpoint thành công | |
| 2 | Telemetry uplink | Gateway online | LAN gửi data → WAN HTTP POST | Server nhận payload JSON đúng | |
| 3 | HTTP response code | Server trả 200/4xx/5xx | Gửi request với token sai | Gateway log lỗi, retry theo policy | |
| 4 | HTTPS | Server HTTPS | Ghi endpoint https:// | TLS handshake OK, cert verify không lỗi | |
| 5 | Downlink polling | Gateway online | Server gửi lệnh qua HTTP endpoint | WAN GET command, forward sang LAN | |

---

### Bảng 5.8. Kiểm Thử Server CoAP

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | CoAP config | Server CoAP endpoint | Ghi CoAP host/port | CoAP PUT đến endpoint thành công | |
| 2 | Telemetry uplink | Gateway online | LAN gửi data → WAN CoAP PUT | Server nhận payload đúng | |
| 3 | CoAP observe | Server observe resource | WAN register observe trên server | Server nhận notify khi có data mới | |
| 4 | CoAP downlink | Server gửi POST | Server POST command xuống gateway | WAN nhận, forward sang LAN | |
| 5 | DTLS | Server DTLS enabled | Ghi DTLS PSK config | DTLS handshake OK, dữ liệu mã hóa | |

---

### Bảng 5.9. Kiểm Thử Web Config Portal — AP Mode (Lần Đầu Khởi Động)

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | AP phát sóng | Không có WiFi credentials trong NVS | Khởi động gateway | SSID "DA2-Gateway-XXXX" xuất hiện | |
| 2 | Captive DNS redirect | Phone kết nối AP | Kết nối WiFi AP, không mở browser thủ công | OS tự hiện popup "Sign in to network", redirect về 192.168.4.1 | |
| 3 | Captive DNS — Android | Phone Android | Kết nối AP, đợi prompt | Trang cấu hình hiện tự động (Android) | |
| 4 | Captive DNS — iOS | iPhone/iPad | Kết nối AP, đợi prompt | Trang cấu hình hiện tự động (iOS) | |
| 5 | Load giao diện SPA | Browser kết nối AP | Truy cập 192.168.4.1 | Trang cấu hình load đầy đủ, không lỗi JS | |
| 6 | Set WiFi + Reboot | Nhập SSID/Pass đúng | Nhấn Set WiFi Config → Reboot | Gateway reboot, kết nối WiFi thành công trong 30s | |
| 7 | Sai WiFi password | Nhập pass sai | Set WiFi Config → Reboot | Gateway không vào mạng, tự quay lại AP mode sau N lần retry | |

---

### Bảng 5.10. Kiểm Thử Web Config Portal — STA Mode

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | Truy cập qua IP | Gateway ở STA, có IP | Truy cập http://\<IP\> từ LAN | Trang cấu hình load đầy đủ | |
| 2 | Truy cập qua mDNS | mDNS hoạt động | Truy cập http://gateway.local | Trang load thành công, không cần biết IP | |
| 3 | GET /api/config | Gateway ở STA | GET /api/config từ browser | Trả JSON đầy đủ: wifi, lte, mqtt, http, coap | |
| 4 | POST /api/config (WiFi) | Gateway ở STA | POST {"wifi":{"ssid":"...","password":"..."}} | Gateway cập nhật WiFi, NVS save | |
| 5 | POST /api/config (MQTT) | Gateway ở STA | POST {"mqtt":{"broker":"..."}} | MQTT reconnect với broker mới | |
| 6 | GET /api/lan_config | Gateway ở STA, LAN chạy | GET /api/lan_config | Trả danh sách preset JSON cho BLE/LoRa/Zigbee | |
| 7 | POST /api/lan_config (BLE) | Module BLE đang chạy | POST JSON config BLE qua web | LAN MCU parse, NVS save, BLE handler restart | |
| 8 | GET /api/status | Gateway chạy bình thường | GET /api/status | Trả uptime, RSSI, FW version, internet_status | |
| 9 | POST /api/reboot | Gateway ở STA | POST /api/reboot | Gateway restart trong vòng 1s | |
| 10 | Advanced Mode — BLE tab | Mở Advanced Mode | Chọn tab BLE, Load preset | JSON preview hiện đúng template BLE STM32WB | |
| 11 | Advanced Mode — Firmware OTA | Advanced Mode | Nhập OTA URL, Start OTA | FOTA WAN MCU kích hoạt thành công | |

---

### Bảng 5.11. Kiểm Thử Module Base Setting — Nạp JSON Config

| STT | Nhóm | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|------|-----------|----------|-------------------|---------|
| 1 | Gửi BLE JSON từ PC App | Module BLE STM32WB55 cắm khe 1 | Gửi CFBL:JSON:0:\<json\> qua UART | LAN parse OK, NVS save, BLE handler start | |
| 2 | Gửi LoRa JSON từ PC App | Module LoRa RAK3172 cắm khe 1 | Gửi CFLR:JSON:0:\<json\> qua UART | LAN parse OK, NVS save, LoRa handler start | |
| 3 | Gửi Zigbee JSON từ PC App | Module Zigbee E180-ZG120B cắm khe 2 | Gửi CFZB:JSON:1:\<json\> qua UART | LAN parse OK, NVS save, Zigbee handler start | |
| 4 | Gửi JSON từ Web Portal | Gateway ở STA mode | POST /api/lan_config với BLE JSON | LAN MCU nhận qua SPI, parse OK, NVS save | |
| 5 | Gửi JSON từ MQTT | Server publish JSON config | MQTT publish CFBL:JSON:0:\<json\> | WAN forward SPI → LAN parse OK | |
| 6 | Parse đúng tham số | BLE config với UART 115200/8N1 | Gửi JSON, đọc lại CFSC | baudrate=115200, parity=none phản ánh đúng | |
| 7 | Auto-restore sau reboot | Đã lưu config vào NVS | Tắt/bật nguồn gateway | BLE handler tự khởi động lại đúng config, không cần gửi lại JSON | |
| 8 | Thay đổi loại module tại runtime | Khe 1 đang chạy BLE handler | Gửi JSON config LoRa cho khe 1 | BLE handler dừng, LoRa handler start với config mới | |
| 9 | JSON schema không hợp lệ | Gateway đang chạy | Gửi JSON thiếu trường bắt buộc | Firmware trả lỗi, NVS không thay đổi | |

---

### Bảng 5.12. Kiểm Thử Module Base Setting — Command Execution

| STT | Loại lệnh | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|----------|-----------|----------|-------------------|---------|
| 1 | Prefix match — AT+SCAN= | BLE config đã nạp, có MODULE_START_DISCOVERY | Gửi CFBL:0:AT+SCAN=5000 | Firmware tìm đúng function, áp dụng timeout 7000ms từ JSON, gửi UART | |
| 2 | Prefix match — AT+CONNECT= | BLE config đã nạp | Gửi CFBL:0:AT+CONNECT=AABBCCDDEE | Firmware ghép command đúng, gửi UART đến module | |
| 3 | GPIO-only — MODULE_HW_RESET | BLE config đã nạp | Gửi MODULE_HW_RESET qua CFBL | Không có byte nào gửi qua UART; chỉ toggle RST pin LOW→100ms→HIGH | |
| 4 | GPIO-only — MODULE_WAKEUP | BLE config đã nạp | Gửi MODULE_WAKEUP | Toggle WAKE pin đúng sequence từ JSON | |
| 5 | Không khớp JSON | BLE config đã nạp | Gửi CFBL:0:AT+UNKNOWNCMD | Firmware log lỗi "no function match", không gửi UART | |
| 6 | Timeout response | Gửi command, module không phản hồi | Gửi AT+CONNECT với thiết bị ngoài tầm | Firmware trả ESP_ERR_TIMEOUT đúng giá trị timeout_ms từ JSON | |

---

### Bảng 5.13. Kiểm Thử BLE AT Command Handler (CFBL — STM32WB55)

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | Hardware Reset | Module cắm, BLE config nạp | Gửi MODULE_HW_RESET | Module reset đúng, GPIO sequence thực thi, log "reset ok" | |
| 2 | Get Info | Module đang chạy | Gửi AT+GETINFO | Phản hồi FW version, BD_ADDR đúng format | |
| 3 | Scan BLE devices | Thiết bị BLE ở gần | Gửi CFBL:0:AT+SCAN=5000 | Trả về danh sách +SCAN:MAC,RSSI,Name trong 5s | |
| 4 | Connect | Có thiết bị từ kết quả scan | Gửi CFBL:0:AT+CONNECT=\<MAC\> | +CONNECTED:0 trong vòng timeout | |
| 5 | Discover GATT | Đã connect | Gửi CFBL:0:AT+DISC=0 | Trả danh sách +CHAR:handle,UUID đúng | |
| 6 | Enable Notify | Đã discover, có characteristic notify | Gửi CFBL:0:AT+NOTIFY=0,\<handle\>,1 | Notify enable OK, module gửi +NOTIFY khi có data | |
| 7 | Write Characteristic | Đã connect, biết handle | Gửi CFBL:0:AT+WRITE=0,\<handle\>,\<hex\_payload\> | Thiết bị nhận lệnh và thay đổi trạng thái | |
| 8 | Disconnect | Đang connectd | Gửi CFBL:0:AT+DISCONNECT=0 | +DISCONNECTED:0, module sẵn sàng scan lại | |
| 9 | Response forward | Module trả phản hồi | Các lệnh trên | Response từ UART module được forward lên MQTT/HTTP server | |

---

### Bảng 5.14. Kiểm Thử BLE Mesh Native Provisioner (CFBN)

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | Nạp JSON config Mesh | BLE Mesh stack chưa init | Gửi CFBN:JSON:0:\<json net_key,app_key\> | Stack khởi tạo OK, log "mesh provisioner started" | |
| 2 | Scan unprovisioned | Có thiết bị Mesh chưa provision | Gửi CFBN:0:SCAN | Nhận +UNPROV:UUID,RSSI trong 10s | |
| 3 | Provisioning | Đã scan, có UUID | Gửi CFBN:0:PROVISION:\<UUID\> | +PROV_DONE:addr=0x000X trong 30s | |
| 4 | Bind app key | Đã provision | Tự động (sau PROV_DONE) hoặc lệnh BIND | App key bind thành công, node sẵn sàng nhận control | |
| 5 | OnOff control | Node đã provision và bind | Gửi CFBN:0:CONTROL:\{"node":0x0005,"cmd":"TURN_ON"\} | Thiết bị bật; ACK nhận được | |
| 6 | Lightness control | Node có model Lightness | Gửi lệnh CONTROL với lightness value | Thiết bị thay đổi độ sáng đúng giá trị | |
| 7 | Scene recall | Node có model Scene | Gửi lệnh CONTROL scene_recall | Thiết bị chuyển về scene đã lưu | |
| 8 | Get status | Node đã provision | Gửi CFBN:0:STATUS:\<addr\> | +STATUS:addr,value trả về đúng | |

---

### Bảng 5.15. Kiểm Thử LoRa Handler (CFLR)

| STT | Tham số | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | JSON config LoRa | Module RAK3172 cắm | Gửi CFLR:JSON:0:\<json\> | Parse OK, UART init, LoRa handler start | |
| 2 | Tham số RF (SF, BW, CR) | JSON config nạp | Nhập tham số trên App và ghi lên gateway | Config lưu NVS và áp dụng trên module | |
| 3 | Slot TDMA / num_slots | JSON config nạp | Thay đổi Slot/num_slots trên App | Node gửi đúng slot, không đụng nhau | |
| 4 | ID gateway/node | JSON config nạp | Thay đổi ID gateway/node trên App | Lưu vào NVS LAN MCU | |
| 5 | Send/Receive frame | Hai node LoRa | Gửi frame từ node, gateway nhận | Frame nhận được, RSSI và SNR hợp lệ | |

---

### Bảng 5.16. Kiểm Thử Zigbee Handler (CFZB)

| STT | Tham số | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | JSON config Zigbee | Module E180-ZG120B cắm | Gửi CFZB:JSON:0:\<json\> | Parse OK, UART init, Zigbee handler start | |
| 2 | Coordinator join | Module là coordinator | Khởi động Zigbee network | Network open, thiết bị join được | |
| 3 | ZCL Basic cluster | Thiết bị Zigbee join | Gửi lệnh read basic attributes | Module trả device info đúng | |
| 4 | ZCL OnOff cluster | Thiết bị Zigbee join | Gửi CFZB:0:\<hex ZCL OnOff\> | Thiết bị bật/tắt đúng lệnh | |

---

### Bảng 5.17. Kiểm Thử RS485 Handler (CFRS)

| STT | Tham số | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|----------|-------------------|---------|
| 1 | Baud/parity | Thay đổi baud/parity qua App hoặc Web | Loopback/thiết bị phản hồi đúng định dạng | |
| 2 | Timeout | Thay đổi timeout qua App | Timeout đúng, không treo task | |
| 3 | Modbus RTU read | Thiết bị Modbus kết nối | Gửi frame read holding registers | Trả đúng giá trị register theo địa chỉ | |
| 4 | Modbus RTU write | Thiết bị Modbus kết nối | Gửi frame write single register | Thiết bị cập nhật register, xác nhận OK | |

---

### Bảng 5.18. Kiểm Thử FOTA Toàn Gateway

| STT | Hạng mục | Điều kiện | Thao tác | Tiêu chí chấp nhận | Kết quả |
|-----|---------|-----------|----------|-------------------|---------|
| 1 | Trigger FOTA từ server | Gateway online, MQTT connected | Server gửi CFML:CFFW:\<url\> | WAN nhận, xác định OTA mode, bắt đầu quy trình | |
| 2 | Trigger FOTA từ Web Portal | Gateway ở STA mode | Tab FW → nhập URL → Start OTA | WAN bắt đầu download firmware qua HTTP | |
| 3 | LAN MCU OTA (qua PPP) | PPP Server đã khởi động | WAN trigger LAN OTA | LAN tải firmware qua PPP link, flash, reboot | |
| 4 | WAN MCU OTA | LAN đã hoàn tất OTA | WAN tự update | WAN download, flash, reboot thành công | |
| 5 | Hệ thống sau FOTA | Cả hai MCU đã update | Quan sát sau reboot | Cả hai MCU boot đúng image mới, log version mới | |
| 6 | Mất mạng giữa chừng | Đang download firmware | Ngắt Internet tạm thời | Quy trình dừng an toàn, không brick firmware | |

---

### Bảng 5.19. Kiểm Thử Firmware — Tổng Hợp

| STT | Hạng mục | Phương pháp | Tiêu chí | Kết quả |
|-----|---------|-------------|---------|---------|
| 1 | Boot / FreeRTOS | Khởi động lặp 10 lần, chạy 24h | Không reset/treo bất thường | |
| 2 | Nạp LAN từ WAN | UART + GPIO boot/reset | Flash OK, LAN reboot chạy image mới | |
| 3 | SPI uplink | Truyền data + CRC/sequence | ACK/NACK đúng, retry hoạt động | |
| 4 | GPIO handshake downlink | WAN push command | LAN nhận đúng, phản hồi OK/FAIL | |
| 5 | Internet — WiFi | Connect + reconnect | Online ổn định, phục hồi sau mất mạng | |
| 6 | Internet — LTE | Connect + PPP | Online ổn định, LAN có IP qua PPP | |
| 7 | Internet — Ethernet | Cắm cáp, DHCP | Lấy IP, online ổn định | |
| 8 | Server — MQTT | publish/subscribe | Telemetry OK; downlink route đúng | |
| 9 | Server — HTTP | POST telemetry | Server nhận payload đúng | |
| 10 | Server — CoAP | PUT/Observe | Telemetry OK; observe notify hoạt động | |
| 11 | Web Portal AP mode | Captive DNS | Trang cấu hình hiện tự động (Android + iOS) | |
| 12 | Web Portal STA mode | REST API | Đọc/ghi config đúng qua browser | |
| 13 | Module Base Setting | Nạp JSON + prefix match | Config save NVS, command routing đúng | |
| 14 | BLE AT Command | Scan/Connect/Write | Module phản hồi đúng, response forward về server | |
| 15 | BLE Mesh Provisioner | Provision + Control | Node provision thành công, control có phản hồi | |
| 16 | LoRa Handler | Send/Receive frame | Frame truyền nhận đúng | |
| 17 | Zigbee Handler | ZCL command | Thiết bị phản hồi đúng | |
| 18 | RS485 Handler | Modbus RTU | Read/write register thành công | |
| 19 | USB/UART config | scan + write + reboot | Lưu NVS, áp dụng runtime | |
| 20 | FOTA toàn gateway | CFFW + PPP | Cả hai MCU update thành công, boot OK | |

---

Giai đoạn kiểm thử nhằm xác nhận firmware vận hành ổn định trên phần cứng đã bring up, đồng thời kiểm chứng đầy đủ các luồng quan trọng của hệ Dual MCU (SPI + handshake), Internet đa kênh (Wi-Fi/LTE/PPP/Ethernet), Cloud đa giao thức (MQTT/HTTP/CoAP), cổng cấu hình Web nhúng, hệ thống Module Base Setting, BLE Mesh Native Provisioner, và quy trình FOTA toàn gateway.
