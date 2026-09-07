import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, createAuthenticatedTestApp, insertCustomer } from './helpers.js';

const databases = [];
afterEach(() => { while (databases.length) databases.pop().close(); });

describe('跟进记录', () => {
  it('只允许新增跟进并同步最后跟进时间', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const customer = insertCustomer(context.db, { ownerId: context.salesA.id });
    const followedAt = new Date().toISOString();
    const created = await request(context.app).post(`/api/customers/${customer.id}/follow-ups`)
      .set(auth(context.salesAToken))
      .send({ followedAt, content: '电话沟通了采购计划', nextPlan: '周五发送正式方案' });
    const removed = await request(context.app).delete(`/api/customers/${customer.id}/follow-ups/1`).set(auth(context.salesAToken));
    expect(created.status).toBe(201);
    expect(context.db.prepare('SELECT last_followed_at FROM customers WHERE id = ?').get(customer.id).last_followed_at).toBe(followedAt);
    expect(removed.status).toBe(404);
  });

  it('销售不能给他人客户或已删除客户添加跟进', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const other = insertCustomer(context.db, { ownerId: context.salesB.id });
    const deleted = insertCustomer(context.db, { ownerId: context.salesA.id, deletedAt: new Date().toISOString() });
    const payload = { followedAt: new Date().toISOString(), content: '不应写入' };
    expect((await request(context.app).post(`/api/customers/${other.id}/follow-ups`).set(auth(context.salesAToken)).send(payload)).status).toBe(403);
    const deletedResult = await request(context.app).post(`/api/customers/${deleted.id}/follow-ups`).set(auth(context.salesAToken)).send(payload);
    expect(deletedResult.status).toBe(404);
    expect(deletedResult.body.error.message).toBe('已删除客户不能添加跟进');
  });
});

describe('分角色首页看板', () => {
  it('销售统计只包含自己的私海与跟进数据', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const mine = insertCustomer(context.db, { companyName: '我的客户', ownerId: context.salesA.id });
    insertCustomer(context.db, { companyName: '他人客户', ownerId: context.salesB.id });
    insertCustomer(context.db, { companyName: '公海客户', ownerId: null });
    const now = new Date().toISOString();
    context.db.prepare(`INSERT INTO follow_ups
      (customer_id, author_id, followed_at, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(mine.id, context.salesA.id, now, '我的跟进', now);
    const response = await request(context.app).get('/api/dashboard/stats').set(auth(context.salesAToken));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ view: 'sales', privateTotal: 1, publicTotal: 1, weeklyFollowUps: 1 });
  });

  it('管理员统计全部私海和全员跟进', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const a = insertCustomer(context.db, { ownerId: context.salesA.id });
    const b = insertCustomer(context.db, { ownerId: context.salesB.id });
    const now = new Date().toISOString();
    context.db.prepare(`INSERT INTO follow_ups
      (customer_id, author_id, followed_at, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(a.id, context.salesA.id, now, '甲跟进', now);
    context.db.prepare(`INSERT INTO follow_ups
      (customer_id, author_id, followed_at, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(b.id, context.salesB.id, now, '乙跟进', now);
    const response = await request(context.app).get('/api/dashboard/stats').set(auth(context.adminToken));
    expect(response.body.data).toMatchObject({ view: 'admin', privateTotal: 2, weeklyFollowUps: 2 });
  });
});
