import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Modal, Select, Space, Table, Typography, Upload, message } from 'antd';
import { PlusOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { http, errorMessage } from '../api/http.js';
import { useAuth } from '../auth/AuthContext.jsx';
import CustomerFilters from '../components/CustomerFilters.jsx';
import CustomerTable from '../components/CustomerTable.jsx';
import CustomerForm from '../components/CustomerForm.jsx';
import DangerConfirm from '../components/DangerConfirm.jsx';

function downloadBlob(data, filename) {
  const url = URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export function ImportResultContent({ result }) {
  const problemRows = result.rows.filter(row => row.type !== 'success');
  const columns = [
    { title: 'Excel 行号', dataIndex: 'row', width: 100 },
    { title: '公司名称', dataIndex: 'companyName', width: 220, render: value => value || '未命名' },
    { title: '结果', dataIndex: 'type', width: 90, render: value => value === 'duplicate' ? '重复' : '错误' },
    { title: '提示', dataIndex: 'message', render: value => <Typography.Text copyable={{ text: value }}>{value}</Typography.Text> }
  ];
  return <div><p>共 {result.total} 条，成功 {result.success}，重复 {result.duplicate}，失败 {result.failed}</p>
    {problemRows.length ? <Table rowKey="row" size="small" pagination={false} dataSource={problemRows} columns={columns} scroll={{ y: 360, x: 650 }} /> : <Typography.Text type="success">全部导入成功</Typography.Text>}
  </div>;
}

export default function CustomerListPage({ scope, title, description }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 });
  const [filters, setFilters] = useState({ keyword: '', status: '', source: '', ownerId: '' });
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [owners, setOwners] = useState([]);
  const [assigning, setAssigning] = useState(null);
  const [assignOwnerId, setAssignOwnerId] = useState(null);
  const [messageApi, contextHolder] = message.useMessage();
  const timer = useRef();

  const load = useCallback(async (page = pagination.page, nextFilters = filters) => {
    setLoading(true);
    try {
      const response = await http.get('/customers', { params: { scope, ...nextFilters, page, pageSize: pagination.pageSize } });
      setItems(response.data.data.items);
      setPagination(response.data.data.pagination);
    } catch (error) { messageApi.error(errorMessage(error, '客户列表加载失败')); }
    finally { setLoading(false); }
  }, [filters, messageApi, pagination.page, pagination.pageSize, scope]);

  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => load(1, filters), 250); return () => clearTimeout(timer.current); }, [filters, scope]);
  useEffect(() => {
    if (user.role === 'admin') http.get('/users')
      .then(response => setOwners(response.data.data.items))
      .catch(error => messageApi.error(errorMessage(error, '销售账号加载失败')));
  }, [messageApi, user.role]);

  async function mutate(request, success) {
    try { await request(); messageApi.success(success); await load(); return true; }
    catch (error) { messageApi.error(errorMessage(error)); return false; }
  }
  async function save(values) {
    const completed = await mutate(() => editing ? http.patch(`/customers/${editing.id}`, values) : http.post('/customers', values), editing ? '客户信息已更新' : '客户创建成功');
    if (completed) { setFormOpen(false); setEditing(null); }
    return completed;
  }
  async function exportExcel(current) {
    try {
      const response = await http.get('/customers/export', { params: { scope, ...current }, responseType: 'blob' });
      downloadBlob(response.data, `客户数据-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) { messageApi.error(errorMessage(error, '导出失败')); }
  }
  async function template() {
    try { const response = await http.get('/customers/import-template', { responseType: 'blob' }); downloadBlob(response.data, '客户导入模板.xlsx'); }
    catch (error) { messageApi.error(errorMessage(error, '模板下载失败')); }
  }
  function importFile({ file, onSuccess, onError }) {
    Modal.confirm({
      title: '确认批量导入客户',
      content: `将从“${file.name}”批量写入客户数据。系统会校验并跳过重复行，是否继续？`,
      okText: '确认导入', cancelText: '取消',
      onOk: async () => {
        const data = new FormData(); data.append('file', file); if (filters.ownerId) data.append('ownerId', filters.ownerId);
        try {
          const response = await http.post('/customers/import', data);
          onSuccess?.(response.data);
          Modal.info({ title: '导入结果', width: 760, content: <ImportResultContent result={response.data.data} /> });
          await load(1);
        } catch (error) {
          onError?.(error);
          messageApi.error(errorMessage(error, '导入失败'));
          throw error;
        }
      }
    });
  }
  function actions(row) {
    if (scope === 'recycle') return <DangerConfirm buttonText="恢复" title="恢复客户" description="恢复后客户将回到有效归属或进入公海。" onConfirm={() => mutate(() => http.post(`/customers/${row.id}/restore`), '客户已恢复')} />;
    if (scope === 'public') return user.role === 'sales' ? <DangerConfirm buttonText="领取" title="领取公海客户" description={`确认领取“${row.companyName}”到我的私海？`} onConfirm={() => mutate(() => http.post(`/customers/${row.id}/claim`), '领取成功')} /> : <><Button size="small" onClick={() => navigate(`/customers/${row.id}`)}>详情</Button><Button size="small" type="primary" onClick={() => { setAssigning(row); setAssignOwnerId(null); }}>分配</Button></>;
    return <>
      <Button size="small" onClick={() => { setEditing(row); setFormOpen(true); }}>编辑</Button>
      {user.role === 'admin' && <Button size="small" type="primary" onClick={() => { setAssigning(row); setAssignOwnerId(row.ownerId); }}>分配</Button>}
      {row.ownerId && <DangerConfirm buttonText="释放" title="释放客户" reasonRequired onConfirm={reason => mutate(() => http.post(`/customers/${row.id}/release`, { reason }), '客户已释放')} />}
      <DangerConfirm buttonText="删除" title="移入回收站" danger description="客户资料将移入回收站，历史跟进和日志不会删除。" onConfirm={() => mutate(() => http.delete(`/customers/${row.id}`), '客户已移入回收站')} />
    </>;
  }
  const canCreate = scope === 'private' || scope === 'all';
  const canExcel = scope === 'private' || scope === 'all';
  return <>{contextHolder}<div className="page-header"><div><h1>{title}</h1><p>{description}</p></div><Space wrap>
    {canExcel && <><Button icon={<DownloadOutlined />} onClick={template}>下载模板</Button><Upload accept=".xlsx" showUploadList={false} customRequest={importFile}><Button icon={<UploadOutlined />}>导入 Excel</Button></Upload></>}
    {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>新增客户</Button>}
  </Space></div>
  <Card className="filter-card"><CustomerFilters value={filters} onChange={next => { setPagination(value => ({ ...value, page: 1 })); setFilters(next); }} onExport={canExcel ? exportExcel : null} owners={owners} showOwner={user.role === 'admin' && scope === 'all'} /></Card>
  <Card><CustomerTable items={items} loading={loading} pagination={pagination} onPageChange={page => load(page)} renderActions={actions} /></Card>
  <CustomerForm open={formOpen} initialValues={editing} owners={owners} admin={user.role === 'admin'} onCancel={() => { setFormOpen(false); setEditing(null); }} onSubmit={save} />
  <Modal open={Boolean(assigning)} title={`分配客户：${assigning?.companyName || ''}`} okText="确认分配" cancelText="取消" onCancel={() => setAssigning(null)} onOk={async () => {
    if (!assignOwnerId) { messageApi.warning('请选择销售人员'); return; }
    const completed = await mutate(() => http.post(`/customers/${assigning.id}/assign`, { ownerId: assignOwnerId }), '客户分配成功'); if (completed) setAssigning(null);
  }}><p>请选择接收该客户的启用销售账号。</p><Select style={{ width: '100%' }} placeholder="选择销售人员" value={assignOwnerId || undefined} onChange={setAssignOwnerId} options={owners.filter(item => item.isActive).map(item => ({ value: item.id, label: item.displayName }))} /></Modal></>;
}
