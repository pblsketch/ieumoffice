/**
 * Extensible staleness checker registry and non-mutating submission copy builder.
 *
 * Pre-registers TOC (`toc`) and index (`index`) checkers and leaves the registry
 * open for future document blocks (for example bibliography or citation trackers).
 * Checking staleness is strictly read-only; refreshing runs stale checkers
 * sequentially so callers wrapping `refreshAll()` in a single editor transaction
 * produce one undo step.
 */
import { SUBMISSION_STRIP_PREFIXES, stripMarks } from './doc-marks.mjs'
import { checkTocStaleness, detectTocManualEdits, listTocRanges, refreshTocBlock } from './toc.mjs'
import { checkIndexStaleness, detectIndexManualEdits, refreshIndexBlock } from './index-marks.mjs'
import {
  checkBibliographyStaleness,
  detectBibliographyManualEdits,
  getDocumentCitationStyle,
  refreshBibliographyBlock,
  renumberIeeeCitations,
} from './citations.mjs'

const MAX_CONVERGENCE_PASSES = 3

const TOC_KIND_LABELS = Object.freeze({
  body: '차례',
  table: '표 차례',
  figure: '그림 차례',
  equation: '수식 차례',
})

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

function normalizeManualEditEntry(checkerId, entry) {
  return {
    checkerId: entry?.checkerId ?? checkerId,
    id: entry?.id ?? checkerId,
    kind: entry?.kind ?? checkerId,
    ...(typeof entry?.label === 'string' ? { label: entry.label } : {}),
    ...(Array.isArray(entry?.modifiedLines) ? { modifiedLines: entry.modifiedLines } : {}),
    ...(entry?.range !== undefined ? { range: entry.range } : {}),
  }
}

function normalizeCheckResult(checkerId, raw) {
  if (!raw || typeof raw !== 'object') {
    return { stale: false, items: [], manualEdits: [] }
  }
  const rawItems = Array.isArray(raw.items) ? raw.items : []
  const items = rawItems.map((item, idx) => {
    const id =
      typeof item?.id === 'string' && item.id.length > 0 ? item.id : `${checkerId}:${idx + 1}`
    const kind = typeof item?.kind === 'string' && item.kind.length > 0 ? item.kind : checkerId
    const reason =
      typeof item?.reason === 'string' && item.reason.length > 0 ? item.reason : 'entries_changed'
    const normalized = {
      id,
      checkerId,
      kind,
      reason,
    }
    if (typeof item?.label === 'string' && item.label.length > 0) {
      normalized.label = item.label
    }
    if (item?.details !== undefined) {
      normalized.details = item.details
    }
    if (typeof item?.hasManualEdits === 'boolean') {
      normalized.hasManualEdits = item.hasManualEdits
    }
    if (Array.isArray(item?.modifiedLines)) {
      normalized.modifiedLines = item.modifiedLines
    }
    return normalized
  })
  const manualEdits = Array.isArray(raw.manualEdits)
    ? raw.manualEdits.map((entry) => normalizeManualEditEntry(checkerId, entry))
    : items
        .filter((item) => item.hasManualEdits === true)
        .map((item) =>
          normalizeManualEditEntry(checkerId, {
            checkerId,
            id: item.id,
            kind: item.kind,
            label: item.label,
            modifiedLines: item.modifiedLines,
          }),
        )
  return {
    stale: Boolean(raw.stale) && items.length > 0,
    items,
    manualEdits,
  }
}

