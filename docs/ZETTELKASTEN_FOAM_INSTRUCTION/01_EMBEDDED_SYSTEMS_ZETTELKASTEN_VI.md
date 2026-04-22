# Chương 1 -- Hệ Thống Nhúng (Embedded Systems)

**Phạm vi:** Firmware bare-metal, RTOS, phát triển driver, tài liệu thiết kế PCB, thiết kế phần cứng - phần mềm (hardware-software co-design).

**Điều kiện tiên quyết:** [Chương 0 -- Nguyên Tắc Cốt Lõi](00_CORE_VIBE_VI.md).

---

## Các Lỗi Thực Hành (Anti-Patterns)

Hãy dừng ngay những việc này. Mỗi mục đều làm suy giảm chất lượng cơ sở tri thức của bạn.

- **Một file DOCUMENTATION.md nguyên khối duy nhất** -- không thể tìm kiếm, liên kết, hay điều hướng. Hãy chia nhỏ thành các ghi chú nguyên tử theo từng thực thể.
- **Thư mục quá sâu** `docs/hw/mcu/periph/uart/` -- phá vỡ phân giải wikilink. Hãy dùng dạng phẳng `HW_MCU_UART.md`.
- **Copy-paste toàn bộ nội dung datasheet** -- tạo ra những ghi chú cồng kềnh, khó đọc. Hãy tóm tắt các ràng buộc, tham chiếu đến số mục/chương của datasheet.
- **Ghi chú FW_ không có liên kết HW_** -- firmware không truy vết được phần cứng là firmware không có hợp đồng (contract). Mọi driver đều có một thanh ghi cha.
- **Không có liên kết giữa các ghi chú** -- một ghi chú không liên kết sẽ trở nên vô hình đối với việc duyệt đồ thị. Phải liên kết hoặc xóa đi.
- **Các đoạn văn tự sự dài dòng** -- cả AI agents và con người đều không xử lý văn xuôi hiệu quả. Hãy sử dụng các heading (tiêu đề), bảng biểu, block code.
- **Xóa các ghi chú lỗi thời** -- hãy đánh dấu `status: deprecated`. Lịch sử có giá trị rất lớn để phân tích nguyên nhân gốc rễ (root cause analysis).

---

## Quy Trình Vibe Coding

```
1. Đọc datasheet       -> tạo HW_MCU_Peripheral.md
2. Viết driver         -> tạo FW_Module.md -> liên kết tới [[HW_]]
3. Gặp bug             -> tạo RCA_Bug.md -> liên kết tới [[FW_]] + [[HW_]]
4. Cập nhật INDEX.md
```

Hãy thực hiện điều này ngay lập tức (inline), trong lúc bạn đang chờ build/compile code. Nó chỉ mất 30 giây.

---

## Bản Hợp Đồng Giữa Phần Cứng và Firmware

Đây là nguyên tắc kiến trúc giúp phân biệt Zettelkasten hệ thống nhúng với việc ghi chú chung chung.

**Phần cứng định nghĩa hợp đồng. Firmware thực thi nó.**

Bản đồ thanh ghi (register map) chính là đặc tả giao tiếp (interface specification). Ràng buộc của datasheet chính là điều kiện tiên quyết. Code driver chính là phần triển khai. Mỗi ghi chú `FW_` là một client của ít nhất một ghi chú `HW_`. Mỗi ghi chú `RCA_` truy xuất về một ràng buộc `HW_` đã bị vi phạm hoặc bị hiểu sai.

```
HW_MCU_I2C  <--------- Datasheet Mục 12.3
    |
    | [[constraint - ràng buộc]]
    v
FW_I2C_Driver <-------- firmware/i2c_driver.c
    |
    | [[bug]]
    v
RCA_I2C_ACK_Failure --> truy xuất ngược về ràng buộc timing HW_
    |
    | [[fix applied - đã fix]]
    v
FW_I2C_Driver (updated) + ARCH_I2C_Retry_Strategy
```

