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
  homeRunStep: 'Krok {current} z {total}',
  homeRunWelcomeTitle: 'Witamy',
  homeRunWelcomeBody:
    'Otwieraj i edytuj dokumenty HWP, PDF, Markdown i inne w GenOffice. Bez konta, bez reklam, a dokumenty zostają na tym urządzeniu.',
  homeRunNext: 'Dalej',
  homeRunSkip: 'Pomiń',
  homeRunFolderTitle: 'Połącz folder z dokumentami (opcjonalnie)',
  homeRunFolderBody:
    'Połącz często używany folder, a jego pliki pojawią się od razu na karcie [Foldery].',
  homeRunFolderPick: 'Wybierz folder',
  homeRunLater: 'Później',
  homeRunFolderLinked: '✓ Folder z dokumentami połączony · Zmienisz go w ustawieniach',
  homeRunStart: 'Zaczynamy',
  homeRunTipEditButton: 'Aby wprowadzić zmiany, stuknij [Edytuj]',
  homeRunTipFlowView: 'Przełączono na widok ciągły, by łatwiej czytać · Widok strony jest tutaj',
  homeRunTipFirstEdit:
    'Kopia odzyskiwania tworzy się automatycznie. Oryginał zapisuje się po stuknięciu [Gotowe]',
  homeRunTipFirstKeyboard: 'Zmieniaj formatowanie tekstu przyciskiem [Aa]',
} as const satisfies Record<keyof typeof zh, string>
