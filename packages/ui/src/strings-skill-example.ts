/**
 * 22-language UI strings for skill examples (`ieum-example`), craft badges, and offline previews (T11).
 */
import type { Lang } from '@genoffice/i18n'

export type SkillExampleStringKey =
  'exampleLabel' | 'startWithExample' | 'craftLabel' | 'offlinePreview'

type Dict = Record<SkillExampleStringKey, string>

const EN: Dict = {
  exampleLabel: 'Example',
  startWithExample: 'Start with example',
  craftLabel: 'Craft',
  offlinePreview: 'Offline layout preview',
}

const STRINGS: Record<Lang, Dict> = {
  zh: {
    exampleLabel: '示例',
    startWithExample: '用示例开始',
    craftLabel: '品质规范',
    offlinePreview: '离线版式预览',
  },
  en: EN,
  ja: {
    exampleLabel: '例',
    startWithExample: '例から始める',
    craftLabel: '品質基準',
    offlinePreview: 'オフライン構成プレビュー',
  },
  ko: {
    exampleLabel: '예시',
    startWithExample: '예시로 시작',
    craftLabel: '품질 기준',
    offlinePreview: '오프라인 구성 미리보기',
  },
  fr: {
    exampleLabel: 'Exemple',
    startWithExample: 'Commencer avec l’exemple',
    craftLabel: 'Qualité',
    offlinePreview: 'Aperçu hors ligne',
  },
  de: {
    exampleLabel: 'Beispiel',
    startWithExample: 'Mit Beispiel starten',
    craftLabel: 'Qualität',
    offlinePreview: 'Offline-Layoutvorschau',
  },
  es: {
    exampleLabel: 'Ejemplo',
    startWithExample: 'Empezar con ejemplo',
    craftLabel: 'Calidad',
    offlinePreview: 'Vista previa sin conexión',
  },
  th: {
    exampleLabel: 'ตัวอย่าง',
    startWithExample: 'เริ่มจากตัวอย่าง',
    craftLabel: 'มาตรฐานงาน',
    offlinePreview: 'ตัวอย่างโครงร่างออฟไลน์',
  },
  id: {
    exampleLabel: 'Contoh',
    startWithExample: 'Mulai dengan contoh',
    craftLabel: 'Kualitas',
    offlinePreview: 'Pratinjau tata letak luring',
  },
  ru: {
    exampleLabel: 'Пример',
    startWithExample: 'Начать с примера',
    craftLabel: 'Качество',
    offlinePreview: 'Автономный предпросмотр',
  },
  ar: {
    exampleLabel: 'مثال',
    startWithExample: 'البدء بالمثال',
    craftLabel: 'معايير الجودة',
    offlinePreview: 'معاينة التخطيط دون اتصال',
  },
  pt: {
    exampleLabel: 'Exemplo',
    startWithExample: 'Começar com exemplo',
    craftLabel: 'Qualidade',
    offlinePreview: 'Prévia offline',
  },
  it: {
    exampleLabel: 'Esempio',
    startWithExample: 'Inizia con esempio',
    craftLabel: 'Qualità',
    offlinePreview: 'Anteprima offline',
  },
  pl: {
    exampleLabel: 'Przykład',
    startWithExample: 'Zacznij od przykładu',
    craftLabel: 'Jakość',
    offlinePreview: 'Podgląd offline',
  },
  cs: {
    exampleLabel: 'Příklad',
    startWithExample: 'Začít příkladem',
    craftLabel: 'Kvalita',
    offlinePreview: 'Offline náhled rozvržení',
  },
  nl: {
    exampleLabel: 'Voorbeeld',
    startWithExample: 'Start met voorbeeld',
    craftLabel: 'Kwaliteit',
    offlinePreview: 'Offline indeling bekijken',
  },
  ms: {
    exampleLabel: 'Contoh',
    startWithExample: 'Mula dengan contoh',
    craftLabel: 'Kualiti',
    offlinePreview: 'Pratonton luar talian',
  },
  he: {
    exampleLabel: 'דוגמה',
    startWithExample: 'התחל עם דוגמה',
    craftLabel: 'איכות',
    offlinePreview: 'תצוגה מקדימה לא מקוונת',
  },
  hi: {
    exampleLabel: 'उदाहरण',
    startWithExample: 'उदाहरण से शुरू करें',
    craftLabel: 'गुणवत्ता',
    offlinePreview: 'ऑफ़लाइन लेआउट पूर्वावलोकन',
  },
  'zh-TW': {
    exampleLabel: '範例',
    startWithExample: '從範例開始',
    craftLabel: '品質規範',
    offlinePreview: '離線版面預覽',
  },
  vi: {
    exampleLabel: 'Ví dụ',
    startWithExample: 'Bắt đầu với ví dụ',
    craftLabel: 'Chất lượng',
    offlinePreview: 'Xem trước bố cục ngoại tuyến',
  },
  tr: {
    exampleLabel: 'Örnek',
    startWithExample: 'Örnekle başla',
    craftLabel: 'Kalite',
    offlinePreview: 'Çevrimdışı düzen önizlemesi',
  },
}

export function skillExampleText(lang: Lang, key: SkillExampleStringKey): string {
  return (STRINGS[lang] ?? EN)[key]
}
