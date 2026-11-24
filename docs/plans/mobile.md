# 이음오피스 모바일 앱 (Android · iOS) 계획

## 개요

이음오피스(`com.ieumoffice.mobile`)를 **Tauri 2 Mobile** 기반으로 Android와 iOS에 공식 스토어(Google Play Store · Apple App Store) 출시하기 위한 단계별 계획과 외부 계약을 정리한다. 데스크톱은 Electron을 유지하고, 모바일만 Tauri 2를 사용해 Rust 문서 엔진(`hwp5-wasm`, 추후 `xlsx-engine` 등)과 OAuth·HTTPS 스트리밍·보안 저장소를 단일 Rust 백엔드로 통합한다.

## 1차 수직 슬라이스 (구현 완료, 실기기 확인 남음)

- **단일 활성 문서 반응형 셸(`apps/mobile`, `packages/mobile-bridge`)**:
  - 스마트폰·작은 태블릿(`<840px`, 창 크기 compact·medium) 미니 헤더 + `visualViewport` 가상 키보드 연동 하단 퀵 툴바 + 바텀시트(AI 도우미·문서 메뉴), 큰 태블릿·폴드·DeX(`≥840px`, expanded·large) 상단 도구 줄 + 오른쪽 도킹 AI 패널. 처음 768px였던 경계를 디자인 시스템(결정 0165)에 맞춰 바꿨다.
  - 보기 우선 열기, 미저장 문서 전환 충돌 확인 모달, 자동 복구 사본, OS 파일 선택기·외부 공유 열기·OS 공유 시트.
- **핵심 2종 편집기**:
  - 마크다운(`.md`, `.markdown`, `.txt`): 보기/편집 전환, 5 MiB 이하 인라인 `data:` 그림 첨부, 기존 상대 경로 그림 문법 보존, 문서 AI 도구.
  - 한글(`.hwp`, `.hwpx`): `rhwp-studio`(`chrome=embed`, Canvas2D 강제, `canvaskit-wasm` 비활성화), OFL-1.1 한글 글꼴 번들, Rust(`hwp5-wasm`) 기반 컨테이너 검사·암호/배포용 차단·변경 추적 제거·저장 보정·최초 덮어쓰기 전 앱 전용 원본 백업 및 복원 UI.
- **AI 도우미**:
  - ChatGPT 공식 모바일 OAuth 구조(OIDC 오리진 고정, HTTP 리다이렉트 차단, PKCE S256, RS256 JWKS, `pendingRefresh` 체크포인트, API 401 세션 비삭제, 사용량 관리 링크 `https://chatgpt.com/settings/usage`), 릴리스 빌드에서 `IEUM_MOBILE_CHATGPT_CLIENT_ID` 미설정 시 카드 숨김, `dev-chatgpt-loopback` 개발 전용 피처 격리.
  - 무료 연결(OpenRouter `freeOnly: true` `:free` 전용, Gemini API 키), HTTPS 클라우드 BYOK, AI 켜기 스위치(**기본 꺼짐**, 결정 0165).
- **22개 화면 언어 및 토큰 전용 테마**: `LANGS` 전체 번역과 `packages/ui/src/tokens.css` 토큰 전용 스타일.
- **CI 검증**: `.github/workflows/mobile-build.yml`에서 Rust 라이선스/테스트, 모바일 TS 테스트, 스튜디오+웹 번들, Android(`aarch64`) 및 iOS(`aarch64-apple-ios`) 미서명 빌드를 검증한다.

## 외부 사이트(`ieumoffice.com`) 선행 계약

공식 스토어 배포 및 ChatGPT App Links / Universal Links 콜백(`https://ieumoffice.com/mobile/auth/callback`)을 활성화하기 전에 `E:\github\ieumoffice-site`에 아래 두 정적 파일을 HTTPS(리다이렉트 없음, `application/json`)로 배포한다.

1. **`https://ieumoffice.com/.well-known/assetlinks.json`** (Android App Links):
   - `package_name`: `com.ieumoffice.mobile`
   - `sha256_cert_fingerprints`: Google Play App Signing 릴리스 인증서 SHA-256 지문
2. **`https://ieumoffice.com/.well-known/apple-app-site-association`** (iOS Universal Links):
   - `appIDs`: `["<APPLE_TEAM_ID>.com.ieumoffice.mobile"]`
   - `components`: `[{ "/": "/mobile/auth/callback" }]`

## 스토어 출시 및 실기기 확인 체크리스트

- [ ] OpenAI Sign in with ChatGPT 공식 모바일 클라이언트 ID 승인 후 빌드 시 `IEUM_MOBILE_CHATGPT_CLIENT_ID` 주입
- [ ] `ieumoffice.com/.well-known/{assetlinks.json,apple-app-site-association}` 배포 및 검증
- [ ] Google Play Console (일회성 $25) 및 Apple Developer Program (연 $99) 계정·서명 키 설정
- [ ] Android 실기기 확인: 한글 IME 조합, SAF 영구 URI 저장/복구, `FileProvider` 공유, 가상 키보드 위 하단 퀵 툴바
- [ ] iOS 실기기 확인: 한글 IME 조합, `UIDocumentPicker` 보안 북마크 저장, `UIActivityViewController` 공유, WKWebView Canvas2D 메모리 안정성

## 후속 단계

기능 범위와 판 나누기는 [mobile-scope.md](mobile-scope.md), 화면 규칙은 [mobile-design-system.md](mobile-design-system.md)가 정한다(결정 0165). 요약:

- **1판**: 고치기 한글·PDF·마크다운·HTML·엑셀(`xlsx-engine` 크레이트를 앱 안 명령으로), 읽기 EPUB·PPT, PDF 도구(페이지 정리·변환·용량·보안·주석 지우기), 공유 단추·공유로 받기, 한글 흐름 보기, 첫 실행 안내.
- **2판**: 마인드맵·워드·화이트보드·PPT 편집·다이어그램, PDF 스캔 도구(문서 모드 → 책 모드), 인쇄 준비 도구, 사용자 스킬·주소형 MCP.
- 모바일 ChatGPT 바로 연결은 약관 판단 전까지 켜지 않는다(위 체크리스트 첫 항목도 그 판단 뒤).
