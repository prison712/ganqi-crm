import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { auth, createAuthenticatedTestApp, insertCustomer } from './helpers.js';

const databases = [];
afterEach(() => { while (databases.length) databases.pop().close(); });

function scenario() {
  const context = createAuthenticatedTestApp();
  databases.push(context.db);
  const salesACustomer = insertCustomer(context.db, { companyName: '甲方科技', ownerId: context.salesA.id });
  const salesBCustomer = insertCustomer(context.db, { companyName: '乙方贸易', ownerId: context.salesB.id });
  const publicCustomer = insertCustomer(context.db, { companyName: '公海实业', ownerId: null });
  return { ...context, salesACustomer, salesBCustomer, publicCustomer };
}

describe('客户权限与软删除', () => {
  it('销售无法查看或修改他人的私海客户', async () => {
    const context = scenario();
    const read = await request(context.app).get(`/api/customers/${context.salesBCustomer.id}`).set(auth(context.salesAToken));
    const edit = await request(context.app).patch(`/api/customers/${context.salesBCustomer.id}`)
      .set(auth(context.salesAToken)).send({ notes: '越权修改' });
    expect(read.status).toBe(403);
    expect(read.body.error.message).toBe('没有权限查看其他销售的客户');
    expect(edit.status).toBe(403);
  });

  it('销售列表只返回本人私海或公海，管理员可查看全部', async () => {
    const context = scenario();
    const mine = await request(context.app).get('/api/customers?scope=private').set(auth(context.salesAToken));
    const publicPool = await request(context.app).get('/api/customers?scope=public').set(auth(context.salesAToken));
    const all = await request(context.app).get('/api/customers?scope=all').set(auth(context.adminToken));
    expect(mine.body.data.items.map(item => item.companyName)).toEqual(['甲方科技']);
    expect(publicPool.body.data.items.map(item => item.companyName)).toEqual(['公海实业']);
    expect(all.body.data.pagination.total).toBe(3);
  });

  it('软删除后仅管理员回收站可见并可恢复', async () => {
    const context = scenario();
    const removed = await request(context.app).delete(`/api/customers/${context.salesACustomer.id}`).set(auth(context.salesAToken));
    const forbidden = await request(context.app).get('/api/customers?scope=recycle').set(auth(context.salesAToken));
    const recycle = await request(context.app).get('/api/customers?scope=recycle').set(auth(context.adminToken));
    const restored = await request(context.app).post(`/api/customers/${context.salesACustomer.id}/restore`).set(auth(context.adminToken));
    expect(removed.status).toBe(200);
    expect(forbidden.status).toBe(403);
    expect(recycle.body.data.items[0].companyName).toBe('甲方科技');
    expect(restored.status).toBe(200);
    expect(context.db.prepare('SELECT deleted_at FROM customers WHERE id = ?').get(context.salesACustomer.id).deleted_at).toBeNull();
  });

  it('销售新增客户自动进入本人私海并支持筛选分页', async () => {
    const context = scenario();
    const created = await request(context.app).post('/api/customers').set(auth(context.salesAToken)).send({
      companyName: '星辰科技', contactName: '王经理', phone: '13800000000', status: 'following', source: '展会'
    });
    const filtered = await request(context.app)
      .get('/api/customers?scope=private&keyword=星辰&status=following&source=展会&page=1&pageSize=10')
      .set(auth(context.salesAToken));
    expect(created.status).toBe(201);
    expect(created.body.data.customer.ownerId).toBe(context.salesA.id);
    expect(filtered.body.data.pagination.total).toBe(1);
  });

  it('分页参数和客户字段超限时返回中文参数错误', async () => {
    const context = scenario();
    const invalidPage = await request(context.app).get('/api/customers?page=Infinity').set(auth(context.salesAToken));
    const invalidId = await request(context.app).get('/api/customers/not-a-number').set(auth(context.salesAToken));
    const tooLong = await request(context.app).post('/api/customers').set(auth(context.salesAToken)).send({
      companyName: '长度测试', contactName: '联'.repeat(81)
    });
    expect(invalidPage.status).toBe(400);
    expect(invalidPage.body.error.message).toBe('分页参数不正确');
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.error.message).toBe('客户编号不正确');
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.message).toBe('联系人不能超过 80 字');
  });
});

describe('客户归属流转', () => {
  it('公海客户只能被一名销售领取', async () => {
    const context = scenario();
    const first = await request(context.app).post(`/api/customers/${context.publicCustomer.id}/claim`).set(auth(context.salesAToken));
    const second = await request(context.app).post(`/api/customers/${context.publicCustomer.id}/claim`).set(auth(context.salesBToken));
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe('该客户已被其他销售领取，请刷新列表');
  });

  it('只有客户所有者可填写原因后释放', async () => {
    const context = scenario();
    const other = await request(context.app).post(`/api/customers/${context.salesACustomer.id}/release`)
      .set(auth(context.salesBToken)).send({ reason: '尝试释放' });
    const invalid = await request(context.app).post(`/api/customers/${context.salesACustomer.id}/release`)
      .set(auth(context.salesAToken)).send({ reason: '' });
    const success = await request(context.app).post(`/api/customers/${context.salesACustomer.id}/release`)
      .set(auth(context.salesAToken)).send({ reason: '连续三次未联系上' });
    expect(other.status).toBe(403);
    expect(other.body.error.message).toBe('只能释放属于自己的客户');
    expect(invalid.status).toBe(400);
    expect(success.status).toBe(200);
    const log = context.db.prepare("SELECT details FROM operation_logs WHERE action = 'release' ORDER BY id DESC LIMIT 1").get();
    expect(JSON.parse(log.details).reason).toBe('连续三次未联系上');
    const audit = await request(context.app).get('/api/operation-logs?action=release&startDate=2020-01-01T00:00:00.000Z&endDate=2030-01-01T00:00:00.000Z')
      .set(auth(context.adminToken));
    expect(audit.body.data.items[0]).toMatchObject({ from_owner_name: '销售甲', to_owner_name: null });
  });

  it('管理员可分配客户但不能分配给停用销售', async () => {
    const context = scenario();
    context.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(context.salesB.id);
    const invalid = await request(context.app).post(`/api/customers/${context.publicCustomer.id}/assign`)
      .set(auth(context.adminToken)).send({ ownerId: context.salesB.id });
    const success = await request(context.app).post(`/api/customers/${context.publicCustomer.id}/assign`)
      .set(auth(context.adminToken)).send({ ownerId: context.salesA.id });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toBe('不能分配给已停用的销售');
    expect(success.status).toBe(200);
  });

  it('管理员通过分配接口释放客户也必须填写原因', async () => {
    const context = scenario();
    const invalid = await request(context.app).post(`/api/customers/${context.salesACustomer.id}/assign`)
      .set(auth(context.adminToken)).send({ ownerId: null, reason: '' });
    const success = await request(context.app).post(`/api/customers/${context.salesACustomer.id}/assign`)
      .set(auth(context.adminToken)).send({ ownerId: null, reason: '管理员调整客户归属' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toBe('请输入 2-200 字的释放原因');
    expect(success.status).toBe(200);
    const log = context.db.prepare("SELECT details FROM operation_logs WHERE action = 'release' ORDER BY id DESC LIMIT 1").get();
    expect(JSON.parse(log.details).reason).toBe('管理员调整客户归属');
  });
});
