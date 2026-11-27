# Hangul (HWP / HWPX): editing, workpane and printing

GenOffice opens and edits `.hwp` and `.hwpx` Hangul documents in a tab, with keyboard shortcuts, styles, tables, memos, printing, and an AI panel. Everything runs locally on your PC.

## Opening, saving and printing

- Opens `.hwp` and `.hwpx` files from Home, **File > Open**, dragging onto the window, or Google Drive; converts PDFs into new Hangul tabs via **File > Import PDF**.
- Saves back in the opened file's format (`.hwp` stays `.hwp`, `.hwpx` stays `.hwpx`), keeps a `.bak` backup before the first overwrite, checks HWP read-back, and keeps AutoSave and crash-recovery copies.
- Print (Ctrl+P) supports live preview, PDF export, and multi-page print layout options.

## Left workpane: Outline and Find

- Open the left workpane from the top-bar button, **View > Workpane** (Outline / Find), or press **Ctrl+F** to jump straight to the Find tab. Traditional Find (**Ctrl+Q,F**) and Find & Replace (**Ctrl+H**) stay available.
- **Outline tab**: lists native Hangul outline headings and style-mapped headings (default `제목 N` / `Heading N`, customizable per document or app-wide in the Outline settings drawer). Filter by level (`1`, `2`, `3`, ... All), fold branches, click to jump, promote or demote headings (with subheadings by default, or hold **Shift** for a single heading), and drag headings to reorder whole sections in one undo step.
- **Find tab**: searches across body text, tables (including nested tables), text boxes, footnotes, and endnotes (excluding headers and footers) with case sensitivity, whole word, regular expressions, paragraph style, and character formatting filters. Click a result to jump and select it, or replace one, selected, or all matches in a single undo step (skipping inline objects and citation marks with a count).
- The workpane remembers its open state, active tab, and width, folds into an icon rail on narrow windows, and hides in presentation mode and print preview. All workpane features work without AI.

## Memos, shortcuts and AI panel

- Open the Memo column from the top bar or **Insert > Memo** to read, add, edit, and delete plain-text memos alongside the document.
- Supports Hangul editing shortcuts, horizontal ruler paragraph markers, Format Copy (**Alt+C**), Hanja conversion (**F9** / Hanja key), and Document Info (**Ctrl+Q,I**).
- The optional AI panel and [terminal commands](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) can read and edit text, styles, tables, equations, page layout, outlines, and search results; each AI edit is a single undo step.
