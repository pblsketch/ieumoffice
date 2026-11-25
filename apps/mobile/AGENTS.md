# apps/mobile (`@genoffice/mobile`)

이음오피스의 Android·iOS 모바일 앱(`com.ieumoffice.mobile`, Tauri 2 Mobile)이다. 스마트폰·작은 태블릿(`<840px`)부터 큰 태블릿·폴드·DeX(`≥840px`)까지 한 화면에서 한글(`.hwp`/`.hwpx`)과 마크다운(`.md`/`.markdown`/`.txt`) 문서를 열고 고치며, AI 도우미를 함께 쓸 수 있다.

## 맡은 범위

- 모바일 렌더러(`src/renderer/`):
  - 반응형 셸(`shell/EditorShell.tsx`, `shell/useViewportLayout.ts`), 홈·바텀시트·AI 패널·미저장 전환 모달(`components/`), 설정·AI 연결·HWP 원본 백업 관리(`settings/SettingsScreen.tsx`), 종단 통합(`App.tsx`).
  - 편집기 호스트(`editors/MarkdownMobileEditor.tsx`, `editors/HwpMobileEditor.tsx`): 보기 우선 열기, 마크다운 인라인 그림 첨부, 한글 Canvas2D 강제 부팅(`dist/studio/`).
  - 편집기 등록표(`editors/registry.ts`, 형은 `editors/editorKind.ts`)와 형식 종류(`editors/hwpKind.tsx`, `editors/markdownKind.tsx`): 열기·저장·공유·복구 사본·AI 스킬·도구 막대·편집 화면을 종류마다 갖는다. `App.tsx`는 등록표에서 종류를 찾아 부르기만 한다. AI 실행과 AI 설정 상태는 `ai/useMobileAi.ts`, 설정 화면은 절마다 `settings/sections/*.tsx`.
  - 22개 언어 문구(`i18n/`), 토큰 전용 스타일(`styles/mobile-tokens.css`), OFL-1.1 한글 글꼴(`assets/fonts/`).
- Tauri 2 Rust 백엔드(`src-tauri/`):
  - 단일 활성 문서 세션·최근 목록·자동 복구·HWP 최초 덮어쓰기 전 백업(`src/storage/`). 형식 목록(`storage/session.rs`)에 1판 형식(pdf·html·xlsx·xlsm·xls·csv·epub·pptx)이 있고, 열 수 있는 형식 문지기(`mobile_set_openable_formats`)가 등록표에 없는 형식을 최근 목록에 넣기 전에 거절한다(`mobile.format.notOpenable`).
  - `packages/hwp5-wasm`(`rlib`) 직접 링크 기반 HWP 컨테이너 검사·암호/배포용 판정·변경 추적 제거·저장 보정(`src/hwp/`).
  - AES-256-GCM 봉인 저장소(`src/secrets/`)와 HTTPS 전용 AI 스트리밍·ChatGPT 공식 모바일 OAuth(`src/ai/`).
  - 로컬 모바일 플러그인(`src-tauri/plugins/tauri-plugin-ieum-mobile/`): Android Kotlin(SAF·FileProvider·Keystore·Custom Tabs) / iOS Swift(`UIDocumentPicker`·보안 북마크·`UIActivityViewController`·Keychain·`ASWebAuthenticationSession`) + 호스트 테스트 스텁.
- 네이티브 설정 주입(`native-config/{android,ios}/`, `scripts/apply-native-config.mjs`).

## 항상 지켜야 하는 것

