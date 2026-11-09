import type { zh } from './zh'

export const en = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Connect a WebDAV server (such as Nextcloud or a Synology NAS) to open its files here. Saving sends the changes back to the server.',
  webdavNoServers: 'No servers connected yet.',
  webdavAdd: 'Add a server',
  webdavFieldName: 'Name',
  webdavFieldUrl: 'Server address',
  webdavFieldUser: 'User name',
  webdavFieldPassword: 'Password or app password',
  webdavUserHint: 'Leave the user name empty if the server needs no sign-in.',
  webdavInsecureWarn:
    'This is a plain HTTP connection. The password and the files cross the network readable.',
  webdavInsecureConfirm: 'I understand the risk and want to use HTTP',
  webdavSave: 'Connect',
  webdavCancel: 'Cancel',
  webdavChecking: 'Checking the connection…',
  webdavRemove: 'Remove server',
  webdavRemoveConfirm:
    'Remove this server’s connection from this PC? The files on the server are not deleted.',
  webdavRemoveYes: 'Remove',
  webdavNeedPassword: 'This PC could not keep the password encrypted. Enter it again.',
  webdavNotPersisted:
    'This PC can’t keep the password encrypted, so you will enter it again after the app closes.',
  webdavPrivacy:
    'The password stays on this PC, encrypted by the system. Files travel only between this PC and the server you entered, when you open or save them.',
  webdavEmptyTitle: 'No WebDAV server connected',
  webdavEmptyBody: 'Add a server in Settings → Integrations, then browse and open its files here.',
  webdavOpenSettings: 'Open Settings',
  webdavRoot: 'Root',
  webdavFolderEmpty: 'This folder is empty.',
  webdavLoading: 'Loading…',
  webdavRefresh: 'Refresh',
  webdavUnsupported: 'The app can’t open this format',
  webdavOpening: 'Opening…',
  webdavServer: 'Server',
  webdavErrUrl:
    'That address is not valid. Enter the full address starting with https:// or http://.',
  webdavErrInsecure: 'Tick the confirmation before using a plain HTTP connection.',
  webdavErrAuth:
    'The server refused the sign-in. Check the user name and password (many services need an app password).',
  webdavErrNotFound: 'That folder or file isn’t on the server.',
  webdavErrForbidden: 'This account isn’t allowed to do that.',
  webdavErrNetwork: 'Can’t reach the server. Check the address and your network.',
  webdavErrLimit: 'You can connect up to 10 servers.',
  webdavErrTooLarge: 'The file is too large to open.',
  webdavErrRateLimit: 'The server asked to try again later.',
  webdavErrLocked: 'Someone else has locked the file.',
  webdavErrDisk: 'The file could not be saved to this PC.',
} satisfies Record<keyof typeof zh, string>