**Tại sao điều này quan trọng:** Khi một lỗi xuất hiện 6 tháng sau, ghi chú RCA liên kết trực tiếp tới ràng buộc phần cứng bị vi phạm. Không có chuỗi này, việc debug sẽ bắt đầu từ con số 0 mỗi lần. Có chuỗi này, việc xác định nguyên nhân gốc rễ chỉ là duyệt đồ thị.

---

## Cấu Trúc Dự Án

```
PROJECT_ROOT/
  firmware/              <- Mã nguồn C/C++
  hardware/              <- Sơ đồ nguyên lý, datasheets (chỉ dùng để tham khảo)
  docs/                  <- Zettelkasten (phẳng, không thư mục con)
    INDEX.md
    HW_*.md   FW_*.md   RCA_*.md   PCB_*.md
    ARCH_*.md TOOL_*.md  LOG_*.md   REF_*.md   TEST_*.md
    _templates/
  tests/
```

Tất cả ghi chú Zettelkasten nằm phẳng trong thư mục `docs/`. Thư mục `firmware/` và `hardware/` chứa mã nguồn và file tham khảo, không chứa ghi chú kiến thức.

---

## Màu Sắc Đồ Thị Foam

```jsonc
{
  "foam.graph.style": {
    "node": {
      "HW_*":   { "color": "#e74c3c" },
      "FW_*":   { "color": "#2ecc71" },
      "RCA_*":  { "color": "#f39c12" },
      "ARCH_*": { "color": "#9b59b6" },
      "INDEX":  { "color": "#3498db" }
    }
  }
}
```

Màu sắc mã hóa các layer (tầng). Các node màu đỏ (hardware) luôn phải có các node con màu xanh lá (firmware). Các node màu cam (bugs) luôn phải có cạnh nối đến cả hai node này.

---

## Các Loại Ghi Chú (Note Types)

- **`HW_`** -- Phần cứng (Hardware). Các ngoại vi, thanh ghi, cấu hình chân (pin config), ràng buộc điện. Một ghi chú cho một ngoại vi hoặc khối chức năng. Ví dụ: `HW_MCU_I2C.md`
- **`FW_`** -- Firmware. Các module driver, API surface, trình tự khởi tạo, logic ngắt (ISR). Bắt buộc phải liên kết đến node `HW_` cha của nó. Ví dụ: `FW_I2C_Driver.md`
- **`RCA_`** -- Phân Tích Nguyên Nhân Gốc Rễ (Root Cause Analysis). Một bug, một ghi chú. Liên kết đến module `FW_` bị ảnh hưởng và ràng buộc `HW_` bị vi phạm. Ví dụ: `RCA_I2C_ACK_Failure.md`
- **`PCB_`** -- PCB/Schematic. Layout bo mạch, net, đường nguồn (power rail), vị trí linh kiện. Ví dụ: `PCB_PowerSupply_3V3.md`
- **`ARCH_`** -- Quyết Định Kiến Trúc. Lựa chọn thiết kế với các lý do và sự đánh đổi (trade-offs). Ví dụ: `ARCH_RTOS_vs_BareMetal.md`
- **`TOOL_`** -- Công cụ (Toolchain). Trình biên dịch (compiler), trình gỡ lỗi (debugger), hệ thống build, tool nạp code (flash). Ví dụ: `TOOL_CMake_Setup.md`
- **`LOG_`** -- Log Debug. Các ghi chú về phiên làm việc, capture từ oscilloscope, kết quả đo. Ví dụ: `LOG_2026-04-22_UART_Noise.md`
- **`REF_`** -- Tham Khảo. Tóm tắt một phần datasheet, đúc kết các Application Note. Ví dụ: `REF_AN_I2C_PullUp_Calc.md`
- **`TEST_`** -- Kiểm Thử (Test). Kế hoạch test, test suite, ghi chú coverage. Ví dụ: `TEST_I2C_Integration.md`

