import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  createSensitiveSendCheck,
  type SensitiveSendAnswer,
  type SensitiveSendCheck,
  type SensitiveSendCounts,
} from './sensitive-send-check'
import { SensitiveSendAlert } from './SensitiveInfo'

export interface SensitiveSendAlertArgs {
  readonly lang: Lang
  /** the chosen provider runs on this PC */
  readonly localAi?: boolean | undefined
  /**
   * The tab's check. Pass one that lives as long as the tab (module scope, or
   * the editor's root) when the AI panel can unmount and mount again; the
   * default lives as long as the component that calls this hook.
   */
  readonly check?: SensitiveSendCheck | undefined
}

export interface SensitiveSendAlertController {
  /**
   * Await this in the send path before anything goes out. `send`: send now.
   * `review`: send nothing, keep the composer text, open the candidate list.
   * `count` runs only for the tab's first send.
   */
  readonly beforeSend: (
    count: () => SensitiveSendCounts | Promise<SensitiveSendCounts>,
  ) => Promise<SensitiveSendAnswer>
  /** the alert to place above the composer; null while nothing is asked */
  readonly alert: React.JSX.Element | null
  readonly check: SensitiveSendCheck
}

interface Asking {
  counts: SensitiveSendCounts
  answer: (answer: SensitiveSendAnswer | null) => void
}

/** The first-send alert wired to a tab's check: the editor awaits `beforeSend` and renders `alert`. */
export function useSensitiveSendAlert({
  lang,
  localAi = false,
  check: given,
}: SensitiveSendAlertArgs): SensitiveSendAlertController {
  const [own] = useState(createSensitiveSendCheck)
  const check = given ?? own
  const [asking, setAsking] = useState<Asking | null>(null)
  const askingRef = useRef<Asking | null>(null)

  useEffect(
    () => () => {
      // the panel went away with the alert open: no choice was made, nothing is sent
      askingRef.current?.answer(null)
      askingRef.current = null
    },
    [],
  )

  const beforeSend = useCallback(
    (count: () => SensitiveSendCounts | Promise<SensitiveSendCounts>) =>
      check.check(
        count,
        (counts) =>
          new Promise<SensitiveSendAnswer | null>((resolve) => {
            const next: Asking = {
              counts,
              answer: (answer) => {
                if (askingRef.current === next) askingRef.current = null
                setAsking((cur) => (cur === next ? null : cur))
                resolve(answer)
              },
            }
            askingRef.current = next
            setAsking(next)
          }),
      ),
    [check],
  )

  const alert = asking ? (
    <SensitiveSendAlert
      lang={lang}
      counts={asking.counts}
      localAi={localAi}
      onReview={() => asking.answer('review')}
      onSend={() => asking.answer('send')}
    />
  ) : null

  return { beforeSend, alert, check }
}
