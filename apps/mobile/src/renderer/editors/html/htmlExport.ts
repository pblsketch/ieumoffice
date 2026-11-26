// HTML → Word and ODT on the phone (spec 5.7): the desktop converter (`@genoffice/html2docx`)
// driven over a hidden frame that cannot run scripts (htmlExportDriver.ts); ODT is that Word
// document through `docxToOdt`, as the desktop ODT export does. Loaded only when an export runs,
// so none of it is in the app's start-up bundle.
import type { ConversionReport } from '@genoffice/odt-engine'
import { EXPORT_DOCUMENT_URL, SandboxFrameDriver } from './htmlExportDriver'

/** As on the desktop: a conversion that never finishes must not hold the editor. */
const HTML_EXPORT_TIMEOUT_MS = 180_000

export interface HtmlDocxResult {
  readonly bytes: Uint8Array
  /** Pictures the phone could not capture (gradients, drawings, decorations, other sites' images). */
  readonly lostCaptures: number
}

export interface HtmlOdtResult extends HtmlDocxResult {
  /** What the ODT changes or leaves out (`docxToOdt`). */
  readonly report: ConversionReport
}

export interface HtmlExportOptions {
  /** What stands where a picture without words could not be captured (screen language). */
  readonly missingPictureText: string
  /** Where the hidden frame goes (default: this document's body). */
  readonly host?: HTMLElement
  readonly timeoutMs?: number
}

/** The HTML (the export copy of the source on screen) as a Word document. */
export async function htmlToDocx(
  html: string,
  options: HtmlExportOptions,
): Promise<HtmlDocxResult> {
  const { convertHtmlToDocx } = await import('@genoffice/html2docx')
  const driver = new SandboxFrameDriver({
    html,
    host: options.host,
    missingPictureText: options.missingPictureText,
  })
  const abort = new AbortController()
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    const conversion = convertHtmlToDocx({ url: EXPORT_DOCUMENT_URL }, driver, {
      signal: abort.signal,
    })
    const timedOut = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => {
        abort.abort()
        reject(new Error('html export timed out'))
      }, options.timeoutMs ?? HTML_EXPORT_TIMEOUT_MS)
    })
    const { docx } = await Promise.race([conversion, timedOut])
    return { bytes: docx, lostCaptures: driver.lostCaptures }
  } finally {
    clearTimeout(watchdog)
    await driver.close()
  }
}

/** The HTML as an ODT: its Word document converted by `docxToOdt`, as the desktop ODT export does. */
export async function htmlToOdt(html: string, options: HtmlExportOptions): Promise<HtmlOdtResult> {
  const [docx, { docxToOdt }] = await Promise.all([
    htmlToDocx(html, options),
    import('@genoffice/odt-engine'),
  ])
  const { odtBytes, report } = await docxToOdt(docx.bytes)
  return { bytes: odtBytes, report, lostCaptures: docx.lostCaptures }
}
