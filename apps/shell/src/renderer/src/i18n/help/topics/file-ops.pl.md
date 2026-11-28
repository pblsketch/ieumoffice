# Operacje na plikach: zmiana nazwy, usuwanie, eksport

Ten rozdział opisuje operacje na plikach wspólne dla wszystkich edytorów; opcje eksportu każdego edytora znajdziesz w jego rozdziale.

**⋯ menu** w wierszu (pojawia się po najechaniu na wiersz pliku) zbiera te działania:

![⋯ menu wiersza pliku](img/file-ops.png)

## Zmiana nazwy

Dwa wejścia, jeden zestaw sprawdzeń:

- **⋯ ▸ Zmień nazwę** w wierszu na stronie głównej.
- **Kliknięcie dwukrotnie karty pliku** zmienia nazwę w miejscu (patrz [Karty i zarządzanie oknami](help://tabs-and-windows)).

Zasady: rozszerzenie jest zachowywane automatycznie; niedozwolone znaki, kropki na końcu i nazwy zastrzeżone (CON, NUL i tym podobne) są odrzucane z komunikatem; konflikt nazwy w tym samym folderze również jest blokowany. Zmieniana jest nazwa prawdziwego pliku na dysku, a listy ostatnich i ulubionych aktualizują się wraz z nią.

## Usuwanie

- **⋯ ▸ Usuń** na stronie głównej: pyta, które pliki, a następnie przenosi je do **kosza systemowego**, skąd system operacyjny może je przywrócić. GenOffice nie trzyma własnego cofnięcia — przywracanie to zadanie kosza, nie komunikatu.

## Duplikowanie

**⋯ ▸ Utwórz kopię** tworzy kopię pliku <nazwa> w tym samym folderze; przy kolizji nazw automatycznie dopisywany jest licznik. Kopia trafia do **Ostatnie**, zamiast otworzyć się sama — jeden klik dalej, a nie przed nosem.

## Zapisz i Zapisz jako

- **⌘S / ctrl+S** zapisuje bieżący plik; plik bez tytułu najpierw pyta o lokalizację i nazwę.
- W większości edytorów lista typów plików w oknie Zapisz jako zawiera też formaty eksportu (PDF, obrazy, inne formaty dokumentów). Wybranie jednego z nich zapisuje tylko kopię; otwarty dokument i jego karta pozostają przy pliku oryginalnym. Obrazy wielu stron są dzielone na `nazwa-01.png`, `nazwa-02.png`, ….
- **Docs**: lista Zapisz jako oferuje też .hwp i .hwpx (Plik ▸ Eksportuj jako dokument HWP… działa tak samo). Jeśli czegoś nie da się przenieść, np. komentarzy, równań czy pól tekstowych, dowiesz się o tym przed zapisaniem pliku.
- **Zapisz jako…** zapisuje nowy plik i pozostawia oryginał nietknięty; późniejsze edycje dotyczą nowego pliku.
- Każdy zapis jest atomowy (plik tymczasowy + zmiana nazwy); zamknięcie w trakcie zapisu nie może uszkodzić pliku.
- Autozapis działa zgodnie z przełącznikiem w każdym edytorze; nowy dokument bez własnego pliku zaczyna działać po pierwszym zapisie (patrz [Szybki start](help://getting-started)).

## Eksport do PDF

- **Docs**: Plik ▸ Eksportuj jako PDF… (lub przycisk na wstążce), z podziałem na strony zgodnym z układem.
- **Slides**: eksport rasteryzuje stronę po stronie, z paskiem postępu przy dużych prezentacjach.
- **Sheets**: eksport stosuje podział na strony używany przy drukowaniu.
- Eksporty są renderowane w ukrytym oknie i trafiają tam, gdzie wskażesz.

## Eksport do Worda i obrazów

- **Eksportuj jako Word…** w PDF: zamienia PDF w plik .docx (konwersja lokalna; złożone układy odtwarzane są w miarę możliwości).
- **Docs** może eksportować strony jako obrazy (PNG na stronę).

## Drukowanie

Plik ▸ Drukuj (⌘P/ctrl+P) otwiera okno drukowania z podglądem na żywo w każdym edytorze — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram i Whiteboard. Bez zmian w układzie strony i przy użyciu okna systemowego drukowanie działa jak dotychczas.

- **Miejsce docelowe (drukarka, PDF, obrazy)**: wybierz z jednej listy zainstalowaną drukarkę, **Zapisz jako PDF**, **Zapisz jako obrazy** lub **Systemowe okno drukowania**. Zapis obrazów obsługuje PNG i JPG (Wysoka 90%, Średnia 80%, Mniejszy plik 65%) jako osobne numerowane pliki lub pojedyncze archiwum ZIP. W chronionych PDF-ach zapis do PDF i obrazów jest zablokowany, a drukowanie pozostaje dostępne.
- **Podgląd wydruku na żywo**: wszystkie dziesięć edytorów pokazuje podgląd przed wyjściem. Gdy układ, skala szarości, znak wodny lub nagłówki/stopki zmieniają wynikowe strony, podgląd renderuje je na żądanie z nawigacją, powiększeniem i przełącznikiem schematu.
- **Układ**: Jedna strona na arkusz, Wiele stron na arkusz (2, 4, 6, 9 lub 16, z opcjonalnymi obramowaniami), Broszura (oprawa z lewej lub prawej), Plakat (kolumny × wiersze, zakładka, linie cięcia i etykiety kafelków) lub Etykiety (jedna strona na etykietę albo powtórzenie, komórka startowa, szablony A4 lub własne wymiary).
- **Skala, orientacja, strony i kolejność**: wybierz Rozmiar rzeczywisty (100%), Dopasuj do papieru, Zmniejsz zbyt duże strony lub Skalę niestandardową (10%–400%) oraz orientację Automatyczną, Pionową albo Poziomą. Tylko nieparzyste, parzyste i odwrotna kolejność liczą gotowe strony arkuszy.
- **Znak wodny, nagłówki/stopki, skala szarości i rozdzielczość**: dodawaj tekstowy lub obrazkowy znak wodny oraz 6 pól nagłówka i stopki (tytuł, data, numer strony lub własny tekst) tylko na wydruku, bez zmiany dokumentu. Skala szarości i DPI (Automatyczna, 150, 300 lub 600 dpi) określają jakość rastra.
- **Zakresy stron i zaznaczenie**: Docs i Markdown łamią zaznaczony tekst od strony 1; Slides drukuje wybrane slajdy; PDF wybrane strony; Hangul obsługuje Wszystkie, Bieżącą stronę lub Zakres niestandardowy; Sheets drukuje aktywne arkusze, skoroszyt lub zaznaczenie.
- **Systemowe okno drukowania**: dla broszury włącz druk dwustronny z przewracaniem wzdłuż krótkiej krawędzi i nie zmieniaj zakresu ani liczby stron na arkusz w oknie systemu.

Pliki PDF są drukowane w bieżącej kolejności i orientacji stron.

## Gdzie trafiają pliki bez tytułu

Lokalizacja wybrana przy pierwszym zapisaniu jest ich domem. Do tego czasu dokument nie ma własnego pliku: jego niezapisana zawartość istnieje tylko jako kopia odzyskiwania w folderze danych aplikacji, dzięki czemu można ją odzyskać, gdy aplikacja nagle się wyłączy (zobacz [Karty i zarządzanie oknami](help://tabs-and-windows)). Autozapis przejmuje nad nim kontrolę dopiero po tym pierwszym zapisaniu.
