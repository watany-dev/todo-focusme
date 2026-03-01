CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  due_date TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_arch_due
  ON tasks(user_email, archived_at, due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON tasks(user_email, created_at);
