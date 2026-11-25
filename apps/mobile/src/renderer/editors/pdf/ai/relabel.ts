// The PC PDF tools label each call (`summary`) with the PC editor's strings in the
// language the PC window last rendered (i18n/locale.tsx keeps it at module level; the
// phone never renders that window). This turns such a label back into its string key
// and parameters and writes it again in the phone's language, from the same PC strings.
import { createI18n, type Lang, type Params } from '@genoffice/i18n'
import { getLang } from '../../../../../../pdf/src/renderer/i18n/locale'
import { strings } from '../../../../../../pdf/src/renderer/i18n/strings'

type PdfStringKey = keyof typeof strings.zh

const translate = createI18n(strings)

interface Pattern {
  readonly key: PdfStringKey
  readonly names: readonly string[]
  readonly re: RegExp
}

const patternsByLang = new Map<Lang, readonly Pattern[]>()

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The tool-label templates of one language as anchored patterns, longest first. */
function patternsOf(lang: Lang): readonly Pattern[] {
  let list = patternsByLang.get(lang)
  if (list) return list
  const dict = strings[lang] as Record<PdfStringKey, string>
  list = (Object.keys(dict) as PdfStringKey[])
    .filter((key) => key.startsWith('aiTool'))
    .map((key) => {
      const template = dict[key]
      const names: string[] = []
      const body = template
        .split(/(\{\w+\})/)
        .map((part) => {
          const name = /^\{(\w+)\}$/.exec(part)?.[1]
          if (!name) return escape(part)
          names.push(name)
          return '([\\s\\S]*?)'
        })
        .join('')
      return { key, names, re: new RegExp(`^${body}$`), length: template.length }
    })
    .sort((a, b) => b.length - a.length)
    .map(({ key, names, re }) => ({ key, names, re }))
  patternsByLang.set(lang, list)
  return list
}

/** A PC tool label in the phone's language; unchanged when it is not one of the PC labels. */
export function relabelSummary(summary: string, lang: Lang): string {
  const from = getLang()
  if (from === lang || !summary) return summary
  for (const pattern of patternsOf(from)) {
    const match = pattern.re.exec(summary)
    if (!match) continue
    const params: Params = {}
    pattern.names.forEach((name, i) => {
      if (!(name in params)) params[name] = match[i + 1] ?? ''
    })
    return translate(lang, pattern.key, params)
  }
  return summary
}
