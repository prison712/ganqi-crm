import { afterEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { auth, createAuthenticatedTestApp, createTestApp, insertCustomer, JWT_SECRET } from './helpers.js';

const databases = [];

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('销售账号管理', () => {
  it('管理员可同时修改销售登录账号和显示姓名，重复账号被拒绝', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);

    const changed = await request(context.app)
      .patch(`/api/users/${context.salesA.id}`)
      .set(auth(context.adminToken))
      .send({ username: 'sales_renamed', displayName: '销售甲改名' });
    const duplicated = await request(context.app)
      .patch(`/api/users/${context.salesA.id}`)
      .set(auth(context.adminToken))
      .send({ username: context.salesB.username, displayName: '不会保存' });

    expect(changed.status).toBe(200);
    expect(changed.body.data.user).toMatchObject({ username: 'sales_renamed', displayName: '销售甲改名' });
    expect(duplicated.status).toBe(409);
    expect(duplicated.body.error.message).toBe('该账号已存在');
  });

  it('软删除销售账号会释放客户、禁止登录并完整保留历史', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const customer = insertCustomer(context.db, { ownerId: context.salesA.id, companyName: '待释放客户' });
    context.db.prepare(`INSERT INTO follow_ups
      (customer_id, author_id, followed_at, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(customer.id, context.salesA.id, '2026-09-07T08:00:00.000Z', '不能删除的历史', '2026-09-07T08:00:00.000Z');

    const deleted = await request(context.app)
      .delete(`/api/users/${context.salesA.id}`)
      .set(auth(context.adminToken));
    const login = await request(context.app).post('/api/auth/login')
      .send({ username: context.salesA.username, password: 'sales123' });

    expect(deleted.status).toBe(200);
    expect(context.db.prepare('SELECT is_active, deleted_at, deleted_by FROM users WHERE id = ?').get(context.salesA.id))
      .toMatchObject({ is_active: 0, deleted_at: expect.any(String), deleted_by: 1 });
    expect(context.db.prepare('SELECT owner_id FROM customers WHERE id = ?').get(customer.id).owner_id).toBeNull();
    expect(context.db.prepare('SELECT count(*) total FROM follow_ups WHERE author_id = ?').get(context.salesA.id).total).toBe(1);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'account_deleted'").get().total).toBe(1);
    expect(context.db.prepare("SELECT details FROM operation_logs WHERE action = 'release' AND customer_id = ?").get(customer.id).details)
      .toContain('销售账号删除自动释放');
    expect(login.status).toBe(401);
  });

  it('删除接口只允许销售账号且已删除账号不能再编辑或启用', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const deleteAdmin = await request(context.app).delete('/api/users/1').set(auth(context.adminToken));
    await request(context.app).delete(`/api/users/${context.salesA.id}`).set(auth(context.adminToken));
    const editDeleted = await request(context.app).patch(`/api/users/${context.salesA.id}`)
      .set(auth(context.adminToken)).send({ username: 'after_delete', displayName: '已删除' });
    const enableDeleted = await request(context.app).post(`/api/users/${context.salesA.id}/toggle-active`)
      .set(auth(context.adminToken)).send({ isActive: true });

    expect(deleteAdmin.status).toBe(403);
    expect(editDeleted.status).toBe(404);
    expect(enableDeleted.status).toBe(404);
  });

  it('停用销售后自动释放其全部客户并保留历史', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const active = insertCustomer(context.db, { ownerId: context.salesA.id, companyName: '在跟客户' });
    const deleted = insertCustomer(context.db, {
      ownerId: context.salesA.id,
      companyName: '回收站客户',
      deletedAt: '2026-08-28T00:00:00.000Z'
    });
    context.db.prepare(`INSERT INTO follow_ups
      (customer_id, author_id, followed_at, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(active.id, context.salesA.id, '2026-08-28T08:00:00.000Z', '历史沟通', '2026-08-28T08:00:00.000Z');

    const response = await request(context.app)
      .post(`/api/users/${context.salesA.id}/toggle-active`)
      .set(auth(context.adminToken))
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(context.db.prepare('SELECT owner_id FROM customers WHERE id IN (?, ?) ORDER BY id').all(active.id, deleted.id))
      .toEqual([{ owner_id: null }, { owner_id: null }]);
    expect(context.db.prepare('SELECT count(*) total FROM follow_ups').get().total).toBe(1);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'release'").get().total).toBe(2);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'account_disabled'").get().total).toBe(1);
  });

  it('销售无权访问账号管理接口', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const response = await request(context.app).get('/api/users').set(auth(context.salesAToken));
    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('没有权限执行此操作');
  });
});

