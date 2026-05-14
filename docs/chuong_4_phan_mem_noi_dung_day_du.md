# CHƯƠNG 4: THIẾT KẾ VÀ THỰC HIỆN PHẦN MỀM

Chương này trình bày toàn bộ phần thiết kế và hiện thực phần mềm cho hệ thống gateway IoT mô-đun dựa trên kiến trúc Dual-MCU sử dụng hai vi điều khiển ESP32-S3. Nội dung được tổ chức lại theo mục lục mới của báo cáo, đồng thời kế thừa các phần mô tả kỹ thuật từ tài liệu LaTeX cũ và bổ sung các nội dung redesign đã được chốt ở giai đoạn rà soát cấu trúc. Trọng tâm của chương là mô tả tư duy thiết kế, kiến trúc firmware, cơ chế giao tiếp nội bộ, phương án cấu hình module, các giao diện cấu hình tại chỗ và từ xa, cũng như đánh giá tổng thể giải pháp phần mềm trong tương quan với yêu cầu hệ thống.

Trong toàn bộ chương này, thuật ngữ WAN-MCU được dùng để chỉ vi điều khiển phụ trách kết nối diện rộng, Cloud và điều phối hệ thống; LAN-MCU được dùng để chỉ vi điều khiển phụ trách các giao thức mạng cục bộ, giao tiếp với thiết bị đầu cuối và tiền xử lý dữ liệu tại biên. Cách phân vai này là nền tảng của toàn bộ giải pháp firmware/software được trình bày dưới đây.

Danh mục hình đính kèm trong file HTML để tham chiếu khi dàn trang chương 4:

- Hình 4.1: Sơ đồ khối firmware WAN-MCU.
- Hình 4.2: Sơ đồ khối firmware LAN-MCU.
- Hình 4.3: Sơ đồ phân cấp chi tiết firmware WAN-MCU.
- Hình 4.4: Lưu đồ Data Communication Handler.
- Hình 4.5: Lưu đồ Web Config Portal.
- Hình 4.6: Lưu đồ FOTA Dual-MCU.
- Hình 4.7: Sơ đồ phân cấp chi tiết firmware LAN-MCU.
- Hình 4.8: Luồng Module Base Setting.
- Hình 4.9: Luồng điều khiển end-to-end server đến thiết bị.
- Hình 4.10: Minh họa quy trình FOTA dùng trong thiết kế gốc.

---

## 4.1 Giải pháp phần mềm đề xuất

Giải pháp phần mềm được xây dựng nhằm đáp ứng đồng thời các yêu cầu cốt lõi của một gateway IoT có khả năng mô-đun hóa cao, bao gồm: tính linh hoạt khi thay đổi phần cứng mở rộng, khả năng cấu hình mà không cần sửa mã nguồn, độ ổn định trong vận hành dài hạn, khả năng phục hồi khi lỗi mạng xảy ra, và khả năng mở rộng thêm giao thức hoặc dịch vụ ở các phiên bản sau.

Với những yêu cầu như vậy, việc triển khai toàn bộ chức năng trên một vi điều khiển đơn lẻ dễ dẫn đến hiện tượng cạnh tranh tài nguyên giữa các ngăn xếp giao thức. Nếu cùng một MCU vừa phải duy trì kết nối Internet, vừa phải chạy các stack như Zigbee, LoRa, BLE, RS-485, đồng thời còn phải quản lý hàng đợi dữ liệu, Web Config Portal, FOTA và giao tiếp với giao diện người dùng, hệ thống rất dễ rơi vào trạng thái thiếu RAM, xung đột tài nguyên ngoại vi hoặc xuất hiện độ trễ lớn trong các kịch bản tải cao. Do đó, giải pháp phần mềm của đồ án được xây dựng trên kiến trúc Dual-MCU Master-Slave để tách biệt rõ hai miền chức năng.

Trong kiến trúc này, WAN-MCU đóng vai trò Application Master. Khối này chịu trách nhiệm kết nối Internet qua Wi-Fi, Ethernet hoặc LTE; quản lý giao tiếp với Cloud qua MQTT, HTTP hoặc CoAP; vận hành các giao diện cấu hình tại chỗ và từ xa; điều phối quá trình cập nhật firmware; đồng thời làm đầu mối điều khiển toàn bộ hệ thống. Ngược lại, LAN-MCU chịu trách nhiệm cho miền Sensing và LAN Network Domain. MCU này trực tiếp giao tiếp với các module LoRa, Zigbee, BLE, RS-485 và các stack mở rộng khác; thu thập dữ liệu thô từ thiết bị đầu cuối; thực hiện kiểm tra, chuẩn hóa và đẩy dữ liệu sang WAN-MCU thông qua kênh truyền thông nội bộ tốc độ cao.

Từ góc nhìn phần mềm, giải pháp này đem lại bốn lợi ích chính.

Thứ nhất, nó cho phép tách biệt rõ trách nhiệm xử lý thời gian thực và trách nhiệm xử lý dịch vụ mạng. LAN-MCU có thể tập trung vào các tác vụ gần nguồn dữ liệu như nhận khung truyền thông, kiểm tra checksum, lọc khung lỗi, gắn timestamp và chuẩn hóa dữ liệu. Trong khi đó, WAN-MCU có thể tập trung xử lý các dịch vụ có độ biến thiên lớn về độ trễ như MQTT publish, HTTP request-response, CoAP observe, xác thực bảo mật, đồng bộ thời gian, Web Portal và FOTA.

Thứ hai, giải pháp Dual-MCU giúp hệ thống giảm mức độ phụ thuộc giữa các giao thức. Khi một giao thức LAN cần được thay đổi, ví dụ thay module BLE AT bằng BLE native hoặc bổ sung một module Zigbee khác, thay đổi chủ yếu được giới hạn ở firmware phía LAN. Tương tự, khi cần bổ sung một nền tảng Cloud mới, phần thay đổi tập trung ở phía WAN. Điều này làm giảm rủi ro ảnh hưởng dây chuyền trong quá trình bảo trì và nâng cấp.

Thứ ba, giải pháp phần mềm được xây dựng theo mô hình phân lớp nhất quán, gồm Driver, BSP, Middleware và Application. Đây là cơ sở để đảm bảo khả năng tái sử dụng, dễ đọc, dễ kiểm thử và dễ tích hợp thêm thành phần mới. Các lớp thấp hơn chịu trách nhiệm trừu tượng hóa phần cứng và giao thức, còn lớp trên cùng tập trung vào logic điều phối và nghiệp vụ ứng dụng.

Thứ tư, phần mềm được thiết kế theo hướng cấu hình hóa tối đa. Các tham số vận hành của gateway được lưu trong bộ nhớ không mất dữ liệu NVS và có thể cập nhật runtime thông qua App Config trên PC hoặc Web Config Portal. Đặc biệt, đối với các module RF có sự khác biệt lớn về cú pháp lệnh AT, hệ thống không tiếp tục hard-code cú pháp vào firmware mà chuyển sang cơ chế Module Base Setting dựa trên JSON. Cách làm này cho phép thay đổi module phần cứng hoặc mở rộng khả năng tương thích mà không cần biên dịch lại firmware.

Từ những nguyên tắc trên, giải pháp phần mềm đề xuất của đồ án có thể tóm lược theo các điểm sau:

