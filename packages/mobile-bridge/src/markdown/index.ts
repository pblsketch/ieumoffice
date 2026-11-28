import type { AgentSkill, AgentToolCall, AgentToolDef, ToolExecution } from '@genoffice/agent-core'
import { brandText } from '@genoffice/i18n'
import { MobileCommandError, type MobileClient, type MobileDocSession } from '../transport'
import {
  wrapSkillWithViewEditGate,
  type DocumentEditCapabilities,
  type DocumentMode,
} from '../view-edit-gate'

export const MAX_MOBILE_INLINE_IMAGE_BYTES = 5 * 1024 * 1024

const MIME_ALIASES: Readonly<Record<string, string>> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
}

export const ALLOWED_MOBILE_IMAGE_MIMES: ReadonlySet<string> = new Set(Object.values(MIME_ALIASES))

export interface UnsupportedMobileResult {
  readonly ok: false
  readonly error: 'unsupported-on-mobile'
}

const UNSUPPORTED_ON_MOBILE: UnsupportedMobileResult = {
  ok: false,
  error: 'unsupported-on-mobile',
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

export function base64ToUtf8(b64: string): string {
  return new TextDecoder('utf-8').decode(base64ToBytes(b64))
}

export interface InlineImageInput {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly alt?: string
  readonly maxBytes?: number
}

/**
 * Validates image MIME and byte limit (default 5 MiB) and encodes it as inline
 * `![alt](data:<mime>;base64,...)` markdown syntax so single-file `.md` sharing preserves images.
 */
export function inlineImageToMarkdown(input: InlineImageInput): string {
  const normalizedMime = MIME_ALIASES[input.mime.trim().toLowerCase()]
  if (!normalizedMime) {
    throw new MobileCommandError({
      code: 'INVALID_ARGUMENT',
      messageKey: 'imageUnsupportedTypeError',
      detail: `Unsupported image MIME type: ${input.mime}`,
    })
  }
  const limit = input.maxBytes ?? MAX_MOBILE_INLINE_IMAGE_BYTES
  if (input.bytes.byteLength > limit) {
    throw new MobileCommandError({
      code: 'FILE_TOO_LARGE',
      messageKey: 'imageTooLargeError',
      detail: `Image exceeds ${limit} byte limit (${input.bytes.byteLength} bytes).`,
    })
  }
  const safeAlt = (input.alt ?? '').replace(/[\r\n[\]]/g, '').trim()
  return `![${safeAlt}](data:${normalizedMime};base64,${bytesToBase64(input.bytes)})`
}

const RELATIVE_IMAGE_PATTERN =
  /!\[[^\]]*\]\(((?!https?:\/\/|data:|blob:|mailto:)[^)\s]+(?:\s+"[^"]*")?)\)/g

/**
 * Preserves existing relative markdown image syntax verbatim across edits when an editor
 * serializer might otherwise normalize or strip relative paths.
 */
export function preserveRelativeImageLinks(originalSource: string, updatedSource: string): string {
  const originalByPath = new Map<string, string>()
  for (const match of originalSource.matchAll(RELATIVE_IMAGE_PATTERN)) {
    const full = match[0]
    const target = match[1]?.trim()
    if (target) originalByPath.set(target, full)
  }
  if (originalByPath.size === 0) return updatedSource
  return updatedSource.replace(RELATIVE_IMAGE_PATTERN, (full, target: string) => {
    const trimmed = target.trim()
    return originalByPath.get(trimmed) ?? full
  })
}

export interface MobileMarkdownApiOptions {
  readonly maxInlineImageBytes?: number
}

export interface MobileMarkdownApi {
  readDocument(session: MobileDocSession): Promise<{ readonly text: string }>
  saveDocument(session: MobileDocSession, markdownText: string): Promise<{ readonly ok: true }>
  saveAsDocument(
    session: MobileDocSession | null,
    suggestedName: string,
    markdownText: string,
  ): Promise<MobileDocSession>
  shareDocument(session: MobileDocSession, markdownText: string): Promise<{ readonly ok: boolean }>
  writeRecovery(session: MobileDocSession, markdownText: string): Promise<{ readonly ok: boolean }>
  discardRecovery(docKey: string): Promise<{ readonly ok: boolean }>
  insertInlineImage(input: Omit<InlineImageInput, 'maxBytes'>): string
  // Explicitly closed desktop-only Markdown features (Spec §2.3 & §4.3)
  listWikiNotes(): Promise<[]>
  resolveWikiLinks(): Promise<[]>
  wikiBacklinks(): Promise<[]>
  wikiTags(): Promise<[]>
  uploadImage(): Promise<UnsupportedMobileResult>
  exportPdf(): Promise<UnsupportedMobileResult>
  exportDocx(): Promise<UnsupportedMobileResult>
  exportOdt(): Promise<UnsupportedMobileResult>
  exportHwp(): Promise<UnsupportedMobileResult>
  printDocument(): Promise<UnsupportedMobileResult>
}

export function createMobileMarkdownApi(
  client: MobileClient,
  options: MobileMarkdownApiOptions = {},
): MobileMarkdownApi {
  const maxInlineImageBytes = options.maxInlineImageBytes ?? MAX_MOBILE_INLINE_IMAGE_BYTES

  return {
    async readDocument(session) {
      const result = await client.readFileBytes(session.sessionId)
      return { text: base64ToUtf8(result.bytesBase64) }
    },

    async saveDocument(session, markdownText) {
      if (!session.writable || session.ephemeral) {
        throw new MobileCommandError({
          code: 'READ_ONLY_URI',
          messageKey: 'readonlyShareNotice',
          detail: 'Read-only or ephemeral URI requires Save As.',
        })
      }
      await client.saveFileBytes(session.sessionId, utf8ToBase64(markdownText))
      await client.recoveryDiscard(session.docKey).catch(() => {})
      return { ok: true }
    },

    async saveAsDocument(session, suggestedName, markdownText) {
      const format = session?.format === 'txt' ? 'txt' : 'md'
      const nextSession = await client.saveAsFileBytes({
        sessionId: session?.sessionId,
        suggestedName,
        format,
        bytesBase64: utf8ToBase64(markdownText),
      })
      if (session) {
        await client.recoveryDiscard(session.docKey).catch(() => {})
      }
      return nextSession
    },

    async shareDocument(session, markdownText) {
      return client.shareFile({
        sessionId: session.sessionId,
        suggestedName: session.name,
        mode: 'edited',
        bytesBase64: utf8ToBase64(markdownText),
      })
    },

    async writeRecovery(session, markdownText) {
      return client.recoveryWrite({
        docKey: session.docKey,
        format: session.format === 'txt' ? 'txt' : 'md',
        title: session.name,
        bytesBase64: utf8ToBase64(markdownText),
      })
    },

    async discardRecovery(docKey) {
      return client.recoveryDiscard(docKey)
    },

    insertInlineImage(input) {
      return inlineImageToMarkdown({ ...input, maxBytes: maxInlineImageBytes })
    },

    async listWikiNotes() {
      return []
    },
    async resolveWikiLinks() {
      return []
    },
    async wikiBacklinks() {
      return []
    },
    async wikiTags() {
      return []
    },
    async uploadImage() {
      return UNSUPPORTED_ON_MOBILE
    },
    async exportPdf() {
      return UNSUPPORTED_ON_MOBILE
    },
    async exportDocx() {
      return UNSUPPORTED_ON_MOBILE
    },
    async exportOdt() {
      return UNSUPPORTED_ON_MOBILE
    },
    async exportHwp() {
      return UNSUPPORTED_ON_MOBILE
    },
    async printDocument() {
      return UNSUPPORTED_ON_MOBILE
    },
  }
}

export interface MobileMarkdownEditorPort {
  readonly getMarkdown: () => string
  readonly setMarkdown: (next: string) => void
}

export interface MobileMarkdownSkillGate {
  readonly getMode: () => DocumentMode
  readonly getCapabilities: () => DocumentEditCapabilities
  readonly switchToEdit: () => void | Promise<void>
  readonly onAutoSwitchedToEdit?: (toolName: string) => void
  readonly onDocumentMutated?: (summary: string, prevMarkdown: string, nextMarkdown: string) => void
}

const MOBILE_MARKDOWN_TOOLS: AgentToolDef[] = [
  {
    name: 'read_document',
    description: 'Read the full Markdown text of the open document.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'replace_text',
    description: 'Replace an exact text occurrence in the open Markdown document.',
    inputSchema: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'Exact text to replace.' },
        replace: { type: 'string', description: 'Replacement Markdown text.' },
        replaceAll: { type: 'boolean', description: 'Replace every occurrence when true.' },
      },
      required: ['find', 'replace'],
    },
  },
  {
    name: 'append_markdown',
    description: 'Append Markdown content to the end of the document.',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Markdown block(s) to append.' },
      },
      required: ['markdown'],
    },
  },
  {
    name: 'replace_document',
    description: 'Replace the entire Markdown document with revised content.',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Complete revised Markdown text.' },
      },
      required: ['markdown'],
    },
  },
]

