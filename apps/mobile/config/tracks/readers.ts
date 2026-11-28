// Build settings of track T5 readers (epub, pptx). Owned by that track.
// The PPTX engine's Node-only imports get mobile stand-ins, scoped to the engine's own src.
import { pptxNodeShims } from '../../src/renderer/editors/readers/build/pptxNodeShims'
import type { TrackBuild } from './types'

export const readersBuild: TrackBuild = { plugins: [pptxNodeShims()] }
