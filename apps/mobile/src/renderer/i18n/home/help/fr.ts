import type { zh } from './zh'

export const fr = {
  homeHelpSection: 'Aide',
  homeHelpClose: 'Fermer',
  homeHelpReplay: 'Revoir le guide de bienvenue',
  homeHelpReplayFailed: 'Impossible de réactiver le guide de bienvenue. Réessayez dans un instant.',
  homeHelpFeedback: 'Envoyer un commentaire',
  homeHelpWhatsNew: 'Nouveautés de cette version',

  homeHelpOpenTitle: 'Ouvrir des documents',
  homeHelpOpenBody1:
    'Dans l’onglet « Récents », touchez « Ouvrir un fichier » pour choisir un document sur cet appareil ou dans une autre app de stockage.',
  homeHelpOpenBody2:
    'Associez un dossier que vous utilisez souvent : ses documents s’affichent tout de suite dans l’onglet « Dossiers ».',
  homeHelpOpenBody3:
    'Les documents ouverts restent dans l’onglet « Récents ». Ajoutez une étoile pour les retrouver aussi dans « Favoris ».',
  homeHelpOpenBody4:
    'Un document s’ouvre d’abord en lecture. Pour le modifier, touchez [Modifier].',

  homeHelpEditTitle: 'Modifier et enregistrer',
  homeHelpEditBody1: 'En lecture, touchez [Modifier] en haut pour commencer vos changements.',
  homeHelpEditBody2:
    'Touchez le texte pour afficher le clavier. La barre au-dessus propose des mises en forme comme le gras ou les listes.',
  homeHelpEditBody3:
    'Quand vous avez fini, touchez [Terminer]. Le fichier d’origine est enregistré et vous revenez en lecture.',
  homeHelpEditBody4:
    'Si le fichier d’origine ne peut pas être modifié, utilisez « Enregistrer sous » pour créer un nouveau fichier.',

  homeHelpRecoveryTitle: 'Enregistrement et copies de récupération',
  homeHelpRecoveryBody1:
    'Pendant que vous modifiez, l’app garde d’elle-même une copie de récupération. Vous n’avez rien à toucher.',
  homeHelpRecoveryBody2: 'Le fichier d’origine est enregistré quand vous touchez [Terminer].',
  homeHelpRecoveryBody3:
    'Si l’app se ferme avant l’enregistrement, un avis de copie de récupération apparaît en haut de l’onglet « Récents » à la prochaine ouverture. Restaurez-la depuis cet avis.',
  homeHelpRecoveryBody4:
    'Dans Paramètres > Stockage, vous voyez la place prise par les copies de récupération et pouvez les effacer.',

  homeHelpShareTitle: 'Partager et recevoir',
  homeHelpShareBody1:
    'Pendant la lecture d’un document, touchez [Partager] pour envoyer l’original tel quel, ou dans un autre format comme PDF.',
  homeHelpShareBody2:
    'Dans une liste de l’écran d’accueil, choisissez [⋯] > Partager pour envoyer le fichier d’origine. Appuyez longuement pour sélectionner plusieurs fichiers et les envoyer ensemble.',
  homeHelpShareBody3:
    'Un fichier envoyé depuis une autre app s’ouvre en lecture seule. Pour le modifier, touchez [Modifier une copie]. L’original reste inchangé.',

  homeHelpFlowTitle: 'Mode lecture pour les HWP',
  homeHelpFlowBody1:
    'Les documents HWP s’ouvrent en vue page, tels qu’ils seraient imprimés. Pour adapter le texte à la largeur de l’écran, touchez [Mode lecture] dans les outils d’affichage.',
  homeHelpFlowBody2:
    'Pour revenir à la mise en page imprimée, touchez [Vue page] dans les outils d’affichage.',
  homeHelpFlowBody3:
    'Le mode lecture ne change que l’affichage. Les pages du document et le fichier enregistré restent les mêmes.',

  homeHelpAiTitle: 'Activer et désactiver l’IA',
  homeHelpAiBody1:
    'L’IA est désactivée au départ. Tant qu’elle l’est, aucun bouton d’IA n’apparaît.',
  homeHelpAiBody2:
    'Pour l’utiliser, activez l’IA dans les Paramètres, puis ajoutez une clé API ou choisissez une connexion gratuite dans « Connexions IA ». Aucun compte n’est nécessaire pour cette app.',
  homeHelpAiBody3:
    'Le contenu n’est envoyé au service d’IA choisi que lorsque vous demandez quelque chose à l’IA. Désactivez-la de nouveau et tous les boutons d’IA disparaissent.',

  homeHelpFeedbackTitle: 'Envoyer un commentaire',
  homeHelpFeedbackBody:
    "Le questionnaire s'ouvre dans votre navigateur. Les informations ci-dessous sont copiées dans le presse-papiers pour que vous puissiez les coller dans le questionnaire. L'application n'envoie rien elle-même et le contenu des documents n'est jamais inclus.",
  homeHelpFeedbackDetails: 'Version {version}\nSystème {os}\nLangue {language}',
  homeHelpFeedbackOpen: 'Ouvrir le questionnaire',
  homeHelpFeedbackCancel: 'Annuler',
  homeHelpFeedbackCopyFailed:
    'Impossible de copier dans le presse-papiers. Appuyez longuement sur le texte ci-dessous pour le copier, puis collez-le dans le questionnaire.',
  homeHelpFeedbackOpenFailed: 'Impossible d’ouvrir le navigateur.',

  homeHelpWhatsNewVersion: 'Version {version}',
  homeHelpWhatsNewEmpty: 'Aucune note pour cette version.',
  homeHelpNew010First: 'La première version de l’app mobile GenOffice.',
  homeHelpNew010Edit:
    'Ouvrez et modifiez des documents HWP, PDF, Markdown, HTML et des feuilles de calcul.',
  homeHelpNew010Read: 'Lisez des livres EPUB et des présentations PPT.',
  homeHelpNew010PdfTools:
    'Outils PDF : organiser les pages, convertir, réduire la taille et protéger, supprimer les annotations.',
  homeHelpNew010Ai:
    'Un assistant IA, désactivé au départ, qui fonctionne avec une clé API ou une connexion gratuite.',
  homeHelpNew010Mobile:
    'Partage et réception de fichiers, mode lecture pour les HWP, guide de bienvenue, gestion du stockage et écran maintenu allumé pendant la lecture.',
} as const satisfies Record<keyof typeof zh, string>
