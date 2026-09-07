import axios from 'axios';

export const http = axios.create({ baseURL: '/api', timeout: 15000 });

let redirecting = false;
http.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  response => response,
  error => {
    if (shouldExpireSession(error) && !redirecting) {
      redirecting = true;
      localStorage.removeItem('token');
      sessionStorage.setItem('loginReturnUrl', `${window.location.pathname}${window.location.search}`);
      window.dispatchEvent(new CustomEvent('auth:expired'));
      const separator = window.location.pathname === '/login' ? '' : '?expired=1';
      window.location.assign(`/login${separator}`);
      setTimeout(() => { redirecting = false; }, 1000);
    }
    return Promise.reject(error);
  }
);

export function shouldExpireSession(error) {
  const hadToken = Boolean(error.config?.headers?.Authorization || localStorage.getItem('token'));
  const isLoginRequest = String(error.config?.url || '').includes('/auth/login');
  return error.response?.status === 401 && hadToken && !isLoginRequest;
}

export function errorMessage(error, fallback = '操作失败，请稍后重试') {
  return error.response?.data?.error?.message || fallback;
}
