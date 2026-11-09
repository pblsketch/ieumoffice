import type { zh } from './zh'

export const nl = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Koppel een WebDAV-server (zoals Nextcloud of een Synology NAS) om de bestanden hier te openen. Bij opslaan gaan de wijzigingen terug naar de server.',
  webdavNoServers: 'Nog geen servers gekoppeld.',
  webdavAdd: 'Server toevoegen',
  webdavFieldName: 'Naam',
  webdavFieldUrl: 'Serveradres',
  webdavFieldUser: 'Gebruikersnaam',
  webdavFieldPassword: 'Wachtwoord of app-wachtwoord',
  webdavUserHint: 'Laat de gebruikersnaam leeg als de server geen aanmelding vraagt.',
  webdavInsecureWarn:
    'Dit is een onversleutelde HTTP-verbinding. Het wachtwoord en de bestanden gaan leesbaar over het netwerk.',
  webdavInsecureConfirm: 'Ik begrijp het risico en wil HTTP gebruiken',
  webdavSave: 'Verbinden',
  webdavCancel: 'Annuleren',
  webdavChecking: 'Verbinding controleren…',
  webdavRemove: 'Server verwijderen',
  webdavRemoveConfirm:
    'De koppeling met deze server van deze pc verwijderen? De bestanden op de server worden niet verwijderd.',
  webdavRemoveYes: 'Verwijderen',
  webdavNeedPassword: 'Deze pc kon het wachtwoord niet versleuteld bewaren. Voer het opnieuw in.',
  webdavNotPersisted:
    'Deze pc kan het wachtwoord niet versleuteld bewaren, dus u voert het opnieuw in nadat de app is gesloten.',
  webdavPrivacy:
    'Het wachtwoord blijft op deze pc, versleuteld door het systeem. Bestanden gaan alleen tussen deze pc en de opgegeven server wanneer u ze opent of opslaat.',
  webdavEmptyTitle: 'Geen WebDAV-server gekoppeld',
  webdavEmptyBody:
    'Voeg een server toe via Instellingen → Integraties en blader en open de bestanden daarna hier.',
  webdavOpenSettings: 'Instellingen openen',
  webdavRoot: 'Hoofdmap',
  webdavFolderEmpty: 'Deze map is leeg.',
  webdavLoading: 'Laden…',
  webdavRefresh: 'Vernieuwen',
  webdavUnsupported: 'De app kan dit formaat niet openen',
  webdavOpening: 'Openen…',
  webdavServer: 'Server',
  webdavErrUrl:
    'Dit adres is ongeldig. Voer het volledige adres in dat begint met https:// of http://.',
  webdavErrInsecure:
    'Vink de bevestiging aan voordat u een onversleutelde HTTP-verbinding gebruikt.',
  webdavErrAuth:
    'De server weigerde de aanmelding. Controleer de gebruikersnaam en het wachtwoord (veel diensten vragen een app-wachtwoord).',
  webdavErrNotFound: 'Die map of dat bestand staat niet op de server.',
  webdavErrForbidden: 'Dit account mag dat niet doen.',
  webdavErrNetwork: 'De server is niet bereikbaar. Controleer het adres en uw netwerk.',
  webdavErrLimit: 'U kunt maximaal 10 servers koppelen.',
  webdavErrTooLarge: 'Het bestand is te groot om te openen.',
  webdavErrRateLimit: 'De server vraagt het later opnieuw te proberen.',
  webdavErrLocked: 'Iemand anders heeft het bestand vergrendeld.',
  webdavErrDisk: 'Het bestand kon niet op deze pc worden opgeslagen.',
} satisfies Record<keyof typeof zh, string>
