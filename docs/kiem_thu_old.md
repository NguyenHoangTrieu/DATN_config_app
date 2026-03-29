5.2.4 Kiểm tra Firmware và Software

Sau khi hoàn tất kiểm tra phần cứng, hệ thống được đưa vào giai đoạn Firmware & Software Verification nhằm xác nhận bo mạch có thể vận hành ổn định với firmware thực tế, đồng thời kiểm chứng các luồng chức năng cốt lõi của kiến trúc Dual MCU Master–Slave (LAN MCU Master, WAN MCU Slave trên kênh SPI).

5.2.4.1. Mục tiêu

Xác nhận khả năng nạp và khởi chạy firmware cho cả hai MCU, đảm bảo vào đúng boot mode và ổn định dưới FreeRTOS.

Kiểm chứng các giao tiếp bắt buộc: SPI, UART nạp firmware cho MCU còn lại, và các tín hiệu điều khiển/handshake GPIO.

Kiểm chứng các chức năng mức hệ thống: kết nối Internet (Wi-Fi/LTE/PPP), MQTT uplink/downlink, cấu hình tại chỗ (USB/UART) và FOTA.

Định lượng nhanh các tiêu chí "đủ dùng" cho version hiện tại: chạy lâu không treo, truyền dữ liệu đúng/đủ, phục hồi khi mất mạng.

5.2.4.2. Quy trình nạp và khởi động firmware

Nạp WAN MCU qua cổng USB C (USB Serial/JTAG) bằng công cụ nạp chuẩn (ESP-IDF/esptool). Sau khi nạp, kiểm tra log UART/USB và trạng thái task khởi tạo.

Nạp LAN MCU gián tiếp từ WAN MCU qua kênh UART + GPIO control (Reset/Boot) để đưa LAN MCU vào Download Mode và flash. LAN MCU tự reboot sau khi nạp thành công.

Khởi động đồng thời hệ thống và kiểm tra:

FreeRTOS scheduler chạy ổn định (không reset bất thường).

Watchdog (nếu bật) không kích hoạt sai.

Các task chính lên đủ và không bị deadlock.

5.2.4.3. Nội dung kiểm thử firmware (theo nhóm chức năng)

A. Kiểm thử nền tảng (Boot/RTOS/Log)

Kiểm tra boot ổn định, log xuất đều, không reset ngẫu nhiên.

Kiểm tra hoạt động song song của các task chính (LAN thu thập/chuẩn hoá; WAN Internet/MQTT; liên MCU).

B. Kiểm thử giao tiếp liên MCU (Dual MCU Integration)

SPI data path: Truyền gói dữ liệu uplink từ LAN -> WAN. WAN phản hồi ACK/NACK theo kiểm tra CRC/sequence.

GPIO handshake (downlink push): Khi WAN có lệnh/command cần chuyển xuống LAN, WAN toggle GPIO handshake để LAN thực hiện phiên SPI nhận dữ liệu.

Tiêu chí: Dữ liệu không sai lệch (integrity), retry hoạt động khi lỗi CRC, không nghẽn SPI khi mạng dao động.

C. Kiểm thử Internet Communication (WAN MCU)

Wi-Fi: Hỗ trợ Wi-Fi Personal và Wi-Fi Enterprise; sau khi vào mạng thực hiện SNTP để đồng bộ thời gian và cập nhật RTC.

LTE: Kết nối modem LTE qua USB, theo dõi link và tự reconnect.

PPP Server: Bật PPP Server qua UART để tạo IP link hỗ trợ LAN MCU thực hiện OTA.

D. Kiểm thử Cloud/MQTT (WAN MCU)

Duy trì kết nối MQTT; kiểm tra cơ chế tự reconnect.

Uplink telemetry: Nhận dữ liệu từ LAN (SPI) -> đưa vào publish queue -> đóng gói payload -> publish lên broker.

Downlink command: Subscribe topic downlink -> decode payload -> phân loại đích (handler_type) -> push xuống LAN bằng GPIO handshake + SPI.

