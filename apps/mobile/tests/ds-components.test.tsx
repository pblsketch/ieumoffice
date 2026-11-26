// Design system parts (src/renderer/ds): states, accessibility attributes, the icon size
// table against the tokens, and what ds/ may import (docs/plans/mobile-v1/DSN.md).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ActionList,
  Button,
  canShowTip,
  Chip,
  ChoiceGroup,
  DocSkeleton,
  EmptyState,
  FloatingTools,
  Icon,
  ICON_SIZE,
  IconButton,
  iconPx,
  InlineNotice,
  LinearProgress,
  ListRow,
  PageIndicator,
  pickTipBox,
  ScreenHeader,
  SettingsGroup,
  Spinner,
  StickyActions,
  Swatch,
  SwitchRow,
} from '../src/renderer/ds'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const here = dirname(fileURLToPath(import.meta.url))
const dsDir = resolve(here, '../src/renderer/ds')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function draw(node: React.ReactNode): void {
  act(() => root.render(node))
}

const dot = <circle cx="12" cy="12" r="4" />

describe('icon sizes', () => {
  it('maps size names to the table and never takes a number', () => {
    draw(<Icon size="xl">{dot}</Icon>)
    const svg = host.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe(String(ICON_SIZE.xl))
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    draw(<Icon>{dot}</Icon>)
    expect(host.querySelector('svg')?.getAttribute('width')).toBe('20')
    expect(iconPx('s')).toBe(16)
  })

  it('(f) the size table equals the --m-icon-* tokens', () => {
    const css = readFileSync(resolve(here, '../src/renderer/styles/m-tokens.css'), 'utf8')
    for (const name of ['s', 'm', 'l', 'xl'] as const) {
      const m = new RegExp(`--m-icon-${name}:\\s*(\\d+)px`).exec(css)
      expect(m, `--m-icon-${name}`).not.toBeNull()
      expect(Number(m?.[1])).toBe(ICON_SIZE[name])
    }
  })
})

