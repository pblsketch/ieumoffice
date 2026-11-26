/**
 * The Hangul document tools of the AI on mobile: the PC editor's skill
 * (apps/hwp/src/renderer/ai/hwp-skill.ts) over the same studio plugin
 * (`ieum-agent`), which the mobile page editor already carries. Loaded only
 * when the AI runs (AI is off by default on mobile), so the skill and its
 * labels in 22 languages stay out of the app's first load.
 *
 * The web, picture and photo tools run on the shared mobile AI tools
 * (ai/tools, T7.md section 1): the skill asks them whether they can run at
 * every look, and calls them through `window.hwpApi`, which during a run is a
 * stand-in answering in the PC Hangul preload's shapes. Pictures go in through
 * the plugin, as on the PC. An edit that would remove a memo is refused (the
 * memo panel's yes/no is not on the phone).
 */
import { createI18n, type Lang } from '@genoffice/i18n'
import type { AgentSkill } from '@genoffice/agent-core'
import type { AgentBridge } from '../../../../hwp/src/renderer/ai/agent-bridge'
import {
  createHwpSkill,
  HWP_EDIT_TOOLS,
  type HwpChange,
} from '../../../../hwp/src/renderer/ai/hwp-skill'
import { hwpChangeCount, undoOutcome } from '../../../../hwp/src/renderer/ai/run-changes'
import { aiLangDirective } from '../../../../hwp/src/renderer/i18n/locale'
import { strings } from '../../../../hwp/src/renderer/i18n/strings'
import type { HwpApi } from '../../../../hwp/src/shared/ipc'
import { getMobileAiTools, isMobileAiToolError, type MobileAiPicture } from './tools'
import { base64ToBytes, bytesToBase64 } from './tools/pictures'

const label = createI18n(strings)

/** Calls one method of the page editor's plugin (HwpMobileEditor.callPlugin). */
export type PluginCall = (method: string, ...args: unknown[]) => Promise<unknown>

/** What one run changed, and the way to take it back. */
export interface MobileHwpRunChanges {
  /** places changed (a replace-all or filled cells count each place) */
  readonly places: number
  /** takes the run back in the page editor: all of it, part of it, or none of it */
  readonly undo: () => Promise<'reverted' | 'partial' | 'refused'>
}

export interface MobileHwpAgent {
  /** the PC skill, without the view/edit gate (the caller wraps it) */
  readonly skill: AgentSkill
  /** the tools that change the document */
  readonly editTools: ReadonlySet<string>
  /** Before a run: forgets the last run and reads the document state the message goes with. */
  begin(): Promise<void>
  /** After a run: what it changed, or null when it changed nothing. */
  finish(): MobileHwpRunChanges | null
}

/** The plugin's methods, each one a call through the page editor. */
function pluginBridge(call: PluginCall): AgentBridge {
  return new Proxy({} as AgentBridge, {
    get: (_target, method) =>
      typeof method === 'string' ? (...args: unknown[]) => call(method, ...args) : undefined,
  })
}

/** The `window.hwpApi` methods the PC skill calls for the web, pictures and attachments. */
type HwpToolApi = Pick<
  HwpApi,
  | 'webSearch'
  | 'readUrl'
  | 'imageSearch'
  | 'fetchImage'
  | 'generateImage'
  | 'analyzeMedia'
  | 'readAttachmentImage'
>

function failure(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err)
  return `The tool failed: ${detail.slice(0, 300)}`
}

/** `data:<type>;base64,<bytes>` as a picture; null for anything else. */
function pictureOfDataUrl(url: string): MobileAiPicture | null {
  const match = /^data:([^;,]+)(?:;[^;,]+)*;base64,(.*)$/s.exec(url)
  if (!match) return null
  try {
    return { mime: match[1]!.toLowerCase(), bytes: base64ToBytes(match[2]!) }
  } catch {
    return null
  }
}

/**
 * The shared mobile AI tools in the shapes the PC Hangul preload answers
 * (apps/hwp/src/shared/ipc.ts HwpApi). Never throws, like the main process's
 * handlers: a failure is the PC failure shape. Attachments are the AI sheet's
 * photos, by id where the PC has a path.
 */
