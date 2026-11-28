import React, { useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { versionTimelineText } from './strings-version-timeline'
import './version-timeline-drawer.css'

export type DrawerVersionSource = 'ai' | 'save' | 'checkpoint' | 'restore'

export interface DrawerVersionEntry {
  readonly id: string
  readonly source: DrawerVersionSource
  readonly createdAt: string
  readonly promptSummary?: string | undefined
  readonly label?: string | undefined
  readonly changeSummary?: string | undefined
}

export interface VersionTimelineDrawerProps {
  readonly open: boolean
  readonly lang: Lang
  readonly entries: readonly DrawerVersionEntry[]
  readonly encryptedMemoryOnly?: boolean | undefined
  readonly onSaveCheckpoint: (label?: string) => void | Promise<void>
  readonly onRestore: (entry: DrawerVersionEntry) => void | Promise<void>
  readonly onDelete: (entry: DrawerVersionEntry) => void | Promise<void>
  readonly onCopyPrompt?: ((prompt: string) => void) | undefined
  readonly onClose?: (() => void) | undefined
  readonly renderPreview?: ((entry: DrawerVersionEntry) => React.ReactNode) | undefined
}

function sourceLabel(lang: Lang, source: DrawerVersionSource): string {
  switch (source) {
    case 'ai':
      return versionTimelineText(lang, 'sourceAi')
    case 'save':
      return versionTimelineText(lang, 'sourceSave')
    case 'checkpoint':
      return versionTimelineText(lang, 'sourceCheckpoint')
    case 'restore':
      return versionTimelineText(lang, 'sourceRestore')
  }
}

export function VersionTimelineDrawer({
  open,
  lang,
  entries,
  encryptedMemoryOnly = false,
  onSaveCheckpoint,
  onRestore,
  onDelete,
  onCopyPrompt,
  onClose,
  renderPreview,
}: VersionTimelineDrawerProps): React.JSX.Element | null {
  const [label, setLabel] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  if (!open) return null

  const selected = entries.find((e) => e.id === selectedId) ?? null

  const copyPrompt = (entry: DrawerVersionEntry) => {
    if (!entry.promptSummary) return
    if (onCopyPrompt) onCopyPrompt(entry.promptSummary)
    else void navigator.clipboard?.writeText(entry.promptSummary)
    setCopiedId(entry.id)
    setTimeout(() => setCopiedId((cur) => (cur === entry.id ? null : cur)), 1500)
  }

  return (
    <aside className="vt-drawer" data-testid="version-timeline-drawer">
      <div className="vt-header">
        <span>{versionTimelineText(lang, 'title')}</span>
        {onClose && (
          <button type="button" className="vt-btn" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <div className="vt-checkpoint-bar">
        <input
          type="text"
          className="vt-checkpoint-input"
          value={label}
          placeholder={versionTimelineText(lang, 'checkpointPlaceholder')}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          type="button"
          className="vt-btn vt-btn-primary"
          onClick={() => {
            const trimmed = label.trim()
            setLabel('')
            void onSaveCheckpoint(trimmed || undefined)
          }}
        >
          {versionTimelineText(lang, 'saveCheckpoint')}
        </button>
      </div>
      {encryptedMemoryOnly && (
        <div className="vt-notice" data-testid="vt-encrypted-notice">
          {versionTimelineText(lang, 'encryptedNotice')}
        </div>
      )}
      <div className="vt-list">
        {entries.length === 0 ? (
          <div className="vt-empty">{versionTimelineText(lang, 'empty')}</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`vt-card${selected?.id === entry.id ? ' vt-card-active' : ''}`}
              onClick={() => setSelectedId(entry.id)}
            >
              <div className="vt-card-top">
                <span className="vt-badge">{sourceLabel(lang, entry.source)}</span>
                <span className="vt-time">{entry.createdAt.slice(0, 16).replace('T', ' ')}</span>
              </div>
              {entry.label && <strong>{entry.label}</strong>}
              {entry.promptSummary && <div className="vt-prompt">{entry.promptSummary}</div>}
              {entry.changeSummary && <div className="vt-prompt">{entry.changeSummary}</div>}
              <div className="vt-card-actions" onClick={(e) => e.stopPropagation()}>
                {entry.promptSummary && (
                  <button type="button" className="vt-btn" onClick={() => copyPrompt(entry)}>
                    {copiedId === entry.id
                      ? versionTimelineText(lang, 'copied')
                      : versionTimelineText(lang, 'copyPrompt')}
                  </button>
                )}
                <button
                  type="button"
                  className="vt-btn vt-btn-primary"
                  onClick={() => void onRestore(entry)}
                >
                  {versionTimelineText(lang, 'restoreVersion')}
                </button>
                <button type="button" className="vt-btn" onClick={() => void onDelete(entry)}>
                  {versionTimelineText(lang, 'deleteVersion')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      {selected && renderPreview && <div className="vt-preview">{renderPreview(selected)}</div>}
    </aside>
  )
}
