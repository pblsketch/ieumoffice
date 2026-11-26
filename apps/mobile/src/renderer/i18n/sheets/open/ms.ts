import type { zh } from './zh'

export const ms = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Memuatkan grid…',
  sheetsOpening: 'Membuka buku kerja… Fail besar mengambil sedikit masa.',
  sheetsPasswordTitle: 'Buku kerja dilindungi kata laluan',
  sheetsPasswordMessage: 'Masukkan kata laluan untuk membuka buku kerja ini.',
  sheetsPasswordLabel: 'Kata laluan',
  sheetsPasswordWrong: 'Kata laluan tidak betul. Cuba lagi.',
  sheetsPasswordOpen: 'Buka',
  sheetsPasswordCancel: 'Batal',
  sheetsEncryptionUnsupported: 'Jenis perlindungan kata laluan ini tidak dapat dibuka.',
  sheetsEncryptionDamaged: 'Buku kerja dilindungi ini rosak dan tidak dapat dibuka.',
  sheetsNoticeMacros: 'Makro dikekalkan tetapi tidak dijalankan.',
  sheetsNoticeExternalLinks: 'Sel yang merujuk fail lain menunjukkan nilai terakhir yang disimpan.',
  sheetsNoticeMacrosAndLinks:
    'Makro dikekalkan tetapi tidak dijalankan. Sel yang merujuk fail lain menunjukkan nilai terakhir yang disimpan.',
} as const satisfies Record<keyof typeof zh, string>
