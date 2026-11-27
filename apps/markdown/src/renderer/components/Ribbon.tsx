import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  AiMark,
  Dropdown,
  isSymbolFontFamily,
  QuickPrintButton,
  RibbonCollapseButton,
  RibbonExpandButton,
  aiSubscriptionText,
  useDismissablePopover,
  useRibbonCollapse,
  type PrintPrinterInfo,
  type QuickPrintPrefStore,
} from '@genoffice/ui'
import { useI18n } from '../i18n/locale'
import { SOURCE_VIEW_SHORTCUT } from '../source-view-key'
import { editorFontChoices, useSystemFonts } from '../editor-font'
import { RibbonMenu, RibbonMenuItem } from './RibbonMenu'
import { useAiVisible } from '../ai-visibility'
import { MARKDOWN_THEME_IDS, type MarkdownTheme } from '../../shared/markdown-theme'
import { uiOp } from '../editor/ops'
import {
  applyBlockStyle,
  BLOCK_STYLES,
  BLOCK_STYLE_LABEL,
  currentBlockStyle,
  toggleList,
  toggleStyle,
} from '../editor/formatting'
import {
  IconBullets,
  IconHr,
  IconInlineCode,
  IconLink,
  IconNumbered,
  IconOutlineView,
  IconPicture,
  IconCloudUpload,
  IconProperties,
  IconRedo,
  IconSave,
  IconSearch,
  IconEyeOff,
  IconSourceCode,
  IconBacklinks,
  IconBlockLink,
  IconTag,
  IconGraph,
  IconSpellcheck,
  IconTable,
  IconTaskList,
  IconUndo,
  IconPalette,
} from './icons'

interface Props {
  editor: Editor | null
  disabled: boolean
  dirty: boolean
  onSave: () => void
  onSaveAs: () => void
  onFind: () => void
  autoSave: boolean
  onToggleAutoSave: (on: boolean) => void
  imageEnabled: boolean
  onInsertImage: () => void
  /** open the image host configuration (genoffice#388) */
  onImageHost: () => void
  frontmatterOpen: boolean
  onToggleFrontmatter: () => void
  /** the markdown source view, distinct from the .txt/.json `sourceMode` */
  sourceViewOpen: boolean
  onToggleSource: () => void
  outlineOpen: boolean
  onToggleOutline: () => void
  backlinksOpen: boolean
  tagsOpen: boolean
  onToggleTags: () => void
  onToggleBacklinks: () => void
  onOpenGraph: () => void
  /** put a `[[Note#^id]]` for the block at the caret on the clipboard */
  onCopyBlockLink: () => void
  spellcheck: boolean
  onToggleSpellcheck: () => void
  mdTheme: MarkdownTheme
  onMarkdownTheme: (theme: MarkdownTheme) => void
  /** the block editor's view font; null is the default face */
  editorFont: string | null
  onEditorFont: (font: string | null) => void
  aiOpen: boolean
  onToggleAi: () => void
  onAiPreset: (instruction: string) => void
  /**
   * A .txt/.json is edited as source, so every button that formats a block
   * document is hidden rather than left there to act on a document that does
   * not exist. Save, find, autosave and the AI panel still apply.
   */
  sourceMode?: boolean
  /** source mode: history lives in CodeMirror, not the TipTap editor */
  sourceHistory?: { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void }
  /** withheld spans: right-click a selection to hide it from the model */
  redactEnabled: boolean
  onToggleRedact: (on: boolean) => void
  onOpenPrintDialog: (initialDestination?: string) => void
  onQuickPrint: (printerLabel: string) => void | Promise<void>
  listPrinters?: () => Promise<readonly PrintPrinterInfo[]>
  quickPrintPrefStore?: QuickPrintPrefStore
  getPrintPageCount?: () => number | null | Promise<number | null>
  onQuickPrintNotice?: (message: string) => void
}

