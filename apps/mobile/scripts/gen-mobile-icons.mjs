#!/usr/bin/env node
/**
 * Generates IeumOffice Mobile Android adaptive & legacy launcher icons and
 * syncs official IeumOffice brand/file SVGs from apps/shell into apps/mobile.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOBILE_DIR = resolve(HERE, '..')
const REPO_ROOT = resolve(MOBILE_DIR, '../..')

const appIconPath = join(REPO_ROOT, 'apps/shell/build/brand/app-icon.svg')
const appIconSvg = readFileSync(appIconPath, 'utf8')
const bgTilePattern = /<rect width="1024" height="1024" rx="230" fill="#4338CA"\/>/

if (!bgTilePattern.test(appIconSvg)) {
  throw new Error('Unexpected apps/shell/build/brand/app-icon.svg background tile markup.')
}

// Adaptive icon foreground: interlocking white ring + amber square on transparent canvas.
const fgSvg = appIconSvg.replace(bgTilePattern, '')
// Legacy circular icon: indigo circle behind the interlocking mark.
const roundSvg = appIconSvg.replace(
  bgTilePattern,
  '<circle cx="512" cy="512" r="512" fill="#4338CA"/>',
)

const toDataUrl = (svg) =>
  `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`

const resDir = join(MOBILE_DIR, 'native-config/android/res')
mkdirSync(join(resDir, 'drawable'), { recursive: true })
mkdirSync(join(resDir, 'mipmap-anydpi-v26'), { recursive: true })

writeFileSync(
  join(resDir, 'drawable/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#4338CA"
        android:pathData="M0,0h108v108h-108z" />
</vector>
`,
  'utf8',
)

const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`
writeFileSync(join(resDir, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptiveXml, 'utf8')
writeFileSync(join(resDir, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptiveXml, 'utf8')

async function launchBrowser() {
  for (const options of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try {
      return await chromium.launch({ ...options, headless: true })
    } catch {
      // Try next browser channel.
    }
  }
  throw new Error('No Chromium-based browser available for icon rasterization.')
}

const browser = await launchBrowser()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const renderPng = async (dataUrl, canvasSize, contentSize) => {
    const b64 = await page.evaluate(
      async ({ dataUrl, canvasSize, contentSize }) => {
        const img = new globalThis.Image()
        img.src = dataUrl
        await img.decode()
        const canvas = globalThis.document.createElement('canvas')
        canvas.width = canvasSize
        canvas.height = canvasSize
        const ctx = canvas.getContext('2d')
        const inset = (canvasSize - contentSize) / 2
        ctx.drawImage(img, inset, inset, contentSize, contentSize)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { dataUrl, canvasSize, contentSize },
    )
    return Buffer.from(b64, 'base64')
  }

  const densities = [
    { dir: 'mipmap-mdpi', legacy: 48, fg: 108 },
    { dir: 'mipmap-hdpi', legacy: 72, fg: 162 },
    { dir: 'mipmap-xhdpi', legacy: 96, fg: 216 },
    { dir: 'mipmap-xxhdpi', legacy: 144, fg: 324 },
    { dir: 'mipmap-xxxhdpi', legacy: 192, fg: 432 },
  ]

  const fullUrl = toDataUrl(appIconSvg)
  const roundUrl = toDataUrl(roundSvg)
  const fgUrl = toDataUrl(fgSvg)

  for (const d of densities) {
    const outDir = join(resDir, d.dir)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'ic_launcher.png'), await renderPng(fullUrl, d.legacy, d.legacy))
    writeFileSync(
      join(outDir, 'ic_launcher_round.png'),
      await renderPng(roundUrl, d.legacy, d.legacy),
    )
    // Scale inside the Android 66/108 adaptive safe zone so circular/squircle masks never clip.
    writeFileSync(
      join(outDir, 'ic_launcher_foreground.png'),
      await renderPng(fgUrl, d.fg, Math.round(d.fg * 0.72)),
    )
  }

  const brandOut = join(MOBILE_DIR, 'src/renderer/assets/brand')
  mkdirSync(brandOut, { recursive: true })
  copyFileSync(appIconPath, join(brandOut, 'app-icon.svg'))
  copyFileSync(
    join(REPO_ROOT, 'apps/shell/src/renderer/src/assets/file-hwp.svg'),
    join(brandOut, 'file-hwp.svg'),
  )
  copyFileSync(
    join(REPO_ROOT, 'apps/shell/src/renderer/src/assets/file-md.svg'),
    join(brandOut, 'file-md.svg'),
  )
  copyFileSync(
    join(REPO_ROOT, 'apps/shell/src/renderer/src/assets/file-txt.svg'),
    join(brandOut, 'file-txt.svg'),
  )
  console.log('Generated IeumOffice Android adaptive icons and synced brand SVGs.')
} finally {
  await browser.close()
}
