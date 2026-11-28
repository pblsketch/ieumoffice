// @vitest-environment node
/**
 * The package runs in the PC main process and in the phone's webview, so its
 * source must not reach Node, Electron, the network, or the apps it is shared
 * by. This test reads every file under src/ and fails on:
 * - imports of `node:*`, Node built-in modules or `electron`;
 * - imports of an app package (`@genoffice/pdf`, `@genoffice/shell` ...) and
 *   relative imports that leave this package (`../../apps/...`);
 * - a dynamic import or require whose target is not a plain string;
 * - the Node globals `Buffer`, `process`, `require`, `__dirname`,
 *   `__filename` and the network APIs `fetch`, `XMLHttpRequest`, `WebSocket`,
 *   also when reached through `globalThis`, `window`, `self` or `global`.
 * Comments, string contents and regular expression literals are blanked
 * before the identifier checks, so a comment about `Buffer` is fine.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const SRC_DIR = join(PACKAGE_DIR, 'src')
const APPS_DIR = join(PACKAGE_DIR, '..', '..', 'apps')

const NODE_BUILTINS = new Set([
  'fs',
  'path',
  'crypto',
  'zlib',
  'buffer',
  'os',
  'module',
  'process',
  'url',
  'child_process',
  'worker_threads',
])

const FORBIDDEN_GLOBALS = [
  'Buffer',
  'process',
  'require',
  '__dirname',
  '__filename',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
]

const GLOBAL_OBJECTS = ['globalThis', 'window', 'self', 'global']

/** Package names of everything under apps/ (an app is never a dependency of this package) */
function appPackageNames(): Set<string> {
  const names = new Set<string>()
  for (const entry of readdirSync(APPS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const pkg = JSON.parse(readFileSync(join(APPS_DIR, entry.name, 'package.json'), 'utf8')) as {
        name?: string
      }
      if (pkg.name) names.add(pkg.name)
    } catch {
      // a folder without a package.json is not a package
    }
  }
  return names
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out.sort()
}

interface Scanned {
  /** the source with comments, string contents and regex bodies replaced by spaces (same length) */
  code: string
  /** string literal contents keyed by the index of their opening quote; null: a template with `${}` */
  strings: Map<number, string | null>
}

const REGEX_BEFORE = new Set([...'(,=:[!&|?{};+-*%<>~^'])
const REGEX_AFTER_WORD =
  /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|instanceof|new|throw)$/

/** Blank comments, strings and regex literals, keeping every other character in place */
function scanSource(src: string): Scanned {
  const out = src.split('')
  const strings = new Map<number, string | null>()
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  /** open `${` frames: how many `{` are open inside each */
  const templates: number[] = []
  let lastSignificant = -1

  // reads template text from `i` (just after a backtick or a closing `}`) to the next `${` or
  // backtick; a template with a `${}` is recorded as null (its text is not a plain string)
  const readTemplate = (i: number, opener: number): number => {
    let j = i
    let text = ''
    while (j < src.length) {
      const c = src[j]
      if (c === '\\') {
        text += src.slice(j, j + 2)
        j += 2
        continue
      }
      if (c === '`') {
        blank(i, j)
        if (opener >= 0 && !strings.has(opener)) strings.set(opener, text)
        return j + 1
      }
      if (c === '$' && src[j + 1] === '{') {
        blank(i, j)
        if (opener >= 0) strings.set(opener, null)
        templates.push(0)
        return j + 2
      }
      text += c
      j++
    }
    blank(i, j)
    return j
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      let j = i
      while (j < src.length && src[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const j = end < 0 ? src.length : end + 2
      blank(i, j)
      i = j
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      let text = ''
      while (j < src.length && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') {
          text += src.slice(j, j + 2)
          j += 2
          continue
        }
        text += src[j]
        j++
      }
      strings.set(i, text)
      blank(i + 1, j)
      lastSignificant = j
      i = j + 1
      continue
    }
    if (c === '`') {
      i = readTemplate(i + 1, i)
      lastSignificant = i - 1
      continue
    }
    if (templates.length > 0 && (c === '{' || c === '}')) {
      const top = templates.length - 1
      if (c === '{') templates[top]!++
      else if (templates[top] === 0) {
        templates.pop()
        i = readTemplate(i + 1, -1)
        lastSignificant = i - 1
        continue
      } else templates[top]!--
    }
    if (c === '/') {
      const before = lastSignificant < 0 ? '' : src[lastSignificant]!
      const word = src.slice(Math.max(0, lastSignificant - 11), lastSignificant + 1)
      if (lastSignificant < 0 || REGEX_BEFORE.has(before) || REGEX_AFTER_WORD.test(word)) {
        let j = i + 1
        let inClass = false
        while (j < src.length && src[j] !== '\n') {
          const r = src[j]
          if (r === '\\') {
            j += 2
            continue
          }
          if (r === '[') inClass = true
          else if (r === ']') inClass = false
          else if (r === '/' && !inClass) break
          j++
        }
        blank(i + 1, j)
        j++
        while (j < src.length && /[a-z]/i.test(src[j]!)) j++
        lastSignificant = j - 1
        i = j
        continue
      }
    }
    if (!/\s/.test(c)) lastSignificant = i
    i++
  }
  return { code: out.join(''), strings }
}

