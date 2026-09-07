import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { createDatabase } from '../src/db.js';

const cleanup = [];
const databases = [];

afterEach(() => {
  while (databases.length) {
    try { databases.pop().close(); } catch { /* already closed */ }
  }
  while (cleanup.length) fs.rmSync(cleanup.pop(), { recursive: true, force: true });
});

describe('用户表兼容迁移', () => {
  it('旧数据库自动增加账号字段并将最早管理员设为超级管理员', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-user-migration-'));
    cleanup.push(directory);
    const filename = path.join(directory, 'legacy.sqlite');
    const legacy = new DatabaseSync(filename);
    legacy.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'sales')),
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      demo_tag TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    const insert = legacy.prepare(`INSERT INTO users
      (username, display_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', 1, ?, ?)`);
    insert.run('older_admin', '早期管理员', bcrypt.hashSync('admin123', 4), '2025-01-01', '2025-01-01');
    insert.run('newer_admin', '后期管理员', bcrypt.hashSync('admin123', 4), '2026-01-01', '2026-01-01');
    legacy.close();

    let migrated = createDatabase({ filename });
    databases.push(migrated);
    const columns = migrated.prepare('PRAGMA table_info(users)').all().map(column => column.name);
    expect(columns).toEqual(expect.arrayContaining(['is_super_admin', 'deleted_at', 'deleted_by']));
    expect(migrated.prepare('SELECT username FROM users WHERE is_super_admin = 1').all())
      .toEqual([{ username: 'older_admin' }]);
    migrated.close();
    databases.pop();

    migrated = createDatabase({ filename });
    databases.push(migrated);
    expect(migrated.prepare('SELECT count(*) total FROM users WHERE is_super_admin = 1').get().total).toBe(1);
    migrated.close();
    databases.pop();
  });
});
