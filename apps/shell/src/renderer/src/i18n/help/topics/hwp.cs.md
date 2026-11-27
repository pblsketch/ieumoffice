# Hangul (HWP / HWPX): úpravy, pracovní panel a tisk

GenOffice otevírá a upravuje dokumenty Hangul `.hwp` a `.hwpx` na kartě a podporuje klávesové zkratky, styly, tabulky, poznámky, tisk i panel AI. Vše běží lokálně na vašem počítači.

## Otevírání, ukládání a tisk

- Otevírá soubory `.hwp` a `.hwpx` z domovské obrazovky, přes **Soubor > Otevřít**, přetažením do okna nebo z Disku Google; převádí soubory PDF na nové karty Hangul přes **Soubor > Importovat PDF**.
- Ukládá zpět ve formátu otevřeného souboru (`.hwp` zůstává `.hwp`, `.hwpx` zůstává `.hwpx`), uchovává zálohu `.bak` před prvním přepsáním, ověřuje zpětné načtení HWP a udržuje automatické ukládání i kopie pro obnovení po pádu.
- Tisk (Ctrl+P) podporuje živý náhled, export do PDF a možnosti vícestránkového rozvržení tisku.

## Levý pracovní panel: Osnova a Najít

- Otevřete levý pracovní panel tlačítkem v horní liště, přes **Zobrazit > Pracovní panel** (Osnova / Najít), nebo stiskněte **Ctrl+F** pro přímý přechod na kartu Najít. Klasické hledání (**Ctrl+Q,F**) i Najít a nahradit (**Ctrl+H**) zůstávají dostupné.
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