E. Kiểm thử cấu hình tại chỗ (USB/UART)

Scan/Read config: PC yêu cầu đọc cấu hình -> WAN trả về key–value (mask thông tin nhạy cảm).

Config write: PC gửi lệnh cấu hình (prefix CF...) -> WAN enqueue -> validate -> lưu NVS + apply runtime; nếu cấu hình thuộc LAN thì forward xuống LAN.

Tiêu chí: Cấu hình tồn tại sau reboot, và không làm gián đoạn các luồng SPI/MQTT.

F. Kiểm thử FOTA toàn gateway

Server gửi lệnh CFML:CFFW -> WAN parse và xác định OTA mode.

WAN trigger LAN OTA + start PPP để LAN có IP link tải firmware và cập nhật.

Sau khi LAN cập nhật xong, LAN gửi handshake; WAN chuyển sang tự cập nhật firmware của chính nó (WAN không phản hồi handshake theo kiểu đối thoại mà bước vào OTA).

Tiêu chí: Hoàn tất cập nhật cả hai MCU và hệ thống boot lại bình thường. (Lưu ý: cơ chế rollback/fallback nếu cần được coi là hướng mở rộng, tuỳ cấu hình bootloader/confirm app).

G. Kiểm tra cấu hình (Configuration Tools -> Gateway)
Kiểm thử cấu hình nhằm xác nhận công cụ PC có thể đọc/ghi tham số qua USB/UART, firmware validate – lưu NVS – áp dụng runtime, đồng thời nếu tham số thuộc LAN thì WAN sẽ forward xuống LAN qua SPI.

Bảng 5.1 Kiểm thử Scan/Read cấu hình

STT

Nhóm

Điều kiện

Thao tác

Tiêu chí chấp nhận

Kết quả

1

Scan device

Cắm USB/UART, gateway ở NORMAL

PC thực hiện quét thiết bị

PC nhận diện đúng cổng/thiết bị

Passed

2

Read config

Có cấu hình mặc định

PC gửi lệnh đọc cấu hình

WAN trả key–value đầy đủ (mask secret)

Passed

3

Read after write

Đã ghi cấu hình mới

PC đọc lại cấu hình

Giá trị phản ánh đúng cấu hình mới

Passed

4

Read after reboot

Reset gateway

PC đọc cấu hình

Cấu hình giữ nguyên sau reboot

Passed

Bảng 5.2 Kiểm thử ghi cấu hình Internet (internet_type) và tham số chung

STT

Nhóm tham số

Ví dụ tham số

Thao tác

Tiêu chí chấp nhận

Kết quả

1

Chọn loại Internet

Wi-Fi / LTE / PPP

Ghi internet_type

Chuyển đúng chế độ, log trạng thái đúng

Passed

2

Chu kỳ gửi

period_ms

Ghi period_ms

Áp dụng runtime, không nghẽn SPI/MQTT

Passed

3

Chính sách retry

backoff/retry

Ghi retry policy

Mất mạng -> reconnect theo chính sách

Passed

4

Giá trị ngoài dải

period_ms quá lớn/0

Ghi tham số lỗi

Trả FAIL, không áp dụng

Passed

Bảng 5.3 Kiểm thử Wi-Fi (Personal/Enterprise)

STT

Chế độ

Tham số chính

Điều kiện

Tiêu chí chấp nhận

Kết quả

1

Personal

SSID + PSK

AP hoạt động

Kết nối thành công, có IP

Passed

2

Personal

Sai mật khẩu

AP hoạt động

Không vào mạng, tự retry, không treo

Passed

3

Enterprise

SSID + user/pass (EAP)

AP Enterprise

Auth OK, có IP

Passed

4

Enterprise

Sai credential

AP Enterprise

Auth FAIL, retry có kiểm soát

Passed

5

Đồng bộ thời gian

SNTP + RTC

Internet OK

RTC được cập nhật sau khi vào mạng

