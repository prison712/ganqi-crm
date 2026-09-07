import express from 'express';
import { AppError } from '../errors.js';
import { nowIso, withTransaction } from '../db.js';
import { writeOperationLog } from './logs.js';

const allowedStatuses = new Set(['potential', 'following', 'won', 'lost']);
const editableFields = {
  companyName: 'company_name',
  contactName: 'contact_name',
  phone: 'phone',
  email: 'email',
  source: 'source',
  status: 'status',
  notes: 'notes'
};
const fieldLimits = {
  contact_name: ['联系人', 80],
  phone: ['电话', 40],
  email: ['邮箱', 254],
  source: ['客户来源', 80],
  notes: ['备注', 2000]
};

function paginationValue(value, fallback, max) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AppError(400, 'VALIDATION_ERROR', '分页参数不正确');
  }
  return parsed;
}

function positiveInteger(value, message = '客户编号不正确') {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AppError(400, 'VALIDATION_ERROR', message);
  return parsed;
}

export function mapCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    source: row.source,
    status: row.status,
    notes: row.notes,
    ownerId: row.owner_id,
    ownerName: row.owner_name || null,
    lastFollowedAt: row.last_followed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function getCustomer(db, id) {
  return db.prepare(`SELECT c.*, u.display_name owner_name
    FROM customers c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?`).get(id);
}

export function assertCustomerVisible(customer, user, { allowDeleted = false } = {}) {
  if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', '客户不存在');
  if (customer.deleted_at && (!allowDeleted || user.role !== 'admin')) {
    throw new AppError(404, 'CUSTOMER_NOT_FOUND', '客户不存在或已移入回收站');
  }
  if (user.role === 'sales' && customer.owner_id !== null && customer.owner_id !== user.id) {
    throw new AppError(403, 'CUSTOMER_FORBIDDEN', '没有权限查看其他销售的客户');
  }
}

function assertEditable(customer, user) {
  assertCustomerVisible(customer, user);
  if (user.role === 'sales' && customer.owner_id !== user.id) {
    throw new AppError(403, 'CUSTOMER_FORBIDDEN', '只能操作属于自己的客户');
  }
}

export function customerFilter({ db, user, query, forExport = false }) {
  const scope = query.scope || (user.role === 'admin' ? 'all' : 'private');
  const where = [];
  const params = [];
  if (scope === 'recycle') {
    if (user.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '只有管理员可以查看客户回收站');
    where.push('c.deleted_at IS NOT NULL');
  } else {
    where.push('c.deleted_at IS NULL');
    if (scope === 'private') {
      if (user.role === 'sales') { where.push('c.owner_id = ?'); params.push(user.id); }
      else where.push('c.owner_id IS NOT NULL');
    } else if (scope === 'public') {
      where.push('c.owner_id IS NULL');
    } else if (scope === 'all') {
      if (user.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '没有权限查看全部客户');
    } else {
      throw new AppError(400, 'VALIDATION_ERROR', '客户范围参数不正确');
    }
  }
  const keyword = String(query.keyword || '').trim();
  if (keyword) {
    where.push('(c.company_name LIKE ? OR c.contact_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)');
    params.push(...Array(4).fill(`%${keyword}%`));
  }
  if (query.status) { where.push('c.status = ?'); params.push(query.status); }
  if (query.source) { where.push('c.source = ?'); params.push(query.source); }
  if (query.ownerId && user.role === 'admin') { where.push('c.owner_id = ?'); params.push(positiveInteger(query.ownerId, '归属销售参数不正确')); }
  return { where: where.join(' AND '), params, scope, forExport };
}

function validateCustomerInput(body, { partial = false } = {}) {
  const result = {};
  for (const [input, column] of Object.entries(editableFields)) {
    if (body[input] !== undefined) result[column] = String(body[input]).trim();
  }
  if (!partial || body.companyName !== undefined) {
    if (!result.company_name) throw new AppError(400, 'VALIDATION_ERROR', '请输入公司名称');
    if (result.company_name.length > 120) throw new AppError(400, 'VALIDATION_ERROR', '公司名称不能超过 120 字');
  }
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) {
    throw new AppError(400, 'VALIDATION_ERROR', '邮箱格式不正确');
  }
  for (const [field, [label, max]] of Object.entries(fieldLimits)) {
    if (result[field] && result[field].length > max) throw new AppError(400, 'VALIDATION_ERROR', `${label}不能超过 ${max} 字`);
  }
  if (result.status && !allowedStatuses.has(result.status)) throw new AppError(400, 'VALIDATION_ERROR', '客户状态不正确');
  return result;
}

