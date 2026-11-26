import type { zh } from './zh'

export const hi = {
  webNotUtf8Notice:
    'यह फ़ाइल UTF-8 में नहीं है, इसलिए इसे संपादित नहीं किया जा सकता। आप इसे देख सकते हैं और मूल फ़ाइल साझा कर सकते हैं।',
} as const satisfies Record<keyof typeof zh, string>
