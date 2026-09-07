import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from '../errors.js';
import { withTransaction } from '../db.js';
import { writeOperationLog } from './logs.js';
import { validatePassword } from '../users/validation.js';

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    isSuperAdmin: Boolean(user.is_super_admin),
    mustChangePassword: Boolean(user.must_change_password)
  };
}

export function authRouter({ db, jwtSecret, requireAuth }) {
  const router = express.Router();
  router.post('/login', (req, res, next) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      if (!username || !password) throw new AppError(400, 'VALIDATION_ERROR', '请输入账号和密码');
      const user = db.prepare('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL').get(username);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        throw new AppError(401, 'INVALID_CREDENTIALS', '账号或密码错误');
      }
      if (!user.is_active) throw new AppError(403, 'ACCOUNT_DISABLED', '账号已停用，请联系管理员');
      const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: '8h' });
      res.json({ data: { token, user: publicUser(user) } });
    } catch (error) { next(error); }
  });
  router.post('/change-password', requireAuth, (req, res, next) => {
    try {
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = validatePassword(req.body?.newPassword);
      const account = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      if (!account || !bcrypt.compareSync(currentPassword, account.password_hash)) {
        throw new AppError(400, 'INVALID_CURRENT_PASSWORD', '当前密码不正确');
      }
      if (currentPassword === newPassword) throw new AppError(400, 'VALIDATION_ERROR', '新密码不能与当前密码相同');
      const passwordHash = bcrypt.hashSync(newPassword, 10);
      withTransaction(db, () => {
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
          .run(passwordHash, new Date().toISOString(), req.user.id);
        writeOperationLog(db, { actor: req.user, action: 'password_changed', details: { userId: req.user.id } });
      });
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      res.json({ data: { user: publicUser(user) }, message: '密码修改成功' });
    } catch (error) { next(error); }
  });
  router.get('/me', requireAuth, (req, res) => res.json({ data: { user: publicUser(req.user) } }));
  return router;
}
