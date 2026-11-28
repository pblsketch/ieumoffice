/**
 * Shared static output quality linter (`Anti-AI-Slop` + visual layout checks)
 * for `slides`, `html`, and `whiteboard`. Runs ONLY after AI create/edit turns;
 * never blocks save/export/print and respects explicit user aesthetic requests.
 */

export type QualitySeverity = 'P0' | 'P1'

export type QualityFindingCode =
  | 'placeholder_text'
  | 'invented_metric'
  | 'default_indigo'
  | 'purple_cyan_gradient'
  | 'emoji_icon_overuse'
  | 'footer_rail_overflow'
  | 'cjk_fake_italic'
  | 'hero_off_center'
  | 'raw_hex_overuse'
  | 'accent_overuse'
  | 'page_overflow'
  | 'canvas_bounds_overflow'
  | 'object_overlap'
  | 'palette_overuse'

export interface QualityFinding {
  readonly id: string
  readonly severity: QualitySeverity
  readonly code: QualityFindingCode
  readonly location?: string | undefined
  readonly message: string
}

export interface RequestedAesthetics {
  readonly allowIndigo: boolean
  readonly allowGradient: boolean
  readonly allowEmoji: boolean
  readonly allowItalic: boolean
}

export interface QualityAuditContext {
  readonly userPrompt?: string | undefined
  readonly attachmentText?: string | undefined
  /** Tunable HTML thresholds */
  readonly maxRawHexOutsideRoot?: number | undefined
  readonly maxAccentRepeats?: number | undefined
  /** Tunable Whiteboard threshold */
  readonly maxPaletteColorsPerPage?: number | undefined
  /** Tunable Slide footer rail ratio (default 0.893) */
  readonly footerRailRatio?: number | undefined
}

export const DEFAULT_MAX_RAW_HEX_OUTSIDE_ROOT = 12
export const DEFAULT_MAX_ACCENT_REPEATS = 6
export const DEFAULT_MAX_PALETTE_COLORS_PER_PAGE = 6
export const DEFAULT_FOOTER_RAIL_RATIO = 0.893
export const DEFAULT_MAX_QUALITY_FIX_ROUNDS = 2

const INDIGO_REQUEST_RE =
  /(?:보라|인디고|퍼플|바이올렛|purple|indigo|violet|#6366f1|#4f46e5|#8b5cf6|#7c3aed)/i
const GRADIENT_REQUEST_RE = /(?:그라데이션|그라디언트|gradient)/i
const EMOJI_REQUEST_RE = /(?:이모지|이모티콘|emoji)/i
const ITALIC_REQUEST_RE = /(?:기울임|이탤릭|italic)/i

/** Detects explicit aesthetic preferences in the user's prompt so the linter never overrides them. */
export function extractRequestedAesthetics(userPrompt: string = ''): RequestedAesthetics {
  return {
    allowIndigo: INDIGO_REQUEST_RE.test(userPrompt),
    allowGradient: GRADIENT_REQUEST_RE.test(userPrompt),
    allowEmoji: EMOJI_REQUEST_RE.test(userPrompt),
    allowItalic: ITALIC_REQUEST_RE.test(userPrompt),
  }
}

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\blorem\s+ipsum\b/i,
  /\bfeature\s+(?:one|two|three)\b/i,
  /\bplaceholder\s+text\b/i,
  /\bsample\s+content\b/i,
  /여기에\s*(?:내용을\s*)?입력/,
  /내용을\s*입력하세요/,
  /\[(?:여기에|입력|TBD|TODO)\]/i,
]

const INVENTED_METRIC_PATTERNS: readonly RegExp[] = [
  /\b10[x×]\s*faster\b/i,
  /\b99\.99?%\s*uptime\b/i,
  /\b100%\s*guaranteed\b/i,
  /\b10배\s*빠른\b/,
]

const AI_DEFAULT_INDIGO_HEX = /#(?:6366f1|4f46e5|4338ca|3730a3|8b5cf6|7c3aed|a855f7)\b/gi

