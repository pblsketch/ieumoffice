# Mobile Bundled Korean Fonts

Android and iOS devices do not ship desktop Korean document fonts (Batang, Malgun Gothic, HCR Batang, HCR Dotum, NanumGothic). To preserve HWP/HWPX line breaks under Canvas2D rendering, `apps/mobile` bundles the repository's metric-normalized SIL OFL 1.1 Korean font subsets derived from Noto CJK KR and NanumGothic.

| Family                 | File                                     | License     | Hangul Aliases                    |
| ---------------------- | ---------------------------------------- | ----------- | --------------------------------- |
| GenOffice Serif KR     | `GenOfficeSerifKR-Regular-subset.woff2`  | SIL OFL 1.1 | HCR Batang, Batang, NanumMyeongjo |
| GenOffice Sans KR      | `GenOfficeSansKR-Regular-subset.woff2`   | SIL OFL 1.1 | HCR Dotum, Malgun Gothic          |
| GenOffice Gothic KR    | `GenOfficeGothicKR-Regular-subset.woff2` | SIL OFL 1.1 | NanumGothic                       |
| GenOffice Che Latin KR | `GenOfficeCheLatinKR.woff2`              | SIL OFL 1.1 | Half-width Latin for Che families |

All HWP document font files are copied from `apps/docs/src/renderer/fonts/` and governed by `LICENSE-OFL.txt` in this directory.

## Mobile App UI Font

The mobile app chrome (home, settings, headers, sheets, buttons, tips) uses **Pretendard** (`ui-font.css`) for Korean, Latin, Cyrillic, and Vietnamese UI text, falling back to device system fonts for scripts Pretendard does not cover (Japanese, Simplified/Traditional Chinese, Thai, Arabic, Hebrew, Hindi). Document content fonts are kept separate and unchanged.

| Family     | File                       | Weight  | License     | Source                                                                |
| ---------- | -------------------------- | ------- | ----------- | --------------------------------------------------------------------- |
| Pretendard | `Pretendard-Regular.woff2` | 400–500 | SIL OFL 1.1 | Lossless WOFF2 of `packages/ui/template-fonts/Pretendard-Regular.otf` |
| Pretendard | `Pretendard-Bold.woff2`    | 600–700 | SIL OFL 1.1 | Lossless WOFF2 of `packages/ui/template-fonts/Pretendard-Bold.otf`    |

Pretendard is licensed under SIL OFL 1.1 with Reserved Font Name `"Pretendard"`; the unmodified license text is bundled in `Pretendard-OFL.txt`. No glyphs, outlines, metrics, or tables are altered (lossless WOFF2 container compression only).
