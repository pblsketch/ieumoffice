import type { zh } from './zh'

export const ja = {
  workpaneTitle: '作業ウィンドウ',
  workpaneOpen: '作業ウィンドウ',
  workpaneClose: '作業ウィンドウを閉じる',
  workpaneExpand: '作業ウィンドウを展開',
  workpaneResize: '作業ウィンドウの幅を変更',
  workpaneTabOutline: 'アウトライン',
  workpaneTabFind: '検索',
  workpaneMenuOutline: '作業ウィンドウ › アウトライン',
  workpaneMenuFind: '作業ウィンドウ › 検索',
  workpaneOutlineEmpty: '文書の見出しがここに表示されます。',
  workpaneFindEmpty: '文書内を検索して該当箇所へ移動します。',
  workpaneRailHint: 'ウィンドウ幅が狭いため、タブアイコンをクリックして表示します。',
} satisfies Record<keyof typeof zh, string>
