import type { zh } from './zh'

export const pl = {
  homeHelpSection: 'Pomoc',
  homeHelpClose: 'Zamknij',
  homeHelpReplay: 'Pokaż ponownie przewodnik powitalny',
  homeHelpReplayFailed:
    'Nie udało się ponownie włączyć przewodnika powitalnego. Spróbuj za chwilę.',
  homeHelpFeedback: 'Wyślij opinię',
  homeHelpWhatsNew: 'Co nowego w tej wersji',

  homeHelpOpenTitle: 'Otwieranie dokumentów',
  homeHelpOpenBody1:
    'Na karcie Ostatnie stuknij „Otwórz plik”, aby wybrać dokument z tego urządzenia lub z innej aplikacji do przechowywania plików.',
  homeHelpOpenBody2:
    'Połącz folder, z którego często korzystasz, a jego dokumenty od razu pojawią się na karcie Foldery.',
  homeHelpOpenBody3:
    'Otwarte dokumenty zostają na karcie Ostatnie. Oznacz dokument gwiazdką, aby znaleźć go także w Ulubionych.',
  homeHelpOpenBody4:
    'Dokument otwiera się najpierw do czytania. Gdy chcesz coś zmienić, stuknij [Edytuj].',

  homeHelpEditTitle: 'Edytowanie i zapisywanie',
  homeHelpEditBody1: 'W trybie czytania stuknij [Edytuj] u góry, aby zacząć wprowadzać zmiany.',
  homeHelpEditBody2:
    'Stuknij tekst, aby wysunąć klawiaturę. Na pasku nad nią jest formatowanie, np. pogrubienie i listy.',
  homeHelpEditBody3:
    'Gdy skończysz, stuknij [Gotowe]. Oryginalny plik zostanie zapisany, a Ty wrócisz do trybu czytania.',
  homeHelpEditBody4:
    'Jeśli nie da się zapisać oryginalnego pliku, użyj „Zapisz jako”, aby utworzyć nowy plik.',

  homeHelpRecoveryTitle: 'Zapisywanie i kopie odzyskiwania',
  homeHelpRecoveryBody1:
    'Podczas edycji aplikacja sama tworzy kopię odzyskiwania. Nie musisz niczego stukać.',
  homeHelpRecoveryBody2: 'Oryginalny plik jest zapisywany, gdy stukniesz [Gotowe].',
  homeHelpRecoveryBody3:
    'Jeśli aplikacja zamknie się przed zapisaniem, przy następnym uruchomieniu u góry karty Ostatnie pojawi się powiadomienie o kopii odzyskiwania. Stamtąd możesz ją przywrócić.',
  homeHelpRecoveryBody4:
    'Ile miejsca zajmują kopie odzyskiwania, sprawdzisz i wyczyścisz w Ustawienia > Pamięć.',

  homeHelpShareTitle: 'Udostępnianie i odbieranie',
  homeHelpShareBody1:
    'Podczas przeglądania dokumentu stuknij [Udostępnij], aby wysłać oryginał bez zmian albo w innym formacie, np. PDF.',
  homeHelpShareBody2:
    'Na liście na ekranie głównym wybierz [⋯] > Udostępnij, aby wysłać oryginalny plik. Przytrzymaj, aby zaznaczyć kilka plików i wysłać je razem.',
  homeHelpShareBody3:
    'Plik wysłany z innej aplikacji otwiera się tylko do odczytu. Aby go zmienić, stuknij [Edytuj kopię]. Oryginał pozostaje bez zmian.',

  homeHelpFlowTitle: 'Widok do czytania dla HWP',
  homeHelpFlowBody1:
    'Dokumenty HWP otwierają się w widoku strony tak, jak na wydruku. Aby dopasować tekst do szerokości ekranu, stuknij [Widok do czytania] w narzędziach widoku.',
  homeHelpFlowBody2:
    'Aby wrócić do układu strony jak na wydruku, stuknij [Widok strony] w narzędziach widoku.',
  homeHelpFlowBody3:
    'Widok do czytania zmienia tylko sposób wyświetlania. Strony dokumentu i zapisany plik pozostają takie same.',

  homeHelpAiTitle: 'Włączanie i wyłączanie AI',
  homeHelpAiBody1:
    'AI jest na początku wyłączona. Dopóki jest wyłączona, nie widać żadnych przycisków AI.',
  homeHelpAiBody2:
    'Aby z niej korzystać, włącz AI w Ustawieniach, a potem w sekcji Połączenia AI dodaj klucz API lub wybierz bezpłatne połączenie. Konto w tej aplikacji nie jest potrzebne.',
  homeHelpAiBody3:
    'Treść trafia do wybranej usługi AI tylko wtedy, gdy o coś poprosisz AI. Gdy znów wyłączysz AI, wszystkie przyciski AI znikną.',

  homeHelpFeedbackTitle: 'Wyślij opinię',
  homeHelpFeedbackBody:
    'Ankieta otworzy się w przeglądarce. Poniższe dane są kopiowane do schowka, aby można je było wkleić do ankiety. Aplikacja sama nic nie wysyła, a treść dokumentów nigdy nie jest dołączana.',
  homeHelpFeedbackDetails: 'Wersja {version}\nSystem {os}\nJęzyk {language}',
  homeHelpFeedbackOpen: 'Otwórz ankietę',
  homeHelpFeedbackCancel: 'Anuluj',
  homeHelpFeedbackCopyFailed:
    'Nie udało się skopiować do schowka. Przytrzymaj tekst poniżej, aby go skopiować, a potem wklej go do ankiety.',
  homeHelpFeedbackOpenFailed: 'Nie udało się otworzyć przeglądarki.',

  homeHelpWhatsNewVersion: 'Wersja {version}',
  homeHelpWhatsNewEmpty: 'Brak informacji o tej wersji.',
  homeHelpNew010First: 'Pierwsza wersja aplikacji mobilnej GenOffice.',
  homeHelpNew010Edit:
    'Otwieranie i edytowanie dokumentów HWP, PDF, Markdown, HTML oraz arkuszy kalkulacyjnych.',
  homeHelpNew010Read: 'Czytanie książek EPUB i prezentacji PPT.',
  homeHelpNew010PdfTools:
    'Narzędzia PDF: porządkowanie stron, konwersja, zmniejszanie rozmiaru i zabezpieczanie, usuwanie adnotacji.',
  homeHelpNew010Ai:
    'Asystent AI, domyślnie wyłączony, który działa z kluczem API lub bezpłatnym połączeniem.',
  homeHelpNew010Mobile:
    'Udostępnianie i odbieranie plików, widok do czytania dla HWP, przewodnik powitalny, zarządzanie pamięcią i ekran, który nie gaśnie podczas czytania.',
} as const satisfies Record<keyof typeof zh, string>
