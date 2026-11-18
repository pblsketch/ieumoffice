import { expect, test } from '@playwright/test'
import { LANGS } from '@genoffice/i18n'
import { strings } from '../../src/renderer/i18n/strings'
import { openSource } from './helpers'

test('list and insert menus invoke the original editor commands', async ({ page }) => {
  await openSource(page, false, false, '# Topic\n\nBody\n')
  await page.locator('.doc-editor p').click()

  const list = page.getByRole('button', { name: 'List', exact: true })
  await list.focus()
  await list.press('ArrowDown')
  const bullets = page.getByRole('menuitemcheckbox', { name: 'Bullet list' })
  const numbers = page.getByRole('menuitemcheckbox', { name: 'Numbered list' })
  await expect(bullets).toBeFocused()
  await bullets.press('ArrowDown')
  await expect(numbers).toBeFocused()
  await numbers.press('Enter')
  await expect(page.locator('.doc-editor ol')).toContainText('Body')
  await list.click()
  await expect(numbers).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(list).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('menuitem', { name: 'Insert table' }).click()
  await expect(page.locator('.doc-editor table')).toBeVisible()
})

test('the View menu reports toggles and restores focus when a submenu closes', async ({ page }) => {
  await openSource(page, false)
  const view = page.getByRole('button', { name: 'View', exact: true })
  const outline = page.getByRole('menuitemcheckbox', { name: 'Outline', exact: true })
  const theme = page.getByRole('menuitem', { name: 'Document theme' })

  await view.click()
  await expect(outline).toHaveAttribute('aria-checked', 'false')
  await outline.click()
  await view.focus()
  await view.press('Enter')
  await expect(outline).toHaveAttribute('aria-checked', 'true')
  await theme.focus()
  await theme.press('Enter')
  const themes = page.getByRole('menu', { name: 'Document theme' })
  await expect(themes.getByRole('menuitemradio')).toHaveCount(7)
  await expect(themes.getByRole('menuitemradio').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(themes).toBeHidden()
  await expect(theme).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(view).toBeFocused()
  await expect(view).toHaveAttribute('aria-expanded', 'false')

  await view.click()
  await theme.click()
  await themes.getByRole('menuitemradio', { name: 'Nord' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-markdown-theme', 'nord')
})

test('the ribbon fits at and above the minimum window width in every UI language', async ({
  page,
}) => {
  await openSource(page, false)
  const ribbon = page.locator('.ribbon-body')
  for (const width of [720, 900, 1080, 1280]) {
    await page.setViewportSize({ width, height: 480 })
    for (const lang of LANGS) {
      await page.evaluate(
        (detail) => window.dispatchEvent(new CustomEvent('test:language', { detail })),
        lang,
      )
      const view = page.getByRole('button', { name: strings[lang].ribbonView, exact: true })
      await expect(view).toBeVisible()
      const layout = await ribbon.evaluate((node) => {
        const collapse = node
          .parentElement!.querySelector('.ribbon-collapse-btn')!
          .getBoundingClientRect()
        const overlap = Array.from(node.querySelectorAll('button')).some((button) => {
          const bounds = button.getBoundingClientRect()
          return (
            bounds.right > collapse.left &&
            bounds.left < collapse.right &&
            bounds.bottom > collapse.top &&
            bounds.top < collapse.bottom
          )
        })
        return { overflow: node.scrollWidth - node.clientWidth, overlap }
      })
      expect(layout.overflow, `${lang} at ${width}px`).toBeLessThanOrEqual(1)
      expect(layout.overlap, `${lang} overlaps the collapse button at ${width}px`).toBe(false)
      if (width !== 720) continue
      const hide = page.getByRole('button', { name: strings[lang].ribbonRedact, exact: true })
      await expect(hide).toBeInViewport()
      await view.click()
      const menu = page.getByRole('menu', { name: strings[lang].ribbonView, exact: true })
      await expect(menu).toBeInViewport({ ratio: 1 })
      await page.keyboard.press('Escape')
    }
  }
  await page.locator('.ribbon-collapse-btn').click()
  await expect(ribbon).toBeHidden()
  await page.locator('.ribbon-expand-btn').click()
  await expect(ribbon).toBeVisible()
})
