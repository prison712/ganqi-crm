import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { AppError } from '../errors.js';
import { nowIso, withTransaction } from '../db.js';
import { customerFilter } from './customers.js';
import { writeOperationLog } from './logs.js';

const headers = ['公司名称', '联系人', '电话', '邮箱', '来源', '备注'];

function normalizeCompany(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function normalizePhone(value) {
  return String(value || '').replace(/[\s\-()+]/g, '');
}

function duplicateKey(company, phone) {
  return `${normalizeCompany(company)}::${normalizePhone(phone)}`;
}

function parseOwnerId(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AppError(400, 'VALIDATION_ERROR', '归属销售参数不正确');
  return parsed;
}

function workbookBuffer(workbook) {
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function sendWorkbook(res, workbook, filename) {
  const buffer = workbookBuffer(workbook);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) return callback(new AppError(400, 'INVALID_FILE', '仅支持 .xlsx 格式的 Excel 文件'));
    callback(null, true);
  }
});

export function excelRouter({ db, requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/import-template', (_req, res) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      headers,
      ['示例科技有限公司', '张经理', '13800000000', 'demo@example.com', '展会', '重点客户']
    ]), '导入模板');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['字段', '说明'],
      ['公司名称', '必填，和电话共同用于重复判断'],
      ['联系人', '选填'],
      ['电话', '选填，会忽略空格、括号、加号和连接符进行判重'],
      ['邮箱', '选填，填写时必须是有效邮箱'],
      ['来源', '选填'],
      ['备注', '选填']
    ]), '字段说明');
    sendWorkbook(res, workbook, '客户导入模板.xlsx');
  });

  router.post('/import', upload.single('file'), (req, res, next) => {
    try {
      if (!req.file) throw new AppError(400, 'FILE_REQUIRED', '请选择要导入的 Excel 文件');
      if (req.file.buffer.length < 4 || req.file.buffer[0] !== 0x50 || req.file.buffer[1] !== 0x4b) {
        throw new AppError(400, 'INVALID_WORKBOOK', 'Excel 文件无法解析，请使用系统模板');
      }
      let ownerId = req.user.role === 'sales' ? req.user.id : (req.body.ownerId ? parseOwnerId(req.body.ownerId) : null);
      let workbook;
      try { workbook = XLSX.read(req.file.buffer, { type: 'buffer' }); }
      catch { throw new AppError(400, 'INVALID_WORKBOOK', 'Excel 文件无法解析，请使用系统模板'); }
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new AppError(400, 'EMPTY_WORKBOOK', 'Excel 文件中没有工作表');
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
      if (rows.length > 5000) throw new AppError(400, 'TOO_MANY_ROWS', '单次最多导入 5000 条客户');
      const results = [];
      const validRows = [];
      withTransaction(db, () => {
        if (ownerId !== null) {
          const owner = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'sales' AND is_active = 1").get(ownerId);
          if (!owner) throw new AppError(400, 'INVALID_OWNER', '请选择有效的销售人员');
        }
        const seen = new Set(db.prepare('SELECT company_name, phone FROM customers WHERE deleted_at IS NULL').all()
          .map(row => duplicateKey(row.company_name, row.phone)));
        rows.forEach((row, index) => {
          const rowNumber = index + 2;
          const values = {
            companyName: String(row['公司名称'] || '').trim(), contactName: String(row['联系人'] || '').trim(),
            phone: String(row['电话'] || '').trim(), email: String(row['邮箱'] || '').trim(),
            source: String(row['来源'] || '').trim(), notes: String(row['备注'] || '').trim()
          };
          const limits = [['companyName', '公司名称', 120], ['contactName', '联系人', 80], ['phone', '电话', 40], ['email', '邮箱', 254], ['source', '来源', 80], ['notes', '备注', 2000]];
          if (!values.companyName) {
            results.push({ row: rowNumber, companyName: values.companyName, type: 'error', message: '公司名称不能为空' }); return;
          }
          const exceeded = limits.find(([field, _label, max]) => values[field].length > max);
          if (exceeded) {
            results.push({ row: rowNumber, companyName: values.companyName, type: 'error', message: `${exceeded[1]}不能超过 ${exceeded[2]} 字` }); return;
          }
          if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
            results.push({ row: rowNumber, companyName: values.companyName, type: 'error', message: '邮箱格式不正确' }); return;
          }
          const key = duplicateKey(values.companyName, values.phone);
          if (seen.has(key)) {
            results.push({ row: rowNumber, companyName: values.companyName, type: 'duplicate', message: '客户已存在，已跳过' }); return;
          }
          seen.add(key);
          validRows.push({ rowNumber, ...values });
        });
        const statement = db.prepare(`INSERT INTO customers
          (company_name, contact_name, phone, email, source, status, notes, owner_id, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'potential', ?, ?, ?, ?, ?)`);
        for (const row of validRows) {
          const timestamp = nowIso();
          statement.run(row.companyName, row.contactName, row.phone, row.email, row.source, row.notes, ownerId, req.user.id, timestamp, timestamp);
          results.push({ row: row.rowNumber, companyName: row.companyName, type: 'success', message: '导入成功' });
        }
        writeOperationLog(db, { actor: req.user, action: 'import', details: { filename: req.file.originalname, total: rows.length, success: validRows.length, duplicate: results.filter(item => item.type === 'duplicate').length, failed: results.filter(item => item.type === 'error').length, ownerId } });
      });
      results.sort((a, b) => a.row - b.row);
      res.json({ data: { total: rows.length, success: validRows.length, duplicate: results.filter(item => item.type === 'duplicate').length, failed: results.filter(item => item.type === 'error').length, rows: results }, message: `导入完成：成功 ${validRows.length} 条` });
    } catch (error) { next(error); }
  });

  router.get('/export', (req, res, next) => {
    try {
      const filter = customerFilter({ db, user: req.user, query: req.query, forExport: true });
      const rows = db.prepare(`SELECT c.*, u.display_name owner_name FROM customers c
        LEFT JOIN users u ON u.id = c.owner_id WHERE ${filter.where} ORDER BY c.updated_at DESC`).all(...filter.params);
      const statusNames = { potential: '潜在', following: '跟进中', won: '已成交', lost: '流失' };
      const data = rows.map(row => ({
        '公司名称': row.company_name,
        '联系人': row.contact_name,
        '电话': row.phone,
        '邮箱': row.email,
        '来源': row.source,
        '客户状态': statusNames[row.status],
        '归属销售': row.owner_name || '公海',
        '最后跟进时间': row.last_followed_at || '',
        '备注': row.notes
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data, { header: ['公司名称', '联系人', '电话', '邮箱', '来源', '客户状态', '归属销售', '最后跟进时间', '备注'] }), '客户数据');
      sendWorkbook(res, workbook, `客户数据-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) { next(error); }
  });
  return router;
}
