import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, Space, Tag, Timeline, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { http, errorMessage } from '../api/http.js';

const statusNames = { potential: '潜在', following: '跟进中', won: '已成交', lost: '流失' };
export default function CustomerDetailPage() {
  const { id } = useParams(); const navigate = useNavigate();
  const [customer, setCustomer] = useState(null); const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('');
  const [form] = Form.useForm(); const [messageApi, contextHolder] = message.useMessage();
  async function load() {
    setLoading(true); setLoadError('');
    try {
      const customerResponse = await http.get(`/customers/${id}`); setCustomer(customerResponse.data.data.customer);
      try { const followResponse = await http.get(`/customers/${id}/follow-ups`); setFollowUps(followResponse.data.data.items); } catch { setFollowUps([]); }
    } catch (error) { setCustomer(null); setLoadError(errorMessage(error, '客户详情加载失败')); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);
  async function add(values) {
    try { await http.post(`/customers/${id}/follow-ups`, { ...values, followedAt: new Date().toISOString() }); form.resetFields(); messageApi.success('跟进记录已添加'); await load(); }
    catch (error) { messageApi.error(errorMessage(error)); }
  }
  if (loading) return <>{contextHolder}<Card loading /></>;
  if (loadError) return <>{contextHolder}<Card><Alert type="error" showIcon message="无法打开客户详情" description={loadError} action={<Button onClick={() => navigate(-1)}>返回上一页</Button>} /></Card></>;
  return <>{contextHolder}<div className="page-header"><div><Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button><h1>{customer.companyName}</h1><p>客户详情与完整跟进历史</p></div><Tag color="orange">{statusNames[customer.status]}</Tag></div>
    <div className="detail-grid"><Card title="客户资料"><Descriptions column={{ xs: 1, md: 2 }} items={[
      { key: 'contact', label: '联系人', children: customer.contactName || '未填写' }, { key: 'phone', label: '电话', children: customer.phone || '未填写' },
      { key: 'email', label: '邮箱', children: customer.email || '未填写' }, { key: 'source', label: '来源', children: customer.source || '未填写' },
      { key: 'owner', label: '归属', children: customer.ownerName || '公海' }, { key: 'last', label: '最后跟进', children: customer.lastFollowedAt ? dayjs(customer.lastFollowedAt).format('YYYY-MM-DD HH:mm') : '暂无' },
      { key: 'notes', label: '备注', span: 2, children: customer.notes || '暂无备注' }
    ]} /></Card><Card title="新增跟进"><Form form={form} layout="vertical" onFinish={add}><Form.Item label="跟进内容" name="content" rules={[{ required: true, message: '请输入跟进内容' }]}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item><Form.Item label="下一步计划" name="nextPlan"><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item><Button type="primary" htmlType="submit">保存跟进</Button></Form></Card></div>
    <Card title="跟进历史" style={{ marginTop: 18 }}>{followUps.length ? <Timeline items={followUps.map(item => ({ color: 'orange', children: <div><Space><Typography.Text strong>{item.authorName}</Typography.Text><Typography.Text type="secondary">{dayjs(item.followedAt).format('YYYY-MM-DD HH:mm')}</Typography.Text></Space><p>{item.content}</p>{item.nextPlan && <p><strong>下一步：</strong>{item.nextPlan}</p>}</div> }))} /> : <Empty description="暂无跟进记录" />}</Card></>;
}
