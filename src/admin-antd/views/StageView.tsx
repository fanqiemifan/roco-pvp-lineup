import React, { useEffect, useState } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Col,
  Input,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';

import type { Page9State } from '../../../shared/types';
import { useAdminData } from '../data/use-admin-data';
import { PAGE9_TEAM_COUNT, STAGE_OPTIONS } from '../constants';
import { copyText, requestJson } from '../lib/request';
import type { NoticeState } from '../types';
import { Hint } from '../ui/Hint';
import { StageThumb } from '../components/StageThumb';

const { Paragraph, Text } = Typography;

type Page9TeamDraft = { name: string; r1: string; r2: string; r3: string };

function emptyPage9Teams(): Page9TeamDraft[] {
  return Array.from({ length: PAGE9_TEAM_COUNT }, () => ({ name: '', r1: '', r2: '', r3: '' }));
}

/**
 * 直播推流（M4 从 App.tsx 拆出）：画面卡片 + 团队积分榜（page9）设置。
 * 画面切换走数据层 saveStage；page9 草稿/保存是本视图状态。
 */
export function StageView(): React.ReactElement {
  const { message } = App.useApp();
  const { stage, page9, profiles, saveStage, applyServerState } = useAdminData();
  const [page9TitleDraft, setPage9TitleDraft] = useState('');
  const [page9TeamsDraft, setPage9TeamsDraft] = useState<Page9TeamDraft[]>(emptyPage9Teams);
  const [page9Saving, setPage9Saving] = useState(false);
  const [page9SettingsNotice, setPage9SettingsNotice] = useState<NoticeState>(null);

  // 以服务端数据回填草稿行，不足 PAGE9_TEAM_COUNT 行则补空行
  useEffect(() => {
    setPage9TitleDraft(page9?.title ?? '');
    const serverTeams = Array.isArray(page9?.teams) ? page9.teams : [];
    setPage9TeamsDraft(
      Array.from({ length: PAGE9_TEAM_COUNT }, (_, index) => {
        const team = serverTeams[index];
        return {
          name: team?.name ?? '',
          r1: team?.r1 ?? '',
          r2: team?.r2 ?? '',
          r3: team?.r3 ?? '',
        };
      }),
    );
  }, [page9?.title, page9?.teams]);

  // 更新团队积分榜某一行的某个字段（战队名称 / R1 / R2 / R3；积分仅允许数字）
  function updatePage9TeamDraft(rowIndex: number, field: keyof Page9TeamDraft, value: string) {
    const nextValue = field === 'name' ? value : value.replace(/\D/g, '');
    setPage9TeamsDraft((prev) => prev.map((team, index) => (
      index === rowIndex ? { ...team, [field]: nextValue } : team
    )));
  }

  async function savePage9Settings() {
    setPage9Saving(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page9State }>('/api/page9', {
        method: 'POST',
        json: {
          title: page9TitleDraft,
          teams: page9TeamsDraft,
        },
      });
      applyServerState({ page9: data.state });
      setPage9SettingsNotice({ tone: 'success', text: '团队积分榜设置已保存，预览已更新' });
      message.success('团队积分榜设置已保存');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      message.error(text);
      setPage9SettingsNotice({ tone: 'error', text });
    } finally {
      setPage9Saving(false);
    }
  }

  async function handleCopyStageLocalAddress() {
    const host = window.location.port ? `127.0.0.1:${window.location.port}` : '127.0.0.1';
    try {
      await copyText(`${host}/`);
      message.success('推流页地址已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Card
        className="stage-control-card"
        title="推流画面"
        extra={
          <Space wrap>
            <Button href="/" target="_blank">打开推流页面</Button>
            <Button onClick={handleCopyStageLocalAddress}>复制推流页地址</Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} className="page-stack">
          <Row gutter={[16, 16]}>
            {STAGE_OPTIONS.map((option) => {
              const active = (stage?.page ?? null) === option.value;
              return (
                <Col xs={24} sm={12} md={8} key={option.value}>
                  <Card
                    size="small"
                    hoverable
                    className={`stage-card ${active ? 'stage-card-active' : ''}`}
                    onClick={() => void saveStage(option.value)}
                  >
                    <Space direction="vertical" size={6} className="page-stack" style={{ width: '100%' }}>
                      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                        <Text strong>{option.label}</Text>
                        {active ? <Tag color="green">当前画面</Tag> : null}
                      </Space>
                      <Hint>{option.description}</Hint>
                      <StageThumb label={option.label} previewPath={option.previewPath} />
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
          <Row gutter={[16, 16]} className="stage-config-cards">
            <Col xs={24}>
              <Card
                size="small"
                className="subtle-card stage-settings-card"
                title="团队积分榜设置（推流页面9）"
                extra={(
                  <Button type="primary" loading={page9Saving} onClick={() => void savePage9Settings()}>
                    保存页面9设置
                  </Button>
                )}
              >
                <Space direction="vertical" size={12} className="page-stack" style={{ width: '100%' }}>
                  {page9SettingsNotice ? (
                    <Alert
                      showIcon
                      closable
                      type={page9SettingsNotice.tone}
                      message={page9SettingsNotice.text}
                      onClose={() => setPage9SettingsNotice(null)}
                    />
                  ) : null}
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>标题：</Text>
                      <Input
                        maxLength={40}
                        placeholder="留空显示默认「团队积分榜」"
                        value={page9TitleDraft}
                        onChange={(event) => setPage9TitleDraft(event.target.value)}
                      />
                    </Col>
                  </Row>
                  <div>
                    <Row gutter={[16, 8]}>
                      <Col xs={24} md={12}><Text type="secondary">战队名称</Text></Col>
                      <Col xs={8} md={4}><Text type="secondary">R1 积分</Text></Col>
                      <Col xs={8} md={4}><Text type="secondary">R2 积分</Text></Col>
                      <Col xs={8} md={4}><Text type="secondary">R3 积分</Text></Col>
                    </Row>
                    {page9TeamsDraft.map((team, index) => (
                      <Row key={index} gutter={[16, 8]} style={{ marginTop: 8 }}>
                        <Col xs={24} md={12}>
                          <AutoComplete
                            style={{ width: '100%' }}
                            value={team.name}
                            options={(profiles?.teams ?? []).map((item) => ({ value: item.name }))}
                            filterOption={(input, option) =>
                              String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
                            }
                            onChange={(value) => updatePage9TeamDraft(index, 'name', String(value ?? ''))}
                          >
                            <Input
                              maxLength={40}
                              placeholder={`战队 ${index + 1} 名称，可联想「信息录入」战队`}
                            />
                          </AutoComplete>
                        </Col>
                        <Col xs={8} md={4}>
                          <Input
                            maxLength={3}
                            placeholder="-"
                            value={team.r1}
                            onChange={(event) => updatePage9TeamDraft(index, 'r1', event.target.value)}
                          />
                        </Col>
                        <Col xs={8} md={4}>
                          <Input
                            maxLength={3}
                            placeholder="-"
                            value={team.r2}
                            onChange={(event) => updatePage9TeamDraft(index, 'r2', event.target.value)}
                          />
                        </Col>
                        <Col xs={8} md={4}>
                          <Input
                            maxLength={3}
                            placeholder="-"
                            value={team.r3}
                            onChange={(event) => updatePage9TeamDraft(index, 'r3', event.target.value)}
                          />
                        </Col>
                      </Row>
                    ))}
                  </div>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    积分留空显示「-」；排名与总积分按三轮积分之和自动降序计算（同分保持录入顺序）；名称与积分全空的行不展示；最多 {PAGE9_TEAM_COUNT} 支战队。
                  </Paragraph>
                </Space>
              </Card>
            </Col>
          </Row>
        </Space>
      </Card>
    </Space>
  );
}
