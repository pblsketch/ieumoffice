import type { zh } from './zh'

export const it = {
  homeHelpSection: 'Aiuto',
  homeHelpClose: 'Chiudi',
  homeHelpReplay: 'Rivedi la guida di benvenuto',
  homeHelpReplayFailed:
    'Non è stato possibile riattivare la guida di benvenuto. Riprova tra un momento.',
  homeHelpFeedback: 'Invia feedback',
  homeHelpWhatsNew: 'Novità di questa versione',

  homeHelpOpenTitle: 'Aprire i documenti',
  homeHelpOpenBody1:
    'Nella scheda «Recenti» tocca «Apri file» per scegliere un documento su questo dispositivo o in un’altra app di archiviazione.',
  homeHelpOpenBody2:
    'Collega una cartella che usi spesso: i suoi documenti compaiono subito nella scheda «Cartelle».',
  homeHelpOpenBody3:
    'I documenti aperti restano nella scheda «Recenti». Aggiungi una stella per trovarli anche in «Preferiti».',
  homeHelpOpenBody4:
    'Un documento si apre prima in lettura. Quando vuoi modificarlo, tocca [Modifica].',

  homeHelpEditTitle: 'Modificare e salvare',
  homeHelpEditBody1: 'In lettura, tocca [Modifica] in alto per iniziare a fare modifiche.',
  homeHelpEditBody2:
    'Tocca il testo per far comparire la tastiera. La barra sopra offre formattazioni come grassetto ed elenchi.',
  homeHelpEditBody3:
    'Quando hai finito, tocca [Fine]. Il file originale viene salvato e torni alla lettura.',
  homeHelpEditBody4:
    'Se non è possibile scrivere sul file originale, usa «Salva con nome» per creare un nuovo file.',

  homeHelpRecoveryTitle: 'Salvataggio e copie di ripristino',
  homeHelpRecoveryBody1:
    'Mentre modifichi, l’app tiene da sola una copia di ripristino. Non devi toccare nulla.',
  homeHelpRecoveryBody2: 'Il file originale viene scritto quando tocchi [Fine].',
  homeHelpRecoveryBody3:
    'Se l’app si chiude prima del salvataggio, alla successiva apertura in cima alla scheda «Recenti» compare un avviso sulla copia di ripristino. Ripristinala da lì.',
  homeHelpRecoveryBody4:
    'In Impostazioni > Archiviazione puoi vedere quanto spazio occupano le copie di ripristino ed eliminarle.',

  homeHelpShareTitle: 'Condividere e ricevere',
  homeHelpShareBody1:
    'Mentre guardi un documento, tocca [Condividi] per inviare l’originale così com’è oppure in un altro formato, come PDF.',
  homeHelpShareBody2:
    'In un elenco della schermata Home, scegli [⋯] > Condividi per inviare il file originale. Tieni premuto per selezionare più file e inviarli insieme.',
  homeHelpShareBody3:
    'Un file inviato da un’altra app si apre in sola lettura. Per modificarlo, tocca [Modifica una copia]. L’originale resta com’era.',

  homeHelpFlowTitle: 'Vista lettura per HWP',
  homeHelpFlowBody1:
    'Sul telefono i documenti HWP si aprono in vista lettura. Il testo si adatta alla larghezza dello schermo, così puoi leggere senza ingrandire.',
  homeHelpFlowBody2:
    'Per vedere le pagine come verrebbero stampate, tocca [Vista pagina] negli strumenti di visualizzazione.',
  homeHelpFlowBody3:
    'La vista lettura cambia solo il modo in cui il documento viene mostrato. Le pagine e il file salvato restano gli stessi.',

  homeHelpAiTitle: 'Attivare e disattivare l’IA',
  homeHelpAiBody1:
    'All’inizio l’IA è disattivata. Finché resta disattivata, non compare nessun pulsante dell’IA.',
  homeHelpAiBody2:
    'Per usarla, attiva l’IA nelle Impostazioni, poi aggiungi una chiave API o scegli una connessione gratuita in «Connessioni IA». Non serve un account per questa app.',
  homeHelpAiBody3:
    'I contenuti vanno al servizio di IA che hai scelto solo quando chiedi qualcosa all’IA. Disattivala di nuovo e tutti i pulsanti dell’IA spariscono.',

  homeHelpFeedbackTitle: 'Invia feedback',
  homeHelpFeedbackBody:
    "Il sondaggio si apre nel browser. I dati qui sotto vengono copiati negli appunti per poterli incollare nel sondaggio. L'app non invia nulla da sola e il contenuto dei documenti non viene mai incluso.",
  homeHelpFeedbackDetails: 'Versione {version}\nSistema {os}\nLingua {language}',
  homeHelpFeedbackOpen: 'Apri il sondaggio',
  homeHelpFeedbackCancel: 'Annulla',
  homeHelpFeedbackCopyFailed:
    'Non è stato possibile copiare negli appunti. Tieni premuto il testo qui sotto per copiarlo, poi incollalo nel sondaggio.',
  homeHelpFeedbackOpenFailed: 'Non è stato possibile aprire il browser.',

  homeHelpWhatsNewVersion: 'Versione {version}',
  homeHelpWhatsNewEmpty: 'Non ci sono note per questa versione.',
  homeHelpNew010First: 'La prima versione dell’app mobile di GenOffice.',
  homeHelpNew010Edit: 'Apri e modifica documenti HWP, PDF, Markdown, HTML e fogli di calcolo.',
  homeHelpNew010Read: 'Leggi libri EPUB e presentazioni PPT.',
  homeHelpNew010PdfTools:
    'Strumenti PDF: organizzare le pagine, convertire, ridurre le dimensioni e proteggere, rimuovere le annotazioni.',
  homeHelpNew010Ai:
    'Un assistente IA, disattivato all’inizio, che funziona con una chiave API o una connessione gratuita.',
  homeHelpNew010Mobile:
    'Condivisione e ricezione di file, vista lettura per HWP, guida di benvenuto, gestione dell’archiviazione e schermo sempre acceso durante la lettura.',
} as const satisfies Record<keyof typeof zh, string>
