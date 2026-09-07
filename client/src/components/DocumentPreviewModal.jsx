import { useEffect, useState } from 'react';
import { Alert, Modal, Spin } from 'antd';
import { http, errorMessage } from '../api/http.js';

export default function DocumentPreviewModal({ document: item, open, onClose }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !item) return undefined;
    let active = true;
    let objectUrl = '';
    setUrl('');
    setError('');
    http.get(`/documents/${item.id}/preview`, { responseType: 'blob' }).then(response => {
      if (!active) return;
      objectUrl = URL.createObjectURL(response.data);
      setUrl(objectUrl);
    }).catch(requestError => {
      if (active) setError(errorMessage(requestError, '资料预览失败'));
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, item?.id]);

  return <Modal open={open} title={item?.originalName || '资料预览'} footer={null} onCancel={onClose} width="min(1000px, 92vw)" destroyOnHidden>
    <div className="document-preview">
      {error ? <Alert type="error" showIcon message={error} /> : !url ? <Spin size="large" />
        : item?.mimeType?.startsWith('image/')
          ? <img src={url} alt={item.originalName} />
          : <iframe src={url} title="资料预览" />}
    </div>
  </Modal>;
}
