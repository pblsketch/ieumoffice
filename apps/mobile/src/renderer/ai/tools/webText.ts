/**
 * Small helpers of the web tools that stay in the first-load code: the
 * model-facing text of one read_url slice and Rust's public address refusals
 * as tool failures. The page conversion itself (readUrl.ts, PC htmlToText)
 * loads only when a page is read.
 */
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import { toolError, type MobileAiToolError, type ReadUrlPage } from './types'

function hostForLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).host
  } catch {
    return rawUrl
  }
}

/** PC readUrlModelText: the name line with the character window, the address, then the text. */
export function mobileReadUrlModelText(page: ReadUrlPage): string {
  const end = page.offset + page.text.length
  const name = page.title !== undefined && page.title !== '' ? page.title : hostForLabel(page.url)
  return (
    `${name} — characters ${page.offset}..${end} of ${page.totalChars}` +
    (page.truncated ? ' (continue with offset)' : ' (end)') +
    `\n${page.url}\n\n${page.text}`
  )
}

/** Rust's refusal of a public address request as a read_url failure. */
export function webFetchFailure(err: unknown): MobileAiToolError {
  const key = isMobileCommandError(err) ? err.messageKey : ''
  switch (key) {
    case 'mobile.ai.webAddressNotPublic':
      return toolError(
        'blocked',
        'Refused to fetch that address: it is, or redirects to, a private or loopback address.',
      )
    case 'mobile.ai.webInvalidUrl':
    case 'mobile.ai.webSchemeNotAllowed':
      return toolError('invalid_url', 'Only http and https addresses can be read.')
    case 'mobile.ai.webTimeout':
      return toolError('timeout', 'The page did not answer within 30 seconds.')
    case 'mobile.ai.webTooLarge':
      return toolError(
        'too_large',
        'The page is larger than 10 MB. Download it and attach the file instead.',
      )
    case 'mobile.ai.webTooManyRedirects':
      return toolError('network', 'The address redirected too many times.')
    case 'mobile.ai.cancelled':
      return toolError('network', 'The read was cancelled.')
    default:
      return toolError('network', 'Could not reach the address.')
  }
}
