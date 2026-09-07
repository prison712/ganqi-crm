import { lazy, Suspense } from 'react';
import { Spin } from 'antd';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import AppLayout from './layout/AppLayout.jsx';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const PrivateCustomersPage = lazy(() => import('./pages/PrivateCustomersPage.jsx'));
const PublicCustomersPage = lazy(() => import('./pages/PublicCustomersPage.jsx'));
const AllCustomersPage = lazy(() => import('./pages/AllCustomersPage.jsx'));
const RecycleBinPage = lazy(() => import('./pages/RecycleBinPage.jsx'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const OperationLogsPage = lazy(() => import('./pages/OperationLogsPage.jsx'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage.jsx'));
const DocumentRecycleBinPage = lazy(() => import('./pages/DocumentRecycleBinPage.jsx'));

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-spin"><Spin size="large" /></div>;
  return user ? <AppLayout /> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

export default function App() {
  return <Suspense fallback={<div className="full-spin"><Spin size="large" /></div>}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route index element={<DashboardPage />} />
      <Route path="customers/private" element={<PrivateCustomersPage />} />
      <Route path="customers/public" element={<PublicCustomersPage />} />
      <Route path="customers/all" element={<AdminRoute><AllCustomersPage /></AdminRoute>} />
      <Route path="customers/recycle" element={<AdminRoute><RecycleBinPage /></AdminRoute>} />
      <Route path="customers/:id" element={<CustomerDetailPage />} />
      <Route path="users" element={<AdminRoute><UsersPage /></AdminRoute>} />
      <Route path="logs" element={<AdminRoute><OperationLogsPage /></AdminRoute>} />
      <Route path="documents" element={<DocumentsPage />} />
      <Route path="documents/recycle" element={<AdminRoute><DocumentRecycleBinPage /></AdminRoute>} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
