# Chương 3 -- Nghiên Cứu và Khoa Học Dữ Liệu

**Phạm vi:** Nghiên cứu học thuật, machine learning, phân tích dữ liệu, thực nghiệm (experiments), viết báo cáo khoa học, tổng quan tài liệu (literature review).

**Điều kiện tiên quyết:** [Chương 0 -- Nguyên Tắc Cốt Lõi](00_CORE_VIBE_VI.md).

---

## Các Lỗi Thực Hành (Anti-Patterns)

- **Gom tất cả bài báo (papers) vào một file danh sách** -- phá hủy khả năng liên kết. Mỗi bài báo là một node trong đồ thị trích dẫn của bạn. Hãy dùng một ghi chú `LIT_` cho mỗi bài báo.
- **Theo dõi thực nghiệm trên một spreadsheet** -- spreadsheet không thể liên kết đến các khái niệm, model, hay insights. Hãy dùng các ghi chú `EXP_` có wikilinks.
- **Không ghi chép những thực nghiệm thất bại** -- kết quả âm tính (negative results) giúp loại trừ giả thuyết. Đó chính là thông tin. Hãy tạo `EXP_` + `INSIGHT_` cho các thất bại.
- **Copy-paste abstract (tóm tắt) làm ghi chú tài liệu** -- abstract được viết cho các reviewer tạp chí, không phải cho bạn. Hãy viết lại bằng ngôn từ của chính bạn với một sự kết nối rõ ràng tới câu hỏi nghiên cứu của bạn.
- **Không có liên kết giữa các thực nghiệm** -- các thực nghiệm hình thành nên những chuỗi (chains): thực nghiệm này cung cấp thông tin cho thực nghiệm kế tiếp. Nếu không có liên kết, bạn sẽ đánh mất quỹ đạo thực nghiệm của mình.
- **Các khái niệm nằm rải rác trên các ghi chú LIT_** -- một khái niệm (ví dụ: self-attention) có thể xuất hiện trong hàng chục bài báo. Nó xứng đáng có một ghi chú `CONCEPT_` riêng biệt để mọi ghi chú `LIT_` đều có thể liên kết đến.

---

## Quy Trình Vibe Coding

```
1. Đọc một bài báo     -> tạo LIT_Author2024_Title.md -> liên kết [[CONCEPT_]]
2. Chạy thực nghiệm    -> tạo EXP_Name.md -> liên kết [[MODEL_]], [[DATA_]]
3. Thu được kết quả    -> tạo RESULT_Finding.md -> liên kết [[EXP_]]
4. Diễn giải kết quả   -> tạo INSIGHT_Name.md -> liên kết [[RESULT_]]
5. Cập nhật INDEX.md
```

---

## Tại Sao Dùng Zettelkasten Cho Nghiên Cứu

**Đồ thị trích dẫn như một cấu trúc có thể duyệt (Citation graph as a navigable structure).** Bài báo A trích dẫn bài báo B; cả hai cùng khởi tạo Khái niệm C; Khái niệm C được kiểm thử bằng Thực nghiệm D. Những mối quan hệ này tồn tại một cách ngầm định trong quá trình đọc của bạn. Wikilinks biến chúng thành rõ ràng, hai chiều, và có thể duyệt (traversable).

**Tính liên tục của chuỗi thực nghiệm (Experiment chain continuity).** Quá trình nghiên cứu mang tính lặp (iterative): Giả thuyết, Thực nghiệm, Kết quả, Insight, và Giả thuyết tiếp theo. Mỗi bước là một ghi chú. Chuỗi này là một danh sách liên kết. Bạn có thể duyệt theo chiều tiến (mình đã thử gì tiếp theo?) hoặc chiều lùi (điều gì đã thúc đẩy thực nghiệm này?).

