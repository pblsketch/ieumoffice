import type { zh } from './zh'

export const cs = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Připojte server WebDAV (například Nextcloud nebo NAS Synology) a otevírejte jeho soubory zde. Po uložení se změny vrátí na server.',
  webdavNoServers: 'Zatím není připojen žádný server.',
  webdavAdd: 'Přidat server',
  webdavFieldName: 'Název',
  webdavFieldUrl: 'Adresa serveru',
  webdavFieldUser: 'Uživatelské jméno',
  webdavFieldPassword: 'Heslo nebo heslo aplikace',
  webdavUserHint: 'Pokud server přihlášení nevyžaduje, nechte uživatelské jméno prázdné.',
  webdavInsecureWarn:
    'Toto je nešifrované připojení HTTP. Heslo i soubory procházejí sítí v čitelné podobě.',
  webdavInsecureConfirm: 'Rozumím riziku a chci použít HTTP',
  webdavSave: 'Připojit',
  webdavCancel: 'Zrušit',
  webdavChecking: 'Ověřuje se připojení…',
  webdavRemove: 'Odebrat server',
  webdavRemoveConfirm:
    'Odebrat z tohoto počítače připojení k tomuto serveru? Soubory na serveru se nesmažou.',
  webdavRemoveYes: 'Odebrat',
  webdavNeedPassword: 'Tento počítač nemohl heslo uložit v zašifrované podobě. Zadejte ho znovu.',
  webdavNotPersisted:
    'Tento počítač neumí heslo uložit zašifrovaně, takže ho po zavření aplikace zadáte znovu.',
  webdavPrivacy:
    'Heslo zůstává jen v tomto počítači, zašifrované systémem. Soubory putují pouze mezi tímto počítačem a zadaným serverem, když je otevřete nebo uložíte.',
  webdavEmptyTitle: 'Není připojen žádný server WebDAV',
  webdavEmptyBody:
    'Přidejte server v Nastavení → Integrace a pak zde procházejte a otevírejte jeho soubory.',
  webdavOpenSettings: 'Otevřít nastavení',
  webdavRoot: 'Kořen',
  webdavFolderEmpty: 'Tato složka je prázdná.',
  webdavLoading: 'Načítání…',
  webdavRefresh: 'Obnovit',
  webdavUnsupported: 'Aplikace tento formát neotevře',
  webdavOpening: 'Otevírání…',
  webdavServer: 'Server',
  webdavErrUrl: 'Adresa není platná. Zadejte celou adresu začínající https:// nebo http://.',
  webdavErrInsecure: 'Před použitím nešifrovaného připojení HTTP zaškrtněte potvrzení.',
  webdavErrAuth:
    'Server odmítl přihlášení. Zkontrolujte uživatelské jméno a heslo (mnoho služeb vyžaduje heslo aplikace).',
  webdavErrNotFound: 'Tato složka nebo soubor na serveru není.',
  webdavErrForbidden: 'Tento účet to nesmí.',
  webdavErrNetwork: 'Server není dostupný. Zkontrolujte adresu a síť.',
  webdavErrLimit: 'Lze připojit nejvýše 10 serverů.',
  webdavErrTooLarge: 'Soubor je příliš velký na otevření.',
  webdavErrRateLimit: 'Server žádá, abyste to zkusili později.',
  webdavErrLocked: 'Soubor zamkl někdo jiný.',
  webdavErrDisk: 'Soubor se nepodařilo uložit do tohoto počítače.',
} satisfies Record<keyof typeof zh, string>
