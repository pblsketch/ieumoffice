# pdf-ops (`@genoffice/pdf-ops`)

## 맡은 범위

PC "PDF 도구" 창과 모바일 [도구] 화면이 함께 쓰는 PDF 도구 처리 코드다(모바일 1판 T3, 결정 0030의 도구 모음). 바이트를 받아 바이트를 돌려주는 함수들이다: 도구 규칙(`checkOptions`, `outputNames`, `runPdfTool` …), 분할, 페이지 범위, 이미지로 PDF, 양면 인쇄·배경 겹치기, 주석 지우기, 용량 줄이기, 빈 페이지 찾기, 복구, 암호 걸기·풀기(qpdf), PDFium 문서 열기, 그리고 모바일용 거울 함수(병합·추출·회전·쪽 지우기·텍스트 읽기).

공개 이름과 입출력의 약속은 `docs/plans/mobile-v1/T3.md`의 "공용 패키지 약속" 절에 있다.

## 맡지 않는 것 (경계)

- 파일 읽기·쓰기, 저장 창, 작업 프로세스, 진행 IPC는 부르는 쪽(PC 셸의 `apps/shell/src/main/pdf-tools/`, 모바일의 `apps/mobile/src/renderer/tools/engine/`)이 한다.
- PDFium과 qpdf는 이 패키지가 불러오지 않는다. 부르는 쪽이 만든 모듈을 넣어 준다(PC는 Node에서 wasm 파일을 읽고, 모바일은 앱 묶음의 wasm 주소로 부른다).
- 그림 해독·크기 조정·JPEG 인코딩(`ImageRecoder`)도 부르는 쪽이 넣는다(PC는 Chromium `nativeImage`, 모바일은 웹뷰 캔버스).
- `apps/pdf/src/main/save-pdf.ts`·`read-text.ts`·`text-edit.ts`는 원본(GenOffice)에서 함께 받아오는 파일이라 여기로 옮기지 않는다. 모바일이 필요한 그 함수는 같은 결과를 내는 거울 함수(`mirror-pages.ts`, `mirror-text.ts`)로 둔다.

## 항상 지켜야 하는 것

- `src/**`는 Node 내장 모듈(`node:*`, `fs`, `path`, `crypto`, `zlib`, `buffer`, `os`, `module`, `process`), `electron`을 가져오지 않고, 전역 `Buffer`·`process`·`require`·`__dirname`·`__filename`을 쓰지 않고, `apps/` 아래 파일을 가져오지 않는다. 네트워크(`fetch`, `XMLHttpRequest`, `WebSocket`)를 쓰지 않는다. `tests/no-node.test.ts`가 지킨다.
- PC 결과는 이 패키지로 옮기기 전과 같다. `apps/shell/tests/pdf-tools-golden.test.ts`의 기록 표를 바꾸지 않는다.
- 거울 함수는 PC 원래 함수와 같은 바이트(텍스트는 같은 글자)를 낸다. `tests/mirror-pages.test.ts`·`tests/mirror-text.test.ts`가 원래 함수와 맞춰 본다. 원본 받아오기로 원래 함수가 바뀌어 이 시험이 깨지면 거울 함수를 같이 고친다.
- 원래 자리(`apps/pdf/src/main/*.ts` 등)에서 옮긴 이름은 그 자리에서 같은 이름으로 다시 내보낸다. 가져오는 쪽은 고치지 않는다.

## 시험과 검사

- `npm run typecheck -w @genoffice/pdf-ops`, `npm run test -w @genoffice/pdf-ops`
- PC 쪽: `apps/pdf`, `apps/shell`의 vitest 전부, `npm run build -w @genoffice/shell`
