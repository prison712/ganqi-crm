import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { http } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children, initialUser, initialLoading }) {
  const [user, setUser] = useState(initialUser ?? null);
  const [loading, setLoading] = useState(initialLoading ?? (initialUser === undefined));

  useEffect(() => {
    const expired = () => { setUser(null); setLoading(false); };
    window.addEventListener('auth:expired', expired);
    if (initialUser === undefined) {
      const token = localStorage.getItem('token');
      if (!token) setLoading(false);
      else http.get('/auth/me').then(response => setUser(response.data.data.user)).finally(() => setLoading(false));
    }
    return () => window.removeEventListener('auth:expired', expired);
  }, [initialUser]);

  async function login(username, password) {
    const response = await http.post('/auth/login', { username, password });
    localStorage.setItem('token', response.data.data.token);
    setUser(response.data.data.user);
    return response.data.data.user;
  }

  function logout() {
    localStorage.removeItem('token');
    setUser(null);
  }

  async function changePassword(currentPassword, newPassword) {
    const response = await http.post('/auth/change-password', { currentPassword, newPassword });
    setUser(response.data.data.user);
    return response.data.data.user;
  }

  const value = useMemo(() => ({ user, loading, login, logout, changePassword }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}
