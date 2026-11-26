/**
 * Stand-in for `node:os` inside the PC PDF save code on the phone. The home
 * folder is virtual: font-metrics derives its font folders from it, and those
 * folders hold only the app's bundled fonts (engine/fonts.ts).
 */

export const EOL = '\n'
export const homedir = (): string => '/home/mobile'
export const tmpdir = (): string => '/tmp'
export const platform = (): string => 'linux'
export const type = (): string => 'Linux'
export const arch = (): string => 'wasm'
export const release = (): string => ''
export const hostname = (): string => 'mobile'
export const cpus = (): unknown[] => []

export default { EOL, homedir, tmpdir, platform, type, arch, release, hostname, cpus }
