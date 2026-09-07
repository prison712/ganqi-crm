export function filenameFromDisposition(value, fallbackName) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value || '')?.[1];
  if (!encoded) return fallbackName;
  try { return decodeURIComponent(encoded); } catch { return fallbackName; }
}

export function downloadResponse(response, fallbackName) {
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFromDisposition(response.headers?.['content-disposition'], fallbackName);
  link.click();
  URL.revokeObjectURL(url);
}
