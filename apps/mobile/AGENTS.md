# apps/mobile (`@genoffice/mobile`)

이음오피스의 Android·iOS 모바일 앱(`com.ieumoffice.mobile`, Tauri 2 Mobile)이다. 스마트폰·작은 태블릿(`<840px`)부터 큰 태블릿·폴드·DeX(`≥840px`)까지 한 화면에서 한글(`.hwp`/`.hwpx`)과 마크다운(`.md`/`.markdown`/`.txt`) 문서를 열고 고치며, AI 도우미를 함께 쓸 수 있다.

## 맡은 범위

- 모바일 렌더러(`src/renderer/`):
  - 반응형 셸(`shell/EditorShell.tsx`, `shell/useViewportLayout.ts`), 홈·바텀시트·AI 패널·미저장 전환 모달(`components/`), 설정·AI 연결·HWP 원본 백업 관리(`settings/SettingsScreen.tsx`), 종단 통합(`App.tsx`).
  - 편집기 호스트(`editors/MarkdownMobileEditor.tsx`, `editors/HwpMobileEditor.tsx`): 보기 우선 열기, 마크다운 인라인 그림 첨부, 한글 Canvas2D 강제 부팅(`dist/studio/`).
  - 22개 언어 문구(`i18n/`), 토큰 전용 스타일(`styles/mobile-tokens.css`), OFL-1.1 한글 글꼴(`assets/fonts/`).
- Tauri 2 Rust 백엔드(`src-tauri/`):
  - 단일 활성 문서 세션·최근 목록·자동 복구·HWP 최초 덮어쓰기 전 백업(`src/storage/`).
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
- **한글 흐름(읽기) 보기**(`editors/hwpFlow.ts`, `editors/HwpFlowView.tsx`, 결정 0165): rhwp 엔진의 HTML 내보내기(`exportSelectionHtml` 문단별, 표·그림은 `exportControlHtml`)로 화면 폭에 다시 흘린 문서를 만든다. 문단마다 `data-sec`·`data-para`를 붙인다(흐름 편집이 엔진 위치로 되돌리는 열쇠). 문서에서 온 HTML이라 스크립트를 못 돌리는 틀(`sandbox="allow-same-origin"`)에만 넣는다. 엔진은 studio가 이미 싣고 있는 같은 WASM 파일을 쓴다(`vite.config.ts`의 `ieum-shared-rhwp-wasm`, `__IEUM_RHWP_WASM__`) — 두 벌을 싣지 않는다. 휴대폰·작은 태블릿(compact·medium)은 보기 모드에서 흐름 보기가 기본이고, 쪽 편집기(studio)는 그 아래에 늘 올려 둔다(저장·공유·AI가 그것으로 문서를 읽는다). 편집하고 보기로 돌아오면 studio에서 내보낸 바이트로 흐름을 다시 만든다.
- **AI는 기본 꺼짐**: 새 설치는 `aiEnabled: false`(Rust `MobileAppPrefs::default`와 화면의 초기값)로 시작한다. 꺼져 있으면 AI 진입점을 모두 숨기고, 설정의 켜기 스위치만 남긴다.
- **스타일과 언어**: 모든 CSS는 `src/renderer/` 아래에 두고 색은 `packages/ui/src/tokens.css` 변수만 사용한다. 22개 언어 문구는 `LANGS` 전체를 유지하고 `brandText`로 제품 이름을 치환한다.

## 테스트와 빌드

- TS 타입·단위·통합: `npm run typecheck -w @genoffice/mobile`, `npm run test -w @genoffice/mobile`
- Rust 백엔드: `cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml`, `cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml`
- 웹 번들(한글 스튜디오 포함): `npm run studio -w @genoffice/hwp && npm run build -w @genoffice/mobile`
