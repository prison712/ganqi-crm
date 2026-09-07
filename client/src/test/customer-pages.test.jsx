import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext.jsx';
import CustomerFilters from '../components/CustomerFilters.jsx';
import CustomerForm from '../components/CustomerForm.jsx';
import DangerConfirm from '../components/DangerConfirm.jsx';
import CustomerListPage, { ImportResultContent } from '../pages/CustomerListPage.jsx';
import { http } from '../api/http.js';

afterEach(() => vi.restoreAllMocks());

describe('客户列表交互', () => {
  it('导出时使用当前关键词与状态筛选', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onExport = vi.fn();
    render(<CustomerFilters value={{ keyword: '科技', status: 'following', source: '' }} onChange={onChange} onExport={onExport} />);
    await user.click(screen.getByRole('button', { name: '导出 Excel' }));
    expect(onExport).toHaveBeenCalledWith({ keyword: '科技', status: 'following', source: '' });
  });

  it('释放客户必须填写原因后才能确认', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DangerConfirm buttonText="释放" title="释放客户" reasonRequired onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: '释放' }));
    await user.click(screen.getByRole('button', { name: '确认释放' }));
    expect(await screen.findByText('请输入释放原因')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('释放原因'), '连续多次未联系上');
    await user.click(screen.getByRole('button', { name: '确认释放' }));
    expect(onConfirm).toHaveBeenCalledWith('连续多次未联系上');
  });

  it('高危操作失败时保留确认弹窗便于重试', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(false);
    render(<DangerConfirm buttonText="删除" title="删除客户" onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByText('删除客户')).toBeInTheDocument();
  });

  it('Excel 导入错误以可复制表格展示', () => {
    render(<ImportResultContent result={{ total: 2, success: 0, duplicate: 1, failed: 1, rows: [
      { row: 2, companyName: '重复客户', type: 'duplicate', message: '客户已存在，已跳过' },
      { row: 3, companyName: '', type: 'error', message: '公司名称不能为空' }
    ] }} />);
    expect(screen.getByRole('columnheader', { name: 'Excel 行号' })).toBeInTheDocument();
    expect(screen.getByText('重复客户')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy' }).length).toBe(2);
  });

  it('客户页面携带私海范围和分页参数加载列表', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({ data: { data: { items: [], pagination: { page: 1, pageSize: 10, total: 0 } } } });
    render(<MemoryRouter><AuthProvider initialUser={{ id: 2, role: 'sales', displayName: '销售甲' }} initialLoading={false}>
      <CustomerListPage scope="private" title="我的客户" description="测试私海" />
    </AuthProvider></MemoryRouter>);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/customers', { params: expect.objectContaining({ scope: 'private', page: 1, pageSize: 10 }) }));
  });

  it('新增客户表单校验后提交业务字段', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue(true);
    render(<CustomerForm open initialValues={null} onCancel={vi.fn()} onSubmit={submit} />);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('公司名称'), '自动化新增客户');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ companyName: '自动化新增客户', status: 'potential' })));
  });
});
