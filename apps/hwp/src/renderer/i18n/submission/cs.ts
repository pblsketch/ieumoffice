import type { zh } from './zh'

export const cs = {
  staleDialogTitle: 'Položky vyžadují aktualizaci',
  staleDialogBody:
    'Následující položky mohou být po nedávných úpravách zastaralé. Chcete je před pokračováním obnovit?',
  staleActionSave: 'Uložit',
  staleActionPrint: 'Tisknout',
  staleActionPdf: 'Exportovat PDF',
  staleActionSubmission: 'Uložit kopii k odevzdání',
  staleBtnRefreshAll: 'Obnovit vše',
  staleBtnContinue: 'Pokračovat bez obnovení',
  staleBtnCancel: 'Zrušit',
  staleReasonPagesChanged: 'Změnila se čísla stránek',
  staleReasonEntriesChanged: 'Změnily se položky',
  staleKindTocBody: 'Obsah',
  staleKindTocTable: 'Seznam tabulek',
  staleKindTocFigure: 'Seznam obrázků',
  staleKindTocEquation: 'Seznam rovnic',
  staleKindIndex: 'Rejstřík',
  staleKindBibliography: 'Literatura',
  staleManualConfirmTitle: 'Zjištěny ruční úpravy',
  staleManualConfirmBody: 'Ruční úpravy byly nalezeny v: {items}. Přepsat je a přesto obnovit?',
  staleManualOverwrite: 'Přepsat a obnovit',
  staleManualSkip: 'Přeskočit',
  staleRefreshDone: 'Aktualizováno {count} položek.',
  staleRefreshFailed: 'Některé položky se nepodařilo aktualizovat: {error}',
  staleRefreshBlockedObjects:
    'Obnovení bylo přeskočeno, protože rozsah obsahu nebo rejstříku obsahuje uživatelské objekty, například poznámky pod čarou, obrázky nebo tabulky.',
  submissionMenuLabel: 'Uložit jako kopii k odevzdání…',
  submissionMenuDesc: 'Uloží samostatnou čistou kopii bez značek rejstříku, citací a nastavení.',
  submissionSaving: 'Vytváření kopie k odevzdání…',
  submissionSaved: 'Kopie k odevzdání uložena: {name}',
  submissionBackupKept: 'Záloha předchozího souboru byla ponechána: {name}',
  submissionSavedTailsLost:
    'Kopie k odevzdání uložena ({name}). Některé vzorové stránky nebo komentáře se nepodařilo zachovat.',
  submissionFailedProtected: 'Dokumenty chráněné heslem nelze uložit jako kopii k odevzdání.',
  submissionFailedTracked: 'Dokumenty se sledováním změn nelze uložit jako kopii k odevzdání.',
  submissionFailedSameAsOpen:
    'Otevřený dokument nelze přepsat kopií k odevzdání. Zvolte jiný název souboru.',
  submissionFailedStrip:
    'Kopie k odevzdání nebyla uložena, protože některé interní značky se nepodařilo odstranit: {marks}',
  submissionFailedVerify:
    'Ověření kopie k odevzdání selhalo ({before} → {after} stránek). Zkuste formát HWPX.',
  submissionFailedExport: 'Nepodařilo se vytvořit kopii k odevzdání: {error}',
  submissionFailedWrite: 'Nepodařilo se uložit kopii k odevzdání: {error}',
} satisfies Record<keyof typeof zh, string>