/** Built-in staleness checker for all marked TOC blocks (body, table, figure, equation). */
export const tocStalenessChecker = Object.freeze({
  id: 'toc',
  check(doc, options = {}) {
    const res = checkTocStaleness(doc, {
      appStyleMap: options?.appStyleMap,
      collectors: options?.collectors,
      helpers: options?.helpers,
    })
    const manualEdits = []
    const items = (res.items ?? []).map((item) => {
      const label = TOC_KIND_LABELS[item.kind] ?? item.kindId ?? item.kind
      const manual = detectTocManualEdits(doc, item.kind, options)
      if (manual.hasManualEdits) {
        manualEdits.push({
          checkerId: 'toc',
          id: `toc:${item.kind}`,
          kind: item.kind,
          label,
          modifiedLines: manual.modifiedLines,
          range: manual.range ?? item.range,
        })
      }
      return {
        id: `toc:${item.kind}`,
        kind: item.kind,
        reason: item.reason,
        label,
        details: item.details,
        hasManualEdits: manual.hasManualEdits,
        ...(manual.hasManualEdits ? { modifiedLines: manual.modifiedLines } : {}),
      }
    })
    return {
      stale: Boolean(res.stale) && items.length > 0,
      items,
      manualEdits,
    }
  },
  refresh(doc, options = {}) {
    const targetKinds =
      options?.force === true
        ? listTocRanges(doc).map((r) => r.kind)
        : checkTocStaleness(doc, {
            appStyleMap: options?.appStyleMap,
            collectors: options?.collectors,
            helpers: options?.helpers,
          }).items.map((item) => item.kind)

    const uniqueKinds = [...new Set(targetKinds)]
    if (uniqueKinds.length === 0) {
      return { ok: true, refreshed: 0 }
    }

    let refreshed = 0

    for (const kind of uniqueKinds) {
      const res = refreshTocBlock(doc, {
        kind,
        allowOverwriteManual: options?.allowOverwriteManual === true,
        appStyleMap: options?.appStyleMap,
        helpers: options?.helpers,
      })
      if (res.ok) {
        refreshed += 1
      } else if (res.reason === 'manual_edits') {
        return {
          ok: false,
          refreshed: 0,
          skippedManual: [
            {
              checkerId: 'toc',
              id: `toc:${kind}`,
              kind,
              label: TOC_KIND_LABELS[kind] ?? kind,
              modifiedLines: res.modifiedLines ?? [],
              range: res.range,
            },
          ],
        }
      } else {
        return {
          ok: false,
          refreshed: 0,
          failed: `${kind}:${res.reason ?? res.error ?? 'refresh_failed'}`,
        }
      }
    }

    return {
      ok: true,
      refreshed,
    }
  },
})

/** Built-in staleness checker for the document index block. */
export const indexStalenessChecker = Object.freeze({
  id: 'index',
  check(doc) {
    const res = checkIndexStaleness(doc)
    if (!res.stale) {
      return { stale: false, items: [], manualEdits: [] }
    }
    const manual = detectIndexManualEdits(doc)
    const manualEdits = manual.hasManualEdits
      ? [
          {
            checkerId: 'index',
            id: 'index',
            kind: 'index',
            label: '찾아보기',
            modifiedLines: manual.modifiedLines,
            range: manual.range,
          },
        ]
      : []
    return {
      stale: true,
      items: [
        {
          id: 'index',
          kind: 'index',
          reason: res.reason ?? 'entries_changed',
          label: '찾아보기',
          hasManualEdits: manual.hasManualEdits,
          ...(manual.hasManualEdits ? { modifiedLines: manual.modifiedLines } : {}),
        },
      ],
      manualEdits,
    }
  },
  refresh(doc, options = {}) {
    if (options?.force !== true) {
      const status = checkIndexStaleness(doc)
      if (!status.stale) {
        return { ok: true, refreshed: 0 }
      }
    }
    const res = refreshIndexBlock(doc, {
      allowOverwriteManual: options?.allowOverwriteManual === true,
    })
    if (res.ok) {
      return { ok: true, refreshed: 1 }
    }
    if (res.reason === 'manual_edits') {
      return {
        ok: false,
        refreshed: 0,
        skippedManual: [
          {
            checkerId: 'index',
            id: 'index',
            kind: 'index',
            label: '찾아보기',
            modifiedLines: res.modifiedLines ?? [],
            range: res.range,
          },
        ],
      }
    }
    if (res.reason === 'not_found') {
      return { ok: true, refreshed: 0 }
    }
    return {
      ok: false,
      refreshed: 0,
      failed: res.error ?? res.reason ?? 'refresh_failed',
    }
  },
})

