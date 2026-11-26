import type { zh } from './zh'

export const hi = {
  homeTabNav: 'होम मेनू',
  homeTabRecent: 'हाल के',
  homeTabFolders: 'फ़ोल्डर',
  homeTabTools: 'टूल',
  homeTabSettings: 'सेटिंग्स',
  homeListAll: 'सभी',
  homeListFavorites: 'पसंदीदा',
  homeListChips: 'सूची छाँटें',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty: 'अभी कोई पसंदीदा नहीं है। फ़ाइल के [⋯] से उसे पसंदीदा में जोड़ें।',
  homeListGroupEmpty: 'इस समूह में अभी कोई फ़ाइल नहीं है।',
  homeListFavoriteLost:
    'यह फ़ाइल नहीं खुल सकी। हो सकता है वह हटा दी गई हो या कहीं और ले जाई गई हो।',
  homeEmptyText:
    'आपने अभी तक कोई दस्तावेज़ नहीं खोला है। नमूना दस्तावेज़ देखें या कोई फ़ाइल खोलें।',
  homeEmptySample: 'नमूना दस्तावेज़ खोलें',
  homeEmptyCreate: 'नया बनाएँ',
  homeCreateFab: 'नया बनाएँ',
  homeCreateTitle: 'नया बनाएँ',
  homeCreateClose: 'बंद करें',
  homeCreatePdfTools: 'PDF टूल',
} as const satisfies Record<keyof typeof zh, string>
