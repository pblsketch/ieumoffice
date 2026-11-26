/**
 * JSZip for the spreadsheet modules on the phone. The gateway builds new
 * workbooks (CSV and HTML imports) with `generateAsync({ type: 'nodebuffer' })`,
 * which JSZip refuses where Node's `Buffer` does not exist. This subclass
 * asks JSZip for the same bytes as a `Uint8Array` and wraps them in the
 * phone's `Buffer` stand-in. Everything else is JSZip itself.
 */
import JSZip from 'jszip'
import { Buffer } from './buffer'

type GenerateOptions = Parameters<JSZip['generateAsync']>[0]
type UpdateCallback = Parameters<JSZip['generateAsync']>[1]

class MobileJSZip extends JSZip {
  override generateAsync(options?: GenerateOptions, onUpdate?: UpdateCallback): Promise<never> {
    if (options?.type === 'nodebuffer') {
      return super
        .generateAsync({ ...options, type: 'uint8array' }, onUpdate)
        .then((bytes) => Buffer.fromBytes(bytes)) as Promise<never>
    }
    return super.generateAsync(options, onUpdate) as Promise<never>
  }
}

export default MobileJSZip