const PURPLE_CYAN_GRADIENT_RE =
  /linear-gradient\s*\([^)]*(?:#(?:6366f1|4f46e5|8b5cf6|7c3aed|a855f7|3b82f6|2563eb)|purple|indigo|violet)[^)]*(?:#(?:06b6d4|22d3ee|38bdf8|0ea5e9|14b8a6)|cyan|aqua)[^)]*\)/gi

const DECORATIVE_EMOJI_RE = /[✨🚀🎯⚡🔥💡🎉📌✅]/gu

const CJK_CHAR_RE = /[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/gu

function isCjkDominant(text: string): boolean {
  const trimmed = text.replace(/\s+/g, '')
  if (trimmed.length === 0) return false
  const cjkCount = (trimmed.match(CJK_CHAR_RE) ?? []).length
  return cjkCount / trimmed.length >= 0.4
}

function makeFinding(
  seq: number,
  severity: QualitySeverity,
  code: QualityFindingCode,
  message: string,
  location?: string,
): QualityFinding {
  return {
    id: `${code}-${seq}`,
    severity,
    code,
    ...(location ? { location } : {}),
    message,
  }
}

function auditCommonTextAndStyle(
  text: string,
  styleText: string,
  headingOrButtonTexts: readonly string[],
  ctx: QualityAuditContext,
  location?: string,
): QualityFinding[] {
  const findings: QualityFinding[] = []
  const req = extractRequestedAesthetics(ctx.userPrompt)
  const sourceCorpus = `${ctx.userPrompt ?? ''}\n${ctx.attachmentText ?? ''}`
  let seq = 1

  for (const re of PLACEHOLDER_PATTERNS) {
    const match = text.match(re)
    if (match) {
      findings.push(
        makeFinding(
          seq++,
          'P0',
          'placeholder_text',
          `Unfinished placeholder text detected: "${match[0]}"`,
          location,
        ),
      )
      break
    }
  }

  for (const re of INVENTED_METRIC_PATTERNS) {
    const match = text.match(re)
    if (match && !sourceCorpus.toLowerCase().includes(match[0].toLowerCase())) {
      findings.push(
        makeFinding(
          seq++,
          'P0',
          'invented_metric',
          `Unverified metric "${match[0]}" does not appear in the prompt or attachments`,
          location,
        ),
      )
      break
    }
  }

  if (!req.allowIndigo) {
    const indigoMatches = styleText.match(AI_DEFAULT_INDIGO_HEX)
    if (indigoMatches && indigoMatches.length > 0) {
      findings.push(
        makeFinding(
          seq++,
          'P0',
          'default_indigo',
          `Unrequested default AI indigo/violet color detected (${indigoMatches[0]})`,
          location,
        ),
      )
    }
  }

  if (!req.allowGradient) {
    if (PURPLE_CYAN_GRADIENT_RE.test(styleText)) {
      findings.push(
        makeFinding(
          seq++,
          'P0',
          'purple_cyan_gradient',
          'Unrequested two-stop purple/blue-to-cyan gradient detected',
          location,
        ),
      )
    }
    PURPLE_CYAN_GRADIENT_RE.lastIndex = 0
  }

  if (!req.allowEmoji) {
    let emojiHits = 0
    for (const heading of headingOrButtonTexts) {
      const m = heading.match(DECORATIVE_EMOJI_RE)
      if (m) emojiHits += m.length
    }
    if (emojiHits >= 2) {
      findings.push(
        makeFinding(
          seq,
          'P0',
          'emoji_icon_overuse',
          `Decorative emoji icons used ${emojiHits} times in headings/buttons`,
          location,
        ),
      )
    }
  }

  return findings
}

/** Static quality audit for HTML documents produced/edited by AI. */
export function auditHtmlQuality(
  html: string,
  ctx: QualityAuditContext & { readonly overflowPages?: readonly number[] | undefined } = {},
): QualityFinding[] {
  const plainText = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  const headingOrButtons: string[] = []
  for (const m of html.matchAll(/<(?:h[1-6]|button)[^>]*>([\s\S]*?)<\/(?:h[1-6]|button)>/gi)) {
    headingOrButtons.push((m[1] ?? '').replace(/<[^>]+>/g, ''))
  }

  const findings = auditCommonTextAndStyle(plainText, html, headingOrButtons, ctx, 'HTML')
  let seq = findings.length + 1

  const withoutRoot = html.replace(/:root\s*\{[^}]*\}/gi, '')
  const hexes = withoutRoot.match(/#[0-9a-f]{3,8}\b/gi) ?? []
  const maxRawHex = ctx.maxRawHexOutsideRoot ?? DEFAULT_MAX_RAW_HEX_OUTSIDE_ROOT
  if (hexes.length > maxRawHex) {
    findings.push(
      makeFinding(
        seq++,
        'P1',
        'raw_hex_overuse',
        `${hexes.length} hardcoded hex colors outside :root (limit ${maxRawHex})`,
        'HTML',
      ),
    )
  }

  const maxAccent = ctx.maxAccentRepeats ?? DEFAULT_MAX_ACCENT_REPEATS
  const counts = new Map<string, number>()
  for (const h of hexes) {
    const key = h.toLowerCase()
    if (
      /^#(?:fff|ffffff|000|000000|111|222|333|444|555|666|777|888|999|aaa|bbb|ccc|ddd|eee|f5f5f5|fafafa)$/.test(
        key,
      )
    ) {
      continue
    }
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const [color, count] of counts) {
    if (count >= maxAccent) {
      findings.push(
        makeFinding(
          seq++,
          'P1',
          'accent_overuse',
          `Accent color ${color} repeated ${count} times outside :root (threshold ${maxAccent})`,
          'HTML',
        ),
      )
      break
    }
  }

  if (ctx.overflowPages && ctx.overflowPages.length > 0) {
    findings.push(
      makeFinding(
        seq,
        'P1',
        'page_overflow',
        `Page overflow detected on page(s): ${ctx.overflowPages.join(', ')}`,
        `Page ${ctx.overflowPages[0]}`,
      ),
    )
  }

  return findings
}

export interface WhiteboardAuditObject {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly text?: string | undefined
  readonly fill?: string | undefined
  readonly stroke?: string | undefined
  readonly isHeading?: boolean | undefined
}

export interface WhiteboardAuditPage {
  readonly id: string
  readonly name?: string | undefined
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly objects: readonly WhiteboardAuditObject[]
}

/** Static quality audit for Whiteboard pages produced/edited by AI. */
export function auditWhiteboardQuality(
  pages: readonly WhiteboardAuditPage[],
  ctx: QualityAuditContext = {},
): QualityFinding[] {
  const findings: QualityFinding[] = []
  let seq = 1
  const maxPalette = ctx.maxPaletteColorsPerPage ?? DEFAULT_MAX_PALETTE_COLORS_PER_PAGE

  for (const page of pages) {
    const loc = page.name || page.id
    const allText = page.objects.map((o) => o.text ?? '').join('\n')
    const styleColors = page.objects
      .flatMap((o) => [o.fill ?? '', o.stroke ?? ''])
      .filter(Boolean)
      .join(' ')
    const headings = page.objects
      .filter((o) => o.isHeading || (o.text && o.text.length <= 40))
      .map((o) => o.text ?? '')

    findings.push(...auditCommonTextAndStyle(allText, styleColors, headings, ctx, loc))

    const palette = new Set<string>()
    for (const o of page.objects) {
      if (o.fill && o.fill !== 'transparent' && o.fill !== 'none') palette.add(o.fill.toLowerCase())
      if (o.stroke && o.stroke !== 'transparent' && o.stroke !== 'none') {
        palette.add(o.stroke.toLowerCase())
      }
      if (
        typeof page.width === 'number' &&
        typeof page.height === 'number' &&
        (o.x < 0 || o.y < 0 || o.x + o.w > page.width || o.y + o.h > page.height)
      ) {
        findings.push(
          makeFinding(
            seq++,
            'P1',
            'canvas_bounds_overflow',
            `Object ${o.id} extends past page bounds (${page.width}x${page.height})`,
            loc,
          ),
        )
      }
    }

    if (palette.size > maxPalette) {
      findings.push(
        makeFinding(
          seq++,
          'P1',
          'palette_overuse',
          `${palette.size} distinct colors used on one board page (limit ${maxPalette})`,
          loc,
        ),
      )
    }

    let overlapCount = 0
    for (let i = 0; i < page.objects.length && overlapCount === 0; i++) {
      for (let j = i + 1; j < page.objects.length; j++) {
        const a = page.objects[i]!
        const b = page.objects[j]!
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ix <= 0 || iy <= 0) continue
        const inter = ix * iy
        const minArea = Math.min(a.w * a.h, b.w * b.h)
        if (minArea > 0 && inter / minArea >= 0.35) {
          findings.push(
            makeFinding(
              seq++,
              'P1',
              'object_overlap',
              `Objects ${a.id} and ${b.id} overlap excessively`,
              loc,
            ),
          )
          overlapCount++
          break
        }
      }
    }
  }

  return findings
}

