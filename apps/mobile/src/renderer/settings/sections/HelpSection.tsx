// Owner: track T6 (help: how-to articles, replay first run, feedback, what's new).
import { useCallback, useState } from 'react'
import { IconChevronRight } from '../../components/MobileIcons'
import { useMobileLocale } from '../../i18n'
import { HELP_ARTICLES, type HelpArticle } from '../../home/help/articles'
import { FeedbackDialog } from '../../home/help/FeedbackDialog'
import { HelpArticleSheet } from '../../home/help/HelpArticleSheet'
import { useAppInfo } from '../../home/help/feedback'
import { latestWhatsNewEntry, WHATS_NEW_ENTRIES } from '../../home/help/whatsNew'
import { WhatsNewSheet } from '../../home/help/WhatsNewSheet'
import { useHomeRuntime } from '../../home/homeRuntime'
import { updateHomePrefs } from '../../home/prefsStore'
import '../../home/help/help.css'

export interface HelpSectionProps {
  /** Closes the settings screen (the same way as its back button). */
  readonly onClose: () => void
}

export function HelpSection({ onClose }: HelpSectionProps) {
  const { t } = useMobileLocale()
  const runtime = useHomeRuntime()
  const info = useAppInfo(runtime?.client ?? null)
  const [article, setArticle] = useState<HelpArticle | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)

  const closeArticle = useCallback(() => setArticle(null), [])
  const closeFeedback = useCallback(() => setFeedbackOpen(false), [])
  const closeWhatsNew = useCallback(() => setWhatsNewOpen(false), [])

  // The app layer shows the first run as soon as the home is visible again (spec 3.13).
  const replayFirstRun = async () => {
    try {
      await updateHomePrefs({ firstRunDone: false })
    } catch {
      runtime?.showToast({ message: t('homeHelpReplayFailed'), tone: 'error' })
      return
    }
    onClose()
  }

  const latest = latestWhatsNewEntry(info?.version ?? null, WHATS_NEW_ENTRIES)
  const title = t('homeHelpSection')

  return (
    <section className="mobile-section" aria-label={title} data-testid="settings-help-section">
      <h2 className="mobile-section-heading">{title}</h2>
      <div className="mobile-card home-help-card">
        <div className="mobile-menu-stack">
          {HELP_ARTICLES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="mobile-menu-row-btn home-help-row"
              onClick={() => setArticle(item)}
              data-testid={`home-help-article-${item.id}`}
            >
              <span className="home-help-row-label">{t(item.titleKey)}</span>
              <IconChevronRight size={18} className="mobile-chevron" />
            </button>
          ))}
        </div>
        <div className="mobile-menu-stack home-help-actions">
          <button
            type="button"
            className="mobile-menu-row-btn home-help-row"
            onClick={() => void replayFirstRun()}
            data-testid="home-help-replay"
          >
            <span className="home-help-row-label">{t('homeHelpReplay')}</span>
          </button>
          <button
            type="button"
            className="mobile-menu-row-btn home-help-row"
            onClick={() => setFeedbackOpen(true)}
            aria-haspopup="dialog"
            data-testid="home-help-feedback"
          >
            <span className="home-help-row-label">{t('homeHelpFeedback')}</span>
            <IconChevronRight size={18} className="mobile-chevron" />
          </button>
          <button
            type="button"
            className="mobile-menu-row-btn home-help-row"
            onClick={() => setWhatsNewOpen(true)}
            aria-haspopup="dialog"
            data-testid="home-help-whats-new"
          >
            <span className="home-help-row-label">{t('homeHelpWhatsNew')}</span>
            <IconChevronRight size={18} className="mobile-chevron" />
          </button>
        </div>
      </div>

      <HelpArticleSheet article={article} onClose={closeArticle} />
      <FeedbackDialog open={feedbackOpen} onClose={closeFeedback} />
      <WhatsNewSheet open={whatsNewOpen} entries={latest ? [latest] : []} onClose={closeWhatsNew} />
    </section>
  )
}
