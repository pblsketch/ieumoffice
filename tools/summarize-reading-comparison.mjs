/** Summarize every attempted run, including failures; never replace a failed result. */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const directory = process.argv[2]
if (!directory) throw new Error('Pass the directory produced by profile-reading-comparison.ps1')
const rows = []
for (const name of (await readdir(directory))
  .filter((name) => /^(sumatra|ieum)-(pdf|epub)-ui-run\d+\.json$/.test(name))
  .sort()) {
  const run = JSON.parse(await readFile(join(directory, name), 'utf8'))
  const native = name.startsWith('sumatra-')
  const samples = run.samples.map((s) => ({
    step: s.step ?? s.phase,
    elapsedMs: s.elapsedMs,
    privateMiB: native
      ? s.privateBytes / 1048576
      : s.processes.reduce((sum, p) => sum + p.memory.privateBytes, 0) / 1024,
  }))
  const settled = samples.find((s) => s.step === 'settled')
  const first = samples.find((s) => s.step === 0)
  const last = samples.find((s) => s.step === 60)
  const commands = run.visited?.map((v) => v.commandMs) ?? []
  rows.push({
    report: name,
    application: native
      ? `SumatraPDF${run.version ? ` ${run.version}` : ''}`
      : 'IeumOffice local branch',
    format: name.includes('-pdf-') ? 'pdf' : 'epub',
    completed: run.completed === true,
    failure: run.failure ?? null,
    readyMs: run.readyMs,
    readyCriterion: run.readyCriterion,
    firstCanvasMs: run.firstCanvasMs ?? null,
    observedPeakPrivateMiB: Math.max(...samples.map((s) => s.privateMiB)),
    settledPrivateMiB: settled?.privateMiB ?? null,
    navigationWallMs: first && last ? last.elapsedMs - first.elapsedMs : null,
    navigationCommandsCompleted: commands.length,
    commandP50Ms: quantile(commands, 0.5),
    commandP95Ms: quantile(commands, 0.95),
    commandMaxMs: commands.length ? Math.max(...commands) : null,
    samplingTotalMs: run.samples.reduce((sum, s) => sum + (s.samplingMs ?? 0), 0),
    inputUnchanged: run.inputUnchanged,
    display: run.display ?? run.screenshot ?? null,
  })
}

function quantile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = (sorted.length - 1) * fraction
  const left = Math.floor(at)
  return sorted[left] + (sorted[Math.ceil(at)] - sorted[left]) * (at - left)
}

const groups = []
for (const format of ['pdf', 'epub'])
  for (const native of [true, false]) {
    const group = rows.filter(
      (r) => r.format === format && r.application.startsWith(native ? 'Sumatra' : 'Ieum'),
    )
    if (!group.length) continue
    const distribution = (key) => {
      const values = group.map((r) => r[key]).filter((v) => typeof v === 'number')
      if (!values.length) return { min: null, median: null, max: null, n: 0 }
      return {
        min: Math.min(...values),
        median: quantile(values, 0.5),
        max: Math.max(...values),
        n: values.length,
      }
    }
    groups.push({
      application: group[0].application,
      format,
      attempted: group.length,
      completed: group.filter((r) => r.completed).length,
      readyMs: distribution('readyMs'),
      firstCanvasMs: distribution('firstCanvasMs'),
      observedPeakPrivateMiB: distribution('observedPeakPrivateMiB'),
      settledPrivateMiB: distribution('settledPrivateMiB'),
      navigationWallMs: distribution('navigationWallMs'),
    })
  }
const summary = {
  conditions: {
    repetitions: 'All attempted runs, including failures',
    osCache: 'Warm OS cache; not a cold-boot benchmark',
    sequence: '60 proportional moves from start to end and back, 200 ms dwell, then 3 s settle',
    pdf: 'Same page numbers; Ieum 100% at DPR 1, Sumatra 75% at 96 DPI',
    epub: 'Different pagination: Ieum TOC progress versus Sumatra page progress; not identical paragraphs',
    ready:
      'Sumatra navigation acknowledgement versus Ieum first PDF canvas / complete EPUB chapter iframe; not pixel-identical readiness',
    memory:
      'Windows private committed memory; Electron sums all its app processes. Observed samples, not a guarantee of the absolute peak. Dedicated GPU VRAM is not measured.',
    timing:
      'Commands and wall time include automation overhead; they do not measure FPS or input-to-paint latency.',
  },
  groups,
  rows,
}
await writeFile(join(resolve(directory), 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(groups, null, 2))
