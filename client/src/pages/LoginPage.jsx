import { useEffect } from 'react';
import { Alert, Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../api/http.js';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [messageApi, contextHolder] = message.useMessage();
  useEffect(() => { if (user) navigate('/', { replace: true }); }, [user, navigate]);
  async function submit(values) {
    try {
      await login(values.username, values.password);
      const returnUrl = sessionStorage.getItem('loginReturnUrl') || '/';
      sessionStorage.removeItem('loginReturnUrl');
      navigate(returnUrl, { replace: true });
    } catch (error) { messageApi.error(errorMessage(error, '登录失败')); }
  }
  return <div className="login-page">{contextHolder}<div className="login-brand"><img className="login-logo" src="/company-logo.png" alt="公司Logo" /><h1>集团销售客户管理 CRM</h1><p>连接客户、销售与增长，让每一次跟进都有价值</p></div><Card className="login-card">
    <Typography.Title level={2}>欢迎登录</Typography.Title><Typography.Paragraph type="secondary">请输入您的账号和密码</Typography.Paragraph>
    {location.search.includes('expired=1') && <Alert type="warning" showIcon message="登录已过期，请重新登录" />}
    <Form layout="vertical" onFinish={submit} initialValues={{ username: 'admin' }}>
      <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}><Input size="large" prefix={<UserOutlined />} /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password size="large" prefix={<LockOutlined />} /></Form.Item>
      <Button type="primary" htmlType="submit" size="large" block>登录系统</Button>
    </Form><div className="login-hint">初始管理员：admin / admin123</div>
  </Card></div>;
}
