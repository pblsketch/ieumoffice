---
name: presentation-deck
description: 'Plan and build an executive-ready presentation deck tailored to four core purposes (weekly report, proposal, lecture/workshop, or product overview) with clear slide hierarchy, restrained visual density, CJK-safe typography, and optional speaker-notes separation.'
metadata:
  ieum-editors: slides html
  ieum-craft: typography color layout-hierarchy anti-ai-slop cjk-typography
  ieum-example: '2분기 신제품 출시 전략을 임원진 대상으로 8장 분량 제안서 덱으로 구성해 주세요.'
---

# Building a presentation deck

Design slides that communicate one clear message per page with disciplined visual hierarchy.

## 1. Clarify purpose and constraints (at most once)

When audience, deck purpose, target slide count, or visual tone is unclear, call `ask_questions` once before generating. Otherwise proceed directly.

## 2. Choose the matching deck structure

If the user already selected a deck structure in the UI (provided in the system prompt), follow that selected structure instead of picking another. Otherwise pick one of the four purpose-specific structures (orthogonal to visual theme):

- **Weekly Report (~6 slides):** Cover → Executive Summary → Key Metrics → Completed Work → Risks & Decisions → Next Week Plan.
- **Proposal (~8 slides):** Cover → Problem & Opportunity → Proposed Solution → Workflow/Architecture → Expected Impact → Roadmap & Milestones → Resources & Risks → Decision Ask.
- **Lecture / Workshop (~7 slides):** Cover → Learning Objectives → Big Picture → Core Concept 1 → Core Concept 2 → Guided Practice → Summary & Takeaways.
- **Product Overview (~7 slides):** Cover → The Challenge → Core Capabilities → How It Works → Use Cases → Trust & Readiness → Next Steps.

## 3. Slide craft and speaker notes

- Keep one clear takeaway per slide; use action-oriented headlines rather than vague topic labels.
- Respect the bottom footer/page-number rail; never let body text or cards collide with the footer area.
- Never apply synthetic italics to Korean, Japanese, or Chinese runs; use weight or accent color instead.
- If speaker-notes separation is enabled, keep on-slide copy ultra-concise and place detailed commentary in speaker notes.

## 4. Check before you answer (required)

- Every slide matches the planned arc and carries a distinct, readable headline.
- No body element crosses the footer rail, no CJK run uses synthetic italics, and cover/hero layouts stay balanced.
- No placeholder copy, invented metrics, default indigo fills, or emoji icons in headings remain.
- Summarize the slide count, chosen deck structure, and any visual/content follow-ups.