- **단일 활성 문서**: 모바일 WebView OOM을 막기 위해 동시에 여는 문서는 최대 1개다. 미저장 상태에서 다른 문서로 넘어가거나 외부 열기 인텐트가 들어오면 반드시 확인 모달을 거친다.
- **Canvas2D 강제**: 모바일 한글 편집기는 `canvaskit-wasm`을 로드하지 않고 Canvas2D로만 부팅한다. `vite.config.ts`는 `apps/hwp/scripts/rhwp-patches.mjs`의 `rhwpPatches('sdk-scheme')`로 `tauri:` 프로토콜을 허용하고 `apps/hwp/public/studio`를 `dist/studio`로 복사한다.
- **원본 보호와 백업 게이트**: 암호·배포용 한글 문서는 저장과 편집본 공유를 모두 거절(`PASSWORD_PROTECTED`)하고 원본 공유(`mode: 'original'`)만 허용한다. 최초 덮어쓰기 전 백업이 실패하면(`BACKUP_FAILED`) 원본을 덮어쓰지 않는다.
- **보안과 요금 경로**: API 키와 OAuth 토큰은 Rust 봉인 저장소에만 두고 WebView로 원문을 내보내지 않는다. `IEUM_MOBILE_CHATGPT_CLIENT_ID`가 없는 릴리스 빌드에서는 ChatGPT 연결 카드를 숨긴다. `dev-chatgpt-loopback` 피처는 릴리스 빌드에서 컴파일하지 않는다. `auto` 선택은 API 키 제공자로 넘어가지 않는다.
- **디자인 시스템**(`docs/plans/mobile-design-system.md`, 결정 0165): 겉모습은 두 플랫폼에서 하나이고, 플랫폼별로는 동작만 가른다. 간격·글자 크기·터치 크기·움직임은 `mobile-tokens.css`의 `--m-*` 토큰으로만 쓴다(직접 px 값을 새로 적지 않는다. 글자 크기는 rem 토큰이라 OS 글자 크기를 따른다). 누를 영역은 `--m-hit`(48px) 이상이다. 창 크기는 `useViewportLayout`이 `<html data-window="compact|medium|expanded|large">`(600/840/1200px)와 `--m-kb`(키보드 높이)로 내보내고, 옆 패널 배치(`isTablet`)는 expanded부터다.
- **공용 껍데기 부품**(디자인 시스템 5.2·5.5·5.9·5.11): 뒤로 가기는 `shell/backStack.tsx`의 `useBackLayer` 하나로 쌓는다(시트 → 저장 안 함 확인 창 → 편집 모드 → 편집 화면·설정). 층마다 브라우저 기록 한 칸을 쓰고, Android 시스템 뒤로 가기(웹뷰 뒤로)가 `popstate`로 맨 위 층을 닫는다. 하단 시트는 `components/Sheet.tsx`(중간·크게 두 멈춤, 손잡이 끌기, 아래로 밀어 닫기, 키보드 위로 올라감), 알림은 앱 한 곳의 `components/Toast.tsx`(4초, 동작이 있으면 8초, 누르는 동안 멈춤). 편집 화면 상단 바는 주 단추 하나([편집] / [완료])이고, 저장 단추 대신 제목 아래 저장 상태(저장됨·저장 안 됨·저장 중)를 보이며 눌러 저장한다. [완료]는 바뀐 것이 있으면 원본에 저장한 뒤 보기로, 편집 중 뒤로 가기는 저장하지 않고 보기로 간다.
- **한글 흐름(읽기) 보기**(`editors/hwpFlow.ts`, `editors/HwpFlowView.tsx`, 결정 0165): rhwp 엔진의 HTML 내보내기(`exportSelectionHtml` 문단별, 표·그림은 `exportControlHtml`)로 화면 폭에 다시 흘린 문서를 만든다. 문단마다 `data-sec`·`data-para`를 붙인다(흐름 편집이 엔진 위치로 되돌리는 열쇠). 표는 엔진이 내보낸 뼈대(테두리·너비·채움·합친 칸)를 그대로 쓰고 칸 안은 칸 문단마다 다시 채운다. 내보낸 표 HTML은 빈 문단을 빠뜨려 엔진 위치로 되짚을 수 없어서다. 칸 문단에는 엔진의 칸 경로(`data-path`, `[{controlIndex, cellIndex, cellParaIndex}, ...]`, 겹표는 단계가 늘어난다)를 붙이고, `<td>`는 문서 순서가 엔진 칸 번호와 같다(합친 칸 포함, 시험 양식 52칸 확인). 칸 문단 안의 표·그림은 `exportControlHtml(구역, 문단, 칸 문단 경로, j)`를 j=0부터 오류가 날 때까지 불러 찾는다. 글상자와 그림 캡션은 그 개체의 "칸 0"으로 닿아서(`[{controlIndex, cellIndex: 0}]`) 표 칸과 같은 방식으로 보이고 고쳐진다. 표 캡션은 평면 칸 호출(`getCellParagraphCount(구역, 문단, 개체, 65534)` 등)로만 닿고 HTML로 못 내보내서 글자만(정렬·글꼴·크기) 보인다. 글머리표는 문단 속성(`headType: Bullet`)과 `getBulletList`로 찾아 `<p data-marker>`에 두고 CSS로 그린다(고칠 글에 섞이지 않게). 각주·미주는 `getFootnoteInfo`의 글을 그 문단 뒤에 읽기 전용으로, 머리말·꼬리말은 구역 처음·끝에 한 번 읽기 전용으로 둔다. `getHeaderFooter`가 준 문단·개체 번호로 머리말을 "칸 0"처럼(`[{controlIndex, cellIndex: 0}]`) 칸과 같이 그려서 안의 표·그림도 보인다. 머리말 목록은 평면 칸 호출이 받지 않아(표·글상자만 받는다) 경로 호출로 돌려 부르고(`pathCallsOnly`), 편집 주소(`data-sec`·`data-path` 등)는 모두 떼어 편집기가 건드리지 않게 한다. 그리지 못하면 글만 보인다. 자동 문단 번호(1., 가., ①)는 엔진 패치 0057의 `getParagraphHeadText`로 쪽 화면과 같은 번호 글을 받아 같은 방식(`data-marker`, 번호는 `data-number`도)으로 그린다. 엔진이 번호를 쪽 배치 중에 문서 순서로 세고 수준별 번호 모양을 내주지 않아 앱에서 셀 수 없기 때문이다. 문단을 나누거나 합치면 편집기가 `data-number` 문단의 번호를 모두 다시 받아 온다. 칸 안 글상자·캡션(경로가 두 단계 이상)의 Enter·Backspace는 경로 나누기·합치기로 하고, 엔진 패치 0058이 그 호출이 표 칸 밖의 글상자·캡션도 받게 한다. 엔진이 그래도 편집을 거절하면 화면을 엔진 글로 되돌리고 "이 자리에서는 할 수 없는 편집" 알림(`flowEditRefused`)을 띄운다. 문서에서 온 HTML이라 스크립트를 못 돌리는 틀(`sandbox="allow-same-origin"`)에만 넣는다. 엔진은 studio가 이미 싣고 있는 같은 WASM 파일을 쓴다(`vite.config.ts`의 `ieum-shared-rhwp-wasm`, `__IEUM_RHWP_WASM__`) — 두 벌을 싣지 않는다. 휴대폰·작은 태블릿(compact·medium)은 보기 모드에서 흐름 보기가 기본이고, 쪽 편집기(studio)는 그 아래에 늘 올려 둔다(저장·공유·AI가 그것으로 문서를 읽는다). 편집하고 보기로 돌아오면 studio에서 내보낸 바이트로 흐름을 다시 만든다.
- **흐름 보기 안 편집**(`editors/flowEditing.ts`): 흐름 쪽은 자기 엔진 문서(`HwpDocument`)를 들고 고친다. 엔진의 문단 글자 위치는 글자만 센다(표·그림은 자리를 차지하지 않음)라서 화면 커서 위치가 곧 엔진 위치다. 타자(한글 조합 포함)는 브라우저가 바꾼 뒤 그 문단의 글을 엔진 글과 비교해 차이만 넣고 지운다(조합 중에는 넣지 않음). Enter·문단 합치기·여러 문단 지우기·붙여넣기·되돌리기는 가로채 엔진 연산(`splitParagraph`·`mergeParagraph` 등)으로 한다. 고치기 전 화면 글이 엔진과 다르면 고치지 않고 엔진에서 다시 그린다. 표 칸 안(겹표 포함)·글상자·캡션도 같은 방식으로 고친다. 한 단계 경로(본문 표의 칸, 글상자, 캡션)는 평면 칸 연산(`insertTextInCell`·`splitParagraphInCell` 등), 더 깊은 경로는 `...InCellByPath` 연산을 쓴다. 평면 연산만 표 캡션에 닿고 글상자·캡션 문단을 나누고 합친다. 엔진이 연산을 거절하면 입력을 취소하고 그 블록을 엔진에서 다시 그린다. 칸 안에서 문단을 나누거나 합치면 그 칸 전체를 다시 그린다(칸 문단 번호가 바뀌므로). 여러 문단 지우기는 같은 그릇(본문끼리, 같은 칸끼리) 안에서만 하고, 서식은 화면 순서대로 걸친 블록 모두에 건다. 문단 서식(정렬·줄 간격·글머리표·번호)도 흐름 보기에서 캐럿이나 선택이 걸친 문단마다 엔진의 `applyParaFormat`(본문)·`applyParaFormatInCell`(한 단계 경로)·`applyParaFormatInCellByPath`로 건다. 목록은 첫 문단 기준으로 한꺼번에 켜고 끄며, 되돌리기는 바꾸기 전 문단 속성(정렬·줄 간격·머리 종류·번호 정의·수준)을 다시 건다. 표의 짜임(줄·칸 더하기, 합치기)과 그림은 고치지 않는다. 마지막으로 고른 쪽/흐름 보기는 문서별로 기억한다(`shell/layoutMemory.ts`). **그림 넣기**: 흐름 보기에서는 서식 판 [넣기]의 그림 넣기가 시스템 선택 창으로 그림을 받아(`editors/pickPicture.ts`, PNG·JPEG·GIF·BMP는 그대로, 다른 형식은 PNG로 다시 그림) 캐럿이 있는 문단의 끝에 글자처럼 취급 그림으로 넣는다(본문 `insertPicture`+`setPictureProperties`, 칸·글상자 `insertPictureInCell`+`setCellPicturePropertiesByPath`). 엔진은 본문에 새 그림을 쪽 기준 떠 있는 그림으로 넣으므로 바로 글자처럼 취급으로 바꾼다. 흐름은 문단의 그림을 글 뒤에 보이므로 문단 끝에 넣어야 쪽 보기와 자리가 같다. 크기는 원래 크기(96dpi)를 글 영역 너비(칸 안은 3분의 1)와 높이의 절반 안으로 줄인다. 되돌리기는 그 그림을 지운다. 쪽 보기에서는 studio의 `insert:image`(눌러서 놓기)를 쓴다. **메모**(`components/MemoSheet.tsx`): 흐름 보기의 [메모] 보기 도구와 서식 판 [넣기]의 메모 넣기가 메모 시트를 연다. 메모는 엔진의 `getMemoList`(위치 경로 `{type: cell|textbox, controlIndex, cellIndex, paraIndex}`를 흐름 블록 주소로 바꿈)로 읽고, 선택한 글(첫 블록 안)에 `insertMemo`/`insertMemoByPath`로 넣고, `insertMemoReply`·`setMemoText`·`removeMemo`(답글도 함께 지움)로 고친다. 메모 범위는 CSS Custom Highlight API(`::highlight(ieum-memo)`)로 칠해 DOM을 바꾸지 않는다(타자·비교에 영향 없음, API가 없는 웹뷰는 목록만). 메모 고치기는 글 되돌리기 쌓기에 넣지 않는다. 작성자 이름은 기기에 기억하고, 없으면 제품 이름이다. **쪽 번호**(`editors/pageNumbers.ts`, `components/PageNumberSheet.tsx`): 서식 판 [넣기]의 쪽 번호가 위치(없음·아래 가운데·아래 오른쪽·위 가운데·위 오른쪽)·모양(1·I·i·가)·줄표를 고르는 시트를 연다. PC 플러그인과 같은 규칙으로 첫 구역과, 제 쪽 번호가 있는 뒤 구역에만 `setPageNumberPos`(엔진 패치 0014)를 건다. 쪽 번호처럼 문서 전체에 거는 바꾸기는 `changeWholeDocument`(App)가 한다: 흐름 편집을 먼저 넘긴 studio 바이트를 엔진 사본에서 바꾸고 studio(`loadBytes`)와 흐름 보기에 다시 싣는다(되돌리기 기록은 새로 시작). **마크다운 → 한글**(`editors/markdownToHwp.ts`): 마크다운 문서의 [더 보기] "한글 문서로 저장"이 PC와 같은 길(결정 0135)로 바꾼다. 마크다운 편집기(`apps/markdown`)의 Tiptap 파서·워드 내보내기 → `@genoffice/docx2hwp`(`look: 'hangul'`) → `.hwpx`를 새 파일로 저장(`saveConvertedHwpx`)하고 알림의 [열기]로 연다. 이 길은 바꿀 때만 불러오는 덩어리라(약 5MB, Mermaid·KaTeX 등) 앱 시작 크기는 그대로다. 그 소스의 창 전역·모듈 선언(`apps/markdown/src/renderer/env.d.ts`, `types/wavedrom.d.ts`)을 이 앱의 `tsconfig.json`이 함께 읽는다(`packages/cli`와 같음). `.hwp`로는 바꾸지 않는다(.hwp 저장 보정이 쪽 편집기 측정값을 쓰기 때문). 엔진은 흐름 보기가 이미 띄운 같은 모듈을 쓴다. **문서 점검**(`components/DocCheckSheet.tsx`): 한글 문서의 [더 보기] "문서 점검"이 PC의 점검 창과 같은 일을 한다. 흐름 편집을 넘긴 뒤 쪽 편집기 플러그인(PC와 같은 studio 묶음에 든 `ieum-agent`, `HwpMobileEditor.callPlugin`)의 `documentProfile`로 문서를 읽고 `@genoffice/doc-rules`의 `audit`(같은 규칙 묶음, 기본으로 꺼 둔 검사 넷은 스위치)으로 판정한다. 모델도 네트워크도 없다. 걸린 곳을 누르면 흐름 보기에서는 그 블록(칸 문단에만 든 표·그림은 `data-obj-path`로 찾은 개체)으로, 쪽 보기에서는 플러그인 `reveal`로 간다. 한글 전용 글꼴은 편집 모드에서 함초롬바탕으로 바꿀 수 있다(플러그인 `replaceFont`). AI에게 넘기기는 넣지 않았다(모바일 AI 기본 꺼짐). 문구는 PC 점검 창의 번역을 그대로 옮겼다. 글 블록 밖(칸 테두리 자리 등)의 입력은 막는다. **흐름에서 고친 것은 저장·공유·복구 사본·AI·쪽 보기 전환 전에 `createFlowSyncedPort`가 studio에 넘긴다**(흐름 문서를 내보내 `loadBytes`). 저장 경로는 studio 하나로 유지한다. 흐름 틀은 스크립트를 못 돌려도 부모가 붙인 이벤트 처리기는 돈다(Chromium 확인).
- **흐름 보기의 공백**: HTML은 연이은 공백과 블록 앞뒤 공백을 한 칸으로 줄이므로, 줄어들 공백은 줄바꿈 없는 공백(NBSP)으로 바꿔 문서 그대로 보인다(`keepSpacesVisible`). 보기와 편집 모두, 글 블록·머리말·꼬리말·각주에 한다. 편집 모드에서만 하던 때는 편집을 누르면 "2026년␣␣0월" 같은 칸이 넓어졌다. 블록 글을 읽을 때(`paragraphText`) NBSP는 공백으로 돌아가 엔진 글은 그대로다.
- **AI는 기본 꺼짐**: 새 설치는 `aiEnabled: false`(Rust `MobileAppPrefs::default`와 화면의 초기값)로 시작한다. 꺼져 있으면 AI 진입점을 모두 숨기고, 설정의 켜기 스위치만 남긴다.
- **한글 AI 도구**(`ai/hwpAgent.ts`): PC 한글 편집기의 도구(`apps/hwp/src/renderer/ai/hwp-skill.ts`)를 그대로 쓴다. 도구는 쪽 편집기에 이미 든 같은 플러그인(`ieum-agent`)을 `HwpMobileEditor.callPlugin`으로 부른다. 휴대폰이 못 하는 것은 내놓지 않는다: 웹(`webAvailable: false` — 웹 검색·URL 읽기·그림 검색·그림 넣기), 그림 만들기·보기, 첨부, 메모를 지우는 편집의 허락(묻지 않고 거절). 문구(22개 언어)와 도구는 AI를 쓸 때만 불러오는 덩어리(`hwpAgent`, gzip 약 160KB)다. 실행 전에 흐름 보기 편집을 쪽 편집기로 넘기고(`flushFlowToStudio`), 끝나면 흐름 보기를 다시 그린다. 한 실행의 변경은 PC처럼 플러그인 `undo(단계 수, 시작 때의 바깥 변경 수)`로 한 번에 되돌리고, 그 사이 문서가 바뀌었으면 되돌리지 않고 알린다(`aiUndoRefused`). 보기/편집 게이트(`wrapSkillWithViewEditGate`)는 PC 도구의 편집 도구 목록(`HWP_EDIT_TOOLS`)으로 씌운다.
- **질문 카드**: 한글·마크다운 모두 공용 `ask_questions`(A2UI v1.0, 결정 0164)를 함께 내놓고, 카드는 공용 `AiQuestionCard`·`useAiInlineQuestions`로 AI 시트의 대화 아래에 그린다. 카드는 그 실행 동안 보이고, 답은 이어지는 답 글이 담는다. 새 메시지는 열린 카드를 닫고(`skip`), 문서를 바꾸면 카드 상태도 비운다.
- **스타일과 언어**: 모든 CSS는 `src/renderer/` 아래에 두고 색은 `packages/ui/src/tokens.css` 변수만 사용한다. 22개 언어 문구는 `LANGS` 전체를 유지하고 `brandText`로 제품 이름을 치환한다.

