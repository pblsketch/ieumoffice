import { defineConfig } from 'vitest/config'
import { pdfEngineNodeShims } from './src/renderer/editors/pdf/engine/build/nodeShimPlugin'

export default defineConfig({
  // Track T2 (pdf): the PC PDF save code runs on mobile stand-ins for Node
  // built-ins; the rule applies only to apps/pdf/src/main, font-metrics and
  // electron-utils, so every other module resolves as before.
  plugins: [pdfEngineNodeShims()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
