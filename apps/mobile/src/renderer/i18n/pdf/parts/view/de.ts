import type { zh } from './zh'

export const de = {
  pdfViewEditorName: 'PDF-Editor',
  pdfViewLoading: 'Wird geöffnet…',
  pdfViewOpenFailed:
    'Dieses PDF konnte nicht geöffnet werden. Die Datei ist möglicherweise beschädigt oder kein PDF.',
  pdfViewCertEncrypted:
    'Diese PDF ist mit einem Zertifikat geschützt, nicht mit einem Kennwort. Öffnen Sie sie in der Anwendung, die sie ausgestellt hat.',
  pdfViewBlankUnavailable: 'Neues PDF konnte nicht erstellt werden.',
  pdfViewPagesFailed: 'Einige Seiten konnten nicht gelesen werden und bleiben leer.',
  pdfViewPageBroken: 'Diese Seite kann nicht angezeigt werden',
  pdfViewPageLabel: 'Seite {page}',
  pdfViewPageIndicator: 'Seite {page} von {count}',
  pdfViewInternalLink: 'Zur verlinkten Seite',
  pdfViewPasswordTitle: 'Dieses PDF ist verschlüsselt',
  pdfViewPasswordBody:
    '„{name}“ ist kennwortgeschützt. Geben Sie das Kennwort ein, um es zu öffnen.',
  pdfViewPasswordLabel: 'Kennwort',
  pdfViewPasswordPlaceholder: 'Passwort eingeben',
  pdfViewPasswordShow: 'Kennwort anzeigen',
  pdfViewPasswordHide: 'Kennwort ausblenden',
  pdfViewPasswordOpen: 'Öffnen',
  pdfViewPasswordWrong: 'Falsches Passwort, bitte erneut versuchen',
  pdfViewReadOnlyEncrypted: 'Verschlüsseltes Dokument ist schreibgeschützt',
  pdfViewReadOnlyDamaged: 'Beschädigte Datei: unlesbare Seiten bleiben leer, schreibgeschützt',
  pdfViewReadOnlyNotWritable:
    'Diese Datei kann nicht an ihrem Ort gespeichert werden und ist schreibgeschützt',
  pdfViewSearch: 'Suchen',
  pdfViewSearchPlaceholder: 'Im Dokument suchen',
  pdfViewSearching: 'Suche läuft…',
  pdfViewSearchNone: 'Keine Treffer',
  pdfViewSearchPrev: 'Zurück',
  pdfViewSearchNext: 'Weiter',
  pdfViewSearchClose: 'Suche schließen',
  pdfViewOutline: 'Gliederung',
  pdfViewOutlineEmpty: 'Dieses Dokument hat keine Gliederung',
  pdfViewGoToPage: 'Gehe zu Seite',
  pdfViewGoToPageLabel: 'Seitenzahl (1–{count})',
  pdfViewGoToPageGo: 'Los',
  pdfViewGoToPageInvalid: 'Geben Sie eine Zahl von 1 bis {count} ein',
} as const satisfies Record<keyof typeof zh, string>
