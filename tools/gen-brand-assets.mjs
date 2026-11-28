/**
 * Regenerates every file derived from the IeumOffice brand sources in
 * apps/shell/build/brand/:
 *
 *   app-icon.svg        -> app / installer icons (png, ico, icns, Linux size
 *                          set) and the in-app app-icon.png copies
 *   app-icon-small.svg  -> the same icon redrawn bolder for slots of 32 px and
 *                          below (optional: without it app-icon.svg is used)
 *   logo-lockup.svg     -> the shell sidebar logo (copied verbatim)
 *
 * To rebrand, replace those SVGs and run:
 *   node tools/gen-brand-assets.mjs
 *
 * Optional: `--preview <file.png>` also writes a contact sheet (icon at
 * 16/32/48/256 px on light and dark backgrounds, the lockup and the AI mark)
 * for a quick visual check. The sheet is not part of the repo.
 *
 * The SVG is rasterized with the system Chrome (or Edge) through
 * playwright-core, the same approach as tools/gen-file-association-icons.mjs.
 * The ICO and ICNS containers are written by hand, so the script runs on any
 * host OS and needs no dependency beyond the root devDependencies.
 *
 * Not generated here: packages/ui/src/AiMark.tsx is a hand-written React
 * component that mirrors apps/shell/build/brand/ai-mark.svg.
 */

/* global Image, document -- used inside page.evaluate callbacks, which run in the browser */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const brandDir = join(root, 'apps/shell/build/brand')
const posidDir = join(root, 'posid')
const ICON_SVG = join(brandDir, 'app-icon.svg')
const ICON_SMALL_SVG = join(brandDir, 'app-icon-small.svg')
// Largest canvas (px) that is drawn from the small optical size.
const SMALL_ICON_MAX_PX = 32
const LOCKUP_SVG = join(brandDir, 'logo-lockup.svg')
const AI_MARK_SVG = join(brandDir, 'ai-mark.svg')

function decodePng(path) {
  const b = readFileSync(path)
  const w = b.readUInt32BE(16)
  const h = b.readUInt32BE(20)
  const ct = b[25]
  const ch = ct === 6 ? 4 : 3
  let pos = 8
  const idats = []
  while (pos < b.length) {
    const len = b.readUInt32BE(pos)
    const type = b.toString('ascii', pos + 4, pos + 8)
    if (type === 'IDAT') idats.push(b.subarray(pos + 8, pos + 8 + len))
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idats))
  const stride = w * ch + 1
  const pixels = Buffer.alloc(w * h * 4)
  const paeth = (a, b2, c) => {
    const p = a + b2 - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b2)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c
  }
  const prev = Buffer.alloc(w * ch)
  const curr = Buffer.alloc(w * ch)
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride]
    for (let i = 0; i < w * ch; i++) {
      const x = raw[y * stride + 1 + i]
      const a = i >= ch ? curr[i - ch] : 0
      const up = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      curr[i] =
        (x +
          (f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : f === 4 ? paeth(a, up, c) : 0)) &
        0xff
    }
    curr.copy(prev)
    for (let x = 0; x < w; x++) {
      const si = x * ch
      const di = (y * w + x) * 4
      pixels[di] = curr[si]
      pixels[di + 1] = curr[si + 1]
      pixels[di + 2] = curr[si + 2]
      pixels[di + 3] = ch === 4 ? curr[si + 3] : 255
    }
  }
  return { w, h, pixels }
}

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ -1) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}

