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