describe('认证', () => {
  it('创建初始管理员并可使用 admin123 登录', async () => {
    const context = createTestApp();
    databases.push(context.db);
    const response = await request(context.app).post('/api/auth/login').send({
      username: 'admin',
      password: 'admin123'
    });
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ username: 'admin', role: 'admin', isSuperAdmin: true });
    expect(response.body.data.user.mustChangePassword).toBe(true);
    expect(response.body.data.token).toEqual(expect.any(String));
  });

  it('销售也可校验旧密码后自助修改密码，且新密码立即生效', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const changed = await request(context.app).post('/api/auth/change-password')
      .set(auth(context.salesAToken))
      .send({ currentPassword: 'sales123', newPassword: 'sales-new-123' });
    const oldLogin = await request(context.app).post('/api/auth/login')
      .send({ username: context.salesA.username, password: 'sales123' });
    const newLogin = await request(context.app).post('/api/auth/login')
      .send({ username: context.salesA.username, password: 'sales-new-123' });

    expect(changed.status).toBe(200);
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it.each(['12345678', 'abcdefgh', 'short1'])('拒绝不符合基础格式的新密码 %s', async newPassword => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const response = await request(context.app).post('/api/auth/change-password')
      .set(auth(context.salesAToken))
      .send({ currentPassword: 'sales123', newPassword });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('密码需为 8-128 位，且同时包含字母和数字');
  });

  it('超级管理员可创建子管理员，子管理员不能继续创建管理员', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const created = await request(context.app).post('/api/users').set(auth(context.adminToken)).send({
      username: 'admin_child', displayName: '子管理员', password: 'child12345', role: 'admin'
    });
    const childId = created.body.data?.user?.id;
    const childToken = jwt.sign({ id: childId, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const ordinaryAccess = await request(context.app).get('/api/users').set(auth(childToken));
    const cannotListAdmins = await request(context.app).get('/api/users?includeAdmins=1').set(auth(childToken));
    const cannotDeleteSuper = await request(context.app).delete('/api/users/1').set(auth(childToken));
    const forbidden = await request(context.app).post('/api/users').set(auth(childToken)).send({
      username: 'admin_grandchild', displayName: '另一个管理员', password: 'child12345', role: 'admin'
    });

    expect(created.status).toBe(201);
    expect(created.body.data.user).toMatchObject({ role: 'admin', isSuperAdmin: false });
    expect(ordinaryAccess.status).toBe(200);
    expect(cannotListAdmins.status).toBe(403);
    expect(cannotDeleteSuper.status).toBe(403);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.message).toBe('只有超级管理员可以创建管理员子账号');
  });

  it('初始管理员必须先校验原密码并修改默认密码', async () => {
    const context = createTestApp();
    databases.push(context.db);
    const login = await request(context.app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    const blocked = await request(context.app).get('/api/dashboard/stats').set(auth(login.body.data.token));
    const wrong = await request(context.app).post('/api/auth/change-password')
      .set(auth(login.body.data.token)).send({ currentPassword: 'wrong-password', newPassword: 'new-admin-123' });
    const changed = await request(context.app).post('/api/auth/change-password')
      .set(auth(login.body.data.token)).send({ currentPassword: 'admin123', newPassword: 'new-admin-123' });
    const relogin = await request(context.app).post('/api/auth/login').send({ username: 'admin', password: 'new-admin-123' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toBe('请先修改初始密码');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toBe('当前密码不正确');
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.mustChangePassword).toBe(false);
    expect(relogin.status).toBe(200);
  });

  it('缺少令牌和过期令牌返回中文错误', async () => {
    const context = createTestApp();
    databases.push(context.db);
    const missing = await request(context.app).get('/api/auth/me');
    const expired = await request(context.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${context.expiredToken}`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.message).toBe('请先登录');
    expect(expired.status).toBe(401);
    expect(expired.body.error.message).toBe('登录已过期，请重新登录');
  });

  it('过大的 JSON 和日志非法分页返回中文错误', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const oversized = await request(context.app).post('/api/auth/login').send({ username: 'admin', password: 'x'.repeat(1024 * 1024 + 1) });
    const invalidPage = await request(context.app).get('/api/operation-logs?page=Infinity').set(auth(context.adminToken));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.message).toBe('请求数据不能超过 1MB');
    expect(invalidPage.status).toBe(400);
    expect(invalidPage.body.error.message).toBe('分页参数不正确');
  });
});
