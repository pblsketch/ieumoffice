import { createRequire, enableCompileCache } from 'node:module'
import { join } from 'node:path'
import { app } from 'electron'
import { DEV_USER_DATA_DIR_NAME } from '@genoffice/i18n'

/**
 * Thin startup bootstrap built as `out/main/index.js`.
 *
 * Enables Node's on-disk V8 compile cache BEFORE requiring the main bundle
 * (`./shell-main.js`), because `enableCompileCache` only accelerates modules
 * compiled after it is called. `src/main/index.ts` stays untouched at its
 * original path so wiring tests and upstream diffs remain minimal.
 */
const userDataDir = app.isPackaged
  ? app.getPath('userData')
  : process.env.GENOFFICE_USER_DATA || join(app.getPath('appData'), DEV_USER_DATA_DIR_NAME)

try {
  enableCompileCache?.(join(userDataDir, 'v8-compile-cache', app.getVersion()))
} catch {
  // Read-only or unavailable profile directory: continue without bytecode cache.
}

const loadMain = createRequire(import.meta.url)
loadMain('./shell-main.js')
