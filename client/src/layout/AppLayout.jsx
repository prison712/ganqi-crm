import { useState } from 'react';
import { Layout, Menu, Button, Avatar, Dropdown, Space, Typography, message } from 'antd';
import {
  AppstoreOutlined, TeamOutlined, GlobalOutlined, UserOutlined,
  DeleteOutlined, AuditOutlined, MenuFoldOutlined, MenuUnfoldOutlined, LogoutOutlined, FolderOpenOutlined, LockOutlined
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import PasswordChangeModal from '../components/PasswordChangeModal.jsx';

const { Sider, Header, Content } = Layout;

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout, changePassword } = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const location = useLocation();
  const navigate = useNavigate();
  const items = [
    { key: '/', icon: <AppstoreOutlined />, label: <Link to="/">数据看板</Link> },
    ...(user?.role === 'sales' ? [{ key: '/customers/private', icon: <TeamOutlined />, label: <Link to="/customers/private">我的客户</Link> }] : []),
    { key: '/customers/public', icon: <GlobalOutlined />, label: <Link to="/customers/public">公海客户</Link> },
    { key: '/documents', icon: <FolderOpenOutlined />, label: <Link to="/documents">公共资料</Link> },
    ...(user?.role === 'admin' ? [
      { key: '/customers/all', icon: <TeamOutlined />, label: <Link to="/customers/all">全部客户</Link> },
      { key: '/customers/recycle', icon: <DeleteOutlined />, label: <Link to="/customers/recycle">客户回收站</Link> },
      { key: '/documents/recycle', icon: <DeleteOutlined />, label: <Link to="/documents/recycle">资料回收站</Link> },
      { key: '/users', icon: <UserOutlined />, label: <Link to="/users">账号管理</Link> },
      { key: '/logs', icon: <AuditOutlined />, label: <Link to="/logs">操作日志</Link> }
    ] : [])
  ];
  const selectedKey = items.map(item => item.key)
    .filter(key => key === '/' ? location.pathname === '/' : location.pathname.startsWith(key))
    .sort((left, right) => right.length - left.length)[0];
  async function submitPassword(values) {
    setChangingPassword(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      setPasswordOpen(false);
      messageApi.success('密码修改成功，请妥善保管新密码');
    } catch (error) {
      messageApi.error(error.response?.data?.error?.message || '密码修改失败');
    } finally { setChangingPassword(false); }
  }
  return (
    <>{contextHolder}<Layout className="app-shell">
      <Sider collapsible collapsed={collapsed} trigger={null} className="app-sider" breakpoint="lg" onBreakpoint={setCollapsed}>
        <div className="brand"><span className="brand-logo-frame"><img className="brand-logo" src="/company-logo.png" alt="公司Logo" /></span>{!collapsed && <span>集团销售 CRM</span>}</div>
        <Menu theme="dark" mode="inline" selectedKeys={selectedKey ? [selectedKey] : []} items={items} />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Button type="text" aria-label="切换导航" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(value => !value)} />
          <Dropdown menu={{ items: [
            { key: 'password', icon: <LockOutlined />, label: '修改密码', onClick: () => setPasswordOpen(true) },
            { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: () => { logout(); navigate('/login'); } }
          ] }}>
            <Space className="user-menu"><Avatar>{user?.displayName?.[0] || '用'}</Avatar><Typography.Text>{user?.displayName}</Typography.Text></Space>
          </Dropdown>
        </Header>
        <Content className="app-content">{!user?.mustChangePassword && <Outlet />}</Content>
      </Layout>
    </Layout>
    <PasswordChangeModal open={Boolean(user?.mustChangePassword)} forced loading={changingPassword} onSubmit={submitPassword} />
    <PasswordChangeModal open={passwordOpen && !user?.mustChangePassword} loading={changingPassword}
      onSubmit={submitPassword} onCancel={() => setPasswordOpen(false)} />
    </>
  );
}
