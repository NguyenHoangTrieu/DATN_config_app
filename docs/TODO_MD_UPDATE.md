## Các phần cần cập nhật
- cập nhật lại format config gửi cho WAN thông qua uart, xóa mấy cái config zigbee, stack_type, LoRa, v.v... Thay mới chỉ gửi đúng: g_stack_1_id, g_stack_2_id (nếu kg có module nào gắn vào thì gửi 000 cho cả 2, ví dụ nếu stack 1 có module ble stm32 thì id là 002, stack 2 kg có module gắn vào thì là 000) ,RS485 chỉ giữ lại baudrate (nếu gắn stack là RS485), json config đã lưu cho 2 stack (nếu có).
- check lại giúp tôi config handler luôn xem nó tương thích kg, có cần xóa mấy cái code trong comment kg vì đã có file config_handler_ble_command rồi ?
- xóa zigbee handler, LoRa handler, (file tôi đã xóa rồi, code liên quan trong các file khác bạn xóa giúp tôi) xóa luôn mấy cái file và code liên quan đến zigbee, LoRa, v.v... (để imple lại theo dạng module base setting sau, chưa làm trong giai đoạn thử nghiệm này)
- loại bỏ hoàn toàn CAN, kg support nữa (xóa code liên quan giúp tôi, file tôi cũng đã xóa rồi).
- với hàm stack_handler_get_stack_id thực hiện một persuado cho function này trả về mặc định có một stack id gắn vào là 002, khi module monitor task gọi hàm này thì trả về 002 sau đó lưu vào g_stack_1_id, còn g_stack_2_id vẫn giữ nguyên là 000.
- các global config varable để gửi: g_stack_1_id, g_stack_2_id, g_rs485_baudrate, json config cũng lưu dưới dạng global variable (bạn tự đặt tên biết và có hàm get để trả về khi config app yêu cầu, tham khảo file mcu_wan_handler_downlink.c để xem việc gửi config khi có yêu cầu từ app như thế nào)
- tạo cho tôi thêm một file test_list.md để list các thứ tự test để test code cho ý tưởng về module base setting trên.


- tôi chưa thấy cập nhật phần lấy id từ hàm stack_handler_get_stack_id và lưu vào g_stack_1_id, g_stack_2_id, bạn cập nhật giúp tôi phần này, sau đó khi có yêu cầu config từ app thì gửi lại cho app thông qua uart với format đã thống nhất ở trên.
- dời tất cả phần load save global var vào nvs cho config vào file config_load_save.c, kể cả json file trong module monitor task, để dễ quản lý hơn.
- theo tôi thấy nếu cấu hình theo json file thì cái này kg cần thiết nữa xóa đi:typedef enum {
  STACK_COMM_TYPE_NONE = 0,
  STACK_COMM_TYPE_BLE,
  STACK_COMM_TYPE_RS485
} stack_comm_type_t;
- module monitor task chưa được chạy, hàm stack_handler_get_stack_id chưa được gọi để check ID và khởi động task. 
- thêm vào code cho phần wan ở data comm phần uart và usb, thêm cho tôi một chức năng để app có thể scan được device gateway đang được cắm vào PC, theo sơ đồ sau, đầu tiên là scan xem cổng com của ch340 | ch340k có được kết nối vào PC hay chưa. sau đó scan tiếp theo các cổng com ch340 đó gateway nằm ở cổng nào, nếu đó là gateway thì đánh dấu lưu lại để hiển thị có thể kết nối, nếu kg phải gateway thì kg kết nối mà bỏ qua
