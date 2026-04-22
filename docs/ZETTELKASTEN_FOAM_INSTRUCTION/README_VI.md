# Zettelkasten/Foam -- Cuốn Sổ Tay Bỏ Túi (Pocket Mini-Book)

Một cẩm nang kỹ thuật thực chiến để quản lý kiến thức kỹ thuật bằng Foam (Zettelkasten trên VS Code). Bao gồm năm chương. Mỗi chương là một nội dung độc lập. Hãy chọn chương phù hợp với lĩnh vực của bạn.

---

## Tiền Đề Cốt Lõi

Zettelkasten là một đồ thị có hướng, nơi mỗi node là một file Markdown nguyên tử và mỗi cạnh là một `[[wikilink]]`. Kiến thức nằm ở **các cạnh**, không phải ở các node. Đồ thị chính là sản phẩm.

Ba nguyên tắc chi phối mọi thứ:

- **Ghi chú nguyên tử (Atomic notes)** -- một file, một thực thể, một khái niệm
- **Ưu tiên liên kết hơn thư mục (Linking over filing)** -- `[[wikilinks]]` thay thế cho hệ thống thư mục phân cấp
- **Cấu trúc nổi lên tự nhiên (Emergent structure)** -- Các ghi chú trung tâm INDEX sẽ tự hình thành khi đồ thị phát triển; bạn không cần thiết kế chúng từ trước.

---

## Foam

Foam là một extension trên VS Code dùng để triển khai hệ thống này. Nó cung cấp:

- **`[[wikilinks]]`** -- liên kết hai chiều giữa các file `.md`, được phân giải theo tên file
- **Graph View** -- hiển thị trực quan cấu trúc mạng lưới liên kết (topology)
- **Backlinks Panel** -- duyệt các cạnh theo chiều ngược lại cho bất kỳ node nào
- **Daily Notes** -- ghi chép nhật ký theo ngày giờ
- **Templates** -- các cấu trúc ghi chú được định nghĩa sẵn

---

## Các Chương

| # | Chương | Lĩnh Vực |
|---|---------|--------|
| 0 | [Nguyên Tắc Cốt Lõi](00_CORE_VIBE_VI.md) | Ba quy tắc không thể thương lượng. Hãy đọc phần này trước. |
| 1 | [Hệ Thống Nhúng](01_EMBEDDED_SYSTEMS_ZETTELKASTEN_VI.md) | Firmware, driver, RTOS, PCB, thanh ghi |
| 2 | [Phát Triển Phần Mềm](02_SOFTWARE_DEVELOPMENT_ZETTELKASTEN_VI.md) | Web, mobile, backend, DevOps |
| 3 | [Nghiên Cứu và Khoa Học Dữ Liệu](03_RESEARCH_DATA_SCIENCE_ZETTELKASTEN_VI.md) | ML, thực nghiệm, bài báo nghiên cứu |
| 4 | [Học Tập Cá Nhân](04_PERSONAL_LEARNING_ZETTELKASTEN_VI.md) | Ngoại ngữ, kỹ năng, chứng chỉ |

---

## Các Quy Tắc Chung

**Cấu trúc phẳng (Flat structure).** Tất cả ghi chú đều nằm trong một thư mục duy nhất `docs/`. Không có thư mục con. Cách đặt tên bằng tiền tố (`HW_`, `FW_`, `API_`, `VOCAB_`) chính là cơ chế phân loại. Thư mục con sẽ phá vỡ khả năng phân giải wikilink.

**Frontmatter.** Mỗi ghi chú bắt đầu bằng YAML:

```yaml
---
type: <note-type>
status: todo | in-progress | done | blocked | deprecated
last_updated: YYYY-MM-DD
---
```

**Tags.** Đặt ở dòng ngay sau tiêu đề. Máy móc có thể parse được, con người có thể đọc lướt được.

**Liên kết mọi thứ.** Nếu bạn nhắc đến một thực thể đã hoặc nên có ghi chú, hãy tạo một `[[wikilink]]`. Các liên kết hỏng (chưa tồn tại) hoàn toàn hợp lệ -- chúng là những liên kết tham chiếu tới tương lai.

**INDEX.md.** Mỗi dự án có một file này. Nó là điểm vào (entry point) liên kết tới mọi ghi chú theo từng danh mục.

---

## Giao Thức Dành Cho AI Agent

AI agent cũng tuân theo các quy tắc giống như con người:

1. Xác định lĩnh vực -- chọn chương tương ứng
2. Đọc `INDEX.md` trước -- đây là gốc rễ của đồ thị
3. Sử dụng đúng tiền tố và template từ chương đó
4. Thêm `[[wikilinks]]` tới tất cả các ghi chú liên quan -- liên kết chéo giữa các tầng mang lại mật độ thông tin cao nhất
5. Cập nhật `INDEX.md` sau mỗi lần tạo hoặc sửa ghi chú
6. Một ghi chú cho một thực thể -- tính nguyên tử là bắt buộc, không được tuỳ chọn
