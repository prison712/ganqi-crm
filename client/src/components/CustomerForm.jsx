import { useEffect } from 'react';
import { Form, Input, Modal, Select } from 'antd';

export default function CustomerForm({ open, initialValues, owners = [], admin = false, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (open) { form.resetFields(); form.setFieldsValue(initialValues || { status: 'potential', ownerId: null }); }
  }, [open, initialValues, form]);
  async function submit() {
    const values = await form.validateFields();
    const completed = await onSubmit(values);
    if (completed !== false) form.resetFields();
  }
  return <Modal open={open} title={initialValues?.id ? '编辑客户' : '新增客户'} okText="保存" cancelText="取消" onCancel={onCancel} onOk={submit} destroyOnHidden>
    <Form form={form} layout="vertical">
      <Form.Item label="公司名称" name="companyName" rules={[{ required: true, whitespace: true, message: '请输入公司名称' }]}><Input maxLength={120} /></Form.Item>
      <div className="form-row"><Form.Item label="联系人" name="contactName"><Input maxLength={80} /></Form.Item><Form.Item label="电话" name="phone"><Input maxLength={40} /></Form.Item></div>
      <Form.Item label="邮箱" name="email" rules={[{ type: 'email', message: '邮箱格式不正确' }]}><Input maxLength={254} /></Form.Item>
      <div className="form-row"><Form.Item label="客户来源" name="source"><Input maxLength={80} /></Form.Item><Form.Item label="客户状态" name="status"><Select options={[{ value: 'potential', label: '潜在' }, { value: 'following', label: '跟进中' }, { value: 'won', label: '已成交' }, { value: 'lost', label: '流失' }]} /></Form.Item></div>
      {admin && !initialValues?.id && <Form.Item label="归属销售" name="ownerId"><Select allowClear placeholder="不选择则进入公海" options={owners.filter(item => item.isActive).map(item => ({ value: item.id, label: item.displayName }))} /></Form.Item>}
      <Form.Item label="备注" name="notes"><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
    </Form>
  </Modal>;
}
