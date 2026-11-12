/**
 * The rules-only finder of sensitive information.
 *
 * ## What it is and is not
 *
 * Every candidate comes from the shape of the text and the words around it:
 * fixed patterns, check digits, label words. Nothing here calls a model, a
 * local AI or the network, and the same input always gives the same result.
 * A candidate is only a suggestion; nothing is hidden until the reader
 * confirms it.
 *
 * The rules lean toward too many. A candidate the reader dismisses costs a
 * click; one the rules miss goes to the model. So when a rule has to choose
 * between a narrower shape and a wider one, it takes the wider one, and the
 * negative cases it does reject are the ones that would bury real candidates
 * in noise (dates, times, versions, common words before a title).
 *
 * ## Input and output
 *
 * The caller gives text pieces in reading order, each with an opaque
 * location (a paragraph, a cell, a shape) that comes back on its candidates.
 * Offsets are into that piece's text. Tables come in two shapes, and both
 * are read by label words:
 *
 * - Headers on the row above (a class list: "name | student number" over
 *   the values). Give each value cell its column's header as `header`; a
 *   header that is a label word decides the kind of the cell's value.
 * - Labels on the left (a form: a "name" cell, then the value cell). A piece
 *   that is nothing but a label word ("name", "phone:") announces the kind
 *   of the next piece, so pass such cells in reading order, row by row.
 *
 * A cell's own `header` wins over the piece before it.
 *
 * Candidates do not overlap. When two rules claim the same text, the kind
 * with the more specific shape wins (a registration number over a phone
 * number over an account number, and so on). An address yields to every
 * other kind: one that runs into another candidate is cut short before it.
 * After an address label, an exact road-name or lot-number address in the
 * line is taken as the whole address; otherwise the line is taken up to a
 * wide gap, another kind's label word, a date, or another candidate.
 *
 * Renderer-safe, exported as `@genoffice/agent-core/sensitive-detect`.
 */

import type { SensitiveKind } from './sensitive-kinds'

export interface TextPiece<L> {
  text: string
  location: L
  /** the header of the column this cell sits in, when the table has its headers on the row above */
  header?: string
}

export interface SensitiveCandidate<L> {
  kind: SensitiveKind
  /** offset into the piece's text where the value starts */
  start: number
  /** offset just past the value */
  end: number
  value: string
  location: L
}

/** Lower wins when two candidates overlap: the more specific shape first. */
const PRIORITY: Readonly<Record<SensitiveKind, number>> = {
  'resident-number': 0,
  card: 1,
  'driver-license': 2,
  passport: 3,
  phone: 4,
  email: 5,
  account: 6,
  'id-number': 7,
  'birth-date': 8,
  vehicle: 9,
  name: 10,
  address: 11,
}

// ---------------------------------------------------------------------------
// Label words
// ---------------------------------------------------------------------------

/**
 * Words that announce a value of a kind. A space inside a word matches any
 * spacing, none included (the two words may also be run together), and
 * Latin letters match either case.
 */
