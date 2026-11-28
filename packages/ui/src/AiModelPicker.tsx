import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  ollamaEffortPresetOf,
  prettyModelName,
  type AiEffort,
  type AiSettings,
  type OllamaEffortPreset,
  type AiSubscriptionStatuses,
} from '@genoffice/ai-provider/browser'
import {
  aiEffortChoice,
  aiProviderPickerGroups,
  aiProviderPickerSelection,
  aiSubscriptionModelName,
  withAiEffort,
  withAiEffortFitted,
  withAiProviderSelection,
  type AiEffortChoice,
  type AiProviderPickerGroup,
  type AiProviderPickerSelection,
} from './ai-model-picker-options'
import { AiMark } from './AiMark'
import { AiCodexNotice } from './AiSubscriptionNotices'
import { changeStoredAiSettings } from './ai-send-gate'
import { ProviderLogo } from './provider-logos'
import { useDismissablePopover } from './popover-dismiss'
import { AI_EFFORT_STRINGS, AI_MODEL_PICKER_STRINGS } from './strings-ai-model-picker'
import { aiSubscriptionText } from './strings-ai-subscription'

/** Each app's preload exposes these under its own namespace; the panel adapts them. */
export interface AiModelPickerBridge {
  readonly getSettings: () => Promise<AiSettings>
  readonly setSettings: (settings: AiSettings) => Promise<void>
  /** fires after any renderer (this one, another tab, the shell settings page) saved ai-settings.json */
  readonly onSettingsChanged?: ((handler: () => void) => () => void) | undefined
  /** shell: switch to Home and open Settings › AI Model */
  readonly openModelSettings?: (() => Promise<void> | void) | undefined
}

/**
 * How often opening the picker asks the subscription connection to check its
 * CLIs again. A model released while the app stays open should appear without
 * a restart; checking more often than this only starts the CLIs again.
 */
export const AI_MODEL_PICKER_REFRESH_MS = 2 * 60_000

/**
 * Where the model popover goes for a chip at `rect`: above it in the composer
 * (the bottom of the panel), below it in a confirmation dialog near the top.
 * `maxHeight` keeps the list inside the side it opens to.
 */
export function aiModelPopoverStyle(
  rect: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  width = 260,
  maxHeight = 420,
): React.CSSProperties {
  const left = Math.max(8, Math.min(rect.left, viewport.width - width - 8))
  const below = viewport.height - rect.bottom - 8
  const above = rect.top - 8
  const down = below >= 180 || below >= above
  const space = Math.max(120, down ? below : above)
  const height = Math.min(maxHeight, space)
  return down
    ? { left, top: rect.bottom + 6, maxHeight: height }
    : { left, bottom: viewport.height - rect.top + 6, maxHeight: height }
}

/** Subscription connections are named in text and carry the neutral AI mark, never a vendor logo */
function PickerMark({ group }: { readonly group: Pick<AiProviderPickerGroup, 'kind' | 'id'> }) {
  if (group.kind === 'key') return <ProviderLogo id={group.id} />
  return (
    <span className="gs-provider-logo" aria-hidden="true">
      <AiMark size={14} />
    </span>
  )
}

interface OllamaEffortOption {
  readonly effort: OllamaEffortPreset
  readonly endpointId: string
}

interface OllamaModelItem {
  readonly rawModel: string
  readonly prettyName: string
  readonly efforts: readonly OllamaEffortOption[]
  readonly currentEffort?: OllamaEffortPreset | undefined
  readonly activeEndpointId: string
  readonly isSelected: boolean
}

interface OllamaServerDisplayGroup {
  readonly serverId: string
  readonly serverName: string
  readonly items: readonly OllamaModelItem[]
}

function effortLabel(effort: OllamaEffortPreset | string): string {
  switch (effort) {
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    default:
      return effort
  }
}

