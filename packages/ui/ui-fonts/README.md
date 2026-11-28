# UI fonts

The bundled UI typeface shipped once for every window and editor in the app. Every file keeps the
original distributor's file name and bytes unmodified, and is licensed under the SIL Open Font
License 1.1. The app serves it only to its own renderers (`genoffice-app://ui-fonts/<file>`) and
does not install fonts into the operating system or register them as document fonts.

This folder holds only the font file(s), their license text(s) and this readme. The list the app
reads is `packages/ui/src/ui-fonts.ts`; it ships once in the installer as `resources/ui-fonts`.

## Pretendard Variable

| File                       | Weight  | Size      |
| -------------------------- | ------- | --------- |
| `PretendardVariable.woff2` | 45..920 | 2,057,688 |

- License: SIL OFL 1.1, with Reserved Font Name "Pretendard" — `Pretendard-OFL.txt`
- License evidence: https://github.com/orioncactus/pretendard/blob/v1.3.9/packages/pretendard/dist/LICENSE.txt
- Distributor: https://github.com/orioncactus/pretendard
- Source: https://github.com/orioncactus/pretendard/blob/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2
- Version: 1.309 (release v1.3.9)
- Downloaded: 2026-11-25
