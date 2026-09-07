import crypto from 'node:crypto';
import { createReadStream, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors.js';

const storageKeyPattern = /^[0-9a-f-]+\.[a-z0-9]+$/;
const trashEntryPattern = /^[0-9a-f-]+\.([0-9a-f-]+\.[a-z0-9]+)$/;

function invalidStorageKey() {
  return new AppError(400, 'INVALID_STORAGE_KEY', '资料存储标识不正确');
}

function unsafeStorageDirectory() {
  return new AppError(500, 'UNSAFE_STORAGE_DIRECTORY', '资料存储目录不安全');
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathsEqual(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function assertSafeDirectorySync(directory) {
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || !pathsEqual(realpathSync(directory), directory)) {
      throw unsafeStorageDirectory();
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unsafeStorageDirectory();
  }
}

async function assertSafeDirectory(directory) {
  try {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || !pathsEqual(await fs.realpath(directory), directory)) {
      throw unsafeStorageDirectory();
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unsafeStorageDirectory();
  }
}

function resolveStorageKey(rootDir, storageKey) {
  if (typeof storageKey !== 'string' || !storageKeyPattern.test(storageKey)) throw invalidStorageKey();
  const resolved = path.resolve(rootDir, storageKey);
  if (path.dirname(resolved) !== path.resolve(rootDir)) throw invalidStorageKey();
  return resolved;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function createLocalDocumentStorage({ rootDir: configuredRootDir }) {
  const rootDir = path.resolve(configuredRootDir);
  const tempDir = path.join(rootDir, '.tmp');
  const trashDir = path.join(rootDir, '.trash');

  function init() {
    mkdirSync(rootDir, { recursive: true });
    assertSafeDirectorySync(rootDir);
    mkdirSync(tempDir, { recursive: true });
    assertSafeDirectorySync(tempDir);
    mkdirSync(trashDir, { recursive: true });
    assertSafeDirectorySync(trashDir);
  }

  async function assertRegularFile(filePath, expectedDirectory, { allowMissing = false } = {}) {
    const resolved = path.resolve(filePath);
    if (!pathsEqual(path.dirname(resolved), expectedDirectory)) throw invalidStorageKey();
    await assertSafeDirectory(rootDir);
    if (!pathsEqual(expectedDirectory, rootDir)) await assertSafeDirectory(expectedDirectory);
    try {
      const info = await fs.lstat(resolved);
      if (!info.isFile() || info.isSymbolicLink()) throw unsafeStorageDirectory();
      return true;
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return false;
      if (error instanceof AppError) throw error;
      throw error;
    }
  }

  function assertRegularFileSync(filePath, expectedDirectory) {
    const resolved = path.resolve(filePath);
    if (!pathsEqual(path.dirname(resolved), expectedDirectory)) throw invalidStorageKey();
    assertSafeDirectorySync(rootDir);
    if (!pathsEqual(expectedDirectory, rootDir)) assertSafeDirectorySync(expectedDirectory);
    const info = lstatSync(resolved);
    if (!info.isFile() || info.isSymbolicLink()) throw unsafeStorageDirectory();
  }

  function parseTrashPath(trashPath, expectedStorageKey) {
    const resolved = path.resolve(String(trashPath || ''));
    if (!pathsEqual(path.dirname(resolved), trashDir)) throw invalidStorageKey();
    const match = trashEntryPattern.exec(path.basename(resolved));
    if (!match || (expectedStorageKey && match[1] !== expectedStorageKey)) throw invalidStorageKey();
    return { storageKey: match[1], trashPath: resolved };
  }

  async function stageRemoval(storageKey) {
    const originalPath = resolveStorageKey(rootDir, storageKey);
    await assertRegularFile(originalPath, rootDir);
    await assertSafeDirectory(trashDir);
    const trashKey = `${crypto.randomUUID()}.${storageKey}`;
    const trashPath = path.join(trashDir, trashKey);
    await fs.rename(originalPath, trashPath);
    return { storageKey, originalPath, trashKey, trashPath };
  }

  async function rollbackRemoval(staged) {
    const originalPath = resolveStorageKey(rootDir, staged?.storageKey);
    const parsed = parseTrashPath(staged?.trashPath, staged?.storageKey);
    await assertRegularFile(parsed.trashPath, trashDir);
    await assertSafeDirectory(rootDir);
    await fs.rename(parsed.trashPath, originalPath);
  }

  async function finalizeRemoval(staged) {
    const parsed = parseTrashPath(staged?.trashPath, staged?.storageKey);
    await assertRegularFile(parsed.trashPath, trashDir);
    await fs.rm(parsed.trashPath, { force: true });
  }

  async function reconcileTrash(isReferenced) {
    if (typeof isReferenced !== 'function') throw new TypeError('isReferenced must be a function');
    await assertSafeDirectory(rootDir);
    await assertSafeDirectory(trashDir);
    const entries = await fs.readdir(trashDir, { withFileTypes: true });
    const plans = entries.map(entry => {
      const match = entry.isFile() && trashEntryPattern.exec(entry.name);
      if (!match) throw invalidStorageKey();
      return {
        storageKey: match[1],
        trashPath: path.join(trashDir, entry.name)
      };
    });

    for (const plan of plans) {
      await assertRegularFile(plan.trashPath, trashDir);
      const referenced = await isReferenced(plan.storageKey);
      await assertRegularFile(plan.trashPath, trashDir);
      if (referenced) {
        const originalPath = resolveStorageKey(rootDir, plan.storageKey);
        if (await pathExists(originalPath)) throw new AppError(409, 'STORAGE_CONFLICT', '资料文件恢复冲突');
        await fs.rename(plan.trashPath, originalPath);
      } else {
        await fs.rm(plan.trashPath, { force: true });
      }
    }
  }

  return {
    rootDir,
    tempDir,
    trashDir,
    init,
    createTempPath: () => {
      assertSafeDirectorySync(rootDir);
      assertSafeDirectorySync(tempDir);
      return path.join(tempDir, crypto.randomUUID() + '.upload');
    },
    resolve: storageKey => resolveStorageKey(rootDir, storageKey),
    commit: async (tempPath, extension) => {
      if (!/^[a-z0-9]+$/.test(String(extension || ''))) throw invalidStorageKey();
      const sourceDirectory = path.dirname(path.resolve(tempPath));
      if (!pathsEqual(sourceDirectory, rootDir) && !pathsEqual(sourceDirectory, tempDir)) throw invalidStorageKey();
      await assertRegularFile(tempPath, sourceDirectory);
      await assertSafeDirectory(rootDir);
      const storageKey = `${crypto.randomUUID()}.${extension}`;
      const absolutePath = resolveStorageKey(rootDir, storageKey);
      await fs.rename(tempPath, absolutePath);
      return { storageKey, absolutePath };
    },
    exists: async storageKey => {
      const filePath = resolveStorageKey(rootDir, storageKey);
      return assertRegularFile(filePath, rootDir, { allowMissing: true });
    },
    stat: async storageKey => {
      const filePath = resolveStorageKey(rootDir, storageKey);
      await assertRegularFile(filePath, rootDir);
      return fs.stat(filePath);
    },
    createReadStream: storageKey => {
      const filePath = resolveStorageKey(rootDir, storageKey);
      assertRegularFileSync(filePath, rootDir);
      return createReadStream(filePath);
    },
    remove: async storageKey => {
      const filePath = resolveStorageKey(rootDir, storageKey);
      if (await assertRegularFile(filePath, rootDir, { allowMissing: true })) await fs.rm(filePath, { force: true });
    },
    stageRemoval,
    rollbackRemoval,
    finalizeRemoval,
    reconcileTrash,
    removeTemp: async tempPath => {
      if (await assertRegularFile(tempPath, tempDir, { allowMissing: true })) await fs.rm(tempPath, { force: true });
    }
  };
}
