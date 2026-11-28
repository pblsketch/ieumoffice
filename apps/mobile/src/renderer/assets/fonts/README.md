# Mobile Bundled Korean Fonts

Android and iOS devices do not ship desktop Korean document fonts (Batang, Malgun Gothic, HCR Batang, HCR Dotum, NanumGothic). To preserve HWP/HWPX line breaks under Canvas2D rendering, `apps/mobile` bundles the repository's metric-normalized SIL OFL 1.1 Korean font subsets derived from Noto CJK KR and NanumGothic.

| Family                 | File                                     | License     | Hangul Aliases                    |
| ---------------------- | ---------------------------------------- | ----------- | --------------------------------- |
| GenOffice Serif KR     | `GenOfficeSerifKR-Regular-subset.woff2`  | SIL OFL 1.1 | HCR Batang, Batang, NanumMyeongjo |
| GenOffice Sans KR      | `GenOfficeSansKR-Regular-subset.woff2`   | SIL OFL 1.1 | HCR Dotum, Malgun Gothic          |
| GenOffice Gothic KR    | `GenOfficeGothicKR-Regular-subset.woff2` | SIL OFL 1.1 | NanumGothic                       |
| GenOffice Che Latin KR | `GenOfficeCheLatinKR.woff2`              | SIL OFL 1.1 | Half-width Latin for Che families |

All font files are copied from `apps/docs/src/renderer/fonts/` and governed by `LICENSE-OFL.txt` in this directory.