## 테스트와 빌드

- TS 타입·단위·통합: `npm run typecheck -w @genoffice/mobile`, `npm run test -w @genoffice/mobile`
- Rust 백엔드: `cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml`, `cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml`
- 웹 번들(한글 스튜디오 포함): `npm run studio -w @genoffice/hwp && npm run build -w @genoffice/mobile`

## 1판 트랙 자리

모바일 1판은 트랙 일곱(T1 엑셀, T2 PDF, T3 PDF 도구, T4 HTML·마크다운, T5 EPUB·PPT 읽기, T6 홈·설정, T7 AI)이 나란히 만든다. 서로 같은 줄을 고치지 않도록 공용 파일을 트랙 자리로 갈라 두었다(S0, 바탕 공사). 트랙은 **자기 폴더의 파일만 채운다.** 등록표·문구 묶음·아이콘 지도·다리 내보내기·`commands/mod.rs`는 이미 이어 두었으므로 고치지 않는다. 공용 파일에 줄을 더하는 곳은 셋뿐이고, 모두 자기 표시 주석 바로 아래다: `src-tauri/src/lib.rs`(`// T1 sheets` 등 명령 등록, `// T1 sheets state` 등 관리 상태), `src-tauri/Cargo.toml`(`# T1 sheets` 등, "deps:" 커밋), `native-config/`(Android `<!-- T1 sheets MIME types -->` 등 두 거르개 모두, iOS `<!-- T1 sheets document types -->`·`<!-- T1 sheets imported types -->` 등).