**Viết báo cáo học thuật bằng cách duyệt đồ thị.** Khi soạn thảo, hãy men theo các chuỗi `QUESTION_ -> EXP_ -> RESULT_` để xây dựng cốt truyện (narrative). Hãy men theo các chuỗi `LIT_ -> CONCEPT_` cho phần công việc liên quan (related work). Mỗi ghi chú là một ứng viên tiềm năng cho một đoạn văn. Dàn ý của bài báo chính là topology của đồ thị.

---

## Cấu Trúc Dự Án

```
PROJECT_ROOT/
  docs/                    <- Zettelkasten (phẳng, không thư mục con)
    INDEX.md
    LIT_*.md      CONCEPT_*.md   METHOD_*.md
    DATA_*.md     EXP_*.md       RESULT_*.md
    MODEL_*.md    METRIC_*.md    INSIGHT_*.md
    QUESTION_*.md TOOL_*.md      LOG_*.md
    _templates/
  notebooks/   data/   models/   src/   papers/
```

---

## Màu Sắc Đồ Thị Foam

```jsonc
{
  "foam.graph.style": {
    "node": {
      "LIT_*":     { "color": "#3498db" },
      "CONCEPT_*": { "color": "#9b59b6" },
      "EXP_*":     { "color": "#2ecc71" },
      "RESULT_*":  { "color": "#e74c3c" },
      "MODEL_*":   { "color": "#e67e22" },
      "DATA_*":    { "color": "#1abc9c" },
      "INDEX":     { "color": "#f1c40f" }
    }
  }
}
```

---

## Các Loại Ghi Chú (Note Types)

- **`LIT_`** -- Tài liệu học thuật (Literature). Một bài báo, được tóm tắt bằng ngôn từ của riêng bạn. Ví dụ: `LIT_Vaswani2017_Attention.md`
- **`CONCEPT_`** -- Khái niệm (Concept). Thuật toán, lý thuyết, kỹ thuật. Được chia sẻ xuyên suốt qua nhiều bài báo. Ví dụ: `CONCEPT_Self_Attention.md`
- **`METHOD_`** -- Phương pháp (Methodology). Phương pháp nghiên cứu, pipeline đánh giá. Ví dụ: `METHOD_Cross_Validation.md`
- **`DATA_`** -- Tập dữ liệu (Dataset). Schema, cách chia (splits), tiền xử lý, các vấn đề đã biết. Ví dụ: `DATA_ImageNet_2012.md`
- **`EXP_`** -- Thực nghiệm (Experiment). Một đợt chạy (single run) kèm đầy đủ thông tin để tái hiện (reproducibility). Ví dụ: `EXP_ResNet50_LR_Sweep.md`
- **`RESULT_`** -- Kết quả. Một phát hiện định lượng từ một thực nghiệm. Ví dụ: `RESULT_LR_0001_Best_F1.md`
- **`MODEL_`** -- Mô hình (Model). Định nghĩa kiến trúc, siêu tham số (hyperparameters), cấu hình huấn luyện. Ví dụ: `MODEL_ResNet50_Pretrained.md`
- **`METRIC_`** -- Chỉ số đánh giá (Metric). Định nghĩa và cách diễn giải chỉ số đánh giá. Ví dụ: `METRIC_F1_Score.md`
- **`INSIGHT_`** -- Insight. Diễn giải (interpretation) kết quả, những gợi ý (implications) cho các bước tiếp theo. Ví dụ: `INSIGHT_Dropout_Overfitting.md`
- **`QUESTION_`** -- Câu Hỏi Nghiên Cứu. Giả thuyết cần kiểm thử. Ví dụ: `QUESTION_BN_Small_Data.md`
- **`TOOL_`** -- Công cụ. Thư viện, framework, infrastructure. Ví dụ: `TOOL_PyTorch_Lightning.md`
- **`LOG_`** -- Nhật Ký (Daily Log). Mục nhật ký nghiên cứu. Ví dụ: `LOG_2026-04-22.md`

---

## Chuỗi Tri Thức Nghiên Cứu

