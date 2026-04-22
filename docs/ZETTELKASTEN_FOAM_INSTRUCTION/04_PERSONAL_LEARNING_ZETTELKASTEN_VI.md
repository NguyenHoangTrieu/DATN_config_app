# Chương 4 -- Học Tập Cá Nhân (Personal Learning)

**Phạm vi:** Ngoại ngữ, kỹ năng mềm, các chứng chỉ chuyên môn, tự học, học vì sở thích.

**Điều kiện tiên quyết:** [Chương 0 -- Nguyên Tắc Cốt Lõi](00_CORE_VIBE_VI.md).

---

## Các Lỗi Thực Hành (Anti-Patterns)

- **Một list từ vựng 200 từ trong một file duy nhất** -- một danh sách từ vựng không phải là một cơ sở tri thức. Mỗi từ vựng cần có ngữ cảnh, cụm từ kết hợp (collocations) và liên kết đến các chủ đề. Hãy dùng một ghi chú `VOCAB_` cho mỗi từ.
- **Quy tắc ngữ pháp mà không có ví dụ** -- một quy tắc được phát biểu mà không có ví dụ đúng/sai là một quy tắc sẽ bị áp dụng sai. Luôn luôn đưa vào cả hai.
- **Không ghi nhận các lỗi sai** -- lỗi sai chính là dữ liệu. Mỗi mẫu lỗi (error pattern) cần một ghi chú `MISTAKE_`. Nếu không có nó, bạn sẽ lặp lại những lỗi tương tự mãi mãi.
- **Từ vựng không có ngữ cảnh** -- một từ bị cô lập chỉ là một thẻ nhớ (flashcard). Một từ được liên kết với ngữ cảnh chủ đề, các collocations, và những lỗi thường gặp mới là tri thức. Hãy liên kết `VOCAB_` tới `TOPIC_` và `MISTAKE_`.
- **Không có chu kỳ ôn tập** -- tri thức nếu không được thực hành truy xuất sẽ bị mai một theo cấp số nhân. Việc theo dõi lặp lại ngắt quãng (spaced repetition) trong các ghi chú `VOCAB_` là điều bắt buộc.
- **Ngữ pháp không đi kèm thực hành** -- hiểu một quy tắc không giống với việc áp dụng được nó. Các ghi chú `GRAMMAR_` phải liên kết đến các bài tập `PRACTICE_`.

---

## Quy Trình Vibe Coding

```
1. Từ mới             -> Ghi chú VOCAB_ -> liên kết [[TOPIC_]]
2. Quy tắc ngữ pháp mới -> Ghi chú GRAMMAR_ -> liên kết [[RESOURCE_]]
3. Mắc một lỗi sai    -> Ghi chú MISTAKE_ -> liên kết [[GRAMMAR_]]
4. Phiên thực hành    -> Ghi chú PRACTICE_ -> liên kết các phát hiện
5. Cập nhật INDEX.md
```

---

## Tại Sao Dùng Zettelkasten Cho Việc Học

**Lặp lại ngắt quãng một cách thụ động (Passive spaced repetition).** Mỗi lần bạn tạo một liên kết tới một ghi chú hiện có, bạn đang bắt gặp lại kiến thức đó. Các ghi chú có độ kết nối cao sẽ được truy cập thường xuyên. Đây chính là spaced repetition mà không cần tới công cụ SRS chuyên dụng -- nó nổi lên từ chính hành vi liên kết.

**Mã hóa theo ngữ cảnh (Contextual encoding).** Nghiên cứu về trí nhớ liên tục chỉ ra rằng thông tin được mã hóa bằng những liên tưởng phong phú sẽ được ghi nhớ tốt hơn so với các mục thông tin cô lập. Một từ vựng được liên kết tới ngữ cảnh chủ đề của nó, các quy tắc ngữ pháp, collocations, và các lỗi thường gặp sẽ có nhiều đường dẫn truy xuất (retrieval paths) hơn là một tấm thẻ flashcard.

**Đo lường tiến độ thông qua các chỉ số đồ thị (Progress as graph metrics).** Các thẻ trạng thái (`#todo`, `#learning`, `#mastered`) kết hợp với các bảng INDEX cung cấp một cái nhìn định lượng về những gì bạn đã biết so với những gì bạn chưa biết. Không cần phải đoán.

---

## Cấu Trúc Dự Án

