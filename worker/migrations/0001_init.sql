CREATE TABLE tokens (
  token TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE opens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL REFERENCES tokens(token),
  ts TEXT NOT NULL,
  user_agent TEXT,
  asn INTEGER,
  as_org TEXT,
  country TEXT,
  ip_hash TEXT
);

CREATE INDEX opens_id ON opens(id);
