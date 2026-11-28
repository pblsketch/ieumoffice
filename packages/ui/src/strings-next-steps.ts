import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'

/** 22-language labels for contextual Next-Step chips (`AiNextSteps`). */
export const NEXT_STEPS_STRINGS = defineStrings({
  zh: {
    groupLabel: '建议的下一步',
    fixQuality: '自动修复质量问题',
    improveSkill: '改进此技能',
    generateOtherDoc: '制作成其他文档',
    openTweaks: '微调样式',
    fixQualityPrompt: '请自动修复当前文档中检测到的全部质量与版式问题，并保持原有内容和意图不变。',
  },
  en: {
    groupLabel: 'Suggested next steps',
    fixQuality: 'Auto-fix quality issues',
    improveSkill: 'Improve this skill',
    generateOtherDoc: 'Create another document',
    openTweaks: 'Fine-tune style',
    fixQualityPrompt:
      'Automatically fix all detected quality and layout issues in the current document while preserving its content and intent.',
  },
  ja: {
    groupLabel: '次のステップ候補',
    fixQuality: '品質の問題を自動修正',
    improveSkill: 'このスキルを改善',
    generateOtherDoc: '別の文書を作成',
    openTweaks: 'スタイルを微調整',
    fixQualityPrompt:
      '現在の文書で検出された品質・レイアウトの問題をすべて自動修正し、元の内容と意図は維持してください。',
  },
  ko: {
    groupLabel: '추천 다음 단계',
    fixQuality: '품질 문제 자동 수정',
    improveSkill: '이 스킬 고치기',
    generateOtherDoc: '다른 문서로 만들기',
    openTweaks: '스타일 미세 조정',
    fixQualityPrompt:
      '현재 문서에서 발견된 품질 및 레이아웃 문제를 모두 자동으로 수정하되, 원래 내용과 의도는 그대로 유지해 주세요.',
  },
  fr: {
    groupLabel: 'Étapes suivantes suggérées',
    fixQuality: 'Corriger les problèmes de qualité',
    improveSkill: 'Améliorer cette compétence',
    generateOtherDoc: 'Créer un autre document',
    openTweaks: 'Ajuster le style',
    fixQualityPrompt:
      'Corrigez automatiquement tous les problèmes de qualité et de mise en page détectés tout en conservant le contenu et l’intention.',
  },
  de: {
    groupLabel: 'Vorgeschlagene nächste Schritte',
    fixQuality: 'Qualitätsprobleme automatisch beheben',
    improveSkill: 'Diesen Skill verbessern',
    generateOtherDoc: 'Anderes Dokument erstellen',
    openTweaks: 'Stil feinabstimmen',
    fixQualityPrompt:
      'Beheben Sie alle erkannten Qualitäts- und Layoutprobleme automatisch und behalten Sie Inhalt sowie Absicht bei.',
  },
  es: {
    groupLabel: 'Siguientes pasos sugeridos',
    fixQuality: 'Corregir problemas de calidad',
    improveSkill: 'Mejorar esta habilidad',
    generateOtherDoc: 'Crear otro documento',
    openTweaks: 'Ajustar estilo',
    fixQualityPrompt:
      'Corrige automáticamente todos los problemas de calidad y diseño detectados conservando el contenido y la intención originales.',
  },
  th: {
    groupLabel: 'ขั้นตอนถัดไปที่แนะนำ',
    fixQuality: 'แก้ไขปัญหาคุณภาพอัตโนมัติ',
    improveSkill: 'ปรับปรุงทักษะนี้',
    generateOtherDoc: 'สร้างเป็นเอกสารอื่น',
    openTweaks: 'ปรับแต่งสไตล์',
    fixQualityPrompt:
      'แก้ไขปัญหาคุณภาพและเลย์เอาต์ที่ตรวจพบทั้งหมดโดยอัตโนมัติ โดยคงเนื้อหาและเจตนาเดิมไว้',
  },
  id: {
    groupLabel: 'Langkah berikutnya yang disarankan',
    fixQuality: 'Perbaiki masalah kualitas otomatis',
    improveSkill: 'Perbaiki skill ini',
    generateOtherDoc: 'Buat dokumen lain',
    openTweaks: 'Sesuaikan gaya',
    fixQualityPrompt:
      'Perbaiki secara otomatis semua masalah kualitas dan tata letak yang terdeteksi sambil mempertahankan isi dan maksud asli.',
  },
  ru: {
    groupLabel: 'Рекомендуемые следующие шаги',
    fixQuality: 'Исправить проблемы качества',
    improveSkill: 'Улучшить этот навык',
    generateOtherDoc: 'Создать другой документ',
    openTweaks: 'Настроить стиль',
    fixQualityPrompt:
      'Автоматически исправьте все обнаруженные проблемы качества и макета, сохранив исходное содержание и смысл.',
  },
  ar: {
    groupLabel: 'الخطوات التالية المقترحة',
    fixQuality: 'إصلاح مشكلات الجودة تلقائياً',
    improveSkill: 'تحسين هذه المهارة',
    generateOtherDoc: 'إنشاء مستند آخر',
    openTweaks: 'ضبط النمط بدقة',
    fixQualityPrompt:
      'أصلح تلقائياً جميع مشكلات الجودة والتخطيط المكتشفة في المستند الحالي مع الحفاظ على المحتوى والمقصد الأصلي.',
  },
  pt: {
    groupLabel: 'Próximos passos sugeridos',
    fixQuality: 'Corrigir problemas de qualidade',
    improveSkill: 'Melhorar esta habilidade',
    generateOtherDoc: 'Criar outro documento',
    openTweaks: 'Ajustar estilo',
    fixQualityPrompt:
      'Corrija automaticamente todos os problemas de qualidade e layout detectados, mantendo o conteúdo e a intenção originais.',
  },
  it: {
    groupLabel: 'Passaggi successivi suggeriti',
    fixQuality: 'Correggi i problemi di qualità',
    improveSkill: 'Migliora questa competenza',
    generateOtherDoc: 'Crea un altro documento',
    openTweaks: 'Rifinisci stile',
    fixQualityPrompt:
      'Correggi automaticamente tutti i problemi di qualità e layout rilevati preservando contenuti e intento originali.',
  },
  pl: {
    groupLabel: 'Sugerowane kolejne kroki',
    fixQuality: 'Napraw problemy jakości',
    improveSkill: 'Ulepsz tę umiejętność',
    generateOtherDoc: 'Utwórz inny dokument',
    openTweaks: 'Dostosuj styl',
    fixQualityPrompt:
      'Automatycznie napraw wszystkie wykryte problemy z jakością i układem, zachowując oryginalną treść i intencję.',
  },
  cs: {
    groupLabel: 'Doporučené další kroky',
    fixQuality: 'Automaticky opravit problémy kvality',
    improveSkill: 'Upravit tuto dovednost',
    generateOtherDoc: 'Vytvořit jiný dokument',
    openTweaks: 'Doladit styl',
    fixQualityPrompt:
      'Automaticky opravte všechny zjištěné problémy kvality a rozvržení při zachování původního obsahu a záměru.',
  },
  nl: {
    groupLabel: 'Voorgestelde volgende stappen',
    fixQuality: 'Kwaliteitsproblemen automatisch oplossen',
    improveSkill: 'Deze vaardigheid verbeteren',
    generateOtherDoc: 'Ander document maken',
    openTweaks: 'Stijl verfijnen',
    fixQualityPrompt:
      'Los alle gedetecteerde kwaliteits- en lay-outproblemen automatisch op met behoud van de oorspronkelijke inhoud en bedoeling.',
  },
  ms: {
    groupLabel: 'Langkah seterusnya yang dicadangkan',
    fixQuality: 'Baiki masalah kualiti secara automatik',
    improveSkill: 'Baiki kemahiran ini',
    generateOtherDoc: 'Cipta dokumen lain',
    openTweaks: 'Laraskan gaya',
    fixQualityPrompt:
      'Baiki semua masalah kualiti dan susun atur yang dikesan secara automatik sambil mengekalkan kandungan dan maksud asal.',
  },
  he: {
    groupLabel: 'הצעדים הבאים המומלצים',
    fixQuality: 'תקן בעיות איכות אוטומטית',
    improveSkill: 'שפר מיומנות זו',
    generateOtherDoc: 'צור מסמך אחר',
    openTweaks: 'כוונן סגנון',
    fixQualityPrompt:
      'תקן אוטומטית את כל בעיות האיכות והפריסה שזוהו במסמך הנוכחי תוך שמירה על התוכן והכוונה המקוריים.',
  },
  hi: {
    groupLabel: 'सुझाए गए अगले कदम',
    fixQuality: 'गुणवत्ता समस्याएँ स्वतः ठीक करें',
    improveSkill: 'इस कौशल को सुधारें',
    generateOtherDoc: 'अन्य दस्तावेज़ बनाएँ',
    openTweaks: 'शैली समायोजित करें',
    fixQualityPrompt:
      'वर्तमान दस्तावेज़ में मिली सभी गुणवत्ता और लेआउट समस्याओं को मूल सामग्री और उद्देश्य बनाए रखते हुए स्वतः ठीक करें।',
  },
  'zh-TW': {
    groupLabel: '建議的下一步',
    fixQuality: '自動修正品質問題',
    improveSkill: '改進此技能',
    generateOtherDoc: '製作成其他文件',
    openTweaks: '微調樣式',
    fixQualityPrompt: '請自動修正目前文件中偵測到的全部品質與版面問題，並保留原本內容與意圖。',
  },
  vi: {
    groupLabel: 'Bước tiếp theo gợi ý',
    fixQuality: 'Tự động sửa lỗi chất lượng',
    improveSkill: 'Cải thiện kỹ năng này',
    generateOtherDoc: 'Tạo tài liệu khác',
    openTweaks: 'Tinh chỉnh kiểu dáng',
    fixQualityPrompt:
      'Tự động khắc phục mọi vấn đề về chất lượng và bố cục đã phát hiện trong tài liệu hiện tại mà vẫn giữ nguyên nội dung và ý định gốc.',
  },
  tr: {
    groupLabel: 'Önerilen sonraki adımlar',
    fixQuality: 'Kalite sorunlarını otomatik düzelt',
    improveSkill: 'Bu beceriyi geliştir',
    generateOtherDoc: 'Başka belge oluştur',
    openTweaks: 'Stili ince ayarla',
    fixQualityPrompt:
      'Mevcut belgede tespit edilen tüm kalite ve düzen sorunlarını orijinal içerik ve amacı koruyarak otomatik olarak düzeltin.',
  },
})

export type NextStepsStringKey = keyof typeof NEXT_STEPS_STRINGS.zh

export const nextStepsText: (lang: Lang, key: NextStepsStringKey, params?: Params) => string =
  createI18n(NEXT_STEPS_STRINGS)
