import { describe, expect, it } from 'vitest'
import {
  detectSensitive,
  isNameColumnHeader,
  labelWordKind,
  type SensitiveCandidate,
} from '../src/sensitive-detect'
import { SENSITIVE_KINDS, type SensitiveKind } from '../src/sensitive-kinds'

/**
 * The rules-only finder. It runs on the reader's PC and calls nothing: every
 * candidate comes from the shape of the text. It leans toward too many — a
 * candidate the reader dismisses costs a click, one it misses goes to the
 * model.
 */

function found(text: string): Array<[SensitiveKind, string]> {
  return detectSensitive([{ text, location: 0 }]).map((c) => [c.kind, c.value])
}

function kindsIn(text: string): SensitiveKind[] {
  return detectSensitive([{ text, location: 0 }]).map((c) => c.kind)
}

/** One kind, positives and negatives: each positive must yield that value as that kind. */
function expectFinds(kind: SensitiveKind, text: string, value: string): void {
  expect(found(text), text).toContainEqual([kind, value])
}

function expectNotFinds(kind: SensitiveKind, text: string): void {
  expect(kindsIn(text), text).not.toContain(kind)
}

describe('the candidate shape', () => {
  it('gives kind, offsets into the piece, the value and the piece location', () => {
    const pieces = [
      { text: '안녕하세요', location: { cell: 'A1' } },
      { text: '연락처: 010-1234-5678 입니다', location: { cell: 'B2' } },
    ]
    const result = detectSensitive(pieces)
    expect(result).toHaveLength(1)
    const c = result[0] as SensitiveCandidate<{ cell: string }>
    expect(c.kind).toBe('phone')
    expect(c.value).toBe('010-1234-5678')
    expect(pieces[1].text.slice(c.start, c.end)).toBe(c.value)
    expect(c.location).toEqual({ cell: 'B2' })
  })

  it('is the same for the same input', () => {
    const text =
      '성명: 홍길동, 전화 010-1234-5678, hong@example.com, 서울특별시 종로구 세종대로 209'
    expect(detectSensitive([{ text, location: 1 }])).toEqual(
      detectSensitive([{ text, location: 1 }]),
    )
  })

  it('orders candidates by piece then position, with no overlaps', () => {
    const text = '이메일 a@b.co 전화 02-123-4567 주민 900101-1234567'
    const result = detectSensitive([
      { text, location: 'p1' },
      { text: '홍길동 님', location: 'p2' },
    ])
    const p1 = result.filter((c) => c.location === 'p1')
    for (let i = 1; i < p1.length; i++) expect(p1[i].start).toBeGreaterThanOrEqual(p1[i - 1].end)
    expect(result[result.length - 1].location).toBe('p2')
  })

  it('finds nothing in plain prose', () => {
    expect(found('오늘 수업은 3교시에 시작합니다. 준비물은 공책과 연필입니다.')).toEqual([])
    expect(found('The meeting starts at 10:30 on 2024-11-12 in room 301.')).toEqual([])
    expect(found('')).toEqual([])
  })

  it('has twelve kinds with stable ids', () => {
    expect(SENSITIVE_KINDS).toEqual([
      'resident-number',
      'passport',
      'driver-license',
      'account',
      'card',
      'phone',
      'email',
      'address',
      'name',
      'birth-date',
      'id-number',
      'vehicle',
    ])
  })
})

describe('resident and foreigner registration numbers', () => {
  it('finds them with or without the hyphen, and masked ones', () => {
    expectFinds('resident-number', '주민등록번호 900101-1234567', '900101-1234567')
    expectFinds('resident-number', '번호는 9001011234567 이다', '9001011234567')
    expectFinds('resident-number', '외국인등록번호: 850315-5123456', '850315-5123456')
    expectFinds('resident-number', '900101-1******', '900101-1******')
    expectFinds('resident-number', '900101 - 2345678', '900101 - 2345678')
  })

  it('leaves numbers of another shape alone', () => {
    expectNotFinds('resident-number', '901301-1234567') // no 13th month
    expectNotFinds('resident-number', '900101-12345678') // too long
    expectNotFinds('resident-number', '9001019234567') // no hyphen and not 1-8
    expectNotFinds('resident-number', '12345-1234567')
  })
})