```
LEARNING_ROOT/
  docs/                    <- Zettelkasten (phẳng, không thư mục con)
    INDEX.md
    VOCAB_*.md    GRAMMAR_*.md   TOPIC_*.md
    SKILL_*.md    PRACTICE_*.md  RESOURCE_*.md
    MISTAKE_*.md  TEMPLATE_*.md  CULTURE_*.md
    CERT_*.md     PROGRESS_*.md  LOG_*.md
    _templates/
  practice/   resources/
```

---

## Màu Sắc Đồ Thị Foam

```jsonc
{
  "foam.graph.style": {
    "node": {
      "VOCAB_*":    { "color": "#3498db" },
      "GRAMMAR_*":  { "color": "#e74c3c" },
      "TOPIC_*":    { "color": "#2ecc71" },
      "SKILL_*":    { "color": "#9b59b6" },
      "MISTAKE_*":  { "color": "#f39c12" },
      "RESOURCE_*": { "color": "#1abc9c" },
      "INDEX":      { "color": "#f1c40f" }
    }
  }
}
```

---

## Các Loại Ghi Chú (Note Types)

- **`VOCAB_`** -- Từ vựng. Một từ hoặc cụm từ cùng với định nghĩa, collocations, họ từ (word family), ngữ cảnh sử dụng. Ví dụ: `VOCAB_Sustainable.md`
- **`GRAMMAR_`** -- Ngữ pháp. Một quy tắc cùng với cấu trúc, ví dụ đúng/sai, những so sánh. Ví dụ: `GRAMMAR_Conditional_Type2.md`
- **`TOPIC_`** -- Chủ đề. Một trung tâm nhỏ theo chủ đề (thematic mini-hub) dùng để liên kết đến các ghi chú VOCAB_ và GRAMMAR_ liên quan. Nó không chứa các định nghĩa -- nó chỉ tổng hợp các liên kết. Ví dụ: `TOPIC_Environment.md`
- **`SKILL_`** -- Kỹ năng. Một kỹ năng không thuộc về ngôn ngữ, đi kèm với các nguyên tắc, kỹ thuật, kế hoạch luyện tập. Ví dụ: `SKILL_Public_Speaking.md`
- **`PRACTICE_`** -- Thực hành (Practice). Một bài tập cùng với bài làm của bạn, feedback, sửa lỗi, và các lỗi sai phát hiện được. Ví dụ: `PRACTICE_Writing_Task2_01.md`
- **`RESOURCE_`** -- Tài nguyên (Resource). Sách, khóa học, video cùng với các bài học rút ra và từ vựng được trích xuất. Ví dụ: `RESOURCE_Grammar_In_Use.md`
- **`MISTAKE_`** -- Lỗi sai (Mistake). Một mẫu lỗi đi kèm với quy tắc gốc rễ và cách sửa. Ví dụ: `MISTAKE_Affect_vs_Effect.md`
- **`TEMPLATE_`** -- Biểu mẫu (Template). Cấu trúc nói hoặc viết dành cho một loại bài tập cụ thể. Ví dụ: `TEMPLATE_Opinion_Essay.md`
- **`CULTURE_`** -- Văn hóa (Culture). Ngữ cảnh văn hóa liên quan đến việc sử dụng ngôn ngữ. Ví dụ: `CULTURE_British_Politeness.md`
- **`CERT_`** -- Chứng chỉ (Certification). Cấu trúc bài thi, tiêu chí chấm điểm, chiến lược chuẩn bị. Ví dụ: `CERT_IELTS_Overview.md`
- **`PROGRESS_`** -- Tiến độ (Progress). Theo dõi định lượng về cấp độ và điểm số theo thời gian. Ví dụ: `PROGRESS_Band_Tracker.md`
- **`LOG_`** -- Nhật ký hàng ngày. Ghi chép học tập. Ví dụ: `LOG_2026-04-22.md`

---

## Chuỗi Tri Thức Học Tập

```
TOPIC -> VOCAB    (các từ được dùng trong ngữ cảnh này)
TOPIC -> GRAMMAR  (các quy tắc liên quan đến ngữ cảnh này)
VOCAB -> MISTAKE  (các lỗi thường gặp với từ này)
GRAMMAR -> MISTAKE (các lỗi thường gặp với quy tắc này)
PRACTICE -> VOCAB + GRAMMAR + MISTAKE (những gì phát hiện được trong quá trình làm bài tập)
RESOURCE -> VOCAB + GRAMMAR (trích xuất từ tài liệu học)
```

