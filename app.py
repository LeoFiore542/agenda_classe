from __future__ import annotations

from functools import wraps
import json
import os
import signal
import sqlite3
import subprocess
import time
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any, Sequence

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None
    dict_row = None

from flask import Flask, current_app, flash, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash


VALID_EVENT_TYPES = {"verifica", "interrogazione", "evento"}
VALID_STATUSES = {"programmata", "completata", "rinviata"}
VALID_INTERROGATION_MODES = {"period", "specific_days"}
VALID_EVENT_SUBJECTS = {
    "uscita didattica": "Uscita didattica",
    "assemblea": "Assemblea",
    "assemblea di classe": "Assemblea",
    "altro": "Altro",
    "compleanni": "Compleanni",
}
DEFAULT_CLASS_GROUP = "4G"
DEFAULT_EVENT_TYPE = "verifica"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000
OWNER_USERNAME = "fiorini.leonardo"
LEGACY_OWNER_USERNAME = "leonardo.fiorini"
OWNER_FULL_NAME = "Leonardo Fiorini"
CREDENTIAL_RESET_MIGRATION_KEY = "credential_reset_2026_04"
COUNTDOWN_TARGET_DATE_KEY = "school_countdown_target_date"
SCHOOL_HOURS_PER_DAY = 6

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "owner": {
        "manage_roles",
        "manage_role_assignments",
        "create_roles",
        "create_events",
        "edit_events",
        "delete_events",
        "view_events",
        "manage_countdown_target",
    },
    "rappresentante": {"create_events", "edit_events", "delete_events", "view_events"},
    "editor": {"edit_events", "view_events"},
    "alunno": {"view_events"},
}


class DatabaseAdapter:
    def __init__(self, connection: Any, backend: str):
        self.connection = connection
        self.backend = backend

    def _format_query(self, query: str) -> str:
        if self.backend == "postgres":
            return query.replace("?", "%s")
        return query

    def execute(self, query: str, params: Sequence[Any] | None = None):
        formatted_query = self._format_query(query)
        if params is None:
            return self.connection.execute(formatted_query)
        return self.connection.execute(formatted_query, tuple(params))

    def executescript(self, script: str) -> None:
        if self.backend == "sqlite":
            self.connection.executescript(script)
            return

        for statement in (chunk.strip() for chunk in script.split(";")):
            if statement:
                self.connection.execute(statement)

    def commit(self) -> None:
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()


def detect_db_backend(database_url: str | None) -> str:
    normalized = str(database_url or "").strip().lower()
    if normalized.startswith("postgresql://") or normalized.startswith("postgres://"):
        return "postgres"
    return "sqlite"


def login_required(view_func):
    @wraps(view_func)
    def wrapped_view(*args, **kwargs):
        if g.get("current_user") is None:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Autenticazione richiesta."}), 401
            return redirect(url_for("login", next=request.path))
        return view_func(*args, **kwargs)

    return wrapped_view


