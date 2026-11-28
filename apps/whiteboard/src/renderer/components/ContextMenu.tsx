/**
 * Floating right-click context menu for canvas and object actions.
 */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { AlignDirection, DistributeAxis } from '../canvas/geometry'
import { useI18n } from '../i18n/locale'

export interface ContextMenuProps {
  readonly x: number
  readonly y: number
  readonly selectedCount: number
  readonly hasClipboard: boolean
  readonly canGroup: boolean
  readonly canUngroup: boolean
  readonly allLocked: boolean
  readonly hasUnlocked: boolean
  readonly onCopy: () => void
  readonly onCut: () => void
  readonly onPaste: () => void
  readonly onDuplicate: () => void
  readonly onGroup: () => void
  readonly onUngroup: () => void
  readonly onToggleLock: () => void
  readonly onLayer: (dir: 'front' | 'forward' | 'backward' | 'back') => void
  readonly onAlign: (dir: AlignDirection) => void
  readonly onDistribute: (axis: DistributeAxis) => void
  readonly onSelectAll: () => void
  readonly onDelete: () => void
  readonly onClose: () => void
}

export function ContextMenu({
  x,
  y,
  selectedCount,
  hasClipboard,
  canGroup,
  canUngroup,
  allLocked,
  hasUnlocked,
  onCopy,
  onCut,
  onPaste,
  onDuplicate,
  onGroup,
  onUngroup,
  onToggleLock,
  onLayer,
  onAlign,
  onDistribute,
  onSelectAll,
  onDelete,
  onClose,
}: ContextMenuProps): ReactElement {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      ref={ref}
      className="wb-ctx-menu"
      role="menu"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {selectedCount > 0 ? (
        <>
          <button type="button" className="wb-ctx-item" role="menuitem" onClick={run(onCopy)}>
            <span>{t('ctxCopy')}</span>
            <kbd>Ctrl+C</kbd>
          </button>
          <button
            type="button"
            className="wb-ctx-item"
            role="menuitem"
            disabled={!hasUnlocked}
            onClick={run(onCut)}
          >
            <span>{t('ctxCut')}</span>
            <kbd>Ctrl+X</kbd>
          </button>
          {hasClipboard && (
            <button type="button" className="wb-ctx-item" role="menuitem" onClick={run(onPaste)}>
              <span>{t('ctxPaste')}</span>
              <kbd>Ctrl+V</kbd>
            </button>
          )}
          <button type="button" className="wb-ctx-item" role="menuitem" onClick={run(onDuplicate)}>
            <span>{t('toolDuplicate')}</span>
            <kbd>Ctrl+D</kbd>
          </button>

          <div className="wb-ctx-sep" role="separator" />

          {canGroup && (
            <button type="button" className="wb-ctx-item" role="menuitem" onClick={run(onGroup)}>
              <span>{t('ctxGroup')}</span>
              <kbd>Ctrl+G</kbd>
            </button>
          )}
          {canUngroup && (
            <button type="button" className="wb-ctx-item" role="menuitem" onClick={run(onUngroup)}>
              <span>{t('ctxUngroup')}</span>
              <kbd>Ctrl+Shift+G</kbd>
            </button>
          )}
          <button type="button" className="wb-ctx-item" role="menuitem" onClick={run(onToggleLock)}>
            <span>{allLocked ? t('ctxUnlock') : t('ctxLock')}</span>
            <kbd>Ctrl+Shift+L</kbd>
          </button>

          {selectedCount >= 2 && hasUnlocked && (
            <>
              <div className="wb-ctx-sep" role="separator" />
              <div className="wb-ctx-label">{t('ctxAlign')}</div>
              <div className="wb-ctx-align-row">
                <button type="button" title={t('alignLeft')} onClick={run(() => onAlign('left'))}>
                  L
                </button>
                <button
                  type="button"
                  title={t('alignCenterH')}
                  onClick={run(() => onAlign('center'))}
                >
                  C
                </button>
                <button type="button" title={t('alignRight')} onClick={run(() => onAlign('right'))}>
                  R
                </button>
                <button type="button" title={t('alignTop')} onClick={run(() => onAlign('top'))}>
                  T
                </button>
                <button
                  type="button"
                  title={t('alignMiddleV')}
                  onClick={run(() => onAlign('middle'))}
                >
                  M
                </button>
                <button
                  type="button"
                  title={t('alignBottom')}
                  onClick={run(() => onAlign('bottom'))}
                >
                  B
                </button>
              </div>
              {selectedCount >= 3 && (
                <div className="wb-ctx-align-row">
                  <button
                    type="button"
                    className="wide"
                    onClick={run(() => onDistribute('horizontal'))}
                  >
                    {t('distributeH')}
                  </button>
                  <button
                    type="button"
                    className="wide"
                    onClick={run(() => onDistribute('vertical'))}
                  >
                    {t('distributeV')}
                  </button>
                </div>
              )}
            </>
          )}

          <div className="wb-ctx-sep" role="separator" />

          <button
            type="button"
            className="wb-ctx-item"
            role="menuitem"
            onClick={run(() => onLayer('front'))}
          >
            <span>{t('toolBringFront')}</span>
          </button>
          <button
            type="button"
            className="wb-ctx-item"
            role="menuitem"
            onClick={run(() => onLayer('forward'))}
          >
            <span>{t('ctxBringForward')}</span>
          </button>
          <button
            type="button"
            className="wb-ctx-item"
            role="menuitem"
            onClick={run(() => onLayer('backward'))}
          >
            <span>{t('ctxSendBackward')}</span>
          </button>
          <button
            type="button"
            className="wb-ctx-item"
            role="menuitem"
            onClick={run(() => onLayer('back'))}
          >
            <span>{t('toolSendBack')}</span>
          </button>

          <div className="wb-ctx-sep" role="separator" />

          <button
            type="button"
            className="wb-ctx-item danger"
            role="menuitem"
            disabled={!hasUnlocked}
            onClick={run(onDelete)}
          >
            <span>{t('toolDelete')}</span>
            <kbd>Del</kbd>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="wb-ctx-item"
            role="menuitem"
            disabled={!hasClipboard}
            onClick={run(onPaste)}
          >
            <span>{t('ctxPaste')}</span>
            <kbd>Ctrl+V</kbd>
          </button>
          <button type="button" className="wb-ctx-item" role="menuitem" onClick={run(onSelectAll)}>
            <span>{t('ctxSelectAll')}</span>
            <kbd>Ctrl+A</kbd>
          </button>
        </>
      )}
    </div>
  )
}
