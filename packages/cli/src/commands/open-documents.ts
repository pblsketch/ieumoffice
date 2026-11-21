import { PRODUCT_NAME } from '@genoffice/i18n'
import { controlEndpoint, controlRequest } from '../control'
import type { CommandDef } from '../registry'
import { CliError, EXIT } from '../result'

export const openDocumentsCommand: CommandDef = {
  name: 'open_documents',
  summary:
    'List documents open in the running GenOffice app, with their paths, tabs and active state.',
  usage: 'open_documents --json',
  async run(_args, ctx) {
    const endpoint = controlEndpoint(ctx.env)
    if (!endpoint) {
      throw new CliError(EXIT.app, `${PRODUCT_NAME} is not running`, undefined, {
        reason: 'app_unavailable',
        suggestion: `start ${PRODUCT_NAME} and retry`,
      })
    }
    const result = await controlRequest(endpoint, { cmd: 'open_documents' })
    if (!Array.isArray(result.documents)) {
      throw new CliError(EXIT.app, `${PRODUCT_NAME} returned an invalid document list`, undefined, {
        reason: 'app_unavailable',
        suggestion: `update ${PRODUCT_NAME} and retry`,
      })
    }
    const count = result.documents.length
    return { summary: `${count} open document${count === 1 ? '' : 's'}`, detail: result }
  },
}
