import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, resolve } from 'node:path'
import { readHidingMemoLabel } from '@genoffice/agent-core/hiding-memo'
import { parseHidingName } from '@genoffice/agent-core/hiding-name'
import { sanitizeLabel } from '@genoffice/agent-core/redact-core'
import { hidingMarksOf, hwpMemosOf } from '@genoffice/file-parse'
import JSZip from 'jszip'
import { redactedDocxBytes } from '../formats/docx-hiding'
import { hiddenContentError } from '../hiding'
import { rhwpWasmPath } from '../resources'
import { toJsonError } from '../result'
import type { McpContext, Outcome } from './run'

/**
 * MCP tools that make a new file from a source document (`convert`, and the
 * same through `create_pdf`, `create_docx` / `create_xlsx` with `from`, and
 * `merge`'s template; `ToolSpec.source` names the parameter) do not use a
 * source that hides anything (민감정보 가리기).
 *
 * A client that only has MCP tools reads the new file with the read tools of
 * its format, and a format or a writer without a place for the mark would hand
 * it the hidden words: that is the one way round the hiding such a client has.
 * So a source with a mark, or one whose marks cannot be looked into
 * (`unknown`), is refused with `hidden_content`, `detail.reason: "convert"`.
 * The terminal's commands are not refused: a person and their scripts convert
 * their own files, and an agent with a shell can read the file directly anyway.
 */
export async function sourceRefusal(
  command: string,
  source: unknown,
  ctx: McpContext,
): Promise<Outcome | null> {
  const file = typeof source === 'string' ? source : ''
  if (!file) return null
  const path = isAbsolute(file) ? file : resolve(ctx.cwd, file)
  // a missing or unreadable file is the command's own error to report
  if (!existsSync(path) || !statSync(path).isFile()) return null
  const bytes = new Uint8Array(readFileSync(path))
  // the Hangul reader finds its engine this way in a packaged command line (formats/hwp.ts)
  if (/\.hwpx?$/i.test(path)) process.env.GENOFFICE_RHWP_WASM ??= rhwpWasmPath()
  const marks = await hidingMarksOf(path, bytes)
  if (marks === 'none') return null
  const labels = marks === 'marked' ? await hiddenLabelsOf(path, bytes) : []
  return { error: toJsonError(command, hiddenContentError('convert', labels)) }
}

const clean = (raw: string): string => sanitizeLabel(decodeEntities(raw)) || 'private'

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * The labels a marked file hides, for the refusal's `detail.labels`; best
 * effort: a label that cannot be told is left out, never guessed.
 */
export async function hiddenLabelsOf(path: string, bytes: Uint8Array): Promise<string[]> {
  const ext = extname(path).slice(1).toLowerCase()
  const text = () => new TextDecoder('utf-8').decode(bytes)
  const unique = (labels: string[]) => [...new Set(labels)]
  try {
    switch (ext) {
      case 'md':
      case 'markdown':
      case 'txt':
      case 'json':
        return unique(
          [...text().matchAll(/<span\b[^>]*\bdata-redaction\b[^>]*>/gi)].map((m) => {
            const label = /\bdata-label\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0])
            return clean(label?.[1] ?? label?.[2] ?? 'private')
          }),
        )
      case 'html':
      case 'htm':
        return unique([
          ...[
            ...text().matchAll(/\bdata-gx-redact(?:-[\w-]+)?\s*=\s*(?:"([^"]*)"|'([^']*)')/gi),
          ].map((m) => clean(m[1] ?? m[2] ?? '')),
          ...[...text().matchAll(/\/\*gx:redact:([^*]*)\*\//g)].map((m) => clean(m[1] ?? '')),
        ])
      case 'docx':
      case 'doc': {
        const { partLabels } = await redactedDocxBytes(bytes)
        return unique(Object.values(partLabels).flat())
      }
      case 'pptx': {
        const zip = await JSZip.loadAsync(bytes)
        const labels: string[] = []
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !/\.xml$/i.test(entry.name)) continue
          const xml = await entry.async('string')
          for (const m of xml.matchAll(/<go:redact\b[^>]*\blabel\s*=\s*"([^"]*)"/g)) {
            labels.push(clean(m[1] ?? ''))
          }
        }
        return unique(labels)
      }
      case 'xlsx':
      case 'xlsm': {
        const zip = await JSZip.loadAsync(bytes)
        const workbook = (await zip.file(/^xl\/workbook\.xml$/i)[0]?.async('string')) ?? ''
        return unique(
          [...workbook.matchAll(/<(?:[\w.-]+:)?definedName\b[^>]*?\bname\s*=\s*(["'])(.*?)\1/g)]
            .map((m) => parseHidingName(decodeEntities(m[2] ?? ''))?.label)
            .filter((label): label is string => typeof label === 'string'),
        )
      }
      case 'hwp':
      case 'hwpx':
        return unique(
          (await hwpMemosOf(bytes))
            .map((memo) => readHidingMemoLabel(String(memo.text ?? '')))
            .filter((label): label is string => label !== null),
        )
      default:
        return []
    }
  } catch {
    return []
  }
}
