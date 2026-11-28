---
name: table-summary
description: 'Turn messy lists, notes, or raw records into a clean comparison or summary table with explicit units, consistent column types, right-aligned numbers, totals/highlights, and a concise takeaway paragraph above the table.'
metadata:
  ieum-editors: docs hwp sheets markdown
  ieum-craft: layout-hierarchy korean-office anti-ai-slop
  ieum-example: '아래 5개 후보 업체의 견적 메모를 항목별 비교표와 핵심 요약 3줄로 정리해 주세요.'
---

# Organizing and summarizing tables

Convert unstructured notes or multi-source data into a scannable, decision-ready table.

## 1. Clarify comparison axes only if ambiguous

If the user did not specify grouping criteria or comparison columns and multiple valid groupings exist, ask once with `ask_questions`. Otherwise infer the cleanest columns from the data.

## 2. Table design rules

1. **Lead with a 2–3 line takeaway** explaining the main pattern, winner, or anomaly before the table.
2. **Keep columns focused:** 3–6 columns with clear, short headers and explicit units in headers (e.g., `(만원)`, `(%)`, `(일)`).
3. **Normalize values:** keep date formats, decimal precision, and units consistent down every column.
4. **Handle missing values honestly:** write `-` or `확인 필요` instead of guessing or fabricating figures.
5. **Totals and averages:** add a summary row only when arithmetic aggregation is meaningful and verified.

## 3. Editor awareness

- In **Word / Hangul**, keep header rows clearly styled and avoid cramped merged cells that break printing.
- In **Sheets**, use real formulas (`SUM`, `AVERAGE`) instead of hardcoded totals whenever numeric columns exist.
- In **Markdown**, align numeric columns right (`---:`) and keep cells single-line.

## 4. Check before you answer (required)

- Every figure matches the source data verbatim with verified totals.
- Column headers state units clearly and missing cells are marked honestly.
- A brief narrative summary precedes the table and no placeholder text remains.
