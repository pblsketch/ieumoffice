/**
 * Stand-in for the `process` global (and `node:process`) inside the PC PDF
 * save code on the phone. The build injects it into those modules only; the
 * page's own global scope is never touched.
 */

const shim = {
  platform: 'linux' as const,
  env: {} as Record<string, string | undefined>,
  argv: ['ieum-mobile'],
  /** wasm-path.ts falls back to <resourcesPath>/wasm when a module cannot resolve */
  resourcesPath: '/ieum-mobile/resources',
  versions: {} as Record<string, string>,
  version: '',
  cwd: (): string => '/',
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]): void =>
    queueMicrotask(() => fn(...args)),
  emitWarning: (): void => {},
}

export default shim
