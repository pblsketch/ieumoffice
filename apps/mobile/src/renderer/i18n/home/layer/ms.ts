import type { zh } from './zh'

export const ms = {
  homeRunEditorOffTitle: 'Editor {name} dimatikan',
  homeRunEditorOffBody:
    'Hidupkannya untuk membuka fail ini. Anda boleh mematikannya semula dalam Tetapan.',
  homeRunEditorOffConfirm: 'Hidupkan dan buka',
  homeRunStripSample: 'Dokumen contoh · Baca sahaja',
  homeRunStripReceived: 'Fail diterima · Baca sahaja',
  homeRunStripReadOnly: 'Baca sahaja',
  homeRunStripCopy: 'Sunting salinan',
  homeRunStripClose: 'Tutup notis',
  homeRunReceiveTitle: 'Fail diterima',
  homeRunReceiveCount: '{count} fail',
  homeRunReceiveClose: 'Tutup fail diterima',
  homeRunReceiveOpen: 'Buka',
  homeRunReceivePdfOff: 'Alat PDF dimatikan',
  homeRunReceivePdfOn: 'Hidupkan dan teruskan',
  homeRunGuideLabel: 'Panduan permulaan',
  homeRunWelcomeTitle: 'Selamat datang',
  homeRunWelcomeBody:
    'Buka dan sunting dokumen HWP, PDF, Markdown dan banyak lagi dengan GenOffice. Tiada akaun, tiada iklan dan dokumen anda kekal pada peranti ini.',
  homeRunStart: 'Mula',
  homeRunTipEditButton: 'Untuk membuat perubahan, ketik [Sunting]',
  homeRunTipFlowView:
    'Ditukar ke paparan bacaan supaya lebih mudah dibaca · Paparan halaman ada di sini',
  homeRunTipFirstEdit:
    'Salinan pemulihan dibuat secara automatik. Fail asal disimpan apabila anda mengetik [Selesai]',
  homeRunTipFirstKeyboard: 'Tukar format teks dengan [Aa]',
} as const satisfies Record<keyof typeof zh, string>
