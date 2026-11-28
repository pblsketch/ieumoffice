import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiSettings } from '@genoffice/ai-provider'
import { launchShell, closeAndSaveVideo, screenshotPath, stubAiReady } from './helpers'

test('Ollama servers register models through real IPC and survive reopening settings', async () => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'qwen3:8b' }, { id: 'llama3.2:3b' }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const base = `http://127.0.0.1:${address.port}`
  const launched = await test.step('Launch the built shell', () =>
    launchShell({
      onboardingSeen: true,
      lang: 'ko',
      videoDir: 'settings-ollama',
    }))
  const { page, userDataDir } = launched
  try {
    await stubAiReady(launched.app)
    const readSettings = async (): Promise<AiSettings> =>
      JSON.parse(await readFile(join(userDataDir, 'ai-settings.json'), 'utf8'))
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page
      .locator('.set-nav-item')
      .filter({ hasText: /^Ollama$/ })
      .click()
    await expect(page.getByRole('article', { name: '로컬 Ollama', exact: true })).toBeVisible()
    await expect(page.locator('.ollama-url')).toHaveText('http://localhost:11434/v1')
    for (const [name, path] of [
      ['작업 PC', '/local/v1'],
      ['연구실 서버', '/lab/v1'],
    ]) {
      if (path === '/local/v1') {
        await page.getByRole('button', { name: '로컬 Ollama', exact: true }).click()
      } else {
        await page.getByRole('button', { name: '+ 서버 추가', exact: true }).click()
      }
      const form = page.locator('.ollama-form')
      await form.getByLabel('서버 이름', { exact: true }).fill(name!)
      await form.getByLabel('Base URL', { exact: true }).fill(`${base}${path}`)
      await form
        .getByRole('button', {
          name: path === '/local/v1' ? '저장' : '서버 추가',
          exact: true,
        })
        .click()
      const card = page.getByRole('article', { name: name!, exact: true })
      const model = card.locator('.ollama-models li').filter({ hasText: 'qwen3:8b' })
      await model.getByRole('button', { name: '등록', exact: true }).click()
      await expect(model.getByRole('button', { name: '등록됨', exact: true })).toBeDisabled()
    }
    await expect.poll(async () => (await readSettings()).customEndpoints?.length).toBe(2)
    expect((await readSettings()).provider).toBe('auto')
    // each listed model is also asked about its image input (Ollama's /api/show)
    expect(requests.filter((url) => url !== '/api/show')).toEqual([
      '/local/v1/models',
      '/lab/v1/models',
    ])
    expect(requests).toContain('/api/show')
    await page.screenshot({ path: screenshotPath('settings-ollama-ko') })
    await page.locator('.set-nav-item').filter({ hasText: /^AI$/ }).click()
    await page.getByRole('button', { name: '사용할 AI', exact: true }).click()
    // Ollama rows show the model and its effort; the second server's comes second
    await page.getByRole('option', { name: 'Qwen3 8b medium', exact: true }).nth(1).click()
    await expect
      .poll(async () => (await readSettings()).providers.custom.baseUrl)
      .toBe(`${base}/lab/v1`)
    await page
      .locator('.set-nav-item')
      .filter({ hasText: /^Ollama$/ })
      .click()
    const card = page.getByRole('article', { name: '연구실 서버', exact: true })
    await card.getByRole('button', { name: '연구실 서버', exact: true }).click()
    await card.getByLabel('Base URL', { exact: true }).fill(`${base}/moved/v1`)
    await card.getByRole('button', { name: '저장', exact: true }).click()
    await expect
      .poll(async () => (await readSettings()).providers.custom.baseUrl)
      .toBe(`${base}/moved/v1`)
    await expect.poll(() => requests.includes('/moved/v1/models')).toBe(true)
    await page.locator('.set-close').click()
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page
      .locator('.set-nav-item')
      .filter({ hasText: /^Ollama$/ })
      .click()
    await expect(page.locator('.ollama-card')).toHaveCount(2)
    await expect(
      page.getByRole('article', { name: '연구실 서버', exact: true }).locator('.ollama-url'),
    ).toHaveText(`${base}/moved/v1`)
  } finally {
    await closeAndSaveVideo(launched, 'settings-ollama')
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
