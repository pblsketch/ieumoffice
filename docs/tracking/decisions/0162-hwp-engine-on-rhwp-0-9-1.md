# 0162 — 한글 엔진과 편집기를 rhwp v0.9.1 배포판에 맞춘다

## 맥락

한글 편집기와 한글 파일 읽기(`packages/file-parse`)는 rhwp `v0.9.0`(커밋 `c9095c5f6`, 2026-11-08) 위에 엔진 패치 41개와 편집기 패치 53개를 얹어 쓰고 있었다(결정 0116 이후 0042~0056을 더함).

2026-11-19 상위가 `v0.9.1` 태그를 냈다(`981ce66b4183b13c1a3b5907e04a8969c8c42034`). 중첩 표·저장 줄·바탕쪽·무늬 인덱스(#8978)·`/RhwpLineSegTags`(#8939)·Canvas2D 입력 시 호스트 글꼴 부분 재수집(#9168)·대화상자 작은 화면 스크롤(#9092, #9136) 개선과 함께, 우리가 상위에 낸 수정 PR #8922(PDF ToUnicode CMap 토큰·주석 파싱)와 #9093(예약 TTF 별칭 뒤의 실제 글꼴로 Canvas 표시 정책 판정, 이슈 #9077)이 들어갔다.

## 결정

**엔진과 편집기를 `v0.9.1` 태그에 고정하고, 상위에 들어간 패치를 뺀 뒤 나머지 패치를 그 위로 옮긴다.**

- **고정 방식.** `vendor/rhwp-core/package.json`의 `rhwp.tag`를 `v0.9.1`, `rhwp.commit`을 `981ce66b4183b13c1a3b5907e04a8969c8c42034`로, 버전을 `0.9.1-ieum.35`로 올린다(`package-lock.json`의 같은 항목도 함께 갱신). `apps/hwp/scripts/build-studio.mjs`의 `PINNED_COMMITS`에 같은 커밋을 더한다. 편집기 SDK(`@rhwp/editor`)는 npm `0.8.7`을 그대로 둔다(`npm/editor`의 JS 코드는 바뀌지 않았고 앱이 쓰는 메시지 형식도 같다).
- **엔진 패치는 41개에서 38개로 줄었다.**
  - 상위에 들어가 뺀 것(3개):
    - `0023-duplex-master-page-shift.patch`: 상위 `0fe9e0217`(`PageLayoutInfo::master_page_paper_frame`, `current_paper_origin_x`)과 `d7873c65b`(`master_page_apply_to`의 구역 정의 bit 29·30·31 파싱)가 같은 동작을 담아 뺐다. `engine-master-page-duplex.test.ts`가 그대로 통과한다.
    - `0044-cmap-range-entries-across-lines.patch`와 `0049-cmap-range-comments.patch`: 우리가 낸 상위 PR #8922가 `v0.9.1`에 들어가 뺐다. `engine-pdf-wrapped-cmap.test.ts`가 그대로 통과한다.
  - 상위 변경에 맞춰 옮긴 것(4개):
    - `0005`: `whole_fit.rs`의 import 목록에 `preceding_stored_line_span`과 함께 `preceding_stored_vpos`를 유지한다.
    - `0029`: `state.rs`에 상위가 더한 `stored_boundary_crossed_by_overflow` 뒤에 `current_column_crossed_unhonored_stored_reset`을 둔다.
    - `0040`: 상위가 #9079로 도형 캡션(`Control::Shape`)의 저장 줄 없는 캡션 합성을 더 넓게(차트·OLE 포함) 구현해 우리 도형 갈래는 뺐다. 또한 상위 #8939가 `/RhwpLineSegTags` 없는 `.hwp`에서 bit 31을 지우므로, 예전 엔진이 캡션 줄 없이 저장한 `.hwp`의 글자처럼 취급 그림 줄 보정은 `seg.tag` bit 31뿐 아니라 캡션 문단 줄이 방금 합성된 경우에도 적용되게 보완했다(한컴이 저장한 문서는 캡션 줄이 있어 건드리지 않는다).
    - `0051`: 상위가 `layout.rs`에 더한 `has_side_by_side_columns` 판정을 `body_wide_reserved`에 유지하면서 `page_head_bottom`은 단 하나에만 글이 있는 짧은 쪽에서도 그대로 받아 구분선 시작을 맞춘다.
  - 나머지 34개는 `v0.9.1` 위로 그대로 옮겼다.
- **편집기 패치는 53개다(1개 제거, 1개 분리).**
  - `studio-source-font-alias`는 상위 PR #9093이 `src/core/font-substitution.ts`의 `substituteCssFontFamily`에 같은 처리를 넣어 뺐다.
  - `substituteCssFontFamily`가 `wasm-bridge.ts`에서 `font-substitution.ts`로 옮겨감에 따라 `studio-equation-fonts`는 `wasm-bridge.ts`의 `installEquationFonts()` 설치를 맡고, `substituteCssFontFamily` 안의 수식 글꼴 통과는 `studio-equation-fonts-subst`로 분리했다.
  - `studio-table-props-border-bg`의 `ieumKeepUnchangedTableLook`은 상위 #8978(무늬 종류 `-1` = 없음, `0~5` = 가로줄 등)에 맞춰 `0`을 없음이 아닌 가로줄 무늬로 다루게 고쳤다.

## 택하지 않은 것

- **`caption-footnote-flow-ieum17.hwp`에서 bit 31을 되살리는 패치를 넣는다.** 상위 #8939는 한컴이 실제 저장 줄에 싣는 bit 31을 합성 줄로 오인하지 않으려고 `/RhwpLineSegTags`가 있는 구역에서만 bit 31을 합성 표지로 읽는다. 구형 엔진이 만든 파일에 bit 31을 무조건 되살리면 #8939의 보정이 무너진다. 그림 줄 높이는 `0040`의 캡션 합성 판정으로 고쳐 넘침·겹침을 막고, 구형 픽스처에서 표 22가 6쪽 아래로 밀려 9줄 각주가 0039 규칙대로 7쪽으로 이월되는 것만 그 구형 픽스처 시험에서 허용한다(원본 HWPX와 `v0.9.1`이 저장한 `.hwp`는 전처럼 같은 쪽을 엄격히 지킨다).
- **`@rhwp/editor` npm 패키지를 0.9.1로 함께 올린다.** `npm/editor`의 전송·프로토콜 코드는 0.8.7과 달라진 것이 없고 `package-lock.json` 변경을 최소화한다.

## 결과

- 엔진 WASM은 28,008,178 바이트(약 28.0 MB), 링크된 Rust 크레이트는 225개(모두 허용형 라이선스)이며 `apps/shell/build/THIRD-PARTY-NOTICES.txt`를 갱신했다.
- 사용자 문서 묶음(`F:\ieum-scratch\hwpx-overlap`, 34개)을 `v0.9.0` 엔진과 `v0.9.1` 엔진으로 비교한 결과 쪽 수 차이 0건, 본문 텍스트 겹침 0건(`0 → 0`)이다.
- 시험 통과:
  - `@genoffice/hwp` 단위·엔진·패치 시험 전체(137개 파일, 2,247개 테스트 — `studio-table-props-border-bg`의 `patternType: 0` 단위 시험 추가 포함)
  - `@genoffice/docx2hwp` 89개, `@genoffice/file-parse` HWP 21개, `@genoffice/cli` HWP 114개
- 새 엔진에 맞춰 바꾼 시험:
  - `engine-memos.test.ts`: 메모 없는 문서 두 종의 저장 바이트 기준 해시를 `v0.9.1` 직렬화 결과로 갱신(`format-copy-table.hwp` 원본 무편집 `.hwp` 해시는 동일).
  - `dialog-theme.test.ts`: 상위 `v0.9.1`(#9092, #9136)이 `.dialog-wrap`·`.about-dialog`·`.cs-left-col > .dialog-body`에 더한 스크롤·플렉스 규칙 8건이 우리 스킨의 같은 규칙과 일치함을 `allowed`에 반영.
  - `engine-layout.test.ts`: `/RhwpLineSegTags` 없이 구형 엔진이 저장한 `caption-footnote-flow-ieum17.hwp` 시험에서만 0039의 표 셀 각주 다음 쪽 이월을 허용.
