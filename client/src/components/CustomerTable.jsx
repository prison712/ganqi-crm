import { Button, Space, Table, Tag } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';

const statusMap = { potential: ['潜在', 'blue'], following: ['跟进中', 'orange'], won: ['已成交', 'green'], lost: ['流失', 'default'] };

export default function CustomerTable({ items, loading, pagination, onPageChange, renderActions }) {
  const columns = [
    { title: '公司名称', dataIndex: 'companyName', fixed: 'left', width: 190, render: (value, row) => <Link to={`/customers/${row.id}`}>{value}</Link> },
    { title: '联系人', dataIndex: 'contactName', width: 110 },
    { title: '电话', dataIndex: 'phone', width: 140 },
    { title: '来源', dataIndex: 'source', width: 100 },
    { title: '状态', dataIndex: 'status', width: 100, render: value => <Tag color={statusMap[value]?.[1]}>{statusMap[value]?.[0] || value}</Tag> },
    { title: '归属销售', dataIndex: 'ownerName', width: 110, render: value => value || <Tag>公海</Tag> },
    { title: '最后跟进', dataIndex: 'lastFollowedAt', width: 160, render: value => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '暂无' },
    { title: '操作', key: 'actions', fixed: 'right', width: 260, render: (_, row) => <Space wrap>{renderActions?.(row) || <Button size="small"><Link to={`/customers/${row.id}`}>详情</Link></Button>}</Space> }
  ];
  return <Table rowKey="id" loading={loading} columns={columns} dataSource={items} scroll={{ x: 1100 }} pagination={{ current: pagination.page, pageSize: pagination.pageSize, total: pagination.total, showTotal: total => `共 ${total} 条`, onChange: onPageChange }} />;
}
