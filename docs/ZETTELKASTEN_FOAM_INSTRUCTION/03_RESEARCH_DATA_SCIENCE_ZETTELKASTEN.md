# Chapter 3 -- Research and Data Science

**Scope:** Academic research, machine learning, data analysis, experiments, paper writing, literature review.

**Prerequisite:** [Chapter 0 -- The Core Vibe](00_CORE_VIBE.md).

---

## Anti-Patterns

- **All papers in one list file** -- destroys linkability. Each paper is a node in your citation graph. One `LIT_` note per paper.
- **Experiments tracked in a spreadsheet** -- spreadsheets cannot link to concepts, models, or insights. Use `EXP_` notes with wikilinks.
- **Not recording failed experiments** -- negative results eliminate hypotheses. That is information. Create `EXP_` + `INSIGHT_` for failures.
- **Copy-pasting abstracts as literature notes** -- abstracts are written for journal reviewers, not for you. Rewrite in your own words with explicit relevance to your research question.
- **No links between experiments** -- experiments form chains: each informs the next. Without links, you lose the experimental trajectory.
- **Concepts scattered across literature notes** -- a concept (e.g., self-attention) appears in dozens of papers. It deserves its own `CONCEPT_` note that all `LIT_` notes link to.

---

## Vibe Coding Workflow

```
1. Read a paper     -> create LIT_Author2024_Title.md -> link [[CONCEPT_]]
2. Run experiment   -> create EXP_Name.md -> link [[MODEL_]], [[DATA_]]
3. Got a result     -> create RESULT_Finding.md -> link [[EXP_]]
4. Interpretation   -> create INSIGHT_Name.md -> link [[RESULT_]]
5. Update INDEX.md
```

---

## Why Zettelkasten for Research

**Citation graph as a navigable structure.** Paper A cites Paper B; both instantiate Concept C; Concept C is tested by Experiment D. These relationships exist implicitly in your reading. Wikilinks make them explicit, bidirectional, and traversable.

**Experiment chain continuity.** Research is iterative: Hypothesis, Experiment, Result, Insight, next Hypothesis. Each step is a note. The chain is a linked list. You can traverse it forward (what did I try next?) or backward (what motivated this experiment?).

**Paper writing as graph traversal.** When drafting, follow `QUESTION_ -> EXP_ -> RESULT_` chains to build the narrative. Follow `LIT_ -> CONCEPT_` chains for related work. Each note is a paragraph candidate. The outline is the graph topology.

---

## Project Layout

```
PROJECT_ROOT/
  docs/                    <- Zettelkasten (flat, no subfolders)
    INDEX.md
    LIT_*.md      CONCEPT_*.md   METHOD_*.md
    DATA_*.md     EXP_*.md       RESULT_*.md
    MODEL_*.md    METRIC_*.md    INSIGHT_*.md
    QUESTION_*.md TOOL_*.md      LOG_*.md
    _templates/
  notebooks/   data/   models/   src/   papers/
```

---

## Foam Graph Colors

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

## Note Types

- **`LIT_`** -- Literature. One paper, summarized in your own words. Example: `LIT_Vaswani2017_Attention.md`
- **`CONCEPT_`** -- Concept. Algorithm, theory, technique. Shared across papers. Example: `CONCEPT_Self_Attention.md`
- **`METHOD_`** -- Methodology. Research method, evaluation pipeline. Example: `METHOD_Cross_Validation.md`
- **`DATA_`** -- Dataset. Schema, splits, preprocessing, known issues. Example: `DATA_ImageNet_2012.md`
- **`EXP_`** -- Experiment. Single run with full reproducibility info. Example: `EXP_ResNet50_LR_Sweep.md`
- **`RESULT_`** -- Result. Quantitative finding from an experiment. Example: `RESULT_LR_0001_Best_F1.md`
- **`MODEL_`** -- Model. Architecture definition, hyperparameters, training config. Example: `MODEL_ResNet50_Pretrained.md`
- **`METRIC_`** -- Metric. Evaluation metric definition and interpretation. Example: `METRIC_F1_Score.md`
- **`INSIGHT_`** -- Insight. Interpretation of results, implications for next steps. Example: `INSIGHT_Dropout_Overfitting.md`
- **`QUESTION_`** -- Research Question. Hypothesis to test. Example: `QUESTION_BN_Small_Data.md`
- **`TOOL_`** -- Tool. Library, framework, infrastructure. Example: `TOOL_PyTorch_Lightning.md`
- **`LOG_`** -- Daily Log. Research journal entry. Example: `LOG_2026-04-22.md`

---

## The Research Knowledge Chain

Every research project has a core execution path. This is the link topology you are building:

```
QUESTION -> EXP -> RESULT -> INSIGHT
    |         |       |         |
   LIT  <-> CONCEPT <-> METHOD <-> MODEL
                         |
                       DATA
```

