# Hangul (HWP / HWPX): modifica, riquadro di lavoro e stampa

GenOffice apre e modifica documenti Hangul `.hwp` e `.hwpx` in una scheda, con scorciatoie da tastiera, stili, tabelle, promemoria, stampa e un pannello IA. Tutto viene eseguito localmente sul tuo PC.

## Apertura, salvataggio e stampa

- Apre file `.hwp` e `.hwpx` da Home, **File > Apri**, trascinandoli nella finestra o da Google Drive; converte i PDF in nuove schede Hangul tramite **File > Importa PDF**.
- Salva nel formato originale del file aperto (`.hwp` resta `.hwp`, `.hwpx` resta `.hwpx`), conserva una copia di backup `.bak` prima della prima sovrascrittura, verifica la rilettura HWP e mantiene il salvataggio automatico e le copie di ripristino in caso di arresto anomalo.
- La stampa (Ctrl+P) supporta anteprima in tempo reale, esportazione in PDF e opzioni di impaginazione multipagina.

## Riquadro di lavoro sinistro: Struttura e Trova

- Apri il riquadro di lavoro sinistro dal pulsante sulla barra superiore, da **Visualizza > Riquadro di lavoro** (Struttura / Trova) oppure premi **Ctrl+F** per passare direttamente alla scheda Trova. Restano disponibili la ricerca tradizionale (**Ctrl+Q,F**) e Trova e sostituisci (**Ctrl+H**).
- **Scheda Struttura**: elenca i titoli di struttura nativi di Hangul e i titoli mappati per stile (predefinito `제목 N` / `Heading N`, personalizzabile per singolo documento o a livello di app nel pannello delle impostazioni Struttura). Filtra per livello (`1`, `2`, `3`, ... Tutti), comprimi rami, fai clic per spostarti, alza o abbassa il livello dei titoli (con i sottotitoli per impostazione predefinita, oppure tieni premuto **Maiusc** per un solo titolo) e trascina i titoli per riordinare intere sezioni in un solo passaggio di annullamento.
- **Scheda Trova**: cerca nel corpo del testo, nelle tabelle (incluse quelle annidate), nelle caselle di testo, nelle note a piè di pagina e nelle note di chiusura (esclusi intestazioni e piè di pagina) con filtri per maiuscole/minuscole, parola intera, espressioni regolari, stile di paragrafo e formattazione dei caratteri. Fai clic su un risultato per raggiungerlo e selezionarlo, oppure sostituisci una corrispondenza, quelle selezionate o tutte in un solo passaggio di annullamento (saltando oggetti in linea e segni di citazione con il relativo conteggio).
- Il riquadro di lavoro ricorda lo stato di apertura, la scheda attiva e la larghezza, si riduce a una barra di icone nelle finestre strette e si nasconde in modalità presentazione e anteprima di stampa. Tutte le funzioni del riquadro operano senza IA.

## Promemoria, scorciatoie e pannello IA

- Apri la colonna Promemoria dalla barra superiore o da **Inserisci > Promemoria** per leggere, aggiungere, modificare ed eliminare promemoria in testo semplice accanto al documento.
- Supporta le scorciatoie di modifica per documenti Hangul, i marcatori di paragrafo sul righello orizzontale, Copia formato (**Alt+C**), la conversione Hanja (**F9** / tasto Hanja) e le Informazioni documento (**Ctrl+Q,I**).
- Il pannello IA facoltativo e i [comandi da terminale](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) possono leggere e modificare testo, stili, tabelle, equazioni, layout di pagina, struttura e risultati di ricerca; ogni modifica dell'IA costituisce un unico passaggio di annullamento.
