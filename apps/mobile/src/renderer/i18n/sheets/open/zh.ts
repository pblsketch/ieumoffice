// Strings of the sheets "open" area, owned by XLS-T7 (open, password, notices). zh defines the keys.
export const zh = {
  sheetsEditorName: 'Excel',
  sheetsLoading: '正在加载表格…',
  sheetsOpening: '正在打开表格…大文件需要一点时间。',
  sheetsPasswordTitle: '受密码保护的表格',
  sheetsPasswordMessage: '输入密码以打开此表格。',
  sheetsPasswordLabel: '密码',
  sheetsPasswordWrong: '密码不正确，请重试。',
  sheetsPasswordOpen: '打开',
  sheetsPasswordCancel: '取消',
  sheetsEncryptionUnsupported: '无法打开这种加密方式。',
  sheetsEncryptionDamaged: '受保护的表格已损坏，无法打开。',
  sheetsNoticeMacros: '宏会保留，但不会运行。',
  sheetsNoticeExternalLinks: '引用其他文件的单元格显示上次保存的值。',
  sheetsNoticeMacrosAndLinks: '宏会保留，但不会运行。引用其他文件的单元格显示上次保存的值。',
} as const
