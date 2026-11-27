/**
 * AI macro script drafting helper for the HWP macro editor.
 *
 * Security & privacy invariants:
 * - Sends ONLY the user's short description plus the static restricted §7.3
 *   grammar/API reference. Never sends document content or document metadata.
 * - Uses the shared provider selection (`selectAiProvider`) and shared AI IPC
 *   stream (`ai:stream` / `ai:stream-chunk`) with zero tools enabled. Never
 *   auto-switches to a paid, key-based, or unaccepted metered route.
 * - Returns the extracted script string only; callers must place it into the
 *   editor textarea for human review and must never auto-save or auto-run it.
 */
import type { AgentMessage } from '@genoffice/agent-core'
import type { AiSettings, AiStreamChunk, AiStreamRequest } from '@genoffice/ai-provider'
import {
  selectAiProvider,
  type AiProviderChoice,
  type AiProviderId,
  type AiSubscriptionStatuses,
} from '@genoffice/ai-provider/browser'
import type { Lang } from '@genoffice/i18n'
import { aiRunErrorText, isAiBlockedRunKind, type AiBlockedRunKind } from '@genoffice/ui'

/** Stream transport subset needed for single-turn AI macro drafting (injectable in tests). */
export interface MacroAiStreamClient {
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
}

export interface MacroAiBuiltPrompt {
  system: string
  messages: AgentMessage[]
}

export interface RequestAiMacroDraftParams {
  userPrompt: string
  lang: Lang
  settings: AiSettings
  statuses?: AiSubscriptionStatuses
  streamClient?: MacroAiStreamClient
  signal?: AbortSignal
}

export interface MacroAiBlockedInfo {
  kind: AiBlockedRunKind
  provider?: AiProviderId
  resetsAt?: number
}

export type RequestAiMacroDraftResult =
  | { ok: true; script: string }
  | {
      ok: false
      error: string
      cancelled?: boolean
      blocked?: MacroAiBlockedInfo
      notConnected?: Extract<AiProviderChoice, { connected: false }>
    }

const MACRO_AI_SYSTEM_BASE = `You write synchronous document macro scripts for a Hangul (.hwp / .hwpx) word processor.
Output ONLY a single JavaScript macro script inside one \`\`\`js code block (no explanation before or after).

## Allowed JavaScript Subset (Restricted Synchronous Interpreter)
- Variables: var, let, const
- Literals and collections: numbers, strings, booleans, null, undefined, plain objects, arrays
- Control flow: if / else, switch / case / default, for, while, do-while, break, continue, ternary (? :)
- Functions: function declarations and function expressions, return
- Errors: try / catch / finally, throw
- Safe built-ins: Math, String methods, Array methods, Object.keys/values/entries, JSON.parse/stringify, parseInt, parseFloat, isNaN, isFinite

## Strictly Forbidden (Will Fail Syntax or Runtime Checks)
- Do NOT use eval, Function, new, import, export, class, async, await, Promise, generators
- Do NOT access fetch, XMLHttpRequest, window, document, globalThis, process, require, setTimeout, setInterval
- Do NOT access __proto__, constructor, or prototype
- Do NOT call Undo or Redo (refused inside a macro; the entire macro runs in one atomic undo step)

## Available Direct Document API Globals
- Text & breaks:
  - insertText(text)
  - breakPara()
  - breakPage()
  - deleteSelection()
- Navigation & selection:
  - moveDocBegin(), moveDocEnd(), moveParaBegin(), moveParaEnd(), moveLineBegin(), moveLineEnd()
  - moveLeft(count?), moveRight(count?), moveUp(count?), moveDown(count?), moveWordLeft(count?), moveWordRight(count?)
  - select(fromSec, fromPara, fromOffset, toSec, toPara, toOffset)
  - selectAll(), cancelSelection()
  - getCaret() -> { sec, para, offset }
  - getSelection() -> { startSec, startPara, startOffset, endSec, endPara, endOffset, text } | null
- Formatting & styles:
  - setCharFormat({ bold?, italic?, underline?, strikethrough?, fontSize?, fontName?, textColor? })
  - setParaFormat({ align?: 'left'|'center'|'right'|'justify', lineSpacing?, leftMargin?, rightMargin?, firstLineIndent?, spaceBefore?, spaceAfter?, pageBreakBefore? })
  - applyStyle(nameOrId), listStyles() -> [{ id, name }]
- Search & replace:
  - find(query, { caseSensitive?, wholeWord?, regex?, style? }?) -> matches[]
  - replaceAll(query, replacement, { caseSensitive?, wholeWord?, regex?, style? }?) -> { replaced, skippedObjects, skippedCitations }
  - replaceNext(query, replacement, { caseSensitive?, wholeWord?, regex?, style? }?) -> { replaced, found }
- Tables, outline, refresh, and read helpers:
  - insertTable(rows, cols)
  - changeOutlineLevel(sec, para, delta, { singleOnly? }?) // delta is 1 or -1
  - refreshToc(kind?) // kind: 'body' | 'table' | 'figure' | 'equation'
  - refreshIndex(), refreshBibliography(), refreshAll()
  - getText(), getSectionCount(), getParagraphCount(sec?), getParagraphText(sec, para)
  - message(text) // shows a short status message to the user after the macro completes

## Compatible Macro Script Object (Optional Alternative)
- HAction.GetDefault(actionName, pset), HAction.Execute(actionName, pset), HAction.Run(actionName)
- HParameterSet: HInsertText, HCharShape, HParaShape, HStyle, HFindReplace, HTableCreation, HSelectionOpt
- Supported action names: InsertText, BreakPara, BreakPage, CharShape, ParagraphShape, ParaShape, Style, MoveDocBegin, MoveDocEnd, MoveParaBegin, MoveParaEnd, MoveLineBegin, MoveLineEnd, MoveLeft, MoveRight, MoveUp, MoveDown, Select, SelectAll, Cancel, AllReplace, FindReplace, RepeatFind, TableCreate

Prefer the concise direct API functions unless the user asks for the compatible macro script object form.`