function lineOf(src: string, index: number): number {
  let line = 1
  for (let k = 0; k < index && k < src.length; k++) if (src[k] === '\n') line++
  return line
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*(?=['"`])/g,
  /\bimport\s*\(\s*(?=['"`])/g,
  /\bimport\s+(?=['"`])/g,
  /\brequire\s*\(\s*(?=['"`])/g,
]

/** Every rule this package keeps, as "line: problem" strings for one file */
function problemsIn(
  src: string,
  file: string,
  packageDir: string,
  appPackages: ReadonlySet<string>,
): string[] {
  const { code, strings } = scanSource(src)
  const problems: string[] = []
  const report = (index: number, what: string) => problems.push(`${lineOf(src, index)}: ${what}`)

  const checkSpecifier = (index: number, spec: string) => {
    const base = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!
    if (spec.startsWith('node:')) report(index, `imports the Node module "${spec}"`)
    else if (NODE_BUILTINS.has(base)) report(index, `imports the Node module "${spec}"`)
    else if (base === 'electron') report(index, `imports "${spec}"`)
    else if (appPackages.has(base)) report(index, `imports the app package "${spec}"`)
    else if (isAbsolute(spec) || /^[A-Za-z]:/.test(spec))
      report(index, `imports the path "${spec}"`)
    else if (spec.startsWith('.')) {
      const target = resolve(dirname(file), spec)
      const inside = relative(packageDir, target)
      if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
        report(index, `imports "${spec}" from outside the package`)
      }
    }
  }

  for (const pattern of SPECIFIER_PATTERNS) {
    for (const m of code.matchAll(pattern)) {
      const quote = m.index + m[0].length
      const spec = strings.get(quote)
      if (spec === undefined || spec === null) report(quote, 'imports a computed module name')
      else checkSpecifier(quote, spec)
    }
  }
  // a dynamic import whose target is not a plain string cannot be checked
  for (const m of code.matchAll(/\bimport\s*\(\s*(?![\s'"`])/g)) {
    report(m.index, 'imports a computed module name')
  }

  const names = FORBIDDEN_GLOBALS.join('|')
  for (const m of code.matchAll(new RegExp(`(?<![\\w$.])(?:${names})(?![\\w$])`, 'g'))) {
    report(m.index, `uses "${m[0]}"`)
  }
  const holders = GLOBAL_OBJECTS.join('|')
  for (const m of code.matchAll(
    new RegExp(`(?<![\\w$.])(?:${holders})\\s*\\??\\.\\s*(${names})(?![\\w$])`, 'g'),
  )) {
    report(m.index, `uses "${m[1]}" through a global object`)
  }
  for (const m of code.matchAll(
    new RegExp(`(?<![\\w$.])(?:${holders})\\s*(?:\\?\\.)?\\[\\s*`, 'g'),
  )) {
    const quote = m.index + m[0].length
    const key = strings.get(quote)
    if (key === null || (key !== undefined && FORBIDDEN_GLOBALS.includes(key))) {
      report(m.index, `uses "${key ?? 'a computed name'}" through a global object`)
    }
  }
  // in source order (sort is stable, so one line keeps the order the checks ran in)
  return problems.sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
}

describe('the scan itself', () => {
  const apps = new Set(['@genoffice/pdf', '@genoffice/shell'])
  const file = join(SRC_DIR, 'probe.ts')
  const check = (src: string) => problemsIn(src, file, PACKAGE_DIR, apps)

  it('passes plain package code, comments and strings that only mention the names', () => {
    expect(
      check(
        [
          "import { PDFDocument } from 'pdf-lib'",
          "import { readImageInfo } from './images'",
          "export * from './split'",
          '// Buffer, process.env, fetch() and require are fine in a comment',
          '/* import { join } from "node:path" */',
          'const label = "process the pages with fetch and Buffer"',
          'const re = /\\/\\/ Buffer [\'"]/g',
          'const t = `a ${label} fetch`',
          'const n = options.process ?? doc.fetch',
          'const enc = new TextEncoder()',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('finds Node, Electron, app and outside imports', () => {
    expect(
      check(
        [
          "import { join } from 'node:path'",
          'import fs from "fs"',
          "import { readFile } from 'fs/promises'",
          "import { app } from 'electron'",
          "import { x } from '@genoffice/pdf'",
          "import { y } from '../../../apps/pdf/src/main/save-pdf'",
          "export { z } from '../tests/helper'",
          "const m = await import('zlib')",
          "import 'process'",
          'const w = await import(`node:${name}`)',
          'const v = await import(name)',
        ].join('\n'),
      ),
    ).toEqual([
      '1: imports the Node module "node:path"',
      '2: imports the Node module "fs"',
      '3: imports the Node module "fs/promises"',
      '4: imports "electron"',
      '5: imports the app package "@genoffice/pdf"',
      '6: imports "../../../apps/pdf/src/main/save-pdf" from outside the package',
      '8: imports the Node module "zlib"',
      '9: imports the Node module "process"',
      '10: imports a computed module name',
      '11: imports a computed module name',
    ])
  })

  it('finds the Node globals and the network APIs, also through a global object', () => {
    expect(
      check(
        [
          "const b = Buffer.from('x')",
          'const env = process.env',
          "const r = require('pdf-lib')",
          'const d = __dirname + __filename',
          "await fetch('https://example.com')",
          'new XMLHttpRequest()',
          "new WebSocket('ws://x')",
          'globalThis.fetch(u)',
          "window['WebSocket']",
          'const re = /x/; const again = Buffer.alloc(1)',
          'const t = `${process.pid}`',
        ].join('\n'),
      ),
    ).toEqual([
      '1: uses "Buffer"',
      '2: uses "process"',
      '3: uses "require"',
      '4: uses "__dirname"',
      '4: uses "__filename"',
      '5: uses "fetch"',
      '6: uses "XMLHttpRequest"',
      '7: uses "WebSocket"',
      '8: uses "fetch" through a global object',
      '9: uses "WebSocket" through a global object',
      '10: uses "Buffer"',
      '11: uses "process"',
    ])
  })
})

describe('packages/pdf-ops/src', () => {
  const files = sourceFiles(SRC_DIR)
  const apps = appPackageNames()

  it('has every module of the public surface to scan', () => {
    const names = files.map((f) => relative(SRC_DIR, f).replace(/\\/g, '/'))
    for (const module of [
      'index.ts',
      'tools.ts',
      'rules.ts',
      'split.ts',
      'page-range.ts',
      'images.ts',
      'print-prep.ts',
      'overlay.ts',
      'annot-strip.ts',
      'compress.ts',
      'blank-pages.ts',
      'repair.ts',
      'qpdf.ts',
      'pdfium.ts',
      'mirror-pages.ts',
      'mirror-text.ts',
    ]) {
      expect(names).toContain(module)
    }
    expect(apps.has('@genoffice/pdf')).toBe(true)
  })

  it.each(files.map((f) => [relative(SRC_DIR, f).replace(/\\/g, '/'), f]))(
    '%s uses no Node, Electron, network or app code',
    (_name, file) => {
      expect(problemsIn(readFileSync(file, 'utf8'), file, PACKAGE_DIR, apps)).toEqual([])
    },
  )
})
