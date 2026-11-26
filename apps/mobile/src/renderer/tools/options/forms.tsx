/**
 * The options sheet form of each tool (spec 5.3): the PC tools window's
 * choices, labels and defaults, writing the raw keys `checkOptions` reads.
 * Merge, reverse and text export take no options and draw nothing.
 */
import { DEFAULT_ANNOT_KINDS, MAX_PASSWORD_BYTES } from '@genoffice/pdf-ops/tool-rules'
import {
  COMPRESS_LEVELS,
  PDF_TOOL_ANNOT_KINDS,
  PDF_TOOL_MARGINS,
  PDF_TOOL_PAPERS,
  type PdfToolAnnotKind,
  type PdfToolMargin,
} from '@genoffice/pdf-ops/tool-ids'
import { useMobileLocale, type MobileStringKey } from '../../i18n'
import { CheckGroup, ChoiceGroup, Note, TextField, ToggleRow } from './fields'
import type { ToolOptionsFormProps } from './index'
import { SplitForm } from './SplitForm'
import './options.css'

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const pageCountText = (t: (key: MobileStringKey, p?: { n: number }) => string, n: number) =>
  t(n === 1 ? 'pdfToolsPageCountOne' : 'pdfToolsPageCount', { n })

const LEVEL_TEXT: Record<(typeof COMPRESS_LEVELS)[number], MobileStringKey> = {
  light: 'pdfToolsLevelLight',
  medium: 'pdfToolsLevelMedium',
  strong: 'pdfToolsLevelStrong',
}

const KIND_TEXT: Record<PdfToolAnnotKind, MobileStringKey> = {
  comments: 'pdfToolsKindComments',
  highlights: 'pdfToolsKindHighlights',
  drawings: 'pdfToolsKindDrawings',
  stamps: 'pdfToolsKindStamps',
  links: 'pdfToolsKindLinks',
  other: 'pdfToolsKindOther',
}

const MARGIN_TEXT: Record<PdfToolMargin, MobileStringKey> = {
  none: 'pdfToolsOptMarginNone',
  small: 'pdfToolsOptMarginSmall',
  large: 'pdfToolsOptMarginLarge',
}

/** The form of `tool`'s options sheet */
export function ToolOptionsForm(props: ToolOptionsFormProps) {
  const body = formBody(props)
  if (!body) return null
  return (
    <div className="pdf-tools-form" data-testid="pdf-tools-options-form">
      {body}
    </div>
  )
}

function formBody(props: ToolOptionsFormProps) {
  switch (props.tool) {
    case 'split':
      return <SplitForm {...props} />
    case 'extract':
      return <ExtractForm {...props} />
    case 'rotate':
      return <RotateForm {...props} />
    case 'compress':
      return <CompressForm {...props} />
    case 'encrypt':
      return <EncryptForm {...props} />
    case 'decrypt':
      return <DecryptForm {...props} />
    case 'stripAnnots':
      return <StripAnnotsForm {...props} />
    case 'imagesToPdf':
      return <ImagesForm {...props} />
    case 'repair':
      return <RepairNote />
    default:
      return null
  }
}

function ExtractForm({ pageCount, raw, onChange, error }: ToolOptionsFormProps) {
  const { t } = useMobileLocale()
  return (
    <TextField
      label={t('pdfToolsOptRange')}
      value={str(raw.pages)}
      placeholder={`1-${pageCount}`}
      hint={pageCountText(t, pageCount)}
      error={error === 'range' ? error : null}
      onChange={(pages) => onChange({ ...raw, pages })}
    />
  )
}

function RotateForm({ raw, onChange }: ToolOptionsFormProps) {
  const { t } = useMobileLocale()
  const rotation = raw.rotation === 180 || raw.rotation === 270 ? raw.rotation : 90
  return (
    <ChoiceGroup
      legend={t('pdfToolsOptRotation')}
      value={rotation}
      onPick={(next) => onChange({ ...raw, rotation: next })}
      choices={[
        { value: 90, label: t('pdfToolsOptRotateRight') },
        { value: 180, label: t('pdfToolsOpt180') },
        { value: 270, label: t('pdfToolsOptRotateLeft') },
      ]}
    />
  )
}

function CompressForm({ raw, onChange }: ToolOptionsFormProps) {
  const { t } = useMobileLocale()
  const level = (COMPRESS_LEVELS as readonly unknown[]).includes(raw.compressLevel)
    ? (raw.compressLevel as (typeof COMPRESS_LEVELS)[number])
    : 'medium'
  return (
    <>
      <ChoiceGroup
        legend={t('pdfToolsOptLevel')}
        value={level}
        onPick={(next) => onChange({ ...raw, compressLevel: next })}
        choices={COMPRESS_LEVELS.map((value) => ({ value, label: t(LEVEL_TEXT[value]) }))}
      />
      <Note>{t('pdfToolsNoteCompress')}</Note>
    </>
  )
}

const tooLong = (text: string) => new TextEncoder().encode(text).length > MAX_PASSWORD_BYTES