function encodeRgbaPng(w, h, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    pixels.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function syncPosidBrandSvgs() {
  const logoPath = join(posidDir, 'posid_logo_512.png')
  const enamePath = join(posidDir, 'posid_ename.png')
  if (!existsSync(logoPath) || !existsSync(enamePath)) return

  const logo = decodePng(logoPath)
  for (let i = 0; i < logo.w * logo.h; i++) {
    const r = logo.pixels[i * 4]
    const g = logo.pixels[i * 4 + 1]
    const b = logo.pixels[i * 4 + 2]
    const a = logo.pixels[i * 4 + 3]
    if (a === 0) continue
    if (r > 245 && g > 245 && b > 245) {
      logo.pixels[i * 4 + 3] = 0
    } else if (b > 80 && r >= g && g >= b) {
      const whiteFrac = Math.min(1, Math.max(0, (b - 40) / (255 - 40)))
      const newA = Math.round(a * (1 - whiteFrac))
      if (newA <= 5) {
        logo.pixels[i * 4 + 3] = 0
      } else {
        const inv = 1 / (1 - whiteFrac)
        logo.pixels[i * 4] = Math.max(0, Math.min(255, Math.round(255 - (255 - r) * inv)))
        logo.pixels[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(255 - (255 - g) * inv)))
        logo.pixels[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(255 - (255 - b) * inv)))
        logo.pixels[i * 4 + 3] = newA
      }
    }
  }
  const logoB64 = encodeRgbaPng(logo.w, logo.h, logo.pixels).toString('base64')

  const ename = decodePng(enamePath)
  for (let i = 0; i < ename.w * ename.h; i++) {
    const r = ename.pixels[i * 4]
    const g = ename.pixels[i * 4 + 1]
    const b = ename.pixels[i * 4 + 2]
    if (r >= 250 && g >= 250 && b >= 250) {
      ename.pixels[i * 4 + 3] = 0
      continue
    }
    const isOrange = r - b > 25
    if (isOrange) {
      const whiteFrac = Math.min(0.98, Math.max(0, (b - 20) / (255 - 20)))
      const alpha = 1 - whiteFrac
      ename.pixels[i * 4] = Math.max(0, Math.min(255, Math.round((r - 255 * whiteFrac) / alpha)))
      ename.pixels[i * 4 + 1] = Math.max(
        0,
        Math.min(255, Math.round((g - 255 * whiteFrac) / alpha)),
      )
      ename.pixels[i * 4 + 2] = Math.max(
        0,
        Math.min(255, Math.round((b - 255 * whiteFrac) / alpha)),
      )
      ename.pixels[i * 4 + 3] = Math.round(alpha * 255)
    } else {
      const lum = (r + g + b) / 3
      const fgLum = 110.67
      const alpha = Math.min(1, Math.max(0, (255 - lum) / (255 - fgLum)))
      if (alpha < 0.02) {
        ename.pixels[i * 4 + 3] = 0
      } else {
        ename.pixels[i * 4] = 109
        ename.pixels[i * 4 + 1] = 110
        ename.pixels[i * 4 + 2] = 113
        ename.pixels[i * 4 + 3] = Math.round(alpha * 255)
      }
    }
  }
  const enameB64 = encodeRgbaPng(ename.w, ename.h, ename.pixels).toString('base64')

  const appIconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  PosidOffice app icon (source of truth).
  Derived from posid/posid_logo_512.png.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <image x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logoB64}"/>
