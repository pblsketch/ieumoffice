/**
 * The phone's `node:crypto` for the spreadsheet save modules. `randomUUID`
 * is the WebView's. `createHash` backs only whole-file digests the phone's
 * save path does not use (`mutateXlsxFile`, `inventoryXlsx`); it refuses
 * instead of hashing differently.
 */

export function randomUUID(): string {
  return crypto.randomUUID()
}

export function createHash(algorithm: string): never {
  throw new Error(
    `node:crypto createHash(${algorithm}) is not available in the phone's spreadsheet save path.`,
  )
}

export default { randomUUID, createHash }
