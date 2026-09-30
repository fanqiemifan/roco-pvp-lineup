import type { QuickFillMatch } from '../../../shared/types';
import type { JsonInit } from '../types';

export async function requestJson<T>(url: string, init?: JsonInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.json ? { 'Content-Type': 'application/json' } : null),
      ...(init?.headers ?? {}),
    },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    // 把响应体挂到 Error 上：调用方需要读结构化的附加信息（如改机器码守卫的 guard）
    const payloadForError = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
    const error = new Error(
      typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error?: unknown }).error ?? '请求失败')
        : (typeof payload === 'string' ? payload : `${response.status} 请求失败`),
    );
    Object.assign(error, payloadForError);
    throw error;
  }

  return payload as T;
}

export async function requestQuickFillMatches(text: string): Promise<QuickFillMatch[]> {
  const data = await requestJson<{
    success: boolean;
    matches: QuickFillMatch[];
  }>('/api/quick-fill', {
    method: 'POST',
    json: { text },
  });

  return data.matches;
}

export async function uploadSingleFile<T>(url: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  return requestJson<T>(url, {
    method: 'POST',
    body: formData,
  });
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (window.rocoDesktop?.copyText) {
    await window.rocoDesktop.copyText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}
