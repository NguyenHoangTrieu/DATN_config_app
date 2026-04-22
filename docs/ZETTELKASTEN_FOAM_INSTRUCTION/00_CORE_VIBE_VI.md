# Chương 0 -- Nguyên Tắc Cốt Lõi (The Core Vibe)

Ba quy tắc. Không được thương lượng. Phá vỡ một quy tắc, sự lộn xộn sẽ chiến thắng.

---

## Quy Trình Vibe Coding

```
1. Tạo file PREFIX_Name.md trong thư mục docs/
2. Thêm [[wikilink]] đến một ghi chú liên quan
3. Trở lại terminal của bạn
```

Đó là toàn bộ quy trình. Mọi thứ khác trong cuốn sách này chỉ là sự tinh chỉnh.

---

## Quy tắc 1 -- Không bao giờ dùng thư mục (Never Folder)

Tất cả ghi chú phải nằm **phẳng (flat)** bên trong thư mục `docs/`. Không có thư mục con (subfolders). Không có ngoại lệ.

**Tại sao điều này quan trọng:** Foam phân giải `[[wikilinks]]` bằng tên file. Khoảnh khắc bạn sử dụng thư mục `docs/hardware/mcu/`, mọi liên kết đều phải chứa đường dẫn tương đối. Điều này phá vỡ khả năng duyệt đồ thị, làm phức tạp việc refactor, và tăng thêm gánh nặng nhận thức mà không mang lại thông tin gì. Đặt tên bằng tiền tố (`HW_`, `FW_`, `API_`) cũng đạt được mục đích phân loại giống như thư mục, nhưng không bị phụ thuộc vào đường dẫn.

- `docs/hardware/mcu/uart/` -- sai. Phụ thuộc đường dẫn, khó liên kết.
- `docs/HW_MCU_UART.md` -- đúng. Phẳng, dễ liên kết, dễ grep.

> Cấu trúc phẳng + Đặt tên tiền tố = Điều hướng O(1).

---

## Quy tắc 2 -- Liên kết hoặc chết (Link or Die)

Một ghi chú không có `[[wikilinks]]` là một node mồ côi. Nó sẽ không bao giờ xuất hiện khi duyệt đồ thị, truy vấn backlink, hay tìm kiếm liên kết. Nó là gánh nặng.

**Tại sao điều này quan trọng:** Giá trị của một Zettelkasten tỷ lệ thuận với **mật độ cạnh (edge density)**, chứ không phải số lượng node. Một nghìn ghi chú không liên kết còn tệ hơn năm mươi ghi chú được kết nối tốt. Mỗi liên kết bạn tạo ra là một cạnh hai chiều -- Foam tự động lập chỉ mục cả hai chiều. Các liên kết bị hỏng (chưa tồn tại, ví dụ: `[[FW_Not_Written_Yet]]`) vẫn là những placeholder hợp lệ; chúng báo hiệu kiến thức còn thiếu và sẽ được phân giải khi file đích được tạo.

- Nhắc đến một module, thanh ghi, API, hoặc khái niệm -- **hãy liên kết nó**
- Nếu ghi chú đích chưa tồn tại -- **vẫn cứ liên kết nó**
- Mỗi ghi chú phải có ít nhất **một** `[[wikilink]]` hướng ra ngoài.

> Một ghi chú không có liên kết là một ghi chú không tồn tại.

---

## Quy tắc 3 -- Phần Cứng Là Chân Lý (Hardware is Truth)

Mỗi ghi chú firmware (`FW_`) phải tham chiếu đến một ghi chú phần cứng (`HW_`). Không có driver nào tồn tại độc lập.

**Tại sao điều này quan trọng:** Trong hệ thống nhúng, định nghĩa thanh ghi (register) là một bản hợp đồng. Firmware chỉ là client thực thi bản hợp đồng đó. Khi một ghi chú `FW_` thiếu một node cha `HW_`, bạn làm mất đi sự truy xuất (traceability) giữa những ràng buộc của datasheet và đoạn code thực thi nó. Bug trở nên không thể truy xuất. Các ràng buộc trở nên vô hình. Mô hình hệ thống bị phá vỡ.

- `FW_I2C_Driver` phải liên kết đến `[[HW_MCU_I2C]]`
- `RCA_UART_Overrun` phải truy xuất nguồn gốc đến ràng buộc `[[HW_MCU_UART]]` bị vi phạm
- Nếu chưa có ghi chú `HW_` nào cho driver của bạn -- **hãy tạo ghi chú HW_ trước**

> Các thanh ghi là nguồn chân lý duy nhất. Firmware chỉ là kẻ phục tùng.

---

## Tính Nguyên Tử (Atomicity)

Trước khi lưu bất kỳ ghi chú nào, hãy áp dụng bài kiểm tra xóa (deletion test):

*"Nếu tôi xóa file này, tôi có đánh mất chính xác một mảnh kiến thức duy nhất không?"*

- `HW_MCU_I2C` -- một ngoại vi. Đạt.
- `RCA_SPI_Clock_Polarity` -- một bug. Đạt.
- `I2C_Everything` -- hardware + firmware + bugs. Không đạt. Hãy tách nó ra.

---

## Frontmatter

Mọi ghi chú đều phải có. Không có ngoại lệ.

```yaml
---
type: <note-type>
status: todo | in-progress | done | blocked | deprecated
last_updated: YYYY-MM-DD
---
```

Tags được đặt ở dòng ngay sau tiêu đề (heading):

```markdown
# FW_UART_Driver

Tags: #done #firmware #uart
```

**Tại sao frontmatter quan trọng:** Nó cho phép lọc bằng chương trình. AI agents, script, và truy vấn của Foam có thể phân chia cơ sở tri thức theo `type` và `status` mà không cần phải phân tích cú pháp nội dung text tự do.