describe('buttons', () => {
  it('draws the shared variants and keeps the label while busy', () => {
    draw(
      <Button variant="primary" busy busyLabel="Working">
        Save
      </Button>,
    )
    const button = host.querySelector('button')
    expect(button?.className).toContain('mobile-btn-primary')
    // busy keeps focus: aria-disabled, not disabled
    expect(button?.disabled).toBe(false)
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    expect(button?.getAttribute('aria-busy')).toBe('true')
    expect(host.querySelector('.ds-btn-label')?.textContent).toBe('Save')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Working')
  })

  it('a danger button speaks its own label and a disabled one cannot be pressed', () => {
    const onClick = vi.fn()
    draw(
      <Button variant="danger" disabled onClick={onClick}>
        Delete
      </Button>,
    )
    const button = host.querySelector('button')
    expect(button?.className).toContain('mobile-btn-danger-text')
    act(() => button?.click())
    expect(onClick).not.toHaveBeenCalled()
  })

  it('an icon button needs a name and shows its toggle state', () => {
    draw(<IconButton label="Bold" icon={<Icon>{dot}</Icon>} pressed />)
    const button = host.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Bold')
    expect(button?.getAttribute('aria-pressed')).toBe('true')
    draw(<IconButton label="Share" icon={<Icon>{dot}</Icon>} />)
    expect(host.querySelector('button')?.hasAttribute('aria-pressed')).toBe(false)
  })

  it('a chip draws the home chip look with its pressed state', () => {
    draw(<Chip selected>All</Chip>)
    const chip = host.querySelector('button')
    expect(chip?.className).toContain('home-frame-chip')
    expect(chip?.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('choices', () => {
  it('is a radio group whose arrow keys move the choice and skip disabled tiles', () => {
    const onChange = vi.fn()
    draw(
      <ChoiceGroup
        label="Line spacing"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
          { value: 'c', label: 'C' },
        ]}
      />,
    )
    expect(host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(
      'Line spacing',
    )
    const radios = host.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(radios[0].className).toContain('mobile-choice-btn')
    expect(radios[0].tabIndex).toBe(0)
    expect(radios[2].tabIndex).toBe(-1)
    act(() => {
      radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith('c')
    act(() => radios[1].click())
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('a swatch is named and pressed, and keeps the document color as its face', () => {
    const onSelect = vi.fn()
    draw(<Swatch label="Black" color="black" selected onSelect={onSelect} />)
    const swatch = host.querySelector('button')
    expect(swatch?.getAttribute('aria-label')).toBe('Black')
    expect(swatch?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector<HTMLElement>('.ds-swatch-face')?.style.background).toBe('black')
    act(() => swatch?.click())
    expect(onSelect).toHaveBeenCalled()
  })
})

describe('rows and groups', () => {
  it('a switch row is a whole-row label around a switch', () => {
    const onChange = vi.fn()
    draw(
      <SwitchRow
        title="Keep screen on"
        hint="While reading"
        checked={false}
        onChange={onChange}
        testId="sw"
      />,
    )
    const row = host.querySelector('label.mobile-set-row')
    const input = host.querySelector<HTMLInputElement>('[data-testid="sw"]')
    expect(row).not.toBeNull()
    expect(input?.type).toBe('checkbox')
    expect(input?.getAttribute('role')).toBe('switch')
    expect(input?.className).toBe('mobile-switch')
    act(() => (row as HTMLLabelElement).click())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('a disabled switch cannot be turned', () => {
    const onChange = vi.fn()
    draw(<SwitchRow title="X" checked={false} onChange={onChange} disabled testId="sw" />)
    act(() => host.querySelector<HTMLInputElement>('[data-testid="sw"]')?.click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a settings group keeps the markup the settings tests read', () => {
    draw(
      <SettingsGroup title="Storage" note="Kept on this device">
        <SwitchRow title="A" checked onChange={() => {}} />
        <SwitchRow title="B" checked={false} onChange={() => {}} />
      </SettingsGroup>,
    )
    expect(host.querySelector('h2.mobile-section-heading')?.textContent).toBe('Storage')
    expect(
      host.querySelector('.mobile-set-card')?.querySelectorAll(':scope > .mobile-set-row'),
    ).toHaveLength(2)
    expect(host.querySelector('.ds-settings-note')?.textContent).toBe('Kept on this device')
  })

  it('a settings list row keeps the settings card markup', () => {
    draw(
      <SettingsGroup title="Help">
        <ListRow title="Open files" variant="settings" onPress={() => {}} />
      </SettingsGroup>,
    )
    expect(
      host.querySelector('.mobile-set-card')?.querySelectorAll(':scope > .mobile-set-row'),
    ).toHaveLength(1)
  })

  it('a busy button ignores presses', () => {
    const onClick = vi.fn()
    draw(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    )
    act(() => host.querySelector('button')?.click())
    expect(onClick).not.toHaveBeenCalled()
  })

  it('list rows take the two heights and mark selected, current and danger', () => {
    const onPress = vi.fn()
    draw(
      <>
        <ListRow title="One" onPress={onPress} selected testId="one" />
        <ListRow title="Two" subtitle="PDF · today" current testId="two" />
        <ListRow title="Delete" danger onPress={() => {}} disabled testId="three" />
      </>,
    )
    const one = host.querySelector('[data-testid="one"]') as HTMLButtonElement
    expect(one.className).toContain('ds-list-row-one')
    expect(one.getAttribute('aria-pressed')).toBe('true')
    act(() => one.click())
    expect(onPress).toHaveBeenCalled()
    const two = host.querySelector('[data-testid="two"]')
    expect(two?.tagName).toBe('DIV')
    expect(two?.className).toContain('ds-list-row-two')
    expect(two?.getAttribute('aria-current')).toBe('true')
    const three = host.querySelector('[data-testid="three"]') as HTMLButtonElement
    expect(three.className).toContain('ds-list-row-danger')
    expect(three.disabled).toBe(true)
  })

  it('(d) an action list draws menu items and never a row without an icon', () => {
    const onSelect = vi.fn()
    draw(
      <ActionList
        items={[
          { id: 'share', label: 'Share', icon: <Icon>{dot}</Icon>, onSelect },
          { id: 'check', label: 'Check', icon: null, onSelect },
          { id: 'del', label: 'Delete', icon: <Icon>{dot}</Icon>, onSelect, danger: true },
        ]}
      />,
    )
    const items = host.querySelectorAll('.mobile-menu-row-btn')
    expect(items).toHaveLength(2)
    expect(host.querySelector('[data-testid="ds-action-check"]')).toBeNull()
    expect(items[0].className).toContain('mobile-menu-row-btn')
    expect(items[1].className).toContain('ds-action-danger')
    act(() => (items[0] as HTMLButtonElement).click())
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('screen parts', () => {
  it('screen header, empty state and sticky actions', () => {
    draw(
      <>
        <ScreenHeader
          title="Tools"
          description="Pick a tool"
          actions={<button type="button">x</button>}
        />
        <EmptyState
          icon={<Icon size="xl">{dot}</Icon>}
          title="No folders"
          body="Link one"
          action={<Button variant="primary">Link</Button>}
          testId="empty"
        />
        <EmptyState icon={<Icon size="xl">{dot}</Icon>} title="Nothing" plain testId="plain" />
        <StickyActions testId="sticky">
          <Button variant="primary" wide>
            Next
          </Button>
        </StickyActions>
      </>,
    )
    expect(host.querySelector('h1.ds-screen-title')?.textContent).toBe('Tools')
    expect(host.querySelector('[data-testid="empty"]')?.className).toBe('mobile-empty-state')
    expect(host.querySelector('[data-testid="empty"] h2')?.textContent).toBe('No folders')
    expect(host.querySelector('[data-testid="plain"]')?.className).toContain('ds-empty-plain')
    expect(host.querySelector('[data-testid="sticky"] .ds-btn-wide')).not.toBeNull()
  })

  it('notice, floating tools and page indicator', () => {
    draw(
      <>
        <InlineNotice
          message="Read only"
          action={<button type="button">Copy</button>}
          tone="warning"
        />
        <FloatingTools label="View tools" dimmed>
          <IconButton label="Fit" icon={<Icon>{dot}</Icon>} round />
        </FloatingTools>
        <PageIndicator text="3 / 12" label="Page 3 of 12" />
      </>,
    )
    expect(host.querySelector('.ds-inline-notice')?.getAttribute('role')).toBe('status')
    const tools = host.querySelector('[role="toolbar"]')
    expect(tools?.getAttribute('aria-label')).toBe('View tools')
    expect(tools?.className).toContain('ds-floating-dimmed')
    expect(host.querySelector('.ds-icon-btn-round')).not.toBeNull()
    expect(host.querySelector('.ds-page-indicator-text')?.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.ds-page-indicator .mobile-sr-only')?.textContent).toBe(
      'Page 3 of 12',
    )
  })
})

describe('progress', () => {
  it('spinner and document placeholder wait 300 ms before showing', () => {
    vi.useFakeTimers()
    draw(
      <>
        <Spinner label="Loading" />
        <DocSkeleton label="Opening" active />
      </>,
    )
    expect(host.querySelector('[data-testid="ds-spinner"]')).toBeNull()
    expect(host.querySelector('[data-testid="ds-doc-skeleton"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(host.querySelector('[data-testid="ds-spinner"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(host.querySelector('[data-testid="ds-spinner"]')?.getAttribute('role')).toBe(
      'progressbar',
    )
    expect(host.querySelector('[data-testid="ds-doc-skeleton"]')?.getAttribute('role')).toBe(
      'status',
    )
    draw(<DocSkeleton label="Opening" active={false} />)
    expect(host.querySelector('[data-testid="ds-doc-skeleton"]')).toBeNull()
  })

  it('a progress bar reports a known amount and flows when unknown', () => {
    draw(<LinearProgress label="Merging" value={0.42} />)
    const bar = host.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('42')
    draw(<LinearProgress label="Merging" />)
    const flowing = host.querySelector('[role="progressbar"]')
    expect(flowing?.className).toContain('ds-progress-flowing')
    expect(flowing?.hasAttribute('aria-valuenow')).toBe(false)
  })
})

describe('tips', () => {
  const calm = {
    sheetOpen: false,
    dialogOpen: false,
    aiPanelOpen: false,
    keyboardOpen: false,
    tipShowing: false,
  }

  it('shows only when nothing else is open', () => {
    expect(canShowTip(calm)).toBe(true)
    for (const key of Object.keys(calm) as Array<keyof typeof calm>) {
      expect(canShowTip({ ...calm, [key]: true }), key).toBe(false)
    }
  })

  it('picks the first place that covers no bar, input or main button', () => {
    const bar = { left: 0, top: 780, right: 390, bottom: 844 }
    const below = { left: 100, top: 790, right: 300, bottom: 830 }
    const above = { left: 100, top: 700, right: 300, bottom: 770 }
    expect(pickTipBox([below, above], [bar])).toEqual(above)
    expect(pickTipBox([below], [bar])).toBeNull()
  })
})

describe('ds stylesheet and imports', () => {
  it('ds.css only styles ds-* classes and handles reduced motion and wrapping', () => {
    const css = readFileSync(join(dsDir, 'ds.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = [...css.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter((s) => s && !/^(from|to|\d+%)$/.test(s) && !s.startsWith('@'))
    for (const selector of selectors) {
      for (const part of selector.split(',')) {
        const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1])
        const own = classes.filter((c) => c.startsWith('ds-'))
        expect(own.length, `selector "${part.trim()}" must target a ds-* class`).toBeGreaterThan(0)
      }
    }
    expect(css).toContain('prefers-reduced-motion')
    expect(css).toMatch(/\.ds-choice-group-row\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(css).toMatch(/\.ds-sticky-actions\s*\{[^}]*flex-wrap:\s*wrap/)
  })

  it('(g) ds/ imports only React, its own files and the icon frame', () => {
    const allowed = [/^react(\/|$)/, /^\.\/[\w.-]+$/, /^\.\.\/components\/icons\/svgIcon$/]
    for (const name of readdirSync(dsDir)) {
      if (!/\.(ts|tsx)$/.test(name)) continue
      const source = readFileSync(join(dsDir, name), 'utf8')
      for (const m of source.matchAll(
        /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g,
      )) {
        const spec = m[1] ?? m[2]
        expect(
          allowed.some((re) => re.test(spec)),
          `${name} imports ${spec}`,
        ).toBe(true)
      }
    }
  })
})
