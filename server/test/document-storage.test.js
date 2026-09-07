import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inspectDocumentFile,
  validateCategory,
  validateDescription
} from '../src/documents/fileTypes.js';
import { createLocalDocumentStorage } from '../src/documents/localStorage.js';
import { parseDocumentUpload } from '../src/documents/uploadParser.js';

let testDir;
let storage;
let externalDirs;

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'erp-documents-'));
  externalDirs = [];
  storage = createLocalDocumentStorage({ rootDir: testDir });
  storage.init();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  for (const externalDir of externalDirs) rmSync(externalDir, { recursive: true, force: true });
});

function replaceWithExternalDirectoryLink(directory, skip) {
  const externalDir = mkdtempSync(path.join(tmpdir(), 'erp-documents-outside-'));
  externalDirs.push(externalDir);
  rmSync(directory, { recursive: true, force: true });
  try {
    symlinkSync(externalDir, directory, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      skip(`当前环境不允许创建目录链接: ${error.code}`);
      return null;
    }
    throw error;
  }
  return externalDir;
}

async function inspectFixture(originalName, content, reportedMime = 'application/octet-stream') {
  const fixturePath = path.join(testDir, crypto.randomUUID() + '.fixture');
  writeFileSync(fixturePath, content);
  try {
    return await inspectDocumentFile({ path: fixturePath, originalName, reportedMime });
  } finally {
    rmSync(fixturePath, { force: true });
  }
}

async function parseMultipartFixture(files, limits, uploadStorage = storage) {
  const boundary = 'erp-document-boundary';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\ntraining\r\n`
  ];
  for (const file of files) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName || 'files'}"; filename="${file.name}"\r\nContent-Type: text/plain\r\n\r\n${file.content}\r\n`);
  }
  parts.push(`--${boundary}--\r\n`);
  const req = Readable.from(Buffer.from(parts.join(''), 'utf8'));
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  return parseDocumentUpload(req, { storage: uploadStorage, ...limits });
}

describe('资料字段校验', () => {
  it('规范化合法分类与说明并拒绝非法值', () => {
    expect(validateCategory(' training ')).toBe('training');
    expect(validateDescription('  新人资料  ')).toBe('新人资料');
    expect(() => validateCategory('private')).toThrow('请选择正确的资料分类');
    expect(() => validateDescription('资'.repeat(501))).toThrow('资料说明不能超过 500 字');
  });
});

describe('本地资料存储', () => {
  it('使用随机 storageKey 保存且不能越过上传目录', async () => {
    const source = path.join(testDir, 'incoming.tmp');
    writeFileSync(source, Buffer.from('%PDF-1.7\n'));
    const saved = await storage.commit(source, 'pdf');
    expect(saved.storageKey).toMatch(/^[0-9a-f-]+\.pdf$/);
    expect(saved.absolutePath.startsWith(path.resolve(testDir) + path.sep)).toBe(true);
    expect(() => storage.resolve('../outside.pdf')).toThrow('资料存储标识不正确');
  });

  it('分阶段删除可回滚并可最终清理隔离文件', async () => {
    const source = storage.createTempPath();
    writeFileSync(source, Buffer.from('document'));
    const saved = await storage.commit(source, 'txt');

    const firstStage = await storage.stageRemoval(saved.storageKey);
    expect(await storage.exists(saved.storageKey)).toBe(false);
    await storage.rollbackRemoval(firstStage);
    expect(await storage.exists(saved.storageKey)).toBe(true);

    const secondStage = await storage.stageRemoval(saved.storageKey);
    await storage.finalizeRemoval(secondStage);
    expect(existsSync(secondStage.trashPath)).toBe(false);
  });

  it('启动对账时原子恢复仍被数据库引用的隔离文件', async () => {
    const source = storage.createTempPath();
    writeFileSync(source, Buffer.from('referenced'));
    const saved = await storage.commit(source, 'txt');
    const staged = await storage.stageRemoval(saved.storageKey);

    await storage.reconcileTrash(async storageKey => storageKey === saved.storageKey);

    expect(await storage.exists(saved.storageKey)).toBe(true);
    expect(existsSync(staged.trashPath)).toBe(false);
  });

  it('启动对账时清理不再被数据库引用的隔离文件', async () => {
    const source = storage.createTempPath();
    writeFileSync(source, Buffer.from('unreferenced'));
    const saved = await storage.commit(source, 'txt');
    const staged = await storage.stageRemoval(saved.storageKey);

    await storage.reconcileTrash(async () => false);

    expect(await storage.exists(saved.storageKey)).toBe(false);
    expect(existsSync(staged.trashPath)).toBe(false);
  });

  it('初始化时拒绝指向上传根目录之外的 trash 目录链接', ({ skip }) => {
    const externalDir = replaceWithExternalDirectoryLink(storage.trashDir, skip);
    if (!externalDir) return;
    const sentinelPath = path.join(externalDir, 'sentinel.txt');
    writeFileSync(sentinelPath, 'keep');

    expect(() => storage.init()).toThrow('资料存储目录不安全');
    expect(existsSync(sentinelPath)).toBe(true);
  });

  it('删除临时文件前重新校验 tmp 目录以阻止链接换位越界', async ({ skip }) => {
    const externalDir = replaceWithExternalDirectoryLink(storage.tempDir, skip);
    if (!externalDir) return;
    const sentinelPath = path.join(externalDir, 'sentinel.upload');
    writeFileSync(sentinelPath, 'keep');

    expect(() => storage.createTempPath()).toThrow('资料存储目录不安全');
    await expect(storage.removeTemp(path.join(storage.tempDir, 'sentinel.upload')))
      .rejects.toThrow('资料存储目录不安全');
    expect(existsSync(sentinelPath)).toBe(true);
  });

  it('对账数据库回调后再次校验 trash 目录以阻止删除越界', async ({ skip }) => {
    const externalDir = mkdtempSync(path.join(tmpdir(), 'erp-documents-outside-'));
    externalDirs.push(externalDir);
    const probePath = path.join(testDir, 'link-probe');
    try {
      symlinkSync(externalDir, probePath, process.platform === 'win32' ? 'junction' : 'dir');
      rmSync(probePath, { recursive: true, force: true });
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        skip(`当前环境不允许创建目录链接: ${error.code}`);
        return;
      }
      throw error;
    }

    const source = storage.createTempPath();
    writeFileSync(source, Buffer.from('isolated'));
    const saved = await storage.commit(source, 'txt');
    const staged = await storage.stageRemoval(saved.storageKey);
    const outsideFile = path.join(externalDir, path.basename(staged.trashPath));

    await expect(storage.reconcileTrash(async () => {
      rmSync(storage.trashDir, { recursive: true, force: true });
      symlinkSync(externalDir, storage.trashDir, process.platform === 'win32' ? 'junction' : 'dir');
      writeFileSync(outsideFile, 'keep');
      return false;
    })).rejects.toThrow('资料存储目录不安全');
    expect(existsSync(outsideFile)).toBe(true);
  });
});