export function customersRouter({ db, requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res, next) => {
    try {
      const page = paginationValue(req.query.page, 1, 1_000_000);
      const pageSize = paginationValue(req.query.pageSize, 20, 100);
      const filter = customerFilter({ db, user: req.user, query: req.query });
      const total = db.prepare(`SELECT count(*) total FROM customers c WHERE ${filter.where}`).get(...filter.params).total;
      const items = db.prepare(`SELECT c.*, u.display_name owner_name FROM customers c
        LEFT JOIN users u ON u.id = c.owner_id WHERE ${filter.where}
        ORDER BY c.updated_at DESC, c.id DESC LIMIT ? OFFSET ?`)
        .all(...filter.params, pageSize, (page - 1) * pageSize).map(mapCustomer);
      res.json({ data: { items, pagination: { page, pageSize, total } } });
    } catch (error) { next(error); }
  });

  router.post('/', (req, res, next) => {
    try {
      const input = validateCustomerInput(req.body || {});
      let ownerId = req.user.role === 'sales' ? req.user.id : (req.body.ownerId == null ? null : positiveInteger(req.body.ownerId, '归属销售参数不正确'));
      const now = nowIso();
      let result;
      withTransaction(db, () => {
        if (ownerId !== null) {
          const owner = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'sales' AND is_active = 1").get(ownerId);
          if (!owner) throw new AppError(400, 'INVALID_OWNER', '请选择有效的销售人员');
        }
        result = db.prepare(`INSERT INTO customers
          (company_name, contact_name, phone, email, source, status, notes, owner_id, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(input.company_name, input.contact_name || '', input.phone || '', input.email || '', input.source || '', input.status || 'potential', input.notes || '', ownerId, req.user.id, now, now);
      });
      const customer = getCustomer(db, result.lastInsertRowid);
      res.status(201).json({ data: { customer: mapCustomer(customer) }, message: '客户创建成功' });
    } catch (error) { next(error); }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const customer = getCustomer(db, positiveInteger(req.params.id));
      assertCustomerVisible(customer, req.user);
      res.json({ data: { customer: mapCustomer(customer) } });
    } catch (error) { next(error); }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id);
      const input = validateCustomerInput(req.body || {}, { partial: true });
      const fields = Object.keys(input);
      if (!fields.length) throw new AppError(400, 'VALIDATION_ERROR', '没有可更新的客户字段');
      withTransaction(db, () => {
        const customer = getCustomer(db, id);
        assertEditable(customer, req.user);
        const ownershipClause = req.user.role === 'sales' ? ' AND owner_id = ?' : '';
        const result = db.prepare(`UPDATE customers SET ${fields.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND deleted_at IS NULL${ownershipClause}`)
          .run(...fields.map(field => input[field]), nowIso(), id, ...(req.user.role === 'sales' ? [req.user.id] : []));
        if (result.changes !== 1) throw new AppError(409, 'CUSTOMER_CHANGED', '客户归属或状态已变化，请刷新后重试');
      });
      res.json({ data: { customer: mapCustomer(getCustomer(db, id)) }, message: '客户信息已更新' });
    } catch (error) { next(error); }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id);
      withTransaction(db, () => {
        const customer = getCustomer(db, id);
        assertEditable(customer, req.user);
        const timestamp = nowIso();
        const result = req.user.role === 'sales'
          ? db.prepare('UPDATE customers SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').run(timestamp, req.user.id, timestamp, id, req.user.id)
          : db.prepare('UPDATE customers SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(timestamp, req.user.id, timestamp, id);
        if (result.changes !== 1) throw new AppError(409, 'CUSTOMER_CHANGED', '客户归属或状态已变化，请刷新后重试');
        writeOperationLog(db, { actor: req.user, action: 'soft_delete', customerId: id, customerName: customer.company_name, fromOwnerId: customer.owner_id });
      });
      res.json({ message: '客户已移入回收站' });
    } catch (error) { next(error); }
  });

  router.post('/:id/restore', (req, res, next) => {
    try {
      if (req.user.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '只有管理员可以恢复客户');
      const id = positiveInteger(req.params.id);
      let ownerId;
      withTransaction(db, () => {
        const customer = getCustomer(db, id);
        if (!customer || !customer.deleted_at) throw new AppError(404, 'CUSTOMER_NOT_FOUND', '回收站中不存在该客户');
        ownerId = customer.owner_id;
        if (ownerId && !db.prepare("SELECT id FROM users WHERE id = ? AND role = 'sales' AND is_active = 1").get(ownerId)) ownerId = null;
        const result = db.prepare('UPDATE customers SET deleted_at = NULL, deleted_by = NULL, owner_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL').run(ownerId, nowIso(), id);
        if (result.changes !== 1) throw new AppError(409, 'CUSTOMER_CHANGED', '客户状态已变化，请刷新后重试');
        writeOperationLog(db, { actor: req.user, action: 'restore', customerId: id, customerName: customer.company_name, toOwnerId: ownerId });
      });
      res.json({ message: ownerId ? '客户已恢复到原私海' : '客户已恢复到公海' });
    } catch (error) { next(error); }
  });

  router.post('/:id/claim', (req, res, next) => {
    try {
      if (req.user.role !== 'sales') throw new AppError(403, 'FORBIDDEN', '管理员请使用客户分配功能');
      const id = positiveInteger(req.params.id);
      withTransaction(db, () => {
        const customer = getCustomer(db, id);
        if (!customer || customer.deleted_at) throw new AppError(404, 'CUSTOMER_NOT_FOUND', '客户不存在');
        const result = db.prepare('UPDATE customers SET owner_id = ?, updated_at = ? WHERE id = ? AND owner_id IS NULL AND deleted_at IS NULL')
          .run(req.user.id, nowIso(), id);
        if (result.changes !== 1) throw new AppError(409, 'ALREADY_CLAIMED', '该客户已被其他销售领取，请刷新列表');
        writeOperationLog(db, { actor: req.user, action: 'claim', customerId: id, customerName: customer.company_name, toOwnerId: req.user.id });
      });
      res.json({ message: '客户领取成功，已进入我的私海' });
    } catch (error) { next(error); }
  });

  router.post('/:id/release', (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id);
      const reason = String(req.body?.reason || '').trim();
      if (reason.length < 2 || reason.length > 200) throw new AppError(400, 'VALIDATION_ERROR', '请输入 2-200 字的释放原因');
      withTransaction(db, () => {
        const customer = getCustomer(db, id);
        if (!customer || customer.deleted_at) throw new AppError(404, 'CUSTOMER_NOT_FOUND', '客户不存在');
        if (customer.owner_id === null) throw new AppError(409, 'ALREADY_PUBLIC', '该客户已经在公海');
        if (req.user.role === 'sales' && customer.owner_id !== req.user.id) throw new AppError(403, 'CUSTOMER_FORBIDDEN', '只能释放属于自己的客户');
        const result = req.user.role === 'sales'
          ? db.prepare('UPDATE customers SET owner_id = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').run(nowIso(), id, req.user.id)
          : db.prepare('UPDATE customers SET owner_id = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').run(nowIso(), id, customer.owner_id);
        if (result.changes !== 1) throw new AppError(409, 'CUSTOMER_CHANGED', '客户归属已变化，请刷新后重试');
        writeOperationLog(db, { actor: req.user, action: 'release', customerId: id, customerName: customer.company_name, fromOwnerId: customer.owner_id, details: { reason } });
      });
      res.json({ message: '客户已释放到公海' });
    } catch (error) { next(error); }
  });

  router.post('/:id/assign', (req, res, next) => {
    try {
      if (req.user.role !== 'admin') throw new AppError(403, 'FORBIDDEN', '只有管理员可以分配客户');
      const id = positiveInteger(req.params.id);
      const ownerId = req.body?.ownerId == null ? null : positiveInteger(req.body.ownerId, '归属销售参数不正确');
      const reason = String(req.body?.reason || '').trim();
      if (ownerId === null && (reason.length < 2 || reason.length > 200)) throw new AppError(400, 'VALIDATION_ERROR', '请输入 2-200 字的释放原因');
      withTransaction(db, () => {
        const customer = getCustomer(db, id);
        if (!customer || customer.deleted_at) throw new AppError(404, 'CUSTOMER_NOT_FOUND', '客户不存在');
        if (ownerId !== null) {
          const owner = db.prepare("SELECT id, is_active FROM users WHERE id = ? AND role = 'sales'").get(ownerId);
          if (!owner) throw new AppError(400, 'INVALID_OWNER', '销售账号不存在');
          if (!owner.is_active) throw new AppError(400, 'INACTIVE_OWNER', '不能分配给已停用的销售');
        }
        const result = db.prepare('UPDATE customers SET owner_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(ownerId, nowIso(), id);
        if (result.changes !== 1) throw new AppError(409, 'CUSTOMER_CHANGED', '客户状态已变化，请刷新后重试');
        writeOperationLog(db, { actor: req.user, action: ownerId === null ? 'release' : 'assign', customerId: id, customerName: customer.company_name, fromOwnerId: customer.owner_id, toOwnerId: ownerId, details: ownerId === null ? { reason } : {} });
      });
      res.json({ message: ownerId === null ? '客户已释放到公海' : '客户分配成功' });
    } catch (error) { next(error); }
  });
  return router;
}
