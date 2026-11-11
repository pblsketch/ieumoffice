import type { zh } from './zh'

export const id = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Hubungkan server WebDAV (seperti Nextcloud atau NAS Synology) untuk membuka filenya di sini. Saat disimpan, perubahan dikirim kembali ke server.',
  webdavNoServers: 'Belum ada server yang terhubung.',
  webdavAdd: 'Tambah server',
  webdavFieldName: 'Nama',
  webdavFieldUrl: 'Alamat server',
  webdavFieldUser: 'Nama pengguna',
  webdavFieldPassword: 'Kata sandi atau kata sandi aplikasi',
  webdavUserHint: 'Kosongkan nama pengguna jika server tidak memerlukan login.',
  webdavInsecureWarn:
    'Ini sambungan HTTP tanpa enkripsi. Kata sandi dan file melewati jaringan dalam bentuk yang bisa dibaca.',
  webdavInsecureConfirm: 'Saya paham risikonya dan ingin memakai HTTP',
  webdavSave: 'Hubungkan',
  webdavCancel: 'Batal',
  webdavChecking: 'Memeriksa sambungan…',
  webdavRemove: 'Hapus server',
  webdavRemoveConfirm:
    'Hapus sambungan server ini dari PC ini? File di server tidak ikut terhapus.',
  webdavRemoveYes: 'Hapus',
  webdavNeedPassword: 'PC ini tidak dapat menyimpan kata sandi terenkripsi. Masukkan lagi.',
  webdavNotPersisted:
    'PC ini tidak dapat menyimpan kata sandi terenkripsi, jadi Anda perlu memasukkannya lagi setelah aplikasi ditutup.',
  webdavPrivacy:
    'Kata sandi hanya tersimpan di PC ini, dienkripsi oleh sistem. File hanya berpindah antara PC ini dan server yang Anda isi, saat Anda membuka atau menyimpannya.',
  webdavEmptyTitle: 'Belum ada server WebDAV yang terhubung',
  webdavEmptyBody:
    'Tambahkan server di Pengaturan → Integrasi, lalu telusuri dan buka filenya di sini.',
  webdavOpenSettings: 'Buka Pengaturan',
  webdavRoot: 'Akar',
  webdavFolderEmpty: 'Folder ini kosong.',
  webdavLoading: 'Memuat…',
  webdavRefresh: 'Segarkan',
  webdavUnsupported: 'Aplikasi tidak dapat membuka format ini',
  webdavOpening: 'Membuka…',
  webdavServer: 'Server',
  webdavErrUrl: 'Alamat tidak valid. Masukkan alamat lengkap yang diawali https:// atau http://.',
  webdavErrInsecure: 'Centang konfirmasi sebelum memakai sambungan HTTP tanpa enkripsi.',
  webdavErrAuth:
    'Server menolak login. Periksa nama pengguna dan kata sandi (banyak layanan memerlukan kata sandi aplikasi).',
  webdavErrNotFound: 'Folder atau file itu tidak ada di server.',
  webdavErrForbidden: 'Akun ini tidak diizinkan melakukan itu.',
  webdavErrNetwork: 'Tidak dapat menjangkau server. Periksa alamat dan jaringan Anda.',
  webdavErrLimit: 'Anda dapat menghubungkan hingga 10 server.',
  webdavErrTooLarge: 'File terlalu besar untuk dibuka.',
  webdavErrRateLimit: 'Server meminta Anda mencoba lagi nanti.',
  webdavErrLocked: 'Orang lain mengunci file ini.',
  webdavErrDisk: 'File tidak dapat disimpan ke PC ini.',
} satisfies Record<keyof typeof zh, string>
