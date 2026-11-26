import type { zh } from './zh'

export const zhTW = {
  sheetsToolbarFormat: '儲存格格式',
  sheetsToolbarRows: '列與欄',
  sheetsToolbarSort: '排序與篩選',
  sheetsToolbarInsert: '插入',
  sheetsToolbarInsertValues: '日期與工作表',
  sheetsToolbarToday: '今天的日期',
  sheetsToolbarTimeNow: '目前時間',
  sheetsToolbarNewSheet: '新工作表',
  sheetsToolbarFind: '尋找',
  sheetsToolbarViewOnly: '圖表、樞紐分析表和條件式格式設定只能檢視。要修改，請在電腦上開啟。',
  sheetsToolbarFullLoaded: '整個活頁簿已載入。請再點一次排序或篩選。',
} as const satisfies Record<keyof typeof zh, string>
