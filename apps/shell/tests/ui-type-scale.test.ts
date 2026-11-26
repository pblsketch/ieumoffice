/**
 * The shell's and the shared UI's stylesheets keep to whole-pixel font sizes
 * and one radius scale (docs/standards.md, "화면 글자 크기, 모서리, 대비").
 * Half-pixel sizes and one-off radii (5px, 7px, 9px …) had crept in from many
 * hands and made neighbouring parts look subtly unaligned.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../../..')
const ROOTS = ['apps/shell/src/renderer', 'packages/ui/src'].map((r) => join(REPO, r))
const RADII = new Set([0, 2, 4, 6, 8, 10, 12, 16, 999])
/** the app icon keeps its own corner ratio (13.5 of 60), not a UI radius */
const RADIUS_EXCEPTIONS = ['onboarding.css']

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return name.endsWith('.css') ? [path] : []
  })
}

const files = ROOTS.flatMap(cssFiles)

function offenders(re: RegExp, ok: (value: string) => boolean): string[] {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => {
        const m = re.exec(line)
        return m && !ok(m[1]!) ? [`${relative(REPO, file)}:${i + 1}: ${line.trim()}`] : []
      }),
  )
}

describe('UI type and radius scale', () => {
  it('finds the stylesheets', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('uses whole-pixel font sizes', () => {
    expect(offenders(/font-size:\s*([\d.]+)px/, (v) => Number.isInteger(Number(v)))).toEqual([])
  })

  it('uses radii from the scale', () => {
    // single-value radii only; per-corner shorthands are shaped on purpose
    const found = offenders(/border-radius:\s*([\d.]+)px;/, (v) => RADII.has(Number(v)))
    expect(
      found.filter((l) => !(RADIUS_EXCEPTIONS.some((f) => l.includes(f)) && l.endsWith('13.5px;'))),
    ).toEqual([])
  })
})
