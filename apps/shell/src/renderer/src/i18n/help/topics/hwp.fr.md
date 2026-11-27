# Hangul (HWP / HWPX) : édition, volet de travail et impression

GenOffice ouvre et modifie les documents Hangul `.hwp` et `.hwpx` dans un onglet, avec raccourcis clavier, styles, tableaux, mémos, impression et panneau IA. Tout s’exécute localement sur votre PC.

## Ouverture, enregistrement et impression

- Ouvre les fichiers `.hwp` et `.hwpx` depuis l’Accueil, **Fichier > Ouvrir**, par glisser-déposer dans la fenêtre ou depuis Google Drive ; convertit les PDF en nouveaux onglets Hangul via **Fichier > Importer un PDF**.
- Enregistre dans le format d’origine du fichier (`.hwp` reste `.hwp`, `.hwpx` reste `.hwpx`), crée une sauvegarde `.bak` avant le premier écrasement, vérifie la relecture HWP et conserve des copies d’enregistrement automatique et de récupération après plantage.
- L’impression (Ctrl+P) prend en charge l’aperçu en direct, l’exportation PDF et les options de mise en page multipage.

## Volet de travail gauche : Plan, Rechercher et Références

- Ouvrez le volet de travail gauche depuis le bouton de la barre supérieure, **Affichage > Volet de travail** (Plan / Rechercher / Références), ou appuyez sur **Ctrl+F** pour accéder directement à l’onglet Rechercher. La recherche classique (**Ctrl+Q,F**) et Rechercher et remplacer (**Ctrl+H**) restent disponibles.
- **Onglet Plan** : répertorie les titres de plan Hangul natifs et les titres mappés par style (`제목 N` / `Heading N` par défaut, personnalisable par document ou pour toute l’application dans le tiroir des paramètres du plan). Filtrez par niveau (`1`, `2`, `3`, ... Tous), repliez des branches, cliquez pour y accéder, augmentez ou abaissez le niveau des titres (avec leurs sous-titres par défaut, ou maintenez **Maj** pour un seul titre) et faites glisser des titres pour réorganiser des sections entières en une seule étape d’annulation.
- **Onglet Rechercher** : recherche dans le corps du texte, les tableaux (y compris imbriqués), les zones de texte, les notes de bas de page et les notes de fin (hors en-têtes et pieds de page), avec des filtres de casse, mot entier, expressions régulières, style de paragraphe et mise en forme de caractères. Cliquez sur un résultat pour y accéder et le sélectionner, ou remplacez une occurrence, la sélection ou toutes les occurrences en une seule étape d’annulation (en ignorant les objets incorporés et les marques de citation avec un compteur).
- Le volet de travail mémorise son état d’ouverture, son onglet actif et sa largeur, se replie en barre d’icônes sur les fenêtres étroites et se masque en mode présentation et en aperçu avant impression. Toutes les fonctions du volet fonctionnent sans IA.

## Mémos, raccourcis et panneau IA

- Ouvrez la colonne Mémo depuis la barre supérieure ou **Insertion > Mémo** pour lire, ajouter, modifier et supprimer des mémos en texte brut à côté du document.
- Prend en charge les raccourcis d’édition Hangul, les repères de paragraphe de la règle horizontale, la copie de mise en forme (**Alt+C**), la conversion Hanja (**F9** / touche Hanja) et les informations du document (**Ctrl+Q,I**).
- Le panneau IA facultatif et les [commandes du terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) peuvent lire et modifier le texte, les styles, les tableaux, les équations, la mise en page, le plan et les résultats de recherche ; chaque modification IA correspond à une seule étape d’annulation.

## Table des matières : créer et mettre à jour

- Utilisez **Outils > Créer une table des matières** (ou **Outils > Mettre à jour la table des matières**, ou un clic droit dans une table des matières) pour insérer une **table des matières** à partir des titres du Plan, ainsi que des **listes des tableaux**, **des figures** et **des équations** issues des légendes d’objets et des paragraphes de légende.
- Choisissez la mise en page **Points de suite** (par défaut) ou **Tableau sans bordure** (2 colonnes), réglez la profondeur des titres (niveaux 1–10, 3 par défaut), personnalisez le titre et ajoutez éventuellement des liens cliquables (cliquez ou faites **Ctrl+clic** sur une ligne pour accéder directement au titre).
- Les numéros de page reflètent la numérotation imprimée, y compris les redémarrages de numérotation et les formats romains ou personnalisés.
- La mise à jour actualise les entrées et les numéros de page sur place, vous avertit avant d’écraser des lignes modifiées manuellement et détecte les tables des matières non balisées créées par un autre programme afin de demander votre confirmation avant de les remplacer.

## Index : marquer des entrées et générer l’index

