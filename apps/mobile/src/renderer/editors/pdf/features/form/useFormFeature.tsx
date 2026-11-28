// The form feature's hook (spec 3.8): reads the PC form catalog and the file's saved
// static fills per document, feeds field names to op planning, and adds the page
// overlay, the sheets, the floating bars and the check/cross rows of [⋯].
// The PC mark painter (static-form-fill.ts) names its result type through the PC
// SignatureDialog module; its window globals are declared in src/env/pdf.d.ts for the
// type checker only, and nothing here calls them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderStaticFormMark } from '../../../../../../../pdf/src/renderer/static-form-fill'
import type { FormValueInput, StaticFormFillRecord } from '../../../../../../../pdf/src/shared/ipc'
import { useBackLayer } from '../../../../shell/backStack'
import type { EditorQuickActionItem } from '../../../../shell/EditorShell'
import type { PdfFeatureChrome, PdfFeatureContext } from '../../edit/types'
import { AnnotationMode } from '../../view/pdfjs'
import { FormOverlay } from './FormOverlay'
import {
  liveFormCatalog,
  loadFormCatalog,
  formOpContext,
  pageBoxShapes,
  pendingFormMarks,
  planFormMark,
  readSavedStaticFormFills,
  signatureTarget,
  signedWidgetKeys,
  tapValue,
  widgetState,
  type FormCatalog,
  type FormMarkKind,
  type FormMarkPainter,
  type FormWidget,
} from './formModel'
import { FormChoiceSheet, FormMarkBar, FormPlaceBar, FormTextSheet } from './FormSheets'
import { IconFormCheck, IconFormCross } from './icons'

export interface FormFeatureDeps {
  /** Paints a check/cross (PC `renderStaticFormMark`; tests pass a stand-in, jsdom has no canvas). */
  readonly renderMark?: FormMarkPainter
  /** Reads the file's static fills (PC `readStaticFormFills` rules). */
  readonly readSavedFills?: (bytes: Uint8Array) => Promise<StaticFormFillRecord[]>
}

const EMPTY: readonly never[] = []

