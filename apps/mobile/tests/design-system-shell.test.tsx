import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileLocaleProvider } from '../src/renderer/i18n'
import { createBackStack } from '../src/renderer/shell/backStack'
import { EditorShell, type EditorShellProps } from '../src/renderer/shell/EditorShell'
import {
  TOAST_ACTION_MS,
  TOAST_MS,
  ToastHost,
  type ToastRequest,
} from '../src/renderer/components/Toast'

const containers: HTMLElement[] = []

function render(node: React.ReactNode): {
  el: HTMLElement
  rerender: (n: React.ReactNode) => void
} {
  const el = document.createElement('div')
  document.body.appendChild(el)
  containers.push(el)
  const root = createRoot(el)
  const wrap = (n: React.ReactNode) => <MobileLocaleProvider lang="ko">{n}</MobileLocaleProvider>
  act(() => root.render(wrap(node)))
  return { el, rerender: (n) => act(() => root.render(wrap(n))) }
}

afterEach(() => {
  vi.useRealTimers()
  while (containers.length > 0) containers.pop()?.remove()
})

function systemBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
}

describe('back stack', () => {
  it('runs the top layer first and keeps a layer whose owner did not close it', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const stack = createBackStack(window)
    const calls: string[] = []
    const screen = stack.push(() => calls.push('screen'))
    const sheet = stack.push(() => calls.push('sheet'))

    systemBack()
    expect(calls).toEqual(['sheet'])
    // the sheet's owner closes it: its entry is consumed without running anything
    stack.remove(sheet)
    expect(backSpy).toHaveBeenCalledTimes(1)
    systemBack() // the ignored pop that remove() caused
    expect(calls).toEqual(['sheet'])

    // the screen's owner asks first and the user cancels: the layer stays armed
    systemBack()
    systemBack()
    expect(calls).toEqual(['sheet', 'screen', 'screen'])
    expect(stack.depth()).toBe(1)
    stack.remove(screen)
    expect(stack.depth()).toBe(0)
    backSpy.mockRestore()
  })
})

describe('toast', () => {
  it('auto-dismisses plain toasts after 4s and action toasts after 8s', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const plain: ToastRequest & { key: number } = { message: '저장했습니다.', key: 1 }
    const { rerender } = render(<ToastHost toast={plain} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(TOAST_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    const withAction = {
      message: '지웠습니다.',
      key: 2,
      action: { label: '되돌리기', onPress: vi.fn() },
    }
    rerender(<ToastHost toast={withAction} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(TOAST_MS))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(TOAST_ACTION_MS - TOAST_MS))
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })

  it('runs the action and closes', () => {
    const onPress = vi.fn()
    const onDismiss = vi.fn()
    const { el } = render(
      <ToastHost
        toast={{ message: '지웠습니다.', key: 1, action: { label: '되돌리기', onPress } }}
        onDismiss={onDismiss}
      />,
    )
    const btn = el.querySelector<HTMLButtonElement>('.mobile-toast-action')
    act(() => btn?.click())
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

function shellProps(overrides: Partial<EditorShellProps>): EditorShellProps {
  return {
    docTitle: '회의 메모.md',
    docFormat: 'md',
    saveState: 'saved',
    mode: 'view',
    canEdit: true,
    aiEnabled: false,
    quickActions: [
      { id: 'undo', label: '실행취소', onPress: () => {} },
      { id: 'redo', label: '다시실행', onPress: () => {} },
      { id: 'bold', label: '굵게', onPress: () => {} },
    ],
    aiPanelContent: null,
    onBack: () => {},
    onEnterEdit: () => {},
    onDone: () => {},
    onExitEdit: () => {},
    onSave: () => {},
    onSaveAs: () => {},
    onShare: () => {},
    onFitToWidth: () => {},
    onOpenBackups: () => {},
    children: <div>body</div>,
    ...overrides,
  }
}

describe('editor app bar', () => {
  it('view mode: Share and [편집] are visible, no save state when saved', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    const onEnterEdit = vi.fn()
    const { el } = render(<EditorShell {...shellProps({ onEnterEdit })} />)
    expect(el.querySelector('[data-testid="editor-share-btn"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="editor-save-btn"]')).toBeNull()
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="editor-mode-toggle"]')
    expect(toggle?.textContent).toContain('편집')
    act(() => toggle?.click())
    expect(onEnterEdit).toHaveBeenCalledTimes(1)
  })

  it('edit mode: undo/redo move to the bar, save state shows and saves, [완료] finishes', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    const onSave = vi.fn()
    const onDone = vi.fn()
    const { el } = render(
      <EditorShell {...shellProps({ mode: 'edit', saveState: 'dirty', onSave, onDone })} />,
    )
    const header = el.querySelector('[data-testid="editor-header"]')
    expect(header?.querySelector('[aria-label="실행취소"]')).not.toBeNull()
    expect(header?.querySelector('[aria-label="다시실행"]')).not.toBeNull()
    const toolbar = el.querySelector('[data-testid="phone-quick-toolbar"]')
    expect(toolbar?.querySelector('[aria-label="실행취소"]')).toBeNull()
    expect(toolbar?.querySelector('[aria-label="굵게"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="editor-share-btn"]')).toBeNull()

    const state = el.querySelector<HTMLButtonElement>('[data-testid="editor-save-btn"]')
    expect(state?.textContent).toContain('저장 안 됨')
    act(() => state?.click())
    expect(onSave).toHaveBeenCalledTimes(1)

    const done = el.querySelector<HTMLButtonElement>('[data-testid="editor-mode-toggle"]')
    expect(done?.textContent).toContain('완료')
    act(() => done?.click())
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows no AI entry point at all when AI is off', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    const { el } = render(<EditorShell {...shellProps({ mode: 'edit', aiEnabled: false })} />)
    expect(el.querySelector('[data-testid="phone-ai-open-btn"]')).toBeNull()
    expect(el.querySelector('[data-testid="phone-view-ai-btn"]')).toBeNull()
    expect(el.querySelector('[data-testid="tablet-ai-toggle"]')).toBeNull()
  })
})
