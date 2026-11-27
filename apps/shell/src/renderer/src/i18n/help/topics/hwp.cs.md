# Hangul (HWP / HWPX): úpravy, pracovní panel a tisk

GenOffice otevírá a upravuje dokumenty Hangul `.hwp` a `.hwpx` na kartě a podporuje klávesové zkratky, styly, tabulky, poznámky, tisk i panel AI. Vše běží lokálně na vašem počítači.

## Otevírání, ukládání a tisk

- Otevírá soubory `.hwp` a `.hwpx` z domovské obrazovky, přes **Soubor > Otevřít**, přetažením do okna nebo z Disku Google; převádí soubory PDF na nové karty Hangul přes **Soubor > Importovat PDF**.
- Ukládá zpět ve formátu otevřeného souboru (`.hwp` zůstává `.hwp`, `.hwpx` zůstává `.hwpx`), uchovává zálohu `.bak` před prvním přepsáním, ověřuje zpětné načtení HWP a udržuje automatické ukládání i kopie pro obnovení po pádu.
- Tisk (Ctrl+P) podporuje živý náhled, export do PDF a možnosti vícestránkového rozvržení tisku.

## Levý pracovní panel: Osnova, Najít a Literatura

- Otevřete levý pracovní panel tlačítkem v horní liště, přes **Zobrazit > Pracovní panel** (Osnova / Najít / Literatura), nebo stiskněte **Ctrl+F** pro přímý přechod na kartu Najít. Klasické hledání (**Ctrl+Q,F**) i Najít a nahradit (**Ctrl+H**) zůstávají dostupné.
- **Karta Osnova**: zobrazuje nativní nadpisy osnovy Hangul i nadpisy namapované ze stylů (výchozí `제목 N` / `Heading N`, lze upravit pro dokument nebo celou aplikaci v panelu nastavení osnovy). Filtrujte podle úrovně (`1`, `2`, `3`, ... Vše), sbalujte větve, kliknutím přecházejte na místo, zvyšujte či snižujte úroveň nadpisů (ve výchozím stavu včetně podnadpisů, nebo podržte **Shift** pro jediný nadpis) a přetahováním nadpisů měňte pořadí celých sekcí v jediném kroku zpět.
- **Karta Najít**: hledá v hlavním textu, tabulkách (včetně vnořených), textových polích, poznámkách pod čarou a vysvětlivkách (mimo záhlaví a zápatí) s filtry rozlišení velkých a malých písmen, celých slov, regulárních výrazů, stylu odstavce a formátování znaků. Kliknutím na výsledek na něj skočíte a vyberete jej, případně nahradíte jednu, vybrané nebo všechny shody v jediném kroku zpět (vložené objekty a značky citací se přeskočí a zobrazí se jejich počet).
- Pracovní panel si pamatuje stav otevření, aktivní kartu a šířku, v úzkých oknech se sbalí do lišty ikon a v režimu prezentace či náhledu tisku se skryje. Všechny funkce pracovního panelu pracují bez AI.

## Poznámky, zkratky a panel AI

- Otevřete sloupec poznámek z horní lišty nebo přes **Vložit > Poznámka** a čtěte, přidávejte, upravujte či mažte prosté textové poznámky vedle dokumentu.
- Podporuje klávesové zkratky pro úpravy dokumentů Hangul, značky odstavců na vodorovném pravítku, Kopírování formátu (**Alt+C**), převod Hanja (**F9** / klávesa Hanja) a Informace o dokumentu (**Ctrl+Q,I**).
- Volitelný panel AI a [příkazy terminálu](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) dokážou číst a upravovat text, styly, tabulky, rovnice, rozvržení stránky, osnovu i výsledky hledání; každá úprava AI představuje jediný krok zpět.

## Obsah: vytvoření a aktualizace

- Pomocí **Nástroje > Vytvořit obsah** (nebo **Nástroje > Aktualizovat obsah**, případně pravým kliknutím uvnitř obsahu) vložíte **obsah** z nadpisů v Osnově a také seznamy **tabulek**, **obrázků** a **rovnic** z titulků objektů a odstavců titulků.
- Vyberte rozvržení **Tečkovaný tabulátor** (výchozí) nebo **Tabulka bez ohraničení** (2 sloupce), nastavte hloubku nadpisů (úrovně 1–10, výchozí 3), upravte název a volitelně přidejte klikací odkazy (kliknutím nebo **Ctrl+kliknutím** na řádek přejdete přímo na daný nadpis).
- Čísla stránek odpovídají tištěnému číslování stránek včetně nového začátku číslování a římských či vlastních formátů.
- Aktualizace obnoví položky i čísla stránek na místě, upozorní vás před přepsáním ručně upravených řádků a rozpozná existující neoznačené obsahy vytvořené v jiném programu, přičemž si před jejich nahrazením vyžádá potvrzení.

## Rejstřík: označení položek a vytvoření

