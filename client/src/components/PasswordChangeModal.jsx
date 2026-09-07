import { Form, Input, Modal, Typography } from 'antd';

const passwordRule = {
  pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/,
  message: '密码需为 8-128 位，且同时包含字母和数字'
};

export default function PasswordChangeModal({ open, forced = false, loading = false, onSubmit, onCancel }) {
  const [form] = Form.useForm();

  async function submit() {
    try {
      const values = await form.validateFields();
      await onSubmit(values);
    } catch (error) {
      if (!error?.errorFields) throw error;
    }
  }

  return <Modal
    open={open}
    closable={!forced}
    mask={{ closable: !forced }}
    keyboard={!forced}
    title={forced ? '首次登录，请修改默认密码' : '修改登录密码'}
    okText={forced ? '保存新密码' : '确认修改'}
    cancelText="取消"
    cancelButtonProps={forced ? { style: { display: 'none' } } : undefined}
    confirmLoading={loading}
    onOk={submit}
    onCancel={onCancel}
    afterClose={() => form.resetFields()}
  >
    <Typography.Paragraph type="secondary">
      {forced ? '为保障系统安全，修改初始密码后方可继续使用。' : '请输入当前密码，新密码需同时包含字母和数字。'}
    </Typography.Paragraph>
    <Form form={form} layout="vertical">
      <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, passwordRule]}>
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']} rules={[
        { required: true, message: '请再次输入新密码' },
        ({ getFieldValue }) => ({
          validator(_, value) {
            return !value || getFieldValue('newPassword') === value
              ? Promise.resolve()
              : Promise.reject(new Error('两次输入的新密码不一致'));
          }
        })
      ]}>
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </Form>
  </Modal>;
}
