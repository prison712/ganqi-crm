import express from 'express';
import { AppError } from '../errors.js';
import { nowIso, withTransaction } from '../db.js';

function customerId(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AppError(400, 'VALIDATION_ERROR', '客户编号不正确');
  return parsed;
}

function getCustomerForFollowUp(db, id, user) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', '客户不存在');
  if (customer.deleted_at) throw new AppError(404, 'CUSTOMER_DELETED', '已删除客户不能添加跟进');
  if (user.role === 'sales' && customer.owner_id !== user.id) {
    throw new AppError(403, 'CUSTOMER_FORBIDDEN', customer.owner_id ? '没有权限操作其他销售的客户' : '请先领取公海客户再添加跟进');
  }
  return customer;
}

export function followUpsRouter({ db, requireAuth }) {
  const router = express.Router({ mergeParams: true });
  router.use(requireAuth);
  router.get('/', (req, res, next) => {
    try {
      const id = customerId(req.params.id);
      getCustomerForFollowUp(db, id, req.user);
      const items = db.prepare(`SELECT f.*, u.display_name author_name FROM follow_ups f
        JOIN users u ON u.id = f.author_id WHERE f.customer_id = ? ORDER BY f.followed_at DESC, f.id DESC`)
        .all(id).map(row => ({
          id: row.id,
          followedAt: row.followed_at,
          content: row.content,
          nextPlan: row.next_plan,
          authorId: row.author_id,
          authorName: row.author_name,
          createdAt: row.created_at
        }));
      res.json({ data: { items } });
    } catch (error) { next(error); }
  });
  router.post('/', (req, res, next) => {
    try {
      const id = customerId(req.params.id);
      const content = String(req.body?.content || '').trim();
      const nextPlan = String(req.body?.nextPlan || '').trim();
      const followedAt = String(req.body?.followedAt || nowIso());
      if (!content) throw new AppError(400, 'VALIDATION_ERROR', '请输入跟进内容');
      if (content.length > 2000) throw new AppError(400, 'VALIDATION_ERROR', '跟进内容不能超过 2000 字');
      if (nextPlan.length > 1000) throw new AppError(400, 'VALIDATION_ERROR', '下一步计划不能超过 1000 字');
      if (Number.isNaN(Date.parse(followedAt))) throw new AppError(400, 'VALIDATION_ERROR', '跟进时间格式不正确');
      let result;
      withTransaction(db, () => {
        getCustomerForFollowUp(db, id, req.user);
        result = db.prepare(`INSERT INTO follow_ups
          (customer_id, author_id, followed_at, content, next_plan, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(id, req.user.id, followedAt, content, nextPlan, nowIso());
        db.prepare('UPDATE customers SET last_followed_at = ?, updated_at = ? WHERE id = ?').run(followedAt, nowIso(), id);
      });
      res.status(201).json({ data: { followUp: { id: Number(result.lastInsertRowid), followedAt, content, nextPlan, authorId: req.user.id, authorName: req.user.display_name } }, message: '跟进记录已添加' });
    } catch (error) { next(error); }
  });
  return router;
}
