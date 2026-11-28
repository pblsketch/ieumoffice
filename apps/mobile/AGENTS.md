# apps/mobile (`@genoffice/mobile`)

이음오피스의 Android·iOS 모바일 앱(`com.ieumoffice.mobile`, Tauri 2 Mobile)이다. 바형 스마트폰 세로 화면(`<768px`)부터 태블릿·폴드·DeX(`≥768px`)까지 한 화면에서 한글(`.hwp`/`.hwpx`)과 마크다운(`.md`/`.markdown`/`.txt`) 문서를 열고 고치며, AI 도우미를 함께 쓸 수 있다.

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
- **스타일과 언어**: 모든 CSS는 `src/renderer/` 아래에 두고 `packages/ui/src/tokens.css` 변수만 사용한다. 22개 언어 문구는 `LANGS` 전체를 유지하고 `brandText`로 제품 이름을 치환한다.

## 테스트와 빌드

- TS 타입·단위·통합: `npm run typecheck -w @genoffice/mobile`, `npm run test -w @genoffice/mobile`
- Rust 백엔드: `cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml`, `cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml`
- 웹 번들(한글 스튜디오 포함): `npm run studio -w @genoffice/hwp && npm run build -w @genoffice/mobile`
