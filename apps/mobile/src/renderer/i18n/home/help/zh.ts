// Track T6 home strings, part "help". zh defines the keys.
export const zh = {
  homeHelpSection: '帮助',
  homeHelpClose: '关闭',
  homeHelpReplay: '重新查看入门引导',
  homeHelpReplayFailed: '没能重新打开入门引导，请稍后再试。',
  homeHelpFeedback: '发送反馈',
  homeHelpWhatsNew: '本版本的新变化',

  homeHelpOpenTitle: '打开文档',
  homeHelpOpenBody1: '在“最近”标签页点“打开文件”，就能选择本机或其他存储应用里的文档。',
  homeHelpOpenBody2: '关联常用的文件夹后，里面的文档会直接显示在“文件夹”标签页。',
  homeHelpOpenBody3: '打开过的文档会留在“最近”里。加上星标后，也能在“收藏”中找到。',
  homeHelpOpenBody4: '文档会先以阅读模式打开。想修改时，点 [编辑]。',

  homeHelpEditTitle: '编辑与保存',
  homeHelpEditBody1: '在阅读模式下，点顶部的 [编辑] 就可以开始修改。',
  homeHelpEditBody2: '点一下文字会弹出键盘。键盘上方的工具栏里有加粗、列表等格式。',
  homeHelpEditBody3: '改好后点 [完成]。原文件会被保存，并回到阅读模式。',
  homeHelpEditBody4: '如果原文件无法写入，可以用“另存为”保存成新文件。',

  homeHelpRecoveryTitle: '保存与恢复副本',
  homeHelpRecoveryBody1: '编辑时，应用会自动保留一份恢复副本，不需要你做任何操作。',
  homeHelpRecoveryBody2: '点 [完成] 时，才会写入原文件。',
  homeHelpRecoveryBody3:
    '如果还没保存应用就关闭了，下次打开时“最近”标签页顶部会出现恢复副本的提示，在那里恢复即可。',
  homeHelpRecoveryBody4: '恢复副本占用多少空间，可以在“设置 > 存储空间”中查看和清除。',

  homeHelpShareTitle: '分享与接收',
  homeHelpShareBody1: '查看文档时点 [分享]，可以按原样发送，也可以转换成 PDF 等其他格式再发送。',
  homeHelpShareBody2:
    '在主页列表中选择 [⋯] > 分享，会按原样发送原文件。长按可以选中多个文件一起发送。',
  homeHelpShareBody3:
    '其他应用发来的文件会以只读方式打开。想修改时，点 [编辑副本]。原文件保持不变。',

  homeHelpFlowTitle: 'HWP 阅读视图',
  homeHelpFlowBody1:
    'HWP 文档默认按打印页面样子打开。想让文字随屏幕宽度排列、读起来更轻松，请在视图工具中点 [阅读视图]。',
  homeHelpFlowBody2: '想回到打印时的页面样子，请在视图工具中点 [页面视图]。',
  homeHelpFlowBody3: '阅读视图只改变显示方式，文档的页面和保存的文件都不会变。',

  homeHelpAiTitle: '开启和关闭 AI',
  homeHelpAiBody1: 'AI 一开始是关闭的。关闭时，界面上不会出现 AI 按钮。',
  homeHelpAiBody2:
    '要使用 AI，请在设置中开启，然后在“AI 连接”里填入 API 密钥或选择免费连接。不需要注册本应用的账号。',
  homeHelpAiBody3:
    '只有在你请 AI 做事时，相关内容才会发送到你选择的 AI 服务。再次关闭后，所有 AI 按钮都会消失。',

  homeHelpFeedbackTitle: '发送反馈',
  homeHelpFeedbackBody:
    '问卷将在浏览器中打开。下面的信息会复制到剪贴板，方便你粘贴到问卷中。应用本身不会发送任何内容，也不会包含文档内容。',
  homeHelpFeedbackDetails: '版本 {version}\n操作系统 {os}\n界面语言 {language}',
  homeHelpFeedbackOpen: '打开问卷',
  homeHelpFeedbackCancel: '取消',
  homeHelpFeedbackCopyFailed: '没能复制到剪贴板。请长按下面的文字复制，再粘贴到问卷中。',
  homeHelpFeedbackOpenFailed: '没能打开浏览器。',

  homeHelpWhatsNewVersion: '版本 {version}',
  homeHelpWhatsNewEmpty: '这个版本没有更新说明。',
  homeHelpNew010First: 'GenOffice 移动应用的第一个版本。',
  homeHelpNew010Edit: '可以打开并编辑 HWP、PDF、Markdown、HTML 和电子表格文档。',
  homeHelpNew010Read: '可以阅读 EPUB 电子书和 PPT 演示文稿。',
  homeHelpNew010PdfTools: 'PDF 工具：整理页面、转换、压缩与加密、删除批注。',
  homeHelpNew010Ai: 'AI 助手（默认关闭）：用 API 密钥或免费连接使用。',
  homeHelpNew010Mobile:
    '分享与接收文件、HWP 阅读视图、入门引导、存储空间管理、阅读时保持屏幕常亮。',
} as const
