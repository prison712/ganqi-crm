import { beforeEach, describe, expect, it } from 'vitest';
import { shouldExpireSession } from '../api/http.js';

describe('JWT 失效处理', () => {
  beforeEach(() => window.localStorage.clear());

  it('错误账号登录的 401 不应被误判为登录过期', () => {
    expect(shouldExpireSession({ response: { status: 401 }, config: { url: '/auth/login', headers: {} } })).toBe(false);
  });

  it('携带令牌的业务请求 401 应触发重新登录', () => {
    expect(shouldExpireSession({ response: { status: 401 }, config: { url: '/customers', headers: { Authorization: 'Bearer token' } } })).toBe(true);
  });
});
