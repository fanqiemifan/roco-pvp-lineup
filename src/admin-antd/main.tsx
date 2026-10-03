import React from 'react';
import ReactDOM from 'react-dom/client';
import 'antd/dist/reset.css';

import { AdminApp } from './App';
import './styles.css';

/**
 * 模拟会话入口判定：`?demo=1`（显式）或任意 `?view=` 深链。
 * 深链参数只由「卡片帮助」抽屉发出的 iframe 地址携带，真机后台自己不会带，
 * 所以这里不会把正常访问误判成模拟会话。
 */
function isDemoRequest(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('demo') || params.has('view');
}

/** 初始化：模拟会话必须先装好拦截层，再渲染（首屏请求不能被放出去） */
async function bootstrap(): Promise<void> {
  if (isDemoRequest()) {
    const { bootstrapDemoSession } = await import('./demo/demo-session');
    await bootstrapDemoSession();
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <AdminApp />
    </React.StrictMode>,
  );
}

void bootstrap();
