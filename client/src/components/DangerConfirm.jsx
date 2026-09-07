import { useState } from 'react';
import { Button, Form, Input, Modal, Typography } from 'antd';

export default function DangerConfirm({ buttonText, title, description, reasonRequired = false, onConfirm, danger = false, buttonProps = {} }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  async function confirm() {
    let values = {};
    try {
      values = reasonRequired ? await form.validateFields() : {};
    } catch (validationError) {
      if (validationError?.errorFields) return;
      throw validationError;
    }
    setLoading(true);
    try {
      const completed = await onConfirm?.(values.reason || '');
      if (completed === false) return;
      setOpen(false);
      if (reasonRequired) form.resetFields();
    } catch { return; }
    finally { setLoading(false); }
  }
  return <>
    <Button aria-label={buttonText} danger={danger} {...buttonProps} onClick={() => setOpen(true)}>{buttonText}</Button>
    <Modal open={open} title={title} okText={reasonRequired ? '确认释放' : '确认'} cancelText="取消" confirmLoading={loading} okButtonProps={{ danger, 'aria-label': reasonRequired ? '确认释放' : '确认' }} onCancel={() => setOpen(false)} onOk={confirm} destroyOnHidden>
      {description && <Typography.Paragraph>{description}</Typography.Paragraph>}
      {reasonRequired && <Form form={form} layout="vertical"><Form.Item label="释放原因" name="reason" rules={[{ required: true, whitespace: true, message: '请输入释放原因' }, { min: 2, max: 200, message: '请输入 2-200 字的释放原因' }]}><Input.TextArea rows={4} placeholder="请说明客户释放原因" /></Form.Item></Form>}
    </Modal>
  </>;
}
