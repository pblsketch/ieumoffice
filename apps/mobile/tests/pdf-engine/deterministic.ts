/**
 * The outside inputs the PDF engine parity test fixes in both runs (the PC
 * reference process and the mobile Vitest process): the clock and the
 * random bytes. Plain TS with no imports, loaded by both.
 */

/** 2026-01-02T03:04:05Z */
export const FIXED_TIME_MS = Date.UTC(2026, 0, 2, 3, 4, 5)

/** Replace the global Date with one frozen at `ms`; returns the restore function */
export function installFixedClock(ms: number = FIXED_TIME_MS): () => void {
  const RealDate = globalThis.Date
  const Fixed = function (this: unknown, ...args: unknown[]) {
    if (!new.target) return new RealDate(ms).toString()
    const ctorArgs = (args.length === 0 ? [ms] : args) as [number]
    return Reflect.construct(RealDate, ctorArgs, new.target)
  } as unknown as DateConstructor
  Object.setPrototypeOf(Fixed, RealDate)
  Object.defineProperty(Fixed, 'prototype', { value: RealDate.prototype })
  Fixed.now = () => ms
  globalThis.Date = Fixed
  return () => {
    globalThis.Date = RealDate
  }
}

/**
 * A byte stream fixed by `seed` (splitmix32): every call continues the stream,
 * so two runs that draw the same lengths in the same order get the same bytes.
 */
export function deterministicRandom(seed: number): (length: number) => Uint8Array {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x9e3779b9) >>> 0
    let z = state
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
  return (length: number) => {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) out[i] = next() & 0xff
    return out
  }
}
