# Hangul (HWP / HWPX): modifica, riquadro di lavoro e stampa

GenOffice apre e modifica documenti Hangul `.hwp` e `.hwpx` in una scheda, con scorciatoie da tastiera, stili, tabelle, promemoria, stampa e un pannello IA. Tutto viene eseguito localmente sul tuo PC.

## Apertura, salvataggio e stampa

- Apre file `.hwp` e `.hwpx` da Home, **File > Apri**, trascinandoli nella finestra o da Google Drive; converte i PDF in nuove schede Hangul tramite **File > Importa PDF**.
- Salva nel formato originale del file aperto (`.hwp` resta `.hwp`, `.hwpx` resta `.hwpx`), conserva una copia di backup `.bak` prima della prima sovrascrittura, verifica la rilettura HWP e mantiene il salvataggio automatico e le copie di ripristino in caso di arresto anomalo.
- La stampa (Ctrl+P) supporta anteprima in tempo reale, esportazione in PDF e opzioni di impaginazione multipagina.

## Riquadro di lavoro sinistro: Struttura, Trova e Bibliografia

- Apri il riquadro di lavoro sinistro dal pulsante sulla barra superiore, da **Visualizza > Riquadro di lavoro** (Struttura / Trova / Bibliografia) oppure premi **Ctrl+F** per passare direttamente alla scheda Trova. Restano disponibili la ricerca tradizionale (**Ctrl+Q,F**) e Trova e sostituisci (**Ctrl+H**).
- **Scheda Struttura**: elenca i titoli di struttura nativi di Hangul e i titoli mappati per stile (predefinito `제목 N` / `Heading N`, personalizzabile per singolo documento o a livello di app nel pannello delle impostazioni Struttura). Filtra per livello (`1`, `2`, `3`, ... Tutti), comprimi rami, fai clic per spostarti, alza o abbassa il livello dei titoli (con i sottotitoli per impostazione predefinita, oppure tieni premuto **Maiusc** per un solo titolo) e trascina i titoli per riordinare intere sezioni in un solo passaggio di annullamento.
- **Scheda Trova**: cerca nel corpo del testo, nelle tabelle (incluse quelle annidate), nelle caselle di testo, nelle note a piè di pagina e nelle note di chiusura (esclusi intestazioni e piè di pagina) con filtri per maiuscole/minuscole, parola intera, espressioni regolari, stile di paragrafo e formattazione dei caratteri. Fai clic su un risultato per raggiungerlo e selezionarlo, oppure sostituisci una corrispondenza, quelle selezionate o tutte in un solo passaggio di annullamento (saltando oggetti in linea e segni di citazione con il relativo conteggio).
- Il riquadro di lavoro ricorda lo stato di apertura, la scheda attiva e la larghezza, si riduce a una barra di icone nelle finestre strette e si nasconde in modalità presentazione e anteprima di stampa. Tutte le funzioni del riquadro operano senza IA.

## Promemoria, scorciatoie e pannello IA

- Apri la colonna Promemoria dalla barra superiore o da **Inserisci > Promemoria** per leggere, aggiungere, modificare ed eliminare promemoria in testo semplice accanto al documento.
- Supporta le scorciatoie di modifica per documenti Hangul, i marcatori di paragrafo sul righello orizzontale, Copia formato (**Alt+C**), la conversione Hanja (**F9** / tasto Hanja) e le Informazioni documento (**Ctrl+Q,I**).
- Il pannello IA facoltativo e i [comandi da terminale](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) possono leggere e modificare testo, stili, tabelle, equazioni, layout di pagina, struttura e risultati di ricerca; ogni modifica dell'IA costituisce un unico passaggio di annullamento.

## Sommario: creazione e aggiornamento

- Usa **Strumenti > Crea sommario** (oppure **Strumenti > Aggiorna sommario**, o fai clic destro dentro un sommario) per inserire un **sommario** basato sui titoli della Struttura, oltre agli elenchi di **tabelle**, **figure** ed **equazioni** raccolti dalle didascalie degli oggetti e dai paragrafi didascalia.
- Scegli il layout **Tabulazione punteggiata** (predefinito) o **Tabella senza bordi** (a 2 colonne), imposta la profondità dei titoli (livelli 1–10, predefinito 3), personalizza il titolo e aggiungi se vuoi collegamenti cliccabili (fai clic o **Ctrl+clic** su una riga per saltare direttamente al titolo).
- I numeri di pagina riflettono la numerazione stampata, inclusi i riavvii di numerazione e i formati romani o personalizzati.
- L’aggiornamento rinnova voci e numeri di pagina sul posto, ti avvisa prima di sovrascrivere righe modificate a mano e rileva eventuali sommari privi di contrassegni creati con un altro programma, chiedendo conferma prima di sostituirli.

## Indice analitico: contrassegno e creazione

