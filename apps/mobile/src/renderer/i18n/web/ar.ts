import type { zh } from './zh'

export const ar = {
  webNotUtf8Notice:
    'هذا الملف ليس بترميز UTF-8، لذا لا يمكن تعديله. لا يزال بإمكانك عرضه ومشاركة الملف الأصلي.',
} as const satisfies Record<keyof typeof zh, string>
