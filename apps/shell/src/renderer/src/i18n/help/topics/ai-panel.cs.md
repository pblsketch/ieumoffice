# Panel AI asistenta

Každý editor může vyvolat panel AI: vyberte něco, zadejte pokyn a sledujte výsledek, který se přenáší postupně.

## Otevření a používání

- Panel potřebuje připojenou AI. Není-li žádná připojena, zobrazí místo chyby karty pro připojení; viz [Připojení předplatného](help://subscription).
- Vstupy: **tlačítko AI** na pásku každého editoru, **Zeptat se AI** v kontextových nabídkách nebo Zeptat se AI na liště značení.
- Popište úkol běžnými slovy (přepsat to / udělat z této sloupce procenta / přelayoutovat tuto stránku...) a stiskněte Enter.
- Odpovědi se vykreslují **průběžně**; když AI potřebuje nástroje (přečíst dokument, upravit ho), použije je a pokračuje až do dokončení.
- **Zastavit**: kdykoli přeruší právě probíhající krok.
- **Fronta**: zatímco odpověď běží, Enter zařadí zprávu do fronty, místo aby ji zahodil — pruh nad polem je počítá; rozbalte ho pro úpravu, odebrání, přeřazení, pauzu nebo vymazání. Další zpráva se pošle sama koncem tahu; Esc tahu i nadále ukončuje.

## Která AI odpovídá

- Seznam modelů ve spodní části panelu ukazuje používanou AI a umožňuje zvolit jinou: nejprve vaše předplatná, potom poskytovatele s klíčem, které jste nastavili.
- Jakmile využijete 80 % limitu předplatného nebo více, objeví se v panelu řádek jako „Využito 85 % · obnoví se v 15:00“.
- Pokud se požadavek zastaví — limit je vyčerpán nebo vypršelo přihlášení — panel uvede důvod a sám na jinou AI nepřepne. Je-li připojeno vaše druhé předplatné, nabídne ho tlačítko **Pokračovat s …**.

## Co umí

- **Docs**: přepsat/rozšířit/přeložit/shrnout, vkládat tabulky a obrázky, měnit formátování; každý krok nejprve vytvoří snímek stavu.
- **Sheets**: vzorce, vyplňování dat, hromadné přeměny, formátování.
- **Slides**: vytvoření celé prezentace, úprava rozvržení, přepis textů.
- **PDF**: otázky, odpovědi a shrnutí nad vybraným textem nebo stránkami.
- **Markdown / HTML**: přepsat, rozšířit, přeložit.
- **Domů ▸ Ask AI** odpovídá z vašich souborů s hvězdičkou a cituje je — panel znalostní báze má vlastní sekci v kapitole Domů a AI panel Docs nese tutéž dovednost.

## Připojení otevřených dokumentů

V panelu AI editorů Docs, Sheets, Slides, hangul, HTML a myšlenkových map můžete jako podklad připojit další dokumenty otevřené v GenOffice nebo nedávno otevřené. Připojený dokument se zpracuje úplně stejně jako soubor vybraný z počítače.

- **`@` ve vstupním poli**: napište `@` na začátek pole nebo za mezeru a otevře se seznam dokumentů. Pokud je okno rozdělené, je první dokument z vedlejšího panelu, po něm ostatní otevřené a nedávné dokumenty; dokument, ve kterém právě jste, v seznamu chybí. Zužte ho několika písmeny názvu (mezery nevadí) a vyberte klávesou Enter nebo kliknutím: do pole se vloží `@název dokumentu` a dokument se připojí. **Najít další…** úplně dole otevře okno pro výběr dokumentů popsané níže.
- **Připojit z dokumentů GenOffice**: toto tlačítko vedle tlačítka přílohy otevře stejný seznam v okně, kde můžete zaškrtnout více dokumentů a připojit je najednou.
- Dokumenty s neuloženými změnami a nové dokumenty, které nebyly nikdy uloženy, jsou zašedlé a nelze je vybrat. Uložte je a vyberte znovu — AI čte uložený soubor.
- Když mají dva dokumenty stejný název, ale leží v různých složkách, přidá se název složky bezprostředně nad nimi, například `@plán.docx(2. pololetí)`, a tento název složky dostane i AI.
- Editory PDF a Markdown zatím přílohy nemají, takže tam není k dispozici ani jeden způsob.

## Projekty

- Projekt (jednu složku ve vašem počítači) vyberete kliknutím na název projektu vlevo pod vstupním polem. AI pak odpovídá se znalostí souborů, pokynů a paměti z této složky a konverzace se uloží do složky, takže v ní můžete pokračovat v jiném editoru. Viz [Projekty](help://projects).
- S vybraným projektem se nahoře v panelu zobrazí název aktuální konverzace. Kliknutím na něj otevřete seznam konverzací projektu a **Nová konverzace**.
- Seznam `@` ve vstupním poli ukazuje za otevřenými dokumenty „Soubory v tomto projektu“.
- Požadavek s vybraným projektem posílá AI, kterou používáte, také pokyny projektu (spolu s `AGENTS.md` a `CLAUDE.md` v kořeni složky, které lze vypnout na stránce projektu), jeho paměť a seznam názvů souborů, krátký úryvek z každého souboru, který AI najde při hledání ve složce, a k tomu text každého souboru, který si AI přečte.

## Vrácení zpět a bezpečnost

- Panel v Docs vede **seznam verzí**: jeden snímek na krok, můžete se vrátit k libovolnému a samotný návrat lze zase vrátit pomocí Ctrl+Z. Snímy přežijí i znovu otevření dokumentu.
- Změny od AI procházejí stejnou cestou úprav jako ruční změny (lze je vrátit, vyžadují uložení) — nic neobchází vaše potvrzení uložení.

## Skrýt citlivé údaje

- V editorech Docs, Sheets, Slides, hangul, Markdown a HTML můžete část dokumentu AI neukázat: vyberte ji, klikněte pravým tlačítkem ▸ **Skrýt citlivé údaje** a zadejte štítek. AI na tom místě čte `{{štítek}}`, ať používáte kteroukoli AI. (Markdown položku zapíná přepínačem přeškrtnutého oka na pásu; v HTML je položka v panelu zdroje; v Sheets klikněte pravým tlačítkem na záhlaví sloupce, chcete-li skrýt sloupec pod řádkem záhlaví, nebo na oblast buněk, chcete-li skrýt jen tuto oblast.)
- Soubor si ponechá skutečný text — uložení, tisk i export do PDF zůstávají nedotčené a značka zůstane i po znovuotevření. Stejnou položkou nabídky skrytí zrušíte. V hangulu je každá skrytá část komentář s textem `[Skrýt citlivé údaje] štítek`, takže tento komentář uvidí i ten, kdo dokument dostane, a text, který už komentář má, skrýt nelze. V Sheets je značkou definovaný název `IeumHide_štítek`, který je vidět ve Správci názvů; AI vidí každou skrytou buňku jako `{{štítek-01}}` (stejná hodnota dostane stejné číslo) a skrytá je i buňka, jejíž vzorec skryté buňky používá.
- **Najít citlivé údaje** v panelu AI vypíše, co vypadá jako jména, telefonní čísla, e-mailové adresy, osobní identifikační čísla, čísla účtů a karet, adresy a podobně. Hledá se na tomto počítači jen podle pevně daných textových vzorů — k hledání ani ke skrývání se AI nepoužívá — a nic se neskryje, dokud nezvolíte **Skrýt**. Po volbě **Vyloučit** se kandidát v tomto dokumentu už neobjeví. Místa, která značku pojmout nemohou (záhlaví, poznámky řečníka, název listu…), jsou v seznamu také, abyste je mohli upravit sami.
- Když v kartě poprvé odesíláte a dokument nebo přílohy daného požadavku takové kandidáty stále obsahují, panel se jednou zeptá: **Zkontrolovat** nic neodešle a otevře seznam, **Přesto odeslat** odešle.
- HTML skrývá obsah prvků, hodnoty atributů a řetězcové literály ve skriptech a vykreslená stránka se nikdy nemění. Slides skrývá i celé obrázky, videa a audio a snímek se skrytým obsahem nikdy neodchází jako snímek obrazovky.
- Skryté části zůstanou skryté, když soubor připojíte v jiném editoru, zeptáte se na něj na domovské stránce, čte ho příkaz `ieumoffice` a jeho nástroje MCP nebo se čte přes server MCP aplikace. Před převodem do formátu, který pro značku nemá místo (ODT, CSV, …), se aplikace nejdřív zeptá. Skrývání se nevztahuje na soubory, které program v režimu agenta čte přímo z disku, a obrázky stránek (`render`) ukazují text tak, jak je.

## Soukromí

- Pokyny a příslušný obsah dokumentu putují k **AI, kterou používáte**: společnosti Anthropic nebo OpenAI pod vaším vlastním účtem, pokud používáte předplatné, nebo poskytovateli, jehož klíč jste zadali. Není-li připojena žádná AI, nic se neodesílá.
- Zda se obsah odeslaný přes předplatné použije k trénování AI, určuje nastavení vašeho účtu u dané společnosti.
- Místní soubory se nikam jinam neodesílají; klíče API se ukládají do souboru nastavení aplikace na tomto počítači a odesílají pouze v hlavičkách požadavků.
