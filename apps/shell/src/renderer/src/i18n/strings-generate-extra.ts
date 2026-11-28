/**
 * 22-language UI strings for the optional Slides speaker-notes separation toggle (T11).
 */
import type { Lang } from '@genoffice/i18n'

const STRINGS: Record<Lang, string> = {
  zh: '精简幻灯片文字，将详细说明放入演讲者备注',
  en: 'Keep slide text brief and put detailed explanations in speaker notes',
  ja: 'スライドの文字を簡潔にし、詳しい説明は発表者ノートに入れる',
  ko: '슬라이드 글자를 줄이고 상세 설명은 발표자 노트에 넣기',
  fr: 'Alléger le texte des diapositives et placer les détails dans les notes du présentateur',
  de: 'Folientext kurz halten und ausführliche Erklärungen in die Sprechernotizen legen',
  es: 'Reducir el texto en las diapositivas y colocar los detalles en las notas del orador',
  th: 'ลดข้อความบนสไลด์และใส่คำอธิบายละเอียดในบันทึกย่อของผู้บรรยาย',
  id: 'Ringkas teks di slide dan letakkan penjelasan rinci di catatan pembicara',
  ru: 'Сократить текст на слайдах и перенести подробности в заметки докладчика',
  ar: 'اختصار النص على الشرائح ووضع الشرح التفصيلي في ملاحظات المتحدث',
  pt: 'Reduzir o texto nos slides e colocar explicações detalhadas nas notas do apresentador',
  it: 'Ridurre il testo nelle diapositive e inserire i dettagli nelle note del relatore',
  pl: 'Skrócić tekst na slajdach i umieścić szczegółowe objaśnienia w notatkach prelegenta',
  cs: 'Zkrátit text na snímcích a podrobné vysvětlení vložit do poznámek řečníka',
  nl: 'Houd tekst op dia’s kort en zet uitgebreide uitleg in sprekersnotities',
  ms: 'Ringkaskan teks pada slaid dan letakkan huraian terperinci dalam nota pembentang',
  he: 'לקצר את הטקסט בשקופיות ולהעביר פירוט להערות הדובר',
  hi: 'स्लाइड पर पाठ संक्षिप्त रखें और विस्तृत विवरण वक्ता नोट्स में डालें',
  'zh-TW': '精簡投影片文字，將詳細說明放入講者備忘稿',
  vi: 'Rút gọn chữ trên trang chiếu và đưa phần giải thích chi tiết vào ghi chú người trình bày',
  tr: 'Slayt metnini kısa tutup ayrıntılı açıklamaları konuşmacı notlarına ekle',
}

export function speakerNotesToggleLabel(lang: Lang): string {
  return STRINGS[lang] ?? STRINGS.en
}
