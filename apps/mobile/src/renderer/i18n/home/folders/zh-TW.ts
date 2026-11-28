import type { zh } from './zh'

export const zhTW = {
  homeFolderListLabel: '已連結的資料夾',
  homeFolderEmptyTitle: '尚未連結資料夾',
  homeFolderEmptyBody: '連結常用的資料夾後，其中的文件和圖片會直接顯示在這裡。',
  homeFolderLink: '新增資料夾',
  homeFolderRelink: '重新連結',
  homeFolderRelinkNamed: '重新連結{name}',
  homeFolderOk: '已連結',
  homeFolderLostRevoked: '存取此資料夾的權限已失效。請重新連結。',
  homeFolderLostMissing: '找不到此資料夾。若已移動或刪除，請重新連結。',
  homeFolderLost: '無法存取該資料夾。請重新連結資料夾。',
  homeFolderMenu: '{name} 選單',
  homeFolderRemove: '移除',
  homeFolderRemoveTitle: '要移除「{name}」資料夾嗎？',
  homeFolderRemoveBody:
    '此資料夾中檔案的最近與我的最愛紀錄（{count} 筆）也會一併移除。檔案本身不會被刪除。',
  homeFolderRemoved: '已移除資料夾。',
  homeFolderBack: '回到上一層資料夾',
  homeFolderPath: '目前的資料夾',
  homeFolderSubfolder: '資料夾',
  homeFolderInsideEmpty: '此資料夾中沒有可開啟的文件或圖片。',
} as const satisfies Record<keyof typeof zh, string>
