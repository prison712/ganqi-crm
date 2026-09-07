import { useEffect, useState } from 'react';
import { Card, Input, Select, Space, Table, Tag, message } from 'antd';
import dayjs from 'dayjs';
import { http, errorMessage } from '../api/http.js';
import DangerConfirm from '../components/DangerConfirm.jsx';
import { categoryName, DOCUMENT_CATEGORY_OPTIONS, formatFileSize } from '../documents/constants.js';

export default function DocumentRecycleBinPage() {
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ keyword: '', category: '' });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 });
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  async function load(page = 1, pageSize = pagination.pageSize, nextFilters = filters) {
    setLoading(true);
    try {
      const response = await http.get('/documents/recycle', { params: { ...nextFilters, page, pageSize } });
      setItems(response.data.data.items);
      setPagination(response.data.data.pagination);
    } catch (error) { messageApi.error(errorMessage(error, '资料回收站加载失败')); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const timer = setTimeout(() => load(1, pagination.pageSize, filters), 250);
    return () => clearTimeout(timer);
  }, [filters]);

  async function act(item, action) {
    try {
      if (action === 'restore') await http.post(`/documents/${item.id}/restore`);
      else await http.delete(`/documents/${item.id}/purge`);
      messageApi.success(action === 'restore' ? '资料已恢复' : '资料已彻底删除');
      await load(items.length === 1 && pagination.page > 1 ? pagination.page - 1 : pagination.page);
    } catch (error) {
      messageApi.error(errorMessage(error));
      return false;
    }
  }

  const columns = [
    { title: '资料名称', dataIndex: 'originalName', width: 220, render: value => <span className="document-name">{value}</span> },
    { title: '分类', dataIndex: 'category', width: 110, render: value => <Tag>{categoryName(value)}</Tag> },
    { title: '大小', dataIndex: 'sizeBytes', width: 100, render: formatFileSize },
    { title: '原上传人', dataIndex: 'uploaderName', width: 120 },
    { title: '删除人', key: 'deletedBy', width: 120, render: (_, row) => row.deletedByName || (row.deletedBy ? `账号 #${row.deletedBy}` : '-') },
    { title: '上传时间', dataIndex: 'createdAt', width: 160, render: value => dayjs(value).format('YYYY-MM-DD HH:mm') },
    { title: '删除时间', dataIndex: 'deletedAt', width: 160, render: value => dayjs(value).format('YYYY-MM-DD HH:mm') },
    { title: '操作', key: 'actions', width: 190, fixed: 'right', render: (_, row) => <Space>
      <DangerConfirm buttonText="恢复" buttonProps={{ size: 'small' }} title="确认恢复资料？" description="恢复后资料将重新出现在公共资料列表中。" onConfirm={() => act(row, 'restore')} />
      <DangerConfirm buttonText="彻底删除" danger buttonProps={{ size: 'small' }} title="确认彻底删除？" description="文件将从磁盘移除且不可恢复，操作日志仍会保留。" onConfirm={() => act(row, 'purge')} />
    </Space> }
  ];

  return <>{contextHolder}<div className="page-header"><div><h1>资料回收站</h1><p>仅管理员可见，可恢复或彻底删除公共资料。</p></div></div>
    <Card className="filter-card"><div className="toolbar">
      <Input allowClear placeholder="搜索资料名称或说明" value={filters.keyword} style={{ width: 240 }} onChange={event => setFilters(value => ({ ...value, keyword: event.target.value }))} />
      <Select allowClear placeholder="资料分类" value={filters.category || undefined} style={{ width: 150 }} options={DOCUMENT_CATEGORY_OPTIONS} onChange={category => setFilters(value => ({ ...value, category: category || '' }))} />
    </div></Card>
    <Card><Table rowKey="id" loading={loading} dataSource={items} columns={columns} scroll={{ x: 1200 }} pagination={{ current: pagination.page, pageSize: pagination.pageSize, total: pagination.total, onChange: (page, pageSize) => load(page, pageSize) }} /></Card>
  </>;
}
