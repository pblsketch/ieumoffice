import type { MobileDocFormat } from '@genoffice/mobile-bridge/transport'

/** File-type pictures (image URLs) a track adds for its formats; DocTypeIcon reads them first. */
export type DocTypeIconMap = Partial<Record<MobileDocFormat, string>>
