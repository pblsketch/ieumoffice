# Hangul (HWP / HWPX): Bearbeiten, Arbeitsbereich und Drucken

GenOffice öffnet und bearbeitet `.hwp`- und `.hwpx`-Hangul-Dokumente in einem Tab – mit Tastenkürzeln, Formatvorlagen, Tabellen, Memos, Druckfunktionen und einem KI-Bereich. Alles läuft lokal auf Ihrem PC.

## Öffnen, Speichern und Drucken

- Öffnet `.hwp`- und `.hwpx`-Dateien über Start, **Datei > Öffnen**, per Ziehen ins Fenster oder aus Google Drive; wandelt PDFs über **Datei > PDF importieren** in neue Hangul-Tabs um.
- Speichert im ursprünglichen Dateiformat (`.hwp` bleibt `.hwp`, `.hwpx` bleibt `.hwpx`), legt vor dem ersten Überschreiben eine `.bak`-Sicherung an, prüft das Wiedereinlesen von HWP-Dateien und verwaltet automatische Speicher- sowie Wiederherstellungskopien.
- Drucken (Strg+P) unterstützt Live-Vorschau, PDF-Export und mehrseitige Drucklayout-Optionen.

## Linker Arbeitsbereich: Gliederung, Suchen und Literatur

- Öffnen Sie den linken Arbeitsbereich über die Schaltfläche in der oberen Leiste, **Ansicht > Arbeitsbereich** (Gliederung / Suchen / Literatur) oder drücken Sie **Strg+F**, um direkt zum Tab Suchen zu springen. Das klassische Suchen (**Strg+Q,F**) sowie Suchen und Ersetzen (**Strg+H**) bleiben verfügbar.
- **Tab Gliederung**: zeigt native Hangul-Gliederungsüberschriften sowie über Formatvorlagen zugeordnete Überschriften an (standardmäßig `제목 N` / `Heading N`, pro Dokument oder anwendungsweit in den Gliederungseinstellungen anpassbar). Filtern Sie nach Ebene (`1`, `2`, `3`, ... Alle), klappen Sie Zweige ein, springen Sie per Klick dorthin, stufen Sie Überschriften höher oder tiefer (standardmäßig samt Unterüberschriften, mit gedrückter **Umschalttaste** nur für eine einzelne Überschrift) und ziehen Sie Überschriften, um ganze Abschnitte in einem einzigen Rückgängig-Schritt neu anzuordnen.
- **Tab Suchen**: durchsucht Fließtext, Tabellen (einschließlich verschachtelter Tabellen), Textfelder, Fußnoten und Endnoten (ohne Kopf- und Fußzeilen) mit Filtern für Groß-/Kleinschreibung, ganzes Wort, reguläre Ausdrücke, Absatzvorlage und Zeichenformatierung. Klicken Sie auf einen Treffer zum Anspringen und Markieren oder ersetzen Sie einen, ausgewählte oder alle Treffer in einem einzigen Rückgängig-Schritt (Inline-Objekte und Zitatmarkierungen werden mit Zähler übersprungen).
- Der Arbeitsbereich merkt sich Öffnungszustand, aktiven Tab und Breite, klappt in schmalen Fenstern zu einer Symbolleiste ein und blendet sich im Präsentationsmodus sowie in der Druckvorschau aus. Alle Funktionen des Arbeitsbereichs arbeiten ohne KI.

## Memos, Tastenkürzel und KI-Bereich

- Öffnen Sie die Memo-Spalte über die obere Leiste oder **Einfügen > Memo**, um reine Textmemos neben dem Dokument zu lesen, hinzuzufügen, zu bearbeiten und zu löschen.
- Unterstützt Tastenkürzel für Hangul-Dokumente, Absatzmarkierungen am horizontalen Lineal, Format übertragen (**Alt+C**), Hanja-Umwandlung (**F9** / Hanja-Taste) und Dokumentinformationen (**Strg+Q,I**).
- Der optionale KI-Bereich und die [Befehlszeilen-Werkzeuge](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) können Text, Formatvorlagen, Tabellen, Gleichungen, Seitenlayout, Gliederung und Suchergebnisse lesen und bearbeiten; jede KI-Bearbeitung bildet einen einzigen Rückgängig-Schritt.