| Thành phần giải pháp | Nội dung chính |
|---|---|
| Kiến trúc xử lý | Dual-MCU Master-Slave, tách miền WAN và LAN |
| Mô hình phần mềm | Phân lớp Driver - BSP - Middleware - Application |
| Nhân điều phối | FreeRTOS task-based architecture |
| Giao tiếp nội bộ | SPI tốc độ cao kết hợp GPIO handshake event-driven |
| Cấu hình hệ thống | NVS + USB/UART App Config + Web Config Portal |
| Cấu hình module | JSON preset cho từng loại module RF |
| Giao tiếp Cloud | MQTT, HTTP, CoAP với lựa chọn động theo cấu hình |
| Kết nối Internet | Wi-Fi, Ethernet, LTE với Auto-reconnect và Auto-failover |
| Cập nhật firmware | FOTA tuần tự cho LAN-MCU và WAN-MCU |

Như vậy, giải pháp phần mềm không chỉ nhằm hiện thực hóa chức năng của một gateway IoT, mà còn hướng đến việc hình thành một nền tảng firmware có khả năng mở rộng và tái cấu hình cao, phù hợp với định hướng phát triển nhiều phiên bản phần cứng/module khác nhau về sau.

---

## 4.2 Kiến trúc firmware/software tổng thể

Kiến trúc firmware/software tổng thể của hệ thống được xây dựng trên nền tảng FreeRTOS, áp dụng đồng nhất cho cả hai MCU, nhưng được chuyên biệt hóa theo vai trò của từng vi điều khiển. Ở mức cao nhất, hệ thống được chia thành hai miền chức năng tương đối độc lập:

- Miền WAN: phụ trách các kết nối diện rộng, giao tiếp Cloud, cấu hình hệ thống và điều phối các tác vụ cấp cao.
- Miền LAN: phụ trách giao tiếp với module mạng cục bộ, thiết bị đầu cuối và xử lý dữ liệu gần nguồn.

Hai miền này trao đổi với nhau thông qua một giao thức nội bộ thống nhất chạy trên bus SPI tốc độ cao, kết hợp cơ chế GPIO handshake để hỗ trợ các phiên downlink theo hướng event-driven. Nhờ đó, luồng dữ liệu từ sensor lên Cloud và luồng lệnh từ Cloud xuống thiết bị được tổ chức thành các pipeline tách biệt nhưng liên kết chặt chẽ.

### 4.2.1 Kiến trúc phân lớp phần mềm

Phần mềm của hệ thống được tổ chức thành bốn lớp chính:

| Lớp | Vai trò |
|---|---|
| Driver | Truy cập trực tiếp các ngoại vi phần cứng như GPIO, UART, SPI, I2C, USB, SDIO |
| BSP | Gói các driver thành các khối chức năng gần phần cứng như modem LTE, Ethernet, truyền thông liên MCU, RTC, SD Card, IO Expander |
| Middleware | Cung cấp các thành phần trừu tượng hóa giao thức và dịch vụ nền như FreeRTOS, MQTT/HTTP/CoAP stack, parser JSON, OTA, storage handler |
| Application | Chứa logic điều phối và các handler nghiệp vụ như Config Handler, Server Communication Handler, Web Config Handler, FOTA Handler, các protocol handler phía LAN |

Việc phân lớp này nhằm bảo đảm rằng logic ứng dụng không phụ thuộc trực tiếp vào chi tiết phần cứng. Khi một driver hoặc một module vật lý thay đổi, phạm vi ảnh hưởng sẽ được giới hạn chủ yếu ở Driver và BSP. Trong khi đó, Application Layer có thể giữ nguyên mô hình xử lý, chỉ thay đổi thông số cấu hình hoặc cơ chế ánh xạ handler.

### 4.2.2 Kiến trúc phân vai giữa WAN-MCU và LAN-MCU

Ở mức hệ thống, WAN-MCU và LAN-MCU không phải là hai khối firmware tách rời hoàn toàn mà là hai thành phần hợp tác trong một kiến trúc điều phối thống nhất.

WAN-MCU được thiết kế như đầu não điều phối. Mọi cấu hình hệ thống cấp cao, mọi kết nối Cloud và mọi tác vụ liên quan đến người dùng hoặc hạ tầng mạng đều tập trung tại đây. WAN-MCU chịu trách nhiệm khởi tạo kết nối Internet, quản lý ưu tiên giữa Wi-Fi, Ethernet và LTE, lựa chọn giao thức giao tiếp server, thực hiện publish telemetry, nhận lệnh RPC/downlink và đưa ra quyết định định tuyến lệnh tới LAN-MCU hay xử lý trực tiếp ở nội bộ hệ thống. Đồng thời, WAN-MCU cũng là điểm tập trung của các kênh cấu hình tại chỗ như USB/UART và Web Config Portal.

Trong khi đó, LAN-MCU được thiết kế như khối xử lý biên cho các giao thức tầng dưới. MCU này quản lý trực tiếp các module LoRa, Zigbee, BLE, RS-485 và các stack mở rộng khác. Nhiệm vụ của LAN-MCU không chỉ là đọc dữ liệu thô mà còn thực hiện validation, parsing, normalization và đóng gói dữ liệu thành định dạng khung nội bộ trước khi truyền sang WAN-MCU. Khi nhận lệnh từ WAN-MCU, LAN-MCU cũng là nơi thực hiện bước giải mã handler đích, ghép tham số lệnh, điều khiển GPIO theo yêu cầu module và trả phản hồi ngược lên.

Sự phân vai này tạo ra hai lợi thế quan trọng. Một mặt, nó cho phép tối ưu tài nguyên phần cứng trên từng MCU. Mặt khác, nó giúp các tác vụ có bản chất khác nhau không cản trở lẫn nhau. Ví dụ, độ trễ mạng hoặc broker phản hồi chậm sẽ không trực tiếp làm trễ việc thu thập dữ liệu từ các sensor node nếu pipeline xử lý phía LAN vẫn hoạt động bình thường.

### 4.2.3 Luồng dữ liệu tổng thể

Từ góc nhìn hoạt động, hệ thống có ba luồng chính.

Luồng thứ nhất là luồng uplink, tức luồng dữ liệu từ thiết bị đầu cuối đi lên server. Trong luồng này, dữ liệu được thu thập bởi LAN-MCU qua các protocol handler, sau đó được kiểm tra và chuẩn hóa trước khi đóng gói vào Data Frame. WAN-MCU nhận khung dữ liệu qua SPI, kiểm tra tính hợp lệ, ghi nhận trạng thái kết nối Internet, rồi định tuyến dữ liệu tới MQTT, HTTP hoặc CoAP handler tương ứng để gửi lên Cloud.

Luồng thứ hai là luồng downlink, tức luồng lệnh từ server đi xuống thiết bị đầu cuối. Khi nhận lệnh RPC hoặc command từ server, WAN-MCU phân tích payload để xác định loại lệnh và giao thức đích. Sau đó, lệnh được đóng gói thành Command Frame, đưa vào hàng đợi downlink và kích hoạt GPIO handshake. LAN-MCU phát hiện sự kiện ngắt, chủ động thực hiện phiên SPI để đọc gói lệnh, xác thực CRC/sequence, rồi chuyển lệnh tới protocol handler phù hợp để thực thi ở lớp vật lý.

Luồng thứ ba là luồng cấu hình và bảo trì. Luồng này có thể được khởi tạo từ ứng dụng cấu hình trên PC, từ Web Config Portal hoặc từ server trong trường hợp FOTA. Tất cả đều đi qua WAN-MCU. Nếu cấu hình thuộc miền WAN, hệ thống áp dụng trực tiếp tại đây. Nếu cấu hình thuộc module mạng nội bộ hoặc preset JSON, WAN-MCU sẽ chuyển tiếp gói cấu hình xuống LAN-MCU thông qua giao thức nội bộ.

### 4.2.4 Kiến trúc task trên FreeRTOS