const MARKDOWN_MUTATING_TOOLS = new Set(['replace_text', 'append_markdown', 'replace_document'])

export function createMobileMarkdownSkill(
  editor: MobileMarkdownEditorPort,
  gate: MobileMarkdownSkillGate,
): AgentSkill {
  const baseSkill: AgentSkill = {
    id: 'mobile-markdown',
    systemPrompt: [
      brandText('You are the writing assistant inside GenOffice Mobile Markdown editor.', 'en'),
      'You may only inspect and edit the currently open Markdown document.',
      'Use read_document to inspect content, and replace_text, append_markdown, or replace_document for edits.',
      'Keep existing relative image links intact and never emit raw HTML tags.',
    ].join('\n'),
    tools: MOBILE_MARKDOWN_TOOLS,
    buildContext() {
      const text = editor.getMarkdown()
      const preview = text.length > 6000 ? `${text.slice(0, 6000)}\n...[truncated]` : text
      return `Current Markdown document (${text.length} chars):\n\n${preview}`
    },
    executeTool(call: AgentToolCall): ToolExecution {
      if (call.name === 'read_document') {
        return {
          output: editor.getMarkdown(),
          mutated: false,
          summary: 'Read Markdown document',
        }
      }
      if (call.name === 'replace_text') {
        const find = typeof call.input.find === 'string' ? call.input.find : ''
        const replace = typeof call.input.replace === 'string' ? call.input.replace : ''
        const replaceAll = call.input.replaceAll === true
        if (!find) {
          return { output: 'Missing non-empty "find" text.', isError: true, summary: call.name }
        }
        const prev = editor.getMarkdown()
        if (!prev.includes(find)) {
          return { output: `Text not found: ${find}`, isError: true, summary: call.name }
        }
        const rawNext = replaceAll ? prev.split(find).join(replace) : prev.replace(find, replace)
        const next = preserveRelativeImageLinks(prev, rawNext)
        editor.setMarkdown(next)
        gate.onDocumentMutated?.(`Replaced "${find.slice(0, 24)}"`, prev, next)
        return { output: 'Replaced text in document.', mutated: true, summary: 'Replace text' }
      }
      if (call.name === 'append_markdown') {
        const addition = typeof call.input.markdown === 'string' ? call.input.markdown : ''
        if (!addition.trim()) {
          return {
            output: 'Missing markdown content to append.',
            isError: true,
            summary: call.name,
          }
        }
        const prev = editor.getMarkdown()
        const sep = prev.endsWith('\n') || prev.length === 0 ? '' : '\n\n'
        const next = `${prev}${sep}${addition}`
        editor.setMarkdown(next)
        gate.onDocumentMutated?.('Appended markdown content', prev, next)
        return { output: 'Appended content to document.', mutated: true, summary: 'Append content' }
      }
      if (call.name === 'replace_document') {
        const rawNext = typeof call.input.markdown === 'string' ? call.input.markdown : ''
        const prev = editor.getMarkdown()
        const next = preserveRelativeImageLinks(prev, rawNext)
        editor.setMarkdown(next)
        gate.onDocumentMutated?.('Updated document content', prev, next)
        return { output: 'Updated full document.', mutated: true, summary: 'Update document' }
      }
      return { output: `Unknown tool: ${call.name}`, isError: true, summary: call.name }
    },
  }

  return wrapSkillWithViewEditGate(baseSkill, {
    isMutatingTool: (name) => MARKDOWN_MUTATING_TOOLS.has(name),
    getMode: gate.getMode,
    getCapabilities: gate.getCapabilities,
    switchToEdit: gate.switchToEdit,
    onAutoSwitchedToEdit: gate.onAutoSwitchedToEdit,
  })
}