/** Built-in staleness checker for document citations (IEEE numbering) and bibliography block. */
export const bibliographyStalenessChecker = Object.freeze({
  id: 'bibliography',
  check(doc, options = {}) {
    const res = checkBibliographyStaleness(doc, options)
    if (!res.stale) {
      return { stale: false, items: [], manualEdits: [] }
    }
    const manual = detectBibliographyManualEdits(doc)
    const manualEdits = manual.hasManualEdits
      ? [
          {
            checkerId: 'bibliography',
            id: 'bibliography',
            kind: 'bibliography',
            label: '참고문헌',
            modifiedLines: manual.modifiedLines,
            range: manual.range,
          },
        ]
      : []
    return {
      stale: true,
      items: [
        {
          id: 'bibliography',
          kind: 'bibliography',
          reason: res.reason ?? 'entries_changed',
          label: '참고문헌',
          hasManualEdits: manual.hasManualEdits,
          ...(manual.hasManualEdits ? { modifiedLines: manual.modifiedLines } : {}),
        },
      ],
      manualEdits,
    }
  },
  refresh(doc, options = {}) {
    const status = checkBibliographyStaleness(doc, options)
    if (options?.force !== true && !status.stale) {
      return { ok: true, refreshed: 0 }
    }

    const entries = Array.isArray(options?.bibEntries)
      ? options.bibEntries
      : Array.isArray(options?.entries)
        ? options.entries
        : []

    // Check manual edits BEFORE renumbering IEEE citations so atomic rollback stays clean.
    if (status.hasBibliography && options?.allowOverwriteManual !== true) {
      const manual = detectBibliographyManualEdits(doc)
      if (manual.hasManualEdits) {
        return {
          ok: false,
          refreshed: 0,
          skippedManual: [
            {
              checkerId: 'bibliography',
              id: 'bibliography',
              kind: 'bibliography',
              label: '참고문헌',
              modifiedLines: manual.modifiedLines,
              range: manual.range,
            },
          ],
        }
      }
    }

    let refreshed = 0
    if (getDocumentCitationStyle(doc) === 'ieee') {
      const renum = renumberIeeeCitations(doc, entries.length > 0 ? entries : null)
      if (!renum.ok) {
        return {
          ok: false,
          refreshed: 0,
          failed: renum.error ?? renum.reason ?? 'renumber_failed',
        }
      }
      if (renum.updated > 0) refreshed += 1
    }

    if (status.hasBibliography) {
      const res = refreshBibliographyBlock(doc, entries, {
        allowOverwriteManual: options?.allowOverwriteManual === true,
      })
      if (res.ok) {
        refreshed += 1
        return { ok: true, refreshed }
      }
      if (res.reason === 'manual_edits') {
        return {
          ok: false,
          refreshed: 0,
          skippedManual: [
            {
              checkerId: 'bibliography',
              id: 'bibliography',
              kind: 'bibliography',
              label: '참고문헌',
              modifiedLines: res.modifiedLines ?? [],
              range: res.range,
            },
          ],
        }
      }
      if (res.reason === 'not_found') {
        return { ok: true, refreshed }
      }
      return {
        ok: false,
        refreshed: 0,
        failed: res.error ?? res.reason ?? 'refresh_failed',
      }
    }

    return { ok: true, refreshed }
  },
})

/**
 * Create an extensible staleness checker registry.
 * Checkers run in registration order. `check()` is strictly read-only;
 * `refreshAll()` refreshes stale checkers sequentially in place.
 */
