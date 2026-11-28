import type { zh } from './zh'

export const it = {
  homeRunEditorOffTitle: 'L’editor {name} è disattivato',
  homeRunEditorOffBody:
    'Attivalo per aprire questo file. Puoi disattivarlo di nuovo nelle Impostazioni.',
  homeRunEditorOffConfirm: 'Attiva e apri',
  homeRunStripSample: 'Documento di esempio · Sola lettura',
  homeRunStripReceived: 'File ricevuto · Sola lettura',
  homeRunStripReadOnly: 'Sola lettura',
  homeRunStripCopy: 'Modifica una copia',
  homeRunStripClose: 'Chiudi avviso',
  homeRunReceiveTitle: 'File ricevuti',
  homeRunReceiveCount: '{count} file',
  homeRunReceiveClose: 'Chiudi i file ricevuti',
  homeRunReceiveOpen: 'Apri',
  homeRunReceivePdfOff: 'Gli strumenti PDF sono disattivati',
  homeRunReceivePdfOn: 'Attiva e continua',
  homeRunGuideLabel: 'Guida di benvenuto',
  homeRunWelcomeTitle: 'Benvenuto',
  homeRunWelcomeBody:
    'Apri e modifica documenti HWP, PDF, Markdown e altro con GenOffice. Nessun account, nessuna pubblicità, e i documenti restano su questo dispositivo.',
  homeRunStart: 'Inizia',
  homeRunTipEditButton: 'Per modificare, tocca [Modifica]',
  homeRunTipFlowView: 'Per adattare il testo allo schermo, tocca [Vista lettura]',
  homeRunTipFirstEdit:
    'Una copia di recupero viene creata automaticamente. L’originale si salva quando tocchi [Fine]',
  homeRunTipFirstKeyboard: 'Cambia il formato del testo con [Aa]',
} as const satisfies Record<keyof typeof zh, string>
