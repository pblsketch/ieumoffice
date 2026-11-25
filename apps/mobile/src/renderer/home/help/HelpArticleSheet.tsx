// One how-to article of Settings > Help in a bottom sheet (track T6, spec 3.11).
import { Sheet } from '../../components/Sheet'
import { useMobileLocale } from '../../i18n'
import type { HelpArticle } from './articles'
import './help.css'

export interface HelpArticleSheetProps {
  /** The article to show; null keeps the sheet closed. */
  readonly article: HelpArticle | null
  readonly onClose: () => void
}

export function HelpArticleSheet({ article, onClose }: HelpArticleSheetProps) {
  const { t } = useMobileLocale()
  return (
    <Sheet
      open={article !== null}
      title={article ? t(article.titleKey) : ''}
      onClose={onClose}
      closeLabel={t('homeHelpClose')}
      testId="home-help-article-sheet"
    >
      {article ? (
        <div className="home-help-article" data-testid={`home-help-article-${article.id}-body`}>
          {article.bodyKeys.map((key) => (
            <p key={key}>{t(key)}</p>
          ))}
        </div>
      ) : null}
    </Sheet>
  )
}
