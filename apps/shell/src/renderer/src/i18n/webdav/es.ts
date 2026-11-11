import type { zh } from './zh'

export const es = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Conecta un servidor WebDAV (como Nextcloud o un NAS Synology) para abrir sus archivos aquí. Al guardar, los cambios vuelven al servidor.',
  webdavNoServers: 'Aún no hay servidores conectados.',
  webdavAdd: 'Añadir un servidor',
  webdavFieldName: 'Nombre',
  webdavFieldUrl: 'Dirección del servidor',
  webdavFieldUser: 'Nombre de usuario',
  webdavFieldPassword: 'Contraseña o contraseña de aplicación',
  webdavUserHint: 'Deja el usuario vacío si el servidor no pide iniciar sesión.',
  webdavInsecureWarn:
    'Es una conexión HTTP sin cifrar. La contraseña y los archivos viajan legibles por la red.',
  webdavInsecureConfirm: 'Entiendo el riesgo y quiero usar HTTP',
  webdavSave: 'Conectar',
  webdavCancel: 'Cancelar',
  webdavChecking: 'Comprobando la conexión…',
  webdavRemove: 'Quitar servidor',
  webdavRemoveConfirm:
    '¿Quitar la conexión con este servidor de este PC? Los archivos del servidor no se borran.',
  webdavRemoveYes: 'Quitar',
  webdavNeedPassword: 'Este PC no pudo guardar la contraseña cifrada. Vuelve a introducirla.',
  webdavNotPersisted:
    'Este PC no puede guardar la contraseña cifrada, así que tendrás que introducirla de nuevo al cerrar la aplicación.',
  webdavPrivacy:
    'La contraseña se queda en este PC, cifrada por el sistema. Los archivos solo viajan entre este PC y el servidor que indicaste, al abrirlos o guardarlos.',
  webdavEmptyTitle: 'No hay ningún servidor WebDAV conectado',
  webdavEmptyBody:
    'Añade un servidor en Ajustes → Integraciones y luego explora y abre sus archivos aquí.',
  webdavOpenSettings: 'Abrir Ajustes',
  webdavRoot: 'Raíz',
  webdavFolderEmpty: 'Esta carpeta está vacía.',
  webdavLoading: 'Cargando…',
  webdavRefresh: 'Actualizar',
  webdavUnsupported: 'La aplicación no puede abrir este formato',
  webdavOpening: 'Abriendo…',
  webdavServer: 'Servidor',
  webdavErrUrl:
    'Esa dirección no es válida. Escribe la dirección completa, empezando por https:// o http://.',
  webdavErrInsecure: 'Marca la confirmación antes de usar una conexión HTTP sin cifrar.',
  webdavErrAuth:
    'El servidor rechazó el inicio de sesión. Revisa el usuario y la contraseña (muchos servicios piden una contraseña de aplicación).',
  webdavErrNotFound: 'Esa carpeta o ese archivo no está en el servidor.',
  webdavErrForbidden: 'Esta cuenta no tiene permiso para hacer eso.',
  webdavErrNetwork: 'No se puede acceder al servidor. Revisa la dirección y tu red.',
  webdavErrLimit: 'Puedes conectar hasta 10 servidores.',
  webdavErrTooLarge: 'El archivo es demasiado grande para abrirlo.',
  webdavErrRateLimit: 'El servidor pide que lo intentes más tarde.',
  webdavErrLocked: 'Otra persona ha bloqueado el archivo.',
  webdavErrDisk: 'No se pudo guardar el archivo en este PC.',
} satisfies Record<keyof typeof zh, string>
