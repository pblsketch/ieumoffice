---
name: public-notice
description: 'Write a clear public notice, announcement, or operational bulletin where readers immediately grasp who is affected, what changes, when it happens, what action is required, and whom to contact. Works across Hangul, Word, HTML, and Markdown.'
metadata:
  ieum-craft: typography korean-office anti-ai-slop
  ieum-example: '다음 주 토요일 오전 2시~5시 사내 시스템 정기 점검 안내문을 정중한 어조로 작성해 주세요.'
---

# Writing a public notice or announcement

Readers scan notices in seconds. Put the key action and schedule first, then details.

## 1. Clarify only if critical facts are missing

If key operational details (audience, effective date/time, required action, contact) are ambiguous, ask once via `ask_questions`. If the user supplied the essentials, draft directly and mark any truly absent contact slot cleanly for user confirmation in your reply.

## 2. Standard notice layout

1. **Clear title:** names the event or change directly.
2. **Summary block (5W1H):** Target audience, Date/Time, Location/Scope, Required Action.
3. **Details & Impact:** concise bullet list of what changes and what stays unaffected.
4. **Preparation / Action Required:** numbered steps if readers must act before or after.
5. **Contact & Inquiries:** responsible team, channel, and operating hours.

## 3. Tone and clarity

- Keep sentences polite, concise, and free of ambiguity.
- Write dates with day of week and exact time zone or 24-hour format when helpful.
- Avoid jargon unless the audience uses it daily.

## 4. Check before you answer (required)

- Who, what, when, and required action are visible at the top without scrolling.
- Dates, times, and contact details match the user's prompt verbatim.
- No leftover placeholder strings or decorative clutter remain.
- Briefly note any optional detail (such as contact phone/email) the user should fill in before sending.