Toàn bộ phần mềm vận hành theo mô hình các task FreeRTOS độc lập. Mỗi handler chính thường được tổ chức dưới dạng một task riêng hoặc một nhóm task liên quan. Cách tiếp cận này giúp phân tách rõ chức năng, tránh tình trạng một vòng lặp lớn thực hiện quá nhiều nghiệp vụ và khó kiểm soát độ trễ.

Đối với WAN-MCU, các task quan trọng bao gồm: task giao tiếp liên MCU, task quản lý kết nối Internet, task giao tiếp server, task xử lý cấu hình, task Web Config Portal, task FOTA, task giao tiếp với App PC và task HMI. Trong đó, các task liên quan đến SPI uplink/downlink được ưu tiên cao nhất vì đây là tuyến trao đổi dữ liệu với LAN-MCU.

Đối với LAN-MCU, các task quan trọng bao gồm: task giao tiếp liên MCU với WAN, task xử lý từng giao thức như Zigbee, LoRa, BLE, RS-485, task monitor module, task config parser/controller, task FOTA phía LAN và các tác vụ benchmark hoặc lưu trữ dữ liệu cục bộ. Cấu trúc này cho phép từng giao thức hoạt động gần như độc lập và có thể bật/tắt theo cấu hình triển khai.

### 4.2.5 Cơ chế giao tiếp nội bộ giữa hai MCU

Giao tiếp giữa LAN-MCU và WAN-MCU được chuẩn hóa bằng một định dạng khung tin thống nhất. Mỗi khung bao gồm các thành phần cơ bản như header, frame type, handler ID, sequence number, độ dài payload, payload và CRC. Cách tổ chức này cho phép cả dữ liệu uplink, lệnh downlink, truy vấn cấu hình, phản hồi thời gian thực và trạng thái ACK/NACK đều đi trên cùng một cơ chế truyền thông, giảm độ phức tạp khi mở rộng giao thức.

| Trường | Kích thước | Ý nghĩa |
|---|---|---|
| Header | 2 byte | Xác định loại khung như DT, CF, DQ, CQ, RT |
| Frame Type | 1 byte | Phân loại chi tiết tác vụ |
| Handler ID | 3 byte | Định danh giao thức đích/nguồn như ZIG, LOR, BLE, RS4 |
| Sequence Number | 2 byte | Phát hiện mất gói hoặc gói lặp |
| Payload Length | 2 byte | Độ dài dữ liệu tải |
| Payload | N byte | Dữ liệu thực tế hoặc JSON config |
| CRC | 2 byte | Kiểm tra toàn vẹn khung tin |

Ở chiều uplink, LAN-MCU đóng vai trò SPI Master, chủ động đẩy dữ liệu sang WAN-MCU. WAN-MCU nhận khung, kiểm tra tính hợp lệ và phản hồi ACK hoặc NACK trong phiên giao tiếp. Ở chiều downlink, thay vì để LAN-MCU phải liên tục polling, WAN-MCU sử dụng một chân GPIO handshake để thông báo có dữ liệu chờ. Khi phát hiện ngắt, LAN-MCU mới chủ động mở phiên SPI để lấy lệnh. Cơ chế event-driven này làm giảm overhead CPU, giải phóng thời gian xử lý cho các task giao thức và cải thiện độ phản hồi của toàn hệ thống.

Nhìn tổng thể, kiến trúc firmware/software tổng thể của hệ thống là một kiến trúc phân miền chức năng, phân lớp rõ ràng và cấu hình hóa cao. Đây là nền tảng cho các phần trình bày chi tiết ở các mục tiếp theo.

---

## 4.3 Thiết kế WAN-MCU firmware

WAN-MCU là thành phần đóng vai trò điều phối trung tâm trong kiến trúc phần mềm của gateway. Đây là nơi tập trung các tác vụ liên quan đến kết nối Internet, giao tiếp Cloud, quản lý cấu hình, điều phối cập nhật firmware và tương tác với người dùng. Nếu coi toàn bộ gateway là một hệ thống phân tán thu nhỏ, thì WAN-MCU chính là control plane của hệ thống đó.

### 4.3.1 Vai trò tổng quát của WAN-MCU

Firmware phía WAN-MCU được thiết kế để thực hiện năm nhóm chức năng chính:

1. Thiết lập và duy trì kết nối Internet qua nhiều giao diện vật lý.
2. Giao tiếp với server hoặc nền tảng Cloud qua nhiều giao thức ứng dụng.
3. Tiếp nhận, lưu trữ và áp dụng cấu hình hệ thống từ người dùng hoặc từ server.
4. Điều phối dữ liệu và lệnh giữa Cloud với LAN-MCU.
5. Tổ chức quy trình cập nhật firmware và các dịch vụ quản trị khác.

Với phạm vi trách nhiệm như vậy, firmware WAN-MCU được tổ chức theo hướng module hóa trong Application Layer, còn các giao thức nền và thư viện của ESP-IDF được đặt ở Middleware Layer. Dưới cùng là các khối BSP và driver phục vụ truy cập phần cứng.

### 4.3.2 Application Layer của WAN-MCU

Ở tầng Application, WAN-MCU bao gồm các khối chức năng chính sau.

#### Main Control

Đây là khối điều phối trạng thái tổng thể của gateway. Main Control chịu trách nhiệm theo dõi trạng thái khởi động, trạng thái mạng, trạng thái cấu hình, trạng thái FOTA và các mode vận hành đặc biệt. Trong các tình huống như vừa khởi động xong, mất kết nối mạng, đổi kênh Internet, chuyển sang AP mode hay bắt đầu cập nhật firmware, Main Control là thành phần chịu trách nhiệm phát tín hiệu thay đổi trạng thái tới các khối còn lại.

#### Internet Communication Handler

Khối này quản lý các kết nối mạng diện rộng thông qua ba giao diện: Wi-Fi, Ethernet và LTE. Về bản chất, đây không phải là một handler đơn lẻ mà là một nhóm handler con cho từng giao diện vật lý.

Đối với Wi-Fi, firmware hỗ trợ cả các kịch bản kết nối Personal và Enterprise. Với Ethernet, hệ thống sử dụng driver cho module W5500 nhằm cung cấp một kênh có dây ổn định cho môi trường công nghiệp. Với LTE, firmware giao tiếp với modem thông qua khối LTE handler và lớp BSP tương ứng, cho phép cấu hình APN, thông số xác thực và cơ chế tự động khôi phục kết nối.

Điểm quan trọng trong thiết kế của Internet Communication Handler là cơ chế Auto-reconnect và Auto-failover theo cấu hình runtime. Firmware sử dụng cặp tham số `internet_type` (primary) và `internet_fallback_type` (fallback), kèm cờ bật/tắt fallback, thay vì một chuỗi ưu tiên cố định cho mọi trường hợp. Internet Monitor Task định kỳ kiểm tra trạng thái online của đường primary; khi primary không đạt điều kiện kết nối và fallback được bật, hệ thống thử chuyển sang đường fallback đã cấu hình. Khi primary phục hồi, hệ thống có thể chuyển ngược lại để đảm bảo đúng chế độ vận hành mong muốn.

#### Server Communication Handler

Khối này chịu trách nhiệm giao tiếp với nền tảng Cloud hoặc server ứng dụng. Khác với nhiều gateway chỉ cố định một giao thức, firmware của đồ án hỗ trợ lựa chọn động giữa ba giao thức MQTT, HTTP và CoAP dựa trên tham số cấu hình `server_type`.

Ở hướng uplink, dữ liệu từ LAN-MCU sau khi đến WAN-MCU sẽ được định tuyến tới handler phù hợp. Nếu chế độ server là MQTT, dữ liệu được publish theo topic đã cấu hình. Nếu chế độ là HTTP, dữ liệu được đóng gói và gửi dưới dạng POST request. Nếu sử dụng CoAP, dữ liệu được gửi qua PUT hoặc các cơ chế phù hợp với tài nguyên đăng ký.

