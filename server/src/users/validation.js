import { AppError } from '../errors.js';

export function validateUsername(value) {
  const username = String(value || '').trim();
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    throw new AppError(400, 'VALIDATION_ERROR', '账号需为 3-30 位字母、数字或下划线');
  }
  return username;
}

export function validateDisplayName(value) {
  const displayName = String(value || '').trim();
  if (!displayName) throw new AppError(400, 'VALIDATION_ERROR', '请输入显示姓名');
  if (displayName.length > 50) throw new AppError(400, 'VALIDATION_ERROR', '显示姓名不能超过 50 字');
  return displayName;
}

export function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new AppError(400, 'VALIDATION_ERROR', '密码需为 8-128 位，且同时包含字母和数字');
  }
  return password;
}
