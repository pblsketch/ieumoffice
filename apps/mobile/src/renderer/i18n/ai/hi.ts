import type { zh } from './zh'

export const hi = {
  aiOutboundTitle: 'क्या यह पता खोलें?',
  aiOutboundIntro: 'AI ऐसा पता खोलना चाहता है जो बातचीत में कभी नहीं आया।',
  aiOutboundHint: 'अगर पते में आपके दस्तावेज़ का पाठ है या साइट अनजानी है, तो इसे रोकें।',
  aiOutboundBlock: 'रोकें',
  aiOutboundAllow: 'अनुमति दें',
} as const satisfies Record<keyof typeof zh, string>
