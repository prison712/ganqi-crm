import path from 'node:path';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalDocumentStorage } from '../src/documents/localStorage.js';
import { auth, createAuthenticatedTestApp, insertDocument } from './helpers.js';

const pdfBytes = Buffer.from('%PDF-1.7\npublic document');
const xlsxBytes = Buffer.from('PK\u0003\u0004spreadsheet');

describe('公共资料访问与回收站生命周期', () => {
  let testDir;
  let storage;
  let context;
  let ownedPdf;
  let ownedXlsx;
  let otherPdf;

  function saveDocument({
    originalName,
    extension,
    mimeType,
    bytes,
    uploadedBy = context.salesA.id,
    category = 'sales_tool',
    deletedAt = null,
    deletedBy = null,
    sha256 = 'a'.repeat(64)
  }) {
    const tempPath = storage.createTempPath();
    writeFileSync(tempPath, bytes);
    return storage.commit(tempPath, extension).then(saved => insertDocument(context.db, {
      originalName,
      storageKey: saved.storageKey,
      category,
      extension,
      mimeType,
      sizeBytes: bytes.length,
      sha256,
      uploadedBy,
      deletedAt,
      deletedBy
    }));
  }

  beforeEach(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), 'erp-documents-lifecycle-'));
    storage = createLocalDocumentStorage({ rootDir: testDir });
    storage.init();
    context = createAuthenticatedTestApp({
      documentStorage: storage,
      documentLimits: { maxUploadFileBytes: 1024, maxUploadFiles: 3 }
    });
    ownedPdf = await saveDocument({
      originalName: '销售政策-中文.pdf', extension: 'pdf', mimeType: 'application/pdf', bytes: pdfBytes
    });
    ownedXlsx = await saveDocument({
      originalName: '价格表.xlsx', extension: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: xlsxBytes
    });
    otherPdf = await saveDocument({
      originalName: '他人资料.pdf', extension: 'pdf', mimeType: 'application/pdf', bytes: pdfBytes,
      uploadedBy: context.salesB.id
    });
  });

  afterEach(() => {
    context.db.close();
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each([
    ['get', ({ id }) => `/api/documents/${id}/preview`],
    ['get', ({ id }) => `/api/documents/${id}/download`],
    ['delete', ({ id }) => `/api/documents/${id}`],
    ['get', () => '/api/documents/recycle'],
    ['post', ({ id }) => `/api/documents/${id}/restore`],
    ['delete', ({ id }) => `/api/documents/${id}/purge`]
  ])('%s %s 必须通过 JWT 认证', async (method, buildPath) => {
    const response = await request(context.app)[method](buildPath({ id: ownedPdf.id }));
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('请先登录');
  });

  it('PDF 和图片可内联预览，Office 资料只能下载', async () => {
    const image = await saveDocument({
      originalName: '宣传图.png', extension: 'png', mimeType: 'image/png', bytes: Buffer.from([137, 80, 78, 71])
    });

    for (const document of [ownedPdf, image]) {
      const preview = await request(context.app).get(`/api/documents/${document.id}/preview`)
        .set(auth(context.salesAToken));
      expect(preview.status).toBe(200);
      expect(preview.headers['content-disposition']).toMatch(/^inline/);
      expect(preview.headers['x-content-type-options']).toBe('nosniff');
    }
    const pdfPreview = await request(context.app).get(`/api/documents/${ownedPdf.id}/preview`)
      .set(auth(context.salesAToken));
    expect(pdfPreview.headers['content-type']).toMatch(/application\/pdf/);

    const rejected = await request(context.app).get(`/api/documents/${ownedXlsx.id}/preview`)
      .set(auth(context.salesAToken));
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toContain('不支持在线预览');
  });

  it('下载使用 Unicode 原始文件名且以流式附件返回', async () => {
    const download = await request(context.app).get(`/api/documents/${ownedPdf.id}/download`)
      .set(auth(context.salesAToken));

    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toMatch(/application\/pdf/);
    expect(download.headers['content-length']).toBe(String(pdfBytes.length));
    expect(download.headers['content-disposition']).toMatch(/^attachment/);
    expect(download.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(download.headers['x-content-type-options']).toBe('nosniff');
  });

  it('文件丢失或资料已软删除时不暴露文件', async () => {
    await storage.remove(ownedPdf.storageKey);
    const missing = await request(context.app).get(`/api/documents/${ownedPdf.id}/download`)
      .set(auth(context.salesAToken));
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toContain('不存在或已损坏');

    const deleted = await saveDocument({
      originalName: '已删除.pdf', extension: 'pdf', mimeType: 'application/pdf', bytes: pdfBytes,
      deletedAt: new Date().toISOString(), deletedBy: context.salesA.id
    });
    const hidden = await request(context.app).get(`/api/documents/${deleted.id}/download`)
      .set(auth(context.adminToken));
    expect(hidden.status).toBe(404);
  });

  it('文件在流打开前丢失仍返回完整中文错误', async () => {
    storage.createReadStream = () => {
      const stream = new Readable({ read() {} });
      queueMicrotask(() => stream.destroy(Object.assign(new Error('missing after stat'), { code: 'ENOENT' })));
      return stream;
    };

    const missing = await request(context.app).get(`/api/documents/${ownedPdf.id}/download`)
      .set(auth(context.salesAToken));

    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toContain('不存在或已损坏');
    expect(missing.headers['content-disposition']).toBeUndefined();
  });

  it.each(['0', '-1', '1.5', 'abc'])('资料 ID 只接受正整数: %s', async id => {
    const response = await request(context.app).get(`/api/documents/${id}/download`)
      .set(auth(context.adminToken));
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('ID');
  });

  it('上传者可软删除自己的资料但不能删除他人资料，管理员可删除任意资料', async () => {
    const deleted = await request(context.app).delete(`/api/documents/${ownedPdf.id}`)
      .set(auth(context.salesAToken));
    expect(deleted.status).toBe(200);
    expect(context.db.prepare('SELECT deleted_by FROM public_documents WHERE id = ?').get(ownedPdf.id).deleted_by)
      .toBe(context.salesA.id);

    const forbidden = await request(context.app).delete(`/api/documents/${otherPdf.id}`)
      .set(auth(context.salesAToken));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.message).toBe('只能删除自己上传的资料');

    await request(context.app).delete(`/api/documents/${otherPdf.id}`)
      .set(auth(context.adminToken)).expect(200);
    const logs = context.db.prepare("SELECT action FROM operation_logs WHERE action = 'document_delete'").all();
    expect(logs).toHaveLength(2);
  });

  it('软删除与日志在同一事务中，重复删除不会重复写日志', async () => {
    context.db.exec(`CREATE TRIGGER reject_document_delete_log
      BEFORE INSERT ON operation_logs WHEN NEW.action = 'document_delete'
      BEGIN SELECT RAISE(ABORT, 'reject delete log'); END`);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failed = await request(context.app).delete(`/api/documents/${ownedPdf.id}`)
      .set(auth(context.salesAToken));
    errorLog.mockRestore();
    expect(failed.status).toBe(500);
    expect(context.db.prepare('SELECT deleted_at FROM public_documents WHERE id = ?').get(ownedPdf.id).deleted_at).toBeNull();

    context.db.exec('DROP TRIGGER reject_document_delete_log');
    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);
    const repeated = await request(context.app).delete(`/api/documents/${ownedPdf.id}`)
      .set(auth(context.salesAToken));
    expect(repeated.status).toBe(409);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_delete'").get().total).toBe(1);
  });

  it('并发软删除只有一次成功', async () => {
    const responses = await Promise.all([
      request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)),
      request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken))
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_delete'").get().total).toBe(1);
  });

  it('仅管理员可查看回收站，且回收站支持筛选与分页', async () => {
    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);
    await request(context.app).delete(`/api/documents/${otherPdf.id}`).set(auth(context.adminToken)).expect(200);

    expect((await request(context.app).get('/api/documents/recycle').set(auth(context.salesAToken))).status).toBe(403);
    const response = await request(context.app).get('/api/documents/recycle')
      .set(auth(context.adminToken))
      .query({ keyword: '销售政策', category: 'sales_tool', uploaderId: context.salesA.id, page: 1, pageSize: 1 });
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({ id: ownedPdf.id, deletedBy: context.salesA.id, deletedByName: '销售甲' });
    expect(response.body.data.pagination).toEqual({ page: 1, pageSize: 1, total: 1 });
  });

  it('仅管理员可恢复，恢复与日志同事务且重复恢复被拒绝', async () => {
    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);
    expect((await request(context.app).post(`/api/documents/${ownedPdf.id}/restore`)
      .set(auth(context.salesAToken))).status).toBe(403);

    context.db.exec(`CREATE TRIGGER reject_document_restore_log
      BEFORE INSERT ON operation_logs WHEN NEW.action = 'document_restore'
      BEGIN SELECT RAISE(ABORT, 'reject restore log'); END`);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await request(context.app).post(`/api/documents/${ownedPdf.id}/restore`)
      .set(auth(context.adminToken));
    errorLog.mockRestore();
    expect(failed.status).toBe(500);
    expect(context.db.prepare('SELECT deleted_at FROM public_documents WHERE id = ?').get(ownedPdf.id).deleted_at).toBeTruthy();

    context.db.exec('DROP TRIGGER reject_document_restore_log');
    await request(context.app).post(`/api/documents/${ownedPdf.id}/restore`).set(auth(context.adminToken)).expect(200);
    const repeated = await request(context.app).post(`/api/documents/${ownedPdf.id}/restore`)
      .set(auth(context.adminToken));
    expect(repeated.status).toBe(409);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_restore'").get().total).toBe(1);
  });

  it('并发恢复只有一次成功', async () => {
    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);

    const responses = await Promise.all([
      request(context.app).post(`/api/documents/${ownedPdf.id}/restore`).set(auth(context.adminToken)),
      request(context.app).post(`/api/documents/${ownedPdf.id}/restore`).set(auth(context.adminToken))
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_restore'").get().total).toBe(1);
  });

  it('彻底删除仅允许管理员删除回收站资料，并写入完整快照', async () => {
    expect((await request(context.app).delete(`/api/documents/${ownedPdf.id}/purge`)
      .set(auth(context.salesAToken))).status).toBe(403);
    const active = await request(context.app).delete(`/api/documents/${ownedPdf.id}/purge`)
      .set(auth(context.adminToken));
    expect(active.status).toBe(409);

    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);
    await request(context.app).delete(`/api/documents/${ownedPdf.id}/purge`).set(auth(context.adminToken)).expect(200);

    expect(await storage.exists(ownedPdf.storageKey)).toBe(false);
    expect(context.db.prepare('SELECT id FROM public_documents WHERE id = ?').get(ownedPdf.id)).toBeUndefined();
    const log = context.db.prepare("SELECT details FROM operation_logs WHERE action = 'document_purge'").get();
    expect(JSON.parse(log.details)).toEqual(expect.objectContaining({
      documentId: ownedPdf.id,
      originalName: '销售政策-中文.pdf',
      category: 'sales_tool',
      sizeBytes: pdfBytes.length,
      sha256: 'a'.repeat(64),
      uploadedBy: context.salesA.id
    }));

    const repeated = await request(context.app).delete(`/api/documents/${ownedPdf.id}/purge`)
      .set(auth(context.adminToken));
    expect(repeated.status).toBe(404);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_purge'").get().total).toBe(1);
  });

  it('并发彻底删除只有一次提交数据库和日志', async () => {
    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);

    const responses = await Promise.all([
      request(context.app).delete(`/api/documents/${ownedPdf.id}/purge`).set(auth(context.adminToken)),
      request(context.app).delete(`/api/documents/${ownedPdf.id}/purge`).set(auth(context.adminToken))
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_purge'").get().total).toBe(1);
    expect(readdirSync(storage.trashDir)).toHaveLength(0);
  });

  it('彻底删除 stage 失败时不改数据库', async () => {
    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);
    await storage.remove(ownedPdf.storageKey);

    const failed = await request(context.app).delete(`/api/documents/${ownedPdf.id}/purge`)
      .set(auth(context.adminToken));
    expect(failed.status).toBe(404);
    expect(failed.body.error.message).toContain('不存在或已损坏');
    expect(context.db.prepare('SELECT deleted_at FROM public_documents WHERE id = ?').get(ownedPdf.id).deleted_at).toBeTruthy();
    expect(context.db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'document_purge'").get().total).toBe(0);
  });

  it('彻底删除的数据库事务失败时回滚隔离文件', async () => {
    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);
    context.db.exec(`CREATE TRIGGER reject_document_purge_log
      BEFORE INSERT ON operation_logs WHEN NEW.action = 'document_purge'
      BEGIN SELECT RAISE(ABORT, 'reject purge log'); END`);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failed = await request(context.app).delete(`/api/documents/${ownedPdf.id}/purge`)
      .set(auth(context.adminToken));
    errorLog.mockRestore();
    expect(failed.status).toBe(500);
    expect(await storage.exists(ownedPdf.storageKey)).toBe(true);
    expect(context.db.prepare('SELECT deleted_at FROM public_documents WHERE id = ?').get(ownedPdf.id).deleted_at).toBeTruthy();
    expect(readdirSync(storage.trashDir)).toHaveLength(0);
  });

  it('数据库提交后 finalize 失败返回 500 并保留不可访问隔离文件', async () => {
    await request(context.app).delete(`/api/documents/${ownedPdf.id}`).set(auth(context.salesAToken)).expect(200);
    context.db.close();
    const failingStorage = { ...storage, finalizeRemoval: async () => { throw new Error('finalize failed'); } };
    context = createAuthenticatedTestApp({
      documentStorage: failingStorage,
      documentLimits: { maxUploadFileBytes: 1024, maxUploadFiles: 3 }
    });
    const row = insertDocument(context.db, {
      originalName: '隔离资料.pdf', storageKey: ownedPdf.storageKey, category: 'sales_tool',
      extension: 'pdf', mimeType: 'application/pdf', sizeBytes: pdfBytes.length,
      sha256: 'b'.repeat(64), uploadedBy: context.salesA.id,
      deletedAt: new Date().toISOString(), deletedBy: context.salesA.id
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failed = await request(context.app).delete(`/api/documents/${row.id}/purge`)
      .set(auth(context.adminToken));

    expect(failed.status).toBe(500);
    expect(context.db.prepare('SELECT id FROM public_documents WHERE id = ?').get(row.id)).toBeUndefined();
    expect(await storage.exists(row.storageKey)).toBe(false);
    expect(readdirSync(storage.trashDir)).toHaveLength(1);
    expect(errorLog).toHaveBeenCalled();
  });

  it('启动对账按数据库引用恢复或清理隔离文件', async () => {
    const referenced = await storage.stageRemoval(ownedPdf.storageKey);
    const unreferenced = await storage.stageRemoval(ownedXlsx.storageKey);
    context.db.prepare('DELETE FROM public_documents WHERE id = ?').run(ownedXlsx.id);

    await storage.reconcileTrash(storageKey => Boolean(
      context.db.prepare('SELECT id FROM public_documents WHERE storage_key = ?').get(storageKey)
    ));

    expect(await storage.exists(ownedPdf.storageKey)).toBe(true);
    expect(existsSync(referenced.trashPath)).toBe(false);
    expect(await storage.exists(ownedXlsx.storageKey)).toBe(false);
    expect(existsSync(unreferenced.trashPath)).toBe(false);
    expect(readdirSync(storage.trashDir)).toHaveLength(0);
  });
});
