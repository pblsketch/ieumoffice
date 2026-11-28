import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'

/** 22-language UI strings for the non-blocking AI static quality badge (`AiQualityBadge`). */
export const QUALITY_AUDIT_STRINGS = defineStrings({
  zh: {
    badgeLabel: '质量检查 {n} 项',
    fixWithAi: '用 AI 修复',
    nonBlockingNote: '仅作参考，不会阻止保存或导出。',
  },
  en: {
    badgeLabel: 'Quality check ({n})',
    fixWithAi: 'Fix with AI',
    nonBlockingNote: 'Advisory only — saving and exporting are never blocked.',
  },
  ja: {
    badgeLabel: '品質チェック {n} 件',
    fixWithAi: 'AI で修正',
    nonBlockingNote: '参考情報です。保存や書き出しはブロックされません。',
  },
  ko: {
    badgeLabel: '품질 확인 {n}건',
    fixWithAi: 'AI로 고치기',
    nonBlockingNote: '참고 안내이며 저장·내보내기를 막지 않습니다.',
  },
  fr: {
    badgeLabel: 'Contrôle qualité ({n})',
    fixWithAi: 'Corriger avec l’IA',
    nonBlockingNote: 'À titre indicatif uniquement — l’enregistrement reste toujours possible.',
  },
  de: {
    badgeLabel: 'Qualitätsprüfung ({n})',
    fixWithAi: 'Mit KI beheben',
    nonBlockingNote: 'Nur ein Hinweis — Speichern und Exportieren werden nicht blockiert.',
  },
  es: {
    badgeLabel: 'Revisión de calidad ({n})',
    fixWithAi: 'Corregir con IA',
    nonBlockingNote: 'Solo orientativo — guardar y exportar nunca se bloquean.',
  },
  th: {
    badgeLabel: 'ตรวจสอบคุณภาพ {n} รายการ',
    fixWithAi: 'แก้ไขด้วย AI',
    nonBlockingNote: 'เป็นคำแนะนำเท่านั้น ไม่บล็อกการบันทึกหรือส่งออก',
  },
  id: {
    badgeLabel: 'Pemeriksaan kualitas ({n})',
    fixWithAi: 'Perbaiki dengan AI',
    nonBlockingNote: 'Hanya saran — penyimpanan dan ekspor tidak pernah diblokir.',
  },
  ru: {
    badgeLabel: 'Проверка качества ({n})',
    fixWithAi: 'Исправить с ИИ',
    nonBlockingNote: 'Носит рекомендательный характер — сохранение и экспорт не блокируются.',
  },
  ar: {
    badgeLabel: 'فحص الجودة ({n})',
    fixWithAi: 'إصلاح بالذكاء الاصطناعي',
    nonBlockingNote: 'للمراجعة فقط — لا يمنع الحفظ أو التصدير.',
  },
  pt: {
    badgeLabel: 'Verificação de qualidade ({n})',
    fixWithAi: 'Corrigir com IA',
    nonBlockingNote: 'Apenas orientativo — salvar e exportar nunca são bloqueados.',
  },
  it: {
    badgeLabel: 'Controllo qualità ({n})',
    fixWithAi: 'Correggi con IA',
    nonBlockingNote: 'Solo informativo — salvataggio ed esportazione non vengono mai bloccati.',
  },
  pl: {
    badgeLabel: 'Kontrola jakości ({n})',
    fixWithAi: 'Napraw za pomocą AI',
    nonBlockingNote: 'Tylko informacyjnie — zapisywanie i eksport nigdy nie są blokowane.',
  },
  cs: {
    badgeLabel: 'Kontrola kvality ({n})',
    fixWithAi: 'Opravit pomocí AI',
    nonBlockingNote: 'Pouze doporučení — ukládání ani export nejsou blokovány.',
  },
  nl: {
    badgeLabel: 'Kwaliteitscontrole ({n})',
    fixWithAi: 'Oplossen met AI',
    nonBlockingNote: 'Alleen ter informatie — opslaan en exporteren worden nooit geblokkeerd.',
  },
  ms: {
    badgeLabel: 'Semakan kualiti ({n})',
    fixWithAi: 'Baiki dengan AI',
    nonBlockingNote: 'Sekadar nasihat — simpanan dan eksport tidak pernah disekat.',
  },
  he: {
    badgeLabel: 'בדיקת איכות ({n})',
    fixWithAi: 'תקן עם AI',
    nonBlockingNote: 'להכוונה בלבד — שמירה וייצוא אינם נחסמים.',
  },
  hi: {
    badgeLabel: 'गुणवत्ता जाँच ({n})',
    fixWithAi: 'AI से ठीक करें',
    nonBlockingNote: 'केवल सुझाव — सहेजना और निर्यात करना कभी अवरुद्ध नहीं होता।',
  },
  'zh-TW': {
    badgeLabel: '品質檢查 {n} 項',
    fixWithAi: '用 AI 修正',
    nonBlockingNote: '僅供參考，不會阻擋儲存或匯出。',
  },
  vi: {
    badgeLabel: 'Kiểm tra chất lượng ({n})',
    fixWithAi: 'Sửa bằng AI',
    nonBlockingNote: 'Chỉ mang tính gợi ý — không bao giờ chặn lưu hoặc xuất tệp.',
  },
  tr: {
    badgeLabel: 'Kalite kontrolü ({n})',
    fixWithAi: 'Yapay zeka ile düzelt',
    nonBlockingNote: 'Yalnızca bilgi amaçlıdır — kaydetme ve dışa aktarma engellenmez.',
  },
})

export type QualityAuditStringKey = keyof typeof QUALITY_AUDIT_STRINGS.zh

export const qualityAuditText: (lang: Lang, key: QualityAuditStringKey, params?: Params) => string =
  createI18n(QUALITY_AUDIT_STRINGS)
