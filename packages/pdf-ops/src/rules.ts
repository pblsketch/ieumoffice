/**
 * The tools window's two checks around a run, shared with the phone: what a
 * picked file is for a tool (read again before every run, as the file may
 * have changed), and whether a password or repair job answered with what the
 * tool promises.
 */
import {
  encryptedPageCount,
  inspectImage,
  inspectPdf,
  type InspectResult,
  type PdfToolAccept,
  type PdfToolInputKind,
} from './tools'

/**
 * How many pages a picked file has for a tool that takes `accept`, or why the
 * tool cannot take it: password-protected PDFs only for "remove password",
 * files pdf-lib cannot read only for "repair" (their page count unknown, 0).
 */
export async function inspectToolInput(
  bytes: Uint8Array,
  kind: PdfToolInputKind,
  accept: PdfToolAccept,
): Promise<InspectResult> {
  if (kind === 'image') return inspectImage(bytes)
  const info = await inspectPdf(bytes)
  if (info.ok) return accept === 'encrypted' ? { ok: false, problem: 'not-encrypted' } : info
  if (info.problem === 'encrypted' && accept === 'encrypted') {
    return { ok: true, pages: await encryptedPageCount(bytes) }
  }
  if (info.problem === 'unreadable' && accept === 'damaged') return { ok: true, pages: 0 }
  return info
}

/**
 * Whether a job's file is what its tool promises: "add password" gives a file
 * that asks for a password; "remove password" and "repair" give one the
 * other tools can read without one.
 */
export async function checkToolResult(
  tool: 'encrypt' | 'decrypt' | 'repair',
  bytes: Uint8Array,
): Promise<boolean> {
  const info = await inspectPdf(bytes)
  return tool === 'encrypt' ? !info.ok && info.problem === 'encrypted' : info.ok
}
