# Chapter 4 -- Personal Learning

**Scope:** Foreign languages, soft skills, professional certifications, self-study, hobby learning.

**Prerequisite:** [Chapter 0 -- The Core Vibe](00_CORE_VIBE.md).

---

## Anti-Patterns

- **200 words in one list file** -- a vocabulary list is not a knowledge base. Each word needs context, collocations, and links to topics. One `VOCAB_` note per word.
- **Grammar rules without examples** -- a rule stated without correct and incorrect examples is a rule that will be misapplied. Always include both.
- **Not recording mistakes** -- errors are data. Each error pattern gets a `MISTAKE_` note. Without it, you will repeat the same mistakes indefinitely.
- **Vocabulary without context** -- an isolated word is a flashcard. A word linked to its topic, collocations, and common mistakes is knowledge. Link `VOCAB_` to `TOPIC_` and `MISTAKE_`.
- **No review cycle** -- knowledge without retrieval practice decays exponentially. Spaced repetition tracking in `VOCAB_` notes is not optional.
- **Grammar without practice** -- understanding a rule is not the same as applying it. `GRAMMAR_` notes must link to `PRACTICE_` exercises.

---

## Vibe Coding Workflow

```
1. New word          -> VOCAB_ note -> link [[TOPIC_]]
2. New grammar rule  -> GRAMMAR_ note -> link [[RESOURCE_]]
3. Made an error     -> MISTAKE_ note -> link [[GRAMMAR_]]
4. Practice session  -> PRACTICE_ note -> link discoveries
5. Update INDEX.md
```

---

## Why Zettelkasten for Learning

**Passive spaced repetition.** Every time you create a link to an existing note, you re-encounter that knowledge. High-connectivity notes get revisited frequently. This is spaced repetition without a dedicated SRS tool -- it emerges from the linking behavior itself.

**Contextual encoding.** Memory research consistently shows that information encoded with rich associations is retained better than isolated items. A vocabulary word linked to its topic context, grammar rules, collocations, and common mistakes has more retrieval paths than a flashcard.

**Progress as graph metrics.** Status tags (`#todo`, `#learning`, `#mastered`) combined with INDEX tables provide a quantitative view of what you know versus what you do not. No guessing.

---

## Project Layout

```
LEARNING_ROOT/
  docs/                    <- Zettelkasten (flat, no subfolders)
    INDEX.md
    VOCAB_*.md    GRAMMAR_*.md   TOPIC_*.md
    SKILL_*.md    PRACTICE_*.md  RESOURCE_*.md
    MISTAKE_*.md  TEMPLATE_*.md  CULTURE_*.md
    CERT_*.md     PROGRESS_*.md  LOG_*.md
    _templates/
  practice/   resources/
```

---

## Foam Graph Colors

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

## Note Types

- **`VOCAB_`** -- Vocabulary. One word or phrase with definition, collocations, word family, usage context. Example: `VOCAB_Sustainable.md`
- **`GRAMMAR_`** -- Grammar. One rule with structure, correct/incorrect examples, comparisons. Example: `GRAMMAR_Conditional_Type2.md`
- **`TOPIC_`** -- Topic. A thematic mini-hub that links to relevant VOCAB_ and GRAMMAR_ notes. Does not contain definitions -- it aggregates links. Example: `TOPIC_Environment.md`
- **`SKILL_`** -- Skill. Non-language skill with principles, techniques, practice plan. Example: `SKILL_Public_Speaking.md`
- **`PRACTICE_`** -- Practice. One exercise with your work, feedback, corrections, and discovered mistakes. Example: `PRACTICE_Writing_Task2_01.md`
- **`RESOURCE_`** -- Resource. Book, course, video with key takeaways and extracted vocabulary. Example: `RESOURCE_Grammar_In_Use.md`
- **`MISTAKE_`** -- Mistake. One error pattern with the underlying rule and correction. Example: `MISTAKE_Affect_vs_Effect.md`
- **`TEMPLATE_`** -- Template. Writing or speaking structure for a specific task type. Example: `TEMPLATE_Opinion_Essay.md`
- **`CULTURE_`** -- Culture. Cultural context relevant to language use. Example: `CULTURE_British_Politeness.md`
- **`CERT_`** -- Certification. Exam structure, scoring criteria, preparation strategy. Example: `CERT_IELTS_Overview.md`
- **`PROGRESS_`** -- Progress. Quantitative tracking of levels and scores over time. Example: `PROGRESS_Band_Tracker.md`
- **`LOG_`** -- Daily Log. Learning journal entry. Example: `LOG_2026-04-22.md`

---

## The Learning Knowledge Chain

```
TOPIC -> VOCAB    (words used in this context)
TOPIC -> GRAMMAR  (rules relevant to this context)
VOCAB -> MISTAKE  (common errors with this word)
GRAMMAR -> MISTAKE (common errors with this rule)
PRACTICE -> VOCAB + GRAMMAR + MISTAKE (discovered during exercise)
RESOURCE -> VOCAB + GRAMMAR (extracted from study material)
```

**Why this topology matters:** When preparing for a topic, you follow `TOPIC_ -> VOCAB_ + GRAMMAR_` to load relevant knowledge. When reviewing mistakes, you follow `MISTAKE_ -> GRAMMAR_` to revisit the underlying rule. When evaluating a practice session, you follow `PRACTICE_ -> MISTAKE_` to update your error patterns. The graph drives the learning workflow.

---

## Templates

### VOCAB_ -- Vocabulary

