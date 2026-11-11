// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { recognizeHelperPng } from '../src/main/ocr-helper-async'

let dir: string
let helper: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ieum-ocr-async-'))
  helper = join(dir, 'helper.cjs')
  await writeFile(
    helper,
    `const fs=require('node:fs'),path=require('node:path');
const chunks=[];process.stdin.on('data',c=>chunks.push(c));
process.stdin.on('end',()=>{
 const lock=path.join(__dirname,'active.lock');
 const descriptor=fs.openSync(lock,'wx');
 fs.writeFileSync(path.join(__dirname,'started-'+process.pid),String(process.pid));
 setTimeout(()=>{
  fs.closeSync(descriptor);fs.unlinkSync(lock);
  process.stdout.write('\\ufeff'+JSON.stringify({lines:[{t:Buffer.concat(chunks).toString(),c:0.9,b:[0.1,0.2,0.8,0.9],chars:[{t:'x',b:[0.1,0.2,0.2,0.3]}]}],paper:0.95}));
 },200);
});`,
  )
})
afterAll(async () => {
  const target = resolve(dir)
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('ieum-ocr-async-'))
    throw new Error('Unexpected scratch directory')
  await rm(target, { recursive: true, force: true })
})

describe('asynchronous system OCR helper', () => {
  it('keeps timers responsive, serializes helpers and preserves the shared output protocol', async () => {
    let ticks = 0
    const timer = setInterval(() => ticks++, 10)
    try {
      const results = await Promise.all(
        ['first', 'second', 'third'].map((text) =>
          recognizeHelperPng(process.execPath, Buffer.from(text), undefined, [helper]),
        ),
      )
      expect(ticks).toBeGreaterThan(10)
      expect(results.map((r) => r?.lines[0]?.text)).toEqual(['first', 'second', 'third'])
      expect(results[0]).toEqual({
        lines: [
          {
            text: 'first',
            confidence: 0.9,
            box: { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.9 },
            chars: [{ text: 'x', box: { x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.3 } }],
          },
        ],
        paperShare: 0.95,
      })
    } finally {
      clearInterval(timer)
    }
  })

  it('drops an aborted queued call without starting a helper', async () => {
    const before = (await readdir(dir)).filter((name) => name.startsWith('started-')).length
    const first = recognizeHelperPng(process.execPath, Buffer.from('held'), undefined, [helper])
    const controller = new AbortController()
    const cancelled = recognizeHelperPng(
      process.execPath,
      Buffer.from('cancelled'),
      controller.signal,
      [helper],
    )
    controller.abort()
    expect(await cancelled).toBeNull()
    expect((await first)?.lines[0].text).toBe('held')
    const after = (await readdir(dir)).filter((name) => name.startsWith('started-')).length
    expect(after - before).toBe(1)
  })

  it('waits for an aborted helper to close and releases its slot', async () => {
    const script = join(dir, 'slow.cjs')
    const marker = join(dir, 'slow-pid')
    await writeFile(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setTimeout(()=>{},20000);`,
    )
    const controller = new AbortController()
    const pending = recognizeHelperPng(process.execPath, new Uint8Array(), controller.signal, [
      script,
    ])
    await expect
      .poll(async () => Number(await readFile(marker, 'utf8').catch(() => '0')))
      .toBeGreaterThan(0)
    const pid = Number(await readFile(marker, 'utf8'))
    controller.abort()
    expect(await pending).toBeNull()
    expect(() => process.kill(pid, 0)).toThrow()
    expect(
      (await recognizeHelperPng(process.execPath, Buffer.from('next'), undefined, [helper]))
        ?.lines[0].text,
    ).toBe('next')
  })

  it('returns no recognition for a failed executable or malformed helper response', async () => {
    expect(await recognizeHelperPng(join(dir, 'missing.exe'), new Uint8Array())).toBeNull()
    const bad = join(dir, 'bad.cjs')
    await writeFile(bad, "process.stdout.write('not JSON')")
    expect(
      await recognizeHelperPng(process.execPath, new Uint8Array(), undefined, [bad]),
    ).toBeNull()
  })
})
