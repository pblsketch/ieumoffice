import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { applyPatch } from '../scripts/rhwp-patches.mjs'

const sourceRoot = resolve('node_modules/.cache/rhwp-studio/v0.9.0/rhwp-studio/src/view')
const rendererPath = resolve(sourceRoot, 'page-renderer.ts')

describe.skipIf(!existsSync(rendererPath))('scroll planning in the pinned studio', () => {
  it('plans unseen pages conservatively without a WASM tree query', () => {
    const patched = applyPatch('studio-scroll-surface-planning', readFileSync(rendererPath, 'utf8'))
    const method = patched.slice(
      patched.indexOf('  peekCanvasSurfaceLayerCount('),
      patched.indexOf('  getCanvasSurfaceLayerCount('),
    )
    const code = ts.transpileModule(`return class { ${method} }`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
    const Class = new Function(code)()
    const renderer = new Class()
    renderer.backend = 'canvas2d'
    renderer.surfaceLayerCountCache = new Map()
    renderer.layerSummaryCache = new Map()
    renderer.getLayerPlaneSummaryFromTree = () => {
      throw new Error('unexpected WASM query')
    }
    expect(renderer.peekCanvasSurfaceLayerCount(500)).toBe(5)
    renderer.surfaceLayerCountCache.set(500, 1)
    expect(renderer.peekCanvasSurfaceLayerCount(500)).toBe(1)
    renderer.backend = 'canvaskit'
    expect(renderer.peekCanvasSurfaceLayerCount(501)).toBe(1)
  })

  it('applies scroll scheduling changes to the pinned source with no syntax errors', () => {
    const path = resolve(sourceRoot, 'canvas-view.ts')
    const patched = applyPatch('studio-scroll-render-scheduling', readFileSync(path, 'utf8'))
    const result = ts.transpileModule(patched, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    })
    expect(
      result.diagnostics?.filter((entry) => entry.category === ts.DiagnosticCategory.Error),
    ).toEqual([])
  })
})
