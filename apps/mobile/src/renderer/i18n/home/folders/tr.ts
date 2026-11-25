import type { zh } from './zh'

export const tr = {
  homeFolderListLabel: 'Bağlı klasörler',
  homeFolderEmptyTitle: 'Henüz bağlı klasör yok',
  homeFolderEmptyBody:
    'Sık kullandığınız bir klasörü bağlayın; içindeki belgeler ve resimler hemen burada görünür.',
  homeFolderLink: 'Klasör bağla',
  homeFolderRelink: 'Yeniden bağla',
  homeFolderRelinkNamed: '{name} klasörünü yeniden bağla',
  homeFolderOk: 'Bağlı',
  homeFolderLostRevoked: 'Bu klasörün izni kayboldu. Yeniden bağlayın.',
  homeFolderLostMissing: 'Bu klasör bulunamadı. Taşıdıysanız veya sildiyseniz yeniden bağlayın.',
  homeFolderLost: 'Klasöre erişilemiyor. Klasörü yeniden bağlayın.',
  homeFolderMenu: '{name} menüsü',
  homeFolderRemove: 'Kaldır',
  homeFolderRemoveTitle: '"{name}" klasörü kaldırılsın mı?',
  homeFolderRemoveBody:
    'Bu klasördeki dosyalara ait {count} son kullanılan ve sık kullanılan kaydı da kaldırılacak. Dosyaların kendisi silinmez.',
  homeFolderRemoved: 'Klasör kaldırıldı.',
  homeFolderBack: 'Üst klasöre',
  homeFolderPath: 'Geçerli klasör',
  homeFolderSubfolder: 'Klasör',
  homeFolderInsideEmpty: 'Bu klasörde açılabilecek belge veya resim yok.',
} as const satisfies Record<keyof typeof zh, string>
