// The AI result store card the storage section draws (track T7 AI-T6, spec
// 3.5): size and file count even while AI is off, [clear] behind a confirm
// sheet, no clearing while an AI run is going, the size read again after.
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { publishMobileAiRunState } from '../src/renderer/ai/runState'
import { formatAiBytes } from '../src/renderer/ai/settingsText'
import { ko as aiKo } from '../src/renderer/i18n/ai/ko'
import {
  byTestId,
  click,
  commandsNamed,
  makeSettingsFake,
  mountSettings,
  unmountAll,
} from './ai-settings-fake'

afterEach(() => {
  unmountAll()
  publishMobileAiRunState({ running: false, queued: 0 })
})

const MB3 = 3 * 1024 * 1024 + 300 * 1024

describe('the AI result store rows', () => {
  it('shows the size and file count while AI is off', async () => {
    const fake = makeSettingsFake({ results: { bytes: MB3, files: 4 } })
    await mountSettings(fake, { aiEnabled: false })
    const size = byTestId('ai-results-size')
    expect(size?.textContent).toContain(formatAiBytes(MB3, 'ko'))
    expect(size?.textContent).toContain('4')
    expect(formatAiBytes(MB3, 'ko')).toBe('3.3 MB')
    // its own card with a heading: the storage section draws it after its own card
    const card = byTestId('ai-results-row')?.closest('.mobile-card')
    expect(card?.getAttribute('data-testid')).toBe('ai-results-card')
    expect(card?.querySelector('.mobile-card-subtitle')?.textContent).toBe(aiKo.aiResultsTitle)
  })

  it('clears behind a confirm sheet and reads the size again', async () => {
    const fake = makeSettingsFake({ results: { bytes: 2048, files: 2 } })
    await mountSettings(fake)
    await click(byTestId('ai-results-clear'))
    expect(byTestId('ai-results-clear-sheet')?.textContent).toContain(aiKo.aiResultsClearTitle)
    expect(commandsNamed(fake, 'mobile_ai_results_clear')).toHaveLength(0)

    const sizeReads = commandsNamed(fake, 'mobile_ai_results_size').length
    await click(byTestId('ai-results-clear-confirm'))
    expect(commandsNamed(fake, 'mobile_ai_results_clear')).toHaveLength(1)
    expect(commandsNamed(fake, 'mobile_ai_results_size').length).toBeGreaterThan(sizeReads)
    expect(byTestId('ai-results-clear-sheet')).toBeNull()
    expect(byTestId('ai-results-size')?.textContent).toContain(formatAiBytes(0, 'ko'))
  })

  it('cancel keeps everything', async () => {
    const fake = makeSettingsFake({ results: { bytes: 2048, files: 2 } })
    await mountSettings(fake)
    await click(byTestId('ai-results-clear'))
    await click(byTestId('ai-results-clear-cancel'))
    expect(byTestId('ai-results-clear-sheet')).toBeNull()
    expect(commandsNamed(fake, 'mobile_ai_results_clear')).toHaveLength(0)
    expect(fake.results.files).toBe(2)
  })

  it('does not clear while an AI run is going, and says why', async () => {
    const fake = makeSettingsFake({ results: { bytes: 2048, files: 2 } })
    await mountSettings(fake)
    act(() => publishMobileAiRunState({ running: true, queued: 0 }))
    const clear = byTestId<HTMLButtonElement>('ai-results-clear')!
    expect(clear.disabled).toBe(true)
    expect(byTestId('ai-results-busy')?.textContent).toBe(aiKo.aiResultsClearBusy)
    await click(clear)
    expect(byTestId('ai-results-clear-sheet')).toBeNull()

    act(() => publishMobileAiRunState({ running: false, queued: 0 }))
    expect(byTestId<HTMLButtonElement>('ai-results-clear')!.disabled).toBe(false)
    expect(byTestId('ai-results-busy')).toBeNull()
  })

  it('refuses at confirm time when a run started after the sheet opened', async () => {
    const fake = makeSettingsFake({ results: { bytes: 2048, files: 2 } })
    await mountSettings(fake)
    await click(byTestId('ai-results-clear'))
    act(() => publishMobileAiRunState({ running: true, queued: 0 }))
    const confirm = byTestId<HTMLButtonElement>('ai-results-clear-confirm')
    if (confirm && !confirm.disabled) await click(confirm)
    expect(commandsNamed(fake, 'mobile_ai_results_clear')).toHaveLength(0)
  })
})
