import { createI18n, defineStrings, type Lang } from '@genoffice/i18n'

/**
 * Native-menu labels of the file panel: the View-menu toggle and the row menu.
 * The panel's own labels live in the renderer (i18n/file-panel/).
 */
const strings = defineStrings({
  zh: {
    menuToggle: '文件面板',
    itemOpen: '打开',
    itemRevealExplorer: '在资源管理器中显示',
    itemRevealFinder: '在访达中显示',
    itemCopyPath: '复制路径',
    itemAddRoot: '添加到文件夹列表',
  },
  en: {
    menuToggle: 'Files Panel',
    itemOpen: 'Open',
    itemRevealExplorer: 'Show in File Explorer',
    itemRevealFinder: 'Show in Finder',
    itemCopyPath: 'Copy Path',
    itemAddRoot: 'Add to Folder List',
  },
  ja: {
    menuToggle: 'ファイルパネル',
    itemOpen: '開く',
    itemRevealExplorer: 'エクスプローラーで表示',
    itemRevealFinder: 'Finder で表示',
    itemCopyPath: 'パスをコピー',
    itemAddRoot: 'フォルダー一覧に追加',
  },
  ko: {
    menuToggle: '파일 목록',
    itemOpen: '열기',
    itemRevealExplorer: '탐색기에서 보기',
    itemRevealFinder: 'Finder에서 보기',
    itemCopyPath: '경로 복사',
    itemAddRoot: '폴더 목록에 추가',
  },
  fr: {
    menuToggle: 'Panneau Fichiers',
    itemOpen: 'Ouvrir',
    itemRevealExplorer: "Afficher dans l'Explorateur de fichiers",
    itemRevealFinder: 'Afficher dans le Finder',
    itemCopyPath: 'Copier le chemin',
    itemAddRoot: 'Ajouter à la liste des dossiers',
  },
  de: {
    menuToggle: 'Dateibereich',
    itemOpen: 'Öffnen',
    itemRevealExplorer: 'Im Explorer anzeigen',
    itemRevealFinder: 'Im Finder anzeigen',
    itemCopyPath: 'Pfad kopieren',
    itemAddRoot: 'Zur Ordnerliste hinzufügen',
  },
  es: {
    menuToggle: 'Panel de archivos',
    itemOpen: 'Abrir',
    itemRevealExplorer: 'Mostrar en el Explorador de archivos',
    itemRevealFinder: 'Mostrar en Finder',
    itemCopyPath: 'Copiar ruta',
    itemAddRoot: 'Añadir a la lista de carpetas',
  },
  th: {
    menuToggle: 'แผงไฟล์',
    itemOpen: 'เปิด',
    itemRevealExplorer: 'แสดงใน File Explorer',
    itemRevealFinder: 'แสดงใน Finder',
    itemCopyPath: 'คัดลอกเส้นทาง',
    itemAddRoot: 'เพิ่มในรายการโฟลเดอร์',
  },
  id: {
    menuToggle: 'Panel File',
    itemOpen: 'Buka',
    itemRevealExplorer: 'Tampilkan di File Explorer',
    itemRevealFinder: 'Tampilkan di Finder',
    itemCopyPath: 'Salin Jalur',
    itemAddRoot: 'Tambahkan ke Daftar Folder',
  },
  ru: {
    menuToggle: 'Панель файлов',
    itemOpen: 'Открыть',
    itemRevealExplorer: 'Показать в проводнике',
    itemRevealFinder: 'Показать в Finder',
    itemCopyPath: 'Копировать путь',
    itemAddRoot: 'Добавить в список папок',
  },
  ar: {
    menuToggle: 'لوحة الملفات',
    itemOpen: 'فتح',
    itemRevealExplorer: 'إظهار في مستكشف الملفات',
    itemRevealFinder: 'إظهار في Finder',
    itemCopyPath: 'نسخ المسار',
    itemAddRoot: 'إضافة إلى قائمة المجلدات',
  },
  pt: {
    menuToggle: 'Painel de arquivos',
    itemOpen: 'Abrir',
    itemRevealExplorer: 'Mostrar no Explorador de Arquivos',
    itemRevealFinder: 'Mostrar no Finder',
    itemCopyPath: 'Copiar caminho',
    itemAddRoot: 'Adicionar à lista de pastas',
  },
  it: {
    menuToggle: 'Pannello file',
    itemOpen: 'Apri',
    itemRevealExplorer: 'Mostra in Esplora file',
    itemRevealFinder: 'Mostra nel Finder',
    itemCopyPath: 'Copia percorso',
    itemAddRoot: "Aggiungi all'elenco cartelle",
  },
  pl: {
    menuToggle: 'Panel plików',
    itemOpen: 'Otwórz',
    itemRevealExplorer: 'Pokaż w Eksploratorze plików',
    itemRevealFinder: 'Pokaż w Finderze',
    itemCopyPath: 'Kopiuj ścieżkę',
    itemAddRoot: 'Dodaj do listy folderów',
  },
  cs: {
    menuToggle: 'Panel souborů',
    itemOpen: 'Otevřít',
    itemRevealExplorer: 'Zobrazit v Průzkumníku souborů',
    itemRevealFinder: 'Zobrazit ve Finderu',
    itemCopyPath: 'Kopírovat cestu',
    itemAddRoot: 'Přidat do seznamu složek',
  },
  nl: {
    menuToggle: 'Bestandenpaneel',
    itemOpen: 'Openen',
    itemRevealExplorer: 'Weergeven in Verkenner',
    itemRevealFinder: 'Weergeven in Finder',
    itemCopyPath: 'Pad kopiëren',
    itemAddRoot: 'Toevoegen aan maplijst',
  },
  ms: {
    menuToggle: 'Panel Fail',
    itemOpen: 'Buka',
    itemRevealExplorer: 'Tunjukkan dalam File Explorer',
    itemRevealFinder: 'Tunjukkan dalam Finder',
    itemCopyPath: 'Salin Laluan',
    itemAddRoot: 'Tambah ke Senarai Folder',
  },
  he: {
    menuToggle: 'חלונית קבצים',
    itemOpen: 'פתיחה',
    itemRevealExplorer: 'הצגה בסייר הקבצים',
    itemRevealFinder: 'הצגה ב-Finder',
    itemCopyPath: 'העתקת נתיב',
    itemAddRoot: 'הוספה לרשימת התיקיות',
  },
  hi: {
    menuToggle: 'फ़ाइल पैनल',
    itemOpen: 'खोलें',
    itemRevealExplorer: 'फ़ाइल एक्सप्लोरर में दिखाएँ',
    itemRevealFinder: 'Finder में दिखाएँ',
    itemCopyPath: 'पथ कॉपी करें',
    itemAddRoot: 'फ़ोल्डर सूची में जोड़ें',
  },
  'zh-TW': {
    menuToggle: '檔案面板',
    itemOpen: '開啟',
    itemRevealExplorer: '在檔案總管中顯示',
    itemRevealFinder: '在 Finder 中顯示',
    itemCopyPath: '複製路徑',
    itemAddRoot: '加入資料夾清單',
  },
  vi: {
    menuToggle: 'Bảng tệp',
    itemOpen: 'Mở',
    itemRevealExplorer: 'Hiện trong File Explorer',
    itemRevealFinder: 'Hiện trong Finder',
    itemCopyPath: 'Sao chép đường dẫn',
    itemAddRoot: 'Thêm vào danh sách thư mục',
  },
  tr: {
    menuToggle: 'Dosya Paneli',
    itemOpen: 'Aç',
    itemRevealExplorer: 'Dosya Gezgini’nde göster',
    itemRevealFinder: 'Finder’da göster',
    itemCopyPath: 'Yolu kopyala',
    itemAddRoot: 'Klasör listesine ekle',
  },
})

const translate = createI18n(strings)

export type FilePanelMenuKey = keyof (typeof strings)['zh']

export function filePanelMenuText(lang: Lang, key: FilePanelMenuKey): string {
  return translate(lang, key)
}
