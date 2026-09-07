import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLayout from '../layout/AppLayout.jsx';
import DocumentsPage from '../pages/DocumentsPage.jsx';
import { UploadResultContent, validateDocumentSelection } from '../components/DocumentUploadModal.jsx';

let currentUser;
const httpMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../api/http.js', () => ({ http: httpMocks, errorMessage: error => error?.message || '操作失败' }));
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: currentUser, logout: vi.fn(), changePassword: vi.fn() }) }));

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: 2, role: 'sales', displayName: '销售甲' };
});

function renderLayout() {
  return render(<MemoryRouter><Routes><Route element={<AppLayout />}><Route path="*" element={<div>内容</div>} /></Route></Routes></MemoryRouter>);
}

function renderDocuments(items = []) {
  httpMocks.get.mockResolvedValue({ data: { data: { items, pagination: { page: 1, pageSize: 10, total: items.length }, facets: { uploaders: [] } } } });
  return render(<MemoryRouter><DocumentsPage /></MemoryRouter>);
}

describe('公共资料页面', () => {
  it('管理员和销售都能看到公共资料菜单', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: '公共资料' })).toHaveAttribute('href', '/documents');
  });

  it('销售只能看到自己资料的删除按钮', async () => {
    renderDocuments([
      { id: 1, originalName: '我的资料.pdf', uploadedBy: 2, category: 'policy', sizeBytes: 10, uploaderName: '销售甲', createdAt: '2026-08-29T01:00:00Z' },
      { id: 2, originalName: '他人资料.pdf', uploadedBy: 3, category: 'policy', sizeBytes: 10, uploaderName: '销售乙', createdAt: '2026-08-29T01:00:00Z' }
    ]);
    expect(await screen.findAllByRole('button', { name: '删除' })).toHaveLength(1);
  });

  it('校验上传数量、大小和格式并展示逐文件结果', () => {
    expect(validateDocumentSelection(Array.from({ length: 11 }, (_, index) => ({ name: `${index}.txt`, size: 1 })))).toBe('单次最多上传 10 个文件');
    expect(validateDocumentSelection([{ name: '过大.pdf', size: 50 * 1024 * 1024 + 1 }])).toBe('“过大.pdf”不能超过 50 MB');
    expect(validateDocumentSelection([{ name: '程序.exe', size: 1 }])).toBe('“程序.exe”不是支持的文件格式');
    render(<UploadResultContent result={{ total: 2, success: 1, failed: 1, rows: [
      { originalName: '成功.pdf', type: 'success', message: '上传成功' },
      { originalName: '失败.exe', type: 'error', message: '不支持该文件格式' }
    ] }} />);
    expect(screen.getByText('成功 1 个，失败 1 个')).toBeInTheDocument();
    expect(screen.getByText('不支持该文件格式')).toBeInTheDocument();
  });

  it('点击上传会打开资料上传弹窗', async () => {
    renderDocuments();
    await userEvent.click(screen.getByRole('button', { name: '上传资料' }));
    expect(screen.getByText('上传公共资料')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始上传' })).toBeDisabled();
  });
});
