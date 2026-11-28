import type { zh } from './zh'

export const zhTW = {
  homeRunEditorOffTitle: '{name}編輯器已停用',
  homeRunEditorOffBody: '啟用後才能開啟這個檔案。之後可以隨時在設定中再停用。',
  homeRunEditorOffConfirm: '啟用並開啟',
  homeRunStripSample: '範例文件 · 唯讀',
  homeRunStripReceived: '收到的檔案 · 唯讀',
  homeRunStripReadOnly: '唯讀',
  homeRunStripCopy: '編輯副本',
  homeRunStripClose: '關閉提示',
  homeRunReceiveTitle: '收到的檔案',
  homeRunReceiveCount: '{count} 個檔案',
  homeRunReceiveClose: '關閉收到的檔案',
  homeRunReceiveOpen: '開啟',
  homeRunReceivePdfOff: 'PDF 工具已停用',
  homeRunReceivePdfOn: '啟用並繼續',
  homeRunGuideLabel: '入門導覽',
  homeRunWelcomeTitle: '歡迎',
  homeRunWelcomeBody:
    '用 GenOffice 開啟並編輯 HWP、PDF、Markdown 等文件。不需要帳號，沒有廣告，文件只存在這台裝置上。',
  homeRunStart: '開始使用',
  homeRunTipEditButton: '想修改時，點 [編輯]',
  homeRunTipFlowView: '想依螢幕寬度閱讀，點 [閱讀檢視]',
  homeRunTipFirstEdit: '應用程式會自動保留復原副本。點 [完成] 時才會儲存原始檔案',
  homeRunTipFirstKeyboard: '點 [Aa] 可以變更文字格式',
} as const satisfies Record<keyof typeof zh, string>
