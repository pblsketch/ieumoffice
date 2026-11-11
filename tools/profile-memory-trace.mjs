/** Capture native allocator attribution after timed measurements, never during them. */
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function captureMemoryTrace(page, output) {
  const session = await page.context().newCDPSession(page)
  let tracing = false
  let stream
  let timer
  let onComplete
  const completion = new Promise((done, reject) => {
    onComplete = done
    session.once('Tracing.tracingComplete', onComplete)
    timer = setTimeout(() => {
      reject(new Error('Native memory trace timed out'))
      // Also interrupt a pending dump or stream read after tracingComplete.
      void session.detach().catch(() => {})
    }, 30000)
  })
  // A rejected completion must stay handled even if starting the trace fails.
  void completion.catch(() => {})
  try {
    await session.send('Tracing.start', {
      categories: '-*,disabled-by-default-memory-infra',
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
    })
    tracing = true
    const dump = await session.send('Tracing.requestMemoryDump', {
      deterministic: false,
      levelOfDetail: 'detailed',
    })
    await session.send('Tracing.end')
    tracing = false
    const completed = await completion
    stream = completed.stream
    if (!stream) throw new Error('Native memory trace returned no stream')
    const file = await open(resolve(output), 'wx')
    let bytes = 0
    try {
      for (;;) {
        const chunk = await session.send('IO.read', { handle: stream, size: 1024 * 1024 })
        const data = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8')
        bytes += data.length
        if (bytes > 128 * 1024 * 1024) throw new Error('Native memory trace exceeded 128 MiB')
        await file.writeFile(data)
        if (chunk.eof) break
      }
    } finally {
      await file.close()
    }
    return { path: resolve(output), bytes, dump, dataLossOccurred: completed.dataLossOccurred }
  } finally {
    clearTimeout(timer)
    session.removeListener('Tracing.tracingComplete', onComplete)
    if (tracing) await session.send('Tracing.end').catch(() => {})
    if (stream) await session.send('IO.close', { handle: stream }).catch(() => {})
    await session.detach().catch(() => {})
  }
}
