import React, { useEffect, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Col,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';

import type { Page11State, StagePageKey } from '../../../shared/types';
import { useAdminData } from '../data/use-admin-data';
import { getActiveMatch } from '../lib/match';
import { requestJson } from '../lib/request';
import { buildPlayerPetOptions } from '../lib/sprite';
import type { NoticeState } from '../types';
import { Hint } from '../ui/Hint';

const { Paragraph, Text } = Typography;

type Page11Draft = {
  source: 'manual' | 'match';
  name: string;
  rank: string;
  declaration: string;
  pets: string;
};

const EMPTY_DRAFT: Page11Draft = { source: 'match', name: '', rank: '', declaration: '', pets: '' };

function draftFromState(state: Page11State['left'] | Page11State['right'] | undefined): Page11Draft | null {
  if (!state) {
    return null;
  }
  return {
    source: state.source,
    name: state.name,
    rank: state.rank,
    declaration: state.declaration,
    pets: state.pets,
  };
}

/**
 * 选手介绍（page11-13，M4 从 App.tsx 拆出）：
 * 画面切换走数据层 saveStage；左右两边的 source/手动填写草稿是本视图状态。
 */
export function Page11View(): React.ReactElement {
  const {
    page11,
    profiles,
    sprites,
    matchStore,
    stage,
    saveStage,
    applyServerState,
  } = useAdminData();
  const activeMatch = getActiveMatch(matchStore);
  const playerPetOptions = buildPlayerPetOptions(sprites);

  const [page11LeftDraft, setPage11LeftDraft] = useState<Page11Draft>(EMPTY_DRAFT);
  const [page11RightDraft, setPage11RightDraft] = useState<Page11Draft>(EMPTY_DRAFT);
  const [page11Saving, setPage11Saving] = useState(false);
  const [page11Notice, setPage11Notice] = useState<NoticeState>(null);

  // 服务端状态变化时回填（避免编辑中频繁覆盖，仅在结构变化时同步）
  useEffect(() => {
    setPage11LeftDraft((prev) => {
      const server = draftFromState(page11?.left);
      if (!server) {
        return prev;
      }
      return prev.source === server.source && prev.name === server.name && prev.rank === server.rank
        && prev.declaration === server.declaration && prev.pets === server.pets
        ? prev
        : server;
    });
    setPage11RightDraft((prev) => {
      const server = draftFromState(page11?.right);
      if (!server) {
        return prev;
      }
      return prev.source === server.source && prev.name === server.name && prev.rank === server.rank
        && prev.declaration === server.declaration && prev.pets === server.pets
        ? prev
        : server;
    });
  }, [page11?.left, page11?.right]);

  // 保存选手介绍配置（左右两侧数据来源与手动填写内容）
  async function savePage11Settings(payload?: { left?: Page11Draft; right?: Page11Draft }) {
    setPage11Saving(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page11State }>('/api/page11', {
        method: 'POST',
        json: {
          left: payload?.left ?? page11LeftDraft,
          right: payload?.right ?? page11RightDraft,
        },
      });
      applyServerState({ page11: data.state });
      setPage11Notice({ tone: 'success', text: '选手介绍设置已保存' });
    } catch (error) {
      setPage11Notice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPage11Saving(false);
    }
  }

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Card
        title="选手介绍画面切换"
        extra={<Button href="/roco-pvp-page11.html?mode=left" target="_blank">打开介绍页面</Button>}
      >
        <Space direction="vertical" size={16} className="page-stack">
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            切换选手介绍的三种推流画面；「选手介绍-左侧/右侧选手」依次展示单侧选手的立绘、头像、擅长精灵与比赛宣言，「对战页」展示双方头像与当前阵容。
          </Paragraph>
          <Row gutter={[16, 16]}>
            {([
              { value: 'page11', label: '介绍左侧选手', description: '立绘在左，介绍当前左侧选手' },
              { value: 'page12', label: '介绍右侧选手', description: '立绘在右，介绍当前右侧选手' },
              { value: 'page13', label: '对战页', description: '双方头像 + 当前阵容 + 分割线' },
            ] as Array<{ value: StagePageKey; label: string; description: string }>).map((option) => {
              const active = (stage?.page ?? null) === option.value;
              return (
                <Col xs={24} sm={8} key={option.value}>
                  <Card
                    size="small"
                    hoverable
                    className={`stage-card ${active ? 'stage-card-active' : ''}`}
                    onClick={() => void saveStage(option.value)}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                        <Text strong>{option.label}</Text>
                        {active ? <Tag color="green">当前画面</Tag> : null}
                      </Space>
                      <Hint>{option.description}</Hint>
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Space>
      </Card>

      <Card
        title="选手介绍数据"
        extra={(
          <Button type="primary" loading={page11Saving} onClick={() => void savePage11Settings()}>
            保存选手介绍设置
          </Button>
        )}
      >
        <Space direction="vertical" size={16} className="page-stack">
          {page11Notice ? (
            <Alert
              showIcon
              closable
              type={page11Notice.tone}
              message={page11Notice.text}
              onClose={() => setPage11Notice(null)}
            />
          ) : null}
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            数据来源可选「当前赛事」（选手名/排名取当前赛事，介绍内容按名字匹配「信息录入」自动补全）或「手动填写」（留空的字段同样回退「信息录入」匹配值）。当前赛事：{activeMatch ? `${activeMatch.leftPlayer || '左侧'} vs ${activeMatch.rightPlayer || '右侧'}` : '未选择'}。
          </Paragraph>
          {(['left', 'right'] as const).map((side) => {
            const draft = side === 'left' ? page11LeftDraft : page11RightDraft;
            const setDraft = side === 'left' ? setPage11LeftDraft : setPage11RightDraft;
            return (
              <Card
                key={side}
                size="small"
                className="subtle-card"
                title={side === 'left' ? '左侧选手' : '右侧选手'}
                extra={(
                  <Segmented
                    value={draft.source}
                    options={[
                      { value: 'match', label: '当前赛事' },
                      { value: 'manual', label: '手动填写' },
                    ]}
                    onChange={(value) => setDraft({ ...draft, source: value as 'manual' | 'match' })}
                  />
                )}
              >
                {draft.source === 'manual' ? (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={6}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>选手名字：</Text>
                      <AutoComplete
                        style={{ width: '100%' }}
                        value={draft.name}
                        options={(profiles?.players ?? []).map((item) => ({ value: item.name }))}
                        filterOption={(input, option) =>
                          String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
                        }
                        onChange={(value) => setDraft({ ...draft, name: String(value ?? '') })}
                      >
                        <Input maxLength={32} placeholder="输入或联想「信息录入」选手" />
                      </AutoComplete>
                    </Col>
                    <Col xs={24} md={4}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>排位排名：</Text>
                      <Input
                        maxLength={10}
                        placeholder="仅数字，留空回退赛事/信息录入"
                        value={draft.rank}
                        onChange={(event) => setDraft({ ...draft, rank: event.target.value.replace(/\D/g, '') })}
                      />
                    </Col>
                    <Col xs={24} md={14}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>擅长精灵：</Text>
                      <Select
                        mode="multiple"
                        allowClear
                        showSearch
                        maxCount={6}
                        popupMatchSelectWidth={false}
                        style={{ width: '100%' }}
                        placeholder="搜索并选择擅长精灵，最多 6 个"
                        options={playerPetOptions}
                        value={draft.pets.split(/[/、,，\s]+/).map((item) => item.trim()).filter(Boolean)}
                        filterOption={(input, option) =>
                          String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
                        }
                        onChange={(values) => setDraft({ ...draft, pets: Array.isArray(values) ? values.filter(Boolean).join('、') : '' })}
                      />
                    </Col>
                    <Col xs={24}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>比赛宣言：</Text>
                      <Input
                        maxLength={120}
                        placeholder="留空回退「信息录入」宣言"
                        value={draft.declaration}
                        onChange={(event) => setDraft({ ...draft, declaration: event.target.value })}
                      />
                    </Col>
                  </Row>
                ) : (
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    使用当前赛事选手：{activeMatch ? (side === 'left' ? activeMatch.leftPlayer : activeMatch.rightPlayer) || '未填写' : '未选择赛事'}；排名取赛事录入，宣言/擅长精灵按名字匹配「信息录入」。
                  </Paragraph>
                )}
              </Card>
            );
          })}
        </Space>
      </Card>
    </Space>
  );
}
