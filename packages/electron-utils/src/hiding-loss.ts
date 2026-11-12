import { createI18n, defineStrings, getUiLang, type Lang } from '@genoffice/i18n'

/**
 * Converting a document whose sensitive-info hiding marks the target format
 * cannot hold (ODT, ODS, CSV, plain text, …): the copy has the words without
 * the marks, so a model reading the copy would see them. The person is asked
 * once, before anything is converted or written; cancel writes nothing.
 *
 * Only an interactive conversion asks. The terminal command and a headless
 * export never do (they carry what the target holds and say nothing more),
 * and PDF, print and picture exports are for people and are not asked about.
 *
 * Pure: no Electron. The message box options are Electron's shape; `show` is
 * `dialog.showMessageBox`. The counting helpers read what an editor hands
 * over (a ProseMirror document as JSON, an HTML page) without its schema.
 */

const zh = {
  hidingLossTitle: '隐藏敏感信息',
  hidingLossMessage: '有 {count} 处隐藏标记会丢失。在转换后的文档中，AI 可能会看到那些文字。',
  hidingLossContinue: '继续',
  hidingLossCancel: '取消',
}

type Keys = Record<keyof typeof zh, string>

export const HIDING_LOSS_STRINGS = defineStrings({
  zh,
  en: {
    hidingLossTitle: 'Hide sensitive info',
    hidingLossMessage:
      'The hiding marks on {count} places will be left out. In the converted document, the AI may see those words.',
    hidingLossContinue: 'Continue',
    hidingLossCancel: 'Cancel',
  } satisfies Keys,
  ja: {
    hidingLossTitle: '機密情報を隠す',
    hidingLossMessage:
      '隠した {count} か所の印がなくなります。変換後の文書では、その文字が AI に見える場合があります。',
    hidingLossContinue: '続行',
    hidingLossCancel: 'キャンセル',
  } satisfies Keys,
  ko: {
    hidingLossTitle: '민감정보 가리기',
    hidingLossMessage:
      '가리기 {count}곳이 빠집니다. 바꾼 문서에서는 그 글이 AI에게 보일 수 있습니다.',
    hidingLossContinue: '계속',
    hidingLossCancel: '취소',
  } satisfies Keys,
  fr: {
    hidingLossTitle: 'Masquer les informations sensibles',
    hidingLossMessage:
      '{count} passages masqués perdront leur marque. Dans le document converti, l’IA pourra voir ces mots.',
    hidingLossContinue: 'Continuer',
    hidingLossCancel: 'Annuler',
  } satisfies Keys,
  de: {
    hidingLossTitle: 'Sensible Daten ausblenden',
    hidingLossMessage:
      '{count} ausgeblendete Stellen verlieren ihre Markierung. Im umgewandelten Dokument kann die KI diese Wörter sehen.',
    hidingLossContinue: 'Fortfahren',
    hidingLossCancel: 'Abbrechen',
  } satisfies Keys,
  es: {
    hidingLossTitle: 'Ocultar información sensible',
    hidingLossMessage:
      '{count} partes ocultas perderán su marca. En el documento convertido, la IA podrá ver esas palabras.',
    hidingLossContinue: 'Continuar',
    hidingLossCancel: 'Cancelar',
  } satisfies Keys,
  th: {
    hidingLossTitle: 'ซ่อนข้อมูลอ่อนไหว',
    hidingLossMessage:
      'ส่วนที่ซ่อนไว้ {count} แห่งจะไม่มีเครื่องหมายซ่อนอีก ในเอกสารที่แปลงแล้ว AI อาจเห็นข้อความเหล่านั้น',
    hidingLossContinue: 'ดำเนินการต่อ',
    hidingLossCancel: 'ยกเลิก',
  } satisfies Keys,
  id: {
    hidingLossTitle: 'Sembunyikan informasi sensitif',
    hidingLossMessage:
      '{count} bagian yang disembunyikan akan kehilangan tandanya. Di dokumen hasil konversi, AI bisa melihat kata-kata itu.',
    hidingLossContinue: 'Lanjutkan',
    hidingLossCancel: 'Batal',
  } satisfies Keys,
  ru: {
    hidingLossTitle: 'Скрыть конфиденциальные данные',
    hidingLossMessage:
      'Скрытые фрагменты ({count}) потеряют отметку. В преобразованном документе ИИ сможет увидеть этот текст.',
    hidingLossContinue: 'Продолжить',
    hidingLossCancel: 'Отмена',
  } satisfies Keys,
  ar: {
    hidingLossTitle: 'إخفاء المعلومات الحساسة',
    hidingLossMessage:
      'ستفقد {count} من الأجزاء المخفية علامتها. في المستند المحوَّل قد يرى الذكاء الاصطناعي تلك الكلمات.',
    hidingLossContinue: 'متابعة',
    hidingLossCancel: 'إلغاء',
  } satisfies Keys,
  pt: {
    hidingLossTitle: 'Ocultar informações sensíveis',
    hidingLossMessage:
      '{count} partes ocultas perderão a marca. No documento convertido, a IA poderá ver essas palavras.',
    hidingLossContinue: 'Continuar',
    hidingLossCancel: 'Cancelar',
  } satisfies Keys,
  it: {
    hidingLossTitle: 'Nascondi informazioni sensibili',
    hidingLossMessage:
      '{count} parti nascoste perderanno il segno. Nel documento convertito l’IA potrà vedere quelle parole.',
    hidingLossContinue: 'Continua',
    hidingLossCancel: 'Annulla',
  } satisfies Keys,
  pl: {
    hidingLossTitle: 'Ukryj dane wrażliwe',
    hidingLossMessage:
      'Ukryte fragmenty ({count}) stracą oznaczenie. W przekonwertowanym dokumencie AI może zobaczyć te słowa.',
    hidingLossContinue: 'Kontynuuj',
    hidingLossCancel: 'Anuluj',
  } satisfies Keys,
  cs: {
    hidingLossTitle: 'Skrýt citlivé údaje',
    hidingLossMessage:
      'Skrytá místa ({count}) přijdou o označení. V převedeném dokumentu může AI tato slova vidět.',
    hidingLossContinue: 'Pokračovat',
    hidingLossCancel: 'Zrušit',
  } satisfies Keys,
  nl: {
    hidingLossTitle: 'Gevoelige gegevens verbergen',
    hidingLossMessage:
      '{count} verborgen delen verliezen hun markering. In het omgezette document kan de AI die woorden zien.',
    hidingLossContinue: 'Doorgaan',
    hidingLossCancel: 'Annuleren',
  } satisfies Keys,
  ms: {
    hidingLossTitle: 'Sembunyikan maklumat sensitif',
    hidingLossMessage:
      '{count} bahagian yang disembunyikan akan hilang tandanya. Dalam dokumen yang ditukar, AI mungkin melihat perkataan itu.',
    hidingLossContinue: 'Teruskan',
    hidingLossCancel: 'Batal',
  } satisfies Keys,
  he: {
    hidingLossTitle: 'הסתרת מידע רגיש',
    hidingLossMessage:
      '{count} קטעים מוסתרים יאבדו את הסימון שלהם. במסמך המומר ה-AI עלול לראות את המילים האלה.',
    hidingLossContinue: 'המשך',
    hidingLossCancel: 'ביטול',
  } satisfies Keys,
  hi: {
    hidingLossTitle: 'संवेदनशील जानकारी छिपाएँ',
    hidingLossMessage:
      'छिपाए गए {count} हिस्सों का निशान हट जाएगा। बदले गए दस्तावेज़ में AI वे शब्द देख सकता है।',
    hidingLossContinue: 'जारी रखें',
    hidingLossCancel: 'रद्द करें',
  } satisfies Keys,
  'zh-TW': {
    hidingLossTitle: '隱藏敏感資訊',
    hidingLossMessage: '有 {count} 處隱藏標記會遺失。在轉換後的文件中，AI 可能會看到那些文字。',
    hidingLossContinue: '繼續',
    hidingLossCancel: '取消',
  } satisfies Keys,
  vi: {
    hidingLossTitle: 'Ẩn thông tin nhạy cảm',
    hidingLossMessage:
      '{count} chỗ đã ẩn sẽ mất dấu ẩn. Trong tài liệu đã chuyển đổi, AI có thể thấy những chữ đó.',
    hidingLossContinue: 'Tiếp tục',
    hidingLossCancel: 'Hủy',
  } satisfies Keys,
  tr: {
    hidingLossTitle: 'Hassas bilgileri gizle',
    hidingLossMessage:
      'Gizlenen {count} yer işaretini kaybedecek. Dönüştürülen belgede yapay zekâ bu sözcükleri görebilir.',
    hidingLossContinue: 'Devam et',
    hidingLossCancel: 'İptal',
  } satisfies Keys,
})

