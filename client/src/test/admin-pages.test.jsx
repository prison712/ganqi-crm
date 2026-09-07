import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardCards, recentTitle } from '../pages/DashboardPage.jsx';
import UsersPage, { UserDisableAction } from '../pages/UsersPage.jsx';
import { operationActionName } from '../pages/OperationLogsPage.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { http } from '../api/http.js';

describe('角色看板和账号高危操作', () => {
  it('销售看板只显示个人口径文案', () => {
    render(<DashboardCards role="sales" stats={{ todayNew: 2, privateTotal: 8, publicTotal: 5, weeklyFollowUps: 4 }} />);
    expect(screen.getByText('今日我的新增')).toBeInTheDocument();
    expect(screen.getByText('我的私海')).toBeInTheDocument();
    expect(screen.getByText('本周我的跟进')).toBeInTheDocument();
    expect(screen.queryByText('全员私海')).not.toBeInTheDocument();
  });

  it('停用销售前明确提示自动释放全部客户', async () => {
    const user = userEvent.setup();
    render(<UserDisableAction user={{ id: 2, displayName: '销售甲', isActive: true }} onToggle={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '停用' }));
    expect(screen.getByText(/停用后，该销售名下全部客户将自动释放到公海/)).toBeInTheDocument();
  });

  it('看板把安全操作显示为中文', () => {
    expect(recentTitle({ action: 'password_changed' })).toBe('修改密码');
    expect(recentTitle({ action: 'document_upload' })).toBe('上传资料');
    expect(operationActionName('document_purge')).toBe('彻底删除资料');
    expect(operationActionName('account_deleted')).toBe('删除账号');
  });

  it('超级管理员可看到管理员创建入口、账号身份和销售删除操作', async () => {
    vi.spyOn(http, 'get').mockResolvedValue({ data: { data: { items: [
      { id: 1, username: 'admin', displayName: '系统管理员', role: 'admin', isSuperAdmin: true, isActive: true },
      { id: 2, username: 'sales_a', displayName: '销售甲', role: 'sales', isSuperAdmin: false, isActive: true }
    ] } } });
    render(<AuthProvider initialUser={{ id: 1, role: 'admin', displayName: '系统管理员', isSuperAdmin: true }} initialLoading={false}>
      <UsersPage />
    </AuthProvider>);

    expect(await screen.findByRole('button', { name: /新增管理员/ })).toBeInTheDocument();
    expect(screen.getByText('超级管理员')).toBeInTheDocument();
    expect(screen.getByText('销售')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument());
  });

  it('销售编辑弹窗包含登录账号字段，删除前显示软删除说明', async () => {
    const browserUser = userEvent.setup();
    vi.spyOn(http, 'get').mockResolvedValue({ data: { data: { items: [
      { id: 2, username: 'sales_a', displayName: '销售甲', role: 'sales', isSuperAdmin: false, isActive: true }
    ] } } });
    render(<AuthProvider initialUser={{ id: 1, role: 'admin', displayName: '系统管理员', isSuperAdmin: true }} initialLoading={false}>
      <UsersPage />
    </AuthProvider>);
    await browserUser.click(await screen.findByRole('button', { name: /编\s*辑/ }));
    expect(screen.getByLabelText('登录账号')).toHaveValue('sales_a');
    await browserUser.click(screen.getByRole('button', { name: '取 消' }));
    await browserUser.click(screen.getByRole('button', { name: '删除' }));
    expect(await screen.findByText(/删除后账号不能登录，名下客户将自动释放到公海/)).toBeInTheDocument();
  });
});
