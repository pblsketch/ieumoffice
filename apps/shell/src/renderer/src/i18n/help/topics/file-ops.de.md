# Dateivorgänge: umbenennen, löschen, exportieren

Dieses Kapitel behandelt die Dateivorgänge, die allen Editoren gemeinsam sind; die eigenen Exportoptionen jedes Editors stehen in seinem Kapitel.

Das **⋯-Menü** einer Zeile (fahren Sie über eine Dateizeile) bündelt diese Aktionen:

![Das ⋯-Menü einer Dateizeile](img/file-ops.png)

## Umbenennen

Zwei Einstiegspunkte, dieselben Prüfungen:

- **⋯ ▸ Umbenennen** auf einer Zeile der Startseite.
- **Doppelklicken Sie auf einen Dateitab**, um direkt dort umzubenennen (siehe [Tabs und Fensterverwaltung](help://tabs-and-windows)).

Regeln: Die Dateiendung bleibt automatisch erhalten; unzulässige Zeichen, Punkte am Ende und reservierte Namen (CON/NUL und Verwandte) werden mit einer Meldung abgelehnt; auch ein Namenskonflikt im selben Ordner wird verhindert. Die echte Datei auf dem Datenträger wird umbenannt, und Zuletzt verwendet und Favoriten folgen.

## Löschen

- **⋯ ▸ Löschen** auf der Startseite: fragt ab, welche Dateien, und verschiebt sie in den **Papierkorb des Systems**, von dort über das Betriebssystem wiederherstellbar. GenOffice führt dafür kein eigenes Rückgängig — die Wiederherstellung ist Sache des Papierkorbs, nicht einer Meldung.

## Duplizieren

**⋯ ▸ Duplizieren** erstellt im selben Ordner eine Kopie namens <name> copy; bei Namensgleichheit wird automatisch ein Zähler angehängt. Die Kopie landet in **Zuletzt verwendet**, statt geöffnet zu werden — sie ist einen Klick entfernt, nicht vor Ihnen aufgeschlagen.

## Speichern und Speichern unter

- **⌘S / ctrl+S** speichert die aktuelle Datei; bei einer Datei ohne Namen werden zuerst Ort und Name abgefragt.
- In den meisten Editoren bietet die Dateitypliste im Dialog „Speichern unter“ auch die Exportformate an (PDF, Bilder, andere Dokumentformate). Wählt man eines davon, wird nur eine Kopie geschrieben; das geöffnete Dokument und sein Tab bleiben bei der ursprünglichen Datei. Bilder mehrerer Seiten werden auf `Name-01.png`, `Name-02.png` … aufgeteilt.
- **Docs**: Die Liste „Speichern unter“ bietet auch .hwp und .hwpx an (Datei ▸ Als HWP-Dokument exportieren… tut dasselbe). Lässt sich etwas nicht übernehmen, etwa Kommentare, Formeln oder Textfelder, erfahren Sie es, bevor die Datei geschrieben wird.
- **Speichern unter** schreibt eine neue Datei und lässt das Original unberührt; weitere Änderungen gelten dann der neuen Datei.
- Jedes Speichern erfolgt atomar (temporäre Datei plus Umbenennung); ein Abbruch mitten im Schreiben kann die Datei nicht beschädigen.
- AutoSpeichern folgt dem Schalter des jeweiligen Editors; ein neues Dokument ohne eigene Datei beginnt erst nach dem ersten Speichern (siehe [Schnellstart](help://getting-started)).

## Als PDF exportieren

- **Docs**: Datei ▸ Als PDF exportieren (oder die Schaltfläche im Menüband), paginiert nach dem aktuellen Seitenumbruch.
- **Slides**: Der Export rasternt Seite für Seite, mit Fortschritt bei großen Decks.
- **Sheets**: Der Export folgt dem Druckumbruch.
- Exporte werden in einem verborgenen Fenster gerendert und landen dort, wo Sie es wählen.

## Als Word / Bilder exportieren

- **PDF ▸ PDF in Word**: wandelt die PDF in .docx um (lokale Konvertierung; komplexe Layouts werden nach bestem Bemühen übernommen).
- **Docs** kann Seiten als Bilder exportieren (eine PNG-Datei pro Seite).

## Drucken

Datei ▸ Drucken (⌘P/Strg+P) öffnet in jedem Editor — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram und Whiteboard — ein Druckfenster mit Live-Vorschau. Wenn unter Seitenlayout nichts geändert wird und der Systemdruckdialog gewählt ist, bleibt der Druckweg unverändert.

- **Ausgabeziel (Drucker, PDF, Bilder)**: Wählen Sie in einer Liste einen installierten Drucker, **Als PDF speichern**, **Als Bilder speichern** oder den **Systemdruckdialog**. Der Bildexport unterstützt PNG und JPG (Hoch 90 %, Mittel 80 %, Kleine Datei 65 %) als nummerierte Einzeldateien oder als ZIP-Archiv. Bei geschützten PDFs sind PDF- und Bildspeicherung deaktiviert, Drucken bleibt möglich.
- **Live-Druckvorschau**: Alle zehn Editoren zeigen vor der Ausgabe eine Live-Vorschau. Ändern Seitenlayout, Graustufen, Wasserzeichen oder Kopf-/Fußzeilen die Ausgabeseiten, werden die tatsächlichen Seiten bei Bedarf mit Seitenwechsel, Zoom und Seitenplan-Umschalter gerendert.
- **Layout**: Wählen Sie Eine Seite pro Blatt, Mehrere Seiten pro Blatt (2, 4, 6, 9 oder 16, optional mit Seitenrahmen), Broschüre (links oder rechts gebunden), Poster (Spalten × Zeilen, Überlappung, Schnittmarken und Kachelkoordinaten) oder Etiketten (eine Seite je Etikett oder Wiederholung, Startzelle, A4-Vorlagen oder eigene Maße).
- **Skalierung, Ausrichtung, Seiten und Reihenfolge**: Wählen Sie Tatsächliche Größe (100 %), An Papier anpassen, Übergroße Seiten verkleinern oder Benutzerdefiniert (10 %–400 %) sowie Automatisch, Hochformat oder Querformat. Nur ungerade/gerade Seiten und Umgekehrte Reihenfolge zählen die fertigen Ausgabeseiten.
- **Wasserzeichen, Kopf-/Fußzeilen, Graustufen und Auflösung**: Fügen Sie reine Druck-Wasserzeichen (Text oder Bild) und 6 Kopf-/Fußzeilenfelder (Titel, Datum, Seitenzahl oder eigener Text) hinzu, ohne das Dokument zu verändern. Graustufen und Auflösung (Automatisch, 150, 300 oder 600 dpi) steuern die Rasterqualität.
- **Seitenbereiche und Auswahl**: Docs und Markdown paginieren markierten Text ab Seite 1 neu; Slides druckt gewählte Folien; PDF gewählte Seiten; Hangul unterstützt Alle, Aktuelle Seite oder Bereich; Sheets druckt aktive Blätter, Arbeitsmappe oder Auswahl.
- **Systemdruckdialog**: Wählen Sie für Broschüren den Duplexdruck über die kurze Kante und lassen Sie Seitenbereich sowie Seiten pro Blatt im Systemdialog unverändert.

PDFs werden in der aktuellen Seitenreihenfolge und Drehung gedruckt.

## Wo Dateien ohne Namen liegen

Der Ort, den Sie beim ersten Speichern wählen, ist ihr Zuhause. Bis dahin hat das Dokument keine eigene Datei: Sein ungespeicherter Inhalt liegt nur als Wiederherstellungskopie im Datenordner der App und lässt sich so zurückholen, wenn die App plötzlich ausgeht (siehe [Tabs und Fensterverwaltung](help://tabs-and-windows)). AutoSpeichern übernimmt erst nach diesem ersten Speichern.