/**
 * Build the system + user message payload for AI macro script drafting.
 * Carries ONLY the user's description and the static grammar/API reference
 * (never includes document content).
 */
export function buildMacroAiMessages(userPrompt: string, lang: Lang): MacroAiBuiltPrompt {
  const trimmed = userPrompt.trim()
  const system = `${MACRO_AI_SYSTEM_BASE}\n\nFor any user-facing message() text or brief inline comments, match the user's language (fallback locale: ${lang}).`
  return {
    system,
    messages: [{ role: 'user', text: trimmed }],
  }
}

/**
 * Extract the macro script from an AI reply.
 * Unwraps the first fenced code block if present, otherwise trims plain text.
 */
export function extractMacroScriptFromAiReply(reply: string): string {
  const raw = typeof reply === 'string' ? reply : ''
  const fenced = /```(?:[a-zA-Z0-9_-]*)?[ \t]*\r?\n([\s\S]*?)```/.exec(raw)
  if (fenced) {
    return fenced[1].trim()
  }
  return raw
    .replace(/^```(?:[a-zA-Z0-9_-]*)?[ \t]*\r?\n?/, '')
    .replace(/\r?\n?```\s*$/, '')
    .trim()
}

function defaultStreamClient(): MacroAiStreamClient | null {
  if (typeof window === 'undefined' || !window.hwpApi) return null
  const api = window.hwpApi
  if (
    typeof api.aiStream !== 'function' ||
    typeof api.aiStreamCancel !== 'function' ||
    typeof api.onAiStream !== 'function'
  ) {
    return null
  }
  return {
    aiStream: (request) => api.aiStream(request),
    aiStreamCancel: (requestId) => api.aiStreamCancel(requestId),
    onAiStream: (handler) => api.onAiStream(handler),
  }
}

function makeRequestId(): string {
  return `macro-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Request a single-turn AI macro script draft over the shared AI stream.
 * Never passes tools, never sends document text, and never auto-switches providers.
 */
export async function requestAiMacroDraft(
  params: RequestAiMacroDraftParams,
): Promise<RequestAiMacroDraftResult> {
  const { userPrompt, lang, settings, statuses, signal } = params
  const trimmedPrompt = userPrompt.trim()
  if (!trimmedPrompt) {
    return { ok: false, error: 'Prompt is empty.' }
  }
  if (signal?.aborted) {
    return { ok: false, error: 'Cancelled.', cancelled: true }
  }

  if (statuses !== undefined) {
    const choice = selectAiProvider(settings, statuses)
    if (!choice.connected) {
      return {
        ok: false,
        error: 'AI provider is not connected.',
        notConnected: choice,
      }
    }
  }

  const client = params.streamClient ?? defaultStreamClient()
  if (!client) {
    return { ok: false, error: 'AI stream is not available.' }
  }

  const { system, messages } = buildMacroAiMessages(trimmedPrompt, lang)
  const requestId = makeRequestId()

  return new Promise<RequestAiMacroDraftResult>((resolve) => {
    let settled = false
    let buffer = ''

    const cleanup = (): void => {
      off()
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    const finish = (result: RequestAiMacroDraftResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const onAbort = (): void => {
      void client.aiStreamCancel(requestId).catch(() => {})
      finish({ ok: false, error: 'Cancelled.', cancelled: true })
    }

    const off = client.onAiStream((chunk) => {
      if (chunk.requestId !== requestId) return
      if (chunk.type === 'delta' && typeof chunk.text === 'string') {
        buffer += chunk.text
        return
      }
      if (chunk.type === 'done') {
        const script = extractMacroScriptFromAiReply(buffer)
        if (!script) {
          finish({ ok: false, error: 'AI returned an empty macro script.' })
          return
        }
        finish({ ok: true, script })
        return
      }
      if (chunk.type === 'error') {
        const localized = chunk.errorCode
          ? aiRunErrorText(lang, {
              kind: chunk.errorCode,
              provider: chunk.errorProvider,
              resetsAt: chunk.errorResetsAt,
            })
          : undefined
        const errorText = localized || chunk.error || 'AI request failed.'
        const blocked: MacroAiBlockedInfo | undefined =
          chunk.errorCode && isAiBlockedRunKind(chunk.errorCode)
            ? {
                kind: chunk.errorCode,
                ...(chunk.errorProvider ? { provider: chunk.errorProvider } : {}),
                ...(typeof chunk.errorResetsAt === 'number'
                  ? { resetsAt: chunk.errorResetsAt }
                  : {}),
              }
            : undefined
        finish({ ok: false, error: errorText, ...(blocked ? { blocked } : {}) })
      }
    })

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const request: AiStreamRequest = {
      requestId,
      settings,
      system,
      messages,
    }

    void client.aiStream(request).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      finish({ ok: false, error: msg })
    })
  })
}
