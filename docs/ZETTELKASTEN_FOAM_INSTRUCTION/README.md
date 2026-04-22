# Zettelkasten/Foam -- Pocket Mini-Book

A technical field guide for managing engineering knowledge using Foam (VS Code Zettelkasten). Five chapters. Each self-contained. Pick the one matching your domain.

---

## Core Premise

Zettelkasten is a directed graph where each node is an atomic Markdown file and each edge is a `[[wikilink]]`. Knowledge lives in the **edges**, not the nodes. The graph is the product.

Three principles govern everything:

- **Atomic notes** -- one file, one entity, one concept
- **Linking over filing** -- `[[wikilinks]]` replace directory hierarchies
- **Emergent structure** -- INDEX hub notes form as the graph grows; you do not design them upfront

---

## Foam

Foam is the VS Code extension that implements this. It provides:

- **`[[wikilinks]]`** -- bidirectional links between `.md` files, resolved by filename
- **Graph View** -- interactive visualization of the link topology
- **Backlinks Panel** -- reverse edge traversal for any node
- **Daily Notes** -- timestamped journal entries
- **Templates** -- predefined note structures

---

## Chapters

| # | Chapter | Domain |
|---|---------|--------|
| 0 | [The Core Vibe](00_CORE_VIBE.md) | Three non-negotiable rules. Read first. |
| 1 | [Embedded Systems](01_EMBEDDED_SYSTEMS_ZETTELKASTEN.md) | Firmware, drivers, RTOS, PCB, registers |
| 2 | [Software Development](02_SOFTWARE_DEVELOPMENT_ZETTELKASTEN.md) | Web, mobile, backend, DevOps |
| 3 | [Research and Data Science](03_RESEARCH_DATA_SCIENCE_ZETTELKASTEN.md) | ML, experiments, papers |
| 4 | [Personal Learning](04_PERSONAL_LEARNING_ZETTELKASTEN.md) | Languages, skills, certifications |

---

## Universal Rules

**Flat structure.** All notes live flat in `docs/`. No subfolders. Prefix naming (`HW_`, `FW_`, `API_`, `VOCAB_`) is the categorization mechanism. Subfolders break wikilink resolution.

**Frontmatter.** Every note starts with YAML:

```yaml
---
type: <note-type>
status: todo | in-progress | done | blocked | deprecated
last_updated: YYYY-MM-DD
---
```

**Tags.** Placed on the line after the heading. Machine-parseable, human-scannable.

**Link everything.** If you mention an entity that has or should have a note, create a `[[wikilink]]`. Broken links are valid -- they are forward references.

**INDEX.md.** Every project has one. It is the entry point that links to all notes by category.

---

## Agent Protocol

AI agents follow the same rules as humans:

1. Identify the domain -- pick the corresponding chapter
2. Read `INDEX.md` first -- it is the graph root
3. Use the correct prefix and template from that chapter
4. Add `[[wikilinks]]` to all related notes -- cross-layer linking has the highest information density
5. Update `INDEX.md` after every note creation or modification
6. One note per entity -- atomicity is not optional
