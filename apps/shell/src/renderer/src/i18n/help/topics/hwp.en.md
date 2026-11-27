# Hangul (HWP / HWPX): editing, workpane and printing

GenOffice opens and edits `.hwp` and `.hwpx` Hangul documents in a tab, with keyboard shortcuts, styles, tables, memos, printing, and an AI panel. Everything runs locally on your PC.

## Opening, saving and printing

- Opens `.hwp` and `.hwpx` files from Home, **File > Open**, dragging onto the window, or Google Drive; converts PDFs into new Hangul tabs via **File > Import PDF**.
- Saves back in the opened file's format (`.hwp` stays `.hwp`, `.hwpx` stays `.hwpx`), keeps a `.bak` backup before the first overwrite, checks HWP read-back, and keeps AutoSave and crash-recovery copies.
- Print (Ctrl+P) supports live preview, PDF export, and multi-page print layout options.

## Left workpane: Outline, Find and References

- Open the left workpane from the top-bar button, **View > Workpane** (Outline / Find / References), or press **Ctrl+F** to jump straight to the Find tab. Traditional Find (**Ctrl+Q,F**) and Find & Replace (**Ctrl+H**) stay available.
- **Outline tab**: lists native Hangul outline headings and style-mapped headings (default `제목 N` / `Heading N`, customizable per document or app-wide in the Outline settings drawer). Filter by level (`1`, `2`, `3`, ... All), fold branches, click to jump, promote or demote headings (with subheadings by default, or hold **Shift** for a single heading), and drag headings to reorder whole sections in one undo step.
- **Find tab**: searches across body text, tables (including nested tables), text boxes, footnotes, and endnotes (excluding headers and footers) with case sensitivity, whole word, regular expressions, paragraph style, and character formatting filters. Click a result to jump and select it, or replace one, selected, or all matches in a single undo step (skipping inline objects and citation marks with a count).
- The workpane remembers its open state, active tab, and width, folds into an icon rail on narrow windows, and hides in presentation mode and print preview. All workpane features work without AI.

## Memos, shortcuts and AI panel

- Open the Memo column from the top bar or **Insert > Memo** to read, add, edit, and delete plain-text memos alongside the document.
- Supports Hangul editing shortcuts, horizontal ruler paragraph markers, Format Copy (**Alt+C**), Hanja conversion (**F9** / Hanja key), and Document Info (**Ctrl+Q,I**).
- The optional AI panel and [terminal commands](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) can read and edit text, styles, tables, equations, page layout, outlines, and search results; each AI edit is a single undo step.

## Table of Contents: create and refresh

- Use **Tools > Create Table of Contents** (or **Tools > Refresh Table of Contents**, or right-click inside a table of contents) to insert a document **Table of Contents** from headings shown in Outline, as well as **List of Tables**, **List of Figures**, and **List of Equations** from object captions and caption paragraphs.
- Choose **Dotted tab leader** (default) or **Borderless table** (2-column) layout, set the heading depth (levels 1–10, default 3), customize the title, and optionally include clickable links (click or **Ctrl+click** a line to jump straight to that heading).
- Page numbers match printed page numbering, including new-number starts and Roman or custom number formats.
- Refreshing updates entries and page numbers in place, warns you before overwriting manually edited lines, and detects existing unmarked tables of contents created in another program so you can review and confirm before replacing them.

## Index: mark entries and build

- Use **Tools > Mark Index Entry** (or right-click in body text) to mark the selected word or the word at the cursor, add an optional subentry, or enable **Mark all matching occurrences** (body text only; reports how many matches inside tables, text boxes, and notes were skipped). You can also view and delete existing marks in the same dialog.
- Use **Tools > Create Index** to insert an index at the cursor, and **Tools > Refresh Index** to update it after edits. The default title ("Index") can be customized.
- Entries are sorted in Korean 가나다 → English ABC → Other order, with optional consonant/letter group headings, 1–3 columns (default 2 columns, scoped only to the index so the rest of the document's column layout stays unchanged), and **Dotted tab leader** or **Borderless table** layout.

## Outdated notice and Save as Submission Copy

- When you manually Save, Print, Export as PDF, or Save as Submission Copy, the editor checks whether any tables of contents or the index are out of date and offers to refresh all of them in a single undo step. This check never runs during AutoSave and never blocks saving.
- Use **File > Save as Submission Copy** to save a separate clean copy stripped of internal editing marks (index marks, index block marks, and saved settings) while keeping tables of contents, heading anchors, and TOC links intact. Your original working file remains untouched so you can keep refreshing it later.

## References and citations

- Open the **References** tab in the left workpane (or **Tools > References**) to manage a single local reference library on your PC with search, tags, add/edit/delete, import and export (`BibTeX`, `RIS`, `CSL JSON`), and line-by-line import from an existing document reference list with a preview step before adding.
- Supports four citation styles (**APA 7**, **Chicago**, **MLA 9**, and **IEEE**; Korean references follow Korean academic formatting across all four styles). Insert parenthetical, narrative, or multi-entry citations with page locators and build or refresh a hanging-indent bibliography; switching styles updates marked citations and the bibliography in a single undo step while keeping manually edited citations untouched.
- Use the built-in 6-point audit tab (missing from bibliography, uncited entries, sort order, missing a/b suffixes, manual citation edits, and unverified items) to jump straight to each issue, alongside outdated bibliography and IEEE numbering notices before manual save, print, or export.
- Optional AI reference search (when internet tools are enabled) always adds candidates as **Unverified** with the source URL stored in notes; unverified items cannot be cited or included in a bibliography until you review and mark them **Verified** yourself.

## Macros: key recording and scripts

- Use **Tools > Macros** (or press **Alt+Shift+H** to start or stop key recording, and **Alt+Shift+X** to stop) to record typed text, cursor navigation, formatting, styles, tables, and supported edits directly into an editable script. A recording indicator appears in the top bar while recording, and unsupported actions or mouse clicks are announced right away and listed as skipped when recording stops.
- Open the **Macro Manager** to manage locally saved macros, assign up to 11 shortcut slots (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), edit scripts with syntax error line and column feedback, and export or import plain-text `.ieummacro` files. Imported scripts are shown in full and must be confirmed and saved before they can run; macros embedded inside document files are never read or run.
- Every macro runs synchronously inside a restricted interpreter supporting the app document API and compatible macro script objects (`HAction`, `HParameterSet`), with time, step, call depth, and memory limits as well as object and memo protection. A single run is always one undo step and rolls back completely if any error, unsupported action, or limit occurs.
- Optional **Write with AI** (shown in the Macro Editor only when AI is enabled) lets you describe a repetitive task to draft a script; only your description and the macro API reference are sent (never the document). Generated drafts appear in the editor box only and are never automatically saved or run.
