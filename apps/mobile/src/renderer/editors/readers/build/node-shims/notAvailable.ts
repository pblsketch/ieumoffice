/** The error the write-only stand-ins throw: the mobile app opens decks for reading only */
export function notAvailable(name: string): Error {
  return new Error(`${name} is not available in the mobile reader`)
}
