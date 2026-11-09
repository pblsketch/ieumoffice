import type { zh } from './zh'

export const fr = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Connectez un serveur WebDAV (Nextcloud, NAS Synology…) pour ouvrir ses fichiers ici. Enregistrer renvoie les modifications au serveur.',
  webdavNoServers: 'Aucun serveur connecté pour le moment.',
  webdavAdd: 'Ajouter un serveur',
  webdavFieldName: 'Nom',
  webdavFieldUrl: 'Adresse du serveur',
  webdavFieldUser: "Nom d'utilisateur",
  webdavFieldPassword: "Mot de passe ou mot de passe d'application",
  webdavUserHint: "Laissez le nom d'utilisateur vide si le serveur n'exige pas de connexion.",
  webdavInsecureWarn:
    'Connexion HTTP non chiffrée. Le mot de passe et les fichiers circulent en clair sur le réseau.',
  webdavInsecureConfirm: 'Je comprends le risque et je veux utiliser HTTP',
  webdavSave: 'Connecter',
  webdavCancel: 'Annuler',
  webdavChecking: 'Vérification de la connexion…',
  webdavRemove: 'Supprimer le serveur',
  webdavRemoveConfirm:
    'Supprimer la connexion à ce serveur de ce PC ? Les fichiers du serveur ne sont pas supprimés.',
  webdavRemoveYes: 'Supprimer',
  webdavNeedPassword:
    "Ce PC n'a pas pu conserver le mot de passe chiffré. Saisissez-le de nouveau.",
  webdavNotPersisted:
    "Ce PC ne peut pas conserver le mot de passe chiffré : vous le saisirez de nouveau après la fermeture de l'application.",
  webdavPrivacy:
    "Le mot de passe reste sur ce PC, chiffré par le système. Les fichiers ne circulent qu'entre ce PC et le serveur saisi, quand vous les ouvrez ou les enregistrez.",
  webdavEmptyTitle: 'Aucun serveur WebDAV connecté',
  webdavEmptyBody:
    'Ajoutez un serveur dans Paramètres → Intégrations, puis parcourez et ouvrez ses fichiers ici.',
  webdavOpenSettings: 'Ouvrir les paramètres',
  webdavRoot: 'Racine',
  webdavFolderEmpty: 'Ce dossier est vide.',
  webdavLoading: 'Chargement…',
  webdavRefresh: 'Actualiser',
  webdavUnsupported: "L'application ne peut pas ouvrir ce format",
  webdavOpening: 'Ouverture…',
  webdavServer: 'Serveur',
  webdavErrUrl:
    "Adresse invalide. Saisissez l'adresse complète commençant par https:// ou http://.",
  webdavErrInsecure: 'Cochez la confirmation avant d’utiliser une connexion HTTP non chiffrée.',
  webdavErrAuth:
    "Le serveur a refusé la connexion. Vérifiez le nom d'utilisateur et le mot de passe (beaucoup de services exigent un mot de passe d'application).",
  webdavErrNotFound: "Ce dossier ou ce fichier n'est pas sur le serveur.",
  webdavErrForbidden: "Ce compte n'est pas autorisé à faire cela.",
  webdavErrNetwork: "Impossible de joindre le serveur. Vérifiez l'adresse et votre réseau.",
  webdavErrLimit: "Vous pouvez connecter jusqu'à 10 serveurs.",
  webdavErrTooLarge: 'Le fichier est trop volumineux pour être ouvert.',
  webdavErrRateLimit: 'Le serveur demande de réessayer plus tard.',
  webdavErrLocked: "Quelqu'un d'autre a verrouillé le fichier.",
  webdavErrDisk: "Le fichier n'a pas pu être enregistré sur ce PC.",
} satisfies Record<keyof typeof zh, string>