/** doc + sparkle / pen + sparkle / lines + sparkle, same glyphs as the docs ribbon */
function AiFeatureIcon({ kind }: { kind: 'summarize' | 'polish' | 'tidy' | 'mindmap' }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {kind === 'summarize' && (
        <>
          <path d="M13.875 21H6.5C5.39543 21 4.5 20.1046 4.5 19V5C4.5 3.89543 5.39543 3 6.5 3H17.5C18.6046 3 19.5 3.89543 19.5 5V13" />
          <path d="M8 7H16" />
          <path d="M8 10.2H14" />
          <path d="M8 13.4H12" />
        </>
      )}
      {kind === 'polish' && (
        <>
          <path d="M5.00012 20.7481L8.80319 20.7482L21.7482 7.80317L17.945 4L5 16.945L5.00012 20.7481Z" />
          <path d="M15.1406 6.80469L18.9438 10.6079" />
          <path d="M8 3L8.22106 3.59745C8.51094 4.38087 8.65589 4.77259 8.94166 5.05833C9.22743 5.34409 9.61914 5.48903 10.4026 5.77893L11 6L10.4026 6.22107C9.61914 6.51097 9.22743 6.65592 8.94166 6.94167C8.65589 7.22741 8.51094 7.61913 8.22106 8.40255L8 9L7.77894 8.40255C7.48906 7.61913 7.34411 7.22741 7.05834 6.94167C6.77257 6.65592 6.38086 6.51097 5.59743 6.22107L5 6L5.59743 5.77893C6.38086 5.48903 6.77257 5.34409 7.05834 5.05833C7.34411 4.77259 7.48906 4.38087 7.77894 3.59745L8 3Z" />
        </>
      )}
      {kind === 'tidy' && (
        <>
          <path d="M4 5H20" />
          <path d="M4 9H16" />
          <path d="M4 13H11" />
          <path d="M4 17H10" />
        </>
      )}
      {kind === 'mindmap' && (
        <>
          <rect x="2.5" y="9.5" width="6" height="5" rx="1.5" />
          <rect x="15.5" y="4" width="6" height="5" rx="1.5" />
          <rect x="15.5" y="15" width="6" height="5" rx="1.5" />
          <path d="M8.5 12h3.5M12 12V6.5h3.5M12 12v5.5h3.5" />
        </>
      )}
      {kind !== 'polish' && (
        <path d="M17 14L17.2579 14.697C17.5961 15.611 17.7652 16.068 18.0986 16.4014C18.432 16.7348 18.889 16.9039 19.803 17.2421L20.5 17.5L19.803 17.7579C18.889 18.0961 18.432 18.2652 18.0986 18.5986C17.7652 18.932 17.5961 19.389 17.2579 20.303L17 21L16.7421 20.303C16.4039 19.389 16.2348 18.932 15.9014 18.5986C15.568 18.2652 15.111 18.0961 14.197 17.7579L13.5 17.5L14.197 17.2421C15.111 16.9039 15.568 16.7348 15.9014 16.4014C16.2348 16.068 16.4039 15.611 16.7421 14.697L17 14Z" />
      )}
    </svg>
  )
}

const MARKDOWN_THEME_LABELS: Record<Exclude<MarkdownTheme, 'default'>, string> = {
  'notion-light': 'Notion Light',
  'notion-dark': 'Notion Dark',
  'drake-dark': 'Drake Dark',
  blubook: 'Blubook',
  nord: 'Nord',
  newsprint: 'Newsprint',
}

function ThemePicker({
  mdTheme,
  disabled,
  onPick,
}: {
  mdTheme: MarkdownTheme
  disabled?: boolean
  onPick: (theme: MarkdownTheme) => void
}) {
  const { t } = useI18n()
  return (
    <RibbonMenu
      label={t('mdThemeTitle')}
      icon={<IconPalette size={18} />}
      submenu
      disabled={disabled}
    >
      {(select) =>
        MARKDOWN_THEME_IDS.map((id) => (
          <RibbonMenuItem
            key={id}
            label={id === 'default' ? t('mdThemeDefault') : MARKDOWN_THEME_LABELS[id]}
            radio
            checked={mdTheme === id}
            onClick={() =>
              select(() => {
                if (id !== mdTheme) onPick(id)
              })
            }
          />
        ))
      }
    </RibbonMenu>
  )
}

