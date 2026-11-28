import type { zh } from './zh'

export const pl = {
  homeRunEditorOffTitle: 'Edytor {name} jest wyłączony',
  homeRunEditorOffBody: 'Włącz go, aby otworzyć ten plik. Możesz go znowu wyłączyć w ustawieniach.',
  homeRunEditorOffConfirm: 'Włącz i otwórz',
  homeRunStripSample: 'Przykładowy dokument · Tylko do odczytu',
  homeRunStripReceived: 'Odebrany plik · Tylko do odczytu',
  homeRunStripReadOnly: 'Tylko do odczytu',
  homeRunStripCopy: 'Edytuj kopię',
  homeRunStripClose: 'Zamknij powiadomienie',
  homeRunReceiveTitle: 'Odebrane pliki',
  homeRunReceiveCount: 'Pliki: {count}',
  homeRunReceiveClose: 'Zamknij odebrane pliki',
  homeRunReceiveOpen: 'Otwórz',
  homeRunReceivePdfOff: 'Narzędzia PDF są wyłączone',
  homeRunReceivePdfOn: 'Włącz i kontynuuj',
  homeRunGuideLabel: 'Przewodnik powitalny',
  homeRunWelcomeTitle: 'Witamy',
  homeRunWelcomeBody:
    'Otwieraj i edytuj dokumenty HWP, PDF, Markdown i inne w GenOffice. Bez konta, bez reklam, a dokumenty zostają na tym urządzeniu.',
  homeRunStart: 'Zaczynamy',
  homeRunTipEditButton: 'Aby wprowadzić zmiany, stuknij [Edytuj]',
  homeRunTipFlowView: 'Aby dopasować tekst do ekranu, stuknij [Widok do czytania]',
  homeRunTipFirstEdit:
    'Kopia odzyskiwania tworzy się automatycznie. Oryginał zapisuje się po stuknięciu [Gotowe]',
  homeRunTipFirstKeyboard: 'Zmieniaj formatowanie tekstu przyciskiem [Aa]',
} as const satisfies Record<keyof typeof zh, string>