function mobileHwpToolApi(): HwpToolApi {
  const tools = () => getMobileAiTools()
  return {
    async webSearch(query, maxResults) {
      try {
        const answer = await tools().webSearch(query, maxResults)
        if (isMobileAiToolError(answer)) {
          return { results: [], method: 'error', error: answer.error }
        }
        return { results: [...answer.results], method: answer.method }
      } catch (err) {
        return { results: [], method: 'error', error: failure(err) }
      }
    },
    async imageSearch(query, maxResults) {
      try {
        const answer = await tools().imageSearch(query, maxResults)
        if (isMobileAiToolError(answer)) {
          return { images: [], method: 'error', error: answer.error }
        }
        return {
          images: answer.images.map((image) => ({
            title: image.title,
            imageUrl: image.imageUrl,
            ...(image.width !== undefined ? { width: image.width } : {}),
            ...(image.height !== undefined ? { height: image.height } : {}),
          })),
          method: answer.method,
        }
      } catch (err) {
        return { images: [], method: 'error', error: failure(err) }
      }
    },
    async readUrl(url, offset) {
      try {
        const answer = await tools().readUrl(url, offset)
        if (isMobileAiToolError(answer)) {
          return { ok: false, error: answer.error, errorCode: answer.errorCode }
        }
        return { ok: true, ...answer }
      } catch (err) {
        return { ok: false, error: failure(err), errorCode: 'failed' }
      }
    },
    async fetchImage(url) {
      try {
        // a public address, or the result store address a picture just made came back with
        const answer = await tools().fetchImage(url)
        if (isMobileAiToolError(answer)) return null
        return { base64: bytesToBase64(answer.bytes), mime: answer.mime }
      } catch {
        return null
      }
    },
    async generateImage(op) {
      try {
        const answer = await tools().generateImage({
          prompt: op.prompt,
          ...(op.aspectRatio ? { size: op.aspectRatio } : {}),
          ...(op.model ? { model: op.model } : {}),
        })
        if (isMobileAiToolError(answer)) {
          return { error: answer.error, errorCode: answer.errorCode }
        }
        // the skill reads the picture back with fetchImage(url), from the result store
        return { url: answer.url }
      } catch (err) {
        return { error: failure(err), errorCode: 'failed' }
      }
    },
    async analyzeMedia(op) {
      try {
        const images: MobileAiPicture[] = []
        for (const url of op.mediaUrls) {
          const picture = pictureOfDataUrl(url)
          if (!picture) return { error: 'Only pictures given as data URLs can be looked at.' }
          images.push(picture)
        }
        const answer = await tools().analyzeMedia({ prompt: op.requirements, images })
        if (isMobileAiToolError(answer)) {
          // the PC code list has "unavailable" and the chat errors; the others say it in words
          return answer.errorCode === 'unavailable'
            ? { error: answer.error, errorCode: 'unavailable' }
            : { error: answer.error }
        }
        return { text: answer.text }
      } catch (err) {
        return { error: failure(err) }
      }
    },
    async readAttachmentImage(id) {
      try {
        const photo = tools()
          .attachments()
          .find((attached) => attached.id === id)
        if (!photo) return { ok: false, error: 'That photo is no longer attached to this chat.' }
        if (!photo.mime.toLowerCase().startsWith('image/')) {
          return { ok: false, error: 'That attachment is not a picture.' }
        }
        return { ok: true, base64: bytesToBase64(photo.bytes), mime: photo.mime }
      } catch (err) {
        return { ok: false, error: failure(err) }
      }
    },
  }
}

/** The stand-in on `window.hwpApi` and what it replaced; one at a time for the app. */
interface InstalledToolApi {
  readonly standIn: object
  readonly had: boolean
  readonly original: unknown
}

let installed: InstalledToolApi | null = null

function hostWindow(): { hwpApi?: unknown } {
  return window as unknown as { hwpApi?: unknown }
}