Mỗi dự án nghiên cứu đều có một lộ trình thực thi cốt lõi. Đây là topology liên kết mà bạn đang xây dựng:

```
QUESTION -> EXP -> RESULT -> INSIGHT
    |         |       |         |
   LIT  <-> CONCEPT <-> METHOD <-> MODEL
                         |
                       DATA
```

**Tại sao topology này quan trọng:** Khi viết bài báo khoa học, chuỗi `QUESTION -> EXP -> RESULT -> INSIGHT` chính là phần Results (Kết quả) của bạn. Những cạnh nối `LIT -> CONCEPT` chính là phần Related Work (Các nghiên cứu liên quan). Cụm `METHOD <-> MODEL <-> DATA` là phần Methodology (Phương pháp luận) của bạn. Đồ thị CHÍNH LÀ cấu trúc của bài báo.

---

## Các Templates

### LIT_ -- Ghi Chú Tài Liệu (Literature Note)

```markdown
# LIT_${Author}${Year}_${ShortTitle}

Tags: #todo #literature #${topic}

---

## Siêu Dữ Liệu (Metadata)

| Title | Authors | Year | Venue | DOI/URL |
|-------|---------|------|-------|---------|

## Tóm Tắt (Summary)

${Đóng góp chính được viết bằng NGÔN TỪ CỦA BẠN. Không phải sao chép abstract.}

## Các Kết Quả Chính (Key Results)

| Metric | Dataset | Value | Baseline |
|--------|---------|-------|----------|

## Mức Độ Liên Quan (Relevance)

${Bài này kết nối với câu hỏi nghiên cứu CỦA BẠN như thế nào}
Links: [[QUESTION_...]], [[EXP_...]]

## Các Tham Khảo Nên Đọc Tiếp (References to Follow)
- [[LIT_...]] -- ${tại sao}
```

**Tại sao "ngôn từ của bạn" lại quan trọng:** Việc diễn giải lại bắt buộc bạn phải hiểu bài báo. Nếu bạn không thể trình bày lại đóng góp chính trong một đoạn văn, có nghĩa là bạn chưa hiểu bài đó.

---

### EXP_ -- Thực Nghiệm (Experiment)

```markdown
# EXP_${Name}

Tags: #todo #experiment #${topic}

---

## Giả Thuyết (Hypothesis)

${Bạn đang kiểm thử điều gì}. Relates to: [[QUESTION_...]].

## Cài Đặt (Setup)

| Model | Dataset | Optimizer | LR | Batch | Epochs | Seed |
|-------|---------|-----------|-----|-------|--------|------|
| [[MODEL_...]] | [[DATA_...]] | ... | ... | ... | ... | ... |

## Code

- Script: `src/experiments/${name}.py`
- Commit: `${git_hash}`

## Kết Quả (Results)

| [[METRIC_...]] | Train | Val | Test |
|-----------------|-------|-----|------|

## Kết Luận (Conclusion)

${Giả thuyết có đúng không?}
Next: [[EXP_...]] | Insight: [[INSIGHT_...]]
```

**Tại sao seed và commit lại bắt buộc:** Nếu không có chúng, thực nghiệm sẽ không thể được tái lập (reproducible). Một thực nghiệm không thể tái lập chỉ là một giai thoại (anecdote), chứ không phải là bằng chứng khoa học.

---

### CONCEPT_ -- Khái Niệm (Concept)

```markdown
# CONCEPT_${Name}

Tags: #todo #concept #${topic}

---

## Định Nghĩa (Definition)
${Bằng ngôn từ của riêng bạn}

## Trực Giác (Intuition)
${Tại sao nó lại hiệu quả? Cơ chế cốt lõi là gì?}

## Được Sử Dụng Ở Đâu (Where Used)
- [[MODEL_...]] -- ${sử dụng thế nào}
- [[METHOD_...]] -- ${trong bối cảnh nào}

## Nguồn Tham Khảo (Sources)
- [[LIT_...]] -- người đã giới thiệu khái niệm này
```

