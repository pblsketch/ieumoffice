---
name: whiteboard
description: 'Build and organize a clear whiteboard from a topic, notes or an attached document: pick the board framework and page format that fit the goal, lay out zones, sticky notes, cards, tables and connectors with short labels and semantic colour, then check the board for overlaps, cut-off text and stray links. Use for brainstorming, affinity maps, workshops, retrospectives, Kanban boards, 2x2 prioritization matrices, journey maps, storyboards and visual canvases.'
metadata:
  ieum-editors: whiteboard
---

# Designing a whiteboard

A whiteboard turns messy notes, workshops or source material into a scannable spatial workspace: what groups together, what comes first, and what leads to what. This skill covers framework choice, layout rules and verification; how the tools and swatches work is already in your instructions.

The tool names below are those of the whiteboard editor's AI panel. In another window, do the same steps with the tools that window gives you.

## 1. Choose the framework and page format

| Goal | Framework | Format | Structure |
| --- | --- | --- | --- |
| Collect and group ideas | Affinity map | `freeform` | 3–5 themed sticky columns |
| Sprint / project retro | Retrospective | `freeform` or `wide_16_9` | 3 prompt columns (Went Well / Improve / Actions) |
| Track tasks or stages | Kanban board | `freeform` or `wide_16_9` | 3–4 stage columns with uniform cards/stickies |
| Prioritize trade-offs | 2×2 matrix | `wide_16_9` or `freeform` | 2×2 `grid` of equal quadrants + axis labels |
| Strategy / product canvas | SWOT / Lean | `wide_16_9` or `a4_landscape` | Labelled zone grid with concise stickies |
| User / service journey | Journey map | `freeform` or `custom` | Stages left to right, layers top to bottom |
| Visual sequence / pitch | Storyboard | `wide_16_9` | 4–6 numbered frames left to right (`F5` ready) |
| Compare options / owners | Table + callouts | `a4_landscape` or `wide_16_9` | One `table` + key takeaway stickies |
| Printable workshop sheet | Handout | `a4_portrait` or `a4_landscape` | Starter zones with brief on-board prompts |

One page answers one stage or topic. Past ~25–30 items — or across distinct workshop phases — split across pages.

## 2. Before you build

- **Top-left entry:** start with a `title` (28–32 px) at top-left and an optional one-line prompt `text` (16–18 px) beneath it. Flow left to right for timelines, Kanban, journeys and storyboards; top to bottom for clusters and priority stacks.
- **One idea per sticky:** 1–3 short lines (< ~15 words or ~40 Korean chars); no paragraphs. Keep sibling stickies uniform (`height` ≥ 160 for 2–3 lines so text never clips); use `card` for longer notes or `link` for sources.
- **Real facts and parallel form:** match sibling headings in form and keep the user's terms. Never invent names, dates or figures; for a live workshop template, include a short prompt line, 1–2 starter stickies (`(add idea)`), a colour legend and a small "Parking Lot" zone.
- **Whitespace:** leave 24–36 px between siblings and 32–60 px between zones.

## 3. Build cleanly with `apply_template` and `edit_board`

- Set `target` to `current_page` when filling the open blank page — omitting it defaults to `new_pages` and leaves Page 1 empty. On an empty page `current_page` also sets page title, format, size and background; on a non-empty page it appends below existing items without altering page settings.
- Use a horizontal `stack` for side-by-side column zones so blocks below clear the tallest zone. In a multi-row `grid` of zones (2×2 matrix, SWOT), give each `zone` an explicit `height` tall enough for its children so row 2 clears row 1.
- **Zone headings:** shapes — including `zone` — centre text vertically. When a `zone` has `children`, leave its `title` empty and add a `text` heading as its first child; set `zone.title` only on empty drop boxes.
- **Zone width:** `zone` defaults to ≥ 420 px wide (2–4 cols fit on 1920 px). For 5+ cols, set a smaller `width` or widen a `custom` page.
- **Connectors:** omitting `anchorX`/`anchorY` attaches to `(0.5, 0.5)` and crosses text. Anchor to facing edges (`1, 0.5` → `0, 0.5`; `0.5, 1` → `0.5, 0`), pick `routing` (`curved`, `elbow`, `straight`), and keep labels to 1–3 words. Use `edit_board` for dashed/dotted lines or `waypoints`.
- **Tables:** pass `data: [["H1","H2"],["v1","v2"]]` (`headerRow: true`). Columns share equal width and cells do not wrap: keep ≤ 5–6 cols, short phrases, `width` ≥ `160 × cols`, `height` ≥ `48 × rows`.