- Pomocí **Nástroje > Označit položku rejstříku** (nebo pravým kliknutím v hlavním textu) označíte vybrané slovo či slovo pod kurzorem, přidáte volitelnou podpoložku nebo označíte všechny výskyty (pouze v hlavním textu; zobrazí se počet přeskočených výskytů v tabulkách, textových polích a poznámkách). Ve stejném dialogu lze existující značky prohlížet a mazat.
- Pomocí **Nástroje > Vytvořit rejstřík** vložíte rejstřík na pozici kurzoru a po úpravách jej obnovíte přes **Nástroje > Aktualizovat rejstřík**. Výchozí název („Rejstřík“) lze upravit.
- Položky jsou řazeny v pořadí korejština (가나다) → angličtina (ABC) → ostatní, s volitelnými záhlavími skupin podle písmen/souhlásek, v 1–3 sloupcích (výchozí 2 sloupce, omezené pouze na rejstřík beze změny sloupců ve zbytku dokumentu) a v rozvržení **Tečkovaný tabulátor** nebo **Tabulka bez ohraničení**.

## Upozornění na neaktuálnost a kopie k odevzdání

- Při ručním uložení, tisku, exportu do PDF nebo uložení kopie k odevzdání editor zkontroluje, zda nejsou obsahy či rejstřík zastaralé, a nabídne hromadnou aktualizaci v jednom kroku zpět. Kontrola se nikdy nespouští při automatickém ukládání a nikdy neblokuje uložení.
- Pomocí **Soubor > Uložit jako kopii k odevzdání** uložíte samostatnou čistou kopii bez interních editačních značek (značek rejstříku, značek bloku rejstříku a uložených nastavení), zatímco obsahy, kotvy nadpisů i odkazy v obsahu zůstanou zachovány. Původní pracovní soubor zůstane nedotčený, takže jej můžete dále aktualizovat.

## Literatura a citace

- Otevřete kartu **Literatura** v levém pracovním panelu (nebo **Nástroje > Literatura**) a spravujte jedinou lokální knihovnu pramenů na svém počítači s vyhledáváním, štítky, přidáváním/úpravami/mazáním, importem a exportem (`BibTeX`, `RIS`, `CSL JSON`) i načítáním řádků ze stávajícího seznamu literatury v dokumentu s potvrzením v náhledu.
- Podporuje čtyři citační styly (**APA 7**, **Chicago**, **MLA 9** a **IEEE**; korejské prameny dodržují korejský akademický formát ve všech čtyřech stylech). Vkládejte citace v závorce, v textu nebo vícenásobné citace s čísly stránek a vytvářejte či obnovujte seznam literatury s předsazením; přepnutí stylu aktualizuje označené citace i seznam v jednom kroku zpět, přičemž ručně upravené citace zůstávají zachovány.
- Vestavěná 6bodová kontrola (chybí v seznamu literatury, necitované položky, pořadí řazení, chybějící přípony a/b, ruční úpravy citací a neověřené položky) umožňuje kliknutím přejít přímo na nalezené místo a před ručním uložením, tiskem či exportem upozorní na zastaralý seznam literatury nebo číslování IEEE.
- Volitelné vyhledávání pramenů pomocí AI (pokud jsou zapnuté internetové nástroje) vždy vkládá návrhy jako **Neověřeno** se zdrojovou adresou URL v poznámkách; nelze je citovat ani zahrnout do seznamu literatury, dokud je sami nezkontrolujete a neoznačíte jako **Ověřeno**.

## Makra: záznam kláves a skripty

- Použijte **Nástroje > Makra** (nebo stiskněte **Alt+Shift+H** pro spuštění či zastavení záznamu kláves a **Alt+Shift+X** pro zastavení), chcete-li zaznamenat psaný text, pohyb kurzoru, formátování, styly, tabulky a podporované úpravy přímo do upravitelného skriptu. Během záznamu se v horní liště zobrazí indikátor a nepodporované akce nebo kliknutí myší jsou ihned ohlášeny a po skončení vypsány jako přeskočené.
- Otevřete **Správce maker**, kde můžete spravovat lokálně uložená makra, přiřadit až 11 pozic klávesových zkratek (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), upravovat skripty s označením řádku a sloupce syntaktických chyb a exportovat či importovat prosté textové soubory `.ieummacro`. Importované skripty se zobrazí v plném znění a před spuštěním je nutné je potvrdit a uložit; makra vložená v dokumentech se nikdy nečtou ani nespouštějí.
- Každé makro běží synchronně v omezeném interpretu podporujícím dokumentové API aplikace a kompatibilní skriptovací objekty maker (`HAction`, `HParameterSet`) s limity času, kroků, hloubky volání a paměti i s ochranou objektů a poznámek. Jedno spuštění je vždy jeden krok Zpět a při jakékoli chybě, nepodporované akci nebo překročení limitu se všechny změny kompletně vrátí.
- Volitelná funkce **Napsat pomocí AI** (v editoru maker zobrazená jen při zapnuté AI) umožňuje popsat opakovaný úkol a nechat vygenerovat návrh skriptu; odesílá se pouze váš popis a přehled API maker, nikdy samotný dokument. Návrh se vloží jen do textového pole editoru a nikdy se automaticky neuloží ani nespustí.
