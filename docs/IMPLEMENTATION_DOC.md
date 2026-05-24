# Implementation Doc

Trạng thái: file này chỉ dùng để review kế hoạch trước khi chỉnh sửa tài liệu LaTeX. Chưa có thay đổi nào được áp dụng vào báo cáo ngoài việc tạo file plan này.

---

## TASK BREAKDOWN — Lịch trình theo giai đoạn

> Mỗi task được thiết kế nhỏ đủ để chạy trong 1 lần yêu cầu mà không gây overflow context.
> Mỗi task hoàn thành hoàn toàn độc lập, an toàn rollback, và bạn có thể review PDF trung gian sau mỗi task.

### Trạng thái tổng quan

| Task | Tên | Phụ thuộc | Trạng thái |
|------|-----|-----------|------------|
| T0 | Cập nhật nội dung section 6.2–6.5 (firmware/kết nối) | — | ✅ Xong
| T1 | Sửa bìa theo Khoa Điện - Điện tử | T0 | ✅ Xong |
| T2 | Dựng phiếu nhiệm vụ LaTeX | T1 | ✅ Xong |
| T3 | Dọn front matter (bỏ cam đoan, chỉnh cảm ơn) | T2 | ✅ Xong |
| T4 | Tạo wrapper Chương 1 — Giới thiệu | T3 | ⬜ Chưa làm |
| T5 | Tạo wrapper Chương 2 — Lý thuyết | T4 | ⬜ Chưa làm |
| T6 | Tạo wrapper Chương 3 — Thiết kế phần cứng | T5 | ⬜ Chưa làm |
| T7 | Tạo wrapper Chương 4 — Thiết kế phần mềm | T6 | ⬜ Chưa làm |
| T8 | Tạo wrapper Chương 5 — Kết quả thực hiện | T7 | ⬜ Chưa làm |
| T9 | Tạo wrapper Chương 6 — Kiểm thử/Bring-up | T8 | ⬜ Chưa làm |
| T10 | Tạo wrapper Chương 7 — Kết luận | T9 | ⬜ Chưa làm |
| T11 | Cập nhật main.tex và biên dịch kiểm tra | T10 | ⬜ Chưa làm |
| T12 | Xử lý lỗi sau biên dịch (ref, TOC, LOF, LOT) | T11 | ⬜ Chưa làm |

> Trạng thái: ⬜ Chưa làm | 🔄 Đang làm | ✅ Xong | ❌ Bị block

---

### T0 — Cập nhật nội dung section 6.2–6.5 *(task mới, ưu tiên trước)*

**Phạm vi:** cập nhật nội dung 4 section liên quan firmware/kết nối trong chương hiện tại (Triển khai và Vận hành)

**File chạm:**
- `contents/trien_khai_van_hanh/kich_hoat_phan_mem.tex`
- `contents/trien_khai_van_hanh/hieu_suat_van_hanh_ly_thuyet.tex`
- `contents/trien_khai_van_hanh/kich_ban_tuong_tac.tex`
- `contents/trien_khai_van_hanh/ket_qua_trien_khai.tex`

**Preview nội dung mới:** xem phần cuối file này — mục "PREVIEW T0"

---

### T1 — Sửa bìa theo Khoa Điện - Điện tử

**Phạm vi:** chỉ file `contents/cover.tex`

**Đã chốt:**
- Dùng `KHOA ĐIỆN – ĐIỆN TỬ`, không thêm Bộ môn
- GVHD 1: T.S Nguyễn Lý Thiên Trường
- GVHD 2: ThS. Huỳnh Hoàng Kha
- SVTH: Nguyễn Hoàng Triều (MSSV: 2213612)
- Bỏ bảng hội đồng khỏi bìa

**File chạm:** `contents/cover.tex`

---

### T2 — Dựng phiếu nhiệm vụ LaTeX

**Phạm vi:** chỉ file `contents/bang_nhiem_vu.tex`

**Việc cần làm:**
- Dựng lại toàn bộ bảng theo mẫu `PDT-Mau to nhiem vu lvtn.docx` bằng LaTeX thuần
- Điền đầy đủ: Họ tên, MSSV, Ngành, Lớp, Đầu đề khóa luận, các mục Nhiệm vụ, Ngày giao, Ngày hoàn thành, GVHD, ký tên
- Giữ định dạng 2 cột header (ĐHQG và CHXHCN) đặc trưng của mẫu khoa

**File chạm:** `contents/bang_nhiem_vu.tex`

**Điểm chốt:**
- [ ] Bạn muốn điền nội dung nhiệm vụ thật vào (lấy từ file Word DA2), hay để placeholder để điền tay sau?

---

### T3 — Dọn front matter

**Phạm vi:** `main.tex`, `contents/loicamon.tex`

**Việc cần làm:**
- Xóa dòng `\input{contents/loicamdoan.tex}` khỏi `main.tex`
- Sửa `loicamon.tex`: đổi "Nhóm chúng em" → "Em" để phù hợp với báo cáo cá nhân 1 người; cập nhật tên GVHD theo T1; thêm MSSV 2213612 ở phần ký tên cuối

**File chạm:** `main.tex`, `contents/loicamon.tex`

---

### T4 — Wrapper Chương 1: Giới thiệu

**Phạm vi:** tạo file mới, không sửa nội dung gốc

**Việc cần làm:**
- Tạo `contents/chuong_1_gioi_thieu.tex`
- Wrapper này sẽ:
  - Đặt `\chapter{Giới thiệu}` với title mới
  - Tạo section `1.1 Tổng quan` → trỏ nội dung từ `phan_mo_dau.tex` + `tong_quan.tex`
  - Tạo section `1.2 Tình hình nghiên cứu trong và ngoài nước` → trỏ phần 3.3 của `co_so_ly_thuyet.tex` (phần khảo sát sản phẩm thị trường)
  - Tạo section `1.3 Nhiệm vụ luận văn` → trỏ nội dung từ phần mục tiêu/phạm vi trong `phan_mo_dau.tex`
- Cập nhật `main.tex` để thay thế 2 `\input` cũ bằng file wrapper mới này

