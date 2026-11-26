# Hangul (HWP / HWPX): edycja, panel roboczy i drukowanie

GenOffice otwiera i edytuje dokumenty Hangul `.hwp` oraz `.hwpx` na karcie, zachowując skróty Hancom Hangul 2024, style, tabele, notatki, drukowanie oraz panel AI. Wszystko działa lokalnie na Twoim komputerze.

## Otwieranie, zapisywanie i drukowanie

- Otwiera pliki `.hwp` i `.hwpx` ze strony głównej, przez **Plik > Otwórz**, przeciągnięcie do okna lub z Dysku Google; konwertuje pliki PDF na nowe karty Hangul przez **Plik > Importuj PDF**.
- Zapisuje z powrotem w formacie otwartego pliku (`.hwp` pozostaje `.hwp`, `.hwpx` pozostaje `.hwpx`), tworzy kopię zapasową `.bak` przed pierwszym nadpisaniem, sprawdza ponowny odczyt HWP oraz utrzymuje autozapis i kopie odzyskiwania po awarii.
- Drukowanie (Ctrl+P) obsługuje podgląd na żywo, eksport do PDF oraz wielostronicowe opcje układu wydruku.

## Lewy panel roboczy: Konspekt i Znajdź

- Otwórz lewy panel roboczy przyciskiem na górnym pasku, przez **Widok > Panel roboczy** (Konspekt / Znajdź) lub naciśnij **Ctrl+F**, aby przejść od razu do karty Znajdź. Tradycyjne wyszukiwanie (**Ctrl+Q,F**) oraz Znajdź i zamień (**Ctrl+H**) pozostają dostępne.
- **Karta Konspekt**: wyświetla natywne nagłówki konspektu Hangul oraz nagłówki mapowane według stylów (domyślnie `제목 N` / `Heading N`, z możliwością dostosowania dla dokumentu lub całej aplikacji w panelu ustawień konspektu). Filtruj według poziomu (`1`, `2`, `3`, ... Wszystkie), zwijaj gałęzie, klikaj, aby przeskoczyć, podnoś lub obniżaj poziom nagłówków (domyślnie wraz z podnagłówkami lub z przytrzymanym **Shift** dla pojedynczego nagłówka) oraz przeciągaj nagłówki, aby zmienić kolejność całych sekcji w jednym kroku cofania.
- **Karta Znajdź**: przeszukuje treść główną, tabele (w tym zagnieżdżone), pola tekstowe, przypisy dolne i końcowe (z wyłączeniem nagłówków i stopek) z filtrami wielkości liter, całych słów, wyrażeń regularnych, stylu akapitu i formatowania znaków. Kliknij wynik, aby przejść do niego i zaznaczyć, albo zamień jedno, zaznaczone lub wszystkie wystąpienia w jednym kroku cofania (z pominięciem obiektów w tekście i znaczników cytowań oraz podaniem ich liczby).
- Panel roboczy zapamiętuje stan otwarcia, aktywną kartę i szerokość, zwija się do paska ikon w wąskich oknach i ukrywa się w trybie prezentacji oraz podglądzie wydruku. Wszystkie funkcje panelu działają bez AI.

## Notatki, skróty i panel AI

- Otwórz kolumnę notatek z górnego paska lub przez **Wstaw > Notatka**, aby czytać, dodawać, edytować i usuwać notatki tekstowe obok dokumentu.
- Obsługuje skróty klawiszowe Hancom Hangul 2024, znaczniki akapitu na poziomej linijce, Kopiowanie formatu (**Alt+C**), konwersję Hanja (**F9** / klawisz Hanja) oraz Informacje o dokumencie (**Ctrl+Q,I**).
- Opcjonalny panel AI i [polecenia terminala](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) mogą odczytywać i edytować tekst, style, tabele, równania, układ strony, konspekt oraz wyniki wyszukiwania; każda zmiana AI stanowi jeden krok cofania.
