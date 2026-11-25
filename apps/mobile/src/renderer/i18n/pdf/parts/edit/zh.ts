// Keys of the "edit" part of the T2 pdf strings; every key starts with `pdfEdit`.
// The Save As choices and the verify-failure text follow the PC PDF editor's translations.
export const zh = {
  pdfEditPen: '笔',
  pdfEditHighlighter: '荧光笔',
  pdfEditTextBox: '文本框',
  pdfEditSign: '签名',
  pdfEditPages: '整理页面',
  pdfEditLink: '插入链接',
  pdfEditSaveFailed: '无法保存。修改仍然保留，原文件未被改动。',
  pdfEditSaveSkipped: '第 {pages} 页的部分文字修改未能保存。',
  pdfEditShareFailed: '无法分享。',
  pdfEditReloadFailed: '已保存，但无法重新载入文档。请重新打开文件。',
  pdfEditSignatureUnavailable: '签名功能暂不可用。',
  pdfEditSaveAsHint:
    '选择副本中的高亮、备注和绘图如何处理。“合并到页面”会把表单字段也并入页面；“不包含注释”会保留链接和表单字段。',
  pdfEditKeepAnnots: '保留注释（可在其他应用中编辑）',
  pdfEditFlattenAnnots: '合并到页面（所有应用都能看到）',
  pdfEditStripAnnots: '不包含注释（保留链接和表单字段）',
  pdfEditSaveVerifyFailed:
    '第 {pages} 页的修改未能完整写回，已取消保存以保护原文件；请撤销该页的相关修改后重试',
} as const
