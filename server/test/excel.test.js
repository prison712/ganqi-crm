import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { auth, createAuthenticatedTestApp } from './helpers.js';

const databases = [];
afterEach(() => { while (databases.length) databases.pop().close(); });

function workbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '客户');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Excel 客户流程', () => {
  it('提供带中文表头和说明页的模板', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const response = await request(context.app).get('/api/customers/import-template')
      .set(auth(context.salesAToken)).buffer(true).parse(binaryParser);
    expect(response.status).toBe(200);
    const workbook = XLSX.read(response.body, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['导入模板', '字段说明']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['导入模板'], { header: 1 })[0])
      .toEqual(['公司名称', '联系人', '电话', '邮箱', '来源', '备注']);
  });

  it('逐行返回成功、重复和错误结果', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const file = workbookBuffer([
      ['公司名称', '联系人', '电话', '邮箱', '来源', '备注'],
      ['演示科技', '张三', '138-0000-0001', 'a@example.com', '展会', '首条'],
      ['演示科技', '张三', '13800000001', 'a@example.com', '展会', '重复'],
      ['', '李四', '13900000002', 'bad-email', '转介绍', '错误']
    ]);
    const response = await request(context.app).post('/api/customers/import')
      .set(auth(context.salesAToken)).attach('file', file, 'customers.xlsx');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 3, success: 1, duplicate: 1, failed: 1 });
    expect(response.body.data.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, type: 'duplicate' }),
      expect.objectContaining({ row: 4, type: 'error' })
    ]));
    expect(context.db.prepare("SELECT owner_id FROM customers WHERE company_name = '演示科技'").get().owner_id).toBe(context.salesA.id);
  });

  it('损坏的 xlsx 文件返回中文参数错误而不是服务器错误', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const response = await request(context.app).post('/api/customers/import')
      .set(auth(context.salesAToken)).attach('file', Buffer.from('not-an-excel-file'), 'broken.xlsx');
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Excel 文件无法解析，请使用系统模板');
  });

  it('超过 5MB 的文件返回中文大小限制提示', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0x50);
    oversized[1] = 0x4b;
    const response = await request(context.app).post('/api/customers/import')
      .set(auth(context.salesAToken)).attach('file', oversized, 'oversized.xlsx');
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Excel 文件不能超过 5MB');
  });

  it('上传字段名错误时返回中文参数错误', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const response = await request(context.app).post('/api/customers/import')
      .set(auth(context.salesAToken)).attach('wrongField', workbookBuffer([['公司名称'], ['测试']]), 'customers.xlsx');
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('上传字段不正确，请选择一个 .xlsx 文件');
  });

  it('按当前筛选和后端权限导出客户', async () => {
    const context = createAuthenticatedTestApp();
    databases.push(context.db);
    const now = new Date().toISOString();
    context.db.prepare(`INSERT INTO customers
      (company_name, source, status, owner_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('目标科技', '展会', 'following', context.salesA.id, context.salesA.id, now, now);
    context.db.prepare(`INSERT INTO customers
      (company_name, source, status, owner_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('他人科技', '展会', 'following', context.salesB.id, context.salesB.id, now, now);
    const response = await request(context.app)
      .get('/api/customers/export?scope=private&keyword=目标&status=following&source=展会')
      .set(auth(context.salesAToken)).buffer(true).parse(binaryParser);
    expect(response.status).toBe(200);
    const workbook = XLSX.read(response.body, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['客户数据']);
    expect(rows).toHaveLength(1);
    expect(rows[0]['公司名称']).toBe('目标科技');
  });
});
