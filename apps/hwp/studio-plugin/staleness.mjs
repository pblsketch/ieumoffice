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
import { checkTocStaleness, listTocRanges, refreshTocBlock } from './toc.mjs'
import { checkIndexStaleness, refreshIndexBlock } from './index-marks.mjs'

const TOC_KIND_LABELS = Object.freeze({
  body: '차례',
  table: '표 차례',
  figure: '그림 차례',
  equation: '수식 차례',
})

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

function normalizeCheckResult(checkerId, raw) {
  if (!raw || typeof raw !== 'object') {
    return { stale: false, items: [] }
  }
  const rawItems = Array.isArray(raw.items) ? raw.items : []
  const items = rawItems.map((item, idx) => {
    const id =
      typeof item?.id === 'string' && item.id.length > 0 ? item.id : `${checkerId}:${idx + 1}`
    const kind =
      typeof item?.kind === 'string' && item.kind.length > 0 ? item.kind : checkerId
    const reason =
      typeof item?.reason === 'string' && item.reason.length > 0
        ? item.reason
        : 'entries_changed'
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
    return normalized
  })
  return {
    stale: Boolean(raw.stale) && items.length > 0,
    items,
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
    const items = (res.items ?? []).map((item) => ({
      id: `toc:${item.kind}`,
      kind: item.kind,
      reason: item.reason,
      label: TOC_KIND_LABELS[item.kind] ?? item.kindId ?? item.kind,
      details: item.details,
    }))
    return {
      stale: Boolean(res.stale) && items.length > 0,
      items,
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
    const skippedManual = []
    const failures = []

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
        skippedManual.push({
          checkerId: 'toc',
          id: `toc:${kind}`,
          kind,
          label: TOC_KIND_LABELS[kind] ?? kind,
          modifiedLines: res.modifiedLines ?? [],
          range: res.range,
        })
      } else {
        failures.push(`${kind}:${res.reason ?? res.error ?? 'refresh_failed'}`)
      }
    }

    return {
      ok: failures.length === 0 && skippedManual.length === 0,
      refreshed,
      ...(skippedManual.length > 0 ? { skippedManual } : {}),
      ...(failures.length > 0 ? { failed: failures.join('; ') } : {}),
    }
  },
})

/** Built-in staleness checker for the document index block. */
export const indexStalenessChecker = Object.freeze({
  id: 'index',
  check(doc) {
    const res = checkIndexStaleness(doc)
    if (!res.stale) {
      return { stale: false, items: [] }
    }
    return {
      stale: true,
      items: [
        {
          id: 'index',
          kind: 'index',
          reason: res.reason ?? 'entries_changed',
          label: '찾아보기',
        },
      ],
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
    const errors = []

    for (const checker of selectedCheckers(options)) {
      try {
        const result = normalizeCheckResult(checker.id, checker.check(doc, options))
        if (result.stale) {
          items.push(...result.items)
        }
      } catch (err) {
        errors.push({ id: checker.id, error: errorMessage(err) })
      }
    }

    return {
      stale: items.length > 0,
      items,
      ...(errors.length > 0 ? { errors } : {}),
    }
  }

  /**
   * Sequentially refresh every stale checker on `doc`.
   * Checks each checker immediately before refreshing so earlier refreshes that shift
   * pagination (for example a growing TOC) are reflected by later checkers (for example index).
   */
  function refreshAll(doc, options = {}) {
    let refreshed = 0
    const manualEdits = []
    const failed = []
    const results = []

    for (const checker of selectedCheckers(options)) {
      let shouldRefresh = options?.force === true
      if (!shouldRefresh) {
        try {
          const checkRes = normalizeCheckResult(checker.id, checker.check(doc, options))
          shouldRefresh = checkRes.stale
        } catch (err) {
          failed.push({ id: checker.id, error: errorMessage(err) })
          continue
        }
      }
      if (!shouldRefresh) continue

      try {
        const res = checker.refresh(doc, options)
        const count = Number.isInteger(res?.refreshed) ? res.refreshed : 0
        refreshed += count
        const skipped = Array.isArray(res?.skippedManual)
          ? res.skippedManual.map((entry) => ({
              checkerId: entry?.checkerId ?? checker.id,
              id: entry?.id ?? checker.id,
              kind: entry?.kind ?? checker.id,
              ...(typeof entry?.label === 'string' ? { label: entry.label } : {}),
              ...(Array.isArray(entry?.modifiedLines) ? { modifiedLines: entry.modifiedLines } : {}),
              ...(entry?.range !== undefined ? { range: entry.range } : {}),
            }))
          : []
        if (skipped.length > 0) {
          manualEdits.push(...skipped)
        }
        if (typeof res?.failed === 'string' && res.failed.length > 0) {
          failed.push({ id: checker.id, error: res.failed })
        } else if (res?.ok === false && skipped.length === 0) {
          failed.push({ id: checker.id, error: 'refresh_failed' })
        }
        results.push({
          id: checker.id,
          ok: Boolean(res?.ok),
          refreshed: count,
          ...(skipped.length > 0 ? { skippedManual: skipped } : {}),
          ...(typeof res?.failed === 'string' && res.failed.length > 0
            ? { failed: res.failed }
            : {}),
        })
      } catch (err) {
        failed.push({ id: checker.id, error: errorMessage(err) })
      }
    }

    const ok = failed.length === 0 && manualEdits.length === 0
    return {
      ok,
      refreshed,
      manualEdits,
      ...(manualEdits.length > 0 ? { reason: 'manual_edits' } : {}),
      ...(failed.length > 0 ? { failed } : {}),
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

/** Create a new staleness registry pre-populated with the built-in TOC and index checkers. */
export function createDefaultStalenessRegistry() {
  const registry = createStalenessRegistry()
  registry.register(tocStalenessChecker)
  registry.register(indexStalenessChecker)
  return registry
}

/** Shared default staleness registry pre-registered with `toc` and `index`. */
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
export function buildSubmissionCopy(doc, format = 'hwpx', HwpDocumentCtor = undefined, options = {}) {
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

  const pageCountBefore =
    typeof doc.pageCount === 'function' ? Number(doc.pageCount()) : undefined
  const sourceBytes = exportLive.call(doc)

  const clone = new Ctor(sourceBytes)
  let stripped
  let outBytes
  try {
    stripped = stripSubmissionMarksInPlace(clone)
    const exportClone = format === 'hwp' ? clone.exportHwp : clone.exportHwpx
    outBytes = exportClone.call(clone)
  } finally {
    if (typeof clone?.free === 'function') {
      clone.free()
    }
  }

  let verify
  const shouldVerify = format === 'hwp' && options?.verify !== false
  if (shouldVerify) {
    const before = Number.isFinite(pageCountBefore) ? pageCountBefore : 0
    let reloaded = null
    try {
      reloaded = new Ctor(outBytes)
      const after =
        typeof reloaded.pageCount === 'function' ? Number(reloaded.pageCount()) : before
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
    bytes: outBytes,
    format,
    removed: stripped.removed,
    names: stripped.names,
    ...(stripped.failed ? { failed: stripped.failed } : {}),
    ...(verify ? { verify } : {}),
  }
}