describe('passport numbers', () => {
  it('finds the old and new Korean shapes and labelled ones', () => {
    expectFinds('passport', '여권 M12345678', 'M12345678')
    expectFinds('passport', 'M123A4567 발급', 'M123A4567')
    expectFinds('passport', '여권번호: AB1234567', 'AB1234567')
    expectFinds('passport', 'Passport No. X1234567', 'X1234567')
  })

  it('leaves short codes alone', () => {
    expectNotFinds('passport', '제품 A12345')
    expectNotFinds('passport', 'M1234567 모델')
    expectNotFinds('passport', 'm12345678')
  })
})

describe('driver license numbers', () => {
  it('finds the numbered and region shapes', () => {
    expectFinds('driver-license', '11-12-345678-90', '11-12-345678-90')
    expectFinds('driver-license', '면허 서울 12-345678-90', '서울 12-345678-90')
    expectFinds('driver-license', '운전면허번호: 111234567890', '111234567890')
  })

  it('leaves other number groups alone', () => {
    expectNotFinds('driver-license', '111234567890')
    expectNotFinds('driver-license', '11-12-3456-90')
  })
})

describe('account numbers', () => {
  it('finds labelled ones and bank-shaped ones', () => {
    expectFinds('account', '계좌번호: 110-123-456789', '110-123-456789')
    expectFinds('account', '국민은행 123456-01-234567', '123456-01-234567')
    expectFinds('account', '신한 110123456789', '110123456789')
    expectFinds('account', '입금은 3333-01-1234567 로', '3333-01-1234567')
  })

  it('leaves dates, short groups and unlabelled long digits alone', () => {
    expectNotFinds('account', '2024-11-12')
    expectNotFinds('account', '12-34-56')
    expectNotFinds('account', '주문번호 1234567890')
    expectNotFinds('account', '은행 앱을 엽니다')
  })
})

describe('card numbers', () => {
  it('finds grouped, masked and Luhn-valid ones', () => {
    expectFinds('card', '1234-5678-9012-3456', '1234-5678-9012-3456')
    expectFinds('card', '4111 1111 1111 1111', '4111 1111 1111 1111')
    expectFinds('card', '카드 4111111111111111', '4111111111111111')
    expectFinds('card', '1234-56**-****-3456', '1234-56**-****-3456')
    expectFinds('card', '3782-822463-10005', '3782-822463-10005')
  })

  it('leaves Luhn-invalid runs and mixed groups alone', () => {
    expectNotFinds('card', '4111111111111112')
    expectNotFinds('card', '1234-5678 9012-3456')
    expectNotFinds('card', '1234-5678-9012')
  })
})

describe('phone numbers', () => {
  it('finds mobile, landline, representative and international numbers', () => {
    expectFinds('phone', '010-1234-5678', '010-1234-5678')
    expectFinds('phone', '01012345678로 연락', '01012345678')
    expectFinds('phone', '010 1234 5678', '010 1234 5678')
    expectFinds('phone', '02-123-4567', '02-123-4567')
    expectFinds('phone', '(02) 1234-5678', '(02) 1234-5678')
    expectFinds('phone', '031.123.4567', '031.123.4567')
    expectFinds('phone', '070-1234-5678', '070-1234-5678')
    expectFinds('phone', '1588-1234', '1588-1234')
    expectFinds('phone', '+82 10-1234-5678', '+82 10-1234-5678')
    expectFinds('phone', '+1 (415) 555-0123', '+1 (415) 555-0123')
    expectFinds('phone', '연락처 5551234567', '5551234567')
  })

  it('leaves dates, times, versions and short numbers alone', () => {
    expectNotFinds('phone', '2024-11-12')
    expectNotFinds('phone', '10:30-11:45')
    expectNotFinds('phone', '버전 0.10.1234')
    expectNotFinds('phone', '010-12-34')
    expectNotFinds('phone', '+1 23')
  })
})

