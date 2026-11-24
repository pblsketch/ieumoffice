# Práce se soubory: přejmenování, odstranění, export

Tato kapitola popisuje práci se soubory společnou všem editorům; vlastní možnosti exportu každého editoru najdete v jeho kapitole.

Nabídka **⋯** na řádku (objeví se po najetí na řádek souboru) sdružuje tyto akce:

![Nabídka ⋯ na řádku souboru](img/file-ops.png)

## Přejmenování

Dvě vstupní místa, jedna sada kontrol:

- **⋯ ▸ Přejmenovat** na řádku domovské stránky.
- **Dvojklik na kartu souboru** přejmenuje přímo na místě (viz [Karty a správa oken](help://tabs-and-windows)).

Pravidla: přípona se zachovává automaticky; nepovolené znaky, tečky na konci a rezervované názvy (CON, NUL a podobně) se odmítnou s hlášením; překrytí názvu ve stejné složce se rovněž zablokuje. Přejmenuje se skutečný soubor na disku a seznamy nedávných a oblíbených se aktualizují.

## Odstranění

- **⋯ ▸ Odstranit** na domovské stránce: zeptá se, které soubory, a přesune je do **systémového koše**, odkud je může obnovit operační systém. GenOffice si pro tuto věc nepřidržuje vlastní zpět — obnova je v kompetenci koše, ne oznámení.

## Duplikování

**⋯ ▸ Duplikovat** vytvoří ve stejné složce kopii souboru <jméno>; při kolizi názvů se automaticky připojí číslo. Kopie přibude do **Nedávné** místo toho, aby se sama otevřela — je na jeden klik od vás, ne před vámi.

## Uložit a Uložit jako

- **⌘S / ctrl+S** uloží aktuální soubor; soubor bez názvu se nejdřív zeptá na umístění a název.
- Ve většině editorů nabízí seznam typů souborů v okně Uložit jako také exportní formáty (PDF, obrázky, jiné formáty dokumentů). Volba jednoho z nich zapíše jen kopii; otevřený dokument a jeho karta zůstávají u původního souboru. Obrázky více stránek se rozdělí na `název-01.png`, `název-02.png`, ….
- **Docs**: seznam Uložit jako nabízí také .hwp a .hwpx (Soubor ▸ Exportovat jako dokument HWP… dělá totéž). Pokud něco nelze převést, například komentáře, rovnice nebo textová pole, dozvíte se to před zápisem souboru.
- **Uložit jako…** zapíše nový soubor a originál ponechá nedotčený; další úpravy se týkají nového souboru.
- Každé uložení je atomické (dočasný soubor + přejmenování); ukončení uprostřed zápisu soubor nepoškodí.
- Automatické ukládání se řídí přepínačem v každém editoru; nový dokument bez vlastního souboru začne až po prvním uložení (viz [Rychlý start](help://getting-started)).

## Export do PDF

- **Docs**: Soubor ▸ Exportovat jako PDF… (nebo tlačítko na pásku), s aktuálním stránkováním.
- **Slides**: export rastruje stránku po stránce, u velkých prezentací s ukazatelem průběhu.
- **Sheets**: export používá stránkování pro tisk.
- Exporty se vykreslují ve skrytém okně a ukládají tam, kam zvolíte.

## Export do Wordu a obrázků

- **Exportovat jako Word…** u PDF: převede PDF na soubor .docx (místní převod; složitá rozvržení se překládají, jak nejlépe lze).
- **Docs** umí exportovat stránky jako obrázky (PNG na stránku).

## Tisk

Soubor ▸ Tisk (⌘P/ctrl+P) otevře okno tisku s živým náhledem v každém editoru — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram i Whiteboard. Pokud nic v rozvržení stránky nezměníte a zvolíte systémový dialog, tisk probíhá stejně jako dříve.

- **Cíl výstupu (tiskárna, PDF, obrázky)**: v jednom seznamu zvolte nainstalovanou tiskárnu, **Uložit jako PDF**, **Uložit jako obrázky** nebo **Systémový dialog tisku**. Uložení obrázků podporuje PNG a JPG (Vysoká 90 %, Střední 80 %, Menší soubor 65 %) jako samostatné číslované soubory nebo jeden ZIP. U PDF s omezením oprávnění je ukládání PDF i obrázků zakázáno, tisk zůstává dostupný.
- **Živý náhled tisku**: všech deset editorů zobrazuje náhled před výstupem. Pokud rozvržení, stupně šedi, vodoznak nebo záhlaví/zápatí mění výsledné strany, náhled je na vyžádání vykreslí včetně přepínání stran, lupy a přepínače schématu.
- **Rozvržení**: Jedna stránka na list, Více stránek na list (2, 4, 6, 9 nebo 16, volitelně s okraji), Brožura (vazba vlevo nebo vpravo), Plakát (sloupce × řádky, přesah, ořezové značky a souřadnice dílů) nebo Štítky (stránka na štítek či opakování, počáteční buňka, předvolby A4 nebo vlastní rozměry).
- **Měřítko, orientace, strany a pořadí**: vyberte Skutečná velikost (100 %), Přizpůsobit papíru, Zmenšit příliš velké stránky nebo Vlastní měřítko (10 %–400 %) a orientaci Automaticky, Na výšku či Na šířku. Pouze liché, sudé a obrácené pořadí se počítají na finálních stranách.
- **Vodoznak, záhlaví/zápatí, šedotisk a rozlišení**: přidejte textový či obrázkový vodoznak a 6 polí záhlaví a zápatí (název, datum, číslo stránky nebo vlastní text) pouze pro tisk, bez úpravy dokumentu. Stupně šedi a rozlišení (Automaticky, 150, 300 nebo 600 dpi) řídí kvalitu rastru.
- **Rozsahy stránek a výběr**: Docs a Markdown nově zalomí vybraný text od 1. strany; Slides tiskne zvolené snímky; PDF vybrané stránky; Hangul podporuje Vše, Aktuální stránku i Vlastní rozsah; Sheets tiskne aktivní listy, sešit nebo výběr.
- **Systémový dialog tisku**: u brožury zapněte oboustranný tisk s překlápěním po krátké hraně a ponechte rozsah i počet stránek na list v systémovém okně beze změny.

PDF se tisknou v aktuálním pořadí a natočení stránek.

## Kam putují soubory bez názvu

Umístění, které zvolíte při prvním uložení, je jejich domovem. Do té doby nemá dokument vlastní soubor: jeho neuložený obsah existuje jen jako kopie pro obnovení v datové složce aplikace, takže se dá vrátit, i když se aplikace náhle vypne (viz [Karty a správa oken](help://tabs-and-windows)). Automatické ukládání se ujme až po tomto prvním uložení.
