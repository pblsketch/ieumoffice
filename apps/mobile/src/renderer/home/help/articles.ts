// The short how-to articles of Settings > Help (track T6, spec 3.11), in the order shown.
import type { MobileStringKey } from '../../i18n'

export type HelpArticleId = 'open' | 'edit' | 'recovery' | 'share' | 'flow' | 'ai'

export interface HelpArticle {
  readonly id: HelpArticleId
  readonly titleKey: MobileStringKey
  /** One string key per paragraph. */
  readonly bodyKeys: readonly MobileStringKey[]
}

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    id: 'open',
    titleKey: 'homeHelpOpenTitle',
    bodyKeys: ['homeHelpOpenBody1', 'homeHelpOpenBody2', 'homeHelpOpenBody3', 'homeHelpOpenBody4'],
  },
  {
    id: 'edit',
    titleKey: 'homeHelpEditTitle',
    bodyKeys: ['homeHelpEditBody1', 'homeHelpEditBody2', 'homeHelpEditBody3', 'homeHelpEditBody4'],
  },
  {
    id: 'recovery',
    titleKey: 'homeHelpRecoveryTitle',
    bodyKeys: [
      'homeHelpRecoveryBody1',
      'homeHelpRecoveryBody2',
      'homeHelpRecoveryBody3',
      'homeHelpRecoveryBody4',
    ],
  },
  {
    id: 'share',
    titleKey: 'homeHelpShareTitle',
    bodyKeys: ['homeHelpShareBody1', 'homeHelpShareBody2', 'homeHelpShareBody3'],
  },
  {
    id: 'flow',
    titleKey: 'homeHelpFlowTitle',
    bodyKeys: ['homeHelpFlowBody1', 'homeHelpFlowBody2', 'homeHelpFlowBody3'],
  },
  {
    id: 'ai',
    titleKey: 'homeHelpAiTitle',
    bodyKeys: ['homeHelpAiBody1', 'homeHelpAiBody2', 'homeHelpAiBody3'],
  },
]
