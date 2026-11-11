import type JSZip from 'jszip'

/** Ordered asynchronous sink, bounded by JSZip's current entry, not the archive. */
export function writeZipChunks(
  zip: JSZip,
  write: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  // Keep streamFiles=false: enabling data descriptors changes the established
  // writer's headers. JSZip buffers one compressed entry with this setting.
  const stream = zip.generateInternalStream({ type: 'uint8array', compression: 'DEFLATE' })
  return new Promise<void>((resolve, reject) => {
    let tail = Promise.resolve()
    let pending = 0
    let ended = false
    let failed = false
    const fail = (error: unknown) => {
      if (failed) return
      failed = true
      // Pinned JSZip has no public cancel method. Erroring its output worker
      // propagates upstream; resume delivers an error queued while paused.
      const worker = (stream as unknown as { _worker: { error(error: unknown): void } })._worker
      worker.error(error)
      stream.resume()
      reject(error)
    }
    stream.on('data', (bytes) => {
      if (failed) return
      stream.pause()
      pending++
      // closedSource flushes the current entry synchronously even when paused.
      // Serialize every emitted chunk and resume only after all have landed.
      tail = tail
        .then(async () => {
          if (!failed) await write(bytes)
          pending--
          if (!pending && !failed) {
            if (ended) resolve()
            else stream.resume()
          }
        })
        .catch(fail)
    })
    stream.on('error', fail)
    stream.on('end', () => {
      ended = true
      if (!pending && !failed) resolve()
    })
    stream.resume()
  })
}