const tHiding = createI18n(HIDING_LOSS_STRINGS)

/** Electron's MessageBoxOptions, the part used here */
export interface HidingLossMessageBox {
  type: 'warning'
  title: string
  message: string
  buttons: string[]
  defaultId: number
  cancelId: number
  noLink: true
}

/** The question: "N hidden parts lose their mark", Continue or Cancel (the default). */
export function hidingLossMessageBox(
  count: number,
  lang: Lang = getUiLang(),
): HidingLossMessageBox {
  const t = (key: keyof typeof zh) => tHiding(lang, key, { count })
  return {
    type: 'warning',
    title: t('hidingLossTitle'),
    message: t('hidingLossMessage'),
    buttons: [t('hidingLossContinue'), t('hidingLossCancel')],
    // the safe answer is the one Enter and Esc give
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
}

/**
 * True when the conversion may go on: nothing hidden is lost, or the person
 * chose Continue. Asks at most once per call and never when `count` is 0.
 */
export async function confirmHidingLoss(
  count: number,
  show: (options: HidingLossMessageBox) => Promise<{ response: number }>,
  lang: Lang = getUiLang(),
): Promise<boolean> {
  if (!(count > 0)) return true
  const { response } = await show(hidingLossMessageBox(count, lang))
  return response === 0
}

/** A ProseMirror node as JSON (TipTap's getJSON), no schema needed. */
export interface MarkedNode {
  type?: string | { name?: string }
  text?: string
  marks?: ReadonlyArray<{ type?: string | { name?: string }; attrs?: Record<string, unknown> }>
  content?: readonly MarkedNode[]
}

const nameOf = (value: string | { name?: string } | undefined): string | undefined =>
  typeof value === 'string' ? value : value?.name

/**
 * How many hidden spans a document holds: text that carries `markName`, one
 * per run of touching text nodes with the same label inside one block.
 */
export function countMarkedSpans(doc: MarkedNode, markName: string): number {
  let count = 0
  const walk = (node: MarkedNode): void => {
    let open: string | null = null
    for (const child of node.content ?? []) {
      if (typeof child.text === 'string') {
        const mark = (child.marks ?? []).find((m) => nameOf(m.type) === markName)
        const label = mark ? String(mark.attrs?.label ?? '') : null
        if (label !== null && label !== open) count++
        open = label
        continue
      }
      open = null
      walk(child)
    }
  }
  walk(doc)
  return count
}

/**
 * How many marks an HTML page saved by the HTML editor carries: an element's
 * content (`data-gx-redact`), one attribute's value (`data-gx-redact-<attr>`)
 * or a script string (a gx:redact comment). Counted on the raw text, any
 * case, so a mark the editor would honour is never missed.
 */
export function countHtmlHidingMarks(html: string): number {
  return html.match(/\bdata-gx-redact(?:-[\w:.-]+)?\s*=|\/\*\s*gx:redact:/gi)?.length ?? 0
}
