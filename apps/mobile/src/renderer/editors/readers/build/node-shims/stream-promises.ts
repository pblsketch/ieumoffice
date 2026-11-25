/**
 * Mobile stand-in for `node:stream/promises`. The PPTX engine reaches it only when saving a
 * deck to a file path, which the read-only mobile viewer never does.
 */
import { notAvailable } from './notAvailable'

export function pipeline(..._streams: unknown[]): never {
  throw notAvailable('stream.pipeline')
}
