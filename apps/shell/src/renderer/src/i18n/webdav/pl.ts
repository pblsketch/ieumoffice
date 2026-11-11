import type { zh } from './zh'

export const pl = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Połącz serwer WebDAV (np. Nextcloud lub NAS Synology), aby otwierać jego pliki tutaj. Po zapisaniu zmiany wracają na serwer.',
  webdavNoServers: 'Nie połączono jeszcze żadnych serwerów.',
  webdavAdd: 'Dodaj serwer',
  webdavFieldName: 'Nazwa',
  webdavFieldUrl: 'Adres serwera',
  webdavFieldUser: 'Nazwa użytkownika',
  webdavFieldPassword: 'Hasło lub hasło aplikacji',
  webdavUserHint: 'Zostaw nazwę użytkownika pustą, jeśli serwer nie wymaga logowania.',
  webdavInsecureWarn:
    'To niezaszyfrowane połączenie HTTP. Hasło i pliki przechodzą przez sieć w postaci czytelnej.',
  webdavInsecureConfirm: 'Rozumiem ryzyko i chcę użyć HTTP',
  webdavSave: 'Połącz',
  webdavCancel: 'Anuluj',
  webdavChecking: 'Sprawdzanie połączenia…',
  webdavRemove: 'Usuń serwer',
  webdavRemoveConfirm:
    'Usunąć z tego komputera połączenie z tym serwerem? Pliki na serwerze nie zostaną usunięte.',
  webdavRemoveYes: 'Usuń',
  webdavNeedPassword:
    'Ten komputer nie mógł zachować hasła w postaci zaszyfrowanej. Wpisz je ponownie.',
  webdavNotPersisted:
    'Ten komputer nie może zachować hasła w postaci zaszyfrowanej, więc po zamknięciu aplikacji trzeba je wpisać ponownie.',
  webdavPrivacy:
    'Hasło zostaje tylko na tym komputerze, zaszyfrowane przez system. Pliki przesyłane są wyłącznie między tym komputerem a podanym serwerem, gdy je otwierasz lub zapisujesz.',
  webdavEmptyTitle: 'Brak połączonego serwera WebDAV',
  webdavEmptyBody:
    'Dodaj serwer w Ustawienia → Integracje, a potem przeglądaj i otwieraj jego pliki tutaj.',
  webdavOpenSettings: 'Otwórz ustawienia',
  webdavRoot: 'Katalog główny',
  webdavFolderEmpty: 'Ten folder jest pusty.',
  webdavLoading: 'Ładowanie…',
  webdavRefresh: 'Odśwież',
  webdavUnsupported: 'Aplikacja nie może otworzyć tego formatu',
  webdavOpening: 'Otwieranie…',
  webdavServer: 'Serwer',
  webdavErrUrl: 'Nieprawidłowy adres. Wpisz pełny adres zaczynający się od https:// lub http://.',
  webdavErrInsecure: 'Zaznacz potwierdzenie, zanim użyjesz niezaszyfrowanego połączenia HTTP.',
  webdavErrAuth:
    'Serwer odrzucił logowanie. Sprawdź nazwę użytkownika i hasło (wiele usług wymaga hasła aplikacji).',
  webdavErrNotFound: 'Tego folderu lub pliku nie ma na serwerze.',
  webdavErrForbidden: 'To konto nie ma uprawnień do tej czynności.',
  webdavErrNetwork: 'Nie można połączyć się z serwerem. Sprawdź adres i sieć.',
  webdavErrLimit: 'Można połączyć maksymalnie 10 serwerów.',
  webdavErrTooLarge: 'Plik jest zbyt duży, aby go otworzyć.',
  webdavErrRateLimit: 'Serwer prosi o ponowną próbę później.',
  webdavErrLocked: 'Ktoś inny zablokował ten plik.',
  webdavErrDisk: 'Nie udało się zapisać pliku na tym komputerze.',
} satisfies Record<keyof typeof zh, string>
