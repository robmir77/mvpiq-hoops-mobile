# Audit SharedValue — frame processor e overlay

> Questo documento definisce un metodo di audit per il codice corrente. Le classificazioni vanno riconfermate dopo modifiche a `useShotTracker`, ai worker o agli overlay.

## Scopo

Separare le SharedValue necessarie al tracking/overlay da quelle usate soltanto per diagnostica, senza rimuovere operazioni prima di aver verificato tutti i lettori e scrittori.

## Categorie

### Funzionali
Valori che partecipano a:
- abilitazione/disabilitazione di detection;
- coordinate e stato della palla/giocatore/canestro;
- confidence e motivi di rifiuto;
- stato/età del tracking;
- scia della palla e dati necessari al rendering.

### Telemetria
Valori usati per contatori per frame, finestre temporali, FPS, schedule wait e statistiche di performance. Devono poter essere ridotti senza cambiare il risultato funzionale, ma solo dopo aver verificato che non alimentino guardie o UI.

### Diagnostica
Valori e log destinati a debug, audit e overlay diagnostico. Possono essere candidati a sampling o feature flag se non hanno lettori funzionali.

## Metodo per ogni SharedValue

Per ogni nome:
1. elencare tutte le letture `.value` e scritture `.value =`;
2. classificare ogni accesso come funzionale, UI, telemetria o debug;
3. controllare se l'accesso avviene per frame, per inferenza o per finestra temporale;
4. verificare che nessuna guardia di tracking dipenda da un valore classificato come “solo telemetry”;
5. misurare l'impatto prima e dopo la modifica con stessa build/configurazione;
6. aggiungere test o un controllo manuale ripetibile per evitare regressioni.

## Cautela sulla pipeline

Il percorso usa `useShotTracker` e worker vision. Il flag `runtimeActive` è presente nella firma ma non è usato nel frame processor secondo i commenti correnti. Non considerarlo una garanzia che le operazioni legacy per frame siano state eliminate.

Le SharedValue di rendering possono aggiornarsi indipendentemente dal numero di chiamate React render: una UI apparentemente ferma va diagnosticata distinguendo scrittura SharedValue, consumo nell'overlay e refresh della detection. Un valore di FPS pari a zero può indicare mancata acquisizione, mancata inferenza, contatore non aggiornato o problema di esposizione UI; da solo non identifica la causa.

## Checklist per una micro-ottimizzazione

- [ ] Identificare la SharedValue e tutti i suoi lettori/scrittori.
- [ ] Confermare che non sia usata per detection, tracking, guardie o overlay.
- [ ] Aggiungere una misura baseline.
- [ ] Applicare una sola modifica per esperimento.
- [ ] Confrontare FPS, latenza, frame processati, detection e fluidità overlay.
- [ ] Verificare su device e mantenere un rollback semplice.

## Stato

L'audit statico precedente è datato 2026-10-07 e non va trattato come inventario immutabile. Rilanciare l'analisi dopo cambiamenti ai frame processor. Questo file non certifica alcun miglioramento prestazionale senza misure correnti.
