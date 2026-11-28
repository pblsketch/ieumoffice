/// Localized replacements for Electron role menus, whose built-in labels are
/// English-only and (for role:'windowMenu' on Windows/Linux) follow macOS
/// conventions (Zoom, Ctrl+M minimize, Bring All to Front).
import type { MenuItemConstructorOptions, WebContents } from 'electron'
import { brandText, getUiLang, productName } from '@genoffice/i18n'
import { baseLang, contextMenuLabels, type ContextMenuLabels } from './context-menu'

declare const __GENOFFICE_BUILD_DATE__: string | undefined

/** About dialog tagline, shown under the version line. `en` is the fallback
 * for every locale that does not define its own text. */
const ABOUT_TAGLINE: Record<string, string> = {
  ko: '이음오피스(eumOffice)를 모체로 하되, 기존 AI 기능에 사내 로컬 LLM 환경(Ollama)을 연동하고 자체 커스터마이징을 거쳐 완성한 스마트 오피스 솔루션입니다.',
  en: 'a smart office solution built on eumOffice, extended with an in-house local LLM environment (Ollama) alongside the original AI features through custom in-house modifications.',
}

function aboutDetail(version: string, name: string, lang: string, versionLabel: string): string {
  const buildDate =
    typeof __GENOFFICE_BUILD_DATE__ === 'string' && __GENOFFICE_BUILD_DATE__
      ? ` · ${__GENOFFICE_BUILD_DATE__}`
      : ''
  const base = `${versionLabel} ${version}${buildDate}`
  const tagline =
    ABOUT_TAGLINE[lang] !== undefined
      ? lang === 'ko'
        ? `${name}는 ${ABOUT_TAGLINE[lang]}`
        : `${name} ${ABOUT_TAGLINE[lang]}`
      : `${name} is ${ABOUT_TAGLINE.en}`
  return `${base}\n\n${tagline}`
}

export interface AppMenuLabels extends ContextMenuLabels {
  window: string
  minimize: string
  closeWindow: string
  edit: string
  undo: string
  redo: string
  delete: string
  view: string
  reload: string
  forceReload: string
  toggleDevTools: string
  actualSize: string
  zoomIn: string
  zoomOut: string
  fullscreen: string
  help: string
  about: string
  checkUpdates: string
  /** the app-wide Settings window (macOS app menu, the ☰ popup) */
  settings: string
  version: string
}

type Labels = Omit<AppMenuLabels, keyof ContextMenuLabels>

const EN: Labels = {
  window: 'Window',
  minimize: 'Minimize',
  closeWindow: 'Close Window',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  delete: 'Delete',
  view: 'View',
  reload: 'Reload',
  forceReload: 'Force Reload',
  toggleDevTools: 'Developer Tools',
  actualSize: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  fullscreen: 'Full Screen',
  help: 'Help',
  about: 'About GenOffice',
  checkUpdates: 'Check for Updates…',
  settings: 'Settings…',
  version: 'Version',
}