describe('email addresses', () => {
  it('finds them', () => {
    expectFinds(
      'email',
      '메일: hong.gil-dong+tag@school.example.kr 로',
      'hong.gil-dong+tag@school.example.kr',
    )
    expectFinds('email', 'a_b@c.io', 'a_b@c.io')
  })

  it('leaves near misses alone', () => {
    expectNotFinds('email', 'user@localhost')
    expectNotFinds('email', '@mention')
    expectNotFinds('email', 'a@b')
  })
})

describe('addresses', () => {
  it('finds road-name addresses', () => {
    expectFinds('address', '서울특별시 종로구 세종대로 209', '서울특별시 종로구 세종대로 209')
    expectFinds('address', '집은 테헤란로 152 입니다', '테헤란로 152')
    expectFinds('address', '강남대로94길 10, 3층', '강남대로94길 10')
    expectFinds(
      'address',
      '경기도 성남시 분당구 판교역로 235 (삼평동)',
      '경기도 성남시 분당구 판교역로 235 (삼평동)',
    )
    expectFinds('address', '세종로 1-2 101동 1203호', '세종로 1-2 101동 1203호')
  })

  it('finds lot-number addresses', () => {
    expectFinds('address', '서울시 강남구 역삼동 123-45', '서울시 강남구 역삼동 123-45')
    expectFinds('address', '충청남도 공주시 신관동 12번지', '충청남도 공주시 신관동 12번지')
    expectFinds('address', '역삼동 123번지', '역삼동 123번지')
  })

  it('finds what follows an address label', () => {
    expectFinds('address', '주소: 부산 해운대구 우동 어딘가', '부산 해운대구 우동 어딘가')
    expectFinds('address', '주소 : 대구 중구 동성로 1  전화 02-123-4567', '대구 중구 동성로 1')
  })

  it('keeps the address when a phone number sits on the same line', () => {
    const result = found('주소: 서울시 종로구 세종대로 209 02-123-4567')
    expect(result).toContainEqual(['phone', '02-123-4567'])
    expect(
      result.some(([k, v]) => k === 'address' && v.startsWith('서울시 종로구 세종대로 209')),
    ).toBe(true)
  })

  it('leaves words ending in road syllables alone', () => {
    expectNotFinds('address', '진로 2차시 수업')
    expectNotFinds('address', '도로 3개')
    expectNotFinds('address', '역삼동 123')
    expectNotFinds('address', '주소창에 입력')
  })
})