Ở hướng downlink, handler phía server có trách nhiệm nhận lệnh RPC, command hoặc response polling, sau đó chuyển payload sang dạng nội bộ để WAN-MCU có thể quyết định đích xử lý. Những lệnh tác động đến lớp vật lý hoặc module mạng nội bộ sẽ được forward xuống LAN-MCU qua SPI. Những lệnh tác động đến cấu hình hoặc dịch vụ mạng phía WAN sẽ được giữ lại và xử lý trực tiếp trên WAN-MCU.

Các thông số như broker URL, endpoint, port, auth token, TLS/DTLS, timeout và retry policy đều được lưu trong NVS. Nhờ vậy, toàn bộ tầng giao tiếp server có thể được hiệu chỉnh mà không cần biên dịch lại firmware.

#### MCU LAN Communication Handler

Đây là khối giao tiếp với LAN-MCU. Ở góc nhìn WAN, khối này vận hành như SPI slave endpoint tiếp nhận uplink data, đồng thời quản lý downlink queue và cơ chế handshake để chủ động đẩy lệnh xuống LAN-MCU. Đây là một trong những khối quan trọng nhất của toàn bộ firmware phía WAN vì nó là cầu nối duy nhất giữa miền Internet/Cloud và miền Sensing/LAN.

Trong chiều uplink, khi nhận Data Frame từ LAN-MCU, handler kiểm tra tối thiểu các yếu tố như độ dài payload, sequence number và CRC. Sau đó, nó phản hồi ACK hoặc NACK. Trong thực tế triển khai, ACK còn có thể kèm thông tin trạng thái Internet để LAN-MCU biết nên tiếp tục đẩy dữ liệu hay chuyển sang lưu đệm khi WAN đang offline.

Trong chiều downlink, handler nhận lệnh đã được các server handler xử lý sơ bộ, đưa vào queue nội bộ và kích hoạt GPIO handshake. Khi LAN-MCU đọc lệnh thành công và phản hồi ACK, handler cập nhật trạng thái lệnh. Nếu xảy ra timeout hoặc NACK, firmware có thể thực hiện retry có giới hạn.

#### Data Communication Handler

Đây là khối chịu trách nhiệm giao tiếp cấu hình tại chỗ thông qua USB/UART với ứng dụng DATN_config_app trên PC. Khi người dùng kết nối gateway qua cổng USB-C, Data Communication Handler tiếp nhận chuỗi lệnh cấu hình, truy xuất dữ liệu từ NVS, kiểm tra tham số đầu vào, thực hiện lưu cấu hình và trả phản hồi cho ứng dụng cấu hình.

Ở thao tác đọc cấu hình, handler truy xuất toàn bộ các tham số hiện tại của hệ thống, tổ chức chúng dưới dạng key-value để trả về cho ứng dụng. Các trường nhạy cảm như mật khẩu có thể được ẩn hoặc mã hóa khi phản hồi. Ngoài thông số cấu hình, handler còn trả về các thông tin như phiên bản firmware, trạng thái kết nối và các cờ runtime nhằm giúp kỹ thuật viên nắm được tình trạng tức thời của thiết bị.

Ở thao tác ghi cấu hình, handler tiếp nhận lệnh tiêu chuẩn hoặc JSON payload từ ứng dụng PC. Dữ liệu đầu vào được chuẩn hóa về định dạng nội bộ và đưa vào pipeline xử lý thống nhất cùng với các kênh cấu hình khác. Điều này giúp giảm số lượng luồng xử lý riêng biệt và làm cho logic cấu hình trở nên nhất quán hơn.

#### Web Config Handler

Web Config Handler là khối cung cấp giao diện cấu hình dựa trên trình duyệt. Ở mode AP, gateway có thể tạo điểm truy cập Wi-Fi để người dùng kết nối trực tiếp và cấu hình ban đầu mà không cần cáp USB. Ở mode STA hoặc khi đang kết nối mạng cục bộ, gateway có thể cung cấp cổng web để cấu hình và giám sát nội bộ.

Khối này thường cung cấp các API đọc cấu hình, ghi cấu hình, đọc trạng thái hệ thống, đọc log, yêu cầu khởi động lại hoặc yêu cầu bắt đầu FOTA. So với cấu hình qua UART, Web Config Portal có lợi thế ở tính trực quan và mức độ thân thiện với người dùng không chuyên sâu kỹ thuật.

#### FOTA Handler

FOTA Handler chịu trách nhiệm điều phối quá trình cập nhật firmware từ xa cho cả hai MCU. Khối này không chỉ tải firmware cho chính WAN-MCU mà còn là đầu mối khởi tạo quy trình cập nhật cho LAN-MCU. Phần chi tiết hơn của cơ chế này được trình bày ở mục 4.6, nhưng ở góc nhìn kiến trúc firmware WAN, đây là một thành phần ứng dụng cốt lõi vì nó điều khiển chuyển mode hệ thống, bật AP mode cho LAN-MCU dùng, và chịu trách nhiệm báo cáo trạng thái cập nhật lên server.

#### HMI Task

HMI Task cập nhật trạng thái hệ thống lên giao diện người dùng cục bộ, ví dụ màn hình TFT hoặc các thành phần hiển thị tích hợp. Mặc dù không phải khối cốt lõi của pipeline dữ liệu, đây là thành phần quan trọng về mặt vận hành vì nó giúp kỹ thuật viên theo dõi nhanh trạng thái Internet, trạng thái module, tình trạng server hoặc các cảnh báo lỗi mà không cần dùng đến máy tính cấu hình.

### 4.3.3 Middleware, BSP và Driver phía WAN

Phía dưới Application Layer, WAN-MCU tận dụng các thành phần middleware của ESP-IDF như MQTT, HTTP, CoAP, OTA, Wi-Fi/Ethernet stack và FreeRTOS. Đây là lớp tạo nền cho các handler ứng dụng, giúp giảm tải công việc hiện thực các giao thức mức thấp.

Ở tầng BSP, firmware tập hợp các phần truy cập phần cứng thành những khối gần nghiệp vụ hơn, như quản lý modem LTE, quản lý Ethernet, khối truyền thông liên MCU, RTC hoặc stack handler. Nhờ đó, Application Layer không cần trực tiếp thao tác lên UART, SPI hay GPIO ở mức driver.

Ở tầng Driver, các ngoại vi cơ bản như UART, SPI, USB, I2C, MAC, GPIO và Wi-Fi driver được sử dụng như lớp nền tảng. Phân lớp này bảo đảm firmware có thể giữ được tính rõ ràng ngay cả khi số lượng giao thức và ngoại vi tăng lên trong các phiên bản sau.

### 4.3.4 Đánh giá thiết kế WAN-MCU firmware

Các sơ đồ liên quan trong file HTML: Hình 4.3, Hình 4.4, Hình 4.5, Hình 4.6.

Thiết kế firmware WAN-MCU cho thấy định hướng rõ ràng: gom toàn bộ các chức năng nặng về điều phối, mạng diện rộng và quản trị hệ thống về một đầu mối duy nhất. Cách tổ chức này giúp logic hệ thống mạch lạc hơn, đồng thời tạo thuận lợi cho việc tích hợp thêm dịch vụ Cloud hoặc thêm cơ chế cấu hình mới ở các phiên bản tiếp theo mà không làm tăng độ phức tạp của phần firmware phía LAN.

---

## 4.4 Thiết kế LAN-MCU firmware