**File chạm:** tạo mới `contents/chuong_1_gioi_thieu.tex`; sửa `main.tex`

---

### T5 — Wrapper Chương 2: Lý thuyết

**Phạm vi:** tạo file mới, không sửa nội dung gốc

**Việc cần làm:**
- Tạo `contents/chuong_2_ly_thuyet.tex`
- Wrapper này sẽ:
  - Đặt `\chapter{Lý thuyết}`
  - Gộp phần 3.1, 3.2 (IoT gateway) và 3.4 (PCB/PDN) từ `co_so_ly_thuyet.tex`, bỏ 3.3 (đã chuyển lên Chương 1)
  - Renumber section về 2.1 → 2.4 cho khớp mục lục mới
- Cập nhật `main.tex`

**File chạm:** tạo mới `contents/chuong_2_ly_thuyet.tex`; sửa `main.tex`

---

### T6 — Wrapper Chương 3: Thiết kế và thực hiện phần cứng

**Phạm vi:** tạo file mới, không sửa nội dung gốc

**Việc cần làm:**
- Tạo `contents/chuong_3_phan_cung.tex`
- Wrapper này sẽ:
  - Đặt `\chapter{Thiết kế và thực hiện phần cứng}`
  - Trích từ `phan_tich_thiet_ke/`: các section phân tích yêu cầu, giải pháp HW, đặc tả HW, khảo sát HW, thiết kế HW (schematic, layout, SI/PI)
  - Renumber section 3.1–3.7
- Cập nhật `main.tex`

**File chạm:** tạo mới `contents/chuong_3_phan_cung.tex`; sửa `main.tex`

---

### T7 — Wrapper Chương 4: Thiết kế và thực hiện phần mềm

**Phạm vi:** tạo file mới, không sửa nội dung gốc

**Việc cần làm:**
- Tạo `contents/chuong_4_phan_mem.tex`
- Wrapper này sẽ:
  - Đặt `\chapter{Thiết kế và thực hiện phần mềm}`
  - Trích từ `phan_tich_thiet_ke/`: giải pháp SW, kiến trúc firmware, WAN-MCU, LAN-MCU, JSON config, FOTA, đánh giá SW; và phần `phan_tich_va_mo_phong.tex` liên quan SW
  - Renumber section 4.1–4.7
- Cập nhật `main.tex`

**File chạm:** tạo mới `contents/chuong_4_phan_mem.tex`; sửa `main.tex`

---

### T8 — Wrapper Chương 5: Kết quả thực hiện

**Phạm vi:** tạo file mới, không sửa nội dung gốc

**Việc cần làm:**
- Tạo `contents/chuong_5_ket_qua_thuc_hien.tex`
- Wrapper này sẽ:
  - Đặt `\chapter{Kết quả thực hiện}`
  - Section 5.1: giới thiệu ngắn phiên bản cũ + hạn chế (phần đầu `cai_tien_phien_ban/`)
  - Section 5.2–5.4: cải tiến HW, firmware, SW (`cai_tien_phien_ban/*.tex`)
  - Section 5.5–5.9: lắp ráp, kích hoạt SW, kịch bản tương tác, kết quả triển khai, hiệu suất lý thuyết (`trien_khai_van_hanh/*.tex`)
- Cập nhật `main.tex`

**File chạm:** tạo mới `contents/chuong_5_ket_qua_thuc_hien.tex`; sửa `main.tex`

---

### T9 — Wrapper Chương 6: Kiểm thử / Bring-up / Verification

**Phạm vi:** tạo file mới, không sửa nội dung gốc

**Việc cần làm:**
- Tạo `contents/chuong_6_kiem_thu_verification.tex`
- Wrapper này sẽ:
  - Đặt `\chapter{Kịch bản kiểm thử, quy trình Board Bring-up và Verification}`
  - Trỏ toàn bộ `bring_up_verification/*.tex`
  - Renumber section 6.1–6.4
- Cập nhật `main.tex`

**File chạm:** tạo mới `contents/chuong_6_kiem_thu_verification.tex`; sửa `main.tex`

---

### T10 — Wrapper Chương 7: Kết luận và hướng phát triển

**Phạm vi:** tạo file mới, không sửa nội dung gốc

**Việc cần làm:**
- Tạo `contents/chuong_7_ket_luan.tex`
- Wrapper này sẽ:
  - Đặt `\chapter{Kết luận và hướng phát triển}`
  - Trỏ `ket_luan/*.tex`, renumber 7.1–7.3
- Cập nhật `main.tex`

**File chạm:** tạo mới `contents/chuong_7_ket_luan.tex`; sửa `main.tex`

---

### T11 — Cập nhật main.tex và biên dịch kiểm tra

**Phạm vi:** `main.tex` (finalize)

**Việc cần làm:**
- Bảo đảm thứ tự đầy đủ: bìa → phiếu nhiệm vụ → cảm ơn → tóm tắt → TOC → LOT → LOF → C1…C7 → bibliography → phụ lục
- Chạy `make` hoặc `latexmk` và kiểm tra log lần đầu
- Ghi lại danh sách warning/error để xử lý ở T12

**File chạm:** `main.tex`

---

### T12 — Xử lý lỗi sau biên dịch

**Phạm vi:** tùy lỗi thực tế sau T11

**Các lỗi thường gặp sẽ xử lý:**
- Label/ref bị đứt do renumber chương
- `\listoftables` / `\listoffigures` có mục sai chương
- Numbering equation/figure/table bị lệch chương
- Page break xấu hoặc float tràn
- TOC depth không đúng

**File chạm:** xác định sau T11

---

## 1. Mục tiêu cập nhật

Mục tiêu của đợt cập nhật này là tổ chức lại toàn bộ báo cáo LaTeX theo TODO và các mẫu Word của Khoa Điện - Điện tử, nhưng vẫn giữ nguyên nội dung học thuật hiện có ở mức tối đa.

Nguyên tắc thực hiện ở phase tiếp theo:

