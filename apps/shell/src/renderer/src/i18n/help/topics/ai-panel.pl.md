# Panel asystenta AI

Każdy edytor może przywołać panel AI: zaznacz coś, wydaj polecenie i obserwuj wynik przesyłany strumieniowo.

## Otwieranie i używanie

- Panel wymaga połączonego AI. Gdy żadne nie jest połączone, zamiast błędu pokazuje karty połączenia; zobacz [Połączenie z subskrypcją](help://subscription).
- Wejścia: **przycisk AI** na wstążce każdego edytora, **Zapytaj AI** w menu kontekstowych albo Zapytaj AI na pasku oznaczeń.
- Opisz zadanie zwykłymi słowami (przepisz to / zamień tę kolumnę na procenty / ułóż tę stronę od nowa...) i naciśnij Enter.
- Odpowiedzi są renderowane **strumieniowo**; gdy AI potrzebuje narzędzi (odczytać dokument, go zmienić), wykonuje je i kontynuuje aż do końca.
- **Zatrzymaj**: w każdej chwili przerywa bieżącą turę.
- **Kolejka**: gdy odpowiedź się generuje, Enter odkłada wiadomość do kolejki zamiast ją porzucać — pasek nad polem wprowadzania je liczy; rozwiń, aby edytować, usuwać, zmieniać kolejność, wstrzymać lub wyczyścić. Następna wiadomość wyśle się sama po zakończeniu tury; Esc nadal przerywa turę.

## Które AI odpowiada

- Lista modeli u dołu panelu pokazuje używane AI i pozwala wybrać inne: najpierw twoje subskrypcje, potem skonfigurowanych dostawców z kluczem.
- Gdy wykorzystasz 80% limitu subskrypcji lub więcej, w panelu pojawia się wiersz taki jak „Wykorzystano 85% · odnowienie o 15:00”.
- Jeśli żądanie zostanie zatrzymane — limit został wyczerpany albo logowanie wygasło — panel podaje przyczynę i sam nie przełącza się na inne AI. Gdy połączona jest twoja druga subskrypcja, proponuje ją przycisk **Kontynuuj z …**.

## Co potrafi

- **Docs**: przepisywanie/rozbudowa/tłumaczenie/streszczanie, wstawianie tabel i obrazów, zmiana formatowania; każda tura zaczyna się od migawki.
- **Sheets**: formuły, wypełnianie danych, przekształcenia wsadowe, formatowanie.
- **Slides**: generowanie całej prezentacji, korekta układu, przepisywanie tekstów.
- **PDF**: pytania i odpowiedzi oraz streszczenia na podstawie zaznaczonego tekstu lub stron.
- **Markdown / HTML**: przepisywanie, rozbudowa, tłumaczenie.
- **Strona główna ▸ Ask AI** odpowiada z plików oznaczonych gwiazdką i je cytuje — panel bazy wiedzy ma własną sekcję w rozdziale o stronie głównej, a panel AI w Docs ma tę samą umiejętność.

## Załączanie otwartych dokumentów

W panelu AI edytorów Docs, Sheets, Slides, Hangul, HTML i map myśli możesz załączyć jako materiał inne dokumenty otwarte w GenOffice albo otwierane niedawno. Załączony dokument jest traktowany dokładnie tak samo jak plik wybrany z komputera.

- **`@` w polu wpisywania**: wpisz `@` na początku pola albo po spacji, aby otworzyć listę dokumentów. Jeśli okno jest podzielone, najpierw pojawia się dokument z sąsiedniego panelu, potem pozostałe otwarte dokumenty i ostatnie; dokumentu, w którym pracujesz, na liście nie ma. Zawęź ją kilkoma literami nazwy (spacje są dozwolone) i wybierz klawiszem Enter lub kliknięciem: w polu pojawi się `@nazwa dokumentu`, a dokument zostanie załączony. **Znajdź więcej…** na samym dole otwiera opisane niżej okno wyboru dokumentów.
- **Załącz z dokumentów GenOffice**: ten przycisk obok przycisku załączania otwiera tę samą listę w oknie, w którym możesz zaznaczyć kilka dokumentów i załączyć je naraz.
- Dokumenty z niezapisanymi zmianami i nowe dokumenty, których nigdy nie zapisano, są wyszarzone i nie można ich wybrać. Zapisz je i wybierz ponownie — AI czyta zapisany plik.
- Gdy dwa dokumenty mają tę samą nazwę, ale leżą w różnych folderach, dodawana jest nazwa folderu bezpośrednio nadrzędnego, np. `@plan.docx(II semestr)`, i tę nazwę folderu dostaje też AI.
- Edytory PDF i Markdown nie mają jeszcze załączników, więc żaden z tych sposobów nie jest tam dostępny.

## Projekty

- Kliknij nazwę projektu po lewej, pod polem wpisywania, aby wybrać projekt (jeden folder na twoim komputerze). AI odpowiada wtedy, znając pliki, instrukcje i pamięć tego folderu, a rozmowa jest zapisywana w folderze, więc możesz ją kontynuować w innym edytorze. Zobacz [Projekty](help://projects).
- Gdy projekt jest wybrany, u góry panelu widać tytuł bieżącej rozmowy. Kliknij go, aby zobaczyć listę rozmów tego projektu i **Nowa rozmowa**.
- Lista `@` w polu wpisywania pokazuje „Pliki w tym projekcie” po otwartych dokumentach.
- Zapytanie z wybranym projektem wysyła do używanego AI również instrukcje (razem z `AGENTS.md` i `CLAUDE.md` z głównego poziomu folderu, które można wyłączyć na stronie projektu), pamięć i listę nazw plików tego projektu, krótki fragment każdego pliku, który AI znajdzie, przeszukując folder, oraz tekst każdego pliku, który AI przeczyta.

## Cofanie i bezpieczeństwo

- Panel w Docs prowadzi **listę wersji**: jedna migawka na turę, możesz cofnąć się do dowolnej, a samo cofnięcie da się jeszcze cofnąć przez Ctrl+Z. Miganek przetrwa ponowne otwarcie dokumentu.
- Zmiany AI przechodzą tę samą ścieżkę edycji co zmiany ręczne (można je cofnąć, wymagają zapisania) — nic nie omija potwierdzenia zapisania.

## Ukryj dane wrażliwe

- W edytorach Docs, Sheets, Slides, Hangul, Markdown i HTML możesz nie pokazywać AI części dokumentu: zaznacz ją, kliknij prawym przyciskiem ▸ **Ukryj dane wrażliwe** i nadaj jej etykietę. W tym miejscu AI czyta `{{etykieta}}`, niezależnie od tego, z którego AI korzystasz. (W Markdown pozycję włącza przełącznik przekreślonego oka na wstążce; w HTML znajduje się ona w panelu źródła; w Sheets kliknij prawym przyciskiem nagłówek kolumny, aby ukryć kolumnę poniżej wiersza nagłówka, albo zakres komórek, aby ukryć tylko ten zakres.)
- Plik zachowuje prawdziwy tekst — zapis, eksport i druk pozostają bez zmian, a oznaczenie zostaje po ponownym otwarciu. To samo polecenie menu wyłącza ukrycie. W Hangul każda ukryta część to komentarz o treści `[Ukryj dane wrażliwe] etykieta`, więc ten komentarz zobaczy też osoba, która otrzyma dokument, a tekstu, który ma już komentarz, nie da się ukryć. W Sheets oznaczeniem jest nazwa zdefiniowana `IeumHide_etykieta`, widoczna w Menedżerze nazw; AI widzi każdą ukrytą komórkę jako `{{etykieta-01}}` (ta sama wartość dostaje ten sam numer), a komórka, której formuła korzysta z ukrytych komórek, również zostaje ukryta.
- **Znajdź dane wrażliwe** w panelu AI pokazuje listę tego, co wygląda na imiona i nazwiska, numery telefonów, adresy e-mail, numery ewidencyjne osób, numery kont i kart, adresy itp. Wyszukiwanie odbywa się na tym komputerze wyłącznie według ustalonych wzorców tekstu — ani do szukania, ani do ukrywania nie używa się AI — i nic nie zostaje ukryte, dopóki nie wybierzesz **Ukryj**. Dzięki **Wyklucz** kandydat nie wróci już w tym dokumencie. Miejsca, które nie mogą przyjąć oznaczenia (nagłówek, notatki prelegenta, nazwa arkusza…), także są na liście, żeby można je było poprawić ręcznie.
- Gdy po raz pierwszy wysyłasz coś w karcie, a dokument lub załączniki tego zapytania wciąż zawierają takich kandydatów, panel pyta jeden raz: **Sprawdź** niczego nie wysyła i otwiera listę, **Wyślij mimo to** wysyła.
- HTML ukrywa treści elementów, wartości atrybutów i literały tekstowe w skryptach, a wyrenderowana strona nigdy się nie zmienia. Slides ukrywa też całe obrazy, wideo i audio, a slajd z ukrytą treścią nigdy nie jest wysyłany jako zrzut ekranu.
- Ukryte części pozostają ukryte, gdy plik zostanie załączony w innym edytorze, gdy pytasz o niego na stronie głównej, gdy czyta go polecenie `ieumoffice` i jego narzędzia MCP albo gdy jest czytany przez serwer MCP aplikacji. Przed konwersją do formatu, w którym nie ma miejsca na oznaczenie (ODT, CSV, …), aplikacja najpierw pyta. Ukrywanie nie obejmuje plików, które program w trybie agenta czyta prosto z dysku, a obrazy stron (`render`) pokazują tekst taki, jaki jest.

## Prywatność

- Polecenia i odpowiednia treść dokumentu trafiają do **AI, z którego korzystasz**: do Anthropic lub OpenAI z twojego własnego konta, gdy używasz subskrypcji, albo do dostawcy, którego klucz został wpisany. Gdy żadne AI nie jest połączone, nic nie jest wysyłane.
- To, czy treści wysyłane w ramach subskrypcji służą do trenowania AI, zależy od ustawień twojego konta w danej firmie.
- Pliki lokalne nie są nigdzie indziej przesyłane; klucze API są przechowywane w pliku ustawień aplikacji na tym komputerze i wysyłane wyłącznie w nagłówkach żądań.
