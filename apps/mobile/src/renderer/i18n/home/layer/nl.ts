import type { zh } from './zh'

export const nl = {
  homeRunEditorOffTitle: 'De editor {name} staat uit',
  homeRunEditorOffBody:
    'Zet hem aan om dit bestand te openen. In Instellingen kun je hem weer uitzetten.',
  homeRunEditorOffConfirm: 'Aanzetten en openen',
  homeRunStripSample: 'Voorbeelddocument · Alleen-lezen',
  homeRunStripReceived: 'Ontvangen bestand · Alleen-lezen',
  homeRunStripReadOnly: 'Alleen-lezen',
  homeRunStripCopy: 'Kopie bewerken',
  homeRunStripClose: 'Melding sluiten',
  homeRunReceiveTitle: 'Ontvangen bestanden',
  homeRunReceiveCount: '{count} bestanden',
  homeRunReceiveClose: 'Ontvangen bestanden sluiten',
  homeRunReceiveOpen: 'Openen',
  homeRunReceivePdfOff: 'De pdf-tools staan uit',
  homeRunReceivePdfOn: 'Aanzetten en doorgaan',
  homeRunGuideLabel: 'Welkomstgids',
  homeRunWelcomeTitle: 'Welkom',
  homeRunWelcomeBody:
    'Open en bewerk HWP, PDF, Markdown en meer met GenOffice. Geen account, geen advertenties, en je documenten blijven op dit apparaat.',
  homeRunStart: 'Aan de slag',
  homeRunTipEditButton: 'Tik op [Bewerken] om iets te veranderen',
  homeRunTipFlowView: 'Tik op [Leesweergave] om op schermbreedte te lezen',
  homeRunTipFirstEdit:
    'Er wordt automatisch een herstelkopie gemaakt. Het origineel wordt opgeslagen als je op [Gereed] tikt',
  homeRunTipFirstKeyboard: 'Wijzig de tekstopmaak met [Aa]',
} as const satisfies Record<keyof typeof zh, string>