const LABEL_WORDS: Readonly<Record<SensitiveKind, readonly string[]>> = {
  'resident-number': [
    '주민등록 번호',
    '주민 번호',
    '외국인등록 번호',
    '외국인 번호',
    '등록 번호',
    'Resident registration number',
    'RRN',
  ],
  passport: ['여권 번호', '여권', 'Passport number', 'Passport No.', 'Passport No', 'Passport'],
  'driver-license': [
    '운전면허 번호',
    '운전면허',
    '면허 번호',
    'Driver license number',
    'Driver license',
    "Driver's license",
    'Driving licence',
  ],
  account: [
    '계좌 번호',
    '계좌',
    '입금 계좌',
    '환불 계좌',
    '예금 계좌',
    'Account number',
    'Account No.',
    'Bank account',
    '국민 은행',
    '국민',
    'KB',
    '신한 은행',
    '신한',
    '우리 은행',
    '하나 은행',
    '농협 은행',
    '농협',
    'NH',
    '기업 은행',
    'IBK',
    '카카오 뱅크',
    '케이 뱅크',
    '토스 뱅크',
    '새마을 금고',
    '신협',
    '우체국',
    'SC 제일 은행',
    '씨티 은행',
    '수협',
    '대구 은행',
    '부산 은행',
    '경남 은행',
    '광주 은행',
    '전북 은행',
    '제주 은행',
    '산업 은행',
    'iM 뱅크',
    '은행',
  ],
  card: ['카드 번호', '신용 카드', '체크 카드', '카드', 'Card number', 'Card No.', 'Credit card'],
  phone: [
    '전화 번호',
    '전화',
    '연락처',
    '휴대폰 번호',
    '휴대폰',
    '휴대 전화',
    '핸드폰',
    '비상 연락처',
    '팩스',
    'Tel.',
    'Tel',
    'Phone',
    'Mobile',
    'Fax',
    '\u96FB\u8A71',
  ],
  email: ['이메일', '전자 우편', '메일', 'E-mail', 'Email', 'Mail'],
  address: ['주소', '거주지', '주거지', '자택', '현주소', '소재지', '본적', 'Address'],
  name: [
    '성명',
    '이름',
    '성함',
    '학생 이름',
    '학생 성명',
    '학생명',
    '보호자 성명',
    '보호자 이름',
    '보호자명',
    '신청인',
    '신청자',
    '작성자',
    '담당자',
    '대표자',
    '예금주',
    '수신인',
    '발신인',
    '받는 사람',
    '보내는 사람',
    '환자명',
    '고객명',
    'Full name',
    'Name',
    '\u6C0F\u540D',
    '\u59D3\u540D',
    '\u540D\u524D',
  ],
  'birth-date': [
    '생년월일',
    '생일',
    '출생일',
    '출생 일자',
    '생년',
    'Date of birth',
    'Birth date',
    'Birthday',
    'DOB',
    '\u51FA\u751F\u65E5\u671F',
    '\u751F\u5E74\u6708\u65E5',
  ],
  'id-number': [
    '학번',
    '사번',
    '수험 번호',
    '응시 번호',
    '직원 번호',
    '사원 번호',
    '교직원 번호',
    '교번',
    '군번',
    '학적 번호',
    '학생 번호',
    '회원 번호',
    'Student ID',
    'Student No.',
    'Employee ID',
    'Employee No.',
    'Staff ID',
  ],
  vehicle: ['차량 번호', '자동차 번호', '차 번호', 'Plate number', 'License plate'],
}

/** Sheet column headers that mean "this column holds names", beyond the name label words. */
const NAME_HEADERS: readonly string[] = [
  '이름(한글)',
  '성명(한글)',
  '한글 이름',
  '한글 성명',
  '이름(영문)',
  '성명(영문)',
  '영문 이름',
  '영문 성명',
  '교사명',
  '직원명',
  '사원명',
  '참가자',
  '참가자명',
  '응시자명',
  '수험자명',
  '수강생',
  '담임',
  '담임 교사',
  'Student name',
  'First name',
  'Last name',
  'Given name',
  'Surname',
]

/** A label word or header as it is compared: letters and digits only, lower case. */
function foldWord(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
}

const WORD_KIND: ReadonlyMap<string, SensitiveKind> = (() => {
  const map = new Map<string, SensitiveKind>()
  for (const kind of Object.keys(LABEL_WORDS) as SensitiveKind[]) {
    for (const word of LABEL_WORDS[kind]) {
      const key = foldWord(word)
      if (!map.has(key)) map.set(key, kind)
    }
  }
  return map
})()

const NAME_HEADER_SET: ReadonlySet<string> = new Set([
  ...LABEL_WORDS.name.map(foldWord),
  ...NAME_HEADERS.map(foldWord),
])

/** The kind a column header gives the values of its cells, or null. */
function headerKind(header: string | undefined): SensitiveKind | null {
  if (!header) return null
  return isNameColumnHeader(header) ? 'name' : labelWordKind(header)
}

/** The kind a piece announces when it is nothing but a label word ("name", "phone:"), else null. */
export function labelWordKind(text: string): SensitiveKind | null {
  const key = foldWord(text)
  return key ? (WORD_KIND.get(key) ?? null) : null
}

/** True when a sheet column header says the column holds people's names. */
export function isNameColumnHeader(header: string): boolean {
  const key = foldWord(header)
  return key.length > 0 && NAME_HEADER_SET.has(key)
}

