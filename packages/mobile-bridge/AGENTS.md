# packages/mobile-bridge (`@genoffice/mobile-bridge`)

모바일 앱(`apps/mobile`)의 프런트엔드와 Tauri 2 Rust 백엔드 사이를 잇는 플랫폼 어댑터 패키지다. Node 전용 모듈에 기대지 않아 jsdom 단위 테스트와 모바일 WebView 번들 양쪽에서 바로 돌아간다.

## 맡은 범위

- `src/transport.ts`: 16종 고정 오류 코드(`MobileErrorCode`), Tauri `invoke`/이벤트 추상화(`MobileTransport`, `createMobileClient`, `createTauriMobileTransport`).
- `src/session-state.ts`: 단일 활성 문서 상태 기계(`MobileSessionController`), 미저장 전환 충돌 확인 게이트, 문서 전환·닫기 시 AI 대화 메모리 초기화 훅.
- `src/view-edit-gate.ts`: 보기 우선 열기(`initialDocumentMode`), 보기 모드 × AI 수정 도구 자동 전환 및 읽기 전용·암호·배포용 문서 수정 차단(`wrapSkillWithViewEditGate`).
- `src/ai-bridge.ts`: Rust 키 비노출 스냅샷(`MobileAiSettingsSnapshot`)을 `@genoffice/ai-provider/browser`의 `selectAiProvider`와 `@genoffice/ui`의 `aiSendGate` 계약으로 투영(`claude-code`·`codex` `'off'`, `__sealed__` 자리표시자, `subscriptionNoticeVersion` 영속화, OpenRouter `freeOnly` 강제), 스트림 전송기(`createMobileAgentTransport`), 문서 한정 메모리 대화 저장소(`MobileAiMemoryStore`).
- `src/markdown/index.ts`: 마크다운 모바일 어댑터(`createMobileMarkdownApi`), 5 MiB 상한 인라인 `data:` 그림 삽입(`inlineImageToMarkdown`), 상대 경로 그림 문법 보존(`preserveRelativeImageLinks`), 마크다운 AI 스킬(`createMobileMarkdownSkill`), 1차 제외 기능 미지원 응답.
- `src/hwp/index.ts`: 한글 모바일 어댑터(`createMobileHwpApi`), Canvas2D 강제 설정 시딩(`seedMobileHwpStudioSettings`, `mobileHwpStudioUrl`), 자가 검증→탭 측정→Rust 저장 보정/백업 게이트 연동, 암호 문서 원본 전용 공유, 한글 AI 스킬(`createMobileHwpSkill`), 1차 제외 기능 미지원 응답.

## 항상 지켜야 하는 것

- 원시 API 키·토큰 문자열을 저장하거나 반환하지 않는다. `__sealed__` 자리표시자는 메모리 투영 객체 안에서 `isKeyProviderConfigured` 판정용으로만 쓴다.
- 1차 제외 기능(위키링크·볼트·외부 이미지 호스트·인쇄·PDF 내보내기·한자 사전·모양 복사·메모 패널·행정문서 점검)은 `{ ok: false, error: 'unsupported-on-mobile' }` 또는 빈 배열로 안전하게 닫는다.

## 테스트

- `npm run typecheck -w @genoffice/mobile-bridge`
- `npm run test -w @genoffice/mobile-bridge`
