import { redactHtmlSource, redactMarkdownSource } from '@genoffice/file-parse'
import type { OpenDocumentsControl } from './tools/open-documents-tools'
import type { SlidesControl } from './tools/slides-tools'

/**
 * Hidden content (민감정보 가리기) on the app's MCP servers: the one turned on
 * under Integrations and the one an agent session gets (decision 0032).
 *
 * Both serve programs, usually models, so every document read hands out a
 * hidden part as its `{{label}}`:
 * - a deck through the slides bridge's withholding readout, and a deck that
 *   withholds anything is not edited here (a marker could otherwise be written
 *   over the words it stands for);
 * - Markdown and HTML tabs through the same functions the cross-file reads use;
 * - Word tabs and Hangul tabs are already read through their editors' model
 *   views (`read_document`, `hwpReadText`), workbooks through the sheets
 *   bridge's hiding hooks, and files on disk through the command line, which
 *   hides on its own.
 * A refusal for hidden content starts with `hidden_content`, the command line's
 * `error` value, so a client can branch on it.
 */

export const HIDDEN_CONTENT = 'hidden_content'

const WITHHELD_DECK = `${HIDDEN_CONTENT}: This presentation withholds some of its content from AI. It cannot be edited here; ask the person to edit it in the app instead.`

/** Slides that read withheld words as labels and are not edited while they withhold anything */
export function withholdingSlides(control: SlidesControl): SlidesControl {
  return {
    ...control,
    readDeck: (wcId) => control.readDeck(wcId, { withhold: true }),
    runTxn: async (wcId, request) => {
      // without a way to tell, the deck is taken to withhold something
      const withholds = control.deckWithholds ? await control.deckWithholds(wcId) : true
      if (withholds) throw new Error(WITHHELD_DECK)
      return control.runTxn(wcId, request)
    },
  }
}

export interface WithholdingOptions {
  /** an agent session: no closing and no saving of open tabs either */
  session?: boolean
}

/** Open documents read with their withheld words as labels */
export function withholdingOpenDocuments(
  control: OpenDocumentsControl,
  options: WithholdingOptions = {},
): OpenDocumentsControl {
  return {
    list: () => control.list(),
    read: async (tab) => {
      if (tab.kind === 'slides') {
        throw new Error('Read a presentation with read_deck, passing its id or path as `document`.')
      }
      const content = await control.read(tab)
      if (tab.kind === 'markdown') return redactMarkdownSource(String(content))
      if (tab.kind === 'html') return redactHtmlSource(String(content))
      return content
    },
    close: options.session
      ? async () => {
          throw new Error('Closing documents is not available in an agent session.')
        }
      : (tab, closing) => control.close(tab, closing),
    save: options.session
      ? async () => {
          throw new Error('Saving open documents is not available in an agent session.')
        }
      : (tab) => control.save(tab),
  }
}
