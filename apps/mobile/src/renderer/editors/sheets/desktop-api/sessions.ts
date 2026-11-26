/**
 * The open workbook sessions of the phone, as the desktop main process keeps
 * them (`sessions` in apps/sheets/src/main/sheets-main.ts): the engine session
 * id, the working copy in the T1 work folder that the engine opened, and the
 * sheet names recalculation addresses sheets by.
 */
export interface MobileWorkbookSession {
  readonly sessionId: string
  /** The working copy the engine streams from (inside the T1 work folder). */
  readonly snapshotPath: string
  readonly sheetNames: ReadonlyMap<string, string>
  /** The document this session edits (the app's active document session). */
  readonly document?: MobileWorkbookDocument
}

/** What a save needs to know about the document behind an engine session. */
export interface MobileWorkbookDocument {
  /** The app's document session id (`MobileDocSession.sessionId`), for writing back. */
  readonly sessionId: string
  /** The name the person sees (`MobileDocSession.name`). */
  readonly name: string
  /** The identity the Univer unit id derives from (`MobileDocSession.docKey`). */
  readonly docKey: string
  readonly writable: boolean
  /**
   * Opened through a conversion (.xls, .csv): the session edits an .xlsx
   * copy, and the original cannot take the saved workbook in its format.
   */
  readonly converted: boolean
  /**
   * Opened with a password: the session edits the decrypted copy, and a save
   * must lock the result again with the same password before it reaches the
   * original (the save task). Never written anywhere.
   */
  readonly unlocked?: { readonly password: string }
}

export class MobileWorkbookSessions {
  private readonly sessions = new Map<string, MobileWorkbookSession>()

  add(session: MobileWorkbookSession): void {
    this.sessions.set(session.sessionId, session)
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** Same refusal as the desktop main process for a session it does not hold. */
  get(sessionId: string): MobileWorkbookSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Unknown workbook session.')
    return session
  }

  delete(sessionId: string): MobileWorkbookSession | undefined {
    const session = this.sessions.get(sessionId)
    this.sessions.delete(sessionId)
    return session
  }

  ids(): string[] {
    return [...this.sessions.keys()]
  }
}
