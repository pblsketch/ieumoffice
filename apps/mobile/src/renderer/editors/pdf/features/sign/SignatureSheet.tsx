// The signature sheet (spec 3.6): the remembered signatures (pick or forget), then a
// new one drawn on the pad (finger and pen both draw inside the pad) or taken from a
// picture. Colors are the PC signature swatches. A new signature is remembered on the
// device unless the switch is turned off (PC "Save signature for reuse").
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Params } from '@genoffice/i18n'
import { IconClose } from '../../../../components/MobileIcons'
import { Sheet } from '../../../../components/Sheet'
import type { MobileStringKey } from '../../../../i18n/strings'
import { pickImageFile } from '../../../pickPicture'
import { cssRgb } from '../../../../../../../pdf/src/renderer/DrawLayer'
import {
  SIGN_COLORS,
  signColorName,
  type SignColorName,
} from '../../../../../../../pdf/src/renderer/signature-colors'
import { PAD_H, PAD_STROKE, PAD_W, type Rgb, type StrokeSignature } from './place'
import { canvasToSignature, fileToCanvas, toBlackAndWhite } from './picture'
import {
  forgetSignature,
  loadSavedSignatures,
  rememberSignature,
  type SavedSignature,
  type SignatureData,
} from './store'

type Translate = (key: MobileStringKey, params?: Params) => string

const COLOR_LABEL: Readonly<Record<SignColorName, MobileStringKey>> = {
  black: 'pdfSignColorBlack',
  blue: 'pdfSignColorBlue',
  red: 'pdfSignColorRed',
}

/** Pixel density of the pad bitmap over pad coordinates. */
const PAD_DENSITY = 2

