// The edit frame on top of the PDF viewer (spec 3.3, design system 5.6): the edit
// bar [Pen][Highlighter][Text box][Sign] (the shell adds the round [AI] at its right
// end only when AI is on), undo/redo in the app bar, the frame's More-sheet entries,
// the Save As sheet, and the seven feature slots joined in.
import './pdfEdit.css'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { IconProps } from '../../../components/icons/svgIcon'
import type { MobileStringKey } from '../../../i18n/strings'
import type { EditorQuickActionItem } from '../../../shell/EditorShell'
import { pdfPageGeom, type PdfWorkspaceChrome, type PdfWorkspaceContext } from '../view'
import type { PdfEditSession } from './editSession'
import {
  PDF_FEATURE_ORDER,
  PDF_FEATURES,
  usePdfFeatureChromes,
  type PdfFeatureSet,
} from './features'
import {
  IconPdfHighlighter,
  IconPdfLink,
  IconPdfPages,
  IconPdfPen,
  IconPdfSign,
  IconPdfTextBox,
} from './icons'
import { PdfSaveAsSheet } from './PdfSaveAsSheet'
import {
  PDF_MORE_FEATURES,
  PDF_TOOL_FEATURES,
  type PdfAnnotationChoice,
  type PdfFeatureContext,
  type PdfFeatureId,
  type PdfMoreFeatureId,
  type PdfToolId,
} from './types'

interface FrameEntry {
  readonly label: MobileStringKey
  readonly Icon: (props: IconProps) => ReactNode
}

/** The bar, in order (design system 5.6: these four and [AI] only). */
const TOOLS: readonly PdfToolId[] = ['pen', 'highlighter', 'textbox', 'sign']

const TOOL_ENTRIES: Readonly<Record<PdfToolId, FrameEntry>> = {
  pen: { label: 'pdfEditPen', Icon: IconPdfPen },
  highlighter: { label: 'pdfEditHighlighter', Icon: IconPdfHighlighter },
  textbox: { label: 'pdfEditTextBox', Icon: IconPdfTextBox },
  sign: { label: 'pdfEditSign', Icon: IconPdfSign },
}

const MORE_ENTRIES: Readonly<Record<PdfMoreFeatureId, FrameEntry>> = {
  pages: { label: 'pdfEditPages', Icon: IconPdfPages },
  link: { label: 'pdfEditLink', Icon: IconPdfLink },
}

type ChoiceResolver = (choice: PdfAnnotationChoice | null) => void

/**
 * The `useExtension` hook of the viewer Workspace (view/startPdfDocument.tsx) for one
 * edit session. Same function for every document model of that session.
 */
export function createPdfEditExtension(
  session: PdfEditSession,
  features: PdfFeatureSet = PDF_FEATURES,
): (ctx: PdfWorkspaceContext) => PdfWorkspaceChrome {
  return function usePdfEditExtension(ctx: PdfWorkspaceContext): PdfWorkspaceChrome {
    const { model, mode, canEdit, lang, t, viewer } = ctx
    const edits = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot)
    const editing = mode === 'edit' && canEdit
    const [activeTool, setActiveTool] = useState<PdfToolId | null>(null)
    useEffect(() => {
      if (!editing) setActiveTool(null)
    }, [editing])

    // Save As asks here while the Workspace is mounted
    const [askOpen, setAskOpen] = useState(false)
    const resolverRef = useRef<ChoiceResolver | null>(null)
    const answer = useCallback((choice: PdfAnnotationChoice | null) => {
      const resolve = resolverRef.current
      resolverRef.current = null
      setAskOpen(false)
      resolve?.(choice)
    }, [])
    useEffect(() => {
      session.setAnnotationPrompt(
        () =>
          new Promise<PdfAnnotationChoice | null>((resolve) => {
            resolverRef.current?.(null)
            resolverRef.current = resolve
            setAskOpen(true)
          }),
      )
      return () => {
        session.setAnnotationPrompt(null)
        resolverRef.current?.(null)
        resolverRef.current = null
      }
    }, [])

    const pageGeom = useCallback(
      (pageIndex: number) => pdfPageGeom(model, pageIndex, edits.rotations.get(pageIndex) ?? 0),
      [model, edits.rotations],
    )
    const contextFor = (feature: PdfFeatureId): PdfFeatureContext => ({
      feature,
      model,
      mode,
      canEdit,
      editing,
      lang,
      t,
      viewer,
      edits,
      activeTool,
      toolActive: activeTool !== null && PDF_TOOL_FEATURES[activeTool] === feature,
      setActiveTool,
      pageGeom,
      services: session.services,
    })
    const chromes = usePdfFeatureChromes(features, contextFor)

    const quickActions: EditorQuickActionItem[] = editing
      ? [
          ...TOOLS.map((tool): EditorQuickActionItem => {
            const { label, Icon } = TOOL_ENTRIES[tool]
            const on = activeTool === tool
            return {
              id: `pdfTool-${tool}`,
              label: t(label),
              icon: (
                <span className="m-pdf-tool-icon" data-active={on} data-testid={`pdf-tool-${tool}`}>
                  <Icon size={20} />
                </span>
              ),
              onPress: () => {
                setActiveTool(on ? null : tool)
                chromes[PDF_TOOL_FEATURES[tool]].onToolPress?.(!on)
              },
            }
          }),
          { id: 'undo', label: t('undo'), onPress: () => void session.store.undo() },
          { id: 'redo', label: t('redo'), onPress: () => void session.store.redo() },
        ]
      : []

    const moreItems: EditorQuickActionItem[] = [
      ...(editing
        ? PDF_MORE_FEATURES.map((id): EditorQuickActionItem => {
            const { label, Icon } = MORE_ENTRIES[id]
            return {
              id: `pdfEdit-${id}`,
              label: t(label),
              icon: <Icon size={19} />,
              onPress: () => chromes[id].onMorePress?.(),
            }
          })
        : []),
      ...PDF_FEATURE_ORDER.flatMap((id) => chromes[id].moreItems ?? []),
    ]

    const overlayIds = PDF_FEATURE_ORDER.filter((id) => chromes[id].renderPageOverlay)
    const annotationMode = PDF_FEATURE_ORDER.map((id) => chromes[id].annotationMode).find(
      (value) => value !== undefined,
    )
    const rotationDeltas = useMemo(
      () => (edits.rotations.size > 0 ? edits.rotations : undefined),
      [edits.rotations],
    )

    return {
      quickActions,
      moreItems,
      stageExtras: (
        <>
          {PDF_FEATURE_ORDER.map((id) =>
            chromes[id].stageExtras ? (
              <Fragment key={id}>{chromes[id].stageExtras}</Fragment>
            ) : null,
          )}
          <PdfSaveAsSheet
            open={askOpen}
            t={t}
            onChoose={(choice) => answer(choice)}
            onCancel={() => answer(null)}
          />
        </>
      ),
      renderPageOverlay:
        overlayIds.length > 0
          ? (page) => (
              <>
                {overlayIds.map((id) => (
                  <Fragment key={id}>{chromes[id].renderPageOverlay!(page)}</Fragment>
                ))}
              </>
            )
          : undefined,
      rotationDeltas,
      annotationMode,
    }
  }
}
