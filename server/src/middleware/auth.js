import jwt from 'jsonwebtoken';
import { AppError } from '../errors.js';

export function authMiddleware({ db, jwtSecret }) {
  return function requireAuth(req, _res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return next(new AppError(401, 'UNAUTHENTICATED', '请先登录'));
    try {
      const payload = jwt.verify(header.slice(7), jwtSecret);
      const user = db.prepare(`SELECT id, username, display_name, role, is_super_admin, is_active, must_change_password
        FROM users WHERE id = ? AND deleted_at IS NULL`).get(payload.id);
      if (!user) return next(new AppError(401, 'UNAUTHENTICATED', '登录信息无效，请重新登录'));
      if (!user.is_active) return next(new AppError(403, 'ACCOUNT_DISABLED', '账号已停用，请联系管理员'));
      req.user = { ...user, isActive: Boolean(user.is_active), displayName: user.display_name };
      const passwordRoutes = new Set(['/api/auth/me', '/api/auth/change-password']);
      if (user.must_change_password && !passwordRoutes.has(req.originalUrl.split('?')[0])) {
        return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改初始密码'));
      }
      next();
    } catch (error) {
      if (error instanceof AppError) return next(error);
      if (error.name === 'TokenExpiredError') return next(new AppError(401, 'TOKEN_EXPIRED', '登录已过期，请重新登录'));
      return next(new AppError(401, 'INVALID_TOKEN', '登录信息无效，请重新登录'));
    }
  };
}

export function requireRole(role) {
  return function roleGuard(req, _res, next) {
    if (req.user?.role !== role) return next(new AppError(403, 'FORBIDDEN', '没有权限执行此操作'));
    next();
  };
}