function StrokesThumb({ sig, color }: { readonly sig: StrokeSignature; readonly color: Rgb }) {
  return (
    <svg viewBox={`0 0 ${sig.width} ${sig.height}`} preserveAspectRatio="xMidYMid meet">
      {sig.paths.map((p, i) => {
        let d = `M ${p[0]} ${p[1]}`
        for (let j = 2; j + 1 < p.length; j += 2) d += ` L ${p[j]} ${p[j + 1]}`
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={cssRgb(color)}
            strokeWidth={PAD_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}

export interface SignatureSheetProps {
  readonly open: boolean
  readonly t: Translate
  readonly color: Rgb
  /** Set when a signature field asked: the signature is fitted into it. */
  readonly fieldName: string | null
  readonly onColorChange: (color: Rgb) => void
  readonly onCancel: () => void
  readonly onConfirm: (sig: SignatureData) => void
}

export function SignatureSheet({
  open,
  t,
  color,
  fieldName,
  onColorChange,
  onCancel,
  onConfirm,
}: SignatureSheetProps) {
  const [mode, setMode] = useState<'draw' | 'picture'>('draw')
  const [saved, setSaved] = useState<SavedSignature[]>([])
  const [remember, setRemember] = useState(true)
  const [hasInk, setHasInk] = useState(false)
  const [picture, setPicture] = useState<HTMLCanvasElement | null>(null)
  const [bw, setBw] = useState(false)
  const [pictureFailed, setPictureFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pathsRef = useRef<number[][]>([])
  const currentRef = useRef<number[] | null>(null)
  const colorName = signColorName(color)

  useEffect(() => {
    if (!open) return
    setSaved(loadSavedSignatures())
    setMode('draw')
    setRemember(true)
    setHasInk(false)
    setPicture(null)
    setBw(false)
    setPictureFailed(false)
    pathsRef.current = []
    currentRef.current = null
  }, [open])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(PAD_DENSITY, 0, 0, PAD_DENSITY, 0, 0)
    ctx.strokeStyle = cssRgb(color)
    ctx.lineWidth = PAD_STROKE
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const p of pathsRef.current) {
      ctx.beginPath()
      ctx.moveTo(p[0]!, p[1]!)
      for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!)
      ctx.stroke()
    }
  }, [color])

  useEffect(() => {
    if (open && mode === 'draw') redraw()
  }, [open, mode, redraw])

  /** Pointer → pad coordinates (the PC pad size, whatever the pad's width on screen). */
  const padPoint = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = e.currentTarget.getBoundingClientRect()
    const sx = box.width > 0 ? PAD_W / box.width : 1
    const sy = box.height > 0 ? PAD_H / box.height : 1
    const x = Math.min(Math.max((e.clientX - box.left) * sx, 0), PAD_W)
    const y = Math.min(Math.max((e.clientY - box.top) * sy, 0), PAD_H)
    return [x, y]
  }

  const padDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    currentRef.current = padPoint(e)
    pathsRef.current = [...pathsRef.current, currentRef.current]
  }
  const padMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!currentRef.current) return
    currentRef.current.push(...padPoint(e))
    redraw()
  }
  const padUp = () => {
    currentRef.current = null
    setHasInk(pathsRef.current.some((p) => p.length >= 4))
  }
  const clearPad = () => {
    pathsRef.current = []
    currentRef.current = null
    setHasInk(false)
    redraw()
  }

  const processed = useMemo(() => {
    if (!picture) return null
    const canvas = bw ? toBlackAndWhite(picture) : picture
    return { canvas, url: canvas.toDataURL('image/png') }
  }, [picture, bw])

  const choosePicture = async () => {
    const file = await pickImageFile()
    if (!file) return
    const canvas = await fileToCanvas(file)
    setPictureFailed(canvas === null)
    if (canvas) setPicture(canvas)
  }

  const finish = (sig: SignatureData) => {
    if (remember) setSaved(rememberSignature(sig))
    onConfirm(sig)
  }

  const confirm = () => {
    if (mode === 'draw') {
      const paths = pathsRef.current.filter((p) => p.length >= 4)
      if (paths.length > 0) finish({ kind: 'strokes', paths, width: PAD_W, height: PAD_H })
      return
    }
    const sig = processed ? canvasToSignature(processed.canvas) : null
    if (sig) finish(sig)
    else setPictureFailed(true)
  }

  const canConfirm = mode === 'draw' ? hasInk : processed !== null

  return (
    <Sheet
      open={open}
      title={t('pdfSignTitle')}
      closeLabel={t('cancel')}
      onClose={onCancel}
      initialDetent="large"
      testId="pdf-sign-sheet"
    >
      <div className="mobile-choice-sheet m-pdf-sign">
        {fieldName !== null && (
          <p className="m-pdf-sign-note" data-testid="pdf-sign-field-hint">
            {t('pdfSignFieldHint', { field: fieldName })}
          </p>
        )}
        {saved.length > 0 && (
          <section className="m-pdf-sign-saved" aria-label={t('pdfSignSaved')}>
            <h3 className="m-pdf-sign-label">{t('pdfSignSaved')}</h3>
            <div className="m-pdf-sign-saved-row">
              {saved.map((s) => (
                <div key={s.id} className="m-pdf-sign-saved-item">
                  <button
                    type="button"
                    className="m-pdf-sign-saved-pick"
                    aria-label={t('pdfSignUseSaved')}
                    onClick={() => onConfirm(s.data)}
                    data-testid="pdf-sign-saved-pick"
                  >
                    {s.data.kind === 'image' ? (
                      <img src={`data:image/png;base64,${s.data.image}`} alt="" />
                    ) : (
                      <StrokesThumb sig={s.data} color={color} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="mobile-icon-btn m-pdf-sign-saved-forget"
                    aria-label={t('pdfSignForget')}
                    onClick={() => setSaved(forgetSignature(s.id))}
                    data-testid="pdf-sign-saved-forget"
                  >
                    <IconClose size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="m-pdf-sign-tabs" role="tablist">
          {(['draw', 'picture'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className="mobile-choice-btn m-pdf-sign-tab"
              onClick={() => setMode(m)}
              data-testid={`pdf-sign-tab-${m}`}
            >
              {t(m === 'draw' ? 'pdfSignDraw' : 'pdfSignPicture')}
            </button>
          ))}
        </div>
        {mode === 'draw' ? (
          <>
            <div className="m-pdf-sign-colors" role="group" aria-label={t('pdfSignColor')}>
              {SIGN_COLORS.map(({ name, rgb }) => (
                <button
                  key={name}
                  type="button"
                  className="m-pdf-sign-swatch"
                  aria-label={t(COLOR_LABEL[name])}
                  aria-pressed={colorName === name}
                  onClick={() => onColorChange([...rgb])}
                  data-testid={`pdf-sign-color-${name}`}
                >
                  <span style={{ background: cssRgb(rgb) }} />
                </button>
              ))}
            </div>
            <canvas
              ref={canvasRef}
              className="m-pdf-sign-pad"
              width={PAD_W * PAD_DENSITY}
              height={PAD_H * PAD_DENSITY}
              role="img"
              aria-label={t('pdfSignPadLabel')}
              onPointerDown={padDown}
              onPointerMove={padMove}
              onPointerUp={padUp}
              onPointerCancel={padUp}
              data-testid="pdf-sign-pad"
            />
            <p className="m-pdf-sign-note">{t('pdfSignPadHint')}</p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="m-pdf-sign-picture"
              onClick={() => void choosePicture()}
              data-testid="pdf-sign-pick-picture"
            >
              {processed ? <img src={processed.url} alt="" /> : t('pdfSignPickPicture')}
            </button>
            {pictureFailed && (
              <p className="m-pdf-sign-note" role="alert">
                {t('pdfSignPictureFailed')}
              </p>
            )}
            <label className="m-pdf-sign-switch">
              <span>{t('pdfSignBw')}</span>
              <input
                type="checkbox"
                className="mobile-switch"
                checked={bw}
                disabled={!picture}
                onChange={(e) => setBw(e.target.checked)}
              />
            </label>
          </>
        )}
        <label className="m-pdf-sign-switch">
          <span>{t('pdfSignRemember')}</span>
          <input
            type="checkbox"
            className="mobile-switch"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            data-testid="pdf-sign-remember"
          />
        </label>
        <div className="mobile-row-actions">
          {mode === 'draw' ? (
            <button
              type="button"
              className="mobile-touch-btn mobile-btn-secondary"
              onClick={clearPad}
              disabled={!hasInk}
              data-testid="pdf-sign-clear"
            >
              {t('pdfSignClear')}
            </button>
          ) : (
            picture && (
              <button
                type="button"
                className="mobile-touch-btn mobile-btn-secondary"
                onClick={() => {
                  setPicture(null)
                  setBw(false)
                }}
              >
                {t('pdfSignClear')}
              </button>
            )
          )}
          <button
            type="button"
            className="mobile-touch-btn mobile-btn-primary m-pdf-sign-confirm"
            onClick={confirm}
            disabled={!canConfirm}
            data-testid="pdf-sign-confirm"
          >
            {t('pdfSignPlace')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
