# Chương 2 -- Phát Triển Phần Mềm (Software Development)

**Phạm vi:** Full-stack web, ứng dụng di động, backend APIs, microservices, DevOps, CI/CD, thiết kế cơ sở dữ liệu.

**Điều kiện tiên quyết:** [Chương 0 -- Nguyên Tắc Cốt Lõi](00_CORE_VIBE_VI.md).

---

## Các Lỗi Thực Hành (Anti-Patterns)

- **Lấy một file README 500 dòng làm tài liệu duy nhất** -- không thể liên kết, không thể duyệt, không thể tìm kiếm theo thực thể. Hãy chia nhỏ thành các ghi chú nguyên tử.
- **Dùng Swagger/OpenAPI làm tài liệu API duy nhất** -- Swagger mô tả CÁI GÌ (WHAT). Ghi chú mô tả TẠI SAO (WHY). Bạn cần cả hai.
- **Thư mục quá sâu** `docs/backend/services/auth/` -- phá vỡ phân giải wikilink. Hãy dùng dạng phẳng `SVC_AuthService.md`.
- **Dùng các comment trong code làm cơ sở tri thức duy nhất** -- comment không có tham chiếu chéo. Chúng không thể liên kết tới các quyết định kiến trúc, schema cơ sở dữ liệu, hay phân tích lỗi (bug analyses).
- **Một ghi chú RCA bao gồm năm bugs** -- vi phạm tính nguyên tử. Mỗi bug là một kiểu lỗi riêng biệt với một nguyên nhân gốc rễ riêng biệt.
- **Không ghi nhận các lựa chọn đã bị bác bỏ** -- sáu tháng sau bạn sẽ lại đánh giá lại chính những lựa chọn thay thế đó. Các ghi chú ARCH_ với toàn bộ các tùy chọn từng được xem xét sẽ ngăn chặn vòng lặp này.
- **Copy-paste toàn bộ schema cơ sở dữ liệu** -- hãy tóm tắt cấu trúc bảng, liên kết đến file migration. Nguyên tắc DRY (Don't Repeat Yourself) cũng áp dụng cho cả tài liệu.

---

## Quy Trình Vibe Coding

```
1. Tính năng mới    -> Ghi chú ARCH_ (lý do thiết kế)
2. Endpoint mới    -> Ghi chú API_ -> liên kết [[SVC_]], [[DB_]]
3. Component mới   -> Ghi chú COMP_ -> liên kết [[PAGE_]], [[API_]]
4. Phát hiện bug   -> Ghi chú RCA_ -> liên kết các thực thể bị ảnh hưởng
5. Cập nhật INDEX.md
```

---

## Tại Sao Dùng Zettelkasten Cho Phần Mềm

**Khả năng truy xuất chéo tầng (Cross-layer traceability).** Một component frontend gọi một API endpoint, API này kích hoạt một service ở backend, service này truy vấn một bảng trong database, và bảng đó lại bị ràng buộc bởi auth middleware. Tất cả đều là những file riêng biệt trong codebase của bạn, nhưng chúng đại diện cho một đường dẫn thực thi duy nhất. `[[wikilinks]]` làm cho đường dẫn này có thể được duyệt qua lại trong cơ sở tri thức của bạn.

**Khảo cổ học quyết định (Decision archaeology).** Các ghi chú ARCH_ bảo tồn lý do đằng sau các lựa chọn thiết kế. Nếu không có chúng, bạn sẽ lãng phí hàng giờ đồng hồ để tranh luận lại những quyết định vốn đã được chốt.

**Nhận diện mẫu lỗi (Bug pattern recognition).** Các ghi chú RCA_ được liên kết xuyên suốt qua các tính năng và module giúp những kiểu lỗi (failure modes) lặp đi lặp lại trở nên rõ ràng. Race conditions, N+1 queries, cấu hình CORS sai -- đây là những "lớp" lỗi (classes), chứ không phải các trường hợp đơn lẻ (instances). Các ghi chú RCA_ được liên kết giúp bạn nhìn thấy được toàn bộ "lớp" đó.

---

## Cấu Trúc Dự Án

```
PROJECT_ROOT/
  src/  (frontend/ backend/ shared/)
  docs/                    <- Zettelkasten (phẳng, không thư mục con)
    INDEX.md
    ARCH_*.md  API_*.md   COMP_*.md  PAGE_*.md
    SVC_*.md   DB_*.md    RCA_*.md   DEPLOY_*.md
    SEC_*.md   PERF_*.md  LIB_*.md   LOG_*.md
    _templates/
  tests/
```

---

## Màu Sắc Đồ Thị Foam

```jsonc
{
  "foam.graph.style": {
    "node": {
      "ARCH_*": { "color": "#9b59b6" },
      "API_*":  { "color": "#3498db" },
      "COMP_*": { "color": "#2ecc71" },
      "SVC_*":  { "color": "#e67e22" },
      "DB_*":   { "color": "#e74c3c" },
      "RCA_*":  { "color": "#f39c12" },
      "INDEX":  { "color": "#1abc9c" }
    }
  }
}
```

---

## Các Loại Ghi Chú (Note Types)

- **`ARCH_`** -- Ghi Nhận Quyết Định Kiến Trúc (Architecture Decision Record). Lý do thiết kế, những đánh đổi (trade-offs), các lựa chọn bị bác bỏ. Ví dụ: `ARCH_Monolith_vs_Microservice.md`
- **`API_`** -- API Endpoint. Phương thức, đường dẫn, hợp đồng request/response, các quy tắc nghiệp vụ. Ví dụ: `API_POST_Users_Register.md`
- **`COMP_`** -- UI Component. Props, state, các event, đường dẫn file. Ví dụ: `COMP_LoginForm.md`
- **`PAGE_`** -- Trang/Màn hình (Page/Screen). Cách bố cục các component. Ví dụ: `PAGE_Dashboard.md`
- **`SVC_`** -- Backend Service. Module chứa logic nghiệp vụ, các phương thức public, xử lý lỗi. Ví dụ: `SVC_AuthService.md`
- **`DB_`** -- Cơ sở dữ liệu. Schema của bảng, các index, quan hệ (relations), các câu truy vấn phổ biến. Ví dụ: `DB_Users_Table.md`
- **`RCA_`** -- Phân Tích Nguyên Nhân Gốc Rễ (Root Cause Analysis). Một bug, một ghi chú. Ví dụ: `RCA_N1_Query_UserList.md`
- **`DEPLOY_`** -- Triển khai (Deployment). Pipeline CI/CD, cấu hình Docker, Kubernetes. Ví dụ: `DEPLOY_Docker_Compose.md`
- **`SEC_`** -- Bảo mật (Security). Luồng xác thực (Auth flows), chính sách CORS, ngăn chặn injection. Ví dụ: `SEC_JWT_Refresh_Token.md`
- **`PERF_`** -- Hiệu suất (Performance). Kết quả profiling, chiến lược tối ưu. Ví dụ: `PERF_React_Memo_Strategy.md`
- **`LIB_`** -- Thư viện. Tài liệu về các dependency của bên thứ ba. Ví dụ: `LIB_Prisma_ORM.md`
- **`HOOK_`** -- Custom Hook. Logic hook của React/Vue. Ví dụ: `HOOK_useAuth.md`
- **`STATE_`** -- Quản lý State. Định nghĩa store, actions, selectors. Ví dụ: `STATE_CartStore.md`
- **`CONFIG_`** -- Cấu hình (Configuration). Các biến môi trường, feature flags. Ví dụ: `CONFIG_Environment_Vars.md`
- **`TEST_`** -- Chiến Lược Kiểm Thử (Test Strategy). Kế hoạch test, phân tích độ bao phủ (coverage). Ví dụ: `TEST_E2E_Checkout_Flow.md`
- **`LOG_`** -- Log Debug. Các ghi chú về một phiên điều tra lỗi. Ví dụ: `LOG_2026-04-22_CORS_Issue.md`

---

## Liên Kết Chéo Tầng (Cross-Layer Linking)

Đây là mẫu có giá trị cao nhất trong Zettelkasten phần mềm. Mỗi đường dẫn thực thi trong code của bạn đều có một chuỗi liên kết tương ứng trong ghi chú của bạn:

```
Chuỗi Frontend:   PAGE_ -> COMP_ -> HOOK_ -> STATE_
Chuỗi Backend:    API_  -> SVC_  -> DB_
Chuỗi Fix Bug:    RCA_  -> các thực thể bị ảnh hưởng -> TEST_
Chuỗi Quyết định: ARCH_ -> tất cả các ghi chú bị ảnh hưởng
```

**Tại sao điều này quan trọng:** Khi bạn sửa đổi một schema database, việc duyệt ngược backlink từ `DB_Users_Table` sẽ hé lộ mọi service, API endpoint, và component đang phụ thuộc vào nó. Đây là sự phân tích tác động thông qua duyệt đồ thị, chứ không phải lệnh grep.

---

## Các Templates

### API_ -- Endpoint

```markdown
# API_${METHOD}_${Resource}_${Action}

Tags: #todo #api #${feature}

${API này làm gì}. Service: [[SVC_...]]. DB: [[DB_...]]. Auth: [[SEC_...]].

---

## Hợp Đồng (Contract)

`${METHOD} /api/v1/${path}`

**Request:** `{ "field": "type -- description" }`
**Query:** `?page=1&limit=20`

**Thành công (200):** `{ "data": {}, "meta": { "total": 100 } }`

**Lỗi (Errors):**
- 400 VALIDATION_ERROR
- 401 UNAUTHORIZED
- 404 NOT_FOUND

## Các Quy Tắc Nghiệp Vụ (Business Rules)
1. ${Rule}

## File
`src/backend/routes/${file}.ts`
```

---

### SVC_ -- Backend Service

```markdown
# SVC_${ServiceName}

Tags: #todo #backend #${feature}

${Service này làm gì}. APIs: [[API_...]]. DB: [[DB_...]].

---

## Phương Thức Public (Public Methods)

```typescript
async method(param: Type): Promise<ReturnType>;
```

## Xử Lý Lỗi (Error Handling)

| Error | Condition | HTTP Status |
|-------|-----------|-------------|

## Các Vấn Đề Đã Biết (Known Issues)
- [[RCA_...]] -- ${description}
```

---

### DB_ -- Database Schema

```markdown
# DB_${TableName}

Tags: #todo #database #${feature}

Sử dụng bởi: [[SVC_...]]. Relations: [[DB_...]].

---

## Schema

```sql
CREATE TABLE ${table} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Indexes

| Name | Columns | Type | Purpose |
|------|---------|------|---------|

## Các Truy Vấn Phổ Biến (Common Queries)

```sql
SELECT ... FROM ${table} WHERE ...;
```
Sử dụng bởi: [[SVC_...]] -- `method()`
```

---

### RCA_ -- Phân Tích Nguyên Nhân Gốc Rễ (Root Cause Analysis)

```markdown
# RCA_${BugName}

Tags: #todo #bug #${severity}

${Problem}. Bị ảnh hưởng: [[SVC_...]] / [[COMP_...]] / [[API_...]].

---

## Triệu Chứng (Symptoms)
- ${Biểu hiện đối với user}
- ${Error log hoặc stack trace}

## Nguyên Nhân Gốc Rễ (Root Cause)
${Tại sao lại xảy ra -- phân tích cơ chế, chứ không phải triệu chứng}

## Bản Fix
```typescript
// code đã sửa
```

## Phòng Ngừa (Prevention)
- [ ] Test hồi quy (Regression test): [[TEST_...]]
- [ ] Cập nhật: [[${Note}]]
```

---

### ARCH_ -- Quyết Định Kiến Trúc (Architecture Decision)

```markdown
# ARCH_${Decision}

Tags: #todo #architecture

**Status:** proposed | accepted | deprecated | superseded by [[ARCH_...]]
**Date:** YYYY-MM-DD
**Context:** [[SVC_...]], [[COMP_...]]

---

## Vấn Đề (Problem)
${Động lực nào đằng sau quyết định này}

## Các Tùy Chọn (Options)
- **A:** ${ưu điểm / nhược điểm / chi phí}
- **B:** ${ưu điểm / nhược điểm / chi phí}

## Quyết Định (Decision)
**Tùy chọn ${X}** -- ${rationale (lý do)}

## Hệ Quả (Consequences)
- Tích cực: ${benefit}
- Tiêu cực: ${trade-off}
- Rủi ro: ${risk and mitigation}
```

---

## Quy Trình Làm Việc Hàng Ngày (Daily Workflows)

### Tính Năng Mới

```
1. ARCH_ -> lý do thiết kế
2. DB_   -> schema
3. SVC_  -> logic nghiệp vụ
4. API_  -> hợp đồng endpoint
5. COMP_ -> giao diện người dùng (UI)
6. Cập nhật INDEX.md
```

### Debug / Sửa Lỗi

```
1. LOG_  -> tái hiện và ghi nhận
2. RCA_  -> phân tích nguyên nhân gốc rễ
3. Fix   -> cập nhật ghi chú SVC_ / COMP_ / API_
4. TEST_ -> test hồi quy
```

---

## Tính Nguyên Tử (Atomicity)

- `API_POST_Users_Register` -- một endpoint. Đạt.
- `COMP_LoginForm` -- một component. Đạt.
- `Backend_Documentation` -- mọi thứ ở backend. Thất bại. Hãy chia nhỏ thành `SVC_`, `API_`, `DB_`.

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

> Stack: ${frontend} + ${backend} + ${database}
> Deploy: ${platform} | CI/CD: ${pipeline}

## Kiến Trúc (Architecture)
| Note | Decision |
|------|----------|
| [[ARCH_...]] | ... |

## Frontend
| Page | Components |
|------|------------|
| [[PAGE_...]] | [[COMP_...]] |

## API
| Endpoint | Service |
|----------|---------|
| [[API_...]] | [[SVC_...]] |

## Backend
| Service | Responsibility |
|---------|----------------|
| [[SVC_...]] | ... |

## Database
| Table | Relations |
|-------|-----------|
| [[DB_...]] | ... |

## Các Vấn Đề Đã Biết (Known Issues)
| Note | Status |
|------|--------|
| [[RCA_...]] | ... |
```

Ngưỡng để tạo chỉ mục con: 10 ghi chú cho mỗi danh mục.

---

## Checklist Kiểm Tra

- [ ] Đúng tiền tố chưa?
- [ ] Có Frontmatter (`type`, `status`, `last_updated`) chưa?
- [ ] Tags nằm ngay sau heading chưa?
- [ ] Tính nguyên tử -- có phải là một thực thể duy nhất không?
- [ ] Các `[[wikilinks]]` có liên kết chéo tầng không?
- [ ] INDEX.md đã được cập nhật chưa?