// Shared table, same rationale as context-menu.ts: one copy instead of
// 15 keys × every UI language in each app dictionary.
const LABELS: Record<string, Labels> = {
  zh: {
    window: '窗口',
    minimize: '최소화',
    closeWindow: '关闭窗口',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    delete: '删除',
    view: '视图',
    reload: '重新加载',
    forceReload: '强制重新加载',
    toggleDevTools: '开发者工具',
    actualSize: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    fullscreen: '全屏',
    help: '帮助',
    about: '关于 GenOffice',
    checkUpdates: '检查更新…',
    settings: '设置…',
    version: '版本',
  },
  en: EN,
  ja: {
    window: 'ウィンドウ',
    minimize: '最小化',
    closeWindow: 'ウィンドウを閉じる',
    edit: '編集',
    undo: '元に戻す',
    redo: 'やり直す',
    delete: '削除',
    view: '表示',
    reload: '再読み込み',
    forceReload: '強制的に再読み込み',
    toggleDevTools: '開発者ツール',
    actualSize: '実際のサイズ',
    zoomIn: '拡大',
    zoomOut: '縮小',
    fullscreen: 'フルスクリーン',
    help: 'ヘルプ',
    about: 'GenOffice について',
    checkUpdates: '更新を確認…',
    settings: '設定…',
    version: 'バージョン',
  },
  ko: {
    window: '창',
    minimize: '최소화',
    closeWindow: '창 닫기',
    edit: '편집',
    undo: '실행 취소',
    redo: '다시 실행',
    delete: '삭제',
    view: '보기',
    reload: '새로고침',
    forceReload: '강제 새로고침',
    toggleDevTools: '개발자 도구',
    actualSize: '실제 크기',
    zoomIn: '확대',
    zoomOut: '축소',
    fullscreen: '전체 화면',
    help: '도움말',
    about: 'GenOffice 정보',
    checkUpdates: '업데이트 확인…',
    settings: '설정…',
    version: '버전',
  },
  fr: {
    window: 'Fenêtre',
    minimize: 'Réduire',
    closeWindow: 'Fermer la fenêtre',
    edit: 'Édition',
    undo: 'Annuler',
    redo: 'Rétablir',
    delete: 'Supprimer',
    view: 'Affichage',
    reload: 'Recharger',
    forceReload: 'Forcer le rechargement',
    toggleDevTools: 'Outils de développement',
    actualSize: 'Taille réelle',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    fullscreen: 'Plein écran',
    help: 'Aide',
    about: 'À propos de GenOffice',
    checkUpdates: 'Rechercher les mises à jour…',
    settings: 'Paramètres…',
    version: 'Version',
  },
  de: {
    window: 'Fenster',
    minimize: 'Minimieren',
    closeWindow: 'Fenster schließen',
    edit: 'Bearbeiten',
    undo: 'Rückgängig',
    redo: 'Wiederholen',
    delete: 'Löschen',
    view: 'Ansicht',
    reload: 'Neu laden',
    forceReload: 'Erzwungenes Neuladen',
    toggleDevTools: 'Entwicklertools',
    actualSize: 'Originalgröße',
    zoomIn: 'Vergrößern',
    zoomOut: 'Verkleinern',
    fullscreen: 'Vollbild',
    help: 'Hilfe',
    about: 'Über GenOffice',
    checkUpdates: 'Nach Updates suchen…',
    settings: 'Einstellungen…',
    version: 'Version',
  },
  es: {
    window: 'Ventana',
    minimize: 'Minimizar',
    closeWindow: 'Cerrar ventana',
    edit: 'Edición',
    undo: 'Deshacer',
    redo: 'Rehacer',
    delete: 'Eliminar',
    view: 'Ver',
    reload: 'Recargar',
    forceReload: 'Forzar recarga',
    toggleDevTools: 'Herramientas de desarrollo',
    actualSize: 'Tamaño real',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    fullscreen: 'Pantalla completa',
    help: 'Ayuda',
    about: 'Acerca de GenOffice',
    checkUpdates: 'Buscar actualizaciones…',
    settings: 'Configuración…',
    version: 'Versión',
  },
  th: {
    window: 'หน้าต่าง',
    minimize: 'ย่อเล็กสุด',
    closeWindow: 'ปิดหน้าต่าง',
    edit: 'แก้ไข',
    undo: 'เลิกทำ',
    redo: 'ทำซ้ำ',
    delete: 'ลบ',
    view: 'มุมมอง',
    reload: 'โหลดใหม่',
    forceReload: 'บังคับโหลดใหม่',
    toggleDevTools: 'เครื่องมือนักพัฒนา',
    actualSize: 'ขนาดจริง',
    zoomIn: 'ขยาย',
    zoomOut: 'ย่อ',
    fullscreen: 'เต็มหน้าจอ',
    help: 'วิธีใช้',
    about: 'เกี่ยวกับ GenOffice',
    checkUpdates: 'ตรวจหาการอัปเดต…',
    settings: 'การตั้งค่า…',
    version: 'เวอร์ชัน',
  },
  id: {
    window: 'Jendela',
    minimize: 'Minimalkan',
    closeWindow: 'Tutup Jendela',
    edit: 'Edit',
    undo: 'Urungkan',
    redo: 'Ulangi',
    delete: 'Hapus',
    view: 'Tampilan',
    reload: 'Muat Ulang',
    forceReload: 'Paksa Muat Ulang',
    toggleDevTools: 'Alat Pengembang',
    actualSize: 'Ukuran Sebenarnya',
    zoomIn: 'Perbesar',
    zoomOut: 'Perkecil',
    fullscreen: 'Layar Penuh',
    help: 'Bantuan',
    about: 'Tentang GenOffice',
    checkUpdates: 'Periksa Pembaruan…',
    settings: 'Pengaturan…',
    version: 'Versi',
  },
  ru: {
    window: 'Окно',
    minimize: 'Свернуть',
    closeWindow: 'Закрыть окно',
    edit: 'Правка',
    undo: 'Отменить',
    redo: 'Повторить',
    delete: 'Удалить',
    view: 'Вид',
    reload: 'Перезагрузить',
    forceReload: 'Принудительно перезагрузить',
    toggleDevTools: 'Инструменты разработчика',
    actualSize: 'Реальный размер',
    zoomIn: 'Увеличить',
    zoomOut: 'Уменьшить',
    fullscreen: 'Полноэкранный режим',
    help: 'Справка',
    about: 'О GenOffice',
    checkUpdates: 'Проверить обновления…',
    settings: 'Настройки…',
    version: 'Версия',
  },
  ar: {
    window: 'نافذة',
    minimize: 'تصغير',
    closeWindow: 'إغلاق النافذة',
    edit: 'تحرير',
    undo: 'تراجع',
    redo: 'إعادة',
    delete: 'حذف',
    view: 'عرض',
    reload: 'إعادة التحميل',
    forceReload: 'فرض إعادة التحميل',
    toggleDevTools: 'أدوات المطور',
    actualSize: 'الحجم الفعلي',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير العرض',
    fullscreen: 'ملء الشاشة',
    help: 'تعليمات',
    about: 'حول GenOffice',
    checkUpdates: 'التحقق من التحديثات…',
    settings: 'الإعدادات…',
    version: 'الإصدار',
  },
  pt: {
    window: 'Janela',
    minimize: 'Minimizar',
    closeWindow: 'Fechar Janela',
    edit: 'Editar',
    undo: 'Desfazer',
    redo: 'Refazer',
    delete: 'Excluir',
    view: 'Exibir',
    reload: 'Recarregar',
    forceReload: 'Forçar Recarregamento',
    toggleDevTools: 'Ferramentas do Desenvolvedor',
    actualSize: 'Tamanho Real',
    zoomIn: 'Ampliar',
    zoomOut: 'Reduzir',
    fullscreen: 'Tela Cheia',
    help: 'Ajuda',
    about: 'Sobre o GenOffice',
    checkUpdates: 'Procurar atualizações…',
    settings: 'Configurações…',
    version: 'Versão',
  },
  it: {
    window: 'Finestra',
    minimize: 'Riduci a icona',
    closeWindow: 'Chiudi finestra',
    edit: 'Modifica',
    undo: 'Annulla',
    redo: 'Ripeti',
    delete: 'Elimina',
    view: 'Visualizza',
    reload: 'Ricarica',
    forceReload: 'Forza ricarica',
    toggleDevTools: 'Strumenti di sviluppo',
    actualSize: 'Dimensioni effettive',
    zoomIn: 'Ingrandisci',
    zoomOut: 'Riduci',
    fullscreen: 'Schermo intero',
    help: 'Aiuto',
    about: 'Informazioni su GenOffice',
    checkUpdates: 'Controlla aggiornamenti…',
    settings: 'Impostazioni…',
    version: 'Versione',
  },
  pl: {
    window: 'Okno',
    minimize: 'Minimalizuj',
    closeWindow: 'Zamknij okno',
    edit: 'Edycja',
    undo: 'Cofnij',
    redo: 'Ponów',
    delete: 'Usuń',
    view: 'Widok',
    reload: 'Załaduj ponownie',
    forceReload: 'Wymuś ponowne załadowanie',
    toggleDevTools: 'Narzędzia deweloperskie',
    actualSize: 'Rzeczywisty rozmiar',
    zoomIn: 'Powiększ',
    zoomOut: 'Pomniejsz',
    fullscreen: 'Pełny ekran',
    help: 'Pomoc',
    about: 'O programie GenOffice',
    checkUpdates: 'Sprawdź aktualizacje…',
    settings: 'Ustawienia…',
    version: 'Wersja',
  },
  cs: {
    window: 'Okno',
    minimize: 'Minimalizovat',
    closeWindow: 'Zavřít okno',
    edit: 'Úpravy',
    undo: 'Zpět',
    redo: 'Znovu',
    delete: 'Odstranit',
    view: 'Zobrazení',
    reload: 'Znovu načíst',
    forceReload: 'Vynutit znovunačtení',
    toggleDevTools: 'Nástroje pro vývojáře',
    actualSize: 'Skutečná velikost',
    zoomIn: 'Přiblížit',
    zoomOut: 'Oddálit',
    fullscreen: 'Celá obrazovka',
    help: 'Nápověda',
    about: 'O aplikaci GenOffice',
    checkUpdates: 'Zkontrolovat aktualizace…',
    settings: 'Nastavení…',
    version: 'Verze',
  },
  nl: {
    window: 'Venster',
    minimize: 'Minimaliseren',
    closeWindow: 'Venster sluiten',
    edit: 'Bewerken',
    undo: 'Ongedaan maken',
    redo: 'Opnieuw',
    delete: 'Verwijderen',
    view: 'Beeld',
    reload: 'Opnieuw laden',
    forceReload: 'Geforceerd opnieuw laden',
    toggleDevTools: 'Ontwikkelaarstools',
    actualSize: 'Ware grootte',
    zoomIn: 'Inzoomen',
    zoomOut: 'Uitzoomen',
    fullscreen: 'Volledig scherm',
    help: 'Help',
    about: 'Over GenOffice',
    checkUpdates: 'Controleren op updates…',
    settings: 'Instellingen…',
    version: 'Versie',
  },
  ms: {
    window: 'Tetingkap',
    minimize: 'Minimumkan',
    closeWindow: 'Tutup Tetingkap',
    edit: 'Edit',
    undo: 'Buat Asal',
    redo: 'Buat Semula',
    delete: 'Padam',
    view: 'Paparan',
    reload: 'Muat Semula',
    forceReload: 'Paksa Muat Semula',
    toggleDevTools: 'Alat Pembangun',
    actualSize: 'Saiz Sebenar',
    zoomIn: 'Zum Masuk',
    zoomOut: 'Zum Keluar',
    fullscreen: 'Skrin Penuh',
    help: 'Bantuan',
    about: 'Perihal GenOffice',
    checkUpdates: 'Semak Kemas Kini…',
    settings: 'Tetapan…',
    version: 'Versi',
  },
  he: {
    window: 'חלון',
    minimize: 'מזער',
    closeWindow: 'סגור חלון',
    edit: 'עריכה',
    undo: 'בטל',
    redo: 'בצע שוב',
    delete: 'מחק',
    view: 'תצוגה',
    reload: 'טען מחדש',
    forceReload: 'טען מחדש בכפייה',
    toggleDevTools: 'כלי מפתחים',
    actualSize: 'גודל בפועל',
    zoomIn: 'הגדל',
    zoomOut: 'הקטן',
    fullscreen: 'מסך מלא',
    help: 'עזרה',
    about: 'אודות GenOffice',
    checkUpdates: 'בדוק עדכונים…',
    settings: 'הגדרות…',
    version: 'גרסה',
  },
  hi: {
    window: 'विंडो',
    minimize: 'छोटा करें',
    closeWindow: 'विंडो बंद करें',
    edit: 'संपादन',
    undo: 'पूर्ववत करें',
    redo: 'फिर से करें',
    delete: 'हटाएँ',
    view: 'दृश्य',
    reload: 'पुनः लोड करें',
    forceReload: 'बलपूर्वक पुनः लोड करें',
    toggleDevTools: 'डेवलपर टूल',
    actualSize: 'वास्तविक आकार',
    zoomIn: 'ज़ूम इन',
    zoomOut: 'ज़ूम आउट',
    fullscreen: 'पूर्ण स्क्रीन',
    help: 'सहायता',
    about: 'GenOffice के बारे में',
    checkUpdates: 'अपडेट जांचें…',
    settings: 'सेटिंग्स…',
    version: 'संस्करण',
  },
  vi: {
    window: 'Cửa sổ',
    minimize: 'Thu nhỏ',
    closeWindow: 'Đóng cửa sổ',
    edit: 'Chỉnh sửa',
    undo: 'Hoàn tác',
    redo: 'Làm lại',
    delete: 'Xóa',
    view: 'Xem',
    reload: 'Tải lại',
    forceReload: 'Buộc tải lại',
    toggleDevTools: 'Công cụ nhà phát triển',
    actualSize: 'Kích cỡ thực',
    zoomIn: 'Phóng to',
    zoomOut: 'Thu nhỏ',
    fullscreen: 'Toàn màn hình',
    help: 'Trợ giúp',
    about: 'Giới thiệu GenOffice',
    checkUpdates: 'Kiểm tra bản cập nhật…',
    settings: 'Cài đặt…',
    version: 'Phiên bản',
  },
  tr: {
    window: 'Pencere',
    minimize: 'Simge durumuna küçült',
    closeWindow: 'Pencereyi kapat',
    edit: 'Düzenle',
    undo: 'Geri al',
    redo: 'Yinele',
    delete: 'Sil',
    view: 'Görünüm',
    reload: 'Yeniden yükle',
    forceReload: 'Zorla yeniden yükle',
    toggleDevTools: 'Geliştirici araçlarını aç/kapat',
    actualSize: 'Gerçek boyut',
    zoomIn: 'Yakınlaştır',
    zoomOut: 'Uzaklaştır',
    fullscreen: 'Tam ekran',
    help: 'Yardım',
    about: 'GenOffice hakkında',
    checkUpdates: 'Güncellemeleri denetle…',
    settings: 'Ayarlar…',
    version: 'Sürüm',
  },
  'zh-TW': {
    window: '視窗',
    minimize: '最小化',
    closeWindow: '關閉視窗',
    edit: '編輯',
    undo: '復原',
    redo: '重做',
    delete: '刪除',
    view: '檢視',
    reload: '重新載入',
    forceReload: '強制重新載入',
    toggleDevTools: '開發人員工具',
    actualSize: '實際大小',
    zoomIn: '放大',
    zoomOut: '縮小',
    fullscreen: '全螢幕',
    help: '說明',
    about: '關於 GenOffice',
    checkUpdates: '檢查更新…',
    settings: '設定…',
    version: '版本',
  },
}

