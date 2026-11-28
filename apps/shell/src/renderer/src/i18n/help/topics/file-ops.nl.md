# Bestandsbewerkingen: hernoemen, verwijderen, exporteren

Dit hoofdstuk behandelt de bestandsbewerkingen die alle editors delen; de eigen exportopties van elke editor staan in het bijbehorende hoofdstuk.

Het **⋯-menu** in de rij (verschijnt als je over een bestandsrij zweeft) bundelt deze acties:

![Het ⋯-menu van een bestandsrij](img/file-ops.png)

## Hernoemen

Twee instappen, één set controles:

- **⋯ ▸ Naam wijzigen** in een rij op Start.
- **Dubbelklik op een bestandstabblad** om ter plekke te hernoemen (zie [Tabbladen en vensterbeheer](help://tabs-and-windows)).

Regels: de extensie blijft automatisch behouden; ongeldige tekens, afsluitende punten en gereserveerde namen (CON/NUL en dergelijke) worden met een melding geweigerd; een naamconflict in dezelfde map wordt eveneens tegengehouden. Het echte bestand op schijf wordt hernoemd, en de lijsten met recente en favoriete bestanden volgen.

## Verwijderen

- **⋯ ▸ Verwijderen** op Start: vraagt welke bestanden, verplaatst ze daarna naar de **prullenbak van het systeem**, waar het besturingssysteem ze kan herstellen. GenOffice bewaart hiervoor zelf geen ongedaan maken — herstel is de taak van de prullenbak, niet van een melding.

## Dupliceren

**⋯ ▸ Dupliceren** maakt een kopie van <naam> in dezelfde map; bij een botsing wordt automatisch een teller toegevoegd. De kopie komt in **Recent** terecht in plaats van voor jou te worden geopend — één klik verderop, niet pal voor je neus.

## Opslaan en Opslaan als

- **⌘S / ctrl+S** slaat het huidige bestand op; een naamloos bestand vraagt eerst om locatie en naam.
- In de meeste editors biedt de lijst met bestandstypen in het venster Opslaan als ook de exportformaten (PDF, afbeeldingen, andere documentformaten). Kies je er een, dan wordt alleen een kopie geschreven; het geopende document en zijn tabblad blijven bij het oorspronkelijke bestand. Afbeeldingen van meerdere pagina’s worden verdeeld over `naam-01.png`, `naam-02.png`, ….
- **Docs**: de lijst Opslaan als biedt ook .hwp en .hwpx (Bestand ▸ Exporteren als HWP-document… doet hetzelfde). Als iets niet kan worden overgenomen, zoals opmerkingen, vergelijkingen of tekstvakken, hoort u dat voordat het bestand wordt geschreven.
- **Opslaan als…** schrijft een nieuw bestand en laat het origineel ongemoeid; latere bewerkingen gaan naar het nieuwe bestand.
- Elk opslaan is atomair (tijdelijk bestand + hernoemen); tussentijds afsluiten kan het bestand niet beschadigen.
- Automatisch opslaan volgt de schakelaar van elke editor; een nieuw document zonder eigen bestand begint pas na de eerste keer opslaan (zie [Snel starten](help://getting-started)).

## Exporteren naar pdf

- **Docs**: Bestand ▸ Exporteren als pdf… (of de knop op het lint), gepagineerd zoals het eruitziet.
- **Slides**: exporteren rastert pagina voor pagina, met voortgang bij grote presentaties.
- **Sheets**: exporteren volgt de afdrukpaginering.
- Exports worden in een verborgen venster weergegeven en belanden waar jij kiest.

## Exporteren naar Word of afbeeldingen

- **Exporteren als Word…** in pdf: zet de pdf om naar een .docx-bestand (lokale conversie; ingewikkelde opmaak wordt zo goed mogelijk benaderd).
- **Docs** kan pagina's exporteren als afbeeldingen (png per pagina).

## Afdrukken

Bestand ▸ Afdrukken (⌘P/ctrl+P) opent in elke editor — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram en Whiteboard — een afdrukvenster met live voorbeeld. Als je niets onder Pagina-indeling wijzigt en via het systeemvenster afdrukt, werkt afdrukken zoals voorheen.

- **Bestemming (printer, pdf, afbeeldingen)**: kies uit één lijst een geïnstalleerde printer, **Opslaan als PDF**, **Opslaan als afbeeldingen** of het **Systeemafdrukvenster**. Afbeeldingen ondersteunen PNG en JPG (Hoog 90%, Normaal 80%, Klein bestand 65%) als aparte genummerde bestanden of één ZIP-archief. Bij beveiligde pdf’s zijn pdf- en afbeeldingsopslag uitgeschakeld, terwijl afdrukken beschikbaar blijft.
- **Live afdrukvoorbeeld**: alle tien editors tonen een live voorbeeld vóór uitvoer. Wanneer indeling, grijstinten, watermerk of kop-/voetteksten de uiteindelijke zijden veranderen, rendert het voorbeeld ze op aanvraag met navigatie, zoom en schakelaar voor het indelingsschema.
- **Indeling**: kies Eén pagina per vel, Meerdere pagina’s per vel (2, 4, 6, 9 of 16, optioneel met randen), Boekje (links of rechts gebonden), Poster (kolommen × rijen, overlap, snijlijnen en tegelcoördinaten) of Etiketten (één pagina per etiket of herhalen, startvak, A4-formaten of eigen maten).
- **Schaal, richting, zijden en volgorde**: kies Ware grootte (100%), Passend op papier, Alleen te grote pagina’s verkleinen of Aangepaste schaal (10%–400%) en Automatisch, Staand of Liggend. Alleen oneven, alleen even en omgekeerde volgorde tellen op de uiteindelijke zijden.
- **Watermerk, kop-/voetteksten, grijstinten en resolutie**: plaats een tekst- of beeldwatermerk en 6 velden voor kop- en voetteksten (titel, datum, paginanummer of eigen tekst) alleen bij uitvoer, zonder het document aan te passen. Grijstinten en DPI (Automatisch, 150, 300 of 600 dpi) bepalen de rasterkwaliteit.
- **Paginabereiken en selectie**: Docs en Markdown hernummeren geselecteerde tekst vanaf pagina 1; Slides drukt gekozen dia’s af; PDF gekozen pagina’s; Hangul ondersteunt Alle, Huidige pagina of Aangepast bereik; Sheets drukt actieve bladen, werkmap of selectie af.
- **Systeemafdrukvenster**: kies voor een boekje dubbelzijdig afdrukken over de korte zijde en laat paginabereik en pagina’s per vel in het systeemvenster ongewijzigd.

Pdf’s worden afgedrukt in de huidige paginavolgorde en rotatie.

## Waar naamloze bestanden staan

De locatie die je bij de eerste keer opslaan kiest is hun thuisbasis. Tot dan heeft het document geen eigen bestand: de niet-opgeslagen inhoud bestaat alleen als herstelkopie in de gegevensmap van de app, zodat die terug kan komen als de app plotseling uitvalt (zie [Tabbladen en vensterbeheer](help://tabs-and-windows)). Automatisch opslaan neemt het pas over na die eerste keer opslaan.