- Chỉ đổi bố cục, vị trí chương mục, tên chương, front matter và format trình bày.
- Không tự ý viết lại nội dung chuyên môn, số liệu, kết quả, nhận xét nếu TODO không yêu cầu.
- Ưu tiên tái sử dụng các file nội dung đang có bằng cách tạo wrapper chương mới và đổi thứ tự `\input`, thay vì đập đi viết lại.
- Những phần lấy từ Word sẽ được chuyển sang LaTeX theo dạng text/form, không nhúng ảnh scan trừ khi bạn yêu cầu riêng.

## 2. Nguồn tham chiếu đã đối chiếu

- `TODO.md`
- `DA2_Nguyễn Hoàng Triều_2213612.docx`
- `DDT_Mau_Thuyet minh do an tot nghiep_2026May05.docx`
- `PDT-Mau to nhiem vu lvtn.docx`
- `main.tex`
- `main.toc`
- Các file front matter và chapter wrapper hiện có trong `contents/`

## 3. Kết luận rút ra từ TODO và mẫu Word

### 3.1 Các thay đổi bắt buộc

- Thêm biểu mẫu của Khoa Điện vào ngay sau trang bìa/trang giới thiệu.
- Sửa lại bìa theo mẫu Khoa Điện - Điện tử, có tên đề tài, không để danh sách thành viên trên bìa.
- Bỏ `Lời cam đoan` khỏi tài liệu.
- Sửa `Lời cảm ơn` và `Tóm tắt` theo ngữ cảnh cá nhân hóa hơn, đồng thời dời thông tin MSSV/khoa về phần phù hợp theo TODO.
- Tổ chức lại toàn bộ mục lục theo cấu trúc chương mới.
- Gộp/tách chương đúng như TODO nhưng không làm thay đổi bản chất nội dung.

### 3.2 Ràng buộc quan trọng

- TODO ghi rõ: `không được sửa nội dung bất kỳ, chỉ sửa hình thức trình bày như trên`.
- Vì vậy phase thực thi sẽ là một bài toán `restructure + re-title + re-order`, không phải viết lại luận văn.

### 3.3 Lệch giữa mẫu khoa và TODO

Mẫu `DDT_Mau_Thuyet minh do an tot nghiep_2026May05.docx` đang gợi ý cấu trúc 6 chương chính, nhưng TODO của bạn yêu cầu thêm riêng một chương cho:

- `Kịch bản kiểm thử, quy trình board bring-up và verification`

Kế hoạch đề xuất là ưu tiên TODO của bạn, đồng thời vẫn giữ tinh thần trình bày của mẫu khoa.

## 4. Mapping từ cấu trúc hiện tại sang cấu trúc mới

| Nguồn hiện tại | Đích sau cập nhật | Cách xử lý dự kiến |
| --- | --- | --- |
| `contents/cover.tex` | Bìa mới theo Khoa Điện - Điện tử | Viết lại layout bìa theo mẫu Word, giữ tên đề tài, bỏ danh sách thành viên khỏi bìa |
| `contents/bang_nhiem_vu.tex` | Phiếu nhiệm vụ | Chuyển nội dung mẫu `PDT-Mau to nhiem vu lvtn.docx` sang LaTeX |
| `contents/loicamdoan.tex` | Loại khỏi tài liệu | Bỏ khỏi `main.tex`, không biên dịch |
| `contents/loicamon.tex` | Lời cảm ơn mới | Giữ nội dung hiện có, chỉnh lại ngôi xưng và thông tin theo TODO nếu cần |
| `contents/tomtat.tex` | Tóm tắt | Giữ nội dung, chỉ chỉnh bố cục/nhan đề nếu cần |
| `contents/phan_mo_dau.tex` | Chương 1 | Đổi tên và gom vào `Giới thiệu` |
| `contents/tong_quan.tex` | Chương 1 | Gộp vào `Giới thiệu` |
| `co_so_ly_thuyet.tex` mục `3.3` hiện tại | Chương 1 | Chuyển phần khảo sát/tình hình nghiên cứu vào `Giới thiệu` |
| Phần còn lại của `contents/co_so_ly_thuyet.tex` | Chương 2 | Giữ là `Lý thuyết` |
| Phần hardware trong `contents/phan_tich_thiet_ke/phan_tich_thiet_ke.tex` | Chương 3 | Tách thành `Thiết kế và thực hiện phần cứng` |
| Phần software trong `contents/phan_tich_thiet_ke/phan_tich_thiet_ke.tex` | Chương 4 | Tách thành `Thiết kế và thực hiện phần mềm` |
| `contents/cai_tien_phien_ban/*.tex` | Chương 5 | Gộp vào `Kết quả thực hiện` |
| `contents/trien_khai_van_hanh/*.tex` | Chương 5 | Gộp vào `Kết quả thực hiện` |
| `contents/bring_up_verification/*.tex` | Chương 6 | Giữ thành chương kiểm thử/bring-up riêng |
| `contents/ket_luan/*.tex` | Chương 7 | Đổi tên thành `Kết luận và hướng phát triển` |
| `contents/phu_luc.tex` | Phụ lục | Giữ ở cuối tài liệu |

## 5. Mục lục mẫu để review

Đây là mục lục mẫu đề xuất cho bản LaTeX sau khi cập nhật:

```text
TRANG BÌA
PHIẾU NHIỆM VỤ LUẬN VĂN/ĐỒ ÁN TỐT NGHIỆP
LỜI CẢM ƠN
TÓM TẮT
MỤC LỤC
DANH SÁCH BẢNG
DANH SÁCH HÌNH

CHƯƠNG 1: GIỚI THIỆU
1.1 Tổng quan
1.2 Tình hình nghiên cứu trong và ngoài nước
1.3 Nhiệm vụ luận văn

CHƯƠNG 2: LÝ THUYẾT

CHƯƠNG 3: THIẾT KẾ VÀ THỰC HIỆN PHẦN CỨNG

CHƯƠNG 4: THIẾT KẾ VÀ THỰC HIỆN PHẦN MỀM

CHƯƠNG 5: KẾT QUẢ THỰC HIỆN

CHƯƠNG 6: KỊCH BẢN KIỂM THỬ, QUY TRÌNH BOARD BRING-UP VÀ VERIFICATION

CHƯƠNG 7: KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN
7.1 Kết luận
7.2 Hướng phát triển

TÀI LIỆU THAM KHẢO
PHỤ LỤC
```