def password_change_not_required(view_func):
    @wraps(view_func)
    def wrapped_view(*args, **kwargs):
        current_user = g.get("current_user")
        if current_user is not None and current_user.get("must_change_password"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Cambio password obbligatorio al primo accesso."}), 403
            flash("Devi cambiare la password personale prima di continuare.", "error")
            return redirect(url_for("account"))
        return view_func(*args, **kwargs)

    return wrapped_view


def permission_required(permission_name: str):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped_view(*args, **kwargs):
            current_user = g.get("current_user")
            permissions = set(current_user.get("permissions", [])) if current_user else set()
            if permission_name not in permissions:
                if request.path.startswith("/api/"):
                    return jsonify({"error": "Permessi insufficienti."}), 403
                flash("Non hai i permessi necessari per questa operazione.", "error")
                return redirect(url_for("index"))
            return view_func(*args, **kwargs)

        return wrapped_view

    return decorator


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        DATABASE=str(Path(app.instance_path) / "school_planner.db"),
        DATABASE_URL=os.environ.get("DATABASE_URL", ""),
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-4g-login-secret"),
        TEMPLATES_AUTO_RELOAD=True,
        SEND_FILE_MAX_AGE_DEFAULT=0,
    )

    if test_config:
        app.config.update(test_config)

    app.config["DB_BACKEND"] = detect_db_backend(app.config.get("DATABASE_URL"))

    if app.config["DB_BACKEND"] == "sqlite":
        try:
            Path(app.instance_path).mkdir(parents=True, exist_ok=True)
        except OSError:
            app.config["DATABASE"] = "/tmp/school_planner.db"

    _db_ready = False

    @app.before_request
    def ensure_db_initialized() -> None:
        nonlocal _db_ready
        if not _db_ready:
            init_db()
            _db_ready = True

    @app.before_request
    def load_current_user() -> None:
        user_id = session.get("user_id")
        g.current_user = fetch_user_by_id(user_id) if user_id is not None else None

    @app.context_processor
    def inject_current_user() -> dict[str, dict | None]:
        return {"current_user": g.get("current_user")}

    @app.teardown_appcontext
    def close_db(_: object | None) -> None:
        database = g.pop("db", None)
        if database is not None:
            database.close()

    @app.after_request
    def disable_cache(response):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if g.get("current_user") is not None:
            if g.current_user.get("must_change_password"):
                return redirect(url_for("account"))
            return redirect(url_for("index"))

        error_message = ""
        next_url = normalize_next_url(request.args.get("next") or request.form.get("next"))

        if request.method == "POST":
            username = str(request.form.get("username", "")).strip().lower()
            password = str(request.form.get("password", ""))
            user = fetch_user_by_username(username)

            if user is None or not check_password_hash(user["password_hash"], password):
                error_message = "Username o password non validi."
            else:
                session.clear()
                session["user_id"] = user["id"]
                if user.get("must_change_password"):
                    flash("Primo accesso rilevato: aggiorna subito la tua password personale.", "error")
                    return redirect(url_for("account"))
                return redirect(next_url)

        return render_template("login.html", error_message=error_message, next_url=next_url)

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.post("/account/password")
    @login_required
    def change_password():
        current_password = str(request.form.get("current_password", ""))
        new_password = str(request.form.get("new_password", ""))
        confirm_password = str(request.form.get("confirm_password", ""))

        if not check_password_hash(g.current_user["password_hash"], current_password):
            flash("La password attuale non e corretta.", "error")
            return redirect(url_for("account"))

        if len(new_password) < 6:
            flash("La nuova password deve contenere almeno 6 caratteri.", "error")
            return redirect(url_for("account"))

        if new_password != confirm_password:
            flash("La conferma password non corrisponde.", "error")
            return redirect(url_for("account"))

        if current_password == new_password:
            flash("Scegli una password diversa da quella attuale.", "error")
            return redirect(url_for("account"))

        database = get_db()
        database.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
            (generate_password_hash(new_password, method="pbkdf2:sha256"), g.current_user["id"]),
        )
        database.commit()
        g.current_user = fetch_user_by_id(g.current_user["id"])
        flash("Password aggiornata correttamente.", "success")
        return redirect(url_for("index"))

    @app.get("/account")
    @login_required
    def account() -> str:
        return render_template(
            "account.html",
            personal_schedule=build_personal_schedule(g.current_user["full_name"]),
        )

    @app.route("/")
    @login_required
    @password_change_not_required
    def index() -> str:
        return render_template(
            "index.html",
            today=date.today().isoformat(),
            class_group=DEFAULT_CLASS_GROUP,
            class_roster=read_class_roster(),
        )

    @app.get("/api/events")
    @login_required
    @password_change_not_required
    @permission_required("view_events")
    def list_events():
        filters = {
            "month": request.args.get("month", "").strip(),
            "subject": request.args.get("subject", "").strip(),
        }
        rows = fetch_events(filters)
        return jsonify(rows)

    @app.post("/api/events")
    @login_required
    @password_change_not_required
    @permission_required("create_events")
    def create_event():
        payload = request.get_json(silent=True) or {}
        payload["created_by"] = g.current_user["full_name"]
        cleaned, errors = validate_event_payload(payload)
        if errors:
            return jsonify({"errors": errors}), 400

        database = get_db()
        cursor = database.execute(
            """
            INSERT INTO events (
                title,
                subject,
                event_type,
                class_group,
                scheduled_for,
                interrogation_mode,
                interrogation_end,
                interrogation_dates,
                interrogation_schedule,
                interrogated_students,
                notes,
                created_by,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                cleaned["title"],
                cleaned["subject"],
                cleaned["event_type"],
                cleaned["class_group"],
                cleaned["scheduled_for"],
                cleaned["interrogation_mode"],
                cleaned["interrogation_end"],
                cleaned["interrogation_dates"],
                cleaned["interrogation_schedule"],
                cleaned["interrogated_students"],
                cleaned["notes"],
                cleaned["created_by"],
                cleaned["status"],
            ),
        )
        created_row = cursor.fetchone()
        database.commit()
        event_id = int(created_row["id"]) if created_row is not None else None
        if event_id is None:
            return jsonify({"error": "Impossibile creare l'evento."}), 500

        event = fetch_event_by_id(event_id)
        if event is None:
            return jsonify({"error": "Impossibile recuperare l'evento creato."}), 500

        return jsonify(event), 201

    @app.patch("/api/events/<int:event_id>")
    @login_required
    @password_change_not_required
    @permission_required("edit_events")
    def update_event(event_id: int):
        existing = fetch_event_by_id(event_id)
        if existing is None:
            return jsonify({"error": "Evento non trovato."}), 404

        payload = request.get_json(silent=True) or {}
        merged = {**existing, **payload, "created_by": existing.get("created_by") or g.current_user["full_name"]}
        cleaned, errors = validate_event_payload(merged)
        if errors:
            return jsonify({"errors": errors}), 400

        database = get_db()
        database.execute(
            """
            UPDATE events
            SET title = ?, subject = ?, event_type = ?, class_group = ?,
                scheduled_for = ?, interrogation_mode = ?, interrogation_end = ?,
                interrogation_dates = ?, interrogation_schedule = ?, interrogated_students = ?, notes = ?,
                created_by = ?, status = ?
            WHERE id = ?
            """,
            (
                cleaned["title"],
                cleaned["subject"],
                cleaned["event_type"],
                cleaned["class_group"],
                cleaned["scheduled_for"],
                cleaned["interrogation_mode"],
                cleaned["interrogation_end"],
                cleaned["interrogation_dates"],
                cleaned["interrogation_schedule"],
                cleaned["interrogated_students"],
                cleaned["notes"],
                cleaned["created_by"],
                cleaned["status"],
                event_id,
            ),
        )
        database.commit()
        return jsonify(fetch_event_by_id(event_id))

    @app.delete("/api/events/<int:event_id>")
    @login_required
    @password_change_not_required
    @permission_required("delete_events")
    def delete_event(event_id: int):
        database = get_db()
        cursor = database.execute("DELETE FROM events WHERE id = ?", (event_id,))
        database.commit()
        if cursor.rowcount == 0:
            return jsonify({"error": "Evento non trovato."}), 404
        return ("", 204)

    @app.get("/api/countdown")
    @login_required
    @password_change_not_required
    def get_school_countdown():
        return jsonify(build_school_countdown_payload())

    @app.put("/api/countdown")
    @login_required
    @password_change_not_required
    @permission_required("manage_countdown_target")
    def update_school_countdown_target():
        payload = request.get_json(silent=True) or {}
        target_date = str(payload.get("target_date", "")).strip()

        try:
            normalized_target = date.fromisoformat(target_date).isoformat()
        except ValueError:
            return jsonify({"error": "Inserisci una data valida in formato YYYY-MM-DD."}), 400

        set_app_setting(COUNTDOWN_TARGET_DATE_KEY, normalized_target)
        get_db().commit()
        return jsonify(build_school_countdown_payload())

    @app.get("/api/roles")
    @login_required
    @password_change_not_required
    @permission_required("manage_roles")
    def list_roles():
        return jsonify(fetch_all_roles_with_permissions())

    @app.post("/api/roles")
    @login_required
    @password_change_not_required
    @permission_required("create_roles")
    def create_role():
        payload = request.get_json(silent=True) or {}
        role_name = normalize_role_name(str(payload.get("name", "")))
        permissions = payload.get("permissions", [])

        if not role_name:
            return jsonify({"error": "Il nome ruolo e obbligatorio."}), 400
        if not isinstance(permissions, list) or any(not str(item).strip() for item in permissions):
            return jsonify({"error": "La lista permessi non e valida."}), 400

        permissions_set = {str(item).strip().lower() for item in permissions if str(item).strip()}
        database = get_db()
        existing = database.execute("SELECT id FROM roles WHERE name = ?", (role_name,)).fetchone()
        if existing is not None:
            return jsonify({"error": "Ruolo gia esistente."}), 409

        database.execute("INSERT INTO roles (name) VALUES (?)", (role_name,))
        role_row = database.execute("SELECT id FROM roles WHERE name = ?", (role_name,)).fetchone()
        if role_row is None:
            return jsonify({"error": "Impossibile creare il ruolo."}), 500

        for permission_name in sorted(permissions_set):
            database.execute(
                "INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)",
                (role_row["id"], permission_name),
            )

        database.commit()
        created_role = next((role for role in fetch_all_roles_with_permissions() if role["name"] == role_name), None)
        return jsonify(created_role), 201

    @app.get("/api/users/roles")
    @login_required
    @password_change_not_required
    @permission_required("manage_role_assignments")
    def list_users_with_roles():
        return jsonify(fetch_users_with_roles())

    @app.put("/api/users/<int:user_id>/roles")
    @login_required
    @password_change_not_required
    @permission_required("manage_role_assignments")
    def update_user_roles(user_id: int):
        payload = request.get_json(silent=True) or {}
        role_names = payload.get("roles", [])
        if not isinstance(role_names, list):
            return jsonify({"error": "Il campo roles deve essere una lista."}), 400

        normalized_roles = sorted({normalize_role_name(str(role_name)) for role_name in role_names if str(role_name).strip()})
        database = get_db()
        user_row = database.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
        if user_row is None:
            return jsonify({"error": "Utente non trovato."}), 404

        known_roles = {row["name"] for row in database.execute("SELECT name FROM roles").fetchall()}
        unknown_roles = [role_name for role_name in normalized_roles if role_name not in known_roles]
        if unknown_roles:
            return jsonify({"error": f"Ruoli non validi: {', '.join(unknown_roles)}."}), 400

        if user_row["username"] == OWNER_USERNAME and "owner" not in normalized_roles:
            return jsonify({"error": "L'account owner deve mantenere il ruolo owner."}), 400

        database.execute("DELETE FROM user_roles WHERE user_id = ?", (user_id,))
        for role_name in normalized_roles:
            assign_role_to_user(database, user_id, role_name)
        database.commit()

        refreshed_user = fetch_user_by_id(user_id)
        if refreshed_user is None:
            return jsonify({"error": "Impossibile leggere l'utente aggiornato."}), 500
        return jsonify(
            {
                "id": refreshed_user["id"],
                "username": refreshed_user["username"],
                "full_name": refreshed_user["full_name"],
                "roles": refreshed_user.get("roles", []),
            }
        )

    return app


def get_db() -> DatabaseAdapter:
    if "db" not in g:
        backend = current_app.config.get("DB_BACKEND", "sqlite")
        if backend == "postgres":
            if psycopg is None or dict_row is None:
                raise RuntimeError(
                    "PostgreSQL support requires psycopg. Install dependencies from requirements.txt."
                )
            connection = psycopg.connect(
                current_app.config["DATABASE_URL"],
                row_factory=dict_row,  # type: ignore[arg-type]
                autocommit=False,
            )
            g.db = DatabaseAdapter(connection=connection, backend="postgres")
        else:
            connection = sqlite3.connect(current_app.config["DATABASE"])
            connection.row_factory = sqlite3.Row
            g.db = DatabaseAdapter(connection=connection, backend="sqlite")
    return g.db


def init_db() -> None:
    database = get_db()
    schema_filename = "schema_postgres.sql" if database.backend == "postgres" else "schema.sql"
    schema_path = Path(__file__).with_name(schema_filename)
    database.executescript(schema_path.read_text(encoding="utf-8"))
    migrate_events_table(database)
    ensure_events_columns(database)
    ensure_users_columns(database)
    seed_user_accounts(database)
    seed_roles_and_permissions(database)
    ensure_owner_account(database)
    ensure_default_user_roles(database)
    run_credential_reset_once(database)
    database.commit()


def read_class_roster() -> list[str]:
    roster_path = Path(__file__).with_name("elenco-classe.txt")
    if not roster_path.exists():
        return []

    return [
        line.strip()
        for line in roster_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def normalize_next_url(value: str | None) -> str:
    candidate = str(value or "").strip()
    if candidate.startswith("/") and not candidate.startswith("//"):
        return candidate
    return url_for("index")


def build_username_from_full_name(full_name: str, taken_usernames: set[str] | None = None) -> str:
    ascii_value = unicodedata.normalize("NFKD", full_name).encode("ascii", "ignore").decode("ascii").lower()
    parts = ["".join(character for character in chunk if character.isalnum()) for chunk in ascii_value.split()]
    parts = [part for part in parts if part]

    if not parts:
        base_username = "utente"
    elif len(parts) == 1:
        base_username = parts[0]
    else:
        base_username = f"{''.join(parts[:-1])}.{parts[-1]}"

    if taken_usernames is None:
        return base_username

    username = base_username
    suffix = 2
    while username in taken_usernames:
        username = f"{base_username}{suffix}"
        suffix += 1
    return username


def seed_user_accounts(database: DatabaseAdapter) -> None:
    existing_rows = database.execute("SELECT full_name, username FROM users").fetchall()
    existing_names = {row["full_name"] for row in existing_rows}
    taken_usernames = {row["username"] for row in existing_rows}

    for full_name in read_class_roster():
        if full_name in existing_names:
            continue

        username = build_username_from_full_name(full_name, taken_usernames)
        database.execute(
            "INSERT INTO users (full_name, username, password_hash, must_change_password) VALUES (?, ?, ?, ?)",
            (full_name, username, generate_password_hash(username, method="pbkdf2:sha256"), 1),
        )
        existing_names.add(full_name)
        taken_usernames.add(username)


def seed_roles_and_permissions(database: DatabaseAdapter) -> None:
    role_rows = database.execute("SELECT id, name FROM roles").fetchall()
    role_by_name = {row["name"]: row["id"] for row in role_rows}

    for role_name in ROLE_PERMISSIONS:
        if role_name in role_by_name:
            continue
        database.execute("INSERT INTO roles (name) VALUES (?)", (role_name,))

    role_rows = database.execute("SELECT id, name FROM roles").fetchall()
    role_by_name = {row["name"]: row["id"] for row in role_rows}

    for role_name, permissions in ROLE_PERMISSIONS.items():
        role_id = role_by_name[role_name]
        existing_permissions = {
            row["permission"]
            for row in database.execute(
                "SELECT permission FROM role_permissions WHERE role_id = ?",
                (role_id,),
            ).fetchall()
        }
        for permission_name in permissions:
            if permission_name in existing_permissions:
                continue
            database.execute(
                "INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)",
                (role_id, permission_name),
            )


def ensure_owner_account(database: DatabaseAdapter) -> None:
    if OWNER_USERNAME != LEGACY_OWNER_USERNAME:
        legacy_row = database.execute(
            "SELECT id FROM users WHERE username = ?",
            (LEGACY_OWNER_USERNAME,),
        ).fetchone()
        target_row = database.execute(
            "SELECT id FROM users WHERE username = ?",
            (OWNER_USERNAME,),
        ).fetchone()

        if legacy_row is not None and target_row is None:
            database.execute(
                "UPDATE users SET username = ?, full_name = ? WHERE id = ?",
                (OWNER_USERNAME, OWNER_FULL_NAME, legacy_row["id"]),
            )
        elif legacy_row is not None and target_row is not None:
            database.execute("DELETE FROM user_roles WHERE user_id = ?", (legacy_row["id"],))
            database.execute("DELETE FROM users WHERE id = ?", (legacy_row["id"],))

    owner_row = database.execute(
        "SELECT id FROM users WHERE username = ?",
        (OWNER_USERNAME,),
    ).fetchone()

    if owner_row is None:
        database.execute(
            "INSERT INTO users (full_name, username, password_hash, must_change_password) VALUES (?, ?, ?, ?)",
            (
                OWNER_FULL_NAME,
                OWNER_USERNAME,
                generate_password_hash(OWNER_USERNAME, method="pbkdf2:sha256"),
                1,
            ),
        )
        owner_row = database.execute(
            "SELECT id FROM users WHERE username = ?",
            (OWNER_USERNAME,),
        ).fetchone()

    if owner_row is not None:
        assign_role_to_user(database, owner_row["id"], "owner")


def assign_role_to_user(database: DatabaseAdapter, user_id: int, role_name: str) -> None:
    role_row = database.execute("SELECT id FROM roles WHERE name = ?", (role_name,)).fetchone()
    if role_row is None:
        return

    existing = database.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ?",
        (user_id, role_row["id"]),
    ).fetchone()
    if existing is not None:
        return

    database.execute(
        "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)",
        (user_id, role_row["id"]),
    )


def ensure_default_user_roles(database: DatabaseAdapter) -> None:
    users_without_roles = database.execute(
        """
        SELECT u.id
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.user_id IS NULL
        """
    ).fetchall()

    for row in users_without_roles:
        assign_role_to_user(database, row["id"], "rappresentante")


def run_credential_reset_once(database: DatabaseAdapter) -> None:
    existing_marker = database.execute(
        "SELECT value FROM app_settings WHERE key = ?",
        (CREDENTIAL_RESET_MIGRATION_KEY,),
    ).fetchone()
    if existing_marker is not None:
        return

    legacy_row = database.execute(
        "SELECT id FROM users WHERE username = ?",
        (LEGACY_OWNER_USERNAME,),
    ).fetchone()
    if legacy_row is not None:
        database.execute("DELETE FROM user_roles WHERE user_id = ?", (legacy_row["id"],))
        database.execute("DELETE FROM users WHERE id = ?", (legacy_row["id"],))

    user_rows = database.execute("SELECT id, username FROM users").fetchall()
    for user_row in user_rows:
        database.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
            (
                generate_password_hash(user_row["username"], method="pbkdf2:sha256"),
                user_row["id"],
            ),
        )

    database.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?)",
        (CREDENTIAL_RESET_MIGRATION_KEY, "done"),
    )


def ensure_users_columns(database: DatabaseAdapter) -> None:
    if database.backend != "sqlite":
        return

    columns = {
        row["name"] for row in database.execute("PRAGMA table_info(users)").fetchall()
    }
    required_columns = {
        "must_change_password": "INTEGER NOT NULL DEFAULT 1",
    }

    for column_name, column_definition in required_columns.items():
        if column_name not in columns:
            database.execute(
                f"ALTER TABLE users ADD COLUMN {column_name} {column_definition}"
            )


def fetch_user_by_id(user_id: int | None) -> dict | None:
    if user_id is None:
        return None

    row = get_db().execute(
        "SELECT id, full_name, username, password_hash, must_change_password, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        return None

    user = dict(row)
    user["roles"] = fetch_role_names_for_user(user["id"])
    user["permissions"] = fetch_permissions_for_user(user["id"])
    return user


def fetch_user_by_username(username: str) -> dict | None:
    row = get_db().execute(
        "SELECT id, full_name, username, password_hash, must_change_password, created_at FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if row is None:
        return None

    user = dict(row)
    user["roles"] = fetch_role_names_for_user(user["id"])
    user["permissions"] = fetch_permissions_for_user(user["id"])
    return user


def normalize_role_name(value: str) -> str:
    return value.strip().lower()


def fetch_role_names_for_user(user_id: int) -> list[str]:
    rows = get_db().execute(
        """
        SELECT r.name
        FROM roles r
        JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
        ORDER BY r.name ASC
        """,
        (user_id,),
    ).fetchall()
    return [row["name"] for row in rows]


def fetch_permissions_for_user(user_id: int) -> list[str]:
    rows = get_db().execute(
        """
        SELECT DISTINCT rp.permission
        FROM role_permissions rp
        JOIN user_roles ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = ?
        ORDER BY rp.permission ASC
        """,
        (user_id,),
    ).fetchall()
    return [row["permission"] for row in rows]


def fetch_all_roles_with_permissions() -> list[dict[str, object]]:
    role_rows = get_db().execute("SELECT id, name FROM roles ORDER BY name ASC").fetchall()
    roles_payload: list[dict[str, object]] = []
    for role_row in role_rows:
        permission_rows = get_db().execute(
            "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission ASC",
            (role_row["id"],),
        ).fetchall()
        roles_payload.append(
            {
                "id": role_row["id"],
                "name": role_row["name"],
                "permissions": [row["permission"] for row in permission_rows],
            }
        )
    return roles_payload


def fetch_users_with_roles() -> list[dict[str, object]]:
    user_rows = get_db().execute(
        "SELECT id, username, full_name FROM users ORDER BY username ASC"
    ).fetchall()
    payload: list[dict[str, object]] = []
    for user_row in user_rows:
        payload.append(
            {
                "id": user_row["id"],
                "username": user_row["username"],
                "full_name": user_row["full_name"],
                "roles": fetch_role_names_for_user(user_row["id"]),
            }
        )
    return payload


def get_app_setting(key: str) -> str | None:
    row = get_db().execute(
        "SELECT value FROM app_settings WHERE key = ?",
        (key,),
    ).fetchone()
    if row is None:
        return None
    return str(row["value"])


def set_app_setting(key: str, value: str) -> None:
    get_db().execute(
        """
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )


def get_school_countdown_target_date() -> str | None:
    raw_target = get_app_setting(COUNTDOWN_TARGET_DATE_KEY)
    if not raw_target:
        return None
    try:
        return date.fromisoformat(raw_target).isoformat()
    except ValueError:
        return None


def count_weekdays_between(start_date: date, end_date: date) -> int:
    if end_date < start_date:
        return 0

    total_days = 0
    current_date = start_date
    while current_date <= end_date:
        if current_date.weekday() < 5:
            total_days += 1
        current_date = current_date.fromordinal(current_date.toordinal() + 1)
    return total_days


def build_school_countdown_payload() -> dict[str, object]:
    today = date.today()
    target_iso = get_school_countdown_target_date()
    if target_iso is None:
        return {
            "today": today.isoformat(),
            "target_date": None,
            "weekdays_remaining": 0,
            "school_hours_remaining": 0,
        }

    target_date = date.fromisoformat(target_iso)
    weekdays_remaining = count_weekdays_between(today, target_date)
    return {
        "today": today.isoformat(),
        "target_date": target_iso,
        "weekdays_remaining": weekdays_remaining,
        "school_hours_remaining": weekdays_remaining * SCHOOL_HOURS_PER_DAY,
    }


def migrate_events_table(database: DatabaseAdapter) -> None:
    if database.backend != "sqlite":
        return

    row = database.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'"
    ).fetchone()

    if row is None:
        return

    table_sql = (row["sql"] or "").lower()
    if "'evento'" in table_sql:
        return

    database.executescript(
        """
        ALTER TABLE events RENAME TO events_legacy;

        CREATE TABLE events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK (event_type IN ('verifica', 'interrogazione', 'evento')),
            class_group TEXT NOT NULL DEFAULT 'Classe',
            scheduled_for TEXT NOT NULL,
            interrogation_mode TEXT NOT NULL DEFAULT '',
            interrogation_end TEXT NOT NULL DEFAULT '',
            interrogation_dates TEXT NOT NULL DEFAULT '',
            interrogation_schedule TEXT NOT NULL DEFAULT '',
            interrogated_students TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'programmata' CHECK (status IN ('programmata', 'completata', 'rinviata')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO events (
            id,
            title,
            subject,
            event_type,
            class_group,
            scheduled_for,
            interrogation_mode,
            interrogation_end,
            interrogation_dates,
            interrogation_schedule,
            interrogated_students,
            notes,
            created_by,
            status,
            created_at
        )
        SELECT
            id,
            title,
            subject,
            event_type,
            class_group,
            scheduled_for,
            '' AS interrogation_mode,
            '' AS interrogation_end,
            '' AS interrogation_dates,
            '' AS interrogation_schedule,
            '' AS interrogated_students,
            notes,
            created_by,
            status,
            created_at
        FROM events_legacy;

        DROP TABLE events_legacy;

        CREATE INDEX IF NOT EXISTS idx_events_scheduled_for ON events (scheduled_for);
        CREATE INDEX IF NOT EXISTS idx_events_subject ON events (subject);
        CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
        """
    )


