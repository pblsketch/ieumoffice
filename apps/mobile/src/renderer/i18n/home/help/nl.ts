import type { zh } from './zh'

export const nl = {
  homeHelpSection: 'Help',
  homeHelpClose: 'Sluiten',
  homeHelpReplay: 'Welkomstrondleiding opnieuw tonen',
  homeHelpReplayFailed:
    'De welkomstrondleiding kon niet opnieuw worden aangezet. Probeer het zo nog eens.',
  homeHelpFeedback: 'Feedback sturen',
  homeHelpWhatsNew: 'Nieuw in deze versie',

  homeHelpOpenTitle: 'Documenten openen',
  homeHelpOpenBody1:
    'Tik op het tabblad Recent op "Bestand openen" om een document op dit apparaat of in een andere opslagapp te kiezen.',
  homeHelpOpenBody2:
    'Koppel een map die je vaak gebruikt, dan staan de documenten erin meteen op het tabblad Mappen.',
  homeHelpOpenBody3:
    'Documenten die je opent, blijven op het tabblad Recent staan. Geef een document een ster om het ook bij Favorieten terug te vinden.',
  homeHelpOpenBody4:
    'Een document opent eerst om te lezen. Wil je iets veranderen, tik dan op [Bewerken].',

  homeHelpEditTitle: 'Bewerken en opslaan',
  homeHelpEditBody1: 'Tik in de leesmodus bovenaan op [Bewerken] om wijzigingen te maken.',
  homeHelpEditBody2:
    'Tik op de tekst om het toetsenbord te openen. In de balk erboven vind je opmaak zoals vet en lijsten.',
  homeHelpEditBody3:
    'Ben je klaar, tik dan op [Gereed]. Het oorspronkelijke bestand wordt opgeslagen en je bent terug in de leesmodus.',
  homeHelpEditBody4:
    'Kan er niet naar het oorspronkelijke bestand worden geschreven, gebruik dan "Opslaan als" om een nieuw bestand te maken.',

  homeHelpRecoveryTitle: 'Opslaan en herstelkopieën',
  homeHelpRecoveryBody1:
    'Tijdens het bewerken houdt de app zelf een herstelkopie bij. Je hoeft nergens op te tikken.',
  homeHelpRecoveryBody2: 'Het oorspronkelijke bestand wordt opgeslagen als je op [Gereed] tikt.',
  homeHelpRecoveryBody3:
    'Sluit de app voordat je hebt opgeslagen, dan verschijnt de volgende keer bovenaan het tabblad Recent een melding over de herstelkopie. Daar kun je hem terugzetten.',
  homeHelpRecoveryBody4:
    'Bij Instellingen > Opslag zie je hoeveel ruimte herstelkopieën innemen en kun je ze wissen.',

  homeHelpShareTitle: 'Delen en ontvangen',
  homeHelpShareBody1:
    'Tik tijdens het bekijken van een document op [Delen] om het origineel te sturen zoals het is, of in een ander formaat zoals PDF.',
  homeHelpShareBody2:
    'Kies in een lijst op het beginscherm [⋯] > Delen om het oorspronkelijke bestand te sturen. Houd ingedrukt om meerdere bestanden te kiezen en ze samen te sturen.',
  homeHelpShareBody3:
    'Een bestand dat vanuit een andere app is gestuurd, opent alleen-lezen. Tik op [Kopie bewerken] om het te veranderen. Het origineel blijft zoals het was.',

  homeHelpFlowTitle: 'Leesweergave voor HWP',
  homeHelpFlowBody1:
    'HWP-documenten openen in de paginaweergave zoals ze afgedrukt worden. Tik in de weergaveopties op [Leesweergave] om de tekst aan het scherm aan te passen.',
  homeHelpFlowBody2:
    'Tik in de weergaveopties op [Paginaweergave] om terug te keren naar de afdrukweergave.',
  homeHelpFlowBody3:
    "De leesweergave verandert alleen hoe het document wordt getoond. De pagina's en het opgeslagen bestand blijven hetzelfde.",

  homeHelpAiTitle: 'AI aan- en uitzetten',
  homeHelpAiBody1: 'AI staat eerst uit. Zolang het uit staat, zie je geen AI-knoppen.',
  homeHelpAiBody2:
    'Wil je het gebruiken, zet AI dan aan in Instellingen en voeg bij AI-verbindingen een API-sleutel toe of kies een gratis verbinding. Je hebt geen account voor deze app nodig.',
  homeHelpAiBody3:
    'Inhoud gaat alleen naar de AI-dienst die je hebt gekozen als je de AI iets vraagt. Zet je AI weer uit, dan verdwijnen alle AI-knoppen.',

  homeHelpFeedbackTitle: 'Feedback sturen',
  homeHelpFeedbackBody:
    'De enquête opent in je browser. De gegevens hieronder worden naar het klembord gekopieerd zodat je ze in de enquête kunt plakken. De app verstuurt zelf niets en de inhoud van documenten wordt nooit meegestuurd.',
  homeHelpFeedbackDetails: 'Versie {version}\nSysteem {os}\nTaal {language}',
  homeHelpFeedbackOpen: 'Enquête openen',
  homeHelpFeedbackCancel: 'Annuleren',
  homeHelpFeedbackCopyFailed:
    'Kopiëren naar het klembord is mislukt. Houd de tekst hieronder ingedrukt om hem te kopiëren en plak hem daarna in de enquête.',
  homeHelpFeedbackOpenFailed: 'De browser kon niet worden geopend.',

  homeHelpWhatsNewVersion: 'Versie {version}',
  homeHelpWhatsNewEmpty: 'Er zijn geen notities voor deze versie.',
  homeHelpNew010First: 'De eerste versie van de mobiele app van GenOffice.',
  homeHelpNew010Edit: 'HWP-, PDF-, Markdown-, HTML- en spreadsheetdocumenten openen en bewerken.',
  homeHelpNew010Read: 'EPUB-boeken en PPT-presentaties lezen.',
  homeHelpNew010PdfTools:
    "PDF-hulpmiddelen: pagina's ordenen, converteren, kleiner maken en beveiligen, aantekeningen verwijderen.",
  homeHelpNew010Ai:
    'Een AI-assistent, eerst uitgeschakeld, die werkt met een API-sleutel of een gratis verbinding.',
  homeHelpNew010Mobile:
    'Bestanden delen en ontvangen, leesweergave voor HWP, een welkomstrondleiding, opslagbeheer en het scherm aan laten tijdens het lezen.',
} as const satisfies Record<keyof typeof zh, string>
