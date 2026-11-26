// Design system guard (docs/plans/mobile-v1/DSN.md, "guard test"). Scans the mobile
// renderer sources for the rules that keep every track on the same tokens:
//   (a) line icons take a size name, never a literal number
//   (b) z-index and box-shadow come from tokens (rings without blur are allowed)
//   (c) selected-state rules only use the selected/current/primary tokens
// Files that broke a rule before the design system existed are listed one by one in
// ALLOWED below, so any new file (for example a later track's screens) is checked from
// its first line. The back phase of the design system work empties these lists.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const renderer = resolve(here, '../src/renderer')

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, ext, out)
    else if (path.endsWith(ext)) out.push(path)
  }
  return out
}

const rel = (path: string): string => relative(renderer, path).split('\\').join('/')

// Picture icons draw a file-type or product picture at its own size, not a line icon.
const PICTURE_ICONS = new Set(['DocTypeIcon', 'IeumAppIcon'])

/** (a) Literal numeric `size` on a JSX element that is not a picture icon. */
export function literalIconSizes(source: string): string[] {
  const found: string[] = []
  const re = /\bsize=(?:\{\s*(\d+(?:\.\d+)?)\s*\}|"(\d+(?:\.\d+)?)")/g
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const before = source.slice(0, m.index)
    const open = before.lastIndexOf('<')
    const tag = /^<([A-Za-z][\w.]*)/.exec(before.slice(open))?.[1] ?? '?'
    if (PICTURE_ICONS.has(tag)) continue
    found.push(`${tag} size=${m[1] ?? m[2]}`)
  }
  return found
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

interface CssRule {
  readonly selector: string
  readonly decls: ReadonlyArray<readonly [string, string]>
}

/** Innermost rules only (an @media wrapper's own text is not a selector). */
export function cssRules(css: string): CssRule[] {
  const rules: CssRule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  const text = stripComments(css)
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const decls: Array<readonly [string, string]> = []
    for (const part of m[2].split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      const prop = part.slice(0, colon).trim().toLowerCase()
      if (!prop || prop.startsWith('--')) continue
      decls.push([prop, part.slice(colon + 1).trim()])
    }
    rules.push({ selector: m[1].trim(), decls })
  }
  return rules
}

const Z_KEYWORDS = new Set(['auto', '0', '-1', 'inherit', 'initial', 'unset'])
const RING =
  /^(?:inset\s+)?0\s+0\s+0\s+(?:[\d.]+(?:px|rem|em)|var\(--[\w-]+\))\s+var\(--[\w-]+\)(?:\s+inset)?$/

function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i]
    if (c === '(') depth += 1
    else if (c === ')') depth -= 1
    else if (c === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}

/** (b) Raw z-index numbers and shadows that are neither an elevation token nor a ring. */
export function rawLayering(css: string): string[] {
  const found: string[] = []
  for (const rule of cssRules(css)) {
    for (const [prop, raw] of rule.decls) {
      const value = raw.replace(/\s*!important$/, '')
      if (prop === 'z-index') {
        if (!value.startsWith('var(') && !value.startsWith('calc(var(') && !Z_KEYWORDS.has(value)) {
          found.push(`${rule.selector} z-index: ${value}`)
        }
      } else if (prop === 'box-shadow') {
        if (value === 'none' || value === 'inherit') continue
        const ok = splitTopLevelCommas(value).every(
          (part) => /^var\(--m-elev-\d\)$/.test(part) || RING.test(part),
        )
        if (!ok) found.push(`${rule.selector} box-shadow: ${value}`)
      }
    }
  }
  return found
}