def ensure_events_columns(database: DatabaseAdapter) -> None:
    if database.backend != "sqlite":
        return

    columns = {
        row["name"] for row in database.execute("PRAGMA table_info(events)").fetchall()
    }
    required_columns = {
        "interrogation_mode": "TEXT NOT NULL DEFAULT ''",
        "interrogation_end": "TEXT NOT NULL DEFAULT ''",
        "interrogation_dates": "TEXT NOT NULL DEFAULT ''",
        "interrogation_schedule": "TEXT NOT NULL DEFAULT ''",
        "interrogated_students": "TEXT NOT NULL DEFAULT ''",
    }

    for column_name, column_definition in required_columns.items():
        if column_name not in columns:
            database.execute(
                f"ALTER TABLE events ADD COLUMN {column_name} {column_definition}"
            )


def fetch_events(filters: dict[str, str]) -> list[dict]:
    query = """
        SELECT id, title, subject, event_type, class_group, scheduled_for,
               interrogation_mode, interrogation_end, interrogation_dates,
             interrogation_schedule,
               interrogated_students, notes, created_by, status, created_at
        FROM events
        WHERE 1 = 1
    """
    params: list[str] = []

    month = filters.get("month")
    if month:
        month_start = date.fromisoformat(f"{month}-01")
        if month_start.month == 12:
            next_month_start = date(month_start.year + 1, 1, 1)
        else:
            next_month_start = date(month_start.year, month_start.month + 1, 1)

        query += """
            AND (
                scheduled_for LIKE ?
                OR interrogation_dates LIKE ?
                OR (
                    event_type = 'interrogazione'
                    AND interrogation_mode = 'period'
                    AND scheduled_for < ?
                    AND interrogation_end >= ?
                )
            )
        """
        params.extend(
            [
                f"{month}%",
                f"%{month}-%",
                next_month_start.isoformat(),
                month_start.isoformat(),
            ]
        )

    subject = filters.get("subject")
    if subject:
        query += " AND LOWER(subject) LIKE ?"
        params.append(f"%{subject.lower()}%")

    query += " AND class_group = ?"
    params.append(DEFAULT_CLASS_GROUP)

    query += " ORDER BY scheduled_for ASC, subject ASC, created_at ASC"
    rows = get_db().execute(query, params).fetchall()
    return [dict(row) for row in rows]


