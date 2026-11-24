# Opérations sur les fichiers : renommer, supprimer, exporter

Ce chapitre couvre les opérations sur les fichiers communes à tous les éditeurs ; les options d’export propres à chaque éditeur sont dans son chapitre.

Le **menu ⋯** de la ligne (survolez une ligne de fichier) rassemble ces actions :

![Le menu ⋯ d’une ligne de fichier](img/file-ops.png)

## Renommer

Deux points d’entrée, un même ensemble de contrôles :

- **⋯ ▸ Renommer** sur une ligne de l’accueil.
- **Double-cliquez sur un onglet de fichier** pour renommer sur place (voir [Onglets et gestion des fenêtres](help://tabs-and-windows)).

Règles : l’extension est conservée automatiquement ; les caractères interdits, les points finais et les noms réservés (CON/NUL et consorts) sont refusés avec un message ; un conflit de nom dans le même dossier est également bloqué. Le vrai fichier sur le disque est renommé, et les récents et les favoris suivent.

## Supprimer

- **⋯ ▸ Supprimer** sur l’accueil : demande quels fichiers, puis les déplace vers la **corbeille du système**, où l’OS peut les restaurer. GenOffice ne conserve aucune annulation propre pour cela — la récupération relève de la corbeille, pas d’une notification.

## Dupliquer

**⋯ ▸ Dupliquer** crée une copie nommée « <name> copy » dans le même dossier ; les collisions reçoivent automatiquement un compteur. La copie rejoint les **Récents** au lieu de s’ouvrir : à un clic de vous, pas devant vous.

## Enregistrer et Enregistrer sous

- **⌘S / ctrl+S** enregistre le fichier courant ; un fichier sans titre demande d’abord l’emplacement et le nom.
- Dans la plupart des éditeurs, la liste des types de fichier de la boîte Enregistrer sous propose aussi les formats d’exportation (PDF, images, autres formats de document). En choisir un n’écrit qu’une copie ; le document ouvert et son onglet restent sur le fichier d’origine. Les images de plusieurs pages sont réparties en `nom-01.png`, `nom-02.png`, ….
- **Docs** : la liste Enregistrer sous propose aussi .hwp et .hwpx (Fichier ▸ Exporter en document HWP… fait de même). Si un élément ne peut pas être repris, comme des commentaires, des équations ou des zones de texte, vous en êtes averti avant l’écriture du fichier.
- **Enregistrer sous** écrit un nouveau fichier et laisse l’original intact ; les modifications suivantes ciblent le nouveau fichier.
- Chaque enregistrement est atomique (fichier temporaire puis renommage) ; quitter en cours d’écriture ne peut pas corrompre le fichier.
- L’enregistrement automatique suit le commutateur de chaque éditeur ; un nouveau document sans fichier ne commence qu’après sa première sauvegarde (voir [Démarrage rapide](help://getting-started)).

## Export en PDF

- **Docs** : Fichier ▸ Exporter en PDF (ou le bouton du ruban), paginé selon la mise en page courante.
- **Slides** : l’export rastérise page par page, avec progression pour les gros diaporamas.
- **Sheets** : l’export suit la pagination d’impression.
- Les exports sont rendus dans une fenêtre masquée et arrivent là où vous le choisissez.

## Export en Word / images

- **PDF ▸ PDF en Word** : transforme le PDF en .docx (conversion locale ; les mises en page complexes sont au mieux préservées).
- **Docs** peut exporter les pages en images (un PNG par page).

## Impression

Fichier ▸ Imprimer (⌘P/ctrl+P) ouvre une fenêtre d’impression avec aperçu en direct dans chaque éditeur — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram et Whiteboard. Sans modification sous Mise en page via la boîte de dialogue système, l’impression fonctionne comme avant.

- **Sortie (imprimante, PDF, images)** : choisissez une imprimante installée, **Enregistrer en PDF**, **Enregistrer en images** ou **Boîte de dialogue système** dans une seule liste. L’export d’images prend en charge PNG et JPG (Élevée 90 %, Moyenne 80 %, Fichier léger 65 %) en fichiers numérotés séparés ou en archive ZIP. Les PDF protégés désactivent l’enregistrement PDF et image tout en conservant l’impression.
- **Aperçu avant impression en direct** : les dix éditeurs affichent un aperçu avant la sortie. Lorsque la mise en page, les niveaux de gris, un filigrane ou les en-têtes/pieds de page modifient le rendu, l’aperçu génère les faces finales à la demande avec navigation, zoom et bascule vers le schéma.
- **Mise en page** : choisissez Une page par feuille, Plusieurs pages par feuille (2, 4, 6, 9 ou 16, avec bordures en option), Livret (reliure gauche ou droite), Affiche (colonnes × lignes, chevauchement, traits de coupe et repères de tuiles) ou Étiquettes (une page par étiquette ou répétition, cellule de départ, formats A4 ou sur mesure).
- **Échelle, orientation, faces et ordre** : sélectionnez Taille réelle (100 %), Ajuster au papier, Réduire les pages trop grandes ou Échelle personnalisée (10 %–400 %), ainsi que l’orientation Automatique, Vertical ou Horizontal. Faces impaires, faces paires et ordre inverse s’appliquent aux faces finales.
- **Filigrane, en-têtes/pieds de page, niveaux de gris et résolution** : ajoutez un filigrane texte ou image ainsi que 6 zones d’en-tête et pied de page (titre, date, numéro de page ou texte libre) uniquement à l’impression, sans modifier le document. Les niveaux de gris et la résolution (Automatique, 150, 300 ou 600 dpi) contrôlent la qualité.
- **Plages de pages et sélection** : Docs et Markdown réimpriment le texte sélectionné dès la page 1 ; Slides imprime les diapositives choisies ; PDF les pages choisies ; Hangul propose Tout, Page actuelle ou Plage personnalisée ; Sheets imprime la feuille active, le classeur ou la sélection.
- **Boîte de dialogue système** : pour un livret, activez le recto verso sur le bord court et laissez la plage de pages ainsi que le nombre de pages par feuille inchangés.

Les PDF s’impriment selon l’ordre et l’orientation actuels des pages.

## Où vivent les fichiers sans titre

L’emplacement que vous choisissez à la première sauvegarde est son domicile. Avant cela, le document n’a pas de fichier à lui : son contenu non enregistré n’existe que sous forme de copie de récupération dans le dossier de données de l’application, ce qui permet de le retrouver si l’application s’arrête brusquement (voir [Onglets et gestion des fenêtres](help://tabs-and-windows)). L’enregistrement automatique ne prend le relais qu’après cette première sauvegarde.