// ---------------------------------------------------------------------------
// Pattern pieces
// ---------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A label word as a pattern: any spacing for a space, either case for a Latin letter. */
function wordPattern(word: string): string {
  return escapeRegExp(word)
    .split(' ')
    .map((part) => part.replace(/[A-Za-z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`))
    .join('[ \\t]*')
}

function alternation(words: readonly string[]): string {
  return [...words]
    .sort((a, b) => b.length - a.length)
    .map(wordPattern)
    .join('|')
}

const DASH = /[-\u2010-\u2015\u2212]/.source
const REGION =
  '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주'
/** The syllables a Korean plate's middle letter can be. */
const PLATE = '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호'
const SURNAMES =
  '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부가복태목형피두감음빈동온호범좌팽승간상갈단견당화창'
const COMPOUND_SURNAMES = '남궁|독고|제갈|선우|황보|사공|서문|동방'
const HAN_IDEOGRAPH = /[\u4E00-\u9FFF]/.source

const KOREAN_NAME = `(?:${COMPOUND_SURNAMES}|[${SURNAMES}])[가-힣]{1,3}`
/** Where a Korean name may end: not inside a word, or before a particle or copula. */
const NAME_END =
  '(?=$|[^가-힣]|(?:입니다|이며|이고|에게|에서|께서|으로|님|씨|은|는|이|가|을|를|의|와|과|도|께|에|로|만)(?:$|[^가-힣]))'
const LATIN_NAME = "[A-Z][A-Za-z'.-]+(?:[ \\t][A-Z][A-Za-z'.-]+){0,3}"

const TITLES_AFTER = [
  '선생님',
  '선생',
  '교사',
  '교수님',
  '교수',
  '교장',
  '교감',
  '학생',
  '학부모',
  '님',
  '씨',
  '군',
  '양',
  '부장',
  '차장',
  '과장',
  '대리',
  '사원',
  '팀장',
  '원장',
  '실장',
  '주무관',
  '사무관',
  '장학사',
  '담임',
  '대표',
  '이사',
  '회장',
  '변호사',
  '의사',
  '간호사',
  '기자',
]
const TITLES_BEFORE = [
  '담임 교사',
  '담임 선생님',
  '담임',
  '교사',
  '선생님',
  '학생',
  '교수',
  '교장',
  '교감',
  '원장',
  '담당자',
  '담당',
  '학부모',
  '보호자',
  '주무관',
  '팀장',
  '과장',
  '대리',
  '사원',
  '기자',
  '작가',
]

/** Common words that stand before a title as a name would ("every student", "dear customer"). */
const NOT_NAMES: ReadonlySet<string> = new Set([
  '여러분',
  '고객',
  '회원',
  '부모',
  '학부모',
  '선생',
  '담임',
  '교장',
  '교감',
  '학생',
  '사용자',
  '관리자',
  '담당',
  '담당자',
  '보호자',
  '신청자',
  '참가자',
  '수강생',
  '원장',
  '부장',
  '과장',
  '대표',
  '이사',
  '손님',
  '형님',
  '누님',
  '어머',
  '아버',
  '할머',
  '할아버',
  '장모',
  '사모',
  '주인',
  '교수',
  '동료',
  '친구',
  '모든',
  '우리',
  '이번',
  '이전',
  '이후',
  '이상',
  '이하',
  '저희',
  '각각',
  '해당',
  '신입',
  '전체',
  '모두',
  '반장',
  '회장',
  '기사',
  '간호',
  '의사',
  '작가',
  '저자',
  '판사',
  '검사',
  '변호',
  '사장',
  '하나',
  '주님',
  '하나님',
  '부처',
  '선배',
  '후배',
  '동생',
  '언니',
  '오빠',
  '누나',
  '아들',
  '남편',
  '아내',
  '부인',
  '여사',
  '교육',
  '수업',
  '신규',
  '기간제',
  '정교사',
  '보건',
  '영양',
  '사서',
  '상담',
  '진로',
  '체육',
  '음악',
  '미술',
  '국어',
  '영어',
  '수학',
  '과학',
  '사회',
  '도덕',
  '기술',
  '가정',
  '한문',
  '다른',
  '어느',
  '어떤',
  '같은',
  '현직',
  '예비',
  '초등',
  '중등',
  '고등',
  '대학',
  '특수',
  '원어민',
  '외국인',
  '일반',
  '동아리',
  '전학',
  '졸업',
  '재학',
  '입학',
  '학교',
  '우수',
  '모범',
  '지도',
  '전담',
  '방과',
  '보조',
  '실습',
  '교생',
])

/** Words that follow a name label without being a name ("name: write here", "name and ..."). */
const NOT_LABELLED_NAMES: ReadonlySet<string> = new Set([
  '쓰기',
  '없음',
  '미정',
  '기재',
  '작성',
  '입력',
  '확인',
  '서명',
  '날인',
  '생략',
  '또는',
  '기입',
  '표시',
  '변경',
  '등록',
  '순서',
  '목록',
  '란에',
  '칸에',
  ...[...WORD_KIND.keys()],
])

const PARTICLE_ENDINGS = /[은는이가을를의도와과께]$/

/** A label word or header, alone or with one particle after it, is never a name. */
function isLabelWordLike(value: string): boolean {
  const known = (v: string): boolean => {
    const key = foldWord(v)
    return WORD_KIND.has(key) || NAME_HEADER_SET.has(key)
  }
  return known(value) || (PARTICLE_ENDINGS.test(value) && known(value.slice(0, -1)))
}

/** A value's label pattern: the label words, then optional brackets, then a separator. */
function labelled(kind: SensitiveKind, value: string, end: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z])(?:${alternation(LABEL_WORDS[kind])})` +
      '(?:[ \\t]*[(（][^()（）\\n]{0,12}[)）])?' +
      `(?:\\s*[:：=]\\s*|\\s+)(?<v>${value})${end}`,
    'gd',
  )
}

// ---------------------------------------------------------------------------
// Value shapes for labelled values (also used for the piece after a label)
// ---------------------------------------------------------------------------

const NUMBER_END = '(?![0-9A-Za-z])'
const DATE =
  `(?:\\d{4}|\\d{2})[ \\t]*[./년-][ \\t]*\\d{1,2}[ \\t]*[./월-][ \\t]*\\d{1,2}(?:[ \\t]*일|\\.)?` +
  '|\\d{8}|\\d{6}'

interface ValueShape {
  value: string
  end: string
}

const VALUE_SHAPES: Readonly<Record<SensitiveKind, ValueShape>> = {
  'resident-number': { value: `\\d{6}[ \\t]*${DASH}?[ \\t]*[\\d*]{7}`, end: NUMBER_END },
  passport: { value: '[A-Z]\\d{3}[A-Z]\\d{4}|[A-Z]{1,2}\\d{6,9}', end: NUMBER_END },
  'driver-license': {
    value:
      `(?:${REGION})[ \\t]?\\d{2}[ -]?\\d{6}[ -]?\\d{2}` +
      '|\\d{2}[ -]?\\d{2}[ -]?\\d{6}[ -]?\\d{2}',
    end: NUMBER_END,
  },
  account: { value: '\\d(?:[ -]?\\d){7,15}', end: NUMBER_END },
  card: { value: '\\d(?:[ -]?[\\d*]){12,18}', end: NUMBER_END },
  phone: { value: '\\+?\\(?\\d(?:[ ().-]{0,2}\\d){6,14}', end: NUMBER_END },
  email: {
    value: '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}',
    end: '(?![A-Za-z0-9-])',
  },
  address: { value: '[^\\n\\t|]{2,100}', end: '' },
  name: {
    value: `[가-힣]{2,5}|${HAN_IDEOGRAPH}{2,4}|${LATIN_NAME}`,
    end: NAME_END,
  },
  'birth-date': { value: DATE, end: '(?![0-9])' },
  'id-number': { value: '[A-Za-z]{0,3}-?\\d[\\dA-Za-z-]{1,19}', end: NUMBER_END },
  vehicle: {
    value: `(?:(?:${REGION})[ \\t]?)?\\d{2,3}[ \\t]?[가-힣][ \\t]?\\d{4}`,
    end: '(?!\\d)',
  },
}

const LABELLED: ReadonlyArray<readonly [SensitiveKind, RegExp]> = (
  Object.keys(VALUE_SHAPES) as SensitiveKind[]
).map((kind) => [kind, labelled(kind, VALUE_SHAPES[kind].value, VALUE_SHAPES[kind].end)] as const)

const AFTER_LABEL: Readonly<Record<SensitiveKind, RegExp>> = Object.fromEntries(
  (Object.keys(VALUE_SHAPES) as SensitiveKind[]).map((kind) => [
    kind,
    new RegExp(`^\\s*(?<v>${VALUE_SHAPES[kind].value})${VALUE_SHAPES[kind].end}`, 'd'),
  ]),
) as Record<SensitiveKind, RegExp>

/** Where an address after its label stops: a wide gap, or another kind's label word. */
const ADDRESS_STOP = new RegExp(
  `\\s{2,}|[\\s,;/]*(?<!\\d)\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}(?!\\d)|[\\s,;/]+(?:${alternation(
    (Object.keys(LABEL_WORDS) as SensitiveKind[])
      .filter((k) => k !== 'address' && k !== 'account')
      .flatMap((k) => LABEL_WORDS[k]),
  )})(?![가-힣])`,
)

function digitCount(text: string): number {
  return text.replace(/\D/g, '').length
}

/**
 * The value a rule's match really stands for, trimmed at the end, or null
 * when the match is not a candidate after all.
 */
function finishValue(kind: SensitiveKind, value: string, labelledValue: boolean): string | null {
  switch (kind) {
    case 'name': {
      let v = value
      if (/^[가-힣]+$/.test(v) && v.length >= 4 && PARTICLE_ENDINGS.test(v)) v = v.slice(0, -1)
      if (NOT_NAMES.has(v) || isLabelWordLike(v)) return null
      if (labelledValue && NOT_LABELLED_NAMES.has(foldWord(v))) return null
      return v
    }
    case 'id-number': {
      const v = value.replace(/-+$/, '')
      return digitCount(v) >= 3 ? v : null
    }
    case 'account': {
      const n = digitCount(value)
      return n >= 8 && n <= 16 ? value : null
    }
    case 'phone': {
      const n = digitCount(value)
      return n >= 7 && n <= 15 ? value : null
    }
    case 'card': {
      const n = digitCount(value.replace(/\*/g, '0'))
      return n >= 13 && n <= 19 ? value : null
    }
    case 'address': {
      if (!labelledValue) return value
      const stop = ADDRESS_STOP.exec(value)
      const line = stop ? value.slice(0, stop.index) : value
      const exact = exactAddressEnd(line)
      const v = (exact === null ? line : line.slice(0, exact)).replace(/[\s,.;:]+$/, '')
      return v.length >= 2 ? v : null
    }
    default:
      return value
  }
}

// ---------------------------------------------------------------------------
// Unlabelled shapes
// ---------------------------------------------------------------------------

interface Rule {
  kind: SensitiveKind
  re: RegExp
  /** the value to keep from a match, or null to drop it; the match itself by default */
  accept?: (value: string, m: RegExpExecArray) => string | null
}

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

const ADMIN = `(?:[가-힣]{1,10}(?:특별자치시|특별자치도|특별시|광역시|도|시|군|구|읍|면)|${REGION})`
const LOT = '[ \\t]?\\d{1,5}(?:-\\d{1,5})?'

const RULES: readonly Rule[] = [
  {
    kind: 'resident-number',
    re: new RegExp(
      '(?<!\\d)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])' +
        `(?:[ \\t]*${DASH}[ \\t]*\\d|[ \\t]?[1-8])[\\d*\\u25CFxX]{6}(?![\\d*\\u25CFxX])`,
      'gd',
    ),
  },
  {
    kind: 'passport',
    re: /(?<![A-Za-z0-9])(?:[A-Z]\d{8}|[A-Z]\d{3}[A-Z]\d{4})(?![A-Za-z0-9])/dg,
  },
  {
    kind: 'driver-license',
    re: new RegExp(
      `(?<!\\d)(?:(?:${REGION})[ \\t]?\\d{2}[ -]\\d{6}[ -]\\d{2}|\\d{2}[ -]\\d{2}[ -]\\d{6}[ -]\\d{2})(?!\\d)`,
      'gd',
    ),
  },
  {
    kind: 'account',
    re: /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,3})?(?![\d-])/dg,
    accept: (v) => {
      const n = digitCount(v)
      return n >= 10 && n <= 14 ? v : null
    },
  },
  { kind: 'card', re: /(?<![\d*])\d{4}([ -])[\d*]{4}\1[\d*]{4}\1\d{4}(?![\d*])/dg },
  { kind: 'card', re: /(?<!\d)\d{4}([ -])\d{6}\1\d{4,5}(?!\d)/dg },
  {
    kind: 'card',
    re: /(?<!\d)\d{13,19}(?!\d)/dg,
    accept: (v) => (luhn(v) ? v : null),
  },
  {
    kind: 'phone',
    re: /(?<![\d+])01[016789][ \t.-]?\d{3,4}[ \t.-]?\d{4}(?!\d)/dg,
  },
  {
    kind: 'phone',
    re: /(?<![\d+])(?:\(0\d{1,2}\)[ \t]?|0(?:2|[3-6][1-5]|70|50\d|80)[ \t.-]?)\d{3,4}[ \t.-]?\d{4}(?!\d)/dg,
  },
  { kind: 'phone', re: /(?<![\d-])1[568]\d{2}-\d{4}(?![\d-])/dg },
  {
    kind: 'phone',
    re: /(?<![\w+])\+\d{1,3}(?:[ \t.-]?\(\d{1,4}\))?(?:[ \t.-]?\d{1,5}){2,5}(?!\d)/dg,
    accept: (v) => {
      const n = digitCount(v)
      return n >= 8 && n <= 15 ? v : null
    },
  },
  {
    kind: 'email',
    re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/dg,
  },
  {
    // road-name address: optional administrative units, a road, a building number
    kind: 'address',
    re: new RegExp(
      `(?<![가-힣0-9])(?<admin>(?:${ADMIN}[ \\t]+){0,4})(?<road>[가-힣0-9]+(?:대로|로|길))${LOT}` +
        `(?:번길${LOT})?(?!\\d)` +
        '(?:[ \\t]*,?[ \\t]*(?:[가-힣A-Za-z0-9]+동[ \\t]*)?\\d{1,5}호)?' +
        '(?:[ \\t]*\\([^()\\n]{1,30}\\))?',
      'gd',
    ),
    accept: (v, m) => {
      // without a city or district in front, a road of one syllable before its suffix is an ordinary word
      if (m.groups?.admin) return v
      const road = (m.groups?.road ?? '').replace(/(?:대로|로|길)$/, '')
      return road.length >= 2 ? v : null
    },
  },
  {
    // lot-number address after at least one administrative unit
    kind: 'address',
    re: new RegExp(
      `(?<![가-힣0-9])(?:${ADMIN}[ \\t]+){1,4}[가-힣0-9]+(?:동|리|가)${LOT}(?:[ \\t]?번지)?(?!\\d)`,
      'gd',
    ),
  },
  {
    // lot-number address that says so
    kind: 'address',
    re: new RegExp(`(?<![가-힣0-9])[가-힣0-9]+(?:동|리|가)${LOT}[ \\t]?번지`, 'gd'),
  },
  {
    // a name before a title or honorific ("<name> teacher", "<name>-nim")
    kind: 'name',
    re: new RegExp(
      `(?<![가-힣0-9])(?<v>${KOREAN_NAME})[ \\t]?(?:${alternation(TITLES_AFTER)})`,
      'gd',
    ),
    accept: (v) => finishValue('name', v, false),
  },
  {
    // a name after a title ("homeroom teacher <name>", "student <name> + particle")
    kind: 'name',
    re: new RegExp(
      `(?<![가-힣])(?:${alternation(TITLES_BEFORE)})[ \\t]+(?<v>${KOREAN_NAME})${NAME_END}`,
      'gd',
    ),
    accept: (v) => finishValue('name', v, false),
  },
  {
    kind: 'vehicle',
    re: new RegExp(
      `(?<!\\d)(?:(?:${REGION})[ \\t]?)?\\d{2,3}[ \\t]?[${PLATE}][ \\t]?\\d{4}(?!\\d)`,
      'gd',
    ),
  },
]