function EditorFontPicker({
  font,
  disabled,
  onPick,
}: {
  font: string | null
  disabled?: boolean
  onPick: (font: string | null) => void
}) {
  const { t, lang } = useI18n()
  const { families } = useSystemFonts()
  const choices = editorFontChoices(lang, families)
  if (font && !choices.includes(font)) choices.unshift(font)
  return (
    <RibbonMenu
      label={t('editorFontTitle')}
      icon={
        <span className="rb-menu-glyph" aria-hidden="true">
          Aa
        </span>
      }
      submenu
      disabled={disabled}
    >
      {(select) => (
        <>
          <RibbonMenuItem
            label={t('editorFontDefault')}
            radio
            checked={font === null}
            onClick={() => select(() => onPick(null))}
          />
          {choices.map((family) => (
            <RibbonMenuItem
              key={family}
              label={family}
              radio
              checked={font === family}
              onClick={() => select(() => onPick(family))}
            >
              <span style={isSymbolFontFamily(family) ? undefined : { fontFamily: `"${family}"` }}>
                {family}
              </span>
            </RibbonMenuItem>
          ))}
        </>
      )}
    </RibbonMenu>
  )
}

function IconBtn({
  title,
  active,
  disabled,
  shortcut,
  showLabel,
  tip,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  /** shown after the label in the ScreenTip; the accessible name stays `title` */
  shortcut?: string
  showLabel?: boolean
  tip?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`rb-btn${active ? ' active' : ''}${showLabel ? ' rb-labeled' : ''}`}
      data-tip={shortcut ? `${title} (${shortcut})` : (tip ?? title)}
      aria-label={title}
      aria-description={tip}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
      {showLabel && <span className="rb-label">{title}</span>}
    </button>
  )
}

