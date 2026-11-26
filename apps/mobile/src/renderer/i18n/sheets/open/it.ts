import type { zh } from './zh'

export const it = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Caricamento della griglia…',
  sheetsOpening: 'Apertura della cartella di lavoro… I file grandi richiedono qualche istante.',
  sheetsPasswordTitle: 'Cartella di lavoro protetta da password',
  sheetsPasswordMessage: 'Inserisci la password per aprire questa cartella di lavoro.',
  sheetsPasswordLabel: 'Password',
  sheetsPasswordWrong: 'La password non è corretta. Riprova.',
  sheetsPasswordOpen: 'Apri',
  sheetsPasswordCancel: 'Annulla',
  sheetsEncryptionUnsupported: 'Questo tipo di protezione con password non può essere aperto.',
  sheetsEncryptionDamaged:
    'Questa cartella di lavoro protetta è danneggiata e non può essere aperta.',
  sheetsNoticeMacros: 'Le macro vengono mantenute ma non eseguite.',
  sheetsNoticeExternalLinks:
    "Le celle che rimandano ad altri file mostrano l'ultimo valore salvato.",
  sheetsNoticeMacrosAndLinks:
    "Le macro vengono mantenute ma non eseguite. Le celle che rimandano ad altri file mostrano l'ultimo valore salvato.",
} as const satisfies Record<keyof typeof zh, string>
