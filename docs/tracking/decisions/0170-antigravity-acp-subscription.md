# 0170. Google Antigravity 구독을 공식 ACP 클라이언트(`agy acp`)로 연동한다

- 날짜: 2026-11-26
- 상태: 채택(1·2단계 구현 완료)

## 맥락

사용자가 이미 구독 중인 Google AI(Antigravity) 요금제를 이음오피스에서도 쓰고 싶다는 요청이 있었다. Google Antigravity CLI(`agy`)는 공식 문서(`https://antigravity.google/docs/cli/acp/`)에서 표준 Agent Client Protocol(ACP v1, stdio JSON-RPC)을 제공한다.

다만 Google Antigravity 약관·FAQ는 소비자 구독 로그인을 제3자 앱의 모델 프록시나 일반 1턴 두뇌 래퍼(`agy -p` 등)로 감싸는 방식을 금지하고, 공식 ACP 클라이언트로 수정되지 않은 `agy acp`를 실행하는 경로만 열어 둔다. 또한 `agy acp`는 출력 JSON 스키마(`outputSchema`)나 도구 0개 강제 스위치를 제공하지 않는다.

## 결정

1. **공식 ACP 클라이언트로만 연동한다.** `agy`는 셸 없이 실제 실행 파일 경로로 `agy acp`만 실행하며, 한 턴짜리 두뇌 래퍼(`chatForProvider` / 도구 없는 일괄·자동 호출 경로)로 감싸지 않는다.
2. **1단계: 설정 → AI 연결 카드 + 에이전트 모드.**
   - 구독 제공자 목록(`AI_SUBSCRIPTION_PROVIDERS`, `AI_SUBSCRIPTION_CLIS`)에 `'antigravity'`를 추가해 설정 → AI 카드에서 설치·로그인(`agy acp --login`)·로그아웃(ACP `logout`, 예비 `auth/logout`)·업데이트(`agy update`)·이 앱에서 끄기(결정 0114)와 상태·요금제·모델 목록 조회를 지원한다.
   - 에이전트 창(`AgentProvider`에 `'antigravity'` 추가)에서 `startAntigravityAgentSession`이 `agy acp --process-per-session --sandbox --disable-telemetry --include-default-customizations=false --gemini-dir <세션 전용 격리 폴더>`로 실행한다.
3. **2단계: 기본 AI 창 ACP 네이티브 + 편집기 세션 MCP 브리지.**
   - 11개 문서 편집기(워드·엑셀·슬라이드·PDF·마크다운·HTML·마인드맵·한글·EPUB·다이어그램·화이트보드)와 홈 질문 패널(`KbAskPanel`)의 기본 AI 창에서 Antigravity를 공식 ACP 세션(`packages/ai-provider/src/antigravity-panel.ts`)으로 직접 실행한다.
   - `streamAntigravityPanel`은 세션마다 루프백 HTTP MCP 서버(`ieumoffice_panel`, `127.0.0.1:0/mcp`, 세션별 24바이트 Bearer 토큰)를 띄워 현재 턴의 편집기 도구 목록(`AgentToolDef[]`)만 노출한다. `agy`가 MCP 도구를 호출하면 메인 프로세스가 `ai:stream-chunk`의 `acp-tool-call` 조각으로 원 발신 탭 렌더러에 넘기고, 렌더러(`AgentLoop`의 `onLiveToolCall`)가 기존 편집기 도구 실행·가리기(`{{label}}`)·되돌리기 스냅샷(`captureSnapshot`)·노란 변경 카드·인터넷 스위치·드라이브 반출 차단·사용자 MCP 허락 카드를 그대로 거친 뒤 결과를 `window.aiOfficeAcpTool.sendResult`(`ai:acp-tool-result`)로 돌려준다.
   - `session/request_permission`은 현재 턴에 등록된 `mcp_ieumoffice_panel_<도구>`만 허용(`matchPanelMcpTool`)하고, `agy`의 모든 자체 도구(`read_file`, `write_file`, `run_command`, `search_web`, `read_url` 등)와 알 수 없는 `mcp_*` 도구는 무조건 거절한다. 다층 방어로 `session/update`에서 허용 목록 밖 도구가 `completed`로 보고되면 즉시 프로세스 트리를 종료하고 `AiRunError('unsafe-tools')`를 던진다.
   - `auto` 선택 순서는 `claude-code` → `chatgpt` → `codex` → `antigravity`다. 기존 사용자의 자동 선택은 바뀌지 않고, Antigravity만 연결된 사용자는 바로 기본 AI 창을 쓸 수 있다.
   - PDF 문서 작업(페이지 읽기·문서 번역·핵심 표시), EPUB 책 번역, `ieumoffice` 터미널·MCP 일괄 호출, `chatForProvider`는 `AI_BATCH_SUBSCRIPTION_PROVIDERS = ['claude-code', 'chatgpt', 'codex']`로 유지해 Antigravity에서 제외한다.
