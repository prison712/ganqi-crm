export const DOCUMENT_CATEGORY_OPTIONS = [
  { value: 'policy', label: '制度文件' },
  { value: 'product', label: '产品资料' },
  { value: 'sales_tool', label: '销售工具' },
  { value: 'training', label: '培训资料' },
  { value: 'other', label: '其他' }
];

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'zip'
]);

export function categoryName(value) {
  return DOCUMENT_CATEGORY_OPTIONS.find(item => item.value === value)?.label || value;
}

export function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
