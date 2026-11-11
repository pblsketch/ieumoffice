import { createRequire } from 'node:module'
import { inflateRawSync } from 'node:zlib'
import { hash } from './runtime.mjs'

const require = createRequire(import.meta.url)
const CFB = require('cfb')
const JSZip = require('jszip')
const maxAsset = 64 * 1024 * 1024

// Check BinData names AND decoded bytes: a multiset alone misses swapped pictures.
// Like the upstream inspector, this is preservation evidence, not format certification.
export async function assets(bytes, format) {
  const result = {}
  if (format === 'hwp') {
    const archive = CFB.read(Buffer.from(bytes), { type: 'buffer' })
    for (let index = 0; index < archive.FullPaths.length; index++) {
      const match = archive.FullPaths[index].match(/\/(BinData\/[^/]+)$/i)
      const entry = archive.FileIndex[index]
      if (!match || entry.type !== 2) continue
      let content = Buffer.from(entry.content)
      if (content.length > maxAsset) throw Error('ASSET_BUDGET_EXCEEDED')
      try {
        content = inflateRawSync(content, { maxOutputLength: maxAsset })
      } catch (error) {
        if (error.code === 'ERR_BUFFER_TOO_LARGE')
          throw Error('ASSET_BUDGET_EXCEEDED', { cause: error })
        // A BinData entry may already be uncompressed.
      }
      result[match[1]] = hash(content)
    }
  } else {
    const archive = await JSZip.loadAsync(bytes)
    for (const [name, entry] of Object.entries(archive.files)) {
      if (entry.dir || !/^BinData\//i.test(name)) continue
      if (entry._data?.uncompressedSize > maxAsset) throw Error('ASSET_BUDGET_EXCEEDED')
      const content = await entry.async('uint8array')
      if (content.length > maxAsset) throw Error('ASSET_BUDGET_EXCEEDED')
      result[name] = hash(content)
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))
}

export const assetsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
