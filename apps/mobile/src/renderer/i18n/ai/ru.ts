import type { zh } from './zh'

export const ru = {
  aiOutboundTitle: 'Загрузить этот адрес?',
  aiOutboundIntro: 'ИИ хочет загрузить адрес, которого не было в разговоре.',
  aiOutboundHint: 'Если в адресе есть текст из документа или сайт вам незнаком, заблокируйте его.',
  aiOutboundBlock: 'Блокировать',
  aiOutboundAllow: 'Разрешить',
} as const satisfies Record<keyof typeof zh, string>
