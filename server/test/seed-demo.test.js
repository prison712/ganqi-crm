import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, nowIso } from '../src/db.js';
import { seedDemo } from '../src/seed-demo.js';
import { resolveDataPath } from '../src/config.js';
import path from 'node:path';

let db;
afterEach(() => db?.close());

describe('模拟数据脚本', () => {
  it('数据库路径固定在项目根目录 data 并兼容 Windows', () => {
    expect(resolveDataPath('demo.sqlite')).toBe(path.resolve(process.cwd(), '..', 'data', 'demo.sqlite'));
  });

  it('可重复执行且不会删除用户自行创建的数据', () => {
    db = createDatabase({ filename: ':memory:' });
    const timestamp = nowIso();
    const real = db.prepare(`INSERT INTO customers
      (company_name, created_by, created_at, updated_at) VALUES (?, 1, ?, ?)`)
      .run('真实客户', timestamp, timestamp);
    seedDemo(db);
    const demoCustomer = db.prepare("SELECT id FROM customers WHERE demo_tag = 'customer-erp-v1' ORDER BY id LIMIT 1").get();
    db.prepare(`INSERT INTO follow_ups
      (customer_id, author_id, followed_at, content, created_at) VALUES (?, 1, ?, ?, ?)`)
      .run(demoCustomer.id, timestamp, '用户补充的真实跟进', timestamp);
    seedDemo(db);
    expect(db.prepare("SELECT count(*) total FROM customers WHERE company_name = '真实客户'").get().total).toBe(1);
    expect(db.prepare("SELECT count(*) total FROM users WHERE username LIKE 'demo_%'").get().total).toBe(3);
    expect(db.prepare("SELECT count(*) total FROM customers WHERE demo_tag = 'customer-erp-v1'").get().total).toBe(12);
    expect(db.prepare("SELECT count(*) total FROM follow_ups WHERE content = '用户补充的真实跟进'").get().total).toBe(1);
    expect(db.prepare('SELECT id FROM customers WHERE id = ?').get(real.lastInsertRowid)).toBeTruthy();
  });

  it('演示账号名称被真实账号占用时拒绝覆盖', () => {
    db = createDatabase({ filename: ':memory:' });
    const timestamp = nowIso();
    const originalHash = db.prepare('SELECT password_hash FROM users WHERE id = 1').get().password_hash;
    db.prepare(`INSERT INTO users
      (username, display_name, password_hash, role, is_active, created_at, updated_at)
      VALUES ('demo_sales01', '真实销售', ?, 'sales', 1, ?, ?)`)
      .run(originalHash, timestamp, timestamp);
    expect(() => seedDemo(db)).toThrow('演示账号 demo_sales01 已被现有账号占用');
    expect(db.prepare("SELECT display_name, demo_tag FROM users WHERE username = 'demo_sales01'").get())
      .toEqual({ display_name: '真实销售', demo_tag: null });
  });
});