export function Ribbon({
  editor,
  disabled,
  dirty,
  onSave,
  onSaveAs,
  onFind,
  autoSave,
  onToggleAutoSave,
  imageEnabled,
  onInsertImage,
  onImageHost,
  frontmatterOpen,
  onToggleFrontmatter,
  sourceViewOpen,
  onToggleSource,
  outlineOpen,
  onToggleOutline,
  backlinksOpen,
  tagsOpen,
  onToggleTags,
  onToggleBacklinks,
  onOpenGraph,
  onCopyBlockLink,
  spellcheck,
  onToggleSpellcheck,
  mdTheme,
  onMarkdownTheme,
  editorFont,
  onEditorFont,
  aiOpen,
  onToggleAi,
  onAiPreset,
  sourceMode = false,
  sourceHistory,
  redactEnabled,
  onToggleRedact,
  onOpenPrintDialog,
  onQuickPrint,
  listPrinters,
  quickPrintPrefStore,
  getPrintPageCount,
  onQuickPrintNotice,
}: Props) {
  const { t, lang } = useI18n()
  // Settings › Editors and AI: while AI is off the band has no AI entry at all
  const aiOn = useAiVisible()
  const assistantLabel = aiSubscriptionText(lang, 'aiAssistant')
  const collapse = useRibbonCollapse('mdapp.ribbonCollapsed', {
    collapse: t('ribbonCollapse'),
    expand: t('ribbonExpand'),
  })
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkAnchorRef = useRef<HTMLSpanElement>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      return {
        style: currentBlockStyle(e),
        empty: e.isEmpty,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        highlight: e.isActive('highlight'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      }
    },
  })

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus()
  }, [linkOpen])

  useDismissablePopover(linkOpen, () => setLinkOpen(false), {
    inside: () => [linkAnchorRef.current],
  })

  // editor-shaped commands stand down while the pane hides the selection;
  // Save As never does, and Find only while the source view hides its target
  const off = disabled || sourceMode || sourceViewOpen || !editor || !state
  const findOff = disabled || sourceViewOpen

  const openLink = () => {
    if (!editor) return
    setLinkUrl(String(editor.getAttributes('link').href ?? ''))
    setLinkOpen((v) => !v)
  }

  const applyLink = () => {
    if (!editor) return
    uiOp(editor, { op: 'setLink', target: 'selection', href: linkUrl.trim() || null })
    setLinkOpen(false)
  }

  // 20px inline-row rendering, same as the docs toolbar these icons come from
  // (pinned stroke paints 1.5px at this size per the suite-wide icon rules)
  const ICON = 20

  // polish/tidy act on the selection when one exists (read at click time; the
  // mousedown preventDefault below keeps the selection alive); summarize stays whole-doc
  const hasSelection = () => !(editor?.state.selection.empty ?? true)
  const aiPresets = [
    { kind: 'summarize', btn: 'aiSummarizeBtn', prompt: () => t('aiSummarizePrompt') },
    {
      kind: 'polish',
      btn: 'aiPolishBtn',
      prompt: () => t(hasSelection() ? 'aiPolishSelectionPrompt' : 'aiPolishPrompt'),
    },
    {
      kind: 'tidy',
      btn: 'aiTidyBtn',
      prompt: () => t(hasSelection() ? 'aiTidySelectionPrompt' : 'aiTidyPrompt'),
    },
    { kind: 'mindmap', btn: 'aiMindMapBtn', prompt: () => t('aiMindMapPrompt') },
  ] as const

  const styleLabel = t(BLOCK_STYLE_LABEL[state?.style ?? 'paragraph'])

  return (
    <div className={`ribbon ${collapse.rootClass}`} ref={collapse.rootRef}>
      {/* quick-access row above the toolbar (save / undo / redo / autosave), same as the docs QAT row */}
      <div className="ribbon-tabs">
        <button
          type="button"
          className="qa-btn"
          data-tip={t('save')}
          aria-label={t('save')}
          disabled={disabled || !dirty}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSave}
        >
          <IconSave size={16} />
        </button>
        <button
          type="button"
          className="qa-btn qa-save-as"
          data-tip={t('saveAs')}
          aria-label={t('saveAs')}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSaveAs}
        >
          {t('saveAs')}
        </button>
        <button
          type="button"
          className="qa-btn"
          data-tip={t('undo')}
          aria-label={t('undo')}
          disabled={sourceHistory ? !sourceHistory.canUndo : off || !state?.canUndo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            sourceHistory ? sourceHistory.undo() : editor?.chain().focus().undo().run()
          }
        >
          <IconUndo size={16} />
        </button>
        <button
          type="button"
          className="qa-btn"
          data-tip={t('redo')}
          aria-label={t('redo')}
          disabled={sourceHistory ? !sourceHistory.canRedo : off || !state?.canRedo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            sourceHistory ? sourceHistory.redo() : editor?.chain().focus().redo().run()
          }
        >
          <IconRedo size={16} />
        </button>
        <button
          type="button"
          className="qa-btn"
          data-tip={t('findTip')}
          aria-label={t('findTip')}
          disabled={findOff}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onFind}
        >
          <IconSearch size={16} />
        </button>
        <QuickPrintButton
          lang={lang}
          disabled={disabled}
          listPrinters={listPrinters}
          prefStore={quickPrintPrefStore}
          getPageCount={getPrintPageCount}
          onOpenDialog={onOpenPrintDialog}
          onQuickPrint={onQuickPrint}
          onNoPrinter={onQuickPrintNotice}
        />
        <label className={`autosave-toggle${autoSave ? ' on' : ''}`} data-tip={t('autoSaveTip')}>
          <span className="autosave-knob" />
          <span className="autosave-text">{t('autoSave')}</span>
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => onToggleAutoSave(e.target.checked)}
          />
        </label>
        <RibbonExpandButton state={collapse} label={t('ribbonExpand')} />
      </div>

      <div className="ribbon-body" data-ribbon-body="">
        {!sourceMode && (
          <div className="ribbon-group">
            <div className="ribbon-group-items">
              <Dropdown
                className="rb-style"
                value={state?.style ?? 'paragraph'}
                tip={styleLabel}
                disabled={off}
                options={BLOCK_STYLES.map((s) => ({
                  value: s,
                  label: t(BLOCK_STYLE_LABEL[s]),
                }))}
                onPick={(s) => editor && applyBlockStyle(editor, s)}
              />
            </div>
          </div>
        )}

        {!sourceMode && <div className="rb-sep" />}

        {!sourceMode && (
          <div className="ribbon-group">
            <div className="ribbon-group-items">
              <IconBtn
                title={t('bold')}
                active={state?.bold}
                disabled={off}
                onClick={() => toggleStyle(editor, 'bold')}
              >
                <b>B</b>
              </IconBtn>
              <IconBtn
                title={t('italic')}
                active={state?.italic}
                disabled={off}
                onClick={() => toggleStyle(editor, 'italic')}
              >
                <i>I</i>
              </IconBtn>
              <IconBtn
                title={t('strike')}
                active={state?.strike}
                disabled={off}
                onClick={() => toggleStyle(editor, 'strike')}
              >
                <s>ab</s>
              </IconBtn>
              <IconBtn
                title={t('highlight')}
                active={state?.highlight}
                disabled={off}
                onClick={() => toggleStyle(editor, 'highlight')}
              >
                <mark>ab</mark>
              </IconBtn>
              <IconBtn
                title={t('inlineCode')}
                active={state?.code}
                disabled={off}
                onClick={() => toggleStyle(editor, 'code')}
              >
                <IconInlineCode size={ICON} />
              </IconBtn>
              <span className="rb-link-anchor" ref={linkAnchorRef}>
                <IconBtn title={t('link')} active={state?.link} disabled={off} onClick={openLink}>
                  <IconLink size={ICON} />
                </IconBtn>
                {linkOpen && (
                  <span className="rb-link-pop" onMouseDown={(e) => e.stopPropagation()}>
                    <input
                      ref={linkInputRef}
                      value={linkUrl}
                      placeholder={t('linkPlaceholder')}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && linkUrl.trim()) applyLink()
                        if (e.key === 'Escape') setLinkOpen(false)
                      }}
                    />
                    <button type="button" disabled={!linkUrl.trim()} onClick={applyLink}>
                      {t('linkApply')}
                    </button>
                  </span>
                )}
              </span>
              <IconBtn title={t('blockLink')} disabled={off} onClick={onCopyBlockLink}>
                <IconBlockLink size={ICON} />
              </IconBtn>
            </div>
          </div>
        )}

        {!sourceMode && (
          <>
            <div className="rb-sep" />
            <div className="ribbon-group-items">
              <RibbonMenu label={t('ribbonList')} icon={<IconBullets size={ICON} />} disabled={off}>
                {(select) => (
                  <>
                    <RibbonMenuItem
                      label={t('bulletList')}
                      icon={<IconBullets size={18} />}
                      checked={Boolean(state?.bullet)}
                      onClick={() => select(() => toggleList(editor, 'bullet'))}
                    />
                    <RibbonMenuItem
                      label={t('orderedList')}
                      icon={<IconNumbered size={18} />}
                      checked={Boolean(state?.ordered)}
                      onClick={() => select(() => toggleList(editor, 'ordered'))}
                    />
                    <RibbonMenuItem
                      label={t('taskList')}
                      icon={<IconTaskList size={18} />}
                      checked={Boolean(state?.task)}
                      onClick={() => select(() => toggleList(editor, 'task'))}
                    />
                  </>
                )}
              </RibbonMenu>
              <RibbonMenu label={t('ribbonInsert')} icon={<IconTable size={ICON} />}>
                {(select) => (
                  <>
                    <RibbonMenuItem
                      label={t('insertTable')}
                      icon={<IconTable size={18} />}
                      disabled={off}
                      onClick={() =>
                        select(
                          () => editor && uiOp(editor, { op: 'insertTable', after: 'selection' }),
                        )
                      }
                    />
                    <RibbonMenuItem
                      label={t('insertImage')}
                      icon={<IconPicture size={18} />}
                      disabled={off || !imageEnabled}
                      onClick={() => select(onInsertImage)}
                    />
                    <RibbonMenuItem
                      label={t('insertHr')}
                      icon={<IconHr size={18} />}
                      disabled={off}
                      onClick={() =>
                        select(
                          () =>
                            editor &&
                            uiOp(editor, { op: 'insertHorizontalRule', after: 'selection' }),
                        )
                      }
                    />
                    <div className="rb-menu-divider" role="separator" />
                    <RibbonMenuItem
                      label={t('imageHostTitle')}
                      icon={<IconCloudUpload size={18} />}
                      onClick={() => select(onImageHost)}
                    />
                  </>
                )}
              </RibbonMenu>
            </div>
          </>
        )}

        <div className="rb-spacer" />

        <div className="ribbon-group-items ribbon-actions">
          {!sourceMode && (
            <IconBtn
              title={t('sourceView')}
              showLabel
              shortcut={SOURCE_VIEW_SHORTCUT}
              active={sourceViewOpen}
              disabled={disabled}
              onClick={onToggleSource}
            >
              <IconSourceCode size={ICON} />
            </IconBtn>
          )}
          <RibbonMenu
            label={t('ribbonView')}
            icon={<IconOutlineView size={ICON} />}
            alignEnd
            disabled={disabled}
          >
            {(select) => (
              <>
                {!sourceMode && (
                  <>
                    <RibbonMenuItem
                      label={t('fmProperties')}
                      icon={<IconProperties size={18} />}
                      checked={frontmatterOpen}
                      onClick={() => select(onToggleFrontmatter)}
                    />
                    <RibbonMenuItem
                      label={t('outline')}
                      icon={<IconOutlineView size={18} />}
                      checked={outlineOpen}
                      onClick={() => select(onToggleOutline)}
                    />
                    <div className="rb-menu-divider" role="separator" />
                  </>
                )}
                <ThemePicker
                  mdTheme={mdTheme}
                  disabled={sourceMode || sourceViewOpen}
                  onPick={onMarkdownTheme}
                />
                {!sourceMode && (
                  <>
                    <EditorFontPicker
                      font={editorFont}
                      disabled={sourceViewOpen}
                      onPick={onEditorFont}
                    />
                    <div className="rb-menu-divider" role="separator" />
                    <RibbonMenuItem
                      label={t('backlinks')}
                      icon={<IconBacklinks size={18} />}
                      checked={backlinksOpen}
                      onClick={() => select(onToggleBacklinks)}
                    />
                    <RibbonMenuItem
                      label={t('tags')}
                      icon={<IconTag size={18} />}
                      checked={tagsOpen}
                      onClick={() => select(onToggleTags)}
                    />
                    <RibbonMenuItem
                      label={t('graph')}
                      icon={<IconGraph size={18} />}
                      onClick={() => select(onOpenGraph)}
                    />
                    <div className="rb-menu-divider" role="separator" />
                  </>
                )}
                <RibbonMenuItem
                  label={t('spellcheck')}
                  icon={<IconSpellcheck size={18} />}
                  checked={spellcheck}
                  onClick={() => select(onToggleSpellcheck)}
                />
              </>
            )}
          </RibbonMenu>
          {aiOn && (
            <div className="rb-ai-split">
              <IconBtn
                title={assistantLabel}
                tip={t('aiOpenAssistant')}
                showLabel
                active={aiOpen}
                disabled={disabled}
                onClick={onToggleAi}
              >
                <AiMark size={ICON} />
              </IconBtn>
              <RibbonMenu label={t('ribbonAiActions')} alignEnd arrowOnly disabled={disabled}>
                {(select) =>
                  aiPresets.map(({ kind, btn, prompt }) => (
                    <RibbonMenuItem
                      key={kind}
                      label={t(btn)}
                      icon={<AiFeatureIcon kind={kind} />}
                      disabled={off || state?.empty}
                      onClick={() => select(() => onAiPreset(prompt()))}
                    />
                  ))
                }
              </RibbonMenu>
            </div>
          )}
          {!sourceMode && aiOn && (
            <>
              <div className="rb-sep" />
              <IconBtn
                title={t('ribbonRedact')}
                tip={t('redactEnable')}
                showLabel
                active={redactEnabled}
                disabled={disabled}
                onClick={() => onToggleRedact(!redactEnabled)}
              >
                <IconEyeOff size={ICON} />
              </IconBtn>
            </>
          )}
        </div>
      </div>
      <RibbonCollapseButton state={collapse} label={t('ribbonCollapse')} />
    </div>
  )
}
