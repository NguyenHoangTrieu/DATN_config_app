# Chapter 2 -- Software Development

**Scope:** Full-stack web, mobile apps, backend APIs, microservices, DevOps, CI/CD, database design.

**Prerequisite:** [Chapter 0 -- The Core Vibe](00_CORE_VIBE.md).

---

## Anti-Patterns

- **500-line README as sole documentation** -- cannot link, cannot traverse, cannot search by entity. Split into atomic notes.
- **Swagger/OpenAPI as the only API docs** -- Swagger describes WHAT. Notes describe WHY. You need both.
- **Deep folders** `docs/backend/services/auth/` -- breaks wikilink resolution. Use `SVC_AuthService.md`.
- **Inline code comments as the only knowledge base** -- comments lack cross-references. They cannot link to architecture decisions, database schemas, or bug analyses.
- **One RCA note covering five bugs** -- violates atomicity. Each bug is a distinct failure mode with a distinct root cause.
- **Not documenting rejected options** -- six months from now you will re-evaluate the same alternatives. ARCH_ notes with all considered options prevent this loop.
- **Copy-pasting entire database schemas** -- summarize the table structure, link to the migration file. DRY applies to documentation too.

---

## Vibe Coding Workflow

```
1. New feature    -> ARCH_ note (design rationale)
2. New endpoint   -> API_ note -> link [[SVC_]], [[DB_]]
3. New component  -> COMP_ note -> link [[PAGE_]], [[API_]]
4. Bug found      -> RCA_ note -> link affected entities
5. Update INDEX.md
```

---

## Why Zettelkasten for Software

**Cross-layer traceability.** A frontend component calls an API endpoint, which triggers a backend service, which queries a database table, which enforces auth middleware. These are all separate files in your codebase but they represent a single execution path. `[[wikilinks]]` make this path traversable in your knowledge base.

**Decision archaeology.** ARCH_ notes preserve the rationale behind design choices. Without them, you will spend hours re-debating decisions that were already resolved.

**Bug pattern recognition.** RCA_ notes linked across features and modules make recurring failure modes visible. Race conditions, N+1 queries, CORS misconfigurations -- these are classes, not instances. Linked RCA_ notes let you see the class.

---

## Project Layout

```
PROJECT_ROOT/
  src/  (frontend/ backend/ shared/)
  docs/                    <- Zettelkasten (flat, no subfolders)
    INDEX.md
    ARCH_*.md  API_*.md   COMP_*.md  PAGE_*.md
    SVC_*.md   DB_*.md    RCA_*.md   DEPLOY_*.md
    SEC_*.md   PERF_*.md  LIB_*.md   LOG_*.md
    _templates/
  tests/
```

---

## Foam Graph Colors

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

## Note Types

- **`ARCH_`** -- Architecture Decision Record. Design rationale, trade-offs, rejected alternatives. Example: `ARCH_Monolith_vs_Microservice.md`
- **`API_`** -- API Endpoint. Method, path, request/response contract, business rules. Example: `API_POST_Users_Register.md`
- **`COMP_`** -- UI Component. Props, state, events, file location. Example: `COMP_LoginForm.md`
- **`PAGE_`** -- Page/Screen. Layout composition of components. Example: `PAGE_Dashboard.md`
- **`SVC_`** -- Backend Service. Business logic module, public methods, error handling. Example: `SVC_AuthService.md`
- **`DB_`** -- Database. Table schema, indexes, relations, common queries. Example: `DB_Users_Table.md`
- **`RCA_`** -- Root Cause Analysis. One bug, one note. Example: `RCA_N1_Query_UserList.md`
- **`DEPLOY_`** -- Deployment. CI/CD pipeline, Docker, Kubernetes config. Example: `DEPLOY_Docker_Compose.md`
- **`SEC_`** -- Security. Auth flows, CORS policy, injection prevention. Example: `SEC_JWT_Refresh_Token.md`
- **`PERF_`** -- Performance. Profiling results, optimization strategy. Example: `PERF_React_Memo_Strategy.md`
- **`LIB_`** -- Library. Third-party dependency documentation. Example: `LIB_Prisma_ORM.md`
- **`HOOK_`** -- Custom Hook. React/Vue hook logic. Example: `HOOK_useAuth.md`
- **`STATE_`** -- State Management. Store definition, actions, selectors. Example: `STATE_CartStore.md`
- **`CONFIG_`** -- Configuration. Environment variables, feature flags. Example: `CONFIG_Environment_Vars.md`
- **`TEST_`** -- Test Strategy. Test plan, coverage analysis. Example: `TEST_E2E_Checkout_Flow.md`
- **`LOG_`** -- Debug Log. Investigation session notes. Example: `LOG_2026-04-22_CORS_Issue.md`