def fetch_all_events() -> list[dict]:
    rows = get_db().execute(
        """
        SELECT id, title, subject, event_type, class_group, scheduled_for,
               interrogation_mode, interrogation_end, interrogation_dates,
               interrogation_schedule, interrogated_students, notes,
               created_by, status, created_at
        FROM events
        WHERE class_group = ?
        ORDER BY scheduled_for ASC, subject ASC, created_at ASC
        """,
        (DEFAULT_CLASS_GROUP,),
    ).fetchall()
    return [dict(row) for row in rows]


def build_personal_schedule(full_name: str) -> list[dict[str, object]]:
    grouped_schedule: dict[str, list[dict[str, str]]] = {}

    for event in fetch_all_events():
        if event["event_type"] == "interrogazione":
            schedule = parse_interrogation_schedule_json(event.get("interrogation_schedule", ""))
            for date_value, students in schedule.items():
                if full_name not in students:
                    continue
                grouped_schedule.setdefault(date_value, []).append(
                    {
                        "event_type": event["event_type"],
                        "type_label": "Interrogazione",
                        "subject": event["subject"],
                        "notes": event["notes"] or "Argomenti o pagine non inseriti.",
                    }
                )
            continue

        grouped_schedule.setdefault(event["scheduled_for"], []).append(
            {
                "event_type": event["event_type"],
                "type_label": format_event_type_label(event["event_type"]),
                "subject": event["subject"],
                "notes": event["notes"] or "Nessun dettaglio inserito.",
            }
        )

    ordered_dates = sorted(grouped_schedule)
    return [
        {
            "date": date_value,
            "label": format_long_date(date_value),
            "items": grouped_schedule[date_value],
        }
        for date_value in ordered_dates
    ]