**Tại sao topology này quan trọng:** Khi chuẩn bị cho một chủ đề, bạn men theo `TOPIC_ -> VOCAB_ + GRAMMAR_` để tải lượng kiến thức liên quan. Khi xem lại các lỗi sai, bạn men theo `MISTAKE_ -> GRAMMAR_` để ôn lại quy tắc gốc rễ. Khi đánh giá một phiên thực hành, bạn men theo `PRACTICE_ -> MISTAKE_` để cập nhật các mẫu lỗi của mình. Đồ thị điều khiển luồng công việc học tập.

---

## Các Templates

### VOCAB_ -- Từ Vựng

```markdown
# VOCAB_${Word}

Tags: #todo #vocabulary #${level} #${topic}

---

## Định Nghĩa (Definition)

**${word}** (${part of speech - từ loại}) -- ${định nghĩa}
Native: ${bản dịch tiếng Việt}

## Cách Sử Dụng (Usage)

- **Collocations:** ${make a decision}, ${take action}
- **Ví dụ:** "${câu ví dụ}" -- (${nguồn})
- **Register (Sắc thái):** Formal / Informal / Neutral

## Họ Từ (Word Family)

| Noun | Verb | Adj | Adv |
|------|------|-----|-----|

## Các Lỗi Thường Gặp (Common Mistakes)
- [[MISTAKE_...]]

## Các Chủ Đề (Topics)
- [[TOPIC_...]]

## Lặp Lại Ngắt Quãng (Spaced Repetition)

| Review | Date | Recalled |
|--------|------|----------|
| 1 | YYYY-MM-DD | yes/no |
```

**Tại sao việc theo dõi spaced repetition được đặt ở đây:** Việc tập trung dữ liệu ôn tập trong ghi chú từ vựng có nghĩa là bạn không cần đến một công cụ SRS riêng biệt. Ghi chú NÀY CHÍNH LÀ thẻ flashcard, với toàn bộ ngữ cảnh được đính kèm theo nó.

---

### GRAMMAR_ -- Quy Tắc Ngữ Pháp

```markdown
# GRAMMAR_${RuleName}

Tags: #todo #grammar #${level}

---

## Quy Tắc (Rule)
${Phát biểu rõ ràng về quy tắc}

## Cấu Trúc (Structure)
`Subject + ${verb form} + ${complement}`

## Ví Dụ (Examples)

Đúng:
1. ${ví dụ} -- ${giải thích}

Sai:
1. ${sai} -> ${đúng} -- ${tại sao}

## So Sánh Với (Compare With)
[[GRAMMAR_${OtherRule}]] -- ${khi nào dùng cái nào}

## Thực Hành (Practice)
- [[PRACTICE_...]]
```

---

### MISTAKE_ -- Mẫu Lỗi Sai (Error Pattern)

```markdown
# MISTAKE_${Name}

Tags: #todo #mistake #${type}

---

## Lỗi Sai (Error)

- **Sai:** ${cách dùng sai}
- **Đúng:** ${cách dùng đúng}

## Quy Tắc Nền Tảng (Underlying Rule)
${Tại sao lại sai}. Ngữ pháp: [[GRAMMAR_...]].

## Mẹo Nhớ (Mnemonic)
${Cách ghi nhớ}

## Bắt Gặp Tại (Encountered In)
[[PRACTICE_...]] / [[LOG_...]]
```

---

### TOPIC_ -- Trung Tâm Chủ Đề (Thematic Hub)

```markdown
# TOPIC_${Name}

Tags: #todo #topic #${category}

---

## Từ Vựng Trọng Tâm (Key Vocabulary)

| Word | Meaning | Usage |
|------|---------|-------|
| [[VOCAB_...]] | ... | ... |

## Điểm Ngữ Pháp (Grammar Points)
- [[GRAMMAR_...]] -- ${mức độ liên quan}

## Các Cụm Từ Hữu Ích (Useful Phrases)
- ${phrase} -- ${khi nào thì dùng}

## Thực Hành (Practice)
- [[PRACTICE_...]]
```

**Lưu ý về tính nguyên tử của TOPIC_:** Các ghi chú TOPIC_ là nơi tổng hợp, không phải là kho chứa đựng (containers). Chúng liên kết tới các ghi chú VOCAB_ và GRAMMAR_ nhưng không sao chép lại định nghĩa. Định nghĩa nằm ở trong các ghi chú được liên kết.

---

### PRACTICE_ -- Bài Tập (Exercise)