## 6. Mục lục mẫu chi tiết hơn theo nội dung đang có

```text
TRANG BÌA
PHIẾU NHIỆM VỤ LUẬN VĂN/ĐỒ ÁN TỐT NGHIỆP
LỜI CẢM ƠN
TÓM TẮT
MỤC LỤC
DANH SÁCH BẢNG
DANH SÁCH HÌNH

CHƯƠNG 1: GIỚI THIỆU
1.1 Tổng quan
1.2 Tình hình nghiên cứu trong và ngoài nước
1.3 Nhiệm vụ luận văn

CHƯƠNG 2: LÝ THUYẾT
2.1 Khái niệm Internet vạn vật (IoT)
2.2 Vị trí và vai trò của IoT gateway
2.3 Cơ sở lý thuyết về IoT gateway
2.4 Cơ sở lý thuyết về thiết kế phần cứng

CHƯƠNG 3: THIẾT KẾ VÀ THỰC HIỆN PHẦN CỨNG
3.1 Phân tích yêu cầu phần cứng
3.2 Giải pháp phần cứng đề xuất
3.3 Đặc tả phần cứng hệ thống
3.4 Thiết kế kiến trúc hệ thống phần cứng
3.5 Thiết kế schematic
3.6 Thiết kế layout PCB
3.7 Phân tích SI/PI và mô phỏng phần cứng

CHƯƠNG 4: THIẾT KẾ VÀ THỰC HIỆN PHẦN MỀM
4.1 Giải pháp phần mềm đề xuất
4.2 Kiến trúc firmware/software tổng thể
4.3 Thiết kế WAN-MCU firmware
4.4 Thiết kế LAN-MCU firmware
4.5 Cơ chế cấu hình module dựa trên JSON
4.6 Cơ chế web config, app config và FOTA
4.7 Đánh giá giải pháp phần mềm

CHƯƠNG 5: KẾT QUẢ THỰC HIỆN
5.1 Giới thiệu ngắn về phiên bản cũ và các hạn chế
5.2 Các cải tiến phần cứng ở phiên bản mới
5.3 Các cải tiến firmware
5.4 Các cải tiến software
5.5 Lắp ráp phần cứng
5.6 Kích hoạt phần mềm
5.7 Kịch bản tương tác người dùng
5.8 Kết quả triển khai sản phẩm
5.9 Hiệu suất vận hành lý thuyết

CHƯƠNG 6: KỊCH BẢN KIỂM THỬ, QUY TRÌNH BOARD BRING-UP VÀ VERIFICATION
6.1 Quy trình và kết quả board bring-up
6.2 Quy trình verification phần cứng
6.3 Kiểm thử firmware và software
6.4 Bảng kiểm thử chi tiết

CHƯƠNG 7: KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN
7.1 Tổng kết đồ án
7.2 Thách thức còn tồn tại
7.3 Hướng phát triển

TÀI LIỆU THAM KHẢO
PHỤ LỤC
```

## 7. Cách triển khai kỹ thuật ở phase chỉnh sửa thật

### 7.1 Hướng làm ưu tiên

Hướng làm ưu tiên là tạo các file wrapper mới cho chương 1 đến chương 7, sau đó trỏ về các file con hiện có. Cách này có 3 lợi ích:

- Hạn chế đụng trực tiếp vào nội dung gốc.
- Dễ rollback nếu bạn muốn đổi lại mapping chương.
- Dễ review diff vì thay đổi tập trung ở wrapper và `main.tex`.

### 7.2 Các file dự kiến sẽ chỉnh ở phase sau

- `main.tex`
- `contents/cover.tex`
- `contents/bang_nhiem_vu.tex`
- `contents/loicamon.tex`
- Có thể tạo mới một số file như:
  - `contents/chuong_1_gioi_thieu.tex`
  - `contents/chuong_2_ly_thuyet.tex`
  - `contents/chuong_3_phan_cung.tex`
  - `contents/chuong_4_phan_mem.tex`
  - `contents/chuong_5_ket_qua_thuc_hien.tex`
  - `contents/chuong_6_kiem_thu_verification.tex`
  - `contents/chuong_7_ket_luan_huong_phat_trien.tex`

### 7.3 Các việc cụ thể sẽ làm

1. Sửa `main.tex` để đổi front matter và thứ tự chương.
2. Viết lại `cover.tex` theo mẫu Khoa Điện - Điện tử.
3. Chuyển mẫu phiếu nhiệm vụ Word sang LaTeX trong `bang_nhiem_vu.tex`.
4. Loại `loicamdoan.tex` khỏi luồng biên dịch.
5. Tạo wrapper chương mới để gộp/tách nội dung theo TODO.
6. Chuẩn hóa lại title chapter/section để khớp mục lục mới.
7. Biên dịch kiểm tra và xử lý lỗi tham chiếu, mục lục, list of figures/tables.

## 8. Những điểm cần bạn review trước khi tôi thực thi

Vui lòng xác nhận các điểm sau:

1. Có chốt dùng đúng hệ nhận diện `Khoa Điện - Điện tử` và nếu cần thì thêm `Bộ môn Điện tử` trên bìa không.
2. Có chốt bỏ hoàn toàn `Lời cam đoan` khỏi tài liệu không.
3. Có chốt để `Tài liệu tham khảo` đứng trước `Phụ lục` theo mẫu khoa không.
4. Có chốt chương 5 sẽ gộp cả `cải tiến phiên bản` và `triển khai/vận hành` như đề xuất trên không.
5. Có cần tôi giữ mức mục lục chi tiết như phần `6. Mục lục mẫu chi tiết hơn`, hay chỉ giữ mức chương lớn trước rồi tinh chỉnh sau.

## 9. Kết luận của file plan

Kế hoạch khả thi nhất là:

