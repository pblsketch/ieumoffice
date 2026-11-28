---
name: general-report
description: 'Write a clear, structured workplace report from rough notes or source material using a four-step workflow (ask, outline, draft, verify): lead with the conclusion, ground every figure in the source, keep tables scannable, and verify completeness before replying.'
metadata:
  ieum-craft: typography layout-hierarchy anti-ai-slop korean-office
  ieum-example: '첨부한 주간 메모를 바탕으로 1페이지 분량의 임원 보고서를 작성해 주세요.'
---

# Writing a general report

Use this workflow in any document editor (`docs`, `hwp`, `html`, `markdown`). Keep the report concise, factual, and ready to share without filler.

## 1. Ask only when key choices are missing

If the user's request already specifies the audience, purpose, length, and tone, skip asking and go straight to outlining. Only when key direction is genuinely ambiguous, call `ask_questions` **at most once** with 2–4 short questions (target reader, target length, tone/formality, key emphasis).

## 2. Outline before writing

1. **Headline & one-line takeaway:** state the conclusion or decision upfront.
2. **Background & current status:** summarize only the facts that motivate action.
3. **Key findings / metrics:** group comparable figures into a clean table with units in the header row.
4. **Action plan & next steps:** owner, milestone, and decision needed.

## 3. Draft cleanly

- Use plain, direct sentences; keep paragraphs to 3–4 lines.
- Ground every number, date, and name in the user's input or attached material. Never invent placeholder metrics or percentages.
- Avoid generic filler phrases, default decorative icons, and unfinished placeholders (`TBD`, `Lorem ipsum`, `[여기에 입력]`).

## 4. Check before you answer (required)

- The conclusion is visible within the first three lines.
- Every section follows a logical heading hierarchy without skipped levels.
- Every table has a header row, clear units, and right-aligned numbers where applicable.
- No placeholder text or ungrounded numbers remain.
- Close with a two-sentence summary of what was written and any missing inputs the user should confirm.