## Inhaltsverzeichnis erstellen und aktualisieren

- Über **Extras > Inhaltsverzeichnis erstellen** (oder **Extras > Inhaltsverzeichnis aktualisieren** sowie per Rechtsklick in einem Verzeichnis) fügen Sie ein **Inhaltsverzeichnis** aus den Überschriften der Gliederung sowie **Tabellen-**, **Abbildungs-** und **Gleichungsverzeichnisse** aus Objektbeschriftungen und Beschriftungsabsätzen ein.
- Wählen Sie zwischen **Gepunkteter Tabulator** (Standard) und **Rahmenlose Tabelle** (2 Spalten), legen Sie die Überschriftentiefe fest (Ebenen 1–10, Standard 3), passen Sie den Titel an und fügen Sie optional anklickbare Verknüpfungen hinzu (Klick oder **Strg+Klick** auf eine Zeile springt direkt zur Überschrift).
- Die Seitenzahlen entsprechen der gedruckten Seitennummerierung einschließlich neu begonnener Nummerierungen sowie römischer oder benutzerdefinierter Zahlenformate.
- Beim Aktualisieren werden Einträge und Seitenzahlen direkt erneuert; vor dem Überschreiben manuell geänderter Zeilen erscheint eine Warnung. Bestehende, nicht markierte Inhaltsverzeichnisse aus einem anderen Programm werden erkannt und erst nach Ihrer Bestätigung ersetzt.

## Indexeinträge festlegen und Index erstellen

- Über **Extras > Indexeintrag festlegen** (oder per Rechtsklick im Fließtext) markieren Sie das ausgewählte Wort oder das Wort am Cursor, ergänzen optional einen Untereintrag oder aktivieren **Alle übereinstimmenden Vorkommen markieren** (nur Fließtext; übersprungene Treffer in Tabellen, Textfeldern und Notizen werden gezählt). Vorhandene Markierungen lassen sich im selben Dialog einsehen und löschen.
- Über **Extras > Index erstellen** fügen Sie an der Cursorposition einen Index ein und halten ihn später mit **Extras > Index aktualisieren** aktuell. Der Standardtitel („Index“) lässt sich frei anpassen.
- Einträge werden in der Reihenfolge Koreanisch (가나다) → Englisch (ABC) → Sonstige sortiert – mit optionalen Buchstaben- oder Konsonanten-Gruppenüberschriften, 1–3 Spalten (Standard 2 Spalten, auf den Index beschränkt, sodass die Spaltenaufteilung des übrigen Dokuments unverändert bleibt) sowie dem Layout **Gepunkteter Tabulator** oder **Rahmenlose Tabelle**.

## Hinweis auf veraltete Verzeichnisse und Einreichungskopie

- Beim manuellen Speichern, Drucken, PDF-Export oder Speichern als Einreichungskopie prüft der Editor, ob Inhaltsverzeichnisse oder der Index veraltet sind, und bietet an, alles in einem einzigen Rückgängig-Schritt zu aktualisieren. Diese Prüfung läuft niemals beim automatischen Speichern und blockiert das Speichern nicht.
- Mit **Datei > Als Einreichungskopie speichern** erzeugen Sie eine separate, bereinigte Kopie ohne interne Bearbeitungsmarkierungen (Indexmarkierungen, Indexbereichs-Markierungen und gespeicherte Einstellungen), während Inhaltsverzeichnisse, Überschriftenanker und Verzeichnis-Links erhalten bleiben. Ihre ursprüngliche Arbeitsdatei bleibt unverändert und lässt sich weiterhin aktualisieren.

## Literaturverzeichnis und Zitate