```markdown
# PRACTICE_${Name}

Tags: #todo #practice #${skill}

---

## Đề Bài (Task)
${Cần phải làm gì}

## Bài Làm Của Tôi (My Work)
${Câu trả lời hoặc transcript của bạn}

## Sửa Lỗi (Corrections)

| Original | Corrected | Rule |
|----------|-----------|------|
| ${sai} | ${đúng}  | [[GRAMMAR_...]] |

## Các Phát Hiện (Discoveries)
- Các lỗi sai: [[MISTAKE_...]]
- Từ vựng mới: [[VOCAB_...]]
```

---

## Frontmatter (Dành Riêng Cho Học Tập)

```yaml
---
type: vocab | grammar | topic | skill | practice | resource | mistake
status: todo | learning | mastered | review-needed
level: A1 | A2 | B1 | B2 | C1 | C2
last_updated: YYYY-MM-DD
---
```

Trường `level` (cấp độ) ánh xạ tới khung CEFR cho việc học ngôn ngữ. Đối với các kỹ năng không phải ngôn ngữ, hãy sử dụng `beginner | intermediate | advanced`.

---

## Quy Trình Làm Việc Hàng Ngày (Daily Workflows)

### Khi Có Từ Vựng Mới

```
1. Bắt gặp từ mới  -> Ghi chú VOCAB_ (định nghĩa, collocations, ví dụ)
2. Liên kết        -> Ghi chú TOPIC_
3. Lỗi phổ biến?   -> Ghi chú MISTAKE_
4. Spaced repetition: ôn tập vào ngày 1, 3, 7, 14, 30
```

### Khi Có Ngữ Pháp Mới

```
1. Học quy tắc mới -> Ghi chú GRAMMAR_
2. Nguồn           -> liên kết RESOURCE_
3. Thực hành       -> Ghi chú PRACTICE_
4. Tìm thấy lỗi    -> Ghi chú MISTAKE_
5. Liên kết GRAMMAR_ -> TOPIC_ (những ngữ cảnh nào sử dụng quy tắc này)
```

### Phiên Thực Hành

```
1. Chọn TOPIC_    -> ôn lại các liên kết VOCAB_ + GRAMMAR_
2. Làm bài tập    -> Ghi chú PRACTICE_
3. Nhận Feedback  -> bảng sửa lỗi (corrections table)
4. Trích xuất     -> tạo các ghi chú MISTAKE_ và VOCAB_ mới
```

### Đánh Giá Hàng Tuần (Weekly Review)

```
1. INDEX          -> xem xét tiến độ tổng thể
2. Các note VOCAB_   -> kiểm tra ôn tập ngắt quãng (spaced repetition)
3. Các note MISTAKE_ -> đã giải quyết hay vẫn còn lặp lại?
4. Cập nhật Status -> #learning -> #mastered
```

---

## Template INDEX.md

```markdown
---
type: hub
status: done
last_updated: YYYY-MM-DD
---

# ${Language/Skill} -- Knowledge Base

Tags: #done #system

> Mục tiêu: ${target} | Cấp độ: ${current} | Kế hoạch: ${hours/week}

## Các Chủ Đề (Topics)
| Note | Status | Key Vocab |
|------|--------|-----------|
| [[TOPIC_...]] | ... | [[VOCAB_...]] |

## Ngữ Pháp (Grammar)
| Note | Level | Status |
|------|-------|--------|
| [[GRAMMAR_...]] | ... | ... |

## Các Lỗi Thường Gặp (Common Mistakes)
| Note | Type | Status |
|------|------|--------|
| [[MISTAKE_...]] | ... | ... |

## Thực Hành (Practice)
| Note | Type | Score |
|------|------|-------|
| [[PRACTICE_...]] | ... | ... |

## Tài Nguyên (Resources)
| Note | Type | Progress |
|------|------|----------|
| [[RESOURCE_...]] | ... | ... |
```

---

## Checklist Kiểm Tra

- [ ] Đúng tiền tố chưa?
- [ ] Có Frontmatter (`type`, `status`, `level`, `last_updated`) chưa?
- [ ] Tags nằm sau heading chưa?
- [ ] Tính nguyên tử -- có phải là một từ duy nhất, một quy tắc duy nhất, một chủ đề duy nhất không?
- [ ] Có các `[[wikilinks]]` loại chéo (cross-type) không?
  - [ ] VOCAB -> TOPIC, MISTAKE?
  - [ ] GRAMMAR -> PRACTICE, MISTAKE?
  - [ ] PRACTICE -> VOCAB, GRAMMAR, MISTAKE?
- [ ] INDEX.md đã được cập nhật chưa?
- [ ] Các ví dụ có bao gồm cả trường hợp đúng lẫn sai chưa?