- Usa **Strumenti > Contrassegna voce di indice** (o fai clic destro nel corpo del testo) per contrassegnare la parola selezionata o al cursore, aggiungere una sottovoce facoltativa o contrassegnare tutte le occorrenze (solo nel corpo del testo; viene mostrato il conteggio delle occorrenze saltate in tabelle, caselle di testo e note). Nella stessa finestra puoi visualizzare ed eliminare i contrassegni esistenti.
- Usa **Strumenti > Crea indice analitico** per inserire l’indice alla posizione del cursore e **Strumenti > Aggiorna indice analitico** per aggiornarlo dopo le modifiche. Il titolo predefinito («Indice analitico») è personalizzabile.
- Le voci sono ordinate secondo l’ordine coreano (가나다) → inglese (ABC) → altro, con intestazioni di gruppo per consonante o lettera facoltative, da 1–3 colonne (predefinito 2 colonne, applicate solo all’indice senza modificare le colonne del resto del documento) e layout **Tabulazione punteggiata** o **Tabella senza bordi**.

## Avviso di voci non aggiornate e copia di consegna

- Al salvataggio manuale, alla stampa, all’esportazione in PDF o al salvataggio come copia di consegna, l’editor controlla se i sommari o l’indice analitico non sono aggiornati e propone di aggiornare tutto in un unico passaggio di annullamento. Il controllo non viene mai eseguito durante il salvataggio automatico e non blocca mai il salvataggio.
- Usa **File > Salva come copia di consegna** per salvare una copia pulita separata priva di contrassegni interni di modifica (contrassegni di indice, blocchi di indice e impostazioni salvate), mantenendo intatti sommari, ancoraggi dei titoli e collegamenti. Il file di lavoro originale resta intatto così da poter continuare ad aggiornarlo in seguito.

## Bibliografia e citazioni

- Apri la scheda **Bibliografia** nel riquadro di lavoro sinistro (o **Strumenti > Bibliografia**) per gestire un’unica libreria locale sul tuo PC con ricerca, tag, aggiunta/modifica/eliminazione, importazione ed esportazione (`BibTeX`, `RIS`, `CSL JSON`) e importazione delle righe da un elenco bibliografico già presente nel documento con anteprima di conferma.
- Supporta quattro stili di citazione (**APA 7**, **Chicago**, **MLA 9** e **IEEE**; le fonti in coreano seguono il formato accademico coreano in tutti e quattro gli stili). Inserisci citazioni tra parentesi, narrative o multiple con indicazione di pagina e genera o aggiorna una bibliografia con rientro sporgente; il cambio di stile aggiorna citazioni contrassegnate e bibliografia in un solo passaggio di annullamento, lasciando intatte le citazioni modificate manualmente.
- Il controllo integrato a 6 punti (assente dalla bibliografia, voci non citate, ordine di ordinamento, suffissi a/b mancanti, modifiche manuali alle citazioni e voci non verificate) consente di fare clic per saltare subito a ogni problema, insieme agli avvisi su bibliografia o numerazione IEEE non aggiornate prima del salvataggio manuale, della stampa o dell’esportazione.
- La ricerca bibliografica facoltativa con IA (con gli strumenti Internet attivi) inserisce sempre i candidati come **Non verificato** salvando l’URL di origine nelle note; non possono essere citati né inclusi in bibliografia finché non li controlli e li contrassegni tu stesso come **Verificato**.

## Macro: registrazione tasti e script

- Usa **Strumenti > Macro** (oppure **Alt+Shift+H** per avviare o interrompere la registrazione dei tasti e **Alt+Shift+X** per interromperla) per registrare testo digitato, spostamenti del cursore, formattazione, stili, tabelle e modifiche supportate direttamente in uno script modificabile. Durante la registrazione compare un indicatore nella barra superiore, mentre le azioni non supportate o i clic del mouse vengono segnalati subito ed elencati come saltati al termine.
- Apri il **Gestore macro** per gestire le macro salvate in locale, assegnare fino a 11 scorciatoie (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), modificare gli script con segnalazione di riga e colonna per gli errori di sintassi ed esportare o importare file di testo semplice `.ieummacro`. Gli script importati vengono mostrati per intero e devono essere confermati e salvati prima di poter essere eseguiti; le macro incorporate nei file di documento non vengono mai lette né eseguite. Su macOS, avvia e gestisci le macro dal menu **Strumenti > Macro**, poiché le combinazioni con il tasto Opzione inseriscono caratteri.
- Ogni macro viene eseguita in modo sincrono in un interprete limitato che supporta l'API documento dell'app e gli oggetti di script macro compatibili (`HAction`, `HParameterSet`), con limiti di tempo, passaggi, profondità di chiamata e memoria oltre alla protezione di oggetti e note. Ogni esecuzione corrisponde sempre a un solo passaggio di annullamento e ripristina tutto in caso di errore, azione non supportata o superamento dei limiti.
- La funzione opzionale **Scrivi con l'IA** (visibile nell'editor macro solo se l'IA è attiva) consente di descrivere un'operazione ripetitiva per ottenere una bozza di script; vengono inviati soltanto la descrizione e il riferimento API delle macro, mai il documento. Le bozze compaiono solo nel campo di modifica e non vengono mai salvate né eseguite automaticamente.
