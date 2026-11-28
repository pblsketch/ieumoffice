# File operations: rename, delete, export

This chapter covers the file operations shared by every editor; each editor's own export options are in its chapter.

The row's **⋯ menu** (hover a file row) gathers these actions:

![A file row's ⋯ menu](img/file-ops.png)

## Rename

Two entry points, one set of checks:

- Home's row **⋯ ▸ Rename**.
- **Double-click a file tab** to rename inline (see [Tabs and window management](help://tabs-and-windows)).

Rules: the extension is preserved automatically; illegal characters, trailing dots and reserved names (CON/NUL and friends) are rejected with a message; a same-folder name conflict is blocked too. The real file on disk is renamed, and recents and stars follow.

## Delete

- Home **⋯ ▸ Delete**: asks which files, then moves them to the **system trash**, where the OS can restore them. GenOffice keeps no undo of its own for this — recovery is the trash's job, not a toast's.

## Duplicate

**⋯ ▸ Duplicate** creates <name> copy in the same folder; collisions append a counter automatically. The copy is added to **Recent** rather than opened for you, so it is one click away instead of in front of you.

## Save and Save As

- **⌘S / ctrl+S** saves the current file; an untitled file asks for location and name first.
- In most editors the file type list in the Save As dialog also offers the export formats (PDF, images, other document formats). Picking one of those writes a copy only; the open document and its tab stay on the original file. Images of several pages are split into `name-01.png`, `name-02.png`, ….
- **Docs**: the Save As list also offers .hwp and .hwpx (File ▸ Export as HWP Document… does the same). If something cannot be carried over, such as comments, equations or text boxes, you are told before the file is written.
- **Save As** writes a new file and leaves the original untouched; subsequent edits target the new file.
- Every save is atomic (temp file + rename); a mid-write quit cannot corrupt the file.
- Autosave follows each editor's toggle; a new document with no file of its own starts after its first save (see [Quick start](help://getting-started)).

## Export to PDF

- **Docs**: File ▸ Export as PDF (or the ribbon button), paginated as laid out.
- **Slides**: export rasterizes page by page, with progress for large decks.
- **Sheets**: export follows print pagination.
- Exports render in a hidden window and land wherever you choose.

## Export to Word / images

- **PDF ▸ Convert to Word**: turns the PDF into a .docx (converted locally; complex layouts are best-effort).
- **Docs** can export pages as images (PNG per page).

## Print

File ▸ Print (⌘P/ctrl+P) opens a print window with live preview in every editor — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram and Whiteboard. When nothing under Page layout is changed and you print through the system dialog, printing behaves the same way as before.

- **Destination (printer, PDF, images)**: pick an installed printer, **Save as PDF**, **Save as images**, or the **System print dialog** from one list. Image export supports PNG and JPG (High 90%, Medium 80%, Small file 65%), writing separate numbered files or a single ZIP archive for multi-page jobs. Documents with permission restrictions disable both PDF and image saving while keeping printing available.
- **Live print preview**: all ten editors show a live preview before output. When layout arrangement, grayscale, watermarks or headers and footers change the output faces, the preview renders the actual arranged faces on demand with page navigation, zoom and a layout diagram toggle.
- **Layout**: choose One page per sheet, Several pages per sheet (2, 4, 6, 9 or 16, with optional page borders), Booklet (left or right binding), Poster (columns × rows, overlap, cut lines and tile coordinate labels) or Labels (one page per label or repeat one page, start cell, A4 presets or custom dimensions).
- **Scale, orientation, sides and order**: pick Actual size (100%), Fit to paper, Shrink oversized pages or Custom scale (10%–400%), and force Auto, Portrait or Landscape sheet orientation. Odd sides only, Even sides only and Reverse order are counted on the final arranged sides.
- **Watermark, headers/footers, grayscale and resolution**: add a print-only text or image watermark and 6-slot headers and footers (title, date, page number or custom text) onto the final output faces without editing the document. Grayscale and DPI (Auto, 150, 300 or 600 dpi) control rasterized output quality.
- **Page ranges and selection**: Docs and Markdown print selected text repaginated from page 1; Slides prints selected slides; PDF prints selected pages; Hangul supports All, Current page or Custom ranges; Sheets prints active sheets, workbook or selection.
- **System print window**: for a booklet, choose two-sided printing flipped on the short edge. Leave page range and pages per sheet in the system window untouched.

PDFs print with the current page order and rotations.

## Where untitled files live

The location you pick at the first save is its home. Until then the document has no file of its own: its unsaved content is kept only as a recovery copy in the app's data folder, so it can come back if the app shuts off suddenly (see [Tabs and windows](help://tabs-and-windows)). Autosave takes over only after that first save.
