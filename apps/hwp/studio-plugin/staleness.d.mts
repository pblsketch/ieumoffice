import type { FailedMarkRemoval, MarkDoc, StripMarksResult } from './doc-marks.d.mts'
import type { CheckTocStalenessOptions, TocDoc } from './toc.d.mts'
import type { IndexDoc } from './index-marks.d.mts'

export type StalenessDoc = TocDoc & IndexDoc

export interface StalenessItem {
  id: string
  checkerId?: string
  kind: string
  reason: string
  label?: string
  details?: unknown
  hasManualEdits?: boolean
  modifiedLines?: unknown[]
}

export interface StalenessCheckOptions extends CheckTocStalenessOptions {
  ids?: readonly string[]
}

export interface StalenessCheckError {
  id: string
  error: string
}

export interface StalenessCheckerCheckResult {
  stale: boolean
  items: StalenessItem[]
  manualEdits?: StalenessManualEdit[]
  errors?: StalenessCheckError[]
}

export interface StalenessCheckResult {
  stale: boolean
  items: StalenessItem[]
  manualEdits: StalenessManualEdit[]
  errors?: StalenessCheckError[]
}

export interface StalenessManualEdit {
  checkerId: string
  id: string
  kind: string
  label?: string
  modifiedLines?: unknown[]
  range?: unknown
}

export interface StalenessRefreshOptions extends StalenessCheckOptions {
  allowOverwriteManual?: boolean
  force?: boolean
}

export interface StalenessCheckerRefreshResult {
  ok: boolean
  refreshed: number
  skippedManual?: StalenessManualEdit[]
  failed?: string
}

export interface StalenessChecker<TDoc = unknown> {
  id: string
  check(doc: TDoc, options?: StalenessCheckOptions): StalenessCheckerCheckResult
  refresh(doc: TDoc, options?: StalenessRefreshOptions): StalenessCheckerRefreshResult
}

export interface StalenessCheckerRunSummary extends StalenessCheckerRefreshResult {
  id: string
}

export interface StalenessRefreshAllResult {
  ok: boolean
  refreshed: number
  manualEdits: StalenessManualEdit[]
  reason?: 'manual_edits' | 'refresh_failed'
  failed?: StalenessCheckError[]
  results: StalenessCheckerRunSummary[]
}

export interface StalenessRegistry {
  register<TDoc = unknown>(checker: StalenessChecker<TDoc>): void
  unregister(id: string): boolean
  listCheckers(): string[]
  check(doc: unknown, options?: StalenessCheckOptions): StalenessCheckResult
  refreshAll(doc: unknown, options?: StalenessRefreshOptions): StalenessRefreshAllResult
}

export interface SubmissionCopyVerifyInfo {
  pageCountBefore: number
  pageCountAfter: number
  recovered: boolean
}

export interface SubmissionCopyDoc extends MarkDoc {
  exportHwp(): Uint8Array
  exportHwpx(): Uint8Array
  pageCount?(): number
  free?(): void
}

export type SubmissionCopyDocConstructor<TDoc extends SubmissionCopyDoc = SubmissionCopyDoc> = new (
  bytes: Uint8Array,
) => TDoc

export interface BuildSubmissionCopyOptions {
  verify?: boolean
}

export type SubmissionCopyResult =
  | {
      ok: true
      bytes: Uint8Array
      format: 'hwp' | 'hwpx'
      removed: number
      names: string[]
      verify?: SubmissionCopyVerifyInfo
    }
  | {
      ok: false
      reason: 'strip_failed'
      failed: FailedMarkRemoval[]
      format: 'hwp' | 'hwpx'
      removed: number
      names: string[]
    }

export declare const tocStalenessChecker: StalenessChecker<TocDoc>
export declare const indexStalenessChecker: StalenessChecker<IndexDoc>
export declare const defaultStalenessRegistry: StalenessRegistry

export declare function createStalenessRegistry(): StalenessRegistry
export declare function createDefaultStalenessRegistry(): StalenessRegistry
export declare function stripSubmissionMarksInPlace(cloneDoc: MarkDoc): StripMarksResult
export declare function buildSubmissionCopy<TDoc extends SubmissionCopyDoc = SubmissionCopyDoc>(
  doc: TDoc,
  format?: 'hwp' | 'hwpx',
  HwpDocumentCtor?: SubmissionCopyDocConstructor<TDoc>,
  options?: BuildSubmissionCopyOptions,
): SubmissionCopyResult
