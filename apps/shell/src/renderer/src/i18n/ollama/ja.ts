import type { zh } from './zh'
export const ja = {
  title: 'Ollama',
  localServer: 'ローカル Ollama',
  description:
    'サーバーを追加してモデルを登録し、AI 設定や文書のモデル選択欄で選んでください。文書の編集にはツール呼び出しに対応したモデルが必要です。',
  addServer: 'サーバーを追加',
  empty: '登録されたサーバーはありません。',
  serverName: 'サーバー名',
  editServer: 'サーバーを編集',
  installed: 'インストール済みモデル',
  registered: '登録済みモデル',
  register: '登録',
  registeredBadge: '登録済み',
  noModels: 'サーバーにモデルがインストールされていません。',
  noRegistered: 'インストール済みの一覧からモデルを登録してください。',
  apiKeyOptional: 'API キー（任意）',
  invalidUrl:
    'ユーザー名やパスワードを含まない有効な HTTP または HTTPS アドレスを入力してください。',
  loadFailed: '設定を読み込めませんでした。もう一度お試しください。',
  saveFailed: '変更を保存できませんでした。もう一度お試しください。',
  connectFailed:
    'モデル一覧を取得できませんでした。サーバー、アドレス、API キーを確認してください。',
  removeConfirm:
    'このサーバーと登録済みモデルを一覧から削除しますか？サーバー上のモデルファイルは残ります。',
  loading: '設定を読み込み中…',
  retry: '再試行',
  refresh: '接続テストとモデル一覧の更新',
  effortLow: '低 (Low)',
  effortMedium: '中 (Medium)',
  effortHigh: '高 (High)',
  localLocked: 'この PC で実行中の Ollama は削除できません。',
  connectTimeout: '初回応答タイムアウト（分）',
  connectTimeoutHint: 'モデルの読み込みに時間がかかるサーバーでは値を大きくしてください。',
  visionBadge: 'ビジョン',
  onboardingChecking: 'ローカル Ollama の接続を確認しています…',
  onboardingConnected: 'Ollama に接続しました。',
  onboardingNoModels: '接続しましたが、モデルがまだダウンロードされていません。',
  onboardingUnavailable: '実行中の Ollama サーバーが見つかりません。',
  onboardingGuide:
    'Ollama が未インストールの場合は、社内掲示板からインストールしてください。Ollama でモデルをダウンロードした後、AI モデル管理で一覧を更新し、使用するモデルを登録してください。',
  onboardingOpenManager: 'Ollama 設定',
} satisfies Record<keyof typeof zh, string>
