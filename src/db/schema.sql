CREATE TABLE teams (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lng  REAL NOT NULL,
  lat  REAL NOT NULL
);

CREATE TABLE delivery_windows (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id),
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL
);
CREATE INDEX idx_windows_start ON delivery_windows(start_time);

CREATE TABLE quotes (
  id         TEXT PRIMARY KEY,
  window_id  TEXT NOT NULL REFERENCES delivery_windows(id),
  lng        REAL NOT NULL,
  lat        REAL NOT NULL,
  min_time   TEXT NOT NULL,
  max_time   TEXT NOT NULL,
  weight     REAL NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_quotes_window ON quotes(window_id);

CREATE TABLE orders (
  id         TEXT PRIMARY KEY,
  window_id  TEXT NOT NULL REFERENCES delivery_windows(id),
  lng        REAL NOT NULL,
  lat        REAL NOT NULL,
  weight     REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_orders_window ON orders(window_id);