</svg>
`
  writeFileSync(ICON_SVG, appIconSvg)
  writeFileSync(ICON_SMALL_SVG, appIconSvg)

  const lockupSvg = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  PosidOffice logo lockup (source of truth for the in-app sidebar logo).
  Combines posid/posid_logo_512.png, posid/posid_ename.png, and the "Office" wordmark.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="1175" height="240" viewBox="0 0 1175 240" fill="none">
  <image x="6" y="6" width="228" height="228" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logoB64}"/>
  <image x="242" y="27.2" width="488.7" height="152.3" preserveAspectRatio="none" href="data:image/png;base64,${enameB64}"/>
  <g fill="#6D6E71" transform="translate(82, 0)">
    <path d="M765.3 123.4Q765.3 139.4 759.6 151.4Q754 163.4 743.5 170Q733 176.5 719.4 176.5Q706 176.5 695.4 170Q684.9 163.6 679.1 151.6Q673.3 139.6 673.3 124V118.7Q673.3 102.7 679 90.6Q684.8 78.4 695.3 71.9Q705.8 65.5 719.3 65.5Q732.8 65.5 743.3 71.9Q753.8 78.4 759.5 90.6Q765.3 102.7 765.3 118.6ZM742.7 118.5Q742.7 101.5 736.6 92.7Q730.5 83.9 719.3 83.9Q708.1 83.9 702 92.6Q695.9 101.3 695.8 118.1V123.4Q695.8 140 701.9 149.1Q708 158.2 719.4 158.2Q730.6 158.2 736.6 149.4Q742.6 140.6 742.7 123.8Z"/>
    <path d="M785.9 175V110.4H774V94.7H785.9V87.9Q785.9 74.4 793.7 66.9Q801.4 59.4 815.4 59.4Q819.8 59.4 826.3 60.9L826.1 77.6Q823.4 76.9 819.5 76.9Q807.4 76.9 807.4 88.2V94.7H823.4V110.4H807.4V175Z"/>
    <path d="M840.4 175V110.4H828.4V94.7H840.4V87.9Q840.4 74.4 848.1 66.9Q855.9 59.4 869.9 59.4Q874.3 59.4 880.8 60.9L880.5 77.6Q877.9 76.9 874 76.9Q861.9 76.9 861.9 88.2V94.7H877.9V110.4H861.9V175Z"/>
    <path d="M911.6 175H890.1V94.7H911.6ZM888.9 73.9Q888.9 69.1 892.1 66Q895.3 62.9 900.9 62.9Q906.4 62.9 909.6 66Q912.9 69.1 912.9 73.9Q912.9 78.8 909.6 81.9Q906.3 85 900.9 85Q895.5 85 892.2 81.9Q888.9 78.8 888.9 73.9Z"/>
    <path d="M962.7 159.2Q968.6 159.2 972.4 155.9Q976.1 152.7 976.2 147.2H996.3Q996.3 155.4 991.9 162.2Q987.5 169 979.9 172.7Q972.3 176.5 963.1 176.5Q945.9 176.5 935.9 165.5Q926 154.6 926 135.3V133.9Q926 115.3 935.8 104.3Q945.7 93.2 962.9 93.2Q978 93.2 987.1 101.8Q996.2 110.4 996.3 124.6H976.2Q976.1 118.4 972.4 114.5Q968.6 110.6 962.6 110.6Q955.1 110.6 951.2 116Q947.4 121.5 947.4 133.7V136Q947.4 148.4 951.2 153.8Q955 159.2 962.7 159.2Z"/>
    <path d="M1045.5 176.5Q1027.9 176.5 1016.8 165.6Q1005.7 154.8 1005.7 136.8V134.7Q1005.7 122.6 1010.4 113.1Q1015 103.5 1023.6 98.4Q1032.2 93.2 1043.2 93.2Q1059.6 93.2 1069.1 103.6Q1078.6 114 1078.6 133.1V141.8H1027.4Q1028.5 149.7 1033.7 154.4Q1038.9 159.2 1046.9 159.2Q1059.3 159.2 1066.3 150.2L1076.9 162Q1072 168.8 1063.8 172.7Q1055.6 176.5 1045.5 176.5ZM1043.1 110.6Q1036.7 110.6 1032.7 114.9Q1028.8 119.2 1027.6 127.2H1057.5V125.5Q1057.3 118.4 1053.6 114.5Q1049.9 110.6 1043.1 110.6Z"/>
  </g>
</svg>
`
  writeFileSync(LOCKUP_SVG, lockupSvg)
}

syncPosidBrandSvgs()

// Full-bleed 1024 px icon: electron-builder's Windows/Linux fallback and the
// image the renderers show in onboarding / update / about surfaces.
const FULL_BLEED_PNG_TARGETS = [
  'apps/shell/build/icon.png',
  'apps/docs/build/icon.png',
  'apps/shell/src/renderer/src/assets/app-icon.png',
  'apps/docs/src/renderer/assets/app-icon.png',
  'apps/sheets/src/renderer/assets/app-icon.png',
  'apps/slides/src/renderer/assets/app-icon.png',
]
const MAC_PNG_TARGETS = ['apps/shell/build/icon-mac.png', 'apps/docs/build/icon-mac.png']
const ICO_TARGETS = ['apps/shell/build/icon.ico', 'apps/docs/build/icon.ico']
const ICNS_TARGETS = ['apps/shell/build/icon.icns', 'apps/docs/build/icon.icns']
// freedesktop hicolor size set (electron-builder linux.icon points at this dir).
const LINUX_ICON_DIR = 'apps/shell/build/icons'
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
const LOCKUP_TARGET = 'apps/shell/src/renderer/src/assets/genoffice-logo.svg'

