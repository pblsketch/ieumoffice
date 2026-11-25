import { defineConfig } from 'vitest/config'
import { trackAlias, trackDefine, trackPlugins, trackTestSetupFiles } from './config/tracks'

export default defineConfig({
  // each v1 track's own plugins, aliases and setup files (config/tracks/<track>.ts)
  plugins: trackPlugins,
  resolve: {
    alias: trackAlias,
  },
  define: trackDefine,
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: trackTestSetupFiles,
  },
})