---

### DATA_ -- Tập Dữ Liệu (Dataset)

```markdown
# DATA_${Name}

Tags: #todo #dataset #${topic}

---

## Tổng Quan (Overview)

| Name | Source | Size | Features | Target | License |
|------|--------|------|----------|--------|---------|

## Schema

| Column | Type | Description | Missing % |
|--------|------|-------------|-----------|

## Phân chia (Splits)

| Split | Size | Method |
|-------|------|--------|

## Các Vấn Đề Đã Biết (Known Issues)
- ${Class imbalance (mất cân bằng lớp), noise (nhiễu), lỗi dán nhãn (label errors)}

## Được Sử Dụng Trong (Used In)
- [[EXP_...]], [[MODEL_...]]
```

---

## Quy Trình Làm Việc Hàng Ngày (Daily Workflows)

### Tổng Quan Tài Liệu (Literature Review)

```
1. Đọc paper         -> Ghi chú LIT_ (ngôn từ của bạn, không phải abstract)
2. Trích xuất concept-> Ghi chú CONCEPT_ (nếu chưa tồn tại)
3. Liên kết: LIT_ -> CONCEPT, METHOD, các bài đã trích dẫn
4. Ghi lại mối liên hệ với QUESTION_
```

### Vòng Lặp Thực Nghiệm (Experiment Cycle)

```
1. Đặt giả thuyết       -> liên kết đến QUESTION_
2. Tạo ghi chú EXP_     -> TRƯỚC KHI chạy (ghi setup, tham số, commit)
3. Chạy                 -> cập nhật lại các kết quả
4. Có ý nghĩa thống kê? -> Tạo ghi chú RESULT_
5. Diễn giải            -> Tạo ghi chú INSIGHT_
6. Nối chuỗi: EXP -> RESULT -> INSIGHT -> thực nghiệm EXP tiếp theo
```

### Viết Báo Cáo Khoa Học (Paper Writing)

```
1. Mở INDEX           -> rà soát lại cơ sở tri thức
2. Các chuỗi QUESTION -> EXP -> RESULT -> viết phần Results (Kết quả)
3. Các chuỗi LIT -> CONCEPT -> viết phần Related work (Nghiên cứu liên quan)
4. Mỗi ghi chú = một ứng viên cấu thành đoạn văn
```

---

## Template INDEX.md

```markdown
---
type: hub
status: done
last_updated: YYYY-MM-DD
---

# ${Project} -- Knowledge Base

Tags: #done #system

> Topic: ${research topic} | Phase: ${current phase}

## Các Câu Hỏi Nghiên Cứu (Research Questions)
| Note | Status |
|------|--------|
| [[QUESTION_...]] | ... |

## Tài Liệu Học Thuật (Literature)
| Note | Key Contribution |
|------|------------------|
| [[LIT_...]] | ... |

## Thực Nghiệm (Experiments)
| Note | Status | Result |
|------|--------|--------|
| [[EXP_...]] | ... | [[RESULT_...]] |

## Các Insight Quan Trọng (Key Insights)
| Note | Implication |
|------|-------------|
| [[INSIGHT_...]] | ... |
```

---

## Checklist Kiểm Tra

- [ ] Đúng tiền tố chưa?
- [ ] Có Frontmatter (`type`, `status`, `last_updated`) chưa?
- [ ] Tags nằm sau heading chưa?
- [ ] Tính nguyên tử -- có phải là một thực thể duy nhất không?
- [ ] Các `[[wikilinks]]` có liên kết chéo tầng không?
- [ ] INDEX.md đã được cập nhật chưa?
- [ ] Ghi chú LIT_ đã được viết lại bằng văn phong của bạn, với sự liên hệ rõ ràng chưa?
- [ ] Ghi chú EXP_ có lưu seed, git commit và file config không?
