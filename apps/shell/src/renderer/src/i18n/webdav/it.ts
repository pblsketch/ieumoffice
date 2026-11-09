import type { zh } from './zh'

export const it = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Collega un server WebDAV (come Nextcloud o un NAS Synology) per aprire qui i suoi file. Salvando, le modifiche tornano al server.',
  webdavNoServers: 'Nessun server collegato per ora.',
  webdavAdd: 'Aggiungi un server',
  webdavFieldName: 'Nome',
  webdavFieldUrl: 'Indirizzo del server',
  webdavFieldUser: 'Nome utente',
  webdavFieldPassword: 'Password o password per le app',
  webdavUserHint: 'Lascia vuoto il nome utente se il server non richiede l’accesso.',
  webdavInsecureWarn:
    'Questa è una connessione HTTP non cifrata. Password e file viaggiano in chiaro sulla rete.',
  webdavInsecureConfirm: 'Ho capito il rischio e voglio usare HTTP',
  webdavSave: 'Collega',
  webdavCancel: 'Annulla',
  webdavChecking: 'Verifica della connessione…',
  webdavRemove: 'Rimuovi server',
  webdavRemoveConfirm:
    'Rimuovere da questo PC la connessione a questo server? I file sul server non vengono eliminati.',
  webdavRemoveYes: 'Rimuovi',
  webdavNeedPassword:
    'Questo PC non è riuscito a conservare la password cifrata. Inseriscila di nuovo.',
  webdavNotPersisted:
    'Questo PC non può conservare la password cifrata, quindi la inserirai di nuovo dopo la chiusura dell’app.',
  webdavPrivacy:
    'La password resta su questo PC, cifrata dal sistema. I file viaggiano solo tra questo PC e il server indicato, quando li apri o li salvi.',
  webdavEmptyTitle: 'Nessun server WebDAV collegato',
  webdavEmptyBody:
    'Aggiungi un server in Impostazioni → Integrazioni, poi sfoglia e apri qui i suoi file.',
  webdavOpenSettings: 'Apri Impostazioni',
  webdavRoot: 'Radice',
  webdavFolderEmpty: 'Questa cartella è vuota.',
  webdavLoading: 'Caricamento…',
  webdavRefresh: 'Aggiorna',
  webdavUnsupported: 'L’app non può aprire questo formato',
  webdavOpening: 'Apertura…',
  webdavServer: 'Server',
  webdavErrUrl:
    'Indirizzo non valido. Inserisci l’indirizzo completo che inizia con https:// o http://.',
  webdavErrInsecure: 'Spunta la conferma prima di usare una connessione HTTP non cifrata.',
  webdavErrAuth:
    'Il server ha rifiutato l’accesso. Controlla nome utente e password (molti servizi richiedono una password per le app).',
  webdavErrNotFound: 'Quella cartella o quel file non è sul server.',
  webdavErrForbidden: 'Questo account non può farlo.',
  webdavErrNetwork: 'Impossibile raggiungere il server. Controlla l’indirizzo e la rete.',
  webdavErrLimit: 'Puoi collegare fino a 10 server.',
  webdavErrTooLarge: 'Il file è troppo grande per essere aperto.',
  webdavErrRateLimit: 'Il server chiede di riprovare più tardi.',
  webdavErrLocked: 'Un’altra persona ha bloccato il file.',
  webdavErrDisk: 'Impossibile salvare il file su questo PC.',
} satisfies Record<keyof typeof zh, string>
