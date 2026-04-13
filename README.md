# aGenda verifiche 4G

Applicazione web per organizzare le verifiche della classe 4G con:

- Flask per il backend
- SQLite per il database
- JavaScript vanilla per logica client e aggiornamenti dinamici

## Funzioni incluse

- calendario mensile con selezione del giorno
- inserimento rapido di verifiche per materia
- eliminazione eventi
- riepilogo del mese e dettaglio del giorno selezionato

## Avvio locale

1. Crea un ambiente virtuale:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Installa le dipendenze:

```bash
pip install -r requirements.txt
```

3. Avvia il server:

```bash
flask --app app run --debug
```

4. Apri il browser su `http://127.0.0.1:5000`

Il database SQLite viene creato automaticamente in `instance/school_planner.db`.

## Deploy su Vercel + Supabase

L'app ora supporta due modalita database:

- locale: SQLite (automatico, senza variabili extra)
- produzione: PostgreSQL (Supabase) tramite `DATABASE_URL`

### 1) Crea database su Supabase

1. Crea un nuovo progetto su Supabase.
2. Vai in `Settings > Database` e copia la `Connection string` in formato URI.
3. Verifica che la URI includa `sslmode=require`.

Esempio:

```bash
postgresql://postgres.xxxxx:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require
```

### 2) Configura variabili su Vercel

Nel progetto Vercel imposta queste Environment Variables:

- `DATABASE_URL`: URI PostgreSQL di Supabase
- `SECRET_KEY`: chiave segreta Flask robusta (non usare il default)

### 3) Collega repository a Vercel

1. Importa il repository in Vercel.
2. Mantieni la configurazione Python automatica.
3. Conferma il deploy.

Il file `vercel.json` instrada tutte le route a `app.py` con runtime `@vercel/python`.

### 4) Primo avvio

Al primo avvio in produzione l'app inizializza automaticamente lo schema Postgres usando `schema_postgres.sql`.

## Variabili ambiente

- `DATABASE_URL` (opzionale in locale, obbligatoria in deploy)
- `SECRET_KEY` (consigliata in locale, obbligatoria in deploy)
- `PORT` / `HOST` (solo esecuzione locale custom)

## Test

```bash
python3 -m unittest discover -s tests
```