const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256]

// macOS icons carry the standard app-icon grid margin (824/1024 content) so
// they sit at the same optical size as neighboring icons in the Dock/Finder.
// Windows and Linux icons are conventionally full-bleed.
const MAC_CONTENT_RATIO = 824 / 1024
// ICNS entries in the order iconutil writes them: [OSType, canvas px, format].
// The two smallest slots must be packed ARGB; the rest are embedded PNGs.
const ICNS_ENTRIES = [
  ['ic12', 64, 'png'],
  ['ic07', 128, 'png'],
  ['ic13', 256, 'png'],
  ['ic08', 256, 'png'],
  ['ic04', 16, 'argb'],
  ['ic14', 512, 'png'],
  ['ic09', 512, 'png'],
  ['ic05', 32, 'argb'],
  ['ic10', 1024, 'png'],
  ['ic11', 32, 'png'],
]

/** ICO container with PNG-compressed entries (supported since Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o) // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2) // palette
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

/**
 * ICNS run-length coding for one 8-bit channel: a control byte below 128
 * copies the next (n + 1) literal bytes, a control byte of 128 or more repeats
 * the next byte (n - 125) times (runs of 3..130).
 */
function packIcnsChannel(channel) {
  const out = []
  const runLength = (from) => {
    let n = 1
    while (from + n < channel.length && n < 130 && channel[from + n] === channel[from]) n++
    return n
  }
  let i = 0
  while (i < channel.length) {
    const run = runLength(i)
    if (run >= 3) {
      out.push(run + 125, channel[i])
      i += run
      continue
    }
    const start = i
    while (i < channel.length && i - start < 128 && runLength(i) < 3) i++
    out.push(i - start - 1, ...channel.subarray(start, i))
  }
  return Buffer.from(out)
}

/** `ARGB` ICNS payload from straight-alpha RGBA pixels (planar A, R, G, B). */
function buildIcnsArgb(rgba) {
  const pixels = rgba.length / 4
  const planes = [3, 0, 1, 2].map((channelOffset) => {
    const plane = Buffer.alloc(pixels)
    for (let p = 0; p < pixels; p++) plane[p] = rgba[p * 4 + channelOffset]
    return packIcnsChannel(plane)
  })
  return Buffer.concat([Buffer.from('ARGB', 'latin1'), ...planes])
}

