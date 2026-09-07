import { useEffect, useState } from 'react';
import { Card, Empty, List, Skeleton, Statistic, Typography, message } from 'antd';
import { TeamOutlined, GlobalOutlined, UserAddOutlined, PhoneOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { http, errorMessage } from '../api/http.js';
import { useAuth } from '../auth/AuthContext.jsx';

const operationNames = { claim: '领取客户', release: '释放客户', assign: '分配客户', import: '导入客户', soft_delete: '删除客户', restore: '恢复客户', account_created: '新增账号', account_updated: '编辑账号', password_reset: '重置密码', password_changed: '修改密码', account_disabled: '停用账号', account_enabled: '启用账号', account_deleted: '删除账号', document_upload: '上传资料', document_delete: '删除资料', document_restore: '恢复资料', document_purge: '彻底删除资料' };

export function recentTitle(item) {
  return item.company_name || item.customer_name || operationNames[item.action] || item.action;
}

export function DashboardCards({ role, stats }) {
  const cards = role === 'admin' ? [
    ['今日全局新增', stats.todayNew, <UserAddOutlined />], ['全员私海', stats.privateTotal, <TeamOutlined />],
    ['公海客户', stats.publicTotal, <GlobalOutlined />], ['本周全员跟进', stats.weeklyFollowUps, <PhoneOutlined />]
  ] : [
    ['今日我的新增', stats.todayNew, <UserAddOutlined />], ['我的私海', stats.privateTotal, <TeamOutlined />],
    ['公海客户', stats.publicTotal, <GlobalOutlined />], ['本周我的跟进', stats.weeklyFollowUps, <PhoneOutlined />]
  ];
  return <div className="stat-grid">{cards.map(([title, value, icon]) => <Card key={title} className="stat-card"><Statistic title={title} value={value || 0} prefix={icon} /></Card>)}</div>;
}

export default function DashboardPage() {
  const { user } = useAuth(); const [stats, setStats] = useState(null); const [messageApi, contextHolder] = message.useMessage();
  useEffect(() => { http.get('/dashboard/stats').then(response => setStats(response.data.data)).catch(error => messageApi.error(errorMessage(error, '看板加载失败'))); }, []);
  return <>{contextHolder}<div className="page-header"><div><h1>数据看板</h1><p>{user.role === 'admin' ? '掌握团队客户资产与销售活动概况' : `欢迎回来，${user.displayName}，这是属于您的销售数据`}</p></div></div>
    {!stats ? <Skeleton active /> : <><DashboardCards role={user.role} stats={stats} /><Card title={user.role === 'admin' ? '最近全局操作' : '我的最近跟进'}>{stats.recent?.length ? <List dataSource={stats.recent} renderItem={item => <List.Item><div className="recent-item"><Typography.Text strong>{recentTitle(item)}</Typography.Text><Typography.Text type="secondary">{item.content || `${item.actor_name || ''} · ${dayjs(item.created_at || item.followed_at).format('YYYY-MM-DD HH:mm')}`}</Typography.Text></div></List.Item>} /> : <Empty description="暂无动态" />}</Card></>}
  </>;
}