export function createStalenessRegistry() {
  const checkers = new Map()

  function register(checker) {
    if (!checker || typeof checker !== 'object') {
      throw new TypeError('Staleness checker must be an object')
    }
    if (typeof checker.id !== 'string' || checker.id.trim().length === 0) {
      throw new TypeError('Staleness checker must have a non-empty string id')
    }
    if (typeof checker.check !== 'function') {
      throw new TypeError(`Staleness checker "${checker.id}" must implement check(doc, options?)`)
    }
    if (typeof checker.refresh !== 'function') {
      throw new TypeError(`Staleness checker "${checker.id}" must implement refresh(doc, options?)`)
    }
    checkers.set(checker.id, checker)
  }

  function unregister(id) {
    return checkers.delete(id)
  }

  function listCheckers() {
    return [...checkers.keys()]
  }

  function selectedCheckers(options) {
    const ids = Array.isArray(options?.ids) ? new Set(options.ids) : null
    const list = []
    for (const [id, checker] of checkers.entries()) {
      if (ids && !ids.has(id)) continue
      list.push(checker)
    }
    return list
  }

  /** Read-only staleness check across all registered checkers. Never mutates `doc`. */
  function check(doc, options = {}) {
    const items = []
    const manualEdits = []
    const errors = []

    for (const checker of selectedCheckers(options)) {
      try {
        const result = normalizeCheckResult(checker.id, checker.check(doc, options))
        if (result.stale) {
          items.push(...result.items)
          if (result.manualEdits.length > 0) {
            manualEdits.push(...result.manualEdits)
          }
        }
      } catch (err) {
        errors.push({ id: checker.id, error: errorMessage(err) })
      }
    }

    return {
      stale: items.length > 0,
      items,
      manualEdits,
      ...(errors.length > 0 ? { errors } : {}),
    }
  }

  /**
   * Sequentially refresh every stale checker on `doc` in a bounded convergence loop
   * (up to 3 passes) so page shifts caused by earlier blocks are absorbed cleanly.
   * Stops immediately on any failure or unapproved manual edit and returns `ok: false`
   * with `refreshed: 0` so a wrapping editor transaction rolls back atomically.
   */
  function refreshAll(doc, options = {}) {
    let totalRefreshed = 0
    const results = []
    const activeCheckers = selectedCheckers(options)

    for (let pass = 0; pass < MAX_CONVERGENCE_PASSES; pass++) {
      let passRefreshed = 0
      const passOptions = pass === 0 ? options : { ...options, force: false }

      for (const checker of activeCheckers) {
        let shouldRefresh = pass === 0 && options?.force === true
        if (!shouldRefresh) {
          try {
            const checkRes = normalizeCheckResult(checker.id, checker.check(doc, passOptions))
            shouldRefresh = checkRes.stale
          } catch (err) {
            return {
              ok: false,
              reason: 'refresh_failed',
              refreshed: 0,
              manualEdits: [],
              failed: [{ id: checker.id, error: errorMessage(err) }],
              results,
            }
          }
        }
        if (!shouldRefresh) continue

        let res
        try {
          res = checker.refresh(doc, passOptions)
        } catch (err) {
          return {
            ok: false,
            reason: 'refresh_failed',
            refreshed: 0,
            manualEdits: [],
            failed: [{ id: checker.id, error: errorMessage(err) }],
            results,
          }
        }

        const count = Number.isInteger(res?.refreshed) ? res.refreshed : 0
        const skipped = Array.isArray(res?.skippedManual)
          ? res.skippedManual.map((entry) => normalizeManualEditEntry(checker.id, entry))
          : []
        const failedMsg =
          typeof res?.failed === 'string' && res.failed.length > 0
            ? res.failed
            : res?.ok === false && skipped.length === 0
              ? 'refresh_failed'
              : null

        results.push({
          id: checker.id,
          ok: Boolean(res?.ok) && skipped.length === 0 && !failedMsg,
          refreshed: count,
          ...(skipped.length > 0 ? { skippedManual: skipped } : {}),
          ...(failedMsg ? { failed: failedMsg } : {}),
        })

        if (skipped.length > 0) {
          return {
            ok: false,
            reason: 'manual_edits',
            refreshed: 0,
            manualEdits: skipped,
            ...(failedMsg ? { failed: [{ id: checker.id, error: failedMsg }] } : {}),
            results,
          }
        }
        if (failedMsg || res?.ok === false) {
          return {
            ok: false,
            reason: 'refresh_failed',
            refreshed: 0,
            manualEdits: [],
            failed: [{ id: checker.id, error: failedMsg ?? 'refresh_failed' }],
            results,
          }
        }

        totalRefreshed += count
        passRefreshed += count
      }

      if (passRefreshed === 0) break
      const afterPass = check(doc, passOptions)
      if (!afterPass.stale) break
    }

    return {
      ok: true,
      refreshed: totalRefreshed,
      manualEdits: [],
      results,
    }
  }

  return {
    register,
    unregister,
    listCheckers,
    check,
    refreshAll,
  }
}

