# Operazioni sui file: rinomina, eliminazione, esportazione

Questo capitolo raccoglie le operazioni sui file comuni a tutti gli editor; le opzioni di esportazione specifiche di ciascun editor sono nel suo capitolo.

Il **⋯ menu** della riga (compare passando il puntatore su una riga di file) raccoglie queste azioni:

![Il ⋯ menu di una riga di file](img/file-ops.png)

## Rinomina

Due punti d'ingresso, un unico insieme di controlli:

- **⋯ ▸ Rinomina** su una riga di Home.
- **Doppio clic su una scheda di file** per rinominare direttamente lì (vedi [Schede e gestione delle finestre](help://tabs-and-windows)).

Regole: l'estensione viene conservata automaticamente; i caratteri non ammessi, i punti finali e i nomi riservati (CON/NUL e simili) vengono rifiutati con un messaggio; anche un conflitto di nome nella stessa cartella viene bloccato. Viene rinominato il vero file su disco, e gli elenchi dei recenti e dei preferiti si aggiornano di conseguenza.

## Eliminazione

- **⋯ ▸ Elimina** su Home: chiede quali file, poi li sposta nel **cestino di sistema**, dove il sistema operativo può recuperarli. GenOffice non mantiene un annulla tutto suo per questo — il recupero è compito del cestino, non di un avviso.

## Duplicazione

**⋯ ▸ Duplica** crea una copia di <name> nella stessa cartella; in caso di nome duplicato viene aggiunto automaticamente un contatore. La copia finisce nei **Recenti** invece di essere aperta: a un clic di distanza invece che davanti a te.

## Salva e Salva con nome

- **⌘S / ctrl+S** salva il file corrente; un file senza titolo chiede prima percorso e nome.
- Nella maggior parte degli editor, l’elenco dei tipi di file della finestra Salva con nome offre anche i formati di esportazione (PDF, immagini, altri formati di documento). Sceglierne uno scrive solo una copia; il documento aperto e la sua scheda restano sul file originale. Le immagini di più pagine vengono divise in `nome-01.png`, `nome-02.png`, ….
- **Docs**: l’elenco Salva con nome offre anche .hwp e .hwpx (File ▸ Esporta come documento HWP… fa lo stesso). Se qualcosa non può essere trasferito, come commenti, equazioni o caselle di testo, viene segnalato prima di scrivere il file.
- **Salva con nome…** scrive un file nuovo e lascia intatto l'originale; le modifiche successive riguardano il file nuovo.
- Ogni salvataggio è atomico (file temporaneo + rinomina); un'uscita a metà scrittura non può corrompere il file.
- Il salvataggio automatico segue l’interruttore di ogni editor; un nuovo documento senza file proprio inizia dopo il primo salvataggio (vedi [Avvio rapido](help://getting-started)).

## Esportazione in PDF

- **Docs**: File ▸ Esporta come PDF… (oppure il pulsante nella barra multifunzione), con l'impaginazione corrente.
- **Slides**: l'esportazione rasterizza pagina per pagina, con l'avanzamento per le presentazioni grandi.
- **Sheets**: l'esportazione segue l'impaginazione di stampa.
- Le esportazioni vengono renderizzate in una finestra nascosta e salvate dove scegli tu.

## Esportazione in Word / immagini

- **Esporta come Word…** nel PDF: trasforma il PDF in un file .docx (conversione locale; le impaginazioni complesse vengono riprodotte per quanto possibile).
- **Docs** può esportare le pagine come immagini (PNG per pagina).

## Stampa

File ▸ Stampa (⌘P/ctrl+P) apre una finestra di stampa con anteprima in tempo reale in tutti gli editor — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram e Whiteboard. Senza modificare Layout di pagina e usando la finestra di sistema, la stampa resta identica a prima.

- **Destinazione (stampante, PDF, immagini)**: scegli in un solo elenco una stampante installata, **Salva come PDF**, **Salva come immagini** o la **Finestra di stampa di sistema**. Il salvataggio immagini supporta PNG e JPG (Alta 90%, Media 80%, File ridotto 65%) in file numerati separati o in un archivio ZIP. I PDF protetti disabilitano PDF e immagini mantenendo attiva la stampa.
- **Anteprima di stampa dal vivo**: tutti i dieci editor mostrano un’anteprima prima dell’output. Quando layout, scala di grigi, filigrana o intestazioni/piè di pagina modificano le facciate, l’anteprima renderizza le facciate reali su richiesta con navigazione, zoom e schema di layout.
- **Layout**: scegli Una pagina per foglio, Più pagine per foglio (2, 4, 6, 9 o 16, con bordi opzionali), Opuscolo (rilegatura a sinistra o destra), Poster (colonne × righe, sovrapposizione, segni di taglio ed etichette riquadri) o Etichette (una pagina per etichetta o ripetuta, cella iniziale, modelli A4 o misure personalizzate).
- **Scala, orientamento, facciate e ordine**: imposta Dimensioni effettive (100%), Adatta al foglio, Riduci pagine troppo grandi o Scala personalizzata (10%–400%) e orientamento Automatico, Verticale o Orizzontale. Solo dispari, solo pari e ordine inverso si basano sulle facciate finali.
- **Filigrana, intestazioni/piè di pagina, grigi e risoluzione**: applica filigrane di testo o immagine e 6 campi di intestazione/piè di pagina (titolo, data, numero di pagina o testo libero) solo in stampa, senza modificare il documento. Regola inoltre scala di grigi e DPI (Automatico, 150, 300 o 600 dpi).
- **Intervalli di pagine e selezione**: Docs e Markdown impaginano il testo selezionato da pagina 1; Slides stampa le diapositive selezionate; PDF le pagine selezionate; Hangul offre Tutte, Pagina corrente o Intervallo personalizzato; Sheets stampa fogli attivi, cartella o selezione.
- **Finestra di sistema**: per gli opuscoli scegli fronte/retro sul lato corto e lascia invariati intervallo e pagine per foglio nella finestra di sistema.

I PDF vengono stampati con l’ordine e la rotazione correnti.

## Dove finiscono i file senza titolo

Il percorso che scegli al primo salvataggio è la loro casa. Fino ad allora il documento non ha un file proprio: il contenuto non salvato esiste solo come copia di recupero nella cartella dati dell'applicazione, così può tornare se l'app si spegne all'improvviso (vedi [Schede e gestione delle finestre](help://tabs-and-windows)). Il salvataggio automatico subentra solo dopo quel primo salvataggio.