- đổi front matter theo mẫu khoa,
- bỏ lời cam đoan,
- dựng lại phiếu nhiệm vụ bằng LaTeX,
- tạo cấu trúc chương mới theo TODO,
- giữ nguyên phần thân nội dung và chỉ tái phân bổ vào chương mới.

Nếu bạn duyệt file này, bước tiếp theo tôi sẽ bắt đầu chỉnh trực tiếp LaTeX theo đúng mapping ở trên.

---

## PREVIEW T0 — Nội dung cập nhật cho section 6.2–6.5

> Đây là bản draft LaTeX đề xuất, chỉ để preview. Chưa được ghi vào file báo cáo.
> Những thay đổi so với bản cũ được ghi chú `% [MỚI]` hoặc `% [CẬP NHẬT]`.
> Bạn review, nếu ổn tôi mới apply vào file `.tex` tương ứng.

---

### 6.2 — `kich_hoat_phan_mem.tex` (bản cập nhật)

Những điểm thay đổi so với bản cũ:
- Bổ sung **Ethernet (W5500)** vào danh sách Internet handler.
- Bổ sung **Internet Monitor / Auto-failover** (Wi-Fi → Ethernet → LTE) ở bước kết nối WAN.
- Cập nhật cơ chế **FOTA**: thay "PPP qua UART" bằng "Wi-Fi NAT do WAN-MCU khởi tạo".
- Bổ sung **Web Config Portal** (mDNS, captive portal) như một phương thức cấu hình song song với USB/UART.

```latex
\section{Khởi động và Kích hoạt Phần mềm}
    Sau khi hoàn tất quá trình lắp ráp phần cứng, hệ thống gateway (với kiến trúc Dual-MCU
    gồm ESP32-S3 Master/WAN-MCU và Slave/LAN-MCU) được đưa vào vận hành theo chu trình:
    Khởi động – Nạp cấu hình – Kết nối – Vận hành dịch vụ.

    \subsection{Khởi động hệ thống (Boot \& RTOS Init)}

    Khi được cấp nguồn, WAN-MCU đóng vai trò điều phối chính (Application Master). Vi điều khiển
    này thực hiện khởi tạo các thành phần phần cứng nền tảng (Drivers, BSP) và khởi chạy các tác
    vụ (tasks) trên hệ điều hành FreeRTOS theo mô hình handler chạy song song. Các khối chức năng
    chính được kích hoạt bao gồm:

    \begin{itemize}
        \item \textbf{Main Control:} Điều phối trạng thái hoạt động của toàn hệ thống.
        \item \textbf{Internet Communication Handler:} Quản lý các kết nối mạng (Wi-Fi, Ethernet
              qua W5500, LTE 4G) với cơ chế Internet Monitor tự động chuyển đổi dự phòng
              (Auto-failover) giữa các giao diện theo thứ tự ưu tiên được cấu hình sẵn.
              % [CẬP NHẬT] bổ sung Ethernet W5500 và Auto-failover
        \item \textbf{Server Communication Handler:} Quản lý giao thức tầng ứng dụng (MQTT,
              HTTP/HTTPS, CoAP). % [CẬP NHẬT] bổ sung HTTP/HTTPS và CoAP
        \item \textbf{MCU LAN Communication Handler:} Thiết lập kênh giao tiếp liên vi điều khiển
              (Inter-MCU) với LAN-MCU qua Quad SPI kết hợp GPIO Handshake Event-driven.
              % [CẬP NHẬT] làm rõ cơ chế Event-driven thay Polling
        \item \textbf{FOTA/Bridge Bootloader:} Sẵn sàng cho quy trình cập nhật firmware từ xa.
    \end{itemize}

    \subsection{Nạp và áp dụng cấu hình vận hành (Load/Apply Configuration)}

    Hệ thống truy xuất toàn bộ tham số cấu hình được lưu trữ trong bộ nhớ NVS. Gateway đọc và
    áp dụng các cấu hình này cho các khối Internet/Cloud và đặc biệt là tải các driver tương ứng
    cho các module phần cứng đang được lắp đặt dựa trên file JSON preset theo từng stack module.
    Cơ chế này đảm bảo tính \textbf{modularity} và \textbf{configurability}, cho phép hệ thống
    chỉ khởi chạy các tài nguyên cần thiết theo nhu cầu triển khai thực tế.
    % [CẬP NHẬT] đề cập JSON preset và NVS rõ hơn

    \subsection{Thiết lập kết nối WAN và đồng bộ thời gian}

    Dựa trên cấu hình đã tải, gateway tiến hành thiết lập kết nối Internet theo thứ tự ưu tiên
    được định sẵn. Phiên bản 1.0.0 hỗ trợ ba giao diện WAN:

    \begin{itemize}
        \item \textbf{Wi-Fi:} Hỗ trợ cả hai chế độ bảo mật Personal và Enterprise.
        \item \textbf{Ethernet:} Thông qua driver W5500 được tích hợp trực tiếp vào firmware
              WAN-MCU, cung cấp kết nối có dây ổn định cho môi trường công nghiệp.
              % [MỚI]
        \item \textbf{LTE 4G:} Kết nối dự phòng qua module SIM7600G-H Mini PCIe.
    \end{itemize}

    Cơ chế \textbf{Internet Monitor} giám sát liên tục trạng thái kết nối và tự động chuyển đổi
    sang giao diện dự phòng (Failover) khi phát hiện mất kết nối, đảm bảo tính sẵn sàng cao cho
    hệ thống. % [MỚI]

    Ngay sau khi kết nối mạng thành công, gateway thực hiện giao thức SNTP để đồng bộ thời gian
    thực và cập nhật cho RTC, đảm bảo tính chính xác của nhãn thời gian (timestamp) cho dữ liệu
    log và telemetry.

    \subsection{Kết nối Cloud và vòng lặp vận hành dữ liệu}

    Khi kết nối WAN ổn định, gateway khởi tạo kết nối đến Cloud Server thông qua giao thức được
    cấu hình (MQTT, HTTP/HTTPS hoặc CoAP). Lúc này hệ thống đi vào vòng lặp vận hành chính:
    % [CẬP NHẬT] đa giao thức

    \begin{itemize}
        \item \textbf{Luồng Uplink:} Dữ liệu thu thập từ LAN-MCU được truyền qua kênh Quad SPI
              với cơ chế ACK/NACK, đóng gói và đẩy vào hàng đợi (Publish Queue) trong 8\,MB
              PSRAM để gửi lên broker/server theo cơ chế Exponential Backoff.
        \item \textbf{Luồng Downlink:} WAN-MCU nhận lệnh từ server và kích hoạt GPIO Handshake
              để thông báo tức thì cho LAN-MCU xử lý theo cơ chế Interrupt-driven.
              % [CẬP NHẬT] làm rõ Event-driven Handshake thay Polling
        \item \textbf{Cơ chế bảo vệ:} Internet Monitor duy trì Auto-failover; khi mất kết nối
              kéo dài, Data Storage Handler chuyển sang lưu đệm vào microSD và tự động đồng bộ
              lại khi kết nối được khôi phục.
    \end{itemize}

    \subsection{Kích hoạt cấu hình tại chỗ (Local Configuration)}

    Gateway hỗ trợ hai phương thức cấu hình tại chỗ:

    \begin{itemize}
        \item \textbf{App cấu hình PC qua cổng USB-C:} Kỹ thuật viên kết nối cáp và sử dụng
              ứng dụng DATN\_config\_app để đọc/ghi cấu hình. Các tham số thuộc WAN được WAN-MCU
              lưu NVS và áp dụng ngay; tham số thuộc LAN được chuyển tiếp qua SPI đến LAN-MCU.
        \item \textbf{Web Config Portal:} Gateway khởi tạo điểm truy cập Wi-Fi (AP mode) với
              hỗ trợ mDNS và captive portal, cho phép người dùng truy cập giao diện cấu hình
              trực tiếp qua trình duyệt mà không cần cài đặt phần mềm bổ sung.
              % [MỚI]
    \end{itemize}

    \subsection{Cập nhật Firmware (FOTA)}

    Gateway hỗ trợ quy trình cập nhật firmware an toàn (Safety FOTA). Trong phiên bản 1.0.0,
    LAN-MCU được cập nhật thông qua cơ chế \textbf{Wi-Fi NAT}: WAN-MCU khởi tạo một điểm truy
    cập Wi-Fi (NAT mode), LAN-MCU kết nối vào đó và tải gói firmware trực tiếp, tối ưu băng
    thông so với phương thức PPP qua UART của phiên bản nguyên mẫu. Quy trình bao gồm kiểm tra
    tính toàn vẹn (checksum/signature), cập nhật tuần tự từng MCU và cơ chế khôi phục (rollback)
    nếu quá trình gặp lỗi. % [CẬP NHẬT] Wi-Fi NAT thay PPP/UART
```