Nếu WAN-MCU là khối điều phối dịch vụ mạng và cấu hình cấp cao, thì LAN-MCU là khối xử lý gần nguồn dữ liệu. Thiết kế firmware phía LAN-MCU tập trung vào mục tiêu đảm bảo tính thời gian thực trong giao tiếp với thiết bị đầu cuối, cho phép vận hành song song nhiều giao thức và duy trì khả năng thích ứng khi thay đổi module phần cứng.

### 4.4.1 Vai trò tổng quát của LAN-MCU

LAN-MCU chịu trách nhiệm cho hai miền chức năng chính: Sensing Domain và LAN Network Domain. Ở đây, firmware phải thực hiện các công việc có tính chất cường độ cao và gần với lớp vật lý, bao gồm:

- Giao tiếp với các module LoRa, Zigbee, BLE, RS-485 và các stack khác.
- Thu thập dữ liệu từ thiết bị đầu cuối thông qua các giao diện vật lý tương ứng.
- Kiểm tra định dạng, checksum và loại bỏ khung lỗi.
- Gắn nhãn nguồn dữ liệu, thời điểm nhận hoặc các metadata cần thiết.
- Chuẩn hóa dữ liệu về định dạng khung nội bộ.
- Đẩy dữ liệu sang WAN-MCU theo batch hoặc theo sự kiện.
- Nhận lệnh từ WAN-MCU và thực thi xuống module vật lý.

Thiết kế này thể hiện rõ triết lý near-sensor processing: xử lý những gì có thể ngay gần nguồn dữ liệu để giảm tải cho MCU phía trên và tránh đưa dữ liệu thô, không kiểm soát, sang phần gateway diện rộng.

### 4.4.2 Application Layer của LAN-MCU

#### Main Control

Tương tự phía WAN, phía LAN cũng cần một khối điều phối tổng thể để quản lý trạng thái khởi động, trạng thái module, trạng thái cấu hình đang áp dụng, trạng thái đồng bộ với WAN-MCU và các mode hoạt động như normal mode, offline mode hay FOTA mode.

#### MCU WAN Handler

Đây là khối giao tiếp nội bộ với WAN-MCU. Ở phía LAN, handler này vận hành như SPI master endpoint. Trong chiều uplink, nó nhận dữ liệu đầu ra từ các handler giao thức khác, gom và đóng gói thành các Data Frame rồi gửi lên WAN-MCU. Trong chiều downlink, nó phản ứng với tín hiệu GPIO handshake từ WAN-MCU, thực hiện phiên SPI để đọc gói lệnh, xác thực khung và chuyển lệnh đến đúng handler đích.

Một chi tiết quan trọng trong thiết kế là chu kỳ batch truyền dữ liệu. Thay vì mở một phiên giao tiếp mới cho từng gói nhỏ, dữ liệu có thể được gom theo chu kỳ ngắn, ví dụ 10 ms, để tận dụng hiệu quả băng thông của kênh truyền liên MCU. Điều này đặc biệt quan trọng khi hệ thống đồng thời nhận dữ liệu từ nhiều giao thức LAN.

#### Các protocol handler

Tầng Application phía LAN được chia thành các handler task theo từng giao thức. Mỗi handler hoạt động như một FreeRTOS task độc lập, có đầu vào là luồng dữ liệu từ module vật lý và đầu ra là dữ liệu đã chuẩn hóa đưa sang MCU WAN hoặc phản hồi kết quả thực thi lệnh.

##### LoRa Handler Task

LoRa Handler phụ trách giao tiếp với module Wio-E5 ở chế độ P2P/TEST. Handler này gửi và nhận chuỗi AT, kiểm tra các phản hồi như TX DONE hoặc dữ liệu nhận được, tách phần payload có ích và đóng gói dữ liệu về định dạng nội bộ của gateway. Do giao thức LoRa bị giới hạn bởi time-on-air, handler cần được thiết kế để không block toàn bộ hệ thống khi chờ phản hồi từ module.

##### Zigbee Handler Task

Zigbee Handler giao tiếp với module E180-ZG120B và chịu trách nhiệm thu thập dữ liệu từ mạng Zigbee. Handler này phải xử lý framing đặc thù của module, bóc tách payload ứng dụng, kiểm tra tính hợp lệ của khung nhận được và gắn nhãn nguồn dữ liệu trước khi đưa sang pipeline nội bộ.

##### BLE Handler Task

BLE Handler là một khối đặc biệt vì hệ thống hỗ trợ cả hai hướng triển khai: BLE dựa trên AT module và BLE native/GATT trên nền tảng ESP32-S3. Đối với chế độ dùng AT module, handler hoạt động tương tự Zigbee/LoRa. Đối với chế độ native, handler cần quản lý sự kiện kết nối, dịch vụ GATT, characteristic hoặc các thành phần mesh/provisioning tương ứng. Đây là một ví dụ điển hình cho nhu cầu phải có kiến trúc module hóa và khả năng cấu hình động.

##### RS-485 Handler Task

RS-485 Handler phụ trách giao tiếp với các thiết bị công nghiệp qua đường truyền half-duplex. Handler này phải quản lý chặt chẽ việc chuyển hướng truyền/nhận, thời gian chờ, framing của giao thức sử dụng, và các cơ chế timeout để tránh treo tác vụ khi đường truyền gặp lỗi.

### 4.4.3 Chức năng chung của các handler phía LAN

Mặc dù mỗi giao thức có cơ chế truyền thông riêng, các protocol handler ở phía LAN được thiết kế theo một mẫu xử lý chung. Cụ thể, một handler tiêu biểu phải thực hiện lần lượt các bước sau:

1. Đọc dữ liệu thô từ module vật lý qua UART, SPI, BLE event hoặc giao diện tương ứng.
2. Kiểm tra tính hợp lệ của khung dữ liệu, bao gồm định dạng, checksum, độ dài hoặc chuỗi phản hồi tiêu chuẩn.
3. Loại bỏ các khung lỗi hoặc các gói tin không hợp lệ.
4. Gắn thêm metadata nội bộ như nguồn giao thức, thời điểm nhận, loại handler và các thông tin cần thiết cho pipeline sau.
5. Chuẩn hóa dữ liệu về cấu trúc khung nội bộ thống nhất.
6. Đưa dữ liệu vào hàng đợi để MCU WAN Handler đóng gói và truyền lên WAN-MCU.

Thiết kế theo mẫu chung này là tiền đề để mở rộng thêm các protocol handler mới trong tương lai mà không cần thay đổi triết lý vận hành tổng thể của hệ thống.

### 4.4.4 Module Monitor Task

Module Monitor Task là một thành phần quan trọng ở phía LAN vì hệ thống được định hướng mô-đun hóa. Nhiệm vụ của task này là giám sát trạng thái của từng module gắn vào các khe adapter, phát hiện thay đổi phần cứng, phục hồi cấu hình từ NVS hoặc bộ nhớ runtime và hỗ trợ tái khởi động các handler khi cấu hình thay đổi trong quá trình vận hành.

Ở mức chức năng, Module Monitor Task có thể thực hiện các thao tác như:

- Kiểm tra sự hiện diện của module thông qua tín hiệu SLOTDET.
- Đọc mã định danh phần cứng thông qua các chân DEV_ID hoặc IO Expander.
- Gửi lệnh AT cơ bản để kiểm tra phản hồi sống của module.
- Phát hiện tình huống cấu hình hiện tại không còn khớp với module đang cắm.
- Yêu cầu reload preset JSON hoặc khởi động lại protocol handler tương ứng.

Nhờ task này, hệ thống không chỉ đơn thuần là một firmware cố định cho một cấu hình phần cứng duy nhất mà tiến gần hơn đến một nền tảng gateway có khả năng tự thích nghi khi topology module thay đổi.

### 4.4.5 Middleware, BSP và Driver phía LAN