def fetch_event_by_id(event_id: int) -> dict | None:
    row = get_db().execute(
        """
        SELECT id, title, subject, event_type, class_group, scheduled_for,
               interrogation_mode, interrogation_end, interrogation_dates,
             interrogation_schedule,
               interrogated_students, notes, created_by, status, created_at
        FROM events
        WHERE id = ? AND class_group = ?
        """,
        (event_id, DEFAULT_CLASS_GROUP),
    ).fetchone()
    return dict(row) if row is not None else None


def parse_interrogation_schedule_json(value: str) -> dict[str, list[str]]:
    if not value:
        return {}

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}

    if not isinstance(parsed, dict):
        return {}

    normalized: dict[str, list[str]] = {}
    for date_value, students in parsed.items():
        if isinstance(students, list):
            normalized[date_value] = [str(student).strip() for student in students if str(student).strip()]
        elif isinstance(students, str):
            normalized[date_value] = normalize_multiline_text(students).splitlines()
    return normalized


def format_event_type_label(event_type: str) -> str:
    if event_type == "interrogazione":
        return "Interrogazione"
    if event_type == "evento":
        return "Evento"
    return "Verifica"


def format_long_date(value: str) -> str:
    parsed_date = date.fromisoformat(value)
    weekdays = [
        "Lunedi",
        "Martedi",
        "Mercoledi",
        "Giovedi",
        "Venerdi",
        "Sabato",
        "Domenica",
    ]
    return f"{weekdays[parsed_date.weekday()]} {parsed_date.strftime('%d/%m/%Y')}"


