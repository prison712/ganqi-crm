import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Space, Table, Tag, message } from 'antd';
import { DeleteOutlined, KeyOutlined, PlusOutlined, UserAddOutlined } from '@ant-design/icons';
import { http, errorMessage } from '../api/http.js';
import { useAuth } from '../auth/AuthContext.jsx';
import DangerConfirm from '../components/DangerConfirm.jsx';

const usernameRules = [
  { required: true, message: '请输入登录账号' },
  { pattern: /^[a-zA-Z0-9_]{3,30}$/, message: '仅支持 3-30 位字母、数字或下划线' }
];
const passwordRules = [
  { required: true, message: '请输入密码' },
  { pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/, message: '密码需为 8-128 位，且同时包含字母和数字' }
];

export function UserDisableAction({ user, onToggle }) {
  return <DangerConfirm
    buttonText={user.isActive ? '停用' : '启用'}
    title={user.isActive ? `停用 ${user.displayName}` : `启用 ${user.displayName}`}
    danger={user.isActive}
    description={user.isActive ? '停用后，该销售名下全部客户将自动释放到公海，历史跟进和操作日志仍完整保留。' : '启用后，该销售可以重新登录系统。'}
    onConfirm={() => onToggle(user, !user.isActive)}
  />;
}

export function UserDeleteAction({ user, onDelete }) {
  return <DangerConfirm
    buttonText="删除"
    title={`删除销售账号 ${user.displayName}`}
    danger
    buttonProps={{ icon: <DeleteOutlined /> }}
    description="删除后账号不能登录，名下客户将自动释放到公海；历史跟进和操作日志会完整保留。"
    onConfirm={() => onDelete(user)}
  />;
}

function IdentityTag({ account }) {
  if (account.isSuperAdmin) return <Tag color="gold">超级管理员</Tag>;
  if (account.role === 'admin') return <Tag color="blue">子管理员</Tag>;
  return <Tag color="green">销售</Tag>;
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [createRole, setCreateRole] = useState('sales');
  const [resetUser, setResetUser] = useState(null);
  const [form] = Form.useForm();
  const [resetForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  async function load() {
    setLoading(true);
    try {
      const config = currentUser?.isSuperAdmin ? { params: { includeAdmins: 1 } } : undefined;
      const response = await http.get('/users', config);
      setItems(response.data.data.items);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [currentUser?.isSuperAdmin]);

  function showForm(account = null, role = 'sales') {
    setEditing(account);
    setCreateRole(role);
    form.resetFields();
    if (account) form.setFieldsValue({ username: account.username, displayName: account.displayName });
    setOpen(true);
  }

  async function save() {
    try {
      const values = await form.validateFields();
      if (editing) await http.patch(`/users/${editing.id}`, values);
      else await http.post('/users', { ...values, role: createRole });
      messageApi.success(editing ? '账号已更新' : createRole === 'admin' ? '管理员子账号创建成功' : '销售账号创建成功');
      setOpen(false);
      form.resetFields();
      await load();
    } catch (error) {
      if (!error.errorFields) messageApi.error(errorMessage(error));
    }
  }

  async function toggle(account, isActive) {
    try {
      await http.post(`/users/${account.id}/toggle-active`, { isActive });
      messageApi.success(isActive ? '账号已启用' : '账号已停用，客户已释放');
      await load();
      return true;
    } catch (error) {
      messageApi.error(errorMessage(error));
      return false;
    }
  }

  async function remove(account) {
    try {
      await http.delete(`/users/${account.id}`);
      messageApi.success('销售账号已删除，客户已释放');
      await load();
      return true;
    } catch (error) {
      messageApi.error(errorMessage(error));
      return false;
    }
  }

  async function resetPassword() {
    try {
      const { password } = await resetForm.validateFields();
      await http.post(`/users/${resetUser.id}/reset-password`, { password });
      messageApi.success('密码重置成功');
      setResetUser(null);
      resetForm.resetFields();
    } catch (error) {
      if (!error.errorFields) messageApi.error(errorMessage(error));
    }
  }

  const columns = [
    { title: '显示姓名', dataIndex: 'displayName' },
    { title: '登录账号', dataIndex: 'username' },
    { title: '账号身份', key: 'identity', render: (_, account) => <IdentityTag account={account} /> },
    { title: '状态', dataIndex: 'isActive', render: value => <Tag color={value ? 'green' : 'default'}>{value ? '已启用' : '已停用'}</Tag> },
    {
      title: '操作',
      render: (_, account) => account.role === 'sales' ? <Space wrap>
        <Button onClick={() => showForm(account)}>编辑</Button>
        <Button icon={<KeyOutlined />} onClick={() => setResetUser(account)}>重置密码</Button>
        <UserDisableAction user={account} onToggle={toggle} />
        <UserDeleteAction user={account} onDelete={remove} />
      </Space> : <Tag>管理员账号受保护</Tag>
    }
  ];

  const dialogRole = editing?.role || createRole;
  return <>
    {contextHolder}
    <div className="page-header">
      <div><h1>账号管理</h1><p>维护销售账号和管理员身份；删除销售账号会保留全部历史记录。</p></div>
      <Space wrap>
        {currentUser?.isSuperAdmin && <Button icon={<UserAddOutlined />} onClick={() => showForm(null, 'admin')}>新增管理员</Button>}
        <Button type="primary" icon={<PlusOutlined />} onClick={() => showForm(null, 'sales')}>新增销售</Button>
      </Space>
    </div>
    <Card><Table rowKey="id" loading={loading} dataSource={items} columns={columns} scroll={{ x: 860 }} pagination={false} /></Card>
    <Modal open={open} title={editing ? '编辑销售账号' : dialogRole === 'admin' ? '新增管理员子账号' : '新增销售账号'}
      okText="保存" cancelText="取消" onOk={save} onCancel={() => setOpen(false)} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item label="登录账号" name="username" rules={usernameRules}><Input autoComplete="username" /></Form.Item>
        {!editing && <Form.Item label="初始密码" name="password" rules={passwordRules}><Input.Password autoComplete="new-password" /></Form.Item>}
        <Form.Item label="显示姓名" name="displayName" rules={[{ required: true, whitespace: true, message: '请输入显示姓名' }, { max: 50, message: '显示姓名不能超过 50 字' }]}><Input /></Form.Item>
      </Form>
    </Modal>
    <Modal open={Boolean(resetUser)} title={`重置 ${resetUser?.displayName || ''} 的密码`} okText="确认重置"
      cancelText="取消" onOk={resetPassword} onCancel={() => setResetUser(null)} destroyOnHidden>
      <Form form={resetForm} layout="vertical">
        <Form.Item label="新密码" name="password" rules={passwordRules}><Input.Password autoComplete="new-password" /></Form.Item>
      </Form>
    </Modal>
  </>;
}
