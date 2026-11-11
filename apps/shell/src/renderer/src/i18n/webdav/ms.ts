import type { zh } from './zh'

export const ms = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Sambungkan pelayan WebDAV (seperti Nextcloud atau NAS Synology) untuk membuka failnya di sini. Apabila disimpan, perubahan dihantar semula ke pelayan.',
  webdavNoServers: 'Belum ada pelayan yang disambungkan.',
  webdavAdd: 'Tambah pelayan',
  webdavFieldName: 'Nama',
  webdavFieldUrl: 'Alamat pelayan',
  webdavFieldUser: 'Nama pengguna',
  webdavFieldPassword: 'Kata laluan atau kata laluan aplikasi',
  webdavUserHint: 'Biarkan nama pengguna kosong jika pelayan tidak memerlukan log masuk.',
  webdavInsecureWarn:
    'Ini sambungan HTTP tanpa penyulitan. Kata laluan dan fail melalui rangkaian dalam bentuk yang boleh dibaca.',
  webdavInsecureConfirm: 'Saya faham risikonya dan mahu menggunakan HTTP',
  webdavSave: 'Sambung',
  webdavCancel: 'Batal',
  webdavChecking: 'Menyemak sambungan…',
  webdavRemove: 'Buang pelayan',
  webdavRemoveConfirm:
    'Buang sambungan pelayan ini daripada PC ini? Fail pada pelayan tidak dipadam.',
  webdavRemoveYes: 'Buang',
  webdavNeedPassword: 'PC ini tidak dapat menyimpan kata laluan secara tersulit. Masukkan semula.',
  webdavNotPersisted:
    'PC ini tidak dapat menyimpan kata laluan secara tersulit, jadi anda perlu memasukkannya semula selepas aplikasi ditutup.',
  webdavPrivacy:
    'Kata laluan kekal pada PC ini, disulitkan oleh sistem. Fail hanya bergerak antara PC ini dengan pelayan yang anda masukkan, apabila anda membuka atau menyimpannya.',
  webdavEmptyTitle: 'Tiada pelayan WebDAV yang disambungkan',
  webdavEmptyBody:
    'Tambah pelayan dalam Tetapan → Integrasi, kemudian layari dan buka failnya di sini.',
  webdavOpenSettings: 'Buka Tetapan',
  webdavRoot: 'Akar',
  webdavFolderEmpty: 'Folder ini kosong.',
  webdavLoading: 'Memuatkan…',
  webdavRefresh: 'Segar semula',
  webdavUnsupported: 'Aplikasi tidak dapat membuka format ini',
  webdavOpening: 'Membuka…',
  webdavServer: 'Pelayan',
  webdavErrUrl:
    'Alamat tidak sah. Masukkan alamat penuh yang bermula dengan https:// atau http://.',
  webdavErrInsecure: 'Tandakan pengesahan sebelum menggunakan sambungan HTTP tanpa penyulitan.',
  webdavErrAuth:
    'Pelayan menolak log masuk. Semak nama pengguna dan kata laluan (banyak perkhidmatan memerlukan kata laluan aplikasi).',
  webdavErrNotFound: 'Folder atau fail itu tiada pada pelayan.',
  webdavErrForbidden: 'Akaun ini tidak dibenarkan melakukannya.',
  webdavErrNetwork: 'Tidak dapat menghubungi pelayan. Semak alamat dan rangkaian anda.',
  webdavErrLimit: 'Anda boleh menyambung sehingga 10 pelayan.',
  webdavErrTooLarge: 'Fail terlalu besar untuk dibuka.',
  webdavErrRateLimit: 'Pelayan meminta anda mencuba semula kemudian.',
  webdavErrLocked: 'Orang lain telah mengunci fail ini.',
  webdavErrDisk: 'Fail tidak dapat disimpan pada PC ini.',
} satisfies Record<keyof typeof zh, string>