describe('names', () => {
  it('finds the value of a name label', () => {
    expectFinds('name', '성명: 홍길동', '홍길동')
    expectFinds('name', '이름 김철수', '김철수')
    expectFinds('name', '성명(한글) : 남궁민수', '남궁민수')
    expectFinds('name', '작성자 이영희', '이영희')
    expectFinds('name', 'Name: Jane Doe', 'Jane Doe')
    expectFinds('name', '氏名：山田太郎', '山田太郎')
  })

  it('finds a name next to a title or honorific', () => {
    expectFinds('name', '홍길동 선생님께', '홍길동')
    expectFinds('name', '김철수님 안녕하세요', '김철수')
    expectFinds('name', '박민지 학생은', '박민지')
    expectFinds('name', '담임교사 최수진', '최수진')
    expectFinds('name', '학생 김철수는', '김철수')
    expectFinds('name', '학생 김철수에게', '김철수')
    expectFinds('name', '이민호 교사', '이민호')
    expectFinds('name', '정다은 씨', '정다은')
  })

  it('leaves common words before a title alone', () => {
    expectNotFinds('name', '학생 여러분')
    expectNotFinds('name', '고객님 감사합니다')
    expectNotFinds('name', '모든 학생')
    expectNotFinds('name', '우리 선생님')
    expectNotFinds('name', '이번 학생')
    expectNotFinds('name', '3학년 학생')
    expectNotFinds('name', '이름표를 붙입니다')
    expectNotFinds('name', '이름을 쓰세요')
    expectNotFinds('name', '성명 및 연락처')
  })

  it('finds a name in the piece after a label-only piece (a table row)', () => {
    const result = detectSensitive([
      { text: '성명', location: 'A1' },
      { text: '홍길동', location: 'B1' },
      { text: '생년월일', location: 'A2' },
      { text: '2010. 3. 5.', location: 'B2' },
    ])
    expect(result.map((c) => [c.kind, c.value, c.location])).toEqual([
      ['name', '홍길동', 'B1'],
      ['birth-date', '2010. 3. 5.', 'B2'],
    ])
  })

  it('does not carry a label across a piece that is not only the label', () => {
    const result = detectSensitive([
      { text: '성명을 적으세요', location: 'A1' },
      { text: '홍길동', location: 'B1' },
    ])
    expect(result).toEqual([])
  })
})

describe('the name column of a sheet', () => {
  it('knows the usual headers', () => {
    for (const header of [
      '성명',
      '이름',
      ' 학생 이름 ',
      '이름(한글)',
      '성명*',
      'Name',
      'full name',
      '氏名',
      '姓名',
    ]) {
      expect(isNameColumnHeader(header), header).toBe(true)
    }
  })

  it('leaves other headers alone', () => {
    for (const header of ['번호', '점수', '이름표', '반', '', 'Names list']) {
      expect(isNameColumnHeader(header), header).toBe(false)
    }
  })

  it('tells which kind a label word announces', () => {
    expect(labelWordKind('성명:')).toBe('name')
    expect(labelWordKind('연락처')).toBe('phone')
    expect(labelWordKind('학번')).toBe('id-number')
    expect(labelWordKind('생년월일')).toBe('birth-date')
    expect(labelWordKind('주소')).toBe('address')
    expect(labelWordKind('점수')).toBeNull()
  })
})

describe('birth dates', () => {
  it('finds a date next to a birth label', () => {
    expectFinds('birth-date', '생년월일: 2010.03.05', '2010.03.05')
    expectFinds('birth-date', '생일 2010년 3월 5일', '2010년 3월 5일')
    expectFinds('birth-date', '생년월일 100305', '100305')
    expectFinds('birth-date', '출생일 20100305', '20100305')
    expectFinds('birth-date', 'Date of birth: 2010-03-05', '2010-03-05')
  })

  it('leaves dates without a birth label alone', () => {
    expectNotFinds('birth-date', '제출일 2024.11.12')
    expectNotFinds('birth-date', '2010.03.05 개교')
    expectNotFinds('birth-date', '생일 파티')
  })
})

describe('student, staff and exam numbers', () => {
  it('finds a number next to the label', () => {
    expectFinds('id-number', '학번: 20231234', '20231234')
    expectFinds('id-number', '사번 A-10293', 'A-10293')
    expectFinds('id-number', '수험번호 12345-678', '12345-678')
    expectFinds('id-number', 'Student ID: S2023001', 'S2023001')
  })

  it('leaves the label without a number, and short numbers, alone', () => {
    expectNotFinds('id-number', '학번을 적으세요')
    expectNotFinds('id-number', '학번 1')
    expectNotFinds('id-number', '20231234')
  })
})