// ---------------------------------------------------------------------------
// Running the rules
// ---------------------------------------------------------------------------

/** Own copies of the exact address shapes, so reading a label's line never disturbs a running scan. */
const EXACT_ADDRESS: readonly Rule[] = RULES.filter((r) => r.kind === 'address').map((r) => ({
  ...r,
  re: new RegExp(r.re.source, r.re.flags),
}))

/** Where the earliest exact address in a label's line ends, or null when the line has none. */
function exactAddressEnd(line: string): number | null {
  let best: [number, number] | null = null
  for (const rule of EXACT_ADDRESS) {
    rule.re.lastIndex = 0
    for (let m = rule.re.exec(line); m; m = rule.re.exec(line)) {
      if (m[0].length === 0) rule.re.lastIndex++
      if (rule.accept && !rule.accept(m[0], m)) continue
      if (!best || m.index < best[0]) best = [m.index, m.index + m[0].length]
      break
    }
  }
  return best ? best[1] : null
}

interface Hit {
  kind: SensitiveKind
  start: number
  end: number
}

function valueSpan(m: RegExpExecArray): [number, number] {
  const span = m.indices?.groups?.v ?? m.indices?.[0]
  return span ? [span[0], span[1]] : [m.index, m.index + m[0].length]
}

function collect(
  out: Hit[],
  text: string,
  kind: SensitiveKind,
  re: RegExp,
  accept: (value: string, m: RegExpExecArray) => string | null,
): void {
  re.lastIndex = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) re.lastIndex++
    const [start, end] = valueSpan(m)
    const value = accept(text.slice(start, end), m)
    if (value) out.push({ kind, start, end: start + value.length })
  }
}

