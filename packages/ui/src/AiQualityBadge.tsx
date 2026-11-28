import React, { useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { QualityFinding } from '@genoffice/agent-core'
import { qualityAuditText } from './strings-quality-audit'
import './ai-quality-badge.css'

export interface AiQualityBadgeProps {
  readonly findings: readonly QualityFinding[]
  readonly aiVisible: boolean
  readonly lang: Lang
  readonly busy?: boolean | undefined
  readonly onFixWithAi?: (() => void) | undefined
}

export function AiQualityBadge({
  findings,
  aiVisible,
  lang,
  busy = false,
  onFixWithAi,
}: AiQualityBadgeProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  if (!aiVisible || findings.length === 0) return null

  return (
    <div className="ai-qc-wrap" data-testid="ai-quality-badge">
      <div className="ai-qc-bar">
        <button
          type="button"
          className="ai-qc-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {qualityAuditText(lang, 'badgeLabel', { n: findings.length })}
        </button>
        {onFixWithAi && (
          <button type="button" className="ai-qc-fix-btn" disabled={busy} onClick={onFixWithAi}>
            {qualityAuditText(lang, 'fixWithAi')}
          </button>
        )}
      </div>
      {expanded && (
        <ul className="ai-qc-list">
          {findings.map((f) => (
            <li key={f.id}>
              <span className="ai-qc-sev">{f.severity}</span>
              {f.location && <strong>[{f.location}] </strong>}
              <span>{f.message}</span>
            </li>
          ))}
          <li className="ai-qc-note">{qualityAuditText(lang, 'nonBlockingNote')}</li>
        </ul>
      )}
    </div>
  )
}
