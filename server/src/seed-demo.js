import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { createDatabase, nowIso, withTransaction } from './db.js';
import { config } from './config.js';
import { writeOperationLog } from './modules/logs.js';

const DEMO_TAG = 'customer-erp-v1';
const demoUsers = [
  ['demo_sales01', '演示销售·张明'],
  ['demo_sales02', '演示销售·李娜'],
  ['demo_sales03', '演示销售·王强']
];
const companies = [
  '华东智造科技有限公司', '蓝海新能源集团', '云帆数字营销有限公司', '卓越医疗器械有限公司',
  '远景供应链管理有限公司', '新锐教育科技有限公司', '金桥建筑设计院', '启航汽车零部件有限公司',
  '星河文化传媒有限公司', '博远精密仪器有限公司', '绿洲环保工程有限公司', '万象商业管理有限公司'
];

export function seedDemo(db) {
  return withTransaction(db, () => {
    for (const [username] of demoUsers) {
      const existing = db.prepare('SELECT demo_tag FROM users WHERE username = ?').get(username);
      if (existing && existing.demo_tag !== DEMO_TAG) throw new Error(`演示账号 ${username} 已被现有账号占用，请先更换该账号名称`);
    }
    db.prepare('DELETE FROM operation_logs WHERE demo_tag = ?').run(DEMO_TAG);
    db.prepare('DELETE FROM follow_ups WHERE demo_tag = ?').run(DEMO_TAG);
    const passwordHash = bcrypt.hashSync('123456', 10);
    const timestamp = nowIso();
    const insertUser = db.prepare(`INSERT INTO users
      (username, display_name, password_hash, role, is_active, demo_tag, created_at, updated_at)
      VALUES (?, ?, ?, 'sales', 1, ?, ?, ?)`);
    const updateUser = db.prepare(`UPDATE users SET display_name = ?, password_hash = ?, role = 'sales',
      is_active = 1, updated_at = ? WHERE username = ? AND demo_tag = ?`);
    for (const [username, displayName] of demoUsers) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) updateUser.run(displayName, passwordHash, timestamp, username, DEMO_TAG);
      else insertUser.run(username, displayName, passwordHash, DEMO_TAG, timestamp, timestamp);
    }
    const sales = demoUsers.map(([username]) => db.prepare('SELECT id, display_name FROM users WHERE username = ?').get(username));
    const admin = db.prepare("SELECT id, display_name FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    const statuses = ['potential', 'following', 'won', 'lost'];
    const sources = ['展会', '官网咨询', '客户转介绍', '市场活动'];
    const insertCustomer = db.prepare(`INSERT INTO customers
      (company_name, contact_name, phone, email, source, status, notes, owner_id, created_by, demo_tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const updateCustomer = db.prepare(`UPDATE customers SET contact_name = ?, phone = ?, email = ?, source = ?,
      status = ?, notes = ?, owner_id = ?, created_by = ?, updated_at = ?, deleted_at = NULL, deleted_by = NULL
      WHERE id = ? AND demo_tag = ?`);
    const customerIds = [];
    companies.forEach((companyName, index) => {
      const owner = index % 4 === 0 ? null : sales[(index - 1) % sales.length];
      const createdAt = new Date(Date.now() - index * 3_600_000).toISOString();
      const values = [`联系人${index + 1}`, `1380000${String(index + 1).padStart(4, '0')}`,
        `demo${index + 1}@example.com`, sources[index % sources.length], statuses[index % statuses.length],
        '此客户由演示数据脚本生成，可安全重复生成。', owner?.id ?? null, owner?.id ?? admin.id];
      const existing = db.prepare('SELECT id FROM customers WHERE demo_tag = ? AND company_name = ? ORDER BY id LIMIT 1').get(DEMO_TAG, companyName);
      let customerId;
      if (existing) {
        updateCustomer.run(...values, createdAt, existing.id, DEMO_TAG);
        customerId = Number(existing.id);
      } else {
        const result = insertCustomer.run(companyName, ...values, DEMO_TAG, createdAt, createdAt);
        customerId = Number(result.lastInsertRowid);
      }
      customerIds.push(customerId);
      writeOperationLog(db, { actorId: admin.id, actorName: admin.display_name, action: owner ? 'assign' : 'import', customerId, customerName: companyName, toOwnerId: owner?.id ?? null, details: { source: '演示数据' }, demoTag: DEMO_TAG, createdAt });
    });
    const insertFollowUp = db.prepare(`INSERT INTO follow_ups
      (customer_id, author_id, followed_at, content, next_plan, demo_tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    customerIds.slice(1, 10).forEach((customerId, index) => {
      const author = sales[index % sales.length];
      const followedAt = new Date(Date.now() - index * 7_200_000).toISOString();
      insertFollowUp.run(customerId, author.id, followedAt, `第 ${index + 1} 次演示跟进：已了解客户当前采购计划。`, '下一步发送产品方案并预约会议。', DEMO_TAG, followedAt);
    });
    const refreshLastFollowed = db.prepare('UPDATE customers SET last_followed_at = (SELECT MAX(followed_at) FROM follow_ups WHERE customer_id = customers.id) WHERE id = ?');
    for (const customerId of customerIds) refreshLastFollowed.run(customerId);
    return { users: demoUsers.length, customers: companies.length, followUps: 9 };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = createDatabase({ filename: config.dbFile });
  try {
    const result = seedDemo(db);
    console.log(`演示数据生成完成：${result.users} 个销售账号、${result.customers} 个客户、${result.followUps} 条跟进。`);
    console.log('演示账号：demo_sales01 / 123456、demo_sales02 / 123456、demo_sales03 / 123456');
  } finally { db.close(); }
}