export interface SlideAuditRun {
  readonly text: string
  readonly italic?: boolean | undefined
}

export interface SlideAuditElement {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly text?: string | undefined
  readonly runs?: readonly SlideAuditRun[] | undefined
  readonly fill?: string | undefined
  readonly isFooter?: boolean | undefined
  readonly isHeading?: boolean | undefined
}

export interface SlideAuditInput {
  readonly slideNumber: number
  readonly widthPx: number
  readonly heightPx: number
  readonly isCoverOrHero?: boolean | undefined
  readonly elements: readonly SlideAuditElement[]
}

/** Static quality audit for Slides produced/edited by AI. */
export function auditSlideContentQuality(
  slides: readonly SlideAuditInput[],
  ctx: QualityAuditContext = {},
): QualityFinding[] {
  const findings: QualityFinding[] = []
  const req = extractRequestedAesthetics(ctx.userPrompt)
  const footerRatio = ctx.footerRailRatio ?? DEFAULT_FOOTER_RAIL_RATIO
  let seq = 1

  for (const slide of slides) {
    const loc = `Slide ${slide.slideNumber}`
    const allText = slide.elements.map((e) => e.text ?? '').join('\n')
    const styles = slide.elements.map((e) => e.fill ?? '').join(' ')
    const headings = slide.elements.filter((e) => e.isHeading).map((e) => e.text ?? '')
    findings.push(...auditCommonTextAndStyle(allText, styles, headings, ctx, loc))

    const railY = slide.heightPx * footerRatio
    let topY = Infinity
    let bottomY = -Infinity

    for (const el of slide.elements) {
      if (!el.isFooter && el.h < slide.heightPx * 0.7 && el.y + el.h > railY) {
        findings.push(
          makeFinding(
            seq++,
            'P0',
            'footer_rail_overflow',
            `Body element ${el.id} encroaches into the bottom footer rail (y+h=${Math.round(el.y + el.h)}px > ${Math.round(railY)}px)`,
            loc,
          ),
        )
      }

      if (!req.allowItalic && el.runs) {
        for (const run of el.runs) {
          if (run.italic && isCjkDominant(run.text)) {
            findings.push(
              makeFinding(
                seq++,
                'P0',
                'cjk_fake_italic',
                `Synthetic italic applied to CJK text in ${el.id}; use bold or accent color instead`,
                loc,
              ),
            )
            break
          }
        }
      }

      if (!el.isFooter && el.w * el.h < slide.widthPx * slide.heightPx * 0.7) {
        topY = Math.min(topY, el.y)
        bottomY = Math.max(bottomY, el.y + el.h)
      }
    }

    if (slide.isCoverOrHero && Number.isFinite(topY) && Number.isFinite(bottomY)) {
      const groupCenter = (topY + bottomY) / 2
      if (groupCenter < slide.heightPx * 0.34) {
        findings.push(
          makeFinding(
            seq++,
            'P1',
            'hero_off_center',
            'Cover/hero slide content cluster is skewed too high; vertically center the title block',
            loc,
          ),
        )
      }
    }
  }

  return findings
}

/** Formats P0 findings as a structured `<quality-audit>` reminder for immediate AI self-correction. */
export function formatQualityReminder(findings: readonly QualityFinding[]): string {
  const p0 = findings.filter((f) => f.severity === 'P0')
  if (p0.length === 0) return ''
  const lines = p0.map(
    (f) => `- [${f.severity}] ${f.code}${f.location ? ` (${f.location})` : ''}: ${f.message}`,
  )
  return (
    `\n<quality-audit>\nFound ${p0.length} P0 quality issue(s):\n${lines.join('\n')}\n` +
    'Fix these P0 issues immediately (up to 2 self-correction rounds) unless the user explicitly requested them.\n</quality-audit>'
  )
}
