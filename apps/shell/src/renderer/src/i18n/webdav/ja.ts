import type { zh } from './zh'

export const ja = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'WebDAV サーバー（Nextcloud や Synology NAS など）を接続すると、サーバー上のファイルを開けます。保存すると変更がサーバーに戻ります。',
  webdavNoServers: '接続しているサーバーはまだありません。',
  webdavAdd: 'サーバーを追加',
  webdavFieldName: '名前',
  webdavFieldUrl: 'サーバーのアドレス',
  webdavFieldUser: 'ユーザー名',
  webdavFieldPassword: 'パスワードまたはアプリパスワード',
  webdavUserHint: 'サインインが不要なサーバーでは、ユーザー名を空にします。',
  webdavInsecureWarn:
    'これは暗号化されていない HTTP 接続です。パスワードとファイルが読める形でネットワークを通ります。',
  webdavInsecureConfirm: 'リスクを理解したうえで HTTP を使う',
  webdavSave: '接続',
  webdavCancel: 'キャンセル',
  webdavChecking: '接続を確認しています…',
  webdavRemove: 'サーバーを削除',
  webdavRemoveConfirm:
    'このサーバーの接続情報をこの PC から削除しますか？サーバー上のファイルは削除されません。',
  webdavRemoveYes: '削除',
  webdavNeedPassword:
    'この PC ではパスワードを暗号化して保存できませんでした。もう一度入力してください。',
  webdavNotPersisted:
    'この PC ではパスワードを暗号化して保存できないため、アプリを閉じたあと再入力が必要です。',
  webdavPrivacy:
    'パスワードはこの PC にだけ、システムの暗号化で保存されます。ファイルは、開くときと保存するときだけ、入力したサーバーとの間で送受信されます。',
  webdavEmptyTitle: 'WebDAV サーバーが接続されていません',
  webdavEmptyBody: '設定 → 連携でサーバーを追加すると、ここでサーバーのファイルを見て開けます。',
  webdavOpenSettings: '設定を開く',
  webdavRoot: 'ルート',
  webdavFolderEmpty: 'このフォルダーは空です。',
  webdavLoading: '読み込み中…',
  webdavRefresh: '更新',
  webdavUnsupported: 'この形式はアプリで開けません',
  webdavOpening: '開いています…',
  webdavServer: 'サーバー',
  webdavErrUrl:
    'アドレスが正しくありません。https:// か http:// で始まる完全なアドレスを入力してください。',
  webdavErrInsecure: '暗号化されていない HTTP を使うには、確認のチェックが必要です。',
  webdavErrAuth:
    'サーバーがサインインを拒否しました。ユーザー名とパスワードを確認してください（アプリパスワードが必要なサービスも多くあります）。',
  webdavErrNotFound: 'そのフォルダーまたはファイルはサーバーにありません。',
  webdavErrForbidden: 'このアカウントにはその操作の権限がありません。',
  webdavErrNetwork: 'サーバーに接続できません。アドレスとネットワークを確認してください。',
  webdavErrLimit: '接続できるサーバーは最大 10 台です。',
  webdavErrTooLarge: 'ファイルが大きすぎて開けません。',
  webdavErrRateLimit: 'サーバーから、しばらくしてからやり直すよう求められました。',
  webdavErrLocked: '他の人がこのファイルをロックしています。',
  webdavErrDisk: 'ファイルをこの PC に保存できませんでした。',
} satisfies Record<keyof typeof zh, string>
