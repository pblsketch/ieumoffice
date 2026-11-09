import type { zh } from './zh'

export const ru = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Подключите сервер WebDAV (например, Nextcloud или NAS Synology), чтобы открывать его файлы здесь. При сохранении изменения возвращаются на сервер.',
  webdavNoServers: 'Серверы пока не подключены.',
  webdavAdd: 'Добавить сервер',
  webdavFieldName: 'Название',
  webdavFieldUrl: 'Адрес сервера',
  webdavFieldUser: 'Имя пользователя',
  webdavFieldPassword: 'Пароль или пароль приложения',
  webdavUserHint: 'Оставьте имя пользователя пустым, если серверу не нужен вход.',
  webdavInsecureWarn:
    'Это незашифрованное соединение HTTP. Пароль и файлы идут по сети в открытом виде.',
  webdavInsecureConfirm: 'Я понимаю риск и хочу использовать HTTP',
  webdavSave: 'Подключить',
  webdavCancel: 'Отмена',
  webdavChecking: 'Проверка соединения…',
  webdavRemove: 'Удалить сервер',
  webdavRemoveConfirm:
    'Удалить подключение к этому серверу с этого ПК? Файлы на сервере не удаляются.',
  webdavRemoveYes: 'Удалить',
  webdavNeedPassword: 'Этот ПК не смог сохранить пароль в зашифрованном виде. Введите его снова.',
  webdavNotPersisted:
    'Этот ПК не может хранить пароль в зашифрованном виде, поэтому после закрытия приложения его придётся ввести снова.',
  webdavPrivacy:
    'Пароль хранится только на этом ПК и шифруется системой. Файлы передаются только между этим ПК и указанным вами сервером, когда вы открываете или сохраняете их.',
  webdavEmptyTitle: 'Нет подключённого сервера WebDAV',
  webdavEmptyBody:
    'Добавьте сервер в Настройки → Интеграции, затем просматривайте и открывайте его файлы здесь.',
  webdavOpenSettings: 'Открыть настройки',
  webdavRoot: 'Корень',
  webdavFolderEmpty: 'Эта папка пуста.',
  webdavLoading: 'Загрузка…',
  webdavRefresh: 'Обновить',
  webdavUnsupported: 'Приложение не может открыть этот формат',
  webdavOpening: 'Открывается…',
  webdavServer: 'Сервер',
  webdavErrUrl: 'Неверный адрес. Введите полный адрес, начинающийся с https:// или http://.',
  webdavErrInsecure:
    'Отметьте подтверждение, прежде чем использовать незашифрованное соединение HTTP.',
  webdavErrAuth:
    'Сервер отклонил вход. Проверьте имя пользователя и пароль (многим сервисам нужен пароль приложения).',
  webdavErrNotFound: 'Такой папки или файла нет на сервере.',
  webdavErrForbidden: 'У этой учётной записи нет прав на это действие.',
  webdavErrNetwork: 'Не удаётся связаться с сервером. Проверьте адрес и сеть.',
  webdavErrLimit: 'Можно подключить не более 10 серверов.',
  webdavErrTooLarge: 'Файл слишком большой, чтобы его открыть.',
  webdavErrRateLimit: 'Сервер просит повторить позже.',
  webdavErrLocked: 'Файл заблокирован другим пользователем.',
  webdavErrDisk: 'Не удалось сохранить файл на этом ПК.',
} satisfies Record<keyof typeof zh, string>
