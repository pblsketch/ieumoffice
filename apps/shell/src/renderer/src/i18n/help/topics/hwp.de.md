# Hangul (HWP / HWPX): Bearbeiten, Arbeitsbereich und Drucken

GenOffice öffnet und bearbeitet `.hwp`- und `.hwpx`-Hangul-Dokumente in einem Tab – mit Hancom-Hangul-2024-Tastenkürzeln, Formatvorlagen, Tabellen, Memos, Druckfunktionen und einem KI-Bereich. Alles läuft lokal auf Ihrem PC.

## Öffnen, Speichern und Drucken

- Öffnet `.hwp`- und `.hwpx`-Dateien über Start, **Datei > Öffnen**, per Ziehen ins Fenster oder aus Google Drive; wandelt PDFs über **Datei > PDF importieren** in neue Hangul-Tabs um.
- Speichert im ursprünglichen Dateiformat (`.hwp` bleibt `.hwp`, `.hwpx` bleibt `.hwpx`), legt vor dem ersten Überschreiben eine `.bak`-Sicherung an, prüft das Wiedereinlesen von HWP-Dateien und verwaltet automatische Speicher- sowie Wiederherstellungskopien.
- Drucken (Strg+P) unterstützt Live-Vorschau, PDF-Export und mehrseitige Drucklayout-Optionen.

## Linker Arbeitsbereich: Gliederung und Suchen

- Öffnen Sie den linken Arbeitsbereich über die Schaltfläche in der oberen Leiste, **Ansicht > Arbeitsbereich** (Gliederung / Suchen) oder drücken Sie **Strg+F**, um direkt zum Tab Suchen zu springen. Das klassische Suchen (**Strg+Q,F**) sowie Suchen und Ersetzen (**Strg+H**) bleiben verfügbar.
- **Tab Gliederung**: zeigt native Hangul-Gliederungsüberschriften sowie über Formatvorlagen zugeordnete Überschriften an (standardmäßig `제목 N` / `Heading N`, pro Dokument oder anwendungsweit in den Gliederungseinstellungen anpassbar). Filtern Sie nach Ebene (`1`, `2`, `3`, ... Alle), klappen Sie Zweige ein, springen Sie per Klick dorthin, stufen Sie Überschriften höher oder tiefer (standardmäßig samt Unterüberschriften, mit gedrückter **Umschalttaste** nur für eine einzelne Überschrift) und ziehen Sie Überschriften, um ganze Abschnitte in einem einzigen Rückgängig-Schritt neu anzuordnen.
- **Tab Suchen**: durchsucht Fließtext, Tabellen (einschließlich verschachtelter Tabellen), Textfelder, Fußnoten und Endnoten (ohne Kopf- und Fußzeilen) mit Filtern für Groß-/Kleinschreibung, ganzes Wort, reguläre Ausdrücke, Absatzvorlage und Zeichenformatierung. Klicken Sie auf einen Treffer zum Anspringen und Markieren oder ersetzen Sie einen, ausgewählte oder alle Treffer in einem einzigen Rückgängig-Schritt (Inline-Objekte und Zitatmarkierungen werden mit Zähler übersprungen).
- Der Arbeitsbereich merkt sich Öffnungszustand, aktiven Tab und Breite, klappt in schmalen Fenstern zu einer Symbolleiste ein und blendet sich im Präsentationsmodus sowie in der Druckvorschau aus. Alle Funktionen des Arbeitsbereichs arbeiten ohne KI.

## Memos, Tastenkürzel und KI-Bereich

- Öffnen Sie die Memo-Spalte über die obere Leiste oder **Einfügen > Memo**, um reine Textmemos neben dem Dokument zu lesen, hinzuzufügen, zu bearbeiten und zu löschen.
- Unterstützt Hancom-Hangul-2024-Tastenkürzel, Absatzmarkierungen am horizontalen Lineal, Format übertragen (**Alt+C**), Hanja-Umwandlung (**F9** / Hanja-Taste) und Dokumentinformationen (**Strg+Q,I**).
- Der optionale KI-Bereich und die [Befehlszeilen-Werkzeuge](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) können Text, Formatvorlagen, Tabellen, Gleichungen, Seitenlayout, Gliederung und Suchergebnisse lesen und bearbeiten; jede KI-Bearbeitung bildet einen einzigen Rückgängig-Schritt.