---

### 6.3 — `hieu_suat_van_hanh_ly_thuyet.tex` (bản cập nhật)

Những điểm thay đổi so với bản cũ:
- Bổ sung thông tin thông lượng Ethernet (W5500) vào mục WAN throughput.
- Mục giới hạn kết nối: bổ sung các module mới được hỗ trợ (Zigbee, BLE Native/GATT) và giới hạn module LAN.

```latex
\section{Phân tích hiệu năng vận hành lý thuyết}

\subsection{Thông lượng dữ liệu (Data Throughput)}

\subsubsection{Thông lượng truyền thông nội bộ Inter-MCU}
Kênh giao tiếp giữa Master (WAN-MCU) và Slave (LAN-MCU) sử dụng Quad SPI, xung nhịp đồng bộ
lấy theo giới hạn của thiết bị Slave là $f_{\text{clk}} = 60\,\text{MHz}$ \cite{189}.
\begin{itemize}
    \item \textbf{Thông lượng lý thuyết ($T_{\text{raw}}$):}
    $T_{\text{raw}} = 60\,\text{MHz} \times 4 = 240\,\text{Mbps}$ (tương đương $30\,\text{MB/s}$).
    \item \textbf{Hiệu suất thực tế ($\eta$):} Đo đạt $> 10\,\text{Mbps}$ \cite{303}. Hao hụt do:
    \begin{itemize}
        \item Cơ chế GPIO Handshake Event-driven và trễ ngắt ISR trong FreeRTOS \cite{157, 273}.
        \item Overhead khung tin nội bộ (Header, Sequence Number, CRC) \cite{165}.
        \item Cơ chế xác thực ACK/NACK giữa các phiên truyền \cite{168}.
    \end{itemize}
\end{itemize}

\subsubsection{Thông lượng lưu trữ cục bộ (SDIO 4-bit)}
Giao tiếp với thẻ nhớ Micro SD hỗ trợ chuẩn SDIO 4-bit, tần số hoạt động tối đa $80\,\text{MHz}$
\cite{214}.
\begin{itemize}
    \item \textbf{Thông lượng lý thuyết:} $T_{\text{SDIO}} = 80\,\text{MHz} \times 4 = 320\,\text{Mbps}$
    (tương đương $40\,\text{MB/s}$).
    \item \textbf{Hiệu suất thực tế:} Ghi đạt chuẩn Class 10 (tối thiểu $10\,\text{MB/s}$)
    \cite{307}, nhanh hơn gấp 8 lần thông lượng thực tế từ module LAN \cite{334}.
\end{itemize}

\subsubsection{Thông lượng kết nối WAN} % [MỚI - thêm mục này]
Phiên bản 1.0.0 hỗ trợ ba giao diện WAN với thông lượng khác nhau:
\begin{itemize}
    \item \textbf{Wi-Fi 802.11 b/g/n (2.4\,GHz):} Thông lượng lý thuyết đến 150\,Mbps (HT20);
    thực tế phụ thuộc chất lượng RF và tải broker.
    \item \textbf{Ethernet (W5500):} Hỗ trợ 10/100BASE-T, thông lượng tối đa 100\,Mbps,
    phù hợp môi trường công nghiệp yêu cầu kết nối ổn định.
    \item \textbf{LTE 4G (SIM7600G-H):} Thông lượng lý thuyết downlink đến 150\,Mbps,
    uplink đến 50\,Mbps.
\end{itemize}
Cơ chế Internet Monitor và Auto-failover đảm bảo hệ thống tự động chuyển sang giao diện dự phòng
khi kết nối chính bị gián đoạn.

\subsection{Độ trễ hệ thống (End-to-End Latency)}
Độ trễ từ thời điểm cảm biến gửi dữ liệu đến khi gói MQTT được đưa lên Cloud bao gồm:
\begin{itemize}
    \item \textbf{Trễ xử lý tại LAN-MCU:} Thu thập dữ liệu thô, kiểm tra Checksum, chuẩn hóa
    khung tin nội bộ \cite{119, 136}.
    \item \textbf{Trễ truyền dẫn SPI:} Phụ thuộc kích thước Payload và thông lượng thực tế
    $10\,\text{Mbps}$.
    \item \textbf{Trễ mạng WAN:} Phụ thuộc chất lượng kết nối và độ phản hồi MQTT Broker
    \cite{272}. Publish Queue trong 8\,MB PSRAM cách ly trễ mạng khỏi trễ xử lý nội bộ
    \cite{139, 172}.
\end{itemize}

\subsection{Khả năng chịu tải và Giới hạn kết nối}
Dựa trên tài nguyên phần cứng ESP32-S3 (16\,MB Flash, 8\,MB PSRAM):
\begin{itemize}
    \item \textbf{Giới hạn miền Sensing:} Hỗ trợ thu thập đồng thời từ 02 khe cắm LAN. Phiên
    bản 1.0.0 mở rộng hỗ trợ các stack module: LoRa, RS-485, CAN, Zigbee, BLE Native/GATT.
    Các module có thể được thay đổi linh hoạt; firmware LAN-MCU tự động nhận diện và nạp driver
    tương ứng từ NVS khi phát hiện thay đổi phần cứng. % [CẬP NHẬT] bổ sung Zigbee, BLE Native
    \item \textbf{Dung lượng hàng đợi:} Với 8\,MB PSRAM, Gateway lưu trữ tạm thời hàng ngàn
    gói tin telemetry (trung bình $1$–$2\,\text{KB}$) trước khi ghi vào thẻ SD, đảm bảo vận
    hành ổn định khi Broker Cloud phản hồi chậm \cite{122, 172}.
\end{itemize}
```