```markdown
# VOCAB_${Word}

Tags: #todo #vocabulary #${level} #${topic}

---

## Definition

**${word}** (${part of speech}) -- ${definition}
Native: ${translation}

## Usage

- **Collocations:** ${make a decision}, ${take action}
- **Example:** "${sentence}" -- (${source})
- **Register:** Formal / Informal / Neutral

## Word Family

| Noun | Verb | Adj | Adv |
|------|------|-----|-----|

## Common Mistakes
- [[MISTAKE_...]]

## Topics
- [[TOPIC_...]]

## Spaced Repetition

| Review | Date | Recalled |
|--------|------|----------|
| 1 | YYYY-MM-DD | yes/no |
```

**Why spaced repetition tracking here:** Centralizing review data in the vocabulary note means you do not need a separate SRS tool. The note IS the flashcard, with full context attached.

---

### GRAMMAR_ -- Grammar Rule

```markdown
# GRAMMAR_${RuleName}

Tags: #todo #grammar #${level}

---

## Rule
${Clear statement of the rule}

## Structure
`Subject + ${verb form} + ${complement}`

## Examples

Correct:
1. ${example} -- ${explanation}

Incorrect:
1. ${wrong} -> ${correct} -- ${why}

## Compare With
[[GRAMMAR_${OtherRule}]] -- ${when to use which}

## Practice
- [[PRACTICE_...]]
```

---

### MISTAKE_ -- Error Pattern

```markdown
# MISTAKE_${Name}

Tags: #todo #mistake #${type}

---

## Error

- **Wrong:** ${incorrect usage}
- **Correct:** ${correct usage}

## Underlying Rule
${Why it is wrong}. Grammar: [[GRAMMAR_...]].

## Mnemonic
${How to remember}

## Encountered In
[[PRACTICE_...]] / [[LOG_...]]
```

---

### TOPIC_ -- Thematic Hub

```markdown
# TOPIC_${Name}

Tags: #todo #topic #${category}

---

## Key Vocabulary

| Word | Meaning | Usage |
|------|---------|-------|
| [[VOCAB_...]] | ... | ... |

## Grammar Points
- [[GRAMMAR_...]] -- ${relevance}

## Useful Phrases
- ${phrase} -- ${when to use}

## Practice
- [[PRACTICE_...]]
```

**Note on TOPIC_ atomicity:** TOPIC_ notes are aggregators, not containers. They link to VOCAB_ and GRAMMAR_ notes but do not duplicate definitions. The definitions live in the linked notes.

---

### PRACTICE_ -- Exercise

```markdown
# PRACTICE_${Name}

Tags: #todo #practice #${skill}

---

## Task
${What to do}

## My Work
${Your answer or transcript}

## Corrections

| Original | Corrected | Rule |
|----------|-----------|------|
| ${wrong} | ${right}  | [[GRAMMAR_...]] |

## Discoveries
- Mistakes: [[MISTAKE_...]]
- New vocabulary: [[VOCAB_...]]
```

---

## Frontmatter (Learning-Specific)

```yaml
---
type: vocab | grammar | topic | skill | practice | resource | mistake
status: todo | learning | mastered | review-needed
level: A1 | A2 | B1 | B2 | C1 | C2
last_updated: YYYY-MM-DD
---
```

The `level` field maps to CEFR for language learning. For non-language skills, use `beginner | intermediate | advanced`.

---

## Daily Workflows

### New Vocabulary

```
1. Encounter word  -> VOCAB_ note (definition, collocations, examples)
2. Link            -> TOPIC_ note(s)
3. Common error?   -> MISTAKE_ note
4. Spaced repetition: review at 1, 3, 7, 14, 30 days
```

### New Grammar

```
1. Study rule     -> GRAMMAR_ note
2. Source          -> link RESOURCE_
3. Practice       -> PRACTICE_ note
4. Errors found   -> MISTAKE_ notes
5. Link GRAMMAR_ -> TOPIC_ (which contexts use this rule)
```

### Practice Session

```
1. Pick TOPIC_    -> review linked VOCAB_ + GRAMMAR_
2. Exercise       -> PRACTICE_ note
3. Feedback       -> corrections table
4. Extract        -> new MISTAKE_ and VOCAB_ notes
```

### Weekly Review

```
1. INDEX          -> progress overview
2. VOCAB_ notes   -> spaced repetition check
3. MISTAKE_ notes -> resolved or recurring?
4. Status update  -> #learning -> #mastered
```

---

## INDEX.md Template

```markdown
---
type: hub
status: done
last_updated: YYYY-MM-DD
---

# ${Language/Skill} -- Knowledge Base

Tags: #done #system

> Goal: ${target} | Level: ${current} | Plan: ${hours/week}

## Topics
| Note | Status | Key Vocab |
|------|--------|-----------|
| [[TOPIC_...]] | ... | [[VOCAB_...]] |

## Grammar
| Note | Level | Status |
|------|-------|--------|
| [[GRAMMAR_...]] | ... | ... |

## Common Mistakes
| Note | Type | Status |
|------|------|--------|
| [[MISTAKE_...]] | ... | ... |

## Practice
| Note | Type | Score |
|------|------|-------|
| [[PRACTICE_...]] | ... | ... |

## Resources
| Note | Type | Progress |
|------|------|----------|
| [[RESOURCE_...]] | ... | ... |
```

---

## Checklist

- [ ] Correct prefix?
- [ ] Frontmatter (`type`, `status`, `level`, `last_updated`)?
- [ ] Tags after heading?
- [ ] Atomic -- one word, one rule, one topic?
- [ ] Cross-type `[[wikilinks]]`?
  - [ ] VOCAB -> TOPIC, MISTAKE?
  - [ ] GRAMMAR -> PRACTICE, MISTAKE?
  - [ ] PRACTICE -> VOCAB, GRAMMAR, MISTAKE?
- [ ] INDEX.md updated?
- [ ] Examples include both correct and incorrect?