export function createUseFormFeature(deps: FormFeatureDeps = {}) {
  const paint: FormMarkPainter = deps.renderMark ?? renderStaticFormMark
  const readSavedFills = deps.readSavedFills ?? readSavedStaticFormFills

  return function useFormFeature(ctx: PdfFeatureContext): PdfFeatureChrome {
    const { model, editing, edits, services, t, activeTool } = ctx
    const [catalog, setCatalog] = useState<FormCatalog | null>(null)
    const catalogRef = useRef<FormCatalog | null>(null)
    const [textTarget, setTextTarget] = useState<FormWidget | null>(null)
    const [choiceTarget, setChoiceTarget] = useState<FormWidget | null>(null)
    const [placing, setPlacing] = useState<FormMarkKind | null>(null)
    const [selectedMark, setSelectedMark] = useState<string | null>(null)
    const cancelPlacing = useCallback(() => setPlacing(null), [])
    useBackLayer(placing !== null, cancelPlacing)

    // the catalog of the document on screen (replaced after every save)
    useEffect(() => {
      let current = true
      catalogRef.current = null
      setCatalog(null)
      void loadFormCatalog(model.proxy).then((next) => {
        if (!current) return
        catalogRef.current = next
        setCatalog(next)
      })
      return () => {
        current = false
      }
    }, [model])

    // the file's own static fills, so a save adds to them instead of replacing them
    useEffect(() => {
      let current = true
      services.setRequestExtras({ savedStaticFormFills: undefined })
      void readSavedFills(model.originalBytes).then((records) => {
        if (current) services.setRequestExtras({ savedStaticFormFills: records })
      })
      return () => {
        current = false
      }
    }, [model, services])

    // AcroForm names (and radio groups new buttons may join) for every op plan
    useEffect(
      () =>
        services.registerOpContext(() =>
          formOpContext(catalogRef.current, services.getEdits().formWidgetEdits),
        ),
      [services],
    )

    // leaving edit mode or picking a bar tool ends whatever the form layer was doing
    useEffect(() => {
      if (editing && activeTool === null) return
      setPlacing(null)
      setSelectedMark(null)
      if (!editing) {
        setTextTarget(null)
        setChoiceTarget(null)
      }
    }, [editing, activeTool])

    const live = useMemo(
      () => liveFormCatalog(catalog, edits.formWidgetEdits),
      [catalog, edits.formWidgetEdits],
    )
    const signed = useMemo(() => signedWidgetKeys(edits.drawings), [edits.drawings])
    const marks = useMemo(() => pendingFormMarks(edits.imageEdits), [edits.imageEdits])
    const marksByPage = useMemo(() => {
      const out = new Map<number, typeof marks>()
      for (const mark of marks) out.set(mark.pageIndex, [...(out.get(mark.pageIndex) ?? []), mark])
      return out
    }, [marks])
    // undo can take the selected mark away
    useEffect(() => {
      if (selectedMark && !marks.some((m) => m.id === selectedMark)) setSelectedMark(null)
    }, [marks, selectedMark])

    const interactive = editing && activeTool === null

    const setValue = useCallback(
      (value: FormValueInput) => {
        services.dispatch([{ op: 'setFormValue', value }], { coalesceKey: `form:${value.name}` })
      },
      [services],
    )

    const isSigned = useCallback(
      (w: FormWidget) => signed.ids.has(w.id) || signed.names.has(w.fieldName),
      [signed],
    )

    const onWidget = (w: FormWidget) => {
      if (!interactive || w.readOnly) return
      setSelectedMark(null)
      switch (w.kind) {
        case 'checkbox':
        case 'radio': {
          const next = tapValue(w, edits.formEdits)
          if (next) setValue(next)
          return
        }
        case 'text':
          setTextTarget(w)
          return
        case 'choice':
          setChoiceTarget(w)
          return
        case 'signature':
          if (!w.signed && !isSigned(w)) void services.requestSignature(signatureTarget(w))
      }
    }

    const onPlace = (pageIndex: number, vx: number, vy: number) => {
      const kind = placing
      if (!kind) return
      setPlacing(null)
      const placedOn = model
      void planFormMark({
        kind,
        pageIndex,
        geom: ctx.pageGeom(pageIndex),
        vx,
        vy,
        widgets: live?.byPage.get(pageIndex) ?? EMPTY,
        shapes: () => pageBoxShapes(placedOn.proxy, pageIndex),
        paint,
        newId: services.newId,
      }).then((ops) => {
        // the document may have been saved and replaced meanwhile
        if (!ops || services.getModel() !== placedOn) return
        const plan = services.dispatch(ops)
        const added = ops.find((op) => op.op === 'addImageEdit')
        if (plan.failures.length === 0 && added?.id) setSelectedMark(added.id)
      })
    }

    const moreItems: EditorQuickActionItem[] = editing
      ? (['check', 'cross'] as const).map((kind) => ({
          id: kind === 'check' ? 'pdfFormCheck' : 'pdfFormCross',
          label: t(kind === 'check' ? 'pdfFormAddCheck' : 'pdfFormAddCross'),
          icon: kind === 'check' ? <IconFormCheck size={19} /> : <IconFormCross size={19} />,
          onPress: () => {
            ctx.setActiveTool(null)
            setSelectedMark(null)
            setPlacing(kind)
          },
        }))
      : []

    const textValue = textTarget ? widgetState(textTarget, edits.formEdits).value : ''
    const choiceValue = choiceTarget ? widgetState(choiceTarget, edits.formEdits).value : ''
    const labels = {
      signField: t('pdfFormSignField'),
      mark: (kind: FormMarkKind) => t(kind === 'check' ? 'pdfFormCheckMark' : 'pdfFormCrossMark'),
    }

    return {
      moreItems,
      annotationMode:
        catalog && catalog.widgets.length > 0 ? AnnotationMode.ENABLE_FORMS : undefined,
      renderPageOverlay: (page) =>
        page.rendered ? (
          <FormOverlay
            pageIndex={page.pageIndex}
            geom={page.geom}
            scale={page.scale}
            interactive={interactive}
            widgets={live?.byPage.get(page.pageIndex) ?? EMPTY}
            formEdits={edits.formEdits}
            isSigned={isSigned}
            marks={marksByPage.get(page.pageIndex) ?? EMPTY}
            selectedMarkId={selectedMark}
            placing={placing}
            labels={labels}
            onWidget={onWidget}
            onSelectMark={(id) => {
              if (interactive) setSelectedMark(id)
            }}
            onMoveMark={(id, rect) => {
              services.dispatch([{ op: 'setImageEditRect', id, rect }])
            }}
            onPlace={onPlace}
          />
        ) : null,
      stageExtras: (
        <>
          {placing && <FormPlaceBar kind={placing} t={t} onCancel={() => setPlacing(null)} />}
          {selectedMark && !placing && (
            <FormMarkBar
              t={t}
              onDelete={() => {
                services.dispatch([{ op: 'removeImageEdit', id: selectedMark }])
                setSelectedMark(null)
              }}
              onDone={() => setSelectedMark(null)}
            />
          )}
          <FormTextSheet
            widget={editing ? textTarget : null}
            value={textValue}
            t={t}
            onEdit={setValue}
            onInvalidDate={(format) =>
              services.showToast({ message: t('pdfFormDateInvalid', { format }), tone: 'error' })
            }
            onClose={() => setTextTarget(null)}
          />
          <FormChoiceSheet
            widget={editing ? choiceTarget : null}
            value={choiceValue}
            t={t}
            onPick={(value) => {
              const target = choiceTarget
              setChoiceTarget(null)
              if (target && value !== choiceValue) {
                setValue({ name: target.fieldName, kind: 'choice', value })
              }
            }}
            onClose={() => setChoiceTarget(null)}
          />
        </>
      ),
    }
  }
}
