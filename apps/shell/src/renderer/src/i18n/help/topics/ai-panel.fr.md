# Le panneau d’assistant IA

Chaque éditeur peut appeler le panneau IA: sélectionnez quelque chose, donnez une instruction, regardez le résultat en flux.

## L’ouvrir et s’en servir

- Le panneau a besoin d’une IA connectée. Si aucune ne l’est, il affiche les cartes de connexion au lieu d’une erreur ; voir [Connexion par abonnement](help://subscription).
- Entrées: le **bouton IA** du ruban de chaque éditeur, **Demander à l’IA** dans les menus contextuels, ou Demander à l’IA sur la barre de marquage.
- Décrivez la tâche en langage naturel (réécrire ceci / transformer cette colonne en pourcentages / remettre cette page en page…) et appuyez sur Entrée.
- Les réponses sont rendues **en flux**; lorsque l’IA a besoin d’outils (lire le document, le modifier), elle les exécute et continue jusqu’au bout.
- **Arrêter**: interrompez le tour en cours à tout moment.
- **File d'attente** : pendant qu'une réponse arrive, Entrée met votre message en file plutôt que de le jeter — une bande au-dessus de la saisie les compte ; ouvrez-la pour modifier, retirer, réordonner, mettre en pause ou vider. Le message suivant part tout seul à la fin du tour ; Échap arrête toujours le tour.

## Quelle IA répond

- La liste des modèles en bas du panneau montre l’IA utilisée et permet d’en choisir une autre : vos abonnements d’abord, puis les fournisseurs à clé que vous avez configurés.
- Dès que vous avez utilisé 80 % ou plus de la limite d’un abonnement, une ligne telle que « 85 % utilisés · réinitialisation à 15:00 » apparaît dans le panneau.
- Si une requête est arrêtée — la limite est atteinte, ou la connexion au compte a expiré —, le panneau dit pourquoi et ne bascule pas de lui-même vers une autre IA. Lorsque votre autre abonnement est connecté, un bouton **Continuer avec …** le propose.

## Ce qu’il sait faire

- **Docs**: réécriture/développement/traduction/résumé, insertion de tableaux et d’images, ajustement de la mise en forme; chaque tour enregistre d’abord un instantané.
- **Sheets**: formules, remplissage de données, transformations par lots, mise en forme.
- **Slides**: génération d’un diaporama complet, ajustement de la disposition, réécriture des textes.
- **PDF**: questions et résumés sur le texte ou les pages sélectionnées.
- **Markdown / HTML**: réécriture, développement, traduction.
- **Accueil ▸ Ask AI** répond à partir de vos fichiers étoilés et les cite — le panneau de base de connaissances a sa propre section au chapitre Accueil, et le panneau IA de Docs porte la même compétence.

## Joindre des documents ouverts

Dans le panneau IA des éditeurs Docs, Sheets, Slides, Hangul, HTML et carte mentale, vous pouvez joindre comme documentation d’autres documents ouverts dans GenOffice, ou ouverts récemment. Un document joint est traité exactement comme un fichier choisi sur votre PC.

- **`@` dans la saisie** : tapez `@` au début de la saisie ou après une espace pour ouvrir une liste de documents. Si la fenêtre est partagée, le document de l’autre volet vient en premier, puis les autres documents ouverts et les documents récents ; le document dans lequel vous êtes n’y figure pas. Affinez avec quelques lettres du nom (les espaces sont acceptées) et choisissez avec Entrée ou un clic : `@nom du document` s’insère dans la saisie et le document est joint. **Chercher d’autres…**, tout en bas, ouvre la fenêtre de choix de documents décrite ci-dessous.
- **Joindre depuis les documents GenOffice** : ce bouton, à côté du bouton de pièce jointe, ouvre la même liste dans une fenêtre où vous pouvez cocher plusieurs documents et les joindre en une fois.
- Les documents qui ont des modifications non enregistrées et les nouveaux documents jamais enregistrés apparaissent grisés et ne peuvent pas être choisis. Enregistrez-les puis choisissez-les à nouveau : l’IA lit le fichier enregistré.
- Quand deux documents portent le même nom dans des dossiers différents, le nom du dossier juste au-dessus est ajouté, comme dans `@plan.docx(2e trimestre)`, et ce nom de dossier est aussi transmis à l’IA.
- Les éditeurs PDF et Markdown n’ont pas encore de pièces jointes : aucune des deux méthodes n’y est disponible.

## Projets

- Cliquez sur le nom du projet, à gauche sous la zone de saisie, pour choisir un projet (un dossier de votre PC). L’IA répond alors en connaissant les fichiers, les consignes et la mémoire de ce dossier, et la conversation est conservée dans le dossier : vous pouvez donc la poursuivre dans un autre éditeur. Voir [Projets](help://projects).
- Quand un projet est choisi, le titre de la conversation en cours apparaît en haut du panneau. Cliquez dessus pour voir la liste des conversations de ce projet et **Nouvelle conversation**.
- La liste `@` de la zone de saisie affiche « Fichiers de ce projet » après les documents ouverts.
- Une requête faite avec un projet choisi envoie aussi à l’IA que vous utilisez les consignes (avec `AGENTS.md` et `CLAUDE.md` à la racine du dossier, que vous pouvez désactiver sur la page du projet), la mémoire et la liste des noms de fichiers de ce projet, un court extrait de chaque fichier que l’IA trouve en cherchant dans le dossier, ainsi que le texte de chaque fichier que l’IA lit.

## Retour arrière et sécurité

- Le panneau de Docs conserve une **liste de versions**: un instantané par tour, revenez à n’importe lequel, et ce retour arrière est lui-même annulable par Ctrl+Z. Les instantanés survivent à la réouverture du document.
- Les modifications de l’IA passent par le même pipeline d’édition que les modifications manuelles (annulables, soumises à l’enregistrement) — rien ne contourne votre confirmation d’enregistrement.

## Masquer les informations sensibles

- Dans les éditeurs Docs, Sheets, Slides, Hangul, Markdown et HTML, vous pouvez tenir une partie d’un document à l’écart de l’IA : sélectionnez-la, clic droit ▸ **Masquer les informations sensibles**, puis donnez-lui une étiquette. L’IA lit `{{étiquette}}` à sa place, quelle que soit l’IA utilisée. (Markdown active l’entrée avec la bascule œil barré de son ruban ; celle de HTML se trouve dans le panneau source ; dans Sheets, un clic droit sur un en-tête de colonne masque la colonne sous sa ligne d’en-tête, et un clic droit sur une plage de cellules masque seulement cette plage.)
- Le fichier garde le vrai texte : enregistrement, impression et export PDF restent intacts, et la marque survit à la réouverture. Le même menu arrête le masquage. Dans Hangul, chaque partie masquée est un commentaire qui indique `[Masquer les informations sensibles] étiquette` : la personne qui reçoit le document voit donc aussi ce commentaire, et un texte qui porte déjà un commentaire ne peut pas être masqué. Dans Sheets, la marque est un nom défini `IeumHide_étiquette`, visible dans le Gestionnaire de noms ; l’IA voit chaque cellule masquée sous la forme `{{étiquette-01}}` (une même valeur reçoit le même numéro), et une cellule dont la formule utilise des cellules masquées est masquée elle aussi.
- **Rechercher les informations sensibles**, dans le panneau IA, liste ce qui ressemble à des noms, des numéros de téléphone, des adresses e-mail, des numéros d’enregistrement de résident, des numéros de compte et de carte, des adresses postales, etc. La recherche se fait sur ce PC, avec des motifs de texte fixes uniquement — aucune IA ne sert à trouver ni à masquer quoi que ce soit — et rien n’est masqué tant que vous n’avez pas choisi **Masquer**. **Exclure** empêche un candidat de réapparaître pour ce document. Les endroits qui ne peuvent pas porter de marque (un en-tête, une note du présentateur, un nom de feuille…) figurent dans la liste pour que vous les modifiiez vous-même.
- La première fois que vous envoyez une requête dans un onglet, si le document ou les pièces jointes de cette requête contiennent encore de tels candidats, le panneau vous pose la question une fois : **Vérifier** n’envoie rien et ouvre la liste, **Envoyer quand même** envoie.
- HTML masque les contenus d’éléments, les valeurs d’attributs et les littéraux de chaîne des scripts, et la page rendue ne change jamais. Slides masque aussi des images, vidéos et audios entiers, et une diapositive au contenu masqué n’est jamais envoyée en capture.
- Les parties masquées le restent quand le fichier est joint dans un autre éditeur, quand vous posez une question à son sujet depuis l’accueil, quand il est lu par la commande `ieumoffice` et ses outils MCP, ou via le serveur MCP de l’application. Une conversion vers un format qui n’a pas de place pour la marque (ODT, CSV…) vous demande d’abord confirmation. Le masquage ne s’applique pas aux fichiers qu’un programme en mode agent lit directement sur le disque, et les images de page (`render`) montrent le texte tel quel.

## Confidentialité

- Les instructions et le contenu pertinent du document vont à l’**IA que vous utilisez** : à Anthropic ou à OpenAI sous votre propre compte lorsque vous utilisez un abonnement, ou au fournisseur dont vous avez saisi la clé. Si aucune IA n’est connectée, rien n’est envoyé.
- L’utilisation du contenu d’un abonnement pour entraîner l’IA dépend des paramètres de votre propre compte auprès de cette société.
- Les fichiers locaux ne sont envoyés nulle part ailleurs; les clés API sont stockées dans le fichier de paramètres de l'application sur cet ordinateur et envoyées uniquement dans les en-têtes de requête.
