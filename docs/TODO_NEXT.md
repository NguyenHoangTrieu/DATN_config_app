Next task:
1. sửa lại phần gatt của esp32s3 ble native trên MCU LAN để có thể kết nối được 8 thiêt bị cùng lúc.
2. cập nhật lại UI của các app (thingboard widget) (phàn test điều khiển led đơn cũ gồm ble native gatt, native mesh, zigbee) chỉ gồm nút bật tắt và điều chỉnh 5 màu cố định là đỏ xanh lá xanh dương vàng, trắng, xóa 2 thanh điều chỉnh màu đi.
3. cập nhật lại file BLE_ZIGBEE_LORA_TEST_COMMANDS để thêm phần real application test command cho các bài test dưới đây:
a. Bài test ble native gatt: test kết nối 5 thiết bị cùng lúc, gồm:
- 2 thiết bị đèn led (code arduino đã có sẵn, file esp32c6_ble_gatt_peripheral.ino, tên và nội dung là của c6 nhưng thực tế sẽ dùng cho esp32s3)
- 3 thiết bị cảm biến nhiệt độ độ ẩm (code arduino chưa có, viết mới giúp tôi, dữ liệu do mcu tự giả lập ra, không cần cảm biến thật)
- các thiết bị phải có name riêng + cái gì đó để để phân biệt loại thiết bị.
b. Bài test native mesh: test kết nối 5 thiết bị cùng lúc, gồm:
- 2 thiết bị đèn led (code arduino chưa có tạo file mới cho esp32s3 (kg dùng c6 cho đèn này, tham khảo gpio của esp32c6_ble_gatt_peripheral.ino))
- 3 thiết bị cảm biến nhiệt độ độ ẩm (code arduino chưa có, viết mới giúp tôi, dữ liệu do mcu tự giả lập ra, không cần cảm biến thật)
- các thiết bị phải có name riêng + cái gì đó để để phân biệt loại thiết bị.
b. bài test zigbee: test kết nối 3 thiết bị cùng lúc, gồm:
- 1 thiết bị đèn led (code arduino đã có sẵn, file esp32c6_zigbee_bulb.ino, tuy nhiên cần kiểm tra lại).
- 2 thiết bị cảm biến nhiệt độ độ ẩm (code arduino chưa có, viết mới giúp tôi, dữ liệu do mcu tự giả lập ra, không cần cảm biến thật)
- các thiết bị phải có name riêng + cái gì đó để để phân biệt loại thiết bị.
c. Bài test lora: test kết nối 1 thiết bị, gồm:
- 1 một thiết bị kết nối với wio e5 (code arduino đã có sẵn, file uno_r4_wio_e5_gateway.ino, tuy nhiên cần kiểm tra lại).
Lưu ý: trên các đèn led, chỉ để 5 màu cố định là đỏ xanh lá xanh dương vàng, trắng và chỉ có bật tắt.
4. cập nhật lại thay vì test bằng UI (thingboard widget) thay vì nhập tay cho 3 bài test nói trên theo các yêu cầu sau:
a. Bài test ble native gatt:
- thiết kế UI hiển thị danh sách thiết bị có thể kết nối, sau khi kết nối thành công sẽ hiển thị các thiết bị đã kết nối, người dùng có thể chọn từng thiết bị để bật tắt đèn led hoặc xem dữ liệu cảm biến nhiệt độ độ ẩm.
- có lưu lại thiết bị đã kết nối để lần sau mở app lên sẽ còn lưu lại danh sách nhưng kg được kết nối lại tự động, người dùng phải chọn từng thiết bị để kết nối lại.
b. Bài test native mesh:
- thiết kế UI hiển thị danh sách thiết bị có thể kết nối, sau khi kết nối thành công sẽ hiển thị các thiết bị đã kết nối, người dùng có thể chọn từng thiết bị để bật tắt đèn led hoặc xem dữ liệu cảm biến nhiệt độ độ ẩm.
- có lưu lại thiết bị đã kết nối để lần sau mở app lên sẽ còn lưu lại danh sách nhưng kg được kết nối lại tự động, người dùng phải chọn từng thiết bị để kết nối lại.
c. Bài test zigbee:
- thiết kế UI hiển thị danh sách thiết bị có thể kết nối, sau khi kết nối thành công sẽ hiển thị các thiết bị đã kết nối, người dùng có thể chọn từng thiết bị để bật tắt đèn led hoặc xem dữ liệu cảm biến nhiệt độ độ ẩm.
- có lưu lại thiết bị đã kết nối để lần sau mở app lên sẽ còn lưu lại danh sách nhưng kg được kết nối lại tự động, người dùng phải chọn từng thiết bị để kết nối lại.
d. Bài test lora:
- thiết kế UI để điều khiển hợp lý cho thiết bị arduino, xem code arduino để thiết kế UI phù hợp.
5. Viết thêm bài test maximum bandwidth cho ble native gatt, native mesh, zigbee, lora để đo băng thông tối đa của từng giao thức, yêu cầu:
a. Bài test ble native gatt: test kết nối 1 thiết bị cảm biến giả lập (cần code arduino mới) và gửi dữ liệu liên tục từ app đến thiết bị để đo băng thông tối đa. (thiết kế UI widget để hiển thị băng thông đo được theo thời gian thực)
b. Bài test native mesh: test kết nối 1 thiết bị cảm biến giả lập (cần code arduino mới) và gửi dữ liệu liên tục từ app đến thiết bị để đo băng thông tối đa. (thiết kế UI widget để hiển thị băng thông đo được theo thời gian thực)
c. Bài test zigbee: test kết nối 1 thiết bị cảm biến giả lập (cần code arduino mới) và gửi dữ liệu liên tục từ app đến thiết bị để đo băng thông tối đa. (thiết kế UI widget để hiển thị băng thông đo được theo thời gian thực)
d. Bài test lora: test kết nối 1 thiết bị cảm biến giả lập (cần code arduino mới) và gửi dữ liệu liên tục từ app đến thiết bị để đo băng thông tối đa. (thiết kế UI widget để hiển thị băng thông đo được theo thời gian thực)

Lưu ý:
1. Cần tạo các file markdown thiết kế UI widger trước để imple sau, mỗi một test nói trên phải có một file design UI riêng, trong đó mô tả chi tiết về giao diện, các thành phần cần có trên widget, cách hiển thị dữ liệu băng thông theo thời gian thực, và cách người dùng tương tác với widget để bắt đầu và dừng bài test.
2. Các command gửi đi kg được đè lên nhau, giả sử gửi 1 command thì phải chờ phản hồi/ timeout mới được gửi command tiếp theo, tránh trường hợp gửi 2 command cùng lúc.
Tiếp tục:
1. viết lại config app dựa trên server thingboard.