Ở tầng Middleware, LAN-MCU sử dụng các thành phần như protocol abstraction, JSON parser cho module config, storage handler để lưu dữ liệu tạm vào SD Card, OTA handler cho firmware phía LAN và FreeRTOS kernel để lập lịch các task. Lớp middleware này giúp các handler ứng dụng không cần trực tiếp phụ thuộc vào driver của từng ngoại vi.

Ở tầng BSP, firmware phía LAN đóng gói các kênh giao tiếp với module vật lý như RS-485 communication, SD Card communication, IO Expander hoặc các khối truyền thông UART/SPI/I2C/USB tới module. Tầng này đóng vai trò cầu nối giữa driver thô và logic ứng dụng.

Ở tầng Driver, các driver chuẩn của ESP32-S3 như UART, SPI, I2C, SDIO, GPIO, ADC, USB được dùng để hình thành nền tảng cho toàn bộ firmware phía LAN.

### 4.4.6 Giá trị của thiết kế LAN-MCU firmware

Sơ đồ/hình đính kèm tương ứng trong file HTML: Hình 4.2 và Hình 4.7.

Thiết kế firmware phía LAN thể hiện rõ mục tiêu tách phần “giao tiếp với thế giới vật lý” khỏi phần “dịch vụ mạng diện rộng”. Đây là lựa chọn hợp lý trong bài toán gateway IoT dùng MCU vì nó giúp bảo toàn độ ổn định ở tầng giao thức cảm biến, giảm nguy cơ block chéo giữa các stack, và tạo điều kiện cho hệ thống mở rộng số lượng loại module được hỗ trợ mà không làm sụp đổ cấu trúc chương trình.

---

## 4.5 Cơ chế cấu hình module dựa trên JSON

Một trong những điểm redesign quan trọng nhất của phần mềm là chuyển từ mô hình hard-code thông tin module vào firmware sang mô hình cấu hình module bằng file JSON ở thời gian chạy. Đây là cơ chế được gọi là Module Base Setting.

### 4.5.1 Bài toán của cách tiếp cận hard-code

Trong kiến trúc ban đầu, loại module gắn vào từng khe cắm được xem như một thông tin cố định tại thời điểm biên dịch. Mọi chi tiết như cú pháp lệnh AT, trình tự điều khiển GPIO reset phần cứng, loại giao tiếp vật lý, timeout hay chuỗi phản hồi mong đợi đều được viết trực tiếp vào mã nguồn firmware. Cách tiếp cận này tạo ra một hạn chế cơ bản: chỉ cần thay một loại module khác, kỹ sư phải sửa mã nguồn, biên dịch lại và nạp lại firmware cho thiết bị.

Vấn đề càng trở nên rõ khi khảo sát các module BLE phổ biến. Phần lớn các module đều hỗ trợ những chức năng gần tương đương nhau, chẳng hạn đặt tên thiết bị, quét thiết bị xung quanh, kết nối, ngắt kết nối, reset phần mềm và reset phần cứng. Tuy nhiên, cú pháp lệnh AT của từng nhà sản xuất lại khác nhau đáng kể. Điều này cho thấy chuẩn hóa theo chuỗi lệnh là không khả thi, nhưng chuẩn hóa theo tên chức năng thì hoàn toàn khả thi.

### 4.5.2 Ý tưởng thiết kế Module Base Setting

Ý tưởng cốt lõi của Module Base Setting là đưa toàn bộ kiến thức đặc thù của từng module ra ngoài firmware dưới dạng một file JSON. Khi đó, firmware không cần biết chi tiết module đang dùng là loại nào; nó chỉ cần biết tên chức năng chuẩn hóa cần thực hiện, còn cách hiện thực cụ thể sẽ được tra cứu từ preset JSON đã nạp.

Một preset JSON điển hình sẽ mô tả:

- Loại giao tiếp vật lý của module, ví dụ UART, SPI hoặc I2C.
- Các tham số giao tiếp như baud rate.
- Danh sách các chức năng module hỗ trợ.
- Với mỗi chức năng: tên chuẩn hóa, khuôn mẫu lệnh AT, placeholder tham số, chuỗi điều khiển GPIO trước/sau khi gửi lệnh và timeout phản hồi.

| Thành phần JSON | Ý nghĩa |
|---|---|
| `comm_type` | Xác định loại giao tiếp vật lý |
| `baud_rate` | Tham số UART hoặc giao diện tương ứng |
| `functions[]` | Danh sách chức năng module hỗ trợ |
| `functions[i].name` | Tên chuẩn hóa, ví dụ `MODULE_SCAN` |
| `functions[i].cmd_template` | Khuôn mẫu lệnh, ví dụ `AT+BLESCAN={duration}` |
| `functions[i].pre_gpio` | Trình tự GPIO trước khi gửi lệnh |
| `functions[i].post_gpio` | Trình tự GPIO sau khi gửi lệnh |
| `functions[i].timeout_ms` | Thời gian chờ phản hồi |

Nhờ cơ chế này, logic firmware được tách làm hai phần. Phần thứ nhất là logic bất biến: nhận yêu cầu, phân tích tên chức năng, tra cứu preset và thực thi. Phần thứ hai là tri thức đặc thù của module: cú pháp lệnh, trình tự reset, timeout và tham số. Phần đặc thù được chuyển ra ngoài mã nguồn.

### 4.5.3 Luồng nạp cấu hình module

Quá trình nạp preset JSON vào hệ thống diễn ra theo pipeline như sau. Trước hết, người dùng hoặc server gửi file cấu hình JSON thông qua App Config hoặc Web Config. WAN-MCU tiếp nhận dữ liệu đầu vào, chuẩn hóa về định dạng nội bộ và đóng gói thành Config Frame để chuyển xuống LAN-MCU. LAN-MCU sau đó dùng JSON parser để phân tích nội dung, nạp thông tin vào bộ nhớ runtime hoặc lưu xuống vùng nhớ thích hợp. Cuối cùng, Module Config Controller cập nhật bảng ánh xạ giữa slot phần cứng, handler logic và preset đang được áp dụng.

Sau bước này, hệ thống đã sẵn sàng thực thi lệnh điều khiển module theo đúng thông tin do preset cung cấp mà không cần thay đổi firmware nhị phân.

### 4.5.4 Luồng thực thi lệnh dựa trên JSON

Khi có lệnh điều khiển từ người dùng hoặc server, WAN-MCU đóng gói lệnh và chuyển xuống LAN-MCU. Tại đây, hệ thống nhận diện protocol handler đích thông qua Handler ID hoặc tiền tố lệnh. Sau đó, LAN-MCU tra cứu tên chức năng trong preset JSON đang được áp dụng.

Nếu lệnh là lệnh tĩnh, hệ thống chỉ cần trích xuất nguyên chuỗi lệnh từ preset. Nếu lệnh là lệnh động, firmware sẽ thay thế các placeholder bằng tham số thực từ phía server. Tiếp theo, nếu preset định nghĩa chuỗi thao tác GPIO, LAN-MCU sẽ thực hiện đúng trình tự đó để bảo đảm module ở trạng thái phù hợp trước khi gửi lệnh chính. Sau cùng, lệnh hoàn chỉnh được gửi xuống module vật lý; phản hồi được đọc lại, so sánh với response pattern mong đợi và trả kết quả ngược lên server qua WAN-MCU.

### 4.5.5 Các preset đã chuẩn bị cho giai đoạn kiểm thử

Ở giai đoạn hiện tại, hệ thống đã chuẩn bị sẵn các preset cho một số module tiêu biểu như Zigbee E180-ZG120B, BLE STM32WB55 và LoRa Wio-E5. Ngoài ra, còn có một file ánh xạ stack_id_map dùng để liên kết định danh khe cắm với preset tương ứng. Đây là tiền đề cho việc tổ chức một hệ thống module hóa ở mức phần mềm một cách bài bản hơn.