- Utilisez **Outils > Marquer une entrée d’index** (ou un clic droit dans le corps du texte) pour marquer le mot sélectionné ou situé sous le curseur, ajouter une sous-entrée facultative ou cocher **Marquer toutes les occurrences correspondantes** (corps du texte uniquement ; le nombre d’occurrences ignorées dans les tableaux, zones de texte et notes est indiqué). La même boîte de dialogue permet de consulter et de supprimer les marques existantes.
- Utilisez **Outils > Créer un index** pour insérer l’index à la position du curseur, puis **Outils > Mettre à jour l’index** après vos modifications. Le titre par défaut (« Index ») est personnalisable.
- Les entrées sont triées selon l’ordre coréen (가나다) → anglais (ABC) → autres, avec en-têtes de groupe par consonne ou lettre en option, 1–3 colonnes (2 par défaut, limitées à l’index afin de préserver les colonnes du reste du document) et mise en page **Points de suite** ou **Tableau sans bordure**.

## Alerte de mise à jour et copie de soumission

- Lors d’un enregistrement manuel, d’une impression, d’un export PDF ou d’un enregistrement en copie de soumission, l’éditeur vérifie si les tables des matières ou l’index ne sont plus à jour et propose de tout actualiser en une seule étape d’annulation. Cette vérification ne s’exécute jamais pendant l’enregistrement automatique et ne bloque jamais la sauvegarde.
- Utilisez **Fichier > Enregistrer comme copie de soumission** pour enregistrer une copie distincte et propre, débarrassée des marques internes d’édition (marques d’index, bornes de bloc d’index et paramètres enregistrés), tout en conservant les tables des matières, les ancres de titres et les liens. Votre fichier de travail d’origine reste intact pour pouvoir continuer à le mettre à jour par la suite.

## Références et citations

- Ouvrez l’onglet **Références** du volet de travail gauche (ou **Outils > Références**) pour gérer une bibliothèque locale unique sur votre PC avec recherche, étiquettes, ajout/modification/suppression, importation et exportation (`BibTeX`, `RIS`, `CSL JSON`), ainsi que l’importation de lignes depuis une liste de références existante du document avec aperçu de confirmation.
- Prend en charge quatre styles de citation (**APA 7**, **Chicago**, **MLA 9** et **IEEE** ; les références coréennes suivent la mise en forme académique coréenne dans les quatre styles). Insérez des citations entre parenthèses, narratives ou multiples avec numéros de page et créez ou actualisez une bibliographie à retrait suspendu ; changer de style met à jour les citations marquées et la bibliographie en une seule étape d’annulation tout en préservant les citations modifiées à la main.
- L’onglet de vérification intégré en 6 points (absent de la bibliographie, entrées non citées, ordre de tri, suffixes a/b manquants, citations modifiées manuellement et références non vérifiées) permet de cliquer pour sauter à chaque anomalie, avec des rappels avant enregistrement manuel, impression ou exportation si la bibliographie ou la numérotation IEEE est obsolète.
- La recherche de références par IA facultative (lorsque les outils Internet sont activés) ajoute toujours les candidats comme **Non vérifiés** avec l’URL source dans les notes ; ils ne peuvent être cités ni ajoutés à la bibliographie tant que vous ne les avez pas contrôlés et marqués **Vérifiés** vous-même.

## Macros : enregistrement de touches et scripts

- Utilisez **Outils > Macros** (ou **Alt+Shift+H** pour démarrer ou arrêter l'enregistrement des touches, et **Alt+Shift+X** pour l'arrêter) afin d'enregistrer la saisie, les déplacements du curseur, la mise en forme, les styles, les tableaux et les éditions prises en charge directement sous forme de script modifiable. Un indicateur d'enregistrement s'affiche dans la barre supérieure et toute action non prise en charge ou tout clic de souris est signalé aussitôt puis récapitulé dans la liste des étapes ignorées.
- Ouvrez le **Gestionnaire de macros** pour gérer vos macros enregistrées localement, attribuer jusqu'à 11 emplacements de raccourcis (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), modifier les scripts avec indication de ligne et de colonne en cas d'erreur de syntaxe, et exporter ou importer des fichiers texte `.ieummacro`. Tout script importé est affiché en entier et doit être confirmé puis enregistré avant de pouvoir être exécuté ; les macros intégrées aux fichiers de document ne sont jamais lues ni exécutées. Sur macOS, démarrez et gérez les macros depuis le menu **Outils > Macros**, car les raccourcis avec la touche Option saisissent des caractères.
- Chaque macro s'exécute de manière synchrone dans un interpréteur restreint compatible avec l'API de document de l'application et les objets de script de macro compatibles (`HAction`, `HParameterSet`), avec des limites de durée, d'étapes, de profondeur d'appel et de mémoire ainsi qu'une protection des objets et des mémos. Une exécution correspond toujours à une seule étape d'annulation et annule toutes les modifications en cas d'erreur, d'action non prise en charge ou de dépassement de limite.
- La fonction facultative **Écrire avec l'IA** (visible dans l'éditeur de macros uniquement lorsque l'IA est activée) permet de décrire une tâche répétitive pour générer un brouillon de script ; seuls votre description et le guide de l'API de macro sont envoyés, jamais le document. Le brouillon s'insère uniquement dans la zone d'édition et n'est jamais enregistré ni exécuté automatiquement.