export function appMenuLabels(lang: string): AppMenuLabels {
  const labels = { ...contextMenuLabels(lang), ...(LABELS[lang] ?? LABELS[baseLang(lang)] ?? EN) }
  // the table spells the product name as upstream does; show this product's
  return { ...labels, about: brandText(labels.about, lang) }
}

/** macOS keeps the native role (Minimize/Zoom/Front, window list); Windows/Linux
 * gets only conventional items — no Zoom/Front, and no Ctrl+M accelerator since
 * Windows has no menu shortcut for minimize. */
export function windowMenuTemplate(
  platform: NodeJS.Platform,
  labels: AppMenuLabels,
): MenuItemConstructorOptions {
  if (platform === 'darwin') return { role: 'windowMenu', label: labels.window }
  return {
    label: labels.window,
    submenu: [
      { label: labels.minimize, click: (_item, win) => win?.minimize() },
      { type: 'separator' },
      { label: labels.closeWindow, click: (_item, win) => win?.close() },
    ],
  }
}

/** macOS keeps role:'editMenu' (Speech/Substitutions submenus etc.); elsewhere
 * the same items Electron would generate, with localized labels. */
export function editMenuTemplate(
  platform: NodeJS.Platform,
  labels: AppMenuLabels,
): MenuItemConstructorOptions {
  if (platform === 'darwin') return { role: 'editMenu', label: labels.edit }
  return {
    label: labels.edit,
    submenu: [
      { role: 'undo', label: labels.undo },
      { role: 'redo', label: labels.redo },
      { type: 'separator' },
      { role: 'cut', label: labels.cut },
      { role: 'copy', label: labels.copy },
      { role: 'paste', label: labels.paste },
      { role: 'delete', label: labels.delete },
      { type: 'separator' },
      { role: 'selectAll', label: labels.selectAll },
    ],
  }
}