### 4.5.6 Ý nghĩa của cơ chế JSON đối với toàn hệ thống

Hình đính kèm tương ứng trong file HTML: Hình 4.8 và Hình 4.9.

Cơ chế Module Base Setting giúp gateway tiến gần hơn đến mô hình một bộ dịch giao thức thông minh. Thay vì server hoặc kỹ sư triển khai phải quan tâm đến cú pháp AT thô của từng module, hệ thống chỉ cần làm việc với những tên chức năng chuẩn hóa. Điều này giảm độ phụ thuộc vào nhà sản xuất module, giảm chi phí bảo trì firmware và nâng cao đáng kể khả năng mở rộng của hệ thống. Đây là một bước redesign có giá trị kiến trúc, không chỉ là một thay đổi ở mức kỹ thuật cài đặt.

---

## 4.6 Cơ chế web config, app config và FOTA

Ngoài pipeline dữ liệu chính, hệ thống còn cần các cơ chế phục vụ cấu hình, bảo trì và cập nhật trong quá trình triển khai thực tế. Ba cơ chế quan trọng ở nhóm này là App Config qua USB/UART, Web Config Portal và FOTA.

### 4.6.1 Cấu hình qua App Config trên PC

Đây là phương thức cấu hình truyền thống nhưng vẫn rất cần thiết trong giai đoạn bring-up, bảo trì hiện trường hoặc khi gateway chưa sẵn sàng tạo Web Portal. Người dùng kết nối gateway với máy tính qua cổng USB-C, chạy ứng dụng DATN_config_app và thực hiện các thao tác đọc/ghi cấu hình.

Ở thao tác đọc, ứng dụng gửi lệnh quét; WAN-MCU truy xuất NVS và bộ nhớ runtime để trả lại toàn bộ cấu hình hiện hành dưới dạng key-value. Các thông tin như SSID, auth mode, cấu hình MQTT/HTTP/CoAP, loại kết nối Internet, chu kỳ gửi, phiên bản firmware và trạng thái kết nối đều có thể được trả về. Những trường nhạy cảm như mật khẩu được xử lý theo chính sách an toàn phù hợp.

Ở thao tác ghi, ứng dụng gửi mã lệnh cấu hình và dữ liệu đi kèm. Các mã lệnh tiêu biểu gồm:

| Mã lệnh | Ý nghĩa |
|---|---|
| `WF` | Cấu hình Wi-Fi |
| `MQ` | Cấu hình MQTT |
| `LT` | Cấu hình LTE |
| `IN` | Chọn kiểu kết nối Internet |
| `SV` | Cấu hình loại server |
| `HP` | Cấu hình HTTP |
| `CP` | Cấu hình CoAP |
| `FW` | Cập nhật firmware ngay |
| `FU` | Lưu URL firmware |
| `ML` | Gửi cấu hình module cho LAN-MCU |

Sau khi tiếp nhận dữ liệu, Config Handler kiểm tra tính hợp lệ, lưu cấu hình vào NVS và áp dụng trực tiếp nếu có thể. Với các cấu hình thuộc miền LAN, WAN-MCU sẽ chuyển tiếp gói tin tương ứng sang LAN-MCU qua SPI.

### 4.6.2 Cấu hình qua Web Config Portal

Web Config Portal là phần mở rộng quan trọng của redesign phần mềm vì nó cho phép cấu hình không dây thông qua trình duyệt, giảm phụ thuộc vào công cụ cấu hình cài đặt trên máy tính.

Ở mode AP, WAN-MCU tạo một điểm truy cập Wi-Fi nội bộ. Người dùng kết nối vào mạng này và truy cập giao diện cấu hình qua captive portal hoặc địa chỉ mDNS. Giao diện web có thể cung cấp các chức năng tương đương App Config, bao gồm đọc cấu hình, thay đổi tham số vận hành, kiểm tra trạng thái hệ thống, xem log và gửi yêu cầu khởi động lại hoặc cập nhật firmware.

Ở mode STA hoặc khi gateway đã tham gia vào mạng cục bộ, Web Config Portal còn có thể đóng vai trò một cổng quản trị nội bộ cho việc giám sát và bảo trì. Điều này đặc biệt hữu ích trong những hệ thống cần được quản lý định kỳ nhưng không muốn thao tác trực tiếp qua dây USB.

Một ưu điểm quan trọng của Web Config Portal là mọi dữ liệu cấu hình đầu vào đều được đưa về cùng một pipeline xử lý với App Config. Nhờ đó, hệ thống không hình thành nhiều logic cấu hình rời rạc, giảm đáng kể rủi ro sai khác giữa các phương thức cấu hình.

### 4.6.3 Cơ chế FOTA cho hệ thống Dual-MCU

FOTA là một trong những chức năng quan trọng nhất của gateway vì nó quyết định khả năng bảo trì và nâng cấp hệ thống sau khi triển khai. Với kiến trúc Dual-MCU, FOTA không thể chỉ là một OTA đơn giản cho một firmware duy nhất, mà phải là một quy trình điều phối có kiểm soát giữa hai MCU.

Trong thiết kế hiện tại, quá trình cập nhật được thực hiện theo thứ tự nghiêm ngặt: LAN-MCU cập nhật trước, WAN-MCU cập nhật sau. Lý do của lựa chọn này là WAN-MCU đang giữ vai trò điều phối. Nếu cập nhật WAN-MCU trước, hệ thống có nguy cơ mất đầu mối điều khiển trong khi LAN-MCU chưa được nâng cấp xong.

Quy trình cơ bản diễn ra như sau. Trước hết, server gửi lệnh FOTA kèm thông tin firmware cho cả hai MCU. WAN-MCU phân tích lệnh, chuyển hệ thống vào FOTA mode và gửi thông tin firmware dành cho LAN-MCU xuống qua SPI. Sau đó, WAN-MCU kích hoạt AP mode để tạo một mạng Wi-Fi nội bộ. LAN-MCU kết nối vào mạng này như một STA client và chủ động tải firmware mới qua HTTPS. Sau khi kiểm tra tính toàn vẹn và ghi xong vào bộ nhớ flash, LAN-MCU khởi động lại và gửi tín hiệu đồng bộ thành công cho WAN-MCU. Chỉ khi đó, WAN-MCU mới bắt đầu tự cập nhật firmware của chính mình. Khi toàn bộ quá trình kết thúc, hệ thống gửi báo cáo trạng thái lên server.

Thiết kế này thay thế cho các phương thức kém hiệu quả hơn như cố gắng bridge firmware qua một đường truyền tuần tự chậm. Đồng thời, nó tận dụng đúng vai trò điều phối của WAN-MCU và khả năng truy cập Internet của hệ thống để rút ngắn thời gian cập nhật, tăng độ an toàn và giảm rủi ro lỗi.

### 4.6.4 Giá trị vận hành của nhóm cơ chế cấu hình và cập nhật

Hình đính kèm tương ứng trong file HTML: Hình 4.4, Hình 4.5, Hình 4.6 và Hình 4.10.

Việc cùng tồn tại App Config, Web Config Portal và FOTA tạo ra một chuỗi hỗ trợ hoàn chỉnh cho vòng đời sản phẩm. App Config phù hợp cho bring-up và xử lý lỗi cục bộ. Web Config Portal phù hợp cho triển khai thực địa và vận hành nội bộ không dây. FOTA phù hợp cho bảo trì quy mô lớn sau triển khai. Sự kết hợp này làm cho gateway không chỉ là một thiết bị thu thập và truyền dữ liệu, mà là một nền tảng có khả năng quản trị và bảo trì đầy đủ.

