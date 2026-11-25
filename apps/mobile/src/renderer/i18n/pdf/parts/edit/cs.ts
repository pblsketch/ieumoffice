import type { zh } from './zh'

export const cs = {
  pdfEditPen: 'Pero',
  pdfEditHighlighter: 'Zvýrazňovač',
  pdfEditTextBox: 'Textové pole',
  pdfEditSign: 'Podepsat',
  pdfEditPages: 'Uspořádat stránky',
  pdfEditLink: 'Vložit odkaz',
  pdfEditSaveFailed: 'Uložení se nezdařilo. Vaše změny zůstaly a soubor se nezměnil.',
  pdfEditSaveSkipped: 'Některé úpravy textu na stránce {pages} se nepodařilo uložit.',
  pdfEditShareFailed: 'Sdílení se nezdařilo.',
  pdfEditReloadFailed: 'Uloženo, ale dokument se nepodařilo znovu načíst. Otevřete soubor znovu.',
  pdfEditSignatureUnavailable: 'Podepisování zatím není k dispozici.',
  pdfEditSaveAsHint:
    'Zvolte, jak se v kopii zpracují zvýraznění, poznámky a kresby. „Zapečetit do stránek“ zapečetí i pole formulářů; „Anotace vynechat“ zachová odkazy a pole formulářů.',
  pdfEditKeepAnnots: 'Ponechat anotace (upravitelné v jiných aplikacích)',
  pdfEditFlattenAnnots: 'Zapečetit do stránek (viditelné ve všech aplikacích)',
  pdfEditStripAnnots: 'Anotace vynechat (odkazy a pole zůstanou)',
  pdfEditSaveVerifyFailed:
    'Změny na stránce {pages} se nepodařilo zapsat zpět beze změny, uložení bylo proto zrušeno a soubor zůstal nedotčen; vraťte dotčenou úpravu zpět a zkuste to znovu',
} as const satisfies Record<keyof typeof zh, string>
