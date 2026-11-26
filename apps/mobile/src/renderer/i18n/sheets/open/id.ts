import type { zh } from './zh'

export const id = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Memuat kisi…',
  sheetsOpening: 'Membuka buku kerja… File besar butuh sedikit waktu.',
  sheetsPasswordTitle: 'Buku kerja dilindungi kata sandi',
  sheetsPasswordMessage: 'Masukkan kata sandi untuk membuka buku kerja ini.',
  sheetsPasswordLabel: 'Kata sandi',
  sheetsPasswordWrong: 'Kata sandi salah. Coba lagi.',
  sheetsPasswordOpen: 'Buka',
  sheetsPasswordCancel: 'Batal',
  sheetsEncryptionUnsupported: 'Jenis perlindungan kata sandi ini tidak dapat dibuka.',
  sheetsEncryptionDamaged: 'Buku kerja terlindungi ini rusak dan tidak dapat dibuka.',
  sheetsNoticeMacros: 'Makro dipertahankan tetapi tidak dijalankan.',
  sheetsNoticeExternalLinks:
    'Sel yang merujuk ke file lain menampilkan nilai terakhir yang disimpan.',
  sheetsNoticeMacrosAndLinks:
    'Makro dipertahankan tetapi tidak dijalankan. Sel yang merujuk ke file lain menampilkan nilai terakhir yang disimpan.',
} as const satisfies Record<keyof typeof zh, string>
