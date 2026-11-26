import type { zh } from './zh'

export const nl = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Raster laden…',
  sheetsOpening: 'Werkmap wordt geopend… Grote bestanden duren even.',
  sheetsPasswordTitle: 'Met wachtwoord beveiligde werkmap',
  sheetsPasswordMessage: 'Voer het wachtwoord in om deze werkmap te openen.',
  sheetsPasswordLabel: 'Wachtwoord',
  sheetsPasswordWrong: 'Het wachtwoord is onjuist. Probeer het opnieuw.',
  sheetsPasswordOpen: 'Openen',
  sheetsPasswordCancel: 'Annuleren',
  sheetsEncryptionUnsupported: 'Dit soort wachtwoordbeveiliging kan niet worden geopend.',
  sheetsEncryptionDamaged: 'Deze beveiligde werkmap is beschadigd en kan niet worden geopend.',
  sheetsNoticeMacros: "Macro's blijven behouden maar worden niet uitgevoerd.",
  sheetsNoticeExternalLinks:
    'Cellen die naar andere bestanden verwijzen, tonen hun laatst opgeslagen waarde.',
  sheetsNoticeMacrosAndLinks:
    "Macro's blijven behouden maar worden niet uitgevoerd. Cellen die naar andere bestanden verwijzen, tonen hun laatst opgeslagen waarde.",
} as const satisfies Record<keyof typeof zh, string>