def validate_event_payload(payload: dict) -> tuple[dict[str, str], dict[str, str]]:
    errors: dict[str, str] = {}
    cleaned: dict[str, str] = {}

    event_type = str(payload.get("event_type", DEFAULT_EVENT_TYPE)).strip().lower()
    if event_type not in VALID_EVENT_TYPES:
        errors["event_type"] = "Scegli verifica, interrogazione o evento."
    cleaned["event_type"] = event_type

    subject = str(payload.get("subject", "")).strip()
    if event_type == "evento":
        subject = VALID_EVENT_SUBJECTS.get(subject.lower(), "")
        if not subject:
            errors["subject"] = "Per gli eventi scegli uscita didattica, assemblea, compleanni o altro."
    elif not subject:
        errors["subject"] = "La materia e obbligatoria."
    cleaned["subject"] = subject

    scheduled_for = str(payload.get("scheduled_for", "")).strip()
    interrogation_mode = ""
    interrogation_end = ""
    interrogation_dates = ""
    interrogation_schedule = ""
    interrogated_students = ""

    if event_type == "interrogazione":
        interrogation_mode = str(payload.get("interrogation_mode", "period")).strip().lower()
        if interrogation_mode not in VALID_INTERROGATION_MODES:
            errors["interrogation_mode"] = "Scegli periodo o giorni specifici."
        raw_schedule = str(payload.get("interrogation_schedule", "")).strip()
        legacy_students = normalize_multiline_text(str(payload.get("interrogated_students", "")))

        if interrogation_mode == "specific_days":
            parsed_dates = parse_iso_date_lines(str(payload.get("interrogation_dates", "")))
            if not parsed_dates:
                errors["interrogation_dates"] = "Inserisci almeno un giorno valido."
            else:
                scheduled_for = parsed_dates[0]
                interrogation_end = parsed_dates[-1]
                interrogation_dates = "\n".join(parsed_dates)
        else:
            try:
                start_date = date.fromisoformat(scheduled_for)
            except ValueError:
                errors["scheduled_for"] = "Inserisci una data di inizio valida."
                start_date = None

            interrogation_end = str(payload.get("interrogation_end", "")).strip()
            try:
                end_date = date.fromisoformat(interrogation_end)
            except ValueError:
                errors["interrogation_end"] = "Inserisci una data finale valida."
                end_date = None

            if start_date is not None and end_date is not None and end_date < start_date:
                errors["interrogation_end"] = "La data finale deve essere uguale o successiva a quella iniziale."

            parsed_dates = (
                build_date_range(scheduled_for, interrogation_end)
                if "scheduled_for" not in errors and "interrogation_end" not in errors
                else []
            )

        if parsed_dates:
            (
                interrogation_schedule,
                interrogated_students,
                schedule_errors,
            ) = validate_interrogation_schedule(raw_schedule, parsed_dates, legacy_students)
            errors.update(schedule_errors)
        cleaned["interrogation_mode"] = interrogation_mode
    else:
        try:
            date.fromisoformat(scheduled_for)
        except ValueError:
            errors["scheduled_for"] = "Inserisci una data valida."

    cleaned["scheduled_for"] = scheduled_for
    cleaned["interrogation_end"] = interrogation_end
    cleaned["interrogation_dates"] = interrogation_dates
    cleaned["interrogation_schedule"] = interrogation_schedule
    cleaned["interrogated_students"] = interrogated_students
    if event_type != "interrogazione":
        cleaned["interrogation_mode"] = ""

    title = str(payload.get("title", "")).strip()
    cleaned["title"] = title or build_default_title(subject, event_type)

    cleaned["class_group"] = DEFAULT_CLASS_GROUP

    cleaned["notes"] = str(payload.get("notes", "")).strip()
    cleaned["created_by"] = str(payload.get("created_by", "")).strip()

    status = str(payload.get("status", "programmata")).strip().lower()
    if status not in VALID_STATUSES:
        errors["status"] = "Lo stato scelto non e valido."
    cleaned["status"] = status

    return cleaned, errors


