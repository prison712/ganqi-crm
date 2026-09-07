import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalDocumentStorage } from '../src/documents/localStorage.js';
import { auth, createAuthenticatedTestApp, createTestApp, insertDocument } from './helpers.js';

let testDir;
let storage;
let context;

function rawMultipartBody({ filename, filenameEncoding = 'latin1', filenameStar, content = '%PDF-1.7\n' }) {
  const boundary = 'erp-document-route-boundary';
  const dispositionSuffix = filenameStar ? `; filename*=UTF-8''${encodeURIComponent(filenameStar)}` : '';
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\ntraining\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="`),
      Buffer.from(filename, filenameEncoding),
      Buffer.from(`"${dispositionSuffix}\r\nContent-Type: application/pdf\r\n\r\n${content}\r\n--${boundary}--\r\n`)
    ])
  };
}

function postRawMultipart(app, token, fixture) {
  return request(app).post('/api/documents')
    .set(auth(token))
    .set('Content-Type', `multipart/form-data; boundary=${fixture.boundary}`)
    .send(fixture.body);
}

async function sendIncompleteHttpUpload(app, token, bodyPrefix, {
  timeoutMs = 2000,
  contentType = 'multipart/form-data; boundary=slow-document-boundary'
} = {}) {
  const serverSockets = new Set();
  const server = http.createServer(app);
  server.on('connection', socket => {
    serverSockets.add(socket);
    socket.once('close', () => serverSockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  let client;
  const startedAt = Date.now();
  try {
    const rawResponse = await new Promise((resolve, reject) => {
      let response = '';
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const succeed = finish(resolve);
      const fail = finish(reject);
      const timer = setTimeout(() => fail(new Error(`slow upload response timed out; partial=${response}`)), timeoutMs);
      client = net.createConnection({ host: '127.0.0.1', port: address.port });
      client.setEncoding('utf8');
      client.on('data', chunk => { response += chunk; });
      client.once('error', fail);
      client.once('close', () => succeed(response));
      client.once('connect', () => {
        const declaredLength = Buffer.byteLength(bodyPrefix) + 1_000_000;
        client.write([
          'POST /api/documents HTTP/1.1',
          'Host: 127.0.0.1',
          `Authorization: Bearer ${token}`,
          `Content-Type: ${contentType}`,
          `Content-Length: ${declaredLength}`,
          'Connection: keep-alive',
          '',
          bodyPrefix
        ].join('\r\n'));
      });
    });
    return { rawResponse, elapsedMs: Date.now() - startedAt };
  } finally {
    client?.destroy();
    for (const socket of serverSockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'erp-document-routes-'));
  storage = createLocalDocumentStorage({ rootDir: testDir });
  storage.init();
  context = createAuthenticatedTestApp({
    documentStorage: storage,
    documentLimits: { maxUploadFileBytes: 1024, maxUploadFiles: 3 }
  });
});

afterEach(() => {
  context?.db.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('公共资料数据库', () => {
  it('初始化资料字段与索引', () => {
    const { db } = createTestApp();
    const columns = db.prepare('PRAGMA table_info(public_documents)').all().map(row => row.name);
    expect(columns).toEqual(expect.arrayContaining([
      'id', 'original_name', 'storage_key', 'category', 'description', 'extension',
      'mime_type', 'size_bytes', 'sha256', 'uploaded_by', 'created_at', 'deleted_at', 'deleted_by'
    ]));
    const indexes = db.prepare('PRAGMA index_list(public_documents)').all().map(row => row.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_documents_active_created', 'idx_documents_category_created', 'idx_documents_uploader']));
  });

  it('插入资料辅助函数写入完整的默认合法数据', () => {
    const { db } = createTestApp();
    const document = insertDocument(db, { storageKey: 'test-document.pdf' });

    expect(db.prepare('SELECT original_name, uploaded_by FROM public_documents WHERE id = ?').get(document.id))
      .toEqual({ original_name: '销售手册.pdf', uploaded_by: 1 });
  });
});

describe('公共资料接口', () => {
  it('销售上传合法资料并写入日志', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'training')
      .field('description', '新人培训')
      .attach('files', Buffer.from('%PDF-1.7\n'), { filename: '培训手册.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ total: 1, success: 1, failed: 0 });
    expect(response.body.data.rows[0]).toMatchObject({ originalName: '培训手册.pdf', type: 'success' });
    expect(response.body.data.rows[0].document).toEqual(expect.objectContaining({
      originalName: '培训手册.pdf',
      category: 'training',
      description: '新人培训',
      uploadedBy: context.salesA.id,
      uploaderName: '销售甲',
      previewable: true
    }));
    const log = context.db.prepare('SELECT action, details FROM operation_logs WHERE action = ?').get('document_upload');
    expect(log).toBeTruthy();
    expect(JSON.parse(log.details).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('未登录不能上传或查看列表', async () => {
    expect((await request(context.app).get('/api/documents')).status).toBe(401);
    expect((await request(context.app).post('/api/documents')).status).toBe(401);
  });

  it('列表按关键词分类上传人分页筛选', async () => {
    insertDocument(context.db, {
      originalName: '销售手册.pdf',
      storageKey: 'sales-guide.pdf',
      category: 'sales_tool',
      description: '标准话术',
      uploadedBy: context.salesA.id
    });
    insertDocument(context.db, {
      originalName: '产品手册.pdf',
      storageKey: 'product-guide.pdf',
      category: 'product',
      uploadedBy: context.salesA.id
    });
    insertDocument(context.db, {
      originalName: '其他手册.pdf',
      storageKey: 'other-guide.pdf',
      category: 'sales_tool',
      uploadedBy: context.salesB.id
    });

    const response = await request(context.app).get('/api/documents')
      .set(auth(context.adminToken))
      .query({ keyword: '手册', category: 'sales_tool', uploaderId: context.salesA.id, page: 1, pageSize: 10 });

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items.every(item => item.category === 'sales_tool')).toBe(true);
    expect(response.body.data.items[0]).toEqual(expect.objectContaining({
      originalName: '销售手册.pdf',
      uploadedBy: context.salesA.id,
      uploaderName: '销售甲',
      sizeBytes: 12,
      previewable: true
    }));
    expect(response.body.data.pagination).toEqual(expect.objectContaining({ page: 1, pageSize: 10, total: 1 }));
    expect(response.body.data.facets.uploaders).toEqual(expect.arrayContaining([
      { id: context.salesA.id, displayName: '销售甲' },
      { id: context.salesB.id, displayName: '销售乙' }
    ]));
    expect((await request(context.app).get('/api/documents').set(auth(context.salesAToken))).status).toBe(200);
  });

  it('混合批次逐文件返回成功与失败', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'sales_tool')
      .attach('files', Buffer.from('%PDF-1.7\n'), { filename: '合法.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('MZ executable'), { filename: '伪装.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ total: 2, success: 1, failed: 1 });
    expect(response.body.data.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalName: '合法.pdf', type: 'success' }),
      expect.objectContaining({ originalName: '伪装.pdf', type: 'error', message: '文件内容与扩展名不一致' })
    ]));
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(1);
  });

  it('全部文件失败时返回 200 且不留下文件或记录', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'sales_tool')
      .attach('files', Buffer.from('MZ executable'), { filename: '伪装.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 1, success: 0, failed: 1 });
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_upload'").get().total).toBe(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('资料字段校验失败时清理已流式写入的临时文件', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'private')
      .attach('files', Buffer.from('%PDF-1.7\n'), { filename: '机密.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('请选择正确的资料分类');
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('数据库事务失败时回滚资料与日志并删除已提交文件', async () => {
    context.db.exec(`CREATE TRIGGER reject_document_log
      BEFORE INSERT ON operation_logs
      WHEN NEW.action = 'document_upload'
      BEGIN SELECT RAISE(ABORT, 'reject document log'); END`);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'training')
      .attach('files', Buffer.from('%PDF-1.7\n'), { filename: '事务.pdf', contentType: 'application/pdf' });

    errorLog.mockRestore();
    expect(response.status).toBe(200);
    expect(response.body.data.rows[0]).toMatchObject({
      originalName: '事务.pdf',
      type: 'error',
      message: '资料上传失败，请稍后重试'
    });
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_upload'").get().total).toBe(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('临时文件清理失败不阻断正式文件补偿和后续候选结算', async () => {
    context.db.close();
    const baseStorage = storage;
    const tempRemovalAttempts = [];
    const savedRemovalAttempts = [];
    let failFirstTempRemoval = true;
    const cleanupStorage = {
      ...baseStorage,
      removeTemp: async tempPath => {
        tempRemovalAttempts.push(tempPath);
        if (failFirstTempRemoval) {
          failFirstTempRemoval = false;
          throw new Error('injected cleanup failure with private path');
        }
        await baseStorage.removeTemp(tempPath);
      },
      remove: async storageKey => {
        savedRemovalAttempts.push(storageKey);
        await baseStorage.remove(storageKey);
      }
    };
    context = createAuthenticatedTestApp({
      documentStorage: cleanupStorage,
      documentLimits: { maxUploadFileBytes: 1024, maxUploadFiles: 3 }
    });
    context.db.exec(`CREATE TRIGGER reject_document_log_twice
      BEFORE INSERT ON operation_logs
      WHEN NEW.action = 'document_upload'
      BEGIN SELECT RAISE(ABORT, 'reject document log'); END`);
    const logged = [];
    const errorLog = vi.spyOn(console, 'error').mockImplementation((...args) => logged.push(args));

    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'training')
      .attach('files', Buffer.from('%PDF-1.7\nfirst'), { filename: '第一份.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('%PDF-1.7\nsecond'), { filename: '第二份.pdf', contentType: 'application/pdf' });

    errorLog.mockRestore();
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 2, success: 0, failed: 2 });
    expect(response.body.data.rows.map(row => row.originalName)).toEqual(expect.arrayContaining(['第一份.pdf', '第二份.pdf']));
    expect(savedRemovalAttempts).toHaveLength(2);
    expect(tempRemovalAttempts.length).toBeGreaterThanOrEqual(3);
    expect(logged.flat().join(' ')).not.toContain('private path');
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('没有文件时返回明确提示', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'training');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'FILE_REQUIRED', message: '请选择要上传的资料' });
  });

  it('畸形 multipart 请求使用资料上传专用错误文案', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .set('Content-Type', 'multipart/form-data')
      .send('broken');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'INVALID_DOCUMENT_UPLOAD',
      message: '资料上传请求格式不正确'
    });
  });

  it('已写入文件流后出现多余字段时拒绝整个请求并清理', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .attach('files', Buffer.from('%PDF-1.7\n'), { filename: '多余字段.pdf', contentType: 'application/pdf' })
      .field('category', 'training')
      .field('description', '正常说明')
      .field('unexpected', '不应接受');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'INVALID_DOCUMENT_UPLOAD',
      message: '资料上传请求格式不正确'
    });
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('允许恰好 maxFiles 文件加分类与说明', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'training')
      .field('description', '上限批次')
      .attach('files', Buffer.from('%PDF-1.7\none'), { filename: 'one.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('%PDF-1.7\ntwo'), { filename: 'two.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('%PDF-1.7\nthree'), { filename: 'three.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ total: 3, success: 3, failed: 0 });
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(3);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(3);
  });

  it('超过 maxFiles 时返回专用数量错误并清理整个请求', async () => {
    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'training')
      .field('description', '超限批次')
      .attach('files', Buffer.from('%PDF-1.7\none'), { filename: 'one.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('%PDF-1.7\ntwo'), { filename: 'two.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('%PDF-1.7\nthree'), { filename: 'three.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('%PDF-1.7\nfour'), { filename: 'four.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'TOO_MANY_FILES',
      message: '单次最多上传 3 个文件'
    });
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('普通 filename 按 UTF-8 解码中文日文韩文并保留 filename* Unicode', async () => {
    const fixtures = [
      { fixture: rawMultipartBody({ filename: '中文资料.pdf', filenameEncoding: 'utf8' }), expected: '中文资料.pdf' },
      { fixture: rawMultipartBody({ filename: 'かなカナ.pdf', filenameEncoding: 'utf8' }), expected: 'かなカナ.pdf' },
      { fixture: rawMultipartBody({ filename: '한글.pdf', filenameEncoding: 'utf8' }), expected: '한글.pdf' },
      { fixture: rawMultipartBody({ filename: 'fallback.pdf', filenameStar: '原生资料.pdf' }), expected: '原生资料.pdf' }
    ];

    for (const { fixture, expected } of fixtures) {
      const response = await postRawMultipart(context.app, context.salesAToken, fixture);
      expect(response.status).toBe(201);
      expect(response.body.data.rows[0]).toMatchObject({ originalName: expected, type: 'success' });
      expect(response.body.data.rows[0].document.originalName).toBe(expected);
    }
    expect(context.db.prepare('SELECT original_name FROM public_documents ORDER BY id').all().map(row => row.original_name))
      .toEqual(fixtures.map(item => item.expected));
  });

  it('文件名在扩展检查、持久化、日志和响应前删除 TAB 与 C1 控制字符', async () => {
    const fixture = rawMultipartBody({ filename: 'safe\t\u0085.pdf', filenameEncoding: 'utf8' });

    const response = await postRawMultipart(context.app, context.salesAToken, fixture);

    expect(response.status).toBe(201);
    expect(response.body.data.rows[0]).toMatchObject({ originalName: 'safe.pdf', type: 'success' });
    expect(response.body.data.rows[0].document.originalName).toBe('safe.pdf');
    expect(context.db.prepare('SELECT original_name FROM public_documents').get().original_name).toBe('safe.pdf');
    const details = JSON.parse(context.db.prepare("SELECT details FROM operation_logs WHERE action = 'document_upload'").get().details);
    expect(details.originalName).toBe('safe.pdf');
  });

  it('文件名规范化后为空时按单文件错误结算', async () => {
    const fixture = rawMultipartBody({ filename: '\t\u0085', filenameEncoding: 'utf8' });

    const response = await postRawMultipart(context.app, context.salesAToken, fixture);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 1, success: 0, failed: 1 });
    expect(response.body.data.rows[0]).toMatchObject({ originalName: '', type: 'error', message: '资料文件名不正确' });
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
  });

  it('原始 Latin1 非 UTF-8 文件名按单文件编码错误拒绝', async () => {
    const fixture = rawMultipartBody({ filename: 'café.pdf' });

    const response = await postRawMultipart(context.app, context.salesAToken, fixture);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 1, success: 0, failed: 1 });
    expect(response.body.data.rows[0]).toMatchObject({ type: 'error', message: '资料文件名编码不正确' });
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('createTempPath 抛 ENOSPC 时返回中文存储错误且请求安全结束', async () => {
    context.db.close();
    const failingStorage = {
      ...storage,
      createTempPath: () => {
        throw Object.assign(new Error('disk full at private upload path'), { code: 'ENOSPC' });
      }
    };
    context = createAuthenticatedTestApp({
      documentStorage: failingStorage,
      documentLimits: { maxUploadFileBytes: 1024, maxUploadFiles: 3 }
    });

    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'training')
      .attach('files', Buffer.from('%PDF-1.7\n'), { filename: 'disk.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(507);
    expect(response.body.error).toEqual({
      code: 'INSUFFICIENT_STORAGE',
      message: '磁盘空间不足，资料上传失败'
    });
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('createTempPath 抛普通异常时返回 500 且不泄露基础设施细节', async () => {
    context.db.close();
    const failingStorage = {
      ...storage,
      createTempPath: () => {
        throw Object.assign(new TypeError('storage failed at private upload path'), {
          code: 'ERR_INVALID_ARG_TYPE',
          details: { path: 'private upload path', internal: true }
        });
      }
    };
    context = createAuthenticatedTestApp({
      documentStorage: failingStorage,
      documentLimits: { maxUploadFileBytes: 1024, maxUploadFiles: 3 }
    });
    const logged = [];
    const errorLog = vi.spyOn(console, 'error').mockImplementation((...args) => logged.push(args));

    const response = await request(context.app).post('/api/documents')
      .set(auth(context.salesAToken))
      .field('category', 'training')
      .attach('files', Buffer.from('%PDF-1.7\n'), { filename: 'failure.pdf', contentType: 'application/pdf' });

    errorLog.mockRestore();
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: '服务器开小差了，请稍后重试' });
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain('private upload path');
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('慢客户端触发请求级存储失败后及时收到中文错误并关闭连接', async () => {
    context.db.close();
    const failingStorage = {
      ...storage,
      createTempPath: () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
    };
    context = createAuthenticatedTestApp({
      documentStorage: failingStorage,
      documentLimits: { maxUploadFileBytes: 1024, maxUploadFiles: 3 }
    });
    const bodyPrefix = [
      '--slow-document-boundary',
      'Content-Disposition: form-data; name="category"',
      '',
      'training',
      '--slow-document-boundary',
      'Content-Disposition: form-data; name="files"; filename="slow.pdf"',
      'Content-Type: application/pdf',
      '',
      '%PDF-1.7\n'
    ].join('\r\n');

    const { rawResponse, elapsedMs } = await sendIncompleteHttpUpload(
      context.app,
      context.salesAToken,
      bodyPrefix,
      { timeoutMs: 2000 }
    );

    expect(elapsedMs).toBeLessThan(2000);
    expect(rawResponse).toContain('HTTP/1.1 507');
    expect(rawResponse.toLowerCase()).toContain('connection: close');
    expect(rawResponse).toContain('磁盘空间不足，资料上传失败');
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it('慢客户端的 Busboy 构造期格式错误返回中文 400 并关闭连接', async () => {
    const { rawResponse, elapsedMs } = await sendIncompleteHttpUpload(
      context.app,
      context.salesAToken,
      'partial-body-without-boundary',
      { timeoutMs: 2000, contentType: 'multipart/form-data' }
    );

    expect(elapsedMs).toBeLessThan(2000);
    expect(rawResponse).toContain('HTTP/1.1 400');
    expect(rawResponse.toLowerCase()).toContain('connection: close');
    expect(rawResponse).toContain('资料上传请求格式不正确');
    expect(context.db.prepare('SELECT count(*) total FROM public_documents').get().total).toBe(0);
    expect(readdirSync(storage.tempDir)).toHaveLength(0);
    expect(readdirSync(storage.rootDir).filter(name => !name.startsWith('.'))).toHaveLength(0);
  });

  it.each([
    [{ category: 'private' }, '请选择正确的资料分类'],
    [{ uploaderId: 0 }, '分页参数不正确'],
    [{ pageSize: 101 }, '分页参数不正确']
  ])('列表拒绝非法筛选或分页参数: %o', async (query, message) => {
    const response = await request(context.app).get('/api/documents')
      .set(auth(context.adminToken))
      .query(query);

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe(message);
  });
});
