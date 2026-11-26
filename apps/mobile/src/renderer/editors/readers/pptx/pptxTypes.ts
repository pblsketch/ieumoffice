import type { Params } from '@genoffice/i18n'
import type { MobileStringKey } from '../../../i18n/strings'

/** The reader's translate function for the current language. */
export type PptxTranslate = (key: MobileStringKey, params?: Params) => string