---

## Các Templates

### HW_ -- Thanh Ghi Phần Cứng / Ngoại Vi

```markdown
# HW_${MCU}_${Peripheral}

Tags: #todo #hardware

${Mô tả ngắn gọn trong 1 dòng}. Driver: [[FW_${Driver}]].

---

## Tổng Quan Ngoại Vi

Địa chỉ cơ sở (Base address): `0x________`. Kênh (Channels): ___.
Clock gate: [[FW_Clock_Driver]] -- bit MSTPCR_ __.

## Bản Đồ Thanh Ghi (Register Map)

| Offset | Register | Function |
|--------|----------|----------|
| 0x00   | REG      | ...      |

## Các Ràng Buộc Quan Trọng (Critical Constraints)

### ${ConstraintName}
${Tham chiếu phần datasheet + yêu cầu của phần cứng (silicon requires)}

## Cấu Hình Chân (Pin Configuration)

| Channel | Pin_A | Pin_B | PSEL |
|---------|-------|-------|------|

## Tham Khảo (References)

${MCU} Hardware Manual, Mục __.
```

**Tại sao cần bảng Register Map trong ghi chú:** Bảng register là hợp đồng API giữa phần cứng và firmware. Ghi nhận nó ở đây có nghĩa là nhà phát triển firmware không cần phải chuyển đổi qua lại file PDF dài 2000 trang. Ghi chú này chính là bộ nhớ đệm (cache) cho việc đó.

---

### FW_ -- Module Firmware

```markdown
# FW_${ModuleName}

Tags: #todo #firmware

${Mô tả ngắn gọn trong 1 dòng}. Files: `${path}`.
Hardware: [[HW_${Peripheral}]]. Bugs: [[RCA_...]].

---

## API

```c
void Module_Init(...);
```

## Trình Tự Khởi Tạo (Init Sequence)

${Các bước kèm code + tham chiếu các thanh ghi HW}

## Chi Tiết Triển Khai Quan Trọng (Key Implementation Details)

${Cách xử lý ISR, thao tác bit thanh ghi, các chuỗi có yêu cầu timing khắt khe}
```

**Tại sao phần `Hardware:` là bắt buộc:** Thiếu phần này, ghi chú firmware bị tách khỏi hợp đồng của nó. Bạn không thể xác minh tính đúng đắn dựa trên đặc tả thanh ghi nếu bạn không thể tìm thấy chúng.

---

### RCA_ -- Phân Tích Nguyên Nhân Gốc Rễ (Root Cause Analysis)

```markdown
# RCA_${BugName}

Tags: #todo #bug #${severity}

${Vấn đề}. Module: [[FW_...]]. Hardware: [[HW_...]].

---

## Triệu Chứng (Symptoms)
- ${Các biểu hiện có thể quan sát}

## Nguyên Nhân Phần Cứng (Hardware Root Cause)
${Ràng buộc nào bị vi phạm, kèm theo tham chiếu datasheet}

## Code (Sai)
```c
/* đoạn code nguyên bản */
```

## Code (Đã Fix)
```c
/* đoạn code đã sửa */
```

## Xác Minh (Verification)
${Làm cách nào để xác nhận -- test, dùng oscilloscope, hoặc logic analyzer}

## Bài Học Rút Ra (Lessons Learned)
- ${Mẫu (Pattern) cần ghi nhớ}
```

---

### ARCH_ -- Quyết Định Kiến Trúc (Architecture Decision)

```markdown
# ARCH_${Decision}

Tags: #todo #architecture

**Status:** proposed | accepted | deprecated
**Date:** YYYY-MM-DD
**Context:** [[FW_...]], [[HW_...]]

---

## Vấn Đề (Problem)
${Tại sao lại cần quyết định này}

## Các Lựa Chọn (Options)
- **A:** ${ưu điểm / nhược điểm (pros/cons)}
- **B:** ${ưu điểm / nhược điểm}

## Quyết Định (Decision)
${Lựa chọn được chọn + lý do (rationale)}

## Hệ Quả (Consequences)
${Ảnh hưởng và những đánh đổi đã chấp nhận}
```

