import type { EditorKind } from '../editorKind'
import { htmlEditorKind } from './kind'

/** Editor kinds of track T4 (HTML); the registry already spreads this list. */
export const htmlEditorKinds: readonly EditorKind[] = [htmlEditorKind]
