import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { htmlDir, htmlLang, type Lang, type Params } from '@genoffice/i18n'
import { translateMobile, type MobileStringKey } from './strings'

export interface MobileLocaleContextValue {
  readonly lang: Lang
  readonly t: (key: MobileStringKey, params?: Params) => string
}

const MobileLocaleContext = createContext<MobileLocaleContextValue>({
  lang: 'en',
  t: (key, params) => translateMobile('en', key, params),
})

export interface MobileLocaleProviderProps {
  readonly lang: Lang
  readonly children: ReactNode
}

export function MobileLocaleProvider({ lang, children }: MobileLocaleProviderProps) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = htmlLang(lang)
    document.documentElement.dir = htmlDir(lang)
  }, [lang])

  const value = useMemo<MobileLocaleContextValue>(
    () => ({
      lang,
      t: (key, params) => translateMobile(lang, key, params),
    }),
    [lang],
  )

  return <MobileLocaleContext.Provider value={value}>{children}</MobileLocaleContext.Provider>
}

export function useMobileLocale(): MobileLocaleContextValue {
  return useContext(MobileLocaleContext)
}