function EncryptForm({ raw, onChange, error }: ToolOptionsFormProps) {
  const { t } = useMobileLocale()
  const password = str(raw.password)
  const confirm = str(raw.passwordConfirm)
  const restrict = raw.restrict === true
  const permission = str(raw.permissionPassword)
  // every change keeps the repeat field a string, so it is always compared
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...raw, passwordConfirm: confirm, ...patch })

  // which field the error is about, in the order checkOptions checks them
  const passwordError =
    (error === 'password-empty' && !password) || (error === 'password-long' && tooLong(password))
      ? error
      : null
  const confirmError = error === 'password-mismatch' ? error : null
  const permissionError =
    restrict &&
    ((error === 'password-empty' && !!password && !permission) ||
      (error === 'password-long' && !tooLong(password) && tooLong(permission)) ||
      error === 'password-same')
      ? error
      : null

  return (
    <>
      <TextField
        secret
        label={t('pdfToolsOptPassword')}
        value={password}
        error={passwordError}
        onChange={(value) => set({ password: value })}
      />
      <TextField
        secret
        label={t('pdfToolsOptPasswordConfirm')}
        value={confirm}
        error={confirmError}
        onChange={(value) => set({ passwordConfirm: value })}
      />
      <ToggleRow
        label={t('pdfToolsOptRestrict')}
        checked={restrict}
        onChange={(on) => {
          if (on) {
            set({ restrict: true })
            return
          }
          // a permission password left behind would still be checked and kept in memory
          const next: Record<string, unknown> = {
            ...raw,
            passwordConfirm: confirm,
            restrict: false,
          }
          delete next.permissionPassword
          onChange(next)
        }}
      />
      {restrict && (
        <TextField
          secret
          label={t('pdfToolsOptPermissionPassword')}
          value={permission}
          error={permissionError}
          hint={t('pdfToolsNoteRestrict')}
          onChange={(value) => set({ permissionPassword: value })}
        />
      )}
      <Note>{t('pdfToolsNoteEncrypt')}</Note>
    </>
  )
}

function DecryptForm({ raw, onChange, error }: ToolOptionsFormProps) {
  const { t } = useMobileLocale()
  return (
    <>
      <TextField
        secret
        label={t('pdfToolsOptCurrentPassword')}
        value={str(raw.password)}
        error={error === 'password-empty' ? error : null}
        onChange={(password) => onChange({ ...raw, password })}
      />
      <Note>{t('pdfToolsNoteDecrypt')}</Note>
    </>
  )
}

function StripAnnotsForm({ pageCount, raw, onChange, error }: ToolOptionsFormProps) {
  const { t } = useMobileLocale()
  const chosen: readonly PdfToolAnnotKind[] = Array.isArray(raw.annotKinds)
    ? PDF_TOOL_ANNOT_KINDS.filter((kind) => (raw.annotKinds as unknown[]).includes(kind))
    : DEFAULT_ANNOT_KINDS
  return (
    <>
      <CheckGroup
        legend={t('pdfToolsOptAnnotKinds')}
        choices={PDF_TOOL_ANNOT_KINDS.map((value) => ({ value, label: t(KIND_TEXT[value]) }))}
        chosen={chosen}
        error={error === 'no-kinds' ? error : null}
        onToggle={(kind, on) =>
          onChange({
            ...raw,
            annotKinds: PDF_TOOL_ANNOT_KINDS.filter((k) => (k === kind ? on : chosen.includes(k))),
          })
        }
      />
      <TextField
        label={t('pdfToolsOptCleanPages')}
        value={str(raw.applyPages)}
        placeholder={`1-${pageCount}`}
        hint={pageCountText(t, pageCount)}
        error={error === 'range' ? error : null}
        onChange={(applyPages) => onChange({ ...raw, applyPages })}
      />
      <Note>{t('pdfToolsNoteStripAnnots')}</Note>
    </>
  )
}

function ImagesForm({ raw, onChange }: ToolOptionsFormProps) {
  const { t } = useMobileLocale()
  const paper =
    raw.imagePaper === 'image' || (PDF_TOOL_PAPERS as readonly unknown[]).includes(raw.imagePaper)
      ? (raw.imagePaper as (typeof PDF_TOOL_PAPERS)[number] | 'image')
      : 'A4'
  const margin = (PDF_TOOL_MARGINS as readonly unknown[]).includes(raw.margin)
    ? (raw.margin as PdfToolMargin)
    : 'small'
  return (
    <>
      <ChoiceGroup
        legend={t('pdfToolsOptPaper')}
        columns={2}
        value={paper}
        onPick={(next) => onChange({ ...raw, imagePaper: next })}
        choices={[
          ...PDF_TOOL_PAPERS.map((value) => ({ value, label: value })),
          { value: 'image' as const, label: t('pdfToolsOptImageSize') },
        ]}
      />
      {/* pages the size of each picture have no margin */}
      {paper !== 'image' && (
        <ChoiceGroup
          legend={t('pdfToolsOptMargin')}
          value={margin}
          onPick={(next) => onChange({ ...raw, margin: next })}
          choices={PDF_TOOL_MARGINS.map((value) => ({ value, label: t(MARGIN_TEXT[value]) }))}
        />
      )}
    </>
  )
}

function RepairNote() {
  const { t } = useMobileLocale()
  return <Note>{t('pdfToolsNoteRepair')}</Note>
}
