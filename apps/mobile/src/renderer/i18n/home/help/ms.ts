import type { zh } from './zh'

export const ms = {
  homeHelpSection: 'Bantuan',
  homeHelpClose: 'Tutup',
  homeHelpReplay: 'Tunjukkan panduan selamat datang semula',
  homeHelpReplayFailed:
    'Panduan selamat datang tidak dapat dihidupkan semula. Cuba lagi sebentar nanti.',
  homeHelpFeedback: 'Hantar maklum balas',
  homeHelpWhatsNew: 'Apa yang baharu dalam versi ini',

  homeHelpOpenTitle: 'Membuka dokumen',
  homeHelpOpenBody1:
    'Ketik "Buka fail" pada tab Terkini untuk memilih dokumen pada peranti ini atau dalam aplikasi storan lain.',
  homeHelpOpenBody2:
    'Pautkan folder yang kerap anda gunakan, dan dokumen di dalamnya terus muncul pada tab Folder.',
  homeHelpOpenBody3:
    'Dokumen yang anda buka kekal pada tab Terkini. Tandakan dokumen dengan bintang untuk menemuinya dalam Kegemaran juga.',
  homeHelpOpenBody4:
    'Dokumen dibuka untuk dibaca dahulu. Apabila anda mahu mengubahnya, ketik [Sunting].',

  homeHelpEditTitle: 'Menyunting dan menyimpan',
  homeHelpEditBody1:
    'Dalam mod bacaan, ketik [Sunting] di bahagian atas untuk mula membuat perubahan.',
  homeHelpEditBody2:
    'Ketik teks untuk memaparkan papan kekunci. Bar di atasnya ada pemformatan seperti huruf tebal dan senarai.',
  homeHelpEditBody3:
    'Apabila selesai, ketik [Selesai]. Fail asal disimpan dan anda kembali ke mod bacaan.',
  homeHelpEditBody4:
    'Jika fail asal tidak boleh ditulis, gunakan "Simpan Sebagai" untuk membuat fail baharu.',

  homeHelpRecoveryTitle: 'Menyimpan dan salinan pemulihan',
  homeHelpRecoveryBody1:
    'Semasa anda menyunting, aplikasi menyimpan salinan pemulihan dengan sendirinya. Tiada apa-apa yang perlu diketik.',
  homeHelpRecoveryBody2: 'Fail asal ditulis apabila anda mengetik [Selesai].',
  homeHelpRecoveryBody3:
    'Jika aplikasi tertutup sebelum anda menyimpan, notis tentang salinan pemulihan akan muncul di bahagian atas tab Terkini pada kali seterusnya. Pulihkannya dari situ.',
  homeHelpRecoveryBody4:
    'Anda boleh melihat berapa banyak ruang yang digunakan oleh salinan pemulihan, dan mengosongkannya, dalam Tetapan > Storan.',

  homeHelpShareTitle: 'Berkongsi dan menerima',
  homeHelpShareBody1:
    'Semasa melihat dokumen, ketik [Kongsi] untuk menghantar fail asal seadanya, atau dalam format lain seperti PDF.',
  homeHelpShareBody2:
    'Dalam senarai pada skrin utama, pilih [⋯] > Kongsi untuk menghantar fail asal. Tekan lama untuk memilih beberapa fail dan menghantarnya bersama-sama.',
  homeHelpShareBody3:
    'Fail yang dihantar dari aplikasi lain dibuka dalam mod baca sahaja. Untuk mengubahnya, ketik [Sunting salinan]. Fail asal kekal seperti sedia kala.',

  homeHelpFlowTitle: 'Paparan bacaan untuk HWP',
  homeHelpFlowBody1:
    'Pada telefon, dokumen HWP dibuka dalam paparan bacaan. Teks mengalir mengikut skrin, jadi anda boleh membaca tanpa mengezum.',
  homeHelpFlowBody2:
    'Untuk melihat halaman seperti yang akan dicetak, ketik [Paparan halaman] dalam alat paparan.',
  homeHelpFlowBody3:
    'Paparan bacaan hanya mengubah cara dokumen ditunjukkan. Halamannya dan fail yang disimpan kekal sama.',

  homeHelpAiTitle: 'Menghidupkan dan mematikan AI',
  homeHelpAiBody1: 'AI dimatikan pada mulanya. Selagi ia dimatikan, tiada butang AI yang muncul.',
  homeHelpAiBody2:
    'Untuk menggunakannya, hidupkan AI dalam Tetapan, kemudian tambah kunci API atau pilih sambungan percuma di bawah Sambungan AI. Anda tidak memerlukan akaun untuk aplikasi ini.',
  homeHelpAiBody3:
    'Kandungan dihantar kepada perkhidmatan AI yang anda pilih hanya apabila anda meminta sesuatu daripada AI. Matikan AI semula dan semua butang AI akan hilang.',

  homeHelpFeedbackTitle: 'Hantar maklum balas',
  homeHelpFeedbackBody:
    'Tinjauan dibuka dalam pelayar. Butiran di bawah disalin ke papan keratan supaya anda boleh menampalnya dalam tinjauan. Aplikasi tidak menghantar apa-apa sendiri, dan kandungan dokumen tidak pernah disertakan.',
  homeHelpFeedbackDetails: 'Versi {version}\nSistem {os}\nBahasa {language}',
  homeHelpFeedbackOpen: 'Buka tinjauan',
  homeHelpFeedbackCancel: 'Batal',
  homeHelpFeedbackCopyFailed:
    'Tidak dapat menyalin ke papan keratan. Tekan lama teks di bawah untuk menyalinnya, kemudian tampal dalam tinjauan.',
  homeHelpFeedbackOpenFailed: 'Tidak dapat membuka pelayar.',

  homeHelpWhatsNewVersion: 'Versi {version}',
  homeHelpWhatsNewEmpty: 'Tiada nota untuk versi ini.',
  homeHelpNew010First: 'Versi pertama aplikasi mudah alih GenOffice.',
  homeHelpNew010Edit: 'Buka dan sunting dokumen HWP, PDF, Markdown, HTML dan hamparan.',
  homeHelpNew010Read: 'Baca buku EPUB dan pembentangan PPT.',
  homeHelpNew010PdfTools:
    'Alat PDF: susun halaman, tukar format, kecilkan saiz dan tambah keselamatan, buang anotasi.',
  homeHelpNew010Ai:
    'Pembantu AI, dimatikan pada mulanya, yang berfungsi dengan kunci API atau sambungan percuma.',
  homeHelpNew010Mobile:
    'Berkongsi dan menerima fail, paparan bacaan untuk HWP, panduan selamat datang, pengurusan storan, dan memastikan skrin kekal hidup semasa membaca.',
} as const satisfies Record<keyof typeof zh, string>