---

### 6.4 — `kich_ban_tuong_tac.tex` (bản cập nhật)

Những điểm thay đổi so với bản cũ:
- Tách **Web Config Portal** thành kịch bản tương tác riêng (mới hoàn toàn trong v1.0.0).
- Cập nhật mô tả FOTA để phản ánh cơ chế Wi-Fi NAT.

```latex
\section{Kịch bản Tương tác Người dùng}

    Tính tiện dụng của sản phẩm được thể hiện qua khả năng tương tác linh hoạt với các
    module/giao thức và giao diện quản trị trực quan. Người dùng tương tác với hệ thống
    thông qua các kịch bản chính sau:

    \subsection{Cấu hình ban đầu bằng Ứng dụng PC}
    Đây là kịch bản dành cho kỹ thuật viên triển khai tại hiện trường, sử dụng ứng dụng
    DATN\_config\_app trên PC kết nối với gateway qua cổng USB-C. Quy trình thao tác tiêu chuẩn:

    \begin{itemize}
        \item \textbf{Quét và nhận diện:} App tự động phát hiện gateway khi kết nối cáp và xác
              nhận thiết bị sẵn sàng.
        \item \textbf{Đọc cấu hình:} App tải toàn bộ thông số hiện tại từ NVS của gateway.
        \item \textbf{Chỉnh sửa tham số:} Người dùng thao tác trên giao diện dạng biểu mẫu hỗ
              trợ đa giao thức server (MQTT, HTTP/HTTPS, CoAP), đa giao diện Internet (Wi-Fi,
              Ethernet, LTE) và cấu hình module theo JSON preset.
              % [CẬP NHẬT] đa giao thức, JSON preset
        \item \textbf{Ghi cấu hình:} App gửi lệnh xuống gateway; WAN-MCU validate, lưu NVS và
              áp dụng ngay. Tham số thuộc LAN-MCU được chuyển tiếp qua SPI với phản hồi
              ACK/FAIL đồng bộ.
    \end{itemize}

    \subsection{Cấu hình qua Web Config Portal} % [MỚI]
    Phiên bản 1.0.0 bổ sung Web Config Portal chạy trực tiếp trên gateway, đánh dấu bước chuyển
    từ phụ thuộc vào kết nối cổng COM sang mô hình cấu hình không dây qua trình duyệt:

    \begin{itemize}
        \item \textbf{Khởi tạo:} Gateway tạo điểm truy cập Wi-Fi (AP mode) với hỗ trợ mDNS và
              captive portal. Người dùng kết nối vào mạng Wi-Fi này từ bất kỳ thiết bị nào có
              trình duyệt.
        \item \textbf{Truy cập:} Trình duyệt tự động chuyển hướng đến trang cấu hình qua captive
              portal hoặc người dùng truy cập trực tiếp qua địa chỉ mDNS.
        \item \textbf{Cấu hình và giám sát:} Giao diện web hỗ trợ đầy đủ các tham số tương đương
              App PC, đồng thời hiển thị trạng thái vận hành thời gian thực (trạng thái kết nối,
              log, trạng thái module).
    \end{itemize}

    \subsection{Giám sát vận hành qua Giao diện Web (Dashboard/Status)}
    Người quản trị giám sát hoạt động của gateway từ xa thông qua Dashboard trên nền tảng
    Cloud/Web.

    \begin{itemize}
        \item \textbf{Điều kiện bình thường:} Dữ liệu từ sensor node (LAN-MCU) được WAN-MCU đưa
              vào Publish Queue và gửi lên broker/server theo giao thức được cấu hình. Pipeline
              tách biệt luồng "nhận dữ liệu" và "gửi Cloud" tránh nghẽn cổ chai khi mạng chập
              chờn.
        \item \textbf{Xử lý sự cố kết nối:} Internet Monitor tự động kích hoạt Auto-failover
              sang giao diện dự phòng. Khi mất kết nối kéo dài, Data Storage Handler lưu trữ tạm
              vào microSD và tự động đồng bộ lại khi kết nối khôi phục (zero data loss).
              % [CẬP NHẬT] phản ánh Internet Monitor
    \end{itemize}

    \subsection{Bảo trì và Cập nhật từ xa (OTA)}
    Người dùng nâng cấp hoặc vá lỗi cho cả hai MCU thông qua FOTA từ giao diện Web quản trị:

    \begin{itemize}
        \item Tiết kiệm thời gian và chi phí so với nạp code thủ công tại hiện trường.
        \item WAN-MCU được cập nhật trước thông qua kênh OTA từ Cloud. Sau đó, WAN-MCU khởi tạo
              điểm truy cập Wi-Fi (NAT mode) để LAN-MCU tải và cài đặt firmware mới trực tiếp,
              tối ưu băng thông so với cơ chế PPP/UART của phiên bản cũ.
              % [CẬP NHẬT] Wi-Fi NAT thay PPP/UART
        \item Cơ chế an toàn: kiểm tra checksum/signature, cập nhật tuần tự và rollback tự động
              nếu xảy ra lỗi.
    \end{itemize}
```

