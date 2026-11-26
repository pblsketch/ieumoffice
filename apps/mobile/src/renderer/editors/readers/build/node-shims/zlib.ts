/**
 * Mobile stand-in for `node:zlib`. The PPTX engine deflates only when it inserts generated
 * pictures, which the read-only mobile viewer never does.
 */
import { notAvailable } from './notAvailable'

export function deflateSync(_data: Uint8Array): never {
  throw notAvailable('zlib.deflateSync')
}
