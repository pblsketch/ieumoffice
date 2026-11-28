/// Where the bundled UI font files live (the allowlist is @genoffice/ui/ui-fonts).
/// The files ship once, as resources/ui-fonts beside the editor modules
/// (apps/shell/electron-builder.cjs); a dev run reads the checkout's folder.
/// No fs, no Electron: callers pass the app facts in.
import { join, resolve } from 'node:path'

import type { TemplateFontsHost } from './template-fonts-dir'

/** the folder's name under the packaged app's resources */
export const UI_FONTS_DIR_NAME = 'ui-fonts'

/** the folder in the checkout, relative to the repo root */
export const UI_FONTS_REPO_DIR = 'packages/ui/ui-fonts'

/**
 * The UI font folder: `<resources>/ui-fonts` in the installed app; in a dev run
 * the checkout's folder, found from the app path (`apps/<app>`, two levels below
 * the repo root, for the shell and every editor alike).
 */
export function uiFontsDir(host: TemplateFontsHost): string {
  if (host.isPackaged) return join(host.resourcesPath, UI_FONTS_DIR_NAME)
  return resolve(host.getAppPath(), '..', '..', UI_FONTS_REPO_DIR)
}