- **편집기 종류**: `editors/<트랙>/index.ts`의 배열(`sheetsEditorKinds`, `pdfEditorKinds`, `htmlEditorKinds`, `readersEditorKinds`)에 `EditorKind`를 넣는다. 형식·확장자(`openExtensions`)가 등록되면 파일 고르기 창과 열 수 있는 형식 문지기에 저절로 들어간다. 등록 전에는 그 형식을 열지 않고 "이 파일 형식은 열 수 없습니다" 알림(`formatNotOpenable`)을 띄운다. 무거운 편집기는 처음 쓸 때 불러오는 덩어리(동적 `import`)로 둔다(앱 시작 크기를 늘리지 않게). 불러오기는 `open()` 안에서 하거나, Workspace 안에서 `React.lazy`를 쓰면 그 Workspace 안에 `Suspense`를 둔다(App은 `Suspense`로 감싸지 않는다). 읽기 전용 종류는 `editable: false`로, 저장·복구 사본 함수를 두지 않는다. AI가 없으면 `hasAi: false`.
- **문구**: `i18n/<트랙>/<언어>.ts`(22개 언어, `zh`가 키를 정함). 키 앞머리는 `sheets…`·`pdf…`(`pdfTools…`로 시작하지 않게)·`pdfTools…`·`web…`·`readers…`·`home…`·`ai…`(기본 사전의 `ai…` 키와 같은 이름 금지). 겹침은 `tests/i18n-bundles.test.ts`가 잡는다. 기본 사전(`i18n/<언어>.ts`)과 `strings.ts`에는 더하지 않는다.
- **다리**: `@genoffice/mobile-bridge/<트랙>`(`src/<트랙>/index.ts`)에 자기 명령 감싸개를 `invokeMobileCommand(client.transport, …)`로 만든다. `MobileClient`는 넓히지 않는다.
- **Rust 명령**: `src-tauri/src/commands/<트랙>.rs`. 하위 모듈은 `commands/<트랙>/` 폴더에(`lib.rs` 머리의 `pub mod`를 고치지 않게). T1은 `src/sheets/`도 쓴다. `cargo fmt`를 크레이트 전체에 돌리지 않는다(기존 파일들이 rustfmt 모양이 아니라 다른 줄까지 바뀐다).
- **아이콘**: `components/icons/<트랙>.tsx`(`sheets`·`pdf`·`pdfTools`·`web`·`readers`·`home`·`ai`). 선 아이콘은 `components/icons/svgIcon.tsx`의 `SvgIcon`으로 그린다(`MobileIcons.tsx`에서 가져오지 않는다 — 서로 물린다). 파일 형식 그림은 그 파일의 `<이름>DocTypeIcons` 지도에. 편집 도구 막대 단추의 아이콘은 `EditorQuickActionItem.icon`으로 넘긴다(`EditorShell.tsx`를 고치지 않는다).
- **설정**: 절마다 파일(`settings/sections/*.tsx`). AI 절(`AiSection.tsx`의 `AiEnabledRow`·`AiSection`·`AiStorageRows`)은 T7, 나머지(`GeneralSection`·`BackupsSection`·`StorageSection`, `SettingsScreen.tsx`, 기본값 `settings/defaultPrefs.ts`)는 T6. T7은 설정 기능을 `ai/settingsSlot.ts`의 `MobileAiSettingsSlot`과 `useMobileAi`로 늘린다.
- **홈**: `home/homeTabs.ts`(탭 목록, 지금은 `HOME_TABS_ENABLED = false`), `home/ToolsTab.tsx`(T3), `home/FoldersTab.tsx`(T6), 들어온 문서 `home/incoming.ts`(T6). 홈 화면과 탭은 `home/homeHost.ts`의 `HomeHost`(문서 열기, `createNew`, 알림, 홈 새로 읽기, 설정 열기)로 앱에 부탁한다.
- **AI**: AI 실행·대화·AI 창·설정 값은 `ai/useMobileAi.ts`(T7). 편집기 트랙은 자기 종류의 `createAiRun`만 만든다.
- **문서마다 다른 것**: 열린 문서(`EditorDocument`)가 `editable: false`(이 문서만 읽기 전용, 보기 모드로 열림)·`aiAvailable: false`(이 문서에서는 AI 진입점 숨김, 예: 암호를 풀어 연 파일)를 낼 수 있다. 문서를 닫거나 다른 문서로 바꿀 때 앱이 `dispose()`를 부른다(엔진·임시 파일 정리). `open()`이 준비한 것을 쓰기 전에 전환이 취소되면(저장 안 함 확인에서 취소) `EditorOpened.discard()`를 부른다. `open()` 안에서 사람이 취소하면(예: 암호 창) `USER_CANCELLED`를 던지면 앱이 조용히 넘긴다. `EditorOpened.encrypted`는 "보호된 문서라 고칠 수 없음"(한글 규칙)이라, 풀어서 고칠 수 있는 문서는 켜지 않는다.
- **빌드 설정**: Vite 플러그인·가져오기 별칭(PC 전용 모듈의 모바일 대역 등)·`define`·Vitest 준비 파일은 `config/tracks/<트랙>.ts`(`sheets`·`pdf`·`pdfTools`·`web`·`readers`·`home`·`ai`)의 `TrackBuild`에 둔다. 묶음과 시험이 모두 읽는다(`vite.config.ts`·`vitest.config.ts`·`tsconfig.json`은 고치지 않는다). 플러그인은 자기 모듈에만 걸리게 짠다. 다른 편집기의 전역 선언(`env.d.ts`)이 필요하면 `src/env/<트랙>.d.ts`에 `/// <reference path="…" />`로 둔다.
- **S0 시험**(`tests/editor-registry.test.tsx`, `open-gate.test.tsx`, `home-slots.test.tsx`, `i18n-bundles.test.ts`, `native-config-slots.test.ts`, `settings-sections.test.tsx`, `document-lifecycle.test.tsx`, `track-build.test.ts`)은 트랙이 자기 형식·그림·문구·MIME을 더해도 그대로 통과하게 짰다. 트랙은 이 파일들을 고치지 않고, 자기 시험은 새 파일로 둔다.
- `App.tsx`, `shell/**`, `editors/editorKind.ts`·`registry.ts`·`hwpKind.tsx`, 기본 사전·`strings.ts`, `components/MobileIcons.tsx`·`components/icons/index.ts`·`types.ts`·`svgIcon.tsx`, `config/tracks/index.ts`·`types.ts`, `vite.config.ts`·`vitest.config.ts`·`tsconfig.json`은 어느 트랙도 고치지 않는다. 바꿔야 하면 기획에서 까닭과 바꿀 줄을 적고 승인을 받아 따로 커밋한다. 트랙별 계획·결정·발견은 `docs/plans/mobile-v1/<트랙ID>.md`(안내는 `docs/plans/mobile-v1/README.md`).

### T1 엑셀 (1판)

(이 트랙이 채운다)

### T2 PDF (1판)

(이 트랙이 채운다)

### T3 PDF 도구 (1판)

(이 트랙이 채운다)

### T4 HTML·마크다운 (1판)

(이 트랙이 채운다)

### T5 EPUB·PPT 읽기 (1판)

(이 트랙이 채운다)

### T6 홈·설정 (1판)

(이 트랙이 채운다)

### T7 AI (1판)

(이 트랙이 채운다)
