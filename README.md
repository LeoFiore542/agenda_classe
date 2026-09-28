# aGenda

Applicazione web per organizzare verifiche, interrogazioni ed eventi di classe con:

- Flask per il backend
- SQLite per il database (file locale nel progetto)
- JavaScript vanilla per logica client e aggiornamenti dinamici

## Funzioni incluse

- calendario mensile con selezione del giorno
- inserimento rapido di verifiche per materia
- eliminazione eventi
- riepilogo del mese e dettaglio del giorno selezionato
- login account

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

## Deploy su PythonAnywhere

L'app salva utenti ed eventi in un file SQLite dentro il progetto (`instance/school_planner.db`).
Non serve Supabase/Postgres: tutto resta sul filesystem di PythonAnywhere.

### 1) Carica il codice

- Crea un account su [PythonAnywhere](https://www.pythonanywhere.com/)
- In **Files** / **Bash**, clona o carica la cartella del progetto, ad esempio:

```bash
cd ~
git clone <URL-del-tuo-repo> aGenda
cd aGenda
```

### 2) Virtualenv e dipendenze

```bash
python3.10 -m venv ~/.virtualenvs/agenda
source ~/.virtualenvs/agenda/bin/activate
pip install -r ~/aGenda/requirements.txt
```

### 3) Web app

In **Web** → **Add a new web app**:

1. Scegli **Manual configuration** → Python 3.10 (o la versione che usi)
2. **Virtualenv**: `/home/<username>/.virtualenvs/agenda`
3. **Source code**: `/home/<username>/aGenda`
4. **WSGI configuration file**: apri il file WSGI e sostituisci il contenuto con quello di `wsgi.py` del repo, oppure punta direttamente a:

```text
/home/<username>/aGenda/wsgi.py
```

Nel WSGI assicurati che `project_home` / `sys.path` punti a `/home/<username>/aGenda`.

5. (Consigliato) Imposta `SECRET_KEY` nelle Environment variables della Web app.

6. **Reload** della web app.

### 4) Database

Al primo accesso l'app crea automaticamente:

- `instance/school_planner.db`
- schema tabelle
- account owner `fiorini.leonardo` (password iniziale = username)

I dati restano sul server in quel file. Per backup: scaricalo da Files → `aGenda/instance/school_planner.db`.

> Nota: il file `.db` non e versionato in git (vedi `.gitignore`), cosi non pubblichi password. Su PythonAnywhere vive solo sulla macchina.

## Variabili ambiente (opzionali)

- `SECRET_KEY`
- `PORT` / `HOST` (solo locale)

## Test

```bash
python3 -m unittest discover -s tests
```