---

## 4.7 Đánh giá giải pháp phần mềm

Sau khi phân tích toàn bộ kiến trúc và các cơ chế vận hành chính, có thể đánh giá giải pháp phần mềm của hệ thống dựa trên năm tiêu chí trọng tâm: tính mô-đun hóa, khả năng cấu hình, độ tin cậy, khả năng tương tác đa giao thức và khả năng mở rộng.

### 4.7.1 Tính mô-đun hóa

Giải pháp phần mềm đạt được mức mô-đun hóa cao nhờ sự kết hợp giữa kiến trúc phân lớp, phân vai Dual-MCU và cơ chế handler độc lập theo từng giao thức. Mỗi giao thức như Zigbee, LoRa, BLE hay RS-485 được đóng gói thành một protocol handler với vòng đời tương đối độc lập. Ở phía WAN, các khối server communication, internet communication, config và FOTA cũng được tổ chức thành các handler có ranh giới trách nhiệm rõ ràng.

Điều này đặc biệt quan trọng đối với một gateway có định hướng mô-đun phần cứng. Khi phần cứng cho phép thay đổi module theo từng khe cắm, phần mềm cũng cần có khả năng tương ứng trong việc bật/tắt, thay thế hoặc nạp lại logic điều khiển module. Thiết kế hiện tại đã đáp ứng tốt yêu cầu này.

### 4.7.2 Khả năng cấu hình

Giải pháp phần mềm không khóa cứng cấu hình ở thời điểm biên dịch mà cho phép thay đổi phần lớn tham số ở runtime. NVS đóng vai trò là vùng lưu trữ bền vững, trong khi App Config và Web Config Portal là hai kênh giao tiếp cấu hình ở mức người dùng. Thêm vào đó, Module Base Setting đưa một lớp cấu hình mới vào hệ thống: cấu hình đặc thù của module phần cứng. Đây là cải tiến có ý nghĩa lớn vì nó làm giảm phụ thuộc vào firmware nhị phân và giúp gateway thích ứng tốt hơn với các biến thể phần cứng khác nhau.

### 4.7.3 Độ tin cậy và ổn định

Độ tin cậy của hệ thống được nâng đỡ bởi nhiều cơ chế kết hợp. Ở tầng giao tiếp liên MCU, ACK/NACK, sequence number và CRC giúp giảm rủi ro mất gói hoặc lỗi dữ liệu khi truyền giữa hai MCU. Ở tầng mạng diện rộng, Auto-reconnect và Auto-failover giúp hệ thống duy trì khả năng online ngay cả khi một giao diện WAN gặp sự cố. Ở tầng lưu trữ dữ liệu, việc có thể kết hợp queue, PSRAM và lưu đệm cục bộ trên microSD giúp hệ thống giảm nguy cơ mất dữ liệu khi Cloud phản hồi chậm hoặc kết nối bị gián đoạn. Ở tầng bảo trì, quy trình FOTA tuần tự và có kiểm soát giúp giảm rủi ro brick thiết bị khi cập nhật firmware.

### 4.7.4 Khả năng tương tác đa giao thức

Một trong những mục tiêu chính của đồ án là xây dựng gateway có thể làm việc với nhiều giao thức LAN và WAN khác nhau. Thiết kế phần mềm hiện tại đã thể hiện rõ năng lực này ở cả hai phía. Ở miền LAN, hệ thống hỗ trợ LoRa, Zigbee, BLE, RS-485 và sẵn sàng mở rộng thêm các giao thức khác thông qua cùng một cơ chế handler. Ở miền WAN, hệ thống hỗ trợ Wi-Fi, Ethernet, LTE và các giao thức ứng dụng MQTT, HTTP, CoAP. Sự linh hoạt này là cơ sở để gateway có thể thích ứng với nhiều kịch bản triển khai thực tế.

### 4.7.5 Khả năng mở rộng

Khả năng mở rộng của hệ thống không chỉ nằm ở việc có thể thêm một protocol handler mới, mà còn nằm ở chỗ kiến trúc hiện tại cho phép thêm thành phần mới mà không phải tái cấu trúc toàn bộ chương trình. Nếu cần tích hợp thêm một loại module RF mới, hệ thống có thể mở rộng bằng preset JSON mới và handler tương ứng. Nếu cần tích hợp thêm một dịch vụ Cloud mới, phần mở rộng chủ yếu tập trung ở phía WAN. Nếu cần thêm một cơ chế cấu hình mới, nó vẫn có thể được đưa về pipeline xử lý cấu hình thống nhất. Đây là dấu hiệu của một kiến trúc phần mềm có nền tảng tốt.

### 4.7.6 Đánh giá định lượng sơ bộ theo các chỉ số vận hành

Ở góc độ vận hành, một số chỉ số được dùng để đánh giá sơ bộ giải pháp phần mềm như sau:

| Tiêu chí | Giá trị/nhận xét |
|---|---|
| Băng thông inter-MCU | Đủ lớn để đóng vai trò xương sống truyền dữ liệu giữa LAN-MCU và WAN-MCU |
| BLE application throughput | Có thể tăng đáng kể khi bật DLE và tăng MTU |
| Zigbee/LoRa application throughput | Thấp hơn nhiều do đặc tính giao thức và đường UART tới module |
| Độ trễ end-to-end | Bị chi phối chủ yếu bởi giao thức truy cập LAN và mạng WAN, không phải bus inter-MCU |
| Tính sẵn sàng mạng | Được cải thiện nhờ Auto-failover giữa Ethernet, Wi-Fi và LTE |
| Khả năng bảo trì | Được cải thiện nhờ Web Config Portal và FOTA |

Mặc dù gateway vẫn chịu các giới hạn tự nhiên của từng giao thức, đặc biệt ở phía Zigbee và LoRa, nhưng kiến trúc phần mềm đã tách được điểm nghẽn giao thức khỏi phần điều phối tổng thể. Đây là một kết quả quan trọng vì nó cho phép hệ thống vận hành ổn định ngay cả khi các giao thức LAN có đặc tính rất khác nhau.

### 4.7.7 Kết luận đánh giá

Tổng hợp lại, giải pháp phần mềm của đồ án đáp ứng tốt các mục tiêu kỹ thuật đã đặt ra. Hệ thống đạt được tính mô-đun hóa, khả năng cấu hình linh hoạt, khả năng tương tác đa giao thức, cơ chế vận hành ổn định và nền tảng mở rộng phù hợp cho các phiên bản tiếp theo. Quan trọng hơn, phần redesign ở cơ chế JSON config, Web Config Portal, Auto-failover và FOTA đã nâng mức trưởng thành của hệ thống từ một prototype có tính chức năng lên gần hơn với một nền tảng gateway có khả năng triển khai thực tế.

---

## Gợi ý sử dụng file này

File markdown này được viết như một bản nội dung hoàn chỉnh cho Chương 4 theo mục lục mới. Khi chuyển sang LaTeX, có thể tiếp tục tách phần này thành các section/subsection tương ứng trong wrapper `chuong_4_phan_mem.tex`, đồng thời tái sử dụng các hình minh họa đã có sẵn như:

- `design_mculanfirmware.jpg`
- `design_mcuwanfirmware.jpg`
- `design_DCH-CT.png`
- `design_wcp.png`
- `design_FOTA.png`
- `design_mbs.png`
- `design_server-to-bulb.png`

Ngoài ra, các bảng và sơ đồ đã dựng trong file HTML `firmware_software_diagrams.html` có thể tiếp tục được dùng làm nền để chọn lọc đưa vào bản LaTeX chính thức theo mức độ chi tiết mong muốn.