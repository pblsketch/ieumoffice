# Hangul (HWP / HWPX): edycja, panel roboczy i drukowanie

GenOffice otwiera i edytuje dokumenty Hangul `.hwp` oraz `.hwpx` na karcie, oferując skróty klawiszowe, style, tabele, notatki, drukowanie oraz panel AI. Wszystko działa lokalnie na Twoim komputerze.

## Otwieranie, zapisywanie i drukowanie

- Otwiera pliki `.hwp` i `.hwpx` ze strony głównej, przez **Plik > Otwórz**, przeciągnięcie do okna lub z Dysku Google; konwertuje pliki PDF na nowe karty Hangul przez **Plik > Importuj PDF**.
- Zapisuje z powrotem w formacie otwartego pliku (`.hwp` pozostaje `.hwp`, `.hwpx` pozostaje `.hwpx`), tworzy kopię zapasową `.bak` przed pierwszym nadpisaniem, sprawdza ponowny odczyt HWP oraz utrzymuje autozapis i kopie odzyskiwania po awarii.
- Drukowanie (Ctrl+P) obsługuje podgląd na żywo, eksport do PDF oraz wielostronicowe opcje układu wydruku.

## Lewy panel roboczy: Konspekt, Znajdź i Bibliografia

- Otwórz lewy panel roboczy przyciskiem na górnym pasku, przez **Widok > Panel roboczy** (Konspekt / Znajdź / Bibliografia) lub naciśnij **Ctrl+F**, aby przejść od razu do karty Znajdź. Tradycyjne wyszukiwanie (**Ctrl+Q,F**) oraz Znajdź i zamień (**Ctrl+H**) pozostają dostępne.
- **Karta Konspekt**: wyświetla natywne nagłówki konspektu Hangul oraz nagłówki mapowane według stylów (domyślnie `제목 N` / `Heading N`, z możliwością dostosowania dla dokumentu lub całej aplikacji w panelu ustawień konspektu). Filtruj według poziomu (`1`, `2`, `3`, ... Wszystkie), zwijaj gałęzie, klikaj, aby przeskoczyć, podnoś lub obniżaj poziom nagłówków (domyślnie wraz z podnagłówkami lub z przytrzymanym **Shift** dla pojedynczego nagłówka) oraz przeciągaj nagłówki, aby zmienić kolejność całych sekcji w jednym kroku cofania.
- **Karta Znajdź**: przeszukuje treść główną, tabele (w tym zagnieżdżone), pola tekstowe, przypisy dolne i końcowe (z wyłączeniem nagłówków i stopek) z filtrami wielkości liter, całych słów, wyrażeń regularnych, stylu akapitu i formatowania znaków. Kliknij wynik, aby przejść do niego i zaznaczyć, albo zamień jedno, zaznaczone lub wszystkie wystąpienia w jednym kroku cofania (z pominięciem obiektów w tekście i znaczników cytowań oraz podaniem ich liczby).
- Panel roboczy zapamiętuje stan otwarcia, aktywną kartę i szerokość, zwija się do paska ikon w wąskich oknach i ukrywa się w trybie prezentacji oraz podglądzie wydruku. Wszystkie funkcje panelu działają bez AI.

## Notatki, skróty i panel AI

- Otwórz kolumnę notatek z górnego paska lub przez **Wstaw > Notatka**, aby czytać, dodawać, edytować i usuwać notatki tekstowe obok dokumentu.
- Obsługuje skróty klawiszowe edycji dokumentów Hangul, znaczniki akapitu na poziomej linijce, Kopiowanie formatu (**Alt+C**), konwersję Hanja (**F9** / klawisz Hanja) oraz Informacje o dokumencie (**Ctrl+Q,I**).
- Opcjonalny panel AI i [polecenia terminala](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) mogą odczytywać i edytować tekst, style, tabele, równania, układ strony, konspekt oraz wyniki wyszukiwania; każda zmiana AI stanowi jeden krok cofania.

## Spis treści: tworzenie i aktualizowanie

- Użyj **Narzędzia > Utwórz spis treści** (lub **Narzędzia > Aktualizuj spis treści**, albo kliknij prawym przyciskiem wewnątrz spisu treści), aby wstawić **spis treści** na podstawie nagłówków z Konspektu oraz spisy **tabel**, **rysunków** i **równań** na podstawie podpisów obiektów i akapitów podpisów.
- Wybierz układ **Tabulator z kropkami** (domyślny) lub **Tabela bez obramowania** (2 kolumny), ustaw głębokość nagłówków (poziomy 1–10, domyślnie 3), dostosuj tytuł i opcjonalnie dodaj klikalne łącza (kliknij lub użyj **Ctrl+kliknięcie** wiersza, aby przejść bezpośrednio do nagłówka).
- Numery stron odpowiadają drukowanej numeracji stron, z uwzględnieniem ponownego rozpoczynania numeracji oraz formatów rzymskich i niestandardowych.
- Aktualizacja odświeża wpisy i numery stron w miejscu, ostrzega przed nadpisaniem ręcznie edytowanych wierszy oraz wykrywa istniejące nieoznaczone spisy treści utworzone w innym programie, pytając o potwierdzenie przed ich zastąpieniem.

## Indeks: oznaczanie haseł i tworzenie

