// Keys of the "link" part of the T2 pdf strings; every key starts with `pdfLink`.
export const zh = {
  pdfLinkPlaceHint: '在页面上拖出放置链接的区域',
  pdfLinkEditTitle: '编辑链接',
  pdfLinkUrlLabel: '网址（http、https、mailto）',
  pdfLinkPageLabel: '或本文档中的页（1–{count}）',
  pdfLinkUrlInvalid: '只能链接 http、https 或 mailto 地址',
  pdfLinkPageInvalid: '请输入 1 到 {count} 之间的页码',
  pdfLinkNeedTarget: '请输入网址或页码',
  pdfLinkApply: '添加链接',
  pdfLinkDelete: '删除链接',
  pdfLinkPending: '待添加的链接：{target}',
  pdfLinkToPage: '第 {page} 页',
  pdfLinkFailed: '无法更改链接。请在保存完成后重试。',
  pdfLinkUpdate: '更改',
} as const