/** Puts back what `which` replaced, unless another stand-in or value took its place since. */
function restoreToolApi(which: InstalledToolApi): void {
  if (installed !== which) return
  installed = null
  const host = hostWindow()
  if (host.hwpApi !== which.standIn) return
  if (which.had) host.hwpApi = which.original
  else delete host.hwpApi
}

/** Lays the stand-in over `window.hwpApi`, keeping the members it does not replace. */
function installToolApi(): InstalledToolApi {
  // a run that never finished (preparing it failed after begin) left its stand-in: undo it first
  if (installed) restoreToolApi(installed)
  const host = hostWindow()
  const had = Object.prototype.hasOwnProperty.call(host, 'hwpApi')
  const original = host.hwpApi
  const base = typeof original === 'object' && original !== null ? original : null
  const standIn: object = Object.assign(Object.create(base) as object, mobileHwpToolApi())
  host.hwpApi = standIn
  installed = { standIn, had, original }
  return installed
}

export function createMobileHwpAgent(call: PluginCall, lang: () => Lang): MobileHwpAgent {
  const bridge = pluginBridge(call)
  let changes: HwpChange[] = []
  let foreign: number | null = null
  let toolApi: InstalledToolApi | null = null
  const hwp = createHwpSkill({
    bridge,
    label: (key, params) => label(lang(), key, params),
    onChange: (change) => changes.push(change),
    // the memo panel's yes/no is not on the phone: an edit that would remove a memo is refused
    confirmMemoRemoval: async () => false,
    // read at every look at the tools, so a settings change applies from the next turn
    imageGenAvailable: () => getMobileAiTools().availability().imageGeneration,
    pictureAnalysisAvailable: () => getMobileAiTools().availability().pictureAnalysis,
    webAvailable: () => getMobileAiTools().availability().web,
    // the AI sheet's photos: the id stands where the PC has a path
    attachmentPath: (name) =>
      getMobileAiTools()
        .attachments()
        .find((photo) => photo.name === name)?.id ?? null,
    // named only where they can go in: insert_image is one of the PC's web tools
    attachmentNames: () =>
      getMobileAiTools().availability().web
        ? getMobileAiTools()
            .attachments()
            .map((photo) => photo.name)
        : [],
  })
  const pc = hwp.skill
  const skill: AgentSkill = {
    id: pc.id,
    // the PC adds the reply language in its panel; here the skill carries it
    get systemPrompt() {
      return pc.systemPrompt + aiLangDirective(lang())
    },
    get tools() {
      return pc.tools
    },
    buildContext: () => pc.buildContext?.() ?? '',
    executeTool: (toolCall, signal) => pc.executeTool(toolCall, signal),
    verifyResponse: pc.verifyResponse
      ? (text, executed) => pc.verifyResponse!(text, executed)
      : undefined,
  }
  return {
    skill,
    editTools: HWP_EDIT_TOOLS,
    async begin() {
      changes = []
      hwp.beginRun()
      // the stand-in lives for the run; finish puts the original back (useMobileAi finishes
      // a run after a stop or an error too), and the next begin undoes one never finished
      toolApi = installToolApi()
      try {
        const [counted] = await Promise.all([
          (bridge.foreignChanges() as Promise<number>).catch(() => null),
          hwp.refreshContext(),
        ])
        foreign = counted
      } catch (err) {
        restoreToolApi(toolApi)
        toolApi = null
        throw err
      }
    },
    finish() {
      if (toolApi) {
        restoreToolApi(toolApi)
        toolApi = null
      }
      if (changes.length === 0) return null
      const steps = changes.length
      const places = hwpChangeCount(changes)
      const foreignAtStart = foreign
      changes = []
      return {
        places,
        undo: () =>
          // without the count at the start the plugin cannot tell the run's steps from others
          foreignAtStart === null
            ? Promise.resolve(undoOutcome(null))
            : bridge.undo(steps, foreignAtStart).then(
                (result) => undoOutcome(result),
                () => undoOutcome(null),
              ),
      }
    },
  }
}