describe('vehicle plates', () => {
  it('finds the two- and three-digit shapes', () => {
    expectFinds('vehicle', '차량 12가 3456', '12가 3456')
    expectFinds('vehicle', '123나1234 주차', '123나1234')
    expectFinds('vehicle', '서울12가3456', '서울12가3456')
    expectFinds('vehicle', '차량12가3456', '12가3456')
  })

  it('leaves dates, floors and longer numbers alone', () => {
    expectNotFinds('vehicle', '12월 3456')
    expectNotFinds('vehicle', '3층 1234')
    expectNotFinds('vehicle', '12가34567')
    expectNotFinds('vehicle', '1가 3456')
  })
})

describe('an address after its label', () => {
  it('takes the exact road-name address and leaves the name after it', () => {
    const result = found('주소: 서울시 종로구 세종대로 209, 홍길동 선생님')
    expect(result).toEqual([
      ['address', '서울시 종로구 세종대로 209'],
      ['name', '홍길동'],
    ])
  })

  it('does not run on into the rest of the sentence', () => {
    const result = found('주소: 서울시 종로구 세종대로 209 학생 김철수는 2024-11-12에 제출했다')
    expect(result).toEqual([
      ['address', '서울시 종로구 세종대로 209'],
      ['name', '김철수'],
    ])
  })

  it('takes the exact lot-number address too', () => {
    expect(found('주소 : 서울시 강남구 역삼동 123-45 김철수님 댁')).toEqual([
      ['address', '서울시 강남구 역삼동 123-45'],
      ['name', '김철수'],
    ])
  })

  it('stops a free-form address at another candidate or a date', () => {
    expect(found('주소: 부산 해운대구 우동 어딘가, 홍길동 선생님')).toEqual([
      ['address', '부산 해운대구 우동 어딘가'],
      ['name', '홍길동'],
    ])
    expect(found('주소: 부산 해운대구 우동 어딘가 010-1234-5678')).toEqual([
      ['address', '부산 해운대구 우동 어딘가'],
      ['phone', '010-1234-5678'],
    ])
    expect(found('주소: 부산 해운대구 우동 어딘가 2024-11-12에 이사')).toEqual([
      ['address', '부산 해운대구 우동 어딘가'],
    ])
  })
})

describe('a table whose headers are on the row above', () => {
  it('reads each cell by the header of its column', () => {
    const result = detectSensitive([
      { text: '성명', location: 'A1' },
      { text: '학번', location: 'B1' },
      { text: '연락처', location: 'C1' },
      { text: '홍길동', location: 'A2', header: '성명' },
      { text: '20231234', location: 'B2', header: '학번' },
      { text: '01012345678', location: 'C2', header: '연락처' },
      { text: '김철수', location: 'A3', header: '성명' },
      { text: '20231235', location: 'B3', header: '학번' },
    ])
    expect(result.map((c) => [c.kind, c.value, c.location])).toEqual([
      ['name', '홍길동', 'A2'],
      ['id-number', '20231234', 'B2'],
      ['phone', '01012345678', 'C2'],
      ['name', '김철수', 'A3'],
      ['id-number', '20231235', 'B3'],
    ])
  })

  it('knows the wider name headers', () => {
    const result = detectSensitive([{ text: 'Jane Doe', location: 0, header: 'Student name' }])
    expect(result.map((c) => [c.kind, c.value])).toEqual([['name', 'Jane Doe']])
  })

  it('ignores a header that is not a label word', () => {
    expect(detectSensitive([{ text: '홍길동', location: 0, header: '점수' }])).toEqual([])
  })

  it('lets the header win over a label in the piece before', () => {
    const result = detectSensitive([
      { text: '학번', location: 'B1' },
      { text: '홍길동', location: 'A2', header: '성명' },
    ])
    expect(result.map((c) => [c.kind, c.value])).toEqual([['name', '홍길동']])
  })
})

describe('label words are not names', () => {
  it('leaves a label word after a title alone', () => {
    expect(found('보호자 연락처: 010-1234-5678')).toEqual([['phone', '010-1234-5678']])
    expect(kindsIn('담당 주소는 아래와 같다')).not.toContain('name')
    expect(kindsIn('학생 성명 란')).not.toContain('name')
  })
})
