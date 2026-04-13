CREATE TABLE IF NOT EXISTS events (
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

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_scheduled_for ON events (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_events_subject ON events (subject);
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);