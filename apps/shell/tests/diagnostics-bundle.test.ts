import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { buildDiagnosticsPreview, buildDiagnosticsZip } from '../src/main/diagnostics-bundle'
import { diagnosticsUiText } from '../src/renderer/src/i18n/strings-diagnostics'

describe('diagnostics bundle whitelist and ZIP export', () => {
  it('strictly strips adversarial paths, emails, API keys, and raw messages from crash logs and produces a valid ZIP', () => {
    const adversarialCrash = [
      JSON.stringify({
        at: '2026-11-23T12:00:00.000Z',
        kind: 'renderer',
        reason: 'crashed',
        exitCode: 1,
        editor: 'slides',
        appMB: 210,
        // Adversarial fields that must NEVER survive sanitization:
        filePath: 'C:\\Users\\alice\\Documents\\secret-budget.pptx',
        email: 'alice@example.com',
        apiKey: 'sk-ant-secret-token-12345',
        message: 'Failed opening C:\\Users\\alice\\secret.docx',
      }),
      'not valid json line with sk-secret',
      JSON.stringify({
        at: '2026-11-23T12:01:00.000Z',
        kind: 'unknown-kind',
        reason: 'should-drop',
      }),
    ].join('\n')

    const preview = buildDiagnosticsPreview({
      appVersion: '0.13.2',
      platform: 'win32',
      arch: 'x64',
      osRelease: '10.0.22631',
      uiLang: 'ko',
      subscriptions: {
        'claude-code': { state: 'ready', version: '1.0.20' },
        'bad/key/path': { state: 'ready' },
      },
      crashLogRaw: adversarialCrash,
    })

    expect(preview.files.map((f) => f.name)).toEqual(['app-info.json', 'crash-summary.jsonl'])
    const combined = preview.files.map((f) => f.content).join('\n') + preview.summaryText
    expect(combined).toContain('0.13.2')
    expect(combined).toContain('"kind":"renderer"')
    expect(combined).not.toContain('secret-budget')
    expect(combined).not.toContain('alice@example.com')
    expect(combined).not.toContain('sk-ant-secret')
    expect(combined).not.toContain('C:\\Users')
    expect(combined).not.toContain('unknown-kind')

    const zip = buildDiagnosticsZip(preview)
    // Standard PKZIP local file header signature
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.toString('utf8')).toContain('app-info.json')
    expect(zip.toString('utf8')).toContain('crash-summary.jsonl')
  })

  it('has native translations for all 22 languages', () => {
    const en = diagnosticsUiText('en', 'exportDiagnosticsBtn')
    for (const lang of LANGS) {
      const text = diagnosticsUiText(lang, 'exportDiagnosticsBtn')
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(en)
    }
  })
})
