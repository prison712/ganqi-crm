import { Button, Input, Select } from 'antd';
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';

export default function CustomerFilters({ value, onChange, onExport, owners = [], showOwner = false }) {
  const update = patch => onChange?.({ ...value, ...patch });
  return <div className="toolbar">
    <Input allowClear prefix={<SearchOutlined />} placeholder="搜索公司、联系人、电话或邮箱" value={value.keyword} onChange={event => update({ keyword: event.target.value })} style={{ width: 290 }} />
    <Select aria-label="客户状态" allowClear placeholder="客户状态" value={value.status || undefined} onChange={status => update({ status: status || '' })} style={{ width: 130 }} options={[
      { value: 'potential', label: '潜在' }, { value: 'following', label: '跟进中' }, { value: 'won', label: '已成交' }, { value: 'lost', label: '流失' }
    ]} />
    <Input allowClear placeholder="客户来源" value={value.source} onChange={event => update({ source: event.target.value })} style={{ width: 150 }} />
    {showOwner && <Select allowClear placeholder="归属销售" value={value.ownerId || undefined} onChange={ownerId => update({ ownerId: ownerId || '' })} style={{ width: 150 }} options={owners.map(owner => ({ value: owner.id, label: owner.displayName }))} />}
    {onExport && <Button aria-label="导出 Excel" icon={<DownloadOutlined />} onClick={() => onExport(value)}>导出 Excel</Button>}
  </div>;
}
