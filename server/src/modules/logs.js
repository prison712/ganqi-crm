import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../errors.js';

export function writeOperationLog(db, entry) {
  const actorName = entry.actorName || entry.actor?.display_name || entry.actor?.displayName || '系统';
  db.prepare(`INSERT INTO operation_logs
    (actor_id, actor_name, action, customer_id, customer_name, from_owner_id, to_owner_id, details, demo_tag, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      entry.actorId ?? entry.actor?.id ?? null,
      actorName,
      entry.action,
      entry.customerId ?? null,
      entry.customerName ?? null,
      entry.fromOwnerId ?? null,
      entry.toOwnerId ?? null,
      JSON.stringify(entry.details || {}),
      entry.demoTag ?? null,
      entry.createdAt || new Date().toISOString()
    );
}

export function logsRouter({ db, requireAuth }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));
  router.get('/', (req, res, next) => {
    try {
      const parsePage = (value, fallback, max) => {
        if (value === undefined || value === '') return fallback;
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new AppError(400, 'VALIDATION_ERROR', '分页参数不正确');
        return number;
      };
      const page = parsePage(req.query.page, 1, 1_000_000);
      const pageSize = parsePage(req.query.pageSize, 20, 100);
      const where = [];
      const params = [];
      if (req.query.action) { where.push('l.action = ?'); params.push(req.query.action); }
      if (req.query.actor) { where.push('l.actor_name LIKE ?'); params.push(`%${req.query.actor}%`); }
      if (req.query.startDate) { where.push('l.created_at >= ?'); params.push(req.query.startDate); }
      if (req.query.endDate) { where.push('l.created_at <= ?'); params.push(req.query.endDate); }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT count(*) total FROM operation_logs l ${clause}`).get(...params).total;
      const items = db.prepare(`SELECT l.*, from_user.display_name from_owner_name, to_user.display_name to_owner_name
        FROM operation_logs l
        LEFT JOIN users from_user ON from_user.id = l.from_owner_id
        LEFT JOIN users to_user ON to_user.id = l.to_owner_id
        ${clause} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize)
        .map(row => ({ ...row, details: JSON.parse(row.details || '{}') }));
      res.json({ data: { items, pagination: { page, pageSize, total } } });
    } catch (error) { next(error); }
  });
  return router;
}