function buildIcns(chunks) {
  const parts = chunks.map(({ type, data }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'latin1')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 4, 'latin1')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

/** Prefer an installed Chrome, then Edge, then a Playwright-managed Chromium. */
async function launchBrowser() {
  const failures = []
  for (const options of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try {
      return await chromium.launch({ ...options, headless: true })
    } catch (error) {
      failures.push(`${options.channel ?? 'bundled chromium'}: ${String(error).split('\n')[0]}`)
    }
  }
  throw new Error(`No Chromium-based browser could be launched:\n  ${failures.join('\n  ')}`)
}

function svgDataUrl(file) {
  return `data:image/svg+xml;base64,${readFileSync(file).toString('base64')}`
}

/**
 * Draws the SVG centered on a transparent square canvas and returns both the
 * PNG encoding and the raw straight-alpha RGBA pixels (for packed ICNS slots).
 * The browser rasterizes the vector at the target size, so small icons are
 * rendered natively instead of being downsampled from a large bitmap.
 */
async function rasterize(page, dataUrl, canvasSize, contentSize) {
  const result = await page.evaluate(
    async ({ dataUrl, canvasSize, contentSize }) => {
      const image = new Image()
      image.src = dataUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvasSize
      canvas.height = canvasSize
      const context = canvas.getContext('2d')
      const inset = (canvasSize - contentSize) / 2
      context.drawImage(image, inset, inset, contentSize, contentSize)
      const { data } = context.getImageData(0, 0, canvasSize, canvasSize)
      let binary = ''
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
      return { png: canvas.toDataURL('image/png').split(',')[1], rgba: btoa(binary) }
    },
    { dataUrl, canvasSize, contentSize },
  )
  return { png: Buffer.from(result.png, 'base64'), rgba: Buffer.from(result.rgba, 'base64') }
}

function write(relativePath, data) {
  const target = join(root, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, data)
  console.log(`wrote ${relativePath}`)
}

/** Contact sheet for eyeballing the result; never written into the repo by default. */
async function writePreview(page, outFile) {
  const icon = (size) =>
    `data:image/png;base64,${readFileSync(join(root, LINUX_ICON_DIR, `${size}x${size}.png`)).toString('base64')}`
  const lockup = svgDataUrl(LOCKUP_SVG)
  const aiMark = readFileSync(AI_MARK_SVG, 'utf8').replace(/^[\s\S]*?(?=<svg)/, '')
  const row = (background, color, invert) =>
    `<div style="background:${background};color:${color};padding:28px;display:flex;align-items:flex-end;gap:28px">` +
    [256, 48, 32, 16]
      .map((size) => `<img src="${icon(size)}" width="${size}" height="${size}">`)
      .join('') +
    `<img src="${lockup}" height="56" style="margin-left:24px">` +
    [30, 26, 22, 18, 14]
      .map((size) => aiMark.replace('width="24" height="24"', `width="${size}" height="${size}"`))
      .join('') +
    '</div>'
  await page.setViewportSize({ width: 1100, height: 640 })
  await page.setContent(
    `<body style="margin:0">${row('#f3f3f3', '#1f1f1f', 0)}${row('#1e1e1e', '#e8e8e8', 1)}</body>`,
  )
  writeFileSync(outFile, await page.screenshot({ fullPage: true }))
  console.log(`wrote preview ${outFile}`)
}

const previewFlag = process.argv.indexOf('--preview')
const previewFile = previewFlag === -1 ? null : process.argv[previewFlag + 1]
if (previewFlag !== -1 && !previewFile) throw new Error('--preview needs an output file path')

const browser = await launchBrowser()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const icon = svgDataUrl(ICON_SVG)
  const smallIcon = existsSync(ICON_SMALL_SVG) ? svgDataUrl(ICON_SMALL_SVG) : icon
  const iconFor = (size) => (size <= SMALL_ICON_MAX_PX ? smallIcon : icon)

  const fullBleed = new Map()
  for (const size of new Set([...WIN_SIZES, ...LINUX_SIZES])) {
    fullBleed.set(size, await rasterize(page, iconFor(size), size, size))
  }
  const mac = new Map()
  for (const size of new Set(ICNS_ENTRIES.map(([, size]) => size))) {
    const contentSize = Math.round(size * MAC_CONTENT_RATIO)
    mac.set(size, await rasterize(page, iconFor(size), size, contentSize))
  }

  for (const target of FULL_BLEED_PNG_TARGETS) write(target, fullBleed.get(1024).png)
  for (const size of LINUX_SIZES) {
    write(`${LINUX_ICON_DIR}/${size}x${size}.png`, fullBleed.get(size).png)
  }
  const ico = buildIco(WIN_SIZES.map((size) => ({ size, png: fullBleed.get(size).png })))
  for (const target of ICO_TARGETS) write(target, ico)

  for (const target of MAC_PNG_TARGETS) write(target, mac.get(1024).png)
  const icns = buildIcns(
    ICNS_ENTRIES.map(([type, size, format]) => ({
      type,
      data: format === 'argb' ? buildIcnsArgb(mac.get(size).rgba) : mac.get(size).png,
    })),
  )
  for (const target of ICNS_TARGETS) write(target, icns)

  copyFileSync(LOCKUP_SVG, join(root, LOCKUP_TARGET))
  console.log(`wrote ${LOCKUP_TARGET}`)

  if (previewFile) await writePreview(page, resolve(previewFile))
} finally {
  await browser.close()
}
