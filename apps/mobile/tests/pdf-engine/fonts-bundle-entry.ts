/**
 * Entry of the small production bundle pdf-engine-fonts.test.ts builds with
 * Vite: the engine's font loading exactly as the worker bundle takes it (the
 * stand-in rule, the browser build of the brotli decoder, Rollup's module
 * graph), with the virtual file table to read the result back.
 */
export { ensureBundledFonts } from '../../src/renderer/editors/pdf/engine/fonts'
export { setEngineAssetLoader } from '../../src/renderer/editors/pdf/engine/assets'
export { vfsGet } from '../../src/renderer/editors/pdf/engine/node-shims/vfs'
