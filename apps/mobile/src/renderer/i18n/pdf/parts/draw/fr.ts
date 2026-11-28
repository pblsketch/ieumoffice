import type { zh } from './zh'

export const fr = {
  pdfDrawSettings: 'Réglages du stylet',
  pdfDrawTool: 'Outil',
  pdfDrawPen: 'Stylet',
  pdfDrawRect: 'Rectangle',
  pdfDrawEllipse: 'Ellipse',
  pdfDrawLine: 'Ligne',
  pdfDrawArrow: 'Flèche',
  pdfDrawEraser: 'Gomme',
  pdfDrawColor: 'Couleur',
  pdfDrawColorRed: 'Rouge',
  pdfDrawColorYellow: 'Jaune',
  pdfDrawColorGreen: 'Vert',
  pdfDrawColorBlue: 'Bleu',
  pdfDrawColorBlack: 'Noir',
  pdfDrawWidth: 'Épaisseur',
  pdfDrawWidthValue: '{width} pt',
  pdfDrawFinger: 'Dessiner aussi au doigt',
  pdfDrawFingerHint:
    "Activé : le doigt dessine même après l'utilisation d'un stylet. Désactivé : une fois un stylet utilisé, le doigt déplace la page.",
  pdfDrawEraserHint: "La gomme n'efface que les traits et les formes pas encore enregistrés.",
  pdfDrawRefused: 'Impossible de dessiner pour le moment. Réessayez dans un instant.',
} as const satisfies Record<keyof typeof zh, string>
