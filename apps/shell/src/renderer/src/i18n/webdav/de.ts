import type { zh } from './zh'

export const de = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Verbinden Sie einen WebDAV-Server (z. B. Nextcloud oder Synology NAS), um dessen Dateien hier zu öffnen. Beim Speichern gehen die Änderungen zurück an den Server.',
  webdavNoServers: 'Noch keine Server verbunden.',
  webdavAdd: 'Server hinzufügen',
  webdavFieldName: 'Name',
  webdavFieldUrl: 'Serveradresse',
  webdavFieldUser: 'Benutzername',
  webdavFieldPassword: 'Passwort oder App-Passwort',
  webdavUserHint: 'Lassen Sie den Benutzernamen leer, wenn der Server keine Anmeldung verlangt.',
  webdavInsecureWarn:
    'Dies ist eine unverschlüsselte HTTP-Verbindung. Passwort und Dateien laufen lesbar durch das Netz.',
  webdavInsecureConfirm: 'Ich kenne das Risiko und möchte HTTP verwenden',
  webdavSave: 'Verbinden',
  webdavCancel: 'Abbrechen',
  webdavChecking: 'Verbindung wird geprüft …',
  webdavRemove: 'Server entfernen',
  webdavRemoveConfirm:
    'Die Verbindung zu diesem Server von diesem PC entfernen? Die Dateien auf dem Server werden nicht gelöscht.',
  webdavRemoveYes: 'Entfernen',
  webdavNeedPassword:
    'Dieser PC konnte das Passwort nicht verschlüsselt speichern. Bitte erneut eingeben.',
  webdavNotPersisted:
    'Dieser PC kann das Passwort nicht verschlüsselt speichern. Nach dem Schließen der App geben Sie es erneut ein.',
  webdavPrivacy:
    'Das Passwort bleibt auf diesem PC, vom System verschlüsselt. Dateien gehen nur beim Öffnen oder Speichern zwischen diesem PC und dem eingegebenen Server hin und her.',
  webdavEmptyTitle: 'Kein WebDAV-Server verbunden',
  webdavEmptyBody:
    'Fügen Sie unter Einstellungen → Integrationen einen Server hinzu und durchsuchen und öffnen Sie dann hier seine Dateien.',
  webdavOpenSettings: 'Einstellungen öffnen',
  webdavRoot: 'Stammordner',
  webdavFolderEmpty: 'Dieser Ordner ist leer.',
  webdavLoading: 'Wird geladen …',
  webdavRefresh: 'Aktualisieren',
  webdavUnsupported: 'Die App kann dieses Format nicht öffnen',
  webdavOpening: 'Wird geöffnet …',
  webdavServer: 'Server',
  webdavErrUrl:
    'Diese Adresse ist ungültig. Geben Sie die vollständige Adresse mit https:// oder http:// am Anfang ein.',
  webdavErrInsecure:
    'Setzen Sie das Bestätigungshäkchen, bevor Sie eine unverschlüsselte HTTP-Verbindung nutzen.',
  webdavErrAuth:
    'Der Server hat die Anmeldung abgelehnt. Prüfen Sie Benutzernamen und Passwort (viele Dienste verlangen ein App-Passwort).',
  webdavErrNotFound: 'Dieser Ordner oder diese Datei ist nicht auf dem Server.',
  webdavErrForbidden: 'Dieses Konto darf das nicht tun.',
  webdavErrNetwork: 'Der Server ist nicht erreichbar. Prüfen Sie Adresse und Netzwerk.',
  webdavErrLimit: 'Sie können bis zu 10 Server verbinden.',
  webdavErrTooLarge: 'Die Datei ist zu groß zum Öffnen.',
  webdavErrRateLimit: 'Der Server bittet, es später erneut zu versuchen.',
  webdavErrLocked: 'Jemand anderes hat die Datei gesperrt.',
  webdavErrDisk: 'Die Datei konnte nicht auf diesem PC gespeichert werden.',
} satisfies Record<keyof typeof zh, string>
