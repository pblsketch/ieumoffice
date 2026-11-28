import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Sheet } from '../components/Sheet'
import { useMobileLocale } from '../i18n'
import type { MobileOutboundBridge } from './outbound'
import './OutboundConfirmSheet.css'

/** Decision 0062: an address is shown up to 300 characters. */
const ADDRESS_SHOWN_CHARS = 300

function shown(address: string): string {
  return address.length > ADDRESS_SHOWN_CHARS
    ? `${address.slice(0, ADDRESS_SHOWN_CHARS)}…`
    : address
}

/**
 * The question of decision 0062 on the phone: a sheet over the AI sheet asking
 * whether the AI may fetch addresses the conversation never showed. "막기"
 * (block) is the default; closing the sheet and Back (the sheet's back layer)
 * block too. While this host is on screen the bridge can ask; without it every
 * such address is blocked.
 */
export function OutboundConfirmHost({ bridge }: { readonly bridge: MobileOutboundBridge }) {
  const { t } = useMobileLocale()
  const question = useSyncExternalStore(bridge.subscribe, bridge.question, bridge.question)

  useEffect(() => bridge.attachHost(), [bridge])

  const block = () => bridge.answer(false)
  const sheet = (
    <Sheet
      open={question !== null}
      title={t('aiOutboundTitle')}
      closeLabel={t('aiOutboundBlock')}
      onClose={block}
      testId="ai-outbound-sheet"
    >
      {question && (
        <div className="mobile-ai-outbound">
          <p className="mobile-ai-outbound-intro">{t('aiOutboundIntro')}</p>
          <ul className="mobile-ai-outbound-list">
            {question.addresses.map((address) => (
              <li
                key={address}
                className="mobile-ai-outbound-address"
                data-testid="ai-outbound-address"
              >
                {shown(address)}
              </li>
            ))}
          </ul>
          <p className="mobile-ai-outbound-hint">{t('aiOutboundHint')}</p>
          <div className="mobile-ai-outbound-actions">
            <button
              type="button"
              className="mobile-pill-btn"
              data-testid="ai-outbound-allow"
              onClick={() => bridge.answer(true)}
            >
              {t('aiOutboundAllow')}
            </button>
            <button
              type="button"
              className="mobile-pill-btn mobile-btn-primary"
              data-testid="ai-outbound-block"
              autoFocus
              onClick={block}
            >
              {t('aiOutboundBlock')}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
  // over the AI sheet, whichever layer the panel sits in
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body)
}
