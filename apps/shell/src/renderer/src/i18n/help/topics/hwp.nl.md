# Hangul (HWP / HWPX): bewerken, werkvenster en afdrukken

GenOffice opent en bewerkt `.hwp`- en `.hwpx`-Hangul-documenten in een tabblad, met sneltoetsen, stijlen, tabellen, memo’s, afdrukken en een AI-paneel. Alles draait lokaal op uw pc.

## Openen, opslaan en afdrukken

- Opent `.hwp`- en `.hwpx`-bestanden vanaf Start, **Bestand > Openen**, door naar het venster te slepen of vanuit Google Drive; zet PDF-bestanden om in nieuwe Hangul-tabbladen via **Bestand > PDF importeren**.
- Slaat terug op in het oorspronkelijke formaat van het geopende bestand (`.hwp` blijft `.hwp`, `.hwpx` blijft `.hwpx`), bewaart een `.bak`-back-up vóór de eerste overschrijving, controleert het teruglezen van HWP en houdt automatisch opslaan en herstelkopieën bij.
- Afdrukken (Ctrl+P) ondersteunt live voorbeeldweergave, PDF-export en afdruklay-outopties voor meerdere pagina's.

## Linker werkvenster: Overzicht, Zoeken en Literatuur

- Open het linker werkvenster via de knop in de bovenste balk, **Beeld > Werkvenster** (Overzicht / Zoeken / Literatuur) of druk op **Ctrl+F** om direct naar het tabblad Zoeken te gaan. Klassiek zoeken (**Ctrl+Q,F**) en Zoeken en vervangen (**Ctrl+H**) blijven beschikbaar.
- **Tabblad Overzicht**: toont oorspronkelijke Hangul-overzichtskoppen en via stijlen gekoppelde koppen (standaard `제목 N` / `Heading N`, per document of voor de hele app aanpasbaar in de instellingenlade van Overzicht). Filter op niveau (`1`, `2`, `3`, ... Alle), vouw takken samen, klik om te springen, verhoog of verlaag koppen (standaard inclusief subkoppen, of houd **Shift** ingedrukt voor een enkele kop) en sleep koppen om hele secties in één stap ongedaan maken te herschikken.
- **Tabblad Zoeken**: doorzoekt hoofdtekst, tabellen (inclusief geneste tabellen), tekstvakken, voetnoten en eindnoten (met uitzondering van kop- en voetteksten) met filters voor hoofdlettergevoeligheid, heel woord, reguliere expressies, alineastijl en tekenopmaak. Klik op een resultaat om ernaartoe te springen en het te selecteren, of vervang één, geselecteerde of alle overeenkomsten in één stap ongedaan maken (inline-objecten en citaatmarkeringen worden overgeslagen met een telling).
- Het werkvenster onthoudt de open status, het actieve tabblad en de breedte, klapt op smalle vensters in tot een pictogrammenbalk en verbergt zich in de presentatiemodus en het afdrukvoorbeeld. Alle functies van het werkvenster werken zonder AI.

## Memo's, sneltoetsen en AI-paneel

- Open de memokolom via de bovenste balk of **Invoegen > Memo** om platte-tekstmemo's naast het document te lezen, toe te voegen, te bewerken en te verwijderen.
- Ondersteunt sneltoetsen voor Hangul-documenten, alineamarkeringen op de horizontale liniaal, Opmaak kopiëren (**Alt+C**), Hanja-conversie (**F9** / Hanja-toets) en Documentinfo (**Ctrl+Q,I**).
- Het optionele AI-paneel en [terminalopdrachten](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) kunnen tekst, stijlen, tabellen, vergelijkingen, pagina-indeling, overzichten en zoekresultaten lezen en bewerken; elke AI-bewerking is één stap om ongedaan te maken.

## Inhoudsopgave: maken en bijwerken

