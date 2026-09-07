import { useState } from 'react';
import { Alert, Form, Input, Modal, Select, Table, Tag, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { http, errorMessage } from '../api/http.js';
import { ALLOWED_DOCUMENT_EXTENSIONS, DOCUMENT_CATEGORY_OPTIONS } from '../documents/constants.js';

export function validateDocumentSelection(files) {
  if (!files.length) return '请选择要上传的资料';
  if (files.length > 10) return '单次最多上传 10 个文件';
  const oversized = files.find(file => file.size > 50 * 1024 * 1024);
  if (oversized) return `“${oversized.name}”不能超过 50 MB`;
  const unsupported = files.find(file => !ALLOWED_DOCUMENT_EXTENSIONS.has(file.name.split('.').pop()?.toLowerCase()));
  return unsupported ? `“${unsupported.name}”不是支持的文件格式` : '';
}

export function UploadResultContent({ result }) {
  if (!result) return null;
  return <div className="upload-result">
    <Alert type={result.failed ? 'warning' : 'success'} showIcon title={`成功 ${result.success} 个，失败 ${result.failed} 个`} />
    <Table size="small" rowKey={row => `${row.type}-${row.originalName}`} pagination={false}
      dataSource={result.rows || []} columns={[
        { title: '文件名', dataIndex: 'originalName', render: value => <span className="document-name">{value || '-'}</span> },
        { title: '结果', dataIndex: 'type', width: 80, render: value => <Tag color={value === 'success' ? 'green' : 'red'}>{value === 'success' ? '成功' : '失败'}</Tag> },
        { title: '说明', dataIndex: 'message', render: (value, row) => value || (row.type === 'success' ? '上传成功' : '上传失败') }
      ]} />
  </div>;
}

export default function DocumentUploadModal({ open, onClose, onUploaded }) {
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState([]);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  function reset() {
    form.resetFields();
    setFileList([]);
    setResult(null);
  }

  async function submit() {
    const files = fileList.map(file => file.originFileObj || file);
    const selectionError = validateDocumentSelection(files);
    if (selectionError) return messageApi.error(selectionError);
    let values;
    try { values = await form.validateFields(); } catch { return; }
    const formData = new FormData();
    formData.append('category', values.category);
    formData.append('description', values.description || '');
    files.forEach(file => formData.append('files', file, file.name));
    setSubmitting(true);
    try {
      const response = await http.post('/documents', formData);
      const uploadResult = response.data.data;
      setResult(uploadResult);
      if (uploadResult.success) onUploaded?.();
    } catch (error) {
      messageApi.error(errorMessage(error, '资料上传失败'));
    } finally { setSubmitting(false); }
  }

  return <>{contextHolder}<Modal open={open} title="上传公共资料" okText="开始上传" cancelText="关闭"
    onOk={submit} onCancel={onClose} confirmLoading={submitting} okButtonProps={{ disabled: !fileList.length }}
    afterClose={reset} width={760} destroyOnHidden>
    <Form form={form} layout="vertical" initialValues={{ category: 'other', description: '' }}>
      <Form.Item label="资料分类" name="category" rules={[{ required: true, message: '请选择资料分类' }]}>
        <Select options={DOCUMENT_CATEGORY_OPTIONS} />
      </Form.Item>
      <Form.Item label="资料说明" name="description" rules={[{ max: 500, message: '资料说明不能超过 500 字' }]}>
        <Input.TextArea rows={3} maxLength={500} showCount placeholder="可填写资料用途、版本或适用范围" />
      </Form.Item>
      <Upload.Dragger multiple fileList={fileList} beforeUpload={() => false}
        onChange={({ fileList: next }) => {
          const files = next.map(file => file.originFileObj || file);
          const selectionError = validateDocumentSelection(files);
          if (selectionError) messageApi.warning(selectionError);
          setFileList(next.slice(0, 10));
          setResult(null);
        }}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p>点击或拖拽文件到此处上传</p>
        <p className="ant-upload-hint">每次最多 10 个，单文件最大 50 MB</p>
      </Upload.Dragger>
    </Form>
    <UploadResultContent result={result} />
  </Modal></>;
}