---

## Cross-Layer Linking

This is the highest-value pattern in software Zettelkasten. Every execution path in your code has a corresponding link chain in your notes:

```
Frontend chain:   PAGE_ -> COMP_ -> HOOK_ -> STATE_
Backend chain:    API_  -> SVC_  -> DB_
Fix chain:        RCA_  -> affected entities -> TEST_
Decision chain:   ARCH_ -> all affected notes
```

**Why this matters:** When you modify a database schema, backlink traversal from `DB_Users_Table` reveals every service, API endpoint, and component that depends on it. This is impact analysis via graph traversal, not grep.

---

## Templates

### API_ -- Endpoint

```markdown
# API_${METHOD}_${Resource}_${Action}

Tags: #todo #api #${feature}

${What this endpoint does}. Service: [[SVC_...]]. DB: [[DB_...]]. Auth: [[SEC_...]].

---

## Contract

`${METHOD} /api/v1/${path}`

**Request:** `{ "field": "type -- description" }`
**Query:** `?page=1&limit=20`

**Success (200):** `{ "data": {}, "meta": { "total": 100 } }`

**Errors:**
- 400 VALIDATION_ERROR
- 401 UNAUTHORIZED
- 404 NOT_FOUND

## Business Rules
1. ${Rule}

## File
`src/backend/routes/${file}.ts`
```

---

### SVC_ -- Backend Service

```markdown
# SVC_${ServiceName}

Tags: #todo #backend #${feature}

${What this service does}. APIs: [[API_...]]. DB: [[DB_...]].

---

## Public Methods

```typescript
async method(param: Type): Promise<ReturnType>;
```

## Error Handling

| Error | Condition | HTTP Status |
|-------|-----------|-------------|

## Known Issues
- [[RCA_...]] -- ${description}
```

---

### DB_ -- Database Schema

```markdown
# DB_${TableName}

Tags: #todo #database #${feature}

Used by: [[SVC_...]]. Relations: [[DB_...]].

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

## Common Queries

```sql
SELECT ... FROM ${table} WHERE ...;
```
Used by: [[SVC_...]] -- `method()`
```

---

### RCA_ -- Root Cause Analysis

```markdown
# RCA_${BugName}

Tags: #todo #bug #${severity}

${Problem}. Affected: [[SVC_...]] / [[COMP_...]] / [[API_...]].

---

## Symptoms
- ${User-visible behavior}
- ${Error log or stack trace}

## Root Cause
${Why it happened -- the mechanism, not the symptom}

## Fix
```typescript
// corrected code
```

## Prevention
- [ ] Regression test: [[TEST_...]]
- [ ] Update: [[${Note}]]
```

---

### ARCH_ -- Architecture Decision

```markdown
# ARCH_${Decision}

Tags: #todo #architecture

**Status:** proposed | accepted | deprecated | superseded by [[ARCH_...]]
**Date:** YYYY-MM-DD
**Context:** [[SVC_...]], [[COMP_...]]

---

## Problem
${What motivates this decision}

## Options
- **A:** ${pros / cons / cost}
- **B:** ${pros / cons / cost}

## Decision
**Option ${X}** -- ${rationale}

## Consequences
- Positive: ${benefit}
- Negative: ${trade-off}
- Risk: ${risk and mitigation}
```

---

## Daily Workflows

### New Feature

```
1. ARCH_ -> design rationale
2. DB_   -> schema
3. SVC_  -> business logic
4. API_  -> endpoint contract
5. COMP_ -> UI
6. Update INDEX.md
```

### Debug / Fix Bug

```
1. LOG_  -> reproduce and record
2. RCA_  -> root cause analysis
3. Fix   -> update SVC_ / COMP_ / API_ notes
4. TEST_ -> regression test
```

---

## Atomicity

- `API_POST_Users_Register` -- one endpoint. Pass.
- `COMP_LoginForm` -- one component. Pass.
- `Backend_Documentation` -- everything backend. Fail. Split into `SVC_`, `API_`, `DB_`.

---

## INDEX.md Template

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

## Architecture
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

## Known Issues
| Note | Status |
|------|--------|
| [[RCA_...]] | ... |
```

Sub-index threshold: 10 notes per category.

---

## Checklist

- [ ] Correct prefix?
- [ ] Frontmatter (`type`, `status`, `last_updated`)?
- [ ] Tags after heading?
- [ ] Atomic -- one entity?
- [ ] Cross-layer `[[wikilinks]]`?
- [ ] INDEX.md updated?