4. **자격 증명 비접근과 격리.**
   - `~/.gemini`나 OS 키링의 로그인 정보를 앱이 읽거나 복사·저장하지 않는다.
   - 세션마다 독립된 `--gemini-dir`과 `antigravity-cli/settings.json`(`toolPermission: 'request-review'`, `allowNonWorkspaceAccess: false`, `enableTerminalSandbox: true`)을 써서 사용자 훅·플러그인·설정·MCP를 배제하면서도 OS 키링 로그인은 그대로 유지한다.
   - 상태·모델 목록 조회는 모델 호출이 없는 `initialize` + `session/new`로 `_meta.antigravity.tier`와 `configOptions`/`models.availableModels`만 읽고 바로 `session/close`한다. 소비자 요금제(`g1-*`)만 `subscription`(`ready`)으로 인정하고 그 밖의 티어나 누락은 `unknown`(`metered`)으로 판정한다.
   - 과금 경로를 바꿀 수 있는 Google/Gemini/Vertex 환경 변수 8종(`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GEMINI_BASE_URL`, `AGY_ADC_AUTH`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_QUOTA_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_USE_VERTEXAI`)을 자식 환경에서 제거한다.
   - 에이전트 보호 경로에 `~/.gemini`를 추가하고, 모든 `session/request_permission`을 에이전트 모드에서는 `agentPolicyVerdict`로, 기본 AI 창에서는 `matchPanelMcpTool` 허용 목록으로 판정한다. `--dangerously-skip-permissions`는 어떤 경로에도 넘기지 않는다.
   - 에이전트 모드의 열린 문서 도구(`ieumoffice-editor`)·사용자 MCP 중계와 기본 AI 창의 편집기 도구 브리지(`ieumoffice_panel`)는 모두 표준 ACP HTTP `mcpServers`(루프백 + 세션 Bearer 토큰)로 전달한다.

## 버린 대안

- **`agy -p --input-format stream-json --json-schema`로 기본 AI 창 두뇌 래퍼 구현**: Google 약관/FAQ의 제3자 하네스 래핑 금지와 충돌하고, `agy -p` stream-json이 이미지 입력을 거부하며, 도구 0개·단일 스키마 보장이 불완전해 폐기했다.
- **Google OAuth를 앱이 직접 구현해 소비자 요금제 토큰 발급**: Antigravity 소비자 구독용 공식 제3자 OAuth 클라이언트 등록 경로가 없고 약관 위반 소지가 커서 폐기했다.

## 결과

- Antigravity 구독자는 설정 → AI에서 `agy`를 연결해 기본 AI 창(11개 편집기 + 홈 질문 패널)과 에이전트 모드 모두에서 공식 ACP 클라이언트로 문서를 읽고 고칠 수 있다.
- 기본 AI 창의 기존 보안 불변식(가리기, 되돌리기 스냅샷, 노란 변경 카드, 인터넷 스위치, 드라이브 반출 차단, 사용자 MCP 허락 카드, `agy` 자체 도구 전면 차단)과 기존 Claude·ChatGPT·Codex 동작은 그대로 유지된다.
- Antigravity 개인 계정의 기본 학습 허용 정책과 초과 사용 시 유료 크레딧(`useG1Credits`) 주의사항은 설정 카드 안내 문구(`antigravityCardNote`)와 `PRIVACY.md`에 명시한다.