```json
{
  "schemaVersion": 1, "title": "Sprint 14 Retro", "target": "current_page",
  "pages": [{
    "key": "retro", "title": "Sprint 14 Retro", "format": "wide_16_9",
    "background": { "kind": "grid", "color": "#FFFDF8", "pattern": "dot" },
    "blocks": [
      { "type": "title", "key": "hdr", "text": "Sprint 14 Retrospective", "fontSize": 32, "color": "#1F1D1A" },
      {
        "type": "stack", "key": "cols", "direction": "horizontal", "gap": 32,
        "children": [
          { "type": "zone", "key": "z_keep", "fill": "#F7F5F0", "stroke": "#C7C0B3", "padding": 24, "children": [
            { "type": "text", "key": "h_keep", "text": "Went Well", "fontSize": 20, "color": "#1F1D1A", "height": 40 },
            { "type": "sticky", "key": "s1", "color": "#CCF0D2", "text": "Fast PR reviews (< 4h)" }
          ]},
          { "type": "zone", "key": "z_fix", "fill": "#F7F5F0", "stroke": "#C7C0B3", "padding": 24, "children": [
            { "type": "text", "key": "h_fix", "text": "To Improve", "fontSize": 20, "color": "#1F1D1A", "height": 40 },
            { "type": "sticky", "key": "s2", "color": "#FFD1D8", "text": "Flaky E2E test suite" }
          ]},
          { "type": "zone", "key": "z_act", "fill": "#F7F5F0", "stroke": "#C7C0B3", "padding": 24, "children": [
            { "type": "text", "key": "h_act", "text": "Action Items", "fontSize": 20, "color": "#1F1D1A", "height": 40 },
            { "type": "sticky", "key": "s3", "color": "#FFF3A1", "text": "Split E2E retries — Mina" }
          ]}
        ]
      },
      { "type": "connector", "key": "c1", "routing": "curved", "color": "#475569", "label": "action",
        "from": { "key": "s2", "anchorX": 1, "anchorY": 0.5 }, "to": { "key": "s3", "anchorX": 0, "anchorY": 0.5 } }
    ]
  }]
}
```

## 4. Semantic colour, shapes and stickers

Use ≤ 3–4 semantic colours per board. When 2+ colours carry meaning, add a legend and pair colour with a heading or tag (`[Risk]`) so meaning never relies on colour alone:

- **Sticky roles:** `#FFF3A1` (ideas/actions), `#CCF0D2` (wins/done), `#FFD1D8` (risks/pain points), `#CBE4FF` (context/questions), `#FFDAB3` (owners/milestones), `#E3D7FF` (themes/insights), `#C2EFEA` (experiments), `#FFFFFF` (neutral/legends).
- **Shapes (`rectangle`, `rounded_rectangle`, `ellipse`, `triangle`, `diamond`, `star`, `speech_bubble`, `block_arrow`):** one role per shape — `rounded_rectangle` steps/cards, `diamond` decisions, `ellipse` hubs, `speech_bubble` quotes, `block_arrow` transitions.
- **Stickers:** use sparingly: `one`, `two`, `three` (steps); `star`, `fire`, `thumbsup` (votes); `bulb` (insights); `flag` (milestones); `check` (done); `clock` (deadlines); also `heart`, `trophy`, `medal`, `rocket`, `sparkle`, `arrow`, `speech`, `pencil`, `book`.
- **Images:** add only when asked or needed (`search_images` + `insert_image` for photos, `generate_image` for illustrations).

## 5. Editing an existing board, and limits

- Use `edit_board` (`add`, `update`, `move`, `delete`, `add_page`, `rename_page`, `delete_page`, `set_page_format`) for targeted edits; keep user strokes, PDF backgrounds, images and layout intact unless asked to reorganize.
- Omit coordinates in `add` for auto free-space placement, or pass `near` (`right`, `below`, `left`, `above`). Edit table cells with `update` + `tablePatch`. Push a new frame behind notes with `move` (`toBack`); zones are background shapes, not containers, so moving or deleting a zone leaves items on top behind.
- **Limits:** cannot lock objects, import a PDF background, fetch link previews (opt-in in the editor), embed a new image URL in `apply_template` (use `insert_image` or `generate_image`), rename the board document title once set (use `rename_page`), or delete the last page. Mention helpful editor actions (toolbar PDF import, `F5` presentation mode).

## 6. Check before you answer (required)

Call `read_board` after building or major edits (and inspect the rendered image when vision is active). Fix what fails with `edit_board`, then answer:

- **No overlaps:** sibling stickies, cards, shapes, tables, images and links do not intersect (a `zone` behind its items is expected) and keep ≥ 24 px gap.
- **Visible headings:** no `zone` carries text hidden behind its children.
- **Clean connectors:** valid ids, anchored to facing edges (not across text), no stray ends.
- **Legible text:** stickies hold one idea in 1–3 short lines; table cells are short single lines; shape labels fit.
- **In-bounds fixed pages:** on `wide_16_9`, `a4_portrait` and `a4_landscape`, every object stays inside `0 … width` by `0 … height` with margin.
- **Grounded and disciplined:** facts match the request/material; ≤ 3–4 semantic colours with a legend when colours carry meaning.

Reply in one or two sentences stating what the board holds (pages, framework, item count), what you assumed, and any useful next editor action (such as `F5` presentation mode).
