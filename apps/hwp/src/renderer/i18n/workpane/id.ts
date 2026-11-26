import type { zh } from './zh'

export const id = {
  workpaneTitle: 'Panel kerja',
  workpaneOpen: 'Panel kerja',
  workpaneClose: 'Tutup panel kerja',
  workpaneExpand: 'Luaskan panel kerja',
  workpaneResize: 'Ubah lebar panel kerja',
  workpaneTabOutline: 'Kerangka',
  workpaneTabFind: 'Cari',
  workpaneMenuOutline: 'Panel kerja › Kerangka',
  workpaneMenuFind: 'Panel kerja › Cari',
  workpaneOutlineEmpty: 'Judul dokumen akan ditampilkan di sini.',
  workpaneFindEmpty: 'Cari dan lompat ke hasil yang cocok di dokumen ini.',
  workpaneRailHint: 'Jendela sempit; klik ikon tab untuk melihat.',
} satisfies Record<keyof typeof zh, string>
