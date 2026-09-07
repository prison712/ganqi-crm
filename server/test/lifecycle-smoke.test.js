import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { auth, createTestApp } from './helpers.js';

let database;
afterEach(() => database?.close());

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('客户 ERP 完整生命周期', () => {
  it('通过真实 HTTP 接口完成管理员与销售主流程', async () => {
    const context = createTestApp();
    database = context.db;
    const adminLogin = await request(context.app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    const adminToken = adminLogin.body.data.token;
    await request(context.app).post('/api/auth/change-password').set(auth(adminToken))
      .send({ currentPassword: 'admin123', newPassword: 'admin-secure-123' }).expect(200);
    await request(context.app).post('/api/users').set(auth(adminToken))
      .send({ username: 'smoke_sales', displayName: '验收销售', password: 'sales-secure-123' }).expect(201);
    const salesLogin = await request(context.app).post('/api/auth/login')
      .send({ username: 'smoke_sales', password: 'sales-secure-123' }).expect(200);
    const salesToken = salesLogin.body.data.token;

    const created = await request(context.app).post('/api/customers').set(auth(adminToken))
      .send({ companyName: '全流程验收客户', contactName: '陈经理', phone: '13900001111', source: '自动化验收' }).expect(201);
    const customerId = created.body.data.customer.id;
    expect(created.body.data.customer.ownerId).toBeNull();

    await request(context.app).post(`/api/customers/${customerId}/claim`).set(auth(salesToken)).expect(200);
    await request(context.app).post(`/api/customers/${customerId}/follow-ups`).set(auth(salesToken))
      .send({ content: '已完成首次需求沟通', nextPlan: '发送正式方案', followedAt: new Date().toISOString() }).expect(201);
    await request(context.app).post(`/api/customers/${customerId}/release`).set(auth(salesToken))
      .send({ reason: '暂缓采购，回公海继续培育' }).expect(200);
    await request(context.app).post(`/api/customers/${customerId}/claim`).set(auth(salesToken)).expect(200);
    await request(context.app).delete(`/api/customers/${customerId}`).set(auth(salesToken)).expect(200);
    await request(context.app).post(`/api/customers/${customerId}/restore`).set(auth(adminToken)).expect(200);

    const exported = await request(context.app)
      .get('/api/customers/export?scope=all&keyword=全流程验收').set(auth(adminToken)).buffer(true).parse(binaryParser).expect(200);
    const workbook = XLSX.read(exported.body, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['客户数据']);
    expect(rows).toHaveLength(1);
    expect(rows[0]['公司名称']).toBe('全流程验收客户');
    expect(database.prepare('SELECT count(*) total FROM follow_ups WHERE customer_id = ?').get(customerId).total).toBe(1);
    const release = database.prepare("SELECT details FROM operation_logs WHERE customer_id = ? AND action = 'release'").get(customerId);
    expect(JSON.parse(release.details).reason).toBe('暂缓采购，回公海继续培育');
  });
});