/** Create a new staleness registry pre-populated with the built-in TOC, index, and bibliography checkers. */
export function createDefaultStalenessRegistry() {
  const registry = createStalenessRegistry()
  registry.register(tocStalenessChecker)
  registry.register(indexStalenessChecker)
  registry.register(bibliographyStalenessChecker)
  return registry
}

/** Shared default staleness registry pre-registered with `toc`, `index`, and `bibliography`. */
export const defaultStalenessRegistry = createDefaultStalenessRegistry()

/**
 * Strip non-submission internal marks (index, index-block, citation, bibliography,
 * and setting bookmarks) from `cloneDoc` in place, while keeping TOC range marks,
 * heading bookmarks, and TOC internal hyperlinks intact.
 */
export function stripSubmissionMarksInPlace(cloneDoc) {
  return stripMarks(cloneDoc, SUBMISSION_STRIP_PREFIXES)
}

/**
 * Build a clean submission copy of `doc` in `format` (`'hwp' | 'hwpx'`) on a short-lived
 * isolated clone. The live `doc` is never mutated.
 *
 * Strips index, index-block, citation, bibliography, and setting marks while preserving
 * TOC range marks, heading anchors, and TOC internal hyperlinks. For `'hwp'`, reloads the
 * exported bytes to verify recovery and page-count parity unless `options.verify === false`.
 */
export function buildSubmissionCopy(
  doc,
  format = 'hwpx',
  HwpDocumentCtor = undefined,
  options = {},
) {
  if (!doc || typeof doc !== 'object') {
    throw new TypeError('Document instance is required to build a submission copy')
  }
  if (format !== 'hwp' && format !== 'hwpx') {
    throw new RangeError(`Unsupported submission copy format: ${String(format)}`)
  }
  const Ctor = typeof HwpDocumentCtor === 'function' ? HwpDocumentCtor : doc.constructor
  if (typeof Ctor !== 'function') {
    throw new TypeError('HwpDocument constructor is required to build a submission copy')
  }

  const exportLive = format === 'hwp' ? doc.exportHwp : doc.exportHwpx
  if (typeof exportLive !== 'function') {
    throw new TypeError(`Document does not support exporting ${format}`)
  }

  const sourceBytes = exportLive.call(doc)

  const clone = new Ctor(sourceBytes)
  const shouldVerify = format === 'hwp' && options?.verify !== false
  let pageCountBefore
  let stripped
  let outBytes
  try {
    // Measure pre-strip page count on the isolated clone so both before and after use
    // identical portable/default layout metrics (avoiding false mismatches when live doc
    // uses canvas metrics).
    if (shouldVerify && typeof clone.pageCount === 'function') {
      pageCountBefore = Number(clone.pageCount())
    }
    stripped = stripSubmissionMarksInPlace(clone)
    if (Array.isArray(stripped.failed) && stripped.failed.length > 0) {
      return {
        ok: false,
        reason: 'strip_failed',
        failed: stripped.failed,
        format,
        removed: stripped.removed,
        names: stripped.names,
      }
    }
    const exportClone = format === 'hwp' ? clone.exportHwp : clone.exportHwpx
    outBytes = exportClone.call(clone)
  } finally {
    if (typeof clone?.free === 'function') {
      clone.free()
    }
  }

  let verify
  if (shouldVerify) {
    const before = Number.isFinite(pageCountBefore) ? pageCountBefore : 0
    let reloaded = null
    try {
      reloaded = new Ctor(outBytes)
      const after = typeof reloaded.pageCount === 'function' ? Number(reloaded.pageCount()) : before
      verify = {
        pageCountBefore: before,
        pageCountAfter: after,
        recovered: true,
      }
    } catch {
      verify = {
        pageCountBefore: before,
        pageCountAfter: 0,
        recovered: false,
      }
    } finally {
      if (typeof reloaded?.free === 'function') {
        reloaded.free()
      }
    }
  }

  return {
    ok: true,
    bytes: outBytes,
    format,
    removed: stripped.removed,
    names: stripped.names,
    ...(verify ? { verify } : {}),
  }
}
