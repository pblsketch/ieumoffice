import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deflateRawSync } from 'node:zlib'
import { assets, assetsEqual } from './assets.mjs'

const require = createRequire(import.meta.url)
const CFB = require('cfb')
const JSZip = require('jszip')

function hwpImages(entries, compressed) {
  const container = CFB.utils.cfb_new()
  for (const [name, content] of Object.entries(entries))
    CFB.utils.cfb_add(
      container,
      'BinData/' + name,
      compressed ? deflateRawSync(Buffer.from(content)) : Buffer.from(content),
    )
  return CFB.write(container, { type: 'buffer' })
}
async function hwpxImages(entries) {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) zip.file('BinData/' + name, content)
  return zip.generateAsync({ type: 'uint8array' })
}

test('compares HWP BinData content across container compression changes', async () => {
  const entries = { 'BIN0001.png': 'first picture', 'BIN0002.png': 'second picture' }
  const plain = await assets(hwpImages(entries, false), 'hwp')
  const compressed = await assets(hwpImages(entries, true), 'hwp')
  assert.equal(Object.keys(plain).length, 2)
  assert.equal(assetsEqual(plain, compressed), true)
})
for (const format of ['hwp', 'hwpx']) {
  test(`${format} rejects deleted, modified or swapped image identities`, async () => {
    const encode = format === 'hwp' ? (entries) => hwpImages(entries, true) : hwpxImages
    const original = { 'BIN0001.png': 'first', 'BIN0002.png': 'second' }
    const before = await assets(await encode(original), format)
    for (const changed of [
      { 'BIN0001.png': 'first' },
      { 'BIN0001.png': 'altered', 'BIN0002.png': 'second' },
      { 'BIN0001.png': 'second', 'BIN0002.png': 'first' },
    ])
      assert.equal(assetsEqual(before, await assets(await encode(changed), format)), false)
  })
}