---

## Quy Trình Làm Việc Hàng Ngày (Daily Workflows)

### Khi Thêm Module Mới

```
1. Xem phần Datasheet  -> Ghi chú HW_ (bảng register, các ràng buộc)
2. Viết driver         -> Ghi chú FW_ (API, init, link đến HW_)
3. Gặp lỗi (Bug)       -> Ghi chú RCA_ (link đến FW_ + HW_)
4. Cập nhật INDEX.md
5. Chuyển #todo -> #done
```

### Khi Debug

```
1. Tạo ghi chú LOG_      -> các triệu chứng, quan sát, capture oscilloscope
2. Tìm được root cause   -> Ghi chú RCA_ (link đến ràng buộc HW_ bị vi phạm)
3. Áp dụng fix           -> Cập nhật ghi chú FW_
4. Cập nhật INDEX.md
```

### Khi Refactor

```
1. Xem Foam Graph        -> xác định các node mồ côi (orphan) và quá khổ (oversized)
2. Nodes mồ côi          -> thêm liên kết hoặc xóa đi
3. Ghi chú quá khổ       -> chia nhỏ bằng bài kiểm tra atomicity (tính nguyên tử)
4. Cập nhật các status tag
```

---

## Kỷ Luật Wikilink

Hãy liên kết bất cứ khi nào bạn tham chiếu tới một thực thể có hoặc nên có một ghi chú:

```markdown
Các ràng buộc phần cứng: [[HW_MCU_I2C]]. Bản fix lỗi: [[RCA_I2C_ACK_Failure]].
```

Không dùng:

```markdown
Các ràng buộc phần cứng đã được ghi tài liệu ở nơi khác. Lỗi này đã được fix trước đó.
```

Hình thức thứ hai cung cấp con số 0 cho khả năng điều hướng. Hình thức thứ nhất cung cấp một hướng duyệt hai chiều.

---

## Template INDEX.md

```markdown
---
type: hub
status: done
last_updated: YYYY-MM-DD
---

# ${PROJECT} -- Knowledge Base

Tags: #done #system

> Target: ${MCU} | Board: ${board} | Toolchain: ${toolchain}

## Tầng Hardware (Hardware Layer)
| Note | Covers |
|------|--------|
| [[HW_...]] | ... |

## Tầng Firmware (Firmware Layer)
| Note | Files |
|------|-------|
| [[FW_...]] | `path/` |

## Phân Tích Nguyên Nhân Gốc Rễ (Root Cause Analysis)
| Note | Bug |
|------|-----|
| [[RCA_...]] | ... |

## Kiến Trúc (Architecture)
| Note | Decision |
|------|----------|
| [[ARCH_...]] | ... |
```

Khi một tầng có vượt quá 15 ghi chú, hãy tạo một chỉ mục con (ví dụ: `INDEX_Hardware.md`). Các chỉ mục con (sub-indexes) luôn phải liên kết ngược trở lại `[[INDEX]]`.

---

## Checklist Kiểm Tra

- [ ] Đúng tiền tố chưa?
- [ ] Có Frontmatter chưa (`type`, `status`, `last_updated`)?
- [ ] Tag có nằm ngay dòng đầu tiên sau heading không?
- [ ] Tính nguyên tử -- chính xác một thực thể duy nhất?
- [ ] Có các `[[wikilinks]]` đến ghi chú liên quan không?
- [ ] `FW_` đã liên kết tới `HW_` chưa?
- [ ] INDEX.md đã được cập nhật chưa?
- [ ] Có dùng block code cho giá trị thanh ghi, chữ ký API (signatures), và các sequence chưa?
- [ ] Đã dẫn tham chiếu đến mục trong datasheet chưa?
