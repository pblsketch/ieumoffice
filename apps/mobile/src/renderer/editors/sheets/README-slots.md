# 엑셀 편집기의 자리 (트랙 T1)

XLS-T7이 편집기 종류·열기·문서 뼈대를 깔았다. 뒤 태스크는 **자기 줄의 파일만** 고친다. 뼈대(`kind.ts`, `open/`, `workspace/`, `journal/`, `session.ts`)를 꼭 고쳐야 하면 그 태스크 안에서 최소한으로 하고 커밋 메시지에 적는다.

| 태스크                | 고치는 파일                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XLS-T8 격자           | `grid/**`(그중 화면 몫은 `grid/workspaceSlot.tsx`), 읽기 메서드 `desktop-api/read.ts`, 문구 `i18n/sheets/grid/<언어>.ts`                                          |
| XLS-T9 도구 막대      | `toolbar/**`(화면 몫은 `toolbar/workspaceSlot.tsx`), `desktop-api/toolbar.ts`, 문구 `i18n/sheets/toolbar/<언어>.ts`                                               |
| XLS-T10 저장·내보내기 | `save/**`(문서 몫은 `save/documentSlot.ts`, 화면 몫은 `save/workspaceSlot.tsx`), `pdf/**`, `convert/**`, `desktop-api/save.ts`, 문구 `i18n/sheets/save/<언어>.ts` |
| XLS-T11 AI            | `ai/**`(문서 몫 `ai/documentSlot.ts`의 `createSheetsAiRun`, 화면 몫 `ai/workspaceSlot.tsx`), `desktop-api/ai.ts`, 문구 `i18n/sheets/ai/<언어>.ts`                 |
| XLS-T7(끝남)          | `kind.ts`, `open/**`, `session.ts`, `workspace/**`, `journal/**`, 문구 `i18n/sheets/open/<언어>.ts`                                                               |

## 끼우는 자리의 모양

- 화면 몫(`*/workspaceSlot.tsx`): `SheetsWorkspaceSlot` 훅. `SheetsWorkspaceContext`(host, opened, grid, mode, canEdit, lang, theme, t)를 받아 `quickActions`·`formatGroups`·`viewTools`·`moreItems`·`overlay`를 돌려준다. `workspace/SheetsWorkspace.tsx`가 격자 → 도구 → 저장 → AI 차례로 불러 합친다.
- 문서 몫: `save/documentSlot.ts`의 `createSheetsSaveActions(context)`가 `save`·`share`·`writeRecovery`를, `ai/documentSlot.ts`의 `createSheetsAiRun`이 `createAiRun`을 낸다. `workspace/document.ts`가 모은다. 암호를 풀어 연 문서는 그 위에서 늘 복구 사본을 쓰지 않는다.
- 격자: `SheetsGridAccess.grid`(문서가 살아 있는 동안의 `MobileGrid`), `.handle`(격자 화면이 떠 있는 동안 freeze·undo·redo·resetZoom).
- `window.desktopApi`: `desktop-api/index.ts`가 `read.ts`·`toolbar.ts`·`save.ts`·`ai.ts`를 펼친다. 자기 파일에 메서드를 더하면 된다.
- 문구: `i18n/sheets/<언어>.ts`는 다섯 구역(open·grid·toolbar·save·ai)을 펼치기만 한다. 자기 구역의 22개 언어 파일에 더하고, 키는 `zh`가 정한다.

## 열린 문서가 지키는 것

- `OpenedSheetsWorkbook.document.unlocked`(암호): 저장은 같은 암호로 다시 잠가 원본에 쓴다(`@genoffice/mobile-bridge/sheets`의 `sheetsEncrypt`, 작업 폴더 안 파일 → 파일). 잠기지 않은 바이트는 원본·복구 사본·공유로 내보내지 않는다. ODS는 PC처럼 거절한다. AI는 보통 문서처럼 쓴다.
- `document.converted`(.xls·.csv에서 온 세션): 첫 저장은 다른 이름으로 저장이다.
- 지금의 저장(`save/documentSlot.ts`)은 쓸 수 있는 `.xlsx`·`.xlsm`만 PC `handleSave`로 저장하고, 나머지는 "아직 저장할 수 없음"으로 멈춘다. XLS-T10이 바꾼다.

## 편집 기록(journal/)에서 아직 다시 적지 않은 PC 동작

PC `App.tsx`의 두 수신기(`journalDisposable`, `structuralDisposable`)를 옮겨 적었다. PC 글이 바뀌면 `tests/sheets-pc-journal-modules.test.ts`가 실패한다. 휴대폰에 화면이 없어 뺀 것:

- 차트·스파크라인 실시간 갱신, 댓글 스레드, 쪽 나눔 표시, 화면 그림 다시 그리기, AI 고친 칸 표시.
- 시트 복제(copy-sheet): 휴대폰은 내놓지 않으므로 막는다. 내놓으려면 PC처럼 원본 시트를 기억하는 기록이 필요하다.
- 정렬·필터 문지기의 "전체 불러오기" 제안과 큰 시트 필터: 지금은 PC 문장으로 알리고 막는다(XLS-T9가 제안 화면을 붙일 자리).
- 조건부 서식 규칙 문지기(1판은 보기만).
- 시트 바꾸기는 PC도 기록하지 않는다(저장할 것이 없음).