- Gebruik **Extra > Inhoudsopgave maken** (of **Extra > Inhoudsopgave bijwerken**, of klik met de rechtermuisknop in een inhoudsopgave) om een **inhoudsopgave** op basis van koppen uit het Overzicht in te voegen, plus een **lijst van tabellen**, **figuren** en **vergelijkingen** uit objectbijschriften en bijschriftalinea's.
- Kies de indeling **Gestippelde tab** (standaard) of **Randloze tabel** (2 kolommen), stel de kopdiepte in (niveaus 1–10, standaard 3), pas de titel aan en voeg optioneel klikbare koppelingen toe (klik of **Ctrl+klik** op een regel om direct naar die kop te springen).
- Paginanummers volgen de afgedrukte paginanummering, inclusief nieuwe nummerstarts en Romeinse of aangepaste nummernotaties.
- Bijwerken vernieuwt items en paginanummers ter plaatse, waarschuwt voordat handmatig bewerkte regels worden overschreven en herkent bestaande ongemarkeerde inhoudsopgaven uit een ander programma zodat u kunt bevestigen voordat deze worden vervangen.

## Index: gegevens markeren en maken

- Gebruik **Extra > Indexgegeven markeren** (of klik met de rechtermuisknop in de hoofdtekst) om het geselecteerde woord of het woord bij de cursor te markeren, een optioneel subgegeven toe te voegen of alle overeenkomende voorkomens te markeren (alleen in de hoofdtekst; overgeslagen treffers in tabellen, tekstvakken en noten worden geteld). In hetzelfde dialoogvenster kunt u bestaande markeringen bekijken en verwijderen.
- Gebruik **Extra > Index maken** om op de cursorpositie een index in te voegen en **Extra > Index bijwerken** om deze na bewerkingen bij te werken. De standaardtitel ("Index") kan worden aangepast.
- Gegevens worden gesorteerd in de volgorde Koreaans (가나다) → Engels (ABC) → Overig, met optionele groepskoppen per medeklinker of letter, 1–3 kolommen (standaard 2 kolommen, alleen voor de index zodat de kolommen van de rest van het document ongewijzigd blijven) en de indeling **Gestippelde tab** of **Randloze tabel**.

## Melding bij verouderde lijsten en inleverkopie

- Bij handmatig opslaan, afdrukken, exporteren als PDF of opslaan als inleverkopie controleert de editor of inhoudsopgaven of de index verouderd zijn en biedt aan om alles in één stap voor ongedaan maken bij te werken. Deze controle draait nooit tijdens automatisch opslaan en blokkeert het opslaan nooit.
- Gebruik **Bestand > Opslaan als inleverkopie** om een afzonderlijke schone kopie op te slaan zonder interne bewerkingsmarkeringen (indexmarkeringen, indexblokmarkeringen en opgeslagen instellingen), terwijl inhoudsopgaven, kopankers en koppelingen intact blijven. Uw oorspronkelijke werkbestand blijft ongewijzigd zodat u het later kunt blijven bijwerken.

## Literatuurlijst en citaten

- Open het tabblad **Literatuur** in het linker werkvenster (of **Extra > Literatuur**) om één lokale referentiebibliotheek op uw pc te beheren met zoeken, labels, toevoegen/bewerken/verwijderen, importeren en exporteren (`BibTeX`, `RIS`, `CSL JSON`) en het regel voor regel importeren uit een bestaande literatuurlijst in het document met een voorbeeld ter bevestiging.
- Ondersteunt vier citeerstijlen (**APA 7**, **Chicago**, **MLA 9** en **IEEE**; Koreaanse bronnen volgen in alle vier de stijlen de Koreaanse academische opmaak). Voeg citaten tussen haakjes, lopende citaten of meervoudige citaten met paginanummers in en genereer of vernieuw een literatuurlijst met hangende inspringing; wisselen van stijl werkt gemarkeerde citaten en de lijst in één stap ongedaan maken bij en laat handmatig aangepaste citaten ongemoeid.
- De ingebouwde 6-puntscontrole (ontbreekt in literatuurlijst, niet-geciteerde items, sorteervolgorde, ontbrekende a/b-achtervoegsels, handmatige citaatbewerkingen en niet-geverifieerde items) springt met één klik naar elk punt, met herinneringen voor een verouderde literatuurlijst of IEEE-nummering vóór handmatig opslaan, afdrukken of exporteren.
- Optioneel zoeken naar bronnen met AI (wanneer internettools zijn ingeschakeld) voegt kandidaten altijd toe als **Niet geverifieerd** met de bron-URL in de notities; ze kunnen pas worden geciteerd of opgenomen in de literatuurlijst nadat u ze zelf hebt gecontroleerd en als **Geverifieerd** hebt gemarkeerd.
