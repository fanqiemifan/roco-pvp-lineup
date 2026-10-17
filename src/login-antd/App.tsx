/*
This project uses Ant Design (https://ant.design), licensed under the MIT License.
*/
import React, { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  ConfigProvider,
  Form,
  Input,
  Space,
  Typography,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';

import { loginTheme } from '../theme';

type LoginFormValues = {
  username: string;
  password: string;
};

type AuthCheckResponse = {
  authenticated: boolean;
};

type LoginResponse = {
  success: boolean;
  error?: string;
};

function LoginPage() {
  const [form] = Form.useForm<LoginFormValues>();
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  useEffect(() => {
    let disposed = false;

    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/check');
        if (!response.ok) {
          return;
        }

        const data = await response.json() as AuthCheckResponse;
        if (!disposed && data.authenticated) {
          window.location.href = '/admin.html';
        }
      } catch {
        // Ignore transient network errors and let the user try logging in manually.
      } finally {
        if (!disposed) {
          setCheckingAuth(false);
        }
      }
    }

    void checkAuth();

    return () => {
      disposed = true;
    };
  }, []);

  async function handleSubmit(values: LoginFormValues) {
    setLoading(true);
    setStatus(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: values.username.trim(),
          password: values.password,
        }),
      });

      const data = await response.json() as LoginResponse;

      if (data.success) {
        setStatus({ type: 'success', message: '登录成功，正在跳转到后台...' });
        window.setTimeout(() => {
          window.location.href = '/admin.html';
        }, 400);
        return;
      }

      setStatus({ type: 'error', message: data.error || '登录失败，请检查账号密码' });
      form.setFieldValue('password', '');
      form.focusField('password');
    } catch {
      setStatus({ type: 'error', message: '网络错误，无法连接到服务器' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-glow login-glow-left" />
      <div className="login-glow login-glow-right" />
      <Card bordered={false} className="login-card">
        <Space direction="vertical" size={32} className="login-stack">
          <Space direction="vertical" size={16} className="login-brand">
            <div className="login-brand-mark">PVP</div>
            <Space direction="vertical" size={8}>
              <Typography.Text className="login-eyebrow">Roco Arena Control</Typography.Text>
              <Typography.Title level={2} className="login-title">洛克王国世界阵容同步推流</Typography.Title>
              <Typography.Paragraph className="login-description">
                使用现有管理账号进入直播控制台，配置对阵、面板和实时展示内容。
              </Typography.Paragraph>
            </Space>
          </Space>

          <div className="login-panel-intro">
            <div className="login-panel-copy">
              <span className="login-panel-kicker">管理入口</span>
              <strong>单点会话保护</strong>
              <span>新登录会自动挤掉旧会话，避免直播期间多端状态冲突。</span>
            </div>
            <div className="login-panel-metrics">
              <div>
                <strong>1</strong>
                <span>活动会话</span>
              </div>
              <div>
                <strong>24h</strong>
                <span>登录时效</span>
              </div>
            </div>
          </div>

          <Form<LoginFormValues>
            form={form}
            layout="vertical"
            autoComplete="on"
            requiredMark={false}
            initialValues={{ username: '', password: '' }}
            onFinish={(values) => void handleSubmit(values)}
            className="login-form"
          >
            <Form.Item
              label="账号"
              name="username"
              rules={[{ required: true, message: '请输入管理账号' }]}
            >
              <Input
                size="large"
                placeholder="输入管理账号"
                autoComplete="username"
                autoFocus
                disabled={loading || checkingAuth}
              />
            </Form.Item>

            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入管理密码' }]}
            >
              <Input.Password
                size="large"
                placeholder="输入管理密码"
                autoComplete="current-password"
                disabled={loading || checkingAuth}
              />
            </Form.Item>

            {status ? (
              <Alert
                showIcon
                type={status.type}
                message={status.message}
                className="login-status"
              />
            ) : null}

            <Form.Item className="login-submit-row">
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading || checkingAuth}
              >
                {checkingAuth ? '检查登录状态...' : '进入管理后台'}
              </Button>
            </Form.Item>
          </Form>

          <Typography.Paragraph className="login-footer">
            仅限授权管理员使用，登录后可进入比赛管理、实时配置和预览控制页面。
          </Typography.Paragraph>
        </Space>
      </Card>
    </div>
  );
}

export function LoginApp() {
  return (
    <ConfigProvider locale={zhCN} theme={loginTheme}>
      <App>
        <LoginPage />
      </App>
    </ConfigProvider>
  );
}
