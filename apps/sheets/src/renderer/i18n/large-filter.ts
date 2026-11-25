import { getLang } from './locale'

const DEFAULT_SELECT_VALUES =
  'Clear Select All, then check the values to keep. Search covers the entire column.'

const selectValues: Record<string, string> = {
  en: DEFAULT_SELECT_VALUES,
  ko: '모두 선택을 해제한 뒤 유지할 값을 선택하세요. 검색은 열 전체를 대상으로 합니다.',
  ja: '「すべて選択」を解除してから残す値にチェックを入れてください。検索は列全体が対象です。',
  zh: '请先取消“全选”，再勾选要保留的值。搜索覆盖整列。',
  'zh-TW': '請先取消「全選」，再勾選要保留的值。搜尋涵蓋整欄。',
  es: 'Desmarca Seleccionar todo y marca los valores que quieras conservar. La búsqueda cubre toda la columna.',
  fr: 'Décochez Tout sélectionner, puis cochez les valeurs à conserver. La recherche couvre toute la colonne.',
  de: 'Deaktivieren Sie „Alle auswählen“ und markieren Sie die gewünschten Werte. Die Suche durchsucht die gesamte Spalte.',
  pt: 'Desmarque Selecionar tudo e marque os valores a manter. A pesquisa abrange toda a coluna.',
  ru: 'Снимите «Выбрать всё», затем отметьте нужные значения. Поиск работает по всему столбцу.',
  ar: 'قم بإلغاء تحديد الكل ثم حدد القيم التي تريد الاحتفاظ بها. يشمل البحث العمود بأكمله.',
  hi: 'सभी चुनें हटाएं, फिर रखने के लिए मान चुनें। खोज पूरे कॉलम में होती है।',
  id: 'Hapus centang Pilih Semua, lalu centang nilai yang ingin dipertahankan. Pencarian mencakup seluruh kolom.',
  it: 'Deseleziona Seleziona tutto, quindi seleziona i valori da mantenere. La ricerca copre l’intera colonna.',
  ms: 'Nyahtanda Pilih Semua, kemudian tanda nilai untuk dikekalkan. Carian merangkumi seluruh lajur.',
  nl: 'Schakel Alles selecteren uit en vink de waarden aan die u wilt behouden. Zoeken doorzoekt de hele kolom.',
  pl: 'Odznacz Zaznacz wszystko, a następnie zaznacz wartości do zachowania. Wyszukiwanie obejmuje całą kolumnę.',
  th: 'ยกเลิกการเลือกทั้งหมด จากนั้นเลือกค่าที่ต้องการเก็บไว้ การค้นหาครอบคลุมทั้งคอลัมน์',
  tr: 'Tümünü Seç işaretini kaldırın, ardından tutulacak değerleri seçin. Arama tüm sütunu kapsar.',
  vi: 'Bỏ chọn Chọn tất cả, sau đó đánh dấu các giá trị muốn giữ lại. Tìm kiếm áp dụng cho toàn bộ cột.',
  he: 'בטל את "בחר הכל" ולאחר מכן סמן את הערכים שברצונך לשמור. החיפוש מכסה את כל העמודה.',
  cs: 'Zrušte zaškrtnutí Vybrat vše a poté zaškrtněte hodnoty k ponechání. Hledání pokrývá celý sloupec.',
}

export function largeFilterSelectValuesMessage(): string {
  return selectValues[getLang()] ?? DEFAULT_SELECT_VALUES
}
