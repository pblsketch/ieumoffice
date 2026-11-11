/** Release an exclusively owned output/input, never a shared Buffer pool or WASM heap. */
export function releaseOwnedBuffer(buffer: ArrayBuffer): void {
  const transferable = buffer as ArrayBuffer & { transfer(size: number): ArrayBuffer }
  if (typeof transferable.transfer === 'function') transferable.transfer(0)
}
