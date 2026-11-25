import type { zh } from './zh'

export const fr = {
  pdfViewEditorName: 'Éditeur PDF',
  pdfViewLoading: 'Ouverture…',
  pdfViewOpenFailed:
    "Impossible d'ouvrir ce PDF. Le fichier est peut-être endommagé ou n'est pas un PDF.",
  pdfViewCertEncrypted:
    "Ce PDF est protégé par un certificat, pas par un mot de passe. Ouvrez-le dans l'application qui l'a émis.",
  pdfViewBlankUnavailable: 'Impossible de créer un nouveau PDF.',
  pdfViewPagesFailed: 'Certaines pages sont illisibles et s’affichent vides.',
  pdfViewPageBroken: 'Impossible d’afficher cette page',
  pdfViewPageLabel: 'Page {page}',
  pdfViewPageIndicator: 'Page {page} sur {count}',
  pdfViewInternalLink: 'Aller à la page liée',
  pdfViewPasswordTitle: 'Ce PDF est chiffré',
  pdfViewPasswordBody:
    '« {name} » est protégé par un mot de passe. Saisissez le mot de passe pour l’ouvrir.',
  pdfViewPasswordLabel: 'Mot de passe',
  pdfViewPasswordPlaceholder: 'Saisir le mot de passe',
  pdfViewPasswordShow: 'Afficher le mot de passe',
  pdfViewPasswordHide: 'Masquer le mot de passe',
  pdfViewPasswordOpen: 'Ouvrir',
  pdfViewPasswordWrong: 'Mot de passe incorrect, réessayez',
  pdfViewReadOnlyEncrypted: 'Document chiffré en lecture seule',
  pdfViewReadOnlyDamaged: 'Fichier endommagé : pages illisibles affichées vides, lecture seule',
  pdfViewReadOnlyNotWritable:
    'Ce fichier ne peut pas être enregistré à son emplacement : lecture seule',
  pdfViewSearch: 'Rechercher',
  pdfViewSearchPlaceholder: 'Rechercher dans le document',
  pdfViewSearching: 'Recherche…',
  pdfViewSearchNone: 'Aucun résultat',
  pdfViewSearchPrev: 'Précédent',
  pdfViewSearchNext: 'Suivant',
  pdfViewSearchClose: 'Fermer la recherche',
  pdfViewOutline: 'Signets',
  pdfViewOutlineEmpty: 'Ce document n’a pas de signets',
  pdfViewGoToPage: 'Aller à la page',
  pdfViewGoToPageLabel: 'Numéro de page (1–{count})',
  pdfViewGoToPageGo: 'Aller',
  pdfViewGoToPageInvalid: 'Saisissez un nombre entre 1 et {count}',
} as const satisfies Record<keyof typeof zh, string>
