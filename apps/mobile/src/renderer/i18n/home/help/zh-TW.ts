import type { zh } from './zh'

export const zhTW = {
  homeHelpSection: '說明',
  homeHelpClose: '關閉',
  homeHelpReplay: '再看一次入門導覽',
  homeHelpReplayFailed: '無法重新開啟入門導覽，請稍後再試。',
  homeHelpFeedback: '傳送意見回饋',
  homeHelpWhatsNew: '這個版本的新功能',

  homeHelpOpenTitle: '開啟文件',
  homeHelpOpenBody1: '在「最近」分頁點「開啟檔案」，就能選擇這台裝置或其他儲存應用程式裡的文件。',
  homeHelpOpenBody2: '連結常用的資料夾後，裡面的文件會直接顯示在「資料夾」分頁。',
  homeHelpOpenBody3: '開過的文件會留在「最近」分頁。加上星號後，也能在「我的最愛」中找到。',
  homeHelpOpenBody4: '文件會先以閱讀模式開啟。想修改時，點 [編輯]。',

  homeHelpEditTitle: '編輯與儲存',
  homeHelpEditBody1: '在閱讀模式下，點上方的 [編輯] 就能開始修改。',
  homeHelpEditBody2: '點一下文字會跳出鍵盤。鍵盤上方的工具列有粗體、清單等格式。',
  homeHelpEditBody3: '改好後點 [完成]。原始檔案會儲存，並回到閱讀模式。',
  homeHelpEditBody4: '如果無法寫入原始檔案，可以用「另存新檔」存成新檔案。',

  homeHelpRecoveryTitle: '儲存與復原副本',
  homeHelpRecoveryBody1: '編輯時，應用程式會自動保留一份復原副本，你不需要做任何操作。',
  homeHelpRecoveryBody2: '點 [完成] 時，才會寫入原始檔案。',
  homeHelpRecoveryBody3:
    '如果還沒儲存應用程式就關閉了，下次開啟時「最近」分頁上方會出現復原副本的提示，在那裡還原即可。',
  homeHelpRecoveryBody4: '復原副本佔用多少空間，可以在「設定 > 儲存空間」中查看並清除。',

  homeHelpShareTitle: '分享與接收',
  homeHelpShareBody1: '檢視文件時點 [分享]，可以照原樣傳送，也可以轉成 PDF 等其他格式再傳送。',
  homeHelpShareBody2:
    '在主畫面清單中選擇 [⋯] > 分享，會照原樣傳送原始檔案。長按可選取多個檔案一起傳送。',
  homeHelpShareBody3:
    '從其他應用程式傳來的檔案會以唯讀方式開啟。想修改時，點 [編輯副本]。原始檔案保持不變。',

  homeHelpFlowTitle: 'HWP 閱讀檢視',
  homeHelpFlowBody1:
    'HWP 文件預設會以列印頁面樣子開啟。想讓文字依螢幕寬度排列、讀起來更輕鬆，請在檢視工具中點 [閱讀檢視]。',
  homeHelpFlowBody2: '想回到列印時的頁面樣子，請在檢視工具中點 [頁面檢視]。',
  homeHelpFlowBody3: '閱讀檢視只改變顯示方式，文件的頁面和儲存的檔案都不會改變。',

  homeHelpAiTitle: '開啟和關閉 AI',
  homeHelpAiBody1: 'AI 一開始是關閉的。關閉時，畫面上不會出現 AI 按鈕。',
  homeHelpAiBody2:
    '要使用 AI，請先在設定中開啟，然後在「AI 連線」裡輸入 API 金鑰或選擇免費連線。不需要註冊這個應用程式的帳號。',
  homeHelpAiBody3:
    '只有在你請 AI 做事時，相關內容才會傳送到你選擇的 AI 服務。再次關閉後，所有 AI 按鈕都會消失。',

  homeHelpFeedbackTitle: '傳送意見回饋',
  homeHelpFeedbackBody:
    '問卷將在瀏覽器中開啟。下方的資訊會複製到剪貼簿，方便你貼到問卷中。應用程式本身不會傳送任何內容，也不會包含文件內容。',
  homeHelpFeedbackDetails: '版本 {version}\n作業系統 {os}\n介面語言 {language}',
  homeHelpFeedbackOpen: '開啟問卷',
  homeHelpFeedbackCancel: '取消',
  homeHelpFeedbackCopyFailed: '無法複製到剪貼簿。請長按下方的文字複製，再貼到問卷中。',
  homeHelpFeedbackOpenFailed: '無法開啟瀏覽器。',

  homeHelpWhatsNewVersion: '版本 {version}',
  homeHelpWhatsNewEmpty: '這個版本沒有更新說明。',
  homeHelpNew010First: 'GenOffice 行動應用程式的第一個版本。',
  homeHelpNew010Edit: '可以開啟並編輯 HWP、PDF、Markdown、HTML 和試算表文件。',
  homeHelpNew010Read: '可以閱讀 EPUB 電子書和 PPT 簡報。',
  homeHelpNew010PdfTools: 'PDF 工具：整理頁面、轉換、壓縮與加密、刪除註解。',
  homeHelpNew010Ai: 'AI 助理（預設關閉）：使用 API 金鑰或免費連線。',
  homeHelpNew010Mobile:
    '分享與接收檔案、HWP 閱讀檢視、入門導覽、儲存空間管理、閱讀時保持螢幕常亮。',
} as const satisfies Record<keyof typeof zh, string>
