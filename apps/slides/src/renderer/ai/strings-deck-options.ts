/**
 * 22-language UI strings for Slides AI deck-structure chips and speaker-notes separation toggle.
 */
import type { Lang } from '@genoffice/i18n'
import type { SlideDeckStructureId } from '@genoffice/pipelines/slides/templates'

export type SlidesDeckOptionKey =
  | 'structureLabel'
  | 'structureAuto'
  | 'structureWeeklyReport'
  | 'structureProposal'
  | 'structureLecture'
  | 'structureProductOverview'
  | 'structureLockedBySkillTemplate'
  | 'speakerNotesLabel'
  | 'speakerNotesTip'

type Dict = Record<SlidesDeckOptionKey, string>

const EN: Dict = {
  structureLabel: 'Structure',
  structureAuto: 'Auto',
  structureWeeklyReport: 'Weekly Report',
  structureProposal: 'Proposal',
  structureLecture: 'Lecture',
  structureProductOverview: 'Product Overview',
  structureLockedBySkillTemplate: 'Following the attached skill template structure',
  speakerNotesLabel: 'Separate speaker notes',
  speakerNotesTip: 'Keep on-slide text brief and put detailed commentary in speaker notes',
}

const STRINGS: Record<Lang, Dict> = {
  zh: {
    structureLabel: '结构',
    structureAuto: '自动',
    structureWeeklyReport: '周报',
    structureProposal: '方案提案',
    structureLecture: '讲义课程',
    structureProductOverview: '产品介绍',
    structureLockedBySkillTemplate: '将按所选技能模板的结构生成',
    speakerNotesLabel: '分离演讲者备注',
    speakerNotesTip: '幻灯片保留精炼要点，详细说明写入演讲者备注',
  },
  en: EN,
  ja: {
    structureLabel: '構成',
    structureAuto: '自動',
    structureWeeklyReport: '週次報告',
    structureProposal: '提案書',
    structureLecture: '講義資料',
    structureProductOverview: '製品紹介',
    structureLockedBySkillTemplate: '添付したスキルテンプレートの構成を使用します',
    speakerNotesLabel: '発表者ノートを分離',
    speakerNotesTip: 'スライド本文は要点のみにし、詳しい説明を発表者ノートに分けます',
  },
  ko: {
    structureLabel: '구성',
    structureAuto: '자동',
    structureWeeklyReport: '주간 보고',
    structureProposal: '제안서',
    structureLecture: '강의안',
    structureProductOverview: '제품 소개',
    structureLockedBySkillTemplate: '첨부된 스킬 템플릿의 구성을 따릅니다',
    speakerNotesLabel: '발표자 노트 분리',
    speakerNotesTip: '슬라이드는 핵심만 간결하게 두고, 상세 설명은 발표자 노트에 작성합니다',
  },
  fr: {
    structureLabel: 'Structure',
    structureAuto: 'Auto',
    structureWeeklyReport: 'Rapport hebdo',
    structureProposal: 'Proposition',
    structureLecture: 'Cours',
    structureProductOverview: 'Présentation produit',
    structureLockedBySkillTemplate: 'Suit la structure du modèle de compétence joint',
    speakerNotesLabel: 'Séparer les notes',
    speakerNotesTip:
      'Garde les diapositives concises et place les détails dans les notes du présentateur',
  },
  de: {
    structureLabel: 'Aufbau',
    structureAuto: 'Auto',
    structureWeeklyReport: 'Wochenbericht',
    structureProposal: 'Vorschlag',
    structureLecture: 'Vorlesung',
    structureProductOverview: 'Produktübersicht',
    structureLockedBySkillTemplate: 'Folgt dem Aufbau der angehängten Skill-Vorlage',
    speakerNotesLabel: 'Notizen trennen',
    speakerNotesTip:
      'Folientexte knapp halten und ausführliche Hinweise in die Vortragsnotizen schreiben',
  },
  es: {
    structureLabel: 'Estructura',
    structureAuto: 'Auto',
    structureWeeklyReport: 'Informe semanal',
    structureProposal: 'Propuesta',
    structureLecture: 'Clase',
    structureProductOverview: 'Resumen de producto',
    structureLockedBySkillTemplate: 'Sigue la estructura de la plantilla de habilidad adjunta',
    speakerNotesLabel: 'Separar notas del orador',
    speakerNotesTip:
      'Mantiene las diapositivas breves y coloca las explicaciones en las notas del orador',
  },
  th: {
    structureLabel: 'โครงสร้าง',
    structureAuto: 'อัตโนมัติ',
    structureWeeklyReport: 'รายงานประจำสัปดาห์',
    structureProposal: 'ข้อเสนอ',
    structureLecture: 'สื่อการสอน',
    structureProductOverview: 'แนะนำผลิตภัณฑ์',
    structureLockedBySkillTemplate: 'ใช้โครงสร้างตามเทมเพลตทักษะที่แนบไว้',
    speakerNotesLabel: 'แยกบันทึกผู้บรรยาย',
    speakerNotesTip: 'เก็บข้อความบนสไลด์ให้กระชับ และใส่รายละเอียดไว้ในบันทึกผู้บรรยาย',
  },
  id: {
    structureLabel: 'Struktur',
    structureAuto: 'Otomatis',
    structureWeeklyReport: 'Laporan Mingguan',
    structureProposal: 'Proposal',
    structureLecture: 'Materi Kuliah',
    structureProductOverview: 'Ringkasan Produk',
    structureLockedBySkillTemplate: 'Mengikuti struktur templat keterampilan yang dilampirkan',
    speakerNotesLabel: 'Pisahkan catatan pembicara',
    speakerNotesTip:
      'Buat teks slide tetap ringkas dan taruh penjelasan rinci di catatan pembicara',
  },
  ru: {
    structureLabel: 'Структура',
    structureAuto: 'Авто',
    structureWeeklyReport: 'Еженедельный отчёт',
    structureProposal: 'Предложение',
    structureLecture: 'Лекция',
    structureProductOverview: 'Обзор продукта',
    structureLockedBySkillTemplate: 'Используется структура прикреплённого шаблона навыка',
    speakerNotesLabel: 'Вынести заметки докладчика',
    speakerNotesTip: 'Краткие тезисы на слайдах, подробные пояснения — в заметках докладчика',
  },
  ar: {
    structureLabel: 'البنية',
    structureAuto: 'تلقائي',
    structureWeeklyReport: 'تقرير أسبوعي',
    structureProposal: 'مقترح',
    structureLecture: 'محاضرة',
    structureProductOverview: 'نظرة على المنتج',
    structureLockedBySkillTemplate: 'يتبع بنية قالب المهارة المرفق',
    speakerNotesLabel: 'فصل ملاحظات المتحدث',
    speakerNotesTip: 'إبقاء نص الشرائح موجزاً ووضع الشرح التفصيلي في ملاحظات المتحدث',
  },
  pt: {
    structureLabel: 'Estrutura',
    structureAuto: 'Automático',
    structureWeeklyReport: 'Relatório semanal',
    structureProposal: 'Proposta',
    structureLecture: 'Aula',
    structureProductOverview: 'Visão do produto',
    structureLockedBySkillTemplate: 'Seguindo a estrutura do modelo de habilidade anexado',
    speakerNotesLabel: 'Separar notas do orador',
    speakerNotesTip: 'Mantém os slides concisos e coloca os detalhes nas notas do apresentador',
  },
  it: {
    structureLabel: 'Struttura',
    structureAuto: 'Auto',
    structureWeeklyReport: 'Report settimanale',
    structureProposal: 'Proposta',
    structureLecture: 'Lezione',
    structureProductOverview: 'Panoramica prodotto',
    structureLockedBySkillTemplate: 'Segue la struttura del modello di skill allegato',
    speakerNotesLabel: 'Separa note relatore',
    speakerNotesTip: 'Testi brevi sulle diapositive e dettagli estesi nelle note del relatore',
  },
  pl: {
    structureLabel: 'Układ',
    structureAuto: 'Auto',
    structureWeeklyReport: 'Raport tygodniowy',
    structureProposal: 'Propozycja',
    structureLecture: 'Wykład',
    structureProductOverview: 'Przegląd produktu',
    structureLockedBySkillTemplate: 'Używany jest układ dołączonego szablonu umiejętności',
    speakerNotesLabel: 'Oddziel notatki prelegenta',
    speakerNotesTip: 'Krótkie hasła na slajdach, a szczegółowe omówienie w notatkach prelegenta',
  },
  cs: {
    structureLabel: 'Struktura',
    structureAuto: 'Auto',
    structureWeeklyReport: 'Týdenní zpráva',
    structureProposal: 'Návrh',
    structureLecture: 'Přednáška',
    structureProductOverview: 'Přehled produktu',
    structureLockedBySkillTemplate: 'Používá se struktura přiložené šablony dovednosti',
    speakerNotesLabel: 'Oddělit poznámky řečníka',
    speakerNotesTip: 'Stručný text na snímcích a podrobný výklad v poznámkách přednášejícího',
  },
  nl: {
    structureLabel: 'Structuur',
    structureAuto: 'Automatisch',
    structureWeeklyReport: 'Weekrapport',
    structureProposal: 'Voorstel',
    structureLecture: 'Les',
    structureProductOverview: 'Productoverzicht',
    structureLockedBySkillTemplate: 'Volgt de structuur van het bijgevoegde vaardigheidssjabloon',
    speakerNotesLabel: 'Sprekersnotities scheiden',
    speakerNotesTip: 'Houd dia’s beknopt en plaats uitgebreide toelichting in sprekersnotities',
  },
  ms: {
    structureLabel: 'Struktur',
    structureAuto: 'Auto',
    structureWeeklyReport: 'Laporan Mingguan',
    structureProposal: 'Cadangan',
    structureLecture: 'Kuliah',
    structureProductOverview: 'Gambaran Produk',
    structureLockedBySkillTemplate: 'Mengikut struktur templat kemahiran yang dilampirkan',
    speakerNotesLabel: 'Asingkan nota pembentang',
    speakerNotesTip: 'Ringkaskan teks slaid dan letakkan huraian terperinci dalam nota pembentang',
  },
  he: {
    structureLabel: 'מבנה',
    structureAuto: 'אוטומטי',
    structureWeeklyReport: 'דוח שבועי',
    structureProposal: 'הצעה',
    structureLecture: 'הרצאה',
    structureProductOverview: 'סקירת מוצר',
    structureLockedBySkillTemplate: 'עוקב אחר המבנה של תבנית המיומנות המצורפת',
    speakerNotesLabel: 'הפרדת הערות דובר',
    speakerNotesTip: 'טקסט קצר בשקופיות והסברים מפורטים בהערות הדובר',
  },
  hi: {
    structureLabel: 'संरचना',
    structureAuto: 'स्वतः',
    structureWeeklyReport: 'साप्ताहिक रिपोर्ट',
    structureProposal: 'प्रस्ताव',
    structureLecture: 'व्याख्यान',
    structureProductOverview: 'उत्पाद परिचय',
    structureLockedBySkillTemplate: 'संलग्न कौशल टेम्पलेट की संरचना का पालन हो रहा है',
    speakerNotesLabel: 'स्पीकर नोट्स अलग रखें',
    speakerNotesTip: 'स्लाइड पर संक्षिप्त बिंदु रखें और विस्तृत व्याख्या स्पीकर नोट्स में लिखें',
  },
  'zh-TW': {
    structureLabel: '架構',
    structureAuto: '自動',
    structureWeeklyReport: '週報',
    structureProposal: '提案簡報',
    structureLecture: '講義課程',
    structureProductOverview: '產品介紹',
    structureLockedBySkillTemplate: '將依所選技能範本的架構生成',
    speakerNotesLabel: '分離講者備忘稿',
    speakerNotesTip: '投影片僅保留重點，詳細說明寫入講者備忘稿',
  },
  vi: {
    structureLabel: 'Cấu trúc',
    structureAuto: 'Tự động',
    structureWeeklyReport: 'Báo cáo tuần',
    structureProposal: 'Đề xuất',
    structureLecture: 'Bài giảng',
    structureProductOverview: 'Giới thiệu sản phẩm',
    structureLockedBySkillTemplate: 'Đang theo cấu trúc của mẫu kỹ năng đính kèm',
    speakerNotesLabel: 'Tách ghi chú diễn giả',
    speakerNotesTip:
      'Giữ nội dung trên trang chiếu ngắn gọn và đưa giải thích chi tiết vào ghi chú',
  },
  tr: {
    structureLabel: 'Yapı',
    structureAuto: 'Otomatik',
    structureWeeklyReport: 'Haftalık Rapor',
    structureProposal: 'Teklif',
    structureLecture: 'Ders',
    structureProductOverview: 'Ürün Tanıtımı',
    structureLockedBySkillTemplate: 'Ekli beceri şablonunun yapısı izleniyor',
    speakerNotesLabel: 'Konuşmacı notlarını ayır',
    speakerNotesTip: 'Slayt metnini kısa tutup ayrıntılı açıklamaları konuşmacı notlarına yazar',
  },
}

const STRUCTURE_KEYS: Record<SlideDeckStructureId, SlidesDeckOptionKey> = {
  'weekly-report': 'structureWeeklyReport',
  proposal: 'structureProposal',
  lecture: 'structureLecture',
  'product-overview': 'structureProductOverview',
}

export function slidesDeckOptionText(lang: Lang, key: SlidesDeckOptionKey): string {
  return (STRINGS[lang] ?? EN)[key]
}

export function slidesDeckStructureLabel(lang: Lang, id: SlideDeckStructureId): string {
  return slidesDeckOptionText(lang, STRUCTURE_KEYS[id])
}
