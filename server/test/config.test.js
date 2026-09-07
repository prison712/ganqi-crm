import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { projectRoot, resolveUploadPath, validateRuntimeConfig, validateUploadLimits } from '../src/config.js';

describe('生产环境安全配置', () => {
  it('拒绝公开默认密钥和不足 32 位的密钥', () => {
    expect(() => validateRuntimeConfig({ nodeEnv: 'production', jwtSecret: 'customer-erp-development-secret-change-in-production' }))
      .toThrow('生产环境 JWT_SECRET');
    expect(() => validateRuntimeConfig({ nodeEnv: 'production', jwtSecret: 'too-short' }))
      .toThrow('生产环境 JWT_SECRET');
  });

  it('接受足够长且非示例的生产密钥', () => {
    expect(() => validateRuntimeConfig({ nodeEnv: 'production', jwtSecret: 'a-real-production-secret-with-40-characters' }))
      .not.toThrow();
  });
});

describe('上传配置', () => {
  it('相对上传目录基于项目根目录解析', () => {
    expect(resolveUploadPath('data/uploads')).toBe(path.join(projectRoot, 'data', 'uploads'));
  });

  it('拒绝无效上传限制', () => {
    expect(() => validateUploadLimits({ maxUploadFileBytes: 0, maxUploadFiles: 10 })).toThrow('上传文件大小限制');
    expect(() => validateUploadLimits({ maxUploadFileBytes: 50 * 1024 * 1024, maxUploadFiles: 11 })).toThrow('单批上传数量');
  });

  it('拒绝超过 50 MB 的单个上传文件', () => {
    expect(() => validateUploadLimits({ maxUploadFileBytes: 51 * 1024 * 1024, maxUploadFiles: 10 }))
      .toThrow('上传文件大小限制');
  });
});
