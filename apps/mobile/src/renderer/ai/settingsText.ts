/**
 * Small pure helpers of the settings' AI rows: Rust's refusal keys as the
 * screen's own strings, and the AI result store size as text.
 */
import type { MobileStringKey } from '../i18n'

/** The `messageKey` of a refused command, if the error carries one. */
export function messageKeyOf(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const key = (err as { messageKey?: unknown }).messageKey
  return typeof key === 'string' ? key : null
}

const CUSTOM_REASONS: Readonly<Record<string, MobileStringKey>> = {
  'mobile.ai.customHttpsOnly': 'aiCustomHttpsOnly',
  'mobile.ai.customInvalidUrl': 'aiCustomInvalidUrl',
  'mobile.ai.customCredentials': 'aiCustomCredentials',
}

/** Why the self-hosted server was not saved (anything unknown reads as a plain failure). */
export function customServerReason(err: unknown): MobileStringKey {
  return CUSTOM_REASONS[messageKeyOf(err) ?? ''] ?? 'aiCustomSaveFailed'
}

const TOOL_REASONS: Readonly<Record<string, MobileStringKey>> = {
  'mobile.ai.imageProviderNotAllowed': 'aiToolsErrProviderNotAllowed',
  'mobile.ai.imageProviderMissing': 'aiToolsErrProviderMissing',
  'mobile.ai.imageProviderNoKey': 'aiToolsErrProviderNoKey',
  'mobile.ai.imageModelMissing': 'aiToolsErrModelMissing',
  'mobile.ai.imageModelInvalid': 'aiToolsErrModelInvalid',
}

/** Why an AI tool setting was not saved. */
export function toolSettingsReason(err: unknown): MobileStringKey {
  return TOOL_REASONS[messageKeyOf(err) ?? ''] ?? 'aiToolsErrSaveFailed'
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** A byte count as "12 KB" / "3.4 MB" in the screen language's number form. */
export function formatAiBytes(bytes: number, lang: string): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  let number: string
  try {
    number = new Intl.NumberFormat(lang, {
      maximumFractionDigits: unit === 0 || value >= 10 ? 0 : 1,
    }).format(value)
  } catch {
    number = String(Math.round(value))
  }
  return `${number} ${UNITS[unit]}`
}
