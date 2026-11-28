import type { zh } from './zh'

export const ja = {
  workpaneTitle: '作業ウィンドウ',
  workpaneOpen: '作業ウィンドウ',
  workpaneClose: '作業ウィンドウを閉じる',
  workpaneExpand: '作業ウィンドウを展開',
  workpaneResize: '作業ウィンドウの幅を変更',
  workpaneTabOutline: 'アウトライン',
  workpaneTabFind: '検索',
  workpaneTabBibliography: '参考文献',
  workpaneMenuOutline: '作業ウィンドウ › アウトライン',
  workpaneMenuFind: '作業ウィンドウ › 検索',
  workpaneMenuBibliography: '作業ウィンドウ › 参考文献',
  workpaneOutlineEmpty: '文書の見出しがここに表示されます。',
  workpaneFindEmpty: '文書内を検索して該当箇所へ移動します。',
  workpaneBibliographyEmpty: '参考文献を管理し、本文へ引用を挿入します。',
  workpaneRailHint: 'ウィンドウ幅が狭いため、タブアイコンをクリックして表示します。',
} satisfies Record<keyof typeof zh, string>
