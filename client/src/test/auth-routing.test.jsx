import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext.jsx';
import AppLayout from '../layout/AppLayout.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import { http } from '../api/http.js';

afterEach(() => vi.restoreAllMocks());

function renderLayout(user) {
  return render(
    <MemoryRouter>
      <AuthProvider initialUser={user} initialLoading={false}>
        <AppLayout />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('角色导航', () => {
  it('管理员可见账号、全部客户、回收站和操作日志', () => {
    renderLayout({ id: 1, displayName: '管理员', role: 'admin' });
    expect(screen.getByText('账号管理')).toBeInTheDocument();
    expect(screen.getByText('全部客户')).toBeInTheDocument();
    expect(screen.getByText('客户回收站')).toBeInTheDocument();
    expect(screen.getByText('操作日志')).toBeInTheDocument();
  });

  it('销售菜单不显示管理员入口', () => {
    renderLayout({ id: 2, displayName: '销售甲', role: 'sales' });
    expect(screen.getByText('我的客户')).toBeInTheDocument();
    expect(screen.getByText('公海客户')).toBeInTheDocument();
    expect(screen.queryByText('账号管理')).not.toBeInTheDocument();
  });

  it('初始管理员登录后被强制显示不可关闭的改密弹窗', () => {
    renderLayout({ id: 1, displayName: '管理员', role: 'admin', mustChangePassword: true });
    expect(screen.getByRole('dialog', { name: '首次登录，请修改默认密码' })).toBeInTheDocument();
    expect(screen.queryByText('数据看板', { selector: 'h1' })).not.toBeInTheDocument();
  });

  it('所有登录用户都可从个人菜单打开修改密码', async () => {
    const user = userEvent.setup();
    renderLayout({ id: 2, displayName: '销售甲', role: 'sales' });
    await user.click(screen.getByText('销售甲'));
    await user.click(await screen.findByText('修改密码'));
    expect(await screen.findByRole('dialog', { name: '修改登录密码' })).toBeInTheDocument();
  });

  it('前端阻止不含数字的弱密码提交', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { data: { user: { id: 1, role: 'admin' } } } });
    renderLayout({ id: 1, displayName: '管理员', role: 'admin', mustChangePassword: true });
    await user.type(screen.getByLabelText('当前密码'), 'admin123');
    await user.type(screen.getByLabelText('新密码'), 'abcdefgh');
    await user.type(screen.getByLabelText('确认新密码'), 'abcdefgh');
    await user.click(screen.getByRole('button', { name: '保存新密码' }));
    expect(await screen.findByText('密码需为 8-128 位，且同时包含字母和数字')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('侧边栏使用公司Logo并显示CRM产品名', () => {
    renderLayout({ id: 1, displayName: '管理员', role: 'admin' });
    expect(screen.getByRole('img', { name: '公司Logo' })).toBeInTheDocument();
    expect(screen.getByText('集团销售 CRM')).toBeInTheDocument();
  });

  it('登录页显示CRM标题和公司Logo', () => {
    render(<MemoryRouter><AuthProvider initialUser={null} initialLoading={false}><LoginPage /></AuthProvider></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '集团销售客户管理 CRM' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '公司Logo' })).toHaveAttribute('src', '/company-logo.png');
  });
});