function getOllamaServerGroups(
  settings: AiSettings,
  current: AiProviderPickerSelection | null,
): OllamaServerDisplayGroup[] {
  const ollamaServers = settings.ollamaServers ?? []
  const customEndpoints = settings.customEndpoints ?? []
  const allOllamaEndpointIds = new Set(ollamaServers.flatMap((s) => s.endpointIds))

  const ollamaEndpoints = customEndpoints.filter(
    (ep) => allOllamaEndpointIds.has(ep.id) && ep.baseUrl && ep.model,
  )

  const serverGroups: OllamaServerDisplayGroup[] = []
  const EFFORT_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 }

  for (const server of ollamaServers) {
    const serverEps = ollamaEndpoints.filter((ep) => server.endpointIds.includes(ep.id))
    if (serverEps.length === 0) continue

    const modelMap = new Map<string, typeof serverEps>()
    for (const ep of serverEps) {
      const list = modelMap.get(ep.model) ?? []
      list.push(ep)
      modelMap.set(ep.model, list)
    }

    const items: OllamaModelItem[] = []

    for (const [rawModel, eps] of modelMap.entries()) {
      const prettyName = prettyModelName(rawModel)
      const efforts: OllamaEffortOption[] = []
      for (const ep of eps) {
        const preset = ollamaEffortPresetOf(ep.effort)
        if (preset) {
          efforts.push({ effort: preset, endpointId: ep.id })
        }
      }
      efforts.sort((a, b) => (EFFORT_ORDER[a.effort] ?? 99) - (EFFORT_ORDER[b.effort] ?? 99))

      const selectedEp = eps.find(
        (ep) => current?.provider === 'custom' && current?.endpoint === ep.id,
      )
      const isSelected = Boolean(selectedEp)

      let currentEffort: OllamaEffortPreset | undefined = ollamaEffortPresetOf(selectedEp?.effort)
      if (!currentEffort && efforts.length > 0) {
        currentEffort = efforts.some((e) => e.effort === 'medium') ? 'medium' : efforts[0]?.effort
      }

      const activeEndpointId =
        selectedEp?.id ??
        efforts.find((e) => e.effort === currentEffort)?.endpointId ??
        eps[0]?.id ??
        ''

      items.push({
        rawModel,
        prettyName,
        efforts,
        currentEffort,
        activeEndpointId,
        isSelected,
      })
    }

    if (items.length > 0) {
      serverGroups.push({
        serverId: server.id,
        serverName: server.name || 'Ollama',
        items,
      })
    }
  }

  return serverGroups
}

/**
 * Model chip showing the active provider + model; the popover lists every
 * usable provider's models for a one-click switch (saved globally, the same
 * ai-settings.json the settings page edits) and ends with a row that opens
 * that page for keys and new vendors. Used in the composer footer and, with
 * `showLabel`, in the document-job confirmation dialogs.
 *
 * The list follows the subscription contract: an automatic entry, the
 * connected subscriptions, then the key providers that are filled in. Without
 * `subscriptionStatuses` no subscription counts as connected.
 */