function hitsIn(text: string, announced: SensitiveKind | null): Hit[] {
  const hits: Hit[] = []
  for (const rule of RULES) collect(hits, text, rule.kind, rule.re, rule.accept ?? ((v) => v))
  for (const [kind, re] of LABELLED)
    collect(hits, text, kind, re, (v) => finishValue(kind, v, true))
  if (announced) {
    const m = AFTER_LABEL[announced].exec(text)
    if (m) {
      const [start, end] = valueSpan(m)
      const value = finishValue(announced, text.slice(start, end), true)
      if (value) hits.push({ kind: announced, start, end: start + value.length })
    }
  }
  return hits
}

/** The first index in `kept` (sorted by start, no overlaps) whose start is at or after `start`. */
function lowerBound(kept: readonly Hit[], start: number): number {
  let lo = 0
  let hi = kept.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (kept[mid].start < start) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Keep hits without overlaps, more specific kinds first; an address comes last and is cut short instead of dropped. */
function resolve(text: string, hits: Hit[]): Hit[] {
  hits.sort(
    (a, b) =>
      PRIORITY[a.kind] - PRIORITY[b.kind] ||
      a.start - b.start ||
      b.end - b.start - (a.end - a.start),
  )
  const kept: Hit[] = []
  for (const hit of hits) {
    const i = lowerBound(kept, hit.start)
    const before = kept[i - 1]
    const after = kept[i]
    if (before && before.end > hit.start) continue
    let end = hit.end
    if (after && after.start < end) {
      if (hit.kind !== 'address') continue
      end = hit.start + text.slice(hit.start, after.start).replace(/[\s,.;:(]+$/, '').length
      if (end - hit.start < 2) continue
    }
    kept.splice(i, 0, { kind: hit.kind, start: hit.start, end })
  }
  return kept
}

/**
 * The candidates in the given pieces, in piece order then position. A cell's
 * `header`, or else a piece before it that is only a label word, makes the
 * cell's value a candidate of the kind it names.
 */
export function detectSensitive<L>(pieces: Iterable<TextPiece<L>>): SensitiveCandidate<L>[] {
  const out: SensitiveCandidate<L>[] = []
  let announced: SensitiveKind | null = null
  for (const piece of pieces) {
    const text = piece.text
    const kind = headerKind(piece.header) ?? announced
    for (const hit of resolve(text, hitsIn(text, kind))) {
      out.push({
        kind: hit.kind,
        start: hit.start,
        end: hit.end,
        value: text.slice(hit.start, hit.end),
        location: piece.location,
      })
    }
    announced = labelWordKind(text)
  }
  return out
}
