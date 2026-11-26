import type { zh } from './zh'

export const zhTW = {
  sheetsEditorName: 'Excel',
  sheetsLoading: '正在載入表格…',
  sheetsOpening: '正在開啟活頁簿…大型檔案需要一點時間。',
  sheetsPasswordTitle: '受密碼保護的活頁簿',
  sheetsPasswordMessage: '輸入密碼以開啟此活頁簿。',
  sheetsPasswordLabel: '密碼',
  sheetsPasswordWrong: '密碼不正確，請再試一次。',
  sheetsPasswordOpen: '開啟',
  sheetsPasswordCancel: '取消',
  sheetsEncryptionUnsupported: '無法開啟這種加密方式。',
  sheetsEncryptionDamaged: '受保護的活頁簿已損毀，無法開啟。',
  sheetsNoticeMacros: '巨集會保留，但不會執行。',
  sheetsNoticeExternalLinks: '參照其他檔案的儲存格會顯示上次儲存的值。',
  sheetsNoticeMacrosAndLinks: '巨集會保留，但不會執行。參照其他檔案的儲存格會顯示上次儲存的值。',
} as const satisfies Record<keyof typeof zh, string>