---

### 6.5 — `ket_qua_trien_khai.tex` (bản cập nhật)

Những điểm thay đổi so với bản cũ:
- Firmware: bổ sung Event-driven Handshake, đa giao thức server.
- Khả năng kết nối: bổ sung Ethernet (W5500), BLE Native/GATT, Zigbee, Web Config Portal.
- Tính khả cấu hình: bổ sung JSON preset và Web Config Portal.

```latex
\section{Kết quả Triển khai sản phẩm}

Dựa trên quá trình triển khai và vận hành thực tế, phần này tổng kết các kết quả đạt được so
với thiết kế ban đầu.

\subsection{Kết quả đạt được so với thiết kế}

Quá trình hiện thực hóa phiên bản 1.0.0 đã bám sát thiết kế từ \autoref{chap:phan_tich_thiet_ke},
cụ thể:

\begin{itemize}
    \item \textbf{Về phần cứng (Hardware):} Đã chế tạo thành công bo mạch chính (Baseboard) với
    cấu trúc PCB 6 lớp, đảm bảo tính toàn vẹn tín hiệu cho các giao tiếp tốc độ cao. Hệ thống
    Dual-MCU (Master-Slave) sử dụng hai vi điều khiển ESP32-S3 vận hành đúng theo thiết kế. Các
    khe cắm mở rộng (WAN, LAN1, LAN2) tương thích hoàn toàn với các Module Adapter, cho phép
    tháo lắp và thay đổi linh hoạt.

    \item \textbf{Về firmware (Firmware):} Hệ thống Firmware dựa trên FreeRTOS đã được triển
    khai phân lớp trên cả hai MCU. Cơ chế giao tiếp Inter-MCU qua Quad SPI kết hợp GPIO
    Handshake Event-driven đạt tốc độ thực tế $>10\,\text{Mbps}$, loại bỏ hoàn toàn overhead
    của cơ chế Polling trong phiên bản nguyên mẫu. WAN-MCU hỗ trợ đa giao thức server (MQTT,
    HTTP/HTTPS, CoAP) và Internet Monitor với Auto-failover giữa Wi-Fi, Ethernet và LTE.
    % [CẬP NHẬT] Event-driven, đa giao thức, Auto-failover

    \item \textbf{Về khả năng kết nối (Connectivity):} Phiên bản 1.0.0 đã kết nối thành công với
    hạ tầng đám mây qua ba giao diện WAN: Wi-Fi, Ethernet (W5500) và LTE 4G. Ở phía Sensing
    Domain, hệ thống xử lý chính xác dữ liệu từ các thiết bị đầu cuối sử dụng các giao thức
    LoRa, RS-485, CAN, Zigbee và BLE Native/GATT thông qua các module adapter tương ứng.
    % [CẬP NHẬT] Ethernet, Zigbee, BLE Native/GATT
\end{itemize}

\subsection{Mục đích đạt được}

Việc triển khai thực tế đã chứng minh hệ thống đạt được các mục tiêu cốt lõi:

\begin{itemize}
    \item \textbf{Tính mô-đun hóa (Modularity):} Hệ thống thích ứng cao với nhiều kịch bản ứng
    dụng chỉ bằng cách thay đổi module adapter. Firmware LAN-MCU tự động nhận diện thay đổi
    phần cứng và nạp driver/cấu hình tương ứng từ NVS mà không cần can thiệp mã nguồn.
    % [CẬP NHẬT] tự động nhận diện module

    \item \textbf{Khả năng cấu hình (Configurability):} Người dùng cấu hình hệ thống qua hai
    phương thức: ứng dụng PC DATN\_config\_app (kết nối USB-C) hỗ trợ JSON preset theo stack
    module, và Web Config Portal trên gateway (Wi-Fi AP + mDNS + captive portal) cho phép cấu
    hình không dây trực tiếp qua trình duyệt. Cả hai phương thức đều không yêu cầu can thiệp vào
    mã nguồn thiết bị. % [CẬP NHẬT] Web Config Portal, JSON preset

    \item \textbf{Độ tin cậy và ổn định:} Hệ thống vượt qua các bài kiểm tra vận hành liên tục.
    Internet Monitor và Auto-failover duy trì kết nối WAN ổn định. Cơ chế Store-and-forward qua
    microSD đảm bảo zero data loss khi mất kết nối Cloud. Safety FOTA với rollback tự động bảo vệ
    hệ thống khỏi lỗi cập nhật firmware.
\end{itemize}
```

---

> **Hướng dẫn review:** Nếu bạn đồng ý với nội dung trên, nhắn "apply T0" và tôi sẽ ghi thẳng vào 4 file `.tex` tương ứng. Nếu cần chỉnh sửa thêm, bạn có thể feedback trực tiếp trên phần này trước khi apply.