- Użyj **Narzędzia > Oznacz hasło indeksu** (lub kliknij prawym przyciskiem w tekście głównym), aby oznaczyć zaznaczone słowo lub słowo pod kursorem, dodać opcjonalne podhasło albo oznaczyć wszystkie pasujące wystąpienia (tylko w tekście głównym; z podaniem liczby wystąpień pominiętych w tabelach, polach tekstowych i przypisach). W tym samym oknie można przeglądać i usuwać istniejące znaczniki.
- Użyj **Narzędzia > Utwórz indeks**, aby wstawić indeks w miejscu kursora, a następnie **Narzędzia > Aktualizuj indeks** po wprowadzeniu zmian. Domyślny tytuł („Indeks”) można zmienić.
- Hasła są sortowane w kolejności koreańskiej (가나다) → angielskiej (ABC) → inne, z opcjonalnymi nagłówkami grup literowych, w 1–3 kolumnach (domyślnie 2 kolumny, wyłącznie dla sekcji indeksu bez zmiany kolumn w reszcie dokumentu) i w układzie **Tabulator z kropkami** lub **Tabela bez obramowania**.

## Powiadomienie o nieaktualności i kopia do złożenia

- Podczas ręcznego zapisywania, drukowania, eksportu do PDF lub zapisywania kopii do złożenia edytor sprawdza, czy spisy treści lub indeks nie są nieaktualne, i proponuje zaktualizowanie wszystkiego w jednym kroku cofania. Kontrola nigdy nie uruchamia się podczas autozapisu i nie blokuje zapisywania.
- Użyj **Plik > Zapisz jako kopię do złożenia**, aby zapisać osobną, czystą kopię pozbawioną wewnętrznych znaczników edycji (znaczników indeksu, granic bloku indeksu i zapisanych ustawień) przy zachowaniu spisów treści, kotwic nagłówków i łączy. Oryginalny plik roboczy pozostaje nienaruszony, dzięki czemu możesz go dalej aktualizować.

## Bibliografia i cytowania

- Otwórz kartę **Bibliografia** w lewym panelu roboczym (lub **Narzędzia > Bibliografia**), aby zarządzać jedną lokalną biblioteką źródeł na komputerze z wyszukiwaniem, tagami, dodawaniem/edycją/usuwaniem, importem i eksportem (`BibTeX`, `RIS`, `CSL JSON`) oraz wczytywaniem wierszy z istniejącej listy bibliografii w dokumencie po podglądzie i potwierdzeniu.
- Obsługuje cztery style cytowania (**APA 7**, **Chicago**, **MLA 9** i **IEEE**; publikacje koreańskie stosują koreański format akademicki we wszystkich czterech stylach). Wstawiaj cytowania w nawiasach, narracyjne lub wielokrotne z numerami stron oraz twórz i odświeżaj bibliografię z wysunięciem; zmiana stylu aktualizuje oznaczone cytowania i bibliografię w jednym kroku cofania, pomijając cytowania zmodyfikowane ręcznie.
- Wbudowana 6-punktowa kontrola (brak w bibliografii, niecytowane pozycje, kolejność sortowania, brakujące przyrostki a/b, ręczne poprawki cytowań oraz pozycje niezweryfikowane) pozwala kliknięciem przejść wprost do każdego miejsca, a przed ręcznym zapisem, drukiem lub eksportem wyświetla przypomnienie o nieaktualnej bibliografii lub numeracji IEEE.
- Opcjonalne wyszukiwanie źródeł przez AI (przy włączonych narzędziach internetowych) zawsze dodaje propozycje jako **Niezweryfikowane** z adresem URL źródła w notatkach; nie można ich cytować ani umieszczać w bibliografii, dopóki sam ich nie sprawdzisz i nie oznaczysz jako **Zweryfikowane**.

## Makra: nagrywanie klawiszy i skrypty

- Użyj **Narzędzia > Makra** (lub naciśnij **Alt+Shift+H**, aby rozpocząć albo zatrzymać nagrywanie klawiszy, oraz **Alt+Shift+X**, aby je zatrzymać), aby zapisywać wpisywany tekst, ruchy kursora, formatowanie, style, tabele i obsługiwane operacje edycji bezpośrednio jako edytowalny skrypt. Podczas nagrywania na górnym pasku widać wskaźnik nagrywania, a nieobsługiwane polecenia lub kliknięcia myszą są zgłaszane od razu i wyświetlane jako pominięte po zakończeniu.
- Otwórz **Menedżer makr**, aby zarządzać makrami zapisanymi lokalnie, przypisywać do 11 skrótów (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), edytować skrypty ze wskazaniem wiersza i kolumny błędów składni oraz eksportować lub importować zwykłe pliki tekstowe `.ieummacro`. Importowane skrypty są pokazywane w całości i wymagają potwierdzenia oraz zapisania przed uruchomieniem; makra osadzone w dokumentach nigdy nie są odczytywane ani uruchamiane. W systemie macOS uruchamiaj makra i zarządzaj nimi z menu **Narzędzia > Makra**, ponieważ skróty z klawiszem Option wprowadzają znaki.
- Każde makro działa synchronicznie w ograniczonym interpreterze obsługującym API dokumentu aplikacji oraz zgodne obiekty skryptowe makr (`HAction`, `HParameterSet`), z limitami czasu, kroków, głębokości wywołań i pamięci oraz ochroną obiektów i notatek. Jedno uruchomienie to zawsze jeden krok cofania i jest w całości wycofywane w razie błędu, nieobsługiwanej akcji lub przekroczenia limitu.
- Opcjonalna funkcja **Napisz z AI** (widoczna w edytorze makr tylko wtedy, gdy AI jest włączone) pozwala opisać powtarzalne zadanie, aby wygenerować szkic skryptu; wysyłany jest wyłącznie opis i dokumentacja API makr, nigdy treść dokumentu. Wygenerowany szkic trafia tylko do pola edycji i nigdy nie jest automatycznie zapisywany ani uruchamiany.
