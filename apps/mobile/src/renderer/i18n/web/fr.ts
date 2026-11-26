import type { zh } from './zh'

export const fr = {
  webNotUtf8Notice:
    "Ce fichier n'est pas en UTF-8 et ne peut donc pas être modifié. Vous pouvez toujours l'afficher et partager l'original.",
} as const satisfies Record<keyof typeof zh, string>
