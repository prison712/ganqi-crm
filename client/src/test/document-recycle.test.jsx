import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLayout from '../layout/AppLayout.jsx';
import DocumentRecycleBinPage from '../pages/DocumentRecycleBinPage.jsx';

let currentUser;
const httpMocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn().mockResolvedValue({ data: { data: {} } }), delete: vi.fn().mockResolvedValue({ data: { data: {} } })
}));
vi.mock('../api/http.js', () => ({ http: httpMocks, errorMessage: error => error?.message || '操作失败' }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: currentUser, logout: vi.fn(), changePassword: vi.fn() }) }));

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: 1, role: 'admin', displayName: '系统管理员' };
  httpMocks.get.mockResolvedValue({ data: { data: {
    items: [{ id: 9, originalName: '旧资料.pdf', category: 'policy', sizeBytes: 128, uploaderName: '销售甲', createdAt: '2026-08-29T01:00:00Z', deletedAt: '2026-08-29T02:00:00Z' }],
    pagination: { page: 1, pageSize: 10, total: 1 }
  } } });
});

describe('资料回收站', () => {
  it('销售不显示资料回收站菜单', () => {
    currentUser = { id: 2, role: 'sales', displayName: '销售甲' };
    render(<MemoryRouter><Routes><Route element={<AppLayout />}><Route path="*" element={<div>内容</div>} /></Route></Routes></MemoryRouter>);
    expect(screen.queryByRole('link', { name: '资料回收站' })).not.toBeInTheDocument();
  });

  it('管理员恢复资料前二次确认', async () => {
    render(<MemoryRouter><DocumentRecycleBinPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '恢复' }));
    expect(screen.getByText('恢复后资料将重新出现在公共资料列表中。')).toBeInTheDocument();
  });

  it('彻底删除明确提示不可恢复', async () => {
    render(<MemoryRouter><DocumentRecycleBinPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '彻底删除' }));
    expect(screen.getByText(/文件将从磁盘移除且不可恢复/)).toBeInTheDocument();
  });
});