**Why this topology matters:** When writing a paper, the `QUESTION -> EXP -> RESULT -> INSIGHT` chain is your results section. The `LIT -> CONCEPT` edges are your related work. The `METHOD <-> MODEL <-> DATA` cluster is your methodology. The graph IS the paper structure.

---

## Templates

### LIT_ -- Literature Note

```markdown
# LIT_${Author}${Year}_${ShortTitle}

Tags: #todo #literature #${topic}

---

## Metadata

| Title | Authors | Year | Venue | DOI/URL |
|-------|---------|------|-------|---------|

## Summary

${Main contribution in YOUR words. Not the abstract.}

## Key Results

| Metric | Dataset | Value | Baseline |
|--------|---------|-------|----------|

## Relevance

${How this connects to YOUR research question}
Links: [[QUESTION_...]], [[EXP_...]]

## References to Follow
- [[LIT_...]] -- ${why}
```

**Why "your words" matters:** Paraphrasing forces comprehension. If you cannot restate the contribution in one paragraph, you did not understand the paper.

---

### EXP_ -- Experiment

```markdown
# EXP_${Name}

Tags: #todo #experiment #${topic}

---

## Hypothesis

${What you are testing}. Related: [[QUESTION_...]].

## Setup

| Model | Dataset | Optimizer | LR | Batch | Epochs | Seed |
|-------|---------|-----------|-----|-------|--------|------|
| [[MODEL_...]] | [[DATA_...]] | ... | ... | ... | ... | ... |

## Code

- Script: `src/experiments/${name}.py`
- Commit: `${git_hash}`

## Results

| [[METRIC_...]] | Train | Val | Test |
|-----------------|-------|-----|------|

## Conclusion

${Did the hypothesis hold?}
Next: [[EXP_...]] | Insight: [[INSIGHT_...]]
```

**Why seed and commit are mandatory:** Without them, the experiment is not reproducible. An irreproducible experiment is an anecdote, not evidence.

---

### CONCEPT_ -- Concept

```markdown
# CONCEPT_${Name}

Tags: #todo #concept #${topic}

---

## Definition
${In your own words}

## Intuition
${Why does this work? What is the core mechanism?}

## Where Used
- [[MODEL_...]] -- ${how}
- [[METHOD_...]] -- ${context}

## Sources
- [[LIT_...]] -- introduced this concept
```

---

### DATA_ -- Dataset

```markdown
# DATA_${Name}

Tags: #todo #dataset #${topic}

---

## Overview

| Name | Source | Size | Features | Target | License |
|------|--------|------|----------|--------|---------|

## Schema

| Column | Type | Description | Missing % |
|--------|------|-------------|-----------|

## Splits

| Split | Size | Method |
|-------|------|--------|

## Known Issues
- ${Class imbalance, noise, label errors}

## Used In
- [[EXP_...]], [[MODEL_...]]
```

---

## Daily Workflows

### Literature Review

```
1. Read paper        -> LIT_ note (your words, not the abstract)
2. Extract concepts  -> CONCEPT_ notes (if not already existing)
3. Link: LIT -> CONCEPT, METHOD, cited papers
4. Record relevance to QUESTION_
```

### Experiment Cycle

```
1. Hypothesis        -> link to QUESTION_
2. EXP_ note         -> BEFORE running (setup, params, commit)
3. Run               -> update with results
4. Significant?      -> RESULT_ note
5. Interpretation    -> INSIGHT_ note
6. Chain: EXP -> RESULT -> INSIGHT -> next EXP
```

### Paper Writing

```
1. INDEX             -> review knowledge base
2. QUESTION -> EXP -> RESULT chains -> results section
3. LIT -> CONCEPT chains -> related work
4. Each note = one paragraph candidate
```

---

## INDEX.md Template

```markdown
---
type: hub
status: done
last_updated: YYYY-MM-DD
---

# ${Project} -- Knowledge Base

Tags: #done #system

> Topic: ${research topic} | Phase: ${current phase}

## Research Questions
| Note | Status |
|------|--------|
| [[QUESTION_...]] | ... |

## Literature
| Note | Key Contribution |
|------|------------------|
| [[LIT_...]] | ... |

## Experiments
| Note | Status | Result |
|------|--------|--------|
| [[EXP_...]] | ... | [[RESULT_...]] |

## Key Insights
| Note | Implication |
|------|-------------|
| [[INSIGHT_...]] | ... |
```

---

## Checklist

- [ ] Correct prefix?
- [ ] Frontmatter (`type`, `status`, `last_updated`)?
- [ ] Tags after heading?
- [ ] Atomic -- one entity?
- [ ] Cross-layer `[[wikilinks]]`?
- [ ] INDEX.md updated?
- [ ] LIT_ notes written in your own words with relevance?
- [ ] EXP_ notes include seed, commit, config?
