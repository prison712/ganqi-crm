import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

export const JWT_SECRET = 'test-secret-with-enough-length';

export function createTestApp({ documentStorage, documentLimits } = {}) {
  const db = createDatabase({ filename: ':memory:' });
  const app = createApp({ db, jwtSecret: JWT_SECRET, documentStorage, documentLimits });
  const expiredToken = jwt.sign({ id: 1, role: 'admin' }, JWT_SECRET, { expiresIn: -1 });
  return { app, db, expiredToken };
}

export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

export function insertUser(db, { username, displayName, role = 'sales', password = 'sales123', isActive = 1 }) {
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO users
    (username, display_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(username, displayName, bcrypt.hashSync(password, 4), role, isActive, now, now);
  return { id: Number(result.lastInsertRowid), username, displayName, role };
}

export function insertCustomer(db, { companyName = '测试客户', ownerId = null, deletedAt = null, createdBy = 1 } = {}) {
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO customers
    (company_name, owner_id, created_by, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(companyName, ownerId, createdBy, now, now, deletedAt);
  return { id: Number(result.lastInsertRowid), companyName, ownerId };
}

export function insertDocument(db, {
  originalName = '销售手册.pdf', storageKey = crypto.randomUUID() + '.pdf', category = 'sales_tool',
  description = '', extension = 'pdf', mimeType = 'application/pdf', sizeBytes = 12,
  sha256 = 'a'.repeat(64), uploadedBy = 1, deletedAt = null, deletedBy = null
} = {}) {
  const createdAt = new Date().toISOString();
  const result = db.prepare(`INSERT INTO public_documents
    (original_name, storage_key, category, description, extension, mime_type, size_bytes, sha256, uploaded_by, created_at, deleted_at, deleted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(originalName, storageKey, category, description, extension, mimeType, sizeBytes, sha256, uploadedBy, createdAt, deletedAt, deletedBy);
  return { id: Number(result.lastInsertRowid), originalName, storageKey, uploadedBy };
}

export function createAuthenticatedTestApp(options) {
  const context = createTestApp(options);
  context.db.prepare('UPDATE users SET must_change_password = 0 WHERE id = 1').run();
  const adminToken = jwt.sign({ id: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  const salesA = insertUser(context.db, { username: 'sales_a', displayName: '销售甲' });
  const salesB = insertUser(context.db, { username: 'sales_b', displayName: '销售乙' });
  return {
    ...context,
    adminToken,
    salesA,
    salesB,
    salesAToken: jwt.sign({ id: salesA.id, role: 'sales' }, JWT_SECRET, { expiresIn: '1h' }),
    salesBToken: jwt.sign({ id: salesB.id, role: 'sales' }, JWT_SECRET, { expiresIn: '1h' })
  };
}
