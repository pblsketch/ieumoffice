import type { zh } from './zh'

export const ja = {
  homeTabNav: 'ホームメニュー',
  homeTabRecent: '最近',
  homeTabFolders: 'フォルダー',
  homeTabTools: 'ツール',
  homeTabSettings: '設定',
  homeListAll: 'すべて',
  homeListFavorites: 'お気に入り',
  homeListChips: '一覧の絞り込み',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty:
    'お気に入りのファイルはまだありません。ファイルの [⋯] からお気に入りに追加できます。',
  homeListGroupEmpty: 'このグループにはまだファイルがありません。',
  homeListFavoriteLost: 'このファイルを開けません。移動または削除された可能性があります。',
  homeEmptyText: 'まだ文書を開いていません。サンプル文書を見るか、ファイルを開いてみましょう。',
  homeEmptySample: 'サンプル文書を開く',
  homeEmptyCreate: '新規作成',
  homeCreateFab: '新規作成',
  homeCreateTitle: '新規作成',
  homeCreateClose: '閉じる',
  homeCreatePdfTools: 'PDF ツール',
} as const satisfies Record<keyof typeof zh, string>