export function AiModelPicker({
  bridge,
  lang,
  subscriptionStatuses,
  showLabel = false,
  onRefreshSubscriptions,
}: {
  readonly bridge: AiModelPickerBridge
  readonly lang: Lang
  /** status of the subscription CLIs */
  readonly subscriptionStatuses?: AiSubscriptionStatuses | undefined
  /** a visible "Model" label before the chip (a confirmation dialog has no composer footer) */
  readonly showLabel?: boolean | undefined
  /**
   * Ask for a fresh subscription check, so a model released while the app has
   * been open appears in the list. Called when the popover opens, at most once
   * per `AI_MODEL_PICKER_REFRESH_MS`.
   */
  readonly onRefreshSubscriptions?: (() => void) | undefined
}): React.JSX.Element | null {
  const strings = AI_MODEL_PICKER_STRINGS[lang] ?? AI_MODEL_PICKER_STRINGS.en
  const effortStrings = AI_EFFORT_STRINGS[lang] ?? AI_EFFORT_STRINGS.en
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [open, setOpen] = useState(false)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const [submenuPos, setSubmenuPos] = useState<React.CSSProperties>({})
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  const refreshedAt = useRef(0)

  // tests render panels without a preload bridge: a throwing getter must not take the panel down
  const refresh = useCallback(() => {
    Promise.resolve()
      .then(() => bridge.getSettings())
      .then(setSettings, () => {})
  }, [bridge])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    let off: (() => void) | undefined
    try {
      off = bridge.onSettingsChanged?.(refresh)
    } catch {
      off = undefined
    }
    return () => {
      window.removeEventListener('focus', refresh)
      off?.()
    }
  }, [bridge, refresh])

  const close = useCallback(() => {
    setOpen(false)
    setActiveSubmenu(null)
  }, [])
  useDismissablePopover(open, close, {
    inside: () => [chipRef.current, popRef.current, submenuRef.current],
  })

  const groups = useMemo<AiProviderPickerGroup[]>(() => {
    if (!settings) return []
    return aiProviderPickerGroups(settings, subscriptionStatuses ?? {})
  }, [settings, subscriptionStatuses])
  const picked = settings ? aiProviderPickerSelection(settings, subscriptionStatuses ?? {}) : null
  const current: AiProviderPickerSelection | null = picked
  const sameGroup = (g: { id: string; endpoint?: string | undefined }) =>
    g.id === current?.provider && (g.id !== 'custom' || g.endpoint === current?.endpoint)
  const currentUsable = groups.some(sameGroup)

  const ollamaServerGroups = useMemo(() => {
    if (!settings) return []
    return getOllamaServerGroups(settings, current)
  }, [settings, current])

  const allOllamaEndpointIds = useMemo(() => {
    return new Set(settings?.ollamaServers?.flatMap((s) => s.endpointIds) ?? [])
  }, [settings])

  const activeOllamaItem = useMemo(() => {
    if (!activeSubmenu) return null
    for (const s of ollamaServerGroups) {
      for (const item of s.items) {
        if (`${s.serverId}:${item.rawModel}` === activeSubmenu) {
          return item
        }
      }
    }
    return null
  }, [activeSubmenu, ollamaServerGroups])

  const toggle = () => {
    if (!open) {
      const rect = chipRef.current?.getBoundingClientRect()
      // the composer sits at the panel bottom, a dialog's chip near its top: fit the side with room
      if (rect)
        setPopStyle(
          aiModelPopoverStyle(rect, { width: window.innerWidth, height: window.innerHeight }),
        )
      // the list may be from an earlier check: a model released since then shows after this one
      if (
        onRefreshSubscriptions &&
        Date.now() - refreshedAt.current >= AI_MODEL_PICKER_REFRESH_MS
      ) {
        refreshedAt.current = Date.now()
        onRefreshSubscriptions()
      }
    }
    setOpen((v) => {
      if (v) setActiveSubmenu(null)
      return !v
    })
  }

  const save = (change: (latest: AiSettings) => AiSettings) => {
    if (!settings) return
    // shown at once on the copy at hand; written onto what is stored now, so a change another
    // window saved since this picker last read the settings is not written back
    setSettings(change(settings))
    void changeStoredAiSettings(bridge, change, settings).then((written) => {
      if (written) setSettings(written)
    })
  }

  const pick = (sel: AiProviderPickerSelection) => {
    setOpen(false)
    setActiveSubmenu(null)
    // a level the newly picked model does not take is dropped, so the chip does not show it
    save((latest) =>
      withAiEffortFitted(withAiProviderSelection(latest, sel), subscriptionStatuses ?? {}),
    )
  }

  // the list stays open: the level is picked after the model, and the row shows what is set
  const pickEffort = (choice: AiEffortChoice, effort: AiEffort | undefined) => {
    save((latest) => withAiEffort(latest, choice.provider, effort, choice.endpoint))
  }

  const manage = () => {
    setOpen(false)
    setActiveSubmenu(null)
    void bridge.openModelSettings?.()
  }

  const openSubmenu = useCallback((modelKey: string, el: HTMLElement) => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
    const rect = el.getBoundingClientRect()
    const submenuWidth = 110
    let left = rect.right + 4
    if (left + submenuWidth > window.innerWidth - 8) {
      left = Math.max(8, rect.left - submenuWidth - 4)
    }
    let top = rect.top - 2
    if (top + 130 > window.innerHeight) {
      top = Math.max(8, window.innerHeight - 140)
    }
    setSubmenuPos({ top, left })
    setActiveSubmenu(modelKey)
  }, [])

  const handleRowMouseEnter = useCallback(
    (modelKey: string, el: HTMLElement, hasMultipleEfforts: boolean) => {
      if (hasMultipleEfforts) {
        openSubmenu(modelKey, el)
      } else {
        if (leaveTimer.current) {
          clearTimeout(leaveTimer.current)
          leaveTimer.current = null
        }
        setActiveSubmenu(null)
      }
    },
    [openSubmenu],
  )

  const handleRowMouseLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => {
      setActiveSubmenu(null)
    }, 200)
  }, [])

  const handleSubmenuMouseEnter = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }, [])

  const handleSubmenuMouseLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => {
      setActiveSubmenu(null)
    }, 200)
  }, [])

  if (!settings) return null
  const currentGroup = groups.find(sameGroup)
  const paid = aiSubscriptionText(lang, 'pickerPaid')
  const paidTitle = aiSubscriptionText(lang, 'pickerPaidTitle')
  const usable = currentUsable && current
  // the concrete model a subscription runs on, when its CLI listed its models: under
  // "automatic" too, so the chip tells what will answer
  const running = usable ? picked?.resolved : undefined
  const modelName = aiSubscriptionModelName(settings, subscriptionStatuses ?? {}, running)
  const runningGroup = groups.find((g) => g.kind === 'subscription' && g.id === running)
  const modelId = runningGroup?.details?.get(picked?.model ?? '')?.concrete
  const fullText = !usable
    ? subscriptionStatuses
      ? aiSubscriptionText(lang, 'pickerNotConnected')
      : strings.choose
    : currentGroup?.kind === 'auto'
      ? modelName
        ? aiSubscriptionText(lang, 'pickerAutoUsingModel', {
            provider: currentGroup.label,
            model: modelName,
          })
        : aiSubscriptionText(lang, 'pickerAutoUsing', { provider: currentGroup.label })
      : modelName && currentGroup
        ? `${currentGroup.label} · ${modelName}`
        : (currentGroup?.details?.get(current.model)?.name ?? current.model) ||
          (currentGroup?.label ?? '')
  // The composer footer is narrow: under automatic the chip names the model and leaves the
  // provider to the tooltip and the list, so the model is not the part that gets cut off.
  const chipText =
    usable && currentGroup?.kind === 'auto' && modelName
      ? aiSubscriptionText(lang, 'pickerAutoUsing', { provider: modelName })
      : fullText
  const effortChoice = usable ? aiEffortChoice(settings, subscriptionStatuses ?? {}) : undefined
  const effortName = effortChoice?.current ? effortStrings.levels[effortChoice.current] : undefined
  const withEffort = (text: string) => (effortName ? `${text} · ${effortName}` : text)
  const chipTip = modelName
    ? `${strings.title}: ${withEffort(fullText)}${modelId ? ` (${modelId})` : ''}`
    : strings.title

  const subscriptionAndAutoGroups = groups.filter(
    (g) => g.kind === 'auto' || g.kind === 'subscription',
  )
  const otherGroups = groups.filter(
    (g) =>
      g.kind !== 'auto' &&
      g.kind !== 'subscription' &&
      (!g.endpoint || !allOllamaEndpointIds.has(g.endpoint)),
  )

  const renderStandardGroup = (g: AiProviderPickerGroup) => (
    <div key={g.endpoint ? `${g.id}:${g.endpoint}` : g.id} className="ai-model-group">
      {g.kind !== 'auto' && (
        <div className="ai-model-group-head">
          <PickerMark group={g} />
          <span>{g.label}</span>
          {g.metered ? (
            <span className="ai-model-cost" title={paidTitle}>
              {paid}
            </span>
          ) : (
            g.kind === 'subscription' && (
              <span className="ai-model-tag">{aiSubscriptionText(lang, 'pickerSubscription')}</span>
            )
          )}
        </div>
      )}
      {/* said where Codex is chosen; a key provider of the same name is not this connection */}
      {g.kind === 'subscription' && g.id === 'codex' && <AiCodexNotice lang={lang} compact />}
      {(g.models.length > 0 ? g.models : ['']).map((m) => {
        const selected = sameGroup(g) && (g.kind === 'auto' || current?.model === m)
        // what the CLI itself says about this model, when it listed its models
        const detail = g.details?.get(m)
        const autoModel =
          g.kind === 'auto'
            ? aiSubscriptionModelName(settings, subscriptionStatuses ?? {}, g.resolved)
            : undefined
        return (
          <button
            key={`${g.id}:${g.endpoint ?? ''}:${m}`}
            type="button"
            role="option"
            aria-selected={selected}
            className={`ai-model-item${g.kind === 'auto' ? ' ai-model-auto' : ''}${selected ? ' selected' : ''}`}
            onClick={() => pick({ provider: g.id, endpoint: g.endpoint, model: m })}
          >
            {g.kind === 'auto' && <PickerMark group={g} />}
            <span className="ai-model-item-text">
              {g.kind === 'auto'
                ? autoModel
                  ? aiSubscriptionText(lang, 'pickerAutoUsingModel', {
                      provider: g.label,
                      model: autoModel,
                    })
                  : aiSubscriptionText(lang, 'pickerAutoUsing', { provider: g.label })
                : g.kind === 'subscription'
                  ? m
                    ? (detail?.name ?? m)
                    : detail
                      ? aiSubscriptionText(lang, 'pickerDefaultModelNamed', {
                          model: detail.name,
                        })
                      : aiSubscriptionText(lang, 'pickerDefaultModel')
                  : (detail?.name ?? m) || g.label}
              {detail?.concrete && (
                <>
                  {' '}
                  <span className="ai-model-item-id">{detail.concrete}</span>
                </>
              )}
            </span>
            {selected && (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path
                  d="M2.5 6.5 5 9l4.5-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )

  const renderOllamaServerGroup = (server: OllamaServerDisplayGroup) => (
    <div key={server.serverId} className="ai-model-group">
      <div className="ai-model-group-head">
        <span className="gs-provider-logo" aria-hidden="true">
          <ProviderLogo id="custom" />
        </span>
        <span>{server.serverName}</span>
      </div>
      {server.items.map((item) => {
        const modelKey = `${server.serverId}:${item.rawModel}`
        const isSubmenuOpen = activeSubmenu === modelKey
        const hasMultipleEfforts = item.efforts.length > 1
        return (
          <button
            key={modelKey}
            type="button"
            role="option"
            aria-selected={item.isSelected}
            aria-haspopup={hasMultipleEfforts ? 'true' : undefined}
            aria-expanded={hasMultipleEfforts ? isSubmenuOpen : undefined}
            className={`ai-model-item ai-model-ollama-item${item.isSelected ? ' selected' : ''}${isSubmenuOpen ? ' submenu-open' : ''}`}
            title={item.rawModel}
            onMouseEnter={(e) => handleRowMouseEnter(modelKey, e.currentTarget, hasMultipleEfforts)}
            onMouseLeave={handleRowMouseLeave}
            onClick={(e) => {
              if (hasMultipleEfforts) {
                if (isSubmenuOpen) {
                  setActiveSubmenu(null)
                } else {
                  openSubmenu(modelKey, e.currentTarget)
                }
              } else {
                pick({ provider: 'custom', endpoint: item.activeEndpointId, model: item.rawModel })
              }
            }}
          >
            <span className="ai-model-item-text ai-model-ollama-text">
              <span className="ai-model-ollama-name">{item.prettyName}</span>
              {item.currentEffort && (
                <span className="ai-model-effort-badge">{effortLabel(item.currentEffort)}</span>
              )}
            </span>
            {hasMultipleEfforts && (
              <svg
                className="ai-model-chevron"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                aria-hidden
              >
                <path
                  d="m4.5 2.5 3.5 3.5-3.5 3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {item.isSelected && (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path
                  d="M2.5 6.5 5 9l4.5-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      className="ai-model-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          if (activeSubmenu) {
            setActiveSubmenu(null)
          } else {
            setOpen(false)
            chipRef.current?.focus()
          }
        }
      }}
    >
      {showLabel && (
        <span className="ai-model-picker-label" aria-hidden="true">
          {strings.title}
        </span>
      )}
      <button
        ref={chipRef}
        type="button"
        className={`ai-model-chip${open ? ' open' : ''}`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tip={chipTip}
        aria-label={`${strings.title}: ${withEffort(fullText)}`}
      >
        {currentUsable && currentGroup && <PickerMark group={currentGroup} />}
        <span className="ai-model-chip-text">{withEffort(chipText)}</span>
        {currentUsable && picked?.metered && (
          <span className="ai-model-cost" title={paidTitle}>
            {paid}
          </span>
        )}
        <svg className="ai-model-chip-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 6.5 5 3.5l3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          ref={popRef}
          className="ai-model-pop"
          role="listbox"
          aria-label={strings.title}
          style={popStyle}
        >
          <div className="ai-model-pop-list" onScroll={() => setActiveSubmenu(null)}>
            {subscriptionAndAutoGroups.map(renderStandardGroup)}
            {ollamaServerGroups.map(renderOllamaServerGroup)}
            {otherGroups.map(renderStandardGroup)}
          </div>
          {activeOllamaItem && activeOllamaItem.efforts.length > 1 && (
            <div
              ref={submenuRef}
              className="ai-model-submenu-pop"
              role="menu"
              style={submenuPos}
              onMouseEnter={handleSubmenuMouseEnter}
              onMouseLeave={handleSubmenuMouseLeave}
            >
              {activeOllamaItem.efforts.map(({ effort, endpointId }) => {
                const isSelectedEffort =
                  current?.provider === 'custom' && current?.endpoint === endpointId
                return (
                  <button
                    key={effort}
                    type="button"
                    role="menuitem"
                    className={`ai-model-submenu-item${isSelectedEffort ? ' selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveSubmenu(null)
                      pick({
                        provider: 'custom',
                        endpoint: endpointId,
                        model: activeOllamaItem.rawModel,
                      })
                    }}
                  >
                    <span className="ai-model-submenu-label">{effortLabel(effort)}</span>
                    {isSelectedEffort && (
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                        <path
                          d="M2.5 6.5 5 9l4.5-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {effortChoice && (
            <div className="ai-effort" role="group" aria-label={effortStrings.title}>
              <div className="ai-effort-head" data-tip={effortStrings.hint}>
                {effortStrings.title}
              </div>
              <div className="ai-effort-options">
                {[undefined, ...effortChoice.efforts].map((level) => {
                  const selected = level === effortChoice.current
                  const label = level
                    ? effortStrings.levels[level]
                    : effortChoice.defaultEffort
                      ? effortStrings.autoNamed.replace(
                          '{level}',
                          effortStrings.levels[effortChoice.defaultEffort],
                        )
                      : effortStrings.auto
                  return (
                    <button
                      key={level ?? ''}
                      type="button"
                      className={`ai-effort-option${selected ? ' selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => pickEffort(effortChoice, level)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {bridge.openModelSettings && (
            <button type="button" className="ai-model-item ai-model-manage" onClick={manage}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
              <span className="ai-model-item-text">{strings.manage}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
