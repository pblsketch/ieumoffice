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
