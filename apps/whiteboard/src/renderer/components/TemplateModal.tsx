/**
 * Visual template gallery modal with category filters for one-click insertion
 * of 12 structured Miro-style boards.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  BUILTIN_TEMPLATES,
  type BuiltinTemplateCategory,
  type BuiltinTemplateId,
} from '../canvas/templates'
import { PAPER_COLORS } from '../canvas/paper-style'
import { useI18n } from '../i18n/locale'

export interface TemplateModalProps {
  readonly onSelect: (id: BuiltinTemplateId, target: 'current_page' | 'new_pages') => void
  readonly onClose: () => void
}

function TemplatePreview({ id }: { readonly id: BuiltinTemplateId }): ReactElement {
  switch (id) {
    case 'kanban':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <rect x="6" y="8" width="32" height="56" rx="4" fill="#F7F5F0" stroke="#CBD5E1" />
          <rect x="44" y="8" width="32" height="56" rx="4" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="82" y="8" width="32" height="56" rx="4" fill="#ECFDF3" stroke="#34D399" />
          <rect x="11" y="18" width="22" height="12" rx="2" fill="#FFF3A1" />
          <rect x="11" y="34" width="22" height="12" rx="2" fill="#FFF3A1" />
          <rect x="11" y="50" width="22" height="10" rx="2" fill="#FFDAB3" />
          <rect x="49" y="18" width="22" height="12" rx="2" fill="#CBE4FF" />
          <rect x="49" y="34" width="22" height="12" rx="2" fill="#E3D7FF" />
          <rect x="87" y="18" width="22" height="12" rx="2" fill="#CCF0D2" />
        </svg>
      )
    case 'swot':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <rect x="8" y="6" width="50" height="28" rx="4" fill="#ECFDF3" stroke="#34D399" />
          <rect x="62" y="6" width="50" height="28" rx="4" fill="#FFF1F2" stroke="#FB7185" />
          <rect x="8" y="38" width="50" height="28" rx="4" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="62" y="38" width="50" height="28" rx="4" fill="#FFFBEB" stroke="#F59E0B" />
          <rect x="13" y="16" width="16" height="12" rx="1.5" fill="#CCF0D2" />
          <rect x="67" y="16" width="16" height="12" rx="1.5" fill="#FFD1D8" />
          <rect x="13" y="48" width="16" height="12" rx="1.5" fill="#CBE4FF" />
          <rect x="67" y="48" width="16" height="12" rx="1.5" fill="#FFDAB3" />
        </svg>
      )
    case 'kpt':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <rect x="6" y="8" width="32" height="56" rx="4" fill="#ECFDF3" stroke="#34D399" />
          <rect x="44" y="8" width="32" height="56" rx="4" fill="#FFF1F2" stroke="#FB7185" />
          <rect x="82" y="8" width="32" height="56" rx="4" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="11" y="20" width="22" height="14" rx="2" fill="#CCF0D2" />
          <rect x="49" y="20" width="22" height="14" rx="2" fill="#FFD1D8" />
          <rect x="87" y="20" width="22" height="14" rx="2" fill="#CBE4FF" />
          <path d="M71 27h16" stroke="#2563EB" strokeWidth="1.2" fill="none" />
        </svg>
      )
    case 'flowchart':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <ellipse cx="18" cy="30" rx="11" ry="8" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="37" y="21" width="20" height="18" rx="4" fill="#FFFFFF" stroke="#CBD5E1" />
          <polygon points="75,18 88,30 75,42 62,30" fill="#FFFBEB" stroke="#F59E0B" />
          <ellipse cx="105" cy="22" rx="10" ry="7" fill="#ECFDF3" stroke="#34D399" />
          <rect x="64" y="50" width="22" height="14" rx="3" fill="#FFF1F2" stroke="#FB7185" />
          <path
            d="M29 30h8M57 30h5M88 30l7-8M75 42v8M64 57H47V39"
            stroke={PAPER_COLORS.connectorDefault}
            fill="none"
          />
        </svg>
      )
    case 'matrix_2x2':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <rect x="12" y="8" width="46" height="27" rx="3" fill="#ECFDF3" stroke="#34D399" />
          <rect x="62" y="8" width="46" height="27" rx="3" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="12" y="39" width="46" height="27" rx="3" fill="#FFFBEB" stroke="#F59E0B" />
          <rect x="62" y="39" width="46" height="27" rx="3" fill="#F7F5F0" stroke="#C7C0B3" />
          <rect x="18" y="16" width="14" height="12" rx="1.5" fill="#CCF0D2" />
          <rect x="36" y="16" width="14" height="12" rx="1.5" fill="#CCF0D2" />
          <rect x="68" y="16" width="14" height="12" rx="1.5" fill="#CBE4FF" />
        </svg>
      )
    case 'timeline':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <rect x="6" y="12" width="22" height="14" rx="3" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="35" y="12" width="22" height="14" rx="3" fill="#F5F3FF" stroke="#A78BFA" />
          <rect x="64" y="12" width="22" height="14" rx="3" fill="#FFFBEB" stroke="#F59E0B" />
          <rect x="93" y="12" width="22" height="14" rx="3" fill="#ECFDF3" stroke="#34D399" />
          <path d="M28 19h7M57 19h7M86 19h7" stroke={PAPER_COLORS.connectorDefault} fill="none" />
          <rect x="6" y="32" width="22" height="30" rx="2" fill="#CBE4FF" />
          <rect x="35" y="32" width="22" height="30" rx="2" fill="#E3D7FF" />
          <rect x="64" y="32" width="22" height="30" rx="2" fill="#FFF3A1" />
          <rect x="93" y="32" width="22" height="30" rx="2" fill="#CCF0D2" />
        </svg>
      )
    case 'mindmap':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <path d="M48 36C38 36 36 18 28 18M48 36C38 36 36 54 28 54" stroke="#2563EB" fill="none" />
          <path d="M72 36C82 36 84 18 92 18M72 36C82 36 84 54 92 54" stroke="#E11D48" fill="none" />
          <ellipse cx="60" cy="36" rx="14" ry="10" fill="#FFFBEB" stroke="#F59E0B" />
          <rect x="8" y="11" width="20" height="14" rx="3" fill="#CBE4FF" stroke="#60A5FA" />
          <rect x="8" y="47" width="20" height="14" rx="3" fill="#CCF0D2" stroke="#34D399" />
          <rect x="92" y="11" width="20" height="14" rx="3" fill="#FFD1D8" stroke="#FB7185" />
          <rect x="92" y="47" width="20" height="14" rx="3" fill="#E3D7FF" stroke="#A78BFA" />
        </svg>
      )
    case 'user_journey':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <rect
                x={18 + i * 20}
                y="8"
                width="16"
                height="10"
                rx="2"
                fill={['#EEF6FF', '#F5F3FF', '#FFFBEB', '#ECFDF3', '#FFF1F2'][i]}
                stroke={['#60A5FA', '#A78BFA', '#F59E0B', '#34D399', '#FB7185'][i]}
              />
              <rect x={18 + i * 20} y="22" width="16" height="12" rx="1.5" fill="#FFF3A1" />
              <rect x={18 + i * 20} y="38" width="16" height="12" rx="1.5" fill="#CBE4FF" />
              <rect x={18 + i * 20} y="54" width="16" height="12" rx="1.5" fill="#CCF0D2" />
            </g>
          ))}
          <rect x="4" y="22" width="11" height="44" rx="2" fill="#F7F5F0" stroke="#C7C0B3" />
        </svg>
      )
    case 'meeting_notes':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <rect x="6" y="7" width="108" height="8" rx="2" fill="#F7F5F0" stroke="#CBD5E1" />
          <rect x="6" y="19" width="48" height="30" rx="3" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="10" y="25" width="18" height="18" rx="1.5" fill="#FFF3A1" />
          <rect x="32" y="25" width="18" height="18" rx="1.5" fill="#CBE4FF" />
          <rect x="6" y="52" width="48" height="14" rx="3" fill="#ECFDF3" stroke="#34D399" />
          <rect x="59" y="19" width="55" height="47" rx="3" fill="#FFFFFF" stroke="#CBD5E1" />
          <path d="M59 30h55M59 42h55M59 54h55M82 19v47" stroke="#E4DFD5" />
        </svg>
      )
    case 'bmc':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <rect x="6" y="8" width="20" height="38" rx="2" fill="#F7F5F0" stroke="#CBD5E1" />
          <rect x="28" y="8" width="20" height="18" rx="2" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="28" y="28" width="20" height="18" rx="2" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="50" y="8" width="20" height="38" rx="2" fill="#FFFBEB" stroke="#F59E0B" />
          <rect x="72" y="8" width="20" height="18" rx="2" fill="#F5F3FF" stroke="#A78BFA" />
          <rect x="72" y="28" width="20" height="18" rx="2" fill="#F5F3FF" stroke="#A78BFA" />
          <rect x="94" y="8" width="20" height="38" rx="2" fill="#ECFDF3" stroke="#34D399" />
          <rect x="6" y="49" width="53" height="16" rx="2" fill="#FFF1F2" stroke="#FB7185" />
          <rect x="61" y="49" width="53" height="16" rx="2" fill="#ECFDF3" stroke="#34D399" />
        </svg>
      )
    case 'fishbone':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <path
            d="M10 36h76M24 14l14 22M56 14l14 22M24 58l14-22M56 58l14-22"
            stroke="#475569"
            fill="none"
          />
          <rect x="86" y="25" width="26" height="22" rx="4" fill="#FFF1F2" stroke="#FB7185" />
          <rect x="12" y="7" width="22" height="10" rx="2" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="44" y="7" width="22" height="10" rx="2" fill="#F5F3FF" stroke="#A78BFA" />
          <rect x="12" y="55" width="22" height="10" rx="2" fill="#FFFBEB" stroke="#F59E0B" />
          <rect x="44" y="55" width="22" height="10" rx="2" fill="#ECFDF3" stroke="#34D399" />
        </svg>
      )
    case 'okr':
      return (
        <svg viewBox="0 0 120 72" width="100%" height="72" aria-hidden="true">
          <rect x="30" y="6" width="60" height="12" rx="3" fill="#FFFBEB" stroke="#F59E0B" />
          <path d="M60 18L24 27M60 18v9M60 18l36 9" stroke="#475569" fill="none" />
          <rect x="8" y="27" width="32" height="14" rx="2.5" fill="#EEF6FF" stroke="#60A5FA" />
          <rect x="44" y="27" width="32" height="14" rx="2.5" fill="#F5F3FF" stroke="#A78BFA" />
          <rect x="80" y="27" width="32" height="14" rx="2.5" fill="#ECFDF3" stroke="#34D399" />
          <rect x="8" y="47" width="104" height="18" rx="2.5" fill="#FFFFFF" stroke="#CBD5E1" />
          <path d="M8 55h104M42 47v18M76 47v18" stroke="#E4DFD5" />
        </svg>
      )
  }
}

export function TemplateModal({ onSelect, onClose }: TemplateModalProps): ReactElement {
  const { t } = useI18n()
  const [target, setTarget] = useState<'current_page' | 'new_pages'>('new_pages')
  const [category, setCategory] = useState<'all' | BuiltinTemplateCategory>('all')

  const visibleTemplates =
    category === 'all'
      ? BUILTIN_TEMPLATES
      : BUILTIN_TEMPLATES.filter((tpl) => tpl.category === category)

  return (
    <div className="wb-modal-scrim" onPointerDown={onClose}>
      <div
        className="wb-modal wb-template-modal"
        role="dialog"
        aria-modal="true"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="wb-template-head">
          <h3>{t('templateDialogTitle')}</h3>
          <div className="wb-template-target">
            <label className="wb-checkbox">
              <input
                type="radio"
                name="wb-tpl-target"
                checked={target === 'new_pages'}
                onChange={() => setTarget('new_pages')}
              />
              <span>{t('templateTargetNewPage')}</span>
            </label>
            <label className="wb-checkbox">
              <input
                type="radio"
                name="wb-tpl-target"
                checked={target === 'current_page'}
                onChange={() => setTarget('current_page')}
              />
              <span>{t('templateTargetCurrentPage')}</span>
            </label>
          </div>
        </div>

        <div className="wb-template-cats" role="tablist">
          {(
            [
              ['all', 'tplCatAll'],
              ['strategy', 'tplCatStrategy'],
              ['brainstorm', 'tplCatBrainstorm'],
              ['collaboration', 'tplCatCollab'],
            ] as const
          ).map(([catId, labelKey]) => (
            <button
              key={catId}
              type="button"
              role="tab"
              aria-selected={category === catId}
              className={`wb-template-cat${category === catId ? ' active' : ''}`}
              onClick={() => setCategory(catId)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        <div className="wb-template-grid">
          {visibleTemplates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="wb-template-card"
              onClick={() => onSelect(tpl.id, target)}
            >
              <div className="wb-template-preview">
                <TemplatePreview id={tpl.id} />
              </div>
              <div className="wb-template-title">{t(tpl.titleKey)}</div>
              <div className="wb-template-desc">{t(tpl.descKey)}</div>
            </button>
          ))}
        </div>
        <div className="wb-modal-actions">
          <button type="button" className="wb-btn wb-btn-secondary" onClick={onClose}>
            {t('btnClose')}
          </button>
        </div>
      </div>
    </div>
  )
}