const SELECTED =
  /\[aria-(?:pressed|checked|selected)=['"]?true['"]?\]|\[aria-current|\.is-selected(?![\w-])|\.active(?![\w-])/
const SELECTED_PROPS = new Set([
  'background',
  'background-color',
  'border-color',
  'outline-color',
  'outline',
  'color',
  'box-shadow',
])
const SELECTED_TOKENS = new Set([
  '--m-selected-bg',
  '--m-selected-fg',
  '--m-selected-ring',
  '--m-selected-ring-w',
  '--m-current',
  '--m-primary',
  '--m-on-primary',
  '--m-accent',
])

/** (c) Selected-state rules that paint with anything but the selected/current/primary tokens. */
export function offTokenSelected(css: string): string[] {
  const found: string[] = []
  for (const rule of cssRules(css)) {
    if (!SELECTED.test(rule.selector)) continue
    for (const [prop, value] of rule.decls) {
      if (!SELECTED_PROPS.has(prop)) continue
      const vars = [...value.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])
      const bad = vars.filter((name) => !SELECTED_TOKENS.has(name))
      if (bad.length > 0) found.push(`${rule.selector} ${prop}: ${value}`)
    }
  }
  return found
}

// Files that broke a rule before the design system layer (2026-11-26). Fix a file in
// the back phase and remove it here; never add a new file to these lists.
const ALLOWED: Record<'icons' | 'layering' | 'selected', ReadonlySet<string>> = {
  icons: new Set<string>([
    'ai/CustomServerRow.tsx',
    'ai/ModelPickerSheet.tsx',
    'ai/QueueStrip.tsx',
    'components/AiSheetPanel.tsx',
    'components/HomeScreen.tsx',
    'components/Sheet.tsx',
    'components/Toast.tsx',
    'editors/html/htmlDocument.tsx',
    'editors/markdownFindSheet.tsx',
    'editors/markdownKind.tsx',
    'editors/pdf/edit/usePdfEditChrome.tsx',
    'editors/pdf/features/annot/useAnnotFeature.tsx',
    'editors/pdf/features/draw/DrawSheet.tsx',
    'editors/pdf/features/draw/useDrawFeature.tsx',
    'editors/pdf/features/form/useFormFeature.tsx',
    'editors/pdf/features/pages/PagesSheet.tsx',
    'editors/pdf/features/sign/SignOverlay.tsx',
    'editors/pdf/features/sign/SignatureSheet.tsx',
    'editors/pdf/features/text/TextStyleBar.tsx',
    'editors/pdf/view/PdfPasswordSheet.tsx',
    'editors/pdf/view/PdfSearchBar.tsx',
    'editors/pdf/view/startPdfDocument.tsx',
    'editors/readers/epub/EpubWorkspace.tsx',
    'editors/readers/pptx/PptxShow.tsx',
    'editors/readers/pptx/PptxWorkspace.tsx',
    'home/actions/HomeFileRow.tsx',
    'home/actions/HomeGroupSheet.tsx',
    'home/actions/HomeSelection.tsx',
    'home/folders/FolderBrowser.tsx',
    'home/folders/FoldersView.tsx',
    'home/frame/HomeCards.tsx',
    'home/frame/HomeChips.tsx',
    'home/frame/HomeCreateSheet.tsx',
    'home/frame/HomeEmpty.tsx',
    'home/frame/HomeTabBar.tsx',
    'home/layer/ReadOnlyStrip.tsx',
    'home/layer/ReceiveScreen.tsx',
    'settings/SettingsScreen.tsx',
    'settings/sections/AiSection.tsx',
    'settings/sections/GeneralSection.tsx',
    'settings/sections/HelpSection.tsx',
    'settings/sections/HomeKindsRows.tsx',
    'shell/EditorShell.tsx',
    'tools/ToolsList.tsx',
    'tools/flow/FilesStep.tsx',
    'tools/flow/Flow.tsx',
    'tools/flow/ResultSheet.tsx',
  ]),
  layering: new Set<string>([
    'editors/pdf/features/annot/annot.css',
    'editors/pdf/features/draw/draw.css',
    'editors/pdf/features/form/form.css',
    'editors/pdf/features/link/link.css',
    'editors/pdf/features/pages/pages.css',
    'editors/pdf/features/sign/sign.css',
    'editors/pdf/features/text/text.css',
    'editors/pdf/view/pdfView.css',
    'editors/readers/pptx/pptxOpening.css',
    'editors/readers/pptx/pptxReader.css',
    'home/frame/homeFrame.css',
    'home/layer/layer.css',
    'shell/editors.css',
    'shell/shell.css',
    'styles/m-ai.css',
    'styles/m-home.css',
    'styles/m-settings.css',
    'styles/m-sheet.css',
    'tools/pdfTools.css',
  ]),
  selected: new Set<string>([
    'ai/aiPanelParts.css',
    'editors/pdf/features/annot/annot.css',
    'editors/pdf/features/draw/draw.css',
    'editors/pdf/features/form/form.css',
    'editors/pdf/features/sign/sign.css',
    'editors/pdf/features/text/text.css',
    'editors/readers/epub/epubReader.css',
    'home/frame/homeFrame.css',
    'shell/appbar.css',
    'shell/hwp-sheets.css',
    'styles/m-home.css',
  ]),
}

function violations(
  files: readonly string[],
  check: (source: string) => string[],
  allowed: ReadonlySet<string>,
): string[] {
  const out: string[] = []
  for (const file of files) {
    const name = rel(file)
    if (allowed.has(name)) continue
    for (const hit of check(readFileSync(file, 'utf8'))) out.push(`${name}: ${hit}`)
  }
  return out
}

const tsxFiles = walk(renderer, '.tsx').filter((f) => !rel(f).startsWith('ds/'))
const cssFiles = walk(renderer, '.css').filter((f) => !rel(f).startsWith('assets/fonts/'))

describe('design system guard', () => {
  it('(a) line icons use a size name, not a literal number', () => {
    expect(violations(tsxFiles, literalIconSizes, ALLOWED.icons)).toEqual([])
  })

  it('(b) z-index and shadows come from tokens', () => {
    expect(violations(cssFiles, rawLayering, ALLOWED.layering)).toEqual([])
  })

  it('(c) selected states use the selected, current or primary tokens', () => {
    expect(violations(cssFiles, offTokenSelected, ALLOWED.selected)).toEqual([])
  })

  it('every allowed file still exists', () => {
    const names = new Set([...tsxFiles, ...cssFiles].map(rel))
    const missing = [...ALLOWED.icons, ...ALLOWED.layering, ...ALLOWED.selected].filter(
      (n) => !names.has(n),
    )
    expect(missing).toEqual([])
  })
})

describe('guard rules themselves', () => {
  it('(a) flags literal sizes but not expressions or picture icons', () => {
    expect(literalIconSizes('<SvgIcon size={20} />')).toEqual(['SvgIcon size=20'])
    expect(literalIconSizes('<Icon\n  name="x"\n  size="18"\n/>')).toEqual(['Icon size=18'])
    expect(literalIconSizes('<Icon size={size} /><Icon size={box.h * 0.9} />')).toEqual([])
    expect(literalIconSizes('<DocTypeIcon format="pdf" size={26} />')).toEqual([])
  })

  it('(b) allows tokens, rings and stacking keywords', () => {
    const css = `
      .a { z-index: var(--m-z-sheet); box-shadow: var(--m-elev-1); }
      .b { z-index: calc(var(--m-z-modal) + 1); box-shadow: inset 0 0 0 2px var(--x), 0 0 0 1px var(--y); }
      .c { z-index: -1; box-shadow: 0 0 0 2px var(--surface) inset; }
      .d { --shadow: 0 2px 4px red; }`
    expect(rawLayering(css)).toEqual([])
    expect(rawLayering('.e { z-index: 4 }')).toEqual(['.e z-index: 4'])
    expect(rawLayering('.f { box-shadow: var(--shadow-sm) }')).toEqual([
      '.f box-shadow: var(--shadow-sm)',
    ])
    expect(rawLayering('@media (x) { .g { box-shadow: 0 1px 2px var(--x) } }')).toEqual([
      '.g box-shadow: 0 1px 2px var(--x)',
    ])
  })

  it('(c) checks only selected-state rules', () => {
    expect(
      offTokenSelected(".a[aria-pressed='true'] { background: var(--m-selected-bg) }"),
    ).toEqual([])
    expect(offTokenSelected(".a[aria-pressed='true'] { background: var(--active-bg) }")).toEqual([
      ".a[aria-pressed='true'] background: var(--active-bg)",
    ])
    expect(offTokenSelected('.a:checked { background: var(--active-bg) }')).toEqual([])
    expect(offTokenSelected('.tab.active-x { color: var(--text) }')).toEqual([])
    expect(offTokenSelected('.tab.active { color: var(--text) }')).toEqual([
      '.tab.active color: var(--text)',
    ])
  })
})
