import type { zh } from './zh'

export const ja = {
  sheetsToolbarFormat: 'セルの書式',
  sheetsToolbarRows: '行と列',
  sheetsToolbarSort: '並べ替えとフィルター',
  sheetsToolbarInsert: '挿入',
  sheetsToolbarInsertValues: '日付とシート',
  sheetsToolbarToday: '今日の日付',
  sheetsToolbarTimeNow: '現在の時刻',
  sheetsToolbarNewSheet: '新しいシート',
  sheetsToolbarFind: '検索',
  sheetsToolbarViewOnly:
    'グラフ、ピボットテーブル、条件付き書式は表示のみです。変更するにはパソコンで開いてください。',
  sheetsToolbarFullLoaded:
    'ブック全体を読み込みました。もう一度並べ替えかフィルターをタップしてください。',
} as const satisfies Record<keyof typeof zh, string>
