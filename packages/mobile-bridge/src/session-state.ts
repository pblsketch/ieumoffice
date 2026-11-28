import type { MobileDocSession } from './transport'

export type UnsavedSwitchChoice = 'save' | 'discard' | 'cancel'

export interface ActiveDocState {
  readonly session: MobileDocSession
  readonly dirty: boolean
  readonly encrypted: boolean
  readonly distribution: boolean
  readonly trackingDropped: boolean
  readonly isUntitled: boolean
}

export interface SwitchOutcome {
  readonly switched: boolean
  readonly reason?: 'cancelled' | 'save-failed'
  readonly next?: ActiveDocState | null
}

export interface MobileSessionControllerHooks {
  readonly confirmUnsavedSwitch: (current: ActiveDocState) => Promise<UnsavedSwitchChoice>
  readonly saveCurrentDocument: (current: ActiveDocState) => Promise<boolean>
  readonly discardRecovery?: (docKey: string) => Promise<void>
  readonly onSessionChanged?: (next: ActiveDocState | null, prev: ActiveDocState | null) => void
  readonly onResetAiMemory?: (prevDocKey: string | null, nextDocKey: string | null) => void
}

export interface OpenLoadedSession {
  readonly session: MobileDocSession
  readonly encrypted?: boolean
  readonly distribution?: boolean
  readonly trackingDropped?: boolean
  readonly isUntitled?: boolean
}

export class MobileSessionController {
  private current: ActiveDocState | null = null
  private readonly hooks: MobileSessionControllerHooks

  constructor(hooks: MobileSessionControllerHooks) {
    this.hooks = hooks
  }

  getActive(): ActiveDocState | null {
    return this.current
  }

  markDirty(dirty: boolean): void {
    if (!this.current || this.current.dirty === dirty) return
    const prev = this.current
    this.current = { ...this.current, dirty }
    this.hooks.onSessionChanged?.(this.current, prev)
  }

  updateSessionMetadata(
    patch: Partial<Omit<ActiveDocState, 'session'>> & { session?: MobileDocSession },
  ): void {
    if (!this.current) return
    const prev = this.current
    const docKeyChanged = Boolean(patch.session && patch.session.docKey !== prev.session.docKey)
    this.current = {
      ...this.current,
      ...patch,
      session: patch.session ?? this.current.session,
    }
    if (docKeyChanged) {
      this.hooks.onResetAiMemory?.(prev.session.docKey, this.current.session.docKey)
    }
    this.hooks.onSessionChanged?.(this.current, prev)
  }

  private async resolveUnsavedBeforeRelease(): Promise<'proceed' | 'cancelled' | 'save-failed'> {
    if (!this.current || !this.current.dirty) return 'proceed'
    const choice = await this.hooks.confirmUnsavedSwitch(this.current)
    if (choice === 'cancel') return 'cancelled'
    if (choice === 'save') {
      const saved = await this.hooks.saveCurrentDocument(this.current)
      if (!saved) return 'save-failed'
      await this.hooks.discardRecovery?.(this.current.session.docKey)
      return 'proceed'
    }
    await this.hooks.discardRecovery?.(this.current.session.docKey)
    return 'proceed'
  }

  /**
   * Switches the single active document slot after resolving any unsaved edits.
   * Never drops or clears the active session until the switch decision succeeds.
   */
  async switchTo(loader: () => Promise<OpenLoadedSession | null>): Promise<SwitchOutcome> {
    const gate = await this.resolveUnsavedBeforeRelease()
    if (gate === 'cancelled') return { switched: false, reason: 'cancelled' }
    if (gate === 'save-failed') return { switched: false, reason: 'save-failed' }

    const loaded = await loader()
    if (!loaded) return { switched: false, reason: 'cancelled' }

    const prev = this.current
    const next: ActiveDocState = {
      session: loaded.session,
      dirty: false,
      encrypted: loaded.encrypted ?? false,
      distribution: loaded.distribution ?? false,
      trackingDropped: loaded.trackingDropped ?? false,
      isUntitled:
        loaded.isUntitled ??
        (!loaded.session.writable && !loaded.session.ephemeral && !loaded.session.uriHint),
    }
    this.current = next
    this.hooks.onResetAiMemory?.(prev?.session.docKey ?? null, next.session.docKey)
    this.hooks.onSessionChanged?.(next, prev)
    return { switched: true, next }
  }

  /** Routes an external Share-In / Open-With intent through the same unsaved switch guard. */
  async handleExternalOpenIntent(incoming: OpenLoadedSession): Promise<SwitchOutcome> {
    return this.switchTo(async () => incoming)
  }

  /** Closes the active document back to Home after resolving unsaved edits. */
  async closeActive(): Promise<SwitchOutcome> {
    if (!this.current) return { switched: true, next: null }
    const gate = await this.resolveUnsavedBeforeRelease()
    if (gate === 'cancelled') return { switched: false, reason: 'cancelled' }
    if (gate === 'save-failed') return { switched: false, reason: 'save-failed' }

    const prev = this.current
    this.current = null
    this.hooks.onResetAiMemory?.(prev.session.docKey, null)
    this.hooks.onSessionChanged?.(null, prev)
    return { switched: true, next: null }
  }
}

export function createMobileSessionController(
  hooks: MobileSessionControllerHooks,
): MobileSessionController {
  return new MobileSessionController(hooks)
}
