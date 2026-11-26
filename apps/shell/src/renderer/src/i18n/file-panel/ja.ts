import type { zh } from './zh'

export const ja = {
  panelTitle: 'ファイル',
  showPanel: 'ファイルパネルを表示',
  hidePanel: 'ファイルパネルを隠す',
  searchPlaceholder: 'ファイルを検索',
  sectionCurrent: 'この文書のフォルダー',
  sectionFolders: 'フォルダー',
  sectionRecent: '最近',
  addFolder: 'フォルダーを追加',
  refresh: '更新',
  collapseAll: 'すべて折りたたむ',
  emptyFolder: '開ける文書がありません',
  folderMissing: 'フォルダーが見つかりません',
  untitledHint:
    'この文書はまだ保存されていません。保存すると、ここに保存先のフォルダーが表示されます。',
  noResults: '一致するファイルはありません',
  openMark: '開いています',
  resizePanel: 'ファイルパネルの幅を変更',
  noRecent: '最近の文書はありません',
  searching: '検索中…',
} satisfies Record<keyof typeof zh, string>
