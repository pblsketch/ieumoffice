import type { zh } from './zh'

export const cs = {
  pdfLinkPlaceHint: 'Na stránce přetáhněte rámeček v místě odkazu',
  pdfLinkEditTitle: 'Upravit odkaz',
  pdfLinkUrlLabel: 'Webová adresa (http, https, mailto)',
  pdfLinkPageLabel: 'Nebo stránka v tomto dokumentu (1–{count})',
  pdfLinkUrlInvalid: 'Odkazovat lze jen na adresy http, https a mailto',
  pdfLinkPageInvalid: 'Zadejte číslo stránky od 1 do {count}',
  pdfLinkNeedTarget: 'Zadejte webovou adresu nebo číslo stránky',
  pdfLinkApply: 'Přidat odkaz',
  pdfLinkDelete: 'Smazat odkaz',
  pdfLinkPending: 'Odkaz k přidání: {target}',
  pdfLinkToPage: 'Stránka {page}',
  pdfLinkFailed: 'Odkaz se nepodařilo změnit. Zkuste to znovu po dokončení ukládání.',
  pdfLinkUpdate: 'Použít',
} as const satisfies Record<keyof typeof zh, string>
