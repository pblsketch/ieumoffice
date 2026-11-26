/** The phone's `node:os` for the spreadsheet save modules: the temp folder is the T1 work folder. */
import { mobileVfs } from './vfs'

export function tmpdir(): string {
  return mobileVfs.tmpdir()
}

export default { tmpdir }
