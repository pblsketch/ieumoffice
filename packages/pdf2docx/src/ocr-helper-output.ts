import type { Rect } from './geometry'
import type { OcrRecognition } from './ocr'

interface HelperChar {
  t: string
  b: [number, number, number, number]
}
interface HelperLine {
  t: string
  c: number
  b: [number, number, number, number]
  chars?: HelperChar[]
}
const toRect = (b: [number, number, number, number]): Rect => ({
  x0: b[0],
  y0: b[1],
  x1: b[2],
  y1: b[3],
})

/** One helper protocol for synchronous conversion and asynchronous viewing. */
export function parseHelperOcrOutput(text: string): OcrRecognition | null {
  let parsed: { lines?: HelperLine[]; paper?: number }
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as typeof parsed
  } catch {
    return null
  }
  if (!Array.isArray(parsed.lines)) return null
  return {
    lines: parsed.lines.map((l) => ({
      text: l.t,
      confidence: l.c,
      box: toRect(l.b),
      ...(l.chars ? { chars: l.chars.map((c) => ({ text: c.t, box: toRect(c.b) })) } : {}),
    })),
    ...(typeof parsed.paper === 'number' ? { paperShare: parsed.paper } : {}),
  }
}
