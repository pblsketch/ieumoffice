import type { zh } from './zh'

export const pl = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Wczytywanie arkusza…',
  sheetsOpening: 'Otwieranie skoroszytu… Duże pliki wymagają chwili.',
  sheetsPasswordTitle: 'Skoroszyt chroniony hasłem',
  sheetsPasswordMessage: 'Wpisz hasło, aby otworzyć ten skoroszyt.',
  sheetsPasswordLabel: 'Hasło',
  sheetsPasswordWrong: 'Hasło jest nieprawidłowe. Spróbuj ponownie.',
  sheetsPasswordOpen: 'Otwórz',
  sheetsPasswordCancel: 'Anuluj',
  sheetsEncryptionUnsupported: 'Nie można otworzyć tego rodzaju ochrony hasłem.',
  sheetsEncryptionDamaged: 'Ten chroniony skoroszyt jest uszkodzony i nie można go otworzyć.',
  sheetsNoticeMacros: 'Makra zostają zachowane, ale nie są uruchamiane.',
  sheetsNoticeExternalLinks:
    'Komórki odwołujące się do innych plików pokazują ostatnio zapisane wartości.',
  sheetsNoticeMacrosAndLinks:
    'Makra zostają zachowane, ale nie są uruchamiane. Komórki odwołujące się do innych plików pokazują ostatnio zapisane wartości.',
} as const satisfies Record<keyof typeof zh, string>
