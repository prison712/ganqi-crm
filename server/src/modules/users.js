import express from 'express';
import bcrypt from 'bcryptjs';
import { AppError } from '../errors.js';
import { nowIso, withTransaction } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { writeOperationLog } from './logs.js';
import { validateDisplayName, validatePassword, validateUsername } from '../users/validation.js';

function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isSuperAdmin: Boolean(row.is_super_admin),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at
  };
}

function userId(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AppError(400, 'VALIDATION_ERROR', '销售账号编号不正确');
  return parsed;
}

export function usersRouter({ db, requireAuth }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', (req, res, next) => {
    if (req.query.includeAdmins === '1' && !req.user.is_super_admin) {
      return next(new AppError(403, 'FORBIDDEN', '只有超级管理员可以查看管理员子账号'));
    }
    const roleClause = req.query.includeAdmins === '1' ? '' : "AND role = 'sales'";
    const users = db.prepare(`SELECT * FROM users WHERE deleted_at IS NULL ${roleClause} ORDER BY id DESC`).all().map(toPublicUser);
    res.json({ data: { items: users } });
  });

  router.post('/', (req, res, next) => {
    try {
      const username = validateUsername(req.body?.username);
      const displayName = validateDisplayName(req.body?.displayName);
      const password = validatePassword(req.body?.password);
      const role = req.body?.role === undefined ? 'sales' : String(req.body.role);
      if (!['admin', 'sales'].includes(role)) throw new AppError(400, 'VALIDATION_ERROR', '账号角色不正确');
      if (role === 'admin' && !req.user.is_super_admin) {
        throw new AppError(403, 'FORBIDDEN', '只有超级管理员可以创建管理员子账号');
      }
      const now = nowIso();
      let result;
      try {
        const passwordHash = bcrypt.hashSync(password, 10);
        withTransaction(db, () => {
          result = db.prepare(`INSERT INTO users
            (username, display_name, password_hash, role, is_super_admin, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, 1, ?, ?)`)
            .run(username, displayName, passwordHash, role, now, now);
          writeOperationLog(db, { actor: req.user, action: 'account_created', details: { userId: Number(result.lastInsertRowid), username, role } });
        });
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw new AppError(409, 'USERNAME_EXISTS', '该账号已存在');
        throw error;
      }
      res.status(201).json({
        data: { user: toPublicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)) },
        message: role === 'admin' ? '管理员子账号创建成功' : '销售账号创建成功'
      });
    } catch (error) { next(error); }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const id = userId(req.params.id);
      let displayName;
      let username;
      withTransaction(db, () => {
        const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'sales' AND deleted_at IS NULL").get(id);
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', '销售账号不存在');
        username = validateUsername(req.body?.username ?? user.username);
        displayName = validateDisplayName(req.body?.displayName ?? user.display_name);
        try {
          db.prepare('UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?')
            .run(username, displayName, nowIso(), id);
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) throw new AppError(409, 'USERNAME_EXISTS', '该账号已存在');
          throw error;
        }
        writeOperationLog(db, { actor: req.user, action: 'account_updated', details: { userId: id, username } });
      });
      res.json({ data: { user: toPublicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) }, message: '账号信息已更新' });
    } catch (error) { next(error); }
  });

  router.post('/:id/reset-password', (req, res, next) => {
    try {
      const id = userId(req.params.id);
      const password = validatePassword(req.body?.password);
      const passwordHash = bcrypt.hashSync(password, 10);
      withTransaction(db, () => {
        const result = db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND role = 'sales' AND deleted_at IS NULL")
          .run(passwordHash, nowIso(), id);
        if (!result.changes) throw new AppError(404, 'USER_NOT_FOUND', '销售账号不存在');
        writeOperationLog(db, { actor: req.user, action: 'password_reset', details: { userId: id } });
      });
      res.json({ message: '密码重置成功' });
    } catch (error) { next(error); }
  });

  router.post('/:id/toggle-active', (req, res, next) => {
    try {
      const id = userId(req.params.id);
      const isActive = req.body?.isActive;
      if (typeof isActive !== 'boolean') throw new AppError(400, 'VALIDATION_ERROR', '启用状态参数不正确');
      withTransaction(db, () => {
        const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'sales' AND deleted_at IS NULL").get(id);
        if (!target) throw new AppError(404, 'USER_NOT_FOUND', '销售账号不存在');
        if (!isActive) {
          const customers = db.prepare('SELECT id, company_name FROM customers WHERE owner_id = ?').all(id);
          for (const customer of customers) {
            db.prepare('UPDATE customers SET owner_id = NULL, updated_at = ? WHERE id = ?').run(nowIso(), customer.id);
            writeOperationLog(db, {
              actor: req.user,
              action: 'release',
              customerId: customer.id,
              customerName: customer.company_name,
              fromOwnerId: id,
              details: { reason: '销售账号停用自动释放' }
            });
          }
        }
        db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, nowIso(), id);
        writeOperationLog(db, {
          actor: req.user,
          action: isActive ? 'account_enabled' : 'account_disabled',
          details: { userId: id, username: target.username }
        });
      });
      res.json({ message: isActive ? '账号已启用' : '账号已停用，名下客户已释放到公海' });
    } catch (error) { next(error); }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const id = userId(req.params.id);
      withTransaction(db, () => {
        const target = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
        if (!target) throw new AppError(404, 'USER_NOT_FOUND', '销售账号不存在');
        if (target.role !== 'sales') throw new AppError(403, 'FORBIDDEN', '只能删除销售账号，管理员账号受保护');
        const timestamp = nowIso();
        const customers = db.prepare('SELECT id, company_name FROM customers WHERE owner_id = ?').all(id);
        for (const customer of customers) {
          db.prepare('UPDATE customers SET owner_id = NULL, updated_at = ? WHERE id = ?').run(timestamp, customer.id);
          writeOperationLog(db, {
            actor: req.user,
            action: 'release',
            customerId: customer.id,
            customerName: customer.company_name,
            fromOwnerId: id,
            details: { reason: '销售账号删除自动释放' }
          });
        }
        db.prepare(`UPDATE users SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?`)
          .run(timestamp, req.user.id, timestamp, id);
        writeOperationLog(db, {
          actor: req.user,
          action: 'account_deleted',
          details: { userId: id, username: target.username, displayName: target.display_name }
        });
      });
      res.json({ message: '销售账号已删除，名下客户已释放到公海' });
    } catch (error) { next(error); }
  });
  return router;
}