Passed

Bảng 5.4 Kiểm thử LTE và PPP

STT

Hạng mục

Điều kiện

Thao tác

Tiêu chí chấp nhận

Kết quả

1

LTE connect

Có modem + SIM

Chọn LTE, cấu hình APN (nếu có)

Có IP, online ổn định

Passed

2

LTE reconnect

Ngắt/khôi phục sóng

Quan sát tự reconnect

Online trở lại, không cần reboot

Passed

3

PPP Server

Có UART link LAN

Bật PPP Server

LAN nhận IP link qua PPP

Passed

4

PPP stability

Update FOTA

Truyền dữ liệu qua PPP

Link không drop bất thường

Passed

Bảng 5.5 Kiểm thử MQTT (broker/topic/telemetry/downlink)

STT

Hạng mục

Thao tác

Tiêu chí chấp nhận

Kết quả

1

Broker config

Ghi host/port/user/pass

MQTT connect OK

Passed

2

Topic config

Ghi topic telemetry/downlink

Publish/subscribe đúng topic

Passed

Kiểm tra cấu hình ở LAN:

Bảng 5.6 Kiểm thử cấu hình LoRa TDMA

STT

Tham số

Thao tác

Tiêu chí chấp nhận

Kết quả

1

Slot/num_slots

Thay đổi Slot/num_slots trên App

Node gửi đúng slot, không đụng nhau

Passed

2

ID gateway/node

Thay đổi ID gateway/node trên App

Lưu vào NVS của LAN MCU

Passed

3

Tham số của module LoRa

Nhập tham số trên App và ghi lên gateway

Config lưu được trong NVS và trên Module

Passed

Bảng 5.7 Kiểm thử cấu hình CAN

STT

Tham số

Thao tác

Tiêu chí chấp nhận

Kết quả

1

Bitrate

Thay đổi bitrate trên App

Receive/Transmit frame OK

Passed

2

Filter/ID

Thay đổi filter/ID trên App

Chỉ nhận ID hợp lệ

Passed

3

Bus-off

Tạo lỗi bus-off (thao tác theo chức năng test trên App)

Tự phục hồi theo policy

Passed

Bảng 5.8 Kiểm thử RS 485/Modbus (raw frame)

STT

Tham số

Thao tác

Tiêu chí chấp nhận

Kết quả

1

Baud/parity

Thay đổi baud/parity trên App

Loopback/thiết bị phản hồi đúng

Passed

2

Timeout

Thay đổi timeout trên App

Timeout đúng, không treo task

Passed

Bảng 5.9 Kiểm thử firmware (tổng hợp)

STT

Hạng mục

Phương pháp

Tiêu chí

Kết quả

1

Boot/FreeRTOS

Khởi động lặp, chạy lâu

Không reset/treo bất thường

Passed

2

Nạp LAN từ WAN

UART + GPIO boot/reset

Flash OK, LAN reboot chạy image mới

Passed

3

SPI uplink

DT + CRC/seq

ACK/NACK đúng, retry hoạt động

Passed

4

GPIO handshake downlink

WAN push command

LAN nhận đúng, phản hồi OK/FAIL

Passed

5

Internet (Wi-Fi/LTE/PPP)

Connect + reconnect

Online ổn định, phục hồi sau mất mạng

Passed

6

MQTT uplink/downlink

publish/subscribe

Telemetry OK; downlink route đúng

Passed

7

USB/UART config

scan + write + reboot

Lưu NVS, áp dụng runtime

Passed

8

FOTA toàn gateway

CFML:CFFW + PPP

LAN update trước; WAN update sau; boot OK

Passed

Giai đoạn kiểm thử xác nhận firmware vận hành ổn định trên phần cứng đã bring up, đồng thời kiểm chứng các luồng quan trọng của hệ Dual MCU (SPI + handshake), Internet/Cloud (Wi-Fi/LTE/MQTT), cấu hình tại chỗ và quy trình FOTA toàn gateway.