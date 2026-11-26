# Hangul (HWP / HWPX) : édition, volet de travail et impression

GenOffice ouvre et modifie les documents Hangul `.hwp` et `.hwpx` dans un onglet, en conservant les raccourcis Hancom Hangul 2024, les styles, les tableaux, les mémos, l’impression et un panneau IA. Tout s’exécute localement sur votre PC.

## Ouverture, enregistrement et impression

- Ouvre les fichiers `.hwp` et `.hwpx` depuis l’Accueil, **Fichier > Ouvrir**, par glisser-déposer dans la fenêtre ou depuis Google Drive ; convertit les PDF en nouveaux onglets Hangul via **Fichier > Importer un PDF**.
- Enregistre dans le format d’origine du fichier (`.hwp` reste `.hwp`, `.hwpx` reste `.hwpx`), crée une sauvegarde `.bak` avant le premier écrasement, vérifie la relecture HWP et conserve des copies d’enregistrement automatique et de récupération après plantage.
- L’impression (Ctrl+P) prend en charge l’aperçu en direct, l’exportation PDF et les options de mise en page multipage.

## Volet de travail gauche : Plan et Rechercher

- Ouvrez le volet de travail gauche depuis le bouton de la barre supérieure, **Affichage > Volet de travail** (Plan / Rechercher), ou appuyez sur **Ctrl+F** pour accéder directement à l’onglet Rechercher. La recherche classique (**Ctrl+Q,F**) et Rechercher et remplacer (**Ctrl+H**) restent disponibles.
- **Onglet Plan** : répertorie les titres de plan Hangul natifs et les titres mappés par style (`제목 N` / `Heading N` par défaut, personnalisable par document ou pour toute l’application dans le tiroir des paramètres du plan). Filtrez par niveau (`1`, `2`, `3`, ... Tous), repliez des branches, cliquez pour y accéder, augmentez ou abaissez le niveau des titres (avec leurs sous-titres par défaut, ou maintenez **Maj** pour un seul titre) et faites glisser des titres pour réorganiser des sections entières en une seule étape d’annulation.
- **Onglet Rechercher** : recherche dans le corps du texte, les tableaux (y compris imbriqués), les zones de texte, les notes de bas de page et les notes de fin (hors en-têtes et pieds de page), avec des filtres de casse, mot entier, expressions régulières, style de paragraphe et mise en forme de caractères. Cliquez sur un résultat pour y accéder et le sélectionner, ou remplacez une occurrence, la sélection ou toutes les occurrences en une seule étape d’annulation (en ignorant les objets incorporés et les marques de citation avec un compteur).
- Le volet de travail mémorise son état d’ouverture, son onglet actif et sa largeur, se replie en barre d’icônes sur les fenêtres étroites et se masque en mode présentation et en aperçu avant impression. Toutes les fonctions du volet fonctionnent sans IA.

## Mémos, raccourcis et panneau IA

- Ouvrez la colonne Mémo depuis la barre supérieure ou **Insertion > Mémo** pour lire, ajouter, modifier et supprimer des mémos en texte brut à côté du document.
- Prend en charge les raccourcis clavier Hancom Hangul 2024, les repères de paragraphe de la règle horizontale, la copie de mise en forme (**Alt+C**), la conversion Hanja (**F9** / touche Hanja) et les informations du document (**Ctrl+Q,I**).
- Le panneau IA facultatif et les [commandes du terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) peuvent lire et modifier le texte, les styles, les tableaux, les équations, la mise en page, le plan et les résultats de recherche ; chaque modification IA correspond à une seule étape d’annulation.
