/**
 * Stand-in for `electron` inside the PC PDF save code on the phone. The save
 * paths the phone uses never reach Electron; image edits do (nativeImage) and
 * must fail loudly rather than skip silently.
 */
import { notOnMobile } from './unsupported'

const refuse = (what: string) => (): never => notOnMobile(`electron.${what}`)

export const nativeImage = {
  createFromBuffer: refuse('nativeImage.createFromBuffer'),
  createFromBitmap: refuse('nativeImage.createFromBitmap'),
  createFromDataURL: refuse('nativeImage.createFromDataURL'),
  createFromPath: refuse('nativeImage.createFromPath'),
  createEmpty: refuse('nativeImage.createEmpty'),
}

const refusingModule = (name: string): object =>
  new Proxy(
    {},
    {
      get: (_target, key) => (key === 'then' ? undefined : refuse(`${name}.${String(key)}`)),
    },
  )

export const app = refusingModule('app')
export const ipcMain = refusingModule('ipcMain')
export const dialog = refusingModule('dialog')
export const shell = refusingModule('shell')
export const BrowserWindow = refusingModule('BrowserWindow')

export default { nativeImage, app, ipcMain, dialog, shell, BrowserWindow }
