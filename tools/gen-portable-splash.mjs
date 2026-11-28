#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'posid', 'posid_signature.png')
const output = join(root, 'apps', 'shell', 'build', 'portable-splash.bmp')
const png = PNG.sync.read(readFileSync(source))
const rowBytes = Math.ceil((png.width * 3) / 4) * 4
const pixelBytes = rowBytes * png.height
const bmp = Buffer.alloc(54 + pixelBytes)

bmp.write('BM', 0)
bmp.writeUInt32LE(bmp.length, 2)
bmp.writeUInt32LE(54, 10)
bmp.writeUInt32LE(40, 14)
bmp.writeInt32LE(png.width, 18)
bmp.writeInt32LE(png.height, 22)
bmp.writeUInt16LE(1, 26)
bmp.writeUInt16LE(24, 28)
bmp.writeUInt32LE(pixelBytes, 34)

for (let y = 0; y < png.height; y += 1) {
  const sourceY = png.height - 1 - y
  const rowStart = 54 + y * rowBytes
  for (let x = 0; x < png.width; x += 1) {
    const sourceIndex = (sourceY * png.width + x) * 4
    const targetIndex = rowStart + x * 3
    const alpha = png.data[sourceIndex + 3] / 255
    for (let channel = 0; channel < 3; channel += 1) {
      bmp[targetIndex + (2 - channel)] = Math.round(
        png.data[sourceIndex + channel] * alpha + 255 * (1 - alpha),
      )
    }
  }
}

writeFileSync(output, bmp)
console.log(`written: ${output}`)
