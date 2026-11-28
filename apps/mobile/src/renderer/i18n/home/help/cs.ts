import type { zh } from './zh'

export const cs = {
  homeHelpSection: 'Nápověda',
  homeHelpClose: 'Zavřít',
  homeHelpReplay: 'Znovu zobrazit úvodního průvodce',
  homeHelpReplayFailed: 'Úvodního průvodce se nepodařilo znovu zapnout. Zkuste to za chvíli.',
  homeHelpFeedback: 'Odeslat zpětnou vazbu',
  homeHelpWhatsNew: 'Co je nového v této verzi',

  homeHelpOpenTitle: 'Otevírání dokumentů',
  homeHelpOpenBody1:
    'Na kartě Nedávné klepněte na „Otevřít soubor“ a vyberte dokument v tomto zařízení nebo v jiné aplikaci s úložištěm.',
  homeHelpOpenBody2:
    'Propojte složku, kterou často používáte, a její dokumenty se hned zobrazí na kartě Složky.',
  homeHelpOpenBody3:
    'Otevřené dokumenty zůstávají na kartě Nedávné. Když dokument označíte hvězdičkou, najdete ho také v Oblíbených.',
  homeHelpOpenBody4:
    'Dokument se nejdřív otevře pro čtení. Když ho chcete změnit, klepněte na [Upravit].',

  homeHelpEditTitle: 'Úpravy a ukládání',
  homeHelpEditBody1: 'V režimu čtení klepněte nahoře na [Upravit] a můžete začít upravovat.',
  homeHelpEditBody2:
    'Klepnutím na text vyvoláte klávesnici. Na liště nad ní najdete formátování, například tučné písmo a seznamy.',
  homeHelpEditBody3:
    'Až budete hotovi, klepněte na [Hotovo]. Původní soubor se uloží a vrátíte se do režimu čtení.',
  homeHelpEditBody4:
    'Pokud do původního souboru nejde zapisovat, vytvořte nový soubor pomocí „Uložit jako“.',

  homeHelpRecoveryTitle: 'Ukládání a kopie pro obnovení',
  homeHelpRecoveryBody1:
    'Během úprav si aplikace sama ukládá kopii pro obnovení. Nemusíte na nic klepat.',
  homeHelpRecoveryBody2: 'Původní soubor se zapíše, když klepnete na [Hotovo].',
  homeHelpRecoveryBody3:
    'Pokud se aplikace zavře dřív, než uložíte, při příštím spuštění se nahoře na kartě Nedávné objeví upozornění na kopii pro obnovení. Odtud ji obnovíte.',
  homeHelpRecoveryBody4:
    'Kolik místa kopie pro obnovení zabírají, zjistíte a vymažete v Nastavení > Úložiště.',

  homeHelpShareTitle: 'Sdílení a přijímání',
  homeHelpShareBody1:
    'Při prohlížení dokumentu klepněte na [Sdílet] a pošlete originál tak, jak je, nebo v jiném formátu, například PDF.',
  homeHelpShareBody2:
    'V seznamu na domovské obrazovce zvolte [⋯] > Sdílet a pošlete původní soubor. Dlouhým stisknutím vyberete více souborů a pošlete je najednou.',
  homeHelpShareBody3:
    'Soubor poslaný z jiné aplikace se otevře jen pro čtení. Chcete-li ho změnit, klepněte na [Upravit kopii]. Originál zůstane beze změny.',

  homeHelpFlowTitle: 'Zobrazení pro čtení u HWP',
  homeHelpFlowBody1:
    'Dokumenty HWP se otevírají v zobrazení stránky tak, jak by se vytiskly. Chcete-li text přizpůsobit šířce obrazovky, klepněte v nástrojích zobrazení na [Zobrazení pro čtení].',
  homeHelpFlowBody2:
    'Chcete-li se vrátit k rozvržení stránky pro tisk, klepněte v nástrojích zobrazení na [Zobrazení stránky].',
  homeHelpFlowBody3:
    'Zobrazení pro čtení mění jen to, jak se dokument zobrazuje. Jeho stránky i uložený soubor zůstávají stejné.',

  homeHelpAiTitle: 'Zapnutí a vypnutí AI',
  homeHelpAiBody1: 'AI je zpočátku vypnutá. Dokud je vypnutá, žádná tlačítka AI se nezobrazují.',
  homeHelpAiBody2:
    'Chcete-li ji používat, zapněte AI v Nastavení a pak v části AI připojení zadejte klíč API nebo zvolte bezplatné připojení. Účet v této aplikaci nepotřebujete.',
  homeHelpAiBody3:
    'Obsah se odešle do zvolené služby AI jen tehdy, když AI o něco požádáte. Když AI znovu vypnete, všechna tlačítka AI zmizí.',

  homeHelpFeedbackTitle: 'Odeslat zpětnou vazbu',
  homeHelpFeedbackBody:
    'Dotazník se otevře v prohlížeči. Údaje níže se zkopírují do schránky, abyste je mohli vložit do dotazníku. Aplikace sama nic neodesílá a obsah dokumentů se nikdy nepřikládá.',
  homeHelpFeedbackDetails: 'Verze {version}\nSystém {os}\nJazyk {language}',
  homeHelpFeedbackOpen: 'Otevřít dotazník',
  homeHelpFeedbackCancel: 'Zrušit',
  homeHelpFeedbackCopyFailed:
    'Do schránky se nepodařilo zkopírovat. Dlouhým stisknutím textu níže ho zkopírujte a pak vložte do dotazníku.',
  homeHelpFeedbackOpenFailed: 'Prohlížeč se nepodařilo otevřít.',

  homeHelpWhatsNewVersion: 'Verze {version}',
  homeHelpWhatsNewEmpty: 'K této verzi nejsou žádné poznámky.',
  homeHelpNew010First: 'První verze mobilní aplikace GenOffice.',
  homeHelpNew010Edit: 'Otevírání a úpravy dokumentů HWP, PDF, Markdown, HTML a tabulek.',
  homeHelpNew010Read: 'Čtení knih EPUB a prezentací PPT.',
  homeHelpNew010PdfTools:
    'Nástroje PDF: uspořádání stránek, převod, zmenšení velikosti a zabezpečení, odstranění poznámek.',
  homeHelpNew010Ai:
    'Pomocník AI, zpočátku vypnutý, který funguje s klíčem API nebo s bezplatným připojením.',
  homeHelpNew010Mobile:
    'Sdílení a přijímání souborů, zobrazení pro čtení u HWP, úvodní průvodce, správa úložiště a obrazovka, která při čtení nezhasne.',
} as const satisfies Record<keyof typeof zh, string>
