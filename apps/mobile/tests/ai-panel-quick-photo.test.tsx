import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { preloadMobileKeyProviderProtocols } from '@genoffice/mobile-bridge/ai-bridge'
import { translateMobile } from '../src/renderer/i18n'
import { PHOTO_LONG_SIDE_PX } from '../src/renderer/ai/photos'
import { listMobileAiAttachments, mobileAiAttachmentBase64 } from '../src/renderer/ai/tools/state'
import {
  byTestId,
  click,
  keyProvider,
  makeFakeAiRust,
  messageTexts,
  mountAi,
  settle,
  typeAndSend,
  unmountAll,
  waitFor,
} from './ai-panel-fake'

// Quick requests and photos of the AI panel (spec 3.4): the two chips send a
// fixed request in the screen language through the composer's send path, and
// [photo] opens the system picture picker (mocked here: no OS dialog), shrinks
// the picture to a JPEG whose long side is PHOTO_LONG_SIDE_PX, shows it as a
// removable chip and sends it as the next user message's picture. A model that
// cannot see pictures turns the button off with a reason line.

const picker = vi.hoisted(() => ({ next: null as File | null }))

vi.mock('../src/renderer/editors/pickPicture', () => ({
  pickImageFile: async () => picker.next,
}))

const drawn: Array<{ width: number; height: number }> = []

beforeAll(async () => {
  await preloadMobileKeyProviderProtocols()
}, 60_000)

beforeEach(() => {
  drawn.length = 0
  picker.next = null
  vi.stubGlobal('createImageBitmap', async (file: File) => {
    if (file.type === 'image/broken') throw new Error('cannot decode')
    return { width: 4096, height: 1024, close: () => {} }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: () => {} }) as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    drawn.push({ width: this.width, height: this.height })
    callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: type ?? 'image/png' }))
  })
})

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const lastUserContent = (body: string): unknown => {
  const messages = (JSON.parse(body) as { messages: Array<{ role: string; content: unknown }> })
    .messages
  return messages.filter((m) => m.role === 'user').at(-1)?.content
}

describe('the quick requests', () => {
  it('sends the plain-words request in the screen language', async () => {
    const rust = makeFakeAiRust({})
    await mountAi(rust, { lang: 'ko' })
    await click(byTestId('ai-quick-easy'))
    await waitFor(() => rust.relayStarts.length === 1)
    expect(JSON.stringify(lastUserContent(rust.relayStarts[0]!.body))).toContain(
      '쉬운 글이 필요한 사람도 알 수 있게 한국어로',
    )
    expect(messageTexts()[0]).toBe(translateMobile('ko', 'aiQuickEasyPrompt'))
  })

  it('sends the translate request in the screen language', async () => {
    const rust = makeFakeAiRust({})
    await mountAi(rust, { lang: 'en' })
    expect(byTestId('ai-quick-translate')?.textContent).toBe('Translate')
    await click(byTestId('ai-quick-translate'))
    await waitFor(() => rust.relayStarts.length === 1)
    expect(JSON.stringify(lastUserContent(rust.relayStarts[0]!.body))).toContain('into English')
  })

  it('goes into the queue while a run is going', async () => {
    const rust = makeFakeAiRust({ relay: () => 'hang' })
    await mountAi(rust)
    await typeAndSend('running')
    await waitFor(() => rust.relayStarts.length === 1)
    await click(byTestId('ai-quick-translate'))
    expect(byTestId('ai-queue-strip')?.textContent).toContain('한국어로 번역해 주세요')
    expect(rust.relayStarts).toHaveLength(1)
  })
})

describe('photos', () => {
  it('shrinks a picked photo, shows it as a chip and sends it with the next message', async () => {
    const rust = makeFakeAiRust({})
    await mountAi(rust)
    picker.next = new File([new Uint8Array([1, 2, 3])], 'board.png', { type: 'image/png' })
    await click(byTestId('ai-photo-btn'))
    await waitFor(() => byTestId('ai-photo-chip') !== null)
    expect(drawn).toEqual([{ width: PHOTO_LONG_SIDE_PX, height: 512 }])
    expect(byTestId('ai-photo-chip')!.querySelector('img')?.getAttribute('src')).toMatch(
      /^data:image\/jpeg;base64,/,
    )

    await typeAndSend('what is on the board?')
    await waitFor(() => rust.relayStarts.length === 1)
    const content = JSON.stringify(lastUserContent(rust.relayStarts[0]!.body))
    expect(content).toContain('data:image/jpeg;base64,/9j/2Q==')
    expect(byTestId('ai-photo-chip')).toBeNull()
    expect(listMobileAiAttachments().map((a) => [a.name, a.mime])).toEqual([
      ['board.png', 'image/jpeg'],
    ])
    // the conversation keeps the base64 the message sent, its bytes read on demand
    const [kept] = listMobileAiAttachments()
    expect(mobileAiAttachmentBase64(kept!)).toBe('/9j/2Q==')
    expect(kept!.bytes).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
  })

  it('takes a chip away before sending', async () => {
    const rust = makeFakeAiRust({})
    await mountAi(rust)
    picker.next = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })
    await click(byTestId('ai-photo-btn'))
    await waitFor(() => byTestId('ai-photo-chip') !== null)
    await click(byTestId('ai-photo-chip')!.querySelector('button'))
    expect(byTestId('ai-photo-chip')).toBeNull()
    await typeAndSend('no photo')
    await waitFor(() => rust.relayStarts.length === 1)
    expect(rust.relayStarts[0]!.body).not.toContain('data:image')
  })

  it('does not attach a file that is not a readable picture', async () => {
    const rust = makeFakeAiRust({})
    await mountAi(rust)
    picker.next = new File(['text'], 'notes.txt', { type: 'text/plain' })
    await click(byTestId('ai-photo-btn'))
    await waitFor(() => byTestId('ai-photo-error') !== null)
    expect(byTestId('ai-photo-chip')).toBeNull()
    expect(byTestId('ai-photo-error')!.getAttribute('role')).toBe('alert')

    picker.next = new File([new Uint8Array([1])], 'x.heic', { type: 'image/broken' })
    await click(byTestId('ai-photo-btn'))
    await settle()
    expect(byTestId('ai-photo-chip')).toBeNull()
    expect(byTestId('ai-photo-error')).not.toBeNull()
  })

  it('turns the photo button off with a reason when the model cannot see pictures', async () => {
    const rust = makeFakeAiRust({ snapshot: keyProvider('deepseek', 'deepseek-v4-flash') })
    await mountAi(rust)
    const button = byTestId<HTMLButtonElement>('ai-photo-btn')!
    expect(button.disabled).toBe(true)
    expect(byTestId('ai-photo-no-vision')?.textContent).toBe(
      translateMobile('ko', 'aiPhotoNoVision'),
    )
    await act(async () => button.click())
    expect(byTestId('ai-photo-chip')).toBeNull()
  })
})
