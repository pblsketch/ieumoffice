// Keys of the "annot" part of the T2 pdf strings; every key starts with `pdfAnnot`.
// The four markup names follow the PC PDF editor's translations.
export const zh = {
  pdfAnnotHighlight: '高亮',
  pdfAnnotUnderline: '下划线',
  pdfAnnotSquiggly: '波浪线',
  pdfAnnotStrikeout: '删除线',
  pdfAnnotModeSelect: '选择文字',
  pdfAnnotModeNote: '放置便笺',
  pdfAnnotHintSelect: '在文字上横向拖动，或长按后拖动来选择。点按标注可更改颜色或删除。',
  pdfAnnotHintNote: '点按要放置便笺的位置。',
  pdfAnnotPen: '荧光笔 {n}',
  pdfAnnotColor: '颜色 {n}',
  pdfAnnotRemove: '删除标注',
  pdfAnnotMarkupTitle: '标注颜色',
  pdfAnnotClearSelection: '取消选择',
  pdfAnnotNoText: '此页没有可选择的文字。',
  pdfAnnotOpenNote: '打开便笺',
  pdfAnnotFailed: '无法更改注释。',
  pdfAnnotNewNote: '新便笺',
  pdfAnnotReplyPlaceholder: '回复内容',
} as const
