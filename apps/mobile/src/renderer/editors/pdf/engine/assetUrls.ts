/**
 * Bundle URLs of the engine's heavy assets. Imported lazily by assets.ts, so
 * nothing is fetched until a request needs it.
 */
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import hbSubsetWasmUrl from 'harfbuzzjs/hb-subset.wasm?url'
import gothicFontUrl from '../../../assets/fonts/GenOfficeGothicKR-Regular-subset.woff2?url'
import sansFontUrl from '../../../assets/fonts/GenOfficeSansKR-Regular-subset.woff2?url'
import serifFontUrl from '../../../assets/fonts/GenOfficeSerifKR-Regular-subset.woff2?url'
import type { EngineAsset } from './assets'

export const ENGINE_ASSET_URLS: Readonly<Record<EngineAsset, string>> = {
  'pdfium.wasm': pdfiumWasmUrl,
  'hb-subset.wasm': hbSubsetWasmUrl,
  'font:sans': sansFontUrl,
  'font:serif': serifFontUrl,
  'font:gothic': gothicFontUrl,
}
