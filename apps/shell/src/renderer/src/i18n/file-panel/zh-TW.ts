import type { zh } from './zh'

export const zhTW = {
  panelTitle: '檔案',
  showPanel: '顯示檔案面板',
  hidePanel: '隱藏檔案面板',
  searchPlaceholder: '尋找檔案',
  sectionCurrent: '此文件所在資料夾',
  sectionFolders: '資料夾',
  sectionRecent: '最近',
  addFolder: '新增資料夾',
  refresh: '重新整理',
  collapseAll: '全部摺疊',
  emptyFolder: '這裡沒有可開啟的文件',
  folderMissing: '找不到資料夾',
  untitledHint: '此文件尚未儲存。儲存後，這裡會顯示它所在的資料夾。',
  noResults: '沒有符合的檔案',
  openMark: '已開啟',
  resizePanel: '調整檔案面板寬度',
  noRecent: '沒有最近的文件',
  searching: '正在尋找…',
  quickLook: '快速預覽',
} satisfies Record<keyof typeof zh, string>
