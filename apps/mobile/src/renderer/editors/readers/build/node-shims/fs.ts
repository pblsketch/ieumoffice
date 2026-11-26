/**
 * Mobile stand-in for `node:fs`. The PPTX engine reaches it only when saving a deck to a file
 * path, which the read-only mobile viewer never does.
 */
import { notAvailable } from './notAvailable'

export function createWriteStream(_path: string): never {
  throw notAvailable('fs.createWriteStream')
}