def normalize_multiline_text(value: str) -> str:
    cleaned_lines = [line.strip() for line in value.replace(",", "\n").splitlines() if line.strip()]
    return "\n".join(cleaned_lines)


def parse_iso_date_lines(value: str) -> list[str]:
    dates: list[str] = []
    seen_dates: set[str] = set()

    for raw_line in value.replace(",", "\n").splitlines():
        candidate = raw_line.strip()
        if not candidate:
            continue
        try:
            parsed_value = date.fromisoformat(candidate).isoformat()
        except ValueError:
            continue
        if parsed_value not in seen_dates:
            seen_dates.add(parsed_value)
            dates.append(parsed_value)

    return sorted(dates)


def build_date_range(start_value: str, end_value: str) -> list[str]:
    start_date = date.fromisoformat(start_value)
    end_date = date.fromisoformat(end_value)
    days: list[str] = []
    current_date = start_date

    while current_date <= end_date:
        if current_date.weekday() < 5:
            days.append(current_date.isoformat())
        current_date = current_date.fromordinal(current_date.toordinal() + 1)

    return days


def validate_interrogation_schedule(
    raw_schedule: str, expected_dates: list[str], legacy_students: str
) -> tuple[str, str, dict[str, str]]:
    errors: dict[str, str] = {}
    normalized_schedule: dict[str, list[str]] = {}

    if raw_schedule:
        try:
            parsed_schedule = json.loads(raw_schedule)
        except json.JSONDecodeError:
            parsed_schedule = None
        if not isinstance(parsed_schedule, dict):
            errors["interrogation_schedule"] = "Il piano giornaliero delle interrogazioni non e valido."
            parsed_schedule = {}
    else:
        parsed_schedule = {}

    if not parsed_schedule and legacy_students:
        normalized_students = [line for line in legacy_students.splitlines() if line]
        parsed_schedule = {date_value: normalized_students for date_value in expected_dates}

    for date_value in expected_dates:
        students_for_day = parsed_schedule.get(date_value, [])
        if isinstance(students_for_day, str):
            students_list = normalize_multiline_text(students_for_day).splitlines()
        elif isinstance(students_for_day, list):
            students_list = [str(student).strip() for student in students_for_day if str(student).strip()]
        else:
            students_list = []

        if not students_list:
            errors["interrogation_schedule"] = "Inserisci gli interrogati per ogni giorno previsto."
        normalized_schedule[date_value] = students_list

    unique_students: list[str] = []
    seen_students: set[str] = set()
    for date_value in expected_dates:
        for student in normalized_schedule.get(date_value, []):
            if student not in seen_students:
                seen_students.add(student)
                unique_students.append(student)

    return json.dumps(normalized_schedule, ensure_ascii=True), "\n".join(unique_students), errors


def build_default_title(subject: str, event_type: str) -> str:
    if not subject or not event_type:
        return "Nuovo evento"
    if event_type == DEFAULT_EVENT_TYPE:
        return f"Verifica di {subject}"
    if event_type == "evento":
        return f"Evento: {subject}"
    return f"{event_type.title()} di {subject}"


def get_server_port() -> int:
    raw_port = os.environ.get("PORT") or os.environ.get("FLASK_RUN_PORT") or str(DEFAULT_PORT)
    try:
        return int(raw_port)
    except ValueError:
        return DEFAULT_PORT


def get_server_host() -> str:
    return os.environ.get("HOST") or os.environ.get("FLASK_RUN_HOST") or DEFAULT_HOST


def is_process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def free_port(port: int) -> None:
    try:
        result = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}"],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return

    current_pid = os.getpid()
    pids = {
        int(raw_pid)
        for raw_pid in result.stdout.splitlines()
        if raw_pid.strip().isdigit() and int(raw_pid) != current_pid
    }

    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            continue

    if pids:
        time.sleep(0.2)

    for pid in pids:
        if not is_process_alive(pid):
            continue
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            continue


app = create_app()


if __name__ == "__main__":
    host = get_server_host()
    port = get_server_port()
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        free_port(port)
    app.run(host=host, port=port, debug=True)