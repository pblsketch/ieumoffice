// html2docx's Word generator (packages/html2docx/src/generate.ts) packs the document with
// `Packer.toBuffer`, which needs Node's Buffer. In the phone's web view config/tracks/web.ts hands
// that file this module as `docx` instead: the same packing, as bytes a browser can hold.
import { Packer as DocxPacker, type Document } from 'docx'

/** The one `docx` export generate.ts imports. */
export const Packer = {
  async toBuffer(file: Document): Promise<Uint8Array> {
    return new Uint8Array(await DocxPacker.toArrayBuffer(file))
  },
}
