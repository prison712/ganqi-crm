import { useEffect, useState } from 'react';
import { Card, DatePicker, Input, Select, Table, Tag, message } from 'antd';
import dayjs from 'dayjs';
import { http, errorMessage } from '../api/http.js';
import { categoryName, formatFileSize } from '../documents/constants.js';

const actionNames = { claim: '领取', release: '释放', assign: '分配', import: '导入', soft_delete: '软删除', restore: '恢复', account_created: '新增账号', account_updated: '编辑账号', password_reset: '重置密码', password_changed: '修改密码', account_disabled: '停用账号', account_enabled: '启用账号', account_deleted: '删除账号', document_upload: '上传资料', document_delete: '删除资料', document_restore: '恢复资料', document_purge: '彻底删除资料' };
export function operationActionName(action) { return actionNames[action] || action; }

function detailText(value) {
  if (value?.originalName) return `${value.originalName} · ${categoryName(value.category)} · ${formatFileSize(value.sizeBytes)}`;
  return value?.reason || (value?.filename ? `${value.filename}：成功 ${value.success} 条` : JSON.stringify(value || {}));
}
export default function OperationLogsPage() {
  const [items, setItems] = useState([]); const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 }); const [filters, setFilters] = useState({ action: '', actor: '', startDate: '', endDate: '' }); const [loading, setLoading] = useState(false); const [messageApi, contextHolder] = message.useMessage();
  async function load(page = 1, next = filters) { setLoading(true); try { const response = await http.get('/operation-logs', { params: { ...next, page, pageSize: 20 } }); setItems(response.data.data.items); setPagination(response.data.data.pagination); } catch (error) { messageApi.error(errorMessage(error)); } finally { setLoading(false); } }
  useEffect(() => { const timer = setTimeout(() => load(1, filters), 250); return () => clearTimeout(timer); }, [filters]);
  const columns = [
    { title: '操作时间', dataIndex: 'created_at', width: 170, render: value => dayjs(value).format('YYYY-MM-DD HH:mm:ss') },
    { title: '操作人', dataIndex: 'actor_name', width: 120 }, { title: '动作', dataIndex: 'action', width: 130, render: value => <Tag color="orange">{operationActionName(value)}</Tag> },
    { title: '客户', dataIndex: 'customer_name', width: 180, render: value => value || '-' },
    { title: '归属变更', key: 'ownership', width: 210, render: (_, row) => ['claim', 'release', 'assign'].includes(row.action)
      ? `${row.from_owner_name || '公海'} → ${row.to_owner_name || '公海'}` : '-' },
    { title: '详情', dataIndex: 'details', render: detailText }
  ];
  return <>{contextHolder}<div className="page-header"><div><h1>操作日志</h1><p>查看领取、释放、分配、导入和账号管理等关键审计记录。</p></div></div><Card className="filter-card"><div className="toolbar"><Select allowClear placeholder="操作类型" style={{ width: 150 }} value={filters.action || undefined} onChange={action => setFilters(value => ({ ...value, action: action || '' }))} options={Object.entries(actionNames).map(([value, label]) => ({ value, label }))} /><Input allowClear placeholder="操作人" style={{ width: 180 }} value={filters.actor} onChange={event => setFilters(value => ({ ...value, actor: event.target.value }))} /><DatePicker.RangePicker allowClear value={filters.startDate ? [dayjs(filters.startDate), dayjs(filters.endDate)] : null} onChange={dates => setFilters(value => ({ ...value, startDate: dates?.[0]?.startOf('day').toISOString() || '', endDate: dates?.[1]?.endOf('day').toISOString() || '' }))} /></div></Card><Card><Table rowKey="id" loading={loading} dataSource={items} columns={columns} scroll={{ x: 1100 }} pagination={{ current: pagination.page, pageSize: pagination.pageSize, total: pagination.total, onChange: page => load(page) }} /></Card></>;
}
