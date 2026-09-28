# aGenda

Applicazione web per organizzare verifiche, interrogazioni ed eventi di classe con:

- Flask per il backend
- SQLite in locale / PostgreSQL (Supabase) in produzione
- JavaScript vanilla per logica client

## Avvio locale

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
flask --app app run --debug
```

Apri `http://127.0.0.1:5000`. Senza `DATABASE_URL` usa SQLite in `instance/school_planner.db`.

## Deploy su Vercel + Supabase

### 1) Database Supabase

1. Crea un progetto Supabase
2. Copia la connection string **Transaction pooler** da Settings → Database
3. Aggiungi `?sslmode=require` se manca
4. URL-encode i caratteri speciali della password (`@` → `%40`)

Esempio:

```bash
postgresql://postgres.<ref>:<PASSWORD>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require
```

Al primo avvio l'app crea automaticamente lo schema da `schema_postgres.sql`.

### 2) Variabili su Vercel

- `DATABASE_URL` — URI Postgres di Supabase (obbligatoria)
- `SECRET_KEY` — chiave segreta Flask robusta

### 3) Deploy

1. Importa il repository GitHub in Vercel
2. Runtime Python automatico (`vercel.json` instrada tutto a `app.py`)
3. Redeploy dopo aver impostato le env

## Variabili ambiente

- `DATABASE_URL` (obbligatoria in produzione)
- `SECRET_KEY`
- `PORT` / `HOST` (solo locale)

## Test

```bash
python3 -m unittest discover -s tests
```