let lastDetachedDevToolsTarget: WebContents | undefined

/** role:'toggleDevTools' docks DevTools into the window, where the shell's
 * WebContentsView tabs are stacked above it and occlude it — open detached
 * instead, keeping the role's accelerator and toggle semantics. */
export function toggleDevToolsItem(labels: AppMenuLabels): MenuItemConstructorOptions {
  return {
    label: labels.toggleDevTools,
    accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
    click: async () => {
      const { webContents } = await import('electron')
      const focused = webContents.getFocusedWebContents()
      const previous =
        lastDetachedDevToolsTarget && !lastDetachedDevToolsTarget.isDestroyed()
          ? lastDetachedDevToolsTarget
          : undefined
      const target = focused ?? previous
      if (!target || target.isDestroyed()) return
      if (target.isDevToolsOpened()) {
        target.closeDevTools()
        return
      }
      target.openDevTools({ mode: 'detach' })
      lastDetachedDevToolsTarget = target
    },
  }
}

export function helpMenuTemplate(labels: AppMenuLabels, version: string): MenuItemConstructorOptions {
  return {
    label: labels.help,
    submenu: [
      {
        label: labels.about,
        click: (_item, win) => {
          const { dialog, app } = require('electron') as typeof import('electron')
          dialog.showMessageBox(win!, {
            type: 'info',
            title: labels.about,
            message: productName(),
            detail: aboutDetail(version, productName(), getUiLang(), labels.version),
          })
        },
      },
      { type: 'separator' },
      { label: labels.checkUpdates, click: () => {} },
    ],
  }
}
