import type { AgentSkill, AgentToolCall, ToolExecution } from '@genoffice/agent-core'

export type DocumentMode = 'view' | 'edit'

export interface DocumentEditCapabilities {
  readonly writable: boolean
  readonly encrypted: boolean
  readonly distribution: boolean
  /** True for newly created unsaved documents that are editable in memory before Save As. */
  readonly isUntitled?: boolean
}

export function initialDocumentMode(options: { readonly isUntitled: boolean }): DocumentMode {
  return options.isUntitled ? 'edit' : 'view'
}

/**
 * Whether editing / AI mutation tools are allowed on the active document.
 * For opened documents, enforces `writable && !encrypted && !distribution`.
 * Newly created untitled documents are editable in memory as long as they are not protected.
 */
export function canMutateDocument(caps: DocumentEditCapabilities): boolean {
  if (caps.encrypted || caps.distribution) return false
  return caps.isUntitled === true ? true : caps.writable
}

export interface ViewEditGateOptions {
  readonly isMutatingTool: (toolName: string) => boolean
  readonly getMode: () => DocumentMode
  readonly getCapabilities: () => DocumentEditCapabilities
  readonly switchToEdit: () => void | Promise<void>
  readonly onAutoSwitchedToEdit?: (toolName: string) => void
}

/**
 * Wraps an AgentSkill with mobile view-first and read-only/protected guards:
 * - In view mode, read-only tools execute without switching mode.
 * - When a mutating tool is called on an editable document in view mode,
 *   the editor switches to edit mode before applying the change.
 * - On non-writable, encrypted, or distribution documents, mutating tools are
 *   omitted from `tools` and rejected if invoked directly.
 */
export function wrapSkillWithViewEditGate(
  skill: AgentSkill,
  options: ViewEditGateOptions,
): AgentSkill {
  return {
    id: skill.id,
    get systemPrompt() {
      const base = skill.systemPrompt
      if (canMutateDocument(options.getCapabilities())) return base
      return `${base}\n\nThis document is read-only or protected. Only reading and answering questions are allowed; do not attempt to edit the document.`
    },
    get tools() {
      if (canMutateDocument(options.getCapabilities())) {
        return skill.tools
      }
      return skill.tools.filter((tool) => !options.isMutatingTool(tool.name))
    },
    buildContext: skill.buildContext ? () => skill.buildContext!() : undefined,
    async executeTool(call: AgentToolCall, signal?: AbortSignal): Promise<ToolExecution> {
      const mutating = options.isMutatingTool(call.name)
      if (mutating) {
        const caps = options.getCapabilities()
        if (!canMutateDocument(caps)) {
          return {
            output:
              'Document is read-only, encrypted, or distribution-protected and cannot be modified.',
            isError: true,
            summary: call.name,
          }
        }
        if (options.getMode() === 'view') {
          await options.switchToEdit()
          options.onAutoSwitchedToEdit?.(call.name)
        }
      }
      return skill.executeTool(call, signal)
    },
    verifyResponse: skill.verifyResponse
      ? (finalText, executed) => skill.verifyResponse!(finalText, executed)
      : undefined,
  }
}
