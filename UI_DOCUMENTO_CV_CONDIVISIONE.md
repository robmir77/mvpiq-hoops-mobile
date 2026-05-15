# Documento UI - CV Sportivo Pubblico Condivisibile con Highlights

## Panoramica
Questo documento descrive l'interfaccia utente per la funzionalità di condivisione CV sportivo e gestione highlights.

---

## 1. Schermata CV (CvScreen)

### Header
- **Titolo**: "Il Mio CV"
- **Pulsanti**:
  - **Modifica**: Pulsante arancione (#ff8c00) con testo bianco
  - **Pubblica/Condividi**: 
    - Stato inattivo: Grigio scuro (#333) con bordo arancione, testo "Pubblica"
    - Stato attivo: Arancione (#ff8c00), testo "Condividi"

### Sezione Profilo
- **Headline**: Titolo del profilo
- **Summary**: Descrizione del profilo
- **Statistiche**: Visualizzazione stats (se presenti)

### Sezione Squadre
- Lista delle squadre con:
  - Nome squadra
  - Categoria
  - Anno inizio/fine
  - Note (se presenti)
- Messaggio vuoto: "Nessuna squadra registrata"

### Sezione Highlights
- Lista degli highlights con:
  - Titolo del highlight
  - Descrizione (se presente)
  - URL esterno (se presente)
- Messaggio vuoto: "Nessun highlight aggiunto"
- Card styling:
  - Sfondo: #333
  - Padding: 12px
  - Border radius: 8px
  - Spacing verticale: 8px

### Sezione Condivisione (visibile solo se shareEnabled = true)
- **Titolo**: "Condivisione"
- **Stato**: "CV pubblico attivo dal [data]"
- **Pulsante**: "Disabilita condivisione" (rosso #dc3545)

---

## 2. Schermata Modifica CV (EditCvScreen)

### Sezione Profilo CV
- **Headline**: Input text con placeholder "Titolo del profilo"
- **Summary**: Input text multilinea con placeholder "Descrizione del profilo"

### Sezione Squadre
- Lista squadre con:
  - Nome squadra (obbligatorio)
  - Anno inizio (obbligatorio, es. 2020)
  - Anno fine (obbligatorio, es. 2023)
  - Pulsante "Rimuovi" per ogni squadra
- Pulsante "Aggiungi squadra"

### Sezione Highlights
- Lista highlights esistenti con:
  - Titolo
  - Descrizione
  - URL esterno
  - Pulsante "Elimina" (rosso)
- Pulsante "Aggiungi link esterno" (grigio con bordo arancione)

### Modal Aggiungi Highlight
- **Titolo**: "Aggiungi Highlight"
- **Campi**:
  - Titolo * (obbligatorio)
  - URL Video * (obbligatorio, placeholder: https://youtube.com/...)
  - Descrizione (opzionale, multilinea)
- **Pulsanti**:
  - "Annulla" (grigio)
  - "Aggiungi" (arancione)

### Pulsante Salva
- "Salva CV" (arancione, in basso)

---

## 3. Share Sheet (Nativo React Native)

Quando l'utente preme "Condividi" o "Pubblica", appare il share sheet nativo con:
- **Messaggio**: "Guarda il mio CV sportivo: [URL]"
- **Opzioni**:
  - Copia link
  - Mail
  - WhatsApp
  - Altre app di condivisione del sistema

---

## 4. Colori e Stili

### Palette Colori
- **Primario**: #ff8c00 (Arancione)
- **Sfondo scuro**: #121826
- **Card**: #2a2a2a
- **Card highlight**: #333
- **Testo primario**: #fff (Bianco)
- **Testo secondario**: #ccc
- **Testo placeholder**: #888
- **Bordo**: #333
- **Pericolo**: #dc3545 (Rosso)

### Stili Input
- Background: colors.card (#2a2a2a)
- Color: colors.textPrimary (#fff)
- Padding: 12px
- Border radius: 8px
- Placeholder text color: #888

### Stili Pulsanti
- Background: #ff8c00
- Color: #fff
- Padding: 12px 16px
- Border radius: 20px
- Font weight: bold
- Font size: 14px

---

## 5. Flusso Utente

### Abilitare Condivisione
1. Utente preme "Pubblica" in CvScreen
2. Sistema genera token condivisione
3. Appare share sheet nativo
4. Utente condivide link
5. Pulsante cambia in "Condividi" (stato attivo)
6. Appare sezione "Condivisione" con stato

### Disabilitare Condivisione
1. Utente preme "Disabilita condivisione"
2. Appare alert di conferma
3. Utente conferma
4. Condivisione disabilitata
5. Sezione "Condivisione" rimossa
6. Pulsante torna a "Pubblica"

### Aggiungere Highlight
1. Utente va in EditCvScreen
2. Preme "Aggiungi link esterno"
3. Apre modal
4. Compila titolo e URL
5. Preme "Aggiungi"
6. Highlight aggiunto alla lista
7. Modal si chiude

### Eliminare Highlight
1. Utente preme "Elimina" su highlight
2. Appare alert di conferma
3. Utente conferma
4. Highlight rimosso dalla lista

---

## 6. Stati di Caricamento

### CvScreen
- **Caricamento**: ActivityIndicator arancione + testo "Caricamento CV..."
- **Errore**: Messaggio errore + pulsante "Riprova"
- **Condivisione in corso**: Pulsante mostra "..."

### EditCvScreen
- **Caricamento**: Non esplicito (load silenzioso)
- **Salvataggio**: Non esplicito (salvataggio silenzioso)
- **Errore**: CustomAlert con messaggio

---

## 7. Validazioni

### EditCvScreen - Squadre
- Nome squadra: obbligatorio
- Anno inizio: obbligatorio, range 1900-anno corrente+10
- Anno fine: obbligatorio, >= anno inizio, <= anno corrente

### EditCvScreen - Highlights
- Titolo: obbligatorio
- URL: obbligatorio

---

## 8. Responsive Design

### Mobile (Portrait)
- Layout verticale
- Pulsanti header affiancati
- Modal larghezza 90%, max 400px

### Mobile (Landscape)
- Layout adattato
- Modal larghezza 60%, max 400px

---

## 9. Accessibilità

- Contrasto colori conforme WCAG AA
- Font size minimo 14px
- Placeholder leggibili (#888 su sfondo scuro)
- Feedback visivo per azioni (stati attivo/disabilitato)
