# 엑셀 편집기의 자리 (트랙 T1)

XLS-T7이 편집기 종류·열기·문서 뼈대를 깔았고, XLS-T8~T11이 자기 줄을 채웠고, XLS-T12가 마무리했다(1판 완성). 아래 표는 구역마다 맡은 파일이다. 뒤에 고치는 사람도 이 나눔을 따르면 서로 다른 구역의 줄이 섞이지 않는다. 뼈대(`kind.ts`, `open/`, `workspace/`, `journal/`, `session.ts`)를 고치면 커밋 메시지에 적는다. 규칙 전체는 `apps/mobile/AGENTS.md`의 "T1 엑셀 (1판)" 절에 있다.

| 태스크                | 고치는 파일                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XLS-T8 격자           | `grid/**`(그중 화면 몫은 `grid/workspaceSlot.tsx`; 보기 모드 막기 `grid/viewModeGuard.ts`, 가상 키보드는 칸 편집 때만 `grid/keyboardHold.ts`는 XLS-T12), 읽기 메서드 `desktop-api/read.ts`, 문구 `i18n/sheets/grid/<언어>.ts` |
| XLS-T9 도구 막대      | `toolbar/**`(화면 몫은 `toolbar/workspaceSlot.tsx`), `desktop-api/toolbar.ts`, 문구 `i18n/sheets/toolbar/<언어>.ts`                                                                                                           |
| XLS-T10 저장·내보내기 | `save/**`(문서 몫은 `save/documentSlot.ts`, 화면 몫은 `save/workspaceSlot.tsx`), `pdf/**`, `convert/**`, `desktop-api/save.ts`, 문구 `i18n/sheets/save/<언어>.ts`                                                             |
| XLS-T11 AI            | `ai/**`(문서 몫 `ai/documentSlot.ts`의 `createSheetsAiRun`, 화면 몫 `ai/workspaceSlot.tsx`), `desktop-api/ai.ts`, 문구 `i18n/sheets/ai/<언어>.ts`                                                                             |
| XLS-T7                | `kind.ts`, `open/**`, `session.ts`, `workspace/**`, `journal/**`(PC 상태 줄 거르기 `journal/statusLines.ts`는 XLS-T12), 문구 `i18n/sheets/open/<언어>.ts`                                                                     |

## 끼우는 자리의 모양

- 화면 몫(`*/workspaceSlot.tsx`): `SheetsWorkspaceSlot` 훅. `SheetsWorkspaceContext`(host, opened, grid, mode, canEdit, lang, theme, t)를 받아 `quickActions`·`formatGroups`·`viewTools`·`moreItems`·`overlay`를 돌려준다. `workspace/SheetsWorkspace.tsx`가 격자 → 도구 → 저장 → AI 차례로 불러 합친다.
- 문서 몫: `save/documentSlot.ts`의 `createSheetsSaveActions(context)`가 `save`·`share`·`writeRecovery`를, `ai/documentSlot.ts`의 `createSheetsAiRun`이 `createAiRun`을 낸다. `workspace/document.ts`가 모은다. 암호를 풀어 연 문서는 그 위에서 늘 복구 사본을 쓰지 않는다.
- 격자: `SheetsGridAccess.grid`(문서가 살아 있는 동안의 `MobileGrid`), `.handle`(격자 화면이 떠 있는 동안 freeze·undo·redo·resetZoom).
- `window.desktopApi`: `desktop-api/index.ts`가 `read.ts`·`toolbar.ts`·`save.ts`·`ai.ts`를 펼친다. 자기 파일에 메서드를 더하면 된다.
- 문구: `i18n/sheets/<언어>.ts`는 다섯 구역(open·grid·toolbar·save·ai)을 펼치기만 한다. 자기 구역의 22개 언어 파일에 더하고, 키는 `zh`가 정한다.

## 열린 문서가 지키는 것

- `OpenedSheetsWorkbook.document.unlocked`(암호): 저장은 같은 암호로 다시 잠가 원본에 쓴다(`@genoffice/mobile-bridge/sheets`의 `sheetsEncrypt`, 작업 폴더 안 파일 → 파일). 잠기지 않은 바이트는 원본·복구 사본·공유로 내보내지 않는다. ODS는 PC처럼 거절한다. AI는 보통 문서처럼 쓴다.
- `document.converted`(.xls·.csv에서 온 세션): 첫 저장은 다른 이름으로 저장이다.
- 닫기(`OpenedSheetsWorkbook.close`): 저장마다 바뀌는 엔진 세션은 문서의 주인 표시(`MobileWorkbookSession.owner`)를 이어받는다. 닫기는 그 표시가 붙은 세션을 모두 닫고 암호를 버린다. 세션을 새로 만드는 길을 더하면 `owner`를 꼭 옮긴다.
- 저장(`save/documentSlot.ts`)은 PC `handleSave`·`handleExportCsv`·`handleExportOds`를 그대로 부르고, 휴대폰 `desktopApi`가 받는다. 쓸 수 있는 `.xlsx`·`.xlsm`은 원본에, `.xls`·읽기 전용·제목 없음·되살린 문서는 `원래이름.xlsx`(매크로면 `.xlsm`)를 채운 다른 이름으로 저장으로 간다. `.csv`는 저장할 때마다 CSV·엑셀·취소를 묻는다(CSV는 세션에 먼저 넣고 원본에 마지막으로 쓴다. 읽기 전용이면 새 파일로 내보낸다). 한 문서에 저장 일은 한 번에 하나다(저장 중 복구 사본은 건너뛰고, 두 번째 저장은 `sheetsSaveBusy`로 거절).
- 보기 모드는 고치지 않는다: Univer의 칸 길게 누르기 메뉴를 끄고, 편집 기록이 기록하는 변경(`journalListensTo`)은 무엇이 보냈든 취소한다(`grid/viewModeGuard.ts`). 확대·틀 고정과 불러오기 쓰기는 지나간다. 되돌리기·다시 하기는 AI 창의 한 번 되돌리기(`withAiUndoPass`)만 지나가고, 키보드 Ctrl+Z 같은 나머지는 취소한다.
- PC 상태 표시줄 글 가운데 진행·확인 줄(스트리밍·색인·재계산 대체·"적용했습니다")은 알림으로 띄우지 않는다(`journal/statusLines.ts`). 문지기의 거절과 오류는 알림이다.

## 편집 기록(journal/)에서 아직 다시 적지 않은 PC 동작

PC `App.tsx`의 두 수신기(`journalDisposable`, `structuralDisposable`)를 옮겨 적었다. PC 글이 바뀌면 `tests/sheets-pc-journal-modules.test.ts`가 실패한다. 휴대폰에 화면이 없어 뺀 것:

- 차트·스파크라인 실시간 갱신, 댓글 스레드, 쪽 나눔 표시, 화면 그림 다시 그리기, AI 고친 칸 표시.
- 시트 복제(copy-sheet): 휴대폰은 내놓지 않으므로 막는다. 내놓으려면 PC처럼 원본 시트를 기억하는 기록이 필요하다.
- 정렬·필터 문지기의 "전체 불러오기" 제안: 도구 막대가 명령을 보내기 전에 같은 판정으로 묻는다(`toolbar/runRibbon.ts`). 격자의 필터 단추처럼 다른 길로 오면 문지기가 PC 문장으로 막는다. 큰 시트 필터(PC `large-filter`)는 1판에 없다.
- 조건부 서식 규칙 문지기(1판은 보기만).
- 시트 바꾸기는 PC도 기록하지 않는다(저장할 것이 없음).
