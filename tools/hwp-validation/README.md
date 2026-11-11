# HWP·HWPX 저장 보존 검사

현재 엔진과 앱의 기존 저장 보정 함수를 사용해, 수정하지 않고 저장한 결과와 요청한 글을 수정하고 저장한 결과를 따로 검사한다. 한컴의 출력과 비교하는 도구는 아니다. 통과해도 한컴 호환성·모든 글꼴·전체 서식의 일치를 보증하지 않는다.

## 도입 출처와 변경

검토한 원본은 [gusdhks-wq/openoffice의 HWP 검증 브랜치](https://github.com/gusdhks-wq/openoffice/tree/test/hwp-hwpx-validation), 고정 커밋 `edb6f0af5895403cc640db13d2fad90b4b196fb8`이다. 원본 저장소의 Apache-2.0 라이선스에 따라 `run.mjs`·`layout.mjs`·`layout.test.mjs`의 검사 방식과 코드를 수정해 도입했다. BinData 검사는 원본 `inspect-assets.py`의 압축 해제 후 비교 방식을 참고했다. 이 저장소의 LICENSE·NOTICE를 유지한다.

원본의 예전 엔진 고정값을 그대로 바꾸어 통과시키지 않고, 실행자가 기대한 엔진 버전과 현재 manifest의 WASM 해시가 모두 맞아야 실행한다. 다음도 보완했다.

- Windows 경로·드라이브·디렉터리 링크를 확인하고, 저장소 안의 출력은 디렉터리를 만들기 전에 거절한다. 출력은 기존 부모 아래의 **새 디렉터리**여야 한다. 원본이나 이전 보고서를 덮어쓰지 않는다.
- 검사 중 만든 모든 WASM 문서를 성공·실패 시 해제한다. 부분적으로 읽힌 표 목록을 전체 검사로 판정하지 않는다.
- 그림 해시의 집합만 비교하지 않고 BinData의 이름과 내용을 함께 비교해, 서로 바뀐 그림도 잡는다.
- 좌표만 최대 0.5 CSS px의 오차를 허용한다. 글꼴·글자 크기·자간·색·표 인덱스·병합 범위·부모 표는 정확히 비교한다. 엔진 내부의 일시적인 글자/문단 스타일 번호는 비교에서 제외한다.
- 엔진의 생 export만 보지 않고 기존 `applySaveFixes`의 탭 폭·필드 종류·바탕쪽/메모 보존 경로를 재사용한다. 검사 전용 새 보정 규칙을 넣지 않는다.

## 실행

이미 설치된 개발 의존성을 사용한다. Rust·studio 재빌드나 AI 호출은 하지 않는다. 현재 검증한 엔진은 `0.9.0-ieum.28`이다.

```sh
npm run test:validation -w @genoffice/hwp
node tools/hwp-validation/run.mjs --engine-version 0.9.0-ieum.28 --synthetic --out ../outputs/hwp-validation-new
node tools/hwp-validation/run.mjs --engine-version 0.9.0-ieum.28 --manifest ../outputs/private-cases.json --out ../outputs/hwp-validation-private
```

합성 문서는 새 출력 디렉터리 안에 만든다. 사용자 manifest와 입력 문서는 저장소와 출력 디렉터리 밖에 있어야 한다. manifest의 상대 경로는 manifest가 있는 디렉터리를 기준으로 해석한다.

```json
{
  "cases": [
    { "id": "read-only-reference", "path": "sample.hwpx" },
    {
      "id": "body-and-table-edit",
      "path": "sample.hwp",
      "find": "unique original text",
      "replace": "replacement text",
      "tableEdit": { "table": 1, "row": 2, "col": 2, "text": "new value" }
    }
  ]
}
```

`find`와 `replace`를 생략하면 무편집 왕복과 잘못된 수정 요청의 거절을 검사한다. 지정한 본문은 정확히 한 번 존재해야 하고, 교체할 내용은 기존 플러그인이 허용하는 한 줄의 평문이어야 한다. 표 수정은 원래 내용이 있는 칸의 덮어쓰기 거절부터 확인하고, 명시적으로 덮어쓴 뒤 다른 칸이 유지되는지 확인한다.

`--artifacts`를 명시할 때만 수정본과 모든 쪽의 SVG를 비공개 출력 디렉터리에 쓴다. 기본 출력은 본문·문서 경로·좌표 원문·그림을 싣지 않는 `report.json`과 현재 저장 보정 코드의 묶음이다. 단, 사용자가 고르는 사례 ID도 공개할 때는 비식별 값이어야 한다.

## 판정과 범위

- 종료 코드 0: 모든 사례의 필수 검사 통과. 1: 하나 이상의 사례 실패. 2: 설정·입력 명세·엔진 식별 오류. 원본의 엔진 버전으로 실행한 과거 통과 결과를 현재 결과로 재사용하지 않는다.
- 원본 파일 해시·크기·수정 시각, 모든 표 셀과 병합 및 부모 관계, 공개 레이아웃 API가 주는 글과 개체의 속성·좌표, 쪽 수, BinData 이름·해제한 내용, 전 쪽 SVG 생성을 확인한다.
- 보고서의 레이아웃 오차는 같은 엔진의 저장 전후 비교다. 한컴 좌표·화면 글꼴·픽셀·API에 없는 속성·참조가 BinData 밖인 자원 전체를 검사한 결과가 아니다.
- 기본 한도는 문서 128MiB·200쪽, 그림 한 항목 64MiB다. `--max-pages`는 최대 1,000쪽, `--tolerance`는 0~0.5 CSS px다. 한도를 넘은 문서를 검사 완료로 처리하지 않는다.
- 새 탭의 폭을 정해야 하면 headless 도구가 값을 추측하지 않는다. manifest의 `measuredTabs`에 실제 편집기가 얻은 `TabSpot`과 `width/type/fill`을 함께 제공해야 한다. 없거나 모호하면 `TAB_MEASUREMENTS_REQUIRED`로 실패한다. 이 검증 도구의 엄격한 거절을 현재 앱의 저장 정책이 바뀐 것으로 해석하지 않는다.
- 렌더된 값 자체가 같아도 누락 글꼴의 대체 결과가 한컴과 다를 수 있다. 사설 문자는 확인 경고이며 글리프가 없다는 증거로 사용하지 않는다.
- 실제 디스크 저장·백업 실패·실행 취소·암호 문서·모바일·Android·공식 한컴은 별도의 검증 범위다. 현재 `apps/hwp/tests/save-flow.test.ts`·`section-tails.test.ts`·`tab-widths.test.ts`·`field-kinds.test.ts`·`memos.test.ts` 등과 기존 GUI 검사를 대신하지 않는다.

검사 도구는 명시적으로 실행할 때만 문서를 다시 열고 레이아웃을 비교하므로 일상적인 열기·편집·저장의 비용은 늘지 않는다. 개발 검사 시간과 비공개 결과 파일은 추가된다. 원본 브랜치의 모바일 어댑터·React 내부 ref 기반 UI runner·독립 Python 의존성은 현재 데스크톱 구조에 그대로 넣지 않았다.
