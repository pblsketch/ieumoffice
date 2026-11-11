import { mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

export function isWithin(root, candidate, paths = path) {
  const relative = paths.relative(root, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative))
  )
}

export function privateInput(file, root, output) {
  const resolved = realpathSync(file)
  if (isWithin(realpathSync(root), resolved)) throw Error('INPUT_MUST_BE_PRIVATE')
  if (output && isWithin(output, resolved)) throw Error('INPUT_OVERLAPS_OUTPUT')
  return resolved
}

// Refuse before making anything. Resolve the existing parent to catch directory links.
// A fresh directory also prevents artifacts from replacing an input or prior report.
export function privateOutput(directory, root) {
  const requested = path.resolve(directory)
  const parent = realpathSync(path.dirname(requested))
  const resolved = path.join(parent, path.basename(requested))
  if (isWithin(realpathSync(root), resolved)) throw Error('OUTPUT_MUST_BE_PRIVATE')
  mkdirSync(resolved)
  return realpathSync(resolved)
}