- Öffnen Sie den Tab **Literatur** im linken Arbeitsbereich (oder **Extras > Literatur**), um eine einzige lokale Literaturbibliothek auf Ihrem PC zu verwalten – mit Suche, Schlagwörtern, Hinzufügen/Bearbeiten/Löschen, Import und Export (`BibTeX`, `RIS`, `CSL JSON`) sowie der zeilenweisen Übernahme aus einem bestehenden Literaturverzeichnis im Dokument mit Vorschau-Bestätigung.
- Unterstützt vier Zitierstile (**APA 7**, **Chicago**, **MLA 9** und **IEEE**; koreanische Quellen folgen in allen vier Stilen den koreanischen akademischen Regeln). Fügen Sie Zitate in Klammern, im Fließtext oder Mehrfachzitate mit Seitenangaben ein und erstellen oder aktualisieren Sie ein Literaturverzeichnis mit hängendem Einzug; ein Stilwechsel aktualisiert markierte Zitate und Verzeichnis in einem einzigen Rückgängig-Schritt und lässt manuell geänderte Zitate unberührt.
- Die integrierte 6-Punkte-Prüfung (fehlt im Literaturverzeichnis, nicht zitierte Einträge, Sortierreihenfolge, fehlende a/b-Zusätze, manuell geänderte Zitate und ungeprüfte Einträge) springt per Klick direkt zur Fundstelle; vor dem manuellen Speichern, Drucken oder Exportieren warnt der Editor zudem vor veralteten Literaturverzeichnissen und IEEE-Nummern.
- Die optionale KI-Literatursuche (bei aktivierten Internet-Werkzeugen) fügt Kandidaten immer als **Ungeprüft** samt Quell-URL in den Notizen hinzu; ungeprüfte Einträge lassen sich erst zitieren oder ins Verzeichnis aufnehmen, nachdem Sie sie selbst geprüft und als **Geprüft** markiert haben.

## Makros: Tastenaufzeichnung und Skripte

- Verwenden Sie **Extras > Makros** (oder **Alt+Shift+H** zum Starten bzw. Beenden der Tastenaufzeichnung und **Alt+Shift+X** zum Beenden), um Texteingaben, Cursorbewegungen, Formatierungen, Formatvorlagen, Tabellen und unterstützte Bearbeitungen direkt als bearbeitbares Skript aufzuzeichnen. Während der Aufnahme erscheint eine Anzeige in der oberen Leiste; nicht unterstützte Befehle oder Mausklicks werden sofort gemeldet und nach dem Beenden als übersprungen aufgelistet.
- Im **Makro-Manager** verwalten Sie lokal gespeicherte Makros, weisen bis zu 11 Tastenkürzel-Plätze zu (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), bearbeiten Skripte mit Zeilen- und Spaltenangabe bei Syntaxfehlern und exportieren oder importieren Klartextdateien im Format `.ieummacro`. Importierte Skripte werden vollständig angezeigt und müssen vor dem Ausführen bestätigt und gespeichert werden; in Dokumentdateien eingebettete Makros werden weder gelesen noch ausgeführt. Starten und verwalten Sie Makros unter macOS über das Menü **Extras > Makros**, da Option-Tastenkombinationen dort Zeichen eingeben.
- Jedes Makro läuft synchron in einem eingeschränkten Interpreter für die Dokument-API der App und kompatible Makroskript-Objekte (`HAction`, `HParameterSet`), geschützt durch Zeit-, Schritt-, Aufruftiefen- und Speicherlimits sowie Objekt- und Memoschutz. Ein Durchlauf ist stets genau ein Rückgängig-Schritt und wird bei Fehlern, nicht unterstützten Aktionen oder Limitüberschreitungen vollständig zurückgesetzt.
- Mit der optionalen Funktion **Mit KI schreiben** (nur im Makro-Editor sichtbar, wenn KI aktiviert ist) beschreiben Sie eine wiederkehrende Aufgabe, um einen Skriptentwurf erstellen zu lassen; gesendet werden nur Ihre Beschreibung und die Makro-API-Referenz, niemals das Dokument. Entwürfe erscheinen ausschließlich im Eingabefeld und werden nie automatisch gespeichert oder ausgeführt.