describe('资料文件识别', () => {
  it('识别允许的 PDF 与文本并拒绝伪装可执行文件', async () => {
    const pdf = await inspectFixture('manual.pdf', Buffer.from('%PDF-1.7\n'));
    expect(pdf).toMatchObject({ extension: 'pdf', mimeType: 'application/pdf', previewable: true });
    const text = await inspectFixture('notice.txt', Buffer.from('中文通知', 'utf8'));
    expect(text).toMatchObject({ extension: 'txt', mimeType: 'text/plain', previewable: false });
    await expect(inspectFixture('report.pdf', Buffer.from('MZ executable'))).rejects.toThrow('文件内容与扩展名不一致');
  });

  it('只在 CFB 文件头与旧 Office MIME 兼容时接受旧格式附件', async () => {
    const cfb = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const result = await inspectFixture('legacy.doc', cfb, 'application/msword');
    expect(result).toMatchObject({ extension: 'doc', mimeType: 'application/msword', previewable: false });
    await expect(inspectFixture('legacy.doc', cfb, 'image/png')).rejects.toThrow('文件内容与扩展名不一致');
  });

  it.each(['payload.js.txt', 'deploy.ps1.txt', 'installer.bat.txt'])(
    '拒绝危险脚本或可执行文件使用双扩展名伪装为文本: %s',
    async originalName => {
      await expect(inspectFixture(originalName, Buffer.from('这是普通文本内容', 'utf8')))
        .rejects.toThrow('文件内容与扩展名不一致');
    }
  );
});

describe('流式上传解析', () => {
  it('单个文件超限后仍保留同批其他候选文件', async () => {
    const result = await parseMultipartFixture([
      { name: 'too-large.txt', content: '123456789' },
      { name: 'valid.txt', content: 'ok' }
    ], { maxFileBytes: 4, maxFiles: 10 });
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalName: 'too-large.txt', code: 'FILE_TOO_LARGE' })
    ]));
    expect(result.candidates.map(item => item.originalName)).toContain('valid.txt');
  });

  it('拒绝非 files 文件字段但继续收集合法候选文件', async () => {
    const result = await parseMultipartFixture([
      { fieldName: 'avatar', name: 'wrong.txt', content: 'wrong' },
      { name: 'valid.txt', content: 'ok' }
    ], { maxFileBytes: 16, maxFiles: 10 });

    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalName: 'wrong.txt', code: 'INVALID_UPLOAD_FIELD' })
    ]));
    expect(result.candidates.map(item => item.originalName)).toEqual(['valid.txt']);
  });

  it('解析结束后的文件后处理失败仍清理本次临时文件并拒绝请求', async () => {
    const createdPaths = [];
    let removalAttempts = 0;
    const failingStorage = {
      ...storage,
      createTempPath: () => {
        const tempPath = storage.createTempPath();
        createdPaths.push(tempPath);
        return tempPath;
      },
      removeTemp: async tempPath => {
        removalAttempts += 1;
        await Promise.resolve();
        if (removalAttempts === 1) throw new Error('temporary cleanup failed');
        return storage.removeTemp(tempPath);
      }
    };

    await expect(parseMultipartFixture([
      { name: 'too-large.txt', content: '123456789' }
    ], { maxFileBytes: 4, maxFiles: 10 }, failingStorage)).rejects.toThrow('temporary cleanup failed');
    expect(createdPaths.every(tempPath => !existsSync(tempPath))).toBe(true);
  });
});
