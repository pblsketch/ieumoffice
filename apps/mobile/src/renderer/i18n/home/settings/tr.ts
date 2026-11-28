import type { zh } from './zh'

export const tr = {
  homeSetEditorsTitle: 'Düzenleyiciler',
  homeSetEditorsHint:
    'Kapattığınız düzenleyiciler yeni belge listesinde görünmez. Hepsini kapatmak, hepsinin açık olduğu anlamına gelir.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'PDF araçları',
  homeSetCardsTitle: 'Ana ekrandaki yeni belgeler',
  homeSetCardShow: '{name} ana ekranda gösterilsin',
  homeSetCardUp: '{name} öğesini yukarı taşı',
  homeSetCardDown: '{name} öğesini aşağı taşı',
  homeSetKeepScreenOn: 'Okurken ekranı açık tut',
  homeSetKeepScreenOnDesc: 'PDF veya EPUB okurken ya da PPT sunarken ekran kapanmaz.',
  homeSetFoldersTitle: 'Belge klasörleri',
  homeSetFoldersEmpty:
    'Henüz bağlı klasör yok. Bir klasör bağlarsanız dosyalarını doğrudan Klasörler sekmesinde görürsünüz.',
  homeSetFolderLink: 'Klasör bağla',
  homeSetFolderRelink: 'Yeniden bağla',
  homeSetFolderRemove: 'Kaldır',
  homeSetFolderRemoveNamed: '{name} klasörünü kaldır',
  homeSetFolderOk: 'Bağlı',
  homeSetFolderLost: 'Bu klasöre erişilemiyor. Taşıdıysanız veya sildiyseniz yeniden bağlayın.',
  homeSetFolderRemoveTitle: '"{name}" klasörü kaldırılsın mı?',
  homeSetFolderRemoveBody:
    'Bu klasördeki dosyalara ait {count} son kullanılan ve sık kullanılan kaydı da kaldırılacak. Dosyaların kendisi silinmez.',
  homeSetBackupsTotal: 'Toplam {size}',
  homeSetStorageTitle: 'Depolama',
  homeSetStorageRecovery: 'Kurtarma kopyaları',
  homeSetStorageTemp: 'Geçici dosyalar',
  homeSetStorageBackups: 'HWP orijinal yedekleri',
  homeSetStorageClearTemp: 'Geçici dosyaları temizle',
  homeSetStorageClearRecovery: 'Tüm kurtarma kopyalarını temizle',
  homeSetStorageClearTempTitle: 'Geçici dosyalar temizlensin mi?',
  homeSetStorageClearTempBody:
    'Paylaşırken veya alırken kısa süreliğine oluşturulan dosyalar silinir. Belgeleriniz olduğu gibi kalır.',
  homeSetStorageClearRecoveryTitle: 'Tüm kurtarma kopyaları temizlensin mi?',
  homeSetStorageClearRecoveryBody:
    'Kaydedilmemiş değişiklikler kaybolur. Şu an açık olan belgenin kurtarma kopyası korunur.',
  homeSetStorageClearAction: 'Temizle',
  homeSetStorageCleared: '{size} boşaltıldı.',
  homeSetFailed: 'Bu işlem yapılamadı. Biraz sonra yeniden deneyin.',
} as const satisfies Record<keyof typeof zh, string>
