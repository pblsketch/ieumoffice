/**
 * The phone's `node:path` for the spreadsheet save modules: POSIX paths
 * (Android and iOS app folders), the functions those modules import.
 */

export const sep = '/'

export function normalize(path: string): string {
  if (path === '') return '.'
  const absolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
      continue
    }
    parts.push(part)
  }
  const joined = parts.join('/')
  if (absolute) return `/${joined}`
  return joined === '' ? '.' : joined
}

export function join(...parts: string[]): string {
  const kept = parts.filter((part) => part !== '')
  return kept.length === 0 ? '.' : normalize(kept.join('/'))
}

export function dirname(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  const index = trimmed.lastIndexOf('/')
  if (index < 0) return '.'
  if (index === 0) return '/'
  return trimmed.slice(0, index)
}

export function basename(path: string, ext?: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return ext !== undefined && ext !== name && name.endsWith(ext)
    ? name.slice(0, name.length - ext.length)
    : name
}

export function extname(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index)
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/')
}

export default { sep, normalize, join, dirname, basename, extname, isAbsolute }
