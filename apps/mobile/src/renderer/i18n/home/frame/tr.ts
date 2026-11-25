import type { zh } from './zh'

export const tr = {
  homeTabNav: 'Ana ekran menüsü',
  homeTabRecent: 'Son',
  homeTabFolders: 'Klasörler',
  homeTabTools: 'Araçlar',
  homeTabSettings: 'Ayarlar',
  homeListAll: 'Tümü',
  homeListFavorites: 'Favoriler',
  homeListChips: 'Listeyi süz',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty:
    'Henüz favori yok. Bir dosyayı [⋯] menüsünden favorilere ekleyebilirsiniz.',
  homeListGroupEmpty: 'Bu grupta henüz dosya yok.',
  homeListFavoriteLost: 'Bu dosya açılamıyor. Taşınmış ya da silinmiş olabilir.',
  homeEmptyText: 'Henüz hiç belge açmadınız. Örnek belgeye göz atın ya da bir dosya açın.',
  homeEmptySample: 'Örnek belgeyi aç',
  homeEmptyCreate: 'Yeni oluştur',
  homeCreateFab: 'Yeni oluştur',
  homeCreateTitle: 'Yeni oluştur',
  homeCreateClose: 'Kapat',
  homeCreatePdfTools: 'PDF araçları',
} as const satisfies Record<keyof typeof zh, string>
