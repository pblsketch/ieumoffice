import { latexToOmml, mathParagraphXml, mathTokensOf, ommlToMathML } from '@genoffice/docx-engine'
import { t } from '../i18n/locale'
import type { PmNode } from './convert'

/**
 * Protected display-equation block built from LaTeX (throws on syntax outside
 * the supported subset). Shared by the insert dialog/gallery and the AI
 * <formula> tag; genXml carries the OMML through the save path.
 */
/** MathML for inline flow (ommlToMathML emits display="block" for equations);
 *  `display` keeps display math-style (large operators, stacked limits) in the flow */
export function inlineMathML(omml: string, display = false): string {
  return ommlToMathML(omml).replace(
    / display="block"/g,
    display ? ' display="inline" displaystyle="true"' : ' display="inline"',
  )
}

/**
 * Atomic inline formula node built directly from an <m:oMath> fragment (used
 * when converting a complex MathType equation whose OMML is outside the LaTeX
 * subset).
 */
export function inlineEquationNodeFromOmml(omml: string, latex: string | null = null): PmNode {
  const normalized = omml.startsWith('<m:oMath') ? omml : `<m:oMath>${omml}</m:oMath>`
  return {
    type: 'docInlineMath',
    attrs: {
      omml: normalized,
      mathml: inlineMathML(normalized),
      latex: latex ? latex.trim() : null,
      text: mathTokensOf(normalized).join(''),
      oleXml: null,
      oleRawRPr: null,
      oleProgId: null,
      olePositionHalfPoints: null,
    },
  }
}

/**
 * Atomic inline formula node built from LaTeX (throws on unsupported syntax).
 * Flows with paragraph text; saves as a Run.math (<m:oMath> emitted verbatim).
 */
export function inlineEquationNodeJson(latex: string): PmNode {
  const inner = latexToOmml(latex)
  return inlineEquationNodeFromOmml(`<m:oMath>${inner}</m:oMath>`, latex)
}

/** Protected display-equation block built directly from an <m:oMath> fragment */
export function equationBlockFromOmml(omml: string, latex: string | null = null): PmNode {
  const inner = omml.replace(/^<m:oMath(?:\s[^>]*)?>/, '').replace(/<\/m:oMath>$/, '')
  const wrapped = `<m:oMath>${inner}</m:oMath>`
  const tokens = mathTokensOf(wrapped)
  return {
    type: 'docProtected',
    attrs: {
      docxIndex: null,
      blockType: 'passthrough',
      label: t('editorEquation'),
      previewText: latex ? latex.trim() : tokens.join(''),
      genXml: mathParagraphXml(inner),
      formulaDisplay: {
        tokens,
        mathml: ommlToMathML(wrapped),
        omml: wrapped,
        ...(latex ? { latex: latex.trim() } : {}),
      },
    },
  }
}

export function equationBlockJson(latex: string): PmNode {
  const omml = latexToOmml(latex)
  return equationBlockFromOmml(`<m:oMath>${omml}</m:oMath>`, latex)
}
