import type { zh } from './zh'

export const id = {
  homeHelpSection: 'Bantuan',
  homeHelpClose: 'Tutup',
  homeHelpReplay: 'Lihat lagi panduan awal',
  homeHelpReplayFailed: 'Panduan awal tidak bisa diaktifkan lagi. Coba lagi sebentar lagi.',
  homeHelpFeedback: 'Kirim masukan',
  homeHelpWhatsNew: 'Yang baru di versi ini',

  homeHelpOpenTitle: 'Membuka dokumen',
  homeHelpOpenBody1:
    'Ketuk "Buka file" di tab Terbaru untuk memilih dokumen di perangkat ini atau di aplikasi penyimpanan lain.',
  homeHelpOpenBody2:
    'Tautkan folder yang sering Anda pakai, dan dokumen di dalamnya langsung muncul di tab Folder.',
  homeHelpOpenBody3:
    'Dokumen yang Anda buka tetap ada di tab Terbaru. Beri bintang agar juga bisa ditemukan di Favorit.',
  homeHelpOpenBody4:
    'Dokumen dibuka untuk dibaca lebih dulu. Jika ingin mengubahnya, ketuk [Edit].',

  homeHelpEditTitle: 'Mengedit dan menyimpan',
  homeHelpEditBody1: 'Di mode baca, ketuk [Edit] di bagian atas untuk mulai mengubah.',
  homeHelpEditBody2:
    'Ketuk teks untuk memunculkan keyboard. Bilah di atasnya berisi format seperti tebal dan daftar.',
  homeHelpEditBody3:
    'Setelah selesai, ketuk [Selesai]. File asli disimpan dan Anda kembali ke mode baca.',
  homeHelpEditBody4:
    'Jika file asli tidak bisa ditulis, gunakan "Simpan Sebagai" untuk membuat file baru.',

  homeHelpRecoveryTitle: 'Penyimpanan dan salinan pemulihan',
  homeHelpRecoveryBody1:
    'Selama Anda mengedit, aplikasi menyimpan salinan pemulihan dengan sendirinya. Tidak ada yang perlu diketuk.',
  homeHelpRecoveryBody2: 'File asli ditulis saat Anda mengetuk [Selesai].',
  homeHelpRecoveryBody3:
    'Jika aplikasi tertutup sebelum Anda menyimpan, pemberitahuan tentang salinan pemulihan muncul di bagian atas tab Terbaru saat aplikasi dibuka lagi. Pulihkan dari sana.',
  homeHelpRecoveryBody4:
    'Anda bisa melihat berapa banyak ruang yang dipakai salinan pemulihan, dan menghapusnya, di Pengaturan > Penyimpanan.',

  homeHelpShareTitle: 'Berbagi dan menerima',
  homeHelpShareBody1:
    'Saat melihat dokumen, ketuk [Bagikan] untuk mengirim aslinya apa adanya, atau dalam format lain seperti PDF.',
  homeHelpShareBody2:
    'Di daftar pada layar beranda, pilih [⋯] > Bagikan untuk mengirim file asli. Tekan lama untuk memilih beberapa file dan mengirimnya sekaligus.',
  homeHelpShareBody3:
    'File yang dikirim dari aplikasi lain dibuka sebagai hanya-baca. Untuk mengubahnya, ketuk [Edit salinan]. File aslinya tetap seperti semula.',

  homeHelpFlowTitle: 'Tampilan baca untuk HWP',
  homeHelpFlowBody1:
    'Dokumen HWP dibuka dalam tampilan halaman seperti saat dicetak. Untuk menyesuaikan teks dengan lebar layar, ketuk [Tampilan baca] di alat tampilan.',
  homeHelpFlowBody2:
    'Untuk kembali ke tata letak halaman cetak, ketuk [Tampilan halaman] di alat tampilan.',
  homeHelpFlowBody3:
    'Tampilan baca hanya mengubah cara dokumen ditampilkan. Halaman dokumen dan file yang disimpan tetap sama.',

  homeHelpAiTitle: 'Menyalakan dan mematikan AI',
  homeHelpAiBody1: 'AI mati pada awalnya. Selama mati, tidak ada tombol AI yang muncul.',
  homeHelpAiBody2:
    'Untuk memakainya, nyalakan AI di Pengaturan, lalu tambahkan kunci API atau pilih koneksi gratis di Koneksi AI. Anda tidak perlu akun untuk aplikasi ini.',
  homeHelpAiBody3:
    'Konten dikirim ke layanan AI pilihan Anda hanya saat Anda meminta sesuatu kepada AI. Matikan AI lagi dan semua tombol AI menghilang.',

  homeHelpFeedbackTitle: 'Kirim masukan',
  homeHelpFeedbackBody:
    'Survei terbuka di peramban. Detail di bawah disalin ke papan klip agar Anda dapat menempelkannya ke survei. Aplikasi tidak mengirim apa pun sendiri, dan isi dokumen tidak pernah disertakan.',
  homeHelpFeedbackDetails: 'Versi {version}\nSistem {os}\nBahasa {language}',
  homeHelpFeedbackOpen: 'Buka survei',
  homeHelpFeedbackCancel: 'Batal',
  homeHelpFeedbackCopyFailed:
    'Tidak bisa menyalin ke papan klip. Tekan lama teks di bawah untuk menyalinnya, lalu tempelkan ke survei.',
  homeHelpFeedbackOpenFailed: 'Peramban tidak bisa dibuka.',

  homeHelpWhatsNewVersion: 'Versi {version}',
  homeHelpWhatsNewEmpty: 'Tidak ada catatan untuk versi ini.',
  homeHelpNew010First: 'Versi pertama aplikasi seluler GenOffice.',
  homeHelpNew010Edit: 'Buka dan edit dokumen HWP, PDF, Markdown, HTML, dan spreadsheet.',
  homeHelpNew010Read: 'Baca buku EPUB dan presentasi PPT.',
  homeHelpNew010PdfTools:
    'Alat PDF: atur halaman, konversi, perkecil ukuran dan tambahkan keamanan, hapus anotasi.',
  homeHelpNew010Ai:
    'Asisten AI, mati pada awalnya, yang bekerja dengan kunci API atau koneksi gratis.',
  homeHelpNew010Mobile:
    'Berbagi dan menerima file, tampilan baca untuk HWP, panduan awal, pengelolaan penyimpanan, dan layar tetap menyala saat membaca.',
} as const satisfies Record<keyof typeof zh, string>
