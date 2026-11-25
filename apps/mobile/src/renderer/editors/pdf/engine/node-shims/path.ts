/**
 * Stand-in for `node:path` inside the PC PDF save code on the phone: POSIX
 * semantics (the virtual file table uses POSIX paths).
 */

export const sep = '/'
export const delimiter = ':'

export function normalize(path: string): string {
  if (path === '') return '.'
  const absolute = path.startsWith('/')
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!absolute) out.push('..')
    } else out.push(part)
  }
  const joined = out.join('/')
  const trailing = path.endsWith('/') && joined !== '' ? '/' : ''
  if (absolute) return `/${joined}${trailing}`
  return joined === '' ? '.' : `${joined}${trailing}`
}

export function join(...parts: string[]): string {
  const kept = parts.filter((p) => p !== '')
  return kept.length === 0 ? '.' : normalize(kept.join('/'))
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/')
}

export function resolve(...parts: string[]): string {
  let out = ''
  for (let i = parts.length - 1; i >= 0 && !out.startsWith('/'); i--) {
    const part = parts[i]!
    if (part !== '') out = out === '' ? part : `${part}/${out}`
  }
  const normalized = normalize(out.startsWith('/') ? out : `/${out}`)
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

export function dirname(path: string): string {
  if (path === '') return '.'
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  const at = trimmed.lastIndexOf('/')
  if (at < 0) return '.'
  if (at === 0) return '/'
  return trimmed.slice(0, at)
}

export function basename(path: string, ext?: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return ext && base.endsWith(ext) && base !== ext ? base.slice(0, -ext.length) : base
}

export function extname(path: string): string {
  const base = basename(path)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot)
}

export function relative(from: string, to: string): string {
  const a = resolve(from).split('/').filter(Boolean)
  const b = resolve(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

const path = {
  sep,
  delimiter,
  normalize,
  join,
  isAbsolute,
  resolve,
  dirname,
  basename,
  extname,
  relative,
}

export const posix = path

export default { ...path, posix }
