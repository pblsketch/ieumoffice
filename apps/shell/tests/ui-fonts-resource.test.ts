// The bundled UI font ships once into resources/ui-fonts, is never copied into
// individual editor build outputs, and every renderer HTML page allows
// genoffice-app: in its font-src CSP.
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { UI_FONTS_DIR_NAME, UI_FONTS_REPO_DIR } from '@genoffice/electron-utils/ui-fonts-dir'
import { UI_FONT_SCHEME } from '@genoffice/ui/ui-fonts'

const require = createRequire(import.meta.url)
const SHELL = resolve(import.meta.dirname, '..')
const ROOT = resolve(SHELL, '../..')

interface Resource {
  from: string
  to: string
  filter?: string[]
}

function loadBuilderConfig(platform: string) {
  const configModule = { exports: {} as ReturnType<typeof require> }
  runInNewContext(readFileSync(join(SHELL, 'electron-builder.cjs'), 'utf8'), {
    module: configModule,
    __dirname: SHELL,
    process: { platform, arch: 'x64', env: {} },
    require: (id: string) =>
      id === 'node:fs' ? { ...require(id), existsSync: () => true } : require(id),
  })
  return configModule.exports as {
    extraResources: Resource[]
    mac: { extraResources: Resource[] }
    win: { extraResources: Resource[] }
    linux: { extraResources: Resource[] }
  }
}

describe('UI fonts in the installer', () => {
  it('ships the ui-fonts folder exactly once, whole, into resources', () => {
    const config = loadBuilderConfig('win32')
    const all = [
      ...config.extraResources,
      ...config.mac.extraResources,
      ...config.win.extraResources,
      ...config.linux.extraResources,
    ]
    const entries = all.filter((r) => r.to === UI_FONTS_DIR_NAME || r.from.includes('ui-fonts'))
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(config.extraResources).toContain(entry)
    expect(entry!.to).toBe(UI_FONTS_DIR_NAME)
    expect(entry!.filter).toBeUndefined()
    expect(resolve(SHELL, entry!.from)).toBe(resolve(ROOT, UI_FONTS_REPO_DIR))
  })

  it('is never imported as a build asset by an editor', () => {
    const assetRef =
      /(?:from\s+|import\s*\(\s*|new URL\(\s*|url\(\s*)['"]?(?![a-z][a-z0-9+.-]*:)[^'"()\s]*ui-fonts\/[^'"()\s]+\.(?:woff2?|ttf|otf)/i
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') walk(path)
        } else if (/\.(ts|tsx|css|html)$/.test(e.name)) {
          if (assetRef.test(readFileSync(path, 'utf8'))) {
            offenders.push(path)
          }
        }
      }
    }
    for (const app of readdirSync(join(ROOT, 'apps'))) {
      const src = join(ROOT, 'apps', app, 'src')
      try {
        walk(src)
      } catch {
        // an app without a src folder imports nothing
      }
    }
    expect(offenders).toEqual([])
  }, 60_000)

  it('allows the UI font scheme in font-src CSP of every renderer HTML entry', () => {
    const htmlFiles: string[] = []
    for (const app of readdirSync(join(ROOT, 'apps'))) {
      // mobile runs in Capacitor rather than Electron's genoffice-app: protocol
      if (app === 'mobile') continue
      const rendererDir = join(ROOT, 'apps', app, 'src', 'renderer')
      try {
        for (const e of readdirSync(rendererDir, { withFileTypes: true })) {
          if (e.isFile() && e.name.endsWith('.html')) {
            htmlFiles.push(join(rendererDir, e.name))
          }
        }
      } catch {
        // skip apps without a renderer folder
      }
    }
    expect(htmlFiles.length).toBeGreaterThan(0)
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf8')
      const fontSrc = /font-src\s+([^;"]+)/.exec(html)?.[1] ?? ''
      expect(fontSrc.split(/\s+/), file).toContain(`${UI_FONT_SCHEME}:`)
    }
  })
})
