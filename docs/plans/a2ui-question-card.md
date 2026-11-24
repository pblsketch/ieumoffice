# AI 질문 카드를 A2UI v1.0으로 (계획, 1단계 구현됨)

결정 0164. AI 창이 사람에게 몇 가지를 골라 달라고 묻는 카드를 공개 규격 [A2UI](https://github.com/a2ui-project/a2ui) v1.0(Apache-2.0, 안정판)의 메시지로 주고받는다.

## 붙이는 자리

A2UI를 AI와 주고받는 통로로 들이지 않는다. 구독 프로그램은 앱 도구의 이름만 받는 "한 차례 답" 두뇌이고(결정 0082), 도구는 화면 쪽 앱이 실행한다. 그래서 A2UI는 **앱 도구 `ask_questions`가 받는 입력 형식**이다. 도구 이름이 그대로라 구독 프로그램의 형식 스키마와 잠금은 바뀌지 않는다.

- 렌더러는 `@a2ui/react`를 들이지 않고 `packages/ui`의 부품과 토큰으로 직접 그린다. A2UI의 React 렌더러는 0.x대이고 판마다 호환이 깨지며, 기본 부품이 Lit 웹 컴포넌트라 우리 토큰·22개 언어 규칙과 따로 논다.
- 카탈로그 `ieumoffice.com:question-card/v1`은 A2UI 기본 카탈로그 v1의 부분집합이다(Column, Text, ChoicePicker, CheckBox, TextField, Slider, 함수 `required`). 이음오피스만의 속성을 덧붙이지 않는다.
- 배치와 단추("보내기", "건너뛰기", 고르는 질문마다 "알아서 정해 줘")는 앱이 22개 언어로 붙인다. 모델은 제목과 질문 칸만 쓴다.
- 도구를 못 쓰는 모델은 같은 카드를 답 글 끝의 `<a2ui-json>` 블록(A2UI Direct JSON)으로 쓴다.

## 단계

1. **구현됨(결정 0164).** 형식·검사·결과 모양(`packages/agent-core`), 도구와 도구 없는 실행의 안내, 공용 카드·글 속 블록·다시 연 대화의 읽기 전용 카드(`packages/ui`), 열한 편집기와 홈 AI 질문의 배선, HTML·슬라이드의 옛 질문 도구(`ask_clarification`) 없애기, 실제 구독 확인.
2. **다음.** 사용자 MCP 서버가 도구 결과로 보낸 A2UI 화면(`application/a2ui+json` 리소스)을 같은 렌더러로 그린다. 지금 `shapeMcpResult`는 이 리소스를 통과시키지 않는다. 그릴 때도 받은 내용 지키기와 허락 카드를 그대로 거치고, 화면 안의 MCP 도구 호출(`callMcpTool`)과 스크립트가 도는 MCP Apps(`McpApp`)는 따로 판단한다. 실제로 그런 서버를 쓰는 사람이 생기면 시작한다.

## 지키는 것

- 카탈로그 ID와 결과 모양(`ieum_submit`·`ieum_skip`)은 대화 기록에 남는 약속이다. 바꿔야 하면 `/v2`를 새로 만들고 `/v1` 기록은 계속 읽는다.
- 도구 설명·스키마·지시문 구역의 합은 매 차례 실리므로 6,000자 이하로 둔다(시험이 지킨다).
- 원본(GenOffice)에는 `ask_clarification`이 남아 있다. 원본을 받아올 때 다시 들이지 않는다(`docs/operations.md`).
