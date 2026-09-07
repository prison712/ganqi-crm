import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { resolveDataPath } from './config.js';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'sales')),
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  demo_tag TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  source TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'potential' CHECK (status IN ('potential', 'following', 'won', 'lost')),
  notes TEXT DEFAULT '',
  owner_id INTEGER REFERENCES users(id),
  last_followed_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  demo_tag TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS follow_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  followed_at TEXT NOT NULL,
  content TEXT NOT NULL,
  next_plan TEXT DEFAULT '',
  demo_tag TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  from_owner_id INTEGER,
  to_owner_id INTEGER,
  details TEXT DEFAULT '{}',
  demo_tag TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS public_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('policy', 'product', 'sales_tool', 'training', 'other')),
  description TEXT NOT NULL DEFAULT '',
  extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_customers_deleted ON customers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_followups_customer ON follow_ups(customer_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON operation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_active_created ON public_documents(deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_category_created ON public_documents(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_uploader ON public_documents(uploaded_by);
`;

export function nowIso() {
  return new Date().toISOString();
}

export function withTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createDatabase({ filename } = {}) {
  const target = filename === ':memory:' ? filename : resolveDataPath(filename);
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (target !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(schema);
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
  if (!userColumns.includes('must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
  if (!userColumns.includes('is_super_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0');
  }
  if (!userColumns.includes('deleted_at')) {
    db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT');
  }
  if (!userColumns.includes('deleted_by')) {
    db.exec('ALTER TABLE users ADD COLUMN deleted_by INTEGER REFERENCES users(id)');
  }
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1").get();
  if (!admin) {
    const timestamp = nowIso();
    db.prepare(`INSERT INTO users
      (username, display_name, password_hash, role, is_super_admin, is_active, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', 1, 1, 1, ?, ?)`)
      .run('admin', '系统管理员', bcrypt.hashSync('admin123', 10), timestamp, timestamp);
  } else {
    const superAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_super_admin = 1 LIMIT 1").get();
    if (!superAdmin) db.prepare('UPDATE users SET is_super_admin = 1 WHERE id = ?').run(admin.id);
    const current = db.prepare('SELECT password_hash, must_change_password FROM users WHERE id = ?').get(admin.id);
    if (!current.must_change_password && bcrypt.compareSync('admin123', current.password_hash)) {
      db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(admin.id);
    }
  }
  return db;
}
