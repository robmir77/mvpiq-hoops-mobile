# CV sportivo — documento di riferimento UI

> Documento di supporto alla manutenzione, non specifica normativa dell'interfaccia. In caso di divergenza prevalgono i componenti correnti in `src/features/cv/screens/`, i tipi e il client API.

## Componenti principali

- `CvScreen.tsx`: visualizzazione del CV e azioni disponibili per lo stato del CV restituito dai dati.
- `EditCvScreen.tsx`: modifica dei campi CV e gestione delle sezioni editabili.
- `src/features/cv/hooks/useCv.ts`: hook della feature.
- `src/features/cv/api/cv.api.ts`: operazioni API.
- `src/features/cv/types/cv.types.ts`: contratto TypeScript.

## Responsabilità dell'interfaccia

La schermata di lettura presenta i dati del CV e lo stato di caricamento/errore definito dal componente. La schermata di modifica raccoglie i dati editabili, applica le validazioni implementate e invia le modifiche attraverso il livello API. Le azioni di condivisione devono essere documentate in base al comportamento effettivo del codice, senza presumere che ogni dispositivo o stato server mostri gli stessi controlli.

## Verifica delle modifiche UI

Prima di aggiornare testi, screenshot o specifiche:
1. leggere `CvScreen.tsx` ed `EditCvScreen.tsx`;
2. verificare i campi e gli enum in `cv.types.ts`;
3. verificare endpoint e payload in `cv.api.ts`;
4. controllare gli stati di caricamento, errore, salvataggio e condivisione;
5. provare il flusso con dati vuoti e dati già presenti.

## Aspetti da non assumere senza riscontro

- URL pubblico, token o formato del link di condivisione.
- Palette colori, testi, messaggi di conferma e comportamento esatto del sistema di condivisione.
- Obbligatorietà dei campi e range di validazione.
- Percentuali di coverage, accessibilità certificata o comportamento responsive non testato.

## Checklist di regressione

- [ ] Aprire CV con dati presenti e assenti.
- [ ] Verificare stati loading, errore e retry quando implementati.
- [ ] Modificare e salvare i campi del CV.
- [ ] Verificare validazione e messaggi d'errore.
- [ ] Verificare creazione/aggiornamento degli highlights se presenti nel modello corrente.
- [ ] Verificare condivisione e revoca solo se previste dall'implementazione corrente.
- [ ] Confermare che i payload API corrispondano ai tipi condivisi.
