import { useEffect, useState } from 'react';
import { Button, Card, Input, Select, Space, Table, Tag, message } from 'antd';
import { DownloadOutlined, EyeOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { http, errorMessage } from '../api/http.js';
import { downloadResponse } from '../api/files.js';
import { useAuth } from '../auth/AuthContext.jsx';
import DangerConfirm from '../components/DangerConfirm.jsx';
import DocumentPreviewModal from '../components/DocumentPreviewModal.jsx';
import DocumentUploadModal from '../components/DocumentUploadModal.jsx';
import { categoryName, DOCUMENT_CATEGORY_OPTIONS, formatFileSize } from '../documents/constants.js';

export default function DocumentsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ keyword: '', category: '', uploaderId: '' });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 });
  const [uploaders, setUploaders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewing, setPreviewing] = useState(null);
  const [messageApi, contextHolder] = message.useMessage();

  async function load(page = 1, pageSize = pagination.pageSize, nextFilters = filters) {
    setLoading(true);
    try {
      const response = await http.get('/documents', { params: { ...nextFilters, page, pageSize } });
      setItems(response.data.data.items);
      setPagination(response.data.data.pagination);
      setUploaders(response.data.data.facets?.uploaders || []);
    } catch (error) { messageApi.error(errorMessage(error, '公共资料加载失败')); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const timer = setTimeout(() => load(1, pagination.pageSize, filters), 250);
    return () => clearTimeout(timer);
  }, [filters]);

  async function download(item) {
    try {
      const response = await http.get(`/documents/${item.id}/download`, { responseType: 'blob' });
      downloadResponse(response, item.originalName);
    } catch (error) { messageApi.error(errorMessage(error, '资料下载失败')); }
  }

  async function remove(item) {
    try {
      await http.delete(`/documents/${item.id}`);
      messageApi.success('资料已移入回收站');
      await load(items.length === 1 && pagination.page > 1 ? pagination.page - 1 : pagination.page);
    } catch (error) {
      messageApi.error(errorMessage(error, '资料删除失败'));
      return false;
    }
  }

  const columns = [
    { title: '资料名称', dataIndex: 'originalName', width: 220, render: value => <span className="document-name">{value}</span> },
    { title: '分类', dataIndex: 'category', width: 110, render: value => <Tag color="blue">{categoryName(value)}</Tag> },
    { title: '说明', dataIndex: 'description', width: 220, render: value => value || '-' },
    { title: '类型 / 大小', key: 'type', width: 130, render: (_, row) => `${row.extension?.toUpperCase() || '-'} · ${formatFileSize(row.sizeBytes)}` },
    { title: '上传人', dataIndex: 'uploaderName', width: 120 },
    { title: '上传时间', dataIndex: 'createdAt', width: 160, render: value => dayjs(value).format('YYYY-MM-DD HH:mm') },
    { title: '操作', key: 'actions', width: 230, fixed: 'right', render: (_, row) => <Space wrap>
      {row.previewable ? <Button size="small" aria-label="预览" icon={<EyeOutlined />} onClick={() => setPreviewing(row)}>预览</Button> : null}
      <Button size="small" aria-label="下载" icon={<DownloadOutlined />} onClick={() => download(row)}>下载</Button>
      {user?.role === 'admin' || Number(row.uploadedBy) === Number(user?.id) ? <DangerConfirm buttonText="删除" danger
        buttonProps={{ size: 'small' }} title="确认删除资料？" description="资料将移入回收站，管理员可以恢复。" onConfirm={() => remove(row)} /> : null}
    </Space> }
  ];

  return <>{contextHolder}<div className="page-header"><div><h1>公共资料</h1><p>全员共享制度、产品、销售工具和培训资料。</p></div>
    <Button type="primary" aria-label="上传资料" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传资料</Button></div>
    <Card className="filter-card"><div className="toolbar">
      <Input allowClear placeholder="搜索资料名称或说明" value={filters.keyword} style={{ width: 240 }} onChange={event => setFilters(value => ({ ...value, keyword: event.target.value }))} />
      <Select aria-label="资料分类" allowClear placeholder="资料分类" value={filters.category || undefined} style={{ width: 150 }} options={DOCUMENT_CATEGORY_OPTIONS} onChange={category => setFilters(value => ({ ...value, category: category || '' }))} />
      <Select aria-label="上传人" allowClear showSearch optionFilterProp="label" placeholder="上传人" value={filters.uploaderId || undefined} style={{ width: 150 }} options={uploaders.map(item => ({ value: item.id, label: item.displayName }))} onChange={uploaderId => setFilters(value => ({ ...value, uploaderId: uploaderId || '' }))} />
    </div></Card>
    <Card><Table rowKey="id" loading={loading} dataSource={items} columns={columns} scroll={{ x: 1200 }}
      pagination={{ current: pagination.page, pageSize: pagination.pageSize, total: pagination.total, showSizeChanger: true, onChange: (page, pageSize) => load(page, pageSize) }} /></Card>
    <DocumentUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => load(1)} />
    <DocumentPreviewModal document={previewing} open={Boolean(previewing)} onClose={() => setPreviewing(null)} />
  </>;
}
