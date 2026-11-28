import { brandText, type Lang } from '@genoffice/i18n'

/**
 * Generates a structured markdown guide for external coding agents covering
 * `ieumoffice` CLI usage, MCP server setup, and bundled skill workflow.
 * Security invariant: contains ZERO secrets, API keys, OAuth tokens, emails,
 * or personal local file paths.
 */
export function buildCodingAgentGuide(lang: Lang): string {
  if (lang === 'ko') {
    return [
      `# ${brandText(lang, 'GenOffice')} 코딩 에이전트 연동 안내`,
      '',
      '## 1. 터미널 명령어 (`ieumoffice`)',
      '- 도움말 확인: `ieumoffice --help`',
      '- 문서 읽기·변환·편집: `ieumoffice read <파일>`, `ieumoffice convert <입력> <출력>`',
      '- 모든 작업은 로컬 파일 시스템에서 직접 수행되며 외부 서버로 문서를 전송하지 않습니다.',
      '',
      '## 2. MCP 서버 연결',
      '- 표준 입출력(stdio) MCP 서버로 연결해 워드·엑셀·파워포인트·한글·PDF·마크다운·HTML·마인드맵·다이어그램·화이트보드 도구를 호출할 수 있습니다.',
      '- 설정 → 연동의 **MCP 서버 설정 복사** 또는 **Claude Code 등록 명령**을 그대로 사용하세요.',
      '',
      '## 3. 에이전트 스킬 (`ieumoffice`)',
      '- 설정 → 연동에서 `ieumoffice` 스킬을 설치하면 문서 구조 파악과 안전한 편집 절차를 자동으로 따릅니다.',
      '- 주의: 문서 파일은 작업 전 백업을 권장하며, 비밀번호·인증 파일은 절대 명령에 포함하지 마세요.',
    ].join('\n')
  }

  return [
    `# ${brandText(lang, 'GenOffice')} Coding Agent Integration Guide`,
    '',
    '## 1. Command-line interface (`ieumoffice`)',
    '- Inspect available commands: `ieumoffice --help`',
    '- Read, edit, and convert documents locally: `ieumoffice read <file>`, `ieumoffice convert <input> <output>`',
    '- Everything runs locally on this machine; no document contents are sent to external servers.',
    '',
    '## 2. MCP server setup',
    '- Connect via stdio MCP to invoke Word, Excel, PowerPoint, Hangul, PDF, Markdown, HTML, Mindmap, Diagram, and Whiteboard tools.',
    '- Use **Copy MCP config** or the registration command in Settings -> Integrations.',
    '',
    '## 3. Agent skill (`ieumoffice`)',
    '- Install the bundled `ieumoffice` skill in Settings -> Integrations so your coding agent follows safe document-editing workflows.',
    '- Security reminder: never pass API keys, credentials, or auth files into document commands.',
  ].join('\n')
}
