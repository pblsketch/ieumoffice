# 0171. 모바일 1판 바탕 공사: 편집기 등록표, 트랙 자리 분리, 열 수 있는 형식 문지기

- 날짜: 2026-11-26
- 상태: 모바일 1판(배포 전)

## 맥락

결정 [0165](0165-mobile-scope-and-design-system.md)로 모바일 1판 범위가 정해진 뒤, 엑셀·PDF·PDF 도구·HTML/마크다운·EPUB/PPT·홈/설정·AI의 일곱 트랙을 병렬로 개발해야 했다. 기존 `apps/mobile`은 한글과 마크다운 두 편집기만 `App.tsx` 안에 직접 분기하고, 설정·문구·다리·Rust 명령·네이티브 설정이 공용 파일에 모여 있어 여러 트랙이 같은 줄을 고치면 병합 충돌이 반복될 구조였다. 또 1판 형식을 형식 목록에 미리 넣으면 아직 편집기가 등록되지 않은 파일이 마크다운으로 잘못 열릴 위험이 있었다.

## 결정

1. **편집기 등록표와 미리 이어 둔 트랙 자리.** 형식마다 종류(`EditorKind`, `editors/editorKind.ts`) 하나가 열기·저장·공유·복구 사본·AI 스킬·도구 막대·편집 화면을 갖는다. 한글(`editors/hwpKind.tsx`)과 마크다운(`editors/markdownKind.tsx`)을 이 등록표(`editors/registry.ts`)로 옮기고, `App.tsx`는 등록표에서 종류를 찾아 부르기만 한다. 트랙은 자기 폴더 파일(`editors/{sheets,pdf,html,readers}/`, `i18n/<트랙>/`, `components/icons/`, `config/tracks/<트랙>.ts`, `packages/mobile-bridge/src/<트랙>/`, `src-tauri/src/commands/<트랙>.rs`)만 채우고, 공용 파일(`lib.rs`, `Cargo.toml`, `native-config`)은 정해 둔 트랙 표시 주석 아래에만 더한다.
2. **열 수 있는 형식은 등록표 한 곳이 정하고 Rust가 지킨다.** 화면이 등록된 확장자 목록을 Rust에 알리고(`mobile_set_openable_formats`), Rust가 최근 목록에 넣기 전에 열 수 없는 형식을 거절한다(`mobile.format.notOpenable`). 등록되지 않은 1판 형식 여덟(pdf·html/htm·xlsx·xlsm·xls·csv·epub·pptx)은 "이 파일 형식은 열 수 없습니다" 알림을 띄우고 최근 목록에 넣지 않는다. 목록을 알리지 않으면 기존 Rust 시험과 가짜 다리를 깨뜨리지 않도록 모두 받는다. 문지기는 사람이 여는 길(파일 고르기·최근 목록·다른 앱에서 받기)에만 걸리고, 다른 이름으로 저장과 백업 사본 복원은 거치지 않는다.
3. **`App.tsx` 분리.** 바탕 공사 뒤 트랙이 `App.tsx`를 함께 고치지 않도록 AI 실행(`ai/useMobileAi.ts`), 들어온 문서(`home/incoming.ts`), 홈의 앱 호출 인터페이스(`home/homeHost.ts`), 설정 AI 자리(`ai/settingsSlot.ts`), 설정 절 파일(`settings/sections/`), 홈 탭 자리(`home/homeTabs.ts`, `ToolsTab.tsx`, `FoldersTab.tsx`)를 트랙 폴더로 분리한다.
4. **"다른 앱에서 열기" 선언은 각 편집기 트랙이 넣는다.** 바탕 공사 시점에는 Android 인텐트 필터와 iOS 문서 형식 선언에 1판 형식을 미리 넣지 않는다. 각 편집기 트랙이 자기 편집기를 등록할 때 정해진 표시 주석 아래에 형식을 더한다.

## 버린 대안

- **형식마다 `App.tsx`에서 `switch`로 분기:** 트랙마다 `App.tsx`를 고쳐야 해 병렬 작업이 충돌한다.
- **편집 화면을 문서마다 열어 둔 채 숨기기:** 뒤로 가기 쌓기(`useBackLayer`)가 엉키고, 한글 쪽 편집기가 다시 싣던 기존 동작이 바뀐다.
- **바탕 공사에서 "다른 앱에서 열기"에 1판 형식을 미리 선언:** 편집기가 없는 상태에서 휴대폰의 앱 고르기 창에 이음오피스가 노출되어 열지 못하는 파일을 받게 된다.

## 결과

- 화면과 기존 한글·마크다운 동작은 그대로 유지하면서 일곱 트랙이 독립 가지에서 작업할 수 있는 경계가 마련됐다.
- 아직 편집기가 등록되지 않은 1판 형식 파일이 깨진 마크다운으로 열리거나 최근 목록에 쌓이지 않는다.
- 1판 형식이 모두 등록된 뒤 알 수 없는 확장자(`.docx` 등)까지 문지기로 거절할지는 통합 수정 단계에서 정리한다.
