// SPDX-License-Identifier: Apache-2.0
// Range-storage adaptation for the pinned Apache-2.0 PDF.js worker. Parsing is unchanged.
export function installSparseChunkStorage(ChunkedStream, MissingDataException) {
  const DEFAULT_BUDGET = 16 * 1024 * 1024
  const p = ChunkedStream.prototype
  const stateOf = (stream) => stream._sparse
  const loaded = (stream, index, begin, end) => {
    const state = stateOf(stream)
    return (
      state.materialized ||
      (state.chunks.has(index) &&
        (stream._loadedChunks.has(index) || end <= stream.progressiveDataLength))
    )
  }
  const trim = (stream, begin, end) => {
    const state = stateOf(stream)
    if (state.pinAll || state.materialized) return
    // A synchronous parser operation may genuinely need a large contiguous range.
    // Retain that operation's range; do not create an endless missing-data retry.
    const limit = Math.max(DEFAULT_BUDGET, end - begin + 2 * stream.chunkSize)
    for (const [index, bytes] of state.chunks) {
      if (state.bytes <= limit) break
      const start = index * stream.chunkSize
      if (start < end && start + bytes.length > begin) continue
      state.chunks.delete(index)
      stream._loadedChunks.delete(index)
      state.bytes -= bytes.length
      if (state.lastIndex === index) {
        state.lastIndex = -1
        state.last = null
      }
    }
  }
  const touch = (stream, index) => {
    const state = stateOf(stream)
    if (state.lastIndex === index) return state.last
    const bytes = state.chunks.get(index)
    if (!bytes) return null
    state.chunks.delete(index)
    state.chunks.set(index, bytes)
    state.lastIndex = index
    state.last = bytes
    return bytes
  }
  const range = (stream, begin, end) => {
    const state = stateOf(stream)
    if (state.materialized) return state.materialized.subarray(begin, end)
    if (begin >= end) return new Uint8Array(0)
    const first = Math.floor(begin / stream.chunkSize)
    const last = Math.floor((end - 1) / stream.chunkSize)
    let result
    if (first === last) {
      result = touch(stream, first).subarray(
        begin % stream.chunkSize,
        (begin % stream.chunkSize) + end - begin,
      )
    } else {
      result = new Uint8Array(end - begin)
      for (let at = begin; at < end;) {
        const index = Math.floor(at / stream.chunkSize)
        const bytes = touch(stream, index)
        const offset = at % stream.chunkSize
        const amount = Math.min(bytes.length - offset, end - at)
        result.set(bytes.subarray(offset, offset + amount), at - begin)
        at += amount
      }
    }
    trim(stream, begin, end)
    return result
  }
  p._initSparseStorage = function (length) {
    this._sparse = {
      length,
      chunks: new Map(),
      bytes: 0,
      ever: new Set(),
      lastIndex: -1,
      last: null,
      pinAll: false,
      materialized: null,
    }
    // The parent constructor receives an empty array; legacy raw-data APIs are
    // still supported, materializing only when a caller explicitly asks for it.
    delete this.bytes
    Object.defineProperty(this, 'bytes', {
      configurable: true,
      get() {
        const state = stateOf(this)
        if (!state.materialized) {
          this.ensureRange(0, state.length)
          const bytes = range(this, 0, state.length)
          state.materialized = bytes
          state.chunks.clear()
          state.bytes = 0
          state.lastIndex = -1
          state.last = null
        }
        return state.materialized
      },
    })
  }
  p.onReceiveData = function (begin, data) {
    const state = stateOf(this)
    const bytes = new Uint8Array(data)
    const end = begin + bytes.length
    if (begin % this.chunkSize || (end % this.chunkSize && end !== state.length))
      throw new Error('pdf: invalid sparse range alignment')
    for (let at = begin; at < end; at += this.chunkSize) {
      const index = Math.floor(at / this.chunkSize)
      const copy = bytes.slice(at - begin, Math.min(at - begin + this.chunkSize, bytes.length))
      const previous = state.chunks.get(index)
      state.bytes += copy.length - (previous?.length ?? 0)
      state.chunks.delete(index)
      state.chunks.set(index, copy)
      if (state.lastIndex === index) {
        state.lastIndex = -1
        state.last = null
      }
      this._loadedChunks.add(index)
      state.ever.add(index)
    }
  }
  p.onReceiveProgressiveData = function (data) {
    const state = stateOf(this)
    const bytes = new Uint8Array(data)
    let at = this.progressiveDataLength
    const end = at + bytes.length
    if (end > state.length) throw new Error('pdf: progressive input exceeds file length')
    while (at < end) {
      const index = Math.floor(at / this.chunkSize)
      let chunk = state.chunks.get(index)
      if (!chunk) {
        chunk = new Uint8Array(Math.min(this.chunkSize, state.length - index * this.chunkSize))
        state.chunks.set(index, chunk)
        state.bytes += chunk.length
      }
      const offset = at % this.chunkSize
      const amount = Math.min(chunk.length - offset, end - at)
      chunk.set(
        bytes.subarray(at - this.progressiveDataLength, at - this.progressiveDataLength + amount),
        offset,
      )
      at += amount
      if (offset + amount === chunk.length) {
        this._loadedChunks.add(index)
        state.ever.add(index)
      }
    }
    this.progressiveDataLength = end
  }
  p.ensureByte = function (position) {
    if (!loaded(this, Math.floor(position / this.chunkSize), position, position + 1))
      throw new MissingDataException(position, position + 1)
  }
  p.ensureRange = function (begin, end) {
    if (begin >= end || stateOf(this).materialized) return
    for (let at = begin; at < Math.min(end, stateOf(this).length);) {
      const index = Math.floor(at / this.chunkSize)
      const next = Math.min(end, (index + 1) * this.chunkSize, stateOf(this).length)
      if (!loaded(this, index, at, next)) throw new MissingDataException(begin, end)
      at = next
    }
  }
  p.getByte = function () {
    if (this.pos >= this.end) return -1
    const state = stateOf(this)
    if (state.materialized) return state.materialized[this.pos++]
    this.ensureByte(this.pos)
    const index = Math.floor(this.pos / this.chunkSize)
    const bytes = touch(this, index)
    trim(this, this.pos, this.pos + 1)
    return bytes[this.pos++ % this.chunkSize]
  }
  p.getBytes = function (length) {
    const begin = this.pos
    const end = !length ? this.end : Math.min(begin + length, this.end)
    this.ensureRange(begin, end)
    this.pos = end
    return range(this, begin, end)
  }
  p.getByteRange = function (begin, end) {
    begin = Math.max(0, begin)
    end = Math.min(end, this.end)
    this.ensureRange(begin, end)
    return range(this, begin, end)
  }
  p.clone = function () {
    return this.makeSubStream(this.start, this.length, this.dict?.clone())
  }
}
